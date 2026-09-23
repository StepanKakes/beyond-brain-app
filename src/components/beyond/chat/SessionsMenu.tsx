import { motion } from 'framer-motion';
import { Check, MessagesSquare, Plus, Trash2 } from '../icons';

import type { BeyondSession } from '../beyondSessionsApi';
import { relativeTime } from './format';

/**
 * Per-client sessions dropdown — start a new chat or resume an earlier one.
 *
 * Deleting only drops the session from the index; the transcript stays on disk,
 * which the confirm dialog says out loud.
 */
export default function SessionsMenu({
  sessions,
  activeUuid,
  onPick,
  onDelete,
  onNew,
  onClose,
}: {
  sessions: BeyondSession[];
  activeUuid: string | null;
  onPick: (uuid: string) => void;
  onDelete: (uuid: string) => void;
  onNew: () => void;
  onClose: () => void;
}) {
  return (
    <>
      <div className="fixed inset-0 z-30" onClick={onClose} aria-hidden="true" />
      <motion.div
        initial={{ opacity: 0, y: -4, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -4, scale: 0.98 }}
        transition={{ duration: 0.16, ease: 'easeOut' }}
        className="bb-glass absolute left-3 right-3 top-full z-40 mt-2 overflow-hidden rounded-2xl"
        style={{ boxShadow: 'var(--bb-shadow-pop), inset 0 1px 0 0 var(--bb-rim)' }}
      >
        <button
          type="button"
          onClick={onNew}
          className="flex w-full items-center gap-2.5 px-4 py-3 text-left transition-colors hover:bg-[var(--bb-panel2)]"
        >
          <div
            className="flex h-7 w-7 items-center justify-center rounded-full"
            style={{ background: 'var(--bb-accent)', color: 'var(--bb-on-accent)' }}
          >
            <Plus className="h-[14px] w-[14px]" strokeWidth={2} />
          </div>
          <span className="text-[13px] font-medium text-beyond-ink">Nový chat</span>
        </button>

        <div
          className="max-h-[60vh] overflow-y-auto"
          style={{ borderTop: '1px solid var(--bb-line2)' }}
        >
          {sessions.length === 0 ? (
            <p className="px-4 py-4 text-[12px] text-beyond-faint">Žádné dřívější chaty.</p>
          ) : (
            <div className="flex flex-col py-1">
              <p className="px-4 py-1.5 text-[10px] uppercase tracking-wider text-beyond-faint">
                Historie ({sessions.length})
              </p>
              {sessions.map((s) => {
                const active = s.uuid === activeUuid;
                return (
                  <div
                    key={s.uuid}
                    className={`group flex items-start gap-2 px-3 py-2 transition-colors ${active ? 'bg-beyond-ink/[0.03]' : 'hover:bg-beyond-ink/[0.025]'}`}
                  >
                    <button
                      type="button"
                      onClick={() => onPick(s.uuid)}
                      className="flex min-w-0 flex-1 items-start gap-2 text-left"
                    >
                      <div className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center text-beyond-faint">
                        {active ? (
                          <Check className="h-[12px] w-[12px] text-beyond-ink" strokeWidth={2.2} />
                        ) : (
                          <MessagesSquare className="h-[12px] w-[12px]" strokeWidth={1.8} />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p
                          className={`truncate text-[13px] leading-tight ${active ? 'font-medium text-beyond-ink' : 'text-beyond-dim'}`}
                        >
                          {s.title}
                        </p>
                        <p className="mt-0.5 text-[10px] text-beyond-faint">
                          {relativeTime(s.lastUsedAt)}
                        </p>
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (
                          window.confirm(
                            `Smazat chat „${s.title}" z indexu?\n(transkript na disku zůstane.)`,
                          )
                        ) {
                          onDelete(s.uuid);
                        }
                      }}
                      title="Odebrat z indexu"
                      className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-beyond-faint opacity-0 transition-all hover:bg-red-50 hover:text-red-500 group-hover:opacity-100"
                    >
                      <Trash2 className="h-[12px] w-[12px]" strokeWidth={1.8} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </motion.div>
    </>
  );
}
