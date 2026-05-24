import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import { ThemeProvider } from './contexts/ThemeContext';
import { AuthProvider, ProtectedRoute } from './components/auth';
import { TaskMasterProvider } from './contexts/TaskMasterContext';
import { TasksSettingsProvider } from './contexts/TasksSettingsContext';
import { WebSocketProvider } from './contexts/WebSocketContext';
import { PluginsProvider } from './contexts/PluginsContext';
import AppContent from './components/app/AppContent';
import BeyondBackground from './components/beyond/BeyondBackground';
import BeyondPreview from './components/beyond/BeyondPreview';
import i18n from './i18n/config.js';

export default function App() {
  // Design-system preview routes (no auth, no backend) — handy for screenshots.
  // Only available at /__preview/ paths; never linked from the real UI.
  if (typeof window !== 'undefined' && window.location.pathname.startsWith('/__preview')) {
    return (
      <I18nextProvider i18n={i18n}>
        <ThemeProvider>
          <BeyondBackground />
          <BeyondPreview />
        </ThemeProvider>
      </I18nextProvider>
    );
  }

  return (
    <I18nextProvider i18n={i18n}>
      <ThemeProvider>
        {/* Beyond Brain — time-of-day pastel gradient. Mounted outside ProtectedRoute
            so it paints behind login & onboarding too. */}
        <BeyondBackground />
        <AuthProvider>
          <WebSocketProvider>
            <PluginsProvider>
              <TasksSettingsProvider>
                <TaskMasterProvider>
                <ProtectedRoute>
                  <Router basename={window.__ROUTER_BASENAME__ || ''}>
                    <Routes>
                      <Route path="/" element={<AppContent />} />
                      <Route path="/session/:sessionId" element={<AppContent />} />
                    </Routes>
                  </Router>
                </ProtectedRoute>
                </TaskMasterProvider>
              </TasksSettingsProvider>
            </PluginsProvider>
          </WebSocketProvider>
        </AuthProvider>
      </ThemeProvider>
    </I18nextProvider>
  );
}
