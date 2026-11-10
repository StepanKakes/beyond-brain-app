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

export async function naplanuj(cardId, input) {
  const card = planner.list().karty.find((c) => c.id === cardId);
  if (!card) throw new Error('karta neexistuje');
  const { post } = await volej('/posty', {
    method: 'POST',
    body: {
      planner_id: cardId,
      typ: input.typ,
      popisek: input.popisek || '',
      media: input.media || [],
      cover_path: input.cover_path || null,
      naplanovano_na: input.naplanovano_na,
    },
  });
  // Datum karty drží den vydání, ať kalendář sedí s tím, co je v Beovi.
  const den = String(input.naplanovano_na || '').slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(den) && card.datum !== den) {
    await planner.update(cardId, { datum: den }, { by: 'beo' }).catch(() => {});
  }
  return post;
}

export async function zrus(postId) {
  return volej(`/posty/${encodeURIComponent(postId)}`, { method: 'DELETE' });
}

/**
 * Stav příspěvků ke kartám. Co v Beovi vyšlo, se v planneru posune na Vydáno,
 * ať se to nemusí přepínat ručně.
 */
export async function stav(ids) {
  const out = await volej(`/posty?planner=${encodeURIComponent(ids.join(','))}`);
  const karty = planner.list().karty;
  for (const [id, post] of Object.entries(out.posty || {})) {
    const card = karty.find((c) => c.id === id);
    if (card && post?.stav === 'publikovano' && card.stav !== 'Vydáno') {
      await planner.update(id, { stav: 'Vydáno' }, { by: 'beo' }).catch(() => {});
    }
  }
  return out;
}
