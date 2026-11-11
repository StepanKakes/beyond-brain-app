/**
 * Beyond Brain — content planner.
 *
 * Our own publishing plan, moved over from the Notion database "Kalendář
 * publikací" (Beyond HQ). One card is one piece of content with its script,
 * kept in one file in the brain (`workspace/obsah/planner.json`) so the agent
 * reads it like everything else and git keeps the history.
 *
 * The content line in beyond-obsah.js is something else: what the brain itself
 * finds in calls. Approving one of those proposals makes a card here.
 *
 * Fields and options match the Notion database on purpose, the team already
 * thinks in them. A deleted card only gets a timestamp, so it can come back.
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

import { resolveBrainPath } from '../utils/brain-path.js';
import { commitBrainLater } from './beyond-git.js';
import { blockChildren, notion, notionConfigured } from './beyond-raw.js';

const FILE = path.join('workspace', 'obsah', 'planner.json');
const NOTION_DB = process.env.BEYOND_PLANNER_NOTION_DB || '59f29a4fef524aa5bcf618b912a724ae';

export const OPTIONS = {
  stav: ['Reels nápad', 'YouTube nápad', 'Natočeno', 'Střih', 'Review', 'Opravit', 'Naplánováno', 'Vydáno'],
  platforma: ['Reels', 'Youtube'],
  format: ['Studio talking head', 'Undocumented', 'Real life - raw', 'Vlog', 'Splitscreen', 'Miroboard'],
  cil: ['Viral potenciál (dosah)', 'Inspirovat (tenhle týpek je cool)', 'Budovat autoritu (prodat)'],
  cta: ['REKLAMA – FREE PROGRAM (chci)', 'Free materiály', 'Bez CTA'],
  styl: ['L1 - low effort', 'L2 - broll', 'L3 - high effort'],
  kdo: ['Tim', 'Jirka', 'Štěpán'],
};

let cache = { mtimeMs: -1, data: null };

function filePath() {
  return path.join(resolveBrainPath(), FILE);
}

function emptyFile() {
  return {
    _: 'Content planner Beyond. Jedna karta je jeden kus obsahu i se skriptem v poli text. Upravuj přes nástroj planner nebo v appce.',
    karty: [],
    notionImport: null,
  };
}

export function exists() {
  return fs.existsSync(filePath());
}

function readFile() {
  const p = filePath();
  let stat;
  try {
    stat = fs.statSync(p);
  } catch {
    return emptyFile();
  }
  if (cache.data && cache.mtimeMs === stat.mtimeMs) return cache.data;
  try {
    const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
    cache = {
      mtimeMs: stat.mtimeMs,
      data: { ...emptyFile(), ...parsed, karty: Array.isArray(parsed.karty) ? parsed.karty : [] },
    };
  } catch (err) {
    // A broken file must not read as an empty planner someone then overwrites.
    throw new Error(`planner.json se nedá přečíst: ${err?.message || err}`);
  }
  return cache.data;
}

async function write(data, message) {
  const p = filePath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  cache = { mtimeMs: -1, data: null };
  void commitBrainLater(message, { paths: [FILE] });
}

const str = (v, max) => (v == null ? null : String(v).trim().slice(0, max) || null);

function oneOf(key, value) {
  if (value == null || value === '') return null;
  if (!OPTIONS[key].includes(value)) throw new Error(`${key} musí být jedno z: ${OPTIONS[key].join(', ')}`);
  return value;
}

function date(value) {
  if (value == null || value === '') return null;
  const text = String(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error('datum musí být ve tvaru RRRR-MM-DD');
  return text;
}

function people(value) {
  if (value == null) return [];
  const list = Array.isArray(value) ? value : [value];
  for (const person of list) oneOf('kdo', person);
  return [...new Set(list)];
}

/** Only what was sent changes, a phone and a laptop can edit the same card. */
function applyFields(card, input) {
  if (input.nazev !== undefined) {
    const nazev = str(input.nazev, 300);
    if (!nazev) throw new Error('název chybí');
    card.nazev = nazev;
  }
  if (input.stav !== undefined) {
    const stav = oneOf('stav', input.stav);
    if (!stav) throw new Error('stav chybí');
    card.stav = stav;
  }
  if (input.platforma !== undefined) card.platforma = oneOf('platforma', input.platforma);
  if (input.format !== undefined) card.format = oneOf('format', input.format);
  if (input.cil !== undefined) card.cil = oneOf('cil', input.cil);
  if (input.cta !== undefined) card.cta = oneOf('cta', input.cta);
  if (input.styl !== undefined) card.styl = oneOf('styl', input.styl);
  if (input.kdo !== undefined) card.kdo = people(input.kdo);
  if (input.datum !== undefined) card.datum = date(input.datum);
  if (input.misto !== undefined) card.misto = str(input.misto, 300);
  if (input.reviewLink !== undefined) card.reviewLink = str(input.reviewLink, 600);
  if (input.soubor !== undefined) card.soubor = str(input.soubor, 300);
  if (input.text !== undefined) card.text = input.text == null ? '' : String(input.text).slice(0, 60000);
}

function blank() {
  return {
    id: `p-${randomBytes(4).toString('hex')}`,
    nazev: '',
    stav: OPTIONS.stav[0],
    platforma: null,
    format: null,
    cil: null,
    cta: null,
    styl: null,
    kdo: [],
    datum: null,
    misto: null,
    reviewLink: null,
    soubor: null,
    text: '',
  };
}

/** I smazané: karta, kterou člověk smazal, se znovu nezakládá. */
export function hasId(id) {
  return readFile().karty.some((c) => c.id === id);
}

export function list() {
  const data = readFile();
  return { karty: data.karty.filter((c) => !c.smazano), options: OPTIONS, notionImport: data.notionImport };
}

export async function add(input, { by = 'app' } = {}) {
  const card = blank();
  // Id přichází zvenku jen u příspěvku naplánovaného v Beovi, ať karta a
  // příspěvek k sobě sedí.
  if (typeof input.id === 'string' && /^p-[0-9a-f]{8}$/.test(input.id) && !readFile().karty.some((c) => c.id === input.id)) {
    card.id = input.id;
  }
  if (!input.stav && input.platforma === 'Youtube') card.stav = 'YouTube nápad';
  applyFields(card, input);
  if (!card.nazev) throw new Error('název chybí');
  const stamp = new Date().toISOString();
  Object.assign(card, { createdBy: by, createdAt: stamp, updatedAt: stamp });
  if (input.obsahId) card.obsahId = String(input.obsahId);
  const data = structuredClone(readFile());
  data.karty.unshift(card);
  await write(data, `Planner: nová karta „${card.nazev.slice(0, 50)}" (${by})`);
  return card;
}

export async function update(id, input, { by = 'app' } = {}) {
  const data = structuredClone(readFile());
  const card = data.karty.find((c) => c.id === id);
  if (!card) throw new Error(`karta ${id} neexistuje`);
  applyFields(card, input);
  if (input.smazano === false) delete card.smazano;
  card.updatedAt = new Date().toISOString();
  await write(data, `Planner: „${card.nazev.slice(0, 50)}" (${by})`);
  return card;
}

export async function remove(id, { by = 'app' } = {}) {
  const data = structuredClone(readFile());
  const card = data.karty.find((c) => c.id === id);
  if (!card) throw new Error(`karta ${id} neexistuje`);
  card.smazano = new Date().toISOString();
  await write(data, `Planner: smazáno „${card.nazev.slice(0, 50)}" (${by})`);
}

/** An approved proposal from the brain becomes a card, once. */
export async function addFromProposal(item, { by = 'app' } = {}) {
  const found = readFile().karty.find((c) => c.obsahId === item.id);
  if (found) return found;
  const lines = [];
  if (item.hook) lines.push(`**Hook:** ${item.hook}`);
  if (item.quote) lines.push(`> ${item.quote}`);
  if (item.why) lines.push(`**Proč to funguje:** ${item.why}`);
  if (item.broll) lines.push(`**B-roll:** ${item.broll}`);
  if (item.caption) lines.push(`**Popisek:** ${item.caption}`);
  if (item.text) lines.push(item.text);
  if (item.zdroj) lines.push(`Zdroj: ${item.zdroj}`);
  if (item.source?.fathom) lines.push(`[Nahrávka](${item.source.fathom})`);
  return add(
    { nazev: item.title || item.hook || 'Návrh brainu', stav: 'Reels nápad', platforma: 'Reels', text: lines.join('\n\n'), obsahId: item.id },
    { by },
  );
}

/* ------------------------------------------------------------------ */
/* the move from Notion                                                */
/* ------------------------------------------------------------------ */

const plain = (rich) => (rich || []).map((r) => r.plain_text || '').join('');

function inline(rich) {
  return (rich || [])
    .map((r) => {
      let text = r.plain_text || '';
      if (!text.trim()) return text;
      const a = r.annotations || {};
      if (a.code) text = `\`${text}\``;
      if (a.bold) text = `**${text}**`;
      if (a.italic) text = `*${text}*`;
      if (r.href) text = `[${text}](${r.href})`;
      return text;
    })
    .join('');
}

function blocksToMarkdown(blocks, depth = 0) {
  const pad = '  '.repeat(depth);
  const out = [];
  let number = 0;
  for (const block of blocks || []) {
    const body = block[block.type] || {};
    const text = inline(body.rich_text);
    const kids = block.children ? blocksToMarkdown(block.children, depth + 1) : '';
    number = block.type === 'numbered_list_item' ? number + 1 : 0;
    let line = null;
    if (block.type === 'paragraph') line = text;
    else if (block.type === 'heading_1') line = `# ${text}`;
    else if (block.type === 'heading_2') line = `## ${text}`;
    else if (block.type === 'heading_3') line = `### ${text}`;
    else if (block.type === 'bulleted_list_item' || block.type === 'toggle') line = `- ${text}`;
    else if (block.type === 'numbered_list_item') line = `${number}. ${text}`;
    else if (block.type === 'to_do') line = `- [${body.checked ? 'x' : ' '}] ${text}`;
    else if (block.type === 'quote' || block.type === 'callout') line = `> ${text}`;
    else if (block.type === 'code') line = `\`\`\`\n${plain(body.rich_text)}\n\`\`\``;
    else if (block.type === 'divider') line = '---';
    else if (block.type === 'bookmark' || block.type === 'embed' || block.type === 'link_preview') line = body.url || null;
    else if (['image', 'video', 'file', 'pdf'].includes(block.type)) {
      // Uploaded files live on expiring Notion links, those would die quietly.
      const url = body.external?.url;
      line = url ? `[${block.type}](${url})` : `(příloha ${block.type} zůstala v Notionu)`;
    }
    if (line != null) out.push(`${pad}${line}`);
    if (kids) out.push(kids);
  }
  const isList = (l) => /^\s*(-|\d+\.) /.test(l);
  return out.reduce((all, l, i) => all + (i === 0 ? '' : isList(l) && isList(out[i - 1]) ? '\n' : '\n\n') + l, '');
}

const select = (page, name) => page.properties?.[name]?.select?.name || null;
const richProp = (page, name) => plain(page.properties?.[name]?.rich_text).trim() || null;

function known(key, value) {
  return value && OPTIONS[key].includes(value) ? value : null;
}

// Cards merged in July are marked for deletion in their title, an empty page is
// nothing. Both stay behind.
function leftBehind(title, stav) {
  return !title || (!stav && /sloučeno|smazat/i.test(title));
}

/**
 * Brings in what is in Notion and not here yet. Cards already here are never
 * touched, so it can run again while somebody still writes in Notion.
 */
export async function importFromNotion({ by = 'import', log = () => {} } = {}) {
  if (!notionConfigured()) throw new Error('chybí BEYOND_NOTION_TOKEN');
  const pages = [];
  let cursor;
  do {
    const res = await notion('POST', `/databases/${NOTION_DB}/query`, { page_size: 100, start_cursor: cursor });
    pages.push(...(res.results || []));
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);

  const have = new Set(readFile().karty.map((c) => c.notionId).filter(Boolean));
  const fresh = [];
  let skipped = 0;
  for (const page of pages) {
    if (have.has(page.id)) continue;
    const stav = known('stav', select(page, 'Stav'));
    const title = plain(page.properties?.['Nápad']?.title).replace(/^[^\p{L}\p{N}„"[]+/u, '').trim();
    if (leftBehind(title, stav)) {
      skipped += 1;
      continue;
    }
    const blocks = await blockChildren(page.id);
    log(`načteno: ${title}`);
    fresh.push({
      ...blank(),
      id: `p-${randomBytes(4).toString('hex')}`,
      notionId: page.id,
      notionUrl: page.url || null,
      nazev: title.slice(0, 300),
      stav: stav || (select(page, 'Platforma') === 'Youtube' ? 'YouTube nápad' : 'Reels nápad'),
      platforma: known('platforma', select(page, 'Platforma')),
      format: known('format', select(page, 'Formát')),
      cil: known('cil', select(page, 'Cíl')),
      cta: known('cta', select(page, 'CTA')),
      styl: known('styl', select(page, 'Styl střihu')),
      kdo: (page.properties?.['Kdo dělá']?.multi_select || []).map((o) => o.name).filter((n) => OPTIONS.kdo.includes(n)),
      datum: page.properties?.['Datum publikace']?.date?.start?.slice(0, 10) || null,
      misto: richProp(page, 'Místo'),
      reviewLink: richProp(page, 'Review link'),
      soubor: richProp(page, 'file'),
      text: blocksToMarkdown(blocks),
      createdBy: by,
      createdAt: page.created_time || new Date().toISOString(),
      updatedAt: page.last_edited_time || new Date().toISOString(),
    });
  }
  const data = structuredClone(readFile());
  // Fetching takes minutes, cards added meanwhile are in the fresh read.
  const present = new Set(data.karty.map((c) => c.notionId).filter(Boolean));
  data.karty.push(...fresh.filter((c) => !present.has(c.notionId)));
  data.notionImport = { at: new Date().toISOString(), added: fresh.length, skipped, total: pages.length, error: null };
  await write(data, `Planner: z Notionu ${fresh.length} karet (${by})`);
  return data.notionImport;
}

/** First start with no planner yet: move the data over without anyone asking. */
export function importOnFirstStart() {
  if (exists() || !notionConfigured()) return;
  void importFromNotion({ log: () => {} })
    .then((r) => console.log(`[planner] z Notionu ${r.added} karet, vynecháno ${r.skipped}`))
    .catch(async (err) => {
      console.warn('[planner] import z Notionu selhal:', err?.message || err);
      const data = structuredClone(readFile());
      data.notionImport = { at: new Date().toISOString(), added: 0, skipped: 0, total: 0, error: err?.message || String(err) };
      await write(data, 'Planner: import z Notionu selhal');
    });
}
