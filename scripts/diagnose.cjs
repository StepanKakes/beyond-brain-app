// What the app recorded lately: the shape of the last chat messages and job runs.
// Run by the Diagnose workflow on the box; read-only. The repo and its logs are
// public, so this never prints message text, summaries or errors, only lengths.
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
const rows = db.prepare('SELECT session_id, role, ts, length(content) AS n FROM beyond_messages ORDER BY id DESC LIMIT 40').all().reverse();
for (const r of rows) console.log(r.ts, r.session_id.slice(0, 8), r.role.padEnd(9), `${r.n} znaku`);
console.log('--- runs');
try {
  for (const r of db.prepare('SELECT job, status, started_at, finished_at, error IS NOT NULL AS failed FROM beyond_runs ORDER BY id DESC LIMIT 40').all()) {
    console.log(r.started_at, String(r.job).padEnd(18), String(r.status).padEnd(8), r.failed ? 'ma chybu' : '');
  }
} catch (e) {
  console.log('runs: nejde precist');
}
