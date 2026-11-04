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

import { Icon } from './icons';
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

/** Obrazovka tabu: velký nadpis, který při scrollu přejde do malého ve skleněné liště. */
/** Kolik bodů odjede velký nadpis, než ho nahradí titulek v liště. */
const COLLAPSE_AT = 40;

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
export function PushedBar({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <header className="m-bar m-bar-pushed">
      <button type="button" className="m-icon-btn m-bar-back" aria-label="Zpět" onClick={() => back()}>
        <Icon name="back" size={22} />
      </button>
      <div className="m-bar-title" title={title}>
        {title}
      </div>
      <div className="m-bar-action">{action}</div>
    </header>
  );
}

export function Section({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="m-section">
      {title ? <h2>{title}</h2> : null}
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

// Krátké hlášky nahoře.
export function toast(text: string): void {
  window.dispatchEvent(new CustomEvent('m-toast', { detail: text }));
}

export function ToastHost() {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const show = (event: Event) => {
      setText((event as CustomEvent<string>).detail);
      clearTimeout(timer);
      timer = setTimeout(() => setText(null), 3200);
    };
    window.addEventListener('m-toast', show);
    return () => {
      window.removeEventListener('m-toast', show);
      clearTimeout(timer);
    };
  }, []);
  if (!text) return null;
  return (
    <div className="m-toast" role="status">
      {text}
    </div>
  );
}

export function plural(count: number, one: string, few: string, many: string): string {
  if (count === 1) return one;
  if (count >= 2 && count <= 4) return few;
  return many;
}

export function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' });
}
