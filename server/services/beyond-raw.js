/**
 * Beyond Brain — the raw layer, pulled by the app.
 *
 * n8n used to do this: every morning fetch Notion and WhatsApp into
 * `clients/aktivni/<slug>/raw/` and commit. It worked and nobody touched it,
 * which was also the problem: the agent could not see how it worked, could not
 * fix it, and a new client meant clicking through eight nodes.
 *
 * Same files, same shapes (the sync skill must not notice), now three jobs in
 * the same scheduler as everything else, with the same run log and the same
 * git trail:
 *
 *   registr-klientu   Notion "Clients 1:1"  → clients/_registr.json
 *   notion-raw        dashboard + calls + tasks per client → raw/notion/*.json
 *   wa-raw            WAHA messages per client → raw/whatsapp.json
 *
 * Plain fetches, no model. Voice notes are transcribed with the brain's whisper
 * script, once, and the transcript is carried forward on later pulls.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { resolveBrainPath } from '../utils/brain-path.js';
import { wahaConfig, wahaGet } from './beyond-waha.js';

const execFileAsync = promisify(execFile);

const NOTION_API = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';
const CLIENTS_DB = process.env.BEYOND_NOTION_CLIENTS_DB || '341d27608c3080869916c2b2017ef085';
const WA_SESSION = process.env.BEYOND_WAHA_SESSION || 'default';
const WA_LIMIT = 500;

/* ------------------------------------------------------------------ */
/* notion                                                              */
/* ------------------------------------------------------------------ */

function notionToken() {
  const t = process.env.BEYOND_NOTION_TOKEN || process.env.NOTION_TOKEN;
  return t && t.trim() ? t.trim() : null;
}

export function notionConfigured() {
  return Boolean(notionToken());
}

async function notion(method, pathname, body = null) {
  const token = notionToken();
  if (!token) {
    const err = new Error('chybí BEYOND_NOTION_TOKEN');
    err.blockedConfig = true;
    throw err;
  }
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const res = await fetch(`${NOTION_API}${pathname}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Notion-Version': NOTION_VERSION, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 429) {
      const wait = Number(res.headers.get('retry-after') || 2) * 1000;
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(`Notion ${res.status}: ${data?.message || pathname}`);
    return data;
  }
  throw new Error('Notion: příliš mnoho požadavků');
}

async function queryAll(dbId, body = {}) {
  const pages = [];
  let cursor;
  do {
    const data = await notion('POST', `/databases/${dbId}/query`, { ...body, page_size: 100, start_cursor: cursor });
    pages.push(...(data.results || []));
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);
  return pages;
}

async function blockChildren(blockId, depth = 0) {
  const out = [];
  let cursor;
  do {
    const data = await notion('GET', `/blocks/${blockId}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ''}`);
    for (const b of data.results || []) {
      if (b.has_children && depth < 2 && b.type !== 'child_page' && b.type !== 'child_database') {
        b.children = await blockChildren(b.id, depth + 1);
      }
      out.push(b);
    }
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);
  return out;
}

const plain = (prop) => {
  if (!prop) return '';
  const arr = prop.title || prop.rich_text || [];
  return arr.map((t) => t.plain_text || '').join('').trim();
};
const list = (prop) =>
  plain(prop)
    .split(/[,;\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
/** A Notion id out of whatever was pasted: a bare id, a dashed uuid or a URL. */
const idOf = (text) => {
  const m = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{32}/i.exec(String(text || ''));
  return m ? m[0].replace(/-/g, '').toLowerCase() : null;
};

/** Notion "Clients 1:1" → the registry the pulls and the skills read. */
export async function pullRegistry() {
  const pages = await queryAll(CLIENTS_DB, { sorts: [{ property: 'Jméno', direction: 'ascending' }] });
  const klienti = [];
  for (const p of pages) {
    const pr = p.properties || {};
    const slug = plain(pr.Slug);
    if (!slug) continue;
    klienti.push({
      slug,
      jmeno: plain(pr['Jméno']),
      stav: pr.Stav?.select?.name || null,
      dashboardId: p.id.replace(/-/g, ''),
      chatId: plain(pr['WA chatId']) || null,
      callsDbId: idOf(plain(pr['Coaching Calls DB'])),
      tasksDbId: idOf(plain(pr['Ukoly DB'])),
      mereniDbId: idOf(plain(pr['Mereni DB'])),
      email: pr['E-mail']?.email || '',
      telefon: pr.Telefon?.phone_number || '',
      osloveni: plain(pr.Osloveni),
      vicLidi: Boolean(pr['Vic lidi']?.checkbox),
      roadmapa: Boolean(pr.Roadmapa?.checkbox),
      aliasy: list(pr.Aliasy),
      metriky: list(pr.Metriky),
      zahajeni: pr['Zahájení Programu']?.date?.start || null,
      konec: pr['Datum konce']?.date?.start || null,
      delka: pr['Délka programu']?.select?.name || null,
    });
  }
  const out = { syncedAt: new Date().toISOString(), syncSource: 'Notion API (beyond-brain-app)', pocet: klienti.length, klienti };
  const file = path.join(resolveBrainPath(), 'clients', '_registr.json');
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(out, null, 2)}\n`, 'utf8');
  return out;
}

export async function readRegistry() {
  try {
    const data = JSON.parse(await fs.readFile(path.join(resolveBrainPath(), 'clients', '_registr.json'), 'utf8'));
    return Array.isArray(data?.klienti) ? data.klienti : [];
  } catch {
    return [];
  }
}

function activeFromRegistry(klienti) {
  return klienti.filter((k) => k.stav === 'Aktivní');
}

async function writeRaw(slug, rel, data) {
  const file = path.join(resolveBrainPath(), 'clients', 'aktivni', slug, 'raw', rel);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

/** Dashboard page + blocks, calls DB, tasks DB for every active client. */
export async function pullNotion({ log = () => {}, only = null } = {}) {
  const klienti = activeFromRegistry(await readRegistry()).filter((k) => !only || k.slug === only);
  if (!klienti.length) return { done: [], note: 'registr je prázdný nebo nikdo není Aktivní' };
  const done = [];
  for (const k of klienti) {
    const parts = [];
    try {
      const page = await notion('GET', `/pages/${k.dashboardId}`);
      const blocks = await blockChildren(k.dashboardId);
      await writeRaw(k.slug, path.join('notion', 'dashboard.json'), {
        syncedAt: new Date().toISOString(),
        syncSource: 'Notion API',
        client: { slug: k.slug, name: k.jmeno, dashboardId: k.dashboardId },
        page,
        blocks,
        blockCount: blocks.length,
      });
      parts.push(`dashboard ${blocks.length} bloků`);
    } catch (err) {
      parts.push(`dashboard selhal: ${err.message}`);
    }
    for (const [key, file, label] of [
      ['callsDbId', 'calls.json', 'Calls DB'],
      ['tasksDbId', 'tasks.json', 'Tasks DB'],
    ]) {
      if (!k[key]) continue;
      try {
        const pages = await queryAll(k[key], { sorts: [{ timestamp: 'last_edited_time', direction: 'descending' }] });
        await writeRaw(k.slug, path.join('notion', file), {
          syncedAt: new Date().toISOString(),
          syncSource: `Notion API (${label})`,
          client: { slug: k.slug, name: k.jmeno, dbId: k[key] },
          note: 'Metadata + properties only (no page blocks). Skill fetches blocks on-demand for new pages.',
          count: pages.length,
          pages,
        });
        parts.push(`${file.replace('.json', '')} ${pages.length}`);
      } catch (err) {
        parts.push(`${label} selhal: ${err.message}`);
      }
    }
    log(`${k.slug}: ${parts.join(', ')}`);
    done.push(`${k.slug}: ${parts.join(', ')}`);
  }
  return { done };
}

/* ------------------------------------------------------------------ */
/* whatsapp                                                            */
/* ------------------------------------------------------------------ */

function whisperScript() {
  const dir = path.join(resolveBrainPath(), 'system', 'scripts');
  return process.platform === 'win32'
    ? { kind: 'ps1', file: path.join(dir, 'transcribe-voice.ps1') }
    : { kind: 'sh', file: path.join(dir, 'transcribe-voice.sh') };
}

async function transcribeUrl(url) {
  const s = whisperScript();
  try {
    await fs.access(s.file);
  } catch {
    return null;
  }
  const c = wahaConfig();
  const withKey = c && url.includes(c.baseUrl) && !url.includes('x-api-key') ? `${url}${url.includes('?') ? '&' : '?'}x-api-key=${c.apiKey}` : url;
  const args = s.kind === 'ps1' ? ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', s.file, '-Source', withKey] : [s.file, withKey];
  const { stdout } = await execFileAsync(s.kind === 'ps1' ? 'powershell' : 'bash', args, { timeout: 5 * 60 * 1000, maxBuffer: 4 * 1024 * 1024 });
  return String(stdout || '').trim() || null;
}

const isVoice = (m) => m?.hasMedia && /^audio\//.test(m.media?.mimetype || '') && m.media?.url;

/** Messages of every active client's group, newest first, voice notes transcribed. */
export async function pullWhatsApp({ log = () => {}, only = null, transcribe = true } = {}) {
  if (!wahaConfig()) {
    const err = new Error('WAHA není nastavená (BEYOND_WAHA_URL + BEYOND_WAHA_API_KEY)');
    err.blockedConfig = true;
    throw err;
  }
  const klienti = activeFromRegistry(await readRegistry()).filter((k) => k.chatId && (!only || k.slug === only));
  if (!klienti.length) return { done: [], note: 'žádný aktivní klient s WA chatId' };
  const done = [];
  for (const k of klienti) {
    try {
      const messages = await wahaGet(`/api/${WA_SESSION}/chats/${encodeURIComponent(k.chatId)}/messages?limit=${WA_LIMIT}&downloadMedia=false`);
      const arr = Array.isArray(messages) ? messages : [];
      arr.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

      // Carry transcripts forward; whisper runs once per voice note, ever.
      let previous = new Map();
      try {
        const old = JSON.parse(await fs.readFile(path.join(resolveBrainPath(), 'clients', 'aktivni', k.slug, 'raw', 'whatsapp.json'), 'utf8'));
        for (const m of old.messages || []) if (m.transcript) previous.set(m.id, m.transcript);
      } catch {
        previous = new Map();
      }
      let transcribed = 0;
      let fresh = 0;
      for (const m of arr) {
        if (previous.has(m.id)) {
          m.transcript = previous.get(m.id);
          transcribed += 1;
          continue;
        }
        if (transcribe && isVoice(m) && fresh < 20) {
          try {
            const t = await transcribeUrl(m.media.url);
            if (t) {
              m.transcript = t;
              transcribed += 1;
              fresh += 1;
            }
          } catch (err) {
            log(`${k.slug}: přepis hlasovky selhal: ${err.message}`);
          }
        }
      }
      await writeRaw(k.slug, 'whatsapp.json', {
        syncedAt: new Date().toISOString(),
        syncSource: 'WAHA',
        client: { slug: k.slug, name: k.jmeno, chatId: k.chatId },
        stats: { totalMessages: arr.length, transcribedVoices: transcribed },
        messages: arr,
      });
      const note = `${k.slug}: ${arr.length} zpráv${transcribed ? `, ${transcribed} hlasovek přepsáno` : ''}${arr.length === 0 ? ' (nic od spárování WAHA, historie se nesynchronizovala)' : ''}`;
      log(note);
      done.push(note);
    } catch (err) {
      log(`${k.slug}: selhalo (${err.message})`);
      done.push(`${k.slug}: selhalo (${err.message})`);
    }
  }
  return { done };
}
