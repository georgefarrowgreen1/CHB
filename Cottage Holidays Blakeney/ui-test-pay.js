// Pay-for-your-stay page, end to end in a real browser (Square stubbed):
//  1. the header carries the STAY — cottage accent chip + dates + nights
//  2. one amount hero: kind label, figure, money-shape sub ("of £X total ·
//     £Y already paid") and the deposit note as its OWN quiet line
//  3. the loud "Secured by Square" banner is gone — a small lock line +
//     receipt note sit under the Pay button instead
//  4. the Pay button names the amount ("Pay £340.00")
//  5. the wallet divider stays hidden when no wallet mounts
//  6. happy path: tokenize → charge posts source_id → receipt state
const { bootBrowser } = require('./ui-test-lib'); // pins TZ=Europe/London at require time
let fails = 0;
const ok = (b, m) => { console.log(`  ${b ? '✓' : '✗'} ${m}`); if (!b) fails++; };

(async () => {
  const { browser, base, done: harnessDone } = await bootBrowser();
  const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
  page.on('pageerror', (e) => { console.log('  PAGEERR:', e.message); fails++; });
  await page.addInitScript(() => {
    if (navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(() => {});
    // Stub the Square SDK: loadSquareSdk() short-circuits on window.Square, the
    // card field attaches as a no-op, tokenize approves, and paymentRequest
    // throwing means no wallet mounts (so the divider must stay hidden).
    window.Square = {
      payments: () => ({
        card: async () => ({ attach: async () => {}, tokenize: async () => ({ status: 'OK', token: 'tok_test_1' }) }),
        paymentRequest: () => { throw new Error('no wallets in this test'); },
      }),
    };
  });

  const posts = [];
  await page.route(/\.php/, (route) => {
    const url = route.request().url();
    const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (route.request().method() === 'POST') {
      const b = JSON.parse(route.request().postData() || '{}');
      b.__url = url.split('/').pop().split('?')[0];
      posts.push(b);
      if (b.__url === 'pay.php' && b.action === 'summary') return json({
        ok: true, propName: 'Annex', propKey: 'jollyboat', guestName: 'Debbie McGoldrick',
        checkIn: '2026-08-27', checkOut: '2026-08-30', currency: 'GBP', kind: 'balance',
        total: 390, alreadyPaid: 100, balance: 290, depositPct: 25, amountDue: 290,
        damagesDue: 50, holdAmount: 0, holdStatus: 'none',
      });
      if (b.__url === 'pay.php' && b.action === 'charge') return json({ ok: true, fullyPaid: true, charged: 340 });
      return json({ ok: true });
    }
    if (url.includes('square-config.php')) return json({ enabled: true, applicationId: 'app-id', locationId: 'loc-id', environment: 'sandbox' });
    if (url.includes('rates.php')) return json({ properties: [{ prop_key: 'jollyboat', name: 'Annex', slug: 'annex', couple_rate: 130, booking_fee: 50, max_adults: 2, max_children: 0, max_total: 2, sort_order: 1 }], seasons: {}, occupancy: {} });
    return json({ ok: true, bookings: [], enquiries: [], properties: [], seasons: {}, occupancy: {}, content: {}, blocks: [], ranges: [], value: null, reviews: [], photos: [], threads: [] });
  });

  await page.goto(`${base}/index.html`, { waitUntil: 'networkidle' });
  await page.evaluate(() => openPayView('paytok', '7', 'balance'));
  await page.waitForTimeout(900);

  const v = await page.evaluate(() => ({
    bodyShown: document.getElementById('pay-body').style.display !== 'none',
    prop: (document.getElementById('pay-prop') || {}).textContent || '',
    chip: !!document.querySelector('#pay-prop .prop-tag.tag-jollyboat'),
    kind: (document.getElementById('pay-kind-label') || {}).textContent || '',
    amount: (document.getElementById('pay-amount') || {}).textContent || '',
    sub: (document.getElementById('pay-amount-sub') || {}).textContent || '',
    note: (document.getElementById('pay-amount-note') || {}).textContent || '',
    noteShown: (document.getElementById('pay-amount-note') || { style: {} }).style.display !== 'none',
    oldBanner: !!document.querySelector('#view-pay .enq-cancel-note'),
    secure: (document.querySelector('#view-pay .pay-secure') || {}).textContent || '',
    receipt: (document.querySelector('#view-pay .pay-receipt-note') || {}).textContent || '',
    btn: (document.getElementById('pay-btn') || {}).textContent || '',
    orShown: (document.getElementById('sq-or') || { style: {} }).style.display !== 'none',
  }));
  ok(v.bodyShown, 'pay body renders');
  ok(v.chip && /Annex/.test(v.prop) && /3[\s ]nights/.test(v.prop), `header carries the stay — accent chip + nights (${v.prop.trim()})`);
  ok(v.kind === 'Balance due' && v.amount === '£340.00', `amount hero (${v.kind} ${v.amount})`);
  ok(/of £440\.00 total · £100\.00 already paid/.test(v.sub), `money-shape sub with already-paid (${v.sub})`);
  ok(v.noteShown && /£50\.00 refundable damages deposit — returned after your stay/.test(v.note), 'deposit note is its own quiet line');
  ok(!v.oldBanner, 'the loud green security banner is gone');
  ok(/Secured by Square/.test(v.secure) && /never see or store/.test(v.secure), 'quiet lock line under the button');
  ok(/email receipt/.test(v.receipt), 'receipt reassurance line present');
  ok(v.btn === 'Pay £340.00', `Pay button names the amount (${v.btn})`);
  ok(!v.orShown, 'wallet divider hidden when no wallet mounted');

  // Happy path: tokenize (stub) → charge → receipt state.
  await page.evaluate(() => document.getElementById('pay-btn').click());
  await page.waitForTimeout(700);
  const done = await page.evaluate(() => ({
    done: document.getElementById('pay-done').style.display !== 'none',
    sub: (document.getElementById('pay-done-sub') || {}).textContent || '',
  }));
  const charge = posts.find((p) => p.__url === 'pay.php' && p.action === 'charge');
  ok(!!charge && charge.source_id === 'tok_test_1' && charge.kind === 'balance', `charge posted with the tokenized card (${charge && charge.source_id})`);
  ok(done.done && /paid in full/i.test(done.sub), `receipt state shows (${done.sub.slice(0, 50)}…)`);

  console.log(fails ? `\n  ${fails} PAY-PAGE CHECK(S) FAILED ❌` : '\n  PAY-PAGE SUITE PASSED ✅');
  await harnessDone(fails);
})();
