/**
 * Beyond Brain — MCP connectors client bridge to `/api/beyond/mcp/*`.
 *
 * Mirrors beyondSessionsApi.ts: thin wrappers over `authenticatedFetch` (Bearer
 * JWT). The one special case is `connectOAuth`, which drives the browser OAuth
 * flow — opens the provider consent screen in a popup and resolves when our
 * callback page posts back a `beyond-mcp-oauth` message.
 *
 * Secrets never cross this boundary: the server only ever returns the public
 * connector view (presence flags, no tokens).
 */
import { authenticatedFetch } from '../../utils/api';

export type ConnectorTransport = 'http' | 'sse' | 'stdio';
export type ConnectorAuth = 'none' | 'oauth' | 'token';
export type ConnectorStatus =
  | 'connected'
  | 'needs_auth'
  | 'authorizing'
  | 'error'
  | 'unknown';

export type Connector = {
  id: string;
  name: string;
  transport: ConnectorTransport;
  enabled: boolean;
  url: string;
  command: string;
  args: string[];
  envKeys: string[];
  hasHeaders: boolean;
  auth: ConnectorAuth;
  oauth: {
    connected: boolean;
    expiresAt: number | null;
    scope: string | null;
    hasClientId: boolean;
    hasRefreshToken: boolean;
  } | null;
  status: ConnectorStatus;
  lastError: string | null;
  createdAt: number;
  updatedAt: number;
};

export type Preset = {
  id: string;
  name: string;
  url: string;
  transport: ConnectorTransport;
  description: string;
};

export type AddConnectorInput = {
  name: string;
  transport: ConnectorTransport;
  url?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  headers?: Record<string, string>;
  auth?: ConnectorAuth;
};

const BASE = '/api/beyond/mcp';

async function json<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = (data && (data as { error?: string }).error) || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data as T;
}

export async function fetchConnectors(): Promise<Connector[]> {
  const res = await authenticatedFetch(`${BASE}/connectors`);
  const data = await json<{ connectors: Connector[] }>(res);
  return data.connectors || [];
}

export async function fetchPresets(): Promise<Preset[]> {
  const res = await authenticatedFetch(`${BASE}/presets`);
  const data = await json<{ presets: Preset[] }>(res);
  return data.presets || [];
}

export async function addConnector(input: AddConnectorInput): Promise<Connector> {
  const res = await authenticatedFetch(`${BASE}/connectors`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
  const data = await json<{ connector: Connector }>(res);
  return data.connector;
}

export async function patchConnector(
  id: string,
  patch: Partial<AddConnectorInput> & { enabled?: boolean },
): Promise<Connector> {
  const res = await authenticatedFetch(`${BASE}/connectors/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
  const data = await json<{ connector: Connector }>(res);
  return data.connector;
}

export async function deleteConnector(id: string): Promise<void> {
  const res = await authenticatedFetch(`${BASE}/connectors/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  await json<{ removed: boolean }>(res);
}

export async function testConnector(
  id: string,
): Promise<{ status: ConnectorStatus; detail?: string }> {
  const res = await authenticatedFetch(`${BASE}/connectors/${encodeURIComponent(id)}/test`, {
    method: 'POST',
  });
  return json<{ status: ConnectorStatus; detail?: string }>(res);
}

async function startOAuth(id: string): Promise<{ authorizationUrl: string; state: string }> {
  const res = await authenticatedFetch(
    `${BASE}/connectors/${encodeURIComponent(id)}/oauth/start`,
    { method: 'POST' },
  );
  return json<{ authorizationUrl: string; state: string }>(res);
}

export type ApplyResult = {
  ok: boolean;
  /** true = hot-attached to a live session; false = no running chat to attach to */
  live: boolean;
  added: string[];
  error: string | null;
};

/**
 * Ask the currently-open chat to hot-attach the current connector set to its
 * LIVE session, so a connector added mid-thread starts working immediately
 * instead of requiring a new chat (which would drop the user's context).
 *
 * Implemented as a window-event handshake because the chat owns the WebSocket:
 * we dispatch `beyond:apply-mcp`, BeyondChat sends it on, and relays the
 * server's answer back as `beyond:mcp-applied`.
 */
export function applyToCurrentChat(timeoutMs = 10000): Promise<ApplyResult> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (r: ApplyResult) => {
      if (settled) return;
      settled = true;
      window.removeEventListener('beyond:mcp-applied', onDone as EventListener);
      clearTimeout(timer);
      resolve(r);
    };
    const onDone = (e: Event) => {
      const d = ((e as CustomEvent).detail || {}) as Partial<ApplyResult>;
      finish({
        ok: Boolean(d.ok),
        live: Boolean(d.live),
        added: Array.isArray(d.added) ? d.added : [],
        error: d.error ?? null,
      });
    };
    const timer = setTimeout(
      () => finish({ ok: false, live: false, added: [], error: 'Chat neodpověděl.' }),
      timeoutMs,
    );
    window.addEventListener('beyond:mcp-applied', onDone as EventListener);
    // No chat mounted (e.g. welcome screen) → nobody answers → timeout above.
    window.dispatchEvent(new CustomEvent('beyond:apply-mcp'));
  });
}

/**
 * Run the full browser OAuth flow: open the provider consent screen in a popup
 * and resolve when our callback posts back. Resolves `{ ok, error? }`.
 */
export async function connectOAuth(id: string): Promise<{ ok: boolean; error?: string }> {
  const { authorizationUrl } = await startOAuth(id);
  const popup = window.open(
    authorizationUrl,
    'beyond-mcp-oauth',
    'width=520,height=720,menubar=no,toolbar=no,location=yes',
  );
  if (!popup) {
    return { ok: false, error: 'Vyskakovací okno bylo zablokováno prohlížečem.' };
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: { ok: boolean; error?: string }) => {
      if (settled) return;
      settled = true;
      window.removeEventListener('message', onMessage);
      clearInterval(poll);
      resolve(result);
    };
    const onMessage = (e: MessageEvent) => {
      // The callback page is served from our own origin.
      if (e.origin !== window.location.origin) return;
      const d = e.data as { type?: string; ok?: boolean; error?: string } | null;
      if (!d || d.type !== 'beyond-mcp-oauth') return;
      finish({ ok: Boolean(d.ok), error: d.error });
    };
    // If the user closes the popup without finishing, resolve as cancelled.
    const poll = setInterval(() => {
      if (popup.closed) finish({ ok: false, error: 'Přihlašovací okno bylo zavřeno.' });
    }, 600);
    window.addEventListener('message', onMessage);
  });
}
