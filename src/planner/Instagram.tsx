// Vydání karty na Instagram přes Beo. Soubory jdou z prohlížeče rovnou do
// úložiště Bea (podepsané adresy), server brainu jen předá plán. Stav příspěvků
// drží Planner pro všechny karty najednou, tady se jen kreslí a mění.
//
// Rozložení drží vzor seskupených řádků z iOS: skupina s nadpisem, řádek
// s popiskem vlevo a hodnotou vpravo, rozbalení na místě, jedno hlavní
// tlačítko s konkrétním výsledkem a potvrzení u všeho, co nejde vrátit.

import { useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react';

import { Icon } from '../mobile/icons';

import { IG_PATH, PLANNER_PATH, casLabel, denLabel, jinePasmo, kdyLabel, mistniCas, prahaDen, prahaDenZa, zPrahy, type IgPost, type PlannerCard, type Request } from './model';

type Ticket = { path: string; typ: 'foto' | 'video'; uploadUrl: string };
type Trial = 'manual' | 'auto' | null;
type Odeslani = {
  typ: IgPost['typ'];
  popisek: string;
  media: { path: string; typ: 'foto' | 'video' }[];
  cover_path: string | null;
  trial: Trial;
  naplanovano_na: string;
};

const MAX_POPISEK = 2200;
const MAX_HASHTAGU = 30;
/** Čas po čtvrthodinách, ať se na počítači nevybírá v americkém formátu prohlížeče. */
const CASY = Array.from({ length: 24 * 4 }, (_, i) => `${String(Math.floor(i / 4)).padStart(2, '0')}:${String((i % 4) * 15).padStart(2, '0')}`);

const TRIALY: { value: Trial; label: string; kratce: string; hint: string }[] = [
  { value: null, label: 'Všem', kratce: 'Všem', hint: 'Sledujícím i ostatním, jako běžný reel' },
  { value: 'manual', label: 'Trial, pustím ho sám', kratce: 'Trial, pustíš sám', hint: 'Nejdřív jen lidem, kteří tě nesledují. Sledujícím ho pustíš v Instagramu' },
  { value: 'auto', label: 'Trial, pustí ho Instagram', kratce: 'Trial, pustí Instagram', hint: 'Nejdřív jen lidem, kteří tě nesledují. Když se mu bude dařit, Instagram ho pustí i sledujícím' },
];

const dotyk = () => typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches;

function vychoziCas(datum: string | null): string {
  const den = datum && datum >= prahaDen() ? datum : prahaDenZa(1);
  return `${den}T18:00`;
}

/** Čas vydání v Praze jako YYYY-MM-DDTHH:mm, pro výběr času. */
function prahaMistne(iso: string): string {
  return `${prahaDen(iso)}T${casLabel(iso)}`;
}

function vMinulosti(cas: string): boolean {
  return new Date(zPrahy(cas)).getTime() < Date.now() + 60_000;
}

function typLabel(post: Pick<IgPost, 'typ' | 'trial'>): string {
  if (post.typ === 'reel') return post.trial ? 'Trial reel' : 'Reel';
  return post.typ === 'foto' ? 'Fotka' : 'Carousel';
}

function pocetHashtagu(text: string): number {
  return (text.match(/#[^\s#]+/g) || []).length;
}

/** Instagram bere jen JPEG. PNG, WebP a spol. se převedou tady. */
async function naJpeg(file: File): Promise<Blob> {
  if (file.type === 'image/jpeg') return file;
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error(`${file.name} nejde převést na JPEG`))), 'image/jpeg', 0.92),
  );
}

async function priprav(file: File): Promise<Blob> {
  if (file.type.startsWith('image/')) return naJpeg(file);
  if (file.type === 'video/mp4' || file.type === 'video/quicktime') return file;
  throw new Error(`${file.name}: Instagram bere fotky a videa MP4 nebo MOV`);
}

function vhodne(files: FileList | File[]): File[] {
  return Array.from(files).filter((f) => f.type.startsWith('image/') || f.type === 'video/mp4' || f.type === 'video/quicktime');
}

/** PUT na podepsanou adresu s průběhem, fetch průběh nahrávání neumí. */
function nahraj(url: string, blob: Blob, onProgress: (loaded: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', blob.type);
    xhr.setRequestHeader('x-upsert', 'false');
    xhr.upload.onprogress = (e) => onProgress(e.loaded);
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Nahrání selhalo (${xhr.status})`)));
    xhr.onerror = () => reject(new Error('Nahrání selhalo, zkontroluj připojení'));
    xhr.send(blob);
  });
}

/** Náhledy vybraných souborů. Adresy se po odebrání uvolní. */
function useNahledy(files: File[]) {
  const urls = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
  useEffect(() => () => urls.forEach((u) => URL.revokeObjectURL(u)), [urls]);
  return urls;
}

// ─── Stavební kousky ─────────────────────────────────────────────────────────

/** Skupina řádků s nadpisem a poznámkou pod ní. */
function Skupina({ nadpis, pozn, children }: { nadpis?: string; pozn?: ReactNode; children: ReactNode }) {
  return (
    <section className="pl-ig-sec">
      {nadpis ? <h4 className="pl-ig-cap">{nadpis}</h4> : null}
      <div className="pl-ig-group">{children}</div>
      {pozn ? <div className="pl-ig-foot">{pozn}</div> : null}
    </section>
  );
}

/** Řádek, který se rozbalí na místě. Šipka ukazuje, že jde dál. */
function Radek({ label, value, open, onClick }: { label: string; value: ReactNode; open?: boolean; onClick?: () => void }) {
  return (
    <button type="button" className="pl-ig-row is-tap" aria-expanded={open} onClick={onClick}>
      <span className="pl-ig-row-label">{label}</span>
      <span className="pl-ig-row-value">{value}</span>
      <span className={`pl-ig-chev${open ? ' is-open' : ''}`} aria-hidden="true">
        <Icon name="right" size={14} />
      </span>
    </button>
  );
}

/** Volba jedné z možností jako seznam s fajfkou, každá s vysvětlením. */
function Volby<T>({ options, value, onPick, disabled }: { options: { value: T; label: string; hint: string }[]; value: T; onPick: (v: T) => void; disabled?: boolean }) {
  return (
    <div role="radiogroup">
      {options.map((o) => (
        <button
          key={o.label}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          disabled={disabled}
          className="pl-ig-row pl-ig-volba is-tap"
          onClick={() => onPick(o.value)}
        >
          <span className="pl-ig-volba-text">
            <span>{o.label}</span>
            <small>{o.hint}</small>
          </span>
          <span className="pl-ig-check" aria-hidden="true">
            {o.value === value ? <Icon name="check" size={18} /> : null}
          </span>
        </button>
      ))}
    </div>
  );
}

/** Potvrzení nevratné akce přímo na místě, jako akční list v iOS. */
function Potvrzeni({
  text,
  ano,
  ne,
  danger,
  busy,
  onAno,
  onNe,
}: {
  text: string;
  ano: string;
  ne: string;
  danger?: boolean;
  busy?: boolean;
  onAno: () => void;
  onNe: () => void;
}) {
  return (
    <div className="pl-ig-confirm" role="alertdialog" aria-label={text}>
      <p>{text}</p>
      <button type="button" className={`pl-btn pl-ig-wide ${danger ? 'is-danger' : 'is-primary'}`} disabled={busy} onClick={onAno}>
        {busy ? 'Pracuju' : ano}
      </button>
      <button type="button" className="pl-btn pl-ig-wide" disabled={busy} onClick={onNe}>
        {ne}
      </button>
    </div>
  );
}

/** Den a čas vydání, vždy v Praze: rychlé volby, pak řádky Den a Čas. */
function VyberCasu({ cas, setCas, datum }: { cas: string; setCas: (cas: string) => void; datum: string | null }) {
  const rychle = [
    { label: 'Dnes 18:00', value: `${prahaDen()}T18:00` },
    { label: 'Zítra 18:00', value: `${prahaDenZa(1)}T18:00` },
    ...(datum && datum > prahaDenZa(1) ? [{ label: `${denLabel(datum)} 18:00`, value: `${datum}T18:00` }] : []),
  ].filter((r) => !vMinulosti(r.value));
  const den = cas.slice(0, 10);
  const hodina = cas.slice(11, 16);
  const nativni = useMemo(dotyk, []);
  const relativne = kdyLabel(den);

  return (
    <>
      {rychle.length ? (
        <div className="pl-ig-row pl-ig-quick">
          {rychle.map((r) => (
            <button key={r.value} type="button" aria-pressed={cas === r.value} className={`pl-chip${cas === r.value ? ' is-on' : ''}`} onClick={() => setCas(r.value)}>
              {r.label}
            </button>
          ))}
        </div>
      ) : null}
      <label className="pl-ig-row is-tap pl-ig-native">
        <span className="pl-ig-row-label">Den</span>
        <span className="pl-ig-row-value">{relativne === denLabel(den) ? relativne : `${relativne}, ${denLabel(den)}`}</span>
        <Icon name="calendar" size={16} />
        <input type="date" aria-label="Den vydání" value={den} min={prahaDen()} onChange={(e) => e.target.value && setCas(`${e.target.value}T${hodina || '18:00'}`)} />
      </label>
      <label className="pl-ig-row is-tap pl-ig-native">
        <span className="pl-ig-row-label">Čas</span>
        <span className="pl-ig-row-value">{hodina}</span>
        <Icon name="clock" size={16} />
        {nativni ? (
          <input type="time" aria-label="Čas vydání" value={hodina} step={900} onChange={(e) => e.target.value && setCas(`${den}T${e.target.value}`)} />
        ) : (
          <select aria-label="Čas vydání" value={hodina} onChange={(e) => setCas(`${den}T${e.target.value}`)}>
            {CASY.includes(hodina) ? null : <option value={hodina}>{hodina}</option>}
            {CASY.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        )}
      </label>
    </>
  );
}

function PoznamkaCasu({ cas }: { cas: string }) {
  if (vMinulosti(cas)) return <span className="is-bad">Tenhle čas už minul, vyber pozdější</span>;
  const iso = zPrahy(cas);
  return <span>Český čas{jinePasmo(iso) ? `, u tebe to bude ${mistniCas(iso)}` : ''}</span>;
}

function Pocitadlo({ text }: { text: string }) {
  const tagy = pocetHashtagu(text);
  return (
    <span className="pl-ig-count">
      <span className={tagy > MAX_HASHTAGU ? 'is-bad' : ''}>
        {tagy} z {MAX_HASHTAGU} hashtagů
      </span>
      <span>
        {text.length} z {MAX_POPISEK}
      </span>
    </span>
  );
}

function Nenapojeno() {
  return (
    <div className="pl-ig-state">
      <span className="pl-ig-state-icon">
        <Icon name="link" size={18} />
      </span>
      <div>
        <strong>Brain není napojený na Beo</strong>
        <p>Připoj Beo v Konektorech, nebo vlož klíč z Bea v Agent, Napojení a klíče, Beo</p>
      </div>
    </div>
  );
}

const nenapojeno = (error: string | null) => !!error && /chybí napojení|chybí klíč/i.test(error);

// ─── Formulář nového vydání ──────────────────────────────────────────────────

function Formular({
  datum,
  request,
  predchozi,
  novy,
  onSend,
}: {
  datum: string | null;
  request: Request;
  predchozi: IgPost | null;
  /** Nový reel bez karty: formulář chce i název a tlačítko drží dole. */
  novy?: boolean;
  onSend: (body: Odeslani & { nazev?: string }) => Promise<void>;
}) {
  const [soubory, setSoubory] = useState<File[]>([]);
  const [cover, setCover] = useState<File | null>(null);
  const [popisek, setPopisek] = useState(predchozi?.popisek || '');
  const [nazev, setNazev] = useState('');
  const [trial, setTrial] = useState<Trial>(predchozi?.trial ?? null);
  const [cas, setCas] = useState(() => vychoziCas(datum));
  const [prace, setPrace] = useState<{ text: string; podil?: number } | null>(null);
  const [chyba, setChyba] = useState<string | null>(null);
  const [nadZonou, setNadZonou] = useState(false);
  const [hned, setHned] = useState(false);
  const vstup = useRef<HTMLInputElement>(null);
  const urls = useNahledy(soubory);
  const coverUrls = useNahledy(useMemo(() => (cover ? [cover] : []), [cover]));
  const naDotyk = useMemo(dotyk, []);

  const videa = soubory.filter((f) => f.type.startsWith('video/')).length;
  const typ: IgPost['typ'] | null = soubory.length === 0 ? null : soubory.length > 1 ? 'carousel' : videa ? 'reel' : 'foto';
  const tagy = pocetHashtagu(popisek);
  const blokuje = !typ ? 'Nejdřív přidej video nebo fotky' : novy && !nazev.trim() ? 'Doplň název, pod ním bude v planneru' : tagy > MAX_HASHTAGU ? 'Instagram bere nejvýš 30 hashtagů' : null;
  const chybi = blokuje ?? (vMinulosti(cas) ? 'Vyber čas, který ještě nebyl' : null);

  const pridej = (files: FileList | File[]) => {
    const nove = vhodne(files);
    if (!nove.length) {
      setChyba('Instagram bere fotky a videa MP4 nebo MOV');
      return;
    }
    setChyba(null);
    if (novy && !nazev && !soubory.length) setNazev(nove[0].name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120));
    setSoubory((cur) => [...cur, ...nove].slice(0, 10));
  };

  const odeslat = async (ted: boolean) => {
    if (!typ) return;
    setChyba(null);
    setHned(false);
    try {
      setPrace({ text: 'Připravuju soubory' });
      const vse = cover && typ === 'reel' ? [...soubory, cover] : soubory;
      const bloby = await Promise.all(vse.map(priprav));
      const { soubory: tickety } = await request<{ soubory: Ticket[] }>(`${IG_PATH}/nahrani`, {
        method: 'POST',
        body: { soubory: bloby.map((b) => ({ typ: b.type })) },
      });
      const celkem = bloby.reduce((s, b) => s + b.size, 0) || 1;
      const hotovo = bloby.map(() => 0);
      const ukaz = () => {
        const podil = Math.min(1, hotovo.reduce((s, n) => s + n, 0) / celkem);
        setPrace({ text: `Nahrávám ${Math.round(podil * 100)} %`, podil });
      };
      ukaz();
      for (let i = 0; i < tickety.length; i++) {
        await nahraj(tickety[i].uploadUrl, bloby[i], (loaded) => {
          hotovo[i] = loaded;
          ukaz();
        });
        hotovo[i] = bloby[i].size;
      }
      setPrace({ text: ted ? 'Vydávám' : 'Plánuju', podil: 1 });
      await onSend({
        ...(novy ? { nazev: nazev.trim() } : {}),
        typ,
        popisek,
        media: tickety.slice(0, soubory.length).map((t) => ({ path: t.path, typ: t.typ })),
        cover_path: cover && typ === 'reel' ? tickety[soubory.length]?.path ?? null : null,
        trial: typ === 'reel' ? trial : null,
        naplanovano_na: ted ? new Date().toISOString() : zPrahy(cas),
      });
    } catch (err) {
      setChyba(err instanceof Error ? err.message : 'Naplánování selhalo');
    } finally {
      setPrace(null);
    }
  };

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setNadZonou(false);
    if (event.dataTransfer.files?.length) pridej(event.dataTransfer.files);
  };

  const iso = zPrahy(cas);

  return (
    <div className={`pl-ig-form${novy ? ' is-sheet' : ''}`}>
      {soubory.length ? (
        <Skupina
          nadpis={typ === 'reel' ? 'Reel' : typ === 'foto' ? 'Fotka' : `Carousel, ${soubory.length} z 10`}
          pozn={typ === 'reel' && !cover ? 'Bez coveru vezme Instagram první snímek videa' : undefined}
        >
          {typ === 'reel' ? (
            <div className="pl-ig-player">
              <video key={urls[0]} src={urls[0]} controls playsInline preload="metadata" />
            </div>
          ) : (
            <div className="pl-ig-thumbs">
              {soubory.map((file, i) => (
                <div key={urls[i]} className="pl-ig-thumb">
                  {file.type.startsWith('video/') ? <video src={`${urls[i]}#t=0.1`} muted playsInline preload="metadata" /> : <img src={urls[i]} alt="" />}
                  <button type="button" className="pl-ig-thumb-x" aria-label={`Odebrat ${file.name}`} onClick={() => setSoubory((cur) => cur.filter((_, j) => j !== i))}>
                    <Icon name="close" size={12} />
                  </button>
                </div>
              ))}
              {soubory.length < 10 ? (
                <button type="button" className="pl-ig-thumb pl-ig-thumb-add" aria-label="Přidat další" onClick={() => vstup.current?.click()}>
                  <Icon name="plus" size={20} />
                </button>
              ) : null}
            </div>
          )}
          {typ === 'reel' ? (
            <>
              <label className="pl-ig-row is-tap">
                <span className="pl-ig-row-label">Cover</span>
                <span className="pl-ig-row-value">{cover ? <img className="pl-ig-cover" src={coverUrls[0]} alt="" /> : 'První snímek'}</span>
                <span className="pl-ig-row-action">{cover ? 'Změnit' : 'Vybrat'}</span>
                <input type="file" accept="image/*" hidden onChange={(e) => setCover(e.target.files?.[0] ?? null)} />
              </label>
              {cover ? (
                <button type="button" className="pl-ig-row is-tap pl-ig-row-plain" onClick={() => setCover(null)}>
                  Použít první snímek
                </button>
              ) : null}
              <button
                type="button"
                className="pl-ig-row is-tap pl-ig-row-plain is-danger"
                onClick={() => {
                  setSoubory([]);
                  setCover(null);
                }}
              >
                Odebrat video
              </button>
            </>
          ) : null}
        </Skupina>
      ) : (
        <button
          type="button"
          className={`pl-ig-drop${nadZonou ? ' is-over' : ''}`}
          onClick={() => vstup.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setNadZonou(true);
          }}
          onDragLeave={() => setNadZonou(false)}
          onDrop={onDrop}
        >
          <span className="pl-ig-drop-icon">
            <Icon name="gallery" size={22} />
          </span>
          <strong>{naDotyk ? 'Vybrat hotový reel nebo fotky' : 'Přetáhni sem hotový reel nebo fotky'}</strong>
          <span>Jedno video je reel, jedna fotka post, víc souborů carousel</span>
        </button>
      )}
      <input
        ref={vstup}
        type="file"
        multiple
        hidden
        accept="image/*,video/mp4,video/quicktime"
        onChange={(e) => {
          if (e.target.files) pridej(e.target.files);
          e.target.value = '';
        }}
      />

      {novy ? (
        <Skupina nadpis="Název v planneru">
          <input className="pl-ig-input" value={nazev} maxLength={300} placeholder="O čem reel je" aria-label="Název v planneru" onChange={(e) => setNazev(e.target.value)} />
        </Skupina>
      ) : null}

      <Skupina nadpis="Kdy vyjde" pozn={<PoznamkaCasu cas={cas} />}>
        <VyberCasu cas={cas} setCas={setCas} datum={datum} />
      </Skupina>

      <Skupina nadpis="Popisek" pozn={<Pocitadlo text={popisek} />}>
        <textarea
          className="pl-ig-input pl-ig-popisek"
          value={popisek}
          maxLength={MAX_POPISEK}
          placeholder="Text pod příspěvkem, hashtagy na konec"
          aria-label="Popisek"
          onChange={(e) => setPopisek(e.target.value)}
        />
      </Skupina>

      {typ === 'reel' ? (
        <Skupina nadpis="Komu ho Instagram ukáže">
          <Volby options={TRIALY} value={trial} onPick={setTrial} />
        </Skupina>
      ) : null}

      {chyba ? (
        <p className="pl-ig-chyba" role="alert">
          {chyba}
        </p>
      ) : null}

      <div className="pl-ig-cta">
        {prace ? (
          <div className="pl-ig-progress" role="status" aria-live="polite">
            <span>{prace.text}</span>
            <span className="pl-ig-bar">
              <span style={{ transform: `scaleX(${prace.podil ?? 0})` }} />
            </span>
          </div>
        ) : hned ? (
          <Potvrzeni text="Příspěvek vyjde do minuty a hned ho uvidí lidé" ano="Vydat hned" ne="Zpět" onAno={() => void odeslat(true)} onNe={() => setHned(false)} />
        ) : (
          <>
            <button type="button" className="pl-btn is-primary pl-ig-wide" disabled={!!chybi} onClick={() => void odeslat(false)}>
              {`Naplánovat na ${kdyLabel(iso)} ${casLabel(iso)}`}
            </button>
            {chybi ? <span className="pl-ig-why">{chybi}</span> : null}
            <button type="button" className="pl-textbtn pl-ig-now" disabled={!!blokuje} onClick={() => setHned(true)}>
              Vydat hned
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Naplánovaný, vydávaný nebo vydaný příspěvek ─────────────────────────────

const STAVY: Record<IgPost['stav'], { label: string; tone: string }> = {
  ceka: { label: 'Naplánováno', tone: 'is-wait' },
  zpracovava: { label: 'Vydává se', tone: 'is-work' },
  publikovano: { label: 'Vyšlo', tone: 'is-done' },
  chyba: { label: 'Nevyšlo', tone: 'is-bad' },
  zruseno: { label: 'Zrušeno', tone: '' },
};

/** Hlavička příspěvku: náhled vlevo, stav, čas a typ vpravo. Náhled se po klepnutí přehraje. */
function Souhrn({ post }: { post: IgPost }) {
  const [hraje, setHraje] = useState(false);
  const kdy = post.stav === 'publikovano' && post.publikovano_at ? post.publikovano_at : post.naplanovano_na;
  const nahled = post.nahled_url && post.stav !== 'publikovano' ? post.nahled_url : null;
  const video = post.typ !== 'foto';
  const stav = STAVY[post.stav];

  return (
    <>
      <div className="pl-ig-sum">
        {nahled ? (
          <button type="button" className="pl-ig-sum-thumb" aria-label={hraje ? 'Skrýt náhled' : 'Přehrát náhled'} aria-pressed={hraje} onClick={() => setHraje((v) => !v)}>
            {video ? <video src={`${nahled}#t=0.1`} muted playsInline preload="metadata" /> : <img src={nahled} alt="" />}
            {video ? (
              <span className="pl-ig-play" aria-hidden="true">
                <Icon name={hraje ? 'close' : 'video'} size={14} />
              </span>
            ) : null}
          </button>
        ) : null}
        <div className="pl-ig-sum-text">
          <span className={`pl-ig-pill ${stav.tone}`}>{stav.label}</span>
          <strong>
            {kdyLabel(kdy)} v {casLabel(kdy)}
          </strong>
          <span>
            {denLabel(prahaDen(kdy))}, český čas{jinePasmo(kdy) ? `, u tebe ${mistniCas(kdy)}` : ''}
          </span>
          <span>{typLabel(post)}</span>
        </div>
      </div>
      {hraje && nahled ? (
        <div className="pl-ig-player">{video ? <video src={nahled} controls autoPlay playsInline /> : <img src={nahled} alt="" />}</div>
      ) : null}
    </>
  );
}

type Uprava = 'cas' | 'komu' | 'popisek' | null;

function Naplanovany({ post, datum, request, onPost }: { post: IgPost; datum: string | null; request: Request; onPost: (post: IgPost | null) => void }) {
  const [uprava, setUprava] = useState<Uprava>(null);
  const [cas, setCas] = useState(() => prahaMistne(post.naplanovano_na));
  const [text, setText] = useState(post.popisek);
  const [potvrdit, setPotvrdit] = useState<'hned' | 'zrusit' | null>(null);
  const [busy, setBusy] = useState(false);
  const [chyba, setChyba] = useState<string | null>(null);

  const otevri = (co: Exclude<Uprava, null>) => {
    setChyba(null);
    setPotvrdit(null);
    if (co === 'cas') setCas(prahaMistne(post.naplanovano_na));
    if (co === 'popisek') setText(post.popisek);
    setUprava((cur) => (cur === co ? null : co));
  };

  const zmen = async (body: Record<string, unknown>, potom: () => void) => {
    setBusy(true);
    setChyba(null);
    try {
      const res = await request<{ post: IgPost }>(`${IG_PATH}/${encodeURIComponent(post.id)}`, { method: 'PATCH', body });
      onPost({ ...res.post, nahled_url: post.nahled_url });
      potom();
    } catch (err) {
      setChyba(err instanceof Error ? err.message : 'Uložení selhalo');
    } finally {
      setBusy(false);
    }
  };

  const zrus = async () => {
    setBusy(true);
    setChyba(null);
    try {
      await request(`${IG_PATH}/${encodeURIComponent(post.id)}`, { method: 'DELETE' });
      onPost(null);
    } catch (err) {
      setChyba(err instanceof Error ? err.message : 'Zrušení selhalo');
      setBusy(false);
    }
  };

  const komu = TRIALY.find((t) => t.value === (post.trial ?? null));
  const zavri = () => setUprava(null);

  return (
    <>
      <Skupina nadpis="Vydání" pozn={uprava === 'cas' ? <PoznamkaCasu cas={cas} /> : 'Beo ho v ten čas vydá samo, nic nemusí zůstat otevřené'}>
        <Radek label="Čas" value={`${kdyLabel(post.naplanovano_na)} ${casLabel(post.naplanovano_na)}`} open={uprava === 'cas'} onClick={() => otevri('cas')} />
        {uprava === 'cas' ? (
          <div className="pl-ig-inset">
            <VyberCasu cas={cas} setCas={setCas} datum={datum} />
            <div className="pl-ig-row pl-ig-row-btns">
              <button type="button" className="pl-btn" disabled={busy} onClick={zavri}>
                Zrušit
              </button>
              <button
                type="button"
                className="pl-btn is-primary"
                disabled={busy || vMinulosti(cas) || cas === prahaMistne(post.naplanovano_na)}
                onClick={() => void zmen({ naplanovano_na: zPrahy(cas) }, zavri)}
              >
                {busy ? 'Ukládám' : 'Uložit čas'}
              </button>
            </div>
          </div>
        ) : null}
        {post.typ === 'reel' ? (
          <>
            <Radek label="Komu" value={komu?.kratce} open={uprava === 'komu'} onClick={() => otevri('komu')} />
            {uprava === 'komu' ? (
              <div className="pl-ig-inset">
                <Volby options={TRIALY} value={post.trial ?? null} disabled={busy} onPick={(v) => (v === (post.trial ?? null) ? zavri() : void zmen({ trial: v }, zavri))} />
              </div>
            ) : null}
          </>
        ) : null}
      </Skupina>

      <Skupina nadpis="Popisek" pozn={uprava === 'popisek' ? <Pocitadlo text={text} /> : undefined}>
        {uprava === 'popisek' ? (
          <>
            <textarea className="pl-ig-input pl-ig-popisek" value={text} maxLength={MAX_POPISEK} autoFocus aria-label="Popisek" onChange={(e) => setText(e.target.value)} />
            <div className="pl-ig-row pl-ig-row-btns">
              <button type="button" className="pl-btn" disabled={busy} onClick={zavri}>
                Zrušit
              </button>
              <button
                type="button"
                className="pl-btn is-primary"
                disabled={busy || pocetHashtagu(text) > MAX_HASHTAGU || text === post.popisek}
                onClick={() => void zmen({ popisek: text }, zavri)}
              >
                {busy ? 'Ukládám' : 'Uložit popisek'}
              </button>
            </div>
          </>
        ) : (
          <button type="button" className="pl-ig-row is-tap pl-ig-caption" onClick={() => otevri('popisek')}>
            <span className={post.popisek ? 'pl-ig-text' : 'pl-ig-placeholder'}>{post.popisek || 'Bez popisku, klepni a doplň ho'}</span>
            <span className="pl-ig-row-action">Upravit</span>
          </button>
        )}
      </Skupina>

      {chyba ? (
        <p className="pl-ig-chyba" role="alert">
          {chyba}
        </p>
      ) : null}

      {potvrdit === 'hned' ? (
        <Potvrzeni
          text="Příspěvek vyjde do minuty a hned ho uvidí lidé"
          ano="Vydat hned"
          ne="Nechat na původní čas"
          busy={busy}
          onAno={() => void zmen({ naplanovano_na: new Date().toISOString() }, () => setPotvrdit(null))}
          onNe={() => setPotvrdit(null)}
        />
      ) : potvrdit === 'zrusit' ? (
        <Potvrzeni
          text={`${typLabel(post)} nevyjde a nahrané soubory se smažou. Karta v planneru zůstane`}
          ano="Zrušit vydání"
          ne="Nechat naplánované"
          danger
          busy={busy}
          onAno={() => void zrus()}
          onNe={() => setPotvrdit(null)}
        />
      ) : (
        <div className="pl-ig-group">
          <button
            type="button"
            className="pl-ig-row is-tap pl-ig-row-plain"
            onClick={() => {
              zavri();
              setPotvrdit('hned');
            }}
          >
            Vydat hned
          </button>
          <button
            type="button"
            className="pl-ig-row is-tap pl-ig-row-plain is-danger"
            onClick={() => {
              zavri();
              setPotvrdit('zrusit');
            }}
          >
            Zrušit vydání
          </button>
        </div>
      )}
    </>
  );
}

export function InstagramPublikace({
  card,
  request,
  post,
  error,
  onPost,
}: {
  card: PlannerCard;
  request: Request;
  post: IgPost | null;
  /** Beo se nepodařilo zeptat (typicky chybí klíč). */
  error: string | null;
  onPost: (post: IgPost | null) => void;
}) {
  const [opakovat, setOpakovat] = useState(false);

  if (nenapojeno(error)) return <Nenapojeno />;

  const stav = post?.stav;
  const ukazFormular = !post || stav === 'zruseno' || (stav === 'chyba' && opakovat);
  const jenCteni = post && !ukazFormular && stav !== 'ceka';

  return (
    <div className="pl-ig">
      {error ? (
        <p className="pl-ig-chyba" role="alert">
          Beo teď neodpovídá: {error}
        </p>
      ) : null}

      {post && !ukazFormular ? <Souhrn post={post} /> : null}

      {stav === 'ceka' ? <Naplanovany key={post!.id} post={post!} datum={card.datum} request={request} onPost={onPost} /> : null}

      {stav === 'zpracovava' ? (
        <div className="pl-ig-state">
          <div>
            <strong>Instagram video právě zpracovává</strong>
            <p>Obvykle to trvá pár minut, pak vyjde samo</p>
          </div>
        </div>
      ) : null}

      {stav === 'chyba' && !opakovat ? (
        <>
          <div className="pl-ig-state is-bad">
            <span className="pl-ig-state-icon">
              <Icon name="alert" size={18} />
            </span>
            <div>
              <strong>Instagram příspěvek nepřijal</strong>
              <p>{post!.chyba || 'Bez bližšího důvodu'}</p>
            </div>
          </div>
          <button type="button" className="pl-btn is-primary pl-ig-wide" onClick={() => setOpakovat(true)}>
            Nahrát a naplánovat znovu
          </button>
        </>
      ) : null}

      {stav === 'publikovano' && post!.permalink ? (
        <a className="pl-btn pl-ig-wide" href={post!.permalink} target="_blank" rel="noreferrer">
          Otevřít na Instagramu
        </a>
      ) : null}

      {jenCteni && post!.popisek ? (
        <Skupina nadpis="Popisek">
          <div className="pl-ig-row pl-ig-caption">
            <span className="pl-ig-text">{post!.popisek}</span>
          </div>
        </Skupina>
      ) : null}

      {ukazFormular ? (
        <Formular
          datum={card.datum}
          request={request}
          predchozi={post}
          onSend={async (body) => {
            const { post: novyPost } = await request<{ post: IgPost }>(`${PLANNER_PATH}/${encodeURIComponent(card.id)}/instagram`, { method: 'POST', body });
            setOpakovat(false);
            onPost(novyPost);
          }}
        />
      ) : null}
    </div>
  );
}

/** Hotový reel rovnou do kalendáře: karta vznikne až s naplánovaným příspěvkem. */
export function NovyReel({
  request,
  datum,
  error,
  onHotovo,
}: {
  request: Request;
  datum: string | null;
  error: string | null;
  onHotovo: (card: PlannerCard, post: IgPost) => void;
}) {
  if (nenapojeno(error)) return <Nenapojeno />;
  return (
    <div className="pl-ig">
      <Formular
        datum={datum}
        request={request}
        predchozi={null}
        novy
        onSend={async (body) => {
          const res = await request<{ card: PlannerCard; post: IgPost }>(`${IG_PATH}/novy`, { method: 'POST', body });
          onHotovo(res.card, res.post);
        }}
      />
    </div>
  );
}
