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

// Ask the INSTALLED Claude Code, the one the app runs. Left to itself the SDK
// starts the older copy bundled in its npm package, which lists the models of
// its own generation and makes this log lie.
function installedCli() {
  if (process.env.CLAUDE_CLI_PATH && fs.existsSync(process.env.CLAUDE_CLI_PATH)) return process.env.CLAUDE_CLI_PATH;
  if (process.platform === 'win32') {
    const exe = path.join(process.env.APPDATA || '', 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe');
    if (fs.existsSync(exe)) return exe;
  }
  try {
    return execFileSync(process.platform === 'win32' ? 'where' : 'which', ['claude'], { encoding: 'utf8' }).split(/\r?\n/)[0].trim() || undefined;
  } catch {
    return undefined;
  }
}
const cliPath = installedCli();
console.log(`probing: ${cliPath || 'bundled copy (installed one not found)'}`);
const q = query({ prompt: (async function* () { /* nothing to send */ })(), options: cliPath ? { pathToClaudeCodeExecutable: cliPath } : {} });
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
