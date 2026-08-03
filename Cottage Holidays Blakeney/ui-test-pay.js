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
          damagesDue: 50, holdAmount: 50, holdStatus: 'none', balanceDueDate: '2026-07-28',
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
    lines: [...document.querySelectorAll('#pay-amount-sub .pay-line')].map((r) => r.textContent.replace(/\s+/g, ' ').trim()),
    // Summed from the RENDERED figures, so the check is that what is on screen
    // adds up — not that the composer can add.
    lineSum:
      '£' +
      [...document.querySelectorAll('#pay-amount-sub .pay-line-amt')]
        .reduce((a, e) => a + Number(String(e.textContent).replace(/[^0-9.]/g, '') || 0), 0)
        .toFixed(2),
    explains: (((document.querySelector('.pay-amount-box') || {}).textContent || '').match(/returned after your stay|refundable damages deposit/gi) || []).length,
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
  // THE LABEL NAMES WHAT THE FIGURE IS. It said "Balance due by …" over £340
  // while the balance was £290 — the refundable deposit rides this payment, so
  // the hero is a SUM and naming it after one half is the payask defect again
  // (owner's screenshot). With something riding it, the label is neutral.
  ok(v.kind === 'To pay by 15/01/2030' && v.amount === '£340.00', `the hero is named for what it IS, and says when (${v.kind} ${v.amount})`);
  ok(!/balance/i.test(v.kind), '…and never calls a sum of two things the balance');
  // ITEMISED AS ROWS, NOT A SENTENCE. One run-on carried four figures and
  // answered two different questions at once — what am I paying now, and where
  // does that sit in the whole stay. Each row now states one thing.
  ok(v.lines.length === 2, `the sub is a list, not a sentence (${v.lines.length} rows)`);
  ok(/Balance of your stay/.test(v.lines[0] || '') && /£290\.00/.test(v.lines[0] || ''), `row 1 is the balance (${v.lines[0]})`);
  ok(/Refundable deposit/.test(v.lines[1] || '') && /£50\.00/.test(v.lines[1] || ''), `row 2 is the deposit (${v.lines[1]})`);
  // …AND THEY ADD UP TO THE HERO. The whole point of itemising: the guest can
  // check the figure they are about to pay without deriving it.
  ok(v.lineSum === '£340.00', `the rows sum to the hero (${v.lineSum} vs ${v.amount})`);
  // THE DEPOSIT IS EXPLAINED ONCE. It used to be on the sub AND repeated in the
  // note directly beneath — the same £50 twice in adjacent lines, which reads
  // as two deposits until you check.
  ok(/returned after your stay/.test(v.lines[1] || ''), 'the deposit carries its own explanation');
  ok(!/refundable/i.test(v.note), `…and the note does not repeat it (${v.note})`);
  // The stay context survives, on its own line, as context rather than as part
  // of the sum above it. 440 − 100 = 340, so it still reconciles.
  // \s so the NBSP that stops "paid." orphaning onto its own line at 390px
  // still matches — it is a space to a reader and not to a regex.
  ok(v.noteShown && /£440\.00 for the whole stay · £100\.00 already\spaid/.test(v.note), `the note carries the stay context (${v.note})`);
  ok(!v.oldBanner, 'the loud green security banner is gone');
  ok(/Secured by Square/.test(v.secure) && /never see or store/.test(v.secure), 'quiet lock line under the button');
  ok(/email receipt/.test(v.receipt), 'receipt reassurance line present');
  ok(v.btn === 'Pay £340.00', `Pay button names the amount (${v.btn})`);
  ok(!v.orShown, 'wallet divider hidden when no wallet mounted');

  // ---- THE PRIMARY ACTION LOOKS LIKE ONE -----------------------------------
  // It was .btn-glass — a translucent outline — while the two wallet buttons
  // above it are Square-rendered solid black and heavy-bordered white. The
  // action most guests actually take was the faintest thing on the screen.
  const cta = await page.evaluate(() => {
    const b = document.getElementById('pay-btn');
    const c = getComputedStyle(b);
    const card = document.getElementById('sq-card');
    const lum = (str) => {
      const n = (String(str).match(/[\d.]+/g) || []).map(Number);
      if (n.length < 3) return null;
      // getComputedStyle can hand back 0–1 floats where rgb() is 0–255 — the
      // fourth false contrast failure this codebase has produced.
      const sc = n[0] <= 1 && n[1] <= 1 && n[2] <= 1 ? 255 : 1;
      const [r, g, bl] = n.slice(0, 3).map((x) => {
        const v = (x * sc) / 255;
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
    };
    const L1 = lum(c.backgroundColor);
    const L2 = lum(c.color);
    return {
      bg: c.backgroundColor,
      // rgb() carries no alpha, so the trailing number is the BLUE channel —
      // reading it as alpha called a fully opaque button translucent.
      alpha: /^rgba\(/.test(c.backgroundColor)
        ? Number((c.backgroundColor.match(/[\d.]+\s*\)$/) || ['1)'])[0].replace(/[\s)]/g, ''))
        : 1,
      shadow: c.boxShadow,
      // Compared against a BARE .btn-glass in the same document: that class
      // already carries a shadow, so "has one" passed with the accent glow
      // deleted. What must be true is that this button is lifted DIFFERENTLY
      // from an ordinary one.
      plainShadow: (() => {
        const probe = document.createElement('button');
        probe.className = 'btn-glass';
        probe.style.cssText = 'position:absolute;left:-9999px';
        document.body.appendChild(probe);
        const sh = getComputedStyle(probe).boxShadow;
        probe.remove();
        return sh;
      })(),
      weight: c.fontWeight,
      ratio: L1 === null || L2 === null ? 0 : (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05),
      accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
      cardBorder: getComputedStyle(card).borderTopWidth,
      cardBg: getComputedStyle(card).backgroundColor,
      // Exactly one of the two names the card field — never both, never neither.
      names:
        (document.getElementById('sq-or').style.display !== 'none' ? 1 : 0) +
        (document.getElementById('sq-card-label').style.display !== 'none' ? 1 : 0),
    };
  });
  ok(cta.alpha === 1, `the Pay button is FILLED, not translucent glass (${cta.bg})`);
  ok(/^rgb/.test(cta.bg) && cta.bg !== 'rgba(0, 0, 0, 0)', 'it has a real background');
  ok(cta.shadow && cta.shadow !== 'none' && cta.shadow !== cta.plainShadow,
    'it is lifted differently from an ordinary glass button, so it sits above the form');
  ok(Number(cta.weight) >= 600, `its label is weighted (${cta.weight})`);
  // --accent-ink, not white: the rose-gold is mid-light and white fails AA on
  // it. This is the words-vs-things rule, on the one control that must be read.
  ok(cta.ratio >= 4.5, `its label clears AA on the accent (${cta.ratio.toFixed(2)}:1)`);
  // WE DO NOT DRAW THIS FIELD. Square's card element renders its own bordered
  // box inside an iframe that is TALLER than what it paints (it reserves room
  // for an inline error). A wrapper therefore double-borders their field AND
  // turns that reserved room into a visible empty box — both measured on the
  // live SDK after a frame was added here, and invisible to a local stub, which
  // renders only what it paints.
  ok(parseFloat(cta.cardBorder) === 0, `the card container adds no second edge around Square's own field (${cta.cardBorder})`);
  ok(/rgba\(0, 0, 0, 0\)|transparent/.test(cta.cardBg), `…and no fill that would box its reserved space (${cta.cardBg})`);
  // ONE LABEL, NOT TWO. With a wallet up, "or pay by card" and "Card details"
  // are the same statement in adjacent lines.
  ok(cta.names === 1, `exactly one thing names the card field (${cta.names})`);
  const appSrcCta = require('fs').readFileSync(__dirname + '/app.js', 'utf8');
  ok(/lblEl\.style\.display = any \? 'none' : ''/.test(appSrcCta), '…driven off the same flag as the divider, so they cannot both show');

  // THE DEPOSIT ASK'S SUB-LINE ITEMISES TO ITS OWN HEADLINE. It used to read
  // "25% deposit · £750.00 total" under a £225.00 hero — the percentage was
  // against the rental while the total beside it was the grand, so checking
  // 25% × 750 gives £187.50 and the line never reconciled with the figure the
  // guest is about to pay. Re-open the same booking as a DEPOSIT ask (the stub
  // switches on the posted kind) and require the sub to state the sum.
  await page.evaluate(() => openPayView('paytok', '7', 'deposit'));
  await page.waitForTimeout(900);
  const dv = await page.evaluate(() => ({
    note: (document.getElementById('pay-amount-note') || {}).textContent || '',
    kind: (document.getElementById('pay-kind-label') || {}).textContent || '',
    amount: (document.getElementById('pay-amount') || {}).textContent || '',
    sub: (document.getElementById('pay-amount-sub') || {}).textContent || '',
    lines: [...document.querySelectorAll('#pay-amount-sub .pay-line')].map((r) => r.textContent.replace(/\s+/g, ' ').trim()),
    lineSum:
      '£' +
      [...document.querySelectorAll('#pay-amount-sub .pay-line-amt')]
        .reduce((a, e) => a + Number(String(e.textContent).replace(/[^0-9.]/g, '') || 0), 0)
        .toFixed(2),
    explains: (((document.querySelector('.pay-amount-box') || {}).textContent || '').match(/returned after your stay|refundable damages deposit/gi) || []).length,
  }));
  ok(dv.kind === 'To pay now' && dv.amount === '£225.00', `deposit hero = 25% of £700 + £50 deposit (${dv.kind} ${dv.amount})`);
  ok(!/deposit due/i.test(dv.kind), '…not called "Deposit due" when the refundable deposit rides it too');
  ok(/Deposit \(25%\)/.test(dv.lines[0] || '') && /£175\.00/.test(dv.lines[0] || ''), `row 1 is the deposit and its share (${dv.lines[0]})`);
  ok(/Refundable deposit/.test(dv.lines[1] || '') && /£50\.00/.test(dv.lines[1] || ''), `row 2 is the refundable one (${dv.lines[1]})`);
  ok(dv.lineSum === '£225.00', `…and the rows sum to the headline (${dv.lineSum})`);
  ok(!/£750\.00 total/.test(dv.sub), '…naming no total its own percentage cannot reach');
  // …AND THE SCREEN SAYS WHAT FOLLOWS. balanceDueDate has always been in this
  // payload and was rendered only when kind === 'balance', so the guest learned
  // the date on the screen where they were already paying it. £700 − £175 = the
  // £525 left; the date is the booking's own, so the chaser that follows cannot
  // quote a different day.
  ok(/balance of £525\.00 is due by 28\/07\/2026/i.test(dv.note),
    `the deposit screen states the balance and WHEN (${dv.note})`);
  // …AND THE REFUNDABLE DEPOSIT IS EXPLAINED EXACTLY ONCE ON THE SCREEN. This
  // check used to require that sentence in the NOTE, which is where the
  // duplicate lived — it was pinning the defect. Counted across the whole box
  // instead, so neither a repeat nor a disappearance can pass.
  ok(dv.explains === 1, `the deposit is explained once, not twice or never (${dv.explains})`);
  // SETTLE IT ALL NOW. booking_payment_kind already passed a requested
  // 'balance' through, so the whole amount was always chargeable — there was
  // simply no way to ask for it. £225 due now + £525 left = the £750 stay.
  const full = await page.evaluate(() => {
    const b = document.getElementById('pay-full');
    return { txt: (b || {}).textContent || '', shown: !!b && b.style.display !== 'none' };
  });
  ok(full.shown && /£750\.00/.test(full.txt), `the deposit screen offers to settle the whole stay (${full.txt})`);
  // …and it re-opens the SAME booking asking for everything, which the server
  // then re-derives — the client decides nothing about the charge.
  const reopened = await page.evaluate(async () => {
    const calls = [];
    const orig = window.openPayView;
    window.openPayView = (t, id, k) => { calls.push([t, id, k]); return Promise.resolve(); };
    payInFull();
    window.openPayView = orig;
    return calls;
  });
  ok(reopened.length === 1 && reopened[0][2] === 'balance' && String(reopened[0][1]) === '7',
    `…by re-opening this booking as a balance ask (${JSON.stringify(reopened)})`);

  // ONE PAY LINK — deliberately AFTER the payInFull check above, which asserts
  // WHICH booking is reopened: this re-points payState at another one.
  // Opened from a URL, the client states NO stage — the server
  // reads it off the booking, so the same link follows the plan instead of
  // promising a stage that was true when the email was sent. The old URL ended
  // &k=deposit, and a guest reopening it after paying got a £0 screen.
  await page.evaluate(() => openPayView('paytok', '9', null));
  await page.waitForTimeout(700);
  const linkPost = posts.filter((p) => p.__url === 'pay.php' && p.action === 'summary').pop();
  ok(!!linkPost && (linkPost.kind === null || linkPost.kind === undefined),
    `a link-opened pay screen names no stage (${JSON.stringify(linkPost && linkPost.kind)})`);
  // …and it PINS what came back, so the charge asks for the stage this screen
  // quoted rather than re-deriving against money that landed in between.
  const pinned = await page.evaluate(() => payState.kind);
  ok(pinned === 'balance', `…then pins the stage the server resolved (${pinned})`);
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
