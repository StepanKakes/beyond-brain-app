/**
 * A short note at the bottom right of the screen, from anywhere: the Toaster
 * mounted in BeyondApp shows it as a React Bits SwipeToast. A newer note
 * replaces the one on screen.
 */
export type ToastNote = { title: string; description?: string };

export function toast(title: string, description?: string) {
  window.dispatchEvent(new CustomEvent<ToastNote>('beyond:toast', { detail: { title, description } }));
}
