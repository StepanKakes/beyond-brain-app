import { useCallback, useState } from 'react';
import { Check, Pencil, X } from '../icons';

import { authenticatedFetch } from '../../../utils/api';
import { Empty, SectionHead, ago, usePolled } from './bits';

/**
 * Beyond Brain — messages written and waiting for one click.
 *
 * The whole text is on screen, never a summary of it, because the click means
 * "send this" and you cannot mean that about something you have not read. Edit
 * is inline and the edited text is what goes out; nothing re-renders it between
 * the button and the wire.
 */

type Proposal = {
  id: number;
  kind: string;
  clientSlug: string | null;
  clientName: string | null;
  channel: string;
  target: string | null;
  title: string;
  body: string;
  edited: boolean;
  reason: string | null;
  status: 'pending' | 'sent' | 'rejected' | 'failed' | 'expired';
  createdAt: string;
  sentAt: string | null;
  error: string | null;
};

type Data = { canSend: boolean; pending: Proposal[]; recent: Proposal[] };

const STATUS_LABEL: Record<Proposal['status'], string> = {
  pending: 'čeká',
  sent: 'odesláno',
  rejected: 'zahozeno',
  failed: 'selhalo',
  expired: 'propadlo',
};

export default function Proposals({ compact = false }: { compact?: boolean }) {
  const load = useCallback(async () => {
    const res = await authenticatedFetch('/api/beyond/velin/navrhy');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as Data;
  }, []);
  const { data, error, loading, reload } = usePolled<Data>(load, 60_000);
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState<number | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const act = async (id: number, path: string, body?: unknown, method = 'POST') => {
    setBusy(id);
    setFailure(null);
    try {
      const res = await authenticatedFetch(`/api/beyond/velin/navrhy/${id}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
      const payload = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(payload?.error || `HTTP ${res.status}`);
      await reload();
    } catch (err) {
      setFailure(err instanceof Error ? err.message : 'nepovedlo se');
    } finally {
      setBusy(null);
    }
  };

  if (loading && !data) return null;
  if (error && !data) return <Empty>Návrhy se nenačetly: {error}</Empty>;
  if (!data) return null;

  const { pending, recent, canSend } = data;

  if (compact && pending.length === 0) return null;

  return (
    <section>
      <SectionHead title="Připraveno k odeslání" count={pending.length} />

      {!canSend && pending.length > 0 && (
        <Empty>
          WhatsApp není napojený, takže odeslat to zatím nejde. Doplň serveru{' '}
          <code>BEYOND_WAHA_API_KEY</code>. Text si můžeš přečíst a zkopírovat.
        </Empty>
      )}

      {pending.length === 0 ? (
        <Empty>Nic k odklepnutí. Když nikomu není co psát, agent nic nevymýšlí.</Empty>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {pending.map((p) => {
            const isEditing = editing === p.id;
            return (
              <article
                key={p.id}
                className="bb-card"
                style={{ borderRadius: 'var(--bb-rc)', overflow: 'hidden' }}
              >
                <div style={{ padding: '13px 15px 0' }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
                    <strong style={{ fontSize: 14 }}>{p.clientName}</strong>
                    <span style={{ fontSize: 12.5, color: 'var(--bb-ink2)' }}>{p.title}</span>
                    <span style={{ fontSize: 11.5, color: 'var(--bb-ink3)', marginLeft: 'auto' }}>
                      {ago(p.createdAt)}
                      {p.edited && ' · upraveno'}
                    </span>
                  </div>
                  {p.reason && (
                    <p style={{ fontSize: 12.5, color: 'var(--bb-ink3)', margin: '4px 0 0', lineHeight: 1.5 }}>
                      {p.reason}
                    </p>
                  )}
                </div>

                <div style={{ padding: '11px 15px' }}>
                  {isEditing ? (
                    <textarea
                      className="bb-field"
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      rows={Math.max(4, draft.split('\n').length + 1)}
                      style={{ width: '100%', borderRadius: 'var(--bb-rs)', padding: '10px 12px', fontSize: 14, lineHeight: 1.55, resize: 'vertical' }}
                      autoFocus
                    />
                  ) : (
                    <p style={{ whiteSpace: 'pre-line', fontSize: 14, lineHeight: 1.6, margin: 0 }}>
                      {p.body}
                    </p>
                  )}
                </div>

                <div
                  className="bb-card__foot"
                  style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 15px', flexWrap: 'wrap' }}
                >
                  <span style={{ fontSize: 11.5, color: 'var(--bb-ink3)', marginRight: 'auto' }}>
                    WhatsApp · {p.target || 'bez cíle'}
                  </span>

                  {isEditing ? (
                    <>
                      <button
                        type="button"
                        className="bb-btn-soft"
                        style={{ padding: '6px 12px', borderRadius: 999, fontSize: 12.5 }}
                        onClick={() => setEditing(null)}
                      >
                        Zrušit
                      </button>
                      <button
                        type="button"
                        className="bb-btn-primary"
                        style={{ padding: '6px 14px', borderRadius: 999, fontSize: 12.5, fontWeight: 500 }}
                        disabled={busy === p.id || !draft.trim()}
                        onClick={async () => {
                          await act(p.id, '', { body: draft }, 'PATCH');
                          setEditing(null);
                        }}
                      >
                        Uložit text
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="bb-btn-ghost"
                        style={{ padding: '6px 10px', borderRadius: 999, fontSize: 12.5, display: 'inline-flex', alignItems: 'center', gap: 5 }}
                        onClick={() => void act(p.id, '/zahodit')}
                        disabled={busy === p.id}
                      >
                        <X size={13} strokeWidth={2} /> Zahodit
                      </button>
                      <button
                        type="button"
                        className="bb-btn-soft"
                        style={{ padding: '6px 12px', borderRadius: 999, fontSize: 12.5, display: 'inline-flex', alignItems: 'center', gap: 5 }}
                        onClick={() => {
                          setDraft(p.body);
                          setEditing(p.id);
                        }}
                      >
                        <Pencil size={13} strokeWidth={1.9} /> Upravit
                      </button>
                      <button
                        type="button"
                        className="bb-btn-primary"
                        style={{ padding: '6px 15px', borderRadius: 999, fontSize: 12.5, fontWeight: 500, display: 'inline-flex', alignItems: 'center', gap: 5 }}
                        disabled={busy === p.id || !canSend || !p.target}
                        onClick={() => void act(p.id, '/odeslat')}
                      >
                        <Check size={13} strokeWidth={2.2} />
                        {busy === p.id ? 'Odesílám…' : 'Odeslat'}
                      </button>
                    </>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}

      {failure && (
        <p style={{ fontSize: 12.5, color: 'var(--bb-danger)', marginTop: 8 }}>{failure}</p>
      )}

      {!compact && recent.length > 0 && (
        <div style={{ marginTop: 22 }}>
          <SectionHead title="Nedávno" count={recent.length} />
          <div className="bb-prom">
            {recent.map((p) => (
              <div key={p.id} className="bb-prom__i">
                <span className="bb-prom__age" data-late={p.status === 'failed' ? 'true' : undefined}>
                  {STATUS_LABEL[p.status]}
                </span>
                <span style={{ color: 'var(--bb-ink2)' }}>
                  {p.clientName} · {p.title}
                  {p.error && <span style={{ color: 'var(--bb-danger)' }}> · {p.error}</span>}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
