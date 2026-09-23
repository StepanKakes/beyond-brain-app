import { useCallback, useState } from 'react';
import { ArrowLeft, ExternalLink, MessageSquare } from '../icons';

import { fetchClient, type ClientDetail as Detail, type Promise_, type TimelineItem } from './api';
import {
  Empty,
  Metric,
  SectionHead,
  SeverityChip,
  ago,
  days,
  formatCzk,
  formatDay,
  usePolled,
} from './bits';

/**
 * Beyond Brain — one client, in full.
 *
 * The timeline is the reason this screen exists. Calls, WhatsApp summaries,
 * Fathom recordings and booked calls live in four separate files, and only
 * interleaved do they read as the story of the relationship rather than four
 * disconnected logs.
 */

type Tab = 'timeline' | 'promises' | 'metrics' | 'flags';

const TABS: { key: Tab; label: string }[] = [
  { key: 'timeline', label: 'Časová osa' },
  { key: 'promises', label: 'Sliby' },
  { key: 'metrics', label: 'Měření' },
  { key: 'flags', label: 'Vlajky' },
];

const KIND_LABEL: Record<TimelineItem['kind'], string> = {
  call: 'call',
  whatsapp: 'whatsapp',
  fathom: 'fathom',
  booked: 'naplánováno',
};

export default function ClientDetail({
  slug,
  onBack,
  onOpenChat,
}: {
  slug: string;
  onBack: () => void;
  onOpenChat: (slug: string) => void;
}) {
  const load = useCallback(() => fetchClient(slug), [slug]);
  const { data, error, loading } = usePolled<Detail>(load, 180_000);
  const [tab, setTab] = useState<Tab>('timeline');

  if (loading && !data) {
    return (
      <div className="bb-vel">
        <div className="bb-vel__in">
          <p className="bb-vel__sub">Čtu klienta…</p>
        </div>
      </div>
    );
  }
  if (error && !data) {
    return (
      <div className="bb-vel">
        <div className="bb-vel__in">
          <BackLink onBack={onBack} />
          <Empty>Nepovedlo se načíst: {error}</Empty>
        </div>
      </div>
    );
  }
  if (!data) return null;

  const c = data.client;

  return (
    <div className="bb-vel">
      <div className="bb-vel__in">
        <BackLink onBack={onBack} />

        <header className="bb-vel__head">
          <div>
            <h1 className="bb-vel__title">{c.name}</h1>
            <p className="bb-vel__sub">
              {c.programWeek != null ? `Týden ${c.programWeek}` : 'Týden neznámý'}
              {c.totalWeeks ? ` z ${c.totalWeeks}` : ''}
              {c.daysToEnd != null &&
                (c.daysToEnd < 0
                  ? ` · po termínu ${days(-c.daysToEnd)}`
                  : ` · zbývá ${days(c.daysToEnd)}`)}
              {c.priceCzk != null && ` · ${formatCzk(c.priceCzk)} Kč`}
              {c.hladina && ` · ${c.hladina}`}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button type="button" className="bb-pill" onClick={() => onOpenChat(c.slug)}>
              <MessageSquare size={13} strokeWidth={1.8} /> Chat
            </button>
            {c.notionUrl && (
              <a
                href={c.notionUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="bb-pill"
                style={{ textDecoration: 'none' }}
              >
                Notion <ExternalLink size={13} strokeWidth={1.8} />
              </a>
            )}
          </div>
        </header>

        {data.signals.length > 0 && (
          <section>
            <SectionHead title="Signály" count={data.signals.length} />
            <div className="bb-sig">
              {data.signals.map((s, i) => (
                <div key={`${s.type}-${i}`} className="bb-sig__row" style={{ cursor: 'default' }}>
                  <SeverityChip severity={s.severity} />
                  <span className="bb-sig__t">{s.title}</span>
                  <span className="bb-sig__d">{s.detail}</span>
                  <span className="bb-sig__m">{s.meaning}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        <div className="bb-tabs" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              className="bb-tab"
              aria-selected={tab === t.key}
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'timeline' && <Timeline items={data.timeline} />}
        {tab === 'promises' && <Promises detail={data} />}
        {tab === 'metrics' && <Metrics detail={data} />}
        {tab === 'flags' && <Flags detail={data} />}
      </div>
    </div>
  );
}

function BackLink({ onBack }: { onBack: () => void }) {
  return (
    <button
      type="button"
      onClick={onBack}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        background: 'none',
        border: 'none',
        padding: 0,
        color: 'var(--bb-ink2)',
        font: 'inherit',
        fontSize: 13,
        cursor: 'pointer',
        alignSelf: 'flex-start',
      }}
    >
      <ArrowLeft size={14} strokeWidth={1.8} /> Klienti
    </button>
  );
}

function Timeline({ items }: { items: TimelineItem[] }) {
  if (!items.length) {
    return <Empty>Zatím žádná historie. U nového klienta je to v pořádku, u starého ne.</Empty>;
  }
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div className="bb-tl">
      {items.map((it, i) => (
        <div key={`${it.kind}-${it.dateIso}-${i}`} className="bb-tl__i" data-future={it.dateIso > today ? 'true' : undefined}>
          <span className="bb-tl__d">{formatDay(it.dateIso)}</span>
          <span className="bb-tl__k">{KIND_LABEL[it.kind]}</span>
          <span className="bb-tl__t">{it.title}</span>
          {it.excerpt && <span className="bb-tl__x">{it.excerpt}</span>}
        </div>
      ))}
    </div>
  );
}

function Promises({ detail }: { detail: Detail }) {
  const { ours, theirs, signals } = detail.client.promises;
  if (!detail.client.has.actionItems) {
    return (
      <Empty>
        Klient nemá <code>_action-items.md</code>, takže o slibech nevíme nic. Tři z deseti klientů
        ten soubor mají, u zbytku se sliby drží jen v hlavě a v zápisech z callů.
      </Empty>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      <section>
        <SectionHead title="Dlužíme my" count={ours.length} />
        {ours.length ? <PromiseList items={ours} /> : <Empty>Nic. Tenhle sloupec má být prázdný.</Empty>}
      </section>
      <section>
        <SectionHead title="Dluží klient" count={theirs.length} />
        {theirs.length ? <PromiseList items={theirs} /> : <Empty>Nic otevřeného.</Empty>}
      </section>
      {signals.length > 0 && (
        <section>
          <SectionHead title="Poznámky ze syncu" />
          <div className="bb-none" style={{ lineHeight: 1.6 }}>
            {signals.map((s, i) => (
              <div key={i}>{s}</div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function PromiseList({ items }: { items: Promise_[] }) {
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div className="bb-prom">
      {items.map((p, i) => {
        const ref = p.dueIso || p.originIso;
        const late = Boolean(p.dueIso && p.dueIso < today);
        return (
          <div key={i} className="bb-prom__i">
            <span className="bb-prom__age" data-late={late ? 'true' : undefined}>
              {ref ? ago(ref) : '—'}
            </span>
            <span>
              {p.text}
              {p.person && <span style={{ color: 'var(--bb-ink3)' }}> · {p.person === 'tim' ? 'Tim' : 'Štěpán'}</span>}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function Metrics({ detail }: { detail: Detail }) {
  const c = detail.client;
  if (!c.has.mereni || !c.measurements.length) {
    return (
      <Empty>
        Klient nemá měření. Bez čísel neuvidíme zácpu ve funnelu, dokud nebude pozdě, takže tohle
        je to první, co u něj založit.
      </Empty>
    );
  }
  const spine = c.spine.length ? c.spine : Object.keys(c.measurements[0].values);
  return (
    <div className="bb-tblwrap">
      <table className="bb-tbl">
        <thead>
          <tr>
            <th scope="col">Týden</th>
            {spine.map((m) => (
              <th key={m} scope="col" className="num">
                {m}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {c.measurements.map((w) => (
            <tr key={w.isoWeek} style={{ cursor: 'default' }}>
              <td className="who">
                {w.isoWeek}
                {w.range && <span className="dim"> · {w.range}</span>}
              </td>
              {spine.map((m) => (
                <td key={m} className="num">
                  <Metric value={w.values[m]} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Flags({ detail }: { detail: Detail }) {
  const flags = detail.client.flags.filter((f) => f.open);
  const closed = detail.client.flags.filter((f) => !f.open);
  if (!flags.length && !closed.length) return <Empty>Žádné vlajky.</Empty>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      <section>
        <SectionHead title="Otevřené" count={flags.length} />
        {flags.length ? (
          <div className="bb-sig">
            {flags.map((f, i) => (
              <div key={i} className="bb-sig__row" style={{ cursor: 'default' }}>
                {f.severity !== 'ok' && <SeverityChip severity={f.severity} />}
                <span className="bb-sig__t">{f.title}</span>
                {f.stav && <span className="bb-sig__d">{f.stav}</span>}
                {f.stavDateIso && <span className="bb-sig__m">beze změny {ago(f.stavDateIso)}</span>}
              </div>
            ))}
          </div>
        ) : (
          <Empty>Nic otevřeného.</Empty>
        )}
      </section>
      {closed.length > 0 && (
        <section>
          <SectionHead title="Uzavřené" count={closed.length} />
          <div className="bb-prom">
            {closed.map((f, i) => (
              <div key={i} className="bb-prom__i">
                <span className="bb-prom__age">{f.stavDateIso ? ago(f.stavDateIso) : '—'}</span>
                <span style={{ color: 'var(--bb-ink2)' }}>{f.title}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
