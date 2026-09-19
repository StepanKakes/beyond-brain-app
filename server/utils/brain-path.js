/**
 * Beyond Brain — single source of truth for where the brain (data) repo lives.
 *
 * Before this module the same `BEYOND_BRAIN_PATH || ~/Documents/GitHub/beyond-brain`
 * expression was spelled out in three places (claude-sdk.js, routes/beyond.js,
 * routes/beyond-agent.js) and the browser hardcoded a fourth, macOS-only copy.
 * That fourth copy is what created the phantom `C:\Users\stepankakes\...` tree
 * on the Windows box (see scripts/fix-stepankakes-path.ps1): uploads and MCP
 * lookups were resolved against a directory that does not exist there.
 *
 * Everything server-side now goes through here, and the browser asks for the
 * value via `GET /api/beyond/config` instead of guessing.
 */
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** The configured brain repo path. Never throws; the directory may not exist. */
export function resolveBrainPath() {
  const fromEnv = process.env.BEYOND_BRAIN_PATH;
  if (fromEnv && fromEnv.trim()) return fromEnv.trim();
  return path.join(os.homedir(), 'Documents', 'GitHub', 'beyond-brain');
}

/** True when the configured brain repo is actually present on disk. */
export function brainPathExists() {
  return existsSync(resolveBrainPath());
}

/**
 * Pick the working directory to spawn an agent in.
 *
 * `requested` wins when it exists on disk, so a caller can still target another
 * checkout. Anything stale or cross-platform falls back to the brain path, and
 * if that is missing too we return `undefined` and let the SDK default to
 * `process.cwd()` rather than spawning into a directory that is not there.
 */
export function resolveSpawnCwd(requested) {
  if (requested && existsSync(requested)) {
    return requested;
  }
  const brainPath = resolveBrainPath();
  if (existsSync(brainPath)) {
    if (requested && requested !== brainPath) {
      console.warn(
        `[brain-path] requested cwd "${requested}" not found on disk, falling back to "${brainPath}"`,
      );
    }
    return brainPath;
  }
  if (requested) {
    console.warn(
      `[brain-path] requested cwd "${requested}" not found and brain path "${brainPath}" also missing — letting the SDK default to process.cwd()`,
    );
  }
  return undefined;
}
