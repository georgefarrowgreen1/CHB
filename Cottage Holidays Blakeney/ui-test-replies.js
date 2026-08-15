// Saved replies — the reply library in the shared composer + Manage.
//  1. the composer grows the library chrome (injected, index.html untouched)
//  2. save-as-template: the greeting lint refuses, a clean save REVERSE-TOKENISES
//     (this guest's facts go back to {{tokens}} in the stored copy)
//  3. the picker resolves tokens per record — the balance EQUALS bookingDue's own
//     figure (equality of derivations, never a second sum)
//  4. a template's buttons ride along; the guard matrix per record, both ways
//     (card+due offers pay; transfer withholds it WITH the reason; an enquiry
//     gets no buttons at all)
//  5. send carries the action ids; a 409 refusal lands in the modal, not a toast
//  6. Manage → Saved replies: edit + delete round-trip
//  7. the store sanitiser: garbage degrades to the empty state, never a crash
const { boot } = require('./ui-test-lib'); // pins TZ=Europe/London at require time
let fails = 0;
const ok = (b, m) => { console.log(`  ${b ? '✓' : '✗'} ${m}`); if (!b) fails++; };

(async () => {
  const { page, browser, base, done } = await boot({ viewport: { width: 1000, height: 900 } });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e && e.message)));

  const d = (n) => { const t = new Date(); const x = new Date(t.getFullYear(), t.getMonth(), t.getDate() + n); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
  const bookingBase = {
    prop_key: '21a', phone: '', address: '1 Lane', postcode: 'NR25 7AB',
    check_in: d(12), check_out: d(15), check_in_time: '15:00', check_out_time: '10:00',
    adults: 2, children: 0, payment: 'unpaid', payment_date: '',
    agreed_total: 440, agreed_per_night: 130, agreed_nights: 3, agreed_nightly: 390,
    agreed_booking_fee: 50, agreed_txn_pct: 0, agreed_txn_fee: 0, agreed_on: d(0),
    hold_status: 'none', notes: '', reg_submitted: 0, reg_count: 0,
  };
  const bookingRows = [
    // card rail, £340 still to pay of the £490 guest-framing total
    { ...bookingBase, id: 9, name: 'Sarah Pemberton', email: 'sarah@example.com', payment_method: 'Card', deposit_paid: 100 },
    // transfer rail, money owing — the state a single fixture would miss
    { ...bookingBase, id: 10, name: 'Tom Ackroyd', email: 'tom@example.com', payment_method: 'Bank transfer', deposit_paid: 100, reg_submitted: 1, reg_count: 2 },
  ];
  const enquiryRows = [{
    id: 91, prop_key: '21a', name: 'Rachel Whitworth', email: 'rachel@example.com',
    check_in: d(40), check_out: d(44), adults: 2, children: 0,
    message: 'Is there parking?', created_at: d(-1) + ' 09:00:00',
  }];
  const posts = [];
  let refuseSend = false;
  await page.route(/\.php/, (route) => {
    const url = route.request().url();
    const json = (o, status) => route.fulfill({ status: status || 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (route.request().method() === 'POST') {
      const b = JSON.parse(route.request().postData() || '{}');
      b.__url = url.split('/').pop().split('?')[0];
      posts.push(b);
      if (b.__url === 'bookings.php' && b.action === 'email_guest') {
        if (refuseSend) return json({ error: 'Can\'t attach "Pay the balance" — Nothing is owed — this stay is paid in full.' }, 409);
        return json({ ok: true });
      }
      if (b.__url === 'content.php' && b.action === 'set') return json({ ok: true });
      if (b.__url === 'content.php' && b.action === 'get_all') return json({ ok: true, content: {} });
      return json({ ok: true, events: [], logs: {}, reviews: [], photos: [] });
    }
    if (url.includes('bookings.php')) return json({ bookings: bookingRows });
    if (url.includes('enquiries.php')) return json({ enquiries: enquiryRows });
    return json({ ok: true, bookings: [], enquiries: [], properties: [], seasons: {}, occupancy: {}, content: {}, blocks: [], ranges: [], payments: [], years: [] });
  });

  await page.goto(`${base}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  await page.evaluate(() => { isAuthenticated = true; document.body.classList.add('owner-mode'); });
  await page.evaluate(() => window.loadAdminBundle());
  await page.waitForTimeout(600);
  await page.evaluate(async () => { if (typeof loadData === 'function') await loadData(); });
  await page.waitForTimeout(400);

  console.log('1. the composer grows the library chrome');
  await page.evaluate(() => window.openBookingEmail('b9'));
  await page.waitForTimeout(300);
  const c1 = await page.evaluate(() => ({
    toggle: !!document.getElementById('etpl-toggle'),
    acts: (document.getElementById('etpl-acts') || {}).textContent || '',
    panelHidden: (document.getElementById('etpl-panel') || {}).hidden,
  }));
  ok(c1.toggle, 'the Saved-replies button is injected beside the drafter');
  ok(/Buttons in this email/.test(c1.acts), 'the buttons row renders on a booking');
  ok(c1.panelHidden === true, 'the picker starts closed');

  console.log('2. save-as-template: lint, then reverse-tokenisation');
  const alerts = [];
  await page.evaluate(() => { window.glassAlert = (m) => { (window.__alerts = window.__alerts || []).push(String(m)); }; });
  await page.evaluate(() => {
    document.getElementById('enq-email-body').value = 'Hello there,\n\nThe quay is six minutes away.';
    return window.emailTplSaveAs();
  });
  const lint = await page.evaluate(() => (window.__alerts || []).pop() || '');
  ok(/opens with a greeting/.test(lint) && /hello twice/.test(lint), `a greeting template is refused with the reason (${lint.slice(0, 40)}…)`);
  // A clean save: the body names THIS guest's cottage + balance, so the stored
  // copy must carry {{cottage}} / {{balance}} instead — reverse-tokenised.
  const due9 = await page.evaluate(() => gbp(bookingDue('21a', findBookingById('b9')).balance));
  await page.evaluate((due) => {
    document.getElementById('enq-email-body').value = `Just a reminder that the balance of ${due} for your stay at 21A Westgate Street is due before you arrive.`;
    return window.emailTplSaveAs();
  }, due9);
  await page.waitForTimeout(300);
  const saved = posts.filter((p) => p.__url === 'content.php' && p.action === 'set' && p.key === 'email-templates').pop();
  ok(!!saved, 'the save posts to the email-templates content key');
  const savedList = saved ? JSON.parse(saved.value) : [];
  ok(savedList.length === 1 && /\{\{balance\}\}/.test(savedList[0].body) && /\{\{cottage\}\}/.test(savedList[0].body),
    `the stored copy is tokenised for the next guest (${(savedList[0] || {}).body || ''})`);

  console.log('3. the picker resolves tokens through bookingDue');
  // Seed a library with a button-carrying template (the mirrors are the read path).
  await page.evaluate(() => {
    const lib = JSON.stringify([
      { id: 'bal', name: 'A nudge about the balance', body: 'Just a quick note that the balance of {{balance}} for {{dates}} is due before you arrive.', actions: ['pay', 'invoice'], uses: 9 },
      { id: 'quay', name: 'The quay and the beach', body: 'The quay is six minutes on foot from {{cottage}}.', actions: [], uses: 14 },
    ]);
    siteContent['email-templates'] = lib;
    adminPrivateContent['email-templates'] = lib;
    document.getElementById('enq-email-body').value = '';
    window.emailTplToggle();
  });
  await page.waitForTimeout(250);
  const p3 = await page.evaluate(() => ({
    rows: Array.from(document.querySelectorAll('#etpl-panel .etpl-row .etpl-row-name')).map((e) => e.textContent.trim()),
    disabled: document.querySelectorAll('#etpl-panel .etpl-row[disabled]').length,
  }));
  ok(p3.rows.length === 2 && /quay/.test(p3.rows[0]), `both templates listed, most-used first (${p3.rows.join(' | ')})`);
  ok(p3.disabled === 0, 'nothing is withheld on a booking with money owing');
  await page.evaluate(() => window.emailTplInsert('bal'));
  await page.waitForTimeout(300);
  const p3b = await page.evaluate(() => ({
    body: document.getElementById('enq-email-body').value,
    chips: Array.from(document.querySelectorAll('.etpl-chip')).map((c) => c.textContent.trim()),
    primary: document.querySelectorAll('.etpl-chip.is-primary').length,
  }));
  ok(p3b.body.includes(due9) && !/\{\{/.test(p3b.body), `the balance token resolves to bookingDue's own figure (${due9})`);
  ok(p3b.chips.length === 2 && /Pay the balance/.test(p3b.chips[0]) && p3b.primary === 1,
    `the template's buttons ride along, first as Primary (${p3b.chips.length} chips)`);
  await page.evaluate(() => window.emailTplUndo());
  const p3c = await page.evaluate(() => ({
    body: document.getElementById('enq-email-body').value,
    chips: document.querySelectorAll('.etpl-chip').length,
  }));
  ok(p3c.body === '' && p3c.chips === 0, 'undo restores the words AND the buttons together');

  console.log('4. the guard matrix per record, both ways');
  // Re-insert for the send test below, then check the transfer-rail booking.
  await page.evaluate(() => window.emailTplInsert('bal'));
  await page.waitForTimeout(200);
  const sendBody = await page.evaluate(() => document.getElementById('enq-email-body').value);
  await page.evaluate(() => window.openBookingEmail('b10'));
  await page.waitForTimeout(300);
  const g10 = await page.evaluate(() => {
    window.emailTplToggle();
    const f = emailTplFacts();
    return {
      payWhy: etplActGuard('pay', f),
      invWhy: etplActGuard('invoice', f),
      regWhy: etplActGuard('register', f),
      carryOff: document.querySelectorAll('#etpl-panel .etpl-carry.is-off').length,
    };
  });
  ok(/transfer/.test(g10.payWhy) && /invoice/.test(g10.payWhy), `pay withheld on the transfer rail WITH the reason (${g10.payWhy.slice(0, 44)}…)`);
  ok(g10.invWhy === '', 'invoice still offered off the card rail');
  ok(/already submitted/.test(g10.regWhy), 'register withheld once submitted');
  ok(g10.carryOff >= 1, "the picker strikes through a template's unavailable buttons");
  const gEnq = await page.evaluate(() => {
    window.openEnquiryEmail(enquiries[0].id);
    return (document.getElementById('etpl-acts') || {}).textContent || '';
  });
  ok(/Buttons need a booking/.test(gEnq), 'an enquiry gets no buttons row — just the sentence saying why');

  console.log('5. send carries the actions; a 409 lands in the modal');
  await page.evaluate((body) => {
    window.openBookingEmail('b9');
    document.getElementById('enq-email-body').value = body;
  }, sendBody);
  await page.waitForTimeout(250);
  await page.evaluate(() => { __etplChosen = ['pay', 'invoice']; etplRender(); });
  await page.evaluate(() => window.sendEnquiryEmail());
  await page.waitForTimeout(400);
  const sent = posts.filter((p) => p.action === 'email_guest').pop();
  ok(!!sent && Array.isArray(sent.actions) && sent.actions.join() === 'pay,invoice',
    `the send POST carries the attached action ids (${sent && JSON.stringify(sent.actions)})`);
  ok(await page.evaluate(() => !document.getElementById('enq-email-modal').classList.contains('open')), 'a clean send closes the composer');
  refuseSend = true;
  await page.evaluate((body) => {
    window.openBookingEmail('b9');
    document.getElementById('enq-email-body').value = body;
    __etplChosen = ['pay'];
    etplRender();
    return window.sendEnquiryEmail();
  }, sendBody);
  await page.waitForTimeout(400);
  const refused = await page.evaluate(() => ({
    open: document.getElementById('enq-email-modal').classList.contains('open'),
    msg: (document.getElementById('enq-email-msg') || {}).textContent || '',
  }));
  ok(refused.open && /Can't attach/.test(refused.msg), `the server's refusal lands in the modal with its sentence (${refused.msg.slice(0, 52)}…)`);
  refuseSend = false;
  await page.evaluate(() => window.closeEnquiryEmailModal());

  console.log('6. Manage → Saved replies: edit + delete round-trip');
  await page.evaluate(() => { window.settingsOpen && nav('view-settings'); window.settingsOpen('replies'); });
  await page.waitForTimeout(300);
  const m1 = await page.evaluate(() => Array.from(document.querySelectorAll('#replies-body .etpl-row-name')).map((e) => e.textContent.trim()));
  ok(m1.length === 2, `the Manage page lists the library (${m1.length} rows)`);
  await page.evaluate(() => window.emailTplEditOpen('bal'));
  await page.evaluate(() => {
    document.getElementById('etpl-ed-name').value = 'Renamed by the gate';
    return window.emailTplEditSave('bal');
  });
  await page.waitForTimeout(300);
  const m2 = await page.evaluate(() => Array.from(document.querySelectorAll('#replies-body .etpl-row-name')).map((e) => e.textContent.trim()));
  ok(m2.includes('Renamed by the gate'), 'an edit sticks and repaints');
  const editPost = posts.filter((p) => p.action === 'set' && p.key === 'email-templates').pop();
  ok(!!editPost && /Renamed by the gate/.test(editPost.value), 'the edit reaches the store');
  await page.evaluate(() => { window.glassConfirm = async () => true; });
  await page.evaluate(() => window.emailTplDelete('quay'));
  await page.waitForTimeout(300);
  const m3 = await page.evaluate(() => Array.from(document.querySelectorAll('#replies-body .etpl-row-name')).map((e) => e.textContent.trim()));
  ok(m3.length === 1 && !/quay/i.test(m3.join()), 'delete removes the row');

  console.log('7. the store sanitiser');
  const s7 = await page.evaluate(() => {
    siteContent['email-templates'] = '{not json';
    adminPrivateContent['email-templates'] = '{not json';
    window.openBookingEmail('b9');
    window.emailTplToggle();
    return {
      list: emailTplList().length,
      none: /Nothing saved yet/.test((document.getElementById('etpl-panel') || {}).textContent || ''),
    };
  });
  ok(s7.list === 0 && s7.none, 'garbage in the store degrades to the honest empty state');
  ok(pageErrors.length === 0, `no page errors across the run (${pageErrors.slice(0, 2).join(' | ')})`);

  await done(fails);
  console.log(fails ? `\nREPLIES TEST FAILED (${fails}) ❌` : '\nREPLIES TEST PASSED ✅');
  process.exit(fails ? 1 : 0);
})();
