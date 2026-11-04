import {
  Suspense,
  lazy,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';

import { Icon, type IconName } from './icons';
import { back } from './router';

const MarkdownBody = lazy(() => import('./Markdown'));

/** Dokud se Markdown nedonačte, je vidět prostý text, nic neproblikne prázdné. */
export function Markdown({ text }: { text: string }) {
  return (
    <Suspense fallback={<div className="m-md m-md-plain">{text}</div>}>
      <MarkdownBody text={text} />
    </Suspense>
  );
}

/** Kolik bodů odjede velký nadpis, než ho nahradí titulek v liště. */
const COLLAPSE_AT = 40;

/** Obrazovka tabu: velký nadpis, který při scrollu přejde do malého v liště. */
export function TabScreen({
  title,
  subtitle,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  const [scrolled, setScrolled] = useState(false);
  return (
    <div
      className="m-scroll m-tabscreen"
      onScroll={(event) => setScrolled(event.currentTarget.scrollTop > COLLAPSE_AT)}
    >
      <header className={`m-bar m-bar-collapsing${scrolled ? ' is-scrolled' : ''}`}>
        <div className="m-bar-title" title={title}>
          {title}
        </div>
        <div className="m-bar-action">{action}</div>
      </header>
      <div className="m-large">
        <h1>{title}</h1>
        {subtitle ? <p>{subtitle}</p> : null}
      </div>
      {children}
    </div>
  );
}

/** Lišta vnořené obrazovky se šipkou zpět. */
export function PushedBar({ title, sub, action }: { title: string; sub?: ReactNode; action?: ReactNode }) {
  return (
    <header className="m-bar m-bar-pushed">
      <button type="button" className="m-icon-btn m-bar-back" aria-label="Zpět" onClick={() => back()}>
        <Icon name="back" size={22} />
      </button>
      <div className="m-bar-title" title={title}>
        <span className="m-bar-title-text">{title}</span>
        {sub}
      </div>
      <div className="m-bar-action">{action}</div>
    </header>
  );
}

export function Section({
  title,
  tone,
  children,
}: {
  title?: string;
  tone?: 'danger';
  children: ReactNode;
}) {
  return (
    <section className="m-section">
      {title ? <h2 className={tone === 'danger' ? 'is-danger' : undefined}>{title}</h2> : null}
      <div className="m-group">{children}</div>
    </section>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="m-empty">
      <strong>{title}</strong>
      {children ? <p>{children}</p> : null}
    </div>
  );
}

const EASE = 'cubic-bezier(.32,.72,0,1)';

/**
 * Spodní list. Tažením dolů se zavírá a pohyb sleduje prst. Obsah se scrolluje
 * nativně, list se táhne jen za úchyt nebo když je obsah nahoře.
 */
export function Sheet({
  title,
  onClose,
  dismissable = true,
  children,
}: {
  title?: string;
  onClose: () => void;
  dismissable?: boolean;
  children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const scrim = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const closing = useRef(false);

  useLayoutEffect(() => {
    panel.current?.animate([{ transform: 'translate3d(0,100%,0)' }, { transform: 'none' }], {
      duration: 420,
      easing: EASE,
    });
    scrim.current?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300 });
  }, []);

  const close = (from = 0) => {
    if (closing.current) return;
    closing.current = true;
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      onClose();
    };
    const el = panel.current;
    if (!el) return finish();
    const height = el.getBoundingClientRect().height;
    scrim.current?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 260, fill: 'forwards' });
    el.animate([{ transform: `translate3d(0,${from}px,0)` }, { transform: `translate3d(0,${height}px,0)` }], {
      duration: 280,
      easing: EASE,
      fill: 'forwards',
    }).finished.then(finish, finish);
    // Skrytá stránka animaci nedokončí a list by zůstal viset.
    setTimeout(finish, 360);
  };

  const drag = useRef<{ y: number; last: number; t: number; speed: number } | null>(null);
  const onStart = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dismissable) return;
    if ((body.current?.scrollTop ?? 0) > 0) return;
    drag.current = { y: event.clientY, last: event.clientY, t: event.timeStamp, speed: 0 };
  };
  const onMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    if (!state || !panel.current) return;
    const dy = event.clientY - state.y;
    if (dy <= 0) {
      panel.current.style.transform = '';
      return;
    }
    state.speed = (event.clientY - state.last) / Math.max(1, event.timeStamp - state.t);
    state.last = event.clientY;
    state.t = event.timeStamp;
    panel.current.style.transform = `translate3d(0,${dy}px,0)`;
  };
  const onEnd = () => {
    const state = drag.current;
    drag.current = null;
    const el = panel.current;
    if (!state || !el) return;
    const dy = Math.max(0, state.last - state.y);
    if (dy > 110 || state.speed > 0.6) {
      el.style.transform = '';
      close(dy);
    } else if (dy > 0) {
      el.style.transform = '';
      el.animate([{ transform: `translate3d(0,${dy}px,0)` }, { transform: 'none' }], {
        duration: 300,
        easing: EASE,
      });
    }
  };

  return (
    <div className="m-sheet-root">
      <div ref={scrim} className="m-scrim" onClick={() => dismissable && close()} />
      <div
        ref={panel}
        className="m-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onPointerDown={onStart}
        onPointerMove={onMove}
        onPointerUp={onEnd}
        onPointerCancel={onEnd}
      >
        <div className="m-sheet-grab" aria-hidden="true" />
        {title ? <h3 className="m-sheet-title">{title}</h3> : null}
        <div ref={body} className="m-sheet-body">
          {children}
        </div>
      </div>
    </div>
  );
}

/**
 * Tlačítko na podržení. Používá se tam, kde se něco odesílá skutečnému člověku,
 * aby to nešlo spustit náhodným klepnutím při scrollu.
 */
export function HoldButton({
  label,
  busy,
  disabled,
  onConfirm,
}: {
  label: string;
  busy?: boolean;
  disabled?: boolean;
  onConfirm: () => void;
}) {
  const fill = useRef<HTMLSpanElement>(null);
  const animation = useRef<Animation | null>(null);

  const start = () => {
    if (busy || disabled || !fill.current) return;
    animation.current?.cancel();
    const running = fill.current.animate([{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], {
      duration: 750,
      easing: 'linear',
      fill: 'forwards',
    });
    animation.current = running;
    running.finished.then(
      () => {
        animation.current = null;
        running.cancel();
        onConfirm();
      },
      () => undefined,
    );
  };
  const cancel = () => {
    animation.current?.cancel();
    animation.current = null;
  };

  return (
    <button
      type="button"
      className="m-hold"
      disabled={disabled || busy}
      onPointerDown={start}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
      onContextMenu={(event) => event.preventDefault()}
    >
      <span ref={fill} className="m-hold-fill" aria-hidden="true" />
      <span className="m-hold-label">{busy ? 'Odesílám' : label}</span>
    </button>
  );
}

type ToastDetail = { text: string; action?: { label: string; run: () => void }; ms?: number };

// Krátké hlášky nahoře, případně s akcí Vrátit.
export function toast(text: string, action?: ToastDetail['action'], ms?: number): void {
  window.dispatchEvent(new CustomEvent<ToastDetail>('m-toast', { detail: { text, action, ms } }));
}

export function ToastHost() {
  const [item, setItem] = useState<ToastDetail | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const show = (event: Event) => {
      const detail = (event as CustomEvent<ToastDetail>).detail;
      setItem(detail);
      clearTimeout(timer);
      timer = setTimeout(() => setItem(null), detail.ms ?? 3200);
    };
    window.addEventListener('m-toast', show);
    return () => {
      window.removeEventListener('m-toast', show);
      clearTimeout(timer);
    };
  }, []);
  if (!item) return null;
  return (
    <div className="m-toast" role="status">
      <span>{item.text}</span>
      {item.action ? (
        <button
          type="button"
          onClick={() => {
            item.action?.run();
            setItem(null);
          }}
        >
          {item.action.label}
        </button>
      ) : null}
    </div>
  );
}

/**
 * Smazání s možností si to rozmyslet: z obrazovky zmizí hned, na server jde,
 * až když se během pár vteřin nevrátí.
 */
export function deleteWithUndo({
  text,
  hide,
  restore,
  commit,
}: {
  text: string;
  hide: () => void;
  restore: () => void;
  commit: () => Promise<unknown>;
}): void {
  hide();
  const ms = 5000;
  const timer = setTimeout(() => {
    commit().catch((error: Error) => {
      restore();
      toast(error.message || 'Smazání se nepovedlo');
    });
  }, ms);
  toast(
    text,
    {
      label: 'Vrátit',
      run: () => {
        clearTimeout(timer);
        restore();
      },
    },
    ms,
  );
}

/** Řádek se seznamu, který vede dál: nadpis, popis a šipka. */
export function LinkRow({
  icon,
  title,
  sub,
  value,
  danger,
  href,
  onClick,
}: {
  icon?: IconName;
  title: string;
  sub?: string;
  value?: ReactNode;
  danger?: boolean;
  href?: string;
  onClick?: () => void;
}) {
  const body = (
    <>
      {icon ? (
        <span className="m-link-icon">
          <Icon name={icon} size={22} />
        </span>
      ) : null}
      <span className="m-link-text">
        <span className={`m-row-title${danger ? ' is-danger' : ''}`} title={title}>
          {title}
        </span>
        {sub ? <span className="m-row-sub">{sub}</span> : null}
      </span>
      {value !== undefined ? <span className="m-link-value">{value}</span> : null}
      {onClick && !danger ? (
        <span className="m-link-chevron">
          <Icon name="right" size={16} />
        </span>
      ) : null}
    </>
  );
  if (href) {
    return (
      <a className="m-row m-link" href={href}>
        {body}
      </a>
    );
  }
  return (
    <button type="button" className="m-row m-link" onClick={onClick}>
      {body}
    </button>
  );
}

export type PickerOption = { value: string; label: string; sub?: string; tone?: string };

/** Výběr z možností ve spodním listu. Delší seznam jde prohledat. */
export function Picker({
  title,
  options,
  value,
  onPick,
  onClose,
  children,
}: {
  title: string;
  options: PickerOption[];
  value?: string | null;
  onPick: (value: string) => void;
  onClose: () => void;
  children?: ReactNode;
}) {
  const [query, setQuery] = useState('');
  const needle = query.trim().toLocaleLowerCase('cs');
  const shown = needle ? options.filter((o) => o.label.toLocaleLowerCase('cs').includes(needle)) : options;
  return (
    <Sheet title={title} onClose={onClose}>
      {options.length > 8 ? (
        <input
          className="m-input m-picker-search"
          placeholder="Hledat"
          aria-label="Hledat"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      ) : null}
      <div className="m-picker">
        {shown.map((option) => (
          <button
            key={option.value}
            type="button"
            className="m-picker-row"
            aria-pressed={option.value === value}
            onClick={() => {
              onPick(option.value);
              onClose();
            }}
          >
            {option.tone ? <span className={`m-flag ${option.tone}`} aria-hidden="true" /> : null}
            <span className="m-link-text">
              <span className="m-row-title" title={option.label}>
                {option.label}
              </span>
              {option.sub ? <span className="m-row-sub">{option.sub}</span> : null}
            </span>
            {option.value === value ? <Icon name="check" size={20} /> : null}
          </button>
        ))}
      </div>
      {children}
    </Sheet>
  );
}

const SWIPE_OPEN = 84;

/**
 * Řádek, který jde stáhnout doleva a odhalit akci. Pohyb sleduje prst 1:1,
 * dlouhé nebo rychlé stažení akci rovnou provede.
 */
export function SwipeRow({
  label,
  onAction,
  disabled,
  children,
}: {
  label: string;
  onAction: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  const content = useRef<HTMLDivElement>(null);
  const state = useRef({ x: 0, y: 0, base: 0, dx: 0, last: 0, t: 0, speed: 0, axis: '' as '' | 'x' | 'y', moved: false });
  const hide = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [open, setOpen] = useState(false);

  const place = (x: number, animate: boolean) => {
    const el = content.current;
    if (!el) return;
    el.style.transition = animate ? `transform 320ms ${EASE}` : 'none';
    el.style.transform = x ? `translate3d(${x}px,0,0)` : '';
    // Červená akce je vidět jen při stažení, jinak prosvítá v zaoblených rozích.
    const root = el.parentElement;
    if (x) {
      clearTimeout(hide.current);
      root?.classList.add('is-active');
    } else {
      hide.current = setTimeout(() => root?.classList.remove('is-active'), animate ? 330 : 0);
    }
  };

  if (disabled) return <>{children}</>;

  const width = () => content.current?.getBoundingClientRect().width ?? 360;

  return (
    <div
      className="m-swipe"
      onPointerDown={(event) => {
        state.current = {
          x: event.clientX,
          y: event.clientY,
          base: open ? -SWIPE_OPEN : 0,
          dx: open ? -SWIPE_OPEN : 0,
          last: event.clientX,
          t: event.timeStamp,
          speed: 0,
          axis: '',
          moved: false,
        };
      }}
      onPointerMove={(event) => {
        const s = state.current;
        if (!s.t || s.axis === 'y') return;
        const dx = event.clientX - s.x;
        const dy = event.clientY - s.y;
        if (!s.axis) {
          if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
          s.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
          if (s.axis === 'y') return;
          event.currentTarget.setPointerCapture(event.pointerId);
          s.moved = true;
        }
        s.speed = (event.clientX - s.last) / Math.max(1, event.timeStamp - s.t);
        s.last = event.clientX;
        s.t = event.timeStamp;
        s.dx = Math.min(0, s.base + dx);
        place(s.dx, false);
      }}
      onPointerUp={() => {
        const s = state.current;
        s.t = 0;
        if (s.axis !== 'x') return;
        const total = width();
        // Kam by se řádek setrvačností dostal, ne kde ho prst pustil.
        const projected = s.dx + s.speed * 180;
        if (projected < -total * 0.55) {
          place(-total, true);
          setTimeout(onAction, 200);
          return;
        }
        const next = projected < -SWIPE_OPEN / 2;
        setOpen(next);
        place(next ? -SWIPE_OPEN : 0, true);
      }}
      onPointerCancel={() => {
        state.current.t = 0;
        place(open ? -SWIPE_OPEN : 0, true);
      }}
      onClickCapture={(event) => {
        // Klepnutí po stažení nebo na otevřený řádek jen řádek zavře.
        if (state.current.moved) {
          state.current.moved = false;
          event.preventDefault();
          event.stopPropagation();
        } else if (open) {
          event.preventDefault();
          event.stopPropagation();
          setOpen(false);
          place(0, true);
        }
      }}
    >
      <button
        type="button"
        className="m-swipe-action"
        onClickCapture={(event) => {
          event.stopPropagation();
          setOpen(false);
          place(0, false);
          onAction();
        }}
      >
        {label}
      </button>
      <div ref={content} className="m-swipe-content">
        {children}
      </div>
    </div>
  );
}

/** Iniciály místo fotky. */
export function Initials({ name, size = 40 }: { name: string; size?: number }) {
  const letters = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join('')
    .toLocaleUpperCase('cs');
  return (
    <span className="m-initials" style={{ width: size, height: size, fontSize: size * 0.38 }} aria-hidden="true">
      {letters}
    </span>
  );
}

/** Než přijdou první data: tiché řádky místo prázdné stránky. */
export function Skeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="m-section" aria-hidden="true">
      <div className="m-group">
        {Array.from({ length: rows }, (_, index) => (
          <div className="m-skeleton-row" key={index}>
            <span />
            <span />
          </div>
        ))}
      </div>
    </div>
  );
}

export function ago(iso: string | number): string {
  const ms = typeof iso === 'number' ? iso : new Date(iso).getTime();
  const minutes = Math.round((Date.now() - ms) / 60000);
  if (minutes < 1) return 'teď';
  if (minutes < 60) return `před ${minutes} min`;
  const date = new Date(ms);
  if (date.toDateString() === new Date().toDateString()) return timeOf(date.toISOString());
  const days = Math.floor((Date.now() - ms) / 86400000);
  if (days < 7) return date.toLocaleDateString('cs-CZ', { weekday: 'long' });
  return date.toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric' });
}

export function plural(count: number, one: string, few: string, many: string): string {
  if (count === 1) return one;
  if (count >= 2 && count <= 4) return few;
  return many;
}

export function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' });
}
