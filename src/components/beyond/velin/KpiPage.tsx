import { useCallback, useMemo, useState } from 'react';

import { Tabs } from '../ui';

import { fetchKpi, type Kpi, type KpiArea, type KpiMetric, type KpiWeek } from './api';
import { Empty, SectionHead, formatDay, usePolled } from './bits';

/**
 * Beyond Brain — KPI for the Q4 brute force quarter.
 *
 * Actual against the week's target, colored by how much of it is done, and a
 * twelve week trend under each metric. Unknown is never a zero: a week the
 * kpi-raw job could not fill is drawn as a gap and the tile says "chybí data".
 *
 * Colors are status, not series: green done, amber close, red far, grey
 * unknown. Every color travels with a word, so nothing is color alone.
 * The current week is judged by pace (target times days gone), otherwise
 * every Monday would be red.
 */

type Mode = 'week' | 'month';
type Status = 'good' | 'warn' | 'bad' | 'none' | 'missing';

const STATUS_LABEL: Record<Status, string> = {
  good: 'splněno',
  warn: 'blízko',
  bad: 'pod cílem',
  none: 'bez cíle',
  missing: 'chybí data',
};

const AREAS: { key: KpiArea; title: string; monthly: boolean }[] = [
  { key: 'akvizice', title: 'Akvizice (Beo)', monthly: false },
  { key: 'cally', title: 'Cally (Cal.com)', monthly: true },
  { key: 'trzby', title: 'Tržby', monthly: true },
  { key: 'reklama', title: 'Reklama', monthly: false },
  { key: 'obsah', title: 'Obsah', monthly: false },
];

/** The top row, in reading order: the goal first, then what feeds it. */
const HEADLINE = ['icpHappened', 'icpBooked', 'showUp', 'revenue', 'newLeads', 'unread', 'adSpend', 'costPerIcpCall', 'reels', 'youtube'];

/** Unread above zero is amber up to this many, red beyond. */
const ZERO_TOLERANCE = 3;

const MONTHS_CS = ['leden', 'únor', 'březen', 'duben', 'květen', 'červen', 'červenec', 'srpen', 'září', 'říjen', 'listopad', 'prosinec'];

function monthLabel(m: string): string {
  const idx = Number(m.slice(5, 7)) - 1;
  return MONTHS_CS[idx] || m;
}

function weekNo(week: string): string {
  return String(Number(week.slice(-2)));
}

function fmt(v: number | null | undefined, unit: KpiMetric['unit']): string {
  if (v == null) return '—';
  if (unit === 'pct') return `${Math.round(v)} %`;
  if (unit === 'czk') return `${Math.round(v).toLocaleString('cs-CZ')} Kč`;
  return Number.isInteger(v) ? v.toLocaleString('cs-CZ') : v.toLocaleString('cs-CZ', { maximumFractionDigits: 1 });
}

function fmtShort(v: number, unit: KpiMetric['unit']): string {
  if (unit === 'pct') return `${Math.round(v)} %`;
  if (v >= 1000) return `${Math.round(v / 1000).toLocaleString('cs-CZ')}k`;
  return Number.isInteger(v) ? String(v) : v.toLocaleString('cs-CZ', { maximumFractionDigits: 1 });
}

/** `pace` is the share of the period that has passed (1 for a closed one). */
function statusOf(value: number | null | undefined, target: number | null | undefined, m: KpiMetric, pace = 1): Status {
  if (value == null) return 'missing';
  if (target == null) return 'none';
  if (m.dir === 'max') {
    const expected = m.agg === 'sum' ? target * pace : target;
    if (expected <= 0) return 'good';
    const pct = (value / expected) * 100;
    return pct >= 100 ? 'good' : pct >= 60 ? 'warn' : 'bad';
  }
  if (value <= target) return 'good';
  if (target <= 0) return value <= ZERO_TOLERANCE ? 'warn' : 'bad';
  const pct = (target / value) * 100;
  return pct >= 60 ? 'warn' : 'bad';
}

function pctOf(value: number | null | undefined, target: number | null | undefined, m: KpiMetric): number | null {
  if (value == null || target == null) return null;
  if (m.dir === 'max') return target > 0 ? Math.round((value / target) * 100) : null;
  if (value <= 0) return 100;
  return target > 0 ? Math.round((target / value) * 100) : null;
}

/** Share of the current week or month that has passed, in days. */
function paceOfWeek(w: KpiWeek): number {
  if (w.status !== 'current') return 1;
  const days = Math.floor((Date.now() - Date.parse(`${w.from}T00:00:00`)) / 86_400_000) + 1;
  return Math.min(1, Math.max(1 / 7, days / 7));
}
function paceOfMonth(month: string): number {
  const now = new Date();
  const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  if (ym !== month) return ym > month ? 1 : 0;
  const daysIn = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  return Math.max(1 / daysIn, now.getDate() / daysIn);
}

export default function KpiPage() {
  const load = useCallback(() => fetchKpi(), []);
  const { data, error, loading, reload } = usePolled<Kpi>(load, 300_000);
  const [mode, setMode] = useState<Mode>('week');

  if (loading && !data) {
    return (
      <div className="bb-vel">
        <div className="bb-vel__in">
          <p className="bb-vel__sub">Počítám KPI…</p>
        </div>
      </div>
    );
  }
  if (error && !data) {
    return (
      <div className="bb-vel">
        <div className="bb-vel__in">
          <h1 className="bb-vel__title">KPI</h1>
          <Empty>Nepovedlo se načíst: {error}</Empty>
        </div>
      </div>
    );
  }
  if (!data) return null;

  return (
    <KpiBody
      data={data}
      mode={mode}
      onMode={setMode}
      onRefresh={() => {
        // Forcing refills the server cache (Cal.com included), the reload then reads it.
        void fetchKpi(true).then(() => reload(), () => reload());
      }}
    />
  );
}

function KpiBody({ data, mode, onMode, onRefresh }: { data: Kpi; mode: Mode; onMode: (m: Mode) => void; onRefresh: () => void }) {
  const metrics = useMemo(() => Object.fromEntries(data.metrics.map((m) => [m.key, m])), [data.metrics]);
  const current = data.weeks.find((w) => w.week === data.currentWeek) || null;
  const currentMonth = current ? data.months.find((m) => m.month === current.month) || null : null;
  const pace = current ? paceOfWeek(current) : 1;
  const dayOfWeek = Math.round(pace * 7);
  const monthAreas = new Set(AREAS.filter((a) => a.monthly).map((a) => a.key));

  const errors = [...data.errors, ...(current?.errors || [])];

  return (
    <div className="bb-vel bb-kpi">
      <div className="bb-vel__in">
        <header className="bb-vel__head">
          <div>
            <h1 className="bb-vel__title">KPI</h1>
            <p className="bb-vel__sub">
              Q4 {formatDay(data.period.from)} až {formatDay(data.period.to)}
              {current
                ? ` · týden ${weekNo(current.week)} (${formatDay(current.from)} až ${formatDay(current.to)}), den ${dayOfWeek} ze 7`
                : ' · mimo období'}
              {current?.updatedAt ? ` · Beo ${new Date(current.updatedAt).toLocaleString('cs-CZ', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' })}` : ''}
            </p>
          </div>
          <div className="bb-kpi__ctl">
            <Tabs
              items={[
                { key: 'week', label: 'Týden' },
                { key: 'month', label: 'Měsíc' },
              ]}
              value={mode}
              onChange={(k) => onMode(k as Mode)}
              label="Tržby a cally po týdnech nebo měsících"
            />
            <button type="button" className="bb-kpi__refresh" onClick={onRefresh}>
              Obnovit
            </button>
          </div>
        </header>

        {!data.configured && (
          <Empty>
            Chybí soubor s cíli <code>workspace/kpi/cile.json</code>. Čísla se ukážou, ale bez porovnání s cílem.
          </Empty>
        )}
        {!data.hasWeekFiles && (
          <Empty>
            Data se stáhnou ráno úlohou kpi-raw. Do té doby tu jsou jen cally z Cal.com, zbytek je šedý.
          </Empty>
        )}
        {!data.calcom.configured && <Empty>Cal.com není napojený (BEYOND_CALCOM_API_KEY), cally chybí.</Empty>}

        {current && (
          <section>
            <SectionHead title={mode === 'month' && currentMonth ? `Tento týden, tržby a cally za ${monthLabel(currentMonth.month)}` : 'Tento týden'} />
            <div className="bb-kpi__tiles">
              {HEADLINE.map((key) => {
                const m = metrics[key];
                if (!m) return null;
                const useMonth = mode === 'month' && currentMonth && monthAreas.has(m.area) && key in currentMonth.values;
                const value = useMonth ? currentMonth.values[key] : current.values[key];
                const target = useMonth ? currentMonth.targets[key] : current.targets[key];
                const p = useMonth ? paceOfMonth(currentMonth.month) : pace;
                return <Tile key={key} metric={m} value={value} target={target} status={statusOf(value, target, m, p)} running={p < 1 && m.agg === 'sum'} />;
              })}
            </div>
          </section>
        )}

        {errors.length > 0 && (
          <div className="bb-kpi__errs">
            <b>Co chybí:</b> {errors.join(' · ')}
          </div>
        )}

        {AREAS.map((area) => {
          const list = data.metrics.filter((m) => m.area === area.key);
          const byMonth = mode === 'month' && area.monthly;
          return (
            <section key={area.key}>
              <SectionHead title={area.title} count={byMonth ? 'po měsících' : `${data.weeks.length} týdnů`} />
              <div className="bb-band">
                {list.map((m) => (
                  <TrendRow key={m.key} metric={m} data={data} byMonth={byMonth} />
                ))}
              </div>
              {area.key === 'akvizice' && current && <SourceTable week={current} />}
            </section>
          );
        })}

        <p className="bb-vel__sub">
          ICP cally = typy událostí {data.calcom.events.join(', ')}. No show jen když ho někdo v Cal.com označí. Spend na
          proběhlý ICP call počítá s cally ze všech zdrojů. Cíle v workspace/kpi/cile.json.
        </p>
      </div>
    </div>
  );
}

function Tile({ metric, value, target, status, running }: { metric: KpiMetric; value: number | null | undefined; target: number | null | undefined; status: Status; running: boolean }) {
  const pct = pctOf(value, target, metric);
  return (
    <div className="bb-kpi__tile" data-st={status}>
      <span className="bb-kpi__tl">{metric.label}</span>
      <span className="bb-kpi__tv">{value == null ? '—' : fmt(value, metric.unit)}</span>
      <span className="bb-kpi__tt">
        {target != null ? `cíl ${metric.dir === 'min' ? 'nejvýš ' : ''}${fmt(target, metric.unit)}` : 'bez cíle'}
        {pct != null && metric.dir === 'max' ? ` · ${pct} %` : ''}
      </span>
      <span className="bb-kpi__meter" aria-hidden>
        <span style={{ width: `${Math.min(100, Math.max(0, pct ?? 0))}%` }} />
      </span>
      <span className="bb-kpi__st" data-st={status}>
        {STATUS_LABEL[status]}
        {running && status !== 'missing' && status !== 'none' ? ', průběžně' : ''}
      </span>
    </div>
  );
}

type Point = { key: string; label: string; detail: string; value: number | null; target: number | null; status: Status; future: boolean; current: boolean };

function TrendRow({ metric, data, byMonth }: { metric: KpiMetric; data: Kpi; byMonth: boolean }) {
  const points: Point[] = byMonth
    ? data.months.map((mo) => {
        const value = mo.values[metric.key] ?? null;
        const target = mo.targets[metric.key] ?? null;
        const pace = paceOfMonth(mo.month);
        return {
          key: mo.month,
          label: monthLabel(mo.month).slice(0, 3),
          detail: monthLabel(mo.month),
          value: pace === 0 ? null : value,
          target,
          status: statusOf(value, target, metric, pace || 1),
          future: pace === 0,
          current: pace > 0 && pace < 1,
        };
      })
    : data.weeks.map((w) => {
        const value = w.values[metric.key] ?? null;
        const target = w.targets[metric.key] ?? null;
        return {
          key: w.week,
          label: weekNo(w.week),
          detail: `týden ${weekNo(w.week)}, ${formatDay(w.from)} až ${formatDay(w.to)}`,
          value: w.status === 'future' ? null : value,
          target,
          status: w.status === 'future' ? 'missing' : statusOf(value, target, metric, paceOfWeek(w)),
          future: w.status === 'future',
          current: w.status === 'current',
        };
      });

  const [hover, setHover] = useState<number | null>(null);
  const focus = hover ?? Math.max(0, points.findIndex((p) => p.current));
  const fp = points[focus];

  return (
    <div className="bb-kpi__row">
      <div className="bb-kpi__rl">
        <span className="bb-kpi__rn">{metric.label}</span>
        <span className="bb-kpi__rd">
          {fp ? (
            <>
              {fp.detail}: <b>{fp.future ? 'teprve přijde' : fmt(fp.value, metric.unit)}</b>
              {fp.target != null ? ` z ${fmt(fp.target, metric.unit)}` : ''}
              {!fp.future && <span className="bb-kpi__st" data-st={fp.status}>{STATUS_LABEL[fp.status]}</span>}
            </>
          ) : null}
        </span>
      </div>
      <Bars points={points} unit={metric.unit} hover={hover} onHover={setHover} label={metric.label} />
    </div>
  );
}

const BAR_SLOT = 30;
const BAR_W = 20;
const CHART_H = 64;
const AXIS_H = 14;
const TOP_PAD = 12;

/** Rounded data end, square at the baseline. */
function barPath(x: number, y: number, w: number, h: number): string {
  const r = Math.min(4, h, w / 2);
  const b = y + h;
  return `M${x},${b} L${x},${y + r} Q${x},${y} ${x + r},${y} L${x + w - r},${y} Q${x + w},${y} ${x + w},${y + r} L${x + w},${b} Z`;
}

function Bars({ points, unit, hover, onHover, label }: { points: Point[]; unit: KpiMetric['unit']; hover: number | null; onHover: (i: number | null) => void; label: string }) {
  const known = points.flatMap((p) => [p.value, p.target]).filter((v): v is number => v != null);
  const max = Math.max(unit === 'pct' ? 100 : 1, ...known);
  const width = points.length * BAR_SLOT;
  const plotH = CHART_H - TOP_PAD;
  const y = (v: number) => TOP_PAD + plotH - (v / max) * plotH;
  const summary = points.map((p) => `${p.label}: ${p.value == null ? 'neznámo' : fmt(p.value, unit)}`).join(', ');

  return (
    <svg
      className="bb-kpi__bars"
      viewBox={`0 0 ${width} ${CHART_H + AXIS_H}`}
      width={width}
      height={CHART_H + AXIS_H}
      role="img"
      aria-label={`${label}: ${summary}`}
      onMouseLeave={() => onHover(null)}
    >
      <line className="base" x1={0} x2={width} y1={CHART_H + 0.5} y2={CHART_H + 0.5} />
      <text className="tick" x={0} y={8}>
        {fmtShort(max, unit)}
      </text>
      {points.map((p, i) => {
        const x = i * BAR_SLOT + (BAR_SLOT - BAR_W) / 2;
        const h = p.value != null ? Math.max(p.value > 0 ? 2 : 0, CHART_H - y(p.value)) : 0;
        return (
          <g key={p.key} data-on={hover === i ? 'true' : undefined}>
            {p.future ? (
              <rect className="future" x={x} y={TOP_PAD} width={BAR_W} height={plotH} rx={4} />
            ) : p.value == null ? (
              <line className="gap" x1={x} x2={x + BAR_W} y1={CHART_H - 3} y2={CHART_H - 3} />
            ) : h > 0 ? (
              <path className="bar" data-st={p.status} d={barPath(x, CHART_H - h, BAR_W, h)} />
            ) : null}
            {p.target != null && !p.future && (
              <line className="target" x1={x - 3} x2={x + BAR_W + 3} y1={y(p.target)} y2={y(p.target)} />
            )}
            <text className="axis" data-cur={p.current ? 'true' : undefined} x={i * BAR_SLOT + BAR_SLOT / 2} y={CHART_H + AXIS_H - 2} textAnchor="middle">
              {p.label}
            </text>
            {/* Hit target: the whole slot, bigger than the mark. */}
            <rect
              className="hit"
              x={i * BAR_SLOT}
              y={0}
              width={BAR_SLOT}
              height={CHART_H + AXIS_H}
              onMouseEnter={() => onHover(i)}
              onFocus={() => onHover(i)}
              onBlur={() => onHover(null)}
              tabIndex={0}
            >
              <title>
                {`${p.detail}: ${p.future ? 'teprve přijde' : fmt(p.value, unit)}${p.target != null ? `, cíl ${fmt(p.target, unit)}` : ''}`}
              </title>
            </rect>
          </g>
        );
      })}
    </svg>
  );
}

function SourceTable({ week }: { week: KpiWeek }) {
  const rows = week.leadsBySource;
  const total = rows?.reduce((n, r) => n + r.count, 0) ?? 0;
  return (
    <div className="bb-kpi__src">
      <div className="bb-kpi__srch">Nové leady podle zdroje, týden {weekNo(week.week)}</div>
      {!rows ? (
        <Empty>Chybí data. Rozpad podle workflow přijde s ranním během kpi-raw.</Empty>
      ) : rows.length === 0 ? (
        <Empty>Tento týden žádný nový lead.</Empty>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Zdroj (workflow)</th>
              <th className="n">Leady</th>
              <th className="n">Podíl</th>
              <th aria-hidden />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const share = total > 0 ? Math.round((r.count / total) * 100) : 0;
              return (
                <tr key={r.source}>
                  <td>{r.source}</td>
                  <td className="n">{r.count}</td>
                  <td className="n">{share} %</td>
                  <td className="bar">
                    <span style={{ width: `${share}%` }} />
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td>Celkem</td>
              <td className="n">{total}</td>
              <td className="n" />
              <td />
            </tr>
          </tfoot>
        </table>
      )}
    </div>
  );
}
