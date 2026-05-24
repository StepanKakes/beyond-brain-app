/**
 * Beyond Brain — v2 background.
 *
 * v1 painted a fixed full-screen time-of-day gradient (peach/sunrise).
 * v2 is hyperminimal: default state is **pure white**. The only colored
 * background is the soft powder-blue → cream gradient used on the welcome
 * hero — opt-in via the `variant` prop.
 *
 * No time-of-day rotation. No glassmorphism. No fixed layer unless asked.
 */

/* ---- v1 compat re-exports (so legacy imports still type-check) -----------
 * v2 doesn't rotate by hour, but BeyondWelcome (v1) still imports these.
 * They're kept here as deprecated thin shims and will be removed once all
 * v1 components are rewritten. */
export type TimeOfDay = 'morning' | 'day' | 'evening' | 'night';

export function getTimeOfDay(date: Date = new Date()): TimeOfDay {
  const hour = date.getHours();
  if (hour >= 5 && hour < 11) return 'morning';
  if (hour >= 11 && hour < 17) return 'day';
  if (hour >= 17 && hour < 22) return 'evening';
  return 'night';
}

export type BeyondBackgroundVariant = 'white' | 'hero';

type Props = {
  /** 'white' (default) paints nothing — the page sits on the body's white background.
   *  'hero' paints the powder-blue → cream gradient as a fixed layer. */
  variant?: BeyondBackgroundVariant;
};

export default function BeyondBackground({ variant = 'white' }: Props) {
  if (variant === 'white') {
    // Nothing to paint — body already has #ffffff.
    return null;
  }

  return (
    <div
      aria-hidden="true"
      data-variant="hero"
      className="beyond-hero-gradient pointer-events-none fixed inset-0 z-0"
    />
  );
}
