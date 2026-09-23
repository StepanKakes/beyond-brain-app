import React, { createContext, useContext, useState, useEffect } from 'react';

const ThemeContext = createContext();

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};

/** "Auto" follows the operating system; the app itself is a light app. */
const systemPrefersDark = () =>
  typeof window !== 'undefined' && window.matchMedia
    ? window.matchMedia('(prefers-color-scheme: dark)').matches
    : false;

export const ThemeProvider = ({ children }) => {
  const [isDarkMode, setIsDarkMode] = useState(() => {
    // ?theme=light|dark URL override for design previews and screenshots
    if (typeof window !== 'undefined') {
      const forced = new URLSearchParams(window.location.search).get('theme');
      if (forced === 'light') return false;
      if (forced === 'dark') return true;
    }
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'dark' || savedTheme === 'light') {
      return savedTheme === 'dark';
    }
    // Light is the app's own look; dark is a choice, not a time of day.
    return false;
  });

  // Update document class and localStorage when theme changes
  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');

      // Update iOS status bar / theme color (dark Beyond ink)
      const statusBarMeta = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]');
      if (statusBarMeta) {
        statusBarMeta.setAttribute('content', 'black-translucent');
      }
      const themeColorMeta = document.querySelector('meta[name="theme-color"]');
      if (themeColorMeta) {
        themeColorMeta.setAttribute('content', '#0A0C10');
      }
    } else {
      document.documentElement.classList.remove('dark');

      const statusBarMeta = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]');
      if (statusBarMeta) {
        statusBarMeta.setAttribute('content', 'default');
      }
      const themeColorMeta = document.querySelector('meta[name="theme-color"]');
      if (themeColorMeta) {
        themeColorMeta.setAttribute('content', '#EEF1F6');
      }
    }
  }, [isDarkMode]);

  // Re-evaluate auto theme every 10 min IF user has no manual override.
  useEffect(() => {
    const id = window.setInterval(() => {
      const saved = localStorage.getItem('theme');
      if (saved === 'dark' || saved === 'light') return;
      setIsDarkMode(systemPrefersDark());
    }, 10 * 60 * 1000);
    return () => window.clearInterval(id);
  }, []);

  // Listen for system theme changes (still respected when no manual override)
  useEffect(() => {
    if (!window.matchMedia) return;
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (_e) => {
      const savedTheme = localStorage.getItem('theme');
      if (savedTheme === 'dark' || savedTheme === 'light') return;
      setIsDarkMode(systemPrefersDark());
    };
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  const toggleDarkMode = () => {
    setIsDarkMode((prev) => {
      const next = !prev;
      // User manually toggling = explicit override; persist it
      localStorage.setItem('theme', next ? 'dark' : 'light');
      return next;
    });
  };

  // Allow the user to clear the override and go back to auto
  const resetThemePreference = () => {
    localStorage.removeItem('theme');
    setIsDarkMode(systemPrefersDark());
  };

  // Explicit 3-way setter used by the Settings dialog (auto | light | dark).
  const setTheme = (mode) => {
    if (mode === 'auto') {
      localStorage.removeItem('theme');
      setIsDarkMode(systemPrefersDark());
    } else {
      localStorage.setItem('theme', mode);
      setIsDarkMode(mode === 'dark');
    }
  };

  const value = {
    isDarkMode,
    toggleDarkMode,
    resetThemePreference,
    setTheme,
  };

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};
