import LatticeLoader, { type LatticePatternName } from './bits/LatticeLoader';

/**
 * Beyond Brain — the thinking loader, React Bits LatticeLoader. The pattern
 * the dots run is user-selectable in Settings → Animace přemýšlení; earlier
 * choices from the CSS loaders fall back to the default.
 */

export type LoaderKind = Extract<LatticePatternName, 'orbit' | 'snake' | 'spiral' | 'ripple' | 'rain' | 'pulse'>;

export const LOADER_KINDS: { id: LoaderKind; name: string; desc: string }[] = [
  { id: 'orbit', name: 'Oběžnice', desc: 'Světlo obíhá kolem středu' },
  { id: 'snake', name: 'Had', desc: 'Řada teček se plazí mřížkou' },
  { id: 'spiral', name: 'Spirála', desc: 'Stáčí se od kraje do středu' },
  { id: 'ripple', name: 'Vlna', desc: 'Kruhy se šíří ze středu' },
  { id: 'rain', name: 'Déšť', desc: 'Tečky padají shora dolů' },
  { id: 'pulse', name: 'Tep', desc: 'Celá mřížka dýchá' },
];

export const LOADER_STORAGE_KEY = 'beyond.loader';

export function readLoaderKind(): LoaderKind {
  try {
    const v = localStorage.getItem(LOADER_STORAGE_KEY) as LoaderKind | null;
    if (v && LOADER_KINDS.some((l) => l.id === v)) return v;
  } catch {
    /* ignore */
  }
  return 'orbit';
}

export default function BeyondLoader({
  kind = 'orbit',
  label = '',
  timer = false,
}: {
  kind?: LoaderKind;
  label?: string;
  timer?: boolean;
}) {
  return (
    <LatticeLoader
      pattern={kind}
      label={label}
      doneLabel="Hotovo za"
      errorLabel="Selhalo po"
      showTimer={timer}
      cellSize={4}
      gap={2}
      fontSize={14}
      className="bb-lattice"
    />
  );
}
