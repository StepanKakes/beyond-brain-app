// Service Worker for Beyond PWA
// Cache only manifest (needed for PWA install). HTML and JS are never pre-cached
// so a rebuild + refresh always picks up the latest assets.
const CACHE_NAME = 'beyond-v4-mobile';
const SHELL_CACHE = 'beyond-m-shell';
const PENDING_LINK = '/m-pending';
const urlsToCache = [
  '/manifest.json'
];

// Install event
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(urlsToCache))
  );
  self.skipWaiting();
});

// Fetch event — network-first for everything except hashed assets
self.addEventListener('fetch', event => {
  const url = event.request.url;

  // Never intercept API requests or WebSocket upgrades
  if (url.includes('/api/') || url.includes('/ws')) {
    return;
  }

  // Písma se při startu blokují, proto se berou z cache a na pozadí obnovují.
  if (url.startsWith('https://fonts.googleapis.com/') || url.startsWith('https://fonts.gstatic.com/')) {
    event.respondWith(
      caches.open(SHELL_CACHE).then(async cache => {
        const cached = await cache.match(event.request);
        const network = fetch(event.request).then(response => {
          if (response.ok || response.type === 'opaque') cache.put(event.request, response.clone());
          return response;
        });
        if (cached) {
          event.waitUntil(network.catch(() => undefined));
          return cached;
        }
        return network;
      })
    );
    return;
  }

  // Mobilní appka startuje okamžitě z uložené kostry, nová verze se stáhne na
  // pozadí a projeví se při dalším spuštění.
  if (event.request.mode === 'navigate') {
    const { pathname } = new URL(url);
    if (pathname === '/m' || pathname.startsWith('/m/')) {
      event.respondWith(
        caches.open(SHELL_CACHE).then(async cache => {
          const cached = await cache.match('/m-shell');
          const network = fetch(event.request).then(response => {
            if (response.ok) cache.put('/m-shell', response.clone());
            return response;
          });
          if (cached) {
            event.waitUntil(network.catch(() => undefined));
            return cached;
          }
          return network.catch(() =>
            new Response('<h1>Jsi offline</h1><p>Appka se poprvé musí načíst se signálem.</p>', {
              headers: { 'Content-Type': 'text/html; charset=utf-8' }
            })
          );
        })
      );
      return;
    }
  }

  // Navigation requests (HTML) — always go to network, no caching
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() => caches.match('/manifest.json').then(() =>
        new Response('<h1>Hm, něco se rozbilo.</h1><p>Zkontroluj připojení.</p>', {
          headers: { 'Content-Type': 'text/html' }
        })
      ))
    );
    return;
  }

  // Hashed assets (JS/CSS in /assets/) — cache-first since filenames change per build
  if (url.includes('/assets/')) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(response => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          return response;
        });
      })
    );
    return;
  }

  // Everything else — network-first
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});

// Activate event — purge old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames =>
      Promise.all(
        cacheNames
          .filter(name => name !== CACHE_NAME && name !== SHELL_CACHE)
          .map(name => caches.delete(name))
      )
    )
  );
  self.clients.claim();
});

// Push notification event
self.addEventListener('push', event => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: 'Beyond', body: event.data.text() };
  }

  const options = {
    body: payload.body || '',
    icon: '/logo-256.png',
    badge: '/logo-128.png',
    data: payload.data || {},
    tag: payload.data?.tag || `${payload.data?.sessionId || 'global'}:${payload.data?.code || 'default'}`,
    renotify: true
  };

  event.waitUntil(
    self.registration.showNotification(payload.title || 'Beyond', options)
  );
});

// Notification click event
self.addEventListener('notificationclick', event => {
  event.notification.close();

  const data = event.notification.data || {};
  const sessionId = data.sessionId;
  const provider = data.provider || null;
  // Cíl posílá server. Starší notifikace ho nemají, ty jdou do chatu nebo domů.
  const urlPath = data.url || (sessionId ? `/m/chat/${sessionId}` : '/m');

  event.waitUntil((async () => {
    // Cíl zůstane i v cache: appka si ho vyzvedne po studeném startu, kdyby ji
    // iOS otevřel na výchozí adrese.
    const cache = await caches.open(CACHE_NAME);
    await cache.put(PENDING_LINK, new Response(JSON.stringify({ url: urlPath, at: Date.now() })));

    const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of clientList) {
      if (!client.url.startsWith(self.location.origin)) continue;
      const { pathname } = new URL(client.url);
      const isMobile = pathname === '/m' || pathname.startsWith('/m/');
      // iOS umí focus odmítnout, cíl se kvůli tomu nesmí ztratit.
      await client.focus().catch(() => {});
      if (isMobile) {
        client.postMessage({ type: 'notification:navigate', sessionId: sessionId || null, provider, urlPath });
      } else if (client.navigate) {
        await client.navigate(urlPath);
      }
      return;
    }
    await self.clients.openWindow(urlPath);
  })());
});
