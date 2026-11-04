import { useEffect, useState } from 'react';
import { Button, SegmentedControl } from 'glisse';

import { api, fetchBlobUrl } from './api';
import { Icon } from './icons';
import { back, navigate, UNIVERSAL } from './router';
import { refresh, useResource } from './store';
import { TASKS_KEY, TASKS_PATH, patchLocal, removeTask, setTaskState } from './Today';
import type { Prep, Proposal, ProposalsResponse, Task, TaskAction, TasksResponse } from './types';
import { Empty, HoldButton, LinkRow, Markdown, Picker, PushedBar, Section, Sheet, toast } from './ui';

export const PROPOSALS_KEY = 'navrhy';
export const PROPOSALS_PATH = '/api/beyond/velin/navrhy';
const VELIN = '/api/beyond/velin';

const STATUS_TEXT: Record<Proposal['status'], string> = {
  pending: 'Čeká na schválení',
  sent: 'Odesláno',
  rejected: 'Zahozeno',
  failed: 'Odeslání selhalo',
  expired: 'Propadlo',
};

const afterProposal = () =>
  Promise.all([refresh(PROPOSALS_KEY, PROPOSALS_PATH), refresh(TASKS_KEY, TASKS_PATH)]);

function ProposalView({ proposalId }: { proposalId: number }) {
  const { data, error } = useResource<ProposalsResponse>(PROPOSALS_KEY, PROPOSALS_PATH);
  const proposal =
    data?.pending.find((p) => p.id === proposalId) ?? data?.recent.find((p) => p.id === proposalId) ?? null;
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!proposal) {
    return (
      <>
        <PushedBar title="Návrh zprávy" />
        <div className="m-scroll m-detail">
          {data ? <Empty title="Návrh už tu není">Mezitím se vyřešil nebo propadl</Empty> : null}
          {!data && error ? <Empty title="Návrh se nenačetl">{error}</Empty> : null}
        </div>
      </>
    );
  }

  const pending = proposal.status === 'pending';
  const who = proposal.clientName || proposal.target || 'Příjemce neznámý';

  const save = async () => {
    if (draft === null) return;
    setBusy(true);
    try {
      await api(`${PROPOSALS_PATH}/${proposal.id}`, { method: 'PATCH', body: { body: draft } });
      await afterProposal();
      setDraft(null);
    } catch (e) {
      toast((e as Error).message);
    }
    setBusy(false);
  };

  const send = async () => {
    setBusy(true);
    try {
      await api(`${PROPOSALS_PATH}/${proposal.id}/odeslat`, { method: 'POST' });
      await afterProposal();
      toast(`Odesláno: ${who}`);
      back();
    } catch (e) {
      toast((e as Error).message);
      setBusy(false);
    }
  };

  const discard = async () => {
    setBusy(true);
    try {
      await api(`${PROPOSALS_PATH}/${proposal.id}/zahodit`, { method: 'POST' });
      await afterProposal();
      back();
    } catch (e) {
      toast((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <>
      <PushedBar title={proposal.title || 'Návrh zprávy'} />
      <div className="m-scroll m-detail">
        <p className="m-detail-label">Pro</p>
        <p className="m-detail-who" title={who}>
          {who}
        </p>
        {draft !== null ? (
          <textarea
            className="m-textarea"
            value={draft}
            autoFocus
            aria-label="Text zprávy"
            onChange={(event) => setDraft(event.target.value)}
          />
        ) : (
          <div className="m-bubble-preview">{proposal.body}</div>
        )}
        {proposal.reason ? (
          <>
            <p className="m-detail-label">Proč</p>
            <p className="m-detail-note">{proposal.reason}</p>
          </>
        ) : null}
        {!pending ? <p className="m-detail-note">{STATUS_TEXT[proposal.status]}</p> : null}
        {proposal.error ? <p className="m-detail-note is-error">{proposal.error}</p> : null}
      </div>
      {pending ? (
        <footer className="m-actions">
          {draft !== null ? (
            <>
              <Button onClick={() => setDraft(null)} disabled={busy}>
                Zrušit
              </Button>
              <Button variant="filled" onClick={() => void save()} disabled={busy || !draft.trim()}>
                Uložit
              </Button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="m-icon-btn"
                aria-label="Zahodit"
                onClick={() => void discard()}
                disabled={busy}
              >
                <Icon name="trash" />
              </button>
              <button
                type="button"
                className="m-icon-btn"
                aria-label="Upravit"
                onClick={() => setDraft(proposal.body)}
                disabled={busy}
              >
                <Icon name="compose" />
              </button>
              <HoldButton
                label="Podrž a odešli"
                busy={busy}
                disabled={data ? !data.canSend : true}
                onConfirm={() => void send()}
              />
            </>
          )}
        </footer>
      ) : null}
    </>
  );
}

function isoPlus(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const PRIORITIES = [
  { value: '1', label: 'Nejvyšší', tone: 'p1' },
  { value: '2', label: 'Vysoká', tone: 'p2' },
  { value: '3', label: 'Střední', tone: 'p3' },
  { value: '4', label: 'Bez priority', tone: 'p4' },
];

function PrepClip({ path }: { path: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let current: string | null = null;
    let live = true;
    fetchBlobUrl(path)
      .then((value) => {
        current = value;
        if (live) setUrl(value);
      })
      .catch(() => undefined);
    return () => {
      live = false;
      if (current) URL.revokeObjectURL(current);
    };
  }, [path]);
  if (!url) return <p className="m-detail-note">Načítám klip</p>;
  return <video className="m-media" src={url} controls playsInline />;
}

function PrepBlock({ task, prep }: { task: Task; prep: Prep }) {
  const [busy, setBusy] = useState(false);
  const [diff, setDiff] = useState<{ before: string | null; after: string } | null>(null);
  const [discarding, setDiscarding] = useState(false);
  const [why, setWhy] = useState('');
  const id = prep.ref;

  const after = async () => {
    await refresh(TASKS_KEY, TASKS_PATH);
    back();
  };

  const run = async (action: TaskAction) => {
    if (action.action === 'open-file' && action.path) {
      navigate(`/m/soubory?p=${encodeURIComponent(action.path)}`);
      return;
    }
    if (action.action === 'navrh-upravit') {
      navigate(`/m/ukol/navrh:${id}`);
      return;
    }
    if (action.action === 'obsah-zahodit') {
      setDiscarding(true);
      return;
    }
    setBusy(true);
    try {
      if (action.action === 'obsah-schvalit') {
        await api(`${VELIN}/obsah/${encodeURIComponent(String(id))}`, { method: 'PATCH', body: { state: 'schvaleno' } });
      } else if (action.action === 'navrh-odeslat') {
        await api(`${VELIN}/navrhy/${id}/odeslat`, { method: 'POST' });
      } else if (action.action === 'navrh-zahodit') {
        await api(`${VELIN}/navrhy/${id}/zahodit`, { method: 'POST' });
      } else if (action.action === 'mozek-schvalit') {
        await api(`${VELIN}/agent/mozek/${id}/schvalit`, { method: 'POST' });
      } else if (action.action === 'mozek-zahodit') {
        await api(`${VELIN}/agent/mozek/${id}/zahodit`, { method: 'POST' });
      } else if (action.action === 'mozek-diff') {
        if (diff) {
          setDiff(null);
        } else {
          const response = await api<{ items: { id: number; before: string | null; after: string }[] }>(`${VELIN}/agent/mozek`);
          setDiff(response.items.find((item) => item.id === Number(id)) || null);
        }
        setBusy(false);
        return;
      } else {
        setBusy(false);
        return;
      }
      await after();
    } catch (error) {
      toast((error as Error).message);
      setBusy(false);
    }
  };

  const discardObsah = async () => {
    setBusy(true);
    try {
      await api(`${VELIN}/obsah/${encodeURIComponent(String(id))}`, {
        method: 'PATCH',
        body: { state: 'zahozeno', ...(why.trim() ? { note: `zahozeno: ${why.trim()}` } : {}) },
      });
      setDiscarding(false);
      await after();
    } catch (error) {
      toast((error as Error).message);
      setBusy(false);
    }
  };

  return (
    <section className="m-prep" aria-label={prep.title}>
      <p className="m-detail-label">{prep.title}</p>
      {prep.body ? <Markdown text={prep.body} /> : null}
      {prep.images?.length ? (
        <div className="m-media-row">
          {prep.images.map((src, index) => (
            <img key={src} src={src} alt={`Slide ${index + 1}`} loading="lazy" />
          ))}
        </div>
      ) : null}
      {prep.clip ? <PrepClip path={prep.clip} /> : null}
      {diff ? (
        <div className="m-diff">
          {diff.before ? <pre className="m-pre is-before">{diff.before}</pre> : null}
          <pre className="m-pre">{diff.after}</pre>
        </div>
      ) : null}
      {prep.link ? (
        <a className="m-pill" href={prep.link.url} target="_blank" rel="noreferrer">
          <Icon name="link" size={15} />
          <span>{prep.link.label}</span>
        </a>
      ) : null}
      {prep.actions.length ? (
        <div className="m-prep-actions">
          {prep.actions.map((action) =>
            action.action === 'navrh-odeslat' ? (
              <HoldButton
                key={action.action}
                label="Podrž a odešli"
                busy={busy}
                disabled={prep.canSend === false}
                onConfirm={() => void run(action)}
              />
            ) : (
              <Button
                key={action.action + (action.path || '')}
                variant={action.primary ? 'filled' : undefined}
                disabled={busy}
                onClick={() => void run(action)}
              >
                {action.action === 'mozek-diff' && diff ? 'Skrýt změnu' : action.label}
              </Button>
            ),
          )}
        </div>
      ) : null}
      {discarding ? (
        <Sheet title={`Zahodit: ${task.text}`} onClose={() => setDiscarding(false)}>
          <input
            className="m-input"
            autoFocus
            value={why}
            onChange={(event) => setWhy(event.target.value)}
            placeholder="Proč, ať se to příště nevrací"
            aria-label="Důvod"
          />
          <div className="m-sheet-actions">
            <Button destructive disabled={busy} onClick={() => void discardObsah()}>
              Zahodit
            </Button>
          </div>
        </Sheet>
      ) : null}
    </section>
  );
}

type Field = 'due' | 'priority' | 'owner' | 'client' | null;

function TaskView({ task, data }: { task: Task; data: TasksResponse }) {
  const [title, setTitle] = useState(task.text);
  const [field, setField] = useState<Field>(null);

  useEffect(() => setTitle(task.text), [task.text]);

  const patch = async (body: Record<string, unknown>, local: Partial<Task>) => {
    patchLocal(task.id, local);
    try {
      await api(`${TASKS_PATH}/${encodeURIComponent(task.id)}`, { method: 'PATCH', body });
      // Popisek termínu skládá server.
      await refresh(TASKS_KEY, TASKS_PATH);
    } catch (error) {
      toast((error as Error).message || 'Změna se neuložila');
      await refresh(TASKS_KEY, TASKS_PATH);
    }
  };

  const saveTitle = () => {
    const next = title.trim();
    if (!next) {
      setTitle(task.text);
      return;
    }
    if (next !== task.text) void patch({ text: next }, { text: next });
  };

  const done = task.state === 'done';
  const owner = data.people.find((p) => p.key === task.owner)?.displayName || task.owner || 'Nikdo';
  const priority = PRIORITIES.find((p) => p.value === String(task.priority)) || PRIORITIES[3];
  const askBrain = () => {
    const slug = task.client?.slug || UNIVERSAL;
    navigate(`/m/chat/new?k=${encodeURIComponent(slug)}&t=${encodeURIComponent(`K úkolu "${task.text}": `)}`);
  };

  return (
    <>
      <PushedBar title="Úkol" />
      <div className="m-scroll m-detail m-task-detail">
        <div className="m-title-edit">
          <button
            type="button"
            className={`m-check p${task.priority}${task.state === 'work' ? ' is-work' : ''}`}
            role="checkbox"
            aria-checked={done}
            aria-label={done ? 'Vrátit mezi nehotové' : 'Označit jako hotové'}
            onClick={() => void setTaskState(task.id, done ? 'none' : 'done')}
          />
          {task.virtual ? (
            <h2 className="m-detail-title">{task.text}</h2>
          ) : (
            <textarea
              className="m-detail-title"
              value={title}
              rows={1}
              aria-label="Název úkolu"
              enterKeyHint="done"
              onChange={(event) => setTitle(event.target.value.replace(/\n/g, ' '))}
              onBlur={saveTitle}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  event.currentTarget.blur();
                }
              }}
            />
          )}
        </div>

        <SegmentedControl
          aria-label="Stav úkolu"
          value={task.state}
          onValueChange={(value) => void setTaskState(task.id, value as Task['state'])}
          items={[
            { value: 'none', label: 'Čeká' },
            { value: 'work', label: 'Pracuje se' },
            { value: 'done', label: 'Hotovo' },
          ]}
        />

        {task.prep ? <PrepBlock task={task} prep={task.prep} /> : null}

        {task.virtual ? null : (
          <div className="m-group m-fields">
            <LinkRow
              icon="date"
              title="Termín"
              value={<span className={task.dueKind === 'over' ? 'is-over' : undefined}>{task.dueLabel || 'Bez termínu'}</span>}
              onClick={() => setField('due')}
            />
            <LinkRow
              icon="flag"
              title="Priorita"
              value={
                <>
                  <span className={`m-flag ${priority.tone}`} aria-hidden="true" />
                  {priority.label}
                </>
              }
              onClick={() => setField('priority')}
            />
            {data.people.length > 1 ? (
              <LinkRow icon="person" title="Kdo" value={owner} onClick={() => setField('owner')} />
            ) : null}
            <LinkRow
              icon="team"
              title="Klient"
              value={<span className="m-truncate">{task.client?.name || 'Žádný'}</span>}
              onClick={() => setField('client')}
            />
          </div>
        )}

        {task.note ? (
          <section>
            <p className="m-detail-label">Poznámka</p>
            <Markdown text={task.note} />
          </section>
        ) : null}

        <Section>
          <LinkRow icon="sparkle" title="Zeptat se brainu" onClick={askBrain} />
          {task.client ? (
            <LinkRow
              icon="person"
              title="Otevřít klienta"
              sub={task.client.name}
              onClick={() => navigate(`/m/klient/${encodeURIComponent(task.client?.slug || '')}`)}
            />
          ) : null}
        </Section>

        {task.virtual ? null : (
          <Section>
            <LinkRow title="Smazat úkol" danger onClick={() => removeTask(task, () => back())} />
          </Section>
        )}
      </div>

      {field === 'due' ? (
        <Picker
          title="Termín"
          value={task.due?.slice(0, 10) || 'none'}
          options={[
            { value: isoPlus(0), label: 'Dnes' },
            { value: isoPlus(1), label: 'Zítra' },
            { value: isoPlus(7), label: 'Za týden' },
            { value: 'none', label: 'Bez termínu' },
          ]}
          onPick={(value) => {
            const due = value === 'none' ? null : value;
            void patch({ due }, { due });
          }}
          onClose={() => setField(null)}
        >
          <label className="m-date">
            <span>Jiné datum</span>
            <input
              type="date"
              value={task.due?.slice(0, 10) || ''}
              onChange={(event) => {
                if (!event.target.value) return;
                void patch({ due: event.target.value }, { due: event.target.value });
              }}
            />
          </label>
        </Picker>
      ) : null}
      {field === 'priority' ? (
        <Picker
          title="Priorita"
          value={String(task.priority)}
          options={PRIORITIES}
          onPick={(value) => void patch({ priority: Number(value) }, { priority: Number(value) as Task['priority'] })}
          onClose={() => setField(null)}
        />
      ) : null}
      {field === 'owner' ? (
        <Picker
          title="Kdo to má na starost"
          value={task.owner}
          options={data.people.map((p) => ({ value: p.key, label: p.displayName }))}
          onPick={(value) => void patch({ owner: value }, { owner: value })}
          onClose={() => setField(null)}
        />
      ) : null}
      {field === 'client' ? (
        <Picker
          title="Klient"
          value={task.client?.slug || 'none'}
          options={[{ value: 'none', label: 'Žádný' }, ...data.clients.map((c) => ({ value: c.slug, label: c.name }))]}
          onPick={(value) => {
            const client = value === 'none' ? null : data.clients.find((c) => c.slug === value) || null;
            void patch({ client: client?.slug ?? null }, { client });
          }}
          onClose={() => setField(null)}
        />
      ) : null}
    </>
  );
}

export function TaskDetail({ id }: { id: string }) {
  const { data, error } = useResource<TasksResponse>(TASKS_KEY, TASKS_PATH);

  // Návrh jde otevřít přímo z notifikace, i když ještě není v seznamu úkolů.
  const proposal = /^navrh:(\d+)$/.exec(id);
  if (proposal) return <ProposalView proposalId={Number(proposal[1])} />;

  const task = data?.tasks.find((t) => t.id === id);
  if (task && data) return <TaskView task={task} data={data} />;
  return (
    <>
      <PushedBar title="Úkol" />
      <div className="m-scroll m-detail">
        {data ? <Empty title="Úkol už tu není" /> : null}
        {!data && error ? <Empty title="Úkol se nenačetl">{error}</Empty> : null}
      </div>
    </>
  );
}
