import { Terminal, Puzzle, Sparkles } from './icons';
import { commandKindLabel, type BeyondSlashCommand } from './beyondCommands';

/**
 * Beyond Brain — slash-command autocomplete popover.
 *
 * Floats above the composer while a slash command is being typed. Selection is
 * driven by keyboard (handled in useBeyondSlashCommands) or click; we use
 * onMouseDown + preventDefault so picking an item doesn't blur the textarea
 * first. Styled to match the glass sheet look.
 */

function KindIcon({ kind }: { kind: BeyondSlashCommand['kind'] }) {
  const cls = 'h-[14px] w-[14px] text-beyond-faint';
  if (kind === 'custom') return <Puzzle className={cls} strokeWidth={1.8} />;
  if (kind === 'skill') return <Sparkles className={cls} strokeWidth={1.8} />;
  return <Terminal className={cls} strokeWidth={1.8} />;
}

export default function BeyondSlashMenu({
  items,
  activeIndex,
  onHover,
  onSelect,
}: {
  items: BeyondSlashCommand[];
  activeIndex: number;
  onHover: (index: number) => void;
  onSelect: (cmd: BeyondSlashCommand) => void;
}) {
  if (items.length === 0) return null;

  return (
    <div className="bb-sheet absolute inset-x-2 bottom-full z-40 mb-2 max-h-[300px] overflow-y-auto rounded-[16px] border border-beyond-ink/[0.07] p-1.5 shadow-lg">
      <div className="px-2.5 py-1 text-[11px] font-medium uppercase tracking-wide text-beyond-faint">
        Příkazy
      </div>
      {items.map((cmd, i) => (
        <button
          key={cmd.name}
          type="button"
          onMouseEnter={() => onHover(i)}
          onMouseDown={(e) => {
            e.preventDefault();
            onSelect(cmd);
          }}
          className={`flex w-full items-center gap-2.5 rounded-[11px] px-2.5 py-2 text-left transition-colors ${
            i === activeIndex ? 'bg-beyond-ink/[0.06]' : 'hover:bg-beyond-ink/[0.03]'
          }`}
        >
          <KindIcon kind={cmd.kind} />
          <span className="font-mono text-[13px] font-medium text-beyond-ink">{cmd.name}</span>
          <span className="min-w-0 flex-1 truncate text-[12.5px] text-beyond-dim">{cmd.description}</span>
          <span className="flex-shrink-0 rounded-full bg-beyond-ink/[0.04] px-1.5 py-0.5 text-[10px] text-beyond-faint">
            {commandKindLabel(cmd.kind)}
          </span>
        </button>
      ))}
    </div>
  );
}
