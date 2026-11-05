/**
 * Widget keys repository.
 *
 * One key per person for the phone widget. Only a hash is stored, so the key is
 * shown once when it is made. It reaches the task list and nothing else.
 */

import { createHash, randomBytes } from 'node:crypto';

import { getConnection } from '@/modules/database/connection.js';

type WidgetKeyRow = {
  user_id: number;
  created_at: string;
  last_used_at: string | null;
};

const hashOf = (key: string): string => createHash('sha256').update(key).digest('hex');

export const widgetKeysDb = {
  /** Makes a new key for the person, replacing the one they had. */
  issue(userId: number): string {
    const key = `bbw_${randomBytes(24).toString('base64url')}`;
    getConnection()
      .prepare(
        `INSERT INTO widget_keys (user_id, key_hash, created_at, last_used_at)
         VALUES (?, ?, CURRENT_TIMESTAMP, NULL)
         ON CONFLICT(user_id) DO UPDATE SET
           key_hash = excluded.key_hash,
           created_at = excluded.created_at,
           last_used_at = NULL`
      )
      .run(userId, hashOf(key));
    return key;
  },

  /** The owner of a key, or null. Marks the key as used. */
  userIdFor(key: string): number | null {
    const db = getConnection();
    const hash = hashOf(key);
    const row = db.prepare('SELECT user_id FROM widget_keys WHERE key_hash = ?').get(hash) as
      | { user_id: number }
      | undefined;
    if (!row) return null;
    db.prepare('UPDATE widget_keys SET last_used_at = CURRENT_TIMESTAMP WHERE key_hash = ?').run(hash);
    return row.user_id;
  },

  getForUser(userId: number): WidgetKeyRow | null {
    const row = getConnection()
      .prepare('SELECT user_id, created_at, last_used_at FROM widget_keys WHERE user_id = ?')
      .get(userId) as WidgetKeyRow | undefined;
    return row ?? null;
  },

  revoke(userId: number): void {
    getConnection().prepare('DELETE FROM widget_keys WHERE user_id = ?').run(userId);
  },
};
