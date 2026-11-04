/**
 * Beyond Brain — where Google sends the browser back after "Povolit".
 *
 * Mounted without a JWT because the redirect carries none; the single-use
 * `state` handed out by the authenticated start of the flow secures it.
 */
import express from 'express';

import { finishAuthorization } from '../services/beyond-google.js';

const router = express.Router();

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function page(heading, detail) {
  return `<!doctype html><html lang="cs"><head><meta charset="utf-8"><title>${escapeHtml(heading)}</title>
<style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;display:flex;height:100vh;margin:0;align-items:center;justify-content:center;background:#faf9f7;color:#1a1a1a}
.card{text-align:center;padding:2rem 2.5rem}h1{font-size:1.1rem;font-weight:600;margin:0 0 .5rem}p{color:#6b6b6b;font-size:.9rem;margin:0}</style></head>
<body><div class="card"><h1>${escapeHtml(heading)}</h1><p>${escapeHtml(detail)}</p></div></body></html>`;
}

router.get('/callback', async (req, res) => {
  res.set('Content-Type', 'text/html; charset=utf-8');
  const { code, state, error } = req.query || {};
  if (error) return res.status(400).send(page('Povolení se nepovedlo', String(error)));
  if (!code || !state) return res.status(400).send(page('Povolení se nepovedlo', 'V adrese chybí code nebo state.'));
  try {
    const account = await finishAuthorization(String(code), String(state));
    return res.send(page('Google je připojený', `Účet ${account}. Tohle okno můžeš zavřít.`));
  } catch (err) {
    console.error('[google] povolení selhalo', err?.message);
    return res.status(400).send(page('Povolení se nepovedlo', err?.message || 'Zkus to znovu.'));
  }
});

export default router;
