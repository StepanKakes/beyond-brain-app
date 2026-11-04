// Structure of one chat's transcript for finding repeated rows. Run by the Chat
// structure workflow. The repo and its logs are public, so this prints no text:
// only types, ids and short hashes. It finds the chat by the hash of a message's
// first 30 characters.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const [wanted, hoursArg] = process.argv.slice(2);
const since = Date.now() - Number(hoursArg || 24) * 3600 * 1000;
const sha = (text) => crypto.createHash('sha1').update(text).digest('hex');

function walk(dir, out = []) {
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, item.name);
    if (item.isDirectory()) walk(full, out);
    else if (item.name.endsWith('.jsonl') && fs.statSync(full).mtimeMs > since) out.push(full);
  }
  return out;
}

const textOf = (entry) => {
  const content = entry.message?.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter((part) => part.type === 'text').map((part) => part.text).join('\n');
};

for (const file of walk(path.join(os.homedir(), '.claude', 'projects'))) {
  const rows = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      rows.push(JSON.parse(line));
    } catch {
      rows.push({ type: 'unparsable' });
    }
  }
  const match = rows.some((row) => row.type === 'user' && sha(textOf(row).slice(0, 30)).slice(0, 16) === wanted);
  if (!match) continue;
  console.log(`=== ${path.basename(path.dirname(file)).slice(0, 12)}/${path.basename(file)} rows=${rows.length}`);
  const firstSeen = new Map();
  rows.forEach((row, index) => {
    const text = textOf(row);
    const hash = text ? sha(text).slice(0, 8) : '-';
    const again = text && firstSeen.has(hash) ? `again-of#${firstSeen.get(hash)}` : '';
    if (text && !firstSeen.has(hash)) firstSeen.set(hash, index);
    const parts = Array.isArray(row.message?.content)
      ? row.message.content.map((part) => (part.type === 'tool_use' ? `use:${String(part.name).slice(0, 24)}` : part.type)).join(',')
      : typeof row.message?.content;
    console.log([
      `#${index}`,
      row.timestamp || '-',
      row.type,
      row.subtype || row.operation || '',
      row.message?.role || '',
      `side=${row.isSidechain ? 1 : 0}`,
      `meta=${row.isMeta ? 1 : 0}`,
      `replay=${row.isReplay ? 1 : 0}`,
      `sid=${String(row.sessionId || '').slice(0, 8)}`,
      `id=${String(row.uuid || '').slice(0, 8)}`,
      `parent=${String(row.parentUuid || '').slice(0, 8)}`,
      `text=${hash}/${text.length}`,
      again,
      parts,
    ].join(' '));
  });
}
