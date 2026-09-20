/**
 * Beyond Brain — sending a message to our own Telegram.
 *
 * The same contract as the WhatsApp sender: a chat id and a string go on the
 * wire unchanged. This is how the morning brief and the pre-call reminder
 * actually arrive, rather than only being written into the brain and hoping
 * someone opens it.
 *
 * Targets come from the people roster (`tgChatId`), with `BEYOND_TG_CHAT_ID` as
 * a shared fallback for a group both of them are in. Without a token or a chat
 * id nothing is sent and the caller is told so, because a brief that silently
 * goes nowhere is worse than no brief.
 */
import { getPeople } from './beyond-people.js';

const API = 'https://api.telegram.org';
/** Telegram rejects anything longer; split rather than truncate. */
const MAX_CHARS = 4000;

function token() {
  const t = process.env.BEYOND_TG_BOT_TOKEN;
  return t && t.trim() ? t.trim() : null;
}

/** Everyone we can reach. A person without a chat id is simply skipped. */
export function recipients() {
  const shared = process.env.BEYOND_TG_CHAT_ID;
  if (shared && shared.trim()) {
    return [{ key: 'shared', displayName: 'společný chat', chatId: shared.trim() }];
  }
  return getPeople()
    .filter((p) => p.tgChatId)
    .map((p) => ({ key: p.key, displayName: p.displayName, chatId: String(p.tgChatId) }));
}

export function isConfigured() {
  return Boolean(token()) && recipients().length > 0;
}

/** Why it cannot send, in words a person can act on. */
export function unconfiguredReason() {
  if (!token()) return 'chybí BEYOND_TG_BOT_TOKEN';
  if (!recipients().length) return 'chybí BEYOND_TG_CHAT_ID (nebo tgChatId v BEYOND_PEOPLE)';
  return null;
}

function chunk(text) {
  if (text.length <= MAX_CHARS) return [text];
  const parts = [];
  let rest = text;
  while (rest.length > MAX_CHARS) {
    // Break on a line end so a message never splits mid-sentence.
    const cut = rest.lastIndexOf('\n', MAX_CHARS);
    const at = cut > MAX_CHARS * 0.5 ? cut : MAX_CHARS;
    parts.push(rest.slice(0, at));
    rest = rest.slice(at).trimStart();
  }
  if (rest) parts.push(rest);
  return parts;
}

async function post(method, payload) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const res = await fetch(`${API}/bot${token()}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || body?.ok === false) {
      throw new Error(`Telegram ${res.status}: ${body?.description || 'neznámá chyba'}`);
    }
    return body?.result || null;
  } catch (err) {
    if (err?.name === 'AbortError') throw new Error('Telegram neodpověděl do 15 s');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Deliver to everyone on the roster. Returns who got it; a failure for one
 * recipient does not stop the others, because a brief that reached one of two
 * people is still worth more than an exception.
 */
export async function broadcast(text) {
  const reason = unconfiguredReason();
  if (reason) return { sent: [], skipped: reason };
  if (!text || !text.trim()) return { sent: [], skipped: 'prázdný text' };

  const sent = [];
  const failed = [];
  for (const r of recipients()) {
    try {
      for (const part of chunk(text.trim())) {
        await post('sendMessage', {
          chat_id: r.chatId,
          text: part,
          disable_web_page_preview: true,
        });
      }
      sent.push(r.displayName);
    } catch (err) {
      failed.push(`${r.displayName}: ${err?.message || err}`);
    }
  }
  return { sent, failed, skipped: null };
}
