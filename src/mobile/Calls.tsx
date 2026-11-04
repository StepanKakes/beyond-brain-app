import { useMemo, useState } from 'react';
import { SegmentedControl } from 'glisse';

import { navigate } from './router';
import { useResource } from './store';
import { CALLS_KEY, CALLS_PATH, TASKS_KEY, TASKS_PATH, meKey } from './Today';
import type { Call, CallsResponse, TasksResponse } from './types';
import { Empty, Section, Skeleton, TabScreen, timeOf } from './ui';

function dayLabel(day: string): string {
  const date = new Date(`${day}T12:00:00`);
  const now = new Date();
  const tomorrow = new Date(now.getTime() + 86400000);
  if (date.toDateString() === now.toDateString()) return 'Dnes';
  if (date.toDateString() === tomorrow.toDateString()) return 'Zítra';
  return date.toLocaleDateString('cs-CZ', { weekday: 'long', day: 'numeric', month: 'long' });
}

function CallRow({ call, showHost }: { call: Call; showHost: boolean }) {
  const name = call.clientName || call.title;
  const soon = call.live || (call.startsInMin !== null && call.startsInMin >= 0 && call.startsInMin <= 15);
  const sub = [
    call.clientName && call.title !== call.clientName ? call.title : null,
    showHost ? call.host?.name : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const open = () => {
    if (call.clientSlug) navigate(`/m/klient/${encodeURIComponent(call.clientSlug)}`);
    else if (call.meetingUrl) window.open(call.meetingUrl, '_blank', 'noreferrer');
  };
  return (
    <div className={`m-row m-call${call.block ? ' is-block' : ''}`}>
      <button type="button" className="m-call-main" onClick={open}>
        <span className="m-call-time">
          <span className={call.live ? 'is-live' : undefined}>{call.live ? 'Teď' : timeOf(call.startIso)}</span>
          <small>{call.durationMin} min</small>
        </span>
        <span className="m-link-text">
          <span className="m-row-title" title={name}>
            {name}
          </span>
          {sub ? <span className="m-row-sub">{sub}</span> : null}
        </span>
      </button>
      {soon && call.meetingUrl && !call.block ? (
        <a className="m-pill is-solid" href={call.meetingUrl} target="_blank" rel="noreferrer">
          Připojit
        </a>
      ) : null}
    </div>
  );
}

export function CallsScreen() {
  const { data, error } = useResource<CallsResponse>(CALLS_KEY, CALLS_PATH);
  const tasks = useResource<TasksResponse>(TASKS_KEY, TASKS_PATH);
  const [scope, setScope] = useState<'moje' | 'vsechny'>('moje');
  const me = meKey(tasks.data);

  const days = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return (data?.days || [])
      .filter((d) => d.day >= today)
      .map((d) => ({
        ...d,
        calls: d.calls.filter((c) => scope === 'vsechny' || !me || !c.host || c.host.key === me),
      }))
      .filter((d) => d.calls.length);
  }, [data, scope, me]);

  return (
    <TabScreen title="Hovory">
      <div className="m-scope m-scope-2">
        <SegmentedControl
          aria-label="Čí hovory"
          value={scope}
          onValueChange={(value) => setScope(value as 'moje' | 'vsechny')}
          items={[
            { value: 'moje', label: 'Moje' },
            { value: 'vsechny', label: 'Všechny' },
          ]}
        />
      </div>
      {!data && !error ? <Skeleton /> : null}
      {!data && error ? <Empty title="Hovory se nenačetly">{error}</Empty> : null}
      {data?.error ? <p className="m-hint">{data.error}</p> : null}
      {data && !days.length ? <Empty title="Žádné hovory">Na příští tři týdny nic v kalendáři</Empty> : null}
      {days.map((day) => (
        <Section key={day.day} title={dayLabel(day.day)}>
          {day.calls.map((call) => (
            <CallRow key={call.uid || call.id} call={call} showHost={scope === 'vsechny'} />
          ))}
        </Section>
      ))}
    </TabScreen>
  );
}
