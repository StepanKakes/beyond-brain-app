import { motion } from 'framer-motion';

import { describeTool, iconForTool } from './toolDisplay';
import type { PermRequest } from './types';

/**
 * Generic tool permission request — Allow once / Always / Deny.
 *
 * "Always" suggests the widest sensible scope: a whole MCP server for
 * `mcp__server__tool` names, the exact tool otherwise. The scope it will save
 * is spelled out on the button, so granting a server is never a surprise.
 */
export default function PermissionPanel({
  request,
  onDecision,
}: {
  request: PermRequest;
  onDecision: (
    decision:
      | { kind: 'allow-once' }
      | { kind: 'always-allow'; entry: string }
      | { kind: 'deny' },
  ) => void;
}) {
  const { toolName, input } = request;
  const { label, detail } = describeTool(toolName, input);
  const Icon = iconForTool(toolName);

  const mcpMatch = toolName.match(/^mcp__([^_]+)__/);
  const alwaysScope = mcpMatch ? `mcp__${mcpMatch[1]}__*` : toolName;
  const alwaysScopeLabel = mcpMatch ? `všechny ${mcpMatch[1]} tooly` : toolName;

  const inputPreview = (() => {
    if (input == null) return '';
    if (typeof input === 'string') return input;
    try {
      return JSON.stringify(input, null, 2);
    } catch {
      return String(input);
    }
  })();

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: 'easeOut' }}
      className="bb-card overflow-hidden rounded-2xl"
    >
      <div className="px-5 py-4">
        <div className="mb-3 flex items-center gap-2">
          <span className="bb-chip rounded-full px-2 py-0.5 text-[11px] uppercase tracking-wide">
            Povolení
          </span>
          <span className="text-[11px] text-beyond-faint">Agent chce použít nástroj</span>
        </div>

        <div className="mb-3 flex items-center gap-2.5">
          <div className="bb-step-badge flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg text-beyond-dim">
            <Icon className="h-[15px] w-[15px]" strokeWidth={1.8} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[14px] font-medium text-beyond-ink">{label}</p>
            {detail && <p className="truncate text-[12px] text-beyond-faint">{detail}</p>}
          </div>
        </div>

        {inputPreview && (
          <details className="mb-1 text-[12px] text-beyond-faint">
            <summary className="cursor-pointer select-none text-beyond-dim hover:text-beyond-ink">
              Detaily volání
            </summary>
            <pre className="bb-pre mt-2 max-h-[200px] overflow-auto whitespace-pre-wrap break-words rounded-[10px] px-3 py-2 font-mono text-[11px] leading-relaxed">
              {inputPreview}
            </pre>
          </details>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2 bb-card__foot px-5 py-3">
        <button
          type="button"
          onClick={() => onDecision({ kind: 'deny' })}
          className="rounded-full px-3 py-1.5 text-[12px] bb-btn-ghost transition-colors"
        >
          Odmítnout
        </button>
        <button
          type="button"
          onClick={() => onDecision({ kind: 'allow-once' })}
          className="bb-btn-soft rounded-full px-3.5 py-1.5 text-[12px] font-medium"
        >
          Jednou
        </button>
        <button
          type="button"
          onClick={() => onDecision({ kind: 'always-allow', entry: alwaysScope })}
          className="bb-btn-primary rounded-full px-3.5 py-1.5 text-[12px] font-medium"
          title={`Při dalším volání automaticky povolit ${alwaysScopeLabel}`}
        >
          Vždy povolit {mcpMatch ? `(${alwaysScopeLabel})` : ''}
        </button>
      </div>
    </motion.div>
  );
}
