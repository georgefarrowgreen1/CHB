// ARRIVAL EMAIL — REVIEWED BEFORE IT GOES (owner's ask: nothing leaves without
// them). The server half is gated in test-integration §23 (the daily job marks
// instead of sending; a failed send keeps the wait) and the email's own
// rendering in test-emails-render §8. What THIS suite owns is the owner's side:
//   1. the duty appears while a booking is waiting, and ESCALATES — amber with
//      room, RED when they arrive tomorrow or today
//   2. it disappears the moment the email has gone (preArrivalSent), and never
//      appears without the ready stamp — the app must not invent a chore
//   3. the notification's own route (?open=arrival-N) reaches the composer
//   4. the composer opens on the arrival email: the MESSAGE is editable and
//      prefilled from the server, the SUBJECT is generated and read-only, and
//      the facts it will add are shown so nothing is typed twice
//   5. sending posts send_arrival with the edited note — never email_guest,
//      which would wrap the words in the reply template and lose the design
const { boot } = require('./ui-test-lib'); // pins TZ=Europe/London at require time
let fails = 0;
const ok = (b, m) => { console.log(`  ${b ? '✓' : '✗'} ${m}`); if (!b) fails++; };

(async () => {
  const { page, base, done } = await boot({ viewport: { width: 1280, height: 950 } });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e && e.message)));

  const d = (n) => { const t = new Date(); const x = new Date(t.getFullYear(), t.getMonth(), t.getDate() + n); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
  const mk = (id, name, inD, extra) => Object.assign({
    id, prop_key: '21a', name, email: `${name.split(' ')[0].toLowerCase()}@example.com`,
    phone: '', address: '1 Lane', postcode: 'NR25 7AB',
    check_in: d(inD), check_out: d(inD + 3), check_in_time: '15:00', check_out_time: '10:00',
    adults: 2, children: 0, payment: 'paid', deposit_paid: 440, payment_method: 'Card', payment_date: d(-5),
    agreed_total: 440, agreed_per_night: 130, agreed_nights: 3, agreed_nightly: 390,
    agreed_booking_fee: 50, agreed_txn_pct: 0, agreed_txn_fee: 0, agreed_on: d(-20),
    hold_status: 'charged', hold_amount: 50, notes: '', reg_submitted: 1,
  }, extra || {});

  // Three states of the same feature, in one fixture:
  //   40 waiting, arrives in 3 days  → amber duty
  //   41 waiting, arrives TOMORROW   → red duty
  //   42 already sent                → no duty at all
  let bookingRows = [
    mk(40, 'Sarah Pemberton', 3, { pre_arrival_ready_at: d(0) + ' 06:00:00' }),
    mk(41, 'Tom Ackroyd', 1, { pre_arrival_ready_at: d(0) + ' 06:00:00' }),
    mk(42, 'Jo Whitlow', 2, { pre_arrival_ready_at: d(-1) + ' 06:00:00', pre_arrival_sent: d(0) + ' 07:00:00' }),
  ];
  const posts = [];
  await page.route(/\.php/, (route) => {
    const url = route.request().url();
    const json = (o, s) => route.fulfill({ status: s || 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (route.request().method() === 'POST') {
      const b = JSON.parse(route.request().postData() || '{}');
      b.__url = url.split('/').pop().split('?')[0];
      posts.push(b);
      if (b.action === 'arrival_preview') {
        return json({
          ok: true,
          subject: 'You arrive Fri 28 Aug — everything you need for 21A Westgate',
          message: 'Hello Sarah — everything you need for 21A Westgate is below. We look forward to seeing you.',
          facts: { cottage: '21A Westgate', arrive: 'Fri 28 Aug, from 3pm', leave: 'Mon 31 Aug, by 10am', address: '21A Westgate Street, Blakeney' },
        });
      }
      if (b.action === 'send_arrival') return json({ ok: true });
      if (b.__url === 'content.php' && b.action === 'get_all') return json({ ok: true, content: { 'arrival-review': '1' } });
      return json({ ok: true, events: [], logs: {}, reviews: [], photos: [] });
    }
    if (url.includes('bookings.php')) return json({ bookings: bookingRows });
    if (url.includes('cron-status.php')) return json({ stale: false, everRan: true, ageHours: 2 });
    return json({ ok: true, bookings: [], enquiries: [], properties: [], seasons: {}, occupancy: {}, content: {}, blocks: [], ranges: [], payments: [], years: [], threads: [], reviews: [], photos: [], experiences: [], events: [] });
  });

  await page.goto(`${base}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  await page.evaluate(() => { isAuthenticated = true; document.body.classList.add('owner-mode'); });
  await page.evaluate(() => window.loadAdminBundle());
  await page.waitForTimeout(600);
  await page.evaluate(async () => { if (typeof loadData === 'function') await loadData(); });
  await page.waitForTimeout(400);

  console.log('1. the duty, and how it escalates');
  const duties = await page.evaluate(() => {
    const rows = (typeof chbDuties === 'function' ? chbDuties() : []).filter((x) => x.kind === 'arrival-review');
    return rows.map((r) => ({ label: r.label, sub: r.sub, sev: r.sev, act: r.act }));
  });
  ok(duties.length === 2, `one duty per waiting booking, none for the sent one (${duties.length})`);
  const far = duties.find((r) => /Sarah/.test(r.label));
  const soon = duties.find((r) => /Tom/.test(r.label));
  ok(!!far && far.sev === 'warn', `a few days out is amber (${far && far.sev})`);
  ok(!!soon && soon.sev === 'danger', `arriving tomorrow is RED (${soon && soon.sev})`);
  ok(!!soon && /arrive tomorrow/.test(soon.sub) && /nothing has gone yet/.test(soon.sub),
    `…and says what is actually at stake (${soon && soon.sub})`);
  ok(!duties.some((r) => /Jo Whitlow/.test(r.label)), 'a booking already emailed raises no duty');

  console.log('2. no ready stamp → no duty (the app never invents a chore)');
  const none = await page.evaluate(() => {
    Object.keys(dbBookings).forEach((k) => (dbBookings[k] || []).forEach((b) => { b.preArrivalReadyAt = null; }));
    return (typeof chbDuties === 'function' ? chbDuties() : []).filter((x) => x.kind === 'arrival-review').length;
  });
  ok(none === 0, `review off / not yet ready → nothing on the list (${none})`);
  await page.evaluate(() => { Object.keys(dbBookings).forEach((k) => (dbBookings[k] || []).forEach((b) => { if (b.dbId !== 42) b.preArrivalReadyAt = '2026-01-01 06:00:00'; })); });

  console.log('3. the notification route reaches the composer');
  await page.evaluate(async () => { await chbOpenTarget('arrival-40'); });
  await page.waitForTimeout(600);
  const opened = await page.evaluate(() => ({
    open: (document.getElementById('enq-email-modal') || { classList: { contains: () => false } }).classList.contains('open'),
    subject: (document.getElementById('enq-email-subject') || {}).value || '',
    readOnly: !!(document.getElementById('enq-email-subject') || {}).readOnly,
    body: (document.getElementById('enq-email-body') || {}).value || '',
    facts: (document.querySelector('.arv-facts') || {}).textContent || '',
    arrival: !!(window.__composeTarget && window.__composeTarget.arrival),
  }));
  ok(opened.open, 'the ?open=arrival-N target opens the composer');
  ok(/You arrive/.test(opened.subject) && opened.readOnly,
    `the subject is generated and read-only (${opened.subject.slice(0, 28)}…, readOnly ${opened.readOnly})`);
  ok(/everything you need for/.test(opened.body), `the MESSAGE is prefilled and editable (${opened.body.slice(0, 40)}…)`);
  ok(/Fri 28 Aug, from 3pm/.test(opened.facts) && /Westgate Street/.test(opened.facts) && /never emailed/.test(opened.facts),
    'the facts it adds are shown, including that the code is never emailed');

  console.log('4. sending goes through the arrival template with the edited words');
  await page.evaluate(() => {
    document.getElementById('enq-email-body').value = "We've left the milk in the fridge for you.";
    return window.sendEnquiryEmail();
  });
  await page.waitForTimeout(500);
  const sent = posts.filter((p) => p.action === 'send_arrival').pop();
  const wrongPath = posts.filter((p) => p.action === 'email_guest').length;
  ok(!!sent && sent.id === 40 && /milk in the fridge/.test(sent.note || ''),
    `the send posts send_arrival with the edited note (${sent && JSON.stringify(sent.note)})`);
  ok(wrongPath === 0, 'and NOT through the reply composer, which would lose the arrival design');
  ok(await page.evaluate(() => !document.getElementById('enq-email-modal').classList.contains('open')),
    'a clean send closes the composer');
  ok(pageErrors.length === 0, `no page errors across the run (${pageErrors.slice(0, 2).join(' | ')})`);

  await done(fails);
  console.log(fails ? `\nARRIVAL-REVIEW TEST FAILED (${fails}) ❌` : '\nARRIVAL-REVIEW TEST PASSED ✅');
  process.exit(fails ? 1 : 0);
})();
