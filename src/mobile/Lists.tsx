import { useEffect, useMemo, useState } from 'react';
import { Button, Switch } from 'glisse';

import { UKAZKA, api, setToken } from './api';
import { CHATS_KEY } from './Chat';
import { Icon } from './icons';
import { disablePush, enablePush, pushStatus, sendTestPush, type PushStatus } from './push';
import { UNIVERSAL, navigate } from './router';
import { clearCache, mutate, readCache, useResource } from './store';
import { CALLS_KEY, CALLS_PATH, TASKS_KEY, TASKS_PATH } from './Today';
import type { CallsResponse, ChatSession, SessionIndex, TasksResponse } from './types';
import { Empty, Section, TabScreen, timeOf, toast } from './ui';

function ago(ms: number): string {
  const minutes = Math.round((Date.now() - ms) / 60000);
  if (minutes < 1) return 'teď';
  if (minutes < 60) return `před ${minutes} min`;
  const date = new Date(ms);
  if (date.toDateString() === new Date().toDateString()) return timeOf(date.toISOString());
  return date.toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric' });
}

export function ChatsScreen() {
  const tasks = useResource<TasksResponse>(TASKS_KEY, TASKS_PATH);
  const [chats, setChats] = useState<ChatSession[]>(() => readCache<ChatSession[]>(CHATS_KEY) || []);
  const clients = tasks.data?.clients;

  // Chaty jsou po klientech v oddělených indexech, tady je jeden seznam podle času.
  useEffect(() => {
    let live = true;
    const load = async () => {
      const slugs = [{ slug: UNIVERSAL, name: '' }, ...(clients || [])];
      const results = await Promise.all(
        slugs.map(({ slug, name }) =>
          api<SessionIndex>(`/api/beyond/sessions/${encodeURIComponent(slug)}`)
            .then((index) => index.sessions.map((s) => ({ ...s, slug, clientName: name })))
            .catch(() => [] as ChatSession[]),
        ),
      );
      if (!live) return;
      const merged = results.flat().sort((a, b) => b.lastUsedAt - a.lastUsedAt).slice(0, 60);
      setChats(merged);
      mutate<ChatSession[]>(CHATS_KEY, () => merged);
    };
    void load();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      live = false;
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [clients]);

  return (
    <TabScreen
      title="Chaty"
      action={
        <button type="button" className="m-icon-btn" aria-label="Nový chat" onClick={() => navigate('/m/chat/new')}>
          <Icon name="compose" />
        </button>
      }
    >
      {chats.length ? (
        <Section>
          {chats.map((chat) => (
            <button
              type="button"
              key={chat.uuid}
              className="m-row m-row-main"
              onClick={() => navigate(`/m/chat/${chat.uuid}?k=${encodeURIComponent(chat.slug)}`)}
            >
              <span className="m-row-title" title={chat.title}>
                {chat.title || 'Chat'}
              </span>
              <span className="m-row-sub">{[chat.clientName, ago(chat.lastUsedAt)].filter(Boolean).join(' · ')}</span>
            </button>
          ))}
        </Section>
      ) : (
        <Empty title="Zatím žádný chat">Začni tlačítkem vpravo nahoře</Empty>
      )}
    </TabScreen>
  );
}

export function CallsScreen() {
  const { data, error } = useResource<CallsResponse>(CALLS_KEY, CALLS_PATH);
  const days = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return (data?.days || []).filter((d) => d.calls.length && d.day >= today);
  }, [data]);

  const label = (day: string) => {
    const date = new Date(`${day}T12:00:00`);
    const now = new Date();
    const tomorrow = new Date(now.getTime() + 86400000);
    if (date.toDateString() === now.toDateString()) return 'Dnes';
    if (date.toDateString() === tomorrow.toDateString()) return 'Zítra';
    return date.toLocaleDateString('cs-CZ', { weekday: 'long', day: 'numeric', month: 'long' });
  };

  return (
    <TabScreen title="Hovory">
      {!data && error ? <Empty title="Hovory se nenačetly">{error}</Empty> : null}
      {data && !days.length ? <Empty title="Žádné hovory">Na příštích 14 dní nic v kalendáři</Empty> : null}
      {days.map((day) => (
        <Section key={day.day} title={label(day.day)}>
          {day.calls.map((call) => (
            <a
              key={call.uid || call.id}
              className="m-row m-row-main"
              href={call.meetingUrl || undefined}
              target="_blank"
              rel="noreferrer"
            >
              <span className="m-row-title" title={call.clientName || call.title}>
                {call.clientName || call.title}
              </span>
              <span className={`m-row-sub${call.live ? ' is-live' : ''}`}>
                {call.live ? 'Právě probíhá' : `${timeOf(call.startIso)}, ${call.durationMin} min`}
              </span>
            </a>
          ))}
        </Section>
      ))}
    </TabScreen>
  );
}

const PUSH_HINT: Partial<Record<PushStatus, string>> = {
  'needs-install': 'V Safari klepni na Sdílet a Přidat na plochu. Notifikace fungují jen z appky na ploše',
  unsupported: 'Tenhle prohlížeč notifikace neumí',
  denied: 'Notifikace jsou zakázané. Povol je v Nastavení iPhonu u téhle appky',
};

export function MoreScreen() {
  const [status, setStatus] = useState<PushStatus>('off');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void pushStatus().then(setStatus);
  }, []);

  const toggle = async (on: boolean) => {
    setBusy(true);
    try {
      if (on) {
        await enablePush();
        setStatus('on');
      } else {
        await disablePush();
        setStatus('off');
      }
    } catch (error) {
      toast((error as Error).message);
      setStatus(await pushStatus());
    }
    setBusy(false);
  };

  return (
    <TabScreen title="Více">
      <Section title="Notifikace">
        <div className="m-row m-row-setting">
          <span className="m-row-title">Na tenhle telefon</span>
          <Switch
            aria-label="Notifikace na tenhle telefon"
            checked={status === 'on'}
            disabled={busy || (status !== 'on' && status !== 'off')}
            onCheckedChange={(on) => void toggle(on)}
          />
        </div>
        {PUSH_HINT[status] ? <p className="m-hint">{PUSH_HINT[status]}</p> : null}
        {status === 'on' ? (
          <div className="m-row m-row-setting">
            <Button
              onClick={() =>
                void sendTestPush()
                  .then(() => toast('Za chvíli dorazí, klepnutí otevře Hovory'))
                  .catch((error: Error) => toast(error.message))
              }
            >
              Poslat zkušební
            </Button>
          </div>
        ) : null}
      </Section>
      <Section title="Účet">
        <a className="m-row m-row-main" href="/?desktop=1">
          <span className="m-row-title">Otevřít plnou verzi</span>
          <span className="m-row-sub">Soubory, editor a nastavení agenta</span>
        </a>
        {!UKAZKA ? (
          <button
            type="button"
            className="m-row m-row-main"
            onClick={() => {
              clearCache();
              setToken(null);
            }}
          >
            <span className="m-row-title is-danger">Odhlásit se</span>
          </button>
        ) : null}
      </Section>
    </TabScreen>
  );
}
