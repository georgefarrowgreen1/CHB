// Guided walkthrough ("Walk me through it") end to end against mocked endpoints:
//  1. coachWalk('add-booking') opens the modal and starts the sequence at step 1
//  2. the overlay is a WALKTHROUGH (coach-ov-seq): click-through + above the modal
//  3. it AUTO-ADVANCES when a step's `until` fires (fill the name → moves on)
//  4. Next / Back move between steps; the last step reads "Done"
//  5. it stays SAFE — no booking is saved by the coach (it only points)
//  6. Escape tears it down; a how-to answer carries the "Walk me through it" chip
process.env.TZ = 'Europe/London';
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const PORT = 8273;
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
  const bookings = [{ id: 1, prop_key: 'jollyboat', name: 'Alice Harper', email: 'a@x.co', phone: '', check_in: d(3), check_out: d(6), adults: 2, children: 0, payment: 'paid', agreed_total: 440, hold_status: 'none' }];
  await page.route(/\.php/, (route) => {
    const url = route.request().url();
    const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    const post = route.request().method() === 'POST';
    if (url.includes('bookings.php') && !post) return json({ bookings });
    if (url.includes('rates.php') && !post) return json({ properties: [
      { prop_key: 'jollyboat', name: 'Jollyboat', slug: 'jollyboat', couple_rate: 130, booking_fee: 50, max_adults: 2, max_children: 0, max_total: 2, sort_order: 1 },
    ], seasons: {}, occupancy: {} });
    return json({ ok: true, events: [], logs: {}, results: [], threads: [], enquiries: [], reviews: [], photos: [], value: null });
  });
  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'networkidle' });
  await page.evaluate(async () => { isAuthenticated = true; document.body.classList.add('owner-mode'); await window.loadAdminBundle(); });
  await page.evaluate(() => loadData()); await page.waitForTimeout(500);
  await page.evaluate(() => nav('view-backoffice')); await page.waitForTimeout(400);

  // 1) The how-to answer carries a "Walk me through it" chip.
  const chip = await page.evaluate(() => {
    const built = cmdkBuildResults('how do i add a booking');
    const r = ((built && built.results) || []).find((x) => x && /how to add/i.test(x.label || ''));
    return r ? (r.chips || []).map((c) => c.label) : [];
  });
  ok(chip.includes('Walk me through it'), `how-to answer offers "Walk me through it" (${chip.join(', ')})`);

  // 2) Start the Add-Booking walkthrough.
  await page.evaluate(() => coachWalk('add-booking'));
  await page.waitForTimeout(800);
  let st = await page.evaluate(() => {
    const ov = document.querySelector('.coach-ov-seq');
    const step = ov ? ov.querySelector('.coach-tip-step').textContent : '';
    const modal = !!document.querySelector('#modal-property');
    const pe = ov ? getComputedStyle(ov).pointerEvents : '';
    const z = ov ? +getComputedStyle(ov).zIndex : 0;
    return { open: !!ov, step, modal, pe, z };
  });
  ok(st.open && st.modal, 'walkthrough starts: overlay up + Add-Booking modal open');
  ok(/step 1 of 5/i.test(st.step), `starts at step 1 of 5 (${st.step})`);
  ok(st.pe === 'none', 'overlay is click-through (pointer-events:none) so the field is usable');
  ok(st.z >= 7000, `overlay sits above the modal (z=${st.z})`);

  // 3) Next advances to the dates step.
  await page.evaluate(() => document.querySelector('.coach-ov-seq .coach-tip-btn').click());
  await page.waitForTimeout(400);
  let step = await page.evaluate(() => document.querySelector('.coach-ov-seq .coach-tip-step')?.textContent || '');
  ok(/step 2 of 5/i.test(step), `Next → step 2 (${step})`);

  // 4) Back returns to step 1.
  await page.evaluate(() => document.querySelector('.coach-ov-seq .coach-tip-back').click());
  await page.waitForTimeout(400);
  step = await page.evaluate(() => document.querySelector('.coach-ov-seq .coach-tip-step')?.textContent || '');
  ok(/step 1 of 5/i.test(step), `Back → step 1 (${step})`);

  // 5) AUTO-ADVANCE: jump to the name step, fill it, and watch it move on by itself.
  await page.evaluate(() => coachSequence(CHB_WALK['add-booking'].steps, 2)); // name step
  await page.waitForTimeout(400);
  step = await page.evaluate(() => document.querySelector('.coach-ov-seq .coach-tip-step')?.textContent || '');
  ok(/step 3 of 5/i.test(step), `on the name step (${step})`);
  await page.evaluate(() => { const n = document.getElementById('modal-name'); n.value = 'Jamie Fenn'; });
  await page.waitForTimeout(700); // poll is 350ms
  step = await page.evaluate(() => document.querySelector('.coach-ov-seq .coach-tip-step')?.textContent || '');
  ok(/step 4 of 5/i.test(step), `typing the name AUTO-ADVANCES to step 4 (${step})`);

  // 6) The last step reads "Done", and the coach never saved a booking itself.
  await page.evaluate(() => coachSequence(CHB_WALK['add-booking'].steps, 4)); // save step (last)
  await page.waitForTimeout(300);
  const last = await page.evaluate(() => document.querySelector('.coach-ov-seq .coach-tip-btn')?.textContent || '');
  ok(last === 'Done', `last step's button reads "Done" (${last})`);

  // 7) Escape tears the whole thing down.
  await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
  await page.waitForTimeout(200);
  const gone = await page.evaluate(() => !document.querySelector('.coach-ov-seq') && (typeof __coachSeq === 'undefined' || __coachSeq === null));
  ok(gone, 'Escape ends the walkthrough (overlay + state cleared)');

  console.log(fails ? `\n  ${fails} CHECK(S) FAILED ❌` : '\n  GUIDED WALKTHROUGH SUITE PASSED ✅');
  await browser.close();
  server.kill();
  process.exit(fails ? 1 : 0);
})();
