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
    // checked OUT with the deposit still held — §9's Tier-C control
    // (returnDeposit only renders once the guest has actually left)
    mkBooking(6, { name: 'Faye Left', phone: '07700 900888', check_in: d(-4), check_out: d(-1), hold_status: 'charged', hold_amount: 60 }),
  ];
  const posts = [];
  const d0 = d(0); // today, for the coast stubs below
  let verHits = 0;   // version.php probe counter (§11)
  let bootHits = 0;  // admin-bootstrap.php counter (§22 — one recovery, one load)
  let addDead = false; // §12: abort ONLY the booking-add post — the ambiguous save
  let refuseEnq = false; // §14: the server ANSWERS an enquiry replay with a refusal
  let apiHang = false;   // §18: poor signal — every request held, none failing
  await page.route(/\.php/, async (route) => {
    const url = route.request().url();
    if (url.includes('version.php')) verHits++;
    if (url.includes('admin-bootstrap.php')) bootHits++;
    // apiHang = POOR SIGNAL: nothing fails, everything HANGS. Requests are held
    // until the flag drops, then answered normally — so releasing it makes the
    // ORIGINAL slow requests land late, which is exactly the case §18's
    // sheet-then-swap arc exists to prove.
    while (apiHang) await new Promise((r) => setTimeout(r, 200));
    const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (route.request().method() === 'POST') {
      const b = JSON.parse(route.request().postData() || '{}');
      const f = url.split('/').pop().split('?')[0];
      b.__f = f;
      posts.push(b);
      // apiDead = the request LANDS but the reply dies — record, then abort.
      // That is the ambiguous-timeout shape the op ledger exists for.
      if (apiDead) return route.abort();
      if (addDead && f === 'bookings.php' && b.action === 'add') return route.abort();
      if (f === 'bookings.php' && b.action === 'add') return json({ ok: true, id: 990 });
      if (refuseEnq && f === 'enquiries.php' && b.action === 'submit')
        return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'Those dates clash — Bob Carter has them' }) });
      if (f === 'auth.php' && b.action === 'admin_status') return json({ admin: true });
      if (f === 'content.php' && b.action === 'get_all') return json({ content: { 'ops-21a': 'Key safe 4021 — black box right of the porch\nStopcock — under the kitchen sink' } });
      if (f === 'content.php' && b.action === 'save') return json({ ok: true });
      return json({ ok: true, events: [], logs: {}, reviews: [], photos: [], returns: {}, threads: [] });
    }
    if (apiDead) return route.abort();
    if (url.includes('admin-bootstrap.php')) return json({ ok: true, cron: null, feeds: [], payoutTrouble: null, rates: null, bookings: { bookings: BOOKINGS }, enquiries: { enquiries: [] }, blocks: { ok: true, blocks: [
      // an OTA stay in the day window — §23: it must PAINT (timeline, groups)
      // and never COUNT (ops line, duties, money). On its OWN cottage: every
      // 21a block overlapping a local booking is correctly suppressed as a
      // platform mirror (suppressBlocksUnderLocalBookings), and 21a's local
      // stays blanket today–tomorrow — the first fixture sat there and §23a
      // silently tested a row the app had rightly dropped.
      { id: 900, prop_key: 'jollyboat', source: 'airbnb', check_in: d(0), check_out: d(2) },
    ] } });
    if (url.includes('bookings.php')) return json({ bookings: BOOKINGS });
    if (url.includes('tides.php')) return json({ ok: true, extremes: [
      { type: 'High', time: d0 + 'T06:41:00' }, { type: 'Low', time: d0 + 'T12:55:00' }, { type: 'High', time: d0 + 'T19:08:00' },
    ] });
    if (url.includes('weather.php')) return json({ ok: true, days: [{ date: d0, summary: 'Sunny intervals', tmax: 18, gust: 12 }] });
    if (url.includes('rates.php')) return json({ properties: [{ prop_key: '21a', name: '21A Westgate', slug: '21a', couple_rate: 130, extra_adult_rate: 0, child_rate: 0, booking_fee: 50, transaction_pct: 0, lastmin_pct: 0, lastmin_days: 0, max_adults: 2, max_children: 0, max_total: 2, sort_order: 1 }], seasons: {}, occupancy: {} });
    return json({ ok: true, bookings: [], enquiries: [], properties: [], seasons: {}, occupancy: {}, content: {}, blocks: [], ranges: [], payments: [], years: [], threads: [], reviews: [], photos: [] });
  });

  const settle = async (ms) => { await page.waitForTimeout(ms || 2800); };
  // the store is ENCRYPTED at rest — read through the decrypted mirror
  const snap = () => page.evaluate(() => chbSnapRead(true));

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
  ok(/Offline/.test(sheet) && /saved (this morning|today|yesterday) at /.test(sheet), 'the marker says what this is and when it was saved, in the day\'s terms');
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
    const s2 = chbSnapRead(true);
    s2.day = yday; s2.at = Date.now() - 20 * 3600000; // written "yesterday"
    __chbSnapCache = s2;
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

  // ── §7 THE WRITE HALF: captures on the day sheet, queue-on-failure, and the
  //     op id that makes the retry safe. navigator.onLine is TRUE throughout —
  //     the routes abort instead, which is precisely the connection the old
  //     `onLine === false` gate could never see (the write was thrown away).
  console.log('§7 the day-sheet captures, offline');
  apiDead = false;
  await page.reload({ waitUntil: 'domcontentloaded' });
  await settle();                       // sign in fresh, snapshot rebuilt
  apiDead = true;
  await page.reload({ waitUntil: 'domcontentloaded' });
  await settle(3500);
  ok(await page.evaluate(() => !!document.getElementById('offline-daysheet')), 'the day sheet is up again');
  const gdSet = (id, v) => page.evaluate(([i2, v2]) => { const el = document.getElementById('gdf-' + i2); if (el) { el.value = v2; el.dispatchEvent(new Event('input')); } }, [id, v]);

  // (a) record Marcus's payment. He is part-paid — £150 of £440 — and the box
  // is an ABSOLUTE "received so far" that set_payment writes over deposit_paid.
  // THE DEFAULT MUST BE WHAT HE HAS ALREADY PAID, exactly as the online
  // recorder prefills it: it used to be prefilled with the rental TOTAL, so on
  // the no-signal morning this capture exists for, one tap on "Record it"
  // recorded £440 and marked him paid in full — money he never handed over.
  const preOps = posts.length;
  await page.locator('#offline-daysheet button', { hasText: 'Record a payment' }).first().click();
  await page.waitForTimeout(400);
  ok(await page.evaluate(() => (document.getElementById('gdf-amount') || {}).value === '150.00'),
    'the amount box opens on what he has ALREADY paid (£150.00), never the £440 total');
  await page.locator('#glass-dialog-ok').click();
  await page.waitForTimeout(1200);
  const payTry = posts.filter((p2) => p2.__f === 'bookings.php' && p2.action === 'set_payment');
  ok(payTry.length === 1, 'the tap TRIED — the request landed even though the reply died');
  ok(!!payTry[0].op_id && /^op-/.test(payTry[0].op_id), 'and it carried an op id from birth');
  ok(payTry[0].payment === 'deposit' && payTry[0].payment_method === 'Cash',
    'accepting the default records him STILL PART-PAID (deposit, cash) — it cannot settle a stay by itself');
  ok(Math.abs(parseFloat(payTry[0].deposit) - 150) < 0.005,
    'and the figure sent is the £150 already received, not the £440 total');
  ok(await page.evaluate(() => (document.getElementById('offline-daysheet') || {}).textContent.includes('Recorded · waiting to sync')), 'the row says recorded-not-synced, honestly');

  // (b) decide Hannah's deposit — saved on the phone, NOT queued for auto-replay
  await page.locator('#offline-daysheet button', { hasText: 'Decide the deposit' }).click();
  await page.waitForTimeout(400);
  await gdSet('note', 'All fine — checked the lot');
  await page.locator('#glass-dialog-ok').click();
  await page.waitForTimeout(600);
  ok(await page.evaluate(() => odsDepDecisions().length === 1), 'the decision is saved on the phone');
  ok(posts.filter((p2) => p2.action === 'return_deposit' || p2.action === 'keep_deposit').length === 0, 'and NO money op was sent — a deferred decision, never a deferred authority');

  // (c) the phone enquiry
  await page.locator('#offline-daysheet button', { hasText: 'Save an enquiry' }).click();
  await page.waitForTimeout(400);
  await gdSet('name', 'Elaine Barrowcliffe');
  await gdSet('phone', '07700 900233');
  await gdSet('ci', d(60));
  await gdSet('co', d(63));
  await page.locator('#glass-dialog-ok').click();
  await page.waitForTimeout(1200);
  const enqTry = posts.filter((p2) => p2.__f === 'enquiries.php' && p2.action === 'submit');
  ok(enqTry.length === 1 && enqTry[0].name === 'Elaine Barrowcliffe' && !!enqTry[0].op_id, 'the enquiry tried too, op id aboard');

  // ── §8 reconnect: the replay carries the SAME ids, and money asks first ──
  console.log('§8 the replay');
  apiDead = false;
  await page.evaluate(() => oqFlush());
  await page.waitForTimeout(2500);
  const payAll = posts.filter((p2) => p2.__f === 'bookings.php' && p2.action === 'set_payment');
  ok(payAll.length === 2 && payAll[0].op_id === payAll[1].op_id, 'EXACTLY-ONCE CONTRACT: the replayed payment carries the SAME op id as the lost attempt');
  const enqAll = posts.filter((p2) => p2.__f === 'enquiries.php' && p2.action === 'submit');
  ok(enqAll.length === 2 && enqAll[0].op_id === enqAll[1].op_id, '…and so does the enquiry');
  // the deposit decision surfaces as a CONFIRM on the next Today load
  await page.evaluate(() => initBackOffice());
  await page.waitForTimeout(1500);
  ok(await page.evaluate(() => {
    const m = document.getElementById('glass-dialog-msg');
    return !!m && /Return £75\.00 to Hannah/.test(m.textContent || '') && /All fine — checked the lot/.test(m.textContent || '');
  }), 'reconnecting asks about the deposit, quoting the decision made at the cottage');
  await page.locator('#glass-dialog-ok').click();
  await page.waitForTimeout(1000);
  ok(posts.filter((p2) => p2.action === 'return_deposit').length === 1, 'the refund op exists only after the OK');
  ok(await page.evaluate(() => odsDepDecisions().length === 0), 'and the decision is cleared once executed');

  // ── §9 LIVE TRANSITIONS — the verdict moves BOTH ways with no reload.
  //     navigator.onLine is true throughout (routes abort, the interface is up),
  //     so every state change here is EVIDENCE-driven: a transport failure flips
  //     off, the 15s probe flips back. The window marker proves no reload.
  console.log('§9 live transitions, no reloads');
  await page.evaluate(() => { window.__noReloadMarker = 42; });

  // (a) open the hub while the link is still good (the hub refuses to navigate
  //     on a dead fetch — the poor-signal rule — so the drop comes after).
  //     Hannah's hub: a charged deposit on a stay ending today, so it carries
  //     returnDeposit — Tier-C, money leaving. (Marcus's payask offers
  //     recordPayment, the SAFE capture, which is deliberately NOT in the deny
  //     list — the first draft of this gate targeted his hub and proved that
  //     distinction by accident.)
  await page.evaluate(() => openBookingHub('b6'));
  await page.waitForTimeout(1200);

  // …then a mid-session drop is noticed at the FIRST failed request
  apiDead = true;
  await page.evaluate(() => apiPost('bookings.php', { action: 'history', id: 2 }).catch(() => {}));
  await page.waitForTimeout(400);
  ok(await page.evaluate(() => document.body.classList.contains('net-off') && document.body.classList.contains('is-offline')),
    'one failed request flips the whole dashboard to offline — no reload, no flag-watching');

  // (b) Tier-C refuses up front, with the reason, and no request leaves
  const preC = posts.filter((p2) => p2.action === 'return_deposit').length;
  ok(await page.locator('[data-act="returnDeposit"]').count() >= 1, 'the hub renders its deposit controls from the stores loaded while online');
  ok(await page.locator('[data-act="returnDeposit"]').first().evaluate((el2) => getComputedStyle(el2).opacity === '0.55'),
    'the control is visibly dimmed BEFORE the tap (the generated net-off rule)');
  // The first run of this gate caught a DOUBLE ASK: chbNetUp's recovery and
  // §8's explicit initBackOffice both swept the decisions concurrently, and a
  // second "Return £75.00 to Hannah?" was sitting here intercepting the click.
  ok(await page.evaluate(() => { const g = document.getElementById('glass-dialog'); return !(g && g.classList.contains('open')); }),
    'no second ask about money that was already confirmed (the sweep is re-entrant-safe)');
  // The VISIBLE copy: at this 390px viewport the next-action card's own button
  // yields to the sticky bar (the iOS restyle's one-tap-offered-once rule), so
  // a bare .first() lands on the hidden card button and can never be clicked.
  await page.locator('[data-act="returnDeposit"]:visible').first().click();
  await page.waitForTimeout(500);
  ok(posts.filter((p2) => p2.action === 'return_deposit').length === preC,
    'tapping it sends NOTHING — money leaving is never queued and hoped for');
  ok(await page.evaluate(() => /Needs signal/.test((document.getElementById('app-toasts') || {}).textContent || '')),
    'and the refusal says why, immediately');
  ok(await page.evaluate(() => {
    const els = document.querySelectorAll('style');
    for (const st of els) { if (/net-off/.test(st.textContent) && /requestPayment/.test(st.textContent) && /approveEnquiry/.test(st.textContent)) return true; }
    return false;
  }), 'the dim rule is GENERATED from the same list the guard reads — one definition');

  // (c) recovery is automatic: the probe notices within its 15s interval.
  // SAMPLED BY STATE, not by a single read at a fixed instant: the "Back
  // online." toast auto-dismisses, so where inside the probe's 15s window the
  // recovery lands decides whether a one-shot read at 16.5s still sees it —
  // measured as a CI-load flake (green locally, red on the runner). The poll
  // catches the toast whenever it appears and still fails if it never does.
  apiDead = false;
  let backOn = false, saidBack = false;
  for (let i = 0; i < 36 && !(backOn && saidBack); i++) {
    await page.waitForTimeout(500);
    if (!backOn) backOn = await page.evaluate(() => !document.body.classList.contains('net-off') && !document.body.classList.contains('is-offline'));
    if (!saidBack) saidBack = await page.evaluate(() => /Back online/.test((document.getElementById('app-toasts') || {}).textContent || ''));
  }
  ok(backOn, 'the probe brings the dashboard back by itself — nothing was tapped');
  ok(saidBack, 'and the transition is SAID, never silent');
  ok(await page.evaluate(() => window.__noReloadMarker === 42), 'no reload happened at any point (the marker survived)');

  // (d) the cold-boot day sheet also exits by itself when signal returns
  apiDead = true;
  await page.reload({ waitUntil: 'domcontentloaded' });
  await settle(3500);
  ok(await page.evaluate(() => !!document.getElementById('offline-daysheet')), '(fixture) offline boot lands on the day sheet');
  await page.evaluate(() => { window.__noReloadMarker = 43; });
  apiDead = false;
  await page.waitForTimeout(17000);
  ok(await page.evaluate(() => !document.getElementById('offline-daysheet') && !document.body.classList.contains('offline-snap')),
    'the day sheet swaps itself for the live Today when the probe succeeds');
  ok(await page.evaluate(() => window.__noReloadMarker === 43), '…again with no reload');

  // ── §10 THE EXPENSE CAPTURE — "paid the cleaner £60 cash" at the door.
  //     The server half has been ledger-safe since the queue shipped; this
  //     gates the affordance AND the exactly-once contract end to end.
  console.log('§10 the expense capture');
  apiDead = true;
  await page.reload({ waitUntil: 'domcontentloaded' });
  await settle(3500);
  ok(await page.evaluate(() => !!document.getElementById('offline-daysheet')), 'the day sheet is up for the capture');
  await page.locator('#offline-daysheet button', { hasText: 'Record an expense' }).click();
  await page.waitForTimeout(400);
  await gdSet('amount', '60');
  await gdSet('desc', 'Cleaner — changeover');
  await page.locator('#glass-dialog-ok').click();
  await page.waitForTimeout(1200);
  const expTry = posts.filter((p2) => p2.__f === 'expenses.php' && p2.action === 'add');
  ok(expTry.length === 1 && expTry[0].amount === 60 && expTry[0].description === 'Cleaner — changeover',
    'the expense TRIED with the figures as typed');
  ok(!!expTry[0].op_id && /^op-/.test(expTry[0].op_id), 'and it carried an op id from birth');
  ok(await page.evaluate(() => /Saved on this phone/.test((document.getElementById('app-toasts') || {}).textContent || '')),
    'the toast says saved-not-synced, honestly');

  // ── §11 A RESUMED APP PROBES NOW — iOS has no Background Sync, so replay
  //     hangs on the page waking; pageshow/focus must not wait out the 15s
  //     interval. The interval timer is STOPPED first, so any probe seen here
  //     can only be the resume listener's — deterministic, not a race.
  console.log('§11 the resume probe');
  ok(await page.evaluate(() => document.body.classList.contains('net-off')), '(fixture) the dashboard is offline');
  await page.evaluate(() => chbNetProbeStop());
  let verBase = verHits;
  await page.evaluate(() => window.dispatchEvent(new Event('pageshow')));
  await page.waitForTimeout(600);
  ok(verHits > verBase, 'pageshow probes immediately — no 15-second wait');
  await page.evaluate(() => chbNetProbeStop());
  verBase = verHits;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.waitForTimeout(600);
  ok(verHits > verBase, 'a bare window refocus probes too (iPad split view)');
  // …and a LIVE probe through the resume path recovers everything at once:
  // the day sheet is up, so the recovery is "noticed" and swaps it for Today.
  apiDead = false;
  await page.evaluate(() => window.dispatchEvent(new Event('pageshow')));
  await page.waitForTimeout(3000);
  ok(await page.evaluate(() => !document.body.classList.contains('net-off') && !document.getElementById('offline-daysheet')),
    'a live resume brings the whole dashboard back — sheet gone, verdict on');
  // NB the wire may show MORE than two sends — §11's own pageshow dispatch ran
  // a flush while the API was still dead, which is a legitimate retry (recorded,
  // aborted, kept). The exactly-once contract is not "two posts": it is ONE id
  // across every attempt (the ledger collapses them) and the queue draining the
  // moment a server ANSWERS.
  const expAll = posts.filter((p2) => p2.__f === 'expenses.php' && p2.action === 'add');
  ok(expAll.length >= 2 && expAll.every((p2) => p2.op_id === expAll[0].op_id),
    'EXACTLY-ONCE CONTRACT: every retry of the queued expense carries the SAME op id');
  ok(await page.evaluate(async () => (await oqAll()).length === 0),
    'and the queue drained once a reply was answered — nothing left to double-send');

  // ── §12 THE ONLINE WRITE PATHS CARRY THE LEDGER ID — the ambiguous timeout
  //     exists on good WiFi too. chbOpFor is deterministic over the payload:
  //     a hand retry of the same form reuses the id (dedupes at the ledger),
  //     an edited field mints a fresh one (an edited save must never be
  //     answered from the stored response of the save it replaces), and a
  //     CONFIRMED success bumps the sequence so re-stating an earlier value
  //     is a new write, not a replay.
  console.log('§12 the online write paths carry the ledger id');
  await page.waitForTimeout(1500); // let the recovery's loadData settle
  await page.evaluate(([ci, co]) => {
    const sel = document.getElementById('modal-property');
    sel.innerHTML = '<option value="21a">21A</option>';
    sel.value = '21a';
    document.getElementById('modal-mode').value = 'add';
    document.getElementById('modal-record-id').value = '';
    document.getElementById('modal-name').value = 'Opid Test';
    document.getElementById('modal-email').value = '';
    document.getElementById('modal-checkin').value = ci;
    document.getElementById('modal-checkout').value = co;
    document.getElementById('modal-payment').value = 'unpaid';
  }, [d(40), d(43)]);
  addDead = true;
  await page.evaluate(() => saveModal().catch(() => {}));
  await page.waitForTimeout(800);
  let adds = posts.filter((p2) => p2.__f === 'bookings.php' && p2.action === 'add');
  ok(adds.length === 1 && /^op-/.test(adds[0].op_id || ''), 'the booking add carries a ledger id');
  await page.evaluate(() => saveModal().catch(() => {}));
  await page.waitForTimeout(800);
  adds = posts.filter((p2) => p2.__f === 'bookings.php' && p2.action === 'add');
  ok(adds.length === 2 && adds[0].op_id === adds[1].op_id,
    'a HAND RETRY of the same form reuses the id — the ambiguous timeout dedupes instead of double-adding');
  await page.evaluate(() => { document.getElementById('modal-name').value = 'Opid Test Edited'; });
  await page.evaluate(() => saveModal().catch(() => {}));
  await page.waitForTimeout(800);
  adds = posts.filter((p2) => p2.__f === 'bookings.php' && p2.action === 'add');
  ok(adds.length === 3 && adds[2].op_id !== adds[1].op_id,
    'an EDITED field mints a fresh id — never answered from the save it replaces');
  addDead = false;
  await page.evaluate(() => saveModal().catch(() => {}));
  await page.waitForTimeout(1500);
  adds = posts.filter((p2) => p2.__f === 'bookings.php' && p2.action === 'add');
  ok(adds.length === 4 && adds[3].op_id === adds[2].op_id, 'the successful retry still wore the retried id');
  await page.evaluate(() => saveModal().catch(() => {}));
  await page.waitForTimeout(1500);
  adds = posts.filter((p2) => p2.__f === 'bookings.php' && p2.action === 'add');
  ok(adds.length === 5 && adds[4].op_id !== adds[3].op_id,
    'after a CONFIRMED success the sequence bumps — the same values again is a new write, not a replay');
  // recordPayment — the money recorder stamps the id too
  const preSp = posts.filter((p2) => p2.action === 'set_payment').length;
  await page.evaluate(() => { recordPayment('b2'); });
  await page.waitForTimeout(500);
  await gdSet('amount', '440');
  await page.locator('#glass-dialog-ok').click();
  await page.waitForTimeout(1200);
  const sp = posts.filter((p2) => p2.action === 'set_payment');
  ok(sp.length === preSp + 1 && /^op-/.test(sp[sp.length - 1].op_id || ''),
    'recordPayment stamps the ledger id on set_payment');
  // dismiss the offer-updated-confirmation ask it raises on success
  await page.evaluate(() => { const c = document.getElementById('glass-dialog-cancel'); if (c) c.click(); });

  // ── §13 PHOTO EVIDENCE ON THE DEPOSIT DECISION — taken in the cottage, at
  //     the moment of deciding, with no signal; shown back WITH the reconnect
  //     confirm; uploaded only with the confirmed money op.
  console.log('§13 the deposit photo');
  // a real (1×1) JPEG, so createImageBitmap and the server's magic-byte check
  // both see the genuine article
  const JPG = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AVN//2Q==', 'base64');
  apiDead = false;
  await page.reload({ waitUntil: 'domcontentloaded' });
  await settle();                       // fresh snapshot (Hannah's deposit is back in the fixture)
  apiDead = true;
  await page.reload({ waitUntil: 'domcontentloaded' });
  await settle(3500);
  await page.locator('#offline-daysheet button', { hasText: 'Decide the deposit' }).click();
  await page.waitForTimeout(400);
  await page.evaluate(() => { const el = document.getElementById('gdf-choice'); el.value = 'keep'; el.dispatchEvent(new Event('input')); });
  await gdSet('note', 'Burn on the kitchen worktop');
  await page.locator('#gdf-photo').setInputFiles({ name: 'evidence.jpg', mimeType: 'image/jpeg', buffer: JPG });
  await page.locator('#glass-dialog-ok').click();
  await page.waitForTimeout(900);
  const dec = await page.evaluate(() => odsDepDecisions());
  ok(dec.length === 1 && dec[0].choice === 'keep' && /^data:image\/jpeg/.test(dec[0].photo || ''),
    'the decision saved WITH the photo, re-encoded as a JPEG data URI');
  // reconnect → the confirm shows the photo beside the question it answers
  apiDead = false;
  await page.evaluate(() => initBackOffice());
  await page.waitForTimeout(1800);
  ok(await page.evaluate(() => {
    const m = document.getElementById('glass-dialog-msg');
    const im = document.getElementById('glass-dialog-img');
    return !!m && /Keep £75\.00 from Hannah/.test(m.textContent || '')
      && !!im && im.style.display !== 'none' && /^data:image\/jpeg/.test(im.src || '');
  }), 'the reconnect confirm shows the photo WITH the question it exists to answer');
  await page.locator('#glass-dialog-ok').click();
  await page.waitForTimeout(900);
  const kept = posts.filter((p2) => p2.action === 'keep_deposit');
  ok(kept.length === 1 && /^data:image\/jpeg;base64,/.test(kept[0].photo_data || ''),
    'the confirmed keep carries the photo to the server — evidence rides the money op');
  ok(await page.evaluate(() => odsDepDecisions().length === 0),
    'and the decision (photo included) clears once executed');
  // THE SHARED NODE MUST NOT LEAK — the okLabel rule, for pictures
  await page.evaluate(() => { glassConfirm('A plain question with no photo?'); });
  await page.waitForTimeout(300);
  ok(await page.evaluate(() => {
    const im = document.getElementById('glass-dialog-img');
    return !im || im.style.display === 'none';
  }), 'a plain confirm after it shows NO photo — the shared node is cleared each open');
  await page.evaluate(() => glassDialogResolve(false));

  // ── §14 A REFUSED REPLAY BECOMES A DUTY — the flush's toast covers the owner
  //     who is looking; the record covers the one who is not. It persists on
  //     Needs-you until READ and dismissed, with the server's own sentence.
  console.log('§14 refused replays become duties');
  apiDead = true;
  await page.evaluate(([ci, co]) => queueOrPost('enquiries.php', { action: 'submit', prop_key: '21a', name: 'Refused Test', check_in: ci, check_out: co, adults: 2, children: 0, message: 'x' }, 'Enquiry — Refused Test'), [d(70), d(73)]);
  await page.waitForTimeout(600);
  ok(await page.evaluate(async () => (await oqAll()).length >= 1), '(fixture) a write is queued while the link is dead');
  apiDead = false;
  refuseEnq = true;
  await page.evaluate(() => oqFlush());
  await page.waitForTimeout(1200);
  ok(await page.evaluate(async () => (await oqAll()).length === 0), 'the server ANSWERED (a refusal), so the queue consumed the item');
  const ref = await page.evaluate(async () => await oqRefusedAll());
  ok(ref.length === 1 && /Refused Test/.test(ref[0].label) && /Bob Carter/.test(ref[0].reason),
    'the refusal is RECORDED with the label and the server\'s own sentence');
  await page.evaluate(() => oqRefusedLoad().then(() => renderNeedsYou()));
  await page.waitForTimeout(500);
  const nyTxt = await page.evaluate(() => (document.getElementById('needs-you-list') || {}).textContent || '');
  ok(/A change saved offline was refused — Enquiry — Refused Test/.test(nyTxt) && /did NOT apply/.test(nyTxt),
    'it surfaces as a Needs-you duty saying the change did NOT apply');
  await page.locator('#needs-you-list .ny-row', { hasText: 'Refused Test' }).click();
  await page.waitForTimeout(400);
  ok(await page.evaluate(() => {
    const m = document.getElementById('glass-dialog-msg');
    const t = document.getElementById('glass-dialog-title');
    return !!m && /Bob Carter/.test(m.textContent || '') && !!t && /didn’t save/.test(t.textContent || '');
  }), 'opening it shows the full refusal before anything can be dismissed');
  await page.locator('#glass-dialog-ok').click();
  await page.waitForTimeout(600);
  ok(await page.evaluate(async () => (await oqRefusedAll()).length === 0), 'Dismiss clears the record');
  ok(await page.evaluate(() => !/Refused Test/.test((document.getElementById('needs-you-list') || {}).textContent || '')),
    'and the duty leaves the strip');
  refuseEnq = false;
  // The SW half runs with the app CLOSED — out of this harness's reach (the SW
  // is stubbed), so its wiring is a source assertion: the refusal is recorded
  // BEFORE the item is deleted, on any non-auth error response.
  {
    const sw = require('fs').readFileSync(require('path').join(__dirname, 'sw.js'), 'utf8');
    const flushBody = sw.slice(sw.indexOf('async function swFlushQueue'), sw.indexOf('self.addEventListener(\'sync\''));
    const iRef = flushBody.indexOf('swRefusedAdd');
    const iDel = flushBody.indexOf('swQueueDelete(db, it.id)');
    ok(iRef !== -1 && iDel !== -1 && iRef < iDel && /!r\.ok/.test(flushBody),
      'the SW replayer records a refusal (before consuming the item) on any non-auth error');
  }

  // ── §15 ENCRYPTED AT REST — the day sheet and the deposit decisions hold
  //     guest names, phone numbers and key-safe codes; localStorage now shows
  //     only ciphertext (enc1: envelope, AES-GCM under a non-extractable
  //     IndexedDB key). A value that will not decrypt is ABSENT, never garbage;
  //     legacy plaintext is adopted so an upgrade loses nothing.
  console.log('§15 encrypted at rest');
  await page.evaluate(() => initBackOffice());
  await page.waitForTimeout(2500);
  const rawSnap = await page.evaluate(() => localStorage.getItem('chb-daysheet') || '');
  ok(/^enc1:/.test(rawSnap), 'the day sheet is CIPHERTEXT on disk (enc1: envelope)');
  ok(!/Hannah|Marcus|Key safe/.test(rawSnap), 'no guest name or key-safe code is readable in the stored value');
  apiDead = true;
  await page.reload({ waitUntil: 'domcontentloaded' });
  await settle(3500);
  const encSheet = await page.evaluate(() => (document.getElementById('offline-daysheet') || {}).textContent || '');
  ok(/Marcus Ellery/.test(encSheet), 'the offline boot DECRYPTS and renders the same sheet — the round trip is real');
  // legacy plaintext (a phone that saved before this shipped) is ADOPTED
  await page.evaluate((today) => {
    localStorage.setItem('chb-daysheet', JSON.stringify({ at: Date.now(), day: today, rows: [
      { pk: '21a', cot: '21A Westgate', dbId: 7, nm: 'Plain Legacy', ph: '', ci: today, co: today.slice(0, 8) + String(Number(today.slice(8)) + 2).padStart(2, '0'), cit: '', cot_t: '', party: '2 adults', due: 0, dep: 0, rtot: 0, rpaid: 0, dmg: 0, holdNone: true, notes: '' },
    ], ops: {}, cots: {} }));
    __chbSnapCache = undefined; __chbSecLoadP = null; // a fresh boot's state
    return chbSecLoad().then(() => renderOfflineDaySheet());
  }, d(0));
  await page.waitForTimeout(600);
  ok(await page.evaluate(() => /Plain Legacy/.test((document.getElementById('offline-daysheet') || {}).textContent || '')),
    'a pre-encryption PLAINTEXT snapshot still renders — the upgrade loses nothing');
  // and a value that will NOT decrypt reads as absent, never as garbage
  ok(await page.evaluate(async () => {
    localStorage.setItem('chb-daysheet', 'enc1:AAAA:BBBB');
    __chbSnapCache = undefined; __chbSecLoadP = null;
    await chbSecLoad();
    return chbSnapRead(true) === null && localStorage.getItem('chb-daysheet') === null;
  }), 'an undecryptable value is treated as ABSENT and removed');

  // ── §16 THE COAST ON THE SHEET — tides and weather ride the snapshot, and
  //     the TIDE is gated on the day it was fetched for: yesterday's snapshot
  //     rendering this morning must not state yesterday's high water as
  //     today's (the weather payload is dated per day, so it survives).
  console.log('§16 the coast on the sheet');
  apiDead = false;
  await page.reload({ waitUntil: 'domcontentloaded' });
  await settle(3000);
  const s16 = await snap();
  ok(!!(s16 && s16.coast && s16.coast.day === d(0) && s16.coast.tide), 'the coast joins the snapshot after a successful load, stamped with its day');
  apiDead = true;
  await page.reload({ waitUntil: 'domcontentloaded' });
  await settle(3500);
  const coastSheet = await page.evaluate(() => (document.getElementById('offline-daysheet') || {}).textContent || '');
  ok(/High water 06:41 and 19:08/.test(coastSheet) && /low 12:55/.test(coastSheet),
    'the sheet states the day\'s tides with no data at all');
  ok(/Sunny intervals · 18°C/.test(coastSheet), '…and the day\'s weather');
  await page.evaluate((yday) => {
    const s2 = chbSnapRead(true);
    s2.coast.day = yday; // fetched YESTERDAY
    __chbSnapCache = s2;
    renderOfflineDaySheet();
  }, d(-1));
  const staleSheet = await page.evaluate(() => (document.getElementById('offline-daysheet') || {}).textContent || '');
  ok(!/High water/.test(staleSheet), 'a tide fetched for YESTERDAY is not stated as today\'s');
  ok(/Sunny intervals/.test(staleSheet), '…while the dated weather entry rightly survives the roll-over');
  apiDead = false;
  // hygiene, crypto half: the KEY record goes with the ciphertext it guarded
  await page.evaluate(() => forceAdminLogout());
  await page.waitForTimeout(600);
  ok(await page.evaluate(async () => {
    const db = await oqDB();
    return new Promise((res) => {
      try {
        const tx = db.transaction('keys', 'readonly');
        const rq = tx.objectStore('keys').get('sec');
        rq.onsuccess = () => res(!rq.result);
        rq.onerror = () => res(false);
      } catch (e) { res(false); }
    });
  }), 'logout deletes the at-rest key — a fresh sign-in mints a fresh one');

  // ── §17 THE ASSISTANT ANSWERS OFFLINE — from the day sheet. On an offline
  //     BOOT the stores are empty, so the store-backed families would report a
  //     business with no bookings (the poor-signal lie, in the assistant); the
  //     snapshot tier answers arrivals/departures/money/names instead, each
  //     attributed to the saved sheet — and the SERVER tiers are refused up
  //     front rather than spending timeouts per keystroke.
  console.log('§17 the assistant answers offline');
  apiDead = false;
  await page.reload({ waitUntil: 'domcontentloaded' });
  await settle();                       // fresh sign-in + snapshot
  apiDead = true;
  await page.reload({ waitUntil: 'domcontentloaded' });
  await settle(3500);
  ok(await page.evaluate(() => !!document.getElementById('offline-daysheet') && document.body.classList.contains('net-off')),
    '(fixture) offline boot, day sheet up, verdict off');
  const askOff = async (q) => {
    await page.evaluate((q2) => {
      openCmdK();
      const el = document.getElementById('cmdk-input');
      if (el) el.value = q2;
      cmdkSearchCore(q2, false);
    }, q);
    await page.waitForTimeout(600);
    return page.evaluate(() => (__cmdkResults || []).map((r) => (r.label || '') + ' ¦ ' + (r.sub || '')).join('\n'));
  };
  const arr = await askOff('who arrives today');
  ok(/Marcus arrives today\./.test(arr), 'arrivals are answered by NAME from the saved sheet');
  ok(/From the saved day sheet/.test(arr), '…and the answer says where it came from');
  const owed = await askOff('who owes me money');
  ok(/£340\.00 to collect — Marcus £340\.00\./.test(owed), 'the money question answers with the sheet\'s own figures');
  const nm = await askOff('hannah');
  ok(/Hannah Whitlock — 21A Westgate/.test(nm) && /07700 900110/.test(nm),
    'a name lookup returns the phone number and the stay — with no data at all');
  // the server tiers are refused up front, not timed out
  const preSearch = posts.filter((p2) => p2.__f === 'search.php').length;
  await page.evaluate(() => cmdkDeepOpen());
  await page.waitForTimeout(400);
  ok(posts.filter((p2) => p2.__f === 'search.php').length === preSearch,
    '"search everything" while known-off sends NOTHING — refused up front');
  ok(await page.evaluate(() => __cmdkDeepErr !== null), '…and lands on the honest error state, instantly');
  // The tier can NEVER shadow live data — TWO gates, each tested where it
  // bites. NB the second is the one that matters: the first draft only tested
  // online, and deleting the stores gate left it green because the verdict
  // gate answered first (the mis-aimed-break-test lesson).
  apiDead = false;
  await page.evaluate(() => closeCmdK());
  await page.evaluate(() => odsRetry());
  await settle(2500);
  ok(await page.evaluate(() => chbSnapAnswers('who arrives today') === null),
    'online, the verdict gate abstains');
  apiDead = true;
  await page.evaluate(() => apiPost('bookings.php', { action: 'history', id: 2 }).catch(() => {}));
  await page.waitForTimeout(400);
  ok(await page.evaluate(() => document.body.classList.contains('net-off') && chbSnapAnswers('who arrives today') === null),
    'offline MID-SESSION with stores loaded it still abstains — live data stays in charge');
  apiDead = false;

  // ── §18 OFFLINE MODE TAKES OVER BY ITSELF ON A POOR SIGNAL — nothing fails,
  //     everything HANGS, and the owner must not stare at an empty Today for
  //     the length of the 15s timeouts. The boot race enters owner-mode while
  //     the auth verdict is still pending; the patience timer puts the saved
  //     sheet up while the data is still pending; the header is trimmed to
  //     what still works; and when the slow data finally lands, the live
  //     Today swaps back in by itself — same arc, no reload, nothing tapped.
  console.log('§18 automatic offline mode on a poor signal');
  // (fixture) a good boot first, so the hint + snapshot are fresh
  await page.reload({ waitUntil: 'domcontentloaded' });
  await settle();
  apiHang = true;
  await page.reload({ waitUntil: 'domcontentloaded' });
  // (a) the boot race: owner-mode while the auth verdict is STILL HANGING
  let ownerAt = -1, sheetAt = -1;
  for (let t = 0; t < 60 && apiHang; t++) {
    await page.waitForTimeout(250);
    if (ownerAt < 0 && await page.evaluate(() => document.body.classList.contains('owner-mode'))) ownerAt = t * 250;
    if (await page.evaluate(() => !!document.getElementById('offline-daysheet'))) { sheetAt = t * 250; break; }
  }
  ok(ownerAt >= 0, `owner-mode entered while the auth verdict was still pending (${ownerAt}ms — the boot race)`);
  ok(sheetAt >= 0, `the day sheet took over while every request was still PENDING (${sheetAt}ms — the patience timer, not the 15s timeout)`);
  // (b) the header is trimmed to what still works
  const dockVis = (view) => page.evaluate((v) => {
    const b = document.querySelector(`.admin-dock-btn[data-view="${v}"]`);
    return !!b && getComputedStyle(b).display !== 'none';
  }, view);
  ok(await dockVis('view-backoffice'), 'Today stays in the header — it IS the sheet');
  ok(!(await dockVis('view-inbox')) && !(await dockVis('view-accounts')) && !(await dockVis('view-settings')),
    'Inbox, Payments and Manage are gone — dead destinations make a menu read as broken');
  ok(await page.evaluate(() => { const l = document.querySelector('header .logo'); return !!l && l.getBoundingClientRect().width > 0; }),
    'the crown stays — the assistant answers from the snapshot');
  // (c) the SLOW data lands late → the live Today swaps in by itself
  apiHang = false;
  await page.waitForTimeout(6000);
  ok(await page.evaluate(() => !document.getElementById('offline-daysheet') && !document.body.classList.contains('offline-snap')),
    'the late-landing data swapped the sheet for the live Today — no reload, nothing tapped');
  ok(await dockVis('view-inbox') && await dockVis('view-accounts') && await dockVis('view-settings'),
    'and the full menu came back with it');

  // ── §19 THE WIFI-ICON RULE — airplane mode / wifi off fires the browser's
  //     `offline` event with no failed request, and the WHOLE page transforms:
  //     day sheet up, header trimmed, the owner brought to it from wherever
  //     they were. Deliberately ONLY on the no-interface signal — the evidence
  //     verdict alone (a blip) keeps the last-good workspace.
  console.log('§19 the wifi-icon rule');
  // (fixture) live, signed in, stores loaded, reading the INBOX
  await page.reload({ waitUntil: 'domcontentloaded' });
  await settle();
  await page.evaluate(() => openInbox());
  await page.waitForTimeout(600);
  ok(await page.evaluate(() => (document.querySelector('.page-view.active') || {}).id === 'view-inbox'), '(fixture) the owner is reading the Inbox');
  // a bare VERDICT flip (one failed request) must NOT transform — the blip rule
  apiDead = true;
  await page.evaluate(() => apiPost('bookings.php', { action: 'history', id: 2 }).catch(() => {}));
  await page.waitForTimeout(400);
  ok(await page.evaluate(() => document.body.classList.contains('net-off') && !document.body.classList.contains('offline-snap')),
    'a failed request alone flips the verdict but does NOT yank the owner off their screen');
  apiDead = false;
  await page.waitForTimeout(200);
  await page.evaluate(() => apiPost('bookings.php', { action: 'history', id: 2 }).catch(() => {}));
  await page.waitForTimeout(400);
  // …then the INTERFACE goes (airplane mode: the event fires AND requests
  // fail — with the routes left alive, the first successful request would
  // correctly swap everything straight back, which is the self-correcting
  // behaviour a SPURIOUS offline event deserves, not this fixture)
  apiDead = true;
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await page.waitForTimeout(800);
  ok(await page.evaluate(() => document.body.classList.contains('offline-snap') && !!document.getElementById('offline-daysheet')),
    'the offline event alone — NO failed request — puts the day sheet up');
  ok(await page.evaluate(() => (document.querySelector('.page-view.active') || {}).id === 'view-backoffice'),
    'and brings the owner to it from the Inbox — the trim was about to strand them there');
  ok(!(await dockVis('view-inbox')) && !(await dockVis('view-accounts')) && !(await dockVis('view-settings')),
    'the header is trimmed with it');
  // …and the existing recovery arc brings everything back
  apiDead = false;
  await page.evaluate(() => chbNetProbe());
  await page.waitForTimeout(2500);
  ok(await page.evaluate(() => !document.body.classList.contains('offline-snap') && !document.getElementById('offline-daysheet')),
    'the first live probe swaps it all back — sheet gone, live Today');
  ok(await dockVis('view-inbox'), 'and the full menu returns');

  // ── §20 THE OFFLINE EXPERIENCE — the machinery made visible: the banner's
  //     living freshness + probe whisper, the queue in words (sheet section +
  //     pill tray), the reconnect play-by-play, needs-signal titles, the
  //     assistant's offline landing, the A2HS nudge and the guest note.
  console.log('§20 the offline experience');
  apiDead = false;
  await page.reload({ waitUntil: 'domcontentloaded' });
  await settle(); // fresh hint + snapshot
  apiDead = true;
  await page.reload({ waitUntil: 'domcontentloaded' });
  await settle(3500);
  // (a) the banner's living parts + the entrance + an empty queue section
  ok(await page.evaluate(() => /just now|min ago/.test((document.getElementById('ods-fresh') || {}).textContent || '')),
    'the banner carries a LIVE freshness readout, not just a timestamp');
  ok(await page.evaluate(() => !document.querySelector('.ods-mark.is-stale')), 'a fresh snapshot is not graded stale');
  ok(await page.evaluate(() => (document.getElementById('offline-daysheet') || {}).classList.contains('ods-enter')),
    'the takeover is a moment — the sheet enters, it does not jump-cut');
  ok(await page.evaluate(() => (document.getElementById('ods-queue') || {}).style.display === 'none'),
    'with nothing queued, no queue section poses as content');
  // (b) the probe is visible where it matters — AFTER the boot's own loadData
  // has failed and re-rendered the sheet (its innerHTML rebuild would wipe the
  // probe text written between the two renders)
  await settle(3500);
  await page.evaluate(() => { chbNetProbe(); });
  await page.waitForTimeout(200);
  ok(await page.evaluate(() => /checking/.test((document.getElementById('ods-probe') || {}).textContent || '')),
    'a probe in flight says "checking the connection…" on the banner');
  // (g) a dimmed Tier-C control explains itself on hover
  ok(await page.evaluate(() => {
    const b = document.createElement('button');
    b.setAttribute('data-act', 'requestPayment');
    document.body.appendChild(b);
    b.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    const t = b.getAttribute('title') || '';
    b.remove();
    return /Needs signal/.test(t);
  }), 'a dimmed money control grows a "needs signal" title under the pointer');
  // (c) a queued capture shows up IN WORDS — on the sheet and behind the pill
  await page.locator('#offline-daysheet button', { hasText: 'Record an expense' }).click();
  await page.waitForTimeout(400);
  await gdSet('amount', '25');
  await gdSet('desc', 'Cleaner top-up');
  await page.locator('#glass-dialog-ok').click();
  await page.waitForTimeout(1200);
  ok(await page.evaluate(() => {
    const q = document.getElementById('ods-queue');
    return !!q && q.style.display !== 'none' && /Waiting to send/.test(q.textContent) && /Expense/.test(q.textContent) && /posts itself/.test(q.textContent);
  }), 'the sheet lists the queued write in words — what, when, and what happens next');
  await page.locator('#offline-pill').click();
  await page.waitForTimeout(400);
  ok(await page.evaluate(() => {
    const m = document.getElementById('glass-dialog-msg');
    return !!m && /Waiting to send/.test(m.textContent || '') && /Expense/.test(m.textContent || '');
  }), 'tapping the pill opens the same tray from anywhere');
  await page.evaluate(() => glassDialogResolve(true));
  await page.waitForTimeout(300);
  // (d) a stale snapshot is GRADED, not just dated
  await page.evaluate(() => {
    __chbSnapCache.at = Date.now() - 7 * 3600e3;
    renderOfflineDaySheet();
  });
  await page.waitForTimeout(300);
  ok(await page.evaluate(() => !!document.querySelector('.ods-mark.is-stale') && /h ago/.test((document.getElementById('ods-fresh') || {}).textContent || '')),
    'a 7-hour-old sheet turns the banner amber and says so');
  await page.evaluate(() => { __chbSnapCache.at = Date.now(); renderOfflineDaySheet(); });
  // (e) the assistant's landing has an offline board, attributed
  await page.evaluate(() => openCmdK());
  await page.waitForTimeout(900);
  ok(await page.evaluate(() => {
    const t = (document.getElementById('cmdk') || {}).textContent || '';
    return /From the saved day sheet/.test(t) && / in · /.test(t);
  }), 'the landing leads with the saved day — counts and money, each attributed to the sheet');
  await page.evaluate(() => closeCmdK());
  // (i) the A2HS nudge — once, and only where it is true
  ok(await page.evaluate(() => {
    isAppleTouchDevice = () => true;
    isStandalonePwa = () => false;
    localStorage.removeItem('chb-a2hs-nudged');
    document.querySelectorAll('.toast').forEach((t) => t.remove());
    odsA2hsNudge();
    return /Add to Home Screen/.test((document.getElementById('app-toasts') || {}).textContent || '');
  }), 'an un-installed Apple device gets the Add-to-Home-Screen tip');
  ok(await page.evaluate(() => {
    document.querySelectorAll('.toast').forEach((t) => t.remove());
    odsA2hsNudge();
    return !/Add to Home Screen/.test((document.getElementById('app-toasts') || {}).textContent || '');
  }), '…exactly once — the second call says nothing');
  // (f) the reconnect play-by-play: the flush is VISIBLE, then everything swaps
  apiDead = false;
  await page.evaluate(() => chbNetProbe());
  let syncSeen = false;
  for (let t = 0; t < 20 && !syncSeen; t++) {
    await page.waitForTimeout(300);
    syncSeen = await page.evaluate(() => {
      const el = document.getElementById('oq-sync');
      return !!el && el.classList.contains('show') && /sent ✓|Sending/.test(el.textContent || '');
    });
  }
  ok(syncSeen, 'the sync strip narrates the replay ("Sending 1 of 1 — …" → "sent ✓")');
  await page.waitForTimeout(3000);
  ok(await page.evaluate(() => !document.getElementById('offline-daysheet')), '(fixture) the sheet swapped for live Today');
  // (h) a GUEST is told once, kindly
  await page.evaluate(() => forceAdminLogout());
  await page.waitForTimeout(400);
  apiDead = true;
  await page.evaluate(() => { document.querySelectorAll('.toast').forEach((t) => t.remove()); window.dispatchEvent(new Event('offline')); });
  await page.waitForTimeout(500);
  ok(await page.evaluate(() => /availability and booking need a connection/.test((document.getElementById('app-toasts') || {}).textContent || '')),
    'a guest going offline is told the saved pages still work — once');
  await page.evaluate(() => { document.querySelectorAll('.toast').forEach((t) => t.remove()); window.dispatchEvent(new Event('offline')); });
  await page.waitForTimeout(400);
  ok(await page.evaluate(() => !/availability and booking/.test((document.getElementById('app-toasts') || {}).textContent || '')),
    '…and never nagged again this session');
  apiDead = false;

  // ── §21 THE UNIFIED DASHBOARD — the sheet wears the online Today's anatomy,
  //     fed by ONE adapter (chbDayRows): the same ops-line grammar, the
  //     Needs-you rows routing to the captures, a read-only hub card, and a
  //     timeline bounded to the days the rows vouch for.
  console.log('§21 one dashboard, two sources');
  apiDead = false;
  await page.reload({ waitUntil: 'domcontentloaded' });
  await settle();
  const onlineLine = await page.evaluate(() => (document.getElementById('today-date') || {}).textContent || '');
  apiDead = true;
  await page.reload({ waitUntil: 'domcontentloaded' });
  await settle(3500);
  // (a) the ops line — same grammar as the online header, source stated
  const sheetLine = await page.evaluate(() => (document.querySelector('.ods-opsline') || {}).textContent || '');
  ok(/1 departure/.test(sheetLine) && /to collect/.test(sheetLine) && /from the saved sheet/.test(sheetLine),
    `the sheet's ops line speaks the header's grammar, source stated ("${sheetLine.trim()}")`);
  ok(/1 departure/.test(onlineLine),
    `…the SAME grammar the online header used moments earlier ("${onlineLine.slice(0, 80)}…")`);
  // (b) the duties — Needs-you rows, routing to the captures
  const duties = await page.evaluate(() => Array.from(document.querySelectorAll('.ods-duty .ny-label')).map((n) => n.textContent));
  ok(duties.some((d2) => /£340\.00 to collect from Marcus Ellery/.test(d2)), 'the money duty names the guest and the figure');
  ok(duties.some((d2) => /Hannah Whitlock’s £75\.00 deposit to decide/.test(d2)), 'the deposit duty names whose and how much');
  await page.locator('.ods-duty', { hasText: 'to collect from Marcus' }).click();
  await page.waitForTimeout(400);
  ok(await page.evaluate(() => /Record a payment/.test((document.getElementById('glass-dialog-title') || {}).textContent || '')),
    'tapping the money duty opens the CAPTURE — the one action offline can honour');
  await page.evaluate(() => glassDialogResolve(false));
  await page.waitForTimeout(300);
  // (c) the read-only hub card behind the guest's name
  await page.locator('.ods-open', { hasText: 'Marcus Ellery' }).click();
  await page.waitForTimeout(400);
  ok(await page.evaluate(() => {
    const ov = document.getElementById('ods-hub-ov');
    const t = ov ? ov.textContent : '';
    return !!ov && ov.classList.contains('open') && /07700 900342/.test(t) && /£340\.00/.test(t) && /needs a connection/.test(t);
  }), 'the guest\'s name opens the hub-card — phone, money, and the honest boundary');
  await page.locator('.ods-hub-close').click();
  await page.waitForTimeout(200);
  ok(await page.evaluate(() => !document.getElementById('ods-hub-ov').classList.contains('open')), '…and it closes');
  // (d) the bounded timeline: Today + Tomorrow drawn, beyond hatched UNKNOWN
  ok(await page.evaluate(() => {
    const tl = document.querySelector('.ods-tl');
    if (!tl) return false;
    const days = Array.from(tl.querySelectorAll('.ods-tl-day')).map((d2) => d2.textContent);
    const lanes = tl.querySelectorAll('.ods-tl-nm').length;
    const unknown = tl.querySelectorAll('.ods-tl-cell.unknown').length;
    return days.includes('Today') && days.includes('Tomorrow') && lanes >= 1 && unknown === lanes;
  }), 'the timeline draws exactly the vouched days — one hatched UNKNOWN cell per lane, never an empty "free"');
  ok(await page.evaluate(() => /Marcus/.test((document.querySelector('.ods-tl-cell.has') || {}).textContent || '')),
    'a stay covering today paints its bar with the guest\'s name');
  ok(await page.evaluate(() => /unknown/.test((document.querySelector('.ods-tl-note') || {}).textContent || '')),
    'and the note says what the hatching means');
  // (e) THE ADAPTER'S OTHER SOURCE: a mid-session takeover (stores loaded)
  //     renders the same sheet from LIVE data, marker keyed on the source.
  apiDead = false;
  await page.evaluate(() => odsRetry());
  await settle(2500);
  ok(await page.evaluate(() => !document.getElementById('offline-daysheet')), '(fixture) back on live Today');
  apiDead = true;
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await page.waitForTimeout(900);
  const liveMark = await page.evaluate(() => (document.querySelector('.ods-mark') || {}).textContent || '');
  ok(/built from the data already on this phone/.test(liveMark),
    'a mid-session takeover says its rows came from MEMORY, not the snapshot');
  ok(await page.evaluate(() => /1 departure/.test((document.querySelector('.ods-opsline') || {}).textContent || '')),
    '…and the same sections render from the live source — one page, two sources');
  apiDead = false;
  await page.evaluate(() => chbNetProbe());
  await page.waitForTimeout(2500);

  // ── §22 NOTIFICATIONS NEVER DOUBLE-SHOW (owner screenshot: "Back online."
  //     stacked over TWO copies of "Back on — this is live data now."). Three
  //     layers, each proven: toast() dedupes identical visible messages, the
  //     retry is re-entrant-safe (one recovery = ONE data load), and the
  //     generic chbNetUp voice stands down while the sheet's specific one
  //     owns the moment.
  console.log('§22 one voice per moment');
  // (a) the dedupe itself — and the action-toast exemption
  ok(await page.evaluate(() => {
    document.querySelectorAll('.toast').forEach((t) => t.remove());
    toast('Dup test message');
    toast('Dup test message');
    return document.querySelectorAll('.toast').length === 1;
  }), 'an identical message already on screen is not stacked again');
  ok(await page.evaluate(() => {
    toast('Dup test message', null, { label: 'Retry', fn: () => {} });
    return document.querySelectorAll('.toast').length === 2;
  }), '…but an ACTION toast is exempt — its button must not be dropped silently');
  await page.evaluate(() => { document.querySelectorAll('.toast').forEach((t) => t.remove()); });
  // (b) two concurrent retries = ONE data load, one toast
  apiDead = true;
  await page.reload({ waitUntil: 'domcontentloaded' });
  await settle(3500);
  ok(await page.evaluate(() => !!document.getElementById('offline-daysheet')), '(fixture) the sheet is up');
  await page.evaluate(() => { document.querySelectorAll('.toast').forEach((t) => t.remove()); });
  const bootBase = bootHits;
  apiDead = false;
  await page.evaluate(() => { odsRetry(); odsRetry(); });
  await page.waitForTimeout(2500);
  // ONE recovery is TWO loads by design (odsRetry's own loadData, then
  // initBackOffice's) — the guard's failure mode is FOUR (break-tested).
  ok(bootHits - bootBase === 2, `two overlapping retries ran ONE recovery (${bootHits - bootBase} loads = odsRetry + its initBackOffice) — re-entrant-safe`);
  ok(await page.evaluate(() => {
    const t = Array.from(document.querySelectorAll('.toast')).filter((x) => /Back on — this is live data now/.test(x.textContent));
    return t.length === 1;
  }), '…and said it once');
  // (c) the generic voice stands down while the sheet is up
  apiDead = true;
  await page.reload({ waitUntil: 'domcontentloaded' });
  await settle(3500);
  await page.evaluate(() => { document.querySelectorAll('.toast').forEach((t) => t.remove()); });
  apiDead = false;
  await page.evaluate(() => chbNetProbe());
  await page.waitForTimeout(2500);
  const arcToasts = await page.evaluate(() => (document.getElementById('app-toasts') || {}).textContent || '');
  ok(/Back on — this is live data now/.test(arcToasts) && !/Back online\./.test(arcToasts),
    `the probe recovery speaks with ONE voice — the sheet's own, never the generic on top ("${arcToasts.trim().slice(0, 60)}")`);
  ok(await page.evaluate(() => !document.getElementById('offline-daysheet')), '(fixture) and the sheet swapped for live Today');

  // ── §23 THE SHEET LOOKS LIKE THE ONLINE DASHBOARD (owner screenshots: a
  //     quiet day collapsed to two buttons while online showed a screen of
  //     OTA bars and upcoming cards) — and the takeover no longer needs the
  //     `offline` EVENT, which iOS never delivers when airplane mode is
  //     toggled while the app is backgrounded.
  console.log('§23 the sheet mirrors online + the missed-event takeover');
  apiDead = false;
  await page.reload({ waitUntil: 'domcontentloaded' });
  await settle();
  apiDead = true;
  await page.reload({ waitUntil: 'domcontentloaded' });
  await settle(3500);
  // (a) OTA stays PAINT — the timeline and the groups show them like online
  ok(await page.evaluate(() => /Airbnb/.test((document.querySelector('.ods-tl') || {}).textContent || '')),
    'the OTA stay paints its timeline bar, exactly as the online calendar does');
  ok(await page.evaluate(() => {
    const sheet = (document.getElementById('offline-daysheet') || {}).textContent || '';
    return /Airbnb guest/.test(sheet);
  }), '…and appears in the day\'s groups (a changeover is changeover work whoever booked it)');
  // (b) …but never COUNTS: the ops line and duties are bookings-only, so the
  //     grammar still agrees with the online header (§21's contract)
  ok(await page.evaluate(() => /1 arrival · 1 departure/.test((document.querySelector('.ods-opsline') || {}).textContent || '')),
    'the ops line is unchanged by the OTA row — it counts bookings, like online');
  ok(await page.evaluate(() => !Array.from(document.querySelectorAll('.ods-duty')).some((d2) => /Airbnb/.test(d2.textContent))),
    'and no duty is minted for money an OTA guest does not owe us');
  // (c) the Bookings section — upcoming cards, like online's list
  ok(await page.evaluate(() => {
    const sheet = document.getElementById('offline-daysheet');
    const t = sheet ? sheet.textContent : '';
    return /Bookings/.test(t) && /upcoming/.test(t) && /Zara Outofrange/.test(t);
  }), 'the sheet carries the online Bookings list\'s upcoming cards — a quiet day no longer looks empty');
  // NO SILENT CAP. The list is the next FIVE; the count used to be taken AFTER
  // that slice, so a business with more than five always read "5 upcoming" — a
  // page one that looked like the whole book. This fixture has only three
  // future stays, so the cap never bites here: the renderer is driven directly
  // with both shapes, which is what actually distinguishes the two branches.
  const capLines = await page.evaluate(() => {
    const row = { pk: '21a', cot: '21A', nm: 'A Guest', ci: '2026-09-01', co: '2026-09-04', party: '2 adults', paid: true };
    const five = [row, row, row, row, row];
    return {
      capped: odsUpcomingHtml(five, 12),
      exact: odsUpcomingHtml([row, row, row], 3),
      legacy: odsUpcomingHtml(five, undefined), // a sheet written before the total was carried
    };
  });
  ok(/The next 5 of 12 upcoming/.test(capLines.capped) && !/>5 upcoming</.test(capLines.capped),
    'a capped list says it is showing five OF twelve, never "5 upcoming"');
  ok(/3 upcoming/.test(capLines.exact) && !/The next/.test(capLines.exact),
    '…while a list that really is all of them just states the number');
  ok(/The next 5/.test(capLines.legacy) && !/ of /.test(capLines.legacy),
    '…and an older sheet with no total says only what it can stand behind');
  ok(await page.evaluate(() => {
    const chip = Array.from(document.querySelectorAll('.ods-row .bhub-chip')).find((c) => /Paid|Balance due/.test(c.textContent));
    return !!chip;
  }), '…each wearing the paid/balance chip the online cards wear');
  // (d) the action row sits where online's does — right under the ops line
  ok(await page.evaluate(() => {
    const sheet = document.getElementById('offline-daysheet');
    const html = sheet ? sheet.innerHTML : '';
    return html.indexOf('Record an expense') < html.indexOf('ods-tl');
  }), 'the capture buttons sit under the ops line, where online keeps its action row');
  // (e) THE MISSED-EVENT TAKEOVER: airplane mode toggled while backgrounded
  //     delivers NO offline event — the verdict flipping with the interface
  //     down must transform on its own.
  apiDead = false;
  await page.evaluate(() => odsRetry());
  await settle(2500);
  ok(await page.evaluate(() => !document.getElementById('offline-daysheet')), '(fixture) back on live Today');
  apiDead = true;
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'onLine', { get: () => false, configurable: true });
  });
  await page.evaluate(() => apiPost('bookings.php', { action: 'history', id: 2 }).catch(() => {}));
  await page.waitForTimeout(900);
  ok(await page.evaluate(() => !!document.getElementById('offline-daysheet') && document.body.classList.contains('offline-snap')),
    'a failed request with the INTERFACE down transforms — no offline event needed');
  await page.evaluate(() => {
    delete navigator.onLine; // lift the shadow — the prototype getter returns
  });
  apiDead = false;
  await page.evaluate(() => chbNetProbe());
  await page.waitForTimeout(2500);
  ok(await page.evaluate(() => !document.getElementById('offline-daysheet')), '(fixture) recovered clean');

  console.log(fails ? `\n${fails} CHECK(S) FAILED ❌` : '\nOFFLINE SUITE PASSED ✅');
  await done(fails);
})();
