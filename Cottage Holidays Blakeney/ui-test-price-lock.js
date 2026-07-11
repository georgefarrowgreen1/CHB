// Edit-a-confirmed-booking price lock: while the stay is unchanged the modal
// must show the AGREED (locked) price — exactly what saving preserves — and
// only show today's rates (with an explicit replaces-note) once the stay
// actually changes. Reproduces the owner's Richard Berry case: agreed at
// £135/night (£631.20 grand incl. £75 deposit) vs live rates at £165/night.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const PORT = 8231;
let fails = 0;
const ok = (b, m) => { console.log(`  ${b ? '✓' : '✗'} ${m}`); if (!b) fails++; };

(async () => {
  const server = spawn('php', ['-S', `127.0.0.1:${PORT}`, '-t', process.cwd()], { stdio: 'ignore' });
  // Wait for php -S to actually accept connections (a fixed sleep flakes on slow CI runners).
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://127.0.0.1:${PORT}/index.html`)).ok) break; } catch (e) {} await new Promise((r) => setTimeout(r, 250)); }
  const browser = await chromium.launch(process.env.CHB_CHROMIUM ? { executablePath: process.env.CHB_CHROMIUM } : {});
  const page = await browser.newPage({ viewport: { width: 1000, height: 1200 } });
  page.on('pageerror', (e) => { console.log('  PAGEERR:', e.message); fails++; });
  await page.addInitScript(() => { if (navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(() => {}); });
  const d = (n) => { const t = new Date(); t.setDate(t.getDate() + n); return t.toISOString().slice(0, 10); };

  await page.route(/\.php/, (route) => {
    const url = route.request().url();
    const post = route.request().postData() || '';
    let act = ''; try { act = JSON.parse(post || '{}').action || ''; } catch (e) {}
    const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (url.includes('rates.php')) return json({ properties: [{ prop_key: 'jollyboat', name: 'Jollyboat', slug: 'jollyboat', couple_rate: 165, extra_adult_rate: 0, child_rate: 0, booking_fee: 75, transaction_pct: 3, lastmin_pct: 0, lastmin_days: 0, max_adults: 2, max_children: 0, max_total: 2, sort_order: 1 }], seasons: {}, occupancy: {} });
    if (url.includes('bookings.php')) {
      if (act) return json({ ok: true, logs: {}, history: [] });
      return json({ bookings: [{ id: 37, prop_key: 'jollyboat', name: 'Richard Berry', email: 'r@e.com', phone: '', address: '', postcode: '', check_in: d(2), check_out: d(6), check_in_time: '15:00', check_out_time: '10:00', adults: 2, children: 0, payment: 'paid', deposit_paid: 631.2, agreed_total: 556.2, agreed_per_night: 135, agreed_nights: 4, agreed_nightly: 540, agreed_booking_fee: 75, agreed_txn_pct: 3, agreed_txn_fee: 16.2, agreed_on: d(-20), hold_status: 'charged', notes: '' }] });
    }
    return json({ ok: true, bookings: [], enquiries: [], threads: [], reviews: [], photos: [], experiences: [], events: [], logs: {}, content: {}, blocks: [], ranges: [], payments: [], seasons: {}, occupancy: {}, properties: [] });
  });

  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1400);
  await page.evaluate(() => { isAuthenticated = true; document.body.classList.add('owner-mode'); });
  await page.evaluate(() => window.loadAdminBundle());
  await page.waitForTimeout(700);
  await page.evaluate(() => loadData());
  await page.waitForTimeout(600);

  console.log('1. unchanged stay → the LOCKED price');
  await page.evaluate(() => openEditBooking('b37'));
  await page.waitForTimeout(700);
  const t1 = await page.evaluate(() => (document.getElementById('modal-price-box') || {}).textContent || '');
  ok(/Agreed total/.test(t1), 'labelled "Agreed total"');
  ok(/£631\.20/.test(t1), `shows the locked £631.20 grand (${(t1.match(/£[\d.]+/g) || []).join(' ')})`);
  ok(/£135\.00 × 4 nights/.test(t1.replace(/\s+/g, ' ')), 'agreed £135/night, not today’s £165');
  ok(/locked at the rates in effect when booked/.test(t1), 'locked note shown');
  ok(!/£754\.80/.test(t1) && !/£660\.00/.test(t1), 'no live-rate figures leak in');

  console.log('2. change the stay → today’s rates + explicit replaces-note');
  await page.evaluate(() => {
    const co = document.getElementById('modal-checkout');
    const dt = new Date(co.value); dt.setDate(dt.getDate() + 1);
    co.value = dt.toISOString().slice(0, 10);
    updateModalPrice();
  });
  await page.waitForTimeout(300);
  const t2 = await page.evaluate(() => (document.getElementById('modal-price-box') || {}).textContent || '');
  ok(/× 5 nights/.test(t2) && /£165|£825/.test(t2), 'live reprice at today’s rates for the new stay');
  ok(/saving replaces the agreed £631\.20/.test(t2), 'explicit note that saving replaces the agreed total');

  console.log('3. change back → locked again');
  await page.evaluate(() => {
    const co = document.getElementById('modal-checkout');
    const dt = new Date(co.value); dt.setDate(dt.getDate() - 1);
    co.value = dt.toISOString().slice(0, 10);
    updateModalPrice();
  });
  await page.waitForTimeout(300);
  const t3 = await page.evaluate(() => (document.getElementById('modal-price-box') || {}).textContent || '');
  ok(/Agreed total/.test(t3) && /£631\.20/.test(t3), 'reverting the dates restores the locked display');

  await browser.close(); server.kill();
  console.log(fails ? `PRICE-LOCK TEST FAILED ❌ (${fails})` : 'PRICE-LOCK TEST PASSED ✅');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
