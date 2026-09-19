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
      out.push({ id: uid(), role: 'user', kind: 'text', text: content });
    } else if (kind === 'text' && role === 'assistant' && content) {
      out.push({ id: uid(), role: 'assistant', kind: 'text', text: content });
    } else if (kind === 'tool_use' && m.toolName) {
      const toolResult = m.toolResult as
        | { content?: string; isError?: boolean }
        | undefined;
      const step: ToolStep = {
        id: uid(),
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
        out.push({ id: uid(), role: 'assistant', kind: 'steps', steps: [step] });
      }
    }
  }
  return out;
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
