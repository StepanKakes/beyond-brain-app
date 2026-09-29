// Read-only: where the brain's tokens went over the last N days, per source
// and model, with per-turn averages. Prints tables, changes nothing.
const path = require('path');
const fs = require('fs');
const os = require('os');
require('dotenv').config({ path: path.join(process.cwd(), '.env') });
const Database = require('better-sqlite3');

const days = Number(process.env.DAYS || 14);
const candidates = [process.env.DATABASE_PATH, path.join(os.homedir(), '.cloudcli', 'auth.db'), path.join(process.cwd(), 'server', 'database', 'auth.db')].filter(Boolean);
const dbPath = candidates.find((p) => fs.existsSync(p));
if (!dbPath) { console.error('no db in', candidates); process.exit(1); }
const db = new Database(dbPath, { readonly: true });
const since = new Date(Date.now() - days * 864e5).toISOString();
const COLS = `COUNT(*) AS n, ROUND(SUM(cost_usd),2) AS usd, ROUND(AVG(cost_usd),3) AS usd_avg,
  CAST(AVG(input) AS INT) AS in_avg, CAST(AVG(output) AS INT) AS out_avg,
  CAST(AVG(cache_read) AS INT) AS cr_avg, CAST(AVG(cache_write) AS INT) AS cw_avg,
  ROUND(AVG(turns),1) AS turns_avg, CAST(AVG(duration_ms)/1000 AS INT) AS sec_avg, SUM(is_error) AS err`;
const show = (title, rows) => { console.log(`\n=== ${title}`); console.table(rows); };
show(`total ${days}d`, db.prepare(`SELECT ${COLS} FROM beyond_usage WHERE ts >= ?`).all(since));
show('by source', db.prepare(`SELECT source, ${COLS} FROM beyond_usage WHERE ts >= ? GROUP BY source ORDER BY usd DESC`).all(since));
show('by source+label (top 30)', db.prepare(`SELECT source, substr(label,1,40) AS label, ${COLS} FROM beyond_usage WHERE ts >= ? GROUP BY source, label ORDER BY usd DESC LIMIT 30`).all(since));
show('by model', db.prepare(`SELECT model, ${COLS} FROM beyond_usage WHERE ts >= ? GROUP BY model ORDER BY usd DESC`).all(since));
show('by day', db.prepare(`SELECT substr(ts,1,10) AS day, ${COLS} FROM beyond_usage WHERE ts >= ? GROUP BY day ORDER BY day`).all(since));
show('most expensive single rows', db.prepare(`SELECT substr(ts,1,16) AS ts, source, substr(label,1,30) AS label, model, input, output, cache_read, cache_write, ROUND(cost_usd,2) AS usd, turns FROM beyond_usage WHERE ts >= ? ORDER BY cost_usd DESC LIMIT 25`).all(since));
