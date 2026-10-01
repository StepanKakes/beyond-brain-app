import { useLayoutEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { Check } from '../icons';
import './PromptBar.css';

/**
 * The list menu from React Bits PromptBar, lifted out so every popover above
 * the composer (commands, model, connectors, the plus menu) moves the same
 * way: one soft highlight glides from row to row instead of each row lighting
 * up on its own. Rendered inside a `.prompt-bar` root, which supplies the
 * colours.
 */

export type GlideMenuItem = {
  key: string;
  name: ReactNode;
  description?: ReactNode;
  tag?: ReactNode;
  icon?: ReactNode;
  /** Shows the check mark (current model, connector switched on). */
  on?: boolean;
  mono?: boolean;
};

export default function GlideMenu({
  items,
  active,
  onHover,
  onPick,
  label,
  header,
  footer,
  empty,
  width,
  align = 'stretch',
  check = false,
}: {
  items: GlideMenuItem[];
  active: number;
  onHover: (index: number) => void;
  onPick: (item: GlideMenuItem, index: number) => void;
  label: string;
  header?: ReactNode;
  footer?: ReactNode;
  empty?: ReactNode;
  width?: number;
  align?: 'stretch' | 'left' | 'right';
  check?: boolean;
}) {
  const glowRef = useRef<HTMLSpanElement>(null);
  const rowRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const first = useRef(true);

  useLayoutEffect(() => {
    const glow = glowRef.current;
    if (!glow) return;
    const row = rowRefs.current[active];
    if (!row) {
      glow.style.opacity = '0';
      return;
    }
    // The first placement jumps; only later moves glide.
    if (first.current) glow.style.transition = 'none';
    glow.style.top = `${row.offsetTop}px`;
    glow.style.height = `${row.offsetHeight}px`;
    glow.style.opacity = '1';
    if (first.current) {
      void glow.offsetHeight;
      glow.style.transition = '';
      first.current = false;
    }
    row.scrollIntoView({ block: 'nearest' });
  }, [active, items]);

  const style: CSSProperties = {};
  if (width) style.width = width;
  if (align === 'left') style.right = 'auto';
  if (align === 'right') style.left = 'auto';

  return (
    <div className="prompt-bar__menu bb-glide" role="listbox" aria-label={label} style={style}>
      {header}
      <div className="bb-glide__list">
        <span ref={glowRef} className="prompt-bar__glow" aria-hidden="true" />
        {items.map((item, i) => (
          <button
            key={item.key}
            ref={(el) => {
              rowRefs.current[i] = el;
            }}
            type="button"
            role="option"
            aria-selected={i === active}
            className="prompt-bar__row"
            onMouseDown={(e) => e.preventDefault()}
            onPointerEnter={() => onHover(i)}
            onClick={() => onPick(item, i)}
          >
            {item.icon ? <span className="prompt-bar__row-icon">{item.icon}</span> : null}
            <span className={`prompt-bar__row-name${item.mono ? ' bb-glide__mono' : ''}`}>{item.name}</span>
            {item.description ? <span className="prompt-bar__row-desc">{item.description}</span> : null}
            {item.tag ? <span className="prompt-bar__row-tag">{item.tag}</span> : null}
            {check ? (
              <span className="prompt-bar__row-check" data-on={item.on ? '' : undefined}>
                <Check size={13} />
              </span>
            ) : null}
          </button>
        ))}
        {items.length === 0 && empty ? <div className="prompt-bar__empty">{empty}</div> : null}
      </div>
      {footer}
    </div>
  );
}
