import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Sparkles } from 'lucide-react';

import type { BeyondModelOption } from '../beyondModels';

/**
 * Compact dropdown to pick the Anthropic model used for this chat. Options
 * carry version-bearing names pulled from the installed Claude Code.
 */
export default function ModelPicker({
  value,
  options,
  onChange,
}: {
  value: string;
  options: BeyondModelOption[];
  onChange: (next: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onDoc);
    return () => window.removeEventListener('mousedown', onDoc);
  }, [open]);

  const current = options.find((o) => o.value === value);
  const chipLabel = current?.short || value;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title="Vybrat Claude model"
        aria-expanded={open}
        className="bb-modelbtn"
      >
        <Sparkles className="h-[13px] w-[13px]" strokeWidth={1.8} style={{ color: 'var(--bb-ink2)' }} />
        {chipLabel}
        <ChevronDown
          className={`h-[13px] w-[13px] transition-transform ${open ? 'rotate-180' : ''}`}
          strokeWidth={1.8}
          style={{ color: 'var(--bb-ink2)' }}
        />
      </button>
      {open && (
        <div
          className="bb-glass absolute bottom-full right-0 z-20 mb-2 max-h-[280px] min-w-[240px] overflow-y-auto rounded-[14px] p-1.5"
          style={{ boxShadow: 'var(--bb-shadow-pop), inset 0 1px 0 0 var(--bb-rim)' }}
        >
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => {
                onChange(o.value);
                setOpen(false);
              }}
              className="flex w-full items-start justify-between gap-3 rounded-[10px] px-2.5 py-2 text-left transition-colors hover:bg-[var(--bb-panel2)]"
              style={o.value === value ? { background: 'var(--bb-accent-soft)' } : undefined}
            >
              <span className="min-w-0">
                <span
                  className={`block text-[12.5px] ${
                    o.value === value ? 'font-medium text-beyond-ink' : 'text-beyond-ink'
                  }`}
                >
                  {o.short}
                </span>
                {o.description && (
                  <span className="block truncate text-[11px] text-beyond-faint">
                    {o.description}
                  </span>
                )}
              </span>
              {o.value === value && (
                <Check className="mt-0.5 h-[13px] w-[13px] flex-shrink-0 text-beyond-ink" strokeWidth={2} />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
