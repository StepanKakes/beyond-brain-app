/**
 * Beyond Brain — cutting a moment out of a call recording.
 *
 * Fathom's share page exposes the recording as an HLS stream
 * (`<share url>/video.m3u8`), readable with the share token in the link and
 * nothing else. ffmpeg seeks into it and writes the seconds between
 * `startSec` and `endSec` as an mp4 with faststart, ready for a phone: Tim
 * adds B-roll and captions on top. Clips live outside the brain (video does
 * not belong in git), under the app's data dir, and are served by id.
 *
 * ffmpeg comes from `BEYOND_FFMPEG`, else the copy the brain's whisper
 * script uses (`system/bin/**‌/ffmpeg.exe`), else whatever is on PATH.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

import { resolveBrainPath } from '../utils/brain-path.js';
import * as obsah from './beyond-obsah.js';

const PAD_BEFORE_S = 0.8;
const PAD_AFTER_S = 0.6;
const MAX_CLIP_S = 180;

export function clipsDir() {
  const dir = path.join(os.homedir(), '.cloudcli', 'clips');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function findFile(dir, name, depth = 4) {
  if (depth < 0) return null;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isFile() && e.name.toLowerCase() === name) return p;
    if (e.isDirectory()) {
      const hit = findFile(p, name, depth - 1);
      if (hit) return hit;
    }
  }
  return null;
}

let ffmpegCache = null;
export function ffmpegPath() {
  if (ffmpegCache) return ffmpegCache;
  const env = process.env.BEYOND_FFMPEG;
  if (env && fs.existsSync(env)) return (ffmpegCache = env);
  const exe = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  const inBrain = findFile(path.join(resolveBrainPath(), 'system', 'bin'), exe);
  if (inBrain) return (ffmpegCache = inBrain);
  return (ffmpegCache = exe);
}

/** The HLS playlist behind a Fathom share link. */
export function hlsFor(fathomUrl) {
  const m = /^(https:\/\/fathom\.video\/share\/[A-Za-z0-9_-]+)/.exec(String(fathomUrl || '').trim());
  return m ? `${m[1]}/video.m3u8` : null;
}

function hhmmss(sec) {
  const s = Math.max(0, sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = (s % 60).toFixed(2);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(r).padStart(5, '0')}`;
}

/**
 * Cut [startSec, endSec] from the recording into `<clipsDir>/<id>.mp4`.
 * Resolves with { file, durationSec }; rejects with a readable reason.
 */
export function cutClip({ id, fathom, startSec, endSec }) {
  return new Promise((resolve, reject) => {
    const src = hlsFor(fathom);
    if (!src) return reject(new Error('chybí odkaz na Fathom share'));
    const a = Math.max(0, Number(startSec) - PAD_BEFORE_S);
    const b = Number(endSec) + PAD_AFTER_S;
    if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return reject(new Error('neplatné sekundy'));
    if (b - a > MAX_CLIP_S) return reject(new Error(`výsek je delší než ${MAX_CLIP_S} s`));
    const out = path.join(clipsDir(), `${String(id).replace(/[^\w-]/g, '')}.mp4`);
    const tmp = `${out}.part.mp4`;
    const args = [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-user_agent', 'Mozilla/5.0 (BeyondBrain)',
      '-ss', hhmmss(a), '-to', hhmmss(b),
      '-i', src,
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22',
      '-c:a', 'aac', '-b:a', '160k',
      '-movflags', '+faststart',
      tmp,
    ];
    const child = spawn(ffmpegPath(), args, { windowsHide: true });
    let err = '';
    child.stderr.on('data', (d) => { err += d.toString(); });
    child.on('error', (e) => reject(new Error(`ffmpeg nejde spustit: ${e.message}`)));
    child.on('close', (code) => {
      if (code !== 0) {
        try { fs.unlinkSync(tmp); } catch { /* nothing to remove */ }
        return reject(new Error(`ffmpeg skončil s kódem ${code}: ${err.trim().slice(-300)}`));
      }
      try {
        fs.renameSync(tmp, out);
      } catch (e) {
        return reject(e);
      }
      resolve({ file: out, durationSec: Math.round((b - a) * 10) / 10 });
    });
  });
}

export function clipFileFor(id) {
  const p = path.join(clipsDir(), `${String(id).replace(/[^\w-]/g, '')}.mp4`);
  return fs.existsSync(p) ? p : null;
}

/* ------------------------------------------------------------------ */
/* cutting for an item on the line                                     */
/* ------------------------------------------------------------------ */

const cutting = new Set();

/**
 * Cut the clip for a reel item in the background and write how it went
 * onto the item. Safe to call twice; a cut in flight is not started again.
 */
export async function cutForItem(item, by = 'agent') {
  if (!item || item.kind !== 'reel' || !item.source?.fathom) return;
  if (cutting.has(item.id)) return;
  cutting.add(item.id);
  await obsah.updateItem(item.id, { clip: { status: 'cutting', at: new Date().toISOString() } }, { by }).catch(() => {});
  try {
    const r = await cutClip({ id: item.id, fathom: item.source.fathom, startSec: item.startSec, endSec: item.endSec });
    await obsah.updateItem(item.id, { clip: { status: 'ready', at: new Date().toISOString(), durationSec: r.durationSec } }, { by });
  } catch (err) {
    console.error('[obsah] střih selhal', item.id, err?.message || err);
    await obsah.updateItem(item.id, { clip: { status: 'error', at: new Date().toISOString(), error: err?.message || String(err) } }, { by }).catch(() => {});
  } finally {
    cutting.delete(item.id);
  }
}

/** Every reel that has no clip yet, one after another. */
export async function cutMissing(by = 'agent') {
  const todo = obsah.listItems().filter((i) => i.kind === 'reel' && i.state !== 'zahozeno' && i.source?.fathom && (!i.clip || (i.clip.status === 'error' && !i.clip.retried)));
  for (const it of todo) {
    // eslint-disable-next-line no-await-in-loop
    await cutForItem(it, by);
    const after = obsah.getItem(it.id);
    if (after?.clip?.status === 'error') {
      // One retry on the next pass, then it waits for a person.
      // eslint-disable-next-line no-await-in-loop
      await obsah.updateItem(it.id, { clip: { ...after.clip, retried: Boolean(it.clip) } }, { by }).catch(() => {});
    }
  }
  return todo.length;
}

export function removeClipFile(id) {
  const p = clipFileFor(id);
  if (!p) return false;
  try { fs.unlinkSync(p); return true; } catch { return false; }
}
