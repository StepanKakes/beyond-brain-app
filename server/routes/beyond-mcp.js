/**
 * Beyond Brain — MCP connectors API.
 *
 * Powers the in-app "Konektory" panel: add / manage MCP servers (local stdio,
 * remote http/sse with a manual token, or remote http/sse with a full OAuth
 * flow — Claude-app style). Connectors + their OAuth tokens live in the
 * Beyond-native store (server/services/beyond-mcp-connectors-store.js) and are
 * injected into the SDK at runtime by loadMcpConfig (claude-sdk.js).
 *
 * Two routers are exported:
 *   - `default` (beyondMcpRoutes): the CRUD + OAuth-start API, mounted UNDER
 *     `authenticateToken` at /api/beyond/mcp.
 *   - `oauthCallbackRouter`: the single OAuth redirect target, mounted WITHOUT
 *     auth at /api/beyond-mcp-oauth (the provider redirects the user's browser
 *     here with no JWT). It's secured by the opaque, single-use `state`.
 */
import express from 'express';

import {
  listPublicConnectors,
  getConnector,
  addConnector,
  updateConnector,
  removeConnector,
  toPublicConnector,
  takePending,
  TRANSPORTS,
  AUTH_MODES,
} from '../services/beyond-mcp-connectors-store.js';
import {
  beginAuthorization,
  completeAuthorization,
  detectRemoteAuth,
  probe,
} from '../services/beyond-mcp-oauth.js';

// ---------------------------------------------------------------------------
// A small curated gallery of popular remote MCP servers (Claude-app style
// quick-add). URLs/transports are the publicly documented endpoints; most
// require OAuth, which we auto-detect on add.
// ---------------------------------------------------------------------------
// Curated quick-add gallery, relevant to the Beyond (mentoring) workflow. Only
// servers that are a real public remote MCP endpoint AND support OAuth dynamic
// client registration (which our flow needs) are listed — verified live. Other
// services (Fathom, Google, Gmail) have no addable public MCP URL, so they can
// only be added as a custom connector once/if such a URL exists.
const PRESETS = [
  { id: 'notion', name: 'Notion', url: 'https://mcp.notion.com/mcp', transport: 'http', description: 'Stránky, databáze a poznámky v Notion — zdroj klientských dat.' },
  { id: 'cal', name: 'Cal.com', url: 'https://mcp.cal.com/mcp', transport: 'http', description: 'Rezervace a plánování schůzek s klienty.' },
  { id: 'airtable', name: 'Airtable', url: 'https://mcp.airtable.com/mcp', transport: 'http', description: 'Tabulky a databáze klientů v Airtable.' },
];

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------
function parseTransport(value, fallback = 'http') {
  return TRANSPORTS.includes(value) ? value : fallback;
}

function asStringArray(v) {
  if (Array.isArray(v)) return v.filter((s) => typeof s === 'string');
  return [];
}
function asStringRecord(v) {
  if (!v || typeof v !== 'object') return {};
  const out = {};
  for (const [k, val] of Object.entries(v)) {
    if (typeof k === 'string' && typeof val === 'string') out[k] = val;
  }
  return out;
}

/** Build the OAuth redirect URI. Stable across start + callback so it matches
 *  the value registered via dynamic client registration. Honours
 *  BEYOND_PUBLIC_URL (e.g. https://brain.growbeyond.cz) then falls back to the
 *  forwarded proto/host set by the Cloudflare tunnel / reverse proxy. */
function redirectUriFor(req) {
  const base = (process.env.BEYOND_PUBLIC_URL || '').replace(/\/+$/, '');
  if (base) return `${base}/api/beyond-mcp-oauth/callback`;
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}/api/beyond-mcp-oauth/callback`;
}

// ===========================================================================
// Authenticated CRUD router  →  /api/beyond/mcp
// ===========================================================================
const router = express.Router();

router.get('/presets', (_req, res) => {
  res.json({ presets: PRESETS });
});

router.get('/connectors', async (_req, res) => {
  try {
    res.json({ connectors: await listPublicConnectors() });
  } catch (err) {
    console.error('[beyond-mcp] list failed', err);
    res.status(500).json({ error: 'Nepodařilo se načíst konektory.' });
  }
});

router.post('/connectors', async (req, res) => {
  try {
    const body = req.body || {};
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) return res.status(400).json({ error: 'Název je povinný.' });

    const transport = parseTransport(body.transport);
    let auth = AUTH_MODES.includes(body.auth) ? body.auth : 'none';

    const draft = {
      name,
      transport,
      enabled: body.enabled !== false,
      url: typeof body.url === 'string' ? body.url.trim() : '',
      command: typeof body.command === 'string' ? body.command.trim() : '',
      args: asStringArray(body.args),
      env: asStringRecord(body.env),
      headers: asStringRecord(body.headers),
      auth,
      status: 'unknown',
    };

    if (transport === 'stdio') {
      if (!draft.command) return res.status(400).json({ error: 'U lokálního serveru je nutný příkaz.' });
      draft.auth = 'none';
      draft.status = 'unknown';
    } else {
      if (!draft.url) return res.status(400).json({ error: 'U vzdáleného serveru je nutná URL.' });
      // Auto-detect OAuth when the caller didn't explicitly pick token auth.
      if (draft.auth !== 'token') {
        const detected = await detectRemoteAuth(draft.url).catch(() => ({ needsOAuth: false }));
        if (detected.needsOAuth) {
          draft.auth = 'oauth';
          draft.status = 'needs_auth';
        } else {
          draft.auth = Object.keys(draft.headers).length ? 'token' : 'none';
          draft.status = 'unknown';
        }
      } else {
        draft.status = 'unknown';
      }
    }

    const created = await addConnector(draft);
    res.status(201).json({ connector: toPublicConnector(created) });
  } catch (err) {
    console.error('[beyond-mcp] create failed', err);
    res.status(500).json({ error: err?.message || 'Vytvoření konektoru selhalo.' });
  }
});

router.patch('/connectors/:id', async (req, res) => {
  try {
    const body = req.body || {};
    const patch = {};
    if (typeof body.name === 'string') patch.name = body.name.trim();
    if (typeof body.enabled === 'boolean') patch.enabled = body.enabled;
    if (typeof body.url === 'string') patch.url = body.url.trim();
    if (typeof body.command === 'string') patch.command = body.command.trim();
    if (Array.isArray(body.args)) patch.args = asStringArray(body.args);
    if (body.env && typeof body.env === 'object') patch.env = asStringRecord(body.env);
    if (body.headers && typeof body.headers === 'object') patch.headers = asStringRecord(body.headers);
    if (TRANSPORTS.includes(body.transport)) patch.transport = body.transport;
    if (AUTH_MODES.includes(body.auth)) patch.auth = body.auth;

    const updated = await updateConnector(req.params.id, patch);
    if (!updated) return res.status(404).json({ error: 'Konektor nenalezen.' });
    res.json({ connector: toPublicConnector(updated) });
  } catch (err) {
    console.error('[beyond-mcp] patch failed', err);
    res.status(500).json({ error: err?.message || 'Úprava selhala.' });
  }
});

router.delete('/connectors/:id', async (req, res) => {
  try {
    const removed = await removeConnector(req.params.id);
    if (!removed) return res.status(404).json({ error: 'Konektor nenalezen.' });
    res.json({ removed: true });
  } catch (err) {
    console.error('[beyond-mcp] delete failed', err);
    res.status(500).json({ error: 'Smazání selhalo.' });
  }
});

router.post('/connectors/:id/test', async (req, res) => {
  try {
    const connector = await getConnector(req.params.id);
    if (!connector) return res.status(404).json({ error: 'Konektor nenalezen.' });
    const result = await probe(connector);
    // Persist the probed status (unknown is not persisted — it's not a verdict).
    if (result.status && result.status !== 'unknown') {
      await updateConnector(connector.id, {
        status: result.status,
        lastError: result.status === 'error' ? result.detail || null : null,
      });
    }
    res.json(result);
  } catch (err) {
    console.error('[beyond-mcp] test failed', err);
    res.status(500).json({ error: err?.message || 'Test selhal.' });
  }
});

router.post('/connectors/:id/oauth/start', async (req, res) => {
  try {
    const connector = await getConnector(req.params.id);
    if (!connector) return res.status(404).json({ error: 'Konektor nenalezen.' });
    if (connector.transport === 'stdio') {
      return res.status(400).json({ error: 'Lokální server nepoužívá OAuth.' });
    }
    const redirectUri = redirectUriFor(req);
    const { authorizationUrl, state, manual, redirectUri: used } = await beginAuthorization(connector, redirectUri);
    res.json({ authorizationUrl, state, manual: Boolean(manual), redirectUri: used });
  } catch (err) {
    console.error('[beyond-mcp] oauth start failed', err);
    res.status(500).json({ error: err?.message || 'Spuštění přihlášení selhalo.' });
  }
});

// The loopback case: the browser ended on an address the box does not
// serve, the person pasted it here, and the code in it finishes the flow.
router.post('/connectors/:id/oauth/finish', async (req, res) => {
  try {
    const raw = String(req.body?.url || '').trim();
    let parsed;
    try {
      parsed = new URL(raw);
    } catch {
      return res.status(400).json({ error: 'To není adresa. Zkopíruj celý řádek z adresního řádku okna.' });
    }
    const code = parsed.searchParams.get('code');
    const state = parsed.searchParams.get('state');
    const oauthError = parsed.searchParams.get('error');
    if (oauthError) return res.status(400).json({ error: parsed.searchParams.get('error_description') || oauthError });
    if (!code || !state) return res.status(400).json({ error: 'V adrese chybí code nebo state.' });
    const pending = takePending(state);
    if (!pending || pending.connectorId !== req.params.id) {
      return res.status(400).json({ error: 'Přihlášení už vypršelo, klikni na Připojit znovu.' });
    }
    const connector = await completeAuthorization(pending, code);
    res.json({ ok: true, connector });
  } catch (err) {
    console.error('[beyond-mcp] oauth finish failed', err);
    res.status(500).json({ error: err?.message || 'Výměna tokenu selhala.' });
  }
});

// ===========================================================================
// Unauthenticated OAuth callback router  →  /api/beyond-mcp-oauth
// ===========================================================================
const callbackRouter = express.Router();

/** Minimal HTML that notifies the opener window and closes the popup. */
function callbackHtml({ ok, connectorId, error }) {
  const payload = JSON.stringify({ type: 'beyond-mcp-oauth', ok, connectorId: connectorId || null, error: error || null });
  const heading = ok ? 'Konektor připojen ✓' : 'Přihlášení selhalo';
  const detail = ok ? 'Toto okno se automaticky zavře.' : (error || 'Zkuste to prosím znovu.');
  return `<!doctype html><html lang="cs"><head><meta charset="utf-8"><title>${heading}</title>
<style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;display:flex;height:100vh;margin:0;align-items:center;justify-content:center;background:#faf9f7;color:#1a1a1a}
.card{text-align:center;padding:2rem 2.5rem}h1{font-size:1.1rem;font-weight:600;margin:0 0 .5rem}p{color:#6b6b6b;font-size:.9rem;margin:0}</style></head>
<body><div class="card"><h1>${heading}</h1><p>${detail}</p></div>
<script>
try { if (window.opener) window.opener.postMessage(${payload}, '*'); } catch (e) {}
setTimeout(function(){
  if (window.opener) { try { window.close(); } catch (e) {} }
  else { location.replace('/'); }
}, ${ok ? 800 : 2500});
</script></body></html>`;
}

callbackRouter.get('/callback', async (req, res) => {
  res.set('Content-Type', 'text/html; charset=utf-8');
  const { code, state, error, error_description } = req.query || {};

  if (error) {
    return res.status(400).send(
      callbackHtml({ ok: false, error: String(error_description || error) }),
    );
  }
  if (!code || !state) {
    return res.status(400).send(callbackHtml({ ok: false, error: 'Chybí code/state.' }));
  }

  const pending = takePending(String(state));
  if (!pending) {
    return res.status(400).send(
      callbackHtml({ ok: false, error: 'Neplatný nebo prošlý požadavek (state).' }),
    );
  }

  try {
    const connector = await completeAuthorization(pending, String(code));
    res.send(callbackHtml({ ok: true, connectorId: connector?.id }));
  } catch (err) {
    console.error('[beyond-mcp] oauth callback failed', err);
    await updateConnector(pending.connectorId, {
      status: 'needs_auth',
      lastError: err?.message || 'Výměna tokenu selhala.',
    }).catch(() => {});
    res.status(500).send(
      callbackHtml({ ok: false, connectorId: pending.connectorId, error: err?.message || 'Výměna tokenu selhala.' }),
    );
  }
});

export default router;
export { callbackRouter as oauthCallbackRouter };
