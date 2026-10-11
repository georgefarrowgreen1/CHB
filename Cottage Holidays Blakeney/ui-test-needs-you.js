// NEEDS YOU strip (Today), end to end against mocked endpoints:
//  1. mixed workload → rows render, prioritised (automation → enquiry →
//     deposit/chase → chats → approvals), count badge right
//  2. capped at 4 with "Show N more"; expanding reveals the rest
//  3. rows ROUTE: enquiry → the Inbox, open on that person; chase → booking hub;
//     approve → reviews
//  4. all clear → the section hides entirely
// The site reckons "today" in UK time (todayDashed / ukNowParts), so the
// tests must too — pin the whole process (and the browser it launches) to
// Europe/London so fixtures built from new Date() agree with the app on
// any runner, in any timezone. Must run before the first Date call.
const { d, boot } = require('./ui-test-lib'); // pins TZ=Europe/London at require time
let fails = 0;
const ok = (b, m) => { console.log(`  ${b ? '✓' : '✗'} ${m}`); if (!b) fails++; };

(async () => {
  const { page, browser, base, done } = await boot({ viewport: { width: 1280, height: 950 } });

  // Local-formatted, never toISOString() — that's UTC and slips a day near midnight.
  const d = require('./ui-test-lib').d; // the harness's day (keeps the page's clock near midnight)
  // Enquiry age: the app FLOORS elapsed hours into days, so seed by hours-ago
  // (a date + fixed clock time reads differently depending on when the test runs).
  const hrsAgo = (h) => { const t = new Date(Date.now() - h * 3600e3); const p = (n) => String(n).padStart(2, '0'); return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())} ${p(t.getHours())}:${p(t.getMinutes())}:00`; };
  const mkB = (id, prop, name, inD, outD, pay, dep, hold) => ({
    id, prop_key: prop, name, email: 'g@e.com', phone: '', address: '', postcode: 'NR25 7AB',
    check_in: d(inD), check_out: d(outD), check_in_time: '15:00', check_out_time: '10:00',
    adults: 2, children: 0, payment: pay, deposit_paid: dep, payment_method: 'card', payment_date: '',
    agreed_total: 640, agreed_per_night: 145, agreed_nights: 4, agreed_nightly: 580, agreed_booking_fee: 60,
    agreed_txn_pct: 0, agreed_txn_fee: 0, agreed_on: d(-10), hold_status: hold || 'none', notes: '',
  });
  let quietMode = false;
  await page.route(/\.php/, (route) => {
    const url = route.request().url();
    const post = route.request().postData() || '';
    const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    let act = ''; try { act = JSON.parse(post || '{}').action || ''; } catch (e) {}
    if (quietMode) {
      return json({ ok: true, bookings: [], enquiries: [], threads: [], reviews: [], photos: [], experiences: [], events: [], logs: {}, content: {}, blocks: [], ranges: [], payments: [], seasons: {}, occupancy: {}, properties: [] });
    }
    if (url.includes('cron-status.php')) return json({ stale: true, everRan: true, ageHours: 50 });
    if (url.includes('bookings.php')) {
      if (act === 'email_logs') return json({ ok: true, logs: {} });
      if (act === 'history') return json({ ok: true, history: [] });
      return json({ bookings: [
        mkB(1, '21a', 'Sarah Pemberton', 3, 7, 'deposit', 120),      // chase: arrives in 3 days
        mkB(2, 'jollyboat', 'Emma Clarke', -6, -2, 'paid', 0, 'charged'), // deposit to return
        mkB(3, 'pimpernel', 'Tom Hardy', 40, 44, 'unpaid', 0),        // too far out — no row
        // Owner-arranged: a recorded off-card method means the money is
        // discussed personally — owing, arriving soon, and NEVER nagged.
        { ...mkB(4, 'jollyboat', 'Cash Colin', 5, 9, 'deposit', 100), payment_method: 'Bank transfer' },
      ] });
    }
    // The DECLINED list is its own read (the one-list Inbox asks for it on open):
    // answering it with the live queue filed Jane under "declined" as well.
    if (url.includes('enquiries.php') && act === 'declined') return json({ ok: true, enquiries: [] });
    if (url.includes('enquiries.php')) return json({ enquiries: [
      { id: 7, prop_key: '21a', name: 'Jane Doe', email: 'j@e.com', phone: '', check_in: d(20), check_out: d(24), adults: 2, children: 0, message: 'Dogs?', status: 'new', created_at: hrsAgo(53) /* 2 days 5h → always "waiting 2 days" (danger) */ },
    ] });
    if (url.includes('messages.php')) return json({ ok: true, threads: [
      { thread_id: 1, name: 'Ali', unread: 1, last_role: 'guest', archived: 0, last_body: 'Hi' },
      { thread_id: 2, name: 'Bea', unread: 0, last_role: 'admin', archived: 0, last_body: 'Thanks' },
    ] });
    if (url.includes('reviews.php')) return json({ ok: true, reviews: [{ id: 1, status: 'pending' }] });
    if (url.includes('photos.php')) return json({ ok: true, photos: [] });
    if (url.includes('experiences.php')) return json({ ok: true, experiences: [] });
    return json({ ok: true, bookings: [], enquiries: [], threads: [], reviews: [], photos: [], experiences: [], events: [], logs: {}, content: {}, blocks: [], ranges: [], payments: [], seasons: {}, occupancy: {}, properties: [] });
  });

  await page.goto(`${base}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  await page.evaluate(() => { isAuthenticated = true; document.body.classList.add('owner-mode'); });
  await page.evaluate(() => window.loadAdminBundle());
  await page.waitForTimeout(600);
  await page.evaluate(async () => { await openBookings(); });
  // Wait on the strip, not a clock: the automation row lands when the cron check
  // answers, which on a loaded machine is later than any fixed pause.
  await page.waitForFunction(() => /automation looks stopped/.test(((document.querySelector('#needs-you-list .ny-label') || {}).textContent) || '')
    && (document.getElementById('needs-you-count') || {}).textContent === '6', null, { timeout: 12000 }).catch(() => {});
  await page.waitForTimeout(300);

  console.log('1. mixed workload renders, prioritised');
  const s = await page.evaluate(() => ({
    visible: document.getElementById('needs-you').style.display !== 'none',
    count: document.getElementById('needs-you-count').textContent,
    labels: [...document.querySelectorAll('#needs-you-list .ny-label')].map((e) => e.textContent),
    sevs: [...document.querySelectorAll('#needs-you-list .ny-row')].map((e) => e.className.match(/ny-(danger|warn|ok)/)[1]),
    more: (document.querySelector('.ny-more') || {}).textContent || '',
  }));
  ok(s.visible, 'strip shows with work waiting');
  ok(s.count === '6', `count badge = 6 (${s.count})`);
  ok(/automation looks stopped/.test(s.labels[0] || ''), `automation warning leads (${s.labels[0]})`);
  ok(/Jane Doe/.test(s.labels[1] || '') && /waiting 2 days/.test(s.labels[1] || ''), `enquiry second with age (${s.labels[1]})`);
  ok(s.labels.some((l) => /Return .*’s £[\d.,]+ deposit/.test(l)), 'deposit-return row present, naming whose and how much');
  // £580 = £520 rental balance (640 − 120) + the £60 refundable deposit, which
  // hold_status 'none' says has NOT been taken yet. It USED to read £520: the strip
  // quoted the rental balance while the booking's own row quoted the deposit-aware
  // figure, so one screen showed two numbers for one guest. See bookingDue().
  ok(s.labels.some((l) => /£580\.00 to collect from Sarah Pemberton/.test(l)), `chase row leads with the amount owed INCLUDING the untaken deposit (${s.labels.find((l) => /to collect from Sarah/.test(l)) || 'none'})`);
  // With duties present the STRIP carries the state, so the title's verdict
  // slot must be empty — "Nothing needs you" over six things that do is the
  // one way this capsule can lie, and it now lives in a node of its own that
  // a stale render could leave painted.
  const busyCap = await page.evaluate(() => {
    try { todayOpsLine(); } catch (e) {}
    return ((document.getElementById('today-verdict') || {}).textContent || '').trim();
  });
  ok(busyCap === '', `no "nothing needs you" while six things do (${busyCap || 'empty'})`);

  // THE HEADER LINE THE OWNER READS FIRST, and the list its button links to.
  // Reported live: the header said "£290 to collect" while the booking's own row
  // said "£340.00 due" — the header summed the RENTAL balance. It is the same
  // question as the row, so it has to be the same number; and the needspay filter
  // behind the button has to contain exactly the bookings that figure counted, or
  // the owner taps a total and lands on a list missing one of them.
  // The figure now lives in Today's status pill beside the title (#bookings-owed) — same
  // derivation (bookingDue), so the same property holds.
  const ops = await page.evaluate(() => {
    try { renderBookings(); } catch (e) {}
    const el = document.getElementById('bookings-owed');
    return el ? el.textContent : '';
  });
  // Asserted as a PROPERTY, not a pinned number: the line must equal the sum of
  // the deposit-aware figures, and must exceed the rental-only sum — otherwise a
  // fixture change silently re-pins whichever total happens to print.
  const sums = await page.evaluate(() => {
    let due = 0, rent = 0, withCash = 0;
    const today = todayDashed();
    Object.keys(dbBookings).forEach((k) => (dbBookings[k] || []).forEach((b) => {
      if ((b.checkOut || '') < today) return;
      const d = bookingDue(k, b), r = paymentSummary(k, b);
      if (!d.fullyPaid) withCash += Math.max(0, d.balance || 0);
      // Owner-arranged (off-card) money is never volunteered — the expected
      // sums mirror that rule, and the withCash figure above proves the line
      // is EXCLUDING rather than the fixture carrying nothing to exclude.
      if (bookingOwnerArranged(b)) return;
      if (!d.fullyPaid) due += Math.max(0, d.balance || 0);
      if (!r.fullyPaid) rent += Math.max(0, r.balance || 0);
    }));
    return { due: Math.round(due), rent: Math.round(rent), withCash: Math.round(withCash) };
  });
  ok(sums.due > sums.rent, `the fixture really has an untaken deposit to find (due ${sums.due} > rental ${sums.rent})`);
  ok(sums.withCash > sums.due, `…and owner-arranged money to exclude (all ${sums.withCash} > counted ${sums.due})`);
  ok(ops.includes('£' + sums.due.toLocaleString('en-GB') + ' to collect'),
    `the owed line quotes the deposit-aware total (${ops})`);
  ok(!ops.includes('£' + sums.rent.toLocaleString('en-GB') + ' to collect'),
    '…and not the rental-only one it used to');
  ok(!ops.includes('£' + sums.withCash.toLocaleString('en-GB') + ' to collect'),
    '…and never the owner-arranged money (Cash Colin pays how you agreed with him)');
  const needsPay = await page.evaluate(() => {
    try { openBookings(); bookingsSetFilter('needspay'); } catch (e) {}
    return [...document.querySelectorAll('#bookings-list .bk-row')].map((r) => r.textContent || '');
  });
  ok(needsPay.length >= 1 && needsPay.some((t) => /Sarah Pemberton/.test(t)), `…and the list its button opens contains that booking (${needsPay.length} rows)`);
  ok(!needsPay.some((t) => /Cash Colin/.test(t)), 'the owner-arranged booking sits the needs-payment filter out');
  ok(!s.labels.some((l) => /Tom Hardy/.test(l)), 'far-future unpaid booking not nagged');
  ok(!s.labels.some((l) => /Cash Colin/.test(l)), 'owner-arranged (bank/cash) guest owing money is not nagged');
  // A DEPOSIT TAKEN IN CASH IS STILL A DEPOSIT TO RETURN. The duty gated on
  // hold_status === 'charged', a CARD-rail fact cash never sets — so a deposit
  // handed over in cash sat in damageHeld().held, was listed by Payments as
  // returnable and shown by the hub's own banner, and was never a duty:
  // measured, Payments said two to return, Today said one, the assistant none.
  // INJECTED and then removed rather than added to the workload above: the
  // counts, the cap and the header sums are all asserted exactly (the shared
  // mutable fixture lesson — dbBookings is a const, so mutate, never reassign).
  const dep = await page.evaluate((iso) => {
    const b = {
      id: 'b91', dbId: 91, name: 'Cash Departed', email: 'cd@e.com', propKey: 'pimpernel',
      checkIn: iso.in, checkOut: iso.out, checkInTime: '15:00', checkOutTime: '10:00',
      adults: 2, children: 0, payment: 'paid', depositPaid: 700, holdStatus: 'none',
      agreedPrice: { total: 640, rentalTotal: 640, nights: 4, perNight: 160, txnFee: 0, damagesDeposit: 60 },
    };
    dbBookings.pimpernel.push(b);
    const held = damageHeld('pimpernel', b).held;
    const labels = needsYouItems().map((x) => x.label);
    dbBookings.pimpernel.pop(); // put the fixture back
    return { held, labels };
  }, { in: d(-5), out: d(-1) });
  ok(Math.abs(dep.held - 60) < 0.006, `the injected booking really holds a £60 cash deposit (${dep.held})`);
  ok(dep.labels.some((l) => /Cash Departed/.test(l) && /£60 deposit/.test(l)),
    `a cash-taken deposit becomes a duty (${dep.labels.filter((l) => /deposit/.test(l)).join(' | ') || 'none'})`);
  ok(s.sevs[0] === 'danger' && s.sevs[1] === 'danger', 'severities: automation + 2-day-old enquiry are danger');

  console.log('2. capped at 4 + expand');
  ok(s.labels.length === 4 && /Show 2 more/.test(s.more), `4 shown, "${s.more}"`);
  await page.evaluate(() => needsYouExpand());
  await page.waitForTimeout(300);
  const s2 = await page.evaluate(() => ({
    labels: [...document.querySelectorAll('#needs-you-list .ny-label')].map((e) => e.textContent),
    more: !!document.querySelector('.ny-more'),
  }));
  ok(s2.labels.length === 6 && !s2.more, `expanded to all 6 (${s2.labels.length})`);
  ok(/guest chat/.test(s2.labels[4] || '') && /review to approve/.test(s2.labels[5] || ''), `chat + approval rows last (${s2.labels[4]}, ${s2.labels[5]})`);

  console.log('3. rows route to the right place');
  await page.evaluate(() => { [...document.querySelectorAll('#needs-you-list .ny-row')].find((r) => /Jane Doe/.test(r.textContent)).click(); });
  // The enquiry duty lands on the INBOX, open on Jane: the Inbox is one list of
  // people now and an enquiry is decided inside its conversation (inboxOpenEnquiry),
  // not on a separate enquiry hub. Waited on by STATE — ibOpenWhen polls until the
  // list has been built from the stores.
  await page.waitForFunction(() => /Jane Doe/.test((document.querySelector('#ib-conv .ib-hname') || {}).textContent || ''), null, { timeout: 8000 }).catch(() => {});
  const enq = await page.evaluate(() => {
    const name = document.querySelector('#ib-conv .ib-hname');
    return {
      view: (document.querySelector('.page-view.active') || {}).id,
      open: typeof __ibOpen === 'string' ? __ibOpen : '',
      name: name ? name.textContent : '',
      painted: !!(name && name.getClientRects().length),
      decide: !!document.querySelector('#ib-conv .ib-decide [data-ib="approve"], #ib-conv .ib-decide [data-ib="offer"]'),
    };
  });
  ok(enq.view === 'view-inbox' && enq.open === 'e:j@e.com' && /Jane Doe/.test(enq.name) && enq.painted,
    `enquiry row opens the Inbox on Jane's conversation (${enq.view}, ${enq.open})`);
  ok(enq.decide, '…with the decision on it, so the tap lands where the enquiry is answered');
  await page.evaluate(async () => { await openBookings(); });
  await page.waitForTimeout(1200);
  await page.evaluate(() => { needsYouExpand(); [...document.querySelectorAll('#needs-you-list .ny-row')].find((r) => /Sarah Pemberton/.test(r.textContent)).click(); });
  await page.waitForTimeout(800);
  const hub = await page.evaluate(() => ({
    view: (document.querySelector('.page-view.active') || {}).id,
    name: (document.querySelector('.bhub-name') || {}).textContent || '',
  }));
  ok(/view-(booking-hub|backoffice)/.test(hub.view) && /Sarah/.test(hub.name), `chase row opens Sarah's hub (${hub.view}, ${hub.name})`);
  await page.evaluate(async () => { await openBookings(); });
  await page.waitForTimeout(1200);
  await page.evaluate(() => { needsYouExpand(); [...document.querySelectorAll('#needs-you-list .ny-row')].find((r) => /review to approve/.test(r.textContent)).click(); });
  await page.waitForTimeout(800);
  const rev = await page.evaluate(() => ({
    view: (document.querySelector('.page-view.active') || {}).id,
    sec: (document.getElementById('sec-reviews') || { style: {} }).style.display,
  }));
  ok(rev.view === 'view-settings' && rev.sec !== 'none', `approve row opens Manage → Reviews (${rev.view})`);

  console.log('4. all clear → hidden');
  await page.evaluate(() => { window.__QUIET = 1; });
  quietMode = true;
  await page.evaluate(async () => { __nyChats = 0; __nyMod = { rev: 0, ph: 0, exp: 0 }; __nyCronQuiet = false; await openBookings(); });
  await page.waitForTimeout(1400);
  const q = await page.evaluate(() => {
    // The verdict sits beside THE HEAD — and which element that is depends on
    // the width: below the rail it is the h1, at rail widths the h1 stands
    // down and the day SENTENCE is the head (the frame's Today anatomy). The
    // relationship is the invariant; the element is not.
    const h1el = document.querySelector('#view-backoffice .bo-today-head .section-title');
    const h1 = h1el && h1el.getClientRects().length > 0 ? h1el : document.getElementById('today-date');
    const v = document.getElementById('today-verdict');
    const hr = h1 ? h1.getBoundingClientRect() : null;
    const vr = v ? v.getBoundingClientRect() : null;
    return {
      hidden: document.getElementById('needs-you').style.display === 'none',
      ops: (document.getElementById('today-date') || {}).textContent || '',
      cap: v ? v.textContent.trim() : '',
      onDate: /Nothing needs you/.test((document.getElementById('today-date') || {}).textContent || ''),
      // BESIDE the title, measured: same row (vertical overlap) and to its right.
      beside: !!(hr && vr && vr.width > 0 && vr.left >= hr.right - 1 && vr.top < hr.bottom && vr.bottom > hr.top),
    };
  });
  ok(q.hidden, 'strip hides when nothing needs the owner');
  ok(!/Nothing needs you|thing to do|things need you/.test(q.ops), `no day sentence repeats the strip ("${q.ops}")`);
  // The ✓ capsule beside the title is GONE — the sentence says it, and a capsule repeating a
  // sentence is noise. Asserted as an absence so it cannot creep back beside the title.
  ok(q.cap === '', `no capsule repeats it beside the title ("${q.cap}")`);

  console.log('5. pricing ideas moved OFF the strip and onto Manage → Pricing');
  await page.evaluate(() => {
    __nyCronQuiet = false; __nyChats = 0; __nyMod = {}; enquiries = [];
    Object.keys(dbBookings).forEach((k) => { dbBookings[k] = []; });
    Object.keys(dbBlocks).forEach((k) => { dbBlocks[k] = []; });
    const d = (n) => { const t = new Date(); const x = new Date(t.getFullYear(), t.getMonth(), t.getDate() + n); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
    const mk = (id, ci, co) => ({ id, name: 'G' + id, checkIn: ci, checkOut: co, adults: 2, children: 0, payment: 'paid', holdStatus: 'none', agreedPrice: { total: 100 } });
    dbBookings.jollyboat = [mk(91, d(5), d(8)), mk(92, d(11), d(14))]; // → one 3-night gap, no duties
    renderNeedsYou();
  });
  await page.waitForTimeout(300);
  const w = await page.evaluate(() => ({
    hidden: document.getElementById('needs-you').style.display === 'none',
    rows: document.querySelectorAll('#needs-you-list .ny-row').length,
  }));
  ok(w.hidden && w.rows === 0, `a gap with no duties leaves the Today strip empty — pricing ideas are off it (hidden=${w.hidden})`);
  // The gap idea now lives on its own Manage → Pricing page.
  const priced = await page.evaluate(() => {
    nav('view-settings'); settingsOpen('pricing'); renderPricing();
    return [...document.querySelectorAll('#pricing-body .ny-label')].map((e) => e.textContent);
  });
  await page.waitForTimeout(200);
  ok(priced.some((l) => /Fill the 3-night gap on .*: offer £\d+\/night/.test(l)), 'the gap idea appears on Manage → Pricing (offer-led)');
  await page.evaluate(() => {
    enquiries = [{ id: 7, name: 'Duty Guest', propKey: 'jollyboat', checkIn: '2027-01-05', checkOut: '2027-01-08', receivedAt: new Date().toISOString().slice(0, 19).replace('T', ' ') }];
    renderNeedsYou();
  });
  await page.waitForTimeout(200);
  const w2 = await page.evaluate(() => ({
    word: (document.getElementById('needs-you-word') || {}).textContent,
    count: (document.getElementById('needs-you-count') || {}).textContent,
    opp: document.getElementById('needs-you-count').classList.contains('is-opp'),
  }));
  ok(w2.word === 'Needs you' && w2.count === '1' && !w2.opp, `a real duty shows on the strip — badge counts DUTIES only (${w2.word} ${w2.count})`);

  // ---- 6. payout trouble reaches the strip -------------------------------
  // Move-money-out correctly refuses to count a FAILED payout or a disputed payment
  // as movable, but SILENTLY — and bad bank details stop every later transfer. Both
  // ride the bootstrap payload (window.__payoutTroublePre) and become duties.
  console.log('6. failed payouts and disputes are duties');
  const trouble = await page.evaluate(() => {
    enquiries = []; __nyChats = 0; __nyMod = {}; __nyCronQuiet = false;
    window.__payoutTroublePre = { failed: { count: 1, amount: 604.05, items: [{ id: 'po1', amount: 604.05 }] }, disputed: { count: 1, amount: 900 } };
    renderNeedsYou();
    const t = (document.getElementById('needs-you-list') || {}).textContent || '';
    return { txt: t.replace(/\s+/g, ' '), count: (document.getElementById('needs-you-count') || {}).textContent };
  });
  ok(/couldn.{0,3}t pay £604\.05 into your bank/i.test(trouble.txt), `a failed payout is a duty (${trouble.txt.slice(0, 90)})`);
  ok(/bank details/i.test(trouble.txt), '…and names the likely cause, which is what makes it actionable');
  ok(/£900\.00 is under dispute/.test(trouble.txt), 'a disputed payment is a duty too');
  ok(trouble.count === '2', `both are counted in the badge (${trouble.count})`);
  // A healthy account must not invent either of them.
  const clean = await page.evaluate(() => {
    window.__payoutTroublePre = null;
    renderNeedsYou();
    return ((document.getElementById('needs-you-list') || {}).textContent || '').replace(/\s+/g, ' ');
  });
  ok(!/into your bank/i.test(clean) && !/under dispute/i.test(clean), 'a healthy account shows neither');

  // ---- 7. new customer email reaches the strip ---------------------------
  // Nothing used to tell the owner an email had arrived: the cron's poll read it,
  // saw it was not a chat reply, marked it seen and dropped it. It rides the same
  // bootstrap payload as the payout trouble above (window.__newMailPre).
  console.log('7. a new customer email is a duty');
  const mail1 = await page.evaluate(() => {
    enquiries = []; __nyChats = 0; __nyMod = {}; __nyCronQuiet = false;
    window.__payoutTroublePre = null;
    window.__newMailPre = { count: 1, items: [{ uid: 'u1', from: 'anne@example.test', name: 'Anne Betts', subject: 'Is there parking?' }] };
    renderNeedsYou();
    return {
      txt: ((document.getElementById('needs-you-list') || {}).textContent || '').replace(/\s+/g, ' '),
      count: (document.getElementById('needs-you-count') || {}).textContent,
    };
  });
  ok(/Anne Betts emailed you/.test(mail1.txt), `one email names the sender (${mail1.txt.slice(0, 80)})`);
  ok(/Is there parking\?/.test(mail1.txt), '…and shows the subject, so it can be judged without opening it');
  ok(mail1.count === '1', `it counts on the badge (${mail1.count})`);
  const mail3 = await page.evaluate(() => {
    window.__newMailPre = { count: 3, items: [{ uid: 'u1', name: 'Anne Betts', subject: 'x' }] };
    renderNeedsYou();
    return ((document.getElementById('needs-you-list') || {}).textContent || '').replace(/\s+/g, ' ');
  });
  ok(/3 new emails are waiting/.test(mail3), 'several are counted rather than naming one of them');
  // It ROUTES to the Inbox — the one list of people, where an email arrives as its
  // sender's row. (There is no Email folder to open any more: the old check read the
  // folder's style.display, which inside the hidden #inbox-legacy is '' and so
  // "passed" while showing nothing.)
  const routed = await page.evaluate(async () => {
    const row = [...document.querySelectorAll('#needs-you-list [data-act]')].find((b) => /openInboxEmail/.test(b.getAttribute('data-act') || ''));
    if (!row) return { found: false };
    row.click();
    for (let i = 0; i < 40 && !(document.getElementById('ib-list') || { getClientRects: () => [] }).getClientRects().length; i++)
      await new Promise((r) => setTimeout(r, 100));
    const legacy = document.getElementById('inbox-legacy');
    return {
      found: true,
      view: (document.querySelector('.page-view.active') || {}).id,
      list: !!(document.getElementById('ib-list') || { getClientRects: () => [] }).getClientRects().length,
      folder: (document.getElementById('ib-folders') || { getAttribute: () => '' }).getAttribute('data-on'),
      legacyHidden: !!legacy && legacy.hidden && !legacy.getClientRects().length,
    };
  });
  ok(routed.found && routed.view === 'view-inbox' && routed.list && routed.folder === 'inbox',
    `the row opens the Inbox's one list, on the Inbox folder (${routed.view}, list painted ${routed.list}, folder ${routed.folder})`);
  ok(routed.found && routed.legacyHidden, '…and no old folder list is on screen');
  // An empty mailbox invents nothing.
  const noMail = await page.evaluate(() => {
    window.__newMailPre = { count: 0, items: [] };
    renderNeedsYou();
    return ((document.getElementById('needs-you-list') || {}).textContent || '').replace(/\s+/g, ' ');
  });
  ok(!/emailed you/.test(noMail) && !/new emails are waiting/.test(noMail), 'no waiting mail → no row');

  // ---- 8. reading an enquiry turns its notification off --------------------
  // Reported with a screenshot: the enquiry was open on screen and every red
  // count still said 1. An enquiry stays PENDING until it is approved or
  // declined, so "pending" was never the right thing to count.
  console.log('8. an opened enquiry stops notifying');
  // OFF the Inbox first, and with loadData held still. On a computer an Inbox on
  // screen with nobody open opens the top waiting person in its reading pane, which
  // (rightly) stamps their enquiry seen — so the "unread" case would read itself.
  // And this fixture's routes now answer every refresh empty (quietMode), so a
  // background loadData landing mid-check emptied `enquiries` under the counts
  // (measured: one run read "All answered" over the enquiry being counted). §8
  // tests the counts, not loadData.
  await page.evaluate(async () => {
    window.__ldSave = window.loadData;
    window.loadData = async () => ({ ok: true, failed: [] });
    await openBookings();
  });
  // TWO numbers, and since the one-list Inbox they answer different questions on
  // purpose: the TODAY pip counts duties (and an enquiry you have read is not a duty
  // until it goes stale), while the INBOX pip counts people WAITING on you — the
  // list's own "N waiting" pill — and an enquiry waits until you approve or decline
  // it, read or not. The folder chip the old check also read is gone with the folders.
  const seenState = async (seenAt, hoursAgo) => page.evaluate(async ({ seenAt, hoursAgo }) => {
    __nyChats = 0; __nyMod = {}; __nyCronQuiet = false;
    window.__newMailPre = null; window.__payoutTroublePre = null;
    const at = new Date(Date.now() - hoursAgo * 3600e3).toISOString().slice(0, 19).replace('T', ' ');
    // RE-LAID UNTIL IT HOLDS: a refresh already in flight when loadData was held
    // still can still land and empty the store, so the fixture is seeded again
    // until it survives the frames the counts are read after.
    for (let i = 0; i < 5; i++) {
      enquiries = [{ id: 'e7', dbId: 7, name: 'Jem Beighton', email: 'jem@x.co', propKey: 'pimpernel', checkIn: '2027-01-05', checkOut: '2027-01-08', receivedAt: at, seenAt: seenAt }];
      // The enquiries loader's own render: it refreshes the badges and queues the
      // one list's rebuild (ibSoon → ibRender, which refreshes them again from the
      // rebuilt list). Two frames lets that rebuild land before anything is read.
      renderInbox();
      renderNeedsYou();
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      if (enquiries.length === 1 && enquiries[0].id === 'e7') break;
      await new Promise((r) => setTimeout(r, 300));
    }
    return {
      dock: (document.getElementById('dock-badge-enquiries') || {}).textContent,
      inboxPip: (document.getElementById('dock-badge-inbox') || {}).textContent,
      waiting: String(ibWaitingCount()),
      pill: ((document.querySelector('#ib-pill .head-pill') || {}).textContent || '').trim(),
      duty: /enquiry/i.test(((document.getElementById('needs-you-list') || {}).textContent || '')),
    };
  }, { seenAt, hoursAgo });

  const unread = await seenState('', 3);
  ok(unread.dock === '1' && unread.inboxPip === '1' && unread.waiting === '1',
    `unread: the Today pip and the Inbox pip both say 1 (Today ${unread.dock}, Inbox ${unread.inboxPip}, waiting ${unread.waiting})`);
  ok(/^1 waiting$/.test(unread.pill), `…and the Inbox pip is the list's own number (pill "${unread.pill}")`);
  ok(unread.duty, 'unread: and it is a duty');

  const read = await seenState('2026-08-01 10:00:00', 3);
  ok(read.dock === '0',
    `READ: the Today count drops — that is the whole ask (Today ${read.dock})`);
  ok(!read.duty, 'READ: and the duty goes with it, or the Today badge would still say 1');
  ok(read.inboxPip === '1' && read.inboxPip === read.waiting && /^1 waiting$/.test(read.pill),
    `READ: the Inbox pip still says 1 — the decision is still owed, and it says the same as the list (Inbox ${read.inboxPip}, pill "${read.pill}")`);

  // NOT DROPPED FOR GOOD. An enquiry read and then left is exactly how a booking
  // is lost, so at the same two days that already turns it red it comes back.
  const stale = await seenState('2026-08-01 10:00:00', 53);
  ok(stale.duty, 'READ BUT STALE (2 days): it comes back as a duty rather than being lost');

  // Opening one stamps it and answers the tap immediately — before the round trip.
  const onOpen = await page.evaluate(async () => {
    enquiries = [{ id: 'e7', dbId: 7, name: 'Jem Beighton', propKey: 'pimpernel', checkIn: '2027-01-05', checkOut: '2027-01-08', receivedAt: new Date().toISOString().slice(0, 19).replace('T', ' '), seenAt: '' }];
    refreshInboxBadge();
    const before = (document.getElementById('dock-badge-enquiries') || {}).textContent;
    enquirySeen(enquiries[0]);
    return { before, after: (document.getElementById('dock-badge-enquiries') || {}).textContent, stamped: !!enquiries[0].seenAt };
  });
  ok(onOpen.before === '1' && onOpen.after === '0' && onOpen.stamped,
    `opening it clears the count without waiting on the server (${onOpen.before} → ${onOpen.after})`);
  await page.evaluate(() => { window.loadData = window.__ldSave; });

  // ---- 9. a stalled calendar sync is a DUTY, not a footnote ----------------
  // It was only ever a line in the assistant's foot — you had to open search AND
  // read the bottom of it. While an Airbnb feed is stale its stays are not
  // blocking the calendar, and every clash guard faithfully finds nothing,
  // because there is nothing left to find. It rides the bootstrap payload
  // (window.__feedStatusPre) like the payout trouble above.
  console.log('9. a stalled calendar sync is a duty');
  const feedState = (feeds) => page.evaluate((feeds) => {
    enquiries = []; __nyChats = 0; __nyMod = {}; __nyCronQuiet = false;
    window.__payoutTroublePre = null; window.__newMailPre = null;
    window.__feedStatusPre = feeds;
    renderNeedsYou();
    return {
      txt: ((document.getElementById('needs-you-list') || {}).textContent || '').replace(/\s+/g, ' '),
      count: (document.getElementById('needs-you-count') || {}).textContent,
      sys: (() => { try { const st = chbSystemState(); return st && st.say; } catch (e) { return ''; } })(),
    };
  }, feeds);

  const stuck = await feedState([{ pk: 'jollyboat', name: 'Jollyboat', ageHours: 50, failing: 0 }]);
  ok(/Jollyboat.{0,3}s calendar sync looks stuck/.test(stuck.txt), `a stale feed is a duty (${stuck.txt.slice(0, 80)})`);
  ok(/2 days/.test(stuck.txt), `…saying how long it has been silent (${stuck.txt.slice(0, 90)})`);
  ok(stuck.count === '1', `and it counts on the badge (${stuck.count})`);
  // ONE definition: the status line and the duty must not disagree about it.
  ok(/Jollyboat/.test(stuck.sys || ''), `the search status line says the same thing (${stuck.sys})`);

  // FRESH but failing: it imported an hour ago and the source is erroring. Only
  // the failing clause can surface this — with a stale age too, the check would
  // pass on either clause and prove nothing.
  const failing = await feedState([{ pk: '21a', name: '21A', ageHours: 2, failing: 1 }]);
  ok(/21A.{0,3}s calendar sync is failing/.test(failing.txt), `an outright failing source says so (${failing.txt.slice(0, 80)})`);
  ok(/not be blocking these dates/.test(failing.txt), '…and names the consequence, which is what makes it urgent');

  // A feed that has never imported is omitted server-side; a healthy one invents
  // nothing, and neither does an empty payload.
  const healthy = await feedState([{ pk: 'pimpernel', name: 'Pimpernel', ageHours: 2, failing: 0 }]);
  ok(!/calendar sync/.test(healthy.txt), 'a healthy feed is not a duty');
  const none = await feedState(null);
  ok(!/calendar sync/.test(none.txt), 'no feed data at all invents nothing');

  // ── 10. HEALTH IS NEVER CLAIMED FROM IGNORANCE ──────────────────────────────
  // The cron, the feeds, the payout trouble and the mail count all ride ONE
  // admin-bootstrap request, and loadData overwrote all four unconditionally — so a
  // single dropped request turned every "look at this" into "all clear". Measured
  // simultaneously with a stale cron and a failing feed in the fixture: Today said
  // "Needs you 3", and after the drop Manage said "Daily jobs and calendar feeds are
  // running." with a green "✓ All running" while the assistant's foot said "All
  // systems normal". Nothing to warn about, because nothing answered.
  console.log('10. a dropped bootstrap does not become a clean bill of health');
  const sig = await page.evaluate((n) => {
    window.__sigAt = n;
    // Nothing stale in the stores — the point is that they were never REFRESHED.
    window.__cronStatusPre = null; window.__feedStatusPre = null;
    const st = (() => { try { return chbSystemState(); } catch (e) { return null; } })();
    let pulse = '', cap = '';
    try {
      window.__diagSum = { fail: 0, warn: 0, cron: 'ok' }; // the system check answered; the bootstrap did not
      window.__keepRows = { mod: __nyMod, m: window.chbMissList, g: window.slGuestQuestions };
      __nyMod = { rev: 0, ph: 0, exp: 0 }; window.chbMissList = () => []; window.slGuestQuestions = () => []; // the signals alone decide
      manageVerdicts();
      const host = document.getElementById('manage-verdicts');
      pulse = host ? (host.textContent || '').replace(/\s+/g, ' ') : '';
      const pill = document.getElementById('health-pill');
      cap = pill ? (pill.dataset.tone || '') + ':' + pill.textContent : '';
    } catch (e) {}
    return { level: st && st.level, say: st && st.say, pulse, cap };
  }, Date.now() - 30 * 60 * 1000); // stamped half an hour ago: the last few tries did not answer
  ok(sig.level === 'unknown', `the assistant's status line says it could not check (${sig.level} — ${sig.say})`);
  ok(!/All systems normal/.test(sig.say || ''), '…rather than reporting the business healthy');
  ok(!/Everything.s running|jobs and feeds on time|all clear/i.test(sig.pulse), `Manage does not claim the jobs are running (${(sig.pulse || '').slice(0, 90)})`);
  ok(/^unk:Status: couldn’t check$/.test(sig.cap || ''), `…and its status pill is grey, saying it couldn't check (${sig.cap})`);
  // …and with a FRESH stamp and nothing wrong, the clean bill of health is back.
  const sigOk = await page.evaluate(() => {
    window.__sigAt = Date.now();
    const st = (() => { try { return chbSystemState(); } catch (e) { return null; } })();
    let cap = '';
    try { manageVerdicts(); const pill = document.getElementById('health-pill'); cap = pill ? (pill.dataset.tone || '') + ':' + pill.textContent : ''; } catch (e) {}
    const k = window.__keepRows;
    if (k) { __nyMod = k.mod; window.chbMissList = k.m; window.slGuestQuestions = k.g; }
    return { level: st && st.level, say: st && st.say, cap };
  });
  ok(sigOk.level === 'ok' && /All systems normal/.test(sigOk.say || ''),
    `a bootstrap that DID answer still reports healthy (${sigOk.say})`);
  ok(/^ok:Status: all clear$/.test(sigOk.cap || ''), `…with the status pill green (${sigOk.cap})`);

  console.log(fails ? `NEEDS-YOU TEST FAILED ❌ (${fails})` : 'NEEDS-YOU TEST PASSED ✅');
  await done(fails);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
