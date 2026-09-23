import { useCallback, useState } from 'react';

import { fetchBoard, type BoardClient } from './api';
import { Tabs } from '../ui';
import { Empty, Metric, SectionHead, SeverityChip, Spark, ago, usePolled } from './bits';

/**
 * Beyond Brain — the client board.
 *
 * A table, not a card grid. Ten clients compared across eight dimensions is
 * exactly the job a table does better than anything else: the columns line up,
 * the numbers are tabular, and a bad row is visible without reading it. Cards
 * would triple the height and destroy the comparison.
 *
 * Ordered by how much attention each client needs, never alphabetically. The
 * point of opening this screen is to find out who to deal with first.
 */

type Sort = 'urgency' | 'name' | 'ending';

const SORTS: { key: Sort; label: string }[] = [
  { key: 'urgency', label: 'Podle naléhavosti' },
  { key: 'ending', label: 'Podle konce programu' },
  { key: 'name', label: 'Podle jména' },
];

export default function ClientBoard({ onOpenClient }: { onOpenClient: (slug: string) => void }) {
  const load = useCallback(() => fetchBoard(), []);
  const { data, error, loading } = usePolled(load, 180_000);
  const [sort, setSort] = useState<Sort>('urgency');

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
          <h1 className="bb-vel__title">Klienti</h1>
          <Empty>Nepovedlo se načíst: {error}</Empty>
        </div>
      </div>
    );
  }
  if (!data) return null;

  const order = (list: BoardClient[]) =>
    [...list].sort((a, b) => {
      if (sort === 'name') return a.name.localeCompare(b.name, 'cs');
      if (sort === 'ending') return (a.daysToEnd ?? 9999) - (b.daysToEnd ?? 9999);
      return b.score - a.score;
    });

  // Finished programs stay reachable but out of the way. They are history, not
  // a to-do list, and mixing them in would put dead rows above live ones.
  const clients = order(data.clients.filter((c) => c.isActive));
  const finished = order(data.clients.filter((c) => !c.isActive));

  return (
    <div className="bb-vel">
      <div className="bb-vel__in">
        <header className="bb-vel__head">
          <div>
            <h1 className="bb-vel__title">Klienti</h1>
            <p className="bb-vel__sub">
              {clients.length} aktivních
              {finished.length > 0 && ` · ${finished.length} doběhlo`}
            </p>
          </div>
          <Tabs items={SORTS.map((s) => ({ key: s.key, label: s.label }))} value={sort} onChange={(k) => setSort(k as typeof sort)} />
        </header>

        <div className="bb-tblwrap">
          <table className="bb-tbl">
            <thead>
              <tr>
                <th scope="col">Klient</th>
                <th scope="col">Týden</th>
                <th scope="col">Do konce</th>
                <th scope="col">Hlavní metrika</th>
                <th scope="col" className="num">Dlužíme</th>
                <th scope="col" className="num">Dluží</th>
                <th scope="col">Poslední zpráva</th>
                <th scope="col">Stav</th>
              </tr>
            </thead>
            <tbody>
              {clients.map((c) => (
                <ClientRow key={c.slug} client={c} onOpen={() => onOpenClient(c.slug)} />
              ))}
            </tbody>
          </table>
        </div>

        {finished.length > 0 && (
          <section>
            <SectionHead title="Doběhlé programy" count={finished.length} />
            <div className="bb-prom">
              {finished.map((c) => (
                <button
                  key={c.slug}
                  type="button"
                  className="bb-prom__i"
                  style={{ background: 'none', border: 'none', borderTop: '1px solid var(--bb-line2)', width: '100%', textAlign: 'left', cursor: 'pointer' }}
                  onClick={() => onOpenClient(c.slug)}
                >
                  <span className="bb-prom__age">{c.endIso || '—'}</span>
                  <span style={{ color: 'var(--bb-ink2)' }}>
                    {c.name}
                    {c.openOurs > 0 && (
                      <span className="neg"> · nedodělali jsme {c.openOurs}</span>
                    )}
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}

        <section>
          <SectionHead title="Jak číst tabulku" />
          <Empty>
            Hlavní metrika je to jedno číslo, na kterém stojí program daného klienta, proto je
            u každého jiné (přihlášky, návštěvy, tržby) a jeho název je vedle čísla. Pomlčka
            znamená nevíme, nula znamená dělal a nevyšlo, přerušená čára v grafu je týden, kdy se
            čísla nesebrala.
          </Empty>
        </section>
      </div>
    </div>
  );
}

function ClientRow({ client: c, onOpen }: { client: BoardClient; onOpen: () => void }) {
  const topMetric = c.spine[0] || null;
  const endLabel =
    c.daysToEnd == null
      ? '—'
      : c.daysToEnd < 0
        ? `po termínu ${-c.daysToEnd} d`
        : `${c.daysToEnd} d`;  // zkratka je v husté tabulce záměrná

  return (
    <tr
      tabIndex={0}
      role="link"
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
    >
      <td className="who">
        {c.name}
        {c.stav && c.stav !== 'Aktivní' && <span className="dim"> · {c.stav}</span>}
      </td>
      <td className="num">
        {c.programWeek != null ? `W${String(c.programWeek).padStart(2, '0')}` : '—'}
        {c.totalWeeks ? <span className="dim">/{c.totalWeeks}</span> : null}
      </td>
      <td className={`num${c.daysToEnd != null && c.daysToEnd < 0 ? ' neg' : ''}`}>{endLabel}</td>
      <td>
        {!topMetric ? (
          <span className="dim" title="Klient nemá mereni.md">bez měření</span>
        ) : (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            {/* One week of data cannot be a trend, so the chart is simply
                absent rather than drawn as a stray dash beside the number. */}
            {c.history.length > 1 && <Spark history={c.history} metric={topMetric} />}
            <span className="num">
              <Metric value={c.latestWeek?.values[topMetric]} />
            </span>
            {/* The number means nothing without its name, and every client's
                name here is different. */}
            <span className="dim bb-tbl__metric">{topMetric}</span>
          </span>
        )}
      </td>
      <td className={`num${c.openOurs > 0 ? ' neg' : ''}`}>{c.openOurs || <span className="dim">0</span>}</td>
      <td className="num">{c.openTheirs || <span className="dim">0</span>}</td>
      <td className="num">
        {c.waBroken ? (
          <span className="dim" title="Synchronizace proběhla, ale stáhla nula zpráv">pull nejede</span>
        ) : (
          ago(c.lastInboundIso)
        )}
      </td>
      <td>
        {/* Keyed off what is specific to this client. A condition that holds
            for most of the roster is reported once on the velín, so repeating
            it here would light up nearly every row and tell you nothing. */}
        {c.ownCounts.critical > 0 ? (
          <SeverityChip severity="critical" />
        ) : c.ownCounts.watch > 0 ? (
          <SeverityChip severity="watch" />
        ) : c.systemicTypes.length > 0 ? (
          <span className="dim" title="Jen celoplošné věci, viz Stav systému na Velíně">
            jen systém
          </span>
        ) : (
          <span className="dim">klid</span>
        )}
      </td>
    </tr>
  );
}
