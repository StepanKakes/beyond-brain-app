import { useEffect, useRef, useState } from 'react';
import { Button, Input, TabBar } from 'glisse';

import { UKAZKA, api, getToken, login } from './api';
import { ChatScreen } from './Chat';
import { Icon } from './icons';
import { CallsScreen } from './Calls';
import { ChatsScreen } from './Chats';
import { ClientDetailScreen, ClientsScreen } from './Clients';
import { RoutineFormScreen, RoutineScreen, RoutinesScreen } from './Routines';
import { FilesScreen, KpiScreen, MoreScreen, WidgetScreen, ObsahDetailScreen, ObsahScreen, ProposalsScreen } from './More';
import { takePendingLink } from './push';
import { navigate, selectTab, useRouter, type Entry, type Tab } from './router';
import { startSocket, stopSocket } from './socket';
import { Stack } from './Stack';
import { TaskDetail } from './TaskDetail';
import { TASKS_KEY, TASKS_PATH, TodayScreen } from './Today';
import { refresh } from './store';
import { ToastHost, toast } from './ui';

const TABS: { value: Tab; label: string; icon: Parameters<typeof Icon>[0]['name'] }[] = [
  { value: 'dnes', label: 'Dnes', icon: 'tasks' },
  { value: 'chaty', label: 'Chaty', icon: 'chat' },
  { value: 'klienti', label: 'Klienti', icon: 'team' },
  { value: 'hovory', label: 'Hovory', icon: 'calendar' },
  { value: 'vice', label: 'Více', icon: 'more' },
];

function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="m-login"
      onSubmit={(event) => {
        event.preventDefault();
        setBusy(true);
        setError(null);
        login(username.trim(), password).catch((e: Error) => {
          setError(e.message);
          setBusy(false);
        });
      }}
    >
      <h1>Beyond Brain</h1>
      <Input
        value={username}
        onValueChange={setUsername}
        placeholder="Uživatel"
        aria-label="Uživatel"
        autoCapitalize="none"
        autoCorrect="off"
        autoComplete="username"
      />
      <Input
        value={password}
        onValueChange={setPassword}
        placeholder="Heslo"
        aria-label="Heslo"
        type="password"
        autoComplete="current-password"
      />
      {error ? <p className="m-login-error">{error}</p> : null}
      <Button type="submit" variant="filled" disabled={busy || !username.trim() || !password}>
        Přihlásit se
      </Button>
    </form>
  );
}

function Shell() {
  const { tab, stack } = useRouter();
  const base = useRef<HTMLDivElement>(null);
  // Taby zůstávají v paměti i se scrollem, přepnutí nic nepřekresluje.
  const [visited, setVisited] = useState<Set<Tab>>(() => new Set([tab]));

  useEffect(() => {
    setVisited((current) => (current.has(tab) ? current : new Set(current).add(tab)));
  }, [tab]);

  useEffect(() => {
    startSocket();
    return stopSocket;
  }, []);

  // iOS si styl stavového řádku uloží při přidání na plochu. Starší instalace běží
  // pod průsvitným řádkem (nenulový horní inset) a tam iOS 27 rozmazává horní lištu.
  useEffect(() => {
    if (!(navigator as Navigator & { standalone?: boolean }).standalone) return;
    if (matchMedia('(orientation: landscape)').matches) return;
    const probe = document.createElement('div');
    probe.style.cssText = 'position:fixed;visibility:hidden;height:env(safe-area-inset-top,0px)';
    document.body.append(probe);
    const inset = probe.getBoundingClientRect().height;
    probe.remove();
    if (inset > 0) toast('Stará instalace, kvůli ní je nahoře rozmazání. Smaž appku z plochy a přidej ji znovu', undefined, 9000);
  }, []);

  // Rutiny i „dnes“ u úkolů se řídí časem na telefonu. Pásmo hlásíme při otevření
  // a po návratu, server jiné pásmo než telefon nemá jak zjistit.
  useEffect(() => {
    let reported: string | null = null;
    const report = () => {
      if (document.visibilityState !== 'visible') return;
      const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (!zone || zone === reported) return;
      reported = zone;
      api<{ zmeneno?: boolean }>('/api/beyond/velin/rutiny/pasmo', { method: 'POST', body: { zone } })
        .then(async (result) => {
          if (!result?.zmeneno) return;
          // První refresh může jen vrátit dotaz, který vyšel ještě ve starém pásmu.
          await refresh(TASKS_KEY, TASKS_PATH);
          await refresh(TASKS_KEY, TASKS_PATH);
        })
        .catch(() => {
          reported = null;
        });
    };
    report();
    document.addEventListener('visibilitychange', report);
    return () => document.removeEventListener('visibilitychange', report);
  }, []);

  // Cíl z notifikace, ať je appka zavřená, nebo jen na pozadí.
  useEffect(() => {
    // Appka se může probudit dřív, než service worker cíl uloží. Proto se po
    // návratu podívá víckrát, a zpráva od workeru na iOS nemusí dorazit vůbec.
    const timers: number[] = [];
    const openPending = () => {
      if (document.visibilityState !== 'visible') return;
      timers.splice(0).forEach(clearTimeout);
      for (const delay of [0, 400, 1200, 3000]) {
        timers.push(
          window.setTimeout(() => {
            void takePendingLink().then((url) => {
              if (url) navigate(url);
            });
          }, delay),
        );
      }
    };
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; urlPath?: string } | null;
      if (data?.type === 'notification:navigate' && data.urlPath) {
        void takePendingLink();
        navigate(data.urlPath);
      }
    };
    openPending();
    document.addEventListener('visibilitychange', openPending);
    window.addEventListener('focus', openPending);
    navigator.serviceWorker?.addEventListener('message', onMessage);
    return () => {
      timers.forEach(clearTimeout);
      window.removeEventListener('focus', openPending);
      document.removeEventListener('visibilitychange', openPending);
      navigator.serviceWorker?.removeEventListener('message', onMessage);
    };
  }, []);

  const renderPushed = (entry: Entry, active: boolean) => {
    if (entry.route.name === 'chat') {
      return <ChatScreen uuid={entry.route.uuid} slug={entry.route.slug} draft={entry.route.draft} active={active} />;
    }
    if (entry.route.name === 'ukol') return <TaskDetail id={entry.route.id} />;
    if (entry.route.name === 'klient') return <ClientDetailScreen slug={entry.route.slug} />;
    if (entry.route.name === 'navrhy') return <ProposalsScreen />;
    if (entry.route.name === 'obsah') return <ObsahScreen />;
    if (entry.route.name === 'obsah-detail') return <ObsahDetailScreen id={entry.route.id} />;
    if (entry.route.name === 'kpi') return <KpiScreen />;
    if (entry.route.name === 'widget') return <WidgetScreen />;
    if (entry.route.name === 'rutiny') return <RoutinesScreen />;
    if (entry.route.name === 'rutina') return <RoutineScreen name={entry.route.id} />;
    if (entry.route.name === 'rutina-form') return <RoutineFormScreen name={entry.route.id} template={entry.route.sablona} />;
    if (entry.route.name === 'soubory') return <FilesScreen path={entry.route.path} />;
    return null;
  };

  return (
    <>
      <div className="m-base" ref={base}>
        {TABS.map(({ value }) =>
          visited.has(value) ? (
            <div key={value} className={`m-tab${value === tab ? ' is-active' : ''}`} aria-hidden={value !== tab}>
              {value === 'dnes' ? <TodayScreen /> : null}
              {value === 'chaty' ? <ChatsScreen /> : null}
              {value === 'klienti' ? <ClientsScreen /> : null}
              {value === 'hovory' ? <CallsScreen /> : null}
              {value === 'vice' ? <MoreScreen /> : null}
            </div>
          ) : null,
        )}
        <nav className="m-tabbar">
          <TabBar
            aria-label="Hlavní navigace"
            value={tab}
            onValueChange={(value) => selectTab(value as Tab)}
            items={TABS.map(({ value, label, icon }) => ({ value, label, icon: <Icon name={icon} size={24} /> }))}
          />
        </nav>
      </div>
      <Stack stack={stack} baseRef={base} render={renderPushed} />
    </>
  );
}

export default function MobileApp() {
  const [authed, setAuthed] = useState(() => UKAZKA || Boolean(getToken()));
  useEffect(() => {
    const sync = () => setAuthed(UKAZKA || Boolean(getToken()));
    window.addEventListener('m-auth', sync);
    return () => window.removeEventListener('m-auth', sync);
  }, []);

  // Klávesnice: appka drží přesně výšku viditelné části obrazovky.
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return undefined;
    const root = document.documentElement;
    // Plná výška se bere z viewportu samotného, window.innerHeight se s klávesnicí může zmenšit taky.
    let full = 0;
    const apply = () => {
      full = Math.max(full, viewport.height);
      root.style.setProperty('--m-vh', `${viewport.height}px`);
      root.style.setProperty('--m-vt', `${viewport.offsetTop}px`);
      root.classList.toggle('m-keyboard', full - viewport.height > 120);
      if (window.scrollY) window.scrollTo(0, 0);
    };
    const rotate = () => {
      full = 0;
    };
    // Událost o změně výšky občas nepřijde, proto se po změně fokusu měří ještě jednou.
    let settle = 0;
    const onFocusChange = () => {
      window.clearTimeout(settle);
      settle = window.setTimeout(apply, 350);
    };
    apply();
    viewport.addEventListener('resize', apply);
    viewport.addEventListener('scroll', apply);
    window.addEventListener('orientationchange', rotate);
    document.addEventListener('focusin', onFocusChange);
    document.addEventListener('focusout', onFocusChange);
    return () => {
      window.clearTimeout(settle);
      viewport.removeEventListener('resize', apply);
      viewport.removeEventListener('scroll', apply);
      window.removeEventListener('orientationchange', rotate);
      document.removeEventListener('focusin', onFocusChange);
      document.removeEventListener('focusout', onFocusChange);
    };
  }, []);

  return (
    <div className="m-root">
      {authed ? <Shell /> : <Login />}
      <ToastHost />
    </div>
  );
}
