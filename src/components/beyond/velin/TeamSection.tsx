import { useEffect, useState } from 'react';
import { UserPlus } from 'lucide-react';

import { authenticatedFetch } from '../../../utils/api';

/**
 * Beyond Brain — the team, in Settings.
 *
 * Two people run the client side and the velín attributes promises and calls to
 * them, so each needs their own login rather than a shared one: a shared
 * account cannot answer "whose task is this" or "whose call is running".
 *
 * Accounts are created from inside a session on purpose. The unauthenticated
 * `/register` stays the one-time first-run setup, so opening the app to a
 * second person never opens registration to anyone who can reach the port.
 *
 * The form lives behind a button rather than sitting open: adding a teammate is
 * a rare act and a permanently visible password field is noise.
 */

type TeamMember = {
  id: number;
  username: string;
  lastLogin: string | null;
  person: { key: string; displayName: string } | null;
  isMe: boolean;
};

export default function TeamSection() {
  const [members, setMembers] = useState<TeamMember[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const res = await authenticatedFetch('/api/auth/users');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { users: TeamMember[] };
      setMembers(body.users);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nepovedlo se načíst tým');
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await authenticatedFetch('/api/auth/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
      setUsername('');
      setPassword('');
      setAdding(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nepovedlo se přidat');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      {members && members.length > 0 && (
        <div className="bb-prom" style={{ marginBottom: 12 }}>
          {members.map((m) => (
            <div key={m.id} className="bb-prom__i">
              <span className="bb-prom__age">{m.person?.displayName || '—'}</span>
              <span>
                {m.username}
                {m.isMe && <span style={{ color: 'var(--bb-ink3)' }}> · ty</span>}
                {!m.person && (
                  <span style={{ color: 'var(--bb-ink3)' }}>
                    {' '}· bez napojení na jméno v brainu
                  </span>
                )}
              </span>
            </div>
          ))}
        </div>
      )}

      {!adding ? (
        <button type="button" className="bb-pill" onClick={() => setAdding(true)}>
          <UserPlus size={14} strokeWidth={1.8} /> Přidat člověka
        </button>
      ) : (
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <label style={{ fontSize: 12, color: 'var(--bb-ink3)' }}>
            Přihlašovací jméno
            <input
              className="bb-field"
              style={{ width: '100%', marginTop: 4, padding: '9px 11px', borderRadius: 'var(--bb-rs)' }}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="off"
              autoFocus
            />
          </label>
          <label style={{ fontSize: 12, color: 'var(--bb-ink3)' }}>
            Heslo
            <input
              className="bb-field"
              style={{ width: '100%', marginTop: 4, padding: '9px 11px', borderRadius: 'var(--bb-rs)' }}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
            />
          </label>
          <p style={{ fontSize: 12, color: 'var(--bb-ink3)', margin: 0, lineHeight: 1.5 }}>
            Jméno <code>tim</code> nebo <code>stepan</code> se samo napojí na jméno, kterým brain
            podepisuje sliby a Cal.com hovory.
          </p>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              type="submit"
              className="bb-btn-primary"
              style={{ padding: '7px 14px', borderRadius: 999, fontSize: 12.5, fontWeight: 500 }}
              disabled={busy || username.trim().length < 3 || password.length < 6}
            >
              {busy ? 'Zakládám…' : 'Založit'}
            </button>
            <button
              type="button"
              className="bb-btn-ghost"
              style={{ padding: '7px 12px', borderRadius: 999, fontSize: 12.5 }}
              onClick={() => {
                setAdding(false);
                setError(null);
              }}
            >
              Zrušit
            </button>
          </div>
        </form>
      )}

      {error && (
        <p style={{ fontSize: 12.5, color: 'var(--bb-danger)', marginTop: 8, marginBottom: 0 }}>{error}</p>
      )}
    </div>
  );
}
