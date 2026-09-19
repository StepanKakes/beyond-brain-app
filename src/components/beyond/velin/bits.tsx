import { useEffect, useRef, useState } from 'react';

import type { MetricValues, Severity } from './api';

/**
 * Beyond Brain velín — the small shared pieces.
 *
 * Nothing here invents a visual language: severity is a chip, numbers are
 * tabular mono, and a missing value is rendered as a dash rather than a zero,
 * because in this data those two mean opposite things.
 */

const SEV_LABEL: Record<Severity, string> = {
  critical: 'kritické',
  watch: 'sledovat',
};

export function SeverityChip({ severity }: { severity: Severity }) {
  return (
    <span className="bb-sev" data-sev={severity}>
      {SEV_LABEL[severity]}
    </span>
  );
}

export function SectionHead({ title, count }: { title: string; count?: number | string }) {
  return (
    <div className="bb-sec">
      <span className="bb-sec__h">{title}</span>
      {count != null && <span className="bb-sec__n">{count}</span>}
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="bb-none">{children}</div>;
}

/** Czech day/month, no year unless it differs from the current one. */
export function formatDay(iso: string): string {
  const d = new Date(iso.length <= 10 ? `${iso}T12:00:00` : iso);
  if (Number.isNaN(d.getTime())) return iso;
  const now = new Date();
  const base = `${d.getDate()}. ${d.getMonth() + 1}.`;
  return d.getFullYear() === now.getFullYear() ? base : `${base} ${d.getFullYear()}`;
}

export function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' });
}

/** "dnes", "včera", "před 5 dny" — vague on purpose, this is for scanning. */
export function ago(iso: string | null): string {
  if (!iso) return '—';
  const t = Date.parse(iso.length <= 10 ? `${iso}T12:00:00Z` : iso);
  if (Number.isNaN(t)) return '—';
  const days = Math.floor((Date.now() - t) / 86_400_000);
  if (days <= 0) return 'dnes';
  if (days === 1) return 'včera';
  if (days < 31) return `${days} dní`;
  const months = Math.round(days / 30);
  return `${months} měs`;
}

export function formatCzk(value: number | null): string {
  if (value == null) return '—';
  return value.toLocaleString('cs-CZ');
}

/**
 * Czech day counts: 1 den · 2–4 dny · 5+ dní. These strings are read dozens of
 * times a day and "zbývá 1 dní" snags the eye every single time.
 */
export function days(n: number): string {
  const a = Math.abs(n);
  if (a === 1) return `${n} den`;
  if (a >= 2 && a <= 4) return `${n} dny`;
  return `${n} dní`;
}

/**
 * A metric value. The whole point of this component is the dash: a blank week
 * in `mereni.md` means "we don't know" and a 0 means "tried and it didn't
 * work", so an unknown must never be drawn as a zero.
 */
export function Metric({ value }: { value: number | null | undefined }) {
  if (value == null) {
    return (
      <span className="dim" title="Nevíme — v měření chybí hodnota">
        —
      </span>
    );
  }
  return <>{value.toLocaleString('cs-CZ')}</>;
}

/**
 * Sparkline over one metric across weeks, oldest to newest.
 *
 * Unknown weeks break the line instead of dropping it to zero, and the break is
 * drawn as a dotted bridge so a gap reads as a gap rather than as missing data
 * the viewer might not notice.
 */
export function Spark({
  history,
  metric,
  width = 84,
  height = 22,
}: {
  history: { isoWeek: string; values: MetricValues }[];
  metric: string;
  width?: number;
  height?: number;
}) {
  const series = [...history].reverse().map((w) => w.values[metric] ?? null);
  const known = series.filter((v): v is number => v != null);
  if (known.length < 2) return <span className="dim">—</span>;

  const max = Math.max(...known);
  const min = Math.min(...known);
  const span = max - min || 1;
  const stepX = series.length > 1 ? width / (series.length - 1) : width;
  const pad = 3;
  const y = (v: number) => height - pad - ((v - min) / span) * (height - pad * 2);

  // Split into runs of consecutive known points; bridge the holes with a dash.
  const runs: { x: number; y: number }[][] = [];
  let run: { x: number; y: number }[] = [];
  series.forEach((v, i) => {
    if (v == null) {
      if (run.length) runs.push(run);
      run = [];
    } else {
      run.push({ x: i * stepX, y: y(v) });
    }
  });
  if (run.length) runs.push(run);

  const last = runs[runs.length - 1]?.slice(-1)[0];

  return (
    <svg
      className="bb-spark"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`${metric}: ${series.map((v) => (v == null ? 'neznámo' : v)).join(', ')}`}
    >
      {runs.map((pts, i) => (
        <g key={i}>
          {i > 0 && (
            <line
              className="gap"
              x1={runs[i - 1].slice(-1)[0].x}
              y1={runs[i - 1].slice(-1)[0].y}
              x2={pts[0].x}
              y2={pts[0].y}
            />
          )}
          {pts.length > 1 ? (
            <polyline className="line" points={pts.map((p) => `${p.x},${p.y}`).join(' ')} />
          ) : null}
        </g>
      ))}
      {last && <circle className="dot" cx={last.x} cy={last.y} r={2} />}
    </svg>
  );
}

/**
 * Live call banner. A filled chip with a running count, not a pulsing dot: the
 * count says how long it has been going, which is the thing worth knowing, and
 * it does not blink at you while you work.
 */
export function LiveCall({ call }: { call: { title: string; startIso: string; endIso: string; meetingUrl: string | null; host: { name: string } | null; clientName: string | null } }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  const started = Date.parse(call.startIso);
  const mins = Number.isFinite(started) ? Math.max(0, Math.round((Date.now() - started) / 60_000)) : null;
  const who = call.host?.name || 'neznámý host';

  return (
    <div className="bb-live">
      <span className="bb-live__tag">právě běží</span>
      <span className="bb-live__t">
        {who} · {call.clientName || call.title}
      </span>
      {mins != null && <span className="bb-live__m">{mins} min</span>}
      {call.meetingUrl && (
        <a href={call.meetingUrl} target="_blank" rel="noopener noreferrer" className="bb-live__m">
          otevřít
        </a>
      )}
    </div>
  );
}

/** Poll a loader on an interval, pausing while the tab is hidden. */
export function usePolled<T>(load: () => Promise<T>, intervalMs = 120_000) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const run = async () => {
      try {
        const next = await loadRef.current();
        if (!cancelled) {
          setData(next);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Nepovedlo se načíst');
      } finally {
        if (!cancelled) setLoading(false);
        if (!cancelled) timer = setTimeout(run, intervalMs);
      }
    };

    void run();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void run();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [intervalMs]);

  return { data, error, loading, reload: () => loadRef.current().then(setData).catch(() => {}) };
}
