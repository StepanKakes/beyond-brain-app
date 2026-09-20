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
