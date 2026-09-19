/**
 * Beyond Brain — the five interchangeable thinking loaders from the handoff.
 * `ring` is the default; the others are user-selectable in Settings → Animace
 * přemýšlení. All are pure CSS (see .bb-loader--* in beyond-glass.css).
 */

export type LoaderKind = 'ring' | 'flow' | 'ticks' | 'trail' | 'sweep';

export const LOADER_KINDS: { id: LoaderKind; name: string; desc: string }[] = [
  { id: 'ring', name: 'Ring', desc: 'Oblouk se stahuje a otáčí' },
  { id: 'flow', name: 'Flow', desc: 'Čárka se protahuje a plyne napříč' },
  { id: 'ticks', name: 'Ticks', desc: 'Vlna přes pět tenkých čárek' },
  { id: 'trail', name: 'Trail', desc: 'Tečka putuje po dráze' },
  { id: 'sweep', name: 'Sweep', desc: 'Světlo přejíždí po čárce' },
];

export const LOADER_STORAGE_KEY = 'beyond.loader';

export function readLoaderKind(): LoaderKind {
  try {
    const v = localStorage.getItem(LOADER_STORAGE_KEY) as LoaderKind | null;
    if (v && LOADER_KINDS.some((l) => l.id === v)) return v;
  } catch {
    /* ignore */
  }
  return 'ring';
}

export default function BeyondLoader({ kind = 'ring' }: { kind?: LoaderKind }) {
  if (kind === 'ring') {
    return (
      <span className="bb-loader bb-loader--ring" aria-hidden="true">
        <svg width="14" height="14" viewBox="0 0 16 16" style={{ overflow: 'visible' }}>
          <circle cx="8" cy="8" r="7" fill="none" stroke="var(--bb-line2)" strokeWidth="1.6" />
          <circle cx="8" cy="8" r="7" fill="none" stroke="var(--bb-ink)" strokeWidth="1.6" strokeLinecap="round" strokeDasharray="44" />
        </svg>
      </span>
    );
  }
  if (kind === 'flow') return <span className="bb-loader bb-loader--flow" aria-hidden="true"><i /></span>;
  if (kind === 'ticks') return (
    <span className="bb-loader bb-loader--ticks" aria-hidden="true">
      {[0, 0.13, 0.26, 0.39, 0.52].map((d) => <i key={d} style={{ animationDelay: `${d}s` }} />)}
    </span>
  );
  if (kind === 'trail') return <span className="bb-loader bb-loader--trail" aria-hidden="true"><i /></span>;
  return <span className="bb-loader bb-loader--sweep" aria-hidden="true" />;
}
