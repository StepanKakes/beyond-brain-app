/**
 * Renewing the Claude login of the machine the brain runs on, without a
 * terminal in the browser. `claude /login` is started in a pty here; the
 * address it prints is handed to the UI as a plain link, and the code the
 * person gets back in their own browser is typed into the pty for them.
 * One login at a time, thrown away after ten minutes.
 */
import os from 'node:os';
import pty from 'node-pty';

import { resolveClaudeCodeExecutablePath } from '../shared/claude-cli-path.js';

const MAX_AGE_MS = 10 * 60 * 1000;
// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007]*(?:\u0007|\u001b\\)|\u001b[()][A-Z0-9]/g;
const URL_RE = /https:\/\/claude\.(?:com|ai)\/\S*oauth\/authorize\S*/;

let current = null;

function stop() {
  if (!current) return;
  clearTimeout(current.timer);
  try { current.proc.kill(); } catch { /* already gone */ }
  current = null;
}

export function startClaudeLogin() {
  stop();
  const exe = resolveClaudeCodeExecutablePath();
  const quoted = `"${String(exe).replace(/"/g, '')}"`;
  const win = os.platform() === 'win32';
  const proc = pty.spawn(
    win ? 'powershell.exe' : 'bash',
    win ? ['-Command', `& ${quoted} /login`] : ['-c', `${quoted} /login`],
    {
      name: 'xterm-256color',
      // Wide, so the address is never broken over lines.
      cols: 2000,
      rows: 40,
      // The app's own folder, which the CLI already trusts on this machine.
      cwd: process.cwd(),
      env: { ...process.env, TERM: 'xterm-256color', BROWSER: 'none' },
    },
  );
  const state = { proc, out: '', url: null, done: false, failed: false, timer: null };
  state.timer = setTimeout(stop, MAX_AGE_MS);
  proc.onData((chunk) => {
    state.out = (state.out + chunk.replace(ANSI, '')).slice(-20000);
    // Asked about trusting the folder anyway: answer "Yes" (second choice) once.
    if (!state.trusted && /trust this folder/i.test(state.out)) {
      state.trusted = true;
      setTimeout(() => { try { proc.write('\u001b[B'); setTimeout(() => proc.write('\r'), 200); } catch { /* gone */ } }, 300);
    }
    // "Select login method": the first one, a Claude subscription, is preselected.
    if (!state.method && /select login method/i.test(state.out)) {
      state.method = true;
      setTimeout(() => { try { proc.write('\r'); } catch { /* gone */ } }, 300);
    }
    if (!state.url) {
      // The terminal may still have wrapped it: join lines before matching.
      const m = URL_RE.exec(state.out.replace(/\r?\n/g, ''));
      if (m) state.url = m[0];
    }
    if (/login successful|logged in as|successfully logged in/i.test(state.out)) state.done = true;
  });
  proc.onExit(({ exitCode }) => {
    if (exitCode === 0) state.done = true;
    else if (!state.done) state.failed = true;
  });
  current = state;
}

export function claudeLoginStatus() {
  if (!current) return { state: 'idle' };
  const tail = current.out.replace(/\r/g, '').split('\n').map((l) => l.trim()).filter(Boolean).slice(-6).join('\n');
  if (current.done) return { state: 'done', tail };
  if (current.failed) return { state: 'failed', tail };
  return { state: current.url ? 'url' : 'starting', url: current.url, tail };
}

export function submitClaudeLoginCode(code) {
  if (!current || current.done || current.failed) return false;
  const clean = String(code || '').trim();
  if (!clean || /[\r\n]/.test(clean) || clean.length > 400) return false;
  current.proc.write(`${clean}\r`);
  return true;
}

export function cancelClaudeLogin() {
  stop();
}
