/**
 * Beyond Brain chat — small formatting and cross-component signals.
 */

/** Notify same-tab observers (sidebar dropdown etc.) that the per-client
 *  session index changed. Cross-PC continuity is handled by the server side. */
export function notifySessionsChanged(slug: string): void {
  window.dispatchEvent(new CustomEvent('beyond:sessions-changed', { detail: { slug } }));
}

/** First line of a message, trimmed to something that fits a session row. */
export function shortTitle(text: string): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length > 60 ? oneLine.slice(0, 60) + '…' : oneLine;
}

/** Czech relative age, coarse on purpose — session rows only need "how long
 *  ago, roughly", and a live-updating clock there would be noise. */
export function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const min = 60 * 1000;
  const h = 60 * min;
  const d = 24 * h;
  if (diff < min) return 'teď';
  if (diff < h) return `${Math.round(diff / min)} min`;
  if (diff < d) return `${Math.round(diff / h)} h`;
  return `${Math.round(diff / d)} d`;
}
