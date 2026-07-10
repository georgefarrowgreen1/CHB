// ============================================================
// admin.js — the owner back office, split out of app.js so public visitors
// never download it. Loaded on demand by loadAdminBundle() in app.js.
// All declarations are classic-script globals, exactly as they were in
// app.js; the footer publishes the stub targets onto window.
// ============================================================


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

// Open the Settings & Fees page (admin only)
let adminPrivateContent = {}; // includes arrival-* keys (admin-only)
async function openSettings(section) {
    // The health / cron pills live on this page now — refresh them on open
    // (both are cached + best-effort, so this is cheap and never blocks).
    try {
        checkCronHealth();
    } catch (e) {}
    try {
        checkSystemHealth();
    } catch (e) {}
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

// ---- Back-office MANAGE: the admin sections hub (view-settings) is ONE index
// now — cottages, then marketing, then account/system, with the section labels
// as the grouping. openArea() survives as a compat alias (dock, tests, old
// history entries); the section panels (#sec-…) and settingsOpen() router are
// unchanged. ----
async function openArea() {
    if (!isAuthenticated) {
        tryAccessBackOffice();
        return;
    }
    await openSettings(); // opens view-settings + shows the index
    // Drop any leftover search text so the index opens unfiltered.
    const sBox = document.getElementById('settings-search');
    if (sBox) sBox.value = '';
    applyAreaFilter();
}
// Show the full Manage index (all groups) + set the header; called on open and
// on returning from a drill-down panel. The per-area hiding is gone — the name
// stays because every open/return path calls through here.
function applyAreaFilter() {
    const idx = document.getElementById('settings-index');
    if (!idx) return;
    idx.querySelectorAll('.settings-group, .settings-section-label, .area-overview').forEach((el) => {
        if (el.id === 'testcentre-row') return; // staging-only; JS controls its display
        el.style.display = '';
    });
    // Lead each family with its key numbers (the "important parts first" overviews).
    try {
        renderCottagesOverview();
        renderMarketingOverview();
    } catch (e) {}
    const h = document.querySelector('#view-settings .dashboard-header h1');
    const p = document.querySelector('#view-settings .dashboard-header .lead');
    if (h) h.textContent = 'Manage';
    if (p) p.textContent = 'Cottages, marketing, account and system';
    const s = document.getElementById('settings-search');
    if (s) s.placeholder = 'Search cottages, marketing & settings…';
}

// ---- Area overviews: lead each area with its key numbers (iOS-Settings style —
// the important parts first, then the detail sub-folders below). ----
function renderCottagesOverview() {
    const el = document.getElementById('cottages-overview');
    if (!el) return;
    const keys = typeof liveCottageKeys === 'function' ? liveCottageKeys() : [];
    if (!keys.length) {
        el.innerHTML = '';
        return;
    }
    let occ = {};
    try {
        occ = cottageMonthOccupancy();
    } catch (e) {}
    const monthName = new Date().toLocaleDateString('en-GB', { month: 'long' });
    const card = (k) => {
        const meta = propertyMeta[k] || {};
        const r = propertyRates[k] || defaultRates[k] || {};
        const pct = (occ[k] && occ[k].pct) || 0;
        const accent = meta.accent || 'var(--accent)';
        // Stacked layout: name, then price, then occupancy — nothing sits on one
        // squeezed row, so a long cottage name can't push the price off the card.
        return `<button class="glass-panel area-ov-card" onclick="settingsOpen('accom')" style="text-align:left;padding:15px 16px;cursor:pointer;">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
                <span style="font-weight:600;line-height:1.25;">${escapeHtml(meta.name || k)}</span>
                <span class="settings-row-chev" style="flex-shrink:0;">›</span>
            </div>
            <div style="font-size:0.78rem;color:var(--text-muted);margin-top:3px;">from £${Math.round(r.coupleRate || 0)}/night</div>
            <div style="font-size:0.8rem;color:var(--text-muted);margin-top:10px;">${pct}% booked in ${monthName}</div>
            <div style="height:6px;border-radius:999px;background:rgba(128,128,128,0.18);margin-top:8px;overflow:hidden;"><div style="height:100%;width:${pct}%;background:${accent};border-radius:999px;"></div></div>
        </button>`;
    };
    el.innerHTML =
        `<div class="settings-section-label" style="display:block;">This month</div>
         <div class="area-ov-grid">${keys.map(card).join('')}</div>`;
}
async function renderMarketingOverview() {
    const el = document.getElementById('marketing-overview');
    if (!el) return;
    const tiles = [
        ['approvals', 'Awaiting approval'],
        ['subs', 'Subscribers'],
        ['wait', 'On the waitlist'],
    ];
    el.innerHTML =
        `<div class="settings-section-label" style="display:block;">Marketing at a glance</div>
         <div class="area-ov-grid">${tiles
             .map(
                 ([id, label]) =>
                     `<div class="glass-panel" style="padding:15px 16px;"><div id="mkt-ov-${id}" style="font-family:var(--font-serif);font-size:1.6rem;line-height:1;">…</div><div style="font-size:0.74rem;color:var(--text-muted);margin-top:6px;">${label}</div></div>`,
             )
             .join('')}</div>`;
    const set = (id, v) => {
        const e = document.getElementById('mkt-ov-' + id);
        if (e) e.textContent = v;
    };
    try {
        const a = await apiPost('reviews.php', { action: 'list_admin' });
        const b = await apiPost('photos.php', { action: 'list_admin' });
        const rev = (a.reviews || []).filter((x) => x.status === 'pending').length;
        const ph = (b.photos || []).filter((x) => x.status === 'pending').length;
        set('approvals', rev + ph);
    } catch (e) {
        set('approvals', '—');
    }
    try {
        const r = await apiGet('newsletter.php');
        // newsletter.php returns {active,total,recent} — use the active count.
        set('subs', r.active != null ? r.active : r.total != null ? r.total : '—');
    } catch (e) {
        set('subs', '—');
    }
    try {
        const r = await apiPost('waitlist.php', { action: 'list' });
        set('wait', (r.waitlist || []).length);
    } catch (e) {
        set('wait', '—');
    }
}

// ---- Inbox: a dedicated back-office screen combining enquiries, guest messages
// and things awaiting approval (was buried as two rows under Settings). ----
async function openInbox() {
    if (!isAuthenticated) {
        tryAccessBackOffice();
        return;
    }
    nav('view-inbox'); // nav() calls renderInboxScreen() for us
    adminHistPush('view-inbox');
}
// Chat automation drill-downs (instant answers / away reply) live in their own
// sub-folders off the Inbox rather than sprawling down the messages tab.
const INBOX_SUBS = { answers: 'inbox-sub-answers', away: 'inbox-sub-away', enq: 'inbox-sub-enq' };
function inboxSub(which) {
    __inboxSubStamp++;
    adminHistPush('view-inbox', null, { inboxSub: which });
    const main = document.getElementById('inbox-main');
    if (main) main.style.display = 'none';
    const pane = document.getElementById('inbox-detail-pane');
    if (pane) pane.style.display = 'none';
    Object.entries(INBOX_SUBS).forEach(([key, id]) => {
        const el = document.getElementById(id);
        if (el) el.style.display = key === which ? '' : 'none';
    });
    try {
        if (which === 'answers') renderChatAnswersEditor();
        else if (which === 'away') renderChatAwayEditor();
        // 'enq' is static toggles — their checked state is set by renderInbox().
    } catch (e) {}
    window.scrollTo({ top: 0, behavior: 'smooth' });
}
function inboxSubClose() {
    Object.values(INBOX_SUBS).forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });
    const pane = document.getElementById('inbox-detail-pane');
    if (pane) pane.style.display = '';
    const main = document.getElementById('inbox-main');
    if (main) main.style.display = '';
    window.scrollTo({ top: 0, behavior: 'smooth' });
}
// ---- Inbox folders: the Inbox is ONE comms dashboard — website enquiries,
// guest chat and the cottage EMAIL mailbox behind a segmented folder switch.
// State survives leaving the view (display toggles persist in the DOM), so the
// owner comes back to the folder they were in. ----
let __inboxFolder = 'enquiries';
let __mbxOpenedOnce = false;
function inboxFolder(which) {
    if (!['enquiries', 'messages', 'email'].includes(which)) which = 'enquiries';
    __inboxFolder = which;
    document.querySelectorAll('#inbox-folders [data-ifolder]').forEach((b) => {
        const on = b.dataset.ifolder === which;
        b.classList.toggle('is-on', on);
        b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    ['enquiries', 'messages', 'email'].forEach((f) => {
        const el = document.getElementById('inbox-folder-' + f);
        if (el) el.style.display = f === which ? '' : 'none';
    });
    // The docked enquiry pane belongs to the Enquiries folder only — on the
    // other folders the list takes the full width (CSS hides it via no-pane).
    const split = document.querySelector('#view-inbox .enq-split');
    if (split) split.classList.toggle('no-pane', which !== 'enquiries');
    // The mailbox is lazy: first open fetches, after that the rendered list
    // stays live in the DOM and the Refresh button re-pulls on demand.
    if (which === 'email' && !__mbxOpenedOnce) {
        __mbxOpenedOnce = true;
        loadMailbox();
    }
}

// ---- Bookings: a browsable list of every confirmed booking (dock → Bookings) ----
let __bookingsFilter = 'upcoming';
let __bookingsSearch = '';
// Per-booking email history, keyed by booking dbId → [{action,summary,at}].
let bookingEmailLogs = {};
async function loadBookingEmailLogs() {
    try {
        const r = await apiPost('bookings.php', { action: 'email_logs' });
        bookingEmailLogs = r && r.logs ? r.logs : {};
    } catch (e) {
        bookingEmailLogs = {};
    }
}
async function openBookings() {
    if (!isAuthenticated) {
        tryAccessBackOffice();
        return;
    }
    // The Bookings page merged into the Today dashboard: land there, render
    // the workspace, and scroll to it (past the timeline) so "open bookings"
    // still means "show me the list".
    try {
        if (!Object.keys(dbBookings).some((k) => (dbBookings[k] || []).length)) await loadData();
    } catch (e) {}
    nav('view-backoffice');
    adminHistPush('view-backoffice');
    try {
        renderCalendar();
    } catch (e) {}
    renderBookings();
    const ws = document.getElementById('bookings-workspace');
    if (ws) ws.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
// Friendly label for a logged email action.
function emailLogLabel(action) {
    return (
        {
            'email.confirmation': 'Booking confirmation',
            'email.receipt': 'Payment receipt',
            'email.arrival': 'Arrival info',
            'booking.email': 'Message',
            'payment.request': 'Payment request',
            'email.review': 'Review request',
            'email.anniversary': 'Return invite',
        }[action] || 'Email'
    );
}
// 'YYYY-MM-DD HH:MM:SS' → 'D Mon YYYY · HH:MM'.
function fmtLogWhen(at) {
    if (!at) return '';
    const m = String(at).match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
    if (!m) return String(at);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${parseInt(m[3], 10)} ${months[parseInt(m[2], 10) - 1]} ${m[1]} · ${m[4]}:${m[5]}`;
}
function bookingsSetFilter(f) {
    __bookingsFilter = f;
    document
        .querySelectorAll('#bookings-filters [data-bfilter]')
        .forEach((b) => b.classList.toggle('is-on', b.getAttribute('data-bfilter') === f));
    renderBookings();
}
function bookingsSetSearch(v) {
    __bookingsSearch = String(v || '')
        .trim()
        .toLowerCase();
    renderBookings();
}
function renderBookings() {
    const list = document.getElementById('bookings-list');
    if (!list) return;
    const today = todayDashed();
    let rows = [];
    Object.keys(dbBookings).forEach((propKey) => {
        (dbBookings[propKey] || []).forEach((b) => rows.push({ propKey, b }));
    });
    const q = __bookingsSearch;
    if (q) {
        rows = rows.filter(({ b }) => {
            const ref = (typeof bookingRef === 'function' ? bookingRef(b.id) : '').toLowerCase();
            return (
                (b.name || '').toLowerCase().includes(q) ||
                (b.email || '').toLowerCase().includes(q) ||
                ref.includes(q) ||
                ref.replace('chb-', '').includes(q)
            );
        });
    }
    const f = __bookingsFilter;
    rows = rows.filter(({ propKey, b }) => {
        if (f === 'upcoming') return (b.checkOut || '') >= today;
        if (f === 'past') return (b.checkOut || '') < today;
        if (f === 'needspay') return !paymentSummary(propKey, b).fullyPaid && (b.checkOut || '') >= today;
        return true; // 'all'
    });
    rows.sort((a, b) =>
        f === 'past'
            ? (b.b.checkIn || '').localeCompare(a.b.checkIn || '')
            : (a.b.checkIn || '').localeCompare(b.b.checkIn || ''),
    );
    const sum = document.getElementById('bookings-summary');
    if (sum) {
        const label =
            { upcoming: 'upcoming', past: 'past', needspay: 'needing payment', all: 'in total' }[f] || '';
        sum.textContent = rows.length ? `${rows.length} booking${rows.length === 1 ? '' : 's'} ${label}` : '';
    }
    if (!rows.length) {
        list.innerHTML =
            `<div class="bo-search-empty" style="padding:24px 0;color:var(--text-muted);">No bookings ${q ? 'match your search' : 'to show here'}.</div>`;
        // A selection whose booking no longer exists must not linger in the pane.
        if (__hubBookingId && !findBookingById(__hubBookingId)) {
            __hubBookingId = null;
            const bhc = document.getElementById('booking-hub-content');
            if (bhc) bhc.innerHTML = '';
        }
        if (bookingsSplitWide()) markBookingsSelection();
        return;
    }
    list.innerHTML = rows.map(({ propKey, b }) => bookingListRow(propKey, b, today)).join('');
    // Wide split: keep the docked pane in sync — drop a selection whose booking
    // is gone, and open the first listed booking when nothing is selected yet
    // so the dashboard never sits with an empty pane.
    if (bookingsSplitWide()) {
        if (__hubBookingId && !findBookingById(__hubBookingId)) __hubBookingId = null;
        if (!__hubBookingId) {
            openBookingHub(rows[0].b.id, true); // quiet: no scroll on auto-select
            return;
        }
        markBookingsSelection();
    }
}
// '2026-08-27','2026-08-30' → '27–30 Aug 2026' (human, and short enough that
// the index rows never wrap mid-date).
function fmtStayRange(ci, co) {
    const parse = (s) => {
        const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
        return m ? { y: +m[1], mo: +m[2], d: +m[3] } : null;
    };
    const a = parse(ci),
        b = parse(co);
    if (!a || !b) return `${ci} → ${co}`;
    const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    if (a.y === b.y && a.mo === b.mo) return `${a.d}–${b.d} ${M[a.mo - 1]} ${a.y}`;
    if (a.y === b.y) return `${a.d} ${M[a.mo - 1]} – ${b.d} ${M[b.mo - 1]} ${a.y}`;
    return `${a.d} ${M[a.mo - 1]} ${a.y} – ${b.d} ${M[b.mo - 1]} ${b.y}`;
}
// Compact tappable index row — who / where / when / money state, in a fixed
// three-line anatomy (tag + status chip · name · dates) so every row is the
// SAME shape with nothing wrapping oddly. Everything else (actions, email
// log, ledger, history) lives on the booking hub, which the whole row opens.
function bookingListRow(propKey, b, today) {
    const meta = propertyMeta[propKey] || { name: propKey };
    const p =
        b.agreedPrice || priceBreakdown(propKey, b.adults || 0, b.children || 0, b.checkIn, b.checkOut);
    const ps = paymentSummary(propKey, b);
    const gt = displayGrand(p, ps, b.holdStatus);
    const payLabel = gt.fullyPaid ? 'Paid' : gt.paid > 0 ? 'Part-paid' : 'Unpaid';
    const payClass = gt.fullyPaid ? 'ok' : gt.paid > 0 ? 'warn' : 'danger';
    const past = (b.checkOut || '') < today;
    const balanceBit = !gt.fullyPaid ? ` · ${gbp(gt.balance)} due` : '';
    // Traffic-light edge on every row: red unpaid · amber part-paid · green paid.
    return `
        <button type="button" class="bk-row glass-panel pay-${payClass}${b.id === __hubBookingId ? ' is-open' : ''}" data-bkid="${b.id}" onclick="openBookingHub('${b.id}')">
            <span class="bk-row-body">
                <span class="bk-row-top">
                    <span class="prop-tag tag-${propKey}">${escapeHtml(meta.name)}</span>
                    <span class="bk-chip ${payClass}"><span class="bk-dot"></span>${payLabel}${balanceBit}</span>
                </span>
                <strong class="bk-row-name">${escapeHtml(b.name || 'Guest')}</strong>
                <span class="bk-row-dates">${fmtStayRange(b.checkIn, b.checkOut)} · ${escapeHtml(b.guests || (b.adults || 0) + ' adults')}${past ? ' · past' : ''}</span>
            </span>
            <span class="bk-row-arrow" aria-hidden="true">›</span>
        </button>`;
}
// Wide-screen master–detail: is the docked hub pane in play?
function bookingsSplitWide() {
    return !!(document.getElementById('bookings-detail-pane') && window.matchMedia('(min-width: 1200px)').matches);
}
// Highlight the open booking's row + toggle the pane's empty state.
// Crossing the 1200px master–detail boundary while a hub is open used to
// strand it: shrinking hid the docked pane (detail vanished), growing left the
// standalone hub undocked. Re-invoking the open fn re-parents the shared
// content node to the right home for the new width in both directions.
try {
    const tlMq = window.matchMedia('(min-width: 1200px)');
    const onSplitChange = () => {
        const active = (document.querySelector('.page-view.active') || {}).id;
        try {
            if (active === 'view-backoffice' || active === 'view-booking-hub') {
                if (__hubBookingId && findBookingById(__hubBookingId)) openBookingHub(__hubBookingId);
            } else if (active === 'view-inbox' || active === 'view-enquiry-hub') {
                if (__enqHubId && enquiries.find((x) => x.id === __enqHubId)) openEnquiryHub(__enqHubId);
            }
        } catch (e) {}
    };
    if (tlMq.addEventListener) tlMq.addEventListener('change', onSplitChange);
    else if (tlMq.addListener) tlMq.addListener(onSplitChange);
} catch (e) {}
function markBookingsSelection() {
    document
        .querySelectorAll('#bookings-list .bk-row')
        .forEach((r) => r.classList.toggle('is-open', r.getAttribute('data-bkid') === __hubBookingId));
    const empty = document.getElementById('bookings-detail-empty');
    const pane = document.getElementById('bookings-detail-pane');
    const content = document.getElementById('booking-hub-content');
    // A booking is selected but its hub is still parented in the standalone
    // view (the window grew since it was opened there) — dock + re-render so
    // the wide dashboard's pane is never empty.
    if (bookingsSplitWide() && __hubBookingId && pane && content && content.parentElement !== pane) {
        pane.appendChild(content);
        renderBookingHub();
    }
    if (empty && pane) empty.style.display = __hubBookingId && content && content.parentElement === pane ? 'none' : '';
}
// The "Emails sent" history block shown under a booking on the Bookings page.
// Templated emails whose content can be regenerated for preview (server
// email_preview action). Free-text "Message" logs already show inline.
const EMAIL_PREVIEWABLE = ['email.confirmation', 'email.arrival', 'payment.request'];
// Fetch a faithful regeneration of a templated email and show it.
async function openEmailPreview(bookingDbId, kind, btn) {
    const original = btn ? btn.textContent : '';
    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Loading…';
    }
    try {
        const r = await apiPost('bookings.php', { action: 'email_preview', id: bookingDbId, kind });
        if (!r || !r.ok) throw new Error((r && r.error) || 'No preview available.');
        showEmailPreview(r.subject || '(no subject)', r.html || '', r.text || '');
    } catch (e) {
        glassAlert("Couldn't load the email: " + e.message);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.textContent = original;
        }
    }
}
// Render an email's HTML inside a sandboxed iframe (isolates its styles from the
// app and blocks any script), with the subject shown above it.
function showEmailPreview(subject, html, text) {
    let ov = document.getElementById('email-preview-overlay');
    if (!ov) {
        ov = document.createElement('div');
        ov.id = 'email-preview-overlay';
        ov.className = 'modal-overlay';
        ov.innerHTML = `<div class="modal-box email-preview-box">
                <button class="modal-x" type="button" aria-label="Close" onclick="closeEmailPreview()">×</button>
                <div class="email-preview-subject" id="email-preview-subject"></div>
                <iframe id="email-preview-frame" class="email-preview-frame" title="Email preview" sandbox=""></iframe>
            </div>`;
        document.body.appendChild(ov);
        ov.addEventListener('click', (e) => {
            if (e.target === ov) closeEmailPreview();
        });
    }
    document.getElementById('email-preview-subject').textContent = subject;
    const f = document.getElementById('email-preview-frame');
    f.srcdoc =
        html && html.trim()
            ? html
            : '<pre style="font:14px system-ui,sans-serif;white-space:pre-wrap;word-break:break-word;padding:16px;margin:0;">' +
              escapeHtml(text || '(empty)') +
              '</pre>';
    ov.classList.add('open');
    document.addEventListener('keydown', emailPreviewEsc);
}
function emailPreviewEsc(e) {
    if (e.key === 'Escape') closeEmailPreview();
}
function closeEmailPreview() {
    const ov = document.getElementById('email-preview-overlay');
    if (ov) ov.classList.remove('open');
    document.removeEventListener('keydown', emailPreviewEsc);
}

function bookingEmailLogHtml(b) {
    const logs = (bookingEmailLogs && bookingEmailLogs[b.dbId]) || [];
    if (!logs.length) {
        return `<div class="bk-email-log"><span class="bk-email-log-title">Emails sent</span><span class="bk-email-log-empty">None yet</span></div>`;
    }
    const icon =
        '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M4 6.5l8 6 8-6"/></svg>';
    const rows = logs
        .map((l) => {
            const what = `<span class="bk-email-log-what">${icon}${escapeHtml(emailLogLabel(l.action))}</span>`;
            const when = `<span class="bk-email-log-when">${escapeHtml(fmtLogWhen(l.at))}</span>`;
            // A free-text message carries a body → make it expandable to read it.
            if (l.body) {
                const subj = l.subject
                    ? `<div class="bk-email-log-subj">${escapeHtml(l.subject)}</div>`
                    : '';
                const body = `<div class="bk-email-log-msg">${escapeHtml(l.body).replace(/\n/g, '<br>')}</div>`;
                return `<details class="bk-email-log-item"><summary class="bk-email-log-row">${what}<span class="bk-email-log-right">${when}<span class="bk-email-log-toggle"></span></span></summary>${subj}${body}</details>`;
            }
            // Templated emails store no body, but we can regenerate them on demand
            // — offer a "Show email" button that opens a faithful preview.
            if (EMAIL_PREVIEWABLE.includes(l.action)) {
                return `<div class="bk-email-log-row">${what}<span class="bk-email-log-right">${when}<button type="button" class="bk-email-log-view" onclick="openEmailPreview(${b.dbId},'${l.action}',this)">Show email</button></span></div>`;
            }
            return `<div class="bk-email-log-row">${what}${when}</div>`;
        })
        .join('');
    return `<div class="bk-email-log"><span class="bk-email-log-title">Emails sent (${logs.length})</span>${rows}</div>`;
}

// ==================================================================
//  BOOKING HUB — ONE screen per booking (view-booking-hub).
//  Everything about a single booking in one place: a status pipeline with
//  the next action surfaced, the money (price, received, ledger, actions),
//  the full email history, the guest's other stays + private notes, and the
//  booking's change history from the activity log. Every calendar day, list
//  row and search hit routes here (app.js showDetails → openBookingHub).
// ==================================================================
let __hubBookingId = null;
let __hubReturnView = 'view-backoffice';

async function openBookingHub(bookingId, quiet) {
    if (!isAuthenticated) {
        tryAccessBackOffice();
        return;
    }
    let b = findBookingById(bookingId);
    if (!b) {
        try {
            await loadData();
        } catch (e) {}
        b = findBookingById(bookingId);
    }
    if (!b) {
        toast('That booking is no longer here.', 'error');
        window.openBookings();
        return;
    }
    const prev = document.querySelector('.page-view.active');
    const alreadyHere = prev && prev.id === 'view-booking-hub' && __hubBookingId === bookingId;
    if (prev && prev.id !== 'view-booking-hub') __hubReturnView = prev.id;
    __hubBookingId = bookingId;
    const content = document.getElementById('booking-hub-content');
    if (bookingsSplitWide()) {
        // Master–detail: dock the hub beside the bookings index (the shared
        // #booking-hub-content node re-parents into the pane) — no page swap.
        const pane = document.getElementById('bookings-detail-pane');
        if (content && content.parentElement !== pane) pane.appendChild(content);
        if (!prev || prev.id !== 'view-backoffice') {
            nav('view-backoffice');
            adminHistPush('view-backoffice');
            try {
                renderCalendar();
            } catch (e) {}
            renderBookings(); // renders the index; the selection highlights itself
        } else {
            markBookingsSelection();
        }
        // A tap can come from the timeline at the top of the page (or from
        // Money/Inbox) — bring the docked hub into view so the action visibly
        // lands somewhere. `quiet` = the dashboard's own auto-select, which
        // must never yank the owner down the page.
        if (pane && !quiet) pane.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } else {
        const home = document.getElementById('view-booking-hub');
        if (content && home && content.parentElement !== home) home.appendChild(content);
        nav('view-booking-hub');
        if (!alreadyHere) adminHistPush('view-booking-hub', null, { hubBooking: bookingId });
        window.scrollTo({ top: 0 });
    }
    renderBookingHub();

    // Async enrichments — each fills its own card when it lands (guarded so a
    // slow response never paints over a different booking's hub).
    const dbId = b.dbId;
    loadBookingEmailLogs()
        .then(() => {
            const elog = document.getElementById('hub-email-log');
            const fresh = findBookingById(bookingId);
            if (elog && fresh && __hubBookingId === bookingId) elog.innerHTML = bookingEmailLogHtml(fresh);
        })
        .catch(() => {});
    apiPost('bookings.php', { action: 'history', id: dbId })
        .then((r) => {
            const el = document.getElementById('hub-history');
            if (!el || __hubBookingId !== bookingId) return;
            const evs = (r && r.events) || [];
            el.innerHTML = evs.length
                ? evs
                      .map(
                          (e) =>
                              `<div class="bhub-hist-row"><span class="bhub-hist-when">${escapeHtml(fmtLogWhen(e.at))}</span><span class="bhub-hist-what">${escapeHtml(e.summary || e.action || '')}</span><span class="bhub-hist-actor">${escapeHtml(e.actor || '')}</span></div>`,
                      )
                      .join('')
                : '<div class="bhub-empty">Nothing recorded yet — edits, payments and emails will appear here.</div>';
        })
        .catch(() => {
            const el = document.getElementById('hub-history');
            if (el && __hubBookingId === bookingId) el.innerHTML = '<div class="bhub-empty">Couldn’t load the history.</div>';
        });
    if (squareAdminEnabled && b.email) {
        try {
            loadBookingPayments(b.id);
        } catch (e) {}
    }
}

function bookingHubBack() {
    const back = __hubReturnView && document.getElementById(__hubReturnView) ? __hubReturnView : 'view-backoffice';
    if (back === 'view-accounts') {
        openAccounts();
        return;
    }
    if (back === 'view-backoffice') {
        nav('view-backoffice');
        Promise.resolve(initBackOffice()).catch(() => {});
        return;
    }
    if (back === 'view-inbox') {
        openInbox();
        return;
    }
    window.openBookings();
}

// The stage strip + the single next action for a booking's current state.
function hubPipelineHtml(propKey, b, gt, dh) {
    const today = todayDashed();
    const past = (b.checkOut || '') <= today;
    const inStay = !past && (b.checkIn || '') <= today;
    const hasDamage =
        dh.collected > 0 || gt.dep > 0 || ['authorized', 'captured', 'charged', 'returned', 'kept'].includes(b.holdStatus || 'none');
    const stages = [
        { label: 'Booked', done: true },
        { label: 'Deposit', done: gt.paid > 0 },
        { label: 'Paid in full', done: gt.fullyPaid },
        { label: 'Arrival info', done: !!b.preArrivalSent },
        { label: past ? 'Stayed' : 'Stay', done: past, now: inStay },
    ];
    if (hasDamage) {
        stages.push({
            label: 'Deposit back',
            done: ['returned', 'kept'].includes(b.holdStatus || '') || (dh.collected > 0 && dh.held <= 0.001),
        });
    }
    // A dynamic three-pill window — where this booking has been, where it IS,
    // and what comes next — instead of the whole journey squeezed into one
    // strip (which needed swiping on phones and buried the current stage).
    const pill = (s, cls) => `<span class="pipe-step ${cls}"><span class="pipe-dot"></span>${escapeHtml(s.label)}</span>`;
    const col = (cap, inner) => `<div class="pipe3-col"><span class="pipe3-cap">${cap}</span>${inner}</div>`;
    const arrow = '<span class="pipe3-arrow" aria-hidden="true">›</span>';
    const curIdx = stages.findIndex((s) => !s.done);
    let strip;
    if (curIdx === -1) {
        // Journey complete — the last stage says so.
        strip = col('All done', pill(stages[stages.length - 1], 'is-done'));
    } else {
        const parts = [col('Done', pill(stages[curIdx - 1], 'is-done')), arrow, col(`Now · ${curIdx + 1} of ${stages.length}`, pill(stages[curIdx], 'is-now'))];
        if (stages[curIdx + 1]) parts.push(arrow, col('Next', pill(stages[curIdx + 1], '')));
        strip = parts.join('');
    }

    // ONE next action, derived from state — the answer to "what does this
    // booking need from me?" without reading the whole screen.
    let next = null; // { text, onclick, btn }
    if (!gt.fullyPaid && !past) {
        const canCard = squareAdminEnabled && b.email;
        if (!(gt.paid > 0)) {
            next = {
                text: `Nothing received yet — ${gbp(gt.balance)} due.`,
                onclick: canCard ? `requestPayment('${b.id}','deposit')` : `recordPayment('${b.id}')`,
                btn: canCard ? 'Email a secure card link' : 'Record a payment',
            };
        } else {
            next = {
                text: `${gbp(gt.balance)} balance remaining.`,
                onclick: canCard ? `requestPayment('${b.id}','balance')` : `recordPayment('${b.id}')`,
                btn: canCard ? 'Request the balance by card' : 'Record a payment',
            };
        }
    } else if (!past && !b.preArrivalSent && b.email) {
        next = {
            text: 'Paid up — the arrival info (directions, key code) hasn’t gone out yet.',
            onclick: `sendArrivalInfo('${b.id}')`,
            btn: 'Send arrival info',
        };
    } else if (past && dh.held > 0.001) {
        next = {
            text: `The stay is over and ${gbp(dh.held)} refundable damage deposit is still held.`,
            onclick: `returnDeposit('${b.id}')`,
            btn: 'Return the deposit',
        };
    }
    const nextHtml = next
        ? `<div class="bhub-next"><span class="bhub-next-text">${next.text}</span><button class="btn-glass bhub-next-btn" onclick="${next.onclick}">${next.btn}</button></div>`
        : `<div class="bhub-next is-clear"><span class="bhub-next-text">All set — nothing needs doing on this booking right now.</span></div>`;
    return `<div class="bhub-pipe3">${strip}</div>${nextHtml}`;
}

function renderBookingHub() {
    const el = document.getElementById('booking-hub-content');
    if (!el) return;
    const b = findBookingById(__hubBookingId);
    if (!b) {
        el.innerHTML = '<div class="bhub-empty" style="margin-top:30px;">This booking is no longer here.</div>';
        return;
    }
    const loc = findBookingLocation(__hubBookingId);
    const propKey = loc ? loc.propKey : activeFrontProperty;
    const meta = propertyMeta[propKey] || { name: propKey };
    const fin = (n) => typeof n === 'number' && isFinite(n);
    let p = b.agreedPrice || null;
    if (!p) {
        try {
            p = priceBreakdown(propKey, b.adults || 0, b.children || 0, b.checkIn, b.checkOut);
        } catch (e) {}
    }
    if (!p || !fin(p.total)) p = { total: 0, perNight: 0, nights: 0, nightly: 0, damagesDeposit: 0, transactionPct: 0, txFee: 0 };
    const ps = paymentSummary(propKey, b);
    const gt = displayGrand(p, ps, b.holdStatus || 'none');
    const dh = damageHeld(propKey, b);
    const today = todayDashed();
    const past = (b.checkOut || '') <= today;
    const nights = fin(p.nights) && p.nights > 0 ? p.nights : Math.max(1, Math.round((new Date(b.checkOut) - new Date(b.checkIn)) / 864e5));
    const ref = typeof bookingRef === 'function' ? bookingRef(b.id) : '';

    // Same-day changeover companions, DERIVED from the data (not from how the
    // hub was opened) — another booking in this cottage arriving the day this
    // one leaves, or leaving the day this one arrives.
    let changeover = '';
    (dbBookings[propKey] || []).forEach((o) => {
        if (o.id === b.id) return;
        if (o.checkIn === b.checkOut)
            changeover += `<button class="bk-chip warn bhub-changeover" onclick="openBookingHub('${o.id}')" title="Open the other side of this changeover"><span class="bk-dot"></span>Same-day changeover — ${escapeHtml(o.name || 'the next guest')} arrives as this guest leaves →</button>`;
        else if (o.checkOut === b.checkIn)
            changeover += `<button class="bk-chip warn bhub-changeover" onclick="openBookingHub('${o.id}')" title="Open the other side of this changeover"><span class="bk-dot"></span>Same-day changeover — ${escapeHtml(o.name || 'the previous guest')} leaves as this guest arrives →</button>`;
    });

    // ---- Header ----
    const header = `
        <div class="bhub-head glass-panel">
            <div class="bhub-head-top">
                <div>
                    <span class="prop-tag tag-${propKey}">${escapeHtml(meta.name)}</span>
                    ${ref ? `<span class="bhub-ref">${escapeHtml(ref)}</span>` : ''}
                    <h1 class="bhub-name">${escapeHtml(b.name || 'Guest')}</h1>
                    <div class="bhub-sub">${fmtDate(b.checkIn)}${b.checkInTime ? ' · ' + b.checkInTime : ''} → ${fmtDate(b.checkOut)}${b.checkOutTime ? ' · ' + b.checkOutTime : ''} · ${nights} night${nights === 1 ? '' : 's'} · ${escapeHtml(b.guests || '')}${past ? ' · past stay' : ''}</div>
                    ${changeover}
                </div>
                <div class="bhub-actions">
                    <button class="btn-sm btn-edit" onclick="openEditBooking('${b.id}')">Edit / Move</button>
                    <button class="btn-sm btn-edit" onclick="addBookingToCalendar('${b.id}')">Add to calendar</button>
                    <button class="btn-sm btn-decline" onclick="cancelBooking('${b.id}')">Cancel &amp; refund</button>
                    ${
                        // Delete exists ONLY while no money is on the booking (same
                        // rule the server enforces): once anything has been paid or
                        // a card hold is live, Cancel & refund is the only way out.
                        bookingHasMoney(b)
                            ? ''
                            : `<button class="btn-sm btn-decline" style="opacity:.8;" onclick="deleteBooking('${b.id}')" title="Only for junk/test rows — cancelling is the right way to end a real booking">Delete</button>`
                    }
                </div>
            </div>
            ${hubPipelineHtml(propKey, b, gt, dh)}
        </div>`;

    // ---- Money card ----
    const agreedNote = b.agreedPrice
        ? `<div class="bhub-mut">Agreed price${b.agreedPrice.isOverride ? ' (custom)' : ''}${b.agreedPrice.agreedOn ? ' · ' + b.agreedPrice.agreedOn : ''} — locked at the rates in effect when booked.</div>`
        : '';
    const breakdownRows =
        fin(p.perNight) && fin(p.nightly) && p.nights > 0
            ? `<div class="price-row"><span>${gbp(p.perNight)} × ${p.nights} night${p.nights === 1 ? '' : 's'}</span><span>${gbp(p.nightly)}</span></div>
               <div class="price-row"><span>Transaction fee (${fin(p.transactionPct) ? p.transactionPct : 0}%)</span><span>${gbp(fin(p.txFee) ? p.txFee : 0)}</span></div>`
            : '';
    const priceBox = `
        <div class="price-box" style="margin-bottom:0;">
            ${breakdownRows}
            ${gt.dep > 0 ? `<div class="price-row"><span>Refundable damages deposit</span><span>${gbp(gt.dep)}</span></div>` : ''}
            <div class="price-row total"><span>Total${gt.dep > 0 ? ' (incl. deposit)' : ''}</span><span class="price-amount">${gbp(gt.total)}</span></div>
            ${gt.paid > 0 ? `<div class="price-row" style="color:#4CAF50;"><span>Received</span><span>− ${gbp(gt.paid)}</span></div>` : ''}
            ${
                gt.fullyPaid
                    ? `<div class="price-row total" style="color:#4CAF50;"><span>Paid in full</span><span class="price-amount" style="color:#4CAF50;">✓</span></div>`
                    : `<div class="price-row total"><span>Balance due</span><span class="price-amount">${gbp(gt.balance)}</span></div>`
            }
        </div>${agreedNote}`;
    const depositLine =
        dh.collected > 0
            ? `<div class="money-deposit"><span>Refundable damage deposit: ${
                  dh.held > 0
                      ? `<strong>${gbp(dh.held)} collected</strong>${dh.returned > 0 ? ` · ${gbp(dh.returned)} returned` : ''}`
                      : `<span style="color:#4CAF50;">returned${dh.returned < dh.collected - 0.001 ? ` (${gbp(dh.collected - dh.returned)} retained)` : ''}</span>`
              }</span>${dh.held > 0 && past ? `<button class="btn-sm btn-edit" onclick="returnDeposit('${b.id}')">Return / settle</button>` : ''}</div>`
            : holdControls(b);
    const payHistory =
        squareAdminEnabled && b.email
            ? `<div id="sq-pay-${b.id}" class="sq-pay-history" style="margin-top:10px;font-size:0.82rem;color:var(--text-muted);">Loading payments…</div>`
            : '';
    const moneyCard = `
        <section class="bhub-card glass-panel">
            <h3 class="bhub-card-title">Money</h3>
            ${priceBox}
            ${depositLine}
            <div class="bhub-btn-row">
                ${!gt.fullyPaid ? `<button class="btn-sm btn-edit" onclick="recordPayment('${b.id}')">Record payment</button>` : ''}
                ${!gt.fullyPaid && squareAdminEnabled && b.email ? `<button class="btn-sm btn-edit" onclick="requestPayment('${b.id}','${gt.paid > 0 ? 'balance' : 'deposit'}')">Request ${gt.paid > 0 ? 'balance' : 'deposit'} by card</button>` : ''}
                ${!gt.fullyPaid && squareAdminEnabled && b.email ? `<button class="btn-sm btn-edit" onclick="copyPayLink('${b.id}','balance')">Copy pay link</button>` : ''}
                <button class="btn-sm btn-edit" onclick="downloadInvoice('${b.id}')">Invoice (PDF)</button>
            </div>
            ${payHistory}
        </section>`;

    // ---- Emails card ----
    const emailsCard = `
        <section class="bhub-card glass-panel">
            <h3 class="bhub-card-title">Emails</h3>
            ${
                b.email
                    ? `<div class="bhub-btn-row" style="margin-top:0;">
                        <button class="btn-sm btn-edit" onclick="sendConfirmationEmail('${b.id}')">Send confirmation</button>
                        <button class="btn-sm btn-edit" onclick="sendArrivalInfo('${b.id}')">Send arrival info${b.preArrivalSent ? ' (sent ✓)' : ''}</button>
                        ${gt.paid > 0 ? `<button class="btn-sm btn-edit" onclick="offerUpdatedConfirmationEmail('${b.id}')">Email updated confirmation</button>` : ''}
                        <button class="btn-sm btn-edit" onclick="openBookingEmail('${b.id}')">Write an email</button>
                    </div>`
                    : '<div class="bhub-mut">No guest email on file — add one via Edit / Move to send anything.</div>'
            }
            <div id="hub-email-log"><div class="bhub-empty">Loading email history…</div></div>
        </section>`;

    // ---- Guest card (contact + notes + their other stays) ----
    const emailLower = (b.email || '').toLowerCase();
    const otherStays = [];
    if (emailLower) {
        Object.keys(dbBookings).forEach((pk) =>
            (dbBookings[pk] || []).forEach((x) => {
                if (x.id !== b.id && (x.email || '').toLowerCase() === emailLower) otherStays.push({ pk, x });
            }),
        );
        otherStays.sort((a, z) => (z.x.checkIn || '').localeCompare(a.x.checkIn || ''));
    }
    const staysHtml = otherStays.length
        ? `<div class="bhub-mut" style="margin-top:14px;">Also stayed (${otherStays.length}):</div>` +
          otherStays
              .slice(0, 6)
              .map(
                  ({ pk, x }) =>
                      `<button class="bhub-stay-row" onclick="openBookingHub('${x.id}')"><span class="prop-tag tag-${pk}">${escapeHtml((propertyMeta[pk] || { name: pk }).name)}</span><span>${fmtDate(x.checkIn)} → ${fmtDate(x.checkOut)}</span><span class="bhub-mut">open →</span></button>`,
              )
              .join('')
        : '';
    const contact = (label, val) =>
        `<div class="booking-detail-item"><span class="booking-detail-label">${label}</span><span class="booking-detail-value" style="font-size:0.95rem;">${val || '<span class="bhub-mut">—</span>'}</span></div>`;
    const guestCard = `
        <section class="bhub-card glass-panel">
            <h3 class="bhub-card-title">Guest</h3>
            <div class="detail-grid" style="margin-top:0;">
                ${contact('Email', b.email ? `<a href="mailto:${escapeHtml(b.email)}" style="color:var(--text-light);">${escapeHtml(b.email)}</a>` : '')}
                ${contact('Phone', b.phone ? `<a href="tel:${escapeHtml(b.phone)}" style="color:var(--text-light);">${escapeHtml(b.phone)}</a>` : '')}
                <div class="booking-detail-item" style="grid-column:1/-1;"><span class="booking-detail-label">Home address</span><span class="booking-detail-value" style="font-size:0.95rem;white-space:pre-wrap;">${b.address || b.postcode ? escapeHtml([b.address, b.postcode].filter(Boolean).join(', ')) : '<span class="bhub-mut">—</span>'}</span></div>
                ${contact('Terms', b.termsAcceptedAt ? 'Accepted ' + escapeHtml(b.termsAcceptedAt) + (b.termsVersion ? ' (v' + escapeHtml(b.termsVersion) + ')' : '') : 'Not recorded')}
            </div>
            <span class="booking-detail-label" style="margin-top:14px;">Staff notes <span class="bhub-mut" style="text-transform:none;letter-spacing:0;">· private, only you see these</span></span>
            <textarea id="bk-notes-${b.id}" class="input-glass" rows="2" maxlength="2000" placeholder="Add a private note — arriving late, allergies, paid cash for extras…" style="margin:6px 0 0;resize:vertical;font-size:0.9rem;">${b.notes ? escapeHtml(b.notes) : ''}</textarea>
            <div style="display:flex;justify-content:flex-end;margin-top:6px;"><button class="btn-sm btn-edit" id="bk-notes-save-${b.id}" onclick="saveBookingNote('${b.id}')">Save note</button></div>
            ${staysHtml}
        </section>`;

    // ---- History card ----
    const historyCard = `
        <section class="bhub-card glass-panel">
            <h3 class="bhub-card-title">History</h3>
            <div id="hub-history"><div class="bhub-empty">Loading history…</div></div>
        </section>`;

    el.innerHTML = `${header}<div class="bhub-grid">${moneyCard}${emailsCard}${guestCard}${historyCard}</div>`;
}

// ---- Settings router: Apple-style index → drill-down sub-pages ----
const SETTINGS_TITLES = {
    notify: 'Notifications',
    host: 'Profile',
    reviews: 'Reviews',
    security: 'Security',
    accom: 'Cottages',
    calendar: 'Calendar sync',
    cancel: 'Cancellation policy',
    seasongrid: 'Seasonal rates — all cottages',
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
function adminHistPush(view, section, path) {
    if (__histReplay) return;
    try {
        // Record the full location — view, section, active dock area and any
        // deep drill-down path — so hardware/browser Back can replay it level
        // by level (drill-down → section → index → dashboard), matching the
        // on-screen "‹ Back" instead of skipping straight out of the area.
        const st = { view, section: section || null };
        if (path) Object.assign(st, path);
        history.pushState({ chbAdmin: st }, '');
    } catch (e) {}
}
let settingsBackTarget = null;
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
        // Pick the first row that's ACTUALLY visible — a row can be display:'' at
        // its own level yet sit inside an area-hidden group (offsetParent === null),
        // and clicking that would jump to a section in another area.
        const first = Array.from(
            document.querySelectorAll('#settings-index .settings-row'),
        ).find((r) => r.style.display !== 'none' && r.offsetParent !== null);
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
    const chrome = document.getElementById('settings-chrome');
    if (panel) panel.style.display = 'none';
    if (idx) idx.style.display = '';
    if (chrome) chrome.style.display = ''; // area header/search return with the index
    applyAreaFilter(); // restore the current area's rows + header
    settingsRecentRender();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}
function settingsOpen(section) {
    // The email client moved from Manage into the Inbox (comms dashboard) —
    // redirect old links, saved history entries and recents to its new home.
    if (section === 'mailbox') {
        openInbox();
        inboxFolder('email');
        return;
    }
    adminHistPush('view-settings', section);
    settingsRecentRecord(section);
    __settingsPath = section ? { section } : null;
    const idx = document.getElementById('settings-index');
    const panel = document.getElementById('settings-panel');
    if (!panel) return;
    if (idx) idx.style.display = 'none';
    // Hide the area chrome (back link, big title, search) while drilled in — the
    // section shows ONE back link + its own title instead of two stacked headers.
    const chrome = document.getElementById('settings-chrome');
    if (chrome) chrome.style.display = 'none';
    panel.style.display = '';
    panel.querySelectorAll('.settings-sec').forEach((s) => (s.style.display = 'none'));
    const sec = document.getElementById('sec-' + section);
    // Unknown/typo section — don't show an empty panel; fall back to the index.
    if (!sec) {
        settingsShowIndex();
        return;
    }
    sec.style.display = '';
    const title = document.getElementById('settings-panel-title');
    if (title) title.textContent = SETTINGS_TITLES[section] || 'Settings';
    settingsBackTarget = () => settingsShowIndex();
    if (section === 'notify') renderNotifySettings();
    else if (section === 'host') fillHostFields();
    else if (section === 'reviews') loadGuestReviewModeration();
    else if (section === 'photos') loadGuestPhotosAdmin();
    else if (section === 'analytics') loadAnalytics();
    else if (section === 'waitlist') loadWaitlist();
    else if (section === 'newsletter') loadNewsletter();
    else if (section === 'guests') loadGuestList();
    else if (section === 'experiences') loadExperiencesAdmin();
    else if (section === 'content') loadContentEditor();
    else if (section === 'diagnostics') loadDiagnostics();
    else if (section === 'testcentre') renderTestCentreList();
    else if (section === 'apis') renderApis();
    else if (section === 'security') {
        loadAdminPasskeys();
        syncAdmin2faToggle();
    }
    else if (section === 'payments') renderSquareSettings();
    else if (section === 'accom') renderAccomList();
    else if (section === 'calendar') renderCalendarList();
    else if (section === 'cancel') renderCancelList();
    else if (section === 'seasongrid') renderSeasonGrid();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}
function settingsBack() {
    if (settingsBackTarget) settingsBackTarget();
    else settingsShowIndex();
}

// ---- Money → Pricing coach (data-driven suggestions; apply is opt-in) ----
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
    const intro = `<p style="font-size:0.82rem;color:var(--text-muted);max-width:640px;margin:0 0 14px;line-height:1.5;">Ideas from your own bookings &amp; demand — nothing changes until you tap <strong>Apply</strong>.</p>`;
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

// ---- Manage → Website content (form-based editor for the global homepage /
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
// ---- Manage → API keys ----
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
                    const priv = propertyMeta[k] && propertyMeta[k].unlisted;
                    const o = occ[k] || { pct: 0, nights: 0, total: 0 };
                    const sub = arch
                        ? 'Hidden from your website (tap to bring back)'
                        : priv
                          ? `Private · ${o.pct}% booked this month · ${o.nights}/${o.total} nights`
                          : `${o.pct}% booked this month · ${o.nights}/${o.total} nights`;
                    const badge = arch
                        ? ' <span style="font-size:0.7rem;color:var(--text-muted);font-weight:600;">· removed</span>'
                        : priv
                          ? ' <span style="font-size:0.7rem;color:var(--text-muted);font-weight:600;">· private</span>'
                          : '';
                    return `
                    <button class="settings-row" onclick="settingsOpenAccom('${k}')" ${arch ? 'style="opacity:0.55;"' : ''}>
                        <span class="settings-row-ic"><span class="legend-swatch swatch-${k}" style="width:16px;height:16px;border-radius:5px;"></span></span>
                        <span class="settings-row-main"><span class="settings-row-label">${escapeHtml(propertyMeta[k].name)}${badge}</span><span class="settings-row-sub">${sub}</span></span>
                        <span class="settings-row-chev" style="margin-left:10px;">›</span>
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
    // Private (unlisted): a cottage you manage bookings/payments for but that
    // never appears on your public website.
    const unlisted = await glassConfirm(
        `Should "${String(name).trim()}" be PRIVATE?\n\nPrivate cottages don't appear on your website — but you can still take bookings and payments for them from the back office.\n\nOK = private · Cancel = list it publicly`,
    );
    try {
        const res = await apiPost('rates.php', {
            action: 'create',
            name: String(name).trim(),
            couple_rate: rate,
            unlisted: unlisted ? 1 : 0,
        });
        await loadRates();
        await renderAccomList();
        if (res && res.prop_key) settingsOpenAccom(res.prop_key); // drop straight into "fill in"
        toast(
            unlisted
                ? `Added private cottage "${String(name).trim()}" — book it from the calendar or Add booking.`
                : `Added "${String(name).trim()}" — now add its photos & details.`,
        );
    } catch (e) {
        glassAlert("Couldn't add the accommodation: " + (e && e.message ? e.message : e));
    }
}
// Toggle a cottage's private (unlisted) state from its Preferences detail.
async function setAccommodationPrivate(k, makePrivate) {
    const name = (propertyMeta[k] && propertyMeta[k].name) || k;
    if (makePrivate) {
        const ok = await glassConfirm(
            `Make "${name}" private?\n\nIt will be removed from your public website, but its bookings, payments and history are kept and you can still take new bookings for it in the back office.`,
        );
        if (!ok) return;
    }
    try {
        await apiPost('rates.php', { action: 'set_unlisted', prop_key: k, unlisted: makePrivate ? 1 : 0 });
        await loadRates();
        await renderAccomList();
        toast(makePrivate ? `"${name}" is now private (off the website).` : `"${name}" is now public on your website.`);
    } catch (e) {
        glassAlert("Couldn't update it: " + (e && e.message ? e.message : e));
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
        label: 'Area & access',
        sub: 'Dark-skies note (shown on Experiences) and this cottage’s accessibility',
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
    adminHistPush('view-settings', 'accom', { prop: k });
    const list = document.getElementById('accom-list');
    const detail = document.getElementById('accom-detail');
    if (list) list.style.display = 'none';
    if (detail) {
        detail.style.display = '';
        const arch = propertyMeta[k] && propertyMeta[k].archived;
        const priv = propertyMeta[k] && propertyMeta[k].unlisted;
        // Private (unlisted) toggle — only meaningful while the cottage is live
        // (archived cottages are already hidden). Making it public/private never
        // touches bookings, payments or history.
        const privateRow = arch
            ? ''
            : priv
              ? `<div class="settings-group" style="margin-top:14px;">
                        <button class="settings-row" onclick="setAccommodationPrivate('${k}', false)">
                            <span class="settings-row-ic"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg></span>
                            <span class="settings-row-main"><span class="settings-row-label">List on the website</span><span class="settings-row-sub">This cottage is private — show it publicly so guests can find and enquire</span></span><span class="settings-row-chev">›</span>
                        </button>
                    </div>`
              : `<div class="settings-group" style="margin-top:14px;">
                        <button class="settings-row" onclick="setAccommodationPrivate('${k}', true)">
                            <span class="settings-row-ic"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.9 4.24A9.1 9.1 0 0 1 12 4c6.5 0 10 7 10 7a13.2 13.2 0 0 1-2.16 3.19M6.6 6.6C3.6 8.3 2 12 2 12s3.5 7 10 7a9.3 9.3 0 0 0 5.4-1.6M1 1l22 22M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg></span>
                            <span class="settings-row-main"><span class="settings-row-label">Make private</span><span class="settings-row-sub">Hide from the website but keep booking &amp; taking payments in the back office</span></span><span class="settings-row-chev">›</span>
                        </button>
                    </div>`;
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
    adminHistPush('view-settings', 'accom', { prop: k, accomSec: sec });
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
    adminHistPush('view-settings', 'calendar', { prop: k });
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
    adminHistPush('view-settings', 'cancel', { prop: propKey });
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

// Change the admin password (must be logged in). Verifies the current
// password, then requires the new one entered twice.
// ---- Owner tool: Calendar Sync (iCal import/export) ----
// Cottages to offer iCal sync for — derived from the live list so owner-added
// cottages appear automatically (was a hardcoded three).
function syncProps() {
    return liveCottageKeys().map((k) => [k, (propertyMeta[k] || {}).name || k]);
}
// The platform feed slots offered per cottage. `source` is the key stored
// with each feed URL (and used by ical-import.php to group blocks).
const SYNC_SOURCES = [
    { source: 'airbnb', name: 'Airbnb', placeholder: 'Airbnb iCal link (https://www.airbnb.com/calendar/ical/...)' },
    { source: 'vrbo', name: 'Vrbo', placeholder: 'Vrbo iCal link (http://www.vrbo.com/icalendar/...)' },
    { source: 'bookingcom', name: 'Booking.com', placeholder: 'Booking.com iCal link (https://admin.booking.com/... .ics)' },
];
// "3h" → "3h ago", but "Yesterday"/"now"/"3 Jun" read fine bare.
function agoLabel(at) {
    const t = relTime(at);
    return /^\d+[mh]$/.test(t) ? t + ' ago' : t;
}
// One line of feed health under each import input, from the server-side
// status snapshot (written on every sync, cron or manual).
function feedStatusHtml(s) {
    if (!s || !s.at) return '';
    if (s.ok)
        return `<div style="font-size:0.72rem;color:var(--text-muted);margin:-2px 0 8px;">Synced ${agoLabel(s.at)} · ${s.events} booked range${s.events === 1 ? '' : 's'}</div>`;
    return `<div style="font-size:0.72rem;color:var(--warn);margin:-2px 0 8px;">⚠ Not syncing (${escapeHtml(s.error || 'error')})${s.ok_at ? ' — still using the dates from ' + agoLabel(s.ok_at) : ''}</div>`;
}
// The channel-sync box markup for ONE cottage.
function calendarPropBoxHtml(key, label, data) {
    const feeds = data.feeds || [];
    const status = (data.status && data.status.sources) || {};
    const inputs = SYNC_SOURCES.map((p) => {
        const f = feeds.find((x) => x.source === p.source);
        return `<input class="input-glass" id="sync-${p.source}-${key}" onblur="saveSyncFeeds('${key}', true)" placeholder="${p.placeholder}" value="${escapeHtml(f ? f.url : '')}" style="font-size:0.8rem;margin-bottom:8px;">${feedStatusHtml(f && f.url ? status[p.source] : null)}`;
    }).join('');
    return `<div style="border:1px solid var(--glass-border);border-radius:12px;padding:16px;">
                    <div style="font-size:0.75rem;text-transform:uppercase;letter-spacing:1px;color:var(--text-muted);margin-bottom:4px;">Export — paste this into each platform's calendar import</div>
                    <div style="display:flex;gap:8px;margin-bottom:14px;">
                        <input class="input-glass" readonly id="sync-export-${key}" onclick="this.select()" value="${escapeHtml(data.export_url || '')}" style="font-size:0.8rem;flex:1;min-width:0;">
                        <button class="btn-sm btn-edit" onclick="copyIcalExport('${key}')" style="flex-shrink:0;">Copy</button>
                    </div>
                    <div style="font-size:0.75rem;text-transform:uppercase;letter-spacing:1px;color:var(--text-muted);margin-bottom:4px;">Import — paste the platform calendar links here</div>
                    ${inputs}
                    <div style="margin-top:2px;">
                        <button class="btn-sm btn-edit" onclick="saveSyncFeeds('${key}')">Save links</button>
                        <button class="btn-sm btn-edit" onclick="runSync('${key}')">Sync now</button>
                        <span style="font-size:0.8rem;color:var(--text-muted);margin-left:8px;">${data.blocks || 0} imported blocked range${data.blocks === 1 ? '' : 's'}</span>
                    </div>
                    <div style="font-size:0.72rem;color:var(--text-muted);margin-top:8px;">Links save automatically as you type, and are kept on the server — they stay put across devices and logins. Feeds refresh themselves daily; you'll get an alert if one stops working.</div>
                </div>`;
}
// Copy the export feed URL (mirrors the copyPayLink idiom).
async function copyIcalExport(key) {
    const el = document.getElementById('sync-export-' + key);
    const url = el ? el.value : '';
    if (!url) return;
    let copied = false;
    try {
        await navigator.clipboard.writeText(url);
        copied = true;
    } catch (e) {
        /* clipboard blocked */
    }
    if (copied) toast('Calendar link copied — paste it into the platform.');
    else {
        if (el) {
            el.focus();
            el.select();
        }
        await glassAlert('Copy this calendar link:\n\n' + url);
    }
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
    const feeds = [];
    for (const p of SYNC_SOURCES) {
        const el = document.getElementById('sync-' + p.source + '-' + key);
        if (!el) return; // box not rendered — nothing to save
        feeds.push({ source: p.source, url: (el.value || '').trim() });
    }
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
            '<p style="color:var(--text-muted);font-size:0.85rem;">No guest bookings yet.</p>';
        return;
    }
    // Repeat-guest rate for a quick loyalty read.
    const repeats = guests.filter((g) => g.repeat).length;
    const repeatPct = Math.round((repeats / guests.length) * 100);
    const propName = (k) => (propertyMeta[k] && propertyMeta[k].name) || k || '—';
    box.innerHTML = `
                <p style="color:var(--text-muted);font-size:0.82rem;margin:0 0 10px;">${guests.length} past guest${guests.length === 1 ? '' : 's'} · ${repeatPct}% have stayed more than once · ranked by lifetime spend</p>
                <table class="accounts-table">
                    <thead><tr><th>Guest</th><th class="num">Stays</th><th class="num">Lifetime spend</th><th>Last stay</th><th>Favourite</th><th></th></tr></thead>
                    <tbody>
                        ${guests
                            .map(
                                (g) => `<tr>
                            <td>${escapeHtml(g.name || '—')}${g.repeat ? ' <span class="chip-mini" style="background:var(--accent-soft);color:#1a191b;border-radius:var(--r-pill);padding:1px 7px;font-size:0.68rem;font-weight:600;">Returning</span>' : ''}<br><span style="color:var(--text-muted);font-size:0.76rem;">${escapeHtml(g.email || '')}</span></td>
                            <td class="num">${g.stays}</td>
                            <td class="num">${gbp(g.ltv || 0)}</td>
                            <td>${g.last_stay || '—'}</td>
                            <td>${escapeHtml(propName(g.fav_prop))}</td>
                            <td class="num" style="white-space:nowrap;">
                                <button class="btn-sm btn-edit" data-email="${escapeHtml(g.email || '')}" onclick="reinviteGuest(this)" title="Email this guest a returning-guest invitation">Invite back</button>
                                ${g.has_account ? `<button class="btn-sm btn-edit" data-email="${escapeHtml(g.email || '')}" onclick="resetGuestPassword(this)">Reset password</button>` : ''}
                            </td>
                        </tr>`,
                            )
                            .join('')}
                    </tbody>
                </table>`;
}
// One-tap "invite back": email a past guest the returning-guest re-invitation.
async function reinviteGuest(btn) {
    const email = btn.getAttribute('data-email') || '';
    if (!email) return;
    if (!(await glassConfirm(`Send a returning-guest invitation to ${email}?`))) return;
    btn.disabled = true;
    const original = btn.textContent;
    btn.textContent = 'Sending…';
    try {
        await apiPost('auth.php', { action: 'guest_reinvite', email });
        btn.textContent = 'Invited ✓';
    } catch (e) {
        btn.disabled = false;
        btn.textContent = original;
        glassAlert("Couldn't send the invitation: " + e.message);
    }
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
function taxYearLabel(startYear) {
    return `6 Apr ${startYear} – 5 Apr ${startYear + 1}`;
}
function taxYearShort(startYear) {
    return `${startYear}/${String(startYear + 1).slice(-2)}`;
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
    pricingcoach: 'Pricing coach',
};
function expensesForYear(startYear) {
    return allExpenses.filter((x) => taxYearStartOf(x.date) === startYear);
} // which Money sub-page is open (for auto-update restore)
function accountsShowIndex() {
    __accountsSection = null;
    const idx = document.getElementById('accounts-index');
    const panel = document.getElementById('accounts-panel');
    const chrome = document.getElementById('accounts-chrome');
    if (panel) panel.style.display = 'none';
    if (idx) idx.style.display = '';
    if (chrome) chrome.style.display = '';
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
    // One back link while drilled in (see settingsOpen).
    const chrome = document.getElementById('accounts-chrome');
    if (chrome) chrome.style.display = 'none';
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
        } else if (section === 'pricingcoach') {
            renderPricingCoach();
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
                    ${heldDeposits > 0 ? gbp(heldDeposits) + ' collected as refundable damages deposits — returned after checkout, <strong>not</strong> income. ' : ''}
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
        // Pinned EXACT version + SRI: a floating @5 tag would change content
        // under us (and can't be integrity-checked at all).
        s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
        s.integrity = 'sha384-GJqSu7vueQ9qN0E9yLPb3Wtpd7OrgK8KmYzC8T1IysG1bcvxvIO4qtYR/D3A991F';
        s.crossOrigin = 'anonymous';
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
                        <span class="feed-date">${fmtDate(x.date)}</span>
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
                <details class="exp-add-details" id="exp-add-details">
                  <summary class="exp-add-summary">＋ Add an expense</summary>
                  <div class="accounts-stat" style="max-width:680px;margin-top:10px;">
                    <div class="exp-add-form" style="display:flex;gap:10px;flex-wrap:wrap;margin-top:4px;align-items:flex-end;">
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
                </details>
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
    const dt = document.getElementById('exp-add-details');
    if (dt) dt.open = true; // reveal the (collapsed) form so the edit is visible
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
    const st = b.holdStatus || 'none';
    // New charge-upfront model: the deposit was charged with the booking and is
    // tracked on the booking (holdAmount) — that's exactly what's returnable.
    if (st === 'charged') {
        const collected = Math.round((Number(b.holdAmount) || dep) * 100) / 100;
        const returned = Math.round((Number(damagesReturnedMap[b.dbId]) || 0) * 100) / 100;
        return {
            collected,
            returned,
            held: Math.round(Math.max(0, collected - returned) * 100) / 100,
            deposit: dep,
        };
    }
    // Settled (refunded or kept for damage), or a legacy card hold: nothing in the
    // rental ledger to return here.
    if (['returned', 'kept', 'authorized', 'captured', 'released', 'expired'].includes(st))
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
            // <= today: a stay that ended TODAY is ready to handle here too (this
            // queue is the one place deposits are returned or kept).
            if (dh.held > 0 && (b.checkOut || '') <= today) rows.push({ propKey, b, dh });
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
                            <span style="color:var(--text-muted);margin-left:8px;font-size:0.85rem;">left ${fmtDate(b.checkOut)}</span></div>
                        <span class="money-status">${gbp(dh.held)} held</span>
                    </div>
                    <div class="money-actions"><button class="btn-sm btn-edit" onclick="returnDeposit('${b.id}')">Return deposit</button>${b.holdStatus === 'charged' ? `<button class="btn-sm btn-edit" onclick="keepDeposit('${b.id}')">Keep (damage)</button>` : ''}</div>
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
        glassAlert('No damage deposit has been collected for this booking.');
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
        `Cancel this booking. Rental refund (£) to the guest — 0 for none. Received so far: ${gbp(ps.deposit)}. (Any refundable damage deposit is returned automatically — don't add it here.)`,
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
                (r.deposit_refunded > 0 ? ` Damage deposit of ${gbp(r.deposit_refunded)} refunded automatically.` : '') +
                (r.manual_refund ? " Couldn't auto-refund the rental — please refund that amount manually (the deposit is already done)." : ''),
        );
        try {
            closeDetailsModal();
        } catch (e) {}
        await loadData();
        renderCalendar();
        // A cancelled booking's row is gone — leave its hub screen if we're on
        // it, or refresh the index + docked pane on the bookings dashboard.
        const hub = document.getElementById('view-booking-hub');
        if (hub && hub.classList.contains('active')) window.openBookings();
        const bkView = document.getElementById('view-backoffice');
        if (bkView && bkView.classList.contains('active')) renderBookings();
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
                // Outstanding/collected KPIs use the SAME deposit-folded figures
                // (displayGrand) as the Payments & balances rows, so the two
                // screens always quote identical numbers for the same bookings.
                // Income aggregates above (receivedTY, trend) stay rental-only.
                const pG =
                    b.agreedPrice ||
                    priceBreakdown(propKey, b.adults || 0, b.children || 0, b.checkIn, b.checkOut);
                const gt = displayGrand(pG, ps, b.holdStatus);
                receivedUpcoming += gt.paid || 0;
                if (!ps.fullyPaid) {
                    owedUpcoming += gt.balance || 0;
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
    // The one figure that needs action — what you're owed — leads, with the
    // "chase" CTA folded into its own tile (no separate duplicate banner).
    const chaseCta =
        owedUpcoming > 0.5
            ? `<button class="btn-sm btn-edit mo-kpi-cta" onclick="event.stopPropagation();accountsOpen('payments')">Chase balances →</button>`
            : '';

    el.innerHTML = `
                <h2 style="font-family:var(--font-serif);font-size:1.3rem;font-weight:400;margin:0 0 12px;">Your money at a glance</h2>
                <div class="mo-kpis">
                    <div class="mo-kpi mo-kpi-lead"><div class="mo-label">Outstanding</div><div class="mo-value ${owedUpcoming > 0 ? 'mo-warn' : 'mo-good'}">${gbp(owedUpcoming)}</div><div class="mo-sub">${owedCount} unpaid · upcoming</div>${chaseCta}</div>
                    <div class="mo-kpi"><div class="mo-label">Received · ${taxYearShort(curTY)}</div><div class="mo-value mo-good">${gbp(receivedTY)}</div><div class="mo-sub">this tax year</div></div>
                    <div class="mo-kpi"><div class="mo-label">Net profit · ${taxYearShort(curTY)}</div><div class="mo-value ${netTY < 0 ? 'mo-warn' : ''}">${gbp(netTY)}</div><div class="mo-sub">after ${gbp(expTY)} expenses</div></div>
                    <div class="mo-kpi"><div class="mo-label">Booked · next 90 days</div><div class="mo-value">${gbp(next90)}</div><div class="mo-sub">confirmed arrivals</div></div>
                </div>
                <details class="mo-trends">
                    <summary>Trends &amp; history</summary>
                    ${yoyCard}
                    <div class="mo-grid2">
                        <div class="mo-card"><div class="mo-card-title">Received · last 12 months</div>${trendBars || '<div class="mo-sub">No payments recorded yet.</div>'}</div>
                        <div class="mo-card"><div class="mo-card-title">Collected vs outstanding · upcoming</div>
                            <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap;margin-top:8px;">${osDonut(collectedPct, 'var(--accent)')}
                                <div class="mo-sub" style="font-size:0.8rem;">${gbp(receivedUpcoming)} collected<br>of ${gbp(receivedUpcoming + owedUpcoming)} due</div></div>
                            <div class="mo-card-title" style="margin-top:16px;">Received by cottage · ${taxYearShort(curTY)}</div>${cottageBars || '<div class="mo-sub">No income yet.</div>'}</div>
                    </div>
                </details>`;
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
            if ((b.checkOut || '') < today) return;
            const ps = paymentSummary(propKey, b);
            const p =
                b.agreedPrice ||
                priceBreakdown(propKey, b.adults || 0, b.children || 0, b.checkIn, b.checkOut);
            rows.push({ propKey, b, ps, gt: displayGrand(p, ps, b.holdStatus) });
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
    // Banner + donut use the SAME deposit-folded figures the rows show
    // (displayGrand), so the headline always equals the sum of its rows.
    const owed = rows.filter((r) => !r.ps.fullyPaid);
    const owedTotal = owed.reduce((s, r) => s + (r.gt.balance || 0), 0);
    const receivedTotal = rows.reduce((s, r) => s + (r.gt.paid || 0), 0);
    const collectedPct =
        receivedTotal + owedTotal > 0
            ? Math.round((receivedTotal / (receivedTotal + owedTotal)) * 100)
            : receivedTotal > 0
              ? 100
              : 0;
    const intro = squareAdminEnabled
        ? 'Tap a booking to handle its money on the booking hub — request card payments, record bank transfers, return the damage deposit and download invoices all live there.'
        : 'Tap a booking to handle its money on the booking hub. Square card payments are off — set them up in Manage to email pay links; recording manual payments (bank transfer, cash) works regardless.';
    if (!rows.length) {
        el.innerHTML = `<div class="accounts-empty">No upcoming or current bookings.</div>`;
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
    // Find-rows, not action cards: the booking hub's Money card is the ONE
    // place a booking's money is handled (request/record/refund/invoice/
    // history all live there) — each row here just locates and opens it.
    const cards = rows
        .map(({ propKey, b, ps, gt }) => {
            const meta = propertyMeta[propKey] || { name: propKey };
            const payLabel = gt.fullyPaid ? 'Paid' : gt.paid > 0 ? 'Part-paid' : 'Unpaid';
            const payClass = gt.fullyPaid ? 'ok' : gt.paid > 0 ? 'warn' : 'danger';
            const ci = dpParse(b.checkIn),
                t0 = dpParse(today);
            const days = ci && t0 ? Math.round((ci - t0) / 86400000) : 99;
            const dueSoon = !ps.fullyPaid && days <= 7; // within a week, today, or already started
            const dueChip = dueSoon
                ? `<span class="bk-chip danger"><span class="bk-dot"></span>${days < 0 ? 'In progress' : days === 0 ? 'Arrives today' : 'Arrives in ' + days + 'd'}</span>`
                : '';
            const dh = damageHeld(propKey, b);
            const depBit = dh.held > 0 ? ` · ${gbp(dh.held)} deposit held` : '';
            return `
                <button type="button" class="bk-row glass-panel pay-${payClass}" data-bkid="${b.id}" onclick="openBookingHub('${b.id}')">
                    <span class="bk-row-body">
                        <span class="bk-row-top">
                            <span class="prop-tag tag-${propKey}">${escapeHtml(meta.name)}</span>
                            <span class="bk-chip ${payClass}"><span class="bk-dot"></span>${payLabel}${gt.fullyPaid ? '' : ' · ' + gbp(gt.balance) + ' due'}</span>
                            ${dueChip}
                        </span>
                        <strong class="bk-row-name">${escapeHtml(b.name || 'Guest')}</strong>
                        <span class="bk-row-dates">${fmtStayRange(b.checkIn, b.checkOut)} · ${gbp(gt.paid)} of ${gbp(gt.total)} received${depBit}</span>
                    </span>
                    <span class="bk-row-arrow" aria-hidden="true">›</span>
                </button>`;
        })
        .join('');
    el.innerHTML = `${owedBanner}
                <p style="font-size:0.82rem;color:var(--text-muted);margin:8px 0 16px;max-width:640px;">${intro}</p>
                <div class="bk-list">${cards}</div>`;
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
                    <span class="feed-date">${escapeHtml(fmtDate(date))}</span>
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
    // blocks, each cottage-night counted once.
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
async function downloadYearStatement(startYear) {
    try {
        await ensureJsPdf();
    } catch (e) {
        glassAlert("The PDF tool couldn't load — please check your connection and try again.");
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
        doc.text(`(${gbp(held)} refundable damage deposits collected — not income)`, left, y);
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
function syncAdmin2faToggle() {
    const el = document.getElementById('admin-2fa-toggle');
    if (el) el.checked = siteContent['admin-2fa-enabled'] === '1';
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
// ---- Owner email recipients (Manage → Notifications) ----
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
function saveLocalContent(key, value) {
    saveContent(key, value);
    try {
        renderLocalGuide(activeFrontProperty);
    } catch (e) {}
}

// Default the back-office calendar to the current month.

// ONE way to record money on a booking (was a status <select> AND an amount box,
// each driving its own chain of pop-up prompts): a single glass form — amount,
// date, method together — matching the Add/Edit modal's inline payment fields.
// Status derives from the amount: £0 = unpaid, everything = paid, else deposit.
async function recordPayment(bookingId) {
    const booking = findBookingById(bookingId);
    if (!booking) return;
    const loc = findBookingLocation(bookingId);
    const propKey = loc ? loc.propKey : activeFrontProperty;
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
    const vals = await glassForm(
        `Record a payment from ${booking.name || 'the guest'}.\nRental total ${gbp(total)} — enter the total received so far (rental only, not the damage deposit).`,
        [
            {
                id: 'amount',
                label: 'Total received so far (£)',
                type: 'number',
                min: 0,
                step: 0.01,
                value: booking.depositPaid > 0 ? booking.depositPaid : '',
                placeholder: 'e.g. 100',
            },
            { id: 'date', label: 'Payment date', type: 'date', value: booking.paymentDate || todayDashed() },
            {
                id: 'method',
                label: 'Payment method (optional)',
                type: 'text',
                value: booking.paymentMethod || '',
                placeholder: 'Card / Bank transfer / Cash …',
            },
        ],
    );
    if (vals === null) return;
    let dep = Math.max(0, parseFloat(vals.amount) || 0);
    if (dep > total) dep = total;
    let status;
    if (dep <= 0.001) status = 'unpaid';
    else if (dep >= total - 0.001) status = 'paid';
    else status = 'deposit';

    const payload = { id: booking.dbId, payment: status };
    if (status === 'deposit') payload.deposit = Math.round(dep * 100) / 100;
    if (dep > 0.001) {
        const d = (vals.date || '').trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) {
            glassAlert('A valid payment date is required.');
            return;
        }
        payload.payment_date = d;
        payload.payment_method = (vals.method || '').trim();
    }
    try {
        await apiPost('bookings.php', { action: 'set_payment', ...payload });
        await loadData();
        renderCalendar();
        afterPaymentChange(bookingId);
        toast(
            dep > 0.001
                ? `Payment recorded — ${gbp(dep)} received${status === 'paid' ? ' (paid in full)' : ''}.`
                : 'Marked as unpaid.',
        );
        if (dep > 0.001) await offerUpdatedConfirmationEmail(bookingId);
    } catch (e) {
        glassAlert("Couldn't record the payment: " + e.message);
        afterPaymentChange(bookingId);
    }
}

// After a booking changes (payment recorded, dates edited …), offer to email the
// guest an UPDATED confirmation. Guest-only (no owner re-ping). ONE shared ask —
// the modal save and the money row both come here, so the wording never forks.
// Skips silently when there's no email on file.
async function offerUpdatedConfirmationEmail(bookingId) {
    const b = findBookingById(bookingId);
    if (!b || !b.email) return;
    const loc = findBookingLocation(bookingId);
    const propKey = loc ? loc.propKey : activeFrontProperty;
    let gt = null;
    try {
        const p =
            b.agreedPrice ||
            priceBreakdown(propKey, b.adults || 0, b.children || 0, b.checkIn, b.checkOut);
        gt = displayGrand(p, paymentSummary(propKey, b), b.holdStatus || 'none');
    } catch (e) {}
    const statusLine =
        gt && gt.paid > 0
            ? gt.fullyPaid
                ? `${gbp(gt.paid)} paid — paid in full`
                : `${gbp(gt.paid)} paid · ${gbp(gt.balance)} balance remaining`
            : null;
    const q =
        `Email ${b.name || 'the guest'} an updated booking confirmation?` +
        (statusLine ? `\n\nIt will show ${statusLine}.` : '');
    if (!(await glassConfirm(q))) return;
    try {
        await apiPost('bookings.php', { action: 'send_confirmation', id: b.dbId, guest_only: true });
        toast('Updated confirmation sent.');
    } catch (e) {
        glassAlert("Saved, but the email didn't send: " + e.message);
    }
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
// ---- Refundable damage deposit (charged upfront, refunded on approval) ----
function holdControls(b) {
    if (typeof squareAdminEnabled === 'undefined' || !squareAdminEnabled || !b.email) return '';
    const amt = b.holdAmount || (b.agreedPrice ? b.agreedPrice.damagesDeposit : 0) || 0;
    if (amt <= 0) return '';
    const st = b.holdStatus || 'none';
    const today = new Date().toISOString().slice(0, 10);
    const left = b.checkOut && b.checkOut <= today;
    // New charge-upfront model.
    if (st === 'charged') {
        const actions = left
            ? `<button class="btn-sm btn-edit" onclick="returnDeposit('${b.id}')">Approve &amp; refund</button>
               <button class="btn-sm btn-edit" onclick="keepDeposit('${b.id}')">Keep (damage)</button>`
            : `<span style="color:var(--text-muted);font-size:0.78rem;">refundable after checkout</span>`;
        return `<div class="money-deposit"><span>Damage deposit: <strong>${gbp(amt)} collected</strong></span> ${actions}</div>`;
    }
    if (st === 'returned')
        return `<div class="money-deposit"><span>Damage deposit: <span style="color:#4CAF50;">${gbp(amt)} refunded</span></span></div>`;
    if (st === 'kept')
        return `<div class="money-deposit"><span>Damage deposit: <strong style="color:#E57373;">${gbp(amt)} kept</strong> for damage</span></div>`;
    // Legacy card-hold model — kept working for any in-flight authorised holds.
    if (st === 'authorized')
        return `<div class="money-deposit"><span>Damage hold: <strong>${gbp(amt)} held</strong></span>
                <button class="btn-sm btn-edit" onclick="releaseHold('${b.id}')">Release</button>
                <button class="btn-sm btn-edit" onclick="captureHold('${b.id}')">Capture (damage)</button></div>`;
    if (st === 'captured')
        return `<div class="money-deposit"><span>Damage hold: <strong style="color:#E57373;">${gbp(amt)} captured</strong> for damage</span></div>`;
    if (st === 'released')
        return `<div class="money-deposit"><span>Damage hold: <span style="color:#4CAF50;">released</span></span></div>`;
    if (st === 'expired')
        return `<div class="money-deposit"><span>Damage hold: expired (auto-released)</span></div>`;
    // Fresh booking: the deposit is charged automatically with the guest's payment.
    return `<div class="money-deposit"><span>Refundable deposit ${gbp(amt)} — charged with the guest's payment</span></div>`;
}
async function keepDeposit(bookingId) {
    const booking = findBookingById(bookingId);
    if (!booking) return;
    if (
        !(await glassConfirm(
            'Keep the damage deposit (there was damage)? The guest will NOT be refunded. This is recorded as retained income.',
        ))
    )
        return;
    try {
        const res = await apiPost('bookings.php', { action: 'keep_deposit', id: booking.dbId });
        toast(`Deposit kept — ${gbp(res.kept)}.`);
        afterPaymentChange(bookingId);
    } catch (e) {
        glassAlert("Couldn't keep the deposit: " + e.message);
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

// Unified back office: load data once, render calendar and inbox.
async function initBackOffice() {
    // The page header carries the living date ("Friday 10 July").
    const td = document.getElementById('today-date');
    if (td) td.textContent = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
    await loadData();
    renderCalendar();
    try {
        renderBookings(); // the bookings workspace shares the dashboard now
    } catch (e) {}
    renderInbox();
    try {
        refreshModerationCounts();
    } catch (e) {} // pending reviews/photos/experiences (badges + today card)
    try {
        checkCronHealth();
    } catch (e) {} // warn if the daily automation stopped
    try {
        checkSystemHealth();
    } catch (e) {} // one-glance systems-health rollup pill
    try {
        await loadDepositReturns();
    } catch (e) {} // for the deposits-to-return line
    showChangeoverToasts();
    // Quietly refresh external (Airbnb/Vrbo) bookings in the background so
    // cancelled or moved dates drop off on their own. Non-blocking + throttled.
    autoSyncIcalBlocks();
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
        el.textContent = 'Syncing…';
        return;
    }
    let last = 0;
    try {
        last = parseInt(localStorage.getItem(ICAL_LAST_SYNC_KEY) || '0', 10);
    } catch (e) {}
    // Stay quiet when the sync is recent — surface a note only when it's never
    // run or has gone stale (>12h). The refresh icon is always available.
    if (!last) el.textContent = 'External calendars not synced yet';
    else if (Date.now() - last > 12 * 3600 * 1000)
        el.textContent = 'External calendars updated ' + formatRelativeTime(last);
    else el.textContent = '';
}
// Compact relative time for the inbox list: now / 5m / 3h / Yesterday / 3 Jun.
function relTime(at) {
    const d = msgDate(at);
    if (!d) return '';
    const now = new Date();
    const secs = (now - d) / 1000;
    if (secs < 60) return 'now';
    if (secs < 3600) return Math.floor(secs / 60) + 'm';
    const sameDay = d.toDateString() === now.toDateString();
    if (sameDay) return Math.floor(secs / 3600) + 'h';
    const y = new Date(now);
    y.setDate(now.getDate() - 1);
    if (d.toDateString() === y.toDateString()) return 'Yesterday';
    return d.toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
        ...(d.getFullYear() === now.getFullYear() ? {} : { year: '2-digit' }),
    });
}
// A small colour hue derived from a name/email, so each person's avatar is
// consistently tinted (helps tell conversations apart at a glance).
function strHue(s) {
    let h = 0;
    s = String(s || '');
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return h % 360;
}
function avatarInitial(s) {
    const t = String(s || '').trim();
    return (t ? t[0] : '?').toUpperCase();
}
const CHAT_FAQ_ORDER = ['checkin', 'parking', 'wifi'];

// ---- Admin side: Guest messages (Manage → Guest messages) + reply modal ----
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
    // The badges only ever reflect unread in the active inbox.
    if (!__msgShowArchived) {
        const unread = threads.reduce((s, t) => s + (t.unread || 0), 0);
        if (badge) {
            badge.textContent = unread;
            badge.classList.toggle('zero', unread === 0);
        }
        const chip = document.getElementById('ifold-count-msg');
        if (chip) chip.textContent = unread > 0 ? unread : '';
    }
    if (!list) return;
    __msgThreads = threads;
    renderMessagesList();
    renderChatAnswersEditor();
    renderChatAwayEditor();
}
// Inbox list state: the fetched threads plus the owner's live search term and
// "Needs reply" filter. Search/filter run over the DOM (show/hide) so typing
// never rebuilds the list or loses focus; only loadAdminMessages() rebuilds.
let __msgThreads = [];
let __msgSearch = '';
let __msgUnansweredOnly = false;
// A conversation "needs a reply" when it isn't archived AND either the last
// message is the guest's, or there are still-unread guest messages. The unread
// clause means an automatic away-reply (which posts as an admin message but never
// marks the guest's message read) doesn't hide a thread that still needs you.
function msgNeedsReply(t) {
    return !t.archived && (t.last_role === 'guest' || (t.unread || 0) > 0);
}
function renderMessagesList() {
    const list = document.getElementById('messages-list');
    if (!list) return;
    // Preserve focus/caret if a poll rebuilds the list while the owner is searching.
    const sEl = document.getElementById('msg-search');
    const hadFocus = sEl && document.activeElement === sEl;
    const caret = hadFocus ? sEl.selectionStart : null;

    // Threads that need a reply float to the top (stable within each group, so
    // the server's recency order is preserved otherwise).
    const threads = __msgThreads
        .slice()
        .sort((a, b) => (msgNeedsReply(b) ? 1 : 0) - (msgNeedsReply(a) ? 1 : 0));
    const needCount = threads.filter(msgNeedsReply).length;
    // The archived toggle is a low-frequency control, so it sits at the end of
    // the controls row (after search), not in a prime slot above it.
    const toggle = `<button class="btn-sm msg-archived-toggle" onclick="toggleArchivedMessages()">${__msgShowArchived ? '← Active conversations' : 'Show archived'}</button>`;
    const controls = `<div class="msg-inbox-controls">
                ${
                    threads.length
                        ? `<input id="msg-search" class="input-glass field-sm" type="search" placeholder="Search name, email or text…" value="${escapeHtml(__msgSearch)}" oninput="onMsgSearch(this.value)" autocomplete="off">
                ${needCount && !__msgShowArchived ? `<button id="msg-unanswered" class="msg-filter-chip${__msgUnansweredOnly ? ' on' : ''}" onclick="toggleUnansweredOnly()">Needs reply · ${needCount}</button>` : ''}`
                        : ''
                }
                ${toggle}
           </div>`;
    const rows = threads.length
        ? threads
              .map((t) => {
                  const needs = msgNeedsReply(t);
                  const hay = (
                      (t.name || '') +
                      ' ' +
                      (t.email || '') +
                      ' ' +
                      (t.last_body || '')
                  ).toLowerCase();
                  const nm = t.name || t.email || 'Visitor';
                  const unread = (t.unread || 0) > 0;
                  return `
                <button class="msg-thread-row${unread ? ' unread' : ''}" data-s="${escapeHtml(hay)}" data-needs="${needs ? 1 : 0}" onclick="openMessageThread(${t.thread_id})">
                    <span class="mtr-ava" style="--ava-h:${strHue(nm)};" aria-hidden="true">${escapeHtml(avatarInitial(nm))}</span>
                    <span class="mtr-main">
                        <span class="mtr-top"><span class="mtr-name">${escapeHtml(nm)}${t.is_guest ? '' : ' <span class="mtr-tag">visitor</span>'}</span><span class="mtr-time">${escapeHtml(relTime(t.last_at))}</span></span>
                        <span class="mtr-bot"><span class="mtr-last">${escapeHtml(t.last_body || '')}</span>${needs ? '<span class="needs-reply-pill">Needs reply</span>' : ''}</span>
                    </span>
                </button>`;
              })
              .join('') +
          `<p id="msg-noresults" class="msg-noresults" style="display:none;">No conversations match.</p>`
        : `<p style="font-size:0.82rem;color:var(--text-muted);">${__msgShowArchived ? 'No archived conversations.' : 'No messages yet.'}</p>`;
    list.innerHTML = controls + rows;
    applyMsgFilter();
    if (hadFocus) {
        const s = document.getElementById('msg-search');
        if (s) {
            s.focus();
            try {
                s.setSelectionRange(caret, caret);
            } catch (e) {}
        }
    }
}
function onMsgSearch(v) {
    __msgSearch = v || '';
    applyMsgFilter();
}
function toggleUnansweredOnly() {
    __msgUnansweredOnly = !__msgUnansweredOnly;
    const chip = document.getElementById('msg-unanswered');
    if (chip) chip.classList.toggle('on', __msgUnansweredOnly);
    applyMsgFilter();
}
// Filter the inbox purely by toggling row visibility (no rebuild → no focus loss).
function applyMsgFilter() {
    const list = document.getElementById('messages-list');
    if (!list) return;
    const q = __msgSearch.trim().toLowerCase();
    const rows = list.querySelectorAll('.msg-thread-row');
    let shown = 0;
    rows.forEach((row) => {
        const matchQ = !q || (row.getAttribute('data-s') || '').includes(q);
        const matchNeeds = !__msgUnansweredOnly || row.getAttribute('data-needs') === '1';
        const show = matchQ && matchNeeds;
        row.style.display = show ? '' : 'none';
        if (show) shown++;
    });
    const none = document.getElementById('msg-noresults');
    if (none) none.style.display = rows.length && shown === 0 ? 'block' : 'none';
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
// Away / auto-reply settings: enable, message, and optional office hours.
function renderChatAwayEditor() {
    const host = document.getElementById('chat-away-editor');
    if (!host) return;
    const sc = (k) => (siteContent[k] != null ? String(siteContent[k]) : '');
    const enabled = sc('chat-away-enabled') === '1';
    const msgVal = sc('chat-away-msg');
    const from = sc('chat-away-from');
    const to = sc('chat-away-to');
    const inputStyle =
        'background:rgba(0,0,0,0.25);border:1px solid var(--glass-border);color:var(--text-light);padding:9px 12px;border-radius:10px;font-family:var(--font-sans);';
    const hourOpts = (sel) => {
        let o = `<option value=""${sel === '' ? ' selected' : ''}>—</option>`;
        for (let h = 0; h < 24; h++) {
            const hh = String(h).padStart(2, '0');
            o += `<option value="${hh}"${sel === hh ? ' selected' : ''}>${hh}:00</option>`;
        }
        return o;
    };
    host.innerHTML =
        '<h3 style="font-family:var(--font-serif);font-size:1.1rem;margin:0 0 4px;">Away auto-reply</h3>' +
        '<p style="font-size:0.8rem;color:var(--text-muted);margin:0 0 14px;">Automatically acknowledge a guest who messages when you can’t reply straight away. Sent at most once every few hours per conversation, and never right after you’ve replied.</p>' +
        `<label style="display:flex;align-items:center;gap:10px;font-size:0.85rem;margin-bottom:14px;cursor:pointer;"><input type="checkbox" ${enabled ? 'checked' : ''} onchange="saveContent('chat-away-enabled', this.checked ? '1' : '')"> Turn on away auto-reply</label>` +
        `<div style="margin-bottom:14px;"><label style="font-size:0.78rem;color:var(--text-muted);display:block;margin-bottom:6px;">Auto-reply message</label>` +
        `<textarea rows="3" style="width:100%;${inputStyle}resize:vertical;" placeholder="Thanks for your message! We’re not at the desk right now but will reply as soon as we can — usually within a few hours." onchange="saveContent('chat-away-msg', this.value)">${escapeHtml(msgVal)}</textarea></div>` +
        `<label style="font-size:0.78rem;color:var(--text-muted);display:block;margin-bottom:6px;">Only auto-reply outside these hours (optional)</label>` +
        `<div style="display:flex;align-items:center;gap:10px;"><select style="${inputStyle}flex:1;" aria-label="Available from" onchange="saveContent('chat-away-from', this.value)">${hourOpts(from)}</select><span style="color:var(--text-muted);font-size:0.8rem;">to</span><select style="${inputStyle}flex:1;" aria-label="Available until" onchange="saveContent('chat-away-to', this.value)">${hourOpts(to)}</select></div>` +
        `<p style="font-size:0.72rem;color:var(--text-muted);margin:8px 0 0;">e.g. 09:00 to 18:00 — the auto-reply only fires outside that window. Leave both as “—” to auto-reply any time you haven’t just replied.</p>`;
}
function toggleArchivedMessages() {
    __msgShowArchived = !__msgShowArchived;
    loadAdminMessages();
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
function accomAddPhoto(k) {
    pickAndUpload('gallery-' + k, async (url) => {
        const imgs = accomImages(k);
        imgs.push(url);
        await accomSavePhotos(k, imgs);
    });
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
                    <div class="rate-field"><label>Last-minute discount (%) <span style="opacity:0.7;">(0 = off)</span></label><input type="number" min="0" max="90" step="1" value="${r.lastminPct || 0}" onchange="updateRate('${k}','lastminPct',this.value)" placeholder="e.g. 15"></div>
                    <div class="rate-field"><label>…for stays starting within (days)</label><input type="number" min="0" max="60" step="1" value="${r.lastminDays || 0}" onchange="updateRate('${k}','lastminDays',this.value)" placeholder="e.g. 10"></div>
                    <p style="font-size:0.72rem;color:var(--text-muted);margin:4px 0 8px;">Automatically takes the % off the nightly rate for any stay whose check-in is within this many days — a hands-off way to fill near-term gaps. Both 0 to turn off.</p>
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
            // Read-only here: seasonal pricing has ONE editor — the all-cottage
            // grid — so two editors can't drift apart. This just shows what
            // applies to this cottage and links to the grid.
            return `
                    <label style="font-size:0.78rem;color:var(--text-muted);display:block;margin-bottom:10px;">Higher (or lower) nightly rates for date ranges — school summer, Christmas… Edited for all cottages together in one grid.</label>
                    ${
                        (propertySeasons[k] || []).length
                            ? (propertySeasons[k] || [])
                                  .map(
                                      (s) =>
                                          `<div style="font-size:0.85rem;color:var(--text-light);margin-bottom:6px;">${escapeHtml(s.label || 'Season')} · ${escapeHtml(s.start_date || '')} → ${escapeHtml(s.end_date || '')} · <strong>${s.couple_rate ? gbp(s.couple_rate) + '/night' : 'base rate'}</strong></div>`,
                                  )
                                  .join('')
                            : '<p style="font-size:0.85rem;color:var(--text-muted);margin:0 0 8px;">No seasonal rates set for this cottage.</p>'
                    }
                    <button class="btn-sm btn-edit" style="margin-top:6px;" onclick="settingsOpen('seasongrid')">Edit seasonal rates — all cottages →</button>`;
        case 'arrival':
            return `
                    <div><label style="font-size:0.78rem;color:var(--text-muted);display:block;margin-bottom:6px;">Sent to guests a few days before check-in (directions, key collection, wifi…). Kept private — never shown on the site. Also revealed on a guest's account when they're at the cottage (see Location).</label><textarea rows="5" style="width:100%;background:rgba(0,0,0,0.25);border:1px solid var(--glass-border);color:var(--text-light);padding:9px 12px;border-radius:10px;font-family:var(--font-sans);resize:vertical;" onchange="saveContent('arrival-${k}', this.value)">${escapeHtml(adminPrivateContent['arrival-' + k] || '')}</textarea></div>`;
        case 'location':
            return `
                    <div style="margin-bottom:14px;"><label style="font-size:0.78rem;color:var(--text-muted);display:block;margin-bottom:6px;">Address (shown to guests)</label><textarea rows="2" style="width:100%;background:rgba(0,0,0,0.25);border:1px solid var(--glass-border);color:var(--text-light);padding:9px 12px;border-radius:10px;font-family:var(--font-sans);resize:vertical;" onchange="updateRateText('${k}','address',this.value)">${escapeHtml(r.address || '')}</textarea></div>
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
                    <div style="margin-bottom:14px;"><label style="font-size:0.78rem;color:var(--text-muted);display:block;margin-bottom:6px;">Dark skies / stargazing note — shown on the Experiences page (one shared note across the whole site).</label><textarea rows="3" style="width:100%;background:rgba(0,0,0,0.25);border:1px solid var(--glass-border);color:var(--text-light);padding:9px 12px;border-radius:10px;font-family:var(--font-sans);resize:vertical;" onchange="saveLocalContent('darkskies', this.value)">${escapeHtml(siteContent['darkskies'] || DEFAULT_DARKSKIES)}</textarea></div>
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
// ---- Analytics panel (Manage → Analytics) ----
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

// ---- Waitlist manager (Manage → Waitlist) ----
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
                w.check_in && w.check_out ? `${fmtDate(w.check_in)} → ${fmtDate(w.check_out)}` : 'Any dates';
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
// ---- Newsletter (Manage → Newsletter) ----
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
// ---- System check (Manage → System check) ----
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
                        <button class="btn-sm btn-edit" onclick="verifyBackupNow(this)">Verify latest</button>
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
async function verifyBackupNow(btn) {
    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Verifying…';
    }
    try {
        const r = await apiPost('backup.php', { action: 'verify' });
        if (r.ok)
            toast(
                `Backup verified — decompresses cleanly, ${r.tables} tables${r.has_bookings ? ' (bookings present)' : ''}.`,
            );
        else toast(r.error || 'Backup verification failed.', 'error');
    } catch (e) {
        toast(e.message || "Couldn't verify the backup.", 'error');
    }
    if (btn) {
        btn.disabled = false;
        btn.textContent = 'Verify latest';
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
                ? `Backup saved (${Math.round((r.bytes || 0) / 1024)} KB)${r.verified ? ' & verified' : ' — but VERIFY FAILED'}${r.emailed ? ', emailed to you' : ''}.`
                : r.error || 'Backup failed',
            r.ok && r.verified !== false ? undefined : r.ok ? undefined : 'error',
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
//  Test centre (Manage → Test centre): try every customer-facing feature
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
            'Money → Pricing coach: suggestions appear from the seeded bookings, Airbnb/Vrbo blocks and searches (turn-on-weekend, orphan nights, unmet demand, quiet period).',
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
            'Manage → Health check → “Optimise photos for faster loading” (needs uploaded photos to convert).',
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
                msg.innerHTML = `✓ Demo data seeded across ${r.cottages} cottage${r.cottages === 1 ? '' : 's'}. Work through the checklist below — open <strong>Preview as guest</strong> for the public-facing items and <strong>Money → Pricing coach</strong> for the suggestions.`;
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
                    <div style="font-size:0.85rem;color:var(--text-muted);margin:4px 0 10px;">${escapeHtml(fmtDate(b.check_in))} → ${escapeHtml(fmtDate(b.check_out))} · ${gbp(b.agreed_total || 0)}</div>
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
                    <span class="settings-row-main"><span class="settings-row-label">${escapeHtml(name)} · #${b.id}</span><span class="settings-row-sub">${escapeHtml(fmtDate(b.check_in))} → ${escapeHtml(fmtDate(b.check_out))} · ${gbp(b.agreed_total || 0)}${b.payments ? ` · ${b.payments} payment${b.payments === 1 ? '' : 's'}` : ''}</span></span>
                    <button class="btn-sm btn-edit" style="color:#E57373;border-color:rgba(229,115,115,0.4);" onclick="tcDeleteData('booking',${b.id})">Remove</button>
                </div>`;
        })
        .join('');
    const eRows = enq
        .map(
            (e) => `
                <div class="settings-row" style="cursor:default;">
                    <span class="settings-row-main"><span class="settings-row-label">Enquiry · #${e.id}</span><span class="settings-row-sub">${escapeHtml(fmtDate(e.check_in) || '')} → ${escapeHtml(fmtDate(e.check_out) || '')}</span></span>
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
                    <tbody id="season-grid-body">${
                        bands.length
                            ? bands.map(seasonGridRowHtml).join('')
                            : seasonGridRowHtml({ label: '', start: '', end: '', rates: {} })
                    }</tbody>
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
    const pill = document.getElementById('cron-pill');
    if (!el) return;
    let d;
    try {
        // loadData's admin-bootstrap round-trip stashes the cron status (it runs
        // just before this on the dashboard), so no extra request is needed;
        // fetch directly only when it's absent.
        d = window.__cronStatusPre || (await apiGet('cron-status.php'));
    } catch (e) {
        el.style.display = 'none';
        if (pill) pill.style.display = 'none';
        return;
    }
    // Exception-only pill: healthy automation stays hidden (a green "all fine"
    // badge is just noise); it appears amber only when the daily job has gone
    // quiet. A hard failure still raises the loud banner below.
    if (pill && d) {
        if (d.stale) {
            const ago = !d.everRan
                ? 'never run'
                : d.ageHours >= 48
                  ? Math.round(d.ageHours / 24) + ' days ago'
                  : d.ageHours >= 1.5
                    ? Math.round(d.ageHours) + ' h ago'
                    : 'just now';
            pill.className = 'cron-pill warn';
            pill.innerHTML = `<span class="cron-pill-dot"></span>Automation quiet · ${ago}`;
            pill.style.display = '';
        } else {
            pill.style.display = 'none';
        }
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
// ---- Dashboard: one-glance systems-health pill ----
// Rolls up the full Health check (diagnostics.php: DB, mail, Square, cron,
// backup, migrations, error rate …) into a single dashboard signal so trouble
// surfaces without visiting System check. Green = all clear; amber = something
// needs a look; red = a hard failure. Tap opens the full Health check. Cached
// for the session so the (heavier) diagnostics scan runs at most once per visit.
async function checkSystemHealth() {
    const pill = document.getElementById('health-pill');
    if (!pill) return;
    let d;
    try {
        const cached = sessionStorage.getItem('chb-health');
        d = cached ? JSON.parse(cached) : null;
    } catch (e) {}
    if (!d) {
        try {
            const r = await apiGet('diagnostics.php');
            d = r && r.summary ? r.summary : null;
            if (d) {
                try {
                    sessionStorage.setItem('chb-health', JSON.stringify(d));
                } catch (e) {}
            }
        } catch (e) {
            pill.style.display = 'none';
            return;
        }
    }
    if (!d) {
        pill.style.display = 'none';
        return;
    }
    const fail = d.fail || 0;
    const warn = d.warn || 0;
    if (fail > 0) {
        pill.className = 'cron-pill danger';
        pill.innerHTML = `<span class="cron-pill-dot"></span>${fail} system issue${fail === 1 ? '' : 's'} — tap to check`;
    } else if (warn > 0) {
        pill.className = 'cron-pill warn';
        pill.innerHTML = `<span class="cron-pill-dot"></span>${warn} thing${warn === 1 ? '' : 's'} need${warn === 1 ? 's' : ''} a look`;
    } else {
        pill.className = 'cron-pill ok';
        pill.innerHTML = `<span class="cron-pill-dot"></span>All systems healthy`;
    }
    pill.style.display = '';
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

// Timeline navigation: ‹ › scroll roughly a month; Today snaps back.
function changeMonth(dir) {
    const host = document.getElementById('cal-body');
    if (!host) return;
    host.scrollBy({ left: dir * 30 * tlDayW(), behavior: 'smooth' });
}
function timelineToday() {
    const host = document.getElementById('cal-body');
    if (!host) return;
    host.scrollTo({ left: Math.max(0, (-TL_START_OFFSET - 2) * tlDayW()), behavior: 'smooth' });
}
// Free timeline day tapped → start an Add Booking on that cottage + date.
function tlAddAt(propKey, iso) {
    openAddBooking();
    const sel = document.getElementById('modal-property');
    if (sel && propertyMeta[propKey]) {
        populateBookingPropertySelect(propKey); // ensures the key is listed
        sel.value = propKey;
    }
    document.getElementById('modal-checkin').value = iso;
    document.getElementById('modal-checkout').value = '';
    try {
        applyModalPropertyMode();
        refreshModalDateTrigger();
        updateModalPrice();
    } catch (e) {}
}
// Keep the header label in sync with the month under the left edge.
function tlSyncMonthLabel() {
    const host = document.getElementById('cal-body');
    const label = document.getElementById('cal-month-display');
    if (!host || !label) return;
    const idx = Math.max(0, Math.round(host.scrollLeft / tlDayW()));
    const start = dpParse(todayDashed());
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + TL_START_OFFSET + idx + 3);
    label.innerText = d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
}

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
// ---- Reusable mini-chart helpers (inline SVG/CSS, no library) ----
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

// ---- TIMELINE calendar (Today): one row per cottage, days across ----
// Bookings render as bars (traffic-light left edge; tap → the booking hub);
// imported Airbnb/Vrbo blocks are greyed and display-only (the auto-sync owns
// them); free future days are tappable to start an Add Booking there.
const TL_START_OFFSET = -7; // window starts a week back…
const TL_DAYS = 187; // …and runs ~6 months forward
// Px per day comes from the --tl-day-w custom property on .tl-wrap (narrower on
// phones), so the lanes' grid columns and this scroll maths always agree.
function tlDayW() {
    const host = document.getElementById('cal-body');
    const v = host ? parseFloat(getComputedStyle(host).getPropertyValue('--tl-day-w')) : NaN;
    return isNaN(v) ? 38 : v;
}
let __tlScrolled = false; // first render jumps to today; later renders keep place
function renderCalendar() {
    renderCalUpdated();
    const host = document.getElementById('cal-body');
    if (!host) return;
    const keepScroll = __tlScrolled ? host.scrollLeft : null;
    const todayIso = todayDashed();
    const t0 = dpParse(todayIso);
    const dates = [];
    for (let i = 0; i < TL_DAYS; i++)
        dates.push(formatDashed(new Date(t0.getFullYear(), t0.getMonth(), t0.getDate() + TL_START_OFFSET + i)));
    const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const dows = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
    const idxOf = (ds) => Math.round((dpParse(ds) - dpParse(dates[0])) / 864e5);

    // Header lane: day cells (dow letter + number; month name on the 1st).
    let head = '';
    for (let i = 0; i < TL_DAYS; i++) {
        const d = new Date(t0.getFullYear(), t0.getMonth(), t0.getDate() + TL_START_OFFSET + i);
        const wknd = d.getDay() === 0 || d.getDay() === 6;
        const monthTag =
            d.getDate() === 1 || i === 0 ? `<b>${M[d.getMonth()]}${d.getMonth() === 0 || i === 0 ? ' ' + d.getFullYear() : ''}</b>` : '';
        head += `<span class="tl-day${wknd ? ' is-wknd' : ''}${dates[i] === todayIso ? ' is-today' : ''}" style="grid-column:${i + 1}">${monthTag}<i>${dows[d.getDay()]}</i>${d.getDate()}</span>`;
    }

    const keys = Object.keys(propertyMeta);
    const lock =
        '<svg viewBox="0 0 24 24" width="9" height="9" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px;margin-right:2px;opacity:0.75;" aria-hidden="true"><rect x="4" y="10.5" width="16" height="10" rx="2"/><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"/></svg>';
    const rows = keys
        .map((k) => {
            const meta = propertyMeta[k] || { name: k, short: k };
            let cells = '';
            for (let i = 0; i < TL_DAYS; i++) {
                const d = new Date(t0.getFullYear(), t0.getMonth(), t0.getDate() + TL_START_OFFSET + i);
                const wknd = d.getDay() === 0 || d.getDay() === 6;
                const past = dates[i] < todayIso;
                cells += `<span class="tl-cell${wknd ? ' is-wknd' : ''}${dates[i] === todayIso ? ' is-today' : ''}" style="grid-column:${i + 1}"${past ? '' : ` onclick="tlAddAt('${k}','${dates[i]}')" title="Add a booking at ${escapeHtml(meta.name)} from ${fmtDate(dates[i])}"`}></span>`;
            }
            let bars = '';
            // Bars run noon-to-noon (check-in afternoon → checkout morning): the
            // grid area covers check-in day THROUGH checkout day, and the CSS
            // insets each end by half a day — so back-to-back changeover
            // bookings visibly share the day, meeting mid-cell. Bars cut off by
            // the window edge drop the inset on that side (tl-clip-*).
            const tlSpan = (ci, co) => {
                const sIdx = idxOf(ci),
                    eIdx = idxOf(co);
                const s0 = Math.max(0, sIdx);
                const eL = Math.min(TL_DAYS + 1, Math.max(s0 + 2, eIdx + 2));
                const clip = `${sIdx < 0 ? ' tl-clip-l' : ''}${eIdx >= TL_DAYS ? ' tl-clip-r' : ''}`;
                return { col: `${s0 + 1}/${eL}`, clip };
            };
            (dbBookings[k] || []).forEach((b) => {
                if (!b.checkIn || !b.checkOut || b.checkOut <= dates[0] || b.checkIn >= dates[TL_DAYS - 1]) return;
                const sp = tlSpan(b.checkIn, b.checkOut);
                const ps = paymentSummary(k, b);
                const pay = ps.fullyPaid ? 'ok' : ps.deposit > 0 ? 'warn' : 'danger';
                bars += `<button type="button" class="tl-bar bar-${k} tl-pay-${pay}${sp.clip}" style="grid-column:${sp.col}" onclick="openBookingHub('${b.id}')" title="${escapeHtml(meta.name)} — ${escapeHtml(b.name || 'Guest')} · ${fmtDate(b.checkIn)} → ${fmtDate(b.checkOut)}">${escapeHtml((b.name || 'Guest').split(' ')[0])}</button>`;
            });
            (dbBlocks[k] || []).forEach((bl) => {
                if (!bl.checkIn || !bl.checkOut || bl.checkOut <= dates[0] || bl.checkIn >= dates[TL_DAYS - 1]) return;
                const sp = tlSpan(bl.checkIn, bl.checkOut);
                const src = bl.source ? bl.source.charAt(0).toUpperCase() + bl.source.slice(1) : 'External';
                bars += `<span class="tl-bar tl-ext${sp.clip}" style="grid-column:${sp.col}" title="${escapeHtml(meta.name)} — ${escapeHtml(src)} booking · ${fmtDate(bl.checkIn)} → ${fmtDate(bl.checkOut)}">${escapeHtml(src)}</span>`;
            });
            const priv = meta.unlisted ? lock : '';
            return `<div class="tl-row">
                <div class="tl-label" title="${escapeHtml(meta.name)}">${priv}${escapeHtml(meta.short || meta.name)}</div>
                <div class="tl-lane" style="grid-template-columns:repeat(${TL_DAYS}, var(--tl-day-w, 38px))">${cells}${bars}</div>
            </div>`;
        })
        .join('');

    host.innerHTML = `<div class="tl-inner">
        <div class="tl-row tl-headrow">
            <div class="tl-label"></div>
            <div class="tl-lane" style="grid-template-columns:repeat(${TL_DAYS}, var(--tl-day-w, 38px))">${head}</div>
        </div>
        ${rows}
    </div>`;
    if (!host.__tlScroll) {
        host.__tlScroll = true;
        host.addEventListener('scroll', tlSyncMonthLabel, { passive: true });
    }
    if (keepScroll !== null) host.scrollLeft = keepScroll;
    else {
        host.scrollLeft = Math.max(0, (-TL_START_OFFSET - 2) * tlDayW());
        __tlScrolled = true;
    }
    tlSyncMonthLabel();
}

// A small "returning guest" pill for an enquiry whose email matches one or more
// COMPLETED past bookings (computed server-side in enquiries.php). Empty for
// first-time guests, so it only ever adds signal.
function repeatGuestBadge(e) {
    const n = (e && e.priorStays) || 0;
    if (n < 1) return '';
    let last = '';
    if (e.lastStayEnd) {
        const d = new Date(e.lastStayEnd + 'T00:00:00');
        if (!isNaN(d.getTime())) {
            last = ' · last ' + d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
        }
    }
    const text = 'Returning guest' + (n > 1 ? ` · ${n} stays` : '') + last;
    const tip = `Matched by email to ${n} completed booking${n === 1 ? '' : 's'}`;
    return ` <span class="repeat-badge" title="${escapeHtml(tip)}"><svg class="ic" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 3.5l2.6 5.27 5.82.85-4.21 4.1.99 5.78L12 17.77 6.8 19.5l.99-5.78-4.21-4.1 5.82-.85z"/></svg>${escapeHtml(text)}</span>`;
}

// Availability of an enquiry's dates, checked client-side against the same data
// the approval clash-guard uses (own bookings + imported OTA blocks). Returns a
// chip descriptor so the owner sees free/clash BEFORE deciding, not only at Approve.
function enquiryAvailability(e) {
    if (!e.checkIn || !e.checkOut || !e.propKey) return null;
    const bk = (dbBookings[e.propKey] || []).find(
        (b) => e.checkIn < b.checkOut && e.checkOut > b.checkIn,
    );
    if (bk) return { free: false, text: 'Clashes with ' + ((bk.name || '').split(' ')[0] || 'a booking') };
    const bl = (dbBlocks[e.propKey] || []).find(
        (x) => e.checkIn < x.checkOut && e.checkOut > x.checkIn,
    );
    if (bl) return { free: false, text: 'Clashes with ' + (bl.source || 'an external') + ' block' };
    return { free: true, text: 'Dates available' };
}
// Whole days since the enquiry arrived (for the age label + stale highlight).
function enquiryAgeDays(e) {
    const raw = e.receivedAt || e.received;
    if (!raw) return 0;
    const t = new Date(String(raw).replace(' ', 'T')).getTime();
    if (isNaN(t)) return 0;
    return Math.max(0, Math.floor((Date.now() - t) / 86400000));
}
const ENQUIRY_STALE_DAYS = 3; // amber-flag enquiries waiting longer than this
let inboxSort = 'soonest'; // soonest arrival | newest | cottage
function setInboxSort(v) {
    inboxSort = v;
    try {
        renderInbox();
    } catch (e) {}
}
function sortedEnquiries() {
    const list = enquiries.slice();
    const nm = (e) => (propertyMeta[e.propKey] ? propertyMeta[e.propKey].name : e.propKey) || '';
    if (inboxSort === 'newest') {
        list.sort((a, b) => String(b.receivedAt || b.received).localeCompare(String(a.receivedAt || a.received)));
    } else if (inboxSort === 'cottage') {
        list.sort((a, b) => nm(a).localeCompare(nm(b)) || String(a.checkIn).localeCompare(String(b.checkIn)));
    } else {
        // soonest arrival first, then most recently received
        list.sort(
            (a, b) =>
                String(a.checkIn).localeCompare(String(b.checkIn)) ||
                String(b.receivedAt || b.received).localeCompare(String(a.receivedAt || a.received)),
        );
    }
    // Long-waiting enquiries float to the top of whatever order is chosen, so an
    // old unanswered one can't sink below an imminent-stay request (stable sort
    // keeps the sub-order within each group).
    list.sort(
        (a, b) =>
            (enquiryAgeDays(b) >= ENQUIRY_STALE_DAYS ? 1 : 0) -
            (enquiryAgeDays(a) >= ENQUIRY_STALE_DAYS ? 1 : 0),
    );
    return list;
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
        // The docked pane must not keep showing the last (now handled) enquiry.
        __enqHubId = null;
        const ehc = document.getElementById('enquiry-hub-content');
        if (ehc) ehc.innerHTML = '';
        markInboxSelection();
        return;
    }

    // Sort control — only worth showing with more than one enquiry.
    const sortBar =
        enquiries.length > 1
            ? `<div class="inbox-sort seg" role="group" aria-label="Sort enquiries">${[
                  ['soonest', 'Soonest stay'],
                  ['newest', 'Newest'],
                  ['cottage', 'Cottage'],
              ]
                  .map(
                      ([k, lbl]) =>
                          `<button type="button" class="inbox-sort-btn${inboxSort === k ? ' is-on' : ''}" onclick="setInboxSort('${k}')">${lbl}</button>`,
                  )
                  .join('')}</div>`
            : '';

    // Compact index rows (same anatomy as the Bookings dashboard) — the whole
    // row opens the enquiry HUB, which owns the detail + every action.
    list.innerHTML =
        sortBar +
        sortedEnquiries()
            .map((e) => {
                const meta = propertyMeta[e.propKey];
                const propName = meta ? meta.name : e.propKey; // survive a missing/added cottage
                const av = enquiryAvailability(e);
                const days = enquiryAgeDays(e);
                const stale = days >= ENQUIRY_STALE_DAYS;
                let priceLabel = '';
                try {
                    const pr = priceBreakdown(e.propKey, e.adults, e.children, e.checkIn, e.checkOut);
                    priceLabel =
                        e.priceOverride != null
                            ? ` · agreed ${gbp(e.priceOverride)}`
                            : pr && pr.total > 0
                              ? ` · est. ${gbp(pr.total)}`
                              : '';
                } catch (err) {}
                const chip = av
                    ? `<span class="bk-chip ${av.free ? 'ok' : 'danger'}"><span class="bk-dot"></span>${escapeHtml(av.text)}${stale ? ` · ${days}d waiting` : ''}</span>`
                    : `<span class="bk-chip warn"><span class="bk-dot"></span>${stale ? `${days}d waiting` : 'New enquiry'}</span>`;
                return `
                <button type="button" class="bk-row glass-panel${stale ? ' pay-warn' : ''}${e.id === __enqHubId ? ' is-open' : ''}" data-enqid="${e.id}" onclick="openEnquiryHub('${e.id}')">
                    <span class="bk-row-body">
                        <span class="bk-row-top">
                            <span class="prop-tag tag-${e.propKey}">${escapeHtml(propName)}</span>
                            ${chip}
                        </span>
                        <strong class="bk-row-name">${escapeHtml(e.name)}${(e.priorStays || 0) > 0 ? ' ★' : ''}</strong>
                        <span class="bk-row-dates">${fmtStayRange(e.checkIn, e.checkOut)} · ${escapeHtml(e.guests)}${priceLabel}</span>
                    </span>
                    <span class="bk-row-arrow" aria-hidden="true">›</span>
                </button>`;
        })
        .join('');
    // Wide split: keep the docked pane in sync; open the first enquiry when
    // nothing is selected yet so the workspace never sits with an empty pane.
    // ONLY while the Inbox is the active view — renderInbox() also runs from
    // the dashboard init, and auto-selecting there would navigate away.
    if (inboxSplitWide() && (document.querySelector('.page-view.active') || {}).id === 'view-inbox') {
        const listNow = sortedEnquiries();
        if (__enqHubId && !enquiries.find((x) => x.id === __enqHubId)) __enqHubId = null;
        if (!__enqHubId && listNow.length) {
            openEnquiryHub(listNow[0].id);
            return;
        }
        markInboxSelection();
    }
}

// ==================================================================
//  ENQUIRY HUB — ONE home per enquiry (view-enquiry-hub / docked pane).
//  Mirrors the booking hub: the index rows are for finding, this is for
//  reading + acting (approve, edit, email, decline, agreed price).
// ==================================================================
let __enqHubId = null;
function inboxSplitWide() {
    return !!(document.getElementById('inbox-detail-pane') && window.matchMedia('(min-width: 1200px)').matches);
}
function markInboxSelection() {
    document
        .querySelectorAll('#inbox-list .bk-row')
        .forEach((r) => r.classList.toggle('is-open', r.getAttribute('data-enqid') === __enqHubId));
    const empty = document.getElementById('inbox-detail-empty');
    const pane = document.getElementById('inbox-detail-pane');
    const content = document.getElementById('enquiry-hub-content');
    if (inboxSplitWide() && __enqHubId && pane && content && content.parentElement !== pane) {
        pane.appendChild(content);
        renderEnquiryHub();
    }
    if (empty && pane) empty.style.display = __enqHubId && content && content.parentElement === pane ? 'none' : '';
}
async function openEnquiryHub(enqId) {
    if (!isAuthenticated) {
        tryAccessBackOffice();
        return;
    }
    let e = enquiries.find((x) => x.id === enqId);
    if (!e) {
        try {
            await loadData();
        } catch (err) {}
        e = enquiries.find((x) => x.id === enqId);
    }
    if (!e) {
        toast('That enquiry is no longer here.', 'error');
        openInbox();
        return;
    }
    __enqHubId = enqId;
    const content = document.getElementById('enquiry-hub-content');
    const prev = document.querySelector('.page-view.active');
    if (inboxSplitWide()) {
        const pane = document.getElementById('inbox-detail-pane');
        if (content && pane && content.parentElement !== pane) pane.appendChild(content);
        if (!prev || prev.id !== 'view-inbox') {
            nav('view-inbox');
            adminHistPush('view-inbox');
        }
        markInboxSelection();
    } else {
        const home = document.getElementById('view-enquiry-hub');
        if (content && home && content.parentElement !== home) home.appendChild(content);
        const alreadyHere = prev && prev.id === 'view-enquiry-hub';
        nav('view-enquiry-hub');
        if (!alreadyHere) adminHistPush('view-enquiry-hub', null, { enqHub: enqId });
        window.scrollTo({ top: 0 });
    }
    renderEnquiryHub();
}
function enquiryHubBack() {
    openInbox();
}
function renderEnquiryHub() {
    const el = document.getElementById('enquiry-hub-content');
    if (!el) return;
    const e = enquiries.find((x) => x.id === __enqHubId);
    if (!e) {
        el.innerHTML = '<div class="hub-empty" style="margin-top:30px;">This enquiry is no longer here.</div>';
        return;
    }
    const meta = propertyMeta[e.propKey] || { name: e.propKey };
    const av = enquiryAvailability(e);
    const days = enquiryAgeDays(e);
    const stale = days >= ENQUIRY_STALE_DAYS;
    const ageRaw = timeAgoLabel(e.receivedAt || e.received) || e.received || '';
    const agePart = ageRaw && !/invalid/i.test(String(ageRaw)) ? ` · received ${escapeHtml(String(ageRaw))}` : '';
    let priceLine = '';
    try {
        const pr = priceBreakdown(e.propKey, e.adults, e.children, e.checkIn, e.checkOut);
        const std = pr && pr.total > 0 ? pr.total : null;
        priceLine =
            e.priceOverride != null
                ? `Agreed price <strong>${gbp(e.priceOverride)}</strong>${std ? ` <span class="bhub-mut" style="margin:0;">(standard ${gbp(std)})</span>` : ''}`
                : std
                  ? `Site price <strong>${gbp(std)}</strong>`
                  : 'Price unavailable';
    } catch (err) {
        priceLine = 'Price unavailable';
    }
    const chips =
        (av ? `<span class="bk-chip ${av.free ? 'ok' : 'danger'}"><span class="bk-dot"></span>${escapeHtml(av.text)}</span>` : '') +
        (stale ? `<span class="bk-chip warn" style="margin-left:6px;"><span class="bk-dot"></span>${days}d waiting</span>` : '');
    // The one next step, spelled out like the booking hub's next-action box.
    const next = av && !av.free
        ? { text: 'These dates now clash with another booking — adjust the dates (Edit) or decline.', cls: '' }
        : { text: `Free to approve — this creates the booking, emails the confirmation${e.email ? ' and requests the deposit by card' : ''}.`, cls: ' is-clear' };
    const contact = (label, val) =>
        `<div class="booking-detail-item"><span class="booking-detail-label">${label}</span><span class="booking-detail-value" style="font-size:0.95rem;">${val || '<span class="bhub-mut" style="margin:0;">—</span>'}</span></div>`;
    el.innerHTML = `
        <div class="bhub-head glass-panel">
            <div class="bhub-head-top">
                <div>
                    <span class="prop-tag tag-${e.propKey}">${escapeHtml(meta.name)}</span>
                    <h1 class="bhub-name">${escapeHtml(e.name || 'Guest')}</h1>
                    <div class="bhub-sub">${fmtStayRange(e.checkIn, e.checkOut)} · ${escapeHtml(e.guests)}${agePart}</div>
                    <div style="margin-top:8px;">${chips}</div>
                </div>
                <div class="bhub-actions">
                    <button class="btn-sm btn-approve" onclick="approveEnquiry('${e.id}')">✓ Approve booking</button>
                    <button class="btn-sm btn-edit" onclick="openEditEnquiry('${e.id}')">Edit / Move</button>
                    ${e.email ? `<button class="btn-sm btn-edit" onclick="openEnquiryEmail('${e.id}')">Email guest</button>` : ''}
                    <button class="btn-sm btn-decline" onclick="declineEnquiry('${e.id}')">Decline</button>
                </div>
            </div>
            <div class="bhub-next${next.cls}"><span class="bhub-next-text">${next.text}</span></div>
        </div>
        <div class="bhub-grid">
            <section class="bhub-card glass-panel">
                <h3 class="bhub-card-title">Message &amp; contact</h3>
                ${e.message ? `<div class="enq-ctx-quote" style="margin:0 0 14px;">“${escapeHtml(e.message)}”</div>` : '<div class="bhub-mut" style="margin:0 0 14px;">No message left.</div>'}
                <div class="detail-grid" style="margin-top:0;">
                    ${contact('Email', e.email ? `<a href="mailto:${escapeHtml(e.email)}" style="color:var(--text-light);">${escapeHtml(e.email)}</a>` : '')}
                    ${contact('Phone', e.phone ? `<a href="tel:${escapeHtml(e.phone)}" style="color:var(--text-light);">${escapeHtml(e.phone)}</a>` : '')}
                    <div class="booking-detail-item" style="grid-column:1/-1;"><span class="booking-detail-label">Home address</span><span class="booking-detail-value" style="font-size:0.95rem;white-space:pre-wrap;">${e.address || e.postcode ? escapeHtml([e.address, e.postcode].filter(Boolean).join(', ')) : '<span class="bhub-mut" style="margin:0;">—</span>'}</span></div>
                </div>
            </section>
            <section class="bhub-card glass-panel">
                <h3 class="bhub-card-title">Price &amp; history</h3>
                <div style="font-size:0.95rem;">${priceLine}</div>
                <div class="bhub-btn-row" style="margin-top:10px;">
                    <button class="btn-sm btn-edit" onclick="setEnquiryPrice('${e.id}')">${e.priceOverride != null ? 'Change agreed price' : 'Set an agreed price'}</button>
                </div>
                <div style="margin-top:16px;">${repeatGuestBadge(e) || '<span class="bhub-mut" style="margin:0;">First-time guest (no completed stays on this email).</span>'}</div>
            </section>
        </div>`;
}

// ---- Email a guest straight from the Inbox / Bookings (house style + details attached) ----
// One shared composer (#enq-email-modal). __composeTarget carries which kind of
// record we're emailing so sendEnquiryEmail() posts to the right endpoint.
let __composeTarget = null;
function openEnquiryEmail(enqId) {
    const enq = enquiries.find((e) => e.id === enqId);
    if (!enq) return;
    if (!enq.email) {
        glassAlert('This enquiry has no email address.');
        return;
    }
    __composeTarget = { kind: 'enquiry', enq };
    __composeAttachments = [];
    renderComposeAttachChips();
    backToComposeEdit();
    const propName = (propertyMeta[enq.propKey] && propertyMeta[enq.propKey].name) || enq.propKey;
    // Key details, visible while writing: who + cottage + dates + party + phone
    // + the price the site quoted + their original message — everything needed
    // to reply without closing the sheet.
    const ctx = document.getElementById('enq-email-context');
    if (ctx) {
        let priceRow = '';
        try {
            const p = priceBreakdown(enq.propKey, enq.adults, enq.children, enq.checkIn, enq.checkOut);
            if (p && p.total) {
                priceRow = `<div class="enq-ctx-row"><span class="enq-ctx-ic"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="5" width="20" height="14" rx="2.5"/><path d="M2 10h20"/></svg></span><span class="enq-ctx-txt"><strong>${gbp(p.total)}</strong><span class="enq-ctx-mut"> · ${p.nights} night${p.nights === 1 ? '' : 's'} × ${gbp(p.perNight)}${p.damagesDeposit ? ` · +${gbp(p.damagesDeposit)} refundable deposit` : ''}</span></span></div>`;
            }
        } catch (e) {}
        const initial = (enq.name || enq.email || '?').trim().charAt(0).toUpperCase();
        ctx.innerHTML = `
            <div class="enq-ctx-who">
                <span class="enq-ctx-avatar">${escapeHtml(initial)}</span>
                <span class="enq-ctx-name">${escapeHtml(enq.name || 'Guest')}<span class="enq-ctx-mut" style="display:block;font-weight:400;">${escapeHtml(enq.email)}</span></span>
                <span class="prop-tag tag-${enq.propKey}" style="margin-left:auto;flex-shrink:0;">${escapeHtml(propName)}</span>
            </div>
            <div class="enq-ctx-row"><span class="enq-ctx-ic"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4.5" width="18" height="16" rx="2.5"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/></svg></span><span class="enq-ctx-txt"><strong>${escapeHtml(fmtDate(enq.checkIn))}</strong>&nbsp;→&nbsp;<strong>${escapeHtml(fmtDate(enq.checkOut))}</strong></span></div>
            <div class="enq-ctx-row"><span class="enq-ctx-ic"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21v-1a6 6 0 0 1 12 0v1"/></svg></span><span class="enq-ctx-txt">${escapeHtml(enq.guests)}${enq.phone ? `<span class="enq-ctx-mut"> · ${escapeHtml(enq.phone)}</span>` : ''}</span></div>
            ${priceRow}
            ${enq.message ? `<div class="enq-ctx-quote">“${escapeHtml(enq.message)}”</div>` : ''}`;
    }
    const subj = document.getElementById('enq-email-subject');
    if (subj) subj.value = `Your enquiry — ${propName}, ${fmtDate(enq.checkIn)} to ${fmtDate(enq.checkOut)}`;
    const body = document.getElementById('enq-email-body');
    if (body) body.value = '';
    const msg = document.getElementById('enq-email-msg');
    if (msg) {
        msg.textContent = '';
        msg.classList.remove('show');
    }
    const m = document.getElementById('enq-email-modal');
    if (m) m.classList.add('open');
    if (body) setTimeout(() => body.focus(), 150);
}
function closeEnquiryEmailModal() {
    const m = document.getElementById('enq-email-modal');
    if (m) m.classList.remove('open');
    backToComposeEdit(); // reset to the compose view for next time
    __composeTarget = null;
    __composeAttachments = [];
    renderComposeAttachChips();
}
// Toggle the composer back from the preview to the editing view.
function backToComposeEdit() {
    const pv = document.getElementById('enq-email-preview');
    const ed = document.getElementById('enq-email-edit');
    if (pv) pv.style.display = 'none';
    if (ed) ed.style.display = '';
}
// Render the exact email the guest will receive, in an iframe, before sending.
// Built server-side (build_enquiry_reply_email) so the preview can't drift from
// what actually goes out.
async function previewComposedEmail() {
    const t = __composeTarget;
    if (!t) return;
    const body = (document.getElementById('enq-email-body') || {}).value || '';
    const subject = (document.getElementById('enq-email-subject') || {}).value || '';
    const msgEl = document.getElementById('enq-email-msg');
    const note = (m) => {
        if (msgEl) {
            msgEl.textContent = m;
            msgEl.classList.add('show');
        }
    };
    if (!body.trim()) {
        note('Write a message first to preview it.');
        return;
    }
    const btn = document.getElementById('enq-email-preview-btn');
    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Loading…';
    }
    try {
        const rec = t.kind === 'booking' ? t.b : t.enq;
        const r = await apiPost(t.kind === 'booking' ? 'bookings.php' : 'enquiries.php', {
            action: 'email_preview',
            id: rec.dbId,
            subject: subject.trim(),
            message: body.trim(),
        });
        const frame = document.getElementById('enq-email-preview-frame');
        if (frame)
            frame.srcdoc =
                r && r.html
                    ? r.html
                    : '<p style="font-family:sans-serif;padding:24px;color:#57524a;">Preview unavailable.</p>';
        document.getElementById('enq-email-edit').style.display = 'none';
        document.getElementById('enq-email-preview').style.display = '';
    } catch (e) {
        note("Couldn't build the preview: " + (e && e.message ? e.message : e));
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.textContent = 'Preview';
        }
    }
}
// ---- Custom-email attachments ----
// Files chosen in the composer, read to base64 for the email_guest payload.
let __composeAttachments = [];
const COMPOSE_ATTACH_MAX = 4;
const COMPOSE_ATTACH_MAX_EACH = 4 * 1024 * 1024; // 4 MB per file
const COMPOSE_ATTACH_MAX_TOTAL = 8 * 1024 * 1024; // 8 MB total (keeps the POST + email deliverable)
async function addComposeAttachments(fileList) {
    const files = Array.from(fileList || []);
    const input = document.getElementById('enq-email-file-input');
    if (input) input.value = ''; // allow re-picking the same file later
    for (const f of files) {
        if (__composeAttachments.length >= COMPOSE_ATTACH_MAX) {
            glassAlert(`You can attach up to ${COMPOSE_ATTACH_MAX} files.`);
            break;
        }
        if (f.size > COMPOSE_ATTACH_MAX_EACH) {
            glassAlert(`"${f.name}" is too big (max ${Math.round(COMPOSE_ATTACH_MAX_EACH / 1024 / 1024)} MB each).`);
            continue;
        }
        const total = __composeAttachments.reduce((s, a) => s + a.size, 0) + f.size;
        if (total > COMPOSE_ATTACH_MAX_TOTAL) {
            glassAlert('That would exceed the total attachment size (12 MB).');
            break;
        }
        try {
            const content = await new Promise((resolve, reject) => {
                const r = new FileReader();
                r.onload = () => resolve(String(r.result).split(',')[1] || '');
                r.onerror = () => reject(new Error('read failed'));
                r.readAsDataURL(f);
            });
            __composeAttachments.push({
                filename: f.name || 'attachment',
                mime: f.type || 'application/octet-stream',
                size: f.size,
                content,
            });
        } catch (e) {
            glassAlert(`Couldn't read "${f.name}".`);
        }
    }
    renderComposeAttachChips();
}
function removeComposeAttachment(i) {
    __composeAttachments.splice(i, 1);
    renderComposeAttachChips();
}
function renderComposeAttachChips() {
    const el = document.getElementById('enq-email-attach-list');
    if (!el) return;
    el.innerHTML = __composeAttachments
        .map((a, i) => {
            const kb = a.size < 1024 * 1024 ? Math.round(a.size / 1024) + ' KB' : (a.size / 1024 / 1024).toFixed(1) + ' MB';
            return `<span class="compose-attach-chip">${escapeHtml(a.filename)} <span style="color:var(--text-muted);">· ${kb}</span><button type="button" aria-label="Remove" onclick="removeComposeAttachment(${i})">×</button></span>`;
        })
        .join('');
}

async function sendEnquiryEmail() {
    const t = __composeTarget;
    if (!t) return;
    const body = (document.getElementById('enq-email-body') || {}).value || '';
    const subject = (document.getElementById('enq-email-subject') || {}).value || '';
    const msgEl = document.getElementById('enq-email-msg');
    const note = (m) => {
        if (msgEl) {
            msgEl.textContent = m;
            msgEl.classList.add('show');
        }
    };
    if (!body.trim()) {
        note('Please write a message first.');
        return;
    }
    const btn = document.getElementById('enq-email-send');
    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Sending…';
    }
    try {
        const rec = t.kind === 'booking' ? t.b : t.enq;
        await apiPost(t.kind === 'booking' ? 'bookings.php' : 'enquiries.php', {
            action: 'email_guest',
            id: rec.dbId,
            subject: subject.trim(),
            message: body.trim(),
            attachments: __composeAttachments.map((a) => ({ filename: a.filename, mime: a.mime, content: a.content })),
        });
        closeEnquiryEmailModal();
        toast(`Email sent to ${rec.name || rec.email}.`);
        // Refresh the per-booking email log so the new send appears immediately.
        if (t.kind === 'booking') {
            try {
                await loadBookingEmailLogs();
                if ((document.querySelector('.page-view.active') || {}).id === 'view-backoffice')
                    renderBookings();
            } catch (e) {}
        }
    } catch (e) {
        note("Couldn't send: " + e.message);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.textContent = 'Send email';
        }
    }
}
// Compose a free-text email to a confirmed booking's guest (Bookings page).
// Reuses the enquiry composer; the booking details + price ride along.
function openBookingEmail(bookingId) {
    const b = typeof findBookingById === 'function' ? findBookingById(bookingId) : null;
    const loc = typeof findBookingLocation === 'function' ? findBookingLocation(bookingId) : null;
    if (!b || !loc) return;
    if (!b.email) {
        glassAlert('This booking has no email address on file.');
        return;
    }
    __composeTarget = { kind: 'booking', b, propKey: loc.propKey };
    __composeAttachments = [];
    renderComposeAttachChips();
    backToComposeEdit();
    const propName = (propertyMeta[loc.propKey] && propertyMeta[loc.propKey].name) || loc.propKey;
    const ctx = document.getElementById('enq-email-context');
    if (ctx) {
        let priceRow = '';
        try {
            const p =
                b.agreedPrice ||
                priceBreakdown(loc.propKey, b.adults, b.children, b.checkIn, b.checkOut);
            const ps = paymentSummary(loc.propKey, b);
            const gt = displayGrand(p, ps, b.holdStatus);
            const status = gt.fullyPaid
                ? 'Paid in full'
                : gt.paid > 0
                  ? `${gbp(gt.balance)} balance due`
                  : `${gbp(gt.balance)} due`;
            priceRow = `<div class="enq-ctx-row"><span class="enq-ctx-ic"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="5" width="20" height="14" rx="2.5"/><path d="M2 10h20"/></svg></span><span class="enq-ctx-txt"><strong>${gbp(gt.total)}</strong><span class="enq-ctx-mut"> · ${status} · ${bookingRef(b.id)}</span></span></div>`;
        } catch (e) {}
        const initial = (b.name || b.email || '?').trim().charAt(0).toUpperCase();
        ctx.innerHTML = `
            <div class="enq-ctx-who">
                <span class="enq-ctx-avatar">${escapeHtml(initial)}</span>
                <span class="enq-ctx-name">${escapeHtml(b.name || 'Guest')}<span class="enq-ctx-mut" style="display:block;font-weight:400;">${escapeHtml(b.email)}</span></span>
                <span class="prop-tag tag-${loc.propKey}" style="margin-left:auto;flex-shrink:0;">${escapeHtml(propName)}</span>
            </div>
            <div class="enq-ctx-row"><span class="enq-ctx-ic"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4.5" width="18" height="16" rx="2.5"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/></svg></span><span class="enq-ctx-txt"><strong>${escapeHtml(fmtDate(b.checkIn))}</strong>&nbsp;→&nbsp;<strong>${escapeHtml(fmtDate(b.checkOut))}</strong></span></div>
            <div class="enq-ctx-row"><span class="enq-ctx-ic"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21v-1a6 6 0 0 1 12 0v1"/></svg></span><span class="enq-ctx-txt">${escapeHtml(b.guests || '')}${b.phone ? `<span class="enq-ctx-mut"> · ${escapeHtml(b.phone)}</span>` : ''}</span></div>
            ${priceRow}`;
    }
    const subj = document.getElementById('enq-email-subject');
    if (subj) subj.value = `Your booking — ${propName}, ${fmtDate(b.checkIn)} to ${fmtDate(b.checkOut)}`;
    const body = document.getElementById('enq-email-body');
    if (body) body.value = '';
    const msg = document.getElementById('enq-email-msg');
    if (msg) {
        msg.textContent = '';
        msg.classList.remove('show');
    }
    const m = document.getElementById('enq-email-modal');
    if (m) m.classList.add('open');
    if (body) setTimeout(() => body.focus(), 150);
}

async function declineEnquiry(enqId) {
    if (!(await glassConfirm('Decline and remove this enquiry? This cannot be undone.'))) return;
    const enq = enquiries.find((e) => e.id === enqId);
    if (!enq) return;
    try {
        await apiPost('enquiries.php', { action: 'decline', id: enq.dbId });
        if (__enqHubId === enqId) __enqHubId = null;
        await loadData();
        // Standalone hub screen for the declined enquiry → back to the Inbox
        // (the wide pane re-selects the next enquiry via renderInbox()).
        const hubView = document.getElementById('view-enquiry-hub');
        if (hubView && hubView.classList.contains('active')) {
            openInbox();
        } else {
            renderInbox();
        }
        toast(`Enquiry declined — ${enq.name || 'guest'} removed from the inbox.`);
    } catch (e) {
        glassAlert("Couldn't decline: " + e.message);
    }
}

// Set a negotiated total for an enquiry BEFORE approving it — the same "override
// total price" the manual Add Booking modal has. Held client-side on the enquiry
// and sent with the approve, which snapshots it as the agreed price.
async function setEnquiryPrice(enqId) {
    const enq = enquiries.find((e) => e.id === enqId);
    if (!enq) return;
    let std = null;
    try {
        const p = priceBreakdown(enq.propKey, enq.adults, enq.children, enq.checkIn, enq.checkOut);
        std = p && p.total ? p.total : null;
    } catch (e) {}
    const vals = await glassForm(
        `Agreed price for ${enq.name || 'this enquiry'}${std ? ` — the standard price is ${gbp(std)}` : ''}.\nApproving will use this figure for the confirmation email and payment request. Leave blank to charge the standard price.`,
        [
            {
                id: 'price',
                label: 'Agreed total (£)',
                type: 'number',
                min: 0,
                step: 0.01,
                value: enq.priceOverride != null ? enq.priceOverride : '',
                placeholder: std ? `Standard: ${gbp(std)}` : 'e.g. 400',
            },
        ],
    );
    if (vals === null) return;
    const raw = String(vals.price || '').trim();
    const n = Math.round((parseFloat(raw) || 0) * 100) / 100;
    enq.priceOverride = raw !== '' && n > 0 ? n : null;
    renderInbox();
    if (__enqHubId === enqId) {
        try {
            renderEnquiryHub();
        } catch (e) {}
    }
    toast(
        enq.priceOverride != null
            ? `Agreed price set — approving will charge ${gbp(enq.priceOverride)}.`
            : 'Standard price will be used.',
    );
}

async function approveEnquiry(enqId) {
    const enq = enquiries.find((e) => e.id === enqId);
    if (!enq) return;
    // Guard against a cottage that's been archived/removed since the enquiry —
    // propertyMeta[propKey] can be undefined, and a throw here after the server
    // has already confirmed would show a false "couldn't approve" error.
    const propName = (propertyMeta[enq.propKey] && propertyMeta[enq.propKey].name) || enq.propKey || 'the cottage';
    if (hasDateClash(enq.propKey, enq.checkIn, enq.checkOut)) {
        if (
            !(await glassConfirm(
                `Heads up: these dates clash with an existing booking or an imported Airbnb/Vrbo block at ${propName}. Approve anyway?`,
            ))
        )
            return;
    }
    try {
        const req = { action: 'approve', id: enq.dbId };
        if (enq.priceOverride != null) req.price_override = enq.priceOverride;
        const res = await apiPost('enquiries.php', req);
        await loadData();
        renderInbox();
        renderCalendar();
        showChangeoverToasts();
        // Happy path = one non-blocking toast covering the whole outcome —
        // confirmation email AND (previously invisible in-app) the automatic
        // payment request. A blocking alert only when something needs attention.
        const em = res && res.email;
        const guestOk = em && em.guest && em.guest.ok;
        const guestErr = em && em.guest && !em.guest.ok && em.guest.error && em.guest.error !== 'Mail disabled' ? em.guest.error : null;
        const payOk = res && res.payment_request && res.payment_request.ok;
        const attention = [];
        if (guestErr) attention.push(`the confirmation email didn't send (${guestErr})`);
        if (res && res.email_check) attention.push(res.email_check);
        if (attention.length) {
            glassAlert(
                `Booking confirmed for ${enq.name} at ${propName} — it's on the calendar.\n\nNeeds attention: ` +
                    attention.join('\n') +
                    '\n\nThe booking is still confirmed — you may want to contact the guest directly.',
            );
            // The booking WAS created — land on its hub like the happy path.
            if (__enqHubId === enqId) __enqHubId = null;
            if (res.booking_id) {
                try {
                    openBookingHub('b' + res.booking_id);
                } catch (e) {}
            }
        } else {
            toast(
                `Booked: ${enq.name} at ${propName}` +
                    (enq.priceOverride != null ? ` · agreed ${gbp(enq.priceOverride)}` : '') +
                    (guestOk ? ' · confirmation sent' : '') +
                    (payOk ? ` · payment request sent (${gbp(res.payment_request.amount || 0)})` : ''),
            );
            // Land the owner on the booking this enquiry just became.
            if (__enqHubId === enqId) __enqHubId = null;
            if (res.booking_id) {
                try {
                    openBookingHub('b' + res.booking_id);
                } catch (e) {}
            }
        }
    } catch (e) {
        glassAlert("Couldn't approve: " + e.message);
    }
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
        ph = 0,
        exp = 0;
    try {
        const r = await apiPost('reviews.php', { action: 'list_admin' });
        rev = (r.reviews || []).filter((x) => x.status === 'pending').length;
    } catch (e) {}
    try {
        const r = await apiPost('photos.php', { action: 'list_admin' });
        ph = (r.photos || []).filter((x) => x.status === 'pending').length;
    } catch (e) {}
    try {
        const r = await apiPost('experiences.php', { action: 'list_admin' });
        exp = (r.experiences || []).filter((x) => x.status === 'pending').length;
    } catch (e) {}
    setBadge('reviews-pending-badge', rev);
    setBadge('photos-pending-badge', ph);
    setBadge('exp-pending-badge', exp);
    // Approvals now surface in Marketing's "To approve" rows (the badges above
    // point there) — the dashboard's Today panel is gone.
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
// Publish the facade-stubbed entry points (see app.js loadAdminBundle).

// ============================================================
//  Inbox → Email folder: the back office's email client on the cottage mailbox.
//  List/read/delete/attachments over POP3 via mailbox.php; compose/reply/CC
//  sends the branded coastal shell through the site's own smtp_send; "Sent"
//  is our own mail_sent ledger (POP3 can only read the INBOX). Received mail
//  renders as ESCAPED TEXT only — a hostile email can never run script
//  inside the owner's admin session. The reader recognises the sender
//  against bookings + enquiries and links straight to their hubs.
// ============================================================
let __mbxMessages = [];
let __mbxSent = [];
let __mbxTab = 'inbox';
let __mbxQuery = '';
let __mbxHasMore = false;
let __mbxLastOpen = null;
function mbxEsc(v) {
    return escapeHtml(String(v == null ? '' : v));
}
function mbxWhen(iso) {
    if (!iso) return '';
    const d = new Date(String(iso).replace(' ', 'T'));
    if (isNaN(d.getTime())) return '';
    const sameDay = d.toDateString() === new Date().toDateString();
    return sameDay
        ? d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
        : fmtDate(String(iso).slice(0, 10));
}
function mbxSize(n) {
    if (!n) return '';
    return n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
}
// Every guest the system knows (bookings + enquiries), deduped by email —
// powers the reader's context card and the compose To/CC autocomplete.
function mbxKnownGuests() {
    const map = {};
    Object.keys(dbBookings).forEach((pk) =>
        (dbBookings[pk] || []).forEach((b) => {
            const e = (b.email || '').toLowerCase();
            if (!e) return;
            (map[e] = map[e] || { email: b.email, name: b.name, bookings: [], enquiries: [] }).bookings.push({ pk, b });
        }),
    );
    (enquiries || []).forEach((q) => {
        const e = (q.email || '').toLowerCase();
        if (!e) return;
        (map[e] = map[e] || { email: q.email, name: q.name, bookings: [], enquiries: [] }).enquiries.push(q);
    });
    return map;
}
// The context card: who is this sender, and one-tap routes to their hubs.
function mbxContextHtml(fromEmail) {
    const e = (fromEmail || '').toLowerCase();
    if (!e) return '';
    const g = mbxKnownGuests()[e];
    if (!g) {
        return '<div class="mbx-ctx"><span class="bhub-mut">No bookings or enquiries found for this address.</span></div>';
    }
    const today = todayDashed();
    const chips = [];
    g.bookings
        .sort((a, z) => (z.b.checkIn || '').localeCompare(a.b.checkIn || ''))
        .slice(0, 4)
        .forEach(({ pk, b }) => {
            const meta = propertyMeta[pk] || { name: pk };
            const past = (b.checkOut || '') < today;
            chips.push(
                `<button type="button" class="bhub-stay-row" onclick="openBookingHub('${b.id}')"><span class="prop-tag tag-${pk}">${mbxEsc(meta.name)}</span><span>${fmtStayRange(b.checkIn, b.checkOut)}${past ? ' · past' : ''}</span><span class="bhub-mut">open →</span></button>`,
            );
        });
    g.enquiries.slice(0, 3).forEach((q) => {
        chips.push(
            `<button type="button" class="bhub-stay-row" onclick="openEnquiryHub('${q.id}')"><span class="bk-chip warn"><span class="bk-dot"></span>Enquiry</span><span>${fmtStayRange(q.checkIn, q.checkOut)}</span><span class="bhub-mut">open →</span></button>`,
        );
    });
    return `<div class="mbx-ctx">
        <div class="booking-detail-label" style="margin-bottom:6px;">Guest match — ${mbxEsc(g.name || g.email)}</div>
        ${chips.join('')}
    </div>`;
}
async function loadMailbox() {
    const el = document.getElementById('mailbox-body');
    if (!el) return;
    el.innerHTML = '<p style="font-size:0.85rem;color:var(--text-muted);">Checking the mailbox…</p>';
    // The context card + autocomplete need the guest data.
    try {
        if (!Object.keys(dbBookings).some((k) => (dbBookings[k] || []).length)) await loadData();
    } catch (e) {}
    try {
        const [inbox, sent] = await Promise.all([
            apiPost('mailbox.php', { action: 'list' }),
            apiPost('mailbox.php', { action: 'sent' }).catch(() => ({ messages: [] })),
        ]);
        __mbxMessages = inbox.messages || [];
        __mbxHasMore = !!inbox.hasMore;
        __mbxSent = sent.messages || [];
        __mbxTab = 'inbox';
        __mbxQuery = '';
        renderMailboxList();
    } catch (e) {
        el.innerHTML = `<div class="accounts-empty">Couldn't open the mailbox — ${mbxEsc(e.message)}</div>
            <div class="bhub-btn-row"><button class="btn-sm btn-edit" onclick="loadMailbox()">Try again</button></div>`;
    }
}
async function mailboxOlder() {
    try {
        const r = await apiPost('mailbox.php', { action: 'list', offset: __mbxMessages.length });
        __mbxMessages = __mbxMessages.concat(r.messages || []);
        __mbxHasMore = !!r.hasMore;
        renderMailboxList();
    } catch (e) {
        glassAlert("Couldn't load older messages: " + e.message);
    }
}
function mailboxTab(tab) {
    __mbxTab = tab === 'sent' ? 'sent' : 'inbox';
    renderMailboxList();
}
function mailboxSearch(q) {
    __mbxQuery = (q || '').toLowerCase();
    renderMailboxList(true);
}
function renderMailboxList(keepSearchFocus) {
    const el = document.getElementById('mailbox-body');
    if (!el) return;
    // Folder-switch chip: unread count over the FULL fetched list (not the
    // current search filter), so it reads like the other folders' counts.
    const mbxChip = document.getElementById('ifold-count-mbx');
    if (mbxChip) {
        const u = __mbxMessages.filter((m) => !m.seen).length;
        mbxChip.textContent = u > 0 ? u : '';
    }
    const q = __mbxQuery;
    const match = (t) => !q || String(t || '').toLowerCase().includes(q);
    let rows = '';
    if (__mbxTab === 'inbox') {
        rows = __mbxMessages
            .filter((m) => match(m.fromRaw) || match(m.from) || match(m.subject))
            .map((m) => {
                const unread = !m.seen;
                return `
        <button type="button" class="bk-row glass-panel${unread ? ' mbx-unread' : ''}" onclick="mailboxOpen('${mbxEsc(m.uid)}')">
            <span class="bk-row-body">
                <span class="bk-row-top">
                    ${unread ? '<span class="bk-chip warn"><span class="bk-dot"></span>New</span>' : ''}
                    <span class="mbx-when">${mbxEsc(mbxWhen(m.date))}</span>
                </span>
                <strong class="bk-row-name">${mbxEsc(m.fromRaw || m.from || 'Unknown sender')}</strong>
                <span class="bk-row-dates">${mbxEsc(m.subject)}</span>
            </span>
            <span class="bk-row-arrow" aria-hidden="true">›</span>
        </button>`;
            })
            .join('');
        if (__mbxHasMore && !q) {
            rows += '<div class="bhub-btn-row" style="justify-content:center;"><button class="btn-sm btn-edit" onclick="mailboxOlder()">Load older messages</button></div>';
        }
    } else {
        rows = __mbxSent
            .filter((m) => match(m.to_email) || match(m.subject))
            .map(
                (m) => `
        <button type="button" class="bk-row glass-panel" onclick="mailboxOpenSent(${m.id})">
            <span class="bk-row-body">
                <span class="bk-row-top"><span class="mbx-when">${mbxEsc(mbxWhen(m.sent_at))}</span></span>
                <strong class="bk-row-name">To: ${mbxEsc(m.to_email)}</strong>
                <span class="bk-row-dates">${mbxEsc(m.subject)}</span>
            </span>
            <span class="bk-row-arrow" aria-hidden="true">›</span>
        </button>`,
            )
            .join('');
    }
    el.innerHTML = `
        <div class="mbx-bar">
            <div class="inbox-sort seg" role="tablist" aria-label="Mailbox folders">
                <button class="inbox-sort-btn${__mbxTab === 'inbox' ? ' is-on' : ''}" role="tab" onclick="mailboxTab('inbox')">Inbox</button>
                <button class="inbox-sort-btn${__mbxTab === 'sent' ? ' is-on' : ''}" role="tab" onclick="mailboxTab('sent')">Sent</button>
            </div>
            <button class="btn-glass btn-accent cal-add-btn" onclick="mailboxCompose()">+ New email</button>
            <button class="btn-glass cal-add-btn" onclick="loadMailbox()">Refresh</button>
        </div>
        <div class="bo-search" style="margin-bottom:14px;">
            <input type="search" class="input-glass" id="mbx-search" placeholder="Search sender or subject…" autocomplete="off" value="${mbxEsc(q)}" oninput="mailboxSearch(this.value)" style="margin-bottom:0;">
        </div>
        ${rows || `<div class="accounts-empty">${q ? 'Nothing matches your search.' : __mbxTab === 'sent' ? 'Nothing sent from here yet.' : 'Nothing in the mailbox.'}</div>`}
        <div id="mbx-reader"></div>`;
    if (keepSearchFocus) {
        const sBox = document.getElementById('mbx-search');
        if (sBox) {
            sBox.focus();
            sBox.setSelectionRange(sBox.value.length, sBox.value.length);
        }
    }
}
async function mailboxOpen(uid) {
    const pane = document.getElementById('mbx-reader');
    if (!pane) return;
    pane.innerHTML = '<p style="font-size:0.85rem;color:var(--text-muted);margin-top:18px;">Opening…</p>';
    pane.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    try {
        const m = await apiPost('mailbox.php', { action: 'read', uid });
        const local = __mbxMessages.find((x) => x.uid === uid);
        if (local) local.seen = true;
        __mbxLastOpen = m;
        const atts = (m.attachments || [])
            .map(
                (a) => `<a class="mbx-att" href="mailbox.php?action=attachment&uid=${encodeURIComponent(uid)}&i=${a.i}" download>
                    <svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21.4 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.2-9.19a4 4 0 1 1 5.65 5.66l-9.2 9.19a2 2 0 0 1-2.82-2.83l8.49-8.48"/></svg>
                    ${mbxEsc(a.name)} <span class="bhub-mut">${mbxEsc(mbxSize(a.size))}</span></a>`,
            )
            .join('');
        pane.innerHTML = `
        <section class="bhub-card glass-panel" style="margin-top:18px;">
            <h3 class="bhub-card-title">${mbxEsc(m.subject)}</h3>
            <div class="mbx-meta">
                <div><span class="booking-detail-label">From</span> ${mbxEsc(m.fromRaw || m.from)}</div>
                <div><span class="booking-detail-label">Date</span> ${mbxEsc(mbxWhen(m.date))}</div>
            </div>
            ${mbxContextHtml(m.from)}
            <pre class="mbx-text">${mbxEsc(m.body || '(no text content)')}</pre>
            ${atts ? `<div class="mbx-atts">${atts}</div>` : ''}
            <div class="bhub-btn-row">
                <button class="btn-sm btn-edit" onclick="mailboxReply('${mbxEsc(uid)}')">Reply</button>
                <button class="btn-sm btn-edit" onclick="mailboxMarkUnread('${mbxEsc(uid)}')">Mark unread</button>
                <button class="btn-sm btn-edit" style="color:var(--danger);border-color:rgba(229,115,115,0.4);" onclick="mailboxDelete('${mbxEsc(uid)}')">Delete</button>
            </div>
            <div id="mbx-compose"></div>
        </section>`;
    } catch (e) {
        pane.innerHTML = `<div class="accounts-empty">${mbxEsc(e.message)}</div>`;
    }
}
function mailboxOpenSent(id) {
    const m = __mbxSent.find((x) => x.id === id);
    const pane = document.getElementById('mbx-reader');
    if (!m || !pane) return;
    pane.innerHTML = `
        <section class="bhub-card glass-panel" style="margin-top:18px;">
            <h3 class="bhub-card-title">${mbxEsc(m.subject)}</h3>
            <div class="mbx-meta">
                <div><span class="booking-detail-label">To</span> ${mbxEsc(m.to_email)}${m.cc_email ? ' · CC ' + mbxEsc(m.cc_email) : ''}</div>
                <div><span class="booking-detail-label">Sent</span> ${mbxEsc(mbxWhen(m.sent_at))}</div>
            </div>
            ${mbxContextHtml(m.to_email)}
            <pre class="mbx-text">${mbxEsc(m.body)}</pre>
        </section>`;
    pane.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
function mbxGuestDatalist() {
    const guests = mbxKnownGuests();
    const opts = Object.values(guests)
        .slice(0, 200)
        .map((g) => `<option value="${mbxEsc(g.email)}">${mbxEsc(g.name || '')}</option>`)
        .join('');
    return `<datalist id="mbx-guests">${opts}</datalist>`;
}
function mailboxComposeForm(target, presetTo, presetSubject, quoted) {
    target.innerHTML = `
        <div class="mbx-form">
            ${mbxGuestDatalist()}
            <label class="booking-detail-label" for="mbx-to">To</label>
            <input class="input-glass" id="mbx-to" type="email" inputmode="email" list="mbx-guests" autocomplete="off" placeholder="guest@example.com" value="${mbxEsc(presetTo || '')}" style="margin-bottom:10px;">
            <label class="booking-detail-label" for="mbx-cc">CC <span class="bhub-mut" style="text-transform:none;letter-spacing:0;">· optional</span></label>
            <input class="input-glass" id="mbx-cc" type="email" inputmode="email" list="mbx-guests" autocomplete="off" placeholder="" style="margin-bottom:10px;">
            <label class="booking-detail-label" for="mbx-subject">Subject</label>
            <input class="input-glass" id="mbx-subject" type="text" maxlength="300" value="${mbxEsc(presetSubject || '')}" style="margin-bottom:10px;">
            <label class="booking-detail-label" for="mbx-text">Message</label>
            <textarea class="input-glass" id="mbx-text" rows="8" maxlength="20000" style="resize:vertical;margin-bottom:10px;">${mbxEsc(quoted || '')}</textarea>
            <p class="bhub-mut" style="margin:0 0 10px;">Sends from the cottage mailbox with the site's coastal styling.</p>
            <div class="bhub-btn-row" style="margin-top:0;">
                <button class="btn-glass btn-accent cal-add-btn" id="mbx-send-btn" onclick="mailboxSend()">Send</button>
                <button class="btn-glass cal-add-btn" onclick="renderMailboxList()">Cancel</button>
            </div>
            <p id="mbx-msg" role="alert" style="font-size:0.85rem;color:var(--danger);margin:8px 0 0;"></p>
        </div>`;
    const focusEl = document.getElementById(presetTo ? 'mbx-text' : 'mbx-to');
    if (focusEl) focusEl.focus();
}
function mailboxCompose(presetTo) {
    const pane = document.getElementById('mbx-reader');
    if (!pane) return;
    pane.innerHTML = `<section class="bhub-card glass-panel" style="margin-top:18px;">
        <h3 class="bhub-card-title">New email</h3><div id="mbx-compose"></div></section>`;
    mailboxComposeForm(document.getElementById('mbx-compose'), presetTo || '');
    pane.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
function mailboxReply(uid) {
    const box = document.getElementById('mbx-compose');
    const m = __mbxLastOpen && __mbxLastOpen.uid === uid ? __mbxLastOpen : null;
    if (!box || !m) return;
    const subj = /^re:/i.test(m.subject || '') ? m.subject : 'Re: ' + (m.subject || '');
    const quoted =
        '\n\nOn ' + (mbxWhen(m.date) || 'an earlier date') + ', ' + (m.fromRaw || m.from || 'they') + ' wrote:\n' +
        String(m.body || '')
            .split('\n')
            .map((l) => '> ' + l)
            .join('\n');
    mailboxComposeForm(box, m.from || '', subj, quoted);
}
async function mailboxSend() {
    const to = ((document.getElementById('mbx-to') || {}).value || '').trim();
    const cc = ((document.getElementById('mbx-cc') || {}).value || '').trim();
    const subject = ((document.getElementById('mbx-subject') || {}).value || '').trim();
    const body = (document.getElementById('mbx-text') || {}).value || '';
    const msg = document.getElementById('mbx-msg');
    const btn = document.getElementById('mbx-send-btn');
    if (msg) msg.textContent = '';
    const emailOk = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
    if (!emailOk(to)) {
        if (msg) msg.textContent = 'Please enter a valid "To" email address.';
        return;
    }
    if (cc && !emailOk(cc)) {
        if (msg) msg.textContent = 'The CC address doesn’t look right — please check it.';
        return;
    }
    if (!subject || !body.trim()) {
        if (msg) msg.textContent = 'A subject and a message are both required.';
        return;
    }
    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Sending…';
    }
    try {
        await apiPost('mailbox.php', { action: 'send', to, cc, subject, body });
        __mbxSent.unshift({ id: Date.now(), to_email: to, cc_email: cc || null, subject, body, sent_at: '' });
        toast('Email sent.');
        renderMailboxList();
    } catch (e) {
        if (msg) msg.textContent = e.message;
        if (btn) {
            btn.disabled = false;
            btn.textContent = 'Send';
        }
    }
}
async function mailboxMarkUnread(uid) {
    try {
        await apiPost('mailbox.php', { action: 'mark_unread', uid });
        const local = __mbxMessages.find((x) => x.uid === uid);
        if (local) local.seen = false;
        toast('Marked unread.');
        renderMailboxList();
    } catch (e) {
        glassAlert("Couldn't mark unread: " + e.message);
    }
}
async function mailboxDelete(uid) {
    if (!(await glassConfirm('Delete this email from the mailbox? This can’t be undone.'))) return;
    try {
        await apiPost('mailbox.php', { action: 'delete', uid });
        __mbxMessages = __mbxMessages.filter((m) => m.uid !== uid);
        toast('Email deleted.');
        renderMailboxList();
    } catch (e) {
        glassAlert("Couldn't delete: " + e.message);
    }
}

[accountsBack, accountsOpen, accountsShowIndex, activityLogSearch, addAdminPasskey, addReviewRow, afterPaymentChange, autoSyncIcalBlocks, backfillWebp, bookingHubBack, bulkImportReviews, changeAdminPassword, changeMonth, timelineToday, inboxSub, inboxSubClose, inboxFolder, initBackOffice, loadAdminMessages, loadDiagnostics, logoutStaff, offerUpdatedConfirmationEmail, openAccounts, openAddBooking, openArea, openBlockDates, openBookingHub, openBookings, openBookingEmail, bookingsSetFilter, bookingsSetSearch, renderBookings, openEnquiryHub, enquiryHubBack, openInbox, openSettings, openStagingSite, refreshModerationCounts, renderAccounts, renderActivityLog, renderCalendar, renderExpenses, renderInbox, renderMoneyOverview, requestPayment, renderSquareSettings, runMigrations, saveApiKey, saveContactPhone, saveContent, saveDepositPct, saveGoogleReviewUrl, saveHostText, saveReviews, sendBroadcast, sendSampleEmails, sendTestEmail, settingsBack, settingsFilter, settingsOpen, settingsOpenAccom, settingsOpenAccomSec, settingsOpenCalendar, settingsOpenCancel, settingsRecentRender, settingsSearchKey, settingsShowIndex, tryAccessBackOffice, uploadHostPhoto].forEach((f) => {
    window[f.name] = f;
});
window.__ADMIN_LOADED = true;
