import { useCallback, useMemo, useState } from 'react';

import { fetchCalls, type Call, type CallsPage as CallsData } from './api';
import { Tabs } from '../ui';
import { Empty, LiveCall, SectionHead, formatTime, usePolled } from './bits';

/**
 * Beyond Brain — booked calls.
 *
 * Grouped by day, because that is how anyone reads a calendar, and filterable
 * by whose call it is, because two people run these and each mostly cares about
 * their own. A call whose attendee does not match any client is called out
 * rather than hidden: an unmatched booking usually means the e-mail in
 * `profil.md` is wrong, which is worth fixing.
 */

const DAY_FMT: Intl.DateTimeFormatOptions = { weekday: 'long', day: 'numeric', month: 'long' };

export default function CallsPage({ onOpenClient }: { onOpenClient: (slug: string) => void }) {
  const load = useCallback(() => fetchCalls(21), []);
  const { data, error, loading } = usePolled<CallsData>(load, 90_000);
  const [who, setWho] = useState<string | 'all'>('all');

  const filtered = useMemo(() => {
    if (!data) return [];
    if (who === 'all') return data.days;
    return data.days
      .map((d) => ({ ...d, calls: d.calls.filter((c) => c.host?.key === who) }))
      .filter((d) => d.calls.length > 0);
  }, [data, who]);

  if (loading && !data) {
    return (
      <div className="bb-vel">
        <div className="bb-vel__in">
          <p className="bb-vel__sub">Čtu kalendář…</p>
        </div>
      </div>
    );
  }
  if (error && !data) {
    return (
      <div className="bb-vel">
        <div className="bb-vel__in">
          <h1 className="bb-vel__title">Hovory</h1>
          <Empty>Nepovedlo se načíst: {error}</Empty>
        </div>
      </div>
    );
  }
  if (!data) return null;

  if (!data.configured) {
    return (
      <div className="bb-vel">
        <div className="bb-vel__in">
          <h1 className="bb-vel__title">Hovory</h1>
          <Empty>
            Kalendář není napojený. Vygeneruj API klíč v Cal.com a nastav ho serveru jako{' '}
            <code>BEYOND_CALCOM_API_KEY</code>. Do té doby tu nebude nic, což je lepší než tvrdit, že
            žádné hovory nejsou.
          </Empty>
        </div>
      </div>
    );
  }

  const total = data.days.reduce((n, d) => n + d.calls.length, 0);

  return (
    <div className="bb-vel">
      <div className="bb-vel__in">
        <header className="bb-vel__head">
          <div>
            <h1 className="bb-vel__title">Hovory</h1>
            <p className="bb-vel__sub">
              {total} naplánovaných na 21 dní
              {data.unmatched > 0 && ` · ${data.unmatched} bez napojení na klienta`}
            </p>
          </div>
          <Tabs
            items={[{ key: 'all', label: 'Všichni' }, ...data.people.map((p) => ({ key: p.key, label: p.displayName }))]}
            value={who}
            onChange={setWho}
          />
        </header>

        {data.error && <Empty>Cal.com hlásí: {data.error}</Empty>}

        {data.live.map((c) => (
          <LiveCall key={c.uid} call={c} />
        ))}

        {filtered.length === 0 ? (
          <Empty>
            {who === 'all' ? 'Žádné naplánované hovory.' : 'Na tuhle osobu nic naplánovaného není.'}
          </Empty>
        ) : (
          filtered.map((day) => (
            <section key={day.day}>
              <SectionHead
                title={new Date(`${day.day}T12:00:00`).toLocaleDateString('cs-CZ', DAY_FMT)}
                count={day.calls.length}
              />
              <div className="bb-band">
                {day.calls.map((c) => (
                  <CallRow key={c.uid} call={c} onOpenClient={onOpenClient} />
                ))}
              </div>
            </section>
          ))
        )}
      </div>
    </div>
  );
}

function CallRow({ call, onOpenClient }: { call: Call; onOpenClient: (slug: string) => void }) {
  const clickable = Boolean(call.clientSlug);
  return (
    <button
      type="button"
      className="bb-band__row"
      style={{
        background: 'transparent',
        border: 'none',
        borderBottom: '1px solid var(--bb-line2)',
        width: '100%',
        textAlign: 'left',
        cursor: clickable ? 'pointer' : 'default',
      }}
      onClick={() => call.clientSlug && onOpenClient(call.clientSlug)}
    >
      <span className="bb-band__n">{formatTime(call.startIso)}</span>
      <span className="bb-band__t">
        {call.clientName || call.title}
        {!call.clientSlug && (
          <span className="bb-band__m" style={{ display: 'block', marginTop: 2 }}>
            Nenapojeno na klienta · {call.attendees.map((a) => a.email).join(', ') || 'bez účastníka'}
          </span>
        )}
      </span>
      <span className="bb-band__m">
        {call.host?.name || 'neznámý host'}
        {call.durationMin ? ` · ${call.durationMin} min` : ''}
      </span>
    </button>
  );
}
