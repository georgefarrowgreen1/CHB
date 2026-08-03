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
      if (url.includes('my-bookings.php')) return json({ ok: true, bookings, enquiries: [], completed_stays: 0 });
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

  console.log(fails ? `\n  ${fails} YOUR-STAY CHECK(S) FAILED ❌` : '\n  YOUR-STAY SUITE PASSED ✅');
  await done(fails);
})();
