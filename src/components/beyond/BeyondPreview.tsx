import BeyondWelcome from './BeyondWelcome';
import BeyondChatPreview from './BeyondChatPreview';
import BeyondSidebarPreview from './BeyondSidebarPreview';
import BeyondShell from './BeyondShell';

/**
 * Design-system preview surface for screenshots / iteration.
 * Routes:
 *   /__preview/welcome     → welcome screen (no client selected)
 *   /__preview/chat        → chat view with seeded messages
 *   /__preview/sidebar     → sidebar standalone (open by default)
 *   /__preview/shell       → full shell: toggle + welcome behind
 *   /__preview/all         → shell with sidebar already open + welcome behind
 * No auth, no backend. Never reachable from the real navigation.
 */
export default function BeyondPreview() {
  const path = window.location.pathname.replace(/^\/__preview\/?/, '') || 'welcome';

  if (path === 'chat') {
    return (
      <div className="relative z-10 flex h-screen w-screen flex-col bg-white">
        <BeyondChatPreview />
      </div>
    );
  }

  if (path === 'sidebar') {
    // Standalone sidebar — no shell, no toggle. Just the surface for design review.
    return (
      <div className="relative z-10 flex h-screen w-screen bg-white">
        <div className="h-full w-[280px]">
          <BeyondSidebarPreview />
        </div>
        <div className="flex-1" />
      </div>
    );
  }

  if (path === 'shell') {
    return (
      <BeyondShell>
        <BeyondWelcome />
      </BeyondShell>
    );
  }

  if (path === 'all') {
    return (
      <BeyondShell defaultOpen>
        <BeyondWelcome />
      </BeyondShell>
    );
  }

  // default: welcome (v2 handles its own gradient + layout)
  return (
    <div className="relative z-10 h-screen w-screen overflow-hidden">
      <BeyondWelcome />
    </div>
  );
}
