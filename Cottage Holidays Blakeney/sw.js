// ============================================================
//  sw.js — service worker: offline cache (PWA) + Web Push.
//
//  OFFLINE CACHE
//  - Precaches the app shell on install.
//  - Navigations (HTML): network-first → cached shell offline (always fresh online).
//  - Other same-origin GETs (assets, public GET endpoints): stale-while-revalidate,
//    so the last-seen content shows offline and refreshes silently when online.
//  - POSTs and cross-origin requests are never cached. version.php is always live.
//
//  WEB PUSH (unchanged): payload-less pushes; this worker asks the server what to
//  show (push.php?action=sw_notify) and relays release reloads to open pages.
//  Keep this file in the SAME folder as index.html.
// ============================================================
const CACHE = 'chb-cache-v2';
const CORE = ['./', 'index.html', 'logo.svg', 'favicon.png', 'apple-touch-icon.png', 'manifest.json'];

self.addEventListener('install', (event) => {
    self.skipWaiting();
    event.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE).catch(() => {})));
});

self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        const keys = await caches.keys();
        await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
        await self.clients.claim();
    })());
});

self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET') return;                 // never cache writes (POST/PUT/…)
    let url;
    try { url = new URL(req.url); } catch (e) { return; }
    if (url.origin !== self.location.origin) return;   // let cross-origin (Square, fonts, tiles) pass through
    if (url.pathname.endsWith('/version.php')) return; // the update probe must always be live

    const accept = req.headers.get('accept') || '';
    const isNav = req.mode === 'navigate' || accept.includes('text/html');

    if (isNav) {
        // Network-first: fresh HTML when online, cached shell when offline.
        event.respondWith((async () => {
            try {
                const res = await fetch(req);
                if (res && res.ok) { const c = await caches.open(CACHE); c.put('index.html', res.clone()).catch(() => {}); }
                return res;
            } catch (e) {
                const c = await caches.open(CACHE);
                return (await c.match('index.html')) || (await c.match('./')) || Response.error();
            }
        })());
        return;
    }

    // Other same-origin GETs: stale-while-revalidate.
    event.respondWith((async () => {
        const c = await caches.open(CACHE);
        const cached = await c.match(req);
        const network = fetch(req).then(res => { if (res && res.ok) c.put(req, res.clone()).catch(() => {}); return res; }).catch(() => null);
        return cached || (await network) || Response.error();
    })());
});

// ---- Web Push (payload-less; ask the server what THIS device should show) ----
self.addEventListener('push', (event) => {
    event.waitUntil((async () => {
        let n = { title: 'Your cottage is ready', body: 'Tap to open your live arrival map and key code.', tag: 'chb-checkin', url: './?arrival=1' };
        let reload = false;
        try {
            const r = await fetch('push.php?action=sw_notify', { credentials: 'include', cache: 'no-store' });
            if (r.ok) {
                const d = await r.json();
                if (d && d.title) n = { title: d.title, body: d.body || '', tag: d.tag || 'chb', url: d.url || './' };
                reload = !!(d && d.reload);
            }
        } catch (e) {}
        // On a new release, ask any open pages to refresh to the new build.
        if (reload) {
            try {
                const cs = await clients.matchAll({ type: 'window', includeUncontrolled: true });
                cs.forEach(c => c.postMessage({ type: 'chb-reload' }));
            } catch (e) {}
        }
        await self.registration.showNotification(n.title, {
            body: n.body, icon: 'apple-touch-icon.png', badge: 'favicon.png',
            tag: n.tag, renotify: true, data: { url: n.url }
        });
    })());
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const url = (event.notification.data && event.notification.data.url) || './';
    event.waitUntil((async () => {
        const wins = await clients.matchAll({ type: 'window', includeUncontrolled: true });
        for (const c of wins) {
            if ('focus' in c) { try { await c.focus(); if (c.navigate) await c.navigate(url); } catch (e) {} return; }
        }
        if (clients.openWindow) return clients.openWindow(url);
    })());
});
