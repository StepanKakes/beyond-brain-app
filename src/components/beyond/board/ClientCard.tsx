/**
 * One client as a card on the pipeline board.
 *
 * What a person asks at a glance is: how far in are they, what is wrong, and
 * when do we speak next. That is the whole card, in that order.
 */
import { AlertTriangle, AlertCircle, CalendarClock, Hand } from '../icons';

import { Card, Chip } from '../ui';
import type { BoardClient } from './api';

function weekLabel(c: BoardClient): string | null {
  if (!c.programWeek) return null;
  return c.totalWeeks ? `Týden ${c.programWeek} z ${c.totalWeeks}` : `Týden ${c.programWeek}`;
}

export function ClientCard({
  client, onOpen, onDragStart, onDragEnd, dragging,
}: {
  client: BoardClient;
  onOpen: () => void;
  onDragStart?: (e: React.DragEvent) => void;
  onDragEnd?: () => void;
  dragging?: boolean;
}) {
  const top = client.signals?.[0] || null;
  const next = client.nextCall
    ? new Date(client.nextCall.startIso).toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric' })
    : null;
  const pct = client.programWeek && client.totalWeeks
    ? Math.max(0, Math.min(100, Math.round((client.programWeek / client.totalWeeks) * 100)))
    : null;
  return (
    <Card onClick={onOpen} dragging={dragging} draggable onDragStart={onDragStart} onDragEnd={onDragEnd} className="bb-cc">
      <div className="bb-cc__top">
        <p className="bb-cc__n">{client.name}</p>
        {client.manual && <Hand size={12} className="bb-cc__hand" aria-label="Přesunuto ručně" />}
      </div>
      {weekLabel(client) && (
        <div className="bb-cc__wk">
          <span>{weekLabel(client)}</span>
          {pct != null && <i><b style={{ width: `${pct}%` }} /></i>}
        </div>
      )}
      {top && <p className="bb-cc__sig">{top.title}</p>}
      <div className="bb-cc__meta">
        {client.ownCounts.critical > 0 && (
          <Chip icon={<AlertTriangle size={12} />} tone="urgent">{client.ownCounts.critical}</Chip>
        )}
        {client.ownCounts.watch > 0 && (
          <Chip icon={<AlertCircle size={12} />} tone="watch">{client.ownCounts.watch}</Chip>
        )}
        {next && <Chip icon={<CalendarClock size={12} />}>{next}</Chip>}
        {client.openOurs > 0 && <Chip title="Co dlužíme my">Dlužíme {client.openOurs}</Chip>}
      </div>
    </Card>
  );
}
