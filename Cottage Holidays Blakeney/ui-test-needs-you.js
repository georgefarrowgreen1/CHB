// NEEDS YOU strip (Today), end to end against mocked endpoints:
//  1. mixed workload → rows render, prioritised (automation → enquiry →
//     deposit/chase → chats → approvals), count badge right
//  2. capped at 4 with "Show N more"; expanding reveals the rest
//  3. rows ROUTE: enquiry → enquiry hub, chase → booking hub, approve → reviews
//  4. all clear → the section hides entirely
// The site reckons "today" in UK time (todayDashed / ukNowParts), so the
// tests must too — pin the whole process (and the browser it launches) to
// Europe/London so fixtures built from new Date() agree with the app on
// any runner, in any timezone. Must run before the first Date call.
process.env.TZ = 'Europe/London';
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const PORT = 8209;
let fails = 0;
const ok = (b, m) => { console.log(`  ${b ? '✓' : '✗'} ${m}`); if (!b) fails++; };

(async () => {
  const server = spawn('php', ['-S', `127.0.0.1:${PORT}`, '-t', __dirname], { stdio: 'ignore' });
  // Wait for php -S to actually accept connections (a fixed sleep flakes on slow CI runners).
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://127.0.0.1:${PORT}/index.html`)).ok) break; } catch (e) {} await new Promise((r) => setTimeout(r, 250)); }
  const browser = await chromium.launch(process.env.CHB_CHROMIUM ? { executablePath: process.env.CHB_CHROMIUM } : {});
  const page = await browser.newPage({ viewport: { width: 1280, height: 950 } });
  page.on('pageerror', (e) => { console.log('  PAGEERR:', e.message); fails++; });
  await page.addInitScript(() => { if (navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(() => {}); });

  // Local-formatted, never toISOString() — that's UTC and slips a day near midnight.
  const d = (n) => { const t = new Date(); const x = new Date(t.getFullYear(), t.getMonth(), t.getDate() + n); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
  // Enquiry age: the app FLOORS elapsed hours into days, so seed by hours-ago
  // (a date + fixed clock time reads differently depending on when the test runs).
  const hrsAgo = (h) => { const t = new Date(Date.now() - h * 3600e3); const p = (n) => String(n).padStart(2, '0'); return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())} ${p(t.getHours())}:${p(t.getMinutes())}:00`; };
  const mkB = (id, prop, name, inD, outD, pay, dep, hold) => ({
    id, prop_key: prop, name, email: 'g@e.com', phone: '', address: '', postcode: 'NR25 7AB',
    check_in: d(inD), check_out: d(outD), check_in_time: '15:00', check_out_time: '10:00',
    adults: 2, children: 0, payment: pay, deposit_paid: dep, payment_method: 'card', payment_date: '',
    agreed_total: 640, agreed_per_night: 145, agreed_nights: 4, agreed_nightly: 580, agreed_booking_fee: 60,
    agreed_txn_pct: 0, agreed_txn_fee: 0, agreed_on: d(-10), hold_status: hold || 'none', notes: '',
  });
  let quietMode = false;
  await page.route(/\.php/, (route) => {
    const url = route.request().url();
    const post = route.request().postData() || '';
    const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    let act = ''; try { act = JSON.parse(post || '{}').action || ''; } catch (e) {}
    if (quietMode) {
      return json({ ok: true, bookings: [], enquiries: [], threads: [], reviews: [], photos: [], experiences: [], events: [], logs: {}, content: {}, blocks: [], ranges: [], payments: [], seasons: {}, occupancy: {}, properties: [] });
    }
    if (url.includes('cron-status.php')) return json({ stale: true, everRan: true, ageHours: 50 });
    if (url.includes('bookings.php')) {
      if (act === 'email_logs') return json({ ok: true, logs: {} });
      if (act === 'history') return json({ ok: true, history: [] });
      return json({ bookings: [
        mkB(1, '21a', 'Sarah Pemberton', 3, 7, 'deposit', 120),      // chase: arrives in 3 days
        mkB(2, 'jollyboat', 'Emma Clarke', -6, -2, 'paid', 0, 'charged'), // deposit to return
        mkB(3, 'pimpernel', 'Tom Hardy', 40, 44, 'unpaid', 0),        // too far out — no row
      ] });
    }
    if (url.includes('enquiries.php')) return json({ enquiries: [
      { id: 7, prop_key: '21a', name: 'Jane Doe', email: 'j@e.com', phone: '', check_in: d(20), check_out: d(24), adults: 2, children: 0, message: 'Dogs?', status: 'new', created_at: hrsAgo(53) /* 2 days 5h → always "waiting 2 days" (danger) */ },
    ] });
    if (url.includes('messages.php')) return json({ ok: true, threads: [
      { thread_id: 1, name: 'Ali', unread: 1, last_role: 'guest', archived: 0, last_body: 'Hi' },
      { thread_id: 2, name: 'Bea', unread: 0, last_role: 'admin', archived: 0, last_body: 'Thanks' },
    ] });
    if (url.includes('reviews.php')) return json({ ok: true, reviews: [{ id: 1, status: 'pending' }] });
    if (url.includes('photos.php')) return json({ ok: true, photos: [] });
    if (url.includes('experiences.php')) return json({ ok: true, experiences: [] });
    return json({ ok: true, bookings: [], enquiries: [], threads: [], reviews: [], photos: [], experiences: [], events: [], logs: {}, content: {}, blocks: [], ranges: [], payments: [], seasons: {}, occupancy: {}, properties: [] });
  });

  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  await page.evaluate(() => { isAuthenticated = true; document.body.classList.add('owner-mode'); });
  await page.evaluate(() => window.loadAdminBundle());
  await page.waitForTimeout(600);
  await page.evaluate(async () => { await openBookings(); });
  await page.waitForTimeout(1600);

  console.log('1. mixed workload renders, prioritised');
  const s = await page.evaluate(() => ({
    visible: document.getElementById('needs-you').style.display !== 'none',
    count: document.getElementById('needs-you-count').textContent,
    labels: [...document.querySelectorAll('#needs-you-list .ny-label')].map((e) => e.textContent),
    sevs: [...document.querySelectorAll('#needs-you-list .ny-row')].map((e) => e.className.match(/ny-(danger|warn|ok)/)[1]),
    more: (document.querySelector('.ny-more') || {}).textContent || '',
  }));
  ok(s.visible, 'strip shows with work waiting');
  ok(s.count === '6', `count badge = 6 (${s.count})`);
  ok(/automation looks stopped/.test(s.labels[0] || ''), `automation warning leads (${s.labels[0]})`);
  ok(/Jane Doe/.test(s.labels[1] || '') && /waiting 2 days/.test(s.labels[1] || ''), `enquiry second with age (${s.labels[1]})`);
  ok(s.labels.some((l) => /damages deposit/.test(l)), 'deposit-return row present');
  ok(s.labels.some((l) => /Sarah Pemberton arrives in 3 days — £520.00 to collect/.test(l)), `chase row with amount (${s.labels[3] || ''})`);
  ok(!s.labels.some((l) => /Tom Hardy/.test(l)), 'far-future unpaid booking not nagged');
  ok(s.sevs[0] === 'danger' && s.sevs[1] === 'danger', 'severities: automation + 2-day-old enquiry are danger');

  console.log('2. capped at 4 + expand');
  ok(s.labels.length === 4 && /Show 2 more/.test(s.more), `4 shown, "${s.more}"`);
  await page.evaluate(() => needsYouExpand());
  await page.waitForTimeout(300);
  const s2 = await page.evaluate(() => ({
    labels: [...document.querySelectorAll('#needs-you-list .ny-label')].map((e) => e.textContent),
    more: !!document.querySelector('.ny-more'),
  }));
  ok(s2.labels.length === 6 && !s2.more, `expanded to all 6 (${s2.labels.length})`);
  ok(/guest chat/.test(s2.labels[4] || '') && /review to approve/.test(s2.labels[5] || ''), `chat + approval rows last (${s2.labels[4]}, ${s2.labels[5]})`);

  console.log('3. rows route to the right place');
  await page.evaluate(() => { [...document.querySelectorAll('#needs-you-list .ny-row')].find((r) => /Jane Doe/.test(r.textContent)).click(); });
  await page.waitForTimeout(800);
  const enq = await page.evaluate(() => ({
    view: (document.querySelector('.page-view.active') || {}).id,
    hub: (document.getElementById('enquiry-hub-content') || {}).textContent || '',
  }));
  // ≥1200px the enquiry hub docks inside the Inbox pane (master–detail);
  // narrower screens open it standalone — both are the right destination.
  ok(/view-(enquiry-hub|inbox)/.test(enq.view) && /Jane Doe/.test(enq.hub), `enquiry row opens Jane's enquiry hub (${enq.view})`);
  await page.evaluate(async () => { await openBookings(); });
  await page.waitForTimeout(1200);
  await page.evaluate(() => { needsYouExpand(); [...document.querySelectorAll('#needs-you-list .ny-row')].find((r) => /Sarah Pemberton/.test(r.textContent)).click(); });
  await page.waitForTimeout(800);
  const hub = await page.evaluate(() => ({
    view: (document.querySelector('.page-view.active') || {}).id,
    name: (document.querySelector('.bhub-name') || {}).textContent || '',
  }));
  ok(/view-(booking-hub|backoffice)/.test(hub.view) && /Sarah/.test(hub.name), `chase row opens Sarah's hub (${hub.view}, ${hub.name})`);
  await page.evaluate(async () => { await openBookings(); });
  await page.waitForTimeout(1200);
  await page.evaluate(() => { needsYouExpand(); [...document.querySelectorAll('#needs-you-list .ny-row')].find((r) => /review to approve/.test(r.textContent)).click(); });
  await page.waitForTimeout(800);
  const rev = await page.evaluate(() => ({
    view: (document.querySelector('.page-view.active') || {}).id,
    sec: (document.getElementById('sec-reviews') || { style: {} }).style.display,
  }));
  ok(rev.view === 'view-settings' && rev.sec !== 'none', `approve row opens Manage → Reviews (${rev.view})`);

  console.log('4. all clear → hidden');
  await page.evaluate(() => { window.__QUIET = 1; });
  quietMode = true;
  await page.evaluate(async () => { __nyChats = 0; __nyMod = { rev: 0, ph: 0, exp: 0 }; __nyCronQuiet = false; await openBookings(); });
  await page.waitForTimeout(1400);
  const q = await page.evaluate(() => ({
    hidden: document.getElementById('needs-you').style.display === 'none',
    ops: (document.getElementById('today-date') || {}).textContent || '',
  }));
  ok(q.hidden, 'strip hides when nothing needs the owner');
  ok(/all quiet/.test(q.ops), `ops line says all quiet (${q.ops})`);

  await browser.close(); server.kill();
  console.log(fails ? `NEEDS-YOU TEST FAILED ❌ (${fails})` : 'NEEDS-YOU TEST PASSED ✅');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
