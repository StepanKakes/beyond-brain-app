import { useState } from 'react';
import { motion } from 'framer-motion';
import { MessageCircle } from 'lucide-react';

import type { PermRequest } from './types';

/**
 * WhatsApp send — preview, edit, then send.
 *
 * A WAHA send request gets this instead of the generic permission panel: an
 * outbound message to a real person is worth reading (and fixing) before it
 * leaves, so the approval and the final wording happen in one step.
 */
export default function WhatsAppActionCard({
  request,
  onSend,
  onCancel,
}: {
  request: PermRequest;
  onSend: (updatedInput: Record<string, unknown>) => void;
  onCancel: () => void;
}) {
  const original = (request.input || {}) as Record<string, unknown>;
  const chatId = typeof original.chatId === 'string' ? original.chatId : '';
  const isText = request.toolName === 'mcp__waha__send-text';
  const initialText =
    typeof original.text === 'string'
      ? original.text
      : typeof original.caption === 'string'
        ? original.caption
        : '';

  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(initialText);

  const chatLabel = chatId
    ? chatId.replace(/@c\.us$/, '').replace(/@g\.us$/, ' (skupina)')
    : 'WhatsApp';

  const handleSend = () => {
    const updated: Record<string, unknown> = { ...original };
    if (isText) updated.text = text;
    else if ('caption' in original) updated.caption = text;
    onSend(updated);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: 'easeOut' }}
      className="bb-card overflow-hidden rounded-2xl"
    >
      <div className="flex items-center gap-2 border-b border-emerald-100 bg-emerald-50/60 px-5 py-3">
        <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-700">
          <MessageCircle className="h-[15px] w-[15px]" strokeWidth={1.9} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-medium uppercase tracking-wide text-emerald-700">
            WhatsApp · {isText ? 'zpráva' : request.toolName.replace('mcp__waha__send-', '')}
          </p>
          <p className="truncate text-[12px] text-beyond-faint">
            Pro: <span className="text-beyond-dim">{chatLabel}</span>
          </p>
        </div>
      </div>

      <div className="px-5 py-4">
        {editing ? (
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={Math.max(3, text.split('\n').length)}
            className="bb-field w-full resize-none rounded-[14px] px-3 py-2 text-[14px] leading-relaxed"
            autoFocus
          />
        ) : (
          <div className="rounded-[18px] rounded-bl-[6px] bg-emerald-50 px-4 py-3">
            <p className="whitespace-pre-line text-[14px] leading-relaxed text-beyond-ink">
              {text || <span className="italic text-beyond-faint">(prázdné)</span>}
            </p>
          </div>
        )}
      </div>

      <div className="flex items-center justify-end gap-2 bb-card__foot px-5 py-3">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-full px-3 py-1.5 text-[12px] bb-btn-ghost transition-colors"
        >
          Zrušit
        </button>
        <button
          type="button"
          onClick={() => setEditing((v) => !v)}
          className="bb-btn-soft rounded-full px-3.5 py-1.5 text-[12px] font-medium"
        >
          {editing ? 'Hotovo' : 'Upravit'}
        </button>
        <button
          type="button"
          onClick={handleSend}
          disabled={!text.trim()}
          className="rounded-full bg-emerald-500 px-4 py-1.5 text-[12px] font-medium text-white shadow-[0_2px_8px_-2px_rgba(16,185,129,0.4)] transition-all hover:bg-emerald-600 hover:shadow-[0_4px_12px_-2px_rgba(16,185,129,0.5)] disabled:bg-black/[0.08] disabled:text-black/30 disabled:shadow-none"
        >
          Odeslat
        </button>
      </div>
    </motion.div>
  );
}
