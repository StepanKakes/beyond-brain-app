import { useState, useEffect, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { PanelLeft } from 'lucide-react';
import BeyondSidebarPreview from './BeyondSidebarPreview';

/**
 * Beyond Brain — v3 application shell (Liquid Glass).
 *
 * Desktop (≥900px): a persistent 300px glass sidebar that pushes the main
 * column; the collapse button in the sidebar head slides it to 0 width.
 * Mobile (<900px): the sidebar is a fixed overlay with a scrim; picking a
 * client or tapping the scrim closes it.
 *
 * Hosts either the welcome screen or the chat view as children.
 */

const DESKTOP_QUERY = '(min-width: 900px)';

function useIsDesktop() {
  const [isDesktop, setIsDesktop] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(DESKTOP_QUERY).matches : true,
  );
  useEffect(() => {
    if (!window.matchMedia) return;
    const mq = window.matchMedia(DESKTOP_QUERY);
    const onChange = () => setIsDesktop(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return isDesktop;
}

type Props = {
  /** Which surface is open, so the sidebar can mark the current item. */
  section?: string;
  onGoHome?: () => void;
  onOpenBoard?: () => void;
  onOpenCalls?: () => void;
  onOpenAgent?: () => void;
  onOpenFiles?: () => void;
  onOpenObsah?: () => void;
  onOpenStudio?: () => void;
  onOpenUniversalChat?: () => void;
  /** Back to the chat that is open, as opposed to starting a new one. */
  onReturnToChat?: () => void;
  onSwitchUniversalSession?: (uuid: string) => void;
  /** The session the chat has open right now, or null when another screen is in front. */
  openSessionUuid?: string | null;
  children?: ReactNode;
  /** Force-open the sidebar on mount (used by preview /__preview/sidebar). */
  defaultOpen?: boolean;
};

export default function BeyondShell({
  section,
  onGoHome,
  onOpenBoard,
  onOpenCalls,
  onOpenAgent,
  onOpenFiles,
  onOpenObsah,
  onOpenStudio,
  onOpenUniversalChat,
  onReturnToChat,
  onSwitchUniversalSession,
  openSessionUuid,
  children,
  defaultOpen,
}: Props) {
  const isDesktop = useIsDesktop();
  // Open by default on desktop, closed on mobile.
  const [open, setOpen] = useState(defaultOpen ?? (typeof window !== 'undefined' ? window.matchMedia(DESKTOP_QUERY).matches : true));

  // Follow the viewport when it crosses the breakpoint (unless forced open).
  useEffect(() => {
    if (defaultOpen) return;
    setOpen(isDesktop);
  }, [isDesktop, defaultOpen]);

  // Esc closes the sidebar on mobile (where it's an overlay).
  useEffect(() => {
    if (!open || isDesktop) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, isDesktop]);

  const closeOnMobile = () => {
    if (!isDesktop) setOpen(false);
  };

  const handleGoHome = () => {
    onGoHome?.();
    closeOnMobile();
  };
  const handleOpenUniversal = () => {
    onOpenUniversalChat?.();
    closeOnMobile();
  };
  const handleReturnToChat = () => {
    onReturnToChat?.();
    closeOnMobile();
  };
  const handleSwitchUniversal = (uuid: string) => {
    onSwitchUniversalSession?.(uuid);
    closeOnMobile();
  };

  return (
    <div className="bb-app bb-scope">
      {/* Sidebar (in-flow push on desktop, fixed overlay on mobile via CSS) */}
      <aside className="bb-side" data-open={open ? 'true' : 'false'}>
        <div className="bb-side__inner">
          <BeyondSidebarPreview
            section={section}
            onGoHome={onGoHome ? handleGoHome : undefined}
            onOpenBoard={onOpenBoard ? () => { onOpenBoard(); closeOnMobile(); } : undefined}
            onOpenCalls={onOpenCalls ? () => { onOpenCalls(); closeOnMobile(); } : undefined}
            onOpenAgent={onOpenAgent ? () => { onOpenAgent(); closeOnMobile(); } : undefined}
            onOpenFiles={onOpenFiles ? () => { onOpenFiles(); closeOnMobile(); } : undefined}
            onOpenObsah={onOpenObsah ? () => { onOpenObsah(); closeOnMobile(); } : undefined}
            onOpenStudio={onOpenStudio ? () => { onOpenStudio(); closeOnMobile(); } : undefined}
            onOpenUniversalChat={onOpenUniversalChat ? handleOpenUniversal : undefined}
            onReturnToChat={onReturnToChat ? handleReturnToChat : undefined}
            onSwitchUniversalSession={onSwitchUniversalSession ? handleSwitchUniversal : undefined}
            openSessionUuid={openSessionUuid ?? null}
            onCollapse={() => setOpen(false)}
          />
        </div>
      </aside>

      {/* Mobile scrim (hidden ≥900px via CSS) */}
      <AnimatePresence>
        {open && (
          <motion.div
            key="side-scrim"
            className="bb-side-scrim"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
        )}
      </AnimatePresence>

      {/* Main column */}
      <div className="bb-main">
        {!open && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Zobrazit panel"
            className="bb-ib bb-burger bb-glass"
            style={{ borderRadius: 10 }}
          >
            <PanelLeft size={18} strokeWidth={1.8} />
          </button>
        )}
        {children}
      </div>
    </div>
  );
}
