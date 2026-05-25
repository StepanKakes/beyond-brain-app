import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import BeyondShell from './BeyondShell';
import BeyondWelcome from './BeyondWelcome';
import BeyondChat from './BeyondChat';
import BeyondFilePreview from './BeyondFilePreview';
import { useBeyondClients, type BeyondClient } from './useBeyondClients';

/**
 * Beyond Brain — top-level app surface (v2).
 *
 * Replaces the legacy claudecodeui AppContent. State-machine is intentionally
 * tiny: either we show the Welcome screen, or we show a Chat focused on one
 * client. The shell hosts a hidden-by-default sidebar; picking a client jumps
 * to chat with that client and auto-collapses the sidebar.
 *
 * No tabs (Files / Source Control / Plugins / Settings) — those legacy
 * surfaces are skipped per VISION.md.
 */

type ActiveSlug = string | null;

export default function BeyondApp() {
  const { clients } = useBeyondClients();
  const [activeSlug, setActiveSlug] = useState<ActiveSlug>(null);
  const [initialPrompt, setInitialPrompt] = useState<string | undefined>(undefined);
  const [previewPath, setPreviewPath] = useState<string | null>(null);

  // Sidebar file tree dispatches `beyond:open-file` with the repo-relative
  // path; we surface a slide-in preview sheet over the current view.
  useEffect(() => {
    const onOpen = (e: Event) => {
      const detail = (e as CustomEvent<{ path?: string }>).detail;
      if (detail && typeof detail.path === 'string') {
        setPreviewPath(detail.path);
      }
    };
    window.addEventListener('beyond:open-file', onOpen);
    return () => window.removeEventListener('beyond:open-file', onOpen);
  }, []);

  const handleSelectClient = useCallback(
    (slug: string) => {
      setActiveSlug(slug);
      setInitialPrompt(undefined);
    },
    [],
  );

  const handleWelcomePrompt = useCallback(
    (prompt: string) => {
      // Welcome chips can implicitly target a client by mentioning their first name.
      // Tiny heuristic: if any client's first name appears, focus that client.
      const lowered = prompt.toLowerCase();
      const match = (clients || []).find((c: BeyondClient) =>
        lowered.includes(c.name.split(' ')[0].toLowerCase()),
      );
      if (match) {
        setActiveSlug(match.slug);
      }
      setInitialPrompt(prompt);
    },
    [clients],
  );

  const activeClient = useMemo(() => {
    if (!activeSlug) return null;
    const fromApi = (clients || []).find((c: BeyondClient) => c.slug === activeSlug);
    if (fromApi) {
      return { slug: fromApi.slug, name: fromApi.name, week: fromApi.week };
    }
    // Fallback for when API hasn't loaded yet but a slug was selected via sidebar.
    return { slug: activeSlug, name: prettifySlug(activeSlug), week: null };
  }, [activeSlug, clients]);

  // Page transition: subtle blur + cross-fade between welcome ↔ chat.
  const viewKey = activeClient ? `chat:${activeClient.slug}` : 'welcome';

  return (
    <BeyondShell selectedSlug={activeSlug} onSelectClient={handleSelectClient}>
      <AnimatePresence mode="wait">
        <motion.div
          key={viewKey}
          initial={{ opacity: 0, filter: 'blur(6px)' }}
          animate={{ opacity: 1, filter: 'blur(0px)' }}
          exit={{ opacity: 0, filter: 'blur(6px)' }}
          transition={{ duration: 0.22, ease: 'easeOut' }}
          className="h-full w-full"
        >
          {activeClient ? (
            <BeyondChat client={activeClient} initialPrompt={initialPrompt} />
          ) : (
            <BeyondWelcome
              onSubmit={(message) => handleWelcomePrompt(message)}
            />
          )}
        </motion.div>
      </AnimatePresence>

      <AnimatePresence>
        {previewPath && (
          <BeyondFilePreview
            path={previewPath}
            onClose={() => setPreviewPath(null)}
          />
        )}
      </AnimatePresence>
    </BeyondShell>
  );
}

function prettifySlug(slug: string): string {
  return slug
    .split('-')
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(' ');
}
