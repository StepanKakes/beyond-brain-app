import { useEffect, useState } from 'react';

/**
 * Beyond Brain gradient background system.
 * Picks a soft pastel gradient based on the current hour (Sequoia-like).
 * Re-evaluates every 5 minutes so the background drifts through the day.
 *
 * Variants:
 *  - morning (5-11): warm peach → soft yellow
 *  - day     (11-17): soft blue → cool white
 *  - evening (17-22): purple → orange sunset
 *  - night   (22-5): deep blue → soft black (auto-pairs with dark mode)
 */
export type TimeOfDay = 'morning' | 'day' | 'evening' | 'night';

export function getTimeOfDay(date: Date = new Date()): TimeOfDay {
  const hour = date.getHours();
  if (hour >= 5 && hour < 11) return 'morning';
  if (hour >= 11 && hour < 17) return 'day';
  if (hour >= 17 && hour < 22) return 'evening';
  return 'night';
}

const VARIANT_CLASS: Record<TimeOfDay, string> = {
  morning: 'beyond-bg-morning',
  day: 'beyond-bg-day',
  evening: 'beyond-bg-evening',
  night: 'beyond-bg-night',
};

export default function BeyondBackground() {
  const [variant, setVariant] = useState<TimeOfDay>(() => {
    // Allow ?bg=morning|day|evening|night override for design previews / screenshots
    if (typeof window !== 'undefined') {
      const forced = new URLSearchParams(window.location.search).get('bg');
      if (forced === 'morning' || forced === 'day' || forced === 'evening' || forced === 'night') {
        return forced;
      }
    }
    return getTimeOfDay();
  });

  useEffect(() => {
    // Skip auto-rotation if URL pins a variant
    if (typeof window !== 'undefined') {
      const forced = new URLSearchParams(window.location.search).get('bg');
      if (forced === 'morning' || forced === 'day' || forced === 'evening' || forced === 'night') {
        return undefined;
      }
    }
    const tick = () => setVariant(getTimeOfDay());
    tick();
    const id = window.setInterval(tick, 5 * 60 * 1000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div
      aria-hidden="true"
      data-variant={variant}
      className={`beyond-bg-layer ${VARIANT_CLASS[variant]}`}
    />
  );
}
