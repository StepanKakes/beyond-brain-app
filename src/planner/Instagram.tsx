// Vydání karty na Instagram přes Beo. Soubory jdou z prohlížeče rovnou do
// úložiště Bea (podepsané adresy), server brainu jen předá plán. Stav příspěvků
// drží Planner pro všechny karty najednou, tady se jen kreslí a mění.

import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';

import { Icon } from '../mobile/icons';

import { IG_PATH, PLANNER_PATH, casLabel, denLabel, jinePasmo, kdyLabel, kdyPopis, mistniCas, prahaDen, prahaDenZa, zPrahy, type IgPost, type PlannerCard, type Request } from './model';

type Ticket = { path: string; typ: 'foto' | 'video'; uploadUrl: string };

const MAX_POPISEK = 2200;
/** Čas po čtvrthodinách, ať se nevybírá v americkém formátu prohlížeče. */
const CASY = Array.from({ length: 24 * 4 }, (_, i) => `${String(Math.floor(i / 4)).padStart(2, '0')}:${String((i % 4) * 15).padStart(2, '0')}`);

function vychoziCas(datum: string | null): string {
  const today = prahaDen();
  const den = datum && datum >= today ? datum : prahaDenZa(1);
  return `${den}T18:00`;
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

/** Náhledy vybraných souborů. Adresy se po odebrání uvolní. */
function useNahledy(files: File[]) {
  const urls = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
  useEffect(() => () => urls.forEach((u) => URL.revokeObjectURL(u)), [urls]);
  return urls;
}

function Nahled({ file, url, onRemove }: { file: File; url: string; onRemove: () => void }) {
  return (
    <div className="pl-ig-thumb">
      {file.type.startsWith('video/') ? (
        <video src={`${url}#t=0.1`} muted playsInline preload="metadata" />
      ) : (
        <img src={url} alt="" />
      )}
      {file.type.startsWith('video/') ? (
        <span className="pl-ig-thumb-kind">
          <Icon name="video" size={12} />
        </span>
      ) : null}
      <button type="button" className="pl-ig-thumb-x" aria-label={`Odebrat ${file.name}`} onClick={onRemove}>
        <Icon name="close" size={12} />
      </button>
    </div>
  );
}

type Trial = 'manual' | 'auto' | null;
type Odeslani = {
  typ: IgPost['typ'];
  popisek: string;
  media: { path: string; typ: 'foto' | 'video' }[];
  cover_path: string | null;
  trial: Trial;
  naplanovano_na: string;
};

const TRIALY: { value: Trial; label: string; hint: string }[] = [
  { value: null, label: 'Klasický', hint: 'Uvidí ho sledující i ostatní' },
  { value: 'manual', label: 'Trial, pustím sám', hint: 'Nejdřív jen lidem, kteří tě nesledují. Sledujícím ho pustíš v Instagramu' },
  { value: 'auto', label: 'Trial, pustí Instagram', hint: 'Nejdřív jen lidem, kteří tě nesledují. Když se mu bude dařit, Instagram ho pustí i sledujícím' },
];

/** Název karty z názvu souboru: bez přípony, podtržítek a pomlček. */
function nazevZeSouboru(file: File): string {
  return file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
}

/** Den a čas vydání, vždy v Praze. Rychlé volby plus libovolný den a čtvrthodina. */
function VyberCasu({ cas, setCas, datum }: { cas: string; setCas: (cas: string) => void; datum: string | null }) {
  const rychle = [
    { label: 'Dnes 18:00', value: `${prahaDen()}T18:00` },
    { label: 'Zítra 18:00', value: `${prahaDenZa(1)}T18:00` },
    ...(datum && datum > prahaDenZa(1) ? [{ label: `${denLabel(datum)} 18:00`, value: `${datum}T18:00` }] : []),
  ];
  const casVMinulosti = cas && new Date(zPrahy(cas)).getTime() < Date.now() - 60_000;

  return (
    <div className="pl-ig-label">
      <span>Kdy vyjde, český čas</span>
      <div className="pl-ig-when">
        {rychle.map((r) => (
          <button key={r.value} type="button" className={`pl-chip${cas === r.value ? ' is-on' : ''}`} onClick={() => setCas(r.value)}>
            {r.label}
          </button>
        ))}
        <label className="pl-ig-den">
          <Icon name="calendar" size={14} />
          {denLabel(cas.slice(0, 10))}
          <input type="date" aria-label="Jiný den" value={cas.slice(0, 10)} onChange={(e) => e.target.value && setCas(`${e.target.value}T${cas.slice(11, 16) || '18:00'}`)} />
        </label>
        <select className="pl-ig-cas" aria-label="Čas" value={cas.slice(11, 16)} onChange={(e) => setCas(`${cas.slice(0, 10)}T${e.target.value}`)}>
          {CASY.includes(cas.slice(11, 16)) ? null : <option value={cas.slice(11, 16)}>{cas.slice(11, 16)}</option>}
          {CASY.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>
      {cas && !casVMinulosti ? (
        <span className="pl-ig-hint">
          Vyjde {kdyPopis(zPrahy(cas))}
        </span>
      ) : casVMinulosti ? (
        <span className="pl-ig-hint is-bad">Čas už minul, příspěvek by vyšel hned</span>
      ) : null}
    </div>
  );
}

/** Čas vydání v Praze jako YYYY-MM-DDTHH:mm, pro výběr času. */
function prahaMistne(iso: string): string {
  return `${prahaDen(iso)}T${casLabel(iso)}`;
}

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
  /** Nový reel bez karty: formulář chce i název. */
  novy?: boolean;
  onSend: (body: Odeslani & { nazev?: string }) => Promise<void>;
}) {
  const [soubory, setSoubory] = useState<File[]>([]);
  const [cover, setCover] = useState<File | null>(null);
  const [popisek, setPopisek] = useState(predchozi?.popisek || '');
  const [nazev, setNazev] = useState('');
  const [trial, setTrial] = useState<Trial>(predchozi?.trial ?? null);
  const [cas, setCas] = useState(() => vychoziCas(datum));
  const [prace, setPrace] = useState<string | null>(null);
  const [chyba, setChyba] = useState<string | null>(null);
  const [nadZonou, setNadZonou] = useState(false);
  const vstup = useRef<HTMLInputElement>(null);
  const urls = useNahledy(soubory);
  const coverUrls = useNahledy(useMemo(() => (cover ? [cover] : []), [cover]));

  const videa = soubory.filter((f) => f.type.startsWith('video/')).length;
  const typ: IgPost['typ'] | null = soubory.length === 0 ? null : soubory.length > 1 ? 'carousel' : videa ? 'reel' : 'foto';
  const typLabel = typ === 'reel' ? 'Reel' : typ === 'foto' ? 'Fotka' : typ === 'carousel' ? `Carousel, ${soubory.length} položek` : null;
  const hashtagy = (popisek.match(/#/g) || []).length;

  const pridej = (files: FileList | File[]) => {
    const nove = vhodne(files);
    if (!nove.length) {
      setChyba('Instagram bere fotky a videa MP4 nebo MOV');
      return;
    }
    setChyba(null);
    if (novy && !nazev && !soubory.length) setNazev(nazevZeSouboru(nove[0]));
    setSoubory((cur) => [...cur, ...nove].slice(0, 10));
  };

  const odeslat = async (hned: boolean) => {
    if (!typ) return;
    if (novy && !nazev.trim()) {
      setChyba('Doplň název, pod ním bude reel v planneru');
      return;
    }
    setChyba(null);
    try {
      setPrace('Připravuju soubory');
      const vse = cover && typ === 'reel' ? [...soubory, cover] : soubory;
      const bloby = await Promise.all(vse.map(priprav));
      const { soubory: tickety } = await request<{ soubory: Ticket[] }>(`${IG_PATH}/nahrani`, {
        method: 'POST',
        body: { soubory: bloby.map((b) => ({ typ: b.type })) },
      });
      for (let i = 0; i < tickety.length; i++) {
        setPrace(tickety.length > 1 ? `Nahrávám ${i + 1} z ${tickety.length}` : 'Nahrávám');
        const res = await fetch(tickety[i].uploadUrl, {
          method: 'PUT',
          headers: { 'Content-Type': bloby[i].type, 'x-upsert': 'false' },
          body: bloby[i],
        });
        if (!res.ok) throw new Error(`Nahrání souboru ${i + 1} selhalo (${res.status})`);
      }
      setPrace('Plánuju');
      await onSend({
        ...(novy ? { nazev: nazev.trim() } : {}),
        typ,
        popisek,
        media: tickety.slice(0, soubory.length).map((t) => ({ path: t.path, typ: t.typ })),
        cover_path: cover && typ === 'reel' ? tickety[soubory.length]?.path ?? null : null,
        trial: typ === 'reel' ? trial : null,
        naplanovano_na: hned ? new Date().toISOString() : zPrahy(cas),
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

  return (
    <div className="pl-ig-form">
      {soubory.length ? (
        <div className="pl-ig-media">
          <div className="pl-ig-media-head">
            <span className="pl-ig-typ">{typLabel}</span>
            <button type="button" className="pl-textbtn" onClick={() => vstup.current?.click()} disabled={soubory.length >= 10}>
              Přidat další
            </button>
          </div>
          {typ === 'reel' ? (
            <div className="pl-ig-player">
              <video key={urls[0]} src={urls[0]} controls playsInline preload="metadata" />
              <button type="button" className="pl-ig-thumb-x" aria-label={`Odebrat ${soubory[0].name}`} onClick={() => setSoubory([])}>
                <Icon name="close" size={12} />
              </button>
            </div>
          ) : (
            <div className="pl-ig-thumbs">
              {soubory.map((file, i) => (
                <Nahled key={urls[i]} file={file} url={urls[i]} onRemove={() => setSoubory((cur) => cur.filter((_, j) => j !== i))} />
              ))}
            </div>
          )}
          {typ === 'reel' ? (
            <div className="pl-ig-cover">
              {cover ? (
                <>
                  <img src={coverUrls[0]} alt="" />
                  <span>Vlastní cover</span>
                  <button type="button" className="pl-textbtn" onClick={() => setCover(null)}>
                    Odebrat
                  </button>
                </>
              ) : (
                <label className="pl-textbtn">
                  Vybrat cover
                  <input type="file" accept="image/*" hidden onChange={(e) => setCover(e.target.files?.[0] ?? null)} />
                </label>
              )}
              {!cover ? <span className="pl-ig-hint">Bez coveru vezme Instagram první snímek</span> : null}
            </div>
          ) : null}
        </div>
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
          <Icon name="gallery" size={22} />
          <strong>{novy ? 'Přetáhni sem hotový reel' : 'Nahrát hotový střih nebo fotky'}</strong>
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
        <label className="pl-ig-label">
          <span>Název v planneru</span>
          <input className="pl-field-input" value={nazev} maxLength={300} placeholder="O čem reel je" onChange={(e) => setNazev(e.target.value)} />
        </label>
      ) : null}

      {typ === 'reel' ? (
        <div className="pl-ig-label">
          <span>Komu ho Instagram ukáže</span>
          <span className="pl-seg pl-ig-trial" role="radiogroup" aria-label="Trial reel">
            {TRIALY.map((t) => (
              <button key={t.label} type="button" role="radio" aria-checked={trial === t.value} className={trial === t.value ? 'is-on' : ''} onClick={() => setTrial(t.value)}>
                {t.label}
              </button>
            ))}
          </span>
          <span className="pl-ig-hint">{TRIALY.find((t) => t.value === trial)?.hint}</span>
        </div>
      ) : null}

      <label className="pl-ig-label">
        <span>Popisek</span>
        <textarea
          className="pl-ig-popisek"
          value={popisek}
          maxLength={MAX_POPISEK}
          placeholder="Text pod příspěvkem, hashtagy na konec"
          onChange={(e) => setPopisek(e.target.value)}
        />
        <span className={`pl-ig-count${hashtagy > 30 ? ' is-bad' : ''}`}>
          {hashtagy ? `${hashtagy} z 30 hashtagů, ` : ''}
          {popisek.length} z {MAX_POPISEK}
        </span>
      </label>

      <VyberCasu cas={cas} setCas={setCas} datum={datum} />

      {chyba ? <p className="pl-ig-chyba">{chyba}</p> : null}

      <div className="pl-ig-actions">
        <button type="button" className="pl-btn is-primary" disabled={!typ || !!prace || !cas} onClick={() => void odeslat(false)}>
          {prace || (trial && typ === 'reel' ? 'Naplánovat trial reel' : 'Naplánovat na Instagram')}
        </button>
        {!prace ? (
          <button type="button" className="pl-btn" disabled={!typ} onClick={() => void odeslat(true)}>
            Vydat hned
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** Popisek čekajícího příspěvku celý, a dokud nevyšel, i k úpravě. */
function Popisek({ post, request, onPost }: { post: IgPost; request: Request; onPost: (post: IgPost | null) => void }) {
  const [upravuju, setUpravuju] = useState(false);
  const [text, setText] = useState(post.popisek);
  const [ukladam, setUkladam] = useState(false);
  const [chyba, setChyba] = useState<string | null>(null);
  const hashtagy = (text.match(/#/g) || []).length;

  const uloz = async () => {
    setUkladam(true);
    setChyba(null);
    try {
      const res = await request<{ post: IgPost }>(`${IG_PATH}/${encodeURIComponent(post.id)}`, { method: 'PATCH', body: { popisek: text } });
      onPost({ ...res.post, nahled_url: post.nahled_url });
      setUpravuju(false);
    } catch (err) {
      setChyba(err instanceof Error ? err.message : 'Uložení selhalo');
    } finally {
      setUkladam(false);
    }
  };

  if (!upravuju) {
    return (
      <div className="pl-ig-label">
        <span className="pl-ig-label-row">
          <span>Popisek</span>
          <button type="button" className="pl-textbtn" onClick={() => { setText(post.popisek); setUpravuju(true); }}>
            Upravit
          </button>
        </span>
        {post.popisek ? <p className="pl-ig-text">{post.popisek}</p> : <p className="pl-ig-hint">Bez popisku</p>}
      </div>
    );
  }
  return (
    <div className="pl-ig-label">
      <span>Popisek</span>
      <textarea className="pl-ig-popisek" value={text} maxLength={MAX_POPISEK} autoFocus onChange={(e) => setText(e.target.value)} />
      <span className={`pl-ig-count${hashtagy > 30 ? ' is-bad' : ''}`}>
        {hashtagy ? `${hashtagy} z 30 hashtagů, ` : ''}
        {text.length} z {MAX_POPISEK}
      </span>
      {chyba ? <p className="pl-ig-chyba">{chyba}</p> : null}
      <div className="pl-ig-actions">
        <button type="button" className="pl-btn is-primary" disabled={ukladam || hashtagy > 30} onClick={() => void uloz()}>
          {ukladam ? 'Ukládám' : 'Uložit popisek'}
        </button>
        <button type="button" className="pl-btn" disabled={ukladam} onClick={() => setUpravuju(false)}>
          Zrušit úpravu
        </button>
      </div>
    </div>
  );
}

/** Nový čas pro reel, který ještě čeká. Média zůstávají, mění se jen kdy. */
function ZmenaCasu({
  post,
  datum,
  request,
  onPost,
  onHotovo,
}: {
  post: IgPost;
  datum: string | null;
  request: Request;
  onPost: (post: IgPost | null) => void;
  onHotovo: () => void;
}) {
  const [cas, setCas] = useState(() => prahaMistne(post.naplanovano_na));
  const [ukladam, setUkladam] = useState(false);
  const [chyba, setChyba] = useState<string | null>(null);

  const uloz = async () => {
    setUkladam(true);
    setChyba(null);
    try {
      const res = await request<{ post: IgPost }>(`${IG_PATH}/${encodeURIComponent(post.id)}`, {
        method: 'PATCH',
        body: { naplanovano_na: zPrahy(cas) },
      });
      onPost({ ...res.post, nahled_url: post.nahled_url });
      onHotovo();
    } catch (err) {
      setChyba(err instanceof Error ? err.message : 'Změna času selhala');
    } finally {
      setUkladam(false);
    }
  };

  return (
    <div className="pl-ig-form">
      <VyberCasu cas={cas} setCas={setCas} datum={datum} />
      {chyba ? <p className="pl-ig-chyba">{chyba}</p> : null}
      <div className="pl-ig-actions">
        <button type="button" className="pl-btn is-primary" disabled={ukladam} onClick={() => void uloz()}>
          {ukladam ? 'Ukládám' : 'Uložit nový čas'}
        </button>
        <button type="button" className="pl-btn" disabled={ukladam} onClick={onHotovo}>
          Nechat původní
        </button>
      </div>
    </div>
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
  const [rusim, setRusim] = useState(false);
  const [menimCas, setMenimCas] = useState(false);
  const [chyba, setChyba] = useState<string | null>(null);

  const zrus = async () => {
    if (!post) return;
    setRusim(true);
    try {
      await request(`${IG_PATH}/${encodeURIComponent(post.id)}`, { method: 'DELETE' });
      onPost(null);
    } catch (err) {
      setChyba(err instanceof Error ? err.message : 'Zrušení selhalo');
    } finally {
      setRusim(false);
    }
  };

  if (error && /chybí napojení|chybí klíč/i.test(error)) {
    return (
      <div className="pl-ig-box">
        <Icon name="link" size={18} />
        <div>
          <strong>Brain není napojený na Beo</strong>
          <p>Připoj Beo v Konektorech, nebo vlož klíč z Bea v Agent, Napojení a klíče, Beo.</p>
        </div>
      </div>
    );
  }

  const stav = post?.stav;
  const ukazFormular = !post || stav === 'zruseno' || ((stav === 'chyba') && opakovat);

  const nahled = post?.nahled_url && stav !== 'publikovano' && stav !== 'zruseno' && !ukazFormular ? post.nahled_url : null;

  return (
    <div className="pl-ig">
      {nahled ? (
        <div className="pl-ig-player">
          {post!.typ === 'foto' ? <img src={nahled} alt="" /> : <video src={nahled} controls playsInline preload="metadata" />}
        </div>
      ) : null}

      {stav === 'ceka' ? (
        <div className="pl-ig-box">
          <Icon name="clock" size={18} />
          <div>
            <strong>
              Vyjde {kdyLabel(post!.naplanovano_na)} v {casLabel(post!.naplanovano_na)} českého času
            </strong>
            {jinePasmo(post!.naplanovano_na) ? <p>U tebe to bude {mistniCas(post!.naplanovano_na)}</p> : null}
            <p>{post!.trial ? 'Trial reel' : post!.typ === 'reel' ? 'Reel' : post!.typ === 'foto' ? 'Fotka' : 'Carousel'} čeká v Beovi, v ten čas ho samo vydá.</p>
            {post!.trial ? <p>{TRIALY.find((t) => t.value === post!.trial)?.hint}</p> : null}
          </div>
          <span className="pl-ig-box-btns">
            {!menimCas ? (
              <button type="button" className="pl-btn" onClick={() => setMenimCas(true)}>
                Změnit čas
              </button>
            ) : null}
            <button type="button" className="pl-btn" disabled={rusim} onClick={() => void zrus()}>
              Zrušit
            </button>
          </span>
        </div>
      ) : null}

      {stav === 'ceka' && menimCas ? (
        <ZmenaCasu post={post!} datum={card.datum} request={request} onPost={onPost} onHotovo={() => setMenimCas(false)} />
      ) : null}

      {stav === 'ceka' ? <Popisek post={post!} request={request} onPost={onPost} /> : null}
      {post && stav !== 'ceka' && stav !== 'zruseno' && post.popisek && !ukazFormular ? (
        <div className="pl-ig-label">
          <span>Popisek</span>
          <p className="pl-ig-text">{post.popisek}</p>
        </div>
      ) : null}

      {stav === 'zpracovava' ? (
        <div className="pl-ig-box">
          <Icon name="video" size={18} />
          <div>
            <strong>Instagram to právě zpracovává</strong>
            <p>Video obvykle trvá pár minut, pak vyjde samo.</p>
          </div>
        </div>
      ) : null}

      {stav === 'publikovano' ? (
        <div className="pl-ig-box is-done">
          <Icon name="check" size={18} />
          <div>
            <strong>Vyšlo {post!.publikovano_at ? `${kdyLabel(post!.publikovano_at)} v ${casLabel(post!.publikovano_at)} českého času` : ''}</strong>
            {post!.permalink ? (
              <a className="pl-link" href={post!.permalink} target="_blank" rel="noreferrer">
                Otevřít na Instagramu
              </a>
            ) : null}
          </div>
        </div>
      ) : null}

      {stav === 'chyba' ? (
        <div className="pl-ig-box is-bad">
          <Icon name="alert" size={18} />
          <div>
            <strong>Nevyšlo</strong>
            <p>{post!.chyba || 'Instagram příspěvek nepřijal'}</p>
          </div>
          {!opakovat ? (
            <button type="button" className="pl-btn" onClick={() => setOpakovat(true)}>
              Zkusit znovu
            </button>
          ) : null}
        </div>
      ) : null}

      {chyba ? <p className="pl-ig-chyba">{chyba}</p> : null}
      {error && !/chybí napojení|chybí klíč/i.test(error) ? <p className="pl-ig-chyba">Beo neodpovídá: {error}</p> : null}

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
  if (error && /chybí napojení|chybí klíč/i.test(error)) {
    return (
      <div className="pl-ig-box">
        <Icon name="link" size={18} />
        <div>
          <strong>Brain není napojený na Beo</strong>
          <p>Připoj Beo v Konektorech, nebo vlož klíč z Bea v Agent, Napojení a klíče, Beo.</p>
        </div>
      </div>
    );
  }
  return (
    <div className="pl-ig">
      <p className="pl-ig-hint">Karta se v planneru objeví rovnou v Naplánováno, Beo reel v ten čas vydá samo</p>
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
