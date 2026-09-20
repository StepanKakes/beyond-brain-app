import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../components/auth/context/AuthContext';
import { IS_PLATFORM } from '../constants/config';

type WebSocketContextType = {
  ws: WebSocket | null;
  sendMessage: (message: any) => void;
  latestMessage: any | null;
  isConnected: boolean;
  // Subscribe to every incoming WS message synchronously, bypassing the React
  // state batching that drops intermediate messages (e.g. a `token_budget`
  // event arriving microseconds before a `complete` event would be coalesced
  // into one render where only `complete` survives). Returns unsubscribe.
  subscribeMessages: (handler: (data: any) => void) => () => void;
};

const WebSocketContext = createContext<WebSocketContextType | null>(null);

export const useWebSocket = () => {
  const context = useContext(WebSocketContext);
  if (!context) {
    throw new Error('useWebSocket must be used within a WebSocketProvider');
  }
  return context;
};

const buildWebSocketUrl = (token: string | null) => {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  if (IS_PLATFORM) return `${protocol}//${window.location.host}/ws`; // Platform mode: Use same domain as the page (goes through proxy)
  if (!token) return null;
  return `${protocol}//${window.location.host}/ws?token=${encodeURIComponent(token)}`; // OSS mode: Use same host:port that served the page
};

const useWebSocketProviderState = (): WebSocketContextType => {
  const wsRef = useRef<WebSocket | null>(null);
  const unmountedRef = useRef(false); // Track if component is unmounted
  const hasConnectedRef = useRef(false); // Track if we've ever connected (to detect reconnects)
  const [latestMessage, setLatestMessage] = useState<any>(null);
  const [isConnected, setIsConnected] = useState(false);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const subscribersRef = useRef<Set<(data: any) => void>>(new Set());
  // Messages written while the socket was down. A prompt typed right after
  // the tab comes back must not vanish because the socket had not caught up
  // yet; it waits here and goes out the moment the socket opens.
  const pendingRef = useRef<any[]>([]);
  const attemptRef = useRef(0);
  const lastSeenRef = useRef(Date.now());
  const heartbeatRef = useRef<NodeJS.Timeout | null>(null);
  const { token } = useAuth();

  useEffect(() => {
    connect();
    
    return () => {
      unmountedRef.current = true;
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [token]); // everytime token changes, we reconnect

  const connect = useCallback(() => {
    if (unmountedRef.current) return; // Prevent connection if unmounted
    const current = wsRef.current;
    if (current && (current.readyState === WebSocket.CONNECTING || current.readyState === WebSocket.OPEN)) return;
    try {
      // Construct WebSocket URL
      const wsUrl = buildWebSocketUrl(token);

      if (!wsUrl) return console.warn('No authentication token found for WebSocket connection');
      
      const websocket = new WebSocket(wsUrl);
      wsRef.current = websocket;

      websocket.onopen = () => {
        setIsConnected(true);
        wsRef.current = websocket;
        attemptRef.current = 0;
        lastSeenRef.current = Date.now();
        // Whatever was typed while the socket was down goes out now, in order.
        const queued = pendingRef.current.splice(0);
        for (const m of queued) {
          try { websocket.send(JSON.stringify(m)); } catch (e) { console.error('WS flush failed:', e); }
        }
        if (hasConnectedRef.current) {
          // This is a reconnect — signal so components can catch up on missed
          // messages. Goes to the direct subscribers too, like any message.
          const notice = { type: 'websocket-reconnected', timestamp: Date.now() };
          for (const handler of subscribersRef.current) {
            try { handler(notice); } catch (e) { console.error('WS subscriber error:', e); }
          }
          setLatestMessage(notice);
        }
        hasConnectedRef.current = true;
      };

      websocket.onmessage = (event) => {
        lastSeenRef.current = Date.now();
        try {
          const data = JSON.parse(event.data);
          if (data && data.type === 'pong') return;
          // Notify direct subscribers synchronously FIRST so they see every
          // message even when React would batch the latestMessage state
          // updates and drop intermediate ones.
          for (const handler of subscribersRef.current) {
            try { handler(data); } catch (e) { console.error('WS subscriber error:', e); }
          }
          setLatestMessage(data);
        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
        }
      };

      websocket.onclose = () => {
        setIsConnected(false);
        if (wsRef.current === websocket) wsRef.current = null;
        // Reconnect quickly, then back off: half a second first, eight at most.
        const delay = Math.min(8000, 500 * 2 ** Math.min(attemptRef.current, 4));
        attemptRef.current += 1;
        if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = setTimeout(() => {
          if (unmountedRef.current) return; // Prevent reconnection if unmounted
          connect();
        }, delay);
      };

      websocket.onerror = (error) => {
        console.error('WebSocket error:', error);
      };

    } catch (error) {
      console.error('Error creating WebSocket connection:', error);
    }
  }, [token]); // everytime token changes, we reconnect

  const sendMessage = useCallback((message: any) => {
    const socket = wsRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
      return;
    }
    // Not open: keep the message and get a socket now rather than on the
    // next scheduled retry. A liveness probe is not worth keeping.
    if (message && message.type === 'ping') return;
    pendingRef.current.push(message);
    if (!socket || socket.readyState === WebSocket.CLOSED) {
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      connect();
    }
  }, [connect]);

  // A socket can die without a close event (a laptop lid, a background tab,
  // a network switch); the browser keeps believing it is open and every
  // message goes into the void. So: ping every 25 s, and if nothing at all
  // came back for 40 s, drop the socket and reconnect. Coming back to the
  // tab or back online reconnects at once when the socket is not open.
  useEffect(() => {
    const beat = () => {
      const socket = wsRef.current;
      if (!socket || socket.readyState !== WebSocket.OPEN) return;
      if (Date.now() - lastSeenRef.current > 40_000) {
        try { socket.close(); } catch { /* already gone */ }
        return;
      }
      try { socket.send(JSON.stringify({ type: 'ping', t: Date.now() })); } catch { /* close will follow */ }
    };
    heartbeatRef.current = setInterval(beat, 25_000);
    const wake = () => {
      if (document.visibilityState === 'hidden') return;
      const socket = wsRef.current;
      if (socket && socket.readyState === WebSocket.OPEN) {
        // Probe right away so a dead socket is found in seconds, not at the
        // next beat.
        try { socket.send(JSON.stringify({ type: 'ping', t: Date.now() })); } catch { /* close will follow */ }
        return;
      }
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      connect();
    };
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('focus', wake);
    window.addEventListener('online', wake);
    return () => {
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('focus', wake);
      window.removeEventListener('online', wake);
    };
  }, [connect]);

  const subscribeMessages = useCallback((handler: (data: any) => void) => {
    subscribersRef.current.add(handler);
    return () => {
      subscribersRef.current.delete(handler);
    };
  }, []);

  const value: WebSocketContextType = useMemo(() =>
  ({
    ws: wsRef.current,
    sendMessage,
    latestMessage,
    isConnected,
    subscribeMessages,
  }), [sendMessage, latestMessage, isConnected, subscribeMessages]);

  return value;
};

export const WebSocketProvider = ({ children }: { children: React.ReactNode }) => {
  const webSocketData = useWebSocketProviderState();
  
  return (
    <WebSocketContext.Provider value={webSocketData}>
      {children}
    </WebSocketContext.Provider>
  );
};

export default WebSocketContext;
