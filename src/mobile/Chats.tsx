import { useEffect, useMemo, useState } from 'react';
import { SearchField } from 'glisse';

import { api } from './api';
import { CHATS_KEY } from './Chat';
import { UNIVERSAL, navigate } from './router';
import { mutate, readCache, useResource } from './store';
import { TASKS_KEY, TASKS_PATH } from './Today';
import type { ChatSession, SessionIndex, TasksResponse } from './types';
import { BarButton, Empty, Section, SwipeRow, TabScreen, ago, deleteWithUndo } from './ui';

function groupOf(ms: number): string {
  const date = new Date(ms);
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (ms >= start) return 'Dnes';
  if (ms >= start - 86400000) return 'Včera';
  if (ms >= start - 7 * 86400000) return 'Tento týden';
  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString('cs-CZ', { month: 'long' }).replace(/^./, (c) => c.toLocaleUpperCase('cs'));
  }
  return String(date.getFullYear());
}

export function ChatsScreen() {
  const tasks = useResource<TasksResponse>(TASKS_KEY, TASKS_PATH);
  const [chats, setChats] = useState<ChatSession[]>(() => readCache<ChatSession[]>(CHATS_KEY) || []);
  const [query, setQuery] = useState('');
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
      const merged = results.flat().sort((a, b) => b.lastUsedAt - a.lastUsedAt).slice(0, 200);
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

  const groups = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('cs');
    const shown = needle
      ? chats.filter((chat) => `${chat.title} ${chat.clientName || ''}`.toLocaleLowerCase('cs').includes(needle))
      : chats;
    const map = new Map<string, ChatSession[]>();
    shown.forEach((chat) => {
      const key = groupOf(chat.lastUsedAt);
      map.set(key, [...(map.get(key) || []), chat]);
    });
    return [...map.entries()];
  }, [chats, query]);

  const remove = (chat: ChatSession) => {
    deleteWithUndo({
      text: 'Chat odebrán',
      hide: () => setChats((list) => list.filter((c) => c.uuid !== chat.uuid)),
      restore: () =>
        setChats((list) => [...list, chat].sort((a, b) => b.lastUsedAt - a.lastUsedAt)),
      commit: async () => {
        const index = await api<SessionIndex>(`/api/beyond/sessions/${encodeURIComponent(chat.slug)}`);
        await api(`/api/beyond/sessions/${encodeURIComponent(chat.slug)}`, {
          method: 'PUT',
          body: {
            ...index,
            activeUuid: index.activeUuid === chat.uuid ? null : index.activeUuid,
            sessions: index.sessions.filter((s) => s.uuid !== chat.uuid),
            deletedUuids: [chat.uuid],
          },
        });
        mutate<ChatSession[]>(CHATS_KEY, (current) => (current || []).filter((c) => c.uuid !== chat.uuid));
      },
    });
  };

  return (
    <TabScreen
      title="Chaty"
      action={
        <BarButton icon="compose" label="Nový chat" onClick={() => navigate('/m/chat/new')} />
      }
    >
      {chats.length ? (
        <div className="m-search">
          <SearchField
            aria-label="Hledat v chatech"
            placeholder="Hledat"
            value={query}
            onValueChange={setQuery}
          />
        </div>
      ) : null}
      {!chats.length ? <Empty title="Zatím žádný chat">Začni tlačítkem vpravo nahoře</Empty> : null}
      {chats.length && !groups.length ? <Empty title="Nic nenalezeno">Zkus jiné slovo</Empty> : null}
      {groups.map(([label, list]) => (
        <Section key={label} title={label}>
          {list.map((chat) => (
            <SwipeRow key={chat.uuid} label="Odebrat" onAction={() => remove(chat)}>
              <button
                type="button"
                className="m-row m-row-main"
                onClick={() => navigate(`/m/chat/${chat.uuid}?k=${encodeURIComponent(chat.slug)}`)}
              >
                <span className="m-row-title" title={chat.title}>
                  {chat.title || 'Chat'}
                </span>
                <span className="m-row-sub">{[chat.clientName, ago(chat.lastUsedAt)].filter(Boolean).join(' · ')}</span>
              </button>
            </SwipeRow>
          ))}
        </Section>
      ))}
    </TabScreen>
  );
}
