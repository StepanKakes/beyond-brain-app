import { UKAZKA, api } from './api';

export type PushStatus = 'on' | 'off' | 'denied' | 'unsupported' | 'needs-install';

const isIos = () => /iP(hone|ad|od)/.test(navigator.userAgent);
const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true;

export async function pushStatus(): Promise<PushStatus> {
  if (UKAZKA) return 'off';
  if (isIos() && !isStandalone()) return 'needs-install';
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return 'unsupported';
  }
  if (Notification.permission === 'denied') return 'denied';
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  return subscription && Notification.permission === 'granted' ? 'on' : 'off';
}

function keyBytes(base64: string): Uint8Array<ArrayBuffer> {
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/** Musí běžet přímo z klepnutí, jinak iOS žádost o povolení tiše zahodí. */
export async function enablePush(): Promise<void> {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notifikace nejsou povolené');
  const { publicKey } = await api<{ publicKey: string }>('/api/settings/push/vapid-public-key');
  const registration = await navigator.serviceWorker.ready;
  const subscription =
    (await registration.pushManager.getSubscription()) ||
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: keyBytes(publicKey),
    }));
  const json = subscription.toJSON();
  await api('/api/settings/push/subscribe', {
    method: 'POST',
    body: { endpoint: json.endpoint, keys: json.keys },
  });
}

export async function disablePush(): Promise<void> {
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return;
  await api('/api/settings/push/unsubscribe', { method: 'POST', body: { endpoint: subscription.endpoint } });
  await subscription.unsubscribe();
}

export async function sendTestPush(): Promise<void> {
  await api('/api/settings/push/test', { method: 'POST', body: {} });
}

// Klepnutí na notifikaci: service worker pošle zprávu běžící appce a zároveň
// nechá cíl v cache, aby si ho appka vyzvedla i po studeném startu.
const PENDING = '/m-pending';

export async function takePendingLink(): Promise<string | null> {
  if (!('caches' in window)) return null;
  try {
    const names = await caches.keys();
    for (const name of names) {
      const cache = await caches.open(name);
      const hit = await cache.match(PENDING);
      if (hit) {
        await cache.delete(PENDING);
        const { url, at } = (await hit.json()) as { url: string; at: number };
        return Date.now() - at < 120_000 ? url : null;
      }
    }
  } catch {
    /* bez cache se jen neotevře konkrétní cíl */
  }
  return null;
}
