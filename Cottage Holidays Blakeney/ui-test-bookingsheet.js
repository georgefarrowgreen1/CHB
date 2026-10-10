// THE BOOKING SHEET'S MONEY — the add/edit audit's defects, driven on the real sheet
// (#edit-modal .modal-box.bks) against a stub that RECORDS what each save posts. Every
// section fails on the code before the fix:
//   1. "Some" reads money as written ("1,250.00" is £1,250, not £1)
//   2. inside the balance window "Some" prefills nothing (the whole stay is "All of it"),
//      a sum that covers the stay is refused before posting, and a refusal is IN VIEW
//   3. "All of it" on Add posts the refundable deposit as collected
//   4. a refundable-deposit change keeps the agreed price and counts as a change
//   5. "A discount" never re-prices a custom price above the standard
//   6. a paid booking's custom price shows (and can change) once its stay changes
//   7. an edit offers no "A new cottage"; 8. a party brought down comes back
//   9. an enquiry's agreed price shows, and travels only with its own stay
//  10. the enquiry calendar does not promise "Add asks first"
//  11. a Host who cannot set prices is shown no price or deposit controls
const { d, boot } = require('./ui-test-lib'); // pins TZ=Europe/London at require time
let fails = 0;
const ok = (b, m) => { console.log(`  ${b ? '✓' : '✗'} ${m}`); if (!b) fails++; };

(async () => {
  const { page, base, done } = await boot({ viewport: { width: 1000, height: 900 } });
  await page.emulateMedia({ reducedMotion: 'reduce' });

  const posts = [];
  let failNextAdd = false;
  let nextEnq = 60;
  const snap = { agreed_txn_pct: 0, agreed_txn_fee: 0, agreed_on: d(-10), hold_status: 'none', phone: '', address: '', postcode: '', check_in_time: '15:00', check_out_time: '10:00', notes: '', prop_key: 'jollyboat', children: 0 };
  const bookings = [
    // Paid in full (rental £300 custom + the £75 deposit in cash) — the paid lock.
    Object.assign({}, snap, { id: 41, name: 'Paula Paid', email: 'p@e.com', check_in: d(30), check_out: d(33), adults: 2, price_override: 300, agreed_total: 300, agreed_nightly: 390, agreed_per_night: 130, agreed_nights: 3, agreed_booking_fee: 75, payment: 'paid', deposit_paid: 375, payment_method: 'Cash', payment_date: d(-2) }),
    // A custom price ABOVE the standard £390.
    Object.assign({}, snap, { id: 42, name: 'Premium Pete', email: 'pp@e.com', check_in: d(50), check_out: d(53), adults: 2, price_override: 500, agreed_total: 500, agreed_nightly: 390, agreed_per_night: 130, agreed_nights: 3, agreed_booking_fee: 75, payment: 'unpaid', deposit_paid: 0 }),
    // Agreed at OLD rates (£100 a night) against today's £130.
    Object.assign({}, snap, { id: 43, name: 'Dora Dep', email: 'dd@e.com', check_in: d(60), check_out: d(63), adults: 2, agreed_total: 300, agreed_nightly: 300, agreed_per_night: 100, agreed_nights: 3, agreed_booking_fee: 75, payment: 'unpaid', deposit_paid: 0 }),
    // A party of four for the cottage that sleeps six.
    Object.assign({}, snap, { id: 44, name: 'Party Pat', email: 'pa@e.com', check_in: d(70), check_out: d(72), adults: 3, children: 1, agreed_total: 260, agreed_nightly: 260, agreed_per_night: 130, agreed_nights: 2, agreed_booking_fee: 75, payment: 'unpaid', deposit_paid: 0 }),
  ];
  const enqRow = (id, name, ci, co, price) => ({ id, prop_key: 'jollyboat', name, email: name.split(' ')[0].toLowerCase() + '@e.com', phone: '', address: '1 Quay', postcode: 'NR25 7NA', check_in: ci, check_out: co, check_in_time: '15:00', check_out_time: '10:00', adults: 2, children: 0, message: 'Hello', agreed_price: price, plan_pct: null, plan_due: null, created_at: d(-1) + ' 10:00:00' });
  const enqs = [enqRow(51, 'Eve Enquirer', d(80), d(83), 250), enqRow(52, 'Ed Same', d(90), d(93), 200)];

  await page.route(/\.php/, (route) => {
    const url = route.request().url();
    const post = route.request().postData() || '';
    let body = {}; try { body = JSON.parse(post || '{}'); } catch (e) {}
    const act = body.action || '';
    const json = (o, status) => route.fulfill({ status: status || 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (url.includes('admin-bootstrap.php')) return json({ ok: false });
    if (url.includes('rates.php')) {
      return json({ properties: [
        { prop_key: 'jollyboat', name: 'Jollyboat', slug: 'jollyboat', couple_rate: 130, extra_adult_rate: 0, child_rate: 0, booking_fee: 75, transaction_pct: 0, lastmin_pct: 0, lastmin_days: 0, sort_order: 1, max_adults: 4, max_children: 2, max_total: 6 },
        { prop_key: 'pimpernel', name: 'Pimpernel', slug: 'pimpernel', couple_rate: 120, extra_adult_rate: 0, child_rate: 0, booking_fee: 50, transaction_pct: 0, lastmin_pct: 0, lastmin_days: 0, sort_order: 2, max_adults: 2, max_children: 0, max_total: 2 },
      ], seasons: {}, occupancy: { jollyboat: { maxAdults: 4, maxChildren: 2, maxTotal: 6 }, pimpernel: { maxAdults: 2, maxChildren: 0, maxTotal: 2 } }, payment: { depositPct: 25, balanceDays: 30 } });
    }
    if (url.includes('bookings.php')) {
      if (act === 'add' || act === 'update') {
        posts.push(body);
        if (act === 'add' && failNextAdd) { failNextAdd = false; return json({ error: 'A deposit must be more than £0 and less than the total' }, 400); }
        return json({ ok: true, id: 99, material: false, email: { guest: { ok: true } } });
      }
      if (act) return json({ ok: true, logs: {}, history: [] });
      return json({ bookings });
    }
    if (url.includes('enquiries.php')) {
      if (act) {
        posts.push(body);
        if (act === 'submit') return json({ ok: true, id: nextEnq++ });
        return json({ ok: true });
      }
      return json({ enquiries: enqs });
    }
    return json({ ok: true, bookings: [], enquiries: [], threads: [], reviews: [], photos: [], experiences: [], events: [], logs: {}, content: {}, blocks: [], ranges: [], payments: [], seasons: {}, occupancy: {}, properties: [] });
  });

  await page.goto(`${base}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => { isAuthenticated = true; document.body.classList.add('owner-mode'); });
  await page.evaluate(() => window.loadAdminBundle());
  await page.waitForFunction(() => window.__ADMIN_LOADED === true && typeof window.bksSync === 'function');
  await page.evaluate(() => loadData());
  await page.waitForFunction(() => (dbBookings.jollyboat || []).length === 4 && enquiries.length === 2 && propertyRates.jollyboat && propertyRates.jollyboat.coupleRate === 130);

  const val = (id) => page.evaluate((x) => (document.getElementById(x) || {}).value, id);
  const txt = (id) => page.evaluate((x) => ((document.getElementById(x) || {}).textContent || '').replace(/\s+/g, ' ').trim(), id);
  const shown = (sel) => page.evaluate((s) => { const e = document.querySelector(s); return !!e && !e.hidden && getComputedStyle(e).display !== 'none' && e.getClientRects().length > 0; }, sel);
  const isOpen = () => page.evaluate(() => document.getElementById('edit-modal').classList.contains('open'));
  const openSheet = async (fn, arg) => {
    await page.evaluate(([f, a]) => window[f](a), [fn, arg]);
    await page.waitForFunction(() => document.getElementById('edit-modal').classList.contains('open') && !!document.querySelector('#edit-modal .modal-box.bks'));
  };
  const close = async () => { if (await isOpen()) await page.evaluate(() => closeModal()); };
  const addWith = async (ci, co, name) => {
    await openSheet('openAddBooking');
    await page.evaluate(([a, b, n]) => {
      document.getElementById('modal-checkin').value = a;
      document.getElementById('modal-checkout').value = b;
      document.getElementById('modal-name').value = n;
      document.getElementById('modal-email').value = 'x@e.com';
      updateModalPrice();
    }, [ci, co, name]);
  };
  // A successful save closes the sheet itself, after its reload: wait for that, or the
  // late close lands on the NEXT sheet the test opens.
  const closedBySave = () => page.waitForFunction(() => !document.getElementById('edit-modal').classList.contains('open'), null, { timeout: 8000 }).catch(() => {});
  const lastPost = (action) => posts.filter((p) => p.action === action).slice(-1)[0] || null;
  const waitPost = async (action, n0) => { for (let i = 0; i < 40 && posts.filter((p) => p.action === action).length <= n0; i++) await page.waitForTimeout(100); };
  // Move the checkout on the sheet's own calendar (the real route, bksDay).
  const leaveOn = async (iso) => {
    await page.click('#bks-t-out');
    await page.waitForFunction(() => document.getElementById('bks-cal-fold').classList.contains('on'));
    for (let i = 0; i < 14; i++) {
      const cell = await page.$(`#bks-cal [data-bks="day"][data-v="${iso}"]`);
      if (cell) { await cell.click(); break; }
      await page.click('#bks-cal [data-bks="nav"][data-v="1"]');
    }
    await page.waitForFunction((x) => document.getElementById('modal-checkout').value === x, iso);
  };

  console.log('1. "Some" reads money as it is written');
  await addWith(d(60), d(75), 'Sam Some'); // 15 nights at £130 = £1,950, outside the window
  await page.click('#modal-pay-seg [data-arg="deposit"]');
  ok(await val('modal-deposit-amount') === '562.50' && /The first payment is £562\.50/.test(await txt('bks-amt-s')),
    `outside the balance window "Some" prefills the first payment, 25% + the £75 deposit (${await val('modal-deposit-amount')})`);
  await page.fill('#modal-deposit-amount', '1,250.00');
  let n0 = posts.filter((p) => p.action === 'add').length;
  await page.click('#modal-save-btn');
  await waitPost('add', n0);
  await closedBySave();
  const a1 = lastPost('add') || {};
  ok(a1.payment === 'deposit' && a1.deposit === 1250, `"1,250.00" posts £1,250 (${JSON.stringify(a1.deposit)})`);
  await close();

  console.log('2. inside the balance window the first payment is the whole stay');
  await addWith(d(10), d(13), 'Win Dow'); // 3 nights = £390, 10 days out
  await page.click('#modal-pay-seg [data-arg="deposit"]');
  ok(await val('modal-deposit-amount') === '' && /whole stay, £465\.00: choose “All of it”/.test(await txt('bks-amt-s')),
    `"Some" prefills nothing and says to choose All of it (${JSON.stringify(await val('modal-deposit-amount'))} · ${await txt('bks-amt-s')})`);
  await page.fill('#modal-deposit-amount', '465');
  await page.evaluate(() => { const b = document.getElementById('bks-body'); b.scrollTop = b.scrollHeight; });
  n0 = posts.filter((p) => p.action === 'add').length;
  await page.click('#modal-save-btn');
  await page.waitForTimeout(400);
  const err2 = await page.evaluate(() => {
    const e = document.getElementById('modal-error'), b = document.getElementById('bks-body');
    const r = e.getBoundingClientRect(), br = b.getBoundingClientRect();
    return { text: e.textContent, shown: getComputedStyle(e).display !== 'none', inView: r.top >= br.top - 1 && r.bottom <= br.bottom + 1 && r.height > 0 };
  });
  ok(posts.filter((p) => p.action === 'add').length === n0 && /covers the whole stay/.test(err2.text),
    `a sum that covers the stay is refused before posting, in the owner's terms (${err2.text})`);
  ok(err2.shown && err2.inView, 'the refusal is scrolled into view, not left at the top of a scrolled sheet');
  // A SERVER refusal comes into view the same way.
  await page.fill('#modal-deposit-amount', '100');
  await page.evaluate(() => { const b = document.getElementById('bks-body'); b.scrollTop = b.scrollHeight; document.getElementById('modal-error').style.display = 'none'; });
  failNextAdd = true;
  await page.click('#modal-save-btn');
  await page.waitForFunction(() => getComputedStyle(document.getElementById('modal-error')).display !== 'none', null, { timeout: 5000 }).catch(() => {});
  const err2b = await page.evaluate(() => { const e = document.getElementById('modal-error'), b = document.getElementById('bks-body'); const r = e.getBoundingClientRect(), br = b.getBoundingClientRect(); return { text: e.textContent, inView: r.top >= br.top - 1 && r.bottom <= br.bottom + 1 && r.height > 0 }; });
  ok(/less than the total/.test(err2b.text) && err2b.inView, `the server's refusal is in view too (${err2b.text})`);
  await close();

  console.log('3. "All of it" on Add includes the refundable deposit');
  await addWith(d(40), d(43), 'Al Lofit');
  await page.click('#modal-pay-seg [data-arg="paid"]');
  n0 = posts.filter((p) => p.action === 'add').length;
  await page.click('#modal-save-btn');
  await waitPost('add', n0);
  await closedBySave();
  const a3 = lastPost('add') || {};
  ok(a3.payment === 'paid' && a3.deposit_collected === true, `it posts the deposit as collected (${JSON.stringify({ payment: a3.payment, deposit_collected: a3.deposit_collected })})`);
  await close();

  console.log('4. a new refundable deposit keeps the agreed price, and counts as a change');
  await openSheet('openEditBooking', 'b43');
  ok(/Agreed when booked/.test(await txt('bks-n-s')), `opened at its agreed price (${await txt('bks-n-s')})`);
  await page.click('#bks-dep-step [data-arg2="-25"]');
  await page.waitForTimeout(150);
  const s4 = { sub: await txt('bks-n-s'), warn: await page.evaluate(() => document.getElementById('bks-n-s').classList.contains('warn')), total: await txt('bks-tot'), conf: await page.evaluate(() => document.getElementById('bks-conf').checked), confS: await txt('bks-conf-s') };
  ok(/Agreed when booked/.test(s4.sub) && !s4.warn, `still the agreed price, not "Today's rates" (${s4.sub})`);
  ok(s4.total === '£350.00', `the total is the agreed £300 + the new £50 deposit (${s4.total})`);
  ok(s4.conf && /changed/.test(s4.confS), `the email switch turns on: the confirmation states the deposit (${s4.conf} · ${s4.confS})`);
  await close();

  console.log('5. "A discount" never re-prices a custom price above the standard');
  await openSheet('openEditBooking', 'b42');
  ok(await val('modal-price-override') === '500', 'opened at its custom £500');
  await page.click('#bks-cmode [data-v="off"]');
  await page.waitForTimeout(150);
  const s5 = { ov: await val('modal-price-override'), res: await txt('bks-c-res-l') };
  ok(s5.ov === '500' && /more/.test(s5.res), `the discount view holds £500 (${s5.ov} · ${s5.res})`);
  await page.click('#bks-cmode [data-v="total"]');
  await page.waitForTimeout(150);
  ok(await val('modal-price-override') === '500' && !(await page.evaluate(() => document.getElementById('bks-conf').checked)),
    `…and back to "A total" it is still £500, with nothing to email (${await val('modal-price-override')})`);
  await page.click('#bks-cmode [data-v="off"]');
  await page.click('#bks-c-off [data-v="10"]');
  await page.waitForTimeout(150);
  ok(await val('modal-price-override') === '351', `choosing 10% off is then 10% off the standard £390 (${await val('modal-price-override')})`);
  await close();

  console.log("6. a paid booking's custom price shows once its stay changes");
  await openSheet('openEditBooking', 'b41');
  ok(!(await shown('#modal-override-group')) && !(await shown('#bks-cus-fold.on')), 'paid in full: the price is a record, no price controls');
  await leaveOn(d(35));
  await page.waitForTimeout(150);
  const s6 = { seg: await shown('#modal-override-group'), fold: await shown('#bks-cus-fold.on'), res: await txt('bks-c-res-l'), std: await txt('bks-c-res-s') };
  ok(s6.seg && s6.fold, 'extended: the Standard | Custom switch and the custom price are back');
  ok(/£350\.00 off/.test(s6.res) && /£650\.00/.test(s6.std), `…saying the £300 is now £350 off the standard £650 (${s6.res} · ${s6.std})`);
  await close();

  console.log('7. an edit offers no "A new cottage"');
  await openSheet('openEditBooking', 'b44');
  ok(!(await page.evaluate(() => !!document.querySelector('#bks-cot-list [data-v="__new__"]'))), 'editing a booking: no "A new cottage" in the list');
  await page.evaluate(() => bksChooseCot('__new__'));
  ok(await val('modal-property') === 'jollyboat', '…and choosing it by hand does nothing');
  console.log('8. a party brought down comes back');
  await page.click('#bks-cot-row');
  await page.click('#bks-cot-list [data-v="pimpernel"]');
  await page.waitForTimeout(100);
  const p8a = [await val('modal-adults'), await val('modal-children'), await txt('modal-occ-note')];
  ok(p8a[0] === '2' && p8a[1] === '0' && /came down/.test(p8a[2]), `Pimpernel sleeps two: the party comes down and says so (${p8a.join(' / ')})`);
  await page.click('#bks-cot-row');
  await page.click('#bks-cot-list [data-v="jollyboat"]');
  await page.waitForTimeout(100);
  const p8b = [await val('modal-adults'), await val('modal-children'), await page.evaluate(() => document.getElementById('bks-conf').checked)];
  ok(p8b[0] === '3' && p8b[1] === '1' && !p8b[2], `back to Jollyboat: the party of 3 + 1 is back, and nothing changed to email (${p8b.join(' / ')})`);
  await close();
  await openSheet('openAddBooking');
  ok(await page.evaluate(() => !!document.querySelector('#bks-cot-list [data-v="__new__"]')), 'a NEW booking still offers "A new cottage"');
  await close();

  console.log("9. an enquiry's agreed price shows, and travels only with its own stay");
  await openSheet('openEditEnquiry', 'e51');
  ok(await txt('bks-tot') === '£325.00' && /Agreed price \+ the £75 deposit/.test(await txt('bks-tot-s')),
    `the sheet states the agreed £250 (+ £75 deposit) (${await txt('bks-tot')} · ${await txt('bks-tot-s')})`);
  await page.click('#bks-t-out');
  await page.waitForFunction(() => document.getElementById('bks-cal-fold').classList.contains('on'));
  ok(/An enquiry can’t move onto those/.test(await page.evaluate(() => (document.querySelector('#bks-cal .bks-calk') || {}).textContent || '')) && !/Add asks first/.test(await page.evaluate(() => (document.querySelector('#bks-cal .bks-calk') || {}).textContent || '')),
    '10. the enquiry calendar says crossed-out nights are not for it, not "Add asks first"');
  await page.click('#bks-t-out');
  await leaveOn(d(85));
  await page.waitForTimeout(150);
  ok(/Today.s rates · replaces the agreed £325\.00/.test(await txt('bks-n-s')), `moved: the sheet says saving replaces the agreed price (${await txt('bks-n-s')})`);
  posts.length = 0;
  await page.click('#modal-save-btn');
  await page.waitForFunction(() => !document.getElementById('edit-modal').classList.contains('open'), null, { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(300);
  const terms9 = posts.filter((p) => p.action === 'set_terms');
  const toast9 = await page.evaluate(() => [...document.querySelectorAll('#app-toasts .toast')].map((t) => t.textContent).join(' | '));
  ok(posts.some((p) => p.action === 'submit') && !terms9.some((t) => t.price_override === '250'), `the agreed £250 does not travel to the new dates (${JSON.stringify(terms9)})`);
  ok(/the agreed £250\.00 was for the old stay/.test(toast9), `…and the owner is told (${toast9})`);
  const sub9 = posts.find((p) => p.action === 'submit');
  ok(!!sub9 && Number(sub9.replaces_id) === 51, `the new row names the enquiry it replaces, so its age and the guest's text consent travel with it (${sub9 && sub9.replaces_id})`);
  posts.length = 0;
  await openSheet('openEditEnquiry', 'e52');
  await page.click('#modal-save-btn');
  await page.waitForFunction(() => !document.getElementById('edit-modal').classList.contains('open'), null, { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(300);
  ok(posts.some((p) => p.action === 'set_terms' && p.price_override === '200'), 'the same stay keeps its agreed price');

  console.log('11. a Host who cannot set prices sees no price or deposit controls');
  await page.evaluate(() => { window.__me = { full: false, perms: { 'mo.ask': false, 'mo.record': true, 'bk.see': true }, caps: {} }; chbAccessSync(); });
  await openSheet('openEditBooking', 'b42');
  const s11 = { seg: await shown('#modal-override-group'), fold: await shown('#bks-cus-fold.on'), dep: await shown('#modal-deposit-group'), total: await txt('bks-tot') };
  ok(!s11.seg && !s11.fold && !s11.dep, `no Standard | Custom, no custom box, no deposit stepper (${JSON.stringify(s11)})`);
  ok(s11.total === '£575.00', `the total still states the custom price (${s11.total})`);
  await close();
  await page.evaluate(() => { window.__me = null; chbAccessSync(); });

  console.log(fails ? `BOOKING SHEET TEST FAILED ❌ (${fails})` : 'BOOKING SHEET TEST PASSED ✅');
  await done(fails);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
