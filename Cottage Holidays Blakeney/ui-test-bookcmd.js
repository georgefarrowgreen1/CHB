// Booking commands, end to end in a real browser:
//  1. a move proposal's run() opens the EDIT modal prefilled with the
//     PROPOSED dates (record id set, nothing saved)
//  2. a quote's run() opens the Add-Booking modal prefilled with the quoted
//     cottage + dates, price recalculated live
process.env.TZ = 'Europe/London';
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const PORT = 8287;
let fails = 0;
const ok = (b, m) => { console.log(`  ${b ? '✓' : '✗'} ${m}`); if (!b) fails++; };

(async () => {
  const server = spawn('php', ['-S', `127.0.0.1:${PORT}`, '-t', __dirname], { stdio: 'ignore' });
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://127.0.0.1:${PORT}/index.html`)).ok) break; } catch (e) {} await new Promise((r) => setTimeout(r, 250)); }
  const browser = await chromium.launch(process.env.CHB_CHROMIUM ? { executablePath: process.env.CHB_CHROMIUM } : {});
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', (e) => { console.log('  PAGEERR:', e.message); fails++; });
  await page.addInitScript(() => { if (navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(() => {}); });
  const d = (n) => { const t = new Date(); const x = new Date(t.getFullYear(), t.getMonth(), t.getDate() + n); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
  const bookings = [{ id: 1, prop_key: 'jollyboat', name: 'Bob Carter', email: 'b@x.co', phone: '', check_in: d(10), check_out: d(13), adults: 2, children: 0, payment: 'deposit', deposit_paid: 100, agreed_total: 500, hold_status: 'none' }];
  await page.route(/\.php/, (route) => {
    const url = route.request().url();
    const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (url.includes('bookings.php') && route.request().method() !== 'POST') return json({ bookings });
    if (url.includes('rates.php') && route.request().method() !== 'POST') return json({ properties: [
      { prop_key: 'jollyboat', name: 'Jollyboat', slug: 'jollyboat', couple_rate: 130, extra_adult_rate: 20, child_rate: 10, transaction_pct: 0, booking_fee: 50, max_adults: 2, max_children: 0, max_total: 2, sort_order: 1 },
    ], seasons: {}, occupancy: {} });
    return json({ ok: true, events: [], logs: {}, results: [], threads: [], enquiries: [], reviews: [], photos: [], value: null, corpus: [] });
  });
  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'networkidle' });
  await page.evaluate(async () => { isAuthenticated = true; document.body.classList.add('owner-mode'); await window.loadAdminBundle(); });
  await page.evaluate(() => loadData()); await page.waitForTimeout(400);
  await page.evaluate(() => nav('view-backoffice')); await page.waitForTimeout(300);

  // 1) Move proposal → EDIT modal prefilled with the proposed dates.
  await page.evaluate(() => { const r = cmdkIntent('move bob back a week'); r[0].run(); });
  await page.waitForTimeout(400);
  let st = await page.evaluate(() => ({
    title: (document.getElementById('modal-title') || {}).innerText,
    id: (document.getElementById('modal-record-id') || {}).value,
    ci: (document.getElementById('modal-checkin') || {}).value,
    co: (document.getElementById('modal-checkout') || {}).value,
  }));
  ok(/Edit \/ Move/.test(st.title || ''), `move opens the EDIT modal (${st.title})`);
  ok(String(st.id).length > 0, `record id carried (${st.id})`);
  ok(st.ci === d(17) && st.co === d(20), `proposed dates prefilled (${st.ci} → ${st.co})`);
  await page.evaluate(() => closeModal());

  // 2) Quote → Add-Booking modal prefilled with cottage + dates.
  await page.evaluate((dates) => { const r = cmdkIntent(`how much for ${dates} at jollyboat`); r[0].run(); }, (() => { const a = new Date(); a.setDate(a.getDate() + 30); const b = new Date(); b.setDate(b.getDate() + 33); const f = (x) => x.getDate() + ' ' + x.toLocaleDateString('en-GB', { month: 'short' }).toLowerCase(); return `${f(a)} to ${f(b)}`; })());
  await page.waitForTimeout(400);
  st = await page.evaluate(() => ({
    title: (document.getElementById('modal-title') || {}).innerText,
    prop: (document.getElementById('modal-property') || {}).value,
    ci: (document.getElementById('modal-checkin') || {}).value,
    co: (document.getElementById('modal-checkout') || {}).value,
  }));
  ok(!/Edit/.test(st.title || ''), `quote opens the ADD modal (${st.title})`);
  ok(st.prop === 'jollyboat' && st.ci === d(30) && st.co === d(33), `quoted cottage + dates prefilled (${st.prop} ${st.ci} → ${st.co})`);

  await browser.close();
  server.kill();
  console.log(fails ? `\n  ${fails} BOOKCMD CHECK(S) FAILED ❌` : '\n  BOOKCMD SUITE PASSED ✅');
  process.exit(fails ? 1 : 0);
})();
