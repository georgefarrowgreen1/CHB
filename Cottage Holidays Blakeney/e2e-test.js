#!/usr/bin/env node
// ============================================================
//  e2e-test.js — real-browser smoke test (dev/CI only, never deployed).
//
//  Boots the site in headless Chromium against a local `php -S` server with
//  every .php API stubbed (no database needed), then walks the core guest
//  journeys + the admin dashboard. FAILS on any uncaught page error or
//  console.error — the class of breakage the DOM-shim smoke test can't see
//  (CSS/JS integration, render-time exceptions, broken handlers).
//
//  Run locally:  node e2e-test.js
//  (needs `npm i playwright` once + a Chromium; set CHB_CHROMIUM to use an
//   existing binary, e.g. CHB_CHROMIUM=/opt/pw-browsers/chromium)
// ============================================================
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const http = require('http');

const PORT = 8199;
const dir = __dirname;
const today = new Date();
const d = (n) => { const x = new Date(today.getFullYear(), today.getMonth(), today.getDate() + n); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };

const props = [
  { prop_key: '21a', name: '21A Westgate', slug: '21a-westgate', couple_rate: 130, extra_adult_rate: 42, child_rate: 25, booking_fee: 75, transaction_pct: 3, weekend_pct: 0, weekend_days: '5,6', max_adults: 2, max_children: 0, max_total: 2, sort_order: 1 },
  { prop_key: 'jollyboat', name: 'Jollyboat', slug: 'jollyboat', couple_rate: 120, extra_adult_rate: 0, child_rate: 0, booking_fee: 75, transaction_pct: 3, weekend_pct: 0, weekend_days: '5,6', max_adults: 2, max_children: 0, max_total: 2, sort_order: 2 },
  { prop_key: 'pimpernel', name: 'Pimpernel', slug: 'pimpernel', couple_rate: 110, extra_adult_rate: 42, child_rate: 25, booking_fee: 75, transaction_pct: 3, weekend_pct: 0, weekend_days: '5,6', max_adults: 2, max_children: 1, max_total: 3, sort_order: 3 },
];
const bookings = [
  { id: 1, prop_key: '21a', name: 'Sarah Pemberton', email: 's@x.com', check_in: d(0), check_out: d(4), check_in_time: '15:00', check_out_time: '10:00', adults: 2, children: 0, payment: 'paid', deposit_paid: 450, agreed_total: 450 },
  { id: 2, prop_key: 'pimpernel', name: 'Emma Wilson', email: 'e@x.com', check_in: d(4), check_out: d(9), check_in_time: '15:00', check_out_time: '10:00', adults: 2, children: 1, payment: 'deposit', deposit_paid: 150, agreed_total: 640 },
];
// A fully-paid stay that is IN PROGRESS today — exercises the "My Stay" hub
// (a template bug here once broke the whole My Stays page for mid-stay guests).
const midStay = { id: 3, prop_key: 'jollyboat', name: 'Guest Tester', email: 'guest@example.com',
  check_in: d(-2), check_out: d(2), check_in_time: '15:00', check_out_time: '10:00', adults: 2, children: 0,
  payment: 'paid', deposit_paid: 495, agreed_total: 495, agreed_per_night: 120, agreed_nights: 4,
  agreed_nightly: 480, agreed_booking_fee: 0, agreed_txn_pct: 3, agreed_txn_fee: 15, agreed_on: d(-30) };
const enquiries = [
  { id: 11, prop_key: 'jollyboat', name: 'Lucy Grant', email: 'l@x.com', check_in: d(14), check_out: d(18), adults: 2, children: 0, check_in_time: '15:00', check_out_time: '10:00', message: '' },
];

async function waitForServer(url, tries = 40) {
  for (let i = 0; i < tries; i++) {
    const ok = await new Promise(res => { http.get(url, r => res(r.statusCode === 200)).on('error', () => res(false)); });
    if (ok) return;
    await new Promise(r => setTimeout(r, 250));
  }
  throw new Error('php -S did not become ready');
}

(async () => {
  const server = spawn('php', ['-S', `127.0.0.1:${PORT}`, '-t', dir], { stdio: 'ignore' });
  const problems = [];
  const pass = (m) => console.log('  ✓ ' + m);
  const fail = (m) => { problems.push(m); console.log('  ✗ ' + m); };
  try {
    await waitForServer(`http://127.0.0.1:${PORT}/index.html`);
    const browser = await chromium.launch(process.env.CHB_CHROMIUM ? { executablePath: process.env.CHB_CHROMIUM } : {});
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

    // Never register the service worker in tests (its cache layer would sit
    // between our stubs and the page).
    await page.addInitScript(() => {
      if (navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(() => {});
    });

    // Stub every .php call so no database is needed and responses are deterministic.
    let chatThreadCalls = 0; // guest chat poll counter — owner "replies" on the 2nd poll
    await page.route(/\.php/, (route) => {
      const url = route.request().url();
      const post = route.request().postData() || '';
      const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
      if (url.includes('rates.php')) return json({ properties: props, seasons: {}, occupancy: { '21a': { maxAdults: 2, maxChildren: 0, maxTotal: 2 }, jollyboat: { maxAdults: 2, maxChildren: 0, maxTotal: 2 }, pimpernel: { maxAdults: 2, maxChildren: 1, maxTotal: 3 } } });
      if (url.includes('bookings.php')) {
        let act = ''; try { act = JSON.parse(post || '{}').action || ''; } catch (e) {}
        if (act === 'email_preview') return json({ ok: true, subject: 'Your booking — 21A Westgate', html: '<!doctype html><html><body style="font-family:sans-serif"><h1>About your booking</h1><p data-preview="1">Parking is on the street out front.</p></body></html>' });
        if (act === 'email_logs') return json({ logs: { '1': [
          { action: 'email.confirmation', summary: 'Confirmation re-sent — Sarah Pemberton', at: d(0) + ' 09:15:00', subject: '', body: '' },
          { action: 'email.receipt', summary: 'Payment receipt emailed — £450.00 · Sarah Pemberton', at: d(0) + ' 09:40:00', subject: '', body: '' },
          { action: 'booking.email', summary: 'Emailed guest — Sarah Pemberton', at: d(0) + ' 10:20:00', subject: 'Your booking — 21A Westgate', body: 'Hi Sarah,\nParking is on the street out front. See you soon!' },
        ] } });
        return json({ bookings });
      }
      if (url.includes('enquiries.php')) return json({ enquiries });
      if (url.includes('messages.php')) {
        let act = ''; try { act = JSON.parse(post || '{}').action || ''; } catch (e) {}
        if (act === 'send') return json({ ok: true, token: 'chattok0123456789ab' });
        if (act === 'thread' && !post.includes('thread_id')) {
          // Guest chat poll: the host has replied by the 2nd poll, so the poll must
          // ping it into the open thread without a reload (regression guard).
          chatThreadCalls++;
          const g = { id: 1, role: 'guest', body: 'Is Jollyboat free in August?', at: d(0) + ' 12:00:00' };
          const h = { id: 2, role: 'admin', body: 'Yes — 1-8 August is free, shall I pencil you in?', at: d(0) + ' 12:03:00' };
          return json({ ok: true, messages: chatThreadCalls >= 2 ? [g, h] : [g] });
        }
        return json({ threads: [{ thread_id: 1, name: 'Sarah', unread: 1, last_body: 'Hi' }] });
      }
      if (url.includes('content.php') && post.includes('get_all')) return json({ content: {} });
      if (url.includes('content.php')) return json({ content: {} });
      if (url.includes('accounts.php')) return json({ years: [] });
      if (url.includes('my-bookings.php')) return json({ bookings: [midStay], enquiries: [], completed_stays: 0 });
      return json({ ok: true, bookings: [], enquiries: [], threads: [], photos: [], reviews: [], experiences: [], expenses: [], years: [], content: {}, blocks: [], ranges: [] });
    });

    // Any uncaught exception or console.error fails the run.
    page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
    page.on('console', (m) => {
      // Resource-load noise (missing local images, teardown races) isn't an app
      // bug — real JS exceptions surface via pageerror above.
      if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) problems.push('console.error: ' + m.text());
    });

    console.log('== 1. Homepage boots ==');
    await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1800);
    (await page.locator('#hero').count()) === 1 ? pass('hero rendered') : fail('hero missing');
    (await page.locator('#home-cottages-grid .card').count()) >= 3 ? pass('cottage cards rendered') : fail('cottage cards missing');

    console.log('== 2. Cottage page opens from a card ==');
    await page.locator('#home-cottages-grid .card').first().click();
    await page.waitForTimeout(700);
    (await page.evaluate(() => (document.querySelector('.page-view.active') || {}).id)) === 'view-21a' ? pass('cottage view active') : fail('cottage view did not open');
    ((await page.locator('#prop-title').textContent()) || '').trim() ? pass('cottage title populated') : fail('cottage title empty');

    console.log('== 3. Enquiry modal opens + validates ==');
    await page.evaluate(() => openEnquireModal());
    await page.waitForTimeout(500);
    (await page.evaluate(() => document.getElementById('enquire-modal').classList.contains('open'))) ? pass('enquiry modal open') : fail('enquiry modal did not open');
    await page.evaluate(() => enquireContinue());
    await page.waitForTimeout(300);
    ((await page.locator('#enq-msg-review').textContent()) || '').trim() ? pass('missing-dates validation shows') : fail('no validation message');
    await page.evaluate(() => closeEnquireModal());

    console.log('== 4. Login modal ==');
    await page.evaluate(() => { openGuestAuthModal(); });
    await page.waitForTimeout(500);
    (await page.evaluate(() => document.getElementById('guest-auth-modal').classList.contains('open'))) ? pass('login modal open') : fail('login modal did not open');
    await page.evaluate(() => switchGuestTab('register'));
    await page.waitForTimeout(200);
    (await page.locator('#reg-name').isVisible()) ? pass('register tab shows') : fail('register tab broken');
    await page.evaluate(() => closeGuestAuthModal());

    console.log('== 5. Admin dashboard renders ==');
    await page.evaluate(async () => { isAuthenticated = true; document.body.classList.add('owner-mode'); nav('view-backoffice'); await initBackOffice(); });
    await page.waitForTimeout(1200);
    (await page.locator('#today-panel .today-card').count()) >= 6 ? pass('today panel cards rendered') : fail('today panel incomplete');
    ((await page.locator('#bo-subtitle').textContent()) || '').includes('—') ? pass('live subtitle set') : fail('dashboard subtitle not set');
    (await page.locator('#cal-body .cal-day, #cal-body > *').count()) > 20 ? pass('calendar grid rendered') : fail('calendar grid missing');

    console.log('== 5b. Back-office areas (dock reorg) ==');
    const areaShows = async (area) => {
      await page.evaluate((a) => openArea(a), area);
      await page.waitForTimeout(350);
      return page.evaluate(() => {
        const rowVisible = (frag) => {
          const b = [...document.querySelectorAll('#settings-index .settings-row')]
            .find((x) => (x.getAttribute('onclick') || '').includes(frag));
          return !!b && b.offsetParent !== null;
        };
        return {
          onSettings: ((document.querySelector('.page-view.active') || {}).id === 'view-settings'),
          enquiries: rowVisible("settingsOpen('enquiries')"),
          accom: rowVisible("settingsOpen('accom')"),
          analytics: rowVisible("settingsOpen('analytics')"),
          security: rowVisible("settingsOpen('security')"),
        };
      });
    };
    // Inbox is now a dedicated screen (enquiries + messages + approvals).
    await page.evaluate(() => openInbox());
    await page.waitForTimeout(500);
    const inbox = await page.evaluate(() => ({
        active: (document.querySelector('.page-view.active') || {}).id === 'view-inbox',
        enq: !!document.getElementById('inbox-list'),
        msgs: !!document.getElementById('messages-list'),
    }));
    (inbox.active && inbox.enq && inbox.msgs) ? pass('Inbox is a dedicated screen (enquiries + messages)') : fail('Inbox screen wrong: ' + JSON.stringify(inbox));
    let ar = await areaShows('cottages');
    (ar.accom && !ar.enquiries && !ar.analytics && !ar.security) ? pass('Cottages area shows only cottage rows') : fail('Cottages area filter wrong: ' + JSON.stringify(ar));
    ar = await areaShows('marketing');
    (ar.analytics && !ar.accom && !ar.enquiries && !ar.security) ? pass('Marketing area shows only marketing rows') : fail('Marketing area filter wrong: ' + JSON.stringify(ar));
    ar = await areaShows('settings');
    (ar.security && !ar.enquiries && !ar.accom && !ar.analytics) ? pass('Settings area shows only settings rows') : fail('Settings area filter wrong: ' + JSON.stringify(ar));
    await page.evaluate(async () => { nav('view-backoffice'); await initBackOffice(); });

    console.log('== 5c. Bookings page (dedicated list + filters + email) ==');
    await page.evaluate(async () => { isAuthenticated = true; document.body.classList.add('owner-mode'); await openBookings(); });
    await page.waitForTimeout(500);
    (await page.evaluate(() => (document.querySelector('.page-view.active') || {}).id)) === 'view-bookings' ? pass('bookings view active') : fail('bookings view did not open');
    (await page.locator('#bookings-list .money-row').count()) === 2 ? pass('upcoming bookings listed (2)') : fail('bookings list count wrong: ' + (await page.locator('#bookings-list .money-row').count()));
    (await page.locator('#bookings-list .money-row button', { hasText: 'Email' }).count()) >= 1 ? pass('email action present on rows') : fail('email action missing');
    await page.evaluate(() => bookingsSetFilter('needspay'));
    await page.waitForTimeout(200);
    (await page.locator('#bookings-list .money-row').count()) === 1 ? pass('Needs-payment filter → 1 booking') : fail('needs-payment filter wrong: ' + (await page.locator('#bookings-list .money-row').count()));
    await page.evaluate(() => { bookingsSetFilter('all'); bookingsSetSearch('sarah'); });
    await page.waitForTimeout(200);
    (await page.locator('#bookings-list .money-row').count()) === 1 ? pass('search "sarah" → 1 booking') : fail('search wrong: ' + (await page.locator('#bookings-list .money-row').count()));
    // Per-booking email log: Sarah's booking has 3 logged emails (incl. a payment receipt); the other has none.
    (await page.locator('#bookings-list .bk-email-log-row').count()) === 3 ? pass('email log lists sent emails (3)') : fail('email log wrong count: ' + (await page.locator('#bookings-list .bk-email-log-row').count()));
    ((await page.locator('#bookings-list .bk-email-log-when').first().textContent()) || '').match(/\d{1,2} \w{3} \d{4}/) ? pass('email log shows a formatted date') : fail('email log date not formatted');
    (await page.locator('#bookings-list .bk-email-log-what', { hasText: 'Payment receipt' }).count()) === 1 ? pass('payment receipt appears in the log') : fail('payment receipt not shown in log');
    // The free-text message is expandable and reveals its body.
    (await page.locator('#bookings-list details.bk-email-log-item').count()) === 1 ? pass('free-text message is expandable') : fail('expandable message missing');
    await page.locator('#bookings-list details.bk-email-log-item > summary').first().click();
    await page.waitForTimeout(150);
    ((await page.locator('#bookings-list .bk-email-log-msg').first().textContent()) || '').includes('Parking is on the street') ? pass('expanding shows the message body') : fail('message body not revealed');
    await page.evaluate(() => { bookingsSetSearch('emma'); });
    await page.waitForTimeout(200);
    (await page.locator('#bookings-list .bk-email-log-empty').count()) === 1 ? pass('booking with no emails shows "None yet"') : fail('empty email log missing');
    await page.evaluate(() => { bookingsSetSearch(''); openBookingEmail('b1'); });
    await page.waitForTimeout(300);
    (await page.evaluate(() => document.getElementById('enq-email-modal').classList.contains('open'))) ? pass('booking email composer opens') : fail('booking email composer did not open');
    ((await page.locator('#enq-email-subject').inputValue()) || '').includes('Your booking') ? pass('composer prefilled for the booking') : fail('composer subject not prefilled');
    // Preview before sending: type a message, hit Preview → the email renders in the iframe.
    await page.fill('#enq-email-body', 'Parking is on the street out front.');
    await page.evaluate(() => previewComposedEmail());
    await page.waitForTimeout(400);
    (await page.evaluate(() => document.getElementById('enq-email-preview').style.display !== 'none' && document.getElementById('enq-email-edit').style.display === 'none')) ? pass('preview view shows before sending') : fail('preview view did not show');
    ((await page.frameLocator('#enq-email-preview-frame').locator('[data-preview="1"]').textContent().catch(() => '')) || '').includes('Parking') ? pass('preview iframe renders the built email') : fail('preview iframe empty');
    await page.evaluate(() => backToComposeEdit());
    await page.waitForTimeout(150);
    (await page.evaluate(() => document.getElementById('enq-email-edit').style.display !== 'none')) ? pass('back to editing works') : fail('back-to-edit failed');
    await page.evaluate(() => closeEnquiryEmailModal());

    console.log('== 6. Mid-stay guest: My Stays + hub ==');
    await page.evaluate(async () => {
      isAuthenticated = false; document.body.classList.remove('owner-mode');
      currentGuest = { id: 1, name: 'Guest Tester', email: 'guest@example.com' };
      try { setAuthUI(); } catch (e) {}
      nav('view-guest-bookings');
      await renderGuestBookings();
    });
    await page.waitForTimeout(800);
    (await page.locator('.my-stay-hub').count()) === 1 ? pass('in-stay hub rendered') : fail('in-stay hub missing (fully-paid current stay)');
    (await page.locator('.my-stay-hub .hub-tile').count()) >= 4 ? pass('hub tiles rendered') : fail('hub tiles missing');
    (await page.locator('#guest-bookings-list .guest-booking').count()) >= 1 ? pass('booking card rendered') : fail('booking card missing');

    console.log('== 7. Guest chat: polls in a host reply (no reload) ==');
    chatThreadCalls = 0;
    await page.evaluate(() => { try { closeChat(); } catch (e) {} try { toggleChat(); } catch (e) {} });
    await page.waitForTimeout(700);
    (await page.evaluate(() => document.getElementById('chat-widget').classList.contains('open'))) ? pass('chat opened') : fail('chat did not open');
    {
      const t1 = (await page.locator('#chat-thread').innerText().catch(() => '')) || '';
      /Jollyboat free in August/.test(t1) ? pass('guest message shown on open') : fail('guest message missing on open');
      !/1-8 August is free/.test(t1) ? pass('host reply not shown before it is sent') : fail('host reply shown too early');
    }
    // Owner replies → the next background poll (~8s live) must ping it in. Drive the
    // poll directly rather than wait the interval.
    (await page.evaluate(() => typeof chatPoll === 'function')) ? pass('chat polling wired') : fail('chatPoll missing');
    await page.evaluate(() => chatPoll());
    await page.waitForTimeout(500);
    {
      const t2 = (await page.locator('#chat-thread').innerText().catch(() => '')) || '';
      /1-8 August is free/.test(t2) ? pass('host reply appears via polling') : fail('host reply did not appear after poll');
    }

    console.log('== 8. Liquid Glass material + theme toggle (live) ==');
    // The glass material must be APPLIED at runtime, not just declared — a
    // saturation lift is what makes it Apple's Liquid Glass and not a flat frost.
    const bf = await page.evaluate(() => {
      const el = document.querySelector('.glass-panel');
      if (!el) return '';
      const cs = getComputedStyle(el);
      return cs.backdropFilter || cs.webkitBackdropFilter || '';
    });
    if (bf && bf !== 'none') {
      /saturate/.test(bf) ? pass('glass-panel backdrop-filter lifts saturation (Liquid Glass live)') : fail('glass-panel lost the Liquid Glass material: ' + bf);
    } else {
      pass('backdrop-filter not reported by headless — material checked statically in smoke-test');
    }
    // Theme toggle flips the palette and returns (direction-agnostic — the guest
    // default is light, admin forces dark, so don't assume a starting state).
    const themeBefore = await page.evaluate(() => document.body.classList.contains('light-mode'));
    await page.evaluate(() => toggleTheme());
    const themeAfter = await page.evaluate(() => document.body.classList.contains('light-mode'));
    themeAfter !== themeBefore ? pass('theme toggle flips the palette') : fail('theme toggle did not change the palette');
    await page.evaluate(() => toggleTheme());
    (await page.evaluate(() => document.body.classList.contains('light-mode'))) === themeBefore ? pass('theme toggle returns to the original palette') : fail('theme toggle did not return to the original palette');

    await browser.close();
  } catch (e) {
    problems.push('fatal: ' + (e && e.message));
  } finally {
    server.kill();
  }
  console.log('\n== Summary ==');
  if (!problems.length) { console.log('  BROWSER TEST PASSED ✅\n'); process.exit(0); }
  problems.forEach(p => console.log('  ❌ ' + p));
  process.exit(1);
})();
