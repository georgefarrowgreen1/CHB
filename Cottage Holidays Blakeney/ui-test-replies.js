// Saved replies — the reply library in the shared composer + Manage.
//  1. the composer grows the library chrome (injected, index.html untouched)
//  2. writing a new reply — the composer has NO save-as-template control, so
//     Manage carries the only way in: a blank draft is refused, a greeting is
//     refused, a clean one stores its words + scope + button
//  3. the picker resolves tokens per record — the balance EQUALS bookingDue's own
//     figure (equality of derivations, never a second sum)
//  4. a template's buttons ride along; the guard matrix per record, both ways
//     (card+due offers pay; transfer withholds it WITH the reason; an enquiry
//     gets no buttons at all)
//  4b. applicability — what doesn't apply isn't offered: scope (when),
//     unresolvable tokens and all-buttons-refused each HIDE a row; a library
//     where nothing fits says so; Manage still lists everything
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
  // ONE ✨ draft control, and it must WORK on a booking: the static button ran
  // the enquiry drafter only, so bookings grew an injected twin — two
  // identical-looking ✨ actions in one screen-height, running different code
  // (the owner's screenshot). draftComposeReply dispatches on the record.
  const drafts = await page.evaluate(() => ({
    count: document.querySelectorAll('#enq-email-modal [data-act="draftComposeReply"], #enq-email-modal [data-act="draftBookingReply"], #enq-email-modal [data-act="draftEnquiryReply"]').length,
    filled: (() => { window.draftComposeReply(); return ((document.getElementById('enq-email-body') || {}).value || '').length > 20; })(),
  }));
  ok(drafts.count === 1, `exactly ONE draft control in the composer (${drafts.count})`);
  ok(drafts.filled, 'and it drafts from the BOOKING on a booking (the dispatch)');
  await page.evaluate(() => { document.getElementById('enq-email-body').value = ''; });
  ok(/Buttons in this email/.test(c1.acts), 'the buttons row renders on a booking');
  ok(c1.panelHidden === true, 'the picker starts closed');

  console.log('2. writing a new reply — Manage is the whole way in');
  // "Save as a template" is GONE from the composer (owner's ask), so Manage
  // must carry an authoring affordance or the library is one nobody can add
  // to. That is this section: no composer control, a "Write a new reply"
  // button, the greeting lint on the way through, and a stored round trip.
  const due9 = await page.evaluate(() => gbp(bookingDue('21a', findBookingById('b9')).balance));
  await page.evaluate(() => { window.glassAlert = (m) => { (window.__alerts = window.__alerts || []).push(String(m)); }; });
  const gone = await page.evaluate(() => ({
    btns: document.querySelectorAll('#enq-email-modal [data-act="emailTplSaveAs"]').length,
    fn: typeof window.emailTplSaveAs,
    bar: (document.getElementById('etpl-acts') || {}).textContent || '',
  }));
  ok(gone.btns === 0 && gone.fn === 'undefined' && !/Save as a template/.test(gone.bar),
    `the composer no longer offers "Save as a template" (${gone.btns} buttons, fn ${gone.fn})`);
  await page.evaluate(() => { window.settingsOpen && nav('view-settings'); window.settingsOpen('replies'); });
  await page.waitForTimeout(300);
  const wayIn = await page.evaluate(() => document.querySelectorAll('#replies-body [data-act="emailTplNew"]').length);
  ok(wayIn === 1, 'Manage carries the way in — one "Write a new reply" button');
  // A blank draft must NOT be stored: emailTplList() drops an empty body, so
  // a row saved before it is written would vanish on the next read.
  await page.evaluate(() => window.emailTplNew());
  const blank = await page.evaluate(() => {
    document.getElementById('etpl-ed-name').value = 'Half a thought';
    document.getElementById('etpl-ed-body').value = '';
    return window.emailTplEditSave(document.getElementById('etpl-ed-name').closest('.etpl-mrow') ? __etplDraft.id : '');
  });
  const blankAlert = await page.evaluate(() => (window.__alerts || []).pop() || '');
  ok(/needs a name and a paragraph/.test(blankAlert), `an unwritten reply is refused, not stored (${blankAlert.slice(0, 34)}…)`);
  // The greeting lint moved here with the feature — a hand-written paragraph
  // opens with "Hi Rachel," just as readily as a composed one did.
  await page.evaluate(() => {
    document.getElementById('etpl-ed-body').value = 'Hello there, the quay is six minutes away.';
    return window.emailTplEditSave(__etplDraft.id);
  });
  const lint = await page.evaluate(() => (window.__alerts || []).pop() || '');
  ok(/opens with a greeting/.test(lint) && /hello twice/.test(lint), `a greeting reply is refused with the reason (${lint.slice(0, 40)}…)`);
  // A clean save: name + paragraph + scope + a button, stored as one row.
  await page.evaluate(() => {
    document.getElementById('etpl-ed-body').value = 'The balance of {{balance}} is due before you arrive.';
    document.getElementById('etpl-ed-when').value = 'before';
    const box = document.querySelector('#etpl-ed-acts input[data-actid="pay"]');
    if (box) box.checked = true;
    return window.emailTplEditSave(__etplDraft.id);
  });
  await page.waitForTimeout(300);
  const saved = posts.filter((p) => p.__url === 'content.php' && p.action === 'set' && p.key === 'email-templates').pop();
  ok(!!saved, 'the save posts to the email-templates content key');
  const savedList = saved ? JSON.parse(saved.value) : [];
  const mine = savedList[0] || {};
  ok(/Half a thought/.test(mine.name) && /\{\{balance\}\}/.test(mine.body) && mine.when === 'before' && (mine.actions || []).join() === 'pay',
    `the written reply stores its words, scope and button (${mine.name} · ${mine.when} · ${(mine.actions || []).join()})`);
  // The first write lands on a never-saved store, so it MATERIALISES the
  // starter set behind it — they were already on screen, and now they are
  // ordinary editable rows rather than a phantom that reappears.
  const defCount = await page.evaluate(() => EMAIL_TPL_DEFAULTS.length);
  ok(savedList.length === 1 + defCount && savedList.slice(1).every((t) => /^d-/.test(t.id)),
    `…and the starters materialise behind it (${savedList.length} stored, ${defCount} starters)`);
  await page.evaluate(() => { window.__alerts = []; nav('view-backoffice'); window.openBookingEmail('b9'); });
  await page.waitForTimeout(250);

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
  // TYPE in the search box FOR REAL — through the delegated dispatcher, which
  // hands a plain-global handler NOTHING unless the markup passes it. The first
  // ship had no data-pass and threw on the first keystroke on the owner's
  // phone (admin.js?v=514:25075); this fill would have caught it, and the
  // suite's own pageErrors check makes the throw loud.
  await page.fill('#etpl-q', 'balance');
  await page.waitForTimeout(200);
  const p3q = await page.evaluate(() => ({
    rows: Array.from(document.querySelectorAll('#etpl-panel .etpl-row .etpl-row-name')).map((e) => e.textContent.trim()),
    q: (document.getElementById('etpl-q') || {}).value || '',
  }));
  ok(p3q.rows.length === 1 && /balance/.test(p3q.rows[0]) && p3q.q === 'balance',
    `typing in the picker filters the rows (${p3q.rows.join(' | ')})`);
  await page.fill('#etpl-q', '');
  await page.waitForTimeout(150);
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
    const balRow = Array.from(document.querySelectorAll('#etpl-panel .etpl-row')).find((r) => /balance/.test(r.textContent));
    return {
      payWhy: etplActGuard('pay', f),
      invWhy: etplActGuard('invoice', f),
      regWhy: etplActGuard('register', f),
      balChips: balRow ? Array.from(balRow.querySelectorAll('.etpl-carry')).map((c) => c.textContent.trim()) : null,
    };
  });
  ok(/transfer/.test(g10.payWhy) && /invoice/.test(g10.payWhy), `pay withheld on the transfer rail WITH the reason (${g10.payWhy.slice(0, 44)}…)`);
  ok(g10.invWhy === '', 'invoice still offered off the card rail');
  ok(/already submitted/.test(g10.regWhy), 'register withheld once submitted');
  // A refused button is DROPPED from the row, not struck through — the chips
  // preview exactly what will ride along (the same filter insert applies).
  ok(!!g10.balChips && g10.balChips.join() === 'View your invoice',
    `the row previews only the buttons that will ride (${g10.balChips && g10.balChips.join(', ')})`);

  console.log("4b. what doesn't apply isn't offered");
  // The owner's screenshot: a paid pre-arrival BOOKING offered enquiry replies,
  // an after-stay thank-you and a struck-out register ask. Scope + tokens +
  // all-buttons-refused each hide a row; Manage still lists everything.
  await page.evaluate(() => {
    const lib = JSON.stringify([
      { id: 'bal2', name: 'Balance nudge', body: 'The balance of {{balance}} is due.', actions: ['pay'], uses: 0 },
      { id: 'enqw', name: 'Enquiry welcome', body: 'We would love to have you to stay.', when: 'enquiry', actions: [], uses: 0 },
      { id: 'aft', name: 'Hope you got home safely', body: 'Thank you for coming.', when: 'after', actions: [], uses: 0 },
      { id: 'regask', name: 'A register ask', body: 'Please add your guest details when you have a minute.', actions: ['register'], uses: 0 },
    ]);
    siteContent['email-templates'] = lib;
    adminPrivateContent['email-templates'] = lib;
  });
  const fit9 = await page.evaluate(() => {
    window.openBookingEmail('b9'); // card, owing, register NOT submitted, pre-stay
    window.emailTplToggle();
    return Array.from(document.querySelectorAll('#etpl-panel .etpl-row .etpl-row-name')).map((e) => e.textContent.trim()).sort().join(' | ');
  });
  ok(fit9 === 'A register ask | Balance nudge', `a pre-stay owing booking gets exactly the rows that apply (${fit9})`);
  const fit10 = await page.evaluate(() => {
    window.openBookingEmail('b10'); // register submitted; transfer rail; money owing
    window.emailTplToggle();
    return {
      rows: Array.from(document.querySelectorAll('#etpl-panel .etpl-row .etpl-row-name')).map((e) => e.textContent.trim()).sort().join(' | '),
      balChips: document.querySelectorAll('#etpl-panel .etpl-carry').length,
    };
  });
  // The register ask's only job is DONE here → the row hides. The balance
  // nudge's Pay button is refused for the CHANNEL (transfer rail) while the
  // money is still owed → the words stay, the button goes.
  ok(fit10.rows === 'Balance nudge', `a template whose every button is MOOT is hidden, not struck (${fit10.rows})`);
  ok(fit10.balChips === 0, 'a channel-refused button is dropped while the words survive');
  const fitEnq = await page.evaluate(() => {
    window.openEnquiryEmail(enquiries[0].id);
    window.emailTplToggle();
    return Array.from(document.querySelectorAll('#etpl-panel .etpl-row .etpl-row-name')).map((e) => e.textContent.trim()).sort().join(' | ');
  });
  ok(fitEnq === 'Enquiry welcome', `an enquiry gets the enquiry reply — no balance, no buttons, no after-stay (${fitEnq})`);
  // Templates exist but none fits → the honest state, not "Nothing saved yet".
  const noneFits = await page.evaluate(() => {
    const lib = JSON.stringify([{ id: 'aft', name: 'Hope you got home safely', body: 'Thank you for coming.', when: 'after', actions: [], uses: 0 }]);
    siteContent['email-templates'] = lib;
    adminPrivateContent['email-templates'] = lib;
    window.openBookingEmail('b9');
    window.emailTplToggle();
    return (document.getElementById('etpl-panel') || {}).textContent || '';
  });
  ok(/None of your saved replies fits this record/.test(noneFits), 'a library where nothing fits says so — never "Nothing saved yet"');
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
  // Re-seed the §3 library — §4b's applicability fixtures replaced it. Manage
  // lists EVERYTHING regardless of any record's applicability (the authoring
  // surface), which is itself one of this section's facts.
  await page.evaluate(() => {
    const lib = JSON.stringify([
      { id: 'bal', name: 'A nudge about the balance', body: 'Just a quick note that the balance of {{balance}} for {{dates}} is due before you arrive.', actions: ['pay', 'invoice'], uses: 9 },
      { id: 'quay', name: 'The quay and the beach', body: 'The quay is six minutes on foot from {{cottage}}.', actions: [], when: 'after', uses: 14 },
    ]);
    siteContent['email-templates'] = lib;
    adminPrivateContent['email-templates'] = lib;
  });
  await page.evaluate(() => { window.settingsOpen && nav('view-settings'); window.settingsOpen('replies'); });
  await page.waitForTimeout(300);
  const m1 = await page.evaluate(() => Array.from(document.querySelectorAll('#replies-body .etpl-row-name')).map((e) => e.textContent.trim()));
  ok(m1.length === 2, `the Manage page lists the whole library, scoped rows included (${m1.length} rows)`);
  const scopeSub = await page.evaluate(() => Array.from(document.querySelectorAll('#replies-body .etpl-row-sub')).map((e) => e.textContent).join(' | '));
  ok(/after the stay/i.test(scopeSub), `a scoped row names its scope in the sub (${scopeSub.slice(0, 60)}…)`);
  await page.evaluate(() => window.emailTplEditOpen('bal'));
  const m1b = await page.evaluate(() => {
    const sel = document.getElementById('etpl-ed-when');
    return { has: !!sel, opts: sel ? sel.options.length : 0 };
  });
  ok(m1b.has && m1b.opts === 5, `the edit form carries the Shows-for select (${m1b.opts} options)`);
  await page.evaluate(() => {
    document.getElementById('etpl-ed-name').value = 'Renamed by the gate';
    document.getElementById('etpl-ed-when').value = 'before';
    return window.emailTplEditSave('bal');
  });
  await page.waitForTimeout(300);
  const m2 = await page.evaluate(() => Array.from(document.querySelectorAll('#replies-body .etpl-row-name')).map((e) => e.textContent.trim()));
  ok(m2.includes('Renamed by the gate'), 'an edit sticks and repaints');
  const editPost = posts.filter((p) => p.action === 'set' && p.key === 'email-templates').pop();
  ok(!!editPost && /Renamed by the gate/.test(editPost.value), 'the edit reaches the store');
  const editWhen = editPost ? (JSON.parse(editPost.value).find((t) => t.id === 'bal') || {}).when : '';
  ok(editWhen === 'before', `…and the chosen scope rides with it (${editWhen})`);
  await page.evaluate(() => { window.glassConfirm = async () => true; });
  await page.evaluate(() => window.emailTplDelete('quay'));
  await page.waitForTimeout(300);
  const m3 = await page.evaluate(() => Array.from(document.querySelectorAll('#replies-body .etpl-row-name')).map((e) => e.textContent.trim()));
  ok(m3.length === 1 && !/quay/i.test(m3.join()), 'delete removes the row');

  console.log('6b. nothing clips at phone width');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => { nav('view-backoffice'); window.openBookingEmail('b9'); });
  await page.waitForTimeout(400);
  const clip = await page.evaluate(() => {
    const box = document.querySelector('#enq-email-modal .reviews-modal-box');
    const r = box.getBoundingClientRect();
    const out = [];
    box.querySelectorAll('button, input, label').forEach((el) => {
      const b = el.getBoundingClientRect();
      if (b.width && (b.right > r.right + 1 || b.left < r.left - 1)) out.push((el.id || el.textContent.trim().slice(0, 18)) + ' ' + Math.round(b.right) + '>' + Math.round(r.right));
    });
    return { out: out.slice(0, 4), scroll: box.scrollWidth <= box.clientWidth + 1 };
  });
  ok(clip.out.length === 0 && clip.scroll, `no control clips outside the modal at 390px (${clip.out.join(' | ')})`);
  // the draft control reads in sentence case, not the global uppercase shout
  const caseCk = await page.evaluate(() => ({
    btn: getComputedStyle(document.getElementById('enq-email-draft')).textTransform,
    lab: getComputedStyle(document.querySelector('#enq-email-modal .modal-label')).textTransform,
  }));
  ok(caseCk.btn === 'none' && caseCk.lab === 'none', `the composer is sentence case (btn ${caseCk.btn}, label ${caseCk.lab})`);
  await page.evaluate(() => window.closeEnquiryEmailModal());
  await page.setViewportSize({ width: 1000, height: 900 });
  await page.waitForTimeout(200);

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

  console.log('8. the starter library');
  // A NEVER-SAVED store (key absent) offers the starter set — the feature
  // demonstrating itself instead of opening on "Nothing saved yet".
  const s8 = await page.evaluate(() => {
    delete siteContent['email-templates'];
    delete adminPrivateContent['email-templates'];
    __etplQ = '';
    __etplOpen = true;
    etplRender();
    const names = Array.from(document.querySelectorAll('#etpl-panel .etpl-row .etpl-row-name')).map((e) => e.textContent.trim());
    const balRow = Array.from(document.querySelectorAll('#etpl-panel .etpl-row')).find((r) => /nudge about the balance/.test(r.textContent));
    return {
      count: names.length,
      hasBalance: names.some((n) => /A nudge about the balance/.test(n)),
      // The enquiry-only and after-stay starters must NOT show on a pre-stay
      // booking — the applicability rule applied to the starters themselves.
      offScope: names.some((n) => /dates are free|dates are taken|After your stay|deposit is on its way back/.test(n)),
      balEnabled: !!balRow && !balRow.disabled,
      balResolved: !!balRow && /£\d/.test(balRow.textContent),
    };
  });
  ok(s8.count >= 3 && s8.hasBalance && !s8.offScope, `an untouched library offers the starters that FIT this record (${s8.count} rows, none off-scope)`);
  ok(s8.balEnabled && s8.balResolved, 'the balance starter resolves through bookingDue and is insertable on an owing booking');
  // An EXPLICITLY EMPTIED library ('[]') stays empty — deleting the last
  // starter must not resurrect the set (absent and emptied are different facts).
  const s8b = await page.evaluate(() => {
    siteContent['email-templates'] = '[]';
    adminPrivateContent['email-templates'] = '[]';
    etplRender();
    return {
      rows: document.querySelectorAll('#etpl-panel .etpl-row').length,
      none: /Nothing saved yet/.test((document.getElementById('etpl-panel') || {}).textContent || ''),
    };
  });
  ok(s8b.rows === 0 && s8b.none, 'an explicitly emptied library stays empty — the starters never resurrect');
  // The Manage caption names the starters for what they are while the store is
  // untouched (the #replies-body host is still in the DOM from §6).
  const s8c = await page.evaluate(() => {
    delete siteContent['email-templates'];
    delete adminPrivateContent['email-templates'];
    renderSavedReplies();
    return (document.querySelector('#replies-body .etpl-mcap') || {}).textContent || '';
  });
  ok(/starter replies to begin with/.test(s8c), `Manage says these are starters, not saves (${s8c.slice(0, 50)}…)`);
  ok(pageErrors.length === 0, `no page errors across the run (${pageErrors.slice(0, 2).join(' | ')})`);

  await done(fails);
  console.log(fails ? `\nREPLIES TEST FAILED (${fails}) ❌` : '\nREPLIES TEST PASSED ✅');
  process.exit(fails ? 1 : 0);
})();
