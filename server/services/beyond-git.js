/**
 * Beyond Brain — committing what the agent changed.
 *
 * Every change to the brain is committed and pushed, that is the house rule.
 * Until now that relied on the agent remembering to run git itself at the end
 * of a prompt, which it did most of the time. Now the scheduler does it after
 * every run and every write the app makes on its own, so the history is
 * complete and each commit names the job that produced it.
 *
 * Push failures are not fatal: a rebase is tried once, and if the remote still
 * refuses, the commit stays local and the next run pushes it along. The run
 * log says so.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { resolveBrainPath } from '../utils/brain-path.js';

const execFileAsync = promisify(execFile);

async function git(args, { cwd = resolveBrainPath() } = {}) {
  try {
    const { stdout, stderr } = await execFileAsync('git', args, { cwd, maxBuffer: 8 * 1024 * 1024 });
    return { ok: true, stdout: stdout.trim(), stderr: stderr.trim() };
  } catch (err) {
    return {
      ok: false,
      stdout: String(err?.stdout || '').trim(),
      stderr: String(err?.stderr || err?.message || '').trim(),
    };
  }
}

/**
 * Bring in what others committed (n8n's raw pulls, Tim on another machine).
 * Rebase with autostash so a half-written local change survives. Never
 * throws; a failed pull is a note in the run log, not a dead run.
 */
export async function pullBrain() {
  const before = (await git(['rev-parse', 'HEAD'])).stdout;
  const r = await git(['pull', '--rebase', '--autostash', '--quiet']);
  if (r.ok) {
    const after = (await git(['rev-parse', 'HEAD'])).stdout;
    return { ok: true, note: null, changed: Boolean(before && after && before !== after) };
  }
  await git(['rebase', '--abort']);
  return { ok: false, note: `git pull selhal: ${r.stderr.slice(0, 200)}`, changed: false };
}

/** Is there anything to commit? */
export async function brainIsDirty() {
  const r = await git(['status', '--porcelain']);
  return r.ok && r.stdout.length > 0;
}

/**
 * Stage everything (or the given paths), commit with the message, push.
 * Returns what happened in words the run log can show. Never throws.
 */
export async function commitBrain(message, { paths = null, push = true } = {}) {
  const add = await git(paths?.length ? ['add', '--', ...paths] : ['add', '-A']);
  if (!add.ok) return { committed: false, pushed: false, note: `git add selhalo: ${add.stderr}` };

  const staged = await git(['diff', '--cached', '--quiet']);
  if (staged.ok) return { committed: false, pushed: false, note: null }; // nothing staged

  const commit = await git(['commit', '-m', message]);
  if (!commit.ok) return { committed: false, pushed: false, note: `git commit selhalo: ${commit.stderr}` };

  if (!push) return { committed: true, pushed: false, note: null };

  let pushed = await git(['push']);
  if (!pushed.ok) {
    const rebase = await git(['pull', '--rebase', '--autostash']);
    if (rebase.ok) pushed = await git(['push']);
    else await git(['rebase', '--abort']);
  }
  return {
    committed: true,
    pushed: pushed.ok,
    note: pushed.ok ? null : `commit je jen lokálně, push selhal: ${pushed.stderr.slice(0, 300)}`,
  };
}

/**
 * Commit and push without making the caller wait. Calls line up so two
 * quick edits do not race git; a failure is logged, never thrown. For the
 * small files a person edits from the screen (tasks, the content line),
 * where a click should answer in milliseconds, not after a push.
 */
let laterChain = Promise.resolve();
export function commitBrainLater(message, opts = {}) {
  laterChain = laterChain
    .then(() => commitBrain(message, opts))
    .then((r) => { if (r?.note) console.warn('[git]', r.note); })
    .catch((err) => console.warn('[git] odložený commit selhal', err?.message || err));
  return laterChain;
}
