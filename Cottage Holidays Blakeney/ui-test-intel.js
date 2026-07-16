// Ambient intelligence, end to end in a real browser:
//  1. a repeat guest's booking hub leads with the "Knows your guest" card
//     (ordinal + lifetime from the unified directory, strong identity)
//  2. a first-time guest's hub has NO intel card (empty dossier = noise)
//  3. the Needs-you strip carries the gap row with chbGapPlan's DECISION —
//     a one-tap dated offer (15% off the current rate), not a Book action
//  4. tapping Offer SAVES the 'Gap offer' override through seasons_save and
//     the row flips to its live status (routing to Rates)
process.env.TZ = 'Europe/London';
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const PORT = 8282;
let fails = 0;
const ok = (b, m) => { console.log(`  ${b ? '✓' : '✗'} ${m}`); if (!b) fails++; };

(async () => {
  const server = spawn('php', ['-S', `127.0.0.1:${PORT}`, '-t', __dirname], { stdio: 'ignore' });
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://127.0.0.1:${PORT}/index.html`)).ok) break; } catch (e) {} await new Promise((r) => setTimeout(r, 250)); }
  const browser = await chromium.launch(process.env.CHB_CHROMIUM ? { executablePath: process.env.CHB_CHROMIUM } : {});
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on('pageerror', (e) => { console.log('  PAGEERR:', e.message); fails++; });
  await page.addInitScript(() => { if (navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(() => {}); });

  const d = (n) => { const t = new Date(); const x = new Date(t.getFullYear(), t.getMonth(), t.getDate() + n); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
  const mk = (id, name, email, ci, co) => ({ id, prop_key: 'jollyboat', name, email, phone: '', check_in: ci, check_out: co, adults: 2, children: 0, payment: 'paid', agreed_total: 440, hold_status: 'none' });
  // Alice is a REPEAT guest (same email, two stays); Bob + Carol bound a
  // 3-night gap starting 8 days out; Carol is also the first-time control.
  const bookings = [
    mk(1, 'Alice Harper', 'a@x.co', d(40), d(43)),
    mk(2, 'Alice Harper', 'a@x.co', d(60), d(63)),
    mk(3, 'Bob Mills', 'b@x.co', d(5), d(8)),
    mk(4, 'Carol Reeve', 'c@x.co', d(11), d(14)),
  ];
  const saved = []; // seasons_save payloads the page writes
  await page.route(/\.php/, (route) => {
    const url = route.request().url();
    const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (url.includes('bookings.php') && route.request().method() !== 'POST') return json({ bookings });
    if (url.includes('rates.php')) {
      if (route.request().method() === 'POST') {
        try { const b = JSON.parse(route.request().postData() || '{}'); if (b.action === 'seasons_save') saved.push(b); } catch (e) {}
        return json({ ok: true });
      }
      return json({ properties: [
        { prop_key: 'jollyboat', name: 'Jollyboat', slug: 'jollyboat', couple_rate: 130, booking_fee: 50, max_adults: 2, max_children: 0, max_total: 2, sort_order: 1 },
      ], seasons: {}, occupancy: {} });
    }
    return json({ ok: true, events: [], logs: {}, results: [], threads: [], enquiries: [], reviews: [], photos: [], value: null, corpus: [] });
  });
  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'networkidle' });
  await page.evaluate(async () => { isAuthenticated = true; document.body.classList.add('owner-mode'); await window.loadAdminBundle(); });
  await page.evaluate(() => loadData()); await page.waitForTimeout(400);
  await page.evaluate(() => nav('view-backoffice')); await page.waitForTimeout(500);

  // 1) Repeat guest's hub leads with the intel card. (Loaded booking ids are
  // client-prefixed, so resolve Alice's SECOND stay from the data.)
  await page.evaluate(() => {
    const b = dbBookings.jollyboat.filter((x) => x.email === 'a@x.co').sort((a, z) => a.checkIn.localeCompare(z.checkIn))[1];
    openBookingHub(b.id);
  });
  await page.waitForTimeout(500);
  let card = await page.evaluate(() => {
    const c = document.getElementById('hub-intel-card');
    return c ? c.textContent : null;
  });
  ok(!!card, 'repeat guest: the "Knows your guest" card renders on the hub');
  ok(card && /2nd stay/.test(card), `card carries the visit ordinal (${(card || '').slice(0, 60).trim()})`);
  ok(card && /lifetime/.test(card), 'card carries the lifetime figures');

  // 2) First-timer gets no card.
  await page.evaluate(() => openBookingHub(dbBookings.jollyboat.find((x) => x.email === 'c@x.co').id)); await page.waitForTimeout(400);
  const none = await page.evaluate(() => !document.getElementById('hub-intel-card'));
  ok(none, 'first-time guest: no intel card (nothing worth knowing)');

  // 3) The Needs-you strip decides the gap's best outcome: a one-tap offer
  // (15% off the £130 rate → £111), never a manual Book.
  await page.evaluate(() => nav('view-backoffice')); await page.waitForTimeout(300);
  await page.evaluate(() => renderNeedsYou());
  const gap = await page.evaluate(() => {
    const row = [...document.querySelectorAll('#needs-you-list .ny-row')].find((r) => /night gap on/.test(r.textContent));
    return row ? row.textContent : null;
  });
  ok(!!gap && /Fill the 3-night gap on Jollyboat: offer £111\/night/.test(gap), `Needs-you leads with the priced offer (${(gap || 'none').slice(0, 90).trim()})`);
  ok(!!gap && /15% off the usual £130/.test(gap) && /Offer ›/.test(gap), `…with the discount maths + an Offer action, not Book (${(gap || 'none').slice(-60).trim()})`);

  // 4) Tapping Offer SAVES the dated 'Gap offer' override and the row flips
  // to its live status.
  await page.evaluate(() => { [...document.querySelectorAll('#needs-you-list .ny-row')].find((r) => /night gap on/.test(r.textContent)).click(); });
  await page.waitForTimeout(600);
  const pay = saved.find((b) => b.prop_key === 'jollyboat');
  const season = pay && (pay.seasons || []).find((s) => s.label === 'Gap offer');
  ok(!!season && season.rate === 111 && season.start === d(8) && season.end === d(10), `Offer saved the dated override via seasons_save (${JSON.stringify(season)})`);
  const live = await page.evaluate(() => {
    const row = [...document.querySelectorAll('#needs-you-list .ny-row')].find((r) => /Offer live on/.test(r.textContent));
    return row ? row.textContent : null;
  });
  ok(!!live && /Offer live on Jollyboat — £111\/night/.test(live) && /Rates ›/.test(live), `the row flips to its live status routing to Rates (${(live || 'none').slice(0, 90).trim()})`);

  await browser.close();
  server.kill();
  console.log(fails ? `\n  ${fails} INTEL CHECK(S) FAILED ❌` : '\n  INTEL SUITE PASSED ✅');
  process.exit(fails ? 1 : 0);
})();
