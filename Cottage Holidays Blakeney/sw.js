// ============================================================
//  sw.js — service worker: offline cache (PWA) + Web Push.
//
//  OFFLINE CACHE
//  - Precaches the app shell on install.
//  - Navigations (HTML): network-first → cached shell offline (always fresh online).
//  - Static same-origin assets (css/js/images/manifest): stale-while-revalidate,
//    so the last-seen asset shows offline and refreshes silently when online.
//  - Dynamic JSON APIs (*.php) are network-only: never stale, never cached
//    (prices/availability must be fresh; credentialed responses must not be stored).
//  - POSTs and cross-origin requests are never cached.
//
//  WEB PUSH (unchanged): payload-less pushes; this worker asks the server what to
//  show (push.php?action=sw_notify) and relays release reloads to open pages.
//  Keep this file in the SAME folder as index.html.
// ============================================================
const CACHE = 'chb-cache-v510';
// admin.js is deliberately NOT precached — it's the owner-only bundle, fetched on
// demand by loadAdminBundle() (app.js); the fetch handler below also bypasses it
// entirely (network-only) so a new back office is never a reload behind.
// Icons are precached BOTH bare (in-page <img>/notification icons) and with the
// ?v=3 pins the <link rel=icon> tags actually request — cache.match keys include
// the query string, so a bare entry never satisfies a pinned request.
const CORE = ['./', 'index.html', 'logo.svg', 'logo.svg?v=3', 'favicon.png', 'favicon.png?v=3', 'apple-touch-icon.png', 'apple-touch-icon.png?v=3', 'manifest.json', 'app.css?v=191', 'app.js?v=459', 'guest-app.css?v=33', 'guest-app.js?v=15'];
// uploads/ images live in their own size-capped bucket so galleries stay fast and
// available offline WITHOUT growing the main cache without bound (every image ever
// viewed used to accumulate forever in CACHE).
const IMG_CACHE = 'chb-img-v1';
const IMG_CACHE_MAX = 80;
async function trimCache(name, max) {
    try {
        const c = await caches.open(name);
        const keys = await c.keys();
        for (let i = 0; i < keys.length - max; i++) await c.delete(keys[i]);   // drop oldest first
    } catch (e) {}
}

self.addEventListener('install', (event) => {
    self.skipWaiting();
    // addAll is atomic and the rejection must PROPAGATE: swallowing it installed
    // a worker with an empty precache while activate deleted the previous good
    // cache — a deploy-window blip then left the user with no offline shell at
    // all. A failed install keeps the old worker + old cache in service instead.
    event.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)));
});

self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        const keys = await caches.keys();
        await Promise.all(keys.filter(k => k !== CACHE && k !== IMG_CACHE).map(k => caches.delete(k)));
        // Navigation preload: without this, a cold navigation must BOOT this
        // worker before the HTML request even starts. With it, the browser fires
        // the network request in parallel and hands us the response below —
        // typically 50-200ms faster first paint on mobile.
        try {
            if (self.registration.navigationPreload) await self.registration.navigationPreload.enable();
        } catch (e) {}
        await self.clients.claim();
    })());
});

self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET') return;                 // never cache writes (POST/PUT/…)
    let url;
    try { url = new URL(req.url); } catch (e) { return; }
    if (url.origin !== self.location.origin) return;   // let cross-origin (Square, fonts, tiles) pass through
    // img.php-RESIZED gallery images are images, not APIs: same capped
    // stale-while-revalidate bucket as uploads/ (offline galleries + fast
    // repeat views). Checked BEFORE the generic .php bypass below.
    const isImgPhp = /(^|\/)img\.php$/.test(url.pathname);
    // Dynamic JSON APIs are network-only — never serve stale prices/availability,
    // never write credentialed (admin/guest) responses to the shared cache, and
    // never let per-date/year query strings grow the cache unbounded. (Covers the
    // version.php update probe too, which must always be live.)
    if (url.pathname.endsWith('.php') && !isImgPhp) return;
    // admin.js is owner-only and version-pinned by ADMIN_BUNDLE_V inside app.js.
    // Serving it stale-while-revalidate lets an out-of-date app.js pin an
    // out-of-date back office for extra reloads — always go to the network
    // (the browser's own HTTP cache + the ?v= pin still make repeats cheap).
    if (/(^|\/)admin\.js$/.test(url.pathname)) return;
    // The on-device model files (darkstar.bin ~7.6MB, encoder.onnx ~23MB, its
    // vocab) are ?v=-pinned and served immutable/1y by htaccess — cloning them
    // into Cache Storage is ~30MB of pure duplication per release (and iOS PWA
    // quota is tight; eviction under pressure takes the app shell with it).
    // Same argument as admin.js above: the HTTP cache already makes repeats free.
    if (/\.(bin|onnx)$/.test(url.pathname) || /(^|\/)encoder-vocab\.json$/.test(url.pathname)) return;

    const accept = req.headers.get('accept') || '';
    const isNav = req.mode === 'navigate' || accept.includes('text/html');

    if (isNav) {
        // Network-first: fresh HTML when online, cached shell when offline.
        // Prefer the navigation-preload response (already in flight, see
        // activate) over starting a new fetch.
        // Only SHELL routes may refresh the cached shell: /, /index.html and the
        // routes that serve index.html server-side (/cottages/<slug>,
        // /experiences). Standalone pages (/review/<slug>, /status, blocked.php —
        // some even sent Cache-Control: no-store) used to overwrite the shell,
        // so an installed PWA opened offline rendered the review page as the app.
        const isShellNav = !/\/(review|status)(\/|$)/.test(url.pathname)
            && (/(\/|\/index\.html)$/.test(url.pathname) || /\/cottages\/[^/]+\/?$/.test(url.pathname) || /\/experiences\/?$/.test(url.pathname));
        event.respondWith((async () => {
            try {
                const res = (await event.preloadResponse) || (await fetch(req));
                if (res && res.ok && isShellNav) { const c = await caches.open(CACHE); c.put('index.html', res.clone()).catch(() => {}); }
                return res;
            } catch (e) {
                const c = await caches.open(CACHE);
                return (await c.match('index.html')) || (await c.match('./')) || Response.error();
            }
        })());
        return;
    }

    // uploads/ images: stale-while-revalidate into the capped image bucket (trimmed
    // to IMG_CACHE_MAX so it can't grow forever).
    if (url.pathname.includes('/uploads/') || isImgPhp) {
        event.respondWith((async () => {
            const c = await caches.open(IMG_CACHE);
            const cached = await c.match(req);
            const network = fetch(req).then(async res => { if (res && res.ok) { await c.put(req, res.clone()).catch(() => {}); trimCache(IMG_CACHE, IMG_CACHE_MAX); } return res; }).catch(() => null);
            // Keep the worker alive until the background revalidation commits —
            // without this the browser may kill the SW as soon as the cached
            // response is returned, so "refreshes silently" never actually held
            // on quick open-close visits.
            if (cached) event.waitUntil(network);
            return cached || (await network) || Response.error();
        })());
        return;
    }

    // Other same-origin GETs (versioned static assets): stale-while-revalidate.
    event.respondWith((async () => {
        const c = await caches.open(CACHE);
        const cached = await c.match(req);
        const network = fetch(req).then(res => { if (res && res.ok) c.put(req, res.clone()).catch(() => {}); return res; }).catch(() => null);
        if (cached) event.waitUntil(network); // see the image branch above
        return cached || (await network) || Response.error();
    })());
});

// ---- Background Sync: replay queued admin writes even when the app is closed ----
// The page stores offline writes in IndexedDB ('chb-db' → 'queue'); on a 'sync'
// event we POST each one and remove it. A network failure re-throws so the
// browser retries the sync later; an HTTP response (even an error) is treated as
// handled so a rejected request can't wedge the queue. Not supported on iOS — the
// page's on-reconnect / on-open flush covers that case.
function swQueueDB() {
    return new Promise((res, rej) => {
        let r; try { r = indexedDB.open('chb-db', 1); } catch (e) { return rej(e); }
        r.onupgradeneeded = () => { const db = r.result; if (!db.objectStoreNames.contains('queue')) db.createObjectStore('queue', { keyPath: 'id', autoIncrement: true }); };
        r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
}
function swQueueAll(db) { return new Promise((res, rej) => { const tx = db.transaction('queue', 'readonly'); const rq = tx.objectStore('queue').getAll(); rq.onsuccess = () => res(rq.result || []); rq.onerror = () => rej(rq.error); }); }
function swQueueDelete(db, id) { return new Promise((res, rej) => { const tx = db.transaction('queue', 'readwrite'); tx.objectStore('queue').delete(id); tx.oncomplete = res; tx.onerror = () => rej(tx.error); }); }

async function swFlushQueue() {
    const db = await swQueueDB();
    const items = await swQueueAll(db);
    if (!items.length) return;
    let sent = 0;
    for (const it of items) {
        let r;
        try {
            r = await fetch(it.endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(it.payload || {}) });
        } catch (e) {
            // True network failure — stop and let the browser retry the sync later.
            throw e;
        }
        // Session lapsed (401/403) → KEEP the write and retry on a later sync once the
        // owner re-signs in; don't silently drop it. Any other response is treated as
        // handled so a genuinely-rejected item can't wedge the queue.
        if (r && (r.status === 401 || r.status === 403)) continue;
        await swQueueDelete(db, it.id);
        sent++;
    }
    if (sent) {
        try {
            const cs = await clients.matchAll({ type: 'window', includeUncontrolled: true });
            cs.forEach(c => c.postMessage({ type: 'chb-synced', sent }));
        } catch (e) {}
    }
}

self.addEventListener('sync', (event) => {
    if (event.tag === 'chb-sync') event.waitUntil(swFlushQueue());
});

// ---- Web Push (payload-less; ask the server what THIS device should show) ----
self.addEventListener('push', (event) => {
    event.waitUntil((async () => {
        let n = { title: 'Cottage Holidays Blakeney', body: 'You have a new notification — tap to open.', tag: 'chb-guest', url: './' };
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
