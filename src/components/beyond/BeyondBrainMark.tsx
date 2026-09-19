import { useMemo } from 'react';

/**
 * Beyond Brain — the pixel/dot brain mark (logo + loader in one).
 *
 * A hand-authored pixel bitmap of a brain in profile (after the reference the
 * user gave), rendered as sharp matrix squares — the transitions.dev
 * matrix-loader look. Deterministic (no canvas), so it's identical on every
 * device. `animate="in"` → one-shot diagonal reveal (brand mount); `animate=
 * "pulse"` → matrix colour-pulse rippling out from the centre (chat loader).
 * `flip` mirrors it horizontally (the reference faces left; we face right).
 */

type Dot = { x: number; y: number };

// Brain in profile, traced 1:1 from the reference pixel-art (facing LEFT: frontal
// lobe left, occipital right, brainstem dropping from the centre). Each row lists
// the filled column ranges [start,end] inclusive on a 22-wide grid; the gaps
// between ranges are the sulci (folds). `flip` mirrors it to face right.
const COLS = 18;
const ROW_RANGES: Array<Array<[number, number]>> = [
  [[8, 10]],
  [[8, 10], [12, 14]],
  [[3, 7], [10, 15]],
  [[2, 11], [13, 15]],
  [[2, 3], [6, 7], [11, 11], [14, 17]],
  [[0, 3], [5, 7], [10, 17]],
  [[0, 0], [2, 8], [10, 14], [16, 17]],
  [[0, 0], [2, 5], [8, 10], [12, 16]],
  [[0, 4], [7, 9], [11, 14]],
  [[1, 3], [6, 12]],
  [[5, 8], [10, 11]],
  [[5, 7]],
  [[5, 6]],
  [[5, 5]],
  [[5, 5]],
];
const ROWS = ROW_RANGES.length;

function buildDots(flip: boolean): Dot[] {
  const out: Dot[] = [];
  for (let y = 0; y < ROWS; y++) {
    for (const [s, e] of ROW_RANGES[y]) {
      for (let x = s; x <= e; x++) {
        out.push({ x: flip ? COLS - 1 - x : x, y });
      }
    }
  }
  return out;
}

const cache = new Map<string, Dot[]>();
function getDots(flip: boolean): Dot[] {
  const key = flip ? 'r' : 'l';
  const hit = cache.get(key);
  if (hit) return hit;
  const dots = buildDots(flip);
  cache.set(key, dots);
  return dots;
}

export default function BeyondBrainMark({
  size = 30,
  animate = 'none',
  flip = true,
  side = 0.64,
  title,
  className = '',
}: {
  size?: number;
  animate?: 'none' | 'in' | 'pulse';
  /** Mirror horizontally. Default true → faces right (reference faces left). */
  flip?: boolean;
  /** Square fill fraction of each cell (boldness). 0.64 = in-message look. */
  side?: number;
  title?: string;
  className?: string;
}) {
  const dots = useMemo(() => getDots(flip), [flip]);
  const w = size;
  const h = Math.round((size * (ROWS + 2)) / (COLS + 2)); // +2 = padded viewBox
  const maxWave = COLS + ROWS;

  // Centroid for the centre-out matrix "pulse".
  const { cx, cy, maxDist } = useMemo(() => {
    const n = dots.length || 1;
    const sx = dots.reduce((a, d) => a + d.x, 0) / n;
    const sy = dots.reduce((a, d) => a + d.y, 0) / n;
    const md = dots.reduce((m, d) => Math.max(m, Math.hypot(d.x - sx, d.y - sy)), 0) || 1;
    return { cx: sx, cy: sy, maxDist: md };
  }, [dots]);

  return (
    <span
      className={`bb-brain ${animate === 'in' ? 'bb-brain--in' : animate === 'pulse' ? 'bb-brain--pulse' : ''} ${className}`}
      style={{ display: 'inline-block', lineHeight: 0, width: w, height: h }}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <svg
        width={w}
        height={h}
        viewBox={`-1 -1 ${COLS + 2} ${ROWS + 2}`}
        style={{ display: 'block', overflow: 'visible' }}
        shapeRendering="crispEdges"
      >
        {dots.map((d) => {
          const off = (1 - side) / 2;
          const dist = Math.hypot(d.x - cx, d.y - cy);
          return (
            <rect
              key={`${d.x}-${d.y}`}
              className="bb-braindot"
              x={d.x + off}
              y={d.y + off}
              width={side}
              height={side}
              style={{
                ['--i' as string]: (d.x + d.y),
                ['--n' as string]: maxWave,
                ['--c' as string]: Number(dist.toFixed(3)),
                ['--cn' as string]: Number(maxDist.toFixed(3)),
              }}
            />
          );
        })}
      </svg>
    </span>
  );
}
