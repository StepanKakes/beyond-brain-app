/**
 * Beyond Brain — agent auth middleware.
 *
 * Used by /api/beyond-agent/* routes that are called from outside the browser
 * (e.g. n8n workflows wrapping a Telegram bot). Browser flows still use the
 * JWT-based authenticateToken middleware; this one validates a shared secret
 * + optional Telegram-user allow-list instead, so n8n doesn't need to manage
 * a real user session.
 *
 * The token lives in BEYOND_AGENT_TOKEN. If unset, all agent routes refuse —
 * fail-closed rather than fail-open is the safer default for a code-running
 * surface.
 */

function parseAllowedTgUsers() {
  const raw = process.env.BEYOND_AGENT_ALLOWED_TG_USERS || '';
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  // Avoid leaking length-prefix info: compare byte-by-byte.
  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

export const authenticateAgentToken = (req, res, next) => {
  const expected = process.env.BEYOND_AGENT_TOKEN;
  if (!expected) {
    return res.status(503).json({
      error: 'Agent endpoint disabled',
      detail: 'BEYOND_AGENT_TOKEN is not set on the server. Add it to .env, rebuild, and restart.',
    });
  }

  const supplied = req.headers['x-beyond-agent-token'];
  if (typeof supplied !== 'string' || !timingSafeEqual(supplied, expected)) {
    return res.status(401).json({ error: 'Invalid agent token' });
  }

  // Attach a minimal "agent identity" so downstream handlers can log it
  // without re-parsing the request.
  req.agent = {
    source: 'agent-token',
    telegramUserId:
      req.body && req.body.meta && req.body.meta.telegramUserId != null
        ? String(req.body.meta.telegramUserId)
        : null,
  };

  next();
};

export const authenticateAgent = (req, res, next) => {
  authenticateAgentToken(req, res, () => {
    const allowed = parseAllowedTgUsers();
    if (allowed.length > 0) {
      const meta = req.body && typeof req.body === 'object' ? req.body.meta : null;
      const tgUserId = meta && meta.telegramUserId != null ? String(meta.telegramUserId) : null;
      if (!tgUserId || !allowed.includes(tgUserId)) {
        return res.status(403).json({
          error: 'Telegram user not in allow-list',
          detail: tgUserId ? `User ${tgUserId} is not allowed.` : 'meta.telegramUserId missing.',
        });
      }
    }
    next();
  });
};
