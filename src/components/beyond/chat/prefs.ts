/**
 * Beyond Brain chat — locally persisted chat preferences.
 *
 * One shared login, so these are per-device rather than per-user: which tools
 * the agent may run unprompted, whether permission prompts are bypassed
 * entirely, and the selected model. All reads are defensive — a browser with
 * storage disabled degrades to defaults instead of failing to render the chat.
 */

export const ALLOWED_TOOLS_STORAGE_KEY = 'beyond.allowed-tools';
export const BYPASS_PERMISSIONS_STORAGE_KEY = 'beyond.bypass-permissions';
export const MODEL_STORAGE_KEY = 'beyond.model';

/** Reads persisted allow rules: exact tool names + `mcp__server__*` prefixes. */
export function readAllowedTools(): string[] {
  try {
    const raw = localStorage.getItem(ALLOWED_TOOLS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((v) => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

export function persistAllowedTools(entries: string[]): void {
  try {
    localStorage.setItem(ALLOWED_TOOLS_STORAGE_KEY, JSON.stringify(entries));
  } catch {
    /* ignore */
  }
}

/** Match an allow entry against an actual tool name. Supports exact match
 *  and trailing-`*` wildcards (e.g. `mcp__waha__*`). */
export function matchAllowEntry(entry: string, toolName: string): boolean {
  if (entry === toolName) return true;
  if (entry.endsWith('*')) return toolName.startsWith(entry.slice(0, -1));
  return false;
}
