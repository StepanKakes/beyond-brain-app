/**
 * Beyond Brain — MCP connectors store.
 *
 * Persists user-added MCP servers ("connectors") + their OAuth tokens in a
 * single JSON file alongside auth.db. This is the Beyond-native connector
 * system that powers the in-app "Konektory" panel (add / manage / OAuth-connect
 * MCP servers, Claude-app style). It runs ALONGSIDE — not instead of — the
 * upstream providers module (`/api/providers`, config-file based); they don't
 * collide because they use different stores and are merged separately.
 *
 * Why a dedicated store (not ~/.claude.json):
 *   - OAuth access/refresh tokens are secrets. Baking them into ~/.claude.json
 *     or a git-committed .mcp.json would leak them into shared configs. They
 *     live only here, server-side, and are injected into the SDK at runtime
 *     (see `loadMcpConfig` in claude-sdk.js) so they're never persisted into a
 *     config file and never sent to the browser.
 *   - Tokens expire; keeping them here lets us refresh centrally on each turn.
 *
 * Concurrency: mirrors beyond-sessions-store.js — a single JSON file, atomic
 * write (tmp + rename), and a single in-process promise chain (`withStoreLock`)
 * so concurrent read-modify-write requests can't clobber each other. One shared
 * Beyond login → connectors are effectively global (shared across devices),
 * exactly like the session index.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

import { writeFileAtomic } from '../utils/atomic-write.js';

export const BEYOND_CONNECTORS_FILE = path.join(
  os.homedir(),
  '.cloudcli',
  'beyond-mcp-connectors.json',
);

/** Allowed transports + auth modes. */
export const TRANSPORTS = ['http', 'sse', 'stdio'];
export const AUTH_MODES = ['none', 'oauth', 'token'];

// ---------------------------------------------------------------------------
// Raw file IO
// ---------------------------------------------------------------------------
async function readStore() {
  try {
    const raw = await fs.readFile(BEYOND_CONNECTORS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.connectors)) {
      return { connectors: parsed.connectors };
    }
    return { connectors: [] };
  } catch (err) {
    if (err && err.code === 'ENOENT') return { connectors: [] };
    console.error('[beyond-connectors] read failed', err);
    return { connectors: [] };
  }
}

async function writeStore(store) {
  // Windows-safe atomic write (retry rename through transient locks + in-place
  // fallback) — see server/utils/atomic-write.js.
  await writeFileAtomic(BEYOND_CONNECTORS_FILE, JSON.stringify(store, null, 2));
}

// Single in-process promise chain — see beyond-sessions-store.js for rationale.
// Public mutators MUST NOT nest withStoreLock (inner call would deadlock).
let _chain = Promise.resolve();
function withStoreLock(fn) {
  const run = _chain.then(fn, fn);
  _chain = run.then(() => {}, () => {});
  return run;
}

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------
function normStringRecord(input) {
  if (!input || typeof input !== 'object') return {};
  const out = {};
  for (const [k, v] of Object.entries(input)) {
    if (typeof k === 'string' && typeof v === 'string') out[k] = v;
  }
  return out;
}

function normStringArray(input) {
  if (!Array.isArray(input)) return [];
  return input.filter((s) => typeof s === 'string');
}

/** Coerce a raw stored object into a well-formed connector. */
function normalizeConnector(c) {
  if (!c || typeof c !== 'object') return null;
  const id = typeof c.id === 'string' && c.id.trim() ? c.id.trim() : null;
  const name = typeof c.name === 'string' ? c.name.trim() : '';
  if (!id || !name) return null;
  const transport = TRANSPORTS.includes(c.transport) ? c.transport : 'http';
  const auth = AUTH_MODES.includes(c.auth) ? c.auth : 'none';
  return {
    id,
    name,
    transport,
    enabled: c.enabled !== false,
    url: typeof c.url === 'string' ? c.url : '',
    command: typeof c.command === 'string' ? c.command : '',
    args: normStringArray(c.args),
    env: normStringRecord(c.env),
    headers: normStringRecord(c.headers),
    auth,
    oauth: c.oauth && typeof c.oauth === 'object' ? c.oauth : null,
    status: typeof c.status === 'string' ? c.status : 'unknown',
    lastError: typeof c.lastError === 'string' ? c.lastError : null,
    createdAt: typeof c.createdAt === 'number' ? c.createdAt : Date.now(),
    updatedAt: typeof c.updatedAt === 'number' ? c.updatedAt : Date.now(),
  };
}

/** Public view — strips every secret. Never send the raw connector to a client. */
export function toPublicConnector(c) {
  const n = normalizeConnector(c);
  if (!n) return null;
  const o = n.oauth || {};
  const hasHeaders = Object.keys(n.headers).length > 0;
  return {
    id: n.id,
    name: n.name,
    transport: n.transport,
    enabled: n.enabled,
    url: n.url,
    command: n.command,
    args: n.args,
    // env keys only (values may hold secrets)
    envKeys: Object.keys(n.env),
    hasHeaders,
    auth: n.auth,
    // OAuth presence flags — never the tokens themselves.
    oauth: n.auth === 'oauth'
      ? {
          connected: Boolean(o.accessToken),
          expiresAt: typeof o.expiresAt === 'number' ? o.expiresAt : null,
          scope: typeof o.scope === 'string' ? o.scope : null,
          hasClientId: Boolean(o.clientId),
          hasRefreshToken: Boolean(o.refreshToken),
        }
      : null,
    status: n.status,
    lastError: n.lastError,
    createdAt: n.createdAt,
    updatedAt: n.updatedAt,
  };
}

// ---------------------------------------------------------------------------
// Public read API (raw — internal callers: SDK merge, oauth service)
// ---------------------------------------------------------------------------
export async function listConnectors() {
  const store = await readStore();
  return store.connectors.map(normalizeConnector).filter(Boolean);
}

export async function listPublicConnectors() {
  return (await listConnectors()).map(toPublicConnector).filter(Boolean);
}

export async function getConnector(id) {
  if (!id) return null;
  const store = await readStore();
  const found = store.connectors.find((c) => c && c.id === id);
  return found ? normalizeConnector(found) : null;
}

// ---------------------------------------------------------------------------
// Public mutation API
// ---------------------------------------------------------------------------
export function addConnector(input = {}) {
  return withStoreLock(async () => {
    const store = await readStore();
    const now = Date.now();
    const connector = normalizeConnector({
      ...input,
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
      status: input.status || 'unknown',
    });
    if (!connector) {
      throw new Error('Invalid connector: name is required.');
    }
    store.connectors.push(connector);
    await writeStore(store);
    return connector;
  });
}

/** Shallow-merge patch onto a connector. `oauth` is merged one level deep so a
 *  partial token update (e.g. after refresh) doesn't wipe clientId/endpoints. */
export function updateConnector(id, patch = {}) {
  return withStoreLock(async () => {
    const store = await readStore();
    const idx = store.connectors.findIndex((c) => c && c.id === id);
    if (idx === -1) return null;
    const current = normalizeConnector(store.connectors[idx]);
    const nextOauth =
      patch.oauth === null
        ? null
        : patch.oauth
          ? { ...(current.oauth || {}), ...patch.oauth }
          : current.oauth;
    const merged = normalizeConnector({
      ...current,
      ...patch,
      oauth: nextOauth,
      id: current.id,
      createdAt: current.createdAt,
      updatedAt: Date.now(),
    });
    store.connectors[idx] = merged;
    await writeStore(store);
    return merged;
  });
}

export function removeConnector(id) {
  return withStoreLock(async () => {
    const store = await readStore();
    const before = store.connectors.length;
    store.connectors = store.connectors.filter((c) => c && c.id !== id);
    const removed = store.connectors.length !== before;
    if (removed) await writeStore(store);
    return removed;
  });
}

// ---------------------------------------------------------------------------
// Pending OAuth flows — short-lived, in-memory (the flow completes in seconds
// within this single process; a service restart mid-flow just means retry).
// Keyed by opaque `state`. TTL-pruned so abandoned flows don't accumulate.
// ---------------------------------------------------------------------------
const PENDING_TTL_MS = 10 * 60 * 1000; // 10 min
const _pending = new Map();

function prunePending() {
  const now = Date.now();
  for (const [state, entry] of _pending) {
    if (now - entry.createdAt > PENDING_TTL_MS) _pending.delete(state);
  }
}

export function setPending(state, data) {
  prunePending();
  _pending.set(state, { ...data, createdAt: Date.now() });
}

/** Retrieve and remove a pending flow (single-use). */
export function takePending(state) {
  prunePending();
  if (!state || !_pending.has(state)) return null;
  const entry = _pending.get(state);
  _pending.delete(state);
  return entry;
}
