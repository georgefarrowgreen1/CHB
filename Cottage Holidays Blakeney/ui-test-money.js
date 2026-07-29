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
  ];
  const posts = [];
  // §7 drives the "Move money out" screen off the SAME accounts.php payload the
  // income screen uses, so the stub carries deposit_liability only when a case
  // wants it — absent is the failed-query state, which must not read as £0.
  let sweepStub = null;
  let acctGets = 0;
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
        if (b.action === 'return_deposit') { const r = rows.find((x) => x.id === b.id); if (r) r.hold_status = 'returned'; return json({ ok: true }); }
        return json({ ok: true });
      }
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

  // ---- 2. overview ----
  console.log('2. overview');
  const ov = await page.evaluate(() => {
    const el = document.getElementById('money-overview');
    const kpis = el ? el.querySelectorAll('.mo-kpi').length : 0;
    return { kpis, text: el ? el.textContent : '' };
  });
  ok(ov.kpis === 4, `4 KPI tiles render (${ov.kpis})`);
  ok(/Outstanding/.test(ov.text) && /£440/.test(ov.text), 'Outstanding shows the unpaid £440');
  ok(/Received/.test(ov.text), 'received-this-tax-year tile present');

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
  await page.evaluate(() => accountsShowIndex());
  await page.waitForTimeout(250);
  await secCheck('expenses', /boiler service|expense/i, 'Expenses (seeded row listed)');
  await secCheck('pricingcoach', /pricing|suggestion|coach|demand|not enough/i, 'Pricing coach');

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
  ok(/Enter the balance/.test(s1) && !/Leaves £/.test(s1), 'with no balance typed it does not invent a safe figure');

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
  ok(/£368\.44 settled/.test(s1b) && /£73\.69 held back/.test(s1b), 'a charge carrying a deposit shows what settled and what is held back');
  ok(/nothing held back/.test(s1b), 'a charge carrying no deposit says so, rather than looking identical');
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
  ok(/Already refunded — waiting for Square to take it/.test(sA), 'a pending refund is labelled, not shown as outstanding work');

  // THE BALANCE, ROLLED FORWARD. Pre-filled from what the owner last stated plus what
  // Square has done since — and labelled an estimate, with its working shown.
  sweepStub = Object.assign({}, sweepStub, {
    balance: {
      stored: { amount: 2000, at: Math.floor(Date.now() / 1000) - 3 * 86400 },
      estimate: { from: 2000, at: Math.floor(Date.now() / 1000) - 3 * 86400, in: 604.05, inCount: 1, out: 73.92, outCount: 1, estimate: 2530.13 },
    },
  });
  await page.evaluate(() => { __sweepBalance = ''; __sweepBalTouched = false; renderSweep(); });
  await page.waitForTimeout(500);
  const sB = await sweepText();
  const balVal = await page.inputValue('#sweep-balance');
  ok(balVal === '2530.13', `the field starts from the rolled-forward figure (${balVal})`);
  ok(/estimate/.test(sB) && /£2000\.00 you told me/.test(sB), 'labelled an estimate, from the figure they stated');
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
  ok(/Safe to move/.test(s2) && /£1,?852\.62/.test(s2) && /Leaves £147\.38 behind/.test(s2), `£2000 balance − £147.38 = £1852.62 safe (${s2.slice(-140)})`);
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

  console.log(fails ? `MONEY CHECK FAILED ❌ (${fails})` : 'MONEY CHECK PASSED ✅');
  await done(fails);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
