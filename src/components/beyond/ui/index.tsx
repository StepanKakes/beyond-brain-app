/**
 * Beyond Brain — the small set of things every screen is built from.
 *
 * Before this, each screen drew its own card, its own pill, its own avatar,
 * and they drifted apart. These are the shapes; the tokens in
 * `styles/beyond-ui.css` are the paint. Nothing here knows about tasks or
 * clients: a board, a list and a dialog all use the same pieces.
 */
import type { ReactNode } from 'react';

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

/** One column of a board: a heading that counts, a body that scrolls. */
export function Column({
  title, count, accent, children, footer, onDrop, dropActive, onDragOver, onDragLeave,
}: {
  title: ReactNode;
  count?: number;
  accent?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
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
      </header>
      <div className="bb-col__b">{children}</div>
      {footer && <div className="bb-col__f">{footer}</div>}
    </section>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="bb-empty">{children}</p>;
}

/** Tabs that switch a screen without changing the address. */
export function Tabs({ items, value, onChange }: { items: { key: string; label: string }[]; value: string; onChange: (key: string) => void }) {
  return (
    <div className="bb-tabs" role="tablist">
      {items.map((t) => (
        <button key={t.key} type="button" role="tab" aria-selected={t.key === value} className="bb-tabs__t" onClick={() => onChange(t.key)}>
          {t.label}
        </button>
      ))}
    </div>
  );
}
