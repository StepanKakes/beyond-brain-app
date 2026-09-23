import { useEffect, useState } from 'react';

import { authenticatedFetch } from '../../utils/api';

export type Counts = { velin: number; klienti: number; obsah: number; navrhy: number };

/**
 * The numbers the left panel puts next to its items. One cheap call, polled
 * slowly: it is a hint about where to look, not a live counter.
 */
export function useBeyondCounts(): Counts | null {
  const [counts, setCounts] = useState<Counts | null>(null);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await authenticatedFetch('/api/beyond/velin/pocty');
        if (!res.ok) return;
        const data = (await res.json()) as Counts;
        if (!cancelled) setCounts(data);
      } catch {
        /* the panel simply shows no numbers */
      }
    };
    void load();
    const id = window.setInterval(load, 120_000);
    const onChange = () => void load();
    window.addEventListener('beyond:brain-synced', onChange);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      window.removeEventListener('beyond:brain-synced', onChange);
    };
  }, []);
  return counts;
}
