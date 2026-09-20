/**
 * Beyond Brain — the Telegram bot, in the app.
 *
 * Until now a message to the bot went Telegram → n8n → this app → n8n →
 * Telegram, with n8n doing nothing but forwarding and transcribing voice.
 * Long polling here removes the middle: the app asks Telegram for updates,
 * hands each message to `askAgent`, and the answer goes back the same way
 * the progress already did.
 *
 * Opt-in with `BEYOND_TG_POLLING=1`, because it is exclusive: Telegram lets a
 * bot have a webhook or polling, not both. Turning this on deletes the
 * webhook n8n set, which is the switch-over, so it should be deliberate.
 *
 * Voice: the brain ships a whisper script (`system/scripts/transcribe-voice.*`)
 * that takes a URL and prints text; that is tried first. `OPENAI_API_KEY`
 * is the fallback. Neither → the bot says it cannot hear.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { getConnection } from '../modules/database/connection.js';
import { resolveBrainPath } from '../utils/brain-path.js';
import { askAgent } from './beyond-agent-query.js';
import { sendTo } from './beyond-telegram.js';

const execFileAsync = promisify(execFile);
const API = 'https://api.telegram.org';
const POLL_TIMEOUT_S = 25;
const KV_SCHEMA = `CREATE TABLE IF NOT EXISTS beyond_kv (key TEXT PRIMARY KEY, value TEXT)`;

let running = false;
let stopRequested = false;
let kvReady = false;

function log(...args) {
  console.log('[tg-bot]', ...args);
}

function token() {
  const t = process.env.BEYOND_TG_BOT_TOKEN;
  return t && t.trim() ? t.trim() : null;
}

function kv() {
  const conn = getConnection();
  if (!kvReady) {
    conn.exec(KV_SCHEMA);
    kvReady = true;
  }
  return conn;
}

function getOffset() {
  const row = kv().prepare('SELECT value FROM beyond_kv WHERE key=?').get('tg_offset');
  return row ? Number(row.value) || 0 : 0;
}

function setOffset(v) {
  kv().prepare('INSERT INTO beyond_kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run('tg_offset', String(v));
}

function allowedUsers() {
  return (process.env.BEYOND_AGENT_ALLOWED_TG_USERS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

async function api(method, payload, { timeoutMs = 40_000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${API}/bot${token()}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {}),
      signal: ctrl.signal,
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || body?.ok === false) {
      const err = new Error(`Telegram ${res.status}: ${body?.description || 'neznámá chyba'}`);
      err.status = res.status;
      throw err;
    }
    return body?.result;
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------ */
/* voice                                                               */
/* ------------------------------------------------------------------ */

function localWhisperScript() {
  const dir = path.join(resolveBrainPath(), 'system', 'scripts');
  const ps1 = path.join(dir, 'transcribe-voice.ps1');
  const sh = path.join(dir, 'transcribe-voice.sh');
  if (process.platform === 'win32' && fs.existsSync(ps1)) return { kind: 'ps1', file: ps1 };
  if (process.platform !== 'win32' && fs.existsSync(sh)) return { kind: 'sh', file: sh };
  return null;
}

async function transcribe(fileUrl) {
  const script = localWhisperScript();
  if (script) {
    try {
      const args =
        script.kind === 'ps1'
          ? ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script.file, '-Source', fileUrl]
          : [script.file, fileUrl];
      const { stdout } = await execFileAsync(script.kind === 'ps1' ? 'powershell' : 'bash', args, {
        timeout: 4 * 60 * 1000,
        maxBuffer: 4 * 1024 * 1024,
      });
      const text = String(stdout || '').trim();
      if (text) return text;
    } catch (err) {
      log('lokální whisper selhal, zkouším OpenAI:', err?.message || err);
    }
  }
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('hlasovky neumím přepsat: chybí lokální whisper i OPENAI_API_KEY');
  const audio = await fetch(fileUrl);
  if (!audio.ok) throw new Error(`stažení hlasovky selhalo (${audio.status})`);
  const form = new FormData();
  form.append('file', new Blob([await audio.arrayBuffer()], { type: 'audio/ogg' }), 'voice.oga');
  form.append('model', 'whisper-1');
  form.append('language', 'cs');
  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}` },
    body: form,
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`OpenAI whisper ${res.status}: ${body?.error?.message || 'chyba'}`);
  return String(body?.text || '').trim();
}

/* ------------------------------------------------------------------ */
/* handling one update                                                 */
/* ------------------------------------------------------------------ */

async function handleMessage(msg) {
  const chatId = msg.chat?.id;
  const userId = msg.from?.id != null ? String(msg.from.id) : null;
  if (chatId == null) return;

  const allowed = allowedUsers();
  if (allowed.length && (!userId || !allowed.includes(userId))) {
    log(`odmítnuto: uživatel ${userId || '?'} není v allow listu`);
    return;
  }

  let text = typeof msg.text === 'string' ? msg.text : null;
  let source = 'telegram';

  if (!text && (msg.voice || msg.audio)) {
    source = 'voice';
    const fileId = (msg.voice || msg.audio).file_id;
    try {
      await api('sendChatAction', { chat_id: chatId, action: 'typing' });
      const file = await api('getFile', { file_id: fileId });
      const url = `${API}/file/bot${token()}/${file.file_path}`;
      text = await transcribe(url);
      if (!text) throw new Error('přepis je prázdný');
    } catch (err) {
      await sendTo(chatId, `Hlasovku jsem nerozuměl: ${err?.message || err}`);
      return;
    }
  }

  if (!text || !text.trim()) return;
  if (/^\/start\b/.test(text)) {
    await sendTo(chatId, 'Tady Beyond Brain. Piš, nebo pošli hlasovku.');
    return;
  }

  try {
    await askAgent({
      text,
      source,
      meta: { telegramChatId: String(chatId), telegramMessageId: msg.message_id, telegramUserId: userId },
      tgUser: userId,
    });
  } catch (err) {
    log('askAgent selhal', err?.message || err);
    await sendTo(chatId, `Nešlo to spustit: ${err?.message || err}`);
  }
}

/* ------------------------------------------------------------------ */
/* the loop                                                            */
/* ------------------------------------------------------------------ */

async function loop() {
  let offset = getOffset();
  let backoff = 2000;
  while (!stopRequested) {
    try {
      const updates = await api('getUpdates', { offset, timeout: POLL_TIMEOUT_S, allowed_updates: ['message'] }, { timeoutMs: (POLL_TIMEOUT_S + 15) * 1000 });
      backoff = 2000;
      for (const u of updates || []) {
        offset = u.update_id + 1;
        setOffset(offset);
        if (u.message) {
          // Not awaited: a long agent run must not block the next poll.
          handleMessage(u.message).catch((err) => log('zpracování zprávy selhalo', err?.message || err));
        }
      }
    } catch (err) {
      if (err?.name === 'AbortError') continue;
      if (err?.status === 409) {
        log('Telegram hlásí konflikt (jiný poller nebo webhook), zkouším smazat webhook');
        await api('deleteWebhook', { drop_pending_updates: false }).catch(() => {});
      } else {
        log('getUpdates selhalo:', err?.message || err);
      }
      await new Promise((r) => setTimeout(r, backoff));
      backoff = Math.min(backoff * 2, 60_000);
    }
  }
  running = false;
}

export function isBotEnabled() {
  return process.env.BEYOND_TG_POLLING === '1' && Boolean(token());
}

export async function startTelegramBot() {
  if (running) return;
  if (!token()) return;
  if (process.env.BEYOND_TG_POLLING !== '1') {
    log('vypnutý (BEYOND_TG_POLLING není 1), Telegram jde přes n8n');
    return;
  }
  running = true;
  stopRequested = false;
  try {
    // Exclusive: polling and a webhook cannot coexist. This is the switch.
    await api('deleteWebhook', { drop_pending_updates: false });
    const me = await api('getMe');
    log(`běží jako @${me?.username || '?'}, allow list: ${allowedUsers().join(', ') || 'kdokoli'}`);
  } catch (err) {
    log('start selhal:', err?.message || err);
  }
  void loop();
}

export function stopTelegramBot() {
  stopRequested = true;
}

export function telegramBotStatus() {
  return { enabled: isBotEnabled(), running };
}
