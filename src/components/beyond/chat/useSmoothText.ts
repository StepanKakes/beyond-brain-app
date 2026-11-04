import { useEffect, useRef, useState } from 'react';

import { holdBackTable } from './transcript';

/** Whatever is further behind than this comes at once: a chat opened mid-answer. */
const JUMP_AT = 1500;
/** A backlog is worked off in this long, so the pace follows the model's. */
const CATCH_UP_MS = 420;
/** Markdown is parsed on each commit, this many milliseconds apart at most. */
const COMMIT_MS = 50;

/**
 * Reveals a text that arrives in bursts at a steady pace, so the answer flows
 * instead of jumping chunk by chunk. A finished text that was never streamed
 * here comes whole, with no animation.
 */
export function useSmoothText(target: string, live: boolean): { text: string; revealing: boolean } {
  const [shown, setShown] = useState(() => (live && target.length < JUMP_AT ? '' : target));
  const count = useRef(shown.length);
  const targetRef = useRef(target);
  targetRef.current = target;
  const behind = count.current < target.length;

  useEffect(() => {
    if (!behind) return undefined;
    let frame = 0;
    let lastFrame = performance.now();
    let lastCommit = 0;
    const tick = (now: number) => {
      const goal = targetRef.current.length;
      let backlog = goal - count.current;
      if (backlog > JUMP_AT) {
        count.current = goal - 200;
        backlog = 200;
      }
      const step = Math.max(1, (backlog * (now - lastFrame)) / CATCH_UP_MS);
      lastFrame = now;
      count.current = Math.min(goal, count.current + step);
      if (now - lastCommit >= COMMIT_MS || count.current >= goal) {
        lastCommit = now;
        setShown(targetRef.current.slice(0, Math.floor(count.current)));
      }
      if (count.current < goal) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [behind, target]);

  const revealing = live || shown.length < target.length;
  // A disk copy can replace the stream with a slightly different text.
  const text = revealing ? shown : target;
  return { text: revealing ? holdBackTable(text) : text, revealing };
}
