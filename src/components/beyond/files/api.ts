import { authenticatedFetch } from '../../../utils/api';

export type TreeNode =
  | { type: 'dir'; name: string; path: string; children: TreeNode[] }
  | { type: 'file'; name: string; path: string; size?: number; mtime?: string | null };

export type GraphNode = { path: string; size: number; mtime: string | null };
export type GraphEdge = { from: string; to: string };
export type Graph = { nodes: GraphNode[]; edges: GraphEdge[] };

export type FilePayload = {
  path: string;
  content: string;
  size: number;
  binary: boolean;
  encoding: string;
  mtime?: string;
};

async function getJson<T>(url: string): Promise<T> {
  const r = await authenticatedFetch(url);
  const data = await r.json().catch(() => null);
  if (!r.ok) throw new Error(data?.error || `HTTP ${r.status}`);
  return data as T;
}

export function fetchTree(): Promise<{ roots: TreeNode[] }> {
  return getJson('/api/beyond/files/tree');
}

export function fetchGraph(): Promise<Graph> {
  return getJson('/api/beyond/files/graph');
}

export function fetchFile(path: string): Promise<FilePayload> {
  return getJson(`/api/beyond/file?path=${encodeURIComponent(path)}`);
}

/** Flatten a tree to file paths, for search. */
export function flattenFiles(nodes: TreeNode[], out: string[] = []): string[] {
  for (const n of nodes) {
    if (n.type === 'file') out.push(n.path);
    else flattenFiles(n.children, out);
  }
  return out;
}

export function basename(p: string): string {
  return p.slice(p.lastIndexOf('/') + 1);
}

export function dirname(p: string): string {
  return p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '';
}
