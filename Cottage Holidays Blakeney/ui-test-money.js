// Full Payments verification, on the one Payments page (CLAUDE.md "Payments: where
// the money is, in one look"):
//  1. the dock Payments button exists and its handler opens view-accounts
//  2. the landing: "Guests still to pay" (the deposit-folded figure, the overdue
//     capsule, the status pill), Needs you (each held deposit's own figure, Keep on
//     both rails), the books card (the server's profit), the Money list, the calm state
//  3. the detail pages: a guest's page, the Money list's filters, the books (Income &
//     tax), Expenses, and the pricing coach's move to Manage → Pricing
//  4. the money ACTIONS work end-to-end: a guest's row → their page → the booking hub;
//     Record a payment posts the right payload → the guest leaves the list; Return on
//     a deposit's row posts the return, and a failed guest email is reported
//  5. back navigation: a detail page slides away; the expenses drill-down returns
//  6. the books say what the profit figure covers
//  8. the Square location picker, and "Check Square now" saying what failed
// (The old landing's verdict folds, moAsyncFill, the bulk chase and Move money out
// went with that design; their arithmetic is gated by test-sweep / test-payouts.)
// The site reckons "today" in UK time (todayDashed / ukNowParts), so the
// tests must too — pin the whole process (and the browser it launches) to
// Europe/London so fixtures built from new Date() agree with the app on
// any runner, in any timezone. Must run before the first Date call.
const { boot } = require('./ui-test-lib'); // pins TZ=Europe/London at require time
let fails = 0;
const ok = (b, m) => { console.log(`  ${b ? '✓' : '✗'} ${m}`); if (!b) fails++; };
// Local-formatted, never toISOString() — that's UTC and slips a day near midnight.
const d = require('./ui-test-lib').d; // the harness's day (today, UK)

(async () => {
  const { page, browser, base, done } = await boot({ viewport: { width: 1280, height: 950 } });

  const mk = (id, over = {}) => Object.assign({
    id, prop_key: '21a', name: 'Owes Money', email: 'owes@gmail.com', phone: '', address: '1 Lane',
    postcode: 'NR25 7AB', check_in: d(20), check_out: d(23), check_in_time: '15:00', check_out_time: '10:00',
    adults: 2, children: 0, payment: 'unpaid', deposit_paid: 0, payment_method: '', payment_date: '',
    agreed_total: 440, agreed_per_night: 130, agreed_nights: 3, agreed_nightly: 390, agreed_booking_fee: 50,
    agreed_txn_pct: 0, agreed_txn_fee: 0, agreed_on: d(0), hold_status: 'none', notes: '',
  }, over);
  const rows = [
    mk(1),
    mk(2, { name: 'Paid Up', email: 'paid@gmail.com', check_in: d(40), check_out: d(43), payment: 'paid', deposit_paid: 440, payment_method: 'Card', payment_date: d(-3) }),
    // past stay still holding a £100 damage deposit → deposits-to-return queue
    mk(3, { name: 'Left Deposit', email: 'left@gmail.com', check_in: d(-6), check_out: d(-3), payment: 'paid', deposit_paid: 540, payment_method: 'Card', payment_date: d(-30), hold_status: 'charged', hold_amount: 100 }),
    // …and the SAME situation on the CASH rail. hold_status stays 'none' because no
    // card was ever charged; the deposit is in damageHeld's `paid above the rental`
    // branch (£490 = £440 rental + £50 deposit), so it is listed here and raised as
    // a duty exactly like the card one.
    mk(4, { name: 'Cash Deposit', email: 'cash@gmail.com', check_in: d(-6), check_out: d(-3), payment: 'paid', deposit_paid: 490, payment_method: 'Bank transfer', payment_date: d(-30), hold_status: 'none' }),
  ];
  // Drives the guest-email failure the deposit-return report has to surface.
let mailWillFail = false;
  const posts = [];
  // money.php: the page's one door. The books are the server's (656.20 rental + 50
  // kept − 9.80 fees − 120 expenses = 576.40); the movements and where the money is
  // are set per case below.
  const TY = d(0) < `${new Date().getFullYear()}-04-06` ? new Date().getFullYear() - 1 : new Date().getFullYear();
  const MONEY_POS = { with_square: 0, with_square_count: 0, unknown: 0, unreported: 0, unreported_count: 0, next_arrival: '', in_bank: 0, ready: 0, held: 0, last_moved: 0, error: false, checked: Math.floor(Date.now() / 1000), payout_error: null, failed: [], disputes: null, bank: '' };
  let moneyPos = MONEY_POS;
  let moneyAct = [];
  const BOOKS = { year: TY, income: 656.2, kept: 50, fees: 9.8, expenses: 120, profit: 576.4, quarters: [0, 706.2, 0, 0], by_category: [{ category: 'Maintenance', amount: 120 }], undated: { count: 0, total: 0, held: 0 } };
  // What Square says the seller's locations are, and which one is chosen.
  let sqLocations = [];
  let sqLocation = '';
  let refreshFails = false; // flip to drive payouts_refresh's 502 path
  await page.route(/\.php/, (route) => {
    const url = route.request().url();
    const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (route.request().method() === 'POST') {
      const b = JSON.parse(route.request().postData() || '{}');
      b.__url = url.split('/').pop().split('?')[0];
      posts.push(b);
      if (b.__url === 'bookings.php') {
        if (b.action === 'history') return json({ ok: true, events: [] });
        if (b.action === 'email_logs') return json({ logs: {} });
        if (b.action === 'email_render') return json({ ok: true, subject: 'Your booking is confirmed', html: '<p>Preview</p>' });
        // set_payment stores the cumulative rental, plus the cash deposit when it came in full.
        if (b.action === 'set_payment') { const r = rows.find((x) => x.id === b.id); if (r) { r.payment = b.payment; r.deposit_paid = b.deposit || (b.payment === 'paid' ? r.agreed_total + (b.deposit_collected ? r.agreed_booking_fee : 0) : 0); r.payment_method = b.payment_method || ''; r.payment_date = b.payment_date || ''; } return json({ ok: true }); }
        if (b.action === 'return_deposit') {
          const r = rows.find((x) => x.id === b.id);
          if (r) r.hold_status = 'returned';
          // The real endpoint always reports the send outcome; mailWillFail drives the
          // case where the money moved and the guest was never told.
          return json({ ok: true, returned: Number(b.amount) || 0, status: 'PENDING', email: { ok: !mailWillFail, error: mailWillFail ? 'SMTP connect failed' : '' } });
        }
        if (b.action === 'confirm_return_settled') return json({ ok: true, confirmed: 1, amount: 73.69 });
        return json({ ok: true });
      }
      // A failed Square read is a NON-2xx with a sentence — the endpoint's real
      // contract; the tests below flip this on to drive both callers through it.
      if (b.__url === 'square-setup.php' && b.action === 'payouts_refresh' && refreshFails)
        return route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: 'Square couldn\u2019t be reached — the payout data may be out of date.' }) });
      // The Square settings status, which now carries the LOCATIONS the picker offers.
      if (b.__url === 'square-setup.php' && b.action === 'status')
        return json({ square: true, connected: true, enabled: true, events: [], locations: sqLocations, location: sqLocation });
      if (b.__url === 'expenses.php') return json({ ok: true, expenses: [{ id: 1, date: d(-40), category: 'Maintenance', note: 'Boiler service', amount: 120 }] });
      if (b.__url === 'money.php') {
        if (b.action === 'stay') return json({ ok: true, events: [] });
        if (b.action === 'books') return json({ ok: true, books: Object.assign({}, BOOKS, { year: Number(b.year) || TY }) });
        if (b.action === 'activity') return json({ ok: true, activity: [] });
        return json({ ok: true, at: Math.floor(Date.now() / 1000), position: moneyPos, bank_items: [], way_items: [], moved_map: {}, landed_map: {}, books: BOOKS, years: [TY, TY - 1], activity: moneyAct.slice() });
      }
      return json({ ok: true, events: [], logs: {}, reviews: [], photos: [] });
    }
    if (url.includes('bookings.php')) return json({ bookings: rows });
    if (url.includes('accounts.php')) {
      // Year report (the exports read it): £656.20 received, £9.80 of Square fees
      // (kept by the processor, so deducted from profit), one Q2 card payment.
      if (/[?&]year=\d/.test(url)) return json({
        year: 2026, years: [2026, 2025], total: 656.20, held_deposits: 0,
        card_fees: 9.80, fee_days: [{ date: '2026-07-15', fee: 9.80 }],
        kept_deposits: 50.00, kept_days: [{ date: '2026-08-15', amount: 50.00 }],
        count: 1, by_property: { '21a': 656.20 },
        payments: [{ id: 1, name: 'Fee Guest', prop_key: '21a', property_name: '21A Westgate', payment_method: 'card', payment_date: '2026-07-15', received: 656.20, income_part: 656.20, held_part: 0 }],
        undated: { count: 0, total: 0, held: 0 },
      });
      return json({ years: [2026, 2025] });
    }
    if (url.includes('expenses.php')) return json({ ok: true, expenses: [{ id: 1, date: d(-40), category: 'Maintenance', note: 'Boiler service', amount: 120 }] });
    if (url.includes('rates.php')) return json({ properties: [{ prop_key: '21a', name: '21A Westgate', slug: '21a', couple_rate: 130, extra_adult_rate: 0, child_rate: 0, booking_fee: 50, transaction_pct: 0, lastmin_pct: 0, lastmin_days: 0, max_adults: 2, max_children: 0, max_total: 2, sort_order: 1 }], seasons: {}, occupancy: {} });
    return json({ ok: true, bookings: [], enquiries: [], properties: [], seasons: {}, occupancy: {}, content: {}, blocks: [], ranges: [], payments: [], years: [] });
  });

  await page.goto(`${base}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1300);
  await page.evaluate(() => { isAuthenticated = true; document.body.classList.add('owner-mode'); });
  await page.evaluate(() => window.loadAdminBundle());
  await page.waitForTimeout(600);
  await page.evaluate(() => loadData());
  await page.waitForTimeout(600);

  // ---- 1. dock button ----
  console.log('1. dock button');
  const dock = await page.evaluate(() => {
    const b = document.querySelector('.admin-dock-btn[data-view="view-accounts"]');
    // Wiring is either the legacy inline onclick or the CSP-clean data-act delegation.
    return { exists: !!b, label: b ? b.getAttribute('data-label') : '', onclick: b ? b.getAttribute('onclick') : '', act: b ? b.getAttribute('data-act') : '' };
  });
  ok(dock.exists && dock.label === 'Payments' && /openAccounts/.test(dock.onclick || dock.act), `Payments dock button present + wired (${dock.onclick || dock.act})`);
  await page.evaluate(() => document.querySelector('.admin-dock-btn[data-view="view-accounts"]').click());
  await page.waitForTimeout(1100);
  const nav1 = await page.evaluate(() => ({
    active: (document.querySelector('.page-view.active') || {}).id,
    current: (document.querySelector('.admin-dock-btn.current') || {}).getAttribute?.('data-view'),
  }));
  ok(nav1.active === 'view-accounts', `dock tap opens Money (${nav1.active})`);
  ok(nav1.current === 'view-accounts', `dock highlights Money (${nav1.current})`);

  // ---- 2. the landing: the one Payments page ----
  // RE-AIMED for "Payments: where the money is, in one look". The old landing's five
  // verdict folds (To collect / To move out / To give back / The books / Recent), its
  // headline sentence, moAsyncFill and the bulk chase went with it. What each of them
  // protected is asserted on the part that answers the same question now: who still
  // owes is the "Guests still to pay" card (bookingDue, so it agrees with the booking
  // page and Today), what needs the owner is "Needs you", the books are their card,
  // and every movement is the Money list.
  console.log('2. the landing (the one Payments page)');
  const owedNow = () => page.evaluate(() => {
    const card = document.getElementById('pm-coming');
    const rowsEl = card ? [...card.querySelectorAll('.pm-orow')] : [];
    const pill = document.querySelector('#mo-pill .head-pill');
    return {
      fig: ((card && card.querySelector('[data-fig="owe"]')) || {}).textContent || '',
      sub: ((card && card.querySelector('.pm-owe-top .pm-s')) || {}).textContent || '',
      rows: rowsEl.map((r) => ({ name: ((r.querySelector('.pm-t') || {}).textContent || '').trim(), v: ((r.querySelector('.pm-v') || {}).textContent || '').trim(), cap: ((r.querySelector('.pm-cap') || {}).textContent || '').trim(), tone: ((r.querySelector('.pm-cap') || {}).className || '').replace('pm-cap', '').trim(), arg: r.getAttribute('data-arg') })),
      pill: pill ? pill.textContent.trim() : '', tone: pill ? pill.dataset.tone || '' : '',
      pillPlace: (() => {
        const h = document.querySelector('#accounts-chrome h1');
        if (!pill || !h) return false;
        const pr = pill.getBoundingClientRect(), hr = h.getBoundingClientRect();
        return pr.left > hr.right && Math.abs((pr.top + pr.height / 2) - (hr.top + hr.height / 2)) <= 2;
      })(),
      needs: [...document.querySelectorAll('#pm-list .pm-capline.is-attn + .pm-rows > *')].map((r) => r.textContent.replace(/\s+/g, ' ').trim()),
      calmPanel: !!document.querySelector('#mo-calm, .mo-calm'),
    };
  });
  await page.waitForFunction(() => !!document.querySelector('#pm-coming [data-fig="owe"]') && !!document.querySelector('#pm-list .pm-books'), null, { timeout: 15000 }).catch(() => {});
  const ov = await owedNow();
  // The fixture's ower checks in at d(20) — INSIDE the 30-day window with the standard
  // due date 10 days gone, so it is genuinely OVERDUE, at the deposit-folded £490.
  ok(ov.rows.length === 1 && /Owes Money/.test(ov.rows[0].name) && ov.rows[0].v === '£490.00', `"Guests still to pay" lists the one ower at the deposit-folded £490 — the booking page's own figure (${JSON.stringify(ov.rows)})`);
  ok(ov.fig === '£490.00' && /1 guest/.test(ov.sub), `…and its figure is the sum of its rows (${ov.fig} · ${ov.sub})`);
  ok(ov.rows[0] && ov.rows[0].cap === 'Overdue' && ov.rows[0].tone === 'bad', `the overdue balance is a red capsule on its row, the row's one mark (${ov.rows[0] && ov.rows[0].cap})`);
  ok(ov.tone === 'bad' && /^1 overdue$/.test(ov.pill), `the status pill is red and names the overdue, never "nothing to collect" (${ov.pill})`);
  ok(ov.pillPlace && !ov.calmPanel, '…beside the Payments title, on its line — the Manage pill\'s place, and no tinted panel');
  // An overdue guest is in the owed card with its capsule: said ONCE, not again under Needs you.
  ok(!ov.needs.some((t) => /Owes Money/.test(t)), 'the overdue guest is not repeated under Needs you');
  // THE DEPOSITS STATE A FIGURE, on both rails. The old queue rendered "£0.00 — ready
  // to return" off a key the payload did not carry; and a CASH deposit (hold_status stays
  // 'none') was once missing from the ring fence. Both are rows of Needs you, each with
  // its own figure and Keep / Return.
  const deps = await page.evaluate(() => {
    const rowOf = (name) => [...document.querySelectorAll('#pm-list .pm-needrow')].find((r) => (r.textContent || '').includes(name));
    const shape = (name) => {
      const r = rowOf(name);
      if (!r) return null;
      return { v: ((r.querySelector('.pm-v') || {}).textContent || '').trim(), ret: !!r.querySelector('[data-pm="return"]'), keep: !!r.querySelector('[data-pm="keep"]'), say: (r.textContent || '').replace(/\s+/g, ' ').trim() };
    };
    const card = document.querySelector('#pm-list .pm-capline.is-attn + .pm-rows');
    const c = card ? getComputedStyle(card) : null;
    return { card: shape('Left Deposit'), cash: shape('Cash Deposit'), r: c ? c.borderTopLeftRadius : '', sh: c ? c.boxShadow : '' };
  });
  ok(!!(deps.card && deps.cash), `(fixture) both rails' deposits are under Needs you (${!!deps.card}/${!!deps.cash})`);
  ok(deps.card && deps.card.v === '£100.00' && deps.cash && deps.cash.v === '£50.00', `each held deposit states its own figure, never £0.00 (${deps.card && deps.card.v} / ${deps.cash && deps.cash.v})`);
  // KEEP IS RAIL-BLIND: it was gated on a CARD-rail fact cash never sets, so a cash
  // deposit could only be given back. Both rows read from one render.
  ok(deps.cash && deps.cash.ret && deps.cash.keep, `a CASH deposit can be kept for damage, not only given back (${deps.cash && deps.cash.say.slice(0, 60)})`);
  ok(deps.card && deps.card.ret && deps.card.keep, '…and the card rail is unchanged');
  ok(deps.r === '20px' && deps.sh === 'none', `the queue is ONE card of rows on the one look's radius, no drop shadow (${deps.r}, ${deps.sh})`);
  // The books: the SERVER's profit (656.20 rental + 50 kept − 9.80 fees − 120 expenses).
  const booksCard = await page.evaluate(() => ((document.querySelector('#pm-list .pm-books') || {}).textContent || '').replace(/\s+/g, ' '));
  ok(/£576\.40\s*profit so far/.test(booksCard) && /Income\s*£706\.20/.test(booksCard) && /Card fees\s*−£9\.80/.test(booksCard) && /Expenses\s*−£120\.00/.test(booksCard), `the books card states the server's profit and its parts (${booksCard.slice(0, 120)})`);
  // The Money list is honest when it is empty.
  ok(await page.evaluate(() => /Nothing here\s*Nothing of this kind yet/.test(document.getElementById('pm-list').textContent)), 'the Money list reports an honest empty list, not a blank');

  // 2b. the overdue rule, the other way: moving the stay OUT of the window (check-in 45
  // days off, unpaid) stands the red down — the same £490 is due now (an unpaid first
  // payment is due wherever the stay sits), amber. Restoring flips it back.
  const attnChk = await page.evaluate(([ci, co]) => {
    const b = (dbBookings['21a'] || []).find((x) => x.name === 'Owes Money');
    const keep = { checkIn: b.checkIn, checkOut: b.checkOut };
    const read = () => { const r = document.querySelector('#pm-coming .pm-orow'); const p = document.querySelector('#mo-pill .head-pill'); return { cap: r ? (r.querySelector('.pm-cap') || {}).textContent : '', v: r ? (r.querySelector('.pm-v') || {}).textContent : '', pill: p ? p.textContent.trim() : '', tone: p ? p.dataset.tone : '' }; };
    b.checkIn = ci; b.checkOut = co;
    pmRenderList();
    const down = read();
    Object.assign(b, keep);
    pmRenderList();
    return { down, up: read() };
  }, [d(45), d(48)]);
  ok(attnChk.down.cap === 'Due now' && attnChk.down.v === '£490.00', `moving the stay out of the window stands the red down: the £490 is Due now (${attnChk.down.cap} ${attnChk.down.v})`);
  ok(attnChk.down.tone === 'warn' && /^£490 due now$/.test(attnChk.down.pill), `…and the pill says what is due now, amber (${attnChk.down.pill})`);
  ok(attnChk.up.cap === 'Overdue' && attnChk.up.tone === 'bad', 'restoring the dates raises the overdue again');

  // The calm state, driven for real: nobody owing and no deposits held is a figure of
  // £0.00, a green pill, and no Needs-you section at all.
  const calmChk = await page.evaluate(() => {
    const keep = dbBookings['21a'].slice();
    dbBookings['21a'] = dbBookings['21a'].filter((x) => x.name === 'Paid Up');
    pmRenderList();
    const p = document.querySelector('#mo-pill .head-pill');
    const out = {
      fig: ((document.querySelector('#pm-coming [data-fig="owe"]') || {}).textContent || ''),
      sub: ((document.querySelector('#pm-coming .pm-owe-top .pm-s') || {}).textContent || ''),
      pill: p ? p.textContent.trim() : '', tone: p ? p.dataset.tone : '',
      needs: !!document.querySelector('#pm-list .pm-capline.is-attn'),
    };
    dbBookings['21a'] = keep;
    pmRenderList();
    return out;
  });
  ok(calmChk.fig === '£0.00' && /Nobody owes anything/.test(calmChk.sub), `with nobody owing, the card says so in one line (${calmChk.fig} · ${calmChk.sub})`);
  ok(calmChk.tone === 'ok' && calmChk.pill === 'Nothing to collect' && !calmChk.needs, `…the status is ONE green pill and nothing needs the owner (${calmChk.pill})`);

  // 2c. Card payments Square has not reported raise their own Needs-you row, from the
  // server's count (money_position judges the age); none reported, no row.
  const unk = async (n) => {
    moneyPos = Object.assign({}, MONEY_POS, { unreported_count: n, unreported: n ? 774.57 : 0 });
    await page.evaluate(() => pmLoad());
    return page.evaluate(() => [...document.querySelectorAll('#pm-list .pm-needrow')].some((r) => /card payments? to check/i.test(r.textContent) && /Square hasn.t reported 1/.test(r.textContent) && /£774\.57/.test(r.textContent)));
  };
  ok(await unk(1), 'a card payment Square has not reported raises "A card payment to check", with its figure');
  ok(!(await unk(0)), '…and with none, no such row');

  // ---- 3. the detail pages ----
  console.log('3. the detail pages');
  // Payments & balances is a guest's own page now, opened from their row.
  await page.evaluate(() => { const r = document.querySelector('#pm-coming .pm-orow'); if (r) r.click(); });
  await page.waitForFunction(() => /What has happened/.test((document.getElementById('pm-detail') || {}).textContent || ''), null, { timeout: 8000 }).catch(() => {});
  const stay = await page.evaluate(() => {
    const p = document.getElementById('pm-detail');
    const t = (p.textContent || '').replace(/\s+/g, ' ');
    const still = [...p.querySelectorAll('.pm-plan .pm-kv')].find((k) => /Still to pay/.test(k.textContent));
    return { t, record: !!p.querySelector('[data-pm="record"]'), hub: !!p.querySelector('[data-pm="hub"]'), cap: still ? [...still.querySelectorAll('.pm-cap')].map((c) => c.textContent.trim()).join('|') : '' };
  });
  ok(/Owes Money/.test(stay.t) && /Paid\s*£0\.00 of £490\.00/.test(stay.t), `a guest's page leads with what is paid of the whole (${stay.t.slice(0, 80)})`);
  ok(/The stay[^£]*£440\.00/.test(stay.t) && /Refundable deposit[^£]*£50\.00/.test(stay.t) && /Still to pay[^£]*£490\.00/.test(stay.t), 'the plan adds up: the stay £440 + the refundable deposit £50 = £490 still to pay');
  ok(stay.cap === 'Overdue', `what is still to pay says its state once, as one capsule (${stay.cap})`);
  ok(stay.record && stay.hub, 'it offers Record a payment and Open the booking');
  // Recent payments is the Money list now: every movement, newest first, each pound once.
  moneyAct = [
    { id: 'p40', at: Math.floor(Date.now() / 1000) - 3600, kind: 'in', what: 'Balance', booking_id: 2, name: 'Jean Robinson', prop: '21a', amount: 525, deposit: 0, fee: 8.4, method: 'card', status: 'done', payout: null },
    { id: 'p41', at: Math.floor(Date.now() / 1000) - 86400, kind: 'back', what: 'Deposit returned', booking_id: 3, name: 'Richard Berry', prop: '21a', amount: 75, status: 'pending' },
    { id: 'x7', at: Math.floor(Date.now() / 1000) - 2 * 86400, kind: 'expense', what: 'Maintenance', who: 'Boiler service', prop: '', amount: 120 },
  ];
  await page.evaluate(async () => { pmClose(); await pmLoad(); });
  await page.waitForFunction(() => document.querySelectorAll('#pm-list .pm-mrow[aria-label^="Jean Robinson"]').length > 0, null, { timeout: 8000 }).catch(() => {});
  const feed = await page.evaluate(() => {
    const rowsOf = () => [...document.querySelectorAll('#pm-activity ~ .pm-rows .pm-mrow')].map((r) => ({ t: ((r.querySelector('.pm-t') || {}).textContent || '').trim(), s: ((r.querySelector('.pm-s') || {}).textContent || '').trim(), v: ((r.querySelector('.pm-v') || {}).textContent || '').trim(), ic: ((r.querySelector('.pm-mic') || {}).className || '') }));
    const all = rowsOf();
    const pick = (f) => { const b = document.querySelector(`#pm-list [data-pm="filter"][data-arg="${f}"]`); if (b) b.click(); return rowsOf(); };
    const inn = pick('in'), out = pick('out');
    pick('all');
    return { all, inn, out };
  });
  ok(feed.all.length === 3, `the Money list carries every movement (${feed.all.map((r) => r.t).join(' · ')})`);
  ok(feed.all.every((r) => (/^\+/.test(r.v) ? / in$/.test(r.ic) : / out$/.test(r.ic))), `each row's direction agrees with its sign (${feed.all.map((r) => r.v).join(' ')})`);
  ok(feed.all.some((r) => /Richard Berry/.test(r.t) && /Deposit returned · on its way/.test(r.s) && r.v === '−£75.00'), 'a pending deposit return says it is on its way');
  ok(feed.inn.length === 1 && /^\+/.test(feed.inn[0].v) && feed.out.length === 2 && feed.out.every((r) => /^−/.test(r.v)), `Money in / Money out narrow the list by direction (${feed.inn.length} in, ${feed.out.length} out)`);
  // Income & tax is the books page.
  await page.evaluate(() => accountsOpen('income'));
  await page.waitForFunction(() => /The books/.test((document.getElementById('pm-detail') || {}).textContent || '') && !!document.querySelector('#pm-detail .pm-hero'), null, { timeout: 8000 }).catch(() => {});
  const booksPg = await page.evaluate(() => {
    const p = document.querySelector('#pm-detail .pm-dbody');
    const t = (p ? p.textContent : '').replace(/\s+/g, ' ').replace(/,/g, '');
    const num = (re) => { const m = t.match(re); return m ? parseFloat(m[1]) : null; };
    return {
      t, income: num(/Rental income£([\d.]+)/), kept: num(/Deposits kept£([\d.]+)/), fees: num(/Square’s card fees−£([\d.]+)/),
      exp: num(/Expenses−£([\d.]+)/), profit: num(/Profit£([\d.]+)/), head: ((p && p.querySelector('.pm-hero-top')) || {}).textContent || '',
      quarters: [...(p ? p.querySelectorAll('.pm-ql span') : [])].map((q) => q.textContent.trim()),
      csv: !!(p && p.querySelector('[data-pm="csv"]')), pdf: !!(p && p.querySelector('[data-pm="pdf"]')), every: !!(p && p.querySelector('[data-pm="expenses"]')),
    };
  });
  ok(booksPg.income === 656.2 && booksPg.fees === 9.8 && booksPg.kept === 50, `Income & tax opens the books: rental £${booksPg.income}, kept £${booksPg.kept}, fees −£${booksPg.fees}`);
  ok(booksPg.profit != null && Math.abs(booksPg.profit - (booksPg.income + booksPg.kept - booksPg.fees - booksPg.exp)) < 0.005 && /Profit so far\s*£576\.40/.test(booksPg.head), `profit = income + kept − fees − expenses (£${booksPg.profit}), the headline`);
  ok(booksPg.quarters.length === 4 && /Jul–Sep\s*£706/.test(booksPg.quarters.join(' ')), `the quarters carry the kept deposit with the rental (${booksPg.quarters.join(' / ')})`);
  ok(booksPg.csv && booksPg.pdf && booksPg.every, 'the books keep the accountant\'s exports and the way to every expense');
  // Expenses still has its own page, from the books.
  await page.evaluate(() => accountsOpen('expenses'));
  await page.waitForTimeout(700);
  const exp = await page.evaluate(() => { const s = document.getElementById('asec-expenses'); return { shown: !!s && s.style.display !== 'none', t: s ? s.textContent : '' }; });
  ok(exp.shown && /boiler service|expense/i.test(exp.t), 'Expenses (seeded row listed) opens with content');
  await page.evaluate(() => accountsShowIndex());
  await page.waitForTimeout(250);
  // The pricing coach moved into Manage → Pricing: no tool for it here, and its
  // old route lands on the Pricing page.
  const coachMoved = await page.evaluate(async () => {
    const noTool = !/Pricing coach/.test((document.getElementById('accounts-index') || {}).textContent || '');
    accountsOpen('pricingcoach');
    await new Promise((r) => setTimeout(r, 500));
    const sec = document.getElementById('sec-pricing');
    return { noTool, landed: !!sec && sec.style.display !== 'none' && document.getElementById('view-settings').classList.contains('active') };
  });
  ok(coachMoved.noTool && coachMoved.landed, `the Pricing coach button is gone from Payments, and its old route opens Manage → Pricing (${JSON.stringify(coachMoved)})`);
  console.log('pricing coach wears the unified anatomy (owner-asked)');
  // (Recent payments' own feed, renderMoneyFeed, went with that page: the Money list above.)
  const skin = await page.evaluate(async () => {
    const realGet = window.apiGet;
    window.apiGet = async (url) => {
      if (String(url).includes('pricing-suggest.php')) return { suggestions: [
        { id: 's1', prop_key: '21a', severity: 'opportunity', title: 'Raise the weekend uplift', detail: 'Strong weekend demand.', apply: { field: 'weekendPct', value: 30 } },
        { id: 's2', prop_key: '21a', severity: 'insight', title: 'Midweek gaps cluster', detail: 'A midweek offer would fill them.' },
      ], signals: { searches60: 12, noResult60: 3, searchWeeks: [{ week: ukShiftDays(todayDashed(), -60), count: 7, missed: 4 }, { week: ukShiftDays(todayDashed(), 14), count: 9, missed: 5 }] } };
      return realGet(url);
    };
    await openArea();
    settingsOpen('pricing');
    prCottage('21a');
    prLoadSearch(true);
    await new Promise((r) => setTimeout(r, 400));
    const pc = document.getElementById('pricing-body');
    const w = pc.querySelector('.pr-scard');
    const coach = {
      // The search weeks fold under their own row now (the one-look pass).
      cap: [...pc.querySelectorAll('.bhub-fold-grp')].some((g) => /searched for/.test((g.querySelector('.bhub-fold-lbl') || g).textContent)),
      opp: !!pc.querySelector('.pr-scard .st-cap.is-ok .st-tick'),
      insight: !!pc.querySelector('.pr-scard .st-cap.is-unk'),
      well: w ? getComputedStyle(w).borderStyle !== 'none' : false,
      apply: !!pc.querySelector('.pr-scard [data-act="applyPricingSuggestion"]'),
      radar: /* a past week never paints — the engine looks forward */ pc.querySelectorAll('.pr-radar .pr-rrow').length === 1 && /3/.test((pc.querySelector('.pr-rnums') || {}).textContent || ''),
      loading: !pc.querySelector('.pr-loading'),
    };
    window.apiGet = realGet;
    await openAccounts(); // back to Payments for the sections that follow
    return { coach };
  });
  ok(skin.coach.cap && skin.coach.opp && skin.coach.insight && skin.coach.well && skin.coach.apply && skin.coach.radar && skin.coach.loading,
    `the coach's ideas, capsules, Apply and search weeks now live on Manage → Pricing (${JSON.stringify(skin.coach)})`);

  // ---- 4. actions ----
  console.log('4. money actions');
  await page.evaluate(() => { pmClose(); pmRender(); });
  // a guest's row → their page → Open the booking → the hub's Money card
  await page.evaluate(() => { const r = document.querySelector('#pm-coming .pm-orow'); if (r) r.click(); });
  await page.waitForFunction(() => !!document.querySelector('#pm-detail [data-pm="hub"]'), null, { timeout: 8000 }).catch(() => {});
  await page.click('#pm-detail [data-pm="hub"]');
  await page.waitForFunction(() => /Owes Money/.test(((document.querySelector('#booking-hub-content .bhub-name')) || {}).textContent || ''), null, { timeout: 8000 }).catch(() => {});
  const hub = await page.evaluate(() => {
    const root = document.querySelector('#booking-hub-content') || document.getElementById('view-booking-hub');
    return {
      name: (root.querySelector('.bhub-name') || {}).textContent || '',
      hasRecord: /Record a payment/.test(root.textContent),
      hasInvoice: /Invoice \(PDF\)/.test(root.textContent),
      // The money folds to one line — the balance leads from the next-action banner.
      balance: /£490\.00 (due|balance)/.test((root.querySelector('.bhub-next') || {}).textContent || ''),
      moneyText: ((root.querySelector('.bhub-headpay') || { textContent: '' }).textContent || '').replace(/\s+/g, ' ').slice(0, 300),
    };
  });
  ok(hub.name === 'Owes Money' && hub.balance, `the guest's page opens the right hub, the balance on its banner (${hub.name})`);
  console.log('    money card: ' + hub.moneyText);
  ok(hub.hasRecord && hub.hasInvoice, 'hub Money card has Record a payment + Invoice');
  await page.evaluate(() => openAccounts());
  await page.waitForTimeout(500);
  // Record a payment from the guest's page: a sheet that is that guest's alone,
  // prefilled with what they owe, posting the CUMULATIVE set_payment (the cash
  // deposit only in full) with an op id.
  await page.evaluate(() => { pmOpen('stay:b1'); });
  await page.waitForFunction(() => !!document.querySelector('#pm-detail [data-pm="record"]'), null, { timeout: 8000 }).catch(() => {});
  await page.click('#pm-detail [data-pm="record"]');
  await page.waitForFunction(() => !!document.getElementById('pm-rec-amt'), null, { timeout: 8000 }).catch(() => {});
  const recSheet = await page.evaluate(() => ({ t: (document.getElementById('pm-sheet') || {}).textContent || '', amt: (document.getElementById('pm-rec-amt') || {}).value, choose: !!document.querySelector('#pm-sheet [data-pms="who"]') }));
  ok(/Record a payment from Owes/.test(recSheet.t) && recSheet.amt === '490.00' && !recSheet.choose, `the sheet is that guest's alone, prefilled with what they owe (${recSheet.amt})`);
  await page.click('#pm-sheet [data-pms="save"]');
  let paidPost = null;
  for (let i = 0; i < 60 && !paidPost; i++) { await page.waitForTimeout(100); paidPost = posts.find((p) => p.action === 'set_payment'); }
  ok(!!paidPost && paidPost.payment === 'paid' && paidPost.payment_method === 'Bank transfer' && paidPost.deposit_collected === true && /^\d{4}-\d{2}-\d{2}$/.test(paidPost.payment_date || '') && !!paidPost.op_id,
     `Record posts paid in full by bank transfer, the cash deposit with it, on the op ledger (${JSON.stringify(paidPost && { p: paidPost.payment, m: paidPost.payment_method, dep: paidPost.deposit_collected, op: !!paidPost.op_id })})`);
  // The updated-confirmation offer previews the email first — cancel it.
  await page.waitForTimeout(700);
  await page.evaluate(() => {
    const ov = document.getElementById('send-confirm-overlay');
    if (ov && ov.classList.contains('open')) document.getElementById('send-confirm-cancel').click();
    else try { glassDialogResolve(false); } catch (e) {}
  });
  await page.evaluate(() => { pmClose(); pmRender(); });
  await page.waitForFunction(() => ((document.querySelector('#pm-coming [data-fig="owe"]') || {}).textContent || '') === '£0.00', null, { timeout: 8000 }).catch(() => {});
  const pay2 = await owedNow();
  ok(pay2.fig === '£0.00' && pay2.rows.length === 0, `the guest leaves "Guests still to pay", and the figure drops to £0.00 (${pay2.fig})`);
  ok(pay2.tone === 'ok' && pay2.pill === 'Nothing to collect', `…and the pill reads all clear (${pay2.pill})`);

  // deposit return: Return £100 on its Needs-you row → glass prompt (amount) → confirm → posts return_deposit
  await page.evaluate(() => { const b = document.querySelector('#pm-list [data-pm="return"][data-arg="b3"]'); if (b) b.click(); });
  await page.waitForTimeout(800);
  await page.evaluate(() => { const i = document.getElementById('glass-dialog-input'); if (i) i.value = '100'; glassDialogResolve(true); });
  await page.waitForTimeout(800);
  await page.evaluate(() => glassDialogResolve(true)); // confirm step
  let retPost = null;
  for (let i = 0; i < 40 && !retPost; i++) { await page.waitForTimeout(100); retPost = posts.find((p) => p.action === 'return_deposit'); }
  ok(!!retPost && Number(retPost.amount) === 100, `Return £100 on its row posts £100 back (${JSON.stringify(retPost && { amt: retPost.amount })})`);

  // 4b) THE OWNER IS TOLD WHETHER THE GUEST WAS TOLD. The endpoint mails the guest
  // best-effort and hands the outcome back as `email: {ok, error}`; the client threw
  // the response away and toasted "Deposit return issued." unconditionally. On a
  // PARTIAL return that email is the only place the guest ever learns why the rest was
  // kept, so with SMTP down the money moved, the owner believed they had been told, and
  // the reason existed nowhere. Driven through the real dialogs with a real failure.
  // THE FIRST RETURN RE-READ THE BOOKING: the page used to go on saying "still held"
  // with Return on offer. It reads the server's 'returned' state — so to drive a
  // SECOND return the fixture's deposit is put back first.
  await page.waitForTimeout(500);
  const after1 = await page.evaluate(() => { const b = findBookingById('b3'); return { hs: b ? b.holdStatus : '(none)', row: [...document.querySelectorAll('#pm-list .pm-needrow')].some((r) => /Left Deposit/.test(r.textContent)) }; });
  ok(after1.hs === 'returned' && !after1.row, `after a return the booking is re-read and leaves Needs you (${after1.hs})`);
  { const r3 = rows.find((x) => x.id === 3); if (r3) r3.hold_status = 'charged'; }
  await page.evaluate(() => loadData());
  mailWillFail = true;
  const ret2 = page.evaluate(() => returnDeposit('b3'));
  await page.waitForTimeout(700);
  await page.evaluate(() => { const i = document.getElementById('glass-dialog-input'); if (i) i.value = '25'; glassDialogResolve(true); });
  await page.waitForTimeout(500);
  // The reason step (a partial return asks for one), then the confirm.
  await page.evaluate(() => { const i = document.getElementById('glass-dialog-input'); if (i) i.value = 'broken lamp'; glassDialogResolve(true); });
  await page.waitForTimeout(500);
  await page.evaluate(() => glassDialogResolve(true));
  await ret2.catch(() => {});
  await page.waitForTimeout(700);
  const said = await page.evaluate(() => {
    const dd = document.getElementById('glass-dialog');
    const shown = !!(dd && getComputedStyle(dd).display !== 'none');
    const txt = (document.getElementById('glass-dialog-msg') || {}).innerText || '';
    return { shown, txt };
  });
  ok(said.shown && /didn't send/i.test(said.txt),
    `a failed guest email is REPORTED, not toasted as success (${said.txt.slice(0, 70)})`);
  ok(/reason/i.test(said.txt) && /have not seen it/i.test(said.txt),
    `…and names the retention reason as the thing they have not seen (${said.txt.slice(-80)})`);
  mailWillFail = false;
  await page.evaluate(() => { const dd = document.getElementById('glass-dialog'); if (dd) glassDialogResolve(true); });
  await page.waitForTimeout(300);
  // (The cottage-pill-under-three-chips check went with the Payments & balances rows:
  // a guest's row names the cottage in its sub-line, beside a dot, with nothing to crush it.)

  // ---- 5. back navigation ----
  console.log('5. back navigation');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  await page.evaluate(() => { accountsShowIndex(); accountsOpen('income'); });
  await page.waitForTimeout(500);
  const slid = await page.evaluate(() => document.getElementById('pm').classList.contains('is-detail'));
  await page.evaluate(() => { const b = document.querySelector('#pm-detail [data-pm="close"]'); if (b) b.click(); });
  await page.waitForTimeout(500);
  const nav2 = await page.evaluate(() => ({ detail: document.getElementById('pm').classList.contains('is-detail'), list: document.getElementById('pm-list').getClientRects().length > 0 }));
  ok(slid && !nav2.detail && nav2.list, 'on a phone a detail page slides over the list, and its back link takes it away again');
  await page.evaluate(() => accountsOpen('expenses'));
  await page.waitForTimeout(400);
  await page.evaluate(() => accountsShowIndex());
  await page.waitForTimeout(400);
  const nav3 = await page.evaluate(() => ({
    idxShown: document.getElementById('accounts-index').style.display !== 'none',
    panelHidden: document.getElementById('accounts-panel').style.display === 'none',
  }));
  ok(nav3.idxShown && nav3.panelHidden, 'the expenses drill-down Back restores the Payments page');
  await page.setViewportSize({ width: 1280, height: 950 });
  await page.waitForTimeout(300);

  // ---- 6. the books say what the profit figure actually COVERS ----
  // A confident number implies a completeness it doesn't have: with no expenses
  // logged it's really income less card fees, and platform (Airbnb) payouts never
  // reach this ledger at all, so neither that income nor the commission on it is in
  // the figure. Both have to be stated on the page (accountsScopeCaveats, the one
  // definition the books page, the PDF and the CSV share).
  console.log('6. scope caveats on the books page');
  const notes = async (fn) => page.evaluate(async (f) => {
    // eslint-disable-next-line no-eval
    eval(f);
    pmOpen('books');
    await new Promise((r) => setTimeout(r, 150));
    return ((document.querySelector('#pm-detail .pm-dbody') || {}).textContent || '').replace(/\s+/g, ' ');
  }, fn);
  const scope0 = await notes('');
  // This suite's books carry a £120 expense, so the expenses caveat must NOT show —
  // the check that the note is conditional and not just always printed.
  ok(!/No expenses are logged/i.test(scope0), 'with expenses logged, the "no expenses" caveat is absent');
  const scope1 = await notes("Object.keys(__pmBooks).forEach((k) => { if (__pmBooks[k]) __pmBooks[k] = Object.assign({}, __pmBooks[k], { expenses: 0 }); });");
  ok(/No expenses are logged/i.test(scope1), 'with NO expenses logged, the page says so instead of implying full profit');
  ok(/income less card fees/i.test(scope1), 'and says what the figure really is (income less card fees)');
  const scope2 = await notes("Object.keys(dbBlocks).forEach((k) => delete dbBlocks[k]); dbBlocks['21a'] = [{ checkIn: '" + TY + "-08-01', checkOut: '" + TY + "-08-05', source: 'airbnb' }];");
  ok(/booking platform/i.test(scope2), 'an imported platform stay in the year is disclosed as not counted');
  ok(/commission/i.test(scope2), 'and the uncounted commission is named too');
  // An OWNER block is not a booking and must not trigger the platform caveat.
  const scope3 = await notes("Object.keys(dbBlocks).forEach((k) => delete dbBlocks[k]); dbBlocks['21a'] = [{ checkIn: '" + TY + "-08-01', checkOut: '" + TY + "-08-05', source: 'owner' }];");
  ok(!/booking platform/i.test(scope3), 'an owner block is not a platform booking, so no such caveat');
  await page.evaluate(() => { Object.keys(dbBlocks).forEach((k) => delete dbBlocks[k]); pmClose(); });

  // ---- 7. Move money out — REMOVED (owner's ask: "no longer needed"). ----
  // Its ring fence, per-payment movable figures, typed balance and "I've moved it out"
  // went with the screen; the arithmetic stays gated by test-sweep / test-payouts. What
  // remains on the page is With Square and its "Check Square now", gated in §8 below.

  // ── THE LOCATION PICKER, opened the way an owner opens it ──────────────────────
  // It first read __sweepLiab — the Move-money-out screen's cache — so opening Manage →
  // Payments directly left it null and the card hid itself EVERY time. Reported live as
  // "where's locations?". Driven through openArea/settingsOpen rather than by calling
  // the renderer, because calling the renderer is exactly what hid the bug.
  console.log('8. the Square location picker');
  sqLocations = [{ id: 'L1', name: 'Online CHB', status: 'ACTIVE' }, { id: 'L2', name: 'The Shop', status: 'ACTIVE' }];
  sqLocation = '';
  await page.evaluate(async () => { await openArea(); settingsOpen('payments'); });
  await page.waitForTimeout(1000);
  // MEASURE WHAT IS ON SCREEN, NOT THE FLAG. This read `!card.hidden`, and a
  // missing `>` on the card's own tag (`… id="sq-loc-card" hidden` then straight
  // into its first child) meant the browser swallowed the attribute into the tag
  // and `hidden` was never applied — so EVERY owner, including one with no Square
  // at all, met "Your Square account has more than one location" over an empty
  // dropdown and a live Save that wrote an empty location and reported success.
  // Asserting the flag is precisely what let that ship: the flag said hidden while
  // the card painted. Ask the CONTROLS whether they are rendered.
  const vis = () => page.evaluate(() => {
    const on = (el) => !!el && el.getClientRects().length > 0;
    const sel = document.getElementById('sq-location');
    // The control on screen is the site's own row button; the select only holds
    // the value (a native <select> opened the phone's menu, not the site's).
    const pick = document.getElementById('sq-loc-pick');
    return {
      shown: on(pick),
      opts: sel ? [...(/** @type {HTMLSelectElement} */ (sel)).options].map((o) => o.textContent.trim()) : [],
    };
  });
  const pick = await vis();
  ok(pick.shown, 'with two locations the picker is ON SCREEN in Manage → Payments');
  ok(pick.opts.some((t) => /Online CHB/.test(t)) && pick.opts.some((t) => /The Shop/.test(t)),
    `…listing every location (${pick.opts.join(' | ')})`);
  ok(pick.opts.some((t) => /main location/i.test(t)), '…plus the unset option, which is what Square does today');
  // THE PICKER IS THE SITE'S: tapping the row opens a sheet in the house style
  // (never the phone's native menu), and choosing a location there saves it.
  const sheet = await page.evaluate(async () => {
    document.getElementById('sq-loc-pick').click();
    await new Promise((r) => setTimeout(r, 200));
    const ov = document.getElementById('sq-loc-modal');
    const opts = [...document.querySelectorAll('#sql-list .sql-opt')].map((b) => b.textContent.trim());
    const native = !!document.querySelector('#sq-loc-card select:not([hidden])');
    return { open: !!ov && ov.classList.contains('open'), opts, native };
  });
  ok(sheet.open && !sheet.native, 'tapping Location opens the site\'s own sheet, not a native menu');
  ok(sheet.opts.some((t) => /The Shop/.test(t)) && sheet.opts.some((t) => /Main location/.test(t)), `…listing every location (${sheet.opts.join(' | ')})`);
  const before = posts.length;
  sqLocation = 'L2'; // what the server answers once the save has landed
  await page.evaluate(async () => {
    const b = [...document.querySelectorAll('#sql-list .sql-opt')].find((x) => /The Shop/.test(x.textContent));
    b.click();
    await new Promise((r) => setTimeout(r, 600));
  });
  const tapped = await page.evaluate(() => ({ closed: !document.getElementById('sq-loc-modal').classList.contains('open'), cur: (document.getElementById('sq-loc-cur') || {}).textContent }));
  ok(posts.slice(before).some((p) => JSON.stringify(p).includes('square-location') && JSON.stringify(p).includes('L2')), 'choosing a location in the sheet saves it');
  ok(tapped.closed && /The Shop/.test(tapped.cur), `…closes the sheet and the row shows the choice (${tapped.cur})`);

  // …AND WITH NOTHING TO CHOOSE BETWEEN, IT IS NOT THERE AT ALL. One location
  // cannot be the wrong one, so a picker would be a question with one answer —
  // and the card's prose asserts "more than one location", which would be false.
  // This negative is the case the unclosed tag broke and nothing tested.
  sqLocations = [{ id: 'L1', name: 'Online CHB', status: 'ACTIVE' }];
  sqLocation = '';
  await page.evaluate(async () => { await openArea(); settingsOpen('payments'); });
  await page.waitForTimeout(1000);
  const one = await vis();
  ok(!one.shown, 'a single-location seller is shown no picker at all');
  // And with Square off entirely there is nothing to say either.
  sqLocations = [];
  await page.evaluate(async () => { await openArea(); settingsOpen('payments'); });
  await page.waitForTimeout(1000);
  const none = await vis();
  ok(!none.shown, '…nor is an owner with no Square locations reported at all');
  sqLocations = [{ id: 'L1', name: 'Online CHB', status: 'ACTIVE' }, { id: 'L2', name: 'The Shop', status: 'ACTIVE' }];
  await page.evaluate(async () => { await openArea(); settingsOpen('payments'); });
  await page.waitForTimeout(1000);

  // Choosing one saves it and re-reads, so the money screens stop describing the old shop.
  sqLocation = 'L1';
  const saved = await page.evaluate(async () => {
    const sel = /** @type {HTMLSelectElement} */ (document.getElementById('sq-location'));
    sel.value = 'L1';
    await saveSquareLocation();
    await new Promise((r) => setTimeout(r, 600));
    return (document.getElementById('sq-loc-msg') || {}).textContent || '';
  });
  ok(/Saved/i.test(saved) && /read(s|ing)? this location|now read this location/i.test(saved),
    `saving reports what it DID, not another button to press (${saved.slice(0, 70)})`);
  ok(posts.some((p) => JSON.stringify(p).includes('square-location')), 'the choice is written to square-location');
  ok(posts.some((p) => p.__url === 'square-setup.php' && p.action === 'payouts_refresh'),
    'and Square is re-read at once, so stale figures for the old location do not linger');

  // …AND WHEN THE RE-READ FAILS, THE SAVE MUST NOT CLAIM IT WORKED. The old
  // endpoint answered 200-with-error, this call site swallowed it, and the
  // message read "the money screens now read this location" over figures still
  // describing the old shop. Driven against the endpoint's real 502.
  refreshFails = true;
  const savedFail = await page.evaluate(async () => {
    const sel = /** @type {HTMLSelectElement} */ (document.getElementById('sq-location'));
    sel.value = 'L2';
    await saveSquareLocation();
    await new Promise((r) => setTimeout(r, 600));
    return (document.getElementById('sq-loc-msg') || {}).textContent || '';
  });
  ok(/Saved/.test(savedFail) && !/now read this location/.test(savedFail),
    `a failed re-read never claims the screens follow the new location (${savedFail.slice(0, 60)}…)`);
  ok(/couldn/i.test(savedFail) && /Check Square now/.test(savedFail),
    '…it says what failed and names the control that retries it');
  // The explicit "Check Square now" tap surfaces the server's own sentence —
  // not a generic connection line, and never a false "Payouts up to date".
  // "Check Square now" lives on the Payments page's With Square page now (Move money
  // out, where it first sat, is gone): tapped there, it is the control the save names.
  const toastSaid = await page.evaluate(async () => {
    await openAccounts();
    pmOpen('way');
    await new Promise((r) => setTimeout(r, 300));
    const btn = document.querySelector('#pm-detail [data-pm="check"]');
    let said = '';
    const t = window.toast;
    window.toast = (m, kind) => { said = String(m || ''); return t ? t(m, kind) : undefined; };
    if (btn) btn.click();
    for (let i = 0; i < 40 && !said; i++) await new Promise((r) => setTimeout(r, 100));
    window.toast = t;
    pmClose();
    return { said, label: btn ? btn.textContent.trim() : '' };
  });
  ok(toastSaid.label === 'Check Square now', `the With Square page carries "Check Square now", the control the save names (${toastSaid.label})`);
  ok(/Square couldn\u2019t be reached/.test(toastSaid.said) || /Square couldn’t be reached/.test(toastSaid.said),
    `the refusal reaches the owner in the server's own words (${toastSaid.said.slice(0, 60)})`);
  ok(!/Square checked|Payouts up to date/.test(toastSaid.said), '…and a failure is never reported as checked');
  refreshFails = false;

  // ONE location is not a choice, so there is no control to get wrong.
  sqLocations = [{ id: 'L1', name: 'Online CHB', status: 'ACTIVE' }];
  await page.evaluate(async () => { await loadSquareWebhookStatus(); });
  await page.waitForTimeout(500);
  ok(!(await page.evaluate(() => { const c = document.getElementById('sq-loc-card'); return !!c && !c.hidden; })),
    'a single-location seller is never asked which location this is');

  console.log(fails ? `MONEY CHECK FAILED ❌ (${fails})` : 'MONEY CHECK PASSED ✅');
  await done(fails);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
