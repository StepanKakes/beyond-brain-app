import { useCallback, useMemo, useState } from 'react';
import { ChevronRight } from 'lucide-react';

import { fetchVelin, type Signal, type Velin } from './api';
import { Empty, LiveCall, SectionHead, SeverityChip, formatTime, usePolled, vocative } from './bits';
import Proposals from './Proposals';

/**
 * Beyond Brain — the velín.
 *
 * Deliberately one column, read top to bottom in priority order, rather than a
 * three-up grid where everything competes for the same glance. What needs a
 * person comes first; what is drifting comes second; what the agent owes itself
 * comes last and stays folded.
 *
 * Conditions that hold for most of the roster are lifted into a single band at
 * the top. Nine clients with a stale profile is one problem stated once, not
 * nine rows that bury the two real ones underneath.
 */

type Props = {
  onOpenClient: (slug: string) => void;
  onOpenCalls: () => void;
};

function greeting(now = new Date()): string {
  const h = now.getHours();
  if (h < 10) return 'Dobré ráno';
  if (h < 18) return 'Dobrý den';
  return 'Dobrý večer';
}

const DATE_FMT: Intl.DateTimeFormatOptions = { weekday: 'long', day: 'numeric', month: 'long' };

export default function VelinPage({ onOpenClient, onOpenCalls }: Props) {
  const load = useCallback(() => fetchVelin(), []);
  const { data, error, loading } = usePolled<Velin>(load, 120_000);
  const [showAgent, setShowAgent] = useState(false);

  const today = useMemo(() => new Date().toLocaleDateString('cs-CZ', DATE_FMT), []);
  const me = data?.me?.displayName;

  if (loading && !data) {
    return (
      <div className="bb-vel">
        <div className="bb-vel__in">
          <p className="bb-vel__sub">Čtu brain…</p>
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="bb-vel">
        <div className="bb-vel__in">
          <h1 className="bb-vel__title">Velín</h1>
          <Empty>
            Nepovedlo se načíst stav: {error}. Dokud se to nespraví, tahle obrazovka nemůže říct nic
            pravdivého, tak radši neříká nic.
          </Empty>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const { needsUs, risks, agent, systemic, calls, totals } = data;
  const quiet = needsUs.length === 0 && risks.length === 0;

  return (
    <div className="bb-vel">
      <div className="bb-vel__in">
        <header className="bb-vel__head">
          <div>
            <h1 className="bb-vel__title">
              {greeting()}{me ? `, ${vocative(me)}` : ''}. <em>Co dnes hoří?</em>
            </h1>
            <p className="bb-vel__sub">
              {today} · {totals.clients} aktivních klientů
              {totals.finished > 0 && ` · ${totals.finished} doběhlo`}
              {totals.critical > 0 && ` · ${totals.critical} v kritickém stavu`}
            </p>
          </div>
        </header>

        {calls.live.map((c) => (
          <LiveCall key={c.uid} call={c} />
        ))}

        {/* Today, and what the calendar knows. */}
        <section>
          <SectionHead title="Dnes" count={calls.today.length ? `${calls.today.length} hovorů` : undefined} />
          {!calls.configured ? (
            <Empty>
              Kalendář není napojený. Doplň <code>BEYOND_CALCOM_API_KEY</code> a uvidíš tu naplánované
              hovory i to, kdo zrovna mluví.
            </Empty>
          ) : calls.error ? (
            <Empty>Cal.com neodpovídá: {calls.error}</Empty>
          ) : calls.today.length === 0 ? (
            <Empty>
              Dnes žádný hovor.
              {calls.next && (
                <>
                  {' '}Nejbližší je {new Date(calls.next.startIso).toLocaleDateString('cs-CZ', DATE_FMT)} v{' '}
                  {formatTime(calls.next.startIso)} ({calls.next.clientName || calls.next.title}).
                </>
              )}
            </Empty>
          ) : (
            <div className="bb-band">
              {calls.today.map((c) => (
                <button
                  key={c.uid}
                  type="button"
                  className="bb-band__row"
                  style={{ background: 'transparent', border: 'none', borderBottom: '1px solid var(--bb-line2)', textAlign: 'left', width: '100%', cursor: c.clientSlug ? 'pointer' : 'default' }}
                  onClick={() => c.clientSlug && onOpenClient(c.clientSlug)}
                >
                  <span className="bb-band__n">{formatTime(c.startIso)}</span>
                  <span className="bb-band__t">{c.clientName || c.title}</span>
                  <span className="bb-band__m">
                    {c.host?.name || 'neznámý host'}
                    {c.durationMin ? ` · ${c.durationMin} min` : ''}
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>

        {/* Written and waiting. First, because it is the cheapest thing on the
            screen to finish: read it, click, done. */}
        <Proposals compact />

        {/* What a human has to move. */}
        <section>
          <SectionHead title="Vyžaduje tebe" count={needsUs.length} />
          {needsUs.length === 0 ? (
            <Empty>Nic nevisí na nás. Dobrá zpráva, tohle je sloupec, který má být prázdný.</Empty>
          ) : (
            <SignalList signals={needsUs} onOpenClient={onOpenClient} />
          )}
        </section>

        {/* What is drifting on the client's side. */}
        <section>
          <SectionHead title="Riziko" count={risks.length} />
          {risks.length === 0 ? (
            <Empty>Žádný klient zrovna neuhýbá.</Empty>
          ) : (
            <SignalList signals={risks} onOpenClient={onOpenClient} />
          )}
        </section>

        {/* Conditions that hold across the roster. Stated once. */}
        {systemic.length > 0 && (
          <section>
            <SectionHead title="Stav systému" count={`${systemic.length} věcí`} />
            <div className="bb-band">
              {systemic.map((s) => (
                <div key={s.type} className="bb-band__row">
                  <span className="bb-band__n">
                    {s.count}/{s.total}
                  </span>
                  <span className="bb-band__t">
                    {s.title}
                    {s.meaning && <span className="bb-band__m" style={{ display: 'block', marginTop: 2 }}>{s.meaning}</span>}
                  </span>
                  <SeverityChip severity={s.severity} />
                </div>
              ))}
            </div>
          </section>
        )}

        {/* The agent's own backlog, folded away. */}
        {agent.length > 0 && (
          <section>
            <button
              type="button"
              className="bb-sec"
              style={{ background: 'transparent', border: 'none', padding: 0, width: '100%', cursor: 'pointer' }}
              onClick={() => setShowAgent((v) => !v)}
              aria-expanded={showAgent}
            >
              <span className="bb-sec__h">Čeká na agenta</span>
              <span className="bb-sec__n">
                {agent.length} {showAgent ? '−' : '+'}
              </span>
            </button>
            {showAgent && <SignalList signals={agent} onOpenClient={onOpenClient} />}
          </section>
        )}

        {quiet && systemic.length === 0 && (
          <Empty>Nic nehoří a nic nedrží. Zkontroluj, jestli se brain dnes ráno vůbec synchronizoval.</Empty>
        )}

        <p className="bb-vel__sub">
          Index postaven {new Date(data.builtAt).toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' })}
          {' · '}
          <button
            type="button"
            onClick={onOpenCalls}
            style={{ background: 'none', border: 'none', padding: 0, color: 'var(--bb-ink2)', textDecoration: 'underline', cursor: 'pointer', font: 'inherit' }}
          >
            všechny hovory
          </button>
        </p>
      </div>
    </div>
  );
}

function SignalList({
  signals,
  onOpenClient,
}: {
  signals: Signal[];
  onOpenClient: (slug: string) => void;
}) {
  // The "what it means" line is a property of the signal type, not of the
  // client, so two clients with the same problem would print it twice word for
  // word. Say it on the first occurrence and let the rest stay scannable.
  const explained = new Set<string>();

  return (
    <div className="bb-sig">
      {signals.map((s, i) => {
        const showMeaning = !explained.has(s.type);
        explained.add(s.type);
        return (
          <button
            key={`${s.clientSlug}-${s.type}-${i}`}
            type="button"
            className="bb-sig__row"
            onClick={() => s.clientSlug && onOpenClient(s.clientSlug)}
          >
            <SeverityChip severity={s.severity} />
            <span className="bb-sig__who">{s.clientName}</span>
            <span className="bb-sig__t">{s.title}</span>
            <span className="bb-sig__d">{s.detail}</span>
            {showMeaning && <span className="bb-sig__m">{s.meaning}</span>}
            <ChevronRight className="bb-sig__go" size={15} strokeWidth={1.8} aria-hidden />
          </button>
        );
      })}
    </div>
  );
}
