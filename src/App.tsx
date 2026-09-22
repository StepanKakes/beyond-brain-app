import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import { ThemeProvider } from './contexts/ThemeContext';
import { AuthProvider, ProtectedRoute } from './components/auth';
import { WebSocketProvider } from './contexts/WebSocketContext';
import BeyondApp from './components/beyond/BeyondApp';
import BeyondPreview from './components/beyond/BeyondPreview';
import i18n from './i18n/config.js';

export default function App() {
  // Design-system preview routes (no auth, no backend) — handy for screenshots.
  // Only available at /__preview/ paths; never linked from the real UI.
  if (typeof window !== 'undefined' && window.location.pathname.startsWith('/__preview')) {
    return (
      <I18nextProvider i18n={i18n}>
        <ThemeProvider>
          <BeyondPreview />
        </ThemeProvider>
      </I18nextProvider>
    );
  }

  // A connector's login that could only redirect to loopback lands here
  // when a copy of the app happens to run on this machine (dev). Hand the
  // address to the window that opened the login and close; nobody should
  // have to log in to a local copy just to read an address bar.
  if (window.location.pathname === '/callback') {
    return <LoopbackCallback />;
  }

  return (
    <I18nextProvider i18n={i18n}>
      <ThemeProvider>
        <AuthProvider>
          <WebSocketProvider>
            {/* Plugins / TasksSettings / TaskMaster providers used to wrap this
                tree. They only fed upstream surfaces that Beyond replaced, and
                kept polling /projects and the plugin list on every load, so
                they are gone along with the UI that consumed them. */}
            <ProtectedRoute>
              <Router basename={window.__ROUTER_BASENAME__ || ''}>
                <Routes>
                  {/* All paths fall through to the same Beyond surface. */}
                  <Route path="*" element={<BeyondApp />} />
                </Routes>
              </Router>
            </ProtectedRoute>
          </WebSocketProvider>
        </AuthProvider>
      </ThemeProvider>
    </I18nextProvider>
  );
}

function LoopbackCallback() {
  const href = window.location.href;
  const sent = Boolean(window.opener);
  if (window.opener) {
    try { window.opener.postMessage({ type: 'beyond-mcp-oauth-loopback', url: href }, '*'); } catch { /* opener gone */ }
    setTimeout(() => { try { window.close(); } catch { /* fine */ } }, 600);
  }
  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', padding: 32, maxWidth: 560, margin: '0 auto', lineHeight: 1.5 }}>
      <h1 style={{ fontSize: 18, margin: '0 0 8px' }}>{sent ? 'Přihlášení předáno, okno se zavře.' : 'Zkopíruj tuhle adresu'}</h1>
      {!sent && (
        <>
          <p style={{ margin: '0 0 12px', color: '#555' }}>Vlož ji do pole pod konektorem v Beyond Brainu a klikni Dokončit.</p>
          <textarea readOnly value={href} style={{ width: '100%', height: 96, fontFamily: 'ui-monospace, monospace', fontSize: 12 }} onFocus={(e) => e.currentTarget.select()} />
        </>
      )}
    </div>
  );
}
