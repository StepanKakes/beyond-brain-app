import { useCallback, useMemo, useState } from 'react';

import { Empty, ago, usePolled } from './bits';
import { deleteObsah, fetchObsah, patchObsah, type ObsahItem } from './api';

/**
 * Beyond Brain — Obsah.
 *
 * The content line from proposal to publication, as columns: what the
 * brain found (moments from calls, stories it rendered), what we approved,
 * what is filmed, what is out. A reel card carries the seconds to cut and
 * the words said, with a link into the recording at that second; a story
 * card carries its rendered slides and a link into the Story Studio editor.
 */

const COLUMNS: { key: ObsahItem['state']; label: string }[] = [
  { key: 'navrh', label: 'Návrhy' },
  { key: 'schvaleno', label: 'Schváleno' },
  { key: 'natoceno', label: 'Natočeno' },
  { key: 'zverejneno', label: 'Zveřejněno' },
];

const NEXT: Partial<Record<ObsahItem['state'], { label: string; to: ObsahItem['state'] }>> = {
  navrh: { label: 'Schválit', to: 'schvaleno' },
  schvaleno: { label: 'Natočeno', to: 'natoceno' },
  natoceno: { label: 'Zveřejněno', to: 'zverejneno' },
};

function fmtSec(sec: number | null | undefined): string {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function fathomAt(item: ObsahItem): string | null {
  const f = item.source?.fathom;
  if (!f || item.startSec == null) return null;
  return `${f}${f.includes('?') ? '&' : '?'}timestamp=${Math.max(0, Math.floor(item.startSec) - 2)}`;
}

export default function ObsahPage({ onOpenStudio, onOpenClient }: { onOpenStudio: () => void; onOpenClient: (slug: string) => void }) {
  const load = useCallback(() => fetchObsah(), []);
  const data = usePolled<{ items: ObsahItem[] }>(load, 60_000);
  const [kind, setKind] = useState<'all' | 'reel' | 'story'>('all');
  const [open, setOpen] = useState<string | null>(null);
  const [showBin, setShowBin] = useState(false);

  const items = useMemo(() => (data.data?.items || []).filter((i) => kind === 'all' || i.kind === kind), [data.data, kind]);
  const byState = (st: ObsahItem['state']) => items.filter((i) => i.state === st);

  const move = async (item: ObsahItem, to: ObsahItem['state']) => {
    await patchObsah(item.id, { state: to, ...(to === 'zverejneno' ? { publishedAt: new Date().toISOString() } : {}) });
    void data.reload();
  };
  const remove = async (item: ObsahItem) => {
    if (!window.confirm('Smazat z osy? Nejde vrátit.')) return;
    await deleteObsah(item.id);
    void data.reload();
  };

  return (
    <div className="bb-vel">
      <div className="bb-vel__in bb-ob">
        <header className="bb-vel__head">
          <div>
            <h1 className="bb-vel__title">Obsah</h1>
            <p className="bb-vel__sub">Co brain našel v callech a připravil na stories, a co se s tím stalo</p>
          </div>
          <div className="bb-ob__tools">
            <div className="bb-fx__seg">
              <button type="button" className="bb-pill bb-pill--sm" aria-pressed={kind === 'all'} onClick={() => setKind('all')}>Vše</button>
              <button type="button" className="bb-pill bb-pill--sm" aria-pressed={kind === 'reel'} onClick={() => setKind('reel')}>Reely</button>
              <button type="button" className="bb-pill bb-pill--sm" aria-pressed={kind === 'story'} onClick={() => setKind('story')}>Stories</button>
            </div>
            <button type="button" className="bb-pill" onClick={onOpenStudio}>Story Studio</button>
          </div>
        </header>

        {data.error && <Empty>Nepovedlo se načíst: {data.error}</Empty>}

        <div className="bb-ob__board">
          {COLUMNS.map((col) => {
            const rows = byState(col.key);
            if (rows.length === 0 && col.key !== 'navrh') return null;
            return (
              <section key={col.key} className="bb-ob__col">
                <p className="bb-uk__h">{col.label}<span>{rows.length}</span></p>
                {rows.length === 0 && <p className="bb-ob__nothing">Nic. Po každém callu s přepisem sem brain dá momenty na reel, ráno návrh stories.</p>}
                {rows.map((item) => (
                  <Card
                    key={item.id}
                    item={item}
                    open={open === item.id}
                    onToggle={() => setOpen(open === item.id ? null : item.id)}
                    onMove={(to) => void move(item, to)}
                    onRemove={() => void remove(item)}
                    onOpenClient={onOpenClient}
                  />
                ))}
              </section>
            );
          })}
        </div>

        {byState('zahozeno').length > 0 && (
          <section>
            <button type="button" className="bb-uk__more" onClick={() => setShowBin((v) => !v)}>
              {showBin ? 'skrýt zahozené' : `zahozené (${byState('zahozeno').length})`}
            </button>
            {showBin && (
              <div className="bb-ob__bin">
                {byState('zahozeno').map((item) => (
                  <div key={item.id} className="bb-ob__binrow">
                    <span>{item.kind === 'reel' ? 'Reel' : 'Stories'} · {item.title || item.hook}</span>
                    <button type="button" className="bb-uk__x" onClick={() => void move(item, 'navrh')}>vrátit</button>
                    <button type="button" className="bb-uk__x" onClick={() => void remove(item)}>smazat</button>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}

function Card({ item, open, onToggle, onMove, onRemove, onOpenClient }: {
  item: ObsahItem;
  open: boolean;
  onToggle: () => void;
  onMove: (to: ObsahItem['state']) => void;
  onRemove: () => void;
  onOpenClient: (slug: string) => void;
}) {
  const isReel = item.kind === 'reel';
  const next = NEXT[item.state];
  const link = isReel ? fathomAt(item) : item.studio?.url || null;
  const renders = !isReel ? item.studio?.renders || [] : [];
  const [showText, setShowText] = useState(false);
  return (
    <article className={`bb-ob__card${open ? ' bb-ob__card--open' : ''}`} data-kind={item.kind}>
      <div className="bb-ob__top">
        <button type="button" className="bb-ob__head" onClick={onToggle} aria-expanded={open}>
          <span className="bb-ob__kind">{isReel ? 'Reel' : 'Stories'}</span>
          <span className="bb-ob__title">{item.title || item.hook}</span>
          <span className="bb-ob__meta">
            {isReel && item.startSec != null && <>{fmtSec(item.startSec)} až {fmtSec(item.endSec)}{item.speaker ? ` · ${item.speaker}` : ''}</>}
            {!isReel && item.slides?.length ? <>{item.slides.length} slidů</> : null}
            {item.client && <> · {item.client}</>}
            <> · {ago(item.createdAt)}</>
          </span>
          {!open && item.hook && item.title && <span className="bb-ob__peek">{item.hook}</span>}
          <span className="bb-ob__src">
            <span className="bb-ob__srcl">Zdroj</span>
            {item.zdroj || (isReel && item.source ? `call ${item.client || ''} ${item.source.date || ''}` : 'neuvedený')}
          </span>
        </button>
        <div className="bb-ob__side">
          {renders.length > 0 && (
            <div className="bb-ob__strip">
              {renders.map((src, i) => (
                <a key={src} href={src} target="_blank" rel="noreferrer" title={`Slide ${i + 1}, plná velikost`}><img src={src} alt={`Slide ${i + 1}`} loading="lazy" /></a>
              ))}
            </div>
          )}
          <div className="bb-ob__acts">
            {next && <button type="button" className="bb-pill bb-pill--sm bb-pill--primary" onClick={() => onMove(next.to)}>{next.label}</button>}
            {link && <a className="bb-pill bb-pill--sm" href={link} target="_blank" rel="noreferrer">{isReel ? 'Přehrát' : 'Upravit'}</a>}
            {item.state !== 'zahozeno' && <button type="button" className="bb-uk__x" onClick={() => onMove('zahozeno')}>zahodit</button>}
          </div>
        </div>
      </div>
      {open && (
        <div className="bb-ob__body">
          <div className="bb-ob__cols">
            <div className="bb-ob__main">
              {item.hook && item.title && <p className="bb-ob__hook">{item.hook}</p>}
              {isReel && item.quote && <blockquote className="bb-ob__quote">{item.quote}</blockquote>}
              {item.why && <p className="bb-ob__row"><b>Proč</b>{item.why}</p>}
              {isReel && item.broll && <p className="bb-ob__row"><b>B-roll a titulky</b>{item.broll}</p>}
              {item.caption && <p className="bb-ob__row"><b>Popisek</b>{item.caption}</p>}
              {item.note && <p className="bb-ob__row"><b>Poznámka</b>{item.note}</p>}
              {!isReel && item.slides?.length ? (
                <button type="button" className="bb-uk__more" style={{ padding: 0 }} onClick={() => setShowText((v) => !v)}>
                  {showText ? 'skrýt text slidů' : 'text slidů'}
                </button>
              ) : null}
              {!isReel && showText && item.slides?.length ? (
                <div className="bb-ob__slides">
                  {item.slides.map((sl, i) => (
                    <div key={i} className="bb-ob__slide"><span className="bb-ob__sn">{String(i + 1).padStart(2, '0')}</span><pre>{sl}</pre></div>
                  ))}
                </div>
              ) : null}
            </div>
            <div className="bb-ob__aside">
              {(item.zdrojSoubory?.length || item.source?.transcript) && (
                <div className="bb-ob__files">
                  <span className="bb-ob__srcl">Soubory</span>
                  {[...(item.zdrojSoubory || []), ...(item.source?.transcript && !(item.zdrojSoubory || []).includes(item.source.transcript) ? [item.source.transcript] : [])].map((f) => (
                    <button key={f} type="button" className="bb-ob__file" onClick={() => window.dispatchEvent(new CustomEvent('beyond:open-file', { detail: { path: f } }))} title={f}>{f.split('/').pop()}</button>
                  ))}
                </div>
              )}
              {item.client && <button type="button" className="bb-uk__x" onClick={() => onOpenClient(item.client!)}>otevřít klienta</button>}
              <button type="button" className="bb-uk__x" onClick={onRemove}>smazat z osy</button>
            </div>
          </div>
        </div>
      )}
    </article>
  );
}
