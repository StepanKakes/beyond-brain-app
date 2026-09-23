import {
  FileText,
  FilePen,
  Terminal,
  Search,
  Globe,
  MessageCircle,
  Wrench,
} from '../icons';

/**
 * Beyond Brain chat — how a tool call is named, iconed and previewed.
 *
 * Shared by the transcript's step rows and the permission panel, so the tool
 * the agent is about to run reads identically to the tool it already ran.
 */

export function describeTool(name: string, input: unknown): { label: string; detail: string } {
  const inp = (input && typeof input === 'object' ? (input as Record<string, unknown>) : {}) || {};
  const path = typeof inp.file_path === 'string' ? inp.file_path : typeof inp.path === 'string' ? inp.path : '';
  const command = typeof inp.command === 'string' ? inp.command : '';
  const pattern = typeof inp.pattern === 'string' ? inp.pattern : '';
  const url = typeof inp.url === 'string' ? inp.url : '';
  const query = typeof inp.query === 'string' ? inp.query : '';

  switch (name) {
    case 'Read':
      return { label: 'Read', detail: shortenPath(path) };
    case 'Write':
      return { label: 'Write', detail: shortenPath(path) };
    case 'Edit':
    case 'MultiEdit':
      return { label: 'Edit', detail: shortenPath(path) };
    case 'Bash':
      return { label: 'Bash', detail: command.split('\n')[0].slice(0, 80) };
    case 'Grep':
      return { label: 'Grep', detail: pattern };
    case 'Glob':
      return { label: 'Glob', detail: pattern };
    case 'WebFetch':
      return { label: 'WebFetch', detail: url };
    case 'WebSearch':
      return { label: 'WebSearch', detail: query };
    default:
      return { label: name, detail: '' };
  }
}

export function iconForTool(name: string) {
  if (name === 'Read') return FileText;
  if (name === 'Write' || name === 'Edit' || name === 'MultiEdit') return FilePen;
  if (name === 'Bash') return Terminal;
  if (name === 'Grep' || name === 'Glob') return Search;
  if (name === 'WebFetch' || name === 'WebSearch') return Globe;
  if (name === 'AskUserQuestion') return MessageCircle;
  return Wrench;
}

export function formatInput(input: unknown): string {
  if (typeof input === 'string') return input;
  try {
    return JSON.stringify(input, null, 2);
  } catch {
    return String(input);
  }
}

export function shortenPath(p?: string): string {
  if (!p) return '';
  const parts = p.split('/');
  return parts.slice(-2).join('/');
}

/** WAHA sends get their own preview-and-edit card instead of the generic
 *  permission prompt — an outbound WhatsApp message is worth reading first. */
export function isWhatsAppSendTool(name: string): boolean {
  return (
    name === 'mcp__waha__send-text' ||
    name === 'mcp__waha__send-image' ||
    name === 'mcp__waha__send-file'
  );
}
