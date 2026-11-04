import type { Dispatch, SetStateAction } from 'react';

import type { ChatMessage, ToolStep } from './types';

/**
 * Beyond Brain chat — pure transcript transforms.
 *
 * Everything here maps the variable-shape payloads the backend streams onto the
 * local `ChatMessage[]`. No React, no DOM: these are the pieces worth reading
 * on their own when the transcript renders something unexpected.
 */

export function uid(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export function appendAssistantTextById(
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>,
  id: string,
  text: string,
): void {
  setMessages((prev) => {
    const last = prev[prev.length - 1];
    // Append into the streaming bubble (matched by its stable id) so the caller
    // can key the word-by-word cross-blur render off that same id. A tool-step
    // block resets the id upstream, so a fresh bubble appears below the steps.
    if (last && last.id === id && last.role === 'assistant' && last.kind === 'text') {
      return [...prev.slice(0, -1), { ...last, text: last.text + text }];
    }
    return [...prev, { id, role: 'assistant', kind: 'text', text }];
  });
}

/** Turn a sequence of stored NormalizedMessages into our local ChatMessage[]. */
export function rebuildHistory(raw: unknown[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const m = entry as Record<string, unknown>;
    const kind = String(m.kind ?? '');
    const role = (m.role as string | undefined) || undefined;
    const content = (m.content as string | undefined) || '';

    if (kind === 'text' && role === 'user' && content) {
      out.push({ id: `h${out.length}`, role: 'user', kind: 'text', text: content });
    } else if (kind === 'text' && role === 'assistant' && content) {
      out.push({ id: `h${out.length}`, role: 'assistant', kind: 'text', text: content });
    } else if (kind === 'task_notification') {
      const step = taskStep(m);
      const last = out[out.length - 1];
      if (last && last.role === 'assistant' && last.kind === 'steps') {
        out[out.length - 1] = { ...last, steps: [...last.steps, step] };
      } else {
        out.push({ id: `h${out.length}`, role: 'assistant', kind: 'steps', steps: [step] });
      }
    } else if (kind === 'tool_use' && m.toolName) {
      const toolResult = m.toolResult as
        | { content?: string; isError?: boolean }
        | undefined;
      const step: ToolStep = {
        id: `t${String(m.toolId ?? uid())}`,
        toolId: String(m.toolId ?? uid()),
        name: String(m.toolName),
        input: m.toolInput,
        output: toolResult?.content,
        isError: toolResult?.isError,
        status: toolResult ? (toolResult.isError ? 'error' : 'done') : 'done',
      };
      const last = out[out.length - 1];
      if (last && last.role === 'assistant' && last.kind === 'steps') {
        out[out.length - 1] = { ...last, steps: [...last.steps, step] };
      } else {
        out.push({ id: `h${out.length}`, role: 'assistant', kind: 'steps', steps: [step] });
      }
    }
  }
  return out;
}

/** What the status line says while a tool runs, in words, not tool names. */
export function statusLabel(tool: string): string {
  if (tool === 'Read') return 'Čtu podklady';
  if (tool === 'Grep' || tool === 'Glob') return 'Hledám v brainu';
  if (tool === 'Write' || tool === 'Edit' || tool === 'MultiEdit') return 'Zapisuju';
  if (tool === 'WebSearch') return 'Hledám na webu';
  if (tool === 'WebFetch') return 'Čtu stránku';
  if (tool === 'Task' || tool === 'Agent') return 'Zjišťuju podrobnosti';
  if (/whatsapp|waha/i.test(tool)) return 'Dívám se do WhatsAppu';
  if (/calendar|kalendar/i.test(tool)) return 'Dívám se do kalendáře';
  if (/notion/i.test(tool)) return 'Dívám se do Notionu';
  if (/fathom/i.test(tool)) return 'Procházím hovory';
  return 'Pracuju na tom';
}

function sameMessage(a: ChatMessage, b: ChatMessage): boolean {
  if (a.role !== b.role || a.kind !== b.kind) return false;
  if (a.kind === 'steps' && b.kind === 'steps') {
    return (
      a.steps.length === b.steps.length &&
      a.steps.every((s, i) => s.toolId === b.steps[i].toolId && s.status === b.steps[i].status && s.output === b.steps[i].output)
    );
  }
  return 'text' in a && 'text' in b && a.text.trim() === b.text.trim();
}

/**
 * Lay a transcript from disk over what is on screen without touching what did
 * not change: rows keep their keys, so nothing remounts or blinks, and an
 * identical transcript returns the same array and renders nothing. `liveId` is
 * the bubble still being written, which stays last until the disk has it.
 */
export function mergeHistory(prev: ChatMessage[], next: ChatMessage[], liveId: string | null = null): ChatMessage[] {
  const live = liveId ? prev.find((m) => m.id === liveId) : undefined;
  const shown = live ? prev.filter((m) => m !== live) : prev;

  // The disk lags behind the screen: never lose a prompt sent a moment ago.
  let lastUser = -1;
  for (let i = shown.length - 1; i >= 0; i -= 1) {
    if (shown[i].role === 'user') {
      lastUser = i;
      break;
    }
  }
  let tail: ChatMessage[] = [];
  let base = shown;
  if (lastUser >= 0) {
    const sent = shown[lastUser];
    const onDisk = next.some((m) => m.role === 'user' && m.kind === 'text' && 'text' in sent && m.text.trim() === sent.text.trim());
    if (!onDisk) {
      tail = shown.slice(lastUser);
      base = shown.slice(0, lastUser);
    }
  }

  // A cached transcript is the end of the chat, a stale one is its start.
  const shift = base.length && next.length && sameMessage(base[0], next[0]) ? 0 : base.length - next.length;
  const kept = new Set<string>();
  const merged = next.map((message, index) => {
    const old = base[index + shift];
    if (!old || old.role !== message.role || old.kind !== message.kind) return message;
    kept.add(old.id);
    return sameMessage(old, message) ? old : { ...message, id: old.id };
  });
  // A row on screen keeps its key, a new one must not collide with it.
  const unique = merged.map((message, index) => {
    const old = base[index + shift];
    return kept.has(message.id) && old?.id !== message.id ? { ...message, id: uid() } : message;
  });

  const result = [...unique, ...tail];
  if (live && 'text' in live) {
    const lastSaved = [...next].reverse().find((m) => m.role === 'assistant' && m.kind === 'text');
    const saved = lastSaved && 'text' in lastSaved && !tail.length && lastSaved.text.trim().startsWith(live.text.trim().slice(0, 200));
    if (!saved) result.push(live);
  }
  return result.length === prev.length && result.every((m, i) => m === prev[i]) ? prev : result;
}

/**
 * While a message is still arriving, its table is unfinished and Markdown would
 * show raw pipes. Hold such lines back until a row is whole.
 */
export function holdBackTable(text: string): string {
  const lines = text.split('\n');
  let start = lines.length;
  while (start > 0 && lines[start - 1].trimStart().startsWith('|')) start -= 1;
  const block = lines.slice(start);
  if (!block.length) return text;
  const separator = /^\s*\|?[\s:|-]+\|?\s*$/;
  if (block.length < 2 || !separator.test(block[1]) || !block[1].includes('-')) {
    return lines.slice(0, start).join('\n');
  }
  if (block[block.length - 1].trimEnd().endsWith('|')) return text;
  return lines.slice(0, block.length === 2 ? start : -1).join('\n');
}

/** A finished background subagent, shown as a step rather than a user bubble. */
export function taskStep(m: Record<string, unknown>): ToolStep {
  const status = String(m.status ?? '');
  const failed = status === 'failed' || status === 'error' || status === 'killed';
  return {
    id: uid(),
    toolId: uid(),
    name: 'SubagentDone',
    input: { summary: String(m.summary ?? '') },
    output: (m.content as string | undefined) || undefined,
    isError: failed,
    status: failed ? 'error' : 'done',
  };
}

export function appendStep(prev: ChatMessage[], step: ToolStep): ChatMessage[] {
  const last = prev[prev.length - 1];
  if (last && last.role === 'assistant' && last.kind === 'steps') {
    return [...prev.slice(0, -1), { ...last, steps: [...last.steps, step] }];
  }
  return [...prev, { id: uid(), role: 'assistant', kind: 'steps', steps: [step] }];
}

export function updateStep(
  prev: ChatMessage[],
  toolId: string,
  output: string,
  isError: boolean,
): ChatMessage[] {
  return prev.map((msg) => {
    if (msg.role !== 'assistant' || msg.kind !== 'steps') return msg;
    let touched = false;
    const nextSteps = msg.steps.map((s) => {
      if (s.toolId !== toolId) return s;
      touched = true;
      return { ...s, output, isError, status: isError ? ('error' as const) : ('done' as const) };
    });
    return touched ? { ...msg, steps: nextSteps } : msg;
  });
}
