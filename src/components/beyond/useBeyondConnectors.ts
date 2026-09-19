/**
 * Beyond Brain — connectors data hook.
 *
 * Owns the connector list + preset gallery and exposes the mutating actions the
 * Konektory panel needs. Every mutation re-fetches the list so the UI reflects
 * server truth (status transitions after OAuth, probes, etc.).
 */
import { useCallback, useEffect, useState } from 'react';
import {
  addConnector,
  connectOAuth,
  deleteConnector,
  fetchConnectors,
  fetchPresets,
  patchConnector,
  testConnector,
  type AddConnectorInput,
  type Connector,
  type Preset,
} from './beyondConnectorsApi';

export function useBeyondConnectors(enabled: boolean) {
  const [connectors, setConnectors] = useState<Connector[]>([]);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await fetchConnectors();
      setConnectors(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Načtení konektorů selhalo.');
    } finally {
      setLoading(false);
    }
  }, []);

  // Load once when the panel opens.
  useEffect(() => {
    if (!enabled) return;
    void refresh();
    void fetchPresets()
      .then(setPresets)
      .catch(() => setPresets([]));
  }, [enabled, refresh]);

  const create = useCallback(
    async (input: AddConnectorInput): Promise<Connector> => {
      const created = await addConnector(input);
      await refresh();
      return created;
    },
    [refresh],
  );

  const update = useCallback(
    async (id: string, patch: Partial<AddConnectorInput> & { enabled?: boolean }) => {
      await patchConnector(id, patch);
      await refresh();
    },
    [refresh],
  );

  const remove = useCallback(
    async (id: string) => {
      await deleteConnector(id);
      await refresh();
    },
    [refresh],
  );

  const test = useCallback(
    async (id: string) => {
      const result = await testConnector(id);
      await refresh();
      return result;
    },
    [refresh],
  );

  const connect = useCallback(
    async (id: string) => {
      const result = await connectOAuth(id);
      await refresh();
      return result;
    },
    [refresh],
  );

  return {
    connectors,
    presets,
    loading,
    error,
    refresh,
    create,
    update,
    remove,
    test,
    connect,
  };
}
