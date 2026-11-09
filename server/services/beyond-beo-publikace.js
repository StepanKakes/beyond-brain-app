// Most z content planneru do Bea: nahrání médií a naplánování příspěvku na
// Instagram. Vydává Beo (cron každou minutu), tady se jen předává.
//
// Klíč je MCP klíč z Bea (Nastavení, MCP), zadává se v appce na obrazovce
// Agent, Napojení a klíče. Do prohlížeče se nikdy neposílá: prohlížeč dostane
// jen jednorázové podepsané adresy pro nahrání souborů.

import * as planner from './beyond-planner.js';

function beo() {
  const url = (process.env.BEYOND_BEO_URL || 'https://app.growbeyond.cz').replace(/\/+$/, '');
  const key = process.env.BEYOND_BEO_API_KEY || '';
  if (!key) throw new Error('Chybí klíč do Bea (Agent, Napojení a klíče, Beo)');
  return { url, key };
}

async function volej(cesta, { method = 'GET', body } = {}) {
  const { url, key } = beo();
  const res = await fetch(`${url}/api/integrations/planner${cesta}`, {
    method,
    headers: { 'X-Api-Key': key, ...(body ? { 'Content-Type': 'application/json' } : {}) },
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
