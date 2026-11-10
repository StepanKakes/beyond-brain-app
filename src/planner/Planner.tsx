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

import { Icon } from '../mobile/icons';

import { InstagramPublikace } from './Instagram';
import {
  FAZE,
  IG_PATH,
  NEEDS_DATE,
  PLANNER_PATH,
  STAV_TONE,
  casLabel,
  dalsiFaze,
  denLabel,
  fazeKarty,
  isUrl,
  kdyLabel,
  monthGrid,
  monthLabel,
  platformLabel,
  sortCards,
  stavProFazi,
  todayIso,
  type Faze,
  type IgPost,
  type PlannerCard,
  type PlannerOptions,
  type PlannerResponse,
  type Request,
} from './model';
import './planner.css';

/**
 * Content planner. Jedna komponenta pro web i mobil, ať se obojí chová stejně:
 * stejné pohledy, stejná karta, stejná slova. Liší se jen to, co musí: na webu
 * jde karty tahat myší a detail je panel, na telefonu je detail spodní list
 * a board se srovná pod sebe.
 */

const MarkdownBody = lazy(() => import('../mobile/Markdown'));

export type PanelProps = { title?: string; onClose: () => void; children: ReactNode };

type View = 'board' | 'kalendar' | 'navrhy';
type Draft = { stav?: string; datum?: string; platforma?: string };
type IgMap = Record<string, IgPost>;

const CACHE_KEY = 'bb.planner';
const WEEKDAYS = ['Po', 'Út', 'St', 'Čt', 'Pá', 'So', 'Ne'];
/** Vydaných přibývá pořád, na boardu stačí posledních pár. */
const VYDANO_NA_BOARDU = 6;

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

function Dot({ tone }: { tone: string }) {
  return <span className={`pl-dot pl-tone-${tone}`} aria-hidden="true" />;
}

const toneKarty = (stav: string) => STAV_TONE[stav] || 'gray';

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

/** Jedna řádka o Instagramu na kartě: kdy vyjde, nebo že vyšlo či ne. */
function IgRadek({ post }: { post: IgPost | undefined }) {
  if (!post || post.stav === 'zruseno') return null;
  if (post.stav === 'publikovano') {
    return (
      <span className="pl-ig-line is-done">
        <Icon name="check" size={13} />
        Vyšlo na IG
      </span>
    );
  }
  if (post.stav === 'chyba') {
    return (
      <span className="pl-ig-line is-bad">
        <Icon name="alert" size={13} />
        Nevyšlo na IG
      </span>
    );
  }
  return (
    <span className="pl-ig-line is-wait">
      <Icon name="clock" size={13} />
      IG {kdyLabel(post.naplanovano_na)} {casLabel(post.naplanovano_na)}
    </span>
  );
}

function CardTile({
  card,
  ig,
  draggable,
  onOpen,
  onDragStart,
}: {
  card: PlannerCard;
  ig?: IgPost;
  draggable: boolean;
  onOpen: () => void;
  onDragStart: (event: DragEvent) => void;
}) {
  const youtube = card.platforma === 'Youtube';
  return (
    <button type="button" className="pl-card" draggable={draggable} onDragStart={onDragStart} onClick={onOpen}>
      {card.stav === 'Opravit' ? <span className="pl-flag">Opravit</span> : null}
      <span className="pl-card-title">{card.nazev}</span>
      <IgRadek post={ig} />
      <span className="pl-card-meta">
        <span className="pl-card-tags">
          {card.platforma ? (
            <span className={`pl-tag${youtube ? ' is-yt' : ''}`}>
              <Icon name={youtube ? 'film' : 'video'} size={12} />
              {platformLabel(card.platforma)}
            </span>
          ) : null}
          {card.datum && !ig ? (
            <span className={`pl-tag${card.datum < todayIso() && card.stav !== 'Vydáno' ? ' is-late' : ''}`}>
              <Icon name="calendar" size={12} />
              {kdyLabel(card.datum)}
            </span>
          ) : null}
        </span>
        <Who names={card.kdo} />
      </span>
    </button>
  );
}

function SelectField({
  label,
  value,
  options,
  format = (option: string) => option,
  onChange,
}: {
  label: string;
  value: string | null;
  options: string[];
  format?: (option: string) => string;
  onChange: (value: string | null) => void;
}) {
  return (
    <label className="pl-field">
      <span className="pl-field-label">{label}</span>
      <span className="pl-select">
        <select className={`pl-field-input${value ? '' : ' is-empty'}`} value={value || ''} onChange={(event) => onChange(event.target.value || null)}>
          <option value="">Nevybráno</option>
          {options.map((option) => (
            <option key={option} value={option}>
              {format(option)}
            </option>
          ))}
        </select>
        <Icon name="down" size={14} />
      </span>
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

/**
 * Datum s českým popiskem. Prohlížeč by v poli ukázal svůj formát (často
 * americký), takže se nativní výběr schová pod čitelný text a otevře se klikem.
 */
function DateField({ label, value, onChange }: { label: string; value: string | null; onChange: (value: string | null) => void }) {
  return (
    <div className="pl-field">
      <span className="pl-field-label">{label}</span>
      <span className="pl-date">
        <span className={`pl-date-text${value ? '' : ' is-empty'}`}>
          <Icon name="calendar" size={15} />
          {value ? denLabel(value) : 'Bez data'}
        </span>
        <input type="date" aria-label={label} value={value || ''} onChange={(event) => onChange(event.target.value || null)} />
        {value ? (
          <button type="button" className="pl-textbtn" onClick={() => onChange(null)}>
            Zrušit datum
          </button>
        ) : null}
      </span>
    </div>
  );
}

/** Cesta karty. Klik na fázi ji tam pošle, ať jde i zpátky. */
function Stepper({ card, onStav }: { card: PlannerCard; onStav: (stav: string) => void }) {
  const current = fazeKarty(card.stav);
  const at = FAZE.findIndex((f) => f.key === current);
  const next = dalsiFaze(current);
  const opravit = card.stav === 'Opravit';
  return (
    <div className="pl-stepper">
      <ol className="pl-steps">
        {FAZE.map((faze, i) => {
          const state = i < at ? 'is-past' : i === at ? 'is-now' : '';
          return (
            <li key={faze.key} className={`pl-step ${state}${i === at && opravit ? ' is-bad' : ''}`}>
              <button type="button" aria-current={i === at ? 'step' : undefined} onClick={() => onStav(stavProFazi(faze.key, card))}>
                <span className="pl-step-mark">{i < at ? <Icon name="check" size={12} /> : null}</span>
                <span className="pl-step-label">{i === at && opravit ? 'Opravit' : faze.label}</span>
              </button>
            </li>
          );
        })}
      </ol>
      <div className="pl-stepper-actions">
        {next ? (
          <button type="button" className="pl-btn is-primary" onClick={() => onStav(stavProFazi(next, card))}>
            Posunout na {FAZE.find((f) => f.key === next)?.label}
          </button>
        ) : null}
        {current === 'review' && !opravit ? (
          <button type="button" className="pl-btn" onClick={() => onStav('Opravit')}>
            Vrátit k opravě
          </button>
        ) : null}
        {opravit ? (
          <button type="button" className="pl-btn" onClick={() => onStav('Review')}>
            Opraveno, znovu na review
          </button>
        ) : null}
      </div>
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="pl-section">
      <header className="pl-section-head">
        <h3>{title}</h3>
        {hint ? <p>{hint}</p> : null}
      </header>
      {children}
    </section>
  );
}

function CardDetail({
  card,
  options,
  request,
  ig,
  igError,
  onIg,
  onPatch,
  onDelete,
}: {
  card: PlannerCard;
  options: PlannerOptions;
  request: Request;
  ig: IgPost | null;
  igError: string | null;
  onIg: (post: IgPost | null) => void;
  onPatch: (patch: Partial<PlannerCard>) => void;
  onDelete: () => void;
}) {
  const [title, setTitle] = useState(card.nazev);
  const [editing, setEditing] = useState(!card.text);
  const [text, setText] = useState(card.text);
  const area = useRef<HTMLTextAreaElement>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    for (const el of [area.current, titleRef.current]) {
      if (!el) continue;
      el.style.height = 'auto';
      el.style.height = `${Math.max(el.scrollHeight, el === area.current ? 160 : 0)}px`;
    }
  }, [text, editing, title]);

  const saveText = () => {
    if (text !== card.text) onPatch({ text });
  };

  const youtube = card.platforma === 'Youtube';

  return (
    <div className="pl-detail">
      <textarea
        ref={titleRef}
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

      <Stepper card={card} onStav={(stav) => onPatch({ stav })} />

      <Section title="Vydání" hint={youtube ? undefined : 'Hotový střih nahraj sem, Beo ho v daný čas vydá na Instagram'}>
        <div className="pl-fields">
          <DateField label="Den vydání" value={card.datum} onChange={(datum) => onPatch({ datum })} />
          <label className="pl-field">
            <span className="pl-field-label">Platforma</span>
            <span className="pl-seg" role="radiogroup" aria-label="Platforma">
              {options.platforma.map((value) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={card.platforma === value}
                  className={card.platforma === value ? 'is-on' : ''}
                  onClick={() => onPatch({ platforma: value })}
                >
                  {platformLabel(value)}
                </button>
              ))}
            </span>
          </label>
        </div>
        {!youtube ? <InstagramPublikace card={card} request={request} post={ig} error={igError} onPost={onIg} /> : null}
      </Section>

      <Section title="Zadání">
        <div className="pl-fields">
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
                    className={`pl-chip${on ? ' is-on' : ''}`}
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
        </div>
      </Section>

      <Section title="Podklady">
        <div className="pl-fields">
          <TextField label="Review link" value={card.reviewLink} placeholder="Odkaz na střih ke kontrole" onSave={(reviewLink) => onPatch({ reviewLink })} />
          <TextField label="Surové klipy" value={card.soubor} placeholder="Např. C1577.MP4" onSave={(soubor) => onPatch({ soubor })} />
        </div>
      </Section>

      <section className="pl-section">
        <header className="pl-section-head is-row">
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
        </header>
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
      </section>

      <div className="pl-detail-foot">
        {card.notionUrl ? (
          <a className="pl-link" href={card.notionUrl} target="_blank" rel="noreferrer">
            Původní stránka v Notionu
          </a>
        ) : (
          <span />
        )}
        <button type="button" className="pl-btn is-danger" onClick={onDelete}>
          <Icon name="trash" size={15} />
          Smazat kartu
        </button>
      </div>
    </div>
  );
}

function AddCard({
  draft,
  options,
  onAdd,
  onClose,
}: {
  draft: Draft;
  options: PlannerOptions;
  onAdd: (nazev: string, platforma: string) => Promise<void>;
  onClose: () => void;
}) {
  const [nazev, setNazev] = useState('');
  const [platforma, setPlatforma] = useState(draft.platforma || options.platforma[0] || 'Reels');
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="pl-add"
      onSubmit={(event) => {
        event.preventDefault();
        if (!nazev.trim() || busy) return;
        setBusy(true);
        onAdd(nazev.trim(), platforma).finally(() => setBusy(false));
      }}
    >
      <label className="pl-ig-label">
        <span>O čem to bude</span>
        <input
          className="pl-field-input pl-add-input"
          autoFocus
          placeholder="Pracovní název videa"
          value={nazev}
          onChange={(event) => setNazev(event.target.value)}
        />
      </label>
      <div className="pl-ig-label">
        <span>Kam</span>
        <span className="pl-seg" role="radiogroup" aria-label="Platforma">
          {options.platforma.map((value) => (
            <button key={value} type="button" role="radio" aria-checked={platforma === value} className={platforma === value ? 'is-on' : ''} onClick={() => setPlatforma(value)}>
              {platformLabel(value)}
            </button>
          ))}
        </span>
      </div>
      {draft.datum ? <p className="pl-ig-hint">Den vydání: {denLabel(draft.datum)}</p> : null}
      <div className="pl-add-actions">
        <button type="button" className="pl-btn" onClick={onClose}>
          Zrušit
        </button>
        <button type="submit" className="pl-btn is-primary" disabled={!nazev.trim() || busy}>
          Přidat kartu
        </button>
      </div>
    </form>
  );
}

function Board({
  cards,
  ig,
  draggable,
  onOpen,
  onAdd,
  onMove,
}: {
  cards: PlannerCard[];
  ig: IgMap;
  draggable: boolean;
  onOpen: (id: string) => void;
  onAdd: (draft: Draft) => void;
  onMove: (id: string, faze: Faze) => void;
}) {
  const [over, setOver] = useState<Faze | null>(null);
  const [vsechnyVydane, setVsechnyVydane] = useState(false);
  return (
    <div className="pl-board">
      {FAZE.map((faze) => {
        const all = cards.filter((card) => fazeKarty(card.stav) === faze.key);
        const sorted = sortCards(all, faze.key === 'vydano' ? 'Vydáno' : faze.key);
        // Opravit patří nahoru, to je práce, která čeká.
        if (faze.key === 'review') sorted.sort((a, b) => Number(b.stav === 'Opravit') - Number(a.stav === 'Opravit'));
        const list = faze.key === 'vydano' && !vsechnyVydane ? sorted.slice(0, VYDANO_NA_BOARDU) : sorted;
        return (
          <section
            key={faze.key}
            className={`pl-col${over === faze.key ? ' is-over' : ''}`}
            aria-label={faze.label}
            onDragOver={(event) => {
              event.preventDefault();
              setOver(faze.key);
            }}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node)) setOver(null);
            }}
            onDrop={(event) => {
              event.preventDefault();
              setOver(null);
              const id = event.dataTransfer.getData('text/plain');
              if (id) onMove(id, faze.key);
            }}
          >
            <header className="pl-col-head">
              <Dot tone={faze.tone} />
              <span className="pl-col-name">{faze.label}</span>
              <span className="pl-col-count">{all.length}</span>
              {faze.key === 'napad' ? (
                <button type="button" className="pl-icon" aria-label="Přidat nápad" onClick={() => onAdd({})}>
                  <Icon name="plus" size={16} />
                </button>
              ) : null}
            </header>
            <div className="pl-col-cards">
              {list.map((card) => (
                <CardTile
                  key={card.id}
                  card={card}
                  ig={ig[card.id]}
                  draggable={draggable}
                  onOpen={() => onOpen(card.id)}
                  onDragStart={(event) => event.dataTransfer.setData('text/plain', card.id)}
                />
              ))}
              {!all.length ? <p className="pl-col-empty">{draggable ? 'Přetáhni sem kartu' : 'Nic tu není'}</p> : null}
              {faze.key === 'vydano' && sorted.length > VYDANO_NA_BOARDU ? (
                <button type="button" className="pl-textbtn pl-col-more" onClick={() => setVsechnyVydane(!vsechnyVydane)}>
                  {vsechnyVydane ? 'Ukázat jen poslední' : `Ukázat všech ${sorted.length}`}
                </button>
              ) : null}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function CalendarView({
  cards,
  ig,
  draggable,
  onOpen,
  onAdd,
  onSchedule,
}: {
  cards: PlannerCard[];
  ig: IgMap;
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
    // Co má čas na Instagramu, jde podle času.
    for (const list of map.values()) {
      list.sort((a, b) => (ig[a.id]?.naplanovano_na || '~').localeCompare(ig[b.id]?.naplanovano_na || '~'));
    }
    return map;
  }, [cards, ig]);

  const shift = (by: number) => {
    const date = new Date(cursor.year, cursor.month + by, 1);
    setCursor({ year: date.getFullYear(), month: date.getMonth() });
  };
  const waiting = cards.filter((card) => !card.datum && NEEDS_DATE.includes(card.stav));
  const dayCards = byDay.get(selected) || [];
  const cas = (card: PlannerCard) => {
    const post = ig[card.id];
    return post && post.stav !== 'zruseno' && post.stav !== 'chyba' ? casLabel(post.naplanovano_na) : null;
  };

  return (
    <div className="pl-cal">
      <div className="pl-cal-main">
        <div className="pl-cal-nav">
          <h2>{monthLabel(cursor.year, cursor.month)}</h2>
          <div className="pl-cal-buttons">
            <button type="button" className="pl-icon" aria-label="Předchozí měsíc" onClick={() => shift(-1)}>
              <Icon name="back" size={16} />
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
              <Icon name="right" size={16} />
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
              cell.iso < today ? 'is-past' : '',
              over === cell.iso ? 'is-over' : '',
            ];
            return (
              <div
                key={cell.iso}
                role="gridcell"
                aria-selected={cell.iso === selected}
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
                <span className="pl-cal-day">{cell.day}</span>
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
                      <Dot tone={toneKarty(card.stav)} />
                      {cas(card) ? <span className="pl-cal-time">{cas(card)}</span> : null}
                      <span className="pl-cal-name">{card.nazev}</span>
                    </button>
                  ))}
                  {list.length > 3 ? <span className="pl-cal-more">a další {list.length - 3}</span> : null}
                </div>
              </div>
            );
          })}
        </div>
        <ul className="pl-legend" aria-label="Barvy fází">
          {FAZE.map((faze) => (
            <li key={faze.key}>
              <Dot tone={faze.tone} />
              {faze.label}
            </li>
          ))}
        </ul>
      </div>

      <aside className="pl-cal-side">
        <div className="pl-side-group">
          <header className="pl-side-head">
            <h3>{selected === today ? 'Dnes' : denLabel(selected)}</h3>
            <button type="button" className="pl-btn" onClick={() => onAdd({ datum: selected })}>
              <Icon name="plus" size={14} />
              Přidat
            </button>
          </header>
          {dayCards.length ? (
            dayCards.map((card) => (
              <CardTile key={card.id} card={card} ig={ig[card.id]} draggable={draggable} onOpen={() => onOpen(card.id)} onDragStart={(event) => event.dataTransfer.setData('text/plain', card.id)} />
            ))
          ) : (
            <p className="pl-none">Na tenhle den nic nevychází</p>
          )}
        </div>
        {waiting.length ? (
          <div className="pl-side-group">
            <header className="pl-side-head">
              <h3>Čeká na datum</h3>
              <span className="pl-col-count">{waiting.length}</span>
            </header>
            <p className="pl-side-hint">{draggable ? 'Rozpracované bez dne vydání. Přetáhni je do kalendáře.' : 'Rozpracované bez dne vydání. Den nastavíš v kartě.'}</p>
            {waiting.map((card) => (
              <CardTile key={card.id} card={card} ig={ig[card.id]} draggable={draggable} onOpen={() => onOpen(card.id)} onDragStart={(event) => event.dataTransfer.setData('text/plain', card.id)} />
            ))}
          </div>
        ) : null}
      </aside>
    </div>
  );
}

/** Jak planner funguje, jednou větou na každou věc. */
function Navod() {
  const radky: { title: string; text: string }[] = [
    {
      title: 'Karta je jedno video',
      text: 'Projde fázemi Nápady, Natočeno, Střih, Review a Vydáno. Fázi měníš v kartě nahoře, na počítači i přetažením na boardu. Review, které je potřeba předělat, vrátíš tlačítkem Vrátit k opravě.',
    },
    {
      title: 'Kalendář je podle dne vydání',
      text: 'Den nastavíš v kartě, na počítači i přetažením do kalendáře. Rozpracované karty bez dne čekají v Čeká na datum, ať nic nevypadne.',
    },
    {
      title: 'Instagram vydává Beo',
      text: 'V kartě v části Vydání nahraješ hotový střih nebo fotky, napíšeš popisek a zvolíš čas. Soubor se uloží v Beovi a ten ho v ten čas sám vydá na Instagram. Karta pak ukáže Vyšlo s odkazem a přesune se do Vydáno. Do té doby jde příspěvek zrušit.',
    },
    {
      title: 'Návrhy brainu',
      text: 'Náměty, které brain vytáhl z hovorů. Schválený návrh se stane kartou v Nápadech.',
    },
    {
      title: 'Notion',
      text: 'Načíst z Notionu přidá jen karty, které tu ještě nejsou. Nic nepřepisuje a do Notionu se nezapisuje.',
    },
  ];
  return (
    <dl className="pl-navod">
      {radky.map((r) => (
        <div key={r.title}>
          <dt>{r.title}</dt>
          <dd>{r.text}</dd>
        </div>
      ))}
    </dl>
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
  const [navod, setNavod] = useState(false);
  const [notice, setNotice] = useState<{ text: string; undo?: () => void } | null>(null);
  const [importing, setImporting] = useState(false);
  const [ig, setIg] = useState<IgMap>({});
  const [igError, setIgError] = useState<string | null>(null);
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

  // Instagram se ptá za všechny karty mimo YouTube jedním dotazem.
  const igIds = useMemo(
    () => (data?.karty || []).filter((card) => card.platforma !== 'Youtube').map((card) => card.id).join(','),
    [data],
  );
  const loadIg = useCallback(async () => {
    if (!igIds) return;
    try {
      const res = await request<{ ok?: boolean; posty: IgMap; error?: string }>(`${IG_PATH}?ids=${encodeURIComponent(igIds)}`);
      if (res.ok === false) {
        setIgError(res.error || 'Beo neodpovědělo');
        return;
      }
      setIg(res.posty || {});
      setIgError(null);
    } catch (err) {
      setIgError(err instanceof Error ? err.message : 'Beo neodpovědělo');
    }
  }, [igIds, request]);

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

  // Dokud něco čeká na vydání, stav se obnovuje častěji.
  const igBezi = Object.values(ig).some((p) => p.stav === 'ceka' || p.stav === 'zpracovava');
  useEffect(() => {
    void loadIg();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void loadIg();
    }, igBezi ? 30000 : 120000);
    return () => clearInterval(timer);
  }, [loadIg, igBezi]);

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

  const add = async (nazev: string, platforma: string) => {
    const body = {
      nazev,
      platforma,
      stav: stavProFazi('napad', { platforma }),
      ...(person ? { kdo: [person] } : {}),
      ...(draft?.datum ? { datum: draft.datum } : {}),
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

  const setIgPost = (id: string, post: IgPost | null) => {
    setIg((cur) => {
      const next = { ...cur };
      if (post) next[id] = post;
      else delete next[id];
      return next;
    });
    if (post) setNotice({ text: `Naplánováno na ${kdyLabel(post.naplanovano_na)} ${casLabel(post.naplanovano_na)}` });
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
    { key: 'board', label: 'Fáze' },
    { key: 'kalendar', label: 'Kalendář' },
    { key: 'navrhy', label: 'Návrhy brainu', count: proposalCount },
  ];

  const filtered = Boolean(platform || person);

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
        <div className="pl-toolbar-end">
          <button type="button" className="pl-btn is-ghost" onClick={() => setNavod(true)}>
            Jak to funguje
          </button>
          {view !== 'navrhy' && options ? (
            <button type="button" className="pl-btn is-primary pl-add-btn" onClick={() => setDraft({})}>
              <Icon name="plus" size={15} />
              Nový nápad
            </button>
          ) : null}
        </div>
      </div>

      {view !== 'navrhy' && options ? (
        <div className="pl-filters">
          <span className="pl-seg is-small" role="radiogroup" aria-label="Platforma">
            <button type="button" role="radio" aria-checked={!platform} className={!platform ? 'is-on' : ''} onClick={() => setPlatform(null)}>
              Vše
            </button>
            {options.platforma.map((value) => (
              <button key={value} type="button" role="radio" aria-checked={platform === value} className={platform === value ? 'is-on' : ''} onClick={() => setPlatform(value)}>
                {platformLabel(value)}
              </button>
            ))}
          </span>
          <span className="pl-filter-people" role="group" aria-label="Kdo dělá">
            {options.kdo.map((value) => (
              <button
                key={value}
                type="button"
                className={`pl-chip${person === value ? ' is-on' : ''}`}
                aria-pressed={person === value}
                onClick={() => setPerson(person === value ? null : value)}
              >
                {value}
              </button>
            ))}
          </span>
          {filtered ? (
            <button
              type="button"
              className="pl-textbtn"
              onClick={() => {
                setPlatform(null);
                setPerson(null);
              }}
            >
              Zrušit filtr
            </button>
          ) : null}
          <button type="button" className="pl-textbtn pl-notion" disabled={importing} onClick={() => void pullFromNotion()}>
            {importing ? 'Načítám z Notionu' : 'Načíst z Notionu'}
          </button>
        </div>
      ) : null}

      {view === 'navrhy' ? (
        <div className="pl-proposals">{proposals}</div>
      ) : !data ? (
        error ? (
          <p className="pl-state">Planner se nenačetl: {error}</p>
        ) : (
          <div className="pl-skeleton" aria-busy="true">
            {Array.from({ length: 5 }, (_, i) => (
              <span key={i} />
            ))}
          </div>
        )
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
              <p>Přidej první nápad nebo načti karty z Notionu</p>
            </>
          )}
          <button type="button" className="pl-btn" disabled={importing} onClick={() => void pullFromNotion()}>
            {importing ? 'Načítám, chvíli to trvá' : 'Načíst z Notionu'}
          </button>
        </div>
      ) : view === 'board' ? (
        <Board
          cards={cards}
          ig={ig}
          draggable={draggable}
          onOpen={setOpenId}
          onAdd={setDraft}
          onMove={(id, faze) => {
            const card = data.karty.find((c) => c.id === id);
            if (card && fazeKarty(card.stav) !== faze) patch(id, { stav: stavProFazi(faze, card) });
          }}
        />
      ) : (
        <CalendarView cards={cards} ig={ig} draggable={draggable} onOpen={setOpenId} onAdd={setDraft} onSchedule={(id, datum) => patch(id, { datum })} />
      )}

      {open && options ? (
        <Panel title={platformLabel(open.platforma) || 'Karta'} onClose={() => setOpenId(null)}>
          <CardDetail
            key={open.id}
            card={open}
            options={options}
            request={request}
            ig={ig[open.id] || null}
            igError={igError}
            onIg={(post) => setIgPost(open.id, post)}
            onPatch={(change) => patch(open.id, change)}
            onDelete={() => remove(open)}
          />
        </Panel>
      ) : null}

      {draft && options ? (
        <Panel title={draft.datum ? `Nový nápad na ${denLabel(draft.datum)}` : 'Nový nápad'} onClose={() => setDraft(null)}>
          <AddCard draft={draft} options={options} onAdd={add} onClose={() => setDraft(null)} />
        </Panel>
      ) : null}

      {navod ? (
        <Panel title="Jak to funguje" onClose={() => setNavod(false)}>
          <Navod />
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
