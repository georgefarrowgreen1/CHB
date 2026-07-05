/* --- 0. BACKEND API CLIENT --- */
// Flat layout: the PHP files sit in the SAME folder as this page.
// Build an absolute path to that folder from the page location, so it
// works at the domain root or in any subfolder, with or without a
// trailing slash. e.g. /something/index.html -> /something/
const API_BASE = (function () {
    let path = window.location.pathname || '/';
    const last = path.split('/').pop(); // last segment
    if (last === '') {
        // already ends in '/', a directory — keep as is
    } else if (last.indexOf('.') !== -1) {
        path = path.replace(/[^/]*$/, ''); // strip the file name
    } else {
        path = path + '/'; // directory without trailing slash
    }
    if (!path.endsWith('/')) path += '/';
    // Clean per-cottage URLs (/cottages/<slug>) are served from index.html via
    // an .htaccess rewrite, so the PHP files actually live one level up — at the
    // app root. Strip the virtual "cottages/…" segment so the API calls hit them.
    const ci = path.indexOf('/cottages/');
    if (ci !== -1) path = path.slice(0, ci + 1);
    return path; // e.g. "/something/" — PHP files live here
})();
// Connection state + offline action queue. A discrete no-WiFi button appears
// while disconnected; admin writes attempted offline are saved to IndexedDB
// (shared with the service worker) and replayed when the connection returns —
// by the page on reconnect/open, and by the SW via Background Sync even when
// the app is closed (where the browser supports it; iOS falls back to on-open).
function oqDB() {
    return new Promise((res, rej) => {
        let r;
        try {
            r = indexedDB.open('chb-db', 1);
        } catch (e) {
            return rej(e);
        }
        r.onupgradeneeded = () => {
            const db = r.result;
            if (!db.objectStoreNames.contains('queue'))
                db.createObjectStore('queue', { keyPath: 'id', autoIncrement: true });
        };
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
    });
}
async function oqAll() {
    const db = await oqDB();
    return new Promise((res, rej) => {
        const tx = db.transaction('queue', 'readonly');
        const rq = tx.objectStore('queue').getAll();
        rq.onsuccess = () => res(rq.result || []);
        rq.onerror = () => rej(rq.error);
    });
}
async function oqAdd(item) {
    const db = await oqDB();
    await new Promise((res, rej) => {
        const tx = db.transaction('queue', 'readwrite');
        tx.objectStore('queue').add(item);
        tx.oncomplete = res;
        tx.onerror = () => rej(tx.error);
    });
}
async function oqDelete(id) {
    const db = await oqDB();
    await new Promise((res, rej) => {
        const tx = db.transaction('queue', 'readwrite');
        tx.objectStore('queue').delete(id);
        tx.oncomplete = res;
        tx.onerror = () => rej(tx.error);
    });
}
let __oqCount = 0;
async function oqRefreshCount() {
    try {
        __oqCount = (await oqAll()).length;
    } catch (e) {
        __oqCount = 0;
    }
    updateOnlineStatus();
}
function updateOnlineStatus() {
    try {
        const offline = navigator.onLine === false;
        const n = __oqCount;
        document.body.classList.toggle('is-offline', offline);
        document.body.classList.toggle('has-queued', n > 0);
        const b = document.getElementById('offline-count');
        if (b) {
            b.textContent = n;
            b.style.display = n > 0 ? 'flex' : 'none';
        }
        const pill = document.getElementById('offline-pill');
        if (pill)
            pill.title =
                (offline ? 'No internet connection' : 'Reconnecting…') +
                (n ? ` — ${n} change${n === 1 ? '' : 's'} waiting to sync` : '');
    } catch (e) {}
}
// Ask the service worker to replay the queue in the background (when supported).
async function oqRegisterSync() {
    try {
        const reg = await navigator.serviceWorker.ready;
        if (reg && 'sync' in reg) await reg.sync.register('chb-sync');
    } catch (e) {}
}
// Send now if online; otherwise queue it and report it as queued.
async function queueOrPost(endpoint, payload) {
    const enqueue = async () => {
        try {
            await oqAdd({ endpoint, payload, at: Date.now() });
        } catch (e) {}
        await oqRefreshCount();
        oqRegisterSync();
        return { queued: true };
    };
    if (navigator.onLine === false) return enqueue();
    try {
        return await apiPost(endpoint, payload);
    } catch (e) {
        if (navigator.onLine === false) return enqueue();
        throw e;
    }
}
let __oqFlushing = false;
async function oqFlush() {
    if (__oqFlushing || navigator.onLine === false) return;
    // Where Background Sync exists (Chrome/Android), the service worker owns replay
    // (it fires on reconnect and messages us 'chb-synced' to refresh) — running the
    // page-side replay too would double-POST every queued write. So defer to the SW
    // there; iOS/Safari has no SyncManager, so the page stays the sole replayer.
    if ('serviceWorker' in navigator && 'SyncManager' in window && navigator.serviceWorker.controller) {
        try {
            await oqRefreshCount();
        } catch (e) {}
        return;
    }
    let items = [];
    try {
        items = await oqAll();
    } catch (e) {}
    if (!items.length) {
        await oqRefreshCount();
        return;
    }
    __oqFlushing = true;
    let failed = 0;
    try {
        for (const it of items) {
            try {
                await apiPost(it.endpoint, it.payload);
            } catch (e) {
                if (navigator.onLine === false) break; // offline again — stop, keep the rest queued
                // Auth lapsed (session expired) → KEEP the write to retry after re-sign-in;
                // don't drop it. Other 4xx/5xx are treated as handled so the queue can't wedge.
                if (e && (e.status === 401 || e.status === 403)) continue;
                failed++;
            }
            try {
                await oqDelete(it.id);
            } catch (e) {}
        }
    } finally {
        __oqFlushing = false;
        await oqRefreshCount();
    }
    // Refresh any open admin views with the now-synced data.
    try {
        if (typeof loadExpenses === 'function') {
            await loadExpenses();
            if (document.querySelector('#asec-expenses')) renderExpenses();
        }
    } catch (e) {}
    try {
        if (typeof loadAdminMessages === 'function') loadAdminMessages();
    } catch (e) {}
    try {
        if (typeof renderMoneyOverview === 'function') renderMoneyOverview();
    } catch (e) {}
    if (failed > 0) {
        // A queued change was rejected by the server (e.g. session expired) — never
        // claim success; tell the owner so they can redo it rather than lose it silently.
        try {
            toast(failed + (failed > 1 ? ' changes' : ' change') + " couldn't be saved — please try again.");
        } catch (e) {}
    } else if (__oqCount === 0) {
        try {
            toast('Changes saved.');
        } catch (e) {}
    }
}
window.addEventListener('online', () => {
    updateOnlineStatus();
    oqFlush();
});
window.addEventListener('offline', updateOnlineStatus);
updateOnlineStatus();
try {
    oqRefreshCount();
} catch (e) {}
// Fetch with a timeout so a stuck request never hangs the page forever.
async function fetchWithTimeout(url, opts, ms) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms || 15000);
    try {
        return await fetch(url, Object.assign({}, opts, { signal: ctrl.signal }));
    } finally {
        clearTimeout(timer);
    }
}
// CSRF: echo back the token the server set in the (JS-readable) `csrf` cookie.
// Harmless on public endpoints; required by require_admin() on admin writes.
function csrfHeader() {
    try {
        const m = document.cookie.match(/(?:^|;\s*)csrf=([^;]+)/);
        return m ? { 'X-CSRF-Token': decodeURIComponent(m[1]) } : {};
    } catch (e) {
        return {};
    }
}
async function apiPost(endpoint, payload) {
    let res;
    try {
        res = await fetchWithTimeout(API_BASE + endpoint, {
            method: 'POST',
            headers: Object.assign({ 'Content-Type': 'application/json' }, csrfHeader()),
            credentials: 'include',
            body: JSON.stringify(payload || {}),
        });
    } catch (netErr) {
        throw new Error(
            netErr && netErr.name === 'AbortError'
                ? 'The server took too long to respond. Please try again.'
                : 'Network error — could not reach the server.',
        );
    }
    const text = await res.text();
    let data = {};
    try {
        data = text ? JSON.parse(text) : {};
    } catch (e) {
        // Non-JSON response usually means a PHP error page; surface a hint.
        const err = new Error(
            res.ok
                ? 'Unexpected server response.'
                : 'Server error ' + res.status + (text ? ': ' + text.slice(0, 200) : ''),
        );
        err.status = res.status;
        throw err;
    }
    if (!res.ok) {
        if (res.status === 401) maybeHandleStaleAdmin();
        const err = new Error(data.error || 'Request failed (' + res.status + ')');
        err.status = res.status; // let the offline-queue replayer keep 401/403 (re-auth) vs drop other 4xx
        throw err;
    }
    return data;
}
async function apiGet(endpoint) {
    let res;
    try {
        res = await fetchWithTimeout(API_BASE + endpoint, { credentials: 'include' });
    } catch (netErr) {
        throw new Error(
            netErr && netErr.name === 'AbortError'
                ? 'The server took too long to respond. Please try again.'
                : 'Network error — could not reach the server.',
        );
    }
    const text = await res.text();
    let data = {};
    try {
        data = text ? JSON.parse(text) : {};
    } catch (e) {
        throw new Error(
            res.ok
                ? 'Unexpected server response.'
                : 'Server error ' + res.status + (text ? ': ' + text.slice(0, 200) : ''),
        );
    }
    if (!res.ok) {
        if (res.status === 401) maybeHandleStaleAdmin();
        throw new Error(data.error || 'Request failed (' + res.status + ')');
    }
    return data;
}

// If a request comes back 401 while the UI still believes an admin is signed
// in, the server session has almost certainly expired (so the dashboard is
// showing but every action fails "Not authorised"). Confirm with the server
// and, if the admin session really is gone, log out cleanly so the UI matches
// reality. Guest/anonymous 401s are expected and ignored.
let __staleAdminChecking = false;
let __sessionExpiredNotified = false;
async function maybeHandleStaleAdmin() {
    if (!isAuthenticated) return; // not posing as admin → a normal 401
    if (__staleAdminChecking) return; // one check at a time
    __staleAdminChecking = true;
    try {
        const s = await apiPost('auth.php', { action: 'admin_status' });
        if (!s || !s.admin) forceAdminLogout();
    } catch (e) {
        /* network hiccup — don't log out on uncertainty */
    } finally {
        __staleAdminChecking = false;
    }
}
function forceAdminLogout() {
    isAuthenticated = false;
    try {
        setAuthUI();
    } catch (e) {}
    // If they're sitting on an admin-only screen, return them to the public site
    // so they're not stuck on a dead dashboard.
    const adminViews = ['view-backoffice', 'view-settings', 'view-accounts'];
    const active = (document.querySelector('.page-view.active') || {}).id;
    if (adminViews.includes(active)) {
        try {
            nav('view-main');
        } catch (e) {}
    }
    if (!__sessionExpiredNotified) {
        __sessionExpiredNotified = true;
        try {
            toast('Your admin session expired — please sign in again.');
        } catch (e) {}
        setTimeout(() => {
            __sessionExpiredNotified = false;
        }, 8000);
    }
}

// Upload an image file to the server (multipart). Returns the saved URL.
// iPhones save photos as HEIC, which servers and most browsers can't read.
// We convert HEIC/HEIF to JPEG in the browser before upload. The converter
// (heic2any) is only fetched the first time it's actually needed.
let __heicLoader = null;
function loadHeic2any() {
    if (window.heic2any) return Promise.resolve();
    if (__heicLoader) return __heicLoader;
    __heicLoader = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://cdnjs.cloudflare.com/ajax/libs/heic2any/0.0.4/heic2any.min.js';
        s.onload = () => resolve();
        s.onerror = () => {
            __heicLoader = null;
            reject(
                new Error(
                    'Could not load the photo converter. Please check your connection and try again.',
                ),
            );
        };
        document.head.appendChild(s);
    });
    return __heicLoader;
}
function isHeic(file) {
    const t = ((file && file.type) || '').toLowerCase();
    const n = ((file && file.name) || '').toLowerCase();
    return t === 'image/heic' || t === 'image/heif' || n.endsWith('.heic') || n.endsWith('.heif');
}
// Return an uploadable image File. HEIC/HEIF in -> JPEG out; then large
// photos are downscaled + recompressed so the upload is small and fast
// (full-res phone photos are several MB and would time out / hit PHP limits).
async function ensureUploadable(file) {
    if (file && isHeic(file)) {
        await loadHeic2any();
        const out = await window.heic2any({ blob: file, toType: 'image/jpeg', quality: 0.9 });
        const jpeg = Array.isArray(out) ? out[0] : out;
        const name = (file.name || 'photo').replace(/\.(heic|heif)$/i, '') + '.jpg';
        try {
            file = new File([jpeg], name, { type: 'image/jpeg' });
        } catch (e) {
            jpeg.name = name;
            file = jpeg;
        } // older browsers: Blob + name
    }
    try {
        file = await downscaleImage(file, 2000, 0.82);
    } catch (e) {
        /* keep original on any failure */
    }
    return file;
}
// Downscale a raster image to <= maxDim on its longest edge and re-encode as
// JPEG. Returns the original untouched if it's already small, not a raster
// type, or anything fails (so an edge case never blocks the upload).
async function downscaleImage(file, maxDim, quality) {
    const type = ((file && file.type) || '').toLowerCase();
    if (!/^image\/(jpeg|jpg|png|webp)$/.test(type)) return file; // skip svg/gif/etc.
    maxDim = maxDim || 2000;
    let src = null,
        w = 0,
        h = 0,
        objUrl = null,
        bitmap = null;
    try {
        if (window.createImageBitmap) {
            bitmap = await createImageBitmap(file);
            w = bitmap.width;
            h = bitmap.height;
            src = bitmap;
        } else {
            objUrl = URL.createObjectURL(file);
            const img = await new Promise((res, rej) => {
                const i = new Image();
                i.onload = () => res(i);
                i.onerror = rej;
                i.src = objUrl;
            });
            w = img.naturalWidth;
            h = img.naturalHeight;
            src = img;
        }
        if (!w || !h) throw new Error('decode failed');
        // Already small enough: leave it as-is.
        if (Math.max(w, h) <= maxDim && file.size <= 1200000) return file;
        const scale = Math.min(1, maxDim / Math.max(w, h));
        const cw = Math.max(1, Math.round(w * scale)),
            ch = Math.max(1, Math.round(h * scale));
        const canvas = document.createElement('canvas');
        canvas.width = cw;
        canvas.height = ch;
        canvas.getContext('2d').drawImage(src, 0, 0, cw, ch);
        const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', quality || 0.82));
        if (!blob) return file;
        const name = (file.name || 'photo').replace(/\.(png|webp|jpe?g)$/i, '') + '.jpg';
        try {
            return new File([blob], name, { type: 'image/jpeg' });
        } catch (e) {
            blob.name = name;
            return blob;
        }
    } catch (e) {
        return file;
    } finally {
        try {
            if (bitmap && bitmap.close) bitmap.close();
        } catch (e) {}
        try {
            if (objUrl) URL.revokeObjectURL(objUrl);
        } catch (e) {}
    }
}

async function apiUpload(file, slot) {
    file = await ensureUploadable(file); // convert iPhone HEIC -> JPEG first
    const fd = new FormData();
    fd.append('image', file, file.name || 'photo.jpg');
    if (slot) fd.append('slot', slot);
    let res;
    try {
        res = await fetchWithTimeout(
            API_BASE + 'upload.php',
            { method: 'POST', headers: csrfHeader(), credentials: 'include', body: fd },
            45000,
        );
    } catch (netErr) {
        throw new Error(
            netErr && netErr.name === 'AbortError'
                ? 'The upload took too long. Please try a smaller image or try again.'
                : 'Network error — could not reach the server.',
        );
    }
    const text = await res.text();
    let data = {};
    try {
        data = text ? JSON.parse(text) : {};
    } catch (e) {
        throw new Error(
            res.ok
                ? 'Unexpected server response.'
                : 'Server error ' + res.status + (text ? ': ' + text.slice(0, 200) : ''),
        );
    }
    if (!res.ok) throw new Error(data.error || 'Upload failed (' + res.status + ')');
    return data.url;
}

// Built-in file finder: opens the device's file picker (images only),
// uploads the chosen file to the server, then runs onDone(savedUrl).
// Used by the Settings photo/gallery editors (host photo, per-cottage photos,
// experiences, homepage content images).
function pickAndUpload(slot, onDone) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*,.heic,.heif';
    input.onchange = async () => {
        const file = input.files && input.files[0];
        if (!file) return;
        try {
            const url = await apiUpload(file, slot);
            await onDone(url);
        } catch (e) {
            glassAlert('Upload failed: ' + e.message);
        }
    };
    input.click();
}

// Map a backend booking row (snake_case, flat) to the in-memory shape the
// render code expects (camelCase, nested agreedPrice).
function mapBookingFromApi(row) {
    const b = {
        id: 'b' + row.id, // keep string id form used by bookingRef etc.
        dbId: parseInt(row.id, 10), // numeric id for API calls
        preArrivalSent: row.pre_arrival_sent || null,
        name: row.name || '',
        email: row.email || '',
        phone: row.phone || '',
        address: row.address || '',
        postcode: row.postcode || '',
        checkIn: row.check_in,
        checkOut: row.check_out,
        checkInTime: row.check_in_time || '15:00',
        checkOutTime: row.check_out_time || '10:00',
        adults: parseInt(row.adults, 10) || 0,
        children: parseInt(row.children, 10) || 0,
        guests: guestSummary(parseInt(row.adults, 10) || 0, parseInt(row.children, 10) || 0),
        notes: row.notes || '',
        payment: row.payment || 'unpaid',
        depositPaid: parseFloat(row.deposit_paid) || 0,
        paymentMethod: row.payment_method || '',
        paymentDate: row.payment_date || '',
        termsAcceptedAt: row.terms_accepted_at || '',
        termsVersion: row.terms_version || '',
        holdStatus: row.hold_status || 'none',
        holdAmount: parseFloat(row.hold_amount) || 0,
    };
    if (row.agreed_total != null) {
        const nightly = parseFloat(row.agreed_nightly) || 0;
        const txFee = parseFloat(row.agreed_txn_fee) || 0;
        const dep = parseFloat(row.agreed_booking_fee) || 0; // column reused to store damages deposit
        b.agreedPrice = {
            total: parseFloat(row.agreed_total),
            perNight: parseFloat(row.agreed_per_night),
            nights: parseInt(row.agreed_nights, 10),
            nightly: nightly,
            damagesDeposit: dep,
            transactionPct: parseFloat(row.agreed_txn_pct),
            txFee: txFee,
            rentalTotal: nightly + txFee,
            agreedOn: row.agreed_on || '',
        };
    }
    // Per-booking damages deposit override (if the owner set one)
    b.damagesDeposit = row.agreed_booking_fee != null ? parseFloat(row.agreed_booking_fee) : null;
    // Manual total price override (back office). When set, it is the agreed total.
    b.priceOverride =
        row.price_override != null && row.price_override !== ''
            ? parseFloat(row.price_override)
            : null;
    if (b.priceOverride != null && b.agreedPrice) {
        b.agreedPrice.total = b.priceOverride;
        b.agreedPrice.isOverride = true;
    }
    return b;
}
function mapEnquiryFromApi(row) {
    return {
        id: 'e' + row.id,
        dbId: parseInt(row.id, 10),
        propKey: row.prop_key,
        name: row.name || '',
        email: row.email || '',
        phone: row.phone || '',
        address: row.address || '',
        postcode: row.postcode || '',
        checkIn: row.check_in,
        checkOut: row.check_out,
        checkInTime: row.check_in_time || '15:00',
        checkOutTime: row.check_out_time || '10:00',
        adults: parseInt(row.adults, 10) || 0,
        children: parseInt(row.children, 10) || 0,
        guests: guestSummary(parseInt(row.adults, 10) || 0, parseInt(row.children, 10) || 0),
        message: row.message || '',
        termsAcceptedAt: row.terms_accepted_at || '',
        termsVersion: row.terms_version || '',
        received: (row.created_at || '').split(' ')[0] || '',
    };
}

/* --- 1. ROUTING --- */
// The customer-facing pages whose words/photos the owner edits with the dock
// "Edit text & photos" button. The button is hidden on the admin tools (Home,
// Reviews, Money, Settings) so it only appears where there's site content to edit.
const CUSTOMER_FACING_VIEWS = ['view-main', 'view-cottages', 'view-21a'];
// The only views an admin ever sees — everything else is the customer site,
// which a signed-in admin has no use for (nav() bounces it to the back office).
const ADMIN_VIEWS = ['view-backoffice', 'view-settings', 'view-accounts', 'view-activity-log'];
// Preview-as-guest: opening the site with ?preview=1 renders the customer
// experience even though an admin is signed in (owner-mode + the admin bounce
// are suppressed). Read-only — used by the staging Test centre to view the site.
const PREVIEW_MODE = /[?&]preview=1\b/.test(location.search || '');
// The staging site runs the same code from a staging.<domain> host with its
// OWN database + sandbox Square/email. Show a persistent banner there so it's
// never mistaken for the live site. (Search engines are blocked via .htaccess.)
const IS_STAGING = /(^|\.)staging\./i.test(location.hostname || '');
function injectStagingBanner() {
    if (!IS_STAGING || document.getElementById('staging-banner')) return;
    const bar = document.createElement('div');
    bar.id = 'staging-banner';
    bar.textContent =
        'TEST COPY — practice only. Anything you do here will not affect your live site or real guests.';
    document.body.appendChild(bar);
    document.body.classList.add('has-staging-banner');
}
if (IS_STAGING) {
    try {
        document.addEventListener('DOMContentLoaded', () => {
            injectStagingBanner();
            // Staging is the test environment: show the Test centre tools, and
            // hide the "open staging" link (we're already on it).
            const tc = document.getElementById('testcentre-row');
            if (tc) tc.style.display = '';
            const link = document.getElementById('staging-link-row');
            if (link) link.style.display = 'none';
        });
    } catch (e) {}
}
// True for a booking the Test centre created (tagged in its notes).
function isTestBooking(b) {
    return !!(b && typeof b.notes === 'string' && b.notes.indexOf('[CHB-TEST]') !== -1);
}
// First-party, cookie-free analytics (see track.php). Fire-and-forget; never
// blocks the UI and never counts the owner's own browsing. utm_source from the
// landing URL is captured once so campaign traffic (newsletter, Instagram…) is
// attributable even though search engines hide their query terms.
let __utmSource = '';
try {
    const __u = new URLSearchParams(location.search);
    __utmSource = (__u.get('utm_source') || __u.get('utm_medium') || '').toString().slice(0, 60);
} catch (e) {}
// Time-on-page (dwell): beacon how long the current view was visible, so the
// owner can see which pages hold attention. Skipped for the owner's own browsing.
let __viewKey = null,
    __viewAt = 0;
function flushDwell() {
    if (!__viewKey || !__viewAt) {
        __viewAt = 0;
        return;
    }
    const ms = Date.now() - __viewAt;
    __viewAt = 0;
    if (document.body.classList.contains('owner-mode')) return;
    if (ms < 500 || ms > 1800000) return; // ignore flicks and backgrounded/absurd spans
    const payload = JSON.stringify({ dwell: ms, path: __viewKey });
    try {
        if (navigator.sendBeacon)
            navigator.sendBeacon(
                API_BASE + 'track.php',
                new Blob([payload], { type: 'application/json' }),
            );
        else apiPost('track.php', { dwell: ms, path: __viewKey }).catch(() => {});
    } catch (e) {}
}
function trackView(viewId, prop) {
    if (document.body.classList.contains('owner-mode')) return;
    flushDwell(); // close out the previous view's dwell
    __viewKey = viewId || 'view-main';
    __viewAt = Date.now();
    try {
        apiPost('track.php', {
            path: viewId || 'view-main',
            prop: prop || '',
            source: __utmSource,
        }).catch(() => {});
    } catch (e) {}
}
// Flush dwell when the tab is hidden / unloaded; resume timing when it returns.
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushDwell();
    else if (__viewKey) __viewAt = Date.now();
});
window.addEventListener('pagehide', flushDwell);
// A named intent event — builds the in-page conversion funnel.
// Known events: book_click, enquiry_open, enquiry_submit, pay_start.
function trackEvent(name, prop) {
    if (document.body.classList.contains('owner-mode')) return;
    try {
        apiPost('track.php', { event: name, prop: prop || '', source: __utmSource }).catch(
            () => {},
        );
    } catch (e) {}
}
// Hero CTA → smooth-scroll to the "Check availability" panel (dates-first homepage).
function scrollToAvailability() {
    const el = document.getElementById('home-availability');
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
// Progressive scroll-reveal: fade + rise sections as they enter view. Does nothing
// under reduced-motion (so .reveal elements stay fully visible), and only arms the
// hiding CSS by adding html.js-reveal — content is never hidden without JS.
let __revealIO = null;
function observeReveals(root) {
    if (!__revealIO) return;
    (root || document)
        .querySelectorAll('.reveal:not(.in-view)')
        .forEach((el) => __revealIO.observe(el));
}
function initScrollReveal() {
    try {
        if (!('IntersectionObserver' in window)) return;
        if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        document.documentElement.classList.add('js-reveal');
        __revealIO = new IntersectionObserver(
            (entries) => {
                entries.forEach((e) => {
                    if (e.isIntersecting) {
                        e.target.classList.add('in-view');
                        __revealIO.unobserve(e.target);
                    }
                });
            },
            { threshold: 0.12, rootMargin: '0px 0px -8% 0px' },
        );
        observeReveals(document);
    } catch (e) {
        /* leave content visible */
    }
}
if (document.readyState !== 'loading') initScrollReveal();
else document.addEventListener('DOMContentLoaded', initScrollReveal);

// ---- Hero parallax: the background drifts slower than the page as you
// scroll, giving the opening a sense of depth. Composited (transform) and
// rAF-throttled; skipped under reduced-motion. ----
function initHeroParallax() {
    try {
        if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        const panel = document.getElementById('hero-headline-panel');
        if (!panel) return;
        let ticking = false;
        const onScroll = () => {
            if (ticking) return;
            ticking = true;
            requestAnimationFrame(() => {
                const y = window.scrollY || 0;
                // The headline panel rises a touch slower than the page, so more
                // of the photo behind it reveals as you scroll — gentle depth.
                // (The hero-bg keeps its own slow drift; no transform conflict.)
                if (y < 900) panel.style.setProperty('--parallax', (-y * 0.12).toFixed(1) + 'px');
                ticking = false;
            });
        };
        window.addEventListener('scroll', onScroll, { passive: true });
        onScroll();
    } catch (e) {}
}
if (document.readyState !== 'loading') initHeroParallax();
else document.addEventListener('DOMContentLoaded', initHeroParallax);

// ---- Seasonal accent: a subtle secondary tint that shifts with the season,
// so the site quietly feels current rather than set-and-forget. Applied only
// to small details via a CSS var — the rose-gold brand accent is untouched. ----
(function applySeasonalAccent() {
    try {
        const m = new Date().getMonth(); // 0=Jan (northern hemisphere)
        const seasonAccent =
            m >= 2 && m <= 4
                ? '#7FB069' // spring — fresh green
                : m >= 5 && m <= 7
                  ? '#E0A44C' // summer — warm gold
                  : m >= 8 && m <= 10
                    ? '#C67B3D' // autumn — amber
                    : '#6E93B3'; // winter — slate-blue
        document.documentElement.style.setProperty('--season-accent', seasonAccent);
    } catch (e) {}
})();
// Log a homepage availability search + whether it found anything (demand signal).
function logSearch(info) {
    if (document.body.classList.contains('owner-mode')) return;
    try {
        apiPost('track.php', { search: info || {} }).catch(() => {});
    } catch (e) {}
}
// Site-wide: block pinch-to-zoom of the PAGE for an app-like feel. The viewport
// meta + `touch-action: pan-x pan-y` cover Chrome/Android; iOS Safari ignores both,
// so we also cancel its pinch "gesture" events and 2-finger zoom — EXCEPT inside a
// Leaflet map, where pinch-zoom is the expected behaviour.
(function blockPinchZoom() {
    const inMap = (el) => !!(el && el.closest && el.closest('.leaflet-container'));
    ['gesturestart', 'gesturechange', 'gestureend'].forEach((type) => {
        document.addEventListener(
            type,
            (e) => {
                if (!inMap(e.target)) e.preventDefault();
            },
            { passive: false },
        );
    });
    document.addEventListener(
        'touchmove',
        (e) => {
            if (e.touches && e.touches.length > 1 && !inMap(e.target)) e.preventDefault();
        },
        { passive: false },
    );
})();
function nav(viewId, anchorId = null) {
    // A signed-in admin has no customer-facing site — send any such view to
    // the back office (covers deep links, the address bar, stray calls). In
    // preview-as-guest mode we let the customer views through. The secure pay
    // page is token-authorised (not a session), so it's always allowed — an
    // admin can open a pay link to test it (staging) or settle on a guest's behalf.
    if (isAuthenticated && !PREVIEW_MODE && viewId !== 'view-pay' && !ADMIN_VIEWS.includes(viewId))
        viewId = 'view-backoffice';
    const target = document.getElementById(viewId);
    if (!target) {
        console.warn(`nav(): unknown view "${viewId}"`);
        return;
    }
    document.querySelectorAll('.page-view').forEach((v) => v.classList.remove('active'));
    target.classList.add('active');

    // On mobile the sign-in and messages screens are shown as full pages
    // (below the dock), so navigating via the dock should leave them like
    // any other page.
    try {
        closeGuestAuthModal();
    } catch (e) {}
    try {
        closeGuestDetailsModal();
    } catch (e) {}
    try {
        closeGuestSecurityModal();
    } catch (e) {}
    try {
        closeChat();
    } catch (e) {}

    // Keep the guest app shell's bottom tab bar in sync with the active view
    // (guest-app.js defines this; safe no-op before it loads / for admins).
    try {
        if (window.setActiveTab) window.setActiveTab(viewId);
    } catch (e) {}

    // Keep the address bar in sync: leaving a cottage page restores the root URL.
    if (viewId !== 'view-21a') {
        try {
            clearCottageUrl();
        } catch (e) {}
    }

    // Accentuate which admin section the dock is currently showing (clears
    // when on a non-admin view such as the public site or the dashboard).
    document
        .querySelectorAll('.admin-dock-btn[data-view]')
        .forEach((b) => b.classList.toggle('current', b.getAttribute('data-view') === viewId));
    requestAnimationFrame(moveDockIndicator);

    // The cottage page's sticky booking bar lives on <body> (so its position:fixed
    // isn't trapped by the page-view transform); show it only on the cottage page.
    try {
        const bb = document.getElementById('prop-book-bar');
        if (bb) bb.style.display = viewId === 'view-21a' ? 'flex' : 'none';
        // Lets CSS lift the chat bubble clear of the bar (see .book-bar-open).
        document.body.classList.toggle('book-bar-open', viewId === 'view-21a');
    } catch (e) {}

    // Refresh the unified back office (calendar + inbox) whenever it's opened
    if (viewId === 'view-backoffice') {
        initBackOffice();
    } else {
        clearChangeoverToasts(); // toasts are a back-office aid only
    }
    if (viewId === 'view-settings') {
        try {
            renderSquareSettings();
        } catch (e) {}
        try {
            settingsRecentRender();
        } catch (e) {}
    }
    if (viewId === 'view-experiences') {
        try {
            renderExperiencesView();
        } catch (e) {}
    }
    if (viewId === 'view-activity-log') {
        try {
            renderActivityLog();
        } catch (e) {}
    }
    if (viewId === 'view-cottages') {
        try {
            renderCottagesMap();
        } catch (e) {}
    }

    // First-party analytics: count customer-facing page views (skips owner).
    if (CUSTOMER_FACING_VIEWS.includes(viewId)) {
        try {
            trackView(viewId, viewId === 'view-21a' ? activeFrontProperty : '');
        } catch (e) {}
    }

    if (anchorId) {
        setTimeout(() => {
            const el = document.getElementById(anchorId);
            if (!el) return;
            const offsetPosition =
                el.getBoundingClientRect().top - document.body.getBoundingClientRect().top - 90;
            window.scrollTo({ top: offsetPosition, behavior: 'smooth' });
        }, 150);
    } else {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
}

// ---- Light / dark theme toggle ----
function setThemeLabel() {
    const btn = document.getElementById('theme-toggle');
    if (!btn) return;
    // The switch position/animation is driven by the body.light-mode class in CSS;
    // here we just keep the accessible state + label in sync.
    const isLight = document.body.classList.contains('light-mode');
    btn.setAttribute('aria-checked', isLight ? 'true' : 'false');
    btn.title = isLight ? 'Switch to dark mode' : 'Switch to light mode';
    btn.setAttribute('aria-label', btn.title);
}
function applySavedTheme() {
    let pref = null;
    try {
        pref = localStorage.getItem('chb-theme');
    } catch (e) {}
    // Coastal-fresh LIGHT is the guest default; dark is opt-in (pref==='dark').
    // Admins always use dark mode (their toggle is hidden); their saved
    // preference is left untouched and re-applied when they sign out.
    if (pref !== 'dark' && !isAuthenticated) document.body.classList.add('light-mode');
    else document.body.classList.remove('light-mode');
    try {
        document.documentElement.classList.remove('theme-light-boot');
    } catch (e) {}
    setThemeLabel();
}
// Point both "Call to Discuss" buttons at the configured phone number.
// Prefers the value saved in Settings (siteContent['contact-phone']),
// falling back to the constants above.
function wireCallButtons() {
    const cfg = (siteContent && siteContent['contact-phone']) || {};
    const dial = (cfg.dial || CONTACT_PHONE_DIAL).replace(/\s+/g, '');
    const display = cfg.display || CONTACT_PHONE_DISPLAY;
    ['enq-call-btn', 'acct-call-btn', 'acct-call-btn-dd'].forEach((id) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.setAttribute('href', 'tel:' + dial);
        el.setAttribute('title', 'Call us on ' + display);
    });
}

async function saveContactPhone() {
    const dial = (document.getElementById('contact-phone-dial').value || '').trim();
    const display = (document.getElementById('contact-phone-display').value || '').trim();
    if (!dial) {
        glassAlert('Please enter a dial number.');
        return;
    }
    const value = { dial, display: display || dial };
    try {
        await saveContent('contact-phone', value);
        siteContent['contact-phone'] = value;
        wireCallButtons();
        toast('Contact number saved.');
    } catch (e) {
        glassAlert("Couldn't save the number: " + e.message);
    }
}

// Build an .ics calendar file for a booking and download it. Works with
// Apple Calendar, Google Calendar and Outlook on any device — no add-on.
function addBookingToCalendar(bookingId) {
    // Find the booking: prefer the guest cache (guest view), else admin data.
    let propKey = null,
        b = null,
        address = '';
    const cached = guestBookingsCache.find((x) => x.booking.id === bookingId);
    if (cached) {
        propKey = cached.propKey;
        b = cached.booking;
        address = cached.address;
    } else {
        const loc = findBookingLocation(bookingId);
        if (loc) {
            propKey = loc.propKey;
            b = dbBookings[loc.propKey][loc.idx];
        }
    }
    if (!b) {
        glassAlert("Couldn't find that booking to add.");
        return;
    }
    const meta = propertyMeta[propKey] || { name: propKey };

    // iCal escaping for text fields (commas, semicolons, newlines, backslashes)
    const esc = (s) =>
        String(s || '')
            .replace(/\\/g, '\\\\')
            .replace(/;/g, '\\;')
            .replace(/,/g, '\\,')
            .replace(/\n/g, '\\n');
    // YYYY-MM-DD -> YYYYMMDD for all-day (DATE) values
    const dt = (s) => String(s || '').replace(/-/g, '');
    // DTEND on an all-day event is exclusive, so checkout date is correct as-is
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
    const uid = 'chb-' + (b.id || Math.random().toString(36).slice(2)) + '@cottageholidaysblakeney';
    const summary = `Stay at ${meta.name} — Cottage Holidays Blakeney`;
    const descParts = [
        `Booking reference: ${bookingRef(b.id)}`,
        `Check-in from ${b.checkInTime || '15:00'}`,
        `Check-out by ${b.checkOutTime || '10:00'}`,
    ];
    const ics = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Cottage Holidays Blakeney//Booking//EN',
        'CALSCALE:GREGORIAN',
        'METHOD:PUBLISH',
        'BEGIN:VEVENT',
        `UID:${uid}`,
        `DTSTAMP:${stamp}`,
        `DTSTART;VALUE=DATE:${dt(b.checkIn)}`,
        `DTEND;VALUE=DATE:${dt(b.checkOut)}`,
        `SUMMARY:${esc(summary)}`,
        `DESCRIPTION:${esc(descParts.join('\n'))}`,
        address ? `LOCATION:${esc(address)}` : '',
        'BEGIN:VALARM',
        'TRIGGER:-P1D',
        'ACTION:DISPLAY',
        `DESCRIPTION:${esc('Your stay at ' + meta.name + ' is tomorrow')}`,
        'END:VALARM',
        'END:VEVENT',
        'END:VCALENDAR',
    ]
        .filter(Boolean)
        .join('\r\n');

    const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Cottage-Holidays-Blakeney-${bookingRef(b.id)}.ics`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Mobile action dropdown (guest dashboard)
function toggleActionMenu(e) {
    if (e) e.stopPropagation();
    const m = document.querySelector('.action-menu');
    if (!m) return;
    const open = m.classList.toggle('open');
    const t = m.querySelector('.action-dd-toggle');
    if (t) t.setAttribute('aria-expanded', open ? 'true' : 'false');
}
function closeActionMenu() {
    const m = document.querySelector('.action-menu');
    if (m) m.classList.remove('open');
    const t = m && m.querySelector('.action-dd-toggle');
    if (t) t.setAttribute('aria-expanded', 'false');
}
// Close the dropdown when tapping elsewhere
document.addEventListener('click', (e) => {
    const m = document.querySelector('.action-menu.open');
    if (m && !m.contains(e.target)) closeActionMenu();
});

// Brief rose-gold flare on the header crown when tapped/clicked
function flareCrown() {
    const c = document.querySelector('.logo-mark');
    if (!c) return;
    c.classList.remove('crown-flare');
    void c.offsetWidth; // restart the animation if tapped rapidly
    c.classList.add('crown-flare');
    setTimeout(() => c.classList.remove('crown-flare'), 750);
}

function toggleTheme() {
    const isLight = document.body.classList.toggle('light-mode');
    try {
        localStorage.setItem('chb-theme', isLight ? 'light' : 'dark');
    } catch (e) {}
    setThemeLabel();
}

function toggleMobileMenu() {
    const menu = document.getElementById('mobileMenu');
    menu.classList.toggle('open');
    const open = menu.classList.contains('open');
    const tog = document.querySelector('.menu-toggle');
    if (tog) tog.setAttribute('aria-expanded', open ? 'true' : 'false');
    document.querySelector('.menu-toggle').innerHTML = open
        ? '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>'
        : '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>';
    // Prevent the page scrolling behind the open overlay
    document.body.style.overflow = open ? 'hidden' : '';
}

// Reset the mobile overlay if the viewport grows past the breakpoint
window.addEventListener('resize', () => {
    const menu = document.getElementById('mobileMenu');
    if (window.innerWidth > 768 && menu.classList.contains('open')) {
        menu.classList.remove('open');
        document.querySelector('.menu-toggle').innerHTML =
            '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>';
        document.body.style.overflow = '';
    }
});

/* --- HEADER: hide on scroll down, reveal on scroll up --- */
(function setupHeaderScroll() {
    const header = document.querySelector('header');
    let lastY = window.scrollY;
    let ticking = false;
    const DELTA = 8; // ignore tiny jitters
    const TOP_ZONE = 80; // always show near the top of the page

    function update() {
        const y = window.scrollY;
        const menuOpen = document.getElementById('mobileMenu').classList.contains('open');

        // Always visible near the top, or whenever the mobile menu is open
        if (y <= TOP_ZONE || menuOpen) {
            header.classList.remove('header-hidden');
        } else if (Math.abs(y - lastY) > DELTA) {
            if (y > lastY)
                header.classList.add('header-hidden'); // scrolling down
            else header.classList.remove('header-hidden'); // scrolling up
        }
        lastY = y;
        ticking = false;
    }

    window.addEventListener(
        'scroll',
        () => {
            if (!ticking) {
                window.requestAnimationFrame(update);
                ticking = true;
            }
        },
        { passive: true },
    );
})();

/* --- 2. GALLERY LOGIC --- */
const galleryState = {};
function moveGallery(trackId, direction) {
    const track = document.getElementById(trackId);
    if (!track) return;
    if (galleryState[trackId] === undefined) galleryState[trackId] = 0;

    const slidesCount = track.children.length;
    galleryState[trackId] += direction;
    if (galleryState[trackId] >= slidesCount) galleryState[trackId] = 0;
    else if (galleryState[trackId] < 0) galleryState[trackId] = slidesCount - 1;

    track.style.transform = `translateX(${-(galleryState[trackId] * 100)}%)`;
    loadGallerySlides(trackId);
    if (trackId === 'gallery-21a') updateGalleryCount();
}
// Customer-facing "n / total" photo counter on the mobile gallery carousel
// (so guests know there are more photos). Hidden when there's 0–1 photo.
function updateGalleryCount() {
    const el = document.getElementById('gallery-count-21a');
    if (!el) return;
    const total = (window.__galleryImages || []).filter(Boolean).length;
    if (total <= 1) {
        el.style.display = 'none';
        return;
    }
    const cur = Math.min((galleryState['gallery-21a'] || 0) + 1, total);
    el.style.display = 'block';
    el.textContent = `${cur} / ${total}`;
}

// ---- Full-screen photo lightbox ----
let lightboxIndex = 0;
function openLightbox(i) {
    const imgs = window.__galleryImages || [];
    if (!imgs.length || !imgs[i]) return; // ignore empty placeholder slides
    lightboxIndex = i;
    renderLightbox();
    document.getElementById('lightbox').classList.add('open');
}
function renderLightbox() {
    const imgs = window.__galleryImages || [];
    if (!imgs.length) return;
    if (lightboxIndex < 0) lightboxIndex = imgs.length - 1;
    if (lightboxIndex >= imgs.length) lightboxIndex = 0;
    document.getElementById('lightbox-img').src = imgs[lightboxIndex];
    document.getElementById('lightbox-counter').textContent =
        `${lightboxIndex + 1} / ${imgs.length}`;
}
function lightboxNav(dir) {
    lightboxIndex += dir;
    renderLightbox();
}
function closeLightbox() {
    document.getElementById('lightbox').classList.remove('open');
}
// Swipe left/right on touch devices.
(function () {
    let x0 = null;
    const lb = () => document.getElementById('lightbox');
    document.addEventListener(
        'touchstart',
        (e) => {
            const el = lb();
            if (el && el.classList.contains('open')) x0 = e.touches[0].clientX;
        },
        { passive: true },
    );
    document.addEventListener(
        'touchend',
        (e) => {
            if (x0 === null) return;
            const dx = e.changedTouches[0].clientX - x0;
            if (Math.abs(dx) > 50) lightboxNav(dx < 0 ? 1 : -1);
            x0 = null;
        },
        { passive: true },
    );
})();

// ---- Sliding selection pill for the admin dock ----
// Sizes + positions the white indicator under the active section button, so it
// glides between tabs (like a modern liquid-glass tab bar) instead of blinking.
function moveDockIndicator() {
    const dock = document.querySelector('.admin-dock');
    if (!dock) return;
    const ind = dock.querySelector('.admin-dock-indicator');
    if (!ind) return;
    const cur = dock.querySelector('.admin-dock-btn.current');
    if (!cur || cur.offsetParent === null) {
        ind.classList.remove('show');
        return;
    }
    ind.style.width = cur.offsetWidth + 'px';
    ind.style.height = cur.offsetHeight + 'px';
    ind.style.left = cur.offsetLeft + 'px';
    ind.classList.add('show');
}
// Re-align after a resize (button sizes change at the dock's breakpoints).
window.addEventListener('resize', () => {
    clearTimeout(window.__dockT);
    window.__dockT = setTimeout(moveDockIndicator, 120);
});

// ---- Public top-nav: hover-following glass pill ----
(function initNavIndicator() {
    const ul = document.querySelector('header nav ul');
    if (!ul) return;
    const ind = ul.querySelector('.nav-indicator');
    if (!ind) return;
    const tabs = ul.querySelectorAll('li a:not(.btn-glass)');
    function moveTo(el) {
        ind.style.left = el.offsetLeft + 'px';
        ind.style.width = el.offsetWidth + 'px';
        ind.style.height = el.offsetHeight + 'px';
        ind.classList.add('show');
    }
    tabs.forEach((t) => t.addEventListener('mouseenter', () => moveTo(t)));
    ul.addEventListener('mouseleave', () => ind.classList.remove('show'));
})();

// ---- Staggered entrance for the cottage cards ----
// Plays once on load, then clears the class so the hover lift works afterwards.
(function initCardRise() {
    document.querySelectorAll('#cottages .grid > .card').forEach((c) => {
        c.classList.add('rise');
        c.addEventListener('animationend', function done(e) {
            if (e.animationName === 'cardRise') {
                c.classList.remove('rise');
                c.removeEventListener('animationend', done);
            }
        });
    });
})();

// Build the gallery slides dynamically from an array of image URLs, so a
// property can have any number of photos (1, 3, 20…). Clamps the current
// slide index and updates the edit-bar hint.
function renderGallery(images) {
    const track = document.getElementById('gallery-21a');
    if (!track) return;
    const list = Array.isArray(images) && images.length ? images : [''];
    // Lazy: hold the URL in data-bg and only paint the visible slide + its
    // neighbours (see loadGallerySlides). Off-screen photos download just in
    // time as the visitor navigates, so opening a cottage is much lighter.
    window.__galleryImages = list;
    const galName =
        (propertyMeta[activeFrontProperty] && propertyMeta[activeFrontProperty].name) ||
        'the cottage';
    track.innerHTML = list
        .map(
            (src, i) =>
                `<div class="gallery-slide" id="prop-img-${i}" data-bg="${escapeHtml(src)}" role="img" aria-label="Photo ${i + 1} of ${list.length} — ${escapeHtml(galName)}" onclick="openLightbox(${i})"></div>`,
        )
        .join('');
    // Clamp index in case photos were removed
    let idx = galleryState['gallery-21a'] || 0;
    if (idx >= list.length) idx = list.length - 1;
    if (idx < 0) idx = 0;
    galleryState['gallery-21a'] = idx;
    track.style.transform = `translateX(${-(idx * 100)}%)`;
    loadGallerySlides('gallery-21a');
    updateGalleryCount();
    renderGalleryGrid(list);
}
// Desktop-only Airbnb-style photo grid (1 big + up to 4 small) built from the
// same image list; tapping a cell opens the lightbox.
function renderGalleryGrid(list) {
    const grid = document.getElementById('gallery-grid-21a');
    if (!grid) return;
    const imgs = (Array.isArray(list) ? list : []).filter(Boolean).slice(0, 5);
    const n = imgs.length;
    // Adapt the layout to how many photos there are so there are no empty gaps.
    if (n >= 4) {
        grid.style.gridTemplateColumns = '2fr 1fr 1fr';
        grid.style.gridTemplateRows = '1fr 1fr';
    } else if (n === 3) {
        grid.style.gridTemplateColumns = '1.7fr 1fr';
        grid.style.gridTemplateRows = '1fr 1fr';
    } else if (n === 2) {
        grid.style.gridTemplateColumns = '1fr 1fr';
        grid.style.gridTemplateRows = '1fr';
    } else {
        grid.style.gridTemplateColumns = '1fr';
        grid.style.gridTemplateRows = '1fr';
    }
    const big = n >= 3 ? ' gg-big' : '';
    const ggName =
        (propertyMeta[activeFrontProperty] && propertyMeta[activeFrontProperty].name) ||
        'the cottage';
    let html = imgs
        .map(
            (src, i) =>
                `<div class="gg-cell${i === 0 ? big : ''}" style="background-image:url('${escapeHtml(src)}')" role="img" aria-label="Photo ${i + 1} of ${n} — ${escapeHtml(ggName)}" onclick="openLightbox(${i})"></div>`,
        )
        .join('');
    const total = Array.isArray(list) ? list.filter(Boolean).length : 0;
    if (total > 5)
        html += `<button type="button" class="gg-showall" onclick="openLightbox(0)">Show all ${total} photos</button>`;
    grid.innerHTML = html;
}

// Paint the current slide and its immediate neighbours; leave the rest
// unpainted until they're navigated to. Cheap to call repeatedly.
function loadGallerySlides(trackId) {
    const track = document.getElementById(trackId);
    if (!track) return;
    const slides = track.children;
    const cur = galleryState[trackId] || 0;
    const n = slides.length;
    for (let i = 0; i < n; i++) {
        // current ± 1, with wrap-around so looping never shows a blank slide
        const near =
            Math.abs(i - cur) <= 1 || (cur === 0 && i === n - 1) || (cur === n - 1 && i === 0);
        if (!near) continue;
        const s = slides[i];
        const bg = s.getAttribute('data-bg');
        if (bg && !s.style.backgroundImage) s.style.backgroundImage = `url('${bg}')`;
    }
}

// ---- Per-cottage GPS location for the on-arrival key-code unlock ----
function geoVal(k) {
    const g = adminPrivateContent['geo-' + k];
    return g && typeof g === 'object' && g.lat != null && g.lng != null ? g : null;
}
function geoStatusText(k) {
    const g = geoVal(k);
    return g ? 'Saved: ' + Number(g.lat).toFixed(5) + ', ' + Number(g.lng).toFixed(5) : 'Not set';
}
function setGeoInputs(k, g) {
    const latEl = document.getElementById('geo-lat-' + k);
    const lngEl = document.getElementById('geo-lng-' + k);
    if (latEl) latEl.value = g ? g.lat : '';
    if (lngEl) lngEl.value = g ? g.lng : '';
}
function captureGeo(k) {
    const status = document.getElementById('geo-status-' + k);
    if (!navigator.geolocation) {
        if (status) status.textContent = "This device can't share its location.";
        return;
    }
    if (status) status.textContent = 'Getting location…';
    navigator.geolocation.getCurrentPosition(
        async (pos) => {
            const g = { lat: pos.coords.latitude, lng: pos.coords.longitude };
            adminPrivateContent['geo-' + k] = g;
            setGeoInputs(k, g);
            try {
                await saveContent('geo-' + k, g);
            } catch (e) {}
            if (status) status.textContent = geoStatusText(k);
        },
        () => {
            if (status) status.textContent = "Couldn't get location (permission denied?).";
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
}
// Save manually-typed coordinates (with basic range validation).
async function saveGeoManual(k) {
    const status = document.getElementById('geo-status-' + k);
    const lat = parseFloat((document.getElementById('geo-lat-' + k) || {}).value);
    const lng = parseFloat((document.getElementById('geo-lng-' + k) || {}).value);
    if (!isFinite(lat) || !isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
        if (status)
            status.textContent = 'Enter a valid latitude (−90 to 90) and longitude (−180 to 180).';
        return;
    }
    const g = { lat, lng };
    adminPrivateContent['geo-' + k] = g;
    try {
        await saveContent('geo-' + k, g);
    } catch (e) {}
    if (status) status.textContent = geoStatusText(k);
}
function clearGeo(k) {
    adminPrivateContent['geo-' + k] = '';
    saveContent('geo-' + k, '');
    setGeoInputs(k, null);
    const status = document.getElementById('geo-status-' + k);
    if (status) status.textContent = 'Not set';
}

// Persist a property's image list to the backend content store.
async function savePropertyImages(propKey, images) {
    try {
        await apiPost('content.php', { action: 'set', key: `images-${propKey}`, value: images });
    } catch (e) {
        glassAlert("Couldn't save the gallery: " + e.message);
    }
}

/* --- 3. AUTH & CMS --- */
let isAuthenticated = false;
// Admin auth is now handled server-side (api/auth.php). No client password.

function setAuthUI() {
    // The owner's tools now live in the labelled owner menu bar (shown via the
    // 'owner-mode' body class). The footer keeps only the theme toggle and the
    // back-office (🔩) button, so there's nothing per-button to show/hide here.
    // In preview-as-guest mode the admin sees the customer site, so don't
    // apply owner chrome or bounce them into the back office.
    document.body.classList.toggle('owner-mode', isAuthenticated && !PREVIEW_MODE);
    // Force dark mode for admins (and restore the saved theme on sign-out).
    try {
        applySavedTheme();
    } catch (e) {}
    if (PREVIEW_MODE) {
        try {
            injectPreviewBanner();
        } catch (e) {}
        return;
    }
    // Keep the floating admin dock's enquiry count live whenever signed in.
    if (isAuthenticated) {
        try {
            refreshOwnerHomeBadges();
        } catch (e) {}
        // No customer site for admins — if a reload left them on the public
        // hero (or any customer view), drop them into the back office.
        try {
            const av = document.querySelector('.page-view.active');
            if (!av || !ADMIN_VIEWS.includes(av.id)) nav('view-backoffice');
        } catch (e) {}
    }
}
// A slim banner across the top of a preview tab so it's obvious you're seeing
// the guest view (and a one-tap way out).
function injectPreviewBanner() {
    if (document.getElementById('preview-banner')) return;
    const bar = document.createElement('div');
    bar.id = 'preview-banner';
    bar.innerHTML = `<span>Preview mode — viewing the site as a guest. Nothing you do here is saved.</span>
                <button type="button" onclick="exitPreview()">Exit preview</button>`;
    document.body.appendChild(bar);
    document.body.classList.add('has-preview-banner');
}
function exitPreview() {
    try {
        window.close();
    } catch (e) {}
    location.href = 'index.html';
}

// ---- Owner navigation helpers ----
// Enquiries now live in Settings → Enquiries.
async function openEnquiriesView() {
    openSettings('enquiries');
}
// Keep the dock's pending-enquiries count badge live.
async function refreshOwnerHomeBadges() {
    try {
        await loadData();
        const pending = Array.isArray(enquiries) ? enquiries.length : 0;
        const dockBadge = document.getElementById('dock-badge-enquiries');
        if (dockBadge) {
            dockBadge.textContent = pending;
            dockBadge.style.display = pending > 0 ? 'flex' : 'none';
        }
    } catch (e) {
        /* badges are a nicety; never block the page */
    }
}

// Open the Settings & Fees page (admin only)
let adminPrivateContent = {}; // includes arrival-* keys (admin-only)
async function openSettings(section) {
    if (!isAuthenticated) {
        tryAccessBackOffice();
        return;
    }
    nav('view-settings');
    adminHistPush('view-settings');
    // Load admin-only content (arrival-*, geo-*) so the per-cottage editors and
    // the host fields have their data ready when a row is opened.
    try {
        const r = await apiPost('content.php', { action: 'get_all' });
        adminPrivateContent = r.content || {};
    } catch (e) {
        adminPrivateContent = {};
    }
    // Load bookings/enquiries so the Enquiries + Guest-messages badges (and the
    // Preferences occupancy donuts) are accurate even if the back office wasn't opened.
    try {
        await loadData();
    } catch (e) {}
    try {
        refreshInboxBadge();
    } catch (e) {} // Enquiries badge
    try {
        loadAdminMessages();
    } catch (e) {} // Guest messages badge
    if (section) settingsOpen(section);
    else settingsShowIndex();
}

// ---- Settings router: Apple-style index → drill-down sub-pages ----
const SETTINGS_TITLES = {
    enquiries: 'Enquiries',
    messages: 'Guest messages',
    notify: 'Notifications',
    host: 'Profile',
    reviews: 'Reviews',
    security: 'Security',
    accom: 'Cottages',
    calendar: 'Calendar sync',
    cancel: 'Cancellation policy',
    seasongrid: 'Seasonal rates — all cottages',
    pricingcoach: 'Pricing coach',
    payments: 'Payments',
    guests: 'Guest accounts',
    analytics: 'Analytics',
    waitlist: 'Waitlist',
    newsletter: 'Newsletter',
    experiences: 'Experiences',
    content: 'Home page & menu',
    photos: 'Guest photos',
    apis: 'Integrations',
    diagnostics: 'Health check',
    testcentre: 'Test centre',
};
// Open the separate staging sandbox (where all testing now happens) in a new tab.
const STAGING_URL = 'https://staging.cottageholidaysblakeney.co.uk/';
function openStagingSite() {
    window.open(STAGING_URL, '_blank', 'noopener');
}
// ---- Admin history: make the browser/hardware Back button walk
//      drill-down → index → dashboard instead of dumping the owner onto the
//      public homepage. Each admin navigation pushes an entry; the popstate
//      handler replays it (guarded by __histReplay so replays don't re-push).
let __histReplay = false;
function adminHistPush(view, section) {
    if (__histReplay) return;
    try {
        history.pushState({ chbAdmin: { view, section: section || null } }, '');
    } catch (e) {}
}
let settingsBackTarget = null;
// The full Settings drill-down path, so the auto-update reload can restore the
// exact folder/sub-folder the owner was in: { section, prop, accomSec }.
let __settingsPath = null;
// Type-to-find across the Settings index: filters rows by their label +
// description, hides emptied groups and their section labels. The staging-only
// Test-centre group keeps whatever visibility the IS_STAGING code gave it.
function settingsFilter(q) {
    // Every word must match somewhere in the row's visible text OR its
    // hidden data-kw synonyms ("backup" → Health check, "ical" → Calendar).
    const words = (q || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
    const idx = document.getElementById('settings-index');
    if (!idx) return;
    let total = 0;
    idx.querySelectorAll('.settings-group').forEach((g) => {
        if (g.id === 'testcentre-row') return; // staging-only; JS controls it
        let any = false;
        g.querySelectorAll('.settings-row').forEach((row) => {
            const hay = (row.textContent + ' ' + (row.getAttribute('data-kw') || '')).toLowerCase();
            const hit = !words.length || words.every((w) => hay.includes(w));
            row.style.display = hit ? '' : 'none';
            if (hit) {
                any = true;
                total++;
            }
        });
        g.style.display = any ? '' : 'none';
    });
    idx.querySelectorAll('.settings-section-label').forEach((l) => {
        let n = l.nextElementSibling;
        while (n && !n.classList.contains('settings-group')) n = n.nextElementSibling;
        l.style.display = n && n.style.display !== 'none' ? '' : 'none';
    });
    const nores = document.getElementById('settings-noresults');
    if (nores) nores.style.display = words.length && !total ? '' : 'none';
    // Recents are browsing furniture — hide them while searching.
    const rec = document.getElementById('settings-recent');
    if (rec) rec.style.display = words.length || !settingsRecentList().length ? 'none' : '';
}
// Enter opens the first visible result; Escape clears the search.
function settingsSearchKey(ev) {
    if (ev.key === 'Enter') {
        ev.preventDefault();
        const first = document.querySelector(
            '#settings-index .settings-row:not([style*="display: none"])',
        );
        if (first) first.click();
    } else if (ev.key === 'Escape') {
        ev.target.value = '';
        settingsFilter('');
    }
}
// ---- "Recently used" chips (the sections this owner actually opens) ----
function settingsRecentList() {
    try {
        return JSON.parse(localStorage.getItem('chb-settings-recent') || '[]');
    } catch (e) {
        return [];
    }
}
function settingsRecentRecord(section) {
    if (!section) return;
    try {
        const list = settingsRecentList().filter((k) => k !== section);
        list.unshift(section);
        localStorage.setItem('chb-settings-recent', JSON.stringify(list.slice(0, 4)));
    } catch (e) {}
}
function settingsRecentRender() {
    const wrap = document.getElementById('settings-recent');
    if (!wrap) return;
    const chips = settingsRecentList()
        .map((key) => {
            const row = document.querySelector(
                `#settings-index .settings-row[onclick*="settingsOpen('${key}')"]`,
            );
            const label = row && row.querySelector('.settings-row-label');
            if (!label) return '';
            return `<button type="button" class="settings-recent-chip" onclick="settingsOpen('${key}')">${escapeHtml(label.textContent.trim())}</button>`;
        })
        .filter(Boolean)
        .join('');
    wrap.innerHTML = chips ? `<span class="settings-recent-label">Recent</span>${chips}` : '';
    wrap.style.display = chips ? '' : 'none';
}
function settingsShowIndex() {
    __settingsPath = null;
    const idx = document.getElementById('settings-index');
    const panel = document.getElementById('settings-panel');
    if (panel) panel.style.display = 'none';
    if (idx) idx.style.display = '';
    settingsRecentRender();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}
function settingsOpen(section) {
    adminHistPush('view-settings', section);
    settingsRecentRecord(section);
    __settingsPath = section ? { section } : null;
    const idx = document.getElementById('settings-index');
    const panel = document.getElementById('settings-panel');
    if (!panel) return;
    if (idx) idx.style.display = 'none';
    panel.style.display = '';
    panel.querySelectorAll('.settings-sec').forEach((s) => (s.style.display = 'none'));
    const sec = document.getElementById('sec-' + section);
    if (sec) sec.style.display = '';
    const title = document.getElementById('settings-panel-title');
    if (title) title.textContent = SETTINGS_TITLES[section] || 'Settings';
    settingsBackTarget = () => settingsShowIndex();
    if (section === 'enquiries') renderInbox();
    else if (section === 'messages') loadAdminMessages();
    else if (section === 'notify') renderNotifySettings();
    else if (section === 'host') fillHostFields();
    else if (section === 'reviews') loadGuestReviewModeration();
    else if (section === 'photos') loadGuestPhotosAdmin();
    else if (section === 'analytics') loadAnalytics();
    else if (section === 'waitlist') loadWaitlist();
    else if (section === 'newsletter') loadNewsletter();
    else if (section === 'experiences') loadExperiencesAdmin();
    else if (section === 'content') loadContentEditor();
    else if (section === 'diagnostics') loadDiagnostics();
    else if (section === 'testcentre') renderTestCentreList();
    else if (section === 'apis') renderApis();
    else if (section === 'security') loadAdminPasskeys();
    else if (section === 'payments') renderSquareSettings();
    else if (section === 'accom') renderAccomList();
    else if (section === 'calendar') renderCalendarList();
    else if (section === 'cancel') renderCancelList();
    else if (section === 'seasongrid') renderSeasonGrid();
    else if (section === 'pricingcoach') renderPricingCoach();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}
function settingsBack() {
    if (settingsBackTarget) settingsBackTarget();
    else settingsShowIndex();
}

// ---- Settings → Pricing coach (data-driven suggestions; apply is opt-in) ----
async function renderPricingCoach() {
    const wrap = document.getElementById('pricingcoach-body');
    if (!wrap) return;
    wrap.innerHTML = `<p style="font-size:0.85rem;color:var(--text-muted);">Analysing your bookings &amp; demand…</p>`;
    let d;
    try {
        d = await apiGet('pricing-suggest.php?action=suggest');
    } catch (e) {
        wrap.innerHTML = `<p style="font-size:0.85rem;color:var(--text-muted);">Couldn't load suggestions${e && e.message ? ' (' + escapeHtml(e.message) + ')' : ''}.</p>`;
        return;
    }
    const sugg = Array.isArray(d.suggestions) ? d.suggestions : [];
    const sig = d.signals || {};
    const intro = `<p style="font-size:0.85rem;color:var(--text-muted);max-width:640px;margin:0 0 14px;line-height:1.55;">Pricing ideas from <strong>your own</strong> data — calendar occupancy <strong>across direct + your synced Airbnb &amp; Vrbo bookings</strong>, weekend demand, near-term pace, orphan gaps and what guests search for. These are advice: nothing changes until you tap <strong>Apply</strong>, and your prices stay exactly as set otherwise.</p>`;
    const since = sig.searches60
        ? `<p style="font-size:0.78rem;color:var(--text-muted);margin:-4px 0 16px;">Demand from ${sig.searches60} search${sig.searches60 === 1 ? '' : 'es'} in the last 60 days${sig.noResult60 ? ` · ${sig.noResult60} found nothing free` : ''}.</p>`
        : '';
    // Demand radar strip: the weeks guests actually searched for, with the
    // unmet portion flagged in amber — a glance at where interest lands.
    const radarWeeks = (sig.searchWeeks || [])
        .filter((w) => w.count > 0)
        .slice(0, 6)
        .sort((a, b) => (a.week || '').localeCompare(b.week || ''));
    const radar = radarWeeks.length
        ? `
                <div class="accounts-stat" style="max-width:640px;margin:0 0 16px;">
                    <div style="font-size:0.68rem;letter-spacing:1px;text-transform:uppercase;color:var(--text-muted);margin-bottom:10px;">Demand radar · weeks guests searched for</div>
                    <div style="display:flex;flex-wrap:wrap;gap:8px;">${radarWeeks
                        .map((w) => {
                            const wc = new Date(
                                String(w.week).replace(' ', 'T'),
                            ).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
                            const unmet = w.missed > 0;
                            return `<span style="display:inline-flex;align-items:center;gap:7px;font-size:0.78rem;padding:6px 12px;border-radius:var(--r-pill);background:var(--glass-bg);border:1px solid ${unmet ? 'rgba(255,167,38,0.4)' : 'var(--glass-border)'};" title="${w.count} search${w.count === 1 ? '' : 'es'}${unmet ? ', ' + w.missed + ' found nothing free' : ''}">w/c ${wc} · ${w.count}${unmet ? ` <span style="color:var(--warn-text);font-weight:600;">${w.missed} unmet</span>` : ''}</span>`;
                        })
                        .join('')}</div>
                </div>`
        : '';
    if (!sugg.length) {
        wrap.innerHTML =
            intro +
            since +
            radar +
            `<div class="accounts-stat" style="max-width:640px;"><p style="font-size:0.9rem;color:var(--text-light);margin:0;">Nothing to suggest right now — your pricing looks well matched to current demand. Check back as bookings and searches build up.</p></div>`;
        return;
    }
    const badge = (op) =>
        op
            ? `<span style="background:rgba(76,175,80,0.18);color:#7FD68A;font-size:0.66rem;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;border-radius:999px;padding:3px 9px;white-space:nowrap;">Opportunity</span>`
            : `<span style="background:rgba(255,255,255,0.1);color:var(--text-muted);font-size:0.66rem;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;border-radius:999px;padding:3px 9px;white-space:nowrap;">Insight</span>`;
    const card = (s) => {
        const op = s.severity === 'opportunity';
        const applyBtn = s.apply
            ? `<button class="btn-sm btn-edit" onclick="applyPricingSuggestion('${s.prop_key}','${s.apply.field}',${Number(s.apply.value)},'${s.id}')">Apply${s.apply.field === 'weekendPct' ? ' — set ' + Number(s.apply.value) + '% weekend' : ''}</button>`
            : '';
        return `<div class="accounts-stat" id="psug-${escapeHtml(s.id)}" style="max-width:640px;margin-bottom:12px;">
                    <div style="display:flex;justify-content:space-between;gap:10px;align-items:baseline;flex-wrap:wrap;">
                        <strong style="font-size:0.98rem;">${escapeHtml(s.title)}</strong>${badge(op)}
                    </div>
                    <p style="font-size:0.86rem;color:var(--text-muted);margin:8px 0 0;line-height:1.5;">${escapeHtml(s.detail)}</p>
                    ${applyBtn ? `<div style="margin-top:12px;">${applyBtn}</div>` : ''}
                </div>`;
    };
    wrap.innerHTML = intro + since + radar + sugg.map(card).join('');
}
async function applyPricingSuggestion(propKey, field, value, id) {
    if (field !== 'weekendPct' || !propKey) return;
    try {
        await updateRate(propKey, 'weekendPct', value); // existing validated save path
        const el = document.getElementById('psug-' + id);
        if (el)
            el.innerHTML = `<p style="font-size:0.92rem;color:#7FD68A;margin:0;">✓ Applied — weekend uplift set to ${Number(value)}% for ${escapeHtml((propertyMeta[propKey] || {}).name || propKey)}. Adjust any time in Cottages → ${escapeHtml((propertyMeta[propKey] || {}).name || propKey)} → Rates.</p>`;
        try {
            toast('Weekend pricing updated.');
        } catch (e) {}
    } catch (e) {
        glassAlert("Couldn't apply: " + e.message);
    }
}

// ---- Settings → Website content (form-based editor for the global homepage /
// nav text + images that used to be edited inline via edit-mode). Reads each
// field's CURRENT value straight off the live element, saves via saveContent,
// and updates the page immediately. Per-cottage text/photos live under
// Preferences → [cottage]; this excludes the cottage-template fields. ----
const CONTENT_LABELS = {
    'site-logo': 'Site name',
    'hero-title': 'Hero heading',
    'hero-sub': 'Hero subheading',
    'hero-btn': 'Hero button',
    'hero-bg': 'Hero background image',
    'card1-title': 'Cottage 1 — card title',
    'card1-meta': 'Cottage 1 — card subtitle',
    'card1-img': 'Cottage 1 — card photo',
    'card2-title': 'Cottage 2 — card title',
    'card2-meta': 'Cottage 2 — card subtitle',
    'card2-img': 'Cottage 2 — card photo',
    'card3-title': 'Cottage 3 — card title',
    'card3-meta': 'Cottage 3 — card subtitle',
    'card3-img': 'Cottage 3 — card photo',
    'nav-home': 'Menu: Home',
    'nav-cottages': 'Menu: Cottages',
    'nav-book': 'Menu: Book',
    'mnav-home': 'Mobile menu: Home',
    'mnav-cottages': 'Mobile menu: Cottages',
    'mnav-book': 'Mobile menu: Book',
    'amenities-title': 'Amenities heading',
    'terms-title': 'Terms heading',
    'cal-add-btn': 'Calendar “add” button',
};
function contentBgUrl(el) {
    const m = (el.style.backgroundImage || '').match(/url\(["']?([^"')]+)["']?\)/);
    return m ? m[1] : '';
}
function loadContentEditor() {
    const wrap = document.getElementById('content-editor');
    if (!wrap) return;
    // Per-cottage fields live under Preferences → [cottage]: the cottage detail
    // template (#view-21a) AND the home-page cards (card1/2/3 → each cottage's
    // own "Website content" folder). This page keeps only the site-wide bits.
    const skip = (el) =>
        !!el.closest('#view-21a') ||
        /^card[123]-(img|title|meta)$/.test(
            el.getAttribute('data-edit-text') || el.getAttribute('data-edit-img') || '',
        );
    const imgs = [...document.querySelectorAll('[data-edit-img]')].filter((el) => !skip(el));
    const texts = [...document.querySelectorAll('[data-edit-text]')].filter((el) => !skip(el));
    const seen = new Set();
    const label = (k) => CONTENT_LABELS[k] || k;
    let html =
        '<p style="font-size:0.85rem;color:var(--text-muted);max-width:640px;margin:0 0 18px;">The site-wide wording &amp; images: the hero banner, menu labels and site name. Each cottage’s own home-page card, photos &amp; text are under Preferences → the cottage.</p>';
    if (imgs.length) {
        html +=
            '<h3 style="font-family:var(--font-serif);font-size:1.15rem;margin:0 0 12px;">Images</h3>';
        imgs.forEach((el) => {
            const k = el.getAttribute('data-edit-img');
            if (seen.has(k)) return;
            seen.add(k);
            html +=
                `<div class="content-edit-row"><div class="exp-edit-thumb" id="ce-thumb-${k}" style="background-image:url('${escapeHtml(contentBgUrl(el))}');"></div>` +
                `<div style="flex:1;min-width:0;"><div class="modal-label" style="margin:0 0 6px;">${escapeHtml(label(k))}</div>` +
                `<button class="btn-sm btn-edit" onclick="contentEditImage('${k}')">Replace image</button></div></div>`;
        });
    }
    html +=
        '<h3 style="font-family:var(--font-serif);font-size:1.15rem;margin:22px 0 12px;">Text</h3>';
    texts.forEach((el) => {
        const k = el.getAttribute('data-edit-text');
        if (seen.has(k)) return;
        seen.add(k);
        const val = (el.textContent || '').trim();
        const field =
            val.length > 60
                ? `<textarea class="input-glass" id="ce-${k}" rows="2" style="resize:vertical;">${escapeHtml(val)}</textarea>`
                : `<input type="text" class="input-glass" id="ce-${k}" value="${escapeHtml(val)}">`;
        html +=
            `<div style="margin-bottom:14px;max-width:640px;"><label class="modal-label" for="ce-${k}">${escapeHtml(label(k))}</label>${field}` +
            `<button class="btn-sm btn-edit" style="margin-top:6px;" onclick="contentEditSave('${k}')">Save</button></div>`;
    });
    wrap.innerHTML = html;
}
function contentEditSave(key) {
    const el = document.getElementById('ce-' + key);
    if (!el) return;
    const val = el.value;
    saveContent(key, val);
    siteContent[key] = val;
    document.querySelectorAll('[data-edit-text="' + key + '"]').forEach((t) => {
        t.textContent = val;
    });
    el.style.borderColor = '#4CAF50';
    setTimeout(() => {
        el.style.borderColor = '';
    }, 1200);
}
function contentEditImage(key) {
    pickAndUpload('content-' + key, async (url) => {
        await saveContent(key, url);
        siteContent[key] = url;
        document.querySelectorAll('[data-edit-img="' + key + '"]').forEach((t) => {
            t.style.backgroundImage = `url('${url}')`;
        });
        const th = document.getElementById('ce-thumb-' + key);
        if (th) th.style.backgroundImage = `url('${url}')`;
    });
}
// ---- Settings → API keys ----
function renderApis() {
    const el = document.getElementById('apikey-tides-input');
    if (el) el.value = (adminPrivateContent && adminPrivateContent['apikey-tides']) || '';
    const msg = document.getElementById('apikey-tides-msg');
    if (msg) msg.textContent = '';
}
async function saveApiKey(which) {
    if (which !== 'tides') return;
    const el = document.getElementById('apikey-tides-input');
    const msg = document.getElementById('apikey-tides-msg');
    const val = ((el && el.value) || '').trim();
    try {
        await apiPost('content.php', { action: 'set', key: 'apikey-tides', value: val });
        if (adminPrivateContent) adminPrivateContent['apikey-tides'] = val;
        __tideData = null; // re-fetch with the new key next time
        if (msg) {
            msg.style.color = '#4CAF50';
            msg.textContent = val ? 'Saved ✓' : 'Cleared — tide widget hidden.';
        }
    } catch (e) {
        if (msg) {
            msg.style.color = '#E57373';
            msg.textContent = "Couldn't save: " + e.message;
        }
    }
}
function fillHostFields() {
    const setv = (id, key) => {
        const e = document.getElementById(id);
        if (e) e.value = hostVal(key);
    };
    setv('host-f-name', 'host-name');
    setv('host-f-badge', 'host-badge');
    setv('host-f-years', 'host-years');
    setv('host-f-school', 'host-school');
    setv('host-f-work', 'host-work');
    setv('host-f-bio', 'host-bio');
    const photo = document.getElementById('host-edit-photo');
    if (photo)
        photo.style.backgroundImage = hostVal('host-photo')
            ? `url('${hostVal('host-photo')}')`
            : '';
    // Contact number now lives inside the Profile folder.
    const cp = siteContent['contact-phone'] || {};
    const dEl = document.getElementById('contact-phone-dial');
    const sEl = document.getElementById('contact-phone-display');
    if (dEl) dEl.value = cp.dial || '';
    if (sEl) sEl.value = cp.display || '';
}
// A small "row that drills into a cottage" list for accom + calendar sections.
function cottageRowsHtml(onclickFn) {
    return Object.keys(propertyMeta)
        .map(
            (k) =>
                `<button class="settings-row" onclick="${onclickFn}('${k}')">
                    <span class="settings-row-ic"><span class="legend-swatch swatch-${k}" style="width:16px;height:16px;border-radius:5px;"></span></span>
                    <span class="settings-row-main"><span class="settings-row-label">${escapeHtml(propertyMeta[k].name)}</span></span><span class="settings-row-chev">›</span>
                </button>`,
        )
        .join('');
}
async function renderAccomList() {
    const list = document.getElementById('accom-list');
    const detail = document.getElementById('accom-detail');
    if (detail) {
        detail.style.display = 'none';
        detail.innerHTML = '';
    }
    settingsBackTarget = () => settingsShowIndex();
    const title = document.getElementById('settings-panel-title');
    if (title) title.textContent = SETTINGS_TITLES.accom;
    if (!list) return;
    list.style.display = '';
    const emptyHint = Object.keys(propertyMeta).length
        ? ''
        : '<p style="font-size:0.85rem;color:var(--text-muted);max-width:640px;margin:0 0 10px;">No cottages yet — tap “Add accommodation” below to create your first one.</p>';
    list.innerHTML =
        emptyHint +
        `<div class="settings-group">${cottageRowsHtml('settingsOpenAccom')}</div>${accomAddRowHtml()}`;
    // Add a current-month occupancy donut to each cottage (load bookings if needed).
    try {
        if (!Object.keys(dbBookings).some((k) => (dbBookings[k] || []).length)) await loadData();
        const occ = cottageMonthOccupancy();
        list.innerHTML =
            emptyHint +
            `<div class="settings-group">${Object.keys(propertyMeta)
                .map((k) => {
                    const arch = propertyMeta[k] && propertyMeta[k].archived;
                    const o = occ[k] || { pct: 0, nights: 0, total: 0 };
                    const sub = arch
                        ? 'Hidden from your website (tap to bring back)'
                        : `${o.pct}% booked this month · ${o.nights}/${o.total} nights`;
                    return `
                    <button class="settings-row" onclick="settingsOpenAccom('${k}')" ${arch ? 'style="opacity:0.55;"' : ''}>
                        <span class="settings-row-ic"><span class="legend-swatch swatch-${k}" style="width:16px;height:16px;border-radius:5px;"></span></span>
                        <span class="settings-row-main"><span class="settings-row-label">${escapeHtml(propertyMeta[k].name)}${arch ? ' <span style="font-size:0.7rem;color:var(--text-muted);font-weight:600;">· removed</span>' : ''}</span><span class="settings-row-sub">${sub}</span></span>
                        ${arch ? '<span class="settings-row-chev" style="margin-left:10px;">›</span>' : osMiniDonut(o.pct, 'var(--prop-' + k + ')') + '<span class="settings-row-chev" style="margin-left:10px;">›</span>'}
                    </button>`;
                })
                .join('')}</div>${accomAddRowHtml()}`;
    } catch (e) {
        /* keep the plain list if booking data isn't available */
    }
}
// The "Add accommodation" action shown under the cottage list in Preferences.
function accomAddRowHtml() {
    return `<div class="settings-group" style="margin-top:14px;">
                <button class="settings-row" onclick="addAccommodationPrompt()">
                    <span class="settings-row-ic"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></span>
                    <span class="settings-row-main"><span class="settings-row-label">Add accommodation</span><span class="settings-row-sub">Create a new cottage, then fill in its details</span></span><span class="settings-row-chev">›</span>
                </button>
            </div>`;
}
// "Create then fill in": just a name + nightly couple rate. The server
// generates the key/slug/accent; everything else is completed afterwards in
// the new cottage's Preferences folders. All booking/payment logic works for
// it immediately because it's a real properties row.
async function addAccommodationPrompt() {
    const name = await glassPrompt('Name of the new accommodation', '');
    if (name == null) return;
    if (!String(name).trim()) {
        glassAlert('Please enter a name.');
        return;
    }
    const rateStr = await glassPrompt(
        `Nightly price for a couple at "${String(name).trim()}" (£)`,
        '',
    );
    if (rateStr == null) return;
    const rate = parseFloat(rateStr);
    if (!(rate > 0)) {
        glassAlert('Please enter a nightly couple rate above £0.');
        return;
    }
    try {
        const res = await apiPost('rates.php', {
            action: 'create',
            name: String(name).trim(),
            couple_rate: rate,
        });
        await loadRates();
        await renderAccomList();
        if (res && res.prop_key) settingsOpenAccom(res.prop_key); // drop straight into "fill in"
        toast(`Added "${String(name).trim()}" — now add its photos & details.`);
    } catch (e) {
        glassAlert("Couldn't add the accommodation: " + (e && e.message ? e.message : e));
    }
}
async function archiveAccommodation(k) {
    const name = (propertyMeta[k] && propertyMeta[k].name) || k;
    const ok = await glassConfirm(
        `Remove "${name}" from the site?\n\nIt’s hidden from guests and new bookings, but its past bookings, payments and history are kept — you can restore it any time.`,
    );
    if (!ok) return;
    try {
        await apiPost('rates.php', { action: 'archive', prop_key: k });
        await loadRates();
        await renderAccomList();
        toast(`"${name}" is now hidden from your website. You can bring it back anytime.`);
    } catch (e) {
        glassAlert("Couldn't remove it: " + (e && e.message ? e.message : e));
    }
}
async function restoreAccommodation(k) {
    const name = (propertyMeta[k] && propertyMeta[k].name) || k;
    try {
        await apiPost('rates.php', { action: 'unarchive', prop_key: k });
        await loadRates();
        await renderAccomList();
        toast(`"${name}" restored — live on the site again.`);
    } catch (e) {
        glassAlert("Couldn't restore it: " + (e && e.message ? e.message : e));
    }
}
// Each cottage's Preferences open as a sub-index of subfolders; each row drills
// into just that part (rates, house rules, safety, …) — see settingsOpenAccomSec.
const ACCOM_SECTIONS = [
    {
        id: 'rates',
        label: 'Rates & fees',
        sub: 'Nightly prices, deposit &amp; fee',
        ic: '<path d="M2 6h20v12H2z"/><circle cx="12" cy="12" r="2.5"/><path d="M6 9v6M18 9v6"/>',
    },
    {
        id: 'photos',
        label: 'Photos',
        sub: 'Gallery images for this cottage',
        ic: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><circle cx="9" cy="11" r="2"/><path d="M21 17l-5-5-4 4-2-2-4 4"/>',
    },
    {
        id: 'text',
        label: 'Text & details',
        sub: 'Title, description &amp; features',
        ic: '<path d="M4 6h16M4 12h16M4 18h10"/>',
    },
    {
        id: 'web',
        label: 'Home page card',
        sub: 'How this cottage appears on the home page',
        ic: '<rect x="3" y="4.5" width="18" height="15" rx="2"/><path d="M3 9h18"/><circle cx="6" cy="6.7" r="0.7" fill="currentColor" stroke="none"/>',
    },
    {
        id: 'house',
        label: 'House rules',
        sub: 'Check-in/out times, minimum nights &amp; which days guests can arrive',
        ic: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5 10v10h14V10"/>',
    },
    {
        id: 'safety',
        label: 'Safety &amp; property',
        sub: 'Safety features guests see (alarms, first aid, etc.)',
        ic: '<path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z"/>',
    },
    {
        id: 'seasons',
        label: 'Seasonal rates',
        sub: 'Set different prices for summer, holidays, etc.',
        ic: '<rect x="3" y="4.5" width="18" height="16" rx="2.5"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/>',
    },
    {
        id: 'arrival',
        label: 'Arrival info',
        sub: 'Email sent to guests a few days before they arrive',
        ic: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M4 6.5l8 6 8-6"/>',
    },
    {
        id: 'location',
        label: 'Location',
        sub: 'Address &amp; where guests find the key',
        ic: '<path d="M12 21s-7-5.2-7-11a7 7 0 0 1 14 0c0 5.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>',
    },
    {
        id: 'local',
        label: 'Local guide',
        sub: 'Notes about your area — parking, accessibility, nature',
        ic: '<circle cx="12" cy="12" r="9"/><path d="M15 9l-4.2 1.8L9 15l4.2-1.8z"/>',
    },
    {
        id: 'faq',
        label: 'Questions &amp; answers',
        sub: 'Common questions guests see when booking',
        ic: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><circle cx="12" cy="7.8" r="0.7" fill="currentColor" stroke="none"/>',
    },
    {
        id: 'welcome',
        label: 'Welcome book',
        sub: 'In-stay guide: Wi-Fi, appliances, bins, tips',
        ic: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H19v15H6.5A2.5 2.5 0 0 0 4 20.5z"/><path d="M4 5.5V20.5"/>',
    },
];
function settingsOpenAccom(k) {
    const list = document.getElementById('accom-list');
    const detail = document.getElementById('accom-detail');
    if (list) list.style.display = 'none';
    if (detail) {
        detail.style.display = '';
        const arch = propertyMeta[k] && propertyMeta[k].archived;
        const removeRow = arch
            ? `<div class="settings-group" style="margin-top:14px;">
                        <button class="settings-row" onclick="restoreAccommodation('${k}')">
                            <span class="settings-row-ic"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg></span>
                            <span class="settings-row-main"><span class="settings-row-label">Restore to the site</span><span class="settings-row-sub">This cottage is currently removed (hidden)</span></span><span class="settings-row-chev">›</span>
                        </button>
                    </div>`
            : `<div class="settings-group" style="margin-top:14px;">
                        <button class="settings-row" onclick="archiveAccommodation('${k}')">
                            <span class="settings-row-ic" style="color:#E57373;"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg></span>
                            <span class="settings-row-main"><span class="settings-row-label" style="color:#E57373;">Remove this accommodation</span><span class="settings-row-sub">Hides it from the site — bookings &amp; history are kept, and you can restore it</span></span><span class="settings-row-chev">›</span>
                        </button>
                    </div>`;
        detail.innerHTML = `<div class="settings-group">${ACCOM_SECTIONS.map(
            (s) =>
                `<button class="settings-row" onclick="settingsOpenAccomSec('${k}','${s.id}')">
                        <span class="settings-row-ic"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${s.ic}</svg></span>
                        <span class="settings-row-main"><span class="settings-row-label">${s.label}</span><span class="settings-row-sub">${s.sub}</span></span><span class="settings-row-chev">›</span>
                    </button>`,
        ).join('')}</div>${removeRow}`;
    }
    const title = document.getElementById('settings-panel-title');
    if (title) title.textContent = propertyMeta[k] ? propertyMeta[k].name : k;
    settingsBackTarget = () => settingsOpen('accom');
    __settingsPath = { section: 'accom', prop: k };
    window.scrollTo({ top: 0, behavior: 'smooth' });
}
function settingsOpenAccomSec(k, sec) {
    const detail = document.getElementById('accom-detail');
    if (detail) {
        detail.style.display = '';
        detail.innerHTML = `<div class="rate-prop">${accomSectionHtml(k, sec)}</div>`;
    }
    const meta = ACCOM_SECTIONS.find((s) => s.id === sec);
    const name = propertyMeta[k] ? propertyMeta[k].name : k;
    const title = document.getElementById('settings-panel-title');
    if (title)
        title.innerHTML = `${escapeHtml(name)} <span style="color:var(--text-muted);">·</span> ${meta ? meta.label : ''}`;
    settingsBackTarget = () => settingsOpenAccom(k);
    __settingsPath = { section: 'accom', prop: k, accomSec: sec };
    window.scrollTo({ top: 0, behavior: 'smooth' });
}
function renderCalendarList() {
    const list = document.getElementById('calendar-list');
    const detail = document.getElementById('calendar-detail');
    if (detail) {
        detail.style.display = 'none';
        detail.innerHTML = '';
    }
    if (list) {
        list.style.display = '';
        list.innerHTML = `<div class="settings-group">${cottageRowsHtml('settingsOpenCalendar')}</div>`;
    }
    settingsBackTarget = () => settingsShowIndex();
    const title = document.getElementById('settings-panel-title');
    if (title) title.textContent = SETTINGS_TITLES.calendar;
}
async function settingsOpenCalendar(k) {
    const list = document.getElementById('calendar-list');
    const detail = document.getElementById('calendar-detail');
    if (list) list.style.display = 'none';
    if (detail) {
        detail.style.display = '';
        detail.innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem;">Loading…</p>';
    }
    const title = document.getElementById('settings-panel-title');
    if (title) title.textContent = propertyMeta[k] ? propertyMeta[k].name : k;
    settingsBackTarget = () => settingsOpen('calendar');
    __settingsPath = { section: 'calendar', prop: k };
    await loadCalendarSyncProp(k);
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ---- Cancellation policy (Settings folder → per-cottage picker) ----
// The three guest-facing policies. The chosen one per cottage drives the
// "Cancellation policy" text on that cottage's page.
const CANCELLATION_POLICIES = {
    flexible: {
        name: 'Flexible',
        points: [
            'Full refund at least 1 day before check-in',
            'Partial refund within 1 day of check-in',
        ],
    },
    moderate: {
        name: 'Moderate',
        points: [
            'Full refund at least 5 days before check-in',
            'Partial refund within 5 days of check-in',
        ],
    },
    limited: {
        name: 'Limited',
        points: [
            'Full refund at least 14 days before check-in',
            'Partial refund 7–14 days before check-in',
        ],
    },
};
const DEFAULT_CANCEL_POLICY = 'flexible';
// The policy key chosen for a cottage (falls back to the default).
function cancelPolicyOf(propKey) {
    const v = siteContent[`${propKey}-cancellation-policy`];
    return CANCELLATION_POLICIES[v] ? v : DEFAULT_CANCEL_POLICY;
}
// Render the cottage page's cancellation text from the chosen policy.
function applyCancellationText(propKey) {
    const el = document.getElementById('prop-cancellation');
    if (!el) return;
    const pol = CANCELLATION_POLICIES[cancelPolicyOf(propKey)];
    el.innerHTML = `<strong>${pol.name}.</strong> ${pol.points.map((p) => escapeHtml(p)).join('. ')}.`;
}
// Settings: list of cottages → each drills into its policy picker.
function cancelRowsHtml() {
    return Object.keys(propertyMeta)
        .map((k) => {
            const pol = CANCELLATION_POLICIES[cancelPolicyOf(k)];
            return `<button class="settings-row" onclick="settingsOpenCancel('${k}')">
                    <span class="settings-row-ic"><span class="legend-swatch swatch-${k}" style="width:16px;height:16px;border-radius:5px;"></span></span>
                    <span class="settings-row-main"><span class="settings-row-label">${escapeHtml(propertyMeta[k].name)}</span><span class="settings-row-sub">${pol.name}</span></span><span class="settings-row-chev">›</span>
                </button>`;
        })
        .join('');
}
function renderCancelList() {
    const list = document.getElementById('cancel-list');
    const detail = document.getElementById('cancel-detail');
    if (detail) {
        detail.style.display = 'none';
        detail.innerHTML = '';
    }
    if (list) {
        list.style.display = '';
        list.innerHTML = `<div class="settings-group">${cancelRowsHtml()}</div>`;
    }
    settingsBackTarget = () => settingsShowIndex();
    const title = document.getElementById('settings-panel-title');
    if (title) title.textContent = SETTINGS_TITLES.cancel;
}
// The three selectable policy cards for one cottage (selected one highlighted).
function cancelPickerHtml(propKey) {
    const cur = cancelPolicyOf(propKey);
    const cards = Object.keys(CANCELLATION_POLICIES)
        .map((pk) => {
            const p = CANCELLATION_POLICIES[pk];
            const sel = pk === cur;
            return `<button type="button" class="cancel-card${sel ? ' selected' : ''}" role="radio" aria-checked="${sel}" onclick="setCancelPolicy('${propKey}','${pk}')">
                    <span class="cancel-card-check" aria-hidden="true"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7"/></svg></span>
                    <span class="cancel-card-name">${p.name}</span>
                    <ul class="cancel-card-points">${p.points.map((pt) => `<li>${escapeHtml(pt)}</li>`).join('')}</ul>
                </button>`;
        })
        .join('');
    return `<p style="font-size:0.85rem;color:var(--text-muted);max-width:560px;margin:0 0 16px;">Choose the cancellation policy guests see on the <strong>${escapeHtml(propertyMeta[propKey].name)}</strong> page.</p><div class="cancel-cards" role="radiogroup" aria-label="Cancellation policy">${cards}</div>`;
}
function settingsOpenCancel(propKey) {
    const list = document.getElementById('cancel-list');
    const detail = document.getElementById('cancel-detail');
    if (list) list.style.display = 'none';
    if (detail) {
        detail.style.display = '';
        detail.innerHTML = cancelPickerHtml(propKey);
    }
    const title = document.getElementById('settings-panel-title');
    if (title) title.textContent = propertyMeta[propKey] ? propertyMeta[propKey].name : propKey;
    settingsBackTarget = () => settingsOpen('cancel');
    __settingsPath = { section: 'cancel', prop: propKey };
    window.scrollTo({ top: 0, behavior: 'smooth' });
}
// Save a cottage's chosen policy, refresh the picker highlight + live cottage text.
function setCancelPolicy(propKey, polKey) {
    if (!CANCELLATION_POLICIES[polKey]) return;
    siteContent[`${propKey}-cancellation-policy`] = polKey;
    try {
        localStorage.setItem(`${propKey}-cancellation-policy`, polKey);
    } catch (e) {}
    saveContent(`${propKey}-cancellation-policy`, polKey);
    const detail = document.getElementById('cancel-detail');
    if (detail) detail.innerHTML = cancelPickerHtml(propKey);
    // If that cottage page is currently shown, update its text live.
    if (activeFrontProperty === propKey) applyCancellationText(propKey);
    toast(`${propertyMeta[propKey].name}: ${CANCELLATION_POLICIES[polKey].name} policy saved.`);
}

// Reviews moderation now lives as a folder inside Settings.
async function openReviews() {
    openSettings('reviews');
}

// Change the admin password (must be logged in). Verifies the current
// password, then requires the new one entered twice.
// ---- Owner tool: Calendar Sync (iCal import/export) ----
// Cottages to offer iCal sync for — derived from the live list so owner-added
// cottages appear automatically (was a hardcoded three).
function syncProps() {
    return liveCottageKeys().map((k) => [k, (propertyMeta[k] || {}).name || k]);
}
// The Airbnb/Vrbo sync box markup for ONE cottage.
function calendarPropBoxHtml(key, label, data) {
    const feeds = data.feeds || [];
    const airbnb = feeds.find((f) => f.source === 'airbnb');
    const vrbo = feeds.find((f) => f.source === 'vrbo');
    return `<div style="border:1px solid var(--glass-border);border-radius:12px;padding:16px;">
                    <div style="font-size:0.75rem;text-transform:uppercase;letter-spacing:1px;color:var(--text-muted);margin-bottom:4px;">Export — paste this into Airbnb &amp; Vrbo</div>
                    <input class="input-glass" readonly onclick="this.select()" value="${escapeHtml(data.export_url || '')}" style="font-size:0.8rem;margin-bottom:14px;">
                    <div style="font-size:0.75rem;text-transform:uppercase;letter-spacing:1px;color:var(--text-muted);margin-bottom:4px;">Import — paste the platform calendar links here</div>
                    <input class="input-glass" id="sync-airbnb-${key}" onblur="saveSyncFeeds('${key}', true)" placeholder="Airbnb iCal link (https://www.airbnb.com/calendar/ical/...)" value="${escapeHtml(airbnb ? airbnb.url : '')}" style="font-size:0.8rem;margin-bottom:8px;">
                    <input class="input-glass" id="sync-vrbo-${key}" onblur="saveSyncFeeds('${key}', true)" placeholder="Vrbo iCal link (http://www.vrbo.com/icalendar/...)" value="${escapeHtml(vrbo ? vrbo.url : '')}" style="font-size:0.8rem;margin-bottom:10px;">
                    <button class="btn-sm btn-edit" onclick="saveSyncFeeds('${key}')">Save links</button>
                    <button class="btn-sm btn-edit" onclick="runSync('${key}')">Sync now</button>
                    <span style="font-size:0.8rem;color:var(--text-muted);margin-left:8px;">${data.blocks || 0} imported blocked range${data.blocks === 1 ? '' : 's'}</span>
                    <div style="font-size:0.72rem;color:var(--text-muted);margin-top:8px;">Links save automatically as you type, and are kept on the server — they stay put across devices and logins.</div>
                </div>`;
}
// Load + render one cottage's sync box into #calendar-detail (Settings).
async function loadCalendarSyncProp(key) {
    const box = document.getElementById('calendar-detail');
    if (!box) return;
    const label = (propertyMeta[key] || {}).name || key;
    let data;
    try {
        data = await apiPost('ical-import.php', { action: 'list', prop: key });
    } catch (e) {
        box.innerHTML = `<p style="color:#E53935;">${escapeHtml(e.message)}</p>`;
        return;
    }
    box.innerHTML = calendarPropBoxHtml(key, label, data);
}
// Legacy: render all cottages stacked into #calendar-sync-box (if present).
async function loadCalendarSync() {
    if (!isAuthenticated) {
        tryAccessBackOffice();
        return;
    }
    const box = document.getElementById('calendar-sync-box');
    if (!box) return;
    box.innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem;">Loading…</p>';
    let html = '';
    for (const [key, label] of syncProps()) {
        let data;
        try {
            data = await apiPost('ical-import.php', { action: 'list', prop: key });
        } catch (e) {
            html += `<p style="color:#E53935;">${label}: ${escapeHtml(e.message)}</p>`;
            continue;
        }
        html += `<div style="margin-bottom:14px;"><div style="font-family:var(--font-serif);font-size:1.1rem;margin-bottom:10px;">${label}</div>${calendarPropBoxHtml(key, label, data)}</div>`;
    }
    box.innerHTML = html;
}
// Persist the Airbnb/Vrbo links for a property. Called on blur (quiet) and
// by the explicit "Save links" button (with a confirmation). quiet=true
// suppresses the popup so auto-save isn't intrusive.
async function saveSyncFeeds(key, quiet) {
    const a = document.getElementById('sync-airbnb-' + key);
    const v = document.getElementById('sync-vrbo-' + key);
    if (!a || !v) return;
    const feeds = [
        { source: 'airbnb', url: (a.value || '').trim() },
        { source: 'vrbo', url: (v.value || '').trim() },
    ];
    try {
        await apiPost('ical-import.php', { action: 'save_feeds', prop: key, feeds });
        if (!quiet) toast('Calendar links saved.');
    } catch (e) {
        if (!quiet) glassAlert("Couldn't save: " + e.message);
    }
}
async function runSync(key) {
    try {
        await saveSyncFeeds(key, true); // persist whatever's in the boxes first, so links can't be lost
        const res = await apiPost('ical-import.php', { action: 'sync', prop: key });
        try {
            localStorage.setItem(ICAL_LAST_SYNC_KEY, String(Date.now()));
        } catch (e) {}
        let msg = 'Sync complete.';
        if (res.result && Array.isArray(res.result)) {
            msg +=
                '\n\n' +
                res.result
                    .map((r) =>
                        r.ok
                            ? `${r.source}: brought in ${r.events} set(s) of booked dates`
                            : `${r.source}: failed (${r.error})`,
                    )
                    .join('\n');
        }
        toast(msg);
        // Refresh whichever calendar view is showing.
        if (
            document.getElementById('calendar-detail') &&
            document.getElementById('calendar-detail').style.display !== 'none'
        )
            loadCalendarSyncProp(key);
        else loadCalendarSync();
    } catch (e) {
        glassAlert('Sync failed: ' + e.message);
    }
}

// ---- Owner tool: view guest accounts & reset a password ----
async function loadGuestList() {
    if (!isAuthenticated) {
        tryAccessBackOffice();
        return;
    }
    const box = document.getElementById('guest-admin-list');
    box.innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem;">Loading…</p>';
    let res;
    try {
        res = await apiPost('auth.php', { action: 'guest_list' });
    } catch (e) {
        box.innerHTML = `<p style="color:#E53935;font-size:0.85rem;">Couldn't load guests: ${escapeHtml(e.message)}</p>`;
        return;
    }
    const guests = res.guests || [];
    if (guests.length === 0) {
        box.innerHTML =
            '<p style="color:var(--text-muted);font-size:0.85rem;">No guest accounts yet.</p>';
        return;
    }
    box.innerHTML = `
                <table class="accounts-table">
                    <thead><tr><th>Name</th><th>Email</th><th>Joined</th><th></th></tr></thead>
                    <tbody>
                        ${guests
                            .map(
                                (g) => `<tr>
                            <td>${escapeHtml(g.name || '')}</td>
                            <td>${escapeHtml(g.email || '')}</td>
                            <td>${(g.created_at || '').split(' ')[0] || '—'}</td>
                            <td class="num"><button class="btn-sm btn-edit" data-email="${escapeHtml(g.email || '')}" onclick="resetGuestPassword(this)">Reset password</button></td>
                        </tr>`,
                            )
                            .join('')}
                    </tbody>
                </table>`;
}

async function resetGuestPassword(email) {
    // Accept the clicked button (email on its data-email) or a raw string — reading
    // from the attribute avoids interpolating an apostrophe email into the onclick.
    if (email && email.dataset) email = email.dataset.email || '';
    if (!isAuthenticated) {
        tryAccessBackOffice();
        return;
    }
    const next = await glassPrompt(
        `Set a NEW password for ${email}\n\n(at least 4 characters — you'll tell the guest this):`,
        '',
        { password: true },
    );
    if (next === null) return;
    if (next.trim().length < 4) {
        glassAlert('Password must be at least 4 characters.');
        return;
    }
    try {
        await apiPost('auth.php', { action: 'guest_reset_password', email, next });
        glassAlert(
            `Password reset for ${email}.\n\nGive them the new password and ask them to log in and change it.`,
        );
    } catch (e) {
        glassAlert("Couldn't reset password: " + e.message);
    }
}

async function changeAdminPassword() {
    if (!isAuthenticated) {
        tryAccessBackOffice();
        return;
    }
    const current = await glassPrompt('Enter your CURRENT admin password:', '', { password: true });
    if (current === null) return;
    const next = await glassPrompt('Enter a NEW password (at least 4 characters):', '', {
        password: true,
    });
    if (next === null) return;
    if (next.trim().length < 4) {
        glassAlert('Password must be at least 4 characters.');
        return;
    }
    const confirmNext = await glassPrompt('Re-enter the NEW password to confirm:', '', {
        password: true,
    });
    if (confirmNext === null) return;
    if (confirmNext !== next) {
        glassAlert("The new passwords don't match. Nothing was changed.");
        return;
    }
    try {
        await apiPost('auth.php', { action: 'admin_change_password', current, next });
        toast('Admin password updated.');
    } catch (e) {
        glassAlert("Couldn't change password: " + e.message);
    }
}

// ===================================================================
//  ACCOUNTS — financial reporting by UK tax year (6 Apr – 5 Apr)
// ===================================================================
// Returns the tax-year start year for a YYYY-MM-DD date.
// e.g. 2026-03-30 -> 2025 (in the 2025/26 year); 2026-04-06 -> 2026.
function taxYearStartOf(dateStr) {
    if (!dateStr) return null;
    const [y, m, d] = dateStr.split('-').map(Number);
    // Before 6 April => previous tax year
    if (m < 4 || (m === 4 && d < 6)) return y - 1;
    return y;
}
function taxYearLabel(startYear) {
    return `6 Apr ${startYear} – 5 Apr ${startYear + 1}`;
}
function taxYearShort(startYear) {
    return `${startYear}/${String(startYear + 1).slice(-2)}`;
}

// Every recorded payment as a flat list: {propKey, booking, amount, date, method, taxYear}
function paymentRecords() {
    const records = [];
    Object.keys(dbBookings).forEach((propKey) => {
        (dbBookings[propKey] || []).forEach((b) => {
            const amount = Math.max(0, Number(b.depositPaid) || 0);
            if (amount <= 0) return; // only money actually received
            const date = b.paymentDate || '';
            records.push({
                propKey,
                booking: b,
                amount,
                date,
                method: b.paymentMethod || '',
                taxYear: taxYearStartOf(date),
            });
        });
    });
    return records;
}

let accountsReport = null; // cache of the last fetched report (for CSV export)

async function openAccounts() {
    if (!isAuthenticated) {
        tryAccessBackOffice();
        return;
    }
    // Fetch available tax years from the backend
    let years = [];
    try {
        const res = await apiGet('accounts.php');
        years = res.years || [];
    } catch (e) {
        glassAlert("Couldn't load accounts: " + e.message);
        return;
    }
    if (years.length === 0) years = [taxYearStartOf(todayDashed())];
    const sel = document.getElementById('accounts-year');
    sel.innerHTML = years
        .map((y) => `<option value="${y}">${taxYearShort(y)}  (${taxYearLabel(y)})</option>`)
        .join('');
    nav('view-accounts');
    adminHistPush('view-accounts');
    // Ensure booking data is loaded (the owner may land here without opening the
    // back office first), then render the payments manager + income report.
    try {
        if (!Object.keys(dbBookings).some((k) => (dbBookings[k] || []).length)) await loadData();
    } catch (e) {}
    try {
        await loadDepositReturns();
    } catch (e) {}
    try {
        renderDepositsDue();
    } catch (e) {}
    try {
        renderMoneyPanel();
    } catch (e) {}
    try {
        renderMoneyForecast();
    } catch (e) {}
    try {
        renderMoneyFeed();
    } catch (e) {}
    try {
        await loadExpenses();
    } catch (e) {}
    await renderAccounts();
    try {
        renderMoneyOverview();
    } catch (e) {}
    accountsShowIndex();
}

// ---- Money router: Apple-style index → drill-down sub-pages (mirrors Settings) ----
const ACCOUNTS_TITLES = {
    payments: 'Payments & balances',
    recent: 'Recent payments',
    income: 'Income & tax',
    expenses: 'Expenses',
};
let allExpenses = []; // cached expense rows (client buckets by tax year)
async function loadExpenses() {
    try {
        const r = await apiGet('expenses.php');
        allExpenses = Array.isArray(r.expenses) ? r.expenses : [];
    } catch (e) {
        allExpenses = [];
    }
}
function expensesForYear(startYear) {
    return allExpenses.filter((x) => taxYearStartOf(x.date) === startYear);
}
let __accountsSection = null; // which Money sub-page is open (for auto-update restore)
function accountsShowIndex() {
    __accountsSection = null;
    const idx = document.getElementById('accounts-index');
    const panel = document.getElementById('accounts-panel');
    if (panel) panel.style.display = 'none';
    if (idx) idx.style.display = '';
    try {
        renderMoneyOverview();
    } catch (e) {}
    window.scrollTo({ top: 0, behavior: 'smooth' });
}
function accountsOpen(section) {
    adminHistPush('view-accounts', section);
    __accountsSection = section || null;
    const idx = document.getElementById('accounts-index');
    const panel = document.getElementById('accounts-panel');
    if (!panel) return;
    if (idx) idx.style.display = 'none';
    panel.style.display = '';
    panel.querySelectorAll('.accounts-sec').forEach((s) => (s.style.display = 'none'));
    const sec = document.getElementById('asec-' + section);
    if (sec) sec.style.display = '';
    const title = document.getElementById('accounts-panel-title');
    if (title) title.textContent = ACCOUNTS_TITLES[section] || 'Money';
    // Refresh the section's data so it's current each time it's opened.
    try {
        if (section === 'payments') {
            renderDepositsDue();
            renderMoneyPanel();
        } else if (section === 'recent') {
            renderMoneyFeed();
        } else if (section === 'income') {
            renderMoneyForecast();
            renderAccounts();
        } else if (section === 'expenses') {
            renderExpenses();
        }
    } catch (e) {}
    window.scrollTo({ top: 0, behavior: 'smooth' });
}
function accountsBack() {
    accountsShowIndex();
}

async function renderAccounts() {
    const sel = document.getElementById('accounts-year');
    const content = document.getElementById('accounts-content');
    if (!sel || !content) return;
    const startYear = parseInt(sel.value, 10);
    content.innerHTML = '<div class="accounts-empty">Loading…</div>';

    let rep;
    try {
        rep = await apiGet('accounts.php?year=' + encodeURIComponent(startYear));
    } catch (e) {
        content.innerHTML = `<div class="accounts-empty">Couldn't load: ${escapeHtml(e.message)}</div>`;
        return;
    }
    accountsReport = rep; // cache for CSV

    const total = rep.total || 0;
    const heldDeposits = rep.held_deposits || 0;
    const undated = rep.undated || { count: 0, total: 0, held: 0 };
    const expYear = expensesForYear(startYear);
    const expTotal = expYear.reduce((s, x) => s + (x.amount || 0), 0);
    const net = total - expTotal;

    // Quarterly split for Making Tax Digital (UK tax quarters from 6 Apr).
    const payments = Array.isArray(rep.payments) ? rep.payments : [];
    const qBounds = [
        ['Q1 · Apr–Jun', `${startYear}-04-06`, `${startYear}-07-05`],
        ['Q2 · Jul–Sep', `${startYear}-07-06`, `${startYear}-10-05`],
        ['Q3 · Oct–Dec', `${startYear}-10-06`, `${startYear + 1}-01-05`],
        ['Q4 · Jan–Mar', `${startYear + 1}-01-06`, `${startYear + 1}-04-05`],
    ];
    const qRows = qBounds.map(([lbl, s, e]) => {
        const inc = payments
            .filter((p) => (p.payment_date || '') >= s && (p.payment_date || '') <= e)
            .reduce((a, p) => a + (p.income_part || 0), 0);
        const exp = expYear
            .filter((x) => (x.date || '') >= s && (x.date || '') <= e)
            .reduce((a, x) => a + (x.amount || 0), 0);
        return { lbl, inc, exp, net: inc - exp };
    });
    const quarterly = `<div class="mo-card" style="max-width:460px;margin-top:14px;"><div class="mo-card-title">Quarterly breakdown (Making Tax Digital)</div>
                <div class="feed-list" style="padding:0;">
                    <div class="feed-row" style="grid-template-columns:1fr auto auto auto;gap:10px;font-size:0.68rem;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-muted);"><span>Quarter</span><span>Income</span><span>Costs</span><span>Net</span></div>
                    ${qRows.map((q) => `<div class="feed-row" style="grid-template-columns:1fr auto auto auto;gap:10px;"><span class="feed-who">${q.lbl}</span><span class="feed-amt">${gbp(q.inc)}</span><span class="feed-amt" style="color:var(--text-muted);">${gbp(q.exp)}</span><span class="feed-amt" style="color:${q.net < 0 ? '#FFA726' : 'var(--text-light)'};">${gbp(q.net)}</span></div>`).join('')}
                </div></div>`;

    content.innerHTML = `
                <div class="accounts-stat headline" style="max-width:460px;">
                    <div class="label">Net profit — ${taxYearShort(startYear)}</div>
                    <div class="value ${net < 0 ? 'os-warn' : 'os-good'}">${gbp(net)}</div>
                </div>
                <div class="feed-list" style="max-width:460px;margin-top:12px;padding:4px 16px;">
                    <div class="feed-row" style="grid-template-columns:1fr auto;"><span class="feed-who">Rental income</span><span class="feed-amt">${gbp(total)}</span></div>
                    <div class="feed-row" style="grid-template-columns:1fr auto;"><span class="feed-who">Expenses${expYear.length ? ` (${expYear.length})` : ''}</span><span class="feed-amt">− ${gbp(expTotal)}</span></div>
                    <div class="feed-row" style="grid-template-columns:1fr auto;border-top:1px solid var(--glass-border);"><span class="feed-who" style="color:var(--text-light);">Net</span><span class="feed-amt" style="color:var(--text-light);">${gbp(net)}</span></div>
                </div>
                ${quarterly}
                <div class="accounts-actions" style="margin-top:14px;">
                    <button class="btn-sm btn-edit" onclick="downloadYearStatement(${startYear})">⤓ Statement (PDF)</button>
                    <button class="btn-sm btn-edit" onclick="exportAccountsCSV()">⤓ Export (CSV)</button>
                    <button class="btn-sm btn-edit" onclick="accountsOpen('expenses')">Manage expenses</button>
                </div>
                <div class="accounts-note" style="margin-top:12px;">
                    ${heldDeposits > 0 ? gbp(heldDeposits) + ' in refundable damages deposits is held separately and is <strong>not</strong> income. ' : ''}
                    Income is money received, allocated to the UK tax year by each payment's recorded date; expenses by their date. A record-keeping aid, not formal accounting advice.
                    ${undated.count > 0 ? `<br>${undated.count} payment(s) totalling ${gbp((undated.total || 0) + (undated.held || 0))} have no payment date recorded, so they aren't counted in any tax year — add a payment date on the booking to include them.` : ''}
                </div>`;
}
// ---- Expenses manager (Money → Expenses) ----
const EXPENSE_CATS = [
    'Cleaning',
    'Laundry',
    'Maintenance',
    'Utilities',
    'Supplies',
    'Insurance',
    'Fees',
    'Marketing',
    'Other',
];
// Receipt photo is a scan source only — it is NEVER uploaded or stored.
// We OCR it in memory on the device and keep only the extracted figures.
function pickExpenseReceipt() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*,.heic,.heif';
    input.onchange = async () => {
        const file = input.files && input.files[0];
        if (!file) return;
        const prev = document.getElementById('exp-receipt-prev');
        if (prev)
            prev.innerHTML =
                '<span id="exp-scan-status" style="font-size:0.75rem;color:var(--text-muted);">Reading…</span>';
        try {
            let img = file;
            if (isHeic(file)) {
                try {
                    img = await ensureUploadable(file);
                } catch (e) {}
            } // HEIC → JPEG so OCR can read it
            await scanReceiptFile(img);
        } catch (e) {
            const st = document.getElementById('exp-scan-status');
            if (st) st.textContent = 'couldn’t read it — enter manually';
        }
    };
    input.click();
}

// ---- On-device receipt OCR (Tesseract.js, lazy-loaded; the image stays in
// memory on the device and is never uploaded — only the OCR engine is
// fetched from a CDN and cached). ----
let __tessLoading = null;
function loadTesseract() {
    if (window.Tesseract) return Promise.resolve();
    if (__tessLoading) return __tessLoading;
    __tessLoading = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
        s.onload = resolve;
        s.onerror = () => {
            __tessLoading = null;
            reject(new Error('scanner unavailable'));
        };
        document.head.appendChild(s);
    });
    return __tessLoading;
}
async function scanReceiptFile(file) {
    const status = () => document.getElementById('exp-scan-status');
    try {
        if (status()) status().textContent = 'Reading…';
        await loadTesseract();
        const { data } = await window.Tesseract.recognize(file, 'eng');
        const filled = applyReceiptText((data && data.text) || '');
        if (status())
            status().textContent = filled
                ? '✓ read — check the details'
                : 'couldn’t read it — enter manually';
    } catch (e) {
        if (status()) status().textContent = 'couldn’t read it — enter manually';
    }
}
// Pull a date out of OCR text → YYYY-MM-DD (UK day-first), or '' if none found.
function parseReceiptDate(text) {
    const MON = {
        jan: 1,
        feb: 2,
        mar: 3,
        apr: 4,
        may: 5,
        jun: 6,
        jul: 7,
        aug: 8,
        sep: 9,
        oct: 10,
        nov: 11,
        dec: 12,
    };
    const pad = (n) => String(n).padStart(2, '0');
    const yr = (y) => (y < 100 ? 2000 + y : y);
    const ok = (y, m, d) =>
        m >= 1 && m <= 12 && d >= 1 && d <= 31 ? `${y}-${pad(m)}-${pad(d)}` : '';
    let m;
    m = text.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/); // 2026-06-16
    if (m) return ok(+m[1], +m[2], +m[3]);
    m = text.match(/(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/); // 16/06/2026 (day-first)
    if (m) return ok(yr(+m[3]), +m[2], +m[1]);
    m = text.match(/(\d{1,2})\s*([A-Za-z]{3,})\.?\s*,?\s*(\d{2,4})/); // 16 Jun 2026
    if (m && MON[m[2].slice(0, 3).toLowerCase()])
        return ok(yr(+m[3]), MON[m[2].slice(0, 3).toLowerCase()], +m[1]);
    m = text.match(/([A-Za-z]{3,})\.?\s*(\d{1,2})\s*,?\s*(\d{2,4})/); // Jun 16, 2026
    if (m && MON[m[1].slice(0, 3).toLowerCase()])
        return ok(yr(+m[3]), MON[m[1].slice(0, 3).toLowerCase()], +m[2]);
    return '';
}
// Pull line items (name + price) out of OCR text, skipping totals/payment lines.
function parseReceiptItems(lines) {
    const skip =
        /(sub-?total|^total|vat|tax|change|cash|card|balance|amount due|to pay|visa|master|debit|credit|tip|service charge|rounding|invoice|receipt|tel\b|phone|www\.|http|@|^date|^time)/i;
    const itemRe = /^(.{2,42}?)\s+(?:£|gbp|\$)?\s?(\d{1,4}[.,]\d{2})$/i;
    const items = [];
    for (const l of lines) {
        if (skip.test(l)) continue;
        const m = l.match(itemRe);
        if (m) {
            const name = m[1]
                .replace(/\s{2,}/g, ' ')
                .replace(/[.\s]+$/, '')
                .trim();
            if (name && /[a-z]/i.test(name))
                items.push({ name: name.slice(0, 42), price: parseFloat(m[2].replace(',', '.')) });
        }
        if (items.length >= 40) break;
    }
    return items;
}
// The most recent on-device scan: { supplier, date, items[], amount }.
let __lastReceipt = null;
// Heuristically read the receipt from OCR text, fill the form, and show the
// formatted window. Returns true if anything was recognised.
function applyReceiptText(text) {
    if (!text || !text.trim()) {
        renderReceiptCard(null);
        return false;
    }
    const lines = text
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
    const moneyRe = /(?:£|gbp|\$)?\s*(\d{1,5}[.,]\d{2})\b/i;
    // Amount: prefer a "total"-ish line; else the largest money figure on the receipt.
    let amount = null;
    const totalLine = lines.find(
        (l) => /total|amount due|balance due|to pay|grand total/i.test(l) && moneyRe.test(l),
    );
    if (totalLine) {
        const mm = totalLine.match(moneyRe);
        if (mm) amount = parseFloat(mm[1].replace(',', '.'));
    }
    if (amount == null) {
        let max = 0;
        const re = /(\d{1,5}[.,]\d{2})\b/g;
        let mm;
        lines.forEach((l) => {
            while ((mm = re.exec(l))) {
                const v = parseFloat(mm[1].replace(',', '.'));
                if (v > max) max = v;
            }
        });
        if (max > 0) amount = max;
    }
    const date = parseReceiptDate(text);
    const supplier = (
        lines.find((l) => /[a-z]/i.test(l) && l.replace(/[^a-z]/gi, '').length >= 3) || ''
    ).slice(0, 42);
    const items = parseReceiptItems(lines);
    __lastReceipt = {
        supplier: supplier || '',
        date: date || '',
        items,
        amount: amount != null ? amount : null,
    };
    const set = (id, v) => {
        const el = document.getElementById(id);
        if (el && v != null && v !== '') el.value = v;
    };
    if (amount != null) set('exp-amount', amount.toFixed(2));
    if (date) set('exp-date', date);
    if (supplier) set('exp-desc', supplier);
    renderReceiptCard(__lastReceipt);
    return amount != null || !!date || !!supplier || items.length > 0;
}
// Formatted receipt window: Supplier · Date · Items · Amount.
function receiptCardHtml(r) {
    if (!r) return '';
    const items = (r.items || [])
        .map(
            (it) =>
                `<div style="display:flex;justify-content:space-between;gap:12px;font-size:0.82rem;"><span>${escapeHtml(it.name)}</span><span style="color:var(--text-muted);">${gbp(it.price)}</span></div>`,
        )
        .join('');
    return `<div style="display:flex;justify-content:space-between;gap:12px;margin-top:4px;"><span style="color:var(--text-muted);">Supplier</span><strong>${escapeHtml(r.supplier || '—')}</strong></div>
                <div style="display:flex;justify-content:space-between;gap:12px;"><span style="color:var(--text-muted);">Date</span><strong>${escapeHtml(r.date || '—')}</strong></div>
                ${items ? `<div style="margin:8px 0;border-top:1px solid var(--glass-border);padding-top:8px;">${items}</div>` : ''}
                <div style="display:flex;justify-content:space-between;gap:12px;border-top:1px solid var(--glass-border);padding-top:8px;"><span style="color:var(--text-muted);">Amount</span><strong>${r.amount != null ? gbp(r.amount) : '—'}</strong></div>`;
}
function renderReceiptCard(r) {
    const el = document.getElementById('exp-receipt-card');
    if (!el) return;
    const empty = !r || (!r.supplier && !r.date && r.amount == null && !(r.items || []).length);
    el.innerHTML = empty
        ? ''
        : `<div class="mo-card" style="max-width:420px;margin-top:10px;"><div class="mo-card-title">Scanned receipt</div>${receiptCardHtml(r)}</div>`;
}
// Expand/collapse a stored receipt's formatted data in the expenses list.
let __expenseReceipts = {};
function toggleReceiptDetail(id) {
    const el = document.getElementById('exp-rd-' + id);
    if (!el) return;
    if (el.style.display === 'none' || !el.style.display) {
        el.innerHTML = `<div class="mo-card" style="max-width:420px;margin:4px 0 10px;">${receiptCardHtml(__expenseReceipts[id])}</div>`;
        el.style.display = '';
    } else {
        el.style.display = 'none';
    }
}
function renderExpenses() {
    const wrap = document.getElementById('expenses-body');
    if (!wrap) return;
    const today = todayDashed();
    const cottageOpts = ['<option value="">All / general</option>']
        .concat(
            Object.keys(propertyMeta).map(
                (k) => `<option value="${k}">${escapeHtml(propertyMeta[k].name)}</option>`,
            ),
        )
        .join('');
    const rowsByYear = {};
    allExpenses.forEach((x) => {
        const y = taxYearStartOf(x.date);
        (rowsByYear[y] = rowsByYear[y] || []).push(x);
    });
    const years = Object.keys(rowsByYear).sort((a, b) => b - a);
    // Parse stored receipt data (supplier/date/items/amount) for the list toggles.
    __expenseReceipts = {};
    allExpenses.forEach((x) => {
        if (x.receipt_data) {
            try {
                __expenseReceipts[x.id] = JSON.parse(x.receipt_data);
            } catch (e) {}
        }
    });

    // Spend-by-category chart for the most recent year that has expenses.
    let chart = '';
    if (years.length) {
        const items = rowsByYear[years[0]];
        const byCat = {};
        items.forEach((x) => {
            byCat[x.category || 'Other'] = (byCat[x.category || 'Other'] || 0) + (x.amount || 0);
        });
        const max = Math.max(1, ...Object.values(byCat));
        const bars = osHBars(
            Object.keys(byCat)
                .sort((a, b) => byCat[b] - byCat[a])
                .map((c) => ({
                    label: c,
                    value: Math.round(byCat[c]),
                    max,
                    valLabel: gbp(byCat[c]),
                    color: 'var(--accent)',
                })),
        );
        chart = `<div class="mo-card" style="max-width:680px;"><div class="mo-card-title">Spend by category · ${taxYearShort(parseInt(years[0], 10))}</div>${bars}</div>`;
    }

    const list = years.length
        ? years
              .map((y) => {
                  const items = rowsByYear[y];
                  const tot = items.reduce((s, x) => s + (x.amount || 0), 0);
                  return `<div style="margin-top:18px;">
                    <div style="display:flex;justify-content:space-between;font-size:0.8rem;text-transform:uppercase;letter-spacing:1px;color:var(--text-muted);margin-bottom:8px;"><span>${taxYearShort(parseInt(y, 10))}</span><span>${gbp(tot)}</span></div>
                    ${items
                        .map(
                            (x) => `<div>
                      <div class="feed-row" style="grid-template-columns:84px 1fr auto auto auto;gap:10px;">
                        <span class="feed-date">${x.date}</span>
                        <span class="feed-who">${escapeHtml(x.category)}${x.description ? ' · ' + escapeHtml(x.description) : ''}${x.prop_key && propertyMeta[x.prop_key] ? ' · ' + escapeHtml(propertyMeta[x.prop_key].short || propertyMeta[x.prop_key].name) : ''}${x.recurring ? ' <span class="exp-tag">recurring</span>' : ''}</span>
                        ${__expenseReceipts[x.id] ? `<button class="feed-del" title="View scanned receipt" onclick="toggleReceiptDetail(${x.id})">🧾</button>` : '<span></span>'}
                        <span class="feed-amt">${gbp(x.amount)}</span>
                        <span style="display:flex;gap:2px;"><button class="feed-del" title="Edit" onclick="editExpense(${x.id})">✎</button>${x.recurring ? `<button class="feed-del" title="Add next month's copy" onclick="repeatExpense(${x.id})" style="color:var(--accent);">↻</button>` : ''}<button class="feed-del" title="Remove" onclick="deleteExpense(${x.id})">×</button></span>
                      </div>
                      <div id="exp-rd-${x.id}" style="display:none;"></div>
                    </div>`,
                        )
                        .join('')}
                </div>`;
              })
              .join('')
        : `<p style="font-size:0.85rem;color:var(--text-muted);margin-top:14px;">No expenses logged yet.</p>`;

    wrap.innerHTML = `
                ${chart}
                <div class="accounts-stat" style="max-width:680px;">
                    <div class="label">Add an expense</div>
                    <div class="exp-add-form" style="display:flex;gap:10px;flex-wrap:wrap;margin-top:12px;align-items:flex-end;">
                        <div><label class="modal-label">Date</label><input type="date" id="exp-date" class="input-glass field-sm" value="${today}" style="margin:0;"></div>
                        <div><label class="modal-label">Category</label><select id="exp-cat" class="input-glass field-sm" style="margin:0;">${EXPENSE_CATS.map((c) => `<option>${c}</option>`).join('')}</select></div>
                        <div><label class="modal-label">Amount (£)</label><input type="number" min="0" step="0.01" id="exp-amount" class="input-glass field-sm" placeholder="0.00" style="margin:0;width:110px;"></div>
                        <div><label class="modal-label">Cottage</label><select id="exp-prop" class="input-glass field-sm" style="margin:0;">${cottageOpts}</select></div>
                        <div style="flex:1 1 160px;"><label class="modal-label">Note (optional)</label><input type="text" id="exp-desc" class="input-glass field-sm" placeholder="e.g. End-of-stay clean" style="margin:0;width:100%;"></div>
                        <label class="exp-recurring-label" style="display:flex;align-items:center;gap:6px;font-size:0.82rem;color:var(--text-muted);"><input type="checkbox" id="exp-recurring" style="width:auto;margin:0;"> Recurring</label>
                        <div class="exp-receipt-field"><label class="modal-label">Receipt <span style="text-transform:none;letter-spacing:0;color:var(--text-muted);">· scanned on device, not stored</span></label><div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;"><button class="btn-sm btn-edit exp-scan-btn" type="button" onclick="pickExpenseReceipt()">＋ Scan photo</button><span id="exp-receipt-prev" style="display:inline-flex;align-items:center;gap:6px;"></span></div></div>
                        <button class="btn-sm btn-edit exp-add-btn" onclick="addExpense()">Add</button>
                        <button class="btn-sm exp-clear-btn" type="button" onclick="clearExpenseForm()">Clear</button>
                    </div>
                    <div id="exp-receipt-card"></div>
                </div>
                <div class="feed-list" style="max-width:680px;margin-top:8px;">${list}</div>`;
}
// Load an existing expense back into the form to edit it.
let __editingExpenseId = null;
function editExpense(id) {
    const x = allExpenses.find((e) => e.id === id);
    if (!x) return;
    __editingExpenseId = id;
    const set = (i, val) => {
        const el = document.getElementById(i);
        if (el) el.value = val;
    };
    set('exp-date', x.date || todayDashed());
    const cat = document.getElementById('exp-cat');
    if (cat) cat.value = x.category || 'General';
    set('exp-amount', x.amount != null ? Number(x.amount).toFixed(2) : '');
    const prop = document.getElementById('exp-prop');
    if (prop) prop.value = x.prop_key || '';
    set('exp-desc', x.description || '');
    const rec = document.getElementById('exp-recurring');
    if (rec) rec.checked = !!x.recurring;
    try {
        __lastReceipt = x.receipt_data ? JSON.parse(x.receipt_data) : null;
    } catch (e) {
        __lastReceipt = null;
    }
    renderReceiptCard(__lastReceipt);
    const addBtn = document.querySelector('.exp-add-btn');
    if (addBtn) addBtn.textContent = 'Update';
    const form = document.querySelector('.exp-add-form');
    if (form) form.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const amt = document.getElementById('exp-amount');
    if (amt) amt.focus();
}
async function addExpense() {
    const v = (id) => (document.getElementById(id) || {}).value;
    const recurring = (document.getElementById('exp-recurring') || {}).checked ? 1 : 0;
    const wasEditing = !!__editingExpenseId;
    const editing = __editingExpenseId;
    const payload = {
        action: editing ? 'update' : 'add',
        date: v('exp-date'),
        category: v('exp-cat'),
        amount: parseFloat(v('exp-amount')) || 0,
        prop: v('exp-prop'),
        description: v('exp-desc'),
        recurring,
    };
    if (editing) payload.id = editing;
    // Attach the scanned receipt data (supplier/date/items/amount) if present.
    if (__lastReceipt && ((__lastReceipt.items || []).length || __lastReceipt.supplier))
        payload.receipt_data = JSON.stringify(__lastReceipt);
    if (!payload.amount || payload.amount <= 0) {
        glassAlert('Enter an amount greater than zero.');
        return;
    }
    try {
        const res = await queueOrPost('expenses.php', payload);
        __editingExpenseId = null;
        __lastReceipt = null;
        const prev = document.getElementById('exp-receipt-prev');
        if (prev) prev.innerHTML = '';
        const card = document.getElementById('exp-receipt-card');
        if (card) card.innerHTML = '';
        if (res && res.queued) {
            try {
                clearExpenseForm();
            } catch (e) {}
            toast('Saved offline — it’ll sync when you reconnect.');
            return;
        }
        await loadExpenses();
        renderExpenses();
        try {
            renderAccounts();
        } catch (e) {}
        try {
            renderMoneyOverview();
        } catch (e) {}
        toast(wasEditing ? 'Expense updated.' : 'Expense added.');
    } catch (e) {
        glassAlert("Couldn't save: " + e.message);
    }
}
// Reset the add-expense form + any scanned receipt data (e.g. if OCR was wrong).
function clearExpenseForm() {
    const set = (id, v) => {
        const el = document.getElementById(id);
        if (el) el.value = v;
    };
    set('exp-date', todayDashed());
    const cat = document.getElementById('exp-cat');
    if (cat) cat.selectedIndex = 0;
    set('exp-amount', '');
    const prop = document.getElementById('exp-prop');
    if (prop) prop.value = '';
    set('exp-desc', '');
    const rec = document.getElementById('exp-recurring');
    if (rec) rec.checked = false;
    __lastReceipt = null;
    __editingExpenseId = null;
    const addBtn = document.querySelector('.exp-add-btn');
    if (addBtn) addBtn.textContent = 'Add';
    const prev = document.getElementById('exp-receipt-prev');
    if (prev) prev.innerHTML = '';
    const card = document.getElementById('exp-receipt-card');
    if (card) card.innerHTML = '';
}
// Recurring expenses: one tap clones the entry into the following month.
async function repeatExpense(id) {
    const x = allExpenses.find((e) => e.id === id);
    if (!x) return;
    const [yy, mm, dd] = (x.date || todayDashed()).split('-').map(Number);
    const next = new Date(yy, mm - 1 + 1, dd);
    const nd = formatDashed(next);
    if (
        !(await glassConfirm(
            `Add a copy of "${x.category}${x.description ? ' · ' + x.description : ''}" (${gbp(x.amount)}) dated ${nd}?`,
        ))
    )
        return;
    try {
        await apiPost('expenses.php', {
            action: 'add',
            date: nd,
            category: x.category,
            amount: x.amount,
            prop: x.prop_key || '',
            description: x.description || '',
            recurring: 1,
        });
        await loadExpenses();
        renderExpenses();
        try {
            renderAccounts();
        } catch (e) {}
        try {
            renderMoneyOverview();
        } catch (e) {}
        toast('Recurring expense added for next month.');
    } catch (e) {
        glassAlert("Couldn't add: " + e.message);
    }
}
async function deleteExpense(id) {
    if (!(await glassConfirm('Remove this expense?'))) return;
    try {
        await apiPost('expenses.php', { action: 'delete', id });
        await loadExpenses();
        renderExpenses();
        try {
            renderAccounts();
        } catch (e) {}
        try {
            renderMoneyOverview();
        } catch (e) {}
    } catch (e) {
        glassAlert("Couldn't remove: " + e.message);
    }
}

// Damage-deposit lifecycle: how much of the refundable deposit has been
// collected vs returned for a booking. Keyed by the DB id (booking.dbId).
let damagesReturnedMap = {};
async function loadDepositReturns() {
    try {
        const r = await apiPost('bookings.php', { action: 'deposit_returns' });
        damagesReturnedMap = r.returns || {};
    } catch (e) {
        damagesReturnedMap = {};
    }
}
// Refundable damage deposit ACTUALLY collected into the rental ledger.
// MUST stay in lockstep with damages_collected() in bookings.php.
function damageHeld(propKey, b) {
    const p =
        b.agreedPrice ||
        priceBreakdown(propKey, b.adults || 0, b.children || 0, b.checkIn, b.checkOut);
    const dep = Math.max(0, p.damagesDeposit || 0);
    if (dep <= 0) return { collected: 0, returned: 0, held: 0, deposit: 0 };
    // Hold-model bookings hold the deposit as a separate Square card
    // authorisation (holdStatus), never in the rental ledger — nothing to
    // return here. Only the legacy flow folded it into deposit_paid.
    if (['authorized', 'captured', 'released', 'expired'].includes(b.holdStatus || 'none'))
        return { collected: 0, returned: 0, held: 0, deposit: dep };
    // Pure rental (deposit excluded); a price override raises the floor.
    let rental = p.rentalTotal != null ? p.rentalTotal : Math.max(0, p.total);
    if (b.priceOverride != null) rental = Math.max(rental, b.priceOverride);
    const paid = Math.max(0, Number(b.depositPaid) || 0);
    const collected = Math.round(Math.max(0, Math.min(dep, paid - rental)) * 100) / 100;
    const returned = Math.round((Number(damagesReturnedMap[b.dbId]) || 0) * 100) / 100;
    const held = Math.round(Math.max(0, collected - returned) * 100) / 100;
    return { collected, returned, held, deposit: dep };
}
// Past stays still holding a damage deposit — an action queue at the top.
function renderDepositsDue() {
    const el = document.getElementById('deposits-due');
    if (!el) return;
    const today = todayDashed();
    const rows = [];
    Object.keys(dbBookings).forEach((propKey) => {
        (dbBookings[propKey] || []).forEach((b) => {
            const dh = damageHeld(propKey, b);
            if (dh.held > 0 && (b.checkOut || '') < today) rows.push({ propKey, b, dh });
        });
    });
    if (!rows.length) {
        el.innerHTML = '';
        return;
    }
    rows.sort((a, b) => (a.b.checkOut || '').localeCompare(b.b.checkOut || ''));
    const total = rows.reduce((s, r) => s + r.dh.held, 0);
    const items = rows
        .map(
            ({ propKey, b, dh }) => `
                <div class="money-row glass-panel due-soon">
                    <div class="money-row-head">
                        <div><span class="prop-tag tag-${propKey}">${propertyMeta[propKey] ? propertyMeta[propKey].name : propKey}</span>
                            <strong style="margin-left:8px;">${escapeHtml(b.name)}</strong>
                            <span style="color:var(--text-muted);margin-left:8px;font-size:0.85rem;">left ${b.checkOut}</span></div>
                        <span class="money-status">${gbp(dh.held)} held</span>
                    </div>
                    <div class="money-actions"><button class="btn-sm btn-edit" onclick="returnDeposit('${b.id}')">Return deposit</button></div>
                </div>`,
        )
        .join('');
    el.innerHTML = `<h3 class="accounts-section-title">Deposits to return</h3>
                <div class="money-owed"><strong>${gbp(total)}</strong> in damage deposits to return across ${rows.length} past stay${rows.length === 1 ? '' : 's'}.</div>
                ${items}`;
}
// Return a held damage deposit (full or partial, with a retention reason).
async function returnDeposit(bookingId) {
    const booking = findBookingById(bookingId);
    if (!booking) return;
    const loc = findBookingLocation(bookingId);
    const propKey = loc ? loc.propKey : '21a';
    const dh = damageHeld(propKey, booking);
    if (dh.held <= 0) {
        glassAlert('No damage deposit is being held for this booking.');
        return;
    }
    const entered = await glassPrompt(
        `Amount to return (£). Held: ${gbp(dh.held)}. Enter less to retain some for damage:`,
        String(dh.held),
    );
    if (entered === null) return;
    const amount = Math.round((parseFloat(entered) || 0) * 100) / 100;
    if (!(amount > 0 && amount <= dh.held + 0.001)) {
        glassAlert(`Enter an amount between £0 and ${gbp(dh.held)}.`);
        return;
    }
    let note = '';
    if (amount < dh.held - 0.001) {
        const r = await glassPrompt(
            'Reason for retaining the rest (shown to the guest), e.g. "broken lamp":',
            '',
        );
        if (r === null) return;
        note = r.trim();
    }
    if (!(await glassConfirm(`Return ${gbp(amount)} of the damage deposit to ${booking.name}?`)))
        return;
    try {
        await apiPost('bookings.php', { action: 'return_deposit', id: booking.dbId, amount, note });
        toast('Deposit return issued.');
        afterPaymentChange(bookingId);
    } catch (e) {
        glassAlert("Couldn't return the deposit: " + e.message);
    }
}
// Cancel a booking: optional refund + reason, frees the dates, emails the guest.
async function cancelBooking(bookingId) {
    const booking = findBookingById(bookingId);
    if (!booking) return;
    const loc = findBookingLocation(bookingId);
    const propKey = loc ? loc.propKey : '21a';
    const ps = paymentSummary(propKey, booking);
    const entered = await glassPrompt(
        `Cancel this booking. Refund amount (£) to the guest — 0 for none. Received so far: ${gbp(ps.deposit)}:`,
        String(ps.deposit || 0),
    );
    if (entered === null) return;
    const refund = Math.round((parseFloat(entered) || 0) * 100) / 100;
    if (refund < 0) {
        glassAlert('Refund cannot be negative.');
        return;
    }
    const reason = await glassPrompt('Reason for cancellation (optional, shown to the guest):', '');
    if (reason === null) return;
    if (
        !(await glassConfirm(
            `Cancel ${booking.name}'s booking${refund > 0 ? ` and refund ${gbp(refund)}` : ''}? This frees the dates and emails the guest.`,
        ))
    )
        return;
    try {
        const r = await apiPost('bookings.php', {
            action: 'cancel',
            id: booking.dbId,
            refund_amount: refund,
            reason: reason.trim(),
        });
        toast(
            'Booking cancelled.' +
                (r.manual_refund ? " Couldn't auto-refund — please refund manually." : ''),
        );
        try {
            closeDetailsModal();
        } catch (e) {}
        await loadData();
        renderCalendar();
        if (
            document.getElementById('view-accounts') &&
            document.getElementById('view-accounts').classList.contains('active')
        )
            afterPaymentChange(bookingId);
    } catch (e) {
        glassAlert("Couldn't cancel: " + e.message);
    }
}
// ---- Graphical Money overview (the dashboard shown above the folders) ----
function renderMoneyOverview() {
    const el = document.getElementById('money-overview');
    if (!el) return;
    const today = todayDashed();
    const now = new Date();
    const curTY = taxYearStartOf(today);

    // Trailing 12 calendar months (oldest → newest) for the received-cash trend.
    const months = [];
    for (let i = 11; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        months.push({
            key: d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'),
            short: d.toLocaleDateString('en-GB', { month: 'short' }),
            received: 0,
        });
    }
    const monthIndex = {};
    months.forEach((m, i) => (monthIndex[m.key] = i));

    let monthRevenue = 0,
        receivedTY = 0,
        owedUpcoming = 0,
        receivedUpcoming = 0,
        owedCount = 0,
        next90 = 0;
    const byCottageTY = {};
    Object.keys(propertyMeta).forEach((k) => (byCottageTY[k] = 0));
    const in90 = formatDashed(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 90));
    const monthStart = formatDashed(new Date(now.getFullYear(), now.getMonth(), 1));
    const monthEnd = formatDashed(new Date(now.getFullYear(), now.getMonth() + 1, 0));

    Object.keys(dbBookings).forEach((propKey) => {
        (dbBookings[propKey] || []).forEach((b) => {
            const ps = paymentSummary(propKey, b);
            const recv = Math.max(0, ps.deposit || 0);
            if (recv > 0 && b.paymentDate) {
                const mk = (b.paymentDate || '').slice(0, 7);
                if (monthIndex[mk] != null) months[monthIndex[mk]].received += recv;
                if (taxYearStartOf(b.paymentDate) === curTY) {
                    receivedTY += recv;
                    byCottageTY[propKey] = (byCottageTY[propKey] || 0) + recv;
                }
            }
            if ((b.checkIn || '') >= monthStart && (b.checkIn || '') <= monthEnd)
                monthRevenue += ps.total || 0;
            if ((b.checkOut || '') >= today) {
                receivedUpcoming += ps.deposit || 0;
                if (!ps.fullyPaid) {
                    owedUpcoming += ps.balance || 0;
                    owedCount++;
                }
                if ((b.checkIn || '') >= today && (b.checkIn || '') <= in90)
                    next90 += ps.total || 0;
            }
        });
    });
    const expTY = expensesForYear(curTY).reduce((s, x) => s + (x.amount || 0), 0);
    const netTY = receivedTY - expTY;
    const collectedPct =
        receivedUpcoming + owedUpcoming > 0
            ? Math.round((receivedUpcoming / (receivedUpcoming + owedUpcoming)) * 100)
            : receivedUpcoming > 0
              ? 100
              : 0;
    // ---- Year on year (this tax year TO DATE vs last year to the same point) ----
    // Received cash by payment date, and nights sold by check-in date — both
    // measured over the same elapsed slice of each tax year so it's like-for-like.
    const tyStartStr = (y) => `${y}-04-06`;
    const daysBetween = (a, b) => Math.round((dpParse(b) - dpParse(a)) / 86400000);
    const addDays = (ds, n) => {
        const p = dpParse(ds);
        return formatDashed(new Date(p.getFullYear(), p.getMonth(), p.getDate() + n));
    };
    const elapsed = Math.max(0, daysBetween(tyStartStr(curTY), today));
    const lastCutoff = addDays(tyStartStr(curTY - 1), elapsed); // same point last year
    const yoy = { revThis: 0, revLast: 0, nightsThis: 0, nightsLast: 0 };
    const inRange = (ds, lo, hi) => ds && ds >= lo && ds <= hi;
    Object.keys(dbBookings).forEach((propKey) => {
        (dbBookings[propKey] || []).forEach((b) => {
            const ps = paymentSummary(propKey, b);
            const recv = Math.max(0, ps.deposit || 0);
            if (recv > 0 && b.paymentDate) {
                if (inRange(b.paymentDate, tyStartStr(curTY), today)) yoy.revThis += recv;
                else if (inRange(b.paymentDate, tyStartStr(curTY - 1), lastCutoff))
                    yoy.revLast += recv;
            }
            const nts = nightsBetween(b.checkIn, b.checkOut) || 0;
            if (inRange(b.checkIn, tyStartStr(curTY), today)) yoy.nightsThis += nts;
            else if (inRange(b.checkIn, tyStartStr(curTY - 1), lastCutoff)) yoy.nightsLast += nts;
        });
    });
    const yoyPct = (now_, prev) => {
        if (prev <= 0) return now_ > 0 ? { txt: 'new', cls: 'mo-good' } : { txt: '—', cls: '' };
        const p = Math.round(((now_ - prev) / prev) * 100);
        return { txt: (p >= 0 ? '+' : '') + p + '%', cls: p >= 0 ? 'mo-good' : 'mo-warn' };
    };
    const revDelta = yoyPct(yoy.revThis, yoy.revLast);
    const nightsDelta = yoyPct(yoy.nightsThis, yoy.nightsLast);
    const yoyCard = `
                <div class="mo-card mo-yoy">
                    <div class="mo-card-title">This year vs last · to ${dpParse(today).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</div>
                    <div class="yoy-grid">
                        <div class="yoy-metric">
                            <div class="yoy-label">Received</div>
                            <div class="yoy-now">${gbp(yoy.revThis)}</div>
                            <div class="yoy-cmp"><span class="${revDelta.cls}">${revDelta.txt}</span> vs ${gbp(yoy.revLast)} last year</div>
                        </div>
                        <div class="yoy-metric">
                            <div class="yoy-label">Nights stayed</div>
                            <div class="yoy-now">${yoy.nightsThis}</div>
                            <div class="yoy-cmp"><span class="${nightsDelta.cls}">${nightsDelta.txt}</span> vs ${yoy.nightsLast} last year</div>
                        </div>
                    </div>
                    <div class="mo-sub" style="margin-top:10px;">${taxYearShort(curTY)} so far against the same window of ${taxYearShort(curTY - 1)}.</div>
                </div>`;

    const cottageMax = Math.max(1, ...Object.values(byCottageTY));

    const trendBars = osVBars(
        months.map((m) => ({ label: m.short, short: m.short, value: Math.round(m.received) })),
        moneyShort,
    );
    const cottageBars = osHBars(
        Object.keys(byCottageTY).map((k) => ({
            label: propertyMeta[k].name,
            value: Math.round(byCottageTY[k]),
            max: cottageMax,
            valLabel: gbp(byCottageTY[k]),
            color: `var(--prop-${k})`,
        })),
    );
    const chase =
        owedUpcoming > 0.5
            ? `<div class="mo-chase">
                <div class="mo-chase-text">You're owed <strong>${gbp(owedUpcoming)}</strong> across ${owedCount} upcoming booking${owedCount === 1 ? '' : 's'}.</div>
                <button class="btn-sm btn-edit" onclick="accountsOpen('payments')">Chase balances →</button></div>`
            : '';

    el.innerHTML = `
                <h2 style="font-family:var(--font-serif);font-size:1.3rem;font-weight:400;margin:0 0 12px;">Your money at a glance</h2>
                <div class="mo-kpis">
                    <div class="mo-kpi"><div class="mo-label">Received · ${taxYearShort(curTY)}</div><div class="mo-value mo-good">${gbp(receivedTY)}</div><div class="mo-sub">this tax year</div></div>
                    <div class="mo-kpi"><div class="mo-label">Net profit · ${taxYearShort(curTY)}</div><div class="mo-value ${netTY < 0 ? 'mo-warn' : ''}">${gbp(netTY)}</div><div class="mo-sub">after ${gbp(expTY)} expenses</div></div>
                    <div class="mo-kpi"><div class="mo-label">Outstanding</div><div class="mo-value ${owedUpcoming > 0 ? 'mo-warn' : 'mo-good'}">${gbp(owedUpcoming)}</div><div class="mo-sub">${owedCount} unpaid · upcoming</div></div>
                    <div class="mo-kpi"><div class="mo-label">Booked · next 90 days</div><div class="mo-value">${gbp(next90)}</div><div class="mo-sub">confirmed arrivals</div></div>
                </div>
                ${chase}
                ${yoyCard}
                <div class="mo-grid2">
                    <div class="mo-card"><div class="mo-card-title">Received · last 12 months</div>${trendBars || '<div class="mo-sub">No payments recorded yet.</div>'}</div>
                    <div class="mo-card"><div class="mo-card-title">Collected vs outstanding · upcoming</div>
                        <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap;margin-top:8px;">${osDonut(collectedPct, 'var(--accent)')}
                            <div class="mo-sub" style="font-size:0.8rem;">${gbp(receivedUpcoming)} collected<br>of ${gbp(receivedUpcoming + owedUpcoming)} due</div></div>
                        <div class="mo-card-title" style="margin-top:16px;">Received by cottage · ${taxYearShort(curTY)}</div>${cottageBars || '<div class="mo-sub">No income yet.</div>'}</div>
                </div>`;
}
// Per-booking payments & balances manager (top of the Money & income view).
// Upcoming + current stays, with manual reconcile + Square request/refund.
function renderMoneyPanel() {
    const el = document.getElementById('money-panel');
    if (!el) return;
    const today = todayDashed();
    const rows = [];
    Object.keys(dbBookings).forEach((propKey) => {
        (dbBookings[propKey] || []).forEach((b) => {
            if ((b.checkOut || '') >= today)
                rows.push({ propKey, b, ps: paymentSummary(propKey, b) });
        });
    });
    // "Owed to you" focus: unpaid/part-paid first (an action queue), then settled;
    // within each group, soonest check-in first.
    rows.sort((a, b) => {
        const ap = a.ps.fullyPaid ? 1 : 0,
            bp = b.ps.fullyPaid ? 1 : 0;
        if (ap !== bp) return ap - bp;
        return (a.b.checkIn || '').localeCompare(b.b.checkIn || '');
    });
    const owed = rows.filter((r) => !r.ps.fullyPaid);
    const owedTotal = owed.reduce((s, r) => s + (r.ps.balance || 0), 0);
    const receivedTotal = rows.reduce((s, r) => s + (r.ps.deposit || 0), 0);
    const collectedPct =
        receivedTotal + owedTotal > 0
            ? Math.round((receivedTotal / (receivedTotal + owedTotal)) * 100)
            : receivedTotal > 0
              ? 100
              : 0;
    const intro = squareAdminEnabled
        ? 'Email the guest a secure card link with <strong>Request deposit</strong> / <strong>Request full balance</strong>, or record a manual payment (bank transfer, cash) with the controls on each row.'
        : 'Square card payments are off — set them up in Settings to email pay links. You can still record manual payments (bank transfer, cash) below.';
    if (!rows.length) {
        el.innerHTML = `<h3 class="accounts-section-title">Payments &amp; balances</h3><div class="accounts-empty">No upcoming or current bookings.</div>`;
        return;
    }
    const owedText = owed.length
        ? `<div class="money-owed">You're owed <strong>${gbp(owedTotal)}</strong> across ${owed.length} booking${owed.length === 1 ? '' : 's'}.</div>`
        : `<div class="money-owed all-paid">All upcoming bookings are paid in full.</div>`;
    // Collected-vs-owed at a glance: a donut beside the headline figure.
    const owedBanner = `<div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap;">
                ${osDonut(collectedPct, 'var(--accent)')}
                <div style="min-width:0;">${owedText}
                    <div class="os-sub" style="margin-top:4px;">${gbp(receivedTotal)} collected of ${gbp(receivedTotal + owedTotal)} due on upcoming stays</div>
                </div></div>`;
    const cards = rows
        .map(({ propKey, b, ps }) => {
            const meta = paymentMeta[b.payment] || { label: '—', dot: '#888' };
            const ci = dpParse(b.checkIn),
                t0 = dpParse(today);
            const days = ci && t0 ? Math.round((ci - t0) / 86400000) : 99;
            const dueSoon = !ps.fullyPaid && days <= 7; // within a week, today, or already started
            const badge = dueSoon
                ? `<span class="money-badge">${days < 0 ? 'In progress · unpaid' : days === 0 ? 'Arrives today · unpaid' : 'Due soon · ' + days + 'd'}</span>`
                : '';
            const sqBtns =
                squareAdminEnabled && b.email
                    ? `
                        <button class="btn-sm btn-edit" onclick="requestPayment('${b.id}','deposit')">Request deposit</button>
                        <button class="btn-sm btn-edit" onclick="requestPayment('${b.id}','balance')">Request full balance</button>
                        <button class="btn-sm btn-edit" onclick="copyPayLink('${b.id}','balance')">Copy pay link</button>`
                    : '';
            const history =
                squareAdminEnabled && b.email
                    ? `<div id="sq-pay-${b.id}" class="sq-pay-history" style="margin-top:10px;font-size:0.82rem;color:var(--text-muted);">Loading payments…</div>`
                    : '';
            const dh = damageHeld(propKey, b);
            const depLine =
                dh.collected > 0
                    ? `<div class="money-deposit">
                        <span>Refundable damage deposit: ${
                            dh.held > 0
                                ? `<strong>${gbp(dh.held)} held</strong>${dh.returned > 0 ? ` · ${gbp(dh.returned)} returned` : ''}`
                                : `<span style="color:#4CAF50;">returned${dh.returned < dh.collected - 0.001 ? ` (${gbp(dh.collected - dh.returned)} retained)` : ''}</span>`
                        }</span>
                        ${dh.held > 0 ? `<button class="btn-sm btn-edit" onclick="returnDeposit('${b.id}')">Return deposit</button>` : ''}
                    </div>`
                    : holdControls(b);
            return `
                <div class="money-row glass-panel${dueSoon ? ' due-soon' : ''}">
                    <div class="money-row-head">
                        <div><span class="prop-tag tag-${propKey}">${propertyMeta[propKey] ? propertyMeta[propKey].name : propKey}</span>
                            <strong style="margin-left:8px;">${escapeHtml(b.name)}</strong>
                            <span style="color:var(--text-muted);margin-left:8px;font-size:0.85rem;">${b.checkIn} → ${b.checkOut}</span> ${badge}</div>
                        <span class="money-status"><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${meta.dot};"></span> ${meta.label}</span>
                    </div>
                    <div class="money-figures">
                        <span>Total<strong>${gbp(ps.total)}</strong></span>
                        <span>Received<strong style="color:#4CAF50;">${gbp(ps.deposit)}</strong></span>
                        <span>${ps.fullyPaid ? 'Settled' : 'Balance due'}<strong>${gbp(ps.fullyPaid ? 0 : ps.balance)}</strong></span>
                    </div>
                    ${depLine}
                    <div class="money-actions">
                        ${sqBtns}
                        <select class="input-glass field-sm" onchange="updatePaymentStatus('${b.id}', this.value)" title="Payment status">
                            ${Object.keys(paymentMeta)
                                .map(
                                    (k) =>
                                        `<option value="${k}" ${b.payment === k ? 'selected' : ''}>${paymentMeta[k].label}</option>`,
                                )
                                .join('')}
                        </select>
                        <input type="number" min="0" step="0.01" class="input-glass field-sm money-dep" title="Record amount received (£)"
                               value="${b.depositPaid != null ? b.depositPaid : 0}" onchange="updateDeposit('${b.id}', this.value)">
                        <button class="btn-sm btn-edit" onclick="downloadInvoice('${b.id}')" title="Download an invoice / receipt PDF">Invoice (PDF)</button>
                    </div>
                    ${history}
                </div>`;
        })
        .join('');
    el.innerHTML = `<h3 class="accounts-section-title">Payments &amp; balances</h3>
                ${owedBanner}
                <p style="font-size:0.82rem;color:var(--text-muted);margin:8px 0 16px;max-width:640px;">${intro}</p>${cards}`;
    if (squareAdminEnabled)
        rows.forEach(({ b }) => {
            if (b.email) loadBookingPayments(b.id);
        });
}
// Recent Square transactions across all bookings (deposits, balances, refunds).
async function renderMoneyFeed() {
    const el = document.getElementById('money-feed');
    if (!el) return;
    let list = [];
    try {
        const r = await apiPost('bookings.php', { action: 'recent_payments' });
        list = r.payments || [];
    } catch (e) {
        el.innerHTML = '';
        return;
    }
    if (!list.length) {
        el.innerHTML = `<h3 class="accounts-section-title">Recent payments</h3><div class="accounts-empty">No card payments yet. Card deposits, balances and refunds will appear here.</div>`;
        return;
    }
    let grossIn = 0,
        feeSum = 0,
        feeKnown = 0;
    const rows = list
        .map((p) => {
            const isReturn = p.kind === 'refund' || p.kind === 'damages_return';
            const label =
                p.kind === 'refund'
                    ? 'Refund'
                    : p.kind === 'damages_return'
                      ? 'Deposit return'
                      : p.kind.charAt(0).toUpperCase() + p.kind.slice(1);
            const gross = Math.abs(parseFloat(p.amount) || 0);
            const fee = p.fee != null && p.fee !== '' ? Math.abs(parseFloat(p.fee) || 0) : null;
            const amt = (isReturn ? '−' : '') + gbp(gross);
            if (!isReturn) {
                grossIn += gross;
                if (fee != null) {
                    feeSum += fee;
                    feeKnown++;
                }
            }
            // Gross / fee / net per card-in transaction (fees settle after the charge).
            const feeNote =
                !isReturn && fee != null && fee > 0
                    ? ` · fee ${gbp(fee)} · net ${gbp(Math.max(0, gross - fee))}`
                    : '';
            const date = (p.created_at || '').slice(0, 10) || '—';
            const propName = propertyMeta[p.prop_key]
                ? propertyMeta[p.prop_key].name
                : p.prop_key || '';
            const deleted = p.booking_deleted == 1 || p.booking_deleted === true;
            const note = (p.note || '').trim();
            const who =
                (p.name || 'Guest') +
                (deleted ? ' · deleted booking' : '') +
                (note ? ' · ' + note : '');
            return `<div class="feed-row"${note ? ` title="${escapeHtml(note)}"` : ''}>
                    <span class="feed-date">${escapeHtml(date)}</span>
                    <span class="prop-tag tag-${p.prop_key}">${escapeHtml(propName)}</span>
                    <span class="feed-who"${deleted ? ' style="color:var(--text-muted);"' : ''}>${escapeHtml(who)}</span>
                    <span class="feed-kind">${label}${feeNote}</span>
                    <span class="feed-amt" style="${isReturn ? 'color:#E57373;' : 'color:#4CAF50;'}"${!isReturn && fee != null ? ` title="Gross ${gbp(gross)} · fee ${gbp(fee)} · net ${gbp(Math.max(0, gross - fee))}"` : ''}>${amt}</span>
                    <span class="feed-status">${escapeHtml(p.status || '')}</span>
                </div>`;
        })
        .join('');
    // Gross / fees / net reconciliation across the shown card payments.
    const recon =
        grossIn > 0
            ? `<div class="mo-card" style="margin:-2px 0 12px;">
                <div class="mo-card-title">Card reconciliation · last ${list.length} transaction${list.length === 1 ? '' : 's'}</div>
                <div style="display:flex;gap:22px;flex-wrap:wrap;font-size:0.9rem;margin-top:6px;">
                    <span style="color:var(--text-muted);">Gross<strong style="color:var(--text-light);margin-left:6px;">${gbp(grossIn)}</strong></span>
                    <span style="color:var(--text-muted);">Square fees<strong style="color:#E57373;margin-left:6px;">− ${gbp(feeSum)}</strong></span>
                    <span style="color:var(--text-muted);">Net payout<strong style="color:#4CAF50;margin-left:6px;">${gbp(Math.max(0, grossIn - feeSum))}</strong></span>
                </div>
                ${feeKnown < list.length ? `<div class="os-sub" style="margin-top:6px;">Fees appear once Square settles each payment (usually within a day or two), so recent charges may not show a fee yet.</div>` : ''}
            </div>`
            : '';
    el.innerHTML = `<h3 class="accounts-section-title">Recent payments</h3>
                ${recon}
                <div class="feed-list glass-panel">${rows}</div>`;
}
// Projected revenue + occupancy by month from confirmed upcoming bookings.
function renderMoneyForecast() {
    const el = document.getElementById('money-forecast');
    if (!el) return;
    const now = new Date();
    const months = [];
    for (let i = 0; i < 6; i++) {
        const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
        months.push({
            key: d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'),
            label: d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }),
            start: new Date(d.getFullYear(), d.getMonth(), 1),
            end: new Date(d.getFullYear(), d.getMonth() + 1, 0),
            revenue: 0,
            bookings: 0,
            nights: new Set(),
        });
    }
    const propCount = Object.keys(propertyMeta).length || 3;
    // Revenue: direct bookings by check-in month. Occupancy: direct bookings + iCal
    // blocks, each cottage-night counted once (mirrors renderOwnerSummary).
    const addNights = (m, propKey, checkIn, checkOut) => {
        let d = dpParse(checkIn),
            end = dpParse(checkOut);
        if (!d || !end) return;
        for (; d < end; d.setDate(d.getDate() + 1)) {
            if (d >= m.start && d <= m.end) m.nights.add(propKey + '|' + formatDashed(d));
        }
    };
    Object.keys(dbBookings).forEach((propKey) => {
        (dbBookings[propKey] || []).forEach((b) => {
            months.forEach((m) => {
                const ci = dpParse(b.checkIn);
                if (ci && ci >= m.start && ci <= m.end) {
                    m.revenue += (b.agreedPrice && b.agreedPrice.total) || 0;
                    m.bookings++;
                }
                addNights(m, propKey, b.checkIn, b.checkOut);
            });
        });
    });
    Object.keys(dbBlocks || {}).forEach((propKey) => {
        (dbBlocks[propKey] || []).forEach((bl) =>
            months.forEach((m) => addNights(m, propKey, bl.checkIn, bl.checkOut)),
        );
    });
    const body = months
        .map((m) => {
            const daysInMonth = m.end.getDate();
            const occ = Math.round((m.nights.size / (daysInMonth * propCount)) * 100);
            return `<tr>
                    <td>${escapeHtml(m.label)}</td>
                    <td class="num">${gbp(m.revenue)}</td>
                    <td class="num">${m.bookings}</td>
                    <td class="num">${occ}%</td>
                </tr>`;
        })
        .join('');
    const projTotal = months.reduce((s, m) => s + m.revenue, 0);
    const chart = osVBars(
        months.map((m) => ({
            short: m.label.split(' ')[0].slice(0, 3),
            label: m.label,
            value: m.revenue,
        })),
        moneyShort,
    );
    el.innerHTML = `<h3 class="accounts-section-title">Income forecast (next 6 months)</h3>
                <div class="accounts-stat" style="max-width:720px;margin-bottom:16px;">
                    <div class="label">Projected revenue by month</div>
                    ${chart}
                </div>
                <table class="accounts-table">
                    <thead><tr><th>Month</th><th class="num">Projected revenue</th><th class="num">Bookings</th><th class="num">Occupancy</th></tr></thead>
                    <tbody>${body}<tr style="font-weight:600;"><td>Total projected</td><td class="num">${gbp(projTotal)}</td><td class="num"></td><td class="num"></td></tr></tbody>
                </table>
                <div class="accounts-note" style="margin-top:8px;">Projected revenue is the agreed total of confirmed bookings whose check-in falls in each month; occupancy counts booked cottage-nights (direct + imported) across all ${propCount} cottages.</div>`;
}
// Refresh after any payment change: re-render the money panel if we're on the
// Money & income view, otherwise re-open the booking detail pop-up (calendar).
function afterPaymentChange(bookingId) {
    const acc = document.getElementById('view-accounts');
    if (acc && acc.classList.contains('active')) {
        // Re-fetch deposit returns, then re-render the whole money view.
        loadDepositReturns().then(() => {
            try {
                renderDepositsDue();
            } catch (e) {}
            try {
                renderMoneyPanel();
            } catch (e) {}
            try {
                renderMoneyFeed();
            } catch (e) {}
        });
        return;
    }
    const fresh = findBookingById(bookingId);
    const loc = findBookingLocation(bookingId);
    if (fresh && loc) showDetails(loc.propKey, fresh);
}

function exportAccountsCSV() {
    if (!accountsReport) return;
    const startYear = accountsReport.year;
    const payments = (accountsReport.payments || [])
        .slice()
        .sort((a, b) => (a.payment_date || '').localeCompare(b.payment_date || ''));
    const esc = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
    let csv =
        'Date,Booking Ref,Guest,Property,Method,Rental Income (GBP),Held Deposit (GBP),Received (GBP)\n';
    payments.forEach((r) => {
        csv +=
            [
                esc(r.payment_date),
                esc(bookingRef('b' + r.id)),
                esc(r.name || ''),
                esc(r.property_name || ''),
                esc(r.payment_method || ''),
                (parseFloat(r.income_part) || 0).toFixed(2),
                (parseFloat(r.held_part) || 0).toFixed(2),
                (parseFloat(r.received) || 0).toFixed(2),
            ].join(',') + '\n';
    });
    const inc = accountsReport.total || 0,
        held = accountsReport.held_deposits || 0;
    csv += `,,,,Totals,${inc.toFixed(2)},${held.toFixed(2)},${(inc + held).toFixed(2)}\n`;
    // Expenses for the same tax year + a net-profit summary.
    const exp = expensesForYear(startYear)
        .slice()
        .sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    const expTotal = exp.reduce((s, x) => s + (x.amount || 0), 0);
    csv += '\nExpenses\nDate,Category,Note,Cottage,Amount (GBP)\n';
    exp.forEach((x) => {
        csv +=
            [
                esc(x.date),
                esc(x.category || ''),
                esc(x.description || ''),
                esc(
                    x.prop_key && propertyMeta[x.prop_key]
                        ? propertyMeta[x.prop_key].name
                        : x.prop_key || '',
                ),
                (x.amount || 0).toFixed(2),
            ].join(',') + '\n';
    });
    csv += `,,,Total expenses,${expTotal.toFixed(2)}\n`;
    csv += `\nSummary\nRental income,${inc.toFixed(2)}\nExpenses,${expTotal.toFixed(2)}\nNet profit,${(inc - expTotal).toFixed(2)}\n`;
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Cottage-Holidays-Blakeney-Accounts-${taxYearShort(startYear).replace('/', '-')}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}
// Year-end income statement (PDF) for the selected UK tax year.
function downloadYearStatement(startYear) {
    if (!window.jspdf || !window.jspdf.jsPDF) {
        glassAlert('The PDF tool is still loading — please try again in a moment.');
        return;
    }
    const rep = accountsReport && accountsReport.year === startYear ? accountsReport : null;
    const income = rep ? rep.total || 0 : 0;
    const held = rep ? rep.held_deposits || 0 : 0;
    const byProp = rep ? rep.by_property || {} : {};
    const exp = expensesForYear(startYear)
        .slice()
        .sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    const expTotal = exp.reduce((s, x) => s + (x.amount || 0), 0);
    const net = income - expTotal;

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    const W = doc.internal.pageSize.getWidth(),
        H = doc.internal.pageSize.getHeight();
    const left = 50,
        right = W - 50;
    let y = 60;
    const line = (yy) => {
        doc.setDrawColor(210);
        doc.line(left, yy, right, yy);
    };
    const rowLR = (l, rr, yy, bold) => {
        doc.setFont('helvetica', bold ? 'bold' : 'normal');
        doc.text(String(l), left, yy);
        doc.text(String(rr), right, yy, { align: 'right' });
    };
    const brk = () => {
        if (y > H - 70) {
            doc.addPage();
            y = 60;
        }
    };

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(22);
    doc.text('Cottage Holidays Blakeney', left, y);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);
    doc.setTextColor(120);
    doc.text('INCOME STATEMENT', right, y, { align: 'right' });
    doc.setTextColor(0);
    y += 16;
    doc.setFontSize(9);
    doc.setTextColor(120);
    doc.text(`UK tax year ${taxYearLabel(startYear)}`, left, y);
    doc.setTextColor(0);
    y += 24;
    line(y);
    y += 28;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text('Summary', left, y);
    y += 20;
    doc.setFontSize(10);
    rowLR('Rental income received', gbp(income), y);
    y += 18;
    rowLR('Expenses', '− ' + gbp(expTotal), y);
    y += 18;
    y += 4;
    line(y);
    y += 18;
    rowLR('Net profit', gbp(net), y, true);
    y += 22;
    if (held > 0) {
        doc.setFontSize(9);
        doc.setTextColor(120);
        doc.text(`(${gbp(held)} refundable damage deposits held — not income)`, left, y);
        doc.setTextColor(0);
        doc.setFontSize(10);
        y += 18;
    }
    y += 8;
    line(y);
    y += 28;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text('Income by cottage', left, y);
    y += 20;
    doc.setFontSize(10);
    Object.keys(byProp).forEach((k) => {
        rowLR(propertyMeta[k] ? propertyMeta[k].name : k, gbp(byProp[k]), y);
        y += 18;
        brk();
    });
    y += 10;
    line(y);
    y += 28;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text('Expenses', left, y);
    y += 20;
    doc.setFontSize(9);
    if (!exp.length) {
        doc.setTextColor(120);
        doc.text('No expenses logged.', left, y);
        doc.setTextColor(0);
        y += 18;
    }
    exp.forEach((x) => {
        const lbl = `${x.date}  ${x.category || ''}${x.description ? ' · ' + x.description : ''}`;
        rowLR(lbl.length > 70 ? lbl.slice(0, 70) + '…' : lbl, gbp(x.amount), y);
        y += 16;
        brk();
    });
    y += 4;
    line(y);
    y += 18;
    doc.setFontSize(10);
    rowLR('Total expenses', gbp(expTotal), y, true);
    y += 28;

    doc.setFontSize(8);
    doc.setTextColor(120);
    doc.text(
        'A record-keeping aid, not formal accounting advice. Income is allocated to the tax year by each payment date.',
        left,
        y,
    );
    doc.save(`CHB-Statement-${taxYearShort(startYear).replace('/', '-')}.pdf`);
}

// ===================================================================
//  GUEST ACCOUNTS (front-end)
// ===================================================================
// Friendly booking reference derived from the booking id
function bookingRef(id) {
    const digits = String(id).replace(/\D/g, '');
    const tail = digits.slice(-6).padStart(6, '0');
    return 'CHB-' + tail;
}

function setGuestUI() {
    const acct = document.getElementById('footer-account');
    if (acct) acct.innerText = currentGuest ? 'My Stays' : 'Sign in';
    const btn = document.getElementById('account-btn');
    if (btn) {
        btn.classList.toggle('logged-in', !!currentGuest);
        btn.title = currentGuest ? `My account — ${currentGuest.name.split(' ')[0]}` : 'Sign in';
    }
    // Drives the guest-shell bar: My Stays / Experiences appear only when
    // signed in, so re-sync the dock highlight/indicator after the change.
    document.body.classList.toggle('guest-signed-in', !!currentGuest);
    try {
        if (window.setActiveTab) {
            const av = document.querySelector('.page-view.active');
            if (av) window.setActiveTab(av.id);
        }
    } catch (e) {}
}

// Populate the account "Your details" panel from the logged-in guest.
function fillGuestProfile() {
    if (!currentGuest) return;
    const e = document.getElementById('profile-email');
    const p = document.getElementById('profile-phone');
    const a = document.getElementById('profile-address');
    const pc = document.getElementById('profile-postcode');
    if (e) e.value = currentGuest.email || '';
    if (p) p.value = currentGuest.phone || '';
    if (a) a.value = currentGuest.address || '';
    if (pc) pc.value = currentGuest.postcode || '';
}
// Save the guest's phone + address (email is not editable here).
async function saveGuestProfile() {
    const phone = (document.getElementById('profile-phone').value || '').trim();
    const address = (document.getElementById('profile-address').value || '').trim();
    const postcode = (document.getElementById('profile-postcode').value || '').trim();
    const msg = document.getElementById('profile-msg');
    const show = (t, ok) => {
        if (msg) {
            msg.textContent = t;
            msg.style.color = ok ? '#4CAF50' : '#E53935';
            msg.style.display = 'block';
        }
    };
    if (!address) {
        show('Please enter your UK address.', false);
        return;
    }
    if (!isUkPostcode(postcode)) {
        show('Please enter a valid UK postcode.', false);
        return;
    }
    try {
        const res = await apiPost('auth.php', {
            action: 'guest_update_profile',
            phone,
            address,
            postcode,
        });
        currentGuest = res.guest || currentGuest;
        show('Saved.', true);
    } catch (e) {
        show("Couldn't save: " + e.message, false);
    }
}

// "Your details" floating window (liquid-glass modal) from the account pill.
function openGuestDetailsModal() {
    fillGuestProfile();
    try {
        loadPasskeys();
    } catch (e) {} // populate the passkey list (works from any entry point, incl. desktop)
    const msg = document.getElementById('profile-msg');
    if (msg) msg.style.display = 'none';
    const m = document.getElementById('guest-details-modal');
    if (m) {
        m.classList.remove('closing');
        m.classList.add('open');
    }
    try {
        if (window.setGuestDockOverlay) window.setGuestDockOverlay('account');
    } catch (e) {}
}
function closeGuestDetailsModal() {
    const m = document.getElementById('guest-details-modal');
    if (!m || !m.classList.contains('open')) return;
    m.classList.add('closing');
    try {
        if (window.setGuestDockOverlay) window.setGuestDockOverlay(null);
    } catch (e) {}
    setTimeout(() => {
        m.classList.remove('open', 'closing');
    }, 350);
}

// "Account & Security" floating window: password, passkeys, delete account.
function openGuestSecurityModal() {
    ['pw-current', 'pw-new', 'pw-confirm'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    const msg = document.getElementById('pw-msg');
    if (msg) msg.style.display = 'none';
    loadPasskeys();
    const m = document.getElementById('guest-security-modal');
    if (m) {
        m.classList.remove('closing');
        m.classList.add('open');
    }
    try {
        if (window.setGuestDockOverlay) window.setGuestDockOverlay('account');
    } catch (e) {}
}
function closeGuestSecurityModal() {
    const m = document.getElementById('guest-security-modal');
    if (!m || !m.classList.contains('open')) return;
    m.classList.add('closing');
    try {
        if (window.setGuestDockOverlay) window.setGuestDockOverlay(null);
    } catch (e) {}
    setTimeout(() => {
        m.classList.remove('open', 'closing');
    }, 350);
}
async function changeGuestPassword() {
    const cur = document.getElementById('pw-current').value;
    const nw = document.getElementById('pw-new').value;
    const cf = document.getElementById('pw-confirm').value;
    const msg = document.getElementById('pw-msg');
    const show = (t, ok) => {
        if (msg) {
            msg.textContent = t;
            msg.style.color = ok ? '#4CAF50' : '#E53935';
            msg.style.display = 'block';
        }
    };
    if (!cur || !nw) {
        show('Please fill in your current and new password.', false);
        return;
    }
    if (nw.length < 4) {
        show('Your new password must be at least 4 characters.', false);
        return;
    }
    if (nw !== cf) {
        show('The new passwords do not match.', false);
        return;
    }
    try {
        await apiPost('auth.php', { action: 'guest_change_password', current: cur, next: nw });
        show('Password updated.', true);
        ['pw-current', 'pw-new', 'pw-confirm'].forEach((id) => {
            document.getElementById(id).value = '';
        });
    } catch (e) {
        show(e.message, false);
    }
}

// GDPR: guest downloads everything we hold about them as a JSON file.
async function exportGuestData(btn) {
    if (btn) btn.disabled = true;
    try {
        const r = await apiPost('auth.php', { action: 'guest_export_data' });
        const blob = new Blob([JSON.stringify(r.data || {}, null, 2)], {
            type: 'application/json',
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'my-data-cottageholidaysblakeney.json';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
        toast('Your data has been downloaded.');
    } catch (e) {
        glassAlert("Couldn't export your data: " + (e.message || e));
    }
    if (btn) btn.disabled = false;
}

// Guest permanently deletes their own account (GDPR erasure).
async function deleteGuestAccount() {
    const ok = await glassConfirm(
        'Delete your account?\n\nThis erases your login, contact details, messages, reviews and mailing-list entry. Past bookings are kept as legally-required financial records but anonymised (your name & contact details removed). This cannot be undone.',
    );
    if (!ok) return;
    try {
        await apiPost('auth.php', { action: 'guest_delete_account' });
        currentGuest = null;
        setGuestUI();
        nav('view-main');
        toast('Your account and personal data have been deleted.');
    } catch (e) {
        glassAlert("Couldn't delete your account: " + e.message);
    }
}

async function openGuestArea() {
    await restoreGuestSession();
    if (currentGuest) {
        closeGuestAuthModal();
        nav('view-guest-bookings');
        await renderGuestBookings();
    } else {
        switchGuestTab('login');
        openGuestAuthModal();
    }
}
// Account tab of the guest app shell (guest-app.js): a signed-in guest gets
// their details/security; a signed-out visitor gets the sign-in screen.
function guestAccountTab() {
    if (currentGuest) openGuestDetailsModal();
    else openGuestArea();
}
window.guestAccountTab = guestAccountTab;

// Customer login/register floating window (liquid-glass modal).
function openGuestAuthModal() {
    const le = document.getElementById('login-error');
    if (le) le.style.display = 'none';
    const re = document.getElementById('reg-error');
    if (re) re.style.display = 'none';
    const m = document.getElementById('guest-auth-modal');
    if (m) {
        m.classList.remove('closing');
        m.classList.add('open');
    }
    try {
        if (window.setGuestDockOverlay) window.setGuestDockOverlay('account');
    } catch (e) {}
    setTimeout(() => {
        const el = document.getElementById('login-email');
        if (el) el.focus();
    }, 120);
}
function closeGuestAuthModal() {
    const m = document.getElementById('guest-auth-modal');
    if (!m || !m.classList.contains('open')) return;
    // Play the fade-out, then actually hide it (animation lasts 0.35s).
    m.classList.add('closing');
    try {
        if (window.setGuestDockOverlay) window.setGuestDockOverlay(null);
    } catch (e) {}
    setTimeout(() => {
        m.classList.remove('open', 'closing');
    }, 350);
}

function switchGuestTab(which) {
    const isLogin = which === 'login';
    document.getElementById('guest-login-form').style.display = isLogin ? 'block' : 'none';
    document.getElementById('guest-register-form').style.display = isLogin ? 'none' : 'block';
    document.getElementById('tab-login').classList.toggle('active-mode', isLogin);
    document.getElementById('tab-register').classList.toggle('active-mode', !isLogin);
}

async function guestRegister() {
    const name = document.getElementById('reg-name').value.trim();
    const email = document.getElementById('reg-email').value.trim();
    const phone = document.getElementById('reg-phone').value.trim();
    const address = document.getElementById('reg-address').value.trim();
    const postcode = document.getElementById('reg-postcode').value.trim();
    const password = document.getElementById('reg-password').value;
    const err = document.getElementById('reg-error');
    const showErr = (m) => {
        err.innerText = m;
        err.style.display = 'block';
    };

    if (!name || !email || !password) {
        showErr('Name, email and password are required.');
        return;
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        showErr('Please enter a valid email address.');
        return;
    }
    if (!address) {
        showErr('Please enter your UK address.');
        return;
    }
    if (!isUkPostcode(postcode)) {
        showErr('Please enter a valid UK postcode.');
        return;
    }
    if (password.length < 4) {
        showErr('Please choose a password of at least 4 characters.');
        return;
    }

    try {
        const res = await apiPost('auth.php', {
            action: 'guest_register',
            name,
            email,
            phone,
            address,
            postcode,
            password,
        });
        currentGuest = res.guest;
        isAuthenticated = false;
        setAuthUI(); // one role at a time: drop any admin session
        err.style.display = 'none';
        setGuestUI();
        closeGuestAuthModal();
        nav('view-guest-bookings');
        await renderGuestBookings();
    } catch (e) {
        showErr(e.message);
    }
}

// Single, merged login. The same email/password box signs in either the
// owner (admin) or a guest: we try the owner credentials first, and if they
// don't match we treat it as a guest login. Owners go to the dashboard;
// guests go to My Bookings.
async function guestLogin() {
    const id = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    const err = document.getElementById('login-error');
    const showErr = (m) => {
        err.innerText = m;
        err.style.display = 'block';
    };
    if (!id || !password) {
        showErr('Please enter your email/username and password.');
        return;
    }

    // 1) Owner/admin first (username + password). A failure here (wrong match
    //    or throttle) simply falls through to the guest attempt below.
    try {
        await apiPost('auth.php', { action: 'admin_login', username: id, password });
        isAuthenticated = true;
        setAuthUI();
        currentGuest = null;
        setGuestUI(); // one role at a time
        err.style.display = 'none';
        closeGuestAuthModal();
        nav('view-backoffice');
        refreshOwnerHomeBadges();
        return;
    } catch (adminErr) {
        /* not the owner — try a guest login */
    }

    // 2) Guest (email + password).
    try {
        const res = await apiPost('auth.php', { action: 'guest_login', email: id, password });
        currentGuest = res.guest;
        isAuthenticated = false;
        setAuthUI(); // one role at a time: drop any admin session
        err.style.display = 'none';
        setGuestUI();
        closeGuestAuthModal();
        nav('view-guest-bookings');
        await renderGuestBookings();
    } catch (e) {
        showErr(e.message);
    }
}

// Passwordless: email the guest a one-tap sign-in link. For privacy we
// always report success (the server won't reveal whether the email exists).
async function requestMagicLink() {
    const email = (document.getElementById('login-email').value || '').trim();
    const msg = document.getElementById('magic-link-msg');
    const show = (t, ok) => {
        if (msg) {
            msg.textContent = t;
            msg.style.color = ok ? '#4CAF50' : '#E53935';
            msg.style.display = 'block';
        }
    };
    if (!email || email.indexOf('@') < 1) {
        show('Enter your email above first, then tap this.', false);
        return;
    }
    try {
        await apiPost('auth.php', { action: 'guest_magic_request', email });
        show(
            'Check your inbox — if that email has an account, a sign-in link is on its way. It expires in 30 minutes.',
            true,
        );
    } catch (e) {
        show("Couldn't send the link — please try again.", false);
    }
}
// Boot: if the page was opened from a magic link (?mlogin=<id>&t=<ts>&k=<token>),
// consume it, sign the guest in, and strip the token from the URL/history.
async function maybeConsumeMagicLink() {
    let usp;
    try {
        usp = new URLSearchParams(window.location.search);
    } catch (e) {
        return false;
    }
    const gid = parseInt(usp.get('mlogin'), 10);
    const ts = parseInt(usp.get('t'), 10);
    const token = usp.get('k') || '';
    if (!gid || !ts || !token) return false;
    const clean = () => {
        try {
            history.replaceState(null, '', window.location.pathname);
        } catch (e) {}
    };
    try {
        const res = await apiPost('auth.php', {
            action: 'guest_magic_consume',
            guest_id: gid,
            ts,
            token,
        });
        currentGuest = res.guest;
        isAuthenticated = false;
        setAuthUI(); // one role at a time
        setGuestUI();
        clean();
        nav('view-guest-bookings');
        await renderGuestBookings();
        try {
            toast('Signed in — welcome back!');
        } catch (e) {}
    } catch (e) {
        clean();
        try {
            glassAlert(
                e.message || 'That sign-in link could not be used. Please request a new one.',
            );
        } catch (e2) {}
    }
    return true;
}

// ===================================================================
//  PASSKEYS (WebAuthn) — Face ID / Touch ID / Windows Hello logins
// ===================================================================
// The browser WebAuthn API works with ArrayBuffers, but we send/receive
// base64url strings as JSON. These helpers convert between the two.
function b64urlToBuf(input) {
    // The server may send a plain base64/base64url string, OR (with the
    // lbuchs library) an object like {"$base64":"..."} for binary fields.
    let s = input;
    if (s && typeof s === 'object') {
        s = s['$base64'] || s['$base64url'] || s.base64 || s.data || '';
    }
    s = String(s).trim();
    // Normalise base64url -> base64, drop anything that isn't a base64 char.
    s = s
        .replace(/-/g, '+')
        .replace(/_/g, '/')
        .replace(/[^A-Za-z0-9+/=]/g, '');
    const pad = s.length % 4;
    if (pad) s += '='.repeat(4 - pad);
    const bin = atob(s);
    const buf = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    return buf.buffer;
}
function bufToB64url(buf) {
    const bytes = new Uint8Array(buf);
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
// Recursively convert the server's option object: any {$base64} fields the
// library marks need to become ArrayBuffers for the browser API.
function prepCreateOptions(o) {
    if (o.challenge) o.challenge = b64urlToBuf(o.challenge);
    if (o.user && o.user.id) o.user.id = b64urlToBuf(o.user.id);
    if (o.excludeCredentials)
        o.excludeCredentials.forEach((c) => {
            if (c.id) c.id = b64urlToBuf(c.id);
        });
    return o;
}
function prepGetOptions(o) {
    if (o.challenge) o.challenge = b64urlToBuf(o.challenge);
    if (o.allowCredentials)
        o.allowCredentials.forEach((c) => {
            if (c.id) c.id = b64urlToBuf(c.id);
        });
    return o;
}
function passkeysSupported() {
    return !!(window.PublicKeyCredential && navigator.credentials && navigator.credentials.create);
}

async function addPasskey() {
    if (!passkeysSupported()) {
        glassAlert("This device or browser doesn't support passkeys.");
        return;
    }
    try {
        const begin = await apiPost('passkeys.php', { action: 'register_begin' });
        const publicKey = prepCreateOptions(begin.options.publicKey || begin.options);
        const cred = await navigator.credentials.create({ publicKey });
        const label = navigator.platform || 'Passkey';
        await apiPost('passkeys.php', {
            action: 'register_finish',
            label,
            clientDataJSON: bufToB64url(cred.response.clientDataJSON),
            attestationObject: bufToB64url(cred.response.attestationObject),
        });
        toast('Passkey added — sign in with Face ID / Touch ID next time.');
        loadPasskeys();
    } catch (e) {
        if (e && e.name === 'NotAllowedError') return; // user cancelled
        glassAlert("Couldn't add passkey: " + (e.message || e));
    }
}

// Single passkey sign-in for the merged login: one prompt, and the server
// tells us whether the chosen passkey is the owner's (admin) or a guest's.
async function passkeyLogin() {
    if (!passkeysSupported()) {
        glassAlert("This device or browser doesn't support passkeys.");
        return;
    }
    try {
        const begin = await apiPost('passkeys.php', { action: 'any_login_begin' });
        const publicKey = prepGetOptions(begin.options.publicKey || begin.options);
        const assertion = await navigator.credentials.get({ publicKey });
        const res = await apiPost('passkeys.php', {
            action: 'any_login_finish',
            id: bufToB64url(assertion.rawId),
            clientDataJSON: bufToB64url(assertion.response.clientDataJSON),
            authenticatorData: bufToB64url(assertion.response.authenticatorData),
            signature: bufToB64url(assertion.response.signature),
        });
        if (res.role === 'admin') {
            isAuthenticated = true;
            setAuthUI();
            currentGuest = null;
            setGuestUI(); // one role at a time
            closeGuestAuthModal();
            nav('view-backoffice');
            refreshOwnerHomeBadges();
        } else {
            currentGuest = res.guest;
            isAuthenticated = false;
            setAuthUI(); // one role at a time: drop any admin session
            setGuestUI();
            closeGuestAuthModal();
            nav('view-guest-bookings');
            await renderGuestBookings();
        }
    } catch (e) {
        if (e && e.name === 'NotAllowedError') return; // user cancelled
        const err = document.getElementById('login-error');
        if (err) {
            err.innerText = 'Passkey sign-in failed: ' + (e.message || e);
            err.style.display = 'block';
        }
    }
}

async function loadPasskeys() {
    const box = document.getElementById('passkey-list');
    if (!box) return;
    try {
        const res = await apiPost('passkeys.php', { action: 'list' });
        const keys = res.passkeys || [];
        if (keys.length === 0) {
            box.innerHTML =
                '<p style="font-size:0.82rem;color:var(--text-muted);">No passkeys yet.</p>';
            return;
        }
        box.innerHTML = keys
            .map(
                (
                    k,
                ) => `<div style="display:flex;justify-content:space-between;align-items:center;border:1px solid var(--glass-border);border-radius:10px;padding:10px 14px;margin-bottom:8px;">
                    <span style="font-size:0.88rem;">${escapeHtml(k.label || 'Passkey')}<span style="color:var(--text-muted);font-size:0.75rem;"> · added ${(k.created_at || '').split(' ')[0]}</span></span>
                    <button class="btn-sm btn-decline" onclick="deletePasskey(${k.id})">Remove</button>
                </div>`,
            )
            .join('');
    } catch (e) {
        box.innerHTML = '';
    }
}
async function deletePasskey(id) {
    if (!(await glassConfirm('Remove this passkey?'))) return;
    try {
        await apiPost('passkeys.php', { action: 'delete', id });
        loadPasskeys();
    } catch (e) {
        glassAlert("Couldn't remove: " + e.message);
    }
}

// ---- Admin (back office) passkeys ----
async function addAdminPasskey() {
    if (!passkeysSupported()) {
        glassAlert("This device or browser doesn't support passkeys.");
        return;
    }
    try {
        const begin = await apiPost('passkeys.php', { action: 'admin_register_begin' });
        const publicKey = prepCreateOptions(begin.options.publicKey || begin.options);
        const cred = await navigator.credentials.create({ publicKey });
        await apiPost('passkeys.php', {
            action: 'admin_register_finish',
            label: navigator.platform || 'Passkey',
            clientDataJSON: bufToB64url(cred.response.clientDataJSON),
            attestationObject: bufToB64url(cred.response.attestationObject),
        });
        toast('Passkey added. Tip: add one on another device as a backup.');
        loadAdminPasskeys();
    } catch (e) {
        if (e && e.name === 'NotAllowedError') return;
        glassAlert("Couldn't add passkey: " + (e.message || e));
    }
}
async function loadAdminPasskeys() {
    const box = document.getElementById('admin-passkey-list');
    if (!box) return;
    try {
        const res = await apiPost('passkeys.php', { action: 'admin_list' });
        const keys = res.passkeys || [];
        if (keys.length === 0) {
            box.innerHTML =
                '<p style="font-size:0.82rem;color:var(--text-muted);">No passkeys yet. Your password is still your way in.</p>';
            return;
        }
        box.innerHTML = keys
            .map(
                (
                    k,
                ) => `<div style="display:flex;justify-content:space-between;align-items:center;border:1px solid var(--glass-border);border-radius:10px;padding:10px 14px;margin-bottom:8px;">
                    <span style="font-size:0.88rem;">${escapeHtml(k.label || 'Passkey')}<span style="color:var(--text-muted);font-size:0.75rem;"> · added ${(k.created_at || '').split(' ')[0]}</span></span>
                    <button class="btn-sm btn-decline" onclick="deleteAdminPasskey(${k.id})">Remove</button>
                </div>`,
            )
            .join('');
    } catch (e) {
        box.innerHTML = '';
    }
}
async function deleteAdminPasskey(id) {
    if (!(await glassConfirm('Remove this passkey? You can still sign in with your password.')))
        return;
    try {
        await apiPost('passkeys.php', { action: 'admin_delete', id });
        loadAdminPasskeys();
    } catch (e) {
        glassAlert("Couldn't remove: " + e.message);
    }
}

async function guestLogout() {
    try {
        await apiPost('auth.php', { action: 'guest_logout' });
    } catch (e) {}
    // On staging, remember the explicit logout so we don't auto-sign-in again
    // (lets the real sign-in / sign-up flow be tested). Cleared on a new tab.
    try {
        if (IS_STAGING) sessionStorage.setItem('chb-staging-noauto', '1');
    } catch (e) {}
    currentGuest = null;
    setGuestUI();
    nav('view-main');
}

async function renderGuestBookings() {
    const list = document.getElementById('guest-bookings-list');
    const welcome = document.getElementById('guest-welcome');
    if (!currentGuest) {
        openGuestArea();
        return;
    }
    if (welcome)
        welcome.innerText = `Welcome back, ${currentGuest.name.split(' ')[0]} — here are your stays.`;
    loadPasskeys();
    fillGuestProfile();

    // Fetch this guest's own bookings + pending enquiries (incl. property address)
    let rows = [],
        enqRows = [],
        completedStays = 0;
    try {
        const res = await apiGet('my-bookings.php');
        rows = res.bookings || [];
        enqRows = res.enquiries || [];
        completedStays = res.completed_stays || 0;
    } catch (e) {
        list.innerHTML = `<div class="glass-panel guest-empty"><p>Couldn't load your bookings right now. Please try again.</p></div>`;
        return;
    }
    const mine = rows.map((row) => ({
        propKey: row.prop_key,
        booking: mapBookingFromApi(row),
        address: row.property_address || '',
        payToken: row.pay_token || '',
    }));
    guestBookingsCache = mine; // for invoice download

    // Pending enquiries — awaiting owner confirmation. Soonest stay first.
    const pendingMine = enqRows
        .map((row) => ({
            propKey: row.prop_key,
            address: row.property_address || '',
            checkIn: row.check_in,
            checkOut: row.check_out,
            checkInTime: row.check_in_time || '15:00',
            checkOutTime: row.check_out_time || '10:00',
            adults: parseInt(row.adults, 10) || 0,
            children: parseInt(row.children, 10) || 0,
        }))
        .sort((a, b) => (a.checkIn < b.checkIn ? -1 : 1));

    // Order so upcoming stays appear first (soonest check-in first),
    // then past stays (most recently finished first).
    const todaySort = todayDashed();
    mine.sort((a, b) => {
        const au = a.booking.checkOut >= todaySort;
        const bu = b.booking.checkOut >= todaySort;
        if (au !== bu) return au ? -1 : 1; // upcoming group first
        if (au) return a.booking.checkIn < b.booking.checkIn ? -1 : 1; // soonest upcoming first
        return a.booking.checkOut > b.booking.checkOut ? -1 : 1; // most recent past first
    });

    // Fetch this guest's own submitted reviews (per property) so past
    // stays show the right state: review form / pending / approved.
    myGuestReviews = {};
    try {
        const rv = await apiPost('reviews.php', { action: 'mine' });
        myGuestReviews = rv.mine || {};
    } catch (e) {}
    const reviewShown = new Set(); // one review block per property
    const photoShown = new Set(); // one "share a photo" button per property
    if (mine.length === 0 && pendingMine.length === 0) {
        list.innerHTML = `<div class="glass-panel guest-empty">
                    <p style="font-size:1.3rem;font-weight:600;margin-bottom:8px;">No Bookings Yet</p>
                    <p style="font-size:0.95rem;">Once you book one of our cottages, it will appear here.</p>
                    <button class="btn-glass" style="margin-top:20px;" onclick="nav('view-cottages')">Browse Cottages</button>
                </div>`;
        return;
    }

    const todayStr = todayDashed();
    const currentStays = []; // bookings whose stay includes today (for the on-arrival watcher)

    // Pending enquiry cards — same layout as a confirmed booking, but marked
    // "Pending" with an estimated price. Shown above confirmed stays.
    const pendingHtml = pendingMine
        .map(
            ({
                propKey,
                address,
                checkIn,
                checkOut,
                checkInTime,
                checkOutTime,
                adults,
                children,
            }) => {
                const meta = propertyMeta[propKey] || { name: propKey };
                const r = propertyRates[propKey] || defaultRates[propKey];
                const addr = address || (r && r.address) || '';
                const img = (propertyContent[propKey] && propertyContent[propKey].images[0]) || '';
                const p = priceBreakdown(propKey, adults, children, checkIn, checkOut);
                const party = guestSummary(adults, children);
                return `
                <div class="glass-panel guest-booking">
                    <div class="guest-booking-head">
                        <div class="guest-booking-img" style="background-image:url('${img}');"></div>
                        <div class="guest-booking-body">
                            <h3><span class="legend-swatch swatch-${propKey}"></span> ${escapeHtml(meta.name)} <span class="guest-status-badge" style="background:rgba(255,167,38,0.22);color:#FFB74D;border:1px solid rgba(255,167,38,0.5);">Pending</span></h3>
                            <div class="guest-ref">Awaiting confirmation</div>
                            <div class="guest-booking-cols">
                            <div class="guest-detail-grid">
                                <div class="booking-detail-item"><span class="booking-detail-label">Check In</span><span class="booking-detail-value" style="font-size:1rem;">${checkIn} · ${checkInTime}</span></div>
                                <div class="booking-detail-item"><span class="booking-detail-label">Check Out</span><span class="booking-detail-value" style="font-size:1rem;">${checkOut} · ${checkOutTime}</span></div>
                                <div class="booking-detail-item"><span class="booking-detail-label">Party</span><span class="booking-detail-value" style="font-size:1rem;">${escapeHtml(party)}</span></div>
                                <div class="booking-detail-item"><span class="booking-detail-label">Status</span><span class="booking-detail-value" style="font-size:1rem;color:#FFB74D;">Awaiting confirmation</span></div>
                                <div class="booking-detail-item" style="grid-column:1/-1;"><span class="booking-detail-label">Address</span><span class="booking-detail-value" style="font-size:0.95rem;">${escapeHtml(addr || 'Address available on confirmation.')}</span></div>
                            </div>
                            <div class="guest-price-box">
                                <div class="price-row"><span>${gbp(p.perNight)} × ${p.nights} night${p.nights === 1 ? '' : 's'}</span><span>${gbp(p.nightly)}</span></div>
                                <div class="price-row"><span>Transaction fee (${p.transactionPct}%)</span><span>${gbp(p.txFee)}</span></div>
                                <div class="price-row total"><span>Total</span><span class="price-amount">${gbp(p.total)}</span></div>
                                ${p.damagesDeposit > 0 ? `<div class="price-row" style="color:var(--text-muted);font-size:0.8rem;"><span>+ ${gbp(p.damagesDeposit)} refundable deposit</span><span>held on arrival, not charged</span></div>` : ''}
                                <p style="color:var(--text-muted);font-size:0.75rem;text-align:center;margin:8px 0 0;">Estimate — we'll confirm your dates and final price by email.</p>
                            </div>
                            </div>
                            <div class="card-actions">
                                <button class="btn-sm btn-edit" onclick="openTermsModal(event, '${propKey}')"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 4h9a3 3 0 0 1 3 3v13H9a3 3 0 0 1-3-3z"/><path d="M6 17h12"/></svg> Terms</button>
                                ${faqBlockHtml(propKey)}
                            </div>
                        </div>
                    </div>
                </div>`;
            },
        )
        .join('');

    const hasUpcoming = mine.some((m) => m.booking.checkOut >= todaySort);
    const upcomingCards = [],
        pastCards = [],
        hubCards = [];
    mine.forEach(({ propKey, booking: b, address, payToken }) => {
        const meta = propertyMeta[propKey];
        const r = propertyRates[propKey] || defaultRates[propKey];
        const addr = address || (r && r.address) || '';
        const img = (propertyContent[propKey] && propertyContent[propKey].images[0]) || '';
        const p =
            b.agreedPrice ||
            priceBreakdown(propKey, b.adults || 0, b.children || 0, b.checkIn, b.checkOut);
        const ps = paymentSummary(propKey, b);
        // Derive the label from the reconciled summary so it can never
        // contradict the balance shown below or on the PDF.
        const payState = ps.fullyPaid ? 'paid' : ps.deposit > 0 ? 'deposit' : 'unpaid';
        const pay = paymentMeta[payState];
        const upcoming = b.checkOut >= todayStr;
        const currentStay = b.checkIn <= todayStr && b.checkOut >= todayStr;
        if (currentStay) currentStays.push({ propKey, bookingId: b.id });
        const statusTag = upcoming
            ? `<span class="guest-status-badge" style="background:rgba(76,175,80,0.25);color:#fff;border:1px solid var(--booked-border);">Upcoming</span>`
            : `<span class="guest-status-badge" style="background:rgba(255,255,255,0.06);color:var(--text-muted);">Past stay</span>`;
        const __card = `
                <div class="glass-panel guest-booking">
                    <div class="guest-booking-head">
                        <div class="guest-booking-img" style="background-image:url('${img}');"></div>
                        <div class="guest-booking-body">
                            <h3><span class="legend-swatch swatch-${propKey}"></span> ${escapeHtml(meta.name)} ${statusTag}</h3>
                            <div class="guest-ref">Booking ref ${bookingRef(b.id)}</div>
                            <div class="guest-booking-cols">
                            <div class="guest-detail-grid">
                                <div class="booking-detail-item"><span class="booking-detail-label">Check In</span><span class="booking-detail-value" style="font-size:1rem;">${b.checkIn} · ${b.checkInTime || '15:00'}</span></div>
                                <div class="booking-detail-item"><span class="booking-detail-label">Check Out</span><span class="booking-detail-value" style="font-size:1rem;">${b.checkOut} · ${b.checkOutTime || '10:00'}</span></div>
                                <div class="booking-detail-item"><span class="booking-detail-label">Party</span><span class="booking-detail-value" style="font-size:1rem;">${escapeHtml(b.guests || '')}</span></div>
                                <div class="booking-detail-item"><span class="booking-detail-label">Payment</span><span class="booking-detail-value" style="font-size:1rem;color:${pay.color};">${pay.label}</span></div>
                                <div class="booking-detail-item" style="grid-column:1/-1;"><span class="booking-detail-label">Address</span><span class="booking-detail-value" style="font-size:0.95rem;">${escapeHtml(addr || 'Address available on confirmation.')}</span></div>
                            </div>
                            <div class="guest-price-box">
                                <div class="price-row"><span>${gbp(p.perNight)} × ${p.nights} night${p.nights === 1 ? '' : 's'}</span><span>${gbp(p.nightly)}</span></div>
                                <div class="price-row"><span>Transaction fee (${p.transactionPct}%)</span><span>${gbp(p.txFee)}</span></div>
                                <div class="price-row total"><span>Total</span><span class="price-amount">${gbp(p.total)}</span></div>
                                ${p.damagesDeposit > 0 ? `<div class="price-row" style="color:var(--text-muted);font-size:0.8rem;"><span>+ ${gbp(p.damagesDeposit)} refundable deposit</span><span>held on arrival, not charged</span></div>` : ''}
                                ${
                                    ps.deposit > 0
                                        ? `
                                <div class="price-row" style="color:#4CAF50;"><span>Paid${b.paymentMethod ? ' (' + escapeHtml(b.paymentMethod) + ')' : ''}${b.paymentDate ? ' on ' + b.paymentDate : ''}</span><span>− ${gbp(ps.deposit)}</span></div>
                                <div class="price-row total"><span>${ps.fullyPaid ? 'Paid in full' : 'Balance due'}</span><span class="price-amount" style="${ps.fullyPaid ? 'color:#4CAF50;' : ''}">${gbp(ps.fullyPaid ? ps.total : ps.balance)}</span></div>`
                                        : ''
                                }
                            </div>
                            </div>
                            <div class="card-actions">
                                ${upcoming && !ps.fullyPaid && payToken ? `<button class="btn-glass btn-sm" style="background:rgba(76,175,80,0.22);border-color:var(--booked-border);" onclick="openPayView('${payToken}', ${b.dbId}, 'balance')"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="5" width="20" height="14" rx="2.5"/><path d="M2 10h20"/></svg> Pay balance ${gbp(ps.balance)}</button>` : ''}
                                <button class="btn-sm btn-edit" onclick="downloadInvoice('${b.id}')"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v10M8 11l4 4 4-4M5 19h14"/></svg> Invoice</button>
                                <button class="btn-sm btn-edit" onclick="addBookingToCalendar('${b.id}')"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4.5" width="18" height="16" rx="2.5"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/></svg> Add to Calendar</button>
                                <button class="btn-sm btn-edit" onclick="openTermsModal(event, '${propKey}')"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 4h9a3 3 0 0 1 3 3v13H9a3 3 0 0 1-3-3z"/><path d="M6 17h12"/></svg> Terms</button>
                                ${upcoming ? faqBlockHtml(propKey) : ''}
                                ${upcoming ? guestWelcomeButton(propKey) : ''}
                                ${!upcoming ? `<button class="btn-sm btn-edit" onclick="rebookCottage('${propKey}')"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 1 3 6.7"/><path d="M3 21v-5h5"/></svg> Book again</button>` : ''}
                                ${!upcoming && !reviewShown.has(propKey) && reviewShown.add(propKey) ? guestReviewButton(propKey) : ''}
                                ${!upcoming && !photoShown.has(propKey) && photoShown.add(propKey) ? guestPhotoButton(propKey) : ''}
                            </div>
                            ${!upcoming && reviewShown.has(propKey) ? guestReviewForm(propKey) : ''}
                        </div>
                    </div>
                </div>`;
        (upcoming ? upcomingCards : pastCards).push(__card);

        // While a stay is in progress, gather its in-stay actions into one
        // prominent "My Stay" hub (rendered at the top of the list). The
        // .instay-tides element keeps its class so renderInStayTides() fills it.
        // All tiles reuse existing functions.
        // The "My Stay" hub (directions, welcome book…) is the in-trip
        // experience — only surface it once the holiday is paid in full. An
        // unpaid current stay still shows in the list below with a Pay button.
        if (currentStay && ps.fullyPaid) {
            const nightsLeft = Math.max(0, nightsBetween(todayStr, b.checkOut));
            hubCards.push(`
                    <div class="glass-panel my-stay-hub">
                        <div class="hub-head">
                            <span class="legend-swatch swatch-${propKey}"></span>
                            <div>
                                <div class="hub-title">You're staying at <strong>${escapeHtml(meta.name)}</strong></div>
                                <div class="hub-sub">Until ${b.checkOut} · ${b.checkOutTime || '10:00'} · ${nightsLeft} night${nightsLeft === 1 ? '' : 's'} left</div>
                            </div>
                        </div>
                        <div class="instay-tides" style="margin-top:12px;"></div>
                        <div class="hub-grid">
                            <button class="hub-tile" onclick="openCottageDirections('${propKey}')"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-6.5-5.5-6.5-10a6.5 6.5 0 0 1 13 0c0 4.5-6.5 10-6.5 10z"/><circle cx="12" cy="11" r="2.2"/></svg><span>Directions</span></button>
                            <button class="hub-tile" onclick="openWelcomeBook('${propKey}')"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5a2 2 0 0 1 2-2h6v18H6a2 2 0 0 1-2-2z"/><path d="M20 5a2 2 0 0 0-2-2h-6v18h6a2 2 0 0 0 2-2z"/></svg><span>Welcome book</span></button>
                            <button class="hub-tile" onclick="openFaqModal('${propKey}')"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 0 1 4.5 1.5c0 1.7-2 2-2 3.2"/><path d="M12 17h.01"/></svg><span>Good to know</span></button>
                            <button class="hub-tile" onclick="toggleChat()"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5h16v11H8l-4 4z"/></svg><span>Contact host</span></button>
                            <button class="hub-tile" onclick="openTermsModal(event, '${propKey}')"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 4h9a3 3 0 0 1 3 3v13H9a3 3 0 0 1-3-3z"/><path d="M6 17h12"/></svg><span>Terms</span></button>
                        </div>
                    </div>`);
        }
    });
    const gHdr = (t) =>
        `<h3 style="font-family:var(--font-serif);font-size:1.2rem;font-weight:600;margin:18px 2px 10px;color:var(--text-light);">${t}</h3>`;
    // Each section's cards sit in their own .gb-grid so the desktop two-up
    // layout works per section (an odd last card spans the full row).
    const gGrid = (cards) => `<div class="gb-grid">${cards.join('')}</div>`;
    list.innerHTML =
        guestPushPromptHtml(hasUpcoming) +
        loyaltyBannerHtml(completedStays) +
        (hubCards.length ? gHdr('Your stay') + hubCards.join('') : '') +
        pendingHtml +
        (upcomingCards.length ? gHdr('Upcoming stays') + gGrid(upcomingCards) : '') +
        (pastCards.length ? gHdr('Past stays') + gGrid(pastCards) : '');

    // Fill any in-stay tide cards (mid-stay guests).
    if (currentStays.length) renderInStayTides();
}

// ---- In-stay "tide of the day" card (My Bookings + My Stay hub) ----
async function renderInStayTides() {
    const els = document.querySelectorAll('.instay-tides');
    if (!els.length) return;
    let data;
    try {
        data = await apiGet('tides.php?start=' + todayDashed() + '&days=1');
    } catch (e) {
        els.forEach((el) => (el.style.display = 'none'));
        return;
    }
    if (!data || !data.ok || !Array.isArray(data.extremes)) {
        els.forEach((el) => (el.style.display = 'none'));
        return;
    }
    const today = todayDashed();
    const lows = [],
        highs = [];
    data.extremes.forEach((e) => {
        if (!e.time) return;
        const d = new Date(e.time);
        if (isNaN(d)) return;
        const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        if (ds !== today) return;
        const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
        if (/low/i.test(e.type)) lows.push(hm);
        else if (/high/i.test(e.type)) highs.push(hm);
    });
    if (!lows.length && !highs.length) {
        els.forEach((el) => (el.style.display = 'none'));
        return;
    }
    const parts = [];
    if (lows.length) parts.push(`<strong>Low</strong> ${lows.join(' & ')}`);
    if (highs.length) parts.push(`<strong>High</strong> ${highs.join(' & ')}`);
    const html = `<div style="background:rgba(66,165,245,0.12);border:1px solid rgba(66,165,245,0.3);border-radius:12px;padding:12px 14px;">
                <div style="font-size:0.85rem;color:var(--text-light);">🌊 Today's tides at Blakeney — ${parts.join(' · ')}</div>
                <div style="font-size:0.76rem;color:var(--text-muted);margin-top:5px;">Lovely beach &amp; coast-path walking around low water; seal-trip boats sail near high tide.</div>
            </div>`;
    els.forEach((el) => {
        el.innerHTML = html;
        el.style.display = '';
    });
}

const IC_PIN =
    '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-6-5.2-6-10a6 6 0 1 1 12 0c0 4.8-6 10-6 10z"/><circle cx="12" cy="11" r="2.2"/></svg>';
const IC_LOCK =
    '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>';
const IC_CHECK =
    '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M8.5 12.5l2.5 2.5 4.5-5"/></svg>';

// Lazy-load Leaflet (open-source map library) only when a guest is near.
let __leafletLoader = null;
function loadLeaflet() {
    if (window.L) return Promise.resolve();
    if (__leafletLoader) return __leafletLoader;
    __leafletLoader = new Promise((resolve, reject) => {
        const css = document.createElement('link');
        css.rel = 'stylesheet';
        css.href = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css';
        document.head.appendChild(css);
        const js = document.createElement('script');
        js.src = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js';
        js.onload = () => resolve();
        js.onerror = () => {
            __leafletLoader = null;
            reject(new Error('map load failed'));
        };
        document.head.appendChild(js);
    });
    return __leafletLoader;
}

// ===================================================================
//  GUEST ONLINE PAYMENT (Square Web Payments SDK, token-gated)
// ===================================================================
let __squareSdkLoader = null;
function loadSquareSdk(env) {
    if (window.Square) return Promise.resolve();
    if (__squareSdkLoader) return __squareSdkLoader;
    const host =
        env === 'production' ? 'https://web.squarecdn.com' : 'https://sandbox.web.squarecdn.com';
    __squareSdkLoader = new Promise((resolve, reject) => {
        const js = document.createElement('script');
        js.src = host + '/v1/square.js';
        js.onload = () => resolve();
        js.onerror = () => {
            __squareSdkLoader = null;
            reject(new Error('Square could not be reached. Please try again.'));
        };
        document.head.appendChild(js);
    });
    return __squareSdkLoader;
}
const payState = { token: '', bookingId: 0, kind: 'deposit', amountDue: 0 };
let squarePayments = null,
    squareCard = null;
function setPayMsg(text) {
    const el = document.getElementById('pay-msg');
    if (!el) return;
    el.textContent = text || '';
    el.classList.toggle('show', !!text);
}
function showPayError(text) {
    ['pay-loading', 'pay-body', 'pay-done'].forEach((id) => {
        const e = document.getElementById(id);
        if (e) e.style.display = 'none';
    });
    const err = document.getElementById('pay-error'),
        msg = document.getElementById('pay-error-msg');
    if (msg) msg.textContent = text || 'Something went wrong.';
    if (err) err.style.display = '';
}
// Opened from a secure pay link (?pay=<token>&b=<id>&k=<kind>) parsed at boot.
async function openPayView(token, bookingId, kind) {
    try {
        trackEvent('pay_start', '');
    } catch (e) {}
    payState.token = token;
    payState.bookingId = bookingId;
    payState.kind = kind === 'balance' ? 'balance' : 'deposit';
    squareCard = null;
    ['pay-body', 'pay-done', 'pay-error'].forEach((id) => {
        const e = document.getElementById(id);
        if (e) e.style.display = 'none';
    });
    const ld = document.getElementById('pay-loading');
    if (ld) ld.style.display = '';
    const cardEl = document.getElementById('sq-card');
    if (cardEl) cardEl.innerHTML = '';
    setPayMsg('');
    nav('view-pay');
    try {
        const cfg = await apiGet('square-config.php');
        if (!cfg.enabled || !cfg.applicationId || !cfg.locationId)
            throw new Error('Online payment is not available right now.');
        const s = await apiPost('pay.php', {
            action: 'summary',
            booking_id: payState.bookingId,
            token: payState.token,
            kind: payState.kind,
        });
        payState.amountDue = s.amountDue;
        const propEl = document.getElementById('pay-prop');
        if (propEl) propEl.textContent = `${s.propName} · ${s.checkIn} → ${s.checkOut}`;
        document.getElementById('pay-kind-label').textContent =
            s.kind === 'hold'
                ? 'Refundable security hold'
                : s.kind === 'balance'
                  ? 'Balance due'
                  : 'Deposit due';
        document.getElementById('pay-amount').textContent = gbp(s.amountDue);
        document.getElementById('pay-amount-sub').textContent =
            s.kind === 'hold'
                ? 'held, not charged — released after checkout'
                : s.kind === 'balance'
                  ? `of ${gbp(s.total)} total`
                  : `${s.depositPct}% deposit · ${gbp(s.total)} total`;
        try {
            const pb = document.getElementById('pay-btn');
            if (pb) pb.textContent = s.kind === 'hold' ? 'Place hold' : 'Pay now';
        } catch (e) {}
        if (!(s.amountDue > 0)) {
            showPayError("This booking is already settled — there's nothing left to pay.");
            return;
        }
        await loadSquareSdk(cfg.environment);
        squarePayments = window.Square.payments(cfg.applicationId, cfg.locationId);
        squareCard = await squarePayments.card();
        await squareCard.attach('#sq-card');
        try {
            await mountWallets(s.amountDue);
        } catch (e) {} // Apple/Google Pay (best-effort)
        if (ld) ld.style.display = 'none';
        document.getElementById('pay-body').style.display = '';
    } catch (e) {
        showPayError(e.message || 'Could not load the payment form.');
    }
}
// Charge a Square token (from the card field OR an Apple/Google Pay wallet)
// through the same server endpoint, then show the receipt state.
async function payWithToken(sourceId) {
    // A damages deposit is an AUTHORISATION (hold), not a charge.
    if (payState.kind === 'hold') {
        await apiPost('pay.php', {
            action: 'authorize',
            booking_id: payState.bookingId,
            token: payState.token,
            kind: 'hold',
            source_id: sourceId,
        });
        document.getElementById('pay-body').style.display = 'none';
        document.getElementById('pay-done-sub').textContent =
            "Your refundable security hold is in place — held, not charged. It's released after checkout, provided there's no damage.";
        document.getElementById('pay-done').style.display = '';
        try {
            toast('Card hold placed — thank you!');
        } catch (e) {}
        return;
    }
    const res = await apiPost('pay.php', {
        action: 'charge',
        booking_id: payState.bookingId,
        token: payState.token,
        kind: payState.kind,
        source_id: sourceId,
    });
    document.getElementById('pay-body').style.display = 'none';
    document.getElementById('pay-done-sub').textContent = res.fullyPaid
        ? 'Your booking is now paid in full. We look forward to welcoming you.'
        : `Thank you — ${gbp(res.paid)} received. We'll be in touch about the remaining balance before your stay.`;
    document.getElementById('pay-done').style.display = '';
    try {
        toast('Payment received — thank you!');
    } catch (e) {}
}
// Try to mount Apple Pay / Google Pay buttons for the exact amount due. Each
// is independent + best-effort: an unsupported wallet is simply hidden and the
// card field still works. Reveals the "or pay by card" divider if any mounted.
async function mountWallets(amountDue) {
    const wrap = document.getElementById('sq-wallets');
    if (!wrap || !squarePayments) return;
    wrap.innerHTML = '';
    let any = false;
    let req;
    try {
        req = squarePayments.paymentRequest({
            countryCode: 'GB',
            currencyCode: 'GBP',
            total: { amount: Number(amountDue).toFixed(2), label: 'Cottage Holidays Blakeney' },
        });
    } catch (e) {
        return;
    }
    const walletPay = async (wallet) => {
        setPayMsg('');
        try {
            const result = await wallet.tokenize();
            if (result.status !== 'OK')
                throw new Error(
                    (result.errors && result.errors[0] && result.errors[0].message) ||
                        'Payment was cancelled.',
                );
            await payWithToken(result.token);
        } catch (e) {
            setPayMsg(e.message || 'Payment failed. Please try again.');
        }
    };
    try {
        const gp = await squarePayments.googlePay(req);
        const el = document.createElement('div');
        el.id = 'sq-gpay';
        wrap.appendChild(el);
        await gp.attach('#sq-gpay', {
            buttonColor: 'black',
            buttonType: 'long',
            buttonSizeMode: 'fill',
        });
        el.addEventListener('click', async (e) => {
            e.preventDefault();
            await walletPay(gp);
        });
        any = true;
    } catch (e) {
        const x = document.getElementById('sq-gpay');
        if (x) x.remove();
    }
    try {
        const ap = await squarePayments.applePay(req);
        const btn = document.createElement('button');
        btn.id = 'sq-apay';
        btn.type = 'button';
        btn.className = 'sq-apple-btn';
        btn.setAttribute('aria-label', 'Pay with Apple Pay');
        wrap.appendChild(btn);
        btn.addEventListener('click', async () => {
            await walletPay(ap);
        });
        any = true;
    } catch (e) {
        const x = document.getElementById('sq-apay');
        if (x) x.remove();
    }
    const orEl = document.getElementById('sq-or');
    if (orEl) orEl.style.display = any ? '' : 'none';
}
async function submitPayment() {
    if (!squareCard) return;
    setPayMsg('');
    const btn = document.getElementById('pay-btn');
    const orig = btn ? btn.textContent : '';
    if (btn) {
        btn.disabled = true;
        btn.classList.add('is-busy');
        btn.textContent = 'Processing…';
    }
    try {
        const result = await squareCard.tokenize();
        if (result.status !== 'OK') {
            const m =
                (result.errors && result.errors[0] && result.errors[0].message) ||
                'Please check your card details and try again.';
            throw new Error(m);
        }
        await payWithToken(result.token);
    } catch (e) {
        setPayMsg(e.message || 'Payment failed. Please try again.');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.classList.remove('is-busy');
            btn.textContent = orig;
        }
    }
}
// Opened from a post-checkout review-request email (?review=<prop>): take a
// logged-in guest to My Bookings (where the review form lives), else prompt login.
function maybeOpenReviewLink() {
    try {
        const usp = new URLSearchParams(window.location.search);
        if (!usp.has('review')) return false;
        if (currentGuest) {
            nav('view-guest-bookings');
            renderGuestBookings();
        } else {
            openGuestArea();
        }
        return true;
    } catch (e) {
        return false;
    }
}
// If the page was opened from a pay link, jump straight to the payment view.
function maybeOpenPayLink() {
    try {
        const usp = new URLSearchParams(window.location.search);
        // Damage-deposit card hold link: ?hold=<token>&b=<id>
        const h = usp.get('hold');
        const hb = parseInt(usp.get('b'), 10);
        if (h && hb) {
            openPayView(h, hb, 'hold');
            return true;
        }
        const t = usp.get('pay');
        const b = parseInt(usp.get('b'), 10);
        const k = usp.get('k') === 'balance' ? 'balance' : 'deposit';
        if (t && b) {
            openPayView(t, b, k);
            return true;
        }
    } catch (e) {}
    return false;
}

// ---- Directions provider: native maps app by device, with a manual override ----
// Embedded map stays OpenStreetMap; only the "Get directions" hand-off changes.
function isAppleDevice() {
    const ua = navigator.userAgent || '';
    return (
        /iPad|iPhone|iPod/.test(ua) ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
    );
}
let mapProvider = (() => {
    try {
        const s = localStorage.getItem('chb-map-provider');
        if (s === 'apple' || s === 'google') return s;
    } catch (e) {}
    return isAppleDevice() ? 'apple' : 'google';
})();
function directionsUrl(lat, lng) {
    return mapProvider === 'apple'
        ? `https://maps.apple.com/?daddr=${lat},${lng}&dirflg=d`
        : `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`;
}

// ---- Directions to the cottage (no key code, no GPS tracking) ----
// Opens the device's maps app routed to the cottage. Uses the owner-set
// coordinates (geo-<propKey>) when available, else a name search for the
// cottage in Blakeney. Coordinates are fetched once and cached.
const __cottageGeoCache = {};
async function openCottageDirections(propKey) {
    let geo = __cottageGeoCache[propKey];
    if (!geo) {
        try {
            const res = await apiPost('arrival-access.php', { prop_key: propKey });
            if (res && res.lat != null && res.lng != null)
                geo = __cottageGeoCache[propKey] = { lat: res.lat, lng: res.lng };
        } catch (e) {
            /* fall back to a name search */
        }
    }
    const meta = propertyMeta[propKey] || { name: propKey };
    const dest = encodeURIComponent((meta.name || 'cottage') + ', Blakeney, Norfolk, UK');
    const url = geo
        ? directionsUrl(geo.lat, geo.lng)
        : mapProvider === 'apple'
          ? `https://maps.apple.com/?daddr=${dest}&dirflg=d`
          : `https://www.google.com/maps/dir/?api=1&destination=${dest}&travelmode=driving`;
    try {
        window.open(url, '_blank', 'noopener');
    } catch (e) {
        location.href = url;
    }
}

// ---- Web Push: subscribe this device so check-in alerts arrive even when the
//      app is closed (sent on a time trigger by push.php's cron). All optional —
//      if VAPID keys aren't configured server-side, this silently does nothing. ----
let __vapidKey = null;
async function getVapidKey() {
    if (__vapidKey !== null) return __vapidKey;
    try {
        const r = await apiGet('push.php?action=key');
        __vapidKey = r.key || '';
    } catch (e) {
        __vapidKey = '';
    }
    return __vapidKey;
}
function urlB64ToUint8(b64) {
    const pad = '='.repeat((4 - (b64.length % 4)) % 4);
    const s = (b64 + pad).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(s);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
}
async function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return null;
    // When a new release is deployed, the service worker pings open pages to
    // refresh so they pick up the new build (only the owner's devices get this).
    if (!window.__chbReloadWired) {
        window.__chbReloadWired = true;
        navigator.serviceWorker.addEventListener('message', (e) => {
            if (e.data && e.data.type === 'chb-reload') {
                try {
                    toast('Updating to the new version…');
                } catch (_) {}
                setTimeout(reloadForUpdate, 1200);
            } else if (e.data && e.data.type === 'chb-synced') {
                // The SW replayed queued offline writes in the background — refresh.
                try {
                    oqRefreshCount();
                } catch (_) {}
                try {
                    if (typeof loadExpenses === 'function')
                        loadExpenses().then(() => {
                            if (document.querySelector('#asec-expenses')) renderExpenses();
                            try {
                                renderMoneyOverview();
                            } catch (_) {}
                        });
                } catch (_) {}
                try {
                    if (typeof loadAdminMessages === 'function') loadAdminMessages();
                } catch (_) {}
            }
        });
    }
    try {
        return await navigator.serviceWorker.register('sw.js');
    } catch (e) {
        return null;
    }
}
// ---- Auto-update: remember where the owner was, so a release reload returns
// them to the same screen (and scroll) instead of the public home page. The
// snapshot lives in sessionStorage (survives a reload, dies with the tab) and
// is only honoured if it's fresh (< 2 min) and an admin is still signed in.
function captureAdminState() {
    try {
        if (!document.body.classList.contains('owner-mode')) return;
        const av = document.querySelector('.page-view.active');
        sessionStorage.setItem(
            'chb-admin-state',
            JSON.stringify({
                view: av ? av.id : '',
                scrollY: window.scrollY || window.pageYOffset || 0,
                settingsPath: __settingsPath || null,
                accountsSection: __accountsSection || null,
                at: Date.now(),
            }),
        );
    } catch (_) {}
}
async function restoreAdminState() {
    let s = null;
    try {
        s = JSON.parse(sessionStorage.getItem('chb-admin-state') || 'null');
    } catch (_) {}
    try {
        sessionStorage.removeItem('chb-admin-state');
    } catch (_) {}
    if (!s || !s.view || !isAuthenticated) return;
    if (Date.now() - (s.at || 0) > 120000) return; // only a fresh snapshot
    if (s.view === 'view-main' || !/^view-/.test(s.view)) return;
    try {
        if (s.view === 'view-settings') {
            const p = s.settingsPath;
            await openSettings(p && p.section ? p.section : undefined);
            // Replay the drill-down into the exact folder / sub-folder.
            if (p && p.prop) {
                if (p.section === 'accom') {
                    settingsOpenAccom(p.prop);
                    if (p.accomSec) settingsOpenAccomSec(p.prop, p.accomSec);
                } else if (p.section === 'calendar') {
                    await settingsOpenCalendar(p.prop);
                } else if (p.section === 'cancel') {
                    settingsOpenCancel(p.prop);
                }
            }
        } else if (s.view === 'view-accounts') {
            await openAccounts();
            if (s.accountsSection) accountsOpen(s.accountsSection);
        } else {
            nav(s.view);
        }
        if (s.scrollY)
            setTimeout(() => {
                try {
                    window.scrollTo({ top: s.scrollY, behavior: 'auto' });
                } catch (_) {}
            }, 350);
    } catch (_) {}
}
function reloadForUpdate() {
    captureAdminState();
    try {
        location.reload();
    } catch (_) {}
}
// Reliable auto-update: while signed in as admin, poll the deployed build id
// and silently reload the open page when a new release lands — no click, no
// re-login (the session cookie survives a reload). Independent of web-push,
// so it works even where push isn't delivered. Admin-only so a guest is never
// interrupted mid-booking.
let __verTimer = null,
    __verReloading = false;
function startVersionWatch() {
    if (__verTimer) return;
    const check = async () => {
        if (__verReloading) return;
        if (document.visibilityState !== 'visible') return;
        if (!document.body.classList.contains('owner-mode')) return;
        try {
            const r = await fetchWithTimeout(API_BASE + 'version.php', { cache: 'no-store' }, 8000);
            if (!r.ok) return;
            const d = await r.json();
            if (d && d.build && window.__BUILD && d.build !== window.__BUILD) {
                __verReloading = true;
                try {
                    toast('Updating to the new version…');
                } catch (_) {}
                setTimeout(reloadForUpdate, 1200);
            }
        } catch (e) {
            /* transient — try again next tick */
        }
    };
    __verTimer = setInterval(check, 90000); // every 90s
    document.addEventListener('visibilitychange', check);
    window.addEventListener('focus', check);
}
// Customers get the same silent auto-update, but ONLY while the page is
// idle — we never reload in the middle of an interaction, an open modal,
// the chat, or a booking. So unlike the admin watch, this does NOT react to
// focus/visibility (that's when they're actively returning); it reloads only
// on the idle tick once there's been no input for a while.
let __gVerTimer = null,
    __gVerReloading = false,
    __gLastInput = Date.now();
const __G_IDLE_MS = 45000;
['pointerdown', 'keydown', 'touchstart', 'wheel', 'scroll', 'click'].forEach(function (ev) {
    window.addEventListener(
        ev,
        function () {
            __gLastInput = Date.now();
        },
        { passive: true },
    );
});
function startGuestVersionWatch() {
    if (__gVerTimer) return;
    const check = async () => {
        if (__gVerReloading) return;
        if (document.visibilityState !== 'visible') return;
        if (document.body.classList.contains('owner-mode')) return; // admin uses startVersionWatch
        if (Date.now() - __gLastInput < __G_IDLE_MS) return; // still interacting — leave them be
        if (document.querySelector('.modal-overlay.open, .pop-modal.open, #chat-widget.open'))
            return; // mid-task
        try {
            const r = await fetchWithTimeout(API_BASE + 'version.php', { cache: 'no-store' }, 8000);
            if (!r.ok) return;
            const d = await r.json();
            if (d && d.build && window.__BUILD && d.build !== window.__BUILD) {
                __gVerReloading = true;
                try {
                    location.reload();
                } catch (_) {
                    __gVerReloading = false;
                }
            }
        } catch (e) {
            /* transient — retry next tick */
        }
    };
    __gVerTimer = setInterval(check, 60000); // every 60s, gated on idle above
}
async function enableArrivalPush() {
    try {
        if (!currentGuest) return;
        if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
        if (!('Notification' in window) || Notification.permission !== 'granted') return;
        const key = await getVapidKey();
        if (!key) return; // server has no VAPID keys yet — feature off
        const reg = await registerServiceWorker();
        if (!reg) return;
        let sub = await reg.pushManager.getSubscription();
        if (!sub) {
            sub = await reg.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: urlB64ToUint8(key),
            });
        }
        await apiPost('push.php', { action: 'subscribe', subscription: sub.toJSON() });
    } catch (e) {
        /* push is best-effort; never break the page */
    }
}
// Contextual opt-in shown to a logged-in guest with an upcoming stay. The
// soft in-app card (guestPushPromptHtml) calls this; we ask for permission
// and subscribe this device. On iOS, push only works once the site is added
// to the Home Screen, so we guide the guest there instead of failing silently.
async function enableGuestPush() {
    try {
        if (!currentGuest) return;
        const supported =
            'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
        const standalone =
            (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
            window.navigator.standalone === true;
        if (!supported) {
            if (isAppleDevice() && !standalone)
                glassAlert(
                    'To get notifications on iPhone or iPad, first add this site to your Home Screen (tap Share → Add to Home Screen), then open it from there and try again.',
                );
            else glassAlert('This device or browser doesn’t support notifications.');
            return;
        }
        const perm = await Notification.requestPermission();
        if (perm !== 'granted') {
            glassAlert(
                'Notifications are blocked. You can allow them for this site in your browser settings, then try again.',
            );
            dismissGuestPushPrompt();
            return;
        }
        await enableArrivalPush(); // subscribes this device under the guest
        dismissGuestPushPrompt();
        toast('Notifications on — we’ll keep you posted about your stay.');
    } catch (e) {
        glassAlert("Couldn't enable notifications: " + (e.message || e));
    }
}
// Hide (and remember) the opt-in card so we don't nag on every render.
function dismissGuestPushPrompt() {
    try {
        localStorage.setItem('chb-guest-push-prompt', '1');
    } catch (e) {}
    const el = document.getElementById('guest-push-prompt');
    if (el) el.remove();
}
// Returning-guest welcome offer — shown once a guest has at least one
// completed stay. Informational: the owner applies the rate on enquiry
// (mirrors how pricing/overrides already work), so nothing is auto-discounted.
function loyaltyBannerHtml(n) {
    if (!n || n < 1) return '';
    return `<div class="glass-panel" style="padding:16px 18px;margin-bottom:16px;border:1px solid var(--accent-soft);display:flex;align-items:center;gap:12px;">
                <span style="font-size:1.5rem;" aria-hidden="true">🌿</span>
                <div>
                    <div style="font-weight:600;margin-bottom:2px;">Welcome back!</div>
                    <div style="font-size:0.85rem;color:var(--text-muted);">Thank you for ${n === 1 ? 'staying' : 'returning to stay'} with us. As a returning guest you're entitled to our <strong style="color:var(--text-light);">returning-guest rate</strong> — just mention it when you enquire and we'll apply it to your next booking.</div>
                </div>
            </div>`;
}
// Markup for the opt-in card — only when there's an upcoming stay, the guest
// hasn't dismissed it, and they haven't already granted/denied permission.
function guestPushPromptHtml(hasUpcoming) {
    if (!hasUpcoming) return '';
    try {
        if (localStorage.getItem('chb-guest-push-prompt') === '1') return '';
    } catch (e) {}
    const hasNoti = 'Notification' in window;
    if (hasNoti && Notification.permission !== 'default') return ''; // already decided
    if (!hasNoti && !isAppleDevice()) return ''; // genuinely unsupported
    return `<div id="guest-push-prompt" class="glass-panel" style="padding:16px 18px;margin-bottom:16px;display:flex;align-items:center;gap:14px;flex-wrap:wrap;">
                <div style="flex:1;min-width:200px;">
                    <div style="font-weight:600;margin-bottom:2px;">Get stay notifications</div>
                    <div style="font-size:0.85rem;color:var(--text-muted);">Arrival info &amp; your key code, balance reminders and booking updates — straight to this device.</div>
                </div>
                <div style="display:flex;gap:8px;">
                    <button class="btn-glass btn-sm" onclick="enableGuestPush()">Turn on</button>
                    <button class="btn-sm btn-edit" onclick="dismissGuestPushPrompt()">Not now</button>
                </div>
            </div>`;
}
// ---- Owner (admin) push alerts: enable per device + test ----
async function enableOwnerPush() {
    try {
        if (
            !('serviceWorker' in navigator) ||
            !('PushManager' in window) ||
            !('Notification' in window)
        ) {
            glassAlert('This device or browser doesn’t support notifications.');
            return;
        }
        const perm = await Notification.requestPermission();
        if (perm !== 'granted') {
            glassAlert(
                'Notifications are blocked. Enable them for this site in your browser settings, then try again.',
            );
            renderNotifySettings();
            return;
        }
        const key = await getVapidKey();
        if (!key) {
            glassAlert('Push isn’t configured on the server yet (VAPID keys in config.php).');
            return;
        }
        const reg = await registerServiceWorker();
        if (!reg) {
            glassAlert('Could not register the notification worker.');
            return;
        }
        let sub = await reg.pushManager.getSubscription();
        if (!sub)
            sub = await reg.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: urlB64ToUint8(key),
            });
        await apiPost('push.php', { action: 'subscribe_admin', subscription: sub.toJSON() });
        toast('This device will now receive owner alerts.');
        renderNotifySettings();
    } catch (e) {
        glassAlert("Couldn't enable notifications: " + (e.message || e));
    }
}
async function testOwnerPush() {
    try {
        await apiGet('push.php?action=test_admin');
        toast('Test alert sent — check your notifications.');
    } catch (e) {
        glassAlert("Couldn't send test: " + (e.message || e));
    }
}
function renderNotifySettings() {
    const wrap = document.getElementById('notify-body');
    if (!wrap) return;
    const supported =
        'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
    const perm = (window.Notification && Notification.permission) || 'default';
    const status = !supported
        ? 'Not supported on this device or browser.'
        : perm === 'granted'
          ? 'Notifications are allowed on this browser.'
          : perm === 'denied'
            ? 'Notifications are blocked — enable them for this site in your browser settings.'
            : 'Not enabled yet on this device.';
    wrap.innerHTML = `<div class="accounts-stat" style="max-width:560px;">
                <div class="label">Owner alerts on this device</div>
                <p style="font-size:0.85rem;color:var(--text-muted);margin:6px 0 12px;">Get a notification on this device for new enquiries, guest messages, payments, and when a new version of your site goes live. Enable it once on each device (phone, laptop) you want alerts on.</p>
                <p style="font-size:0.82rem;color:var(--text-light);margin:0 0 14px;">${status}</p>
                <div style="display:flex;gap:8px;flex-wrap:wrap;">
                    <button class="btn-sm btn-edit" onclick="enableOwnerPush()">Enable on this device</button>
                    <button class="btn-sm btn-edit" onclick="testOwnerPush()">Send test</button>
                </div>
            </div>
            <div class="accounts-stat" style="max-width:560px;margin-top:16px;">
                <div class="label">Email recipients</div>
                <p style="font-size:0.85rem;color:var(--text-muted);margin:6px 0 12px;">Who gets emailed about new bookings, enquiries, guest messages, payments and reviews. Add a partner or co-host and they're copied on every alert.</p>
                <div id="notify-emails-list"><p style="font-size:0.82rem;color:var(--text-muted);">Loading…</p></div>
                <form onsubmit="addNotifyEmail(event)" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;">
                    <input type="email" id="notify-email-input" class="input-glass field-sm" placeholder="name@example.com" autocomplete="off" style="flex:1;min-width:200px;margin:0;">
                    <button type="submit" class="btn-sm btn-edit">Add address</button>
                </form>
                <p id="notify-email-msg" style="font-size:0.8rem;margin:8px 0 0;min-height:1em;" aria-live="polite"></p>
                <div style="margin-top:14px;border-top:1px solid var(--glass-border);padding-top:12px;">
                    <div style="font-size:0.8rem;color:var(--text-muted);margin-bottom:8px;">Reply-by-email: reply to a "new website message" alert and the guest gets it on the website &amp; by email.</div>
                    <button class="btn-sm btn-edit" onclick="diagnoseReplyEmail(this)">Check reply-by-email</button>
                    <div id="reply-diag" style="font-size:0.8rem;margin-top:10px;"></div>
                </div>
            </div>`;
    loadNotifyEmails();
}
// Read-only check of the zero-setup reply-by-email: does the mailbox
// connect, and what did the newest replies do? Nothing is delivered.
async function diagnoseReplyEmail(btn) {
    const box = document.getElementById('reply-diag');
    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Checking…';
    }
    try {
        const d = await apiGet('mailbox-read.php?debug=1');
        if (!d.enabled) {
            box.innerHTML = `<span style="color:var(--warn-text);">Reply-by-email isn't on yet — set up SMTP email first (or you've set REPLY_INBOX for the webhook route).</span>`;
        } else {
            const st = d.selftest || {};
            const head = st.ok
                ? `<span style="color:var(--ok-text);">Mailbox connected — reads ${escapeHtml(d.reply_to || '')} via ${escapeHtml(d.host || '')}.</span>`
                : `<span style="color:var(--danger);">Couldn't read the mailbox: ${escapeHtml(st.reason || 'unknown')} (${escapeHtml(d.host || '')}). Enable POP3 for the mailbox, or set MAIL_POP_HOST.</span>`;
            const msgs = (d.preview && d.preview.messages) || [];
            const rmap = {
                delivered: '✓ would post to the guest',
                'empty-after-strip': 'reply was empty after removing the quote',
                'sender-not-owner': 'from an address not on your list',
                'no-thread-token': 'not a reply to a website message',
            };
            const rows = msgs.length
                ? msgs
                      .map(
                          (m) =>
                              `<div style="padding:6px 0;border-top:1px solid var(--glass-border);">
                            <div><strong>${escapeHtml(m.from || '?')}</strong> — ${escapeHtml(rmap[m.reason] || m.reason || '')}</div>
                            ${m.strippedPreview ? `<div style="color:var(--text-muted);">“${escapeHtml(m.strippedPreview)}”</div>` : ''}
                        </div>`,
                      )
                      .join('')
                : `<div style="color:var(--text-muted);margin-top:6px;">No recent messages in the mailbox to show.</div>`;
            box.innerHTML = head + `<div style="margin-top:8px;">${rows}</div>`;
        }
    } catch (e) {
        box.innerHTML = `<span style="color:var(--danger);">Check failed: ${escapeHtml(e.message || 'error')}</span>`;
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.textContent = 'Check reply-by-email';
        }
    }
}
// ---- Owner email recipients (Settings → Notifications) ----
async function loadNotifyEmails() {
    const box = document.getElementById('notify-emails-list');
    if (!box) return;
    let d;
    try {
        d = await apiPost('notify-recipients.php', { action: 'list' });
    } catch (e) {
        box.innerHTML = `<p style="font-size:0.82rem;color:var(--danger);">Couldn't load the list.</p>`;
        return;
    }
    renderNotifyEmails(d.primary, d.extras || []);
}
function renderNotifyEmails(primary, extras) {
    const box = document.getElementById('notify-emails-list');
    if (!box) return;
    const primaryRow = primary
        ? `<div class="notify-row"><span class="notify-addr">${escapeHtml(primary)}</span><span class="notify-primary-tag">Primary</span></div>`
        : `<div class="notify-row"><span class="notify-addr" style="color:var(--warn-text);">No primary owner email set in config.php</span></div>`;
    const extraRows = (extras || [])
        .map(
            (e) =>
                `<div class="notify-row"><span class="notify-addr">${escapeHtml(e)}</span><button class="notify-remove" onclick="removeNotifyEmail('${escapeHtml(e).replace(/'/g, "\\'")}')" aria-label="Remove ${escapeHtml(e)}" title="Remove">&times;</button></div>`,
        )
        .join('');
    box.innerHTML = primaryRow + extraRows;
}
async function addNotifyEmail(ev) {
    if (ev) ev.preventDefault();
    const input = document.getElementById('notify-email-input');
    const msg = document.getElementById('notify-email-msg');
    const email = (input.value || '').trim();
    if (!email) return;
    if (msg) {
        msg.textContent = '';
        msg.style.color = '';
    }
    try {
        const d = await apiPost('notify-recipients.php', { action: 'add', email });
        if (!d.ok) throw new Error(d.error || 'Could not add that address');
        const list = await apiPost('notify-recipients.php', { action: 'list' });
        renderNotifyEmails(list.primary, list.extras || []);
        input.value = '';
        if (msg) {
            msg.textContent = 'Added — copied on all owner alerts from now on.';
            msg.style.color = 'var(--ok-text)';
        }
    } catch (e) {
        if (msg) {
            msg.textContent = e.message;
            msg.style.color = 'var(--danger)';
        }
    }
}
async function removeNotifyEmail(email) {
    if (!(await glassConfirm(`Stop sending owner alerts to ${email}?`))) return;
    try {
        await apiPost('notify-recipients.php', { action: 'remove', email });
        const list = await apiPost('notify-recipients.php', { action: 'list' });
        renderNotifyEmails(list.primary, list.extras || []);
    } catch (e) {
        glassAlert("Couldn't remove that address: " + e.message);
    }
}

// ---- Guest dashboard: "review your stay" ----
let myGuestReviews = {}; // { propKey: {stars, text, status} } for the logged-in guest
function guestReviewButton(propKey) {
    const existing = myGuestReviews[propKey];
    const meta = propertyMeta[propKey] || { name: propKey };
    if (!existing)
        return `<button class="btn-sm btn-edit" onclick="toggleGuestReview('${propKey}')"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.5l2.6 5.27 5.82.85-4.21 4.1.99 5.78L12 16.9l-5.2 2.6.99-5.78-4.21-4.1 5.82-.85z" fill="currentColor" stroke="none"/></svg> Review your stay</button>`;
    if (existing.status === 'approved')
        return `<button class="btn-sm btn-edit" onclick="toggleGuestReview('${propKey}')"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.5l2.6 5.27 5.82.85-4.21 4.1.99 5.78L12 16.9l-5.2 2.6.99-5.78-4.21-4.1 5.82-.85z" fill="currentColor" stroke="none"/></svg> Edit your review</button>`;
    if (existing.status === 'pending')
        return `<button class="btn-sm btn-edit" onclick="toggleGuestReview('${propKey}')"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.5l2.6 5.27 5.82.85-4.21 4.1.99 5.78L12 16.9l-5.2 2.6.99-5.78-4.21-4.1 5.82-.85z" fill="currentColor" stroke="none"/></svg> Review submitted</button>`;
    return `<button class="btn-sm btn-edit" onclick="toggleGuestReview('${propKey}')"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.5l2.6 5.27 5.82.85-4.21 4.1.99 5.78L12 16.9l-5.2 2.6.99-5.78-4.21-4.1 5.82-.85z" fill="currentColor" stroke="none"/></svg> Edit your review</button>`;
}
function guestPhotoButton(propKey) {
    return `<button class="btn-sm btn-edit" onclick="openPhotoUpload('${propKey}')"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="6" width="18" height="14" rx="2"/><circle cx="12" cy="13" r="3.5"/><path d="M8 6l1.5-2h5L16 6"/></svg> Share a photo</button>`;
}
// ---- In-stay welcome book (guest, booking-gated) ----
function guestWelcomeButton(propKey) {
    return `<button class="btn-sm btn-edit" onclick="openWelcomeBook('${propKey}')"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H19v15H6.5A2.5 2.5 0 0 0 4 20.5z"/><path d="M4 5.5V20.5"/></svg> Welcome book</button>`;
}
async function openWelcomeBook(propKey) {
    const meta = propertyMeta[propKey] || { name: propKey };
    const titleEl = document.getElementById('welcome-modal-title');
    const bodyEl = document.getElementById('welcome-modal-body');
    if (titleEl) titleEl.textContent = (meta.name || 'Your cottage') + ' — welcome book';
    if (bodyEl)
        bodyEl.innerHTML = `<p style="color:var(--text-muted);font-size:0.9rem;">Loading…</p>`;
    const m = document.getElementById('welcome-modal');
    if (m) m.classList.add('open');
    let sections = [];
    try {
        const r = await apiPost('welcome.php', { action: 'get', prop: propKey });
        sections = (r && r.sections) || [];
    } catch (e) {
        // Show the server's message directly (e.g. the payment-gate notice
        // "Your welcome book unlocks once your holiday balance is paid.").
        const msg = e && e.message ? escapeHtml(e.message) : '';
        if (bodyEl)
            bodyEl.innerHTML = `<p style="color:var(--text-muted);font-size:0.9rem;">${msg || "Couldn't load the welcome book — please try again."}</p>`;
        return;
    }
    if (!bodyEl) return;
    if (!sections.length) {
        bodyEl.innerHTML = `<p style="color:var(--text-muted);font-size:0.9rem;">Your host hasn't added a welcome book for this cottage yet. Anything you need? Just message us.</p>`;
        return;
    }
    bodyEl.innerHTML = sections
        .map(
            (s) => `
                <div style="margin-bottom:18px;">
                    <h4 style="font-family:var(--font-serif);font-size:1.1rem;margin:0 0 6px;">${escapeHtml(s.title)}</h4>
                    <div style="font-size:0.9rem;color:var(--text-light);line-height:1.6;white-space:pre-line;">${escapeHtml(s.body)}</div>
                </div>`,
        )
        .join('');
}
function closeWelcomeModal() {
    const m = document.getElementById('welcome-modal');
    if (m) m.classList.remove('open');
}
// ---- Guest photo submission (from My Bookings) ----
let __photoUploadProp = null;
function openPhotoUpload(propKey) {
    __photoUploadProp = propKey;
    const meta = propertyMeta[propKey] || { name: propKey };
    const nameEl = document.getElementById('pu-prop-name');
    if (nameEl) nameEl.textContent = meta.name;
    const fileEl = document.getElementById('pu-file');
    if (fileEl) fileEl.value = '';
    const capEl = document.getElementById('pu-caption');
    if (capEl) capEl.value = '';
    const msg = document.getElementById('pu-msg');
    if (msg) {
        msg.textContent = '';
    }
    const m = document.getElementById('photo-upload-modal');
    if (m) m.classList.add('open');
}
function closePhotoUpload() {
    const m = document.getElementById('photo-upload-modal');
    if (m) m.classList.remove('open');
}
async function submitGuestPhoto() {
    const fileEl = document.getElementById('pu-file');
    const capEl = document.getElementById('pu-caption');
    const msg = document.getElementById('pu-msg');
    const show = (t, ok) => {
        if (msg) {
            msg.style.color = ok ? '#4CAF50' : '#E57373';
            msg.textContent = t;
        }
    };
    const file = fileEl && fileEl.files && fileEl.files[0];
    if (!file) {
        show('Please choose a photo.', false);
        return;
    }
    if (file.size > 8 * 1024 * 1024) {
        show('Please choose an image 8 MB or smaller.', false);
        return;
    }
    show('Uploading…', true);
    try {
        const fd = new FormData();
        fd.append('action', 'submit');
        fd.append('prop_key', __photoUploadProp);
        fd.append('caption', ((capEl && capEl.value) || '').trim());
        fd.append('image', file);
        const r = await fetch(API_BASE + 'photos.php', {
            method: 'POST',
            credentials: 'same-origin',
            body: fd,
        });
        const data = await r.json().catch(() => ({}));
        if (!r.ok || data.error) throw new Error(data.error || 'Upload failed.');
        show('Thank you! Your photo will appear once we approve it.', true);
        setTimeout(closePhotoUpload, 1600);
    } catch (e) {
        show(e.message || 'Could not upload your photo.', false);
    }
}
function guestReviewForm(propKey) {
    const existing = myGuestReviews[propKey];
    const meta = propertyMeta[propKey] || { name: propKey };
    let note = '';
    if (existing && existing.status === 'approved')
        note = `<div style="font-size:0.82rem;color:#4CAF50;margin-bottom:10px;"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.5l2.6 5.27 5.82.85-4.21 4.1.99 5.78L12 16.9l-5.2 2.6.99-5.78-4.21-4.1 5.82-.85z" fill="currentColor" stroke="none"/></svg> Your review of ${escapeHtml(meta.name)} is live on our home page — thank you!</div>`;
    else if (existing && existing.status === 'pending')
        note = `<div style="font-size:0.82rem;color:var(--text-muted);margin-bottom:10px;"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.5l2.6 5.27 5.82.85-4.21 4.1.99 5.78L12 16.9l-5.2 2.6.99-5.78-4.21-4.1 5.82-.85z" fill="currentColor" stroke="none"/></svg> Thank you for staying with us!</div>`;
    const stars = existing ? existing.stars : 5;
    const starOpts = [5, 4, 3, 2, 1]
        .map(
            (n) =>
                `<option value="${n}" ${stars === n ? 'selected' : ''}>${'★'.repeat(n)}${'☆'.repeat(5 - n)}</option>`,
        )
        .join('');
    return `
            <div style="margin-top:14px;">
                ${note}
                <div id="grf-${propKey}" style="display:none;margin-top:4px;">
                    <select id="grf-stars-${propKey}" class="input-glass field-sm" style="margin-bottom:10px;">${starOpts}</select>
                    <textarea id="grf-text-${propKey}" rows="3" maxlength="1000" class="input-glass field-sm" placeholder="How was your stay at ${escapeHtml(meta.name)}?">${existing ? escapeHtml(existing.text) : ''}</textarea>
                    <div style="display:flex;gap:10px;align-items:center;margin-top:10px;">
                        <button class="btn-glass" style="padding:10px 22px;" onclick="submitGuestReview('${propKey}')">Submit review</button>
                        <span style="font-size:0.72rem;color:var(--text-muted);">Your review will appear on our site shortly.</span>
                    </div>
                </div>
            </div>`;
}
function guestReviewBlock(propKey) {
    const existing = myGuestReviews[propKey];
    const meta = propertyMeta[propKey] || { name: propKey };
    let head;
    if (!existing) {
        head = `<button class="btn-sm btn-edit" onclick="toggleGuestReview('${propKey}')"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.5l2.6 5.27 5.82.85-4.21 4.1.99 5.78L12 16.9l-5.2 2.6.99-5.78-4.21-4.1 5.82-.85z" fill="currentColor" stroke="none"/></svg> Review your stay</button>`;
    } else if (existing.status === 'approved') {
        head = `<span style="font-size:0.82rem;color:#4CAF50;"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.5l2.6 5.27 5.82.85-4.21 4.1.99 5.78L12 16.9l-5.2 2.6.99-5.78-4.21-4.1 5.82-.85z" fill="currentColor" stroke="none"/></svg> Your review of ${escapeHtml(meta.name)} is live on our home page — thank you!</span>
                        <button class="btn-sm btn-edit" style="margin-left:10px;" onclick="toggleGuestReview('${propKey}')">Edit review</button>`;
    } else if (existing.status === 'pending') {
        head = `<span style="font-size:0.82rem;color:var(--text-muted);"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.5l2.6 5.27 5.82.85-4.21 4.1.99 5.78L12 16.9l-5.2 2.6.99-5.78-4.21-4.1 5.82-.85z" fill="currentColor" stroke="none"/></svg> Thank you for staying with us!</span>
                        <button class="btn-sm btn-edit" style="margin-left:10px;" onclick="toggleGuestReview('${propKey}')">Edit review</button>`;
    } else {
        // declined — let them quietly revise rather than surfacing "declined"
        head = `<button class="btn-sm btn-edit" onclick="toggleGuestReview('${propKey}')"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.5l2.6 5.27 5.82.85-4.21 4.1.99 5.78L12 16.9l-5.2 2.6.99-5.78-4.21-4.1 5.82-.85z" fill="currentColor" stroke="none"/></svg> Edit your review</button>`;
    }
    const stars = existing ? existing.stars : 5;
    const starOpts = [5, 4, 3, 2, 1]
        .map(
            (n) =>
                `<option value="${n}" ${stars === n ? 'selected' : ''}>${'★'.repeat(n)}${'☆'.repeat(5 - n)}</option>`,
        )
        .join('');
    return `
            <div style="margin-top:14px;border-top:1px solid var(--glass-border);padding-top:14px;">
                <div>${head}</div>
                <div id="grf-${propKey}" style="display:none;margin-top:12px;">
                    <select id="grf-stars-${propKey}" class="input-glass field-sm" style="margin-bottom:10px;">${starOpts}</select>
                    <textarea id="grf-text-${propKey}" rows="3" maxlength="1000" class="input-glass field-sm" placeholder="How was your stay at ${escapeHtml(meta.name)}?">${existing ? escapeHtml(existing.text) : ''}</textarea>
                    <div style="display:flex;gap:10px;align-items:center;margin-top:10px;">
                        <button class="btn-glass" style="padding:10px 22px;" onclick="submitGuestReview('${propKey}')">Submit review</button>
                        <span style="font-size:0.72rem;color:var(--text-muted);">Your review will appear on our site shortly.</span>
                    </div>
                </div>
            </div>`;
}
function toggleGuestReview(propKey) {
    const f = document.getElementById('grf-' + propKey);
    if (f) f.style.display = f.style.display === 'none' ? 'block' : 'none';
}
async function submitGuestReview(propKey) {
    const stars = parseInt((document.getElementById('grf-stars-' + propKey) || {}).value) || 5;
    const text = ((document.getElementById('grf-text-' + propKey) || {}).value || '').trim();
    if (text.length < 10) {
        glassAlert('Please write at least a sentence or two.');
        return;
    }
    try {
        await apiPost('reviews.php', { action: 'submit', prop_key: propKey, stars, text });
        toast('Thanks! Your review has been submitted for approval.');
        await renderGuestBookings(); // repaint with the new pending state
    } catch (e) {
        glassAlert("Couldn't submit your review: " + e.message);
    }
}

// ---- Booking Terms & Conditions ----
// Render the terms into the modal body (uses any Live Editor title override).
// Clause 7's refund terms come from the cottage's chosen cancellation policy
// (set in Settings → Cancellation policy), so the Terms always match what the
// guest is shown on the cottage page.
function cancellationClauseParagraphs(propKey) {
    const pol =
        CANCELLATION_POLICIES[cancelPolicyOf(propKey)] ||
        CANCELLATION_POLICIES[DEFAULT_CANCEL_POLICY];
    const terms = pol.points.map((p) => p.charAt(0).toLowerCase() + p.slice(1)).join('; ');
    return [
        'We strongly recommend taking out travel insurance before you book.',
        'You can cancel before your arrival date by telling us in writing; it takes effect when we receive your notice, and we’ll confirm any refund in writing.',
        `This cottage’s cancellation policy is “${pol.name}”: ${terms}.`,
        'Cancelling because of illness (including Covid-19 or self-isolation) counts as a cancellation by you.',
        'Leaving early or not turning up counts as a cancellation with no refund.',
    ];
}
// termsSections with clause 7 swapped for the selected policy's terms.
function effectiveTermsSections(propKey) {
    return termsSections.map((s) =>
        s.h.startsWith('7.') ? { h: s.h, p: cancellationClauseParagraphs(propKey) } : s,
    );
}
function renderTerms(propKey) {
    if (propKey === undefined) propKey = activeFrontProperty;
    const body = document.getElementById('terms-modal-body');
    if (!body) return;
    body.innerHTML = effectiveTermsSections(propKey)
        .map((s) => {
            const isDefs = s.h.startsWith('1.');
            const paras = s.p
                .map((par) => {
                    // In the Definitions clause, set each "Term: …" label apart.
                    const m = isDefs && par.match(/^([^:]{1,26}):\s+([\s\S]+)$/);
                    return m
                        ? `<p><span class="terms-term">${escapeHtml(m[1])}:</span> ${escapeHtml(m[2])}</p>`
                        : `<p>${escapeHtml(par)}</p>`;
                })
                .join('');
            return `<h3>${escapeHtml(s.h)}</h3>${paras}`;
        })
        .join('');
}
function openTermsModal(ev, propKey) {
    if (ev) {
        ev.preventDefault();
        ev.stopPropagation();
    }
    renderTerms(propKey); // undefined → the active cottage
    document.getElementById('terms-modal').classList.add('open');
}
function closeTermsModal() {
    document.getElementById('terms-modal').classList.remove('open');
}

// Generate and download a PDF invoice for one booking
let guestBookingsCache = []; // {propKey, booking, address} for the logged-in guest

async function sendArrivalInfo(bookingId) {
    const b = findBookingById(bookingId);
    if (!b) {
        glassAlert("Couldn't find that booking to email.");
        return;
    }
    if (!b.email) {
        glassAlert('This booking has no guest email on file.');
        return;
    }
    if (
        !(await glassConfirm(
            `Send the arrival info email to ${b.email}?\n\nTip: the arrival details are set per cottage in Settings & Fees.`,
        ))
    )
        return;
    try {
        const res = await apiPost('bookings.php', { action: 'send_arrival', id: b.dbId });
        if (res && res.error) glassAlert(res.error);
        else {
            toast(`Arrival info sent to ${b.email}.`);
            await loadData();
            renderCalendar();
            // Refresh the open details panel so the "(sent ✓)" state shows
            const loc = findBookingLocation(bookingId);
            if (loc) showDetails(loc.propKey, dbBookings[loc.propKey][loc.idx]);
        }
    } catch (e) {
        glassAlert("Couldn't send: " + e.message);
    }
}

async function sendConfirmationEmail(bookingId) {
    const b = findBookingById(bookingId);
    if (!b) {
        glassAlert("Couldn't find that booking to email.");
        return;
    }
    if (!b.email) {
        glassAlert('This booking has no guest email on file.');
        return;
    }
    if (!(await glassConfirm(`Send a confirmation email to ${b.email}?`))) return;
    try {
        const res = await apiPost('bookings.php', { action: 'send_confirmation', id: b.dbId });
        if (res && res.error) {
            glassAlert(res.error);
        } else {
            toast(`Confirmation email sent to ${b.email}.`);
        }
    } catch (e) {
        glassAlert("Couldn't send the email: " + e.message);
    }
}

function downloadInvoice(bookingId) {
    if (!window.jspdf || !window.jspdf.jsPDF) {
        glassAlert('The invoice tool is still loading — please try again in a moment.');
        return;
    }
    // Find the booking: prefer the guest cache (guest view), else admin data.
    let propKey = null,
        b = null,
        address = '';
    const cached = guestBookingsCache.find((x) => x.booking.id === bookingId);
    if (cached) {
        propKey = cached.propKey;
        b = cached.booking;
        address = cached.address;
    } else {
        const loc = findBookingLocation(bookingId);
        if (loc) {
            propKey = loc.propKey;
            b = dbBookings[loc.propKey][loc.idx];
        }
    }
    if (!b) {
        glassAlert('Booking not found.');
        return;
    }
    const meta = propertyMeta[propKey];
    const r = propertyRates[propKey] || defaultRates[propKey];
    if (!address) address = (r && r.address) || '';
    const p =
        b.agreedPrice ||
        priceBreakdown(propKey, b.adults || 0, b.children || 0, b.checkIn, b.checkOut);
    const ps = paymentSummary(propKey, b);

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    const W = doc.internal.pageSize.getWidth();
    const left = 50,
        right = W - 50;
    let y = 60;
    const line = (yy) => {
        doc.setDrawColor(210);
        doc.line(left, yy, right, yy);
    };
    const rowLR = (l, rr, yy, bold) => {
        doc.setFont('helvetica', bold ? 'bold' : 'normal');
        doc.text(String(l), left, yy);
        doc.text(String(rr), right, yy, { align: 'right' });
    };

    // Header
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(22);
    doc.text('Cottage Holidays Blakeney', left, y);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);
    doc.setTextColor(120);
    doc.text('INVOICE', right, y, { align: 'right' });
    doc.setTextColor(0);
    y += 16;
    doc.setFontSize(9);
    doc.setTextColor(120);
    doc.text('North Norfolk Coastal Retreats', left, y);
    doc.setTextColor(0);
    y += 24;
    line(y);
    y += 28;

    // Invoice meta
    doc.setFontSize(10);
    rowLR('Invoice reference', bookingRef(b.id), y);
    y += 18;
    rowLR('Issued', todayDashed(), y);
    y += 18;
    rowLR('Guest', b.name || '', y);
    y += 18;
    if (b.email) {
        rowLR('Email', b.email, y);
        y += 18;
    }
    y += 10;
    line(y);
    y += 28;

    // Stay details
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text('Your Stay', left, y);
    y += 20;
    doc.setFontSize(10);
    rowLR('Property', meta.name, y);
    y += 18;
    // Address can wrap
    doc.setFont('helvetica', 'normal');
    doc.text('Address', left, y);
    const addrLines = doc.splitTextToSize(address || 'Address provided on confirmation.', 300);
    doc.text(addrLines, right, y, { align: 'right' });
    y += addrLines.length * 14 + 6;
    rowLR('Check in', `${b.checkIn}  ·  ${b.checkInTime || '15:00'}`, y);
    y += 18;
    rowLR('Check out', `${b.checkOut}  ·  ${b.checkOutTime || '10:00'}`, y);
    y += 18;
    rowLR('Nights', String(p.nights), y);
    y += 18;
    rowLR('Guests', b.guests || `${b.adults || 0} adults`, y);
    y += 18;
    y += 10;
    line(y);
    y += 28;

    // Charges
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text('Charges', left, y);
    y += 20;
    doc.setFontSize(10);
    rowLR(`${gbp(p.perNight)} x ${p.nights} night${p.nights === 1 ? '' : 's'}`, gbp(p.nightly), y);
    y += 18;
    rowLR(`Transaction fee (${p.transactionPct}%)`, gbp(p.txFee), y);
    y += 18;
    rowLR('Refundable damages deposit', gbp(p.damagesDeposit), y);
    y += 18;
    y += 4;
    line(y);
    y += 20;
    rowLR('Total', gbp(p.total), y, true);
    y += 22;

    // Payments
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text('Payments', left, y);
    y += 20;
    doc.setFontSize(10);
    if (ps.deposit > 0) {
        const how = b.paymentMethod ? ` via ${b.paymentMethod}` : '';
        const when = b.paymentDate ? ` on ${b.paymentDate}` : '';
        rowLR(`Amount paid${how}${when}`, '- ' + gbp(ps.deposit), y);
        y += 18;
        rowLR(
            ps.fullyPaid ? 'Paid in full' : 'Balance due',
            gbp(ps.fullyPaid ? ps.total : ps.balance),
            y,
            true,
        );
        y += 18;
    } else {
        rowLR('Amount paid', gbp(0), y);
        y += 18;
        rowLR('Balance due', gbp(ps.balance), y, true);
        y += 18;
    }

    // Footer
    y += 30;
    line(y);
    y += 20;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(120);
    doc.text(
        'Thank you for booking with Cottage Holidays Blakeney. We look forward to welcoming you.',
        left,
        y,
    );

    doc.save(`Cottage-Holidays-Blakeney-Invoice-${bookingRef(b.id)}.pdf`);
}

// Autofill the enquiry form with the logged-in guest's details
// True if the text contains something shaped like a UK postcode.
function hasUkPostcode(text) {
    return /\b[A-Za-z]{1,2}\d[A-Za-z\d]?\s*\d[A-Za-z]{2}\b/.test(text || '');
}
// True if the WHOLE value is a UK postcode (for the dedicated postcode field).
function isUkPostcode(text) {
    return /^[A-Za-z]{1,2}\d[A-Za-z\d]?\s*\d[A-Za-z]{2}$/.test((text || '').trim());
}
// ---- Live postcode recognition ----
// As the guest types we tidy the format, check it against real UK postcode
// data (postcode-lookup.php) and confirm the recognised place back —
// "✓ NR25 7AB — Blakeney, Norfolk" — or nudge on a likely typo. Purely
// assistive: a failed lookup shows nothing and never blocks the form.
function normalizeUkPostcode(v) {
    const c = (v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (c.length < 5 || c.length > 7) return (v || '').toUpperCase().trim();
    return c.slice(0, -3) + ' ' + c.slice(-3);
}
let __pcTimer = null,
    __pcSeq = 0;
function postcodeRecognize(inputId, statusId, onBlur) {
    const inp = document.getElementById(inputId);
    const out = document.getElementById(statusId);
    if (!inp || !out) return;
    clearTimeout(__pcTimer);
    const run = async () => {
        if (onBlur) {
            const n = normalizeUkPostcode(inp.value);
            if (n && n !== inp.value) inp.value = n;
        }
        const val = (inp.value || '').trim();
        if (!isUkPostcode(val)) {
            out.textContent = '';
            return;
        }
        const seq = ++__pcSeq;
        try {
            const r = await apiGet(
                'postcode-lookup.php?pc=' + encodeURIComponent(normalizeUkPostcode(val)),
            );
            if (seq !== __pcSeq) return; // superseded by a newer keystroke
            if (r.ok && r.valid) {
                out.style.color = '#7FD68A';
                out.textContent = '✓ ' + (r.postcode || val) + (r.place ? ' — ' + r.place : '');
            } else if (r.ok) {
                out.style.color = '#FFB74D';
                out.textContent = "We can't find that postcode — please double-check it.";
            } else {
                out.textContent = '';
            }
        } catch (e) {
            if (seq === __pcSeq) out.textContent = '';
        }
    };
    if (onBlur) run();
    else __pcTimer = setTimeout(run, 450);
}

function autofillGuestEnquiry() {
    const e = document.getElementById('enq-email');
    if (!currentGuest) {
        // Logged out: make sure the email field is editable again.
        if (e) {
            e.readOnly = false;
            e.classList.remove('input-locked');
            e.title = '';
        }
        return;
    }
    const n = document.getElementById('enq-name');
    const p = document.getElementById('enq-phone');
    const a = document.getElementById('enq-address');
    const pc = document.getElementById('enq-postcode');
    if (n && !n.value) n.value = currentGuest.name || '';
    if (p && !p.value) p.value = currentGuest.phone || '';
    if (a && !a.value) a.value = currentGuest.address || '';
    if (pc && !pc.value) pc.value = currentGuest.postcode || '';
    // A logged-in guest's bookings are tied to their account email — show it,
    // but don't let them change it here (they'd change their account email).
    if (e) {
        e.value = currentGuest.email || '';
        e.readOnly = true;
        e.classList.add('input-locked');
        e.title = 'This is your account email. To change it, contact us.';
    }
}

async function tryAccessBackOffice() {
    if (!isAuthenticated) {
        // First sign-in lands on the friendly owner home, not straight into the calendar.
        openAdminLogin('Owner Login', 'Sign in to manage your cottages.', async () => {
            nav('view-backoffice');
            adminHistPush('view-backoffice');
            refreshOwnerHomeBadges();
        });
    } else {
        nav('view-backoffice');
        adminHistPush('view-backoffice');
        await initBackOffice();
    }
}

// ---- Styled admin login modal ----
let adminLoginOnSuccess = null;
async function openAdminLogin(title, sub, onSuccess) {
    adminLoginOnSuccess = onSuccess || null;
    const m = document.getElementById('admin-login-modal');
    document.getElementById('admin-login-title').innerText = title || 'Owner Login';
    document.getElementById('admin-login-sub').innerText = sub || '';
    document.getElementById('admin-login-user').value = '';
    document.getElementById('admin-login-pass').value = '';
    document.getElementById('admin-login-error').style.display = 'none';
    const status = document.getElementById('admin-login-passkey-status');
    const pwForm = document.getElementById('admin-login-pw-form');
    const retry = document.getElementById('admin-login-passkey-retry');
    const hasPasskey = !!(
        window.PublicKeyCredential &&
        navigator.credentials &&
        navigator.credentials.get
    );
    m.classList.add('open');
    if (hasPasskey) {
        // Go straight to a passkey attempt — no intermediate screen.
        status.style.display = 'block';
        pwForm.style.display = 'none';
        retry.style.display = 'block'; // the password screen offers a passkey retry
        try {
            const ok = await adminPasskeyFirst(true);
            if (ok) {
                const cb = adminLoginOnSuccess;
                closeAdminLogin();
                if (cb) await cb();
                return;
            }
        } catch (e) {
            /* unavailable / cancelled / failed — fall through to password */
        }
        // Passkey didn't complete → reveal username & password (with a passkey retry).
        status.style.display = 'none';
        pwForm.style.display = 'block';
        setTimeout(() => document.getElementById('admin-login-user').focus(), 60);
    } else {
        // No passkey support on this device — straight to username & password.
        status.style.display = 'none';
        retry.style.display = 'none';
        pwForm.style.display = 'block';
        setTimeout(() => document.getElementById('admin-login-user').focus(), 100);
    }
}
function closeAdminLogin() {
    document.getElementById('admin-login-modal').classList.remove('open');
    const st = document.getElementById('admin-login-passkey-status');
    if (st) st.style.display = 'none';
    adminLoginOnSuccess = null;
}
function adminLoginErr(msg) {
    const err = document.getElementById('admin-login-error');
    err.innerText = msg;
    err.style.display = 'block';
}
async function submitAdminLogin() {
    const username = document.getElementById('admin-login-user').value.trim();
    const password = document.getElementById('admin-login-pass').value;
    if (!username || !password) {
        adminLoginErr('Please enter your username and password.');
        return;
    }
    try {
        await apiPost('auth.php', { action: 'admin_login', username, password });
        isAuthenticated = true;
        setAuthUI();
        currentGuest = null;
        setGuestUI(); // one role at a time: drop any guest session
        // Re-drain any writes that were kept queued because the session had lapsed.
        try {
            oqRegisterSync();
            oqFlush();
        } catch (e) {}
        const cb = adminLoginOnSuccess;
        closeAdminLogin();
        if (cb) await cb();
    } catch (e) {
        adminLoginErr('Access denied: ' + e.message);
    }
}
async function submitAdminPasskey() {
    try {
        const ok = await adminPasskeyFirst(true);
        if (ok) {
            const cb = adminLoginOnSuccess;
            closeAdminLogin();
            if (cb) await cb();
        }
    } catch (e) {
        adminLoginErr('Passkey sign-in failed: ' + (e.message || e));
    }
}

// Offer a passkey sign-in before falling back to username/password.
// Returns true if a passkey login succeeded. Silent if unsupported or declined.
async function adminPasskeyFirst(skipConfirm) {
    if (!(window.PublicKeyCredential && navigator.credentials && navigator.credentials.get))
        return false;
    if (
        !skipConfirm &&
        !(await glassConfirm(
            'Sign in with a passkey?\n\nOK = use Face ID / Touch ID / device PIN\nCancel = use username & password',
        ))
    )
        return false;
    try {
        const begin = await apiPost('passkeys.php', { action: 'admin_login_begin' });
        const publicKey = prepGetOptions(begin.options.publicKey || begin.options);
        const assertion = await navigator.credentials.get({ publicKey });
        await apiPost('passkeys.php', {
            action: 'admin_login_finish',
            id: bufToB64url(assertion.rawId),
            clientDataJSON: bufToB64url(assertion.response.clientDataJSON),
            authenticatorData: bufToB64url(assertion.response.authenticatorData),
            signature: bufToB64url(assertion.response.signature),
        });
        isAuthenticated = true;
        setAuthUI();
        currentGuest = null;
        setGuestUI(); // one role at a time: drop any guest session
        return true;
    } catch (e) {
        if (e && e.name === 'NotAllowedError') return false; // cancelled
        if (!skipConfirm)
            glassAlert(
                'Passkey sign-in failed: ' +
                    (e.message || e) +
                    '\n\nYou can use your username and password instead.',
            );
        else throw e;
        return false;
    }
}

async function logoutStaff() {
    try {
        await apiPost('auth.php', { action: 'admin_logout' });
    } catch (e) {}
    isAuthenticated = false;
    setAuthUI();
    glassAlert('You have been securely logged out.');
    nav('view-main');
}

// Save a single content value (text or image URL) to the backend store,
// so it's shared across devices and survives a browser clear.
async function saveContent(key, value) {
    try {
        await apiPost('content.php', { action: 'set', key, value });
    } catch (e) {
        glassAlert("Couldn't save that change to the server: " + e.message);
    }
}

// Cache of all content fetched from the backend.
let siteContent = {};

// Load shared content (text edits, image swaps, galleries) from the backend
// and apply it, so every visitor sees the owner's edits — not just the editor.
async function loadContent() {
    try {
        const res = await apiGet('content.php');
        siteContent = res.content || {};
    } catch (e) {
        return;
    } // keep last-good content on a transient failure (e.g. background poll)

    // Merge per-property gallery image lists into propertyContent
    Object.keys(propertyContent).forEach((propKey) => {
        const imgs = siteContent['images-' + propKey];
        if (Array.isArray(imgs) && imgs.length) {
            propertyContent[propKey].images = imgs.slice();
        }
        const ams = siteContent['amenities-' + propKey];
        if (Array.isArray(ams)) {
            propertyContent[propKey].amenities = ams.slice();
        }
        const saf = siteContent['safety-' + propKey];
        if (Array.isArray(saf)) {
            propertyContent[propKey].safety = saf.slice();
        }
    });

    // Merge per-property booking rules (times, min nights, arrival days)
    Object.keys(defaultRates).forEach((propKey) => {
        const r = siteContent['rules-' + propKey];
        if (r && typeof r === 'object') {
            const target = propertyRates[propKey] || (propertyRates[propKey] = {});
            if (typeof r.checkInTime === 'string') target.checkInTime = r.checkInTime;
            if (typeof r.checkOutTime === 'string') target.checkOutTime = r.checkOutTime;
            if (r.minNights != null) target.minNights = Math.max(1, parseInt(r.minNights, 10) || 1);
            if (r.maxNights != null) target.maxNights = Math.max(0, parseInt(r.maxNights, 10) || 0);
            if (Array.isArray(r.arrivalDays)) target.arrivalDays = r.arrivalDays.slice();
        }
    });

    // Apply text + image overrides to anything currently on the page
    applyContentOverrides(document);
}

// Apply stored text/image content to elements within a root node.
function applyContentOverrides(root) {
    root.querySelectorAll('[data-edit-text]').forEach((el) => {
        const v = siteContent[el.getAttribute('data-edit-text')];
        if (typeof v === 'string') el.textContent = decodeEntities(v);
    });
    root.querySelectorAll('[data-edit-img]').forEach((el) => {
        const v = siteContent[el.getAttribute('data-edit-img')];
        // Strip quotes/parens/backslash so a stray char in a stored value can't
        // break out of the url('…') (same sanitisation as the hero below).
        if (typeof v === 'string' && v) el.style.backgroundImage = `url('${v.replace(/['"\\)]/g, '')}')`;
    });
    // Expose the live hero to CSS (the auth modals' coastal brand panel uses
    // var(--hero-img)) — the static hero.jpg doesn't exist on the live host.
    try {
        const h = siteContent['hero-bg'];
        if (typeof h === 'string' && h)
            document.documentElement.style.setProperty(
                '--hero-img',
                `url('${h.replace(/['"\\)]/g, '')}')`,
            );
    } catch (e) {}
}

// ---- Live background refresh ----
// Keep the public site current (new bookings, iCal syncs, price/review/content
// changes) without a manual reload. Turned OFF for the admin: when logged in
// the owner is managing data and auto-refreshing would clobber edits / cause
// churn, so the tick simply no-ops while authenticated.
let liveUpdateTimer = null;
let liveUpdateBusy = false;
const LIVE_UPDATE_MS = 30000; // every ~30s (a marketing site doesn't need tighter; cuts idle polling 3×)
async function liveUpdateTick() {
    if (isAuthenticated) return; // admin logged in — leave their data alone
    if (document.hidden) return; // tab not visible — save bandwidth
    if (liveUpdateBusy) return; // don't overlap a slow tick
    liveUpdateBusy = true;
    try {
        await Promise.all([
            loadRates().catch(() => {}),
            loadContent().catch(() => {}),
            loadPublicReviews().catch(() => {}),
        ]);
        // Re-render the same public bits the initial boot does (data-only loaders
        // above don't touch the DOM themselves), so changes show up live.
        try {
            renderCardPrices();
        } catch (e) {}
        try {
            loadPropContentOverrides();
        } catch (e) {}
        try {
            renderReviews();
        } catch (e) {}
        try {
            updatePropPriceHeading();
        } catch (e) {}
        try {
            if (document.getElementById('enq-price-box')) updateEnquiryPrice();
        } catch (e) {}
        // Keep the cottage calendar / date picker availability fresh.
        try {
            if (activeFrontProperty) await loadAvailability(activeFrontProperty);
        } catch (e) {}
        try {
            if (activeFrontProperty) renderPropReviews(activeFrontProperty);
        } catch (e) {}
    } finally {
        liveUpdateBusy = false;
    }
}
function startLiveUpdates() {
    if (liveUpdateTimer) return;
    liveUpdateTimer = setInterval(liveUpdateTick, LIVE_UPDATE_MS);
    // Refresh promptly when the tab is brought back to the foreground.
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) liveUpdateTick();
    });
}
function stopLiveUpdates() {
    if (liveUpdateTimer) {
        clearInterval(liveUpdateTimer);
        liveUpdateTimer = null;
    }
}

window.addEventListener('DOMContentLoaded', async () => {
    try {
        applySavedTheme();
        // The enquiry modal must be a direct child of <body>: its overlay is
        // position:fixed, and a transformed page-view ancestor would otherwise trap
        // it (off-screen). Move it out once, on boot.
        try {
            const em = document.getElementById('enquire-modal');
            if (em && em.parentElement !== document.body) document.body.appendChild(em);
        } catch (e) {}
        try {
            const bb = document.getElementById('prop-book-bar');
            if (bb && bb.parentElement !== document.body) document.body.appendChild(bb);
        } catch (e) {}
        // Show the passkey sign-in option only if the device/browser supports it
        if (window.PublicKeyCredential && navigator.credentials && navigator.credentials.get) {
            const w = document.getElementById('passkey-login-wrap');
            if (w) w.style.display = 'block';
            const h = document.getElementById('passkey-hint');
            if (h) h.style.display = 'block';
        }
        document.querySelectorAll('[data-edit-text]').forEach((el) => {
            const saved = localStorage.getItem(el.getAttribute('data-edit-text'));
            if (saved) el.textContent = decodeEntities(saved);
        });
        document.querySelectorAll('[data-edit-img]').forEach((el) => {
            const saved = localStorage.getItem(el.getAttribute('data-edit-img'));
            if (saved) el.style.backgroundImage = `url('${saved}')`;
        });
        // Load live data from the backend. Each is wrapped so one failing
        // never blocks the others or stops the page from revealing.
        await Promise.all([
            loadRates().catch((e) => console.error('loadRates', e)),
            loadContent().catch((e) => console.error('loadContent', e)),
            loadPublicReviews().catch((e) => console.error('loadPublicReviews', e)),
            loadSquareAdminConfig().catch((e) => console.error('loadSquareAdminConfig', e)),
        ]);
        try {
            renderCardPrices();
        } catch (e) {
            console.error(e);
        }
        try {
            loadPropContentOverrides();
        } catch (e) {
            console.error(e);
        }
        try {
            renderReviews();
        } catch (e) {
            console.error(e);
        }
        try {
            injectSeoSchema();
        } catch (e) {
            console.error(e);
        } // live review stars / FAQs / phone into structured data
        try {
            updatePropPriceHeading();
        } catch (e) {
            console.error(e);
        }
        try {
            if (document.getElementById('enq-price-box')) updateEnquiryPrice();
        } catch (e) {
            console.error(e);
        }
        // Restore admin + guest sessions — also independent, also concurrent.
        await Promise.all([
            (async () => {
                try {
                    const s = await apiPost('auth.php', { action: 'admin_status' });
                    isAuthenticated = !!s.admin;
                } catch (e) {}
            })(),
            restoreGuestSession().catch((e) => console.error('restoreGuestSession', e)),
        ]);
        // Staging sandbox: skip the sign-in wall — auto-establish a test-guest
        // session so every guest-only feature is testable without logging in.
        // Never overrides an admin session, and respects an explicit logout
        // (so the real sign-in flow can still be tested).
        if (IS_STAGING && !isAuthenticated && !currentGuest) {
            let optedOut = false;
            try {
                optedOut = sessionStorage.getItem('chb-staging-noauto') === '1';
            } catch (e) {}
            if (!optedOut) {
                try {
                    const r = await apiPost('auth.php', { action: 'staging_guest_session' });
                    currentGuest = r.guest || null;
                } catch (e) {}
            }
        }
        try {
            setAuthUI();
        } catch (e) {
            console.error(e);
        }
        try {
            setGuestUI();
        } catch (e) {
            console.error(e);
        }
        try {
            wireCallButtons();
        } catch (e) {
            console.error(e);
        }
        // Register the service worker (PWA install) and, for a returning guest who
        // already allowed notifications, refresh their push subscription.
        try {
            registerServiceWorker();
        } catch (e) {
            console.error(e);
        }
        try {
            if (currentGuest && 'Notification' in window && Notification.permission === 'granted')
                enableArrivalPush();
        } catch (e) {
            console.error(e);
        }
    } catch (e) {
        // Last-resort: never leave the visitor stuck on the loading crown.
        console.error('Bootstrap error:', e);
    } finally {
        // Everything is loaded (or safely failed) — always reveal the page.
        hideLoadingOverlay();
        // Count this initial landing (whatever view is active after boot).
        try {
            const av = document.querySelector('.page-view.active');
            trackView(av ? av.id : 'view-main', activeFrontProperty);
        } catch (e) {}
        try {
            startLiveUpdates();
        } catch (e) {
            console.error(e);
        }
        try {
            startVersionWatch();
        } catch (e) {
            console.error(e);
        }
        try {
            startGuestVersionWatch();
        } catch (e) {
            console.error(e);
        }
        // After an auto-update reload, return the owner to the screen they were on.
        try {
            restoreAdminState();
        } catch (e) {
            console.error(e);
        }
        try {
            maybeConsumeMagicLink();
        } catch (e) {
            console.error(e);
        } // ?mlogin=… → passwordless sign in
        try {
            maybeOpenPayLink();
        } catch (e) {
            console.error(e);
        } // ?pay=… → payment view
        try {
            maybeOpenReviewLink();
        } catch (e) {
            console.error(e);
        } // ?review=… → My Bookings
        try {
            maybeOpenCottageRoute();
        } catch (e) {
            console.error(e);
        } // /cottages/<slug> → that cottage
        try {
            if (/^\/experiences\/?$/.test(location.pathname)) nav('view-experiences');
        } catch (e) {} // /experiences → the things-to-do view
        try {
            maybeHandleUnsubscribe();
        } catch (e) {
            console.error(e);
        } // ?unsub=… → newsletter opt-out
        try {
            hsRestore();
        } catch (e) {
            console.error(e);
        } // restore the visitor's last search
        try {
            oqFlush();
        } catch (e) {} // sync any offline-queued admin writes
    }
});

function hideLoadingOverlay() {
    clearTimeout(window.__slowLoadTimer);
    const o = document.getElementById('loading-overlay');
    if (!o || o.classList.contains('fade-out')) return;
    o.classList.add('fade-out');
    setTimeout(() => {
        if (o.parentNode) o.parentNode.removeChild(o);
    }, 600);
}
// After 10s, if the page still hasn't finished loading, show a "taking longer
// than usual" message with a Reload button — rather than auto-revealing a
// half-loaded page. The site still only reveals when fully loaded.
window.__slowLoadTimer = setTimeout(() => {
    const o = document.getElementById('loading-overlay');
    if (o && !o.classList.contains('fade-out')) o.classList.add('show-slow');
}, 10000);

// Global safety net: if anything unexpected throws or a promise rejects
// unhandled, log it and make sure the visitor is never stuck on the
// loading crown. Individual actions still handle their own errors; this
// is the last line of defence so the page can't silently freeze.
window.addEventListener('error', (e) => {
    console.error('Caught error:', e && e.error ? e.error : e && e.message);
    try {
        hideLoadingOverlay();
    } catch (_) {}
});
window.addEventListener('unhandledrejection', (e) => {
    console.error('Unhandled promise rejection:', e && e.reason);
    try {
        hideLoadingOverlay();
    } catch (_) {}
});

/* --- 4. BACK OFFICE CALENDAR MODULE --- */
// Property metadata: colour code + display name
const propertyMeta = {
    '21a': { name: '21A Westgate', short: '21A', color: 'pale blue' },
    jollyboat: { name: 'Jollyboat', short: 'Jolly', color: 'green' },
    pimpernel: { name: 'Pimpernel', short: 'Pimp', color: 'purple' },
};

// Occupancy limits per property. maxAdults / maxChildren cap each field;
// maxTotal caps the combined head count. Used by both the public enquiry
// form and the back office (and enforced again server-side).
const occupancyLimits = {
    '21a': { maxAdults: 2, maxChildren: 0, maxTotal: 2 },
    jollyboat: { maxAdults: 2, maxChildren: 0, maxTotal: 2 },
    pimpernel: { maxAdults: 3, maxChildren: 1, maxTotal: 3 },
};

// Validate dates against a property's booking rules (min nights, arrival days).
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
function checkBookingRules(propKey, checkIn, checkOut) {
    const r = propertyRates[propKey] || defaultRates[propKey] || {};
    const nights = nightsBetween(checkIn, checkOut);
    const minN = Math.max(1, parseInt(r.minNights, 10) || 1);
    if (nights < minN) {
        return `This property has a minimum stay of ${minN} night${minN === 1 ? '' : 's'}.`;
    }
    const maxN = Math.max(0, parseInt(r.maxNights, 10) || 0);
    if (maxN > 0 && nights > maxN) {
        return `This property has a maximum stay of ${maxN} night${maxN === 1 ? '' : 's'}.`;
    }
    const allowed = Array.isArray(r.arrivalDays) ? r.arrivalDays : [];
    if (allowed.length > 0) {
        const [y, m, d] = checkIn.split('-').map(Number);
        const arrivalDow = new Date(y, m - 1, d).getDay();
        if (!allowed.includes(arrivalDow)) {
            const names = allowed
                .slice()
                .sort((a, b) => a - b)
                .map((i) => DAY_NAMES[i])
                .join(', ');
            return `Arrivals at this property are only on: ${names}.`;
        }
    }
    return null;
}

// Validate an adults/children combination against a property's limits.
// Returns null if OK, or a human-readable error message if not.
function checkOccupancy(propKey, adults, children) {
    const lim = occupancyLimits[propKey];
    if (!lim) return null;
    const name = (propertyMeta[propKey] || {}).name || 'This property';
    const ppl = (n, word) => n + ' ' + word + (n === 1 ? '' : 's');
    if (adults > lim.maxAdults)
        return `${name} allows a maximum of ${ppl(lim.maxAdults, 'adult')}.`;
    if (children > lim.maxChildren)
        return lim.maxChildren === 0
            ? `${name} is for adults only — no children, sorry.`
            : `${name} allows a maximum of ${ppl(lim.maxChildren, 'child').replace('childs', 'children')}.`;
    if (adults + children > lim.maxTotal)
        return `${name} sleeps a maximum of ${ppl(lim.maxTotal, 'guest')} in total.`;
    return null;
}

// Build a short, friendly description of a property's limit (for hints).
function occupancyHint(propKey) {
    const lim = occupancyLimits[propKey];
    if (!lim) return '';
    if (lim.maxChildren === 0) return `Sleeps up to ${lim.maxAdults} adults.`;
    return `Sleeps up to ${lim.maxTotal} (max ${lim.maxAdults} adults, ${lim.maxChildren} child).`;
}

// Per-property page content (title, description, gallery images, amenities).
// Editable text/images on the property page are saved to localStorage per
// property via the existing data-edit-* system (keys are namespaced per propKey).
// Booking Terms & Conditions content. Editable via the Live Editor (the
// intro/title) and rendered both in the on-screen modal and the PDF.
// Update TERMS_VERSION whenever the wording materially changes, so the
// acceptance recorded against each booking reflects which version was agreed.
const TERMS_VERSION = '2026-06b';
const TERMS_BUSINESS = 'Sophia Farrow, Forest Edge, Mill Road, Edingthorpe, Norfolk, NR28 9SJ';
const termsSections = [
    {
        h: '1. Definitions',
        p: [
            'Arrival/Departure Date: when your stay starts and ends, as shown in our confirmation.',
            'Booking: your confirmed stay at the property.',
            'Booking request: your request to book — it becomes a Booking only once we confirm it in writing.',
            'Confirmation: our written acceptance of your booking request, with arrival/departure details, directions and the House Rules.',
            'Price: the total cost of your stay, shown on the website and in our confirmation.',
            'Deposit: 25% of the Price, payable when you book.',
            'Balance due date: 4 weeks before your arrival date.',
            'Security deposit: £50–100 held before arrival in case of damage, and returned afterwards.',
            'House Rules: a short separate document we send with your confirmation; it forms part of these terms.',
            'Permitted pets: any animal we’ve agreed you can bring (registered assistance animals are always welcome).',
            'Group: you and everyone — and any animals — staying or visiting under your booking.',
            'We/us: ' + TERMS_BUSINESS + '.',
            'You: the person making the booking, who must be 18 or over and is responsible for the whole Group.',
            'Website: cottageholidaysblakeney.co.uk.',
        ],
    },
    {
        h: '2. Our contract with you',
        p: [
            'Please check your booking details — dates, times and number of guests — are correct before you book.',
            'Your booking is confirmed only once we send our written confirmation; at that point these terms apply.',
            'You’re booking a holiday stay, not renting a home — this doesn’t create a tenancy or any right to stay on after your booking ends.',
            'Please don’t arrive before your arrival time or leave after your departure time; we may charge you if you overstay.',
            'Photos are for illustration only; décor and layout may change.',
        ],
    },
    {
        h: '3. Looking after the property',
        p: [
            'Please treat the property and everything in it with care, and leave it as you found it. If something is damaged or not working, tell us as soon as you notice.',
            'You may lose your security deposit, or be charged, for any damage or loss.',
            'Use of the property and grounds is at your own risk; please follow the House Rules and any safety instructions.',
            'We, or our representatives, may need to enter the property to inspect it or carry out repairs.',
            'We can ask you to leave without a refund if you or your Group behave unreasonably or illegally, or in a way that endangers or seriously disturbs others or the property.',
            'Wifi is for casual use only — we can’t guarantee the speed or that it’s always available.',
            'Any local recommendations we make are personal suggestions, not a guarantee of service.',
            'Please check the property suits your Group’s needs before you book.',
            'Belongings and vehicles are left at your own risk. Take everything with you when you leave; we can’t guarantee to return lost property and will charge for postage.',
            'There’s no electric-vehicle charging at the property, and portable car chargers can’t be used anywhere on site.',
            'Caterers, chefs, entertainers and other outside providers need our written permission first.',
        ],
    },
    {
        h: '4. Pets',
        p: [
            'Only pets we’ve agreed to, or registered assistance animals, may stay.',
            'If pets we haven’t agreed to are brought along, we can ask you to leave.',
            'We can refuse, or ask you to leave with no refund, if a pet is a nuisance or danger to others.',
            'You’re responsible for any damage or parasites caused by your pets.',
            'We can’t be held responsible for allergies caused by pets from a previous stay.',
        ],
    },
    {
        h: '5. Price and payment',
        p: [
            'The price is confirmed in your confirmation.',
            'Booking more than 4 weeks ahead: pay the 25% deposit now, with the balance due by the balance due date.',
            'Booking within 4 weeks of arrival: pay in full when you book.',
            'We can’t let you in until the full price is paid.',
        ],
    },
    {
        h: '6. Our responsibility to you',
        p: [
            'We don’t exclude any liability that can’t legally be excluded.',
            'If we break these terms, we’re responsible for loss that’s a foreseeable result of our breach or negligence — but not for unforeseeable loss, or for travel or alternative accommodation costs.',
            'The property is for private holiday use, so we’re not responsible for any business losses.',
            'Otherwise, your belongings, pets and vehicles are left at your own risk.',
        ],
    },
    // NOTE: clause 7's paragraphs are generated at render time from the
    // cottage's chosen cancellation policy — see effectiveTermsSections().
    // The text below is only a fallback and is normally replaced.
    {
        h: '7. Cancelling — your rights',
        p: [
            'We strongly recommend taking out travel insurance before you book.',
            'You can cancel before your arrival date by telling us in writing; it takes effect when we receive your notice, and we’ll confirm any refund in writing.',
            'Your refund depends on this cottage’s cancellation policy, shown on the cottage page and in your confirmation.',
            'Cancelling because of illness (including Covid-19 or self-isolation) counts as a cancellation by you.',
            'Leaving early or not turning up counts as a cancellation with no refund.',
        ],
    },
    {
        h: '8. Cancelling — our rights',
        p: [
            'We may cancel before arrival because of events outside our control, and will tell you as soon as we can.',
            'If we do, we’ll refund anything you’ve paid for what we can’t provide.',
            'We can also cancel immediately if you don’t pay on time, or seriously break these terms or the House Rules — in that case no refund is due.',
        ],
    },
    {
        h: '9. Events outside anyone’s control',
        p: [
            'Neither of us is responsible for delays or failures caused by events beyond our reasonable control — such as strikes, civil emergencies, government restrictions, pandemics, natural disasters, utility or appliance failures, pests, or extreme weather.',
            'If such an event means we can’t provide the property, we’ll let you know as soon as possible and arrange a refund.',
        ],
    },
    {
        h: '10. Your personal information',
        p: ['We use the information you give us in line with our Privacy Policy.'],
    },
    {
        h: '11. Changes to your booking or these terms',
        p: [
            'To change your booking, just ask — we’ll do our best, but can’t always say yes, and a price difference may apply.',
            'We may update these terms from time to time, giving at least 14 days’ notice before changes take effect (or as much notice as we can if your stay is sooner).',
        ],
    },
    {
        h: '12. Other terms',
        p: [
            'We may transfer our rights and obligations under these terms to someone else without affecting your rights.',
            'Only you and we can enforce these terms.',
            'If any part is found to be invalid, the rest still applies.',
            'If we don’t enforce a right straight away, we can still enforce it later.',
            'These terms are governed by the law of England and Wales and the English courts. If you live in Scotland or Northern Ireland, you can also bring proceedings there.',
        ],
    },
];

const propertyContent = {
    '21a': {
        title: '21A Westgate Street',
        desc: 'A premium townhouse experience seamlessly integrating heritage structure with liquid-smooth modern functionality. Designed for extensive family gatherings and grand coastal entertaining.',
        amenities: [
            'Fluid Open Architecture',
            'Smeg Chef Kitchen',
            'Private Walled Garden',
            'Heritage Coastal Setting',
        ],
        images: ['21a-1.jpg', '21a-2.jpg', '21a-3.jpg'],
    },
    jollyboat: {
        title: 'Jollyboat',
        desc: 'An intimate coastal bolthole for two. Cosy, characterful and perfectly placed for romantic getaways, with the saltmarshes and quay just steps from the door.',
        amenities: [
            'Snug Double Bedroom',
            'Wood-Burning Stove',
            'Quayside Location',
            'Welcome Hamper',
        ],
        images: ['jollyboat-1.jpg', 'jollyboat-2.jpg', 'jollyboat-3.jpg'],
    },
    pimpernel: {
        title: 'Pimpernel',
        desc: 'A contemporary retreat blending clean modern lines with coastal warmth. Light-filled and comfortable, ideal for small families and friends exploring North Norfolk.',
        amenities: ['Open-Plan Living', 'Designer Kitchen', 'Sun Terrace', 'Family Friendly'],
        images: ['pimpernel-1.jpg', 'pimpernel-2.jpg', 'pimpernel-3.jpg'],
    },
};

// Which property the front-end booking page is currently showing
let activeFrontProperty = '21a';

// ---- Amenity pills (per cottage, display-only; edited in Settings) ----
let activePropAmenities = []; // working copy for the open property

// Display-only on the cottage page; the list is edited in Settings.
function renderAmenities(propKey) {
    const wrap = document.getElementById('prop-amenities');
    if (!wrap) return;
    wrap.innerHTML = activePropAmenities
        .map(
            (a) => `
                <div class="amenity-pill">
                    <span class="amenity-text">${escapeHtml(a)}</span>
                </div>`,
        )
        .join('');
}

// ---- "Safety & property" list (per cottage) — mirrors the amenities pattern ----
const DEFAULT_SAFETY = ['Smoke alarm', 'Carbon monoxide detector', 'First-aid kit available'];
let activePropSafety = [];
const IC_SHIELD =
    '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z"/></svg>';
// Display-only on the cottage page; the list is edited in
// Settings → Preferences → cottage → Safety & property.
function renderSafety(propKey) {
    const wrap = document.getElementById('prop-safety');
    if (!wrap) return;
    wrap.innerHTML = activePropSafety
        .map(
            (s) => `
                <div class="things-item">${IC_SHIELD}
                    <span>${escapeHtml(s)}</span>
                </div>`,
        )
        .join('');
}
// ---- Meet your host (one shared profile, edited on the admin Host page) ----
const HOST_DEFAULTS = {
    'host-name': 'Sophia',
    'host-badge': 'Owner',
    'host-reviews': '56',
    'host-rating': '4.95 ★',
    'host-years': '10 years',
    'host-school': 'Where I studied: North Norfolk',
    'host-work': 'My work: holiday accommodation',
    'host-bio':
        "Hi — you can take the girl out of Norfolk, but you can't take Norfolk out of the girl. I love helping guests discover this beautiful stretch of coast.",
    'host-photo': '',
};
const hostVal = (k) => {
    const v = siteContent[k];
    return v === undefined || v === null || v === '' ? HOST_DEFAULTS[k] : v;
};
// Fill the cottage-page host card from saved content (no longer inline-editable).
function renderHost() {
    const set = (id) => {
        const e = document.getElementById(id);
        if (e) e.textContent = hostVal(id);
    };
    ['host-name', 'host-badge', 'host-years', 'host-school', 'host-work', 'host-bio'].forEach(set);
    // Reviews total + rating % are pulled live from the posted reviews (all cottages).
    const reviews = allReviews();
    const cnt = reviews.length;
    const avg = cnt
        ? reviews.reduce((s, r) => s + Math.max(1, Math.min(5, parseInt(r.stars) || 5)), 0) / cnt
        : 0;
    const setText = (id, val) => {
        const e = document.getElementById(id);
        if (e) e.textContent = val;
    };
    setText('host-reviews', cnt ? String(cnt) : 'New');
    setText('host-rating', cnt ? Math.round((avg / 5) * 100) + '%' : '—');
    const photo = document.getElementById('host-photo');
    if (photo)
        photo.style.backgroundImage = hostVal('host-photo')
            ? `url('${hostVal('host-photo')}')`
            : '';
}
// Admin: open the Host profile editor and load the current values.
function saveHostText(key, value) {
    const v = (value || '').trim();
    siteContent[key] = v;
    saveContent(key, v);
    renderHost();
    const msg = document.getElementById('host-save-msg');
    if (msg) {
        msg.textContent = 'Saved.';
        clearTimeout(msg.__t);
        msg.__t = setTimeout(() => {
            msg.textContent = '';
        }, 1500);
    }
}
function uploadHostPhoto() {
    pickAndUpload('host-photo', async (url) => {
        siteContent['host-photo'] = url;
        await saveContent('host-photo', url);
        const a = document.getElementById('host-edit-photo');
        if (a) a.style.backgroundImage = `url('${url}')`;
        renderHost();
    });
}
// Host profile now lives inside Settings; this shim keeps any old callers working.
function openHostEditor() {
    openSettings('host');
}

// ---- Local guide (dark skies + car-free) + book-direct savings badge ----
const DEFAULT_DARKSKIES =
    "North Norfolk has some of England's darkest skies. On a clear night, step outside and look up — you can often see the Milky Way. Give your eyes 15 minutes to adjust and bring a blanket.";
const DEFAULT_CARFREE =
    "You can reach us car-free: train to Sheringham, then the Coasthopper bus along the coast to Blakeney. The Norfolk Coast Path runs through the village, so it's an easy base for walking to Cley, Morston and Wells.";
const DEFAULT_ACCESS =
    "Please ask us before you book if you have specific access needs — we're happy to talk through the layout. Tell us about parking distance, steps or stairs, doorway widths, ground-floor sleeping and bathroom facilities so we can confirm the cottage is right for you.";
function saveLocalContent(key, value) {
    saveContent(key, value);
    try {
        renderLocalGuide(activeFrontProperty);
    } catch (e) {}
}
// ---- Tide widget (Blakeney) — fetched once from tides.php, cached in-memory.
// Hidden entirely unless an API key is configured (Settings → API keys). ----
let __tideData = null;
async function renderTides() {
    const card = document.getElementById('prop-tides-col');
    const body = document.getElementById('prop-tides-body');
    if (!card || !body) return;
    const hide = () => {
        card.style.display = 'none';
    };
    try {
        if (!__tideData) __tideData = await apiGet('tides.php?start=' + todayDashed() + '&days=2');
        if (!__tideData || !__tideData.ok || !Array.isArray(__tideData.extremes)) {
            hide();
            return;
        }
        const now = Date.now();
        const next = __tideData.extremes
            .map((e) => ({ t: new Date(e.time).getTime(), type: e.type }))
            .filter((e) => e.t && e.t >= now - 3600000)
            .sort((a, b) => a.t - b.t)
            .slice(0, 4);
        if (!next.length) {
            hide();
            return;
        }
        body.innerHTML = next
            .map((e) => {
                const d = new Date(e.t);
                const hh = String(d.getHours()).padStart(2, '0'),
                    mm = String(d.getMinutes()).padStart(2, '0');
                const label = /high/i.test(e.type) ? 'High tide' : 'Low tide';
                return `<div style="display:flex;justify-content:space-between;gap:12px;"><span>${label}</span><span style="color:var(--text-muted);">${hh}:${mm}</span></div>`;
            })
            .join('');
        card.style.display = '';
    } catch (e) {
        hide();
    }
}
function renderLocalGuide(propKey) {
    const dk = siteContent['darkskies-' + propKey] || DEFAULT_DARKSKIES;
    const cf = siteContent['carfree-' + propKey] || DEFAULT_CARFREE;
    const ac = siteContent['access-' + propKey] || DEFAULT_ACCESS;
    const dkEl = document.getElementById('prop-darkskies');
    if (dkEl) dkEl.textContent = dk;
    const cfEl = document.getElementById('prop-carfree');
    if (cfEl) cfEl.textContent = cf;
    const acEl = document.getElementById('prop-access');
    if (acEl) acEl.textContent = ac;
    // Book-direct savings badge: only when the owner set a higher OTA price.
    const sv = document.getElementById('pr-savings');
    if (sv) {
        const ota = parseFloat(siteContent['ota-price-' + propKey]);
        const r = propertyRates[propKey] || defaultRates[propKey] || {};
        const ours = parseFloat(r.coupleRate);
        if (ota > 0 && ours > 0 && ota > ours) {
            sv.textContent = `Save ${gbp(ota - ours)}/night booking direct`;
            sv.style.display = '';
        } else {
            sv.style.display = 'none';
        }
    }
}
// ---- Guest photo wall (UGC): approved photos on the cottage page ----
async function renderGuestPhotos(propKey) {
    const section = document.getElementById('guest-photos-section');
    const divider = document.getElementById('guest-photos-divider');
    const grid = document.getElementById('guest-photo-grid');
    if (!section || !grid) return;
    const hide = () => {
        section.style.display = 'none';
        if (divider) divider.style.display = 'none';
    };
    try {
        const r = await apiGet('photos.php?prop=' + encodeURIComponent(propKey));
        const photos = (r && r.photos) || [];
        if (!photos.length) {
            hide();
            return;
        }
        grid.innerHTML = photos
            .map((p) => {
                const cap = p.caption ? `<div class="gp-cap">${escapeHtml(p.caption)}</div>` : '';
                const data = encodeURIComponent(p.url) + '|' + encodeURIComponent(p.caption || '');
                const label = escapeHtml(
                    p.caption || 'Guest photo at ' + ((propertyMeta[propKey] || {}).name || ''),
                );
                return `<div class="guest-photo" role="button" tabindex="0" aria-label="${label}" data-photo="${escapeHtml(data)}" onclick="openPhotoLightbox(this)" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();openPhotoLightbox(this)}"><img loading="lazy" src="${escapeHtml(p.url)}" alt="${label}">${cap}</div>`;
            })
            .join('');
        section.style.display = '';
        if (divider) divider.style.display = '';
    } catch (e) {
        hide();
    }
}
function openPhotoLightbox(data) {
    // Accepts the clicked element (data on its escaped data-photo attribute) or,
    // for backward-compat, a raw "url|caption" string. Reading from the attribute
    // avoids interpolating guest-supplied text into an inline onclick (XSS).
    if (data && data.dataset) data = data.dataset.photo || '';
    const [url, cap] = String(data).split('|').map(decodeURIComponent);
    const box = document.getElementById('photo-lightbox');
    const img = document.getElementById('pl-img');
    const c = document.getElementById('pl-cap');
    if (img) img.src = url;
    if (c) c.textContent = cap || '';
    if (box) {
        box.classList.add('open');
        document.body.style.overflow = 'hidden'; // lock scroll behind the lightbox
        const close = box.querySelector('.pl-close');
        if (close) close.focus();
    }
}
function closePhotoLightbox() {
    const box = document.getElementById('photo-lightbox');
    if (box) box.classList.remove('open');
    const img = document.getElementById('pl-img');
    if (img) img.src = '';
    document.body.style.overflow = '';
}

// ---- Trip planner (curated + tide-aware). AI seam: TRIP_PLAN_SOURCE can later
// switch to a 'tripplan.php' LLM endpoint without changing the UI/markup. ----
const TRIP_PLAN_SOURCE = 'curated';
const TRIP_INTERESTS = [
    ['seals', 'Seals'],
    ['beach', 'Beaches & coast'],
    ['walk', 'Walks'],
    ['kids', 'With kids'],
    ['foodie', 'Food & pubs'],
    ['rainy', 'Rainy day'],
];
const DEFAULT_TRIP_ACTIVITIES = [
    {
        name: 'Blakeney Point seal trip',
        blurb: 'Boat trip from Morston Quay to the seal colony — book ahead in season.',
        tags: ['seals', 'kids'],
        tide: 'high',
    },
    {
        name: 'Walk out to Blakeney Point',
        blurb: 'A long shingle walk to the seals and the old lifeboat house (~4 miles round trip).',
        tags: ['walk'],
        tide: 'low',
    },
    {
        name: 'Crabbing off Blakeney Quay',
        blurb: 'Drop a line off the quay when the tide is in — a classic with kids.',
        tags: ['kids', 'seals'],
        tide: 'high',
    },
    {
        name: 'Cley Marshes nature reserve',
        blurb: 'Norfolk Wildlife Trust reserve with birdwatching hides and a café.',
        tags: ['walk', 'kids'],
        tide: 'any',
    },
    {
        name: 'Saltmarsh walk to Morston',
        blurb: 'Follow the Norfolk Coast Path across the marshes.',
        tags: ['walk'],
        tide: 'low',
    },
    {
        name: 'Wells-next-the-Sea beach',
        blurb: 'Wide sandy beach, colourful beach huts and pinewoods.',
        tags: ['beach', 'kids'],
        tide: 'any',
    },
    {
        name: 'Holkham beach & estate',
        blurb: 'Vast nature-reserve beach backed by woodland.',
        tags: ['beach', 'walk'],
        tide: 'any',
    },
    {
        name: 'Wiveton Hall Café & farm shop',
        blurb: 'Fruit picking and lunch with a view over the marshes.',
        tags: ['foodie', 'kids'],
        tide: 'any',
    },
    {
        name: 'Blakeney pubs & seafood',
        blurb: 'Local crab, fish and a pint in the village.',
        tags: ['foodie'],
        tide: 'any',
    },
    {
        name: 'Cromer pier & crab',
        blurb: 'Victorian pier and the famous Cromer crab.',
        tags: ['foodie', 'kids'],
        tide: 'any',
    },
    {
        name: 'Cosy day in',
        blurb: 'Wood-burner, a good book and the rain on the window.',
        tags: ['rainy'],
        tide: 'any',
    },
    {
        name: 'Muckleburgh Collection',
        blurb: 'Military vehicle museum near Weybourne — a great rainy-day option.',
        tags: ['rainy', 'kids'],
        tide: 'any',
    },
];
function tripActivities() {
    const c = siteContent['trip-activities'];
    return Array.isArray(c) && c.length ? c : DEFAULT_TRIP_ACTIVITIES;
}
function openTripModal() {
    const wrap = document.getElementById('trip-interests');
    if (wrap)
        wrap.innerHTML = TRIP_INTERESTS.map(
            ([id, label]) =>
                `<button type="button" class="trip-chip" data-int="${id}" onclick="this.classList.toggle('on')">${label}</button>`,
        ).join('');
    const sel = document.getElementById('trip-days');
    if (sel)
        sel.innerHTML = [2, 3, 4, 5, 6, 7]
            .map((n) => `<option value="${n}" ${n === 3 ? 'selected' : ''}>${n}</option>`)
            .join('');
    const res = document.getElementById('trip-result');
    if (res) res.innerHTML = '';
    const m = document.getElementById('trip-modal');
    if (m) m.classList.add('open');
}
function closeTripModal() {
    const m = document.getElementById('trip-modal');
    if (m) m.classList.remove('open');
}
function runTripPlan() {
    const interests = Array.from(document.querySelectorAll('#trip-interests .trip-chip.on')).map(
        (b) => b.getAttribute('data-int'),
    );
    const days = Math.max(
        1,
        Math.min(7, parseInt((document.getElementById('trip-days') || {}).value, 10) || 3),
    );
    const plan = generateTripPlan({ interests, days });
    const res = document.getElementById('trip-result');
    if (!res) return;
    if (!plan.length) {
        res.innerHTML = `<p style="color:var(--text-muted);font-size:0.9rem;">Pick an interest or two and tap “Plan my days”.</p>`;
        return;
    }
    res.innerHTML =
        plan
            .map(
                (items, di) => `
                <div class="mo-card" style="margin-top:12px;">
                    <div class="mo-card-title">Day ${di + 1}</div>
                    ${items.map((it) => `<div style="margin-top:8px;"><strong>${escapeHtml(it.name)}</strong><span style="color:var(--accent);font-size:0.8rem;">${escapeHtml(it.tide)}</span><br><span style="font-size:0.85rem;color:var(--text-muted);">${escapeHtml(it.blurb)}</span></div>`).join('')}
                </div>`,
            )
            .join('') +
        `<p style="font-size:0.72rem;color:var(--text-muted);margin:10px 0 0;">A loose suggestion — check seasons/opening times. Tide notes use live Blakeney tide data when available.</p>`;
}
// Generation seam: curated now; a future AI source can replace this body.
function generateTripPlan(prefs) {
    if (TRIP_PLAN_SOURCE === 'curated') return curatedTripPlan(prefs);
    return curatedTripPlan(prefs);
}
function curatedTripPlan({ interests, days }) {
    const pool = tripActivities();
    let matched =
        interests && interests.length
            ? pool.filter((a) => (a.tags || []).some((t) => interests.includes(t)))
            : pool.slice();
    if (!matched.length) matched = pool.slice();
    matched = matched.slice().sort(() => Math.random() - 0.5);
    const tideNote = (a) => {
        if (!a.tide || a.tide === 'any') return '';
        const want = a.tide === 'high' ? 'high' : 'low';
        if (__tideData && __tideData.ok && Array.isArray(__tideData.extremes)) {
            const ex = __tideData.extremes
                .map((e) => ({ t: new Date(e.time), type: e.type }))
                .filter((e) => new RegExp(want, 'i').test(e.type) && e.t.getTime() >= Date.now())
                .sort((a, b) => a.t - b.t);
            if (ex.length) {
                const d = ex[0].t;
                return ` · best near ${want} tide (~${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')})`;
            }
        }
        return a.tide === 'high' ? ' · best around high tide' : ' · best around low tide';
    };
    const perDay = 2,
        plan = [];
    let i = 0;
    for (let d = 0; d < days && i < matched.length; d++) {
        const items = [];
        for (let n = 0; n < perDay && i < matched.length; n++, i++) {
            const a = matched[i];
            items.push({ name: a.name, blurb: a.blurb, tide: tideNote(a) });
        }
        plan.push(items);
    }
    return plan;
}
// ---- House rules: derived from each cottage's own settings ----
function renderHouseRules(propKey) {
    const wrap = document.getElementById('prop-house-rules');
    if (!wrap) return;
    const r = propertyRates[propKey] || defaultRates[propKey] || {};
    const lim = occupancyLimits[propKey] || {};
    const ci = r.checkInTime || '15:00';
    const co = r.checkOutTime || '10:00';
    const maxG = lim.maxTotal || 0;
    const item = (text) =>
        `<div class="things-item">${IC_CHECK} <span>${escapeHtml(text)}</span></div>`;
    // Auto lines from the functional booking rules, then the owner's custom
    // house-rules list (managed in Settings → Preferences → cottage → House rules).
    const custom = Array.isArray(siteContent['houserules-' + propKey])
        ? siteContent['houserules-' + propKey]
        : DEFAULT_HOUSE_RULES;
    wrap.innerHTML = [
        item(`Check-in after ${ci}`),
        item(`Checkout before ${co}`),
        maxG ? item(`${maxG} guest${maxG === 1 ? '' : 's'} maximum`) : '',
    ]
        .concat(custom.map(item))
        .join('');
}

// ---- "Where you'll be": exact-pin map from the cottage's saved coordinates ----
let __propMap = null;
async function renderLocationMap(propKey) {
    const el = document.getElementById('prop-map');
    if (!el) return;
    const geo = siteContent['geo-' + propKey];
    if (!geo || typeof geo.lat === 'undefined' || typeof geo.lng === 'undefined') {
        el.classList.add('is-empty');
        return; // no coordinates set -> show the address text only
    }
    el.classList.remove('is-empty');
    try {
        await loadLeaflet();
    } catch (e) {
        el.classList.add('is-empty');
        return;
    }
    if (__propMap) {
        try {
            __propMap.remove();
        } catch (e) {}
        __propMap = null;
    }
    el.innerHTML = '';
    const map = L.map(el, { zoomControl: true, attributionControl: true, scrollWheelZoom: false });
    map.attributionControl.setPrefix('');
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
        maxZoom: 20,
        subdomains: 'abcd',
        attribution: '© OpenStreetMap, © CARTO',
    }).addTo(map);
    map.setView([geo.lat, geo.lng], 15);
    const pin = L.divIcon({
        className: 'prop-pin',
        iconSize: [42, 42],
        iconAnchor: [21, 21],
        html: '<div class="prop-pin-dot"><svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 11l9-8 9 8"/><path d="M5 10v9h5v-5h4v5h5v-9"/></svg></div>',
    });
    L.marker([geo.lat, geo.lng], { icon: pin }).addTo(map);
    __propMap = map;
    setTimeout(() => {
        try {
            map.invalidateSize();
        } catch (e) {}
    }, 220);
}

// ---- Cottages page: Airbnb-style map of all cottages (desktop split layout) ----
// A sticky interactive map alongside the cards, one clickable "From £x" price pin
// per cottage. Reuses Leaflet + the cottages' saved coordinates (geo-<key>).
let __cottagesMap = null;
let __cottagesMarkers = {};
function highlightCottageCard(k, on) {
    const card = document.querySelector('#cottages a[data-prop="' + k + '"]');
    if (card) card.classList.toggle('map-highlight', !!on);
    const m = __cottagesMarkers[k];
    if (m && m._icon) m._icon.classList.toggle('is-active', !!on);
}
function wireCottageCardHover() {
    document.querySelectorAll('#cottages a[data-prop]').forEach((card) => {
        if (card.__mapWired) return;
        card.__mapWired = true;
        const k = card.getAttribute('data-prop');
        card.addEventListener('mouseenter', () => highlightCottageCard(k, true));
        card.addEventListener('mouseleave', () => highlightCottageCard(k, false));
    });
}
async function renderCottagesMap() {
    const el = document.getElementById('cottages-map');
    if (!el) return;
    const split = el.closest('.cottages-split');
    // The map pane is desktop-only (hidden by CSS on narrow screens) — skip work otherwise.
    if (window.matchMedia && !window.matchMedia('(min-width: 960px)').matches) return;
    wireCottageCardHover();
    const keys = liveCottageKeys().filter((k) => {
        const g = siteContent['geo-' + k];
        return g && g.lat != null && g.lng != null && isFinite(+g.lat) && isFinite(+g.lng);
    });
    // No cottage has coordinates yet — hide the pane and let the list go full-width.
    if (!keys.length) {
        el.classList.add('is-empty');
        if (split) split.classList.add('no-map');
        return;
    }
    el.classList.remove('is-empty');
    if (split) split.classList.remove('no-map');
    try {
        await loadLeaflet();
    } catch (e) {
        el.classList.add('is-empty');
        if (split) split.classList.add('no-map');
        return;
    }
    if (__cottagesMap) {
        try {
            __cottagesMap.remove();
        } catch (e) {}
        __cottagesMap = null;
    }
    __cottagesMarkers = {};
    el.innerHTML = '';
    const map = L.map(el, { zoomControl: true, attributionControl: true, scrollWheelZoom: false });
    map.attributionControl.setPrefix('');
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
        maxZoom: 19,
        subdomains: 'abcd',
        attribution: '© OpenStreetMap, © CARTO',
    }).addTo(map);

    // Overlap handling: the cottages are all in one village and pins can land on
    // top of each other. Nudge any pin that sits within ~SEP of an already-placed
    // one outward along a small spiral so every price pill stays clickable.
    const placed = [];
    const SEP = 0.00045; // ≈ 45–50 m
    const spread = (lat, lng) => {
        let a = lat,
            n = lng,
            t = 0;
        const clash = () =>
            placed.some((p) => Math.abs(p.lat - a) < SEP && Math.abs(p.lng - n) < SEP);
        while (clash() && t < 10) {
            t++;
            const ang = t * 2.39996; // golden angle
            const r = SEP * (1 + t * 0.5);
            a = lat + Math.sin(ang) * r;
            n = lng + (Math.cos(ang) * r) / Math.max(0.2, Math.cos((lat * Math.PI) / 180));
        }
        placed.push({ lat: a, lng: n });
        return [a, n];
    };

    const bounds = [];
    keys.forEach((k) => {
        const g = siteContent['geo-' + k];
        const [la, ln] = spread(+g.lat, +g.lng);
        bounds.push([la, ln]);
        const rate = (propertyRates[k] || defaultRates[k] || {}).coupleRate;
        const name = (propertyMeta[k] || {}).name || k;
        const label = rate != null ? 'From ' + gbp(rate) : escapeHtml(name);
        const icon = L.divIcon({
            className: 'map-price-pill',
            iconSize: null,
            html: '<div class="mp-pill">' + label + '</div>',
        });
        const marker = L.marker([la, ln], {
            icon,
            riseOnHover: true,
            keyboard: true,
            title: name,
            alt: name,
        }).addTo(map);
        marker.on('click', () => {
            try {
                openProperty(k);
            } catch (e) {}
        });
        marker.on('mouseover', () => highlightCottageCard(k, true));
        marker.on('mouseout', () => highlightCottageCard(k, false));
        __cottagesMarkers[k] = marker;
    });
    if (bounds.length === 1) map.setView(bounds[0], 15);
    else {
        try {
            map.fitBounds(bounds, { padding: [55, 55], maxZoom: 16 });
        } catch (e) {}
    }
    __cottagesMap = map;
    setTimeout(() => {
        try {
            map.invalidateSize();
        } catch (e) {}
    }, 220);
}

// Payment status config: label + colour. Keys are stored on each booking.
const paymentMeta = {
    paid: { label: 'Paid in Full', color: '#4CAF50', dot: '#4CAF50' },
    deposit: { label: 'Deposit Paid', color: '#FFA726', dot: '#FFA726' },
    unpaid: { label: 'Unpaid', color: '#E53935', dot: '#E53935' },
};

// ===================================================================
//  PRICING — per-property rates & fees (editable in the back office)
// ===================================================================
// coupleRate covers the first 2 adults, per night.
// extraAdultRate is per additional adult (beyond 2), per night.
// childRate is per child, per night.
// damagesDeposit is a refundable amount held per booking (NOT income).
// transactionPct is a % applied to the nightly rental total only.
const RATES_STORE_KEY = 'nn-property-rates';
const defaultRates = {
    '21a': {
        coupleRate: 130,
        extraAdultRate: 45,
        childRate: 30,
        damagesDeposit: 75,
        transactionPct: 3,
        checkInTime: '15:00',
        checkOutTime: '10:00',
        minNights: 2,
        maxNights: 0,
        arrivalDays: [],
        address: '21A Westgate Street, Blakeney, Norfolk NR25 7NQ',
    },
    jollyboat: {
        coupleRate: 110,
        extraAdultRate: 40,
        childRate: 25,
        damagesDeposit: 75,
        transactionPct: 3,
        checkInTime: '15:00',
        checkOutTime: '10:00',
        minNights: 2,
        maxNights: 0,
        arrivalDays: [],
        address: 'Jollyboat, Quay Road, Blakeney, Norfolk NR25 7ND',
    },
    pimpernel: {
        coupleRate: 120,
        extraAdultRate: 42,
        childRate: 28,
        damagesDeposit: 75,
        transactionPct: 3,
        checkInTime: '15:00',
        checkOutTime: '10:00',
        minNights: 2,
        maxNights: 0,
        arrivalDays: [],
        address: 'Pimpernel, High Street, Cley-next-the-Sea, Norfolk NR25 7RF',
    },
};
let propertyRates = JSON.parse(JSON.stringify(defaultRates));
// Seasonal couple-rate overrides per property: { propKey: [{label,start_date,end_date,couple_rate}] }
let propertySeasons = {};
// The cottages as the server knows them (source of truth for add/remove).
// Each: {prop_key, name, slug, accent, sort_order, archived}. Populated by
// loadRates(); the hardcoded maps above are only an offline/first-paint fallback.
let propertyList = [];
// The original three have hand-tuned colours + saved card content in app.css /
// the content table; new cottages get runtime colours + per-key card content.
const STATIC_COLOR_KEYS = { '21a': 1, jollyboat: 1, pimpernel: 1 };
const LEGACY_CARD_N = { '21a': 1, jollyboat: 2, pimpernel: 3 };

// Live (non-archived) cottage keys in display order — what the public site shows.
function liveCottageKeys() {
    if (propertyList && propertyList.length) {
        return propertyList.filter((p) => !p.archived).map((p) => p.prop_key);
    }
    return Object.keys(propertyMeta).filter((k) => !(propertyMeta[k] && propertyMeta[k].archived));
}
// The content keys for a cottage's home-page card. The original three keep
// their legacy card1/2/3 keys (so saved edits survive); new cottages use
// per-key keys. Reads prefer the per-key value, then the legacy one.
function cardKeys(k) {
    const n = LEGACY_CARD_N[k];
    return {
        img: n ? 'card' + n + '-img' : 'card-img-' + k,
        title: n ? 'card' + n + '-title' : 'card-title-' + k,
        meta: n ? 'card' + n + '-meta' : 'card-meta-' + k,
    };
}
// A friendly "Sleeps N" line from a cottage's occupancy caps (card fallback).
function cottageSleepsLabel(k) {
    const o = occupancyLimits[k];
    if (!o) return '';
    return 'Sleeps ' + (o.maxTotal || o.maxAdults || 2);
}

function persistRates() {
    /* rates are saved per-field via updateRate -> API */
}
async function loadRates() {
    try {
        const res = await apiGet('rates.php');
        const properties = res.properties;
        // Seasonal rates per property (may be absent if migration not run)
        propertySeasons = res.seasons || {};
        // Occupancy caps come from the server (single source of truth); the
        // hardcoded occupancyLimits below act only as an offline fallback.
        if (res.occupancy && typeof res.occupancy === 'object') {
            Object.keys(res.occupancy).forEach((k) => {
                occupancyLimits[k] = res.occupancy[k];
            });
        }
        propertyList = (properties || []).map((p) => ({
            prop_key: p.prop_key,
            name: p.name,
            slug: p.slug || p.prop_key,
            accent: p.accent || '',
            sort_order: p.sort_order || 100,
            archived: !!p.archived,
        }));
        (properties || []).forEach((p) => {
            const k = p.prop_key;
            const def = defaultRates[k] || {};
            propertyRates[k] = {
                coupleRate: parseFloat(p.couple_rate),
                extraAdultRate: parseFloat(p.extra_adult_rate),
                childRate: parseFloat(p.child_rate),
                damagesDeposit: parseFloat(p.booking_fee),
                transactionPct: parseFloat(p.transaction_pct),
                weekendPct: parseFloat(p.weekend_pct) || 0,
                weekendDays: p.weekend_days || '5,6',
                address: p.address || '',
                // Booking rules aren't stored in the rates table; carry the
                // defaults here so loadContent can layer any saved overrides on top.
                checkInTime: def.checkInTime || '15:00',
                checkOutTime: def.checkOutTime || '10:00',
                minNights: def.minNights || 1,
                maxNights: def.maxNights || 0,
                arrivalDays: Array.isArray(def.arrivalDays) ? def.arrivalDays.slice() : [],
            };
            // Synthesize the front-end maps for any cottage the owner has added,
            // so a new one behaves exactly like the original three (name, colour,
            // page content, pretty URL) without being hardcoded.
            const existing = propertyMeta[k] || {};
            propertyMeta[k] = {
                name: p.name || existing.name || k,
                short: existing.short || (p.name || k).split(/\s+/)[0],
                color: existing.color || '',
                accent: p.accent || existing.accent || '#8FB3C7',
                slug: p.slug || k,
                archived: !!p.archived,
            };
            if (!propertyContent[k])
                propertyContent[k] = { title: p.name || k, desc: '', amenities: [], images: [] };
            if (!(k in propSubtitleDefault)) propSubtitleDefault[k] = '';
            const slug = (p.slug || k).toLowerCase();
            COTTAGE_SLUGS[k] = slug;
            SLUG_TO_KEY[slug] = k;
        });
        try {
            injectPropColors();
        } catch (e) {}
        try {
            renderCottageCards();
        } catch (e) {}
        try {
            renderHomeCottages();
        } catch (e) {}
        try {
            injectStructuredData();
        } catch (e) {}
        try {
            loadPublicAvailability();
        } catch (e) {}
        try {
            updateHeritageStats();
        } catch (e) {}
        try {
            renderGuestWords();
        } catch (e) {}
        try {
            enquiryResumeShow();
        } catch (e) {}
    } catch (e) {
        /* keep defaults if the API is unavailable */
    }
}

function nightsBetween(checkIn, checkOut) {
    if (!checkIn || !checkOut) return 0;
    const a = new Date(checkIn),
        b = new Date(checkOut);
    const diff = Math.round((b - a) / 86400000);
    return diff > 0 ? diff : 0;
}

// Full price breakdown. Couple rate covers first 2 adults; extra adults &
// children priced per head. {propKey, adults, children, checkIn, checkOut}
// Couple rate for one night (YYYY-MM-DD): first matching season wins
// (inclusive of start and end dates), else the property's base rate.
// EXACTLY mirrors couple_rate_for_night() in pricing.php.
function coupleRateForNight(dateStr, baseRate, seasons) {
    for (const s of seasons || []) {
        if (dateStr >= s.start_date && dateStr <= s.end_date) return parseFloat(s.couple_rate);
    }
    return baseRate;
}
// Weekend uplift % for a night, from a rate object. weekendDays is a CSV of
// day-of-week numbers (0=Sun … 6=Sat); default Fri,Sat. MUST mirror
// weekend_pct_for_night() in pricing.php exactly (lockstep, tested).
function weekendPctFor(dateStr, r) {
    const pct = parseFloat(r && r.weekendPct) || 0;
    if (pct <= 0) return 0;
    // Default to Fri/Sat only when weekendDays is absent — an EMPTY string means
    // "no weekend days" and must NOT fall back to the default, or JS would apply
    // an uplift PHP doesn't (price_breakdown / weekend_pct_for_night). Keep both
    // engines identical here; the parity tests cover the empty-string case.
    const raw = r && r.weekendDays != null ? String(r.weekendDays) : '5,6';
    const days = raw
        .split(',')
        .map((s) => parseInt(s, 10))
        .filter((n) => !isNaN(n));
    const dow = new Date(dateStr + 'T00:00:00Z').getUTCDay();
    return days.indexOf(dow) !== -1 ? pct : 0;
}
// Full nightly rate for a date: season/base, then the weekend uplift if any.
function nightlyRateFor(dateStr, r, seasons) {
    const base = coupleRateForNight(dateStr, (r && r.coupleRate) || 0, seasons);
    const pct = weekendPctFor(dateStr, r);
    return pct > 0 ? base * (1 + pct / 100) : base;
}

function priceBreakdown(propKey, adults, children, checkIn, checkOut, depositOverride) {
    const r = propertyRates[propKey] ||
        defaultRates[propKey] || {
            coupleRate: 0,
            extraAdultRate: 0,
            childRate: 0,
            damagesDeposit: 0,
            transactionPct: 0,
        };
    const nights = nightsBetween(checkIn, checkOut);
    const extraAdults = Math.max(0, (adults || 0) - 2);
    const extrasPerNight = extraAdults * r.extraAdultRate + (children || 0) * r.childRate;
    const seasons = propertySeasons[propKey] || [];
    // Sum night-by-night — each night's couple rate can differ by season.
    // EXACTLY mirrors price_breakdown() in pricing.php.
    let nightly = 0;
    const t = new Date(checkIn + 'T00:00:00Z').getTime();
    for (let i = 0; i < nights; i++) {
        const d = new Date(t + i * 86400000).toISOString().slice(0, 10);
        nightly += nightlyRateFor(d, r, seasons) + extrasPerNight;
    }
    nightly = Math.round(nightly * 100) / 100;
    const perNight =
        nights > 0 ? Math.round((nightly / nights) * 100) / 100 : r.coupleRate + extrasPerNight;
    // Refundable damages deposit: held, NOT income. Per-booking override allowed,
    // else the property's standard amount. Only applies to a real stay.
    const depBase =
        depositOverride != null && depositOverride !== ''
            ? parseFloat(depositOverride)
            : r.damagesDeposit;
    const damagesDeposit = nights > 0 ? Math.max(0, depBase) || 0 : 0;
    // Transaction fee applies to rental income only (not the held deposit).
    const txFee = Math.round(nightly * (r.transactionPct / 100) * 100) / 100;
    // The damages deposit is taken as a separate card HOLD near arrival (authorised,
    // not captured), so it is NOT part of the total the guest is charged.
    const rentalTotal = nightly + txFee;
    const total = rentalTotal;
    return {
        nights,
        perNight,
        nightly,
        damagesDeposit,
        transactionPct: r.transactionPct,
        txFee,
        rentalTotal,
        total,
        extraAdults,
    };
}

// Freeze the agreed price onto a booking at the moment it is created or its
// stay is changed. After this, the booking shows THIS figure even if the
// property's rates later change in Settings & Fees.
function snapshotPrice(propKey, booking) {
    const p = priceBreakdown(
        propKey,
        booking.adults,
        booking.children,
        booking.checkIn,
        booking.checkOut,
        booking.damagesDeposit,
    );
    booking.agreedPrice = {
        nights: p.nights,
        perNight: p.perNight,
        nightly: p.nightly,
        damagesDeposit: p.damagesDeposit,
        transactionPct: p.transactionPct,
        txFee: p.txFee,
        rentalTotal: p.rentalTotal,
        total: p.total,
        extraAdults: p.extraAdults,
        agreedOn: todayDashed(),
    };
    return booking;
}

function gbp(n) {
    return (
        '£' +
        Number(n).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    );
}

// Total / deposit-paid / balance for a booking, using the agreed (locked) price.
function paymentSummary(propKey, b) {
    const p =
        b.agreedPrice ||
        priceBreakdown(propKey, b.adults || 0, b.children || 0, b.checkIn, b.checkOut);
    const total = p.total;
    let deposit = Math.max(0, Number(b.depositPaid) || 0);
    // If the booking is recorded as fully paid, the deposit IS the total — this
    // keeps the status and the balance consistent even for older bookings that
    // have no locked agreedPrice and whose live total has since drifted.
    if (b.payment === 'paid') deposit = total;
    if (deposit > total) deposit = total; // can't pay more than the total
    const balance = Math.round((total - deposit) * 100) / 100;
    const fullyPaid = b.payment === 'paid' || balance <= 0.001;
    return { total, deposit, balance, fullyPaid };
}

// Compute a depositPaid value consistent with a chosen status.
// Returns the numeric deposit, or null if the user cancels the prompt.
async function reconcileDeposit(propKey, booking, status) {
    const p =
        booking.agreedPrice ||
        priceBreakdown(
            propKey,
            booking.adults || 0,
            booking.children || 0,
            booking.checkIn,
            booking.checkOut,
        );
    const total = p.total;
    let dep = Math.max(0, Number(booking.depositPaid) || 0);
    if (status === 'paid') return Math.round(total * 100) / 100;
    if (status === 'unpaid') return 0;
    // 'deposit' — needs a partial amount
    if (dep > 0 && dep < total) return Math.round(dep * 100) / 100;
    const entered = await glassPrompt(
        `Deposit paid (£). Must be between £0.01 and ${gbp(total - 0.01)}:`,
        '',
    );
    if (entered === null) return null;
    let val = Math.max(0, parseFloat(entered) || 0);
    if (val <= 0 || val >= total) {
        glassAlert(
            "A deposit must be more than £0 and less than the full total. Use 'Paid in Full' or 'Unpaid' instead.",
        );
        return null;
    }
    return Math.round(val * 100) / 100;
}

// Dummy Database
const dbBookings = {
    '21a': [],
    jollyboat: [],
    pimpernel: [],
};

// External (Airbnb/Vrbo) blocks imported via iCal, keyed by property.
// Each entry: { id, source, checkIn, checkOut }
const dbBlocks = {
    '21a': [],
    jollyboat: [],
    pimpernel: [],
};

// Default the back-office calendar to the current month.
let calDate = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

// ===================================================================
//  DATA LAYER — persists the whole booking DB + the enquiry inbox
// ===================================================================
const DB_STORE_KEY = 'nn-bookings-db';
const ENQ_STORE_KEY = 'nn-enquiries';
// One-time cleanup: wipe any test data saved by earlier versions so the
// back office genuinely starts empty. Bump this flag to force another reset.
const DATA_RESET_FLAG = 'nn-data-reset-v4';
(function purgeOldTestData() {
    try {
        if (localStorage.getItem(DATA_RESET_FLAG)) return;
        localStorage.removeItem(DB_STORE_KEY);
        localStorage.removeItem(ENQ_STORE_KEY);
        localStorage.removeItem('nn-payment-status'); // legacy key from older builds
        localStorage.removeItem('prop1-price'); // legacy price-heading edit (now dynamic)
        localStorage.setItem(DATA_RESET_FLAG, '1');
    } catch (e) {}
})();

// One-time, non-destructive clear of any saved logo/brand text edits so the
// renamed brand shows. Does NOT touch bookings, enquiries or accounts.
(function clearLegacyBrandEdits() {
    try {
        if (localStorage.getItem('nn-brand-rename-v1')) return;
        localStorage.removeItem('site-logo');
        localStorage.setItem('nn-brand-rename-v1', '1');
    } catch (e) {}
})();

// No seed data — the inbox starts empty and fills from real enquiries.
const seedEnquiries = [];
let enquiries = [];

// ----- Guest accounts (backend-backed) -----
let currentGuest = null; // {name,email,phone} when logged in, else null

// Restore the guest session from the server cookie
async function restoreGuestSession() {
    try {
        const res = await apiPost('auth.php', { action: 'guest_status' });
        currentGuest = res.guest || null;
    } catch (e) {
        currentGuest = null;
    }
}

// persistDB/persistEnquiries are now no-ops: writes go straight to the
// backend via the action functions. Kept as stubs so existing callers work.
function persistDB() {
    /* server is the source of truth */
}
function persistEnquiries() {
    /* server is the source of truth */
}

// Load bookings + enquiries + rates from the backend into memory.
// Admin-only data (full bookings/enquiries) requires an admin session;
// if not logged in those fetches simply yield empty lists.
async function loadData() {
    // These four reads are independent, so fetch them in parallel rather than
    // one-after-another. Each task handles its own errors and resets its own
    // state on failure, so one failing endpoint never blocks the others.
    const ratesTask = loadRates();

    const bookingsTask = (async () => {
        try {
            const { bookings } = await apiGet('bookings.php');
            Object.keys(dbBookings).forEach((k) => {
                dbBookings[k] = [];
            });
            (bookings || []).forEach((row) => {
                const b = mapBookingFromApi(row);
                // Seed the key for owner-added cottages (mirrors the blocks task
                // below) — otherwise their bookings are silently dropped from
                // the whole back office (calendar, Today, Money, clash checks).
                if (!dbBookings[row.prop_key]) dbBookings[row.prop_key] = [];
                dbBookings[row.prop_key].push(b);
            });
        } catch (e) {
            Object.keys(dbBookings).forEach((k) => {
                dbBookings[k] = [];
            });
        }
    })();

    const enquiriesTask = (async () => {
        try {
            const { enquiries: rows } = await apiGet('enquiries.php');
            enquiries = (rows || []).map(mapEnquiryFromApi);
        } catch (e) {
            enquiries = [];
        }
    })();

    // External (iCal) blocks — Airbnb/Vrbo dates imported by the sync.
    // Admin-only; if not logged in this 403s and we just keep them empty.
    const blocksTask = (async () => {
        try {
            const r = await apiPost('ical-import.php', { action: 'blocks' });
            Object.keys(dbBlocks).forEach((k) => {
                dbBlocks[k] = [];
            });
            (r.blocks || []).forEach((row) => {
                if (!dbBlocks[row.prop_key]) dbBlocks[row.prop_key] = [];
                dbBlocks[row.prop_key].push({
                    id: row.id,
                    source: row.source,
                    checkIn: row.check_in,
                    checkOut: row.check_out,
                });
            });
            dedupeExternalBlocks();
        } catch (e) {
            Object.keys(dbBlocks).forEach((k) => {
                dbBlocks[k] = [];
            });
        }
    })();

    await Promise.all([ratesTask, bookingsTask, enquiriesTask, blocksTask]);

    // Local (website) bookings are the source of truth. Our site exports its
    // bookings to Airbnb/Vrbo, which re-import them as blocks — so an external
    // block that overlaps one of our own bookings is just a mirror of it.
    // Drop those external blocks so only the real local booking shows.
    suppressBlocksUnderLocalBookings();
}

// True when two checkout-exclusive date ranges [in, out) overlap.
function rangesOverlap(aIn, aOut, bIn, bOut) {
    return !!(aIn && aOut && bIn && bOut) && aIn < bOut && bIn < aOut;
}

// Hide any external (iCal) block that overlaps a local booking for the same
// property — local data takes precedence on the calendar.
function suppressBlocksUnderLocalBookings() {
    Object.keys(dbBlocks).forEach((k) => {
        const locals = dbBookings[k] || [];
        if (!locals.length) return;
        dbBlocks[k] = (dbBlocks[k] || []).filter(
            (bl) =>
                !locals.some((bk) =>
                    rangesOverlap(bl.checkIn, bl.checkOut, bk.checkIn, bk.checkOut),
                ),
        );
    });
}

// Cross-listing de-duplication.
// Airbnb and Vrbo each import the OTHER's calendar, so a single booking
// typically arrives in BOTH feeds for the exact same dates. Left as-is it
// would show twice on the calendar. Here we collapse blocks that cover the
// identical date range (per property) down to one, and remember the other
// platforms it also came from. We only merge EXACT date-range matches: a
// genuine double-booking is impossible for identical dates (the first
// booking blocks those dates on the other platform via the same sync), so
// this can't hide a real clash.
function dedupeExternalBlocks() {
    Object.keys(dbBlocks).forEach((k) => {
        const byRange = new Map();
        (dbBlocks[k] || []).forEach((bl) => {
            const rangeKey = bl.checkIn + '|' + bl.checkOut;
            const existing = byRange.get(rangeKey);
            if (!existing) {
                bl.sources = [bl.source];
                byRange.set(rangeKey, bl);
            } else if (!existing.sources.includes(bl.source)) {
                existing.sources.push(bl.source); // same booking, second feed
            }
        });
        dbBlocks[k] = Array.from(byRange.values());
    });
}

// Friendly name for an iCal feed source key (e.g. 'airbnb' -> 'Airbnb').
function sourceLabel(src) {
    const s = (src || '').toLowerCase();
    const map = {
        airbnb: 'Airbnb',
        vrbo: 'Vrbo',
        booking: 'Booking.com',
        bookingcom: 'Booking.com',
        google: 'Google',
    };
    if (map[s]) return map[s];
    return src ? src.charAt(0).toUpperCase() + src.slice(1) : 'External';
}
// Friendly label covering every feed a (possibly de-duplicated) block came
// from, e.g. "Airbnb + Vrbo" when the same booking arrived in both.
function blockSourcesLabel(bl) {
    const srcs = bl && bl.sources && bl.sources.length ? bl.sources : [bl && bl.source];
    return srcs.filter(Boolean).map(sourceLabel).join(' + ') || 'External';
}

// External blocks covering a given date for a property (checkout day exclusive).
function getBlocksForDate(dateStr, propKey) {
    return (dbBlocks[propKey] || []).filter((bl) => dateStr >= bl.checkIn && dateStr < bl.checkOut);
}

function findBookingById(bookingId) {
    for (const list of Object.values(dbBookings)) {
        const found = list.find((b) => b.id === bookingId);
        if (found) return found;
    }
    return null;
}

function findBookingLocation(bookingId) {
    for (const propKey of Object.keys(dbBookings)) {
        const idx = dbBookings[propKey].findIndex((b) => b.id === bookingId);
        if (idx !== -1) return { propKey, idx };
    }
    return null;
}

// Detect a date-range clash for a property (ignores a record being edited)
function hasDateClash(propKey, checkIn, checkOut, ignoreId = null) {
    // overlap if start < other end AND end > other start (checkout day is free)
    const bookingClash = (dbBookings[propKey] || []).some((b) => {
        if (b.id === ignoreId) return false;
        return checkIn < b.checkOut && checkOut > b.checkIn;
    });
    if (bookingClash) return true;
    // Also respect imported Airbnb/Vrbo (iCal) blocks, exactly like the server's
    // clash_message/dates_clash — so the admin warning catches external bookings too.
    return (dbBlocks[propKey] || []).some((bl) => checkIn < bl.checkOut && checkOut > bl.checkIn);
}

// Changing the status must stay consistent with the recorded deposit:
//  • Paid in Full  → deposit becomes the full total
//  • Unpaid        → deposit resets to £0
//  • Deposit Paid  → keep a partial amount; if none/over, prompt for one
// A payment date is REQUIRED whenever money is recorded. If none is set,
// prompt for one (defaulting to today) and validate it. Returns true if a
// valid date is now present, false if the user cancelled / gave a bad date.
async function ensurePaymentDate(booking) {
    if (booking.paymentDate && /^\d{4}-\d{2}-\d{2}$/.test(booking.paymentDate)) return true;
    const today = todayDashed();
    const entered = await glassPrompt('A payment date is required (YYYY-MM-DD):', today);
    if (entered === null) return false; // cancelled
    const val = entered.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(val) || isNaN(new Date(val).getTime())) {
        glassAlert('Please enter a valid date in YYYY-MM-DD format.');
        return false;
    }
    booking.paymentDate = val;
    return true;
}

async function updatePaymentStatus(bookingId, newStatus) {
    const booking = findBookingById(bookingId);
    if (!booking) return;
    const loc = findBookingLocation(bookingId);
    const propKey = loc ? loc.propKey : '21a';
    const payload = { id: booking.dbId, payment: newStatus };

    if (newStatus === 'deposit') {
        const total =
            (booking.agreedPrice && booking.agreedPrice.total) ||
            priceBreakdown(
                propKey,
                booking.adults || 0,
                booking.children || 0,
                booking.checkIn,
                booking.checkOut,
            ).total ||
            0;
        const existing =
            booking.depositPaid > 0 && booking.depositPaid < total ? booking.depositPaid : '';
        const entered = await glassPrompt(
            `Deposit amount paid (£). More than £0 and less than ${gbp(total)}:`,
            existing,
        );
        if (entered === null) {
            afterPaymentChange(bookingId);
            return;
        }
        payload.deposit = Math.max(0, parseFloat(entered) || 0);
    }
    if (newStatus === 'deposit' || newStatus === 'paid') {
        const d = await glassPrompt(
            'Payment date (YYYY-MM-DD):',
            booking.paymentDate || todayDashed(),
        );
        if (d === null) {
            afterPaymentChange(bookingId);
            return;
        }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(d.trim())) {
            glassAlert('A valid payment date is required.');
            afterPaymentChange(bookingId);
            return;
        }
        payload.payment_date = d.trim();
        const m = await glassPrompt('Payment method (optional):', booking.paymentMethod || '');
        payload.payment_method = m === null ? '' : m.trim();
    }

    try {
        await apiPost('bookings.php', { action: 'set_payment', ...payload });
        await loadData();
        renderCalendar();
        const fresh = findBookingById(bookingId);
        if (fresh) afterPaymentChange(bookingId);
    } catch (e) {
        glassAlert("Couldn't update payment: " + e.message);
        afterPaymentChange(bookingId);
    }
}

// Staff records how much deposit has been paid; status auto-syncs server-side.
async function updateDeposit(bookingId, value) {
    const booking = findBookingById(bookingId);
    if (!booking) return;
    const loc = findBookingLocation(bookingId);
    const propKey = loc ? loc.propKey : '21a';
    const total =
        (booking.agreedPrice && booking.agreedPrice.total) ||
        priceBreakdown(
            propKey,
            booking.adults || 0,
            booking.children || 0,
            booking.checkIn,
            booking.checkOut,
        ).total ||
        0;
    let dep = Math.max(0, parseFloat(value) || 0);
    if (dep > total) dep = total;
    // Derive status from amount
    let status;
    if (dep <= 0.001) status = 'unpaid';
    else if (dep >= total - 0.001) status = 'paid';
    else status = 'deposit';

    const payload = { id: booking.dbId, payment: status };
    if (status === 'deposit') payload.deposit = Math.round(dep * 100) / 100;
    if (dep > 0.001) {
        const d = await glassPrompt(
            'Payment date (YYYY-MM-DD):',
            booking.paymentDate || todayDashed(),
        );
        if (d === null) {
            afterPaymentChange(bookingId);
            return;
        }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(d.trim())) {
            glassAlert('A valid payment date is required.');
            afterPaymentChange(bookingId);
            return;
        }
        payload.payment_date = d.trim();
        payload.payment_method = booking.paymentMethod || '';
    }
    try {
        await apiPost('bookings.php', { action: 'set_payment', ...payload });
        await loadData();
        renderCalendar();
        const fresh = findBookingById(bookingId);
        if (fresh) afterPaymentChange(bookingId);
    } catch (e) {
        glassAlert("Couldn't update deposit: " + e.message);
        afterPaymentChange(bookingId);
    }
}

// Setter for payment metadata (method, date) without changing the amount.
async function updatePaymentField(bookingId, field, value) {
    const booking = findBookingById(bookingId);
    if (!booking) return;
    const loc = findBookingLocation(bookingId);
    const propKey = loc ? loc.propKey : '21a';
    if (field === 'paymentDate' && !value && Number(booking.depositPaid) > 0) {
        glassAlert(
            'A payment date is required while a payment is recorded. Set the deposit to £0 first if you need to remove it.',
        );
        afterPaymentChange(bookingId);
        return;
    }
    // Re-send the current payment with the changed metadata field
    const payload = {
        id: booking.dbId,
        payment: booking.payment,
        deposit: booking.depositPaid,
        payment_date: field === 'paymentDate' ? value : booking.paymentDate || '',
        payment_method: field === 'paymentMethod' ? value : booking.paymentMethod || '',
    };
    try {
        await apiPost('bookings.php', { action: 'set_payment', ...payload });
        await loadData();
        renderCalendar();
        const fresh = findBookingById(bookingId);
        if (fresh) afterPaymentChange(bookingId);
    } catch (e) {
        glassAlert("Couldn't update: " + e.message);
        afterPaymentChange(bookingId);
    }
}

// ---- Square online payments (admin) ----
let squareAdminEnabled = false;
async function loadSquareAdminConfig() {
    try {
        const c = await apiGet('square-config.php');
        squareAdminEnabled = !!c.enabled;
    } catch (e) {
        squareAdminEnabled = false;
    }
    try {
        renderSquareSettings();
    } catch (e) {}
}
function renderSquareSettings() {
    const st = document.getElementById('sq-settings-status');
    if (st)
        st.innerHTML = squareAdminEnabled
            ? '<span style="color:#4CAF50;">●</span> Connected — guests can pay by card. Send a request from any booking\'s details.'
            : '<span style="color:#FFA726;">●</span> Not set up — add your Square keys in <code>config.php</code> and set <code>SQUARE_PAYMENTS_ENABLED</code> to true.';
    const inp = document.getElementById('sq-deposit-pct');
    if (inp) {
        const v = parseFloat(siteContent['square-deposit-pct']);
        inp.value = v > 0 && v <= 100 ? v : 25;
    }
}
async function saveDepositPct() {
    const v = Math.round(parseFloat((document.getElementById('sq-deposit-pct') || {}).value) || 0);
    if (!(v >= 1 && v <= 100)) {
        glassAlert('Enter a deposit percentage between 1 and 100.');
        return;
    }
    try {
        await saveContent('square-deposit-pct', v);
        siteContent['square-deposit-pct'] = v;
        toast('Deposit policy saved.');
    } catch (e) {
        glassAlert("Couldn't save: " + e.message);
    }
}
// Email the guest a secure pay link (deposit or balance).
async function requestPayment(bookingId, kind) {
    const booking = findBookingById(bookingId);
    if (!booking) return;
    try {
        const res = await apiPost('bookings.php', {
            action: 'request_payment',
            id: booking.dbId,
            kind,
        });
        toast(`${kind === 'balance' ? 'Balance' : 'Deposit'} request sent — ${gbp(res.amount)}.`);
    } catch (e) {
        glassAlert("Couldn't send the payment request: " + e.message);
    }
}
// Copy a secure pay link to the clipboard, to share by WhatsApp/SMS/etc.
async function copyPayLink(bookingId, kind) {
    const booking = findBookingById(bookingId);
    if (!booking) return;
    try {
        const res = await apiPost('bookings.php', { action: 'pay_link', id: booking.dbId, kind });
        const url = res.url || '';
        if (!url) throw new Error('No link returned.');
        let copied = false;
        try {
            await navigator.clipboard.writeText(url);
            copied = true;
        } catch (e) {
            /* clipboard blocked */
        }
        if (copied) toast('Pay link copied to clipboard.');
        else await glassAlert('Copy this secure pay link:\n\n' + url);
    } catch (e) {
        glassAlert("Couldn't get the pay link: " + e.message);
    }
}
// ---- Refundable damage deposit as a Square card HOLD (admin controls) ----
function holdControls(b) {
    if (typeof squareAdminEnabled === 'undefined' || !squareAdminEnabled || !b.email) return '';
    const amt = b.holdAmount || (b.agreedPrice ? b.agreedPrice.damagesDeposit : 0) || 0;
    if (amt <= 0) return '';
    const st = b.holdStatus || 'none';
    if (st === 'authorized')
        return `<div class="money-deposit"><span>Damage hold: <strong>${gbp(amt)} held</strong></span>
                <button class="btn-sm btn-edit" onclick="releaseHold('${b.id}')">Release</button>
                <button class="btn-sm btn-edit" onclick="captureHold('${b.id}')">Capture (damage)</button></div>`;
    if (st === 'captured')
        return `<div class="money-deposit"><span>Damage hold: <strong style="color:#E57373;">${gbp(amt)} captured</strong> for damage</span></div>`;
    if (st === 'released')
        return `<div class="money-deposit"><span>Damage hold: <span style="color:#4CAF50;">released</span></span></div>`;
    if (st === 'expired')
        return `<div class="money-deposit"><span>Damage hold: expired (auto-released)</span> <button class="btn-sm btn-edit" onclick="requestHold('${b.id}')">Re-request</button></div>`;
    return `<div class="money-deposit"><span>Refundable damage hold (${gbp(amt)})</span>
                <button class="btn-sm btn-edit" onclick="requestHold('${b.id}')">Request hold</button>
                <button class="btn-sm btn-edit" onclick="copyHoldLink('${b.id}')">Copy hold link</button></div>`;
}
async function requestHold(bookingId) {
    const booking = findBookingById(bookingId);
    if (!booking) return;
    try {
        const res = await apiPost('bookings.php', { action: 'hold_request', id: booking.dbId });
        toast(`Card-hold request sent — ${gbp(res.amount)}.`);
    } catch (e) {
        glassAlert("Couldn't send the hold request: " + e.message);
    }
}
async function copyHoldLink(bookingId) {
    const booking = findBookingById(bookingId);
    if (!booking) return;
    try {
        const res = await apiPost('bookings.php', { action: 'hold_link', id: booking.dbId });
        const url = res.url || '';
        if (!url) throw new Error('No link returned.');
        let copied = false;
        try {
            await navigator.clipboard.writeText(url);
            copied = true;
        } catch (e) {}
        if (copied) toast('Hold link copied to clipboard.');
        else await glassAlert('Copy this secure card-hold link:\n\n' + url);
    } catch (e) {
        glassAlert("Couldn't get the hold link: " + e.message);
    }
}
async function captureHold(bookingId) {
    const booking = findBookingById(bookingId);
    if (!booking) return;
    if (
        !(await glassConfirm(
            'Capture the full damage hold? Use this only if there IS damage — it takes the held amount. (If the damage was less, capture then refund the difference.)',
        ))
    )
        return;
    try {
        const res = await apiPost('bookings.php', { action: 'hold_capture', id: booking.dbId });
        toast(`Hold captured — ${gbp(res.captured)}.`);
        try {
            await loadData();
            renderMoneyPanel();
        } catch (e) {}
    } catch (e) {
        glassAlert("Couldn't capture the hold: " + e.message);
    }
}
async function releaseHold(bookingId) {
    const booking = findBookingById(bookingId);
    if (!booking) return;
    if (
        !(await glassConfirm(
            "Release the damage hold? This frees the held funds on the guest's card.",
        ))
    )
        return;
    try {
        await apiPost('bookings.php', { action: 'hold_release', id: booking.dbId });
        toast('Hold released.');
        try {
            await loadData();
            renderMoneyPanel();
        } catch (e) {}
    } catch (e) {
        glassAlert("Couldn't release the hold: " + e.message);
    }
}
// Show the Square payment ledger for a booking inside the details modal.
async function loadBookingPayments(bookingId) {
    const el = document.getElementById('sq-pay-' + bookingId);
    if (!el) return;
    const booking = findBookingById(bookingId);
    if (!booking) {
        el.textContent = '';
        return;
    }
    try {
        const res = await apiPost('bookings.php', { action: 'payments', id: booking.dbId });
        const list = res.payments || [];
        if (!list.length) {
            el.textContent = 'No online payments yet.';
            return;
        }
        el.innerHTML = list
            .map((p) => {
                const isCharge = p.kind === 'deposit' || p.kind === 'balance';
                const live = p.status === 'COMPLETED' || p.status === 'APPROVED';
                const refundBtn =
                    isCharge && live
                        ? `<button class="btn-sm btn-decline" style="padding:4px 10px;font-size:0.72rem;" onclick="refundPayment('${bookingId}','${p.square_payment_id}',${parseFloat(p.amount)})">Refund</button>`
                        : '';
                const isReturn = p.kind === 'refund' || p.kind === 'damages_return';
                const label =
                    p.kind === 'refund'
                        ? 'Refund'
                        : p.kind === 'damages_return'
                          ? 'Deposit return'
                          : p.kind.charAt(0).toUpperCase() + p.kind.slice(1);
                const sign = isReturn ? '−' : '';
                const note = (p.note || '').trim();
                return `<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 0;border-top:1px solid var(--glass-border);">
                        <span>${label} · ${sign}${gbp(p.amount)} <span style="opacity:.7;">(${escapeHtml(p.status)})</span>${note ? ` <span style="opacity:.7;">— ${escapeHtml(note)}</span>` : ''}</span>${refundBtn}</div>`;
            })
            .join('');
    } catch (e) {
        el.textContent = 'Could not load payments.';
    }
}
async function refundPayment(bookingId, squareId, maxAmount) {
    const booking = findBookingById(bookingId);
    if (!booking) return;
    const loc = findBookingLocation(bookingId);
    const propKey = loc ? loc.propKey : '21a';
    const entered = await glassPrompt(
        `Refund amount (£). Up to ${gbp(maxAmount)}:`,
        String(maxAmount),
    );
    if (entered === null) return;
    const amount = Math.round((parseFloat(entered) || 0) * 100) / 100;
    if (!(amount > 0 && amount <= maxAmount + 0.001)) {
        glassAlert(`Enter an amount between £0 and ${gbp(maxAmount)}.`);
        return;
    }
    if (!(await glassConfirm(`Refund ${gbp(amount)} to the guest's card via Square?`))) return;
    try {
        await apiPost('bookings.php', { action: 'refund', square_payment_id: squareId, amount });
        toast('Refund issued.');
        await loadData();
        renderCalendar();
        const fresh = findBookingById(bookingId);
        if (fresh) afterPaymentChange(bookingId);
    } catch (e) {
        glassAlert('Refund failed: ' + e.message);
    }
}

function initCalendar() {
    loadData();
    renderCalendar();
}

// Unified back office: load data once, render calendar and inbox.
async function initBackOffice() {
    await loadData();
    renderCalendar();
    renderInbox();
    try {
        refreshExpPendingBadge();
    } catch (e) {} // pending experience suggestions count
    try {
        refreshModerationCounts();
    } catch (e) {} // pending reviews/photos (badges + today card)
    try {
        loadActivityFeed();
    } catch (e) {} // recent-activity feed (fills in async)
    try {
        checkCronHealth();
    } catch (e) {} // warn if the daily automation stopped
    try {
        await loadDepositReturns();
    } catch (e) {} // for the deposits-to-return line
    try {
        renderTodayPanel();
    } catch (e) {}
    const sb = document.getElementById('booking-search');
    if (sb) {
        sb.value = '';
        bookingSearch('');
    }
    showChangeoverToasts();
    // Quietly refresh external (Airbnb/Vrbo) bookings in the background so
    // cancelled or moved dates drop off on their own. Non-blocking + throttled.
    autoSyncIcalBlocks();
}
// "Today / needs doing" — arrivals, departures, balances due this week,
// and deposits to return, all from the data already loaded for the calendar.
function renderTodayPanel() {
    const el = document.getElementById('today-panel');
    if (!el) return;
    const today = todayDashed();
    const in7 = formatDashed(
        new Date(
            dpParse(today).getFullYear(),
            dpParse(today).getMonth(),
            dpParse(today).getDate() + 7,
        ),
    );
    const arrivals = [],
        departures = [],
        dueSoon = [],
        toReturn = [];
    Object.keys(dbBookings).forEach((propKey) => {
        (dbBookings[propKey] || []).forEach((b) => {
            const name = (b.name || '').split(' ')[0];
            const tag = `<span class="prop-tag tag-${propKey}">${propertyMeta[propKey] ? propertyMeta[propKey].short : propKey}</span>`;
            if (b.checkIn === today)
                arrivals.push(`${tag} ${escapeHtml(name)} · ${b.checkInTime || '15:00'}`);
            if (b.checkOut === today)
                departures.push(`${tag} ${escapeHtml(name)} · ${b.checkOutTime || '10:00'}`);
            const ps = paymentSummary(propKey, b);
            if (!ps.fullyPaid && b.checkIn >= today && b.checkIn <= in7)
                dueSoon.push(`${tag} ${escapeHtml(name)} · ${gbp(ps.balance)} (${b.checkIn})`);
            const dh = damageHeld(propKey, b);
            if (dh.held > 0 && (b.checkOut || '') < today)
                toReturn.push(`${tag} ${escapeHtml(name)} · ${gbp(dh.held)}`);
        });
    });
    const card = (label, items, accent, target) => {
        const click = target
            ? ` clickable" role="button" tabindex="0" onclick="dashGo('${target}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();dashGo('${target}')}"`
            : '"';
        return `
                <div class="today-card${click}>
                    <div class="today-card-label">${label}</div>
                    <div class="today-card-value" style="${accent || ''}">${items.length}</div>
                    <div class="today-card-list">${
                        items.length
                            ? items
                                  .slice(0, 4)
                                  .map((i) => `<div>${i}</div>`)
                                  .join('') +
                              (items.length > 4
                                  ? `<div style="color:var(--text-muted);">+${items.length - 4} more</div>`
                                  : '')
                            : '<span style="color:var(--text-muted);">Nothing</span>'
                    }</div>
                </div>`;
    };
    // The two things that need a same-day reply lead the panel: pending
    // enquiries (already loaded by loadData) and unread guest messages
    // (fetched async below — the card updates in place when it arrives).
    const enqItems = (enquiries || []).map((e) => {
        const tag = `<span class="prop-tag tag-${e.propKey}">${propertyMeta[e.propKey] ? propertyMeta[e.propKey].short : e.propKey}</span>`;
        return `${tag} ${escapeHtml((e.name || '').split(' ')[0])} · ${e.checkIn || ''}`;
    });
    const occ = cottageMonthOccupancy();
    const occBars = osHBars(
        Object.keys(propertyMeta).map((k) => ({
            label: propertyMeta[k].name,
            value: occ[k].nights,
            max: occ[k].total,
            valLabel: occ[k].pct + '%',
            color: `var(--prop-${k})`,
        })),
    );
    // Next 7 days at a glance: every arrival/departure, with same-day
    // changeovers (out + in at the same cottage) flagged — that's the day
    // the cleaning window is tight.
    const weekDays = [];
    for (let i = 0; i < 7; i++) {
        const dObj = dpParse(today);
        dObj.setDate(dObj.getDate() + i);
        const ds = formatDashed(dObj);
        const ins = [],
            outs = [],
            flips = [];
        Object.keys(dbBookings).forEach((propKey) => {
            const tag = `<span class="prop-tag tag-${propKey}">${propertyMeta[propKey] ? propertyMeta[propKey].short : propKey}</span>`;
            let hasIn = false,
                hasOut = false;
            (dbBookings[propKey] || []).forEach((b) => {
                const nm = escapeHtml((b.name || '').split(' ')[0]);
                if (b.checkIn === ds) {
                    ins.push(`${tag} ${nm}`);
                    hasIn = true;
                }
                if (b.checkOut === ds) {
                    outs.push(`${tag} ${nm}`);
                    hasOut = true;
                }
            });
            if (hasIn && hasOut)
                flips.push(propertyMeta[propKey] ? propertyMeta[propKey].short : propKey);
        });
        weekDays.push({
            label: dObj.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' }),
            isToday: i === 0,
            ins,
            outs,
            flips,
        });
    }
    const weekStrip = `<div class="ws-row">${weekDays
        .map(
            (d) => `
                <div class="ws-day${d.isToday ? ' is-today' : ''}${d.flips.length ? ' has-flip' : ''}">
                    <div class="ws-date">${d.label}</div>
                    ${d.flips.length ? `<div class="ws-flip" title="Same-day changeover — checkout and check-in at the same cottage">⇄ ${d.flips.join(' · ')}</div>` : ''}
                    ${d.outs.map((x) => `<div class="ws-item ws-out">← ${x}</div>`).join('')}
                    ${d.ins.map((x) => `<div class="ws-item ws-in">→ ${x}</div>`).join('')}
                    ${!d.ins.length && !d.outs.length ? '<div class="ws-none">—</div>' : ''}
                </div>`,
        )
        .join('')}</div>`;
    el.innerHTML = `<h2 style="font-family:var(--font-serif);font-size:1.3rem;font-weight:400;margin:0 0 12px;">Today &amp; this week</h2>
                <div class="today-grid">
                ${card('Enquiries to answer', enqItems, enqItems.length ? 'color:#FFA726;' : '', 'enquiries')}
                <div class="today-card clickable" id="today-msgs-card" role="button" tabindex="0" onclick="dashGo('messages')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();dashGo('messages')}">
                    <div class="today-card-label">Unread messages</div>
                    <div class="today-card-value" id="today-msgs-value">–</div>
                    <div class="today-card-list" id="today-msgs-list"><span style="color:var(--text-muted);">Checking…</span></div>
                </div>
                ${card('Arrivals today', arrivals, '', 'calendar')}
                ${card('Departures today', departures, '', 'calendar')}
                ${card('Balances due (7 days)', dueSoon, dueSoon.length ? 'color:#FFA726;' : '', 'money')}
                ${card('Deposits to return', toReturn, toReturn.length ? 'color:#FFA726;' : '', 'money')}
                <div class="today-card today-approve" id="today-approve-card" style="display:none;" role="button" tabindex="0" onclick="dashGo(this.dataset.go || 'enquiries')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();dashGo(this.dataset.go || 'enquiries')}">
                    <div class="today-card-label">Waiting for approval</div>
                    <div class="today-card-value" id="today-approve-value">–</div>
                    <div class="today-card-list" id="today-approve-list"></div>
                </div>
                <div class="today-card week-strip" style="grid-column:1/-1;">
                    <div class="today-card-label">Next 7 days</div>
                    ${weekStrip}
                </div>
                <div class="today-card occ-by-cottage" style="grid-column:1/-1;">
                    <div class="today-card-label">Occupancy this month · by cottage</div>
                    <div class="occ-bars" style="margin-top:12px;">${occBars}</div>
                </div>
            </div>`;
    // A live one-line summary under the Dashboard title.
    const sub = document.getElementById('bo-subtitle');
    if (sub) {
        const t = dpParse(today);
        const pretty = t.toLocaleDateString('en-GB', {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
        });
        const bits = [];
        if (arrivals.length)
            bits.push(`${arrivals.length} arrival${arrivals.length === 1 ? '' : 's'}`);
        if (departures.length)
            bits.push(`${departures.length} departure${departures.length === 1 ? '' : 's'}`);
        if (enqItems.length)
            bits.push(`${enqItems.length} enquir${enqItems.length === 1 ? 'y' : 'ies'} waiting`);
        sub.textContent =
            pretty + ' — ' + (bits.length ? bits.join(', ') + '.' : 'nothing urgent today.');
    }
    refreshTodayMessages();
}
// Fill the "Unread messages" today-card once the thread list arrives
// (best-effort; the card just shows 0 if messages can't load).
async function refreshTodayMessages() {
    const val = document.getElementById('today-msgs-value');
    const list = document.getElementById('today-msgs-list');
    if (!val || !list) return;
    let threads = [];
    try {
        const r = await apiPost('messages.php', { action: 'threads', archived: 0 });
        threads = r.threads || [];
    } catch (e) {
        val.textContent = '0';
        list.innerHTML = '<span style="color:var(--text-muted);">Nothing</span>';
        return;
    }
    const unreadThreads = threads.filter((t) => (t.unread || 0) > 0);
    const unread = unreadThreads.reduce((s, t) => s + (t.unread || 0), 0);
    val.textContent = unread;
    val.style.color = unread ? '#FFA726' : '';
    list.innerHTML = unreadThreads.length
        ? unreadThreads
              .slice(0, 4)
              .map((t) => `<div>${escapeHtml(t.name || t.email || 'Visitor')} · ${t.unread}</div>`)
              .join('') +
          (unreadThreads.length > 4
              ? `<div style="color:var(--text-muted);">+${unreadThreads.length - 4} more</div>`
              : '')
        : '<span style="color:var(--text-muted);">Nothing</span>';
}
// Quick find: filter bookings by guest name/email; click a result to open it.
function bookingSearch(q) {
    const out = document.getElementById('booking-search-results');
    if (!out) return;
    q = (q || '').trim().toLowerCase();
    if (q.length < 2) {
        out.innerHTML = '';
        return;
    }
    const today = todayDashed();
    const hits = [];
    Object.keys(dbBookings).forEach((propKey) => {
        (dbBookings[propKey] || []).forEach((b) => {
            let ref = '';
            try {
                ref = bookingRef(b.id).toLowerCase();
            } catch (e) {}
            if (
                (b.name || '').toLowerCase().includes(q) ||
                (b.email || '').toLowerCase().includes(q) ||
                ref.includes(q) ||
                ref.replace('chb-', '').replace(/^0+/, '').includes(q)
            )
                hits.push({ propKey, b });
        });
    });
    // Upcoming stays first (soonest first), then past stays (most recent first).
    hits.sort((a, b) => {
        const au = a.b.checkOut >= today,
            bu = b.b.checkOut >= today;
        if (au !== bu) return au ? -1 : 1;
        return au
            ? (a.b.checkIn || '').localeCompare(b.b.checkIn || '')
            : (b.b.checkIn || '').localeCompare(a.b.checkIn || '');
    });
    // Open enquiries too — the guest the owner is looking for may not be a booking yet.
    const enqHits = (enquiries || [])
        .filter(
            (e) =>
                (e.name || '').toLowerCase().includes(q) ||
                (e.email || '').toLowerCase().includes(q),
        )
        .slice(0, 4);
    if (!hits.length && !enqHits.length) {
        out.innerHTML = `<div class="bo-search-empty">Nothing matches “${escapeHtml(q)}” — bookings and open enquiries are searched.</div>`;
        return;
    }
    out.innerHTML =
        hits
            .slice(0, 10)
            .map(
                ({ propKey, b }) =>
                    `<button class="bo-search-hit" onclick="showDetails('${propKey}', findBookingById('${b.id}'))">
                    <span class="prop-tag tag-${propKey}">${propertyMeta[propKey] ? propertyMeta[propKey].short : propKey}</span>
                    <span>${escapeHtml(b.name)}</span>
                    <span style="color:var(--text-muted);font-size:0.8rem;">${b.checkIn} → ${b.checkOut}${b.checkOut < today ? ' · past' : ''}</span>
                    <span style="margin-left:auto;color:var(--text-muted);font-size:0.74rem;">${bookingRef(b.id)}</span>
                </button>`,
            )
            .join('') +
        enqHits
            .map(
                (e) =>
                    `<button class="bo-search-hit" onclick="dashGo('enquiries')">
                    <span class="prop-tag" style="background:rgba(255,167,38,0.18);color:var(--warn-text);">Enquiry</span>
                    <span>${escapeHtml(e.name || e.email || 'Visitor')}</span>
                    <span style="color:var(--text-muted);font-size:0.8rem;">${e.checkIn || ''}${e.checkIn ? ' → ' + (e.checkOut || '') : ''}</span>
                </button>`,
            )
            .join('');
}
// Owner block: hold dates for maintenance / personal use (no fake booking).
async function openBlockDates() {
    const names = Object.keys(propertyMeta)
        .map((k) => `${k} = ${propertyMeta[k].name}`)
        .join(', ');
    const prop = await glassPrompt(`Which cottage to block? Enter its key (${names}):`, '21a');
    if (prop === null) return;
    const key = (prop || '').trim();
    if (!propertyMeta[key]) {
        glassAlert('Unknown cottage key. Use one of: ' + Object.keys(propertyMeta).join(', '));
        return;
    }
    const from = await glassPrompt('Block FROM date (YYYY-MM-DD):', todayDashed());
    if (from === null) return;
    const to = await glassPrompt('Block TO date (YYYY-MM-DD, the morning it frees up):', '');
    if (to === null) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from.trim()) || !/^\d{4}-\d{2}-\d{2}$/.test(to.trim())) {
        glassAlert('Please enter valid dates (YYYY-MM-DD).');
        return;
    }
    try {
        await apiPost('ical-import.php', {
            action: 'add_block',
            prop: key,
            check_in: from.trim(),
            check_out: to.trim(),
        });
        toast('Dates blocked.');
        await initBackOffice();
    } catch (e) {
        glassAlert("Couldn't block those dates: " + e.message);
    }
}

// Pull the latest external calendars and refresh the blocks shown here.
// The server-side sync deletes each feed's old blocks and re-imports only
// what's currently in the feed, so cancellations and moved dates are removed.
// Throttled to once every 10 minutes (per browser) unless forced, and it
// never blocks the UI — if a feed is slow or down we keep showing what we have.
let icalSyncing = false;
const ICAL_LAST_SYNC_KEY = 'nn-ical-last-sync';
async function autoSyncIcalBlocks(force = false) {
    if (icalSyncing || !isAuthenticated) return;
    const TEN_MIN = 10 * 60 * 1000;
    try {
        const last = parseInt(localStorage.getItem(ICAL_LAST_SYNC_KEY) || '0', 10);
        if (!force && Date.now() - last < TEN_MIN) return;
    } catch (e) {}
    icalSyncing = true;
    const btn = document.getElementById('cal-refresh-btn');
    if (btn) btn.classList.add('syncing');
    renderCalUpdated();
    try {
        await apiPost('ical-import.php', { action: 'sync' });
        try {
            localStorage.setItem(ICAL_LAST_SYNC_KEY, String(Date.now()));
        } catch (e) {}
        await loadData();
        renderCalendar();
    } catch (e) {
        // Non-fatal: a feed being unreachable shouldn't disturb the back office.
    } finally {
        icalSyncing = false;
        if (btn) btn.classList.remove('syncing');
        renderCalUpdated();
    }
}

// Human-friendly "x minutes ago" / date for the calendar's last-updated line.
function formatRelativeTime(ts) {
    const diff = Date.now() - ts;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + (mins === 1 ? ' minute ago' : ' minutes ago');
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return hrs + (hrs === 1 ? ' hour ago' : ' hours ago');
    const d = new Date(ts);
    return (
        'on ' +
        d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) +
        ' at ' +
        d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
    );
}
// Show when the external (Airbnb/Vrbo) calendars were last refreshed.
function renderCalUpdated() {
    const el = document.getElementById('cal-updated-text');
    if (!el) return;
    if (icalSyncing) {
        el.textContent = 'External calendars: updating…';
        return;
    }
    let last = 0;
    try {
        last = parseInt(localStorage.getItem(ICAL_LAST_SYNC_KEY) || '0', 10);
    } catch (e) {}
    el.textContent = last
        ? 'External calendars last updated ' + formatRelativeTime(last)
        : 'External calendars: not synced yet';
}

// --- Same-day changeover notifications (planning aid) ---
const CHANGEOVER_DISMISSED_KEY = 'nn-changeover-dismissed';

function loadDismissedChangeovers() {
    try {
        const saved = JSON.parse(localStorage.getItem(CHANGEOVER_DISMISSED_KEY));
        return Array.isArray(saved) ? saved : [];
    } catch (e) {
        return [];
    }
}
function saveDismissedChangeovers(list) {
    try {
        localStorage.setItem(CHANGEOVER_DISMISSED_KEY, JSON.stringify(list));
    } catch (e) {}
}

// Find every same-day changeover (a checkout meeting a check-in at the same
// property on the same date), today and into the future, for planning ahead.
function findChangeovers() {
    const todayStr = todayDashed();
    const out = [];
    Object.keys(dbBookings).forEach((propKey) => {
        const list = dbBookings[propKey] || [];
        list.forEach((leaving) => {
            list.forEach((arriving) => {
                if (leaving.id === arriving.id) return;
                if (
                    leaving.checkOut &&
                    leaving.checkOut === arriving.checkIn &&
                    leaving.checkOut >= todayStr
                ) {
                    out.push({
                        key: `${propKey}|${leaving.checkOut}|${leaving.id}|${arriving.id}`,
                        propKey,
                        date: leaving.checkOut,
                        leaving,
                        arriving,
                    });
                }
            });
        });
    });
    // Soonest first
    out.sort((a, b) => a.date.localeCompare(b.date));
    return out;
}

function showChangeoverToasts() {
    const wrap = document.getElementById('changeover-toasts');
    if (!wrap) return;
    wrap.innerHTML = '';
    const dismissed = loadDismissedChangeovers();
    const items = findChangeovers().filter((c) => !dismissed.includes(c.key));
    items.forEach((c) => {
        const meta = propertyMeta[c.propKey];
        const el = document.createElement('div');
        el.className = 'toast';
        el.id = 'toast-' + btoa(c.key).replace(/=/g, '');
        el.innerHTML = `
                    <div class="toast-head">
                        <span class="toast-title"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4l9 16H3z"/><path d="M12 10v4"/><circle cx="12" cy="17.4" r="0.6" fill="currentColor" stroke="none"/></svg> Same-day changeover</span>
                        <button class="toast-close" title="Dismiss" aria-label="Dismiss">&times;</button>
                    </div>
                    <div class="toast-body">
                        <span class="toast-prop"><span class="legend-swatch swatch-${c.propKey}"></span> ${escapeHtml(meta.name)}</span><br>
                        <strong>${escapeHtml(c.leaving.name || 'Guest')}</strong> checks out (by ${c.leaving.checkOutTime || '10:00'}) and
                        <strong>${escapeHtml(c.arriving.name || 'Guest')}</strong> checks in (from ${c.arriving.checkInTime || '15:00'}).
                        <div class="toast-date">${c.date}</div>
                    </div>
                    <button class="btn-sm btn-edit toast-dismiss">Got it — dismiss</button>`;
        const dismiss = () => dismissChangeover(c.key, el);
        el.querySelector('.toast-close').addEventListener('click', dismiss);
        el.querySelector('.toast-dismiss').addEventListener('click', dismiss);
        wrap.appendChild(el);
    });
}

function dismissChangeover(key, el) {
    const dismissed = loadDismissedChangeovers();
    if (!dismissed.includes(key)) {
        dismissed.push(key);
        saveDismissedChangeovers(dismissed);
    }
    if (el) {
        el.classList.add('toast-out');
        setTimeout(() => el.remove(), 350);
    }
}

// Clear toasts when leaving the back office
function clearChangeoverToasts() {
    const wrap = document.getElementById('changeover-toasts');
    if (wrap) wrap.innerHTML = '';
}

// ===================================================================
//  MESSAGING (owner ↔ guest)
// ===================================================================
function fmtMsgTime(at) {
    try {
        const d = new Date(String(at).replace(' ', 'T'));
        if (isNaN(d)) return '';
        return d.toLocaleString('en-GB', {
            day: 'numeric',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit',
        });
    } catch (e) {
        return '';
    }
}
function chatBubbles(msgs, meRole) {
    if (!msgs.length) return `<p class="chat-empty">No messages yet.</p>`;
    // Read receipt (owner side only): mark the owner's LATEST reply Read once the
    // guest has opened the thread since it was sent, so the owner can see whether
    // the customer has seen it. `seen` is read_by_guest from messages.php.
    let lastAdminIdx = -1;
    if (meRole === 'admin') {
        for (let i = msgs.length - 1; i >= 0; i--) {
            if (msgs[i].role === 'admin') {
                lastAdminIdx = i;
                break;
            }
        }
    }
    return msgs
        .map((m, i) => {
            const who =
                m.role === 'guest'
                    ? meRole === 'guest'
                        ? 'You'
                        : 'Guest'
                    : meRole === 'admin'
                      ? 'You'
                      : 'Host';
            const receipt =
                i === lastAdminIdx
                    ? ` · <span class="chat-receipt${m.seen ? ' seen' : ''}">${m.seen ? '✓✓ Read' : '✓ Sent'}</span>`
                    : '';
            return `<div class="chat-msg ${m.role === meRole ? 'me' : 'them'}">${escapeHtml(m.body)}<div class="chat-meta">${who} · ${fmtMsgTime(m.at)}${receipt}</div></div>`;
        })
        .join('');
}
// Empty-thread greeting, styled as a received message so the chat opens
// looking like a conversation rather than a blank pane (class chat-empty
// so chatClearEmpty() removes it when the first real bubble arrives).
function chatHelloHtml() {
    return `<div class="chat-hello chat-empty">
                <div class="chat-hello-ava" aria-hidden="true"><img src="logo.svg" alt=""></div>
                <div>
                    <div class="chat-msg them">Hi! 👋 Ask us anything — about a cottage, your dates, or your stay.</div>
                    <div class="chat-hello-note">We usually reply within a few hours, by chat and email.</div>
                </div>
            </div>`;
}

// ---- Floating chat widget (everyone: logged-in guests + anonymous visitors) ----
function chatGetToken() {
    try {
        return localStorage.getItem('chb-chat-token') || '';
    } catch (e) {
        return '';
    }
}
function chatNewToken() {
    let t = '';
    const a = new Uint8Array(16);
    (window.crypto || {}).getRandomValues
        ? crypto.getRandomValues(a)
        : a.forEach((_, i) => (a[i] = Math.floor(Math.random() * 256)));
    t = Array.from(a)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    try {
        localStorage.setItem('chb-chat-token', t);
    } catch (e) {}
    return t;
}
function toggleChat() {
    const w = document.getElementById('chat-widget');
    if (!w) return;
    if (w.classList.contains('open')) {
        closeChat();
        return;
    }
    w.classList.add('open');
    document.getElementById('chat-fab').classList.add('hidden');
    try {
        if (window.setGuestDockOverlay) window.setGuestDockOverlay('messages');
    } catch (e) {}
    loadChat();
    chatStartPolling(); // keep the thread live while it's open
}
function closeChat() {
    const w = document.getElementById('chat-widget');
    if (w) w.classList.remove('open');
    const f = document.getElementById('chat-fab');
    if (f) f.classList.remove('hidden');
    try {
        if (window.setGuestDockOverlay) window.setGuestDockOverlay(null);
    } catch (e) {}
    chatStopPolling();
}
// Signature of the server-side thread, so background polling can tell when
// something actually changed (a new host reply) before touching the DOM.
let __chatSig = '';
function chatMsgSig(msgs) {
    if (!msgs || !msgs.length) return '0';
    const last = msgs[msgs.length - 1];
    return (
        msgs.length +
        ':' +
        (last.at || '') +
        ':' +
        (last.role || '') +
        ':' +
        (last.body || '').length
    );
}
async function loadChat() {
    const thread = document.getElementById('chat-thread');
    const intro = document.getElementById('chat-intro');
    if (!thread) return;
    const loggedIn = !!currentGuest;
    const token = chatGetToken();
    // Anonymous with no prior chat → show the name/email intro.
    if (intro) intro.style.display = !loggedIn && !token ? 'block' : 'none';
    thread.innerHTML = `<p class="chat-empty">Loading…</p>`;
    try {
        const payload = loggedIn ? { action: 'thread' } : { action: 'thread', token };
        const r = await apiPost('messages.php', payload);
        const msgs = r.messages || [];
        __chatSig = chatMsgSig(msgs);
        thread.innerHTML = msgs.length ? chatBubbles(msgs, 'guest') : chatHelloHtml();
        thread.scrollTop = thread.scrollHeight;
    } catch (e) {
        // Don't alarm the visitor — show the greeting and let them type.
        thread.innerHTML = chatHelloHtml();
    }
}
// ---- Background refresh: while the chat is open, quietly poll for new
//  messages so a host reply appears without the guest reloading. We only
//  re-render when the thread actually changed (preserving any instant
//  FAQ/availability bubbles otherwise), and pause while the tab is hidden. ----
let __chatPollTimer = null;
function chatStartPolling() {
    chatStopPolling();
    __chatPollTimer = setInterval(chatPoll, 8000); // ping for a host reply every ~8s while open
}
function chatStopPolling() {
    if (__chatPollTimer) {
        clearInterval(__chatPollTimer);
        __chatPollTimer = null;
    }
}
async function chatPoll() {
    const w = document.getElementById('chat-widget');
    if (!w || !w.classList.contains('open')) {
        chatStopPolling();
        return;
    }
    if (document.hidden) return; // don't poll a backgrounded tab
    const loggedIn = !!currentGuest;
    const token = chatGetToken();
    if (!loggedIn && !token) return; // anon visitor hasn't started a thread yet
    try {
        const payload = loggedIn ? { action: 'thread' } : { action: 'thread', token };
        const r = await apiPost('messages.php', payload);
        const msgs = r.messages || [];
        const sig = chatMsgSig(msgs);
        if (sig === __chatSig) return; // nothing new — leave the DOM (and any bot bubbles) alone
        __chatSig = sig;
        const thread = document.getElementById('chat-thread');
        if (thread && msgs.length) {
            const nearBottom = thread.scrollHeight - thread.scrollTop - thread.clientHeight < 60;
            thread.innerHTML = chatBubbles(msgs, 'guest');
            if (nearBottom) thread.scrollTop = thread.scrollHeight; // only autoscroll if they were at the bottom
        }
    } catch (e) {
        /* transient — try again next tick */
    }
}
// Returning to the tab with the chat open → refresh straight away.
document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    const w = document.getElementById('chat-widget');
    if (w && w.classList.contains('open')) chatPoll();
});
// Guest quick-reply chips: common questions send immediately; "Report an
// issue" prefills a prefix and lets the guest describe it.
function chatQuick(text) {
    const input = document.getElementById('chat-input');
    if (!input) return;
    if (text === '__issue') {
        input.value = '🛠 Issue: ';
        input.focus();
        return;
    }
    input.value = text;
    sendChat();
}

// ---- In-chat assistant: instant FAQ answers + a live availability check.
//  Pure client-side (no owner ping) so common questions self-serve; the guest
//  can still type below for a real reply. Answers are owner-editable in
//  Settings → Guest messages (content keys below), with sensible defaults.
const CHAT_FAQ = {
    checkin: {
        q: 'What time is check-in and check-out?',
        key: 'chat-ans-checkin',
        def: "Check-in is from 3pm and check-out is by 10am. If you need a little flexibility, just ask — we'll always try to help around our changeover.",
    },
    parking: {
        q: 'Is there parking at the cottage?',
        key: 'chat-ans-parking',
        def: "Parking details are in your arrival information, and Blakeney has a large pay-and-display car park down by the quay. Tell us which cottage and we'll give you the specifics.",
    },
    wifi: {
        q: 'What is the Wi-Fi like?',
        key: 'chat-ans-wifi',
        def: "There's free Wi-Fi throughout the cottage — fine for browsing, email and streaming.",
    },
};
const CHAT_FAQ_ORDER = ['checkin', 'parking', 'wifi'];
function chatThreadEl() {
    return document.getElementById('chat-thread');
}
function chatScroll() {
    const t = chatThreadEl();
    if (t) t.scrollTop = t.scrollHeight;
}
function chatClearEmpty() {
    const t = chatThreadEl();
    const e = t && t.querySelector('.chat-empty');
    if (e) e.remove();
}
function chatAppendMe(text) {
    const t = chatThreadEl();
    if (!t) return;
    const d = document.createElement('div');
    d.className = 'chat-msg me';
    d.textContent = text;
    t.appendChild(d);
    chatScroll();
}
function chatBot(html) {
    const t = chatThreadEl();
    if (!t) return null;
    const d = document.createElement('div');
    d.className = 'chat-bot';
    d.innerHTML = html + '<div class="cb-meta">Quick answer — type below to reach a person.</div>';
    t.appendChild(d);
    chatScroll();
    return d;
}
function chatFaq(which) {
    const f = CHAT_FAQ[which];
    if (!f) return;
    chatClearEmpty();
    chatAppendMe(f.q);
    const ans = ((siteContent && siteContent[f.key]) || '').trim() || f.def;
    chatBot(escapeHtml(ans).replace(/\n/g, '<br>'));
}
// Live availability check, in the chat thread.
let __chatAvailUid = 0;
function chatAvailStart() {
    chatClearEmpty();
    chatAppendMe('Check availability');
    const uid = 'cav' + ++__chatAvailUid;
    const opts = Object.keys(propertyMeta)
        .map(
            (k) =>
                `<option value="${k}"${k === activeFrontProperty ? ' selected' : ''}>${escapeHtml(propertyMeta[k].name)}</option>`,
        )
        .join('');
    const today = todayDashed();
    chatBot(
        "Pick a cottage and your dates — I'll check the live calendar right now." +
            `<select id="${uid}-prop" class="input-glass field-sm">${opts}</select>` +
            `<div style="display:flex;gap:8px;"><input type="date" id="${uid}-ci" class="input-glass field-sm" min="${today}" aria-label="Check-in"><input type="date" id="${uid}-co" class="input-glass field-sm" min="${today}" aria-label="Check-out"></div>` +
            `<div class="chat-bot-actions"><button type="button" class="btn-glass" onclick="chatAvailRun('${uid}')">Check dates</button></div>`,
    );
}
async function chatAvailRun(uid) {
    const prop = (document.getElementById(uid + '-prop') || {}).value;
    const ci = (document.getElementById(uid + '-ci') || {}).value;
    const co = (document.getElementById(uid + '-co') || {}).value;
    if (!prop || !ci || !co) {
        chatBot('Please choose a cottage and both dates.');
        return;
    }
    if (co <= ci) {
        chatBot('Your check-out date needs to be after your check-in date.');
        return;
    }
    try {
        await loadAvailability(prop);
    } catch (e) {}
    const ranges = propertyAvailability[prop] || [];
    const clash = ranges.some((r) => r.start < co && r.end > ci); // end is checkout-exclusive
    const name = (propertyMeta[prop] || {}).name || prop;
    const nm = nightsBetween(ci, co);
    const span = `${dpPretty(ci)} → ${dpPretty(co)}`;
    if (clash) {
        chatBot(
            `Sorry — ${escapeHtml(name)} isn't free for ${span}; those dates overlap an existing booking. Try different dates, or I can let you know if they free up.` +
                `<div class="chat-bot-actions"><button type="button" class="btn-glass" onclick="chatAvailNotify('${prop}','${ci}','${co}')">Notify me</button></div>`,
        );
    } else {
        chatBot(
            `Good news — ${escapeHtml(name)} looks free for ${span} (${nm} night${nm === 1 ? '' : 's'}). Shall I start your enquiry? No payment is taken now.` +
                `<div class="chat-bot-actions"><button type="button" class="btn-glass" onclick="chatAvailEnquire('${prop}','${ci}','${co}')">Enquire now</button></div>`,
        );
    }
}
function chatAvailEnquire(prop, ci, co) {
    closeChat();
    try {
        openProperty(prop);
    } catch (e) {}
    const set = (id, v) => {
        const el = document.getElementById(id);
        if (el) el.value = v;
    };
    set('enq-checkin', ci);
    set('enq-checkout', co);
    try {
        openEnquireModal();
    } catch (e) {}
}
function chatAvailNotify(prop, ci, co) {
    closeChat();
    try {
        openWaitlistModal({ prop, checkIn: ci, checkOut: co });
    } catch (e) {}
}
// Admin canned reply: drop a pre-written line into the reply box to edit/send.
function adminCanned(text) {
    if (!text) return;
    const t = document.getElementById('messages-modal-input');
    if (t) {
        t.value = text;
        t.focus();
    }
    const s = document.getElementById('msg-canned');
    if (s) s.value = '';
}
async function sendChat() {
    const input = document.getElementById('chat-input');
    const body = ((input && input.value) || '').trim();
    if (!body) return;
    const loggedIn = !!currentGuest;
    let payload;
    if (loggedIn) {
        payload = { action: 'send', body };
    } else {
        let token = chatGetToken();
        const nameEl = document.getElementById('chat-name'),
            emailEl = document.getElementById('chat-email');
        const email = ((emailEl && emailEl.value) || '').trim();
        if (!token) {
            // first message from an anonymous visitor
            if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
                glassAlert('Please enter a valid email so we can reply.');
                return;
            }
            token = chatNewToken();
        }
        payload = {
            action: 'send',
            token,
            body,
            name: ((nameEl && nameEl.value) || '').trim(),
            email,
            ref: document.referrer || '',
        };
    }
    try {
        const r = await apiPost('messages.php', payload);
        if (r && r.token) {
            try {
                localStorage.setItem('chb-chat-token', r.token);
            } catch (e) {}
        }
        if (input) input.value = '';
        const intro = document.getElementById('chat-intro');
        if (intro) intro.style.display = 'none';
        await loadChat();
    } catch (e) {
        glassAlert("Couldn't send: " + e.message);
    }
}

// ===================================================================
//  WAITLIST / "notify me" (guest)
// ===================================================================
function openWaitlistModal(prefill) {
    prefill = prefill || {};
    const sel = document.getElementById('wl-prop');
    if (sel) {
        sel.innerHTML = Object.keys(propertyMeta)
            .map((k) => `<option value="${k}">${escapeHtml(propertyMeta[k].name)}</option>`)
            .join('');
        if (prefill.prop && propertyMeta[prefill.prop]) sel.value = prefill.prop;
    }
    const set = (id, v) => {
        const e = document.getElementById(id);
        if (e) e.value = v || '';
    };
    set('wl-checkin', prefill.checkIn);
    set('wl-checkout', prefill.checkOut);
    set('wl-name', currentGuest ? currentGuest.name : '');
    set('wl-email', currentGuest ? currentGuest.email : '');
    const msg = document.getElementById('wl-msg');
    if (msg) {
        msg.textContent = '';
        msg.classList.remove('show');
    }
    document.getElementById('waitlist-modal').classList.add('open');
}
function closeWaitlistModal() {
    const m = document.getElementById('waitlist-modal');
    if (m) m.classList.remove('open');
}
async function submitWaitlist() {
    const v = (id) => (document.getElementById(id) || {}).value;
    const msg = document.getElementById('wl-msg');
    const show = (t) => {
        if (msg) {
            msg.textContent = t;
            msg.classList.add('show');
        }
    };
    const email = (v('wl-email') || '').trim();
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        show('Please enter a valid email address.');
        return;
    }
    try {
        await apiPost('waitlist.php', {
            action: 'join',
            prop: v('wl-prop'),
            name: v('wl-name'),
            email,
            check_in: v('wl-checkin'),
            check_out: v('wl-checkout'),
        });
        closeWaitlistModal();
        toast("You're on the waitlist — we'll email you if those dates free up.");
    } catch (e) {
        show(e.message || 'Could not join the waitlist.');
    }
}

// ---- Newsletter opt-in (footer) ----
async function submitNewsletter(ev) {
    if (ev) ev.preventDefault();
    const el = document.getElementById('nl-email');
    const msg = document.getElementById('nl-msg');
    const email = ((el && el.value) || '').trim();
    const show = (t, ok) => {
        if (msg) {
            msg.style.color = ok ? '#4CAF50' : '#E57373';
            msg.textContent = t;
        }
    };
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        show('Please enter a valid email address.', false);
        return;
    }
    try {
        await apiPost('newsletter.php', {
            action: 'subscribe',
            email,
            name: (currentGuest && currentGuest.name) || '',
            source: 'footer',
        });
        if (el) el.value = '';
        show("You're in — thank you! We'll only email occasionally.", true);
    } catch (e) {
        show(e.message || 'Could not sign you up just now.', false);
    }
}
// One-click unsubscribe from a broadcast (?unsub=TOKEN in the email link).
async function maybeHandleUnsubscribe() {
    const usp = new URLSearchParams(window.location.search);
    const token = usp.get('unsub');
    if (!token) return;
    try {
        await apiPost('newsletter.php', { action: 'unsubscribe', token });
    } catch (e) {}
    try {
        toast("You've been unsubscribed — sorry to see you go.");
    } catch (e) {}
    // Tidy the URL so a refresh doesn't repeat it.
    try {
        history.replaceState(null, '', window.location.pathname);
    } catch (e) {}
}

// ---- Admin side: Guest messages (Settings → Guest messages) + reply modal ----
let __msgShowArchived = false;
async function loadAdminMessages() {
    // Zero-setup reply-by-email: opportunistically pull any emailed replies
    // into their threads. Fire-and-forget so the inbox never waits on it;
    // the server throttles to avoid hammering the mailbox.
    try {
        apiPost('mailbox-read.php', {}).catch(() => {});
    } catch (e) {}
    const list = document.getElementById('messages-list');
    const badge = document.getElementById('messages-badge');
    let threads = [];
    try {
        const r = await apiPost('messages.php', {
            action: 'threads',
            archived: __msgShowArchived ? 1 : 0,
        });
        threads = r.threads || [];
    } catch (e) {
        if (list)
            list.innerHTML = `<p style="font-size:0.82rem;color:var(--text-muted);">Couldn't load messages.</p>`;
        return;
    }
    // The settings badge only ever reflects unread in the active inbox.
    if (!__msgShowArchived && badge) {
        const unread = threads.reduce((s, t) => s + (t.unread || 0), 0);
        badge.textContent = unread;
        badge.classList.toggle('zero', unread === 0);
    }
    if (!list) return;
    const toggle = `<button class="btn-sm btn-edit" style="margin-bottom:10px;" onclick="toggleArchivedMessages()">${__msgShowArchived ? '← Active conversations' : 'Show archived'}</button>`;
    const rows = threads.length
        ? threads
              .map(
                  (t) => `
                <button class="msg-thread-row" onclick="openMessageThread(${t.thread_id})">
                    <span class="mtr-main"><span class="mtr-name">${escapeHtml(t.name || t.email || 'Visitor')}${t.is_guest ? '' : ' <span style="font-size:0.66rem;color:var(--text-muted);">· visitor</span>'}${t.unread ? ` <span class="inbox-badge" style="min-width:18px;height:18px;font-size:0.66rem;">${t.unread}</span>` : ''}</span><span class="mtr-last">${escapeHtml(t.last_body || '')}</span></span>
                    <span class="settings-row-chev" aria-hidden="true">›</span>
                </button>`,
              )
              .join('')
        : `<p style="font-size:0.82rem;color:var(--text-muted);">${__msgShowArchived ? 'No archived conversations.' : 'No messages yet.'}</p>`;
    list.innerHTML = toggle + rows;
    renderChatAnswersEditor();
}
// Owner-editable instant answers for the chat quick chips.
function renderChatAnswersEditor() {
    const host = document.getElementById('chat-answers-editor');
    if (!host) return;
    host.innerHTML =
        '<h3 style="font-family:var(--font-serif);font-size:1.1rem;margin:0 0 4px;">Instant chat answers</h3>' +
        '<p style="font-size:0.8rem;color:var(--text-muted);margin:0 0 14px;">Shown the moment a guest taps a quick-question chip in the website chat, so common questions answer themselves. Leave blank to use the default.</p>' +
        CHAT_FAQ_ORDER.map((which) => {
            const f = CHAT_FAQ[which];
            const val =
                siteContent[f.key] != null && siteContent[f.key] !== '' ? siteContent[f.key] : '';
            return (
                `<div style="margin-bottom:14px;"><label style="font-size:0.78rem;color:var(--text-muted);display:block;margin-bottom:6px;">${escapeHtml(f.q)}</label>` +
                `<textarea rows="3" style="width:100%;background:rgba(0,0,0,0.25);border:1px solid var(--glass-border);color:var(--text-light);padding:9px 12px;border-radius:10px;font-family:var(--font-sans);resize:vertical;" placeholder="${escapeHtml(f.def)}" onchange="saveContent('${f.key}', this.value)">${escapeHtml(val)}</textarea></div>`
            );
        }).join('');
}
function toggleArchivedMessages() {
    __msgShowArchived = !__msgShowArchived;
    loadAdminMessages();
}
let __msgThreadId = null;
let __msgThreadArchived = false;
function bookingLine(b) {
    const name = (propertyMeta[b.prop_key] || {}).name || b.prop_key;
    return `${escapeHtml(name)} · ${b.check_in} → ${b.check_out}${b.payment ? ' · ' + escapeHtml(b.payment) : ''}`;
}
async function openMessageThread(threadId) {
    __msgThreadId = threadId;
    const modal = document.getElementById('messages-modal');
    const title = document.getElementById('messages-modal-title');
    const ctx = document.getElementById('messages-modal-ctx');
    const thread = document.getElementById('messages-modal-thread');
    if (thread) thread.innerHTML = `<p class="chat-empty">Loading…</p>`;
    if (ctx) ctx.innerHTML = '';
    if (modal) modal.classList.add('open');
    try {
        const r = await apiPost('messages.php', { action: 'thread', thread_id: threadId });
        const t = r.thread || {};
        __msgThreadArchived = !!t.archived;
        const archBtn = document.getElementById('msg-archive-btn');
        if (archBtn) archBtn.textContent = __msgThreadArchived ? 'Unarchive' : 'Archive';
        if (title) title.textContent = t.name ? t.name : t.email || 'Message';
        if (ctx) {
            const bk = (r.bookings || []).length
                ? `<div class="mc-row"><span class="mc-k">Bookings</span><span class="mc-v">${r.bookings.map(bookingLine).join('<br>')}</span></div>`
                : `<div class="mc-row"><span class="mc-k">Bookings</span><span class="mc-v">None on file</span></div>`;
            ctx.innerHTML = `
                        ${t.email ? `<div class="mc-row"><span class="mc-k">Email</span><span class="mc-v">${escapeHtml(t.email)}</span></div>` : ''}
                        <div class="mc-row"><span class="mc-k">Came from</span><span class="mc-v">${escapeHtml(t.source || '—')}</span></div>
                        <div class="mc-row"><span class="mc-k">Location</span><span class="mc-v">${escapeHtml(t.location || 'Unknown')}</span></div>
                        <div class="mc-row"><span class="mc-k">Account</span><span class="mc-v">${t.is_guest ? 'Registered guest' : 'Website visitor'}</span></div>
                        ${bk}`;
        }
        if (thread) {
            thread.innerHTML = chatBubbles(r.messages || [], 'admin');
            thread.scrollTop = thread.scrollHeight;
        }
    } catch (e) {
        if (thread) thread.innerHTML = `<p class="chat-empty">Couldn't load this thread.</p>`;
    }
    loadAdminMessages(); // clear the unread badge now it's been read
}
function closeMessagesModal() {
    const m = document.getElementById('messages-modal');
    if (m) m.classList.remove('open');
    __msgThreadId = null;
}
// Archive / unarchive the open conversation (kept, hidden from the active inbox).
async function archiveCurrentThread() {
    if (!__msgThreadId) return;
    const archiving = !__msgThreadArchived;
    try {
        await apiPost('messages.php', {
            action: archiving ? 'archive' : 'unarchive',
            thread_id: __msgThreadId,
        });
        closeMessagesModal();
        loadAdminMessages();
        toast(archiving ? 'Conversation archived.' : 'Conversation restored.');
    } catch (e) {
        glassAlert("Couldn't update: " + e.message);
    }
}
// Permanently delete the open conversation and its messages.
async function deleteCurrentThread() {
    if (!__msgThreadId) return;
    if (!(await glassConfirm('Delete this conversation and all its messages permanently?'))) return;
    try {
        await apiPost('messages.php', { action: 'delete', thread_id: __msgThreadId });
        closeMessagesModal();
        loadAdminMessages();
        toast('Conversation deleted.');
    } catch (e) {
        glassAlert("Couldn't delete: " + e.message);
    }
}
async function adminSendMessage() {
    const input = document.getElementById('messages-modal-input');
    const body = ((input && input.value) || '').trim();
    if (!body || !__msgThreadId) return;
    try {
        const res = await queueOrPost('messages.php', {
            action: 'send',
            thread_id: __msgThreadId,
            body,
        });
        if (input) input.value = '';
        if (res && res.queued) {
            toast('Saved offline — your reply will send when you reconnect.');
            return;
        }
        const r = await apiPost('messages.php', { action: 'thread', thread_id: __msgThreadId });
        const thread = document.getElementById('messages-modal-thread');
        if (thread) {
            thread.innerHTML = chatBubbles(r.messages || [], 'admin');
            thread.scrollTop = thread.scrollHeight;
        }
        loadAdminMessages();
    } catch (e) {
        glassAlert("Couldn't send: " + e.message);
    }
}

// --- Rates & fees editor (per property) ---
// One cottage's full rate/rules/seasons/arrival/geo/FAQ editor block.
// ---- Per-cottage Preferences, split into subfolder sections ----
// A reusable add/remove list editor (a "−" per row, a "＋" to add) used by the
// Safety and House-rules subfolders. `attr` is the data-attribute marking inputs.
function listRowHtml(attr, value, placeholder) {
    return `<div class="list-edit-row" style="display:flex;gap:8px;align-items:center;margin-bottom:8px;">
                <input type="text" class="input-glass field-sm" data-${attr}="1" value="${escapeHtml(value || '')}" placeholder="${escapeHtml(placeholder || '')}" style="flex:1 1 auto;margin:0;">
                <button class="btn-sm btn-delete list-edit-del" onclick="this.closest('.list-edit-row').remove()" title="Remove" aria-label="Remove"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 12h12"/></svg></button>
            </div>`;
}
function collectListRows(wrap, attr) {
    const items = [];
    if (wrap)
        wrap.querySelectorAll(`[data-${attr}]`).forEach((el) => {
            const v = (el.value || '').replace(/\s+/g, ' ').trim();
            if (v) items.push(v);
        });
    return items;
}

// ---- Safety & property list (per cottage) ----
function accomSafetyList(k) {
    return Array.isArray(siteContent['safety-' + k])
        ? siteContent['safety-' + k].slice()
        : DEFAULT_SAFETY.slice();
}
function accomAddSafety(k) {
    const wrap = document.getElementById('accom-safety-rows-' + k);
    if (wrap) wrap.insertAdjacentHTML('beforeend', listRowHtml('sf', '', 'e.g. Smoke alarm'));
}
async function accomSaveSafety(k) {
    const items = collectListRows(document.getElementById('accom-safety-rows-' + k), 'sf');
    try {
        await saveContent('safety-' + k, items);
        siteContent['safety-' + k] = items;
        if (propertyContent[k]) propertyContent[k].safety = items.slice();
        if (activeFrontProperty === k) {
            activePropSafety = items.slice();
            renderSafety(k);
        }
        toast('Safety & property saved.');
    } catch (e) {
        glassAlert("Couldn't save: " + e.message);
    }
}

// ---- House rules list (per cottage, guest-facing bullets) ----
const DEFAULT_HOUSE_RULES = [
    'Please treat the cottage as your own home',
    'Let us know of any special requests',
];
function houseRulesList(k) {
    return Array.isArray(siteContent['houserules-' + k])
        ? siteContent['houserules-' + k].slice()
        : DEFAULT_HOUSE_RULES.slice();
}
function accomAddHouseRule(k) {
    const wrap = document.getElementById('accom-houserules-rows-' + k);
    if (wrap)
        wrap.insertAdjacentHTML('beforeend', listRowHtml('hr', '', 'e.g. No smoking indoors'));
}
async function accomSaveHouseRules(k) {
    const items = collectListRows(document.getElementById('accom-houserules-rows-' + k), 'hr');
    try {
        await saveContent('houserules-' + k, items);
        siteContent['houserules-' + k] = items;
        if (activeFrontProperty === k) renderHouseRules(k);
        toast('House rules saved.');
    } catch (e) {
        glassAlert("Couldn't save: " + e.message);
    }
}
// ---- Per-cottage guest limits (occupancy), editable from House rules ----
async function saveOccupancy(k) {
    const num = (id, min) =>
        Math.max(min, parseInt((document.getElementById(id) || {}).value, 10) || 0);
    const maxAdults = num('occ-adults-' + k, 1);
    const maxChildren = num('occ-children-' + k, 0);
    const maxTotal = Math.max(maxAdults, num('occ-total-' + k, 1));
    const occ = { maxAdults, maxChildren, maxTotal };
    occupancyLimits[k] = occ;
    try {
        await saveContent('occupancy-' + k, occ);
        siteContent['occupancy-' + k] = occ;
        if (activeFrontProperty === k) {
            try {
                renderHouseRules(k);
            } catch (e) {}
            try {
                applyOccupancyToForm(k);
            } catch (e) {}
        }
        toast('Guest limits saved.');
    } catch (e) {
        glassAlert("Couldn't save: " + e.message);
    }
}

// ---- Per-cottage section builders (one subfolder each) ----
// ---- Preferences → [cottage] → Photos & Text (form-based per-cottage editor
// that replaces the on-page gallery bar / inline text editing). All reuse the
// existing content store: images-<k>, <k>-title/subtitle/tagline/desc/location,
// amenities-<k>. ----
function accomImages(k) {
    const o = siteContent['images-' + k];
    return Array.isArray(o) && o.length
        ? o.slice()
        : ((propertyContent[k] || {}).images || []).slice();
}
function accomPhotoRow(k, url, i, n) {
    return `<div class="content-edit-row accom-photo-row">
                <div class="exp-edit-thumb" style="background-image:url('${escapeHtml(url)}');"></div>
                <div class="accom-photo-label">Photo ${i + 1}${i === 0 ? ' <span style="color:var(--accent);">· main</span>' : ''}</div>
                <div class="accom-photo-actions">
                    <button class="btn-sm btn-edit" onclick="accomMovePhoto('${k}',${i},-1)" ${i === 0 ? 'disabled' : ''} aria-label="Move up">↑</button>
                    <button class="btn-sm btn-edit" onclick="accomMovePhoto('${k}',${i},1)" ${i === n - 1 ? 'disabled' : ''} aria-label="Move down">↓</button>
                    <button class="btn-sm btn-edit" onclick="accomReplacePhoto('${k}',${i})">Replace</button>
                    <button class="btn-sm btn-delete" onclick="accomRemovePhoto('${k}',${i})">Remove</button>
                </div></div>`;
}
async function accomSavePhotos(k, imgs) {
    await savePropertyImages(k, imgs);
    siteContent['images-' + k] = imgs;
    if (propertyContent[k]) propertyContent[k].images = imgs.slice();
    const wrap = document.getElementById('accom-photos-' + k);
    if (wrap)
        wrap.innerHTML = imgs.length
            ? imgs.map((u, i) => accomPhotoRow(k, u, i, imgs.length)).join('')
            : '<p style="font-size:0.85rem;color:var(--text-muted);">No photos yet — add the first below.</p>';
}
function accomAddPhoto(k) {
    pickAndUpload('gallery-' + k, async (url) => {
        const imgs = accomImages(k);
        imgs.push(url);
        await accomSavePhotos(k, imgs);
    });
}
function accomReplacePhoto(k, i) {
    pickAndUpload('gallery-' + k, async (url) => {
        const imgs = accomImages(k);
        if (i < 0 || i >= imgs.length) return;
        imgs[i] = url;
        await accomSavePhotos(k, imgs);
    });
}
async function accomMovePhoto(k, i, dir) {
    const imgs = accomImages(k);
    const j = i + dir;
    if (j < 0 || j >= imgs.length) return;
    const t = imgs[i];
    imgs[i] = imgs[j];
    imgs[j] = t;
    await accomSavePhotos(k, imgs);
}
async function accomRemovePhoto(k, i) {
    if (!confirm('Remove this photo?')) return;
    const imgs = accomImages(k);
    imgs.splice(i, 1);
    await accomSavePhotos(k, imgs);
}
function accomSaveText(k) {
    const g = (f) => {
        const el = document.getElementById('accom-t-' + f + '-' + k);
        return el ? el.value : '';
    };
    ['title', 'subtitle', 'tagline', 'desc', 'location'].forEach((f) => {
        const v = g(f);
        saveContent(k + '-' + f, v);
        siteContent[k + '-' + f] = v;
    });
    const m = document.getElementById('accom-text-msg-' + k);
    if (m) {
        m.textContent = 'Saved.';
        m.style.color = '#4CAF50';
        setTimeout(() => {
            m.textContent = '';
        }, 1500);
    }
}
function accomAddAmenity(k) {
    const wrap = document.getElementById('accom-am-rows-' + k);
    if (wrap)
        wrap.insertAdjacentHTML('beforeend', listRowHtml('am', '', 'e.g. Wood-burning stove'));
}
function accomSaveAmenities(k) {
    const wrap = document.getElementById('accom-am-rows-' + k);
    const items = collectListRows(wrap, 'am');
    saveContent('amenities-' + k, items);
    siteContent['amenities-' + k] = items;
}

function accomSectionHtml(k, sec) {
    const r = propertyRates[k] || {};
    switch (sec) {
        case 'web': {
            // This cottage's home-page card (the tile on the home + cottages pages).
            // Uses per-cottage content keys (the original three keep their legacy
            // card1/2/3 keys via cardKeys()), so any cottage edits its own card.
            const ck = cardKeys(k);
            const curText = (key) => {
                const el = document.querySelector('[data-edit-text="' + key + '"]');
                return el ? (el.textContent || '').trim() : siteContent[key] || '';
            };
            const imgEl = document.querySelector('[data-edit-img="' + ck.img + '"]');
            const imgUrl = imgEl ? contentBgUrl(imgEl) : siteContent[ck.img] || '';
            return `<p style="font-size:0.78rem;color:var(--text-muted);margin:0 0 14px;">How this cottage appears on the home page (the tile guests tap). Its detail-page photos &amp; text are in the Photos and Text tabs.</p>
                        <div class="content-edit-row"><div class="exp-edit-thumb" id="ce-thumb-${ck.img}" style="background-image:url('${escapeHtml(imgUrl)}');"></div>
                            <div style="flex:1;min-width:0;"><div class="modal-label" style="margin:0 0 6px;">Home-page photo</div><button class="btn-sm btn-edit" onclick="contentEditImage('${ck.img}')">Replace image</button></div></div>
                        <label class="modal-label" for="ce-${ck.title}">Home-page title</label>
                        <input type="text" class="input-glass" id="ce-${ck.title}" value="${escapeHtml(curText(ck.title))}">
                        <button class="btn-sm btn-edit" style="margin-top:6px;" onclick="contentEditSave('${ck.title}')">Save</button>
                        <label class="modal-label" for="ce-${ck.meta}">Home-page subtitle</label>
                        <input type="text" class="input-glass" id="ce-${ck.meta}" value="${escapeHtml(curText(ck.meta))}">
                        <button class="btn-sm btn-edit" style="margin-top:6px;" onclick="contentEditSave('${ck.meta}')">Save</button>`;
        }
        case 'photos': {
            const imgs = accomImages(k);
            return `<label class="modal-label" style="margin-top:0;">Gallery photos (shown on the cottage page, in this order)</label>
                        <p style="font-size:0.78rem;color:var(--text-muted);margin:0 0 12px;">Add, replace, reorder or remove. The first photo is the main image.</p>
                        <div id="accom-photos-${k}">${imgs.length ? imgs.map((u, i) => accomPhotoRow(k, u, i, imgs.length)).join('') : '<p style="font-size:0.85rem;color:var(--text-muted);">No photos yet — add the first below.</p>'}</div>
                        <button class="btn-sm btn-edit" style="margin-top:10px;" onclick="accomAddPhoto('${k}')">＋ Add photo</button>`;
        }
        case 'text': {
            const def = propertyContent[k] || {};
            const tv = (f, d) =>
                siteContent[k + '-' + f] != null ? siteContent[k + '-' + f] : d || '';
            const ams = Array.isArray(siteContent['amenities-' + k])
                ? siteContent['amenities-' + k]
                : def.amenities || [];
            return `<label class="modal-label" style="margin-top:0;">Title</label>
                        <input type="text" class="input-glass" id="accom-t-title-${k}" value="${escapeHtml(tv('title', def.title))}">
                        <label class="modal-label">Subtitle</label>
                        <input type="text" class="input-glass" id="accom-t-subtitle-${k}" value="${escapeHtml(tv('subtitle', ''))}">
                        <label class="modal-label">Price tagline</label>
                        <input type="text" class="input-glass" id="accom-t-tagline-${k}" value="${escapeHtml(tv('tagline', ''))}">
                        <label class="modal-label">Description</label>
                        <textarea class="input-glass" id="accom-t-desc-${k}" rows="4" style="resize:vertical;">${escapeHtml(tv('desc', def.desc))}</textarea>
                        <label class="modal-label">Location blurb</label>
                        <input type="text" class="input-glass" id="accom-t-location-${k}" value="${escapeHtml(tv('location', ''))}">
                        <div style="margin-top:10px;"><button class="btn-sm btn-edit" onclick="accomSaveText('${k}')">Save text</button> <span id="accom-text-msg-${k}" style="font-size:0.8rem;margin-left:8px;"></span></div>
                        <div class="rule-divider">Features <span style="opacity:0.6;text-transform:none;letter-spacing:0;">(the pills on the cottage page)</span></div>
                        <div id="accom-am-rows-${k}">${ams.map((a) => listRowHtml('am', a, 'e.g. Wood-burning stove')).join('')}</div>
                        <div style="display:flex;gap:10px;margin-top:8px;">
                            <button class="btn-sm btn-edit" onclick="accomAddAmenity('${k}')">＋ Add feature</button>
                            <button class="btn-sm btn-edit" onclick="accomSaveAmenities('${k}')">Save features</button>
                        </div>`;
        }
        case 'rates':
            return `
                    <div class="rate-field"><label>Couple / night — 2 adults (£)</label><input type="number" min="0" step="1" value="${r.coupleRate}" onchange="updateRate('${k}','coupleRate',this.value)"></div>
                    <div class="rate-field"><label>Extra adult / night (£)</label><input type="number" min="0" step="1" value="${r.extraAdultRate}" onchange="updateRate('${k}','extraAdultRate',this.value)"></div>
                    <div class="rate-field"><label>Child / night (£)</label><input type="number" min="0" step="1" value="${r.childRate}" onchange="updateRate('${k}','childRate',this.value)"></div>
                    <div class="rate-field"><label>Standard damages deposit (£)</label><input type="number" min="0" step="5" value="${r.damagesDeposit}" onchange="updateRate('${k}','damagesDeposit',this.value)"></div>
                    <div class="rate-field"><label>Transaction fee (%)</label><input type="number" min="0" step="0.1" value="${r.transactionPct}" onchange="updateRate('${k}','transactionPct',this.value)"></div>
                    <div class="rate-field"><label>Weekend uplift (%) — Fri &amp; Sat <span style="opacity:0.7;">(0 = off)</span></label><input type="number" min="0" max="200" step="1" value="${r.weekendPct || 0}" onchange="updateRate('${k}','weekendPct',this.value)" placeholder="e.g. 20"></div>
                    <div class="rate-field"><label>Airbnb/OTA price for comparison (£/night, optional)</label><input type="number" min="0" step="1" value="${siteContent['ota-price-' + k] != null ? siteContent['ota-price-' + k] : ''}" placeholder="e.g. 165" onchange="saveLocalContent('ota-price-${k}', this.value)"></div>
                    <p style="font-size:0.72rem;color:var(--text-muted);margin:4px 0 0;">If set and higher than your couple rate, a "Save £X/night booking direct" badge shows on the cottage page.</p>`;
        case 'house':
            return `
                    <div class="rate-field"><label>Check-in time</label><input type="time" value="${r.checkInTime || '15:00'}" onchange="updateRuleField('${k}','checkInTime',this.value)" style="text-align:left;width:130px;"></div>
                    <div class="rate-field"><label>Check-out time</label><input type="time" value="${r.checkOutTime || '10:00'}" onchange="updateRuleField('${k}','checkOutTime',this.value)" style="text-align:left;width:130px;"></div>
                    <div class="rate-field"><label>Minimum nights</label><input type="number" min="1" step="1" value="${r.minNights || 1}" onchange="updateRuleField('${k}','minNights',this.value)"></div>
                    <div class="rate-field"><label>Maximum nights <span style="opacity:0.7;">(0 = no limit)</span></label><input type="number" min="0" step="1" value="${r.maxNights || 0}" onchange="updateRuleField('${k}','maxNights',this.value)"></div>
                    <div style="margin-top:6px;"><label style="font-size:0.78rem;color:var(--text-muted);display:block;margin-bottom:8px;">Allowed arrival days <span style="opacity:0.7;">(none ticked = any day)</span></label>
                        <div class="arrival-days">${[
                            'Sun',
                            'Mon',
                            'Tue',
                            'Wed',
                            'Thu',
                            'Fri',
                            'Sat',
                        ]
                            .map(
                                (d, di) =>
                                    `<label class="day-check"><input type="checkbox" ${(r.arrivalDays || []).includes(di) ? 'checked' : ''} onchange="toggleArrivalDay('${k}',${di},this.checked)"> ${d}</label>`,
                            )
                            .join('')}</div>
                    </div>
                    <div class="rule-divider">Guest limits</div>
                    ${(() => {
                        const o = occupancyLimits[k] || {
                            maxAdults: 2,
                            maxChildren: 0,
                            maxTotal: 2,
                        };
                        return `
                    <div class="rate-field"><label>Max adults</label><input type="number" min="1" step="1" id="occ-adults-${k}" value="${o.maxAdults}"></div>
                    <div class="rate-field"><label>Max children</label><input type="number" min="0" step="1" id="occ-children-${k}" value="${o.maxChildren}"></div>
                    <div class="rate-field"><label>Max guests in total</label><input type="number" min="1" step="1" id="occ-total-${k}" value="${o.maxTotal}"></div>
                    <div style="margin-top:8px;"><button class="btn-sm btn-edit" onclick="saveOccupancy('${k}')">Save guest limits</button></div>`;
                    })()}
                    <div class="rule-divider">House rules <span style="opacity:0.6;text-transform:none;letter-spacing:0;">(extra bullets shown to guests)</span></div>
                    <label style="font-size:0.78rem;color:var(--text-muted);display:block;margin-bottom:10px;">Shown under "House rules" on the cottage page, after the check-in/out and guest lines. Add or remove rules with the ＋ / − buttons.</label>
                    <div id="accom-houserules-rows-${k}">${houseRulesList(k)
                        .map((s) => listRowHtml('hr', s, 'e.g. No smoking indoors'))
                        .join('')}</div>
                    <div style="display:flex;gap:10px;margin-top:8px;">
                        <button class="btn-sm btn-edit" onclick="accomAddHouseRule('${k}')">＋ Add rule</button>
                        <button class="btn-sm btn-edit" onclick="accomSaveHouseRules('${k}')">Save</button>
                    </div>`;
        case 'safety':
            return `
                    <label style="font-size:0.78rem;color:var(--text-muted);display:block;margin-bottom:10px;">These appear under "Safety &amp; property" on the cottage page. Add or remove items with the ＋ / − buttons.</label>
                    <div id="accom-safety-rows-${k}">${accomSafetyList(k)
                        .map((s) => listRowHtml('sf', s, 'e.g. Smoke alarm'))
                        .join('')}</div>
                    <div style="display:flex;gap:10px;margin-top:8px;">
                        <button class="btn-sm btn-edit" onclick="accomAddSafety('${k}')">＋ Add item</button>
                        <button class="btn-sm btn-edit" onclick="accomSaveSafety('${k}')">Save</button>
                    </div>`;
        case 'seasons':
            return `
                    <label style="font-size:0.78rem;color:var(--text-muted);display:block;margin-bottom:10px;">Couple / night for a date range (overrides the standard couple rate while active).</label>
                    <div id="seasons-${k}">${(propertySeasons[k] || []).map((s, si) => seasonRowHtml(k, s)).join('') || ''}</div>
                    <div style="display:flex;gap:10px;margin-top:8px;">
                        <button class="btn-sm btn-edit" onclick="addSeasonRow('${k}')">＋ Add season</button>
                        <button class="btn-sm btn-edit" onclick="saveSeasons('${k}')">Save seasons</button>
                    </div>`;
        case 'arrival':
            return `
                    <div><label style="font-size:0.78rem;color:var(--text-muted);display:block;margin-bottom:6px;">Sent to guests a few days before check-in (directions, key collection, wifi…). Kept private — never shown on the site. Also revealed on a guest's account when they're at the cottage (see Location).</label><textarea rows="5" style="width:100%;background:rgba(0,0,0,0.25);border:1px solid var(--glass-border);color:var(--text-light);padding:9px 12px;border-radius:10px;font-family:var(--font-sans);resize:vertical;" onchange="saveContent('arrival-${k}', this.value)">${escapeHtml(adminPrivateContent['arrival-' + k] || '')}</textarea></div>`;
        case 'location':
            return `
                    <div style="margin-bottom:14px;"><label style="font-size:0.78rem;color:var(--text-muted);display:block;margin-bottom:6px;">Address (shown to guests)</label><textarea rows="2" style="width:100%;background:rgba(0,0,0,0.25);border:1px solid var(--glass-border);color:var(--text-light);padding:9px 12px;border-radius:10px;font-family:var(--font-sans);resize:vertical;" onchange="updateRateText('${k}','address',this.value)">${r.address || ''}</textarea></div>
                    <div class="rule-divider">Key-code unlock location</div>
                    <div>
                        <label style="font-size:0.78rem;color:var(--text-muted);display:block;margin-bottom:6px;">The cottage's GPS spot. When a guest with a current booking is within 25m of here, the arrival info unlocks on their account page. Stand at the cottage and tap the button.</label>
                        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:8px;">
                            <button class="btn-sm btn-edit" onclick="captureGeo('${k}')">${IC_PIN} Use my current location</button>
                            <span id="geo-status-${k}" style="font-size:0.8rem;color:var(--text-muted);">${geoStatusText(k)}</span>
                            <button class="btn-sm btn-delete" onclick="clearGeo('${k}')">Clear</button>
                        </div>
                        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
                            <input type="number" step="any" inputmode="decimal" id="geo-lat-${k}" placeholder="Latitude" value="${geoVal(k) ? geoVal(k).lat : ''}" style="background:rgba(0,0,0,0.25);border:1px solid var(--glass-border);color:var(--text-light);padding:8px 10px;border-radius:10px;width:150px;font-family:var(--font-sans);">
                            <input type="number" step="any" inputmode="decimal" id="geo-lng-${k}" placeholder="Longitude" value="${geoVal(k) ? geoVal(k).lng : ''}" style="background:rgba(0,0,0,0.25);border:1px solid var(--glass-border);color:var(--text-light);padding:8px 10px;border-radius:10px;width:150px;font-family:var(--font-sans);">
                            <button class="btn-sm btn-edit" onclick="saveGeoManual('${k}')">Save coordinates</button>
                        </div>
                        <p style="font-size:0.72rem;color:var(--text-muted);margin:6px 0 0;">Tip: in Google Maps, right-click the exact spot and click the latitude/longitude at the top of the menu to copy it, then paste here.</p>
                    </div>`;
        case 'local':
            return `
                    <div style="margin-bottom:14px;"><label style="font-size:0.78rem;color:var(--text-muted);display:block;margin-bottom:6px;">Dark skies / stargazing note — shown on the cottage page.</label><textarea rows="3" style="width:100%;background:rgba(0,0,0,0.25);border:1px solid var(--glass-border);color:var(--text-light);padding:9px 12px;border-radius:10px;font-family:var(--font-sans);resize:vertical;" onchange="saveLocalContent('darkskies-${k}', this.value)">${escapeHtml(siteContent['darkskies-' + k] || DEFAULT_DARKSKIES)}</textarea></div>
                    <div style="margin-bottom:14px;"><label style="font-size:0.78rem;color:var(--text-muted);display:block;margin-bottom:6px;">Getting here car-free — shown on the cottage page.</label><textarea rows="3" style="width:100%;background:rgba(0,0,0,0.25);border:1px solid var(--glass-border);color:var(--text-light);padding:9px 12px;border-radius:10px;font-family:var(--font-sans);resize:vertical;" onchange="saveLocalContent('carfree-${k}', this.value)">${escapeHtml(siteContent['carfree-' + k] || DEFAULT_CARFREE)}</textarea></div>
                    <div><label style="font-size:0.78rem;color:var(--text-muted);display:block;margin-bottom:6px;">Accessibility — steps, parking distance, ground-floor sleeping, bathroom layout. Shown on the cottage page.</label><textarea rows="4" style="width:100%;background:rgba(0,0,0,0.25);border:1px solid var(--glass-border);color:var(--text-light);padding:9px 12px;border-radius:10px;font-family:var(--font-sans);resize:vertical;" onchange="saveLocalContent('access-${k}', this.value)">${escapeHtml(siteContent['access-' + k] || DEFAULT_ACCESS)}</textarea></div>`;
        case 'faq':
            return `
                    <label style="font-size:0.78rem;color:var(--text-muted);display:block;margin-bottom:10px;">FAQ shown in this cottage's bookings (the "Good to Know" button).</label>
                    <div id="faq-editor-${k}">${(Array.isArray(siteContent['faqs-' + k]) ? siteContent['faqs-' + k] : []).map((f) => faqRowHtml(k, f)).join('')}</div>
                    <div style="display:flex;gap:10px;margin-top:8px;">
                        <button class="btn-sm btn-edit" onclick="addFaqRow('${k}')">＋ Add question</button>
                        <button class="btn-sm btn-edit" onclick="saveFaqs('${k}')">Save FAQ</button>
                    </div>`;
        case 'welcome': {
            const secs = Array.isArray(adminPrivateContent['welcome-' + k])
                ? adminPrivateContent['welcome-' + k]
                : [];
            return `
                    <label style="font-size:0.78rem;color:var(--text-muted);display:block;margin-bottom:10px;">A private in-stay guide your guests can open during their stay (Wi-Fi, how things work, bins, parking, heating, local tips, checkout). Kept private — only shown to guests who've booked this cottage.</label>
                    <div id="welcome-editor-${k}">${secs.map((s) => welcomeRowHtml(k, s)).join('')}</div>
                    <div style="display:flex;gap:10px;margin-top:8px;">
                        <button class="btn-sm btn-edit" onclick="addWelcomeRow('${k}')">＋ Add section</button>
                        <button class="btn-sm btn-edit" onclick="saveWelcome('${k}')">Save welcome book</button>
                    </div>`;
        }
        default:
            return '';
    }
}

// ---- Guest reviews: public renderer + Settings editor ----
let publicGuestReviews = []; // approved guest-submitted reviews
async function loadPublicReviews() {
    try {
        const res = await apiGet('reviews.php');
        publicGuestReviews = Array.isArray(res.reviews) ? res.reviews : [];
    } catch (e) {
        /* keep last-good reviews on a transient failure */
    }
    try {
        renderGuestWords();
    } catch (e) {}
    try {
        updateHeritageStats();
    } catch (e) {}
}
// ---- Homepage guest-words band: one real review at a time ----
let __gwTimer = null,
    __gwIdx = 0;
function renderGuestWords() {
    const sec = document.getElementById('home-guestwords');
    const q = document.getElementById('guestwords-quote');
    const meta = document.getElementById('guestwords-meta');
    if (!sec || !q || !meta) return;
    const list = allReviews().filter((r) => ((r.text || '') + '').trim().length > 20);
    if (!list.length) {
        sec.style.display = 'none';
        if (__gwTimer) {
            clearInterval(__gwTimer);
            __gwTimer = null;
        }
        return;
    }
    sec.style.display = '';
    const show = () => {
        const r = list[__gwIdx % list.length];
        const text = String(r.text || '').trim();
        q.textContent = text.length > 220 ? text.slice(0, 217).trimEnd() + '…' : text;
        const stars = Math.max(1, Math.min(5, parseInt(r.stars) || 5));
        const propName = r.prop && propertyMeta[r.prop] ? propertyMeta[r.prop].name : '';
        meta.innerHTML = `<span class="gw-stars">${'★'.repeat(stars)}</span>&nbsp;&nbsp;${escapeHtml(r.name || 'A guest')}${propName ? ' · ' + escapeHtml(propName) : ''}`;
    };
    show();
    if (!__gwTimer && list.length > 1) {
        __gwTimer = setInterval(() => {
            q.classList.add('fading');
            meta.classList.add('fading');
            setTimeout(() => {
                __gwIdx++;
                show();
                q.classList.remove('fading');
                meta.classList.remove('fading');
            }, 620);
        }, 8500);
    }
}
// ---- Heritage band: live cottage count + genuine average rating ----
function updateHeritageStats() {
    try {
        const cnt = document.getElementById('heritage-count');
        if (cnt) {
            const n = liveCottageKeys().length;
            if (n > 0) cnt.textContent = n;
        }
        const ratings = allReviews().map((r) => Math.max(1, Math.min(5, parseInt(r.stars) || 5)));
        if (ratings.length >= 3) {
            const avg = ratings.reduce((s, n) => s + n, 0) / ratings.length;
            const el = document.getElementById('heritage-rating');
            const item = document.getElementById('heritage-rating-item');
            if (el && item) {
                el.textContent = '★ ' + (Math.round(avg * 10) / 10).toFixed(1);
                item.style.display = '';
            }
        }
    } catch (e) {}
}
// ---- FAQ / house rules (per cottage, shown inside each booking card) ----
let __faqUid = 0;
function faqBlockHtml(propKey) {
    const faqs = Array.isArray(siteContent['faqs-' + propKey])
        ? siteContent['faqs-' + propKey]
        : [];
    const valid = faqs.filter((f) => (f.q || '').trim() && (f.a || '').trim());
    if (!valid.length) return '';
    return `<button class="btn-sm btn-edit" onclick="openFaqModal('${propKey}')"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><circle cx="12" cy="7.8" r="0.7" fill="currentColor" stroke="none"/></svg> Good to Know</button>`;
}
// Build the accordion items for a cottage and show them in the floating modal
function openFaqModal(propKey) {
    const m = document.getElementById('faq-modal');
    const body = document.getElementById('faq-modal-list');
    const title = document.getElementById('faq-modal-title');
    if (!m || !body) return;
    const faqs = (
        Array.isArray(siteContent['faqs-' + propKey]) ? siteContent['faqs-' + propKey] : []
    ).filter((f) => (f.q || '').trim() && (f.a || '').trim());
    const meta = propertyMeta[propKey] || { name: propKey };
    if (title) title.innerText = 'Good to Know — ' + meta.name;
    body.innerHTML = faqs
        .map((f) => {
            const id = 'faq-' + ++__faqUid;
            return `<div class="faq-item" id="${id}">
                    <button class="faq-q" onclick="toggleFaq('${id}')">
                        ${f.icon ? `<span class="faq-icon">${escapeHtml(f.icon)}</span>` : ''}
                        <span>${escapeHtml(f.q)}</span>
                    </button>
                    <div class="faq-a"><div class="faq-a-inner">${escapeHtml(f.a)}</div></div>
                </div>`;
        })
        .join('');
    m.classList.add('open');
}
function closeFaqModal() {
    const m = document.getElementById('faq-modal');
    if (m) m.classList.remove('open');
}
function toggleFaq(id) {
    const item = document.getElementById(id);
    if (!item) return;
    const ans = item.querySelector('.faq-a');
    if (!ans) return;
    if (item.classList.contains('open')) {
        item.classList.remove('open');
        ans.style.maxHeight = '0';
    } else {
        item.classList.add('open');
        ans.style.maxHeight = ans.scrollHeight + 'px';
    }
}

function reviewCardHtml(r) {
    const stars = Math.max(0, Math.min(5, parseInt(r.stars) || 5));
    const propName = r.prop && propertyMeta[r.prop] ? propertyMeta[r.prop].name : '';
    const src = r.source ? ` <span class="review-source">via ${escapeHtml(r.source)}</span>` : '';
    return `<div class="review-card glass-panel">
                <div class="review-stars">${'★'.repeat(stars)}${'☆'.repeat(5 - stars)}</div>
                <div class="review-text">“${escapeHtml(r.text || '')}”</div>
                <div class="review-who">${escapeHtml(r.name || 'A guest')}${propName ? ` <span>— ${escapeHtml(propName)}</span>` : ''}${src}</div>
            </div>`;
}
// All genuine guest reviews, newest first. Two real sources are combined:
//  1. On-site submissions — approved, from guests who actually completed a
//     stay (served by reviews.php). These are real and come newest-first.
//  2. Owner-curated reviews entered in Settings → Guest Reviews — genuine
//     reviews imported from other platforms (Airbnb/Vrbo/Google etc.),
//     each tagged with its source so visitors see where it came from.
// Both feed the per-cottage and host counts/ratings.
function allReviews() {
    const guest = Array.isArray(publicGuestReviews) ? publicGuestReviews : [];
    const curated = (Array.isArray(siteContent.reviews) ? siteContent.reviews : []).filter(
        (r) => r && (r.text || '').toString().trim(),
    );
    // On-site submissions first (freshest, already newest-first), then the
    // owner-imported reviews in editor order.
    return guest.concat(curated);
}
function renderReviews() {
    try {
        renderCardRatings();
    } catch (e) {} // social proof on the cottage cards (runs even with no reviews)
    const sec = document.getElementById('reviews-section');
    const list = document.getElementById('reviews-list');
    if (!sec || !list) return;
    const reviews = allReviews();
    if (!reviews.length) {
        sec.style.display = 'none';
        return;
    }
    // Home page shows only the 3 latest
    list.innerHTML = reviews.slice(0, 3).map(reviewCardHtml).join('');
    const moreWrap = document.getElementById('reviews-more-wrap');
    if (moreWrap) moreWrap.style.display = reviews.length > 3 ? '' : 'none';
    sec.style.display = '';
}
function openAllReviews(propKey) {
    const m = document.getElementById('reviews-modal');
    const body = document.getElementById('reviews-modal-list');
    if (!m || !body) return;
    let list = allReviews();
    if (propKey) list = list.filter((r) => r.prop === propKey);
    body.innerHTML = list.map(reviewCardHtml).join('');
    m.classList.add('open');
}
// Per-cottage reviews on the property page (Airbnb-style: score + count + cards).
function renderPropReviews(propKey) {
    const wrap = document.getElementById('prop-reviews');
    if (!wrap) return;
    const divider = document.getElementById('reviews-divider');
    const list = allReviews().filter((r) => r.prop === propKey);
    if (!list.length) {
        wrap.style.display = 'none';
        wrap.innerHTML = '';
        if (divider) divider.style.display = 'none'; // avoid a double rule above "Where you'll be"
        return;
    }
    if (divider) divider.style.display = '';
    const count = list.length;
    const avg =
        list.reduce((s, r) => s + Math.max(1, Math.min(5, parseInt(r.stars) || 5)), 0) / count;
    const show = list.slice(0, 4);
    const more =
        count > show.length
            ? `<button class="btn-glass" style="margin-top:18px;padding:12px 28px;" onclick="openAllReviews('${propKey}')">Read all ${count} reviews</button>`
            : '';
    wrap.style.display = '';
    wrap.innerHTML = `
                <h3 class="section-title" style="text-align:left;font-size:1.6rem;margin-bottom:14px;">Guest reviews</h3>
                <div class="prop-reviews-head">
                    <span class="prop-reviews-score">★ ${avg.toFixed(1)}</span>
                    <span class="prop-reviews-count">${count} review${count === 1 ? '' : 's'}</span>
                </div>
                <div class="reviews-grid">${show.map(reviewCardHtml).join('')}</div>
                ${more}`;
}
function closeAllReviews() {
    const m = document.getElementById('reviews-modal');
    if (m) m.classList.remove('open');
}

// ---- Airbnb-style cottage page: subtitle, stat row, feature rows, booking bar ----
// Editable per-cottage subtitle (guests · bedrooms · beds · baths). Owners can
// correct the counts in the live editor; these are the starting defaults.
const propSubtitleDefault = {
    '21a': 'Townhouse in Blakeney · Sleeps 6 · 3 bedrooms · 2 bathrooms',
    jollyboat: 'Cottage for two in Blakeney · Sleeps 2 · 1 bedroom · 1 bathroom',
    pimpernel: 'Contemporary cottage in Blakeney · Sleeps 4 · 2 bedrooms · 1 bathroom',
};
const IC_MEDAL =
    '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="9" r="5"/><path d="M9 13.5L8 21l4-2 4 2-1-7.5"/></svg>';
function renderPropStats(propKey) {
    const el = document.getElementById('prop-stats');
    if (!el) return;
    const list = allReviews().filter((r) => r.prop === propKey);
    const count = list.length;
    const avg = count
        ? list.reduce((s, r) => s + Math.max(1, Math.min(5, parseInt(r.stars) || 5)), 0) / count
        : 0;
    const fav = count >= 5 && avg >= 4.8; // "Guest favourite" only when genuinely well-rated
    const ratingCell = count
        ? `<div class="prop-stat"><div class="prop-stat-top">${avg.toFixed(2)}</div><div class="prop-stat-stars">${'★'.repeat(Math.round(avg))}</div></div>`
        : `<div class="prop-stat"><div class="prop-stat-top">New</div><div class="prop-stat-sub">no reviews yet</div></div>`;
    const favCell = fav
        ? `<div class="prop-stat"><div class="prop-stat-top">${IC_MEDAL}</div><div class="prop-stat-sub" style="text-transform:none;color:var(--text-light);font-size:0.82rem;letter-spacing:0;">Guest favourite</div></div>`
        : '';
    const reviewsCell = count
        ? `<div class="prop-stat"><div class="prop-stat-top">${count}</div><div class="prop-stat-sub">review${count === 1 ? '' : 's'}</div></div>`
        : '';
    el.innerHTML = ratingCell + favCell + reviewsCell;
}
function renderPropFeatures(propKey) {
    const el = document.getElementById('prop-features');
    if (!el) return;
    const row = (icon, title, sub) =>
        `<div class="prop-feature">${icon}<div><div class="prop-feature-title">${title}</div>${sub ? `<div class="prop-feature-sub">${escapeHtml(sub)}</div>` : ''}</div></div>`;
    el.innerHTML = [
        row(IC_LOCK, 'Self check-in', ''),
        row(
            IC_CHECK,
            'Direct with the owner',
            'No platform fees — book and chat straight with us.',
        ),
        row(
            IC_PIN,
            'On the North Norfolk coast',
            'Moments from Blakeney quay, the coastal path and the saltmarshes.',
        ),
    ].join('');
}
// Airbnb-style "Show more" for the cottage description: clamp to a few lines
// and only reveal the toggle when the text actually overflows.
function setupPropDescClamp() {
    const p = document.getElementById('prop-desc');
    const btn = document.getElementById('prop-desc-toggle');
    if (!p || !btn) return;
    p.classList.add('clamped');
    btn.classList.remove('open');
    btn.textContent = 'Show more';
    // Measure next frame so layout has settled after the view becomes visible.
    requestAnimationFrame(() => {
        const overflowing = p.scrollHeight > p.clientHeight + 2;
        if (overflowing) {
            btn.style.display = '';
        } else {
            p.classList.remove('clamped');
            btn.style.display = 'none';
        }
    });
}
function togglePropDesc() {
    const p = document.getElementById('prop-desc');
    const btn = document.getElementById('prop-desc-toggle');
    if (!p || !btn) return;
    const nowClamped = p.classList.toggle('clamped');
    btn.classList.toggle('open', !nowClamped);
    btn.textContent = nowClamped ? 'Show more' : 'Show less';
}
// Desktop: tuck the availability calendar into the reserve card, just above
// "Enquire now". Mobile: keep it in the content flow (after #cal-mobile-anchor).
const calDesktopMq = window.matchMedia('(min-width: 900px)');
function placeAvailCalendar() {
    const cal = document.getElementById('prop-avail-cal');
    const reserve = document.getElementById('prop-reserve');
    const anchor = document.getElementById('cal-mobile-anchor');
    if (!cal || !reserve || !anchor) return;
    if (calDesktopMq.matches) {
        if (reserve.firstChild !== cal) reserve.insertBefore(cal, reserve.firstChild);
        cal.classList.add('in-reserve');
    } else {
        if (anchor.nextSibling !== cal) anchor.parentNode.insertBefore(cal, anchor.nextSibling);
        cal.classList.remove('in-reserve');
    }
}
// Re-place the calendar whenever we cross the desktop/mobile breakpoint.
try {
    calDesktopMq.addEventListener('change', placeAvailCalendar);
} catch (e) {
    try {
        calDesktopMq.addListener(placeAvailCalendar);
    } catch (e2) {}
}
// Keep the sticky booking bar's price in sync with the form. Always a "from"
// price (never a "total") — the price isn't final until we confirm the booking,
// since the enquiry can change it (extra guests, etc.).
function updateBookBar() {
    if (!activeFrontProperty) return;
    const ci = (document.getElementById('enq-checkin') || {}).value;
    const co = (document.getElementById('enq-checkout') || {}).value;
    const adults = Math.max(
        1,
        parseInt((document.getElementById('enq-adults') || {}).value, 10) || 2,
    );
    const children = Math.max(
        0,
        parseInt((document.getElementById('enq-children') || {}).value, 10) || 0,
    );
    let html;
    if (ci && co && co > ci) {
        const p = priceBreakdown(activeFrontProperty, adults, children, ci, co);
        html = `From ${gbp(p.total)} <small>· ${p.nights} night${p.nights === 1 ? '' : 's'}</small>`;
    } else {
        const r = propertyRates[activeFrontProperty] || defaultRates[activeFrontProperty] || {};
        html =
            r.coupleRate != null
                ? `From ${gbp(r.coupleRate)} <small>/ night · select dates</small>`
                : `Select your dates`;
    }
    ['pbb-price', 'pr-price'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = html;
    });
}
// ---- Two-step enquiry modal (Airbnb "Review your stay" → "Your details") ----
// ---- Resume an abandoned enquiry (draft lives ONLY in this browser) ----
const ENQ_DRAFT_KEY = 'chb-enq-draft';
function enquireDraftSave() {
    try {
        const g = (id) => {
            const el = document.getElementById(id);
            return el ? el.value : '';
        };
        const draft = {
            at: Date.now(),
            prop: activeFrontProperty || '',
            name: g('enq-name'),
            email: g('enq-email'),
            phone: g('enq-phone'),
            postcode: g('enq-postcode'),
            address: g('enq-address'),
            message: g('enq-message'),
            checkIn: g('enq-checkin'),
            checkOut: g('enq-checkout'),
            adults: g('enq-adults'),
            children: g('enq-children'),
        };
        if (!draft.name && !draft.email && !draft.checkIn && !draft.message) {
            localStorage.removeItem(ENQ_DRAFT_KEY);
            return;
        }
        localStorage.setItem(ENQ_DRAFT_KEY, JSON.stringify(draft));
    } catch (e) {}
}
function enquireDraftGet() {
    try {
        const d = JSON.parse(localStorage.getItem(ENQ_DRAFT_KEY) || 'null');
        if (!d || Date.now() - (d.at || 0) > 7 * 24 * 3600 * 1000) return null; // stale after a week
        return d;
    } catch (e) {
        return null;
    }
}
function enquireDraftClear() {
    try {
        localStorage.removeItem(ENQ_DRAFT_KEY);
    } catch (e) {}
    enquiryResumeHide();
}
function enquiryResumeHide() {
    const c = document.getElementById('enquiry-resume');
    if (c) c.style.display = 'none';
}
function enquiryResumeDismiss() {
    enquireDraftClear();
}
// Show the "pick up where you left off" chip on return visits (public only).
function enquiryResumeShow() {
    if (document.body.classList.contains('owner-mode')) return;
    const chip = document.getElementById('enquiry-resume');
    if (!chip) return;
    const d = enquireDraftGet();
    if (!d || (!d.email && !d.checkIn && !d.name)) {
        chip.style.display = 'none';
        return;
    }
    const nm = (propertyMeta[d.prop] && propertyMeta[d.prop].name) || '';
    const t = document.getElementById('enquiry-resume-text');
    if (t) t.textContent = 'Resume your enquiry' + (nm ? ' — ' + nm : '');
    chip.style.display = '';
}
function enquiryResumeOpen() {
    const d = enquireDraftGet();
    enquiryResumeHide();
    if (!d) return;
    const key =
        d.prop && propertyMeta[d.prop] && !propertyMeta[d.prop].archived
            ? d.prop
            : liveCottageKeys()[0] || '';
    if (!key) return;
    try {
        openProperty(key);
    } catch (e) {}
    openEnquireModal();
    // Restore AFTER the modal's own reset.
    const set = (id, v) => {
        const el = document.getElementById(id);
        if (el && v) el.value = v;
    };
    ['name', 'email', 'phone', 'postcode', 'address', 'message'].forEach((f) =>
        set('enq-' + f, d[f]),
    );
    set('enq-checkin', d.checkIn);
    set('enq-checkout', d.checkOut);
    if (d.adults) set('enq-adults', d.adults);
    if (d.children) set('enq-children', d.children);
    try {
        applyOccupancyToForm(key);
        refreshDateTrigger();
        updateEnquiryPrice();
    } catch (e) {}
}
// Autosave while the visitor types anywhere in the enquiry form.
document.addEventListener('input', (e) => {
    const id = (e.target && e.target.id) || '';
    if (id.indexOf('enq-') === 0) enquireDraftSave();
});
function openEnquireModal() {
    const key = activeFrontProperty;
    if (!key) return;
    try {
        trackEvent('enquiry_open', key);
    } catch (e) {}
    const img =
        (propertyContent[key] && propertyContent[key].images && propertyContent[key].images[0]) ||
        '';
    const imgEl = document.getElementById('enq-sum-img');
    if (imgEl) imgEl.style.backgroundImage = img ? `url('${img}')` : '';
    const nameEl = document.getElementById('enq-sum-name');
    if (nameEl) nameEl.innerText = (propertyMeta[key] && propertyMeta[key].name) || key;
    const rateEl = document.getElementById('enq-sum-rating');
    if (rateEl) {
        const list = allReviews().filter((r) => r.prop === key);
        const cnt = list.length;
        const avg = cnt
            ? list.reduce((s, r) => s + Math.max(1, Math.min(5, parseInt(r.stars) || 5)), 0) / cnt
            : 0;
        rateEl.innerText = cnt
            ? `★ ${avg.toFixed(2)} · ${cnt} review${cnt === 1 ? '' : 's'}`
            : 'New · no reviews yet';
    }
    enquireBack(); // always start on the Review step
    // The optional "create account" step (3) only applies to guests who aren't
    // signed in — hide its progress segment for everyone else.
    const showAcct = !currentGuest;
    ['enq-prog-3', 'enq-prog-line2'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.style.display = showAcct ? '' : 'none';
    });
    applyOccupancyToForm(key); // ensure steppers/children reflect this cottage's limits
    refreshDateTrigger();
    updateEnquiryPrice();
    const m = document.getElementById('enquire-modal');
    if (m) m.classList.add('open');
    enquiryResumeHide();
}
function closeEnquireModal() {
    const m = document.getElementById('enquire-modal');
    if (m) m.classList.remove('open');
}
function enquireBack() {
    const r = document.getElementById('enquire-step-review');
    const d = document.getElementById('enquire-step-details');
    const a = document.getElementById('enquire-step-account');
    if (r) r.style.display = '';
    if (d) d.style.display = 'none';
    if (a) a.style.display = 'none';
    setEnqStep(1);
    setEnqMsg('review', '');
    setEnqMsg('details', '');
}
// Light up the progress indicator (1 = Your stay, 2 = Your details, 3 = Account).
function setEnqStep(n) {
    const p1 = document.getElementById('enq-prog-1'),
        p2 = document.getElementById('enq-prog-2'),
        p3 = document.getElementById('enq-prog-3');
    if (p1) p1.classList.toggle('done', n >= 2);
    if (p2) p2.classList.toggle('on', n >= 2);
    if (p3) p3.classList.toggle('on', n >= 3);
}
// Inline validation message inside the enquiry popup (replaces blocking
// glassAlert for the two-step form). step = 'review' | 'details'.
function setEnqMsg(step, text) {
    const el = document.getElementById(step === 'details' ? 'enq-msg-details' : 'enq-msg-review');
    if (!el) return;
    el.textContent = text || '';
    el.classList.toggle('show', !!text);
}
// Review → Details: validate dates/rules/occupancy up front (same checks as submit).
function enquireContinue() {
    setEnqMsg('review', '');
    const ci = (document.getElementById('enq-checkin') || {}).value;
    const co = (document.getElementById('enq-checkout') || {}).value;
    if (!ci || !co) {
        setEnqMsg('review', 'Please choose your stay dates.');
        return;
    }
    if (co <= ci) {
        setEnqMsg('review', 'Your check-out date must be after your check-in date.');
        return;
    }
    const ruleErr = checkBookingRules(activeFrontProperty, ci, co);
    if (ruleErr) {
        setEnqMsg('review', ruleErr);
        return;
    }
    const adults = Math.max(
        1,
        parseInt((document.getElementById('enq-adults') || {}).value, 10) || 0,
    );
    const children = Math.max(
        0,
        parseInt((document.getElementById('enq-children') || {}).value, 10) || 0,
    );
    const occErr = checkOccupancy(activeFrontProperty, adults, children);
    if (occErr) {
        setEnqMsg('review', occErr);
        return;
    }
    const r = document.getElementById('enquire-step-review');
    const d = document.getElementById('enquire-step-details');
    if (r) r.style.display = 'none';
    if (d) d.style.display = '';
    setEnqStep(2);
    const box = document.querySelector('.enquire-box');
    if (box) box.scrollTop = 0;
}
function reviewRowHtml(r) {
    r = r || { name: '', stars: 5, text: '', prop: '', source: '' };
    const propOpts = ['<option value="">(no cottage)</option>']
        .concat(
            Object.keys(propertyMeta).map(
                (k) =>
                    `<option value="${k}" ${r.prop === k ? 'selected' : ''}>${propertyMeta[k].name}</option>`,
            ),
        )
        .join('');
    const starOpts = [5, 4, 3]
        .map(
            (n) =>
                `<option value="${n}" ${parseInt(r.stars) === n ? 'selected' : ''}>${'★'.repeat(n)}</option>`,
        )
        .join('');
    const srcOpts = ['', 'Airbnb', 'Vrbo', 'Booking.com', 'Google', 'Email', 'Guestbook']
        .map(
            (s) =>
                `<option value="${s}" ${(r.source || '') === s ? 'selected' : ''}>${s || '(no source)'}</option>`,
        )
        .join('');
    return `<div class="review-row" style="border:1px solid var(--glass-border);border-radius:14px;padding:14px;margin-bottom:10px;background:var(--glass-bg);">
                <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px;">
                    <input type="text" class="input-glass field-sm" placeholder="Guest name" value="${escapeHtml(r.name || '')}" data-rf="name" style="flex:1 1 140px;min-width:120px;">
                    <select class="input-glass field-sm" data-rf="stars">${starOpts}</select>
                    <select class="input-glass field-sm" data-rf="prop">${propOpts}</select>
                    <select class="input-glass field-sm" data-rf="source" title="Where this review came from">${srcOpts}</select>
                    <button class="btn-sm btn-delete" onclick="this.closest('.review-row').remove()" title="Remove review"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
                </div>
                <textarea rows="2" class="input-glass field-sm" placeholder="What they said…" data-rf="text">${escapeHtml(r.text || '')}</textarea>
            </div>`;
}
function renderReviewsEditor() {
    const wrap = document.getElementById('reviews-editor');
    if (!wrap) return;
    const reviews = Array.isArray(siteContent.reviews) ? siteContent.reviews : [];
    wrap.innerHTML = reviews.map(reviewRowHtml).join('');
}

// ---- Per-cottage FAQ editor (Settings, inside each rate panel) ----
function faqRowHtml(propKey, f) {
    f = f || { icon: '', q: '', a: '' };
    return `<div class="faq-row" style="border:1px solid var(--glass-border);border-radius:14px;padding:14px;margin-bottom:10px;background:var(--glass-bg);">
                <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px;">
                    <input type="text" class="input-glass field-sm" placeholder="Emoji" value="${escapeHtml(f.icon || '')}" data-fq="icon" style="width:64px;text-align:center;" maxlength="4">
                    <input type="text" class="input-glass field-sm" placeholder="Question (e.g. What time is check-in?)" value="${escapeHtml(f.q || '')}" data-fq="q" style="flex:1 1 240px;min-width:160px;">
                    <button class="btn-sm btn-delete" onclick="this.closest('.faq-row').remove()" title="Remove question"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
                </div>
                <textarea rows="3" class="input-glass field-sm" placeholder="Answer…" data-fq="a">${escapeHtml(f.a || '')}</textarea>
            </div>`;
}
function addFaqRow(propKey) {
    const wrap = document.getElementById('faq-editor-' + propKey);
    if (wrap) wrap.insertAdjacentHTML('beforeend', faqRowHtml(propKey, null));
}
async function saveFaqs(propKey) {
    const wrap = document.getElementById('faq-editor-' + propKey);
    if (!wrap) return;
    const faqs = [];
    for (const row of wrap.querySelectorAll('.faq-row')) {
        const get = (sel) => {
            const el = row.querySelector(`[data-fq="${sel}"]`);
            return el ? el.value.trim() : '';
        };
        const q = get('q'),
            a = get('a'),
            icon = get('icon');
        if (!q && !a) continue; // empty row — skip
        if (!q || !a) {
            glassAlert('Each entry needs both a question and an answer.');
            return;
        }
        faqs.push({ icon, q, a });
    }
    try {
        await saveContent('faqs-' + propKey, faqs);
        siteContent['faqs-' + propKey] = faqs;
        toast(faqs.length ? 'Good to Know saved.' : 'Saved — no FAQ entries now.');
    } catch (e) {
        glassAlert("Couldn't save: " + e.message);
    }
}

// ---- Welcome book editor (per cottage, private) ----
function welcomeRowHtml(propKey, s) {
    s = s || { title: '', body: '' };
    return `<div class="welcome-row" style="border:1px solid var(--glass-border);border-radius:14px;padding:14px;margin-bottom:10px;background:var(--glass-bg);">
                <div style="display:flex;gap:8px;margin-bottom:8px;">
                    <input type="text" class="input-glass field-sm" placeholder="Section title (e.g. Wi-Fi, Heating, Bins)" value="${escapeHtml(s.title || '')}" data-wb="title" style="flex:1 1 240px;min-width:160px;">
                    <button class="btn-sm btn-delete" onclick="this.closest('.welcome-row').remove()" title="Remove section"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
                </div>
                <textarea rows="3" class="input-glass field-sm" placeholder="Details…" data-wb="body">${escapeHtml(s.body || '')}</textarea>
            </div>`;
}
function addWelcomeRow(propKey) {
    const wrap = document.getElementById('welcome-editor-' + propKey);
    if (wrap) wrap.insertAdjacentHTML('beforeend', welcomeRowHtml(propKey, null));
}
async function saveWelcome(propKey) {
    const wrap = document.getElementById('welcome-editor-' + propKey);
    if (!wrap) return;
    const sections = [];
    for (const row of wrap.querySelectorAll('.welcome-row')) {
        const get = (sel) => {
            const el = row.querySelector(`[data-wb="${sel}"]`);
            return el ? el.value.trim() : '';
        };
        const title = get('title'),
            body = get('body');
        if (!title && !body) continue; // empty row — skip
        if (!title || !body) {
            glassAlert('Each section needs both a title and some details.');
            return;
        }
        sections.push({ title, body });
    }
    try {
        await saveContent('welcome-' + propKey, sections);
        adminPrivateContent['welcome-' + propKey] = sections; // private key — kept in the admin cache
        toast(sections.length ? 'Welcome book saved.' : 'Saved — no sections yet.');
    } catch (e) {
        glassAlert("Couldn't save: " + e.message);
    }
}

// ---- Moderation of guest-submitted reviews (Settings) ----
// ---- Analytics panel (Settings → Analytics) ----
let __analyticsSummary = null; // last summary fetched, for the CSV export

// Build + download a CSV of the current analytics window (no backend).
function exportAnalyticsCsv() {
    const d = __analyticsSummary;
    if (!d) {
        glassAlert('Open the analytics panel first.');
        return;
    }
    const q = (v) => {
        const s = String(v ?? '');
        return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const rows = [
        ['Cottage Holidays Blakeney — analytics'],
        ['Window (days)', d.days || ''],
        ['Generated', new Date().toISOString()],
        [],
        ['Metric', 'Value'],
        ['Page views', d.totalViews || 0],
        ['Unique visitors', d.uniqueVisitors || 0],
        ['New visitors', (d.visitorMix || {}).new || 0],
        ['Returning visitors', (d.visitorMix || {}).returning || 0],
        ['Views this week', d.weekViews || 0],
        ['Unique this week', d.weekUnique || 0],
        ['Enquiries', d.enquiries || 0],
        ['Bookings', d.bookings || 0],
        ['Searches', (d.searchDemand || {}).total || 0],
        ['Searches found nothing', (d.searchDemand || {}).noResult || 0],
        [],
        ['Device', 'Views'],
        ...(d.devices || []).map((x) => [x.device, x.count]),
        [],
        ['Date', 'Views'],
        ...(d.daily || []).map((r) => [r.date, r.views]),
    ];
    const csv = rows.map((r) => r.map(q).join(',')).join('\r\n');
    const today = todayDashed(); // UK date, consistent with the analytics data itself
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `chb-analytics-${d.days || 30}d-${today}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Turn the analytics summary into a few ranked plain-English "so what" lines.
function buildInsights(d) {
    const out = [];
    const uniq = d.uniqueVisitors || 0,
        views = d.totalViews || 0;
    const prevV = d.prevTotalViews || 0,
        bookings = d.bookings || 0;
    const days = d.days || 30;
    const winLabel =
        days === 7 ? '7 days' : days === 90 ? '90 days' : days === 365 ? '12 months' : '30 days';
    const mName = (ym) => {
        const [y, m] = (ym || '').split('-');
        return y && m ? new Date(+y, +m - 1, 1).toLocaleDateString('en-GB', { month: 'long' }) : ym;
    };
    // Momentum vs the previous equal-length window.
    if (prevV > 0) {
        const p = Math.round(((views - prevV) / prevV) * 100);
        if (Math.abs(p) >= 10)
            out.push({
                t: `Visits are ${p >= 0 ? 'up' : 'down'} ${Math.abs(p)}% versus the previous ${winLabel}.`,
                s: Math.abs(p) + (p < 0 ? 25 : 0),
            });
    }
    // Conversion (only worth saying once there's a meaningful base).
    if (uniq >= 20) {
        const c = Math.round((bookings / uniq) * 1000) / 10;
        out.push({ t: `${c}% of unique visitors booked (${bookings} from ${uniq}).`, s: 30 });
    }
    // Device mix.
    const devs = d.devices || [],
        devTot = devs.reduce((a, b) => a + b.count, 0);
    if (devTot > 0) {
        const m = devs.find((x) => x.device === 'mobile');
        const mp = m ? Math.round((m.count / devTot) * 100) : 0;
        if (mp >= 50)
            out.push({
                t: `${mp}% of visits are on mobile — keep the booking flow thumb-friendly.`,
                s: 24,
            });
        else if (mp > 0 && mp <= 25)
            out.push({ t: `Most visitors are on desktop (${100 - mp}%).`, s: 12 });
    }
    // Bounce.
    if ((d.bounceRate || 0) >= 60 && uniq >= 20)
        out.push({
            t: `${d.bounceRate}% of visitors leave after a single page — stronger calls-to-action could help.`,
            s: 26,
        });
    // Returning interest.
    const mix = d.visitorMix || { new: 0, returning: 0 },
        mt = (mix.new || 0) + (mix.returning || 0);
    if (mt >= 20) {
        const rp = Math.round((mix.returning / mt) * 100);
        if (rp >= 30)
            out.push({ t: `${rp}% of visitors are returning — interest is building.`, s: 16 });
    }
    // Top channel.
    const ch = d.channels || [];
    if (ch.length) out.push({ t: `${ch[0].channel} is your top traffic source.`, s: 10 });
    // Unmet demand.
    const sd = d.searchDemand || {};
    if ((sd.noResult || 0) > 0 && (sd.total || 0) > 0) {
        const np = Math.round((sd.noResult / sd.total) * 100);
        const top = (sd.topMonths || []).find((m) => m.count > m.found);
        out.push({
            t: `${np}% of availability searches found nothing free${top ? ` — most for ${mName(top.month)}` : ''}.`,
            s: 22 + (np >= 40 ? 15 : 0),
        });
    }
    return out
        .sort((a, b) => b.s - a.s)
        .slice(0, 4)
        .map((x) => x.t);
}

async function loadAnalytics(days = 30) {
    const wrap = document.getElementById('analytics-body');
    if (!wrap) return;
    days = [7, 30, 90, 365].includes(+days) ? +days : 30;
    wrap.innerHTML = `<p style="font-size:0.85rem;color:var(--text-muted);">Loading…</p>`;
    let d;
    try {
        d = await apiGet('track.php?action=summary&days=' + days);
    } catch (e) {
        wrap.innerHTML = `<p style="font-size:0.85rem;color:var(--text-muted);">Couldn't load analytics${e && e.message ? ' (' + escapeHtml(e.message) + ')' : ''}.</p>`;
        return;
    }
    __analyticsSummary = d; // stashed for the CSV export below

    // ---- labels / formatters ----
    const rangeLabel = (n) =>
        n === 7 ? '7 days' : n === 90 ? '90 days' : n === 365 ? '12 months' : '30 days';
    const winDays = d.days || days;
    const winLabel = rangeLabel(winDays);
    const PAGE_LABELS = {
        'view-main': 'Home',
        'view-cottages': 'All cottages',
        'view-experiences': 'Experiences',
        'view-21a': 'A cottage page',
        'view-guest-bookings': 'My stays',
        'view-pay': 'Payment',
        'view-account': 'Account',
    };
    const pageLabel = (p) =>
        PAGE_LABELS[p] || (p || '').replace(/^view-/, '').replace(/-/g, ' ') || 'Home';
    const monthName = (ym) => {
        const [y, m] = (ym || '').split('-');
        return y && m
            ? new Date(+y, +m - 1, 1).toLocaleDateString('en-GB', {
                  month: 'short',
                  year: 'numeric',
              })
            : ym || '';
    };
    const moCard = (title, body) =>
        `<div class="mo-card"><div class="mo-card-title">${title}</div>${body}</div>`;
    const grid2 = (a, b) => `<div class="mo-grid2">${a}${b}</div>`;
    const emptyNote = (t) =>
        `<p style="font-size:0.82rem;color:var(--text-muted);margin:2px 0 0;">${t}</p>`;

    // Category palette — colour bars by meaning rather than one flat hue.
    const HUE = {
        Direct: 'var(--accent)',
        Search: '#5BA8FF',
        Social: '#C792EA',
        Referral: '#7FD1AE',
        mobile: '#5BA8FF',
        tablet: '#7FD1AE',
        desktop: 'var(--accent)',
    };

    // Period-over-period delta vs the previous equal-length window.
    const delta = (cur, prev) => {
        if (!prev || prev <= 0) return '';
        const pct = Math.round(((cur - prev) / prev) * 100);
        return ` · ${pct >= 0 ? '▲' : '▼'} ${Math.abs(pct)}% vs prev ${winLabel}`;
    };

    // ---- KPI tiles ----
    const uniq = d.uniqueVisitors || 0,
        bookings = d.bookings || 0;
    const convPct = uniq > 0 ? (bookings / uniq) * 100 : 0;
    const convDisp = convPct >= 10 ? Math.round(convPct) : Math.round(convPct * 10) / 10;
    const mix = d.visitorMix || { new: 0, returning: 0 };
    const mixTotal = (mix.new || 0) + (mix.returning || 0);
    const retPct = mixTotal > 0 ? Math.round((mix.returning / mixTotal) * 100) : 0;
    const kpis = `<div class="mo-kpis">
                <div class="mo-kpi"><div class="mo-label">Visits</div><div class="mo-value">${d.totalViews || 0}</div><div class="mo-sub">${winLabel}${delta(d.totalViews || 0, d.prevTotalViews || 0)}</div></div>
                <div class="mo-kpi"><div class="mo-label">Unique visitors</div><div class="mo-value">${uniq}</div><div class="mo-sub">${winLabel}${delta(uniq, d.prevUniqueVisitors || 0)}</div></div>
                <div class="mo-kpi"><div class="mo-label">Conversion</div><div class="mo-value">${convDisp}%</div><div class="mo-sub">${bookings} booking${bookings === 1 ? '' : 's'} ÷ visitors</div></div>
                <div class="mo-kpi"><div class="mo-label">Returning</div><div class="mo-value">${retPct}%</div><div class="mo-sub">${mix.new || 0} new · ${mix.returning || 0} returning</div></div>
            </div>`;

    // ---- daily trend → vertical bars, rolled up so long windows stay readable ----
    const daily = Array.isArray(d.daily) ? d.daily : [];
    const fmtDM = (s) => {
        const [y, m, dd] = (s || '').split('-');
        return dd ? `${+dd}/${+m}` : s;
    };
    let trendItems;
    if (winDays <= 30) {
        trendItems = daily.map((r) => ({
            short: (r.date || '').slice(8),
            label: fmtDM(r.date),
            value: r.views,
        }));
    } else if (winDays <= 120) {
        trendItems = [];
        for (let i = 0; i < daily.length; i += 7) {
            const chunk = daily.slice(i, i + 7);
            trendItems.push({
                short: fmtDM(chunk[0].date),
                label: 'week of ' + fmtDM(chunk[0].date),
                value: chunk.reduce((a, b) => a + b.views, 0),
            });
        }
    } else {
        const mm = {};
        daily.forEach((r) => {
            const k = (r.date || '').slice(0, 7);
            mm[k] = (mm[k] || 0) + r.views;
        });
        trendItems = Object.keys(mm)
            .sort()
            .map((k) => ({
                short: monthName(k).replace(/\s\d+$/, ''),
                label: monthName(k),
                value: mm[k],
            }));
    }
    const peak = daily.reduce((mx, r) => Math.max(mx, r.views), 0);
    const trendHtml = daily.length
        ? osVBars(trendItems) +
          `<div style="font-size:0.68rem;color:var(--text-muted);margin-top:4px;">peak ${peak}/day · ${winDays <= 30 ? 'by day' : winDays <= 120 ? 'by week' : 'by month'}</div>`
        : emptyNote('No visits recorded yet — check back once guests have browsed the site.');

    // ---- funnels (green→amber so drop-off reads at a glance) ----
    const stepColor = (i, n) =>
        `hsl(${Math.round(140 - (140 - 35) * (n > 1 ? i / (n - 1) : 0))}, 52%, 56%)`;
    const funnelBars = (steps) => {
        const top = steps[0].value || 0,
            n = steps.length;
        return osHBars(
            steps.map((s, i) => {
                const prev = i === 0 ? null : steps[i - 1].value;
                const fromPrev =
                    prev != null && prev > 0 ? Math.round((s.value / prev) * 100) : null;
                return {
                    label: s.label,
                    value: s.value,
                    max: top || 1,
                    valLabel: s.value + (fromPrev != null ? ` · ${fromPrev}%` : ''),
                    color: stepColor(i, n),
                };
            }),
        );
    };
    const funnel =
        funnelBars([
            { label: 'Unique visitors', value: uniq },
            { label: 'Enquiries', value: d.enquiries || 0 },
            { label: 'Bookings', value: bookings },
        ]) + emptyNote('Enquiries &amp; bookings are counted by the date they came in.');
    const ev = d.events || {};
    const engagement = funnelBars([
        { label: 'Clicked “Enquire now”', value: ev.book_click || 0 },
        { label: 'Opened the enquiry form', value: ev.enquiry_open || 0 },
        { label: 'Sent an enquiry', value: ev.enquiry_submit || 0 },
        { label: 'Started a payment', value: ev.pay_start || 0 },
    ]);
    const convDonut = `<div style="display:flex;align-items:center;gap:14px;margin-bottom:6px;">${osDonut(Math.round(convPct), 'var(--accent)')}<div style="font-size:0.82rem;color:var(--text-muted);line-height:1.5;">${bookings} booking${bookings === 1 ? '' : 's'} from ${uniq} unique visitor${uniq === 1 ? '' : 's'} this ${winLabel}.</div></div>`;

    // ---- audience: new/returning + devices ----
    const mixMax = Math.max(mix.new || 0, mix.returning || 0, 1);
    const mixHtml = mixTotal
        ? osHBars([
              { label: 'New', value: mix.new || 0, max: mixMax, color: '#5BA8FF' },
              { label: 'Returning', value: mix.returning || 0, max: mixMax, color: '#7FD1AE' },
          ])
        : emptyNote('No visitors recorded yet.');
    const DEVICE_LABELS = { mobile: 'Mobile', tablet: 'Tablet', desktop: 'Desktop' };
    const devices = Array.isArray(d.devices) ? d.devices : [];
    const devMax = devices.reduce((m, x) => Math.max(m, x.count), 0);
    const devicesHtml = devices.length
        ? osHBars(
              devices.map((x) => ({
                  label: DEVICE_LABELS[x.device] || x.device,
                  value: x.count,
                  max: devMax,
                  color: HUE[x.device] || 'var(--accent)',
              })),
          )
        : emptyNote('No device data yet.');

    // ---- acquisition: channels / engines / sources / referrers ----
    const channels = Array.isArray(d.channels) ? d.channels : [];
    const chMax = channels.reduce((m, c) => Math.max(m, c.count), 0);
    const channelsHtml = channels.length
        ? osHBars(
              channels.map((c) => ({
                  label: c.channel,
                  value: c.count,
                  max: chMax,
                  color: HUE[c.channel] || 'var(--accent)',
              })),
          )
        : emptyNote('No visits recorded yet.');
    const engines = Array.isArray(d.searchEngines) ? d.searchEngines : [];
    const enMax = engines.reduce((m, e) => Math.max(m, e.count), 0);
    const enginesHtml = engines.length
        ? osHBars(
              engines.map((e) => ({ label: e.name, value: e.count, max: enMax, color: '#5BA8FF' })),
          ) +
          `<p style="font-size:0.72rem;color:var(--text-muted);margin:6px 0 0;line-height:1.5;">Search engines hide the words people typed — connect Google Search Console for the actual terms.</p>`
        : emptyNote('No search-engine visits yet.');
    const sources = Array.isArray(d.sources) ? d.sources : [];
    const srcMax = sources.reduce((m, s) => Math.max(m, s.count), 0);
    const sourcesHtml = sources.length
        ? osHBars(
              sources.map((s) => ({
                  label: s.source,
                  value: s.count,
                  max: srcMax,
                  color: '#C792EA',
              })),
          )
        : emptyNote('No tagged campaign links yet.');
    const refs = Array.isArray(d.topReferrers) ? d.topReferrers : [];
    const refMax = refs.reduce((m, r) => Math.max(m, r.count), 0);
    const refsHtml = refs.length
        ? osHBars(
              refs.map((r) => ({ label: r.host, value: r.count, max: refMax, color: '#7FD1AE' })),
          )
        : emptyNote('Mostly direct visits (no referrer) so far.');

    // ---- behaviour: devices already built above; pages / exit pages / cottages ----
    const pages = Array.isArray(d.topPages) ? d.topPages : [];
    const pgMax = pages.reduce((m, p) => Math.max(m, p.views), 0);
    const fmtDur = (ms) => {
        if (!ms) return '';
        const s = Math.round(ms / 1000);
        return s < 60 ? ` · ${s}s` : ` · ${Math.floor(s / 60)}m ${s % 60}s`;
    };
    const pagesHtml = pages.length
        ? osHBars(
              pages.map((p) => ({
                  label: pageLabel(p.path),
                  value: p.views,
                  max: pgMax,
                  valLabel: `${p.views}${fmtDur(p.dwellMs)}`,
                  color: 'var(--accent)',
              })),
          )
        : emptyNote('No page views yet.');
    const exits = Array.isArray(d.exitPages) ? d.exitPages : [];
    const exMax = exits.reduce((m, x) => Math.max(m, x.count), 0);
    const exitsHtml = exits.length
        ? osHBars(
              exits.map((x) => ({
                  label: pageLabel(x.path),
                  value: x.count,
                  max: exMax,
                  color: '#C792EA',
              })),
          )
        : emptyNote('Not enough data yet.');
    const cottages = Array.isArray(d.byCottage) ? d.byCottage : [];
    const cotMax = cottages.reduce((m, c) => Math.max(m, c.views), 0);
    const cottageHtml = cottages.length
        ? osHBars(
              cottages.map((c) => ({
                  label: (propertyMeta[c.prop_key] || {}).name || c.prop_key,
                  value: c.views,
                  max: cotMax,
                  color: `var(--prop-${c.prop_key}, var(--accent))`,
              })),
          )
        : emptyNote('No cottage page views yet.');

    // Search demand: what guests searched + how often nothing was free.
    const sd = d.searchDemand || { total: 0, noResult: 0, topMonths: [], recentNoResult: [] };
    const noPct = sd.total ? Math.round((sd.noResult / sd.total) * 100) : 0;
    const tmMax = (sd.topMonths || []).reduce((m, x) => Math.max(m, x.count), 0);
    const topMonthsHtml = (sd.topMonths || []).length
        ? osHBars(
              (sd.topMonths || []).map((x) => ({
                  label: `${monthName(x.month)} · ${x.count ? Math.round((x.found / x.count) * 100) : 0}% found space`,
                  value: x.count,
                  max: tmMax,
                  color: 'var(--accent)',
              })),
          )
        : '';
    const recentNoHtml = (sd.recentNoResult || [])
        .map((r) => {
            const who = `${r.adults} adult${r.adults === 1 ? '' : 's'}${r.children ? ` + ${r.children} child${r.children === 1 ? '' : 'ren'}` : ''}`;
            const when =
                r.mode === 'flex'
                    ? `${r.nights || '?'} night${r.nights === 1 ? '' : 's'} in ${monthName(r.month)}`
                    : `${dpPretty(r.check_in) || 'dates'}${r.nights ? ` · ${r.nights} night${r.nights === 1 ? '' : 's'}` : ''}`;
            return `<li style="margin-bottom:5px;">${escapeHtml(when)} · ${escapeHtml(who)}</li>`;
        })
        .join('');

    // ---- sticky period bar (segmented control) + CSV export ----
    const seg = `<div class="ana-seg" role="tablist">${[7, 30, 90, 365].map((n) => `<button type="button" class="ana-seg-btn${n === winDays ? ' on' : ''}" onclick="loadAnalytics(${n})">${rangeLabel(n)}</button>`).join('')}</div>`;
    const pickerRow = `<div class="ana-pick">${seg}<button type="button" class="ana-export" onclick="exportAnalyticsCsv()">⬇ Export CSV</button></div>`;

    // Auto-generated highlights ("so what") from the summary above.
    const insights = buildInsights(d);
    const insightsHtml = insights.length
        ? `<div class="ana-insights"><div class="mo-card-title" style="margin-bottom:6px;">Highlights</div><ul style="margin:0;padding-left:18px;">${insights.map((t) => `<li>${escapeHtml(t)}</li>`).join('')}</ul></div>`
        : '';

    wrap.innerHTML =
        pickerRow +
        insightsHtml +
        kpis +
        `
                <div class="ana-group-title">Behaviour over time</div>
                ${moCard(`Visits <span style="opacity:0.6;">(last ${winLabel})</span>`, trendHtml)}
                ${grid2(moCard('From visitor to booking', convDonut + funnel), moCard('On-site engagement <span style="opacity:0.6;">(drop-off)</span>', engagement))}

                <div class="ana-group-title">Audience</div>
                ${grid2(moCard('New vs returning', mixHtml), moCard('How visitors browse', devicesHtml))}

                <div class="ana-group-title">Where visitors come from</div>
                ${grid2(moCard('Channels', channelsHtml), moCard('Search engines', enginesHtml))}
                ${grid2(moCard('Campaign sources <span style="opacity:0.6;">(utm_source)</span>', sourcesHtml), moCard('Top referrers', refsHtml))}

                <div class="ana-group-title">On-site behaviour</div>
                ${grid2(moCard('Most-viewed pages', pagesHtml), moCard('Where people leave <span style="opacity:0.6;">(exit pages)</span>', exitsHtml))}
                ${grid2(moCard('Most-viewed cottages', cottageHtml), moCard('Bounce rate', `<div style="display:flex;align-items:center;gap:14px;">${osDonut(d.bounceRate || 0, '#C792EA')}<div style="font-size:0.82rem;color:var(--text-muted);line-height:1.5;">Visitors who looked at just one page before leaving.</div></div>`))}

                <div class="ana-group-title">What guests are searching for</div>
                ${moCard(
                    'Search demand',
                    `
                    <div class="mo-kpis" style="margin-bottom:12px;">
                        <div class="mo-kpi"><div class="mo-label">Searches</div><div class="mo-value">${sd.total || 0}</div><div class="mo-sub">last ${winLabel}</div></div>
                        <div class="mo-kpi"><div class="mo-label">Found nothing</div><div class="mo-value${noPct >= 40 ? ' mo-warn' : ''}">${sd.noResult || 0}</div><div class="mo-sub">${noPct}% of searches</div></div>
                    </div>
                    ${topMonthsHtml ? `<div style="font-size:0.74rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:1px;margin:4px 0 10px;">Most-requested months</div>${topMonthsHtml}` : ''}
                    ${recentNoHtml ? `<div style="font-size:0.74rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:1px;margin:14px 0 8px;">Recent searches that found nothing</div><ul style="margin:0;padding-left:18px;font-size:0.85rem;color:var(--text-light);">${recentNoHtml}</ul><p style="font-size:0.74rem;color:var(--text-muted);margin:10px 0 0;">These are unmet demand — consider opening dates, adjusting prices, or nudging your waitlist.</p>` : sd.total ? '' : emptyNote('No searches recorded yet.')}
                `,
                )}`;
}

// ---- Waitlist manager (Settings → Waitlist) ----
async function loadWaitlist() {
    const wrap = document.getElementById('waitlist-body');
    if (!wrap) return;
    wrap.innerHTML = `<p style="font-size:0.85rem;color:var(--text-muted);">Loading…</p>`;
    let rows = [];
    try {
        const r = await apiGet('waitlist.php');
        rows = r.waitlist || [];
    } catch (e) {
        wrap.innerHTML = `<p style="font-size:0.85rem;color:var(--text-muted);">Couldn't load the waitlist${e && e.message ? ' (' + escapeHtml(e.message) + ')' : ''}.</p>`;
        return;
    }
    if (!rows.length) {
        wrap.innerHTML = `<p style="font-size:0.85rem;color:var(--text-muted);">No one on the waitlist yet.</p>`;
        return;
    }
    wrap.innerHTML = rows
        .map((w) => {
            const name = (propertyMeta[w.prop_key] || {}).name || w.prop_key;
            const dates =
                w.check_in && w.check_out ? `${w.check_in} → ${w.check_out}` : 'Any dates';
            const notified = w.notified_at
                ? `<span style="color:#4CAF50;">Notified ${escapeHtml(String(w.notified_at).slice(0, 10))}</span>`
                : '<span style="color:var(--text-muted);">Waiting</span>';
            return `<div class="accounts-stat" style="max-width:640px;margin-bottom:12px;">
                    <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:baseline;">
                        <div><span class="prop-tag tag-${w.prop_key}">${escapeHtml((propertyMeta[w.prop_key] || {}).short || w.prop_key)}</span> <strong>${escapeHtml(name)}</strong> · ${escapeHtml(dates)}</div>
                        <div style="font-size:0.78rem;">${notified}</div>
                    </div>
                    <div style="font-size:0.86rem;color:var(--text-muted);margin-top:6px;">${escapeHtml(w.name || '—')} · ${escapeHtml(w.email || '')}${w.note ? ' · ' + escapeHtml(w.note) : ''}</div>
                    <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap;">
                        <button class="btn-sm btn-edit" onclick="notifyWaitlist(${w.id})">Email "dates available"</button>
                        <button class="btn-sm btn-delete" onclick="deleteWaitlist(${w.id})">Remove</button>
                    </div>
                </div>`;
        })
        .join('');
}
// ---- Newsletter (Settings → Newsletter) ----
async function loadNewsletter() {
    const stats = document.getElementById('newsletter-stats');
    const sendMsg = document.getElementById('nl-send-msg');
    if (sendMsg) sendMsg.textContent = '';
    if (!stats) return;
    stats.innerHTML = `<p style="font-size:0.85rem;color:var(--text-muted);">Loading…</p>`;
    let r;
    try {
        r = await apiGet('newsletter.php');
    } catch (e) {
        stats.innerHTML = `<p style="font-size:0.85rem;color:var(--text-muted);">Couldn't load subscribers${e && e.message ? ' (' + escapeHtml(e.message) + ')' : ''}.</p>`;
        return;
    }
    const active = r.active || 0,
        total = r.total || 0;
    const recent = (r.recent || []).filter((s) => !s.unsubscribed_at).slice(0, 12);
    const list = recent.length
        ? `<div style="font-size:0.82rem;color:var(--text-muted);margin-top:10px;">${recent.map((s) => escapeHtml(s.email)).join(' · ')}${active > recent.length ? ' …' : ''}</div>`
        : `<div style="font-size:0.82rem;color:var(--text-muted);margin-top:10px;">No subscribers yet — the footer sign-up form feeds this list.</div>`;
    stats.innerHTML = `<div class="accounts-stat" style="max-width:640px;">
                <div style="display:flex;gap:26px;flex-wrap:wrap;">
                    <div><div class="today-card-value" style="font-size:1.7rem;">${active}</div><div style="font-size:0.72rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:1px;">Active subscribers</div></div>
                    <div><div class="today-card-value" style="font-size:1.7rem;">${total - active}</div><div style="font-size:0.72rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:1px;">Unsubscribed</div></div>
                </div>${list}</div>`;
}
// ---- System check (Settings → System check) ----
// Apply any pending database migrations from the UI (calls migrate.php with
// the admin session) — so new tables/columns go live without phpMyAdmin.
// Generate WebP companions for EXISTING uploaded photos (new uploads already
// get one). Safe to re-run; processes in batches, so click again if more remain.
async function backfillWebp() {
    const msg = document.getElementById('diag-msg');
    if (msg) {
        msg.style.color = '';
        msg.textContent = 'Optimising your photos…';
    }
    try {
        const r = await apiPost('webp-backfill.php', {});
        if (!msg) return;
        if (!r.ok) {
            msg.style.color = '#E57373';
            msg.textContent = r.error || "Couldn't optimise photos.";
            return;
        }
        msg.style.color = '#4CAF50';
        const more = r.remaining > 0 ? ` ${r.remaining} more to go — click again to continue.` : '';
        msg.textContent =
            `Done — optimised ${r.created} photo${r.created === 1 ? '' : 's'}` +
            ` (${r.skipped} already done${r.failed ? `, ${r.failed} skipped` : ''}).${more}`;
    } catch (e) {
        if (msg) {
            msg.style.color = '#E57373';
            msg.textContent = 'Could not run: ' + (e.message || 'error');
        }
    }
}

async function runMigrations() {
    const out = document.getElementById('migrate-result');
    const msg = document.getElementById('diag-msg');
    if (msg) {
        msg.style.color = '';
        msg.textContent = 'Installing updates…';
    }
    if (out) out.style.display = 'none';
    try {
        const r = await fetch(API_BASE + 'migrate.php', { credentials: 'same-origin' });
        const data = await r.json().catch(() => ({}));
        const list = (data && data.migrations) || [];
        const changed = list.filter((m) => /^(applied|re-applied|baselined)/i.test(m.status || ''));
        if (msg) {
            msg.style.color = data.ok ? '#4CAF50' : '#E57373';
            msg.textContent = !data.ok
                ? "Some updates didn't install — see below."
                : changed.length
                  ? `Done — installed ${changed.length} update${changed.length === 1 ? '' : 's'}.`
                  : 'Everything is already up to date.';
        }
        if (out) {
            out.style.display = 'block';
            out.innerHTML = list.length
                ? list
                      .map((m) => {
                          const err = (m.status || '').toLowerCase() === 'error';
                          return `<div style="color:${err ? '#E57373' : 'var(--text-muted)'};">${escapeHtml(m.file || '')} — ${escapeHtml(m.status || '')}${m.error ? ': ' + escapeHtml(m.error) : ''}</div>`;
                      })
                      .join('')
                : '<div style="color:var(--text-muted);">No migration files found.</div>';
        }
        try {
            refreshExpPendingBadge();
        } catch (e) {}
    } catch (e) {
        if (msg) {
            msg.style.color = '#E57373';
            msg.textContent = 'Could not install updates: ' + (e.message || 'error');
        }
    }
}

async function loadDiagnostics() {
    const body = document.getElementById('diagnostics-body');
    const msg = document.getElementById('diag-msg');
    if (msg) msg.textContent = '';
    if (!body) return;
    body.innerHTML = `<p style="font-size:0.85rem;color:var(--text-muted);">Running checks…</p>`;
    let r;
    try {
        r = await apiPost('diagnostics.php', { action: 'run' });
    } catch (e) {
        body.innerHTML = `<p style="font-size:0.85rem;color:#E57373;">Couldn't run checks: ${escapeHtml(e.message || '')}</p>`;
        return;
    }
    const checks = r.checks || [],
        s = r.summary || {};
    const dot = (st) => (st === 'ok' ? '#4CAF50' : st === 'warn' ? '#FFB74D' : '#E57373');
    const word = (st) => (st === 'ok' ? 'OK' : st === 'warn' ? 'Optional' : 'Action needed');
    // Group by category, preserving order of first appearance.
    const cats = [];
    checks.forEach((c) => {
        if (!cats.includes(c.category)) cats.push(c.category);
    });
    const summary = `<div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:16px;font-size:0.85rem;">
                <span style="color:#4CAF50;">● ${s.ok || 0} OK</span>
                <span style="color:#FFB74D;">● ${s.warn || 0} optional/off</span>
                <span style="color:#E57373;">● ${s.fail || 0} need attention</span></div>`;
    body.innerHTML =
        summary +
        cats
            .map(
                (cat) => `
                <div class="accounts-stat" style="max-width:640px;margin-bottom:14px;">
                    <div class="label">${escapeHtml(cat)}</div>
                    <div style="display:flex;flex-direction:column;gap:10px;margin-top:10px;">
                        ${checks
                            .filter((c) => c.category === cat)
                            .map(
                                (c) => `
                            <div style="display:flex;gap:10px;align-items:flex-start;">
                                <span style="color:${dot(c.status)};font-size:1.1rem;line-height:1.2;flex-shrink:0;">●</span>
                                <div style="min-width:0;">
                                    <div style="font-size:0.9rem;color:var(--text-light);"><strong>${escapeHtml(c.label)}</strong> <span style="font-size:0.72rem;color:${dot(c.status)};">${word(c.status)}</span></div>
                                    <div style="font-size:0.8rem;color:var(--text-muted);">${escapeHtml(c.detail || '')}</div>
                                    ${c.hint && c.status !== 'ok' ? `<div style="font-size:0.76rem;color:var(--text-muted);opacity:0.85;margin-top:2px;">→ ${escapeHtml(c.hint)}</div>` : ''}
                                </div>
                            </div>`,
                            )
                            .join('')}
                    </div>
                </div>`,
            )
            .join('');
    // Backups: run/download the weekly database dump (also emailed Mondays).
    body.innerHTML += `
                <div class="accounts-stat" style="max-width:640px;margin-bottom:14px;">
                    <div class="label">Backups</div>
                    <p style="font-size:0.8rem;color:var(--text-muted);margin:8px 0 12px;">A copy of every booking, payment and guest record. Runs automatically each Monday and is emailed to you; the last 8 are kept on the server.</p>
                    <div id="backup-status" style="font-size:0.82rem;color:var(--text-muted);margin-bottom:12px;">Checking…</div>
                    <div style="display:flex;gap:8px;flex-wrap:wrap;">
                        <button class="btn-sm btn-edit" onclick="runBackupNow(this)">Back up now</button>
                        <button class="btn-sm btn-edit" onclick="window.open('backup.php?action=download','_blank')">Download latest</button>
                    </div>
                </div>
                <div class="accounts-stat" style="max-width:640px;margin-bottom:14px;">
                    <div class="label">Hero image</div>
                    <p style="font-size:0.8rem;color:var(--text-muted);margin:8px 0 12px;">The homepage photo is the first thing every visitor downloads. If it's a full-resolution upload, one click resizes and re-compresses it (the original is kept, and you can re-upload any time in Website content).</p>
                    <div id="hero-opt-status" style="font-size:0.82rem;color:var(--text-muted);margin-bottom:12px;">Checking…</div>
                    <button class="btn-sm btn-edit" id="hero-opt-btn" onclick="optimizeHeroNow(this)" style="display:none;">Optimise hero image</button>
                </div>`;
    refreshBackupStatus();
    refreshHeroStatus();
}
async function refreshHeroStatus() {
    const el = document.getElementById('hero-opt-status');
    const btn = document.getElementById('hero-opt-btn');
    if (!el) return;
    try {
        const r = await apiPost('optimize-hero.php', { action: 'status' });
        if (!r.hero) {
            el.textContent = 'No uploaded hero found — upload one in Website content.';
            return;
        }
        const kb = Math.round(r.hero.bytes / 1024);
        if (r.hero.optimized) {
            el.textContent = `Current hero: ${kb} KB — already optimised. ✓`;
        } else {
            el.textContent = `Current hero: ${kb} KB — larger than it needs to be (target ~250 KB).`;
            if (btn) btn.style.display = '';
        }
    } catch (e) {
        el.textContent = "Couldn't check the hero: " + (e.message || '');
    }
}
async function optimizeHeroNow(btn) {
    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Optimising…';
    }
    try {
        const r = await apiPost('optimize-hero.php', { action: 'optimize' });
        if (r.ok)
            toast(
                `Hero optimised: ${Math.round(r.before_bytes / 1024)} KB → ${Math.round(r.after_bytes / 1024)} KB${r.webp_bytes ? ` (${Math.round(r.webp_bytes / 1024)} KB as WebP)` : ''}.`,
            );
        else toast(r.error || "Couldn't optimise the hero.", 'error');
    } catch (e) {
        toast(e.message || "Couldn't optimise the hero.", 'error');
    }
    if (btn) {
        btn.disabled = false;
        btn.textContent = 'Optimise hero image';
        btn.style.display = 'none';
    }
    refreshHeroStatus();
}
async function refreshBackupStatus() {
    const el = document.getElementById('backup-status');
    if (!el) return;
    try {
        const r = await apiPost('backup.php', { action: 'status' });
        const b = (r.backups || [])[0];
        el.textContent = b
            ? `Latest: ${b.file} · ${Math.round(b.bytes / 1024)} KB · ${b.at}`
            : 'No backup stored yet — run one now.';
    } catch (e) {
        el.textContent = "Couldn't check backups: " + (e.message || '');
    }
}
async function runBackupNow(btn) {
    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Backing up…';
    }
    try {
        const r = await apiPost('backup.php', { action: 'run' });
        toast(
            r.ok
                ? `Backup saved (${Math.round((r.bytes || 0) / 1024)} KB)${r.emailed ? ' and emailed to you' : ''}.`
                : r.error || 'Backup failed',
            r.ok ? undefined : 'error',
        );
    } catch (e) {
        toast(e.message || 'Backup failed', 'error');
    }
    if (btn) {
        btn.disabled = false;
        btn.textContent = 'Back up now';
    }
    refreshBackupStatus();
}
async function sendTestEmail() {
    const msg = document.getElementById('diag-msg');
    const show = (t, ok) => {
        if (msg) {
            msg.style.color = ok ? '#4CAF50' : '#E57373';
            msg.textContent = t;
        }
    };
    show('Sending…', true);
    try {
        const r = await apiPost('diagnostics.php', { action: 'test_email' });
        if (r.ok) show('Sent ✓ — check ' + (r.to || 'your owner inbox') + '.', true);
        else show(r.error || "Couldn't send.", false);
    } catch (e) {
        show(e.message || "Couldn't send.", false);
    }
}

// ============================================================
//  Test centre (Settings → Test centre): try every customer-facing feature
//  from the back office — preview the site, send sample emails, run a
//  disposable test booking through the real pay/email/arrival flows, and
//  see & remove all test data in one place.
// ============================================================
let tcOwnerEmail = '';
let tcSquare = { enabled: false, production: false };
const TC_PAGES = [
    {
        id: 'features',
        label: 'Recent features',
        sub: 'Seed demo data to try the latest additions',
        ic: '<path d="M12 2l2.5 7.5H22l-6.2 4.6L18 22l-6-4.4L6 22l2.2-7.9L2 9.5h7.5z"/>',
    },
    {
        id: 'preview',
        label: 'Preview as guest',
        sub: 'See the live customer site, read-only',
        ic: '<path d="M1.5 12S5 5 12 5s10.5 7 10.5 7-3.5 7-10.5 7S1.5 12 1.5 12z"/><circle cx="12" cy="12" r="3"/>',
    },
    {
        id: 'emails',
        label: 'Test emails',
        sub: 'Send [TEST] samples to your inbox',
        ic: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
    },
    {
        id: 'booking',
        label: 'Test booking',
        sub: 'Create one &amp; run pay / email / arrival flows',
        ic: '<rect x="3" y="4.5" width="18" height="16" rx="2.5"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/>',
    },
    {
        id: 'data',
        label: 'Test data',
        sub: 'See &amp; remove anything the Test centre created',
        ic: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>',
    },
];
function renderTestCentreList() {
    const list = document.getElementById('testcentre-list');
    const detail = document.getElementById('testcentre-detail');
    if (detail) {
        detail.style.display = 'none';
        detail.innerHTML = '';
    }
    settingsBackTarget = () => settingsShowIndex();
    const title = document.getElementById('settings-panel-title');
    if (title) title.textContent = SETTINGS_TITLES.testcentre;
    if (!list) return;
    list.style.display = '';
    list.innerHTML = `<p style="font-size:0.85rem;color:var(--text-muted);max-width:640px;margin:0 0 16px;">Try every customer-facing feature without being a guest. Emails arrive in your owner inbox marked <strong>[TEST]</strong>; test bookings are clearly tagged, kept out of your revenue, and removable on the Test data page.</p>
                <div class="settings-group">${TC_PAGES.map(
                    (p) => `
                    <button class="settings-row" onclick="tcOpen('${p.id}')">
                        <span class="settings-row-ic"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p.ic}</svg></span>
                        <span class="settings-row-main"><span class="settings-row-label">${p.label}</span><span class="settings-row-sub">${p.sub}</span></span><span class="settings-row-chev">›</span>
                    </button>`,
                ).join('')}</div>`;
}
function tcOpen(page) {
    const list = document.getElementById('testcentre-list');
    const detail = document.getElementById('testcentre-detail');
    if (list) list.style.display = 'none';
    if (detail) {
        detail.style.display = '';
        detail.innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem;">Loading…</p>';
    }
    const meta = TC_PAGES.find((p) => p.id === page);
    const title = document.getElementById('settings-panel-title');
    if (title)
        title.innerHTML = `${SETTINGS_TITLES.testcentre} <span style="color:var(--text-muted);">·</span> ${meta ? meta.label : ''}`;
    settingsBackTarget = () => renderTestCentreList();
    if (page === 'features') detail.innerHTML = tcPageFeatures();
    else if (page === 'preview') detail.innerHTML = tcPagePreview();
    else if (page === 'emails') detail.innerHTML = tcPageEmails();
    else if (page === 'booking') tcRenderBooking();
    else if (page === 'data') tcRenderData();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}
// ---- Recent features: seed demo data, then a checklist of what to try ----
function tcPageFeatures() {
    const items = [
        [
            'Cottages map &amp; Airbnb-style cards',
            'Preview as guest → Cottages: 2-up cards with big photos, map pins, and a “Guest favourite” badge on the top-rated cottage.',
        ],
        [
            'Weekend pricing',
            'The first cottage gets a +20% Fri/Sat uplift — see it on its page price and the availability calendar.',
        ],
        [
            'Pricing Coach',
            'Settings → Pricing coach: suggestions appear from the seeded bookings, Airbnb/Vrbo blocks and searches (turn-on-weekend, orphan nights, unmet demand, quiet period).',
        ],
        [
            'Cross-channel calendar',
            'The back-office calendar shows the seeded Airbnb/Vrbo bookings, tagged by platform; the Coach counts them too.',
        ],
        [
            'Arrival banner + close button',
            'Open “Test booking → Log in as a test guest”, then the homepage shows the floating arrival window for the seeded current stay — try the × to dismiss it.',
        ],
        [
            'Pinch-zoom, performance, audit fixes',
            'These are global and already live on staging (same code) — no seeding needed.',
        ],
        [
            'WebP images',
            'Settings → Health check → “Optimise photos for faster loading” (needs uploaded photos to convert).',
        ],
    ];
    return `<div class="rate-prop">
                <p style="font-size:0.85rem;color:var(--text-muted);margin:0 0 12px;">Seeds demo data — sample bookings, Airbnb/Vrbo blocks, searches, reviews, GPS pins and a weekend uplift — so you can try everything we've built recently. All of it is tagged and removable in one click via <strong>Test data → Remove all</strong>.</p>
                <button class="btn-glass" style="width:auto;padding:12px 22px;margin-bottom:6px;" onclick="tcSeedFeatures(this)">Seed demo data</button>
                <div id="tc-seed-msg" style="font-size:0.82rem;margin:8px 0 14px;"></div>
                <div class="rule-divider">What to try</div>
                <div class="settings-group">${items
                    .map(
                        ([t, d]) => `
                    <div class="settings-row" style="cursor:default;align-items:flex-start;">
                        <span class="settings-row-main"><span class="settings-row-label">${t}</span><span class="settings-row-sub" style="white-space:normal;">${d}</span></span>
                    </div>`,
                    )
                    .join('')}</div></div>`;
}
async function tcSeedFeatures(btn) {
    const msg = document.getElementById('tc-seed-msg');
    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Seeding…';
    }
    try {
        const r = await apiPost('testcentre.php', { action: 'seed_features' });
        if (msg) {
            if (r.ok) {
                msg.style.color = '#7FD68A';
                msg.innerHTML = `✓ Demo data seeded across ${r.cottages} cottage${r.cottages === 1 ? '' : 's'}. Work through the checklist below — open <strong>Preview as guest</strong> for the public-facing items and <strong>Settings → Pricing coach</strong> for the suggestions.`;
            } else {
                msg.style.color = '#E57373';
                msg.textContent = r.error || 'Seeding failed.';
            }
        }
        // Refresh admin-side data so the calendar/cards reflect it without a reload.
        try {
            await loadData();
        } catch (e) {}
        try {
            await loadRates();
        } catch (e) {}
    } catch (e) {
        if (msg) {
            msg.style.color = '#E57373';
            msg.textContent = 'Could not seed: ' + (e.message || 'error');
        }
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.textContent = 'Seed demo data';
        }
    }
}
// ---- Preview as guest ----
function tcPagePreview() {
    const cottages = liveCottageKeys()
        .map(
            (k) =>
                `<button class="btn-sm btn-edit" style="margin:0 8px 8px 0;" onclick="tcPreview('/cottages/${COTTAGE_SLUGS[k] || k}')">${escapeHtml((propertyMeta[k] || {}).name || k)} ↗</button>`,
        )
        .join('');
    return `<div class="rate-prop">
                <p style="font-size:0.85rem;color:var(--text-muted);margin:0 0 14px;">Opens the real public site in a new tab, rendered exactly as a guest sees it (you stay signed in, but the admin chrome is hidden). Browse anywhere — home, cottages, experiences, the enquiry form — nothing is saved.</p>
                <button class="btn-glass" style="width:auto;padding:12px 22px;margin-bottom:8px;" onclick="tcPreview('index.html')">Open homepage as a guest ↗</button>
                <div class="rule-divider">Jump straight to a cottage page</div>
                ${cottages || '<p style="font-size:0.85rem;color:var(--text-muted);">No live cottages.</p>'}</div>`;
}
function tcPreview(path) {
    const sep = path.indexOf('?') !== -1 ? '&' : '?';
    window.open(path + sep + 'preview=1', '_blank', 'noopener');
}
// ---- Test emails ----
const TC_EMAILS = [
    ['confirmation', 'Booking confirmation'],
    ['arrival', 'Arrival information'],
    ['payment_request', 'Payment request'],
    ['payment_reminder', 'Balance reminder'],
    ['payment_receipt', 'Payment receipt'],
    ['review_request', 'Review request'],
    ['magic_link', 'Sign-in (magic) link'],
    ['refund', 'Refund notice'],
    ['deposit_return', 'Damage deposit return'],
    ['cancellation', 'Booking cancelled'],
    ['owner_notice', 'Owner: payment received'],
];
function tcPageEmails() {
    return `<div class="rate-prop">
                <p style="font-size:0.85rem;color:var(--text-muted);margin:0 0 12px;">Sends real samples to your owner inbox (subject prefixed <strong>[TEST]</strong>) using dummy data, so you can check wording, formatting &amp; delivery.</p>
                <button class="btn-glass" style="width:auto;padding:12px 22px;margin-bottom:12px;" onclick="tcSendEmail('all',this)">Send all samples</button>
                <div id="tc-email-msg" style="font-size:0.82rem;margin-bottom:12px;"></div>
                <div class="settings-group">${TC_EMAILS.map(
                    ([w, l]) => `
                    <div class="settings-row" style="cursor:default;">
                        <span class="settings-row-main"><span class="settings-row-label">${l}</span></span>
                        <button class="btn-sm btn-edit" onclick="tcSendEmail('${w}',this)">Send</button>
                    </div>`,
                ).join('')}</div></div>`;
}
async function tcSendEmail(which, btn) {
    const msg = document.getElementById('tc-email-msg');
    const show = (t, ok) => {
        if (msg) {
            msg.style.color = ok ? '#4CAF50' : '#E57373';
            msg.innerHTML = t;
        }
    };
    let old;
    if (btn) {
        btn.disabled = true;
        old = btn.textContent;
        btn.textContent = 'Sending…';
    }
    show('Sending…', true);
    try {
        const r = await apiPost('testcentre.php', { action: 'send_email', which });
        if (!r.ok) show(r.error || "Couldn't send.", false);
        else if (which === 'all') {
            const fails = (r.results || []).filter((x) => !x.ok);
            show(
                `Sent ${r.sent} sample${r.sent === 1 ? '' : 's'} to ${escapeHtml(r.to || 'your inbox')}${fails.length ? ` · ${fails.length} failed: ${fails.map((f) => escapeHtml(f.label)).join(', ')}` : ''}.`,
                fails.length === 0,
            );
        } else {
            const one = (r.results || [])[0] || {};
            show(
                one.ok
                    ? `Sent ✓ — check ${escapeHtml(r.to || 'your inbox')}.`
                    : one.error || "Couldn't send.",
                !!one.ok,
            );
        }
    } catch (e) {
        show(e.message || "Couldn't send.", false);
    }
    if (btn) {
        btn.disabled = false;
        btn.textContent = old;
    }
}
// ---- Test booking (real flows against a disposable, clearly-flagged booking) ----
async function tcRenderBooking() {
    const detail = document.getElementById('testcentre-detail');
    if (!detail) return;
    detail.innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem;">Loading…</p>';
    let data;
    try {
        data = await apiPost('testcentre.php', { action: 'list_data' });
    } catch (e) {
        detail.innerHTML = `<p style="color:#E57373;">${escapeHtml(e.message || '')}</p>`;
        return;
    }
    tcOwnerEmail = data.owner_email || '';
    tcSquare = data.square || { enabled: false, production: false };
    const bk = data.bookings || [];
    const intro = `<p style="font-size:0.85rem;color:var(--text-muted);margin:0 0 12px;">Creates a real but clearly-flagged booking (unpaid, tagged <strong>[CHB-TEST]</strong>, kept out of your revenue) so you can run the actual pay, email, arrival and daily-automation flows against it — then remove it on the Test data page. Pick dates to match what you want to test:</p>`;
    const sqNote = tcSquare.production
        ? `<div class="email-note" style="border-left:3px solid #E57373;background:rgba(229,115,115,0.08);padding:10px 12px;border-radius:8px;font-size:0.8rem;color:#E57373;margin-bottom:12px;">Square is in <strong>PRODUCTION</strong> mode — paying will make a real charge. Switch to sandbox in config.php to test safely.</div>`
        : tcSquare.enabled
          ? `<p style="font-size:0.78rem;color:var(--text-muted);margin:0 0 12px;">Square is in sandbox — pay flows use test cards, no real money moves.</p>`
          : `<p style="font-size:0.78rem;color:var(--text-muted);margin:0 0 12px;">Square is off — the pay/balance buttons will say so. Emails &amp; arrival still work.</p>`;
    const guestBtn = `<button class="btn-glass" style="width:auto;padding:12px 22px;margin-bottom:14px;" onclick="tcGuestLogin(this)">Log in as a test guest ↗</button>
                <p style="font-size:0.78rem;color:var(--text-muted);margin:-6px 0 14px;">Opens the guest app (My Stays, in-stay hub, arrival reveal, chat) signed in as a test guest. Tip: open in a private window to stay signed in as admin here.</p>`;
    if (!bk.length) {
        detail.innerHTML = `<div class="rate-prop">${intro}${tcPresetButtons()}${sqNote}<div id="tc-bk-msg" style="font-size:0.82rem;margin-top:12px;"></div></div>`;
        return;
    }
    const rows = bk
        .map((b) => {
            const name = (propertyMeta[b.prop_key] || {}).name || b.prop_key;
            return `<div class="accounts-stat" style="max-width:640px;margin-bottom:12px;">
                    <div class="label">${escapeHtml(name)} · #${b.id} <span style="background:#E5533C;color:#fff;font-size:0.6rem;font-weight:700;border-radius:999px;padding:1px 7px;margin-left:6px;">TEST</span></div>
                    <div style="font-size:0.85rem;color:var(--text-muted);margin:4px 0 10px;">${escapeHtml(b.check_in)} → ${escapeHtml(b.check_out)} · ${gbp(b.agreed_total || 0)}</div>
                    <div style="font-size:0.72rem;text-transform:uppercase;letter-spacing:1px;color:var(--text-muted);margin-bottom:6px;">Payments &amp; emails</div>
                    <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px;">
                        <button class="btn-sm btn-edit" onclick="tcPay(${b.id},'deposit',this)">Pay deposit ↗</button>
                        <button class="btn-sm btn-edit" onclick="tcPay(${b.id},'balance',this)">Pay balance ↗</button>
                        <button class="btn-sm btn-edit" onclick="tcBookingEmail(${b.id},'send_confirmation',this)">Email confirmation</button>
                        <button class="btn-sm btn-edit" onclick="tcBookingEmail(${b.id},'send_arrival',this)">Email arrival info</button>
                        <button class="btn-sm btn-edit" onclick="tcBookingEmail(${b.id},'request_payment',this)">Email payment request</button>
                    </div>
                    <div style="font-size:0.72rem;text-transform:uppercase;letter-spacing:1px;color:var(--text-muted);margin-bottom:6px;">Daily automations (run now, as the cron would)</div>
                    <div style="display:flex;flex-wrap:wrap;gap:8px;">
                        <button class="btn-sm btn-edit" onclick="tcAutomation(${b.id},'pre_arrival',this)">Pre-arrival email</button>
                        <button class="btn-sm btn-edit" onclick="tcAutomation(${b.id},'balance_reminder',this)">Balance reminder</button>
                        <button class="btn-sm btn-edit" onclick="tcAutomation(${b.id},'review',this)">Review request</button>
                        <button class="btn-sm btn-edit" style="color:#E57373;border-color:rgba(229,115,115,0.4);" onclick="tcDeleteBooking(${b.id})">Delete</button>
                    </div></div>`;
        })
        .join('');
    detail.innerHTML = `<div class="rate-prop">${intro}${sqNote}${guestBtn}${rows}
                <div class="rule-divider">Create another</div>${tcPresetButtons()}
                <div id="tc-bk-msg" style="font-size:0.82rem;margin-top:12px;"></div></div>`;
}
// Date presets so the owner can target date-gated features (mid-stay hub,
// pre-arrival, post-stay review) — not just a far-future booking.
function tcPresetButtons() {
    return `<div style="display:flex;flex-wrap:wrap;gap:8px;">
                <button class="btn-sm btn-edit" onclick="tcCreateBooking('midstay',this)">Arriving today (mid-stay)</button>
                <button class="btn-sm btn-edit" onclick="tcCreateBooking('prearrival',this)">Pre-arrival (in 3 days)</button>
                <button class="btn-sm btn-edit" onclick="tcCreateBooking('past',this)">Past stay (for review)</button>
                <button class="btn-sm btn-edit" onclick="tcCreateBooking('future',this)">Future (+30 days)</button>
            </div>`;
}
async function tcCreateBooking(preset, btn) {
    const msg = document.getElementById('tc-bk-msg');
    const show = (t, ok) => {
        if (msg) {
            msg.style.color = ok ? '#4CAF50' : '#E57373';
            msg.textContent = t;
        }
    };
    const key = liveCottageKeys()[0];
    if (!key) {
        show('No live cottage to book against.', false);
        return;
    }
    const d = (n) => {
        const x = new Date();
        x.setDate(x.getDate() + n);
        return x.toISOString().slice(0, 10);
    };
    let ci, co;
    if (preset === 'midstay') {
        ci = d(-1);
        co = d(2);
    } else if (preset === 'prearrival') {
        ci = d(3);
        co = d(6);
    } else if (preset === 'past') {
        ci = d(-5);
        co = d(-2);
    } else {
        ci = d(30);
        co = d(33);
    }
    if (btn) btn.disabled = true;
    show('Creating…', true);
    try {
        const r = await apiPost('bookings.php', {
            action: 'add',
            prop_key: key,
            name: 'TEST — Test Centre',
            email: tcOwnerEmail || '',
            phone: '',
            check_in: ci,
            check_out: co,
            adults: 2,
            children: 0,
            payment: 'unpaid',
            notes: '[CHB-TEST] safe to delete',
            override_clash: true,
        });
        if (r && r.id) {
            show('Created ✓', true);
            tcRenderBooking();
        } else
            show(
                (r && r.error) ||
                    (r && r.clash ? 'Those dates clash — try again.' : "Couldn't create."),
                false,
            );
    } catch (e) {
        show(e.message || "Couldn't create.", false);
    }
    if (btn) btn.disabled = false;
}
async function tcGuestLogin(btn) {
    if (
        !(await glassConfirm(
            'Open the guest app signed in as a test guest?\n\nThis signs THIS browser in as the guest, which ends your admin session here. Tip: open it in a private/incognito window to stay signed in as admin in this one.',
        ))
    )
        return;
    if (btn) btn.disabled = true;
    try {
        const r = await apiPost('testcentre.php', { action: 'guest_login' });
        if (r && r.url) window.open(r.url, '_blank', 'noopener');
        else glassAlert((r && r.error) || "Couldn't set up the test guest.");
    } catch (e) {
        glassAlert(e.message || 'Failed.');
    }
    if (btn) btn.disabled = false;
}
async function tcAutomation(id, which, btn) {
    const msg = document.getElementById('tc-bk-msg');
    const show = (t, ok) => {
        if (msg) {
            msg.style.color = ok ? '#4CAF50' : '#E57373';
            msg.textContent = t;
        }
    };
    let old;
    if (btn) {
        btn.disabled = true;
        old = btn.textContent;
        btn.textContent = 'Running…';
    }
    try {
        const r = await apiPost('testcentre.php', { action: 'run_automation', which, id });
        show(
            r && r.ok
                ? 'Done ✓' + (r.note ? ' — ' + escapeHtml(r.note) : ' — check your inbox.')
                : (r && r.error) || "Couldn't run.",
            !!(r && r.ok),
        );
    } catch (e) {
        show(e.message || "Couldn't run.", false);
    }
    if (btn) {
        btn.disabled = false;
        btn.textContent = old;
    }
}
async function tcPay(id, kind, btn) {
    const msg = document.getElementById('tc-bk-msg');
    const show = (t, ok) => {
        if (msg) {
            msg.style.color = ok ? '#4CAF50' : '#E57373';
            msg.textContent = t;
        }
    };
    if (
        tcSquare &&
        tcSquare.production &&
        !(await glassConfirm(
            'Square is in PRODUCTION (live) mode — paying will make a REAL charge. Continue?',
        ))
    )
        return;
    if (btn) btn.disabled = true;
    try {
        const r = await apiPost('bookings.php', { action: 'pay_link', id, kind });
        if (r && r.url) {
            window.open(r.url, '_blank', 'noopener');
            show('Opened the ' + kind + ' pay page ↗', true);
        } else show((r && r.error) || "Couldn't get the pay link.", false);
    } catch (e) {
        show(e.message || 'Square is not available.', false);
    }
    if (btn) btn.disabled = false;
}
async function tcBookingEmail(id, action, btn) {
    const msg = document.getElementById('tc-bk-msg');
    const show = (t, ok) => {
        if (msg) {
            msg.style.color = ok ? '#4CAF50' : '#E57373';
            msg.textContent = t;
        }
    };
    let old;
    if (btn) {
        btn.disabled = true;
        old = btn.textContent;
        btn.textContent = 'Sending…';
    }
    try {
        const r = await apiPost('bookings.php', { action, id, kind: 'deposit' });
        show(
            r && r.ok ? 'Sent ✓ — check your inbox.' : (r && r.error) || "Couldn't send.",
            !!(r && r.ok),
        );
    } catch (e) {
        show(e.message || "Couldn't send.", false);
    }
    if (btn) {
        btn.disabled = false;
        btn.textContent = old;
    }
}
async function tcDeleteBooking(id) {
    if (!(await glassConfirm('Delete this test booking?'))) return;
    try {
        await apiPost('testcentre.php', { action: 'delete_data', type: 'booking', id });
        toast('Test booking deleted.');
        tcRenderBooking();
    } catch (e) {
        glassAlert(e.message || "Couldn't delete.");
    }
}
// ---- Test data (see & remove everything tagged [CHB-TEST]) ----
async function tcRenderData() {
    const detail = document.getElementById('testcentre-detail');
    if (!detail) return;
    detail.innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem;">Loading…</p>';
    let data;
    try {
        data = await apiPost('testcentre.php', { action: 'list_data' });
    } catch (e) {
        detail.innerHTML = `<p style="color:#E57373;">${escapeHtml(e.message || '')}</p>`;
        return;
    }
    const bk = data.bookings || [],
        enq = data.enquiries || [],
        guest = data.guest || null;
    // The test guest only counts as removable data if WE created the account
    // (reusing the owner's real account is left alone).
    const showGuest = guest && guest.created;
    if (!bk.length && !enq.length && !showGuest) {
        detail.innerHTML = `<div class="rate-prop"><p style="font-size:0.95rem;color:var(--text-light);">No test data — you're clean. ✓</p><p style="font-size:0.82rem;color:var(--text-muted);">Anything the Test centre creates shows here for one-tap removal.</p></div>`;
        return;
    }
    const bRows = bk
        .map((b) => {
            const name = (propertyMeta[b.prop_key] || {}).name || b.prop_key;
            return `
                <div class="settings-row" style="cursor:default;">
                    <span class="settings-row-main"><span class="settings-row-label">${escapeHtml(name)} · #${b.id}</span><span class="settings-row-sub">${escapeHtml(b.check_in)} → ${escapeHtml(b.check_out)} · ${gbp(b.agreed_total || 0)}${b.payments ? ` · ${b.payments} payment${b.payments === 1 ? '' : 's'}` : ''}</span></span>
                    <button class="btn-sm btn-edit" style="color:#E57373;border-color:rgba(229,115,115,0.4);" onclick="tcDeleteData('booking',${b.id})">Remove</button>
                </div>`;
        })
        .join('');
    const eRows = enq
        .map(
            (e) => `
                <div class="settings-row" style="cursor:default;">
                    <span class="settings-row-main"><span class="settings-row-label">Enquiry · #${e.id}</span><span class="settings-row-sub">${escapeHtml(e.check_in || '')} → ${escapeHtml(e.check_out || '')}</span></span>
                    <button class="btn-sm btn-edit" style="color:#E57373;border-color:rgba(229,115,115,0.4);" onclick="tcDeleteData('enquiry',${e.id})">Remove</button>
                </div>`,
        )
        .join('');
    const gRows = showGuest
        ? `
                <div class="settings-row" style="cursor:default;">
                    <span class="settings-row-main"><span class="settings-row-label">Test guest account</span><span class="settings-row-sub">${escapeHtml(guest.email || '')}</span></span>
                    <button class="btn-sm btn-edit" style="color:#E57373;border-color:rgba(229,115,115,0.4);" onclick="tcDeleteData('guest',${guest.id})">Remove</button>
                </div>`
        : '';
    const total = bk.length + enq.length + (showGuest ? 1 : 0);
    detail.innerHTML = `<div class="rate-prop">
                <p style="font-size:0.85rem;color:var(--text-muted);margin:0 0 12px;">${total} test record${total === 1 ? '' : 's'}. These never count toward your real revenue.</p>
                ${bk.length ? `<div class="rule-divider">Test bookings</div><div class="settings-group">${bRows}</div>` : ''}
                ${enq.length ? `<div class="rule-divider">Test enquiries</div><div class="settings-group">${eRows}</div>` : ''}
                ${showGuest ? `<div class="rule-divider">Test guest</div><div class="settings-group">${gRows}</div>` : ''}
                <button class="btn-glass" style="width:auto;padding:12px 22px;margin-top:16px;color:#E57373;" onclick="tcPurgeData()">Remove all test data</button></div>`;
}
async function tcDeleteData(type, id) {
    try {
        await apiPost('testcentre.php', { action: 'delete_data', type, id });
        tcRenderData();
    } catch (e) {
        glassAlert(e.message || "Couldn't remove.");
    }
}
async function tcPurgeData() {
    if (
        !(await glassConfirm(
            'Remove ALL test data? This deletes every [CHB-TEST] booking and its payments.',
        ))
    )
        return;
    try {
        await apiPost('testcentre.php', { action: 'purge_data' });
        toast('All test data removed.');
        tcRenderData();
    } catch (e) {
        glassAlert(e.message || "Couldn't purge.");
    }
}
async function sendBroadcast() {
    const subEl = document.getElementById('nl-subject'),
        bodyEl = document.getElementById('nl-body');
    const msg = document.getElementById('nl-send-msg');
    const subject = ((subEl && subEl.value) || '').trim();
    const bodyText = ((bodyEl && bodyEl.value) || '').trim();
    const show = (t, ok) => {
        if (msg) {
            msg.style.color = ok ? '#4CAF50' : '#E57373';
            msg.textContent = t;
        }
    };
    if (!subject || !bodyText) {
        show('A subject and a message are both required.', false);
        return;
    }
    if (!(await glassConfirm('Send this to all active subscribers now?'))) return;
    show('Sending…', true);
    try {
        const r = await apiPost('newsletter.php', { action: 'broadcast', subject, body: bodyText });
        show(
            `Sent to ${r.sent || 0} subscriber${r.sent === 1 ? '' : 's'}${r.failed ? ` (${r.failed} failed)` : ''}.`,
            true,
        );
        if (r.sent) {
            if (subEl) subEl.value = '';
            if (bodyEl) bodyEl.value = '';
        }
    } catch (e) {
        show(e.message || "Couldn't send the broadcast.", false);
    }
}
async function notifyWaitlist(id) {
    if (!(await glassConfirm('Email this guest that dates may now be available?'))) return;
    try {
        await apiPost('waitlist.php', { action: 'notify', id });
        toast('Guest emailed.');
        loadWaitlist();
    } catch (e) {
        glassAlert("Couldn't send: " + e.message);
    }
}
async function deleteWaitlist(id) {
    if (!(await glassConfirm('Remove this waitlist entry?'))) return;
    try {
        await apiPost('waitlist.php', { action: 'delete', id });
        loadWaitlist();
    } catch (e) {
        glassAlert("Couldn't remove: " + e.message);
    }
}

// ---- Guest photos: admin moderation (Settings → Guest photos) ----
async function loadGuestPhotosAdmin() {
    const wrap = document.getElementById('photos-admin');
    if (!wrap) return;
    wrap.innerHTML = `<p style="font-size:0.85rem;color:var(--text-muted);">Loading…</p>`;
    let rows = [];
    try {
        const r = await apiPost('photos.php', { action: 'list_admin' });
        rows = r.photos || [];
    } catch (e) {
        wrap.innerHTML = `<p style="font-size:0.85rem;color:var(--text-muted);">Couldn't load (run migrate.php?): ${escapeHtml(e.message || '')}</p>`;
        return;
    }
    if (!rows.length) {
        wrap.innerHTML = `<p style="font-size:0.85rem;color:var(--text-muted);">No guest photos yet. They'll appear here when guests share photos from My Bookings.</p>`;
        return;
    }
    wrap.innerHTML = `<div class="guest-photo-grid" style="grid-template-columns:repeat(auto-fill,minmax(180px,1fr));">${rows
        .map((p) => {
            const meta = propertyMeta[p.prop_key] || { name: p.prop_key };
            const pend = p.status === 'pending';
            const data = encodeURIComponent(p.url) + '|' + encodeURIComponent(p.caption || '');
            return `<div style="background:var(--glass-bg);border:1px solid var(--glass-border);border-radius:14px;overflow:hidden;">
                    <div class="guest-photo" style="aspect-ratio:4/3;border:none;border-radius:0;" data-photo="${escapeHtml(data)}" onclick="openPhotoLightbox(this)"><img loading="lazy" src="${escapeHtml(p.url)}" alt="${escapeHtml(p.caption || 'Guest photo at ' + (meta.name || p.prop_key))}"></div>
                    <div style="padding:9px 11px;">
                        <div style="font-size:0.74rem;color:var(--text-muted);"><span class="prop-tag tag-${p.prop_key}">${escapeHtml(meta.short || meta.name)}</span> ${escapeHtml(p.guest_name || 'Guest')}${pend ? ' · <span style="color:#FFB74D;">Pending</span>' : ' · <span style="color:#4CAF50;">Live</span>'}</div>
                        ${p.caption ? `<div style="font-size:0.8rem;margin:6px 0 0;">${escapeHtml(p.caption)}</div>` : ''}
                        <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;">
                            ${pend ? `<button class="btn-sm btn-edit" onclick="moderatePhoto(${p.id},'approve')">Approve</button>` : ''}
                            ${pend ? `<button class="btn-sm btn-delete" onclick="moderatePhoto(${p.id},'reject')">Reject</button>` : ''}
                            <button class="btn-sm btn-delete" onclick="moderatePhoto(${p.id},'delete')">Delete</button>
                        </div>
                    </div></div>`;
        })
        .join('')}</div>`;
}
async function moderatePhoto(id, action) {
    if (action === 'delete' && !(await glassConfirm('Delete this photo permanently?'))) return;
    try {
        await apiPost('photos.php', { action, id });
        loadGuestPhotosAdmin();
        try {
            refreshModerationCounts();
        } catch (e2) {}
    } catch (e) {
        glassAlert("Couldn't update: " + (e.message || e));
    }
}
// Populate the Google review link field from saved content.
function initGoogleReviewUrl() {
    const el = document.getElementById('google-review-url-input');
    if (el) el.value = (siteContent && siteContent['google-review-url']) || '';
    const msg = document.getElementById('google-review-url-msg');
    if (msg) msg.textContent = '';
}
async function saveGoogleReviewUrl() {
    const el = document.getElementById('google-review-url-input');
    const msg = document.getElementById('google-review-url-msg');
    const val = ((el && el.value) || '').trim();
    await saveContent('google-review-url', val);
    siteContent['google-review-url'] = val;
    if (msg) {
        msg.style.color = '#4CAF50';
        msg.textContent = val ? 'Saved ✓' : 'Cleared.';
    }
}
async function loadGuestReviewModeration() {
    initGoogleReviewUrl();
    // Set up the "import reviews from Airbnb & other sites" tools (always —
    // independent of whether there are on-site reviews to moderate).
    fillReviewImportControls();
    renderReviewsEditor();
    const wrap = document.getElementById('guest-review-moderation');
    if (!wrap) return;
    let rows = [];
    try {
        const r = await apiPost('reviews.php', { action: 'list_admin' });
        rows = r.reviews || [];
    } catch (e) {
        wrap.innerHTML = `<p style="font-size:0.85rem;color:var(--text-muted);">Couldn't load (run migration-guest-reviews.sql?): ${escapeHtml(e.message)}</p>`;
        return;
    }
    if (!rows.length) {
        wrap.innerHTML = `<p style="font-size:0.85rem;color:var(--text-muted);">No guest reviews yet.</p>`;
        return;
    }

    const stars = (n) => '★'.repeat(Math.max(1, Math.min(5, parseInt(n) || 5)));
    const pending = rows.filter((r) => r.status === 'pending');

    // Pending reviews — shown in full, since these need your decision.
    const pendingHtml = pending.length
        ? pending
              .map(
                  (r) => `
                <div style="border:1px solid var(--glass-border);border-radius:14px;padding:14px;margin-bottom:10px;background:var(--glass-bg);">
                    <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;font-size:0.82rem;">
                        <strong>${escapeHtml(r.name)}</strong>
                        <span style="color:var(--text-muted);">${escapeHtml((propertyMeta[r.prop_key] || {}).name || r.prop_key)}</span>
                        <span style="color:#d6a785;">${stars(r.stars)}</span>
                        <span style="color:#FFA726;">pending</span>
                    </div>
                    <div style="font-size:0.88rem;color:var(--text-muted);margin:8px 0;font-style:italic;">“${escapeHtml(r.review_text)}”</div>
                    <div style="display:flex;gap:8px;">
                        <button class="btn-sm btn-edit" onclick="setReviewStatus(${r.id},'approved')">Approve</button>
                        <button class="btn-sm btn-edit" onclick="setReviewStatus(${r.id},'declined')">Decline</button>
                        <button class="btn-sm btn-delete" onclick="deleteGuestReview(${r.id})">Delete</button>
                    </div>
                </div>`,
              )
              .join('')
        : `<p style="font-size:0.85rem;color:var(--text-muted);"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M8.5 12.5l2.5 2.5 4.5-5"/></svg> No reviews waiting — you're all caught up.</p>`;

    // Only reviews awaiting a decision are shown here. Approved reviews appear
    // on the public site; declined ones are simply hidden.
    wrap.innerHTML = pendingHtml;
}
async function setReviewStatus(id, status) {
    try {
        await apiPost('reviews.php', { action: 'set_status', id, status });
        await loadGuestReviewModeration();
        try {
            refreshModerationCounts();
        } catch (e2) {}
        await loadPublicReviews();
        renderReviews(); // refresh the public section
    } catch (e) {
        glassAlert("Couldn't update: " + e.message);
    }
}
async function deleteGuestReview(id) {
    if (!(await glassConfirm('Delete this guest review permanently?'))) return;
    try {
        await apiPost('reviews.php', { action: 'delete', id });
        await loadGuestReviewModeration();
        await loadPublicReviews();
        renderReviews();
    } catch (e) {
        glassAlert("Couldn't delete: " + e.message);
    }
}
function addReviewRow() {
    const wrap = document.getElementById('reviews-editor');
    if (wrap) wrap.insertAdjacentHTML('beforeend', reviewRowHtml(null));
}
// Populate the bulk-import dropdowns (cottages are dynamic, so build at open).
// Source defaults to Airbnb — the common case for a one-time import.
function fillReviewImportControls() {
    const propSel = document.getElementById('bulk-rev-prop');
    if (propSel)
        propSel.innerHTML =
            '<option value="">(no cottage)</option>' +
            Object.keys(propertyMeta)
                .map((k) => `<option value="${k}">${escapeHtml(propertyMeta[k].name)}</option>`)
                .join('');
    const srcSel = document.getElementById('bulk-rev-source');
    if (srcSel)
        srcSel.innerHTML = ['Airbnb', 'Vrbo', 'Booking.com', 'Google', 'Email', 'Guestbook', '']
            .map(
                (s) =>
                    `<option value="${s}" ${s === 'Airbnb' ? 'selected' : ''}>${s || '(no source)'}</option>`,
            )
            .join('');
    const starSel = document.getElementById('bulk-rev-stars');
    if (starSel)
        starSel.innerHTML = [5, 4, 3]
            .map((n) => `<option value="${n}">${'★'.repeat(n)}</option>`)
            .join('');
}
// One-time bulk import: parse pasted reviews (one per blank-line-separated block)
// into editable rows in #reviews-editor. Forgiving by design — the owner reviews
// every row before saving, so we favour "add something sensible" over strictness.
//   • A line that's only ★ chars or "5 stars" / "5/5" sets that review's rating.
//   • A standalone date / "2 weeks ago" / "Reviewed…" line is dropped.
//   • First remaining line → name, the rest → the review text.
//   • A single-line block becomes the review text with a blank name to fill in.
function bulkImportReviews() {
    const ta = document.getElementById('bulk-rev-text');
    const raw = ((ta && ta.value) || '').trim();
    if (!raw) {
        glassAlert('Paste your reviews into the box first.');
        return;
    }
    const prop = (document.getElementById('bulk-rev-prop') || {}).value || '';
    const source = (document.getElementById('bulk-rev-source') || {}).value || '';
    const defStars = parseInt((document.getElementById('bulk-rev-stars') || {}).value) || 5;
    const wrap = document.getElementById('reviews-editor');
    if (!wrap) return;

    const isStarLine = (l) =>
        /^[★☆\s]*★[★☆\s]*$/.test(l) || /^\s*[1-5]\s*(?:\/\s*5|stars?|★)/i.test(l);
    const starsFrom = (l) => {
        const c = (l.match(/★/g) || []).length;
        if (c) return c;
        const m = l.match(/[1-5]/);
        return m ? parseInt(m[0]) : defStars;
    };
    // A month only counts as a DATE when paired with a number (year or day) — so
    // real names like "Mark", "May", "April", "June" or "Janet" are NOT dropped.
    const MONTH =
        '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
    const monthYear = new RegExp('^\\s*' + MONTH + '\\.?\\s+\\d{4}\\s*$', 'i'); // "October 2024"
    const dayMonth = new RegExp(
        '^\\s*\\d{1,2}(?:st|nd|rd|th)?\\s+' + MONTH + '(?:\\.?\\s+\\d{4})?\\s*$',
        'i',
    ); // "12 May", "2 March 2024"
    const isMetaLine = (l) =>
        monthYear.test(l) ||
        dayMonth.test(l) ||
        /^\s*\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4}\s*$/.test(l) || // 12/05/2024
        /\b(?:days?|weeks?|months?|years?)\s+ago\b/i.test(l) || // "2 weeks ago"
        /^\s*(?:reviewed|stayed|response from)\b/i.test(l); // dashboard chrome

    const blocks = raw
        .split(/\n\s*\n+/)
        .map((b) => b.trim())
        .filter(Boolean);
    let added = 0;
    for (const block of blocks) {
        let lines = block
            .split('\n')
            .map((l) => l.trim())
            .filter(Boolean);
        let stars = defStars;
        const si = lines.findIndex(isStarLine);
        if (si !== -1) {
            stars = starsFrom(lines[si]);
            lines.splice(si, 1);
        }
        stars = Math.max(3, Math.min(5, stars)); // the row editor only offers 3–5
        lines = lines.filter((l) => !isMetaLine(l));
        if (!lines.length) continue;
        let name = '',
            text = '';
        if (lines.length === 1) {
            text = lines[0];
        } else {
            name = lines[0].replace(/[\s:\-–—]+$/, '').slice(0, 80);
            text = lines.slice(1).join(' ');
        }
        text = text.trim();
        if (!text) continue;
        wrap.insertAdjacentHTML('beforeend', reviewRowHtml({ name, stars, text, prop, source }));
        added++;
    }
    if (!added) {
        glassAlert(
            "Couldn't find any reviews to add — check the format: the guest's name on the first line, their review underneath, and a blank line between each one.",
        );
        return;
    }
    ta.value = '';
    toast(
        added +
            ' review' +
            (added === 1 ? '' : 's') +
            ' added below — check them over, then “Save imported reviews”.',
    );
    wrap.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
// Quick-add helper: build a review from the compact form, drop it into the
// editor as a new row, then clear the form ready for the next one.
function quickAddReview() {
    const text = (document.getElementById('qa-text').value || '').trim();
    if (!text) {
        glassAlert('Please paste the review text first.');
        return;
    }
    const r = {
        name: (document.getElementById('qa-name').value || '').trim(),
        stars: parseInt(document.getElementById('qa-stars').value) || 5,
        prop: document.getElementById('qa-prop').value || '',
        source: document.getElementById('qa-source').value || '',
        text,
    };
    const wrap = document.getElementById('reviews-editor');
    if (wrap) wrap.insertAdjacentHTML('beforeend', reviewRowHtml(r));
    // Clear the form for the next entry
    document.getElementById('qa-name').value = '';
    document.getElementById('qa-stars').value = '5';
    document.getElementById('qa-prop').value = '';
    document.getElementById('qa-source').value = '';
    document.getElementById('qa-text').value = '';
    document.getElementById('qa-name').focus();
}
async function saveReviews() {
    const wrap = document.getElementById('reviews-editor');
    if (!wrap) return;
    const reviews = [];
    for (const row of wrap.querySelectorAll('.review-row')) {
        const get = (f) => {
            const el = row.querySelector(`[data-rf="${f}"]`);
            return el ? el.value : '';
        };
        const text = get('text').trim();
        if (!text) continue; // empty review — skip
        reviews.push({
            name: get('name').trim(),
            stars: parseInt(get('stars')) || 5,
            text,
            prop: get('prop'),
            source: get('source'),
        });
    }
    try {
        await saveContent('reviews', reviews);
        siteContent.reviews = reviews;
        renderReviews();
        toast('Reviews saved.');
    } catch (e) {
        glassAlert("Couldn't save reviews: " + e.message);
    }
}

// ---- Seasonal rates editor (Settings) ----
function seasonRowHtml(k, s) {
    s = s || { label: '', start_date: '', end_date: '', couple_rate: '' };
    return `<div class="season-row" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:8px;">
                <input type="text" class="input-glass field-sm" placeholder="Label (e.g. Summer peak)" value="${escapeHtml(s.label || '')}" data-sf="label" style="flex:1 1 150px;min-width:120px;">
                <input type="date" class="input-glass field-sm" value="${s.start_date || ''}" data-sf="start">
                <input type="date" class="input-glass field-sm" value="${s.end_date || ''}" data-sf="end">
                <input type="number" class="input-glass field-sm" min="1" step="1" placeholder="£/night" value="${s.couple_rate || ''}" data-sf="rate" title="Couple rate per night" style="width:90px;">
                <button class="btn-sm btn-delete" onclick="this.closest('.season-row').remove()" title="Remove season"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
            </div>`;
}
function addSeasonRow(k) {
    const wrap = document.getElementById('seasons-' + k);
    if (wrap) wrap.insertAdjacentHTML('beforeend', seasonRowHtml(k, null));
}
// ---- Season grid: every cottage's seasonal pricing on one screen ----
// Rows are date bands (label + start + end) shared across the grid;
// columns are the live cottages. A blank cell means that cottage simply
// has no seasonal rate for that band (its base rate applies).
function seasonGridBands() {
    const bands = new Map();
    liveCottageKeys().forEach((k) =>
        (propertySeasons[k] || []).forEach((s) => {
            const key = `${s.start_date}|${s.end_date}|${s.label || ''}`;
            if (!bands.has(key))
                bands.set(key, {
                    label: s.label || '',
                    start: s.start_date,
                    end: s.end_date,
                    rates: {},
                });
            bands.get(key).rates[k] = parseFloat(s.couple_rate);
        }),
    );
    return [...bands.values()].sort((a, b) => (a.start || '').localeCompare(b.start || ''));
}
function seasonGridRowHtml(b) {
    const keys = liveCottageKeys();
    return `
                <tr class="sg-band">
                    <td><input type="text" class="input-glass field-sm" value="${escapeHtml(b.label)}" data-sg="label" placeholder="e.g. Summer"></td>
                    <td><input type="date" class="input-glass field-sm" value="${b.start || ''}" data-sg="start"></td>
                    <td><input type="date" class="input-glass field-sm" value="${b.end || ''}" data-sg="end"></td>
                    ${keys.map((k) => `<td><input type="number" class="input-glass field-sm sg-rate" min="0" step="1" placeholder="—" value="${b.rates[k] || ''}" data-sg-prop="${k}" title="${escapeHtml(propertyMeta[k].name)} £/night (couple)"></td>`).join('')}
                    <td><button class="btn-sm btn-delete" onclick="this.closest('tr').remove()" title="Remove this season everywhere"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button></td>
                </tr>`;
}
function renderSeasonGrid() {
    const wrap = document.getElementById('season-grid-wrap');
    if (!wrap) return;
    const keys = liveCottageKeys();
    const bands = seasonGridBands();
    wrap.innerHTML = `
                <div style="overflow-x:auto;">
                <table class="sg-table">
                    <thead><tr>
                        <th style="min-width:120px;">Season</th><th>From</th><th>Until</th>
                        ${keys.map((k) => `<th style="min-width:86px;"><span class="prop-tag tag-${k}">${propertyMeta[k].short}</span></th>`).join('')}
                        <th></th>
                    </tr></thead>
                    <tbody id="season-grid-body">${bands.map(seasonGridRowHtml).join('')}</tbody>
                </table>
                </div>
                <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:14px;">
                    <button class="btn-sm btn-edit" onclick="addSeasonGridRow()">+ Add a season</button>
                    <button class="btn-glass" style="width:auto;padding:11px 24px;" onclick="saveSeasonGrid()">Save all cottages</button>
                    <span id="season-grid-msg" style="font-size:0.82rem;align-self:center;"></span>
                </div>
                <p style="font-size:0.78rem;color:var(--text-muted);margin:12px 0 0;max-width:640px;">Each cell is that cottage's nightly couple rate for the season. Leave a cell blank and the cottage keeps its normal base rate for those dates. Deleting a row removes the season from every cottage when you save.</p>`;
}
function addSeasonGridRow() {
    const body = document.getElementById('season-grid-body');
    if (body)
        body.insertAdjacentHTML(
            'beforeend',
            seasonGridRowHtml({ label: '', start: '', end: '', rates: {} }),
        );
}
async function saveSeasonGrid() {
    const body = document.getElementById('season-grid-body');
    if (!body) return;
    const keys = liveCottageKeys();
    const perProp = {};
    keys.forEach((k) => (perProp[k] = []));
    for (const tr of body.querySelectorAll('tr')) {
        const get = (sel) => {
            const el = tr.querySelector(sel);
            return el ? el.value.trim() : '';
        };
        const label = get('[data-sg="label"]'),
            start = get('[data-sg="start"]'),
            end = get('[data-sg="end"]');
        const rates = keys.map((k) => {
            const el = tr.querySelector(`[data-sg-prop="${k}"]`);
            return { k, rate: el ? parseFloat(el.value) || 0 : 0 };
        });
        if (!start && !end && !label && rates.every((r) => !r.rate)) continue; // fully empty row
        if (!start || !end) {
            glassAlert(`"${label || 'A season'}" needs both a start and an end date.`);
            return;
        }
        if (end < start) {
            glassAlert(`"${label || 'A season'}" ends before it starts — check the dates.`);
            return;
        }
        rates.forEach(({ k, rate }) => {
            if (rate > 0) perProp[k].push({ label, start, end, rate });
        });
    }
    const msg = document.getElementById('season-grid-msg');
    try {
        for (const k of keys) {
            await apiPost('rates.php', {
                action: 'seasons_save',
                prop_key: k,
                seasons: perProp[k],
            });
            propertySeasons[k] = perProp[k].map((s) => ({
                label: s.label,
                start_date: s.start,
                end_date: s.end,
                couple_rate: s.rate,
            }));
        }
        renderCardPrices();
        updatePropPriceHeading();
        if (msg) {
            msg.textContent = 'Saved for all cottages ✓';
            msg.style.color = 'var(--ok-text)';
            setTimeout(() => {
                msg.textContent = '';
            }, 4000);
        }
        toast('Seasonal rates saved for all cottages.');
    } catch (e) {
        glassAlert("Couldn't save: " + e.message);
    }
}
// ---- Dashboard: warn the owner if the daily automation has stopped ----
// Reads cron-status.php (stamped by cron.php on every real run). Only the
// banner appears, and only when things are genuinely quiet, so a healthy
// site shows nothing.
async function checkCronHealth() {
    const el = document.getElementById('cron-alert');
    if (!el) return;
    let d;
    try {
        d = await apiGet('cron-status.php');
    } catch (e) {
        el.style.display = 'none';
        return;
    }
    if (!d || !d.stale) {
        el.style.display = 'none';
        return;
    }
    const detail = d.everRan
        ? `last ran ${d.ageHours >= 48 ? Math.round(d.ageHours / 24) + ' days' : Math.round(d.ageHours) + ' hours'} ago`
        : 'it has never run';
    el.innerHTML = `
                <svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>
                <div>
                    <strong>Your daily automation looks stopped</strong> — ${detail}. While it's off, pre-arrival emails, balance reminders, guest re-invites and weekly backups won't send.
                    <div style="margin-top:6px;font-size:0.85rem;">Check the scheduled task at your host still points at <code>cron.php</code>, then open <a onclick="nav('view-settings'); settingsOpen('diagnostics');" style="cursor:pointer;text-decoration:underline;">Health check</a>.</div>
                </div>`;
    el.style.display = '';
}
// ---- Dashboard: recent-activity feed ----
function timeAgoLabel(at) {
    try {
        const d = new Date(String(at).replace(' ', 'T'));
        const mins = Math.max(0, Math.round((Date.now() - d.getTime()) / 60000));
        if (mins < 60) return mins <= 1 ? 'just now' : `${mins} min ago`;
        const hrs = Math.round(mins / 60);
        if (hrs < 24) return `${hrs} h ago`;
        const days = Math.round(hrs / 24);
        if (days < 8) return days === 1 ? 'yesterday' : `${days} days ago`;
        return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    } catch (e) {
        return '';
    }
}
const ACTIVITY_ICONS = {
    booking:
        '<rect x="3" y="4.5" width="18" height="16" rx="2.5"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/>',
    payment: '<rect x="2" y="5" width="20" height="14" rx="2.5"/><path d="M2 10h20"/>',
    enquiry: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M4 6.5l8 6 8-6"/>',
    review: '<path d="M12 3.5l2.6 5.27 5.82.85-4.21 4.1.99 5.78L12 17.77 6.8 19.5l.99-5.78-4.21-4.1 5.82-.85z"/>',
    photo: '<rect x="3" y="6" width="18" height="14" rx="2"/><circle cx="12" cy="13" r="3.2"/><path d="M8 6l1.5-2h5L16 6"/>',
    signup: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
    // Owner/admin action categories (activity log)
    content: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
    rates: '<path d="M20 12V8H6a2 2 0 0 1 0-4h12v4"/><path d="M4 6v12a2 2 0 0 0 2 2h14v-4"/><path d="M18 12a2 2 0 0 0 0 4h4v-4z"/>',
    moderation: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/>',
    settings:
        '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
    system: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.66 3.58 3 8 3s8-1.34 8-3V5"/><path d="M4 11v6c0 1.66 3.58 3 8 3s8-1.34 8-3v-6"/>',
    account: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-1a6 6 0 0 1 12 0v1"/>',
    comms: '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>',
    calendar: '<rect x="3" y="4.5" width="18" height="16" rx="2.5"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/><path d="M8.5 14.5l2 2 4-4"/>',
    media: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9" r="1.6"/><path d="M21 16l-5-5L5 20"/>',
    other: '<circle cx="12" cy="12" r="9"/><path d="M12 8h.01M11 12h1v4h1"/>',
};
async function loadActivityFeed() {
    const el = document.getElementById('bo-activity');
    if (!el) return;
    let events = [];
    try {
        const r = await apiPost('activity.php', { action: 'recent' });
        events = r.events || [];
    } catch (e) {
        el.innerHTML = '';
        return;
    }
    // Always offer the "View full log" entry point, even with no recent business events.
    const header = `
                <h2 style="font-family:var(--font-serif);font-size:1.3rem;font-weight:400;margin:26px 0 12px;display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;">
                    Recent activity
                    <a class="act-full-link" onclick="nav('view-activity-log')">View full log →</a>
                </h2>`;
    if (!events.length) {
        el.innerHTML = header;
        return;
    }
    el.innerHTML =
        header +
        `
                <div class="feed-list glass-panel" style="padding:6px 16px;">
                    ${events
                        .map(
                            (ev) => `
                    <div class="act-row">
                        <span class="act-ic"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ACTIVITY_ICONS[ev.type] || ACTIVITY_ICONS.booking}</svg></span>
                        ${ev.prop_key && propertyMeta[ev.prop_key] ? `<span class="prop-tag tag-${ev.prop_key}">${propertyMeta[ev.prop_key].short}</span>` : ''}
                        <span class="act-label">${escapeHtml(ev.label)}</span>
                        <span class="act-detail">${escapeHtml(ev.detail || '')}</span>
                        <span class="act-when">${timeAgoLabel(ev.at)}</span>
                    </div>`,
                        )
                        .join('')}
                </div>`;
}

// ---- Full activity log page (view-activity-log) ----
const ACT_LOG_CATS = [
    ['all', 'All'],
    ['attention', '⚠ Needs attention'],
    ['booking', 'Bookings'],
    ['payment', 'Payments'],
    ['comms', 'Messages & email'],
    ['enquiry', 'Enquiries'],
    ['moderation', 'Moderation'],
    ['content', 'Content'],
    ['rates', 'Rates'],
    ['calendar', 'Calendar'],
    ['media', 'Media'],
    ['settings', 'Settings'],
    ['system', 'System'],
    ['account', 'Account'],
];
const activityLogState = { category: 'all', q: '' };
let __actLogSearchTimer = null;
function actorLabel(a) {
    if (a === 'owner') return 'You';
    if (a === 'cron') return 'Automatic';
    if (a === 'system') return 'System';
    if (a && a.indexOf('guest') === 0) return 'Guest';
    return a || '';
}
async function renderActivityLog() {
    const list = document.getElementById('act-log-list');
    const filters = document.getElementById('act-log-filters');
    if (!list) return;
    if (filters)
        filters.innerHTML = ACT_LOG_CATS.map(
            ([k, label]) =>
                `<button type="button" class="act-log-chip${activityLogState.category === k ? ' active' : ''}" onclick="activityLogFilter('${k}')">${label}</button>`,
        ).join('');
    list.innerHTML = `<div class="act-log-empty">Loading…</div>`;
    let events = [];
    try {
        const r = await apiPost('activity-log.php', {
            action: 'list',
            category: activityLogState.category,
            q: activityLogState.q,
            limit: 250,
        });
        events = r.events || [];
    } catch (e) {
        list.innerHTML = `<div class="act-log-empty">Couldn't load the activity log.</div>`;
        return;
    }
    if (!events.length) {
        list.innerHTML = `<div class="act-log-empty">No matching activity yet.</div>`;
        return;
    }
    list.innerHTML = `
                <div class="feed-list glass-panel" style="padding:6px 16px;">
                    ${events
                        .map((ev) => {
                            const sev = ev.severity === 'warn' || ev.severity === 'action' ? ev.severity : '';
                            const propTag =
                                ev.prop_key && propertyMeta[ev.prop_key]
                                    ? `<span class="prop-tag tag-${ev.prop_key}">${propertyMeta[ev.prop_key].short}</span>`
                                    : '';
                            const badge =
                                sev === 'action'
                                    ? '<span class="act-sev act-sev--action">Action</span>'
                                    : sev === 'warn'
                                      ? '<span class="act-sev act-sev--warn">Check</span>'
                                      : '';
                            const actor =
                                ev.actor && ev.actor !== 'guest'
                                    ? `<span class="act-actor">${escapeHtml(actorLabel(ev.actor))}</span>`
                                    : '';
                            const detail = ev.detail ? `<span>${escapeHtml(ev.detail)}</span>` : '';
                            return `
                    <div class="act-row act-log-row${sev ? ' act-row--' + sev : ''}">
                        <span class="act-ic"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ACTIVITY_ICONS[ev.type] || ACTIVITY_ICONS.other}</svg></span>
                        <div class="act-body">
                            <div class="act-line1">${propTag}<span class="act-label">${escapeHtml(ev.label)}</span>${badge}</div>
                            <div class="act-line2">${detail}${actor}<span class="act-when">${timeAgoLabel(ev.at)}</span></div>
                        </div>
                    </div>`;
                        })
                        .join('')}
                </div>`;
}
function activityLogFilter(cat) {
    activityLogState.category = cat;
    renderActivityLog();
}
function activityLogSearch(v) {
    activityLogState.q = v;
    clearTimeout(__actLogSearchTimer);
    __actLogSearchTimer = setTimeout(renderActivityLog, 250);
}
// ---- Health check: email me a sample of every guest email ----
async function sendSampleEmails(btn) {
    if (
        !(await glassConfirm(
            'Send a [SAMPLE]-marked copy of every guest email (confirmation, arrival info, payment request, receipt, review request…) to your owner inbox?',
        ))
    )
        return;
    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Sending…';
    }
    const out = document.getElementById('diag-samples');
    try {
        const r = await apiPost('email-samples.php', { action: 'send', which: 'all' });
        if (!r.ok) throw new Error(r.error || 'Sending failed');
        if (out)
            out.innerHTML =
                `<div style="margin:10px 0 4px;color:var(--ok-text);">Sent ${r.sent} sample${r.sent === 1 ? '' : 's'} to ${escapeHtml(r.to)} — check your inbox (subjects start with [SAMPLE]).</div>` +
                (r.results || [])
                    .filter((x) => !x.ok)
                    .map(
                        (x) =>
                            `<div style="color:var(--danger);font-size:0.8rem;">${escapeHtml(x.label)}: ${escapeHtml(x.error || 'failed')}</div>`,
                    )
                    .join('');
    } catch (e) {
        if (out)
            out.innerHTML = `<div style="color:var(--danger);margin:10px 0 4px;">Couldn't send samples: ${escapeHtml(e.message)}</div>`;
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.textContent = 'Email me samples';
        }
    }
}
async function saveSeasons(k) {
    const wrap = document.getElementById('seasons-' + k);
    if (!wrap) return;
    const seasons = [];
    for (const row of wrap.querySelectorAll('.season-row')) {
        const get = (f) => {
            const el = row.querySelector(`[data-sf="${f}"]`);
            return el ? el.value.trim() : '';
        };
        const label = get('label'),
            start = get('start'),
            end = get('end'),
            rate = parseFloat(get('rate'));
        if (!start && !end && !rate && !label) continue; // fully empty row — skip
        if (!start || !end || !(rate > 0)) {
            glassAlert('Each season needs a start date, an end date and a couple rate above £0.');
            return;
        }
        if (end < start) {
            glassAlert(`"${label || 'A season'}" ends before it starts — check the dates.`);
            return;
        }
        seasons.push({ label, start, end, rate });
    }
    try {
        await apiPost('rates.php', { action: 'seasons_save', prop_key: k, seasons });
        // Refresh local copy so prices use the new seasons immediately
        propertySeasons[k] = seasons.map((s) => ({
            label: s.label,
            start_date: s.start,
            end_date: s.end,
            couple_rate: s.rate,
        }));
        renderCardPrices();
        updatePropPriceHeading();
        toast('Seasonal rates saved.');
    } catch (e) {
        glassAlert("Couldn't save seasons: " + e.message);
    }
}

// Map front-end camelCase rate fields to backend snake_case columns
const RATE_FIELD_MAP = {
    coupleRate: 'couple_rate',
    extraAdultRate: 'extra_adult_rate',
    childRate: 'child_rate',
    damagesDeposit: 'booking_fee',
    transactionPct: 'transaction_pct',
    weekendPct: 'weekend_pct',
    address: 'address',
};
async function saveRateField(propKey, field, value) {
    const col = RATE_FIELD_MAP[field];
    if (!col) return;
    try {
        await apiPost('rates.php', { action: 'save', prop_key: propKey, [col]: value });
    } catch (e) {
        glassAlert("Couldn't save rate: " + e.message);
    }
}

async function updateRate(propKey, field, value) {
    const num = Math.max(0, parseFloat(value) || 0);
    if (!propertyRates[propKey]) propertyRates[propKey] = Object.assign({}, defaultRates[propKey]);
    propertyRates[propKey][field] = num; // instant UI update
    renderCalendar();
    renderCardPrices();
    updatePropPriceHeading();
    await saveRateField(propKey, field, num); // persist to backend
}

async function updateRateText(propKey, field, value) {
    if (!propertyRates[propKey]) propertyRates[propKey] = Object.assign({}, defaultRates[propKey]);
    propertyRates[propKey][field] = value;
    await saveRateField(propKey, field, value);
}

// ---- Booking rules (times, min nights, arrival days) — stored in content ----
function updateRuleField(propKey, field, value) {
    if (!propertyRates[propKey]) propertyRates[propKey] = Object.assign({}, defaultRates[propKey]);
    if (field === 'minNights') value = Math.max(1, parseInt(value, 10) || 1);
    if (field === 'maxNights') value = Math.max(0, parseInt(value, 10) || 0);
    propertyRates[propKey][field] = value;
    saveRules(propKey);
}

function toggleArrivalDay(propKey, dayIndex, checked) {
    if (!propertyRates[propKey]) propertyRates[propKey] = Object.assign({}, defaultRates[propKey]);
    let days = Array.isArray(propertyRates[propKey].arrivalDays)
        ? propertyRates[propKey].arrivalDays.slice()
        : [];
    if (checked) {
        if (!days.includes(dayIndex)) days.push(dayIndex);
    } else {
        days = days.filter((d) => d !== dayIndex);
    }
    days.sort((a, b) => a - b);
    propertyRates[propKey].arrivalDays = days;
    saveRules(propKey);
}

function saveRules(propKey) {
    const r = propertyRates[propKey] || {};
    const rules = {
        checkInTime: r.checkInTime || '15:00',
        checkOutTime: r.checkOutTime || '10:00',
        minNights: Math.max(1, parseInt(r.minNights, 10) || 1),
        maxNights: Math.max(0, parseInt(r.maxNights, 10) || 0),
        arrivalDays: Array.isArray(r.arrivalDays) ? r.arrivalDays.slice() : [],
    };
    try {
        localStorage.setItem('rules-' + propKey, JSON.stringify(rules));
    } catch (e) {}
    saveContent('rules-' + propKey, rules);
}

// Star rating + review count on each cottage listing card (social proof at
// the point of choosing). Shows "New" until a cottage has approved reviews.
function renderCardRatings() {
    let all = [];
    try {
        all = typeof allReviews === 'function' ? allReviews() : [];
    } catch (e) {
        all = [];
    }
    Object.keys(propertyRates || {}).forEach((k) => {
        const fav = document.getElementById('cott-fav-' + k);
        const rs = all.filter((r) => r.prop === k);
        let html;
        if (!rs.length) {
            html = `<span class="cr-new">New — be the first to review</span>`;
            if (fav) fav.hidden = true;
        } else {
            const avg = rs.reduce((s, r) => s + (parseInt(r.stars, 10) || 0), 0) / rs.length;
            html = `<span class="cr-star">★</span> ${avg.toFixed(1)} <span class="cr-count">· ${rs.length} review${rs.length === 1 ? '' : 's'}</span>`;
            // "Guest favourite" badge for highly-rated cottages (Airbnb-style).
            if (fav) fav.hidden = !(rs.length >= 3 && avg >= 4.8);
        }
        // Fill both the cottages-page card and (if present) the homepage card.
        ['card-rating-' + k, 'home-card-rating-' + k].forEach((id) => {
            const el = document.getElementById(id);
            if (el) el.innerHTML = html;
        });
    });
}
// Fill each cottage card with its live "from £[couple rate] / night"
// ---- Live availability on the homepage ----
// One ?all=1 call feeds both the per-card "Next free" chips and the
// late-availability spotlight, so the cards read as live inventory and
// soon-expiring gaps sell themselves. Everything here is best-effort.
let publicAllAvailability = null;
async function loadPublicAvailability() {
    try {
        const r = await apiGet('availability.php?all=1');
        publicAllAvailability = r.props || null;
    } catch (e) {
        publicAllAvailability = null;
    }
    try {
        renderCardAvailability();
    } catch (e) {}
    try {
        renderLateAvailability();
    } catch (e) {}
}
// Free runs of at least minNights within the next `days`, from blocked
// ranges (end-exclusive, matching availability.php). Returns
// [{start, end (checkout), nights}] in date order.
function freeGaps(ranges, days, minNights) {
    const t0 = dpParse(todayDashed());
    const blocked = new Set();
    (ranges || []).forEach((r) => {
        for (
            let d = dpParse(r.start), end = dpParse(r.end);
            d < end;
            d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)
        ) {
            blocked.add(formatDashed(d));
        }
    });
    const gaps = [];
    let run = null;
    for (let i = 0; i < days; i++) {
        const d = new Date(t0.getFullYear(), t0.getMonth(), t0.getDate() + i);
        if (!blocked.has(formatDashed(d))) {
            if (!run) run = { start: formatDashed(d), nights: 0 };
            run.nights++;
            run.end = formatDashed(new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1));
        } else if (run) {
            if (run.nights >= minNights) gaps.push(run);
            run = null;
        }
    }
    if (run && run.nights >= minNights) gaps.push(run);
    return gaps;
}
function renderCardAvailability() {
    if (!publicAllAvailability) return;
    const today = todayDashed();
    liveCottageKeys().forEach((k) => {
        if (!(k in publicAllAvailability)) return;
        const minN = Math.max(1, (propertyRates[k] && propertyRates[k].minNights) || 1);
        const gaps = freeGaps(publicAllAvailability[k], 60, minN);
        let html = '';
        if (gaps.length) {
            const g = gaps[0];
            const soon =
                g.start <=
                formatDashed(
                    new Date(
                        dpParse(today).getFullYear(),
                        dpParse(today).getMonth(),
                        dpParse(today).getDate() + 2,
                    ),
                );
            html = soon
                ? `<span class="avail-chip now"><span class="dot"></span>Available now</span>`
                : `<span class="avail-chip"><span class="dot"></span>Next free: ${dpPretty(g.start)}</span>`;
        }
        ['card-avail-' + k, 'home-card-avail-' + k].forEach((id) => {
            const el = document.getElementById(id);
            if (el) el.innerHTML = html;
        });
    });
}
// The soonest decent gap across all cottages in the next fortnight —
// dates that otherwise quietly expire. Hidden when there's nothing.
function renderLateAvailability() {
    const el = document.getElementById('late-avail');
    if (!el) return;
    if (!publicAllAvailability) {
        el.innerHTML = '';
        return;
    }
    let best = null;
    liveCottageKeys().forEach((k) => {
        if (!(k in publicAllAvailability)) return;
        const minN = Math.max(2, (propertyRates[k] && propertyRates[k].minNights) || 1);
        const g = freeGaps(publicAllAvailability[k], 14, minN)[0];
        if (
            g &&
            (!best ||
                g.start < best.g.start ||
                (g.start === best.g.start && g.nights > best.g.nights))
        )
            best = { k, g };
    });
    if (!best) {
        el.innerHTML = '';
        return;
    }
    const name = (propertyMeta[best.k] && propertyMeta[best.k].name) || best.k;
    const nights = Math.min(best.g.nights, 7);
    const co = formatDashed(
        new Date(
            dpParse(best.g.start).getFullYear(),
            dpParse(best.g.start).getMonth(),
            dpParse(best.g.start).getDate() + nights,
        ),
    );
    el.innerHTML = `<div class="late-avail">
                <svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="color:var(--accent);flex-shrink:0;"><rect x="3" y="4.5" width="18" height="16" rx="2.5"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/></svg>
                <span>Late availability — <strong>${escapeHtml(name)}</strong> is free ${dpPretty(best.g.start)} to ${dpPretty(co)}</span>
                <button type="button" class="btn-sm btn-edit" onclick="startBooking('${best.k}','${best.g.start}','${co}')">Check dates</button>
            </div>`;
}
// Card photos settle in gently once each image has actually loaded —
// otherwise big bg-image jpgs pop in abruptly on real connections.
// Images that fail (or a dead JS path) still show via the 2.5s fallback.
function fadeInCardImages(root) {
    (root || document)
        .querySelectorAll('.card-img[style*="background-image"]:not(.img-fade)')
        .forEach((el) => {
            const m = /url\(['"]?([^'")]+)['"]?\)/.exec(el.style.backgroundImage || '');
            if (!m) return;
            el.classList.add('img-fade');
            const done = () => el.classList.add('img-in');
            const img = new Image();
            img.onload = done;
            img.onerror = done;
            img.src = m[1];
            if (img.complete) done();
            setTimeout(done, 2500);
        });
}
function renderCardPrices() {
    Object.keys(propertyRates).forEach((k) => {
        const html = `from ${gbp(propertyRates[k].coupleRate)} <span>/ night (couple)</span>`;
        ['card-price-' + k, 'home-card-price-' + k].forEach((id) => {
            const el = document.getElementById(id);
            if (el) el.innerHTML = html;
        });
    });
}

// Give cottages the owner has ADDED their own accent colour at runtime (the
// original three keep their hand-tuned colours in app.css). Writes the same
// CSS custom properties + .swatch-/.tag-/.bar- rules the static ones use, so
// legends, tags and calendar bars look right for any number of cottages.
function injectPropColors() {
    try {
        if (!document.head || !document.createElement) return;
        let varRules = '',
            classRules = '';
        (propertyList || []).forEach((p) => {
            const k = p.prop_key;
            if (STATIC_COLOR_KEYS[k]) return; // app.css already styles these
            const a = (propertyMeta[k] && propertyMeta[k].accent) || p.accent || '#8FB3C7';
            varRules += `--prop-${k}:${a};--prop-${k}-bg:${a}22;--prop-${k}-border:${a}55;`;
            classRules +=
                `.swatch-${k}{background:var(--prop-${k}-bg);border:1px solid var(--prop-${k}-border);}` +
                `.tag-${k}{background:var(--prop-${k}-bg);border:1px solid var(--prop-${k}-border);color:var(--prop-${k});}` +
                `.booking-bar.bar-${k}{background:var(--prop-${k}-bg);color:var(--prop-${k});}`;
        });
        let style = document.getElementById('prop-accent-colors');
        if (!style) {
            style = document.createElement('style');
            style.id = 'prop-accent-colors';
            document.head.appendChild(style);
        }
        style.textContent = (varRules ? `:root{${varRules}}` : '') + classRules;
    } catch (e) {
        /* no document head (smoke test) — colours come from app.css */
    }
}

// Rebuild the cottage grid from the live property list so cottages the owner
// ADDS appear and ones they ARCHIVE disappear — without hardcoding three cards.
// The original three keep their legacy data-edit keys (saved card edits survive).
function renderCottageCards() {
    const grid = document.getElementById('cottages');
    if (!grid) return;
    const keys = liveCottageKeys();
    if (!keys.length) return; // never blank the grid if the list hasn't loaded
    const sc = typeof siteContent === 'object' && siteContent ? siteContent : {};
    grid.innerHTML = keys
        .map((k) => {
            const ck = cardKeys(k);
            const slug = COTTAGE_SLUGS[k] || k;
            const img = sc[ck.img] || 'card-' + k + '.jpg';
            const title = sc[ck.title] || (propertyMeta[k] && propertyMeta[k].name) || k;
            const meta = sc[ck.meta] || cottageSleepsLabel(k);
            return `<a class="card glass-panel" data-prop="${k}" href="/cottages/${escapeHtml(slug)}" onclick="return cottageLink(event,'${k}')">
                    <div class="card-img-wrap">
                        <div class="card-img" data-edit-img="${ck.img}" role="img" aria-label="Photo of ${escapeHtml(title)}" style="background-image: url('${escapeHtml(img)}');"></div>
                        <span class="cott-fav" id="cott-fav-${k}" hidden><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 21s-7-4.6-9.3-9C1.4 9 2.7 5.5 6 5.5c2 0 3.2 1.2 4 2.5.8-1.3 2-2.5 4-2.5 3.3 0 4.6 3.5 3.3 6.5C19 16.4 12 21 12 21z"/></svg> Guest favourite</span>
                    </div>
                    <div class="cott-head">
                        <div class="card-title" data-edit-text="${ck.title}">${escapeHtml(title)}</div>
                        <div class="card-rating" id="card-rating-${k}"></div>
                    </div>
                    <div class="card-meta" data-edit-text="${ck.meta}">${escapeHtml(meta)}</div>
                    <div class="card-foot">
                        <div class="card-price" id="card-price-${k}"></div>
                        <div class="card-avail" id="card-avail-${k}"></div>
                    </div>
                </a>`;
        })
        .join('');
    try {
        renderCardPrices();
    } catch (e) {}
    try {
        renderCardRatings();
    } catch (e) {}
    try {
        fadeInCardImages(grid);
    } catch (e) {}
}

// Homepage cottage cards (above the "Check availability" search): SIMPLIFIED
// versions of the cottages-page cards — photo + name + subtitle only, no live
// price / rating / "guest favourite" (so no duplicate ids with #cottages). Same
// data sources as renderCottageCards(); clicking opens the cottage.
function renderHomeCottages() {
    const grid = document.getElementById('home-cottages-grid');
    if (!grid) return;
    const keys = liveCottageKeys();
    if (!keys.length) return; // never blank the static fallback before the list loads
    const sc = typeof siteContent === 'object' && siteContent ? siteContent : {};
    grid.innerHTML = keys
        .map((k) => {
            const ck = cardKeys(k);
            const slug = COTTAGE_SLUGS[k] || k;
            const img = sc[ck.img] || 'card-' + k + '.jpg';
            const title = sc[ck.title] || (propertyMeta[k] && propertyMeta[k].name) || k;
            const meta = sc[ck.meta] || cottageSleepsLabel(k);
            return `<a class="card glass-panel" data-prop="${k}" href="/cottages/${escapeHtml(slug)}" onclick="return cottageLink(event,'${k}')">
                    <div class="card-img-wrap">
                        <div class="card-img" data-edit-img="${ck.img}" role="img" aria-label="Photo of ${escapeHtml(title)}" style="background-image: url('${escapeHtml(img)}');"></div>
                    </div>
                    <div class="cott-head">
                        <div class="card-title" data-edit-text="${ck.title}">${escapeHtml(title)}</div>
                        <div class="card-rating" id="home-card-rating-${k}"></div>
                    </div>
                    <div class="card-meta" data-edit-text="${ck.meta}">${escapeHtml(meta)}</div>
                    <div class="card-foot">
                        <div class="card-price" id="home-card-price-${k}"></div>
                        <div class="card-avail" id="home-card-avail-${k}"></div>
                    </div>
                </a>`;
        })
        .join('');
    try {
        renderCardPrices();
    } catch (e) {}
    try {
        renderCardRatings();
    } catch (e) {}
    try {
        fadeInCardImages(grid);
    } catch (e) {}
}

// Regenerate the page's JSON-LD structured data from the live cottage list so
// search engines see exactly the cottages currently on the site (owner-added
// ones included, removed ones dropped). The rich hand-written fields for the
// original three are preserved by merging onto their existing nodes.
function injectStructuredData() {
    try {
        const script = document.querySelector('script[type="application/ld+json"]');
        if (!script) return;
        const data = JSON.parse(script.textContent);
        const graph = data['@graph'];
        if (!Array.isArray(graph)) return;
        const origin = SITE_ORIGIN;
        const isCottageNode = (n) => /#cottage-/.test((n && n['@id']) || '');
        const existing = {};
        graph.forEach((n) => {
            if (isCottageNode(n)) existing[n['@id']] = n;
        });
        const keys = liveCottageKeys();
        if (!keys.length) return;
        // Point the venue's containsPlace at the live cottages, and keep the
        // advertised room count in step with how many cottages are actually live.
        graph.forEach((n) => {
            if (n && Array.isArray(n.containsPlace))
                n.containsPlace = keys.map((k) => ({ '@id': origin + '/#cottage-' + k }));
            if (n && n.numberOfRooms != null) n.numberOfRooms = keys.length;
        });
        // Replace the per-cottage Accommodation nodes.
        const base = graph.filter((n) => !isCottageNode(n));
        keys.forEach((k) => {
            const id = origin + '/#cottage-' + k;
            const prev = existing[id] || {};
            const meta = propertyMeta[k] || {};
            const lim = occupancyLimits[k] || {};
            const node = Object.assign(
                {
                    '@type': ['Accommodation', 'VacationRental'],
                    '@id': id,
                    image: origin + '/hero.jpg',
                    containedInPlace: { '@type': 'Place', name: 'Blakeney, Norfolk' },
                },
                prev,
                {
                    name: meta.name || k,
                    url: origin + '/cottages/' + (COTTAGE_SLUGS[k] || k),
                    occupancy: {
                        '@type': 'QuantitativeValue',
                        maxValue: lim.maxTotal || lim.maxAdults || 2,
                    },
                },
            );
            delete node.petsAllowed; // no pets allowed — never advertise pet-friendly
            base.push(node);
        });
        data['@graph'] = base;
        script.textContent = JSON.stringify(data, null, 2);
    } catch (e) {
        /* leave the static JSON-LD in place if anything is off */
    }
}

// The price heading at the top of the active property's booking box
function updatePropPriceHeading() {
    const el = document.getElementById('prop-price-heading');
    if (!el) return;
    const r = propertyRates[activeFrontProperty] || defaultRates[activeFrontProperty];
    el.innerText = `From ${gbp(r.coupleRate)} / night`;
}

function changeMonth(dir) {
    calDate.setMonth(calDate.getMonth() + dir);
    renderCalendar();
}

function formatDashed(dateObj) {
    const y = dateObj.getFullYear();
    const m = String(dateObj.getMonth() + 1).padStart(2, '0');
    const d = String(dateObj.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}
// "Today" in UK time (the business operates in the UK), so availability and
// stay logic don't drift by a day for guests in other timezones. Mirrors the
// server, which is pinned to Europe/London.
function ukNowParts() {
    const parts = {};
    new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/London',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    })
        .formatToParts(new Date())
        .forEach((p) => {
            if (p.type !== 'literal') parts[p.type] = p.value;
        });
    return { y: +parts.year, m: +parts.month, d: +parts.day };
}
function todayDashed() {
    const t = ukNowParts();
    return `${t.y}-${String(t.m).padStart(2, '0')}-${String(t.d).padStart(2, '0')}`;
}

// ============ Custom glass date-range picker (customer booking) ============
// ===================================================================
//  GLASS DIALOGS — replace native alert()/confirm()/prompt() with
//  theme-matched, promise-based dialogs. Queued so overlapping calls
//  show one after another instead of fighting.
// ===================================================================
let __glassDlgResolve = null;
let __glassDlgQueue = Promise.resolve();
function glassDialog(opts) {
    const run = () =>
        new Promise((resolve) => {
            const o = document.getElementById('glass-dialog');
            const msg = document.getElementById('glass-dialog-msg');
            const inp = document.getElementById('glass-dialog-input');
            const cancel = document.getElementById('glass-dialog-cancel');
            if (!o) {
                resolve(opts.type === 'prompt' ? null : opts.type !== 'confirm');
                return;
            }
            msg.innerText = opts.message || '';
            inp.style.display = opts.type === 'prompt' ? 'block' : 'none';
            inp.type = opts.password ? 'password' : 'text';
            inp.value = opts.def != null ? String(opts.def) : '';
            cancel.style.display = opts.type === 'alert' ? 'none' : 'inline-block';
            __glassDlgResolve = (ok) => {
                o.classList.remove('open');
                __glassDlgResolve = null;
                if (opts.type === 'prompt') resolve(ok ? inp.value : null);
                else if (opts.type === 'confirm') resolve(!!ok);
                else resolve(true);
            };
            o.classList.add('open');
            setTimeout(() => {
                (opts.type === 'prompt' ? inp : document.getElementById('glass-dialog-ok')).focus();
            }, 60);
        });
    const p = __glassDlgQueue.then(run);
    __glassDlgQueue = p.then(
        () => {},
        () => {},
    );
    return p;
}
function glassDialogResolve(ok) {
    if (__glassDlgResolve) __glassDlgResolve(ok);
}
function glassAlert(message) {
    return glassDialog({ type: 'alert', message });
}
function glassConfirm(message) {
    return glassDialog({ type: 'confirm', message });
}
function glassPrompt(message, def, opts) {
    return glassDialog({ type: 'prompt', message, def, password: !!(opts && opts.password) });
}
// Lightweight non-blocking toast for success/info confirmations (vs. glassAlert,
// which blocks with an OK button — kept for errors & destructive confirms).
function toast(message, type) {
    let stack = document.getElementById('app-toasts');
    if (!stack) {
        stack = document.createElement('div');
        stack.id = 'app-toasts';
        stack.className = 'toast-stack';
        document.body.appendChild(stack);
    }
    const ok = type !== 'error';
    const icon = ok
        ? '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M8.5 12.5l2.5 2.5 4.5-5"/></svg>'
        : '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg>';
    const el = document.createElement('div');
    el.className = 'toast toast-mini' + (ok ? '' : ' toast-err');
    el.setAttribute('role', 'status');
    el.innerHTML = `<div class="toast-body">${icon}<span>${escapeHtml(message)}</span></div>`;
    stack.appendChild(el);
    let gone = false;
    const remove = () => {
        if (gone) return;
        gone = true;
        el.classList.add('toast-out');
        setTimeout(() => el.remove(), 360);
    };
    el.addEventListener('click', remove);
    setTimeout(remove, 3600);
}
// Keyboard: Enter = OK, Escape = Cancel (matches native dialog habits)
document.addEventListener('keydown', (e) => {
    const o = document.getElementById('glass-dialog');
    if (!o || !o.classList.contains('open')) return;
    if (e.key === 'Enter') {
        e.preventDefault();
        glassDialogResolve(true);
    }
    if (e.key === 'Escape') {
        e.preventDefault();
        glassDialogResolve(false);
    }
});
// Close the reviews modal on Escape or backdrop click
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        const m = document.getElementById('reviews-modal');
        if (m && m.classList.contains('open')) closeAllReviews();
        const fm = document.getElementById('faq-modal');
        if (fm && fm.classList.contains('open')) closeFaqModal();
        const dm = document.getElementById('details-modal');
        if (dm && dm.classList.contains('open')) closeDetailsModal();
        const pl = document.getElementById('photo-lightbox');
        if (pl && pl.classList.contains('open')) closePhotoLightbox();
    }
});
document.addEventListener('click', (e) => {
    if (e.target && e.target.id === 'reviews-modal') closeAllReviews();
    if (e.target && e.target.id === 'faq-modal') closeFaqModal();
    if (e.target && e.target.id === 'details-modal') closeDetailsModal();
});

// ---- Global keyboard handling for the glass modals, the date picker and the
//      lightbox: Escape closes the top-most one, Tab is trapped inside it, and
//      the arrow keys page through the lightbox. (The glass dialog above handles
//      its own keys, and the reviews/faq/details modals are handled above.)
const MODAL_CLOSERS = {
    'guest-auth-modal': closeGuestAuthModal,
    'guest-details-modal': closeGuestDetailsModal,
    'guest-security-modal': closeGuestSecurityModal,
    'admin-login-modal': closeAdminLogin,
    'terms-modal': closeTermsModal,
    'edit-modal': closeModal,
};
function topOpenDialog() {
    const lb = document.getElementById('lightbox');
    if (lb && lb.classList.contains('open')) return lb;
    const open = Array.from(document.querySelectorAll('.modal-overlay.open'));
    if (open.length) return open[open.length - 1];
    const dp = document.getElementById('date-picker');
    if (dp && dp.classList.contains('open')) return dp;
    return null;
}
document.addEventListener('keydown', (e) => {
    // While the glass dialog is open, let its own handler manage the keys.
    const gd = document.getElementById('glass-dialog');
    if (gd && gd.classList.contains('open')) return;
    const m = topOpenDialog();
    if (!m) return;
    if (e.key === 'Escape') {
        e.preventDefault();
        if (m.id === 'lightbox') return closeLightbox();
        if (m.id === 'date-picker') return closeDatePicker();
        const closer = MODAL_CLOSERS[m.id];
        if (closer) closer();
        else m.classList.remove('open');
    } else if (m.id === 'lightbox' && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        e.preventDefault();
        lightboxNav(e.key === 'ArrowLeft' ? -1 : 1);
    } else if (e.key === 'Tab') {
        // Keep keyboard focus inside the open dialog.
        const focusable = m.querySelectorAll(
            'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        );
        const items = Array.from(focusable).filter((el) => el.offsetParent !== null);
        if (!items.length) return;
        const first = items[0],
            last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
        }
    }
});

// ---- Modal focus management: when a dialog opens, move focus into it; when it
//      closes, restore focus to whatever opened it. (Tab-trapping while open is
//      handled by the keydown handler above.) Centralised via an observer so the
//      many ad-hoc `classList.add('open')` call sites don't each need wiring.
(function () {
    const SEL = '.modal-overlay, #lightbox, #date-picker, .reviews-modal, .chat-widget';
    let lastTrigger = null;
    const isOpen = (el) => el.classList.contains('open');
    const focusInto = (el) => {
        // Prefer the first real form field; otherwise focus the dialog box itself
        // (so screen readers announce the dialog) rather than the close button.
        let target = el.querySelector(
            'input:not([type=hidden]):not([disabled]), textarea:not([disabled]), select:not([disabled])',
        );
        if (!target || target.offsetParent === null) {
            target = el.querySelector('.modal-box, .reviews-modal-box, .terms-modal-box') || el;
            if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
        }
        try {
            target.focus({ preventScroll: true });
        } catch (e) {}
    };
    const onToggle = (el, wasOpen) => {
        const now = isOpen(el);
        if (now && !wasOpen) {
            const ae = document.activeElement;
            if (ae && ae !== document.body && !ae.closest(SEL)) lastTrigger = ae;
            setTimeout(() => {
                if (isOpen(el)) focusInto(el);
            }, 60); // after the open transition
        } else if (!now && wasOpen) {
            const t = lastTrigger;
            lastTrigger = null;
            if (t && document.body.contains(t)) {
                try {
                    t.focus({ preventScroll: true });
                } catch (e) {}
            }
        }
    };
    document.querySelectorAll(SEL).forEach((el) => {
        let was = isOpen(el);
        new MutationObserver(() => {
            const now = isOpen(el);
            if (now !== was) {
                onToggle(el, was);
                was = now;
            }
        }).observe(el, { attributes: true, attributeFilter: ['class'] });
    });
})();

// Phone number for the "Call to Discuss" buttons. The live value is set in
// Back Office → Settings & Fees and stored with site content; these are just
// fallbacks used before content loads or if it was never set.
const CONTACT_PHONE_DIAL = '+440000000000'; // fallback dial number
const CONTACT_PHONE_DISPLAY = '01263 000000'; // fallback display number

const dpState = { view: null, start: null, end: null }; // start/end are 'YYYY-MM-DD'
// The shared date-picker runs in two modes: 'enquiry' (a single cottage, shading
// its booked nights) and 'search' (the homepage hero — no per-cottage shading,
// since availability is shown per cottage in the results).
let dpMode = 'enquiry';
const heroSearch = {
    checkin: null,
    checkout: null,
    adults: 2,
    children: 0,
    cottage: 'any',
    flex: 0,
    mode: 'exact',
    nights: 3,
    month: null,
};

// ---- Availability for the public date picker ----
// { propKey: [{start,end}] } — end is EXCLUSIVE (checkout day is free).
let propertyAvailability = {};
async function loadAvailability(propKey) {
    if (!propKey) return;
    try {
        const res = await apiGet('availability.php?prop=' + encodeURIComponent(propKey));
        propertyAvailability[propKey] = Array.isArray(res.ranges) ? res.ranges : [];
        // If the picker is open, repaint with the fresh data
        const dp = document.getElementById('date-picker');
        if (dp && dp.classList.contains('open')) renderDatePicker();
        // Repaint the read-only availability calendar on the cottage page
        if (propKey === activeFrontProperty) renderAvailCal();
    } catch (e) {
        /* keep whatever we had; server still enforces */
    }
}
// ---- Read-only availability calendar (cottage page) ----
let availCalMonth = null; // Date set to the 1st of the displayed month
function availCalMove(delta) {
    if (!availCalMonth) availCalMonth = new Date();
    availCalMonth = new Date(availCalMonth.getFullYear(), availCalMonth.getMonth() + delta, 1);
    renderAvailCal();
}
function renderAvailCal() {
    const grid = document.getElementById('avail-cal-grid');
    const title = document.getElementById('avail-cal-title');
    if (!grid || !title) return;
    if (!availCalMonth)
        availCalMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const year = availCalMonth.getFullYear(),
        month = availCalMonth.getMonth();
    title.innerText = availCalMonth.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
    const ranges = propertyAvailability[activeFrontProperty] || [];
    const isBooked = (ds) => ranges.some((r) => ds >= r.start && ds < r.end);
    const pad = (n) => String(n).padStart(2, '0');
    const todayStr = todayDashed();
    const dow = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    let html = dow.map((d) => `<div class="avail-dow">${d}</div>`).join('');
    // Monday-first offset
    const first = new Date(year, month, 1);
    let lead = (first.getDay() + 6) % 7;
    for (let i = 0; i < lead; i++) html += `<div class="avail-cell empty"></div>`;
    const days = new Date(year, month + 1, 0).getDate();
    // Per-night "from" price = the couple rate for that night (season-aware),
    // shown on free, future dates so guests see cost at a glance.
    const rate = propertyRates[activeFrontProperty] ||
        defaultRates[activeFrontProperty] || { coupleRate: 0 };
    const seasons = propertySeasons[activeFrontProperty] || [];
    for (let d = 1; d <= days; d++) {
        const ds = `${year}-${pad(month + 1)}-${pad(d)}`;
        let cls = 'avail-cell ';
        const taken = isBooked(ds);
        if (ds < todayStr) cls += 'past ' + (taken ? 'taken' : 'free');
        else cls += taken ? 'taken' : 'free';
        let priceTag = '';
        if (!taken && ds >= todayStr) {
            const nightly = nightlyRateFor(ds, rate, seasons);
            if (nightly > 0) priceTag = `<span class="ac-price">£${Math.round(nightly)}</span>`;
        }
        html += `<div class="${cls}"><span class="ac-day">${d}</span>${priceTag}</div>`;
    }
    grid.innerHTML = html;
}
function isBookedNight(ds) {
    const ranges = propertyAvailability[activeFrontProperty] || [];
    return ranges.some((r) => ds >= r.start && ds < r.end);
}
// True if staying nights [start, end) would include any booked night.
function rangeCrossesBooked(start, end) {
    const ranges = propertyAvailability[activeFrontProperty] || [];
    return ranges.some((r) => r.start < end && r.end > start);
}

function dpParse(str) {
    if (!str) return null;
    const [y, m, d] = str.split('-').map(Number);
    return new Date(y, m - 1, d);
}
function dpToday0() {
    const u = ukNowParts();
    const t = new Date(u.y, u.m - 1, u.d);
    t.setHours(0, 0, 0, 0);
    return t;
}
function dpPretty(str) {
    const d = dpParse(str);
    if (!d) return '';
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function openDatePicker() {
    dpMode = 'enquiry';
    loadAvailability(activeFrontProperty); // refresh booked dates (repaints when it lands)
    // Seed from any existing values
    dpState.start = document.getElementById('enq-checkin').value || null;
    dpState.end = document.getElementById('enq-checkout').value || null;
    const seed = dpParse(dpState.start) || dpToday0();
    dpState.view = new Date(seed.getFullYear(), seed.getMonth(), 1);
    renderDatePicker();
    document.getElementById('date-picker').classList.add('open');
}
function closeDatePicker() {
    document.getElementById('date-picker').classList.remove('open');
}

function dpChangeMonth(delta) {
    dpState.view = new Date(dpState.view.getFullYear(), dpState.view.getMonth() + delta, 1);
    renderDatePicker();
}

function renderDatePicker() {
    const view = dpState.view;
    document.getElementById('dp-title').innerText = view.toLocaleDateString('en-GB', {
        month: 'long',
        year: 'numeric',
    });
    const hint = document.getElementById('dp-hint');
    if (!dpState.start) hint.innerText = 'Select your check-in date';
    else if (!dpState.end) hint.innerText = 'Now select your check-out date';
    else
        hint.innerText = `${dpPretty(dpState.start)} → ${dpPretty(dpState.end)} · ${nightsBetween(dpState.start, dpState.end)} night(s)`;
    // Dim "Clear dates" when there's nothing selected to clear.
    const clearBtn = document.getElementById('dp-clear');
    if (clearBtn) clearBtn.classList.toggle('is-empty', !dpState.start && !dpState.end);

    const grid = document.getElementById('dp-grid');
    const year = view.getFullYear(),
        month = view.getMonth();
    const first = new Date(year, month, 1);
    // Monday-first offset
    const offset = (first.getDay() + 6) % 7;
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const today = dpToday0();

    let cells = '';
    for (let i = 0; i < offset; i++) cells += `<div class="dp-day dp-empty"></div>`;
    const pickingEnd = !!(dpState.start && !dpState.end);
    for (let d = 1; d <= daysInMonth; d++) {
        const date = new Date(year, month, d);
        const ds = formatDashed(date);
        const isPast = date < today;
        const booked = dpMode !== 'search' && !isPast && isBookedNight(ds);
        // Clickability rules (server enforces too — this is the friendly layer):
        //  - picking check-in: any free future night (a checkout/turnover day IS free)
        //  - picking check-out: any later date, as long as no booked night falls
        //    inside the stay; the first day of an existing booking is a valid
        //    checkout (turnover day), so a "booked" cell can still end a stay.
        let clickable;
        if (isPast) clickable = false;
        else if (dpMode === 'search')
            clickable = true; // hero search: any future date
        else if (!pickingEnd) clickable = !booked;
        else if (ds <= dpState.start)
            clickable = !booked; // restart selection
        else clickable = !rangeCrossesBooked(dpState.start, ds); // valid checkout
        const classes = ['dp-day'];
        if (isPast) classes.push('dp-disabled');
        // Cross out booked nights — except when this cell is selectable as a
        // checkout (turnover day), where crossing it out would be confusing.
        if (booked && !(pickingEnd && ds > dpState.start && clickable)) classes.push('dp-booked');
        if (ds === formatDashed(today)) classes.push('dp-today');
        if (dpState.start && ds === dpState.start) classes.push('dp-start');
        if (dpState.end && ds === dpState.end) classes.push('dp-end');
        if (dpState.start && dpState.end && ds > dpState.start && ds < dpState.end)
            classes.push('dp-in-range');
        const click = clickable ? ` onclick="dpPick('${ds}')"` : '';
        const title = booked && !clickable ? ' title="Booked"' : '';
        cells += `<div class="${classes.join(' ')}"${click}${title}>${d}</div>`;
    }
    grid.innerHTML = cells;
}

function dpPick(ds) {
    // First click (or restarting) sets check-in; second sets check-out.
    if (!dpState.start || (dpState.start && dpState.end)) {
        dpState.start = ds;
        dpState.end = null;
    } else {
        if (ds <= dpState.start) {
            // Clicking same or earlier date restarts the selection
            dpState.start = ds;
            dpState.end = null;
        } else {
            dpState.end = ds;
        }
    }
    renderDatePicker();
}

function dpClear() {
    dpState.start = null;
    dpState.end = null;
    renderDatePicker();
}

function dpDone() {
    if (dpMode === 'search') {
        heroSearch.checkin = dpState.start || null;
        heroSearch.checkout = dpState.end || null;
        const disp = document.getElementById('hs-dates');
        if (disp)
            disp.innerText =
                heroSearch.checkin && heroSearch.checkout
                    ? `${dpPretty(heroSearch.checkin)} → ${dpPretty(heroSearch.checkout)}`
                    : heroSearch.checkin
                      ? `${dpPretty(heroSearch.checkin)} — pick check-out`
                      : 'Add your dates';
        closeDatePicker();
        return;
    }
    const ci = document.getElementById('enq-checkin');
    const co = document.getElementById('enq-checkout');
    const trigger = document.getElementById('enq-date-trigger');
    const display = document.getElementById('enq-date-display');
    ci.value = dpState.start || '';
    co.value = dpState.end || '';
    if (dpState.start && dpState.end) {
        display.innerText = `${dpPretty(dpState.start)}  →  ${dpPretty(dpState.end)}`;
        trigger.classList.add('has-dates');
    } else if (dpState.start) {
        display.innerText = `Check-in ${dpPretty(dpState.start)} — pick check-out`;
        trigger.classList.remove('has-dates');
    } else {
        display.innerText = 'Select your stay dates';
        trigger.classList.remove('has-dates');
    }
    closeDatePicker();
    updateEnquiryPrice();
}

// ===== Homepage hero availability search =====
// Guest stepper for the cross-cottage search. Capped to the portfolio limit:
// at most 3 guests total and at most 1 child, and a child only alongside ≤2
// adults — so the two largest parties are "2 adults + 1 child" or "3 adults".
// Increments that would break the rule are simply blocked (nothing is dropped).
function hsAdjust(field, delta) {
    const MAX_TOTAL = 3,
        MAX_CHILDREN = 1;
    if (field === 'adults') {
        const cap = Math.min(3, MAX_TOTAL - heroSearch.children);
        heroSearch.adults = Math.max(1, Math.min(cap, heroSearch.adults + delta));
    } else {
        const cap = Math.min(MAX_CHILDREN, MAX_TOTAL - heroSearch.adults);
        heroSearch.children = Math.max(0, Math.min(cap, heroSearch.children + delta));
    }
    const a = document.getElementById('hs-adults');
    if (a) a.innerText = heroSearch.adults;
    const c = document.getElementById('hs-children');
    if (c) c.innerText = heroSearch.children;
}
// Remember the visitor's last search so it survives a reload / return visit.
function hsPersist() {
    try {
        localStorage.setItem(
            'chb-search',
            JSON.stringify({
                checkin: heroSearch.checkin,
                checkout: heroSearch.checkout,
                adults: heroSearch.adults,
                children: heroSearch.children,
                cottage: heroSearch.cottage,
                flex: heroSearch.flex,
                mode: heroSearch.mode,
                nights: heroSearch.nights,
                month: heroSearch.month,
            }),
        );
    } catch (e) {}
}
// Rehydrate the hero search from the last visit (future dates only) and
// reflect it onto the hero controls. Best-effort; safe if elements are absent.
function hsRestore() {
    let s;
    try {
        s = JSON.parse(localStorage.getItem('chb-search') || 'null');
    } catch (e) {
        s = null;
    }
    if (!s) return;
    const today = formatDashed(dpToday0());
    if (s.checkin && s.checkin >= today) {
        heroSearch.checkin = s.checkin;
        heroSearch.checkout = s.checkout || null;
    }
    if (typeof s.adults === 'number') heroSearch.adults = Math.max(1, Math.min(3, s.adults));
    if (typeof s.children === 'number') heroSearch.children = Math.max(0, Math.min(1, s.children));
    // Keep the restored party within the 3-guest total (drop the child if needed).
    if (heroSearch.adults + heroSearch.children > 3)
        heroSearch.children = Math.max(0, 3 - heroSearch.adults);
    if (s.cottage) heroSearch.cottage = s.cottage;
    if (typeof s.flex === 'number') heroSearch.flex = s.flex;
    if (typeof s.nights === 'number') heroSearch.nights = Math.max(1, Math.min(14, s.nights));
    // Only restore the month if it's still within the current 0–3 month horizon.
    if (s.month) {
        const now = dpToday0();
        const minYM = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        const max = new Date(now.getFullYear(), now.getMonth() + 3, 1);
        const maxYM = `${max.getFullYear()}-${String(max.getMonth() + 1).padStart(2, '0')}`;
        if (s.month >= minYM && s.month <= maxYM) heroSearch.month = s.month;
    }
    const ns = document.getElementById('hs-nights');
    if (ns) ns.innerText = heroSearch.nights;
    hsRenderMonths();
    hsSetMode(s.mode === 'flex' ? 'flex' : 'exact');
    const a = document.getElementById('hs-adults');
    if (a) a.innerText = heroSearch.adults;
    const c = document.getElementById('hs-children');
    if (c) c.innerText = heroSearch.children;
    const disp = document.getElementById('hs-dates');
    if (disp && heroSearch.checkin)
        disp.innerText = heroSearch.checkout
            ? `${dpPretty(heroSearch.checkin)} → ${dpPretty(heroSearch.checkout)}`
            : `${dpPretty(heroSearch.checkin)} — pick check-out`;
    if (heroSearch.cottage && heroSearch.cottage !== 'any') {
        const opt = document.querySelector(
            '#hs-cottage-menu .hs-opt[data-key="' + heroSearch.cottage + '"]',
        );
        const lbl = document.getElementById('hs-cottage-label');
        if (opt && lbl) lbl.innerText = opt.textContent.trim();
        document
            .querySelectorAll('#hs-cottage-menu .hs-opt')
            .forEach((o) =>
                o.classList.toggle('is-sel', o.getAttribute('data-key') === heroSearch.cottage),
            );
    }
}
function openHeroDatePicker() {
    dpMode = 'search';
    dpState.start = heroSearch.checkin;
    dpState.end = heroSearch.checkout;
    const seed = dpParse(dpState.start) || dpToday0();
    dpState.view = new Date(seed.getFullYear(), seed.getMonth(), 1);
    renderDatePicker();
    document.getElementById('date-picker').classList.add('open');
}
function hsSetCottage(v) {
    heroSearch.cottage = v;
    hsMaybeRerun();
}
// Custom (on-brand) cottage dropdown — replaces the native <select> menu.
function toggleCottageMenu(e) {
    if (e) e.stopPropagation();
    const wrap = document.getElementById('hs-cottage-wrap');
    if (!wrap) return;
    const open = wrap.classList.toggle('open');
    const btn = document.getElementById('hs-cottage-btn');
    if (btn) btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) setTimeout(() => document.addEventListener('click', closeCottageMenu), 0);
    else document.removeEventListener('click', closeCottageMenu);
}
function closeCottageMenu(e) {
    const wrap = document.getElementById('hs-cottage-wrap');
    if (!wrap) return;
    if (e && wrap.contains(e.target)) return; // clicks inside are handled by the options
    wrap.classList.remove('open');
    const btn = document.getElementById('hs-cottage-btn');
    if (btn) btn.setAttribute('aria-expanded', 'false');
    document.removeEventListener('click', closeCottageMenu);
}
function chooseCottage(key, label) {
    heroSearch.cottage = key;
    const lbl = document.getElementById('hs-cottage-label');
    if (lbl) lbl.innerText = label;
    document
        .querySelectorAll('#hs-cottage-menu .hs-opt')
        .forEach((o) => o.classList.toggle('is-sel', o.getAttribute('data-key') === key));
    closeCottageMenu();
    hsMaybeRerun();
}
function hsSetFlex(n) {
    heroSearch.flex = n;
    document
        .querySelectorAll('.hs-chip')
        .forEach((c) => c.classList.toggle('is-on', String(n) === c.getAttribute('data-flex')));
    hsMaybeRerun();
}
// If results are already on screen, re-run when a filter changes so it stays live.
function hsMaybeRerun() {
    const sec = document.getElementById('hero-results');
    if (sec && sec.style.display !== 'none' && heroSearch.checkin && heroSearch.checkout)
        runHeroSearch();
}
// ---- Flexible search: pick a stay length + a month, we suggest free windows ----
// Toggle between "exact dates" and "I'm flexible". Each mode shows its own fields;
// guests + the action button are shared. The button's label/handler follow the mode.
function hsSetMode(mode) {
    heroSearch.mode = mode === 'flex' ? 'flex' : 'exact';
    const ex = document.getElementById('hs-mode-exact');
    const fl = document.getElementById('hs-mode-flex');
    if (ex) ex.style.display = heroSearch.mode === 'flex' ? 'none' : 'flex';
    if (fl) fl.style.display = heroSearch.mode === 'flex' ? 'flex' : 'none';
    const eb = document.getElementById('hs-mode-exact-btn');
    if (eb) eb.classList.toggle('is-on', heroSearch.mode === 'exact');
    const fb = document.getElementById('hs-mode-flex-btn');
    if (fb) fb.classList.toggle('is-on', heroSearch.mode === 'flex');
    const btn = document.getElementById('hs-search-btn');
    if (btn)
        btn.innerText = heroSearch.mode === 'flex' ? 'Find flexible dates' : 'Check availability';
    const msg = document.getElementById('hs-msg');
    if (msg) msg.innerText = '';
    if (heroSearch.mode === 'flex' && !document.querySelector('#hs-month-chips .hs-chip'))
        hsRenderMonths();
}
// The search button dispatches by mode.
function hsRun() {
    return heroSearch.mode === 'flex' ? runFlexSearch() : runHeroSearch();
}
function hsAdjustNights(delta) {
    heroSearch.nights = Math.max(1, Math.min(14, (heroSearch.nights || 3) + delta));
    const el = document.getElementById('hs-nights');
    if (el) el.innerText = heroSearch.nights;
    const s = document.getElementById('hs-nights-s');
    if (s) s.style.display = heroSearch.nights === 1 ? 'none' : '';
}
// Month chips: the current month through 3 months ahead (the booking horizon).
function hsRenderMonths() {
    const wrap = document.getElementById('hs-month-chips');
    if (!wrap) return;
    const now = dpToday0();
    let html = '';
    for (let i = 0; i <= 3; i++) {
        const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
        const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        const lbl =
            d.getFullYear() === now.getFullYear()
                ? d.toLocaleDateString('en-GB', { month: 'short' })
                : d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
        html += `<button type="button" class="hs-chip${heroSearch.month === ym ? ' is-on' : ''}" data-ym="${ym}" onclick="hsSetMonth('${ym}')">${lbl}</button>`;
    }
    wrap.innerHTML = html;
}
function hsSetMonth(ym) {
    heroSearch.month = ym;
    document
        .querySelectorAll('#hs-month-chips .hs-chip')
        .forEach((c) => c.classList.toggle('is-on', c.getAttribute('data-ym') === ym));
    const msg = document.getElementById('hs-msg');
    if (msg) msg.innerText = '';
}
function shiftDate(ds, days) {
    const d = dpParse(ds);
    d.setDate(d.getDate() + days);
    return formatDashed(d);
}
// Offsets to try, nearest-to-exact first: 0, -1, +1, -2, +2, ...
function flexOffsets(F) {
    const o = [0];
    for (let i = 1; i <= F; i++) {
        o.push(-i, i);
    }
    return o;
}
// Find the nearest available window (within ±flex days) for one cottage.
// Authoritative clash check against the SAME public source the cottage calendar
// uses (availability.php -> propertyAvailability): confirmed bookings + imported
// Airbnb/Vrbo iCal blocks. Overlap if a range starts before our checkout and
// ends after our check-in (checkout day itself is free, hotel-style).
function rangeClashes(key, ci, co) {
    return (propertyAvailability[key] || []).some((r) => r.start < co && r.end > ci);
}
function findAvailability(key, ci, co, adults, children, flex) {
    const lim = occupancyLimits[key] || { maxAdults: 99, maxChildren: 99, maxTotal: 99 };
    if (adults > lim.maxAdults || children > lim.maxChildren || adults + children > lim.maxTotal)
        return { fits: false };
    const nights = nightsBetween(ci, co);
    const today = formatDashed(dpToday0());
    let reason = 'Not available for these dates';
    for (const off of flexOffsets(flex)) {
        const sci = shiftDate(ci, off);
        if (sci < today) continue; // never suggest a past check-in
        const sco = shiftDate(sci, nights); // keep the same length of stay
        const ruleErr = checkBookingRules(key, sci, sco);
        if (ruleErr) {
            if (off === 0) reason = ruleErr;
            continue;
        }
        if (rangeClashes(key, sci, sco)) continue; // authoritative: bookings + iCal blocks
        return {
            fits: true,
            available: true,
            ci: sci,
            co: sco,
            offset: off,
            price: priceBreakdown(key, adults, children, sci, sco),
        };
    }
    return { fits: true, available: false, reason };
}
// Flexible search: find up to `max` non-overlapping free windows of `nights`
// length whose CHECK-IN falls in the given month (YYYY-MM). Same authoritative
// availability + booking-rule + occupancy checks as the exact search.
function findFlexWindows(key, ym, nights, adults, children, max) {
    const lim = occupancyLimits[key] || { maxAdults: 99, maxChildren: 99, maxTotal: 99 };
    if (adults > lim.maxAdults || children > lim.maxChildren || adults + children > lim.maxTotal)
        return { fits: false, windows: [] };
    const [y, m] = ym.split('-').map(Number);
    const today = formatDashed(dpToday0());
    const daysInMonth = new Date(y, m, 0).getDate();
    const windows = [];
    for (let d = 1; d <= daysInMonth; d++) {
        const ci = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        if (ci < today) continue; // never suggest a past check-in
        const co = shiftDate(ci, nights); // same length stay (may spill into next month)
        if (checkBookingRules(key, ci, co)) continue; // min-stay / arrival-day rules
        if (rangeClashes(key, ci, co)) continue; // authoritative: bookings + iCal blocks
        windows.push({ ci, co, price: priceBreakdown(key, adults, children, ci, co) });
        if (windows.length >= max) break;
        d += nights - 1; // jump past this window so options are spread out
    }
    return { fits: true, windows };
}
async function runFlexSearch() {
    const msg = document.getElementById('hs-msg');
    const setMsg = (t, ok) => {
        if (msg) {
            msg.innerText = t || '';
            msg.style.color = ok ? 'var(--text-muted)' : '#FFB74D';
        }
    };
    if (!heroSearch.month) {
        setMsg('Please choose how long you’d like to stay and which month.');
        return;
    }
    const nights = Math.max(1, Math.min(14, heroSearch.nights || 3));
    hsPersist();
    const keys = liveCottageKeys();
    setMsg('', true);
    const grid0 = document.getElementById('hs-results-grid');
    if (grid0) {
        grid0.innerHTML =
            '<div class="card glass-panel sk-card"><div class="skeleton sk-img"></div><div class="skeleton sk-line w60"></div><div class="skeleton sk-line w40"></div></div>'.repeat(
                3,
            );
    }
    try {
        showHeroResults();
    } catch (e) {}
    try {
        await Promise.all(keys.map((k) => loadAvailability(k)));
    } catch (e) {
        /* loadAvailability keeps prior data; server still enforces */
    }
    setMsg('');
    const { adults, children, month } = heroSearch;
    const results = {};
    let tooSmall = 0;
    for (const key of keys) {
        const r = findFlexWindows(key, month, nights, adults, children, 3);
        if (!r.fits) {
            tooSmall++;
            continue;
        }
        results[key] = r;
    }
    renderFlexResults(results, tooSmall, nights, month);
    try {
        const withN = Object.keys(results).filter((k) => results[k].windows.length).length;
        logSearch({
            mode: 'flex',
            adults,
            children,
            nights,
            month,
            results: withN,
            found: withN > 0 ? 1 : 0,
        });
    } catch (e) {}
}
function renderFlexResults(results, tooSmall, nights, ym) {
    const grid = document.getElementById('hs-results-grid');
    const title = document.getElementById('hs-results-title');
    if (!grid) return;
    const propImg = (key) =>
        (propertyContent[key] && propertyContent[key].images && propertyContent[key].images[0]) ||
        '';
    const party = heroSearch.adults + heroSearch.children;
    const [y, m] = ym.split('-').map(Number);
    const monthName = new Date(y, m - 1, 1).toLocaleDateString('en-GB', {
        month: 'long',
        year: 'numeric',
    });
    const nightsLbl = `${nights} night${nights === 1 ? '' : 's'}`;
    const optRow = (key, w) => {
        const nn = nightsBetween(w.ci, w.co);
        return `<button type="button" class="flex-opt" onclick="startBooking('${key}','${w.ci}','${w.co}')">
                    <span><span class="fo-dates">${dpPretty(w.ci)} → ${dpPretty(w.co)}</span><br><span class="fo-sub">${nn} night${nn === 1 ? '' : 's'}</span></span>
                    <span class="fo-price">From ${gbp(w.price.total)}</span>
                </button>`;
    };
    const card = (key, windows) => `<div class="card glass-panel">
                <div class="card-img" role="img" aria-label="Photo of ${escapeHtml(propertyMeta[key].name)}" style="background-image:url('${propImg(key)}');"></div>
                <div class="card-title">${escapeHtml(propertyMeta[key].name)}</div>
                ${
                    windows.length
                        ? `<div class="card-meta">${windows.length} free option${windows.length === 1 ? '' : 's'} in ${escapeHtml(monthName)}</div><div class="flex-opts">${windows.map((w) => optRow(key, w)).join('')}</div>`
                        : `<div class="card-meta">No ${nightsLbl} gap in ${escapeHtml(monthName)} — try another month.</div>
                       <button class="btn-glass" style="width:100%;margin-top:10px;" onclick="openWaitlistModal({prop:'${key}',checkIn:'',checkOut:''})">Notify me if dates free up</button>`
                }
            </div>`;
    const fitKeys = Object.keys(results);
    const withOpts = fitKeys.filter((k) => results[k].windows.length);
    title.innerText = withOpts.length
        ? `${nightsLbl} in ${monthName}`
        : `No ${nightsLbl} stays free in ${monthName}`;
    let html = withOpts.map((k) => card(k, results[k].windows)).join('');
    html += fitKeys
        .filter((k) => !results[k].windows.length)
        .map((k) => card(k, []))
        .join('');
    if (!fitKeys.length)
        html = `<div class="glass-panel" style="grid-column:1/-1;text-align:center;padding:28px;"><p style="margin-bottom:14px;">Sorry, none of our cottages can host ${party} guest${party === 1 ? '' : 's'}.</p><button class="btn-glass" onclick="nav('view-cottages')">Browse all cottages</button></div>`;
    else if (tooSmall > 0)
        html += `<p style="grid-column:1/-1;text-align:center;font-size:0.8rem;color:var(--text-muted);margin-top:6px;">${tooSmall} cottage${tooSmall === 1 ? ' was' : 's were'} hidden — too small for ${party} guests.</p>`;
    html += `<div class="hs-back-cta" style="grid-column:1/-1;text-align:center;margin-top:22px;">
                <p style="color:var(--text-muted);font-size:0.88rem;margin-bottom:12px;">Want a different length or month?</p>
                <button type="button" class="btn-glass btn-glass-ghost" onclick="backToSearch()">Change your search</button>
            </div>`;
    grid.innerHTML = html;
    showHeroResults();
}
async function runHeroSearch() {
    const msg = document.getElementById('hs-msg');
    const setMsg = (t, ok) => {
        if (msg) {
            msg.innerText = t || '';
            msg.style.color = ok ? 'var(--text-muted)' : '#FFB74D';
        }
    };
    const ci = heroSearch.checkin,
        co = heroSearch.checkout;
    if (!ci || !co) {
        setMsg('Please choose your check-in and check-out dates.');
        return;
    }
    if (co <= ci) {
        setMsg('Your check-out date must be after check-in.');
        return;
    }
    hsPersist(); // remember this search for the visitor's next visit
    // Pull the live calendar (bookings + Airbnb/Vrbo blocks) for every cottage
    // BEFORE deciding what's available, so we never offer a booked stay.
    const keys = liveCottageKeys(); // only offer cottages currently live on the site
    setMsg('', true);
    // Show shimmer skeleton cards while the live calendar is fetched.
    const grid0 = document.getElementById('hs-results-grid');
    if (grid0) {
        grid0.innerHTML =
            '<div class="card glass-panel sk-card"><div class="skeleton sk-img"></div><div class="skeleton sk-line w60"></div><div class="skeleton sk-line w40"></div></div>'.repeat(
                3,
            );
    }
    try {
        showHeroResults();
    } catch (e) {}
    try {
        await Promise.all(keys.map((k) => loadAvailability(k)));
    } catch (e) {
        /* loadAvailability keeps prior data; server still enforces */
    }
    setMsg('');
    const { adults, children, flex } = heroSearch;
    const results = {}; // key -> {fits, available, ci, co, offset, price, reason}
    let tooSmall = 0;
    for (const key of keys) {
        const r = findAvailability(key, ci, co, adults, children, flex);
        if (!r.fits) {
            tooSmall++;
            continue;
        }
        results[key] = r;
    }
    renderHeroResults(results, tooSmall);
    try {
        const availN = Object.keys(results).filter((k) => results[k].available).length;
        logSearch({
            mode: 'exact',
            adults,
            children,
            nights: nightsBetween(ci, co),
            check_in: ci,
            results: availN,
            found: availN > 0 ? 1 : 0,
        });
    } catch (e) {}
}
function renderHeroResults(results, tooSmall) {
    const grid = document.getElementById('hs-results-grid');
    const title = document.getElementById('hs-results-title');
    if (!grid) return;
    const propImg = (key) =>
        (propertyContent[key] && propertyContent[key].images && propertyContent[key].images[0]) ||
        '';
    const party = heroSearch.adults + heroSearch.children;
    const flexNote = heroSearch.flex
        ? ` (±${heroSearch.flex} day${heroSearch.flex === 1 ? '' : 's'})`
        : '';
    const sub = (t) =>
        `<h3 style="grid-column:1/-1;text-align:center;font-family:var(--font-serif);font-weight:400;margin:22px 0 2px;font-size:1.25rem;">${escapeHtml(t)}</h3>`;
    const reqRange = `${dpPretty(heroSearch.checkin)} – ${dpPretty(heroSearch.checkout)}`;
    const card = (key, r) => {
        const nights = nightsBetween(r.ci, r.co);
        // When the match isn't the exact requested dates (a ±flex shift), flag it
        // clearly so the guest knows before they proceed. Dates shown ARE available.
        const banner = r.offset
            ? `<div class="hs-banner">Your dates (${reqRange}) aren't free here — these are the closest available.</div>`
            : '';
        const moved = r.offset
            ? ` <span style="color:var(--text-muted);">· moved ${Math.abs(r.offset)} day${Math.abs(r.offset) === 1 ? '' : 's'}</span>`
            : '';
        return `<div class="card glass-panel">
                    ${banner}
                    <div class="card-img" role="img" aria-label="Photo of ${escapeHtml(propertyMeta[key].name)}" style="background-image:url('${propImg(key)}');"></div>
                    <div class="card-title">${escapeHtml(propertyMeta[key].name)}</div>
                    <div class="card-meta">${dpPretty(r.ci)} → ${dpPretty(r.co)} · ${nights} night${nights === 1 ? '' : 's'}${moved}</div>
                    <div class="card-price">From ${gbp(r.price.total)}</div>
                    <button class="btn-glass" style="width:100%;margin-top:10px;" onclick="startBooking('${key}','${r.ci}','${r.co}')">Enquire now</button>
                </div>`;
    };
    // Unavailable: never carry the clashing dates into the enquiry form (that would
    // error there). Open the cottage with its date picker ready so they pick free dates.
    const unavailCard = (key, reason) => `<div class="card glass-panel hs-unavail">
                    <div class="hs-banner hs-banner-red">${escapeHtml(reason || 'Not available for these dates')}</div>
                    <div class="card-img" role="img" aria-label="Photo of ${escapeHtml(propertyMeta[key].name)}" style="background-image:url('${propImg(key)}');"></div>
                    <div class="card-title">${escapeHtml(propertyMeta[key].name)}</div>
                    <div class="card-meta">Pick different dates to book this cottage.</div>
                    <button class="btn-glass" style="width:100%;margin-top:10px;" onclick="startBooking('${key}','','')">Choose other dates</button>
                </div>`;
    const noneMsg = (
        txt,
    ) => `<div class="glass-panel" style="grid-column:1/-1;text-align:center;padding:28px;">
                    <p style="margin-bottom:14px;">${escapeHtml(txt)}</p>
                    <button class="btn-glass" onclick="nav('view-cottages')">Browse all cottages</button>
                </div>`;

    const fitKeys = Object.keys(results);
    const availKeys = fitKeys.filter((k) => results[k].available);
    const filter = heroSearch.cottage || 'any';
    let html = '';

    if (filter === 'any') {
        title.innerText = availKeys.length
            ? `Available for your dates${flexNote}`
            : `No cottages free for those dates${flexNote}`;
        html += availKeys.map((k) => card(k, results[k])).join('');
        html += fitKeys
            .filter((k) => !results[k].available)
            .map((k) => unavailCard(k, results[k].reason))
            .join('');
        if (!fitKeys.length)
            html = noneMsg(
                `Sorry, none of our cottages can host ${party} guest${party === 1 ? '' : 's'}.`,
            );
        else if (tooSmall > 0)
            html += `<p style="grid-column:1/-1;text-align:center;font-size:0.8rem;color:var(--text-muted);margin-top:6px;">${tooSmall} cottage${tooSmall === 1 ? ' was' : 's were'} hidden — too small for ${party} guests.</p>`;
    } else {
        const X = filter,
            xName = propertyMeta[X] ? propertyMeta[X].name : X;
        const xr = results[X];
        const others = availKeys.filter((k) => k !== X);
        if (xr && xr.available) {
            title.innerText = `${xName} is available${flexNote}`;
            html += card(X, xr);
            if (others.length) {
                html += sub('Other cottages free for your dates');
                html += others.map((k) => card(k, results[k])).join('');
            }
        } else {
            title.innerText = `${xName} isn't free for those dates`;
            html += xr
                ? unavailCard(X, xr.reason)
                : `<div class="card glass-panel hs-unavail"><div class="card-img" role="img" aria-label="Photo of ${escapeHtml(xName)}" style="background-image:url('${propImg(X)}');"></div><div class="card-title">${escapeHtml(xName)}</div><div class="card-meta">Too small for ${party} guest${party === 1 ? '' : 's'}</div></div>`;
            if (others.length) {
                html += sub(
                    others.length > 1
                        ? 'But these are free for your dates'
                        : 'But this one is free for your dates',
                );
                html += others.map((k) => card(k, results[k])).join('');
            } else {
                html += noneMsg(
                    'No other cottage is free for those dates either — try different dates or widen the flexibility.',
                );
            }
        }
    }
    const wlProp = filter !== 'any' ? filter : '';
    html += `<div class="hs-back-cta" style="grid-column:1/-1;text-align:center;margin-top:22px;">
                <p style="color:var(--text-muted);font-size:0.88rem;margin-bottom:12px;">Can't see what you're looking for?</p>
                <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;">
                    <button type="button" class="btn-glass btn-glass-ghost" onclick="backToSearch()">Change your search</button>
                    <button type="button" class="btn-glass" onclick="openWaitlistModal({prop:'${wlProp}',checkIn:'${heroSearch.checkin || ''}',checkOut:'${heroSearch.checkout || ''}'})">Notify me if dates free up</button>
                </div>
            </div>`;
    grid.innerHTML = html;
    showHeroResults();
}
// Fluidly swap the "Our properties" intro + default cottage grid for the search
// results (and back). The results render right where the cottages normally are.
function fluidSwap(el) {
    if (!el) return;
    el.classList.remove('fluid-swap');
    void el.offsetWidth;
    el.classList.add('fluid-swap');
}
// The hero itself becomes the results screen (Airbnb-style): the search panel
// is swapped out for the available/unavailable cards, in place, and the hero
// background is dimmed for a clean backdrop.
function showHeroResults() {
    const panel = document.getElementById('hero-search-panel');
    const wrap = document.getElementById('hero-results-wrap');
    const sec = document.getElementById('home-availability');
    if (panel) panel.style.display = 'none';
    if (wrap) {
        wrap.style.display = '';
        fluidSwap(wrap);
    }
    if (sec) {
        sec.classList.add('results-mode');
        sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}
// Anti-stuck escape: clear the results and glide back to the search so the guest
// can tweak dates / party / cottage and try again.
function backToSearch() {
    const panel = document.getElementById('hero-search-panel');
    const wrap = document.getElementById('hero-results-wrap');
    const sec = document.getElementById('home-availability');
    if (wrap) wrap.style.display = 'none';
    if (panel) {
        panel.style.display = '';
        fluidSwap(panel);
    }
    if (sec) {
        sec.classList.remove('results-mode');
        sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}
// Open the cottage with the chosen dates + party pre-filled, ready to send.
function startBooking(key, ci, co) {
    try {
        trackEvent('book_click', key);
    } catch (e) {}
    // '' is meaningful (clear the dates for an unavailable cottage); only fall
    // back to the searched dates when the argument was genuinely omitted.
    if (ci === undefined) ci = heroSearch.checkin || '';
    if (co === undefined) co = heroSearch.checkout || '';
    openProperty(key);
    const set = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.value = val;
    };
    set('enq-checkin', ci);
    set('enq-checkout', co);
    set('enq-adults', heroSearch.adults);
    set('enq-children', heroSearch.children);
    try {
        onOccupancyInput();
    } catch (e) {}
    try {
        refreshDateTrigger();
    } catch (e) {}
    try {
        updateEnquiryPrice();
    } catch (e) {}
    const target =
        document.getElementById('enq-date-trigger') || document.getElementById('enq-name');
    if (target)
        setTimeout(() => target.scrollIntoView({ behavior: 'smooth', block: 'center' }), 160);
}
// One-tap "Book again" from a past stay: open that cottage and start a fresh
// enquiry (the guest picks new dates; their saved details prefill as usual).
function rebookCottage(propKey) {
    try {
        openProperty(propKey);
    } catch (e) {} // openProperty navigates to the cottage page itself
    setTimeout(() => {
        try {
            openEnquireModal();
        } catch (e) {}
    }, 220);
}

// Reflect programmatic changes (e.g. guest autofill) onto the trigger label
function refreshDateTrigger() {
    const ci = document.getElementById('enq-checkin').value;
    const co = document.getElementById('enq-checkout').value;
    const trigger = document.getElementById('enq-date-trigger');
    const display = document.getElementById('enq-date-display');
    if (!trigger || !display) return;
    if (ci && co) {
        display.innerText = `${dpPretty(ci)}  →  ${dpPretty(co)}`;
        trigger.classList.add('has-dates');
    } else {
        display.innerText = 'Select your stay dates';
        trigger.classList.remove('has-dates');
    }
}

// For a given date string + property, return the status & relevant booking(s)
function getBookingForDate(dateStr, property) {
    const propertyBookings = dbBookings[property] || [];

    for (let b of propertyBookings) {
        if (dateStr === b.checkIn) {
            const prevBooking = propertyBookings.find((prev) => prev.checkOut === dateStr);
            if (prevBooking) return { status: 'changeover', booking: prevBooking, nextBooking: b };
            return { status: 'check-in', booking: b };
        }
        if (dateStr === b.checkOut) {
            const nextBooking = propertyBookings.find((next) => next.checkIn === dateStr);
            if (nextBooking) return { status: 'changeover', booking: b, nextBooking: nextBooking };
            return { status: 'check-out', booking: b };
        }
        if (dateStr > b.checkIn && dateStr < b.checkOut) {
            return { status: 'booked', booking: b };
        }
    }
    return { status: 'none' };
}

// Dashboard cards are shortcuts: jump to the relevant tool when tapped.
function dashGo(target) {
    try {
        if (target === 'analytics') {
            openSettings('analytics');
        } else if (target === 'enquiries') {
            openSettings('enquiries');
        } else if (target === 'messages') {
            openSettings('messages');
        } else if (target === 'reviews') {
            openSettings('reviews');
        } else if (target === 'photos') {
            openSettings('photos');
        } else if (target === 'money') {
            Promise.resolve(openAccounts()).then(() => {
                try {
                    accountsOpen('payments');
                } catch (e) {}
            });
        } else if (target === 'calendar') {
            const el =
                document.querySelector('#view-backoffice .cal-panel') ||
                document.getElementById('cal-body');
            if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    } catch (e) {}
}
function renderOwnerSummary() {
    const el = document.getElementById('owner-summary');
    if (!el) return;
    const todayStr = todayDashed();
    const now = new Date();
    const in30 = formatDashed(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 30));
    const monthStart = formatDashed(new Date(now.getFullYear(), now.getMonth(), 1));
    const monthEnd = formatDashed(new Date(now.getFullYear(), now.getMonth() + 1, 0));

    let arrivals30 = 0,
        received = 0,
        outstanding = 0,
        unpaidUpcoming = 0;
    // Occupancy counts each occupied cottage-night once, so a direct booking
    // and an Airbnb/Vrbo block on the same night never double-count.
    const occupiedNights = new Set();
    const addNights = (propKey, checkIn, checkOut) => {
        let d = dpParse(checkIn),
            end = dpParse(checkOut);
        if (!d || !end) return;
        for (; d < end; d.setDate(d.getDate() + 1)) {
            const ds = formatDashed(d);
            if (ds >= monthStart && ds <= monthEnd) occupiedNights.add(propKey + '|' + ds);
        }
    };
    Object.keys(dbBookings).forEach((propKey) => {
        (dbBookings[propKey] || []).forEach((b) => {
            const ps = paymentSummary(propKey, b);
            const isUpcomingOrActive = b.checkOut >= todayStr;
            // Arrivals in the next 30 days
            if (b.checkIn >= todayStr && b.checkIn <= in30) arrivals30++;
            // Money: count received always; outstanding only for not-yet-finished stays
            received += ps.deposit;
            if (isUpcomingOrActive) {
                outstanding += ps.balance;
                if (!ps.fullyPaid) unpaidUpcoming++;
            }
            addNights(propKey, b.checkIn, b.checkOut);
        });
    });
    // Include imported Airbnb / Vrbo blocks in occupancy AND in the next-30-day
    // arrivals count — a guest checking in via an external platform is still an
    // arrival to prepare for. Compared on a normalised dashed date so it works
    // whatever format the import stored.
    Object.keys(dbBlocks).forEach((propKey) => {
        (dbBlocks[propKey] || []).forEach((bl) => {
            addNights(propKey, bl.checkIn, bl.checkOut);
            const ci = dpParse(bl.checkIn);
            if (ci) {
                const ds = formatDashed(ci);
                if (ds >= todayStr && ds <= in30) arrivals30++;
            }
        });
    });
    const nightsThisMonth = occupiedNights.size;
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const totalRoomNights = daysInMonth * Object.keys(dbBookings).length;
    const occ = totalRoomNights ? Math.round((nightsThisMonth / totalRoomNights) * 100) : 0;
    const monthName = now.toLocaleDateString('en-GB', { month: 'long' });

    const paidFrac =
        received + outstanding > 0 ? received / (received + outstanding) : received > 0 ? 1 : 0;
    el.innerHTML = `
                <div class="os-card clickable" role="button" tabindex="0" onclick="dashGo('analytics')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();dashGo('analytics')}" title="View visitor analytics"><div class="os-label">Visits this week</div>
                    <div class="os-value" id="os-visits">—</div>
                    <svg class="os-spark" id="os-visits-spark" viewBox="0 0 100 36" preserveAspectRatio="none" aria-hidden="true"></svg>
                    <div class="os-sub" id="os-visits-sub">last 7 days</div></div>
                <div class="os-card clickable" role="button" tabindex="0" onclick="dashGo('calendar')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();dashGo('calendar')}" title="See the calendar"><div class="os-label">Occupancy (${monthName})</div>
                    <div class="os-donut-row">${osDonut(occ, 'var(--accent)')}
                        <div class="os-donut-meta"><div class="os-sub" style="margin-top:0;">${nightsThisMonth} of ${totalRoomNights}<br>cottage-nights</div></div>
                    </div></div>
                <div class="os-card clickable" role="button" tabindex="0" onclick="dashGo('money')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();dashGo('money')}" title="Open Money — payments & balances"><div class="os-label">Received</div>
                    <div class="os-value os-good">${gbp(received)}</div>
                    <div class="os-bar"><span style="width:${Math.round(paidFrac * 100)}%;"></span></div>
                    <div class="os-sub">${outstanding > 0.001 ? gbp(outstanding) + ' outstanding · ' + unpaidUpcoming + ' unpaid' : 'All upcoming stays paid'}</div></div>
                <div class="os-card clickable" role="button" tabindex="0" onclick="dashGo('calendar')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();dashGo('calendar')}" title="See upcoming arrivals on the calendar"><div class="os-label">Arrivals (next 30 days)</div>
                    <div class="os-value">${arrivals30}</div><div class="os-sub">guests checking in</div></div>`;
    refreshHomeVisits();
}
// Radial donut gauge (inline SVG) for a 0–100 percentage.
function osDonut(pct, color) {
    pct = Math.max(0, Math.min(100, pct || 0));
    const R = 26,
        C = 2 * Math.PI * R,
        dash = ((C * pct) / 100).toFixed(1);
    return `<svg class="os-donut" viewBox="0 0 64 64" role="img" aria-label="${pct}%">
                <circle cx="32" cy="32" r="${R}" fill="none" stroke="rgba(255,255,255,0.10)" stroke-width="7"/>
                <circle cx="32" cy="32" r="${R}" fill="none" stroke="${color}" stroke-width="7" stroke-linecap="round" stroke-dasharray="${dash} ${C.toFixed(1)}" transform="rotate(-90 32 32)"/>
                <text x="32" y="38" text-anchor="middle" font-family="var(--font-serif)" font-size="16" fill="var(--text-light)">${pct}%</text>
            </svg>`;
}
// Filled sparkline for a small series of values (drawn into an existing <svg>).
function osSparkline(el, values, color) {
    if (!el) return;
    const vals = values && values.length ? values : [0];
    const max = Math.max(1, ...vals),
        n = vals.length;
    const x = (i) => (n === 1 ? 50 : (i * 100) / (n - 1));
    const y = (v) => 34 - (v / max) * 32 + 1;
    const pts = vals.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    const area = `0,36 ${pts} 100,36`;
    el.innerHTML = `<polygon points="${area}" fill="${color}" fill-opacity="0.18"/>
                <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>`;
}
// Fill the dashboard "Visits this week" card from the analytics endpoint
// (cached ~60s so flipping calendar months doesn't refetch each time).
let __homeVisits = null,
    __homeVisitsAt = 0;
async function refreshHomeVisits() {
    const v = document.getElementById('os-visits');
    if (!v) return;
    if (!(__homeVisits && Date.now() - __homeVisitsAt < 60000)) {
        try {
            __homeVisits = await apiGet('track.php?action=summary&days=7');
            __homeVisitsAt = Date.now();
        } catch (e) {
            __homeVisits = null;
        }
    }
    const cur = document.getElementById('os-visits'); // may have re-rendered
    if (!cur) return;
    if (__homeVisits) {
        cur.textContent = __homeVisits.weekViews || 0;
        const s = document.getElementById('os-visits-sub');
        if (s) s.textContent = `${__homeVisits.weekUnique || 0} unique · last 7 days`;
        const daily = Array.isArray(__homeVisits.daily)
            ? __homeVisits.daily.map((d) => d.views || 0)
            : [];
        osSparkline(document.getElementById('os-visits-spark'), daily, '#5BA8FF');
    } else {
        cur.textContent = '–';
    }
}

// ---- Reusable mini-chart helpers (inline SVG/CSS, no library) ----
function osMiniDonut(pct, color) {
    pct = Math.max(0, Math.min(100, Math.round(pct || 0)));
    const R = 15,
        C = 2 * Math.PI * R,
        dash = ((C * pct) / 100).toFixed(1);
    return `<svg viewBox="0 0 40 40" style="width:42px;height:42px;flex-shrink:0;" role="img" aria-label="${pct}%">
                <circle cx="20" cy="20" r="${R}" fill="none" stroke="rgba(255,255,255,0.10)" stroke-width="5"/>
                <circle cx="20" cy="20" r="${R}" fill="none" stroke="${color}" stroke-width="5" stroke-linecap="round" stroke-dasharray="${dash} ${C.toFixed(1)}" transform="rotate(-90 20 20)"/>
                <text x="20" y="24" text-anchor="middle" font-size="10" fill="var(--text-light)">${pct}</text></svg>`;
}
function moneyShort(v) {
    v = +v || 0;
    return v >= 1000 ? '£' + (v / 1000).toFixed(v >= 10000 ? 0 : 1) + 'k' : '£' + Math.round(v);
}
// Vertical bars: items = [{label, short, value}].
function osVBars(items, fmt) {
    if (!items || !items.length) return '';
    const peak = Math.max(1, ...items.map((i) => i.value || 0));
    return (
        `<div style="display:flex;align-items:flex-end;gap:8px;height:140px;margin:12px 0 2px;">` +
        items
            .map((i) => {
                const h = Math.max(3, Math.round(((i.value || 0) / peak) * 100));
                return `<div title="${escapeHtml(i.label)}: ${fmt ? fmt(i.value) : i.value}" style="flex:1;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;gap:5px;min-width:0;">
                    <span style="font-size:0.62rem;color:var(--text-muted);white-space:nowrap;">${fmt ? fmt(i.value) : i.value}</span>
                    <div style="width:100%;max-width:36px;background:linear-gradient(180deg,var(--accent),rgba(214,167,133,0.30));border-radius:6px 6px 0 0;height:${h}%;"></div>
                    <span style="font-size:0.6rem;color:var(--text-muted);white-space:nowrap;">${escapeHtml(i.short || i.label)}</span>
                </div>`;
            })
            .join('') +
        `</div>`
    );
}
// Horizontal bars: items = [{label, value, max, valLabel, color}].
function osHBars(items) {
    return (items || [])
        .map((i) => {
            const pct = Math.max(2, Math.round(((i.value || 0) / (i.max || 1)) * 100));
            return `<div style="margin-bottom:9px;">
                    <div style="display:flex;justify-content:space-between;gap:10px;font-size:0.8rem;margin-bottom:4px;"><span style="color:var(--text-light);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(i.label)}</span><span style="color:var(--text-muted);">${escapeHtml(i.valLabel != null ? i.valLabel : String(i.value))}</span></div>
                    <div style="height:8px;border-radius:5px;background:rgba(255,255,255,0.08);overflow:hidden;"><div style="height:100%;width:${pct}%;background:${i.color || 'var(--accent)'};border-radius:5px;transition:width 0.5s var(--fluid-bezier);"></div></div>
                </div>`;
        })
        .join('');
}
// Booked cottage-nights this calendar month, per cottage (direct + iCal blocks).
function cottageMonthOccupancy() {
    const now = new Date();
    const mStart = formatDashed(new Date(now.getFullYear(), now.getMonth(), 1));
    const mEnd = formatDashed(new Date(now.getFullYear(), now.getMonth() + 1, 0));
    const days = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const sets = {};
    const out = {};
    Object.keys(propertyMeta).forEach((k) => {
        sets[k] = new Set();
        out[k] = { nights: 0, total: days, pct: 0 };
    });
    const add = (k, ci, co) => {
        if (!sets[k]) return;
        let d = dpParse(ci),
            e = dpParse(co);
        if (!d || !e) return;
        for (; d < e; d.setDate(d.getDate() + 1)) {
            const ds = formatDashed(d);
            if (ds >= mStart && ds <= mEnd) sets[k].add(ds);
        }
    };
    Object.keys(dbBookings).forEach((k) =>
        (dbBookings[k] || []).forEach((b) => add(k, b.checkIn, b.checkOut)),
    );
    Object.keys(dbBlocks || {}).forEach((k) =>
        (dbBlocks[k] || []).forEach((bl) => add(k, bl.checkIn, bl.checkOut)),
    );
    Object.keys(out).forEach((k) => {
        out[k].nights = sets[k].size;
        out[k].pct = Math.round((sets[k].size / days) * 100);
    });
    return out;
}

function renderCalendar() {
    renderOwnerSummary();
    renderCalUpdated();
    const year = calDate.getFullYear();
    const month = calDate.getMonth();

    const monthNames = [
        'January',
        'February',
        'March',
        'April',
        'May',
        'June',
        'July',
        'August',
        'September',
        'October',
        'November',
        'December',
    ];
    document.getElementById('cal-month-display').innerText = `${monthNames[month]} ${year}`;

    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    const calBody = document.getElementById('cal-body');
    calBody.innerHTML = '';

    for (let i = 0; i < firstDay; i++) {
        const emptyCell = document.createElement('div');
        emptyCell.className = 'cal-day empty';
        calBody.appendChild(emptyCell);
    }

    const today = new Date();
    const todayStr = formatDashed(today);

    for (let d = 1; d <= daysInMonth; d++) {
        const cellDate = new Date(year, month, d);
        const dateStr = formatDashed(cellDate);

        const cell = document.createElement('div');
        cell.className = 'cal-day';
        if (dateStr === todayStr) cell.classList.add('today');
        const dow = cellDate.getDay();
        if (dow === 0 || dow === 6) cell.classList.add('weekend');

        const numSpan = document.createElement('span');
        numSpan.className = 'day-num';
        numSpan.innerText = d;
        cell.appendChild(numSpan);

        // Collect this day's pills (bookings + external blocks), then cap with "+N more".
        const barsWrap = document.createElement('div');
        barsWrap.className = 'day-bookings';
        const dayBars = [];

        // Loop over ALL properties so they appear together on one calendar
        Object.keys(dbBookings).forEach((propKey) => {
            const dayData = getBookingForDate(dateStr, propKey);
            if (dayData.status === 'none') return;

            const bar = document.createElement('div');
            bar.className = `booking-bar bar-${propKey}`;
            const short = propertyMeta[propKey].short;

            // Payment dot reflects the *displayed* booking's status.
            // For changeovers the bar represents the leaving guest's booking.
            const payColor = paymentMeta[dayData.booking.payment]
                ? paymentMeta[dayData.booking.payment].dot
                : '#888';
            const dot = `<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${payColor};margin-right:5px;vertical-align:middle;"></span>`;
            const firstName = dayData.booking.name.split(' ')[0];
            const _pm = paymentMeta[dayData.booking.payment] || {};
            bar.title = `${propertyMeta[propKey].name} — ${dayData.booking.name} · ${dayData.booking.checkIn} → ${dayData.booking.checkOut}${_pm.label ? ' · ' + _pm.label : ''}`;

            if (dayData.status === 'check-in') {
                bar.innerHTML = `${dot}<span class="bb-code">${short}</span><span class="bb-name"> ▶ ${escapeHtml(firstName)}</span>`;
                bar.onclick = (e) => {
                    e.stopPropagation();
                    showDetails(propKey, dayData.booking);
                };
            } else if (dayData.status === 'check-out') {
                bar.innerHTML = `${dot}<span class="bb-code">${short}</span><span class="bb-name"> ◀ ${escapeHtml(firstName)}</span>`;
                bar.onclick = (e) => {
                    e.stopPropagation();
                    showDetails(propKey, dayData.booking);
                };
            } else if (dayData.status === 'changeover') {
                bar.classList.add('changeover-bar');
                bar.innerHTML = `${dot}<span class="bb-code">${short}</span><span class="bb-name"> ⟷ Changeover</span>`;
                bar.onclick = (e) => {
                    e.stopPropagation();
                    showDetails(propKey, dayData.booking, dayData.nextBooking);
                };
            } else {
                // booked (mid-stay)
                bar.innerHTML = `${dot}<span class="bb-code">${short}</span><span class="bb-name"> · ${escapeHtml(firstName)}</span>`;
                bar.onclick = (e) => {
                    e.stopPropagation();
                    showDetails(propKey, dayData.booking);
                };
            }

            dayBars.push(bar);
        });

        // External (Airbnb/Vrbo) blocks — show the dates as taken, colour-coded
        // by property, with the platform name. Click to view/remove.
        Object.keys(dbBlocks).forEach((propKey) => {
            getBlocksForDate(dateStr, propKey).forEach((bl) => {
                const meta = propertyMeta[propKey] || { name: propKey, short: propKey };
                const bar = document.createElement('div');
                bar.className = `booking-bar bar-${propKey} ext-block`;
                const arrow = dateStr === bl.checkIn ? '▶' : '·';
                const srcName =
                    bl.source === 'airbnb'
                        ? 'Airbnb'
                        : bl.source === 'vrbo'
                          ? 'Vrbo'
                          : bl.source
                            ? bl.source.charAt(0).toUpperCase() + bl.source.slice(1)
                            : 'External';
                bar.innerHTML = `${IC_LOCK}<span class="bb-code">${meta.short}</span><span class="bb-name"> ${arrow} ${escapeHtml(srcName.toUpperCase())}</span>`;
                bar.title = `${meta.name} — ${srcName} booking (${bl.checkIn} to ${bl.checkOut}). Click for details.`;
                bar.onclick = (e) => {
                    e.stopPropagation();
                    showBlockDetails(propKey, bl);
                };
                dayBars.push(bar);
            });
        });

        // Show up to N pills, then a "+N more" line (iOS-style), so busy days
        // never make the row tall. Tapping "more" opens the first booking.
        const maxBars = window.innerWidth <= 480 ? 2 : 4;
        dayBars.slice(0, maxBars).forEach((el) => barsWrap.appendChild(el));
        if (dayBars.length > maxBars) {
            const more = document.createElement('div');
            more.className = 'cal-more';
            more.textContent = `+${dayBars.length - maxBars} more`;
            barsWrap.appendChild(more);
        }
        cell.appendChild(barsWrap);
        calBody.appendChild(cell);
    }
}

function showDetails(propKey, booking1, booking2 = null) {
    const panel = document.getElementById('booking-details-content');
    if (!panel) return;
    let html = buildDetailHtml(propKey, booking1, booking2 ? 'Leaving Guest' : null);
    if (booking2) {
        html += `<div style="margin: 20px 0; text-align: center; color: #FFA726; font-weight: bold; font-size: 0.8rem; text-transform: uppercase;"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4l9 16H3z"/><path d="M12 10v4"/><circle cx="12" cy="17.4" r="0.6" fill="currentColor" stroke="none"/></svg> Same-Day Changeover</div>`;
        html += buildDetailHtml(propKey, booking2, 'Arriving Guest');
    }
    panel.innerHTML = html;
    if (squareAdminEnabled) {
        try {
            if (booking1 && booking1.email) loadBookingPayments(booking1.id);
        } catch (e) {}
        try {
            if (booking2 && booking2.email) loadBookingPayments(booking2.id);
        } catch (e) {}
    }
    const t = document.getElementById('details-modal-title');
    if (t) t.innerText = 'Guest Details';
    const m = document.getElementById('details-modal');
    if (m) m.classList.add('open');
}
function closeDetailsModal() {
    const m = document.getElementById('details-modal');
    if (m) m.classList.remove('open');
}

// Popup for an external (Airbnb/Vrbo) imported block, with a Remove button.
function showBlockDetails(propKey, bl) {
    const panel = document.getElementById('booking-details-content');
    if (!panel) return;
    const meta = propertyMeta[propKey] || { name: propKey };
    const label = 'EXTERNAL';
    const nights = nightsBetween(bl.checkIn, bl.checkOut);
    panel.innerHTML = `
                <div class="detail-grid">
                    <div>
                        <h4 style="color:var(--text-muted);margin:0 0 6px;font-size:0.85rem;text-transform:uppercase;">Property</h4>
                        <p style="margin:0 0 16px;"><span class="legend-swatch swatch-${propKey}"></span> <strong>${escapeHtml(meta.name)}</strong></p>
                        <h4 style="color:var(--text-muted);margin:0 0 6px;font-size:0.85rem;text-transform:uppercase;">Booked via</h4>
                        <p style="margin:0 0 16px;">${IC_LOCK} ${escapeHtml(label)}</p>
                    </div>
                    <div>
                        <h4 style="color:var(--text-muted);margin:0 0 6px;font-size:0.85rem;text-transform:uppercase;">Dates</h4>
                        <p style="margin:0 0 4px;">${escapeHtml(bl.checkIn)} → ${escapeHtml(bl.checkOut)}</p>
                        <p style="margin:0 0 16px;color:var(--text-muted);font-size:0.85rem;">${nights} night${nights === 1 ? '' : 's'} blocked</p>
                    </div>
                </div>
                <p style="font-size:0.8rem;color:var(--text-muted);margin:8px 0 18px;">Imported automatically from an external platform's calendar (e.g. Airbnb or Vrbo) so guests can't double-book. Removing it only clears it from your calendar — if the booking still exists on the external platform, the next sync may bring it back.</p>
                <button class="btn-glass" style="width:100%;padding:14px;" onclick="deleteIcalBlock(${Number(bl.id)})"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13"/></svg> Remove from calendar</button>`;
    const t = document.getElementById('details-modal-title');
    if (t) t.innerText = 'External Booking';
    const m = document.getElementById('details-modal');
    if (m) m.classList.add('open');
}

async function deleteIcalBlock(id) {
    const ok = await glassConfirm(
        'Remove this external booking from your calendar?\n\nIf it still exists on the platform (Airbnb/Vrbo), it may return next time your calendar syncs.',
    );
    if (!ok) return;
    try {
        await apiPost('ical-import.php', { action: 'delete_block', id });
        closeDetailsModal();
        await loadData();
        renderCalendar();
    } catch (e) {
        glassAlert("Couldn't remove it: " + e.message);
    }
}

function buildDetailHtml(propKey, b, titlePrefix = null) {
    const meta = propertyMeta[propKey];
    const title = titlePrefix
        ? `<h4 style="color: var(--text-muted); margin-bottom: 10px; font-size: 0.85rem; text-transform: uppercase;">${titlePrefix}</h4>`
        : '';
    const inTime = b.checkInTime ? ` · ${b.checkInTime}` : '';
    const outTime = b.checkOutTime ? ` · ${b.checkOutTime}` : '';
    const emailVal = b.email
        ? `<a href="mailto:${escapeHtml(b.email)}" style="color: var(--text-light);">${escapeHtml(b.email)}</a>`
        : '<span style="color: var(--text-muted);">—</span>';
    const phoneVal = b.phone
        ? `<a href="tel:${escapeHtml(b.phone)}" style="color: var(--text-light);">${escapeHtml(b.phone)}</a>`
        : '<span style="color: var(--text-muted);">—</span>';
    const adults = b.adults != null ? b.adults : 0;
    const children = b.children != null ? b.children : 0;
    // Use the AGREED price snapshot if present (so rate changes don't alter
    // an existing booking). Fall back to a live calc for legacy bookings.
    const p = b.agreedPrice || priceBreakdown(propKey, adults, children, b.checkIn, b.checkOut);
    const agreedNote = b.agreedPrice
        ? `<div style="font-size: 0.7rem; color: var(--text-muted); margin-top: 6px;">Agreed price${b.agreedPrice.agreedOn ? ' · ' + b.agreedPrice.agreedOn : ''} — locked at the rates in effect when booked.</div>`
        : '';
    // If current rates would now produce a different total, note it for staff.
    let rateDiffNote = '';
    if (b.agreedPrice) {
        const live = priceBreakdown(propKey, adults, children, b.checkIn, b.checkOut);
        if (Math.abs(live.total - b.agreedPrice.total) > 0.001) {
            rateDiffNote = `<div style="font-size: 0.7rem; color: #FFA726; margin-top: 4px;">At today's rates this stay would be ${gbp(live.total)}.</div>`;
        }
    }
    const ps = paymentSummary(propKey, b);
    const depositRows =
        ps.deposit > 0
            ? `
                        <div class="price-row" style="color:#4CAF50;"><span>Deposit paid</span><span>− ${gbp(ps.deposit)}</span></div>
                        <div class="price-row total"><span>${ps.fullyPaid ? 'Paid in full' : 'Balance due'}</span><span class="price-amount" style="${ps.fullyPaid ? 'color:#4CAF50;' : ''}">${gbp(ps.fullyPaid ? ps.total : ps.balance)}</span></div>`
            : '';
    const priceBlock = `
                <div style="margin-top: 20px; max-width: 380px;">
                    <span class="booking-detail-label" style="margin-bottom: 8px;">Price</span>
                    <div class="price-box" style="margin-bottom: 0;">
                        <div class="price-row"><span>${gbp(p.perNight)} × ${p.nights} night${p.nights === 1 ? '' : 's'} (${adults}A${children > 0 ? ', ' + children + 'C' : ''})</span><span>${gbp(p.nightly)}</span></div>
                        <div class="price-row"><span>Transaction fee (${p.transactionPct}%)</span><span>${gbp(p.txFee)}</span></div>
                        <div class="price-row"><span>Refundable damages deposit</span><span>${gbp(p.damagesDeposit)}</span></div>
                        <div class="price-row total"><span>Total</span><span class="price-amount">${gbp(p.total)}</span></div>
                        ${depositRows}
                    </div>
                    ${agreedNote}${rateDiffNote}
                </div>`;
    return `
                ${title}
                <span class="prop-tag tag-${propKey}">${meta.name}</span>
                <div class="detail-grid">
                    <div class="booking-detail-item">
                        <span class="booking-detail-label">Guest Name</span>
                        <span class="booking-detail-value">${escapeHtml(b.name)}</span>
                    </div>
                    <div class="booking-detail-item">
                        <span class="booking-detail-label">Party Size</span>
                        <span class="booking-detail-value" style="font-size: 1rem;">${escapeHtml(b.guests)}</span>
                    </div>
                    <div class="booking-detail-item">
                        <span class="booking-detail-label">Email</span>
                        <span class="booking-detail-value" style="font-size: 0.95rem;">${emailVal}</span>
                    </div>
                    <div class="booking-detail-item">
                        <span class="booking-detail-label">Phone</span>
                        <span class="booking-detail-value" style="font-size: 0.95rem;">${phoneVal}</span>
                    </div>
                    <div class="booking-detail-item" style="grid-column:1/-1;">
                        <span class="booking-detail-label">Home Address</span>
                        <span class="booking-detail-value" style="font-size: 0.95rem; white-space: pre-wrap;">${b.address || b.postcode ? escapeHtml([b.address, b.postcode].filter(Boolean).join(', ')) : '<span style="color: var(--text-muted);">—</span>'}</span>
                    </div>
                    <div class="booking-detail-item" style="grid-column:1/-1;">
                        <span class="booking-detail-label">Terms &amp; Conditions</span>
                        <span class="booking-detail-value" style="font-size: 0.9rem;">${b.termsAcceptedAt ? '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M8.5 12.5l2.5 2.5 4.5-5"/></svg> Accepted ' + escapeHtml(b.termsAcceptedAt) + (b.termsVersion ? ' (v' + escapeHtml(b.termsVersion) + ')' : '') : '— not recorded'}</span>
                    </div>
                    <div class="booking-detail-item">
                        <span class="booking-detail-label">Check In</span>
                        <span class="booking-detail-value" style="font-size: 1rem;">${b.checkIn}${inTime}</span>
                    </div>
                    <div class="booking-detail-item">
                        <span class="booking-detail-label">Check Out</span>
                        <span class="booking-detail-value" style="font-size: 1rem;">${b.checkOut}${outTime}</span>
                    </div>
                    <div class="booking-detail-item" style="grid-column:1/-1;">
                        <span class="booking-detail-label">Payment</span>
                        <div style="display:flex;align-items:center;gap:10px;margin-top:4px;flex-wrap:wrap;">
                            <span style="display:inline-block;width:12px;height:12px;border-radius:50%;flex-shrink:0;background:${paymentMeta[b.payment] ? paymentMeta[b.payment].dot : '#888'};"></span>
                            <span class="booking-detail-value" style="font-size:0.95rem;">${paymentMeta[b.payment] ? paymentMeta[b.payment].label : '—'}${b.depositPaid > 0 ? ` · ${gbp(b.depositPaid)} received` : ''}</span>
                            <button class="btn-sm btn-edit" style="margin-left:auto;" onclick="closeDetailsModal(); openAccounts();">Manage payment →</button>
                        </div>
                    </div>
                    <div class="booking-detail-item" style="grid-column: 1 / -1;">
                        <span class="booking-detail-label">Staff Notes</span>
                        <span class="booking-detail-value" style="font-size: 0.9rem; color: var(--text-muted);">${b.notes ? escapeHtml(b.notes) : '—'}</span>
                    </div>
                </div>
                ${priceBlock}
                <div style="display: flex; gap: 10px; margin-top: 20px; max-width: 320px;">
                    <button class="btn-sm btn-edit" style="flex:1;" onclick="openEditBooking('${b.id}')">Edit / Move</button>
                    <button class="btn-sm btn-decline" style="flex:1;" onclick="cancelBooking('${b.id}')">Cancel &amp; refund</button>
                </div>
                <div style="margin-top: 8px; max-width: 320px;">
                    <button class="btn-sm btn-decline" style="width:100%;opacity:.85;" onclick="deleteBooking('${b.id}')">Delete (no refund / mistaken entry)</button>
                </div>
                ${
                    b.email
                        ? `<div style="margin-top: 12px; max-width: 320px;">
                    <button class="btn-sm btn-edit" style="width:100%;" onclick="sendConfirmationEmail('${b.id}')"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M4 6.5l8 6 8-6"/></svg> Send confirmation email</button>
                    <button class="btn-sm btn-edit" style="width:100%;margin-top:8px;" onclick="sendArrivalInfo('${b.id}')"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 4L3 11l7 2.5L13 20l3-7z"/><path d="M10 13.5L21 4"/></svg> Send arrival info${b.preArrivalSent ? ' (sent ✓)' : ''}</button>
                </div>`
                        : ''
                }
            `;
}

// ===================================================================
//  FRONT-SITE ENQUIRY SUBMISSION
// ===================================================================
// Build a human-readable party summary from counts
function guestSummary(adults, children) {
    adults = Number(adults) || 0;
    children = Number(children) || 0;
    const parts = [];
    parts.push(`${adults} Adult${adults === 1 ? '' : 's'}`);
    if (children > 0) parts.push(`${children} Child${children === 1 ? '' : 'ren'}`);
    return parts.join(', ');
}

// Live price on the front-end enquiry form (property 21a)
// ===================================================================
//  PER-PROPERTY FRONT-END PAGE
// ===================================================================
const PROP_CONTENT_KEY = 'nn-property-content';

function loadPropContentOverrides() {
    try {
        const saved = JSON.parse(localStorage.getItem(PROP_CONTENT_KEY));
        if (saved && typeof saved === 'object') {
            Object.keys(propertyContent).forEach((k) => {
                if (saved[k]) propertyContent[k] = Object.assign({}, propertyContent[k], saved[k]);
            });
        }
    } catch (e) {}
    renderSeoText();
}

// Rebuild the hidden SEO block from live cottage content so it always
// matches what's actually on the site (titles, descriptions, amenities),
// including any Live Editor edits. Keeps location keywords for search value.
function renderSeoText() {
    const wrap = document.getElementById('seo-cottages');
    if (!wrap) return;
    const esc = (s) =>
        String(s || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    // Prefer a Live Editor override (localStorage), else the content default.
    const val = (key, fallback) => {
        try {
            const s = localStorage.getItem(key);
            if (s) return decodeEntities(s);
        } catch (e) {}
        return fallback;
    };
    // Every live cottage (owner-added included), not just the original three.
    const order =
        typeof liveCottageKeys === 'function' && liveCottageKeys().length
            ? liveCottageKeys()
            : ['21a', 'jollyboat', 'pimpernel'];
    const html = order
        .map((k) => {
            const c = propertyContent[k] || {};
            const meta = propertyMeta[k] || {};
            const title = esc(val(k + '-title', c.title || meta.name || ''));
            if (!title) return '';
            const desc = esc(val(k + '-desc', c.desc || ''));
            const ams =
                Array.isArray(c.amenities) && c.amenities.length
                    ? ` Features include ${c.amenities.map(esc).join(', ')}.`
                    : '';
            return (
                `<section><h2>${title} — holiday cottage in Blakeney, Norfolk</h2>` +
                `<p>${desc}${ams} Self-catering holiday cottage in Blakeney, North Norfolk.</p></section>`
            );
        })
        .join('');
    if (html.trim()) wrap.innerHTML = html;
}

// Inject live structured data (guest review stars, contact number, FAQs) so
// Google's rich results reflect real, current content. These nodes share
// @ids with the static graph in <head>, so Google merges them — e.g. the
// aggregateRating + reviews attach to the #business LodgingBusiness node.
function injectSeoSchema() {
    try {
        const BASE = 'https://cottageholidaysblakeney.co.uk/';
        const graph = [];
        const clamp = (s) => Math.max(1, Math.min(5, parseInt(s) || 5));

        const biz = { '@type': 'LodgingBusiness', '@id': BASE + '#business' };
        const cp = (typeof siteContent !== 'undefined' && siteContent['contact-phone']) || {};
        if (cp.dial) biz.telephone = cp.dial;

        const reviews = Array.isArray(publicGuestReviews)
            ? publicGuestReviews.filter((r) => r && (r.text || '').trim())
            : [];
        if (reviews.length) {
            const ratings = reviews.map((r) => clamp(r.stars));
            const avg = ratings.reduce((s, n) => s + n, 0) / ratings.length;
            biz.aggregateRating = {
                '@type': 'AggregateRating',
                ratingValue: avg.toFixed(1),
                reviewCount: String(reviews.length),
                bestRating: '5',
                worstRating: '1',
            };
            biz.review = reviews.slice(0, 12).map((r) => ({
                '@type': 'Review',
                author: { '@type': 'Person', name: r.name || 'A guest' },
                reviewRating: {
                    '@type': 'Rating',
                    ratingValue: String(clamp(r.stars)),
                    bestRating: '5',
                    worstRating: '1',
                },
                reviewBody: r.text || '',
            }));
        }
        if (biz.telephone || biz.aggregateRating) graph.push(biz);

        const seen = {};
        const faqEntities = [];
        const faqKeys =
            typeof liveCottageKeys === 'function' && liveCottageKeys().length
                ? liveCottageKeys()
                : ['21a', 'jollyboat', 'pimpernel'];
        faqKeys.forEach((k) => {
            const list = Array.isArray(siteContent['faqs-' + k]) ? siteContent['faqs-' + k] : [];
            list.forEach((f) => {
                const q = ((f && f.q) || '').trim(),
                    a = ((f && f.a) || '').trim();
                if (!q || !a || seen[q.toLowerCase()]) return;
                seen[q.toLowerCase()] = 1;
                faqEntities.push({
                    '@type': 'Question',
                    name: q,
                    acceptedAnswer: { '@type': 'Answer', text: a },
                });
            });
        });
        if (faqEntities.length)
            graph.push({ '@type': 'FAQPage', '@id': BASE + '#faq', mainEntity: faqEntities });

        if (!graph.length) return;
        let el = document.getElementById('seo-dynamic');
        if (!el) {
            el = document.createElement('script');
            el.type = 'application/ld+json';
            el.id = 'seo-dynamic';
            document.head.appendChild(el);
        }
        el.textContent = JSON.stringify({ '@context': 'https://schema.org', '@graph': graph });
    } catch (e) {
        /* SEO enrichment must never break the page */
    }
}

// ---- Clean per-cottage URLs (/cottages/<slug>) for shareable, indexable links ----
const COTTAGE_SLUGS = { '21a': '21a-westgate', jollyboat: 'jollyboat', pimpernel: 'pimpernel' };
const SLUG_TO_KEY = { '21a-westgate': '21a', jollyboat: 'jollyboat', pimpernel: 'pimpernel' };
const SITE_ORIGIN = 'https://cottageholidaysblakeney.co.uk';
const DEFAULT_DOC_TITLE = document.title;
let __suppressRouteSync = false; // set while reacting to back/forward so we don't re-push

// Update <title> + canonical + og:url so each cottage URL has its own SEO snippet.
function updateRouteSeo(propKey) {
    const canonical = document.querySelector('link[rel="canonical"]');
    const ogUrl = document.querySelector('meta[property="og:url"]');
    const ogTitle = document.querySelector('meta[property="og:title"]');
    const ogDesc = document.querySelector('meta[property="og:description"]');
    const ogImage = document.querySelector('meta[property="og:image"]');
    const metaDesc = document.querySelector('meta[name="description"]');
    // Remember the homepage defaults the first time, so we can restore them on the way out.
    if (!window.__seoDefaults) {
        window.__seoDefaults = {
            title: DEFAULT_DOC_TITLE,
            desc: metaDesc ? metaDesc.getAttribute('content') : '',
            ogTitle: ogTitle ? ogTitle.getAttribute('content') : '',
            ogDesc: ogDesc ? ogDesc.getAttribute('content') : '',
            ogImage: ogImage ? ogImage.getAttribute('content') : '',
        };
    }
    const D = window.__seoDefaults;
    if (!propKey) {
        document.title = DEFAULT_DOC_TITLE;
        if (canonical) canonical.setAttribute('href', SITE_ORIGIN + '/');
        if (ogUrl) ogUrl.setAttribute('content', SITE_ORIGIN + '/');
        if (ogTitle) ogTitle.setAttribute('content', D.ogTitle);
        if (metaDesc) metaDesc.setAttribute('content', D.desc);
        if (ogDesc) ogDesc.setAttribute('content', D.ogDesc);
        if (ogImage) ogImage.setAttribute('content', D.ogImage);
        return;
    }
    const meta = propertyMeta[propKey] || {};
    const content = propertyContent[propKey] || {};
    const url = SITE_ORIGIN + '/cottages/' + COTTAGE_SLUGS[propKey];
    const title =
        (meta.name || 'Cottage') +
        ' — Holiday Cottage in Blakeney, Norfolk | Cottage Holidays Blakeney';
    // Description: this cottage's own text (trimmed for a snippet), else a sensible default.
    let desc = (content.desc || '').replace(/\s+/g, ' ').trim();
    if (desc.length > 160) desc = desc.slice(0, 157).trim() + '…';
    if (!desc)
        desc = (meta.name || 'A self-catering holiday cottage') + ' in Blakeney, North Norfolk.';
    // Social image: this cottage's first photo, else its card, made absolute.
    let img = (Array.isArray(content.images) && content.images[0]) || 'card-' + propKey + '.jpg';
    if (img && !/^https?:\/\//i.test(img)) img = SITE_ORIGIN + '/' + img.replace(/^\//, '');
    document.title = title;
    if (canonical) canonical.setAttribute('href', url);
    if (ogUrl) ogUrl.setAttribute('content', url);
    if (ogTitle) ogTitle.setAttribute('content', title);
    if (metaDesc) metaDesc.setAttribute('content', desc);
    if (ogDesc) ogDesc.setAttribute('content', desc);
    if (ogImage) ogImage.setAttribute('content', img);
}
// Reflect the open cottage in the address bar (push, or replace if already there).
function syncCottageUrl(propKey) {
    const slug = COTTAGE_SLUGS[propKey];
    if (!slug) return;
    const url = '/cottages/' + slug;
    if (!__suppressRouteSync) {
        try {
            (location.pathname === url ? history.replaceState : history.pushState).call(
                history,
                { cottage: propKey },
                '',
                url,
            );
        } catch (e) {}
    }
    updateRouteSeo(propKey);
}
// Leaving a cottage page (or /experiences): restore the root URL + default SEO.
function clearCottageUrl() {
    const onRouted =
        /\/cottages\//.test(location.pathname || '') ||
        /^\/experiences\/?$/.test(location.pathname || '');
    if (onRouted && !__suppressRouteSync) {
        try {
            history.pushState({}, '', '/');
        } catch (e) {}
    }
    if (/\/cottages\//.test(location.pathname || '')) updateRouteSeo(null);
}
// On first load (or back/forward), open the cottage named in the URL, if any.
function maybeOpenCottageRoute() {
    const m = (location.pathname || '').match(/\/cottages\/([^\/?#]+)/);
    if (!m) return false;
    const key = SLUG_TO_KEY[(m[1] || '').toLowerCase()];
    if (!key) return false;
    __suppressRouteSync = true;
    try {
        openProperty(key);
    } finally {
        __suppressRouteSync = false;
    }
    return true;
}
window.addEventListener('popstate', (ev) => {
    // Admin locations replay from the recorded state, so Back walks
    // drill-down → index → dashboard rather than exiting to the homepage.
    const st = ev.state && ev.state.chbAdmin;
    if (st && isAuthenticated) {
        __histReplay = true;
        try {
            if (st.view === 'view-settings') {
                nav('view-settings');
                if (st.section) settingsOpen(st.section);
                else settingsShowIndex();
            } else if (st.view === 'view-accounts') {
                nav('view-accounts');
                if (st.section) accountsOpen(st.section);
                else accountsShowIndex();
            } else {
                nav('view-backoffice');
                Promise.resolve(initBackOffice()).catch(() => {});
            }
        } catch (e) {
        } finally {
            __histReplay = false;
        }
        return;
    }
    __suppressRouteSync = true;
    try {
        const m = (location.pathname || '').match(/\/cottages\/([^\/?#]+)/);
        const key = m && SLUG_TO_KEY[(m[1] || '').toLowerCase()];
        if (key) openProperty(key);
        else if (/^\/experiences\/?$/.test(location.pathname || '')) nav('view-experiences');
        else {
            updateRouteSeo(null);
            nav('view-main');
        }
    } finally {
        __suppressRouteSync = false;
    }
});

// Internal cottage links use a real <a href="/cottages/…"> (crawlable, and
// cmd/ctrl-click opens a new tab) but navigate in-app on a plain click.
function cottageLink(e, key) {
    if (e && (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button)) return true;
    if (e) e.preventDefault();
    openProperty(key);
    return false;
}
// Open a cottage's dedicated page, populating it from that property's content + rates
function openProperty(propKey) {
    // A cottage the owner added has rates but maybe no hardcoded content yet —
    // synthesize a minimal content entry so it gets a real page (text/photos
    // then come from its saved overrides). Only fall back if the key is unknown.
    if (!propertyContent[propKey]) {
        if (propertyRates[propKey] || (propertyMeta[propKey] && !propertyMeta[propKey].archived)) {
            propertyContent[propKey] = {
                title: (propertyMeta[propKey] && propertyMeta[propKey].name) || propKey,
                desc: '',
                amenities: [],
                images: [],
            };
        } else {
            propKey = liveCottageKeys()[0] || '21a';
        }
    }
    activeFrontProperty = propKey;
    loadAvailability(propKey); // prefetch booked dates for the date picker
    availCalMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    renderAvailCal();
    loadPropContentOverrides();
    const c = propertyContent[propKey];

    // Title + description + subtitle (guests/beds/baths — editable per cottage)
    document.getElementById('prop-title').innerText = c.title;
    document.getElementById('prop-desc').innerText = c.desc;
    const subEl = document.getElementById('prop-subtitle');
    if (subEl) subEl.innerText = propSubtitleDefault[propKey] || '';

    // Dynamic price heading (couple rate from Settings & Fees)
    updatePropPriceHeading();

    // Gallery images (dynamic — any number of photos)
    galleryState['gallery-21a'] = 0;
    renderGallery(c.images);

    // Amenities (display-only on the cottage page; edited in Settings)
    activePropAmenities = Array.isArray(c.amenities) ? c.amenities.slice() : [];
    renderAmenities(propKey);

    // Safety & property list (editable per cottage)
    activePropSafety = Array.isArray(c.safety) ? c.safety.slice() : DEFAULT_SAFETY.slice();
    renderSafety(propKey);

    // Point this cottage's elements at its namespaced content keys
    // (data-edit-* is the rendering path applyContentOverrides reads).
    document.getElementById('prop-title').setAttribute('data-edit-text', `${propKey}-title`);
    document.getElementById('prop-desc').setAttribute('data-edit-text', `${propKey}-desc`);
    if (subEl) subEl.setAttribute('data-edit-text', `${propKey}-subtitle`);
    document
        .getElementById('prop-price-tagline')
        .setAttribute('data-edit-text', `${propKey}-tagline`);
    // Things-to-know + location: per-cottage editable text
    const setEdit = (id, key) => {
        const el = document.getElementById(id);
        if (el) el.setAttribute('data-edit-text', key);
    };
    setEdit('prop-location', `${propKey}-location`);
    // Cancellation policy text is chosen in Settings (not free-text edited here),
    // so make sure it's never contentEditable, then fill it from the saved policy.
    const cancEl = document.getElementById('prop-cancellation');
    if (cancEl) {
        cancEl.removeAttribute('data-edit-text');
        cancEl.contentEditable = 'false';
    }
    // Gallery photos are edited via the gallery edit bar (add/replace/remove),
    // not per-slide click, so no data-edit-img wiring is needed here.
    // Restore any saved edits for these namespaced keys
    applySavedEdits();
    // Cancellation policy text comes from the per-cottage choice in Settings.
    applyCancellationText(propKey);

    // Wire the submit button to this property
    document.getElementById('enq-submit-btn').onclick = () => submitEnquiry(propKey);

    // Apply this property's occupancy limits to the form inputs + hint
    applyOccupancyToForm(propKey);

    // Reflect any existing dates on the custom picker trigger
    refreshDateTrigger();

    // Pre-fill the form for a logged-in guest
    autofillGuestEnquiry();

    // Reset / refresh price box
    updateEnquiryPrice();

    // This cottage's guest reviews + Airbnb-style stats/features/booking bar
    try {
        renderPropReviews(propKey);
    } catch (e) {}
    try {
        renderPropStats(propKey);
    } catch (e) {}
    try {
        renderHouseRules(propKey);
    } catch (e) {}
    try {
        renderLocalGuide(propKey);
    } catch (e) {}
    try {
        renderGuestPhotos(propKey);
    } catch (e) {}
    try {
        renderTides();
    } catch (e) {}
    try {
        renderLocationMap(propKey);
    } catch (e) {}
    try {
        renderHost();
    } catch (e) {}
    try {
        renderPropFeatures(propKey);
    } catch (e) {}
    try {
        updateBookBar();
    } catch (e) {}

    nav('view-21a');
    try {
        syncCottageUrl(propKey);
    } catch (e) {} // clean URL + per-cottage SEO snippet
    try {
        setupPropDescClamp();
    } catch (e) {} // clamp long descriptions once the view is visible
    try {
        placeAvailCalendar();
    } catch (e) {} // desktop: tuck calendar above "Enquire now"
}

// Re-apply saved data-edit values (used after we swap namespaced keys in)
function applySavedEdits() {
    // Backend (shared) content first, then any local cache on top
    applyContentOverrides(document.getElementById('view-21a'));
    document.querySelectorAll('#view-21a [data-edit-text]').forEach((el) => {
        const saved = localStorage.getItem(el.getAttribute('data-edit-text'));
        if (saved) el.textContent = decodeEntities(saved);
    });
    document.querySelectorAll('#view-21a [data-edit-img]').forEach((el) => {
        const saved = localStorage.getItem(el.getAttribute('data-edit-img'));
        if (saved) el.style.backgroundImage = `url('${saved}')`;
    });
}

function updateEnquiryPrice() {
    try {
        const m = document.getElementById('enquire-modal');
        if (m && m.classList.contains('open')) enquireDraftSave();
    } catch (e) {}
    const box = document.getElementById('enq-price-box');
    if (!box) return;
    const checkIn = document.getElementById('enq-checkin').value;
    const checkOut = document.getElementById('enq-checkout').value;
    const adults = Math.max(1, parseInt(document.getElementById('enq-adults').value, 10) || 0);
    const children = Math.max(0, parseInt(document.getElementById('enq-children').value, 10) || 0);

    // Real-time feedback on the chosen dates, so the visitor sees a problem
    // (e.g. below the minimum stay, or a non-arrival day) before they submit.
    const rulesHint = document.getElementById('enq-rules-hint');
    if (rulesHint) {
        let warn = '';
        if (checkIn && checkOut) {
            if (checkOut <= checkIn) warn = 'Your check-out date must be after your check-in date.';
            else warn = checkBookingRules(activeFrontProperty, checkIn, checkOut) || '';
        }
        if (warn) {
            rulesHint.textContent = '⚠ ' + warn;
            rulesHint.classList.add('hint-warn');
        } else {
            rulesHint.textContent = bookingRulesHint(activeFrontProperty);
            rulesHint.classList.remove('hint-warn');
        }
    }

    if (!checkIn || !checkOut || checkOut <= checkIn) {
        const r = propertyRates[activeFrontProperty] || defaultRates[activeFrontProperty];
        box.innerHTML = `<p style="color: var(--text-light); font-size: 0.95rem; text-align: center; margin: 0;">From <strong>${gbp(r.coupleRate)}</strong> <span style="color: var(--text-muted);">/ night for a couple</span><br><span style="color: var(--text-muted); font-size: 0.8rem;">Refundable damages deposit ${gbp(r.damagesDeposit)} · select dates to see your full price.</span></p>`;
        try {
            updateBookBar();
        } catch (e) {}
        return;
    }
    const p = priceBreakdown(activeFrontProperty, adults, children, checkIn, checkOut);
    const r = propertyRates[activeFrontProperty] || defaultRates[activeFrontProperty];
    const extras = [];
    if (p.extraAdults > 0)
        extras.push(`${p.extraAdults} extra adult${p.extraAdults === 1 ? '' : 's'}`);
    if (children > 0) extras.push(`${children} child${children === 1 ? '' : 'ren'}`);
    box.innerHTML = `
                <div class="price-row total" style="border-top:none;padding-top:0;"><span>From</span><span><span class="price-amount">${gbp(p.rentalTotal)}</span> <span style="font-size:0.7rem;color:var(--text-muted);font-weight:400;">*fees inc</span></span></div>
                <div class="price-row" style="margin-top:12px;"><span>Refundable damages deposit</span><span>${gbp(p.damagesDeposit)}</span></div>
                <p style="color: var(--text-muted); font-size: 0.78rem; text-align: center; margin: 10px 0 0; line-height: 1.45;">Subject to change before booking has been confirmed — we will contact you to give an accurate price.</p>
            `;
    try {
        updateBookBar();
    } catch (e) {}
}

// Set the enquiry form's adult/child max attributes + hint for a property.
// Enquiry popup guest steppers (bound to the hidden #enq-adults/#enq-children
// inputs the rest of the form reads). Mirrors the hero search's hsAdjust.
function enqAdjust(field, delta) {
    const input = document.getElementById('enq-' + field);
    if (!input) return;
    const lim = occupancyLimits[activeFrontProperty] || {};
    const maxTotal = lim.maxTotal != null ? lim.maxTotal : 99;
    const adults = Math.max(
        0,
        parseInt((document.getElementById('enq-adults') || {}).value, 10) || 0,
    );
    const children = Math.max(
        0,
        parseInt((document.getElementById('enq-children') || {}).value, 10) || 0,
    );
    let v = (parseInt(input.value, 10) || 0) + delta;
    if (field === 'adults') {
        // Cap by this cottage's adult limit AND the total (leaving room for any children).
        const cap = Math.min(lim.maxAdults != null ? lim.maxAdults : 99, maxTotal - children);
        v = Math.max(1, Math.min(cap, v));
    } else {
        const cap = Math.min(lim.maxChildren != null ? lim.maxChildren : 99, maxTotal - adults);
        v = Math.max(0, Math.min(cap, v));
    }
    input.value = v;
    const cnt = document.getElementById('enq-' + field + '-count');
    if (cnt) cnt.textContent = v;
    try {
        onOccupancyInput();
    } catch (e) {}
    try {
        updateEnquiryPrice();
    } catch (e) {}
}
function applyOccupancyToForm(propKey) {
    const lim = occupancyLimits[propKey];
    const aEl = document.getElementById('enq-adults');
    const cEl = document.getElementById('enq-children');
    const hint = document.getElementById('enq-occupancy-hint');
    if (lim) {
        if (aEl) aEl.max = lim.maxAdults;
        if (cEl) cEl.max = lim.maxChildren;
        // Clamp current values down if they exceed the new property's limits
        if (aEl && parseInt(aEl.value, 10) > lim.maxAdults) aEl.value = lim.maxAdults;
        if (cEl && parseInt(cEl.value, 10) > lim.maxChildren) cEl.value = lim.maxChildren;
        // …and keep the party within the total (trim children first, then adults).
        if (lim.maxTotal != null && aEl && cEl) {
            let a = parseInt(aEl.value, 10) || 0,
                c = parseInt(cEl.value, 10) || 0;
            if (a + c > lim.maxTotal) {
                c = Math.max(0, lim.maxTotal - a);
                cEl.value = c;
            }
            if (a + c > lim.maxTotal) {
                aEl.value = Math.max(1, lim.maxTotal - c);
            }
        }
    }
    // Hide the Children field entirely when this cottage allows no children.
    const cField = document.getElementById('enq-children-field');
    const allowChildren = !lim || lim.maxChildren > 0;
    if (cField) cField.style.display = allowChildren ? '' : 'none';
    if (!allowChildren && cEl) cEl.value = 0;
    if (aEl && (parseInt(aEl.value, 10) || 0) < 1) aEl.value = 1;
    // Reflect the (clamped) hidden-input values on the visible steppers.
    const ac = document.getElementById('enq-adults-count');
    if (ac && aEl) ac.textContent = aEl.value;
    const cc = document.getElementById('enq-children-count');
    if (cc && cEl) cc.textContent = cEl.value;
    if (hint) hint.innerText = occupancyHint(propKey);
    const rHint = document.getElementById('enq-rules-hint');
    if (rHint) rHint.innerText = bookingRulesHint(propKey);
}

// Friendly one-line summary of a property's booking rules.
function bookingRulesHint(propKey) {
    const r = propertyRates[propKey] || defaultRates[propKey] || {};
    const parts = [];
    const minN = Math.max(1, parseInt(r.minNights, 10) || 1);
    if (minN > 1) parts.push(`${minN}-night minimum stay`);
    const maxN = Math.max(0, parseInt(r.maxNights, 10) || 0);
    if (maxN > 0) parts.push(`${maxN}-night maximum stay`);
    const days = Array.isArray(r.arrivalDays) ? r.arrivalDays : [];
    if (days.length > 0) {
        const names = days
            .slice()
            .sort((a, b) => a - b)
            .map((i) => DAY_NAMES[i]);
        parts.push(`arrivals on ${names.join(', ')}`);
    }
    parts.push(`check-in ${r.checkInTime || '15:00'}, check-out ${r.checkOutTime || '10:00'}`);
    return parts.join(' · ');
}

// Live clamp as the visitor types, so they can't exceed the limits.
function onOccupancyInput() {
    const lim = occupancyLimits[activeFrontProperty];
    if (!lim) return;
    const aEl = document.getElementById('enq-adults');
    const cEl = document.getElementById('enq-children');
    let a = Math.max(1, parseInt(aEl.value, 10) || 1);
    let c = Math.max(0, parseInt(cEl.value, 10) || 0);
    if (a > lim.maxAdults) a = lim.maxAdults;
    if (c > lim.maxChildren) c = lim.maxChildren;
    // Enforce the combined total by trimming children first, then adults
    if (a + c > lim.maxTotal) {
        const overflow = a + c - lim.maxTotal;
        const trimC = Math.min(c, overflow);
        c -= trimC;
        const stillOver = a + c - lim.maxTotal;
        if (stillOver > 0) a -= stillOver;
    }
    if (String(a) !== aEl.value) aEl.value = a;
    if (String(c) !== cEl.value) cEl.value = c;
}

async function submitEnquiry(propKey) {
    const name = document.getElementById('enq-name').value.trim();
    const email = document.getElementById('enq-email').value.trim();
    const phone = document.getElementById('enq-phone').value.trim();
    const address = document.getElementById('enq-address').value.trim();
    const postcode = normalizeUkPostcode(document.getElementById('enq-postcode').value);
    const checkIn = document.getElementById('enq-checkin').value;
    const checkOut = document.getElementById('enq-checkout').value;
    const adults = Math.max(1, parseInt(document.getElementById('enq-adults').value, 10) || 0);
    const children = Math.max(0, parseInt(document.getElementById('enq-children').value, 10) || 0);
    const message = document.getElementById('enq-message').value.trim();

    setEnqMsg('details', '');
    if (!name || !checkIn || !checkOut) {
        setEnqMsg('details', 'Please fill in your name and both dates.');
        return;
    }
    if (!address) {
        setEnqMsg('details', 'Please enter your UK address.');
        return;
    }
    if (!isUkPostcode(postcode)) {
        setEnqMsg('details', 'Please enter a valid UK postcode.');
        return;
    }
    if (checkOut <= checkIn) {
        setEnqMsg('details', 'Your check-out date must be after your check-in date.');
        return;
    }
    const ruleErr = checkBookingRules(propKey, checkIn, checkOut);
    if (ruleErr) {
        setEnqMsg('details', ruleErr);
        return;
    }
    const occErr = checkOccupancy(propKey, adults, children);
    if (occErr) {
        setEnqMsg('details', occErr);
        return;
    }
    const termsBox = document.getElementById('enq-terms');
    if (!termsBox || !termsBox.checked) {
        setEnqMsg(
            'details',
            'Please read and accept the Booking Terms & Conditions before sending your enquiry.',
        );
        return;
    }

    // Disable the button + show progress so a slow connection can't be
    // double-submitted into duplicate enquiries.
    const submitBtn = document.getElementById('enq-submit-btn');
    const origSubmitLabel = submitBtn ? submitBtn.textContent : '';
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.classList.add('is-busy');
        submitBtn.textContent = 'Sending…';
    }
    let enqResp = null;
    try {
        const rr = propertyRates[propKey] || defaultRates[propKey] || {};
        enqResp = await apiPost('enquiries.php', {
            action: 'submit',
            prop_key: propKey,
            name,
            email,
            phone,
            address,
            postcode,
            check_in: checkIn,
            check_out: checkOut,
            check_in_time: rr.checkInTime || '15:00',
            check_out_time: rr.checkOutTime || '10:00',
            adults,
            children,
            message,
            terms_accepted: true,
            terms_version: TERMS_VERSION,
        });
    } catch (e) {
        setEnqMsg('details', "Sorry, your enquiry couldn't be sent: " + e.message);
        return;
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.classList.remove('is-busy');
            submitBtn.textContent = origSubmitLabel;
        }
    }
    try {
        trackEvent('enquiry_submit', propKey);
    } catch (e) {}

    // Not signed in? The enquiry is already sent, so offer an optional one-tap
    // account from the details just entered (step 3). Signed-in guests skip this.
    const acctStep = document.getElementById('enquire-step-account');
    if (!currentGuest && acctStep) {
        __enqAcct = { name, email, phone, address, postcode };
        // If this email already has an account, show "sign in" instead of "create".
        const exists = !!(enqResp && enqResp.account_exists);
        const newBlk = document.getElementById('enq-acct-new');
        const existBlk = document.getElementById('enq-acct-existing');
        if (newBlk) newBlk.style.display = exists ? 'none' : '';
        if (existBlk) existBlk.style.display = exists ? '' : 'none';
        const d = document.getElementById('enquire-step-details');
        if (d) d.style.display = 'none';
        acctStep.style.display = '';
        setEnqStep(3);
        const am = document.getElementById('enq-acct-msg');
        if (am) {
            am.textContent = '';
            am.classList.remove('show');
        }
        if (!exists) {
            const pw = document.getElementById('enq-acct-password');
            if (pw) {
                pw.value = '';
                setTimeout(() => {
                    try {
                        pw.focus();
                    } catch (e) {}
                }, 80);
            }
        }
        return;
    }

    resetEnquiryForm();
    try {
        closeEnquireModal();
    } catch (e) {}
    enquireDraftClear();
    toast('Enquiry sent — we will be in touch to confirm availability.');
}
// Stashed details for the optional post-enquiry account creation (step 3).
let __enqAcct = null;
// Clear the enquiry form back to its defaults.
function resetEnquiryForm() {
    [
        'enq-name',
        'enq-email',
        'enq-phone',
        'enq-address',
        'enq-postcode',
        'enq-checkin',
        'enq-checkout',
        'enq-message',
    ].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    const a = document.getElementById('enq-adults');
    if (a) a.value = 2;
    const c = document.getElementById('enq-children');
    if (c) c.value = 0;
    const tb = document.getElementById('enq-terms');
    if (tb) tb.checked = false;
    dpState.start = null;
    dpState.end = null;
    try {
        refreshDateTrigger();
    } catch (e) {}
    try {
        updateEnquiryPrice();
    } catch (e) {}
    try {
        autofillGuestEnquiry();
    } catch (e) {} // re-fill + re-lock for a logged-in guest
}
// Create the guest's account from the details they just used for the enquiry.
async function enquireCreateAccount() {
    const msg = document.getElementById('enq-acct-msg');
    const setM = (t) => {
        if (msg) {
            msg.textContent = t;
            msg.classList.add('show');
        }
    };
    const pwd = (document.getElementById('enq-acct-password') || {}).value || '';
    if (!__enqAcct || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(__enqAcct.email || '')) {
        setM('We need a valid email to create your account.');
        return;
    }
    if (pwd.length < 4) {
        setM('Please choose a password of at least 4 characters.');
        return;
    }
    const btn = document.getElementById('enq-acct-btn');
    if (btn) {
        btn.disabled = true;
        btn.classList.add('is-busy');
    }
    try {
        const res = await apiPost('auth.php', {
            action: 'guest_register',
            name: __enqAcct.name,
            email: __enqAcct.email,
            phone: __enqAcct.phone,
            address: __enqAcct.address,
            postcode: __enqAcct.postcode,
            password: pwd,
        });
        currentGuest = res.guest;
        isAuthenticated = false;
        setAuthUI(); // one role at a time
        setGuestUI();
        __enqAcct = null;
        resetEnquiryForm();
        try {
            closeEnquireModal();
        } catch (e) {}
        enquireDraftClear();
        toast("Enquiry sent and your account is ready — you're signed in.");
        try {
            nav('view-guest-bookings');
            await renderGuestBookings();
        } catch (e) {}
    } catch (e) {
        setM(
            /exist|registered|already/i.test((e && e.message) || '')
                ? 'You already have an account with this email — close this and sign in.'
                : (e && e.message) || 'Sorry, your account could not be created.',
        );
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.classList.remove('is-busy');
        }
    }
}
// Returning guest: close the enquiry modal and open the sign-in modal with their
// email prefilled (the enquiry has already been sent).
function enquireSignInInstead() {
    const email = (__enqAcct && __enqAcct.email) || '';
    __enqAcct = null;
    resetEnquiryForm();
    try {
        closeEnquireModal();
    } catch (e) {}
    try {
        openGuestAuthModal();
        switchGuestTab('login');
    } catch (e) {}
    const f = document.getElementById('login-email');
    if (f && email) f.value = email;
    enquireDraftClear();
    try {
        toast('Enquiry sent — sign in to track it.');
    } catch (e) {}
}
// Skip the optional account step — the enquiry has already been sent.
function enquireSkipAccount() {
    __enqAcct = null;
    resetEnquiryForm();
    try {
        closeEnquireModal();
    } catch (e) {}
    enquireDraftClear();
    toast('Enquiry sent — we will be in touch to confirm availability.');
}

// ===================================================================
//  INBOX
// ===================================================================
function refreshInboxBadge() {
    const badge = document.getElementById('inbox-badge');
    if (!badge) return;
    const n = enquiries.length;
    badge.innerText = n;
    badge.classList.toggle('zero', n === 0);
}

function renderInbox() {
    refreshInboxBadge();
    const tg = document.getElementById('enq-nudge-toggle');
    if (tg) tg.checked = siteContent['enquiry-nudge-off'] !== '1';
    const ag = document.getElementById('anniv-nudge-toggle');
    if (ag) ag.checked = siteContent['anniversary-nudge-off'] !== '1';
    const list = document.getElementById('inbox-list');

    if (enquiries.length === 0) {
        list.innerHTML = `<div class="inbox-empty-inline"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M8.5 12.5l2.5 2.5 4.5-5"/></svg> Inbox zero — no pending enquiries right now.</div>`;
        return;
    }

    list.innerHTML = enquiries
        .map((e) => {
            const meta = propertyMeta[e.propKey];
            const propName = meta ? meta.name : e.propKey; // survive a missing/added cottage
            const msg = e.message
                ? `<div class="enquiry-msg">“${escapeHtml(e.message)}”</div>`
                : '';
            return `
                <div class="enquiry-card">
                    <div class="enquiry-info">
                        <span class="prop-tag tag-${e.propKey}">${escapeHtml(propName)}</span>
                        <h3>${escapeHtml(e.name)}</h3>
                        <div class="enquiry-meta">
                            <strong>${e.checkIn}</strong> → <strong>${e.checkOut}</strong><br>
                            Party: ${escapeHtml(e.guests)} · Received ${e.received}
                            ${e.email ? '<br><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M4 6.5l8 6 8-6"/></svg> ' + escapeHtml(e.email) : ''}
                            ${e.phone ? '<br><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6.6 3.5l2.1.4 1 3-1.5 1.4a12 12 0 0 0 5 5l1.4-1.5 3 1 .4 2.1a2 2 0 0 1-2 2.3A15.5 15.5 0 0 1 4.3 5.5a2 2 0 0 1 2.3-2z"/></svg>' + escapeHtml(e.phone) : ''}
                            ${e.address || e.postcode ? '<br><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 11l8-7 8 7"/><path d="M6 10v9h12v-9"/></svg> <span style="white-space:pre-wrap;">' + escapeHtml([e.address, e.postcode].filter(Boolean).join(', ')) + '</span>' : ''}
                        </div>
                        ${msg}
                    </div>
                    <div class="enquiry-actions">
                        <button class="btn-sm btn-approve" onclick="approveEnquiry('${e.id}')">✓ Approve</button>
                        <button class="btn-sm btn-edit" onclick="openEditEnquiry('${e.id}')">Edit / Move</button>
                        <button class="btn-sm btn-decline" onclick="declineEnquiry('${e.id}')"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg> Decline</button>
                    </div>
                </div>`;
        })
        .join('');
}

function escapeHtml(str) {
    return String(str).replace(
        /[&<>"']/g,
        (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
    );
}

// Decode HTML entities in a saved string (self-heals values that were
// accidentally stored with literal &amp; / &lt; etc. from older versions).
function decodeEntities(str) {
    if (typeof str !== 'string' || str.indexOf('&') === -1) return str;
    const t = document.createElement('textarea');
    t.innerHTML = str;
    return t.value;
}

async function declineEnquiry(enqId) {
    if (!(await glassConfirm('Decline and remove this enquiry? This cannot be undone.'))) return;
    const enq = enquiries.find((e) => e.id === enqId);
    if (!enq) return;
    try {
        await apiPost('enquiries.php', { action: 'decline', id: enq.dbId });
        await loadData();
        renderInbox();
    } catch (e) {
        glassAlert("Couldn't decline: " + e.message);
    }
}

async function approveEnquiry(enqId) {
    const enq = enquiries.find((e) => e.id === enqId);
    if (!enq) return;
    if (hasDateClash(enq.propKey, enq.checkIn, enq.checkOut)) {
        if (
            !(await glassConfirm(
                `Heads up: these dates clash with an existing booking or an imported Airbnb/Vrbo block at ${propertyMeta[enq.propKey].name}. Approve anyway?`,
            ))
        )
            return;
    }
    try {
        const res = await apiPost('enquiries.php', { action: 'approve', id: enq.dbId });
        await loadData();
        renderInbox();
        renderCalendar();
        showChangeoverToasts();
        let note = `Booking confirmed for ${enq.name} at ${propertyMeta[enq.propKey].name}. It's now on the calendar.`;
        const em = res && res.email;
        if (em && em.guest) {
            if (em.guest.ok) note += `\n\nA confirmation email was sent to ${enq.email}.`;
            else if (em.guest.error && em.guest.error !== 'Mail disabled')
                note += `\n\nNote: the confirmation email didn't send (${em.guest.error}). The booking is still confirmed — you may want to contact the guest directly.`;
        }
        glassAlert(note);
    } catch (e) {
        glassAlert("Couldn't approve: " + e.message);
    }
}

// ===================================================================
//  EDIT / MOVE MODAL  (shared by enquiries and confirmed bookings)
// ===================================================================
function openModal() {
    document.getElementById('edit-modal').classList.add('open');
}
function closeModal() {
    document.getElementById('edit-modal').classList.remove('open');
    document.getElementById('modal-error').style.display = 'none';
}

// Small helpers to read/write the modal field set
function setModalFields(f) {
    document.getElementById('modal-property').value = f.propKey || '21a';
    document.getElementById('modal-name').value = f.name || '';
    document.getElementById('modal-email').value = f.email || '';
    document.getElementById('modal-phone').value = f.phone || '';
    document.getElementById('modal-address').value = f.address || '';
    document.getElementById('modal-postcode').value = f.postcode || '';
    document.getElementById('modal-checkin').value = f.checkIn || '';
    document.getElementById('modal-checkout').value = f.checkOut || '';
    document.getElementById('modal-checkin-time').value = f.checkInTime || '15:00';
    document.getElementById('modal-checkout-time').value = f.checkOutTime || '10:00';
    document.getElementById('modal-adults').value = f.adults != null ? f.adults : 2;
    document.getElementById('modal-children').value = f.children != null ? f.children : 0;
    document.getElementById('modal-notes').value = f.notes || '';
    document.getElementById('modal-payment').value = f.payment || 'unpaid';
    const depEl = document.getElementById('modal-damages-deposit');
    if (depEl)
        depEl.value =
            f.agreedPrice && f.agreedPrice.damagesDeposit != null
                ? f.agreedPrice.damagesDeposit
                : f.damagesDeposit != null
                  ? f.damagesDeposit
                  : '';
    const ovEl = document.getElementById('modal-price-override');
    if (ovEl) ovEl.value = f.priceOverride != null ? f.priceOverride : '';
    updateModalPrice();
}

// Live total inside the Add/Edit modal
function updateModalPrice() {
    const box = document.getElementById('modal-price-box');
    if (!box) return;
    const propKey = document.getElementById('modal-property').value;
    const checkIn = document.getElementById('modal-checkin').value;
    const checkOut = document.getElementById('modal-checkout').value;
    const adults = Math.max(1, parseInt(document.getElementById('modal-adults').value, 10) || 0);
    const children = Math.max(
        0,
        parseInt(document.getElementById('modal-children').value, 10) || 0,
    );
    if (!checkIn || !checkOut || checkOut <= checkIn) {
        box.innerHTML = `<p style="color: var(--text-muted); font-size: 0.85rem; text-align: center; margin: 0;">Enter valid dates to see the total.</p>`;
        return;
    }
    const depEl = document.getElementById('modal-damages-deposit');
    const depOverride = depEl && depEl.value !== '' ? depEl.value : null;
    const p = priceBreakdown(propKey, adults, children, checkIn, checkOut, depOverride);
    const extras = [];
    if (p.extraAdults > 0)
        extras.push(`${p.extraAdults} extra adult${p.extraAdults === 1 ? '' : 's'}`);
    if (children > 0) extras.push(`${children} child${children === 1 ? '' : 'ren'}`);
    const perNightLabel = `Couple${extras.length ? ' + ' + extras.join(' + ') : ''}`;
    const ovEl = document.getElementById('modal-price-override');
    const override = ovEl && ovEl.value !== '' ? Math.max(0, parseFloat(ovEl.value) || 0) : null;
    let rows = `
                <div class="price-row"><span>${perNightLabel} × ${p.nights} night${p.nights === 1 ? '' : 's'}</span><span>${gbp(p.nightly)}</span></div>
                <div class="price-row"><span>Transaction fee (${p.transactionPct}%)</span><span>${gbp(p.txFee)}</span></div>
                <div class="price-row"><span>Refundable damages deposit</span><span>${gbp(p.damagesDeposit)}</span></div>`;
    if (override !== null) {
        rows += `
                <div class="price-row" style="opacity:0.6;"><span>Calculated total</span><span style="text-decoration:line-through;">${gbp(p.total)}</span></div>
                <div class="price-row total"><span>Override total</span><span class="price-amount">${gbp(override)}</span></div>`;
    } else {
        rows += `<div class="price-row total"><span>Total</span><span class="price-amount">${gbp(p.total)}</span></div>`;
    }
    box.innerHTML = rows;
}

function openAddBooking() {
    document.getElementById('modal-title').innerText = 'Add Booking';
    document.getElementById('modal-mode').value = 'add';
    document.getElementById('modal-record-id').value = '';
    setModalFields({}); // blank form, default times
    togglePaymentField(true);
    openModal();
}

function openEditEnquiry(enqId) {
    const enq = enquiries.find((e) => e.id === enqId);
    if (!enq) return;
    document.getElementById('modal-title').innerText = 'Edit / Move Enquiry';
    document.getElementById('modal-mode').value = 'enquiry';
    document.getElementById('modal-record-id').value = enq.id;
    setModalFields({
        propKey: enq.propKey,
        name: enq.name,
        email: enq.email,
        phone: enq.phone,
        address: enq.address,
        postcode: enq.postcode,
        checkIn: enq.checkIn,
        checkOut: enq.checkOut,
        checkInTime: enq.checkInTime,
        checkOutTime: enq.checkOutTime,
        adults: enq.adults,
        children: enq.children,
        notes: enq.message,
    });
    togglePaymentField(false);
    openModal();
}

function openEditBooking(bookingId) {
    const b = findBookingById(bookingId);
    const loc = findBookingLocation(bookingId);
    if (!b || !loc) return;
    document.getElementById('modal-title').innerText = 'Edit / Move Booking';
    document.getElementById('modal-mode').value = 'booking';
    document.getElementById('modal-record-id').value = b.id;
    setModalFields({
        propKey: loc.propKey,
        name: b.name,
        email: b.email,
        phone: b.phone,
        address: b.address,
        postcode: b.postcode,
        checkIn: b.checkIn,
        checkOut: b.checkOut,
        checkInTime: b.checkInTime,
        checkOutTime: b.checkOutTime,
        adults: b.adults,
        children: b.children,
        notes: b.notes,
        payment: b.payment,
    });
    togglePaymentField(true);
    openModal();
}

// Payment + notes labelling differs slightly between modes
function togglePaymentField(show) {
    const sel = document.getElementById('modal-payment');
    const lbl = sel.previousElementSibling; // its <label>
    sel.style.display = show ? 'block' : 'none';
    if (lbl && lbl.classList.contains('modal-label')) lbl.style.display = show ? 'block' : 'none';
    // Relabel the notes field
    const notesLabel = document.getElementById('modal-notes').previousElementSibling;
    if (notesLabel) notesLabel.innerText = show ? 'Staff Notes' : 'Guest Message';
}

async function saveModal() {
    const mode = document.getElementById('modal-mode').value;
    const id = document.getElementById('modal-record-id').value;
    const propKey = document.getElementById('modal-property').value;
    const name = document.getElementById('modal-name').value.trim();
    const email = document.getElementById('modal-email').value.trim();
    const phone = document.getElementById('modal-phone').value.trim();
    const address = document.getElementById('modal-address').value.trim();
    const postcode = document.getElementById('modal-postcode').value.trim();
    const checkIn = document.getElementById('modal-checkin').value;
    const checkOut = document.getElementById('modal-checkout').value;
    const checkInTime = document.getElementById('modal-checkin-time').value || '15:00';
    const checkOutTime = document.getElementById('modal-checkout-time').value || '10:00';
    const adults = Math.max(1, parseInt(document.getElementById('modal-adults').value, 10) || 0);
    const children = Math.max(
        0,
        parseInt(document.getElementById('modal-children').value, 10) || 0,
    );
    const notes = document.getElementById('modal-notes').value.trim();
    const payment = document.getElementById('modal-payment').value;
    const depEl = document.getElementById('modal-damages-deposit');
    const damagesDeposit =
        depEl && depEl.value !== '' ? Math.max(0, parseFloat(depEl.value) || 0) : null;
    const ovEl = document.getElementById('modal-price-override');
    // Empty string = explicitly clear the override; a value = set it.
    const priceOverride = ovEl ? ovEl.value.trim() : '';
    const errBox = document.getElementById('modal-error');
    const showErr = (m) => {
        errBox.innerText = m;
        errBox.style.display = 'block';
    };

    if (!name || !checkIn || !checkOut) {
        showErr('Name and both dates are required.');
        return;
    }
    if (checkOut <= checkIn) {
        showErr('Check-out must be after check-in.');
        return;
    }

    // Occupancy limit — owner can override with confirmation (e.g. a cot, an exception)
    const occErr = checkOccupancy(propKey, adults, children);
    if (occErr) {
        if (
            !(await glassConfirm(
                occErr + '\n\nThis is over the normal limit for this property. Save anyway?',
            ))
        ) {
            showErr(occErr);
            return;
        }
    }

    // ----- Enquiry edit -----
    if (mode === 'enquiry') {
        const enq = enquiries.find((e) => e.id === id);
        if (!enq) return;
        try {
            // Re-submit replaces the enquiry: decline the old, submit the new.
            await apiPost('enquiries.php', { action: 'decline', id: enq.dbId });
            await apiPost('enquiries.php', {
                action: 'submit',
                prop_key: propKey,
                name,
                email,
                phone,
                address,
                postcode,
                check_in: checkIn,
                check_out: checkOut,
                check_in_time: checkInTime,
                check_out_time: checkOutTime,
                adults,
                children,
                message: notes,
            });
            await loadData();
            closeModal();
            renderInbox();
        } catch (e) {
            showErr(e.message);
        }
        return;
    }

    // ----- Booking add / edit -----
    if (hasDateClash(propKey, checkIn, checkOut, mode === 'booking' ? id : null)) {
        if (
            !(await glassConfirm(
                `These dates clash with an existing booking or an imported Airbnb/Vrbo block at ${propertyMeta[propKey].name}. Save anyway?`,
            ))
        )
            return;
    }

    // If the status is "deposit", we need an amount. Ask for it (the server
    // also validates 0 < amount < total).
    let depositAmount = null;
    let paymentDate = null;
    let paymentMethod = null;
    if (payment === 'deposit' || payment === 'paid') {
        // For an edit, default to the existing recorded deposit/date/method.
        let existing = null;
        if (mode === 'booking') {
            const loc = findBookingLocation(id);
            if (loc) existing = dbBookings[loc.propKey][loc.idx];
        }
        if (payment === 'deposit') {
            const existingDep = existing && existing.depositPaid > 0 ? existing.depositPaid : '';
            const entered = await glassPrompt('Deposit amount paid (£):', existingDep);
            if (entered === null) return;
            depositAmount = Math.max(0, parseFloat(entered) || 0);
        }
        // Payment date required when money is recorded
        const existingDate =
            existing && existing.paymentDate ? existing.paymentDate : todayDashed();
        const d = await glassPrompt('Payment date (YYYY-MM-DD):', existingDate);
        if (d === null) return;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(d.trim())) {
            showErr('A valid payment date (YYYY-MM-DD) is required.');
            return;
        }
        paymentDate = d.trim();
        const m = await glassPrompt(
            'Payment method (Card / Bank Transfer / Cash / PayPal / Other) — optional:',
            (existing && existing.paymentMethod) || '',
        );
        paymentMethod = m === null ? '' : m.trim();
    }

    const payload = {
        prop_key: propKey,
        name,
        email,
        phone,
        address,
        postcode,
        check_in: checkIn,
        check_out: checkOut,
        check_in_time: checkInTime,
        check_out_time: checkOutTime,
        adults,
        children,
        notes,
        payment,
    };
    if (damagesDeposit !== null) payload.damages_deposit = damagesDeposit;
    // Always send price_override: a number sets it, '' clears it (revert to calculated)
    payload.price_override =
        priceOverride === '' ? '' : Math.max(0, parseFloat(priceOverride) || 0);
    if (depositAmount !== null) payload.deposit = depositAmount;
    if (paymentDate !== null) payload.payment_date = paymentDate;
    if (paymentMethod !== null) payload.payment_method = paymentMethod;

    try {
        let addRes = null;
        if (mode === 'add') {
            addRes = await apiPost('bookings.php', { action: 'add', ...payload });
            // Soft clash warning: confirm, then retry with override.
            if (addRes && addRes.clash) {
                if (!(await glassConfirm(addRes.message + '\n\nAdd this booking anyway?'))) return;
                addRes = await apiPost('bookings.php', {
                    action: 'add',
                    ...payload,
                    override_clash: true,
                });
            }
        } else {
            const loc = findBookingLocation(id);
            if (!loc) return;
            payload.id = dbBookings[loc.propKey][loc.idx].dbId;
            let upRes = await apiPost('bookings.php', { action: 'update', ...payload });
            if (upRes && upRes.clash) {
                if (!(await glassConfirm(upRes.message + '\n\nSave these changes anyway?'))) return;
                await apiPost('bookings.php', {
                    action: 'update',
                    ...payload,
                    override_clash: true,
                });
            }
            // Offer to email the guest the updated details (e.g. after a date change)
            if (
                payload.email &&
                (await glassConfirm(
                    `Booking updated. Email ${payload.email} an updated confirmation?`,
                ))
            ) {
                try {
                    await apiPost('bookings.php', { action: 'send_confirmation', id: payload.id });
                    toast('Updated confirmation sent.');
                } catch (e) {
                    glassAlert("Saved, but the email didn't send: " + e.message);
                }
            }
        }
        await loadData();
        closeModal();
        renderCalendar();
        clearDetails();
        showChangeoverToasts();
        // Tell the owner whether the auto-confirmation email went out
        if (mode === 'add' && addRes && addRes.email && addRes.email.guest) {
            if (addRes.email.guest.ok) {
                glassAlert(`Booking saved. A confirmation email was sent to ${payload.email}.`);
            } else if (
                addRes.email.guest.error &&
                addRes.email.guest.error !== 'Mail disabled' &&
                addRes.email.guest.error !== 'No guest email on file'
            ) {
                glassAlert(
                    `Booking saved, but the confirmation email didn't send (${addRes.email.guest.error}). You can resend it from the booking details.`,
                );
            }
        }
    } catch (e) {
        showErr(e.message);
    }
}

async function deleteBooking(bookingId) {
    if (!(await glassConfirm('Delete this booking permanently?'))) return;
    const b = findBookingById(bookingId);
    if (!b) return;
    try {
        await apiPost('bookings.php', { action: 'delete', id: b.dbId });
        await loadData();
        renderCalendar();
        clearDetails();
        showChangeoverToasts();
    } catch (e) {
        glassAlert("Couldn't delete: " + e.message);
    }
}

function clearDetails() {
    closeDetailsModal();
}

// ============================================================
//  EXPERIENCES — local things to do (owner-curated + guest suggestions).
//  Guest page (view-experiences) + a "suggest" form; admin curation +
//  moderation lives in Settings -> Experiences. Backend: experiences.php.
// ============================================================
const EXPERIENCE_CATEGORIES = [
    'Beaches & coast',
    'Walks & nature',
    'Boat trips & wildlife',
    'Food & drink',
    'Family & kids',
    'Days out & attractions',
    'Local shops & markets',
];
let __experiences = []; // published list (guest view)
let __expFilter = 'all';

async function renderExperiencesView() {
    const grid = document.getElementById('exp-grid');
    const empty = document.getElementById('exp-empty');
    const filters = document.getElementById('exp-filters');
    if (!grid) return;
    try {
        const res = await apiGet('experiences.php');
        __experiences = (res && res.experiences) || [];
    } catch (e) {
        __experiences = [];
    }
    if (!__experiences.length) {
        grid.innerHTML = '';
        if (filters) filters.innerHTML = '';
        if (empty) empty.style.display = 'block';
        return;
    }
    if (empty) empty.style.display = 'none';
    if (__expFilter !== 'all' && !__experiences.some((x) => x.category === __expFilter))
        __expFilter = 'all';
    expBuildFilters();
    expRenderCards();
}
function expBuildFilters() {
    const filters = document.getElementById('exp-filters');
    if (!filters) return;
    const present = EXPERIENCE_CATEGORIES.filter((c) =>
        __experiences.some((x) => x.category === c),
    );
    if (present.length < 2) {
        filters.innerHTML = '';
        return;
    }
    filters.innerHTML = ['all']
        .concat(present)
        .map((c) => {
            const on = __expFilter === c ? ' is-on' : '';
            return `<button type="button" class="exp-chip${on}" data-cat="${escapeHtml(c)}">${c === 'all' ? 'All' : escapeHtml(c)}</button>`;
        })
        .join('');
    filters.querySelectorAll('.exp-chip').forEach((b) =>
        b.addEventListener('click', () => {
            __expFilter = b.dataset.cat;
            expBuildFilters();
            expRenderCards();
        }),
    );
}
function expRenderCards() {
    const grid = document.getElementById('exp-grid');
    if (!grid) return;
    const list =
        __expFilter === 'all'
            ? __experiences
            : __experiences.filter((x) => x.category === __expFilter);
    // First card with a given photo keeps it; later cards that repeat the same
    // photo (or have none) get a distinct category illustration instead — so the
    // page never shows the same picture two or three times in a row.
    const seen = {};
    grid.innerHTML = list
        .map((x) => {
            const dup = x.image && seen[x.image];
            if (x.image) seen[x.image] = 1;
            return expCardHtml(x, !!dup);
        })
        .join('');
}
// Deterministic hue (0–359) from a string, so each experience tints differently.
function expHue(s) {
    s = String(s || '');
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
    return h;
}
// Simple on-brand line motif per category (fallback = star) for image-less cards.
const EXP_CAT_ART = {
    'Boat trips & wildlife': '<path d="M4 16h16l-2.2 4H6.2z"/><path d="M12 3v9M12 5l6 2.5L12 10"/>',
    'Walks & nature':
        '<path d="M12 21v-9"/><path d="M12 12c-3 0-5-2-5-5 3 0 5 2 5 5z"/><path d="M12 11c2.6 0 4.2-1.6 4.2-4.2C13.6 6.8 12 8.4 12 11z"/>',
    'Beaches & coast':
        '<circle cx="17" cy="6.5" r="2.6"/><path d="M2 14c2-2 4-2 6 0s4 2 6 0 4-2 6 0"/><path d="M2 18.5c2-2 4-2 6 0s4 2 6 0 4-2 6 0"/>',
    'Food & drink':
        '<path d="M6.5 3v7a2 2 0 0 0 4 0V3M8.5 12v9"/><path d="M16 3c-1.4 0-2.4 2-2.4 4.8 0 2.4 1 3.7 2.4 3.7s2.4-1.3 2.4-3.7C18.4 5 17.4 3 16 3zM16 11.5V21"/>',
    'Family & kids': '<circle cx="12" cy="7" r="3"/><path d="M5 21c0-3.9 3.1-7 7-7s7 3.1 7 7"/>',
    'Days out & attractions':
        '<path d="M12 3.5l2.6 5.3 5.9.8-4.3 4.1 1 5.8L12 16.8 6.8 19.5l1-5.8L3.5 9.6l5.9-.8z"/>',
    'Local shops & markets':
        '<path d="M4.5 8h15l-1.1 12H5.6z"/><path d="M8.5 8a3.5 3.5 0 0 1 7 0"/>',
};
function expPlaceholder(x) {
    const art =
        EXP_CAT_ART[x.category] ||
        '<path d="M12 3.5l2.6 5.3 5.9.8-4.3 4.1 1 5.8L12 16.8 6.8 19.5l1-5.8L3.5 9.6l5.9-.8z"/>';
    return `<div class="card-img exp-noimg" style="--exp-h:${expHue(x.title || x.category || '')}"><svg class="exp-art" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${art}</svg></div>`;
}
function expCardHtml(x, usePlaceholder) {
    const img =
        x.image && !usePlaceholder
            ? `<img class="card-img exp-img" width="400" height="260" loading="lazy" decoding="async" src="${escapeHtml(x.image)}" alt="${escapeHtml(x.title)}">`
            : expPlaceholder(x);
    const cat = x.category ? `<div class="exp-cat-tag">${escapeHtml(x.category)}</div>` : '';
    // Only allow safe link schemes (block javascript:/data: even though experiences
    // are admin-moderated — the admin preview would otherwise render it).
    const safeLink = /^(https?:|tel:|mailto:)/i.test((x.linkUrl || '').trim()) ? x.linkUrl : '';
    const link = safeLink
        ? `<a class="btn-sm btn-edit" href="${escapeHtml(safeLink)}" target="_blank" rel="noopener noreferrer"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M10 5H5v14h14v-5"/></svg> ${escapeHtml(x.linkLabel || 'Find out more')}</a>`
        : '';
    const phone = x.phone
        ? `<a class="btn-sm btn-edit" href="tel:${escapeHtml(String(x.phone).replace(/\s+/g, ''))}"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6.6 3.5l2.1.4 1 3-1.5 1.4a12 12 0 0 0 5 5l1.4-1.5 3 1 .4 2.1a2 2 0 0 1-2 2.3A15.5 15.5 0 0 1 4.3 5.5a2 2 0 0 1 2.3-2z"/></svg> Call</a>`
        : '';
    const directions = x.mapQuery
        ? `<a class="btn-sm btn-edit" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(x.mapQuery)}" target="_blank" rel="noopener noreferrer"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-6.5-5.5-6.5-10a6.5 6.5 0 0 1 13 0c0 4.5-6.5 10-6.5 10z"/><circle cx="12" cy="11" r="2.2"/></svg> Directions</a>`
        : '';
    const dist = x.distance
        ? `<div class="exp-dist"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-6.5-5.5-6.5-10a6.5 6.5 0 0 1 13 0c0 4.5-6.5 10-6.5 10z"/><circle cx="12" cy="11" r="2.2"/></svg> ${escapeHtml(x.distance)}</div>`
        : '';
    const actions =
        link || phone || directions
            ? `<div class="exp-actions">${link}${phone}${directions}</div>`
            : '';
    return `<div class="card glass-panel exp-card">${img}${cat}<div class="card-title">${escapeHtml(x.title)}</div>${dist}<p class="exp-body">${escapeHtml(x.body)}</p>${actions}</div>`;
}

// ---- Guest: suggest an experience ----
function openExperienceSuggest() {
    if (!currentGuest) {
        openGuestArea();
        return;
    } // sign-in first
    const sel = document.getElementById('exp-s-cat');
    if (sel)
        sel.innerHTML =
            '<option value="">— Choose a category —</option>' +
            EXPERIENCE_CATEGORIES.map(
                (c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`,
            ).join('');
    ['exp-s-title', 'exp-s-body', 'exp-s-link', 'exp-s-phone'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    const msg = document.getElementById('exp-s-msg');
    if (msg) msg.style.display = 'none';
    const m = document.getElementById('exp-suggest-modal');
    if (m) {
        m.classList.remove('closing');
        m.classList.add('open');
    }
}
function closeExperienceSuggest() {
    const m = document.getElementById('exp-suggest-modal');
    if (!m || !m.classList.contains('open')) return;
    m.classList.add('closing');
    setTimeout(() => m.classList.remove('open', 'closing'), 350);
}
async function submitExperienceSuggestion() {
    const g = (id) => (document.getElementById(id) ? document.getElementById(id).value : '');
    const title = g('exp-s-title').trim(),
        body = g('exp-s-body').trim();
    const category = g('exp-s-cat'),
        link_url = g('exp-s-link').trim(),
        phone = g('exp-s-phone').trim();
    const msg = document.getElementById('exp-s-msg');
    const show = (t, ok) => {
        if (msg) {
            msg.textContent = t;
            msg.style.color = ok ? '#4CAF50' : '#E53935';
            msg.style.display = 'block';
        }
    };
    const fileEl = document.getElementById('exp-s-photo');
    const file = fileEl && fileEl.files && fileEl.files[0];
    if (title.length < 3) {
        show('Please add a name.', false);
        return;
    }
    if (body.length < 10) {
        show('Please add a short description.', false);
        return;
    }
    if (file && file.size > 8 * 1024 * 1024) {
        show('Please choose an image 8 MB or smaller.', false);
        return;
    }
    try {
        // multipart so an optional photo can ride along (validated server-side).
        const fd = new FormData();
        fd.append('action', 'suggest');
        fd.append('title', title);
        fd.append('body', body);
        fd.append('category', category);
        fd.append('link_url', link_url);
        fd.append('phone', phone);
        if (file) fd.append('image', file);
        const r = await fetch(API_BASE + 'experiences.php', {
            method: 'POST',
            credentials: 'same-origin',
            body: fd,
        });
        const data = await r.json().catch(() => ({}));
        if (!r.ok || data.error) throw new Error(data.error || 'Could not send.');
        show("Thanks! We'll review your suggestion.", true);
        setTimeout(closeExperienceSuggest, 1400);
    } catch (e) {
        show(e.message || 'Could not send — please try again.', false);
    }
}

// ---- Admin: curate + moderate (Settings -> Experiences) ----
let __expAdmin = [];
async function refreshExpPendingBadge(known) {
    const badge = document.getElementById('exp-pending-badge');
    if (!badge) return;
    let n = known;
    if (n === undefined) {
        try {
            const r = await apiPost('experiences.php', { action: 'list_admin' });
            n = (r.experiences || []).filter((x) => x.status === 'pending').length;
        } catch (e) {
            n = 0;
        }
    }
    if (n > 0) {
        badge.textContent = n;
        badge.style.display = '';
    } else {
        badge.style.display = 'none';
    }
}
// Pending guest reviews/photos: badge the Settings rows and fill the
// dashboard "Waiting for approval" card (hidden when there's nothing).
async function refreshModerationCounts() {
    const setBadge = (id, n) => {
        const b = document.getElementById(id);
        if (b) {
            b.textContent = n;
            b.style.display = n > 0 ? '' : 'none';
        }
    };
    let rev = 0,
        ph = 0;
    try {
        const r = await apiPost('reviews.php', { action: 'list_admin' });
        rev = (r.reviews || []).filter((x) => x.status === 'pending').length;
    } catch (e) {}
    try {
        const r = await apiPost('photos.php', { action: 'list_admin' });
        ph = (r.photos || []).filter((x) => x.status === 'pending').length;
    } catch (e) {}
    setBadge('reviews-pending-badge', rev);
    setBadge('photos-pending-badge', ph);
    const cardEl = document.getElementById('today-approve-card');
    if (cardEl) {
        const total = rev + ph;
        if (total > 0) {
            cardEl.style.display = '';
            cardEl.dataset.go = rev > 0 ? 'reviews' : 'photos';
            const val = document.getElementById('today-approve-value');
            if (val) {
                val.textContent = total;
                val.style.color = 'var(--warn)';
            }
            const list = document.getElementById('today-approve-list');
            if (list)
                list.innerHTML = [
                    rev ? `<div>${rev} review${rev === 1 ? '' : 's'} to approve</div>` : '',
                    ph ? `<div>${ph} guest photo${ph === 1 ? '' : 's'} to approve</div>` : '',
                ].join('');
        } else cardEl.style.display = 'none';
    }
}
async function loadExperiencesAdmin() {
    const wrap = document.getElementById('exp-admin');
    if (!wrap) return;
    wrap.innerHTML = '<p style="color:var(--text-muted);font-size:0.9rem;">Loading…</p>';
    let rows = [];
    try {
        const r = await apiPost('experiences.php', { action: 'list_admin' });
        rows = r.experiences || [];
    } catch (e) {
        wrap.innerHTML = `<p style="color:#E57373;font-size:0.9rem;">${escapeHtml(e.message || 'Could not load — has migrate.php been run?')}</p>`;
        return;
    }
    __expAdmin = rows;
    const pending = rows.filter((r) => r.status === 'pending');
    const published = rows.filter((r) => r.status === 'published');
    let html = '';
    if (pending.length) {
        html += `<h3 style="font-family:var(--font-serif);font-size:1.15rem;margin:0 0 10px;">Suggestions to review (${pending.length})</h3>`;
        html += pending.map(expPendingHtml).join('');
        html += `<div class="prop-divider" style="margin:22px 0;"></div>`;
    }
    html += `<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin:0 0 12px;"><h3 style="font-family:var(--font-serif);font-size:1.15rem;margin:0;">Published (${published.length})</h3><button class="btn-sm btn-edit" onclick="expAddNew()">＋ Add experience</button></div>`;
    html +=
        `<div id="exp-admin-list">` +
        (published.length
            ? published.map(expEditHtml).join('')
            : `<p style="color:var(--text-muted);font-size:0.88rem;">None yet — add your first experience.</p>`) +
        `</div>`;
    wrap.innerHTML = html;
    refreshExpPendingBadge(pending.length);
}
function expPendingHtml(r) {
    const thumb = r.image_url
        ? `<div class="exp-edit-thumb" style="background-image:url('${escapeHtml(r.image_url)}');margin-bottom:10px;"></div>`
        : '';
    return `<div class="glass-panel" style="padding:14px 16px;margin-bottom:10px;border:1px solid var(--accent-soft, var(--glass-border));">
                ${thumb}
                <div style="font-weight:600;">${escapeHtml(r.title)}${r.category ? ` <span style="font-size:0.7rem;color:var(--text-muted);">· ${escapeHtml(r.category)}</span>` : ''}</div>
                <div style="font-size:0.84rem;color:var(--text-muted);margin:6px 0;white-space:pre-line;">${escapeHtml(r.body)}</div>
                <div style="font-size:0.74rem;color:var(--text-muted);">Suggested by ${escapeHtml(r.suggested_by_name || 'a guest')}${r.link_url ? ` · <a href="${escapeHtml(r.link_url)}" target="_blank" rel="noopener" style="color:var(--text-muted);text-decoration:underline;">link</a>` : ''}${r.phone ? ' · ' + escapeHtml(r.phone) : ''}</div>
                <div style="display:flex;gap:8px;margin-top:10px;">
                    <button class="btn-sm btn-edit" style="background:rgba(76,175,80,0.22);border-color:var(--booked-border);" onclick="expApprove(${r.id})">Approve &amp; publish</button>
                    <button class="btn-sm btn-delete" onclick="expReject(${r.id})">Reject</button>
                </div>
            </div>`;
}
function expEditHtml(r) {
    const id = r.id || 0;
    const catOpts = ['<option value="">— Category —</option>']
        .concat(
            EXPERIENCE_CATEGORIES.map(
                (c) =>
                    `<option value="${escapeHtml(c)}"${c === r.category ? ' selected' : ''}>${escapeHtml(c)}</option>`,
            ),
        )
        .join('');
    return `<div class="glass-panel exp-edit" data-id="${id}" style="padding:14px 16px;margin-bottom:12px;">
                <input type="hidden" id="exp-img-${id}" value="${escapeHtml(r.image_url || '')}">
                <div style="display:flex;gap:10px;align-items:flex-start;">
                    <div class="exp-edit-thumb" id="exp-thumb-${id}" style="background-image:url('${escapeHtml(r.image_url || '')}');"></div>
                    <div style="flex:1;min-width:0;">
                        <input type="text" class="input-glass" id="exp-t-${id}" value="${escapeHtml(r.title || '')}" placeholder="Title" style="margin-bottom:8px;">
                        <select class="input-glass" id="exp-c-${id}" style="margin-bottom:0;">${catOpts}</select>
                    </div>
                </div>
                <textarea class="input-glass" id="exp-b-${id}" rows="2" placeholder="Description" style="resize:vertical;margin:8px 0;">${escapeHtml(r.body || '')}</textarea>
                <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px;">
                    <input type="text" class="input-glass" id="exp-ll-${id}" value="${escapeHtml(r.link_label || '')}" placeholder="Link label (e.g. Find out more)" style="flex:1;min-width:150px;">
                    <input type="text" class="input-glass" id="exp-lu-${id}" value="${escapeHtml(r.link_url || '')}" placeholder="https://…" style="flex:1;min-width:150px;">
                    <input type="tel" class="input-glass" id="exp-p-${id}" value="${escapeHtml(r.phone || '')}" placeholder="Phone" style="flex:1;min-width:120px;">
                </div>
                <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px;">
                    <input type="text" class="input-glass" id="exp-d-${id}" value="${escapeHtml(r.distance || '')}" placeholder="Distance (e.g. 5 min walk)" style="flex:1;min-width:150px;">
                    <input type="text" class="input-glass" id="exp-m-${id}" value="${escapeHtml(r.map_query || '')}" placeholder="Map location (address or place name)" style="flex:1;min-width:150px;">
                </div>
                <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
                    <button class="btn-sm btn-edit" onclick="expUpload(${id})">Photo</button>
                    <button class="btn-sm btn-edit" onclick="expSave(${id})">Save</button>
                    <button class="btn-sm btn-edit" onclick="expMove(${id},-1)" aria-label="Move up">↑</button>
                    <button class="btn-sm btn-edit" onclick="expMove(${id},1)" aria-label="Move down">↓</button>
                    <button class="btn-sm btn-delete" style="margin-left:auto;" onclick="expDelete(${id})">Delete</button>
                </div>
            </div>`;
}
function expAddNew() {
    const list = document.getElementById('exp-admin-list');
    if (!list) return;
    if (list.querySelector('.exp-edit[data-id="0"]')) return; // one blank at a time
    const blank = {
        id: 0,
        title: '',
        body: '',
        image_url: '',
        link_label: '',
        link_url: '',
        phone: '',
        category: '',
    };
    const p = list.querySelector('p');
    if (p) p.remove();
    list.insertAdjacentHTML('afterbegin', expEditHtml(blank));
}
function expUpload(id) {
    pickAndUpload('experience', async (url) => {
        const h = document.getElementById('exp-img-' + id);
        if (h) h.value = url;
        const t = document.getElementById('exp-thumb-' + id);
        if (t) t.style.backgroundImage = `url('${url}')`;
    });
}
async function expSave(id) {
    const g = (s) => (document.getElementById(s) ? document.getElementById(s).value : '');
    const payload = {
        action: 'save',
        id: id || 0,
        title: g('exp-t-' + id).trim(),
        body: g('exp-b-' + id).trim(),
        image_url: g('exp-img-' + id),
        link_label: g('exp-ll-' + id).trim(),
        link_url: g('exp-lu-' + id).trim(),
        phone: g('exp-p-' + id).trim(),
        category: g('exp-c-' + id),
        distance: g('exp-d-' + id).trim(),
        map_query: g('exp-m-' + id).trim(),
    };
    if (!payload.title) {
        glassAlert('Please add a title.');
        return;
    }
    try {
        await apiPost('experiences.php', payload);
        await loadExperiencesAdmin();
    } catch (e) {
        glassAlert(e.message);
    }
}
async function expDelete(id) {
    if (!id) {
        const row = document.querySelector('.exp-edit[data-id="0"]');
        if (row) row.remove();
        return;
    }
    if (!confirm('Delete this experience?')) return;
    try {
        await apiPost('experiences.php', { action: 'delete', id });
        await loadExperiencesAdmin();
    } catch (e) {
        glassAlert(e.message);
    }
}
async function expApprove(id) {
    try {
        await apiPost('experiences.php', { action: 'approve', id });
        await loadExperiencesAdmin();
    } catch (e) {
        glassAlert(e.message);
    }
}
async function expReject(id) {
    try {
        await apiPost('experiences.php', { action: 'reject', id });
        await loadExperiencesAdmin();
    } catch (e) {
        glassAlert(e.message);
    }
}
async function expMove(id, dir) {
    const pub = __expAdmin.filter((r) => r.status === 'published').map((r) => r.id);
    const i = pub.indexOf(id);
    if (i < 0) return;
    const j = i + dir;
    if (j < 0 || j >= pub.length) return;
    const t = pub[i];
    pub[i] = pub[j];
    pub[j] = t;
    try {
        await apiPost('experiences.php', { action: 'reorder', ids: pub });
        await loadExperiencesAdmin();
    } catch (e) {
        glassAlert(e.message);
    }
}

// ⬇️ BUILD STAMP — keep this as the LAST statement in the script.
// It only runs if the whole file loaded, so if a truncated upload cuts
// the file short, the footer keeps showing "—" instead of this number.
// Bump the value whenever a new version is shipped.
(function () {
    const BUILD = 'f7j1m5tu';
    window.__BUILD = BUILD; // exposed so the version watcher can detect new releases
    const el = document.getElementById('build-stamp');
    if (el) el.textContent = BUILD;
    const yr = document.getElementById('footer-year');
    if (yr) yr.textContent = new Date().getFullYear();
})();
