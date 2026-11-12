// Most z content planneru do Bea: nahrání médií a naplánování příspěvku na
// Instagram. Vydává Beo (cron každou minutu), tady se jen předává.
//
// Klíč je MCP klíč z Bea (Nastavení, MCP), zadává se v appce na obrazovce
// Agent, Napojení a klíče. Bez klíče se použije OAuth token konektoru Bea
// (Konektory). Do prohlížeče se nikdy neposílá: prohlížeč dostane
// jen jednorázové podepsané adresy pro nahrání souborů.

import * as planner from './beyond-planner.js';
import { listConnectors } from './beyond-mcp-connectors-store.js';
import { refreshIfNeeded } from './beyond-mcp-oauth.js';

// Konektor Bea přidaný v Konektorech přes OAuth: stačí místo klíče.
async function tokenKonektoru(beoUrl) {
  const host = new URL(beoUrl).hostname.split('.').slice(-2).join('.');
  const konektory = await listConnectors();
  const beoKonektor = konektory.find(
    (c) => c.enabled !== false && c.auth === 'oauth' && c.url &&
      (/beo/i.test(c.name || '') || /beo/i.test(c.url)) && c.url.includes(host),
  ) || konektory.find((c) => c.enabled !== false && c.auth === 'oauth' && /beo/i.test(`${c.name} ${c.url}`));
  if (!beoKonektor) return null;
  return refreshIfNeeded(beoKonektor).catch(() => null);
}

async function prihlaseni() {
  const url = (process.env.BEYOND_BEO_URL || 'https://app.growbeyond.cz').replace(/\/+$/, '');
  const key = process.env.BEYOND_BEO_API_KEY || '';
  if (key) return { url, headers: { 'X-Api-Key': key } };
  const token = await tokenKonektoru(url);
  if (token) return { url, headers: { Authorization: `Bearer ${token}` } };
  throw new Error('Chybí napojení na Beo (Konektory, Beo, Připojit, nebo klíč v Napojení a klíče)');
}

async function volej(cesta, { method = 'GET', body } = {}) {
  const { url, headers } = await prihlaseni();
  const res = await fetch(`${url}/api/integrations/planner${cesta}`, {
    method,
    headers: { ...headers, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error || `Beo odpovědělo ${res.status}`);
  return json;
}

/** Podepsané adresy pro nahrání: [{ path, typ, uploadUrl }]. */
export async function nahrani(soubory) {
  return volej('/nahrani', { method: 'POST', body: { soubory } });
}

/** Karta, která čeká na vydání, patří do Naplánováno. Vydané se nevrací. */
function stavPoNaplanovani(card) {
  return card.stav === 'Vydáno' ? null : 'Naplánováno';
}

function denVPraze(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Prague' });
}

export async function naplanuj(cardId, input) {
  const card = planner.list().karty.find((c) => c.id === cardId);
  if (!card) throw new Error('karta neexistuje');
  const { post } = await volej('/posty', {
    method: 'POST',
    body: {
      planner_id: cardId,
      nazev: card.nazev,
      typ: input.typ,
      popisek: input.popisek || '',
      media: input.media || [],
      cover_path: input.cover_path || null,
      trial: input.typ === 'reel' && (input.trial === 'manual' || input.trial === 'auto') ? input.trial : null,
      naplanovano_na: input.naplanovano_na,
    },
  });
  // Datum karty drží den vydání, ať kalendář sedí s tím, co je v Beovi.
  const zmena = {};
  const den = denVPraze(input.naplanovano_na);
  if (den && card.datum !== den) zmena.datum = den;
  const stav = stavPoNaplanovani(card);
  if (stav && card.stav !== stav) zmena.stav = stav;
  if (Object.keys(zmena).length) await planner.update(cardId, zmena, { by: 'beo' }).catch(() => {});
  return post;
}

/** Nový reel rovnou k vydání: karta vznikne až s naplánovaným příspěvkem. */
export async function novy(input) {
  const nazev = String(input.nazev || '').trim();
  if (!nazev) throw new Error('název chybí');
  const card = await planner.add(
    { nazev, platforma: 'Reels', stav: 'Naplánováno', datum: denVPraze(input.naplanovano_na) },
    { by: 'app' },
  );
  try {
    const post = await naplanuj(card.id, input);
    return { card: planner.list().karty.find((c) => c.id === card.id) || card, post };
  } catch (err) {
    await planner.remove(card.id, { by: 'app' }).catch(() => {});
    throw err;
  }
}

export async function zrus(postId) {
  return volej(`/posty/${encodeURIComponent(postId)}`, { method: 'DELETE' });
}

export async function uprav(postId, input) {
  const body = {};
  if (typeof input.popisek === 'string') body.popisek = input.popisek;
  if (input.naplanovano_na !== undefined) body.naplanovano_na = input.naplanovano_na;
  if (input.trial !== undefined) body.trial = input.trial;
  const { post } = await volej(`/posty/${encodeURIComponent(postId)}`, { method: 'PATCH', body });
  // Den karty jde s časem reelu, ať kalendář ukazuje, kdy opravdu vyjde.
  const den = body.naplanovano_na ? denVPraze(post?.naplanovano_na) : null;
  const card = den && post?.planner_id ? planner.list().karty.find((c) => c.id === post.planner_id) : null;
  if (card && card.datum !== den) await planner.update(card.id, { datum: den }, { by: 'beo' }).catch(() => {});
  return post;
}

/** Hodiny a minuty v Praze, HH:mm. */
function casVPraze(iso) {
  return new Date(iso).toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Prague' });
}

/** Čas zadaný v Praze (YYYY-MM-DDTHH:mm) jako okamžik ISO. */
function zPrahy(local) {
  const odhad = new Date(`${local}:00Z`);
  const praha = new Date(odhad.toLocaleString('en-US', { timeZone: 'Europe/Prague' }));
  const utc = new Date(odhad.toLocaleString('en-US', { timeZone: 'UTC' }));
  return new Date(odhad.getTime() - (praha.getTime() - utc.getTime())).toISOString();
}

/**
 * Karta se přesunula na jiný den. Čekající reel jde s ní, ve stejnou hodinu.
 * Vrací nový příspěvek, nebo null, když nebylo co posouvat.
 */
export async function posunKeKarte(cardId, datum) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(datum || ''))) return null;
  let out;
  try {
    out = await volej(`/posty?planner=${encodeURIComponent(cardId)}`);
  } catch (err) {
    if (/chybí napojení/i.test(err?.message || '')) return null;
    throw err;
  }
  const post = out.posty?.[cardId];
  if (!post || post.stav !== 'ceka' || denVPraze(post.naplanovano_na) === datum) return null;
  const { post: novy } = await volej(`/posty/${encodeURIComponent(post.id)}`, {
    method: 'PATCH',
    body: { naplanovano_na: zPrahy(`${datum}T${casVPraze(post.naplanovano_na)}`) },
  });
  return { ...novy, nahled_url: post.nahled_url };
}

/**
 * Smazaná karta nesmí v Beovi nechat čekat příspěvek, jinak by vyšel.
 * Vrací true, když něco zrušila. Bez napojení na Beo není co rušit.
 */
export async function zrusKeKarte(cardId) {
  let out;
  try {
    out = await volej(`/posty?planner=${encodeURIComponent(cardId)}`);
  } catch (err) {
    if (/chybí napojení/i.test(err?.message || '')) return false;
    throw err;
  }
  const post = out.posty?.[cardId];
  if (!post) return false;
  if (post.stav === 'zpracovava') throw new Error('Reel právě vychází, kartu smaž, až vyjde');
  if (post.stav !== 'ceka' && post.stav !== 'chyba') return false;
  await zrus(post.id);
  return true;
}

/**
 * Stav příspěvků ke kartám. Co v Beovi vyšlo, se v planneru posune na Vydáno,
 * ať se to nemusí přepínat ručně. Příspěvek, ke kterému karta není (naplánoval
 * ho konektor Bea z jiné konverzace), si kartu založí, ať je všechno na jednom
 * místě.
 */
export async function stav(ids) {
  const out = await volej(`/posty?vse=1&planner=${encodeURIComponent(ids.join(','))}`);
  const karty = planner.list().karty;
  let pribylo = 0;
  for (const [id, post] of Object.entries(out.posty || {})) {
    const card = karty.find((c) => c.id === id);
    if (!card) {
      if (post?.stav === 'zruseno' || !/^p-[0-9a-f]{8}$/.test(id) || planner.hasId(id)) continue;
      await planner
        .add(
          {
            id,
            nazev: post.nazev || (post.typ === 'reel' ? 'Reel z Bea' : 'Příspěvek z Bea'),
            platforma: 'Reels',
            stav: post.stav === 'publikovano' ? 'Vydáno' : 'Naplánováno',
            datum: denVPraze(post.naplanovano_na),
          },
          { by: 'beo' },
        )
        .then(() => { pribylo += 1; })
        .catch(() => {});
      continue;
    }
    if (post?.stav === 'publikovano' && card.stav !== 'Vydáno') {
      await planner.update(id, { stav: 'Vydáno' }, { by: 'beo' }).catch(() => {});
    }
  }
  return { ...out, pribylo };
}
