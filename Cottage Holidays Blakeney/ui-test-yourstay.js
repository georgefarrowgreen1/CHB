// Guest "My stays" — the soonest stay is ONE card, end to end in a real browser.
// The pay-screens build merged the pre-arrival hub into the stay's own card
// (.gb2-next): the same stay was told twice and Pay offered twice. Now:
//  1. the soonest upcoming stay carries the countdown on its photo, the stay's
//     planning tiles and ONE money block (the figure, its line, one button)
//  2. a stay that owes says the figure the button takes, and when it is due —
//     spoken, with its weekday, the pay screen's own form
//  3. a fully-paid, details-in guest is "Paid in full" with no button
//  4. "Tomorrow" at +1 day
//  5. only the SOONEST upcoming stay gets the countdown card (one, not per-booking)
//  6. a past-only guest, and a logged-out visitor, get no countdown card
//  7. DEPARTURE edge (time-aware): a stay whose checkout time has passed on the
//     checkout day drops to "Past stays" the same day — not at the next midnight;
//     one whose checkout time is still to come stays in-residence
const { d, bootBrowser, now } = require('./ui-test-lib'); // pins TZ=Europe/London at require time
let fails = 0;
const ok = (b, m) => { console.log(`  ${b ? '✓' : '✗'} ${m}`); if (!b) fails++; };

(async () => {
  const { browser, base, done } = await bootBrowser();
  const d = require('./ui-test-lib').d; // the harness's day (today, UK)
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
  const todayAt = (hh, mm, ss) => { const t = new Date(now()); return new Date(t.getFullYear(), t.getMonth(), t.getDate(), hh, mm, ss || 0); };

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
    await page.goto(`${base}/index.html${(opts && opts.q) || ''}`, { waitUntil: 'networkidle' });
    // noopen: a deep-link case (?review=…) navigates ITSELF off the restored
    // session — a second openGuestArea here re-renders the cards and wipes
    // what the deep link just opened, which no real arrival does.
    if (guest && !(opts && opts.noopen)) { await page.evaluate(() => openGuestArea()); }
    await page.waitForTimeout(700);
    return page;
  };

  // The soonest stay's card. `say` is the money block's line, `next` the journey's
  // sentence beneath it; `btn` the money block's one button.
  const hub = (page) => page.evaluate(() => {
    const el = document.querySelector('#guest-bookings-list .gb2-next');
    if (!el) return null;
    const t = (q) => ((el.querySelector(q) || {}).textContent || '').replace(/\s+/g, ' ').trim();
    const badge = t('.gb2-count');
    const m = badge.match(/^(\d+) (days? to go)$/);
    const name = el.querySelector('.gb2-name');
    const nameNode = name ? [...name.childNodes].find((n) => n.nodeType === 3 && n.textContent.trim()) : null;
    const say = el.querySelector('.gbm-s');
    return {
      n: badge === 'Tomorrow' ? '1' : m ? m[1] : '',
      u: m ? m[2] : badge,
      badge,
      title: nameNode ? nameNode.textContent.trim() : '',
      fig: t('.gbm-fig'),
      say: t('.gbm-s'),
      tone: say ? say.className.replace('gbm-s', '').trim() : '',
      next: t('.bkflow-next'),
      btn: t('.gbm-btn'),
      accent: !!el.querySelector('.gbm-btn.is-accent'),
      bar: (el.querySelector('.gbm-bar > span') || { style: {} }).style.width || '',
      leg: [...el.querySelectorAll('.gbm-leg span')].map((s) => s.textContent.trim()),
      tiles: el.querySelectorAll('.hub-tile').length,
      pay: [...el.querySelectorAll('.gbm-btn')].some((b) => b.textContent.trim() === 'Pay'),
      // Pay offered anywhere on the card (the merge's point: once, not twice).
      pays: [...el.querySelectorAll('button, a')].filter((b) => /^Pay\b/.test(b.textContent.trim())).length,
      count: document.querySelectorAll('#guest-bookings-list .gb2-next').length,
      oldHub: document.querySelectorAll('.my-stay-hub-soon').length,
    };
  });
  // The spoken date, read off the page's own helper rather than re-implemented.
  const spoken = (page, iso) => page.evaluate((x) => payDay(x), iso);

  // A locked agreed price so the balance is deterministic (independent of rate
  // synthesis) — exactly how a confirmed booking carries its price.
  const priced = { agreed_total: 400, agreed_per_night: 133.33, agreed_nights: 3, agreed_nightly: 400, agreed_txn_fee: 0, agreed_txn_pct: 0, agreed_booking_fee: 0 };

  // 1+2) Balance due, 10 days out.
  let page = await openPage({ name: 'Cara Nunn', email: 'c@x.co' }, [mk('jollyboat', d(10), d(13), Object.assign({ payment: 'unpaid', pay_token: 'tok1' }, priced))]);
  let h = await hub(page);
  ok(!!h, 'the soonest upcoming stay is one card with its countdown');
  ok(h && h.oldHub === 0, 'there is no separate pre-arrival hub above it — the same stay is told once');
  ok(h && h.n === '10' && /days to go/.test(h.u), `countdown reads 10 days to go (${h && h.badge})`);
  // The countdown is said ONCE, on the badge — the title used to repeat it and the
  // duplicate forced the name onto two lines beside the badge at 390px.
  ok(h && /Jollyboat/.test(h.title) && !/\d+ days|Tomorrow/.test(h.title), `the card names the cottage, and the countdown only on the badge (${h && h.title})`);
  ok(h && h.tiles === 6, `the card carries the planning tiles (${h && h.tiles})`);
  ok(h && /^£400\.00 balance$/.test(h.fig) && h.pay && h.accent, `a stay that owes states the figure, with the one accent Pay (${h && h.fig} · ${h && h.btn})`);
  ok(h && h.pays === 1, `Pay is offered once on the card, not twice (${h && h.pays})`);
  // 2a-ii) THE ASK IS NOT THE SMALLEST TYPE IN THE CARD, AND NOTHING HERE IS UNDER
  // THE PHONE TOUCH FLOOR. Two rules this screen was breaking on the DEFAULT theme
  // at phone width: `#view-guest-bookings .btn-sm` out-specified BOTH the ≤480px 44px
  // floor and `.gb2-links .btn-sm`'s own 44 (whose comment claims that floor and
  // never painted), so every control here was 4px shorter than the same button
  // anywhere else; and the primary CTA sat on base .btn-sm at 10.88px uppercase 400
  // while the quiet links under it were 12.8px sentence-case 600. The money block's
  // button is that primary now.
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
    return { cta: box('.gb2-next .gbm-btn'), quiet: box('.gb2-links .btn-sm'), refH,
      // THE FLOOR IS min-height, and that is what to measure: a painted box samples
      // mid-entrance (43.8px in CI), a flake and not a finding. The defect this
      // guards was a `min-height: 40px` rule winning a specificity fight, which a
      // computed read answers exactly.
      short: (() => {
        const all = [...document.querySelectorAll('#view-guest-bookings .btn-sm, #view-guest-bookings .btn-glass, #view-guest-bookings .hub-code-copy, #view-guest-bookings .gbm-btn')]
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
    `…and it reads as a word at a ladder weight (${cardType.cta && cardType.cta.tt} / ${cardType.cta && cardType.cta.fw})`);
  ok(cardType.short.min >= 44,
    `every control on the guest's own account screen takes the phone floor (lowest min-height ${cardType.short.min}px on ${cardType.short.who}, painting ${cardType.short.h.toFixed(1)}px; same button outside this view ${cardType.refH}px)`);
  await page.close();

  // 2b) …AND WHEN IT IS DUE. The deadline is the actionable half of "what is left
  //     to do", and it is said the pay screen's way: spoken, with its weekday
  //     ("Due by Wed 27 Jan") — a guest money screen reads a date once and acts on
  //     it. `balance_due_by` is the DERIVED date (custom plan, else the site
  //     standard) — deliberately its own field, since the raw `balance_due_date`
  //     column means "custom override, NULL = standard".
  page = await openPage({ name: 'Due Guest', email: 'due@x.co' },
    [mk('jollyboat', d(20), d(23), Object.assign({ payment: 'unpaid', pay_token: 'tok3', balance_due_by: d(9) }, priced))]);
  h = await hub(page);
  const due9 = await spoken(page, d(9));
  ok(h && h.say === 'Due by ' + due9, `the money line names the due date, spoken (${h && h.say})`);
  ok(h && /^\w{3} \d{1,2} \w{3}$/.test(due9), `…with its weekday, in the pay screen's form (${due9})`);
  await page.close();

  // 2c) THE BUTTON FOLLOWS THE PLAN. It used to read "Pay balance <everything
  //     outstanding>" and post kind:'balance', so a guest on a deposit plan
  //     standing 60 days out was offered the whole stay — the emailed link asked
  //     for the deposit and the button in their own account did not. The figure
  //     comes from booking_next_payment, and the button names no stage at all
  //     (the server derives it, exactly like the link).
  const payBtnOf = (pg) => pg.evaluate(() => {
    const el = document.querySelector('.gb2-next .gbm-btn');
    return { txt: (el ? el.textContent : '').replace(/\s+/g, ' ').trim(), args: el ? el.getAttribute('data-args') || '' : '' };
  });
  page = await openPage({ name: 'Plan Guest', email: 'plan@x.co' },
    [mk('jollyboat', d(60), d(63), Object.assign({ payment: 'unpaid', pay_token: 'tokp', balance_due_by: d(30),
      next_payment: { kind: 'deposit', due: 100, damages: 50, charge: 150 } }, priced))]);
  h = await hub(page);
  let pb = await payBtnOf(page);
  ok(h && h.fig === '£150.00 deposit' && pb.txt === 'Pay', `the card asks for the PLAN's next payment (${h && h.fig} · ${pb.txt})`);
  ok(h && !/£400\.00/.test(h.fig + ' ' + h.say), '…not the whole outstanding balance');
  ok(!/balance/i.test(pb.args) && /tokp/.test(pb.args), `…and the button names no stage — the server derives it (${pb.args})`);
  ok(h && /^Due now/.test(h.say) && !/Due by/.test(h.say), `a deposit is due now, so its line carries no date (${h && h.say})`);
  await page.close();

  // …and once the deposit is in, the SAME card moves to the balance, dated.
  page = await openPage({ name: 'Stage Two', email: 'two@x.co' },
    [mk('jollyboat', d(60), d(63), Object.assign({ payment: 'deposit', pay_token: 'tokq', balance_due_by: d(30),
      next_payment: { kind: 'balance', due: 300, damages: 0, charge: 300 } }, priced))]);
  h = await hub(page);
  const due30 = await spoken(page, d(30));
  ok(h && h.fig === '£300.00 balance', `the next stage reads as the balance (${h && h.fig})`);
  ok(h && h.say === 'Due by ' + due30, `…and the balance carries its date again (${h && h.say})`);
  await page.close();

  // An older server sends no next_payment: the card falls back to the balance.
  page = await openPage({ name: 'Old Payload', email: 'oldp@x.co' },
    [mk('jollyboat', d(60), d(63), Object.assign({ payment: 'unpaid', pay_token: 'tokr' }, priced))]);
  h = await hub(page);
  ok(h && h.fig === '£400.00 balance' && h.pay, `no next_payment falls back to the balance (${h && h.fig})`);
  await page.close();

  // A date already PAST reads plain "Due now" — it is due NOW, and a past deadline
  // is a reprimand rather than a fact. Same rule as the pay screen's headline.
  page = await openPage({ name: 'Late Guest', email: 'late@x.co' },
    [mk('jollyboat', d(20), d(23), Object.assign({ payment: 'unpaid', pay_token: 'tok4', balance_due_by: d(-3) }, priced))]);
  h = await hub(page);
  ok(h && h.say === 'Due now', `a passed due date reads plain "Due now" (${h && h.say})`);
  await page.close();

  // An older server sends no date at all — no dangling "by".
  page = await openPage({ name: 'Old Server', email: 'old@x.co' },
    [mk('jollyboat', d(20), d(23), Object.assign({ payment: 'unpaid', pay_token: 'tok5' }, priced))]);
  h = await hub(page);
  ok(h && h.say === 'Due now' && !/by\s*$/.test(h.say), `no date sent → no dangling "by" (${h && h.say})`);
  await page.close();

  // 3) Fully paid + details submitted → "Paid in full", no button.
  page = await openPage({ name: 'Paid Guest', email: 'p@x.co' }, [mk('jollyboat', d(6), d(9), Object.assign({ payment: 'paid', deposit_paid: 400, reg_submitted: true, reg_url: 'guest-details.php?b=1&token=z' }, priced))]);
  h = await hub(page);
  ok(h && /^Paid in full/.test(h.fig) && !h.btn && h.pays === 0, `fully paid: "Paid in full" with no button (${h && h.fig})`);
  ok(h && h.say === 'Nothing more to pay', `…and nothing more asked of them (${h && h.say})`);
  ok(h && /paid up|all set/i.test(h.next), `…and the journey says they are set (${h && h.next.slice(0, 50)})`);
  await page.close();

  // 3b) …but a register SHORT of the party is not done. guest-details.php refuses a
  // short submission against the booking's adult count at the time; edit the
  // booking up afterwards and the legal record covers some of them. The form
  // prefills what is there and asks for the rest, so re-offering it is the whole
  // fix — the guest is the only one who can finish it.
  page = await openPage({ name: 'Grown Party', email: 'g@x.co' }, [mk('jollyboat', d(6), d(9), Object.assign({ payment: 'paid', deposit_paid: 400, reg_submitted: true, reg_count: 2, adults: 4, reg_url: 'guest-details.php?b=1&token=z' }, priced))]);
  h = await hub(page);
  ok(h && /add your guest details/i.test(h.next), `a short register re-offers the form (${h && h.next.slice(0, 40)})`);
  ok(h && !/all set|paid up/i.test(h.next), '…and never tells them they are all set');
  ok(await page.evaluate(() => !!document.querySelector('.gb2-next .bkflow-cta[href*="guest-details.php"]')), '…with the link to the form on the card');
  await page.close();

  // 3c) FIGURES THE PAGE CANNOT WORK OUT ARE NEVER CALLED PAID. With no price
  // snapshot and a rates row missing its parts, the totals come out NaN, and every
  // comparison against NaN is false — so "is anything owed?" answered no and the
  // card read "Paid in full" over a stay the server says is part-paid. The server's
  // own payment state decides then; the figure shows as £— rather than a guess.
  page = await openPage({ name: 'Odd Figures', email: 'odd@x.co' }, [mk('jollyboat', d(6), d(9), { payment: 'deposit', pay_token: 'tokn' })]);
  h = await hub(page);
  ok(h && !/Paid in full/.test(h.fig) && h.say !== 'Nothing more to pay', `unknown figures on a part-paid stay are not called paid (${h && h.fig} · ${h && h.say})`);
  await page.close();
  page = await openPage({ name: 'Odd Paid', email: 'oddp@x.co' }, [mk('jollyboat', d(6), d(9), { payment: 'paid' })]);
  h = await hub(page);
  ok(h && /^Paid in full/.test(h.fig) && /paid up|all set/i.test(h.next), `…and the server's "paid" still reads paid, the block and the journey agreeing (${h && h.fig} · ${h && h.next.slice(0, 30)})`);
  await page.close();

  // 4) Tomorrow wording at +1 day.
  page = await openPage({ name: 'Soon Guest', email: 's@x.co' }, [mk('21a', d(1), d(3), { payment: 'unpaid', pay_token: 'tok2' })]);
  h = await hub(page);
  ok(h && h.badge === 'Tomorrow' && !/Tomorrow/.test(h.title), `+1 day reads Tomorrow on the badge, and the title does not say it again (${h && h.badge} / ${h && h.title})`);
  await page.close();

  // 5) Two upcoming stays → exactly one countdown card, for the soonest.
  page = await openPage({ name: 'Two Stays', email: 't@x.co' }, [
    mk('jollyboat', d(5), d(8), Object.assign({ payment: 'unpaid', pay_token: 'a' }, priced)),
    mk('21a', d(20), d(23), Object.assign({ payment: 'unpaid', pay_token: 'b' }, priced)),
  ]);
  h = await hub(page);
  ok(h && h.count === 1 && h.n === '5', `only the soonest upcoming stay gets the countdown card (count ${h && h.count}, days ${h && h.n})`);
  const later = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('#guest-bookings-list .guest-booking.gb2:not(.gb2-next)')];
    return { n: cards.length, tiles: cards.reduce((a, c) => a + c.querySelectorAll('.hub-tile').length, 0),
      heads: [...document.querySelectorAll('#guest-bookings-list .gb-hdr')].map((x) => x.textContent.trim()) };
  });
  ok(later.n === 1 && later.tiles === 0, `the later stay is an ordinary card, without the tiles (${later.n} card, ${later.tiles} tiles)`);
  ok(later.heads.includes('Your next stay') && later.heads.includes('Later stays'), `…under its own heading (${later.heads.join(' · ')})`);
  await page.close();

  // 6) Past-only guest → no countdown card.
  page = await openPage({ name: 'Past Guest', email: 'past@x.co' }, [mk('jollyboat', d(-30), d(-27), { payment: 'paid' })]);
  h = await hub(page);
  ok(h === null, 'a past-only guest gets no countdown card');
  await page.close();

  // 7) Logged out → no countdown card.
  page = await openPage(null, []);
  h = await hub(page);
  ok(h === null, 'logged out → no countdown card');
  await page.close();

  // Reads the guest My Stays classification: is the in-residence hub shown, and
  // which section (Upcoming vs Past stays) does the booking card land in.
  const stayState = (page) => page.evaluate(() => {
    const list = document.getElementById('guest-bookings-list');
    return {
      inStay: !!document.querySelector('.my-stay-hub'),
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
  ok(/Refundable deposit £50\.00/.test(money), `the card quotes the deposit actually taken (${money.slice(0, 120)})`);
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

  // 13) AN ARMED MONTHLY PLAN IS ARRANGED, NOT OWED. The money block states what is
  // left, the line names the plan (its monthly figure and next date), in the
  // arranged (info) tone, and the one button MANAGES the plan — it opens the pay
  // screen, which shows the schedule and the way to stop it. No Pay: offering to
  // take money the guest has already arranged asks them to do what they have done.
  const p700 = { agreed_total: 700, agreed_per_night: 233.33, agreed_nights: 3, agreed_nightly: 700, agreed_txn_fee: 0, agreed_txn_pct: 0, agreed_booking_fee: 0 };
  const armedPlan = (extra) => Object.assign({
    n: 3, per: 175, toGo: 350, next: d(20),
    dates: [
      { date: d(-10), state: 'done', fig: 175 },
      { date: d(20), state: 'next', fig: 175 },
      { date: d(50), state: 'todo', fig: 175 },
    ],
  }, extra || {});
  page = await openPage({ name: 'Cara Nunn', email: 'c@x.co' }, [mk('jollyboat', d(80), d(83), Object.assign({
    payment: 'deposit', deposit_paid: 350, pay_token: 'tok9', autopay_state: 'armed', autopay_plan: armedPlan(),
  }, p700))]);
  h = await hub(page);
  const due20 = await spoken(page, d(20));
  ok(h && h.fig === '£350.00 balance', `an armed plan states what is left (${h && h.fig})`);
  ok(h && h.say === `£175.00 monthly · next on ${due20}`, `…and the line names the plan, monthly figure and next date (${h && h.say})`);
  ok(h && h.tone === 'is-info', `…in the arranged tone, never a warning (${h && h.tone})`);
  ok(h && h.btn === 'Manage' && !h.accent && h.pays === 0, `the one button manages the plan — no Pay (${h && h.btn})`);
  ok(h && h.bar === '50%' && h.leg[0] === '£350.00 paid' && h.leg[1] === '£700.00 in all', `the bar is what is paid of the whole (${h && h.bar}: ${h && h.leg.join(' / ')})`);
  await page.close();

  // 14) A PLAN IN TROUBLE SAYS SO, WITH ITS FIX. A failed try ('retrying') turns
  // the line amber and the one button becomes "Update card" in the accent — the
  // same pay screen the failure email points at, where the why and the retry date
  // are told. A plan silently reading "arranged" the moment it needs the guest
  // would read as sorted.
  const troublePlan = (state, extra) => armedPlan(Object.assign({ state, why: 'The card was declined.' }, extra || {}));
  page = await openPage({ name: 'Cara Nunn', email: 'c@x.co' }, [mk('jollyboat', d(80), d(83), Object.assign({
    payment: 'deposit', deposit_paid: 350, pay_token: 'tok9', autopay_state: 'armed', autopay_plan: troublePlan('retrying', { retry: d(2) }),
  }, p700))]);
  h = await hub(page);
  ok(h && h.say === "A payment didn't go through" && h.tone === 'is-warn', `a failed try turns the line amber (${h && h.say} / ${h && h.tone})`);
  ok(h && h.btn === 'Update card' && h.accent, `…and the fix is the one accent button (${h && h.btn})`);
  ok(h && h.fig === '£350.00 balance', `…beside what is still owed (${h && h.fig})`);
  await page.close();

  // 15) STOPPED (the try cap): still trouble, still the fix — although
  // autopay_state is 'failed', the state that used to drop the guest to a bare Pay
  // button as though nothing had ever been arranged.
  page = await openPage({ name: 'Cara Nunn', email: 'c@x.co' }, [mk('jollyboat', d(80), d(83), Object.assign({
    payment: 'deposit', deposit_paid: 350, pay_token: 'tok9', autopay_state: 'failed', autopay_plan: troublePlan('stopped'),
  }, p700))]);
  h = await hub(page);
  ok(h && h.say === "A payment didn't go through" && h.btn === 'Update card', `a stopped plan reads as trouble with its fix, not a bare Pay (${h && h.say} · ${h && h.btn})`);
  await page.close();

  // 16) A SINGLE "one payment" consent in trouble has no schedule, but it must not
  // read as healthy — the failure email sends the guest here. Retrying keeps
  // autopay_state 'armed'; without the trouble rule that showed as arranged.
  page = await openPage({ name: 'Cara Nunn', email: 'c@x.co' }, [mk('jollyboat', d(80), d(83), Object.assign({
    payment: 'deposit', deposit_paid: 350, pay_token: 'tok9', autopay_state: 'armed', autopay_plan: null,
    autopay_trouble: { state: 'retrying', why: 'The card was declined.', fig: 350, retry: d(2) },
  }, p700))]);
  h = await hub(page);
  ok(h && h.tone === 'is-warn' && h.say === "A payment didn't go through", `a single trouble consent reads amber, never arranged (${h && h.say} / ${h && h.tone})`);
  ok(h && h.btn === 'Update card', `…with the fix (${h && h.btn})`);
  await page.close();

  // 17) THE NEXT figure is what will really be taken. After a payment made by hand
  // the plan payload shrinks each remaining row to min(per, what is left), so the
  // next collection is £60 — and calling that "£60.00 monthly" would misstate the
  // plan. The card and the pay screen say it one way (payPlanNext).
  const shrunk = armedPlan({ toGo: 60, dates: [
    { date: d(-10), state: 'done', fig: 175 },
    { date: d(20), state: 'next', fig: 60 },
    { date: d(50), state: 'todo', fig: 0 },
  ] });
  page = await openPage({ name: 'Cara Nunn', email: 'c@x.co' }, [mk('jollyboat', d(80), d(83), Object.assign({
    payment: 'deposit', deposit_paid: 640, pay_token: 'tok9', autopay_state: 'armed', autopay_plan: shrunk,
  }, p700))]);
  h = await hub(page);
  ok(h && h.say === `Next £60.00 on ${due20}` && !/monthly|£175/.test(h.say), `the next figure is what will be taken, not the ceiling (${h && h.say})`);
  ok(h && h.fig === '£60.00 balance', `…and it agrees with what is left (${h && h.fig})`);
  const payLine = await page.evaluate((p) => { const keep = payState.s; payState.s = { autopayPlan: p }; const line = payArmedPlanLine(); payState.s = keep; return line; }, shrunk);
  ok(payLine.indexOf(`Next £60.00 on ${due20}`) === 0, `the pay screen's armed line says it the same way (${payLine})`);
  await page.close();

  // 18) check_in_time is guest-supplied free text (enquiries.php clean() is
  // trim-only) and reaches the card's innerHTML — it must be escaped.
  page = await openPage({ name: 'Cara Nunn', email: 'c@x.co' }, [mk('jollyboat', d(80), d(83), Object.assign({
    payment: 'deposit', pay_token: 'tok9', check_in_time: '<img src=x onerror=window.__xss=1>',
  }, p700))]);
  const xss = await page.evaluate(() => ({
    fired: !!window.__xss,
    injected: !!document.querySelector('#guest-bookings-list img[src="x"], #guest-bookings-list [onerror]'),
    // The row mapper vets a time (chbTime) before anything renders it, so the
    // crafted value never reaches the card even as text; the default stands.
    time: /in 15:00/.test((document.querySelector('.gb2-next .gb2-addr') || {}).textContent || ''),
  }));
  ok(!xss.fired && !xss.injected && xss.time, `a crafted check-in time is refused, not injected — the card keeps the default (fired=${xss.fired}, img=${xss.injected}, default=${xss.time})`);
  await page.close();

  // 19) openPayView SUPERSEDE — the source carries the stamp guard so a slow
  // summary from an earlier open can't paint over a newer booking (a race that
  // could act on the wrong figures). Gated at source: the race itself is timing.
  const appSrc = require('fs').readFileSync(__dirname + '/app.js', 'utf8');
  ok(/const openStamp = \+\+payState\.openStamp;/.test(appSrc) && (appSrc.match(/if \(!openLive\(\)\) return;/g) || []).length >= 2,
    'openPayView captures a supersede stamp and bails after each await');

  // 20) THE DOOR CODE IS OFF THE PRE-ARRIVAL CARD (owner's ask — the timeline
  // row went with "Arrival details"). The server's gate is unchanged and still
  // gated in test-integration §18; what this asserts is that the pre-arrival
  // card says NOTHING about the code in ANY of the three states it could be
  // in — released, dated promise, held back — because the row that said it is
  // gone. The code still reaches the guest on the arrival-day HERO, which is a
  // card rather than a timeline row: §25 owns that, both ways.
  console.log('20) the door code is off the pre-arrival card in every state');
  {
    const states = [
      ['a released code', { door_code: '4826' }],
      ['a dated promise', { door_code_from: d(8) }],
      ['the held-back state', { door_code_pending: true }],
    ];
    for (const [what, extra] of states) {
      const p20 = await openPage({ name: 'Keysafe Kate', email: 'k@x.co' }, [
        mk('jollyboat', d(1), d(4), Object.assign({ name: 'Keysafe Kate', payment: 'paid', deposit_paid: 440, agreed_total: 440 }, extra)),
      ]);
      const t = await p20.evaluate(() => (document.getElementById('guest-bookings') || document.body).textContent);
      ok(!/Key safe code|key safe code appears|door code|Appears here once/i.test(t) && !/4826/.test(t),
        `${what} shows nothing on the pre-arrival card`);
      await p20.close();
    }
  }

  // 21) THE MONEY BLOCK — the figure, its line, one button, a bar of what is paid
  // and the breakdown folded under "Payment details". Every figure comes from the
  // derivations the card already trusts (displayGrand + guestPayCta), and the block
  // RECONCILES: paid + the figure asked = the stay's whole, the same whole the
  // folded breakdown states. Asserted as arithmetic, so no pounds are hardcoded
  // into the property.
  console.log('21) the money block');
  const gbp2 = (s) => Number(String(s).replace(/[^0-9.]/g, ''));
  const moneyOf = (pg) => pg.evaluate(() => {
    const c = document.querySelector('.gb2-next');
    const fold = c && c.querySelector('.gb2-fold .guest-price-box');
    return {
      fig: ((c.querySelector('.gbm-fig') || {}).textContent || '').trim(),
      say: ((c.querySelector('.gbm-s') || {}).textContent || '').trim(),
      leg: [...c.querySelectorAll('.gbm-leg span')].map((s) => s.textContent.trim()),
      bar: (c.querySelector('.gbm-bar > span') || { style: {} }).style.width || '',
      totals: fold ? [...fold.querySelectorAll('.price-row.total')].map((r) => r.textContent.replace(/\s+/g, ' ').trim()) : [],
      args: ((c.querySelector('.gbm-btn') || { getAttribute: () => '' }).getAttribute('data-args')) || '',
      next: ((c.querySelector('.bkflow-next') || {}).textContent || '').replace(/\s+/g, ' ').trim(),
    };
  });
  page = await openPage({ name: 'Road Guest', email: 'road@x.co' },
    [mk('jollyboat', d(20), d(23), Object.assign({ payment: 'unpaid', pay_token: 'tokt', balance_due_by: d(9),
      created_at: d(-5) + ' 10:00:00' }, priced, { agreed_booking_fee: 50 }))]);
  let mb = await moneyOf(page);
  ok(mb.fig === '£450.00 balance', `nothing paid yet: the whole stay, deposit included, is the figure (${mb.fig})`);
  ok(mb.leg[0] === '£0.00 paid' && mb.leg[1] === '£450.00 in all' && mb.bar === '0%', `…the bar empty beside it (${mb.leg.join(' / ')}, ${mb.bar})`);
  ok(mb.totals.some((t) => /£450\.00$/.test(t)), `the folded breakdown states the same whole (${mb.totals.join(' | ')})`);
  ok(/tokt/.test(mb.args), `the one button opens this stay's own pay screen (${mb.args})`);
  ok(mb.next === '', 'and the journey adds no second sentence about money — the block is the ask');
  await page.close();

  // 21b) …a settled stay: Paid in full, the bar full, nothing more to pay — and the
  // arrival details said ONCE, in the journey line beneath, not in the block too.
  page = await openPage({ name: 'Sent Guest', email: 'sent@x.co' },
    [mk('jollyboat', d(10), d(13), Object.assign({ payment: 'paid', arrival_on: d(7) }, priced))]);
  mb = await moneyOf(page);
  const arr7 = await spoken(page, d(7));
  ok(/^Paid in full/.test(mb.fig) && mb.bar === '100%' && mb.leg[0] === '£400.00 paid' && mb.leg[1] === '£400.00 in all',
    `a settled stay reads Paid in full, the bar full (${mb.fig} · ${mb.leg.join(' / ')})`);
  ok(mb.say === 'Nothing more to pay', `…its line asks nothing (${mb.say})`);
  ok(mb.next.indexOf('Your arrival details come on ' + arr7) !== -1 && !/arrival/i.test(mb.say),
    `…and the arrival date is said once, in the journey (${mb.next})`);
  await page.close();

  // 21c) part-paid: the paid figure and the figure asked SUM to the whole.
  page = await openPage({ name: 'Part Guest', email: 'part@x.co' },
    [mk('jollyboat', d(20), d(23), Object.assign({ payment: 'deposit', deposit_paid: 100, pay_token: 'toku' }, priced))]);
  mb = await moneyOf(page);
  ok(mb.fig === '£300.00 balance' && mb.leg[0] === '£100.00 paid' && mb.bar === '25%', `part-paid: the ledger's own split (${mb.fig} · ${mb.leg[0]} · ${mb.bar})`);
  ok(Math.abs(gbp2(mb.leg[0]) + gbp2(mb.fig) - gbp2(mb.leg[1])) < 0.005, `…and paid + still to pay = the whole (${mb.leg[0]} + ${mb.fig} = ${mb.leg[1]})`);
  await page.close();

  // 21d) THE HELD-BACK STATE adds nothing to the card — the code reaches the guest
  // on arrival day (§25's masked hero), which is the moment it matters.
  page = await openPage({ name: 'Pending Kate', email: 'pk@x.co' },
    [mk('jollyboat', d(10), d(13), Object.assign({ payment: 'paid', door_code_pending: true }, priced))]);
  ok(await page.evaluate(() => !/door code|key safe/i.test((document.querySelector('.gb2-next') || {}).textContent || '')),
    'door_code_pending adds nothing to the card');
  await page.close();

  // 22) THE REMOVED ASKS — "When will you arrive?" and the extras chips were
  // taken out of the companion card completely (owner's ask). Asserted as an
  // ABSENCE with the composers gone too: a stray call site would throw, and a
  // leftover stylesheet block would dress markup nothing renders.
  console.log('22) the removed asks stay removed');
  page = await openPage({ name: 'Gone Guest', email: 'gone@x.co' },
    [mk('jollyboat', d(10), d(13), Object.assign({ payment: 'paid', id: 4242 }, priced))]);
  const removed = await page.evaluate(() => ({
    slots: document.querySelectorAll('.gslots, .gslot, .gslot-row, .gslot-note').length,
    extras: document.querySelectorAll('.gxtra, .gxchip, .gxtra-row, .gxtra-note').length,
    words: /When will you arrive|Anything you'll need|Travel cot|Highchair|Firewood/i.test(
      (document.querySelector('.gb2-next') || {}).textContent || ''),
    fns: ['guestArrivalSlotsHtml', 'guestSetArrivalWindow', 'guestExtrasHtml', 'guestAskExtra', 'arrivalWindowLabel',
      'guestPreArrivalHubHtml', 'guestStayTimelineHtml', 'guestPlanBlockHtml']
      .filter((f) => typeof window[f] === 'function'),
  }));
  ok(removed.slots === 0 && removed.extras === 0, `no arrival-window or extras markup on the card (${removed.slots}/${removed.extras})`);
  ok(!removed.words, 'and none of their words survive in the card');
  ok(removed.fns.length === 0, `the composers are gone with them, the old hub's too (${removed.fns.join(', ') || 'none'})`);
  ok(await page.evaluate(() => !!document.querySelector('.gb2-next .gbm')),
    'the money block stands — only the asks went');
  await page.close();

  // 23) THE WEATHER STRIP — the stay's own days from the public forecast; a
  // failed or missing feed renders NOTHING (a blank strip claims nothing).
  console.log('23) the stay\'s weather');
  page = await openPage({ name: 'Wx Guest', email: 'wx@x.co' },
    [mk('jollyboat', d(3), d(6), Object.assign({ payment: 'paid' }, priced))]);
  let wx = await page.evaluate(() => {
    const el = document.querySelector('.gb2-next .gwx');
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
    const el = document.querySelector('.gb2-next .gwx');
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
  ok(await page.evaluate(() => !!document.querySelector('.gb2-next') && !document.querySelector('.gb2-next .gwx')), 'a far-out stay has no weather slot');
  await page.close();

  // 25) ARRIVAL DAY — the door-code hero on the in-residence card. Digits only
  // when the server released them; the held-back state masks the figure and
  // never invents digits.
  console.log('25) the arrival-day code hero');
  page = await openPage({ name: 'Hero Kate', email: 'hk@x.co' },
    [mk('jollyboat', d(0), d(3), Object.assign({ payment: 'paid', door_code: '7302' }, priced))], { at: todayAt(11, 0) });
  const hero = await page.evaluate(() => {
    const hub = document.querySelector('.my-stay-hub');
    const code = hub && hub.querySelector('.hub-code');
    return {
      fig: code ? (code.querySelector('.hub-code-fig') || {}).textContent : '',
      copy: code ? !!code.querySelector('.hub-code-copy') : false,
      locked: code ? code.classList.contains('is-locked') : true,
      sub: hub ? (hub.querySelector('.hub-sub') || {}).textContent : '',
    };
  });
  ok(hero.fig === '7302' && hero.copy && !hero.locked, `a released code is the hero, with Copy (${hero.fig})`);
  ok(!/you said/.test(hero.sub), `…and no arrival-time read-back — that ask is gone (${hero.sub.trim().slice(-34)})`);
  await page.close();
  page = await openPage({ name: 'Locked Kate', email: 'lk@x.co' },
    [mk('jollyboat', d(0), d(3), Object.assign({ payment: 'paid', door_code_pending: true }, priced))], { at: todayAt(11, 0) });
  const locked = await page.evaluate(() => {
    const code = document.querySelector('.my-stay-hub .hub-code');
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
  ok(await page.evaluate(() => !document.querySelector('.my-stay-hub .hub-code')),
    'mid-stay with nothing released → no code card at all');
  await page.close();

  // 26) THE STAY CARD — accent band + serif name, a spoken when-line, ONE money
  // block whose "Payment details" fold holds the same guestPriceBoxHtml rows, and
  // quiet links.
  console.log('26) the stay card');
  page = await openPage({ name: 'Card Guest', email: 'card@x.co' },
    [mk('jollyboat', d(20), d(23), Object.assign({ payment: 'paid', deposit_paid: 400 }, priced, { id: 5151 }))]);
  const card = await page.evaluate(() => {
    const c = document.querySelector('.guest-booking.gb2');
    if (!c) return null;
    return {
      band: !!c.querySelector('.gb2-band'),
      when: (c.querySelector('.gb2-when') || {}).textContent || '',
      fig: ((c.querySelector('.gbm-fig') || {}).textContent || '').trim(),
      leg: [...c.querySelectorAll('.gbm-leg span')].map((s) => s.textContent.trim()),
      det: ((c.querySelector('.gb2-payline') || {}).textContent || '').replace(/\s+/g, ' ').trim(),
      folded: (document.getElementById('gb2-fold-b5151') || {}).hidden,
      links: [...c.querySelectorAll('.gb2-links .btn-sm')].map((b) => b.textContent.trim()),
      tiles: [...c.querySelectorAll('.hub-tile span')].map((s) => s.textContent.trim()),
    };
  });
  ok(!!card && card.band, 'the card carries its cottage accent band');
  ok(card && /^\w{3} \d{1,2} \w{3}( \d{4})? – \w{3} \d{1,2} \w{3} \d{4}/.test(card.when) && /3 nights/.test(card.when) && /ref CHB-/.test(card.when),
    `the when-line is spoken — both weekdays, the year once — with nights + ref (${card && card.when.slice(0, 64)})`);
  ok(card && /^Paid in full/.test(card.fig) && card.leg[1] === '£400.00 in all', `the money block states the verdict and the whole (${card && card.fig} · ${card && card.leg.join(' / ')})`);
  ok(card && /^Payment details/.test(card.det) && card.folded === true, `the breakdown starts folded under "Payment details" (${card && card.det})`);
  await page.click('.gb2-payline');
  await page.waitForTimeout(150);
  const foldOpen = await page.evaluate(() => ({
    hidden: (document.getElementById('gb2-fold-b5151') || {}).hidden,
    exp: (document.querySelector('.gb2-payline') || { getAttribute: () => '' }).getAttribute('aria-expanded'),
    box: !!document.querySelector('#gb2-fold-b5151 .guest-price-box'),
    addr: /in 15:00 \/ out 10:00/.test((document.querySelector('.gb2-addr') || {}).textContent || ''),
  }));
  ok(foldOpen.hidden === false && foldOpen.exp === 'true' && foldOpen.box,
    'it opens to the SAME price-box rows (one composer, folded)');
  ok(foldOpen.addr, 'the address + in/out times live in the fold');
  ok(card && card.links.length >= 3 && card.links.includes('Invoice') && card.links.includes('Terms'),
    `the secondary actions are one quiet row (${card && card.links.join(' · ')})`);
  ok(card && card.tiles.includes('Welcome book') && !card.links.includes('Welcome book'),
    `the welcome book is a tile on this card, not a second link beside it (${card && card.links.join(' · ')})`);
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

  // ?review=<prop>&stars=N — the email's tap-a-star row. The link must land on
  // My Bookings with the REAL review form open and the rating already set: the
  // same gb2Star prefill the on-page star-tap performs, fired from the inbox.
  // (The arm poll retries while the cards render, so give it a beat.)
  page = await openPage({ name: 'Star Guest', email: 'star@x.co' },
    [mk('jollyboat', d(-6), d(-3), Object.assign({ payment: 'paid', deposit_paid: 400 }, priced))],
    { q: '?review=jollyboat&stars=4', noopen: true });
  await page.waitForTimeout(900);
  const starLink = await page.evaluate(() => ({
    view: (document.querySelector('.page-view.active') || {}).id || '',
    open: (document.getElementById('grf-jollyboat') || { style: {} }).style.display,
    stars: (document.getElementById('grf-stars-jollyboat') || {}).value || '',
    lit: document.querySelectorAll('.gb2-stars .gb2-star.is-on').length,
  }));
  ok(starLink.open === 'block' && starLink.stars === '4' && starLink.lit === 4,
    `the email's star link opens the form with the rating prefilled (${starLink.stars} stars, ${starLink.lit} lit, on ${starLink.view})`);
  await page.close();

  // 28) AN ARCHIVED COTTAGE'S BOOKING STILL RENDERS (reported live: the Annex
  // was archived, propertyMeta had no entry, and one undefined meta.name threw
  // mid-forEach — the guest's ENTIRE My Stays rendered empty, other cottages'
  // stays included). The server's JOIN still names an archived cottage
  // (property_name), so the card speaks that; the live booking beside it is never
  // collateral damage; Book again is withheld on a cottage with no page to land on.
  console.log('28) a booking at an archived cottage');
  page = await openPage({ name: 'George F', email: 'gf@x.co' }, [
    Object.assign(mk('theannex', d(30), d(33), Object.assign({ payment: 'unpaid', pay_token: 'ta' }, priced)), { property_name: 'The Annex' }),
    mk('jollyboat', d(60), d(63), Object.assign({ payment: 'paid', deposit_paid: 400 }, priced)),
    Object.assign(mk('theannex', d(-60), d(-57), Object.assign({ payment: 'paid', deposit_paid: 400 }, priced)), { property_name: 'The Annex' }),
  ]);
  const arch = await page.evaluate(() => ({
    cards: document.querySelectorAll('.guest-booking').length,
    names: [...document.querySelectorAll('.gb2-name')].map((n) => n.textContent.trim()),
    next: (document.querySelector('.gb2-next .gb2-name') || {}).textContent || '',
    money: !!document.querySelector('.gb2-next .gbm .gbm-btn'),
    again: document.querySelectorAll('.gb2-again').length,
    rebook: [...document.querySelectorAll('.gb2-links .btn-sm')].filter((b) => /Book again/.test(b.textContent)).length,
  }));
  ok(arch.cards === 3 && arch.names.some((n) => /The Annex/.test(n)) && arch.names.some((n) => /Jollyboat/.test(n)),
    `every stay renders — the archived cottage speaks the server's own name (${arch.names.join(' · ')})`);
  ok(/The Annex/.test(arch.next) && arch.money, `the countdown card and its money block stand for the archived cottage too (${arch.next.trim()})`);
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
  ok(/Nothing booked yet/i.test(newSay), `a genuinely new visitor still gets the welcome (${newSay.replace(/\s+/g, ' ').slice(0, 40)})`);
  const emptyBack = await openPage({ name: 'Been Before', email: 'bb@x.co' }, [], { completed: 2 });
  const backSay = await emptyBack.evaluate(() => (document.querySelector('.guest-empty') || {}).textContent || '');
  await emptyBack.close();
  ok(!/Nothing booked yet/i.test(backSay) && /Nothing booked at the moment/i.test(backSay),
    `a returning guest is not told they have never booked (${backSay.replace(/\s+/g, ' ').slice(0, 60)})`);
  ok(/reply to your confirmation email/i.test(backSay),
    '…and is given a way to ask about a stay they expected to see');

  // 31) THE TWO HEADER PILLS SIT ON ONE LINE — reported from a photo: "Call to
  // discuss is higher than account and settings". Their BOXES were always
  // identical; what differed was the content INSIDE them, because a <button>
  // uses the UA's line-height:normal while an <a> inherits the page's, so the
  // icon and label sat 3px apart. Asserted on the ICON, which is what the eye
  // actually compares, and swept across desktop widths.
  console.log('\n31) the account header pills line up');
  // 32) THE AMENITIES TILE. Asked for: an Amenities tab where "Things to do"
  // was, and Things to do moved past Contact host — so the ORDER is the
  // requirement and is asserted as such. The list it opens is the SAME store
  // the cottage page prints as pills (amenities-<k>), so a guest reads one
  // list whether they are browsing or staying; and a cottage with nothing
  // written up names a person rather than asserting the cottage has none.
  console.log('\n32. Amenities on the stay');
  const amPage = await openPage({ name: 'Amy Nunn', email: 'amy@x.co' }, [mk('jollyboat', d(9), d(12), Object.assign({ payment: 'paid' }, priced))]);
  const amv = await amPage.evaluate(async () => {
    const el = document.querySelector('.gb2-next');
    const labels = [...el.querySelectorAll('.hub-tile span')].map((s) => s.textContent.trim());
    // With a list written up.
    siteContent['amenities-jollyboat'] = ['Wood-burning stove', 'Walled courtyard', 'Sea view'];
    openAmenitiesModal('jollyboat');
    const m = document.getElementById('amenities-modal');
    const pills = [...m.querySelectorAll('.amenity-pill .amenity-text')].map((p) => p.textContent.trim());
    const filled = { open: m.classList.contains('open'), title: (document.getElementById('amenities-modal-title') || {}).textContent || '', pills };
    closeAmenitiesModal();
    // With nothing written up.
    delete siteContent['amenities-jollyboat'];
    const had = (propertyContent.jollyboat || {}).amenities;
    if (propertyContent.jollyboat) propertyContent.jollyboat.amenities = [];
    openAmenitiesModal('jollyboat');
    const emptyTxt = (document.getElementById('amenities-modal-list') || {}).textContent || '';
    const emptyAsk = !!m.querySelector('[data-act="toggleChat"]');
    closeAmenitiesModal();
    if (propertyContent.jollyboat) propertyContent.jollyboat.amenities = had;
    return { labels, filled, empty: { txt: emptyTxt.trim(), ask: emptyAsk }, shut: !m.classList.contains('open') };
  });
  ok(JSON.stringify(amv.labels) === JSON.stringify(['Directions', 'House rules', 'Welcome book', 'Amenities', 'Contact host', 'Things to do']),
    `the tiles read in the asked-for order (${amv.labels.join(' · ')})`);
  ok(amv.filled.open && /Jollyboat/.test(amv.filled.title), `the tile opens a sheet named for the cottage (${amv.filled.title.trim()})`);
  ok(JSON.stringify(amv.filled.pills) === JSON.stringify(['Wood-burning stove', 'Walled courtyard', 'Sea view']),
    `it prints the cottage's own saved list as pills (${amv.filled.pills.join(', ')})`);
  ok(!/no amenities|nothing in|none/i.test(amv.empty.txt) && amv.empty.ask,
    `an unwritten list names a person, never "no amenities" ("${amv.empty.txt.slice(0, 70)}")`);
  ok(amv.shut, 'Close shuts it');
  await amPage.close();

  // 33) HOUSE RULES took the "Good to know" tile. Asked for after a screenshot
  // of that sheet EMPTY on the customer's own screen — a cottage with no FAQs
  // written up opened a sheet with nothing in it. House rules cannot be empty:
  // check-in, checkout and the guest limit are facts every cottage has, so the
  // guest always gets an answer. The list is the cottage page's OWN derivation,
  // so the two surfaces cannot state different times.
  console.log('\n33. House rules on the stay');
  const hrPage = await openPage({ name: 'Rue Marsden', email: 'rue@x.co' }, [mk('jollyboat', d(8), d(11), Object.assign({ payment: 'paid' }, priced))]);
  const hrv = await hrPage.evaluate(async () => {
    propertyRates.jollyboat = Object.assign({}, propertyRates.jollyboat || {}, { checkInTime: '16:00', checkOutTime: '09:30' });
    occupancyLimits.jollyboat = { maxAdults: 2, maxChildren: 0, maxTotal: 2 };
    siteContent['houserules-jollyboat'] = ['No smoking indoors', 'Quiet after 10pm — the lane carries sound'];
    openHouseRulesModal('jollyboat');
    const m = document.getElementById('houserules-modal');
    const lines = [...m.querySelectorAll('.hr-line span')].map((s) => s.textContent.trim());
    const out = {
      open: m.classList.contains('open'),
      title: (document.getElementById('houserules-modal-title') || {}).textContent || '',
      lines,
      // The SAME derivation the cottage page prints — asserted as equality, so
      // a second definition cannot appear without failing here.
      matchesPage: JSON.stringify(lines) === JSON.stringify(guestHouseRuleList('jollyboat')),
    };
    closeHouseRulesModal();
    // With NO rules written up the settings lines still stand on their own.
    delete siteContent['houserules-jollyboat'];
    const had = DEFAULT_HOUSE_RULES.slice();
    DEFAULT_HOUSE_RULES.length = 0;
    openHouseRulesModal('jollyboat');
    out.bare = [...m.querySelectorAll('.hr-line span')].map((s) => s.textContent.trim());
    closeHouseRulesModal();
    DEFAULT_HOUSE_RULES.push(...had);
    out.shut = !m.classList.contains('open');
    return out;
  });
  ok(hrv.open && /Jollyboat/.test(hrv.title), `the tile opens a sheet named for the cottage (${hrv.title.trim()})`);
  ok(hrv.lines[0] === 'Check-in after 16:00' && hrv.lines[1] === 'Checkout before 09:30' && hrv.lines[2] === '2 guests maximum',
    `it leads with the times this cottage really enforces (${hrv.lines.slice(0, 3).join(' · ')})`);
  ok(hrv.lines.includes('No smoking indoors') && hrv.lines.includes('Quiet after 10pm — the lane carries sound'),
    `…then the owner's own rules (${hrv.lines.length} lines)`);
  ok(hrv.matchesPage, 'the sheet and the cottage page read ONE derivation');
  ok(hrv.bare.length === 3, `with nothing written up it is still not empty (${hrv.bare.length} lines) — the defect this replaced`);
  ok(hrv.shut, 'Close shuts it');
  await hrPage.close();

  // The stay page opens FROM You now, so it carries ONE control: "‹ You". Calling us
  // lives on the You page's Help group, where the other ways to reach us are.
  const pillPage = await openPage({ name: 'Pill Guest', email: 'pill@x.co' }, []);
  await pillPage.setViewportSize({ width: 1280, height: 900 });
  await pillPage.waitForTimeout(200);
  const pill = await pillPage.evaluate(() => ({
    acct: !!document.getElementById('acct-settings-btn'),
    call: !!document.getElementById('acct-call-btn'),
    label: ((document.getElementById('acct-settings-btn') || {}).textContent || '').trim(),
  }));
  ok(pill.acct && !pill.call && pill.label === 'You', `the stay page leads with one way back to You (${pill.label})`);
  await pillPage.close();

  // 34) THE CHECK-OUT TAP. The button exists on the LAST MORNING only (clock
  // pinned 08:30 — after the checkout hour the in-residence card itself stands
  // down, so the button's whole life is that window); it asks first; the tick
  // renders after the confirmed tap; and a mid-stay card renders EXACTLY as
  // today — no block at all, because nothing depends on this feature.
  console.log('\n34. The check-out tap');
  const coAt = new Date(now()); coAt.setHours(8, 30, 0, 0);
  let coPage = await openPage({ name: 'Tap Guest', email: 'tap@x.co' },
    [mk('jollyboat', d(-2), d(0), Object.assign({ payment: 'paid', deposit_paid: 400 }, priced))],
    { at: coAt });
  const coPosts = [];
  let coTapped = false;
  await coPage.route('**/guest-checkout.php*', (route) => {
    let body = {};
    try { body = JSON.parse(route.request().postData() || '{}'); } catch (e) {}
    coPosts.push(body);
    coTapped = true;
    return route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ ok: true, at: d(0) + ' 08:31:00' }) });
  });
  // The app trusts the REFETCH as the record — after the tap, my-bookings
  // answers with the stamped row, exactly as the real server does.
  await coPage.route('**/my-bookings.php*', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ ok: true, enquiries: [], completed_stays: 0,
      bookings: [Object.assign(mk('jollyboat', d(-2), d(0), Object.assign({ payment: 'paid', deposit_paid: 400 }, priced)),
        coTapped ? { guest_checked_out_at: d(0) + ' 08:31:00' } : {})] }),
  }));
  const co1 = await coPage.evaluate(() => ({
    block: !!document.querySelector('.my-stay-hub .hub-checkout'),
    btn: (document.querySelector('.hub-co-btn') || {}).textContent || '',
    tick: !!document.querySelector('.hub-checkout.is-done'),
  }));
  ok(co1.block && /We've left the cottage/.test(co1.btn) && !co1.tick,
    `the last morning carries the button (${co1.btn.trim()})`);
  // THE CARD AGREES WITH THE HUB ABOVE IT. bookingFlow's `inStay` was
  // `!past && hasCheckedIn` with `past` DATE-based, so on this very morning —
  // the hub reading "Checkout today", the button offering "We've left" — the
  // card's next-step sentence judged the stay already over and printed "we
  // can't wait to welcome you", the sentence the in-stay branch exists to stop
  // (final review). It reads the hub's own predicate now: arrived by date, not
  // departed by TIME. This fixture is paid AND priced, so the pay branch cannot
  // mask the case the way an unpriced one would.
  const coNext = await coPage.evaluate(() => (document.querySelector('.bkflow-next') || {}).textContent || '');
  ok(!/welcome you|nearer the time/i.test(coNext) && /checkout|everything you need/i.test(coNext),
    `…and the card's next step speaks about NOW, not the arrival (${JSON.stringify(coNext.trim().slice(0, 70))})`);
  // The tap ASKS first — and "Not yet" sends nothing.
  await coPage.click('.hub-co-btn');
  await coPage.waitForTimeout(300);
  const coAsk = await coPage.evaluate(() => ({
    open: document.getElementById('glass-dialog').classList.contains('open'),
    msg: (document.getElementById('glass-dialog-msg') || {}).textContent || '',
    ok: (document.getElementById('glass-dialog-ok') || {}).textContent || '',
  }));
  ok(coAsk.open && /Have you left the cottage\?/.test(coAsk.msg) && /we've left/i.test(coAsk.ok),
    `it asks first and names the consequence (${coAsk.ok.trim()})`);
  await coPage.click('#glass-dialog-cancel');
  await coPage.waitForTimeout(250);
  ok(coPosts.length === 0, 'backing out sends nothing');
  // The real tap: confirm → the write → the tick state replaces the button.
  await coPage.click('.hub-co-btn');
  await coPage.waitForTimeout(250);
  await coPage.click('#glass-dialog-ok');
  await coPage.waitForTimeout(600);
  const co2 = await coPage.evaluate(() => ({
    tick: !!document.querySelector('.hub-checkout.is-done'),
    words: (document.querySelector('.hub-checkout.is-done') || {}).textContent || '',
    btn: !!document.querySelector('.hub-co-btn'),
  }));
  ok(coPosts.length === 1 && coPosts[0].action === 'left' && /^gco-\d+-\d{4}-\d{2}-\d{2}$/.test(coPosts[0].op_id || ''),
    `the confirmed tap posts once with the deterministic op id (${coPosts[0] && coPosts[0].op_id})`);
  ok(co2.tick && !co2.btn && /Safe travels home/.test(co2.words) && /8:31am/.test(co2.words),
    `…and the tick replaces the button with the recorded time (${co2.words.trim().slice(0, 60)})`);
  await coPage.close();
  // Mid-stay: NO block at all — an untapped, un-final morning renders exactly
  // as it did before this feature existed.
  coPage = await openPage({ name: 'Mid Stay', email: 'mid@x.co' },
    [mk('jollyboat', d(-1), d(3), Object.assign({ payment: 'paid', deposit_paid: 400 }, priced))],
    { at: coAt });
  ok(await coPage.evaluate(() => !document.querySelector('.hub-checkout')),
    'a mid-stay card carries no check-out block at all');
  await coPage.close();
  // Already tapped (the payload says so): the tick renders directly, no button.
  coPage = await openPage({ name: 'Done Guest', email: 'done@x.co' },
    [Object.assign(mk('jollyboat', d(-2), d(0), Object.assign({ payment: 'paid', deposit_paid: 400 }, priced)),
      { guest_checked_out_at: d(0) + ' 07:55:00' })],
    { at: coAt });
  const co3 = await coPage.evaluate(() => ({
    tick: !!document.querySelector('.hub-checkout.is-done'),
    btn: !!document.querySelector('.hub-co-btn'),
    words: (document.querySelector('.hub-checkout.is-done') || {}).textContent || '',
  }));
  ok(co3.tick && !co3.btn && /7:55am/.test(co3.words),
    `a stay already tapped renders the tick straight from the payload (${co3.words.trim().slice(0, 50)})`);
  await coPage.close();

  console.log(fails ? `\n  ${fails} YOUR-STAY CHECK(S) FAILED ❌` : '\n  YOUR-STAY SUITE PASSED ✅');
  await done(fails);
})();
