import { useState, useEffect, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import BeyondSidebarPreview from './BeyondSidebarPreview';

/**
 * Beyond Brain — v2 application shell.
 *
 * Default state: sidebar HIDDEN. Tiny "≡" toggle in the top-left corner.
 * Open → sidebar slides in from the left (280px, spring physics), white
 * surface with a single right border. Picking a client auto-collapses it.
 *
 * Designed to host either the welcome screen or chat view as children.
 */

type Props = {
  /** Currently-selected client slug, if any. */
  selectedSlug?: string | null;
  /** Called when the user picks a client. */
  onSelectClient?: (slug: string) => void;
  /** Main view content. */
  children?: ReactNode;
  /** Force-open the sidebar on mount (used by preview /__preview/sidebar). */
  defaultOpen?: boolean;
};

export default function BeyondShell({
  selectedSlug,
  onSelectClient,
  children,
  defaultOpen = false,
}: Props) {
  const [open, setOpen] = useState(defaultOpen);

  // Esc closes the sidebar.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open]);

  const handleSelect = (slug: string) => {
    onSelectClient?.(slug);
    // Auto-collapse after picking a client per VISION.md.
    setOpen(false);
  };

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-white">
      {/* Toggle — tiny, top-left, always visible */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? 'Skrýt panel' : 'Zobrazit panel'}
        aria-expanded={open}
        className="fixed left-5 top-5 z-30 flex h-9 w-9 items-center justify-center rounded-full text-beyond-dim transition-colors hover:bg-black/5 hover:text-beyond-ink"
      >
        <svg
          viewBox="0 0 24 24"
          width="20"
          height="20"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.8}
          strokeLinecap="round"
          aria-hidden="true"
        >
          <path d="M4 7h16M4 12h16M4 17h16" />
        </svg>
      </button>

      {/* Main view */}
      <main className="absolute inset-0 z-10 h-full w-full">{children}</main>

      {/* Sidebar overlay (click outside closes) */}
      <AnimatePresence>
        {open && (
          <motion.div
            key="scrim"
            className="fixed inset-0 z-20 bg-black/0"
            initial={{ backgroundColor: 'rgba(0,0,0,0)' }}
            animate={{ backgroundColor: 'rgba(0,0,0,0.04)' }}
            exit={{ backgroundColor: 'rgba(0,0,0,0)' }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {open && (
          <motion.aside
            key="sidebar"
            className="fixed left-0 top-0 z-30 h-full w-[280px] max-w-[88vw] bg-white shadow-[1px_0_0_0_#f0f0f0]"
            initial={{ x: -296 }}
            animate={{ x: 0 }}
            exit={{ x: -296 }}
            transition={{ type: 'spring', stiffness: 280, damping: 30 }}
          >
            {/* Push sidebar content below the toggle visually */}
            <div className="h-full pt-2">
              <BeyondSidebarPreview
                selectedSlug={selectedSlug}
                onSelectClient={handleSelect}
              />
            </div>
          </motion.aside>
        )}
      </AnimatePresence>
    </div>
  );
}
