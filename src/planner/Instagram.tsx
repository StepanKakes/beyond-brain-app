// Vydání karty na Instagram přes Beo. Soubory jdou z prohlížeče rovnou do
// úložiště Bea (podepsané adresy), server brainu jen předá plán. Stav příspěvků
// drží Planner pro všechny karty najednou, tady se jen kreslí a mění.

import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';

import { Icon } from '../mobile/icons';

import { IG_PATH, PLANNER_PATH, casLabel, denLabel, isoDay, kdyLabel, type IgPost, type PlannerCard, type Request } from './model';

type Ticket = { path: string; typ: 'foto' | 'video'; uploadUrl: string };

const MAX_POPISEK = 2200;
/** Čas po čtvrthodinách, ať se nevybírá v americkém formátu prohlížeče. */
const CASY = Array.from({ length: 24 * 4 }, (_, i) => `${String(Math.floor(i / 4)).padStart(2, '0')}:${String((i % 4) * 15).padStart(2, '0')}`);

function vychoziCas(datum: string | null): string {
  const today = isoDay(new Date());
  const den = datum && datum >= today ? datum : isoDay(new Date(Date.now() + 86_400_000));
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

function Formular({
  card,
  request,
  predchozi,
  onPost,
}: {
  card: PlannerCard;
  request: Request;
  predchozi: IgPost | null;
  onPost: (post: IgPost) => void;
}) {
  const [soubory, setSoubory] = useState<File[]>([]);
  const [cover, setCover] = useState<File | null>(null);
  const [popisek, setPopisek] = useState(predchozi?.popisek || '');
  const [cas, setCas] = useState(() => vychoziCas(card.datum));
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
    setSoubory((cur) => [...cur, ...nove].slice(0, 10));
  };

  const odeslat = async (hned: boolean) => {
    if (!typ) return;
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
      const media = tickety.slice(0, soubory.length).map((t) => ({ path: t.path, typ: t.typ }));
      const coverPath = cover && typ === 'reel' ? tickety[soubory.length]?.path : null;
      setPrace('Plánuju');
      const { post } = await request<{ post: IgPost }>(`${PLANNER_PATH}/${encodeURIComponent(card.id)}/instagram`, {
        method: 'POST',
        body: { typ, popisek, media, cover_path: coverPath, naplanovano_na: hned ? new Date().toISOString() : new Date(cas).toISOString() },
      });
      onPost(post);
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

  const rychle = [
    { label: 'Dnes 18:00', value: `${isoDay(new Date())}T18:00` },
    { label: 'Zítra 18:00', value: `${isoDay(new Date(Date.now() + 86_400_000))}T18:00` },
    ...(card.datum && card.datum > isoDay(new Date(Date.now() + 86_400_000)) ? [{ label: `${denLabel(card.datum)} 18:00`, value: `${card.datum}T18:00` }] : []),
  ];
  const casVMinulosti = cas && new Date(cas).getTime() < Date.now() - 60_000;

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
          <div className="pl-ig-thumbs">
            {soubory.map((file, i) => (
              <Nahled key={urls[i]} file={file} url={urls[i]} onRemove={() => setSoubory((cur) => cur.filter((_, j) => j !== i))} />
            ))}
          </div>
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
          <strong>Nahrát hotový střih nebo fotky</strong>
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

      <div className="pl-ig-label">
        <span>Kdy vyjde</span>
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
            Vyjde {kdyLabel(cas)} v {casLabel(new Date(cas).toISOString())}
          </span>
        ) : casVMinulosti ? (
          <span className="pl-ig-hint is-bad">Čas už minul, příspěvek by vyšel hned</span>
        ) : null}
      </div>

      {chyba ? <p className="pl-ig-chyba">{chyba}</p> : null}

      <div className="pl-ig-actions">
        <button type="button" className="pl-btn is-primary" disabled={!typ || !!prace || !cas} onClick={() => void odeslat(false)}>
          {prace || 'Naplánovat na Instagram'}
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

  return (
    <div className="pl-ig">
      {stav === 'ceka' ? (
        <div className="pl-ig-box">
          <Icon name="clock" size={18} />
          <div>
            <strong>
              Vyjde {kdyLabel(post!.naplanovano_na)} v {casLabel(post!.naplanovano_na)}
            </strong>
            <p>{post!.typ === 'reel' ? 'Reel' : post!.typ === 'foto' ? 'Fotka' : 'Carousel'} čeká v Beovi, v ten čas ho samo vydá.</p>
            {post!.popisek ? <p className="pl-ig-quote">{post!.popisek}</p> : null}
          </div>
          <button type="button" className="pl-btn" disabled={rusim} onClick={() => void zrus()}>
            Zrušit
          </button>
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
            <strong>Vyšlo {post!.publikovano_at ? `${kdyLabel(post!.publikovano_at)} v ${casLabel(post!.publikovano_at)}` : ''}</strong>
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

      {ukazFormular ? <Formular card={card} request={request} predchozi={post} onPost={(p) => { setOpakovat(false); onPost(p); }} /> : null}
    </div>
  );
}
