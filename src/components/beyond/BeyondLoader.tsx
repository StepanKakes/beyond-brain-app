import { useEffect, useRef, useState } from 'react';

/**
 * Beyond Brain — the line next to the pulsing brain while a turn runs: what
 * the brain is doing and how long it has been at it, in the app's own type.
 * The brain mark itself is the only animation.
 */

const fmt = (s: number) => (s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`);

export default function BeyondLoader({ label = 'Přemýšlím', timer = false }: { label?: string; timer?: boolean }) {
  const startedAt = useRef(performance.now());
  const [secs, setSecs] = useState(0);

  useEffect(() => {
    if (!timer) return undefined;
    const id = setInterval(() => setSecs(Math.floor((performance.now() - startedAt.current) / 1000)), 1000);
    return () => clearInterval(id);
  }, [timer]);

  return (
    <span role="status" className="bb-thinkline">
      <span className="bb-thinkline__label">{label}</span>
      {timer && <span className="bb-thinkline__timer">{fmt(secs)}</span>}
    </span>
  );
}
