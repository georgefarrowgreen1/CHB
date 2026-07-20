
// ============================================================
// ADMIN FACADE — the owner back-office implementation lives in admin.js and is
// fetched on demand (owner login / admin session restore), so guests never
// download or parse it. Every admin function that public code or markup can
// call gets an async stub here; the real declarations in admin.js overwrite
// the window properties when the bundle loads. Deploy checklist: bump ADMIN_V
// whenever admin.js changes (it is the ?v= cache-buster).
// ============================================================
const ADMIN_BUNDLE_V = 255;
// admin.css is the owner-only stylesheet, split out of app.css so guests never
// download it. Injected here (not a static <link>) and version-stamped on its
// own — bump when admin.css changes. Kept OUT of the sw.js CORE precache.
const ADMIN_CSS_V = 76;
function ensureAdminCss() {
    if (document.getElementById('admin-css')) return Promise.resolve();
    return new Promise((resolve) => {
        const l = document.createElement('link');
        l.id = 'admin-css';
        l.rel = 'stylesheet';
        l.href = 'admin.css?v=' + ADMIN_CSS_V;
        // Resolve either way — a missing stylesheet must not block the bundle
        // (admin.js still works; styling degrades to app.css, which is safe).
        l.onload = () => resolve();
        l.onerror = () => resolve();
        document.head.appendChild(l);
    });
}
let __adminBundlePromise = null;
function loadAdminBundle() {
    if (window.__ADMIN_LOADED) return Promise.resolve();
    if (__adminBundlePromise) return __adminBundlePromise;
    // Pull the admin stylesheet in parallel with the script.
    ensureAdminCss();
    // Retry the fetch a couple of times before giving up: one dropped request
    // (patchy mobile signal, or the brief window while a deploy is uploading)
    // must not leave the owner with dead buttons.
    const attempt = (triesLeft) =>
        new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = 'admin.js?v=' + ADMIN_BUNDLE_V;
            s.onload = () => resolve();
            s.onerror = () => {
                s.remove();
                if (triesLeft > 0) {
                    setTimeout(() => attempt(triesLeft - 1).then(resolve, reject), triesLeft === 2 ? 1200 : 2500);
                } else {
                    __adminBundlePromise = null; // allow a fresh try on the next tap
                    reject(new Error('Could not load the admin tools — check your connection and try again.'));
                }
            };
            document.head.appendChild(s);
        });
    __adminBundlePromise = attempt(2);
    return __adminBundlePromise;
}
["accountsBack","accountsOpen","accountsShowIndex","activityLogSearch","addAdminPasskey","addReviewRow","afterPaymentChange","autoSyncIcalBlocks","backfillWebp","bookingHubBack","bookingsSetFilter","bookingsSetSearch","bulkImportReviews","changeAdminPassword","changeMonth","timelineToday","inboxFolder","initBackOffice","closeBreakdownModal","diagnoseReplyEmail","closeEnquiryEmailModal","addComposeAttachments","previewComposedEmail","sendEnquiryEmail","backToComposeEdit","loadAdminMessages","loadDiagnostics","logoutStaff","offerUpdatedConfirmationEmail","openAccounts","openAddBooking","openArea","openBlockDates","openBookings","openBookingEmail","openBookingHub","openEnquiryHub","enquiryHubBack","openInbox","openSettings","openStagingSite","refreshModerationCounts","renderAccounts","renderActivityLog","renderBookings","renderCalendar","renderExpenses","renderInbox","renderMoneyOverview","requestPayment","renderSquareSettings","runMigrations","saveApiKey","saveContactPhone","saveContent","saveDepositPct","saveGoogleReviewUrl","saveHostText","saveReviews","sendBroadcast","sendSampleEmails","sendTestEmail","settingsBack","settingsFilter","settingsOpen","settingsOpenAccom","settingsOpenAccomSec","settingsOpenCalendar","settingsOpenCancel","settingsSearchKey","settingsShowIndex","tryAccessBackOffice","uploadHostPhoto"].forEach((n) => {
    const stub = (...a) =>
        loadAdminBundle()
            .catch((e) => {
                // Surface the failure on screen — a tapped admin button must
                // never just die silently — then rethrow so the error capture
                // still logs it to Needs attention.
                try {
                    toast(e.message, 'error');
                } catch (_) {}
                throw e;
            })
            .then(() => {
                const fn = window[n];
                if (typeof fn !== 'function' || fn.__adminStub) {
                    throw new Error('admin.js loaded but ' + n + ' is missing');
                }
                return fn(...a);
            });
    stub.__adminStub = true;
    window[n] = stub;
});
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

// ============================================================
//  CSP-clean event delegation — the migration path OFF inline on* handlers so the
//  CSP can eventually drop script-src 'unsafe-inline' (the last remaining XSS
//  defence-in-depth gap). An element opts in with a data-act attribute naming the
//  action (data-act for click; data-act-change / -input / -keydown / -submit /
//  -pointerdown / -blur for the other events).
//  A single set of document-level listeners dispatches to a registered action
//  (chbAct) or, for a plain no-arg call, to the same-named GLOBAL function called
//  exactly like the old `fn()` (this = window, no args). Delegation means markup
//  inserted later via innerHTML is covered too, so dynamic handlers migrate the
//  same way. Inline handlers keep working during the migration; the CSP only drops
//  'unsafe-inline' once every handler is converted (smoke-test ratchets the count).
// ============================================================
const CHB_ACTIONS = Object.create(null);
function chbAct(name, fn) {
    CHB_ACTIONS[name] = fn;
}
// Reusable, parameterised actions shared across many elements:
chbAct('activate', function (el, event) {
    // Keyboard "click": Enter or Space activates the element (a11y for role=button).
    if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        el.click();
    }
});
chbAct('nav', function (el) {
    if (typeof nav === 'function') nav(el.dataset.view);
});
// Anchor nav: swallow the href then route (was `event.preventDefault(); nav('x')`).
chbAct('navLink', function (el, event) {
    event.preventDefault();
    nav(el.dataset.view);
});
// Mobile-menu nav link: close the drawer, then route.
chbAct('mobileNavLink', function (el, event) {
    event.preventDefault();
    if (typeof toggleMobileMenu === 'function') toggleMobileMenu();
    nav(el.dataset.view);
});
// Open the back office and initialise it (was `nav('view-backoffice'); initBackOffice();`).
chbAct('navBackoffice', function () {
    nav('view-backoffice');
    if (typeof initBackOffice === 'function') initBackOffice();
});
// Backdrop close: dismiss only when the click is on the overlay itself (or an
// opt-in close element via data-close-in), never a click INSIDE the dialog.
chbAct('backdropClose', function (el, event) {
    const inClass = el.dataset.closeIn;
    if (event.target === el || (inClass && event.target.classList && event.target.classList.contains(inClass))) {
        const fn = window[el.dataset.close];
        if (typeof fn === 'function') fn();
    }
});
// preventDefault then call a bare global (data-fn) — e.g. openAllReviews.
chbAct('pdCall', function (el, event) {
    event.preventDefault();
    const fn = window[el.dataset.fn];
    if (typeof fn === 'function') fn();
});
// Cottage / route links: keep the return value so the `return false` inline
// semantics (stop the navigation) survive the migration.
chbAct('cottageLink', function (el, event) {
    if (typeof cottageLink === 'function') return cottageLink(event, el.dataset.prop);
});
chbAct('routeLink', function (el, event) {
    if (typeof routeLink === 'function') return routeLink(event, el.dataset.view);
});
// Terms: openTermsModal does its own preventDefault/stopPropagation; just hand it the event.
chbAct('openTerms', function (el, event) {
    if (typeof openTermsModal === 'function') openTermsModal(event);
});
// Terms for a specific cottage: openTermsModal(event, propKey).
chbAct('openTermsProp', function (el, event) {
    if (typeof openTermsModal === 'function') openTermsModal(event, el.dataset.prop);
});
// Lightbox prev/next: stop the click reaching the backdrop-close, then step.
chbAct('lightboxNav', function (el, event) {
    event.stopPropagation();
    if (typeof lightboxNav === 'function') lightboxNav(chbArgVal(el.dataset.arg));
});
// Resume-enquiry dismiss: stop propagation, then dismiss (click + Enter/Space).
chbAct('resumeDismiss', function (el, event) {
    if (event.type === 'keydown' && !(event.key === 'Enter' || event.key === ' ')) return;
    event.preventDefault();
    event.stopPropagation();
    if (typeof enquiryResumeDismiss === 'function') enquiryResumeDismiss();
});
// Enter-to-submit (no Space): the old `if(event.key==='Enter') fn()` inputs.
chbAct('enterCall', function (el, event) {
    if (event.key === 'Enter') {
        const fn = window[el.dataset.fn];
        if (typeof fn === 'function') fn();
    }
});
// Chat composer: Enter sends, Shift+Enter makes a newline.
chbAct('enterSendChat', function (el, event) {
    if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        if (typeof sendChat === 'function') sendChat();
    }
});
// Owner toggle → saveContent with the checkbox mapped to a stored flag. data-invert
// flips the sense: default checked→'1'/off→''; inverted checked→''/off→'1'.
chbAct('saveContentToggle', function (el) {
    const on = !!el.checked;
    const stored = el.dataset.invert === '1' ? (on ? '' : '1') : (on ? '1' : '');
    if (typeof saveContent === 'function') saveContent(el.dataset.key, stored);
});
// Small bespoke compound closers from the guest-account modals.
chbAct('detailsLogout', function () {
    closeGuestDetailsModal();
    if (typeof guestLogout === 'function') guestLogout();
});
chbAct('detailsSecurity', function () {
    closeGuestDetailsModal();
    if (typeof openGuestSecurityModal === 'function') openGuestSecurityModal();
});
chbAct('detailsPrivacy', function (el, event) {
    event.preventDefault();
    closeGuestDetailsModal();
    nav('view-privacy');
});
chbAct('authPrivacy', function (el, event) {
    event.preventDefault();
    closeGuestAuthModal();
    nav('view-privacy');
});
// Click a target element by id (was `document.getElementById('x').click()`).
chbAct('clickTarget', function (el) {
    const t = document.getElementById(el.dataset.target);
    if (t) t.click();
});
chbAct('reload', function () {
    location.reload();
});
// Gallery grid keyboard nav: ggKey wants (event, index) in that order, so a
// registered action rather than data-pass (which appends last).
chbAct('ggKey', function (el, event) {
    if (typeof ggKey === 'function') ggKey(event, chbArgVal(el.dataset.arg));
});
// Member-call actions from admin.js dynamic rows.
chbAct('selectSelf', function (el) {
    if (typeof el.select === 'function') el.select();
});
// Remove the nearest matching ancestor (was `this.closest('sel').remove()`).
chbAct('closestRemove', function (el) {
    const t = el.closest(el.dataset.sel);
    if (t) t.remove();
});
// Open a URL in a new tab (was `window.open(url,'_blank')`).
chbAct('winOpen', function (el) {
    window.open(el.dataset.url, '_blank');
});
// Booking-hub overflow-menu items: close the menu, then run the action on the id.
chbAct('bhubEdit', function (el) {
    bhubMenuClose();
    openEditBooking(el.dataset.arg);
});
chbAct('bhubDelete', function (el) {
    bhubMenuClose();
    deleteBooking(el.dataset.arg);
});
chbAct('bhubCancel', function (el) {
    bhubMenuClose();
    cancelBooking(el.dataset.arg);
});
// Go to Manage → Diagnostics (was `nav('view-settings'); settingsOpen('diagnostics');`).
chbAct('navDiagnostics', function () {
    nav('view-settings');
    settingsOpen('diagnostics');
});
// Go to Manage → a specific settings section (needs-you "Approve" rows).
chbAct('navSettingsSection', function (el) {
    nav('view-settings');
    settingsOpen(el.dataset.arg);
});
// Open the Inbox on the Messages folder (needs-you "Reply" row).
chbAct('openInboxMessages', function () {
    if (typeof openInbox === 'function') openInbox().then(function () { inboxFolder('messages'); });
});
// Open the accommodations section then a specific cottage.
chbAct('openAccomThenSec', function (el) {
    settingsOpen('accom');
    settingsOpenAccom(el.dataset.arg);
});
// Owed-KPI chase button inside a clickable row: don't let the row's own click fire.
chbAct('stopAccountsPayments', function (el, event) {
    event.stopPropagation();
    accountsOpen('payments');
});
// Booking-hub ⋯ menu toggle: bhubMenuToggle reads ev.currentTarget (the button),
// which delegation can't provide (currentTarget is document), so hand it a shim
// whose currentTarget is the real button and whose stopPropagation forwards.
chbAct('bhubMenu', function (el, event) {
    bhubMenuToggle({ currentTarget: el, stopPropagation: function () { event.stopPropagation(); } });
});
// Waitlist from the front page (object arg → current front property).
chbAct('openWaitlistHere', function () {
    if (typeof openWaitlistModal === 'function') openWaitlistModal({ prop: window.activeFrontProperty });
});
// Coerce a data-arg string back to the literal type the inline call used, so
// fn('diagnostics') stays a string but fn(1) / fn(true) pass a number / boolean
// (a string "1" would break `month + dir` arithmetic). Only exact integer and
// true/false coerce; everything else stays a string.
function chbArgVal(raw) {
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    if (/^-?\d+$/.test(raw)) return Number(raw);
    return raw;
}
// Escape a string for use inside a SINGLE-quoted HTML attribute (so a JSON blob
// carrying attacker-influenced data — e.g. a guest email — can't break out of the
// attribute). Single-quoted, so `"` is safe literally; escape & ' < >.
function chbEscAttr(s) {
    return String(s).replace(/&/g, '&amp;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
// Sentinels for chbAttrs(): a trailing runtime value the handler took from the
// element/event — `this.value`, `this.checked`, `this.files`, `this` itself, or
// `event`. chbAttrs emits these as data-pass (appended LAST at dispatch) instead
// of baking them into the static JSON arg list.
const CHB_VALUE = { __chbPass: 'value' };
const CHB_CHECKED = { __chbPass: 'checked' };
const CHB_FILES = { __chbPass: 'files' };
const CHB_SELF = { __chbPass: 'self' };
const CHB_EVENT = { __chbPass: 'event' };
// Render-time helper for DYNAMIC (innerHTML) handlers: returns the delegation
// attributes carrying the args as a typed JSON list. Replaces an inline click
// handler like fn(a,b) with ${chbAttrs('fn', a, b)} — types survive exactly
// (String() a formerly-quoted arg to keep it a string). A trailing CHB_* sentinel
// becomes data-pass.
// `evt` selects the event: '' (default) = click, else 'change'/'input'/'keydown'/
// 'submit'/'blur' → data-act-<evt>.
function chbAttrsFor(evt, name, args) {
    let pass = '';
    if (args.length && args[args.length - 1] && args[args.length - 1].__chbPass) {
        pass = args[args.length - 1].__chbPass;
        args = args.slice(0, -1);
    }
    let out = (evt ? 'data-act-' + evt : 'data-act') + '="' + name + '"';
    if (args.length) out += " data-args='" + chbEscAttr(JSON.stringify(args)) + "'";
    if (pass) out += ' data-pass="' + pass + '"';
    return out;
}
function chbAttrs(name, ...args) { return chbAttrsFor('', name, args); }
function chbChange(name, ...args) { return chbAttrsFor('change', name, args); }
function chbInput(name, ...args) { return chbAttrsFor('input', name, args); }
function chbBlur(name, ...args) { return chbAttrsFor('blur', name, args); }
function chbRunAct(el, name, event) {
    let r;
    const fn = CHB_ACTIONS[name];
    if (typeof fn === 'function') {
        r = fn.call(el, el, event);
    } else if (typeof window[name] === 'function') {
        // Plain global call — exact parity with the old inline `fn(...)` (this =
        // window). data-arg[2|3] carry up to three literal args in order; data-pass
        // appends one runtime value (this.value / .checked / .files, the element,
        // or the event) LAST, matching handlers like fn('key', this.value). With
        // none present this is the bare `fn()` case from phase 1.
        const ds = el.dataset;
        let args = [];
        if ('args' in ds) {
            // JSON arg list — carries EXACT types (string "5" vs number 5),
            // authored by chbAttrs() for dynamic (innerHTML) handlers where a
            // coerced data-arg could change a `===` comparison.
            try { args = JSON.parse(ds.args); } catch (e) { args = []; }
            if (!Array.isArray(args)) args = [];
        } else {
            if ('arg' in ds) args.push(chbArgVal(ds.arg));
            if ('arg2' in ds) args.push(chbArgVal(ds.arg2));
            if ('arg3' in ds) args.push(chbArgVal(ds.arg3));
        }
        if ('pass' in ds) {
            const p = ds.pass;
            args.push(p === 'value' ? el.value : p === 'checked' ? el.checked : p === 'files' ? el.files : p === 'self' ? el : p === 'event' ? event : undefined);
        }
        r = window[name].apply(window, args);
    } else {
        return;
    }
    if (r === false) event.preventDefault(); // inline `return false` semantics
}
const CHB_EVT_ATTR = {
    click: 'act',
    change: 'actChange',
    input: 'actInput',
    keydown: 'actKeydown',
    submit: 'actSubmit',
    pointerdown: 'actPointerdown',
    // blur doesn't bubble, so delegate its bubbling twin focusout → data-act-blur.
    focusout: 'actBlur',
};
function chbDelegate(event) {
    const key = CHB_EVT_ATTR[event.type];
    if (!key) return;
    // Walk up from the event target to the nearest element carrying the action for
    // this event type (mirrors how a delegated click resolves its intended target).
    let el = event.target;
    while (el && el.nodeType === 1) {
        if (el.dataset && el.dataset[key]) {
            chbRunAct(el, el.dataset[key], event);
            return;
        }
        el = el.parentElement;
    }
}
Object.keys(CHB_EVT_ATTR).forEach((t) => document.addEventListener(t, chbDelegate));

// --- Front-end error capture ---
// Report uncaught JS errors + unhandled promise rejections to the server so the
// owner sees breakage in the activity log before a guest emails about it. Capped
// and de-duplicated per page load; the server also rate-limits. Cross-origin
// "Script error." (no detail, usually a browser extension) is ignored as noise.
(function () {
    let sent = 0;
    const seen = Object.create(null);
    function reportClientError(msg, where, stack) {
        try {
            msg = String(msg || '').trim();
            if (!msg || msg === 'Script error.' || msg === 'Script error') return;
            // Third-party noise: scripts INJECTED into the page by Android/iOS
            // in-app browsers (Instagram/Facebook webviews report as iabjs://…),
            // browser extensions and native bridges throw errors we can't fix —
            // e.g. "Error invoking postMessage: Java object is gone". Don't
            // report them; they'd spam the owner's "Needs attention" stream.
            const src = String(where || '');
            if (/^(?!https?:\/\/)[a-z][a-z0-9.+-]*:\/\//i.test(src)) return; // iabjs://, gap://, chrome-extension://…
            if (/webkit-masked-url/i.test(src)) return; // Safari extension-injected
            if (/Java (object|bridge|exception)/i.test(msg)) return; // Android webview bridge died
            // iOS in-app browsers (Facebook/Instagram WKWebView) inject scripts that
            // poke window.webkit.messageHandlers — our code never touches that API,
            // so any such error is theirs. (iOS injections report the PAGE url as
            // the source, so the scheme check above can't catch them.)
            if (/webkit\.messageHandlers/i.test(msg)) return;
            if (sent >= 5) return; // don't flood on a broken page
            // Self-repair: a half-updated cache after a deploy (stale app.js
            // beside fresh HTML, or vice versa) surfaces as OUR OWN code being
            // "not defined". Purge every cache and reload ONCE per tab — the
            // service worker serves HTML network-first, so the reload pulls a
            // coherent build and the error stops existing. The report still
            // goes out below (prefixed, keepalive survives the reload) so the
            // activity log shows it happened.
            let healing = false;
            try {
                if (
                    /(is not defined|is not a function|undefined is not an object)/.test(msg) &&
                    /(^$|app\.js|admin\.js|guest-app\.js|index\.html)/.test(src.split('?')[0]) &&
                    !sessionStorage.getItem('chb-healed')
                ) {
                    sessionStorage.setItem('chb-healed', '1');
                    healing = true;
                    msg = '[self-heal: cache purged + reloaded] ' + msg;
                }
            } catch (e) {}
            const key = msg.slice(0, 120);
            if (seen[key]) return;
            seen[key] = 1;
            sent++;
            fetch(API_BASE + 'client-error.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                keepalive: true,
                body: JSON.stringify({
                    message: msg.slice(0, 300),
                    where: String(where || (location && location.pathname) || '').slice(0, 300),
                    // Triage context: which release, which screen, and the top
                    // of the stack — the difference between "something broke"
                    // and a report the owner (or a developer) can act on.
                    stack: String(stack || '').slice(0, 500),
                    build: String(window.__BUILD || ''),
                    view: ((document.querySelector('.page-view.active') || {}).id || '').slice(0, 40),
                }),
            }).catch(() => {});
            if (healing) {
                const purge =
                    'caches' in window
                        ? caches.keys().then((ks) => Promise.all(ks.map((k) => caches.delete(k))))
                        : Promise.resolve();
                purge
                    .catch(() => {})
                    .then(() => setTimeout(() => location.reload(), 350));
            }
        } catch (e) {}
    }
    window.addEventListener('error', (e) => {
        if (e && e.message)
            reportClientError(
                e.message,
                (e.filename || '') + (e.lineno ? ':' + e.lineno : ''),
                e.error && e.error.stack,
            );
    });
    window.addEventListener('unhandledrejection', (e) => {
        const r = e && e.reason;
        const m = (r && (r.message || (r.toString && String(r)))) || 'Unhandled promise rejection';
        reportClientError('Promise: ' + m, (location && location.pathname) || '', r && r.stack);
    });
    // Narrow hook for the layout sentinel below — same pipeline (activity log,
    // dedupe, rate limits), so layout bugs surface exactly like JS errors.
    window.__reportLayoutIssue = (msg) => reportClientError(msg, 'layout-sentinel', '');
})();

// --- Layout sentinel: the page checks ITSELF for overlap/overhang bugs ---
// CI measures every screen in Chromium, but some engines lay out differently
// (iOS Safari's intrinsic form-control widths, for one). So on real devices,
// after each view settles, the page measures its own layout: any content
// element poking past the right edge of the viewport — the classic phone
// overlap — is reported to the owner's activity log via the error pipeline
// (one report per view+offender per session; server dedupes further).
// Same exclusion rules as layout-test.js MEASURE: fixed elements, fully
// off-canvas slide-ins, decorative empties and anything inside a clipped or
// horizontally-scrollable container are all fine by design.
function layoutSentinelRun() {
    try {
        if (!window.__reportLayoutIssue) return;
        const view = (document.querySelector('.page-view.active') || {}).id || 'unknown';
        const vw = window.innerWidth;
        const isClippedOrScrollable = (el) => {
            let a = el.parentElement;
            while (a && a !== document.body) {
                const o = getComputedStyle(a).overflowX;
                if (o === 'hidden' || o === 'clip' || o === 'auto' || o === 'scroll') return true;
                a = a.parentElement;
            }
            return false;
        };
        const report = (msg) => {
            const key = 'chb-lay-' + view + '-' + msg.slice(0, 60);
            try {
                if (sessionStorage.getItem(key)) return;
                sessionStorage.setItem(key, '1');
            } catch (e) {}
            window.__reportLayoutIssue(msg);
        };
        const pageOver = document.documentElement.scrollWidth - vw;
        if (pageOver > 8) report(`Layout: page ${pageOver}px wider than the ${vw}px screen on ${view}`);
        const els = document.querySelectorAll('.page-view.active *, .modal-overlay.open *');
        let checked = 0;
        for (const el of els) {
            if (++checked > 2500) break; // stay cheap on huge pages
            const cs = getComputedStyle(el);
            if (cs.display === 'none' || cs.visibility === 'hidden' || cs.position === 'fixed') continue;
            const b = el.getBoundingClientRect();
            if (b.width === 0 || b.height === 0) continue;
            if (b.right <= vw + 8) continue; // 8px tolerance — sub-pixel/zoom noise
            if (b.left >= vw - 2) continue; // fully off-canvas = intentional slide-in
            const hasContent =
                /^(A|BUTTON|INPUT|SELECT|TEXTAREA|IMG)$/.test(el.tagName) ||
                (el.childElementCount === 0 && (el.textContent || '').trim() !== '');
            if (!hasContent) continue;
            if (isClippedOrScrollable(el)) continue;
            const who = el.id ? '#' + el.id : el.tagName.toLowerCase() + '.' + String(el.className).split(' ')[0];
            report(`Layout: ${who} overhangs the screen (right=${Math.round(b.right)}, vw=${vw}) on ${view}`);
            break; // one offender per pass is enough to flag the screen
        }
    } catch (e) {}
}
let __laySentinelT = null;
function layoutSentinelSchedule() {
    clearTimeout(__laySentinelT);
    // Wait for entrance animations + async fills to settle, then measure when
    // the browser is idle so this never costs a frame.
    __laySentinelT = setTimeout(() => {
        if ('requestIdleCallback' in window) requestIdleCallback(layoutSentinelRun, { timeout: 3000 });
        else layoutSentinelRun();
    }, 1600);
}
window.addEventListener('load', layoutSentinelSchedule);
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
    // Read-only account preview: an admin viewing a customer's account can look
    // but never act. Every write goes through here, so this ONE guard makes the
    // whole preview safe (no payments, chats, reviews, profile edits, etc.).
    if (ACCT_PREVIEW) {
        try { if (typeof toast === 'function') toast("Read-only preview — nothing here is saved."); } catch (e) {}
        return Promise.reject(new Error('read-only account preview'));
    }
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
    const active = (document.querySelector('.page-view.active') || {}).id;
    if (ADMIN_VIEWS.includes(active)) {
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
        s.integrity = 'sha384-OTofQ0MEeiSgh62havBcemCIK0gqj809wX6UA0uPISNMRnR6NZyCdGzX3SbLrgwL';
        s.crossOrigin = 'anonymous';
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
        // When the booking was taken (booking lead time) — feeds the on-device
        // smart-pricing model's booking-pace curve. No PII; date only.
        createdAt: row.created_at || '',
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
        holdSettledAt: row.hold_settled_at || '',
        damagesReturned: parseFloat(row.damages_returned) || 0,
        // Guest register (UK hotel-records duty): status + count + the token form
        // link (owner opens it to view/edit the actual party). No PII here.
        regSubmitted: !!row.reg_submitted,
        regCount: parseInt(row.reg_count, 10) || 0,
        regUrl: row.reg_url || '',
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
        receivedAt: row.created_at || '', // full timestamp for the "age" label
        // Repeat-guest recognition (server-computed from past bookings by email).
        priorStays: parseInt(row.prior_stays, 10) || 0,
        lastStayEnd: row.last_stay_end || '',
        lastStayProp: row.last_stay_prop || '',
    };
}

/* --- 1. ROUTING --- */
// The customer-facing pages whose words/photos the owner edits with the dock
// "Edit text & photos" button. The button is hidden on the admin tools (Home,
// Reviews, Money, Settings) so it only appears where there's site content to edit.
const CUSTOMER_FACING_VIEWS = ['view-main', 'view-cottages', 'view-21a'];
// The only views an admin ever sees — everything else is the customer site,
// which a signed-in admin has no use for (nav() bounces it to the back office).
const ADMIN_VIEWS = ['view-backoffice', 'view-booking-hub', 'view-inbox', 'view-enquiry-hub', 'view-settings', 'view-accounts', 'view-activity-log', 'view-search'];
// Account preview (admin-only, read-only): opening the app with
// ?acctpreview=<bookingId> — inside a sandboxed iframe the owner launches from the
// back office — renders THAT customer's account exactly as the customer sees it.
// The data comes from an admin-authorised fetch (my-bookings.php resolves the
// booking's email); it rides the same read-only shell as PREVIEW_MODE below (owner
// chrome + the admin bounce suppressed, every write blocked at apiPost).
const ACCT_PREVIEW_ID = (function () {
    try { const m = /[?&]acctpreview=(\d+)/.exec(location.search || ''); return m ? m[1] : ''; } catch (e) { return ''; }
})();
const ACCT_PREVIEW = !!ACCT_PREVIEW_ID;
let __acctPreviewData = null; // the fetched account payload (bookings/enquiries/guest)
// Preview-as-guest: opening the site with ?preview=1 renders the customer
// experience even though an admin is signed in (owner-mode + the admin bounce
// are suppressed). Read-only — used by the staging Test centre to view the site.
// ACCT_PREVIEW joins it so all the owner-chrome/nav suppression applies too.
const PREVIEW_MODE = /[?&]preview=1\b/.test(location.search || '') || ACCT_PREVIEW;
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
    // Leaving the dedicated search page by ANY route other than its own back
    // button (a dock tap, a result run, a deep link) must still tear the palette
    // down: file the dead-end miss, supersede any in-flight federated search, and
    // clear the conversation context. closeCmdK is cleanup-only (no nav), so this
    // is safe to call mid-navigation. Owner-only view, so admin.js is loaded.
    const __prevView = (document.querySelector('.page-view.active') || {}).id;
    if (__prevView === 'view-search' && viewId !== 'view-search') {
        try { if (window.closeCmdK) window.closeCmdK(); } catch (e) {}
    }
    document.querySelectorAll('.page-view').forEach((v) => v.classList.remove('active'));
    target.classList.add('active');
    // Back-office screens end like an app, not a website — the public
    // marketing footer only shows under customer-facing views.
    document.body.classList.toggle('admin-screen', ADMIN_VIEWS.includes(viewId));

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
    // when on a non-admin view such as the public site). Detail screens with
    // no button of their own light up their parent workspace's button.
    const dockAlias = {
        'view-booking-hub': 'view-backoffice',
        'view-enquiry-hub': 'view-inbox',
        'view-activity-log': 'view-settings',
    };
    const dockView = dockAlias[viewId] || viewId;
    document.querySelectorAll('.admin-dock-btn[data-view]').forEach((b) => {
        b.classList.toggle('current', b.getAttribute('data-view') === dockView);
    });
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
    if (viewId === 'view-inbox') {
        try {
            renderInboxScreen();
        } catch (e) {}
    }
    if (viewId === 'view-settings') {
        try {
            renderSquareSettings();
        } catch (e) {}
    }
    if (viewId === 'view-experiences') {
        try {
            renderExperiencesView();
        } catch (e) {}
        try {
            renderExpArea();
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
    // Every view change re-arms the layout sentinel (see its definition above).
    try {
        layoutSentinelSchedule();
    } catch (e) {}
}

// ---- Light / dark theme toggle ----
function setThemeLabel() {
    // Keep the browser/PWA chrome colour in step with the active theme.
    const tc = document.querySelector('meta[name="theme-color"]');
    if (tc) tc.setAttribute('content', document.body.classList.contains('light-mode') ? '#f5f1e9' : '#121316');
    // Manage → Appearance row shows the live mode (the footer toggle is hidden
    // on admin screens, so this row is the back office's switch).
    const v = document.getElementById('theme-row-value');
    if (v) v.textContent = document.body.classList.contains('light-mode') ? 'light' : 'dark';
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
    // Coastal-fresh LIGHT is the default everywhere — including the back
    // office; dark is opt-in (pref==='dark') via the footer toggle, one
    // preference shared across the public site and the admin dashboard.
    if (pref !== 'dark') document.body.classList.add('light-mode');
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
    if (tog) {
        tog.setAttribute('aria-expanded', open ? 'true' : 'false');
        // Reuse the already-fetched (and null-checked) node — the old code re-queried
        // `.menu-toggle` unguarded on the next line, which would throw if the header
        // is ever conditionally rendered.
        tog.innerHTML = open
            ? '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>'
            : '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>';
    }
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

// ---- Back-office layout mode: 'classic' vs 'search' ----
// A device-level display preference (like the theme). 'classic' is the full dock
// (Today · Inbox · Payments · Manage · Search). 'search' collapses it to the two
// surfaces you dwell in — Today · Inbox · Search — and Payments + Manage move
// entirely inside the ⌘K palette. Nothing is removed: the extra dock buttons are
// hidden by the `body.search-first` class, so flipping back is instant. Reachable
// from Manage → Appearance, and (crucially, since Manage's button hides in this
// mode) from a ⌘K action, so you can never be stranded.
function backofficeMode() {
    try { return localStorage.getItem('chb-bo-mode') === 'search' ? 'search' : 'classic'; } catch (e) { return 'classic'; }
}
function applyBackofficeMode() {
    const m = backofficeMode();
    document.body.classList.toggle('search-first', m === 'search');
    const v = document.getElementById('bomode-row-value');
    if (v) v.textContent = m === 'search' ? 'search-first' : 'classic';
    // The active view's dock button may now be hidden; realign (or hide) the pill.
    try { moveDockIndicator(); } catch (e) {}
    return m;
}
function setBackofficeMode(m) {
    const mode = m === 'search' ? 'search' : 'classic';
    try { localStorage.setItem('chb-bo-mode', mode); } catch (e) {}
    applyBackofficeMode();
    try {
        toast(mode === 'search'
            ? 'Search-first layout on — Payments & Manage now live in Search (⌘K).'
            : 'Classic layout restored.');
    } catch (e) {}
}
function toggleBackofficeMode() {
    setBackofficeMode(backofficeMode() === 'search' ? 'classic' : 'search');
}

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
                `<div class="gallery-slide" id="prop-img-${i}" data-bg="${escapeHtml(src)}" role="button" tabindex="0" aria-label="Photo ${i + 1} of ${list.length} — ${escapeHtml(galName)}, open photo viewer" ${chbAttrs('openLightbox', i)} data-act-keydown="ggKey" data-arg="${i}"></div>`,
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
                `<div class="gg-cell${i === 0 ? big : ''}" style="background-image:url('${escapeHtml(resizedUrl(src, i === 0 ? 1000 : 560))}')" role="button" tabindex="0" aria-label="Photo ${i + 1} of ${n} — ${escapeHtml(ggName)}" ${chbAttrs('openLightbox', i)} data-act-keydown="ggKey" data-arg="${i}"></div>`,
        )
        .join('');
    const total = Array.isArray(list) ? list.filter(Boolean).length : 0;
    if (total > 5)
        html += `<button type="button" class="gg-showall" data-act="openLightbox" data-arg="0">Show all ${total} photos</button>`;
    grid.innerHTML = html;
}
// Keyboard support for the gallery grid cells (role="button", tabindex="0"):
// open the lightbox on Enter/Space, matching a click.
function ggKey(e, i) {
    if (e && (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar')) {
        e.preventDefault();
        openLightbox(i);
    }
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
        if (bg && !s.style.backgroundImage) {
            // Load a size that fits this slide (× device pixel ratio) instead of the
            // full 2000px original — big data/LCP win on phones.
            const px = (s.clientWidth || 800) * (window.devicePixelRatio || 1);
            s.style.backgroundImage = `url('${resizedUrl(bg, px)}')`;
        }
    }
}
// Rewrite an uploads/ image URL to a right-sized WebP via img.php. Leaves external
// or non-uploads URLs untouched. `w` is the desired CSS-pixel width (already × DPR).
function resizedUrl(url, w) {
    try {
        if (!url || typeof url !== 'string') return url;
        if (!/^uploads\/[A-Za-z0-9._-]+\.(jpe?g|png|webp)$/i.test(url)) return url;
        const sizes = [320, 480, 640, 900, 1200, 1600];
        const target = Math.min(1600, Math.max(320, Math.ceil(w || 900)));
        const pick = sizes.find((s) => s >= target) || 1600;
        return API_BASE + 'img.php?src=' + encodeURIComponent(url) + '&w=' + pick;
    } catch (e) {
        return url;
    }
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
    // Owner signed in (any path: password, passkey, 2FA, session restore) →
    // start fetching the admin bundle now so the back office opens instantly.
    // Fire-and-forget: the facade stubs cover any call that beats the load.
    // Also remember this is an owner device ('chb-owner') so FUTURE visits can
    // warm the bundle during idle time before they even tap sign-in.
    if (isAuthenticated && !PREVIEW_MODE) {
        try {
            localStorage.setItem('chb-owner', '1');
        } catch (e) {}
        try {
            loadAdminBundle().catch(() => {});
        } catch (e) {}
    }
    // The owner's tools now live in the labelled owner menu bar (shown via the
    // 'owner-mode' body class). The footer keeps only the theme toggle and the
    // back-office (🔩) button, so there's nothing per-button to show/hide here.
    // In preview-as-guest mode the admin sees the customer site, so don't
    // apply owner chrome or bounce them into the back office.
    document.body.classList.toggle('owner-mode', isAuthenticated && !PREVIEW_MODE);
    // Re-apply the saved back-office layout mode (classic vs search-first).
    try {
        applyBackofficeMode();
    } catch (e) {}
    // Re-apply the saved theme — the back office follows it like the public site.
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
    // The account preview names the customer once their payload lands (see
    // maybeAccountPreview); a generic label until then. The staging test-centre
    // preview keeps the original wording.
    const msg = ACCT_PREVIEW
        ? `<span id="preview-banner-label">Read-only account preview — this is what the customer sees. Nothing here is saved.</span>`
        : `<span>Preview mode — viewing the site as a guest. Nothing you do here is saved.</span>`;
    bar.innerHTML = `${msg}<button type="button" data-act="exitPreview">${ACCT_PREVIEW ? 'Close' : 'Exit preview'}</button>`;
    document.body.appendChild(bar);
    document.body.classList.add('has-preview-banner');
}
function exitPreview() {
    // Inside the back office's preview iframe: ask the opener to close the overlay.
    try {
        if (ACCT_PREVIEW && window.parent && window.parent !== window) {
            window.parent.postMessage('chb-acct-preview-close', '*');
            return;
        }
    } catch (e) {}
    try {
        window.close();
    } catch (e) {}
    location.href = 'index.html';
}
// Admin-only, read-only: render the target customer's account (from the
// admin-authorised payload) exactly as they'd see it. Called from the boot tail
// when ?acctpreview=<bookingId> is present. Sets a synthetic currentGuest (no real
// guest session exists — this is the admin's cookie), then paints My Stays.
async function maybeAccountPreview() {
    if (!ACCT_PREVIEW) return;
    let payload = null;
    try {
        payload = await apiGet('my-bookings.php?acctpreview=' + encodeURIComponent(ACCT_PREVIEW_ID));
    } catch (e) {
        const list = document.getElementById('guest-bookings-list');
        if (list) list.innerHTML = `<div class="glass-panel guest-empty"><p>Couldn't load this customer's account.</p></div>`;
        try { nav('view-guest-bookings'); } catch (e2) {}
        return;
    }
    __acctPreviewData = payload;
    const g = payload && payload.guest;
    currentGuest = g && g.email ? { name: g.name || 'Guest', email: g.email } : { name: 'Guest', email: '' };
    try { setGuestUI(); } catch (e) {}
    // Name the customer in the banner now that we have it.
    try {
        const lbl = document.getElementById('preview-banner-label');
        if (lbl && g && g.name) lbl.textContent = `Read-only preview of ${g.name}'s account — this is what they see. Nothing here is saved.`;
    } catch (e) {}
    try { nav('view-guest-bookings'); } catch (e) {}
    try { await renderGuestBookings(); } catch (e) {}
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
// Fill the Inbox screen — also called from nav() so a history/back restore repaints it.
async function renderInboxScreen() {
    try {
        await loadData();
    } catch (e) {}
    try {
        renderInbox();
    } catch (e) {}
    try {
        refreshInboxBadge();
    } catch (e) {}
    try {
        await loadAdminMessages();
    } catch (e) {}
    try {
        refreshModerationCounts();
    } catch (e) {}
}
// ---- Admin history: make the browser/hardware Back button walk
//      drill-down → index → dashboard instead of dumping the owner onto the
//      public homepage. Each admin navigation pushes an entry; the popstate
//      handler replays it (guarded by __histReplay so replays don't re-push).
let __histReplay = false;
// The full Settings drill-down path, so the auto-update reload can restore the
// exact folder/sub-folder the owner was in: { section, prop, accomSec }.
let __settingsPath = null;

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
// Is the standalone RENTAL refund still allowed for this booking? Returning the
// money a guest paid for the stay is only offered while the booking is genuinely
// refundable — before they arrive AND before the cancellation policy leaves
// nothing to give back. Once the guest has arrived, or the policy window has
// closed, the ONLY money that can still go back is the refundable damages deposit
// (via Return deposit); Cancel & refund remains the route for a policy-based
// partial. Mirrored server-side by rental_refund_blocked() in bookings.php — the
// hidden button is convenience, the server guard is the real enforcement.
function rentalRefundBlocked(propKey, b) {
    if (!b || !b.checkIn) return false;
    const today = typeof todayDashed === 'function' ? todayDashed() : '';
    if (today && b.checkIn <= today) return true; // arrived / in-house / stayed
    // Days before check-in inside which NO refund is due under each policy.
    // flexible/moderate stay at least partially refundable right up to check-in
    // (0 → only arrival blocks them); limited leaves nothing inside 7 days.
    const NONREFUND_WITHIN = { flexible: 0, moderate: 0, limited: 7 };
    const pol = typeof cancelPolicyOf === 'function' ? cancelPolicyOf(propKey) : DEFAULT_CANCEL_POLICY;
    const within = NONREFUND_WITHIN[pol] != null ? NONREFUND_WITHIN[pol] : 0;
    if (within <= 0) return false;
    const daysUntil = Math.round((new Date(b.checkIn) - new Date(today)) / 864e5);
    return daysUntil < within;
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

let allExpenses = []; // cached expense rows (client buckets by tax year)
async function loadExpenses() {
    try {
        const r = await apiGet('expenses.php');
        allExpenses = Array.isArray(r.expenses) ? r.expenses : [];
    } catch (e) {
        allExpenses = [];
    }
}
let __accountsSection = null;
// jsPDF is a ~100KB owner-only library (invoices / year-end statements). Load it
// ON DEMAND the first time the owner exports a PDF, rather than on every page
// load, so guests never pay for it. Promise-cached so it loads at most once.
let __jspdfPromise = null;
// The crown mark (logo.svg rasterised at 2x, transparent) for the PDF
// invoice letterhead — jsPDF can't draw the SVG's gradients directly.
const CHB_CROWN_PNG =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAALQAAABtCAYAAAAI/EvVAAAQAElEQVR4nOxdC5BVxZn++9wZXk42rpqUlZ1KynJjJIkxAYMYX5B13cLEDCY60U0U3JBABFEDgqjgDcPyUAyPgUTQSkAlpRMMaCJoKhtmTdgVfNSSWAYSiZvIssYVxZLXPG7/+593P885d+bemct4PmX6dp8+/fz767//7nOOAzlyDCA4kCPHAEIu0DkGFHKBzjGgkAt0jgGFXKD7ADseWnn2Cw+uHg45qo46yFFVtLW1FQqdb/ywBKV3yTsGclQVOUNXGad1vnEjIo5gABfveHDFFMhRVTDIUTU8+/DKxgKw3wNCAwk1MAaHSgyGj/769H2QoyrIGbqKKICzyhNm+uOCIzawEq6CHFVDLtBVwvMPtY4HwKZQmF2GDtymHT9aNh5yVAW5ylEFvNS2uuFoJydVAxs9MUb3f/oPgwiI+44Oqx8+tnnqIchRUeQMXQUc6+ILXGF2+SJkZleoXfYI/I2DD3cugBwVR87QFcbzD60aQVy8k34WBDUjcn3G9twSQxh13r/c8iLkqBhyhq4gXJszier9RBO+MDNZmIMfoUtx4X73HshRMeQCXUG4NmcS4hEaM4cLwyBeLNM44kPvvnYj5KgYcpWjQnBtznVkc3ZNc67fszvTf5xzcA3QkXCHfh4wOMdDddg9fPQ3Z+e26QogZ+gKgTZQVpPMesLsLwADIWaquhGHB1Td0A11uW26QsgFugJ4YcPqiSScX/I8sToBoV+wbnjqh+oHhk3PrFma26YrgFzl6CV2rF91suPgHvp5ssmqYXa9v5JLf/eVOocNHzs1t033BjlD9xKsgPcSLZyMYLBqiLqzqG6AuDAMEkJorKs/mtume4mcoXuBnT9eeTHjrF1UL3xbsyC0GO8Qor9lmMTcJRL5URdNnpXbpnuInKF7iD+uXDmYIVsbWjNkHZkJQgwG5rYJNRbISnL/FkobcvQIuUD3EAf/ls0BDmeEwqy6HkSXKS7Y7NNsxND6o3MgR4+Qqxw9wI5HVp3hdOFvqfUGe/ZksKsRHEWrBtmlkUtCzwW7NDnk98I7SqXSpy6ZdvsfIEdZyBm6ByBhXusJs21HUFj4SSY6RM3vSbF/+D9mdsDBjlNYCznKhlGgX336x+NffWpDE+TQ8MKGlRNJKi+W7chJ1g33LwNdC5EDBGEOXH7xv61eNBFyaPjpgjuaNrbMMdrtjSrHa0+1ndQFnb+jxh1GDb2Z/rUd/OCxX55zzuQueA/DszkXyOaMeLJ+zhllYUXBqpFq3dCZPUjvAIV9jFSPA/Aexpo136r/wP994DIEfhVJLG1g4bulriFnNReLb6lxrTr0K1seGu84sIkHuh3peAfBYZvhPSzczz+8ah3pwBMkHTjQiUNdmSvqBY/PbIg6cszkrg4t2adVP64ngZ4I7zG4QvzBN0+5hFqjmZptPA3vE/124YDMueyqOxZuNd2XuCh8ZcuDj1CEr/q6obR6P4gMNiNjbe++R4Q7tDlLduWE886qP2J04bfPwsKTLOGuobqw5DDm0um3/zsMcEhCzNh4qv+J/hVx5oL1V95pV8USBfq1px446Riv/x0x0IekhU3AOIGueJC5ws152xnH3vcL1txcggGGP25ZOfjgAeZaNc4QTsl518xqAxOYVnVDIY0Z2+aG6VH7/6ETGz512fTpHTDA4Anx26dcQjLbTNQbMLHYjvGCmdz9pa4OUjWWvWVLL9Vs98qW9eMorS1xJjGkHTJ/FL1JYZsQWdvwzoZtA0W4n3to5WJqzdmS0Eo6Mgg7ghadOs1V0tMeDODw3X+86Y4iDAC0tV1VqP/TRy8lAW4mCRxPY/1EgFi21OMBEUMzJFVjydaktDPZoV95cv19pBtODnVEppxRsByVfJMiHvfC7T1SxXAn1avAAjuyC+28s4m5MzO5idllJqd0OpyCc9zapl0hHrT3Y2OBYTPV7wqq3yluuImJRX9Uf8Q1V81dkvqinkyvAjtcx2YM7cLLKdEPxYVIW6WzU+jHN91/L9e/8+bLmx/YBN28bfhL+3/FikUOxwG8R6o6/3o/eMIsz0jxuWbtfHNkjwZju1jbS+rM8HqUL9m9abPFtU2PgeMEsRCTOvEnuIKI4RRhAZFt5gKPRPceG1KakSXPzDuFe55YP44xviVo80SGFlf9YqcHff46/XiMY6ntrN+9/ptaFu4XHl51MzHyMlXIRFe0bhhd7s9oXLRmpDJ3QudyvH7cLfPWQY2iWCw6nz6h+/NQ8hZ2ChP7g5ep8uO1j5mhXddB54KvzFu0PUv+ZW19737iR/fRDZMRDDoOiswE8mo/iib4/T+vk/MYTUM1J9zhI1UYvvkIyxE+MNigvStmN7B8JM94kU5+oK6uUFO2aVeIPzOk6wIy67oLu69QSU8VVOK4HnGA6IDYHpI1zb8jk6oRoqy3j3YMLswYfKz7EsrzdI2JIdYBmU/VsZ1VYuggnl/YU8k/lSGb+tuPn/r6f/3kvsccDm1n/b7/hbsAsIpK2CDOPDqzqjpv7AepT+IfIfNofo3JQ/t26IeQ+U/u6irdSz8nQj/CE+IGuAB4N9mJ+VcQnVOlQQ/KKcQUJlaFOWjvzKpGiLIPJ+1+fN35iKVn6E4nYmKVsRUmFpk7Go0MJAYLrgjM7TxGP9s+0zz519QQCH0I9zVeZGffpDMnRGwal71Ma4YtvSA8tHj4WaCSZ1wehtg0bkbxCehDxELM3c2OBCbWhRkE2jMxtOgP7iPR5xd9dd49mVSNEGULtIvdj/9wOTHHTbp1Q2FigZk5mqwhTKgc2nTwfSTQG10792eumfpstYU7fI0X5dsolpurO3iiVUN1wSbEdru05qalC7hv6GAYPnZqsaqPbLnV33Jv8cJuEmKHkRAjCbFhzaQxMSozMqrMzIVwxQ9euy/56l133wZlokcCvevpB0+oP9q5i1r1dK8SflXMDB34UQiQGRsSdCw53BNugI3MZe4qCffzG1qXU9veBIodWWRIoyvMNsl6czkMbpoZpDxXfGFm8WaoMFyZ+vnSuaNplnSZ+ErKqTG8YNBxtXrF6WRiYj0+4F7Gh328uVjshDLRI4F28dLjD5xP+u4zVAhHZ+Ko7nGhxUpksoYII5mJh+ejkbyP3I3cgbZRFRJu1+bMAXcyy2u8TK523pl0YJGhROuGvgMon/3QXQOTcxRnOLLk4agvzSr2+pEtX4jnj2ZQcjc7rnRnKNG+rgpzzMTC+e5gzRTvU6hMrDN2aAUS0qUEsGxVI0SPBdrFyz99YDGNptnpTBxUQmQwVd0Ik4jig6SrCmZeJb4XYR/920hjq+3cCdP+E3oA1+Z8Wudfd1I6I7KfkgtKkMC8KDSI6JfYXxj0qMx0mMbsCC8e+cjLo5qbf1L2xhXdT0LcMpo5Jdc6cSWFNGZufwYApv6Q6hvXlTG9vfR7vd89UjVC9EqgX2prGwSFgzuptGdrujNHq46VzsSGkYyKDq6P7DCd/6bwNoDST8697jvPZ63Lcw+vpKmbLTPrsEw4FZei+2ZyY+tPxOhcP7Wnurb0aH1+yxdvLS6HjNi6bP55JXdh5zIxj5lYZdC4nW3her+C1h/a2Z+43Hr/7WI4dFRPVI0QvRJoFy9temAUdc6OoFSgMzEAGEa2iQlA1bHiiJZwIV3huhB/L6tzxmT5BMRzD7c+TTdcKrKSxCioWjfKEWIhHRvjiukK6YftJLtqXHzi8lktqQ9kbFlZbMQu1k43nJ65/eNg08yohev11tON6qHF52ddXVz6EvQCvX4E65NXTNpJ2usSiWmjacrAzFw13aAk/DxRKMT4oMVTd6AIp/Ou7myv2cLSdCpghzj9h9NsOLsyMT8w5FfGezi0+oGh3gLjgZK+IEwd1GazIEsVu9kq6p/Ttfa35O/V12C1QTl/CO3kcjy735Q/ZfPd3gqzi8o8U8hPnEeV34UiQ4OpU+VeVZkgakRbPMEvCZclnyC86T8yfALis9fevIcDX8ws6QhnKrRySdIfOfEwMJfLMmjFTRyRQUFcGAuDCtniptkL9kAKtiwtuueLm+S1C+j5q+XSSUIfDKZ6CCW3ql1x/F0FGLYQKoCKCPQnm5s7mYMT6GdnauUBZL+pESEeyUbmYCqTq6Ykpk7nrdtWr26AFJz0NltE+e1JKr8gdcKdAkMBGM4qyIMieTDq6YHaDiyq157C0LcXQQq2rS42kPWmVUsHTOQAUrkgoX+08qjhGLeX3B6Sv5O2zCf0Rm8WUbGnvj/55Sm7aNq4y/2NqSPYJvTuXyaFpzImZGAAWr0PGtqR+pqtj06f3sEZn2LqdL185lNxkctkNyhH4AYImdyQntUVTaFU1sumt6Ye+j9yFNy6N5bbL2bmNewA2uJDgrBDJPR3XT1vyS6oECr6GoOzX/7fu6mQu2w6lSaELGZisAiljYkxgxAoTDnt1/cvHZlWh/OuvaWdBtF6v+8U5kzrHEP5o04HufM9SHZ6w6BQ6yOmh7D+8lsXtEMKaINkJG3jT9PbX89fKj+ktmdUPz8o9IN8nZvKH6W/fTc74W6oICoq0O6BIo5sApW60z6NZRNGo/Ck6qRgT897hTOsyfYJiMIMyv5AxJyQwECQxuRKfZmB2SFOTxLmsDhec4j38QNdpa7UQzvueWSqyxoSqoLcnmCoj6KbZ50xwgJC2qDW/J3QDROKFT6EVvEXzYy4eoq7JX4XtwgnGCpps4bE8aPpySjEzNZZqE2HI09958+pn4CgzRn39QEzvfsgFrrIZSxBSEErn+xPGhTB4DFbM0T/zC/fvij1+Oiw1z5xIwn/yNBuLBYoiSRYwswIGRa6DGz1A6FBSNVYcM9eqDCq8uaks3f/9W6q1PZMI5wZGg0tjQZG01yKsGgM0bLt/iWNaXU47/pb1lH0dnWm0a0dsQ4MIHZ6UvlAd1kCk0sLQmz/0qyWdZCCLUuKrs7cIm2GZG03TFu4qn6w1M/aLxVXNUJURaBd1aME3RPo5+FkJgC7nVMz/fkiE5+FAOm+dCGKZoIG75PFGUDq0xRiqg7Taj/eczDn7xZQs24oTB6NCUgQAkEdoRs6qP6ZDrt3O9z/LHOCUNp2cI3lMLVnghoTQrruW6cOs25WcVUjRNXebXfO1dP3UmXuTNV5y15o2Tq/rAVj0zNrlqTapi/4xs17qHiLk4VCYXDJjhyUE0BZ0Jnt7YDqoJDrCRwy2Zx/RjZnSr/JXM5y2inOX97j6Xl/kXl3ZjVUjRBVfVnjiD+8uZIqsT1pgajbOQGSTHJmJk5gHmVmCAtA9NDq2mchBe8crl9EvbknudPsQhJCyl8QeslvKn/sz2RzbnPrhNhqH3SYbN0w9QdLmhlBbw9BZ5fyR9h+TfHe+6CKqKpAe49RFfgEqsxh11/OSI795U2DdlfT+RqhMCTVNu2+3AV5yZvmVTuyXF5mcRUhYuZ6C4Y9SagjlxUy2ZyHHuYLUPksc1ZmBWv5bGsXMPhVnT0qx2HGyQJWZVT96eW1HwAADy9JREFUdbqu6kE9NVNjYlD8mLzgA4OQsASdD0zhms7nTPvV9xel2qYv/Oat7STM65kiJOo0nDSzaEKurimi9gBd+Jlrcy62pxTTsznTjuC0qDxWHTc+k6Zd59kGgal9kxaSDKuraoTok/dDn/P1G91pZmvmzu5xPIj9LEuncLLPsky26cGDumaQsBwA8/ucg79q+rb8AWx2abn8XooHurqy2Zw5hzWsjIcTTO0mDlJIbHeLFcqQPi0Et17TUl1VI0SfvfC8UIBJEFg9mGBnVhsHTNaQROYGJRwUHU64jsZ0Rp785qsZbNO3H3BZRmUmMFo3mDSomGCliV2LcCnWHfqVyeY85NUzqQ5spDaITTt+kE3YEczCy2ynCtHQn4hvOYXCJOgjMOhD7HhwhauL/sD97VVXYYhYOAJffMELjIkDpXTRlA6CsNNmPn8b5Q9wyOl2ho+dnv554va1d28jyhkT324554yBMAUuopAf2s45q+edsf3yWS1j08r0GNmc66D0e/oZfZYZDPXV2zm5/YX2AS1dFAeLEF9hePrv+q+1fG8d9BH69JMU5153033UKP7L9mzMYHtqOkhD7QSRibPsUFlmhoZSgWezTXe7dmD33LSlPLb8AXXrApPOZoDCbO4550w253pWorJjg1weAzMbz2JAXD6DXZrbmNjUvop1g35t7UthdtHn31jp7i5MIhOQ9zpUo1AkmpQMwmtVR8rVybHpl60LU23Tn79htmvCW5w5H9PCzP2jPW4GIJ2hyHjO+WdL7ozOOavCmK3+oLSz3QQKQjkBLP0X3Qd9qmqE6HOBvuAbN+5335RkFE7QG8kk1N6OoaUTwChklm1k0IQvk236aNfQRRR/DxPKkzxYTNYMwa8Pymw252KxoQSs1SjMiWuUpEGnzow6mah+eVCGufCp1xTv3g99jH75Ctbo6296hOr/eLqQuX/NTJN1YRO79gM/gtvYxesz2aYZwynm882i6+drHmQWoXIrxpxMNufBQ7qprNhoZFxmr7/erqDfbylnxnZ/9Gstyx6BfkC/fdaN87obyHnL07W8djB3ss7E/v3Gg0cse+NDJGtap057esX8VNv02G/PaSdnfXQjgCi7hvRN55316Z22MDPZnDctmuueoptmW3NAhkGeeBbDwMRqe1nad/+gOrwB+gn9JtCu6kFCOdXzoEE4QRdKSGBeBnqnSP6kaVWIx7z3NGazTdNaYAbdcMBYXpMwg61e4NWDBm/mc840Q6yh21POOYOlvmkuQHK6JvIJDvsDm5r0yYhqo18/vHn+9d95hJrg0SSdTxQCBLuwREwepK0xMS+rc0b+zf/sTrVN+6+0Dc5NG8obFUC1ZjDBuhAX2P2TyeZcTzZnSm+keH+SUJe7RlGtFXr9lDVL3H+PXrvg3s3Qj+j3L8k6nN2AyPfr1g1dxwMrE2fV7fT7xASlcIe1uO+xgBT8w9Q71lH0dnM+Qn6M6YMRBDfjOWfX5kyjt0Urb5KbZJWwbZKwFKEHrR37VdUI0e8C/blJ33mLBvdUsXHQ/xH5BW/AxGjuHEhmFuNZA/81IoZBhA1OKdu56UKhNIVu62DGhRZYyyP4M59zdniXZ3NWZ6JgzFiFDmwLb9szf2hg4qTrnE/qT1UjRE186/uiSTM3U7M8KjKx79iEUo0HcTxm6xwrsyj5SSa2pi3LWjLYpufuYQiLMV4JGuthHKTe0cxs55w3LbzTLUtTmhqBKcKn1j+5nTKYQDlf8/WFy7dCDaBmPl5fB84N1FT7rYzmuij70RIv8Zm4LEIOohDyTLbpLvY+sk3DHlCEBND+9HYQvqc+o83ZtZN79zH7G6YA0oU5nYmT20U43+y6+7Gzrqy37FcTNSPQrupRQubtLMk6H7MyaCQsmQ7gqJsbme2wjUc6IJNt2lMbmJC/YKeODybJmy1ZzznXD+5cQGuNRtmqU97gzCrUGqlA4ow56bqlSw9DjaBmBNrFmG/N3EqttUY9K4D+D+MChodMkcEuHbkIik6N0fQf5wdiPtPcs8Zp5R93y9x2Uh/We+XwQpimXkiDhmW3OVP0aelqRPbz4uZ36YFUXomJAaT4wfRYM6pGiJoSaBfHhrIZ1Nj7s06DyboymMNTtnM1Uxjn3vst/PdcJKO+vjCDbjwQ3W+3bmQ+54xYWgOefdxUz5DpbUKe1B6xP/lIq34fMtxbS6pGiJoT6H+67tbDZMKa1BtmkeNDeXZYY/qekIwc9udPZLJN0x0zk8vvMng2m3PhlTPcPEd6Mweay8cS7MYhbDNFyMR2O74xXfd11hNqSdUI0afnocvBth8svo+abrLniYgzZlAU5kFR5zYdlAFVjRDSAdCFGQyDIvAfquPO8MtmF1PPTW/93vxtpPOOQaG8GHmynnOe1chKdd63EsWChenEMotgVAsUf9Q+UjrxD12YQ0eZEQBXTFi4vOLfdqkEao6hQ3SeQFM3sL0mppOE08Y0KlNZp2GB6VJW/5R+Q7d39jgDHEYLRNP7prOfc2a8bhXFl845256+tgpjxvYxuszUPnwv66y7A2oUNSvQnuoBpQng9UHS9G3oXEUYBWYxp2O7D9TB4DlN7hlkSMG4m+d656a1A0gZzzlvXDhnPKkRTeF90f3GHTy1/mCuH8jv5wBdrYrzMdxPHeF+iKImVY0QNSvQLj7/7du3U1u26kwR+NHCxCnPvGmdZdvmRbOwcGCtnl04Baz+pEUc+R4h/cznnJlbb2B24TSVF3ShN9U/9CMIwpz8ltCwne6ZuGh5j75O1VeoaYF2UTpSdwc1tvf4u9/GSmOn7nTZGJ2lM5o9nUb/LHIyXNs0NfGUSPgyvs+5rv6Y9D5nsJYbIdmqoQg9YOqmjzldz36+a+igE+dBjaNmF4UiftG68Hxq3mfIrupo3zUMviYFUSfIX9PK/PUsML/Wy/Rtau86YAnQOfeKOS0vpJX/5/fMW+cW6/LZ8yemxW2bf9vIQoHtoHwKkg5vsLMzw9fGOKLxi62gtFccn2vtobYXReAOL424dklrxV5MXi2U9fH6/sKlN96+/Zet/zqBGvnvPSHlwXv+FAbyF0xeL/jBECyELK+S9ZMJx7Qr1FwIFxnRDXDifIP4DPE0+pEq0MicmZDhrdQuCnXsNF7CBf7kGeTnZc+E8nK5HmE5PSeohz+ag2Hqh3tw/PbwUw+EPLzOua+GhCtYCPIt8d0TjgNhdnFcMHSOHFlR8zp0jhzlIBfoHAMKuUDnGFDIBTrHgEIu0DkGFI4Ls52Lp1bMn4KcncrJ2BQatDw3+hG6obHOd11DVHJ8OR8/fSd23Rt6Gt8AsRyOE5og7RnE8XoaX8tZcl07tMP8ZgtdtcRkoNx3dfGeB+A4wHFhtnvye/OnMIY/iPYYQBBaBND6INxEQOVKaI5W7gj2EOTTdkyNH+enJBfvwkSbLnp+zBAeXTXkx8KzJ1rl4k0lMb/wiRg1AzQUyBxfaAE05NfHbxHtKWpeoJ9YVhxRQPYsNWq9FyAIa9TpIOycKeFhX8nh8qH4eGeMKekLO5LC/cZwRHHDUgmXD/lnD5fLYQ4HeWcQ1PKI9VXKqbYbMz/xwry3kPIj9OfCaxcufxFqGDUt0D+9p/jBegefoz76sBcgdJoEE5OC5ohUrIeDRsxGZssWHiar5ydur4u3SafgMjApGMJVYZXKYYCaXxwupivF/wsMqvvsdcWlb0CNIuOGbN+jWCw6fzcIn0TOP+X61bMUIDCMdh1lBgp+gP6GJhOzydvq4tkOa36269YjmcrMIsZPfN+1eEoOtHLYnyEUB4HCwInffVQPKMH7eXfp3E9fMu7B9vZ28yjpZ9TsovDTQ/lCauyL3N88OGDjnVFAsbP9uOGBpPgsQhgeX5eEI1woIReOUIqdzQP1gkuDI1RpowNQnEf5BEcnvEjiIEK1nAARk3Ip3D+DgtJgFMrvT/tROeLraBTi8OCRWEBU8ovKw8XyxwH6YPX+XvSRI28vpB+3QQ2iJlWOzYvn/jMJ0wZRt8X+0GEBJHVA/ca3oHKDXVctN9xvA7tuK+cHKWsCNT/QwkFvT3FBbWh/z3rE8YuTlrY+CTWGmhPojQvnnEnmrxeoZMNAnS7DSJHWYbYeSG8wyqjD+j/0/EzWA9RvhGh61lVSqJwOq4QL1TRFRDCFp61BsoXT/+8UEEZff++q3VBDqCmBbls8+/2FkvMsMcKZMtMAQBLzgoVJAx0xYi6RYRWmhzKYVxokmG4lUHVYyXrAzfnpzBuqBWp+ynlnZSbT4nNLe1ryk9onyE+YAXbzuq7Rk5esfQdqBDWlQ7NutoGa6cyw0Xigw8o6o0GHhbiz/euKy8POMuuwoOqUxvwgWkBVVIdFUZcWymPUYf0fej25tKBFJT9u0ZnV+kGUPhjqI+cXNMiZ0FnYQJ4vQo2gZqwcbfNn30ad8m2JmRGEBZ7Y68z8LWlQdFxbOFOFnulqiHIdUt+UD0J55PxE4QQlPzQIDyRYK0wPBov5gZIfGvJjZebHwJae555x+efO6fj5s8//BmoANaFytH139heQwRPUOk6SzpwaLs/uEfpOh5UDUM8QeqXDKsVFQ37ymgJNyUHaGsTWnuKmjRwOnLbNx05ZseYZ6Gf0u0C33TX7w+jgb6mR3m/SYcVnAhkzM6msk3KDTmvRYUF8Bg/s1gCIO1PXSTkYdxhN5UtZE5jyS9FhpfzKsv4owonYa+vPG3UO++zklWv/Av2IfhXonxWLww7h4V9Ts4wwTfshtHChc+zxRSEGZQctiUnRED9K2BBfFhIxeY1JAx1KKR0ol4356czLopTBxqRaghCHyQwrqRVxXD2/0GtsT8AX67ucCyevXXsE+gn9uih8lx/6PjXiiHi1HkNl2JhpxB0uWWeU43PJvsu5mE7IdHYm5VxPV2M0iemFp6mDBaTMpFxiUq4yqfh0uYFhtfhe/QTm5TKT8mhhqTEpRNYfIZxjrA4xsLWnMHMa2pO8I44VSt+nCxOhn9BvAv2jYnFIqfvQOmqFdb5UiZNFt/dXIgwGUbToqeRuFGJ7d8guChQUpc+CYCaQV7ecfreULV1V0wU5fSU/KX0W5Ot2uptunZt+t5I+pKQrh0fv1wgTENOP6sUgyI7cbiUdkKHkZ2tnOVaYPgsuMz3dfkC/69A5clQS+RMrOQYUcoHOMaCQC3SOAYVcoHMMKPw/AAAA///ykNkNAAAABklEQVQDAOYFD8a2IswrAAAAAElFTkSuQmCC';
function ensureJsPdf() {
    if (window.jspdf && window.jspdf.jsPDF) return Promise.resolve();
    if (__jspdfPromise) return __jspdfPromise;
    __jspdfPromise = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
        s.integrity = 'sha384-JcnsjUPPylna1s1fvi1u12X5qjY5OL56iySh75FdtrwhO/SWXgMjoVqcKyIIWOLk';
        s.crossOrigin = 'anonymous';
        s.async = true;
        s.onload = () => resolve();
        s.onerror = () => {
            __jspdfPromise = null; // allow a retry on the next attempt
            reject(new Error('jsPDF failed to load'));
        };
        document.head.appendChild(s);
    });
    return __jspdfPromise;
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
    // Returning guest? Load their stays (once) and paint the welcome-back
    // nudge + "stayed here before" notes; clears them on logout.
    try {
        loadWelcomeBack();
    } catch (e) {}
    try {
        if (window.setActiveTab) {
            const av = document.querySelector('.page-view.active');
            if (av) window.setActiveTab(av.id);
        }
    } catch (e) {}
}

// ============================================================
//  Welcome back — a RETURNING signed-in guest gets a personal homepage nudge
//  ("Fancy Jollyboat again?") built from their own past stays, plus a quiet
//  "you've stayed here before" note on that cottage's page. Their stays come
//  from my-bookings.php (their own session — nothing new is exposed), fetched
//  once per session, lazily, after the guest session lands. Everyone else
//  (logged out, owner, first-time guest, upcoming-only guest) sees nothing.
// ============================================================
let __wbStays = null; // this guest's stays, loaded once per session
async function loadWelcomeBack() {
    if (!currentGuest || isAuthenticated) {
        __wbStays = null; // logout / role change: drop the cache with the session
        renderWelcomeBack();
        renderStayedBefore();
        return;
    }
    if (__wbStays === null) {
        try {
            const res = await apiGet('my-bookings.php');
            __wbStays = (res.bookings || []).map((r) => ({
                propKey: r.prop_key,
                checkIn: r.check_in,
                checkOut: r.check_out,
            }));
        } catch (e) {
            __wbStays = [];
        }
    }
    renderWelcomeBack();
    renderStayedBefore();
}
// The guest's favourite cottage, from COMPLETED stays only — an upcoming first
// booking isn't "back". Mode of cottage, live cottages only; last stay for the
// "you stayed in May" line.
function wbFavourite() {
    if (!currentGuest || !Array.isArray(__wbStays) || !__wbStays.length) return null;
    const today = todayDashed();
    const past = __wbStays.filter((s) => s.checkOut && s.checkOut <= today);
    if (!past.length) return null;
    const live = liveCottageKeys();
    const byPk = {};
    past.forEach((s) => {
        if (live.includes(s.propKey)) byPk[s.propKey] = (byPk[s.propKey] || 0) + 1;
    });
    const ranked = Object.keys(byPk).sort((a, z) => byPk[z] - byPk[a]);
    if (!ranked.length) return null;
    const pk = ranked[0];
    const last = past
        .filter((s) => s.propKey === pk)
        .sort((a, z) => (z.checkIn || '').localeCompare(a.checkIn || ''))[0];
    return { pk, stays: past.length, last };
}
function renderWelcomeBack() {
    const el = document.getElementById('welcome-back');
    if (!el) return;
    const fav = !isAuthenticated && currentGuest ? wbFavourite() : null;
    if (!fav) {
        el.innerHTML = '';
        return;
    }
    const name = String(currentGuest.name || '').split(' ')[0];
    const cname = (propertyMeta[fav.pk] && propertyMeta[fav.pk].name) || fav.pk;
    const when =
        fav.last && fav.last.checkIn
            ? new Date(fav.last.checkIn + 'T00:00:00').toLocaleDateString('en-GB', {
                  month: 'long',
                  year: 'numeric',
              })
            : '';
    const slug = COTTAGE_SLUGS[fav.pk] || fav.pk;
    el.innerHTML = `
        <div class="glass-panel wb-panel">
            <div class="wb-text">
                <div class="wb-title">Welcome back${name ? ', ' + escapeHtml(name) : ''}</div>
                <div class="wb-sub">Fancy ${escapeHtml(cname)} again?${when ? ' You last stayed with us in ' + escapeHtml(when) + '.' : ''}</div>
            </div>
            <div class="wb-actions">
                <a class="btn-glass btn-accent" href="/cottages/${escapeHtml(slug)}" data-act="cottageLink" data-prop="${fav.pk}">Check ${escapeHtml(cname)} dates</a>
                <button type="button" class="btn-glass" data-act="wbOpenStays">Your stays</button>
            </div>
        </div>`;
}
function wbOpenStays() {
    nav('view-guest-bookings');
    try {
        renderGuestBookings();
    } catch (e) {}
}
// Quiet trust note on a cottage page the guest has actually stayed in.
function renderStayedBefore() {
    const el = document.getElementById('stayed-before');
    if (!el) return;
    let html = '';
    if (!isAuthenticated && currentGuest && Array.isArray(__wbStays) && activeFrontProperty) {
        const today = todayDashed();
        const here = __wbStays
            .filter((s) => s.propKey === activeFrontProperty && s.checkOut && s.checkOut <= today)
            .sort((a, z) => (z.checkIn || '').localeCompare(a.checkIn || ''));
        if (here.length) {
            const when = here[0].checkIn
                ? new Date(here[0].checkIn + 'T00:00:00').toLocaleDateString('en-GB', {
                      month: 'long',
                      year: 'numeric',
                  })
                : '';
            html = `<div class="stayed-before-chip">You've stayed here before${when ? ' — ' + escapeHtml(when) : ''}. Welcome back.</div>`;
        }
    }
    el.innerHTML = html;
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
            msg.style.color = ok ? 'var(--ok)' : 'var(--danger)';
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
            msg.style.color = ok ? 'var(--ok)' : 'var(--danger)';
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
        overlayHistPush(); // Back closes this overlay
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
    overlayHistConsume(); // eat the overlay's history entry (no-op if Back closed it)
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
        const res = await apiPost('auth.php', { action: 'admin_login', username: id, password });
        // 2FA on a NEW device: the password was right but the server held the
        // login and emailed a code. This guest modal has no code step — hand
        // over to the admin modal's existing 2FA step. (Previously this path
        // ignored `twofa` and pretended the sign-in had completed: no code
        // window, and a half-signed-in state where every admin call failed.)
        if (res && res.twofa) {
            err.style.display = 'none';
            closeGuestAuthModal();
            adminLoginOnSuccess = () => {
                nav('view-backoffice');
                refreshOwnerHomeBadges();
            };
            const m = document.getElementById('admin-login-modal');
            const t = document.getElementById('admin-login-title');
            const s = document.getElementById('admin-login-sub');
            if (t) t.innerText = 'Owner sign in';
            if (s) s.innerText = 'New device — we’ve emailed you a one-time code.';
            const aerr = document.getElementById('admin-login-error');
            if (aerr) aerr.style.display = 'none';
            if (m) m.classList.add('open');
            showAdmin2faStep();
            return;
        }
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
            msg.style.color = ok ? 'var(--ok)' : 'var(--danger)';
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
                    <button class="btn-sm btn-decline" ${chbAttrs('deletePasskey', k.id)}>Remove</button>
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

// ---- Guest price box: ONE renderer for the itemised price on My-Stays cards
// (pending enquiries and confirmed bookings), so the two can't drift. Guards
// partial price data — a manually-added booking may carry only a total, so a
// missing nightly/fee line is SKIPPED rather than rendered as "£NaN".
function guestPriceBoxHtml(p, o) {
    const fin = (n) => typeof n === 'number' && isFinite(n);
    const rows = [];
    if (fin(p.perNight) && fin(p.nights) && fin(p.nightly))
        rows.push(`<div class="price-row"><span>${gbp(p.perNight)} × ${p.nights} night${p.nights === 1 ? '' : 's'}</span><span>${gbp(p.nightly)}</span></div>`);
    if (fin(p.txFee) && fin(p.transactionPct))
        rows.push(`<div class="price-row"><span>Transaction fee (${p.transactionPct}%)</span><span>${gbp(p.txFee)}</span></div>`);
    if (o.dep > 0)
        rows.push(`<div class="price-row"><span>Refundable damages deposit</span><span>${gbp(o.dep)}</span></div>`);
    rows.push(`<div class="price-row total"><span>Total${o.dep > 0 ? ' (incl. deposit)' : ''}</span><span class="price-amount">${gbp(o.total)}</span></div>`);
    if (o.extraRows) rows.push(o.extraRows);
    if (o.dep > 0)
        rows.push(`<p style="color:var(--text-muted);font-size:0.73rem;margin:6px 0 0;">Includes the ${gbp(o.dep)} refundable damages deposit — refunded after your stay.</p>`);
    if (o.note) rows.push(o.note);
    return `<div class="guest-price-box">${rows.join('')}</div>`;
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
        // Account preview reuses the payload already fetched at boot (admin-authed,
        // action-tokens stripped); the signed-in guest fetches their own.
        const res = ACCT_PREVIEW && __acctPreviewData
            ? __acctPreviewData
            : await apiGet('my-bookings.php' + (ACCT_PREVIEW ? '?acctpreview=' + encodeURIComponent(ACCT_PREVIEW_ID) : ''));
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
    // then past stays (most recently finished first). "Past" is DEPARTURE-aware
    // (hasCheckedOut) not just date-past, so a guest who left this morning sorts
    // into the past group the same day, not at the next midnight.
    const todaySort = todayDashed();
    mine.sort((a, b) => {
        const au = !hasCheckedOut(a.booking);
        const bu = !hasCheckedOut(b.booking);
        if (au !== bu) return au ? -1 : 1; // upcoming group first
        if (au) return a.booking.checkIn < b.booking.checkIn ? -1 : 1; // soonest upcoming first
        return a.booking.checkOut > b.booking.checkOut ? -1 : 1; // most recent past first
    });

    // Fetch this guest's own submitted reviews (per property) so past
    // stays show the right state: review form / pending / approved.
    myGuestReviews = {};
    if (!ACCT_PREVIEW) { // reviews.php 'mine' is guest-session-gated; skip in an admin preview
        try {
            const rv = await apiPost('reviews.php', { action: 'mine' });
            myGuestReviews = rv.mine || {};
        } catch (e) {}
    }
    const reviewShown = new Set(); // one review block per property
    const photoShown = new Set(); // one "share a photo" button per property
    if (mine.length === 0 && pendingMine.length === 0) {
        list.innerHTML = `<div class="glass-panel guest-empty">
                    <p style="font-size:1.3rem;font-weight:600;margin-bottom:8px;">No Bookings Yet</p>
                    <p style="font-size:0.95rem;">Once you book one of our cottages, it will appear here.</p>
                    <button class="btn-glass" style="margin-top:20px;" data-act="nav" data-view="view-cottages">Browse Cottages</button>
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
                            <h3><span class="legend-swatch swatch-${propKey}"></span> ${escapeHtml(meta.name)} <span class="guest-status-badge" style="background:rgba(255,167,38,0.22);color:var(--warn-text);border:1px solid rgba(255,167,38,0.5);">Pending</span></h3>
                            <div class="guest-ref">Awaiting confirmation</div>
                            <div class="guest-booking-cols">
                            <div class="guest-detail-grid">
                                <div class="booking-detail-item"><span class="booking-detail-label">Check In</span><span class="booking-detail-value" style="font-size:1rem;">${fmtDate(checkIn)} · ${checkInTime}</span></div>
                                <div class="booking-detail-item"><span class="booking-detail-label">Check Out</span><span class="booking-detail-value" style="font-size:1rem;">${fmtDate(checkOut)} · ${checkOutTime}</span></div>
                                <div class="booking-detail-item"><span class="booking-detail-label">Party</span><span class="booking-detail-value" style="font-size:1rem;">${escapeHtml(party)}</span></div>
                                <div class="booking-detail-item"><span class="booking-detail-label">Status</span><span class="booking-detail-value" style="font-size:1rem;color:var(--warn-text);">Awaiting confirmation</span></div>
                                <div class="booking-detail-item" style="grid-column:1/-1;"><span class="booking-detail-label">Address</span><span class="booking-detail-value" style="font-size:0.95rem;">${escapeHtml(addr || 'Address available on confirmation.')}</span></div>
                            </div>
                            ${guestPriceBoxHtml(p, {
                                dep: p.damagesDeposit || 0,
                                total: displayGrandTotal(p.total, p, 'none'),
                                note: `<p style="color:var(--text-muted);font-size:0.75rem;text-align:center;margin:8px 0 0;">Estimate — we'll confirm your dates and final price by email.</p>`,
                            })}
                            </div>
                            <div class="card-actions">
                                <button class="btn-sm btn-edit" data-act="openTermsProp" data-prop="${propKey}"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 4h9a3 3 0 0 1 3 3v13H9a3 3 0 0 1-3-3z"/><path d="M6 17h12"/></svg> Terms</button>
                                ${faqBlockHtml(propKey)}
                            </div>
                        </div>
                    </div>
                </div>`;
            },
        )
        .join('');

    const upcomingCards = [],
        pastCards = [],
        hubCards = [];
    let preArrivalShown = false; // only the soonest future stay gets the countdown hub
    mine.forEach(({ propKey, booking: b, address, payToken }) => {
        const meta = propertyMeta[propKey];
        const r = propertyRates[propKey] || defaultRates[propKey];
        const addr = address || (r && r.address) || '';
        const img = (propertyContent[propKey] && propertyContent[propKey].images[0]) || '';
        const p =
            b.agreedPrice ||
            priceBreakdown(propKey, b.adults || 0, b.children || 0, b.checkIn, b.checkOut);
        const ps = paymentSummary(propKey, b);
        // Deposit folded into the shown total/paid/balance until it's refunded.
        const gt = displayGrand(p, ps, b.holdStatus);
        // Derive the label from the reconciled summary so it can never
        // contradict the balance shown below or on the PDF.
        const payState = ps.fullyPaid ? 'paid' : ps.deposit > 0 ? 'deposit' : 'unpaid';
        const pay = paymentMeta[payState];
        // "Departed" is time-aware: once the checkout date AND time have passed
        // (hasCheckedOut), the stay is over and drops to Past stays the same day —
        // not at the next midnight. The arrival edge stays date-based so the stay
        // shows all of arrival day (the guest may not have keyed in the exact
        // check-in time). currentStay = arrived-by-date AND not yet departed.
        const upcoming = !hasCheckedOut(b);
        const currentStay = b.checkIn <= todayStr && !hasCheckedOut(b);
        if (currentStay) currentStays.push({ propKey, bookingId: b.id });
        const statusTag = upcoming
            ? `<span class="guest-status-badge" style="background:rgba(76,175,80,0.25);color:#fff;border:1px solid var(--booked-border);">Upcoming</span>`
            : `<span class="guest-status-badge" style="background:rgba(255,255,255,0.06);color:var(--text-muted);">Past stay</span>`;
        // One review/photo block per PROPERTY — decide on THIS card, not via
        // reviewShown.has() inside the template (has() is true for every later
        // past card of the same cottage, which duplicated the form + its ids).
        const showReview = !upcoming && !reviewShown.has(propKey);
        if (showReview) reviewShown.add(propKey);
        const showPhoto = !upcoming && !photoShown.has(propKey);
        if (showPhoto) photoShown.add(propKey);
        const __card = `
                <div class="glass-panel guest-booking">
                    <div class="guest-booking-head">
                        <div class="guest-booking-img" style="background-image:url('${img}');"></div>
                        <div class="guest-booking-body">
                            <h3><span class="legend-swatch swatch-${propKey}"></span> ${escapeHtml(meta.name)} ${statusTag}</h3>
                            <div class="guest-ref">Booking ref ${bookingRef(b.id)}</div>
                            <div class="guest-booking-cols">
                            <div class="guest-detail-grid">
                                <div class="booking-detail-item"><span class="booking-detail-label">Check In</span><span class="booking-detail-value" style="font-size:1rem;">${fmtDate(b.checkIn)} · ${b.checkInTime || '15:00'}</span></div>
                                <div class="booking-detail-item"><span class="booking-detail-label">Check Out</span><span class="booking-detail-value" style="font-size:1rem;">${fmtDate(b.checkOut)} · ${b.checkOutTime || '10:00'}</span></div>
                                <div class="booking-detail-item"><span class="booking-detail-label">Party</span><span class="booking-detail-value" style="font-size:1rem;">${escapeHtml(b.guests || '')}</span></div>
                                <div class="booking-detail-item"><span class="booking-detail-label">Payment</span><span class="booking-detail-value" style="font-size:1rem;color:${pay.color};">${pay.label}</span></div>
                                <div class="booking-detail-item" style="grid-column:1/-1;"><span class="booking-detail-label">Address</span><span class="booking-detail-value" style="font-size:0.95rem;">${escapeHtml(addr || 'Address available on confirmation.')}</span></div>
                            </div>
                            ${guestPriceBoxHtml(p, {
                                dep: gt.dep,
                                total: gt.total,
                                extraRows:
                                    gt.paid > 0
                                        ? `
                                <div class="price-row" style="color:var(--ok);"><span>Paid${b.paymentMethod ? ' (' + escapeHtml(b.paymentMethod) + ')' : ''}${b.paymentDate ? ' on ' + fmtDate(b.paymentDate) : ''}</span><span>− ${gbp(gt.paid)}</span></div>
                                <div class="price-row total"><span>${gt.fullyPaid ? 'Paid in full' : 'Balance due'}</span><span class="price-amount" style="${gt.fullyPaid ? 'color:var(--ok);' : ''}">${gbp(gt.fullyPaid ? gt.total : gt.balance)}</span></div>`
                                        : '',
                            })}
                            </div>
                            ${upcoming ? guestFlowHtml(propKey, b, payToken) : ''}
                            <div class="card-actions">
                                ${upcoming && !gt.fullyPaid && payToken ? `<button class="btn-glass btn-sm" style="background:rgba(76,175,80,0.22);border-color:var(--booked-border);" ${chbAttrs('openPayView', String(payToken), b.dbId, 'balance')}><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="5" width="20" height="14" rx="2.5"/><path d="M2 10h20"/></svg> Pay balance ${gbp(gt.balance)}</button>` : ''}
                                <button class="btn-sm btn-edit" ${chbAttrs('downloadInvoice', String(b.id))}><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v10M8 11l4 4 4-4M5 19h14"/></svg> Invoice</button>
                                <button class="btn-sm btn-edit" ${chbAttrs('addBookingToCalendar', String(b.id))}><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4.5" width="18" height="16" rx="2.5"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/></svg> Add to Calendar</button>
                                <button class="btn-sm btn-edit" data-act="openTermsProp" data-prop="${propKey}"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 4h9a3 3 0 0 1 3 3v13H9a3 3 0 0 1-3-3z"/><path d="M6 17h12"/></svg> Terms</button>
                                ${upcoming ? faqBlockHtml(propKey) : ''}
                                ${upcoming ? guestWelcomeButton(propKey) : ''}
                                ${!upcoming ? `<button class="btn-sm btn-edit" ${chbAttrs('rebookCottage', String(propKey))}><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 1 3 6.7"/><path d="M3 21v-5h5"/></svg> Book again</button>` : ''}
                                ${showReview ? guestReviewButton(propKey) : ''}
                                ${showPhoto ? guestPhotoButton(propKey) : ''}
                            </div>
                            ${showReview ? guestReviewForm(propKey) : ''}
                        </div>
                    </div>
                </div>`;
        (upcoming ? upcomingCards : pastCards).push(__card);

        // While a stay is in progress, gather its in-stay actions into one
        // prominent "My Stay" hub (rendered at the top of the list). The
        // .instay-tides element keeps its class so renderInStayTides() fills it.
        // All tiles reuse existing functions.
        // The "My Stay" hub (directions, welcome book…) is the in-trip
        // experience — shown for ANY current stay. A guest who still owes a
        // balance is already at the cottage; withholding directions and the
        // welcome book helps nobody (the Pay button still shows on the
        // booking card below).
        if (currentStay) {
            const nightsLeft = Math.max(0, nightsBetween(todayStr, b.checkOut));
            hubCards.push(`
                    <div class="glass-panel my-stay-hub">
                        <div class="hub-head">
                            <span class="legend-swatch swatch-${propKey}"></span>
                            <div>
                                <div class="hub-title">You're staying at <strong>${escapeHtml(meta.name)}</strong></div>
                                <div class="hub-sub">Until ${fmtDate(b.checkOut)} · ${b.checkOutTime || '10:00'} · ${nightsLeft} night${nightsLeft === 1 ? '' : 's'} left</div>
                            </div>
                        </div>
                        <div class="instay-tides" style="margin-top:12px;"></div>
                        <div class="hub-grid">
                            <button class="hub-tile" ${chbAttrs('openCottageDirections', String(propKey))}><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-6.5-5.5-6.5-10a6.5 6.5 0 0 1 13 0c0 4.5-6.5 10-6.5 10z"/><circle cx="12" cy="11" r="2.2"/></svg><span>Directions</span></button>
                            <button class="hub-tile" ${chbAttrs('openWelcomeBook', String(propKey))}><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5a2 2 0 0 1 2-2h6v18H6a2 2 0 0 1-2-2z"/><path d="M20 5a2 2 0 0 0-2-2h-6v18h6a2 2 0 0 0 2-2z"/></svg><span>Welcome book</span></button>
                            <button class="hub-tile" ${chbAttrs('openFaqModal', String(propKey))}><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 0 1 4.5 1.5c0 1.7-2 2-2 3.2"/><path d="M12 17h.01"/></svg><span>Good to know</span></button>
                            <button class="hub-tile" data-act="toggleChat"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5h16v11H8l-4 4z"/></svg><span>Contact host</span></button>
                            <button class="hub-tile" data-act="openTermsProp" data-prop="${propKey}"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 4h9a3 3 0 0 1 3 3v13H9a3 3 0 0 1-3-3z"/><path d="M6 17h12"/></svg><span>Terms</span></button>
                        </div>
                    </div>`);
        } else if (upcoming && !preArrivalShown && b.checkIn > todayStr) {
            // Soonest FUTURE stay (not in residence): the anticipation + planning
            // countdown hub. `mine` is sorted soonest-upcoming-first, so the first
            // future booking we reach is the next one.
            preArrivalShown = true;
            hubCards.push(guestPreArrivalHubHtml(propKey, b, meta, payToken, gt));
        }
    });
    const gHdr = (t) =>
        `<h3 style="font-family:var(--font-serif);font-size:1.2rem;font-weight:600;margin:18px 2px 10px;color:var(--text-light);">${t}</h3>`;
    // Each section's cards sit in their own .gb-grid so the desktop two-up
    // layout works per section (an odd last card spans the full row).
    const gGrid = (cards) => `<div class="gb-grid">${cards.join('')}</div>`;
    // No stays at all: a clear next step instead of an empty page.
    const emptyState =
        !hubCards.length && !pendingHtml && !upcomingCards.length && !pastCards.length
            ? `<div class="glass-panel" style="text-align:center;padding:34px 22px;">
                    <p style="margin:0 0 16px;color:var(--text-muted);">No stays yet — your bookings and enquiries will appear here.</p>
                    <button class="btn-glass" data-act="nav" data-view="view-cottages">Browse the cottages</button>
               </div>`
            : '';
    list.innerHTML =
        (hubCards.length ? gHdr('Your stay') + hubCards.join('') : '') +
        pendingHtml +
        (upcomingCards.length ? gHdr('Upcoming stays') + gGrid(upcomingCards) : '') +
        (pastCards.length ? gHdr('Past stays') + gGrid(pastCards) : '') +
        emptyState;

    // Fill any in-stay tide cards (mid-stay guests).
    if (currentStays.length) renderInStayTides();
}

// ---- Pre-arrival "Your stay" hub: an anticipation + planning card for the
// SOONEST upcoming booking (before check-in). Mirrors the in-stay hub, but leads
// with a countdown, flags the one thing left to sort (balance / guest details),
// and offers the same planning tiles. All tiles reuse existing functions — no
// new endpoints. Shown once, above the booking cards, under "Your stay". ----
function guestPreArrivalHubHtml(propKey, b, meta, payToken, gt) {
    const days = nightsBetween(todayDashed(), b.checkIn);
    const big = days <= 0 ? '!' : String(days);
    const unit = days === 1 ? 'day to go' : 'days to go';
    const head = days === 1 ? 'Tomorrow' : `${days} days`;
    // The one outstanding thing before arrival (balance beats details), else all set.
    let ready, cta = '';
    if (gt && !gt.fullyPaid && gt.balance > 0) {
        ready = `<span class="hub-warn">balance ${gbp(gt.balance)} due</span>`;
        if (payToken) cta = `<button class="btn-glass btn-sm hub-cta-btn" ${chbAttrs('openPayView', String(payToken), b.dbId, 'balance')}><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="5" width="20" height="14" rx="2.5"/><path d="M2 10h20"/></svg> Pay balance ${gbp(gt.balance)}</button>`;
    } else if (b.regUrl && !b.regSubmitted) {
        ready = `<span class="hub-warn">add your guest details</span>`;
        cta = `<a class="btn-glass btn-sm hub-cta-btn" href="${escapeHtml(b.regUrl)}"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6M22 11h-6"/></svg> Add your details</a>`;
    } else {
        ready = `<span class="hub-ok">you're all set</span>`;
    }
    return `
        <div class="glass-panel my-stay-hub my-stay-hub-soon">
            <div class="hub-head">
                <span class="legend-swatch swatch-${propKey}"></span>
                <div class="hub-head-text">
                    <div class="hub-title"><strong>${escapeHtml(meta.name)}</strong> — ${head}</div>
                    <div class="hub-sub">Check in ${fmtDate(b.checkIn)} · from ${b.checkInTime || '15:00'} · ${ready}</div>
                </div>
                <div class="hub-count" aria-hidden="true"><span class="hub-count-n">${big}</span><span class="hub-count-u">${unit}</span></div>
            </div>
            ${cta ? `<div class="hub-cta">${cta}</div>` : ''}
            <div class="hub-grid">
                <button class="hub-tile" ${chbAttrs('openCottageDirections', String(propKey))}><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-6.5-5.5-6.5-10a6.5 6.5 0 0 1 13 0c0 4.5-6.5 10-6.5 10z"/><circle cx="12" cy="11" r="2.2"/></svg><span>Directions</span></button>
                <button class="hub-tile" ${chbAttrs('openFaqModal', String(propKey))}><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 0 1 4.5 1.5c0 1.7-2 2-2 3.2"/><path d="M12 17h.01"/></svg><span>Good to know</span></button>
                <button class="hub-tile" ${chbAttrs('openWelcomeBook', String(propKey))}><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5a2 2 0 0 1 2-2h6v18H6a2 2 0 0 1-2-2z"/><path d="M20 5a2 2 0 0 0-2-2h-6v18h6a2 2 0 0 0 2-2z"/></svg><span>Welcome book</span></button>
                <button class="hub-tile" data-act="nav" data-view="view-experiences"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l2.5 5.5L20 9l-4 4 1 6-5-3-5 3 1-6-4-4 5.5-.5z"/></svg><span>Things to do</span></button>
                <button class="hub-tile" data-act="toggleChat"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5h16v11H8l-4 4z"/></svg><span>Contact host</span></button>
            </div>
        </div>`;
}

// ---- In-stay "tide of the day" card (My Bookings + My Stay hub) ----
async function renderInStayTides() {
    const els = document.querySelectorAll('.instay-tides');
    if (!els.length) return;
    let data;
    try {
        data = await loadTideData(); // shared cache with the Experiences panel
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
        css.integrity = 'sha384-c6Rcwz4e4CITMbu/NBmnNS8yN2sC3cUElMEMfP3vqqKFp7GOYaaBBCqmaWBjmkjb';
        css.crossOrigin = 'anonymous';
        document.head.appendChild(css);
        const js = document.createElement('script');
        js.src = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js';
        js.integrity = 'sha384-NElt3Op+9NBMCYaef5HxeJmU4Xeard/Lku8ek6hoPTvYkQPh3zLIrJP7KiRocsxO';
        js.crossOrigin = 'anonymous';
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
const payState = { token: '', bookingId: 0, kind: 'deposit', amountDue: 0, guestName: '' };
let squarePayments = null,
    squareCard = null;
// Strong Customer Authentication (UK/EU banks): passing these details to
// card.tokenize() lets Square run the 3-D Secure check against the REAL amount
// and buyer, so the bank can approve the charge. Without them UK issuers
// decline with CARD_DECLINED_VERIFICATION_REQUIRED (seen live). Wallets
// (Apple/Google Pay) do SCA inside the wallet sheet and don't take these.
function payVerificationDetails() {
    const parts = String(payState.guestName || '')
        .trim()
        .split(/\s+/)
        .filter(Boolean);
    const contact = { countryCode: 'GB' };
    if (parts.length) contact.givenName = parts[0];
    if (parts.length > 1) contact.familyName = parts.slice(1).join(' ');
    return {
        amount: Number(payState.amountDue || 0).toFixed(2),
        currencyCode: 'GBP',
        intent: 'CHARGE',
        customerInitiated: true,
        sellerKeyedIn: false,
        billingContact: contact,
    };
}
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
    // 'hold' MUST survive: a legacy ?hold= link promises an authorise-only
    // refundable hold — coercing it to 'deposit' would CHARGE the guest.
    payState.kind = kind === 'balance' || kind === 'hold' ? kind : 'deposit';
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
        // The refundable damage deposit is charged WITH this payment and refunded
        // after checkout — so the guest pays (and the wallet sheet shows) rental +
        // deposit. The server computes the same total independently. On the LEGACY
        // ?hold= screen the amount IS the deposit — don't add it twice.
        const dep = s.kind === 'hold' ? 0 : Math.round(Number(s.damagesDue || 0) * 100) / 100;
        const payTotal = Math.round((Number(s.amountDue) + dep) * 100) / 100;
        payState.amountDue = payTotal;
        payState.guestName = s.guestName || '';
        const propEl = document.getElementById('pay-prop');
        if (propEl) propEl.textContent = `${s.propName} · ${fmtDate(s.checkIn)} → ${fmtDate(s.checkOut)}`;
        document.getElementById('pay-kind-label').textContent =
            s.kind === 'hold'
                ? 'Refundable security hold'
                : s.kind === 'balance'
                  ? 'Balance due'
                  : 'Deposit due';
        document.getElementById('pay-amount').textContent = gbp(payTotal);
        const grandTotalRef = Math.round((Number(s.total) + dep) * 100) / 100;
        document.getElementById('pay-amount-sub').textContent =
            s.kind === 'hold'
                ? 'held, not charged — released after checkout'
                : (s.kind === 'balance'
                      ? `of ${gbp(grandTotalRef)} total`
                      : `${s.depositPct}% deposit · ${gbp(grandTotalRef)} total`) +
                  (dep > 0 ? ` · incl. ${gbp(dep)} refundable deposit (refunded after your stay)` : '');
        try {
            const pb = document.getElementById('pay-btn');
            if (pb) pb.textContent = s.kind === 'hold' ? 'Place hold' : 'Pay now';
        } catch (e) {}
        if (!(payTotal > 0)) {
            showPayError("This booking is already settled — there's nothing left to pay.");
            return;
        }
        await loadSquareSdk(cfg.environment);
        squarePayments = window.Square.payments(cfg.applicationId, cfg.locationId);
        squareCard = await squarePayments.card();
        await squareCard.attach('#sq-card');
        try {
            await mountWallets(payTotal);
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
    // Show what the card was CHARGED (incl. the bundled refundable deposit) —
    // quoting only the rental portion after a "Pay £450" button read like a
    // mis-charge to the guest.
    document.getElementById('pay-done-sub').textContent = res.fullyPaid
        ? 'Your booking is now paid in full. We look forward to welcoming you.'
        : `Thank you — ${gbp(res.charged != null ? res.charged : res.paid)} received. We'll be in touch about the remaining balance before your stay.`;
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
        // SCA: tokenize WITH verification details so the bank's 3-D Secure
        // check runs here (Square shows the challenge if the issuer asks).
        const result = await squareCard.tokenize(payVerificationDetails());
        if (result.status !== 'OK') {
            const m =
                (result.errors && result.errors[0] && result.errors[0].message) ||
                'Please check your card details and try again.';
            throw new Error(m);
        }
        await payWithToken(result.token);
    } catch (e) {
        const raw = String((e && e.message) || '');
        setPayMsg(
            /verification|3.?d.?s|timed out/i.test(raw)
                ? "Your bank's verification step didn't complete. Please try again — if your bank shows an approval prompt (app or SMS), confirm it and retry."
                : raw || 'Payment failed. Please try again.',
        );
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
// Returning-guest welcome offer — shown once a guest has at least one
// completed stay. Informational: the owner applies the rate on enquiry
// (mirrors how pricing/overrides already work), so nothing is auto-discounted.
function renderNotifyEmails(primary, extras) {
    const box = document.getElementById('notify-emails-list');
    if (!box) return;
    const primaryRow = primary
        ? `<div class="notify-row"><span class="notify-addr">${escapeHtml(primary)}</span><span class="notify-primary-tag">Primary</span></div>`
        : `<div class="notify-row"><span class="notify-addr" style="color:var(--warn-text);">No primary owner email set in config.php</span></div>`;
    const extraRows = (extras || [])
        .map(
            (e) =>
                `<div class="notify-row"><span class="notify-addr">${escapeHtml(e)}</span><button class="notify-remove" ${chbAttrs('removeNotifyEmail', e)} aria-label="Remove ${escapeHtml(e)}" title="Remove">&times;</button></div>`,
        )
        .join('');
    box.innerHTML = primaryRow + extraRows;
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
        return `<button class="btn-sm btn-edit" ${chbAttrs('toggleGuestReview', String(propKey))}><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.5l2.6 5.27 5.82.85-4.21 4.1.99 5.78L12 16.9l-5.2 2.6.99-5.78-4.21-4.1 5.82-.85z" fill="currentColor" stroke="none"/></svg> Review your stay</button>`;
    if (existing.status === 'approved')
        return `<button class="btn-sm btn-edit" ${chbAttrs('toggleGuestReview', String(propKey))}><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.5l2.6 5.27 5.82.85-4.21 4.1.99 5.78L12 16.9l-5.2 2.6.99-5.78-4.21-4.1 5.82-.85z" fill="currentColor" stroke="none"/></svg> Edit your review</button>`;
    if (existing.status === 'pending')
        return `<button class="btn-sm btn-edit" ${chbAttrs('toggleGuestReview', String(propKey))}><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.5l2.6 5.27 5.82.85-4.21 4.1.99 5.78L12 16.9l-5.2 2.6.99-5.78-4.21-4.1 5.82-.85z" fill="currentColor" stroke="none"/></svg> Review submitted</button>`;
    return `<button class="btn-sm btn-edit" ${chbAttrs('toggleGuestReview', String(propKey))}><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.5l2.6 5.27 5.82.85-4.21 4.1.99 5.78L12 16.9l-5.2 2.6.99-5.78-4.21-4.1 5.82-.85z" fill="currentColor" stroke="none"/></svg> Edit your review</button>`;
}
function guestPhotoButton(propKey) {
    return `<button class="btn-sm btn-edit" ${chbAttrs('openPhotoUpload', String(propKey))}><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="6" width="18" height="14" rx="2"/><circle cx="12" cy="13" r="3.5"/><path d="M8 6l1.5-2h5L16 6"/></svg> Share a photo</button>`;
}
// ---- In-stay welcome book (guest, booking-gated) ----
function guestWelcomeButton(propKey) {
    return `<button class="btn-sm btn-edit" ${chbAttrs('openWelcomeBook', String(propKey))}><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H19v15H6.5A2.5 2.5 0 0 0 4 20.5z"/><path d="M4 5.5V20.5"/></svg> Welcome book</button>`;
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
    // Photo upload posts via a raw fetch (multipart), bypassing apiPost's preview
    // guard — block it here so a read-only account preview can't upload.
    if (ACCT_PREVIEW) { try { if (typeof toast === 'function') toast("Read-only preview — nothing here is saved."); } catch (e) {} return; }
    const fileEl = document.getElementById('pu-file');
    const capEl = document.getElementById('pu-caption');
    const msg = document.getElementById('pu-msg');
    const show = (t, ok) => {
        if (msg) {
            msg.style.color = ok ? 'var(--ok)' : 'var(--danger)';
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
        note = `<div style="font-size:0.82rem;color:var(--ok);margin-bottom:10px;"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.5l2.6 5.27 5.82.85-4.21 4.1.99 5.78L12 16.9l-5.2 2.6.99-5.78-4.21-4.1 5.82-.85z" fill="currentColor" stroke="none"/></svg> Your review of ${escapeHtml(meta.name)} is live on our home page — thank you!</div>`;
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
                        <button class="btn-glass" style="padding:10px 22px;" ${chbAttrs('submitGuestReview', String(propKey))}>Submit review</button>
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
// (set in Manage → Cancellation policy), so the Terms always match what the
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
    overlayHistPush(); // Back closes this overlay
    document.getElementById('terms-modal').classList.add('open');
}
function closeTermsModal() {
    const m = document.getElementById('terms-modal');
    if (!m || !m.classList.contains('open')) return;
    overlayHistConsume(); // eat the overlay's history entry (no-op if Back closed it)
    m.classList.remove('open');
}

// The one-line status shown under the refundable-deposit figure on the invoice.
// Pure (given amount/state) so it's unit-tested. States mirror the hold_* model:
// 'charged' = paid with the booking; 'returned'/full = refunded; 'kept' = retained
// for damage; legacy card-hold statuses keep the "held on your card" wording.
function depositInvoiceStatus(depAmt, holdStatus, returnedAmt, settledDate) {
    if (!(depAmt > 0)) return '';
    const returned = Math.round((Number(returnedAmt) || 0) * 100) / 100;
    const when = settledDate ? ' on ' + settledDate : '';
    const st = holdStatus || 'none';
    if (st === 'returned' || (st === 'charged' && returned >= depAmt - 0.01)) {
        return 'Refunded in full' + when + '.';
    }
    if (st === 'kept') return 'Retained after checkout for damage or loss.';
    if (st === 'charged') {
        return returned > 0.01
            ? `${gbp(returned)} of ${gbp(depAmt)} refunded${when}. Balance refundable after your stay.`
            : 'Paid — refunded in full after your stay, provided there is no damage.';
    }
    if (['authorized', 'captured', 'released', 'expired'].includes(st)) {
        return st === 'released' || st === 'expired'
            ? 'The hold on your card has been released.'
            : 'Held on your card (not charged) — released after checkout.';
    }
    return 'Charged with your first payment and refunded after your stay.';
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
    await previewAndSendEmail({
        id: b.dbId,
        kind: 'email.arrival',
        to: b.email,
        sendLabel: 'Send arrival info',
        fallbackConfirm: `Send the arrival info email to ${b.email}?\n\nTip: the arrival details are set per cottage in Manage → Preferences.`,
        doSend: async () => {
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
        },
    });
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
    await previewAndSendEmail({
        id: b.dbId,
        kind: 'email.confirmation',
        to: b.email,
        sendLabel: 'Send confirmation',
        fallbackConfirm: `Send a confirmation email to ${b.email}?`,
        doSend: async () => {
            try {
                const res = await apiPost('bookings.php', { action: 'send_confirmation', id: b.dbId });
                if (res && res.error) glassAlert(res.error);
                else toast(`Confirmation email sent to ${b.email}.`);
            } catch (e) {
                glassAlert("Couldn't send the email: " + e.message);
            }
        },
    });
}

async function downloadInvoice(bookingId) {
    try {
        await ensureJsPdf();
    } catch (e) {
        glassAlert("The invoice tool couldn't load — please check your connection and try again.");
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
    // Deposit folded into the shown total/paid until it's refunded.
    const gt = displayGrand(p, ps, b.holdStatus || 'none');

    // Refundable damages deposit — amount + human status for its own invoice
    // section. It's now CHARGED with the guest's first payment and refunded
    // after checkout, so the invoice must show it paid and, later, refunded.
    const depAmt = Math.max(0, Math.round((p.damagesDeposit || 0) * 100) / 100);
    const depStatus = depositInvoiceStatus(
        depAmt,
        b.holdStatus || 'none',
        Number(b.damagesReturned) || 0,
        b.holdSettledAt ? String(b.holdSettledAt).split(' ')[0] : '',
    );

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    const W = doc.internal.pageSize.getWidth();
    const H = doc.internal.pageSize.getHeight();
    // The site's coastal palette, so the PDF reads as the same brand: linen
    // page, white sheet, the cottage's accent as the top band, ink text.
    const hexRgb = (h) => {
        const m = /^#?([0-9a-f]{6})$/i.exec(String(h || ''));
        const n = parseInt(m ? m[1] : 'c79a64', 16);
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    };
    const INK = [27, 42, 52];
    const MUTED = [82, 100, 110];
    const HAIR = [230, 221, 202];
    const OK = [76, 175, 80];
    const ACCENT = hexRgb((meta && meta.accent) || '#C79A64');
    // Linen page + white sheet + accent band
    doc.setFillColor(245, 241, 233);
    doc.rect(0, 0, W, H, 'F');
    doc.setFillColor(255, 255, 255);
    doc.roundedRect(28, 28, W - 56, H - 56, 10, 10, 'F');
    doc.setFillColor(ACCENT[0], ACCENT[1], ACCENT[2]);
    doc.rect(28, 28, W - 56, 5, 'F');
    const left = 64,
        right = W - 64;
    let y = 84;
    const line = (yy) => {
        doc.setDrawColor(HAIR[0], HAIR[1], HAIR[2]);
        doc.line(left, yy, right, yy);
    };
    const rowLR = (l, rr, yy, bold) => {
        doc.setFont('helvetica', bold ? 'bold' : 'normal');
        doc.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
        if (bold) doc.setTextColor(INK[0], INK[1], INK[2]);
        doc.text(String(l), left, yy);
        doc.setTextColor(INK[0], INK[1], INK[2]);
        doc.text(String(rr), right, yy, { align: 'right' });
    };
    // Section titles echo the site's serif headings.
    const sectionTitle = (t, yy) => {
        doc.setFont('times', 'bold');
        doc.setFontSize(14);
        doc.setTextColor(INK[0], INK[1], INK[2]);
        doc.text(t, left, yy);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(10);
    };

    // Letterhead: the crown mark centred over the serif brand — the same
    // anatomy as the site's sign-in brand panel.
    const cx = W / 2;
    try {
        doc.addImage(CHB_CROWN_PNG, 'PNG', cx - 27, y - 22, 54, 32);
    } catch (e) {}
    y += 28;
    doc.setFont('times', 'bold');
    doc.setFontSize(22);
    doc.setTextColor(INK[0], INK[1], INK[2]);
    doc.text('Cottage Holidays Blakeney', cx, y, { align: 'center' });
    y += 15;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
    doc.text('North Norfolk Coastal Retreats', cx, y, { align: 'center' });
    y += 15;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(ACCENT[0], ACCENT[1], ACCENT[2]);
    doc.text('I N V O I C E', cx, y, { align: 'center' });
    doc.setTextColor(INK[0], INK[1], INK[2]);
    y += 20;
    line(y);
    y += 28;

    // Invoice meta
    doc.setFontSize(10);
    rowLR('Invoice reference', bookingRef(b.id), y);
    y += 18;
    rowLR('Issued', fmtDate(todayDashed()), y);
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
    sectionTitle('Your stay', y);
    y += 20;
    rowLR('Property', meta.name, y);
    y += 18;
    // Address can wrap
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
    doc.text('Address', left, y);
    doc.setTextColor(INK[0], INK[1], INK[2]);
    const addrLines = doc.splitTextToSize(address || 'Address provided on confirmation.', 300);
    doc.text(addrLines, right, y, { align: 'right' });
    y += addrLines.length * 14 + 6;
    rowLR('Check in', `${fmtDate(b.checkIn)}  ·  ${b.checkInTime || '15:00'}`, y);
    y += 18;
    rowLR('Check out', `${fmtDate(b.checkOut)}  ·  ${b.checkOutTime || '10:00'}`, y);
    y += 18;
    rowLR('Nights', String(p.nights), y);
    y += 18;
    rowLR('Guests', b.guests || `${b.adults || 0} adults`, y);
    y += 18;
    y += 10;
    line(y);
    y += 28;

    // Charges
    sectionTitle('Charges', y);
    y += 20;
    rowLR(`${gbp(p.perNight)} x ${p.nights} night${p.nights === 1 ? '' : 's'}`, gbp(p.nightly), y);
    y += 18;
    rowLR(`Transaction fee (${p.transactionPct}%)`, gbp(p.txFee), y);
    y += 18;
    if (gt.dep > 0) {
        rowLR('Refundable damages deposit', gbp(gt.dep), y);
        y += 18;
    }
    y += 4;
    line(y);
    y += 20;
    rowLR(gt.dep > 0 ? 'Total (incl. deposit)' : 'Total', gbp(gt.total), y, true);
    y += 28;

    // Refundable damages deposit — its OWN section (never part of the rental
    // total, since it's never rental income), showing the amount and its live
    // status: paid with the booking and, after checkout, refunded.
    if (depAmt > 0) {
        sectionTitle('Refundable damages deposit', y);
        doc.text(gbp(depAmt), right, y, { align: 'right' });
        y += 18;
        doc.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
        const stLines = doc.splitTextToSize(depStatus, right - left);
        doc.text(stLines, left, y);
        doc.setTextColor(INK[0], INK[1], INK[2]);
        y += stLines.length * 13 + 8;
        line(y);
        y += 24;
    }

    // Payments
    sectionTitle('Payments', y);
    y += 20;
    if (gt.paid > 0) {
        const how = b.paymentMethod ? ` via ${b.paymentMethod}` : '';
        const when = b.paymentDate ? ` on ${fmtDate(b.paymentDate)}` : '';
        rowLR(`Amount paid${how}${when}`, '- ' + gbp(gt.paid), y);
        y += 18;
        if (gt.fullyPaid) doc.setTextColor(OK[0], OK[1], OK[2]);
        doc.setFont('helvetica', 'bold');
        doc.text(gt.fullyPaid ? 'Paid in full' : 'Balance due', left, y);
        doc.text(gbp(gt.fullyPaid ? gt.total : gt.balance), right, y, { align: 'right' });
        doc.setTextColor(INK[0], INK[1], INK[2]);
        y += 18;
    } else {
        rowLR('Amount paid', gbp(0), y);
        y += 18;
        rowLR('Balance due', gbp(gt.balance), y, true);
        y += 18;
    }

    // Footer
    y += 30;
    line(y);
    y += 20;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
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
                out.style.color = 'var(--warn-text)';
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

// ---- Styled admin login modal ----
let adminLoginOnSuccess = null;
function closeAdminLogin() {
    document.getElementById('admin-login-modal').classList.remove('open');
    const st = document.getElementById('admin-login-passkey-status');
    if (st) st.style.display = 'none';
    // Reset the 2FA step so the next open starts at the password form again.
    const tf = document.getElementById('admin-login-2fa-form');
    if (tf) tf.style.display = 'none';
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
        const res = await apiPost('auth.php', { action: 'admin_login', username, password });
        // New device with 2FA on: password was right, but a code was emailed —
        // switch the modal to the code-entry step instead of completing the login.
        if (res && res.twofa) {
            showAdmin2faStep();
            return;
        }
        await adminLoginSucceeded();
    } catch (e) {
        adminLoginErr('Access denied: ' + e.message);
    }
}
// Shared post-sign-in steps (used by the direct path and after a 2FA code).
async function adminLoginSucceeded() {
    isAuthenticated = true;
    setAuthUI();
    currentGuest = null;
    setGuestUI(); // one role at a time: drop any guest session
    try {
        oqRegisterSync();
        oqFlush();
    } catch (e) {}
    const cb = adminLoginOnSuccess;
    closeAdminLogin();
    if (cb) await cb();
}
function showAdmin2faStep() {
    const pw = document.getElementById('admin-login-pw-form');
    const ps = document.getElementById('admin-login-passkey-status');
    const tf = document.getElementById('admin-login-2fa-form');
    if (pw) pw.style.display = 'none';
    if (ps) ps.style.display = 'none';
    if (tf) tf.style.display = 'block';
    const code = document.getElementById('admin-login-2fa-code');
    if (code) {
        code.value = '';
        setTimeout(() => code.focus(), 60);
    }
}
async function submitAdmin2fa() {
    const code = (document.getElementById('admin-login-2fa-code').value || '').trim();
    const remember = !!(document.getElementById('admin-login-2fa-remember') || {}).checked;
    if (!code) {
        adminLoginErr('Enter the 6-digit code from your email.');
        return;
    }
    try {
        await apiPost('auth.php', { action: 'admin_2fa', code, remember });
        await adminLoginSucceeded();
    } catch (e) {
        adminLoginErr(e.message || 'That code was not accepted.');
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

// Cache of all content fetched from the backend.
let siteContent = {};

// Load shared content (text edits, image swaps, galleries) from the backend
// and apply it, so every visitor sees the owner's edits — not just the editor.
async function loadContent(pre) {
    try {
        // `pre` = this endpoint's payload already fetched via bootstrap.php.
        const res = pre || (await apiGet('content.php'));
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
        if (typeof v === 'string' && v) {
            const clean = v.replace(/['"\\)]/g, '');
            // Cottage cards are thumbnails — serve a right-sized WebP via img.php
            // (uploads/ only; other values pass through). The hero stays full-res:
            // it's the LCP image.
            const url = el.classList.contains('card-img') ? resizedUrl(clean, 800) : clean;
            el.style.backgroundImage = `url('${url}')`;
        }
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
// One combined fetch of the public first-paint data (rates + content + reviews
// + Square config). Returns null on any failure so callers fall back to the
// individual endpoints — never worse than the old four-call pattern. The
// response is ETagged server-side, so a poll of an unchanged site is a ~0-byte
// 304 the browser answers from its HTTP cache.
async function fetchBootstrap() {
    try {
        const b = await apiGet('bootstrap.php');
        return b && b.ok ? b : null;
    } catch (e) {
        return null;
    }
}
async function liveUpdateTick() {
    if (isAuthenticated) return; // admin logged in — leave their data alone
    if (document.hidden) return; // tab not visible — save bandwidth
    if (liveUpdateBusy) return; // don't overlap a slow tick
    liveUpdateBusy = true;
    try {
        // One round-trip instead of three; each loader still falls back to its
        // own endpoint if the combined payload is missing its part.
        const boot = await fetchBootstrap();
        await Promise.all([
            loadRates(boot && boot.rates).catch(() => {}),
            loadContent(boot && boot.content).catch(() => {}),
            loadPublicReviews(boot && boot.reviews).catch(() => {}),
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
            if (saved) el.style.backgroundImage = `url('${el.classList.contains('card-img') ? resizedUrl(saved, 800) : saved}')`;
        });
        // Load live data from the backend — ONE bootstrap round-trip covers all
        // four parts (rates/content/reviews/Square config). Each loader is still
        // wrapped so one failing never blocks the others or stops the page from
        // revealing, and each falls back to its own endpoint if the combined
        // payload is unavailable or missing its part.
        const boot = await fetchBootstrap();
        await Promise.all([
            loadRates(boot && boot.rates).catch((e) => console.error('loadRates', e)),
            loadContent(boot && boot.content).catch((e) => console.error('loadContent', e)),
            loadPublicReviews(boot && boot.reviews).catch((e) => console.error('loadPublicReviews', e)),
            loadSquareAdminConfig(boot && boot.square).catch((e) => console.error('loadSquareAdminConfig', e)),
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
        // Owner devices ('chb-owner' set on any past sign-in): warm the admin
        // bundle in the background during idle time, so tapping sign-in later
        // opens the back office instantly. Low priority (prefetch), only when
        // not already signed in (setAuthUI eager-loads it for real then).
        try {
            if (localStorage.getItem('chb-owner') === '1' && !isAuthenticated && !window.__ADMIN_LOADED) {
                const warmAdmin = () => {
                    const l = document.createElement('link');
                    l.rel = 'prefetch';
                    l.as = 'script';
                    l.href = 'admin.js?v=' + ADMIN_BUNDLE_V;
                    document.head.appendChild(l);
                };
                if ('requestIdleCallback' in window) requestIdleCallback(warmAdmin, { timeout: 5000 });
                else setTimeout(warmAdmin, 2500);
            }
        } catch (e) {}
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
            maybeAccountPreview();
        } catch (e) {
            console.error(e);
        } // ?acctpreview=<id> → admin-only read-only customer account preview
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
const TERMS_VERSION = '2026-07a';
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
            'Permitted pets: any animal the owner has agreed in writing you may bring.',
            'Group: you and everyone staying or visiting under your booking.',
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
            'No pets of any kind may stay at, or visit, the property unless the owner has given written permission in advance.',
            'If any pet is brought to the property without the owner’s prior written permission, we may ask you and your Group to leave without a refund.',
            'If, when preparing or cleaning the property after your stay, we find evidence that a pet has been present without our permission, you will be liable for the reasonable cost of any additional or specialist cleaning required to return the property to its usual standard.',
            'Where a pet has been agreed, you remain responsible for any damage or parasites it causes, and we cannot be held responsible for allergies arising from pets during a previous stay.',
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
// Manage → Preferences → cottage → Safety & property.
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

// ---- Dark-skies note (Experiences page) + accessibility + savings badge ----
const DEFAULT_DARKSKIES =
    "North Norfolk has some of England's darkest skies. On a clear night, step outside and look up — you can often see the Milky Way. Give your eyes 15 minutes to adjust and bring a blanket.";
const DEFAULT_ACCESS =
    "Please ask us before you book if you have specific access needs — we're happy to talk through the layout. Tell us about parking distance, steps or stairs, doorway widths, ground-floor sleeping and bathroom facilities so we can confirm the cottage is right for you.";
// ---- Tide widget (Blakeney) — fetched once from tides.php, cached in-memory.
// Hidden entirely unless an API key is configured (Manage → API keys). ----
let __tideData = null;
// ONE fetch for tide data (2 days covers both consumers) — the Experiences
// panel and the in-stay strip are just two formatters over the same cache.
async function loadTideData() {
    if (!__tideData) __tideData = await apiGet('tides.php?start=' + todayDashed() + '&days=2');
    return __tideData;
}
async function renderTides() {
    const card = document.getElementById('exp-tides-col');
    const body = document.getElementById('exp-tides-body');
    if (!card || !body) return;
    const hide = () => {
        card.style.display = 'none';
    };
    try {
        await loadTideData();
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
// Dark-skies note + live tide times now live on the Experiences page (moved off
// the cottage pages). The dark-skies blurb is site-wide (one shared note).
function renderExpArea() {
    const dkEl = document.getElementById('exp-darkskies');
    if (dkEl) dkEl.textContent = siteContent['darkskies'] || DEFAULT_DARKSKIES;
    try {
        renderTides();
    } catch (e) {}
}
function renderLocalGuide(propKey) {
    // Accessibility note + book-direct savings badge stay on the cottage page.
    const ac = siteContent['access-' + propKey] || DEFAULT_ACCESS;
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
                return `<div class="guest-photo" role="button" tabindex="0" aria-label="${label}" data-photo="${escapeHtml(data)}" data-act="openPhotoLightbox" data-pass="self" data-act-keydown="activate"><img loading="lazy" src="${escapeHtml(p.url)}" alt="${label}">${cap}</div>`;
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
    // house-rules list (managed in Manage → Preferences → cottage → House rules).
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
    paid: { label: 'Paid in Full', color: 'var(--ok)', dot: 'var(--ok)' },
    deposit: { label: 'Deposit Paid', color: 'var(--warn)', dot: 'var(--warn)' },
    unpaid: { label: 'Unpaid', color: 'var(--danger)', dot: 'var(--danger)' },
};

// ===================================================================
//  PRICING — per-property rates & fees (editable in the back office)
// ===================================================================
// coupleRate covers the first 2 adults, per night.
// extraAdultRate is per additional adult (beyond 2), per night.
// childRate is per child, per night.
// damagesDeposit is a refundable amount collected per booking (NOT income).
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
// The PUBLIC cottage set: live (non-archived) AND not private (unlisted). Every
// public surface — the #cottages grid, footer, JSON-LD, hero search, SEO text —
// goes through this, so an unlisted cottage never shows on the site even on the
// owner's own device. Admin surfaces (calendar, money, booking picker) use the
// full propertyMeta / propertyList instead, so private cottages stay operable.
function liveCottageKeys() {
    if (propertyList && propertyList.length) {
        return propertyList.filter((p) => !p.archived && !p.unlisted).map((p) => p.prop_key);
    }
    return Object.keys(propertyMeta).filter(
        (k) => !(propertyMeta[k] && (propertyMeta[k].archived || propertyMeta[k].unlisted)),
    );
}
// Cottages that can be BOOKED in the back office: live (non-archived), private
// or public alike. Used to populate the Add/Edit-booking cottage picker.
function bookableCottageKeys() {
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

async function loadRates(pre) {
    try {
        // `pre` = this endpoint's payload already fetched via bootstrap.php.
        const res = pre || (await apiGet('rates.php'));
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
            unlisted: !!p.unlisted, // private cottage — hidden from the public site
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
                lastminPct: parseFloat(p.lastmin_pct) || 0,
                lastminDays: parseInt(p.lastmin_days) || 0,
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
                unlisted: !!p.unlisted,
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
            renderFooterCottages();
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

// Last-minute discount multiplier: pct% off the nightly rental when check-in is
// within `days` days of `today` (both 0 = off). MUST mirror last_minute_factor()
// in pricing.php exactly (lockstep, guarded by the pricing tests).
function lastMinuteFactor(checkIn, today, pct, days) {
    pct = parseFloat(pct) || 0;
    days = parseInt(days) || 0;
    if (pct <= 0 || days <= 0) return 1;
    const lead = Math.floor(
        (new Date(checkIn + 'T00:00:00Z').getTime() - new Date(today + 'T00:00:00Z').getTime()) / 86400000,
    );
    if (lead < 0 || lead > days) return 1;
    return 1 - Math.min(90, pct) / 100; // never discount more than 90%
}
function priceBreakdown(propKey, adults, children, checkIn, checkOut, depositOverride, today) {
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
    // Last-minute discount on the nightly rental (never the held damages deposit).
    // Anchor "today" in UK time like the rest of the site — the UTC date lags UK
    // by a day between 23:00-00:00 UTC during BST, which made the JS quote and
    // pricing.php (Europe/London) disagree at the lead-time boundary.
    const lmToday = today || (typeof todayDashed === 'function' ? todayDashed() : new Date().toISOString().slice(0, 10));
    nightly = Math.round(nightly * lastMinuteFactor(checkIn, lmToday, r.lastminPct, r.lastminDays) * 100) / 100;
    const perNight =
        nights > 0 ? Math.round((nightly / nights) * 100) / 100 : r.coupleRate + extrasPerNight;
    // Refundable damages deposit: held, NOT income. Per-booking override allowed,
    // else the property's standard amount. Only applies to a real stay.
    const depBase =
        depositOverride != null && depositOverride !== ''
            ? parseFloat(depositOverride)
            : r.damagesDeposit;
    const damagesDeposit = nights > 0 ? Math.max(0, depBase) || 0 : 0;
    // Transaction fee applies to rental income only (not the refundable deposit).
    const txFee = Math.round(nightly * (r.transactionPct / 100) * 100) / 100;
    // The damages deposit is CHARGED together with the guest's first payment and
    // refunded after your stay, so it is NOT part of the rental total here.
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

// DISPLAY-ONLY: the refundable damage deposit is CHARGED with the guest's first
// payment and refunded after the stay, so what the guest actually pays includes
// it — until it's refunded. These helpers fold it into figures SHOWN to people;
// they never touch the price model (priceBreakdown.total / agreed_total / what
// pay.php charges all stay rental-only). `holdStatus` omitted = a fresh quote
// (not yet refunded → deposit counts).
function depositRefunded(holdStatus) {
    const st = holdStatus || 'none';
    return st === 'returned' || st === 'released';
}
// The deposit amount to fold into a shown total (0 once refunded).
function displayDepositAmt(p, holdStatus) {
    return depositRefunded(holdStatus) ? 0 : Math.max(0, (p && p.damagesDeposit) || 0);
}
// Has the refundable damages deposit actually been COLLECTED? It rides on a
// Square payment (pay.php sets hold_status 'charged'; legacy card-holds settle
// to 'captured'; 'kept' = collected and retained after damage). For a MANUAL
// payment (cash/bank) the owner records only the rental amount and hold_status
// stays 'none' — the deposit was NOT taken, so it must not count as "paid".
function depositCharged(holdStatus) {
    const st = holdStatus || 'none';
    return st === 'charged' || st === 'captured' || st === 'kept';
}
// A shown total = a rental figure + the not-yet-refunded deposit.
function displayGrandTotal(rentalTotal, p, holdStatus) {
    return Math.round((((rentalTotal != null ? rentalTotal : (p && p.total) || 0)) + displayDepositAmt(p, holdStatus)) * 100) / 100;
}
// For a booking WITH a paid/balance ledger: fold the deposit into the shown
// total, and into the PAID figure ONLY when it was genuinely collected (a Square
// payment charges it alongside the first rental payment → hold_status 'charged').
// A manually-recorded cash/bank payment leaves hold_status 'none', so the deposit
// is NOT counted as paid — otherwise a £100 cash deposit would show as £150 paid.
// `ps` = paymentSummary (rental total + rental paid). Refunded → deposit drops out.
function displayGrand(p, ps, holdStatus) {
    const dep = displayDepositAmt(p, holdStatus);
    const total = Math.round((ps.total + dep) * 100) / 100;
    const chargedDep = depositCharged(holdStatus) ? dep : 0; // only if actually collected
    const paid = Math.round((ps.deposit + chargedDep) * 100) / 100;
    const balance = Math.round((total - paid) * 100) / 100;
    return { dep, total, paid, balance, fullyPaid: ps.fullyPaid || balance <= 0.001 };
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

// ---- Unified booking flow ------------------------------------------------
// The ONE ordered progress model, shared by the admin booking hub and the
// guest's My Stays card, so both sides show the same journey. Each stage is
// { key, label (owner wording), glabel (guest wording), done, now }. Payments,
// guest-details collection and the stay itself are all first-class steps.
// Pure — everything is derived from the booking + the shared price/payment
// helpers, so it can't disagree with the money shown elsewhere.
// Order (owner-confirmed): Booked → Deposit → Guest details → Paid → Arrival →
// Staying → Deposit back. The details stage only appears when a registration
// form exists for the booking; the deposit-back stage only when a refundable
// damage deposit applies.
// Has the guest actually CHECKED IN? True only once the check-in date AND time
// have passed — on the arrival day, before the check-in time, they're still
// "arriving", not "staying" (so "Staying" never shows from midnight). Falls back
// to 15:00 when no check-in time is recorded.
function hasCheckedIn(b) {
    if (!b || !b.checkIn) return false;
    const today = typeof todayDashed === 'function' ? todayDashed() : '';
    if (b.checkIn < today) return true; // arrival day already gone
    if (b.checkIn > today) return false; // still to come
    // Arrival is TODAY — compare the UK wall clock (the cottage's clock, not
    // the visitor's device) to the check-in time.
    const parts = String(b.checkInTime || '15:00').split(':');
    const mins = (parseInt(parts[0], 10) || 0) * 60 + (parseInt(parts[1], 10) || 0);
    const nowMins = typeof ukNowMinutes === 'function' ? ukNowMinutes() : new Date().getHours() * 60 + new Date().getMinutes();
    return nowMins >= mins;
}
// Departure counterpart of hasCheckedIn: has the guest actually LEFT? Checkout
// day + past the checkout time = gone; before it, still in the cottage.
function hasCheckedOut(b) {
    if (!b || !b.checkOut) return false;
    const today = typeof todayDashed === 'function' ? todayDashed() : '';
    if (b.checkOut < today) return true;
    if (b.checkOut > today) return false;
    const parts = String(b.checkOutTime || '10:00').split(':');
    const mins = (parseInt(parts[0], 10) || 0) * 60 + (parseInt(parts[1], 10) || 0);
    const nowMins = typeof ukNowMinutes === 'function' ? ukNowMinutes() : new Date().getHours() * 60 + new Date().getMinutes();
    return nowMins >= mins;
}
// In residence RIGHT NOW = arrived (past check-in time) and not yet departed.
// Time-aware, so a guest arriving today at 15:00 isn't "here" at breakfast.
function isInResidence(b) { return hasCheckedIn(b) && !hasCheckedOut(b); }
// An imported iCal block is an OTA booking — a real guest, a booked night —
// unless it's the owner's own maintenance/personal block (source 'owner',
// set by ical-import.php add_block). Blocked-out dates aren't booking days.
function isOtaBlock(bl) { return !!(bl && bl.checkIn && bl.checkOut && bl.source && bl.source !== 'owner'); }
function bookingFlow(propKey, b) {
    b = b || {};
    const today = typeof todayDashed === 'function' ? todayDashed() : '';
    const past = !!(b.checkOut && b.checkOut <= today);
    const inStay = !past && hasCheckedIn(b);
    const p = b.agreedPrice || priceBreakdown(propKey, b.adults || 0, b.children || 0, b.checkIn, b.checkOut);
    const ps = paymentSummary(propKey, b);
    const gt = displayGrand(p, ps, b.holdStatus);
    const hold = b.holdStatus || 'none';
    const hasReg = !!b.regUrl;
    const hasDamage = (gt.dep || 0) > 0 || ['authorized', 'captured', 'charged', 'returned', 'kept'].includes(hold);
    const stages = [
        { key: 'booked', label: 'Booked', glabel: 'Booked', done: true },
        { key: 'deposit', label: 'Deposit', glabel: 'Deposit paid', done: gt.paid > 0.001 },
    ];
    if (hasReg) stages.push({ key: 'details', label: 'Guest details', glabel: 'Your details', done: !!b.regSubmitted });
    stages.push({ key: 'paid', label: 'Paid in full', glabel: 'Balance paid', done: !!gt.fullyPaid });
    stages.push({ key: 'arrival', label: 'Arrival info', glabel: 'Arrival info', done: !!b.preArrivalSent });
    stages.push({ key: 'stay', label: past ? 'Stayed' : 'Stay', glabel: past ? 'Stay complete' : 'Your stay', done: past, now: inStay });
    if (hasDamage) stages.push({ key: 'depositback', label: 'Deposit back', glabel: 'Deposit returned', done: ['returned', 'kept'].includes(hold) });
    return { stages, past, inStay, gt, ps, p, hasReg, hasDamage, hold };
}
// Reduce a flow to its Done / Now / Next window: index of the first unfinished
// stage (the "now"), clamped so an in-progress stay reads as current. Shared so
// admin + guest highlight the same step.
function bookingFlowCursor(stages) {
    let cur = stages.findIndex((s) => !s.done);
    const stayNow = stages.findIndex((s) => s.now && !s.done);
    if (stayNow > -1) cur = stayNow;
    return cur; // -1 when every stage is done
}
// Guest-facing render of the unified flow for a My Stays card: the progress dots
// (guest wording) plus ONE clear next step the guest can act on. The details step
// is actionable straight from here (the token form is login-free); payment keeps
// its own prominent Pay button on the card, so the flow just points to it.
function guestFlowHtml(propKey, b, payToken) {
    const flow = bookingFlow(propKey, b);
    const stages = flow.stages;
    const cur = bookingFlowCursor(stages);
    const steps = stages
        .map((s, i) => {
            // In-progress stay reads GREEN (a live "you're here now" state).
            const cls = s.done ? 'is-done' : s.now || i === cur ? 'is-now' + (s.key === 'stay' && s.now ? ' is-staying' : '') : '';
            return `<span class="bkflow-step ${cls}"><span class="bkflow-dot"></span>${escapeHtml(s.glabel)}</span>`;
        })
        .join('');
    const gt = flow.gt;
    let next;
    if (flow.hasReg && !b.regSubmitted && b.regUrl) {
        next = `<div class="bkflow-next"><span>Add your guest details before you arrive — UK law asks for the name &amp; nationality of everyone 16 or over.</span><a class="btn-glass btn-sm bkflow-cta" href="${escapeHtml(b.regUrl)}" target="_blank" rel="noopener">Add your details</a></div>`;
    } else if (!gt.fullyPaid) {
        next = `<div class="bkflow-next"><span>${gbp(gt.balance)} balance still to pay${payToken ? ' — use “Pay balance” below.' : '.'}</span></div>`;
    } else if (!b.preArrivalSent) {
        next = `<div class="bkflow-next is-clear"><span>You’re paid up. We’ll send your arrival info (directions &amp; key) nearer the time.</span></div>`;
    } else {
        next = `<div class="bkflow-next is-clear"><span>You’re all set — we can’t wait to welcome you.</span></div>`;
    }
    return `<div class="bkflow"><div class="bkflow-lbl">Your booking progress</div><div class="bkflow-steps">${steps}</div>${next}</div>`;
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
    // ONE admin-bootstrap round-trip covers all four reads below (plus cron
    // status, stashed on window for the dashboard cron-health pill in admin.js)
    // — on shared hosting each request is
    // its own PHP process + DB connection, so this is the difference between
    // one and five per back-office screen. Each task still falls back to its
    // own endpoint if the combined payload fails or misses its part, and
    // handles its own errors so nothing blocks anything else.
    let ab = null;
    try {
        ab = await apiGet('admin-bootstrap.php');
        if (!ab || !ab.ok) ab = null;
    } catch (e) {}
    window.__cronStatusPre = (ab && ab.cron) || null;

    // Shape-check each part (not just truthiness) so a malformed combined
    // payload cleanly falls back to the individual endpoint.
    const ratesTask = loadRates(ab && ab.rates && Array.isArray(ab.rates.properties) ? ab.rates : null);

    const bookingsTask = (async () => {
        try {
            const { bookings } =
                ab && ab.bookings && Array.isArray(ab.bookings.bookings)
                    ? ab.bookings
                    : await apiGet('bookings.php');
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
            const { enquiries: rows } =
                ab && ab.enquiries && Array.isArray(ab.enquiries.enquiries)
                    ? ab.enquiries
                    : await apiGet('enquiries.php');
            enquiries = (rows || []).map(mapEnquiryFromApi);
        } catch (e) {
            enquiries = [];
        }
    })();

    // External (iCal) blocks — Airbnb/Vrbo dates imported by the sync.
    // Admin-only; if not logged in this 403s and we just keep them empty.
    const blocksTask = (async () => {
        try {
            const r =
                ab && ab.blocks && Array.isArray(ab.blocks.blocks)
                    ? ab.blocks
                    : await apiPost('ical-import.php', { action: 'blocks' });
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



// ---- Square online payments (admin) ----
let squareAdminEnabled = false;
async function loadSquareAdminConfig(pre) {
    try {
        // `pre` = this endpoint's payload already fetched via bootstrap.php.
        const c = pre || (await apiGet('square-config.php'));
        squareAdminEnabled = !!c.enabled;
    } catch (e) {
        squareAdminEnabled = false;
    }
    // Repaint the Manage → Payments panel only if the admin bundle is already
    // in — this runs on PUBLIC boot too, and calling the facade stub here would
    // make every guest download admin.js. Post-login, settingsOpen('payments')
    // and nav(view-settings) render it anyway.
    try {
        if (window.__ADMIN_LOADED) renderSquareSettings();
    } catch (e) {}
}
// The ledger status to show for a payment row. A refund the owner has issued is
// DONE from the ledger's point of view: Square accepts it irrevocably and then
// settles it (its own transient PENDING → COMPLETED), so a processed refund reads
// "Completed" rather than an alarming "Pending" — only an explicit Square
// FAILED/REJECTED is a real problem worth flagging. Card-IN rows (deposit/balance)
// keep Square's live status so a not-yet-settled charge still reads truthfully.
// (Lives in app.js, not admin.js, because the booking-hub ledger below shares it.)
function paymentStatusLabel(kind, status) {
    const isReturn = kind === 'refund' || kind === 'damages_return';
    const st = String(status || '').toUpperCase();
    return isReturn ? (st === 'FAILED' || st === 'REJECTED' ? 'Failed' : 'Completed') : (status || '');
}
// Traffic-light meta for a payment row: a dot LEVEL (ok=green done, wait=amber
// in-progress, bad=red problem) plus a Title-cased word for the hover / screen-
// reader label (also unifies "COMPLETED" vs "Completed").
function paymentStatusMeta(kind, status) {
    const st = String(paymentStatusLabel(kind, status) || '').toUpperCase();
    // APPROVED counts as PAID in reconcile_booking_payment (bookings.php), so it
    // must read green here too — else a fully-paid booking shows an amber dot.
    const level =
        st === 'COMPLETED' || st === 'CAPTURED' || st === 'APPROVED'
            ? 'ok'
            : st === 'FAILED' || st === 'REJECTED' || st === 'CANCELED' || st === 'CANCELLED' || st === 'VOIDED'
              ? 'bad'
              : 'wait';
    const label = st ? st.charAt(0) + st.slice(1).toLowerCase() : 'Pending';
    return { level, label };
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
    // Once the guest has arrived, or the cancellation window has closed, the rental
    // is no longer refundable — only the damages deposit (Return deposit) can go
    // back. Hide the per-charge Refund button in that window (the server enforces it).
    const loc = findBookingLocation(bookingId);
    const refundOff = rentalRefundBlocked(loc ? loc.propKey : '', booking);
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
                    isCharge && live && !refundOff
                        ? `<button class="btn-sm btn-decline" style="padding:4px 10px;font-size:0.72rem;" ${chbAttrs('refundPayment', String(bookingId), String(p.square_payment_id), parseFloat(p.amount))}>Refund</button>`
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
                // Status shows as a traffic-light DOT (green done / amber in-progress /
                // red problem) — same system as the Payments screen; the word rides
                // along as the hover + screen-reader label so it's never colour-only.
                const sMeta = paymentStatusMeta(p.kind, p.status);
                return `<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 0;border-top:1px solid var(--glass-border);">
                        <span>${label} · ${sign}${gbp(p.amount)} <span role="img" aria-label="${escapeHtml(sMeta.label)}" title="${escapeHtml(sMeta.label)}"><span class="feed-dot feed-dot-${sMeta.level}"></span></span>${note ? ` <span style="opacity:.7;">— ${escapeHtml(note)}</span>` : ''}</span>${refundBtn}</div>`;
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
// Parse a DB datetime ('YYYY-MM-DD HH:MM:SS') to a Date, or null.
function msgDate(at) {
    if (!at) return null;
    const d = new Date(String(at).replace(' ', 'T'));
    return isNaN(d) ? null : d;
}
// Day bucket + label for the in-thread date separators.
function msgDayKey(at) {
    const d = msgDate(at);
    return d ? d.toDateString() : '';
}
function dayLabel(at) {
    const d = msgDate(at);
    if (!d) return '';
    const now = new Date();
    if (d.toDateString() === now.toDateString()) return 'Today';
    const y = new Date(now);
    y.setDate(now.getDate() - 1);
    if (d.toDateString() === y.toDateString()) return 'Yesterday';
    return d.toLocaleDateString('en-GB', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        ...(d.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
    });
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
    let prevDay = '';
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
            const att = m.attachment
                ? `<a class="chat-attach-link" href="${escapeHtml(m.attachment)}" target="_blank" rel="noopener"><img class="chat-attach" src="${escapeHtml(m.attachment)}" loading="lazy" alt="Photo attachment"></a>`
                : '';
            const bodyHtml = m.body ? escapeHtml(m.body) : '';
            // Date separator whenever the day changes (Today / Yesterday / Wed 3 Jul).
            const dk = msgDayKey(m.at);
            let sep = '';
            if (dk && dk !== prevDay) {
                prevDay = dk;
                sep = `<div class="chat-daysep"><span>${escapeHtml(dayLabel(m.at))}</span></div>`;
            }
            return `${sep}<div class="chat-msg ${m.role === meRole ? 'me' : 'them'}${m.attachment && !m.body ? ' chat-msg-img' : ''}">${att}${bodyHtml}<div class="chat-meta">${who} · ${fmtMsgTime(m.at)}${receipt}</div></div>`;
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
    overlayHistPush(); // Back closes this overlay
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
    if (w && w.classList.contains('open'))
        overlayHistConsume(); // eat the overlay's history entry (no-op if Back closed it)
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
        chatSetTyping('chat-thread', !!r.peer_typing);
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
    __chatPollTimer = setInterval(chatPoll, 4000); // ping for a host reply every ~4s while open
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
        if (sig !== __chatSig) {
            // Something new — re-render (leaving any instant bot bubbles alone otherwise).
            __chatSig = sig;
            const thread = document.getElementById('chat-thread');
            if (thread && msgs.length) {
                const nearBottom = thread.scrollHeight - thread.scrollTop - thread.clientHeight < 60;
                thread.innerHTML = chatBubbles(msgs, 'guest');
                if (nearBottom) thread.scrollTop = thread.scrollHeight; // only autoscroll if at the bottom
            }
        }
        // Typing state updates every tick, independent of message changes.
        chatSetTyping('chat-thread', !!r.peer_typing);
    } catch (e) {
        /* transient — try again next tick */
    }
}
// Show/hide a "typing…" bubble as the last child of a thread container. Used by
// both the guest widget and the owner's back-office conversation.
function chatSetTyping(containerId, on) {
    const c = document.getElementById(containerId);
    if (!c) return;
    let el = c.querySelector('.chat-typing');
    if (on) {
        if (!el) {
            el = document.createElement('div');
            el.className = 'chat-typing';
            el.setAttribute('aria-label', 'typing');
            el.innerHTML = '<span></span><span></span><span></span>';
            c.appendChild(el);
            const nearBottom = c.scrollHeight - c.scrollTop - c.clientHeight < 90;
            if (nearBottom) c.scrollTop = c.scrollHeight;
        }
    } else if (el) {
        el.remove();
    }
}
// Tell the server we're composing (throttled) so the other side sees "typing…".
let __typingLastPing = 0;
function chatTypingPing() {
    const now = Date.now();
    if (now - __typingLastPing < 2500) return;
    __typingLastPing = now;
    const loggedIn = !!currentGuest;
    const token = chatGetToken();
    if (!loggedIn && !token) return; // no thread yet — nothing to stamp
    apiPost('messages.php', loggedIn ? { action: 'typing' } : { action: 'typing', token }).catch(
        () => {},
    );
}
function adminTypingPing() {
    if (!__msgThreadId) return;
    const now = Date.now();
    if (now - __typingLastPing < 2500) return;
    __typingLastPing = now;
    apiPost('messages.php', { action: 'typing', thread_id: __msgThreadId }).catch(() => {});
}
// ---- Chat image attachments (guest widget + owner thread) ----
let __chatPendingAttach = null;
let __adminPendingAttach = null;
function chatPickImageFile() {
    return new Promise((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*,.heic,.heif';
        input.onchange = () => resolve((input.files && input.files[0]) || null);
        input.click();
    });
}
async function chatUploadImage(file, forGuest) {
    file = await ensureUploadable(file); // convert iPhone HEIC → JPEG first
    const fd = new FormData();
    fd.append('image', file, file.name || 'photo.jpg');
    if (forGuest && !currentGuest) {
        // Anonymous visitor — the upload needs a chat token to authorise.
        fd.append('token', chatGetToken() || chatNewToken());
    }
    const res = await fetchWithTimeout(
        API_BASE + 'chat-upload.php',
        { method: 'POST', headers: csrfHeader(), credentials: 'include', body: fd },
        45000,
    );
    const text = await res.text();
    let data = {};
    try {
        data = text ? JSON.parse(text) : {};
    } catch (e) {}
    if (!res.ok || !data.url) throw new Error(data.error || 'Upload failed (' + res.status + ')');
    return data.url;
}
function renderChatAttachPreview(hostId, url, onClear) {
    const host = document.getElementById(hostId);
    if (!host) return;
    if (!url) {
        host.style.display = 'none';
        host.innerHTML = '';
        return;
    }
    host.style.display = 'flex';
    host.innerHTML = `<img src="${escapeHtml(url)}" alt=""><span>Photo attached</span><button type="button" class="chat-attach-x" aria-label="Remove photo">✕</button>`;
    const x = host.querySelector('.chat-attach-x');
    if (x && onClear) x.onclick = onClear;
}
async function chatAttachPhoto() {
    const file = await chatPickImageFile();
    if (!file) return;
    const btn = document.getElementById('chat-attach-btn');
    if (btn) btn.classList.add('busy');
    try {
        __chatPendingAttach = await chatUploadImage(file, true);
        renderChatAttachPreview('chat-attach-preview', __chatPendingAttach, chatClearAttach);
    } catch (e) {
        glassAlert("Couldn't attach that photo: " + e.message);
    } finally {
        if (btn) btn.classList.remove('busy');
    }
}
function chatClearAttach() {
    __chatPendingAttach = null;
    renderChatAttachPreview('chat-attach-preview', null);
}
async function adminAttachPhoto() {
    if (!__msgThreadId) return;
    const file = await chatPickImageFile();
    if (!file) return;
    const btn = document.getElementById('msg-attach-btn');
    if (btn) btn.classList.add('busy');
    try {
        __adminPendingAttach = await chatUploadImage(file, false);
        renderChatAttachPreview('msg-attach-preview', __adminPendingAttach, adminClearAttach);
    } catch (e) {
        glassAlert("Couldn't attach that photo: " + e.message);
    } finally {
        if (btn) btn.classList.remove('busy');
    }
}
function adminClearAttach() {
    __adminPendingAttach = null;
    renderChatAttachPreview('msg-attach-preview', null);
}
// Returning to the tab with a chat open → refresh straight away (guest widget
// and, for the owner, the open back-office conversation).
document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    const w = document.getElementById('chat-widget');
    if (w && w.classList.contains('open')) chatPoll();
    const mm = document.getElementById('messages-modal');
    if (mm && mm.classList.contains('open') && typeof adminThreadPoll === 'function') adminThreadPoll();
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
//  Manage → Guest messages (content keys below), with sensible defaults.
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
// ---- Guest FAQ assistant: answer a TYPED question instantly from the cottage's
// own FAQ content, on-device, before it ever pings the owner — 24/7, no server,
// no cost. Deflects the repetitive "parking? wifi? can we bring the dog?" that
// the owner otherwise answers by hand; anything it can't confidently answer
// still reaches a person. Guest-side only (this is app.js — admin.js's NLU never
// loads for visitors), so it's a small, self-contained lexical matcher. ----
const GUEST_FAQ_SYN = {
    dog: 'dogs pet pets puppy', pet: 'dog dogs pets', park: 'parking car', parking: 'park car cars vehicle',
    wifi: 'internet broadband wi-fi', internet: 'wifi broadband', 'wi-fi': 'wifi internet',
    checkin: 'arrive arrival check', arrive: 'arrival checkin time early', arrival: 'arrive checkin',
    checkout: 'leave departure', leave: 'checkout departure', departure: 'checkout leave',
    cot: 'baby crib child children infant', baby: 'cot crib child infant', child: 'children baby cot',
    towels: 'towel linen bedding sheets', linen: 'towels bedding sheets', bedding: 'linen towels sheets',
    heating: 'heat warm radiators temperature', smoking: 'smoke cigarette vape',
    beach: 'sea coast sand quay', pub: 'pubs restaurant restaurants food eat eating dining',
    shop: 'shops supermarket store groceries', keys: 'key access lockbox entry code',
    ev: 'charge charger charging electric tesla', tv: 'television netflix streaming freeview',
    kitchen: 'cooker oven hob dishwasher fridge microwave', luggage: 'bags store early late',
    accessible: 'wheelchair disabled access stairs mobility', highchair: 'high-chair child baby',
};
const GUEST_FAQ_STOP = new Set(['the', 'a', 'an', 'is', 'are', 'do', 'does', 'can', 'could', 'would', 'will', 'i', 'we', 'you', 'my', 'our', 'to', 'at', 'for', 'and', 'of', 'it', 'in', 'on', 'with', 'have', 'has', 'any', 'there', 'be', 'if', 'how', 'what', 'whats', 'when', 'where', 'which', 'get', 'got', 'this', 'that', 'your', 'their', 'am', 'me', 'us', 'or', 'please', 'thanks', 'thank', 'hi', 'hello', 'hey']);
function guestFaqCorpus() {
    const out = [];
    try {
        Object.keys(CHAT_FAQ).forEach((k) => { const f = CHAT_FAQ[k]; out.push({ q: f.q, a: ((typeof siteContent === 'object' && siteContent && siteContent[f.key]) || '').trim() || f.def }); });
    } catch (e) {}
    try {
        const meta = typeof propertyMeta === 'object' && propertyMeta ? propertyMeta : {};
        const active = typeof activeFrontProperty !== 'undefined' && activeFrontProperty ? [activeFrontProperty] : Object.keys(meta);
        const keys = active.length ? active : Object.keys(meta);
        const seenQ = new Set();
        keys.forEach((pk) => {
            const faqs = typeof siteContent === 'object' && siteContent && Array.isArray(siteContent['faqs-' + pk]) ? siteContent['faqs-' + pk] : [];
            faqs.forEach((f) => { const q = (f && f.q || '').trim(), a = (f && f.a || '').trim(); const key = q.toLowerCase(); if (q && a && !seenQ.has(key)) { seenQ.add(key); out.push({ q, a }); } });
        });
    } catch (e) {}
    return out;
}
// Returns the best-matching FAQ {q,a} for a typed question, or null when nothing
// confidently matches (precision-biased: a wrong guest answer is worse than
// none, so it needs a real question-word hit, not just answer-text coincidence).
function guestFaqAnswer(text) {
    const q = (text || '').toLowerCase().trim();
    if (q.length < 4 || /^🛠/.test(text || '')) return null; // "Report an issue" bypasses
    const words = q.split(/[^a-z0-9-]+/).filter((w) => w.length > 1 && !GUEST_FAQ_STOP.has(w));
    if (!words.length) return null;
    const qset = new Set();
    words.forEach((w) => { qset.add(w); (GUEST_FAQ_SYN[w] || '').split(' ').filter(Boolean).forEach((s) => qset.add(s)); });
    const tok = (s) => new Set((s || '').toLowerCase().split(/[^a-z0-9-]+/).filter((w) => w.length > 1));
    let best = null, bestScore = 0, bestQHits = 0;
    guestFaqCorpus().forEach((c) => {
        // Whole-word match (so "cot" doesn't hit "cottage"); a word in BOTH the
        // question and the answer is the strongest signal (+3).
        const qtoks = tok(c.q), atoks = tok(c.a);
        let s = 0, qh = 0;
        qset.forEach((w) => { if (qtoks.has(w)) { qh++; s += 2; } if (atoks.has(w)) s += 1; });
        if (s > bestScore) { bestScore = s; bestQHits = qh; best = c; }
    });
    // Precision-biased: need a real question-word hit AND a total worth ≥ 3 (a
    // distinctive word echoed in both Q & A, or two overlapping words).
    return best && bestQHits >= 1 && bestScore >= 3 ? best : null;
}
// A typed guest question the on-device FAQ assistant couldn't answer is recorded
// (fire-and-forget, best-effort) so the owner can see recurring gaps and turn
// them into instant answers (Manage → Search learning → "Guests asked these").
// Only QUESTION-shaped text is captured — a greeting or a one-word message isn't
// a teachable FAQ. Never blocks or affects the message reaching a person.
const GUEST_Q_WORD = /^(who|what|whats|when|where|why|how|can|could|do|does|is|are|any|which|will|would|should)\b/i;
function guestQuestionShaped(text) {
    const t = String(text || '').trim();
    if (t.length < 6) return false;
    return /\?\s*$/.test(t) || GUEST_Q_WORD.test(t);
}
function guestFaqMissRecord(text, prop) {
    try {
        if (!guestQuestionShaped(text)) return;
        apiPost('guest-faq.php', { action: 'record', q: String(text).slice(0, 200), prop: prop || '' }).catch(() => {});
    } catch (e) {}
}
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
// An instant FAQ answer to a TYPED question, with a one-tap "reach a person"
// fallback (re-sends the exact question to the owner, bypassing the matcher).
function chatFaqReply(hit, original) {
    const t = chatThreadEl();
    if (!t) return;
    const d = document.createElement('div');
    d.className = 'chat-bot';
    d.innerHTML =
        escapeHtml(hit.a).replace(/\n/g, '<br>') +
        `<div class="cb-meta">Instant answer from this cottage's info.</div>` +
        `<div class="chat-bot-actions"><button type="button" class="btn-glass btn-sm" ${chbAttrs('chatReachPerson', encodeURIComponent(original || ''))}>Message a person instead</button></div>`;
    t.appendChild(d);
    chatScroll();
}
// ---- "Ask us anything" box on the cottage page — the same on-device FAQ
// matcher the chat uses (guestFaqAnswer over this cottage's content), surfaced
// where guests actually wonder. A confident match answers instantly; anything
// else (or a "not what I asked") opens the chat with the question pre-typed
// and __faqBypass set, so it reaches a person untouched. ----
function askBoxKey(event) {
    if (event && event.key === 'Enter') {
        event.preventDefault();
        askBoxSubmit();
    }
}
function askBoxSubmit() {
    const input = document.getElementById('ask-input');
    const out = document.getElementById('ask-answer');
    if (!input || !out) return;
    const q = input.value.trim();
    if (q.length < 4) {
        out.innerHTML = '';
        return;
    }
    let hit = null;
    try {
        hit = guestFaqAnswer(q);
    } catch (e) {}
    if (hit) {
        out.innerHTML = `<div class="ask-hit"><strong>${escapeHtml(hit.q)}</strong><p>${escapeHtml(hit.a)}</p><button type="button" class="ask-fallback" data-act="askBoxToChat">Not what you asked? Message a person</button></div>`;
    } else {
        out.innerHTML = `<div class="ask-hit"><p>We don't have a saved answer for that one — but a person does.</p><button type="button" class="btn-glass btn-accent btn-sm" data-act="askBoxToChat">Message us — we reply quickly</button></div>`;
    }
}
function askBoxToChat() {
    const q = ((document.getElementById('ask-input') || {}).value || '').trim();
    try {
        const w = document.getElementById('chat-widget');
        if (w && !w.classList.contains('open')) toggleChat();
    } catch (e) {}
    const input = document.getElementById('chat-input');
    if (input && q) {
        input.value = q;
        __faqBypass = true; // this exact question should reach the owner, not the matcher
        sendChat();
    }
}
function chatReachPerson(encoded) {
    const input = document.getElementById('chat-input');
    if (input) input.value = decodeURIComponent(encoded || '');
    __faqBypass = true; // this exact question should now reach the owner
    sendChat();
}
// Live availability check, in the chat thread.
let __chatAvailUid = 0;
function chatAvailStart() {
    chatClearEmpty();
    chatAppendMe('Check availability');
    const uid = 'cav' + ++__chatAvailUid;
    // Guest surface → live cottages only (an archived cottage always reads
    // "free" — its calendar takes no new bookings — and would invite an
    // enquiry for a stay the site no longer offers).
    const cavKeys = liveCottageKeys();
    const opts = (cavKeys.length ? cavKeys : Object.keys(propertyMeta))
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
            `<div class="chat-bot-actions"><button type="button" class="btn-glass" ${chbAttrs('chatAvailRun', String(uid))}>Check dates</button></div>`,
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
            `Sorry — ${escapeHtml(name)} isn't available for ${span}; those dates overlap an existing booking. Try different dates, or I can let you know if they become available.` +
                `<div class="chat-bot-actions"><button type="button" class="btn-glass" ${chbAttrs('chatAvailNotify', String(prop), String(ci), String(co))}>Notify me</button></div>`,
        );
    } else {
        chatBot(
            `Good news — ${escapeHtml(name)} looks free for ${span} (${nm} night${nm === 1 ? '' : 's'}). Shall I start your enquiry? No payment is taken now.` +
                `<div class="chat-bot-actions"><button type="button" class="btn-glass" ${chbAttrs('chatAvailEnquire', String(prop), String(ci), String(co))}>Enquire now</button></div>`,
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
let __faqBypass = false; // set by "message a person" so the same question reaches the owner
async function sendChat() {
    const input = document.getElementById('chat-input');
    const body = ((input && input.value) || '').trim();
    if (!body && !__chatPendingAttach) return;
    // Guest FAQ assistant: a typed question that confidently matches a cottage FAQ
    // is answered instantly here, no owner ping — unless they asked for a person.
    if (body && !__chatPendingAttach && !__faqBypass) {
        let hit = null;
        try { hit = guestFaqAnswer(body); } catch (e) {}
        if (hit) {
            chatClearEmpty();
            chatAppendMe(body);
            if (input) input.value = '';
            const intro0 = document.getElementById('chat-intro');
            if (intro0) intro0.style.display = 'none';
            chatFaqReply(hit, body);
            return;
        }
        // Unanswered here: the message still reaches a person below, but record
        // the question so the owner can turn recurring gaps into instant answers.
        if (!document.body.classList.contains('owner-mode')) {
            guestFaqMissRecord(body, typeof activeFrontProperty !== 'undefined' ? activeFrontProperty : '');
        }
    }
    __faqBypass = false;
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
    payload.attachment = __chatPendingAttach || '';
    try {
        const r = await apiPost('messages.php', payload);
        if (r && r.token) {
            try {
                localStorage.setItem('chb-chat-token', r.token);
            } catch (e) {}
        }
        if (input) input.value = '';
        chatClearAttach();
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
        // Guest surface → live cottages only (same rule as every public picker).
        const wlKeys = liveCottageKeys();
        sel.innerHTML = (wlKeys.length ? wlKeys : Object.keys(propertyMeta))
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
    overlayHistPush(); // Back closes this overlay
    document.getElementById('waitlist-modal').classList.add('open');
}
function closeWaitlistModal() {
    const m = document.getElementById('waitlist-modal');
    if (!m || !m.classList.contains('open')) return;
    overlayHistConsume(); // eat the overlay's history entry (no-op if Back closed it)
    m.classList.remove('open');
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
        toast("You're on the waitlist — we'll email you if those dates become available.");
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
            msg.style.color = ok ? 'var(--ok)' : 'var(--danger)';
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
let __msgThreadId = null;
let __msgThreadArchived = false;
function bookingLine(b) {
    const name = (propertyMeta[b.prop_key] || {}).name || b.prop_key;
    return `${escapeHtml(name)} · ${fmtDate(b.check_in)} → ${fmtDate(b.check_out)}${b.payment ? ' · ' + escapeHtml(b.payment) : ''}`;
}
// Bookings block in the reply modal, with one-tap "Send arrival info / balance
// link" actions for any upcoming stay (reuses the normal arrival/payment senders).
function bookingCtxHtml(bookings) {
    if (!bookings.length) {
        return `<div class="mc-row"><span class="mc-k">Bookings</span><span class="mc-v">None on file</span></div>`;
    }
    const today = new Date().toISOString().slice(0, 10);
    return bookings
        .map((b) => {
            const upcoming = (b.check_out || '') >= today; // stay hasn't ended yet
            const owed = (b.payment || '') !== 'paid';
            const actions =
                upcoming && b.id
                    ? `<div class="mc-actions">
                        <button class="btn-sm btn-edit" ${chbAttrs('chatSendArrival', b.id)}>Send arrival info</button>
                        ${owed ? `<button class="btn-sm btn-edit" ${chbAttrs('chatSendBalance', b.id)}>Send balance link</button>` : ''}
                       </div>`
                    : '';
            return `<div class="mc-row"><span class="mc-k">Booking</span><span class="mc-v">${escapeHtml(bookingLine(b))}${actions}</span></div>`;
        })
        .join('');
}
async function chatSendArrival(bid) {
    if (!__msgThreadId) return;
    try {
        await apiPost('messages.php', {
            action: 'send_arrival',
            thread_id: __msgThreadId,
            booking_id: bid,
        });
        toast('Arrival info emailed.');
        openMessageThread(__msgThreadId); // refresh so the chat note shows
    } catch (e) {
        glassAlert("Couldn't send: " + e.message);
    }
}
async function chatSendBalance(bid) {
    if (!__msgThreadId) return;
    if (!(await glassConfirm('Email this guest a secure link to pay their balance?'))) return;
    try {
        await apiPost('messages.php', {
            action: 'send_balance',
            thread_id: __msgThreadId,
            booking_id: bid,
        });
        toast('Balance link emailed.');
        openMessageThread(__msgThreadId);
    } catch (e) {
        glassAlert("Couldn't send: " + e.message);
    }
}
async function openMessageThread(threadId) {
    __msgThreadId = threadId;
    adminClearAttach(); // don't carry a pending photo between conversations
    const modal = document.getElementById('messages-modal');
    // The desktop Inbox docks this window into its reading pane. If that
    // context no longer applies (different view, messages folder hidden, or a
    // narrow window), give it back to <body> so it opens as the floating
    // window again. DOM-state checks only — no back-office globals.
    try {
        const paneEl = document.getElementById('inbox-detail-pane');
        const inboxActive = !!document.querySelector('#view-inbox.active');
        const msgFold = document.getElementById('inbox-folder-messages');
        const foldShown = !!msgFold && msgFold.style.display !== 'none';
        const wide = window.matchMedia('(min-width: 1200px)').matches;
        if (modal && paneEl && modal.parentElement === paneEl && !(inboxActive && foldShown && wide)) {
            document.body.appendChild(modal);
        }
    } catch (e) {}
    const title = document.getElementById('messages-modal-title');
    const ctx = document.getElementById('messages-modal-ctx');
    const thread = document.getElementById('messages-modal-thread');
    if (thread)
        thread.innerHTML = `<div style="padding:10px 4px;"><span class="skel-bar w65" style="display:block;margin-bottom:12px;"></span><span class="skel-bar w45" style="display:block;margin-bottom:12px;"></span><span class="skel-bar w85" style="display:block;margin-left:auto;"></span></div>`;
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
            const bk = bookingCtxHtml(r.bookings || []);
            const nBk = (r.bookings || []).length;
            const summary = `${t.is_guest ? 'Registered guest' : 'Website visitor'}${t.email ? ' · ' + escapeHtml(t.email) : ''}`;
            ctx.innerHTML = `<details class="msg-ctx-d"${nBk ? ' open' : ''}>
                        <summary class="msg-ctx-sum"><span class="msg-ctx-sum-txt">${summary}</span>${nBk ? `<span class="msg-ctx-pill">${nBk} booking${nBk > 1 ? 's' : ''}</span>` : ''}<span class="msg-ctx-caret" aria-hidden="true">▾</span></summary>
                        <div class="msg-ctx-body">
                            ${t.email ? `<div class="mc-row"><span class="mc-k">Email</span><span class="mc-v">${escapeHtml(t.email)}</span></div>` : ''}
                            <div class="mc-row"><span class="mc-k">Came from</span><span class="mc-v">${escapeHtml(t.source || '—')}</span></div>
                            <div class="mc-row"><span class="mc-k">Location</span><span class="mc-v">${escapeHtml(t.location || 'Unknown')}</span></div>
                            ${bk}
                        </div>
                    </details>`;
        }
        if (thread) {
            thread.innerHTML = chatBubbles(r.messages || [], 'admin');
            thread.scrollTop = thread.scrollHeight;
        }
        __msgThreadSig = adminMsgSig(r.messages || []);
        chatSetTyping('messages-modal-thread', !!r.peer_typing);
    } catch (e) {
        if (thread) thread.innerHTML = `<p class="chat-empty">Couldn't load this thread.</p>`;
    }
    loadAdminMessages(); // clear the unread badge now it's been read
    adminThreadStartPolling(); // live: pull new guest replies + flip the receipt to "Read"
}
// ---- Live refresh of the open conversation: poll every ~7s so a new guest
//  message appears and the owner's read receipt flips Sent → Read without
//  reopening. Only re-renders when the thread actually changed (signature keys
//  off the last message AND the read-state of the owner's latest reply). ----
let __msgThreadSig = '';
let __msgPollTimer = null;
function adminMsgSig(msgs) {
    let seen = '';
    for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i].role === 'admin') {
            seen = msgs[i].seen ? 'r' : 's';
            break;
        }
    }
    return chatMsgSig(msgs) + ':' + seen;
}
function adminThreadStartPolling() {
    adminThreadStopPolling();
    __msgPollTimer = setInterval(adminThreadPoll, 4000);
}
function adminThreadStopPolling() {
    if (__msgPollTimer) {
        clearInterval(__msgPollTimer);
        __msgPollTimer = null;
    }
}
async function adminThreadPoll() {
    const modal = document.getElementById('messages-modal');
    if (!modal || !modal.classList.contains('open') || !__msgThreadId) {
        adminThreadStopPolling();
        return;
    }
    if (document.hidden) return; // don't poll a backgrounded tab
    try {
        const r = await apiPost('messages.php', { action: 'thread', thread_id: __msgThreadId });
        const msgs = r.messages || [];
        const sig = adminMsgSig(msgs);
        if (sig !== __msgThreadSig) {
            __msgThreadSig = sig;
            const thread = document.getElementById('messages-modal-thread');
            if (thread) {
                const nearBottom = thread.scrollHeight - thread.scrollTop - thread.clientHeight < 60;
                thread.innerHTML = chatBubbles(msgs, 'admin');
                if (nearBottom) thread.scrollTop = thread.scrollHeight; // only autoscroll if already at the bottom
            }
            loadAdminMessages(); // keep the inbox list/badge in sync if a new guest reply landed
        }
        // Typing state updates every tick, independent of message changes.
        chatSetTyping('messages-modal-thread', !!r.peer_typing);
    } catch (e) {
        /* transient — try again next tick */
    }
}
function closeMessagesModal() {
    adminThreadStopPolling();
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
    if ((!body && !__adminPendingAttach) || !__msgThreadId) return;
    try {
        const res = await queueOrPost('messages.php', {
            action: 'send',
            thread_id: __msgThreadId,
            body,
            attachment: __adminPendingAttach || '',
        });
        if (input) input.value = '';
        adminClearAttach();
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
        __msgThreadSig = adminMsgSig(r.messages || []); // so the live poll re-renders only on the guest's next read/reply
        loadAdminMessages();
    } catch (e) {
        glassAlert("Couldn't send: " + e.message);
    }
}

// ---- House rules list (per cottage, guest-facing bullets) ----
const DEFAULT_HOUSE_RULES = [
    'Please treat the cottage as your own home',
    'Let us know of any special requests',
];

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
                    <button class="btn-sm btn-edit" ${chbAttrs('accomMovePhoto', String(k), i, -1)} ${i === 0 ? 'disabled' : ''} aria-label="Move up">↑</button>
                    <button class="btn-sm btn-edit" ${chbAttrs('accomMovePhoto', String(k), i, 1)} ${i === n - 1 ? 'disabled' : ''} aria-label="Move down">↓</button>
                    <button class="btn-sm btn-edit" ${chbAttrs('accomReplacePhoto', String(k), i)}>Replace</button>
                    <button class="btn-sm btn-delete" ${chbAttrs('accomRemovePhoto', String(k), i)}>Remove</button>
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
    if (!(await glassConfirm('Remove this photo?'))) return;
    const imgs = accomImages(k);
    imgs.splice(i, 1);
    await accomSavePhotos(k, imgs);
}

// ---- Guest reviews: public renderer + Settings editor ----
let publicGuestReviews = []; // approved guest-submitted reviews
async function loadPublicReviews(pre) {
    try {
        // `pre` = this endpoint's payload already fetched via bootstrap.php.
        const res = pre || (await apiGet('reviews.php'));
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
        // Clamp long quotes at a WORD boundary — "…and the qu…" reads broken.
        let clipped = text;
        if (text.length > 220) {
            clipped = text.slice(0, 218);
            const cut = clipped.lastIndexOf(' ');
            clipped = (cut > 160 ? clipped.slice(0, cut) : clipped).replace(/[\s,;:.!?—-]+$/, '') + '…';
        }
        q.textContent = clipped;
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
    return `<button class="btn-sm btn-edit" ${chbAttrs('openFaqModal', String(propKey))}><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><circle cx="12" cy="7.8" r="0.7" fill="currentColor" stroke="none"/></svg> Good to Know</button>`;
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
                    <button class="faq-q" ${chbAttrs('toggleFaq', String(id))}>
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
//  2. Owner-curated reviews entered in Manage → Guest Reviews — genuine
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
    // The homepage/per-cottage review SECTIONS were replaced by renderGuestWords()
    // and #prop-reviews; the only live job left here is refreshing the cottage-card
    // star ratings (social proof), so callers keep invoking this when reviews change.
    try {
        renderCardRatings();
    } catch (e) {}
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
            ? `<button class="btn-glass" style="margin-top:18px;padding:12px 28px;" ${chbAttrs('openAllReviews', String(propKey))}>Read all ${count} reviews</button>`
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
        enquireDraftSync(draft);
    } catch (e) {}
}
// Server-side copy of the draft, so an abandoned enquiry can get ONE gentle
// "pick up where you left off" email (enquiry-nudge.php). Only once there's
// real intent — a valid email AND chosen dates — and only the fields that
// email needs (no address/postcode/message). Fire-and-forget: a failure must
// never surface in the form. A successful submit deletes the server row.
let __enqSyncTimer = null;
let __enqSyncedSig = '';
function enquireDraftSync(draft) {
    if (document.body.classList.contains('owner-mode')) return;
    const email = (draft.email || '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return;
    if (!draft.prop || !draft.checkIn || !draft.checkOut) return;
    const payload = {
        action: 'draft',
        email,
        prop_key: draft.prop,
        name: (draft.name || '').trim(),
        check_in: draft.checkIn,
        check_out: draft.checkOut,
        adults: parseInt(draft.adults, 10) || 2,
        children: parseInt(draft.children, 10) || 0,
    };
    const sig = JSON.stringify(payload);
    if (sig === __enqSyncedSig) return;
    clearTimeout(__enqSyncTimer);
    __enqSyncTimer = setTimeout(() => {
        __enqSyncedSig = sig;
        apiPost('enquiries.php', payload).catch(() => {});
    }, 2500);
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
    // Cancel any queued save AND server sync — after a successful submit the
    // server has just deleted the draft row, and a late save (typed <400ms
    // before submitting) would re-save + re-sync it, quietly re-creating the
    // row (and earning the guest a phantom "finish your enquiry" email).
    clearTimeout(__enqDraftTimer);
    clearTimeout(__enqSyncTimer);
    __enqSyncedSig = '';
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
// Autosave while the visitor types anywhere in the enquiry form. Debounced so the
// synchronous localStorage write doesn't run on every keystroke (that can add
// input latency while typing, especially on mobile).
let __enqDraftTimer = null;
document.addEventListener('input', (e) => {
    const id = (e.target && e.target.id) || '';
    if (id.indexOf('enq-') === 0) {
        clearTimeout(__enqDraftTimer);
        __enqDraftTimer = setTimeout(enquireDraftSave, 400);
    }
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
    overlayHistPush(); // Back closes this overlay
    if (m) m.classList.add('open');
    enquiryResumeHide();
}
function closeEnquireModal() {
    const m = document.getElementById('enquire-modal');
    if (!m || !m.classList.contains('open')) return; // defensive close of an already-closed modal — no history side-effects
    overlayHistConsume(); // eat the overlay's history entry (no-op if Back closed it)
    m.classList.remove('open');
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

// ---- Guest photos: admin moderation (Manage → Guest photos) ----
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
                    <div class="guest-photo" style="aspect-ratio:4/3;border:none;border-radius:0;" role="button" tabindex="0" aria-label="${escapeHtml(p.caption || 'Guest photo')}" data-photo="${escapeHtml(data)}" data-act="openPhotoLightbox" data-pass="self" data-act-keydown="activate"><img loading="lazy" src="${escapeHtml(p.url)}" alt="${escapeHtml(p.caption || 'Guest photo at ' + (meta.name || p.prop_key))}"></div>
                    <div style="padding:9px 11px;">
                        <div style="font-size:0.74rem;color:var(--text-muted);"><span class="prop-tag tag-${p.prop_key}">${escapeHtml(meta.short || meta.name)}</span> ${escapeHtml(p.guest_name || 'Guest')}${pend ? ' · <span style="color:var(--warn-text);">Pending</span>' : ' · <span style="color:var(--ok);">Live</span>'}</div>
                        ${p.caption ? `<div style="font-size:0.8rem;margin:6px 0 0;">${escapeHtml(p.caption)}</div>` : ''}
                        <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;">
                            ${pend ? `<button class="btn-sm btn-edit" ${chbAttrs('moderatePhoto', p.id, 'approve')}>Approve</button>` : ''}
                            ${pend ? `<button class="btn-sm btn-delete" ${chbAttrs('moderatePhoto', p.id, 'reject')}>Reject</button>` : ''}
                            <button class="btn-sm btn-delete" ${chbAttrs('moderatePhoto', p.id, 'delete')}>Delete</button>
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

// Map front-end camelCase rate fields to backend snake_case columns
const RATE_FIELD_MAP = {
    coupleRate: 'couple_rate',
    extraAdultRate: 'extra_adult_rate',
    childRate: 'child_rate',
    damagesDeposit: 'booking_fee',
    transactionPct: 'transaction_pct',
    weekendPct: 'weekend_pct',
    lastminPct: 'lastmin_pct',
    lastminDays: 'lastmin_days',
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
// Long-open tabs go stale: someone books while the page sits in a background
// tab, and the chips/calendars keep claiming the old availability (the server
// still rejects a stale enquiry — this keeps what the guest SEES truthful).
// When the tab wakes after 10+ minutes hidden, re-pull everything
// availability-shaped; each loader repaints its own surfaces when data lands.
let __availHiddenAt = null;
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
        __availHiddenAt = Date.now();
        return;
    }
    if (__availHiddenAt && Date.now() - __availHiddenAt > 10 * 60 * 1000) {
        try {
            loadPublicAvailability();
        } catch (e) {}
        try {
            if (activeFrontProperty) loadAvailability(activeFrontProperty);
        } catch (e) {}
    }
    __availHiddenAt = null;
});
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
// The card chip must tell the truth against the cottage's own calendar:
// "Available now" ONLY when tonight is genuinely free (the first bookable gap
// starts today). A gap starting tomorrow or later says "Available from <date>"
// — the old 2-day grace read as a lie next to a calendar showing today booked.
function availChipHtml(gapStart, today) {
    return gapStart <= today
        ? `<span class="avail-chip now"><span class="dot"></span>Available now</span>`
        : `<span class="avail-chip"><span class="dot"></span>Available from ${dpPretty(gapStart)}</span>`;
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
            html = availChipHtml(gaps[0].start, today);
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
                <span>Late availability — <strong>${escapeHtml(name)}</strong> is available ${dpPretty(best.g.start)} to ${dpPretty(co)}</span>
                <button type="button" class="btn-sm btn-edit" ${chbAttrs('startBooking', String(best.k), String(best.g.start), String(co))}>Check dates</button>
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
                // Light mode: accent-on-pale-tint is too faint — darken towards ink
                // (same treatment app.css gives the three built-in cottages).
                `body.light-mode .tag-${k}{color:#1b2a34;color:color-mix(in srgb,var(--prop-${k}) 55%,#1b2a34);}` +
                // Timeline bar text INHERITS the theme ink (matches the built-in bars).
                `.tl-bar.bar-${k}{background:var(--prop-${k}-bg);}`;
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
// ONE card template for BOTH cottage grids — the homepage teaser grid and the
// Cottages page differ only in element-id prefix (avoids duplicate ids when
// both grids exist) and whether the "Guest favourite" badge can show. A single
// builder means the two grids can never drift apart.
function cottageCardHtml(k, idPrefix, withFav) {
    const sc = typeof siteContent === 'object' && siteContent ? siteContent : {};
    const ck = cardKeys(k);
    const slug = COTTAGE_SLUGS[k] || k;
    const img = sc[ck.img] || 'card-' + k + '.jpg';
    const title = sc[ck.title] || (propertyMeta[k] && propertyMeta[k].name) || k;
    const meta = sc[ck.meta] || cottageSleepsLabel(k);
    const fav = withFav
        ? `<span class="cott-fav" id="cott-fav-${k}" hidden><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 21s-7-4.6-9.3-9C1.4 9 2.7 5.5 6 5.5c2 0 3.2 1.2 4 2.5.8-1.3 2-2.5 4-2.5 3.3 0 4.6 3.5 3.3 6.5C19 16.4 12 21 12 21z"/></svg> Guest favourite</span>`
        : '';
    return `<a class="card glass-panel" data-prop="${k}" href="/cottages/${escapeHtml(slug)}" data-act="cottageLink" data-prop="${k}">
                    <div class="card-img-wrap">
                        <div class="card-img" data-edit-img="${ck.img}" role="img" aria-label="Photo of ${escapeHtml(title)}" style="background-image: url('${escapeHtml(resizedUrl(img, 800))}');"></div>
                        ${fav}
                    </div>
                    <div class="cott-head">
                        <div class="card-title" data-edit-text="${ck.title}">${escapeHtml(title)}</div>
                        <div class="card-rating" id="${idPrefix}card-rating-${k}"></div>
                    </div>
                    <div class="card-meta" data-edit-text="${ck.meta}">${escapeHtml(meta)}</div>
                    <div class="card-foot">
                        <div class="card-price" id="${idPrefix}card-price-${k}"></div>
                        <div class="card-avail" id="${idPrefix}card-avail-${k}"></div>
                    </div>
                </a>`;
}
function renderCottageGrid(gridId, idPrefix, withFav) {
    const grid = document.getElementById(gridId);
    if (!grid) return;
    const keys = liveCottageKeys();
    if (!keys.length) return; // never blank the grid if the list hasn't loaded
    grid.innerHTML = keys.map((k) => cottageCardHtml(k, idPrefix, withFav)).join('');
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
function renderCottageCards() {
    renderCottageGrid('cottages', '', true);
}

// Homepage cottage cards: same template via renderCottageGrid, with home-
// prefixed ids so both grids can coexist (no "Guest favourite" badge here).
function renderHomeCottages() {
    renderCottageGrid('home-cottages-grid', 'home-', false);
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
        // The live hero (uploaded) as an absolute URL — the static hero.jpg 404s
        // on the live host, so never emit it in structured data.
        const absUrl = (p) =>
            p ? (/^https?:\/\//.test(p) ? p : origin + '/' + String(p).replace(/^\/+/, '')) : '';
        const heroImg = (siteContent && typeof siteContent['hero-bg'] === 'string' && siteContent['hero-bg']) || '';
        // Replace the per-cottage Accommodation nodes.
        const base = graph.filter((n) => !isCottageNode(n));
        keys.forEach((k) => {
            const id = origin + '/#cottage-' + k;
            const prev = existing[id] || {};
            const meta = propertyMeta[k] || {};
            const lim = occupancyLimits[k] || {};
            // This cottage's first gallery photo, else the live hero — never hero.jpg.
            const gal = (siteContent && Array.isArray(siteContent['images-' + k]) && siteContent['images-' + k]) || [];
            const img = absUrl(gal.find((x) => typeof x === 'string' && x) || heroImg);
            const node = Object.assign(
                {
                    '@type': ['Accommodation', 'VacationRental'],
                    '@id': id,
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
                    // Standard changeover times (mirrors the enquiry-form defaults) —
                    // richer VacationRental data for Google's rich results.
                    checkinTime: '15:00',
                    checkoutTime: '10:00',
                },
            );
            if (img) node.image = img;
            else delete node.image; // no real image → omit rather than emit a 404
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

// 'YYYY-MM-DD' → 'DD/MM/YYYY' — the UK display format used EVERYWHERE a raw
// date reaches the screen or an email subject (storage/API stay ISO).
function fmtDate(iso) {
    const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : String(iso || '');
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
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
    })
        .formatToParts(new Date())
        .forEach((p) => {
            if (p.type !== 'literal') parts[p.type] = p.value;
        });
    return { y: +parts.year, m: +parts.month, d: +parts.day, hh: +parts.hour, mm: +parts.minute };
}
// Minutes past midnight on the UK wall clock — the cottage's clock, not the
// visitor's device (stay-stage logic must not shift with the guest's timezone).
function ukNowMinutes() {
    const t = ukNowParts();
    return t.hh * 60 + t.mm;
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
            const fields = document.getElementById('glass-dialog-fields');
            const cancel = document.getElementById('glass-dialog-cancel');
            if (!o) {
                resolve(opts.type === 'prompt' || opts.type === 'form' ? null : opts.type !== 'confirm');
                return;
            }
            msg.innerText = opts.message || '';
            inp.style.display = opts.type === 'prompt' ? 'block' : 'none';
            inp.type = opts.password ? 'password' : 'text';
            inp.value = opts.def != null ? String(opts.def) : '';
            // 'form': several labelled inputs on ONE dialog (vs. chained prompts).
            const isForm = opts.type === 'form' && Array.isArray(opts.fields);
            if (fields) {
                if (isForm) {
                    fields.innerHTML = opts.fields
                        .map((f) => {
                            const label = `<label class="modal-label" for="gdf-${f.id}">${escapeHtml(f.label || '')}</label>`;
                            // 'select': a dropdown of {value,label} options — for
                            // pick-one questions (e.g. which cottage), never typed keys.
                            if (f.type === 'select') {
                                const os = (f.options || [])
                                    .map((o) => `<option value="${escapeHtml(o.value)}">${escapeHtml(o.label)}</option>`)
                                    .join('');
                                return label + `<select class="input-glass" id="gdf-${f.id}">${os}</select>`;
                            }
                            return (
                                label +
                                `<input class="input-glass" id="gdf-${f.id}" type="${f.type || 'text'}"` +
                                (f.min != null ? ` min="${f.min}"` : '') +
                                (f.step != null ? ` step="${f.step}"` : '') +
                                ` placeholder="${escapeHtml(f.placeholder || '')}">`
                            );
                        })
                        .join('');
                    opts.fields.forEach((f) => {
                        const el = document.getElementById('gdf-' + f.id);
                        if (el && f.value != null) el.value = String(f.value);
                    });
                }
                fields.style.display = isForm ? 'block' : 'none';
                if (!isForm) fields.innerHTML = '';
            }
            cancel.style.display = opts.type === 'alert' ? 'none' : 'inline-block';
            __glassDlgResolve = (ok) => {
                let formVals = null;
                if (isForm && ok) {
                    formVals = {};
                    opts.fields.forEach((f) => {
                        const el = document.getElementById('gdf-' + f.id);
                        formVals[f.id] = el ? el.value : '';
                    });
                }
                o.classList.remove('open');
                __glassDlgResolve = null;
                if (opts.type === 'prompt') resolve(ok ? inp.value : null);
                else if (opts.type === 'form') resolve(ok ? formVals : null);
                else if (opts.type === 'confirm') resolve(!!ok);
                else resolve(true);
            };
            o.classList.add('open');
            setTimeout(() => {
                const first = isForm && fields ? fields.querySelector('input') : null;
                (opts.type === 'prompt' ? inp : first || document.getElementById('glass-dialog-ok')).focus();
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
// Several labelled inputs on one dialog. fields: [{id,label,type,value,min,step,
// placeholder}]. Resolves {id:value,…} on OK, null on Cancel.
function glassForm(message, fields) {
    return glassDialog({ type: 'form', message, fields });
}
// ---- Preview-before-send: render the EXACT email the server would send, show
// it to the owner, and only send once they confirm. Used by the booking hub's
// one-tap emails. Reuses bookings.php 'email_render' (no send, no side effects);
// if a preview can't be produced, falls back to a plain confirm so sending is
// never blocked. ----
async function previewAndSendEmail(opts) {
    // opts: { id, kind, to, sendLabel, doSend, fallbackConfirm, render? }
    //   render(): optional async () => {ok,subject,html,text} — a custom source
    //   (e.g. an enquiry's approval confirmation). Defaults to bookings.php
    //   email_render for id+kind.
    let subject = '',
        html = '',
        text = '',
        got = false;
    try {
        const r = opts.render
            ? await opts.render()
            : await apiPost('bookings.php', { action: 'email_render', id: opts.id, kind: opts.kind });
        if (r && r.ok) {
            subject = r.subject || '';
            html = r.html || '';
            text = r.text || '';
            got = !!(r.html || r.text || r.subject);
        }
    } catch (e) {}
    const ok = got
        ? await showSendConfirm({ subject, html, text, to: opts.to, sendLabel: opts.sendLabel })
        : await glassConfirm(opts.fallbackConfirm || `Send this email to ${opts.to || 'the guest'}?`);
    if (ok) await opts.doSend();
}
// Promise<bool> — shows the rendered email in a sandboxed iframe with the
// recipient + subject and Cancel / Send buttons. Resolves true only on Send.
function showSendConfirm(o) {
    return new Promise((resolve) => {
        let ov = document.getElementById('send-confirm-overlay');
        if (!ov) {
            ov = document.createElement('div');
            ov.id = 'send-confirm-overlay';
            ov.className = 'modal-overlay';
            ov.setAttribute('role', 'dialog');
            ov.setAttribute('aria-modal', 'true');
            ov.innerHTML = `<div class="modal-box email-modal-box send-confirm-box glass-panel">
                <div class="email-modal-head">
                    <span class="email-modal-title">Review before sending</span>
                    <button type="button" class="email-modal-close" id="send-confirm-x" aria-label="Cancel">×</button>
                </div>
                <div class="email-modal-meta">
                    <div class="email-meta-row" id="send-confirm-to-row"><span class="email-meta-label">To</span><span class="email-meta-value" id="send-confirm-to"></span></div>
                    <div class="email-meta-row"><span class="email-meta-label">Subject</span><span class="email-meta-value is-subject" id="send-confirm-subject"></span></div>
                </div>
                <iframe id="send-confirm-frame" class="email-modal-frame" title="Email preview" sandbox=""></iframe>
                <div class="email-modal-actions">
                    <button type="button" class="btn-sm btn-edit email-modal-cancel" id="send-confirm-cancel">Cancel</button>
                    <button type="button" class="btn-glass email-modal-send" id="send-confirm-send">Send</button>
                </div>
            </div>`;
            document.body.appendChild(ov);
        }
        const esc = (e) => {
            if (e.key === 'Escape') done(false);
        };
        const done = (val) => {
            ov.classList.remove('open');
            document.removeEventListener('keydown', esc);
            resolve(val);
        };
        // "To" row only when we have a recipient.
        const toRow = ov.querySelector('#send-confirm-to-row');
        if (o.to) {
            ov.querySelector('#send-confirm-to').textContent = o.to;
            toRow.style.display = '';
        } else {
            toRow.style.display = 'none';
        }
        ov.querySelector('#send-confirm-subject').textContent = o.subject || '(no subject)';
        const f = ov.querySelector('#send-confirm-frame');
        f.srcdoc =
            o.html && o.html.trim()
                ? o.html
                : '<pre style="font:14px system-ui,sans-serif;white-space:pre-wrap;word-break:break-word;padding:16px;margin:0;">' +
                  escapeHtml(o.text || '(empty)') +
                  '</pre>';
        const sendBtn = ov.querySelector('#send-confirm-send');
        sendBtn.textContent = o.sendLabel || 'Send';
        sendBtn.onclick = () => done(true);
        ov.querySelector('#send-confirm-cancel').onclick = () => done(false);
        ov.querySelector('#send-confirm-x').onclick = () => done(false);
        ov.onclick = (e) => {
            if (e.target === ov) done(false);
        };
        ov.classList.add('open');
        document.addEventListener('keydown', esc);
        setTimeout(() => sendBtn.focus(), 30);
    });
}
// Lightweight non-blocking toast for success/info confirmations (vs. glassAlert,
// which blocks with an OK button — kept for errors & destructive confirms).
// Shimmer skeleton rows — the list-shaped loading state (see .skel-row).
function skelRows(n = 4) {
    return Array.from({ length: n })
        .map(
            () =>
                '<div class="skel-row" aria-hidden="true"><span class="skel-bar w20"></span><span class="skel-bar w65"></span><span class="skel-bar w45"></span></div>',
        )
        .join('');
}
// toast(message, type, action?)
//   type   : 'error' for the danger style, anything else = success.
//   action : optional { label, fn } — renders an inline button (e.g. "Undo")
//            and gives the toast a longer, clearer window so it can be reached.
//            Clicking the button runs fn; clicking the rest dismisses.
function toast(message, type, action) {
    let stack = document.getElementById('app-toasts');
    if (!stack) {
        stack = document.createElement('div');
        stack.id = 'app-toasts';
        stack.className = 'toast-stack';
        stack.setAttribute('aria-live', 'polite'); // screen readers announce toasts
        document.body.appendChild(stack);
    }
    const ok = type !== 'error';
    const icon = ok
        ? '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M8.5 12.5l2.5 2.5 4.5-5"/></svg>'
        : '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg>';
    const hasAction = action && typeof action.fn === 'function';
    const el = document.createElement('div');
    el.className = 'toast toast-mini' + (ok ? '' : ' toast-err');
    // An error is a higher-priority announcement than a routine "saved" toast.
    el.setAttribute('role', ok ? 'status' : 'alert');
    el.innerHTML =
        `<div class="toast-body">${icon}<span>${escapeHtml(message)}</span></div>` +
        (hasAction ? `<button type="button" class="toast-action">${escapeHtml(action.label || 'Undo')}</button>` : '');
    stack.appendChild(el);
    let gone = false;
    const remove = () => {
        if (gone) return;
        gone = true;
        el.classList.add('toast-out');
        setTimeout(() => el.remove(), 360);
    };
    if (hasAction) {
        el.querySelector('.toast-action').addEventListener('click', (e) => {
            e.stopPropagation();
            remove();
            try {
                action.fn();
            } catch (_) {}
        });
        el.querySelector('.toast-body').addEventListener('click', remove);
        // An action toast (e.g. "Undo") carries a real affordance, so its timer
        // PAUSES while the toast has hover or focus and restarts on leave —
        // a keyboard user can't realistically Tab to the button inside 6.5s
        // otherwise (WCAG 2.2.1 Timing Adjustable). Longer base window too.
        let timer = null;
        const arm = () => { timer = setTimeout(remove, 8000); };
        const hold = () => { if (timer) { clearTimeout(timer); timer = null; } };
        el.addEventListener('mouseenter', hold);
        el.addEventListener('focusin', hold);
        el.addEventListener('mouseleave', () => { if (!gone && !timer) arm(); });
        el.addEventListener('focusout', () => { if (!gone && !timer) arm(); });
        arm();
    } else {
        el.addEventListener('click', remove);
        setTimeout(remove, 3600);
    }
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
        const pl = document.getElementById('photo-lightbox');
        if (pl && pl.classList.contains('open')) closePhotoLightbox();
    }
});
document.addEventListener('click', (e) => {
    if (e.target && e.target.id === 'reviews-modal') closeAllReviews();
    if (e.target && e.target.id === 'faq-modal') closeFaqModal();
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
    // Route Esc to these modals' own close functions so their cleanup runs
    // (e.g. the messages modal stops its live-refresh poll) instead of just
    // hiding the element via the generic fallback below.
    'messages-modal': closeMessagesModal,
    'waitlist-modal': closeWaitlistModal,
    'trip-modal': closeTripModal,
    // Admin email composer — the stub loads the bundle if it isn't in yet.
    'enq-email-modal': (...a) => window.closeEnquiryEmailModal(...a),
};
function topOpenDialog() {
    const lb = document.getElementById('lightbox');
    if (lb && lb.classList.contains('open')) return lb;
    // .reviews-modal covers the reviews/FAQ/email-composer family — include it
    // so Tab stays trapped inside those dialogs too, not just .modal-overlay.
    const open = Array.from(document.querySelectorAll('.modal-overlay.open, .reviews-modal.open'));
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
    // Full-screen dialogs lock the page scroll behind them (the date picker
    // and chat widget are inline popovers — the page must stay scrollable).
    const LOCK_SEL = '.modal-overlay, #lightbox, .reviews-modal';
    const syncScrollLock = () => {
        const anyOpen = Array.from(document.querySelectorAll(LOCK_SEL)).some(isOpen);
        document.body.classList.toggle('modal-open', anyOpen);
    };
    const onToggle = (el, wasOpen) => {
        syncScrollLock();
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
    const wired = new WeakSet();
    const wire = (el) => {
        if (wired.has(el)) return;
        wired.add(el);
        let was = isOpen(el);
        // A dialog appended already-open (e.g. cmdkPickCottage builds
        // "modal-overlay open" in one go) fires no class mutation, so move focus
        // in on the spot; otherwise watch its class for the open/close toggle.
        if (was) onToggle(el, false);
        new MutationObserver(() => {
            const now = isOpen(el);
            if (now !== was) {
                onToggle(el, was);
                was = now;
            }
        }).observe(el, { attributes: true, attributeFilter: ['class'] });
    };
    if (typeof MutationObserver !== 'function') return; // non-browser shim (tests)
    document.querySelectorAll(SEL).forEach(wire);
    // Dialogs created AFTER boot (cmdkPickCottage, showEmailPreview…) were never
    // observed, so focus stayed on the page behind an aria-modal overlay and was
    // never restored on close. Watch the body for late .modal-overlay additions.
    new MutationObserver((muts) => {
        muts.forEach((m) => m.addedNodes && m.addedNodes.forEach((n) => {
            if (n.nodeType !== 1) return;
            if (n.matches && n.matches(SEL)) wire(n);
            if (n.querySelectorAll) n.querySelectorAll(SEL).forEach(wire);
        }));
    }).observe(document.body, { childList: true, subtree: true });
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
    document.getElementById('date-picker').classList.remove('dp-admin');
    renderDatePicker();
    document.getElementById('date-picker').classList.add('open');
}
// The SAME glass picker for the back-office Add/Edit Booking modal. Taken
// nights for the chosen cottage are shaded from the data already loaded
// (excluding the booking being edited) but everything stays pickable — the
// owner may back-date a stay or deliberately overlap, and the availability
// strip + the server's clash confirm still guard the save.
function openBookingDatePicker() {
    dpMode = 'admin';
    dpState.start = document.getElementById('modal-checkin').value || null;
    dpState.end = document.getElementById('modal-checkout').value || null;
    const seed = dpParse(dpState.start) || dpToday0();
    dpState.view = new Date(seed.getFullYear(), seed.getMonth(), 1);
    document.getElementById('date-picker').classList.add('dp-admin');
    renderDatePicker();
    document.getElementById('date-picker').classList.add('open');
}
// Keep the modal's date trigger label in sync with the hidden inputs.
function refreshModalDateTrigger() {
    const disp = document.getElementById('modal-date-display');
    const trigger = document.getElementById('modal-date-trigger');
    if (!disp || !trigger) return;
    const ci = document.getElementById('modal-checkin').value;
    const co = document.getElementById('modal-checkout').value;
    if (ci && co) {
        disp.innerText = `${dpPretty(ci)}  →  ${dpPretty(co)}`;
        trigger.classList.add('has-dates');
    } else if (ci) {
        disp.innerText = `Check-in ${dpPretty(ci)} — pick check-out`;
        trigger.classList.remove('has-dates');
    } else {
        disp.innerText = 'Select the stay dates';
        trigger.classList.remove('has-dates');
    }
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
    const adminConflicts = dpMode === 'admin' ? modalStayConflicts() : null;
    for (let d = 1; d <= daysInMonth; d++) {
        const date = new Date(year, month, d);
        const ds = formatDashed(date);
        const isPast = date < today;
        const booked =
            dpMode === 'admin'
                ? !!(adminConflicts && modalDayState(adminConflicts, ds))
                : dpMode !== 'search' && !isPast && isBookedNight(ds);
        // Clickability rules (server enforces too — this is the friendly layer):
        //  - picking check-in: any free future night (a checkout/turnover day IS free)
        //  - picking check-out: any later date, as long as no booked night falls
        //    inside the stay; the first day of an existing booking is a valid
        //    checkout (turnover day), so a "booked" cell can still end a stay.
        //  - admin mode: EVERYTHING is pickable (back-dating and deliberate
        //    overlaps are the owner's call; taken nights stay shaded as a cue
        //    and the availability strip + server clash confirm guard the save).
        let clickable;
        if (dpMode === 'admin') clickable = true;
        else if (isPast) clickable = false;
        else if (dpMode === 'search')
            clickable = true; // hero search: any future date
        else if (!pickingEnd) clickable = !booked;
        else if (ds <= dpState.start)
            clickable = !booked; // restart selection
        else clickable = !rangeCrossesBooked(dpState.start, ds); // valid checkout
        const classes = ['dp-day'];
        if (isPast && dpMode !== 'admin') classes.push('dp-disabled');
        // Cross out booked nights — except when this cell is selectable as a
        // checkout (turnover day), where crossing it out would be confusing.
        // (Admin mode always keeps the shading — it's the conflict cue.)
        if (booked && (dpMode === 'admin' || !(pickingEnd && ds > dpState.start && clickable))) classes.push('dp-booked');
        if (ds === formatDashed(today)) classes.push('dp-today');
        if (dpState.start && ds === dpState.start) classes.push('dp-start');
        if (dpState.end && ds === dpState.end) classes.push('dp-end');
        if (dpState.start && dpState.end && ds > dpState.start && ds < dpState.end)
            classes.push('dp-in-range');
        // Keyboard-accessible: a clickable day is a real button role with
        // Enter/Space wired (data-act-keydown="activate", the site's keyboard
        // pattern) and a full-date accessible name incl. its state — the cell's
        // bare number alone gave screen-reader users no way to enter dates, the
        // only path through the entire booking/enquiry funnel.
        const aria = ` role="button" tabindex="0" aria-label="${fmtDate(ds)}${booked ? ' — booked' : ''}"`;
        const click = clickable ? ` ${chbAttrs('dpPick', String(ds))} data-act-keydown="activate"${aria}` : (booked ? ` aria-label="${fmtDate(ds)} — booked, unavailable"` : '');
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
    if (dpMode === 'admin') {
        document.getElementById('modal-checkin').value = dpState.start || '';
        document.getElementById('modal-checkout').value = dpState.end || '';
        refreshModalDateTrigger();
        closeDatePicker();
        try {
            updateModalPrice(); // also repaints the availability strip
        } catch (e) {}
        return;
    }
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
// Guest stepper for the cross-cottage search. Capped to the PORTFOLIO limit —
// the largest party ANY live cottage can take — derived from the loaded
// occupancy rows so an owner-added bigger cottage is reachable from the hero
// search without a code change. Falls back to the original 3/1 caps until
// rates load. Increments that would break the cap are simply blocked.
function hsPortfolioCaps() {
    let total = 0,
        adults = 0,
        children = 0;
    Object.keys(occupancyLimits).forEach((k) => {
        // Only LIVE cottages widen the caps — propertyMeta keeps archived rows
        // (for past-booking rendering) and occupancyLimits keeps its hardcoded
        // entries for the original three, so both flags must be checked or an
        // archived cottage's bigger party size dead-ends every hero search.
        const m0 = propertyMeta[k];
        if (!m0 || m0.archived || m0.unlisted) return;
        const m = occupancyLimits[k] || {};
        total = Math.max(total, parseInt(m.maxTotal, 10) || 0);
        adults = Math.max(adults, parseInt(m.maxAdults, 10) || 0);
        children = Math.max(children, parseInt(m.maxChildren, 10) || 0);
    });
    return { total: total || 3, adults: adults || 3, children: children >= 0 && total ? children : 1 };
}
function hsAdjust(field, delta) {
    const caps = hsPortfolioCaps();
    const MAX_TOTAL = caps.total,
        MAX_CHILDREN = caps.children;
    if (field === 'adults') {
        const cap = Math.min(caps.adults, MAX_TOTAL - heroSearch.children);
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
    const caps = hsPortfolioCaps();
    if (typeof s.adults === 'number') heroSearch.adults = Math.max(1, Math.min(caps.adults, s.adults));
    if (typeof s.children === 'number') heroSearch.children = Math.max(0, Math.min(caps.children, s.children));
    // Keep the restored party within the portfolio total (drop children first).
    if (heroSearch.adults + heroSearch.children > caps.total)
        heroSearch.children = Math.max(0, caps.total - heroSearch.adults);
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
    // The hero search no longer has a per-cottage filter (the dropdown was removed),
    // so any saved cottage selection is normalised back to "any" — restoring a stale
    // (possibly archived) key would otherwise silently filter every search to zero.
    heroSearch.cottage = 'any';
}
function openHeroDatePicker() {
    dpMode = 'search';
    dpState.start = heroSearch.checkin;
    dpState.end = heroSearch.checkout;
    const seed = dpParse(dpState.start) || dpToday0();
    dpState.view = new Date(seed.getFullYear(), seed.getMonth(), 1);
    document.getElementById('date-picker').classList.remove('dp-admin');
    renderDatePicker();
    document.getElementById('date-picker').classList.add('open');
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
    const sec = document.getElementById('hero-results-wrap');
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
        html += `<button type="button" class="hs-chip${heroSearch.month === ym ? ' is-on' : ''}" data-ym="${ym}" ${chbAttrs('hsSetMonth', String(ym))}>${lbl}</button>`;
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
            msg.style.color = ok ? 'var(--text-muted)' : 'var(--warn-text)';
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
        return `<button type="button" class="flex-opt" ${chbAttrs('startBooking', String(key), String(w.ci), String(w.co))}>
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
                       <button class="btn-glass" style="width:100%;margin-top:10px;" ${chbAttrs('openWaitlistModal', { prop: key, checkIn: '', checkOut: '' })}>Notify me if dates become available</button>`
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
        html = `<div class="glass-panel" style="grid-column:1/-1;text-align:center;padding:28px;"><p style="margin-bottom:14px;">Sorry, none of our cottages can host ${party} guest${party === 1 ? '' : 's'}.</p><button class="btn-glass" data-act="nav" data-view="view-cottages">Browse all cottages</button></div>`;
    else if (tooSmall > 0)
        html += `<p style="grid-column:1/-1;text-align:center;font-size:0.8rem;color:var(--text-muted);margin-top:6px;">${tooSmall} cottage${tooSmall === 1 ? ' was' : 's were'} hidden — too small for ${party} guests.</p>`;
    html += `<div class="hs-back-cta" style="grid-column:1/-1;text-align:center;margin-top:22px;">
                <p style="color:var(--text-muted);font-size:0.88rem;margin-bottom:12px;">Want a different length or month?</p>
                <button type="button" class="btn-glass btn-glass-ghost" data-act="backToSearch">Change your search</button>
            </div>`;
    grid.innerHTML = html;
    showHeroResults();
}
async function runHeroSearch() {
    const msg = document.getElementById('hs-msg');
    const setMsg = (t, ok) => {
        if (msg) {
            msg.innerText = t || '';
            msg.style.color = ok ? 'var(--text-muted)' : 'var(--warn-text)';
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
            ? `<div class="hs-banner">Your dates (${reqRange}) aren't available here — these are the closest we have.</div>`
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
                    <button class="btn-glass" style="width:100%;margin-top:10px;" ${chbAttrs('startBooking', String(key), String(r.ci), String(r.co))}>Enquire now</button>
                </div>`;
    };
    // Unavailable: never carry the clashing dates into the enquiry form (that would
    // error there). Open the cottage with its date picker ready so they pick free dates.
    const unavailCard = (key, reason) => `<div class="card glass-panel hs-unavail">
                    <div class="hs-banner hs-banner-red">${escapeHtml(reason || 'Not available for these dates')}</div>
                    <div class="card-img" role="img" aria-label="Photo of ${escapeHtml(propertyMeta[key].name)}" style="background-image:url('${propImg(key)}');"></div>
                    <div class="card-title">${escapeHtml(propertyMeta[key].name)}</div>
                    <div class="card-meta">Pick different dates to book this cottage.</div>
                    <button class="btn-glass" style="width:100%;margin-top:10px;" ${chbAttrs('startBooking', String(key), '', '')}>Choose other dates</button>
                </div>`;
    const noneMsg = (
        txt,
    ) => `<div class="glass-panel" style="grid-column:1/-1;text-align:center;padding:28px;">
                    <p style="margin-bottom:14px;">${escapeHtml(txt)}</p>
                    <button class="btn-glass" data-act="nav" data-view="view-cottages">Browse all cottages</button>
                </div>`;

    const fitKeys = Object.keys(results);
    const availKeys = fitKeys.filter((k) => results[k].available);
    const filter = heroSearch.cottage || 'any';
    let html = '';

    if (filter === 'any') {
        title.innerText = availKeys.length
            ? `Available for your dates${flexNote}`
            : `No cottages free for those dates${flexNote}`;
        // Genuine scarcity: some — but not all — cottages that fit the party are
        // free for these exact dates. Truthful, never manufactured.
        if (availKeys.length && availKeys.length < fitKeys.length) {
            const msg =
                availKeys.length === 1
                    ? 'Only 1 cottage left for your dates — book soon'
                    : `${availKeys.length} of ${fitKeys.length} cottages still free for your dates`;
            html += `<div class="hs-scarcity" style="grid-column:1/-1;text-align:center;background:var(--accent-soft);color:#1a191b;border-radius:var(--r-pill);padding:8px 16px;font-size:0.82rem;font-weight:600;margin-bottom:2px;">${msg}</div>`;
        }
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
                        ? 'But these are available for your dates'
                        : 'But this one is available for your dates',
                );
                html += others.map((k) => card(k, results[k])).join('');
            } else {
                html += noneMsg(
                    'No other cottage is available for those dates either — try different dates or widen the flexibility.',
                );
            }
        }
    }
    const wlProp = filter !== 'any' ? filter : '';
    html += `<div class="hs-back-cta" style="grid-column:1/-1;text-align:center;margin-top:22px;">
                <p style="color:var(--text-muted);font-size:0.88rem;margin-bottom:12px;">Can't see what you're looking for?</p>
                <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;">
                    <button type="button" class="btn-glass btn-glass-ghost" data-act="backToSearch">Change your search</button>
                    <button type="button" class="btn-glass" ${chbAttrs('openWaitlistModal', { prop: wlProp, checkIn: heroSearch.checkin || '', checkOut: heroSearch.checkout || '' })}>Notify me if dates become available</button>
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

// One home per booking: every list row and search hit lands on the booking
// HUB (a full admin screen — admin.js renderBookingHub), which replaced the
// old cramped details modal. The calendar is a read-only overview — nothing
// on it is clickable (external iCal blocks are display-only pills there;
// the auto-sync owns their lifecycle).
function showDetails(propKey, booking1) {
    if (!booking1) return;
    window.openBookingHub(booking1.id);
}
// The details modal itself is gone; this stays as a safe no-op because many
// flows still call it defensively while closing everything.
function closeDetailsModal() {
    const m = document.getElementById('details-modal');
    if (m) m.classList.remove('open');
}

// Save the owner-only staff note from the booking details modal (its own
// lightweight endpoint so a note never touches dates/price/payment).
async function saveBookingNote(bookingId) {
    const b = findBookingById(bookingId);
    if (!b) return;
    const ta = document.getElementById('bk-notes-' + bookingId);
    if (!ta) return;
    const notes = ta.value;
    const btn = document.getElementById('bk-notes-save-' + bookingId);
    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Saving…';
    }
    try {
        await apiPost('bookings.php', { action: 'set_notes', id: b.dbId, notes });
        b.notes = notes.slice(0, 2000);
        try {
            toast('Note saved.');
        } catch (e) {}
    } catch (e) {
        glassAlert("Couldn't save the note: " + e.message);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.textContent = 'Save note';
        }
    }
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
// The HOMEPAGE title/description are pinned to index.html's static values, NOT
// read from the live document: a guest can LAND on a server-rendered
// /cottages/<slug> or /experiences page (cottage.php/experiences-page.php have
// already injected that page's title/meta), so capturing document.* at boot
// poisoned the "defaults" with the cottage's copy for the whole session.
// og:image is deliberately still captured live — home.php injects the real
// uploaded hero there, which IS the correct homepage default.
const CHB_HOME_SEO = {
    title: 'Cottage Holidays Blakeney | Self-Catering Cottages, Norfolk',
    desc: 'Self-catering holiday cottages in Blakeney, North Norfolk — cosy retreats near the quay, coastal path and beaches. Book direct with the owner.',
    ogTitle: 'Cottage Holidays Blakeney | Holiday Cottages in Blakeney, Norfolk',
    ogDesc: 'Cosy self-catering holiday cottages on the North Norfolk coast. Near the quay, coastal path and beaches — book directly with the owner.',
};
const __chbLandedRouted = /\/cottages\//.test(location.pathname || '') || /^\/experiences\/?$/.test(location.pathname || '');
const DEFAULT_DOC_TITLE = __chbLandedRouted ? CHB_HOME_SEO.title : document.title;
let __suppressRouteSync = false; // set while reacting to back/forward so we don't re-push

// Update <title> + canonical + og:url so each cottage URL has its own SEO snippet.
function updateRouteSeo(propKey) {
    const canonical = document.querySelector('link[rel="canonical"]');
    const ogUrl = document.querySelector('meta[property="og:url"]');
    const ogTitle = document.querySelector('meta[property="og:title"]');
    const ogDesc = document.querySelector('meta[property="og:description"]');
    const ogImage = document.querySelector('meta[property="og:image"]');
    const metaDesc = document.querySelector('meta[name="description"]');
    // twitter:* ride along with og:* — cottage.php injects them server-side, so
    // leaving them untouched made the head self-contradictory after in-app nav.
    const twTitle = document.querySelector('meta[name="twitter:title"]');
    const twDesc = document.querySelector('meta[name="twitter:description"]');
    const twImage = document.querySelector('meta[name="twitter:image"]');
    // Remember the homepage defaults the first time, so we can restore them on
    // the way out. On an SSR cottage/experiences landing the live DOM carries
    // THAT page's copy, so the text fields come from the pinned CHB_HOME_SEO;
    // og:image stays live-captured (home.php's uploaded hero) unless the SSR
    // route replaced it, in which case there's nothing homepage-true to keep.
    if (!window.__seoDefaults) {
        window.__seoDefaults = __chbLandedRouted
            ? {
                title: CHB_HOME_SEO.title,
                desc: CHB_HOME_SEO.desc,
                ogTitle: CHB_HOME_SEO.ogTitle,
                ogDesc: CHB_HOME_SEO.ogDesc,
                ogImage: '', // SSR page's image — never restore it onto the homepage
            }
            : {
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
        if (ogImage && D.ogImage) ogImage.setAttribute('content', D.ogImage);
        if (twTitle) twTitle.setAttribute('content', D.ogTitle);
        if (twDesc) twDesc.setAttribute('content', D.ogDesc);
        if (twImage && D.ogImage) twImage.setAttribute('content', D.ogImage);
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
    // Social image: this cottage's first photo, made absolute. With no gallery
    // photo, LEAVE the server-injected og:image alone — the old 'card-<key>.jpg'
    // fallback doesn't exist on the live host (same class as hero.jpg) and
    // would replace a valid preview with a 404.
    let img = (Array.isArray(content.images) && content.images[0]) || '';
    if (img && !/^https?:\/\//i.test(img)) img = SITE_ORIGIN + '/' + img.replace(/^\//, '');
    document.title = title;
    if (canonical) canonical.setAttribute('href', url);
    if (ogUrl) ogUrl.setAttribute('content', url);
    if (ogTitle) ogTitle.setAttribute('content', title);
    if (metaDesc) metaDesc.setAttribute('content', desc);
    if (ogDesc) ogDesc.setAttribute('content', desc);
    if (ogImage && img) ogImage.setAttribute('content', img);
    if (twTitle) twTitle.setAttribute('content', title);
    if (twDesc) twDesc.setAttribute('content', desc);
    if (twImage && img) twImage.setAttribute('content', img);
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
    // Decide from the PRE-push state (onRouted) — pushState above already reset
    // the pathname, so re-testing it here always said "not a cottage page" and
    // the homepage kept the cottage's title/canonical/og for the whole session.
    if (onRouted) updateRouteSeo(null);
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
// ---- Overlay ↔ browser-Back integration ----------------------------------
// The five guest overlays (enquiry, waitlist, terms, sign-in, chat) push a
// history entry when they open, so Back CLOSES the overlay instead of
// navigating the page underneath it (the classic stranded-modal bug on
// mobile). Closing via the X consumes that entry silently.
let __overlayClosing = false;
function overlayHistPush() {
    try {
        // If the top entry is already an overlay entry (e.g. a just-closed
        // overlay whose history.back() hasn't landed yet, or one overlay
        // replacing another), REUSE it rather than stacking a second — pushing
        // during an in-flight back() races and can strand navigation.
        if (history.state && history.state.chbOverlay) return;
        history.pushState(Object.assign({}, history.state || {}, { chbOverlay: true }), '');
    } catch (e) {}
}
function overlayHistConsume() {
    if (history.state && history.state.chbOverlay) {
        __overlayClosing = true;
        try {
            history.back();
        } catch (e) {
            __overlayClosing = false;
        }
    }
}
// Close the top-most open guest overlay; true if one was closed.
function closeTopOverlay() {
    const open = (id) => {
        const el = document.getElementById(id);
        return el && el.classList.contains('open');
    };
    if (open('enquire-modal')) { closeEnquireModal(); return true; }
    if (open('waitlist-modal')) { closeWaitlistModal(); return true; }
    if (open('guest-auth-modal')) { closeGuestAuthModal(); return true; }
    if (open('terms-modal')) { closeTermsModal(); return true; }
    if (open('chat-widget')) { closeChat(); return true; }
    return false;
}
window.addEventListener('popstate', (ev) => {
    // A programmatic history.back() from an overlay's own close button — the
    // overlay is already closed; swallow the event.
    if (__overlayClosing) {
        __overlayClosing = false;
        return;
    }
    // An overlay is open: Back closes IT and stays on the page beneath (the
    // overlay's history entry carried the same URL, so nothing else moves).
    if (closeTopOverlay()) return;
    // A stale overlay entry (overlay was closed via its X): swallow it rather
    // than replaying the underlying view.
    if (ev.state && ev.state.chbOverlay) return;
    // Admin locations replay from the recorded state, so Back walks
    // drill-down → index → dashboard rather than exiting to the homepage.
    const st = ev.state && ev.state.chbAdmin;
    if (st && isAuthenticated) {
        __histReplay = true;
        try {
            if (st.view === 'view-inbox') {
                nav('view-inbox'); // nav() repaints the inbox screen
            } else if (st.view === 'view-settings') {
                nav('view-settings');
                if (st.section) {
                    settingsOpen(st.section);
                    // Walk back down any deep drill-down (cottage editor,
                    // per-cottage calendar/cancellation) that was open.
                    if (st.prop && st.section === 'accom') {
                        settingsOpenAccom(st.prop);
                        if (st.accomSec) settingsOpenAccomSec(st.prop, st.accomSec);
                    } else if (st.prop && st.section === 'calendar') {
                        Promise.resolve(settingsOpenCalendar(st.prop)).catch(() => {});
                    } else if (st.prop && st.section === 'cancel') {
                        settingsOpenCancel(st.prop);
                    }
                } else settingsShowIndex();
            } else if (st.view === 'view-accounts') {
                nav('view-accounts');
                if (st.section) accountsOpen(st.section);
                else accountsShowIndex();
            } else if (st.view === 'view-bookings') {
                // Pre-merge history entries: the Bookings page is now part of
                // the dashboard — the alias lands on the merged workspace.
                Promise.resolve(openBookings()).catch(() => {});
            } else if (st.view === 'view-booking-hub' && st.hubBooking) {
                Promise.resolve(window.openBookingHub(st.hubBooking)).catch(() => {});
            } else if (st.view === 'view-enquiry-hub' && st.enqHub) {
                Promise.resolve(window.openEnquiryHub(st.enqHub)).catch(() => {});
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
// Same idea as cottageLink for view-based routes (Home, Experiences): the anchor
// carries a REAL href (crawlable + open-in-new-tab works), but an ordinary click
// is intercepted for in-app SPA navigation.
function routeLink(e, viewId) {
    if (e && (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button)) return true;
    if (e) e.preventDefault();
    nav(viewId);
    return false;
}
// Rebuild the footer's cottage links from the LIVE cottage list (owner-added
// included, archived dropped), each a real /cottages/<slug> URL — so crawlers see
// a proper internal-link graph to the indexable cottage pages, not just JS views.
// The static markup lists the original three as a no-JS fallback.
function renderFooterCottages() {
    const wrap = document.getElementById('footer-cottage-links');
    if (!wrap) return;
    const keys = typeof liveCottageKeys === 'function' && liveCottageKeys().length ? liveCottageKeys() : [];
    if (!keys.length) return; // no live list yet → keep the static fallback
    wrap.innerHTML = keys
        .map((k) => {
            const meta = propertyMeta[k] || {};
            const slug = COTTAGE_SLUGS[k] || k;
            const name = meta.name || k;
            return `<a href="/cottages/${escapeHtml(slug)}" data-act="cottageLink" data-prop="${k}">${escapeHtml(name)}</a>`;
        })
        .join('');
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
    try {
        renderStayedBefore(); // "you've stayed here before" for a returning guest
    } catch (e) {}
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
                ${p.damagesDeposit > 0 ? `<div class="price-row" style="margin-top:12px;"><span>+ Refundable damages deposit</span><span>${gbp(p.damagesDeposit)}</span></div>` : ''}
                <p style="color: var(--text-muted); font-size: 0.78rem; text-align: center; margin: 10px 0 0; line-height: 1.45;">${p.damagesDeposit > 0 ? "The deposit is refunded after your stay. " : ''}Subject to change before booking has been confirmed — we will contact you to give an accurate price.</p>
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
    // We must be able to reply: an email or a phone number is required, and a
    // typed email has to look like one (the server re-checks both).
    if (!email && !phone) {
        setEnqMsg('details', 'Please give an email address or phone number so we can reply.');
        document.getElementById('enq-email').focus();
        return;
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
        setEnqMsg('details', 'That email address doesn’t look right — please check it.');
        document.getElementById('enq-email').focus();
        return;
    }
    if (!isUkPostcode(postcode)) {
        setEnqMsg('details', 'Please enter a valid UK postcode.');
        return;
    }
    if (!message) {
        setEnqMsg('details', 'Please tell us a little about your party before sending your enquiry.');
        document.getElementById('enq-message').focus();
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
    // Last look at the availability data we hold before posting — a tab that
    // sat open while someone else booked gets a clear message here instead of
    // a server rejection (the server re-checks authoritatively either way).
    const knownRanges = propertyAvailability[propKey] || [];
    if (knownRanges.some((r) => r.start < checkOut && r.end > checkIn)) {
        setEnqMsg('details', 'Sorry, those dates have just been taken — please choose different dates.');
        loadAvailability(propKey);
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
            sms_opt_in:
                document.getElementById('enq-sms-optin') && document.getElementById('enq-sms-optin').checked ? 1 : 0,
        });
    } catch (e) {
        // Server said the dates were taken while this tab held stale data —
        // refresh every availability surface so the calendar and chips the
        // guest looks at next tell the truth about why.
        if (/no longer available/i.test(e.message || '')) {
            try {
                loadAvailability(propKey);
            } catch (e2) {}
            try {
                loadPublicAvailability();
            } catch (e2) {}
        }
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
    // Signed-in guests land on My Stays where the new enquiry card is waiting —
    // a real confirmation surface instead of a toast over the cottage page.
    if (currentGuest) {
        try {
            openGuestArea();
        } catch (e) {}
    }
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
    toast("Enquiry sent — we'll confirm availability and your price by email.");
}

// ===================================================================
//  INBOX
// ===================================================================
function refreshInboxBadge() {
    const n = enquiries.length;
    const badge = document.getElementById('inbox-badge');
    if (badge) {
        badge.innerText = n;
        badge.classList.toggle('zero', n === 0);
    }
    // Inbox folder-switch chip (comms dashboard) — same pending count.
    const folderChip = document.getElementById('ifold-count-enq');
    if (folderChip) folderChip.textContent = n > 0 ? n : '';
    // Dock Inbox pip.
    const dock = document.getElementById('dock-badge-inbox');
    if (dock) {
        dock.textContent = n;
        dock.style.display = n > 0 ? '' : 'none';
    }
    // The Today pip shows the same pending-enquiries count — keep it in step here
    // too so it can't lag behind the Inbox pip (this runs from far more places than
    // refreshOwnerHomeBadges does).
    const today = document.getElementById('dock-badge-enquiries');
    if (today) {
        today.textContent = n;
        today.style.display = n > 0 ? 'flex' : 'none';
    }
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

// ===================================================================
//  EDIT / MOVE MODAL  (shared by enquiries and confirmed bookings)
// ===================================================================
function openModal() {
    document.getElementById('edit-modal').classList.add('open');
    // Land the owner ready to type (guest name is the first blank on an add).
    setTimeout(() => {
        const nm = document.getElementById('modal-name');
        if (nm && !nm.value) nm.focus();
    }, 120);
}
function closeModal() {
    document.getElementById('edit-modal').classList.remove('open');
    document.getElementById('modal-error').style.display = 'none';
    // Dismiss the guest typeahead dropdown (pure DOM — no admin dependency).
    const sg = document.getElementById('modal-name-suggest');
    if (sg) { sg.style.display = 'none'; sg.innerHTML = ''; }
}

// ===== Custom (brand-new property) booking wizard =====
// A booking for a property that doesn't exist yet is a 3-step flow so the owner
// never has to leave the booking screen or open Preferences:
//   Step 1  the booking modal (guest + stay details)            → "Next →"
//   Step 2  #newprop-modal  (rates, deposit, fee, override)     → "Review booking →"
//   Step 3  #overview-modal (full summary + payment status)     → "Confirm booking"
// Pricing-dependent fields are hidden on step 1 (there's no rate to price against
// until step 2), the deposit/override live on step 2, and the price only shows on
// the overview once the rates are set.
let __customBooking = null; // { name, setup:{...} } carried across the steps

// Numbers from an input id: blank -> 0, never negative.
function __numField(id) {
    const el = document.getElementById(id);
    const v = el ? String(el.value || '').trim() : '';
    return v === '' ? 0 : Math.max(0, parseFloat(v) || 0);
}

// Step 1: is the booking modal currently building a brand-new property?
function isCustomPropertyMode() {
    const sel = document.getElementById('modal-property');
    const mode = document.getElementById('modal-mode');
    return !!(sel && sel.value === '__new__' && mode && mode.value === 'add');
}
// Show/hide the pricing-dependent step-1 fields and relabel Save → Next for the
// custom flow (they move to steps 2/3). Called on property change + modal open.
function applyModalPropertyMode() {
    const custom = isCustomPropertyMode();
    const setDisp = (id, show) => {
        const el = document.getElementById(id);
        if (el) el.style.display = show ? '' : 'none';
    };
    setDisp('modal-price-box', !custom);
    setDisp('modal-payment-group', !custom);
    setDisp('modal-deposit-group', !custom);
    setDisp('modal-override-group', !custom);
    const btn = document.getElementById('modal-save-btn');
    if (btn) btn.textContent = custom ? 'Next →' : 'Save';
}

// Step 2: open the "Set up new property" page (reset to sensible defaults, or the
// values already entered if the owner stepped back from the overview).
function openCustomSetup(name) {
    const s = (__customBooking && __customBooking.setup) || null;
    const sub = document.getElementById('newprop-sub');
    if (sub)
        sub.textContent = `Prices for “${name}”. You can change these later in Manage → Preferences.`;
    document.getElementById('newprop-couple').value = s ? s.couple || '' : '';
    document.getElementById('newprop-extra-adult').value = s ? s.extraAdult || '' : '';
    document.getElementById('newprop-child').value = s ? s.child || '' : '';
    document.getElementById('newprop-deposit').value = s ? s.deposit : '75';
    document.getElementById('newprop-txn').value = s ? s.txnPct : '3';
    document.getElementById('newprop-override').value = s && s.override ? s.override : '';
    const err = document.getElementById('newprop-error');
    if (err) err.style.display = 'none';
    __customBooking = { name, setup: s };
    document.getElementById('overview-modal').classList.remove('open');
    document.getElementById('newprop-modal').classList.add('open');
    setTimeout(() => {
        const c = document.getElementById('newprop-couple');
        if (c) c.focus();
    }, 50);
}
// Step 2 → 3: validate the rates and move to the overview.
function customSetupNext() {
    const couple = __numField('newprop-couple');
    const err = document.getElementById('newprop-error');
    if (!(couple > 0)) {
        if (err) {
            err.textContent = 'Enter a nightly couple rate above £0.';
            err.style.display = 'block';
        }
        return;
    }
    __customBooking.setup = {
        couple,
        extraAdult: __numField('newprop-extra-adult'),
        child: __numField('newprop-child'),
        deposit: __numField('newprop-deposit'),
        txnPct: __numField('newprop-txn'),
        override: __numField('newprop-override'),
    };
    document.getElementById('newprop-modal').classList.remove('open');
    openCustomOverview();
}
// Cancel the whole custom flow (from step 2). The booking modal stays open behind
// so the owner can change the property or details.
function newPropCancel() {
    document.getElementById('newprop-modal').classList.remove('open');
    document.getElementById('overview-modal').classList.remove('open');
    __customBooking = null;
}
// Step 3: build the review summary (property, guest, stay, price) and show it.
function openCustomOverview() {
    const s = __customBooking.setup;
    const name = __customBooking.name;
    const g = (id) => (document.getElementById(id) || {}).value || '';
    const adults = Math.max(1, parseInt(g('modal-adults'), 10) || 0);
    const children = Math.max(0, parseInt(g('modal-children'), 10) || 0);
    const checkIn = g('modal-checkin');
    const checkOut = g('modal-checkout');
    // Preview the price against the rates just entered, without creating the
    // cottage yet (a temp propertyRates entry; priceBreakdown reads that map).
    propertyRates['__preview__'] = {
        coupleRate: s.couple,
        extraAdultRate: s.extraAdult,
        childRate: s.child,
        damagesDeposit: s.deposit,
        transactionPct: s.txnPct,
    };
    let priceRows = '';
    try {
        const p = priceBreakdown('__preview__', adults, children, checkIn, checkOut, null);
        const override = s.override > 0 ? s.override : null;
        // New booking → deposit not yet refunded → folded into the total so the
        // lines add up to what the guest actually pays now.
        const dep = displayDepositAmt(p, 'none');
        const totalRow =
            override !== null
                ? `<div class="price-row" style="opacity:0.6;"><span>Calculated total</span><span style="text-decoration:line-through;">${gbp(displayGrandTotal(p.total, p, 'none'))}</span></div>
                   <div class="price-row total"><span>Total${dep > 0 ? ' (incl. deposit)' : ''}</span><span class="price-amount">${gbp(displayGrandTotal(override, p, 'none'))}</span></div>`
                : `<div class="price-row total"><span>Total${dep > 0 ? ' (incl. deposit)' : ''}</span><span class="price-amount">${gbp(displayGrandTotal(p.total, p, 'none'))}</span></div>`;
        priceRows = `
            <div class="price-row"><span>${p.nights} night${p.nights === 1 ? '' : 's'}</span><span>${gbp(p.nightly)}</span></div>
            <div class="price-row"><span>Transaction fee (${p.transactionPct}%)</span><span>${gbp(p.txFee)}</span></div>
            ${dep > 0 ? `<div class="price-row"><span>Refundable damages deposit</span><span>${gbp(dep)}</span></div>` : ''}
            ${totalRow}`;
    } catch (e) {
        priceRows = `<div class="price-row"><span>Total</span><span>Enter valid dates to price</span></div>`;
    }
    delete propertyRates['__preview__'];
    const row = (label, val) =>
        val
            ? `<div class="ov-row"><span class="ov-k">${escapeHtml(label)}</span><span class="ov-v">${escapeHtml(val)}</span></div>`
            : '';
    const party = `${adults} adult${adults === 1 ? '' : 's'}${children ? ` · ${children} child${children === 1 ? '' : 'ren'}` : ''}`;
    const dates = checkIn && checkOut ? `${dpPretty(checkIn)} → ${dpPretty(checkOut)}` : '—';
    document.getElementById('overview-body').innerHTML = `
        <div class="ov-card">
            ${row('Property', name + ' (new · private)')}
            ${row('Guest', g('modal-name'))}
            ${row('Email', g('modal-email'))}
            ${row('Phone', g('modal-phone'))}
            ${row('Dates', dates)}
            ${row('Guests', party)}
        </div>
        <div class="price-box" style="margin-top:14px;">${priceRows}</div>`;
    document.getElementById('overview-payment').value = 'unpaid';
    const err = document.getElementById('overview-error');
    if (err) err.style.display = 'none';
    document.getElementById('overview-modal').classList.add('open');
}
// Step 3 → 2: go back to editing the property's pricing.
function customOverviewBack() {
    document.getElementById('overview-modal').classList.remove('open');
    openCustomSetup(__customBooking.name);
}
// Step 3 confirm: create the private cottage with the setup values (sized to this
// booking's party), then reuse the normal booking-save path by writing the
// resolved key + deposit/override/payment back onto the (still-open) booking
// modal and calling saveModal() again — now with a real property, so it skips the
// wizard and follows the standard add flow.
async function confirmCustomBooking() {
    const s = __customBooking.setup;
    const nm = __customBooking.name;
    const g = (id) => (document.getElementById(id) || {}).value || '';
    const adults = Math.max(1, parseInt(g('modal-adults'), 10) || 0);
    const children = Math.max(0, parseInt(g('modal-children'), 10) || 0);
    const err = document.getElementById('overview-error');
    const showErr = (m) => {
        if (err) {
            err.textContent = m;
            err.style.display = 'block';
        }
    };
    let key = '';
    try {
        const res = await apiPost('rates.php', {
            action: 'create',
            name: nm,
            couple_rate: s.couple,
            extra_adult_rate: s.extraAdult,
            child_rate: s.child,
            booking_fee: s.deposit,
            transaction_pct: s.txnPct,
            max_adults: Math.max(1, adults),
            max_children: Math.max(0, children),
            max_total: Math.max(1, adults + children),
            unlisted: 1,
        });
        if (!res || !res.prop_key) {
            showErr('Could not create the cottage — please try again.');
            return;
        }
        key = res.prop_key;
        await loadRates();
        if (typeof toast === 'function') toast(`Created private cottage “${nm}”.`);
    } catch (e) {
        showErr("Couldn't create the cottage: " + (e && e.message ? e.message : e));
        return;
    }
    // Hand the booking back to the standard save path with the real property.
    const payment = document.getElementById('overview-payment').value;
    populateBookingPropertySelect(key);
    document.getElementById('modal-property').value = key;
    applyModalPropertyMode(); // reveals the (now-relevant) payment field etc.
    document.getElementById('modal-damages-deposit').value = ''; // cottage default applies
    document.getElementById('modal-price-override').value = s.override > 0 ? s.override : '';
    document.getElementById('modal-payment').value = payment;
    document.getElementById('overview-modal').classList.remove('open');
    document.getElementById('newprop-modal').classList.remove('open');
    __customBooking = null;
    await saveModal();
}

// Rebuild the Property <select> from the live property list so the owner can pick
// ANY of their cottages — including owner-added and PRIVATE (unlisted) ones — from
// a reliable native dropdown. A trailing "➕ New property…" option lets them add a
// brand-new one by name (revealed input → created as a private cottage on save;
// see onModalPropertyChange / saveModal). `selectedKey` is force-included even if
// archived, so editing an old booking on a removed cottage still lists it. Falls
// back to the static <option>s if the rates haven't loaded yet.
function populateBookingPropertySelect(selectedKey) {
    const sel = document.getElementById('modal-property');
    if (!sel) return;
    const keys =
        typeof bookableCottageKeys === 'function' ? bookableCottageKeys() : [];
    if (selectedKey && selectedKey !== '__new__' && !keys.includes(selectedKey))
        keys.unshift(selectedKey);
    const newOpt = '<option value="__new__">➕ New property…</option>';
    if (!keys.length) {
        // rates not loaded — keep the static fallback cottages, just ensure the
        // "New property…" option is present.
        if (!sel.querySelector('option[value="__new__"]'))
            sel.insertAdjacentHTML('beforeend', newOpt);
        return;
    }
    sel.innerHTML =
        keys
            .map((k) => {
                const meta = propertyMeta[k] || {};
                const name = meta.name || k;
                const priv = meta.unlisted ? ' (private)' : '';
                return `<option value="${escapeHtml(k)}">${escapeHtml(name)}${priv}</option>`;
            })
            .join('') + newOpt;
}
// The Property box resolves to either an existing cottage key, or a brand-new
// name typed into the revealed "New property name" input.
function currentModalProperty() {
    const sel = document.getElementById('modal-property');
    if (!sel) return { key: '', newName: '' };
    if (sel.value === '__new__') {
        const nu = document.getElementById('modal-property-new');
        return { key: '', newName: nu ? nu.value.trim() : '' };
    }
    return { key: sel.value, newName: '' };
}
// Show/hide the "New property name" input when "➕ New property…" is (de)selected.
function onModalPropertyChange() {
    const sel = document.getElementById('modal-property');
    const nu = document.getElementById('modal-property-new');
    const isNew = sel && sel.value === '__new__';
    if (nu) {
        nu.style.display = isNew ? 'block' : 'none';
        if (isNew) nu.focus();
        else nu.value = '';
    }
    applyModalPropertyMode(); // custom → hide pricing fields, relabel Save → Next
    updateModalPrice();
}
// Small helpers to read/write the modal field set
function setModalFields(f) {
    populateBookingPropertySelect(f.propKey || '');
    const sel = document.getElementById('modal-property');
    const nu = document.getElementById('modal-property-new');
    if (nu) {
        nu.style.display = 'none';
        nu.value = '';
    }
    // Select the booking's cottage; for a new Add default to the first real
    // cottage (never the trailing "New property…" entry).
    sel.value = f.propKey || (sel.options[0] ? sel.options[0].value : '');
    if (sel.value === '__new__' && sel.options.length > 1) sel.value = sel.options[0].value;
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
    // Inline payment details (amount / date / method) — prefill from the booking.
    const amtEl = document.getElementById('modal-deposit-amount');
    if (amtEl) amtEl.value = f.depositPaid > 0 ? f.depositPaid : '';
    const pdEl = document.getElementById('modal-payment-date');
    if (pdEl) pdEl.value = f.paymentDate || '';
    const pmEl = document.getElementById('modal-payment-method');
    if (pmEl) pmEl.value = f.paymentMethod || '';
    togglePaymentDetails();
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
    applyModalPropertyMode(); // sync pricing-field visibility + Save/Next label
    // Clean slate: release any "move" lock and restore the payment-entry fields
    // left hidden by a previous arrived / fully-paid edit, so Add and normal edits
    // always start with the full, editable form.
    try {
        lockBookingMove(false);
        trimPaidBookingFields(false);
    } catch (e) {}
    try {
        refreshModalDateTrigger(); // the glass-picker trigger shows the dates
    } catch (e) {}
    updateModalPrice();
}

// ---- Live availability inside the Add/Edit modal ----
// The chosen cottage's own bookings + imported platform blocks, with the
// booking being edited excluded (it must not shade itself as a conflict).
// Shared by the availability strip AND the admin mode of the glass picker.
function modalStayConflicts() {
    const cur = currentModalProperty();
    const propKey = cur.key;
    if (!propKey || !propertyMeta[propKey]) return null;
    const mode = (document.getElementById('modal-mode') || {}).value;
    const selfId = mode === 'booking' ? (document.getElementById('modal-record-id') || {}).value : null;
    return {
        propKey,
        bookings: (dbBookings[propKey] || []).filter((b) => b.id !== selfId),
        blocks: dbBlocks[propKey] || [],
    };
}
// What (if anything) occupies one night in the modal's cottage.
function modalDayState(c, d) {
    for (const b of c.bookings) if (d >= b.checkIn && d < b.checkOut) return { kind: 'booked', who: b.name || 'a booking' };
    for (const bl of c.blocks) if (d >= bl.checkIn && d < bl.checkOut) return { kind: 'external', who: (bl.source || 'external') + ' import' };
    return null;
}
// Six weeks around the chosen dates with this cottage's booked days (own
// bookings) and imported platform blocks (Airbnb/Vrbo) marked, so a clash is
// visible BEFORE saving instead of only as the server's warning afterwards.
// Display-only, from data already loaded — the server stays the authority.
function updateModalAvailability() {
    const el = document.getElementById('modal-availability');
    if (!el) return;
    const hide = () => {
        el.style.display = 'none';
        el.innerHTML = '';
    };
    if (!isAuthenticated) return hide();
    const conflicts = modalStayConflicts();
    if (!conflicts) return hide();
    const propKey = conflicts.propKey;
    const ci = document.getElementById('modal-checkin').value;
    const co = document.getElementById('modal-checkout').value;
    const dayState = (d) => modalDayState(conflicts, d);
    // Grid: 6 weeks starting on the Monday of the week holding check-in (or today).
    const anchorIso = /^\d{4}-\d{2}-\d{2}$/.test(ci) ? ci : todayDashed();
    const anchor = new Date(anchorIso + 'T00:00:00Z');
    const start = new Date(anchor.getTime() - ((anchor.getUTCDay() + 6) % 7) * 86400000);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    let cells = '';
    let clashWith = null;
    for (let i = 0; i < 42; i++) {
        const dt = new Date(start.getTime() + i * 86400000);
        const iso = dt.toISOString().slice(0, 10);
        const st = dayState(iso);
        const inRange = ci && co && iso >= ci && iso < co;
        if (inRange && st && !clashWith) clashWith = st.who;
        const cls = ['mav-day'];
        if (st) cls.push(st.kind === 'booked' ? 'is-booked' : 'is-external');
        if (inRange) cls.push('is-sel');
        // Show the month on the 1st (and the first cell) so the strip stays readable.
        const label = dt.getUTCDate() === 1 || i === 0 ? `${dt.getUTCDate()} ${months[dt.getUTCMonth()]}` : String(dt.getUTCDate());
        cells += `<span class="${cls.join(' ')}" title="${iso}${st ? ' — ' + escapeHtml(st.who) : ' — free'}">${label}</span>`;
    }
    const dows = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map((d) => `<span class="mav-dow">${d}</span>`).join('');
    el.innerHTML = `
        <div class="mav-head">
            <span class="modal-label" style="margin:0;">Availability — ${escapeHtml(propertyMeta[propKey].name || propKey)}</span>
            <span class="mav-legend"><span class="mav-key is-booked"></span>booked<span class="mav-key is-external"></span>imported<span class="mav-key is-sel"></span>this stay</span>
        </div>
        <div class="mav-grid">${dows}${cells}</div>
        ${clashWith ? `<div class="mav-clash">These dates overlap ${escapeHtml(clashWith)} — you'll be asked to confirm at save.</div>` : ''}`;
    el.style.display = 'block';
}

// Live total inside the Add/Edit modal
function updateModalPrice() {
    try {
        updateModalAvailability();
    } catch (e) {}
    const box = document.getElementById('modal-price-box');
    if (!box) return;
    const cur = currentModalProperty();
    const propKey = cur.key;
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
    // "New property…" chosen → it'll be created as a private cottage on save;
    // there's no rate to price against until then.
    if (!propKey) {
        const nm = cur.newName;
        box.innerHTML = nm
            ? `<p style="color: var(--text-muted); font-size: 0.85rem; text-align: center; margin: 0;">“${escapeHtml(nm)}” will be created as a new private cottage — you'll set its nightly rate when you save, then the total appears here.</p>`
            : `<p style="color: var(--text-muted); font-size: 0.85rem; text-align: center; margin: 0;">Type the new property's name to continue.</p>`;
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
    // Deposit is charged with the first payment & refunded after the stay → show it
    // inside the total until it's been refunded (for an edit, use the booking's state).
    let holdSt = 'none';
    let repriceNote = '';
    if (document.getElementById('modal-mode').value === 'booking') {
        const bk =
            typeof findBookingById === 'function'
                ? findBookingById(document.getElementById('modal-record-id').value)
                : null;
        if (bk) holdSt = bk.holdStatus || 'none';
        // EDITING A CONFIRMED BOOKING: the price was LOCKED when it was booked.
        // While the stay is unchanged, show the AGREED figures — that is exactly
        // what saving preserves (bookings.php only re-snapshots when the stay
        // changes). Changing dates/party/deposit falls through to today's rates,
        // with an explicit note that saving replaces the agreed total.
        if (bk && bk.agreedPrice) {
            const a = bk.agreedPrice;
            const loc = typeof findBookingLocation === 'function' ? findBookingLocation(bk.id) : null;
            const curDep = bk.damagesDeposit != null ? bk.damagesDeposit : a.damagesDeposit || 0;
            const stayChanged =
                (loc && loc.propKey && propKey !== loc.propKey) ||
                checkIn !== bk.checkIn ||
                checkOut !== bk.checkOut ||
                adults !== bk.adults ||
                children !== bk.children ||
                (depOverride !== null && parseFloat(depOverride) !== curDep);
            const agreedGrand = displayGrandTotal(a.total, a, holdSt);
            if (!stayChanged && override === null) {
                const aDep = displayDepositAmt(a, holdSt);
                box.innerHTML = `
                <div class="price-row"><span>${gbp(a.perNight)} × ${a.nights} night${a.nights === 1 ? '' : 's'}</span><span>${gbp(a.nightly)}</span></div>
                <div class="price-row"><span>Transaction fee (${a.transactionPct || 0}%)</span><span>${gbp(a.txFee || 0)}</span></div>
                ${aDep > 0 ? `<div class="price-row"><span>Refundable damages deposit</span><span>${gbp(aDep)}</span></div>` : ''}
                <div class="price-row total"><span>Agreed total${aDep > 0 ? ' (incl. deposit)' : ''}</span><span class="price-amount">${gbp(agreedGrand)}</span></div>
                <p style="font-size:0.75rem;color:var(--text-muted);margin:8px 0 0;">Agreed price — locked at the rates in effect when booked. Changing the dates or party reprices at today's rates.</p>`;
                return;
            }
            if (stayChanged) {
                repriceNote = `<p style="font-size:0.75rem;color:var(--warn);margin:8px 0 0;">New price at today's rates — saving replaces the agreed ${gbp(agreedGrand)}.</p>`;
            }
        }
    }
    const depAmt = displayDepositAmt(p, holdSt);
    let rows = `
                <div class="price-row"><span>${perNightLabel} × ${p.nights} night${p.nights === 1 ? '' : 's'}</span><span>${gbp(p.nightly)}</span></div>
                <div class="price-row"><span>Transaction fee (${p.transactionPct}%)</span><span>${gbp(p.txFee)}</span></div>
                ${depAmt > 0 ? `<div class="price-row"><span>Refundable damages deposit</span><span>${gbp(depAmt)}</span></div>` : ''}`;
    if (override !== null) {
        rows += `
                <div class="price-row" style="opacity:0.6;"><span>Calculated total</span><span style="text-decoration:line-through;">${gbp(displayGrandTotal(p.total, p, holdSt))}</span></div>
                <div class="price-row total"><span>Total${depAmt > 0 ? ' (incl. deposit)' : ''}</span><span class="price-amount">${gbp(displayGrandTotal(override, p, holdSt))}</span></div>`;
    } else {
        rows += `<div class="price-row total"><span>Total${depAmt > 0 ? ' (incl. deposit)' : ''}</span><span class="price-amount">${gbp(displayGrandTotal(p.total, p, holdSt))}</span></div>`;
    }
    box.innerHTML = rows + repriceNote;
}

function openEditBooking(bookingId) {
    const b = findBookingById(bookingId);
    const loc = findBookingLocation(bookingId);
    if (!b || !loc) return;
    // SOFT LOCK on finished stays: once the guest has checked out the booking is
    // a record (invoices, guest register, the customer directory), so a tap on
    // Edit asks first — protecting against accidental phone edits WITHOUT ever
    // blocking a legitimate correction (a name typo, a missing email). Everything
    // stays auditable via the hub's change history either way. Non-past bookings
    // open synchronously (cmdkPrefillEditDates relies on that).
    if (typeof hasCheckedOut === 'function' && hasCheckedOut(b)) {
        glassConfirm('This stay is finished — it’s a record now (invoices and history point at it). Edit anyway?').then((okGo) => {
            if (okGo) openEditBookingNow(bookingId);
        });
        return;
    }
    openEditBookingNow(bookingId);
}
function openEditBookingNow(bookingId) {
    const b = findBookingById(bookingId);
    const loc = findBookingLocation(bookingId);
    if (!b || !loc) return;
    // Once the guest has arrived, the booking can be edited but not MOVED — the
    // dates and cottage are locked (openModal calls lockBookingMove below).
    const arrived = !!(b.checkIn && typeof todayDashed === 'function' && b.checkIn <= todayDashed());
    // Once the booking is fully paid, the payment-entry fields (status/date/method,
    // deposit amount, price override) are just clutter that invites accidental
    // edits — money is managed on the Payments card from then on. Hide them.
    const ps = typeof paymentSummary === 'function' ? paymentSummary(loc.propKey, b) : null;
    const fullyPaid = !!(ps && ps.fullyPaid);
    document.getElementById('modal-title').innerText = arrived ? 'Edit Booking' : 'Edit / Move Booking';
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
    lockBookingMove(arrived);
    trimPaidBookingFields(fullyPaid);
}

// Hide (or restore) the payment-entry fields of the booking modal — status/date/
// method, the damages-deposit amount and the price override. Once a booking is
// fully paid these only invite accidental edits; money is managed on the Payments
// card from then on. setModalFields() restores them first, so Add and part-paid
// edits keep the full form.
function trimPaidBookingFields(hide) {
    ['modal-payment-group', 'modal-deposit-group', 'modal-override-group'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.style.display = hide ? 'none' : '';
    });
    let note = document.getElementById('modal-paid-note');
    if (hide) {
        const anchor = document.getElementById('modal-price-box');
        if (!note && anchor && anchor.parentNode) {
            note = document.createElement('p');
            note.id = 'modal-paid-note';
            note.style.cssText = 'font-size:0.8rem;color:var(--text-muted);margin:10px 0 4px;';
            anchor.parentNode.insertBefore(note, anchor.nextSibling);
        }
        if (note) note.textContent = 'Paid in full — manage payments (refunds, deposit return) on the booking’s Payments card.';
    } else if (note) {
        note.remove();
    }
}

// Lock (or release) the "move" fields of the booking modal — the date picker and
// the cottage select — leaving every other field editable. Used when a booking
// has already started: the owner can still fix details, but can't relocate a stay
// that's under way. setModalFields() always releases it first, so Add and normal
// edits are never left locked.
function lockBookingMove(lock) {
    const trig = document.getElementById('modal-date-trigger');
    const prop = document.getElementById('modal-property');
    if (trig) {
        trig.disabled = !!lock;
        trig.style.opacity = lock ? '0.55' : '';
        trig.style.pointerEvents = lock ? 'none' : '';
    }
    if (prop) prop.disabled = !!lock;
    let note = document.getElementById('modal-move-locked');
    if (lock && trig && trig.parentNode) {
        if (!note) {
            note = document.createElement('p');
            note.id = 'modal-move-locked';
            note.style.cssText = 'margin:6px 0 0;font-size:0.8rem;color:var(--text-muted);';
            trig.parentNode.insertBefore(note, trig.nextSibling);
        }
        note.textContent = 'The guest has arrived — the dates and cottage are locked. You can still edit the other details.';
    } else if (note) {
        note.remove();
    }
}

// Payment + notes labelling differs slightly between modes
function togglePaymentField(show) {
    const sel = document.getElementById('modal-payment');
    const lbl = sel.previousElementSibling; // its <label>
    sel.style.display = show ? 'block' : 'none';
    if (lbl && lbl.classList.contains('modal-label')) lbl.style.display = show ? 'block' : 'none';
    if (!show) {
        // Enquiry mode has no payment — hide the inline details too.
        const det = document.getElementById('modal-payment-details');
        if (det) det.style.display = 'none';
    } else {
        togglePaymentDetails();
    }
    // Relabel the notes field
    const notesLabel = document.getElementById('modal-notes').previousElementSibling;
    if (notesLabel) notesLabel.innerText = show ? 'Staff Notes' : 'Guest Message';
}

// Show the inline amount/date/method fields when a payment status is chosen
// (these used to be 3 sequential pop-up prompts AFTER pressing Save). For
// "Paid in Full" the amount is the total, so only date + method show.
function togglePaymentDetails() {
    const status = (document.getElementById('modal-payment') || {}).value || 'unpaid';
    const det = document.getElementById('modal-payment-details');
    if (!det) return;
    det.style.display = status === 'deposit' || status === 'paid' ? '' : 'none';
    const amtWrap = document.getElementById('modal-deposit-amount-wrap');
    if (amtWrap) amtWrap.style.display = status === 'deposit' ? '' : 'none';
    // Default the payment date to today the first time it's revealed.
    const pd = document.getElementById('modal-payment-date');
    if (pd && det.style.display !== 'none' && !pd.value) pd.value = todayDashed();
}

// Save a booking (add/update) through the soft warnings the server can raise:
// first the smart email-deliverability check (offer the suggested correction,
// or let the owner save as-typed), then the date-clash check. Returns the
// final server response, or null if the owner cancelled at a prompt. Mutates
// `payload.email` if the owner accepts a suggested correction so any follow-up
// (e.g. the updated-confirmation email) uses the corrected address.
async function saveBookingGuarded(action, payload, clashPrompt) {
    const extra = {};
    let res = await apiPost('bookings.php', { action, ...payload });
    // Email deliverability.
    if (res && res.email_warn) {
        if (res.suggest) {
            const useIt = await glassConfirm(
                res.message +
                    `\n\nDid you mean ${res.suggest}?\n\nOK = use ${res.suggest}\nCancel = keep ${payload.email}`,
            );
            if (useIt) {
                payload.email = res.suggest; // corrected address re-validates cleanly
            } else {
                extra.override_email = true; // keep as typed, proceed
            }
        } else {
            if (!(await glassConfirm(res.message + '\n\nSave the booking anyway?'))) return null;
            extra.override_email = true;
        }
        res = await apiPost('bookings.php', { action, ...payload, ...extra });
    }
    // Occupancy (party over the property's normal limit) — deliberate confirm.
    if (res && res.occupancy_warn) {
        if (!(await glassConfirm(res.message + '\n\nSave anyway (e.g. a cot or an agreed exception)?'))) return null;
        extra.override_occupancy = true;
        res = await apiPost('bookings.php', { action, ...payload, ...extra });
    }
    // Date clash.
    if (res && res.clash) {
        if (!(await glassConfirm(res.message + '\n\n' + clashPrompt))) return null;
        extra.override_clash = true;
        res = await apiPost('bookings.php', { action, ...payload, ...extra });
    }
    return res;
}

async function saveModal() {
    const mode = document.getElementById('modal-mode').value;
    const id = document.getElementById('modal-record-id').value;
    const cur = currentModalProperty();
    let propKey = cur.key;
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

    // Property box resolves to a brand-new name → hand off to the custom-booking
    // wizard (step 2: set up pricing → step 3: review → confirm). The wizard
    // creates the private cottage then re-enters saveModal with a real key, so the
    // block below is skipped on that second pass and the standard add flow runs.
    if (!propKey) {
        const nm = cur.newName;
        if (!nm) {
            showErr('Choose a property, or pick “New property…” and type a name.');
            return;
        }
        __customBooking = { name: nm, setup: null };
        openCustomSetup(nm);
        return;
    }

    // Occupancy + date-clash checks now live SERVER-SIDE only (bookings.php
    // occupancy_warn/clash, confirmed via saveBookingGuarded) — the old client
    // pre-checks here asked the same questions a second time.

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
                // Preserve the guest's original terms acceptance across the
                // decline+resubmit edit (otherwise it's silently wiped).
                terms_accepted_at_passthrough: enq.termsAcceptedAt || '',
                terms_version: enq.termsVersion || '',
            });
            await loadData();
            closeModal();
            renderInbox();
            // Same convention as every other save: a success toast (this path
            // previously finished silently).
            toast('Enquiry updated.');
        } catch (e) {
            showErr(e.message);
        }
        return;
    }

    // ----- Booking add / edit -----
    // (Clash detection happens server-side under the per-property lock; the
    // guarded save prompts once with the authoritative answer.)

    // Payment details come from the INLINE fields under Payment Status (they
    // were 3 sequential pop-up prompts here before). The server still validates
    // 0 < deposit < total.
    let depositAmount = null;
    let paymentDate = null;
    let paymentMethod = null;
    if (payment === 'deposit' || payment === 'paid') {
        if (payment === 'deposit') {
            depositAmount = Math.max(
                0,
                parseFloat((document.getElementById('modal-deposit-amount') || {}).value) || 0,
            );
            if (!(depositAmount > 0)) {
                showErr('Enter the deposit amount paid (more than £0).');
                return;
            }
        }
        paymentDate = ((document.getElementById('modal-payment-date') || {}).value || '').trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(paymentDate)) {
            showErr('Choose the payment date.');
            return;
        }
        paymentMethod = ((document.getElementById('modal-payment-method') || {}).value || '').trim();
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
            addRes = await saveBookingGuarded('add', payload, 'Add this booking anyway?');
            if (addRes === null) return; // owner cancelled at a warning
        } else {
            const loc = findBookingLocation(id);
            if (!loc) return;
            payload.id = dbBookings[loc.propKey][loc.idx].dbId;
            const upRes = await saveBookingGuarded('update', payload, 'Save these changes anyway?');
            if (upRes === null) return;
        }
        await loadData();
        closeModal();
        renderCalendar();
        clearDetails();
        showChangeoverToasts();
        if (mode !== 'add') {
            toast('Booking updated.');
            // Offer to email the guest the updated details (e.g. after a date
            // change) — the SAME ask the money row uses, so wording never forks.
            if (payload.email) {
                const freshB = Object.values(dbBookings).flat().find((x) => x.dbId === payload.id);
                if (freshB) await offerUpdatedConfirmationEmail(freshB.id);
            }
        }
        if (mode === 'add' && addRes) {
            // Show the owner their new booking straight away (no hunting the
            // calendar) and confirm what happened with a non-blocking toast —
            // a blocking OK-alert only when something needs attention.
            const fresh = addRes.id
                ? (Object.values(dbBookings).flat().find((x) => x.dbId === addRes.id) || null)
                : null;
            const guestEmail = addRes.email && addRes.email.guest;
            if (guestEmail && guestEmail.ok) {
                toast(`Booking saved — confirmation emailed to ${payload.email}.`);
            } else if (
                guestEmail &&
                guestEmail.error &&
                guestEmail.error !== 'Mail disabled' &&
                guestEmail.error !== 'No guest email on file'
            ) {
                glassAlert(
                    `Booking saved, but the confirmation email didn't send (${guestEmail.error}). You can resend it from the booking details.`,
                );
            } else {
                toast('Booking saved.');
            }
            if (fresh) {
                const loc = findBookingLocation(fresh.id);
                if (loc) showDetails(loc.propKey, fresh);
                // Parity with enquiry approval: offer the Square payment request
                // right away instead of relying on the owner remembering later.
                if (
                    typeof squareAdminEnabled !== 'undefined' &&
                    squareAdminEnabled &&
                    payload.email &&
                    payment !== 'paid' &&
                    (await glassConfirm(
                        `Email ${payload.email} a secure card link for the deposit now?`,
                    ))
                ) {
                    try {
                        await requestPayment(fresh.id, 'deposit');
                    } catch (e) {}
                }
            }
        }
    } catch (e) {
        showErr(e.message);
    }
}

// Mirror of the server's delete guard (bookings.php 'delete'): a booking that
// has taken money — any rental payment recorded, or a live card hold / charged
// damage deposit — must go through Cancel & refund, never Delete.
function bookingHasMoney(b) {
    return (
        !!b &&
        ((parseFloat(b.depositPaid) || 0) > 0.001 ||
            ['authorized', 'charged', 'captured'].includes(b.holdStatus || 'none'))
    );
}
async function deleteBooking(bookingId) {
    const b = findBookingById(bookingId);
    if (!b) return;
    // The hub only shows Delete on money-free bookings; this guard covers every
    // other path with the same rule (the server enforces it regardless).
    if (bookingHasMoney(b)) {
        glassAlert(
            'This booking has taken money — use “Cancel & refund” instead, which refunds the guest and lets them know. Delete is only for junk/test rows.',
        );
        return;
    }
    if (!(await glassConfirm('Delete this booking permanently?'))) return;
    try {
        await apiPost('bookings.php', { action: 'delete', id: b.dbId });
        await loadData();
        renderCalendar();
        clearDetails();
        showChangeoverToasts();
        toast('Booking deleted.');
        // If we were ON the deleted booking's hub screen, it no longer exists —
        // and on the bookings dashboard, refresh the index + docked pane.
        const hub = document.getElementById('view-booking-hub');
        if (hub && hub.classList.contains('active')) window.openBookings();
        const bkView = document.getElementById('view-backoffice');
        if (bkView && bkView.classList.contains('active')) {
            try {
                window.renderBookings();
            } catch (e) {}
        }
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
            msg.style.color = ok ? 'var(--ok)' : 'var(--danger)';
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

// ⬇️ BUILD STAMP — keep this as the LAST statement in the script.
// It only runs if the whole file loaded, so if a truncated upload cuts
// the file short, the footer keeps showing "—" instead of this number.
// Bump the value whenever a new version is shipped.
(function () {
    const BUILD = 'payunify1';
    window.__BUILD = BUILD; // exposed so the version watcher can detect new releases
    const el = document.getElementById('build-stamp');
    if (el) el.textContent = BUILD;
    const yr = document.getElementById('footer-year');
    if (yr) yr.textContent = new Date().getFullYear();
})();
