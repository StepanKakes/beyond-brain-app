/**
 * What the installed Claude Code says it can run, verbatim.
 *
 * The chat's model picker shows this list, so when a model goes missing the
 * question is always whether the CLI stopped offering it or the app stopped
 * asking. This prints the raw answer, plus who is logged in, so the two can be
 * told apart from a workflow log.
 */
import { query } from '@anthropic-ai/claude-agent-sdk';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const creds = path.join(os.homedir(), '.claude', '.credentials.json');
try {
  const raw = JSON.parse(fs.readFileSync(creds, 'utf8'));
  const o = raw.claudeAiOauth || {};
  console.log(`account: subscription=${o.subscriptionType || '?'} scopes=${(o.scopes || []).join(',')} expires=${o.expiresAt ? new Date(o.expiresAt).toISOString() : '?'}`);
} catch (err) {
  console.log(`account: credentials unreadable (${err.message})`);
}

try {
  console.log(`cli: ${execFileSync('claude', ['--version'], { encoding: 'utf8' }).trim()}`);
} catch (err) {
  console.log(`cli: not on PATH (${err.message})`);
}

const q = query({ prompt: (async function* () { /* nothing to send */ })(), options: {} });
try {
  const models = await Promise.race([
    q.supportedModels(),
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 30000)),
  ]);
  console.log('models:', JSON.stringify(models, null, 2));
} catch (err) {
  console.log(`models failed: ${err.message}`);
} finally {
  try { await q.interrupt?.(); } catch { /* going away anyway */ }
  process.exit(0);
}
