import type { TokenBudget } from './types';

/**
 * Compact context-usage chip in the composer footer. Shows the live size of
 * Claude's current context window (re-sent every turn), not cumulative spend.
 * Color thresholds key off the SDK's `autoCompactThreshold` when available so
 * the user sees red exactly when auto-compact is about to fire.
 */
export default function TokenBudgetChip({ budget }: { budget: TokenBudget | null }) {
  // Always render — the chip is visible from the moment the chat opens, even
  // before the first turn (or before a resumed session's backfill arrives).
  if (!budget || budget.total <= 0) {
    return (
      <div
        className="flex items-center gap-1.5 rounded-full px-2 py-1 text-[11px] text-beyond-faint"
        title="Kontext zatím prázdný — počká na první odpověď"
      >
        <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-neutral-300" aria-hidden />
        <span>—</span>
      </div>
    );
  }

  const pct = Math.min(100, (budget.used / budget.total) * 100);
  // If the SDK gave us a real auto-compact threshold use it; otherwise pick
  // sensible defaults (50 % blue, 75 % amber, beyond red).
  const compactPct = budget.autoCompactThreshold
    ? (budget.autoCompactThreshold / budget.total) * 100
    : null;
  const color = compactPct
    ? pct < compactPct * 0.7
      ? 'bg-blue-500'
      : pct < compactPct
        ? 'bg-amber-500'
        : 'bg-red-500'
    : pct < 50
      ? 'bg-blue-500'
      : pct < 75
        ? 'bg-amber-500'
        : 'bg-red-500';
  const usedK = budget.used >= 1000 ? `${(budget.used / 1000).toFixed(1)}k` : `${budget.used}`;
  // Render very large totals (Opus 4.7's 1M window) as "1M" instead of "1000k".
  const totalK =
    budget.total >= 1_000_000
      ? `${(budget.total / 1_000_000).toFixed(budget.total % 1_000_000 === 0 ? 0 : 1)}M`
      : `${Math.round(budget.total / 1000)}k`;

  const tooltipLines = [
    `${budget.used.toLocaleString()} / ${budget.total.toLocaleString()} tokenů v kontextu`,
  ];
  if (budget.autoCompactThreshold) {
    tooltipLines.push(`Auto-compact při ${budget.autoCompactThreshold.toLocaleString()} tokenech`);
  }
  if (budget.isAutoCompactEnabled === false) {
    tooltipLines.push('Auto-compact je vypnutý');
  }

  return (
    <div
      className="flex items-center gap-1.5 rounded-full px-2 py-1 text-[11px] text-beyond-faint"
      title={tooltipLines.join('\n')}
    >
      <span className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${color}`} aria-hidden />
      <span>
        {pct.toFixed(0)} % · {usedK} / {totalK}
      </span>
    </div>
  );
}
