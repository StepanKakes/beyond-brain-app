/**
 * Beyond Brain — the small set of things every screen is built from.
 *
 * Before this, each screen drew its own card, its own pill, its own avatar,
 * and they drifted apart. These are the shapes; the tokens in
 * `styles/beyond-ui.css` are the paint. Nothing here knows about tasks or
 * clients: a board, a list and a dialog all use the same pieces.
 */
import type { ReactElement, ReactNode } from 'react';

import { Plus } from '../icons';
import RubberSegment from '../bits/RubberSegment';
import SquishSwitch from '../bits/SquishSwitch';
import HoldButton from '../bits/HoldButton';
import WarmTooltip from '../bits/WarmTooltip';

type Tone = 'plain' | 'urgent' | 'watch' | 'work' | 'done' | 'p1' | 'p2' | 'p3' | 'p4';

/** A raised surface. `onClick` makes the whole thing the target, not its text. */
export function Card({
  children, onClick, className = '', dragging, title, ...rest
}: {
  children: ReactNode;
  onClick?: () => void;
  className?: string;
  dragging?: boolean;
  title?: string;
} & Omit<React.HTMLAttributes<HTMLDivElement>, 'onClick' | 'title'>) {
  const cls = `bb-c${onClick ? ' bb-c--act' : ''}${dragging ? ' bb-c--drag' : ''} ${className}`.trim();
  if (!onClick) return <div className={cls} title={title} {...rest}>{children}</div>;
  return (
    <div
      className={cls}
      role="button"
      tabIndex={0}
      title={title}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
      {...rest}
    >
      {children}
    </div>
  );
}

/** A small label with an icon: priority, due date, state, client. */
export function Chip({ icon, children, tone = 'plain', title }: { icon?: ReactNode; children: ReactNode; tone?: Tone; title?: string }) {
  return (
    <span className="bb-chip" data-tone={tone} title={title}>
      {icon}
      <span>{children}</span>
    </span>
  );
}

/** A person, by their picture when there is one and their initials when not. */
export function Avatar({ name, src, size = 24, dim }: { name: string; src?: string | null; size?: number; dim?: boolean }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() || '').join('') || '?';
  return (
    <span className="bb-av" style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }} data-dim={dim ? 'true' : undefined} title={name}>
      {src ? <img src={src} alt="" onError={(e) => { e.currentTarget.style.display = 'none'; }} /> : null}
      <i>{initials}</i>
    </span>
  );
}

/**
 * One column of a board: a heading that counts, a body that scrolls, and a
 * quiet row at the bottom for adding to it.
 */
export function Column({
  title, count, accent, children, onAdd, addLabel = 'Přidat', onDrop, dropActive, onDragOver, onDragLeave,
}: {
  title: ReactNode;
  count?: number;
  accent?: ReactNode;
  children: ReactNode;
  onAdd?: () => void;
  addLabel?: string;
  onDrop?: (e: React.DragEvent) => void;
  dropActive?: boolean;
  onDragOver?: (e: React.DragEvent) => void;
  onDragLeave?: (e: React.DragEvent) => void;
}) {
  return (
    <section className="bb-col" data-over={dropActive ? 'true' : undefined} onDrop={onDrop} onDragOver={onDragOver} onDragLeave={onDragLeave}>
      <header className="bb-col__h">
        {accent}
        <h3>{title}</h3>
        {count != null && <span className="bb-col__n">{count}</span>}
        {onAdd && (
          <button type="button" className="bb-col__add" onClick={onAdd} aria-label={addLabel} title={addLabel}>
            <Plus size={14} />
          </button>
        )}
      </header>
      <div className="bb-col__b">{children}</div>
      {onAdd && (
        <button type="button" className="bb-col__f" onClick={onAdd}>
          <Plus size={14} />
          <span>{addLabel}</span>
        </button>
      )}
    </section>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="bb-empty">{children}</p>;
}

/** Tabs that switch a screen without changing the address: React Bits
 *  RubberSegment, the thumb stretches toward where it is going and can be
 *  dragged across. */
export function Tabs({
  items,
  value,
  onChange,
  label = 'Přepnout zobrazení',
}: {
  items: { key: string; label: ReactNode }[];
  value: string;
  onChange: (key: string) => void;
  label?: string;
}) {
  return (
    <RubberSegment
      className="bb-rubber"
      aria-label={label}
      items={items.map((t) => ({ value: t.key, label: t.label }))}
      value={value}
      onChange={(next) => onChange(next)}
      trackColor="var(--bb-bg2)"
      thumbColor="var(--bb-raise)"
      radius={999}
      size="md"
      equalSlots={false}
    />
  );
}

/** An on/off switch: React Bits SquishSwitch, the thumb stretches as it
 *  travels and can be dragged. */
export function Switch({ on, onChange, label }: { on: boolean; onChange: (next: boolean) => void; label: string }) {
  return (
    <SquishSwitch
      checked={on}
      onChange={onChange}
      ariaLabel={label}
      width={40}
      height={24}
      radius={12}
      trackColor="var(--bb-line)"
      trackOnColor="var(--bb-accent)"
      thumbColor="var(--bb-raise)"
      thumbOnColor="var(--bb-on-accent)"
    />
  );
}

/** Sending something to a real person: React Bits HoldButton. The button
 *  fills while held and fires only when full, so a stray click sends nothing;
 *  a plain click explains that through `onTap`. */
export function HoldToSend({
  children,
  doneLabel = 'Odesláno',
  onSend,
  onTap,
  disabled,
  icon,
}: {
  children: ReactNode;
  doneLabel?: ReactNode;
  onSend: () => void;
  onTap?: () => void;
  disabled?: boolean;
  icon?: ReactNode;
}) {
  return (
    <HoldButton
      className="bb-hold"
      size="sm"
      radius={999}
      holdTime={900}
      resetAfter={1600}
      wave={false}
      glow={false}
      icon={icon}
      doneLabel={doneLabel}
      disabled={disabled}
      onHold={onSend}
      onTap={onTap}
    >
      {children}
    </HoldButton>
  );
}

/** A label for an icon button: React Bits WarmTooltip. Inside a `TipGroup`,
 *  once one tip has shown the next one appears without the wait. */
export function Tip({
  label,
  side = 'bottom',
  children,
}: {
  label: ReactNode;
  side?: 'top' | 'bottom' | 'left' | 'right';
  children: ReactElement<Record<string, unknown>>;
}) {
  return (
    <WarmTooltip content={label} side={side} size="sm" delay={450}>
      {children}
    </WarmTooltip>
  );
}

export { WarmTooltipGroup as TipGroup } from '../bits/WarmTooltip';
