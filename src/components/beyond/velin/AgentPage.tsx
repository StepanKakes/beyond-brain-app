import { useCallback, useState } from 'react';
import { Play } from 'lucide-react';

import { authenticatedFetch } from '../../../utils/api';
import { Empty, SectionHead, ago, usePolled } from './bits';

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
  enabled: boolean;
  lastRunAt: string | null;
};

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
  scheduler: { enabled: boolean; paused: boolean; running: string | null; tickMs: number };
  jobs: Job[];
  runs: Run[];
};

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

  const { scheduler, jobs, runs } = data;

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

        <section>
          <SectionHead title="Co dělá sám" count={jobs.filter((j) => j.enabled).length} />
          <div className="bb-sig">
            {jobs.map((j) => (
              <div key={j.name} className="bb-sig__row" style={{ cursor: 'default' }}>
                <span className="bb-sev" data-sev={j.enabled ? undefined : 'off'}>
                  {j.cadence}
                </span>
                <span className="bb-sig__t">{j.title}</span>
                <span className="bb-sig__d">{j.description}</span>
                <span className="bb-sig__m">
                  {j.lastRunAt ? `naposledy ${ago(j.lastRunAt)}` : 'zatím neběželo'}
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
          <SectionHead title="Co agent nesmí" />
          <Empty>
            Nic z toho neopouští brain. Úlohy čtou repo a zapisují zpátky do něj, takže každá
            změna je v gitu a jde vrátit. Cokoli, co by šlo ke klientovi, končí jako draft
            v <code>workspace/drafty/</code>, nikdy jako odeslaná zpráva.
          </Empty>
        </section>
      </div>
    </div>
  );
}
