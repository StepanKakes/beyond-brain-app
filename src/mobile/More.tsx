import { useEffect, useMemo, useState } from 'react';
import { Button, SegmentedControl, Switch } from 'glisse';

import { UKAZKA, api, fetchBlobUrl, setToken } from './api';
import { Icon } from './icons';
import { disablePush, enablePush, pushStatus, sendTestPush, type PushStatus } from './push';
import { back, navigate } from './router';
import { clearCache, refresh, useResource } from './store';
import { PROPOSALS_KEY, PROPOSALS_PATH } from './TaskDetail';
import { TASKS_KEY, TASKS_PATH, meKey } from './Today';
import type { Counts, KpiMetric, KpiPeriod, KpiResponse, MozekItem, ObsahItem, ProposalsResponse, TasksResponse } from './types';
import { Empty, LinkRow, Markdown, Picker, PushedBar, Section, Sheet, Skeleton, TabScreen, toast } from './ui';

const VELIN = '/api/beyond/velin';

const PUSH_HINT: Partial<Record<PushStatus, string>> = {
  unsupported: 'Tenhle prohlížeč notifikace neumí',
  denied: 'Notifikace jsou zakázané. Povol je v Nastavení iPhonu u téhle appky',
};

const THEMES = [
  { value: 'auto', label: 'Podle systému' },
  { value: 'light', label: 'Světlý' },
  { value: 'dark', label: 'Tmavý' },
];

function readTheme(): string {
  try {
    return localStorage.getItem('theme') || 'auto';
  } catch {
    return 'auto';
  }
}

export function MoreScreen() {
  const [status, setStatus] = useState<PushStatus>('off');
  const [busy, setBusy] = useState(false);
  const [theme, setTheme] = useState(readTheme);
  const [pickingTheme, setPickingTheme] = useState(false);
  const counts = useResource<Counts>('pocty', `${VELIN}/pocty`);
  const tasks = useResource<TasksResponse>(TASKS_KEY, TASKS_PATH);
  const me = tasks.data?.people.find((p) => p.key === meKey(tasks.data));

  useEffect(() => {
    void pushStatus().then(setStatus);
  }, []);

  const toggle = async (on: boolean) => {
    setBusy(true);
    try {
      if (on) {
        await enablePush();
        setStatus('on');
      } else {
        await disablePush();
        setStatus('off');
      }
    } catch (error) {
      toast((error as Error).message);
      setStatus(await pushStatus());
    }
    setBusy(false);
  };

  const applyTheme = (value: string) => {
    setTheme(value);
    try {
      if (value === 'auto') localStorage.removeItem('theme');
      else localStorage.setItem('theme', value);
    } catch {
      /* motiv platí aspoň do zavření */
    }
    window.dispatchEvent(new Event('m-theme'));
  };

  const badge = (count?: number) => (count ? <span className="m-count">{count}</span> : undefined);

  return (
    <TabScreen title="Více">
      <Section title="Práce">
        <LinkRow icon="letter" title="Návrhy ke schválení" value={badge(counts.data?.navrhy)} onClick={() => navigate('/m/navrhy')} />
        <LinkRow icon="film" title="Obsah" value={badge(counts.data?.obsah)} onClick={() => navigate('/m/obsah')} />
        <LinkRow icon="chart" title="KPI" onClick={() => navigate('/m/kpi')} />
        <LinkRow icon="clock" title="Rutiny" onClick={() => navigate('/m/rutiny')} />
        <LinkRow icon="folder" title="Soubory" onClick={() => navigate('/m/soubory')} />
      </Section>
      <Section title="Nastavení">
        <div className="m-row m-row-setting">
          <span className="m-link-icon">
            <Icon name="bell" size={22} />
          </span>
          <span className="m-row-title">Notifikace</span>
          <Switch
            aria-label="Notifikace na tenhle telefon"
            checked={status === 'on'}
            disabled={busy || (status !== 'on' && status !== 'off')}
            onCheckedChange={(on) => void toggle(on)}
          />
        </div>
        {PUSH_HINT[status] ? <p className="m-hint">{PUSH_HINT[status]}</p> : null}
        {status === 'needs-install' ? (
          <LinkRow
            title="Přidat appku na plochu"
            sub="Notifikace fungují jen z appky na ploše"
            onClick={() => window.location.assign('/instalace')}
          />
        ) : null}
        {status === 'on' ? (
          <LinkRow
            title="Poslat zkušební notifikaci"
            onClick={() =>
              void sendTestPush()
                .then(() => toast('Za chvíli dorazí, klepnutí otevře Hovory'))
                .catch((error: Error) => toast(error.message))
            }
          />
        ) : null}
        <LinkRow
          icon="moon"
          title="Vzhled"
          value={THEMES.find((t) => t.value === theme)?.label}
          onClick={() => setPickingTheme(true)}
        />
      </Section>
      <Section title={me ? `Účet: ${me.displayName}` : 'Účet'}>
        <LinkRow
          icon="monitor"
          title="Plná verze"
          sub="Správa agenta, konektorů a týmu"
          href="/?desktop=1"
        />
        {!UKAZKA ? (
          <LinkRow
            title="Odhlásit se"
            danger
            onClick={() => {
              clearCache();
              setToken(null);
            }}
          />
        ) : null}
      </Section>
      {pickingTheme ? (
        <Picker
          title="Vzhled"
          value={theme}
          options={THEMES}
          onPick={applyTheme}
          onClose={() => setPickingTheme(false)}
        />
      ) : null}
    </TabScreen>
  );
}

function MozekSheet({ item, onClose, onDone }: { item: MozekItem; onClose: () => void; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const act = async (verb: 'schvalit' | 'zahodit') => {
    setBusy(true);
    try {
      await api(`${VELIN}/agent/mozek/${item.id}/${verb}`, { method: 'POST' });
      onDone();
      onClose();
    } catch (error) {
      toast((error as Error).message);
      setBusy(false);
    }
  };
  return (
    <Sheet title={item.title || 'Změna paměti'} onClose={onClose}>
      {item.reason ? <p className="m-detail-note">{item.reason}</p> : null}
      {item.before ? (
        <>
          <p className="m-detail-label">Teď</p>
          <pre className="m-pre is-before">{item.before}</pre>
        </>
      ) : null}
      <p className="m-detail-label">Nově</p>
      <pre className="m-pre">{item.after}</pre>
      <div className="m-sheet-actions">
        <Button destructive disabled={busy} onClick={() => void act('zahodit')}>
          Zahodit
        </Button>
        <Button variant="filled" disabled={busy} onClick={() => void act('schvalit')}>
          Schválit
        </Button>
      </div>
    </Sheet>
  );
}

const STATUS_LABEL: Record<string, string> = {
  sent: 'Odesláno',
  rejected: 'Zahozeno',
  failed: 'Selhalo',
  expired: 'Propadlo',
};

export function ProposalsScreen() {
  const { data, error } = useResource<ProposalsResponse>(PROPOSALS_KEY, PROPOSALS_PATH);
  const mozek = useResource<{ items: MozekItem[] }>('mozek', `${VELIN}/agent/mozek`);
  const [open, setOpen] = useState<MozekItem | null>(null);
  const pending = data?.pending || [];
  const memory = mozek.data?.items || [];
  return (
    <>
      <PushedBar title="Návrhy" />
      <div className="m-scroll m-pushed-list">
        {!data && !error ? <Skeleton /> : null}
        {!data && error ? <Empty title="Návrhy se nenačetly">{error}</Empty> : null}
        {data && !pending.length && !memory.length ? (
          <Empty title="Nic nečeká">Nové návrhy se objeví tady a přijde na ně notifikace</Empty>
        ) : null}
        {pending.length ? (
          <Section title="Zprávy">
            {pending.map((proposal) => (
              <LinkRow
                key={proposal.id}
                title={proposal.clientName || proposal.target || 'Příjemce neznámý'}
                sub={proposal.body}
                onClick={() => navigate(`/m/ukol/navrh:${proposal.id}`)}
              />
            ))}
          </Section>
        ) : null}
        {memory.length ? (
          <Section title="Změny paměti">
            {memory.map((item) => (
              <LinkRow key={item.id} title={item.title || item.path || 'Změna paměti'} sub={item.reason} onClick={() => setOpen(item)} />
            ))}
          </Section>
        ) : null}
        {data?.recent.length ? (
          <Section title="Nedávno">
            {data.recent.slice(0, 15).map((proposal) => (
              <LinkRow
                key={proposal.id}
                title={proposal.clientName || proposal.target || 'Příjemce neznámý'}
                sub={STATUS_LABEL[proposal.status] || proposal.status}
                onClick={() => navigate(`/m/ukol/navrh:${proposal.id}`)}
              />
            ))}
          </Section>
        ) : null}
      </div>
      {open ? (
        <MozekSheet
          item={open}
          onClose={() => setOpen(null)}
          onDone={() => {
            void refresh('mozek', `${VELIN}/agent/mozek`);
            void refresh(TASKS_KEY, TASKS_PATH);
          }}
        />
      ) : null}
    </>
  );
}

const OBSAH_KEY = 'obsah';
const OBSAH_PATH = `${VELIN}/obsah`;
const OBSAH_STATES: { state: ObsahItem['state']; label: string }[] = [
  { state: 'navrh', label: 'Návrhy' },
  { state: 'schvaleno', label: 'Schváleno' },
  { state: 'natoceno', label: 'Natočeno' },
  { state: 'zverejneno', label: 'Zveřejněno' },
];

export function ObsahScreen() {
  const { data, error } = useResource<{ items: ObsahItem[] }>(OBSAH_KEY, OBSAH_PATH);
  const [showBin, setShowBin] = useState(false);
  const items = data?.items || [];
  const bin = items.filter((i) => i.state === 'zahozeno');
  const row = (item: ObsahItem) => (
    <LinkRow
      key={item.id}
      title={item.title || item.hook || 'Bez názvu'}
      sub={[item.kind === 'reel' ? 'Reel' : 'Story', item.client].filter(Boolean).join(' · ')}
      onClick={() => navigate(`/m/obsah/${encodeURIComponent(item.id)}`)}
    />
  );
  return (
    <>
      <PushedBar title="Obsah" />
      <div className="m-scroll m-pushed-list">
        {!data && !error ? <Skeleton /> : null}
        {!data && error ? <Empty title="Obsah se nenačetl">{error}</Empty> : null}
        {data && !items.length ? <Empty title="Zatím žádný obsah">Nápady z hovorů se objeví tady</Empty> : null}
        {OBSAH_STATES.map(({ state, label }) => {
          const list = items.filter((i) => i.state === state);
          return list.length ? (
            <Section key={state} title={`${label} (${list.length})`}>
              {list.map(row)}
            </Section>
          ) : null;
        })}
        {bin.length ? (
          <button type="button" className="m-disclosure" onClick={() => setShowBin((v) => !v)}>
            {showBin ? 'Skrýt zahozené' : `Zahozené (${bin.length})`}
          </button>
        ) : null}
        {showBin && bin.length ? <Section>{bin.map(row)}</Section> : null}
      </div>
    </>
  );
}

const NEXT_STATE: Partial<Record<ObsahItem['state'], { state: ObsahItem['state']; label: string }>> = {
  navrh: { state: 'schvaleno', label: 'Schválit' },
  schvaleno: { state: 'natoceno', label: 'Natočeno' },
  natoceno: { state: 'zverejneno', label: 'Zveřejněno' },
  zahozeno: { state: 'navrh', label: 'Vrátit mezi návrhy' },
};

export function ObsahDetailScreen({ id }: { id: string }) {
  const { data } = useResource<{ items: ObsahItem[] }>(OBSAH_KEY, OBSAH_PATH);
  const item = data?.items.find((i) => i.id === id);
  const [clip, setClip] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [why, setWhy] = useState('');

  const clipReady = item?.clip?.status === 'ready';
  useEffect(() => {
    if (!clipReady) return undefined;
    let url: string | null = null;
    let live = true;
    fetchBlobUrl(`${OBSAH_PATH}/${encodeURIComponent(id)}/clip`)
      .then((value) => {
        url = value;
        if (live) setClip(value);
      })
      .catch(() => undefined);
    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [clipReady, id]);

  const patch = async (body: Record<string, unknown>) => {
    setBusy(true);
    try {
      await api(`${OBSAH_PATH}/${encodeURIComponent(id)}`, { method: 'PATCH', body });
      await Promise.all([refresh(OBSAH_KEY, OBSAH_PATH), refresh(TASKS_KEY, TASKS_PATH)]);
      setDiscarding(false);
    } catch (error) {
      toast((error as Error).message);
    }
    setBusy(false);
  };

  if (!item) {
    return (
      <>
        <PushedBar title="Obsah" />
        <div className="m-scroll m-detail">{data ? <Empty title="Tenhle kus už tu není" /> : null}</div>
      </>
    );
  }

  const next = NEXT_STATE[item.state];
  const renders = item.studio?.renders || [];
  return (
    <>
      <PushedBar title={item.kind === 'reel' ? 'Reel' : 'Story'} />
      <div className="m-scroll m-detail">
        <h2 className="m-detail-title">{item.title || item.hook || 'Bez názvu'}</h2>
        {clip ? <video className="m-media" src={clip} controls playsInline /> : null}
        {item.clip?.status === 'cutting' ? <p className="m-detail-note">Klip se stříhá</p> : null}
        {item.clip?.error ? <p className="m-detail-note is-error">{item.clip.error}</p> : null}
        {renders.length ? (
          <div className="m-media-row">
            {renders.map((src, index) => (
              <img key={src} src={src} alt={`Slide ${index + 1}`} loading="lazy" />
            ))}
          </div>
        ) : null}
        {item.hook && item.title ? (
          <>
            <p className="m-detail-label">Háček</p>
            <p>{item.hook}</p>
          </>
        ) : null}
        {item.why ? (
          <>
            <p className="m-detail-label">Proč</p>
            <p className="m-detail-note">{item.why}</p>
          </>
        ) : null}
        {item.quote ? (
          <>
            <p className="m-detail-label">{item.speaker ? `Citace: ${item.speaker}` : 'Citace'}</p>
            <div className="m-bubble-preview">{item.quote}</div>
          </>
        ) : null}
        {item.text ? <Markdown text={item.text} /> : null}
        {item.caption ? (
          <>
            <p className="m-detail-label">Popisek</p>
            <div className="m-bubble-preview">{item.caption}</div>
          </>
        ) : null}
        {item.studio?.url ? (
          <a className="m-pill" href={item.studio.url} target="_blank" rel="noreferrer">
            <Icon name="link" size={15} />
            <span>Otevřít ve Story Studiu</span>
          </a>
        ) : null}
      </div>
      <footer className="m-actions">
        {item.state !== 'zahozeno' && item.state !== 'zverejneno' ? (
          <Button destructive disabled={busy} onClick={() => setDiscarding(true)}>
            Zahodit
          </Button>
        ) : null}
        {next ? (
          <Button variant="filled" disabled={busy} onClick={() => void patch({ state: next.state })}>
            {next.label}
          </Button>
        ) : null}
      </footer>
      {discarding ? (
        <Sheet title="Zahodit" onClose={() => setDiscarding(false)}>
          <input
            className="m-input"
            autoFocus
            value={why}
            onChange={(event) => setWhy(event.target.value)}
            placeholder="Proč, ať se to příště nevrací"
            aria-label="Důvod"
          />
          <div className="m-sheet-actions">
            <Button
              destructive
              disabled={busy}
              onClick={() =>
                void patch({ state: 'zahozeno', ...(why.trim() ? { note: `zahozeno: ${why.trim()}` } : {}) }).then(() => back())
              }
            >
              Zahodit
            </Button>
          </div>
        </Sheet>
      ) : null}
    </>
  );
}

function formatKpi(value: number | null | undefined, unit: KpiMetric['unit']): string {
  if (value === null || value === undefined) return 'Chybí';
  if (unit === 'pct') return `${Math.round(value)} %`;
  if (unit === 'czk') return `${Math.round(value).toLocaleString('cs-CZ')} Kč`;
  return Math.round(value * 10) % 10 === 0 ? Math.round(value).toLocaleString('cs-CZ') : value.toLocaleString('cs-CZ');
}

const AREA_LABEL: Record<string, string> = {
  akvizice: 'Akvizice',
  cally: 'Hovory',
  trzby: 'Tržby',
  reklama: 'Reklama',
  obsah: 'Obsah',
};

function kpiTone(metric: KpiMetric, period: KpiPeriod): string {
  const value = period.values[metric.key];
  const target = period.targets[metric.key];
  if (value === null || value === undefined || !target) return '';
  const ok = metric.dir === 'max' ? value >= target : value <= target;
  return ok ? 'is-good' : 'is-bad';
}

export function KpiScreen() {
  const { data, error } = useResource<KpiResponse>('kpi', `${VELIN}/kpi`);
  const [mode, setMode] = useState<'tyden' | 'mesic'>('tyden');
  const [offset, setOffset] = useState(0);

  const periods = useMemo<(KpiPeriod & { label: string })[]>(() => {
    if (!data) return [];
    if (mode === 'tyden') {
      return data.weeks
        .filter((w) => w.status !== 'future')
        .map((w) => ({
          ...w,
          label: `${new Date(w.from).toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric' })} až ${new Date(w.to).toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric' })}`,
        }))
        .reverse();
    }
    return data.months
      .map((m) => ({ ...m, label: new Date(`${m.month}-15`).toLocaleDateString('cs-CZ', { month: 'long', year: 'numeric' }) }))
      .reverse();
  }, [data, mode]);

  const period = periods[Math.min(offset, Math.max(0, periods.length - 1))];
  const areas = useMemo(() => [...new Set((data?.metrics || []).map((m) => m.area))], [data]);

  return (
    <>
      <PushedBar title="KPI" />
      <div className="m-scroll m-pushed-list">
        <div className="m-scope m-scope-2">
          <SegmentedControl
            aria-label="Období"
            value={mode}
            onValueChange={(value) => {
              setMode(value as 'tyden' | 'mesic');
              setOffset(0);
            }}
            items={[
              { value: 'tyden', label: 'Týden' },
              { value: 'mesic', label: 'Měsíc' },
            ]}
          />
        </div>
        {!data && !error ? <Skeleton rows={6} /> : null}
        {!data && error ? <Empty title="KPI se nenačetla">{error}</Empty> : null}
        {data && !period ? <Empty title="Zatím žádná čísla" /> : null}
        {period ? (
          <div className="m-period">
            <button
              type="button"
              className="m-icon-btn"
              aria-label="Starší období"
              disabled={offset >= periods.length - 1}
              onClick={() => setOffset((v) => v + 1)}
            >
              <Icon name="back" size={20} />
            </button>
            <strong>{period.label}</strong>
            <button
              type="button"
              className="m-icon-btn m-flip"
              aria-label="Novější období"
              disabled={offset === 0}
              onClick={() => setOffset((v) => Math.max(0, v - 1))}
            >
              <Icon name="back" size={20} />
            </button>
          </div>
        ) : null}
        {period
          ? areas.map((area) => (
              <Section key={area} title={AREA_LABEL[area] || area}>
                {(data?.metrics || [])
                  .filter((metric) => metric.area === area)
                  .map((metric) => (
                    <div className="m-row m-kpi" key={metric.key}>
                      <span className="m-row-title">{metric.label}</span>
                      <span className="m-kpi-numbers">
                        <span className={`m-kpi-value ${kpiTone(metric, period)}`}>{formatKpi(period.values[metric.key], metric.unit)}</span>
                        {period.targets[metric.key] ? <small>cíl {formatKpi(period.targets[metric.key], metric.unit)}</small> : null}
                      </span>
                    </div>
                  ))}
              </Section>
            ))
          : null}
      </div>
    </>
  );
}

type TreeNode = { type: 'dir' | 'file'; name: string; path: string; children?: TreeNode[] };

function findNode(nodes: TreeNode[], path: string): TreeNode | null {
  for (const node of nodes) {
    if (node.path === path) return node;
    if (node.children) {
      const found = findNode(node.children, path);
      if (found) return found;
    }
  }
  return null;
}

function FileBody({ path }: { path: string }) {
  const [text, setText] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    api<{ content?: string; text?: string; binary?: boolean; encoding?: string }>(`/api/beyond/file?path=${encodeURIComponent(path)}`)
      .then((file) => {
        if (!live) return;
        if (file.encoding === 'base64' || file.binary) setProblem('Tenhle soubor se dá otevřít jen v plné verzi');
        else setText(file.content ?? file.text ?? '');
      })
      .catch((error: Error) => {
        if (live) setProblem(error.message);
      });
    return () => {
      live = false;
    };
  }, [path]);
  if (problem) return <Empty title="Soubor se neotevřel">{problem}</Empty>;
  if (text === null) return <Skeleton />;
  if (/\.(md|markdown|txt)$/i.test(path)) return <Markdown text={text} />;
  return <pre className="m-pre">{text}</pre>;
}

export function FilesScreen({ path }: { path: string }) {
  const { data, error } = useResource<{ roots: TreeNode[] }>('soubory', '/api/beyond/files/tree');
  const roots = data?.roots;
  const node = path && roots ? findNode(roots, path) : null;
  const list = path ? node?.children : roots;
  const isFile = Boolean(path) && (!roots || !node || node.type === 'file');
  const name = path ? path.slice(path.lastIndexOf('/') + 1) : 'Soubory';

  return (
    <>
      <PushedBar title={name} />
      {isFile ? (
        <div className="m-scroll m-detail m-reading">
          <FileBody path={path} />
        </div>
      ) : (
        <div className="m-scroll m-pushed-list">
          {!data && !error ? <Skeleton rows={6} /> : null}
          {!data && error ? <Empty title="Soubory se nenačetly">{error}</Empty> : null}
          {list?.length ? (
            <Section>
              {list.map((child) => (
                <LinkRow
                  key={child.path}
                  icon={child.type === 'dir' ? 'folder' : 'doc'}
                  title={child.name}
                  onClick={() => navigate(`/m/soubory?p=${encodeURIComponent(child.path)}`)}
                />
              ))}
            </Section>
          ) : null}
        </div>
      )}
    </>
  );
}
