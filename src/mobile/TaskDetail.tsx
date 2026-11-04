import { useState } from 'react';
import { Button, SegmentedControl } from 'glisse';

import { api } from './api';
import { back } from './router';
import { refresh, useResource } from './store';
import { TASKS_KEY, TASKS_PATH, setTaskState } from './Today';
import type { Proposal, ProposalsResponse, Task, TasksResponse } from './types';
import { Empty, HoldButton, Markdown, PushedBar, toast } from './ui';

const PROPOSALS_KEY = 'navrhy';
const PROPOSALS_PATH = '/api/beyond/velin/navrhy';

const STATUS_TEXT: Record<Proposal['status'], string> = {
  pending: 'Čeká na schválení',
  sent: 'Odesláno',
  rejected: 'Zahozeno',
  failed: 'Odeslání selhalo',
  expired: 'Propadlo',
};

function ProposalView({ proposalId }: { proposalId: number }) {
  const { data, error } = useResource<ProposalsResponse>(PROPOSALS_KEY, PROPOSALS_PATH);
  const proposal =
    data?.pending.find((p) => p.id === proposalId) ?? data?.recent.find((p) => p.id === proposalId) ?? null;
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const after = async () => {
    await Promise.all([refresh(PROPOSALS_KEY, PROPOSALS_PATH), refresh(TASKS_KEY, TASKS_PATH)]);
  };

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
      await after();
      setDraft(null);
    } catch (e) {
      toast((e as Error).message);
    }
    setBusy(false);
  };

  const send = async () => {
    setBusy(true);
    try {
      // Selhání odeslání chodí záměrně jako HTTP 200 s ok:false.
      const result = await api<{ ok: boolean; error?: string }>(
        `${PROPOSALS_PATH}/${proposal.id}/odeslat`,
        { method: 'POST' },
      );
      if (!result.ok) throw new Error(result.error || 'Odeslání selhalo');
      await after();
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
      await after();
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
        {proposal.reason ? <p className="m-detail-note">{proposal.reason}</p> : null}
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
              <Button destructive onClick={() => void discard()} disabled={busy}>
                Zahodit
              </Button>
              <Button onClick={() => setDraft(proposal.body)} disabled={busy}>
                Upravit
              </Button>
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

function TaskView({ task }: { task: Task }) {
  return (
    <>
      <PushedBar title={task.client?.name || 'Úkol'} />
      <div className="m-scroll m-detail">
        <h2 className="m-detail-title">{task.text}</h2>
        {task.dueLabel ? (
          <p className={`m-detail-note${task.dueKind === 'over' ? ' is-error' : ''}`}>{task.dueLabel}</p>
        ) : null}
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
        {task.note ? <Markdown text={task.note} /> : null}
        {task.prep?.body ? (
          <>
            <p className="m-detail-label">{task.prep.title}</p>
            <Markdown text={task.prep.body} />
          </>
        ) : null}
      </div>
    </>
  );
}

export function TaskDetail({ id }: { id: string }) {
  const { data, error } = useResource<TasksResponse>(TASKS_KEY, TASKS_PATH);

  // Návrh jde otevřít přímo z notifikace, i když ještě není v seznamu úkolů.
  const proposal = /^navrh:(\d+)$/.exec(id);
  if (proposal) return <ProposalView proposalId={Number(proposal[1])} />;

  const task = data?.tasks.find((t) => t.id === id);
  if (task) return <TaskView task={task} />;
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
