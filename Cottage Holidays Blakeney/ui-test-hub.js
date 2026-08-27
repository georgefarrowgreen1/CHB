// Behavioural checks for the booking hub + live modal availability:
//  A. showDetails() routes to the hub page; header/pipeline/cards render.
//  B. Next action follows state (unpaid → deposit ask; part-paid → balance).
//  C. History card renders the bookings.php `history` events.
//  D. Emails card shows the logged email with its Show email button.
//  E. Guest card lists the same guest's other stay; clicking swaps hubs.
//  F. Back button returns to the Bookings list.
//  G. Modal availability strip: booked days shaded, clash note on overlap,
//     no self-clash when editing the same booking, none when dates free.
//  H. Deleting from the hub exits to the Bookings list.
// The site reckons "today" in UK time (todayDashed / ukNowParts), so the
// tests must too — pin the whole process (and the browser it launches) to
// Europe/London so fixtures built from new Date() agree with the app on
// any runner, in any timezone. Must run before the first Date call.
const { d, ok, boot } = require('./ui-test-lib'); // pins TZ=Europe/London at require time

(async () => {
  // <1200px so sections A–H exercise the STANDALONE hub flow (the ≥1200
  // master–detail split gets its own section I at the end).
  const { page, browser, base, done } = await boot({ viewport: { width: 1000, height: 900 } });

  const mk = (id, over = {}) => Object.assign({
    id, prop_key: '21a', name: 'Walk-in Guest', email: 'guest@gmail.com', phone: '07700 900000',
    address: '1 Lane', postcode: 'NR25 7AB', check_in: d(30), check_out: d(33), check_in_time: '15:00',
    check_out_time: '10:00', adults: 2, children: 0, payment: 'unpaid', deposit_paid: 0,
    payment_method: '', payment_date: '', agreed_total: 440, agreed_per_night: 130, agreed_nights: 3,
    agreed_nightly: 390, agreed_booking_fee: 50, agreed_txn_pct: 0, agreed_txn_fee: 0, agreed_on: d(0),
    hold_status: 'none', notes: 'VIP', sms_opt_in: 1, terms_accepted_at: '2026-07-01 10:00:00', terms_version: 3, no_dogs_at: '2026-07-01 10:00:00',
  }, over);
  // b3 is a FINISHED stay (checked out days ago) for the edit soft-lock checks —
  // its own email so it never pollutes the b1 guest-intel/repeat fixtures.
  let rows = [mk(1), mk(2, { name: 'Return Visit', check_in: d(90), check_out: d(93) }), mk(3, { name: 'Past Guest', email: 'past@gmail.com', check_in: d(-10), check_out: d(-7), payment: 'paid', deposit_paid: 440 }),
    // b4: a FINISHED stay that still owes money — its next-action banner must
    // chase the balance, not say "all set" (hub-unification regression).
    mk(8, { name: 'Gap Follower', email: 'gapf@gmail.com', check_in: d(35), check_out: d(38) }),
    mk(4, { name: 'Owes After Leaving', email: 'owes@gmail.com', check_in: d(-25), check_out: d(-22), payment: 'deposit', deposit_paid: 100 })];
  let enqs = [
    { id: 6, prop_key: '21a', name: 'Enq Alpha', email: 'enq@gmail.com', phone: '', address: '2 Lane', postcode: 'NR25 7AB', check_in: d(40), check_out: d(43), check_in_time: '15:00', check_out_time: '10:00', adults: 2, children: 0, message: 'Dog friendly?', created_at: d(-1) + ' 09:00:00', no_dogs_at: '2026-07-01 10:00:00' },
    { id: 7, prop_key: '21a', name: 'Enq Beta', email: 'beta@gmail.com', phone: '', address: '3 Lane', postcode: 'NR25 7AB', check_in: d(80), check_out: d(83), check_in_time: '15:00', check_out_time: '10:00', adults: 2, children: 0, message: '', created_at: d(0) + ' 08:00:00' },
  ];
  // Enquiries the owner has turned down — soft-deleted server-side, which is
  // what makes the drawer possible.
  let declined = [];
// Drives approval's 409 — the refusal the page has to answer honestly.
let approveWill409 = false;
  const posts = [];
  await page.route(/\.php/, (route) => {
    const url = route.request().url();
    const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (route.request().method() === 'POST') {
      const b = JSON.parse(route.request().postData() || '{}');
      b.__url = url.split('/').pop().split('?')[0];
      posts.push(b);
      if (b.__url === 'bookings.php') {
        if (b.action === 'history') return json({ ok: true, events: [
          { action: 'booking.update', summary: 'Booking edited — dates changed', actor: 'owner', at: d(-1) + ' 09:12:00' },
          { action: 'booking.add', summary: 'Booking created — Walk-in Guest', actor: 'owner', at: d(-2) + ' 18:30:00' },
        ] });
        if (b.action === 'email_logs') return json({ logs: { 1: [{ action: 'email.confirmation', summary: 'Booking confirmation emailed', at: d(-2) + ' 18:31:00' }] } });
        if (b.action === 'email_render') return json({ ok: true, subject: 'Your booking is confirmed', html: '<p>Preview</p>' });
        if (b.action === 'hub_bundle') return json({ ok: true,
          payments: [
            { kind: 'balance', amount: '556.20', status: 'COMPLETED', square_payment_id: 'sq1', note: '', deposit_carried: 75, created_at: '2026-07-20 14:01:00' },
            { kind: 'damages_return', amount: '75.00', status: 'PENDING', square_payment_id: 'sq2', note: '', created_at: '2026-07-29 09:00:00' },
          ],
          events: [
            { action: 'payment.card', summary: 'Balance paid by card — £556.20 + £75.00 refundable deposit', actor: 'guest', at: '2026-07-20 14:01:00' },
            { action: 'email.confirmation', summary: 'Booking confirmation emailed', actor: 'system', at: '2026-07-20 14:02:00', subject: 'Your booking is confirmed', body: 'Dear Guest, good news.' },
            { action: 'booking.edit', summary: 'Booking edited — dates changed', actor: 'you', at: '2026-07-18 10:00:00' },
            { action: 'booking.add', summary: 'Booking created', actor: 'you', at: '2026-07-15 09:00:00' },
          ] });
        if (b.action === 'payments') return json({ ok: true, payments: [
          // deposit_carried: the £75 damages deposit rode this charge (the server
          // flags the row hold_payment_id points at) — the card took £631.20, and
          // the row must say so rather than quoting the rental-only ledger amount.
          { kind: 'balance', amount: '556.20', status: 'COMPLETED', square_payment_id: 'sq1', note: '', deposit_carried: 75 },
          { kind: 'damages_return', amount: '75.00', status: 'PENDING', square_payment_id: 'sq2', note: '' },
        ] });
        if (b.action === 'set_payment') { const r = rows.find((x) => x.id === b.id); if (r) { r.payment = b.payment; r.deposit_paid = b.deposit || (b.payment === 'paid' ? r.agreed_total : 0); } return json({ ok: true }); }
        // The plan endpoint echoes what the server would ACCEPT — the client
        // must adopt these, not its typed input (C3 asserts the re-render).
        if (b.action === 'set_payment_plan') return json({ ok: true,
          deposit_pct: b.deposit_pct !== '' ? parseFloat(b.deposit_pct) : null,
          deposit_amount: b.deposit_amount !== '' ? parseFloat(b.deposit_amount) : null,
          balance_due_date: b.balance_due_date || null });
        if (b.action === 'request_payment') return json({ ok: true, amount: 330, kind: 'balance', reminder: !!b.reminder });
        if (b.action === 'delete') { rows = rows.filter((x) => x.id !== b.id); return json({ ok: true }); }
        return json({ ok: true });
      }
      if (b.__url === 'enquiries.php') {
        if (b.action === 'approve_preview') return json({ ok: true, subject: 'Your booking is confirmed', html: '<p>Preview</p>' });
        if (b.action === 'approve') {
          // The 409 approval's re-check under book_lock really raises: the dates went
          // while the enquiry sat in the inbox, or another device already approved it.
          if (approveWill409) {
            // The refusal is not free-standing: the server says no BECAUSE a booking
            // now overlaps, so the fixture must carry that booking too — otherwise the
            // reload brings back the same free calendar and the card is right to keep
            // saying "dates free" (the first version of this check asserted a flip the
            // fix could not deliver).
            const e2 = enqs.find((x) => x.id === b.id);
            if (e2 && !rows.some((r) => r.id === 77)) rows.push(mk(77, { name: 'Took The Dates', email: 'took@x.co', prop_key: e2.prop_key, check_in: e2.check_in, check_out: e2.check_out }));
            return route.fulfill({
              status: 409, contentType: 'application/json',
              body: JSON.stringify({ error: 'Those dates are no longer available — another booking now overlaps them.' }),
            });
          }
          const enq = enqs.find((x) => x.id === b.id);
          rows.push(mk(70, { name: enq ? enq.name : 'Approved Guest', email: 'enq@gmail.com', check_in: d(40), check_out: d(43) }));
          enqs = enqs.filter((x) => x.id !== b.id);
          return json({ ok: true, booking_id: 70, email: { guest: { ok: true } }, payment_request: null, email_check: null });
        }
        if (b.action === 'decline') {
          const gone = enqs.find((x) => x.id === b.id);
          if (gone) declined.push(gone);
          enqs = enqs.filter((x) => x.id !== b.id);
          return json({ ok: true });
        }
        if (b.action === 'declined') return json({ ok: true, enquiries: declined });
        if (b.action === 'restore') {
          const back = declined.find((x) => x.id === b.id);
          if (back) { enqs.push(back); declined = declined.filter((x) => x.id !== b.id); }
          return json({ ok: true });
        }
        return json({ ok: true });
      }
      if (b.__url === 'ical-import.php' && b.action === 'blocks') {
        return json({ ok: true, blocks: [{ id: 9, prop_key: '21a', source: 'airbnb', check_in: d(50), check_out: d(53) }] });
      }
      return json({ ok: true });
    }
    if (url.includes('bookings.php')) return json({ bookings: rows });
    if (url.includes('enquiries.php')) return json({ enquiries: enqs });
    if (url.includes('rates.php')) return json({ properties: [{ prop_key: '21a', name: '21A Westgate', slug: '21a', couple_rate: 130, extra_adult_rate: 0, child_rate: 0, booking_fee: 50, transaction_pct: 0, lastmin_pct: 0, lastmin_days: 0, max_adults: 2, max_children: 0, max_total: 2, sort_order: 1 }], seasons: {}, occupancy: {} });
    if (url.includes('ical-import.php')) return json({ ok: true, blocks: [{ id: 9, prop_key: '21a', source: 'airbnb', check_in: d(50), check_out: d(53) }] });
    return json({ ok: true, bookings: [], enquiries: [], properties: [], seasons: {}, occupancy: {}, content: {}, blocks: [], ranges: [], payments: [] });
  });

  await page.goto(`${base}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1300);
  await page.evaluate(() => { isAuthenticated = true; document.body.classList.add('owner-mode'); });
  await page.evaluate(() => window.loadAdminBundle());
  await page.waitForTimeout(600);
  await page.evaluate(() => loadData());
  await page.waitForTimeout(600);

  // ---------- A. showDetails → hub ----------
  console.log('A. routing + render');
  await page.evaluate(() => showDetails('21a', findBookingById('b1')));
  await page.waitForTimeout(700);
  const a = await page.evaluate(() => ({
    active: (document.querySelector('.page-view.active') || {}).id,
    name: (document.querySelector('.bhub-name') || {}).textContent || '',
    // THE STAGE IS A CAPTION on the next-action card now (the iOS restyle):
    // the pill strips are gone, and "Next · 2 of 6 · Deposit" carries what
    // the three-pill window used to say.
    cap: ((document.querySelector('.bhub-next-cap') || {}).textContent || '').trim(),
    noStrips: !document.querySelector('.bhub-pipe3') && !document.querySelector('.bhub-pipe-full') && !document.querySelector('.pipe-step'),
    // ONE when-line under the name: the house compact range (fmtStayRange, the
    // enquiry hub's own sub) + nights + party + in/out times.
    sub: ((document.querySelector('.bhub-sub') || {}).textContent || '').trim(),
    // The cards are DISCLOSURE GROUPS now (only-what-needs-seeing): each is a
    // summary row stating its conclusion, detail folded underneath, closed by
    // default. b1 is a repeat guest so the intel group renders too.
    grps: ['money', 'guest', 'emails', 'activity', 'note', 'intel'].filter((k) => !!document.querySelector(`.bhub-fold-grp[data-grp="${k}"]`)),
    foldsClosed: [...document.querySelectorAll('.bhub-fold')].every((f) => f.hidden),
    guestSum: ((document.querySelector('[data-grp="guest"] .bhub-fold-right') || {}).textContent || '').trim(),
    // The register is a ROW in the Guest details fold, not a card of its own.
    regRow: [...document.querySelectorAll('.bhub-kv')].some((r) => /Register/i.test((r.querySelector('.bhub-kv-label') || {}).textContent || '')),
    regCard: Array.from(document.querySelectorAll('.bhub-card-title')).some((t) => /Guest register/.test(t.textContent || '')),
    notes: (document.querySelector('[id^="bk-notes-"]') || {}).value || '',
    // Mid-scroll the identity row is under the fixed header, so the condensed
    // bar names the RECORD, not the screen type.
    headTitle: ((document.getElementById('admin-head-title') || {}).textContent || '').trim(),
  }));
  ok(a.active === 'view-booking-hub', `hub view active (${a.active})`);
  ok(a.name === 'Walk-in Guest', `guest name in header (${a.name})`);
  ok(a.headTitle === 'Walk-in', `the condensed bar names the guest, first name (${a.headTitle})`);
  ok(a.noStrips, 'the journey pill strips are gone — the stage is a caption');
  ok(/^Next · 2 of \d · Deposit$/.test(a.cap), `unpaid → the card's cap names the stage with its counter (${a.cap})`);
  ok(/ · 3 nights · /.test(a.sub) && / · in 15:00 \/ out 10:00$/.test(a.sub) && !/→/.test(a.sub),
    `ONE when-line: compact range · nights · party · in/out times (${a.sub})`);
  ok(a.grps.length === 6, `all six disclosure groups render (${a.grps.join(', ')})`);
  ok(a.foldsClosed, 'every fold starts CLOSED — the page opens at its summary');
  // THE EXCEPTION RULE: b1's register is outstanding, so the Guest details
  // summary counts it rather than claiming all is well.
  ok(/1 not recorded/.test(a.guestSum), `the Guest details summary counts what's outstanding (${a.guestSum})`);
  // The unified header section: journey pipeline + next action + the money
  // block all in ONE .bhub-head — and the old duplicate money mini-pipeline
  // (.bhub-paypipe) is gone for good.
  const uni = await page.evaluate(() => ({
    payInHead: !!document.querySelector('.bhub-head .bhub-headpay .bhub-payline'),
    capGone: !document.querySelector('.bhub-headpay-cap'),
    noPayCard: ![...document.querySelectorAll('.bhub-card .bhub-card-title')].some((t) => /^Payments$/.test((t.textContent || '').trim())),
    noPaypipe: !document.querySelector('.bhub-paypipe'),
    reqBtns: document.querySelectorAll('#booking-hub-content [data-act="requestPayment"]').length,
    foldRows: document.querySelectorAll('.bhub-headpay .bhub-payline').length,
    foldLine: (document.querySelector('.bhub-headpay .bhub-payline') || {}).textContent || '',
    figWraps: (() => { const f = document.querySelector('.bhub-payline-fig'); return f ? getComputedStyle(f).whiteSpace : ''; })(),
    disclose: !!document.querySelector('.bhub-disclose-btn[data-act="bhubMoneyExpand"]'),
  }));
  ok(uni.payInHead && uni.capGone, 'the money group lives INSIDE the header section, self-labelled — no caption repeating its own row');
  ok(uni.noPayCard, 'no separate Payments card remains in the grid');
  ok(uni.noPaypipe, 'the duplicate money mini-pipeline is gone (journey strip carries the stages)');
  // Square is OFF at this point, so no email ask renders anywhere — the banner
  // falls back to Record a payment. (The banner-owns-it rule was retired at the
  // owner's request: with Square ON, the Payments row carries the ask too — see
  // the "email ask in the Payments row" section below, which owns that contract.)
  ok(uni.reqBtns === 0, `no email ask without Square (${uni.reqBtns})`);
  // The money folds to ONE payline in EVERY state — untouched booking reads the
  // total (banner already leads with the balance), full maths behind disclose,
  // and the figure can never wrap into a broken multi-line mess.
  ok(uni.foldRows === 1 && /^Total/.test(uni.foldLine.trim()) && /£490\.00/.test(uni.foldLine) && uni.disclose, `unpaid money folds to one Total payline + disclose (${uni.foldLine.trim()})`);
  ok(uni.figWraps === 'nowrap', 'the payline figure never wraps');
  ok(a.regRow && !a.regCard, 'the guest register is a ROW in the Guest card, not a card of its own');
  const intel = await page.evaluate(() => { const c = document.getElementById('hub-intel-card'); return c ? c.textContent : ''; });
  ok(/1st stay/.test(intel), `guest intel leads with the visit ordinal (${intel.slice(0, 50).trim()})`);
  ok(a.notes === 'VIP', 'staff note prefilled');
  // Email actions live in ONE place: the Emails card.
  const em1 = await page.evaluate(() => ({
    headerEmail: !!document.querySelector('.bhub-actions [data-act="openBookingEmail"]'),
    // ONE LABELLED action; the guest-card address and the sticky ✉️ are
    // CONTACT AFFORDANCES that route into the SAME composer — they replaced
    // mailto: links that bounced the owner out to the phone's mail app, so
    // their existence is the fix, not a duplicate.
    labelled: [...document.querySelectorAll('#booking-hub-content [data-act="openBookingEmail"]')].filter((x) => /write an email/i.test(x.textContent || '')).length,
    addrAff: !!document.querySelector('#booking-hub-content .bhub-kv-act[data-act="openBookingEmail"]'),
    stickyAff: !!document.querySelector('#booking-hub-content .bhub-sticky [data-act="openBookingEmail"]'),
    updConf: document.querySelectorAll('#booking-hub-content [data-act="offerUpdatedConfirmationEmail"]').length,
  }));
  ok(!em1.headerEmail && em1.labelled === 1 && em1.addrAff && em1.stickyAff,
    'ONE labelled email action (Emails card); address + sticky route to the SAME composer, none in the header');
  ok(em1.updConf === 0, 'no updated-confirmation button while nothing is paid');

  // ---------- A1b. only what needs to be seen ----------
  // The exception rule + the fold machinery, each break-tested.
  console.log('A1b. exception rule + folds');
  // (1) A fold opens in place, reports its state, and the open state survives
  // a re-render — editPaymentPlan saves repaint the hub, and a page that
  // snaps shut mid-task reads as broken.
  await page.evaluate(() => bhubFoldToggle('guest'));
  const foldSt = await page.evaluate(() => ({
    open: !document.getElementById('bhub-fold-guest').hidden,
    aria: document.querySelector('[data-grp="guest"] .bhub-fold-row').getAttribute('aria-expanded'),
  }));
  ok(foldSt.open && foldSt.aria === 'true', 'a group unfolds in place and reports its state');
  await page.evaluate(() => renderBookingHub());
  ok(await page.evaluate(() => !document.getElementById('bhub-fold-guest').hidden),
    'the open fold survives a re-render (the page never snaps shut)');
  await page.evaluate(() => bhubFoldToggle('guest'));
  ok(await page.evaluate(() => document.getElementById('bhub-fold-guest').hidden), 'a second tap folds it away');
  // (2) THE EXCEPTION RULE, both ways: everything recorded → ONE green summary
  // row; un-record one fact → the summary counts it. Through the REAL renderer.
  const excep = await page.evaluate(() => {
    const b = findBookingById('b1');
    const keep = { s: b.regSubmitted, c: b.regCount, t: b.termsAcceptedAt };
    const sum = () => ((document.querySelector('[data-grp="guest"] .bhub-fold-right') || {}).textContent || '').trim();
    b.regSubmitted = true; b.regCount = 2; renderBookingHub();
    const all = sum();
    b.termsAcceptedAt = null; renderBookingHub();
    const one = sum();
    const capSel = '[data-grp="guest"] .st-cap';
    b.termsAcceptedAt = keep.t; b.regSubmitted = true; b.regCount = 2; renderBookingHub();
    const allCap = !!document.querySelector(capSel + '.is-ok .st-tick');
    b.termsAcceptedAt = null; renderBookingHub();
    const oneCap = !!document.querySelector(capSel + '.is-warn .st-wic');
    b.termsAcceptedAt = keep.t; b.regSubmitted = keep.s; b.regCount = keep.c; renderBookingHub();
    return { all, one, allCap, oneCap };
  });
  ok(/All recorded/.test(excep.all) && excep.allCap, `everything in → ONE green ✓ capsule (${excep.all})`);
  ok(/1 not recorded/.test(excep.one) && excep.oneCap, `un-record one fact → the amber capsule counts it, triangle on (${excep.one})`);
  // (3) Needs attention: an outstanding register surfaces as its own red row
  // with its fix actions folded under; completing it removes the whole
  // section; and when the TO-DO CARD already carries the register ask, the
  // section stands down — one statement of one duty.
  const attn = await page.evaluate(() => {
    const b = findBookingById('b1');
    const keep = { url: b.regUrl, pay: b.payment, hold: b.holdStatus, amt: b.holdAmount, s: b.regSubmitted, c: b.regCount };
    b.regUrl = 'guest-details.php?b=1&token=z'; renderBookingHub();
    const shown = {
      row: !!document.querySelector('[data-grp="reg"]'),
      cap: ((document.querySelector('.bhub-grpcap.is-attn') || {}).textContent || '').trim(),
      acts: !!document.querySelector('#bhub-fold-reg [data-act="copyGuestRegLink"]'),
    };
    b.regSubmitted = true; b.regCount = 2; renderBookingHub();
    const done = !!document.querySelector('[data-grp="reg"]');
    // Paid off + register outstanding → the to-do card IS the register ask.
    b.regSubmitted = false; b.regCount = 0; b.payment = 'paid'; b.holdStatus = 'charged'; b.holdAmount = 50;
    renderBookingHub();
    const standsDown = {
      row: !!document.querySelector('[data-grp="reg"]'),
      todo: ((document.querySelector('.bhub-next') || {}).textContent || '').trim(),
    };
    b.regUrl = keep.url; b.payment = keep.pay; b.holdStatus = keep.hold; b.holdAmount = keep.amt;
    b.regSubmitted = keep.s; b.regCount = keep.c; renderBookingHub();
    return { shown, done, standsDown };
  });
  ok(attn.shown.row && /Needs attention/.test(attn.shown.cap) && attn.shown.acts,
    'an outstanding register surfaces in Needs attention with its fix actions folded under');
  ok(!attn.done, 'a completed register removes the section — nothing red on a booking that needs nothing');
  ok(!attn.standsDown.row && /register|Guest details/i.test(attn.standsDown.todo),
    `…and it stands down when the to-do card already carries the ask (${attn.standsDown.todo.slice(0, 50)})`);

  // ---------- A2. payment ledger: traffic-light dots ----------
  // With Square on, the hub's per-payment ledger rows show the SAME green/amber/
  // red dot system as the Payments screen — no raw "(COMPLETED)" text. An issued
  // deposit return reads green (Completed) even while Square still says PENDING.
  console.log('A2. payment ledger dots');
  await page.evaluate(() => { squareAdminEnabled = true; showDetails('21a', findBookingById('b1')); });
  await page.waitForTimeout(700);
  const led = await page.evaluate(() => {
    const el = document.querySelector('.sq-pay-history');
    if (!el) return null;
    return {
      text: el.textContent,
      dots: [...el.querySelectorAll('.feed-dot')].map((d2) => d2.className),
      labels: [...el.querySelectorAll('[role="img"]')].map((s) => s.getAttribute('aria-label')),
    };
  });
  ok(!!led && led.dots.length === 2, `ledger renders a status dot per payment row (${led && led.dots.length})`);
  ok(!!led && /feed-dot-ok/.test(led.dots[0] || '') && /feed-dot-ok/.test(led.dots[1] || ''), `settled charge AND issued return both read green (${led && led.dots.join(' | ')})`);
  ok(!!led && led.labels.join('|') === 'Completed|Completed', `the word rides as the aria/hover label (${led && led.labels.join('|')})`);
  ok(!!led && !/\(COMPLETED\)|\(PENDING\)/.test(led.text), 'no raw status text left in the ledger rows');
  // THE LEDGER ROW SHOWS WHAT THE CARD TOOK. payments.amount is rental-only (the
  // bundled damages deposit lives on hold_*), so the charge row read the rental
  // figure while the guest's statement — and Received-so-far directly above —
  // both counted the deposit (reported with a screenshot: "Deposit · £175.00"
  // under a £225 charge). The carried deposit folds into the shown figure and is
  // named; the deposit's own return stays its own −£75.00 row.
  ok(!!led && /£631\.20/.test(led.text) && !/£556\.20/.test(led.text),
    `the charge row shows the card's own figure, not the rental-only ledger amount (${led && led.text.replace(/\s+/g, ' ').slice(0, 90)})`);
  ok(!!led && /incl\. £75\.00 damages deposit/.test(led.text),
    '…and names the deposit inside it');
  // REFUNDS LEFT THE STORY (owner's ask): the Activity card is the record of
  // what happened, so it carries no destructive money control — the capability
  // lives on the money surface. What must SURVIVE the move is the cap: the
  // RENTAL portion, never the deposit-inclusive figure, because the damages
  // half goes back through Return deposit where its hold state is tracked.
  ok(await page.evaluate(() => !document.querySelector('.sq-pay-history [data-act="refundPayment"]')),
    'no Refund control inside the Activity story');
  // Money taken + still refundable → the offer stands on the Payments block.
  const refundHome = await page.evaluate(() => {
    const b = findBookingById('b1');
    b.payment = 'deposit';
    b.depositPaid = 110; // something has actually been taken
    renderBookingHub();
    return !!document.querySelector('.bhub-headpay [data-act="hubRefundPicker"]');
  });
  ok(refundHome, 'the Payments block offers "Refund a card payment" instead');
  // Drive it: ONE settled charge in the fixture → straight to the amount
  // prompt, whose ceiling is the rental portion.
  const cap = await page.evaluate(async () => {
    const orig = window.glassPrompt;
    let msg = '', def = '';
    window.glassPrompt = (m, d) => { msg = m; def = d; return Promise.resolve(null); };
    await hubRefundPicker('b1');
    window.glassPrompt = orig;
    return { msg: msg, def: def };
  });
  // The ENFORCED ceiling is the rental portion — the damages half goes back
  // through Return deposit, which stamps hold_status, so refunding it here would
  // leave it looking still held and returnable twice.
  ok(cap.def === '556.2', `the refund cap stays the rental portion (prefilled ${cap.def})`);
  // …AND THE DIALOG SAYS WHY. Reported from the owner's phone: a charge the hub
  // and the card statement both say took £631.20, offering "Up to £556.20" with
  // no explanation — a correct cap reading as a wrong figure. It now names what
  // the charge took and where the rest goes.
  ok(/£631\.20/.test(cap.msg), `…and the dialog states what the charge actually took (${cap.msg})`);
  ok(/£75\.00/.test(cap.msg) && /Return deposit/i.test(cap.msg),
    '…naming the refundable deposit and the control that returns it');
  await page.evaluate(() => {
    const b = findBookingById('b1');
    b.payment = 'unpaid';
    b.depositPaid = 0;
    renderBookingHub();
  });
  await page.waitForTimeout(300);

  // ---------- A2b. a finished stay that still owes money chases the balance ----------
  console.log('A2b. past-but-unpaid banner');
  await page.evaluate(() => showDetails('21a', findBookingById('b4')));
  await page.waitForTimeout(500);
  const pastPay = await page.evaluate(() => (document.querySelector('.bhub-next') || {}).textContent || '');
  ok(/still owed from this finished stay/.test(pastPay) && !/All set/.test(pastPay), `finished + unpaid → chases the balance, not "all set" (${pastPay.trim().slice(0, 60)})`);

  // ---------- A2c. ONE staged ask, in the payask — never a second copy ----------
  // History matters here: the staged email button was ADDED to this row when
  // the ask lived in a banner a screen above (the owner had to go back up for
  // it); then the banner moved INTO the Payments block, and the row's copy
  // became a strict duplicate — measured at 390px, the same requestPayment
  // three times in one screen-height (payask, row, sticky). The payask IS the
  // staged ask now (hubAskKind still derives the stage), and this gate asserts
  // both halves: the stage on the ONE control, and the absence of the twin.
  console.log('A2c. one staged ask, no duplicate');
  const askShape = async () => page.evaluate(() => {
    const row = document.querySelector('.bhub-headpay .bhub-btn-row [data-act="requestPayment"]');
    const ban = document.querySelector('.bhub-next [data-act="requestPayment"]');
    const kind = (el) => { try { return JSON.parse(el.getAttribute('data-args') || '[]')[1] || ''; } catch (e) { return ''; } };
    return {
      rowDup: !!row,
      banKind: ban ? kind(ban) : '',
      asks: document.querySelectorAll('.bhub-head [data-act="requestPayment"]').length,
    };
  });
  // b4 is part-paid (deposit in, balance owed) and Square is on → the SUBSEQUENT ask.
  let ask = await askShape();
  ok(ask.banKind === 'balance' && !ask.rowDup,
    `a part-paid booking's payask carries the subsequent balance stage, once (${ask.banKind}, ${ask.asks} ask control)`);
  // b1 has nothing paid → the deposit ask.
  await page.evaluate(() => showDetails('21a', findBookingById('b1')));
  await page.waitForTimeout(500);
  ask = await askShape();
  ok(ask.banKind === 'deposit' && !ask.rowDup,
    `an unpaid booking's payask carries the deposit stage, once (${ask.banKind}, ${ask.asks} ask control)`);
  ok(ask.asks === 1, `the header holds exactly ONE email-ask control (${ask.asks})`);

  // ---------- A2d. …AND THE FIGURE BESIDE IT IS THAT STAGE'S ----------
  // Reported from the owner's phone: a £440 booking three months out read
  // "Nothing received yet — £440.00 due" over a sticky bar saying £440.00,
  // directly above a plan panel reading "£147.50 deposit · Not asked yet".
  // The stage was right and the CHARGE was right (the server derives it, and
  // would have taken £147.50) — the two sentences the owner reads were quoting
  // different stages of the same money. A2c gated the STAGE and nothing gated
  // the FIGURE, which is exactly how it survived. b1 is the reported booking:
  // £390 rental + £50 refundable, 25% site standard, arriving in 30 days.
  // Asserted as an INVARIANT against the plan panel's own figure rather than
  // hardcoded pounds: the fixture's rental is not the owner's, and a gate that
  // writes the number down measures the fixture instead of the rule.
  const askFig = async () => page.evaluate(() => ({
    ban: ((document.querySelector('.bhub-payask .bhub-next-text') || {}).textContent || '').trim(),
    sticky: ((document.querySelector('.bhub-sticky-fig') || {}).textContent || '').trim(),
    plan: ((document.querySelector('.bhub-plan .bhub-plan-fig') || {}).textContent || '').trim(),
    total: ((document.querySelector('.bhub-payline-fig') || {}).textContent || '').trim(),
  }));
  const money = (s) => (String(s).match(/£[\d,]+\.\d{2}/) || [''])[0];
  let fig = await askFig();
  const planDep = money(fig.plan);
  // Without this the other three could all pass by quoting the whole stay.
  ok(planDep && planDep !== money(fig.total),
    `the deposit stage is a SMALLER figure than the whole stay (${planDep} of ${money(fig.total)})`);
  ok(money(fig.ban) === planDep, `the payask quotes the DEPOSIT it will actually send (${fig.ban})`);
  ok(money(fig.sticky) === planDep, `…and the sticky bar names that same figure (${fig.sticky})`);

  // THE REFUNDABLE DEPOSIT IN THAT FIGURE IS THE ONE ACTUALLY TAKEN, not the
  // agreed one. The `update` action re-snapshots agreed_booking_fee while
  // hold_amount stays put, so after a deposit edit the two diverge — Gap 3,
  // which invoice.php already had fixed and this panel had reproduced:
  // depositTakenAmt(p, b) reads the agreed figure off its FIRST argument and
  // the hold off its SECOND, and both admin call sites passed it ONE, so `held`
  // was always 0 and it could only ever return the agreed figure.
  // Here the card took £30 against a £50 agreed deposit; quoting £50 would
  // promise back money that was never collected.
  await page.evaluate(() => {
    const b = findBookingById('b1');
    b.holdStatus = 'charged'; b.holdAmount = 30;
    showDetails('21a', b);
  });
  await page.waitForTimeout(400);
  const era = await page.evaluate(() => ((document.querySelector('.bhub-plan') || {}).textContent || ''));
  ok(/£30\.00 refundable deposit/.test(era) && !/£50\.00 refundable deposit/.test(era),
    `the plan quotes the deposit the card TOOK, not the agreed one (${(era.match(/\+ £[\d.]+ refundable deposit/) || ['none'])[0]})`);
  await page.evaluate(() => {
    const b = findBookingById('b1');
    b.holdStatus = 'none'; b.holdAmount = 0;
    showDetails('21a', b);
  });
  await page.waitForTimeout(400);

  // The one case where the WHOLE stay is the right figure: inside the balance
  // window booking_payment_kind upgrades a deposit ask to 'balance', so the
  // banner must upgrade with it — quoting the deposit there would be the same
  // defect pointing the other way, under-asking instead of over-asking.
  // Mutated in place and restored, so no fixture row is added for the later
  // sections to trip over.
  await page.evaluate((iso) => { const b = findBookingById('b1'); b.checkIn = iso; showDetails('21a', b); }, d(5));
  await page.waitForTimeout(400);
  fig = await askFig();
  ok(money(fig.ban) === money(fig.total), `inside the balance window the ask IS the whole stay (${fig.ban})`);
  ok(money(fig.sticky) === money(fig.total), `…and the sticky bar follows it (${fig.sticky})`);
  await page.evaluate((iso) => { const b = findBookingById('b1'); b.checkIn = iso; showDetails('21a', b); }, d(30));
  await page.waitForTimeout(400);

  // A SLICE IS NOT ITS STAGE. Part payment lets a guest pay SOME of the deposit,
  // which the old `gt.paid > 0` test read as "the deposit is done" — so £20 of a
  // £147.50 deposit flipped the ask to the balance and quoted the whole stay,
  // the A2d over-ask arriving through a new door and breaking the schedule the
  // guest agreed to. Asserted as an invariant against the plan panel's own
  // figure, for the reason A2d states: writing the pounds down measures the
  // fixture rather than the rule.
  // Read the resting shape FIRST: once part-paid, the payline states what has
  // been RECEIVED rather than the stay total, so the whole-stay figure has to be
  // captured before the mutation or the comparison measures the wrong number.
  const rest = await askFig();
  const stayTotal = money(rest.total);
  const planNum = Number(String(money(rest.plan)).replace(/[£,]/g, ''));
  await page.evaluate(() => { const b = findBookingById('b1'); b.depositPaid = 20; b.payment = 'deposit'; showDetails('21a', b); });
  await page.waitForTimeout(450);
  const part = await askFig();
  ask = await askShape();
  ok(ask.banKind === 'deposit', `a part-paid DEPOSIT is still the deposit stage (${ask.banKind})`);
  ok(money(part.ban) !== stayTotal, `…so the ask is not the whole stay (${money(part.ban)} of ${stayTotal})`);
  // What is left OF THE DEPOSIT: the plan panel's own figure less the £20 in.
  const owedDep = '£' + (planNum - 20).toFixed(2);
  ok(money(part.ban) === owedDep, `…it is the REST of the deposit (${money(part.ban)}, plan £${planNum.toFixed(2)} less £20.00)`);
  ok(money(part.sticky) === owedDep, `…and the sticky bar names that same figure (${part.sticky})`);
  // Paying the deposit OFF still moves the stage on — this is a boundary, not a
  // block (break-tested: pinning 'deposit' outright fails here).
  await page.evaluate((paid) => { const b = findBookingById('b1'); b.depositPaid = paid; showDetails('21a', b); }, planNum);
  await page.waitForTimeout(450);
  ask = await askShape();
  ok(ask.banKind === 'balance', `a SETTLED deposit moves on to the balance (${ask.banKind})`);
  await page.evaluate(() => { const b = findBookingById('b1'); b.depositPaid = 0; b.payment = 'unpaid'; showDetails('21a', b); });
  await page.waitForTimeout(400);

  // b3 is paid in full → nothing left to ask for.
  await page.evaluate(() => showDetails('21a', findBookingById('b3')));
  await page.waitForTimeout(500);
  ask = await askShape();
  ok(ask.banKind === '' && !ask.rowDup && ask.asks === 0, 'a paid-in-full booking offers no email ask at all');

  // ---------- A3. finished stay: Edit is soft-locked ----------
  // A checked-out booking is a record (invoices, guest register, directory) —
  // tapping Edit asks first; Cancel leaves it untouched, OK opens the normal
  // form (dates/cottage still locked by the arrived rule). An upcoming stay
  // keeps its instant, confirm-free edit.
  console.log('A3. past-stay edit soft lock');
  await page.evaluate(() => showDetails('21a', findBookingById('b3')));
  await page.waitForTimeout(500);
  await page.evaluate(() => openEditBooking('b3'));
  await page.waitForTimeout(300);
  const sl1 = await page.evaluate(() => ({
    dlg: document.getElementById('glass-dialog').classList.contains('open'),
    msg: (document.getElementById('glass-dialog-msg') || {}).textContent || '',
    modal: document.getElementById('edit-modal').classList.contains('open'),
  }));
  ok(sl1.dlg && /finished/.test(sl1.msg) && /record/.test(sl1.msg), `finished stay: Edit asks first (${sl1.msg.slice(0, 60).trim()}…)`);
  ok(!sl1.modal, 'the edit form does NOT open until confirmed');
  await page.click('#glass-dialog-cancel');
  await page.waitForTimeout(250);
  ok(!(await page.evaluate(() => document.getElementById('edit-modal').classList.contains('open'))), 'Cancel keeps the record untouched (no edit form)');
  await page.evaluate(() => openEditBooking('b3'));
  await page.waitForTimeout(250);
  await page.click('#glass-dialog-ok');
  await page.waitForTimeout(300);
  const sl3 = await page.evaluate(() => ({
    modal: document.getElementById('edit-modal').classList.contains('open'),
    locked: !!document.getElementById('modal-move-locked'),
  }));
  ok(sl3.modal && sl3.locked, 'OK opens the form — dates/cottage still locked (arrived rule)');
  await page.evaluate(() => closeModal());
  await page.evaluate(() => openEditBooking('b1'));
  await page.waitForTimeout(250);
  const sl4 = await page.evaluate(() => ({
    modal: document.getElementById('edit-modal').classList.contains('open'),
    dlg: document.getElementById('glass-dialog').classList.contains('open'),
  }));
  ok(sl4.modal && !sl4.dlg, 'upcoming stay: edit opens instantly, no confirm');
  // While the EDIT modal is open: the plan fields must NOT render — an
  // existing booking's plan is edited from its hub, not here.
  const planInEdit = await page.evaluate(() => {
    const g = document.getElementById('modal-plan-group');
    return g ? getComputedStyle(g).display : 'missing';
  });
  ok(planInEdit === 'none', `the plan fields hide in EDIT mode (${planInEdit})`);
  await page.evaluate(() => closeModal());

  // ---------- A3b. THE GUEST BOOK (migration-121) ----------
  // The rate card is a fold on PAST stays only; saving posts the validated
  // write; the summary flips to the stars; an upcoming stay carries no card at
  // all. Then the payoff: an enquiry whose guest's last stay was rated ≤2★ (or
  // rules-poor) raises the amber pause — and the Approve button renders
  // IDENTICALLY, the never-decides rule pinned where it could erode.
  console.log('A3b. the guest book');
  const gbPosts = [];
  await page.route('**/bookings.php', (route) => {
    let body = {};
    try { body = JSON.parse(route.request().postData() || '{}'); } catch (e) {}
    if (body.action === 'rate_guest') {
      gbPosts.push(body);
      return route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ ok: true, at: '2026-08-27 10:00:00' }) });
    }
    return route.fallback();
  });
  await page.evaluate(() => showDetails('21a', findBookingById('b3')));
  await page.waitForTimeout(450);
  const gb1 = await page.evaluate(() => ({
    host: !!document.getElementById('gb-card-host'),
    sum: (document.querySelector('#gb-card-host .bhub-fold-grp') || {}).textContent || '',
  }));
  ok(gb1.host && /Not rated/.test(gb1.sum), 'a past stay carries the Guest book fold, honestly unrated');
  // Open the fold, rate 4★, mark House rules poor, save.
  await page.evaluate(() => bhubFoldToggle('rating'));
  await page.waitForTimeout(200);
  await page.click('#gb-card-host .gb-star[aria-label="4 stars"]');
  await page.waitForTimeout(200);
  await page.evaluate(() => { const b2 = document.querySelector('#gb-card-host .gb-more'); if (b2) b2.click(); });
  await page.waitForTimeout(200);
  await page.evaluate(() => {
    const seg = document.querySelectorAll('#gb-card-host .gb-cat')[1]; // House rules
    if (seg) seg.querySelectorAll('.gb-seg button')[1].click(); // Poor
  });
  await page.waitForTimeout(200);
  await page.evaluate(() => {
    const ta = document.querySelector('#gb-card-host textarea');
    if (ta) ta.value = 'Smoked on the patio.';
    const btns = document.querySelectorAll('#gb-card-host button');
    btns[btns.length - 1].click(); // Save to the guest book
  });
  await page.waitForTimeout(400);
  const gb2 = await page.evaluate(() => ({
    sum: (document.querySelector('#gb-card-host .bhub-fold-grp') || {}).textContent || '',
  }));
  ok(gbPosts.length === 1 && gbPosts[0].overall === 4 && gbPosts[0].rules === 'poor' && /patio/.test(gbPosts[0].note || ''),
    `Save posts the validated write (${gbPosts[0] && gbPosts[0].overall}★, rules ${gbPosts[0] && gbPosts[0].rules})`);
  ok(/★★★★☆/.test(gb2.sum), 'the summary flips to the stars');
  // An UPCOMING stay: no card at all — you rate a stay once it's over.
  await page.evaluate(() => showDetails('21a', findBookingById('b1')));
  await page.waitForTimeout(400);
  ok(await page.evaluate(() => !document.getElementById('gb-card-host')), 'an upcoming stay carries no Guest book card');
  // THE PAYOFF + THE PAUSE. Wire e7's email onto b3 and rate the stay 2★:
  // the enquiry hub shows the rating and the amber pause; Approve stays a
  // normal, enabled button. At 5★ the pause stands down.
  await page.evaluate(() => {
    const e = (enquiries || []).find((x) => String(x.id).replace('e', '') === '7');
    const b2 = findBookingById('b3');
    b2.email = e.email = 'gbook@x.co';
    b2.guestRating = { overall: 2, clean: '', rules: '', comms: '', note: 'Left it in a state.', at: '2026-08-01 10:00:00' };
    try { window.__chbDataGen = (Number(window.__chbDataGen) || 0) + 1; } catch (err) {}
    return openEnquiryHub('e7');
  });
  await page.waitForTimeout(450);
  const gb3 = await page.evaluate(() => ({
    pause: (document.querySelector('.gb-pause') || {}).textContent || '',
    stars: (document.querySelector('.gb-starline') || {}).textContent || '',
    note: (document.querySelector('.gb-note') || {}).textContent || '',
    approve: (() => { const b2 = document.querySelector('[data-act="approveEnquiry"]'); return b2 ? !b2.disabled : false; })(),
  }));
  ok(/Worth a pause/.test(gb3.pause) && /a memory, not a rule/.test(gb3.pause), `a 2★ last stay raises the pause (${gb3.pause.slice(0, 44).trim()}…)`);
  ok(/★★☆☆☆/.test(gb3.stars) && /Left it in a state/.test(gb3.note), 'the enquiry shows your rating and your note');
  ok(gb3.approve, 'NEVER DECIDES: Approve renders enabled exactly as for anyone else');
  await page.evaluate(() => {
    const b2 = findBookingById('b3');
    b2.guestRating = { overall: 5, clean: 'good', rules: '', comms: '', note: '', at: '2026-08-01 10:00:00' };
    try { window.__chbDataGen = (Number(window.__chbDataGen) || 0) + 1; } catch (err) {}
    return openEnquiryHub('e7');
  });
  await page.waitForTimeout(400);
  ok(await page.evaluate(() => !document.querySelector('.gb-pause') && /★★★★★/.test((document.querySelector('.gb-starline') || {}).textContent || '')),
    'a 5★ guest reads as a quiet memory — no pause');
  // Restore the FIXTURES' OWN values for the sections that follow (b3 =
  // past@gmail.com, e7 = beta@gmail.com — deliberately distinct emails).
  await page.evaluate(() => {
    const e = (enquiries || []).find((x) => String(x.id).replace('e', '') === '7');
    const b2 = findBookingById('b3');
    delete b2.guestRating;
    b2.email = 'past@gmail.com';
    if (e) e.email = 'beta@gmail.com';
    try { window.__chbDataGen = (Number(window.__chbDataGen) || 0) + 1; } catch (err) {}
    // Stand the enquiry hub DOWN the app's own way: renderInbox's empty branch
    // nulls __enqHubId (script-scoped — unreachable directly, the currentGuest
    // rule) and clears #enquiry-hub-content. Without this, (a) the stale
    // '.bhub-next' shadows the booking hub's in section B's document-wide
    // selector (hidden views keep content; textContent reads pass through
    // hidden), and (b) section J's auto-dock keeps e7 instead of picking the
    // first row (Enq Alpha), whose message its checks read.
    const saved = enquiries.splice(0, enquiries.length);
    renderInbox();
    enquiries.push(...saved);
    renderInbox();
  });
  await page.unroute('**/bookings.php');

  // ---------- A4. payment plan at ADD time ----------
  console.log('A4. payment plan in the Add Booking flow');
  await page.evaluate(() => window.openAddBooking());
  await page.waitForTimeout(250);
  const planInAdd = await page.evaluate(() => ({
    shown: getComputedStyle(document.getElementById('modal-plan-group')).display !== 'none',
    stdOn: document.getElementById('modal-plan-std-btn').classList.contains('is-on'),
    fieldsHidden: document.getElementById('modal-plan-custom').style.display === 'none',
    pctBlank: (document.getElementById('modal-plan-pct') || {}).value === '',
    dueBlank: (document.getElementById('modal-plan-due') || {}).value === '',
  }));
  ok(planInAdd.shown && planInAdd.stdOn && planInAdd.fieldsHidden && planInAdd.pctBlank && planInAdd.dueBlank,
    'ADD opens on the STANDARD toggle, fields folded and blank');
  // Toggle CUSTOM, fill a 30% / dated plan → the add POST carries the plan.
  await page.click('#modal-plan-custom-btn');
  await page.evaluate((f) => {
    document.getElementById('modal-property').value = '21a';
    document.getElementById('modal-name').value = 'Plan At Add';
    document.getElementById('modal-checkin').value = f.ci;
    document.getElementById('modal-checkout').value = f.co;
    document.getElementById('modal-plan-pct').value = '30';
    document.getElementById('modal-plan-due').value = f.due;
  }, { ci: d(46), co: d(49), due: d(44) });
  const postsBefore = posts.length;
  await page.evaluate(() => saveModal());
  await page.waitForTimeout(600);
  const addPost = posts.slice(postsBefore).find((p) => p.__url === 'bookings.php' && p.action === 'add');
  ok(!!addPost && addPost.deposit_pct === '30' && addPost.balance_due_date === d(44),
    `the add payload carries the plan (${addPost ? addPost.deposit_pct + ' / ' + addPost.balance_due_date : 'no add post'})`);
  // A blank plan sends NOTHING — absent keys, never empty strings the server
  // could misread as "clear" (there is nothing to clear at add time).
  await page.evaluate(() => window.openAddBooking());
  await page.waitForTimeout(250);
  await page.evaluate((f) => {
    document.getElementById('modal-property').value = '21a';
    document.getElementById('modal-name').value = 'Standard At Add';
    document.getElementById('modal-checkin').value = f.ci;
    document.getElementById('modal-checkout').value = f.co;
  }, { ci: d(60), co: d(63) });
  const postsBefore2 = posts.length;
  await page.evaluate(() => saveModal());
  await page.waitForTimeout(600);
  const addPost2 = posts.slice(postsBefore2).find((p) => p.__url === 'bookings.php' && p.action === 'add');
  ok(!!addPost2 && !('deposit_pct' in addPost2) && !('balance_due_date' in addPost2),
    'blank plan fields stay OUT of the payload');
  // TYPED THEN REVERTED: values entered under Custom must die with the toggle —
  // a plan the owner backed out of can never ride the save silently.
  await page.evaluate(() => window.openAddBooking());
  await page.waitForTimeout(250);
  await page.click('#modal-plan-custom-btn');
  await page.evaluate((f) => {
    document.getElementById('modal-property').value = '21a';
    document.getElementById('modal-name').value = 'Reverted Plan';
    document.getElementById('modal-checkin').value = f.ci;
    document.getElementById('modal-checkout').value = f.co;
    document.getElementById('modal-plan-pct').value = '40';
    document.getElementById('modal-plan-due').value = f.due;
  }, { ci: d(66), co: d(69), due: d(64) });
  await page.click('#modal-plan-std-btn');
  const postsBefore3 = posts.length;
  await page.evaluate(() => saveModal());
  await page.waitForTimeout(600);
  const addPost3 = posts.slice(postsBefore3).find((p) => p.__url === 'bookings.php' && p.action === 'add');
  ok(!!addPost3 && !('deposit_pct' in addPost3) && !('balance_due_date' in addPost3),
    'a plan typed then toggled back to Standard sends NOTHING');
  await page.evaluate(() => closeModal());
  // Back to the b1 hub for the sections that follow.
  await page.evaluate(() => showDetails('21a', findBookingById('b1')));
  await page.waitForTimeout(600);

  // ---------- B. next action follows state ----------
  console.log('B. next action');
  const next1 = await page.evaluate(() => (document.querySelector('.bhub-next') || {}).textContent || '');
  // £160 = 25% of the £440 rental + the £50 refundable damages deposit that
  // rides the guest's first payment. It USED to assert £490 here — the whole
  // stay — with a comment calling it "the same figure the Money area shows as
  // due", which is the conflation itself: the Money area answers "what do they
  // still owe", this banner answers "what will this button send", and outside
  // the balance window those are different stages of the same money. A2d owns
  // the general invariant; this keeps the arithmetic written down once.
  ok(/Nothing received yet/.test(next1) && /£160\.00 deposit due/.test(next1), `unpaid → deposit ask (${next1.trim().slice(0, 60)}…)`);
  // Record £100 through the unified flow, hub should re-render with balance ask.
  const rp = page.evaluate(() => window.recordPayment('b1'));
  await page.waitForTimeout(700);
  await page.evaluate(() => { document.getElementById('gdf-amount').value = '100'; });
  await page.evaluate(() => glassDialogResolve(true));
  await page.waitForTimeout(700);
  // THE SEND BUTTON FITS ITS SHEET. Its label is set at send time ("Send
  // updated confirmation" — 24 uppercase, letter-spaced characters) and a flex
  // child will not shrink below its own content, so on a phone it ran straight
  // out of the box (owner's screenshot). Measured at 390 with the real long
  // label injected, since the short ones fit on their own.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(200);
  const sendFit = await page.evaluate(() => {
    const ov = document.getElementById('send-confirm-overlay');
    if (!ov || !ov.classList.contains('open')) return null;
    const btn = document.getElementById('send-confirm-send');
    btn.textContent = 'Send updated confirmation';
    const box = ov.querySelector('.modal-box');
    const br = box.getBoundingClientRect();
    const r = btn.getBoundingClientRect();
    return {
      inside: r.right <= br.right + 0.5 && r.left >= br.left - 0.5,
      noOverflow: btn.scrollWidth <= Math.ceil(r.width) + 1,
    };
  });
  ok(sendFit && sendFit.inside && sendFit.noOverflow,
    `the send button stays inside its sheet at 390px (${sendFit ? JSON.stringify(sendFit) : 'no preview'})`);
  await page.setViewportSize({ width: 1000, height: 900 });
  await page.waitForTimeout(200);
  // The updated-confirmation offer now PREVIEWS the email first — cancel that
  // send-confirm modal (or the plain confirm if no preview was produced).
  await page.evaluate(() => {
    const ov = document.getElementById('send-confirm-overlay');
    if (ov && ov.classList.contains('open')) document.getElementById('send-confirm-cancel').click();
    else try { glassDialogResolve(false); } catch (e) {}
  });
  await rp.catch(() => {});
  await rp;
  await page.waitForTimeout(500);
  const next2 = await page.evaluate(() => (document.querySelector('.bhub-next') || {}).textContent || '');
  // £100 against a £160 deposit does NOT settle the deposit, so the next ask is
  // the REST OF IT — £60 — and not the £390 whole outstanding. This gate used to
  // assert the £390: the client read "anything is in" as "the deposit is done"
  // and jumped the schedule the guest agreed to, while the SERVER's own default
  // (booking_deposit_settled) would have charged £60. A second, independent
  // witness of the rule the part-paid case above pins.
  ok(/£60\.00 of the deposit still to come/.test(next2), `after £100 of a £160 deposit → the REST of the deposit (${next2.trim().slice(0, 50)}…)`);
  ok(!/balance remaining/.test(next2), '…and the words do not name a stage the figure is not');
  const pipe2 = await page.evaluate(() => ((document.querySelector('.bhub-next-cap') || {}).textContent || '').trim());
  // The cap follows the ASK's stage, not the flow cursor: £100 of a £160
  // deposit is still the DEPOSIT stage (the sentence beside it says so), even
  // though the flow's coarse "anything in" test moved its cursor past it.
  ok(/^Next · \d of \d · Deposit$/.test(pipe2), `the stage cap names the ask's own stage (${pipe2})`);
  // Part-paid folds too: one "Received so far" payline with the running figures.
  const foldPart = await page.evaluate(() => {
    const rows = document.querySelectorAll('#booking-hub-content .bhub-payline');
    return { rows: rows.length, line: rows[0] ? rows[0].textContent : '' };
  });
  ok(foldPart.rows === 1 && /Received so far/.test(foldPart.line) && /£100\.00 of £490\.00/.test(foldPart.line), `part-paid money folds to one payline (${foldPart.line.trim()})`);
  // Settled money folds to one line; the breakdown stays one tap away.
  // (Settle b1 for this check, restore its part-paid state afterwards.)
  // SETTLED MEANS THE DEPOSIT TOO. Setting payment='paid' alone leaves the £50
  // refundable deposit uncollected — hold_status stays 'none' and nothing was
  // charged — and that is no longer "Paid in full": displayGrand's fullyPaid used
  // to short-circuit on the RENTAL rail's answer and printed paid-in-full over a
  // real £50 balance (the whole point of this batch). A card-rail settled booking
  // has the deposit charged with the payment, so the fixture says so.
  await page.evaluate(() => {
    const b = findBookingById('b1');
    b.payment = 'paid';
    b.holdStatus = 'charged';
    b.holdAmount = 50;
    openBookingHub('b1', true);
  });
  await page.waitForTimeout(400);
  const fold = await page.evaluate(() => {
    const rows = document.querySelectorAll('#booking-hub-content .bhub-payline');
    return {
      folded: !!document.querySelector('.bhub-disclose-btn[data-act="bhubMoneyExpand"]'),
      rows: rows.length,
      line: rows[0] ? rows[0].textContent : '',
      moreClosed: !!(document.getElementById('bhub-money-more') || {}).hidden,
    };
  });
  ok(fold.folded && fold.rows === 1 && /Paid in full/.test(fold.line), `settled money folds to one payline (${fold.rows} row)`);
  ok(fold.moreClosed, 'the money fold starts closed');
  // INK DISCIPLINE (the capsules pass): the serif figure keeps the HOUSE ink —
  // the one green thing on a settled payline is the ✓ mark. Painting the
  // whole row status-green is what the owner's screenshot showed.
  const payInk = await page.evaluate(() => {
    const fig = document.querySelector('.bhub-payline-fig');
    const lbl = document.querySelector('.bhub-payline-label');
    return {
      figInk: fig ? getComputedStyle(fig).color : '',
      lblInk: lbl ? getComputedStyle(lbl).color : '',
      mark: !!document.querySelector('.bhub-payline-fig .bhub-payok'),
    };
  });
  ok(payInk.figInk === payInk.lblInk, `the settled figure wears the house ink, not status green (${payInk.figInk})`);
  ok(payInk.mark, 'the ✓ is the one green mark on the payline');
  // THE MONEY SITS ON THE SAME RIGHT RAIL AS EVERY OTHER SUMMARY. Reported from
  // a phone: the payline's figure sat mid-row while Guest details and Emails
  // pinned their capsules right, because .bhub-fold-row is space-between and the
  // payline had THREE children (main / figure / chevron) where bhubFoldGrp gives
  // every other row two (label / .bhub-fold-right). Asserted as an OUTCOME — the
  // figure's right edge against the other rows' — so it cannot pass on any future
  // markup that happens to carry the class while landing the money elsewhere.
  // Measured against each row's OWN content edge, never across rows: the money
  // block sits one card deeper than the fold groups, so their absolute rails
  // differ by 2px of card inset — real, invisible, and nothing to do with this.
  const rail = await page.evaluate(() => {
    const edge = (row) => {
      const grp = row.querySelector('.bhub-fold-right');
      if (!grp) return null; // no right-hand group at all — the defect itself
      const rr = row.getBoundingClientRect();
      const pad = parseFloat(getComputedStyle(row).paddingRight) || 0;
      return Math.round(rr.right - pad - grp.getBoundingClientRect().right);
    };
    const payRow = document.querySelector('#booking-hub-content .bhub-payline');
    const fig = document.querySelector('#booking-hub-content .bhub-payline-fig');
    const chev = document.querySelector('#booking-hub-content .bhub-payline .bhub-chev');
    return {
      pay: payRow ? edge(payRow) : null,
      others: [...document.querySelectorAll('#booking-hub-content .bhub-fold-grp .bhub-fold-row')].map(edge),
      // How far the money sits from the chevron it should be packed against.
      packed: fig && chev ? Math.round(chev.getBoundingClientRect().left - fig.getBoundingClientRect().right) : null,
    };
  });
  // Vacuity guard: without sibling rows there is no shared rule to compare to.
  ok(rail.others.length >= 2, `found ${rail.others.length} sibling summaries to measure the rail against`);
  ok(
    rail.pay === 0 && rail.others.every((o) => o === 0),
    `every summary's value group ends on its row's own right rail (payline ${rail.pay}, others ${rail.others.join('/')})`,
  );
  // The direct anti-regression: as three space-between siblings the money floated
  // into the middle of the row, hundreds of pixels from its own chevron.
  ok(rail.packed != null && rail.packed <= 14, `the money is packed against the chevron, not spread (${rail.packed}px)`);
  // The full breakdown DISCLOSES IN PLACE now (the iOS restyle retired the
  // old #breakdown-modal pop-up): the fold opens under the payline with the
  // full maths, the payline itself stays the one row, and the control reports
  // its own state.
  await page.evaluate(() => document.querySelector('.bhub-disclose-btn[data-act="bhubMoneyExpand"]').click());
  await page.waitForTimeout(250);
  const expander = await page.evaluate(() => ({
    open: !document.getElementById('bhub-money-more').hidden,
    rows: document.querySelectorAll('#bhub-money-more .price-row').length,
    pageRows: document.querySelectorAll('#booking-hub-content .bhub-payline').length,
    aria: document.querySelector('.bhub-disclose-btn[data-act="bhubMoneyExpand"]').getAttribute('aria-expanded'),
    modalGone: !document.getElementById('breakdown-modal'),
  }));
  ok(expander.open && expander.rows >= 4, `the fold discloses the full maths in place (${expander.rows} rows)`);
  ok(expander.pageRows === 1 && expander.aria === 'true', 'still ONE payline; the control reports expanded');
  ok(expander.modalGone, 'the old breakdown pop-up window is gone from the document');
  await page.evaluate(() => document.querySelector('.bhub-disclose-btn[data-act="bhubMoneyExpand"]').click());
  await page.waitForTimeout(200);
  ok(await page.evaluate(() => document.getElementById('bhub-money-more').hidden), 'a second tap folds it away again');
  // Put the whole part-paid state back, deposit included (the shared-fixture rule).
  await page.evaluate(() => {
    const b = findBookingById('b1');
    b.payment = 'deposit';
    b.holdStatus = 'none';
    b.holdAmount = 0;
    openBookingHub('b1', true);
  });
  await page.waitForTimeout(400);
  const em2 = await page.evaluate(() => ({
    inEmails: !!document.querySelector('[data-grp="emails"] [data-act="offerUpdatedConfirmationEmail"]'),
    inMoney: !!document.querySelector('[data-grp="money"] [data-act="offerUpdatedConfirmationEmail"]'),
  }));
  ok(em2.inEmails && !em2.inMoney, 'updated-confirmation button lives in the Emails group (not Money)');

  // ---------- C+D. the Activity feed — one chronological story ----------
  // History + the email log + the ledger merged into #hub-history: events
  // render, the emailed body expands IN the feed, the ledger row keeps its
  // deposit_carried figure, the activity log's card-payment TWIN of that ledger
  // row is dropped (two rows for one charge is the duplication disease), and
  // the order is newest-first across sources.
  console.log('C+D. activity feed');
  const hist = await page.evaluate(() => (document.getElementById('hub-history') || {}).innerHTML || '');
  ok(/Booking edited — dates changed/.test(hist) && /Booking created/.test(hist), 'history events rendered in the feed');
  ok(/Booking confirmation emailed/.test(hist) && /Show email/.test(hist) && /Dear Guest, good news\./.test(hist),
    'a logged email expands in place in the feed');
  ok(/£631\.20/.test(hist), 'the ledger row rides the feed with its card-took figure');
  ok(!/Balance paid by card — £556\.20/.test(hist),
    "…and the activity log's twin of that charge is dropped — one charge, one row");
  const order = await page.evaluate(() => {
    const t = (document.getElementById('hub-history') || {}).textContent || '';
    return { ret: t.indexOf('Deposit return'), led: t.indexOf('£631.20'), created: t.indexOf('Booking created') };
  });
  ok(order.ret > -1 && order.led > order.ret && order.created > order.led,
    `newest first across sources (return@${order.ret} < charge@${order.led} < created@${order.created})`);

  // ONE TYPE SIZE ACROSS THE WHOLE STORY (owner's screenshot). It had FIVE:
  // 16px ledger rows (no font-size of their own, inheriting the card base)
  // towering over 13.12px event rows, plus 12.8 / 12.48 / 11.52 for the email
  // body, its disclosure and the actor — three of those within 0.7px, which is
  // a distinction no reader can use. Asserted by SWEEPING every text-bearing
  // leaf rather than listing selectors, so a new strand of the feed is covered
  // the day it is written; the email is expanded first because its body only
  // renders inside an open <details>.
  const sizes = await page.evaluate(() => {
    const d = document.querySelector('#hub-history details.bhub-feed-mail');
    if (d) d.open = true;
    const seen = {};
    const walk = (el) => {
      for (const n of el.childNodes) {
        if (n.nodeType === 3 && n.textContent.trim()) {
          const px = getComputedStyle(n.parentElement).fontSize;
          (seen[px] = seen[px] || []).push(n.textContent.trim().slice(0, 24));
        } else if (n.nodeType === 1) walk(n);
      }
    };
    walk(document.getElementById('hub-history'));
    return seen;
  });
  const keys = Object.keys(sizes);
  // Vacuity guard: a card that rendered nothing would trivially have one size.
  ok(keys.length === 1 && sizes[keys[0]].length >= 6,
    `the activity story reads at ONE size (${keys.join(', ')} over ${keys.reduce((n, k) => n + sizes[k].length, 0)} runs of text)`);

  // ---------- C2. the redesign's affordances ----------
  console.log('C2. fact rows · gap · sticky · share · draft');
  // The header's status-chip row folded into the Guest card (the iOS restyle):
  // terms (with version) / no-dog / register / payment rail / texts are
  // label+value rows now, wearing the chips' dot vocabulary — green recorded,
  // red outstanding, the rail dotless (a category, not a status). The rows
  // live inside the Guest details fold, so it is OPENED first: the roundness
  // checks measure boxes, and a hidden dot is a 0×0 box that proves nothing.
  await page.evaluate(() => { const f = document.getElementById('bhub-fold-guest'); if (f && f.hidden) bhubFoldToggle('guest'); });
  const facts = await page.evaluate(() => {
    const kv = (label) => [...document.querySelectorAll('#booking-hub-content .bhub-kv')]
      .find((r) => new RegExp('^' + label + '$', 'i').test(((r.querySelector('.bhub-kv-label') || {}).textContent || '').trim()));
    const probe = (v) => { const el = document.createElement('i'); el.style.color = `var(${v})`; document.body.appendChild(el); const c = getComputedStyle(el).color; el.remove(); return c; };
    const okC = probe('--ok');
    const read = (label) => { const r = kv(label); return r ? r.textContent.replace(/\s+/g, ' ').trim() : ''; };
    const dotOf = (label) => { const r = kv(label); const d2 = r && r.querySelector('.bhub-chip-dot'); return d2 ? getComputedStyle(d2).backgroundColor : 'none'; };
    const roundDot = (label) => { const r = kv(label); const d2 = r && r.querySelector('.bhub-chip-dot'); if (!d2) return false; const bx = d2.getBoundingClientRect(); return Math.abs(bx.width - bx.height) < 0.6 && bx.width > 5; };
    return {
      chipsGone: !document.querySelector('.bhub-chips'),
      terms: read('Terms'), nodog: read('No dog'), rail: read('Payment rail'), texts: read('Texts'),
      termsDot: dotOf('Terms'), nodogDot: dotOf('No dog'), textsDot: dotOf('Texts'),
      railDotless: (() => { const r = kv('Payment rail'); return !!r && !r.querySelector('.bhub-chip-dot'); })(),
      allRound: ['Terms', 'No dog', 'Texts'].every(roundDot),
      okC,
    };
  });
  ok(facts.chipsGone, 'the header chip row is GONE — the facts live in the Guest card rows');
  ok(/Accepted .*\(v3\)/.test(facts.terms) && /Confirmed/.test(facts.nodog) && /Card/.test(facts.rail) && /OK to text/.test(facts.texts),
    `the Guest card states all five facts (${facts.terms} | ${facts.rail} | ${facts.texts})`);
  ok(facts.termsDot === facts.okC && facts.nodogDot === facts.okC && facts.textsDot === facts.okC && facts.allRound,
    'recorded facts wear round green dots');
  ok(facts.railDotless, 'the rail row is a category, not a status — no dot');
  // Outstanding facts wear the red dot — flipped through the REAL renderer,
  // then restored (the scratch-render of the old chips gate went with them).
  const redFacts = await page.evaluate(() => {
    const probe = (v) => { const el = document.createElement('i'); el.style.color = `var(${v})`; document.body.appendChild(el); const c = getComputedStyle(el).color; el.remove(); return c; };
    const badC = probe('--danger');
    const b = findBookingById('b1');
    const keep = { t: b.termsAcceptedAt, n: b.noDogsAt };
    b.termsAcceptedAt = null; b.noDogsAt = null; renderBookingHub();
    const kv = (label) => [...document.querySelectorAll('#booking-hub-content .bhub-kv')]
      .find((r) => new RegExp('^' + label + '$', 'i').test(((r.querySelector('.bhub-kv-label') || {}).textContent || '').trim()));
    const dotOf = (label) => { const r = kv(label); const d2 = r && r.querySelector('.bhub-chip-dot'); return d2 ? getComputedStyle(d2).backgroundColor : 'none'; };
    const out = { terms: (kv('Terms') || {}).textContent || '', termsDot: dotOf('Terms'), nodogDot: dotOf('No dog'), badC };
    b.termsAcceptedAt = keep.t; b.noDogsAt = keep.n; renderBookingHub();
    return out;
  });
  ok(/Not recorded/.test(redFacts.terms) && redFacts.termsDot === redFacts.badC && redFacts.nodogDot === redFacts.badC,
    'outstanding terms/no-dog wear red dots and say Not recorded');
  // THE REGISTER'S STATUS ROW wears the same dots: red while waiting (b1),
  // green once submitted — flipped in place through the real renderer, then
  // restored.
  const regDots = await page.evaluate(() => {
    const probe = (v) => { const el = document.createElement('i'); el.style.color = `var(${v})`; document.body.appendChild(el); const c = getComputedStyle(el).color; el.remove(); return c; };
    const okC = probe('--ok'), badC = probe('--danger');
    const read = () => {
      const kv = [...document.querySelectorAll('#booking-hub-content .bhub-card .bhub-kv')].find((r) => /Register/i.test((r.querySelector('.bhub-kv-label') || {}).textContent || ''));
      const dotEl = kv && kv.querySelector('.bhub-chip-dot');
      return { text: kv ? kv.textContent.trim() : '', dot: dotEl ? getComputedStyle(dotEl).backgroundColor : 'none' };
    };
    const waiting = read();
    const b = findBookingById('b1');
    const keep = { s: b.regSubmitted, c: b.regCount, a: b.adults };
    b.regSubmitted = true; b.regCount = 2; b.adults = 2; renderBookingHub();
    const submitted = read();
    // SHORT OF THE PARTY. guest-details.php refuses a short submission against
    // the booking's adult count AT THAT MOMENT; edit the booking upward
    // afterwards and the record covers some of them. Nothing re-asked, so a
    // legally incomplete register read as done — with both figures on screen.
    b.adults = 4; renderBookingHub();
    const short = read();
    // The NEXT-ACTION slot is money-first by design, so the register branch is
    // only reachable on a settled booking — pay it off to read that sentence.
    // …and the branch is gated on flow.hasReg, i.e. the booking actually having
    // a register link, which this fixture otherwise does without.
    // PAYING IT OFF NOW MEANS THE DEPOSIT TOO: payment='paid' alone leaves the
    // refundable deposit uncollected on this rail, which is a real balance and
    // keeps the money ask in front (displayGrand no longer short-circuits a
    // settled RENTAL into "nothing outstanding").
    const keepPay = b.payment, keepUrl = b.regUrl, keepHold = b.holdStatus, keepHeld = b.holdAmount;
    b.payment = 'paid'; b.holdStatus = 'charged'; b.holdAmount = 50;
    b.regUrl = 'guest-details.php?b=1&token=z'; renderBookingHub();
    const shortNext = ((document.querySelector('.bhub-next') || {}).textContent || '').trim();
    b.payment = keepPay; b.holdStatus = keepHold; b.holdAmount = keepHeld;
    b.regUrl = keepUrl; renderBookingHub();
    // Over-recorded is still complete — an edit DOWN must not nag.
    b.adults = 1; renderBookingHub();
    const over = read();
    // A count of ZERO is "we don't know", not "none": the column predates the
    // tracking, so an old row must not turn red.
    b.regCount = 0; b.adults = 4; renderBookingHub();
    const legacy = read();
    b.regSubmitted = keep.s; b.regCount = keep.c; b.adults = keep.a; renderBookingHub();
    return { waiting, submitted, short, shortNext, over, legacy, okC, badC, warnC: probe('--warn') };
  });
  ok(/Not yet submitted/.test(regDots.waiting.text) && regDots.waiting.dot === regDots.badC,
    'register waiting → red dot beside "Not yet submitted"');
  ok(/Submitted · 2 guests recorded/.test(regDots.submitted.text) && regDots.submitted.dot === regDots.okC,
    'register filled in → green dot beside the count');
  ok(/2 of 4 guests recorded/.test(regDots.short.text) && regDots.short.dot === regDots.warnC,
    `a register short of the party says so, in amber (${regDots.short.text})`);
  ok(!/Submitted ·/.test(regDots.short.text), '…and never reads as a completed record');
  ok(/Only 2 of 4 guests are on the register/.test(regDots.shortNext),
    `…and it becomes the booking's next action (${regDots.shortNext.slice(0, 70)})`);
  ok(/Submitted · 2 guests recorded/.test(regDots.over.text) && regDots.over.dot === regDots.okC,
    'a party edited DOWN is over-recorded, not incomplete');
  ok(regDots.legacy.dot === regDots.okC,
    'a legacy row with no count is unknown, not incomplete — old bookings stay green');
  // The money ask lives in the Payments block's own header — ONE statement of
  // the balance — and the standalone banner is gone while it does.
  const merged = await page.evaluate(() => ({
    inPay: !!document.querySelector('.bhub-headpay .bhub-payask.bhub-next'),
    banners: document.querySelectorAll('.bhub-next').length,
  }));
  ok(merged.inPay && merged.banners === 1, `a money ask renders once, as the Payments header (${merged.banners})`);
  // NO GAP OFFER ON A BOOKING'S PAGE. This fixture is built for it — b5 follows
  // two nights after b1's checkout, which is exactly the hole the chip used to
  // price — so the absence is proved against the case that would have shown it,
  // not against an empty calendar where nothing would render anyway.
  const gapGone = await page.evaluate(() => ({
    chip: document.querySelectorAll('.bhub-gap').length,
    words: /free night|offer at|Gap offer live/.test(document.getElementById('booking-hub-content').textContent),
  }));
  ok(gapGone.chip === 0 && !gapGone.words,
    `no gap offer on the booking page (${gapGone.chip} chips, words ${gapGone.words})`);
  // The sticky bar: hidden on desktop (everything is on screen), under the
  // thumb on a phone, naming the SAME next action as the header.
  ok(await page.evaluate(() => getComputedStyle(document.querySelector('.bhub-sticky')).display === 'none'),
    'the sticky bar stays out of the way at desktop width');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  const sticky = await page.evaluate(() => {
    const el = document.querySelector('.bhub-sticky');
    return { shown: el && getComputedStyle(el).display !== 'none', text: el ? el.textContent : '' };
  });
  ok(sticky.shown && /by card|card link|Record a payment/.test(sticky.text), `on a phone it carries the next action (${sticky.text.trim().slice(0, 50)})`);
  // …and while it does, the next-action card DROPS its own button (the A2c
  // one-tap-offered-once rule applied to the card/sticky pair): the card keeps
  // its cap + sentence, the sticky is the control. Booking hub only — the
  // enquiry hub's Approve has no sticky to hand over to.
  const cardBtn = await page.evaluate(() => {
    const btn = document.querySelector('#booking-hub-content .bhub-next .bhub-next-btn');
    return { exists: !!btn, hidden: !btn || getComputedStyle(btn).display === 'none' };
  });
  ok(cardBtn.exists && cardBtn.hidden, 'the card\'s own button yields to the sticky at phone width');
  // MONEY LEADS AND NEVER CLIPS: the label used to be verb-first with the
  // figure trailing, and "Request the balance by card — £930.37" measured
  // 104px wider than the button at 390px — the AMOUNT ran under the call
  // icon. The figure is a no-shrink leading span; only the verb may
  // ellipsise; nothing overflows the button's own box.
  const stickyFit = await page.evaluate(() => {
    const btn = document.querySelector('.bhub-sticky-btn');
    const fig = document.querySelector('.bhub-sticky-fig');
    if (!btn || !fig) return null;
    const rb = btn.getBoundingClientRect(), rf = fig.getBoundingClientRect();
    return {
      figInside: rf.right <= rb.right + 1 && rf.left >= rb.left - 1,
      figWhole: fig.scrollWidth <= fig.clientWidth + 1,
      noOverflow: btn.scrollWidth <= btn.clientWidth + 2,
      fig: fig.textContent,
    };
  });
  ok(!!stickyFit && stickyFit.figInside && stickyFit.figWhole && stickyFit.noOverflow,
    `the money figure leads and nothing overflows the sticky button (${stickyFit && stickyFit.fig})`);
  // …AND THE FIT SURVIVES A HOSTILE VERB. The short label fits on its own, so
  // the check above would pass with the ellipsis machinery deleted — inject a
  // 60-char verb (the §14 long-chip discipline: without one the check is
  // vacuous) and the figure must STILL be whole inside a non-overflowing
  // button; only the verb gives way. renderBookingHub restores the real label.
  const stickyHostile = await page.evaluate(() => {
    const btn = document.querySelector('.bhub-sticky-btn');
    const fig = document.querySelector('.bhub-sticky-fig');
    const verb = document.querySelector('.bhub-sticky-verb');
    if (!btn || !fig || !verb) return null;
    verb.textContent = 'Request the balance by card with a deliberately hostile label';
    const rb = btn.getBoundingClientRect(), rf = fig.getBoundingClientRect();
    const out = {
      figWhole: fig.scrollWidth <= fig.clientWidth + 1,
      figInside: rf.right <= rb.right + 1 && rf.left >= rb.left - 1,
      noOverflow: btn.scrollWidth <= btn.clientWidth + 2,
    };
    renderBookingHub();
    return out;
  });
  ok(!!stickyHostile && stickyHostile.figWhole && stickyHostile.figInside && stickyHostile.noOverflow,
    'a hostile-length verb ellipsises — the figure never gives an inch');
  await page.waitForTimeout(250);
  // EMAIL STAYS IN THE SITE. The sticky ✉️ and the Guest card's address were
  // mailto: links — out to the phone's mail app, past the draft reply, the
  // preview and the send log. Both open the site's composer now, and NO
  // guest-facing mailto may return to this page (tel: stays — the phone IS
  // the call client).
  ok(await page.evaluate(() => !document.querySelector('#booking-hub-content a[href^="mailto:"]')),
    'no mailto anywhere on the hub — email goes through the site\'s composer');
  await page.click('.bhub-sticky button[data-act="openBookingEmail"]');
  await page.waitForTimeout(400);
  ok(await page.evaluate(() => document.getElementById('enq-email-modal').classList.contains('open')),
    'the sticky ✉️ opens the composer in place');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  // THE PLAN'S STATE NEVER TANGLES WITH ITS SENTENCE: baseline-aligned columns
  // interleaved when the what-half wrapped (hostile-length names + a custom
  // plan) — on a phone the state stacks under the sentence, so their boxes
  // must not intersect. The plan lives inside the money fold now, so the fold
  // is OPENED first — hidden boxes are all zero-size and the check would pass
  // over an interleaved panel without ever seeing it.
  await page.evaluate(() => { const m = document.getElementById('bhub-money-more'); if (m) m.hidden = false; });
  const planTangle = await page.evaluate(() => {
    return [...document.querySelectorAll('.bhub-plan-row')].map((row) => {
      const w = row.querySelector('.bhub-plan-what'), s = row.querySelector('.bhub-plan-state');
      if (!w || !s) return true;
      const rw = w.getBoundingClientRect(), rs = s.getBoundingClientRect();
      const ox = Math.min(rw.right, rs.right) - Math.max(rw.left, rs.left);
      const oy = Math.min(rw.bottom, rs.bottom) - Math.max(rw.top, rs.top);
      return !(ox > 2 && oy > 2);
    }).every(Boolean);
  });
  ok(planTangle, 'the plan rows keep sentence and state apart at phone width (no interleave)');
  // ACTION ROWS, NOT FLOATING TEXT (owner's dark-mode report: the quiet links
  // were "not visible as buttons, not symmetrical"). The iOS action-list
  // anatomy, pinned: every action spans its group (all labels on one rail —
  // symmetry is full width, not luck), sits at the 44px floor, and carries
  // the accent-text ink — colour is the "this is tappable" signal.
  // The action rows live inside the disclosure folds now — open every fold
  // first, or the geometry below measures 0×0 boxes and proves nothing.
  await page.evaluate(() => {
    document.querySelectorAll('.bhub-fold[hidden]').forEach((f) => { f.hidden = false; });
    const m = document.getElementById('bhub-money-more');
    if (m) m.hidden = false;
  });
  const rowsOk = await page.evaluate(() => {
    // Resolve the token IN THE ROWS' OWN CONTEXT — the theme class on body
    // retunes --accent-text, so reading :root's value compares dark ink
    // against a light-mode button and fails a correct page.
    const probe = document.createElement('span');
    probe.style.color = 'var(--accent-text)';
    document.body.appendChild(probe);
    const want = getComputedStyle(probe).color; probe.remove();
    const groups = [...document.querySelectorAll('.bhub-act-links')];
    const all = groups.flatMap((g) => {
      const gw = g.getBoundingClientRect().width;
      return [...g.querySelectorAll('.bhub-actlink')].map((r) => {
        const b = r.getBoundingClientRect();
        return { full: Math.abs(b.width - gw) < 3, tall: b.height >= 43, ink: getComputedStyle(r).color === want };
      });
    });
    // The plan panel's Edit control wears the same anatomy — it was the one
    // muted linklike left beside the accent rows (owner: "needs to be more
    // visible").
    const planEdit = document.querySelector('.bhub-plan .bhub-actlink[data-act="editPaymentPlan"]');
    const pe = planEdit ? { tall: planEdit.getBoundingClientRect().height >= 43, ink: getComputedStyle(planEdit).color === want } : null;
    return { n: all.length, ok: all.length > 0 && all.every((x) => x.full && x.tall && x.ink), planEdit: !!pe && pe.tall && pe.ink };
  });
  ok(rowsOk.ok, `every secondary action is a full-width 44px accent-ink row (${rowsOk.n} rows across the hub's groups)`);
  ok(rowsOk.planEdit, 'Edit payment plan wears the same row anatomy — no muted stragglers in the panel');
  await page.evaluate(() => { const m = document.getElementById('bhub-money-more'); if (m) m.hidden = true; });
  await page.setViewportSize({ width: 1000, height: 900 });
  await page.waitForTimeout(300);
  // Share stay details: for the cleaner's chat — and deliberately NO money.
  await page.evaluate(() => { window.__shared = null; navigator.clipboard.writeText = (t) => { window.__shared = t; return Promise.resolve(); }; });
  await page.click('.bhub-menu-btn');
  await page.waitForTimeout(200);
  await page.click('[data-act="shareStayDetails"]');
  await page.waitForTimeout(400);
  const shared = await page.evaluate(() => window.__shared || '');
  ok(/Arrives:/.test(shared) && /Leaves:/.test(shared) && /Walk-in Guest/.test(shared), `the share text carries the stay (${shared.split('\n')[0]})`);
  ok(!/£/.test(shared), '…and NO money — it goes into a cleaner\'s chat, not the guest\'s inbox');
  // Draft reply: the enquiry drafter's idea on bookings — filled from THIS
  // booking's own facts, the balance via bookingDue so it can never disagree
  // with the hub above it.
  await page.click('[data-act="openBookingEmail"]');
  await page.waitForTimeout(400);
  // Re-aimed: the draft affordance is the ONE shared ✨ control now
  // (draftComposeReply dispatches to the booking drafter on a booking) — the
  // injected per-booking twin was the same action twice in one screen-height.
  await page.click('[data-act="draftComposeReply"]');
  await page.waitForTimeout(200);
  const draft = await page.evaluate(() => (document.getElementById('enq-email-body') || {}).value || '');
  // £390: section B part-paid this booking £100 against its £440+£50, and the
  // draft reads bookingDue live — which is the point.
  // NB the draft does NOT greet — build_enquiry_reply_email opens every reply
  // with its own "Hello <first>,", so a greeting here made two (the enquiry
  // drafter learned this; its booking sibling had not). Gated as an absence in
  // search-test §26; what this check owns is the FACTS.
  ok(!/^\s*(?:Hello|Hi|Dear)\s+Walk-in/i.test(draft) && /Check-in is from 15:00/.test(draft) && /remaining balance is £390\.00/.test(draft),
    `the draft speaks this booking's facts, ungreeted (${draft.split('\n')[0]} … balance line present)`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);

  // ---------- C3. the per-booking payment plan ----------
  console.log('C3. payment plan panel · edit dialog · reminder');
  // The plan lives inside the money fold now — open it the way the owner does
  // (the disclose row), and the open state survives the section's re-renders
  // (renderBookingHub preserves it), so the geometry checks below see a real
  // panel rather than zero-size hidden boxes.
  await page.evaluate(() => { const m = document.getElementById('bhub-money-more'); if (m && m.hidden) bhubMoneyExpand(); });
  // Still on b1's hub: part-paid £100 against £440, no plan set — the panel
  // states the SITE standard (£110 = 25%) and where each figure comes from.
  const plan0 = await page.evaluate(() => (document.querySelector('.bhub-plan') || {}).textContent || '');
  // £160 = £110 rental deposit + the £50 refundable deposit the FIRST payment
  // carries (pay.php bundles it while hold_status is none/charged) — the line
  // quotes what the card takes, itemised, or it contradicts the "Received so
  // far" header directly above it (reported live as £175 under a £225 header).
  ok(/£160\.00 deposit/.test(plan0) && /site standard \+ £50\.00 refundable deposit/.test(plan0),
    `the deposit line quotes what the card takes, itemised (${plan0.replace(/\s+/g, ' ').trim().slice(0, 80)})`);
  ok(/£330\.00 balance by/.test(plan0), 'and the balance beside its due date — the two lines sum to the header\'s £490');
  ok(/Not asked yet/.test(plan0), 'nothing sent → the state says so, not a blank');
  // BOTH plan species wear a badge (owner's ask): the standard plan says
  // "default" in QUIET ink, so custom stays the one that draws the eye.
  const stdBadge = await page.evaluate(() => {
    const tag = document.querySelector('.bhub-plan-cap .bhub-plan-tag');
    if (!tag) return { up: false };
    const probe = document.createElement('span');
    probe.style.color = 'var(--text-muted)';
    document.body.appendChild(probe);
    const muted = getComputedStyle(probe).color;
    probe.remove();
    return { up: tag.getBoundingClientRect().height > 0, text: tag.textContent.trim(), quiet: getComputedStyle(tag).color === muted };
  });
  ok(stdBadge.up && stdBadge.text === 'default' && stdBadge.quiet, `a standard plan wears the quiet "default" badge (${stdBadge.text})`);
  ok(await page.evaluate(() => !document.querySelector('[data-act="sendPaymentReminder"]')),
    'no reminder button before anything has been asked for (the server would refuse it)');
  // Paid ✓ follows the FOLDED figure via gt (displayGrand): a charged deposit
  // completes the £160 first payment; the same £110 rental with the £50 still
  // uncharged is a first payment that hasn't fully landed.
  const foldStates = await page.evaluate(() => {
    const loc = findBookingLocation('b1');
    const mk2 = (over) => Object.assign({}, findBookingById('b1'), over);
    const render = (b) => {
      const ps = paymentSummary(loc.propKey, b);
      const gt = displayGrand(b.agreedPrice || null, ps, b.holdStatus, b);
      return hubPlanHtml(b, ps, gt, false);
    };
    return {
      charged: render(mk2({ depositPaid: 110, holdStatus: 'charged', holdAmount: 50, payment: 'deposit' })),
      unchargedDep: render(mk2({ depositPaid: 110, holdStatus: 'none', payment: 'deposit' })),
    };
  });
  ok(/>Paid</.test(foldStates.charged), 'rental £110 + charged £50 → the £160 first payment reads Paid');
  ok(!/>Paid</.test(foldStates.unchargedDep), 'the same £110 with the £50 uncharged does NOT — the header above would say £110 too');
  // No ✓ in the plan states (owner's ask) — the green dot already says done.
  ok(!foldStates.charged.includes('✓'), 'the settled state carries no tick — the dot is the mark');
  // The chip-row dot vocabulary reaches the plan states: green = settled,
  // red = still open, words unchanged (colour is never the only signal).
  const planDots = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.bhub-plan .bhub-plan-state')).map((s) => {
      const d = s.querySelector('.bhub-chip-dot');
      return d ? (d.classList.contains('is-ok') ? 'ok' : d.classList.contains('is-bad') ? 'bad' : '?') : 'none';
    }));
  ok(planDots.length === 2 && planDots.every((v) => v === 'bad'), `nothing settled → both plan rows lead with a red dot (${planDots.join(',')})`);
  ok(foldStates.charged.includes('bhub-chip-dot is-ok'), 'a settled first payment leads with a green dot');
  ok(!foldStates.unchargedDep.includes('bhub-chip-dot is-ok'), 'the uncharged one stays red — same judgement as its Paid ✓');
  // The Edit-plan dialog: type 30% + a custom due date, Save → the client posts
  // the PLAN (never an amount to charge) and re-renders from what the server
  // accepted.
  await page.evaluate(() => { window.editPaymentPlan('b1'); });
  await page.waitForTimeout(350);
  // The dialog is TITLED (and the title is its accessible name), the message
  // is one line of context, each field says what BLANK means under itself —
  // the date input's hint is the only way it can (date inputs ignore
  // placeholders; it rendered as an unexplained empty pill) — and the OK
  // button says what it does.
  const dlgShape = await page.evaluate(() => ({
    title: (document.getElementById('glass-dialog-title') || {}).textContent || '',
    titleShown: (document.getElementById('glass-dialog-title') || { style: {} }).style.display !== 'none',
    named: document.getElementById('glass-dialog').getAttribute('aria-labelledby'),
    hints: [...document.querySelectorAll('#glass-dialog-fields .gdf-hint')].map((h) => h.textContent),
    okSays: (document.getElementById('glass-dialog-ok') || {}).textContent,
  }));
  ok(/Payment plan — Walk-in Guest/.test(dlgShape.title) && dlgShape.titleShown && dlgShape.named === 'glass-dialog-title',
    `the dialog is titled, and the title is its accessible name (${dlgShape.title})`);
  ok(dlgShape.hints.length === 3 && /site standard \(25% of the £440\.00 rental \+ the £50\.00 refundable deposit/.test(dlgShape.hints[0]) && /Showing the standard date/.test(dlgShape.hints[1]),
    'each field explains itself — the date hint says the shown date IS the standard');
  // The third field is the optional preset name. Blank by default, because a
  // plan is usually for ONE booking and naming it is the exception.
  ok(/reuse it on other bookings/i.test(dlgShape.hints[2] || ''),
    `…including the optional save-as field (${dlgShape.hints[2]})`);
  ok(dlgShape.okSays === 'Save plan', `the OK button says what it does (${dlgShape.okSays})`);
  // THE DATE FIELD IS NEVER AN EMPTY PILL: it opens showing the date that
  // actually applies (an empty date input renders as an unlabelled blank on
  // iOS) — and saving it UNCHANGED still means standard, so opening + saving
  // can never quietly convert a standard plan into a custom one.
  ok((await page.inputValue('#gdf-due')) !== '', 'the date field opens PREFILLED with the effective date');
  await page.click('#glass-dialog-ok');
  await page.waitForTimeout(350);
  const untouched = posts.filter((p) => p.action === 'set_payment_plan').pop();
  ok(!!untouched && untouched.balance_due_date === '',
    'saving the untouched standard date still posts STANDARD (blank), never a stealth custom plan');
  await page.evaluate(() => { window.editPaymentPlan('b1'); });
  await page.waitForTimeout(350);
  await page.fill('#gdf-dep', '30');
  await page.fill('#gdf-due', d(20));
  await page.click('#glass-dialog-ok');
  await page.waitForTimeout(400);
  // The shared title node must RESET for the next plain dialog — a leaked
  // title is the okLabel-leak bug wearing a new hat.
  // Fire-and-forget: glassAlert RESOLVES only when dismissed, so awaiting its
  // promise inside evaluate deadlocks against the click below (measured: the
  // suite hung right here for 10 minutes).
  await page.evaluate(() => { glassAlert('plain message'); });
  await page.waitForTimeout(250);
  const plainDlg = await page.evaluate(() => ({
    shown: (document.getElementById('glass-dialog-title') || { style: {} }).style.display !== 'none',
    named: document.getElementById('glass-dialog').getAttribute('aria-labelledby'),
    ok: (document.getElementById('glass-dialog-ok') || {}).textContent,
  }));
  ok(!plainDlg.shown && plainDlg.named === 'glass-dialog-msg' && plainDlg.ok === 'OK',
    'a plain dialog after it carries NO leaked title, name or label');
  await page.click('#glass-dialog-ok');
  await page.waitForTimeout(250);
  const planPost = posts.filter((p) => p.action === 'set_payment_plan').pop();
  ok(!!planPost && planPost.deposit_pct === '30' && planPost.deposit_amount === '' && planPost.balance_due_date === d(20),
    `the dialog states the plan, never a figure to charge (${JSON.stringify(planPost && { pct: planPost.deposit_pct, amt: planPost.deposit_amount, due: planPost.balance_due_date })})`);
  const plan1 = await page.evaluate(() => (document.querySelector('.bhub-plan') || {}).textContent || '');
  ok(/£182\.00 deposit/.test(plan1) && /30%/.test(plan1),
    `the panel re-renders the custom deposit (£182 = 30% of £440 + the £50 the card carries) (${plan1.replace(/\s+/g, ' ').trim().slice(0, 60)})`);
  ok(/standard would be/.test(plan1), 'and names the standard date the custom one replaces');

  // ---- C3b. SAVED PLANS. Every custom plan was retyped from scratch. A preset
  // stores the PERCENTAGE and a DAYS-BEFORE-ARRIVAL offset, never the absolute
  // date — the date is a fact about one booking, the interval is the policy.
  const savedName = 'Peak season';
  await page.evaluate(() => document.querySelector('.bhub-plan [data-act="editPaymentPlan"]').click());
  await page.waitForTimeout(300);
  await page.evaluate((nm) => {
    document.querySelector('#glass-dialog-fields [name="dep"], #gdf-dep').value = '40';
    const s = document.querySelector('#glass-dialog-fields [name="save"], #gdf-save');
    if (s) s.value = nm;
  }, savedName);
  await page.click('#glass-dialog-ok');
  await page.waitForTimeout(300);
  const savedList = await page.evaluate(() => (typeof chbPlanPresets === 'function' ? chbPlanPresets() : []));
  ok(savedList.length === 1 && savedList[0].name === savedName && savedList[0].pct === 40,
    `naming a plan keeps it for reuse (${JSON.stringify(savedList)})`);
  // …and the OFFSET is stored, not the date it was derived from.
  ok(typeof savedList[0].days === 'number' && savedList[0].days >= 0,
    `…as an interval before arrival, not a calendar date (${savedList[0] && savedList[0].days} days)`);
  // The entry point only appears once something HAS been saved.
  const useLink = await page.evaluate(() => !!document.querySelector('.bhub-plan [data-act="usePlanPreset"]'));
  ok(useLink, '…and the panel then offers "Use a saved plan"');
  // Applying it goes through the SAME validated endpoint, with the offset turned
  // into THIS booking's own date — a preset is a shortcut to the dialog's
  // inputs, never a second way to write a plan.
  await page.evaluate(() => document.querySelector('.bhub-plan [data-act="usePlanPreset"]').click());
  await page.waitForTimeout(300);
  await page.click('#glass-dialog-ok');
  await page.waitForTimeout(300);
  const usedPost = posts.filter((p) => p.action === 'set_payment_plan').pop();
  ok(!!usedPost && usedPost.deposit_pct === '40',
    `applying a saved plan writes through set_payment_plan (${JSON.stringify(usedPost && { pct: usedPost.deposit_pct, due: usedPost.balance_due_date })})`);
  // The badge says "custom" ONCE — the rows never repeat it (owner's ask:
  // "Remove custom, it already says that above").
  ok((plan1.match(/custom/gi) || []).length === 1, 'the word "custom" appears exactly once — the badge');
  // The panel's FACTS carry sentence weight and a custom plan wears the badge —
  // the owner reported the whole panel as washed-out grey beside the payline.
  const planEmphasis = await page.evaluate(() => {
    const fig = document.querySelector('.bhub-plan .bhub-plan-fig');
    const tag = document.querySelector('.bhub-plan-cap .bhub-plan-tag');
    const probe = document.createElement('span');
    probe.style.color = 'var(--accent-text)';
    document.body.appendChild(probe);
    const accent = getComputedStyle(probe).color;
    probe.remove();
    return {
      figWeight: fig ? parseInt(getComputedStyle(fig).fontWeight, 10) : 0,
      tagUp: !!tag && tag.getBoundingClientRect().height > 0,
      tagText: tag ? tag.textContent.trim() : '',
      tagLoud: !!tag && getComputedStyle(tag).color === accent,
    };
  });
  ok(planEmphasis.figWeight >= 600, `the plan's facts carry sentence weight (${planEmphasis.figWeight})`);
  ok(planEmphasis.tagUp && planEmphasis.tagText === 'custom' && planEmphasis.tagLoud,
    'a custom plan announces itself with the accent badge, not two muted words');
  // The reminder: appears only once something has been asked, sends through
  // request_payment with the reminder flag, and the panel records it at once.
  await page.evaluate((ts) => { const b = findBookingById('b1'); b.balanceRequestedAt = ts; renderBookingHub(); }, d(-1) + ' 09:00:00');
  await page.waitForTimeout(250);
  ok(await page.evaluate(() => !!document.querySelector('[data-act="sendPaymentReminder"]')),
    'the reminder button appears once the balance has been asked');
  await page.click('[data-act="sendPaymentReminder"]');
  await page.waitForTimeout(300);
  await page.click('#glass-dialog-ok'); // the confirm names the guest + figure
  await page.waitForTimeout(400);
  const remPost = posts.filter((p) => p.action === 'request_payment' && p.reminder).pop();
  ok(!!remPost, 'the reminder rides request_payment with the reminder flag — one send path, two wordings');
  ok(/reminded/.test(await page.evaluate(() => (document.querySelector('.bhub-plan') || {}).textContent || '')),
    'and the panel records the reminder at once');
  // Clear the plan again so later sections see b1 exactly as before.
  await page.evaluate(() => { window.editPaymentPlan('b1'); });
  await page.waitForTimeout(350);
  await page.fill('#gdf-dep', '');
  await page.fill('#gdf-due', '');
  await page.click('#glass-dialog-ok');
  await page.waitForTimeout(300);
  ok(/site standard/.test(await page.evaluate(() => (document.querySelector('.bhub-plan') || {}).textContent || '')),
    'clearing both fields returns the plan to the site standard');

  // ---------- E. other stays ----------
  console.log('E. guest card');
  const stays = await page.evaluate(() => Array.from(document.querySelectorAll('.bhub-stay-row')).map((x) => x.textContent));
  ok(stays.length === 1, `one other stay listed (${stays.length})`);
  await page.click('.bhub-stay-row');
  await page.waitForTimeout(600);
  const swapped = await page.evaluate(() => (document.querySelector('.bhub-name') || {}).textContent);
  ok(swapped === 'Return Visit', `clicking a stay opens ITS hub (${swapped})`);

  // ---------- F. back ----------
  await page.evaluate(() => window.bookingHubBack());
  await page.waitForTimeout(600);
  const backView = await page.evaluate(() => (document.querySelector('.page-view.active') || {}).id);
  ok(backView === 'view-backoffice', `back lands on the dashboard workspace (${backView})`);

  // ---------- G. glass date picker (admin mode) + availability strip ----------
  console.log('G. glass picker + availability strip');
  await page.evaluate(() => window.openAddBooking());
  await page.waitForTimeout(400);
  // The consumer glass calendar opens from the modal's date trigger, in admin
  // mode: taken nights shaded but still pickable.
  await page.click('#modal-date-trigger');
  await page.waitForTimeout(300);
  // b1's stay (d+30) is next month — flip the calendar forward to see it.
  await page.evaluate(() => dpChangeMonth(1));
  await page.waitForTimeout(200);
  const dp1 = await page.evaluate(() => ({
    open: document.getElementById('date-picker').classList.contains('open'),
    admin: document.getElementById('date-picker').classList.contains('dp-admin'),
    shaded: document.querySelectorAll('#dp-grid .dp-day.dp-booked').length,
    shadedClickable: Array.from(document.querySelectorAll('#dp-grid .dp-day.dp-booked')).every((c) => c.getAttribute('onclick') || c.getAttribute('data-act')),
  }));
  ok(dp1.open && dp1.admin, 'glass calendar opens from the modal in admin mode');
  ok(dp1.shaded >= 1 && dp1.shadedClickable, `taken nights shaded yet pickable (${dp1.shaded})`);
  await page.evaluate(([a, b]) => { dpPick(a); dpPick(b); dpDone(); }, [d(60), d(63)]);
  await page.waitForTimeout(300);
  const dp2 = await page.evaluate(() => ({
    ci: document.getElementById('modal-checkin').value,
    co: document.getElementById('modal-checkout').value,
    label: (document.getElementById('modal-date-display') || {}).textContent || '',
    closed: !document.getElementById('date-picker').classList.contains('open'),
  }));
  ok(dp2.ci === d(60) && dp2.co === d(63) && dp2.closed, `picked range lands in the booking fields (${dp2.ci} → ${dp2.co})`);
  ok(/→/.test(dp2.label), `trigger shows the chosen range (${dp2.label.trim()})`);
  await page.evaluate((v) => { document.getElementById('modal-checkin').value = v; updateModalPrice(); }, d(31)); // overlaps booking 1 (d30→d33)
  await page.evaluate((v) => { document.getElementById('modal-checkout').value = v; updateModalPrice(); }, d(34));
  await page.waitForTimeout(300);
  const g1 = await page.evaluate(() => ({
    shown: (document.getElementById('modal-availability') || {}).style.display !== 'none',
    strip: (document.querySelector('#modal-availability .mav-strip-txt') || {}).textContent || '',
    clashDot: !!document.querySelector('#modal-availability .mav-strip-dot.is-clash'),
    clash: (document.querySelector('#modal-availability .mav-clash') || {}).textContent || '',
  }));
  // The everyday face is the SUMMARY STRIP now — the grid folds behind its
  // Calendar toggle (ui-test-addbooking owns the strip's own contract).
  ok(g1.shown && /^Overlaps/.test(g1.strip) && g1.clashDot, `strip leads with the overlap (${g1.strip.slice(0, 40)})`);
  ok(/overlap/.test(g1.clash) && /Walk-in Guest/.test(g1.clash), `clash note names the conflict (${g1.clash.trim().slice(0, 60)})`);
  await page.evaluate(() => mavToggle());
  await page.waitForTimeout(200);
  // ≥2 not ≥3: the grid starts on the MONDAY of check-in week (by design), so
  // when d(31) falls on a Monday the booking's first night d(30) sits outside
  // the window — only the two overlapped nights are guaranteed visible.
  const g1b = await page.evaluate(() => document.querySelectorAll('#modal-availability .mav-day.is-booked').length);
  ok(g1b >= 2, `the Calendar toggle opens the grid with booked days shaded (${g1b})`);
  await page.evaluate(() => mavToggle());
  await page.evaluate((v) => { document.getElementById('modal-checkin').value = v; updateModalPrice(); }, d(60)); // free dates
  await page.evaluate((v) => { document.getElementById('modal-checkout').value = v; updateModalPrice(); }, d(63));
  await page.waitForTimeout(300);
  const g2 = await page.evaluate(() => !document.querySelector('#modal-availability .mav-clash'));
  ok(g2, 'no clash note on free dates');
  // Airbnb import visible when the window covers it.
  await page.evaluate((v) => { document.getElementById('modal-checkin').value = v; updateModalPrice(); }, d(49));
  await page.evaluate((v) => { document.getElementById('modal-checkout').value = v; updateModalPrice(); }, d(51));
  await page.waitForTimeout(300);
  await page.evaluate(() => mavToggle()); // the grid folds by default now
  await page.waitForTimeout(200);
  const g3 = await page.evaluate(() => ({
    external: document.querySelectorAll('#modal-availability .mav-day.is-external').length,
    clash: (document.querySelector('#modal-availability .mav-clash') || {}).textContent || '',
  }));
  ok(g3.external >= 3 && /airbnb import/.test(g3.clash), `imported block shaded + named (${g3.external} days)`);
  await page.evaluate(() => mavToggle());
  await page.evaluate(() => closeModal());
  // Editing booking 1: its own dates must NOT self-clash.
  await page.evaluate(() => window.openEditBooking('b1'));
  await page.waitForTimeout(400);
  const g4 = await page.evaluate(() => !document.querySelector('#modal-availability .mav-clash'));
  ok(g4, 'editing a booking does not flag itself as a clash');
  await page.evaluate(() => closeModal());

  // ---------- H. delete rules: money in → no delete; money-free → deletes ----------
  console.log('H. delete rules');
  // b1 now has £100 recorded — Delete must be hidden on its hub…
  await page.evaluate(() => window.openBookingHub('b1'));
  await page.waitForTimeout(500);
  const delBtnPaid = await page.evaluate(() => !!document.querySelector('.bhub-actions [data-act="bhubDelete"]'));
  ok(!delBtnPaid, 'Delete button hidden on a booking that has taken money');
  // A REMOVED ACTION SAYS WHY. Both withdrawals — Delete once money is on the booking,
  // Cancel once the guest has arrived — used to simply VANISH, so an owner looking for
  // how to cancel found no Cancel and no reason: the rule was written for whoever read
  // the source. The note must NOT be a menuitem (role="none"), or arrow keys land on
  // a line that does nothing.
  const delWhy = await page.evaluate(() => {
    const notes = [...document.querySelectorAll('.bhub-menu .bhub-menu-note')];
    return {
      says: notes.map((n) => n.textContent.trim()).join(' | '),
      roles: notes.map((n) => n.getAttribute('role')).join(','),
      menuitems: document.querySelectorAll('.bhub-menu [role="menuitem"]').length,
    };
  });
  ok(/Deleting isn’t possible/.test(delWhy.says) && /Cancel & refund/.test(delWhy.says),
    `WHY: the withdrawn Delete explains itself and names what to use (${delWhy.says.slice(0, 70)})`);
  ok(delWhy.roles === 'none', `WHY: …as a note, not a menuitem (role=${delWhy.roles})`);
  ok(delWhy.menuitems >= 3, `WHY: …and the real menu items are still there (${delWhy.menuitems})`);
  // Header declutter: secondary + destructive actions live in ONE ⋯ menu — in
  // the header's TOP-RIGHT corner (the iOS restyle returned it from the page
  // foot: the demo the owner approved carries the ellipsis in the nav-bar
  // spot). The control is chrome, so its words ride aria-label/title; the
  // dropdown opens DOWNWARD from up there and must stay on screen.
  const menu1 = await page.evaluate(() => {
    const menu = document.querySelector('.bhub-menu');
    const btnEl = document.querySelector('.bhub-menu-btn');
    return {
      hidden: menu && menu.style.display === 'none',
      items: menu ? menu.innerHTML : '',
      headerBtns: document.querySelectorAll('.bhub-actions > .btn-sm').length,
      inHead: !!document.querySelector('.bhub-head .bhub-head-top .bhub-actions .bhub-menu-btn'),
      footGone: !document.querySelector('.bhub-foot'),
      named: btnEl ? (btnEl.getAttribute('aria-label') || '') : '',
      opensDown: menu ? getComputedStyle(menu).top !== 'auto' : false,
    };
  });
  ok(menu1.hidden, 'overflow menu starts closed');
  ok(menu1.headerBtns === 1, `ONE ⋯ menu button on the page (${menu1.headerBtns})`);
  ok(menu1.inHead && menu1.footGone, 'the ⋯ lives in the header top-right; the page foot is gone');
  ok(/edit/i.test(menu1.named), `the ⋯ carries its words as an accessible name (${menu1.named})`);
  ok(menu1.opensDown, 'its dropdown opens downward from the header');
  ok(/openEditBooking|bhubEdit/.test(menu1.items) && /cancelBooking|bhubCancel/.test(menu1.items) && !/addBookingToCalendar/.test(menu1.items), 'Edit/Move + Cancel & refund live in the menu; no Add to calendar');
  await page.evaluate(() => document.querySelector('.bhub-menu-btn').click());
  await page.waitForTimeout(200);
  const menuOpen = await page.evaluate(() => {
    const m = document.querySelector('.bhub-menu');
    const r = m.getBoundingClientRect();
    return { shown: m.style.display !== 'none', fits: r.top >= 0 && r.left >= -1 && r.right <= innerWidth + 1 };
  });
  ok(menuOpen.shown && menuOpen.fits, 'tapping ⋯ opens the menu, fully on screen');
  // …AND EVERY ITEM TAKES ITS OWN TAP. On a SHORT screen the menu runs down into
  // the phone sticky bar, which is opaque and was the higher layer: measured at
  // 844x390, elementFromPoint on "Share stay details" returned .bhub-sticky — an
  // item you can read and cannot tap, with two more not visible at all. Paint
  // order and hit order are one question, so one z-index answers both. Hit-tested
  // rather than asserted on the z-index, which is the outcome and not the value.
  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForTimeout(300);
  const swallowed = await page.evaluate(async () => {
    window.scrollTo(0, 0);
    const m = document.querySelector('.bhub-menu');
    // Open it AT THIS SIZE — reusing the copy left open by the check above would
    // measure a placement made for the taller window (caught: maxHeight 686px in a
    // 390px viewport), which tests nothing about a short screen.
    // Open it AT THIS SIZE. The copy left open above was placed for the taller
    // window (caught: maxHeight 686px in a 390px viewport). Close, let the
    // document-level once-listener retire, then re-open.
    bhubMenuClose();
    await new Promise((r) => setTimeout(r, 60));
    document.querySelector('.bhub-menu-btn').click();
    await new Promise((r) => setTimeout(r, 60));
    const items = [...m.querySelectorAll('[role="menuitem"]')];
    const bad = [];
    for (const it of items) {
      // REACHABLE then TAPPABLE: the menu is capped and scrolls on a short screen,
      // so bring each item into view first — the defect was never "you must scroll",
      // it was an item painted UNDER an opaque bar (and one outside the window with
      // nothing to scroll at all).
      it.scrollIntoView({ block: 'nearest' });
      const r = it.getBoundingClientRect();
      if (!r.width || r.top < -0.5 || r.bottom > innerHeight + 0.5) { bad.push((it.textContent || '').trim().slice(0, 22) + ' (off screen)'); continue; }
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      if (!hit || (!it.contains(hit) && hit !== it)) bad.push((it.textContent || '').trim().slice(0, 22) + ' → ' + (hit ? (hit.className || hit.tagName) : 'null'));
    }
    const mr = m.getBoundingClientRect();
    return { n: items.length, bad, sticky: !!document.querySelector('.bhub-sticky'),
      dbg: `menu[${Math.round(mr.top)},${Math.round(mr.bottom)}] vh=${innerHeight} maxH=${m.style.maxHeight} sh=${m.scrollHeight}` };
  });
  ok(swallowed.n >= 3 && swallowed.sticky, `(fixture) a short screen shows the sticky bar under an open ⋯ menu (${swallowed.n} items)`);
  ok(swallowed.bad.length === 0, `every ⋯ item takes its own tap on a short screen (${swallowed.bad.join(' | ') || 'all clear'}) ${swallowed.dbg}`);
  await page.evaluate(() => { const m = document.querySelector('.bhub-menu'); if (m) m.style.display = 'none'; });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(250);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  ok(await page.evaluate(() => document.querySelector('.bhub-menu').style.display === 'none'), 'Escape closes the menu');
  // …AND THE NEXT TAP STILL OPENS IT. The outside-click listener is {once:true} and
  // was the only one bhubMenuClose did not remove, so closing by any other route
  // left it armed on `document` — where the data-act dispatcher also lives — and the
  // next tap ran the dispatcher (open) then the stale listener (close) in one event.
  // A dead second tap on the hub's only menu.
  await page.evaluate(() => document.querySelector('.bhub-menu-btn').click());
  await page.waitForTimeout(200);
  ok(await page.evaluate(() => document.querySelector('.bhub-menu').style.display !== 'none'),
    'and the NEXT tap opens it again — no stale outside-click listener swallowing it');
  // …and blocked in code even if something calls it directly.
  const guard = page.evaluate(() => deleteBooking('b1'));
  await page.waitForTimeout(500);
  const guardMsg = await page.evaluate(() => (document.getElementById('glass-dialog-msg') || {}).innerText || '');
  ok(/taken money/.test(guardMsg) && /Cancel & refund/.test(guardMsg), 'direct delete call blocked with the cancel guidance');
  await page.evaluate(() => glassDialogResolve(true));
  await guard;
  ok(!posts.some((p) => p.action === 'delete' && p.id === 1), 'no delete POST reached the server for the paid booking');
  // b2 is money-free — Delete shows, works, and the hub exits to Bookings.
  await page.evaluate(() => window.openBookingHub('b2'));
  await page.waitForTimeout(500);
  const delBtnFree = await page.evaluate(() => !!document.querySelector('.bhub-actions [data-act="bhubDelete"]'));
  ok(delBtnFree, 'Delete present in the menu on a money-free booking');
  const del = page.evaluate(() => deleteBooking('b2'));
  await page.waitForTimeout(500);
  await page.evaluate(() => glassDialogResolve(true));
  await del;
  await page.waitForTimeout(700);
  const h = await page.evaluate(() => (document.querySelector('.page-view.active') || {}).id);
  ok(h === 'view-backoffice' && posts.some((p) => p.action === 'delete' && p.id === 2), `money-free delete works and exits to the dashboard (${h})`);

  // ---------- H2. read-only calendar + relocated features ----------
  console.log('H2. read-only calendar + external blocks + derived changeover');
  // A back-to-back booking in the same cottage: b5 arrives the day b1 leaves.
  rows.push(mk(5, { name: 'Next Guest', email: 'next@gmail.com', check_in: d(33), check_out: d(36) }));
  // And a stay spanning TODAY so the current month's calendar has pills to test.
  rows.push(mk(6, { name: 'Cal Guest', email: 'cal@gmail.com', check_in: d(-1), check_out: d(2) }));
  await page.evaluate(() => loadData());
  await page.waitForTimeout(500);
  await page.evaluate(() => { nav('view-backoffice'); renderCalendar(); });
  await page.waitForTimeout(400);
  const cal = await page.evaluate(() => ({
    bars: document.querySelectorAll('#cal-body .tl-bar:not(.tl-ext)').length,
    barClick: !!document.querySelector('#cal-body .tl-bar:not(.tl-ext)[data-act="openBookingHub"]'),
    extBars: document.querySelectorAll('#cal-body .tl-ext').length,
    extClickable: Array.from(document.querySelectorAll('#cal-body .tl-ext')).some((x) => x.getAttribute('onclick') || x.getAttribute('data-act')),
    days: document.querySelectorAll('#cal-body .tl-day').length,
  }));
  ok(cal.days > 100 && cal.bars > 0 && cal.barClick, `timeline rendered — booking bars open the hub (${cal.bars} bars)`);
  ok(cal.extBars > 0 && !cal.extClickable, `external bars greyed + display-only (${cal.extBars})`);
  // A free day cell starts the TWO-TAP range (the approved Today demo): the
  // same night twice books one night, and choosing "Add a booking" in the
  // chooser prefills the form with BOTH dates.
  await page.evaluate(async () => {
    const cell = Array.from(document.querySelectorAll('#cal-body .tl-cell[data-act="tlCellTap"]')).pop();
    cell.click();
    await new Promise((r) => setTimeout(r, 150));
    cell.click();
  });
  await page.waitForTimeout(400);
  await page.evaluate(() => { const s = document.getElementById('gdf-what'); if (s) s.value = 'book'; glassDialogResolve(true); });
  await page.waitForTimeout(400);
  const gap = await page.evaluate(() => ({
    open: document.getElementById('edit-modal').classList.contains('open'),
    ci: document.getElementById('modal-checkin').value,
    co: document.getElementById('modal-checkout').value,
    prop: document.getElementById('modal-property').value,
  }));
  ok(gap.open && /^\d{4}-\d{2}-\d{2}$/.test(gap.ci) && /^\d{4}-\d{2}-\d{2}$/.test(gap.co) && gap.prop !== '',
    `two-tap range prefills Add Booking with both dates (${gap.prop} · ${gap.ci} → ${gap.co})`);
  await page.evaluate(() => closeModal());
  // Bar tap → the booking's hub (narrow → standalone screen).
  await page.evaluate(() => { nav('view-backoffice'); });
  await page.click('#cal-body .tl-bar:not(.tl-ext)');
  await page.waitForTimeout(600);
  const barNav = await page.evaluate(() => ({
    active: (document.querySelector('.page-view.active') || {}).id,
    name: (document.querySelector('#view-enquiry-hub .bhub-name, #view-booking-hub .bhub-name') || {}).textContent || '',
  }));
  ok(barNav.active === 'view-booking-hub' && barNav.name !== '', `bar tap opens the booking hub (${barNav.name})`);
  // External blocks are calendar-only: NOT listed on the Bookings page, and
  // their calendar pills carry no handlers (checked above with all pills).
  await page.evaluate(() => window.openBookings());
  await page.waitForTimeout(700);
  const extBits = await page.evaluate(() => ({
    rows: document.querySelectorAll('#bookings-list .bk-row-ext').length,
    modal: !!document.getElementById('details-modal'),
  }));
  ok(extBits.rows === 0, 'external blocks NOT listed on the Bookings page');
  ok(!extBits.modal, 'old details modal removed from the page');
  // The hub derives the same-day changeover on its own.
  await page.evaluate(() => window.openBookingHub('b1'));
  await page.waitForTimeout(500);
  const chTxt = await page.evaluate(() => (document.querySelector('.bhub-changeover') || {}).textContent || '');
  ok(/Same-day changeover — Next Guest arrives/.test(chTxt), `hub derives the changeover companion (${chTxt.trim().slice(0, 50)}…)`);
  await page.evaluate(() => { const c = document.querySelector('.bhub-changeover'); c.click(); });
  await page.waitForTimeout(500);
  const chName = await page.evaluate(() => (document.querySelector('.bhub-name') || {}).textContent);
  ok(chName === 'Next Guest', `changeover chip opens the other side (${chName})`);
  const chBack = await page.evaluate(() => (document.querySelector('.bhub-changeover') || {}).textContent || '');
  ok(/Walk-in Guest leaves as this guest arrives/.test(chBack), 'reverse chip on the arriving guest\'s hub');

  // ---------- I. wide master–detail split (≥1200px) ----------
  console.log('I. wide split dashboard');
  rows.push(mk(3, { name: 'Second Guest', email: 'other@gmail.com', check_in: d(70), check_out: d(72) }));
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate(() => loadData());
  await page.waitForTimeout(500);
  await page.evaluate(() => { window.__hubReset = true; });
  await page.evaluate(() => window.openBookings());
  await page.waitForTimeout(800);
  const i1 = await page.evaluate(() => ({
    active: (document.querySelector('.page-view.active') || {}).id,
    paneShown: getComputedStyle(document.getElementById('bookings-detail-pane')).display !== 'none',
    hubInPane: !!document.querySelector('#bookings-detail-pane #booking-hub-content'),
    name: (document.querySelector('.bhub-name') || {}).textContent || '',
    rows: document.querySelectorAll('#bookings-list .bk-row[data-bkid]').length,
    openRows: document.querySelectorAll('#bookings-list .bk-row.is-open').length,
    oldControls: document.querySelectorAll('#bookings-list .money-actions, #bookings-list .bk-email-log').length,
  }));
  ok(i1.active === 'view-backoffice', `stays on the merged dashboard (${i1.active})`);
  ok(i1.paneShown && i1.hubInPane, 'hub docked in the right-hand pane');
  ok(i1.name !== '', `a booking auto-selected (${i1.name})`);
  // 5 upcoming rows since the Gap Follower fixture joined (it exists so the
  // hub's gap chip has a real 2-night hole to price).
  ok(i1.rows === 5 && i1.openRows === 1, `compact rows with one selected (${i1.rows} rows)`);
  ok(i1.oldControls === 0, 'per-row buttons + email logs gone from the index');
  // Traffic-light edge: every row carries exactly one payment-state class.
  const lights = await page.evaluate(() => Array.from(document.querySelectorAll('#bookings-list .bk-row[data-bkid]')).map((r) => ['pay-ok', 'pay-warn', 'pay-danger'].filter((c) => r.classList.contains(c)).length));
  ok(lights.length > 0 && lights.every((n) => n === 1), 'every row has ONE traffic-light payment edge');
  // Click ANOTHER booking row → pane swaps, highlight moves, no page change.
  await page.evaluate((sel) => {
    const other = Array.from(document.querySelectorAll('#bookings-list .bk-row[data-bkid]')).find((r) => !r.classList.contains('is-open'));
    other.click();
  });
  await page.waitForTimeout(700);
  const i2 = await page.evaluate(() => ({
    active: (document.querySelector('.page-view.active') || {}).id,
    name: (document.querySelector('.bhub-name') || {}).textContent || '',
    openRow: (document.querySelector('#bookings-list .bk-row.is-open .bk-row-name') || {}).textContent || '',
  }));
  ok(i2.active === 'view-backoffice', 'row click keeps the dashboard (no page swap)');
  ok(i2.name === i2.openRow && i2.name !== i1.name, `pane swapped to the clicked booking (${i2.name})`);

  // ---------- J. inbox master–detail (same playbook) ----------
  console.log('J. inbox workspace');
  await page.evaluate(() => window.openInbox());
  await page.waitForTimeout(800);
  const j1 = await page.evaluate(() => ({
    active: (document.querySelector('.page-view.active') || {}).id,
    rows: document.querySelectorAll('#inbox-list .bk-row[data-enqid]').length,
    oldCards: document.querySelectorAll('#inbox-list .enquiry-card').length,
    paneHub: !!document.querySelector('#inbox-detail-pane #enquiry-hub-content .bhub-head'),
    name: (document.querySelector('#inbox-detail-pane .bhub-name') || {}).textContent || '',
    openRows: document.querySelectorAll('#inbox-list .bk-row.is-open').length,
    // The decision-first anatomy: Approve is the ONE loud control riding the
    // green state card; Edit/Email/DECLINE live behind the ⋯ (decline is
    // reversible via the drawer, so the page leads with the yes — quiet,
    // last, in danger ink); the contact email is a composer button, never a
    // mailto; the MESSAGE never folds.
    approveInNext: !!document.querySelector('#inbox-detail-pane .bhub-next [data-act="approveEnquiry"]'),
    readyCap: ((document.querySelector('#inbox-detail-pane .bhub-next.is-ready .bhub-next-cap') || {}).textContent || '').trim(),
    eyebrow: ((document.querySelector('#inbox-detail-pane .bhub-eyebrow') || {}).textContent || '').trim(),
    msgOpen: (() => {
      const m = document.querySelector('#inbox-detail-pane .bhub-msg-text');
      return !!m && m.getBoundingClientRect().height > 0 && /Dog friendly/.test(m.textContent);
    })(),
    draftRow: !!document.querySelector('#inbox-detail-pane .bhub-msg [data-act="enqReplyDraft"]'),
    menuItems: document.querySelectorAll('#inbox-detail-pane .bhub-menu [role="menuitem"]').length,
    dangerLast: (() => {
      const rows = document.querySelectorAll('#inbox-detail-pane .bhub-menu [role="menuitem"]');
      const last = rows[rows.length - 1];
      return !!last && last.classList.contains('bhub-menu-danger') && /decline/i.test(last.textContent);
    })(),
    // The danger ink must actually PAINT — class-only would pass with the
    // CSS rule deleted. Probe var(--danger-text) in the page's own theme.
    dangerInk: (() => {
      const el = document.querySelector('#inbox-detail-pane .bhub-menu .bhub-menu-danger');
      if (!el) return false;
      const probe = document.createElement('span');
      probe.style.color = 'var(--danger-text)';
      document.body.appendChild(probe);
      const want = getComputedStyle(probe).color;
      probe.remove();
      return getComputedStyle(el).color === want;
    })(),
    mailtos: document.querySelectorAll('#enquiry-hub-content a[href^="mailto:"]').length,
    emailKvBtn: !!document.querySelector('#inbox-detail-pane .bhub-kv-act[data-act="openEnquiryEmail"]'),
    priceBtn: !!document.querySelector('#inbox-detail-pane [data-act="setEnquiryPrice"]'),
    quoteFig: ((document.querySelector('#inbox-detail-pane [data-grp="equote"] .bhub-payline-fig') || {}).textContent || '').trim(),
    // The No-dog row prints the house DD/MM/YYYY form, never the raw SQL stamp.
    noDog: (document.querySelector('#inbox-detail-pane #enquiry-hub-content') || {}).textContent || '',
  }));
  ok(j1.active === 'view-inbox' && j1.rows === 2 && j1.oldCards === 0, `compact enquiry rows (${j1.rows}), old cards gone`);
  ok(j1.paneHub && j1.name !== '' && j1.openRows === 1, `enquiry hub auto-docked (${j1.name})`);
  ok(j1.approveInNext && /Ready to approve · dates free/i.test(j1.readyCap), `Approve rides the green READY state card (${j1.readyCap})`);
  ok(/^Enquiry · asked /.test(j1.eyebrow), `the eyebrow names what this is and how long it has waited (${j1.eyebrow})`);
  ok(j1.msgOpen && j1.draftRow, 'the MESSAGE never folds, with the ✨ draft row beneath it');
  ok(j1.menuItems === 3 && j1.dangerLast && j1.dangerInk, `Edit/Email/Decline live behind the ⋯; Decline last, painted in danger ink (${j1.menuItems})`);
  ok(j1.mailtos === 0 && j1.emailKvBtn && j1.priceBtn, 'contact email routes to the composer (no mailto); agreed-price stays');
  ok(/^£/.test(j1.quoteFig), `the quote is ONE row with the figure on it (${j1.quoteFig})`);
  ok(/Confirmed 01\/07\/2026/.test(j1.noDog) && !j1.noDog.includes('2026-07-01'), 'No-dog row prints the house date form, not the raw stamp');
  // Approve from the hub → lands on the NEW booking's hub.
  const apr = page.evaluate(() => approveEnquiry(document.querySelector('#inbox-list .bk-row[data-enqid]').getAttribute('data-enqid')));
  await page.waitForTimeout(700);
  await page.evaluate(() => { try { glassDialogResolve(true); } catch (e) {} }); // clash/confirm if any
  // Approving now PREVIEWS the confirmation first — hit Send to proceed.
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const ov = document.getElementById('send-confirm-overlay');
    if (ov && ov.classList.contains('open')) document.getElementById('send-confirm-send').click();
  });
  await apr;
  await page.waitForTimeout(900);
  const j2 = await page.evaluate(() => ({
    active: (document.querySelector('.page-view.active') || {}).id,
    name: (document.querySelector('#bookings-detail-pane .bhub-name') || {}).textContent || '',
  }));
  ok(j2.active === 'view-backoffice' && /Enq/.test(j2.name), `approve lands on the new booking's hub (${j2.name})`);
  // Narrow: the enquiry hub is its own screen; declining exits to the Inbox.
  await page.setViewportSize({ width: 1000, height: 900 });
  await page.evaluate(() => window.openEnquiryHub('e7'));
  await page.waitForTimeout(600);
  const j3 = await page.evaluate(() => ({
    active: (document.querySelector('.page-view.active') || {}).id,
    name: (document.querySelector('#view-enquiry-hub .bhub-name') || {}).textContent || '',
  }));
  ok(j3.active === 'view-enquiry-hub' && j3.name === 'Enq Beta', `standalone enquiry hub on narrow (${j3.name})`);

  // THE APPROVAL BANNER NAMES WHAT APPROVAL WILL ACTUALLY ASK FOR. It said
  // "requests the deposit by card" on both sides of the balance window and
  // whether or not Square was configured — but enquiry-actions.php derives the
  // kind from booking_payment_kind, so an enquiry approved INSIDE the window
  // correctly asks for the WHOLE amount. That is the hubAskKind fix, which never
  // came along to the enquiry side. Driven by moving the enquiry's own dates.
  // Driven by the PLAN's own due date, not by moving the stay: shifting checkIn
  // near enough to enter the window also walks it into another fixture booking,
  // and the clash banner (correctly) wins the slot.
  const apprSay = async (due, sqOn) => page.evaluate(async (a) => {
    const e = (enquiries || []).find((x) => String(x.id) === '7' || x.id === 7 || x.id === 'e7');
    if (e) e.balanceDueDate = a.due;
    // eslint-disable-next-line no-global-assign
    squareAdminEnabled = a.sqOn;
    await window.openEnquiryHub('e7');
    await new Promise((r) => setTimeout(r, 350));
    return ((document.querySelector('#view-enquiry-hub .bhub-next') || {}).textContent || '').trim();
  }, { due, sqOn });
  // THE DATES HAVE GONE — the calendar answer is the page's STATE: the card
  // turns red, names WHO took the dates, offers the nearest free windows, and
  // Approve is WITHDRAWN everywhere (card + dock) — the server would re-check
  // under lock anyway, but the page must not leave the owner one distracted
  // tap from that refusal. Driven by walking e7 onto a live booking, restored.
  const clash = await page.evaluate(async (a) => {
    const e = (enquiries || []).find((x) => String(x.id) === '7' || x.id === 7 || x.id === 'e7');
    const keep = { ci: e.checkIn, co: e.checkOut };
    e.checkIn = a.ci; e.checkOut = a.co;
    await window.openEnquiryHub('e7');
    await new Promise((r) => setTimeout(r, 350));
    const out = {
      gone: !!document.querySelector('#view-enquiry-hub .bhub-next.is-gone'),
      text: ((document.querySelector('#view-enquiry-hub .bhub-next') || {}).textContent || '').trim(),
      noApprove: !document.querySelector('#view-enquiry-hub [data-act="approveEnquiry"]'),
      attn: !!document.querySelector('#view-enquiry-hub [data-grp="eclash"]'),
      attnActs: !!document.querySelector('#view-enquiry-hub #bhub-fold-eclash [data-act="openBookingHub"]'),
      sticky: ((document.querySelector('#view-enquiry-hub .bhub-sticky-btn') || {}).textContent || '').trim(),
    };
    e.checkIn = keep.ci; e.checkOut = keep.co;
    await window.openEnquiryHub('e7');
    await new Promise((r) => setTimeout(r, 300));
    return out;
  }, { ci: d(35), co: d(38) });
  ok(clash.gone && /booked/.test(clash.text) && /(Next Guest|Gap Follower)/.test(clash.text),
    `dates gone → the card turns red and names who took them (${clash.text.replace(/\s+/g, ' ').slice(0, 90)})`);
  ok(/ free/.test(clash.text), '…and offers the nearest free windows of the same length');
  ok(clash.noApprove && /Edit the dates/.test(clash.sticky),
    `Approve is withdrawn everywhere; the dock offers Edit the dates instead (${clash.sticky})`);
  ok(clash.attn && clash.attnActs, 'the blocker is a Needs-attention row routing to their booking');

  // …AND A REFUSAL FROM THE SERVER PUTS THE PAGE RIGHT, rather than leaving it
  // asserting the old fact. Approval RE-CHECKS the calendar under book_lock, so the
  // commonest refusal here is the 409 "those dates are no longer available" — raised
  // when the dates went while the enquiry sat in the inbox, or when the owner already
  // approved it from another device. The catch was a bare glassAlert with no reload, so
  // after OK the card still read "READY TO APPROVE · DATES FREE" with the Approve
  // button still there: the owner could tap it again and be refused again. A server
  // VERDICT carries e.status (apiErr); a transport failure does not and must not be
  // treated as one.
  approveWill409 = true;
  await page.evaluate(() => {
    window.__loadDataCalls = 0;
    const real = window.loadData;
    window.loadData = async (...a) => { window.__loadDataCalls++; return real.apply(null, a); };
  });
  const stale = await page.evaluate(async () => {
    await window.openEnquiryHub('e7');
    await new Promise((r) => setTimeout(r, 300));
    const before = !!document.querySelector('#view-enquiry-hub [data-act="approveEnquiry"], #inbox-detail-pane [data-act="approveEnquiry"]');
    const p = window.approveEnquiry('e7');
    await new Promise((r) => setTimeout(r, 500));
    // The clash confirm, if one is offered…
    const dlg = document.getElementById('glass-dialog');
    if (dlg && getComputedStyle(dlg).display !== 'none') { try { glassDialogResolve(true); } catch (e) {} }
    await new Promise((r) => setTimeout(r, 400));
    // …then the email PREVIEW, which is where Send actually fires the request. This is
    // a different overlay from glass-dialog; resolving only the latter left the whole
    // suite hanging on a promise nothing could settle.
    const ov = document.getElementById('send-confirm-overlay');
    if (ov && ov.classList.contains('open')) document.getElementById('send-confirm-send').click();
    await p.catch(() => {});
    await new Promise((r) => setTimeout(r, 900));
    const d2 = document.getElementById('glass-dialog');
    const out = {
      before,
      alert: !!(d2 && getComputedStyle(d2).display !== 'none'),
      approveStill: !!document.querySelector('#view-enquiry-hub [data-act="approveEnquiry"], #inbox-detail-pane [data-act="approveEnquiry"]'),
      card: ((document.querySelector('#view-enquiry-hub .bhub-next, #inbox-detail-pane .bhub-next') || {}).textContent || '').replace(/\s+/g, ' ').trim(),
      reloaded: window.__loadDataCalls || 0,
    };
    if (d2 && getComputedStyle(d2).display !== 'none') { try { glassDialogResolve(true); } catch (e) {} }
    return out;
  });
  approveWill409 = false;
  // Take the blocking booking back OUT — and reload, or the client keeps it and every
  // later check about this enquiry reads the gone-dates card (caught: the next one did).
  rows = rows.filter((r) => r.id !== 77);
  await page.evaluate(async () => { await loadData(); });
  await page.waitForTimeout(300);
  ok(stale.before, '(fixture) the enquiry was approvable before the server refused');
  ok(stale.reloaded > 0, `a server VERDICT refreshes the record before speaking (${stale.reloaded} loads)`);
  ok(!stale.alert, 'and it is a toast, not a modal — the owner has nothing to acknowledge');
  ok(!/READY TO APPROVE/i.test(stale.card),
    `…so the card stops claiming the dates are free (${stale.card.slice(0, 80)})`);

  // …and each ask now NAMES ITS FIGURE (the mockup's rule: approving sends
  // money asks, so the sum is stated before the tap).
  const far = await apprSay(d(60), true);
  ok(/requests the deposit by card — £/.test(far), `before the balance falls due, approval asks for the DEPOSIT by card, figure named (${far.slice(0, 110)})`);
  const near = await apprSay(d(-1), true);
  ok(/requests the full amount by card — £/.test(near) && !/the deposit/.test(near),
    `once it is due it asks for the FULL amount, as the server will (${near.slice(0, 110)})`);
  const noSq = await apprSay(d(60), false);
  ok(/requests the deposit — £/.test(noSq) && !/by card/.test(noSq),
    `with Square off it never promises a card link (${noSq.slice(0, 110)})`);
  await page.evaluate(() => { /* eslint-disable-next-line no-global-assign */ squareAdminEnabled = true; });
  const dec = page.evaluate(() => declineEnquiry('e7'));
  await page.waitForTimeout(500);
  // Declining now ASKS whether to write the guest a reply (they were promised one
  // by the end of the next day and nothing was ever sent). This section is about
  // where the decline LEAVES you, so answer "Not now" — resolving true opens the
  // composer, which then sits over the page and blocks section L's clicks.
  await page.evaluate(() => glassDialogResolve(false));
  await dec;
  await page.waitForTimeout(700);
  const j4 = await page.evaluate(() => (document.querySelector('.page-view.active') || {}).id);
  ok(j4 === 'view-inbox', `decline exits the hub to the Inbox (${j4})`);

  // ---------- K. inbox-zero clears the docked pane (hardening audit C1) ----------
  console.log('K. inbox-zero pane');
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate(() => window.openInbox()); // both enquiries handled in J → inbox zero
  await page.waitForTimeout(800);
  const k = await page.evaluate(() => ({
    emptyShown: getComputedStyle(document.getElementById('inbox-detail-empty')).display !== 'none',
    hubEmpty: !document.querySelector('#enquiry-hub-content .bhub-head'),
    zeroNote: /Inbox zero/.test((document.getElementById('inbox-list') || {}).textContent || ''),
  }));
  ok(k.zeroNote && k.emptyShown && k.hubEmpty, `empty inbox restores the pane placeholder (no stale enquiry hub) ${JSON.stringify(k)}`);

  // ---------- K2. the declined drawer ----------
  // enquiry_decline is a SOFT delete precisely so a mistake can be undone, but
  // the only way back was the Undo on a toast — gone in seconds. Decline the
  // wrong one, look away, and a recoverable row was unreachable.
  console.log('K2. declined enquiries can be found and restored');
  const k2switch = await page.evaluate(() => ({
    hasSwitch: !!document.querySelector('#inbox-list .inbox-sort.seg'),
    labels: [...document.querySelectorAll('#inbox-list .inbox-sort-btn')].map((b) => b.textContent.trim()),
  }));
  ok(k2switch.hasSwitch && /Declined/.test(k2switch.labels.join(' ')),
    `the switch is there even on inbox zero — which is exactly when you go looking (${k2switch.labels.join(' | ')})`);
  await page.evaluate(() => { const b = [...document.querySelectorAll('#inbox-list .inbox-sort-btn')].find((x) => /Declined/.test(x.textContent)); b && b.click(); });
  await page.waitForTimeout(700);
  const k2 = await page.evaluate(() => ({
    txt: ((document.getElementById('inbox-list') || {}).textContent || '').replace(/\s+/g, ' '),
    rows: document.querySelectorAll('#inbox-list .enq-declined-row').length,
    // Count RESTORE, not every button: the row also offers "Email the guest"
    // when there is an address, and a bare button count made "every row offers
    // Restore" fail on a row that offers Restore and one more thing.
    restores: document.querySelectorAll('#inbox-list .enq-declined-restore').length,
  }));
  ok(k2.rows >= 1 && /Declined/.test(k2.txt), `the one declined in J is listed (${k2.rows} row/s)`);
  ok(k2.restores === k2.rows, 'every row offers Restore — the whole point of the drawer');
  // RESTORING puts it back in the inbox and takes it out of the drawer.
  await page.evaluate(() => { const b = document.querySelector('#inbox-list .enq-declined-row button'); b && b.click(); });
  await page.waitForTimeout(1200);
  const k3 = await page.evaluate(() => ({
    backOnWaiting: !!document.querySelector('#inbox-list .bk-row[data-enqid]'),
    stillDeclined: document.querySelectorAll('#inbox-list .enq-declined-row').length,
  }));
  ok(k3.backOnWaiting && k3.stillDeclined === 0,
    `restoring returns it to Waiting and drops it from the drawer (waiting ${k3.backOnWaiting}, drawer ${k3.stillDeclined})`);

  // ---------- L. Money workspace: find-rows → booking hub → back to Money ----------
  console.log('L. money workspace');
  await page.evaluate(() => window.openAccounts());
  await page.waitForTimeout(900);
  await page.evaluate(() => accountsOpen('payments'));
  await page.waitForTimeout(600);
  const l1 = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('#money-panel .bk-row'));
    const r = rows[0];
    return {
      count: rows.length,
      actionCards: document.querySelectorAll('#money-panel .money-row').length,
      edge: r ? Array.from(r.classList).find((c) => c.startsWith('pay-')) : '',
      chip: r ? (r.querySelector('.bk-chip') || {}).textContent : '',
      figures: r ? (r.querySelector('.bk-row-dates') || {}).textContent : '',
      owed: /owed/.test((document.querySelector('#money-panel .money-owed') || {}).textContent || ''),
    };
  });
  ok(l1.count >= 1 && l1.actionCards === 0, `payments section is find-rows, not action cards (${l1.count} rows)`);
  ok(l1.edge === 'pay-danger' && /Unpaid/.test(l1.chip), `unpaid row: red edge + chip with balance (${l1.chip.trim()})`);
  ok(/received/.test(l1.figures), `row shows received-of-total figures (${l1.figures.trim()})`);
  ok(l1.owed, 'owed banner still leads the section');
  await page.click('#money-panel .bk-row');
  await page.waitForTimeout(800);
  const l2 = await page.evaluate(() => ({
    active: (document.querySelector('.page-view.active') || {}).id,
    recordBtn: /Record payment/.test(document.getElementById('view-booking-hub').textContent + document.getElementById('bookings-detail-pane').textContent),
  }));
  ok((l2.active === 'view-booking-hub' || l2.active === 'view-backoffice') && l2.recordBtn, `money row opens the booking hub (${l2.active})`);
  await page.evaluate(() => bookingHubBack());
  await page.waitForTimeout(900);
  const l3 = await page.evaluate(() => (document.querySelector('.page-view.active') || {}).id);
  ok(l3 === 'view-accounts', `hub back returns to Money (${l3})`);

  console.log('HUB TEST PASSED ✅');
  await done();
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
