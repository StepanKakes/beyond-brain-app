// Jeden login z workflow Add user: jméno a hotový bcrypt otisk z prostředí.
const path = require('path');
const fs = require('fs');
const os = require('os');
require('dotenv').config({ path: path.join(process.cwd(), '.env') });
const Database = require('better-sqlite3');

const username = String(process.env.NEW_USER || '').trim().toLowerCase();
const hash = String(process.env.NEW_HASH || '').trim();
if (!/^[a-z0-9._-]{3,40}$/.test(username)) { console.error('neplatné jméno'); process.exit(1); }
if (!/^\$2[aby]\$\d\d\$[./A-Za-z0-9]{53}$/.test(hash)) { console.error('neplatný bcrypt otisk'); process.exit(1); }
const candidates = [process.env.DATABASE_PATH, path.join(os.homedir(), '.cloudcli', 'auth.db'), path.join(process.cwd(), 'server', 'database', 'auth.db')].filter(Boolean);
const dbPath = candidates.find((p) => fs.existsSync(p));
if (!dbPath) { console.error('no db in', candidates); process.exit(1); }
const db = new Database(dbPath);
const row = db.prepare('SELECT id FROM users WHERE lower(username) = ?').get(username);
if (row) {
  db.prepare('UPDATE users SET password_hash = ?, is_active = 1 WHERE id = ?').run(hash, row.id);
  console.log(`reset ${username}`);
} else {
  db.prepare('INSERT INTO users (username, password_hash, is_active, has_completed_onboarding) VALUES (?, ?, 1, 1)').run(username, hash);
  console.log(`created ${username}`);
}
console.log('users:', db.prepare('SELECT username FROM users').all().map((r) => r.username).join(', '));
