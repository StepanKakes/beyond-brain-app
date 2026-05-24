import { useEffect, useState } from 'react';
import { authenticatedFetch } from '../../utils/api';

export type BeyondClient = {
  slug: string;
  name: string;
  initials: string;
  week: string | null;
  status: string | null;
  openPromises: number;
  weeklyGoal: string | null;
  notion: string | null;
  rawUpdatedAt?: number;
};

export type BeyondClientsState = {
  clients: BeyondClient[];
  exists: boolean;
  brainPath: string | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
};

/**
 * Fetches Tim's 6 active clients from ~/Documents/GitHub/beyond-brain/clients/aktivni/
 * via /api/beyond/clients. Polls every 60s for fresh promise counts.
 */
export function useBeyondClients(pollMs = 60_000): BeyondClientsState {
  const [clients, setClients] = useState<BeyondClient[]>([]);
  const [exists, setExists] = useState(true);
  const [brainPath, setBrainPath] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    authenticatedFetch('/api/beyond/clients')
      .then((r: Response) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data: { clients: BeyondClient[]; exists: boolean; brainPath: string }) => {
        if (cancelled) return;
        setClients(data.clients || []);
        setExists(Boolean(data.exists));
        setBrainPath(data.brainPath || null);
        setError(null);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setError(err.message);
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [tick]);

  useEffect(() => {
    if (!pollMs) return;
    const id = window.setInterval(() => setTick((n) => n + 1), pollMs);
    return () => window.clearInterval(id);
  }, [pollMs]);

  return {
    clients,
    exists,
    brainPath,
    loading,
    error,
    refresh: () => setTick((n) => n + 1),
  };
}
