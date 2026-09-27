/**
 * Beyond Brain — writing back to Notion after a call.
 *
 * Notion is where the client looks. After a call the brain has the write-up
 * (a file in `workspace/zapisy/`, written by the agent in the client's voice,
 * see the coaching-call-notes skill); this module puts it where the client
 * sees it:
 *
 *   1. a row in the client's "Coaching Calls" database, with the write-up as
 *      the page content. n8n may already have created the row from Fathom
 *      (status "🆕 Z Fathomu"); then it is completed rather than duplicated.
 *   2. the week's checklist on the client's dashboard, and only new pieces of
 *      work as rows in their "Úkoly" database (a planner decides which).
 *
 * Both databases share a schema across clients (see the skill). Nothing here
 * invents property values: selects use the exact option names.
 */
import { notion, notionConfigured } from './beyond-raw.js';

const CALL_STATUS_DONE = '✅ Zpracováno';
const CALL_STATUS_FATHOM = '🆕 Z Fathomu';
const CALL_TYPES = ['Strategický', 'Review / pokrok', 'Audit / feedback', 'Brainstorm', '🚀 Kick-off'];
const TASK_STATUS_NEW = 'Nezahájeno';
const TASK_TYPE = 'Úkol';

export { notionConfigured };

/* ------------------------------------------------------------------ */
/* markdown → blocks                                                   */
/* ------------------------------------------------------------------ */

const MAX_TEXT = 1900;

/** Inline markdown (bold, italic, links) → Notion rich text, split to the API limit. */
function richText(text) {
  const out = [];
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*|_[^_]+_|\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  let m;
  const push = (content, ann = {}, link = null) => {
    for (let i = 0; i < content.length; i += MAX_TEXT) {
      const chunk = content.slice(i, i + MAX_TEXT);
      if (!chunk) continue;
      out.push({ type: 'text', text: { content: chunk, link: link ? { url: link } : null }, annotations: { bold: false, italic: false, ...ann } });
    }
  };
  while ((m = re.exec(text))) {
    if (m.index > last) push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith('**')) push(tok.slice(2, -2), { bold: true });
    else if (tok.startsWith('[')) {
      const lm = /\[([^\]]+)\]\(([^)]+)\)/.exec(tok);
      push(lm[1], {}, lm[2]);
    } else push(tok.slice(1, -1), { italic: true });
    last = m.index + tok.length;
  }
  if (last < text.length) push(text.slice(last));
  return out.length ? out : [{ type: 'text', text: { content: '' } }];
}

/**
 * The subset of markdown the write-up uses: headings, checkboxes, bullets,
 * numbered items (with continuation lines), paragraphs, blank lines.
 */
export function markdownToBlocks(markdown) {
  const blocks = [];
  const lines = String(markdown || '').replace(/\r/g, '').split('\n');
  let para = [];
  const flushPara = () => {
    if (!para.length) return;
    blocks.push({ object: 'block', type: 'paragraph', paragraph: { rich_text: richText(para.join(' ')) } });
    para = [];
  };
  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    const line = raw.trimEnd();
    if (!line.trim()) {
      flushPara();
      continue;
    }
    let m;
    if ((m = /^#{1,3}\s+(.*)$/.exec(line))) {
      flushPara();
      const level = line.indexOf(' ');
      const type = level === 1 ? 'heading_1' : level === 2 ? 'heading_2' : 'heading_3';
      blocks.push({ object: 'block', type, [type]: { rich_text: richText(m[1]) } });
      continue;
    }
    if ((m = /^\s*[-*]\s+\[( |x|X)\]\s+(.*)$/.exec(line))) {
      flushPara();
      blocks.push({ object: 'block', type: 'to_do', to_do: { rich_text: richText(m[2]), checked: m[1].toLowerCase() === 'x' } });
      continue;
    }
    if ((m = /^\s*[-*•]\s+(.*)$/.exec(line))) {
      flushPara();
      blocks.push({ object: 'block', type: 'bulleted_list_item', bulleted_list_item: { rich_text: richText(m[1]) } });
      continue;
    }
    if ((m = /^\s*\d+[.)]\s+(.*)$/.exec(line))) {
      flushPara();
      // A numbered item often continues on indented lines below it.
      let text = m[1];
      while (i + 1 < lines.length && /^\s{2,}\S/.test(lines[i + 1]) && !/^\s*(\d+[.)]|[-*•])\s/.test(lines[i + 1])) {
        text += `\n${lines[i + 1].trim()}`;
        i += 1;
      }
      blocks.push({ object: 'block', type: 'numbered_list_item', numbered_list_item: { rich_text: richText(text) } });
      continue;
    }
    if (/^---+$/.test(line.trim())) {
      flushPara();
      blocks.push({ object: 'block', type: 'divider', divider: {} });
      continue;
    }
    para.push(line.trim());
  }
  flushPara();
  return blocks;
}

async function appendBlocks(pageId, blocks) {
  for (let i = 0; i < blocks.length; i += 100) {
    await notion('PATCH', `/blocks/${pageId}/children`, { children: blocks.slice(i, i + 100) });
  }
}

async function clearChildren(pageId) {
  let cursor;
  do {
    const data = await notion('GET', `/blocks/${pageId}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ''}`);
    for (const b of data.results || []) {
      await notion('DELETE', `/blocks/${b.id}`).catch(() => {});
    }
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);
}

/* ------------------------------------------------------------------ */
/* the write-up                                                        */
/* ------------------------------------------------------------------ */

const title = (t) => [{ type: 'text', text: { content: String(t || '').slice(0, 200) } }];

/**
 * Put the write-up on the client's Coaching Calls row for that day: complete
 * the "🆕 Z Fathomu" row n8n made, or create one. Returns the page id.
 */
export async function upsertCallPage({ callsDbId, dashboardId, dateIso, tema, typ, delkaMin, markdown, fathomUrl }) {
  if (!callsDbId) throw new Error('klient nemá Coaching Calls DB');
  const typOk = CALL_TYPES.includes(typ) ? typ : null;

  // The row for that date, preferring the one Fathom made.
  const found = await notion('POST', `/databases/${callsDbId}/query`, {
    filter: { property: 'Datum', date: { equals: dateIso } },
    page_size: 10,
  });
  const rows = found.results || [];
  // A row already marked done for that day is Tim's own write-up: leave it
  // and everything after it (tasks included) alone.
  const manual = rows.find((r) => r.properties?.Status?.select?.name === CALL_STATUS_DONE);
  if (manual && !rows.some((r) => r.properties?.Status?.select?.name === CALL_STATUS_FATHOM)) {
    return { pageId: manual.id, url: manual.url, created: false, manual: true };
  }
  const existing =
    rows.find((r) => r.properties?.Status?.select?.name === CALL_STATUS_FATHOM) ||
    rows.find((r) => r.properties?.Status?.select?.name !== CALL_STATUS_DONE) ||
    null;

  const properties = {
    'Téma hovoru': { title: title(tema) },
    Datum: { date: { start: dateIso } },
    Status: { select: { name: CALL_STATUS_DONE } },
  };
  if (typOk) properties.Typ = { select: { name: typOk } };
  if (Number.isFinite(delkaMin) && delkaMin > 0) properties['Délka (min)'] = { number: Math.round(delkaMin) };
  if (dashboardId) properties.Klient = { relation: [{ id: dashboardId }] };

  const blocks = markdownToBlocks(markdown);
  if (fathomUrl) {
    blocks.push({ object: 'block', type: 'divider', divider: {} });
    blocks.push({
      object: 'block',
      type: 'paragraph',
      paragraph: { rich_text: [{ type: 'text', text: { content: 'Záznam hovoru (Fathom)', link: { url: fathomUrl } } }] },
    });
  }

  if (existing) {
    await notion('PATCH', `/pages/${existing.id}`, { properties });
    await clearChildren(existing.id);
    await appendBlocks(existing.id, blocks);
    return { pageId: existing.id, url: existing.url, created: false };
  }
  const page = await notion('POST', '/pages', { parent: { database_id: callsDbId }, properties, children: blocks.slice(0, 100) });
  if (blocks.length > 100) await appendBlocks(page.id, blocks.slice(100));
  return { pageId: page.id, url: page.url, created: true };
}

/* ------------------------------------------------------------------ */
/* the client's tasks                                                  */
/* ------------------------------------------------------------------ */

/** The checkboxes under "Tvoje úkoly z dnešní schůzky", as plain strings. */
export function tasksFromWriteup(markdown) {
  const lines = String(markdown || '').replace(/\r/g, '').split('\n');
  const out = [];
  let inTasks = false;
  for (const line of lines) {
    if (/^#{1,3}\s+/.test(line)) {
      inTasks = /úkoly/i.test(line);
      continue;
    }
    if (!inTasks) continue;
    const m = /^\s*[-*]\s+\[( |x|X)\]\s+(.*)$/.exec(line);
    if (m) out.push(m[2].trim());
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* what the client already has                                          */
/* ------------------------------------------------------------------ */

const plainText = (rt) => (rt || []).map((r) => r.plain_text || r.text?.content || '').join('').trim();

/**
 * The client's open work as they see it: rows in their Úkoly database and
 * the "Týdenní úkoly" checklist on the dashboard (the callout the newer
 * dashboards have). The planner reads this before adding anything, so a task
 * the client already has is not added a second time.
 */
export async function readClientTaskState({ tasksDbId, dashboardId }) {
  const rows = [];
  if (tasksDbId) {
    let cursor;
    do {
      const data = await notion('POST', `/databases/${tasksDbId}/query`, {
        page_size: 100,
        start_cursor: cursor,
        sorts: [{ timestamp: 'created_time', direction: 'descending' }],
      });
      for (const p of data.results || []) {
        const pr = p.properties || {};
        const typ = pr['Typ - Hodnota']?.select?.name || null;
        if (typ && typ !== TASK_TYPE) continue;
        rows.push({
          id: p.id,
          nazev: plainText(pr['Název']?.title),
          stav: pr['Project Status']?.select?.name || null,
          tyden: pr['Týden']?.select?.name || null,
          zalozeno: (p.created_time || '').slice(0, 10),
        });
      }
      cursor = data.has_more ? data.next_cursor : undefined;
    } while (cursor && rows.length < 200);
  }

  let weekly = null;
  if (dashboardId) {
    const top = await notion('GET', `/blocks/${dashboardId}/children?page_size=100`);
    for (const b of top.results || []) {
      if (b.type !== 'callout' || !/úkol/i.test(plainText(b.callout?.rich_text))) continue;
      const kids = await notion('GET', `/blocks/${b.id}/children?page_size=100`);
      weekly = {
        blockId: b.id,
        items: (kids.results || [])
          .filter((k) => k.type === 'to_do')
          .map((k) => ({ id: k.id, text: plainText(k.to_do.rich_text), checked: Boolean(k.to_do.checked) })),
      };
      break;
    }
  }
  return { rows, weekly };
}

/**
 * Apply what the planner decided: the week's checklist on the dashboard is
 * replaced by the new one, and only genuinely new pieces of work become rows
 * in the Úkoly database, with the longer description as the page body.
 */
export async function applyTaskPlan({ tasksDbId, dashboardId, weekly, plan, week = null, dateIso = null }) {
  const out = { weekly: 0, created: [], note: null };

  if (weekly?.blockId && Array.isArray(plan.tydenni) && plan.tydenni.length) {
    for (const item of weekly.items) {
      await notion('DELETE', `/blocks/${item.id}`).catch(() => {});
    }
    await notion('PATCH', `/blocks/${weekly.blockId}/children`, {
      children: plan.tydenni.slice(0, 6).map((t) => ({
        object: 'block',
        type: 'to_do',
        to_do: { rich_text: richText(String(t).trim()), checked: false },
      })),
    });
    out.weekly = Math.min(plan.tydenni.length, 6);
  }

  if (!tasksDbId) {
    out.note = 'klient nemá Úkoly DB';
    return out;
  }
  // An older dashboard has no weekly checklist; there the week's short list
  // is what goes into the database, minus what is already a row there.
  const rows = [...(plan.nove || [])];
  if (!weekly?.blockId) {
    const have = new Set((plan.existujici || []).map((n) => String(n).toLowerCase().trim()));
    for (const t of plan.tydenni || []) {
      if (!have.has(String(t).toLowerCase().trim())) rows.push({ nazev: t });
    }
  }
  for (const u of rows.slice(0, 5)) {
    const name = String(u.nazev || '').replace(/\s+/g, ' ').trim().slice(0, 120);
    if (!name) continue;
    const properties = {
      'Název': { title: title(name) },
      'Project Status': { select: { name: TASK_STATUS_NEW } },
      'Typ - Hodnota': { select: { name: TASK_TYPE } },
    };
    if (dashboardId) properties.Klient = { relation: [{ id: dashboardId }] };
    if (week) properties['Týden'] = { select: { name: week } };
    if (dateIso) properties.Date = { date: { start: dateIso } };
    const children = u.popis ? markdownToBlocks(String(u.popis)).slice(0, 50) : [];
    try {
      await notion('POST', '/pages', { parent: { database_id: tasksDbId }, properties, children });
    } catch (err) {
      // A week option the DB does not have is the likely cause; retry without it.
      if (!week || !/Týden|select/i.test(err?.message || '')) throw err;
      delete properties['Týden'];
      await notion('POST', '/pages', { parent: { database_id: tasksDbId }, properties, children });
    }
    out.created.push(name);
  }
  return out;
}
