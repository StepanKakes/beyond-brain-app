/**
 * A short note at the bottom right of the screen, from anywhere: the Toaster
 * mounted in BeyondApp shows it as a React Bits SwipeToast. A newer note
 * replaces the one on screen. An action (Vrátit) runs when it is clicked.
 */
export type ToastAction = { label: string; run: () => void };
export type ToastNote = { title: string; description?: string; action?: ToastAction };

export function toast(title: string, description?: string, action?: ToastAction) {
  window.dispatchEvent(new CustomEvent<ToastNote>('beyond:toast', { detail: { title, description, action } }));
}
