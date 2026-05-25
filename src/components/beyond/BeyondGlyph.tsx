import { motion } from 'framer-motion';

/**
 * Beyond Glyph — soft gradient mascot circle.
 *
 * Reusable across welcome, chat header, sidebar avatars. Optional `pulse` adds
 * the gentle Welcome-screen breathing. Optional `initials` overlays 1–2
 * letters (used in sidebar client avatars).
 *
 * Visual: soft radial gradient pink → blue → purple with subtle inner highlight
 * and outer soft shadow. No mascot face by default — a single optional smile
 * via `face` keeps the asset readable even at 28px.
 */

type Size = 20 | 24 | 28 | 32 | 40 | 56 | 64;

type Props = {
  size?: Size;
  /** Animated breathing — used on Welcome. */
  pulse?: boolean;
  /** 1–2 letters overlaid white & semibold (used for client avatars). */
  initials?: string;
  /** Tiny mascot face (2 dots + curve) — only readable at >= 40px. */
  face?: boolean;
  className?: string;
};

const PIXEL_FOR: Record<Size, string> = {
  20: 'h-5 w-5',
  24: 'h-6 w-6',
  28: 'h-7 w-7',
  32: 'h-8 w-8',
  40: 'h-10 w-10',
  56: 'h-14 w-14',
  64: 'h-16 w-16',
};

// Initials font sizes are tuned to look balanced inside the gradient circle.
const INITIALS_SIZE_FOR: Record<Size, string> = {
  20: 'text-[8px]',
  24: 'text-[9px]',
  28: 'text-[10px]',
  32: 'text-[11px]',
  40: 'text-[13px]',
  56: 'text-[18px]',
  64: 'text-[20px]',
};

const SHADOW = {
  small:
    '0 2px 6px -2px rgba(173, 159, 209, 0.5), inset 0 1px 1px rgba(255,255,255,0.5)',
  medium:
    '0 4px 14px -4px rgba(173, 159, 209, 0.5), inset 0 1px 2px rgba(255,255,255,0.55)',
  large:
    '0 10px 32px -10px rgba(173, 159, 209, 0.45), inset 0 1px 2px rgba(255,255,255,0.55)',
} as const;

function shadowFor(size: Size): string {
  if (size >= 56) return SHADOW.large;
  if (size >= 32) return SHADOW.medium;
  return SHADOW.small;
}

export default function BeyondGlyph({
  size = 40,
  pulse = false,
  initials,
  face = false,
  className,
}: Props) {
  const sizeClass = PIXEL_FOR[size];
  const initialsSize = INITIALS_SIZE_FOR[size];

  const inner = (
    <div
      className={`relative flex items-center justify-center rounded-full ${sizeClass} ${className ?? ''}`}
      style={{
        background:
          'radial-gradient(circle at 32% 28%, #f6d8e4 0%, #d4dff2 38%, #c9bce3 72%, #ad9fd1 100%)',
        boxShadow: shadowFor(size),
      }}
      aria-hidden
    >
      {initials && (
        <span className={`font-semibold text-white/95 ${initialsSize}`}>
          {initials}
        </span>
      )}
      {face && !initials && size >= 40 && (
        <svg
          width={Math.round(size * 0.42)}
          height={Math.round(size * 0.42)}
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden
          className="text-white/85"
        >
          {/* tiny eyes */}
          <circle cx="9" cy="10" r="1.1" fill="currentColor" />
          <circle cx="15" cy="10" r="1.1" fill="currentColor" />
          {/* gentle curve smile */}
          <path
            d="M9 14.5c1 0.9 2 1.3 3 1.3s2-0.4 3-1.3"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
            fill="none"
          />
        </svg>
      )}
    </div>
  );

  if (!pulse) return inner;

  return (
    <motion.div
      animate={{ scale: [1, 1.04, 1] }}
      transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
    >
      {inner}
    </motion.div>
  );
}

/** Compute up to 2 initials for a client name (e.g. "Ivana Juříková" → "IJ"). */
export function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}
