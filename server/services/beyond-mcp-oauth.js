/**
 * Beyond Brain — MCP OAuth service.
 *
 * Implements the browser-based OAuth 2.1 authorization-code + PKCE flow that
 * lets a user connect a remote (http/sse) MCP server the same way the Claude
 * app does: paste URL → "Připojit" → provider popup → tokens stored → the MCP
 * server's tools become available in chat.
 *
 * We build on the primitives from `@modelcontextprotocol/sdk/client/auth.js`
 * (RFC 9728 protected-resource discovery, RFC 8414 auth-server discovery, RFC
 * 7591 dynamic client registration, PKCE authorize, token exchange/refresh) but
 * drive the flow ourselves because the SDK's built-in `auth()` orchestrator
 * expects to open a browser on the *same* machine — no good for a headless
 * Windows service whose user is on a phone/laptop at brain.growbeyond.cz. Here
 * the popup runs in the user's browser and the provider redirects back to our
 * unauthenticated callback route (secured by the opaque `state`).
 *
 * Tokens are persisted only in the connectors store (server-side); the runtime
 * (loadMcpConfig) calls `refreshIfNeeded` on each turn and injects a fresh
 * `Authorization: Bearer` header — nothing is ever written into ~/.claude.json.
 */

import crypto from 'node:crypto';

import {
  discoverOAuthProtectedResourceMetadata,
  discoverAuthorizationServerMetadata,
  discoverOAuthServerInfo,
  registerClient,
  startAuthorization,
  exchangeAuthorization,
  refreshAuthorization,
} from '@modelcontextprotocol/sdk/client/auth.js';

import { updateConnector, setPending } from './beyond-mcp-connectors-store.js';

const CLIENT_NAME = 'Beyond Brain';
// Refresh a little before the token actually expires so an in-flight turn never
// races the expiry.
const REFRESH_SKEW_MS = 60 * 1000;

/** RFC 8707 resource indicator = the canonical MCP server URL. */
function resourceFor(connector, resourceMetadata) {
  const raw = resourceMetadata?.resource || connector.url;
  try {
    return new URL(raw);
  } catch {
    return new URL(connector.url);
  }
}

/** Pick a scope string: explicit override → resource-advertised → AS-advertised. */
function chooseScope(connector, resourceMetadata, asMetadata) {
  if (connector.oauth?.scope) return connector.oauth.scope;
  const fromResource = resourceMetadata?.scopes_supported;
  if (Array.isArray(fromResource) && fromResource.length) return fromResource.join(' ');
  const fromAs = asMetadata?.scopes_supported;
  if (Array.isArray(fromAs) && fromAs.length) return fromAs.join(' ');
  return undefined;
}

/**
 * Detect whether a freshly-added remote server requires OAuth. Best-effort:
 * a server that advertises RFC 9728 protected-resource metadata, or answers an
 * `initialize` with 401, wants OAuth. Anything else is treated as open (the
 * user can still add a manual token). Never throws.
 */
export async function detectRemoteAuth(url) {
  try {
    await discoverOAuthProtectedResourceMetadata(url, {});
    return { needsOAuth: true };
  } catch {
    /* RFC 9728 not implemented — fall through to a live probe */
  }
  try {
    const res = await mcpInitialize(url, {});
    if (res.status === 401 || res.status === 403) return { needsOAuth: true };
    return { needsOAuth: false };
  } catch {
    return { needsOAuth: false };
  }
}

/**
 * Begin an authorization flow for a connector. Discovers metadata, registers a
 * client if needed (persisting clientId/secret + endpoints on the connector),
 * builds the PKCE authorization URL, and records a pending entry keyed by
 * `state`. Returns `{ authorizationUrl, state }`.
 */
export async function beginAuthorization(connector, redirectUri) {
  const info = await discoverOAuthServerInfo(connector.url);
  const authorizationServerUrl = info.authorizationServerUrl;
  const asMetadata = info.authorizationServerMetadata;
  const resourceMetadata = info.resourceMetadata;
  if (!asMetadata) {
    throw new Error(
      'Server neposkytuje OAuth metadata (RFC 8414). Zkuste zadat token ručně v „Pokročilé".',
    );
  }

  const resource = resourceFor(connector, resourceMetadata);
  const scope = chooseScope(connector, resourceMetadata, asMetadata);

  // Reuse an existing dynamically-registered client, else register one.
  let clientInformation;
  if (connector.oauth?.clientId) {
    clientInformation = {
      client_id: connector.oauth.clientId,
      ...(connector.oauth.clientSecret ? { client_secret: connector.oauth.clientSecret } : {}),
    };
  } else {
    const registered = await registerClient(authorizationServerUrl, {
      metadata: asMetadata,
      clientMetadata: {
        client_name: CLIENT_NAME,
        redirect_uris: [redirectUri],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
        ...(scope ? { scope } : {}),
      },
      scope,
    });
    clientInformation = registered;
  }

  const state = crypto.randomUUID();
  const { authorizationUrl, codeVerifier } = await startAuthorization(authorizationServerUrl, {
    metadata: asMetadata,
    clientInformation,
    redirectUrl: redirectUri,
    scope,
    state,
    resource,
  });

  // Persist the durable OAuth config (no tokens yet) onto the connector.
  await updateConnector(connector.id, {
    auth: 'oauth',
    status: 'authorizing',
    lastError: null,
    oauth: {
      ...(connector.oauth || {}),
      authorizationServerUrl,
      tokenEndpoint: asMetadata.token_endpoint || null,
      tokenAuthMethods: asMetadata.token_endpoint_auth_methods_supported || null,
      authorizationEndpoint: asMetadata.authorization_endpoint || null,
      registrationEndpoint: asMetadata.registration_endpoint || null,
      clientId: clientInformation.client_id,
      clientSecret: clientInformation.client_secret || null,
      scope: scope || null,
      resource: resource.href,
    },
  });

  // Short-lived pending record consumed by the callback.
  setPending(state, {
    connectorId: connector.id,
    codeVerifier,
    redirectUri,
    authorizationServerUrl,
    resource: resource.href,
    clientId: clientInformation.client_id,
    clientSecret: clientInformation.client_secret || null,
    metadata: {
      token_endpoint: asMetadata.token_endpoint,
      token_endpoint_auth_methods_supported: asMetadata.token_endpoint_auth_methods_supported,
    },
  });

  return { authorizationUrl: authorizationUrl.href, state };
}

/**
 * Complete the flow: exchange the authorization code for tokens and persist
 * them on the connector. `pending` is the entry recorded by beginAuthorization.
 */
export async function completeAuthorization(pending, code) {
  const clientInformation = {
    client_id: pending.clientId,
    ...(pending.clientSecret ? { client_secret: pending.clientSecret } : {}),
  };
  const tokens = await exchangeAuthorization(pending.authorizationServerUrl, {
    metadata: pending.metadata,
    clientInformation,
    authorizationCode: code,
    codeVerifier: pending.codeVerifier,
    redirectUri: pending.redirectUri,
    resource: pending.resource ? new URL(pending.resource) : undefined,
  });

  const expiresAt =
    typeof tokens.expires_in === 'number' ? Date.now() + tokens.expires_in * 1000 : null;

  const updated = await updateConnector(pending.connectorId, {
    status: 'connected',
    lastError: null,
    oauth: {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token || null,
      expiresAt,
      ...(tokens.scope ? { scope: tokens.scope } : {}),
    },
  });
  return updated;
}

/**
 * Return a valid access token for an OAuth connector, refreshing if it's within
 * the skew window of expiry. Persists any refreshed tokens. Returns null if the
 * connector can't produce a valid token (caller should mark it needs_auth).
 */
export async function refreshIfNeeded(connector) {
  const o = connector.oauth;
  if (connector.auth !== 'oauth' || !o) return null;

  const now = Date.now();
  const stillValid = o.accessToken && (!o.expiresAt || now < o.expiresAt - REFRESH_SKEW_MS);
  if (stillValid) return o.accessToken;

  if (!o.refreshToken || !o.authorizationServerUrl) {
    // Can't refresh — needs interactive re-auth.
    return null;
  }

  const clientInformation = {
    client_id: o.clientId,
    ...(o.clientSecret ? { client_secret: o.clientSecret } : {}),
  };
  const tokens = await refreshAuthorization(o.authorizationServerUrl, {
    metadata: {
      token_endpoint: o.tokenEndpoint || undefined,
      token_endpoint_auth_methods_supported: o.tokenAuthMethods || undefined,
    },
    clientInformation,
    refreshToken: o.refreshToken,
    resource: o.resource ? new URL(o.resource) : undefined,
  });

  const expiresAt =
    typeof tokens.expires_in === 'number' ? Date.now() + tokens.expires_in * 1000 : null;
  await updateConnector(connector.id, {
    status: 'connected',
    lastError: null,
    oauth: {
      accessToken: tokens.access_token,
      // refreshAuthorization already preserves the old refresh token if unchanged
      refreshToken: tokens.refresh_token || o.refreshToken,
      expiresAt,
      ...(tokens.scope ? { scope: tokens.scope } : {}),
    },
  });
  return tokens.access_token;
}

/**
 * Lightweight liveness probe for the "Test" button. For remote servers, sends
 * an MCP `initialize` with whatever auth the connector currently has. Returns a
 * status string: 'connected' | 'needs_auth' | 'error'. stdio can't be probed
 * cheaply, so it reports 'unknown' (runtime will surface real failures).
 */
export async function probe(connector) {
  if (connector.transport === 'stdio') {
    return { status: 'unknown', detail: 'Lokální server se ověří až při spuštění chatu.' };
  }
  const headers = {};
  if (connector.auth === 'oauth') {
    const token = await refreshIfNeeded(connector).catch(() => null);
    if (!token) return { status: 'needs_auth', detail: 'Chybí platný OAuth token.' };
    headers.Authorization = `Bearer ${token}`;
  } else if (connector.auth === 'token') {
    Object.assign(headers, connector.headers || {});
  }
  try {
    const res = await mcpInitialize(connector.url, headers);
    if (res.status >= 200 && res.status < 300) return { status: 'connected' };
    if (res.status === 401 || res.status === 403) {
      return { status: 'needs_auth', detail: `HTTP ${res.status}` };
    }
    return { status: 'error', detail: `HTTP ${res.status}` };
  } catch (err) {
    return { status: 'error', detail: err?.message || 'Spojení selhalo' };
  }
}

/**
 * Send a single MCP streamable-HTTP `initialize` request. Returns `{ status }`.
 * Used only for detection/probing — we don't keep the session open.
 */
async function mcpInitialize(url, headers = {}) {
  const body = {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'beyond-brain', version: '1.0.0' },
    },
  };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        ...headers,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    // Drain the body so the socket can be reused / closed cleanly.
    await res.body?.cancel?.().catch(() => {});
    return { status: res.status };
  } finally {
    clearTimeout(timeout);
  }
}

export { discoverAuthorizationServerMetadata };
