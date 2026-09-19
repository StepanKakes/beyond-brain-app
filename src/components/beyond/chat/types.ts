/**
 * Beyond Brain chat — the shapes the transcript and its interactive panels
 * are built from. Kept separate from the components so the pure helpers in
 * `transcript.ts` can be read (and reasoned about) without pulling in React.
 */

export type Role = 'user' | 'assistant';

export type ToolStep = {
  id: string;
  /** Server-issued tool call id, used to match the eventual tool_result. */
  toolId: string;
  name: string;
  input?: unknown;
  output?: string;
  isError?: boolean;
  status: 'running' | 'done' | 'error';
};

/** One row in the transcript. Tool calls coalesce into a `steps` block, plain
 *  assistant prose lives in `text`, and the user side is just a bubble. */
export type ChatMessage =
  | { id: string; role: 'user'; kind: 'text'; text: string }
  | { id: string; role: 'assistant'; kind: 'text'; text: string }
  | { id: string; role: 'assistant'; kind: 'steps'; steps: ToolStep[] };

export type AskOption = { label: string; description?: string };

export type AskQuestion = {
  question: string;
  header?: string;
  multiSelect?: boolean;
  options: AskOption[];
};

export type AskRequest = {
  requestId: string;
  input: { questions: AskQuestion[] } & Record<string, unknown>;
};

export type PermRequest = {
  requestId: string;
  toolName: string;
  input: unknown;
};

export type PendingAttachment = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  kind: 'image' | 'text';
  /** Images: data:image/...;base64,... — text: raw UTF-8 content. */
  data: string;
};

/** The live context-window reading the composer footer chip renders. */
export type TokenBudget = {
  used: number;
  total: number;
  autoCompactThreshold?: number | null;
  isAutoCompactEnabled?: boolean;
};
