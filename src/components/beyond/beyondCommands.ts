/**
 * Beyond Brain — slash commands.
 *
 * Two kinds reach the chat:
 *  - APP commands (`kind: 'app'`) are CLI-only in Claude Code (`/mcp`, `/model`,
 *    `/config`, …) and have no Agent-SDK equivalent, so Beyond maps them to its
 *    own UI (Konektory panel, Settings, model picker, new chat, token chip).
 *  - Everything else — custom `.claude/commands/*.md`, plugin skills, and the
 *    SDK-honoured built-ins `/compact` and `/clear` — is passed straight to the
 *    Agent SDK as the prompt, which expands/executes it (settingSources already
 *    include project+user, so custom commands load).
 *
 * The composer shows an autocomplete of APP commands merged with the project's
 * real custom commands + skills (fetched in useBeyondSlashCommands).
 */

export type BeyondCommandKind = 'app' | 'custom' | 'skill';
export type BeyondAppAction =
  | 'mcp'
  | 'model'
  | 'settings'
  | 'new'
  | 'sessions'
  | 'compact'
  | 'cost'
  | 'help';

export interface BeyondSlashCommand {
  name: string; // includes leading slash, lowercase, e.g. '/mcp'
  description: string;
  kind: BeyondCommandKind;
  action?: BeyondAppAction; // set when kind === 'app'
  aliases?: string[];
}

export const BEYOND_APP_COMMANDS: BeyondSlashCommand[] = [
  { name: '/mcp', description: 'Konektory (MCP) — přidat, přihlásit, spravovat', kind: 'app', action: 'mcp', aliases: ['/konektory'] },
  { name: '/model', description: 'Změnit AI model', kind: 'app', action: 'model' },
  { name: '/settings', description: 'Nastavení aplikace', kind: 'app', action: 'settings', aliases: ['/nastaveni', '/config'] },
  { name: '/new', description: 'Nový chat', kind: 'app', action: 'new', aliases: ['/novy'] },
  { name: '/clear', description: 'Nový chat (vyčistit kontext)', kind: 'app', action: 'new' },
  { name: '/sessions', description: 'Historie konverzací', kind: 'app', action: 'sessions', aliases: ['/historie', '/resume'] },
  { name: '/compact', description: 'Komprimovat kontext (uvolnit tokeny)', kind: 'app', action: 'compact' },
  { name: '/cost', description: 'Využití tokenů v této session', kind: 'app', action: 'cost', aliases: ['/naklady'] },
  { name: '/help', description: 'Nápověda — seznam příkazů', kind: 'app', action: 'help', aliases: ['/napoveda'] },
];

/** Split "/name rest of args" → { name, args }. Null if not a slash command. */
export function parseSlash(text: string): { name: string; args: string } | null {
  const t = text.trimStart();
  if (!t.startsWith('/')) return null;
  const m = t.match(/^(\/[^\s]+)\s*([\s\S]*)$/);
  if (!m) return null;
  return { name: m[1].toLowerCase(), args: (m[2] ?? '').trim() };
}

/** Resolve a typed command name (or alias) to an app command, else null. */
export function findAppCommand(name: string): BeyondSlashCommand | null {
  const n = name.toLowerCase();
  return (
    BEYOND_APP_COMMANDS.find((c) => c.name === n || c.aliases?.includes(n)) || null
  );
}

const KIND_LABEL: Record<BeyondCommandKind, string> = {
  app: 'aplikace',
  custom: 'příkaz',
  skill: 'skill',
};

export function commandKindLabel(kind: BeyondCommandKind): string {
  return KIND_LABEL[kind] ?? kind;
}
