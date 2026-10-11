// EMAIL A GUEST — the one sheet for a booking, an enquiry and the arrival review
// (admin.js "Email a guest"). What it must keep true:
//   1. it opens on the right person: "Email Sarah", their name and address in To,
//      the email's own greeting and the sender around the message box
//   2. To unfolds their stay; the switches default from the record (a past,
//      paid-up stay leaves both out; a stay with money owing includes both)
//   3. Send reads as waiting until there is a message, and an empty send says so
//   4. a draft is kept on this device: closing keeps it, a dot marks the envelope,
//      reopening restores it
//   5. Preview asks the server for the email with the switches' choices
//   6. Send closes the sheet and WAITS five seconds: nothing is posted until then,
//      Undo brings everything back, and the post carries the subject and switches
//   7. the arrival review is the same sheet, titled for it, posting send_arrival
//   8. on a phone it is a bottom sheet that drags down to close; on a computer, a card
const { boot } = require('./ui-test-lib'); // pins TZ=Europe/London at require time
let fails = 0;
const ok = (b, m) => { console.log(`  ${b ? '✓' : '✗'} ${m}`); if (!b) fails++; };

(async () => {
  const { page, base, done } = await boot({ viewport: { width: 390, height: 844 } });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e && e.message)));

  const d = require('./ui-test-lib').d; // the harness's day (today, UK)
  const mk = (id, name, inD, extra) => Object.assign({
    id, prop_key: '21a', name, email: `${name.split(' ')[0].toLowerCase()}@example.com`,
    phone: '07700 900123', address: '1 Lane', postcode: 'NR25 7AB',
    check_in: d(inD), check_out: d(inD + 3), check_in_time: '15:00', check_out_time: '10:00',
    adults: 2, children: 0, payment: 'paid', deposit_paid: 390, payment_method: 'Card', payment_date: d(-5),
    agreed_total: 390, agreed_per_night: 130, agreed_nights: 3, agreed_nightly: 390,
    agreed_booking_fee: 50, agreed_txn_pct: 0, agreed_txn_fee: 0, agreed_on: d(-20),
    hold_status: 'charged', hold_amount: 50, notes: '', reg_submitted: 1,
  }, extra || {});
  // 50: upcoming, money still owed. 51: a past stay, paid in full.
  const bookingRows = [
    mk(50, 'Sarah Pemberton', 40, { payment: 'deposit', deposit_paid: 100, pre_arrival_ready_at: d(0) + ' 06:00:00' }),
    mk(51, 'Tina Nudd', -10),
  ];
  const enquiryRows = [{ id: 7, prop_key: '21a', name: 'Rachel Owen', email: 'rachel@example.com', phone: '', check_in: d(30), check_out: d(33), adults: 2, children: 0, message: 'Is there parking?', created_at: d(-1) + ' 09:00:00' }];
  const posts = [];
  await page.route(/\.php/, (route) => {
    const url = route.request().url();
    const json = (o, s) => route.fulfill({ status: s || 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (route.request().method() === 'POST') {
      const b = JSON.parse(route.request().postData() || '{}');
      b.__url = url.split('/').pop().split('?')[0];
      posts.push(b);
      if (b.action === 'arrival_preview') {
        return json({ ok: true, subject: 'See you Fri: directions and everything for 21A Westgate', message: 'Hello Sarah — everything you need for 21A Westgate is below.', facts: { arrive: 'Fri, from 3pm', leave: 'Mon, by 10am', address: '21A Westgate Street' } });
      }
      if (b.action === 'email_preview') return json({ ok: true, subject: b.subject, html: '<!doctype html><html><head><meta name="color-scheme" content="light dark"><style>@media (prefers-color-scheme: dark){body{background:#000}}</style></head><body><h1>' + (b.subject || '') + '</h1><p data-preview="1">' + (b.message || '') + '</p></body></html>' });
      return json({ ok: true, events: [], logs: {}, reviews: [], photos: [] });
    }
    if (url.includes('bookings.php')) return json({ bookings: bookingRows });
    if (url.includes('enquiries.php')) return json({ enquiries: enquiryRows });
    if (url.includes('cron-status.php')) return json({ stale: false, everRan: true, ageHours: 2 });
    return json({ ok: true, bookings: [], enquiries: [], properties: [], seasons: {}, occupancy: {}, content: {}, blocks: [], ranges: [], payments: [], years: [], threads: [], reviews: [], photos: [], experiences: [], events: [] });
  });

  await page.goto(`${base}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  await page.evaluate(() => { isAuthenticated = true; document.body.classList.add('owner-mode'); window.__me = { id: 1, name: 'George Farrow', full: true }; localStorage.removeItem('chb-cmp-draft:booking:50'); });
  await page.evaluate(() => window.loadAdminBundle());
  await page.waitForTimeout(600);
  await page.evaluate(async () => { if (typeof loadData === 'function') await loadData(); });
  await page.waitForTimeout(400);
  const sheet = () => page.evaluate(() => {
    const m = document.getElementById('enq-email-modal');
    const g = (id) => (document.getElementById(id) || {});
    return {
      open: !!m && m.classList.contains('open'),
      title: g('enq-email-title').textContent || '',
      toName: g('cmp-to-name').textContent || '',
      toMail: g('cmp-to-mail').textContent || '',
      subject: g('enq-email-subject').value || '',
      body: g('enq-email-body').value || '',
      greet: g('cmp-greet').textContent || '',
      sign: g('cmp-sign').textContent || '',
      sendWaits: g('enq-email-send').getAttribute ? g('enq-email-send').getAttribute('aria-disabled') : null,
      stay: !!g('cmp-inc-stay').checked,
      money: !!g('cmp-inc-money').checked,
      staySub: g('cmp-stay-sub').textContent || '',
      moneySub: g('cmp-money-sub').textContent || '',
      moneyLbl: g('cmp-money-lbl').textContent || '',
      err: g('enq-email-msg').textContent || '',
    };
  });

  console.log('1. it opens on the right person');
  await page.evaluate(() => openBookingEmail('b50'));
  await page.waitForTimeout(600);
  let s = await sheet();
  ok(s.open, 'the sheet is open');
  ok(s.title === 'Email Sarah', `titled for the guest (${s.title})`);
  ok(s.toName === 'Sarah Pemberton' && s.toMail === 'sarah@example.com', `To names them (${s.toName} · ${s.toMail})`);
  ok(s.subject === 'Your stay at 21A Westgate', `a subject that fits (${s.subject})`);
  ok(s.greet === 'Hello Sarah,', `the email's own greeting sits above the box (${s.greet})`);
  ok(/George/.test(s.sign), `signed by the person signed in (${s.sign})`);

  console.log('2. To unfolds the stay; the switches default from the record');
  await page.click('#cmp-to');
  await page.waitForTimeout(500);
  const facts = await page.evaluate(() => ({ text: document.getElementById('enq-email-context').textContent, on: document.getElementById('cmp-ctx').classList.contains('on'), exp: document.getElementById('cmp-to').getAttribute('aria-expanded') }));
  ok(facts.on && facts.exp === 'true', 'the To row unfolds and says so');
  ok(/Stay/.test(facts.text) && /Guests/.test(facts.text) && /Payment/.test(facts.text) && /to pay/.test(facts.text), `stay, guests and what is owed (${facts.text.replace(/\s+/g, ' ').slice(0, 120)})`);
  ok(s.stay && s.money, 'money owed on an upcoming stay: both included');
  ok(/still to pay/.test(s.moneySub), `the payment row says what is left (${s.moneySub})`);

  console.log('3. Send waits for a message');
  ok(s.sendWaits === 'true', 'Send reads as waiting with no message');
  const before = posts.length;
  await page.click('#enq-email-send', { force: true }); // aria-disabled reads as waiting, never blocks the tap
  await page.waitForTimeout(300);
  s = await sheet();
  ok(/Write a message first/.test(s.err) && s.open, `an empty send says so and stays open (${s.err})`);
  ok(!posts.slice(before).some((p) => p.action === 'email_guest'), '…and posts nothing');
  await page.fill('#enq-email-body', 'Parking is on Back Lane this week.');
  await page.waitForTimeout(800);
  s = await sheet();
  ok(s.sendWaits === 'false' && s.err === '', 'typing readies Send and clears the error');

  console.log('4. a draft is kept on this device');
  const saved = await page.evaluate(() => ({ store: localStorage.getItem('chb-cmp-draft:booking:50'), shown: document.getElementById('cmp-saved').classList.contains('on') }));
  ok(!!saved.store && /Back Lane/.test(saved.store) && saved.shown, '"Saved on this device", and it is');
  await page.click('#cmp-close');
  await page.waitForTimeout(500);
  const kept = await page.evaluate(() => ({ open: document.getElementById('enq-email-modal').classList.contains('open'), toast: document.getElementById('cmp-toast').textContent }));
  ok(!kept.open && /Draft kept for Sarah/.test(kept.toast), `closing keeps the draft and says so (${kept.toast})`);
  await page.evaluate(() => { const btn = document.createElement('button'); btn.id = 'fake-env'; btn.setAttribute('data-act', 'openBookingEmail'); btn.setAttribute('data-args', '["b50"]'); document.body.appendChild(btn); composeDraftDots(); });
  ok(await page.evaluate(() => !!document.querySelector('#fake-env > .cmp-draft-dot')), 'a dot marks the envelope while a draft waits');
  await page.evaluate(() => openBookingEmail('b50'));
  await page.waitForTimeout(500);
  s = await sheet();
  ok(s.body === 'Parking is on Back Lane this week.', 'reopening restores the draft');

  console.log('5. Preview asks the server for the email as chosen');
  await page.click('#cmp-inc-money', { force: true });
  await page.waitForTimeout(200);
  s = await sheet();
  ok(!s.money && s.moneySub === 'Left out', `a switch leaves the payment out (${s.moneySub})`);
  await page.click('#enq-email-preview-btn');
  await page.waitForTimeout(900);
  const pv = posts.filter((p) => p.action === 'email_preview').pop() || {};
  ok(pv.include_stay === 1 && pv.include_money === 0 && pv.subject === 'Your stay at 21A Westgate', `the preview carries the choices (${JSON.stringify({ s: pv.include_stay, m: pv.include_money })})`);
  const frame = await page.frameLocator('#enq-email-preview-frame').locator('[data-preview="1"]').textContent().catch(() => '');
  ok(/Back Lane/.test(frame || ''), 'the email itself renders in the frame');
  const inbox = await page.evaluate(() => ({ s: document.getElementById('cmp-pv-subj').textContent, p: document.getElementById('cmp-pv-pre').textContent }));
  ok(inbox.s === 'Your stay at 21A Westgate' && /Back Lane/.test(inbox.p), 'their inbox line: the subject, then your first words');
  await page.click('#cmp-tab-write');
  await page.waitForTimeout(300);

  console.log('6. Send waits five seconds, and Undo means it');
  const n0 = posts.filter((p) => p.action === 'email_guest').length;
  await page.click('#enq-email-send');
  await page.waitForTimeout(600);
  const holding = await page.evaluate(() => ({ open: document.getElementById('enq-email-modal').classList.contains('open'), toast: document.getElementById('cmp-toast').textContent, on: document.getElementById('cmp-toast').classList.contains('on') }));
  ok(!holding.open && holding.on && /Sending to Sarah/.test(holding.toast) && /Undo/.test(holding.toast), `the sheet closes and a countdown offers Undo (${holding.toast.replace(/\s+/g, ' ')})`);
  ok(posts.filter((p) => p.action === 'email_guest').length === n0, 'nothing is posted inside the five seconds');
  await page.click('#cmp-undo');
  await page.waitForTimeout(700);
  s = await sheet();
  ok(s.open && s.body === 'Parking is on Back Lane this week.' && !s.money, 'Undo brings the sheet back with everything in it');
  await page.waitForTimeout(5000);
  ok(posts.filter((p) => p.action === 'email_guest').length === n0, '…and nothing goes after the five seconds');
  await page.click('#enq-email-send');
  await page.waitForTimeout(5800);
  const sent = posts.filter((p) => p.action === 'email_guest');
  ok(sent.length === n0 + 1, `one post once the five seconds are up (${sent.length - n0})`);
  const last = sent.pop() || {};
  ok(last.id === 50 && last.subject === 'Your stay at 21A Westgate' && last.include_stay === 1 && last.include_money === 0 && /Back Lane/.test(last.message), 'it carries the subject, the message and the switches');
  const after = await page.evaluate(() => ({ store: localStorage.getItem('chb-cmp-draft:booking:50'), toast: document.getElementById('cmp-toast').textContent }));
  ok(!after.store, 'the draft is gone once it has really sent');
  ok(/Sent to Sarah/.test(after.toast), `a tick says it went (${after.toast})`);

  console.log('7. a past, paid-up stay leaves both out to start with');
  await page.evaluate(() => openBookingEmail('b51'));
  await page.waitForTimeout(500);
  s = await sheet();
  ok(!s.stay && !s.money, 'both switches off');
  ok(/the stay is over/.test(s.staySub) && /paid in full/.test(s.moneySub), `and the rows say why (${s.staySub} · ${s.moneySub})`);
  await page.fill('#enq-email-body', 'Thanks for staying.');
  await page.click('#enq-email-send');
  await page.evaluate(() => composeFlush());
  await page.waitForTimeout(400);
  const flushed = posts.filter((p) => p.action === 'email_guest').pop() || {};
  ok(flushed.id === 51 && flushed.include_stay === 0 && flushed.include_money === 0, 'leaving the page (composeFlush) sends what is waiting at once');

  console.log('8. an enquiry: "Your enquiry about", and the quote');
  await page.evaluate(() => openEnquiryEmail('e7'));
  await page.waitForTimeout(500);
  s = await sheet();
  ok(s.title === 'Email Rachel' && s.subject === 'Your enquiry about 21A Westgate', `${s.title} · ${s.subject}`);
  ok(s.moneyLbl === 'Your quote', `the money row is the quote (${s.moneyLbl})`);
  await page.fill('#enq-email-body', 'Yes, there is parking.');
  await page.click('#enq-email-send');
  await page.evaluate(() => composeFlush());
  await page.waitForTimeout(300);
  const eq = posts.filter((p) => p.action === 'email_guest').pop() || {};
  ok(eq.__url === 'enquiries.php' && eq.id === 7, 'posts to the enquiry endpoint');
  await page.evaluate(() => localStorage.removeItem('chb-cmp-draft:enquiry:7'));

  console.log('9. the arrival review is the same sheet, dressed for it');
  await page.evaluate(() => openArrivalReview('b50'));
  await page.waitForTimeout(800);
  const arv = await page.evaluate(() => ({
    title: document.getElementById('enq-email-title').textContent,
    ro: document.getElementById('enq-email-subject').readOnly,
    body: document.getElementById('enq-email-body').value,
    adds: getComputedStyle(document.getElementById('cmp-adds-wrap')).display,
    facts: (document.querySelector('.arv-facts') || {}).textContent || '',
  }));
  ok(arv.title === 'Arrival email' && arv.ro, 'titled "Arrival email", the subject read-only');
  ok(/everything you need/.test(arv.body), 'the message is prefilled from the server');
  ok(arv.adds === 'none' && /Westgate Street/.test(arv.facts), 'its own facts shown, the reply extras hidden');
  await page.click('#enq-email-send');
  await page.evaluate(() => composeFlush());
  await page.waitForTimeout(300);
  ok(posts.some((p) => p.action === 'send_arrival' && p.id === 50 && /everything you need/.test(p.note)), 'it sends through send_arrival');
  await page.waitForTimeout(300);
  await page.evaluate(() => openBookingEmail('b50'));
  await page.waitForTimeout(400);
  const back = await page.evaluate(() => ({ title: document.getElementById('enq-email-title').textContent, ro: document.getElementById('enq-email-subject').readOnly, facts: document.getElementById('arv-facts-host').innerHTML.trim(), adds: getComputedStyle(document.getElementById('cmp-adds-wrap')).display }));
  ok(back.title === 'Email Sarah' && !back.ro && back.facts === '' && back.adds !== 'none', 'an ordinary email afterwards has none of the review left on it');

  console.log('10. a phone: a bottom sheet that drags down to close');
  await page.waitForTimeout(600); // let the rise finish before measuring where it rests
  const geo = await page.evaluate(() => {
    const r = document.getElementById('cmp-sheet').getBoundingClientRect();
    return { bottom: Math.round(r.bottom), w: Math.round(r.width), vw: innerWidth, vh: innerHeight, over: document.documentElement.scrollWidth > innerWidth };
  });
  ok(geo.bottom === geo.vh && geo.w === geo.vw, `edge to edge on the bottom (${JSON.stringify(geo)})`);
  ok(!geo.over, 'no sideways scroll');
  const top = await page.evaluate(() => { const r = document.querySelector('.cmp-grab').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + 2 }; });
  await page.mouse.move(top.x, top.y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) { await page.mouse.move(top.x, top.y + i * 50); await page.waitForTimeout(16); }
  await page.mouse.up();
  await page.waitForTimeout(800);
  ok(await page.evaluate(() => !document.getElementById('enq-email-modal').classList.contains('open')), 'dragging the top down closes it');
  // Wait for the sheet to come to rest (the rise is an animation; under load it
  // outlasts any fixed sleep), then find the grabber where it now is.
  // A sheet that never comes to rest is a FAILURE, not a state to measure: the old
  // wait swallowed its own timeout, so a check read whatever the sheet was doing (CI
  // measured the card 821px below the screen) and "Escape closes it" could pass on a
  // sheet that never opened. Open, nothing moving, and on screen.
  const atRest = async (what) => {
    const rested = await page.waitForFunction(() => {
      const m = document.getElementById('enq-email-modal');
      const sh = document.getElementById('cmp-sheet');
      if (!m || !m.classList.contains('open') || !sh || sh.getAnimations().length) return false;
      const r = sh.getBoundingClientRect();
      return r.height > 0 && r.top >= -1 && r.bottom <= innerHeight + 1;
    }, null, { timeout: 15000 }).then(() => true, () => false);
    ok(rested, `the sheet came to rest on screen (${what})`);
    return rested;
  };
  const grabAt = () => page.evaluate(() => { const r = document.querySelector('.cmp-grab').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + 2 }; });
  await page.evaluate(() => openBookingEmail('b50'));
  await atRest('opened for a drag');
  const top2 = await grabAt();
  await page.mouse.move(top2.x, top2.y);
  await page.mouse.down();
  for (let i = 1; i <= 4; i++) { await page.mouse.move(top2.x, top2.y + i * 10); await page.waitForTimeout(30); }
  await page.waitForTimeout(200); // stops, then lets go: not a flick
  await page.mouse.up();
  await page.waitForTimeout(700);
  ok(await page.evaluate(() => document.getElementById('enq-email-modal').classList.contains('open')), 'a short drag springs back');
  // A BUSY PHONE hands a slow drag's moves over all at once. Judged by the handler's
  // clock they were a flick (10px in no time) and the sheet closed; judged by when
  // the finger moved, it is the same slow drag as above.
  await atRest('after springing back');
  const batched = await page.evaluate(async () => {
    const t = document.getElementById('cmp-top');
    const g = document.querySelector('.cmp-grab').getBoundingClientRect();
    const x = g.left + g.width / 2, y = g.top + 2;
    const pause = (ms) => new Promise((r) => setTimeout(r, ms));
    const mk = (type, cy) => new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: cy, pointerId: 7, pointerType: 'touch', isPrimary: true, button: 0, buttons: type === 'pointerup' ? 0 : 1 });
    const evs = [mk('pointerdown', y)];
    for (let i = 1; i <= 4; i++) { await pause(30); evs.push(mk('pointermove', y + i * 10)); }
    await pause(200);
    evs.push(mk('pointerup', y + 40));
    evs.forEach((e) => t.dispatchEvent(e)); // all handed over in one go
    await pause(700);
    return document.getElementById('enq-email-modal').classList.contains('open');
  });
  ok(batched, 'a slow drag handed over in one batch (a busy phone) still springs back');
  await page.evaluate(() => closeEnquiryEmailModal());
  await page.waitForTimeout(400);

  console.log('11. a computer: a card in the middle');
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate(() => openBookingEmail('b51'));
  await atRest('a computer');
  const card = await page.evaluate(() => { const r = document.getElementById('cmp-sheet').getBoundingClientRect(); return { w: Math.round(r.width), l: Math.round(r.left), r: Math.round(innerWidth - r.right), b: Math.round(innerHeight - r.bottom), grab: getComputedStyle(document.querySelector('.cmp-grab')).display }; });
  ok(card.w <= 600 && Math.abs(card.l - card.r) <= 2 && card.b > 8 && card.grab === 'none', `centred, ≤600 wide, no grabber (${JSON.stringify(card)})`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  ok(await page.evaluate(() => !document.getElementById('enq-email-modal').classList.contains('open')), 'Escape closes it');

  ok(pageErrors.length === 0, 'no page errors' + (pageErrors.length ? ': ' + pageErrors.join(' | ') : ''));
  console.log(fails ? `\n${fails} composer check(s) FAILED ❌` : '\nEmail a guest: all checks passed ✅');
  await done(fails);
})();
