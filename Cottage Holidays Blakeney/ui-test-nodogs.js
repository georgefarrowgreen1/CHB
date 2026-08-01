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

  console.log('7. the owner can SEE it on the booking, at arrival time');
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
