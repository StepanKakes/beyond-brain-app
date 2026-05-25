/**
 * Beyond v2 — hyperminimal loading screen.
 * Just one pulsing dot. White surface, no logo, no chrome.
 */
export default function AuthLoadingScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-white">
      <span className="beyond-dot" aria-label="Načítám" />
    </div>
  );
}
