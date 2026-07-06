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
      if (url.includes('bookings.php')) return json({ bookings });
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
