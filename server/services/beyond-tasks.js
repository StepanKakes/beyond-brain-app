/**
 * Beyond Brain — jobs as data.
 *
 * The built-in jobs are code, because they carry logic (which client, which
 * file, what to queue). Their timing, though, is not code: it lives in the
 * brain, in `system/ulohy.json`, next to the jobs the agent creates itself.
 *
 * That file is the whole reason this module exists. Tim can read it, the agent
 * can read it and change it through one tool, git remembers every change, and
 * "the schedule is baked into the app" stops being true. A job the agent adds
 * from a sentence in Telegram ("za tři dny mi připomeň, jestli Honza poslal
 * metriky") is a record here with a one-shot schedule, nothing more.
 *
 * Shape:
 *
 *   {
 *     "rozvrh": { "<vestavěná úloha>": <schedule> },   // přepsaný rozvrh vestavěných
 *     "ulohy": [ { id, name, title, prompt, skill, schedule, deliver, repeat,
 *                  enabled, continuity, noAgent, createdBy, createdAt, origin } ]
 *   }
 *
 * Runtime state (last run, status) is not here; it is in SQLite with the rest
 * of the run log. This file says what should happen, not what did.
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

import { resolveBrainPath } from '../utils/brain-path.js';
import { normalizeSchedule } from './beyond-schedule.js';
import { commitBrain } from './beyond-git.js';

const FILE = path.join('system', 'ulohy.json');
const MAX_TASKS = 60;

let cache = { mtimeMs: -1, data: null };

function filePath() {
  return path.join(resolveBrainPath(), FILE);
}

function emptyFile() {
  return {
    _: 'Úlohy agenta. Vestavěné úlohy jsou v kódu appky, tady je jen jejich přepsaný rozvrh. Vlastní úlohy jsou celé tady. Mění to nástroj beyond_schedule nebo ruka, obojí jde přes git.',
    rozvrh: {},
    ulohy: [],
  };
}

/** Read the file, cached by mtime so a tick does not hit the disk for nothing. */
export function readTasksFile() {
  const p = filePath();
  let stat;
  try {
    stat = fs.statSync(p);
  } catch {
    cache = { mtimeMs: -1, data: emptyFile() };
    return cache.data;
  }
  if (cache.data && cache.mtimeMs === stat.mtimeMs) return cache.data;
  try {
    const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
    const data = {
      ...emptyFile(),
      ...parsed,
      rozvrh: parsed.rozvrh && typeof parsed.rozvrh === 'object' ? parsed.rozvrh : {},
      ulohy: Array.isArray(parsed.ulohy) ? parsed.ulohy : [],
    };
    cache = { mtimeMs: stat.mtimeMs, data };
  } catch (err) {
    console.warn('[tasks] system/ulohy.json se nedá přečíst, používám prázdný:', err?.message || err);
    cache = { mtimeMs: stat.mtimeMs, data: emptyFile() };
  }
  return cache.data;
}

async function writeTasksFile(data, message) {
  const p = filePath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  cache = { mtimeMs: -1, data: null };
  const git = await commitBrain(message, { paths: [FILE] });
  if (git.note) console.warn('[tasks]', git.note);
  return git;
}

/* ------------------------------------------------------------------ */
/* schedule overrides for the built-in jobs                            */
/* ------------------------------------------------------------------ */

export function scheduleOverride(jobName) {
  const s = readTasksFile().rozvrh?.[jobName];
  if (!s) return null;
  try {
    return normalizeSchedule(s);
  } catch (err) {
    console.warn(`[tasks] rozvrh pro ${jobName} je neplatný, beru výchozí:`, err?.message || err);
    return null;
  }
}

export async function setScheduleOverride(jobName, schedule, { by = 'app' } = {}) {
  const data = structuredClone(readTasksFile());
  if (schedule == null) delete data.rozvrh[jobName];
  else data.rozvrh[jobName] = normalizeSchedule(schedule);
  await writeTasksFile(data, `Agent: rozvrh úlohy ${jobName} (${by})`);
  return data.rozvrh[jobName] || null;
}

/* ------------------------------------------------------------------ */
/* custom tasks                                                        */
/* ------------------------------------------------------------------ */

const DELIVER_KINDS = new Set(['telegram', 'soubor', 'nic']);

function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
}

function normalizeDeliver(input) {
  if (!input) return { kind: 'nic' };
  if (typeof input === 'string') {
    const [kind, chatId] = input.split(':');
    return normalizeDeliver({ kind, chatId });
  }
  const kind = String(input.kind || 'nic').toLowerCase();
  if (!DELIVER_KINDS.has(kind)) throw new Error(`deliver umí telegram, soubor nebo nic, ne „${input.kind}"`);
  const out = { kind };
  if (kind === 'telegram' && input.chatId) out.chatId = String(input.chatId);
  return out;
}

export function listTasks() {
  return readTasksFile().ulohy.map((t) => ({ ...t }));
}

export function getTask(idOrName) {
  const key = String(idOrName || '');
  return readTasksFile().ulohy.find((t) => t.id === key || t.name === key) || null;
}

/**
 * Create a task. `createdBy` names the person or the session that asked for
 * it; `origin` remembers where (e.g. a Telegram chat) so `deliver: telegram`
 * without a chat id goes back there.
 */
export async function createTask({
  title,
  prompt,
  skill = null,
  schedule,
  deliver = null,
  repeat = null,
  continuity = false,
  noAgent = false,
  mcp = [],
  createdBy = 'app',
  origin = null,
}) {
  const data = structuredClone(readTasksFile());
  if (data.ulohy.length >= MAX_TASKS) throw new Error(`už je ${MAX_TASKS} úloh, nejdřív nějakou zruš`);
  if (!title || !String(title).trim()) throw new Error('title chybí');
  if (!prompt || !String(prompt).trim()) throw new Error('prompt chybí');

  const normalized = normalizeSchedule(schedule);
  const base = slugify(title) || 'uloha';
  let name = base;
  let i = 2;
  while (data.ulohy.some((t) => t.name === name)) name = `${base}-${i++}`;

  const task = {
    id: `u-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${randomBytes(3).toString('hex')}`,
    name,
    title: String(title).trim(),
    prompt: String(prompt).trim(),
    skill: skill ? String(skill).trim() : null,
    schedule: normalized,
    deliver: normalizeDeliver(deliver),
    repeat: normalized.kind === 'at' ? { times: 1, completed: 0 } : repeat?.times ? { times: Number(repeat.times), completed: 0 } : null,
    enabled: true,
    continuity: Boolean(continuity),
    noAgent: Boolean(noAgent),
    /** Connectors this task may load; empty means the brain's own tools only. */
    mcp: Array.isArray(mcp) ? mcp.map((m) => String(m)) : [],
    createdBy: String(createdBy),
    createdAt: new Date().toISOString(),
    origin: origin || null,
  };
  if (task.deliver.kind === 'telegram' && !task.deliver.chatId && origin?.telegramChatId) {
    task.deliver.chatId = String(origin.telegramChatId);
  }
  data.ulohy.push(task);
  await writeTasksFile(data, `Agent: nová úloha ${task.name} (${task.createdBy})`);
  return task;
}

export async function updateTask(idOrName, patch, { by = 'app' } = {}) {
  const data = structuredClone(readTasksFile());
  const task = data.ulohy.find((t) => t.id === idOrName || t.name === idOrName);
  if (!task) throw new Error(`úloha ${idOrName} neexistuje`);

  if (patch.title != null) task.title = String(patch.title).trim();
  if (patch.prompt != null) task.prompt = String(patch.prompt).trim();
  if (patch.skill !== undefined) task.skill = patch.skill ? String(patch.skill).trim() : null;
  if (patch.schedule != null) task.schedule = normalizeSchedule(patch.schedule);
  if (patch.deliver !== undefined) task.deliver = normalizeDeliver(patch.deliver);
  if (patch.enabled != null) task.enabled = Boolean(patch.enabled);
  if (patch.continuity != null) task.continuity = Boolean(patch.continuity);
  if (patch.noAgent != null) task.noAgent = Boolean(patch.noAgent);
  if (patch.repeat !== undefined) {
    task.repeat = patch.repeat?.times ? { times: Number(patch.repeat.times), completed: task.repeat?.completed || 0 } : null;
  }
  task.updatedAt = new Date().toISOString();
  task.updatedBy = String(by);
  await writeTasksFile(data, `Agent: úloha ${task.name} upravena (${by})`);
  return task;
}

/** Called by the scheduler after a run of a repeating task. */
export async function noteTaskRan(idOrName) {
  const data = structuredClone(readTasksFile());
  const task = data.ulohy.find((t) => t.id === idOrName || t.name === idOrName);
  if (!task) return null;
  let changed = false;
  if (task.repeat?.times) {
    task.repeat.completed = (task.repeat.completed || 0) + 1;
    changed = true;
    if (task.repeat.completed >= task.repeat.times) task.enabled = false;
  } else if (task.schedule?.kind === 'at') {
    task.enabled = false;
    changed = true;
  }
  if (changed) await writeTasksFile(data, `Agent: úloha ${task.name} proběhla`);
  return task;
}

export async function removeTask(idOrName, { by = 'app' } = {}) {
  const data = structuredClone(readTasksFile());
  const idx = data.ulohy.findIndex((t) => t.id === idOrName || t.name === idOrName);
  if (idx < 0) throw new Error(`úloha ${idOrName} neexistuje`);
  const [task] = data.ulohy.splice(idx, 1);
  await writeTasksFile(data, `Agent: úloha ${task.name} zrušena (${by})`);
  return task;
}
