import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Durably write a small JSON/text file on Windows.
 *
 * The obvious "write .tmp then rename over the target" is atomic on POSIX but
 * on Windows `rename` fails with EPERM/EBUSY whenever *anything* has the target
 * open for even a moment — antivirus/Defender scanning the file after a write,
 * the search indexer, or one of our own concurrent readers. That transient
 * failure was silently dropping session-index writes, so freshly-created chats
 * vanished on refresh (their uuid never reached the store).
 *
 * Strategy: write the temp file, then retry the rename a few times with backoff
 * (the lock is almost always released within tens of ms). If it still won't
 * rename, fall back to overwriting the target in place — not crash-atomic, but
 * far better than losing the write. Only transient lock codes are retried; a
 * real error (ENOSPC, EROFS, …) throws immediately.
 */

const TRANSIENT = new Set(['EPERM', 'EBUSY', 'EACCES', 'ENOTEMPTY', 'EEXIST']);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function writeFileAtomic(dest, data) {
  await fs.mkdir(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.tmp`;
  await fs.writeFile(tmp, data, 'utf8');

  let lastErr;
  // 1) Preferred: atomic rename, retried through transient locks (~40..240ms).
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      await fs.rename(tmp, dest);
      return;
    } catch (err) {
      lastErr = err;
      if (!TRANSIENT.has(err?.code)) break;
      await sleep(40 * (attempt + 1));
    }
  }

  // 2) Fallback: overwrite the target directly (loses atomicity, keeps data).
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      await fs.writeFile(dest, data, 'utf8');
      await fs.rm(tmp, { force: true }).catch(() => {});
      return;
    } catch (err) {
      lastErr = err;
      if (!TRANSIENT.has(err?.code)) break;
      await sleep(60 * (attempt + 1));
    }
  }

  await fs.rm(tmp, { force: true }).catch(() => {});
  throw lastErr;
}
