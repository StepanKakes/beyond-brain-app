/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["class"],
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      fontFamily: {
        // Beyond v2 — Helvetica primary, Instrument Serif only for special moments.
        sans: [
          '"Helvetica Neue"',
          'Helvetica',
          '-apple-system',
          'BlinkMacSystemFont',
          '"Segoe UI"',
          'Arial',
          'sans-serif',
        ],
        serif: ['"Instrument Serif"', 'ui-serif', 'Georgia', 'serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', 'monospace'],
      },
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        // Beyond v2 — hyperminimal neutrals + powder-blue / cream hero gradient stops.
        beyond: {
          // Surface neutrals
          white: '#ffffff',
          paper: '#fafafa',
          // Text
          ink: '#0a0a0a',
          dim: '#737373',
          faint: '#a3a3a3',
          // Borders / dividers
          line: '#f0f0f0',
          // Hero gradient stops
          powder: '#cdd9e8',
          mist: '#e4dfd6',
          cream: '#f0e6dc',
          // --- v1 compat (legacy components still reference these names) ---
          // Will be removed once all legacy components are rewritten.
          charcoal: '#0a0a0a',
          dusk:     '#737373',
          plum:     '#737373',
          coral:    '#0a0a0a',
          parchment:'#fafafa',
          peach:    '#f0e6dc',
          cream2:   '#f0e6dc',
          sky:      '#cdd9e8',
          haze:     '#e4dfd6',
          midnight: '#0a0a0a',
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
        '2xl': '1.25rem',
        '3xl': '1.75rem',
      },
      spacing: {
        'safe-area-inset-bottom': 'env(safe-area-inset-bottom)',
        'mobile-nav': 'var(--mobile-nav-total)',
      },
      boxShadow: {
        // v1 compat — flattened to no-op so glass shadows disappear cleanly.
        'glass': 'none',
        'glass-lg': 'none',
        'glass-sm': 'none',
        'soft': 'none',
      },
      backdropBlur: {
        // v1 compat — disable blur via util presence but value 0.
        xs: '0px',
        '2xl': '0px',
        '3xl': '0px',
      },
      keyframes: {
        shimmer: {
          '0%': { backgroundPosition: '200% 0' },
          '100%': { backgroundPosition: '-200% 0' },
        },
        'dialog-overlay-show': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'dialog-content-show': {
          from: { opacity: '0', transform: 'translate(-50%, -48%) scale(0.96)' },
          to: { opacity: '1', transform: 'translate(-50%, -50%) scale(1)' },
        },
        'fade-in-up': {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        // Subtle gradient drift for the welcome hero — 30s loop, barely visible.
        'beyond-hero-drift': {
          '0%': { backgroundPosition: '0% 30%' },
          '50%': { backgroundPosition: '100% 70%' },
          '100%': { backgroundPosition: '0% 30%' },
        },
        'beyond-pulse-dot': {
          '0%, 100%': { opacity: '0.35' },
          '50%': { opacity: '1' },
        },
      },
      animation: {
        shimmer: 'shimmer 2s linear infinite',
        'dialog-overlay-show': 'dialog-overlay-show 150ms ease-out',
        'dialog-content-show': 'dialog-content-show 150ms ease-out',
        'fade-in-up': 'fade-in-up 300ms cubic-bezier(0.21, 1.02, 0.73, 1) both',
        'beyond-hero-drift': 'beyond-hero-drift 30s ease-in-out infinite',
        'beyond-pulse-dot': 'beyond-pulse-dot 1.5s ease-in-out infinite',
      },
    },
  },
  plugins: [require('@tailwindcss/typography')],
}
