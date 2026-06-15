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
    const title = 'Your cottage is ready';
    const body = 'Tap to open your live arrival map and key code.';
    event.waitUntil(self.registration.showNotification(title, {
        body,
        icon: 'apple-touch-icon.png',
        badge: 'favicon.png',
        tag: 'chb-checkin',
        renotify: true,
        data: { url: './?arrival=1' }
    }));
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
