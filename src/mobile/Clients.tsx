import { useMemo, useState } from 'react';
import { Button, SearchField, SegmentedControl } from 'glisse';

import { api } from './api';
import { Icon } from './icons';
import { navigate } from './router';
import { refresh, useResource } from './store';
import { TASKS_KEY, TASKS_PATH, TaskRow } from './Today';
import type { BoardClient, ClientFlag, ClientPromise, ClientResponse, Signal, TasksResponse, TickedItem, TimelineItem } from './types';
import { Empty, Initials, Markdown, PushedBar, Section, Sheet, Skeleton, TabScreen, ago, timeOf, toast } from './ui';

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

function SignalRow({ signal, onOpen }: { signal: Signal; onOpen: () => void }) {
  return (
    <button type="button" className="m-row m-signal" onClick={onOpen}>
      <span className={`m-severity ${signal.severity}`} aria-hidden="true" />
      <span className="m-link-text">
        <span className="m-row-title">{signal.title}</span>
        {signal.detail ? <span className="m-row-sub">{signal.detail}</span> : null}
      </span>
      <Icon name="right" size={16} />
    </button>
  );
}

function Promises({ title, list, onOpen }: { title: string; list: ClientPromise[]; onOpen: (promise: ClientPromise) => void }) {
  if (!list.length) return null;
  return (
    <Section title={title}>
      {list.map((promise) => (
        <button type="button" className="m-row m-row-main" key={`${promise.text}-${promise.dueIso}`} onClick={() => onOpen(promise)}>
          <span className="m-row-title">{promise.text}</span>
          {promise.dueIso ? (
            <span className="m-row-sub">
              {new Date(promise.dueIso).toLocaleDateString('cs-CZ', { day: 'numeric', month: 'long' })}
            </span>
          ) : null}
        </button>
      ))}
    </Section>
  );
}

/** Co se s klientem dá udělat. Po každé akci se detail i seznam klientů načtou znovu. */
function useClientActions(slug: string) {
  const path = `/api/beyond/velin/client/${encodeURIComponent(slug)}`;
  const [busy, setBusy] = useState(false);

  const act = async (suffix: string, body: unknown, done?: string): Promise<boolean> => {
    setBusy(true);
    try {
      await api(`${path}/${suffix}`, { method: 'POST', body });
      void refresh(`klient.${slug}`, path);
      void refresh(BOARD_KEY, BOARD_PATH);
      void refresh(TASKS_KEY, TASKS_PATH);
      if (done) toast(done);
      return true;
    } catch (err) {
      toast((err as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  return {
    busy,
    decide: (type: string, action: 'vyreseno' | 'odlozit' | 'vratit', done: string) =>
      act(`signal/${encodeURIComponent(type)}`, { action }, done),
    closePromise: (text: string) => act('slib', { text }, 'Odškrtnuto'),
    moveFlag: (title: string, action: 'uzavrit' | 'trva') =>
      act('vlajka', { title, action }, action === 'uzavrit' ? 'Vlajka uzavřená' : 'Potvrzeno, že trvá'),
    takeBack: (id: string) => act(`odskrtnuto/${encodeURIComponent(id)}/vratit`, {}, 'Vráceno mezi otevřené'),
  };
}

type Actions = ReturnType<typeof useClientActions>;

function SignalSheet({
  signal,
  slug,
  actions,
  onClose,
}: {
  signal: Signal;
  slug: string;
  actions: Actions;
  onClose: () => void;
}) {
  const { busy } = actions;
  const decide = async (action: 'vyreseno' | 'odlozit' | 'vratit', done: string) => {
    if (await actions.decide(signal.type, action, done)) onClose();
  };
  const startChat = () => {
    onClose();
    navigate(`/m/chat/new?k=${encodeURIComponent(slug)}&t=${encodeURIComponent(signal.akce?.prompt || '')}`);
  };

  return (
    <Sheet title={signal.title} onClose={onClose}>
      <div className="m-signal-sheet">
        {signal.detail ? <p className="m-signal-detail">{signal.detail}</p> : null}
        {signal.meaning ? <p className="m-signal-meaning">{signal.meaning}</p> : null}

        {signal.items?.length ? (
          <ul className="m-signal-items">
            {signal.items.map((item) => (
              <li key={item.text}>
                <span>{item.text}</span>
                <Button disabled={busy} onClick={() => void actions.closePromise(item.text)}>
                  Hotovo
                </Button>
              </li>
            ))}
          </ul>
        ) : null}

        {signal.vlajky?.length ? (
          <ul className="m-signal-items">
            {signal.vlajky.map((title) => (
              <li key={title}>
                <span>{title}</span>
                <span className="m-signal-pair">
                  <Button disabled={busy} onClick={() => void actions.moveFlag(title, 'trva')}>
                    Trvá
                  </Button>
                  <Button disabled={busy} onClick={() => void actions.moveFlag(title, 'uzavrit')}>
                    Uzavřít
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        ) : null}

        {signal.actor === 'agent' ? (
          <p className="m-signal-note">Tohle si brain řeší sám, nemusíš nic dělat</p>
        ) : signal.schovano ? (
          <>
            <p className="m-signal-note">
              {signal.schovano.stav === 'odlozeno' && signal.schovano.until
                ? `Vrátí se ${new Date(signal.schovano.until).toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric' })}`
                : 'Označené jako vyřešené. Vrátí se, až se objeví něco nového'}
            </p>
            <div className="m-signal-actions">
              <Button disabled={busy} onClick={() => void decide('vratit', 'Zpátky na seznamu')}>
                Vrátit na seznam
              </Button>
            </div>
          </>
        ) : (
          <div className="m-signal-actions">
            {signal.akce ? (
              <Button variant="filled" disabled={busy} onClick={startChat}>
                {signal.akce.label}
              </Button>
            ) : null}
            <Button disabled={busy} onClick={() => void decide('vyreseno', 'Vyřešeno')}>
              Vyřešeno
            </Button>
            <Button disabled={busy} onClick={() => void decide('odlozit', 'Připomenu za týden')}>
              Připomenout za týden
            </Button>
          </div>
        )}
      </div>
    </Sheet>
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
  const actions = useClientActions(slug);
  const [openSignal, setOpenSignal] = useState<string | null>(null);
  const [openPromise, setOpenPromise] = useState<ClientPromise | null>(null);
  const [openFlag, setOpenFlag] = useState<ClientFlag | null>(null);
  const [openItem, setOpenItem] = useState<TimelineItem | null>(null);
  const [openTicked, setOpenTicked] = useState<TickedItem | null>(null);
  const [showHidden, setShowHidden] = useState(false);

  const client = data?.client;
  const fallbackName = tasks.data?.clients.find((c) => c.slug === slug)?.name;
  const title = client?.name || fallbackName || 'Klient';
  const open = (tasks.data?.tasks || []).filter((t) => t.client?.slug === slug && t.state !== 'done');
  const flags = client?.flags.filter((f) => f.open) || [];
  const measurements = client?.measurements || [];
  const latest = measurements[measurements.length - 1];
  const signals = data?.signals || [];
  const hidden = data?.hidden || [];
  const forPeople = signals.filter((signal) => signal.actor !== 'agent');
  const forBrain = signals.filter((signal) => signal.actor === 'agent');
  // Otevřená položka se bere z čerstvých dat, odškrtnutý slib z ní hned zmizí.
  const shownSignal = [...signals, ...hidden].find((signal) => signal.type === openSignal) || null;

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

        {forPeople.length ? (
          <Section title="Co hlídat">
            {forPeople.map((signal) => (
              <SignalRow key={signal.type} signal={signal} onOpen={() => setOpenSignal(signal.type)} />
            ))}
          </Section>
        ) : null}

        {data?.ticked?.length ? (
          <Section title="Brain odškrtl">
            {data.ticked.map((item) => (
              <button type="button" className="m-row m-row-main" key={item.id} onClick={() => setOpenTicked(item)}>
                <span className="m-row-title">{item.text}</span>
                <span className="m-row-sub">{item.zdroj}</span>
              </button>
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
                    <button
                      type="button"
                      className="m-row m-row-main"
                      key={`${item.kind}-${item.dateIso}-${item.title}`}
                      onClick={() => (item.body ? setOpenItem(item) : undefined)}
                    >
                      <span className="m-row-sub">
                        {KIND_LABEL[item.kind]},{' '}
                        {new Date(item.dateIso).toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric', year: 'numeric' })}
                      </span>
                      <span className="m-row-title">{item.title}</span>
                      {item.excerpt ? <span className="m-timeline-excerpt">{item.excerpt}</span> : null}
                    </button>
                  ))}
                </Section>
              ) : (
                <Empty title="Zatím nic">Hovory a zprávy se objeví tady</Empty>
              )
            ) : null}

            {tab === 'sliby' && client ? (
              client.promises.ours.length || client.promises.theirs.length ? (
                <>
                  <Promises title="Slíbili jsme" list={client.promises.ours} onOpen={setOpenPromise} />
                  <Promises title="Slíbil klient" list={client.promises.theirs} onOpen={setOpenPromise} />
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
                    <button type="button" className="m-row m-signal" key={flag.title} onClick={() => setOpenFlag(flag)}>
                      <span className={`m-severity ${flag.severity}`} aria-hidden="true" />
                      <span className="m-link-text">
                        <span className="m-row-title">{flag.title}</span>
                        {flag.body ? <span className="m-row-sub">{flag.body.replace(/\s+/g, ' ')}</span> : null}
                      </span>
                      <Icon name="right" size={16} />
                    </button>
                  ))}
                </Section>
              ) : (
                <Empty title="Žádné vlajky" />
              )
            ) : null}

            {forBrain.length ? (
              <Section title="Řeší brain">
                {forBrain.map((signal) => (
                  <SignalRow key={signal.type} signal={signal} onOpen={() => setOpenSignal(signal.type)} />
                ))}
              </Section>
            ) : null}

            {hidden.length ? (
              <button type="button" className="m-disclosure" onClick={() => setShowHidden((v) => !v)}>
                {showHidden ? 'Skrýt schované' : `Schované (${hidden.length})`}
              </button>
            ) : null}
            {showHidden && hidden.length ? (
              <Section>
                {hidden.map((signal) => (
                  <SignalRow key={signal.type} signal={signal} onOpen={() => setOpenSignal(signal.type)} />
                ))}
              </Section>
            ) : null}
          </>
        ) : null}
      </div>

      {shownSignal ? (
        <SignalSheet signal={shownSignal} slug={slug} actions={actions} onClose={() => setOpenSignal(null)} />
      ) : null}

      {openPromise ? (
        <Sheet title="Slib" onClose={() => setOpenPromise(null)}>
          <div className="m-signal-sheet">
            <p className="m-signal-detail">{openPromise.text}</p>
            <div className="m-signal-actions">
              <Button
                variant="filled"
                disabled={actions.busy}
                onClick={() => void actions.closePromise(openPromise.text).then((ok) => ok && setOpenPromise(null))}
              >
                Hotovo
              </Button>
            </div>
          </div>
        </Sheet>
      ) : null}

      {openFlag ? (
        <Sheet title={openFlag.title} onClose={() => setOpenFlag(null)}>
          <div className="m-signal-sheet">
            {openFlag.body ? <Markdown text={openFlag.body} /> : null}
            <div className="m-signal-actions">
              <Button
                variant="filled"
                disabled={actions.busy}
                onClick={() => void actions.moveFlag(openFlag.title, 'uzavrit').then((ok) => ok && setOpenFlag(null))}
              >
                Uzavřít
              </Button>
              <Button
                disabled={actions.busy}
                onClick={() => void actions.moveFlag(openFlag.title, 'trva').then((ok) => ok && setOpenFlag(null))}
              >
                Pořád trvá
              </Button>
            </div>
          </div>
        </Sheet>
      ) : null}

      {openItem?.body ? (
        <Sheet title={openItem.title} onClose={() => setOpenItem(null)}>
          <div className="m-signal-sheet">
            <Markdown text={openItem.body} />
          </div>
        </Sheet>
      ) : null}

      {openTicked ? (
        <Sheet title="Brain odškrtl" onClose={() => setOpenTicked(null)}>
          <div className="m-signal-sheet">
            <p className="m-signal-detail">{openTicked.text}</p>
            <p className="m-signal-meaning">
              {openTicked.zdroj}: {openTicked.dukaz}
            </p>
            <div className="m-signal-actions">
              <Button
                disabled={actions.busy}
                onClick={() => void actions.takeBack(openTicked.id).then((ok) => ok && setOpenTicked(null))}
              >
                Není hotové, vrátit
              </Button>
            </div>
          </div>
        </Sheet>
      ) : null}
    </>
  );
}
