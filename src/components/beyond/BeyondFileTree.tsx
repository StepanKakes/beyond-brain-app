import { useCallback, useEffect, useState } from 'react';
import { ChevronRight, FileText, Folder, FolderOpen } from 'lucide-react';
import { authenticatedFetch } from '../../utils/api';

/**
 * Beyond Brain — filtered file tree.
 *
 * Reads `/api/beyond/tree` which serves a depth-capped, filtered view of
 * `clients/aktivni/*` and `workspace/{drafty,briefy,reporty}`. Each root
 * starts collapsed; clicking a folder toggles its children. Files have no
 * action yet (future iteration: open in a side viewer or send into chat).
 */

type TreeNode =
  | { type: 'dir'; name: string; path: string; children: TreeNode[] }
  | { type: 'file'; name: string; path: string; size?: number };

type TreeResponse = { roots: TreeNode[] };

export default function BeyondFileTree({
  refreshKey = 0,
  onFileClick,
}: {
  refreshKey?: number;
  /** Called with the repo-relative path when user clicks a file row. */
  onFileClick?: (path: string) => void;
}) {
  const [roots, setRoots] = useState<TreeNode[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchTree = useCallback(async () => {
    setLoading(true);
    try {
      const r = await authenticatedFetch('/api/beyond/tree');
      if (!r.ok) {
        setRoots([]);
        return;
      }
      const data = (await r.json()) as TreeResponse;
      setRoots(data.roots || []);
    } catch {
      setRoots([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTree();
  }, [fetchTree, refreshKey]);

  if (loading && roots.length === 0) {
    return (
      <p className="px-5 py-2 text-[11px] uppercase tracking-wide text-beyond-faint">
        Soubory…
      </p>
    );
  }

  if (roots.length === 0) {
    return (
      <p className="px-5 py-2 text-[11px] uppercase tracking-wide text-beyond-faint">
        Žádné soubory
      </p>
    );
  }

  return (
    <div className="px-3 pb-3">
      <p className="mb-1 mt-2 px-2 text-[10px] uppercase tracking-wider text-beyond-faint">
        Soubory
      </p>
      <ul className="flex flex-col">
        {roots.map((root) => (
          <TreeRow
            key={root.path}
            node={root}
            depth={0}
            defaultOpen={root.name === 'clients/aktivni'}
            onFileClick={onFileClick}
          />
        ))}
      </ul>
    </div>
  );
}

function TreeRow({
  node,
  depth,
  defaultOpen = false,
  onFileClick,
}: {
  node: TreeNode;
  depth: number;
  defaultOpen?: boolean;
  onFileClick?: (path: string) => void;
}) {
  const [open, setOpen] = useState(defaultOpen);

  if (node.type === 'file') {
    return (
      <li>
        <button
          type="button"
          onClick={() => onFileClick?.(node.path)}
          className="flex w-full items-center gap-1.5 rounded-md py-1 pr-2 text-left transition-colors hover:bg-black/[0.04]"
          style={{ paddingLeft: 8 + depth * 12 }}
          title={`Vložit @${node.path} do chatu`}
        >
          <FileText
            className="h-[12px] w-[12px] flex-shrink-0 text-beyond-faint"
            strokeWidth={1.6}
          />
          <span className="truncate text-[12px] text-beyond-dim">{node.name}</span>
        </button>
      </li>
    );
  }

  const Icon = open ? FolderOpen : Folder;
  return (
    <li>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 rounded-md py-1 pr-2 text-left transition-colors hover:bg-black/[0.025]"
        style={{ paddingLeft: 4 + depth * 12 }}
        title={node.path}
      >
        <ChevronRight
          className={`h-[11px] w-[11px] flex-shrink-0 text-beyond-faint transition-transform ${open ? 'rotate-90' : ''}`}
          strokeWidth={2}
        />
        <Icon
          className="h-[12px] w-[12px] flex-shrink-0 text-beyond-faint"
          strokeWidth={1.6}
        />
        <span className="truncate text-[12px] font-medium text-beyond-ink">{node.name}</span>
      </button>
      {open && node.children.length > 0 && (
        <ul className="flex flex-col">
          {node.children.map((child) => (
            <TreeRow key={child.path} node={child} depth={depth + 1} onFileClick={onFileClick} />
          ))}
        </ul>
      )}
    </li>
  );
}
