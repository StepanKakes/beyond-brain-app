// Generates a long-lived JWT for the first user in the local CloudCLI DB.
// Used by screenshot-authed.mjs to skip the login UI when capturing authed
// surfaces. Reads the JWT secret + user directly from the sqlite DB so we
// don't have to spin up the TypeScript server modules.
//
// Run from project root: `node design-system/scripts/gen-token.mjs`
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import jwt from 'jsonwebtoken';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const dbPath = process.env.DATABASE_PATH ||
  path.join(os.homedir(), '.cloudcli', 'auth.db');

const db = new Database(dbPath, { readonly: true });

const user = db.prepare('SELECT id, username FROM users ORDER BY id LIMIT 1').get();
if (!user) {
  console.error(`no user in db at ${dbPath}`);
  process.exit(1);
}

// jwt secret may be stored in app_config table; fallback to env var.
let secret = process.env.JWT_SECRET;
if (!secret) {
  try {
    const row = db.prepare("SELECT value FROM app_config WHERE key = 'jwt_secret'").get();
    if (row && row.value) secret = row.value;
  } catch {
    /* table may not exist on older installs */
  }
}
if (!secret) {
  console.error('no JWT_SECRET in env and no app_config.jwt_secret row found');
  process.exit(1);
}

const token = jwt.sign({ userId: user.id, username: user.username }, secret, {
  expiresIn: '7d',
});
process.stdout.write(token);
