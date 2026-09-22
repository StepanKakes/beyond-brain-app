#!/usr/bin/env node
/**
 * Claude Code usage reporter — your own usage, sent to the brain.
 *
 * The brain app only sees the account-wide percentage from Claude's usage
 * endpoint. It cannot see your own Claude Code transcripts (they live on
 * your machine, not on the box the app runs on), so this little script sums
 * them locally and POSTs the totals to the app. There it is stored as
 * "external" usage and used to separate the brain's slice of the account
 * from yours.
 *
 * It reads `~/.claude/projects/<project>/<session>.jsonl`, takes every
 * assistant message's `message.usage` and `message.model`, turns them into
 * API-equivalent dollars, and sends only what it has not sent before (a
 * watermark of the newest timestamp seen, kept in a state file).
 *
 * Usage:
 *   BEYOND_URL=https://brain.example.com \
 *   BEYOND_AGENT_TOKEN=... \
 *   node scripts/claude-usage-reporter.mjs            # one pass (for cron/launchd)
 *
 *   ... --dry-run      # print what it would send, send nothing
 *   ... --summary      # no network: print last 5h / 24h / 7d / 30d as a table
 *   ... --all          # ignore the watermark, re-scan everything
 *   ... --verbose
 *
 * Env:
 *   BEYOND_URL            base URL of the brain app (required)
 *   BEYOND_AGENT_TOKEN    shared agent secret (required)
 *   BEYOND_MACHINE        name shown in the app; defaults to the hostname
 *   CLAUDE_PROJECTS_DIR   defaults to ~/.claude/projects
 *   BEYOND_USAGE_STATE    defaults to ~/.beyond/claude-usage-reporter.json
 *
 * macOS launchd (~/Library/LaunchAgents/cz.growbeyond.claude-usage.plist),
 * every 5 minutes:
 *
 *   <?xml version="1.0" encoding="UTF-8"?>
 *   <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
 *   <plist version="1.0"><dict>
 *     <key>Label</key><string>cz.growbeyond.claude-usage</string>
 *     <key>ProgramArguments</key><array>
 *       <string>/usr/bin/env</string><string>node</string>
 *       <string>/ABSOLUTE/PATH/claude-usage-reporter.mjs</string>
 *     </array>
 *     <key>EnvironmentVariables</key><dict>
 *       <key>BEYOND_URL</key><string>https://brain.example.com</string>
 *       <key>BEYOND_AGENT_TOKEN</key><string>SECRET</string>
 *     </dict>
 *     <key>StartInterval</key><integer>300</integer>
 *   </dict></plist>
 *
 * Then: launchctl load ~/Library/LaunchAgents/cz.growbeyond.claude-usage.plist
 *
 * Windows (Task Scheduler): action `node.exe C:\path\claude-usage-reporter.mjs`,
 * trigger every 5 minutes, with BEYOND_URL and BEYOND_AGENT_TOKEN as machine
 * environment variables.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ARGS = new Set(process.argv.slice(2));
const DRY = ARGS.has('--dry-run');
const SUMMARY = ARGS.has('--summary');
const ALL = ARGS.has('--all');
const VERBOSE = ARGS.has('--verbose');

const BEYOND_URL = (process.env.BEYOND_URL || '').replace(/\/+$/, '');
const TOKEN = process.env.BEYOND_AGENT_TOKEN || '';
const MACHINE = (process.env.BEYOND_MACHINE || os.hostname() || 'unknown').trim();
const PROJECTS_DIR = process.env.CLAUDE_PROJECTS_DIR || path.join(os.homedir(), '.claude', 'projects');
const STATE_FILE = process.env.BEYOND_USAGE_STATE || path.join(os.homedir(), '.beyond', 'claude-usage-reporter.json');

if (!DRY && !SUMMARY && (!BEYOND_URL || !TOKEN)) {
  console.error('chýbí BEYOND_URL a/nebo BEYOND_AGENT_TOKEN (viz hlavička souboru)');
  process.exit(2);
}

/** List price per 1M tokens, the same dollars the app uses. Model by substring. */
const PRICES = [
  { match: /opus/i, input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  { match: /haiku/i, input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
  { match: /sonnet/i, input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
];
const FALLBACK = PRICES[2];

function priceFor(model) {
  return PRICES.find((p) => p.match.test(model || '')) || FALLBACK;
}

function costOf(model, u) {
  const p = priceFor(model);
  return (
    (Number(u.input_tokens || 0) * p.input +
      Number(u.output_tokens || 0) * p.output +
      Number(u.cache_read_input_tokens || 0) * p.cacheRead +
      Number(u.cache_creation_input_tokens || 0) * p.cacheWrite) /
    1_000_000
  );
}

function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return { watermark: null };
  }
}

function writeState(state) {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`);
}

function listJsonl(dir) {
  const out = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listJsonl(full));
    else if (e.isFile() && e.name.endsWith('.jsonl')) out.push(full);
  }
  return out;
}

/** Parse one session file into usage rows newer than `after`. */
function rowsFromFile(file, after) {
  const sessionId = path.basename(file, '.jsonl');
  let content;
  try {
    content = fs.readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  const rows = [];
  for (const line of content.split('\n')) {
    if (!line || line.indexOf('"usage"') === -1) continue;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    const msg = obj.message;
    const usage = msg && msg.usage;
    if (!usage) continue;
    const ts = obj.timestamp || obj.created_at || msg.created_at || null;
    if (!ts) continue;
    if (after && ts <= after) continue;
    const model = msg.model || obj.model || null;
    const uuid = obj.uuid || null;
    rows.push({
      ts,
      sessionId,
      model,
      input: Number(usage.input_tokens || 0),
      output: Number(usage.output_tokens || 0),
      cacheRead: Number(usage.cache_read_input_tokens || 0),
      cacheWrite: Number(usage.cache_creation_input_tokens || 0),
      costUsd: Math.round(costOf(model, usage) * 1e6) / 1e6,
      dedupeKey: uuid ? `${MACHINE}:${sessionId}:${uuid}` : undefined,
    });
  }
  return rows;
}

async function post(events) {
  const res = await fetch(`${BEYOND_URL}/api/beyond-agent/usage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-beyond-agent-token': TOKEN },
    body: JSON.stringify({ machine: MACHINE, source: 'claude-code', events }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  return JSON.parse(text || '{}');
}

const BATCH = 500;

async function postBatched(events) {
  let stored = 0;
  for (let i = 0; i < events.length; i += BATCH) {
    const out = await post(events.slice(i, i + BATCH));
    stored += out.stored ?? 0;
    if (VERBOSE) console.log(`  batch ${i / BATCH + 1}: odesláno ${out.stored ?? '?'}/${Math.min(BATCH, events.length - i)}`);
  }
  return stored;
}

/** Read-only: last 5h / 24h / 7d / 30d from the transcripts, no network. */
function summarize() {
  const windows = { '5 h': 5 * 3600e3, '24 h': 24 * 3600e3, '7 dní': 7 * 864e5, '30 dní': 30 * 864e5 };
  const now = Date.now();
  const agg = {};
  for (const k of Object.keys(windows)) agg[k] = { n: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
  const days = {};
  const after = new Date(now - 30 * 864e5).toISOString();

  for (const file of listJsonl(PROJECTS_DIR)) {
    for (const r of rowsFromFile(file, after)) {
      const ts = Date.parse(r.ts);
      if (!Number.isFinite(ts)) continue;
      for (const [k, len] of Object.entries(windows)) {
        if (now - ts > len) continue;
        const a = agg[k];
        a.n += 1;
        a.input += r.input;
        a.output += r.output;
        a.cacheRead += r.cacheRead;
        a.cacheWrite += r.cacheWrite;
        a.cost += r.costUsd;
      }
      if (now - ts <= 7 * 864e5) {
        const key = new Date(ts).toISOString().slice(0, 10);
        days[key] = (days[key] || 0) + r.costUsd;
      }
    }
  }

  const M = (x) => (x / 1e6).toFixed(x >= 1e7 ? 0 : 1);
  console.log(`Claude Code na ${MACHINE} (${PROJECTS_DIR}), jen čtení:\n`);
  console.log('okno   |  tahů |     in | cache-read | cache-write |    out |  ~USD');
  for (const [k, a] of Object.entries(agg)) {
    console.log(
      `${k.padEnd(6)} | ${String(a.n).padStart(5)} | ${M(a.input).padStart(4)}M | ${M(a.cacheRead).padStart(8)}M | ${M(a.cacheWrite).padStart(9)}M | ${M(a.output).padStart(4)}M | $${a.cost.toFixed(0)}`,
    );
  }
  const dayKeys = Object.keys(days).sort();
  if (dayKeys.length) {
    console.log('\npo dnech (7 dní):');
    for (const d of dayKeys) console.log(`  ${d}  $${days[d].toFixed(0)}`);
  }
  console.log('\nJsou to API-ekvivalentní dolary, ne částka na faktuře (jedeš na subscription).');
}

async function main() {
  if (SUMMARY) return summarize();
  const state = readState();
  // First run backfills 30 days at most (the meter only keeps 21); --all does
  // everything on purpose.
  const defaultAfter = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const after = ALL ? null : state.watermark || defaultAfter;

  let files = 0;
  const events = [];
  let maxTs = state.watermark;
  for (const file of listJsonl(PROJECTS_DIR)) {
    // Cheap skip: nothing new written since the watermark.
    try {
      const mtime = fs.statSync(file).mtimeMs;
      if (after && Date.parse(after) - mtime > 0) continue;
    } catch {
      continue;
    }
    const rows = rowsFromFile(file, after);
    if (!rows.length) continue;
    files += 1;
    for (const r of rows) {
      events.push(r);
      if (!maxTs || r.ts > maxTs) maxTs = r.ts;
    }
  }

  const total = events.reduce((s, e) => s + (e.costUsd || 0), 0);
  if (VERBOSE || DRY) {
    console.log(`${MACHINE}: ${events.length} tahů ze ${files} sessions, $${total.toFixed(2)} (od ${after || 'začátku'})`);
  }

  if (!events.length) return;
  if (DRY) {
    console.log('DRY RUN — neodesílám.');
    return;
  }

  const stored = await postBatched(events);
  writeState({ watermark: maxTs, updatedAt: new Date().toISOString(), machine: MACHINE, lastSent: events.length });
  if (VERBOSE) console.log(`uloženo ${stored} z ${events.length} (${MACHINE})`);
}

main().catch((err) => {
  console.error(`reportér selhal: ${err?.message || err}`);
  process.exit(1);
});