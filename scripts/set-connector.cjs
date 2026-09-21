// Add or update one connector in the app's connector store on the box, from
// a workflow, so a token that lives in a repo secret never has to be pasted
// by a person. Reads NAME, URL, TOKEN (bearer) from the environment; the
// store is read each request, so no restart is needed.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const file = path.join(os.homedir(), '.cloudcli', 'beyond-mcp-connectors.json');
const name = (process.env.NAME || '').trim();
const url = (process.env.URL || '').trim();
const token = (process.env.TOKEN || '').trim();
if (!name || !url) {
  console.error('NAME and URL are required');
  process.exit(1);
}
let store = { connectors: [] };
try {
  store = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(store.connectors)) store.connectors = [];
} catch {
  /* first connector */
}
const now = Date.now();
const headers = token ? { Authorization: `Bearer ${token}` } : {};
const existing = store.connectors.find((c) => c && c.name === name);
if (existing) {
  Object.assign(existing, { url, transport: 'http', enabled: true, auth: token ? 'token' : 'none', headers, oauth: null, status: 'unknown', lastError: null, updatedAt: now });
  console.log(`updated ${name}`);
} else {
  store.connectors.push({ id: crypto.randomUUID(), name, transport: 'http', enabled: true, url, command: '', args: [], env: {}, headers, auth: token ? 'token' : 'none', oauth: null, status: 'unknown', lastError: null, createdAt: now, updatedAt: now });
  console.log(`added ${name}`);
}
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, JSON.stringify(store, null, 2));
console.log(`connectors: ${store.connectors.map((c) => `${c.name}${c.enabled ? '' : ' (off)'}`).join(', ')}`);
