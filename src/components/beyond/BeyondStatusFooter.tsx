import { Settings } from 'lucide-react';
import { useEffect, useState } from 'react';
import { authenticatedFetch } from '../../utils/api';

type StatusItem = { ok: boolean | null; label: string; hoursOld?: number };
type StatusResponse = { n8n: StatusItem; git: StatusItem; raw: StatusItem };

const POLL_MS = 90_000;

type Props = {
  onShowSettings?: () => void;
};

/**
 * Footer with 3 system status dots (n8n / git / raw stáří) and a settings icon.
 * Data pulled from /api/beyond/status.
 */
export default function BeyondStatusFooter({ onShowSettings }: Props) {
  const [status, setStatus] = useState<StatusResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    const fetchStatus = () =>
      authenticatedFetch('/api/beyond/status')
        .then((r: Response) => (r.ok ? r.json() : null))
        .then((data: StatusResponse | null) => {
          if (cancelled || !data) return;
          setStatus(data);
        })
        .catch(() => {
          /* swallow — keep last value */
        });

    fetchStatus();
    const id = window.setInterval(fetchStatus, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  return (
    <div className="flex items-center justify-between border-t border-white/30 px-3 py-2.5 dark:border-white/5">
      <div className="flex items-center gap-1.5">
        <Dot s={status?.n8n} fallbackTitle="n8n" />
        <Dot s={status?.git} fallbackTitle="git" />
        <Dot s={status?.raw} fallbackTitle="raw" />
      </div>
      <button
        type="button"
        onClick={onShowSettings}
        className="flex h-7 w-7 items-center justify-center rounded-full text-beyond-secondary hover:bg-white/60 hover:text-beyond-primary dark:hover:bg-white/10"
        aria-label="Nastavení"
      >
        <Settings className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function Dot({ s, fallbackTitle }: { s?: StatusItem; fallbackTitle: string }) {
  const color =
    s?.ok === true ? 'bg-green-500' :
    s?.ok === false ? 'bg-red-500' :
    s?.ok === null ? 'bg-amber-400' : 'bg-beyond-muted/40';
  const title = s?.label || `${fallbackTitle}: …`;
  return (
    <span
      title={title}
      className={`inline-block h-2 w-2 rounded-full ${color} ring-1 ring-white/40 dark:ring-white/10`}
    />
  );
}
