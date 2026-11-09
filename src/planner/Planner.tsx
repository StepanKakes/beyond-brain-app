import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type DragEvent,
  type ReactNode,
} from 'react';

import {
  NEEDS_DATE,
  PLANNER_PATH,
  STAV_TONE,
  isUrl,
  monthGrid,
  monthLabel,
  nextStav,
  platformLabel,
  shortDate,
  sortCards,
  todayIso,
  type PlannerCard,
  type PlannerOptions,
  type PlannerResponse,
  type Request,
} from './model';
import { InstagramPublikace } from './Instagram';
import './planner.css';

/**
 * Content planner. Jedna komponenta pro web i mobil, ať se obojí chová stejně:
 * stejné pohledy, stejná karta, stejná slova. Liší se jen to, co musí: na webu
 * jde karty tahat myší a detail je panel, na telefonu je detail spodní list.
 */

const MarkdownBody = lazy(() => import('../mobile/Markdown'));

export type PanelProps = { title?: string; onClose: () => void; children: ReactNode };

type View = 'board' | 'kalendar' | 'navrhy';
type Draft = { stav?: string; datum?: string; platforma?: string };

const CACHE_KEY = 'bb.planner';
const WEEKDAYS = ['Po', 'Út', 'St', 'Čt', 'Pá', 'So', 'Ne'];

function readCached(): PlannerResponse | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as PlannerResponse) : null;
  } catch {
    return null;
  }
}

function writeCached(value: PlannerResponse): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(value));
  } catch {
    /* cache je jen zrychlení */
  }
}

function Dot({ stav }: { stav: string }) {
  return <span className={`pl-dot pl-tone-${STAV_TONE[stav] || 'gray'}`} aria-hidden="true" />;
}

function Who({ names }: { names: string[] }) {
  if (!names.length) return null;
  return (
    <span className="pl-who" title={names.join(', ')}>
      {names.map((name) => (
        <span key={name} className="pl-who-face">
          {name[0]}
        </span>
      ))}
    </span>
  );
}

function CardTile({
  card,
  draggable,
  onOpen,
  onDragStart,
}: {
  card: PlannerCard;
  draggable: boolean;
  onOpen: () => void;
  onDragStart: (event: DragEvent) => void;
}) {
  const meta = [card.datum ? shortDate(card.datum) : null, platformLabel(card.platforma) || null, card.format].filter(Boolean);
  return (
    <button type="button" className="pl-card" draggable={draggable} onDragStart={onDragStart} onClick={onOpen}>
      <span className="pl-card-title">{card.nazev}</span>
      {meta.length || card.kdo.length ? (
        <span className="pl-card-meta">
          <span className="pl-card-sub">{meta.join(' · ')}</span>
          <Who names={card.kdo} />
        </span>
      ) : null}
    </button>
  );
}

function SelectField({
  label,
  value,
  options,
  format = (option: string) => option,
  allowEmpty = true,
  onChange,
}: {
  label: string;
  value: string | null;
  options: string[];
  format?: (option: string) => string;
  allowEmpty?: boolean;
  onChange: (value: string | null) => void;
}) {
  return (
    <label className="pl-field">
      <span className="pl-field-label">{label}</span>
      <select className="pl-field-input" value={value || ''} onChange={(event) => onChange(event.target.value || null)}>
        {allowEmpty ? <option value="">Nevybráno</option> : null}
        {options.map((option) => (
          <option key={option} value={option}>
            {format(option)}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Textové pole, které ukládá po odchodu, ať se server neptá při každém písmenu. */
function TextField({
  label,
  value,
  placeholder,
  onSave,
}: {
  label: string;
  value: string | null;
  placeholder: string;
  onSave: (value: string | null) => void;
}) {
  const [draft, setDraft] = useState(value || '');
  useEffect(() => setDraft(value || ''), [value]);
  return (
    <label className="pl-field">
      <span className="pl-field-label">{label}</span>
      <span className="pl-field-with-link">
        <input
          className="pl-field-input"
          value={draft}
          placeholder={placeholder}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => {
            if (draft.trim() !== (value || '')) onSave(draft.trim() || null);
          }}
        />
        {isUrl(value) ? (
          <a className="pl-link" href={value as string} target="_blank" rel="noreferrer">
            Otevřít
          </a>
        ) : null}
      </span>
    </label>
  );
}

function CardDetail({
  card,
  options,
  request,
  onPatch,
  onDelete,
}: {
  card: PlannerCard;
  options: PlannerOptions;
  request: Request;
  onPatch: (patch: Partial<PlannerCard>) => void;
  onDelete: () => void;
}) {
  const [title, setTitle] = useState(card.nazev);
  const [editing, setEditing] = useState(!card.text);
  const [text, setText] = useState(card.text);
  const area = useRef<HTMLTextAreaElement>(null);
  const next = nextStav(card.stav, options.stav);

  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.max(el.scrollHeight, 140)}px`;
  }, [text, editing]);

  const saveText = () => {
    if (text !== card.text) onPatch({ text });
  };

  return (
    <div className="pl-detail">
      <textarea
        className="pl-detail-title"
        aria-label="Název"
        rows={1}
        value={title}
        onChange={(event) => setTitle(event.target.value.replace(/\n/g, ' '))}
        onBlur={() => {
          const clean = title.trim();
          if (!clean) setTitle(card.nazev);
          else if (clean !== card.nazev) onPatch({ nazev: clean });
        }}
      />

      <div className="pl-detail-state">
        <span className="pl-stav">
          <Dot stav={card.stav} />
          {card.stav}
        </span>
        {next ? (
          <button type="button" className="pl-btn is-primary" onClick={() => onPatch({ stav: next })}>
            Posunout na {next}
          </button>
        ) : null}
      </div>

      <div className="pl-fields">
        <SelectField label="Stav" value={card.stav} options={options.stav} allowEmpty={false} onChange={(stav) => stav && onPatch({ stav })} />
        <label className="pl-field">
          <span className="pl-field-label">Datum publikace</span>
          <input
            className="pl-field-input"
            type="date"
            value={card.datum || ''}
            onChange={(event) => onPatch({ datum: event.target.value || null })}
          />
        </label>
        <SelectField label="Platforma" value={card.platforma} options={options.platforma} format={platformLabel} onChange={(platforma) => onPatch({ platforma })} />
        <SelectField label="Formát" value={card.format} options={options.format} onChange={(format) => onPatch({ format })} />
        <SelectField label="Cíl" value={card.cil} options={options.cil} onChange={(cil) => onPatch({ cil })} />
        <SelectField label="CTA" value={card.cta} options={options.cta} onChange={(cta) => onPatch({ cta })} />
        <SelectField label="Styl střihu" value={card.styl} options={options.styl} onChange={(styl) => onPatch({ styl })} />
        <div className="pl-field">
          <span className="pl-field-label">Kdo dělá</span>
          <span className="pl-people">
            {options.kdo.map((name) => {
              const on = card.kdo.includes(name);
              return (
                <button
                  key={name}
                  type="button"
                  className={`pl-pill${on ? ' is-on' : ''}`}
                  aria-pressed={on}
                  onClick={() => onPatch({ kdo: on ? card.kdo.filter((n) => n !== name) : [...card.kdo, name] })}
                >
                  {name}
                </button>
              );
            })}
          </span>
        </div>
        <TextField label="Místo" value={card.misto} placeholder="Kde se to točí" onSave={(misto) => onPatch({ misto })} />
        <TextField label="Review link" value={card.reviewLink} placeholder="Odkaz na střih" onSave={(reviewLink) => onPatch({ reviewLink })} />
        <TextField label="Soubor" value={card.soubor} placeholder="Např. C1577.MP4" onSave={(soubor) => onPatch({ soubor })} />
      </div>

      {card.platforma !== 'Youtube' ? <InstagramPublikace card={card} request={request} /> : null}

      <div className="pl-script-head">
        <h3>Skript a poznámky</h3>
        <button
          type="button"
          className="pl-btn"
          onClick={() => {
            if (editing) saveText();
            setEditing(!editing);
          }}
        >
          {editing ? 'Hotovo' : 'Upravit'}
        </button>
      </div>
      {editing ? (
        <textarea
          ref={area}
          className="pl-script-edit"
          value={text}
          placeholder="Stavba, skript, poznámky pro střih"
          onChange={(event) => setText(event.target.value)}
          onBlur={saveText}
        />
      ) : (
        <div className="pl-script">
          <Suspense fallback={<div className="pl-script-plain">{card.text}</div>}>
            <MarkdownBody text={card.text} />
          </Suspense>
        </div>
      )}

      <div className="pl-detail-foot">
        {card.notionUrl ? (
          <a className="pl-link" href={card.notionUrl} target="_blank" rel="noreferrer">
            Původní stránka v Notionu
          </a>
        ) : (
          <span />
        )}
        <button type="button" className="pl-btn is-danger" onClick={onDelete}>
          Smazat
        </button>
      </div>
    </div>
  );
}

function AddCard({ onAdd, onClose }: { onAdd: (nazev: string) => Promise<void>; onClose: () => void }) {
  const [nazev, setNazev] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="pl-add"
      onSubmit={(event) => {
        event.preventDefault();
        if (!nazev.trim() || busy) return;
        setBusy(true);
        onAdd(nazev.trim()).finally(() => setBusy(false));
      }}
    >
      <input
        className="pl-field-input pl-add-input"
        autoFocus
        aria-label="Název nápadu"
        placeholder="O čem to bude"
        value={nazev}
        onChange={(event) => setNazev(event.target.value)}
      />
      <div className="pl-add-actions">
        <button type="button" className="pl-btn" onClick={onClose}>
          Zrušit
        </button>
        <button type="submit" className="pl-btn is-primary" disabled={!nazev.trim() || busy}>
          Přidat
        </button>
      </div>
    </form>
  );
}

function Board({
  cards,
  options,
  draggable,
  onOpen,
  onAdd,
  onMove,
}: {
  cards: PlannerCard[];
  options: PlannerOptions;
  draggable: boolean;
  onOpen: (id: string) => void;
  onAdd: (draft: Draft) => void;
  onMove: (id: string, stav: string) => void;
}) {
  const [over, setOver] = useState<string | null>(null);
  return (
    <div className="pl-board">
      {options.stav.map((stav) => {
        const list = sortCards(cards.filter((card) => card.stav === stav), stav);
        return (
          <section
            key={stav}
            className={`pl-col${over === stav ? ' is-over' : ''}`}
            aria-label={stav}
            onDragOver={(event) => {
              event.preventDefault();
              setOver(stav);
            }}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node)) setOver(null);
            }}
            onDrop={(event) => {
              event.preventDefault();
              setOver(null);
              const id = event.dataTransfer.getData('text/plain');
              if (id) onMove(id, stav);
            }}
          >
            <header className="pl-col-head">
              <Dot stav={stav} />
              <span className="pl-col-name">{stav}</span>
              <span className="pl-col-count">{list.length}</span>
              <button type="button" className="pl-icon" aria-label={`Přidat do ${stav}`} onClick={() => onAdd({ stav })}>
                +
              </button>
            </header>
            <div className="pl-col-cards">
              {list.map((card) => (
                <CardTile
                  key={card.id}
                  card={card}
                  draggable={draggable}
                  onOpen={() => onOpen(card.id)}
                  onDragStart={(event) => event.dataTransfer.setData('text/plain', card.id)}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function CalendarView({
  cards,
  draggable,
  onOpen,
  onAdd,
  onSchedule,
}: {
  cards: PlannerCard[];
  draggable: boolean;
  onOpen: (id: string) => void;
  onAdd: (draft: Draft) => void;
  onSchedule: (id: string, datum: string) => void;
}) {
  const today = todayIso();
  const [cursor, setCursor] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });
  const [selected, setSelected] = useState(today);
  const [over, setOver] = useState<string | null>(null);

  const byDay = useMemo(() => {
    const map = new Map<string, PlannerCard[]>();
    for (const card of cards) {
      if (!card.datum) continue;
      map.set(card.datum, [...(map.get(card.datum) || []), card]);
    }
    return map;
  }, [cards]);

  const shift = (by: number) => {
    const date = new Date(cursor.year, cursor.month + by, 1);
    setCursor({ year: date.getFullYear(), month: date.getMonth() });
  };
  const waiting = cards.filter((card) => !card.datum && NEEDS_DATE.includes(card.stav));
  const dayCards = byDay.get(selected) || [];

  return (
    <div className="pl-cal">
      <div className="pl-cal-main">
        <div className="pl-cal-nav">
          <h2>{monthLabel(cursor.year, cursor.month)}</h2>
          <div className="pl-cal-buttons">
            <button type="button" className="pl-icon" aria-label="Předchozí měsíc" onClick={() => shift(-1)}>
              ‹
            </button>
            <button
              type="button"
              className="pl-btn"
              onClick={() => {
                const now = new Date();
                setCursor({ year: now.getFullYear(), month: now.getMonth() });
                setSelected(today);
              }}
            >
              Dnes
            </button>
            <button type="button" className="pl-icon" aria-label="Další měsíc" onClick={() => shift(1)}>
              ›
            </button>
          </div>
        </div>
        <div className="pl-cal-grid" role="grid">
          {WEEKDAYS.map((day) => (
            <div key={day} className="pl-cal-weekday">
              {day}
            </div>
          ))}
          {monthGrid(cursor.year, cursor.month).map((cell) => {
            const list = byDay.get(cell.iso) || [];
            const classes = [
              'pl-cal-cell',
              cell.inMonth ? '' : 'is-out',
              cell.iso === today ? 'is-today' : '',
              cell.iso === selected ? 'is-selected' : '',
              over === cell.iso ? 'is-over' : '',
            ];
            return (
              <div
                key={cell.iso}
                role="gridcell"
                className={classes.filter(Boolean).join(' ')}
                onClick={() => setSelected(cell.iso)}
                onDragOver={(event) => {
                  event.preventDefault();
                  setOver(cell.iso);
                }}
                onDragLeave={() => setOver(null)}
                onDrop={(event) => {
                  event.preventDefault();
                  setOver(null);
                  const id = event.dataTransfer.getData('text/plain');
                  if (id) onSchedule(id, cell.iso);
                }}
              >
                <button type="button" className="pl-cal-day" aria-label={`Vybrat ${cell.iso}`} onClick={() => setSelected(cell.iso)}>
                  {cell.day}
                </button>
                <div className="pl-cal-items">
                  {list.slice(0, 3).map((card) => (
                    <button
                      key={card.id}
                      type="button"
                      className="pl-cal-item"
                      title={card.nazev}
                      draggable={draggable}
                      onDragStart={(event) => event.dataTransfer.setData('text/plain', card.id)}
                      onClick={(event) => {
                        event.stopPropagation();
                        setSelected(cell.iso);
                        if (draggable) onOpen(card.id);
                      }}
                    >
                      <Dot stav={card.stav} />
                      <span>{card.nazev}</span>
                    </button>
                  ))}
                  {list.length > 3 ? <span className="pl-cal-more">+{list.length - 3}</span> : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <aside className="pl-cal-side">
        <div className="pl-side-group">
          <header className="pl-side-head">
            <h3>{selected === today ? 'Dnes' : shortDate(selected)}</h3>
            <button type="button" className="pl-icon" aria-label="Přidat na tento den" onClick={() => onAdd({ datum: selected })}>
              +
            </button>
          </header>
          {dayCards.length ? (
            dayCards.map((card) => (
              <CardTile key={card.id} card={card} draggable={draggable} onOpen={() => onOpen(card.id)} onDragStart={(event) => event.dataTransfer.setData('text/plain', card.id)} />
            ))
          ) : (
            <p className="pl-none">Na tento den nic nevychází</p>
          )}
        </div>
        {waiting.length ? (
          <div className="pl-side-group">
            <header className="pl-side-head">
              <h3>Čeká na datum</h3>
              <span className="pl-col-count">{waiting.length}</span>
            </header>
            {waiting.map((card) => (
              <CardTile key={card.id} card={card} draggable={draggable} onOpen={() => onOpen(card.id)} onDragStart={(event) => event.dataTransfer.setData('text/plain', card.id)} />
            ))}
          </div>
        ) : null}
      </aside>
    </div>
  );
}

export function Planner({
  request,
  draggable,
  Panel,
  proposals,
  proposalCount,
}: {
  request: Request;
  /** Tahání karet jen tam, kde je myš. Na telefonu by se pralo se scrollem. */
  draggable: boolean;
  /** Obal pro detail a přidání: panel na webu, spodní list na telefonu. */
  Panel: ComponentType<PanelProps>;
  proposals: ReactNode;
  proposalCount?: number;
}) {
  const [data, setData] = useState<PlannerResponse | null>(readCached);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>('board');
  const [platform, setPlatform] = useState<string | null>(null);
  const [person, setPerson] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [notice, setNotice] = useState<{ text: string; undo?: () => void } | null>(null);
  const [importing, setImporting] = useState(false);
  const saving = useRef(0);

  const load = useCallback(async () => {
    try {
      const fresh = await request<PlannerResponse>(PLANNER_PATH);
      setError(null);
      // Odpověď ze chvíle před uložením by přepsala to, co člověk právě změnil.
      if (saving.current > 0) return;
      setData(fresh);
      writeCached(fresh);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Planner se nenačetl');
    }
  }, [request]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, 30000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), notice.undo ? 6000 : 3200);
    return () => clearTimeout(timer);
  }, [notice]);

  const setCards = (change: (cards: PlannerCard[]) => PlannerCard[]) =>
    setData((current) => (current ? { ...current, karty: change(current.karty) } : current));

  const send = async (path: string, options: { method: string; body?: unknown }) => {
    saving.current += 1;
    try {
      return await request<{ ok: boolean; card?: PlannerCard }>(path, options);
    } catch (err) {
      setNotice({ text: err instanceof Error ? err.message : 'Uložení se nepovedlo' });
      saving.current -= 1;
      await load();
      saving.current += 1;
      throw err;
    } finally {
      saving.current -= 1;
    }
  };

  const patch = (id: string, change: Partial<PlannerCard>) => {
    setCards((cards) => cards.map((card) => (card.id === id ? { ...card, ...change } : card)));
    void send(`${PLANNER_PATH}/${encodeURIComponent(id)}`, { method: 'PATCH', body: change }).catch(() => undefined);
  };

  const remove = (card: PlannerCard) => {
    setOpenId(null);
    setCards((cards) => cards.filter((c) => c.id !== card.id));
    void send(`${PLANNER_PATH}/${encodeURIComponent(card.id)}`, { method: 'DELETE' })
      .then(() =>
        setNotice({
          text: 'Karta je smazaná',
          undo: () => {
            setCards((cards) => [card, ...cards]);
            void send(`${PLANNER_PATH}/${encodeURIComponent(card.id)}`, { method: 'PATCH', body: { smazano: false } }).catch(() => undefined);
          },
        }),
      )
      .catch(() => undefined);
  };

  const add = async (nazev: string) => {
    const body = {
      nazev,
      ...(platform ? { platforma: platform } : {}),
      ...(person ? { kdo: [person] } : {}),
      ...draft,
    };
    const res = await send(PLANNER_PATH, { method: 'POST', body }).catch(() => null);
    if (!res?.card) return;
    const card = res.card;
    setCards((cards) => [card, ...cards]);
    setDraft(null);
    setOpenId(card.id);
  };

  const pullFromNotion = async () => {
    setImporting(true);
    try {
      const res = await request<{ added: number }>(`${PLANNER_PATH}/z-notionu`, { method: 'POST' });
      setNotice({ text: res.added ? `Přibylo karet z Notionu: ${res.added}` : 'V Notionu není nic nového' });
      await load();
    } catch (err) {
      setNotice({ text: err instanceof Error ? err.message : 'Import z Notionu selhal' });
    } finally {
      setImporting(false);
    }
  };

  const cards = useMemo(
    () =>
      (data?.karty || []).filter(
        (card) => (!platform || card.platforma === platform) && (!person || card.kdo.includes(person)),
      ),
    [data, platform, person],
  );
  const open = data?.karty.find((card) => card.id === openId) || null;
  const options = data?.options;

  const tabs: { key: View; label: string; count?: number }[] = [
    { key: 'board', label: 'Board' },
    { key: 'kalendar', label: 'Kalendář' },
    { key: 'navrhy', label: 'Návrhy brainu', count: proposalCount },
  ];

  return (
    <div className="pl-root">
      <div className="pl-toolbar">
        <div className="pl-tabs" role="tablist">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={view === tab.key}
              className={`pl-tab${view === tab.key ? ' is-on' : ''}`}
              onClick={() => setView(tab.key)}
            >
              {tab.label}
              {tab.count ? <span className="pl-tab-count">{tab.count}</span> : null}
            </button>
          ))}
        </div>
        {view !== 'navrhy' && options ? (
          <button type="button" className="pl-btn is-primary pl-add-btn" onClick={() => setDraft({})}>
            Nový nápad
          </button>
        ) : null}
      </div>

      {view !== 'navrhy' && options ? (
        <div className="pl-filters">
          {options.platforma.map((value) => (
            <button
              key={value}
              type="button"
              className={`pl-pill${platform === value ? ' is-on' : ''}`}
              aria-pressed={platform === value}
              onClick={() => setPlatform(platform === value ? null : value)}
            >
              {platformLabel(value)}
            </button>
          ))}
          <span className="pl-filter-gap" aria-hidden="true" />
          {options.kdo.map((value) => (
            <button
              key={value}
              type="button"
              className={`pl-pill${person === value ? ' is-on' : ''}`}
              aria-pressed={person === value}
              onClick={() => setPerson(person === value ? null : value)}
            >
              {value}
            </button>
          ))}
          <span className="pl-filter-gap" aria-hidden="true" />
          <button type="button" className="pl-pill" disabled={importing} onClick={() => void pullFromNotion()}>
            {importing ? 'Načítám z Notionu' : 'Načíst nové z Notionu'}
          </button>
        </div>
      ) : null}

      {view === 'navrhy' ? (
        <div className="pl-proposals">{proposals}</div>
      ) : !data ? (
        <p className="pl-state">{error ? `Planner se nenačetl: ${error}` : 'Načítám planner'}</p>
      ) : !data.karty.length ? (
        <div className="pl-state">
          {data.notionImport?.error ? (
            <>
              <strong>Karty z Notionu se nenačetly</strong>
              <p>{data.notionImport.error}</p>
            </>
          ) : (
            <>
              <strong>Planner je zatím prázdný</strong>
              <p>Načti karty z Notionu nebo přidej první nápad</p>
            </>
          )}
          <button type="button" className="pl-btn" disabled={importing} onClick={() => void pullFromNotion()}>
            {importing ? 'Načítám, chvíli to trvá' : 'Načíst z Notionu'}
          </button>
        </div>
      ) : view === 'board' && options ? (
        <Board
          cards={cards}
          options={options}
          draggable={draggable}
          onOpen={setOpenId}
          onAdd={setDraft}
          onMove={(id, stav) => {
            if (data.karty.find((card) => card.id === id)?.stav !== stav) patch(id, { stav });
          }}
        />
      ) : (
        <CalendarView cards={cards} draggable={draggable} onOpen={setOpenId} onAdd={setDraft} onSchedule={(id, datum) => patch(id, { datum })} />
      )}

      {open && options ? (
        <Panel title="Karta" onClose={() => setOpenId(null)}>
          <CardDetail key={open.id} card={open} options={options} request={request} onPatch={(change) => patch(open.id, change)} onDelete={() => remove(open)} />
        </Panel>
      ) : null}

      {draft ? (
        <Panel title={draft.datum ? `Nový nápad na ${shortDate(draft.datum)}` : draft.stav ? `Nový nápad do ${draft.stav}` : 'Nový nápad'} onClose={() => setDraft(null)}>
          <AddCard onAdd={add} onClose={() => setDraft(null)} />
        </Panel>
      ) : null}

      {notice ? (
        <div className="pl-notice" role="status">
          <span>{notice.text}</span>
          {notice.undo ? (
            <button
              type="button"
              onClick={() => {
                notice.undo?.();
                setNotice(null);
              }}
            >
              Vrátit
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
