// THE NO-DOG DECLARATION on the enquiry form, driven in a real browser.
//
// Two required tick boxes now sit together above Send: the house rule and the
// terms. The point of the pair is that NEITHER can be skipped, so this drives
// the real submit button through all four combinations rather than calling the
// validator — a guard that is never reached is the failure mode here (the whole
// reason this box exists is that it must stop a send).
const { bootBrowser } = require('./ui-test-lib'); // pins TZ=Europe/London at require time
let fails = 0;
const ok = (b, m) => { console.log(`  ${b ? '✓' : '✗'} ${m}`); if (!b) fails++; };

(async () => {
  const { browser, base, done } = await bootBrowser();
  const page = await browser.newPage({ viewport: { width: 900, height: 1100 } });
  page.on('pageerror', (e) => { console.log('  PAGEERR:', e.message); fails++; });
  await page.addInitScript(() => { if (navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(() => {}); });

  const posts = [];
  await page.route(/\.php/, (route) => {
    const url = route.request().url();
    const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (route.request().method() === 'POST') {
      let b = {};
      try { b = JSON.parse(route.request().postData() || '{}'); } catch (e) {}
      b.__url = url.split('/').pop().split('?')[0];
      posts.push(b);
      if (b.__url === 'enquiries.php' && b.action === 'submit') return json({ ok: true, id: 1 });
      return json({ ok: true });
    }
    if (url.includes('availability.php')) return json({ ok: true, ranges: [], props: { jollyboat: [] } });
    if (url.includes('rates.php')) return json({
      properties: [{ prop_key: 'jollyboat', name: 'Jollyboat', slug: 'jollyboat', couple_rate: 130, extra_adult_rate: 0, child_rate: 0, booking_fee: 50, transaction_pct: 0, lastmin_pct: 0, lastmin_days: 0, max_adults: 4, max_children: 2, max_total: 4, sort_order: 1 }],
      seasons: {}, occupancy: {},
    });
    return json({ ok: true, bookings: [], enquiries: [], reviews: [], photos: [], props: {}, events: [], value: null });
  });
  await page.goto(`${base}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1300);

  const d = (n) => { const t = new Date(); const x = new Date(t.getFullYear(), t.getMonth(), t.getDate() + n); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };

  // Fill everything EXCEPT the two tick boxes, so each case below differs only
  // in which of them is ticked.
  const fill = async (nodogs, terms) => {
    await page.evaluate(({ ci, co, nodogs, terms }) => {
      activeFrontProperty = 'jollyboat';
      const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
      set('enq-name', 'Ivy Tester');
      set('enq-email', 'ivy@example.com');
      set('enq-phone', '07700900123');
      set('enq-address', '1 Test Lane, Blakeney');
      set('enq-postcode', 'NR25 7NQ');
      set('enq-message', 'Two of us, no pets.');
      set('enq-adults', 2);
      set('enq-children', 0);
      set('enq-checkin', ci);
      set('enq-checkout', co);
      dpState.start = ci; dpState.end = co;
      document.getElementById('enq-nodogs').checked = nodogs;
      document.getElementById('enq-terms').checked = terms;
    }, { ci: d(30), co: d(33), nodogs, terms });
  };
  const sent = () => posts.filter((p) => p.__url === 'enquiries.php' && p.action === 'submit');
  const msg = () => page.evaluate(() => (document.getElementById('enq-msg-details') || {}).textContent || '');
  const send = async () => { await page.evaluate(() => submitEnquiry()); await page.waitForTimeout(450); };

  console.log('1. the box is on the form, beside the terms');
  const shape = await page.evaluate(() => {
    const box = document.getElementById('enq-nodogs');
    const terms = document.getElementById('enq-terms');
    if (!box || !terms) return { err: 'missing' };
    const lbl = box.closest('label');
    return {
      type: box.type,
      checkedByDefault: box.checked,
      text: (lbl && lbl.textContent.trim()) || '',
      sameStyling: !!lbl && lbl.className === terms.closest('label').className,
      // …and it comes FIRST, which is what the validation order assumes.
      before: !!(lbl.compareDocumentPosition(terms.closest('label')) & Node.DOCUMENT_POSITION_FOLLOWING),
    };
  });
  ok(shape.type === 'checkbox', `it is a tick box (${shape.type})`);
  ok(shape.checkedByDefault === false, 'it starts UNticked — a pre-ticked declaration declares nothing');
  ok(/not be bringing a dog/i.test(shape.text), `it says what is being confirmed (${shape.text})`);
  ok(shape.sameStyling, 'it is presented the same way as the terms box, as a pair');
  ok(shape.before, 'and it sits above the terms, which is the order the messages assume');

  console.log('2. it must be ticked before the enquiry can be sent');
  await fill(false, true);            // terms only
  await send();
  ok(sent().length === 0, 'unticked → nothing is sent');
  ok(/not be bringing a dog/i.test(await msg()), `…and the guest is told which box (${(await msg()).slice(0, 60)})`);

  console.log('3. the terms box still stops a send on its own');
  await fill(true, false);            // dog only
  await send();
  ok(sent().length === 0, 'terms unticked → still nothing is sent');
  ok(/Terms & Conditions/i.test(await msg()), '…and the message names the terms, not the dog');

  console.log('4. neither ticked names the FIRST thing to fix');
  await fill(false, false);
  await send();
  ok(sent().length === 0, 'nothing is sent');
  ok(/not be bringing a dog/i.test(await msg()),
    'the guest is sent back once, to the box they meet first — not twice');

  console.log('5. both ticked → it sends, and says so on the wire');
  await fill(true, true);
  await send();
  const s = sent();
  ok(s.length === 1, `the enquiry is sent (${s.length})`);
  ok(s[0] && s[0].no_dogs === true, 'the declaration travels with it, for the server to record');
  ok(s[0] && s[0].terms_accepted === true, '…alongside the terms acceptance');

  console.log('6. a second enquiry must be declared again');
  // The form is reused, so a tick left behind would let the NEXT guest — or the
  // same one making a second enquiry — send without declaring anything. The
  // declaration would then be recorded for a stay nobody confirmed.
  const after = await page.evaluate(() => {
    resetEnquiryForm();
    return {
      dog: document.getElementById('enq-nodogs').checked,
      terms: document.getElementById('enq-terms').checked,
    };
  });
  ok(after.dog === false, 'the reset clears the dog box, as it does the terms');
  ok(after.terms === false, '…and the terms box with it');
  const before = sent().length;
  await page.evaluate(() => submitEnquiry());
  await page.waitForTimeout(450);
  ok(sent().length === before, '…so the next send is blocked until it is ticked again');

  console.log('7. the dates verdict: the submit-time clash check, surfaced at choose-time');
  // The capsule and submitEnquiry's "just been taken" refusal read the SAME
  // store with the SAME overlap test (enqFirstProblem), so drive both from one
  // seeded availability range and assert they agree.
  const verdict = async (ci, co, ranges) => page.evaluate(({ ci, co, ranges }) => {
    activeFrontProperty = 'jollyboat';
    if (ranges === null) delete propertyAvailability.jollyboat;
    else propertyAvailability.jollyboat = ranges;
    document.getElementById('enq-checkin').value = ci;
    document.getElementById('enq-checkout').value = co;
    updateEnquiryPrice();
    const cap = document.getElementById('enq-avail-cap');
    return {
      capShown: cap.style.display !== 'none',
      capText: cap.textContent,
      capClass: cap.className,
      wait: document.getElementById('enq-wait-row').style.display !== 'none',
      // Scoped to the price box: step 3's what-happens-next rows share the
      // .enq-sched anatomy, and an unscoped query would read those instead.
      sched: (document.querySelector('#enq-price-box .enq-sched') || {}).innerText || '',
      box: (document.getElementById('enq-price-box') || {}).innerText || '',
    };
  }, { ci, co, ranges });
  const free = await verdict(d(40), d(43), [{ start: d(50), end: d(55) }]);
  ok(free.capShown && /available/.test(free.capText) && /\bok\b/.test(free.capClass),
    `free dates → ✓ available (${free.capText})`);
  ok(!free.wait, '…and no waitlist row');
  const taken = await verdict(d(49), d(52), [{ start: d(50), end: d(55) }]);
  ok(taken.capShown && /taken/.test(taken.capText) && /warn/.test(taken.capClass),
    `overlapping dates → ⚠ taken (${taken.capText})`);
  ok(taken.wait, '…and the waitlist is offered in place');
  ok(!taken.sched, '…and a taken stay gets NO payment schedule');
  // The honesty gate: availability never fetched → the capsule says NOTHING,
  // because "✓ available" before asking would be an unchecked assertion.
  const unknown = await verdict(d(40), d(43), null);
  ok(!unknown.capShown, 'availability not yet loaded → no capsule at all');
  // The waitlist button routes to the REAL join, prefilled with these dates.
  // NB the suite never OPENS the enquiry modal (the form is driven hidden), so
  // this is a synthetic click — it still bubbles through the data-act
  // dispatcher, which is the wiring under test.
  await verdict(d(49), d(52), [{ start: d(50), end: d(55) }]);
  await page.evaluate(() => document.querySelector('#enq-wait-row button').click());
  await page.waitForTimeout(300);
  const wl = await page.evaluate(() => ({
    open: document.getElementById('waitlist-modal').classList.contains('open'),
    prop: (document.getElementById('wl-prop') || {}).value,
    ci: (document.getElementById('wl-checkin') || {}).value,
  }));
  ok(wl.open && wl.prop === 'jollyboat' && wl.ci === d(49),
    `the waitlist opens prefilled (${wl.prop} from ${wl.ci})`);
  await page.evaluate(() => closeWaitlistModal());

  console.log('8. the payment schedule speaks the published plan, and it adds up');
  // Outside the balance window: deposit + balance rows, and the COHERENCE
  // property — deposit + balance = the estimate's own total (read from the
  // RENDERED rows, so reverting the renderer cannot pass).
  const money = (s) => parseFloat(String(s).replace(/[£,]/g, ''));
  const far = await verdict(d(60), d(63), []); // 3 nights × £130 + £50 fee = £440
  ok(/On booking/i.test(far.sched) && /balance/i.test(far.sched),
    'outside the window → deposit row + balance row');
  const mDep = far.sched.match(/25% deposit £([\d.,]+)/);
  const mBal = far.sched.match(/£([\d.,]+) balance/);
  const mTot = far.box.match(/From\s*£([\d.,]+)/);
  ok(mDep && mBal && mTot && Math.abs(money(mDep[1]) + money(mBal[1]) - money(mTot[1])) < 0.01,
    `deposit ${mDep && mDep[1]} + balance ${mBal && mBal[1]} = total ${mTot && mTot[1]}`);
  // innerText reflects the CSS text-transform (the when-column renders
  // uppercase) so the match is case-insensitive — and en-GB's short month is
  // FOUR letters for September ("Sept"), so \w{3} alone fails one month a year.
  ok(/By \d{1,2} \w{3,4} \d{4}/i.test(far.sched), 'the balance row names its DATE');
  // Inside the window (check-in under 30 days out): the full amount, honestly.
  const near = await verdict(d(10), d(13), []);
  ok(/in full/i.test(near.sched) && !/balance/i.test(near.sched),
    'inside the window → full amount on booking, no balance row');

  console.log('9. the living line under Send enquiry shares the refusal ladder');
  // Same state → the line and the submit refusal say the SAME sentence: fill
  // everything but the party message, read both, compare.
  await fill(true, true);
  await page.evaluate(() => { document.getElementById('enq-message').value = ''; enqLiveSync(); });
  const lineMissing = await page.evaluate(() => document.getElementById('enq-live-sub').textContent);
  await send();
  ok(lineMissing === (await msg()),
    `the line and the refusal are one sentence (${lineMissing.slice(0, 50)}…)`);
  ok(/about your party/i.test(lineMissing), '…and it names the party field here');
  // Everything in → the line restates the no-payment promise WITH the figure.
  await fill(true, true);
  await page.evaluate(() => enqLiveSync());
  const lineReady = await page.evaluate(() => document.getElementById('enq-live-sub').textContent);
  ok(/No payment now — £[\d.,]+ once we confirm/.test(lineReady),
    `ready → the first payment's figure in the promise (${lineReady.slice(0, 60)})`);

  console.log('11. the personable layer: trust note, welcome-back, reaction, quick-ask, circle, receipt');
  // The trust note is static markup on step 1 — people behind the form.
  const host = await page.evaluate(() => (document.querySelector('.enq-host') || {}).textContent || '');
  ok(/Family-run/i.test(host) && /read by a person/i.test(host), 'the family-run trust note is on the form');
  // Welcome-back: recognised from the guest's OWN stays cache. Two past stays
  // → "third stay"; upcoming-only → nothing (a first booking isn't "back");
  // null cache → nothing (unknown says nothing rather than guessing).
  const wb = (stays) => page.evaluate((s) => {
    currentGuest = { name: 'Sarah Pemberton', email: 's@example.com' };
    __wbStays = s;
    enqWelcomeSync();
    const el = document.getElementById('enq-wb');
    return { shown: el.style.display !== 'none', text: el.textContent };
  }, stays);
  const wb2 = await wb([{ propKey: 'jollyboat', checkIn: d(-40), checkOut: d(-37) }, { propKey: 'jollyboat', checkIn: d(-20), checkOut: d(-17) }]);
  ok(wb2.shown && /Welcome back, Sarah/.test(wb2.text) && /third stay/.test(wb2.text),
    `two past stays → "${wb2.text.slice(0, 60)}"`);
  const wbUp = await wb([{ propKey: 'jollyboat', checkIn: d(20), checkOut: d(23) }]);
  ok(!wbUp.shown, 'an upcoming-only first booking is NOT "back"');
  const wbNull = await wb(null);
  ok(!wbNull.shown, 'an unloaded cache says nothing rather than guessing');
  await page.evaluate(() => { currentGuest = null; __wbStays = null; });
  // The reaction note: month note via the OWNER OVERRIDE (clock-proof — the
  // override names the month the seeded stay is in) + made-for-two when the
  // cottage's real limit IS two. Suppressed while the dates are taken.
  const react = (noteMonth, maxTotal, ranges) => page.evaluate(({ noteMonth, maxTotal, ranges, ci, co }) => {
    activeFrontProperty = 'jollyboat';
    propertyAvailability.jollyboat = ranges;
    siteContent['enq-month-notes'] = noteMonth + ': A test month note about the light';
    occupancyLimits.jollyboat = { maxAdults: 2, maxChildren: 0, maxTotal: maxTotal };
    document.getElementById('enq-adults').value = 2;
    document.getElementById('enq-children').value = 0;
    document.getElementById('enq-checkin').value = ci;
    document.getElementById('enq-checkout').value = co;
    updateEnquiryPrice();
    const el = document.getElementById('enq-react');
    return { shown: el.style.display !== 'none', text: el.textContent };
  }, { noteMonth, maxTotal, ranges, ci: d(40), co: d(43) });
  const stayMonth = +d(40).split('-')[1];
  const r1 = await react(stayMonth, 2, []);
  ok(r1.shown && /test month note/.test(r1.text) && /made for two/.test(r1.text),
    `free dates → the note + made-for-two (${r1.text.slice(0, 60)}…)`);
  const r2 = await react(stayMonth === 1 ? 2 : stayMonth - 1, 4, []);
  ok(!r2.shown, 'no note for this month + a bigger cottage → silence, not filler');
  const r3 = await react(stayMonth, 2, [{ start: d(41), end: d(42) }]);
  ok(!r3.shown, 'taken dates → no remark (we can’t take the stay)');
  await page.evaluate(() => { delete siteContent['enq-month-notes']; propertyAvailability.jollyboat = []; });
  // The quick-ask: the REAL guestFaqAnswer over the cottage's own FAQ content;
  // a miss is honest AND feeds the owner's teach loop (guest-faq.php record).
  const askResult = (q) => page.evaluate((q) => {
    siteContent['faqs-jollyboat'] = [{ q: 'Is there a telescope?', a: 'Yes — a telescope lives in the snug.' }];
    document.getElementById('enq-faq-q').value = q;
    enqFaqAsk();
    return (document.getElementById('enq-faq-a') || {}).textContent || '';
  }, q);
  const hitA = await askResult('do you have a telescope?');
  ok(/telescope lives in the snug/.test(hitA), 'a confident match answers from the cottage guide');
  const missCountBefore = posts.filter((p) => p.__url === 'guest-faq.php').length;
  const missA = await askResult('can we moor a narrowboat overnight?');
  await page.waitForTimeout(300);
  ok(/answer that one ourselves/i.test(missA), 'a miss is honest about needing a person');
  ok(posts.filter((p) => p.__url === 'guest-faq.php').length > missCountBefore,
    '…and the missed question feeds the owner’s teach loop');
  // The ONE status circle shares submitEnquiry's ladder: red while the send
  // would be refused, green exactly when it would go.
  await fill(true, true);
  await page.evaluate(() => { document.getElementById('enq-message').value = ''; enqLiveSync(); });
  const dotRed = await page.evaluate(() => document.getElementById('enq-details-dot').classList.contains('todo'));
  ok(dotRed, 'party missing → the circle is the red ring');
  await fill(true, true);
  await page.evaluate(() => enqLiveSync());
  const dotGreen = await page.evaluate(() => document.getElementById('enq-details-dot').classList.contains('done'));
  ok(dotGreen, 'everything sendable → the circle is the green ✓');
  // The receipt: a successful anonymous send lands on step 3 with the enquiry
  // said back — cottage, dates, a £ figure — above the what-happens-next rows.
  await send();
  const sent11 = await page.evaluate(() => ({
    step: document.getElementById('enquire-step-account').style.display,
    sum: (document.getElementById('enq-sent-sum') || {}).textContent || '',
    sumShown: (document.getElementById('enq-sent-sum') || {}).style.display !== 'none',
    steps: (document.querySelector('#enquire-step-account .enq-sched') || {}).textContent || '',
  }));
  ok(sent11.step === '' && sent11.sumShown && /Jollyboat/.test(sent11.sum) && /£[\d.,]+/.test(sent11.sum),
    `sent → the receipt says the enquiry back (${sent11.sum.replace(/\s+/g, ' ').slice(0, 60)})`);
  ok(/We read your enquiry/.test(sent11.steps) && /payment link/.test(sent11.steps),
    '…above the what-happens-next steps');

  console.log('10. the owner can SEE it on the booking, at arrival time');
  // Storing it on the booking is only worth anything if it is on screen where the
  // owner looks when the guest turns up. Driven through the real hub rather than
  // asserting the field, because a value nothing renders is the same as no value.
  const hub = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  hub.on('pageerror', (e) => { console.log('  PAGEERR:', e.message); fails++; });
  await hub.addInitScript(() => { if (navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(() => {}); });
  const bk = (id, name, noDogsAt) => ({
    id, prop_key: 'jollyboat', name, email: 'g@example.com', phone: '', address: '1 Lane', postcode: 'NR25 7AB',
    check_in: d(4), check_out: d(7), check_in_time: '15:00', check_out_time: '10:00', adults: 2, children: 0,
    payment: 'unpaid', deposit_paid: 0, payment_method: '', payment_date: '', agreed_total: 440,
    agreed_per_night: 130, agreed_nights: 3, agreed_nightly: 390, agreed_booking_fee: 50, agreed_txn_pct: 0,
    agreed_txn_fee: 0, agreed_on: d(0), hold_status: 'none', notes: '',
    terms_accepted_at: '2026-07-01 09:00:00', terms_version: '1',
    no_dogs_at: noDogsAt,
  });
  await hub.route(/\.php/, (route) => {
    const url = route.request().url();
    const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (route.request().method() === 'POST') return json({ ok: true, events: [], logs: {} });
    if (url.includes('bookings.php')) return json({ bookings: [bk(1, 'Declared Guest', '2026-07-01 09:00:00'), bk(2, 'Owner Added', null)] });
    if (url.includes('rates.php')) return json({ properties: [{ prop_key: 'jollyboat', name: 'Jollyboat', slug: 'jollyboat', couple_rate: 130, extra_adult_rate: 0, child_rate: 0, booking_fee: 50, transaction_pct: 0, lastmin_pct: 0, lastmin_days: 0, max_adults: 4, max_children: 2, max_total: 4, sort_order: 1 }], seasons: {}, occupancy: {} });
    return json({ ok: true, bookings: [], enquiries: [], properties: [], seasons: {}, occupancy: {}, content: {}, blocks: [], ranges: [], payments: [], years: [] });
  });
  await hub.goto(`${base}/index.html`, { waitUntil: 'domcontentloaded' });
  await hub.waitForTimeout(1300);
  await hub.evaluate(() => { isAuthenticated = true; document.body.classList.add('owner-mode'); });
  await hub.evaluate(() => window.loadAdminBundle());
  await hub.waitForTimeout(700);
  await hub.evaluate(async () => { nav('view-backoffice'); await initBackOffice(); });
  await hub.waitForTimeout(1200);
  // openBookingHub takes the CLIENT id ('b1'), not the numeric dbId.
  const hubText = async (id) => {
    await hub.evaluate((i) => openBookingHub(i), id);
    await hub.waitForTimeout(700);
    // The No-dog row lives inside the Guest details FOLD now (the
    // only-what-needs-seeing hub) — open it the way the owner does, or
    // innerText (which is '' for hidden content) reads an empty card.
    await hub.evaluate(() => { const f = document.getElementById('bhub-fold-guest'); if (f && f.hidden) bhubFoldToggle('guest'); });
    return hub.evaluate(() => (document.querySelector('#booking-hub-content') || document.body).innerText);
  };
  const declared = await hubText('b1');
  ok(/no dog/i.test(declared), 'the booking hub has a "No dog" row');
  // DD/MM/YYYY, the house's everywhere-rule — this row printed the raw SQL
  // timestamp ('Confirmed 2026-07-01 10:00:00') until the hub density pass.
  ok(/Confirmed 01\/07\/2026/.test(declared),
    `…showing WHEN they confirmed it, in the house date form (${(declared.match(/NO DOG\n([^\n]*)/i) || ['', 'nothing'])[1]})`);
  // …and it must not claim a declaration for a booking the owner typed in.
  const ownerAdded = await hubText('b2');
  ok(/no dog/i.test(ownerAdded) && /Not recorded/i.test(ownerAdded),
    'an owner-added booking says Not recorded rather than inventing one');

  console.log(fails ? `\n  NO-DOGS SUITE FAILED ❌ (${fails})` : '\n  NO-DOGS SUITE PASSED ✅');
  await done(fails);
})();
