import { useCallback, useEffect, useMemo } from 'react';

import { Planner, type PanelProps } from '../../../planner/Planner';
import type { Request } from '../../../planner/model';
import { authenticatedFetch } from '../../../utils/api';
import ObsahPage from './ObsahPage';
import { fetchObsah, type ObsahItem } from './api';
import { usePolled } from './bits';

/** Detail karty na webu: panel zprava, Esc nebo klik vedle ho zavře. */
function SidePanel({ title, onClose, children }: PanelProps) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="pl-panel-root">
      <div className="pl-panel-scrim" onClick={onClose} />
      <div className="pl-panel" role="dialog" aria-modal="true" aria-label={title}>
        <header className="pl-panel-head">
          <span>{title}</span>
          <button type="button" className="pl-icon" aria-label="Zavřít" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="pl-panel-body">{children}</div>
      </div>
    </div>
  );
}

const request: Request = async <T,>(path: string, options: { method?: string; body?: unknown } = {}) => {
  const res = await authenticatedFetch(path, {
    method: options.method || 'GET',
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || `Server odpověděl ${res.status}`);
  return data as T;
};

/** Obsah: náš plán publikací a vedle něj to, co navrhl brain. */
export default function PlannerPage({ onOpenStudio, onOpenClient }: { onOpenStudio: () => void; onOpenClient: (slug: string) => void }) {
  const load = useCallback(() => fetchObsah(), []);
  const obsah = usePolled<{ items: ObsahItem[] }>(load, 60_000);
  const count = useMemo(() => (obsah.data?.items || []).filter((i) => i.state === 'navrh').length, [obsah.data]);
  return (
    <div className="bb-vel">
      <div className="bb-vel__in pl-wide">
        <header className="bb-vel__head">
          <div>
            <h1 className="bb-vel__title">Obsah</h1>
            <p className="bb-vel__sub">Co točíme, co se stříhá a kdy to vychází</p>
          </div>
        </header>
        <Planner
          request={request}
          draggable
          Panel={SidePanel}
          proposalCount={count}
          proposals={<ObsahPage onOpenStudio={onOpenStudio} onOpenClient={onOpenClient} />}
        />
      </div>
    </div>
  );
}
