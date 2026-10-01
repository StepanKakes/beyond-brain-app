import { Terminal, Puzzle, Sparkles } from './icons';
import { commandKindLabel, type BeyondSlashCommand } from './beyondCommands';
import GlideMenu from './bits/GlideMenu';

/**
 * Beyond Brain — slash-command autocomplete popover.
 *
 * Floats above the composer while a slash command is being typed, as the
 * React Bits PromptBar command menu: the highlight glides to the row the
 * keyboard (useBeyondSlashCommands) or the pointer is on. Rows pick on
 * mousedown so the textarea keeps focus.
 */

function KindIcon({ kind }: { kind: BeyondSlashCommand['kind'] }) {
  if (kind === 'custom') return <Puzzle size={15} />;
  if (kind === 'skill') return <Sparkles size={15} />;
  return <Terminal size={15} />;
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
    <GlideMenu
      label="Příkazy"
      items={items.map((cmd) => ({
        key: cmd.name,
        name: cmd.name,
        description: cmd.description,
        tag: commandKindLabel(cmd.kind),
        icon: <KindIcon kind={cmd.kind} />,
        mono: true,
      }))}
      active={activeIndex}
      onHover={onHover}
      onPick={(_, i) => onSelect(items[i])}
    />
  );
}
