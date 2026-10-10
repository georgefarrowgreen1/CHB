// THE ADD / EDIT BOOKING SHEET, driven in a real browser.
//
// The sectioned form (four sections, a summary strip, a sticky money foot) was
// superseded by ONE sheet: `#edit-modal .modal-box.bks` in index.html, painted by
// admin.js's ADD-BOOKING SHEET block (bksSync) from the hidden `#modal-*` inputs,
// which are still the form's STORE. Every check here is a behaviour the sheet
// documents (CLAUDE.md "Add or edit a booking: one sheet"), and every save is
// read off the REAL POST body saveModal sends — the payload is the contract the
// server keeps, so a check on what the sheet SHOWS alone could pass over a save
// that loses data.
//
// Reduced motion is emulated on purpose: the folds then open and close without a
// transition and the sheet's own timers run at 0ms, so the suite measures the
// RESTING sheet and every wait below is on state, never a clock.
const { d, boot } = require('./ui-test-lib'); // pins TZ=Europe/London at require time
let fails = 0;
const ok = (b, m) => { console.log(`  ${b ? '✓' : '✗'} ${m}`); if (!b) fails++; };

(async () => {
  const { page, base, done } = await boot({ viewport: { width: 390, height: 844 } });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const json = (route, o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
  const mk = (id, over = {}) => Object.assign({
    id, prop_key: 'jollyboat', name: 'Booked Guest', email: 'g@gmail.com', phone: '', address: '', postcode: '',
    check_in: d(30), check_out: d(33), check_in_time: '15:00', check_out_time: '10:00',
    adults: 2, children: 0, notes: '', payment: 'unpaid', deposit_paid: 0, payment_method: '', payment_date: '',
    agreed_total: 450, agreed_per_night: 150, agreed_nights: 3, agreed_nightly: 450,
    agreed_booking_fee: 75, agreed_txn_pct: 0, agreed_txn_fee: 0, agreed_on: d(-30) + ' 12:00:00',
    hold_status: 'none', created_at: d(-30) + ' 12:00:00',
  }, over);
  const rows = [
    mk(1), // the blocker: Jollyboat d30→d33
    mk(2, { name: 'Next Arrival', email: 'next@gmail.com', check_in: d(50), check_out: d(53) }),
    // Part-paid, upcoming — the EDIT case.
    mk(4, { name: 'Edith Partpaid', email: 'edith@x.co', check_in: d(60), check_out: d(63), payment: 'deposit', deposit_paid: 100, payment_method: 'Bank transfer', payment_date: d(-5) }),
    // Paid in full (the £50 cash deposit on top) — the PAID LOCK.
    mk(5, { prop_key: '21a', name: 'Paula Paidup', email: 'paula@x.co', check_in: d(70), check_out: d(72), payment: 'paid', deposit_paid: 310, payment_method: 'Cash', payment_date: d(-3), agreed_total: 260, agreed_per_night: 130, agreed_nights: 2, agreed_nightly: 260, agreed_booking_fee: 50 }),
    // Arrived yesterday — the MOVE LOCK.
    mk(6, { prop_key: 'pimpernel', name: 'Arno Arrived', email: 'arno@x.co', check_in: d(-1), check_out: d(2), payment: 'deposit', deposit_paid: 100, payment_method: 'Card', payment_date: d(-9), agreed_total: 420, agreed_per_night: 140, agreed_nightly: 420, agreed_booking_fee: 60 }),
    // A hostile-length name for the fit checks.
    mk(7, { prop_key: '21a', name: 'Alexandrina Featherstonehaugh-Smythe-Worthington', email: 'alex@x.co', check_in: d(100), check_out: d(103), agreed_total: 390, agreed_per_night: 130, agreed_nightly: 390, agreed_booking_fee: 50 }),
  ];
  const posts = [];
  await page.route(/\.php/, (route) => {
    const req = route.request();
    const url = req.url();
    if (req.method() === 'POST') {
      let b = {};
      try { b = JSON.parse(req.postData() || '{}'); } catch (e) {}
      b.__url = url.split('/').pop().split('?')[0];
      posts.push(b);
      return json(route, { ok: true, blocks: [] });
    }
    // Force every read down its own endpoint, so the fixture below is the only truth.
    if (url.includes('admin-bootstrap.php')) return json(route, { ok: false });
    if (url.includes('auth.php')) return json(route, { admin: true, admin_id: 1 });
    if (url.includes('bookings.php')) return json(route, { bookings: rows });
    if (url.includes('rates.php')) {
      const p = (k, name, rate, dep, sort) => ({ prop_key: k, name, slug: k, couple_rate: rate, extra_adult_rate: 20, child_rate: 10, booking_fee: dep, transaction_pct: 0, lastmin_pct: 0, lastmin_days: 0, sort_order: sort });
      return json(route, {
        properties: [p('jollyboat', 'Jollyboat', 150, 75, 1), p('21a', '21A Westgate', 130, 50, 2), p('pimpernel', 'Pimpernel', 140, 60, 3)],
        seasons: {},
        // occupancyLimits is copied VERBATIM from this map — without it the
        // offline caps (Jollyboat sleeps 2) would decide the party checks.
        occupancy: {
          jollyboat: { maxAdults: 4, maxChildren: 2, maxTotal: 4 },
          '21a': { maxAdults: 2, maxChildren: 0, maxTotal: 2 },
          pimpernel: { maxAdults: 3, maxChildren: 1, maxTotal: 3 },
        },
      });
    }
    return json(route, { ok: true, bookings: [], enquiries: [], properties: [], seasons: {}, occupancy: {}, content: {}, blocks: [], ranges: [], payments: [] });
  });
  await page.goto(`${base}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => { isAuthenticated = true; document.body.classList.add('owner-mode'); });
  await page.evaluate(() => window.loadAdminBundle());
  await page.waitForFunction(() => window.__ADMIN_LOADED === true && typeof window.bksSync === 'function');
  await page.evaluate(() => loadData());
  await page.waitForFunction(() => (dbBookings.jollyboat || []).length === 3 && occupancyLimits.jollyboat.maxAdults === 4);

  // ---------- helpers ----------
  const S = (fn, a) => page.evaluate(fn, a);
  const isOpen = () => S(() => document.getElementById('edit-modal').classList.contains('open'));
  const sheetUp = () => page.waitForFunction(() => {
    const m = document.getElementById('edit-modal');
    const box = m && m.querySelector('.modal-box.bks');
    return m.classList.contains('open') && box && box.getBoundingClientRect().height > 200;
  });
  const openAdd = async () => { await S(() => window.openAddBooking()); await sheetUp(); };
  const openEdit = async (id) => { await S((x) => window.openEditBooking(x), id); await sheetUp(); };
  const closeSheet = async () => { await S(() => closeModal()); await page.waitForFunction(() => !document.getElementById('edit-modal').classList.contains('open')); };
  const val = (id) => S((x) => (document.getElementById(x) || {}).value, id);
  const txt = (id) => S((x) => ((document.getElementById(x) || {}).textContent || '').replace(/\s+/g, ' ').trim(), id);
  const calOpen = () => S(() => document.getElementById('bks-cal-fold').classList.contains('on'));
  // A day on the sheet's own calendar: turn the months until it is painted, then
  // TAP it — the real route (bksDay), never a write to the hidden inputs.
  const pickDay = async (iso) => {
    for (let i = 0; i < 14; i++) {
      const cell = await page.$(`#bks-cal [data-bks="day"][data-v="${iso}"]`);
      if (cell) { await cell.click(); return; }
      await page.click('#bks-cal [data-bks="nav"][data-v="1"]');
    }
    throw new Error('the calendar never showed ' + iso);
  };
  const pickStay = async (ci, co) => {
    if (!(await calOpen())) await page.click('#bks-t-in');
    await page.waitForFunction(() => document.getElementById('bks-cal-fold').classList.contains('on'));
    await pickDay(ci);
    await pickDay(co);
    await page.waitForFunction(() => !document.getElementById('bks-cal-fold').classList.contains('on')); // a finished stay folds the calendar away
  };
  // Playwright treats aria-disabled as "not enabled" and would wait for ever; the
  // owner's finger does not — a not-ready Add is still tappable and NUDGES.
  const tapAdd = () => page.click('#modal-save-btn', { force: true });
  const lastPost = (action, from) => posts.slice(from).filter((p) => p.__url === 'bookings.php' && p.action === action).pop() || null;
  const saveAndWait = async (action) => {
    const from = posts.length;
    await tapAdd();
    await page.waitForFunction(() => !document.getElementById('edit-modal').classList.contains('open'), null, { timeout: 8000 }).catch(() => {});
    return lastPost(action, from);
  };
  const spoken = (iso) => S((x) => dpSpoken(x), iso);
  const r2 = (x) => Math.round(x * 100) / 100;

  // ---------- 1. Add opens the sheet ----------
  console.log('1. the Add sheet');
  await openAdd();
  const s1 = await S(() => {
    const btn = document.getElementById('modal-save-btn');
    return {
      sheet: !!document.querySelector('#edit-modal .modal-box.bks'),
      title: document.getElementById('modal-title').textContent.trim(),
      btn: btn.textContent.trim(),
      dis: btn.getAttribute('aria-disabled'),
      sum: document.getElementById('bks-sum').textContent,
      tiles: [document.getElementById('bks-t-in-d').textContent, document.getElementById('bks-t-out-d').textContent],
      times: [document.getElementById('bks-t-in-tm').textContent, document.getElementById('bks-t-out-tm').textContent],
      hiddenTimes: [document.getElementById('modal-checkin-time').value, document.getElementById('modal-checkout-time').value],
      cot: document.getElementById('bks-cot-val').textContent.trim(),
      verdictHidden: document.getElementById('bks-verdict').hidden,
      oldForm: !!document.querySelector('#edit-modal .modal-foot, #edit-modal .mav-strip, #edit-modal .modal-cols, #modal-date-verdict'),
    };
  });
  ok(s1.sheet && !s1.oldForm && s1.title === 'New booking' && s1.btn === 'Add', `Add opens the one sheet (no sectioned form left) — "New booking", the button says Add (${s1.title} / ${s1.btn})`);
  ok(s1.dis === 'true' && /no dates yet/.test(s1.sum), `with no dates or name, Add is aria-disabled and the summary says so (${s1.sum})`);
  ok(s1.tiles.join('|') === 'Add a date|Add a date' && s1.verdictHidden && s1.times.join('|') === 'from 3pm|by 10am' && s1.hiddenTimes.join('|') === '15:00|10:00',
    `the Arrive | Leave tiles ask for dates and STATE 3pm in / 10am out, which the store still carries (${s1.times.join(', ')})`);
  ok(s1.cot === 'Jollyboat', `a new booking starts on the first real cottage (${s1.cot})`);

  // ---------- 2. nudges, the calendar, the verdict ----------
  console.log('2. nudges + the calendar + ✓ Free');
  const p0 = posts.length;
  await tapAdd();
  await page.waitForFunction(() => document.getElementById('bks-cal-fold').classList.contains('on'));
  const n1 = await S(() => ({
    sum: document.getElementById('bks-sum').textContent,
    arriveOn: document.getElementById('bks-t-in').getAttribute('aria-expanded'),
  }));
  ok(posts.length === p0, 'tapping a not-ready Add sends nothing');
  ok(/Pick the dates first/.test(n1.sum) && n1.arriveOn === 'true', `…it opens the calendar on Arrive and says what is missing (${n1.sum})`);
  // Each free night carries its price; a taken night is crossed and carries none.
  for (let i = 0; i < 14 && !(await page.$(`#bks-cal [data-v="${d(31)}"]`)); i++) await page.click('#bks-cal [data-bks="nav"][data-v="1"]');
  const cal = await S((f) => {
    const cell = (iso) => document.querySelector(`#bks-cal [data-bks="day"][data-v="${iso}"]`);
    const free = cell(f.free), taken = cell(f.taken);
    const want = bksGbp0(nightlyRateFor(f.free, propertyRates.jollyboat, propertySeasons.jollyboat || []));
    return {
      freePrice: free && free.querySelector('small') ? free.querySelector('small').textContent : '',
      want,
      takenCls: !!taken && taken.classList.contains('taken'),
      takenPrice: !!taken && !!taken.querySelector('small'),
      takenPickable: !!taken && !taken.disabled,
      label: taken ? taken.getAttribute('aria-label') : '',
    };
  }, { free: d(36), taken: d(31) });
  ok(cal.freePrice !== '' && cal.freePrice === cal.want, `a free night shows its price, nightlyRateFor's own figure (${cal.freePrice} = ${cal.want})`);
  ok(cal.takenCls && !cal.takenPrice && cal.takenPickable && /booked by Booked Guest/.test(cal.label),
    `a taken night is crossed, unpriced, still pickable and says who has it (${cal.label})`);
  await pickStay(d(40), d(43));
  const s2 = await S(() => ({
    ci: document.getElementById('modal-checkin').value,
    co: document.getElementById('modal-checkout').value,
    tin: document.getElementById('bks-t-in-d').textContent,
    verdict: document.getElementById('bks-verdict').textContent.replace(/\s+/g, ' ').trim(),
    freeCap: !!document.querySelector('#bks-verdict .bks-sc.ok'),
    dis: document.getElementById('modal-save-btn').getAttribute('aria-disabled'),
  }));
  const nextSpoken = await spoken(d(50));
  ok(s2.ci === d(40) && s2.co === d(43) && s2.tin === (await spoken(d(40))), `the calendar writes the store, the tile speaks the date (${s2.ci} → ${s2.co}, "${s2.tin}")`);
  ok(/^3 nights/.test(s2.verdict) && s2.freeCap && /✓ Free/.test(s2.verdict) && s2.verdict.includes('next arrival ' + nextSpoken),
    `free dates → the verdict says ✓ Free, with the next arrival (${s2.verdict})`);
  await S(() => { if (document.activeElement) document.activeElement.blur(); });
  const p1 = posts.length;
  await tapAdd();
  await page.waitForFunction(() => document.activeElement && document.activeElement.id === 'modal-name');
  ok(s2.dis === 'true' && posts.length === p1 && /Add the guest.s name/.test(await txt('bks-sum')),
    `dates alone are not ready: Add focuses the name and says so (${await txt('bks-sum')})`);
  await page.fill('#modal-name', 'Sally Standard');
  ok((await S(() => document.getElementById('modal-save-btn').getAttribute('aria-disabled'))) === 'false', 'a name + dates make Add ready');

  // ---------- 3. the confirmation switch, and a standard save ----------
  console.log('3. the confirmation switch + a standard Add');
  const c0 = await S(() => ({ dis: document.getElementById('bks-conf').disabled, sub: document.getElementById('bks-conf-s').textContent }));
  ok(c0.dis && /Add an email address/.test(c0.sub), `with no email the switch cannot send, and says why (${c0.sub})`);
  await page.fill('#modal-email', 'sally@x.co');
  const c1 = await S(() => ({ on: document.getElementById('bks-conf').checked, dis: document.getElementById('bks-conf').disabled, label: document.getElementById('bks-conf-l').textContent, sub: document.getElementById('bks-conf-s').textContent }));
  ok(c1.on && !c1.dis && /Email Sally the confirmation/.test(c1.label) && /sally@x\.co/.test(c1.sub),
    `on Add the confirmation switch is ON by default, naming who and where (${c1.label} · ${c1.sub})`);
  const a1 = await saveAndWait('add');
  const closed = !(await isOpen());
  ok(!!a1 && closed && a1.prop_key === 'jollyboat' && a1.check_in === d(40) && a1.check_out === d(43) && a1.name === 'Sally Standard' && a1.email === 'sally@x.co',
    `Add posts the stay and the sheet closes (${a1 && [a1.prop_key, a1.check_in, a1.check_out, a1.name].join(' · ')})`);
  ok(!!a1 && a1.price_override === '' && a1.price_reason === '' && a1.send_confirmation === true && a1.payment === 'unpaid',
    `a standard price posts no override, no reason, the confirmation ON (${a1 && JSON.stringify({ ov: a1.price_override, why: a1.price_reason, conf: a1.send_confirmation, pay: a1.payment })})`);

  // ---------- 4. an overlap, the free cottage that FITS, the party coming down ----------
  console.log('4. ⚠ Overlaps + a free cottage that fits + the party');
  await openAdd();
  await page.click('#edit-modal [data-act="modalStep"][data-arg="adults"][data-arg2="1"]'); // 2 → 3
  const adults3 = await val('modal-adults');
  await pickStay(d(31), d(34)); // overlaps Booked Guest on Jollyboat
  const s4 = await S(() => {
    const alt = document.querySelector('#bks-verdict [data-bks="alt"]');
    return {
      verdict: document.getElementById('bks-verdict').textContent.replace(/\s+/g, ' ').trim(),
      warn: !!document.querySelector('#bks-verdict .bks-sc.warn'),
      alt: alt ? alt.getAttribute('data-v') : '',
      altTxt: alt ? alt.textContent.trim() : '',
    };
  });
  ok(s4.warn && /Overlaps Booked Guest/.test(s4.verdict), `overlapping dates → ⚠ Overlaps, naming who (${s4.verdict})`);
  // 21A Westgate is free too but sleeps 2 — the offer skips it for the first that fits.
  ok(adults3 === '3' && s4.alt === 'pimpernel' && /Pimpernel is free/.test(s4.altTxt), `…offering the first free cottage that FITS the 3 adults (the + stepper took them there), not merely the next one (${s4.altTxt})`);
  await page.click('#bks-verdict [data-bks="alt"]');
  await page.waitForFunction(() => document.getElementById('modal-property').value === 'pimpernel');
  const s4b = await S(() => ({
    cot: document.getElementById('bks-cot-val').textContent.trim(),
    verdict: document.getElementById('bks-verdict').textContent.replace(/\s+/g, ' ').trim(),
    adults: document.getElementById('modal-adults').value,
  }));
  ok(s4b.cot === 'Pimpernel' && /✓ Free/.test(s4b.verdict) && s4b.adults === '3', `one tap moves the stay there and the verdict flips to ✓ Free (${s4b.cot} · ${s4b.verdict})`);
  // The list states each cottage's fit for THESE dates.
  await page.click('#bks-cot-row');
  await page.waitForFunction(() => document.getElementById('bks-cot-fold').classList.contains('on'));
  const caps = await S(() => Object.fromEntries([...document.querySelectorAll('#bks-cot-list .bks-opt')].map((o) => [o.getAttribute('data-v'), (o.querySelector('.bks-sc') || {}).textContent || ''])));
  ok(caps.jollyboat === 'Booked' && caps['21a'] === 'Too small' && caps.pimpernel === 'Free', `the cottage list says Booked / Too small / Free for these dates (${JSON.stringify(caps)})`);
  await page.click('#bks-cot-list .bks-opt[data-v="21a"]');
  await page.waitForFunction(() => document.getElementById('modal-property').value === '21a');
  const s4c = await S(() => ({
    adults: document.getElementById('modal-adults').value,
    note: document.getElementById('modal-occ-note').textContent,
    warn: document.getElementById('modal-occ-note').classList.contains('warn'),
  }));
  ok(s4c.adults === '2', `picking a cottage that sleeps fewer brings the party down WITH it (adults ${s4c.adults})`);
  // CLAUDE.md: "Picking a smaller cottage brings the party down and SAYS SO".
  ok(/came down/.test(s4c.note) && s4c.warn, `…and says so beside the party (note: "${s4c.note}")`);

  // ---------- 5. a custom price: always a TOTAL, re-derived as the stay moves ----------
  console.log('5. Standard | Custom');
  const std = (ci, co) => S((f) => priceBreakdown('21a', 2, 0, f.ci, f.co).total, { ci, co });
  const std3 = await std(d(31), d(34));
  await page.click('#bks-pmode [data-v="custom"]');
  await page.waitForFunction(() => document.getElementById('bks-cus-fold').classList.contains('on') && !!document.getElementById('bks-c-amt'));
  await page.fill('#bks-c-amt', '300');
  const c5a = await S(() => ({
    ov: document.getElementById('modal-price-override').value,
    res: document.getElementById('bks-c-res-l').textContent,
    doc: document.getElementById('bks-c-gs').textContent.replace(/\s+/g, ' '),
  }));
  ok(c5a.ov === '300', `"A total" writes the override as that total (${c5a.ov})`);
  ok(new RegExp('£' + (std3 - 300).toFixed(2) + ' off').test(c5a.res) && /Agreed price for your stay \(3 nights\)\s*£300\.00/.test(c5a.doc),
    `…states it against the standard £${std3.toFixed(2)} and shows the one coherent line the guest's documents print (${c5a.res})`);
  await page.click('#bks-cmode [data-v="night"]');
  await page.fill('#bks-c-amt', '95');
  ok((await val('modal-price-override')) === '285', `"A night" still stores a TOTAL — £95 × 3 = ${await val('modal-price-override')}`);
  await page.click('#bks-t-out');
  await page.waitForFunction(() => document.getElementById('bks-cal-fold').classList.contains('on'));
  await pickDay(d(35));
  await page.waitForFunction(() => !document.getElementById('bks-cal-fold').classList.contains('on'));
  ok((await val('modal-checkout')) === d(35) && (await val('modal-price-override')) === '380',
    `a night price FOLLOWS the stay: one more night re-derives the total (£95 × 4 = ${await val('modal-price-override')})`);
  const std4 = await std(d(31), d(35));
  await page.click('#bks-cmode [data-v="off"]');
  await page.click('#bks-c-off [data-bks="off"][data-v="10"]');
  ok((await val('modal-price-override')) === String(r2(std4 * 0.9)), `"10% off" stores 90% of the standard as the total (${await val('modal-price-override')} = 0.9 × £${std4.toFixed(2)})`);
  await page.click('#bks-t-out');
  await page.waitForFunction(() => document.getElementById('bks-cal-fold').classList.contains('on'));
  await pickDay(d(36));
  await page.waitForFunction(() => !document.getElementById('bks-cal-fold').classList.contains('on'));
  const std5 = await std(d(31), d(36));
  ok((await val('modal-price-override')) === String(r2(std5 * 0.9)), `…and the discount is re-derived when the standard moves (${await val('modal-price-override')} = 0.9 × £${std5.toFixed(2)})`);
  await page.click('#bks-why [data-v="Friends & family"]'); // the reason rides the save payload below
  // Standard drops the override; Custom brings the same price back (values carry).
  await page.click('#bks-pmode [data-v="std"]');
  const ovStd = await val('modal-price-override');
  await page.click('#bks-pmode [data-v="custom"]');
  ok(ovStd === '' && (await val('modal-price-override')) === String(r2(std5 * 0.9)), `Standard clears the override; Custom restores the same price (${JSON.stringify(ovStd)} → ${await val('modal-price-override')})`);
  // The confirmation switched OFF.
  await page.fill('#modal-name', 'Cara Custom');
  await page.fill('#modal-email', 'cara@x.co');
  await page.click('#bks-conf');
  // A TAP on the switch (the real checkbox sits over the drawn track). NB its
  // `input` event runs bksSync BEFORE `change` records the choice, and the
  // repaint writes the stale state straight back — see the report on this suite.
  ok((await S(() => document.getElementById('bks-conf').checked)) === false, 'a tap turns the confirmation switch off');
  const a2 = await saveAndWait('add');
  ok(!!a2 && a2.price_override === r2(std5 * 0.9) && a2.price_reason === 'Friends & family',
    `the save posts the TOTAL and the reason (${a2 && JSON.stringify({ ov: a2.price_override, why: a2.price_reason })})`);
  ok(!!a2 && a2.prop_key === '21a' && a2.adults === 2 && a2.check_out === d(36), `…on the cottage, party and stay the sheet shows (${a2 && [a2.prop_key, a2.adults, a2.check_out].join(' · ')})`);
  ok(!!a2 && a2.send_confirmation === false, `…and the switched-off confirmation posts send_confirmation: false (${a2 && a2.send_confirmation})`);

  // ---------- 6. an edit shows the money and never re-sends it ----------
  console.log('6. an EDIT');
  await openEdit('b4');
  const e1 = await S(() => {
    const vis = (id) => { const el = document.getElementById(id); return !!el && el.getClientRects().length > 0; };
    return {
      title: document.getElementById('modal-title').textContent.trim(),
      btn: document.getElementById('modal-save-btn').textContent.trim(),
      rcvd: vis('bks-rcvd-row') ? document.getElementById('bks-rcvd').textContent : '',
      payGroup: vis('modal-payment-group'),
      conf: document.getElementById('bks-conf').checked,
      confL: document.getElementById('bks-conf-l').textContent,
      confS: document.getElementById('bks-conf-s').textContent,
    };
  });
  ok(e1.title === 'Edith Partpaid' && e1.btn === 'Save', `an edit is titled with the guest and saves (${e1.title} / ${e1.btn})`);
  ok(e1.rcvd === '£100.00' && !e1.payGroup, `it shows "Received so far" (${e1.rcvd}) and offers no payment entry`);
  ok(!e1.conf && /Email Edith the changes/.test(e1.confL) && /Nothing they.d notice/.test(e1.confS), `nothing material changed → the switch stays off (${e1.confS})`);
  const u1 = await saveAndWait('update');
  const moneyKeys = u1 ? ['payment', 'deposit', 'payment_date', 'payment_method'].filter((k) => k in u1) : ['no update post'];
  ok(!!u1 && u1.id === 4 && moneyKeys.length === 0, `an edit posts NO payment fields — absent keeps what was received (${moneyKeys.join(',') || 'none'})`);
  ok(!!u1 && u1.price_override === '' && !('send_confirmation' in u1) && !lastPost('send_confirmation', posts.indexOf(u1)),
    'no override, no confirmation flag, and no confirmation email follows a plain edit');
  await openEdit('b4');
  await page.click('#bks-t-out');
  await page.waitForFunction(() => document.getElementById('bks-cal-fold').classList.contains('on'));
  await pickDay(d(64));
  await page.waitForFunction(() => !document.getElementById('bks-cal-fold').classList.contains('on'));
  const e2 = await S(() => ({ conf: document.getElementById('bks-conf').checked, sub: document.getElementById('bks-conf-s').textContent }));
  ok(e2.conf && /changed/.test(e2.sub), `moving the dates turns the switch ON by itself (${e2.sub})`);
  const fromE = posts.length;
  await tapAdd();
  await page.waitForFunction(() => !document.getElementById('edit-modal').classList.contains('open'), null, { timeout: 8000 }).catch(() => {});
  // The confirmation is posted AFTER the update lands and the sheet closes.
  for (let i = 0; i < 60 && !lastPost('send_confirmation', fromE); i++) await page.waitForTimeout(100);
  const u2 = lastPost('update', fromE), sc = lastPost('send_confirmation', fromE);
  ok(!!u2 && u2.check_out === d(64) && !('deposit' in u2), `the moved stay saves with no money fields (${u2 && u2.check_out})`);
  ok(!!sc && sc.guest_only === true && sc.id === 4, 'and the switch sends the updated confirmation to the guest only');
  // "…unless the owner touched it": a material change the owner chooses NOT to
  // email about must stay off when tapped off.
  await openEdit('b4');
  await page.click('#bks-t-out');
  await page.waitForFunction(() => document.getElementById('bks-cal-fold').classList.contains('on'));
  await pickDay(d(65));
  await page.waitForFunction(() => !document.getElementById('bks-cal-fold').classList.contains('on'));
  const onBefore = await S(() => document.getElementById('bks-conf').checked);
  await page.click('#bks-conf');
  ok(onBefore && (await S(() => document.getElementById('bks-conf').checked)) === false,
    `after a material change the owner can still tap the changes email OFF (on ${onBefore} → ${await S(() => document.getElementById('bks-conf').checked)})`);
  await closeSheet();

  // ---------- 7. a fully paid booking offers no custom price ----------
  console.log('7. the paid lock');
  await openEdit('b5');
  const pl = await S(() => {
    const vis = (id) => { const el = document.getElementById(id); return !!el && el.getClientRects().length > 0; };
    return {
      cls: document.querySelector('#edit-modal .modal-box').classList.contains('bks-paidlock'),
      seg: vis('modal-override-group'),
      depRo: vis('bks-dep-ro'), depStep: vis('bks-dep-step'),
      sub: document.getElementById('bks-n-s').textContent,
    };
  });
  ok(pl.cls && !pl.seg, 'a fully paid booking wears bks-paidlock and offers no Standard | Custom');
  ok(pl.depRo && !pl.depStep && /Paid in full/.test(pl.sub), `its deposit is a fact, not a stepper, and the price row says why (${pl.sub})`);
  await closeSheet();

  // ---------- 8. an arrived booking locks its cottage and dates ----------
  console.log('8. the move lock');
  await openEdit('b6');
  const ml = await S(() => {
    const before = document.getElementById('bks-cal-fold').classList.contains('on');
    bksOpenCal('in'); // the guard holds even when called directly
    bksChooseCot('jollyboat');
    return {
      cls: document.querySelector('#edit-modal .modal-box').classList.contains('bks-movelock'),
      tiles: [...document.querySelectorAll('#modal-date-trigger .bks-tile')].every((b) => b.disabled),
      cotRow: document.getElementById('bks-cot-row').disabled,
      note: (document.getElementById('modal-move-locked') || {}).textContent || '',
      calStill: !before && !document.getElementById('bks-cal-fold').classList.contains('on'),
      cot: document.getElementById('modal-property').value,
    };
  });
  ok(ml.cls && ml.tiles && ml.cotRow, 'an arrived booking wears bks-movelock: both date tiles and the cottage row are disabled');
  ok(/arrived/.test(ml.note) && /locked/.test(ml.note), `…with the note saying why (${ml.note})`);
  ok(ml.calStill && ml.cot === 'pimpernel', 'and the calendar and cottage choice refuse even a direct call');
  await closeSheet();

  // ---------- 9. nothing wider than the sheet ----------
  console.log('9. fit at 390 and 1280');
  const fit = () => S(() => {
    const box = document.querySelector('#edit-modal .modal-box.bks');
    const br = box.getBoundingClientRect();
    const bad = [];
    let n = 0;
    box.querySelectorAll('*').forEach((el) => {
      if (!el.getClientRects().length || getComputedStyle(el).visibility === 'hidden') return;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return;
      n++;
      if (r.left < br.left - 1 || r.right > br.right + 1) bad.push(`${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}.${String(el.className).split(' ')[0]} [${Math.round(r.left)},${Math.round(r.right)}]`);
    });
    const body = document.getElementById('bks-body');
    return { n, bad: bad.slice(0, 6), boxIn: br.left >= -0.5 && br.right <= innerWidth + 0.5, spill: body.scrollWidth - body.clientWidth, w: Math.round(br.width) };
  });
  // Everything a sheet can unfold, unfolded: the cottage list, the calendar, a
  // custom DISCOUNT (chips + the Other box), the plan, the paid card, the address.
  const unfoldAll = async () => {
    await page.click('#bks-pmode [data-v="custom"]');
    await page.click('#bks-cmode [data-v="off"]');
    await page.waitForFunction(() => !!document.querySelector('#bks-c-off .bks-chipin input'));
    await page.fill('#bks-c-off .bks-chipin input', '12.5');
    await S(() => {
      const open = (row, fold) => { const f = document.getElementById(fold); if (f && !f.classList.contains('on')) document.getElementById(row).click(); };
      open('bks-cot-row', 'bks-cot-fold');
      open('bks-addr-row', 'bks-addr-fold');
      const plan = document.getElementById('bks-plan-row');
      if (plan && plan.getClientRects().length && !document.getElementById('bks-plan-fold').classList.contains('on')) plan.click();
      const some = document.querySelector('#modal-pay-seg [data-arg="deposit"]');
      if (some && some.getClientRects().length) some.click();
      if (!document.getElementById('bks-cal-fold').classList.contains('on')) document.getElementById('bks-t-out').click();
    });
    await page.waitForFunction(() => ['bks-cot-fold', 'bks-addr-fold', 'bks-cal-fold', 'bks-cus-fold'].every((id) => document.getElementById(id).classList.contains('on')));
  };
  for (const vp of [{ width: 390, height: 844 }, { width: 1280, height: 900 }]) {
    await page.setViewportSize(vp);
    await openAdd();
    await page.fill('#modal-name', 'Fit Check');
    await pickStay(d(31), d(34)); // the overlap, so the verdict carries its offer
    await unfoldAll();
    const f = await fit();
    ok(f.n > 150 && f.boxIn && f.spill <= 0 && f.bad.length === 0,
      `at ${vp.width}px nothing is wider than the ${f.w}px sheet (${f.n} boxes measured, spill ${f.spill}${f.bad.length ? ', over: ' + f.bad.join(' | ') : ''})`);
    await closeSheet();
  }
  // A hostile guest name in the title, at phone width.
  await page.setViewportSize({ width: 390, height: 844 });
  await openEdit('b7');
  const fl = await fit();
  const tt = await S(() => { const h = document.getElementById('modal-title'); return { clips: h.scrollWidth > h.clientWidth, cs: getComputedStyle(h).textOverflow }; });
  ok(fl.boxIn && fl.spill <= 0 && fl.bad.length === 0 && tt.cs === 'ellipsis',
    `a 49-character guest name ellipsises in the title and widens nothing (${fl.bad.join(' | ') || 'all inside'})`);
  await closeSheet();

  console.log(fails ? `ADD-BOOKING TEST FAILED ❌ (${fails})` : 'ADD-BOOKING TEST PASSED ✅');
  await done(fails);
})().catch((e) => { console.error(e); process.exit(1); });
