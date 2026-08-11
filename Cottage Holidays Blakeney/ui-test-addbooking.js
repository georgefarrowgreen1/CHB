// THE ADD/EDIT BOOKING FORM'S REDESIGN, driven in a real browser.
//
// The form went from one flat ~2,100px column to four named sections with the
// availability calendar folded to a summary strip, the rare controls behind a
// single More-options row, and a sticky footer whose figure MIRRORS the price
// box. Every check here is about the things that redesign must keep true:
// the sections stand in order, the strip tells the truth both ways (free and
// overlapping), the fold opens and resets, the footer's number can never
// disagree with the box it mirrors, and a fresh open always starts folded.
const { d, boot } = require('./ui-test-lib'); // pins TZ=Europe/London at require time
let fails = 0;
const ok = (b, m) => { console.log(`  ${b ? '✓' : '✗'} ${m}`); if (!b) fails++; };

(async () => {
  const { page, base, done } = await boot({ viewport: { width: 390, height: 844 } });
  const json = (route, o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
  const mk = (id, over = {}) => Object.assign({
    id, prop_key: '21a', name: 'Booked Guest', email: 'g@gmail.com', phone: '',
    check_in: d(90), check_out: d(93), check_in_time: '15:00', check_out_time: '10:00',
    adults: 2, children: 0, notes: '', payment: 'unpaid', deposit_paid: 0,
    agreed_total: 440, agreed_per_night: 130, agreed_nights: 3, agreed_nightly: 390,
    agreed_booking_fee: 50, agreed_txn_pct: 0, agreed_txn_fee: 0, agreed_on: d(-30) + ' 12:00:00',
    damages_deposit: 50, created_at: d(-30) + ' 12:00:00',
  }, over);
  const rows = [mk(1)];
  await page.route(/\.php/, (route) => {
    const url = route.request().url();
    if (route.request().method() === 'POST') return json(route, { ok: true });
    if (url.includes('auth.php')) return json(route, { admin: true, admin_id: 1 });
    if (url.includes('bookings.php')) return json(route, { bookings: rows });
    if (url.includes('rates.php')) return json(route, { properties: [{ prop_key: '21a', name: '21A Westgate', slug: '21a', couple_rate: 130, extra_adult_rate: 0, child_rate: 0, booking_fee: 50, transaction_pct: 0, lastmin_pct: 0, lastmin_days: 0, max_adults: 2, max_children: 0, max_total: 2, sort_order: 1 }], seasons: {}, occupancy: {} });
    return json(route, { ok: true, bookings: [], enquiries: [], properties: [], seasons: {}, occupancy: {}, content: {}, blocks: [], ranges: [], payments: [] });
  });
  await page.goto(`${base}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1300);
  await page.evaluate(() => { isAuthenticated = true; document.body.classList.add('owner-mode'); });
  await page.evaluate(() => window.loadAdminBundle());
  await page.waitForTimeout(700);
  await page.evaluate(() => loadData());
  await page.waitForTimeout(500);

  // ---------- 1. the sectioned form ----------
  console.log('1. sections');
  await page.evaluate(() => window.openAddBooking());
  await page.waitForTimeout(300);
  const s1 = await page.evaluate(() => ({
    secs: Array.from(document.querySelectorAll('#edit-modal .modal-sec')).map((s) => s.textContent.trim()),
    xUp: (() => { const x = document.querySelector('#edit-modal .modal-x'); const r = x ? x.getBoundingClientRect() : { width: 0, height: 0 }; return r.width >= 24 && r.height >= 24; })(),
    nameLabel: (document.querySelector('label[for="modal-name"]') || {}).textContent || '',
    // THE STAY LEADS (the approved demo): the first column holds the cottage +
    // dates — the decision — with the guest's identity second.
    stayFirst: !!document.querySelector('#edit-modal .modal-col:first-child #modal-property'),
  }));
  ok(s1.secs.join('|') === 'The stay|The guest|Money|Notes', `four sections, the stay leading (${s1.secs.join('|')})`);
  ok(s1.stayFirst, 'the first column holds the cottage + dates — the decision leads');
  ok(s1.xUp, 'the ✕ close is in the header at ≥24px');
  ok(s1.nameLabel === 'Name', `the name label stopped repeating the section (${s1.nameLabel})`);

  // ---------- 2. the availability strip tells the truth both ways ----------
  console.log('2. availability strip');
  await page.evaluate((f) => {
    document.getElementById('modal-checkin').value = f.ci;
    document.getElementById('modal-checkout').value = f.co;
    updateModalPrice();
  }, { ci: d(30), co: d(33) });
  await page.waitForTimeout(200);
  const s2 = await page.evaluate(() => ({
    txt: (document.querySelector('.mav-strip-txt') || {}).textContent || '',
    clashDot: !!document.querySelector('.mav-strip-dot.is-clash'),
    dot: !!document.querySelector('.mav-strip-dot'),
    gridUp: !!document.querySelector('#modal-availability .mav-grid'),
    // The VERDICT capsule on the dates row (break-tested: deleting capSet's
    // fill in updateModalAvailability fails both capsule checks).
    cap: (document.getElementById('modal-date-verdict') || {}).textContent || '',
    capOk: !!document.querySelector('#modal-date-trigger .modal-date-verdict.is-ok'),
  }));
  ok(/^Free /.test(s2.txt) && s2.dot && !s2.clashDot, `free dates → green summary (${s2.txt.slice(0, 40)})`);
  ok(s2.capOk && /free/.test(s2.cap), `and the dates row wears the ✓ free capsule (${s2.cap})`);
  ok(/next booking starts/.test(s2.txt), 'and it names when the next booking starts');
  ok(!s2.gridUp, 'the grid stays folded until asked for');
  await page.click('.mav-toggle');
  await page.waitForTimeout(200);
  ok(await page.evaluate(() => !!document.querySelector('#modal-availability .mav-grid')), 'Calendar opens the six-week grid');
  await page.click('.mav-toggle');
  await page.waitForTimeout(200);
  ok(await page.evaluate(() => !document.querySelector('#modal-availability .mav-grid')), 'and closes it again');
  // Overlapping dates: the strip flips to the clash face and the warning renders.
  await page.evaluate((f) => {
    document.getElementById('modal-checkin').value = f.ci;
    document.getElementById('modal-checkout').value = f.co;
    updateModalPrice();
  }, { ci: d(91), co: d(94) });
  await page.waitForTimeout(200);
  const s2b = await page.evaluate(() => ({
    txt: (document.querySelector('.mav-strip-txt') || {}).textContent || '',
    clashDot: !!document.querySelector('.mav-strip-dot.is-clash'),
    warn: (document.querySelector('.mav-clash') || {}).textContent || '',
    capWarn: !!document.querySelector('#modal-date-trigger .modal-date-verdict.is-warn'),
    footSub: (document.getElementById('modal-foot-sub') || {}).textContent || '',
  }));
  ok(/^Overlaps Booked Guest/.test(s2b.txt) && s2b.clashDot, `overlapping dates → red summary naming the blocker (${s2b.txt.slice(0, 40)})`);
  ok(s2b.capWarn, 'the dates-row capsule flips to ⚠ overlaps');
  ok(/Overlaps Booked Guest/.test(s2b.footSub), `and the foot's sub carries the warning (${s2b.footSub.slice(0, 44)})`);
  ok(/confirm at save/.test(s2b.warn), 'and the confirm-at-save warning renders with it');

  // ---------- 3. the money controls display all the time ----------
  // The fold was tried and REMOVED at the owner's ask ("display these items
  // all the time") — no summary row, nothing behind a disclosure. Times live
  // in Stay; deposit/override/plan under Money, always painted.
  console.log('3. always-visible controls');
  const s3 = await page.evaluate(() => ({
    fold: !!document.querySelector('#edit-modal details'),
    visible: ['modal-checkin-time', 'modal-damages-deposit', 'modal-price-override', 'modal-plan-seg']
      .every((id) => { const el = document.getElementById(id); return !!el && el.getClientRects().length > 0; }),
    depLabel: (document.querySelector('label[for="modal-damages-deposit"]') || {}).textContent || '',
    hints: document.querySelectorAll('#modal-deposit-group .modal-hint, #modal-override-group .modal-hint, #modal-plan-group .modal-hint').length,
  }));
  ok(!s3.fold, 'no disclosure fold anywhere in the modal');
  ok(s3.visible, 'times, deposit, override and the plan toggle all paint without a tap');
  ok(s3.depLabel === 'Refundable damages deposit (£)' && s3.hints >= 3,
    `the shouted labels stay short label + quiet hint (${s3.hints} hints)`);
  // The plan is a Standard | Custom TOGGLE: Standard states the LIVE site
  // terms in a sentence and hides the fields; Custom reveals them; flipping
  // back WIPES what was typed. With NOTHING priced yet the line falls back to
  // the site-standard sentence (the computed brief is §3b's job).
  const t1 = await page.evaluate(() => {
    document.getElementById('modal-checkin').value = '';
    document.getElementById('modal-checkout').value = '';
    updateModalPrice();
    return {
      stdOn: document.getElementById('modal-plan-std-btn').classList.contains('is-on'),
      pressed: document.getElementById('modal-plan-std-btn').getAttribute('aria-pressed') === 'true',
      fieldsHidden: document.getElementById('modal-plan-custom').style.display === 'none',
      line: (document.getElementById('modal-plan-std-line') || {}).textContent || '',
    };
  });
  ok(t1.stdOn && t1.pressed && t1.fieldsHidden, 'the plan opens on Standard, fields folded');
  ok(/25% deposit/.test(t1.line) && /30 days/.test(t1.line), `unpriced, the line quotes the live site terms (${t1.line.slice(0, 50)})`);
  await page.click('#modal-plan-custom-btn');
  const t2 = await page.evaluate(() => ({
    on: document.getElementById('modal-plan-custom-btn').classList.contains('is-on'),
    fieldsUp: document.getElementById('modal-plan-custom').style.display !== 'none',
  }));
  ok(t2.on && t2.fieldsUp, 'Custom reveals the fields');
  await page.evaluate(() => { document.getElementById('modal-plan-pct').value = '40'; });
  await page.click('#modal-plan-std-btn');
  const t3 = await page.evaluate(() => ({
    hidden: document.getElementById('modal-plan-custom').style.display === 'none',
    wiped: document.getElementById('modal-plan-pct').value === '',
  }));
  ok(t3.hidden && t3.wiped, 'flipping back to Standard WIPES the typed plan — it can never ship silently');
  // iOS draws an EMPTY date input SHORTER than its siblings (no text to size
  // the line box) — owner's screenshot: Balance due by against Deposit %.
  // Chromium cannot reproduce the collapse, so this asserts the pinning RULE
  // via CSSOM (the reduced-motion precedent: a computed read passes with the
  // rule deleted); the WebKit layout leg sees the real paint.
  const datePin = await page.evaluate(() => {
    for (const sheet of document.styleSheets) {
      let rules;
      try { rules = sheet.cssRules; } catch (e) { continue; }
      for (const r of rules) {
        if (r.selectorText && r.selectorText.includes('input[type="date"].input-glass') && r.style && r.style.minHeight) return r.style.minHeight;
      }
    }
    return '';
  });
  ok(/calc\(/.test(datePin), `the empty-date height pin stands in the stylesheet (${datePin})`);

  // ---------- 3b. the plan brief speaks the derivation ----------
  // Every figure below is computed IN THE GATE from the page's own
  // priceBreakdown — equality of derivations, never hardcoded pounds. The
  // brief's first payment must be the plan deposit + the refundable ride
  // pay.php bundles with it (break-tested: dropping `+ m.dep` from
  // modalPlanFacts fails the first-payment equality here AND the prefill).
  console.log('3b. plan brief + window rule');
  const exp = (ci, co, pct) => page.evaluate((f) => {
    const p = priceBreakdown('21a', 2, 0, f.ci, f.co, null);
    const dep = p.damagesDeposit || 0;
    const planDep = Math.round(p.total * f.pct) / 100;
    const g = (n) => gbp(n);
    return { first: g(Math.round((planDep + dep) * 100) / 100), planDep: g(planDep), balance: g(Math.round((p.total - planDep) * 100) / 100), full: g(Math.round((p.total + dep) * 100) / 100) };
  }, { ci, co, pct });
  // Outside the 30-day window → the staged plan with its due date.
  await page.evaluate((f) => {
    document.getElementById('modal-checkin').value = f.ci;
    document.getElementById('modal-checkout').value = f.co;
    updateModalPrice();
  }, { ci: d(60), co: d(63) });
  const e1 = await exp(d(60), d(63), 25);
  const b1 = await page.evaluate(() => ({
    line: document.getElementById('modal-plan-std-line').textContent,
    sub: document.getElementById('modal-foot-sub').textContent,
    due: fmtDate(ukShiftDays(document.getElementById('modal-checkin').value, -30)),
  }));
  ok(b1.line.includes(`First payment ${e1.first}`) && b1.line.includes(`25% deposit ${e1.planDep}`) && b1.line.includes(`balance ${e1.balance} due by ${b1.due}`),
    `outside the window the brief states first payment / deposit / balance / date (${b1.line.slice(0, 76)}…)`);
  ok(b1.sub.includes(`First payment ${e1.first}`) && b1.sub.includes(b1.due), `and the foot sub carries the same facts (${b1.sub})`);
  // Inside the 30-day window → the full amount is asked up front (the live
  // booking_payment_kind rule, mirrored with the strict standard boundary).
  await page.evaluate((f) => {
    document.getElementById('modal-checkin').value = f.ci;
    document.getElementById('modal-checkout').value = f.co;
    updateModalPrice();
  }, { ci: d(10), co: d(13) });
  const e2 = await exp(d(10), d(13), 100);
  const b2 = await page.evaluate(() => ({
    line: document.getElementById('modal-plan-std-line').textContent,
    sub: document.getElementById('modal-foot-sub').textContent,
  }));
  ok(/full amount is asked up front/.test(b2.line) && b2.line.includes(`first payment ${e2.first}`),
    `inside 30 days the brief flips to full-up-front (${b2.line.slice(0, 72)}…)`);
  ok(/Full amount up front/.test(b2.sub), `and the foot sub says so (${b2.sub})`);
  // A CUSTOM percentage follows into the brief — stepped, not typed: the pct
  // stepper starts from the site standard (25 + 5 + 5 = 35).
  await page.click('#modal-plan-custom-btn');
  await page.evaluate((f) => {
    document.getElementById('modal-checkin').value = f.ci;
    document.getElementById('modal-checkout').value = f.co;
    updateModalPrice();
  }, { ci: d(60), co: d(63) });
  await page.click('#modal-plan-custom [data-arg="pct"][data-arg2="5"]');
  await page.click('#modal-plan-custom [data-arg="pct"][data-arg2="5"]');
  const e3 = await exp(d(60), d(63), 35);
  const b3 = await page.evaluate(() => ({
    pct: document.getElementById('modal-plan-pct').value,
    line: document.getElementById('modal-plan-std-line').textContent,
  }));
  ok(b3.pct === '35', `the pct stepper steps from the site standard (${b3.pct})`);
  ok(b3.line.includes(`35% deposit`) && b3.line.includes(`First payment ${e3.first}`), `and the brief follows the custom plan (${b3.line.slice(0, 66)}…)`);
  await page.click('#modal-plan-std-btn'); // back to standard (wipes)

  // ---------- 3c. party steppers + the payment segment ----------
  console.log('3c. steppers + payment segment');
  // Adults caps at the cottage's occupancy (21A tops out at 2) — the + stops
  // offering, TYPING past stays possible (the server confirm is the override).
  const st1 = await page.evaluate(() => {
    const plus = document.querySelector('#edit-modal [data-act="modalStep"][data-arg="adults"][data-arg2="1"]');
    plus.click();
    return {
      val: document.getElementById('modal-adults').value,
      plusDisabled: plus.disabled,
      minus: document.querySelector('#edit-modal [data-act="modalStep"][data-arg="adults"][data-arg2="-1"]').disabled,
      occNote: document.getElementById('modal-occ-note').textContent,
    };
  });
  ok(st1.val === '2' && st1.plusDisabled, `+ stops at 21A's occupancy (adults ${st1.val}, + disabled ${st1.plusDisabled})`);
  ok(/Sleeps up to 2/.test(st1.occNote), `the occupancy note names the cottage's limit (${st1.occNote})`);
  const st2 = await page.evaluate(() => {
    document.querySelector('#edit-modal [data-act="modalStep"][data-arg="adults"][data-arg2="-1"]').click();
    const a = document.getElementById('modal-adults').value;
    document.querySelector('#edit-modal [data-act="modalStep"][data-arg="adults"][data-arg2="-1"]').click();
    return { after: a, floor: document.getElementById('modal-adults').value };
  });
  ok(st2.after === '1' && st2.floor === '1', `− steps down and floors at 1 (${st2.after}/${st2.floor})`);
  await page.evaluate(() => { document.getElementById('modal-adults').value = '2'; updateModalPrice(); });
  // The deposit stepper steps the REAL input from the cottage default.
  const st3 = await page.evaluate(() => {
    document.querySelector('#edit-modal [data-act="modalStep"][data-arg="dmg"][data-arg2="25"]').click();
    return document.getElementById('modal-damages-deposit').value;
  });
  ok(parseFloat(st3) > 0, `the deposit stepper fills the real input from the cottage default (£${st3})`);
  await page.evaluate(() => { document.getElementById('modal-damages-deposit').value = ''; updateModalPrice(); });
  // The payment segment writes the hidden select, reveals the fields, and in
  // ADD mode prefills the amount with the plan's own first payment.
  const p1 = await page.evaluate(() => {
    document.querySelector('#modal-pay-seg [data-arg="deposit"]').click();
    return {
      sel: document.getElementById('modal-payment').value,
      detailsUp: document.getElementById('modal-payment-details').style.display !== 'none',
      amt: document.getElementById('modal-deposit-amount').value,
      on: document.querySelector('#modal-pay-seg [data-arg="deposit"]').classList.contains('is-on'),
    };
  });
  const e4 = await exp(d(60), d(63), 25);
  ok(p1.sel === 'deposit' && p1.detailsUp && p1.on, 'tapping "Deposit paid" sets the select and reveals the inline fields');
  ok('£' + p1.amt === e4.first.replace(',', ''), `and prefills the amount with the plan's first payment (£${p1.amt} = ${e4.first})`);
  // Dates change → OUR prefill follows the plan (a typed figure would not).
  await page.evaluate((f) => {
    document.getElementById('modal-checkin').value = f.ci;
    document.getElementById('modal-checkout').value = f.co;
    updateModalPrice();
  }, { ci: d(90), co: d(94) });
  const e5 = await page.evaluate((f) => {
    const p = priceBreakdown('21a', 2, 0, f.ci, f.co, null);
    const dep = p.damagesDeposit || 0;
    return (Math.round(p.total * 25) / 100 + dep).toFixed(2);
  }, { ci: d(90), co: d(94) });
  const p2 = await page.evaluate(() => document.getElementById('modal-deposit-amount').value);
  ok(p2 === e5, `the auto prefill re-derives when the dates move (£${p2})`);
  // A figure the OWNER types is theirs — never clobbered by a re-derivation.
  await page.evaluate(() => { document.getElementById('modal-deposit-amount').value = '123.00'; });
  await page.evaluate((f) => {
    document.getElementById('modal-checkin').value = f.ci;
    document.getElementById('modal-checkout').value = f.co;
    updateModalPrice();
  }, { ci: d(60), co: d(63) });
  ok(await page.evaluate(() => document.getElementById('modal-deposit-amount').value) === '123.00',
    'a typed amount is never clobbered by the plan');
  // "Nothing yet" folds the fields; a PROGRAMMATIC select write + change event
  // repaints the segment (the offline suite's path — the select stays truth).
  const p3 = await page.evaluate(() => {
    document.querySelector('#modal-pay-seg [data-arg="unpaid"]').click();
    const hidden = document.getElementById('modal-payment-details').style.display === 'none';
    const sel = document.getElementById('modal-payment');
    sel.value = 'paid';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    return { hidden, paidOn: document.querySelector('#modal-pay-seg [data-arg="paid"]').classList.contains('is-on') };
  });
  ok(p3.hidden, '"Nothing yet" folds the inline fields away');
  ok(p3.paidOn, 'a programmatic select write repaints the segment — the select stays the source of truth');
  await page.evaluate(() => { modalPayMode('unpaid'); });
  // The foot button names the ACTION in add mode.
  ok(await page.evaluate(() => document.getElementById('modal-save-btn').textContent) === 'Add booking',
    'the foot button says what it will do — Add booking');

  // ---------- 4. the sticky footer mirrors the price box ----------
  console.log('4. sticky footer');
  await page.evaluate((f) => {
    document.getElementById('modal-checkin').value = f.ci;
    document.getElementById('modal-checkout').value = f.co;
    updateModalPrice();
  }, { ci: d(30), co: d(33) });
  await page.waitForTimeout(200);
  const s4 = await page.evaluate(() => {
    const boxAmt = (document.querySelector('#modal-price-box .price-row.total .price-amount') || {}).textContent || '';
    const footFig = (document.getElementById('modal-foot-fig') || {}).textContent || '';
    const box = document.querySelector('#edit-modal .modal-box');
    box.scrollTop = 0; // the top of the form — where the sticky claim matters
    const foot = document.querySelector('.modal-foot');
    const fr = foot.getBoundingClientRect();
    const br = box.getBoundingClientRect();
    const save = document.getElementById('modal-save-btn').getBoundingClientRect();
    return { boxAmt, footFig, onScreen: fr.bottom <= br.bottom + 1 && fr.top < window.innerHeight, saveH: save.height };
  });
  ok(s4.boxAmt !== '' && s4.footFig === s4.boxAmt, `the footer MIRRORS the box's total (${s4.footFig})`);
  ok(s4.onScreen, 'the footer is on screen with the form scrolled to the top (sticky)');
  ok(s4.saveH >= 44, `Save meets the touch floor (${Math.round(s4.saveH)}px)`);
  // THE DOCKED BAR: full box width through the --mpad token (a hardcoded
  // bleed once overhung the phone's narrower padding and cut "£440.00" to
  // "£6"), bottom corners matching the box radius, its TEXT back on the
  // content rail, and a hostile-length figure squeezes SAVE, never itself.
  const s4b = await page.evaluate(() => {
    const box = document.querySelector('#edit-modal .modal-box');
    const foot = document.querySelector('.modal-foot');
    const br = box.getBoundingClientRect();
    const fr0 = foot.getBoundingClientRect();
    const fullBleed = Math.abs(fr0.left - br.left) <= 1.5 && Math.abs(fr0.right - br.right) <= 1.5;
    const radiusMatch = getComputedStyle(foot).borderBottomLeftRadius === getComputedStyle(box).borderBottomLeftRadius;
    // The content rail is the SCROLLER's padding now — the box pads 0 and
    // the form scrolls in its own region so iOS overscroll can't move the bar.
    const scroller = document.querySelector('#edit-modal .modal-scroll');
    const padL = parseFloat(getComputedStyle(scroller).paddingLeft);
    const outsideScroller = foot.parentElement === box && !scroller.contains(foot);
    const textOnRail = Math.abs(document.querySelector('.modal-foot-total').getBoundingClientRect().left - (br.left + padL)) <= 1.5;
    const fig = document.getElementById('modal-foot-fig');
    fig.textContent = '£123,456.00'; // hostile figure (the §14 injection discipline)
    const fr = fig.getBoundingClientRect();
    const noClip = Math.ceil(fr.width) >= fig.scrollWidth - 1 && fr.right <= document.getElementById('modal-save-btn').getBoundingClientRect().left + 1;
    fig.textContent = '£440.00';
    return { fullBleed, radiusMatch, textOnRail, noClip, outsideScroller };
  });
  ok(s4b.fullBleed && s4b.radiusMatch, 'the foot docks edge to edge with the box\'s own bottom corners');
  ok(s4b.outsideScroller, 'the foot lives OUTSIDE the scroller — overscroll cannot move it');
  ok(s4b.textOnRail, 'its text stands on the content rail');
  ok(s4b.noClip, 'a hostile-length figure squeezes Save, never itself');
  // The foot's ground is the OPAQUE theme surface — the bhub-sticky gradient
  // painted a strange-fading slab over the modal's glass (owner's light-mode
  // screenshot). No gradient, no alpha, in EITHER theme.
  const footGround = await page.evaluate(() => {
    const read = () => {
      const cs = getComputedStyle(document.querySelector('.modal-foot'));
      const m = cs.backgroundColor.match(/rgba?\(([^)]+)\)/);
      const alpha = m && m[1].split(',').length === 4 ? parseFloat(m[1].split(',')[3]) : 1;
      return { noGrad: cs.backgroundImage === 'none', opaque: alpha >= 0.999 };
    };
    const dark = read();
    document.body.classList.add('light-mode');
    const light = read();
    document.body.classList.remove('light-mode');
    return { dark, light };
  });
  ok(footGround.dark.noGrad && footGround.dark.opaque && footGround.light.noGrad && footGround.light.opaque,
    'the foot is a solid theme surface in both themes — no gradient fade');
  // ONE visible name for the notes field: the section cap carries the words,
  // the label goes .sr-only (announced, not doubled on screen).
  const s4c = await page.evaluate(() => {
    const lbl = document.querySelector('label[for="modal-notes"]');
    const r = lbl.getBoundingClientRect();
    return { hidden: r.width <= 1 && r.height <= 1, named: lbl.textContent.trim().length > 0 };
  });
  ok(s4c.hidden && s4c.named, 'the notes label is announced but not doubled under the Notes cap');
  // Invalid dates → the mirror goes honest, never stale.
  await page.evaluate(() => {
    document.getElementById('modal-checkin').value = '';
    document.getElementById('modal-checkout').value = '';
    updateModalPrice();
  });
  ok(await page.evaluate(() => (document.getElementById('modal-foot-fig') || {}).textContent === '—'),
    'no computable total → the footer shows a dash, not the last number');

  // ---------- 5. a fresh open resets ----------
  console.log('5. fresh-open reset');
  await page.evaluate(() => {
    mavToggle();
    closeModal();
  });
  await page.evaluate(() => window.openAddBooking());
  await page.waitForTimeout(250);
  const s5 = await page.evaluate(() => !document.querySelector('#modal-availability .mav-grid'));
  ok(s5, 'reopening starts with the availability calendar folded to its strip');
  // The ✕ goes through the dispatcher and actually closes.
  await page.click('#edit-modal .modal-x');
  await page.waitForTimeout(250);
  ok(await page.evaluate(() => !document.getElementById('edit-modal').classList.contains('open')),
    'the header ✕ closes the modal');

  // ---------- 6. desktop uses the width ----------
  console.log('6. desktop two-column');
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate(() => window.openAddBooking());
  await page.waitForTimeout(300);
  const s6 = await page.evaluate(() => {
    const cols = document.querySelector('#edit-modal .modal-cols');
    const tracks = getComputedStyle(cols).gridTemplateColumns.split(' ').length;
    const w = document.querySelector('#edit-modal .modal-box').getBoundingClientRect().width;
    return { tracks, w };
  });
  ok(s6.tracks === 2 && s6.w > 700, `Guest and Stay sit side by side in a wide box (${s6.tracks} tracks, ${Math.round(s6.w)}px)`);

  // ---------- 7. custom-property mode stands the mirror down ----------
  console.log('7. custom-property mode');
  await page.evaluate(() => {
    document.getElementById('modal-property').value = '__new__';
    applyModalPropertyMode();
  });
  const s7 = await page.evaluate(() => ({
    totalHidden: getComputedStyle(document.getElementById('modal-foot-total')).display === 'none',
    saveLabel: document.getElementById('modal-save-btn').textContent,
  }));
  ok(s7.totalHidden && /Next/.test(s7.saveLabel), `new-property flow hides the total and relabels Save (${s7.saveLabel})`);
  await page.evaluate(() => closeModal());

  await done(fails);
})().catch((e) => { console.error(e); process.exit(1); });
