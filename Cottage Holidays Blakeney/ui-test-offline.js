// ui-test-offline.js — THE BACK OFFICE ON A DEAD CONNECTION.
//
// The promise under test: a changeover morning with no signal still gets its
// day sheet. On every successful loadData the owner's phone saves a snapshot
// (today's movements + in-residence + the next two mornings' arrivals, plus the
// ops- cottage notes); an offline boot on a device the owner has signed in from
// enters owner-mode anyway (the chb-was-admin hint — the server can't answer
// with no connection, and a 401 is a different thing from a timeout) and Today
// renders the SNAPSHOT behind an explicit marker, with the live workspace
// hidden outright — half-real panels under an offline banner would present
// empty stores as facts.
//
// "Offline" here is every .php aborted while static files still serve — the
// dead-API shape ui-test-poorsignal established (the harness stubs the service
// worker, so the full no-network case is out of reach; the APP layer is what
// this suite owns, and the SW half is a smoke-test source assertion).
//
// Each check was BREAK-TESTED: the boot hint (remove the catch branch →
// §3 lands on the public site), the snapshot write (remove chbSnapWrite →
// §1 has no rows), the regrouping (trust the stored day → §4 shows yesterday's
// labels), the retry honesty (drop the stillDead branch → §5 claims live), and
// the logout hygiene (drop the removeItem pair → §6 leaves the sheet behind).
const { boot } = require('./ui-test-lib');
let fails = 0;
const ok = (b, m) => { console.log(`  ${b ? '✓' : '✗'} ${m}`); if (!b) fails++; };
const d = (n) => { const t = new Date(); const x = new Date(t.getFullYear(), t.getMonth(), t.getDate() + n); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };

(async () => {
  const { page, base, done } = await boot({ viewport: { width: 390, height: 844 } });

  let apiDead = false;
  const mkBooking = (id, over) => Object.assign({
    id, prop_key: '21a', name: 'Guest ' + id, email: 'g' + id + '@x.co', phone: '', address: '',
    postcode: '', check_in: d(20), check_out: d(23), check_in_time: '15:00', check_out_time: '10:00',
    adults: 2, children: 0, payment: 'paid', deposit_paid: 440, payment_method: 'Card', payment_date: d(-9),
    agreed_total: 440, agreed_per_night: 130, agreed_nights: 3, agreed_nightly: 390, agreed_booking_fee: 50,
    agreed_txn_pct: 0, agreed_txn_fee: 0, agreed_on: d(-30), hold_status: 'none', notes: '',
  }, over);
  const BOOKINGS = [
    // leaving today, deposit held
    mkBooking(1, { name: 'Hannah Whitlock', phone: '07700 900110', check_in: d(-5), check_out: d(0), hold_status: 'charged', hold_amount: 75 }),
    // arriving today with money to collect, and a note that matters this morning
    mkBooking(2, { name: 'Marcus Ellery', phone: '07700 900342', check_in: d(0), check_out: d(4), payment: 'deposit', deposit_paid: 150, agreed_total: 440, notes: 'Late arrival — after 18:00. Travel cot requested.' }),
    // arriving tomorrow
    mkBooking(3, { name: 'Tom Fairhurst', phone: '07700 900653', check_in: d(1), check_out: d(3) }),
    // in residence
    mkBooking(4, { name: 'Priya Raman', phone: '07700 900527', check_in: d(-1), check_out: d(2) }),
    // far future — must NOT reach the snapshot
    mkBooking(5, { name: 'Zara Outofrange', check_in: d(20), check_out: d(23) }),
  ];
  await page.route(/\.php/, async (route) => {
    if (apiDead) return route.abort();
    const url = route.request().url();
    const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (route.request().method() === 'POST') {
      const b = JSON.parse(route.request().postData() || '{}');
      const f = url.split('/').pop().split('?')[0];
      if (f === 'auth.php' && b.action === 'admin_status') return json({ admin: true });
      if (f === 'content.php' && b.action === 'get_all') return json({ content: { 'ops-21a': 'Key safe 4021 — black box right of the porch\nStopcock — under the kitchen sink' } });
      if (f === 'content.php' && b.action === 'save') return json({ ok: true });
      return json({ ok: true, events: [], logs: {}, reviews: [], photos: [], returns: {}, threads: [] });
    }
    if (url.includes('admin-bootstrap.php')) return json({ ok: true, cron: null, feeds: [], payoutTrouble: null, rates: null, bookings: { bookings: BOOKINGS }, enquiries: { enquiries: [] }, blocks: { ok: true, blocks: [] } });
    if (url.includes('bookings.php')) return json({ bookings: BOOKINGS });
    if (url.includes('rates.php')) return json({ properties: [{ prop_key: '21a', name: '21A Westgate', slug: '21a', couple_rate: 130, extra_adult_rate: 0, child_rate: 0, booking_fee: 50, transaction_pct: 0, lastmin_pct: 0, lastmin_days: 0, max_adults: 2, max_children: 0, max_total: 2, sort_order: 1 }], seasons: {}, occupancy: {} });
    return json({ ok: true, bookings: [], enquiries: [], properties: [], seasons: {}, occupancy: {}, content: {}, blocks: [], ranges: [], payments: [], years: [], threads: [], reviews: [], photos: [] });
  });

  const settle = async (ms) => { await page.waitForTimeout(ms || 2800); };
  const snap = () => page.evaluate(() => JSON.parse(localStorage.getItem('chb-daysheet') || 'null'));

  // ── §1 a successful owner boot pre-warms the snapshot ─────────────────────
  console.log('§1 the snapshot is pre-warmed, deliberately');
  await page.goto(`${base}/index.html`, { waitUntil: 'domcontentloaded' });
  await settle();
  ok(await page.evaluate(() => localStorage.getItem('chb-was-admin')) === '1', 'a verified admin session stamps the boot hint');
  let s = await snap();
  ok(!!s && Array.isArray(s.rows), 'the day-sheet snapshot is written on a successful load');
  const names = (s && s.rows || []).map((r) => r.nm);
  ok(names.includes('Hannah Whitlock') && names.includes('Marcus Ellery') && names.includes('Tom Fairhurst') && names.includes('Priya Raman'),
    'it carries today\'s movements, tomorrow\'s arrival and the guest in residence');
  ok(!names.includes('Zara Outofrange'), 'and NOT a stay three weeks out — this is a day sheet, not a database');
  const marcus = (s.rows || []).find((r) => r.nm === 'Marcus Ellery') || {};
  ok(marcus.ph === '07700 900342' && marcus.due > 0, 'a row carries the phone number and the money still to collect');
  ok(await page.evaluate(() => !document.getElementById('offline-daysheet')), 'online, the sheet itself is nowhere in the DOM');

  // ── §2 the ops notes ride the snapshot, and a save refreshes it ───────────
  console.log('§2 the private cottage notes');
  await page.evaluate(() => openArea());
  await settle(1200);
  await page.evaluate(() => { chbSnapWrite(); });
  s = await snap();
  ok(!!(s && s.ops && /Key safe 4021/.test(s.ops['21a'] || '')), 'the ops- card is in the snapshot once Manage has loaded it');
  await page.evaluate(() => saveOpsNotes('21a', 'Key safe 9999 — moved to the gate\nStopcock — same place'));
  await settle(600);
  s = await snap();
  ok(/Key safe 9999/.test((s && s.ops && s.ops['21a']) || ''), 'saving the notes refreshes the snapshot in the same breath');

  // ── §3 an offline reload renders the day sheet, honestly marked ───────────
  console.log('§3 the offline boot');
  apiDead = true;
  await page.reload({ waitUntil: 'domcontentloaded' });
  await settle(3500);
  ok(await page.evaluate(() => document.body.classList.contains('offline-snap')), 'the offline-snap state is on');
  ok(await page.evaluate(() => !!document.getElementById('offline-daysheet')), 'the day sheet rendered from the snapshot');
  const sheet = await page.evaluate(() => (document.getElementById('offline-daysheet') || {}).textContent || '');
  ok(/No connection/.test(sheet) && /saved (this morning|today|yesterday) at /.test(sheet), 'the marker says what this is and when it was saved, in the day\'s terms');
  ok(/Marcus Ellery/.test(sheet) && /£340\.00 to collect/.test(sheet), 'the arriving guest and his balance are on it — the bookingDue figure, deposit folded in');
  ok(/Late arrival — after 18:00/.test(sheet), 'the note that matters this morning survived');
  ok(/Key safe 9999/.test(sheet.replace(/\s+/g, ' ')) || await page.evaluate(() => { const o = document.querySelector('#offline-daysheet .ods-ops'); return o ? /Key safe 9999/.test(o.textContent) : false; }), 'the cottage notes are readable on it');
  ok(await page.evaluate(() => { const a = document.querySelector('#offline-daysheet a[href^="tel:"]'); return !!a && /900342|900110|900527|900653/.test(a.getAttribute('href')); }), 'the phone numbers are tel: links — they need no data at all');
  ok(await page.evaluate(() => {
    const kids = Array.from(document.querySelectorAll('#view-backoffice > *'));
    return kids.filter((k) => k.id !== 'offline-daysheet').every((k) => getComputedStyle(k).display === 'none');
  }), 'the live workspace is hidden outright — no empty panels posing as facts');

  // ── §4 grouping is recomputed from the dates, never trusted from the write ─
  console.log('§4 a stale snapshot regroups honestly');
  await page.evaluate((yday) => {
    const s2 = JSON.parse(localStorage.getItem('chb-daysheet'));
    s2.day = yday; s2.at = Date.now() - 20 * 3600000; // written "yesterday"
    localStorage.setItem('chb-daysheet', JSON.stringify(s2));
    renderOfflineDaySheet();
  }, d(-1));
  const sheet2 = await page.evaluate(() => (document.getElementById('offline-daysheet') || {}).textContent || '');
  ok(/saved yesterday at /.test(sheet2), 'the marker now says yesterday');
  // Tom's arrival is d(1) — tomorrow by the CLOCK whichever day wrote the
  // snapshot, so he must still sit under Tomorrow, not have drifted a day.
  ok(await page.evaluate(() => {
    const el = document.getElementById('offline-daysheet');
    const html = el ? el.innerHTML : '';
    const tomIdx = html.indexOf('Tomorrow'); const tf = html.indexOf('Tom Fairhurst');
    return tomIdx !== -1 && tf > tomIdx;
  }), 'groups come from each row\'s own dates against TODAY');

  // ── §5 Try again is honest both ways ──────────────────────────────────────
  console.log('§5 the retry');
  await page.evaluate(() => odsRetry());
  await settle(1500);
  ok(await page.evaluate(() => !!document.getElementById('offline-daysheet')), 'a still-dead link keeps the sheet up');
  // The sheet re-rendering is initBackOffice self-healing — what the stillDead
  // branch OWNS is the message: a dead retry must never toast "Back on".
  // (Break-tested: removing the branch left the sheet check green and this red.)
  ok(await page.evaluate(() => {
    const t = document.getElementById('app-toasts');
    const txt = t ? t.textContent : '';
    return /Still no connection/.test(txt) && !/Back on/.test(txt);
  }), 'and the toast says so — never a false "Back on"');
  apiDead = false;
  await page.evaluate(() => odsRetry());
  await settle(2500);
  ok(await page.evaluate(() => !document.getElementById('offline-daysheet') && !document.body.classList.contains('offline-snap')), 'a live link replaces it with the real Today');

  // ── §6 a signed-out device keeps nothing ──────────────────────────────────
  console.log('§6 hygiene');
  await page.evaluate(() => forceAdminLogout());
  ok(await page.evaluate(() => localStorage.getItem('chb-was-admin') === null && localStorage.getItem('chb-daysheet') === null),
    'logout removes the boot hint AND the snapshot — guest names and key-safe codes do not outlive the session');
  apiDead = true;
  await page.reload({ waitUntil: 'domcontentloaded' });
  await settle(3000);
  ok(await page.evaluate(() => !document.getElementById('offline-daysheet') && !document.body.classList.contains('owner-mode')),
    'an offline reload on a signed-out device lands on the public site, not the owner\'s day');

  console.log(fails ? `\n${fails} CHECK(S) FAILED ❌` : '\nOFFLINE SUITE PASSED ✅');
  await done(fails);
})();
