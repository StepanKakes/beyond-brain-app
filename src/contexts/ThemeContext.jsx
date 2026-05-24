import React, { createContext, useContext, useState, useEffect } from 'react';

const ThemeContext = createContext();

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};

/**
 * Beyond Brain auto-theme heuristic: light during 5-22, dark 22-5.
 * Falls back to system preference if no time data, then user override.
 */
const isNightHour = (hour) => hour >= 22 || hour < 5;

const computeAutoTheme = () => {
  return isNightHour(new Date().getHours());
};

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
    // No explicit override → use Beyond auto-by-hour
    return computeAutoTheme();
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
        themeColorMeta.setAttribute('content', '#0F1626');
      }
    } else {
      document.documentElement.classList.remove('dark');

      const statusBarMeta = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]');
      if (statusBarMeta) {
        statusBarMeta.setAttribute('content', 'default');
      }
      const themeColorMeta = document.querySelector('meta[name="theme-color"]');
      if (themeColorMeta) {
        themeColorMeta.setAttribute('content', '#FAF6F1');
      }
    }
  }, [isDarkMode]);

  // Re-evaluate auto theme every 10 min IF user has no manual override.
  useEffect(() => {
    const id = window.setInterval(() => {
      const saved = localStorage.getItem('theme');
      if (saved === 'dark' || saved === 'light') return;
      setIsDarkMode(computeAutoTheme());
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
      // Prefer time-of-day over OS for Beyond vibe; fall back to OS if hour info missing
      setIsDarkMode(computeAutoTheme());
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
    setIsDarkMode(computeAutoTheme());
  };

  const value = {
    isDarkMode,
    toggleDarkMode,
    resetThemePreference,
  };

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};
