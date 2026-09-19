/**
 * Beyond Brain — live progress messages into Telegram during SDK runs.
 *
 * The HTTP /api/beyond-agent/query handler waits for the SDK to finish before
 * responding, which can take 10-60s. From the user's side that's silence.
 * This emitter pushes incremental status into Telegram by editing a single
 * message in place, so the user sees something like:
 *
 *     🟢 Začínám hned se dívat
 *     📖 Čtu ivana-jurikova/_action-items.md
 *     🔎 Hledám "flagy" v clients/aktivni
 *     ⚙️ git log --oneline
 *
 * Once the SDK finishes, n8n's workflow delivers the final answer as a
 * separate message. The status message stays as a breadcrumb of the journey.
 *
 * Calls are debounced (1500ms) so we don't hammer Telegram's edit-rate limit
 * (1 msg/s/chat). Lines past the last 8 are dropped to keep the message
 * compact and well under the 4096-char ceiling.
 */

const TELEGRAM_API = 'https://api.telegram.org';
const DEBOUNCE_MS = 1500;
const MAX_LINES = 8;
const MAX_LINE_CHARS = 80;

/** Escape the three chars Telegram's HTML parse mode treats specially.
 *  Applied to tool inputs (file paths, grep patterns, commands) before
 *  they land in a progress line — otherwise a path like `<unknown>` or a
 *  regex like `a&b` would error with "can't parse entities". */
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function snip(value, max = MAX_LINE_CHARS) {
  const s = typeof value === 'string' ? value : String(value ?? '');
  const oneLine = s.replace(/\s+/g, ' ').trim();
  const trimmed = oneLine.length <= max ? oneLine : oneLine.slice(0, max - 1) + '…';
  return escapeHtml(trimmed);
}

/** Turn an SDK `tool_use` block into a short, user-facing line. Returns null
 *  for tools the user shouldn't see (todo bookkeeping, internal helpers). */
function formatToolLine(toolName, input) {
  if (!toolName) return null;
  const inp = input && typeof input === 'object' ? input : {};
  switch (toolName) {
    case 'Read': {
      const file = inp.file_path || inp.path || '';
      const rel = file.replace(/^.*[\\/]clients[\\/]/, 'clients/').replace(/^.*[\\/]knowledge[\\/]/, 'knowledge/');
      return `📖 Čtu ${snip(rel || file)}`;
    }
    case 'Write':
      return `✍️ Píšu ${snip(inp.file_path || '')}`;
    case 'Edit':
      return `✏️ Upravuji ${snip(inp.file_path || '')}`;
    case 'NotebookEdit':
      return `✏️ Upravuji notebook ${snip(inp.notebook_path || '')}`;
    case 'Grep':
      return `🔎 Hledám ${inp.pattern ? `"${snip(inp.pattern, 40)}"` : 'v souborech'}`;
    case 'Glob':
      return `📁 Procházím ${snip(inp.pattern || 'soubory')}`;
    case 'Bash': {
      const cmd = inp.command || '';
      return `⚙️ ${snip(cmd, 60)}`;
    }
    case 'WebSearch':
      return `🌐 Vyhledávám "${snip(inp.query || '', 40)}"`;
    case 'WebFetch':
      return `🌐 Stahuji ${snip(inp.url || '', 40)}`;
    case 'Task':
      return `🤖 Spouštím subagent: ${snip(inp.subagent_type || inp.description || '', 40)}`;
    // Skip noisy bookkeeping tools the user doesn't care about:
    case 'TodoWrite':
    case 'AskUserQuestion':
    case 'ExitPlanMode':
      return null;
    default:
      // Show MCP tools by their bare suffix (e.g. mcp__waha__send_text → "🔌 send_text")
      if (toolName.startsWith('mcp__')) {
        const parts = toolName.split('__');
        return `🔌 ${parts[parts.length - 1] || toolName}`;
      }
      return `🔧 ${toolName}`;
  }
}

/**
 * Create a progress emitter for a Telegram chat. Returns `null` if either the
 * bot token or the chat id is missing — callers should treat that as "no
 * progress streaming for this run".
 *
 * @param {Object} params
 * @param {string|number} params.chatId
 * @param {string} [params.botToken] - defaults to BEYOND_TG_BOT_TOKEN env.
 * @param {string} [params.replyToMessageId] - optional Telegram message_id to
 *   reply to (keeps the status anchored under the user's prompt).
 */
export function createTelegramProgressEmitter({ chatId, botToken, replyToMessageId } = {}) {
  const token = botToken || process.env.BEYOND_TG_BOT_TOKEN;
  if (!token || !chatId) return null;

  let messageId = null;
  let lines = [];
  let lastSentText = '';
  let pendingTimer = null;
  let inFlight = null;
  let closed = false;

  async function telegram(method, body) {
    const url = `${TELEGRAM_API}/bot${token}/${method}`;
    // Default every text-bearing call to HTML parse mode. Callers can opt out
    // by passing `parse_mode: null` (e.g. retry after a parse error).
    const payload = { parse_mode: 'HTML', ...body };
    if (payload.parse_mode === null) delete payload.parse_mode;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!data.ok) {
        // 400 with "message is not modified" is harmless — same text twice.
        if (typeof data.description === 'string' && /not modified/i.test(data.description)) {
          return null;
        }
        // If HTML parsing tripped on stray entities in the text (Claude
        // produced markdown not HTML, a `<` slipped through, etc.), retry
        // once as plain text so the user at least sees the message.
        if (
          payload.parse_mode === 'HTML' &&
          typeof data.description === 'string' &&
          /can't parse entities|unsupported start tag|unmatched end tag/i.test(data.description)
        ) {
          console.warn(`[tg-progress] ${method} HTML parse failed, retrying as plain text:`, data.description);
          return telegram(method, { ...body, parse_mode: null });
        }
        console.warn(`[tg-progress] ${method} failed:`, data.description || data);
      }
      return data;
    } catch (err) {
      console.warn(`[tg-progress] ${method} threw:`, err.message);
      return null;
    }
  }

  async function flush() {
    pendingTimer = null;
    if (closed) return;
    const text = lines.join('\n');
    if (!text || text === lastSentText) return;

    // Serialize edits so we don't fire two overlapping editMessageText calls.
    if (inFlight) {
      await inFlight.catch(() => {});
    }

    inFlight = (async () => {
      if (!messageId) {
        const payload = { chat_id: chatId, text, disable_notification: true };
        if (replyToMessageId) {
          payload.reply_to_message_id = replyToMessageId;
          payload.allow_sending_without_reply = true;
        }
        const data = await telegram('sendMessage', payload);
        if (data && data.ok && data.result) {
          messageId = data.result.message_id;
          lastSentText = text;
        }
      } else {
        const data = await telegram('editMessageText', {
          chat_id: chatId,
          message_id: messageId,
          text,
        });
        if (data && (data.ok || /not modified/i.test(data.description || ''))) {
          lastSentText = text;
        }
      }
    })();

    await inFlight;
    inFlight = null;
  }

  function schedule() {
    if (closed || pendingTimer) return;
    pendingTimer = setTimeout(() => {
      flush().catch(() => {});
    }, DEBOUNCE_MS);
  }

  function pushLine(line) {
    if (closed || !line) return;
    lines.push(line);
    if (lines.length > MAX_LINES) {
      lines = lines.slice(-MAX_LINES);
    }
    schedule();
  }

  return {
    /** Send the immediate "starting" line. Call once at the top of the run. */
    start() {
      pushLine('🟢 Začínám se dívat…');
      // Send the first message right away (no debounce wait) so the user
      // gets feedback within ~500ms instead of after the debounce window.
      if (pendingTimer) clearTimeout(pendingTimer);
      pendingTimer = null;
      flush().catch(() => {});
    },
    /** Note a tool invocation. Internal/no-op tools are silently skipped. */
    toolUse(toolName, input) {
      const line = formatToolLine(toolName, input);
      if (line) pushLine(line);
    },
    /** Free-form line (use sparingly). */
    note(text) {
      pushLine(snip(text));
    },
    /** Flush any pending edits and close. Call at the end of the SDK run. */
    async finish(opts = {}) {
      if (closed) return;
      const okLine = opts.okLine !== undefined ? opts.okLine : '✅ Hotovo';
      if (okLine) pushLine(okLine);
      if (pendingTimer) {
        clearTimeout(pendingTimer);
        pendingTimer = null;
      }
      await flush();
      closed = true;
    },
    /** Replace the running progress message with the SDK's final answer.
     *  When the BB process owns delivery (async mode), the n8n workflow
     *  stops posting the response body to Telegram, so we deliver it here.
     *  Edits the existing progress message in-place when possible so the
     *  user sees one coherent thread: status lines → final answer. */
    async finalAnswer(text) {
      if (closed) return;
      const body = typeof text === 'string' ? text.trim() : '';
      if (!body) {
        // No answer to deliver — fall back to a quiet checkmark so the user
        // at least knows the run ended without a hard error.
        await this.finish({ okLine: '✅ Hotovo (prázdná odpověď)' });
        return;
      }
      // Telegram caps messages at 4096 chars. Trim with a clear marker.
      const MAX = 4096;
      const trimmed = body.length > MAX ? body.slice(0, MAX - 12) + '\n…(zkráceno)' : body;
      // Cancel any pending debounced edits — we're about to replace the
      // whole message anyway.
      if (pendingTimer) {
        clearTimeout(pendingTimer);
        pendingTimer = null;
      }
      // Wait for any in-flight edit to land so we don't race it.
      if (inFlight) {
        await inFlight.catch(() => {});
      }
      if (messageId) {
        await telegram('editMessageText', {
          chat_id: chatId,
          message_id: messageId,
          text: trimmed,
        });
      } else {
        // No progress message was sent (e.g. SDK answered in <DEBOUNCE_MS
        // with zero tool calls) — send the answer as a fresh message.
        const payload = { chat_id: chatId, text: trimmed };
        if (replyToMessageId) {
          payload.reply_to_message_id = replyToMessageId;
          payload.allow_sending_without_reply = true;
        }
        const data = await telegram('sendMessage', payload);
        if (data && data.ok && data.result) messageId = data.result.message_id;
      }
      lastSentText = trimmed;
      closed = true;
    },
    get messageId() {
      return messageId;
    },
  };
}
