/**
 * Beyond Brain — sending a WhatsApp message.
 *
 * Deliberately the dumbest module here: it takes a chat id and a string and
 * posts them. No template, no model, no rendering. The text that was approved
 * on screen is the text that goes on the wire, byte for byte, because an
 * approval that a later step can rewrite is not an approval.
 *
 * Credentials come from `BEYOND_WAHA_URL` / `BEYOND_WAHA_API_KEY`, and fall
 * back to the WAHA MCP entry the agent already uses in `~/.claude.json` so the
 * box does not need the same secret configured twice.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { resolveBrainPath } from '../utils/brain-path.js';

const DEFAULT_SESSION = 'default';
let cached = null;

/** Read the WAHA credentials the agent's MCP config already carries. */
function fromClaudeConfig() {
  try {
    const raw = fs.readFileSync(path.join(os.homedir(), '.claude.json'), 'utf8');
    const data = JSON.parse(raw);
    const projects = data.claudeProjects || data.projects || {};
    const brain = resolveBrainPath();
    // Prefer the brain project's entry; fall back to any project defining waha.
    const candidates = [projects[brain], ...Object.values(projects)];
    for (const proj of candidates) {
      const waha = proj?.mcpServers?.waha;
      const key = waha?.headers?.['X-Api-Key'] || waha?.headers?.['x-api-key'];
      if (waha?.url && key) {
        // The MCP endpoint is <base>/mcp; the REST API lives at <base>/api.
        return { baseUrl: String(waha.url).replace(/\/mcp\/?$/, ''), apiKey: key, source: '.claude.json' };
      }
    }
  } catch {
    /* no config, or unreadable — fall through */
  }
  return null;
}

function config() {
  if (cached) return cached;
  const url = process.env.BEYOND_WAHA_URL;
  const key = process.env.BEYOND_WAHA_API_KEY;
  if (url && key) {
    cached = { baseUrl: url.replace(/\/+$/, ''), apiKey: key, source: 'env' };
  } else {
    cached = fromClaudeConfig();
    if (cached) console.log(`[waha] klíč načten z ${cached.source}`);
  }
  return cached;
}

export function isConfigured() {
  return Boolean(config());
}

export function configSource() {
  return config()?.source || null;
}

/** Base URL and key for callers that read from WAHA (the raw pull). */
export function wahaConfig() {
  return config();
}

/** GET against the WAHA REST API. Throws with a readable reason. */
export async function wahaGet(pathname, { timeoutMs = 60_000 } = {}) {
  const c = config();
  if (!c) throw new Error('WAHA není nastavená');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${c.baseUrl}${pathname}`, { headers: { 'X-Api-Key': c.apiKey }, signal: ctrl.signal });
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new Error(`WAHA ${res.status}: ${body?.message || body?.error || pathname}`);
    return body;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Send one message. Resolves with the provider's id on success and throws with
 * a readable reason otherwise; the caller records either outcome against the
 * proposal so a failure is never silent.
 */
export async function sendText({ chatId, text, session = DEFAULT_SESSION }) {
  const cfg = config();
  if (!cfg) throw new Error('WhatsApp není napojený (chybí BEYOND_WAHA_API_KEY)');
  if (!chatId) throw new Error('Chybí cílový chat');
  if (!text || !text.trim()) throw new Error('Prázdný text');

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const res = await fetch(`${cfg.baseUrl}/api/sendText`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': cfg.apiKey,
      },
      // `text` passes through untouched. This is the whole contract.
      body: JSON.stringify({ session, chatId, text }),
      signal: ctrl.signal,
    });
    const bodyText = await res.text();
    if (!res.ok) {
      throw new Error(`WAHA ${res.status}: ${bodyText.slice(0, 300)}`);
    }
    let parsed = null;
    try {
      parsed = JSON.parse(bodyText);
    } catch {
      /* WAHA answers JSON, but a proxy might not */
    }
    return { ok: true, id: parsed?.id?._serialized || parsed?.id || null };
  } catch (err) {
    if (err?.name === 'AbortError') throw new Error('WAHA neodpověděla do 15 s');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export function invalidateWahaConfig() {
  cached = null;
}
