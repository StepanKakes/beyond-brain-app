import { useEffect, useRef, useState } from 'react';

import './chat/answer-motion.css';

// Osm kuliček od hlavy po ocas, sousední se slévají jako u Siri.
const DOTS = [3.6, 3.2, 2.8, 2.4, 2, 1.7, 1.4, 1.1];

/** Rychlé nástroje by popisek jen rozblikaly, každý proto chvíli vydrží. */
const LABEL_HOLD_MS = 1200;

/** Stav běhu podle Siri: prstenec, který se točí, a popisek, který dýchá. */
export default function BeyondLoader({ label = 'Přemýšlím', leaving = false }: { label?: string; leaving?: boolean }) {
  const [shown, setShown] = useState(label);
  const [old, setOld] = useState<string | null>(null);
  const shownAt = useRef(Date.now());

  useEffect(() => {
    if (label === shown) return undefined;
    const swap = setTimeout(
      () => {
        shownAt.current = Date.now();
        setOld(shown);
        setShown(label);
      },
      Math.max(0, LABEL_HOLD_MS - (Date.now() - shownAt.current)),
    );
    return () => clearTimeout(swap);
  }, [label, shown]);

  useEffect(() => {
    if (!old) return undefined;
    const clear = setTimeout(() => setOld(null), 200);
    return () => clearTimeout(clear);
  }, [old]);

  return (
    <div className={`bb-status${leaving ? ' is-leaving' : ''}`} role="status">
      <svg className="bb-loader" viewBox="0 0 32 32" aria-hidden="true">
        <defs>
          <filter id="bb-loader-goo">
            <feGaussianBlur stdDeviation="0.9" />
            <feColorMatrix values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 14 -6" />
          </filter>
        </defs>
        <g filter="url(#bb-loader-goo)">
          <g className="bb-loader__breath">
            <g className="bb-loader__spin">
              {DOTS.map((radius, index) => {
                const angle = (-index * Math.PI * 2) / DOTS.length;
                return (
                  <circle
                    key={radius}
                    cx={16 + Math.sin(angle) * 10}
                    cy={16 - Math.cos(angle) * 10}
                    r={radius}
                    fill="currentColor"
                  />
                );
              })}
            </g>
          </g>
        </g>
      </svg>
      <span className="bb-status__text">
        {old ? (
          <span key={old} className="bb-status__old">
            {old}
          </span>
        ) : null}
        <span key={shown} className="bb-status__label">
          {shown}
        </span>
      </span>
    </div>
  );
}
