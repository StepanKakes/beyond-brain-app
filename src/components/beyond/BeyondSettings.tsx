import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { X, Sun, Moon, Monitor, Plug, Check } from './icons';
import { useTheme } from '../../contexts/ThemeContext';
import { czechNote, fetchBeyondModels, fallbackModelOptions, type BeyondModelOption } from './beyondModels';
import { CLAUDE_MODELS } from '../../../shared/modelConstants';
import TeamSection from './velin/TeamSection';
import { Switch, Tabs } from './ui';

/**
 * Beyond Brain — Settings dialog (full handoff layout).
 *
 * Sections: Model · Chování · Vzhled · Rozšíření.
 * The model is shared with the chat via localStorage + the `beyond:set-model`
 * event, so the composer picker stays in sync. Reachable from the sidebar gear.
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
                        {czechNote(m.description) && <span style={{ display: 'block', fontSize: 12.5, color: 'var(--bb-ink2)' }}>{czechNote(m.description)}</span>}
                      </span>
                      {on && <Check size={15} strokeWidth={2.2} />}
                    </button>
                  );
                })}
              </div>
            </section>

            {/* Behavior */}
            <section>
              <div className="bb-section__label">Chování</div>
              {BEHAVIOR.map((t) => (
                <div className="bb-switchrow" key={t.id}>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 14 }}>{t.label}</span>
                    <span style={{ display: 'block', fontSize: 12, color: 'var(--bb-ink3)' }}>{t.desc}</span>
                  </span>
                  <Switch on={Boolean(flags[t.id])} onChange={() => toggleFlag(t.id)} label={t.label} />
                </div>
              ))}
            </section>

            {/* Appearance */}
            <section>
              <div className="bb-section__label">Vzhled</div>
              <Tabs
                label="Vzhled"
                items={themeOptions.map(({ key, label, Icon }) => ({
                  key,
                  label: (
                    <>
                      <Icon size={15} />
                      {label}
                    </>
                  ),
                }))}
                value={themeMode}
                onChange={(k) => pickTheme(k as typeof themeMode)}
              />
            </section>

            {/* The login of the machine the brain runs on. It lapses now and then. */}
            <section>
              <div className="bb-section__label">Přihlášení Claude</div>
              <button
                type="button"
                className="bb-option"
                style={{ width: '100%' }}
                onClick={() => window.dispatchEvent(new CustomEvent('beyond:open-claude-login'))}
              >
                <span style={{ width: 30, display: 'grid', placeItems: 'center', flex: 'none', color: 'var(--bb-ink)' }}><Plug size={17} strokeWidth={1.8} /></span>
                <span style={{ flex: 1, textAlign: 'left' }}>
                  <span style={{ display: 'block', fontSize: 14, fontWeight: 500 }}>Přihlásit znovu</span>
                  <span style={{ display: 'block', fontSize: 12, color: 'var(--bb-ink3)' }}>Když chat hlásí vypršelé přihlášení (OAuth session expired)</span>
                </span>
              </button>
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

            {/* Team — each person needs their own login so the velín can say
                whose task and whose call it is. */}
            <section>
              <div className="bb-section__label">Tým</div>
              <TeamSection />
            </section>
          </div>
        </motion.div>
      </motion.div>
    </div>
  );
}
