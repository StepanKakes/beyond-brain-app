import { motion } from 'framer-motion';
import { Trash2 } from '../icons';

/**
 * Permissions sheet — list and revoke the saved allowlist entries that let the
 * agent run a tool without asking.
 */
export default function PermissionsSheet({
  entries,
  onRemove,
  onClose,
}: {
  entries: string[];
  onRemove: (entry: string) => void;
  onClose: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 12, scale: 0.98 }}
        transition={{ duration: 0.22, ease: 'easeOut' }}
        className="bb-card w-full max-w-[480px] overflow-hidden rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4" style={{ borderBottom: '1px solid var(--bb-line2)' }}>
          <h3 className="text-[15px] font-medium text-beyond-ink">Povolené nástroje</h3>
          <p className="mt-0.5 text-[12px] text-beyond-faint">
            Agent může používat tyto nástroje bez ptaní. Hvězdička (`*`) značí celý MCP server.
          </p>
        </div>

        <div className="max-h-[360px] overflow-y-auto px-3 py-2">
          {entries.length === 0 ? (
            <p className="px-3 py-6 text-center text-[13px] text-beyond-faint">
              Žádné uložené povolení. Když agent zažádá o nástroj, vyber „Vždy povolit".
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {entries.map((entry) => (
                <li
                  key={entry}
                  className="group flex items-center gap-2 rounded-[12px] px-3 py-2 hover:bg-beyond-ink/[0.03]"
                >
                  <code className="flex-1 truncate font-mono text-[12.5px] text-beyond-ink">
                    {entry}
                  </code>
                  <button
                    type="button"
                    onClick={() => onRemove(entry)}
                    title="Odebrat"
                    className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-beyond-faint opacity-0 transition-all hover:bg-red-50 hover:text-red-500 group-hover:opacity-100"
                  >
                    <Trash2 className="h-[14px] w-[14px]" strokeWidth={1.8} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="bb-card__foot flex items-center justify-end gap-2 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="bb-btn-soft rounded-full px-3.5 py-1.5 text-[12px] font-medium"
          >
            Hotovo
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
