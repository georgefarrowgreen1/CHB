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
      if (b.__url === 'pay.php' && b.action === 'summary') {
        // The DEPOSIT shape is the audit's custom-price booking: agreed £700, 25%
        // deposit £175, £50 damages deposit riding the first payment → £225 hero.
        if (b.kind === 'deposit') return json({
          ok: true, propName: 'Annex', propKey: 'jollyboat', guestName: 'Debbie McGoldrick',
          checkIn: '2026-08-27', checkOut: '2026-08-30', currency: 'GBP', kind: 'deposit',
          total: 700, alreadyPaid: 0, balance: 700, depositPct: 25, amountDue: 175,
          damagesDue: 50, holdAmount: 50, holdStatus: 'none',
        });
        // Booking 9: the SAME booking after that first payment — deposit CHARGED,
        // balance link opened. The screenshotted state: the card took £225, so
        // "already paid" must say £225 of a £750 stay, never the rental-rail
        // £175 of £700 beside a confirmation and receipt that both say £225.
        if (b.booking_id === '9') return json({
          ok: true, propName: 'Annex', propKey: 'jollyboat', guestName: 'Debbie McGoldrick',
          checkIn: '2026-08-27', checkOut: '2026-08-30', currency: 'GBP', kind: 'balance',
          total: 700, alreadyPaid: 175, balance: 525, depositPct: 25, amountDue: 525,
          damagesDue: 0, depositCharged: 50, holdAmount: 50, holdStatus: 'charged', balanceDueDate: '2020-01-01',
        });
        return json({
          ok: true, propName: 'Annex', propKey: 'jollyboat', guestName: 'Debbie McGoldrick',
          checkIn: '2026-08-27', checkOut: '2026-08-30', currency: 'GBP', kind: 'balance',
          total: 390, alreadyPaid: 100, balance: 290, depositPct: 25, amountDue: 290,
          damagesDue: 50, holdAmount: 0, holdStatus: 'none', balanceDueDate: '2030-01-15',
        });
      }
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
  // WHEN, from the booking's own plan: a future due date joins the headline
  // (fixed far-future stub date so the check can't rot with the wall clock);
  // booking 9's PASSED date stays plain "Balance due" — it is due now.
  ok(v.kind === 'Balance due by 15/01/2030' && v.amount === '£340.00', `amount hero says WHEN (${v.kind} ${v.amount})`);
  // THE SUB ITEMISES TO ITS OWN HEADLINE. £340 is what the card takes — the
  // £290 balance plus the £50 refundable deposit — and the guest should never
  // have to derive that from a sentence further down the page (owner's ask).
  // All four figures reconcile: 440 − 100 = 340, and 290 + 50 = 340.
  ok(/£290\.00 balance \+ £50\.00 refundable deposit/.test(v.sub), `the sub itemises the £340 (${v.sub})`);
  ok(/of £440\.00 total, £100\.00 already paid/.test(v.sub), `…and keeps the stay context (${v.sub})`);
  ok(v.noteShown && /£50\.00 refundable damages deposit — returned after your stay/.test(v.note), 'deposit note is its own quiet line');
  ok(!v.oldBanner, 'the loud green security banner is gone');
  ok(/Secured by Square/.test(v.secure) && /never see or store/.test(v.secure), 'quiet lock line under the button');
  ok(/email receipt/.test(v.receipt), 'receipt reassurance line present');
  ok(v.btn === 'Pay £340.00', `Pay button names the amount (${v.btn})`);
  ok(!v.orShown, 'wallet divider hidden when no wallet mounted');

  // THE DEPOSIT ASK'S SUB-LINE ITEMISES TO ITS OWN HEADLINE. It used to read
  // "25% deposit · £750.00 total" under a £225.00 hero — the percentage was
  // against the rental while the total beside it was the grand, so checking
  // 25% × 750 gives £187.50 and the line never reconciled with the figure the
  // guest is about to pay. Re-open the same booking as a DEPOSIT ask (the stub
  // switches on the posted kind) and require the sub to state the sum.
  await page.evaluate(() => openPayView('paytok', '7', 'deposit'));
  await page.waitForTimeout(900);
  const dv = await page.evaluate(() => ({
    kind: (document.getElementById('pay-kind-label') || {}).textContent || '',
    amount: (document.getElementById('pay-amount') || {}).textContent || '',
    sub: (document.getElementById('pay-amount-sub') || {}).textContent || '',
  }));
  ok(dv.kind === 'Deposit due' && dv.amount === '£225.00', `deposit hero = 25% of £700 + £50 deposit (${dv.kind} ${dv.amount})`);
  ok(/£175\.00 deposit \(25%\) \+ £50\.00 refundable deposit/.test(dv.sub),
    `…and the sub ITEMISES to that headline (${dv.sub})`);
  ok(!/£750\.00 total/.test(dv.sub), '…naming no total its own percentage cannot reach');
  // THE BALANCE ASK AFTER THE DEPOSIT WAS CHARGED — the screenshotted state.
  // "of £700.00 total · £175.00 already paid" under the £525 hero was the rental
  // rail talking to a guest whose card took £225 of a £750 stay; the charged
  // deposit now folds into BOTH sides, and the balance itself is unmoved.
  await page.evaluate(() => openPayView('paytok', '9', 'balance'));
  await page.waitForTimeout(900);
  const cv = await page.evaluate(() => ({
    amount: (document.getElementById('pay-amount') || {}).textContent || '',
    sub: (document.getElementById('pay-amount-sub') || {}).textContent || '',
  }));
  ok(cv.amount === '£525.00', `the balance hero is unmoved by the fold (${cv.amount})`);
  ok(/of £750\.00 total · £225\.00 already paid/.test(cv.sub),
    `…and the sub counts the charged deposit on both sides (${cv.sub})`);
  ok(!/£700\.00/.test(cv.sub) && !/£175\.00/.test(cv.sub),
    '…with the rental-rail figures gone from the guest\'s view');

  // Back to the balance ask for the happy-path charge below.
  await page.evaluate(() => openPayView('paytok', '7', 'balance'));
  await page.waitForTimeout(900);

  // A DECLINED CARD KEEPS THE RETRY ALIVE. The decline must land as an inline
  // message with the form still on screen and the button re-enabled — routed
  // through showPayError it would hide the form behind a terminal panel whose
  // only button is "Back to the site", leaving the guest unable to try another
  // card without re-opening the email link. Nothing gated the distinction.
  await page.route(/pay\.php/, (route) => {
    const b = JSON.parse(route.request().postData() || '{}');
    if (b.action === 'charge') return route.fulfill({ status: 402, contentType: 'application/json', body: JSON.stringify({ error: "Your card couldn't be authorised. Please try another card." }) });
    return route.fallback();
  });
  await page.evaluate(() => document.getElementById('pay-btn').click());
  await page.waitForTimeout(700);
  const declined = await page.evaluate(() => ({
    msg: (document.getElementById('pay-msg') || {}).textContent || '',
    formShown: document.getElementById('pay-body').style.display !== 'none',
    errPanel: (document.getElementById('pay-error') || { style: {} }).style.display !== 'none',
    btnOn: !(document.getElementById('pay-btn') || {}).disabled,
    btnLabel: (document.getElementById('pay-btn') || {}).textContent || '',
  }));
  ok(/try another card/i.test(declined.msg), `a decline says the server's own sentence, inline (${declined.msg.slice(0, 60)})`);
  ok(declined.formShown && !declined.errPanel, 'the card form STAYS — no terminal panel over a retryable failure');
  ok(declined.btnOn && /^Pay £/.test(declined.btnLabel), `the button re-enables with its label back (${declined.btnLabel})`);
  await page.unroute(/pay\.php/);

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
