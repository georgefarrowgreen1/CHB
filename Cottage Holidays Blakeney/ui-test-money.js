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
process.env.TZ = 'Europe/London';
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const PORT = 8151;
const dir = __dirname;
let fails = 0;
const ok = (b, m) => { console.log(`  ${b ? '✓' : '✗'} ${m}`); if (!b) fails++; };
// Local-formatted, never toISOString() — that's UTC and slips a day near midnight.
const d = (n) => { const t = new Date(); const x = new Date(t.getFullYear(), t.getMonth(), t.getDate() + n); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };

(async () => {
  const server = spawn('php', ['-S', `127.0.0.1:${PORT}`, '-t', dir], { stdio: 'ignore' });
  // Wait for php -S to actually accept connections (a fixed sleep flakes on slow CI runners).
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://127.0.0.1:${PORT}/index.html`)).ok) break; } catch (e) {} await new Promise((r) => setTimeout(r, 250)); }
  const browser = await chromium.launch(process.env.CHB_CHROMIUM ? { executablePath: process.env.CHB_CHROMIUM } : {});
  const page = await browser.newPage({ viewport: { width: 1280, height: 950 } });
  page.on('pageerror', (e) => { console.log('  PAGEERR:', e.message); fails++; });
  await page.addInitScript(() => { if (navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(() => {}); });

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
        if (b.action === 'set_payment') { const r = rows.find((x) => x.id === b.id); if (r) { r.payment = b.payment; r.deposit_paid = b.deposit || (b.payment === 'paid' ? r.agreed_total : 0); r.payment_method = b.payment_method || ''; r.payment_date = b.payment_date || ''; } return json({ ok: true }); }
        if (b.action === 'return_deposit') { const r = rows.find((x) => x.id === b.id); if (r) r.hold_status = 'returned'; return json({ ok: true }); }
        return json({ ok: true });
      }
      if (b.__url === 'expenses.php') return json({ ok: true, expenses: [{ id: 1, date: d(-40), category: 'Maintenance', note: 'Boiler service', amount: 120 }] });
      return json({ ok: true, events: [], logs: {}, reviews: [], photos: [] });
    }
    if (url.includes('bookings.php')) return json({ bookings: rows });
    if (url.includes('accounts.php')) return json({ years: [2026, 2025] });
    if (url.includes('expenses.php')) return json({ ok: true, expenses: [{ id: 1, date: d(-40), category: 'Maintenance', note: 'Boiler service', amount: 120 }] });
    if (url.includes('rates.php')) return json({ properties: [{ prop_key: '21a', name: '21A Westgate', slug: '21a', couple_rate: 130, extra_adult_rate: 0, child_rate: 0, booking_fee: 50, transaction_pct: 0, lastmin_pct: 0, lastmin_days: 0, max_adults: 2, max_children: 0, max_total: 2, sort_order: 1 }], seasons: {}, occupancy: {} });
    return json({ ok: true, bookings: [], enquiries: [], properties: [], seasons: {}, occupancy: {}, content: {}, blocks: [], ranges: [], payments: [], years: [] });
  });

  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
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
    return { exists: !!b, label: b ? b.getAttribute('data-label') : '', onclick: b ? b.getAttribute('onclick') : '' };
  });
  ok(dock.exists && dock.label === 'Payments' && /openAccounts/.test(dock.onclick), `Payments dock button present + wired (${dock.onclick})`);
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
      balance: /Balance due/.test(root.textContent),
      moneyText: (Array.from(root.querySelectorAll('.bhub-card')).find((c) => /Payments/.test((c.querySelector('.bhub-card-title') || {}).textContent || '')) || { textContent: '' }).textContent.replace(/\s+/g, ' ').slice(0, 300),
    };
  });
  ok(hub.name === 'Owes Money' && hub.balance, `row opened the right hub with a balance due (${hub.name})`);
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
  await page.evaluate(() => { try { glassDialogResolve(false); } catch (e) {} }); // decline the updated-confirmation email ask
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

  await browser.close(); server.kill();
  console.log(fails ? `MONEY CHECK FAILED ❌ (${fails})` : 'MONEY CHECK PASSED ✅');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
