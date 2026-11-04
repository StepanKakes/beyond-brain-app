import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';

import { back, takeSilentPop, type Entry } from './router';

// Vnořené obrazovky jako v UINavigationController: vjedou zprava, spodní vrstva
// se posune o kus doleva, tažením od levého okraje jde kdykoli zpět. Animuje se
// jen transform přes Web Animations, takže běží na grafické kartě a dá se
// přerušit z aktuální pozice.

const EASE = 'cubic-bezier(.32,.72,0,1)';
const DURATION = 420;
const UNDER = -28; // o kolik procent uhne spodní vrstva
const EDGE = 28;

const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function slide(el: HTMLElement | null, from: number, to: number, duration = DURATION) {
  if (!el) return Promise.resolve();
  el.getAnimations().forEach((a) => a.cancel());
  const value = (x: number) => (x === 0 ? 'none' : `translate3d(${x}%,0,0)`);
  el.style.transform = value(to);
  if (reduced()) return Promise.resolve();
  const animation = el.animate([{ transform: value(from) }, { transform: value(to) }], {
    duration,
    easing: EASE,
  });
  // Skrytá stránka animace nedokončí, obrazovka by v DOMu zůstala navždy.
  return Promise.race([
    animation.finished.catch(() => undefined),
    new Promise((resolve) => setTimeout(resolve, duration + 120)),
  ]);
}

type Item = { entry: Entry; leaving: boolean };

export function Stack({
  stack,
  baseRef,
  render,
}: {
  stack: Entry[];
  baseRef: RefObject<HTMLElement | null>;
  render: (entry: Entry, active: boolean) => ReactNode;
}) {
  const [items, setItems] = useState<Item[]>(() => stack.map((entry) => ({ entry, leaving: false })));
  const refs = useRef(new Map<string, HTMLElement>());
  const prior = useRef(stack);
  const first = useRef(true);

  const underOf = (key: string): HTMLElement | null => {
    const list = prior.current;
    const index = list.findIndex((e) => e.key === key);
    if (index > 0) return refs.current.get(list[index - 1].key) ?? null;
    return baseRef.current;
  };

  // Rozdíl mezi minulým a novým stavem routeru: přidané vjedou, odebrané odjedou.
  useLayoutEffect(() => {
    const before = prior.current;
    const keys = new Set(stack.map((e) => e.key));
    const removed = before.filter((e) => !keys.has(e.key));
    const silent = takeSilentPop();
    setItems((current) => {
      const stale = current.filter((i) => !keys.has(i.entry.key) && (i.leaving || removed.some((r) => r.key === i.entry.key)));
      const leaving = silent ? [] : stale.map((i) => ({ ...i, leaving: true }));
      return [...stack.map((entry) => ({ entry, leaving: false })), ...leaving];
    });
    if (removed.length && !silent) {
      removed.forEach((entry) => {
        const el = refs.current.get(entry.key) ?? null;
        void slide(el, 0, 100).then(() => {
          setItems((current) => current.filter((i) => i.entry.key !== entry.key));
        });
      });
    }
    if (removed.length) {
      const top = stack[stack.length - 1];
      const under = top ? refs.current.get(top.key) ?? null : baseRef.current;
      if (under && !silent) void slide(under, UNDER, 0);
      else if (under) under.style.transform = 'none';
    }
    prior.current = stack;
  }, [stack, baseRef]);

  // Nově přidaná obrazovka je v DOMu až po renderu.
  const known = useRef(new Set(stack.map((e) => e.key)));
  useLayoutEffect(() => {
    items.forEach(({ entry, leaving }) => {
      if (leaving || known.current.has(entry.key)) return;
      known.current.add(entry.key);
      const el = refs.current.get(entry.key) ?? null;
      void slide(el, 100, 0);
      void slide(underOf(entry.key), 0, UNDER);
    });
    // Otevřeno rovnou z notifikace: spodní vrstva je už odsunutá, bez animace.
    if (first.current) {
      first.current = false;
      if (stack.length && baseRef.current) baseRef.current.style.transform = `translate3d(${UNDER}%,0,0)`;
    }
  });

  // Swipe zpět od levého okraje.
  useEffect(() => {
    let tracking: { el: HTMLElement; under: HTMLElement | null; startX: number; startY: number; lastX: number; lastT: number; speed: number; horizontal: boolean } | null = null;

    const onStart = (event: TouchEvent) => {
      const list = prior.current;
      const top = list[list.length - 1];
      const touch = event.touches[0];
      if (!top || event.touches.length !== 1 || touch.clientX > EDGE) return;
      const el = refs.current.get(top.key);
      if (!el) return;
      el.getAnimations().forEach((a) => a.cancel());
      const under = underOf(top.key);
      under?.getAnimations().forEach((a) => a.cancel());
      tracking = { el, under, startX: touch.clientX, startY: touch.clientY, lastX: touch.clientX, lastT: event.timeStamp, speed: 0, horizontal: false };
    };

    const onMove = (event: TouchEvent) => {
      if (!tracking) return;
      const touch = event.touches[0];
      const dx = touch.clientX - tracking.startX;
      if (!tracking.horizontal) {
        if (Math.abs(touch.clientY - tracking.startY) > Math.abs(dx) + 4) {
          tracking = null;
          return;
        }
        if (dx < 6) return;
        tracking.horizontal = true;
        (document.activeElement as HTMLElement | null)?.blur?.();
      }
      event.preventDefault();
      const dt = Math.max(1, event.timeStamp - tracking.lastT);
      tracking.speed = (touch.clientX - tracking.lastX) / dt;
      tracking.lastX = touch.clientX;
      tracking.lastT = event.timeStamp;
      const width = window.innerWidth;
      const progress = Math.max(0, Math.min(1, dx / width));
      tracking.el.style.transform = `translate3d(${progress * 100}%,0,0)`;
      if (tracking.under) tracking.under.style.transform = `translate3d(${UNDER * (1 - progress)}%,0,0)`;
    };

    const onEnd = () => {
      if (!tracking) return;
      const { el, under, lastX, startX, speed, horizontal } = tracking;
      tracking = null;
      if (!horizontal) return;
      const width = window.innerWidth;
      const progress = Math.max(0, Math.min(1, (lastX - startX) / width));
      const leave = speed > 0.45 || (progress > 0.4 && speed > -0.2);
      if (leave) {
        void slide(under, UNDER * (1 - progress), 0, 300);
        void slide(el, progress * 100, 100, 300).then(() => back({ silent: true }));
      } else {
        void slide(under, UNDER * (1 - progress), UNDER, 300);
        void slide(el, progress * 100, 0, 300);
      }
    };

    document.addEventListener('touchstart', onStart, { passive: true });
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onEnd, { passive: true });
    document.addEventListener('touchcancel', onEnd, { passive: true });
    return () => {
      document.removeEventListener('touchstart', onStart);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onEnd);
      document.removeEventListener('touchcancel', onEnd);
    };
    // underOf čte jen refy
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      {items.map(({ entry, leaving }, index) => (
        <section
          key={entry.key}
          className="m-pushed"
          style={{ zIndex: 20 + index }}
          aria-hidden={leaving || undefined}
          ref={(el) => {
            if (el) refs.current.set(entry.key, el);
            else refs.current.delete(entry.key);
          }}
        >
          {render(entry, !leaving && entry.key === stack[stack.length - 1]?.key)}
        </section>
      ))}
    </>
  );
}
