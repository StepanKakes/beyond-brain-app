import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { X, Sun, Moon, Monitor, Plug, Check } from 'lucide-react';
import { useTheme } from '../../contexts/ThemeContext';
import BeyondLoader, { LOADER_KINDS, LOADER_STORAGE_KEY, readLoaderKind, type LoaderKind } from './BeyondLoader';
import { fetchBeyondModels, fallbackModelOptions, type BeyondModelOption } from './beyondModels';
import { CLAUDE_MODELS } from '../../../shared/modelConstants';

/**
 * Beyond Brain — Settings dialog (full handoff layout).
 *
 * Sections: Model · Animace přemýšlení · Chování · Vzhled · Rozšíření.
 * Model + loader are shared with the chat via localStorage + custom events
 * (`beyond:set-model`, `beyond:set-loader`), so the composer picker and the
 * thinking indicator stay in sync. Reachable from the sidebar gear.
 */

const MODEL_STORAGE_KEY = 'beyond.model';
const FLAGS_STORAGE_KEY = 'beyond.flags';

type ThemeMode = 'auto' | 'light' | 'dark';
type Flags = { stream: boolean; cite: boolean; memory: boolean };

const DEFAULT_FLAGS: Flags = { stream: true, cite: true, memory: false };

const BEHAVIOR: { id: keyof Flags; label: string; desc: string }[] = [
  { id: 'stream', label: 'Postupné vysázení odpovědi', desc: 'Text se objevuje během generování' },
  { id: 'cite', label: 'Zobrazovat citace', desc: 'Odkazy na zdroje pod odpovědí' },
  { id: 'memory', label: 'Paměť napříč projekty', desc: 'Beyond Brain si pamatuje kontext' },
];

function currentThemeMode(): ThemeMode {
  if (typeof window === 'undefined') return 'auto';
  const saved = localStorage.getItem('theme');
  return saved === 'light' || saved === 'dark' ? saved : 'auto';
}

function readFlags(): Flags {
  try {
    const raw = localStorage.getItem(FLAGS_STORAGE_KEY);
    if (raw) return { ...DEFAULT_FLAGS, ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return DEFAULT_FLAGS;
}

function readModel(): string {
  try {
    return localStorage.getItem(MODEL_STORAGE_KEY) || CLAUDE_MODELS.DEFAULT;
  } catch {
    return CLAUDE_MODELS.DEFAULT;
  }
}

export default function BeyondSettings({ onClose }: { onClose: () => void }) {
  const { setTheme } = useTheme() as { setTheme: (m: ThemeMode) => void };
  const [themeMode, setThemeMode] = useState<ThemeMode>(currentThemeMode);
  const [loader, setLoader] = useState<LoaderKind>(readLoaderKind);
  const [flags, setFlags] = useState<Flags>(readFlags);
  const [modelValue, setModelValue] = useState<string>(readModel);
  const [modelOptions, setModelOptions] = useState<BeyondModelOption[]>(() => fallbackModelOptions());

  useEffect(() => {
    let alive = true;
    fetchBeyondModels()
      .then((opts) => { if (alive && opts?.length) setModelOptions(opts); })
      .catch(() => { /* keep fallback */ });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const pickTheme = (m: ThemeMode) => { setThemeMode(m); setTheme(m); };

  const pickModel = (value: string) => {
    setModelValue(value);
    try { localStorage.setItem(MODEL_STORAGE_KEY, value); } catch { /* ignore */ }
    window.dispatchEvent(new CustomEvent('beyond:set-model', { detail: { value } }));
  };

  const pickLoader = (kind: LoaderKind) => {
    setLoader(kind);
    try { localStorage.setItem(LOADER_STORAGE_KEY, kind); } catch { /* ignore */ }
    window.dispatchEvent(new CustomEvent('beyond:set-loader', { detail: { kind } }));
  };

  const toggleFlag = (id: keyof Flags) => {
    setFlags((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      try { localStorage.setItem(FLAGS_STORAGE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      window.dispatchEvent(new CustomEvent('beyond:set-flags', { detail: next }));
      return next;
    });
  };

  const themeOptions: { key: ThemeMode; label: string; Icon: typeof Sun }[] = [
    { key: 'auto', label: 'Automaticky (podle času)', Icon: Monitor },
    { key: 'light', label: 'Světlá', Icon: Sun },
    { key: 'dark', label: 'Tmavá', Icon: Moon },
  ];

  return (
    <div className="bb-scope">
      <motion.div
        className="bb-dialog__scrim"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={onClose} role="dialog" aria-modal="true"
      >
        <motion.div
          className="bb-dialog"
          initial={{ opacity: 0, y: 14, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 14, scale: 0.98 }}
          transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="bb-dialog__head">
            <span style={{ flex: 1 }}>Nastavení</span>
            <button type="button" className="bb-ib" onClick={onClose} aria-label="Zavřít"><X size={18} strokeWidth={1.8} /></button>
          </div>

          <div className="bb-dialog__body">
            {/* Model */}
            <section>
              <div className="bb-section__label">Model</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {modelOptions.map((m) => {
                  const on = m.value === modelValue;
                  return (
                    <button type="button" key={m.value} className="bb-option" aria-selected={on} onClick={() => pickModel(m.value)}>
                      <span className="bb-radio" data-on={on} style={{ width: 16, height: 16, flex: 'none', borderRadius: '50%', display: 'grid', placeItems: 'center' }}>
                        {on && <i className="bb-radio__dot" style={{ width: 8, height: 8, borderRadius: '50%' }} />}
                      </span>
                      <span style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                        <span style={{ display: 'block', fontSize: 14, fontWeight: 500 }}>{m.short || m.value}</span>
                        {m.description && <span style={{ display: 'block', fontSize: 12.5, color: 'var(--bb-ink2)' }}>{m.description}</span>}
                      </span>
                      {on && <Check size={15} strokeWidth={2.2} />}
                    </button>
                  );
                })}
              </div>
            </section>

            {/* Thinking animation */}
            <section>
              <div className="bb-section__label">Animace přemýšlení</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {LOADER_KINDS.map((l) => (
                  <button type="button" key={l.id} className="bb-option" aria-selected={l.id === loader} onClick={() => pickLoader(l.id)}>
                    <span style={{ width: 30, display: 'grid', placeItems: 'center', flex: 'none' }}><BeyondLoader kind={l.id} /></span>
                    <span style={{ flex: 1, textAlign: 'left' }}>
                      <span style={{ display: 'block', fontSize: 13.5, fontWeight: 500 }}>{l.name}</span>
                      <span style={{ display: 'block', fontSize: 12, color: 'var(--bb-ink2)' }}>{l.desc}</span>
                    </span>
                    {l.id === loader && <Check size={15} strokeWidth={2.2} />}
                  </button>
                ))}
              </div>
            </section>

            {/* Behavior */}
            <section>
              <div className="bb-section__label">Chování</div>
              {BEHAVIOR.map((t) => (
                <div className="bb-switchrow" key={t.id} onClick={() => toggleFlag(t.id)} role="switch" aria-checked={flags[t.id]}>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 14 }}>{t.label}</span>
                    <span style={{ display: 'block', fontSize: 12, color: 'var(--bb-ink3)' }}>{t.desc}</span>
                  </span>
                  <span className="bb-switch" data-on={flags[t.id]}><i /></span>
                </div>
              ))}
            </section>

            {/* Appearance */}
            <section>
              <div className="bb-section__label">Vzhled</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {themeOptions.map(({ key, label, Icon }) => (
                  <button type="button" key={key} className="bb-option" aria-selected={themeMode === key} onClick={() => pickTheme(key)}>
                    <span style={{ width: 30, display: 'grid', placeItems: 'center', flex: 'none', color: 'var(--bb-ink)' }}><Icon size={17} strokeWidth={1.8} /></span>
                    <span style={{ flex: 1, textAlign: 'left', fontSize: 14, fontWeight: 500 }}>{label}</span>
                    {themeMode === key && <Check size={15} strokeWidth={2.2} />}
                  </button>
                ))}
              </div>
            </section>

            {/* Extensions */}
            <section>
              <div className="bb-section__label">Rozšíření</div>
              <button
                type="button"
                className="bb-option"
                style={{ width: '100%' }}
                onClick={() => { onClose(); window.dispatchEvent(new CustomEvent('beyond:open-connectors')); }}
              >
                <span style={{ width: 30, display: 'grid', placeItems: 'center', flex: 'none', color: 'var(--bb-ink)' }}><Plug size={17} strokeWidth={1.8} /></span>
                <span style={{ flex: 1, textAlign: 'left' }}>
                  <span style={{ display: 'block', fontSize: 14, fontWeight: 500 }}>Konektory</span>
                  <span style={{ display: 'block', fontSize: 12, color: 'var(--bb-ink3)' }}>Přidat a spravovat MCP servery (vč. OAuth)</span>
                </span>
              </button>
            </section>
          </div>
        </motion.div>
      </motion.div>
    </div>
  );
}
