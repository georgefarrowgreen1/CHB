#!/usr/bin/env node
// ============================================================
//  layout-test.js — design-regression gate (dev/CI only, never deployed).
//
//  Pixel-diffing against committed baselines is flaky across machines (fonts,
//  antialiasing), so this gate asserts LAYOUT INVARIANTS instead — the things
//  that are true of every non-broken responsive page, checked deterministically
//  at phone / tablet / desktop widths on the key public views:
//    • no horizontal page overflow (the classic "text overhangs on mobile")
//    • no visible element extends past the right edge of the viewport
//    • the view's key content actually rendered and is visibly sized
//  It also saves a screenshot per view×width to layout-shots/ — uploaded as a
//  CI artifact so a human can eyeball the design without pulling the branch.
//
//  Run locally:  node layout-test.js   (same setup as e2e-test.js)
//  Safari pass:  CHB_ENGINE=webkit node layout-test.js — the same gate in
//  WebKit, which sizes native form controls differently (iOS date inputs
//  ignore min-width:0), so it catches iPhone-only overlaps Chromium can't.
//  CI runs both engines.
//
//  The back office is checked too — at PHONE width only, because that's where
//  the owner actually manages the site (and where overhang bugs have bitten
//  before): Today, Inbox, Money and all three settings areas.
// ============================================================
const { chromium, webkit } = require('playwright');
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8253;
const dir = __dirname;
// WebKit shots go in a subfolder so the two engine passes don't overwrite
// each other inside the shared layout-shots CI artifact.
const SHOTS = path.join(dir, 'layout-shots',
  process.env.CHB_ENGINE === 'webkit' ? 'webkit' : '');

const props = [
  { prop_key: '21a', name: '21A Westgate', slug: '21a-westgate', couple_rate: 130, extra_adult_rate: 42, child_rate: 25, booking_fee: 75, transaction_pct: 3, weekend_pct: 0, weekend_days: '5,6', max_adults: 2, max_children: 0, max_total: 2, sort_order: 1 },
  { prop_key: 'jollyboat', name: 'Jollyboat', slug: 'jollyboat', couple_rate: 120, extra_adult_rate: 0, child_rate: 0, booking_fee: 75, transaction_pct: 3, weekend_pct: 0, weekend_days: '5,6', max_adults: 2, max_children: 0, max_total: 2, sort_order: 2 },
  { prop_key: 'pimpernel', name: 'Pimpernel', slug: 'pimpernel', couple_rate: 110, extra_adult_rate: 42, child_rate: 25, booking_fee: 75, transaction_pct: 3, weekend_pct: 0, weekend_days: '5,6', max_adults: 2, max_children: 1, max_total: 3, sort_order: 3 },
];
const experiences = [
  { id: 1, title: 'Seal trips from Morston Quay', body: 'Boats run daily from the quay — book ahead in summer.', image: '', link: '', status: 'published', sort_order: 1 },
  { id: 2, title: 'Blakeney Point walk', body: 'A long shingle walk with the colony at the end.', image: '', link: '', status: 'published', sort_order: 2 },
];
// Realistic admin data so the back-office panels render with content (a long
// guest name + a long message are deliberate — they're what overhangs).
const today = new Date();
const d = (n) => { const x = new Date(today.getFullYear(), today.getMonth(), today.getDate() + n); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
const bookings = [
  { id: 1, prop_key: '21a', name: 'Alexandrina Featherstonehaugh-Smythe', email: 'a.feather@example.com', check_in: d(0), check_out: d(4), check_in_time: '15:00', check_out_time: '10:00', adults: 2, children: 0, payment: 'paid', deposit_paid: 450, agreed_total: 450 },
  { id: 2, prop_key: 'pimpernel', name: 'Emma Wilson', email: 'e@x.com', check_in: d(4), check_out: d(9), check_in_time: '15:00', check_out_time: '10:00', adults: 2, children: 1, payment: 'deposit', deposit_paid: 150, agreed_total: 640 },
];
const enquiries = [
  { id: 11, prop_key: 'jollyboat', name: 'Lucy Grant-Worthington', email: 'lucy.grant.worthington@example.com', phone: '07700 900123', address: '14 Extraordinarily Long Street Name, Little Snoring', postcode: 'NR21 0AB', check_in: d(14), check_out: d(18), adults: 2, children: 0, check_in_time: '15:00', check_out_time: '10:00', message: 'We would love to bring our very well behaved cocker spaniel if at all possible please — happy to pay extra.' },
];

// Channel-sync stub: one healthy feed and one FAILING feed, so the calendar
// sync box renders both the "synced" and "not syncing" status lines.
const icalList = {
  ok: true,
  feeds: [{ source: 'airbnb', url: 'https://www.airbnb.com/calendar/ical/1234.ics' }, { source: 'vrbo', url: 'https://www.vrbo.com/icalendar/5678.ics' }],
  blocks: 3,
  export_url: 'https://cottageholidaysblakeney.co.uk/ical-export.php?prop=21a&token=abcdef0123456789abcdef01',
  status: { at: d(0) + ' 06:00:00', sources: {
    airbnb: { ok: true, fails: 0, at: d(0) + ' 06:00:00', events: 3, ok_at: d(0) + ' 06:00:00', error: '' },
    vrbo: { ok: false, fails: 3, at: d(0) + ' 06:00:00', events: 2, ok_at: d(-3) + ' 06:00:00', error: 'HTTP 404' },
  } },
};

// A fully-paid stay in progress TODAY — makes My Stays render both the booking
// card and the in-stay "My Stay hub".
const midStay = { id: 3, prop_key: 'jollyboat', name: 'Guest Tester', email: 'guest@example.com',
  check_in: d(-2), check_out: d(2), check_in_time: '15:00', check_out_time: '10:00', adults: 2, children: 0,
  payment: 'paid', deposit_paid: 495, agreed_total: 495, agreed_per_night: 120, agreed_nights: 4,
  agreed_nightly: 480, agreed_booking_fee: 0, agreed_txn_pct: 3, agreed_txn_fee: 15, agreed_on: d(-30) };

const WIDTHS = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1280, height: 900 },
];

// Runs IN THE PAGE (serialised by Playwright). An element is a genuine overhang
// bug only if it is PARTIALLY visible (off-canvas slide-in UI starts fully past
// the edge), extends past the right edge, is NOT inside a clipped or
// horizontally-scrollable container (decorative blobs / parallax overscan /
// photo strips are clipped or scrollable by design), and carries real content.
const MEASURE = (mustSee) => {
  const out = { overflow: 0, offenders: [], missing: [], zero: [] };
  const de = document.documentElement;
  out.pageOverflow = de.scrollWidth - window.innerWidth;
  const isClippedOrScrollable = (el) => {
    let a = el.parentElement;
    while (a && a !== document.body) {
      const o = getComputedStyle(a).overflowX;
      if (o === 'hidden' || o === 'clip' || o === 'auto' || o === 'scroll') return true;
      a = a.parentElement;
    }
    return false;
  };
  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.position === 'fixed') continue;
    const b = el.getBoundingClientRect();
    if (b.width === 0 || b.height === 0) continue;
    if (b.right <= window.innerWidth + 2) continue;
    if (b.left >= window.innerWidth - 2) continue; // fully off-canvas = intentional
    const hasContent =
      /^(A|BUTTON|INPUT|SELECT|TEXTAREA|IMG)$/.test(el.tagName) ||
      (el.childElementCount === 0 && (el.textContent || '').trim() !== '');
    if (!hasContent) continue;
    if (isClippedOrScrollable(el)) continue;
    out.overflow++;
    if (out.offenders.length < 5) {
      out.offenders.push((el.id ? '#' + el.id : el.tagName.toLowerCase() + '.' + String(el.className).split(' ')[0]) + ' right=' + Math.round(b.right));
    }
  }
  for (const sel of mustSee) {
    const el = document.querySelector(sel);
    if (!el) { out.missing.push(sel); continue; }
    const b = el.getBoundingClientRect();
    if (b.width < 10 || b.height < 10) out.zero.push(sel);
  }
  return out;
};

async function waitForServer(url, tries = 40) {
  for (let i = 0; i < tries; i++) {
    const ok = await new Promise((res) => { http.get(url, (r) => res(r.statusCode === 200)).on('error', () => res(false)); });
    if (ok) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('php -S did not become ready');
}

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const server = spawn('php', ['-S', `127.0.0.1:${PORT}`, '-t', dir], { stdio: 'ignore' });
  const problems = [];
  const pass = (m) => console.log('  ✓ ' + m);
  const fail = (m) => { problems.push(m); console.log('  ✗ ' + m); };
  const judge = (label, r) => {
    r.pageOverflow <= 2 ? pass(`${label}: no horizontal page overflow`) : fail(`${label}: page overflows by ${r.pageOverflow}px`);
    r.overflow === 0 ? pass(`${label}: no element past the right edge`) : fail(`${label}: ${r.overflow} element(s) overflow — ${r.offenders.join(', ')}`);
    r.missing.length === 0 ? pass(`${label}: key content present`) : fail(`${label}: missing ${r.missing.join(', ')}`);
    r.zero.length === 0 ? pass(`${label}: key content visibly sized`) : fail(`${label}: zero-sized ${r.zero.join(', ')}`);
  };
  const newPage = async (browser, vp, tag) => {
    const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.addInitScript(() => {
      if (navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(() => {});
    });
    await page.route(/\.php/, (route) => {
      const url = route.request().url();
      const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
      if (url.includes('rates.php')) return json({ properties: props, seasons: {}, occupancy: {} });
      if (url.includes('experiences.php')) return json({ experiences });
      if (url.includes('bookings.php')) return json({ bookings });
      if (url.includes('enquiries.php')) return json({ enquiries });
      if (url.includes('accounts.php')) return json({ years: [] });
      if (url.includes('ical-import.php')) return json(icalList);
      if (url.includes('diagnostics.php')) return json({ ok: true, summary: { ok: 12, warn: 1, fail: 0 }, checks: [], mail_ready: true });
      if (url.includes('my-bookings.php')) return json({ bookings: [midStay], enquiries: [], completed_stays: 0 });
      return json({ ok: true, bookings: [], enquiries: [], threads: [], photos: [], reviews: [], experiences, content: {}, blocks: [], ranges: [] });
    });
    page.on('pageerror', (e) => problems.push(`pageerror @${tag}: ` + e.message));
    await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1600);
    // Freeze animations/transitions so measurements are stable.
    await page.addStyleTag({ content: '*,*:before,*:after{animation:none!important;transition:none!important}' });
    return page;
  };
  const walkViews = async (page, views, vpName, vpWidth) => {
    for (const v of views) {
      if (v.open) {
        await page.evaluate((code) => eval(code), v.open); // returns a promise for async opens — evaluate awaits it
        await page.waitForTimeout(900);
      }
      const r = await page.evaluate(MEASURE, v.mustSee);
      judge(`${v.key} @ ${vpName} (${vpWidth}px)`, r);
      await page.screenshot({ path: path.join(SHOTS, `${v.key}-${vpName}.png`), fullPage: vpName !== 'phone' }).catch(() => {});
    }
  };

  try {
    await waitForServer(`http://127.0.0.1:${PORT}/index.html`);
    // Engine: Chromium by default; CHB_ENGINE=webkit runs the SAME gate in
    // WebKit (Safari's engine). iOS lays out native form controls differently,
    // so the WebKit pass catches iPhone-only overlaps Chromium can't see.
    const useWebkit = process.env.CHB_ENGINE === 'webkit';
    const browser = useWebkit
      ? await webkit.launch({})
      : await chromium.launch(process.env.CHB_CHROMIUM ? { executablePath: process.env.CHB_CHROMIUM } : {});
    console.log('== Engine: ' + (useWebkit ? 'WebKit' : 'Chromium') + ' ==');

    // ---- Public + signed-in GUEST views at every width. The mid-stay guest
    // exercises the My Stays page with the in-stay hub; the modal/overlay
    // states (enquire, sign-in, chat) are measured open, where phone-width
    // overhang bugs hide. ----
    for (const vp of WIDTHS) {
      const page = await newPage(browser, vp, vp.name);
      await walkViews(page, [
        { key: 'home', open: null, mustSee: ['#hero', '#home-cottages-grid .card'] },
        { key: 'cottage', open: "openProperty('21a')", mustSee: ['#prop-title', '#prop-avail-cal'] },
        { key: 'experiences', open: "nav('view-experiences')", mustSee: ['#exp-grid'] },
        { key: 'cottages-list', open: "nav('view-cottages')", mustSee: ['#cottages .card'] },
        { key: 'privacy', open: "nav('view-privacy')", mustSee: ['#view-privacy'] },
        { key: 'enquire-modal', open: "(async () => { openProperty('21a'); await new Promise(r => setTimeout(r, 300)); openEnquireModal(); })()", mustSee: ['#enquire-modal .modal-box'] },
        { key: 'auth-modal', open: "(() => { closeEnquireModal(); openGuestAuthModal(); })()", mustSee: ['#guest-auth-modal .modal-box'] },
        { key: 'chat-open', open: "(() => { closeGuestAuthModal(); try { closeChat(); } catch (e) {} toggleChat(); })()", mustSee: ['#chat-widget .chat-thread'] },
        { key: 'waitlist-modal', open: "(() => { try { closeChat(); } catch (e) {} openWaitlistModal({ prop: '21a' }); })()", mustSee: ['#waitlist-modal .modal-box', '#wl-checkout'] },
        { key: 'my-stays', open: "(async () => { try { closeWaitlistModal(); } catch (e) {} try { closeChat(); } catch (e) {} currentGuest = { id: 1, name: 'Guest Tester', email: 'guest@example.com' }; try { setAuthUI(); } catch (e) {} nav('view-guest-bookings'); await renderGuestBookings(); })()", mustSee: ['#guest-bookings-list .guest-booking', '.my-stay-hub'] },
      ], vp.name, vp.width);
      await page.close();
    }

    // ---- Back office at EVERY width (the owner works from phone, iPad and
    // laptop alike). Admin auth is faked the same way e2e-test.js does; the
    // facade stubs fetch admin.js from the local server, so this also
    // exercises the real split-bundle load. Includes the key drill-down
    // screens (payments manager, seasonal grid, reviews, health check,
    // cottage editor) — that's where overhang bugs hide. ----
    const ADMIN_VIEWS = [
      { key: 'admin-today', open: "(async () => { isAuthenticated = true; document.body.classList.add('owner-mode'); nav('view-backoffice'); await initBackOffice(); })()", mustSee: ['#cal-body'] },
      { key: 'admin-bookings', open: '(async () => { await openBookings(); })()', mustSee: ['#bookings-list', '#cal-body'] },
      { key: 'admin-booking-hub', open: "(async () => { await openBookingHub('b2'); })()", mustSee: ['#booking-hub-content', '#hub-history'] },
      { key: 'admin-add-booking', open: "(async () => { window.openBookings && await openBookings(); openAddBooking(); document.getElementById('modal-checkin').value = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10); document.getElementById('modal-checkout').value = new Date(Date.now() + 33 * 864e5).toISOString().slice(0, 10); updateModalPrice(); })()", mustSee: ['#edit-modal .modal-box', '#modal-availability .mav-grid'] },
      { key: 'admin-close-modal', open: 'closeModal()', mustSee: ['#bookings-list'] },
      { key: 'admin-inbox', open: '(async () => { await openInbox(); })()', mustSee: ['#inbox-list', '#messages-list'] },
      { key: 'admin-money', open: '(async () => { await openAccounts(); })()', mustSee: ['#accounts-index'] },
      { key: 'admin-money-payments', open: "(async () => { await openAccounts(); accountsOpen('payments'); })()", mustSee: ['#money-panel'] },
      { key: 'admin-inbox', open: '(async () => { await openInbox(); })()', mustSee: ['#inbox-list'] },
      { key: 'admin-money', open: '(async () => { await openAccounts(); })()', mustSee: ['#money-overview'] },
      { key: 'admin-manage', open: "(async () => { await openArea('manage'); })()", mustSee: ['#settings-index'] },
      { key: 'admin-accom', open: "(async () => { await openArea('cottages'); settingsOpen('accom'); })()", mustSee: ['#sec-accom'] },
      { key: 'admin-seasongrid', open: "(async () => { await openArea('cottages'); settingsOpen('seasongrid'); })()", mustSee: ['#sec-seasongrid'] },
      { key: 'admin-calendar-sync', open: "(async () => { await openArea('cottages'); settingsOpen('calendar'); await settingsOpenCalendar('21a'); })()", mustSee: ['#sync-export-21a', '#sync-airbnb-21a', '#sync-bookingcom-21a'] },
      { key: 'admin-reviews', open: "(async () => { await openArea('marketing'); settingsOpen('reviews'); })()", mustSee: ['#sec-reviews'] },
      { key: 'admin-health', open: "(async () => { await openArea('settings'); settingsOpen('diagnostics'); })()", mustSee: ['#sec-diagnostics'] },
    ];
    for (const vp of WIDTHS) {
      const page = await newPage(browser, vp, 'admin-' + vp.name);
      await walkViews(page, ADMIN_VIEWS, vp.name, vp.width);
      await page.close();
    }
    await browser.close();
  } catch (e) {
    fail('harness error: ' + e.message);
  } finally {
    server.kill();
  }
  console.log('\n== Summary ==');
  if (problems.length) {
    console.log(`  ${problems.length} LAYOUT CHECK(S) FAILED ❌`);
    process.exit(1);
  }
  console.log('  LAYOUT CHECKS PASSED ✅  (screenshots in layout-shots/)');
})();
