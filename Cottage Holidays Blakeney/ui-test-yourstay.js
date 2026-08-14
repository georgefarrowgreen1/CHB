// Guest "Your stay" pre-arrival hub, end to end in a real browser:
//  1. a signed-in guest with an upcoming stay gets a countdown hub with the
//     days-to-go badge, planning tiles, and the one thing left to sort
//  2. a balance-due stay shows "balance due" + a Pay balance CTA
//  3. a fully-paid, details-in guest sees "you're all set" and no CTA
//  4. "Tomorrow" wording at +1 day
//  5. only the SOONEST upcoming stay gets the hub (one, not per-booking)
//  6. a past-only guest, and a logged-out visitor, get no hub
//  7. DEPARTURE edge (time-aware): a stay whose checkout time has passed on the
//     checkout day drops to "Past stays" the same day — not at the next midnight;
//     one whose checkout time is still to come stays in-residence
const { d, bootBrowser } = require('./ui-test-lib'); // pins TZ=Europe/London at require time
let fails = 0;
const ok = (b, m) => { console.log(`  ${b ? '✓' : '✗'} ${m}`); if (!b) fails++; };

(async () => {
  const { browser, base, done } = await bootBrowser();
  const d = (n) => { const t = new Date(); const x = new Date(t.getFullYear(), t.getMonth(), t.getDate() + n); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
  // The house DD/MM/YYYY form, for asserting a rendered date without
  // re-implementing fmtDate in the assertion.
  const ukD = (iso) => iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4);
  const mk = (pk, inD, outD, extra) => Object.assign({ prop_key: pk, check_in: inD, check_out: outD, adults: 2, children: 0, id: Math.floor(Math.random() * 1e6) }, extra || {});

  // London wall-clock time TODAY, as a Date — for pinning the page's clock. The
  // checkout-time cases below are about the time of DAY, and asserting those against
  // whatever time CI happens to run at only works for part of the day: `nowMins >=
  // mins`, so a 23:59 checkout HAS passed during the 23:59 minute and "still to
  // come" is false exactly then. Pinning keeps the same calendar day (so the d(n)
  // helper, which runs in node, still agrees) and fixes only the hour.
  const todayAt = (hh, mm, ss) => { const t = new Date(); return new Date(t.getFullYear(), t.getMonth(), t.getDate(), hh, mm, ss || 0); };

  const openPage = async (guest, bookings, opts) => {
    const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
    page.on('pageerror', (e) => { console.log('  PAGEERR:', e.message); fails++; });
    // setFixedTime, not install(): it fixes Date.now()/new Date() and leaves the
    // timers running, so the app's own setTimeouts still fire normally.
    if (opts && opts.at) await page.clock.setFixedTime(opts.at);
    await page.addInitScript(() => { if (navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(() => {}); });
    await page.route(/\.php/, (route) => {
      const url = route.request().url();
      const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
      if (url.includes('auth.php')) {
        let body = {};
        try { body = JSON.parse(route.request().postData() || '{}'); } catch (e) {}
        if (body.action === 'guest_status') return json({ ok: true, guest });
        return json({ ok: true, admin: false, guest: null });
      }
      if (url.includes('my-bookings.php')) return json({ ok: true, bookings, enquiries: [], completed_stays: (opts && opts.completed) || 0 });
      if (url.includes('rates.php')) return json({ properties: [
        { prop_key: 'jollyboat', name: 'Jollyboat', slug: 'jollyboat', couple_rate: 130, booking_fee: 50, max_adults: 2, max_children: 0, max_total: 2, sort_order: 1 },
        { prop_key: '21a', name: '21A Westgate', slug: '21a-westgate', couple_rate: 120, booking_fee: 50, max_adults: 2, max_children: 1, max_total: 3, sort_order: 2 },
      ], seasons: {}, occupancy: {} });
      return json({ ok: true, bookings: [], events: [], results: [], threads: [], enquiries: [], reviews: [], photos: [], props: {}, mine: {}, value: null });
    });
    await page.goto(`${base}/index.html`, { waitUntil: 'networkidle' });
    if (guest) { await page.evaluate(() => openGuestArea()); }
    await page.waitForTimeout(700);
    return page;
  };

  const hub = (page) => page.evaluate(() => {
    const el = document.querySelector('.my-stay-hub-soon');
    if (!el) return null;
    return {
      n: (el.querySelector('.hub-count-n') || {}).textContent || '',
      u: (el.querySelector('.hub-count-u') || {}).textContent || '',
      title: (el.querySelector('.hub-title') || {}).textContent || '',
      sub: (el.querySelector('.hub-sub') || {}).textContent || '',
      tiles: el.querySelectorAll('.hub-tile').length,
      pay: /Pay balance/.test(el.textContent),
      count: document.querySelectorAll('.my-stay-hub-soon').length,
    };
  });

  // A locked agreed price so the balance is deterministic (independent of rate
  // synthesis) — exactly how a confirmed booking carries its price.
  const priced = { agreed_total: 400, agreed_per_night: 133.33, agreed_nights: 3, agreed_nightly: 400, agreed_txn_fee: 0, agreed_txn_pct: 0, agreed_booking_fee: 0 };

  // 1+2) Balance due, 10 days out.
  let page = await openPage({ name: 'Cara Nunn', email: 'c@x.co' }, [mk('jollyboat', d(10), d(13), Object.assign({ payment: 'unpaid', pay_token: 'tok1' }, priced))]);
  let h = await hub(page);
  ok(!!h, 'the pre-arrival countdown hub renders for an upcoming stay');
  ok(h && h.n === '10' && /days to go/.test(h.u), `countdown reads 10 days to go (${h && h.n} / ${h && h.u})`);
  ok(h && /Jollyboat/.test(h.title) && /10 days/.test(h.title), `hub names the cottage + countdown (${h && h.title.trim()})`);
  ok(h && h.tiles === 5, `hub carries the planning tiles (${h && h.tiles})`);
  ok(h && /balance/i.test(h.sub) && h.pay, 'balance-due stay shows the balance note + Pay CTA');
  // 2a-ii) THE ASK IS NOT THE SMALLEST TYPE IN THE CARD, AND NOTHING HERE IS UNDER
  // THE PHONE TOUCH FLOOR. Two rules this screen was breaking on the DEFAULT theme
  // at phone width: `#view-guest-bookings .btn-sm` out-specified BOTH the ≤480px 44px
  // floor and `.gb2-links .btn-sm`'s own 44 (whose comment claims that floor and
  // never painted), so every control here — Pay included — was 4px shorter than the
  // same button anywhere else; and the primary CTA sat on base .btn-sm at 10.88px
  // uppercase 400 while the quiet links under it were 12.8px sentence-case 600.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(250);
  const cardType = await page.evaluate(() => {
    const box = (sel) => { const e = document.querySelector(sel); if (!e) return null; const cs = getComputedStyle(e);
      return { h: Math.round(e.getBoundingClientRect().height), fs: parseFloat(cs.fontSize), fw: Number(cs.fontWeight), tt: cs.textTransform }; };
    // An identical button OUTSIDE the view, same page and frame, is the control.
    const ref = document.createElement('button'); ref.className = 'btn-sm btn-edit'; ref.textContent = 'Invoice';
    document.body.appendChild(ref);
    const refH = Math.round(ref.getBoundingClientRect().height);
    ref.remove();
    return { cta: box('.gb2-cta .btn-sm, .hub-cta-btn'), quiet: box('.gb2-links .btn-sm'), refH,
      // THE FLOOR IS min-height, and that is what to measure. The painted box is the
      // wrong instrument here: .gb2-cta carries an entrance animation, so the Pay
      // button samples mid-scale — 43.8px in CI, 44 after rounding locally, which is a
      // flake and not a finding. The defect this guards was a `min-height: 40px` rule
      // winning a specificity fight, which a computed read answers exactly. The
      // painted height rides along in the message for context.
      short: (() => {
        const all = [...document.querySelectorAll('#view-guest-bookings .btn-sm, #view-guest-bookings .btn-glass')]
          .filter((e) => e.getClientRects().length)
          .map((e) => ({
            min: parseFloat(getComputedStyle(e).minHeight) || 0,
            h: e.getBoundingClientRect().height,
            who: (e.className || '') + ' “' + (e.textContent || '').trim().slice(0, 18) + '”',
          }))
          .sort((a, b) => a.min - b.min);
        return all[0] || { min: 0, h: 0, who: '(none)' };
      })() };
  });
  ok(cardType.cta && cardType.quiet && cardType.cta.fs >= cardType.quiet.fs,
    `the primary ask is not smaller than the quiet links (${cardType.cta && cardType.cta.fs}px vs ${cardType.quiet && cardType.quiet.fs}px)`);
  ok(cardType.cta && cardType.cta.tt === 'none' && cardType.cta.fw >= 600,
    `…and it reads as a sentence at a ladder weight (${cardType.cta && cardType.cta.tt} / ${cardType.cta && cardType.cta.fw})`);
  ok(cardType.short.min >= 44,
    `every control on the guest's own account screen takes the phone floor (lowest min-height ${cardType.short.min}px on ${cardType.short.who}, painting ${cardType.short.h.toFixed(1)}px; same button outside this view ${cardType.refH}px)`);
  await page.close();

  // 2b) …AND WHEN IT IS DUE. The card's job is "the one outstanding thing before
  //     you arrive", and a deadline is the actionable half of that. The pay screen
  //     its own button leads to has said the date since #969; this card knew least,
  //     because my-bookings.php never sent one. `balance_due_by` is the DERIVED
  //     date (custom plan, else the site standard) — deliberately its own field,
  //     since the raw `balance_due_date` column means "custom override, NULL =
  //     standard" and the owner side reads it for exactly that.
  page = await openPage({ name: 'Due Guest', email: 'due@x.co' },
    [mk('jollyboat', d(20), d(23), Object.assign({ payment: 'unpaid', pay_token: 'tok3', balance_due_by: d(9) }, priced))]);
  h = await hub(page);
  ok(h && /balance .* due by /i.test(h.sub), `the outstanding line names the due date (${h && h.sub.trim().slice(-52)})`);
  ok(h && h.sub.indexOf(ukD(d(9))) !== -1, `…in the house DD/MM/YYYY form (${ukD(d(9))})`);
  await page.close();

  // 2c) THE BUTTON FOLLOWS THE PLAN. It used to read "Pay balance <everything
  //     outstanding>" and post kind:'balance', so a guest on a deposit plan
  //     standing 60 days out was offered the whole stay — the emailed link asked
  //     for the deposit and the button in their own account did not. Both the
  //     LABEL and the charge now come from booking_next_payment, and the button
  //     names no stage at all (the server derives it, exactly like the link).
  const payBtnOf = (pg) => pg.evaluate(() => {
    const el = document.querySelector('.my-stay-hub-soon .hub-cta-btn');
    return { txt: (el ? el.textContent : '').replace(/\s+/g, ' ').trim(), args: el ? el.getAttribute('data-args') || '' : '' };
  });
  page = await openPage({ name: 'Plan Guest', email: 'plan@x.co' },
    [mk('jollyboat', d(60), d(63), Object.assign({ payment: 'unpaid', pay_token: 'tokp', balance_due_by: d(30),
      next_payment: { kind: 'deposit', due: 100, damages: 50, charge: 150 } }, priced))]);
  h = await hub(page);
  let pb = await payBtnOf(page);
  ok(/Pay deposit £150\.00/.test(pb.txt), `the button asks for the PLAN's next payment (${pb.txt})`);
  ok(!/£400\.00/.test(pb.txt), '…not the whole outstanding balance');
  ok(!/balance/i.test(pb.args), `…and it names no stage — the server derives it (${pb.args})`);
  ok(h && /deposit £150\.00 due/.test(h.sub) && !/due by/.test(h.sub),
    `the line above it says the same thing, with no date on a deposit (${h.sub.trim().slice(-40)})`);
  await page.close();

  // …and once the deposit is in, the SAME card moves to the balance, dated.
  page = await openPage({ name: 'Stage Two', email: 'two@x.co' },
    [mk('jollyboat', d(60), d(63), Object.assign({ payment: 'deposit', pay_token: 'tokq', balance_due_by: d(30),
      next_payment: { kind: 'balance', due: 300, damages: 0, charge: 300 } }, priced))]);
  h = await hub(page);
  pb = await payBtnOf(page);
  ok(/Pay balance £300\.00/.test(pb.txt), `the next stage reads as the balance (${pb.txt})`);
  ok(h && /balance £300\.00 due by /.test(h.sub), `…and the balance carries its date again (${h.sub.trim().slice(-42)})`);
  await page.close();

  // An older server sends no next_payment: the card reads exactly as it did.
  page = await openPage({ name: 'Old Payload', email: 'oldp@x.co' },
    [mk('jollyboat', d(60), d(63), Object.assign({ payment: 'unpaid', pay_token: 'tokr' }, priced))]);
  pb = await payBtnOf(page);
  ok(/Pay balance £400\.00/.test(pb.txt), `no next_payment falls back to the balance (${pb.txt})`);
  await page.close();

  // A date already PAST reads plain "due" — it is due NOW, and a past deadline is
  // a reprimand rather than a fact. Same rule as the pay screen's headline, from
  // the same helper, which is the point of there being one.
  page = await openPage({ name: 'Late Guest', email: 'late@x.co' },
    [mk('jollyboat', d(20), d(23), Object.assign({ payment: 'unpaid', pay_token: 'tok4', balance_due_by: d(-3) }, priced))]);
  h = await hub(page);
  ok(h && /balance/i.test(h.sub) && !/due by/i.test(h.sub), `a passed due date reads plain "due" (${h && h.sub.trim().slice(-40)})`);
  await page.close();

  // An older server sends no date at all — the card reads exactly as it did.
  page = await openPage({ name: 'Old Server', email: 'old@x.co' },
    [mk('jollyboat', d(20), d(23), Object.assign({ payment: 'unpaid', pay_token: 'tok5' }, priced))]);
  h = await hub(page);
  ok(h && /balance/i.test(h.sub) && !/due by/i.test(h.sub) && !/by\s*$/.test(h.sub.trim()),
    `no date sent → no dangling "by" (${h && h.sub.trim().slice(-40)})`);
  await page.close();

  // 3) Fully paid + details submitted → "all set", no CTA.
  page = await openPage({ name: 'Paid Guest', email: 'p@x.co' }, [mk('jollyboat', d(6), d(9), { payment: 'paid', reg_submitted: true, reg_url: 'guest-details.php?b=1&token=z' })]);
  h = await hub(page);
  ok(h && /all set/i.test(h.sub) && !h.pay, `fully-paid, details-in guest reads "you're all set" with no CTA (${h && h.sub.trim().slice(-30)})`);
  await page.close();

  // 3b) …but a register SHORT of the party is not "all set". guest-details.php
  // refuses a short submission against the booking's adult count at the time;
  // edit the booking up afterwards and the legal record covers some of them.
  // The form prefills what is there and asks for the rest, so re-offering it is
  // the whole fix — the guest is the only one who can finish it.
  page = await openPage({ name: 'Grown Party', email: 'g@x.co' }, [mk('jollyboat', d(6), d(9), { payment: 'paid', reg_submitted: true, reg_count: 2, adults: 4, reg_url: 'guest-details.php?b=1&token=z' })]);
  h = await hub(page);
  ok(h && /add your guest details/i.test(h.sub), `a short register re-offers the form (${h && h.sub.trim().slice(-40)})`);
  ok(h && !/all set/i.test(h.sub), '…and never tells them they are all set');
  await page.close();

  // 4) Tomorrow wording at +1 day.
  page = await openPage({ name: 'Soon Guest', email: 's@x.co' }, [mk('21a', d(1), d(3), { payment: 'unpaid', pay_token: 'tok2' })]);
  h = await hub(page);
  ok(h && h.n === '1' && /day to go/.test(h.u) && /Tomorrow/.test(h.title), `+1 day reads "Tomorrow" / 1 day to go (${h && h.title.trim()})`);
  await page.close();

  // 5) Two upcoming stays → exactly one hub, for the soonest.
  page = await openPage({ name: 'Two Stays', email: 't@x.co' }, [
    mk('jollyboat', d(5), d(8), Object.assign({ payment: 'unpaid', pay_token: 'a' }, priced)),
    mk('21a', d(20), d(23), Object.assign({ payment: 'unpaid', pay_token: 'b' }, priced)),
  ]);
  h = await hub(page);
  ok(h && h.count === 1 && h.n === '5', `only the soonest upcoming stay gets a hub (count ${h && h.count}, days ${h && h.n})`);
  await page.close();

  // 6) Past-only guest → no hub.
  page = await openPage({ name: 'Past Guest', email: 'past@x.co' }, [mk('jollyboat', d(-30), d(-27), { payment: 'paid' })]);
  h = await hub(page);
  ok(h === null, 'a past-only guest gets no pre-arrival hub');
  await page.close();

  // 7) Logged out → no hub.
  page = await openPage(null, []);
  h = await hub(page);
  ok(h === null, 'logged out → no pre-arrival hub');
  await page.close();

  // Reads the guest My Stays classification: is the in-residence hub shown, and
  // which section (Upcoming vs Past stays) does the booking card land in.
  const stayState = (page) => page.evaluate(() => {
    const list = document.getElementById('guest-bookings-list');
    return {
      inStay: !!document.querySelector('.my-stay-hub:not(.my-stay-hub-soon)'),
      badges: [...list.querySelectorAll('.guest-status-badge')].map((b) => b.textContent.trim()),
      headers: [...list.querySelectorAll('h3')].map((h) => h.textContent.trim()),
    };
  });

  // 8) Checkout day, checkout time ALREADY passed (00:00) → the guest has
  // departed, so the booking is a Past stay THAT SAME DAY, no in-residence hub.
  // Clock pinned to mid-morning: at exactly 00:00 the checkout would be only just
  // reached, which is the boundary case 10 covers deliberately.
  page = await openPage({ name: 'Just Left', email: 'jl@x.co' }, [mk('jollyboat', d(-3), d(0), { payment: 'paid', check_out_time: '00:00' })], { at: todayAt(9, 0) });
  let s = await stayState(page);
  ok(!s.inStay && s.badges.includes('Past stay') && s.headers.some((h) => /Past stays/.test(h)),
    `departed today (checkout passed) → Past stays, no in-stay hub (hub=${s.inStay}, badges=${s.badges.join(',')})`);
  await page.close();

  // 9) Checkout day, checkout time STILL TO COME (23:59) → not departed yet, so
  // the guest is still in residence and the booking is NOT a Past stay. Pinned for
  // the reason above: run this in the 23:59 minute and 23:59 is not "to come".
  page = await openPage({ name: 'Still Here', email: 'sh@x.co' }, [mk('jollyboat', d(-3), d(0), { payment: 'paid', check_out_time: '23:59' })], { at: todayAt(9, 0) });
  s = await stayState(page);
  ok(s.inStay && !s.badges.includes('Past stay') && !s.headers.some((h) => /Past stays/.test(h)),
    `checkout still to come → in-residence, not yet Past (hub=${s.inStay}, badges=${s.badges.join(',')})`);
  await page.close();

  // 10) The far end of the same day — the case a wall-clock run could only ever hit
  // by luck, and the one that used to break case 9. The comparison is `nowMins >=
  // mins`, so at 23:59 a 23:59 checkout IS reached and the stay drops to Past.
  page = await openPage({ name: 'Late Left', email: 'll@x.co' }, [mk('jollyboat', d(-3), d(0), { payment: 'paid', check_out_time: '23:59' })], { at: todayAt(23, 59, 30) });
  s = await stayState(page);
  ok(!s.inStay && s.badges.includes('Past stay'),
    `at 23:59 a 23:59 checkout IS reached → Past stay (hub=${s.inStay}, badges=${s.badges.join(',')})`);
  await page.close();

  // 11) THE DEPOSIT ON THE GUEST'S CARD IS THE SUM THAT WAS TAKEN. The owner can
  // edit a booking's deposit after it has been charged: agreed_booking_fee moves,
  // hold_amount stays. invoice.php bills hold_amount (and return_deposit is capped
  // by it), so a card quoting the agreed figure told the guest they had paid more
  // than they had, and promised back money that cannot be refunded. Served here as
  // agreed £90 against £50 actually held, so the agreed figure cannot pass.
  page = await openPage({ name: 'Charged Guest', email: 'cg@x.co' }, [mk('jollyboat', d(20), d(23), {
    payment: 'paid', deposit_paid: 390, agreed_total: 390, agreed_per_night: 130, agreed_nights: 3,
    agreed_nightly: 390, agreed_booking_fee: 90, agreed_txn_pct: 0, agreed_txn_fee: 0,
    hold_status: 'charged', hold_amount: 50,
  })], { at: todayAt(9, 0) });
  // The breakdown folds under the card's payline now — open it before an
  // innerText read (the fold rule: visibility, never existence).
  await page.click('.gb2-payline');
  await page.waitForTimeout(150);
  const money = await page.evaluate(() => {
    const box = document.querySelector('.guest-price-box');
    return box ? box.innerText.replace(/\s+/g, ' ') : '';
  });
  ok(/Refundable damages deposit £50\.00/.test(money), `the card quotes the deposit actually taken (${money.slice(0, 120)})`);
  ok(!/£90\.00/.test(money), 'the agreed figure the owner later typed is nowhere on it');
  ok(/Total \(incl\. deposit\) £440\.00/.test(money), 'the total folds in that same £50, not the £90');
  ok(/Paid in full £440\.00/.test(money), '…and the paid line agrees with it, so no phantom balance appears');
  await page.close();

  // 12) A CUSTOM PRICE IS ONE COHERENT LINE ON THE CARD. price_override swaps
  // agreedPrice.total to the agreed figure while the per-night snapshot stays
  // (mapBookingFromApi — this drives that real path, which the smoke-test render
  // check cannot), so the card read "£130.00 × 7 nights £910.00 … Total £750.00":
  // standard-rate lines beside a total they cannot reach, on the guest's own
  // screen. The screenshot the owner reported, reproduced as the fixture.
  page = await openPage({ name: 'Agreed Guest', email: 'ag@x.co' }, [mk('jollyboat', d(30), d(37), {
    payment: 'unpaid', agreed_total: 910, agreed_per_night: 130, agreed_nights: 7,
    agreed_nightly: 910, agreed_booking_fee: 50, agreed_txn_pct: 0, agreed_txn_fee: 0,
    price_override: 700,
  })]);
  await page.click('.gb2-payline'); // the breakdown folds under the payline — open first
  await page.waitForTimeout(150);
  const custom = await page.evaluate(() => {
    const box = document.querySelector('.guest-price-box');
    return box ? box.innerText.replace(/\s+/g, ' ') : '';
  });
  ok(/Agreed price for your stay \(7 nights\) £700\.00/.test(custom),
    `an override booking's card states the agreed price as one line (${custom.slice(0, 110)})`);
  ok(!/£910\.00/.test(custom) && !/× 7 nights/.test(custom) && !/Transaction fee/.test(custom),
    '…and the standard-rate maths that could not add up to it is gone');
  ok(/Total \(incl\. deposit\) £750\.00/.test(custom),
    `…so the lines now SUM to the total shown (${custom.slice(-60)})`);
  await page.close();

  // 13) AN ARMED MONTHLY PLAN SHOWS ITS SCHEDULE. The hub's "one outstanding
  // thing" line reads on-track (a plan running means nothing IS outstanding),
  // the plan block carries the progress bar + the state-dot rail whose rows
  // sum to what is left, and the off-switch is one tap away — all from the
  // my-bookings payload, so the card can never promise money the server's own
  // derivation disagrees with.
  page = await openPage({ name: 'Cara Nunn', email: 'c@x.co' }, [mk('jollyboat', d(80), d(83), {
    payment: 'deposit', pay_token: 'tok9',
    agreed_total: 700, agreed_per_night: 233.33, agreed_nights: 3, agreed_nightly: 700,
    agreed_txn_fee: 0, agreed_txn_pct: 0, agreed_booking_fee: 0,
    autopay_state: 'armed', autopay_says: 'Scheduled — £175.00 monthly, next on 28/08/2026.',
    autopay_plan: {
      n: 3, per: 175, toGo: 350, next: d(20),
      dates: [
        { date: d(-10), state: 'done', fig: 175 },
        { date: d(20), state: 'next', fig: 175 },
        { date: d(50), state: 'todo', fig: 175 },
      ],
    },
  })]);
  const plan = await page.evaluate(() => {
    const hub = document.querySelector('.my-stay-hub-soon');
    const block = hub && hub.querySelector('.hub-plan');
    return {
      ready: hub ? (hub.querySelector('.hub-ok') || {}).textContent || '' : '',
      block: !!block,
      sum: block ? (block.querySelector('.hub-plan-sum') || {}).textContent || '' : '',
      rows: block ? block.querySelectorAll('.ap-row').length : 0,
      dots: block ? [...block.querySelectorAll('.ap-dot')].map((e) => e.className.replace('ap-dot ', '')).join('|') : '',
      barW: block ? (block.querySelector('.ap-bar > span') || { style: {} }).style.width || '' : '',
      figs: block ? [...block.querySelectorAll('.ap-figc')].map((e) => e.textContent).join('|') : '',
      off: hub ? (hub.querySelector('.hub-autopay-off') || {}).textContent || '' : '',
    };
  });
  ok(/payments on track — nothing needed from you/.test(plan.ready),
    `an armed plan reads on-track, not outstanding (${plan.ready})`);
  ok(plan.block && plan.rows === 3, `the plan block shows one row per collection (${plan.rows})`);
  ok(plan.dots === 'is-done|is-next|is-todo', `…in the live-plan vocabulary (${plan.dots})`);
  ok(plan.sum === '1 of 3 done · £350.00 to go', `…with the summary line (${plan.sum})`);
  ok(plan.barW === '33%', `…and the progress bar a third full (${plan.barW})`);
  ok(plan.figs === '£175.00|£175.00|£175.00', `…rows carrying the payload's own figures (${plan.figs})`);
  ok(/Turn off automatic payments/.test(plan.off), `the off-switch is one tap away (${plan.off})`);
  await page.close();

  // 14) A PLAN IN TROUBLE STAYS ON THE CARD, WITH ITS FIX. A failed try
  // ('retrying') marks the declined row in place, says why + when in one
  // sentence, and leads with "Update card & keep the plan" — the same pay
  // screen the failure email points at. A plan silently vanishing the moment
  // it needs the guest would read as "sorted".
  const troublePlan = (state, extra) => ({
    n: 3, per: 175, toGo: 350, next: d(20), state,
    why: 'The card was declined.', ...extra,
    dates: [
      { date: d(-10), state: 'done', fig: 175 },
      { date: d(20), state: 'next', fig: 175 },
      { date: d(50), state: 'todo', fig: 175 },
    ],
  });
  page = await openPage({ name: 'Cara Nunn', email: 'c@x.co' }, [mk('jollyboat', d(80), d(83), {
    payment: 'deposit', pay_token: 'tok9',
    agreed_total: 700, agreed_per_night: 233.33, agreed_nights: 3, agreed_nightly: 700,
    agreed_txn_fee: 0, agreed_txn_pct: 0, agreed_booking_fee: 0,
    autopay_state: 'armed', autopay_says: 'Scheduled.',
    autopay_plan: troublePlan('retrying', { retry: d(2) }),
  })]);
  const retryState = await page.evaluate(() => {
    const hub = document.querySelector('.my-stay-hub-soon');
    const block = hub && hub.querySelector('.hub-plan');
    return {
      warn: hub ? (hub.querySelector('.hub-warn') || {}).textContent || '' : '',
      trouble: !!(block && block.classList.contains('hub-plan-trouble')),
      why: block ? (block.querySelector('.hub-plan-why') || {}).textContent || '' : '',
      note: block ? [...block.querySelectorAll('.ap-note')].map((e) => e.textContent).join('|') : '',
      fix: block ? (block.querySelector('.hub-plan-fix') || {}).textContent || '' : '',
      off: hub ? !!hub.querySelector('.hub-autopay-off') : false,
    };
  });
  ok(/didn’t go through — needs a new card/.test(retryState.warn), `a failed try turns the hub line amber (${retryState.warn})`);
  ok(retryState.trouble && /declined/.test(retryState.note), `…and the declined row says so in place (${retryState.note})`);
  ok(/We couldn't take £175\.00 — The card was declined/.test(retryState.why) && /try again/.test(retryState.why),
    `…with why and when in one sentence (${retryState.why.slice(0, 90)})`);
  ok(/Update card & keep the plan/.test(retryState.fix), `…and the fix leads (${retryState.fix})`);
  ok(retryState.off, '…while the off-switch stays');
  await page.close();

  // 15) STOPPED (the try cap): the summary reads paused, the sentence promises
  // no further charge, and the block still renders although autopay_state is
  // 'failed' — the state that used to drop the guest to a bare Pay button.
  page = await openPage({ name: 'Cara Nunn', email: 'c@x.co' }, [mk('jollyboat', d(80), d(83), {
    payment: 'deposit', pay_token: 'tok9',
    agreed_total: 700, agreed_per_night: 233.33, agreed_nights: 3, agreed_nightly: 700,
    agreed_txn_fee: 0, agreed_txn_pct: 0, agreed_booking_fee: 0,
    autopay_state: 'failed', autopay_says: 'Automatic payment didn’t go through.',
    autopay_plan: troublePlan('stopped', {}),
  })]);
  const stopState = await page.evaluate(() => {
    const hub = document.querySelector('.my-stay-hub-soon');
    const block = hub && hub.querySelector('.hub-plan');
    return {
      warn: hub ? (hub.querySelector('.hub-warn') || {}).textContent || '' : '',
      sum: block ? (block.querySelector('.hub-plan-sum') || {}).textContent || '' : '',
      why: block ? (block.querySelector('.hub-plan-why') || {}).textContent || '' : '',
      fix: block ? !!block.querySelector('.hub-plan-fix') : false,
    };
  });
  ok(/paused — needs a new card/.test(stopState.warn), `a stopped plan reads paused on the hub line (${stopState.warn})`);
  ok(/paused — 1 of 3 done/.test(stopState.sum), `…and in the block's own summary (${stopState.sum})`);
  ok(/stopped trying/.test(stopState.why) && stopState.fix, `…promising no further charge, with the fix present (${stopState.why.slice(0, 80)})`);
  await page.close();

  // 16) A SINGLE "one payment" consent in trouble has NO schedule block, but it
  // must not read as healthy — the failure email sends the guest here. The
  // autopay_trouble descriptor drives a warn line + the update-card route.
  // Retrying keeps autopay_state 'armed'; without this fix that showed green.
  page = await openPage({ name: 'Cara Nunn', email: 'c@x.co' }, [mk('jollyboat', d(80), d(83), {
    payment: 'deposit', pay_token: 'tok9',
    agreed_total: 700, agreed_per_night: 233.33, agreed_nights: 3, agreed_nightly: 700,
    agreed_txn_fee: 0, agreed_txn_pct: 0, agreed_booking_fee: 0,
    autopay_state: 'armed', autopay_says: 'Scheduled.', autopay_plan: null,
    autopay_trouble: { state: 'retrying', why: 'The card was declined.', fig: 525, retry: d(2) },
  })]);
  const single = await page.evaluate(() => {
    const hub = document.querySelector('.my-stay-hub-soon');
    const block = hub && hub.querySelector('.hub-plan-trouble');
    return {
      warn: hub ? (hub.querySelector('.hub-warn') || {}).textContent || '' : '',
      green: hub ? !!hub.querySelector('.hub-ok') : false,
      why: block ? (block.querySelector('.hub-plan-why') || {}).textContent || '' : '',
      fix: block ? (block.querySelector('.hub-plan-fix') || {}).textContent || '' : '',
      hasSchedule: hub ? !!hub.querySelector('.ap-rail') : false,
    };
  });
  ok(/needs a new card/.test(single.warn) && !single.green, `a single trouble consent reads warn, never green (${single.warn})`);
  ok(/We couldn.t take £525\.00/.test(single.why) && /try again/.test(single.why), `…with why + when, no schedule block (${single.why.slice(0, 70)})`);
  ok(/Update card/.test(single.fix) && !single.hasSchedule, `…and the fix, without an instalment rail (${single.fix})`);
  await page.close();

  // 17) THE NEXT figure reflects a manual part-payment — the plan payload now
  // shrinks each remaining row to min(per, running), so the card announces what
  // the collector will really take, not the ceiling (a £150-when-£60-owed alarm).
  page = await openPage({ name: 'Cara Nunn', email: 'c@x.co' }, [mk('jollyboat', d(80), d(83), {
    payment: 'deposit', pay_token: 'tok9',
    agreed_total: 700, agreed_per_night: 233.33, agreed_nights: 3, agreed_nightly: 700,
    agreed_txn_fee: 0, agreed_txn_pct: 0, agreed_booking_fee: 0,
    autopay_state: 'armed', autopay_says: 'Scheduled.',
    // One done, £60 left across two rows: next £60, final £0 — never 2×£175.
    autopay_plan: { n: 3, per: 175, toGo: 60, next: d(20), dates: [
      { date: d(-10), state: 'done', fig: 175 },
      { date: d(20), state: 'next', fig: 60 },
      { date: d(50), state: 'todo', fig: 0 },
    ] },
  })]);
  const shrunk = await page.evaluate(() => {
    const figs = [...document.querySelectorAll('.my-stay-hub-soon .ap-figc')].map((e) => e.textContent);
    return { figs: figs.join('|'), sum: (document.querySelector('.my-stay-hub-soon .hub-plan-sum') || {}).textContent || '' };
  });
  ok(/£60\.00/.test(shrunk.figs) && !/£175\.00\|£175\.00\|£175\.00/.test(shrunk.figs), `the next figure is what will be taken, not the ceiling (${shrunk.figs})`);
  ok(/£60\.00 to go/.test(shrunk.sum), `…and the rows agree with what's left (${shrunk.sum})`);
  await page.close();

  // 18) check_in_time is guest-supplied free text (enquiries.php clean() is
  // trim-only) and reaches the pre-arrival hub's innerHTML — it must be escaped.
  page = await openPage({ name: 'Cara Nunn', email: 'c@x.co' }, [mk('jollyboat', d(80), d(83), {
    payment: 'deposit', pay_token: 'tok9', check_in_time: '<img src=x onerror=window.__xss=1>',
    agreed_total: 700, agreed_per_night: 233.33, agreed_nights: 3, agreed_nightly: 700,
    agreed_txn_fee: 0, agreed_txn_pct: 0, agreed_booking_fee: 0,
  })]);
  const xss = await page.evaluate(() => ({
    fired: !!window.__xss,
    injected: !!document.querySelector('.my-stay-hub-soon img'),
  }));
  ok(!xss.fired && !xss.injected, `a crafted check-in time is escaped, not injected (fired=${xss.fired}, img=${xss.injected})`);
  await page.close();

  // 19) openPayView SUPERSEDE — the source carries the stamp guard so a slow
  // summary from an earlier open can't paint over a newer booking (a race that
  // could act on the wrong figures). Gated at source: the race itself is timing.
  const appSrc = require('fs').readFileSync(__dirname + '/app.js', 'utf8');
  ok(/const openStamp = \+\+payState\.openStamp;/.test(appSrc) && (appSrc.match(/if \(!openLive\(\)\) return;/g) || []).length >= 2,
    'openPayView captures a supersede stamp and bails after each await');

  // 20) THE DOOR CODE — rendered ONLY from what my-bookings.php sent. The
  // server owns the gate (confirmed-set for this stay + arrival near, gated
  // in test-integration §18); the client's whole contract is: show door_code
  // when present, promise only a dated door_code_from, say NOTHING otherwise.
  console.log('20) the guest\'s door code renders only what the server released');
  {
    const p20 = await openPage({ name: 'Keysafe Kate', email: 'k@x.co' }, [
      mk('jollyboat', d(1), d(4), { name: 'Keysafe Kate', payment: 'paid', deposit_paid: 440, agreed_total: 440, door_code: '4826' }),
    ]);
    const t = await p20.evaluate(() => (document.getElementById('guest-bookings') || document.body).textContent);
    ok(/Key safe code/.test(t) && /4826/.test(t), 'a released code shows on the pre-arrival hub, named for what it is');
    await p20.close();
    const p20b = await openPage({ name: 'Keysafe Kate', email: 'k@x.co' }, [
      mk('jollyboat', d(10), d(13), { name: 'Keysafe Kate', payment: 'paid', deposit_paid: 440, agreed_total: 440, door_code_from: d(8) }),
    ]);
    const t2 = await p20b.evaluate(() => (document.getElementById('guest-bookings') || document.body).textContent);
    ok(/Your key safe code appears here from/.test(t2) && !/4826/.test(t2), 'a confirmed-but-early code is a dated promise, never a number');
    await p20b.close();
    const p20c = await openPage({ name: 'Keysafe Kate', email: 'k@x.co' }, [
      mk('jollyboat', d(1), d(4), { name: 'Keysafe Kate', payment: 'paid', deposit_paid: 440, agreed_total: 440 }),
    ]);
    const t3 = await p20c.evaluate(() => (document.getElementById('guest-bookings') || document.body).textContent);
    ok(!/Key safe code|key safe code appears/.test(t3), 'with nothing released the card promises NOTHING — no empty row, no guess');
    await p20c.close();
  }

  // 21) THE STAY TIMELINE — "Your road to Blakeney" (the approved companion
  // demo). Every row reads a payload fact the card already trusts; the balance
  // row's FIGURE is asserted EQUAL to the Pay button's (guestPayCta feeds
  // both), and the door-code row follows the keeper's gate exactly as §20 does.
  console.log('21) the stay timeline');
  const tlOf = (pg) => pg.evaluate(() => {
    const tl = document.querySelector('.my-stay-hub-soon .gtl');
    if (!tl) return null;
    return {
      cap: (tl.querySelector('.gtl-cap') || {}).textContent || '',
      rows: [...tl.querySelectorAll('.gtj')].map((r) => ({
        st: r.className.replace('gtj ', ''),
        l: (r.querySelector('.gtj-l') || {}).textContent || '',
        s: (r.querySelector('.gtj-s') || {}).textContent || '',
        f: (r.querySelector('.gtj-f') || {}).textContent || '',
      })),
      btn: ((document.querySelector('.my-stay-hub-soon .hub-cta-btn') || {}).textContent || '').trim(),
    };
  });
  page = await openPage({ name: 'Road Guest', email: 'road@x.co' },
    [mk('jollyboat', d(20), d(23), Object.assign({ payment: 'unpaid', pay_token: 'tokt', balance_due_by: d(9),
      created_at: d(-5) + ' 10:00:00' }, priced, { agreed_booking_fee: 50 }))]);
  let tl = await tlOf(page);
  ok(!!tl && /Your road to Blakeney/.test(tl.cap), 'the timeline renders under its own caption');
  ok(tl.rows[0] && tl.rows[0].st === 'is-done' && tl.rows[0].l === 'Booking confirmed' && tl.rows[0].s.length > 3,
    `row 1 is the confirmed booking with a spoken date (${tl.rows[0] && tl.rows[0].s})`);
  const nowRow = tl.rows.find((r) => r.st === 'is-now');
  ok(!!nowRow && nowRow.l === 'Balance' && /£450\.00/.test(nowRow.f),
    `the you-are-here row is the balance with its figure (${nowRow && nowRow.l} ${nowRow && nowRow.f})`);
  ok(!!nowRow && new RegExp('Due by ' + ukD(d(9)).replace(/\//g, '\\/')).test(nowRow.s),
    `…dated from the plan's own derived date (${nowRow && nowRow.s})`);
  // EQUALITY OF DERIVATIONS: the row's figure is the button's figure.
  ok(!!nowRow && tl.btn.indexOf(nowRow.f) !== -1, `the row and the Pay button quote ONE figure (${nowRow && nowRow.f} in "${tl.btn}")`);
  const arrRow = tl.rows.find((r) => r.l === 'Arrival details');
  ok(!!arrRow && arrRow.st === 'is-dim' && /about a week before/.test(arrRow.s), 'arrival details reads as still to come');
  const stayRow = tl.rows.find((r) => r.l === 'Your stay');
  ok(!!stayRow && /Check-in from 15:00/.test(stayRow.s), `the stay row names its check-in (${stayRow && stayRow.s})`);
  const depRow = tl.rows.find((r) => r.l === 'Deposit back');
  ok(!!depRow && /£50\.00/.test(depRow.f) && /3–5 working days/.test(depRow.s), 'the deposit-back row carries the refundable figure');
  ok(!tl.rows.some((r) => /door code|Key safe/i.test(r.l)), 'with nothing sent there is NO door-code row at all (§20\'s rule)');
  await page.close();

  // 21b) …the pre-arrival email SENT flips its row to done.
  page = await openPage({ name: 'Sent Guest', email: 'sent@x.co' },
    [mk('jollyboat', d(5), d(8), Object.assign({ payment: 'paid', pre_arrival_sent: d(-1) }, priced))]);
  tl = await tlOf(page);
  const arrRow2 = tl && tl.rows.find((r) => r.l === 'Arrival details');
  ok(!!arrRow2 && arrRow2.st === 'is-done' && /Sent — check your inbox/.test(arrRow2.s), 'a sent arrival email reads done');
  const paidRow = tl && tl.rows.find((r) => r.l === 'Paid in full');
  ok(!!paidRow && paidRow.st === 'is-done' && /£400\.00/.test(paidRow.f), `a settled stay leads with Paid in full (${paidRow && paidRow.f})`);
  await page.close();

  // 21c) part-paid: done "Paid so far" above the now-balance, and the two SUM
  // to the total the card states.
  page = await openPage({ name: 'Part Guest', email: 'part@x.co' },
    [mk('jollyboat', d(20), d(23), Object.assign({ payment: 'deposit', deposit_paid: 100, pay_token: 'toku' }, priced))]);
  tl = await tlOf(page);
  const soFar = tl && tl.rows.find((r) => r.l === 'Paid so far');
  const bal = tl && tl.rows.find((r) => r.st === 'is-now');
  ok(!!soFar && /£100\.00/.test(soFar.f) && !!bal && /£300\.00/.test(bal.f),
    `paid-so-far + balance rows carry the ledger's own split (${soFar && soFar.f} / ${bal && bal.f})`);
  await page.close();

  // 21d) THE HELD-BACK STATE — door_code_pending (keeper ON, unconfirmed): the
  // row says the code is coming with NO date and NO digits; §20's dated
  // promise stays door_code_from's alone.
  page = await openPage({ name: 'Pending Kate', email: 'pk@x.co' },
    [mk('jollyboat', d(10), d(13), Object.assign({ payment: 'paid', door_code_pending: true }, priced))]);
  tl = await tlOf(page);
  const pend = tl && tl.rows.find((r) => r.l === 'Your door code');
  ok(!!pend && /once it's set on the key safe/.test(pend.s) && /never sent by email/.test(pend.s),
    `door_code_pending renders the held-back line (${pend && pend.s.slice(0, 60)})`);
  ok(!!pend && !/appears here from/.test(pend.s) && !/\d{4}/.test(pend.s + pend.f),
    '…with no date and no digits — the gate the demo was approved for');
  await page.close();

  // 22) "WHEN WILL YOU ARRIVE?" — the one new fact. A tap posts the WINDOW
  // CODE to my-bookings.php and the note + selection answer in place; a saved
  // answer comes back selected on the next render.
  console.log('22) the arrival-time answer');
  page = await openPage({ name: 'Slot Guest', email: 'slot@x.co' },
    [mk('jollyboat', d(10), d(13), Object.assign({ payment: 'paid', id: 4242 }, priced))]);
  const posts = [];
  await page.route(/my-bookings\.php$/, async (route) => {
    if (route.request().method() === 'POST') {
      posts.push(JSON.parse(route.request().postData() || '{}'));
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, window: '16-18' }) });
    }
    return route.fallback();
  });
  const slots = await page.evaluate(() => [...document.querySelectorAll('.my-stay-hub-soon .gslot')].map((s) => s.textContent.trim()));
  ok(slots.join('|') === '3–4pm|4–6pm|6–8pm|After 8pm|Not sure yet', `the chips derive from the check-in hour (${slots.join('|')})`);
  await page.click('.my-stay-hub-soon .gslot:nth-child(2)');
  await page.waitForTimeout(400);
  const slotState = await page.evaluate(() => ({
    sel: (document.querySelector('.my-stay-hub-soon .gslot.is-sel') || {}).textContent || '',
    note: (document.querySelector('.my-stay-hub-soon .gslot-note') || {}).textContent || '',
  }));
  ok(posts.length === 1 && posts[0].action === 'set_arrival_window' && posts[0].id === 4242 && posts[0].window === '16-18',
    `the tap posts the window CODE, never a label (${JSON.stringify(posts[0] || {})})`);
  ok(/4–6pm/.test(slotState.sel) && /✓ Noted/.test(slotState.note), `the answer settles in place (${slotState.note.trim()})`);
  await page.close();
  // …and a stored answer renders selected with its note.
  page = await openPage({ name: 'Slot Back', email: 'sb@x.co' },
    [mk('jollyboat', d(10), d(13), Object.assign({ payment: 'paid', arrival_window: '16-18' }, priced))]);
  const preSel = await page.evaluate(() => ({
    sel: (document.querySelector('.my-stay-hub-soon .gslot.is-sel') || {}).textContent || '',
    note: (document.querySelector('.my-stay-hub-soon .gslot-note') || {}).textContent || '',
  }));
  ok(/4–6pm/.test(preSel.sel) && /around 4–6pm/.test(preSel.note), `a saved answer comes back selected (${preSel.note.trim()})`);
  await page.close();

  // 23) THE WEATHER STRIP — the stay's own days from the public forecast; a
  // failed or missing feed renders NOTHING (a blank strip claims nothing).
  console.log('23) the stay\'s weather');
  page = await openPage({ name: 'Wx Guest', email: 'wx@x.co' },
    [mk('jollyboat', d(3), d(6), Object.assign({ payment: 'paid' }, priced))]);
  let wx = await page.evaluate(() => {
    const el = document.querySelector('.my-stay-hub-soon .gwx');
    return { present: !!el, hidden: el ? el.hidden : true };
  });
  ok(wx.present && wx.hidden, 'with no forecast the strip stays hidden');
  await page.route(/weather\.php/, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
    ok: true,
    days: Array.from({ length: 14 }, (_, i) => ({ date: d(i), code: i % 2 ? 2 : 0, summary: i % 2 ? 'Partly cloudy' : 'Sunny', tmax: 21, tmin: 12 })),
  }) }));
  await page.evaluate(() => { __gwxCache = null; return renderGuestStayWeather(); });
  await page.waitForTimeout(300);
  wx = await page.evaluate(() => {
    const el = document.querySelector('.my-stay-hub-soon .gwx');
    return {
      hidden: el ? el.hidden : true,
      cells: el ? el.querySelectorAll('.gwx-d').length : 0,
      temp: el ? (el.querySelector('.gwx-t') || {}).textContent : '',
      note: el ? (el.querySelector('.gwx-note') || {}).textContent : '',
    };
  });
  ok(!wx.hidden && wx.cells === 4, `the strip shows the stay's own days, check-in through check-out (${wx.cells})`);
  ok(/21°/.test(wx.temp) && /Forecast firms up as you get closer/.test(wx.note), 'honest caption about forecast confidence');
  await page.close();
  // …and a stay beyond the horizon renders no strip at all.
  page = await openPage({ name: 'Far Guest', email: 'far@x.co' },
    [mk('jollyboat', d(40), d(43), Object.assign({ payment: 'paid' }, priced))]);
  ok(await page.evaluate(() => !document.querySelector('.my-stay-hub-soon .gwx')), 'a far-out stay has no weather slot');
  await page.close();

  // 24) EXTRAS — one tap lands the ask in the EXISTING message thread, worded
  // as an ask ("asked", never "booked"), and the chip says so.
  console.log('24) extras asks');
  page = await openPage({ name: 'Cot Guest', email: 'cot@x.co' },
    [mk('jollyboat', d(10), d(13), Object.assign({ payment: 'paid' }, priced))]);
  const sends = [];
  await page.route(/messages\.php$/, async (route) => {
    if (route.request().method() === 'POST') {
      sends.push(JSON.parse(route.request().postData() || '{}'));
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
    }
    return route.fallback();
  });
  await page.click('.my-stay-hub-soon .gxchip');
  await page.waitForTimeout(400);
  const xtra = await page.evaluate(() => ({
    chip: (document.querySelector('.my-stay-hub-soon .gxchip.is-asked') || {}).textContent || '',
    note: (document.querySelector('.my-stay-hub-soon .gxtra-note') || {}).textContent || '',
  }));
  ok(sends.length === 1 && sends[0].action === 'send' && /travel cot/.test(sends[0].body) && /Jollyboat/.test(sends[0].body),
    `the ask lands in the chat thread naming the cottage (${(sends[0] || {}).body})`);
  ok(/✓ Travel cot — asked/.test(xtra.chip) && /we'll confirm/.test(xtra.note), `"asked" is the claim — we confirm, the app doesn't promise (${xtra.chip.trim()})`);
  await page.close();

  // 25) ARRIVAL DAY — the door-code hero on the in-residence card. Digits only
  // when the server released them; the held-back state masks the figure and
  // never invents digits; the card remembers the arrival-time answer.
  console.log('25) the arrival-day code hero');
  page = await openPage({ name: 'Hero Kate', email: 'hk@x.co' },
    [mk('jollyboat', d(0), d(3), Object.assign({ payment: 'paid', door_code: '7302', arrival_window: '16-18' }, priced))], { at: todayAt(11, 0) });
  const hero = await page.evaluate(() => {
    const hub = document.querySelector('.my-stay-hub:not(.my-stay-hub-soon)');
    const code = hub && hub.querySelector('.hub-code');
    return {
      fig: code ? (code.querySelector('.hub-code-fig') || {}).textContent : '',
      copy: code ? !!code.querySelector('.hub-code-copy') : false,
      locked: code ? code.classList.contains('is-locked') : true,
      sub: hub ? (hub.querySelector('.hub-sub') || {}).textContent : '',
    };
  });
  ok(hero.fig === '7302' && hero.copy && !hero.locked, `a released code is the hero, with Copy (${hero.fig})`);
  ok(/you said 4–6pm/.test(hero.sub), `the card remembers the arrival-time answer (${hero.sub.trim().slice(-30)})`);
  await page.close();
  page = await openPage({ name: 'Locked Kate', email: 'lk@x.co' },
    [mk('jollyboat', d(0), d(3), Object.assign({ payment: 'paid', door_code_pending: true }, priced))], { at: todayAt(11, 0) });
  const locked = await page.evaluate(() => {
    const code = document.querySelector('.my-stay-hub:not(.my-stay-hub-soon) .hub-code');
    return {
      present: !!code,
      locked: code ? code.classList.contains('is-locked') : false,
      fig: code ? (code.querySelector('.hub-code-fig') || {}).textContent : '',
      sub: code ? (code.querySelector('.hub-code-sub') || {}).textContent : '',
    };
  });
  ok(locked.present && locked.locked && !/\d/.test(locked.fig), `unconfirmed on arrival day → masked, no digits (${locked.fig})`);
  ok(/isn't on the safe yet/.test(locked.sub), `…and the held-back sentence says why (${locked.sub.slice(0, 50)})`);
  await page.close();
  // …and any other day (or keeper off) renders no hero at all.
  page = await openPage({ name: 'Mid Kate', email: 'mk@x.co' },
    [mk('jollyboat', d(-1), d(3), Object.assign({ payment: 'paid' }, priced))], { at: todayAt(11, 0) });
  ok(await page.evaluate(() => !document.querySelector('.my-stay-hub:not(.my-stay-hub-soon) .hub-code')),
    'mid-stay with nothing released → no code card at all');
  await page.close();

  // 26) THE STAY CARD, REBUILT — accent band + serif name, spoken when-line,
  // ONE payline whose fold holds the same guestPriceBoxHtml rows, quiet links.
  console.log('26) the stay card rebuilt');
  page = await openPage({ name: 'Card Guest', email: 'card@x.co' },
    [mk('jollyboat', d(20), d(23), Object.assign({ payment: 'paid', deposit_paid: 400 }, priced, { id: 5151 }))]);
  const card = await page.evaluate(() => {
    const c = document.querySelector('.guest-booking.gb2');
    if (!c) return null;
    const pl = c.querySelector('.gb2-payline');
    return {
      band: !!c.querySelector('.gb2-band'),
      when: (c.querySelector('.gb2-when') || {}).textContent || '',
      pl1: (pl.querySelector('.gb2-pl1') || {}).textContent || '',
      fig: (pl.querySelector('.gb2-fig') || {}).textContent || '',
      folded: (document.getElementById('gb2-fold-b5151') || {}).hidden,
      links: [...c.querySelectorAll('.gb2-links .btn-sm')].map((b) => b.textContent.trim()),
    };
  });
  ok(!!card && card.band, 'the card carries its cottage accent band');
  ok(card && /^\w{3} \d+ \w+ → /.test(card.when) && /3 nights/.test(card.when) && /ref CHB-/.test(card.when),
    `the when-line is spoken, with nights + ref (${card && card.when.slice(0, 60)})`);
  ok(card && /Paid in full/.test(card.pl1) && card.fig === '£400.00', `the payline states the verdict + figure (${card && card.pl1} ${card && card.fig})`);
  ok(card && card.folded === true, 'the breakdown starts folded');
  await page.click('.gb2-payline');
  await page.waitForTimeout(150);
  const foldOpen = await page.evaluate(() => ({
    hidden: (document.getElementById('gb2-fold-b5151') || {}).hidden,
    exp: (document.querySelector('.gb2-payline') || { getAttribute: () => '' }).getAttribute('aria-expanded'),
    box: !!document.querySelector('#gb2-fold-b5151 .guest-price-box'),
    addr: /in 15:00 \/ out 10:00/.test((document.querySelector('.gb2-addr') || {}).textContent || ''),
  }));
  ok(foldOpen.hidden === false && foldOpen.exp === 'true' && foldOpen.box,
    'the payline opens to the SAME price-box rows (one composer, folded)');
  ok(foldOpen.addr, 'the address + in/out times live in the fold');
  ok(card && card.links.length >= 3 && card.links.includes('Invoice') && card.links.includes('Terms'),
    `the secondary actions are one quiet row (${card && card.links.join(' · ')})`);
  await page.close();

  // 27) AFTER THE STAY — star-tap review, Book again + the returning-guest
  // ordinal, and older past stays behind one disclosure.
  console.log('27) after the stay');
  page = await openPage({ name: 'After Guest', email: 'after@x.co' }, [
    mk('jollyboat', d(-6), d(-3), Object.assign({ payment: 'paid', deposit_paid: 400 }, priced)),
    mk('21a', d(-60), d(-57), Object.assign({ payment: 'paid', deposit_paid: 400 }, priced)),
    mk('jollyboat', d(-120), d(-117), Object.assign({ payment: 'paid', deposit_paid: 400 }, priced)),
  ]);
  // completed_stays comes from the payload — re-stub it via the route? openPage
  // sends completed_stays: 0, so the ordinal line must NOT render (never claim
  // a count the server didn't give).
  const after = await page.evaluate(() => {
    const lead = document.querySelector('.gb-grid .gb2'); // first past card
    return {
      again: (document.querySelector('.gb2-again') || {}).textContent || '',
      againCount: document.querySelectorAll('.gb2-again').length,
      ord: (document.querySelector('.gb2-ord') || {}).textContent || '',
      stars: lead ? lead.querySelectorAll('.gb2-star').length : 0,
      pastBtn: (document.querySelector('.gb2-pastbtn') || {}).textContent || '',
      foldHidden: (document.getElementById('gb2-pastfold') || {}).hidden,
      foldCards: document.querySelectorAll('#gb2-pastfold .gb2').length,
    };
  });
  ok(/Book Jollyboat again/.test(after.again) && after.againCount === 1,
    `the just-finished stay leads with Book again, once (${after.again})`);
  ok(after.ord === '', 'no ordinal line when the server counted no completed stays');
  ok(after.stars === 5, `the review ask is five tappable stars (${after.stars})`);
  ok(/Earlier stays \(2\)/.test(after.pastBtn) && after.foldHidden === true && after.foldCards === 2,
    `older stays sit behind one disclosure (${after.pastBtn.trim()})`);
  await page.click('.gb2-pastbtn');
  await page.waitForTimeout(150);
  ok(await page.evaluate(() => (document.getElementById('gb2-pastfold') || {}).hidden === false),
    'the disclosure opens to the full cards — nothing is lost, only folded');
  // Star tap → the EXISTING review form opens with the rating prefilled.
  await page.click('.gb2-stars .gb2-star:nth-child(4)');
  await page.waitForTimeout(150);
  const rev = await page.evaluate(() => ({
    open: (document.getElementById('grf-jollyboat') || { style: {} }).style.display,
    stars: (document.getElementById('grf-stars-jollyboat') || {}).value || '',
    lit: document.querySelectorAll('.gb2-stars .gb2-star.is-on').length,
  }));
  ok(rev.open === 'block' && rev.stars === '4' && rev.lit === 4,
    `a star tap opens the real form with the rating prefilled (${rev.stars} stars, ${rev.lit} lit)`);
  await page.close();
  // …and the ordinal line renders when the server HAS counted completed stays.
  page = await openPage({ name: 'Third Timer', email: 'third@x.co' },
    [mk('jollyboat', d(-6), d(-3), Object.assign({ payment: 'paid', deposit_paid: 400 }, priced))], { completed: 2 });
  const ord2 = await page.evaluate(() => (document.querySelector('.gb2-ord') || {}).textContent || '');
  ok(/This would be your third stay with us/.test(ord2), `the ordinal speaks the server's own count (${ord2})`);
  await page.close();

  // 28) AN ARCHIVED COTTAGE'S BOOKING STILL RENDERS (reported live: the Annex
  // was archived, propertyMeta had no entry, and one undefined meta.name threw
  // mid-forEach — the guest's ENTIRE My Stays rendered empty, other cottages'
  // stays included). The server's JOIN still names an archived cottage
  // (property_name), so the card and the pre-arrival hub speak that; the live
  // booking beside it is never collateral damage; Book again is withheld on a
  // cottage with no page to land on.
  console.log('28) a booking at an archived cottage');
  page = await openPage({ name: 'George F', email: 'gf@x.co' }, [
    Object.assign(mk('theannex', d(30), d(33), Object.assign({ payment: 'unpaid', pay_token: 'ta' }, priced)), { property_name: 'The Annex' }),
    mk('jollyboat', d(60), d(63), Object.assign({ payment: 'paid', deposit_paid: 400 }, priced)),
    Object.assign(mk('theannex', d(-60), d(-57), Object.assign({ payment: 'paid', deposit_paid: 400 }, priced)), { property_name: 'The Annex' }),
  ]);
  const arch = await page.evaluate(() => ({
    cards: document.querySelectorAll('.guest-booking').length,
    names: [...document.querySelectorAll('.gb2-name')].map((n) => n.textContent.trim()),
    hub: (document.querySelector('.my-stay-hub-soon .hub-title') || {}).textContent || '',
    tl: !!document.querySelector('.my-stay-hub-soon .gtl'),
    again: document.querySelectorAll('.gb2-again').length,
    rebook: [...document.querySelectorAll('.gb2-links .btn-sm')].filter((b) => /Book again/.test(b.textContent)).length,
  }));
  ok(arch.cards === 3 && arch.names.some((n) => /The Annex/.test(n)) && arch.names.some((n) => /Jollyboat/.test(n)),
    `every stay renders — the archived cottage speaks the server's own name (${arch.names.join(' · ')})`);
  ok(/The Annex/.test(arch.hub) && arch.tl, `the pre-arrival hub + timeline stand for the archived cottage too (${arch.hub.trim()})`);
  ok(arch.again === 0 && arch.rebook === 0, 'Book again is withheld — an archived cottage has no page to land on');
  await page.close();

  // ── 29) THE CARD SAYS WHAT REALLY HAPPENED TO THE DEPOSIT ────────────────────
  // guestPriceBoxHtml emitted ONE static sentence from `dep > 0` — "refunded after
  // your stay" — for every state, so a KEPT deposit told the guest their money was
  // coming back on the same booking whose own invoice and PDF said it was retained
  // for damage. One booking, two documents, opposite claims. It reads
  // depositInvoiceStatus now: the pure derivation the invoice and the PDF already
  // share, driven by the same invoice-deposit-fixtures.json.
  console.log('\n29) the deposit state on the stay card');
  const depSay = async (extra) => {
    const pg = await openPage({ name: 'Dep Guest', email: 'dep@x.co' },
      [mk('jollyboat', d(-10), d(-7), Object.assign({ payment: 'paid', deposit_paid: 450, damages_deposit: 75 }, priced, extra))]);
    // The breakdown starts folded; its text is in the DOM either way.
    const t = await pg.evaluate(() => {
      const box = document.querySelector('.guest-price-box');
      return box ? (box.textContent || '').replace(/\s+/g, ' ') : '(no price box)';
    });
    await pg.close();
    return t;
  };
  const kept = await depSay({ hold_status: 'kept', hold_amount: 75 });
  ok(/retained/i.test(kept), `a KEPT deposit says it was retained (${kept.slice(-90)})`);
  ok(!/refunded after your stay/i.test(kept), '…and never that it is coming back');
  // A RETURNED deposit has LEFT the total (displayGrand zeroes it — display and
  // arithmetic are different questions, invoice.php's own rule), which left the card
  // silent about £75 that had been taken and given back. `depWas` is what it WAS.
  const back = await depSay({ hold_status: 'returned', hold_amount: 75, damages_returned: 75, hold_settled_at: d(-5) + ' 10:00:00' });
  ok(/refunded in full/i.test(back), `a RETURNED deposit is still ON the card, saying it went back (${back.slice(-90)})`);
  const held = await depSay({ hold_status: 'charged', hold_amount: 75 });
  ok(/refunded in full after your stay/i.test(held), `one still held reads as still to come (${held.slice(-90)})`);

  // ── 30) A GUEST WHO HAS STAYED HERE IS NOT A NEW VISITOR ─────────────────────
  // Cancelling DELETEs the booking row — dates_clash, availability.php and
  // waitlist_notify_freed all depend on it going — so a guest whose only stay was
  // cancelled, possibly with a refund still in flight, was told "No Bookings Yet …
  // once you book one of our cottages, it will appear here" by their own account.
  console.log('\n30) the empty state after a cancellation');
  const emptyNew = await openPage({ name: 'New Visitor', email: 'nv@x.co' }, []);
  const newSay = await emptyNew.evaluate(() => (document.querySelector('.guest-empty') || {}).textContent || '');
  await emptyNew.close();
  ok(/No Bookings Yet/i.test(newSay), `a genuinely new visitor still gets the welcome (${newSay.replace(/\s+/g, ' ').slice(0, 40)})`);
  const emptyBack = await openPage({ name: 'Been Before', email: 'bb@x.co' }, [], { completed: 2 });
  const backSay = await emptyBack.evaluate(() => (document.querySelector('.guest-empty') || {}).textContent || '');
  await emptyBack.close();
  ok(!/No Bookings Yet/i.test(backSay) && /Nothing booked/i.test(backSay),
    `a returning guest is not told they have never booked (${backSay.replace(/\s+/g, ' ').slice(0, 60)})`);
  ok(/reply to your confirmation email/i.test(backSay),
    '…and is given a way to ask about a stay they expected to see');

  console.log(fails ? `\n  ${fails} YOUR-STAY CHECK(S) FAILED ❌` : '\n  YOUR-STAY SUITE PASSED ✅');
  await done(fails);
})();
