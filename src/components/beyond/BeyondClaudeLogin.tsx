import { useCallback, useEffect, useRef, useState } from 'react';

import { authenticatedFetch } from '../../utils/api';
import { Spinner } from './ui';

/**
 * Renewing the Claude login of the machine the brain runs on. The server runs
 * `claude /login` and hands over the address; the person opens it in their own
 * browser, signs in, and pastes the code that page shows. A pasted code is sent
 * on its own, there is nothing to confirm.
 */

type Status = { state: 'idle' | 'starting' | 'url' | 'done' | 'failed'; url?: string | null; tail?: string };

const post = (path: string, body?: unknown) =>
  authenticatedFetch(`/api/beyond/claude-login/${path}`, { method: 'POST', body: body ? JSON.stringify(body) : undefined });

export default function BeyondClaudeLogin({ onClose }: { onClose: () => void }) {
  const [status, setStatus] = useState<Status>({ state: 'starting' });
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [slow, setSlow] = useState(false);
  const alive = useRef(true);

  useEffect(() => {
    const t = window.setTimeout(() => setSlow(true), 7000);
    return () => window.clearTimeout(t);
  }, []);

  const start = useCallback(async () => {
    setStatus({ state: 'starting' });
    setSent(false);
    setCode('');
    setErr(null);
    try {
      const r = await post('start');
      if (!r.ok) throw new Error((await r.json().catch(() => null))?.error || `HTTP ${r.status}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Nepovedlo se spustit přihlášení');
      setStatus({ state: 'failed' });
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    void start();
    return () => { alive.current = false; void post('cancel').catch(() => {}); };
  }, [start]);

  useEffect(() => {
    if (status.state === 'done' || status.state === 'failed') return;
    const t = window.setInterval(async () => {
      try {
        const r = await authenticatedFetch('/api/beyond/claude-login/status');
        const s = (await r.json()) as Status;
        if (alive.current && s.state !== 'idle') setStatus(s);
      } catch { /* the next tick tries again */ }
    }, 1000);
    return () => window.clearInterval(t);
  }, [status.state]);

  const send = async (value: string) => {
    const v = value.trim();
    if (!v || sent) return;
    setSent(true);
    setErr(null);
    try {
      const r = await post('code', { code: v });
      if (!r.ok) throw new Error((await r.json().catch(() => null))?.error || `HTTP ${r.status}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Kód se nepodařilo odeslat');
      setSent(false);
    }
  };

  return (
    <div className="bb-dialog__scrim" onClick={onClose} role="presentation">
      <div className="bb-dialog" role="dialog" aria-modal="true" aria-labelledby="bb-login-title" onClick={(e) => e.stopPropagation()}>
        <div className="bb-dialog__head" id="bb-login-title">Přihlášení Claude</div>
        <div className="bb-dialog__body">
          {status.state === 'starting' && (
            <>
              <p className="bb-fx__empty" style={{ padding: 0 }}><Spinner size={16} /> Připravuju přihlášení</p>
              {slow && status.tail && <pre className="bb-fx__pre">{status.tail}</pre>}
            </>
          )}

          {status.state === 'url' && (
            <>
              <p style={{ margin: 0, fontSize: 14, color: 'var(--bb-ink2)' }}>
                Otevři přihlášení, přihlas se a zkopíruj kód, který ti stránka ukáže. Vlož ho sem, odešle se sám.
              </p>
              <div className="bb-set__acts" style={{ marginTop: 0 }}>
                <a className="bb-pill bb-pill--primary" href={status.url || '#'} target="_blank" rel="noopener noreferrer">Otevřít přihlášení</a>
              </div>
              <input
                className="bb-set__in"
                value={code}
                disabled={sent}
                onChange={(e) => setCode(e.target.value)}
                onPaste={(e) => {
                  const text = e.clipboardData.getData('text');
                  if (text.trim()) { e.preventDefault(); setCode(text.trim()); void send(text); }
                }}
                onKeyDown={(e) => { if (e.key === 'Enter') void send(code); }}
                placeholder="Sem vlož kód"
                aria-label="Kód z přihlášení"
                autoFocus
              />
              {sent && <p className="bb-fx__empty" style={{ padding: 0 }}><Spinner size={16} /> Ověřuju kód</p>}
            </>
          )}

          {status.state === 'done' && (
            <p style={{ margin: 0, fontSize: 14, color: 'var(--bb-ink)' }}>Přihlášeno. Můžeš poslat zprávu znovu.</p>
          )}

          {status.state === 'failed' && (
            <>
              <p className="bb-fx__err" style={{ margin: 0 }}>Přihlášení se nepovedlo.</p>
              {status.tail && <pre className="bb-fx__pre">{status.tail}</pre>}
            </>
          )}

          {err && <p className="bb-fx__err" style={{ margin: 0 }}>{err}</p>}

          <div className="bb-set__acts">
            {status.state === 'failed' && <button type="button" className="bb-pill bb-pill--primary" onClick={() => void start()}>Zkusit znovu</button>}
            <button type="button" className="bb-pill" onClick={onClose}>{status.state === 'done' ? 'Zavřít' : 'Zrušit'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
