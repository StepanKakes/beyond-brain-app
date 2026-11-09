// Publikace karty na Instagram přes Beo. Soubory jdou z prohlížeče rovnou do
// úložiště Bea (podepsané adresy), server brainu jen předá plán.

import { useCallback, useEffect, useState } from 'react';

import { PLANNER_PATH, type PlannerCard, type Request } from './model';

type Post = {
  id: string;
  typ: 'foto' | 'reel' | 'carousel';
  stav: 'ceka' | 'zpracovava' | 'publikovano' | 'chyba' | 'zruseno';
  naplanovano_na: string;
  publikovano_at: string | null;
  permalink: string | null;
  chyba: string | null;
  popisek: string;
};

type Ticket = { path: string; typ: 'foto' | 'video'; uploadUrl: string };

const IG_PATH = `${PLANNER_PATH}/instagram`;

const kdy = (iso: string) =>
  new Date(iso).toLocaleString('cs-CZ', { weekday: 'short', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });

function vychoziCas(datum: string | null): string {
  const zitra = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  const den = datum && datum >= new Date().toISOString().slice(0, 10) ? datum : zitra;
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

export function InstagramPublikace({ card, request }: { card: PlannerCard; request: Request }) {
  const [post, setPost] = useState<Post | null>(null);
  const [nacteno, setNacteno] = useState(false);
  const [chyba, setChyba] = useState<string | null>(null);
  const [soubory, setSoubory] = useState<File[]>([]);
  const [cover, setCover] = useState<File | null>(null);
  const [popisek, setPopisek] = useState('');
  const [cas, setCas] = useState(() => vychoziCas(card.datum));
  const [prace, setPrace] = useState<string | null>(null);

  const nacti = useCallback(async () => {
    try {
      const res = await request<{ posty: Record<string, Post> }>(`${IG_PATH}?ids=${encodeURIComponent(card.id)}`);
      setPost(res.posty?.[card.id] ?? null);
      setChyba(null);
    } catch (err) {
      setChyba(err instanceof Error ? err.message : 'Beo neodpovědělo');
    } finally {
      setNacteno(true);
    }
  }, [card.id, request]);

  useEffect(() => {
    void nacti();
  }, [nacti]);

  // Dokud příspěvek vychází, stav se obnovuje sám.
  useEffect(() => {
    if (post?.stav !== 'ceka' && post?.stav !== 'zpracovava') return;
    const t = window.setInterval(() => void nacti(), 30_000);
    return () => window.clearInterval(t);
  }, [post?.stav, nacti]);

  const videa = soubory.filter((f) => f.type.startsWith('video/')).length;
  const typ: Post['typ'] | null =
    soubory.length === 0 ? null : soubory.length > 1 ? 'carousel' : videa ? 'reel' : 'foto';

  const naplanuj = async () => {
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
        setPrace(`Nahrávám ${i + 1} z ${tickety.length}`);
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
      const { post: novy } = await request<{ post: Post }>(`${PLANNER_PATH}/${encodeURIComponent(card.id)}/instagram`, {
        method: 'POST',
        body: { typ, popisek, media, cover_path: coverPath, naplanovano_na: new Date(cas).toISOString() },
      });
      setPost(novy);
      setSoubory([]);
      setCover(null);
    } catch (err) {
      setChyba(err instanceof Error ? err.message : 'Naplánování selhalo');
    } finally {
      setPrace(null);
    }
  };

  const zrus = async () => {
    if (!post) return;
    try {
      await request(`${IG_PATH}/${encodeURIComponent(post.id)}`, { method: 'DELETE' });
      setPost(null);
    } catch (err) {
      setChyba(err instanceof Error ? err.message : 'Zrušení selhalo');
    }
  };

  if (!nacteno) return null;

  const zive = post && (post.stav === 'ceka' || post.stav === 'zpracovava' || post.stav === 'publikovano');

  return (
    <section className="pl-ig">
      <div className="pl-script-head">
        <h3>Instagram</h3>
        {post?.stav === 'ceka' ? (
          <button type="button" className="pl-btn" onClick={zrus}>Zrušit</button>
        ) : null}
      </div>

      {post?.stav === 'ceka' ? <p className="pl-ig-stav">Naplánováno na {kdy(post.naplanovano_na)}</p> : null}
      {post?.stav === 'zpracovava' ? <p className="pl-ig-stav">Instagram to právě zpracovává</p> : null}
      {post?.stav === 'publikovano' ? (
        <p className="pl-ig-stav">
          Vyšlo {post.publikovano_at ? kdy(post.publikovano_at) : ''}
          {post.permalink ? (
            <>
              {' · '}
              <a className="pl-link" href={post.permalink} target="_blank" rel="noreferrer">Otevřít</a>
            </>
          ) : null}
        </p>
      ) : null}
      {post?.stav === 'chyba' ? <p className="pl-ig-chyba">Nevyšlo: {post.chyba}</p> : null}
      {chyba ? <p className="pl-ig-chyba">{chyba}</p> : null}

      {!zive ? (
        <div className="pl-ig-form">
          <label className="pl-field">
            <span className="pl-field-label">{typ === 'carousel' ? `Carousel, ${soubory.length} položek` : typ === 'reel' ? 'Reel' : typ === 'foto' ? 'Fotka' : 'Video nebo fotky'}</span>
            <input
              className="pl-field-input"
              type="file"
              multiple
              accept="image/*,video/mp4,video/quicktime"
              onChange={(e) => setSoubory(Array.from(e.target.files || []).slice(0, 10))}
            />
          </label>
          {typ === 'reel' ? (
            <label className="pl-field">
              <span className="pl-field-label">Cover (nepovinné)</span>
              <input className="pl-field-input" type="file" accept="image/*" onChange={(e) => setCover(e.target.files?.[0] ?? null)} />
            </label>
          ) : null}
          <label className="pl-field">
            <span className="pl-field-label">Vydat</span>
            <input className="pl-field-input" type="datetime-local" value={cas} onChange={(e) => setCas(e.target.value)} />
          </label>
          <textarea
            className="pl-script-edit pl-ig-popisek"
            value={popisek}
            maxLength={2200}
            placeholder="Popisek"
            onChange={(e) => setPopisek(e.target.value)}
          />
          <button type="button" className="pl-btn is-primary" disabled={!typ || !!prace || !cas} onClick={naplanuj}>
            {prace || 'Naplánovat na Instagram'}
          </button>
        </div>
      ) : null}
    </section>
  );
}
