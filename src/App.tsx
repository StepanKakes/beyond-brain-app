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
