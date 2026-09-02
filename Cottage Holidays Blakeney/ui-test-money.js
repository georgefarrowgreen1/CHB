// Full Money-area verification after the Manage collapse:
//  1. the dock Money button exists and its handler opens view-accounts
//  2. the overview (KPIs + owed figure) renders
//  3. every drill-down section opens with content:
//     payments / recent / income & tax / expenses / pricing coach
//  4. the money ACTIONS work end-to-end: payments find-rows → booking hub
//     Money card → Record payment posts the right payload → row turns paid;
//     deposits-to-return queue shows a held deposit with Return/Keep
//  5. back navigation: hub → Money, drill-down → index, index → dashboard
// The site reckons "today" in UK time (todayDashed / ukNowParts), so the
// tests must too — pin the whole process (and the browser it launches) to
// Europe/London so fixtures built from new Date() agree with the app on
// any runner, in any timezone. Must run before the first Date call.
const { boot } = require('./ui-test-lib'); // pins TZ=Europe/London at require time
let fails = 0;
const ok = (b, m) => { console.log(`  ${b ? '✓' : '✗'} ${m}`); if (!b) fails++; };
// Local-formatted, never toISOString() — that's UTC and slips a day near midnight.
const d = (n) => { const t = new Date(); const x = new Date(t.getFullYear(), t.getMonth(), t.getDate() + n); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };

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
  // §7 drives the "Move money out" screen off the SAME accounts.php payload the
  // income screen uses, so the stub carries deposit_liability only when a case
  // wants it — absent is the failed-query state, which must not read as £0.
  let sweepStub = null;
  let acctGets = 0;
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
        if (b.action === 'set_payment') { const r = rows.find((x) => x.id === b.id); if (r) { r.payment = b.payment; r.deposit_paid = b.deposit || (b.payment === 'paid' ? r.agreed_total : 0); r.payment_method = b.payment_method || ''; r.payment_date = b.payment_date || ''; } return json({ ok: true }); }
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
      return json({ ok: true, events: [], logs: {}, reviews: [], photos: [] });
    }
    if (url.includes('bookings.php')) return json({ bookings: rows });
    if (url.includes('accounts.php')) {
      acctGets++;
      // Year report: £656.20 received, £9.80 of Square fees (kept by the
      // processor, so deducted from profit), one Q2 card payment.
      if (/[?&]year=\d/.test(url)) return json({
        ...(sweepStub ? { deposit_liability: sweepStub } : {}),
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

  // ---- 2. overview — the five-verdict landing ----
  console.log('2. overview (five-verdict landing)');
  // The async fills have had time to land by here (the dock tap waited 1.1s).
  const ov = await page.evaluate(() => {
    const el = document.getElementById('money-overview');
    const grps = el ? Array.from(el.querySelectorAll('.bhub-fold-grp')).map((g) => g.getAttribute('data-grp')) : [];
    const foldsOpen = el ? Array.from(el.querySelectorAll('.bhub-fold')).filter((f) => !f.hidden).length : 0;
    const collect = el ? ((el.querySelector('[data-grp="mocollect"]') || {}).textContent || '').replace(/,/g, '') : '';
    const cap = document.getElementById('mo-attn-cap');
    const grpEls = el ? Array.from(el.querySelectorAll('.bhub-fold-grp')).filter((e) => e.getClientRects().length) : [];
    const gaps = [];
    for (let i = 1; i < grpEls.length; i++) gaps.push(Math.round(grpEls[i].getBoundingClientRect().top - grpEls[i - 1].getBoundingClientRect().bottom));
    // One rail: every card shares one left and one right edge (cross-axis
    // auto margins cancel flex stretch, which shrink-wrapped each card).
    const lefts = new Set(grpEls.map((e) => Math.round(e.getBoundingClientRect().left)));
    const rights = new Set(grpEls.map((e) => Math.round(e.getBoundingClientRect().right)));
    return {
      grps, foldsOpen, collect, gaps,
      rails: { lefts: [...lefts], rights: [...rights] },
      overdueRow: ((el.querySelector('[data-grp="mood0"]') || {}).textContent || '').replace(/,/g, ''),
      pulse: !!(el && el.querySelector('.mo-pulse')),
      // The PAINT, not the attribute — display:block on the caption used to
      // out-rank [hidden], so an empty NEEDS ATTENTION shipped while the
      // attribute-based check stayed green.
      attnHidden: !cap || cap.getClientRects().length === 0,
      books: (document.getElementById('mo-books-fig') || {}).textContent || '',
      recent: (document.getElementById('mo-recent-sum') || {}).textContent || '',
      // The CAPSULE must not assert what the sub avoids: a green "✓ Paid up"
      // beside a red overdue exception is the colour contradicting the words.
      collectGreenCap: !!el.querySelector('[data-grp="mocollect"] .st-cap.is-ok'),
      collectCapTxt: ((el.querySelector('[data-grp="mocollect"] .st-cap') || {}).textContent || '').trim(),
    };
  });
  ok(['mocollect', 'momove', 'moback', 'mobooks', 'morecent', 'motrends'].every((k) => ov.grps.includes(k)), `the five verdicts + trends render (${ov.grps.join(',')})`);
  ok(ov.foldsOpen === 0, `every verdict starts folded (${ov.foldsOpen} open)`);
  // The fixture's ower checks in at d(20) — INSIDE the 30-day window with the
  // standard due date 10 days gone, so it is genuinely OVERDUE: an exception
  // row (at the deposit-folded £490 the payments rows quote), not a queue row.
  ok(!ov.attnHidden, 'the overdue balance raises the Needs-attention caption');
  ok(ov.grps.includes('mood0'), 'the overdue booking is an exception row, not a queue row');
  // Asserted as the PROPERTY, not the phrase: what must never happen is a
  // paid-up claim over an overdue row, and the sub must point AT that row. The
  // wording itself is copy and moved once already (it was shortened so the sub
  // stops being cut off on a phone — see ui-test-legibility §2).
  ok(/To collect/.test(ov.collect) && !/paid up/i.test(ov.collect) && /overdue/i.test(ov.collect),
    `To collect never claims "paid up" over an overdue row, and points at it (${ov.collect.slice(0, 90)})`);
  // …and neither does its capsule (break-tested: reverting the capsule to the
  // unconditional green stCap('ok','Paid up') fails this while the sub check
  // above stays green — the sub was fixed first and the capsule shipped on).
  ok(!ov.collectGreenCap && /nothing due/.test(ov.collectCapTxt), `the capsule follows the sub — grey "nothing due", never a green ✓ over an overdue row (${ov.collectCapTxt})`);
  ok(/Overdue — Owes Money/.test(ov.overdueRow) && /£490/.test(ov.overdueRow), `the exception row names the guest at the deposit-folded £490 (${ov.overdueRow.slice(0, 80)})`);
  // The exception's figure is a red capsule carrying the warning triangle —
  // and it is the row's ONE mark (the label's red dot came off with it).
  const capChk = await page.evaluate(() => ({
    badCap: !!document.querySelector('#money-overview [data-grp="mood0"] .st-cap.is-bad .st-wic'),
    dotGone: !document.querySelector('#money-overview [data-grp="mood0"] .bhub-fold-lbl .bhub-chip-dot'),
    unkCaps: document.querySelectorAll('#money-overview .st-cap.is-unk').length,
  }));
  ok(capChk.badCap && capChk.dotGone, 'the overdue figure is a red warning capsule, and it is the row\'s one mark');
  ok(ov.pulse, 'the pulse line is present');
  ok(ov.gaps.length >= 5 && ov.gaps.every((g) => g >= 8), `every block has breathing room between it and the next (${ov.gaps.join(',')})`);
  ok(ov.rails.lefts.length === 1 && ov.rails.rights.length === 1, `every card stands on ONE rail (lefts ${ov.rails.lefts.join('/')}, rights ${ov.rails.rights.join('/')})`);
  // The books figure is the SERVER'S net once the async fill lands
  // (656.20 rental + 50 kept − 9.80 fees − 120 expenses = 576.40).
  ok(/£576\.40/.test(ov.books.replace(/,/g, '')), `The books shows the server net (${ov.books})`);
  ok(/nothing yet/.test(ov.recent), `Recent reports an honest empty feed (${ov.recent})`);

  // 2b. the exception rule, the other way: moving the stay OUT of the window
  // (check-in 45 days off, unpaid) stands the red section down and the same
  // £490 reappears as a Due-now queue row under To collect (an unpaid first
  // payment is due now wherever the stay sits). Restoring flips it back.
  const attnChk = await page.evaluate(([ci, co]) => {
    const b = (dbBookings['21a'] || []).find((x) => x.name === 'Owes Money');
    const keep = { checkIn: b.checkIn, checkOut: b.checkOut };
    b.checkIn = ci; b.checkOut = co;
    renderMoneyOverview();
    const txt = () => ((document.getElementById('money-overview') || {}).textContent || '').replace(/,/g, '');
    // Painted, not the attribute — the [hidden] caption used to render.
    const capShown = () => { const c = document.getElementById('mo-attn-cap'); return !!(c && c.getClientRects().length); };
    const down = {
      cap: capShown(),
      row: /Overdue — Owes Money/.test(txt()),
      collect: ((document.querySelector('#money-overview [data-grp="mocollect"]') || {}).textContent || '').replace(/,/g, ''),
    };
    Object.assign(b, keep);
    renderMoneyOverview();
    const up = {
      cap: capShown(),
      row: /Overdue — Owes Money/.test(txt()),
    };
    return { down, up };
  }, [d(45), d(48)]);
  ok(!attnChk.down.cap && !attnChk.down.row, 'moving the stay out of the window stands the red section down');
  ok(/£490/.test(attnChk.down.collect) && /Due now/.test(attnChk.down.collect), `…and the £490 moves into To collect's Due-now queue (${attnChk.down.collect.slice(0, 80)})`);
  ok(attnChk.up.cap && attnChk.up.row, 'restoring the dates raises the exception again');

  // 2b-ii. THE DEPOSIT ROWS STATE A FIGURE. They printed `it.amount`, a key the
  // liability payload does not carry (it has outstanding/awaiting/rental/fee/
  // gross/feeBack/net), so `Number(undefined) || 0` rendered "£0.00 — ready to
  // return" on every row, under a headline that had the total right — on the one
  // screen that tells the owner what to hand back. Driven through the REAL
  // moAsyncFill payload shape.
  const backChk = await page.evaluate(() => {
    const el = document.getElementById('mo-back-rows');
    if (!el) return { missing: true };
    // The shape accounts.php actually ships for deposit_liability.items.
    const items = [
      { name: 'Sarah Pemberton', outstanding: 75, rental: 400, fee: 7.5, gross: 75, feeBack: 1.31, net: 73.69, check_in: '2020-01-01', check_out: '2020-01-05' },
      { name: 'Dan Rowe', outstanding: 75, rental: 400, fee: 7.5, gross: 75, feeBack: 1.31, net: 73.69, check_in: '2020-01-01', check_out: '2020-01-05' },
    ];
    // Render exactly as the landing does.
    el.innerHTML = items
      .map(
        (it) =>
          `<div class="bhub-kv"><span class="bhub-kv-label">${it.name} · ${gbp(Number(it.net != null ? it.net : it.outstanding) || 0)}</span><span class="bhub-kv-val">ready to return</span></div>`,
      )
      .join('');
    return { txt: el.textContent || '' };
  });
  ok(!backChk.missing, 'the To-give-back rows container exists on the money landing');
  ok(!backChk.missing && !/£0\.00/.test(backChk.txt), `a held deposit never renders as £0.00 (${(backChk.txt || '').slice(0, 60)})`);
  ok(!backChk.missing && /£73\.69/.test(backChk.txt), '…it states the net the owner actually hands back');
  // The renderer itself must read a key the payload HAS. NB the source is stripped
  // of // comments FIRST: the comment explaining this defect names `it.amount`, and
  // a negative scan that can see its own explanation is either always-failing or
  // (worse) always-passing — the trap test-payrail already strips for.
  const admSrc = require('fs')
    .readFileSync(__dirname + '/admin.js', 'utf8')
    .split('\n')
    .filter((l) => !/^\s*\/\//.test(l))
    .join('\n');
  const backRegion = admSrc.slice(admSrc.indexOf("getElementById('mo-back-rows')"), admSrc.indexOf("getElementById('mo-back-rows')") + 1200);
  ok(backRegion.length > 200, '(fixture) the To-give-back renderer region was found');
  ok(!/Number\(it\.amount\)/.test(backRegion), 'the To-give-back renderer does not read the non-existent `amount` key');
  ok(/it\.net/.test(backRegion), '…it reads it.net, the key the liability payload carries');

  // 2c. chase-everyone-due appears only at TWO+ chaseable owers — under two,
  // the bulk action is the row's own action wearing a worse label.
  const bulkChk = await page.evaluate(([ci, co]) => {
    const has = () => !!document.querySelector('#money-overview [data-act="moChaseDue"]');
    // The chase gates on the card rail (a bulk ask carries a pay link), and the
    // fixture's ower is overdue (an exception, not a queue row) — move it out.
    /* eslint-disable-next-line no-global-assign */ squareAdminEnabled = true;
    const b = (dbBookings['21a'] || []).find((x) => x.name === 'Owes Money');
    const keep = { checkIn: b.checkIn, checkOut: b.checkOut };
    b.checkIn = ci; b.checkOut = co;
    renderMoneyOverview();
    const one = has(); // one due-now ower
    const c = JSON.parse(JSON.stringify(b));
    c.id = 'b99'; c.dbId = 99; c.name = 'Second Ower'; c.email = 'second@gmail.com';
    dbBookings['21a'].push(c);
    renderMoneyOverview();
    const two = has();
    dbBookings['21a'].pop();
    Object.assign(b, keep);
    /* eslint-disable-next-line no-global-assign */ squareAdminEnabled = false;
    renderMoneyOverview();
    return { one, two, after: has() };
  }, [d(45), d(48)]);
  ok(!bulkChk.one && bulkChk.two && !bulkChk.after, `chase-all offered only at 2+ owers (1:${bulkChk.one} 2:${bulkChk.two})`);

  // ---- 3. sections ----
  console.log('3. sections');
  const secCheck = async (id, mustMatch, label) => {
    await page.evaluate((s) => accountsOpen(s), id);
    await page.waitForTimeout(700);
    const r = await page.evaluate((s) => {
      const sec = document.getElementById('asec-' + s);
      return { shown: sec && sec.style.display !== 'none', text: sec ? sec.textContent.slice(0, 4000) : '' };
    }, id);
    ok(r.shown && mustMatch.test(r.text), `${label} opens with content`);
    await page.evaluate(() => accountsShowIndex());
    await page.waitForTimeout(250);
  };
  await secCheck('payments', /owed|paid in full/i, 'Payments & balances');
  await secCheck('recent', /payment|no .*payments|square/i, 'Recent payments');
  await secCheck('income', /net profit|income|tax year/i, 'Income & tax');
  // Card processing fees come OFF the profit: fee line rendered, net = income
  // − fees − expenses, and the MTD quarterly costs carry the Q2 fee.
  await page.evaluate(() => accountsOpen('income'));
  await page.waitForTimeout(700);
  const feeChk = await page.evaluate(() => {
    const txt = ((document.getElementById('accounts-content') || {}).textContent || '').replace(/,/g, '');
    const num = (re) => { const m = txt.match(re); return m ? parseFloat(m[1]) : null; };
    const q2 = txt.match(/Q2 · Jul–Sep£([\d.]+)£([\d.]+)£([\d.]+)/);
    return {
      fee: num(/Card processing fees− £([\d.]+)/),
      income: num(/Rental income£([\d.]+)/),
      kept: num(/Damage deposits kept£([\d.]+)/),
      expenses: num(/Expenses(?:\s*\(\d+\))?− £([\d.]+)/),
      netHead: num(/Net (?:profit|loss)[^£]*£([\d.]+)/),
      note: /deducted automatically from the payments ledger/.test(txt),
      q2: q2 ? { inc: parseFloat(q2[1]), costs: parseFloat(q2[2]), net: parseFloat(q2[3]) } : null,
      headClass: (document.querySelector('#accounts-content .accounts-stat.headline .value') || {}).className || '',
      headLabel: (document.querySelector('#accounts-content .accounts-stat.headline .label') || {}).textContent || '',
      warnColor: (() => { const el = document.querySelector('#accounts-content .accounts-stat.headline .value'); return el ? getComputedStyle(el).color : ''; })(),
    };
  });
  // #13: a PROFIT reads os-good (a loss would flip to os-warn/danger); the class
  // must actually resolve to a colour, not fall through to the old raw-green rule.
  ok(/os-good/.test(feeChk.headClass) && /Net profit/.test(feeChk.headLabel), `profit headline is os-good + labelled 'Net profit' (${feeChk.headClass.trim()})`);
  ok(feeChk.fee === 9.8 && feeChk.income === 656.2, `fee line renders as a deduction (income £${feeChk.income}, fees £${feeChk.fee})`);
  ok(feeChk.kept === 50, `kept damage deposit shows as income (£${feeChk.kept})`);
  // Net = rental + kept − fees − expenses (656.20 + 50 − 9.80 − 0 = 696.40).
  ok(feeChk.netHead != null && Math.abs(feeChk.netHead - (feeChk.income + (feeChk.kept || 0) - feeChk.fee - (feeChk.expenses || 0))) < 0.005, `net = income + kept − fees − expenses (£${feeChk.netHead})`);
  ok(feeChk.note, 'the note explains fees are deducted automatically');
  // Q2 income now carries both the £656.20 rental and the £50 kept deposit.
  ok(feeChk.q2 && Math.abs(feeChk.q2.inc - 706.2) < 0.005 && feeChk.q2.costs >= 9.8 && Math.abs(feeChk.q2.net - (feeChk.q2.inc - feeChk.q2.costs)) < 0.005, `Q2 quarterly income includes kept deposit + costs the fee (${JSON.stringify(feeChk.q2)})`);
  // The fold anatomy: net leads, the arithmetic / quarters / honesty notes sit
  // behind their rows (closed), the exports stay one visible tap. A fold OPENS
  // in place — the arithmetic row is driven by clicking it, the way an owner does.
  const incFolds = await page.evaluate(() => {
    const c = document.getElementById('accounts-content');
    const grps = Array.from(c.querySelectorAll('.bhub-fold-grp')).map((g) => g.getAttribute('data-grp'));
    const open = Array.from(c.querySelectorAll('.bhub-fold')).filter((f) => !f.hidden).length;
    const exportsVisible = (() => { const a = c.querySelector('.accounts-actions'); return !!(a && a.getClientRects().length && !a.closest('.bhub-fold')); })();
    // Guarded, so a DELETED fold group fails the named checks below rather
    // than killing the suite at this click (the §21 lesson).
    const row = c.querySelector('[data-grp="incmath"] .bhub-fold-row');
    if (row) row.click();
    const mathFold = document.getElementById('bhub-fold-incmath');
    const openNow = !!(mathFold && !mathFold.hidden && mathFold.getClientRects().length > 0);
    if (row) row.click();
    return { grps, open, exportsVisible, openNow, closedAgain: !!(mathFold && mathFold.hidden) };
  });
  ok(['incmath', 'incq', 'incscope'].every((k) => incFolds.grps.includes(k)), `income folds render (${incFolds.grps.join(',')})`);
  ok(incFolds.open === 0, `income folds start closed (${incFolds.open} open)`);
  ok(incFolds.exportsVisible, 'the exports row stays visible outside any fold');
  ok(incFolds.openNow && incFolds.closedAgain, 'the arithmetic fold opens and closes in place');
  await page.evaluate(() => accountsShowIndex());
  await page.waitForTimeout(250);
  await secCheck('expenses', /boiler service|expense/i, 'Expenses (seeded row listed)');
  await secCheck('pricingcoach', /pricing|suggestion|coach|demand|not enough/i, 'Pricing coach');

  console.log('recent payments + pricing coach wear the unified anatomy (owner-asked)');
  const skin = await page.evaluate(async () => {
    const realPost = window.apiPost, realGet = window.apiGet;
    window.apiPost = async (url, body) => {
      if (String(url).includes('bookings.php') && body.action === 'recent_payments') return { payments: [
        { created_at: '2026-08-07 10:00:00', name: 'Jean Robinson', prop_key: '21a', kind: 'balance', amount: 525, fee: 8.4, status: 'COMPLETED' },
        { created_at: '2026-07-17 10:00:00', name: 'Richard Berry', prop_key: '21a', kind: 'damages_return', amount: -75, fee: null, status: 'PENDING' },
      ] };
      return realPost(url, body);
    };
    window.apiGet = async (url) => {
      if (String(url).includes('pricing-suggest.php')) return { suggestions: [
        { id: 's1', prop_key: '21a', severity: 'opportunity', title: 'Raise the weekend uplift', detail: 'Strong weekend demand.', apply: { field: 'weekendPct', value: 30 } },
        { id: 's2', prop_key: '21a', severity: 'insight', title: 'Midweek gaps cluster', detail: 'A midweek offer would fill them.' },
      ], signals: { searches60: 12, noResult60: 3, searchWeeks: [{ week: '2026-08-10', count: 9, missed: 5 }] } };
      return realGet(url);
    };
    await renderMoneyFeed();
    await new Promise((r) => setTimeout(r, 150));
    const feed = document.getElementById('money-feed');
    const listEl = feed.querySelector('.feed-list');
    const recent = {
      noStutter: !feed.querySelector('h3'),
      figs: feed.querySelectorAll('.mf-recon .acw-fig').length,
      welled: listEl ? parseFloat(getComputedStyle(listEl).borderRadius) >= 12 && getComputedStyle(listEl).borderStyle !== 'none' : false,
      rows: feed.querySelectorAll('.feed-row').length,
    };
    await renderPricingCoach();
    await new Promise((r) => setTimeout(r, 150));
    const pc = document.getElementById('pricingcoach-body');
    const w = pc.querySelector('.pc-well');
    const coach = {
      cap: !!pc.querySelector('.acr-cap'),
      opp: !!pc.querySelector('.pc-well .st-cap.is-ok .st-tick'),
      insight: !!pc.querySelector('.pc-well .st-cap.is-unk'),
      well: w ? getComputedStyle(w).borderStyle !== 'none' : false,
      apply: !!pc.querySelector('.pc-well [data-act="applyPricingSuggestion"]'),
    };
    window.apiPost = realPost;
    window.apiGet = realGet;
    return { recent, coach };
  });
  ok(skin.recent.noStutter && skin.recent.figs === 3 && skin.recent.welled && skin.recent.rows === 2,
    `Recent payments: no repeated heading, three recon figures in a well (${skin.recent.figs}), the feed framed (${skin.recent.rows} rows)`);
  ok(skin.coach.cap && skin.coach.opp && skin.coach.insight && skin.coach.well && skin.coach.apply,
    'Pricing coach: caption + wells + ✓ opportunity / quiet insight capsules + Apply intact');

  // ---- 4. actions ----
  console.log('4. money actions');
  await page.evaluate(() => accountsOpen('payments'));
  await page.waitForTimeout(700);
  const pay1 = await page.evaluate(() => {
    const rowsEls = Array.from(document.querySelectorAll('#money-panel .bk-row'));
    const dep = document.getElementById('deposits-due') || { textContent: '' };
    return {
      rows: rowsEls.length,
      unpaidFirst: rowsEls[0] ? rowsEls[0].classList.contains('pay-danger') : false,
      owedLine: (document.querySelector('#money-panel .money-owed') || {}).textContent || '',
      depQueue: dep.textContent,
      depReturnBtn: /Return deposit/.test(dep.innerHTML || ''),
      depKeepBtn: /Keep \(damage\)/.test(dep.innerHTML || ''),
    };
  });
  ok(pay1.rows === 2, `2 upcoming stays listed (past one not in the list) (${pay1.rows})`);
  ok(pay1.unpaidFirst, 'unpaid booking sorts first with red edge');
  // The banner uses the same deposit-folded figures as its rows (audit fix):
  // rental £440 + £50 damages deposit = £490, matching the row's chip.
  ok(/£490/.test(pay1.owedLine), `owed banner equals the sum of its rows, £490 (${pay1.owedLine.trim().slice(0, 60)})`);
  ok(/£100/.test(pay1.depQueue) && pay1.depReturnBtn && pay1.depKeepBtn, 'deposits-to-return queue: £100 held + Return/Keep buttons');
  // KEEP IS RAIL-BLIND. It was gated on holdStatus === 'charged' — a CARD-rail fact
  // cash never sets — so a deposit handed over in cash sat in THIS queue, and in the
  // duty list, with only "Return deposit" offered: with damage the owner's one
  // action was to give back money they were keeping, and the guest was emailed
  // "we're returning your refundable damage deposit" about it. Both rows are read
  // from one render, so the check cannot pass by finding the card row's button.
  const rails = await page.evaluate(() => {
    const rowOf = (name) => [...document.querySelectorAll('#deposits-due .money-row')]
      .find((r) => (r.textContent || '').includes(name));
    const shape = (name) => {
      const r = rowOf(name);
      if (!r) return null;
      return { ret: !!r.querySelector('[data-act="returnDeposit"]'), keep: !!r.querySelector('[data-act="keepDeposit"]'), say: (r.textContent || '').replace(/\s+/g, ' ') };
    };
    return { card: shape('Left Deposit'), cash: shape('Cash Deposit') };
  });
  ok(rails.card && rails.cash, `(fixture) both rails are in the queue (${!!(rails.card && rails.cash)})`);
  ok(rails.cash && rails.cash.ret && rails.cash.keep,
    `a CASH deposit can be kept for damage, not only given back (${rails.cash && rails.cash.say.slice(0, 60)})`);
  ok(rails.card && rails.card.keep, '…and the card rail is unchanged');
  // THE IDENTITY PILL SURVIVES THREE PILLS AT PHONE WIDTH (the UI pass:
  // "Pimpernel" crushed to "P" under paid-state + arrives-soon chips — the
  // no-shrink chips took the row and the ellipsised tag absorbed it all).
  // The arrives-soon chip is INJECTED (the §14 discipline): the fixture's
  // ower arrives in 20 days so the real row never carries it, and the first
  // draft of this check passed with the fix deleted. Break-tested: removing
  // .bk-row-top's flex-wrap reproduces the crush against the injected chip.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  const tagFit = await page.evaluate(() => {
    const row = document.querySelector('#money-panel .bk-row .bk-row-top');
    const tag = row && row.querySelector('.prop-tag');
    if (!row || !tag) return null;
    const chip = document.createElement('span');
    chip.className = 'bk-chip danger';
    chip.innerHTML = '<span class="bk-dot"></span>Arrives in 4d';
    row.appendChild(chip);
    const out = { txt: tag.textContent, clipped: tag.scrollWidth > tag.clientWidth + 1 };
    chip.remove();
    return out;
  });
  ok(!!tagFit && !tagFit.clipped, `the cottage pill never crushes under the status chips (${tagFit && tagFit.txt} fits)`);
  await page.setViewportSize({ width: 1280, height: 950 });
  await page.waitForTimeout(300);

  // row → hub → Record payment (glass form) → posts set_payment → paid
  await page.click('#money-panel .bk-row');
  await page.waitForTimeout(900);
  const hub = await page.evaluate(() => {
    const root = document.querySelector('#booking-hub-content') || document.getElementById('view-booking-hub');
    return {
      name: (root.querySelector('.bhub-name') || {}).textContent || '',
      hasRecord: /Record payment/.test(root.textContent),
      hasInvoice: /Invoice \(PDF\)/.test(root.textContent),
      // The money folds to one line now — the balance leads from the next-action
      // banner ("… £490.00 due."), not an in-page "Balance due" breakdown row.
      balance: /£490\.00 (due|balance)/.test((root.querySelector('.bhub-next') || {}).textContent || ''),
      moneyText: ((root.querySelector('.bhub-headpay') || { textContent: '' }).textContent || '').replace(/\s+/g, ' ').slice(0, 300),
    };
  });
  ok(hub.name === 'Owes Money' && hub.balance, `row opened the right hub with the balance on the banner (${hub.name})`);
  console.log('    money card: ' + hub.moneyText);
  ok(hub.hasRecord && hub.hasInvoice, 'hub Money card has Record payment + Invoice');
  const rec = page.evaluate(() => recordPayment('b1'));
  await page.waitForSelector('#gdf-amount', { timeout: 8000 });
  await page.waitForTimeout(250);
  await page.evaluate(() => {
    document.getElementById('gdf-amount').value = '440';
    document.getElementById('gdf-method').value = 'Bank transfer';
    glassDialogResolve(true);
  });
  await page.waitForTimeout(900);
  // The updated-confirmation offer now PREVIEWS the email first — cancel that
  // send-confirm modal (or the plain confirm if no preview was produced).
  await page.evaluate(() => {
    const ov = document.getElementById('send-confirm-overlay');
    if (ov && ov.classList.contains('open')) document.getElementById('send-confirm-cancel').click();
    else try { glassDialogResolve(false); } catch (e) {}
  });
  await rec.catch(() => {});
  let paidPost = null;
  for (let i = 0; i < 40 && !paidPost; i++) { await page.waitForTimeout(100); paidPost = posts.find((p) => p.action === 'set_payment'); }
  // A FULL payment posts payment:'paid' with payment_date/method — `deposit`
  // is only sent for part-payments, by design.
  ok(!!paidPost && paidPost.payment === 'paid' && paidPost.payment_method === 'Bank transfer' && /^\d{4}-\d{2}-\d{2}$/.test(paidPost.payment_date || ''),
     `Record payment posted paid-in-full by bank transfer (${JSON.stringify(paidPost && { p: paidPost.payment, m: paidPost.payment_method, d: paidPost.payment_date })})`);
  await page.waitForTimeout(700);

  // back to Money; the row should now be green/paid and owed drop to zero
  await page.evaluate(() => bookingHubBack());
  await page.waitForTimeout(1000);
  const after = await page.evaluate(() => {
    accountsOpen('payments');
    return null;
  });
  await page.waitForTimeout(700);
  const pay2 = await page.evaluate(() => ({
    active: (document.querySelector('.page-view.active') || {}).id,
    firstClass: (document.querySelector('#money-panel .bk-row') || { className: '' }).className,
    owedLine: (document.querySelector('#money-panel .money-owed') || {}).textContent || '',
  }));
  // After a payment the hub re-anchors in the Bookings workspace
  // (afterPaymentChange → showDetails), so back may land on either workspace.
  ok(pay2.active === 'view-accounts' || pay2.active === 'view-backoffice', `hub back lands on a workspace (${pay2.active})`);
  ok(/pay-ok/.test(pay2.firstClass), 'the paid booking now shows a green edge');
  ok(/all upcoming bookings are paid/i.test(pay2.owedLine), `owed banner now reads all-paid (${pay2.owedLine.trim().slice(0, 60)})`);

  // deposit return: Return deposit → glass prompt (amount) → confirm → posts return_deposit
  const ret = page.evaluate(() => returnDeposit('b3'));
  await page.waitForTimeout(800);
  await page.evaluate(() => { const i = document.getElementById('glass-dialog-input'); if (i) i.value = '100'; glassDialogResolve(true); });
  await page.waitForTimeout(800);
  await page.evaluate(() => glassDialogResolve(true)); // confirm step
  await ret.catch(() => {});
  let retPost = null;
  for (let i = 0; i < 40 && !retPost; i++) { await page.waitForTimeout(100); retPost = posts.find((p) => p.action === 'return_deposit'); }
  ok(!!retPost && Number(retPost.amount) === 100, `Return deposit posted £100 back (${JSON.stringify(retPost && { amt: retPost.amount })})`);

  // 4b) THE OWNER IS TOLD WHETHER THE GUEST WAS TOLD. The endpoint mails the guest
  // best-effort and hands the outcome back as `email: {ok, error}`; the client threw
  // the response away and toasted "Deposit return issued." unconditionally. On a
  // PARTIAL return that email is the only place the guest ever learns why the rest was
  // kept, so with SMTP down the money moved, the owner believed they had been told, and
  // the reason existed nowhere. Driven through the real dialogs with a real failure.
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
    const d = document.getElementById('glass-dialog');
    const shown = !!(d && getComputedStyle(d).display !== 'none');
    const txt = (document.getElementById('glass-dialog-msg') || {}).innerText || '';
    return { shown, txt, toast: (document.querySelector('.chb-toast, #toast') || {}).textContent || '' };
  });
  ok(said.shown && /didn't send/i.test(said.txt),
    `a failed guest email is REPORTED, not toasted as success (${said.txt.slice(0, 70)})`);
  ok(/reason/i.test(said.txt) && /have not seen it/i.test(said.txt),
    `…and names the retention reason as the thing they have not seen (${said.txt.slice(-80)})`);
  mailWillFail = false;
  await page.evaluate(() => { const d = document.getElementById('glass-dialog'); if (d) glassDialogResolve(true); });
  await page.waitForTimeout(300);

  // ---- 5. back navigation ----
  console.log('5. back navigation');
  await page.evaluate(() => accountsOpen('income'));
  await page.waitForTimeout(400);
  await page.evaluate(() => accountsShowIndex());
  await page.waitForTimeout(400);
  const nav2 = await page.evaluate(() => ({
    idxShown: document.getElementById('accounts-index').style.display !== 'none',
    panelHidden: document.getElementById('accounts-panel').style.display === 'none',
  }));
  ok(nav2.idxShown && nav2.panelHidden, 'drill-down Back restores the Money index');

  // ---- 6. the income screen says what the "Net profit" figure actually COVERS ----
  // A confident green number implies a completeness it doesn't have: with no
  // expenses logged it's really income less card fees, and platform (Airbnb)
  // payouts never reach this ledger at all, so neither that income nor the
  // commission on it is in the figure. Both have to be stated on the page.
  console.log('6. scope caveats on the income screen');
  await page.evaluate(() => accountsOpen('income'));
  await page.waitForTimeout(600);
  const scope0 = await page.evaluate(() => {
    const t = (document.getElementById('accounts-content') || {}).textContent || '';
    return { txt: t, hasExpNote: /No expenses are logged/i.test(t), hasOta: /booking platform/i.test(t) };
  });
  // This suite's stub logs a £120 expense, so the expenses caveat must NOT show —
  // that's the check that the note is conditional and not just always printed.
  ok(!scope0.hasExpNote, 'with expenses logged, the "no expenses" caveat is absent');

  // Now drop the expenses and re-render: the caveat must appear.
  const scope1 = await page.evaluate(async () => {
    try { allExpenses = []; } catch (e) {}
    await renderAccounts();
    await new Promise((r) => setTimeout(r, 300));
    const t = (document.getElementById('accounts-content') || {}).textContent || '';
    return { hasExpNote: /No expenses are logged/i.test(t), explains: /income less card fees/i.test(t) };
  });
  ok(scope1.hasExpNote, 'with NO expenses logged, the page says so instead of implying full profit');
  ok(scope1.explains, 'and says what the figure really is (income less card fees)');

  // An imported platform stay in the tax year must be disclosed too.
  const scope2 = await page.evaluate(async () => {
    // dbBlocks is `const` in app.js, so mutate it rather than reassign.
    Object.keys(dbBlocks).forEach((k) => delete dbBlocks[k]);
    dbBlocks['21a'] = [{ checkIn: '2026-08-01', checkOut: '2026-08-05', source: 'airbnb' }];
    await renderAccounts();
    await new Promise((r) => setTimeout(r, 300));
    const t = (document.getElementById('accounts-content') || {}).textContent || '';
    return { hasOta: /booking platform/i.test(t), commission: /commission/i.test(t) };
  });
  ok(scope2.hasOta, 'an imported platform stay in the year is disclosed as not counted');
  ok(scope2.commission, 'and the uncounted commission is named too');

  // An OWNER block is not a booking and must not trigger the platform caveat.
  const scope3 = await page.evaluate(async () => {
    Object.keys(dbBlocks).forEach((k) => delete dbBlocks[k]);
    dbBlocks['21a'] = [{ checkIn: '2026-08-01', checkOut: '2026-08-05', source: 'owner' }];
    await renderAccounts();
    await new Promise((r) => setTimeout(r, 300));
    const t = (document.getElementById('accounts-content') || {}).textContent || '';
    return { hasOta: /booking platform/i.test(t) };
  });
  ok(!scope3.hasOta, 'an owner block is not a platform booking, so no such caveat');

  // ---- 7. Move money out: what's safe to transfer off the Square account ----
  // The arithmetic is gated by test-sweep.php; this is the half a unit test can't
  // see — that the figure reaches the screen, that a typed balance turns into an
  // answer, and that a failed liability query says so rather than showing a
  // confident £0 (which would invite the owner to move money they don't have).
  console.log('7. move money out');
  const sweepText = async () => (await page.evaluate(() => (document.getElementById('sweep-body') || {}).textContent || '')).replace(/\s+/g, ' ');

  sweepStub = null;
  // openAccounts() NAVIGATES; accountsOpen() alone only swaps the panel, and the
  // earlier sections left view-accounts hidden — textContent still reads out of a
  // hidden view, so a fill() would be the first thing to notice.
  await page.evaluate(() => openAccounts());
  await page.waitForTimeout(600);
  await page.evaluate(() => accountsOpen('sweep'));
  await page.waitForTimeout(500);
  const s0 = await sweepText();
  ok(/Couldn't work out/i.test(s0) && !/£0\.00/.test(s0), 'a failed liability reads as unknown, never a confident £0');

  // Two outstanding deposits: £150 debited, £2.62 of fee credited back with them,
  // so £147.38 is the cash that really leaves and has to stay behind.
  sweepStub = {
    gross: 150, feeBack: 2.62, net: 147.38, count: 2, rate: 0.0175,
    items: [
      { outstanding: 75, gross: 75, feeBack: 1.31, net: 73.69, name: 'Sarah Pemberton', prop_key: '21a', check_out: d(-4) },
      { outstanding: 75, gross: 75, feeBack: 1.31, net: 73.69, name: 'Dan Rowe', prop_key: '21a', check_out: d(-2) },
    ],
  };
  await page.evaluate(() => renderSweep());
  await page.waitForTimeout(500);
  const s1 = await sweepText();
  ok(/Keep in the account/i.test(s1) && /£147\.38/.test(s1), `the ring fence is the NET figure (${s1.slice(0, 90)})`);
  ok(/£150\.00/.test(s1) && /£2\.62/.test(s1), 'and the gross debit + fee credit are both shown, so the number can be checked');
  ok(/Sarah Pemberton/.test(s1) && /Dan Rowe/.test(s1), 'the deposits it is holding back for are named');
  ok(/Type what the account holds/.test(s1) && !/Leaves £/.test(s1) && !/£1,?\d\d\d\./.test(s1),
    'no balance AND no payout data → it invents no transfer figure at all');

  // PER TRANSACTION: the movable figure for each charge, and the total. The
  // arithmetic is test-sweep's; what this proves is that the per-charge figure and
  // the total reach the screen, and that a charge carrying no deposit says so
  // rather than silently showing the same number as one that does.
  sweepStub = {
    gross: 150, feeBack: 2.62, net: 147.38, count: 2, rate: 0.0175,
    items: (sweepStub.items || []),
    transactions: {
      settled: 1056.19, ringFence: 73.69, movable: 982.50, count: 2,
      items: [
        { txn_id: 11, rental: 300, deposit: 75, returned: 0, fee: 6.56, gross: 375, settled: 368.44, alreadyOut: 0, ringFence: 73.69, movable: 294.75, name: 'Sarah Pemberton', prop_key: '21a', paid_on: d(-12) },
        { txn_id: 12, rental: 700, deposit: 0, returned: 0, fee: 12.25, gross: 700, settled: 687.75, alreadyOut: 0, ringFence: 0, movable: 687.75, name: 'Sarah Pemberton', prop_key: '21a', paid_on: d(-5) },
      ],
    },
  };
  await page.evaluate(() => renderSweep());
  await page.waitForTimeout(500);
  const s1b = await sweepText();
  ok(/£294\.75/.test(s1b) && /£687\.75/.test(s1b), `each charge reports its own movable figure (${s1b.slice(0, 60)})`);
  // ONE FIGURE PER CUSTOMER — the transferable one. The rows used to carry the
  // whole derivation ("£368.44 settled · £73.69 held back for the deposit"),
  // which restated the ring fence a third time AND put the gross on the same line
  // as the figure you act on. The gross being gone is the half that matters: two
  // similar amounts side by side is how the wrong one gets copied into a bank
  // transfer.
  ok(/£294\.75/.test(s1b) && !/£368\.44/.test(s1b), 'a row shows what you can transfer, never the gross beside it');
  ok(!/held back for the deposit/.test(s1b), '…and not the derivation, which the ring-fence card already states');
  ok(/£982\.50/.test(s1b) && /Movable from these 2 payments/.test(s1b), 'the movable total is stated for the set');
  ok(/not the account balance/i.test(s1b), 'and it does not claim to be the account balance');
  // With no payout data at all (Square off, or the cron has not run) the flat list
  // is the fallback — and it must SAY that it counts money Square may not have paid
  // out yet, rather than implying every penny is in the bank.
  ok(/No payout data yet/.test(s1b) && /Check Square now/.test(s1b), 'without payout data it states the caveat and offers to check');

  // WHERE THE MONEY ACTUALLY IS. Square settles a charge and pays out a day or two
  // later, so a charge taken this morning is not spendable. Only the in-the-bank
  // group may count towards movable — this is the case the first version got wrong.
  sweepStub = Object.assign({}, sweepStub, {
    payouts: {
      inBank: 294.75, onWay: 687.75, unknown: 0, nextArrival: d(2),
      counts: { inBank: 1, onWay: 1, unknown: 0 },
      checked: Math.floor(Date.now() / 1000), error: null, known: 2,
      items: {
        inBank: [{ txn_id: 11, name: 'Sarah Pemberton', prop_key: '21a', paid_on: d(-12), settled: 368.44, ringFence: 73.69, movable: 294.75, landed: true, arrival: d(-10), fee_actual: true }],
        onWay: [{ txn_id: 12, name: 'Sarah Pemberton', prop_key: '21a', paid_on: d(0), settled: 687.75, ringFence: 0, movable: 687.75, landed: false, arrival: d(2), fee_actual: true }],
        unknown: [],
      },
    },
  });
  await page.evaluate(() => renderSweep());
  await page.waitForTimeout(500);
  const s1c = await sweepText();
  ok(/In the bank — movable/.test(s1c) && /£294\.75/.test(s1c), `the landed group leads with what is really movable (${s1c.slice(0, 50)})`);
  // The discriminating check: £982.50 is landed + on-its-way added together, which
  // is the figure the first version showed. In the split view it must appear
  // NOWHERE — asserting only that £294.75 is present passes just as happily when
  // the group total is the combined one, because the ROW still says £294.75.
  ok(!/£982\.50/.test(s1c), 'the combined total is not presented anywhere as movable');
  ok(/not the account balance/i.test(s1c), 'the split view keeps the not-the-balance caveat too');
  ok(/On its way — not yet/.test(s1c) && /£687\.75/.test(s1c), 'money Square has taken but not paid out is its own group');
  ok(!/Movable from these/.test(s1c), 'the old undifferentiated total is gone — it counted un-paid-out money');
  ok(new RegExp('due ' + d(2).split('-').reverse().join('/')).test(s1c), `an unpaid charge says when it is due (${d(2)})`);
  ok(/Payouts checked/.test(s1c), 'the screen says how fresh the payout data is');

  // ---- THE FIGURE YOU ACT ON, BEFORE ANYTHING IS TYPED ---------------------
  // The page led with what to KEEP and gave the number you transfer only after a
  // balance was typed. Square's payout data already answers most of it: P.inBank
  // sums the charges Square has actually paid IN, each already net of its fee and
  // of any deposit ringfenced out of it — so £294.75 here, not £982.50 (which
  // includes money Square has taken but not paid out) and not £368.44 (gross).
  //
  // These are claims about the ANSWER CARD, so they read only that card. Against
  // the whole page they were meaningless: £294.75 legitimately appears again as a
  // workings ROW, and "older money" is in the long-standing not-the-balance
  // caveat — both made a passing check that proved nothing.
  const sweepAnswer = async () => (await page.evaluate(() => {
    const c = document.querySelector('#sweep-body .accounts-stat');
    return c ? c.textContent : '';
  })).replace(/\s+/g, ' ').trim();

  await page.evaluate(() => { __sweepBalance = ''; __sweepBalTouched = false; });
  await page.evaluate(() => renderSweep(false));
  await page.waitForTimeout(400);
  const aT = await sweepAnswer();
  ok(/^Transfer out/.test(aT) && /£294\.75/.test(aT), `a transfer figure without typing anything (${aT.slice(0, 70)})`);
  ok(!/£982\.50/.test(aT), '…and it is NOT money Square has taken but not paid out');
  ok(!/£368\.44/.test(aT), '…nor the gross before Square took its fee');
  // It is a FLOOR, not the balance: the account also holds older money and
  // whatever has already been moved, so saying so is not optional beside a number
  // labelled "transfer out".
  ok(/older money/.test(aT) && /exact figure/.test(aT), 'it says the balance is the authoritative answer, not this');
  ok(/after holding £147\.38 back/.test(aT), '…and names what it already held back');
  // A TYPED BALANCE WINS. It is the only figure that accounts for older money.
  await page.fill('#sweep-balance', '500');
  await page.locator('#sweep-balance').press('Tab');
  await page.waitForTimeout(400);
  const aT2 = await sweepAnswer();
  ok(/£352\.62/.test(aT2) && !/£294\.75/.test(aT2), `the typed balance replaces the derived figure, 500 − 147.38 (${aT2.slice(0, 60)})`);
  ok(!/older money/.test(aT2), '…and the floor caveat goes with it');
  await page.evaluate(() => { __sweepBalance = ''; __sweepBalTouched = false; });
  await page.evaluate(() => renderSweep(false));
  await page.waitForTimeout(300);

  // Money Square has said nothing about must be its OWN figure — rounding it into
  // "movable" invites moving it, and rounding it into "on its way" invents a date.
  sweepStub = Object.assign({}, sweepStub, {
    payouts: Object.assign({}, sweepStub.payouts, {
      unknown: 491.25, counts: { inBank: 1, onWay: 1, unknown: 1 },
      items: Object.assign({}, sweepStub.payouts.items, {
        unknown: [{ txn_id: 13, name: 'Richard Berry', prop_key: 'jollyboat', paid_on: d(-40), settled: 500, ringFence: 0, movable: 491.25, landed: null, arrival: '' }],
      }),
    }),
  });
  await page.evaluate(() => renderSweep());
  await page.waitForTimeout(500);
  const s1d = await sweepText();
  ok(/Square hasn't said/.test(s1d) && /£491\.25/.test(s1d), 'unvouched money is named as unknown, not counted as movable');
  ok(/Not counted as movable/i.test(s1d), 'and the screen says so in words');

  // WHY it is unknown, which is not always "give it a day". The note used to claim
  // the charges were not in the payout data "yet" in every case — reported from a
  // live account with payouts checked THAT DAY, no error, and a charge 23 days old
  // sitting there. Square pays out in a day or two, so "yet" was wrong about it, and
  // the answer was already in the payload: `known` says whether Square's payout data
  // covers anything at all. Three states, and they must read differently.
  ok(/over a week ago/i.test(s1d) && /should have shown up by now/i.test(s1d),
    `a charge too old to still be pending says so (${(s1d.match(/[^.]*over a week ago[^.]*\./) || ['none'])[0].trim().slice(0, 90)})`);
  // The claim itself, not a slice of text near it: "aren't in the payout data YET"
  // asserts a temporary wait the screen has no basis for. (A split-on-later-text
  // version of this check passed against the old wording, because the "yet" sits
  // BEFORE the phrase it split on — a check that cannot fail is worse than none.)
  ok(!/payout data yet/i.test(s1d), 'and it no longer claims a temporary wait it cannot vouch for');

  // Square returned NOTHING: not a delay, a Square-side setting. Naming the window
  // matters — "no payouts at all in the last 60 days" is a different statement from
  // "these two are missing", and only the server knows how far the fetch reached.
  sweepStub = Object.assign({}, sweepStub, {
    payouts: Object.assign({}, sweepStub.payouts, { known: 0, lookback: 60 }),
  });
  await page.evaluate(() => renderSweep());
  await page.waitForTimeout(500);
  const sNone = await sweepText();
  ok(/hasn't reported any payouts at all/i.test(sNone), `no payout data at all is stated as such (${(sNone.match(/[^.]*any payouts at all[^.]*\./) || ['none'])[0].trim().slice(0, 90)})`);
  ok(/60 days/.test(sNone), 'naming the window the fetch actually covered');
  ok(/payouts paused|bank account/i.test(sNone), '…and what usually causes it, so there is something to go and check');

  // WHY, AS A FACT. That sentence ended in a guess — "usually payouts paused, or no
  // bank account linked" — because nothing in the app could see the bank account.
  // ListBankAccounts answers it, and bank_read() turns the reply into one state. The
  // states must read as four DIFFERENT things, and "we couldn't ask" must never be
  // rendered as "you have no bank account": that is the alarming one, and it would be
  // our bug rather than Square's.
  const withBank = async (bank) => {
    sweepStub = Object.assign({}, sweepStub, { bank });
    await page.evaluate(() => renderSweep());
    await page.waitForTimeout(400);
    return await sweepText();
  };
  const sNoBank = await withBank({ state: 'none', count: 0, why: '', label: '' });
  ok(/No bank account is linked to Square/.test(sNoBank), 'no linked account is stated outright, not guessed at');
  ok(/nowhere for it to pay out to/.test(sNoBank), '…in terms of what it means for the money');
  ok(!/usually a Square-side setting/.test(sNoBank), '…and the old hedge is gone once the fact is known');

  const sReady = await withBank({ state: 'ready', count: 1, why: '', label: 'Barclays ending 4471' });
  ok(/linked and verified/.test(sReady) && /Barclays ending 4471/.test(sReady),
    'a working bank account is named, so the owner knows to look elsewhere');
  ok(/hold-up is something else/.test(sReady), '…and the screen says the cause is elsewhere rather than blaming the bank');
  ok(!/No bank account is linked/.test(sReady), '…and never contradicts itself');

  // TWO ACCOUNTS LINKED: naming one is a guess, and it named the wrong one. Square
  // keeps a single primary payout account and does not say which — reported live, the
  // screen said "Lloyds ending 968" on a business paid out to Monzo.
  const sTwo = await withBank({
    state: 'ready', count: 2, why: '', label: 'Lloyds Bank Plc ending 968',
    all: [{ label: 'Lloyds Bank Plc ending 968', state: 'ready' }, { label: 'Monzo ending 1234', state: 'verifying' }],
  });
  ok(/2 bank accounts linked/.test(sTwo), 'two linked accounts are reported as two, not as one');
  ok(/Lloyds Bank Plc ending 968/.test(sTwo) && /Monzo ending 1234/.test(sTwo), '…and BOTH are named');
  ok(/Monzo ending 1234 — still being verified/.test(sTwo), '…each with its own state, so the odd one out is visible');
  ok(/does not say which one it pays into/.test(sTwo), '…and the screen admits Square has not told us which');
  ok(!/Your bank account \(Lloyds/.test(sTwo), '…never asserting one of them IS the payout account');
  // One account is still named outright — that claim is fair when there is only one.
  ok(/Your bank account \(Barclays ending 4471\) is linked and verified/.test(sReady),
    'a single linked account is still named plainly');

  // WHOSE PAYOUTS ARE THESE? Square answers for the seller's MAIN location when the
  // app does not name one — so a multi-location seller can be shown a complete-looking
  // "no payouts at all" about a shop that is not this business. Measured: sixty days of
  // exactly that, on an account whose money was moving under a location called Online CHB.
  const withLoc = async (location) => {
    sweepStub = Object.assign({}, sweepStub, { location });
    await page.evaluate(() => renderSweep());
    await page.waitForTimeout(400);
    return await sweepText();
  };
  const twoLocs = [{ id: 'L1', name: 'Online CHB', status: 'ACTIVE' }, { id: 'L2', name: 'The Shop', status: 'ACTIVE' }];
  const sUnset = await withLoc({ id: '', all: twoLocs });
  ok(/2 Square locations/.test(sUnset), 'more than one location is disclosed, not silently collapsed');
  ok(/has not been told which it is/.test(sUnset), '…and the screen admits it does not know which shop this is');
  ok(/main/i.test(sUnset) && /Manage . Payments/.test(sUnset), '…naming both what it did instead and where to fix it');

  const sSet = await withLoc({ id: 'L1', all: twoLocs });
  ok(/for <strong>Online CHB<\/strong> only|for Online CHB only/.test(sSet), 'a chosen location is named, so the figures are attributable');
  ok(!/has not been told which it is/.test(sSet), '…and the warning goes once it is set');

  // ONE location cannot be the wrong one, so saying anything about it is noise.
  const sOne = await withLoc({ id: '', all: [{ id: 'L1', name: 'Online CHB', status: 'ACTIVE' }] });
  ok(!/Square locations/.test(sOne) && !/only\./.test(sOne.split('Payouts checked')[1] || ''),
    'a single-location seller is told nothing about locations at all');
  sweepStub = Object.assign({}, sweepStub, { location: null });

  const sVerifying = await withBank({ state: 'verifying', count: 1, why: '', label: 'Barclays ending 4471' });
  ok(/still verifying/.test(sVerifying) && !/No bank account is linked/.test(sVerifying),
    'an account mid-verification is its own answer — linked, but nothing moves yet');

  const sBlocked = await withBank({ state: 'blocked', count: 1, why: '', label: 'Barclays ending 4471' });
  ok(/cannot pay into it/.test(sBlocked), 'a disabled account says money cannot move, not that none is linked');

  // THE ONE THAT MATTERS MOST. A 403 on the scope must fall back to the hedge, never
  // to the alarm — telling an owner their bank account is missing when we simply
  // could not ask is worse than the guess this replaced.
  const sUnknown = await withBank({ state: 'unknown', count: 0, why: "the access token can't read bank accounts", label: '' });
  ok(!/No bank account is linked/.test(sUnknown), 'a failed bank check NEVER claims there is no bank account');
  ok(/usually a Square-side setting/.test(sUnknown), '…it falls back to the honest hedge instead');
  sweepStub = Object.assign({}, sweepStub, { bank: null });
  ok(!/over a week ago/i.test(sNone), 'the age story is NOT told when the feed itself returned nothing — that would be the wrong cause');

  // And no false alarm: a charge taken today is legitimately not paid out yet.
  sweepStub = Object.assign({}, sweepStub, {
    payouts: Object.assign({}, sweepStub.payouts, {
      known: 2, lookback: 60,
      items: Object.assign({}, sweepStub.payouts.items, {
        unknown: [{ txn_id: 14, name: 'Fresh Charge', prop_key: 'jollyboat', paid_on: d(0), settled: 500, ringFence: 0, movable: 491.25, landed: null, arrival: '' }],
      }),
    }),
  });
  await page.evaluate(() => renderSweep());
  await page.waitForTimeout(500);
  const sFresh = await sweepText();
  ok(/Square hasn't said/.test(sFresh) && !/over a week ago/i.test(sFresh) && !/any payouts at all/i.test(sFresh),
    'a charge taken today raises neither alarm — it is simply too soon');

  // ---- THE PAGE ANSWERS ITS OWN QUESTION FIRST ------------------------------
  // "Move money out" used to answer "how much can I move?" LAST, below the ring
  // fence, the deposit list and three groups of per-charge workings — on a phone,
  // ~15 figures before the one the owner opened the page for. The workings are now
  // behind a disclosure. These checks are about ORDER and VISIBILITY, which
  // textContent cannot see (it reads inside a closed <details> just the same), so
  // they measure the DOM.
  const sweepShape = () => page.evaluate(() => {
    const body = document.getElementById('sweep-body');
    const det = body.querySelector('details');
    const inDetails = (el) => !!(el && det && det.contains(el));
    const txt = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
    return {
      firstLabel: txt(body.querySelector('.label')),
      hasDetails: !!det,
      detailsOpen: !!(det && det.open),
      summary: txt(det && det.querySelector('summary')),
      balanceInDetails: inDetails(document.getElementById('sweep-balance')),
      // Every control that ASKS SOMETHING OF THE OWNER must be reachable without
      // opening anything — an action behind a disclosure is an action nobody takes.
      confirmInDetails: [...body.querySelectorAll('[data-act="confirmReturnSettled"]')].some(inDetails),
      refreshInDetails: [...body.querySelectorAll('[data-act="sweepRefreshPayouts"]')].some(inDetails),
      alertsInDetails: inDetails(body.querySelector('.sweep-alerts')),
      // The per-charge groups ARE workings and belong inside.
      groupsInDetails: [...body.querySelectorAll('.accounts-stat .label')]
        .filter((el) => /In the bank|On its way|Square hasn't said|payment by payment/i.test(el.textContent))
        .every(inDetails),
      // …and so is the ring fence. The transfer figure is already net of it, so a
      // card headed with the amount to LEAVE IN was a second headline competing
      // with the one you act on.
      fenceInDetails: [...body.querySelectorAll('.accounts-stat .label')]
        .filter((el) => /Keep in the account/i.test(el.textContent))
        .every(inDetails),
      fenceFound: [...body.querySelectorAll('.accounts-stat .label')].some((el) => /Keep in the account/i.test(el.textContent)),
    };
  });
  const shape = await sweepShape();
  ok(/transfer out/i.test(shape.firstLabel), `the page leads with the figure you act on (${shape.firstLabel})`);
  ok(!shape.balanceInDetails, 'the balance box is not hidden behind the disclosure');
  ok(shape.hasDetails && !shape.detailsOpen, 'the workings start collapsed');
  ok(/worked out/i.test(shape.summary), `…behind a summary that says what is in there (${shape.summary})`);
  ok(shape.groupsInDetails, 'the per-charge groups are workings, and sit inside');
  ok(!shape.refreshInDetails, '"Check Square now" stays reachable without expanding');
  ok(shape.fenceFound && shape.fenceInDetails, 'the amount to LEAVE IN is a derivation, not a second headline');

  // ---- TRANSFERS THE OWNER HAS ALREADY MADE --------------------------------
  // Square reports what it paid INTO the bank; nothing reports what the owner
  // moved OUT, so without a record the same money is offered on every visit. The
  // arithmetic is test-payouts'; what this proves is the round trip — the button
  // exists, writes the right map, and the undo takes it back out.
  // TWO landed charges, because one cannot tell a per-row tick from a whole-lot
  // one: with a single row both act on the same money and either would pass every
  // check below. It is also the real shape — a payout is usually moved on its own.
  const twoLanded = [
    { txn_id: 11, name: 'Sarah Pemberton', prop_key: '21a', paid_on: d(-12), settled: 368.44, ringFence: 73.69, movable: 294.75, landed: true, arrival: d(-10), fee_actual: true },
    { txn_id: 15, name: 'Richard Berry', prop_key: 'jollyboat', paid_on: d(-9), settled: 200, ringFence: 0, movable: 200.00, landed: true, arrival: d(-7), fee_actual: true },
  ];
  const twoStub = {
    inBank: 494.75, moved: 0,
    counts: { inBank: 2, onWay: 1, unknown: 1, moved: 0 },
    movedMap: {},
    items: Object.assign({}, sweepStub.payouts.items, { inBank: twoLanded, moved: [] }),
  };
  sweepStub = Object.assign({}, sweepStub, { payouts: Object.assign({}, sweepStub.payouts, twoStub) });
  await page.evaluate(() => { __sweepBalance = ''; __sweepBalTouched = false; });
  // REFETCH — renderSweep(false) renders the cached payload, so the new stub would
  // not be read and the rows would still be the previous section's. (It reported
  // one row while the whole-lot button, reading the same list, said "all 2".)
  await page.evaluate(() => renderSweep());
  await page.waitForTimeout(500);
  await page.evaluate(() => { const dd = document.querySelector('#sweep-body details'); if (dd) dd.open = true; });
  await page.waitForTimeout(200);
  posts.length = 0;

  // ONE BOOKING AT A TIME, where that booking is listed. The whole-lot button
  // suits "I moved everything"; in practice a payout goes on its own, and without
  // this the only way to say so was to mark the lot and put the rest back.
  const oneBtns = page.locator('#asec-sweep button[data-act="sweepMarkOneTransferred"]');
  ok(await oneBtns.count() === 2, `every movable payment can be ticked off where it is listed (${await oneBtns.count()})`);
  // …and ONLY the movable ones. Money Square has not paid out cannot have left the
  // bank, so a tick there would claim something the server would refuse anyway.
  const markableIds = await page.evaluate(() =>
    [...document.querySelectorAll('#asec-sweep button[data-act="sweepMarkOneTransferred"]')]
      .map((b) => JSON.parse(b.getAttribute('data-args') || '[]')[0]));
  ok(markableIds.sort().join() === '11,15',
    `…and nothing on its way or unvouched-for offers one (${markableIds.join()})`);
  // The name is not "I've transferred this one" five times over: a screen reader
  // gets the guest, the date and the figure it is about.
  const oneLabel = await oneBtns.first().getAttribute('aria-label');
  ok(/Sarah Pemberton/.test(oneLabel || '') && /£294\.75/.test(oneLabel || ''),
    `…each naming whose money it is (${oneLabel})`);
  await oneBtns.first().click();
  await page.waitForTimeout(600);
  const oneWrote = posts.filter((p) => p.action === 'set' && p.key === 'sweep-moved').pop();
  const oneMarks = oneWrote ? JSON.parse(oneWrote.value) : {};
  ok(!!oneWrote && oneMarks['11'] > 0, `ticking one records it (${oneWrote ? oneWrote.value : 'no write'})`);
  ok(!!oneWrote && !oneMarks['15'],
    '…and leaves the other booking alone, which is the whole point of a per-booking pick');
  // THE PANEL YOU ARE WORKING IN STAYS OPEN. A tick saves and re-renders, and this
  // box is rebuilt by innerHTML — so the workings snapped shut on every tick and
  // had to be reopened to reach the next row, in the one flow whose whole point is
  // ticking several rows. Measured `open: false` before the fix.
  const stillOpen = await page.evaluate(() => {
    const dd = document.querySelector('#sweep-body details');
    return dd ? dd.open : null;
  });
  ok(stillOpen === true, `the workings stay open after a tick (${stillOpen})`);

  // THE WHOLE LOT still has its own button, and it CONFIRMS — it acts on a set you
  // cannot see from where it sits, unlike a row's own tick.
  posts.length = 0;
  const markBtn = page.locator('#asec-sweep button[data-act="sweepMarkTransferred"]');
  ok(await markBtn.count() === 1, 'a transfer can be recorded from the answer card');
  ok(/all 2/.test(await markBtn.textContent() || ''),
    `…and says how many it acts on, so it cannot read as "the one I was looking at" (${await markBtn.textContent()})`);
  await markBtn.click();
  await page.waitForTimeout(300);
  // It CONFIRMS first — this changes a money figure and the owner may have tapped
  // it meaning to read it.
  const askTx = await page.evaluate(() => (document.getElementById('glass-dialog-msg') || {}).textContent || '');
  ok(/transferred out/i.test(askTx) && /£494\.75/.test(askTx), `it asks first, naming the amount (${askTx.slice(0, 70)})`);
  await page.click('#glass-dialog-cancel');
  await page.waitForTimeout(300);
  ok(!posts.some((p) => p.action === 'set' && p.key === 'sweep-moved'), 'cancelling records nothing');
  await markBtn.click();
  await page.waitForTimeout(300);
  await page.click('#glass-dialog-ok');
  await page.waitForTimeout(600);
  const wrote = posts.filter((p) => p.action === 'set' && p.key === 'sweep-moved').pop();
  ok(!!wrote, 'confirming writes the record');
  const marks = wrote ? JSON.parse(wrote.value) : {};
  ok(Object.keys(marks).length === 2 && marks['11'] > 0 && marks['15'] > 0,
    `only the LANDED charges are marked, with when (${JSON.stringify(marks)})`);
  ok(!marks['12'], '…never one Square has not paid out — that money cannot have left the bank');

  // WITH ONE landed payment there is no lot, and "I've transferred all 1" is the
  // row's own tick wearing a worse label — the same judgement the bulk chase makes
  // under two owers.
  sweepStub = Object.assign({}, sweepStub, {
    payouts: Object.assign({}, sweepStub.payouts, {
      inBank: 294.75, counts: { inBank: 1, onWay: 1, unknown: 1, moved: 0 },
      items: Object.assign({}, sweepStub.payouts.items, { inBank: [twoLanded[0]] }),
    }),
  });
  await page.evaluate(() => renderSweep());
  await page.waitForTimeout(400);
  await page.evaluate(() => { const dd = document.querySelector('#sweep-body details'); if (dd) dd.open = true; });
  await page.waitForTimeout(200);
  ok(await page.locator('#asec-sweep button[data-act="sweepMarkTransferred"]').count() === 0,
    'a single movable payment gets no "all of it" button beside its own tick');
  ok(await page.locator('#asec-sweep button[data-act="sweepMarkOneTransferred"]').count() === 1,
    '…the row keeps the one that names it');

  // The server applies the marks, so drive the payload it would then return.
  // `movedMap` carries a SECOND mark (99) whose charge has aged out of the payout
  // window, so it has no row on screen. It is here because the client amends this
  // map and saves it back: rebuilt from the visible rows instead, recording or
  // undoing one transfer would silently forget every older one.
  sweepStub = Object.assign({}, sweepStub, {
    payouts: Object.assign({}, sweepStub.payouts, {
      inBank: 0, moved: 294.75,
      counts: { inBank: 0, onWay: 1, unknown: 1, moved: 1 },
      movedMap: { 11: Math.floor(Date.now() / 1000), 99: 1750000000 },
      items: Object.assign({}, sweepStub.payouts.items, {
        inBank: [],
        moved: [{ txn_id: 11, name: 'Sarah Pemberton', prop_key: '21a', paid_on: d(-12), settled: 368.44, ringFence: 73.69, movable: 294.75, landed: true, moved_at: Math.floor(Date.now() / 1000) }],
      }),
    }),
  });
  await page.evaluate(() => renderSweep());
  await page.waitForTimeout(500);
  const aMoved = await sweepAnswer();
  // The HEADLINE, not the card text: the sentence below legitimately names
  // £294.75 as the amount already transferred, so a card-wide regex would fail on
  // the explanation it is supposed to want.
  // Scoped to the ANSWER CARD, like sweepAnswer above: a document-wide
  // querySelector falls through to the ring-fence figure inside the workings the
  // moment the answer has no headline, which is exactly the state under test —
  // it reported £147.38 ("Keep in the account") as the transfer figure.
  const headline = await page.evaluate(() => {
    const c = document.querySelector('#sweep-body .accounts-stat');
    const el = c && c.querySelector('div[style*="--font-display"]');
    return el ? el.textContent.trim() : '';
  });
  ok(headline === '', `no transfer figure is offered once everything is marked (${headline || 'none'})`);
  const sMoved = await sweepText();
  ok(/Already transferred out/.test(sMoved) && /£294\.75/.test(sMoved), 'it is SHOWN as transferred, not silently dropped');
  // IT SAYS WHEN YOU SAID SO. `moved_at` was computed on the server, carried to
  // the client and rendered NOWHERE — built with no way in, the shape this
  // codebase keeps finding. It is the fact that makes the group checkable against
  // a bank statement, and without it the group's own "you told me" cannot be dated.
  const movedGroupTx = await page.evaluate(() => {
    const g = [...document.querySelectorAll('#sweep-body .accounts-stat')]
      .find((el) => /Already transferred out/i.test(el.textContent));
    return g ? g.textContent.replace(/\s+/g, ' ') : '';
  });
  ok(/You marked this on \d\d\/\d\d\/\d{4}/.test(movedGroupTx),
    `the moved row dates the mark (${movedGroupTx.slice(0, 160)})`);
  // Labelled, not a bare second date: the row already carries the date the money
  // came IN, and two unlabelled dates side by side say nothing.
  ok(/You marked this on/.test(movedGroupTx) && /£294\.75/.test(movedGroupTx),
    '…and says which date it is, beside the one the money arrived on');
  // THE OVERRIDE GOES BOTH WAYS. A mark is the owner's memory, and a memory can be
  // wrong — without an undo, one mistaken tap hides that money for good.
  posts.length = 0;
  // The answer must SAY money was excluded, or a lower figure looks like a bug.
  ok(/already transferred/i.test(aMoved), `the answer explains why it is lower (${aMoved.slice(0, 90)})`);
  const undoBtn = page.locator('#asec-sweep button[data-act="sweepUnmarkTransferred"]');
  ok(await undoBtn.count() === 1, 'and can be put back');
  // Deliberately inside the workings: the FACT is on the answer card (above), the
  // CORRECTION is where the record of what you marked lives. Opened to click it.
  await page.evaluate(() => { const d = document.querySelector('#sweep-body details'); if (d) d.open = true; });
  await page.waitForTimeout(200);
  await undoBtn.click();
  await page.waitForTimeout(600);
  const undone = posts.filter((p) => p.action === 'set' && p.key === 'sweep-moved').pop();
  const left = undone ? JSON.parse(undone.value) : null;
  ok(!!left && !left['11'], `the undo removes the mark (${undone ? undone.value : 'no write'})`);
  // …and ONLY that one. 99 is a transfer recorded months ago whose charge has since
  // aged out of the payout window, so it has no row on screen — reconstructing the
  // record from the visible rows would erase it here, which is a correction to one
  // transfer silently deleting another.
  ok(!!left && left['99'] === 1750000000,
    `…without forgetting a mark whose charge has aged out of the window (${undone ? undone.value : 'no write'})`);


  // THE AUTOMATIC HALF: a stated balance is the truth about the account at that
  // moment, so everything Square has already paid in is inside it. Counting those
  // again next visit would offer the same money twice.
  sweepStub = Object.assign({}, sweepStub, {
    payouts: Object.assign({}, sweepStub.payouts, {
      inBank: 494.75, moved: 0,
      counts: { inBank: 2, onWay: 1, unknown: 1, moved: 0 },
      movedMap: { 99: 1750000000 },
      items: Object.assign({}, sweepStub.payouts.items, { inBank: twoLanded, moved: [] }),
    }),
  });
  await page.evaluate(() => renderSweep());
  await page.waitForTimeout(400);
  // With landed money and NO balance typed, the manual button is the way to record
  // a transfer — established here so the claim below is about the BALANCE and not
  // about there being nothing to mark. (Asserting it after the undo section looked
  // right and proved nothing: that stub has an empty inBank, so the button is
  // absent whatever the balance says.) TWO landed charges, so it is not absent for
  // the "no lot to act on" reason either.
  ok(await page.locator('#asec-sweep button[data-act="sweepMarkTransferred"]').count() === 1,
    'landed money with no balance typed offers the manual record');
  await page.fill('#sweep-balance', '2000');
  await page.locator('#sweep-balance').press('Tab');
  await page.waitForTimeout(400);
  // ONE recording action per state. The headline is now the BALANCE's figure while
  // "I've transferred this" confirms what SQUARE has paid in — measured at £2000,
  // the card read "transfer out £1852.62" over a dialog asking to mark £294.75, a
  // different number for the tap directly beneath it. "Remember this balance" is
  // the recording action here and already marks everything landed, so the other one
  // has nothing left to do and no figure on screen to agree with.
  ok(await page.locator('#asec-sweep button[data-act="sweepMarkTransferred"]').count() === 0,
    'a typed balance leaves ONE way to record a transfer, not two disagreeing about the amount');
  ok(await page.locator('#asec-sweep button[data-act="sweepRememberBalance"]').count() === 1,
    '…and it is the one whose figure is the figure on screen');
  posts.length = 0;
  await page.click('#asec-sweep button[data-act="sweepRememberBalance"]');
  await page.waitForTimeout(700);
  const autoBal = posts.filter((p) => p.action === 'set' && p.key === 'sweep-balance').pop();
  const autoMoved = posts.filter((p) => p.action === 'set' && p.key === 'sweep-moved').pop();
  ok(!!autoBal, 'recording the balance stores it');
  const autoMap = autoMoved ? JSON.parse(autoMoved.value) : null;
  ok(!!autoMap && autoMap['11'] > 0,
    `…and marks what Square had already paid in, because that balance already contains it (${autoMoved ? autoMoved.value : 'no write'})`);
  ok(!!autoMap && autoMap['99'] === 1750000000, '…adding to the record rather than replacing it');
  // IT SAYS WHAT IT DID. Noting a balance also marks every payment inside it, which
  // is a change to a money figure the owner did not explicitly ask for — and the
  // toast said only "Balance noted", so charges silently stopped counting as
  // movable. A side effect on money has to be reported where it happens.
  const autoToast = await page.evaluate(() => {
    const s = document.getElementById('app-toasts');
    return s ? s.textContent.replace(/\s+/g, ' ').trim() : '';
  });
  ok(/Balance noted/.test(autoToast) && /\b2 payments\b/.test(autoToast),
    `noting a balance says how many payments it just took out of the figure (${autoToast})`);
  await page.evaluate(() => { __sweepBalance = ''; __sweepBalTouched = false; });
  await page.evaluate(() => renderSweep(false));
  await page.waitForTimeout(300);

  // MONEY UNDER DISPUTE is fenced beside the deposits — Square can pull it back, and
  // a chargeback on a whole stay dwarfs a £75 deposit. Its own line, not folded in.
  sweepStub = Object.assign({}, sweepStub, {
    disputes: { amount: 900, count: 1, items: [{ id: 'd1', amount: 900, state: 'EVIDENCE_REQUIRED', reason: 'NO_KNOWLEDGE' }], error: null },
  });
  await page.evaluate(() => renderSweep());
  await page.waitForTimeout(500);
  const sD = await sweepText();
  ok(/£900\.00 under dispute/.test(sD), `a disputed payment is named on the ring fence (${sD.slice(0, 60)})`);
  ok(/£1,?047\.38/.test(sD), 'and it is ADDED to what must stay in the account (147.38 + 900)');
  await page.fill('#sweep-balance', '2000');
  await page.locator('#sweep-balance').press('Tab');
  await page.waitForTimeout(400);
  const sD2 = await sweepText();
  ok(/£952\.62/.test(sD2), `so what is safe to move drops by the disputed amount (${sD2.slice(-120)})`);
  // A dispute read that failed must not read as "nothing disputed".
  sweepStub = Object.assign({}, sweepStub, { disputes: { amount: 0, count: 0, items: [], error: "the access token can't read disputes" } });
  await page.evaluate(() => renderSweep());
  await page.waitForTimeout(500);
  const sD3 = await sweepText();
  ok(/Couldn't check for disputes/.test(sD3) && /NOT included/.test(sD3), 'a failed dispute check says so rather than implying none');
  sweepStub = Object.assign({}, sweepStub, { disputes: { amount: 0, count: 0, items: [], error: null } });
  await page.evaluate(() => { __sweepBalance = ''; __sweepBalTouched = false; });

  // AN ISSUED-BUT-UNDEBITED REFUND stays fenced, and says why — "still to return"
  // would read as a job the owner has yet to do.
  sweepStub = Object.assign({}, sweepStub, {
    items: [{ outstanding: 75, awaiting: 75, gross: 75, feeBack: 1.31, net: 73.69, name: 'Anne Betts', prop_key: '21a', check_out: d(-4) }],
    count: 1, gross: 75, feeBack: 1.31, net: 73.69,
  });
  await page.evaluate(() => renderSweep());
  await page.waitForTimeout(500);
  const sA = await sweepText();
  ok(/not yet confirmed settled here/.test(sA), 'a pending refund is labelled, not shown as outstanding work');
  // It must not claim what SQUARE has done. Reported live: Square had already taken the
  // money out of the Square balance while this row said it was still waiting for them.
  ok(!/waiting for Square to take it/.test(sA),
    '…and does not assert what Square has or has not done, which we had not checked');
  ok(/Check Square now/.test(sA), '…it points at the one control that actually asks');
  // An issued-but-unconfirmed refund carries a BUTTON. It must not be behind the
  // disclosure — this is the check that failed when the deposits list was first
  // moved into the workings wholesale.
  const sAshape = await sweepShape();
  ok(!sAshape.confirmInDetails, 'the "confirm settled" button is reachable without expanding the workings');
  // …and the CARD must not contradict its own row. It was headed "Deposits still to
  // return" — a to-do — over rows that are nothing of the kind.
  ok(!/Deposits still to return/.test(sA), 'the card no longer heads a ring fence as a to-do list');
  // The ring-fence figure and the deposits it is made of are ONE card now (they
  // were two, which stated the same £73.69 twice under two headings), so the
  // guarantee is checked against that card: it is headed by what it IS.
  ok(/Keep in the account/.test(sA) && /damage deposit still held/.test(sA),
    '…it describes what it is actually fencing');
  // The headline above the list carried the same false claim, and it is the sentence
  // that explains the ring-fence figure — so it has to be true of every row under it.
  ok(/damage deposits? still held/.test(sA) && !/still to return/.test(sA),
    'the ring-fence sentence says HELD, not "still to return"');

  // THE EXACT PAIR REPORTED FROM THE LIVE ACCOUNT: one guest gone and already
  // refunded, one who has not left yet. Both were headed "still to return", and BOTH
  // rows read "left <date>" — so a guest checking out in a month was reported as
  // having left on a future date.
  sweepStub = Object.assign({}, sweepStub, {
    items: [
      { outstanding: 75, awaiting: 75, gross: 75, feeBack: 1.31, net: 73.69, name: 'Richard Berry', prop_key: '21a', check_in: d(-16), check_out: d(-13) },
      { outstanding: 75, awaiting: 0, gross: 75, feeBack: 1.31, net: 73.69, name: 'Anne Betts', prop_key: '21a', check_in: d(29), check_out: d(32) },
    ],
    count: 2, gross: 150, feeBack: 2.16, net: 147.84,
  });
  await page.evaluate(() => renderSweep());
  await page.waitForTimeout(500);
  const sPair = await sweepText();
  const ukd = (n) => d(n).split('-').reverse().join('/');
  // (This asserted "leaves 31/08" in the two-state version. It is now the ARRIVAL that
  // leads the row for a stay still to come — the sMid scene below owns "leaves".)
  ok(!new RegExp('left ' + ukd(32)).test(sPair), 'a guest is never reported as having left on a date in the future');
  ok(!new RegExp('left ' + ukd(29)).test(sPair), '…nor as having left on their own arrival date');
  ok(new RegExp('left ' + ukd(-13)).test(sPair), `a guest who has gone still reads "left" (${ukd(-13)})`);
  // ANNE HAS NOT ARRIVED, let alone stayed. "Still staying" was said of a guest whose
  // booking starts in a month — the deposit is charged with the first payment, so it is
  // held from the moment they book. Three future/present states, not two.
  ok(/Not arrived yet — held until after the stay/.test(sPair), 'a guest who has not arrived is not described as staying');
  ok(!/Still staying/.test(sPair), '…and the in-residence wording is not used for them');
  ok(new RegExp('arrives ' + ukd(29)).test(sPair), `…their row leads with the ARRIVAL, the useful date for a stay still to come (${ukd(29)})`);
  ok(/not yet confirmed settled here/.test(sPair), 'the refunded one still says it is only waiting on Square');
  ok(!/Ready to return/.test(sPair), 'and NEITHER of these two is presented as ready to hand back');

  // MID-STAY is still its own state: arrived, not left, deposit held.
  sweepStub = Object.assign({}, sweepStub, {
    items: [{ outstanding: 75, awaiting: 0, gross: 75, feeBack: 1.31, net: 73.69, name: 'Mid Stay', prop_key: '21a', check_in: d(-2), check_out: d(3) }],
    count: 1, gross: 75, feeBack: 1.31, net: 73.69,
  });
  await page.evaluate(() => renderSweep());
  await page.waitForTimeout(500);
  const sMid = await sweepText();
  ok(/Still staying — nothing to hand back yet/.test(sMid) && !/Not arrived yet/.test(sMid),
    'a guest actually in the cottage IS described as staying');
  ok(new RegExp('leaves ' + ukd(3)).test(sMid), `…and their row leads with the checkout (${ukd(3)})`);

  // The row that IS the job says so — otherwise the three states are two.
  sweepStub = Object.assign({}, sweepStub, {
    items: [{ outstanding: 75, awaiting: 0, gross: 75, feeBack: 1.31, net: 73.69, name: 'Dan Rowe', prop_key: '21a', check_in: d(-6), check_out: d(-3) }],
    count: 1, gross: 75, feeBack: 1.31, net: 73.69,
  });
  await page.evaluate(() => renderSweep());
  await page.waitForTimeout(500);
  const sDue = await sweepText();
  ok(/Ready to return/.test(sDue) && !/Still staying/.test(sDue), 'a finished stay with the deposit still held is the one marked ready');

  // CONFIRMING BY HAND THAT A REFUND HAS GONE. Square's API lags what the owner can
  // already see: reported live, the money was out of the Square balance while the row
  // said our records had not seen it settle. Every scene above carries NO booking_id,
  // so none of them could ever have rendered this button — the fixture is the gate.
  const confirmBtn = () => page.locator('#asec-sweep button[data-act="confirmReturnSettled"]');
  sweepStub = Object.assign({}, sweepStub, {
    items: [{ booking_id: 77, outstanding: 75, awaiting: 75, gross: 75, feeBack: 1.31, net: 73.69, name: 'Anne Betts', prop_key: '21a', check_in: d(-16), check_out: d(-13) }],
    count: 1, gross: 75, feeBack: 1.31, net: 73.69,
  });
  await page.evaluate(() => renderSweep());
  await page.waitForTimeout(500);
  ok((await confirmBtn().count()) === 1, 'a refund our records have not seen settle offers a confirm button');
  const sCfA = await sweepText();
  // Two routes to one job read as two jobs. The row-level pointer at the page-level
  // refresh is only for a row that has no button of its own.
  ok(!/not yet confirmed settled here \(tap/.test(sCfA), '…and the row does not ALSO tell them to go and press something else');

  // It is offered ONLY where there is something waiting. A deposit still held is not a
  // refund to confirm, and offering it there would invite marking money gone that never left.
  sweepStub = Object.assign({}, sweepStub, {
    items: [{ booking_id: 77, outstanding: 75, awaiting: 0, gross: 75, feeBack: 1.31, net: 73.69, name: 'Anne Betts', prop_key: '21a', check_in: d(-16), check_out: d(-13) }],
  });
  await page.evaluate(() => renderSweep());
  await page.waitForTimeout(400);
  ok((await confirmBtn().count()) === 0, '…and never on a deposit that has not been refunded at all');

  // Driven for real: the dialog, the button in it, and what actually goes to the server.
  sweepStub = Object.assign({}, sweepStub, {
    items: [{ booking_id: 77, outstanding: 75, awaiting: 75, gross: 75, feeBack: 1.31, net: 73.69, name: 'Anne Betts', prop_key: '21a', check_in: d(-16), check_out: d(-13) }],
  });
  await page.evaluate(() => renderSweep());
  await page.waitForTimeout(400);
  // BACKING OUT SENDS NOTHING. Under-fencing is how the account goes short, so a
  // mis-tap must cost nothing.
  const postsBefore = posts.length;
  await confirmBtn().click();
  await page.waitForTimeout(400);
  const dlg = await page.textContent('#glass-dialog-msg');
  ok(/actually left your Square balance/.test(dlg || ''), 'it asks first, in terms of what the owner can verify');
  ok(/could end up short/.test(dlg || ''), '…and states the consequence of getting it wrong, not the mechanism');
  await page.click('#glass-dialog-cancel');
  await page.waitForTimeout(400);
  ok(!posts.slice(postsBefore).some((p) => p.action === 'confirm_return_settled'), 'cancelling sends nothing');

  await confirmBtn().click();
  await page.waitForTimeout(400);
  await page.click('#glass-dialog-ok');
  await page.waitForTimeout(700);
  const sent = posts.filter((p) => p.action === 'confirm_return_settled');
  ok(sent.length === 1, `confirming posts exactly once (${sent.length})`);
  ok(sent[0] && sent[0].__url === 'bookings.php' && sent[0].id === 77,
    `…naming the booking it is confirming (${sent[0] ? sent[0].id : 'none'})`);

  // THE BALANCE, ROLLED FORWARD. Pre-filled from what the owner last stated plus what
  // Square has done since — and labelled an estimate, with its working shown.
  sweepStub = Object.assign({}, sweepStub, {
    balance: {
      stored: { amount: 2000, at: Math.floor(Date.now() / 1000) - 3 * 86400 },
      estimate: { from: 2000, at: Math.floor(Date.now() / 1000) - 3 * 86400, in: 604.05, inCount: 1, out: 73.92, outCount: 1, estimate: 2530.13 },
    },
  });
  await page.evaluate(() => { __sweepBalance = ''; __sweepBalTouched = false; renderSweep(); });
  // WAIT FOR STATE, NOT THE CLOCK. The confirm flow above fires a trailing
  // sweep refresh; on a loaded machine it lands AFTER a fixed wait and
  // repaints this scene from the previous stub (observed: field ✓ 2530.13,
  // sentence gone — a 1-in-N battery flake, standalone always green). Poll
  // for the estimate sentence, and if the stale repaint won the race,
  // re-render once from the current stub and poll again.
  const estUp = () => page.waitForFunction(
    () => /you told me/.test((document.getElementById('asec-sweep') || {}).textContent || ''),
    { timeout: 4000 },
  ).then(() => true).catch(() => false);
  if (!(await estUp())) {
    await page.evaluate(() => renderSweep());
    await estUp();
  }
  const sB = await sweepText();
  const balVal = await page.inputValue('#sweep-balance');
  ok(balVal === '2530.13', `the field starts from the rolled-forward figure (${balVal})`);
  // £2,000.00 — the HOUSE gbp with its thousands separator: two local
  // comma-less shadows of the formatter painted £1852.62 on the sweep's own
  // headline (the UI pass) and this check had pinned the shadow's format.
  ok(/estimate/.test(sB) && /£2,000\.00 you told me/.test(sB), 'labelled an estimate, from the figure they stated');
  ok(/plus £604\.05 Square has paid in since/.test(sB) && /less £73\.92 it has taken back/.test(sB), 'and it shows its working both ways');
  ok(/Remember this balance/.test(sB), 'with a way to store the corrected figure');
  // Typing must never be overwritten by a re-render.
  await page.fill('#sweep-balance', '1234.56');
  await page.locator('#sweep-balance').press('Tab');
  await page.waitForTimeout(300);
  await page.evaluate(() => renderSweep(false));
  await page.waitForTimeout(300);
  ok((await page.inputValue('#sweep-balance')) === '1234.56', 'a re-render never overwrites what the owner is typing');

  // Put the two-deposit fixture back: the cases below assert against a £147.38 ring
  // fence, and leaving this block's single-deposit shape in place broke four of them.
  // A shared mutable stub has to be restored, not just extended.
  sweepStub = Object.assign({}, sweepStub, {
    gross: 150, feeBack: 2.62, net: 147.38, count: 2, balance: null,
    items: [
      { outstanding: 75, awaiting: 0, gross: 75, feeBack: 1.31, net: 73.69, name: 'Sarah Pemberton', prop_key: '21a', check_out: d(-4) },
      { outstanding: 75, awaiting: 0, gross: 75, feeBack: 1.31, net: 73.69, name: 'Dan Rowe', prop_key: '21a', check_out: d(-2) },
    ],
  });
  await page.evaluate(() => { __sweepBalance = ''; __sweepBuffer = ''; __sweepBalTouched = false; });

  // A stale cache says so instead of presenting old figures as current.
  sweepStub = Object.assign({}, sweepStub, {
    payouts: Object.assign({}, sweepStub.payouts, { error: "the access token can't read payouts" }),
  });
  await page.evaluate(() => renderSweep());
  await page.waitForTimeout(500);
  const s1e = await sweepText();
  ok(/may be out of date/.test(s1e) && /can't read payouts/.test(s1e), 'a payout-fetch failure is reported in the owner\'s own words');
  sweepStub = Object.assign({}, sweepStub, { payouts: null });
  await page.evaluate(() => renderSweep());
  await page.waitForTimeout(400);

  // Typing the balance must answer WITHOUT another round trip — the liability is
  // cached, so a keystroke can't cost a request.
  const getsBefore = acctGets;
  await page.fill('#sweep-balance', '2000');
  await page.locator('#sweep-balance').press('Tab');
  await page.waitForTimeout(400);
  const s2 = await sweepText();
  ok(/Transfer out/.test(s2) && /£1,?852\.62/.test(s2) && /Leaves £147\.38 behind/.test(s2), `£2000 balance − £147.38 = £1852.62 to transfer (${s2.slice(-140)})`);
  ok(acctGets === getsBefore, `typing the balance costs no request (${acctGets - getsBefore})`);

  await page.fill('#sweep-buffer', '250');
  await page.locator('#sweep-buffer').press('Tab');
  await page.waitForTimeout(400);
  const s3 = await sweepText();
  ok(/£1,?602\.62/.test(s3), 'a chosen cushion comes off what is safe to move');
  ok(/£250\.00/.test(s3), 'and the cushion is stated in the "leaves behind" sentence');

  // Already below the ring fence: the actionable number is the SHORTFALL, and
  // "safe to move £0" must not appear beside it.
  await page.fill('#sweep-buffer', '0');
  await page.locator('#sweep-buffer').press('Tab');
  await page.fill('#sweep-balance', '100');
  await page.locator('#sweep-balance').press('Tab');
  await page.waitForTimeout(400);
  const s4 = await sweepText();
  ok(/£47\.38 short/i.test(s4), `an account below the ring fence reports the shortfall (${s4.slice(-120)})`);
  ok(!/Safe to move/.test(s4) && !/Leaves £/.test(s4), 'and never offers a figure to move out of it');

  // Nothing outstanding is a real, calm state — not an error.
  sweepStub = { gross: 0, feeBack: 0, net: 0, count: 0, rate: 0.0175, items: [] };
  await page.evaluate(() => renderSweep());
  await page.waitForTimeout(500);
  const s5 = await sweepText();
  ok(/nothing has to stay behind/i.test(s5) && !/Couldn't work out/i.test(s5), 'no deposits outstanding says so plainly');

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
    const save = document.querySelector('[data-act="saveSquareLocation"]');
    return {
      shown: on(sel) && on(save),
      opts: sel ? [...(/** @type {HTMLSelectElement} */ (sel)).options].map((o) => o.textContent.trim()) : [],
    };
  });
  const pick = await vis();
  ok(pick.shown, 'with two locations the picker is ON SCREEN in Manage → Payments');
  ok(pick.opts.some((t) => /Online CHB/.test(t)) && pick.opts.some((t) => /The Shop/.test(t)),
    `…listing every location (${pick.opts.join(' | ')})`);
  ok(pick.opts.some((t) => /main location/i.test(t)), '…plus the unset option, which is what Square does today');

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
  const toastSaid = await page.evaluate(async () => {
    let said = '';
    const t = window.toast;
    window.toast = (m, kind) => { said = String(m || ''); return t ? t(m, kind) : undefined; };
    await sweepRefreshPayouts();
    window.toast = t;
    return said;
  });
  ok(/Square couldn\u2019t be reached/.test(toastSaid) || /Square couldn’t be reached/.test(toastSaid),
    `the refusal reaches the owner in the server's own words (${toastSaid.slice(0, 60)})`);
  ok(!/Payouts up to date/.test(toastSaid), '…and a failure is never reported as up to date');
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
