import { useMemo } from 'react';

/**
 * Beyond Brain — streaming text (transitions.dev streaming-text).
 *
 * Renders the actively-streaming assistant text word-by-word, each word
 * resolving through a soft cross-blur as it arrives ("words resolve through a
 * soft cross-blur"). Tokens are split on whitespace and keyed by index: because
 * a CSS entrance animation only fires on mount, an existing word whose text
 * grows across deltas (the word currently being typed) does NOT re-animate —
 * only genuinely new words do. Whitespace (incl. newlines) is preserved via
 * `white-space: pre-wrap`. Once the turn completes the caller swaps this for the
 * full Markdown render, so this is plain-text-only by design.
 */

export default function StreamingText({ text }: { text: string }) {
  const tokens = useMemo(() => text.split(/(\s+)/), [text]);
  return (
    <p className="bb-stream">
      {tokens.map((tok, i) =>
        tok === '' ? null : /^\s+$/.test(tok) ? (
          <span key={i}>{tok}</span>
        ) : (
          <span key={i} className="bb-stream__w">
            {tok}
          </span>
        ),
      )}
    </p>
  );
}
