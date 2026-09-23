/**
 * One task as a card on the board.
 *
 * The whole card is the target: clicking anywhere but the circle opens the
 * task. Nothing is underlined, and the state lives in the circle on the left
 * the way a to-do list does it, not in a row of buttons.
 */
import { Flag, Calendar, Sparkles } from 'lucide-react';

import { Card, Chip, Avatar } from '../ui';
import type { Task } from '../velin/api';

const PRIORITY_LABEL: Record<number, string> = { 1: 'Nejvyšší', 2: 'Vysoká', 3: 'Střední', 4: 'Nízká' };

export function TaskCard({
  task, onOpen, onToggle, onDragStart, onDragEnd, dragging,
}: {
  task: Task;
  onOpen: () => void;
  onToggle: (next: Task['state']) => void;
  onDragStart?: (e: React.DragEvent) => void;
  onDragEnd?: () => void;
  dragging?: boolean;
}) {
  const done = task.state === 'done';
  return (
    <Card onClick={onOpen} dragging={dragging} draggable={!task.virtual} onDragStart={onDragStart} onDragEnd={onDragEnd} className="bb-tc">
      <div className="bb-tc__top">
        <button
          type="button"
          className={`bb-tc__chk bb-tc__chk--p${task.priority}${task.state !== 'none' ? ` bb-tc__chk--${task.state}` : ''}`}
          aria-label={done ? 'Vrátit' : 'Hotovo'}
          title={done ? 'Vrátit' : 'Levým hotovo, pravým pracuje se'}
          onClick={(e) => { e.stopPropagation(); onToggle(done ? 'none' : 'done'); }}
          onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onToggle(task.state === 'work' ? 'none' : 'work'); }}
        />
        <p className={`bb-tc__t${done ? ' bb-tc__t--done' : ''}`}>{task.text}</p>
      </div>
      {(task.client || task.note) && (
        <p className="bb-tc__sub">{task.client ? task.client.name : task.note}</p>
      )}
      <div className="bb-tc__meta">
        {task.priority <= 2 && (
          <Chip icon={<Flag size={12} strokeWidth={2} />} tone={task.priority === 1 ? 'p1' : 'p2'}>{PRIORITY_LABEL[task.priority]}</Chip>
        )}
        {task.dueLabel && (
          <Chip icon={<Calendar size={12} strokeWidth={1.9} />} tone={task.dueKind === 'over' ? 'urgent' : task.dueKind === 'today' ? 'watch' : 'plain'}>{task.dueLabel}</Chip>
        )}
        {task.state === 'work' && <Chip tone="work">Dělá se</Chip>}
        {task.prep && <Chip icon={<Sparkles size={12} strokeWidth={1.9} />}>{task.prep.kind === 'zprava' ? 'Zpráva' : 'Podklad'}</Chip>}
      </div>
    </Card>
  );
}

/** A person's head at the top of their column. */
export function PersonHead({ person, me }: { person: { key: string; displayName: string; avatar?: string }; me: string }) {
  return <Avatar name={person.displayName} src={person.avatar} size={22} dim={person.key !== me} />;
}
