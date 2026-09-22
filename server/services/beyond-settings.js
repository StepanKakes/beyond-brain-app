/**
 * Beyond Brain — settings you can change from the app.
 *
 * Every key the server reads from `process.env` can also be set here, from
 * the Agent screen, and the value in the database wins over `.env`. That
 * means nobody has to open the box to paste a token: the app is the place
 * where the app is configured.
 *
 * Values live in SQLite (`beyond_settings`) and are copied into
 * `process.env` at boot and on every save, so the rest of the code keeps
 * reading `process.env.X` and does not care where X came from. Secrets are
 * returned to the browser masked.
 */
import { getConnection } from '../modules/database/connection.js';
import { getPeople } from './beyond-people.js';
import { icsKeyFor } from './beyond-kalendar.js';
import { wahaConfig } from './beyond-waha.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS beyond_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT
);
`;

/**
 * What can be set. Order is display order. `secret` masks the value in the
 * UI; `restart` says the change needs a service restart to fully apply.
 */
export const CATALOG = [
  { group: 'Kde jste', key: 'BEYOND_TZ', label: 'Časové pásmo', hint: 'Denní úlohy, „dnes" u úkolů a slova jako zítra. Např. Europe/Prague nebo Asia/Bangkok.', placeholder: 'Europe/Prague' },
  { group: 'Kde jste', key: 'BEYOND_DEFAULT_OWNER', label: 'Výchozí vlastník úkolů', hint: 'Klíč osoby (tim, stepan), komu připadne úkol od agenta, když nevíme lépe.', placeholder: 'tim' },

  { group: 'Notion', key: 'BEYOND_NOTION_TOKEN', label: 'Notion integration token', hint: 'Jen pro ranní pully v appce (registr, dashboardy, cally, úkoly). Zápis po callu jde přes Notion konektor i bez něj.', secret: true },

  { group: 'Telegram', key: 'BEYOND_TG_BOT_TOKEN', label: 'Bot token', hint: 'Token bota od BotFather.', secret: true },
  { group: 'Telegram', key: 'BEYOND_TG_CHAT_ID', label: 'Chat pro brief a připomínky', hint: 'ID chatu nebo skupiny, kam chodí ranní brief a připomínka hovoru.' },
  { group: 'Telegram', key: 'BEYOND_TG_ERROR_CHAT_ID', label: 'Chat pro chyby', hint: 'Kam jde hlášení, když úloha selže třikrát po sobě. Prázdné = tam, kam brief.' },
  { group: 'Telegram', key: 'BEYOND_TG_POLLING', label: 'Bot v appce', hint: '1 = appka sama čte zprávy bota (vypne n8n Telegram Inbound). Prázdné = přes n8n.', placeholder: '0', restart: true },

  { group: 'WhatsApp', key: 'BEYOND_WAHA_URL', label: 'WAHA URL', hint: 'Např. https://waha.growbeyond.cz. Prázdné = vezme se z WAHA konektoru v ~/.claude.json.', placeholder: 'https://waha.growbeyond.cz' },
  { group: 'WhatsApp', key: 'BEYOND_WAHA_API_KEY', label: 'WAHA API klíč', secret: true },

  { group: 'Kalendář', key: 'BEYOND_CALCOM_API_KEY', label: 'Cal.com API klíč', secret: true },
  // One Google calendar per person, by its secret iCal address.
  ...getPeople().map((p) => ({
    group: 'Kalendář',
    key: icsKeyFor(p.key),
    label: `Google kalendář: ${p.displayName}`,
    hint: 'Tajná adresa kalendáře ve formátu iCal (Google Kalendář → Nastavení → kalendář → Tajná adresa ve formátu iCal). Hovory z něj se ukážou vedle Cal.com.',
    secret: true,
  })),

  { group: 'Události', key: 'BEYOND_EVENT_SECRET_WAHA', label: 'Secret cesty waha', hint: 'Stejná hodnota jako WHATSAPP_HOOK_HMAC_KEY ve WAHA.', secret: true },
  { group: 'Události', key: 'BEYOND_EVENT_SECRET_CALCOM', label: 'Secret cesty calcom', hint: 'Secret webhooku v Cal.com.', secret: true },
  { group: 'Události', key: 'BEYOND_EVENT_SECRET_N8N', label: 'Secret cesty n8n a fathom', hint: 'Hlavička X-Beyond-Secret z n8n.', secret: true },

  { group: 'Chat', key: 'BEYOND_TOKEN_BUDGET_TOTAL', label: 'Okno chatu (tokeny)', hint: 'Kolik tokenů smí chat nabrat, než se sám shrne. Výchozí 200000 drží odpovědi rychlé a levné; 1000000 pustí celé okno modelu. Platí pro nové chaty.', placeholder: '200000' },
  { group: 'Chat', key: 'BEYOND_AUTO_COMPACT_THRESHOLD', label: 'Shrnout při (tokeny)', hint: 'Prázdné = 80 % okna.' },

  { group: 'Agent', key: 'BEYOND_SYNC_PARALLEL', label: 'Klientů najednou při syncu', hint: '1 až 4.', placeholder: '2' },
  { group: 'Modely', key: 'BEYOND_MODEL_JOBS', label: 'Model úloh, když úloha nemá vlastní', hint: 'haiku, sonnet nebo opus. Každá úloha má rozumný výchozí (vidíš ho v tabulce úloh); tohle platí pro ty bez něj.', placeholder: 'sonnet' },
  { group: 'Modely', key: 'BEYOND_JOB_MODELS', label: 'Výjimky po úlohách (JSON)', hint: 'Např. {"napsat-navrhy":"sonnet","wa-check":"sonnet"}. Přebije výchozí model konkrétní úlohy.' },
  { group: 'Modely', key: 'BEYOND_MODEL_AGENT', label: 'Model pro Telegram a dotazy z Velína', placeholder: 'sonnet' },
  { group: 'Modely', key: 'BEYOND_REVIEW_MODEL', label: 'Model večerní kontroly učení', placeholder: 'sonnet' },
  { group: 'Agent', key: 'BEYOND_SCHEDULER', label: 'Plánovač', hint: '0 vypne všechny úlohy (ale dashboardy běží).', placeholder: '1', restart: true },
];

const KNOWN = new Set(CATALOG.map((c) => c.key));

let ready = false;
function db() {
  const conn = getConnection();
  if (!ready) {
    conn.exec(SCHEMA);
    ready = true;
  }
  return conn;
}

/** Stored values, raw. */
export function stored() {
  const out = {};
  for (const row of db().prepare('SELECT key, value, updated_at, updated_by FROM beyond_settings').all()) {
    out[row.key] = { value: row.value, updatedAt: row.updated_at, updatedBy: row.updated_by };
  }
  return out;
}

/** Copy stored values into process.env so every reader sees them. */
export function applyToEnv() {
  const values = stored();
  let n = 0;
  for (const [key, row] of Object.entries(values)) {
    if (row.value === '') continue;
    process.env[key] = row.value;
    n += 1;
  }
  if (n && !applyToEnv.announced) {
    applyToEnv.announced = true;
    console.log(`[settings] ${n} hodnot z databáze přebilo .env`);
  }
  return n;
}

function mask(value) {
  if (!value) return '';
  if (value.length <= 8) return '••••';
  return `${value.slice(0, 3)}…${value.slice(-3)}`;
}

/**
 * Values the app uses even though nobody typed them here: taken from
 * elsewhere (the WAHA connector in ~/.claude.json, a fallback to another
 * key). Shown so the screen does not look empty for something that works.
 */
function derived(key) {
  try {
    if (key === 'BEYOND_WAHA_URL' || key === 'BEYOND_WAHA_API_KEY') {
      const cfg = wahaConfig();
      if (!cfg) return null;
      return { value: key === 'BEYOND_WAHA_URL' ? cfg.baseUrl : cfg.apiKey, from: cfg.source || 'konektor WAHA' };
    }
    if (key === 'BEYOND_TG_ERROR_CHAT_ID' && !process.env.BEYOND_TG_ERROR_CHAT_ID && process.env.BEYOND_TG_CHAT_ID) {
      return { value: process.env.BEYOND_TG_CHAT_ID, from: 'stejný jako brief' };
    }
    if (key === 'BEYOND_TZ' && !process.env.BEYOND_TZ) return { value: 'Europe/Prague', from: 'výchozí' };
  } catch { /* derived values are a courtesy */ }
  return null;
}

/** The catalogue with current state, secrets masked, for the UI. */
export function describe() {
  const values = stored();
  return CATALOG.map((c) => {
    const inDb = values[c.key];
    const env = process.env[c.key];
    const own = inDb?.value ?? env ?? '';
    const d = own ? null : derived(c.key);
    const value = own || d?.value || '';
    return {
      ...c,
      set: Boolean(value),
      source: inDb?.value ? 'app' : env ? 'env' : d ? 'derived' : null,
      derivedFrom: d?.from || null,
      display: c.secret ? mask(value) : value,
      updatedAt: inDb?.updatedAt || null,
      updatedBy: inDb?.updatedBy || null,
    };
  });
}

/**
 * Save one or more values. Empty string clears the stored value (and the
 * env one, so "delete" really deletes). Unknown keys are refused.
 */
export function save(values, { by = 'app' } = {}) {
  const conn = db();
  const upsert = conn.prepare(
    'INSERT INTO beyond_settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at, updated_by=excluded.updated_by',
  );
  const del = conn.prepare('DELETE FROM beyond_settings WHERE key=?');
  const changed = [];
  const tx = conn.transaction(() => {
    for (const [key, raw] of Object.entries(values || {})) {
      if (!KNOWN.has(key)) throw new Error(`neznámý klíč ${key}`);
      const value = raw == null ? '' : String(raw).trim();
      if (value === '') {
        del.run(key);
        delete process.env[key];
      } else {
        upsert.run(key, value, new Date().toISOString(), by);
        process.env[key] = value;
      }
      changed.push(key);
    }
  });
  tx();
  return changed;
}
