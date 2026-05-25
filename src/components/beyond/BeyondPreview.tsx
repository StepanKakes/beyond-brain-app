import BeyondWelcome from './BeyondWelcome';
import BeyondChatPreview from './BeyondChatPreview';
import BeyondSidebarPreview from './BeyondSidebarPreview';

/**
 * Design-system preview surface for screenshots / iteration.
 * Routes:
 *   /__preview/welcome     → welcome screen (no client selected)
 *   /__preview/chat        → chat view with seeded messages
 *   /__preview/sidebar     → sidebar standalone
 *   /__preview/all         → welcome + sidebar (split layout)
 * No auth, no backend. Never reachable from the real navigation.
 */
export default function BeyondPreview() {
  const path = window.location.pathname.replace(/^\/__preview\/?/, '') || 'welcome';

  if (path === 'chat') {
    return (
      <div className="relative z-10 flex h-screen w-screen flex-col">
        <BeyondChatPreview />
      </div>
    );
  }

  if (path === 'sidebar') {
    return (
      <div className="relative z-10 flex h-screen w-screen">
        <div className="h-full w-72 border-r border-white/30 dark:border-white/5">
          <BeyondSidebarPreview />
        </div>
        <div className="flex-1" />
      </div>
    );
  }

  if (path === 'all') {
    return (
      <div className="relative z-10 flex h-screen w-screen">
        <div className="h-full w-72 flex-shrink-0 border-r border-white/30 dark:border-white/5">
          <BeyondSidebarPreview />
        </div>
        <div className="flex-1">
          <BeyondWelcome />
        </div>
      </div>
    );
  }

  // default: welcome (welcome v2 handles its own gradient + layout)
  return (
    <div className="relative z-10 h-screen w-screen overflow-hidden">
      <BeyondWelcome />
    </div>
  );
}
