// ============================================================
//  sw.js — service worker for Web Push + "Add to Home Screen" (PWA).
//  Push messages are sent payload-less (no encrypted body) so the server stays
//  dependency-free; this worker shows a fixed "your cottage is ready" message.
//  Tapping it opens the site, where the in-app GPS flow reveals the live map and
//  key code. Keep this file in the SAME folder as index.html.
// ============================================================
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
    // Pushes are payload-less, so ask the server what THIS device should show
    // (owner alerts vs the guest check-in message). Falls back to the check-in
    // message if the fetch fails (e.g. no session / offline).
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
