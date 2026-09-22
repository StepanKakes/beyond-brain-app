// Create or reset the people's logins on the box. Reads USERS as
// "name:password,name:password" from the environment (a repo secret in the
// workflow), writes bcrypt hashes into the app database. Existing users
// keep everything else (git name, onboarding); new ones are created.
const path = require('path');
const fs = require('fs');
const os = require('os');
require('dotenv').config({ path: path.join(process.cwd(), '.env') });
const Database = require('better-sqlite3');
const bcrypt = require('bcrypt');

const spec = (process.env.USERS || '').trim();
if (!spec) { console.error('USERS is empty'); process.exit(1); }
const candidates = [process.env.DATABASE_PATH, path.join(os.homedir(), '.cloudcli', 'auth.db'), path.join(process.cwd(), 'server', 'database', 'auth.db')].filter(Boolean);
const dbPath = candidates.find((p) => fs.existsSync(p));
if (!dbPath) { console.error('no db in', candidates); process.exit(1); }
const db = new Database(dbPath);
for (const pair of spec.split(',')) {
  const idx = pair.indexOf(':');
  if (idx < 1) continue;
  const username = pair.slice(0, idx).trim().toLowerCase();
  const password = pair.slice(idx + 1);
  const hash = bcrypt.hashSync(password, 12);
  const row = db.prepare('SELECT id FROM users WHERE lower(username) = ?').get(username);
  if (row) {
    db.prepare('UPDATE users SET password_hash = ?, is_active = 1 WHERE id = ?').run(hash, row.id);
    console.log(`reset ${username}`);
  } else {
    db.prepare('INSERT INTO users (username, password_hash, is_active, has_completed_onboarding) VALUES (?, ?, 1, 1)').run(username, hash);
    console.log(`created ${username}`);
  }
}
console.log('users:', db.prepare('SELECT username FROM users').all().map((r) => r.username).join(', '));
