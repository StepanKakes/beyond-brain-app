import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react';

import { Paperclip, Plug, Plus, Sparkles, Terminal, ChevronDown, Mic } from '../icons';
import { SendGlyph } from '../bits/PromptBar';
import GlideMenu, { type GlideMenuItem } from '../bits/GlideMenu';
import { useBeyondConnectors } from '../useBeyondConnectors';
import { czechNote, type BeyondModelOption } from '../beyondModels';
import { slug } from './format';

/**
 * Beyond Brain chat — the composer, built on React Bits PromptBar.
 *
 * The field, the menus with the gliding highlight, the send arrow that morphs
 * into a stop square and the dictation equaliser come from PromptBar. What it
 * types into stays the chat's own state, so slash commands, attachments,
 * model and connectors behave exactly as before.
 */

const LINE = 24;
const MAX_ROWS = 9;

type Menu = 'plus' | 'model' | 'tools' | null;

export default function Composer({
  value,
  onChange,
  onKeyDown,
  textareaRef,
  placeholder,
  overlay,
  attachments,
  onAttach,
  speechSupported,
  listening,
  onToggleDictation,
  busy,
  canSend,
  onSend,
  onStop,
  model,
  modelOptions,
  onModel,
  connectors,
  onConnectors,
  budget,
}: {
  value: string;
  onChange: (next: string) => void;
  onKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
  textareaRef: RefObject<HTMLTextAreaElement>;
  placeholder: string;
  /** The slash menu while a command is being typed; hides the other menus. */
  overlay?: ReactNode;
  attachments?: ReactNode;
  onAttach: () => void;
  speechSupported: boolean;
  listening: boolean;
  onToggleDictation: () => void;
  busy: boolean;
  canSend: boolean;
  onSend: () => void;
  onStop: () => void;
  model: string;
  modelOptions: BeyondModelOption[];
  onModel: (next: string) => void;
  connectors: string[];
  onConnectors: (next: string[]) => void;
  budget?: ReactNode;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<Menu>(null);
  const [active, setActive] = useState(0);
  const [pressed, setPressed] = useState(false);
  const [custom, setCustom] = useState('');
  const { connectors: allConnectors } = useBeyondConnectors(menu === 'tools');
  const usable = (allConnectors || []).filter((c) => c.enabled);
  const armed = busy || canSend;
  const current = modelOptions.find((o) => o.value === model);

  // Grow with the text up to a cap, then scroll inside.
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = '0px';
    const max = LINE * MAX_ROWS;
    el.style.height = `${Math.max(LINE * 2, Math.min(el.scrollHeight, max))}px`;
    el.style.overflowY = el.scrollHeight > max ? 'auto' : 'hidden';
  }, [value, textareaRef]);

  useEffect(() => {
    if (!menu) return undefined;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setMenu(null);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [menu]);

  const focus = () => textareaRef.current?.focus({ preventScroll: true });
  const toggle = (next: Exclude<Menu, null>, startAt = 0) => {
    setActive(startAt);
    setMenu((m) => (m === next ? null : next));
    focus();
  };

  const plusItems: GlideMenuItem[] = [
    { key: 'file', name: 'Soubor nebo obrázek', description: 'Z tohohle zařízení', icon: <Paperclip size={15} /> },
    { key: 'command', name: 'Příkaz', description: 'Lomítko otevře seznam', icon: <Terminal size={15} /> },
    { key: 'tools', name: 'Konektory', description: 'Co smí chat použít od začátku', icon: <Plug size={15} /> },
  ];
  const modelItems: GlideMenuItem[] = modelOptions.map((o) => ({
    key: o.value,
    name: o.short,
    description: czechNote(o.description),
    on: o.value === model,
  }));
  const toolItems: GlideMenuItem[] = usable.map((c) => ({
    key: slug(c.name),
    name: c.name,
    on: connectors.includes(slug(c.name)),
  }));

  const pickPlus = (item: GlideMenuItem) => {
    if (item.key === 'file') {
      setMenu(null);
      onAttach();
    } else if (item.key === 'command') {
      setMenu(null);
      onChange(value.trim() ? `${value.trimEnd()} /` : '/');
      focus();
    } else {
      setActive(0);
      setMenu('tools');
    }
  };

  const toolsLabel =
    connectors.length === 0
      ? 'Konektory podle potřeby'
      : connectors.length === 1
        ? usable.find((c) => slug(c.name) === connectors[0])?.name || connectors[0]
        : `${connectors.length} konektory`;

  return (
    <div ref={rootRef} className="prompt-bar bb-pb" data-busy={busy ? '' : undefined}>
      {overlay ??
        (menu === 'plus' ? (
          <GlideMenu
            label="Přidat"
            items={plusItems}
            active={active}
            onHover={setActive}
            onPick={pickPlus}
            width={300}
            align="left"
          />
        ) : menu === 'model' ? (
          <GlideMenu
            label="Model"
            items={modelItems}
            active={active}
            onHover={setActive}
            onPick={(item) => {
              onModel(item.key);
              setMenu(null);
              focus();
            }}
            width={300}
            align="left"
            check
            footer={
              // The list is whatever Claude Code on the box offers. A model
              // it does not list yet can be typed in; a name it refuses comes
              // back as an error in the chat, not silence.
              <div className="bb-pb__own">
                <input
                  type="text"
                  value={custom}
                  placeholder="Jiný model, např. claude-sonnet-5"
                  onChange={(e) => setCustom(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') setMenu(null);
                    if (e.key !== 'Enter') return;
                    e.preventDefault();
                    const id = custom.trim();
                    if (!id) return;
                    onModel(id);
                    setCustom('');
                    setMenu(null);
                  }}
                />
              </div>
            }
          />
        ) : menu === 'tools' ? (
          <GlideMenu
            label="Konektory"
            items={toolItems}
            active={active}
            onHover={setActive}
            onPick={(item) =>
              onConnectors(
                connectors.includes(item.key) ? connectors.filter((k) => k !== item.key) : [...connectors, item.key],
              )
            }
            width={320}
            align="left"
            check
            empty="Žádný zapnutý konektor"
            header={
              <p className="bb-pb__note">
                Brain si konektor vezme sám, až ho bude potřebovat. Tady ho můžeš mít od začátku.
              </p>
            }
            footer={
              connectors.length > 0 ? (
                <button type="button" className="bb-pb__reset" onClick={() => onConnectors([])}>
                  Zpět na podle potřeby
                </button>
              ) : null
            }
          />
        ) : null)}

      <div
        className="prompt-bar__field"
        role="presentation"
        onPointerDown={(e) => {
          if (e.target === e.currentTarget || e.target === textareaRef.current) setMenu(null);
        }}
        onClick={focus}
      >
        {attachments}

        <textarea
          ref={textareaRef}
          className="prompt-bar__input"
          rows={2}
          value={value}
          placeholder={listening ? 'Poslouchám, mluv česky' : placeholder}
          aria-label="Zpráva"
          onChange={(e) => {
            onChange(e.target.value);
            setMenu(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && menu) {
              e.preventDefault();
              setMenu(null);
              return;
            }
            onKeyDown(e);
          }}
        />

        <div className="prompt-bar__bar">
          <button
            type="button"
            className="prompt-bar__tool"
            aria-label="Přidat soubor, příkaz nebo konektor"
            aria-expanded={menu === 'plus'}
            data-on={menu === 'plus' ? '' : undefined}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => toggle('plus')}
          >
            <Plus size={16} />
          </button>
          <button
            type="button"
            className="prompt-bar__pick"
            aria-label="Vybrat model"
            aria-expanded={menu === 'model'}
            data-on={menu === 'model' ? '' : undefined}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => toggle('model', Math.max(0, modelOptions.findIndex((o) => o.value === model)))}
          >
            <Sparkles size={13} />
            <span className="bb-pb__picklabel">{current?.short || model}</span>
            <ChevronDown size={12} />
          </button>
          <button
            type="button"
            className="prompt-bar__pick"
            aria-label="Vybrat konektory"
            aria-expanded={menu === 'tools'}
            data-on={menu === 'tools' || connectors.length > 0 ? '' : undefined}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => toggle('tools')}
          >
            <Plug size={13} />
            <span className="bb-pb__picklabel">{toolsLabel}</span>
            <ChevronDown size={12} />
          </button>
          {budget}
          <span className="prompt-bar__spacer" />
          {speechSupported ? (
            <button
              type="button"
              className="prompt-bar__tool"
              aria-label={listening ? 'Zastavit diktování' : 'Diktovat česky'}
              title={listening ? 'Zastavit diktování' : 'Diktovat česky'}
              aria-pressed={listening}
              data-on={listening ? '' : undefined}
              onMouseDown={(e) => e.preventDefault()}
              onClick={onToggleDictation}
            >
              {listening ? (
                <span className="prompt-bar__eq" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
              ) : (
                <Mic size={16} />
              )}
            </button>
          ) : null}
          <button
            type="button"
            className="prompt-bar__send"
            disabled={!armed}
            aria-label={busy ? 'Zastavit agenta' : 'Poslat'}
            title={busy ? 'Zastavit agenta' : 'Poslat, Enter'}
            data-armed={armed ? '' : undefined}
            data-pressed={pressed ? '' : undefined}
            onMouseDown={(e) => e.preventDefault()}
            onPointerDown={(e) => {
              if (e.button === 0 && armed) setPressed(true);
            }}
            onPointerUp={() => setPressed(false)}
            onPointerCancel={() => setPressed(false)}
            onPointerLeave={() => setPressed(false)}
            onClick={() => (busy ? onStop() : onSend())}
          >
            <SendGlyph busy={busy} morphDuration={240} squash={0.12} tilt={8} />
          </button>
        </div>
      </div>
    </div>
  );
}
