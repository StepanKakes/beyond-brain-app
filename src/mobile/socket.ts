import { UKAZKA, getToken } from './api';

// Jedno spojení na celou appku. iOS ho na pozadí klidně zabije bez onclose,
// proto se při návratu do popředí kontroluje a ihned obnovuje. Posluchači se
// o obnově dozví zprávou `websocket-reconnected` a dotáhnou si, co zmeškali.

export type SocketMessage = Record<string, unknown>;
type Handler = (message: SocketMessage) => void;

const handlers = new Set<Handler>();
let ws: WebSocket | null = null;
let queue: string[] = [];
let attempts = 0;
let everOpen = false;
let retry: ReturnType<typeof setTimeout> | null = null;
let ping: ReturnType<typeof setInterval> | null = null;

function emit(message: SocketMessage): void {
  handlers.forEach((handler) => handler(message));
}

function connect(): void {
  if (UKAZKA) return;
  const token = getToken();
  if (!token) return;
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = new WebSocket(
    `${protocol}//${window.location.host}/ws?token=${encodeURIComponent(token)}`,
  );
  ws = socket;

  socket.onopen = () => {
    attempts = 0;
    queue.forEach((payload) => socket.send(payload));
    queue = [];
    if (ping) clearInterval(ping);
    ping = setInterval(() => {
      if (socket.readyState === WebSocket.OPEN) socket.send('{"type":"ping"}');
    }, 25_000);
    if (everOpen) emit({ type: 'websocket-reconnected' });
    everOpen = true;
  };
  socket.onmessage = (event) => {
    try {
      const message = JSON.parse(event.data as string) as SocketMessage;
      if (message.type !== 'pong') emit(message);
    } catch {
      /* neplatná zpráva */
    }
  };
  socket.onclose = () => {
    if (ws !== socket) return;
    ws = null;
    if (ping) clearInterval(ping);
    scheduleRetry();
  };
  socket.onerror = () => socket.close();
}

function scheduleRetry(): void {
  if (retry) clearTimeout(retry);
  const delay = Math.min(8000, 500 * 2 ** attempts);
  attempts += 1;
  retry = setTimeout(connect, delay);
}

function onVisible(): void {
  if (document.visibilityState !== 'visible') return;
  attempts = 0;
  if (retry) clearTimeout(retry);
  // Spojení může tvrdit, že je otevřené, i když je po uspání mrtvé. Zavřeme ho
  // a otevřeme nové, o nic nepřijdeme: server stream znovu naváže.
  if (ws && ws.readyState === WebSocket.OPEN) {
    const stale = ws;
    ws = null;
    stale.onclose = null;
    stale.close();
  }
  connect();
}

document.addEventListener('visibilitychange', onVisible);
window.addEventListener('online', onVisible);

export function startSocket(): void {
  connect();
}

export function stopSocket(): void {
  if (retry) clearTimeout(retry);
  if (ws) {
    ws.onclose = null;
    ws.close();
  }
  ws = null;
  everOpen = false;
}

export function sendSocket(message: SocketMessage): void {
  if (UKAZKA) {
    void import('./ukazka').then(({ mockSocket }) => mockSocket(message, emit));
    return;
  }
  const payload = JSON.stringify(message);
  if (ws?.readyState === WebSocket.OPEN) ws.send(payload);
  else {
    queue.push(payload);
    connect();
  }
}

export function onSocket(handler: Handler): () => void {
  handlers.add(handler);
  return () => handlers.delete(handler);
}
