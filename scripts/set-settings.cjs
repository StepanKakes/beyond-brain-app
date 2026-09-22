// Write app settings straight into the database on the box, from the
// environment variable SETTINGS ("KEY=value;KEY=value"). The running app
// picks them up within a minute (the scheduler re-applies stored settings),
// so nothing restarts and nobody types them into a screen.
const path = require('path');
const fs = require('fs');
const os = require('os');
require('dotenv').config({ path: path.join(process.cwd(), '.env') });
const Database = require('better-sqlite3');

const spec = (process.env.SETTINGS || '').trim();
if (!spec) { console.error('SETTINGS is empty'); process.exit(1); }
const candidates = [process.env.DATABASE_PATH, path.join(os.homedir(), '.cloudcli', 'auth.db'), path.join(process.cwd(), 'server', 'database', 'auth.db')].filter(Boolean);
const dbPath = candidates.find((p) => fs.existsSync(p));
if (!dbPath) { console.error('no db in', candidates); process.exit(1); }
const db = new Database(dbPath);
db.exec('CREATE TABLE IF NOT EXISTS beyond_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL, updated_by TEXT)');
const up = db.prepare('INSERT INTO beyond_settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at, updated_by=excluded.updated_by');
const del = db.prepare('DELETE FROM beyond_settings WHERE key=?');
for (const pair of spec.split(';')) {
  const idx = pair.indexOf('=');
  if (idx < 1) continue;
  const key = pair.slice(0, idx).trim();
  const value = pair.slice(idx + 1).trim();
  if (!/^BEYOND_[A-Z0-9_]+$/.test(key)) { console.log(`skip ${key}`); continue; }
  if (value === '') { del.run(key); console.log(`cleared ${key}`); } else { up.run(key, value, new Date().toISOString(), 'workflow'); console.log(`set ${key}`); }
}
