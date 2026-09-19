/**
 * Beyond Brain — Anthropic model list for the chat picker.
 *
 * Pulls the models the installed Claude Code actually offers from
 * `/api/beyond/models` (backed by the SDK's `supportedModels()`), so the picker
 * shows real version-bearing names ("Opus 4.7", "Sonnet 4.6", "Haiku 4.5")
 * instead of bare aliases. Falls back to the static `CLAUDE_MODELS.OPTIONS`
 * when the endpoint is unavailable (offline, older server, fetch failed).
 */

import { authenticatedFetch } from '../../utils/api';
import { CLAUDE_MODELS } from '../../../shared/modelConstants';

export type BeyondModelOption = {
  value: string;
  displayName: string;
  description: string;
  /** Concise version-bearing label for the chip, e.g. "Opus 4.7". */
  short: string;
};

/** Extract a tight "Name 4.7" label from a model's description/displayName. */
export function shortModelLabel(m: { displayName: string; description?: string }): string {
  const desc = m.description || '';
  // Descriptions look like "Opus 4.7 with 1M context · Most capable …" or
  // "Sonnet 4.6 · Best for everyday tasks" — grab the leading "Name <version>".
  const match = desc.match(/^([A-Za-z][A-Za-z ]*?\s[\d][\d.]*)/);
  if (match) return match[1].trim();
  return m.displayName;
}

/** Static fallback derived from the shared model constants (no version info). */
export function fallbackModelOptions(): BeyondModelOption[] {
  return CLAUDE_MODELS.OPTIONS.map((o) => ({
    value: o.value,
    displayName: o.label,
    description: '',
    short: o.label,
  }));
}

/** Fetch the live model list. Returns [] on any failure so callers can fall back. */
export async function fetchBeyondModels(): Promise<BeyondModelOption[]> {
  try {
    const res = await authenticatedFetch('/api/beyond/models');
    if (!res.ok) return [];
    const data = (await res.json()) as { models?: Array<{ value: string; displayName?: string; description?: string }> };
    const models = Array.isArray(data.models) ? data.models : [];
    return models
      .filter((m) => m && typeof m.value === 'string')
      .map((m) => {
        const displayName = m.displayName || m.value;
        const description = m.description || '';
        return { value: m.value, displayName, description, short: shortModelLabel({ displayName, description }) };
      });
  } catch {
    return [];
  }
}
