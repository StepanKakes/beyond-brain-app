import { useLayoutEffect, useRef, useState } from 'react';

/**
 * Odpověď se během práce neukazuje, přijde najednou jako u Siri: stav zmizí za
 * 0,25 s, 0,3 s je klid a pak po blocích naběhne text (časy změřené z videa).
 */
export type RevealPhase = 'idle' | 'leaving' | 'gap' | 'reveal';

const STATUS_OUT_MS = 250;
const REVEAL_GAP_MS = 300;
const REVEAL_MS = 1500;

export function useRevealPhase(running: boolean) {
  const [phase, setPhase] = useState<RevealPhase>('idle');
  const wasRunning = useRef(false);

  useLayoutEffect(() => {
    const was = wasRunning.current;
    wasRunning.current = running;
    if (running) {
      setPhase('idle');
      return undefined;
    }
    if (!was) return undefined;
    setPhase('leaving');
    const gap = setTimeout(() => setPhase('gap'), STATUS_OUT_MS);
    const reveal = setTimeout(() => setPhase('reveal'), STATUS_OUT_MS + REVEAL_GAP_MS);
    const done = setTimeout(() => setPhase('idle'), STATUS_OUT_MS + REVEAL_GAP_MS + REVEAL_MS);
    return () => {
      clearTimeout(gap);
      clearTimeout(reveal);
      clearTimeout(done);
    };
  }, [running]);

  return {
    phase,
    /** Odpověď je hotová nebo se píše, ale ještě se neukazuje. */
    holding: running || phase === 'leaving' || phase === 'gap',
    /** Stavová řádka je vidět, i během svého zmizení. */
    statusVisible: running || phase === 'leaving',
    leaving: !running && phase === 'leaving',
  };
}
