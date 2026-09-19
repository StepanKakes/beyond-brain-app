/**
 * Beyond Brain — who "we" are.
 *
 * Two people run the client side, and three things need to know which is which:
 * the promises in `_action-items.md` (whose headings name a person), the
 * Cal.com bookings (whose hosts name a person), and the velín's "moje" filter.
 *
 * The brain writes those names freely ("Otevřené (Tim → Kuba)", "Tim dluží",
 * "Otevřené (Štěpán)"), so a person is defined by the aliases they answer to
 * rather than by an exact string. Logins live in the app database; this maps a
 * login onto the person the brain and the calendar talk about.
 *
 * Overridable with `BEYOND_PEOPLE` as JSON, for when a third person joins:
 *   [{"key":"tim","displayName":"Tim","aliases":["tim"],"calcomEmail":"…"}]
 */

const DEFAULT_PEOPLE = [
  {
    key: 'tim',
    displayName: 'Tim',
    aliases: ['tim', 'tim trnka', 'vlastimil', 'creationwithtim'],
    usernames: ['tim'],
    calcomEmail: 'tim@creationwithtim.com',
    calcomUsername: 'creationwithtim',
  },
  {
    key: 'stepan',
    displayName: 'Štěpán',
    aliases: ['stepan', 'štěpán', 'kakes', 'kakeš', 'stepan kakes'],
    usernames: ['stepan', 'stepankakes'],
    calcomEmail: 'stepan.kakes1@gmail.com',
    calcomUsername: null,
  },
];

let cached = null;

export function getPeople() {
  if (cached) return cached;
  const raw = process.env.BEYOND_PEOPLE;
  if (raw && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length) {
        cached = parsed.map((p) => ({
          key: String(p.key),
          displayName: String(p.displayName || p.key),
          aliases: Array.isArray(p.aliases) ? p.aliases.map((a) => String(a).toLowerCase()) : [],
          usernames: Array.isArray(p.usernames) ? p.usernames.map((u) => String(u).toLowerCase()) : [],
          calcomEmail: p.calcomEmail || null,
          calcomUsername: p.calcomUsername || null,
        }));
        return cached;
      }
    } catch (err) {
      console.warn('[beyond-people] BEYOND_PEOPLE není platný JSON, používám výchozí', err?.message);
    }
  }
  cached = DEFAULT_PEOPLE;
  return cached;
}

/** Person for a logged-in app user, matched on username then display name. */
export function personForUser(user) {
  if (!user) return null;
  const uname = String(user.username || '').toLowerCase();
  const people = getPeople();
  return (
    people.find((p) => p.usernames.includes(uname)) ||
    people.find((p) => p.aliases.some((a) => uname.includes(a))) ||
    null
  );
}

/** Person named in a free-form string, e.g. an action-items heading. */
export function personForText(text) {
  if (!text) return null;
  const t = String(text).toLowerCase();
  return getPeople().find((p) => p.aliases.some((a) => t.includes(a))) || null;
}

export function invalidatePeopleCache() {
  cached = null;
}
