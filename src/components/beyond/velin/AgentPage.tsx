import { useCallback, useState } from 'react';
import { Play } from 'lucide-react';

import { authenticatedFetch } from '../../../utils/api';
import { Empty, SectionHead, ago, usePolled } from './bits';
import Proposals from './Proposals';

/**
 * Beyond Brain — what the agent did, and the switch that stops it.
 *
 * An agent that writes to the brain on its own is only acceptable if its work
 * is inspectable after the fact. Every run shows what triggered it, what it
 * says it did, and — separately — a git diff of what actually changed, because
 * those two are not the same claim.
 */

type Job = {
  name: string;
  title: string;
  description: string;
  cadence: string;
  custom: boolean;
  enabled: boolean;
  lastRunAt: string | null;
  lastStatus: string | null;
  lastError: string | null;
  failureStreak: number;
  createdBy: string | null;
};

type EventRow = {
  id: number;
  route: string;
  event: string | null;
  job: string;
  status: 'pending' | 'waiting' | 'running' | 'done' | 'error' | 'ignored';
  count: number;
  receivedAt: string;
  error: string | null;
};

type RouteRow = {
  name: string;
  description: string | null;
  job: string | null;
  enabled: boolean;
  configured: boolean;
  auth: string;
};

type MozekItem = {
  id: number;
  path: string;
  kind: string;
  before: string | null;
  after: string;
  reason: string | null;
  source: string | null;
  createdAt: string;
};

type Memory = { title: string; entries: string[]; usage: { used: number; limit: number; pct: number } };

type SettingItem = {
  group: string;
  key: string;
  label: string;
  hint?: string;
  placeholder?: string;
  secret?: boolean;
  restart?: boolean;
  set: boolean;
  source: 'app' | 'env' | null;
  display: string;
  updatedAt: string | null;
  updatedBy: string | null;
};

/**
 * Keys and switches the server needs, editable here so nobody has to open
 * the box and edit .env. A value saved here wins over .env.
 */
type UsageSum = { runs: number; input: number; output: number; cache_read: number; cache_write: number; cost_usd: number; errors: number };
type Usage = {
  periods: { today: UsageSum; week: UsageSum; month: UsageSum };
  bySource: (UsageSum & { source: string; label: string | null })[];
  byModel: (UsageSum & { model: string | null })[];
  byDay: (UsageSum & { day: string })[];
  recent: { ts: string; source: string; label: string | null; actor: string | null; model: string | null; input: number; output: number; cache_read: number; cache_write: number; cost_usd: number; duration_ms: number | null; turns: number | null; is_error: number }[];
  limits:
    | { available: true; subscription: string | null; fetchedAt: string; windows: { kind: string; label: string; percent: number; severity: string; resetsAt: string | null }[]; extra: { used: number | null; limit: number | null; currency: string | null } | null }
    | { available: false; reason: string };
};

const fmtK = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));
const fmtUsd = (n: number) => `$${n.toFixed(n >= 10 ? 0 : 2)}`;
const SOURCE_LABEL: Record<string, string> = { chat: 'Chat', job: 'Úloha', telegram: 'Telegram', agent: 'Agent', velin: 'Velín', voice: 'Hlasovka' };

function sourceName(r: { source: string; label: string | null }) {
  const base = SOURCE_LABEL[r.source] || r.source;
  if (r.source === 'job') return r.label || base;
  if (r.source === 'chat') return r.label ? r.label.replace(/^Beyond · /, 'Chat: ') : base;
  return r.label ? `${base}: ${r.label}` : base;
}

function resetIn(iso: string | null): string {
  if (!iso) return '';
  const ms = Date.parse(iso) - Date.now();
  if (!Number.isFinite(ms)) return '';
  if (ms <= 0) return 'resetuje se';
  const h = Math.floor(ms / 3_600_000);
  const m = Math.round((ms % 3_600_000) / 60_000);
  const at = new Date(iso).toLocaleString('cs-CZ', { weekday: 'short', hour: '2-digit', minute: '2-digit' });
  return h >= 24 ? `reset ${new Date(iso).toLocaleString('cs-CZ', { weekday: 'short', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' })}` : `reset za ${h} h ${m} min (${at})`;
}

/**
 * Where the tokens went and how much of the account is left. Cost is what the
 * same work would have cost on the API; on a subscription it is a measure,
 * not a bill.
 */
function UsageSection() {
  const load = useCallback(async () => {
    const res = await authenticatedFetch('/api/beyond/velin/spotreba');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as Usage;
  }, []);
  const u = usePolled<Usage>(load, 60_000);
  const d = u.data;
  if (!d) return (
    <section>
      <SectionHead title="Spotřeba" />
      <Empty>{u.error ? `Nepovedlo se načíst: ${u.error}` : 'Počítám…'}</Empty>
    </section>
  );
  const maxDay = Math.max(1, ...d.byDay.map((x) => x.cost_usd));
  return (
    <section>
      <SectionHead title="Spotřeba" />
      <div className="bb-us">
        <div className="bb-us__limits">
          {d.limits.available ? (
            <>
              {d.limits.windows.map((w) => (
                <div key={w.kind} className="bb-us__win" data-sev={w.severity}>
                  <div className="bb-us__wl"><span>{w.label}</span><b>{w.percent} %</b></div>
                  <div className="bb-us__bar"><i style={{ width: `${Math.min(100, w.percent)}%` }} /></div>
                  <div className="bb-us__wr">{resetIn(w.resetsAt)}</div>
                </div>
              ))}
              <p className="bb-us__note">Účet Claude {d.limits.subscription ? `(${d.limits.subscription})` : ''} na stroji, stejné číslo jako /usage v Claude Code.{d.limits.extra ? ` Extra kredit: ${d.limits.extra.used ?? 0} z ${d.limits.extra.limit ?? '?'} ${d.limits.extra.currency || ''}.` : ''}</p>
            </>
          ) : (
            <Empty>Limity účtu nejdou přečíst: {d.limits.reason}</Empty>
          )}
        </div>

        <div className="bb-us__periods">
          {(['today', 'week', 'month'] as const).map((k) => {
            const p = d.periods[k];
            return (
              <div key={k} className="bb-us__period">
                <span className="bb-us__pl">{k === 'today' ? 'Dnes' : k === 'week' ? '7 dní' : '30 dní'}</span>
                <b className="bb-us__pv">{fmtUsd(p.cost_usd || 0)}</b>
                <span className="bb-us__pm">{p.runs || 0} běhů · {fmtK((p.input || 0) + (p.cache_read || 0) + (p.cache_write || 0))} in · {fmtK(p.output || 0)} out{p.errors ? ` · ${p.errors} chyb` : ''}</span>
              </div>
            );
          })}
        </div>

        <div className="bb-us__days" aria-label="Spotřeba po dnech, 14 dní">
          {d.byDay.map((x) => (
            <div key={x.day} className="bb-us__day" title={`${x.day}: ${fmtUsd(x.cost_usd)}, ${x.runs} běhů`}>
              <i style={{ height: `${Math.max(2, (x.cost_usd / maxDay) * 100)}%` }} />
              <span>{x.day.slice(8)}.</span>
            </div>
          ))}
        </div>

        <div className="bb-us__cols">
          <div>
            <p className="bb-set__g">Kde, posledních 7 dní</p>
            <table className="bb-us__t">
              <tbody>
                {d.bySource.map((r, i) => (
                  <tr key={i}>
                    <td>{sourceName(r)}</td>
                    <td className="bb-us__num">{r.runs}×</td>
                    <td className="bb-us__num">{fmtK((r.input || 0) + (r.cache_read || 0) + (r.cache_write || 0))} in</td>
                    <td className="bb-us__num">{fmtK(r.output || 0)} out</td>
                    <td className="bb-us__num"><b>{fmtUsd(r.cost_usd || 0)}</b></td>
                  </tr>
                ))}
                {d.bySource.length === 0 && <tr><td colSpan={5} className="bb-us__empty">Zatím nic zaznamenaného; sbírá se od teď.</td></tr>}
              </tbody>
            </table>
          </div>
          <div>
            <p className="bb-set__g">Modely, posledních 7 dní</p>
            <table className="bb-us__t">
              <tbody>
                {d.byModel.map((r, i) => (
                  <tr key={i}>
                    <td>{r.model || 'neznámý'}</td>
                    <td className="bb-us__num">{r.runs}×</td>
                    <td className="bb-us__num">{fmtK(r.output || 0)} out</td>
                    <td className="bb-us__num"><b>{fmtUsd(r.cost_usd || 0)}</b></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <details className="bb-us__recent">
          <summary>Posledních {d.recent.length} běhů</summary>
          <table className="bb-us__t">
            <tbody>
              {d.recent.map((r, i) => (
                <tr key={i} data-err={r.is_error ? 'true' : undefined}>
                  <td className="bb-us__ts">{new Date(r.ts).toLocaleString('cs-CZ', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
                  <td>{sourceName(r)}{r.actor && r.source !== 'job' ? ` · ${r.actor}` : ''}</td>
                  <td className="bb-us__num">{r.model || ''}</td>
                  <td className="bb-us__num">{fmtK((r.input || 0) + (r.cache_read || 0) + (r.cache_write || 0))} / {fmtK(r.output || 0)}</td>
                  <td className="bb-us__num">{r.duration_ms != null ? `${Math.round(r.duration_ms / 1000)} s` : ''}</td>
                  <td className="bb-us__num"><b>{fmtUsd(r.cost_usd || 0)}</b></td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      </div>
    </section>
  );
}

function SettingsSection() {
  const load = useCallback(async () => {
    const res = await authenticatedFetch('/api/beyond/velin/nastaveni');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return ((await res.json()) as { items: SettingItem[] }).items;
  }, []);
  const { data, reload } = usePolled<SettingItem[]>(load, 120_000);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const items = data || [];
  const groups = [...new Set(items.map((i) => i.group))];

  const saveAll = async () => {
    if (!Object.keys(edits).length) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await authenticatedFetch('/api/beyond/velin/nastaveni', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: edits }),
      });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; changed?: string[] };
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      const needsRestart = items.filter((i) => body.changed?.includes(i.key) && i.restart).map((i) => i.label);
      setMsg(`Uloženo: ${(body.changed || []).length}. ${needsRestart.length ? `Restart služby potřebuje: ${needsRestart.join(', ')}.` : 'Platí hned.'}`);
      setEdits({});
      void reload();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'uložení selhalo');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <SectionHead title="Napojení a klíče" count={items.filter((i) => i.set).length ? `${items.filter((i) => i.set).length} nastaveno` : undefined} />
      <Empty>
        Co je tady, platí místo <code>.env</code> na stroji. Tajné hodnoty se zobrazují zkrácené, prázdné pole znamená nenastaveno.
        Vymazat = uložit prázdné.
      </Empty>
      {groups.map((g) => (
        <div key={g} className="bb-set__group">
          <p className="bb-set__g">{g}</p>
          {items.filter((i) => i.group === g).map((i) => (
            <label key={i.key} className="bb-set__row">
              <span className="bb-set__l">
                {i.label}
                {i.source === 'env' && <small>z .env</small>}
                {i.source === 'app' && i.updatedBy && <small>{i.updatedBy}</small>}
              </span>
              <input
                className="bb-set__in"
                type={i.secret ? 'password' : 'text'}
                autoComplete="off"
                placeholder={i.set ? i.display : i.placeholder || ''}
                value={edits[i.key] ?? ''}
                onChange={(e) => setEdits((cur) => ({ ...cur, [i.key]: e.target.value }))}
              />
              {i.hint && <span className="bb-set__h">{i.hint}</span>}
            </label>
          ))}
        </div>
      ))}
      <div className="bb-set__acts">
        <button type="button" className="bb-pill bb-pill--primary" disabled={busy || !Object.keys(edits).length} onClick={() => void saveAll()}>
          Uložit
        </button>
        {msg && <span className="bb-set__msg">{msg}</span>}
      </div>
    </section>
  );
}

type Run = {
  id: number;
  job: string;
  trigger: { kind: string; detail: string | null };
  status: 'running' | 'ok' | 'error' | 'skipped';
  startedAt: string;
  durationMs: number | null;
  summary: string | null;
  changed: string | null;
  error: string | null;
};

type AgentData = {
  scheduler: { enabled: boolean; paused: boolean; running: string | null; tickMs: number; pendingEvents: number };
  jobs: Job[];
  runs: Run[];
  events: EventRow[];
  routes: RouteRow[];
  mozek: { pending: number };
  pamet: { agent: Memory; tim: Memory };
};

const EVENT_LABEL: Record<EventRow['status'], string> = {
  pending: 'čeká',
  waiting: 'sbírá',
  running: 'běží',
  done: 'hotovo',
  error: 'chyba',
  ignored: 'ignorováno',
};

/** Lines that are only in one of the two texts. Enough to see what a proposal does. */
function roughDiff(before: string | null, after: string): { removed: string[]; added: string[] } {
  const a = new Set((before || '').split('\n'));
  const b = new Set(after.split('\n'));
  return {
    removed: [...a].filter((l) => l.trim() && !b.has(l)),
    added: [...b].filter((l) => l.trim() && !a.has(l)),
  };
}

function MozekQueue({ onChange }: { onChange: () => void }) {
  const load = useCallback(async () => {
    const res = await authenticatedFetch('/api/beyond/velin/agent/mozek');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return ((await res.json()) as { items: MozekItem[] }).items;
  }, []);
  const { data, reload } = usePolled<MozekItem[]>(load, 30_000);
  const [open, setOpen] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const items = data || [];

  const act = async (id: number, what: 'schvalit' | 'zahodit') => {
    setErr(null);
    const res = await authenticatedFetch(`/api/beyond/velin/agent/mozek/${id}/${what}`, { method: 'POST' });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setErr(body.error || `HTTP ${res.status}`);
    }
    void reload();
    onChange();
  };

  return (
    <section>
      <SectionHead title="Návrhy do mozku" count={items.length} />
      {err && <Empty>{err}</Empty>}
      {items.length === 0 ? (
        <Empty>
          Nic nečeká. Když agent narazí na opravu, která se opakuje, navrhne tu změnu skillu nebo
          pravidla. Schválení ji zapíše a commitne, zahození ji smaže.
        </Empty>
      ) : (
        <div className="bb-sig">
          {items.map((m) => {
            const isOpen = open === m.id;
            const d = roughDiff(m.before, m.after);
            return (
              <div key={m.id} className="bb-sig__row" style={{ cursor: 'default' }}>
                <span className="bb-sev">{m.kind === 'skill' ? 'skill' : 'pravidlo'}</span>
                <span className="bb-sig__who">
                  {ago(m.createdAt)}
                  {m.source ? ` · ${m.source}` : ''}
                </span>
                <span className="bb-sig__t">{m.path.replace(/^\.claude\/skills\//, '').replace(/\.md$/, '')}</span>
                <span className="bb-sig__d">{m.reason}</span>
                <span className="bb-sig__m">
                  <button type="button" className="bb-pill" onClick={() => setOpen(isOpen ? null : m.id)}>
                    {isOpen ? 'Skrýt změnu' : `Ukázat změnu (+${d.added.length} / −${d.removed.length})`}
                  </button>
                  {isOpen && (
                    <pre className="bb-pre" style={{ whiteSpace: 'pre-wrap', margin: '8px 0 0', padding: '8px 10px', borderRadius: 10, fontSize: 11.5 }}>
                      {d.removed.map((l) => `− ${l}`).concat(d.added.map((l) => `+ ${l}`)).join('\n') || '(jen přesuny řádků)'}
                    </pre>
                  )}
                </span>
                <span className="bb-sig__go" style={{ opacity: 1, display: 'flex', gap: 6, alignItems: 'center' }}>
                  <button type="button" className="bb-pill" onClick={() => void act(m.id, 'schvalit')}>
                    Schválit
                  </button>
                  <button type="button" className="bb-pill" onClick={() => void act(m.id, 'zahodit')}>
                    Zahodit
                  </button>
                </span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

const STATUS_LABEL: Record<Run['status'], string> = {
  running: 'běží',
  ok: 'hotovo',
  error: 'chyba',
  skipped: 'nic k práci',
};

export default function AgentPage() {
  const load = useCallback(async () => {
    const res = await authenticatedFetch('/api/beyond/velin/agent');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as AgentData;
  }, []);
  const { data, error, loading, reload } = usePolled<AgentData>(load, 20_000);
  const [busy, setBusy] = useState<string | null>(null);
  const [openRun, setOpenRun] = useState<number | null>(null);

  const post = async (path: string, body?: unknown) => {
    await authenticatedFetch(`/api/beyond/velin${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    setTimeout(() => void reload(), 900);
  };

  if (loading && !data) {
    return (
      <div className="bb-vel">
        <div className="bb-vel__in">
          <p className="bb-vel__sub">Čtu agenta…</p>
        </div>
      </div>
    );
  }
  if (error && !data) {
    return (
      <div className="bb-vel">
        <div className="bb-vel__in">
          <h1 className="bb-vel__title">Agent</h1>
          <Empty>Nepovedlo se načíst: {error}</Empty>
        </div>
      </div>
    );
  }
  if (!data) return null;

  const { scheduler, jobs, runs, events, routes, pamet } = data;

  return (
    <div className="bb-vel">
      <div className="bb-vel__in">
        <header className="bb-vel__head">
          <div>
            <h1 className="bb-vel__title">Agent</h1>
            <p className="bb-vel__sub">
              {!scheduler.enabled
                ? 'Vypnutý přes BEYOND_SCHEDULER=0'
                : scheduler.paused
                  ? 'Pozastavený'
                  : scheduler.running
                    ? `Právě běží ${scheduler.running}`
                    : `Hlídá, kontroluje každou minutu`}
            </p>
          </div>
          <button
            type="button"
            className="bb-pill"
            aria-pressed={scheduler.paused}
            onClick={() => void post('/agent/pause', { paused: !scheduler.paused })}
          >
            {scheduler.paused ? 'Spustit' : 'Pozastavit vše'}
          </button>
        </header>

        <Proposals />

        <MozekQueue onChange={() => void reload()} />

        <section>
          <SectionHead title="Co dělá sám" count={jobs.filter((j) => j.enabled).length} />
          <div className="bb-sig">
            {jobs.map((j) => (
              <div key={j.name} className="bb-sig__row" style={{ cursor: 'default' }}>
                <span className="bb-sev" data-sev={j.enabled ? undefined : 'off'}>
                  {j.cadence}
                </span>
                <span className="bb-sig__t">
                  {j.title}
                  {j.custom ? ` · vlastní${j.createdBy ? ` (${j.createdBy})` : ''}` : ''}
                </span>
                <span className="bb-sig__d">{j.description}</span>
                <span className="bb-sig__m">
                  {j.lastRunAt ? `naposledy ${ago(j.lastRunAt)}` : 'zatím neběželo'}
                  {j.lastStatus && j.lastStatus !== 'ok' && j.lastStatus !== 'skipped' ? ` · ${j.lastStatus}` : ''}
                  {j.failureStreak >= 2 ? ` · ${j.failureStreak}× po sobě selhalo` : ''}
                </span>
                <span
                  className="bb-sig__go"
                  style={{ opacity: 1, display: 'flex', gap: 6, alignItems: 'center' }}
                >
                  <button
                    type="button"
                    className="bb-ib"
                    title="Spustit teď"
                    aria-label={`Spustit ${j.title}`}
                    disabled={busy === j.name || Boolean(scheduler.running)}
                    onClick={async () => {
                      setBusy(j.name);
                      await post(`/agent/run/${j.name}`);
                      setTimeout(() => setBusy(null), 1500);
                    }}
                  >
                    <Play size={14} strokeWidth={1.9} />
                  </button>
                  <button
                    type="button"
                    className="bb-switch"
                    data-on={j.enabled ? 'true' : 'false'}
                    aria-label={j.enabled ? 'Vypnout úlohu' : 'Zapnout úlohu'}
                    onClick={() => void post(`/agent/job/${j.name}`, { enabled: !j.enabled })}
                  >
                    <i />
                  </button>
                </span>
              </div>
            ))}
          </div>
        </section>

        <section>
          <SectionHead title="Co udělal" count={runs.length} />
          {runs.length === 0 ? (
            <Empty>
              Zatím nic neběželo. První tik přijde po devadesáti vteřinách od startu služby,
              pak každou minutu.
            </Empty>
          ) : (
            <div className="bb-sig">
              {runs.map((r) => {
                const open = openRun === r.id;
                const job = jobs.find((j) => j.name === r.job);
                return (
                  <button
                    key={r.id}
                    type="button"
                    className="bb-sig__row"
                    onClick={() => setOpenRun(open ? null : r.id)}
                  >
                    <span
                      className="bb-sev"
                      data-sev={r.status === 'error' ? 'critical' : r.status === 'ok' ? 'ok' : undefined}
                    >
                      {STATUS_LABEL[r.status]}
                    </span>
                    <span className="bb-sig__who">
                      {new Date(r.startedAt).toLocaleString('cs-CZ', {
                        day: 'numeric',
                        month: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                      {r.trigger.kind === 'manual' ? ' · ručně' : ''}
                      {r.durationMs ? ` · ${Math.round(r.durationMs / 1000)} s` : ''}
                    </span>
                    <span className="bb-sig__t">{job?.title || r.job}</span>
                    {r.error && <span className="bb-sig__d">{r.error}</span>}
                    {!r.error && r.summary && (
                      <span className="bb-sig__d" style={open ? undefined : { display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                        {r.summary}
                      </span>
                    )}
                    {open && r.changed && (
                      <span className="bb-sig__m">
                        <strong style={{ display: 'block', marginBottom: 4 }}>Změnilo v brainu</strong>
                        <pre className="bb-pre" style={{ whiteSpace: 'pre-wrap', margin: 0, padding: '8px 10px', borderRadius: 10, fontSize: 11.5 }}>
                          {r.changed}
                        </pre>
                      </span>
                    )}
                    {open && !r.changed && r.status === 'ok' && (
                      <span className="bb-sig__m">V brainu nezměnilo nic.</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </section>

        <section>
          <SectionHead title="Na co reaguje" count={routes.length} />
          {routes.length === 0 ? (
            <Empty>
              Žádné cesty pro události. Zapisují se do <code>system/udalosti.json</code> v brainu:
              WhatsApp zpráva, nový přepis z Fathomu, booking v Cal.com.
            </Empty>
          ) : (
            <div className="bb-sig">
              {routes.map((r) => (
                <div key={r.name} className="bb-sig__row" style={{ cursor: 'default' }}>
                  <span className="bb-sev" data-sev={!r.enabled ? 'off' : !r.configured ? 'watch' : undefined}>
                    {!r.enabled ? 'vypnuto' : r.configured ? r.auth : 'chybí secret'}
                  </span>
                  <span className="bb-sig__t">{r.name}</span>
                  <span className="bb-sig__d">
                    {r.description || ''}
                    {r.job ? ` → ${r.job}` : ''}
                  </span>
                  <span className="bb-sig__m">
                    <code>POST /api/beyond-events/{r.name}</code>
                  </span>
                </div>
              ))}
            </div>
          )}
          {events.length > 0 && (
            <div className="bb-sig" style={{ marginTop: 10 }}>
              {events.map((e) => (
                <div key={e.id} className="bb-sig__row" style={{ cursor: 'default' }}>
                  <span className="bb-sev" data-sev={e.status === 'error' ? 'critical' : e.status === 'done' ? 'ok' : undefined}>
                    {EVENT_LABEL[e.status]}
                  </span>
                  <span className="bb-sig__who">{ago(e.receivedAt)}</span>
                  <span className="bb-sig__t">
                    {e.route}
                    {e.event ? ` · ${e.event}` : ''}
                    {e.count > 1 ? ` · ×${e.count}` : ''}
                  </span>
                  <span className="bb-sig__d">
                    → {e.job}
                    {e.error ? ` · ${e.error}` : ''}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section>
          <SectionHead title="Co si pamatuje" />
          {[pamet.agent, pamet.tim].map((m) => (
            <div key={m.title} style={{ marginBottom: 12 }}>
              <p className="bb-vel__sub" style={{ margin: '0 0 6px' }}>
                {m.title} · {m.usage.used}/{m.usage.limit} znaků
              </p>
              {m.entries.length === 0 ? (
                <Empty>Zatím prázdné. Agent sem zapisuje nástrojem pamet, co se naučil a co platí napořád.</Empty>
              ) : (
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
                  {m.entries.map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </section>

        <UsageSection />

        <SettingsSection />

        <section>
          <SectionHead title="Co agent nesmí" />
          <Empty>
            Nic z toho neopouští brain bez kliknutí. Úlohy čtou repo a zapisují zpátky do něj,
            každý běh se commitne pod svým jménem a jde vrátit. Zprávy klientům i změny vlastních
            pravidel čekají tady na schválení. Naplánovaný běh si nesmí plánovat další běhy.
          </Empty>
        </section>
      </div>
    </div>
  );
}
