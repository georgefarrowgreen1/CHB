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
        // Booking 13: MID-PLAN WITH A FAILED TRY — the summary carries
        // autopayRepair (kind is 'balance', so autopayTerms is null and the
        // consent card cannot render; the repair card is the only affordance).
        if (b.booking_id === '13') return json({
          ok: true, propName: 'Annex', propKey: 'jollyboat', guestName: 'Debbie McGoldrick',
          checkIn: '2026-11-27', checkOut: '2026-11-30', currency: 'GBP', kind: 'balance',
          total: 700, alreadyPaid: 350, balance: 350, depositPct: 25, amountDue: 350,
          damagesDue: 0, depositCharged: 50, holdAmount: 50, holdStatus: 'charged', balanceDueDate: '2026-10-28',
          part: { min: 20, max: 350 }, quote: '13:balance:350.00:0123456789abcdef0123456789abcdef',
          autopayTerms: null, autopayState: 'armed', instalmentOffer: null,
          autopayRepair: { stopped: false, why: 'The card was declined.', monthly: true, retry: '2026-08-30' },
        });
        // Booking 12: the deposit ask when the monthly offer is ABSENT — the
        // owner's floor, or a plan that cannot fit; either way pay.php sends
        // instalmentOffer null. Checked BEFORE the generic deposit shape.
        if (b.booking_id === '12') return json({
          ok: true, propName: 'Annex', propKey: 'jollyboat', guestName: 'Debbie McGoldrick',
          checkIn: '2026-08-27', checkOut: '2026-08-30', currency: 'GBP', kind: 'deposit',
          total: 700, alreadyPaid: 0, balance: 700, depositPct: 25, amountDue: 175,
          damagesDue: 50, holdAmount: 50, holdStatus: 'none', balanceDueDate: '2026-07-28',
          part: { min: 20, max: 175 }, quote: '12:deposit:225.00:0123456789abcdef0123456789abcdef',
          autopayTerms: { amount: 525, due: '2026-10-28' }, autopayState: 'off',
          instalmentOffer: null,
        });
        // The DEPOSIT shape is the audit's custom-price booking: agreed £700, 25%
        // deposit £175, £50 damages deposit riding the first payment → £225 hero.
        if (b.kind === 'deposit') return json({
          ok: true, propName: 'Annex', propKey: 'jollyboat', guestName: 'Debbie McGoldrick',
          checkIn: '2026-08-27', checkOut: '2026-08-30', currency: 'GBP', kind: 'deposit',
          total: 700, alreadyPaid: 0, balance: 700, depositPct: 25, amountDue: 175,
          damagesDue: 50, holdAmount: 50, holdStatus: 'none', balanceDueDate: '2026-07-28',
          part: { min: 20, max: 175 }, quote: '8:deposit:225.00:0123456789abcdef0123456789abcdef',
          // The arrangement is offered on the deposit ask (its real home —
          // booking_autopay_terms only ever fires there): rest £525 by the due
          // date, with the server-derived monthly offer beside it.
          autopayTerms: { amount: 525, due: '2026-10-28' }, autopayState: 'off',
          instalmentOffer: { n: 3, per: 175, last: 175, due: '2026-10-28', dates: ['2026-08-28', '2026-09-28', '2026-10-28'] },
        });
        // Booking 5: a balance under the part-payment floor, so the server sends
        // NO bounds. The offer must not appear — it can only ever show what the
        // charge would honour.
        if (b.booking_id === '5') return json({
          ok: true, propName: 'Annex', propKey: 'jollyboat', guestName: 'Debbie McGoldrick',
          checkIn: '2026-08-27', checkOut: '2026-08-30', currency: 'GBP', kind: 'balance',
          total: 390, alreadyPaid: 375, balance: 15, depositPct: 25, amountDue: 15,
          damagesDue: 0, holdAmount: 0, holdStatus: 'none', balanceDueDate: '2030-01-15',
          part: null, quote: '5:balance:15.00:0123456789abcdef0123456789abcdef',
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
          part: { min: 20, max: 525 }, quote: '9:balance:525.00:0123456789abcdef0123456789abcdef',
        });
        return json({
          ok: true, propName: 'Annex', propKey: 'jollyboat', guestName: 'Debbie McGoldrick',
          checkIn: '2026-08-27', checkOut: '2026-08-30', currency: 'GBP', kind: 'balance',
          total: 390, alreadyPaid: 100, balance: 290, depositPct: 25, amountDue: 290,
          damagesDue: 50, holdAmount: 0, holdStatus: 'none', balanceDueDate: '2030-01-15',
          part: { min: 20, max: 290 }, quote: '7:balance:340.00:0123456789abcdef0123456789abcdef',
        });
      }
      if (b.__url === 'pay.php' && b.action === 'update_card') {
        return json({ ok: true, say: 'Card updated — the plan carries on, and nothing was charged today.', autopayState: 'armed' });
      }
      if (b.__url === 'pay.php' && b.action === 'charge') {
        // Echo the slice AND the arrangement like the real endpoint: a part
        // request comes back partial with the server-derived `remaining`; a
        // consent comes back with its outcome (booking 8 is the stub's
        // vault-failure case). A deposit-stage full charge is not fullyPaid.
        const slice = Number(b.part_amount || 0);
        const autopay = !b.autopay
          ? null
          : b.booking_id === '8'
            ? { ok: false }
            : b.autopay_instalments > 0
              ? { ok: true, monthly: true, n: b.autopay_instalments, per: 175, next: '2026-08-28', due: '2026-10-28' }
              : { ok: true, monthly: false, n: 1, per: 525, next: null, due: '2026-10-28' };
        if (slice > 0) return json({ ok: true, fullyPaid: false, charged: slice, remaining: Math.round((340 - slice) * 100) / 100, autopay });
        return json(b.kind === 'deposit'
          ? { ok: true, fullyPaid: false, charged: 225, remaining: 0, autopay }
          : { ok: true, fullyPaid: true, charged: 340, remaining: 0, autopay });
      }
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
  // Re-aimed to payMethodsSync (the plan-first build): the divider and the
  // label are complements of ONE expression there, so they still cannot both
  // show — and the expression now folds in the plan choice too.
  const appSrcCta = require('fs').readFileSync(__dirname + '/app.js', 'utf8');
  ok(/show\('sq-or', wallets && !auto\);/.test(appSrcCta) && /show\('sq-card-label', !\(wallets && !auto\)\);/.test(appSrcCta),
    '…driven as complements of one expression in payMethodsSync, so they cannot both show');

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

  // ============================================================
  //  PART PAYMENT — "I can pay some of it now."
  //  The client only ever ASKS: pay.php sends the bounds and clamps the charge
  //  into them, so the offer appears ONLY where the server said there is room,
  //  and what the guest reads is what the button sends.
  // ============================================================
  await page.evaluate(() => openPayView('paytok', '5', 'balance'));
  await page.waitForTimeout(900);
  const noPart = await page.evaluate(() => (document.getElementById('pay-part') || { style: {} }).style.display);
  ok(noPart === 'none', `no bounds from the server → no offer (${noPart})`);

  await page.evaluate(() => openPayView('paytok', '7', 'balance'));
  await page.waitForTimeout(900);
  const rest0 = await page.evaluate(() => ({
    offered: (document.getElementById('pay-part') || { style: {} }).style.display !== 'none',
    tog: (document.getElementById('pay-part-toggle') || {}).textContent || '',
    rowOpen: (document.getElementById('pay-part-row') || { style: {} }).style.display !== 'none',
    hero: (document.getElementById('pay-amount') || {}).textContent || '',
    btn: (document.getElementById('pay-btn') || {}).textContent || '',
  }));
  ok(rest0.offered && !rest0.rowOpen, 'the offer is there, folded away');
  ok(/pay part of it/i.test(rest0.tog), `…and names itself in plain words (${rest0.tog})`);

  // OPEN IT. With no valid amount typed there is nothing to charge, so the
  // wallets come down (and the "Pay" button waits) — they return, priced to the
  // slice, the moment a valid amount is entered. The dedicated wallet section
  // below drives that with a working wallet stub.
  await page.evaluate(() => document.getElementById('pay-part-toggle').click());
  await page.waitForTimeout(200);
  const opened = await page.evaluate(() => ({
    rowOpen: (document.getElementById('pay-part-row') || { style: {} }).style.display !== 'none',
    expanded: (document.getElementById('pay-part-toggle') || { getAttribute: () => '' }).getAttribute('aria-expanded'),
    tog: (document.getElementById('pay-part-toggle') || {}).textContent || '',
    hint: (document.getElementById('pay-part-hint') || {}).textContent || '',
    wallets: (document.getElementById('sq-wallets') || { style: {} }).style.display,
    or: (document.getElementById('sq-or') || { style: {} }).style.display,
    btnOff: !!(document.getElementById('pay-btn') || {}).disabled,
    hero: (document.getElementById('pay-amount') || {}).textContent || '',
  }));
  ok(opened.rowOpen && opened.expanded === 'true', 'opening reveals the field and says so to a screen reader');
  ok(/Pay the full £340\.00 instead/.test(opened.tog), `…and the toggle becomes the way back (${opened.tog})`);
  ok(/from £20\.00 to £290\.00/.test(opened.hint), `the hint states the SERVER's bounds (${opened.hint})`);
  // The max is the rental due, not the hero — the refundable deposit rides the
  // payment that completes the stage, and the hint has to say where it went or
  // "up to £290" under a £340 headline reads as an error.
  ok(/refundable £50\.00 deposit follows/.test(opened.hint), '…and where the refundable deposit went');
  ok(opened.wallets === 'none' && opened.or === 'none', `no valid amount yet → nothing to charge, wallets down (${opened.wallets}/${opened.or})`);
  ok(opened.btnOff, 'nothing typed yet → the button waits rather than charging the full amount');
  ok(opened.hero === '£340.00', `…and the hero has not moved yet (${opened.hero})`);

  // TYPE A REAL AMOUNT. One number on screen: the hero, the hint and the button
  // all become the slice, and what remains is stated rather than inferred.
  await page.evaluate(() => {
    const a = document.getElementById('pay-part-amt');
    a.value = '120';
    a.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(200);
  const armed = await page.evaluate(() => ({
    hero: (document.getElementById('pay-amount') || {}).textContent || '',
    label: (document.getElementById('pay-kind-label') || {}).textContent || '',
    sub: (document.getElementById('pay-amount-sub') || {}).textContent || '',
    hint: (document.getElementById('pay-part-hint') || {}).textContent || '',
    btn: (document.getElementById('pay-btn') || {}).textContent || '',
    btnOff: !!(document.getElementById('pay-btn') || {}).disabled,
    full: (document.getElementById('pay-full') || { style: {} }).style.display,
  }));
  ok(armed.hero === '£120.00' && /Paying now/i.test(armed.label), `the hero becomes the slice (${armed.label} ${armed.hero})`);
  ok(armed.btn === 'Pay £120.00' && !armed.btnOff, `…and the button says the same figure (${armed.btn})`);
  ok(/£220\.00 would remain/.test(armed.sub) && /£220\.00 would remain/.test(armed.hint),
    `…with what is left stated, not inferred (${armed.sub})`);
  ok(armed.full === 'none', 'the settle-it-all link stands down — it contradicts the slice');

  // OUT OF BOUNDS ARMS NOTHING. Deliberately not clamped as they type, which
  // would turn "5" on the way to "50" into the minimum under their fingers.
  await page.evaluate(() => {
    const a = document.getElementById('pay-part-amt');
    a.value = '5';
    a.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(200);
  const bad = await page.evaluate(() => ({
    hero: (document.getElementById('pay-amount') || {}).textContent || '',
    btnOff: !!(document.getElementById('pay-btn') || {}).disabled,
    hint: (document.getElementById('pay-part-hint') || {}).textContent || '',
  }));
  ok(bad.btnOff && bad.hero === '£340.00', `an amount outside the bounds arms nothing (${bad.hero})`);
  ok(/between £20\.00 and £290\.00/.test(bad.hint), `…and the hint says what is needed (${bad.hint})`);
  // THE OWNER'S SCREENSHOT: "£340 to pay" directly above "between £20.00 and
  // £290.00" with nothing reconciling them. The max is the rental due — the
  // refundable deposit can't be split, it rides the payment that completes the
  // stage — and the out-of-bounds state was the ONE bounds-showing state that
  // didn't say so.
  ok(/refundable £50\.00 deposit follows/.test(bad.hint),
    `…and reconciles the £290 ceiling with the £340 headline (${bad.hint})`);

  // TYPING FREE, COMMIT CLAMPED (the owner's ask): an out-of-bounds figure
  // snaps to the nearest bound when the number is FINISHED — change fires on
  // blur or Enter — never per keystroke (the un-clamped mid-typing state is
  // the check directly above). The field still holds the '5' from that check.
  await page.evaluate(() => document.getElementById('pay-part-amt').dispatchEvent(new Event('change', { bubbles: true })));
  await page.waitForTimeout(200);
  const snapMin = await page.evaluate(() => ({
    val: /** @type {HTMLInputElement} */ (document.getElementById('pay-part-amt')).value,
    hero: (document.getElementById('pay-amount') || {}).textContent || '',
    btn: (document.getElementById('pay-btn') || {}).textContent || '',
    btnOff: !!(document.getElementById('pay-btn') || {}).disabled,
    hint: (document.getElementById('pay-part-hint') || {}).textContent || '',
  }));
  ok(snapMin.val === '20' && snapMin.hero === '£20.00' && snapMin.btn === 'Pay £20.00' && !snapMin.btnOff,
    `committing an under-minimum figure snaps it up and arms it (${snapMin.val} → ${snapMin.btn})`);
  ok(/Adjusted up to the £20\.00 minimum/.test(snapMin.hint) && /£320\.00 would remain/.test(snapMin.hint),
    `…and the hint announces the correction (${snapMin.hint})`);
  await page.evaluate(() => {
    const a = /** @type {HTMLInputElement} */ (document.getElementById('pay-part-amt'));
    a.value = '5000';
    a.dispatchEvent(new Event('input', { bubbles: true }));
    a.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForTimeout(200);
  const snapMax = await page.evaluate(() => ({
    val: /** @type {HTMLInputElement} */ (document.getElementById('pay-part-amt')).value,
    btn: (document.getElementById('pay-btn') || {}).textContent || '',
    hint: (document.getElementById('pay-part-hint') || {}).textContent || '',
  }));
  ok(snapMax.val === '290' && snapMax.btn === 'Pay £290.00', `an over-maximum figure snaps down (${snapMax.val} → ${snapMax.btn})`);
  ok(/Adjusted down to the £290\.00 maximum/.test(snapMax.hint), `…named as the maximum (${snapMax.hint})`);
  // Typing again clears the note; an in-bounds commit is left exactly as typed.
  await page.evaluate(() => {
    const a = /** @type {HTMLInputElement} */ (document.getElementById('pay-part-amt'));
    a.value = '120';
    a.dispatchEvent(new Event('input', { bubbles: true }));
    a.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForTimeout(200);
  const snapNone = await page.evaluate(() => ({
    val: /** @type {HTMLInputElement} */ (document.getElementById('pay-part-amt')).value,
    hint: (document.getElementById('pay-part-hint') || {}).textContent || '',
  }));
  ok(snapNone.val === '120' && !/Adjusted/.test(snapNone.hint) && /£220\.00 would remain/.test(snapNone.hint),
    `an in-bounds commit is untouched and the note clears (${snapNone.hint})`);
  // Committing an EMPTY field corrects nothing — blank is "not choosing", and
  // inventing the minimum there would arm a payment nobody typed.
  await page.evaluate(() => {
    const a = /** @type {HTMLInputElement} */ (document.getElementById('pay-part-amt'));
    a.value = '';
    a.dispatchEvent(new Event('input', { bubbles: true }));
    a.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForTimeout(200);
  const snapEmpty = await page.evaluate(() => ({
    val: /** @type {HTMLInputElement} */ (document.getElementById('pay-part-amt')).value,
    btnOff: !!(document.getElementById('pay-btn') || {}).disabled,
  }));
  ok(snapEmpty.val === '' && snapEmpty.btnOff, 'an empty commit stays empty — blank is not a choice');

  // ============================================================
  //  MOTION — the journey eases instead of cutting. Entrances are CSS
  //  animations that replay whenever a panel goes display:none → shown, and
  //  the hero ticks over on a real figure change (the .pay-amt-swap kick in
  //  payPartRender — several figures have changed by this point in the suite,
  //  so the class must be on). Reduced motion is asserted as the RULE via
  //  CSSOM: Chromium's reduce emulation forces every duration to ~0
  //  regardless of author CSS, so a computed read cannot tell our off-switch
  //  from the browser's own (the coach-marks lesson).
  // ============================================================
  const motion = await page.evaluate(() => {
    const an = (el) => (el ? getComputedStyle(el).animationName : '');
    let rmRule = false;
    let rmStroke = false;
    for (const ss of document.styleSheets) {
      let rules;
      try { rules = ss.cssRules; } catch (e) { continue; }
      for (const r of rules) {
        // NB Chromium serializes `animation: none` long-hand ("animation:
        // auto ease 0s 1 normal none running none"), so match the reset
        // loosely — the break-test (deleting the block) still fails this.
        if (r.media && /prefers-reduced-motion/.test(r.media.mediaText)) {
          if (/#pay-body/.test(r.cssText) && /animation:[^;]*none/.test(r.cssText)) rmRule = true;
          // The DRAW starts invisible: reduced motion must restore the tick's
          // strokes or the setting deletes the mark itself.
          if (/\.pay-done-tick circle/.test(r.cssText) && /stroke-dashoffset:\s*0/.test(r.cssText)) rmStroke = true;
        }
      }
    }
    const btn = document.getElementById('pay-btn');
    btn.classList.add('is-busy');
    const spin = getComputedStyle(btn, '::after').animationName;
    btn.classList.remove('is-busy');
    return {
      body: an(document.getElementById('pay-body')),
      row: an(document.getElementById('pay-part-row')),
      express: an(document.getElementById('pay-express')),
      amt: an(document.getElementById('pay-amount')),
      swapClass: document.getElementById('pay-amount').classList.contains('pay-amt-swap'),
      // The sheet CASCADE: later form blocks land later (backwards fill).
      partDelay: parseFloat(getComputedStyle(document.getElementById('pay-part')).animationDelay),
      expressDelay: parseFloat(getComputedStyle(document.getElementById('pay-express')).animationDelay),
      spin,
      rmRule,
      rmStroke,
    };
  });
  ok(motion.body === 'payRise', `the form eases in rather than cutting (${motion.body})`);
  ok(motion.row === 'payRise' && motion.express === 'payRise', `the part row and express panel ease in when they appear (${motion.row}/${motion.express})`);
  ok(motion.amt === 'payAmtSwap' && motion.swapClass, `the hero ticks over when its figure changes (${motion.amt})`);
  ok(motion.expressDelay > motion.partDelay, `the form blocks CASCADE like the Apple Pay sheet (${motion.partDelay}s → ${motion.expressDelay}s)`);
  ok(motion.spin === 'paySpin', `the Pay button carries a spinner while money moves (${motion.spin})`);
  ok(motion.rmRule, 'reduced motion stands ALL of it down — asserted as the rule, not a computed read');
  ok(motion.rmStroke, '…and restores the drawn tick\'s strokes, or the setting would delete the mark');

  // CLOSING PUTS THE SCREEN BACK EXACTLY. The resting view is snapshotted, so
  // the sub's itemised lines and the settle-it-all link return as they were.
  await page.evaluate(() => document.getElementById('pay-part-toggle').click());
  await page.waitForTimeout(200);
  const closed = await page.evaluate(() => ({
    hero: (document.getElementById('pay-amount') || {}).textContent || '',
    label: (document.getElementById('pay-kind-label') || {}).textContent || '',
    btn: (document.getElementById('pay-btn') || {}).textContent || '',
    btnOff: !!(document.getElementById('pay-btn') || {}).disabled,
    lines: !!(document.getElementById('pay-amount-sub') || { classList: { contains: () => false } }).classList.contains('is-lines'),
    amt: (document.getElementById('pay-part-amt') || {}).value,
    expanded: (document.getElementById('pay-part-toggle') || { getAttribute: () => '' }).getAttribute('aria-expanded'),
  }));
  ok(closed.hero === '£340.00' && closed.btn === 'Pay £340.00' && !closed.btnOff,
    `closing restores the full ask (${closed.label} ${closed.hero} / ${closed.btn})`);
  ok(closed.lines, '…including the itemised sub it replaced');
  ok(closed.amt === '' && closed.expanded === 'false', '…and the field is emptied, so reopening starts clean');

  // AND THE CHARGE CARRIES THE REQUEST. It is a request, not a decision —
  // pay.php clamps it — but it must be the figure the guest read on the button.
  await page.evaluate(() => document.getElementById('pay-part-toggle').click());
  await page.waitForTimeout(150);
  await page.evaluate(() => {
    const a = document.getElementById('pay-part-amt');
    a.value = '120';
    a.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(150);
  await page.evaluate(() => document.getElementById('pay-btn').click());
  await page.waitForTimeout(700);
  const partCharge = posts.filter((p) => p.__url === 'pay.php' && p.action === 'charge').pop();
  ok(!!partCharge && partCharge.part_amount === 120, `the charge asks for the figure on the button (${partCharge && partCharge.part_amount})`);
  // The quote still covers the FULL charge — pay.php verifies it BEFORE taking
  // the slice, so a moved balance is caught on the figure the guest actually read.
  ok(!!partCharge && typeof partCharge.quote === 'string' && partCharge.quote !== '',
    '…while the signed quote still describes the whole amount');

  // ============================================================
  //  THE DONE SCREEN AFTER A SLICE IS NOT A DEAD END. It states the server's
  //  own `remaining` (the part hint's "£220 would remain" figure) and offers
  //  to take it now — the button re-opens this same screen, which re-asks the
  //  server for what is NOW left. Before this it said only "we'll be in touch",
  //  closing the door on a guest ready to pay the rest.
  // ============================================================
  const partDone = await page.evaluate(() => ({
    shown: document.getElementById('pay-done').style.display !== 'none',
    sub: (document.getElementById('pay-done-sub') || {}).textContent || '',
    btnShown: (document.getElementById('pay-done-rest') || { style: {} }).style.display !== 'none',
    btnLabel: (document.getElementById('pay-done-rest') || {}).textContent || '',
  }));
  ok(partDone.shown && /£120\.00 received/.test(partDone.sub), `the slice's done screen names what was taken (${partDone.sub.slice(0, 40)}…)`);
  ok(/£220\.00 is still to pay/.test(partDone.sub), `…and states the server's remaining figure (${partDone.sub.slice(40, 110)})`);
  ok(!/paid in full/i.test(partDone.sub), '…never calling a part payment paid in full');
  ok(partDone.btnShown && partDone.btnLabel === 'Pay the remaining £220.00', `…with a button named for the figure (${partDone.btnLabel})`);
  // Tap it: the pay screen re-opens and RE-ASKS the server — the client decides
  // nothing about what is now due.
  const sumBefore = posts.filter((p) => p.__url === 'pay.php' && p.action === 'summary').length;
  await page.evaluate(() => document.getElementById('pay-done-rest').click());
  await page.waitForTimeout(900);
  const reAsk = posts.filter((p) => p.__url === 'pay.php' && p.action === 'summary').slice(sumBefore).pop();
  const restView = await page.evaluate(() => ({
    body: document.getElementById('pay-body').style.display !== 'none',
    done: document.getElementById('pay-done').style.display !== 'none',
  }));
  ok(!!reAsk && String(reAsk.booking_id) === '7', `"Pay the rest" re-asks the server about the same booking (${reAsk && reAsk.booking_id})`);
  ok(restView.body && !restView.done, '…and the payment form is back on screen');

  // ============================================================
  //  THE ARRANGEMENT IS ONE THREE-WAY DECISION — I'll pay it myself (the
  //  DEFAULT: consent is opted INTO), one payment, or monthly with the dated
  //  schedule and its sum CLOSED on screen. It still stands down (and resets
  //  to the default) while a part slice is being chosen — a consent chosen
  //  for the full payment must never ride a slice invisibly.
  // ============================================================
  await page.evaluate(() => openPayView('paytok', '7', 'deposit'));
  await page.waitForTimeout(900);
  const ap0 = await page.evaluate(() => ({
    shown: (document.getElementById('pay-autopay') || { style: {} }).style.display !== 'none',
    cap: (document.getElementById('pay-ap-cap') || {}).textContent || '',
    lead: (document.querySelector('.pay-ap-lead') || {}).textContent || '',
    radios: document.querySelectorAll('input[name="pay-ap-choice"]').length,
    selfChecked: !!(document.querySelector('input[name="pay-ap-choice"][value="self"]') || {}).checked,
    oneSub: (document.querySelectorAll('.pay-ap-sub')[1] || {}).textContent || '',
    monthlyFig: [...document.querySelectorAll('.pay-ap-fig')].map((e) => e.textContent).join('|'),
    railRows: document.querySelectorAll('.pay-ap-body .ap-row').length,
    fine: (document.querySelector('.pay-ap-fine') || {}).textContent || '',
  }));
  ok(ap0.shown && /£525\.00 that's left/.test(ap0.cap), `the card is captioned with the SUM (${ap0.cap})`);
  ok(/Due by 28\/10\/2026/.test(ap0.lead), `…and the lead carries the DAY (${ap0.lead})`);
  ok(ap0.radios === 3, `three ways to handle it (${ap0.radios})`);
  ok(ap0.selfChecked, "the DEFAULT is \"I'll pay it myself\" — consent is opted into, never out of");
  ok(/taken automatically on 28\/10\/2026/.test(ap0.oneSub), `the one-payment option states its consequence (${ap0.oneSub})`);
  ok(/3 × £175\.00/.test(ap0.monthlyFig), `the monthly option leads with its shape (${ap0.monthlyFig})`);
  ok(ap0.railRows === 0, 'the schedule stays folded until monthly is chosen');
  // THE FINE PRINT FOLLOWS THE SELECTION, not merely the offer. At the default
  // "I'll pay it myself" it must NOT promise "we'll email you before each
  // payment" (an arrangement the guest hasn't made) — it invites instead.
  ok(/Choose an automatic option/.test(ap0.fine) && !/each payment/.test(ap0.fine),
    `the default self fine print invites, it doesn't promise emails (${ap0.fine.slice(0, 50)}…)`);
  const fineMo = await page.evaluate(() => {
    const r = document.querySelector('input[name="pay-ap-choice"][value="monthly"]');
    r.checked = true;
    r.dispatchEvent(new Event('change', { bubbles: true }));
    return (document.querySelector('.pay-ap-fine') || {}).textContent || '';
  });
  ok(/each payment/.test(fineMo), `choosing monthly makes it speak plural (${fineMo.slice(0, 44)}…)`);
  const fineOne = await page.evaluate(() => {
    const r = document.querySelector('input[name="pay-ap-choice"][value="one"]');
    r.checked = true;
    r.dispatchEvent(new Event('change', { bubbles: true }));
    return (document.querySelector('.pay-ap-fine') || {}).textContent || '';
  });
  ok(/before it's taken/.test(fineOne) && !/each payment/.test(fineOne), `choosing one payment speaks singular (${fineOne.slice(0, 44)}…)`);
  // THE FLOOR'S GUEST FACE: the same deposit ask when pay.php sends NO offer
  // (the owner's floor, or a plan that cannot fit). The card falls to its
  // two-way form and the fine print goes SINGULAR — "each payment" is a
  // promise about a plan that is not on the card.
  await page.evaluate(() => openPayView('paytok', '12', 'deposit'));
  await page.waitForTimeout(900);
  const apNo = await page.evaluate(() => ({
    shown: (document.getElementById('pay-autopay') || { style: {} }).style.display !== 'none',
    radios: document.querySelectorAll('input[name="pay-ap-choice"]').length,
    monthly: !!document.querySelector('input[name="pay-ap-choice"][value="monthly"]'),
    fine: (document.querySelector('.pay-ap-fine') || {}).textContent || '',
  }));
  ok(apNo.shown && apNo.radios === 2 && !apNo.monthly, `no offer → the two-way card (${apNo.radios} ways, monthly ${apNo.monthly})`);
  ok(/Choose an automatic option/.test(apNo.fine) && !/each payment/.test(apNo.fine),
    `…whose default fine print invites, never promising a plan not on the card (${apNo.fine.slice(0, 50)}…)`);
  const apNoOne = await page.evaluate(() => {
    const r = document.querySelector('input[name="pay-ap-choice"][value="one"]');
    r.checked = true;
    r.dispatchEvent(new Event('change', { bubbles: true }));
    return (document.querySelector('.pay-ap-fine') || {}).textContent || '';
  });
  ok(/before it's taken/.test(apNoOne), `…and choosing the one payment speaks singular (${apNoOne.slice(0, 44)}…)`);
  ok(await page.evaluate(() => (document.getElementById('pay-repair') || { style: {} }).style.display === 'none'),
    'no failed try → no repair card');
  // THE REPAIR CARD — mid-plan with a failed try, autopayTerms null, so this
  // is the only affordance the failure email can point at. Its save action
  // stores a card and must touch NO money: the post is update_card with the
  // tokenised source, never a charge.
  await page.evaluate(() => openPayView('paytok', '13', 'balance'));
  await page.waitForTimeout(900);
  const rep = await page.evaluate(() => ({
    shown: (document.getElementById('pay-repair') || { style: {} }).style.display !== 'none',
    cap: (document.getElementById('pay-rep-cap') || {}).textContent || '',
    body: (document.querySelector('.pay-rep-body') || {}).textContent || '',
    btn: !!document.querySelector('[data-act="payUpdateCard"]'),
    consent: (document.getElementById('pay-autopay') || { style: {} }).style.display === 'none',
  }));
  ok(rep.shown && /needs attention/.test(rep.cap), `a failed try renders the repair card (${rep.cap})`);
  ok(/The card was declined/.test(rep.body) && /30\/08\/2026/.test(rep.body),
    `…saying why and when the next try is (${rep.body.slice(0, 80)}…)`);
  ok(rep.btn && rep.consent, '…with the save-card action, and no consent card beside it');
  const repBefore = posts.length;
  await page.evaluate(() => document.querySelector('[data-act="payUpdateCard"]').click());
  await page.waitForTimeout(600);
  const repPost = posts.slice(repBefore).find((p) => p.__url === 'pay.php' && p.action === 'update_card');
  const repCharge = posts.slice(repBefore).find((p) => p.__url === 'pay.php' && p.action === 'charge');
  ok(!!repPost && repPost.source_id === 'tok_test_1' && String(repPost.booking_id) === '13' && !!repPost.token,
    `saving posts update_card with the tokenised source (${repPost && repPost.source_id})`);
  ok(!repCharge, '…and NO charge — nothing is paid by saving a card');
  const repDone = await page.evaluate(() => ({
    cap: (document.getElementById('pay-rep-cap') || {}).textContent || '',
    body: (document.querySelector('.pay-rep-body') || {}).textContent || '',
  }));
  ok(/All sorted/.test(repDone.cap) && /nothing was charged today/.test(repDone.body),
    `…and the card replaces itself with the confirmation (${repDone.body.slice(0, 60)}…)`);
  // Back to the offered booking for the rest of the section.
  await page.evaluate(() => openPayView('paytok', '7', 'deposit'));
  await page.waitForTimeout(900);
  // Choose MONTHLY: the numbered rail opens with the sum closing on screen.
  await page.evaluate(() => {
    const r = document.querySelector('input[name="pay-ap-choice"][value="monthly"]');
    r.checked = true;
    r.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForTimeout(200);
  const apMo = await page.evaluate(() => ({
    rows: document.querySelectorAll('.pay-ap-body .ap-row').length,
    steps: [...document.querySelectorAll('.pay-ap-body .ap-step')].map((e) => e.textContent).join(''),
    dates: [...document.querySelectorAll('.pay-ap-body .ap-date')].map((e) => e.textContent).join('|'),
    sum: (document.querySelector('.pay-ap-body .ap-sum') || {}).textContent || '',
    selClass: !!document.querySelector('.pay-ap-opt.is-sel input[value="monthly"]'),
  }));
  ok(apMo.rows === 3 && apMo.steps === '123', `choosing monthly opens the NUMBERED schedule (${apMo.steps})`);
  ok(apMo.dates === '28/08/2026|28/09/2026|28/10/2026', `…dated as the server offered (${apMo.dates})`);
  ok(/3 × £175\.00 = £525\.00/.test(apMo.sum), `…with the sum CLOSED on screen (${apMo.sum})`);
  ok(apMo.selClass, '…and the chosen option wears the accent');
  // The charge carries the pick — count and consent — and pay.php re-validates.
  const apBefore = posts.filter((p) => p.__url === 'pay.php' && p.action === 'charge').length;
  await page.evaluate(() => document.getElementById('pay-btn').click());
  await page.waitForTimeout(700);
  const apChargeMo = posts.filter((p) => p.__url === 'pay.php' && p.action === 'charge').slice(apBefore).pop();
  ok(!!apChargeMo && apChargeMo.autopay === true && apChargeMo.autopay_instalments === 3,
    `a monthly consent charges with the offered count (${apChargeMo && apChargeMo.autopay_instalments})`);
  // ONE payment: consent yes, count 0.
  await page.evaluate(() => openPayView('paytok', '7', 'deposit'));
  await page.waitForTimeout(900);
  await page.evaluate(() => {
    const r = document.querySelector('input[name="pay-ap-choice"][value="one"]');
    r.checked = true;
    r.dispatchEvent(new Event('change', { bubbles: true }));
    document.getElementById('pay-btn').click();
  });
  await page.waitForTimeout(700);
  const apChargeOne = posts.filter((p) => p.__url === 'pay.php' && p.action === 'charge').pop();
  ok(!!apChargeOne && apChargeOne.autopay === true && apChargeOne.autopay_instalments === 0,
    'one payment consents with no count');
  // The DEFAULT sends no consent at all.
  await page.evaluate(() => openPayView('paytok', '7', 'deposit'));
  await page.waitForTimeout(900);
  await page.evaluate(() => document.getElementById('pay-btn').click());
  await page.waitForTimeout(700);
  const apChargeSelf = posts.filter((p) => p.__url === 'pay.php' && p.action === 'charge').pop();
  ok(!!apChargeSelf && apChargeSelf.autopay === false && apChargeSelf.autopay_instalments === 0,
    'the untouched default consents to NOTHING');
  // STAND-DOWN: choosing monthly then opening the part row hides the card and
  // RESETS the decision — a slice charge carries no consent however it was left.
  await page.evaluate(() => openPayView('paytok', '7', 'deposit'));
  await page.waitForTimeout(900);
  await page.evaluate(() => {
    const r = document.querySelector('input[name="pay-ap-choice"][value="monthly"]');
    r.checked = true;
    r.dispatchEvent(new Event('change', { bubbles: true }));
    document.getElementById('pay-part-toggle').click();
  });
  await page.waitForTimeout(200);
  const apDown = await page.evaluate(() => ({
    shown: (document.getElementById('pay-autopay') || { style: {} }).style.display !== 'none',
    choice: payState.autopayChoice,
  }));
  ok(!apDown.shown && apDown.choice === 'self', `opening the part row stands the card down and resets the choice (${apDown.choice})`);
  await page.evaluate(() => { const a = document.getElementById('pay-part-amt'); a.value = '60'; a.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.waitForTimeout(200);
  const apSliceBefore = posts.filter((p) => p.__url === 'pay.php' && p.action === 'charge').length;
  await page.evaluate(() => document.getElementById('pay-btn').click());
  await page.waitForTimeout(700);
  const apSlice = posts.filter((p) => p.__url === 'pay.php' && p.action === 'charge').slice(apSliceBefore).pop();
  ok(!!apSlice && apSlice.part_amount === 60 && apSlice.autopay === false && apSlice.autopay_instalments === 0,
    `a slice charge carries no consent (part ${apSlice && apSlice.part_amount}, autopay ${apSlice && apSlice.autopay})`);
  // Closing the row brings the card back, at the default.
  await page.evaluate(() => openPayView('paytok', '7', 'deposit'));
  await page.waitForTimeout(900);
  await page.evaluate(() => document.getElementById('pay-part-toggle').click());
  await page.waitForTimeout(150);
  await page.evaluate(() => document.getElementById('pay-part-toggle').click());
  await page.waitForTimeout(150);
  const ap2 = await page.evaluate(() => ({
    shown: (document.getElementById('pay-autopay') || { style: {} }).style.display !== 'none',
    selfChecked: !!(document.querySelector('input[name="pay-ap-choice"][value="self"]') || {}).checked,
  }));
  ok(ap2.shown && ap2.selfChecked, 'closing the row brings the card back, at the default');

  // ============================================================
  //  THE DONE SCREEN SPEAKS THE ARRANGEMENT, both ways round. A guest who
  //  just agreed to automatic payments used to get the generic "we'll be in
  //  touch" — and a FAILED card-save was logged for the owner while the guest
  //  left believing something was arranged that was not.
  // ============================================================
  await page.evaluate(() => openPayView('paytok', '7', 'deposit'));
  await page.waitForTimeout(900);
  await page.evaluate(() => {
    const r = document.querySelector('input[name="pay-ap-choice"][value="monthly"]');
    r.checked = true;
    r.dispatchEvent(new Event('change', { bubbles: true }));
    document.getElementById('pay-btn').click();
  });
  await page.waitForTimeout(700);
  const doneMo = await page.evaluate(() => (document.getElementById('pay-done-sub') || {}).textContent || '');
  ok(/monthly payments are set up/.test(doneMo) && /£175\.00 on 28\/08\/2026/.test(doneMo),
    `a monthly consent's done screen confirms the schedule (${doneMo.slice(0, 90)})`);
  ok(/email you before each one/.test(doneMo), '…and repeats the notice promise');
  await page.evaluate(() => openPayView('paytok', '7', 'deposit'));
  await page.waitForTimeout(900);
  await page.evaluate(() => {
    const r = document.querySelector('input[name="pay-ap-choice"][value="one"]');
    r.checked = true;
    r.dispatchEvent(new Event('change', { bubbles: true }));
    document.getElementById('pay-btn').click();
  });
  await page.waitForTimeout(700);
  const doneOne = await page.evaluate(() => (document.getElementById('pay-done-sub') || {}).textContent || '');
  ok(/collect the remaining £525\.00 automatically on 28\/10\/2026/.test(doneOne),
    `a one-payment consent confirms the collection (${doneOne.slice(0, 90)})`);
  // The FAILED vault is told to the guest, honestly — booking 8 is the stub's
  // failure case (same summary shape as the deposit ask).
  await page.evaluate(() => openPayView('paytok', '8', 'deposit'));
  await page.waitForTimeout(900);
  await page.evaluate(() => {
    const r = document.querySelector('input[name="pay-ap-choice"][value="one"]');
    r.checked = true;
    r.dispatchEvent(new Event('change', { bubbles: true }));
    document.getElementById('pay-btn').click();
  });
  await page.waitForTimeout(700);
  const doneFail = await page.evaluate(() => (document.getElementById('pay-done-sub') || {}).textContent || '');
  ok(/couldn't set up automatic payments/.test(doneFail) && /nothing else was charged/.test(doneFail),
    `a failed card-save is told to the guest, not just the log (${doneFail.slice(0, 90)})`);
  // No consent → the original sentence, untouched.
  await page.evaluate(() => openPayView('paytok', '7', 'deposit'));
  await page.waitForTimeout(900);
  await page.evaluate(() => document.getElementById('pay-btn').click());
  await page.waitForTimeout(700);
  const doneNone = await page.evaluate(() => (document.getElementById('pay-done-sub') || {}).textContent || '');
  ok(/We'll be in touch about the remaining balance/.test(doneNone),
    `no consent keeps the original sentence (${doneNone.slice(0, 80)})`);
  // The schedule REVEAL eases like everything else on this screen.
  await page.evaluate(() => openPayView('paytok', '7', 'deposit'));
  await page.waitForTimeout(900);
  await page.evaluate(() => {
    const r = document.querySelector('input[name="pay-ap-choice"][value="monthly"]');
    r.checked = true;
    r.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForTimeout(150);
  const revealAnim = await page.evaluate(() => getComputedStyle(document.querySelector('.pay-ap-body')).animationName);
  ok(revealAnim === 'payRise', `the schedule reveal eases in (${revealAnim})`);

  // Back to the balance ask for the happy-path charge below.
  await page.evaluate(() => openPayView('paytok', '7', 'balance'));
  await page.waitForTimeout(900);
  const reset = await page.evaluate(() => ({
    open: (document.getElementById('pay-part-row') || { style: {} }).style.display !== 'none',
    btn: (document.getElementById('pay-btn') || {}).textContent || '',
  }));
  ok(!reset.open && reset.btn === 'Pay £340.00', `re-opening the screen resets the offer (${reset.btn})`);

  // ============================================================
  //  WALLETS FOLLOW THE SLICE (owner's report: part-paying must still show
  //  Apple / Google Pay). The wallet is priced at MOUNT time, so the fix is to
  //  re-mount it to the slice as the guest types — never hide it — and to pin a
  //  wallet tap to the figure its sheet actually showed, not the live field.
  // ============================================================
  await page.evaluate(() => {
    // A wallet-capable stub: paymentRequest records the total it was priced to,
    // and each wallet tokenizes to a distinct token so the charge can be traced.
    window.__wreq = null;
    window.Square = {
      payments: () => ({
        card: async () => ({ attach: async () => {}, tokenize: async () => ({ status: 'OK', token: 'tok_test_1' }) }),
        paymentRequest: (o) => { window.__wreq = o && o.total && o.total.amount; return {}; },
        googlePay: async () => ({ attach: async () => {}, tokenize: async () => ({ status: 'OK', token: 'tok_gpay' }) }),
        applePay: async () => ({ tokenize: async () => ({ status: 'OK', token: 'tok_apay' }) }),
      }),
    };
  });
  await page.evaluate(() => openPayView('paytok', '7', 'balance'));
  await page.waitForTimeout(900);
  const wFull = await page.evaluate(() => ({
    req: window.__wreq,
    shown: (document.getElementById('sq-wallets') || { style: {} }).style.display !== 'none',
    apay: !!document.getElementById('sq-apay'),
    panel: (document.getElementById('pay-express') || { style: {} }).style.display !== 'none',
    cap: (document.getElementById('pay-express-cap') || {}).textContent || '',
    // THE ORDER IS THE FIX (owner's screenshot): the amount choice must come
    // BEFORE the express panel, so a re-priced wallet lands directly beneath
    // the field the guest is typing in — not two sections above it.
    partFirst: !!(document.getElementById('pay-part') && document.getElementById('pay-express') &&
      (document.getElementById('pay-part').compareDocumentPosition(document.getElementById('pay-express')) & Node.DOCUMENT_POSITION_FOLLOWING)),
  }));
  ok(wFull.req === '340.00' && wFull.shown && wFull.apay, `the balance ask mounts wallets for the FULL amount (${wFull.req})`);
  ok(wFull.panel && /Express checkout/.test(wFull.cap) && /£340\.00/.test(wFull.cap),
    `the express panel captions the FULL figure in words (${wFull.cap.trim()})`);
  ok(wFull.partFirst, 'the amount choice sits ABOVE the express panel — decide the amount, then how to pay it');

  // Open the part row with nothing typed → wallets come down (nothing to charge).
  await page.evaluate(() => document.getElementById('pay-part-toggle').click());
  await page.waitForTimeout(150);
  const wOpen = await page.evaluate(() => ({
    w: (document.getElementById('sq-wallets') || { style: {} }).style.display,
    panel: (document.getElementById('pay-express') || { style: {} }).style.display,
  }));
  ok(wOpen.w === 'none', `opening with no amount takes the wallets down (${wOpen.w})`);
  ok(wOpen.panel === 'none', '…and the captioned panel goes with them — no empty box claiming a checkout');

  // Type a slice → after the debounce the wallets RE-MOUNT, priced to the slice.
  await page.evaluate(() => { const a = document.getElementById('pay-part-amt'); a.value = '120'; a.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.waitForTimeout(600);
  const wSlice = await page.evaluate(() => ({
    req: window.__wreq,
    shown: (document.getElementById('sq-wallets') || { style: {} }).style.display !== 'none',
    apay: !!document.getElementById('sq-apay'),
    cap: (document.getElementById('pay-express-cap') || {}).textContent || '',
  }));
  ok(wSlice.req === '120.00' && wSlice.shown && wSlice.apay, `a valid slice re-prices Apple/Google Pay to the slice (${wSlice.req})`);
  ok(/£120\.00/.test(wSlice.cap) && !/£340\.00/.test(wSlice.cap),
    `…and the caption states the slice in words above the buttons (${wSlice.cap.trim()})`);

  // TAP the wallet: it must charge the £120 its sheet showed, as a part_amount —
  // never the full amount, and never a value the field moved to after the mount.
  const before = posts.filter((p) => p.__url === 'pay.php' && p.action === 'charge').length;
  await page.evaluate(() => document.getElementById('sq-apay').click());
  await page.waitForTimeout(700);
  const wCharge = posts.filter((p) => p.__url === 'pay.php' && p.action === 'charge').slice(before).pop();
  ok(!!wCharge && wCharge.source_id === 'tok_apay', `the wallet tap tokenises through the wallet (${wCharge && wCharge.source_id})`);
  ok(!!wCharge && wCharge.part_amount === 120, `…and charges the slice the sheet showed, not the full ask (${wCharge && wCharge.part_amount})`);

  // THE PIN IS LOAD-BEARING: type a NEW figure and tap the wallet BEFORE the
  // 350ms re-mount fires. The sheet still shows the old £120, so the charge must
  // be £120 — the mounted amount — not the £150 now in the field. Without the
  // pin the wallet would take a number its own sheet never displayed.
  await page.evaluate(() => openPayView('paytok', '7', 'balance'));
  await page.waitForTimeout(900);
  await page.evaluate(() => document.getElementById('pay-part-toggle').click());
  await page.waitForTimeout(120);
  await page.evaluate(() => { const a = document.getElementById('pay-part-amt'); a.value = '120'; a.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.waitForTimeout(600); // let the wallet mount at £120
  const pinBefore = posts.filter((p) => p.__url === 'pay.php' && p.action === 'charge').length;
  await page.evaluate(() => {
    const a = document.getElementById('pay-part-amt'); a.value = '150'; a.dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('sq-apay').click(); // tap NOW, before the 350ms re-mount
  });
  await page.waitForTimeout(700);
  const pinCharge = posts.filter((p) => p.__url === 'pay.php' && p.action === 'charge').slice(pinBefore).pop();
  ok(!!pinCharge && pinCharge.part_amount === 120,
    `a wallet tap charges the mounted figure, not an un-settled field value (${pinCharge && pinCharge.part_amount})`);

  // A WALLET TAP WHILE CLOSED IS A FULL PAYMENT — part_amount 0, never the
  // mounted figure. On the deposit stage the full charge is rental + refundable
  // deposit; sending the mounted £225 would clamp the deposit off (booking_part
  // _amount caps at the rental). So closed must send 0.
  await page.evaluate(() => openPayView('paytok', '3', 'deposit'));
  await page.waitForTimeout(900);
  const depBefore = posts.filter((p) => p.__url === 'pay.php' && p.action === 'charge').length;
  await page.evaluate(() => document.getElementById('sq-apay').click());
  await page.waitForTimeout(700);
  const depCharge = posts.filter((p) => p.__url === 'pay.php' && p.action === 'charge').slice(depBefore).pop();
  ok(!!depCharge && depCharge.part_amount === 0,
    `a wallet tap on the full deposit stage sends no slice, so the deposit is not clamped off (${depCharge && depCharge.part_amount})`);

  // Closing re-prices the wallets back to the full ask.
  await page.evaluate(() => openPayView('paytok', '7', 'balance'));
  await page.waitForTimeout(900);
  await page.evaluate(() => document.getElementById('pay-part-toggle').click());
  await page.waitForTimeout(150); // open (wallets down)
  await page.evaluate(() => document.getElementById('pay-part-toggle').click());
  await page.waitForTimeout(150); // close → immediate reprice to full
  const wClose = await page.evaluate(() => ({ req: window.__wreq, shown: (document.getElementById('sq-wallets') || { style: {} }).style.display !== 'none' }));
  ok(wClose.req === '340.00' && wClose.shown, `closing the row re-prices the wallets to the full ask (${wClose.req})`);

  // Restore the wallet-less stub so the card-path sections below are unchanged.
  await page.evaluate(() => {
    window.Square = {
      payments: () => ({
        card: async () => ({ attach: async () => {}, tokenize: async () => ({ status: 'OK', token: 'tok_test_1' }) }),
        paymentRequest: () => { throw new Error('no wallets in this test'); },
      }),
    };
  });
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
    restShown: (document.getElementById('pay-done-rest') || { style: {} }).style.display !== 'none',
    panelAnim: getComputedStyle(document.getElementById('pay-done')).animationName,
    tickAnim: getComputedStyle(document.querySelector('.pay-done-tick .ic')).animationName,
    circleAnim: getComputedStyle(document.querySelector('.pay-done-tick circle')).animationName,
    checkAnim: getComputedStyle(document.querySelector('.pay-done-tick path')).animationName,
  }));
  const charge = posts.find((p) => p.__url === 'pay.php' && p.action === 'charge');
  ok(!!charge && charge.source_id === 'tok_test_1' && charge.kind === 'balance', `charge posted with the tokenized card (${charge && charge.source_id})`);
  ok(done.done && /paid in full/i.test(done.sub), `receipt state shows (${done.sub.slice(0, 50)}…)`);
  // The pay-the-rest button belongs to a slice's done screen alone — a full
  // payment must not carry a stale one over from the earlier part charge.
  ok(!done.restShown, 'a full payment offers no "pay the rest"');
  ok(done.panelAnim === 'payRise' && done.tickAnim === 'payPop',
    `the done panel eases in and the tick pops on the spring (${done.panelAnim}/${done.tickAnim})`);
  // The Apple Pay confirm: the ring DRAWS and the check strokes in — not a
  // static mark that appears.
  ok(done.circleAnim === 'payDraw' && done.checkAnim === 'payDraw',
    `the tick draws itself, ring then check (${done.circleAnim}/${done.checkAnim})`);

  // A DROPPED CONNECTION IS NOT THE END OF THE PAYMENT. This screen is the guest's
  // only way to pay, reached from an emailed link, and its failure panel's one
  // control was "Back to the site" — so a Square SDK that failed to load ended the
  // journey. Try again is OPTIONAL and must stay so: the same panel serves genuinely
  // TERMINAL states ("already settled — nothing left to pay"), where a retry invites
  // tapping at something that cannot change. Both halves are asserted.
  const errStates = await page.evaluate(() => {
    const read = () => {
      const b = document.getElementById('pay-error-retry');
      return {
        shown: !!b && getComputedStyle(b).display !== 'none',
        msg: (document.getElementById('pay-error-msg') || {}).textContent || '',
      };
    };
    showPayError('Could not load the payment form.', () => { window.__payRetried = 1; });
    const transient = read();
    showPayError("This booking is already settled — there's nothing left to pay.");
    const terminal = read();
    // …and the one that IS offered really runs.
    showPayError('Could not load the payment form.', () => { window.__payRetried = 1; });
    window.__payRetried = 0;
    document.getElementById('pay-error-retry').click();
    return { transient: transient, terminal: terminal, ran: window.__payRetried };
  });
  ok(errStates.transient.shown, 'PAY-ERR: a failure that might pass offers Try again');
  ok(errStates.ran === 1, 'PAY-ERR: …and the button really runs the remedy it was given');
  ok(!errStates.terminal.shown,
    `PAY-ERR: a TERMINAL state does not (${errStates.terminal.msg.slice(0, 50)})`);

  // ============================================================
  // PLAN-FIRST (the approved demo): the plan is decided BEFORE the payment
  // methods, and the methods honestly follow the choice — Square cannot keep a
  // WALLET card on file, so an automatic plan stands the wallets down with the
  // reason on screen; "I'll pay it myself" brings them back. One consent
  // sentence above the button restates the arrangement whichever rail; a
  // field-validation tokenize failure keeps ONE voice (Square's inline).
  // ============================================================
  console.log('PLAN-FIRST: the decision precedes the methods');
  await page.evaluate(() => openPayView('paytok', '7', 'deposit'));
  await page.waitForTimeout(900);
  // (a) DOM ORDER — the whole point: a wallet guest must pass the plan.
  const pfOrder = await page.evaluate(() => {
    const ap = document.getElementById('pay-autopay');
    const ex = document.getElementById('pay-express');
    return !!(ap && ex && ap.compareDocumentPosition(ex) & Node.DOCUMENT_POSITION_FOLLOWING);
  });
  ok(pfOrder, 'PLAN-FIRST: the plan card precedes the express checkout in the DOM');
  // (b) The two step chips + step-2 caption while an offer is on screen.
  const pfCaps = await page.evaluate(() => ({
    n1: (document.querySelector('#pay-ap-cap .pay-step-n') || {}).textContent || '',
    todayShown: (document.getElementById('pay-today-cap') || { style: {} }).style.display !== 'none',
    n2: (document.querySelector('#pay-today-cap .pay-step-n') || {}).textContent || '',
    amt: (document.getElementById('pay-today-amt') || {}).textContent || '',
  }));
  ok(pfCaps.n1 === '1' && pfCaps.todayShown && pfCaps.n2 === '2', `PLAN-FIRST: steps 1 and 2 are numbered (${pfCaps.n1}/${pfCaps.n2})`);
  ok(/£\d/.test(pfCaps.amt), `PLAN-FIRST: step 2 names today's figure from the button's own ask (${pfCaps.amt})`);
  // (c) THE STAND-DOWN, both ways. The harness mounts no real wallets, so the
  // wallet flag is stubbed the way mountWallets would set it.
  const pfAuto = await page.evaluate(() => {
    payState.walletsAny = true;
    payMethodsSync();
    const vis = (id) => (document.getElementById(id) || { style: {} }).style.display !== 'none';
    const before = { express: vis('pay-express'), note: vis('pay-walnote') };
    const r = document.querySelector('input[name="pay-ap-choice"][value="monthly"]');
    r.checked = true;
    r.dispatchEvent(new Event('change', { bubbles: true }));
    const during = { express: vis('pay-express'), note: vis('pay-walnote'), noteTxt: (document.getElementById('pay-walnote') || {}).textContent || '' };
    const s = document.querySelector('input[name="pay-ap-choice"][value="self"]');
    s.checked = true;
    s.dispatchEvent(new Event('change', { bubbles: true }));
    const after = { express: vis('pay-express'), note: vis('pay-walnote') };
    return { before, during, after };
  });
  ok(pfAuto.before.express && !pfAuto.before.note, 'PLAN-FIRST: with wallets up and self chosen, express shows and no note');
  ok(!pfAuto.during.express && pfAuto.during.note, 'PLAN-FIRST: choosing an automatic plan stands the wallets down WITH the note');
  ok(/can't be stored for later payments/.test(pfAuto.during.noteTxt) && /I'll pay it myself/.test(pfAuto.during.noteTxt),
    'PLAN-FIRST: …the note states the reason and names the way back');
  ok(pfAuto.after.express && !pfAuto.after.note, 'PLAN-FIRST: choosing self brings the wallets straight back');
  // (d) ONE CONSENT SENTENCE per choice, above the button.
  const pfConsent = await page.evaluate(() => {
    const read = () => (document.getElementById('pay-consent') || {}).textContent || '';
    const pick = (v) => {
      const r = document.querySelector(`input[name="pay-ap-choice"][value="${v}"]`);
      r.checked = true;
      r.dispatchEvent(new Event('change', { bubbles: true }));
      return read();
    };
    return { self: pick('self'), one: pick('one'), monthly: pick('monthly') };
  });
  ok(/nothing is stored/i.test(pfConsent.self), `PLAN-FIRST: self consent promises nothing is stored (${pfConsent.self.slice(0, 48)}…)`);
  ok(/kept securely on file for one payment of £525\.00 on 28\/10\/2026/.test(pfConsent.one),
    `PLAN-FIRST: one-payment consent restates sum + day (${pfConsent.one.slice(20, 90)}…)`);
  ok(/3 monthly payments of £175\.00/.test(pfConsent.monthly) && /before each one/.test(pfConsent.monthly),
    `PLAN-FIRST: monthly consent restates the schedule (${pfConsent.monthly.slice(20, 90)}…)`);
  // (e) THE BELT: consent must never ride a wallet token — a stale wallet tap
  // with a plan chosen is refused in words, and nothing is charged.
  const pfBelt = await page.evaluate(async () => {
    window.__pfCharged = 0;
    const origPost = window.apiPost;
    // monthly is still chosen from (d)
    // Drive the wallet handler the way a stale button would: mountWallets'
    // walletPay closure is not reachable directly, so assert at its own gate —
    // the source carries the refusal before any tokenize.
    return {
      choice: payState.autopayChoice,
      src: true,
    };
  });
  const appSrcPf = require('fs').readFileSync(__dirname + '/app.js', 'utf8');
  ok(/autopayChoice === 'one' \|\| payState\.autopayChoice === 'monthly'\) \{\s*\n\s*setPayMsg\("Automatic payments need the card form below/.test(appSrcPf)
    && appSrcPf.indexOf('Automatic payments need the card form below') < appSrcPf.indexOf('await wallet.tokenize()'),
    'PLAN-FIRST: walletPay refuses a chosen plan BEFORE any tokenize — consent never rides a wallet token');
  ok(pfBelt.choice === 'monthly', '(fixture) the plan really was still chosen when the belt was read');
  // (f) THE ERROR IS SAID ONCE: a field-validation tokenize failure never
  // reaches the banner — Square's inline message is the one voice.
  const pfErr = await page.evaluate(async () => {
    const saved = squareCard;
    squareCard = { tokenize: async () => ({ status: 'Invalid', errors: [{ type: 'VALIDATION_ERROR', field: 'cardNumber', message: 'Credit card number is not valid' }] }) };
    await submitPayment();
    const banner = (document.getElementById('pay-msg') || {}).textContent || '';
    squareCard = { tokenize: async () => ({ status: 'Invalid', errors: [{ type: 'SDK_ERROR', message: 'Something broke in the SDK' }] }) };
    await submitPayment();
    const banner2 = (document.getElementById('pay-msg') || {}).textContent || '';
    squareCard = saved;
    return { fieldBanner: banner, sdkBanner: banner2 };
  });
  ok(pfErr.fieldBanner === '', `PLAN-FIRST: a field-validation failure prints NO second banner (got "${pfErr.fieldBanner}")`);
  ok(/Something broke in the SDK/.test(pfErr.sdkBanner), 'PLAN-FIRST: …while a non-field failure still reaches the banner');

  console.log(fails ? `\n  ${fails} PAY-PAGE CHECK(S) FAILED ❌` : '\n  PAY-PAGE SUITE PASSED ✅');
  await harnessDone(fails);
})();
