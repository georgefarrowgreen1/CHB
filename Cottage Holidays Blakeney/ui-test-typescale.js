#!/usr/bin/env node
// ============================================================
//  ui-test-typescale.js — ONE TYPE SCALE, measured on the rendered screens.
//
//  Eight steps — 11 · 12 · 13 · 15 · 17 · 22 · 28 · 34 — stated as --fs-* tokens
//  in app.css. Apple ships seven text styles and nothing in between; this app
//  shipped 45 distinct sizes in app.css and 42 in admin.css, and the enquiry hub
//  rendered 23 on one screen. The search window proved the discipline with its own
//  six-step scale (ui-test-searchpage §16b); this is the same sweep over every
//  other screen: every PAINTED text size is a step.
//
//  Out of scope, by name: the search window (its own gated scale), the timeline's
//  day cells (a documented small-control family), and display sizes over 36px (the
//  hero's fluid clamp() titles, deliberately not on a step). Vacuity-guarded: a
//  screen must yield at least 8 distinct text-bearing elements to count.
// ============================================================
const { bootBrowser } = require('./ui-test-lib');
const fails = [];
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fails.push(m); };
const STEPS = [11, 12, 13, 15, 17, 22, 28, 34];
const today = new Date();
const d = (n) => { const x = new Date(today.getFullYear(), today.getMonth(), today.getDate() + n); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
const props = [
  { prop_key: '21a', name: '21A Westgate', slug: '21a-westgate', couple_rate: 130, extra_adult_rate: 42, child_rate: 25, booking_fee: 75, transaction_pct: 3, weekend_pct: 0, weekend_days: '5,6', max_adults: 2, max_children: 0, max_total: 2, sort_order: 1 },
  { prop_key: 'jollyboat', name: 'Jollyboat', slug: 'jollyboat', couple_rate: 120, extra_adult_rate: 0, child_rate: 0, booking_fee: 75, transaction_pct: 3, weekend_pct: 0, weekend_days: '5,6', max_adults: 2, max_children: 0, max_total: 2, sort_order: 2 },
];
const bookings = [
  { id: 1, prop_key: '21a', name: 'Priya Patel', email: 'priya@example.com', check_in: d(0), check_out: d(4), check_in_time: '15:00', check_out_time: '10:00', adults: 2, children: 0, payment: 'paid', deposit_paid: 450, agreed_total: 450 },
  { id: 2, prop_key: 'jollyboat', name: 'Debbie McGoldrick', email: 'e@x.com', phone: '07700 900123', check_in: d(6), check_out: d(9), check_in_time: '15:00', check_out_time: '10:00', adults: 2, children: 0, payment: 'deposit', deposit_paid: 200, agreed_total: 540, damages_deposit: 50, notes: 'Arriving late' },
];
const enquiries = [{ id: 11, prop_key: '21a', name: 'Nina Salt', email: 'nina@example.com', phone: '07700 900123', address: '14 Long Street', postcode: 'NR21 0AB', check_in: d(40), check_out: d(44), adults: 2, children: 0, check_in_time: '15:00', check_out_time: '10:00', message: 'Any chance of a late checkout?', created_at: d(-1) + ' 09:12:00' }];
const midStay = { id: 3, prop_key: 'jollyboat', name: 'Priya Patel', email: 'guest@example.com', check_in: d(-2), check_out: d(2), check_in_time: '15:00', check_out_time: '10:00', adults: 2, children: 0, payment: 'paid', deposit_paid: 495, agreed_total: 495, agreed_per_night: 120, agreed_nights: 4, agreed_nightly: 480, agreed_booking_fee: 0, agreed_txn_pct: 3, agreed_txn_fee: 15, agreed_on: d(-30) };
const upcoming = { id: 71, prop_key: '21a', name: 'Priya Patel', email: 'guest@example.com', check_in: d(10), check_out: d(13), check_in_time: '15:00', check_out_time: '10:00', adults: 2, children: 0, payment: 'deposit', deposit_paid: 100, agreed_total: 400, agreed_nightly: 390, agreed_txn_fee: 10, agreed_nights: 3, damages_deposit: 50, pay_token: 'tok71', balance_due_date: d(3) };
const GUEST = { id: 9, name: 'Priya Patel', email: 'guest@example.com', phone: '', address: '', postcode: '' };
function stub(page, guest) {
  return page.route(/\.php/, (route) => {
    const url = route.request().url();
    let b = {}; try { b = JSON.parse(route.request().postData() || '{}'); } catch (e) {}
    const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (url.includes('auth.php')) { if (b.action === 'guest_status') return json({ ok: true, guest: guest ? GUEST : null }); return json({ ok: true, admin: false, guest: null }); }
    if (url.includes('rates.php')) return json({ properties: props, seasons: {}, occupancy: {} });
    if (url.includes('my-bookings.php')) return json({ ok: true, bookings: [midStay, upcoming], enquiries: [], completed_stays: 1 });
    if (url.includes('bookings.php')) { if (b.action === 'email_logs') return json({ logs: {} }); if (b.action === 'hub_bundle') return json({ ok: true, payments: [], events: [] }); return json({ bookings }); }
    if (url.includes('enquiries.php')) return json({ enquiries });
    if (url.includes('accounts.php')) return json({ years: [], deposit_liability: { gross: 75, feeBack: 1.31, net: 73.69, count: 1, rate: 0.0175, items: [], transactions: { settled: 368.44, ringFence: 73.69, movable: 294.75, count: 1, items: [] }, payouts: { inBank: 294.75, onWay: 0, unknown: 0, nextArrival: null, counts: { inBank: 1, onWay: 0, unknown: 0 }, checked: Math.floor(Date.now() / 1000), error: null, known: 1, items: { inBank: [], onWay: [], unknown: [] } } } });
    if (url.includes('diagnostics.php')) return json({ ok: true, summary: { ok: 12, warn: 0, fail: 0 }, checks: [], mail_ready: true });
    return json({ ok: true, bookings: [], enquiries: [], threads: [], photos: [], reviews: [], experiences: [], content: {}, blocks: [], ranges: [], events: [], results: [] });
  });
}
// Runs in the page: every visible text-bearing element's computed size, with
// the offenders named by their nearest class so a failure says where to look.
const SWEEP = () => {
  const STEPS = [11, 12, 13, 15, 17, 22, 28, 34];
  const els = [], off = {}, sizes = new Set();
  for (const el of document.querySelectorAll('body *')) {
    // The search window joined the app scale in round eight, so it is swept too.
    if (el.closest('.tl-wrap, #cal-body, svg, script, style, #loading-overlay')) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    if (!el.getClientRects().length) continue;
    let own = false;
    for (const n of el.childNodes) if (n.nodeType === 3 && n.textContent.trim()) { own = true; break; }
    if (!own) continue;
    const s = parseFloat(cs.fontSize);
    if (!(s > 0) || s > 36) continue;
    els.push(el);
    const r = Math.round(s * 10) / 10;
    sizes.add(r);
    // 0.3px: a step is exact at the 16px root (0.6875rem = 11.000), so this only
    // forgives sub-pixel rounding — 0.8rem's 12.8 and 0.85rem's 13.6 both fail.
    if (!STEPS.some((st) => Math.abs(st - s) <= 0.3)) {
      const key = r + 'px ' + (el.id ? '#' + el.id : el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.split(' ').filter(Boolean).slice(0, 2).join('.') : ''));
      off[key] = (off[key] || 0) + 1;
    }
  }
  return { n: els.length, distinct: [...sizes].sort((a, b) => a - b), off };
};
const judge = (name, r) => {
  const bad = Object.entries(r.off).sort((a, b) => b[1] - a[1]);
  ok(r.n >= 8, `${name}: ${r.n} text-bearing elements measured (vacuity guard)`);
  ok(bad.length === 0, `${name}: every painted size is a step — ${r.distinct.length} distinct (${r.distinct.join(', ')})${bad.length ? ' — OFF: ' + bad.slice(0, 8).map(([k, v]) => k + ' ×' + v).join('; ') : ''}`);
};

(async () => {
  const t = await bootBrowser();
  const newPage = async (w, guest) => {
    const page = await t.browser.newPage({ viewport: { width: w, height: w < 600 ? 844 : 900 } });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.addInitScript(() => { if (navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(() => {}); });
    await stub(page, guest);
    page.on('pageerror', (e) => fails.push('pageerror: ' + e.message));
    await page.goto(t.base + '/index.html', { waitUntil: 'networkidle' });
    await page.evaluate(() => { if (!document.body.classList.contains('light-mode')) { try { toggleTheme(); } catch (e) { document.body.classList.add('light-mode'); } } });
    await page.waitForTimeout(400);
    return page;
  };
  const open = async (page, code, ms) => { await page.evaluate((c) => eval(c), code); await page.waitForTimeout(ms || 900); };

  for (const w of [390, 1280]) {
    console.log(`— guest at ${w} —`);
    let page = await newPage(w, true);
    judge(`home ${w}`, await page.evaluate(SWEEP));
    await open(page, "openProperty('21a')"); judge(`cottage ${w}`, await page.evaluate(SWEEP));
    await open(page, 'openEnquireModal()'); judge(`enquiry sheet ${w}`, await page.evaluate(SWEEP));
    await open(page, 'closeEnquireModal()', 400);
    await open(page, "(async () => { currentGuest = { id: 9, name: 'Priya Patel', email: 'guest@example.com' }; try { setAuthUI(); } catch (e) {} nav('view-guest-bookings'); await renderGuestBookings(); })()", 1200);
    judge(`my stays ${w}`, await page.evaluate(SWEEP));
    if (w === 390) { await open(page, "(async () => { try { toggleChat(); } catch (e) {} })()"); judge('chat 390', await page.evaluate(SWEEP)); await open(page, "(async () => { try { closeChat(); } catch (e) {} })()", 300); }
    await page.close();

    console.log(`— owner at ${w} —`);
    page = await newPage(w, false);
    await open(page, "(async () => { isAuthenticated = true; document.body.classList.add('owner-mode'); nav('view-backoffice'); await initBackOffice(); })()", 1400);
    judge(`today ${w}`, await page.evaluate(SWEEP));
    // The search window: on the app's scale since round eight (its own six tokens
    // resolve to app steps), so the answered state is swept like any screen.
    await open(page, "(async () => { openCmdK(); })()", 900);
    await open(page, "(async () => { const i = document.getElementById('cmdk-input'); if (i) { i.value = 'who owes me money'; i.dispatchEvent(new Event('input', { bubbles: true })); } })()", 1200);
    judge(`search answer ${w}`, await page.evaluate(SWEEP));
    await open(page, "(async () => { closeCmdK(); })()", 400);
    await open(page, "(async () => { await openBookingHub('b2'); })()", 1200); judge(`booking hub ${w}`, await page.evaluate(SWEEP));
    await open(page, "(async () => { await openEnquiryHub(11); })()", 1200); judge(`enquiry hub ${w}`, await page.evaluate(SWEEP));
    await open(page, "(async () => { await openInbox(); inboxFolder('enquiries'); })()", 1000); judge(`inbox ${w}`, await page.evaluate(SWEEP));
    await open(page, "(async () => { await openAccounts(); })()", 1200); judge(`payments ${w}`, await page.evaluate(SWEEP));
    await open(page, "(async () => { await openArea('manage'); })()", 1000); judge(`manage ${w}`, await page.evaluate(SWEEP));
    await open(page, "(async () => { await openArea('settings'); settingsOpen('diagnostics'); })()", 1200); judge(`system check ${w}`, await page.evaluate(SWEEP));
    await page.close();
  }
  console.log(fails.length ? `\n  ${fails.length} TYPE-SCALE CHECK(S) FAILED ❌` : '\n  TYPE-SCALE SUITE PASSED ✅');
  await t.done(fails.length);
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
