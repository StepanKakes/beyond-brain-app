// What the app recorded lately: the last chat messages and job runs. Run by
// the Diagnose workflow on the box; read-only.
const path = require('path');
const fs = require('fs');
const os = require('os');
require('dotenv').config({ path: path.join(process.cwd(), '.env') });
const Database = require('better-sqlite3');

const candidates = [process.env.DATABASE_PATH, path.join(os.homedir(), '.cloudcli', 'auth.db'), path.join(process.cwd(), 'server', 'database', 'auth.db')].filter(Boolean);
const dbPath = candidates.find((p) => fs.existsSync(p));
if (!dbPath) {
  console.log('no db in', candidates);
  process.exit(0);
}
console.log('db', dbPath);
const db = new Database(dbPath, { readonly: true });
const rows = db.prepare("SELECT session_id, role, ts, substr(replace(content, char(10), ' '), 1, 110) AS c FROM beyond_messages ORDER BY id DESC LIMIT 40").all().reverse();
for (const r of rows) console.log(r.ts, r.session_id.slice(0, 8), r.role.padEnd(9), r.c);
console.log('--- runs');
try {
  for (const r of db.prepare("SELECT job, status, started_at, finished_at, substr(coalesce(error, summary, ''), 1, 90) AS s FROM beyond_runs ORDER BY id DESC LIMIT 8").all()) {
    console.log(r.started_at, String(r.job).padEnd(18), String(r.status).padEnd(8), r.s);
  }
} catch (e) {
  console.log('runs:', e.message);
}
