import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  X,
  Plug,
  Plus,
  Loader2,
  Trash2,
  RefreshCw,
  Globe,
  Terminal,
  Check,
  AlertTriangle,
  ChevronDown,
  ShieldCheck,
  Zap,
} from 'lucide-react';
import { useBeyondConnectors } from './useBeyondConnectors';
import { applyToCurrentChat } from './beyondConnectorsApi';
import type { Connector, ConnectorStatus, Preset } from './beyondConnectorsApi';

/**
 * Beyond Brain — Konektory (MCP servers) panel.
 *
 * Slide-in sheet (mirrors BeyondFilePreview) that lets the user add and manage
 * MCP servers exactly like the Claude app: a quick-add gallery of popular
 * remote connectors, a custom form (remote URL or local command), and a live
 * list with per-connector status, enable toggle, OAuth "Připojit", test and
 * remove. Opened via the sidebar "Konektory" item (a `beyond:open-connectors`
 * event handled in BeyondApp).
 */

const STATUS_META: Record<
  ConnectorStatus,
  { label: string; className: string }
> = {
  connected: { label: 'Připojeno', className: 'bg-emerald-50 text-emerald-700' },
  needs_auth: { label: 'Vyžaduje přihlášení', className: 'bg-amber-50 text-amber-700' },
  authorizing: { label: 'Přihlašování…', className: 'bg-blue-50 text-blue-700' },
  error: { label: 'Chyba', className: 'bg-red-50 text-red-600' },
  unknown: { label: 'Neověřeno', className: 'bg-beyond-ink/[0.04] text-beyond-dim' },
};

function StatusPill({ connector }: { connector: Connector }) {
  if (!connector.enabled) {
    return (
      <span className="inline-flex items-center rounded-full bg-beyond-ink/[0.04] px-2 py-0.5 text-[11px] font-medium text-beyond-faint">
        Vypnuto
      </span>
    );
  }
  const meta = STATUS_META[connector.status] || STATUS_META.unknown;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${meta.className}`}
    >
      {meta.label}
    </span>
  );
}

export default function BeyondConnectors({ onClose }: { onClose: () => void }) {
  const { connectors, presets, loading, error, create, update, remove, test, connect, finish } =
    useBeyondConnectors(true);
  // A connector whose login ended on a loopback address: the person pastes
  // that address here to finish.
  const [manualFor, setManualFor] = useState<{ id: string; redirectUri: string } | null>(null);
  const [manualUrl, setManualUrl] = useState('');

  const [showForm, setShowForm] = useState(false);
  const [mode, setMode] = useState<'remote' | 'local'>('remote');
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [transport, setTransport] = useState<'http' | 'sse'>('http');
  const [command, setCommand] = useState('');
  const [argsStr, setArgsStr] = useState('');
  const [advanced, setAdvanced] = useState(false);
  const [token, setToken] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const resetForm = () => {
    setName('');
    setUrl('');
    setTransport('http');
    setCommand('');
    setArgsStr('');
    setAdvanced(false);
    setToken('');
    setFormError(null);
  };

  const closeForm = () => {
    setShowForm(false);
    resetForm();
  };

  const applyPreset = (p: Preset) => {
    resetForm();
    setMode('remote');
    setName(p.name);
    setUrl(p.url);
    setTransport(p.transport === 'sse' ? 'sse' : 'http');
    setShowForm(true);
  };

  const handleSubmit = async () => {
    setFormError(null);
    const trimmedName = name.trim();
    if (!trimmedName) return setFormError('Zadejte název.');

    try {
      setSubmitting(true);
      let created: Connector;
      if (mode === 'local') {
        if (!command.trim()) return setFormError('Zadejte příkaz.');
        const args = argsStr.trim() ? argsStr.trim().split(/\s+/) : [];
        created = await create({ name: trimmedName, transport: 'stdio', command: command.trim(), args });
      } else {
        if (!url.trim()) return setFormError('Zadejte URL.');
        const useToken = advanced && token.trim();
        created = await create({
          name: trimmedName,
          transport,
          url: url.trim(),
          ...(useToken
            ? { auth: 'token' as const, headers: { Authorization: `Bearer ${token.trim()}` } }
            : {}),
        });
      }

      closeForm();

      // If the server needs OAuth, kick off the browser flow immediately.
      if (created.auth === 'oauth' && !(created.oauth?.connected)) {
        setNotice(`„${created.name}" vyžaduje přihlášení — otevírám okno…`);
        setBusyId(created.id);
        const res = await connect(created.id);
        setBusyId(null);
        if (!res.ok) {
          setNotice(res.error || 'Přihlášení selhalo.');
          return;
        }
        await applyLive(`„${created.name}" připojeno.`);
      } else {
        await applyLive(`„${created.name}" přidán.`);
      }
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Přidání selhalo.');
    } finally {
      setSubmitting(false);
    }
  };

  const withBusy = async (id: string, fn: () => Promise<void>) => {
    setBusyId(id);
    setNotice(null);
    try {
      await fn();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Operace selhala.');
    } finally {
      setBusyId(null);
    }
  };

  /** Hot-attach the connector set to the chat that's open behind this panel, so
   *  it works in the CURRENT thread without starting a new one. */
  const applyLive = async (label: string) => {
    const applied = await applyToCurrentChat();
    if (applied.ok && applied.live) {
      setNotice(`${label} Aktivní i v tomto chatu — můžeš rovnou psát.`);
    } else {
      setNotice(`${label} Projeví se v novém chatu.`);
    }
  };

  const handleConnect = (c: Connector) =>
    withBusy(c.id, async () => {
      setNotice(`Otevírám přihlášení pro „${c.name}"…`);
      const res = await connect(c.id);
      if (res.manual) {
        setManualFor({ id: c.id, redirectUri: res.redirectUri || 'http://127.0.0.1:3001/callback' });
        setManualUrl('');
        setNotice(null);
        return;
      }
      if (!res.ok) {
        setNotice(res.error || 'Přihlášení selhalo.');
        return;
      }
      setNotice(`„${c.name}" připojeno. Aktivuji v tomto chatu…`);
      await applyLive(`„${c.name}" připojeno.`);
    });

  const handleFinish = (c: Connector) =>
    withBusy(c.id, async () => {
      const res = await finish(c.id, manualUrl.trim());
      if (!res.ok) {
        setNotice('Přihlášení se nepodařilo dokončit.');
        return;
      }
      setManualFor(null);
      setManualUrl('');
      setNotice(`„${c.name}" připojeno. Aktivuji v tomto chatu…`);
      await applyLive(`„${c.name}" připojeno.`);
    });

  const handleApply = (c: Connector) =>
    withBusy(c.id, async () => {
      setNotice('Aktivuji v tomto chatu…');
      await applyLive('Hotovo.');
    });

  const handleTest = (c: Connector) =>
    withBusy(c.id, async () => {
      const res = await test(c.id);
      const label = STATUS_META[res.status]?.label || res.status;
      setNotice(`Test „${c.name}": ${label}${res.detail ? ` — ${res.detail}` : ''}`);
    });

  const handleToggle = (c: Connector) =>
    withBusy(c.id, () => update(c.id, { enabled: !c.enabled }));

  const handleRemove = (c: Connector) => {
    if (!window.confirm(`Odebrat konektor „${c.name}"?`)) return;
    return withBusy(c.id, () => remove(c.id));
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      className="fixed inset-0 z-50 flex items-stretch justify-end bg-black/30 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <motion.div
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ duration: 0.28, ease: [0.21, 1.02, 0.73, 1] }}
        className="bb-scope bb-sheet flex h-full w-full max-w-[640px] flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <header className="flex flex-shrink-0 items-center gap-2.5 border-b border-beyond-ink/[0.06] px-6 py-4">
          <Plug className="h-[18px] w-[18px] flex-shrink-0 text-beyond-dim" strokeWidth={1.8} />
          <div className="min-w-0 flex-1">
            <h2 className="font-hero italic text-[1.35rem] leading-tight text-beyond-ink">
              Konektory
            </h2>
            <p className="text-[12px] text-beyond-faint">
              Připoj MCP servery — projeví se v novém chatu.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Zavřít"
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-beyond-faint transition-colors hover:bg-beyond-ink/[0.04] hover:text-beyond-dim"
          >
            <X className="h-[16px] w-[16px]" strokeWidth={1.8} />
          </button>
        </header>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {notice && (
            <div className="mb-4 rounded-xl bg-beyond-ink/[0.03] px-3.5 py-2.5 text-[12.5px] text-beyond-dim">
              {notice}
            </div>
          )}

          {/* Add form / trigger */}
          {showForm ? (
            <AddForm
              mode={mode}
              setMode={setMode}
              name={name}
              setName={setName}
              url={url}
              setUrl={setUrl}
              transport={transport}
              setTransport={setTransport}
              command={command}
              setCommand={setCommand}
              argsStr={argsStr}
              setArgsStr={setArgsStr}
              advanced={advanced}
              setAdvanced={setAdvanced}
              token={token}
              setToken={setToken}
              submitting={submitting}
              formError={formError}
              onSubmit={handleSubmit}
              onCancel={closeForm}
            />
          ) : (
            <button
              type="button"
              onClick={() => {
                resetForm();
                setShowForm(true);
              }}
              className="mb-5 inline-flex items-center gap-2 bb-btn-primary rounded-full px-4 py-2 text-[13px] font-medium"
            >
              <Plus className="h-[15px] w-[15px]" strokeWidth={2} />
              Přidat vlastní konektor
            </button>
          )}

          {/* Preset gallery */}
          {!showForm && presets.length > 0 && (
            <section className="mb-6">
              <p className="mb-2 text-[10px] uppercase tracking-wider text-beyond-faint">
                Oblíbené
              </p>
              <div className="grid grid-cols-2 gap-2">
                {presets.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => applyPreset(p)}
                    className="group flex flex-col items-start gap-1 rounded-2xl border border-beyond-line px-3.5 py-3 text-left transition-colors hover:border-beyond-ink/20 hover:bg-beyond-ink/[0.02]"
                  >
                    <span className="flex items-center gap-2 text-[13.5px] font-medium text-beyond-ink">
                      <Globe className="h-[14px] w-[14px] text-beyond-faint" strokeWidth={1.8} />
                      {p.name}
                    </span>
                    <span className="line-clamp-2 text-[11.5px] leading-snug text-beyond-faint">
                      {p.description}
                    </span>
                  </button>
                ))}
              </div>
            </section>
          )}

          {/* Connector list */}
          <section>
            <p className="mb-2 text-[10px] uppercase tracking-wider text-beyond-faint">
              Moje konektory
            </p>

            {loading && connectors.length === 0 ? (
              <div className="flex items-center justify-center py-8 text-beyond-faint">
                <Loader2 className="h-5 w-5 animate-spin" strokeWidth={1.8} />
              </div>
            ) : error ? (
              <p className="py-4 text-[13px] text-red-600">⚠ {error}</p>
            ) : connectors.length === 0 ? (
              <p className="py-4 text-[13px] text-beyond-faint">
                Zatím žádné konektory. Přidej první nahoře.
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {connectors.map((c) => (
                  <ConnectorRow
                    key={c.id}
                    connector={c}
                    busy={busyId === c.id}
                    onConnect={() => handleConnect(c)}
                    manual={manualFor?.id === c.id ? { redirectUri: manualFor.redirectUri, url: manualUrl, setUrl: setManualUrl, onFinish: () => handleFinish(c), onCancel: () => setManualFor(null) } : null}
                    onApply={() => handleApply(c)}
                    onTest={() => handleTest(c)}
                    onToggle={() => handleToggle(c)}
                    onRemove={() => handleRemove(c)}
                  />
                ))}
              </ul>
            )}
          </section>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Add form
// ---------------------------------------------------------------------------
type AddFormProps = {
  mode: 'remote' | 'local';
  setMode: (m: 'remote' | 'local') => void;
  name: string;
  setName: (v: string) => void;
  url: string;
  setUrl: (v: string) => void;
  transport: 'http' | 'sse';
  setTransport: (v: 'http' | 'sse') => void;
  command: string;
  setCommand: (v: string) => void;
  argsStr: string;
  setArgsStr: (v: string) => void;
  advanced: boolean;
  setAdvanced: (v: boolean) => void;
  token: string;
  setToken: (v: string) => void;
  submitting: boolean;
  formError: string | null;
  onSubmit: () => void;
  onCancel: () => void;
};

const inputClass =
  'bb-field w-full rounded-xl px-3 py-2 text-[13.5px]';

function AddForm(props: AddFormProps) {
  const {
    mode,
    setMode,
    name,
    setName,
    url,
    setUrl,
    transport,
    setTransport,
    command,
    setCommand,
    argsStr,
    setArgsStr,
    advanced,
    setAdvanced,
    token,
    setToken,
    submitting,
    formError,
    onSubmit,
    onCancel,
  } = props;

  return (
    <div className="mb-6 rounded-2xl border border-beyond-line p-4">
      {/* Type toggle */}
      <div className="mb-3 inline-flex rounded-full bg-beyond-ink/[0.04] p-0.5">
        <TypeTab active={mode === 'remote'} onClick={() => setMode('remote')} icon={<Globe className="h-[13px] w-[13px]" strokeWidth={1.8} />} label="Vzdálený" />
        <TypeTab active={mode === 'local'} onClick={() => setMode('local')} icon={<Terminal className="h-[13px] w-[13px]" strokeWidth={1.8} />} label="Lokální" />
      </div>

      <div className="flex flex-col gap-2.5">
        <input
          className={inputClass}
          placeholder="Název (např. Notion)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
        />

        {mode === 'remote' ? (
          <>
            <input
              className={inputClass}
              placeholder="https://mcp.priklad.com/mcp"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
            <div className="flex items-center gap-2">
              <span className="text-[12px] text-beyond-faint">Přenos:</span>
              <div className="inline-flex rounded-full bg-beyond-ink/[0.04] p-0.5">
                <TypeTab active={transport === 'http'} onClick={() => setTransport('http')} label="HTTP" />
                <TypeTab active={transport === 'sse'} onClick={() => setTransport('sse')} label="SSE" />
              </div>
            </div>

            <button
              type="button"
              onClick={() => setAdvanced(!advanced)}
              className="inline-flex items-center gap-1 self-start text-[12px] text-beyond-faint transition-colors hover:text-beyond-dim"
            >
              <ChevronDown
                className={`h-[13px] w-[13px] transition-transform ${advanced ? 'rotate-180' : ''}`}
                strokeWidth={1.8}
              />
              Pokročilé
            </button>
            {advanced && (
              <div className="rounded-xl bg-beyond-ink/[0.02] p-3">
                <label className="mb-1 block text-[11.5px] text-beyond-faint">
                  Autorizační token (Bearer) — jen když server nepoužívá OAuth
                </label>
                <input
                  className={inputClass}
                  placeholder="sk-… / token"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                />
                <p className="mt-1.5 flex items-start gap-1 text-[11px] text-beyond-faint">
                  <ShieldCheck className="mt-0.5 h-[12px] w-[12px] flex-shrink-0" strokeWidth={1.8} />
                  Když necháš prázdné, OAuth se rozpozná automaticky a nabídne „Připojit".
                </p>
              </div>
            )}
          </>
        ) : (
          <>
            <input
              className={inputClass}
              placeholder="Příkaz (např. npx)"
              value={command}
              onChange={(e) => setCommand(e.target.value)}
            />
            <input
              className={inputClass}
              placeholder="Argumenty (mezerou oddělené) — např. -y @modelcontextprotocol/server-everything"
              value={argsStr}
              onChange={(e) => setArgsStr(e.target.value)}
            />
          </>
        )}

        {formError && <p className="text-[12.5px] text-red-600">⚠ {formError}</p>}

        <div className="mt-1 flex items-center gap-2">
          <button
            type="button"
            onClick={onSubmit}
            disabled={submitting}
            className="inline-flex items-center gap-2 bb-btn-primary rounded-full px-4 py-2 text-[13px] font-medium disabled:opacity-50"
          >
            {submitting && <Loader2 className="h-[14px] w-[14px] animate-spin" strokeWidth={2} />}
            Přidat
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-full px-4 py-2 text-[13px] text-beyond-dim transition-colors hover:bg-beyond-ink/[0.04]"
          >
            Zrušit
          </button>
        </div>
      </div>
    </div>
  );
}

function TypeTab({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon?: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-medium transition-colors ${
        active ? 'bb-seg-active' : 'text-beyond-faint hover:text-beyond-dim'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Connector row
// ---------------------------------------------------------------------------
function ConnectorRow({
  connector: c,
  busy,
  onConnect,
  manual,
  onApply,
  onTest,
  onToggle,
  onRemove,
}: {
  connector: Connector;
  busy: boolean;
  onConnect: () => void;
  manual: { redirectUri: string; url: string; setUrl: (v: string) => void; onFinish: () => void; onCancel: () => void } | null;
  onApply: () => void;
  onTest: () => void;
  onToggle: () => void;
  onRemove: () => void;
}) {
  const isRemote = c.transport !== 'stdio';
  const needsConnect =
    c.auth === 'oauth' && (c.status === 'needs_auth' || c.status === 'error' || !c.oauth?.connected);

  return (
    <li className="rounded-2xl border border-beyond-line px-4 py-3">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-beyond-ink/[0.04] text-beyond-dim">
          {isRemote ? (
            <Globe className="h-[15px] w-[15px]" strokeWidth={1.8} />
          ) : (
            <Terminal className="h-[15px] w-[15px]" strokeWidth={1.8} />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[14px] font-medium text-beyond-ink">{c.name}</span>
            <StatusPill connector={c} />
          </div>
          <p className="mt-0.5 truncate text-[12px] text-beyond-faint">
            {isRemote ? c.url : `${c.command} ${c.args.join(' ')}`.trim()}
          </p>
          {c.status === 'error' && c.lastError && (
            <p className="mt-1 flex items-start gap-1 text-[11.5px] text-red-500">
              <AlertTriangle className="mt-0.5 h-[12px] w-[12px] flex-shrink-0" strokeWidth={1.8} />
              {c.lastError}
            </p>
          )}
        </div>
        {busy && <Loader2 className="mt-1 h-4 w-4 flex-shrink-0 animate-spin text-beyond-faint" strokeWidth={1.8} />}
      </div>

      {manual && (
        <div className="mt-3 flex flex-col gap-2 rounded-xl bg-beyond-ink/[0.04] px-3 py-3 pl-3 text-[12.5px] text-beyond-dim">
          <p className="text-beyond-ink">
            Tenhle server nedovolí přesměrování na naši adresu, jen na <span className="font-mono">{manual.redirectUri}</span>.
            Přihlaš se v otevřeném okně; skončí na stránce, která nejde načíst. Zkopíruj celou adresu z jeho adresního řádku a vlož ji sem.
          </p>
          <input
            id={`bb-oauth-finish-${c.id}`}
            type="url"
            value={manual.url}
            onChange={(e) => manual.setUrl(e.target.value)}
            placeholder={`${manual.redirectUri}?code=…&state=…`}
            className="w-full rounded-lg border border-beyond-line bg-beyond-paper px-3 py-2 font-mono text-[12px] text-beyond-ink"
          />
          <div className="flex gap-1.5">
            <RowAction onClick={manual.onFinish} disabled={busy || !manual.url.trim()} primary>Dokončit</RowAction>
            <RowAction onClick={manual.onCancel} disabled={busy}>Zrušit</RowAction>
          </div>
        </div>
      )}

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5 pl-11">
        {needsConnect && (
          <RowAction onClick={onConnect} disabled={busy} primary>
            <RefreshCw className="h-[12px] w-[12px]" strokeWidth={2} />
            {c.oauth?.connected ? 'Znovu připojit' : 'Připojit'}
          </RowAction>
        )}
        {c.auth === 'oauth' && c.oauth?.connected && c.status === 'connected' && (
          <RowAction onClick={onConnect} disabled={busy}>
            <RefreshCw className="h-[12px] w-[12px]" strokeWidth={1.8} />
            Znovu připojit
          </RowAction>
        )}
        {c.enabled && (
          <RowAction onClick={onApply} disabled={busy}>
            <Zap className="h-[12px] w-[12px]" strokeWidth={1.8} />
            Použít v tomto chatu
          </RowAction>
        )}
        {isRemote && (
          <RowAction onClick={onTest} disabled={busy}>
            <Check className="h-[12px] w-[12px]" strokeWidth={1.8} />
            Test
          </RowAction>
        )}
        <RowAction onClick={onToggle} disabled={busy}>
          {c.enabled ? 'Vypnout' : 'Zapnout'}
        </RowAction>
        <RowAction onClick={onRemove} disabled={busy} danger>
          <Trash2 className="h-[12px] w-[12px]" strokeWidth={1.8} />
          Odebrat
        </RowAction>
      </div>
    </li>
  );
}

function RowAction({
  onClick,
  disabled,
  primary,
  danger,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
  danger?: boolean;
  children: React.ReactNode;
}) {
  const base =
    'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11.5px] font-medium transition-colors disabled:opacity-50';
  const tone = primary
    ? 'bb-btn-primary'
    : danger
      ? 'text-red-500 hover:bg-red-50'
      : 'bg-beyond-ink/[0.04] text-beyond-dim hover:bg-beyond-ink/[0.08]';
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={`${base} ${tone}`}>
      {children}
    </button>
  );
}
