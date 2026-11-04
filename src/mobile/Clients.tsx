import { useMemo, useState } from 'react';
import { SearchField, SegmentedControl } from 'glisse';

import { Icon } from './icons';
import { navigate } from './router';
import { useResource } from './store';
import { TASKS_KEY, TASKS_PATH, TaskRow } from './Today';
import type { BoardClient, ClientPromise, ClientResponse, Signal, TasksResponse, TimelineItem } from './types';
import { Empty, Initials, PushedBar, Section, Skeleton, TabScreen, ago, timeOf } from './ui';

const BOARD_KEY = 'klienti';
const BOARD_PATH = '/api/beyond/velin/board';

function clientLine(client: BoardClient): string {
  const week =
    client.programWeek !== null
      ? client.totalWeeks
        ? `Týden ${client.programWeek} z ${client.totalWeeks}`
        : `Týden ${client.programWeek}`
      : client.stav;
  const call = client.nextCall
    ? `hovor ${new Date(client.nextCall.startIso).toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric' })}`
    : client.lastCallIso
      ? `poslední hovor ${ago(client.lastCallIso)}`
      : null;
  return [week, call].filter(Boolean).join(' · ');
}

function ClientRow({ client }: { client: BoardClient }) {
  const count = client.counts.critical + client.counts.watch;
  return (
    <button
      type="button"
      className="m-row m-client"
      onClick={() => navigate(`/m/klient/${encodeURIComponent(client.slug)}`)}
    >
      <Initials name={client.name} />
      <span className="m-link-text">
        <span className="m-row-title" title={client.name}>
          {client.name}
        </span>
        <span className="m-row-sub">{clientLine(client)}</span>
      </span>
      {count && client.worst ? (
        <span className={`m-count ${client.worst}`} aria-label={`Upozornění: ${count}`}>
          {count}
        </span>
      ) : null}
    </button>
  );
}

export function ClientsScreen() {
  const { data, error } = useResource<{ clients: BoardClient[] }>(BOARD_KEY, BOARD_PATH);
  const [query, setQuery] = useState('');
  const [showDone, setShowDone] = useState(false);

  const groups = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('cs');
    const list = (data?.clients || []).filter((c) => !needle || c.name.toLocaleLowerCase('cs').includes(needle));
    const active = list.filter((c) => c.isActive).sort((a, b) => b.score - a.score);
    return {
      attention: active.filter((c) => c.worst),
      fine: active.filter((c) => !c.worst).sort((a, b) => a.name.localeCompare(b.name, 'cs')),
      done: list.filter((c) => !c.isActive).sort((a, b) => a.name.localeCompare(b.name, 'cs')),
    };
  }, [data, query]);

  const nothing = data && !groups.attention.length && !groups.fine.length && !groups.done.length;

  return (
    <TabScreen title="Klienti">
      <div className="m-search">
        <SearchField aria-label="Hledat klienta" placeholder="Hledat" value={query} onValueChange={setQuery} />
      </div>
      {!data && !error ? <Skeleton rows={6} /> : null}
      {!data && error ? <Empty title="Klienti se nenačetli">{error}</Empty> : null}
      {nothing ? <Empty title="Nikdo nenalezen">{query ? 'Zkus jiné jméno' : 'Zatím tu nejsou žádní klienti'}</Empty> : null}
      {groups.attention.length ? (
        <Section title="Potřebují pozornost">
          {groups.attention.map((client) => (
            <ClientRow key={client.slug} client={client} />
          ))}
        </Section>
      ) : null}
      {groups.fine.length ? (
        <Section title="V pořádku">
          {groups.fine.map((client) => (
            <ClientRow key={client.slug} client={client} />
          ))}
        </Section>
      ) : null}
      {groups.done.length ? (
        <button type="button" className="m-disclosure" onClick={() => setShowDone((v) => !v)}>
          {showDone ? 'Skrýt ukončené' : `Ukončené (${groups.done.length})`}
        </button>
      ) : null}
      {showDone && groups.done.length ? (
        <Section>
          {groups.done.map((client) => (
            <ClientRow key={client.slug} client={client} />
          ))}
        </Section>
      ) : null}
    </TabScreen>
  );
}

const KIND_LABEL: Record<TimelineItem['kind'], string> = {
  call: 'Hovor',
  whatsapp: 'WhatsApp',
  fathom: 'Záznam',
  booked: 'Naplánováno',
};

function SignalRow({ signal }: { signal: Signal }) {
  return (
    <div className="m-row m-signal">
      <span className={`m-severity ${signal.severity}`} aria-hidden="true" />
      <span className="m-link-text">
        <span className="m-row-title">{signal.title}</span>
        {signal.detail ? <span className="m-row-sub">{signal.detail}</span> : null}
      </span>
    </div>
  );
}

function Promises({ title, list }: { title: string; list: ClientPromise[] }) {
  if (!list.length) return null;
  return (
    <Section title={title}>
      {list.map((promise) => (
        <div className="m-row m-row-main" key={`${promise.text}-${promise.dueIso}`}>
          <span className="m-row-title">{promise.text}</span>
          {promise.dueIso ? (
            <span className="m-row-sub">
              {new Date(promise.dueIso).toLocaleDateString('cs-CZ', { day: 'numeric', month: 'long' })}
            </span>
          ) : null}
        </div>
      ))}
    </Section>
  );
}

const humanKey = (key: string): string =>
  key.replace(/[-_]/g, ' ').replace(/^./, (c) => c.toLocaleUpperCase('cs'));

type Tab = 'osa' | 'sliby' | 'mereni' | 'vlajky';

export function ClientDetailScreen({ slug }: { slug: string }) {
  const path = `/api/beyond/velin/client/${encodeURIComponent(slug)}`;
  const { data, error } = useResource<ClientResponse>(`klient.${slug}`, path);
  const tasks = useResource<TasksResponse>(TASKS_KEY, TASKS_PATH);
  const [tab, setTab] = useState<Tab>('osa');

  const client = data?.client;
  const fallbackName = tasks.data?.clients.find((c) => c.slug === slug)?.name;
  const title = client?.name || fallbackName || 'Klient';
  const open = (tasks.data?.tasks || []).filter((t) => t.client?.slug === slug && t.state !== 'done');
  const flags = client?.flags.filter((f) => f.open) || [];
  const measurements = client?.measurements || [];
  const latest = measurements[measurements.length - 1];

  return (
    <>
      <PushedBar title={title} />
      <div className="m-scroll m-client-detail">
        <header className="m-client-head">
          <Initials name={title} size={72} />
          <h1 title={title}>{title}</h1>
          {client ? <p>{clientLine(client)}</p> : null}
          <div className="m-client-actions">
            <button
              type="button"
              className="m-action"
              onClick={() => navigate(`/m/chat/new?k=${encodeURIComponent(slug)}`)}
            >
              <Icon name="chat" size={22} />
              <span>Chat</span>
            </button>
            {client?.nextCall?.meetingUrl ? (
              <a className="m-action" href={client.nextCall.meetingUrl} target="_blank" rel="noreferrer">
                <Icon name="video" size={22} />
                <span>Hovor</span>
              </a>
            ) : null}
            {client?.notionUrl ? (
              <a className="m-action" href={client.notionUrl} target="_blank" rel="noreferrer">
                <Icon name="link" size={22} />
                <span>Notion</span>
              </a>
            ) : null}
          </div>
        </header>

        {!data && !error ? <Skeleton /> : null}
        {!data && error ? <Empty title="Klient se nenačetl">{error}</Empty> : null}

        {data?.signals.length ? (
          <Section title="Co hlídat">
            {data.signals.map((signal) => (
              <SignalRow key={`${signal.type}-${signal.title}`} signal={signal} />
            ))}
          </Section>
        ) : null}

        {client?.nextCall ? (
          <Section title="Další hovor">
            <div className="m-row m-row-main">
              <span className="m-row-title">{client.nextCall.title}</span>
              <span className="m-row-sub">
                {new Date(client.nextCall.startIso).toLocaleDateString('cs-CZ', { weekday: 'long', day: 'numeric', month: 'long' })}
                {`, ${timeOf(client.nextCall.startIso)}`}
              </span>
            </div>
          </Section>
        ) : null}

        {open.length ? (
          <Section title="Otevřené úkoly">
            {open.map((task) => (
              <TaskRow key={task.id} task={task} />
            ))}
          </Section>
        ) : null}

        {data ? (
          <>
            <div className="m-scope m-scope-4">
              <SegmentedControl
                aria-label="Část detailu"
                value={tab}
                onValueChange={(value) => setTab(value as Tab)}
                items={[
                  { value: 'osa', label: 'Osa' },
                  { value: 'sliby', label: 'Sliby' },
                  { value: 'mereni', label: 'Měření' },
                  { value: 'vlajky', label: 'Vlajky' },
                ]}
              />
            </div>

            {tab === 'osa' ? (
              data.timeline.length ? (
                <Section>
                  {data.timeline.map((item) => (
                    <div className="m-row m-row-main" key={`${item.kind}-${item.dateIso}-${item.title}`}>
                      <span className="m-row-sub">
                        {KIND_LABEL[item.kind]},{' '}
                        {new Date(item.dateIso).toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric', year: 'numeric' })}
                      </span>
                      <span className="m-row-title">{item.title}</span>
                      {item.excerpt ? <span className="m-timeline-excerpt">{item.excerpt}</span> : null}
                    </div>
                  ))}
                </Section>
              ) : (
                <Empty title="Zatím nic">Hovory a zprávy se objeví tady</Empty>
              )
            ) : null}

            {tab === 'sliby' && client ? (
              client.promises.ours.length || client.promises.theirs.length ? (
                <>
                  <Promises title="Slíbili jsme" list={client.promises.ours} />
                  <Promises title="Slíbil klient" list={client.promises.theirs} />
                </>
              ) : (
                <Empty title="Žádné otevřené sliby" />
              )
            ) : null}

            {tab === 'mereni' ? (
              latest ? (
                <Section title={latest.range || latest.isoWeek}>
                  {Object.entries(latest.values).map(([key, value]) => (
                    <div className="m-row m-row-setting" key={key}>
                      <span className="m-row-title">{humanKey(key)}</span>
                      <span className="m-kpi-value">{value ?? 'Chybí'}</span>
                    </div>
                  ))}
                </Section>
              ) : (
                <Empty title="Žádná měření" />
              )
            ) : null}

            {tab === 'vlajky' ? (
              flags.length ? (
                <Section>
                  {flags.map((flag) => (
                    <div className="m-row m-signal" key={flag.title}>
                      <span className={`m-severity ${flag.severity}`} aria-hidden="true" />
                      <span className="m-link-text">
                        <span className="m-row-title">{flag.title}</span>
                        {flag.body ? <span className="m-row-sub">{flag.body}</span> : null}
                      </span>
                    </div>
                  ))}
                </Section>
              ) : (
                <Empty title="Žádné vlajky" />
              )
            ) : null}
          </>
        ) : null}
      </div>
    </>
  );
}
