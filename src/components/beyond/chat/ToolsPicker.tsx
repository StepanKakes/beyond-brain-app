/**
 * Which connectors this chat may use.
 *
 * Every connector's tool list is re-sent to the model on every turn, so a chat
 * that carries all of them starts a hundred thousand tokens in the hole before
 * anyone types. Nothing is loaded until it is picked here; the brain's own
 * tools (the repo, tasks, content, memory) are always there either way.
 */
import { useEffect, useRef, useState } from 'react';

import { Plug, Check, ChevronDown } from '../icons';
import { useBeyondConnectors } from '../useBeyondConnectors';

export default function ToolsPicker({ value, onChange }: { value: string[]; onChange: (next: string[]) => void }) {
  const [open, setOpen] = useState(false);
  // The list is only needed once the menu is open.
  const { connectors } = useBeyondConnectors(open);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onDoc);
    return () => window.removeEventListener('mousedown', onDoc);
  }, [open]);

  const usable = (connectors || []).filter((c) => c.enabled);
  const label = value.length === 0 ? 'Bez konektorů' : value.length === 1 ? nameOf(usable, value[0]) : `${value.length} konektory`;

  const toggle = (key: string) => {
    onChange(value.includes(key) ? value.filter((k) => k !== key) : [...value, key]);
  };

  return (
    <div ref={ref} className="relative">
      <button type="button" className="bb-modelbtn" onClick={() => setOpen((o) => !o)} aria-expanded={open} title="Které konektory smí tenhle chat použít">
        <Plug className="h-[13px] w-[13px]" style={{ color: 'var(--bb-ink2)' }} />
        {label}
        <ChevronDown className={`h-[13px] w-[13px] transition-transform ${open ? 'rotate-180' : ''}`} style={{ color: 'var(--bb-ink2)' }} />
      </button>
      {open && (
        <div
          className="bb-glass absolute bottom-full left-0 z-20 mb-2 max-h-[300px] min-w-[260px] overflow-y-auto rounded-[14px] p-1.5"
          style={{ boxShadow: 'var(--bb-shadow-pop), inset 0 1px 0 0 var(--bb-rim)' }}
        >
          {usable.length === 0 && <p className="px-2.5 py-2 text-[12.5px]" style={{ color: 'var(--bb-ink3)' }}>Žádný zapnutý konektor.</p>}
          {usable.map((c) => {
            const key = slug(c.name);
            const on = value.includes(key);
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => toggle(key)}
                className="flex w-full items-center justify-between gap-3 rounded-[10px] px-2.5 py-2 text-left transition-colors hover:bg-[var(--bb-panel2)]"
                style={on ? { background: 'var(--bb-accent-soft)' } : undefined}
              >
                <span className="min-w-0 text-[12.5px] text-beyond-ink">{c.name}</span>
                {on && <Check className="h-[13px] w-[13px] flex-shrink-0 text-beyond-ink" />}
              </button>
            );
          })}
          {value.length > 0 && (
            <button type="button" className="mt-1 w-full rounded-[10px] px-2.5 py-2 text-left text-[12px]" style={{ color: 'var(--bb-ink3)' }} onClick={() => onChange([])}>
              Žádný, jen brain
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** The key the server matches on: the connector's name, slugified. */
export function slug(name: string): string {
  return String(name).trim().replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
}

function nameOf(list: { name: string }[], key: string): string {
  return list.find((c) => slug(c.name) === key)?.name || key;
}
