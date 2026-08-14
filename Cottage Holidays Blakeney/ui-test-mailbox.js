// Inbox → Email folder (comms dashboard), end to end against a mocked mailbox.php:
//  1. list renders rows (unread chip on unseen)
//  2. open → text-only reader; a hostile HTML body renders inert (escaped)
//  3. reply prefills to/subject + quoted body; send posts the right payload
//  4. compose fresh; validation (bad address, empty fields)
//  5. delete confirms then posts + removes the row
// The site reckons "today" in UK time (todayDashed / ukNowParts), so the
// tests must too — pin the whole process (and the browser it launches) to
// Europe/London so fixtures built from new Date() agree with the app on
// any runner, in any timezone. Must run before the first Date call.
const { d, boot } = require('./ui-test-lib'); // pins TZ=Europe/London at require time
let fails = 0;
const ok = (b, m) => { console.log(`  ${b ? '✓' : '✗'} ${m}`); if (!b) fails++; };

(async () => {
  const { page, browser, base, done } = await boot({ viewport: { width: 1000, height: 900 } });

  // Local-formatted, never toISOString() — that's UTC and slips a day near midnight.
  const d = (n) => { const t = new Date(); const x = new Date(t.getFullYear(), t.getMonth(), t.getDate() + n); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
  const bookingRows = [{
    id: 9, prop_key: '21a', name: 'A Guest', email: 'guest@example.com', phone: '', address: '1 Lane',
    postcode: 'NR25 7AB', check_in: d(12), check_out: d(15), check_in_time: '15:00', check_out_time: '10:00',
    adults: 2, children: 0, payment: 'unpaid', deposit_paid: 0, payment_method: '', payment_date: '',
    agreed_total: 440, agreed_per_night: 130, agreed_nights: 3, agreed_nightly: 390, agreed_booking_fee: 50,
    agreed_txn_pct: 0, agreed_txn_fee: 0, agreed_on: d(0), hold_status: 'none', notes: '',
  }];
  const sentRows = [{ id: 5, to_email: 'old@example.com', cc_email: null, subject: 'Earlier note', body: 'Hello there', sent_at: d(-2) + ' 10:00:00' }];
  const messages = [
    { uid: 'u1', from: 'guest@example.com', fromRaw: 'A Guest <guest@example.com>', subject: 'Question about parking', date: '2026-07-10 09:15:00', seen: false },
    { uid: 'u2', from: 'other@example.com', fromRaw: 'Other Person', subject: 'Re: Your stay', date: '2026-07-08 14:00:00', seen: true },
  ];
  const posts = [];
  await page.route(/\.php/, (route) => {
    const url = route.request().url();
    const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (route.request().method() === 'POST') {
      const b = JSON.parse(route.request().postData() || '{}');
      b.__url = url.split('/').pop().split('?')[0];
      posts.push(b);
      if (b.__url === 'mailbox.php') {
        if (b.action === 'list') return json({ ok: true, messages, total: 2, hasMore: !b.offset });
        if (b.action === 'sent') return json({ ok: true, messages: sentRows });
        if (b.action === 'read') return json({ ok: true, uid: b.uid, from: 'guest@example.com', fromRaw: 'A Guest <guest@example.com>', to: 'stay@chb.co.uk', date: '2026-07-10 09:15:00', subject: 'Question about parking', body: 'Hello,\nIs there parking?\n<script>window.__pwned=1</script><img src=x onerror="window.__pwned=2">', attachments: [{ i: 0, name: 'directions.pdf', mime: 'application/pdf', size: 34567 }] });
        if (b.action === 'mark_unread') return json({ ok: true });
        if (b.action === 'send') return json({ ok: true });
        if (b.action === 'delete') return json({ ok: true });
      }
      if (b.__url === 'enquiries.php' && b.action === 'declined') {
        return json({ ok: true, enquiries: [{
          id: 91, prop_key: '21a', name: 'Jem Beighton', email: 'j@x.co',
          check_in: d(40), check_out: d(44), adults: 2, children: 1,
          message: 'Is there space to park a small van, and can we arrive late on the Saturday?',
          created_at: d(-20) + ' 09:00:00', declined_at: d(-3) + ' 11:20:00',
        }] });
      }
      return json({ ok: true, events: [], logs: {}, reviews: [], photos: [] });
    }
    if (url.includes('bookings.php')) return json({ bookings: bookingRows });
    return json({ ok: true, bookings: [], enquiries: [], properties: [], seasons: {}, occupancy: {}, content: {}, blocks: [], ranges: [], payments: [], years: [] });
  });

  await page.goto(`${base}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  await page.evaluate(() => { isAuthenticated = true; document.body.classList.add('owner-mode'); });
  await page.evaluate(() => window.loadAdminBundle());
  await page.waitForTimeout(600);
  await page.evaluate(async () => { await window.openInbox(); });
  await page.waitForTimeout(400);
  await page.evaluate(() => window.inboxFolder('email'));
  await page.waitForTimeout(900);

  console.log('1. list (Inbox → Email folder)');
  const l = await page.evaluate(() => ({
    rows: document.querySelectorAll('#mailbox-body .bk-row').length,
    unreadChips: document.querySelectorAll('#mailbox-body .mbx-unread').length,
    activeView: (document.querySelector('.page-view.active') || {}).id,
    emailShown: (document.getElementById('inbox-folder-email') || { style: {} }).style.display !== 'none',
    enqHidden: (document.getElementById('inbox-folder-enquiries') || { style: {} }).style.display === 'none',
    noPane: !!document.querySelector('.enq-split.no-pane'),
    firstSubject: (document.querySelector('#mailbox-body .bk-row .bk-row-dates') || {}).textContent || '',
  }));
  ok(l.rows === 2 && l.unreadChips === 1, `2 messages listed, 1 unread (${l.rows}/${l.unreadChips})`);
  // The pane is never 'released' any more — on desktop it serves every folder
  // (Apple-Mail layout); below 1200px it's simply hidden by CSS.
  ok(l.activeView === 'view-inbox' && l.emailShown && l.enqHidden && !l.noPane, `email folder active in the Inbox, pane kept (${l.activeView})`);
  ok(l.firstSubject === 'Question about parking', `subject shown (${l.firstSubject})`);

  console.log('1b. folder switch + unread chip');
  const f = await page.evaluate(() => {
    inboxFolder('messages');
    const msgShown = document.getElementById('inbox-folder-messages').style.display !== 'none';
    const emailHidden = document.getElementById('inbox-folder-email').style.display === 'none';
    inboxFolder('email');
    return { msgShown, emailHidden, chip: (document.getElementById('ifold-count-mbx') || {}).textContent || '' };
  });
  ok(f.msgShown && f.emailHidden, 'folder switch toggles the containers');
  ok(f.chip === '1', `Email folder chip shows the unread count (${f.chip})`);

  console.log('2. reader (hostile body inert)');
  await page.click('#mailbox-body .bk-row');
  await page.waitForTimeout(700);
  const r = await page.evaluate(() => ({
    bodyShown: /Is there parking\?/.test((document.querySelector('.mbx-text') || {}).textContent || ''),
    scriptVisible: /<script>/.test((document.querySelector('.mbx-text') || {}).textContent || ''),
    pwned: window.__pwned || 0,
    imgs: document.querySelectorAll('.mbx-text img').length,
  }));
  ok(r.bodyShown, 'message text renders');
  ok(r.scriptVisible && r.pwned === 0 && r.imgs === 0, `hostile HTML shown as text, never executed (pwned=${r.pwned})`);

  console.log('2a. accordion — the email opens INSIDE its row, and collapses');
  const acc = await page.evaluate(() => {
    const open = document.querySelector('#mailbox-body .mbx-item.open');
    return {
      insideRow: !!(open && open.querySelector('.mbx-inline .mbx-text')),
      expanded: !!open && open.querySelector('.bk-row').getAttribute('aria-expanded') === 'true',
      // Assert the WAY OUT, not the word on it: the label has been both
      // "Collapse" and "Close" and neither is the thing being checked.
      collapseBtn: !!(open && open.querySelector('[data-act="mailboxCollapse"]')),
    };
  });
  ok(acc.insideRow, 'reader renders inside the tapped row (not at the page bottom)');
  ok(acc.expanded, 'row marked aria-expanded');
  ok(acc.collapseBtn, 'a control that closes the reader is present');
  await page.evaluate(() => document.querySelector('#mailbox-body .mbx-item.open .bk-row').click());
  await page.waitForTimeout(300);
  const collapsed = await page.evaluate(() => ({
    stillOpen: !!document.querySelector('#mailbox-body .mbx-item.open'),
    readerGone: !document.querySelector('#mailbox-body .mbx-inline .mbx-text'),
  }));
  ok(!collapsed.stillOpen && collapsed.readerGone, 'second tap on the row collapses the email');
  await page.evaluate(() => { const b = [...document.querySelectorAll('#mailbox-body .bk-row')].find((x) => /parking/i.test(x.textContent)); b && b.click(); });
  await page.waitForTimeout(600);

  console.log('2b. guest context + attachments');
  // The guest-match is a VERDICT FOLD now — the summary names the match, the
  // hub chips sit in the fold beneath it (in the DOM whether open or closed).
  const ctx = await page.evaluate(() => ({
    match: /Their booking|Known guest/.test((document.querySelector('.mbx-ctx-d') || {}).textContent || ''),
    chip: !!document.querySelector('.mbx-ctx-d .bhub-stay-row'),
    closed: !(document.querySelector('.mbx-ctx-d') || {}).open,
    att: ((document.querySelector('.mbx-att') || {}).textContent || '').trim(),
    attHref: (document.querySelector('.mbx-att') || {}).getAttribute?.('href') || '',
  }));
  ok(ctx.match && ctx.chip, 'sender recognised — guest-match fold with a hub chip');
  ok(ctx.closed, 'the guest-match starts folded — the message leads');
  ok(/directions\.pdf/.test(ctx.att) && /34 KB/.test(ctx.att), `attachment listed with size (${ctx.att})`);
  ok(/action=attachment&uid=u1&i=0/.test(ctx.attHref), 'attachment download link correct');
  await page.evaluate(() => document.querySelector('.mbx-ctx .bhub-stay-row').click());
  await page.waitForTimeout(700);
  const hubbed = await page.evaluate(() => ({
    active: (document.querySelector('.page-view.active') || {}).id,
    name: (document.querySelector('.bhub-name') || {}).textContent || '',
  }));
  ok(/view-(booking-hub|backoffice)/.test(hubbed.active) && hubbed.name === 'A Guest', `context chip opens the booking hub (${hubbed.name})`);
  // The old Manage home must still work: settingsOpen('mailbox') redirects here.
  await page.evaluate(async () => { await window.openArea('manage'); window.settingsOpen('mailbox'); });
  await page.waitForTimeout(900);
  const redir = await page.evaluate(() => ({
    view: (document.querySelector('.page-view.active') || {}).id,
    emailShown: (document.getElementById('inbox-folder-email') || { style: {} }).style.display !== 'none',
  }));
  ok(redir.view === 'view-inbox' && redir.emailShown, `settingsOpen('mailbox') redirects to Inbox → Email (${redir.view})`);
  await page.evaluate(() => renderMailboxList());
  await page.waitForTimeout(300);
  await page.click('#mailbox-body .bk-row');
  await page.waitForTimeout(700);

  console.log('3. reply');
  await page.evaluate(() => mailboxReply('u1'));
  await page.waitForTimeout(300);
  const rep = await page.evaluate(() => ({
    to: (document.getElementById('mbx-to') || {}).value,
    subject: (document.getElementById('mbx-subject') || {}).value,
    quoted: ((document.getElementById('mbx-text') || {}).value || '').includes('> Is there parking?'),
  }));
  ok(rep.to === 'guest@example.com' && rep.subject === 'Re: Question about parking' && rep.quoted, `reply prefilled + quoted (${rep.subject})`);
  await page.evaluate(() => { document.getElementById('mbx-text').value = 'Yes — free parking on the drive.'; mailboxSend(); });
  let sent = null;
  for (let i = 0; i < 30 && !sent; i++) { await page.waitForTimeout(100); sent = posts.find((p) => p.action === 'send'); }
  ok(!!sent && sent.to === 'guest@example.com' && /^Re: Question/.test(sent.subject) && /free parking/.test(sent.body), `send posted the reply (${sent && sent.to})`);

  console.log('4. compose validation');
  await page.waitForTimeout(500);
  await page.evaluate(() => mailboxCompose());
  await page.waitForTimeout(300);
  await page.evaluate(() => { document.getElementById('mbx-to').value = 'not-an-email'; mailboxSend(); });
  await page.waitForTimeout(200);
  const v = await page.evaluate(() => (document.getElementById('mbx-msg') || {}).textContent || '');
  ok(/valid "To"/.test(v), `bad address blocked (${v})`);

  console.log('4b. tabs, search, mark unread');
  // Reached by CLICKING, not by calling mailboxTab() — this step used to invoke the
  // function directly, which is precisely how the missing affordance hid: the Sent
  // branch was fully built and asserted here while mailboxTab had NO caller in the
  // UI, so the list was unreachable for a real owner. Drive it the way they do.
  const tabs = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('#mailbox-body .inbox-sort.seg .inbox-sort-btn')];
    return { n: btns.length, labels: btns.map((b) => b.textContent.trim().replace(/\s+/g, ' ')), on: btns.filter((b) => b.classList.contains('is-on')).map((b) => b.textContent.trim()) };
  });
  ok(tabs.n === 2 && /Inbox/.test(tabs.labels[0]) && /Sent/.test(tabs.labels[1]), `the mailbox has an Inbox|Sent switch (${tabs.labels.join(' | ')})`);
  ok(tabs.on.length === 1 && /Inbox/.test(tabs.on[0]), `Inbox starts selected (${tabs.on.join(',')})`);
  const sentBtn = await page.$('#mailbox-body .inbox-sort.seg .inbox-sort-btn:nth-child(2)');
  ok(!!sentBtn, 'the Sent tab is a real, clickable control');
  // Guarded so a missing switch reports as failed checks rather than throwing on
  // null — the checks below then fail on the wrong state, which reads far better
  // in CI than a stack trace.
  if (sentBtn) await sentBtn.click();
  await page.waitForTimeout(250);
  const st = await page.evaluate(() => ({
    rows: document.querySelectorAll('#mailbox-body .bk-row').length,
    text: (document.getElementById('mailbox-body') || {}).textContent || '',
    on: [...document.querySelectorAll('#mailbox-body .inbox-sort-btn.is-on')].map((b) => b.textContent.trim()).join(','),
    sel: [...document.querySelectorAll('#mailbox-body .inbox-sort-btn')].map((b) => b.getAttribute('aria-selected')).join(','),
  }));
  // the reply sent in step 3 tops the list; the ledger row sits beneath
  ok(st.rows === 2 && /old@example\.com/.test(st.text) && /guest@example\.com/.test(st.text), `Sent tab lists the just-sent reply + the ledger (${st.rows} rows)`);
  ok(/Sent/.test(st.on) && st.sel === 'false,true', `the switch moves its selected state with the tap (on=${st.on}, aria=${st.sel})`);
  // REFRESH IS A DATA REFRESH, NOT A RESET. loadMailbox() forced __mbxTab='inbox' and
  // __mbxQuery='' at the end — and its own Refresh button reaches it, so checking for new
  // mail while reading Sent threw the owner back to Inbox and wiped their search
  // (measured before the fix: sent → inbox, "old" → ""). Driven by CLICKING the button,
  // because that is the path that was broken.
  await page.evaluate(() => mailboxSearch('old'));
  await page.waitForTimeout(200);
  await page.click('#mailbox-body .cal-refresh-btn');
  await page.waitForTimeout(700);
  const refreshed = await page.evaluate(() => ({
    tab: __mbxTab, q: __mbxQuery,
    on: [...document.querySelectorAll('#mailbox-body .inbox-sort-btn.is-on')].map((b) => b.textContent.trim()).join(','),
  }));
  ok(refreshed.tab === 'sent' && /Sent/.test(refreshed.on),
    `Refresh keeps you on the tab you were reading (${refreshed.tab}, selected: ${refreshed.on})`);
  ok(refreshed.q === 'old', `…and keeps your search rather than wiping it ("${refreshed.q}")`);

  await page.evaluate(() => mailboxTab('inbox'));
  await page.waitForTimeout(200);
  await page.evaluate(() => mailboxSearch('parking'));
  await page.waitForTimeout(200);
  const sr = await page.evaluate(() => document.querySelectorAll('#mailbox-body .bk-row').length);
  ok(sr === 1, `search filters the list (${sr} match)`);
  // A SEARCH THAT ONLY SEARCHED WHAT WAS LOADED. The list holds one fetched page, so
  // filtering it makes "nothing matched" a confident negative about mail still on the
  // server — worse than a short list. The fixture reports hasMore, so the note and the
  // way to widen it must both be on screen while a search is active.
  const capNote = await page.evaluate(() => ({
    hasMore: __mbxHasMore,
    text: (document.getElementById('mailbox-body') || {}).innerText || '',
    older: [...document.querySelectorAll('#mailbox-body [data-act="mailboxOlder"]')].map((b) => b.textContent.trim()),
  }));
  ok(capNote.hasMore, 'the fixture really has older mail on the server (else this proves nothing)');
  ok(/Searched the \d+ email/i.test(capNote.text) && /older mail on the server/i.test(capNote.text),
    `SEARCH-CAP: a search says what it actually searched (${(capNote.text.match(/Searched[^\n]*/) || [''])[0]})`);
  ok(capNote.older.some((t) => /search again/i.test(t)),
    `SEARCH-CAP: …and offers to widen it (${capNote.older.join(' | ')})`);
  await page.evaluate(() => mailboxSearch(''));
  await page.waitForTimeout(200);
  const noCap = await page.evaluate(() => ({
    text: (document.getElementById('mailbox-body') || {}).innerText || '',
    older: [...document.querySelectorAll('#mailbox-body [data-act="mailboxOlder"]')].map((b) => b.textContent.trim()),
  }));
  ok(!/Searched the/i.test(noCap.text) && noCap.older.some((t) => /Load older messages/.test(t)),
    'SEARCH-CAP: with no search it is the plain "Load older messages" again, not the note');
  await page.waitForTimeout(200);
  await page.evaluate(() => mailboxMarkUnread('u1'));
  await page.waitForTimeout(400);
  const mu = await page.evaluate(() => document.querySelectorAll('#mailbox-body .mbx-unread').length);
  ok(mu === 1 && posts.some((p) => p.action === 'mark_unread'), `mark unread posted + chip restored (${mu} unread)`);

  console.log('5. delete');
  await page.evaluate(() => renderMailboxList());
  await page.waitForTimeout(200);
  await page.click('#mailbox-body .bk-row');
  await page.waitForTimeout(700);
  const del = page.evaluate(() => mailboxDelete('u1'));
  await page.waitForTimeout(500);
  await page.evaluate(() => glassDialogResolve(true));
  await del.catch(() => {});
  await page.waitForTimeout(400);
  const delState = await page.evaluate(() => ({
    rows: document.querySelectorAll('#mailbox-body .bk-row').length,
  }));
  ok(posts.some((p) => p.action === 'delete' && p.uid === 'u1') && delState.rows === 1, `delete confirmed, posted, row removed (${delState.rows} left)`);

  // ONE ROW PER CONVERSATION. Four rows reading "anneolin@btinternet.com · Re:
  // Pay your deposit — Pimpernel" are one chain wearing four costumes (owner's
  // screenshot). Driven through the REAL renderer with a hostile fixture: the
  // same subject from a DIFFERENT sender must stay its own row, because that
  // subject is the same words for every guest we chase — merging on subject
  // alone would file one guest's mail under another's name.
  console.log('6. one row per conversation');
  const th = await page.evaluate(() => {
    __mbxMessages = [
      { uid: 'c1', from: 'anneolin@btinternet.com', fromRaw: 'Anne Olin <anneolin@btinternet.com>', subject: 'Pay your deposit — Pimpernel (#12xab12cd34ef5678)', date: '2026-07-22 08:05:00', seen: true },
      { uid: 'c2', from: 'anneolin@btinternet.com', fromRaw: 'Anne Olin <anneolin@btinternet.com>', subject: 'Re: Pay your deposit — Pimpernel', date: '2026-07-22 11:30:00', seen: true },
      { uid: 'c3', from: 'anneolin@btinternet.com', fromRaw: 'Anne Olin <anneolin@btinternet.com>', subject: 'RE: Re: Pay your deposit — Pimpernel', date: '2026-07-22 16:40:00', seen: false },
      { uid: 'd1', from: 'bob@example.com', fromRaw: 'Bob Carter <bob@example.com>', subject: 'Re: Pay your deposit — Pimpernel', date: '2026-07-19 10:00:00', seen: true },
      { uid: 'e1', from: 'anneolin@btinternet.com', fromRaw: 'Anne Olin <anneolin@btinternet.com>', subject: 'Parking at the cottage', date: '2026-07-18 10:00:00', seen: true },
    ];
    __mbxTab = 'inbox';
    __mbxQuery = '';
    renderMailboxList();
    const rows = [...document.querySelectorAll('#mailbox-body .mbx-item')];
    return {
      n: rows.length,
      uids: rows.map((r) => r.dataset.uid),
      names: rows.map((r) => (r.querySelector('.bk-row-name') || {}).textContent || ''),
      subjects: rows.map((r) => (r.querySelector('.bk-row-dates') || {}).textContent || ''),
      counts: rows.map((r) => {
        const m = /(\d+) emails/.exec((r.querySelector('.bk-row-top') || {}).textContent || '');
        return m ? Number(m[1]) : 0;
      }),
      unread: rows.map((r) => r.querySelector('.bk-row').classList.contains('mbx-unread')),
    };
  });
  ok(th.n === 3, `5 emails collapse to 3 conversations (${th.n})`);
  ok(th.counts[0] === 3 && th.counts[1] === 0 && th.counts[2] === 0,
    `only a real chain wears a count chip (${th.counts.join('/')})`);
  ok(th.uids.join(',') === 'c3,d1,e1',
    `each row stands for its NEWEST message, newest chain first (${th.uids.join(',')})`);
  ok(/Bob Carter/.test(th.names[1]) && /Anne Olin/.test(th.names[0]),
    `the same subject from another sender stays its own row (${th.names[1].trim()})`);
  ok(th.unread[0] === true && th.unread[1] === false,
    'a chain reads unread when ANY message in it is unread');
  ok(/Parking at the cottage/.test(th.subjects[2]),
    `the same sender's other conversation is not swept in (${th.subjects[2]})`);

  // The chain OPENS on its newest message with the rest listed beneath, and an
  // earlier one swaps the reader in place — it must not fold the row up, which
  // is what a uid-equality "second tap = collapse" rule would have done.
  await page.evaluate(() => document.querySelector('#mailbox-body .mbx-item .bk-row').click());
  await page.waitForTimeout(700);
  const chain = await page.evaluate(() => {
    const it = document.querySelector('#mailbox-body .mbx-item.open');
    return {
      showing: it && it.dataset.showing,
      earlier: it ? it.querySelectorAll('.mbx-earlier .mbx-chain-row').length : -1,
      label: it ? /Earlier in this conversation/.test(it.textContent) : false,
      // Three replies on one afternoon used to render three identical dates.
      times: it ? [...it.querySelectorAll('.mbx-chain-time')].map((x) => x.textContent.trim()) : [],
    };
  });
  ok(chain.showing === 'c3' && chain.earlier === 2 && chain.label,
    `the chain opens on its newest, the other 2 listed beneath (showing ${chain.showing}, ${chain.earlier} earlier)`);
  // THE WHOLE CHAIN IS ONE AFTERNOON — the fixture is deliberately same-day,
  // because that is the case the owner reported: three rows reading an
  // identical "29/07/2026" with nothing to tell them apart. The time is the
  // distinguishing fact, so it has to be on the row.
  ok(chain.times.length === 2 && chain.times[0] && chain.times[1] && chain.times[0] !== chain.times[1],
    `same-day replies are told apart by their time (${chain.times.join(' / ') || 'none shown'})`);
  // Guarded like the Sent-tab click above: a build with no chain should report
  // failed checks, not throw on null.
  await page.evaluate(() => { const b = document.querySelector('#mailbox-body .mbx-item.open .mbx-earlier .mbx-chain-row'); b && b.click(); });
  await page.waitForTimeout(700);
  const swapped = await page.evaluate(() => {
    const it = document.querySelector('#mailbox-body .mbx-item.open');
    return {
      stillOpen: !!it,
      showing: it && it.dataset.showing,
      earlier: it ? it.querySelectorAll('.mbx-earlier .mbx-chain-row').length : -1,
    };
  });
  ok(swapped.stillOpen && swapped.showing === 'c2' && swapped.earlier === 2,
    `tapping an earlier email swaps the reader without closing the row (showing ${swapped.showing})`);
  // A lone email is untouched by any of this — no chip, no "Earlier" block.
  await page.evaluate(() => {
    mailboxCollapse();
    const it = [...document.querySelectorAll('#mailbox-body .mbx-item')].find((x) => x.dataset.uid === 'e1');
    it && it.querySelector('.bk-row').click();
  });
  await page.waitForTimeout(700);
  const lone = await page.evaluate(() => {
    const it = document.querySelector('#mailbox-body .mbx-item.open');
    return { uid: it && it.dataset.uid, earlier: it ? it.querySelectorAll('.mbx-earlier').length : -1 };
  });
  ok(lone.uid === 'e1' && lone.earlier === 0, 'a one-email conversation reads exactly as it always did');

  // EVERYTHING IN THE KNOWN-GUEST BOX IS INLINE WITH EVERYTHING ELSE. Its
  // parts — cottage, when, open — are one sentence about one stay, and
  // `space-between` flung them to the corners of a full-width row. The dates
  // are one fact and must never fragment: squeezed, "28-31 Aug 2026" broke
  // over FOUR lines and took the row to 105px.
  console.log('7. the known-guest box is one inline line');
  const inlineAt = async (w) => {
    await page.setViewportSize({ width: w, height: 900 });
    await page.waitForTimeout(250);
    await page.evaluate(() => { mailboxCollapse(); const b = document.querySelector('#mailbox-body .bk-row'); b && b.click(); });
    await page.waitForTimeout(700);
    return page.evaluate(() => {
      // Geometry needs the PAINT — open the fold the way an owner does.
      const d = document.querySelector('.mbx-ctx-d');
      if (d) d.open = true;
      const ctx = document.querySelector('.mbx-ctx');
      const row = ctx && ctx.querySelector('.bhub-stay-row');
      const cap = document.querySelector('.mbx-ctx-drow');
      if (!row || !cap) return null;
      const rr = row.getBoundingClientRect();
      const cr = cap.getBoundingClientRect();
      const kids = [...row.children].map((el) => el.getBoundingClientRect());
      const mids = kids.map((k) => k.top + k.height / 2);
      const dates = [...row.querySelectorAll('span')].find((x) => /\d/.test(x.textContent) && !x.classList.contains('prop-tag'));
      const dr = dates ? dates.getBoundingClientRect() : { height: 0 };
      // Widest gap between one part and the next — "flung to the corners" is
      // what this catches; packed inline it is the flex gap.
      const sorted = kids.slice().sort((a, b) => a.left - b.left);
      let widestGap = 0;
      for (let i = 1; i < sorted.length; i++) widestGap = Math.max(widestGap, sorted[i].left - sorted[i - 1].right);
      return {
        parts: kids.length,
        spread: Math.round(Math.max(...mids) - Math.min(...mids)),
        rowH: Math.round(rr.height),
        dateH: Math.round(dr.height),
        lineH: Math.round(parseFloat(getComputedStyle(row).fontSize) * 1.6),
        widestGap: Math.round(widestGap),
        capAbove: cr.bottom <= rr.top + 1,
      };
    });
  };
  // HOSTILE WIDTH: the real cottage names fit, so without an injected long one
  // the no-wrap rule is never exercised and the check is vacuous (it was —
  // deleting the rule left it green). A squeezed row must clip the NAME and
  // keep the dates whole.
  await page.setViewportSize({ width: 390, height: 900 });
  await page.waitForTimeout(250);
  await page.evaluate(() => { mailboxCollapse(); const b = document.querySelector('#mailbox-body .bk-row'); b && b.click(); });
  await page.waitForTimeout(700);
  const squeezed = await page.evaluate(() => {
    const d = document.querySelector('.mbx-ctx-d');
    if (d) d.open = true;
    const row = document.querySelector('.mbx-ctx .bhub-stay-row');
    if (!row) return null;
    const tag = row.querySelector('.prop-tag');
    if (tag) tag.textContent = 'The Old Harbourmasters Cottage House';
    const card = document.querySelector('.mbx-inline-card');
    const dates = [...row.querySelectorAll('span')].find((x) => /\d/.test(x.textContent) && !x.classList.contains('prop-tag'));
    const dr = dates.getBoundingClientRect();
    const rr = row.getBoundingClientRect();
    const cr = card.getBoundingClientRect();
    return {
      dateH: Math.round(dr.height),
      lineH: Math.round(parseFloat(getComputedStyle(row).fontSize) * 1.6),
      overflow: Math.round(rr.right - cr.right),
      clipped: tag ? tag.scrollWidth > tag.clientWidth + 1 : false,
    };
  });
  ok(!!squeezed && squeezed.dateH <= squeezed.lineH + 4,
    `SQUEEZED: a 36-char cottage name never breaks the dates (${squeezed ? squeezed.dateH + 'px vs ' + squeezed.lineH : '?'})`);
  ok(!!squeezed && squeezed.clipped && squeezed.overflow <= 0,
    `SQUEEZED: the NAME clips instead, and the row stays inside its card (${squeezed ? squeezed.overflow : '?'}px past)`);

  for (const w of [390, 900]) {
    const m = await inlineAt(w);
    const tag = w === 390 ? 'PHONE' : 'WIDE';
    ok(!!m && m.parts >= 3 && m.spread <= 3,
      `${tag}: all ${m ? m.parts : 0} parts sit on one line together (centres within ${m ? m.spread : '?'}px)`);
    ok(!!m && m.widestGap <= 24,
      `${tag}: they are packed inline, not flung to the corners (widest gap ${m ? m.widestGap : '?'}px)`);
    ok(!!m && m.dateH <= m.lineH + 4, `${tag}: the dates never fragment (${m ? m.dateH + 'px vs ' + m.lineH : '?'})`);
    ok(!!m && m.capAbove, `${tag}: the fold's verdict row stays above the opened box`);
  }

  // ---- THE DECLINED DRAWER SAYS WHAT IT IS ---------------------------------
  // Reported from a phone: a green 0 and "All caught up — nothing needs a reply"
  // sat above a list with a declined enquiry in it, and the row never said WHEN it
  // was turned down — mapEnquiryFromApi dropped declined_at, which enquiries.php
  // both SELECTs and ORDERs BY. Driven by CLICKING the tab (chbAttrs emits
  // data-args, a JSON list, so a [data-arg=…] selector finds nothing — which is
  // how the first version of this silently tested an unclicked tab).
  await page.evaluate(() => window.inboxFolder('enquiries'));
  await page.waitForTimeout(200);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('#inbox-list .inbox-sort-btn')].find(
      (x) => x.textContent.trim() === 'Declined',
    );
    if (b) b.click();
  });
  await page.waitForTimeout(700);
  const dec = await page.evaluate(() => {
    const row = document.querySelector('.enq-declined-row');
    const q = (sel) => (row ? row.querySelector(sel) : null);
    const head = document.querySelector('#inbox-folder-enquiries .bo-sec-title');
    const badge = document.getElementById('inbox-badge');
    const btn = q('.enq-declined-restore');
    return {
      chip: q('.bk-chip.declined') ? q('.bk-chip.declined').textContent.trim() : '',
      btn: btn ? btn.textContent.trim() : '',
      btnHit: btn ? Math.round(btn.getBoundingClientRect().height) : 0,
      msg: q('.enq-declined-msg') ? q('.enq-declined-msg').textContent.trim() : '',
      msgOneLine: q('.enq-declined-msg')
        ? q('.enq-declined-msg').getBoundingClientRect().height <=
          parseFloat(getComputedStyle(q('.enq-declined-msg')).lineHeight) + 2
        : false,
      lead: !!document.querySelector('.enq-declined-lead'),
      heading: head ? head.textContent.replace(/\s+/g, ' ').trim() : '',
      badgeShown: badge ? getComputedStyle(badge).display !== 'none' : true,
      subline: (document.getElementById('inbox-subline') || {}).textContent || '',
      // The archived read must NOT come from container opacity: that composites
      // every ink toward the ground and took the quoted message to 3.05:1.
      bodyOpacity: q('.bk-row-body') ? getComputedStyle(q('.bk-row-body')).opacity : '',
    };
  });
  ok(/^Declined\s+\S/.test(dec.chip), `the row says WHEN it was declined ("${dec.chip}")`);
  ok(dec.btn === 'Put back in Waiting', `the action says where it goes ("${dec.btn}")`);
  ok(dec.btnHit >= 24, `...at a real tap size (${dec.btnHit}px)`);
  ok(dec.msg.length > 4 && dec.msgOneLine, 'the guest\u2019s own words show, on one line');
  ok(dec.lead, 'the drawer explains itself once, above the rows');
  ok(/^Declined enquiries/.test(dec.heading), `the heading names the list beneath it ("${dec.heading}")`);
  ok(!dec.badgeShown, 'the WAITING count is not shown over the declined list');
  ok(/declined enquir/i.test(dec.subline), `the subline describes this screen ("${dec.subline}")`);
  ok(dec.bodyOpacity === '1', `the row body is not dimmed by opacity (${dec.bodyOpacity})`);

  // THE TWO PILLS ARE A PAIR, ON ONE LINE, AND THE COTTAGE NAME SURVIVES. Reported from
  // a phone. Two causes, both measured at 390px: .prop-tag is an inline-block pill built
  // for a STACKED context and carries margin-bottom: 12px, which inside this centred
  // flex row lifted it 6px above the chip (centres 523 vs 529); and "Put back in
  // Waiting" is 165px of nowrap button, so the body got 150px and — the chip being
  // flex-shrink: 0 — the cottage pill absorbed the whole squeeze and rendered 22px of
  // its 91, "Pimpernel" as "Pl…", the one word that says which cottage.
  await page.setViewportSize({ width: 390, height: 900 });
  await page.waitForTimeout(300);
  const pills = await page.evaluate(() => {
    const row = document.querySelector('.enq-declined-row');
    const tag = row.querySelector('.prop-tag'), chip = row.querySelector('.bk-chip'),
      btn = row.querySelector('.enq-declined-restore'), body = row.querySelector('.bk-row-body');
    const mid = (el) => { const r = el.getBoundingClientRect(); return Math.round(r.y + r.height / 2); };
    const t = tag.getBoundingClientRect(), c = chip.getBoundingClientRect();
    return {
      tagMid: mid(tag), chipMid: mid(chip),
      clipped: tag.scrollWidth > tag.clientWidth + 1,
      tagW: Math.round(t.width), tagNeeds: tag.scrollWidth,
      gap: Math.round(c.x - t.right),
      rowRight: Math.round(row.getBoundingClientRect().right),
      chipRight: Math.round(c.right),
      btnBelow: btn.getBoundingClientRect().top >= body.getBoundingClientRect().bottom - 1,
    };
  });
  ok(pills.tagMid === pills.chipMid,
    `the cottage pill and the Declined chip sit on one line (centres ${pills.tagMid} / ${pills.chipMid})`);
  ok(!pills.clipped,
    `the cottage name is not clipped (${pills.tagW}px for ${pills.tagNeeds}px of text)`);
  ok(pills.gap > 0 && pills.gap < 40 && pills.rowRight - pills.chipRight > 40,
    `…and they read as a pair rather than opposite corners (${pills.gap}px apart)`);
  ok(pills.btnBelow, 'on a phone the restore button takes its own line, so the pills get the width');
  // The wrap is CONDITIONAL, not a permanent stack: where the column can hold both, the
  // button still sits beside the row rather than below it.
  await page.setViewportSize({ width: 1100, height: 900 });
  await page.waitForTimeout(300);
  const wide = await page.evaluate(() => {
    const row = document.querySelector('.enq-declined-row');
    const btn = row.querySelector('.enq-declined-restore'), body = row.querySelector('.bk-row-body');
    const tag = row.querySelector('.prop-tag');
    return {
      beside: btn.getBoundingClientRect().top < body.getBoundingClientRect().bottom - 1,
      clipped: tag.scrollWidth > tag.clientWidth + 1,
    };
  });
  ok(wide.beside && !wide.clipped, 'on a wide column the button is beside the row, still unclipped');

  // ---- THE THREE ANSWERS: stacked (<1200px) the folder switch becomes three
  // verdict fold groups; the folder lists re-parent INTO the folds so every
  // list and handler above kept working untouched. ----
  console.log('10. the three-answers landing (stacked)');
  await page.setViewportSize({ width: 1000, height: 900 });
  await page.waitForTimeout(300);
  await page.evaluate(() => { inboxFolder('enquiries'); });
  await page.waitForTimeout(300);
  const land = await page.evaluate(() => {
    const landing = document.getElementById('inbox-landing');
    const vis = (el) => !!(el && el.getClientRects().length);
    return {
      landingShown: vis(landing),
      switchHidden: !vis(document.getElementById('inbox-folders')),
      grps: landing ? landing.querySelectorAll('.bhub-fold-grp').length : 0,
      enqInFold: (document.getElementById('inbox-folder-enquiries') || {}).parentElement === document.getElementById('iv-fold-enquiries'),
      enqOpen: !(document.getElementById('iv-fold-enquiries') || { hidden: true }).hidden,
      msgClosed: (document.getElementById('iv-fold-messages') || {}).hidden === true,
      enqFig: (document.getElementById('iv-sum-enquiries') || {}).textContent || '',
      listVisible: vis(document.getElementById('inbox-list')),
    };
  });
  ok(land.landingShown && land.switchHidden, 'the landing replaces the folder switch below 1200px');
  ok(land.grps >= 3, `three verdict groups render (${land.grps})`);
  ok(land.enqInFold && land.enqOpen && land.listVisible, 'inboxFolder() opens its fold with the real list inside');
  ok(land.msgClosed, 'the other answers stay folded (accordion)');
  ok(/0 waiting/.test(land.enqFig), `the enquiries verdict reads the real queue (${land.enqFig})`);
  // The capsule ladder: clear wears the ✓, unknown is STATED (the mailbox is
  // lazy — before the first fetch "nothing new" would be an unchecked claim),
  // and each answer carries its identity glyph.
  const caps = await page.evaluate(() => {
    // The suite opened the mailbox earlier — rewind the lazy flag so the
    // pre-first-fetch state is the one under test, then restore it.
    const was = __mbxOpenedOnce;
    /* eslint-disable-next-line no-global-assign */ __mbxOpenedOnce = false;
    inboxVerdicts();
    const emailUnk = /not checked yet/.test((document.getElementById('iv-sum-email') || {}).textContent || '')
      && /is-unk/.test(((document.querySelector('#iv-sum-email .st-cap') || {}).className || ''));
    /* eslint-disable-next-line no-global-assign */ __mbxOpenedOnce = was;
    inboxVerdicts();
    return {
      enqTone: ((document.querySelector('#iv-sum-enquiries .st-cap') || {}).className || ''),
      enqTick: !!document.querySelector('#iv-sum-enquiries .st-tick'),
      emailUnk,
      glyphs: document.querySelectorAll('#inbox-landing .iv-lic').length,
    };
  });
  ok(/is-ok/.test(caps.enqTone) && caps.enqTick, `a clear verdict is a green capsule wearing the ✓ (${caps.enqTone.trim()})`);
  ok(caps.emailUnk, 'the unchecked mailbox is a STATED muted capsule, not a blank');
  ok(caps.glyphs === 3, `each answer carries its identity glyph (${caps.glyphs})`);
  // A second tap on the open answer CLOSES it (ivToggle round trip).
  const rt = await page.evaluate(() => {
    document.querySelector('#inbox-landing .bhub-fold-row[data-arg="enquiries"]').click();
    const closed = (document.getElementById('iv-fold-enquiries') || {}).hidden === true;
    document.querySelector('#inbox-landing .bhub-fold-row[data-arg="enquiries"]').click();
    return { closed, reopened: !(document.getElementById('iv-fold-enquiries') || { hidden: true }).hidden };
  });
  ok(rt.closed && rt.reopened, 'a fold row toggles its answer open and closed');
  // The exception rule, both ways: a stale enquiry raises a red row above the
  // answers; clearing it stands the section down.
  const attn = await page.evaluate((old) => {
    enquiries.push({ id: 'e99', dbId: 99, propKey: '21a', name: 'Laura Hicks', email: 'l@x.com', checkIn: old.ci, checkOut: old.co, adults: 2, children: 0, guests: '2 adults', message: 'Is Jollyboat free?', received: old.made });
    renderInbox();
    const up = {
      row: /Waiting \d+ days — Laura Hicks/.test((document.getElementById('iv-attn') || {}).textContent || ''),
      cap: /Needs attention/.test((document.getElementById('iv-attn') || {}).textContent || ''),
      fig: (document.getElementById('iv-sum-enquiries') || {}).textContent || '',
      warnCap: !!document.querySelector('#iv-sum-enquiries .st-cap.is-warn .st-wic') && !document.querySelector('#iv-sum-enquiries .st-tick'),
    };
    enquiries.pop();
    renderInbox();
    const down = ((document.getElementById('iv-attn') || {}).textContent || '').trim() === '';
    return { up, down };
  }, { ci: d(30), co: d(33), made: d(-4) });
  ok(attn.up.row && attn.up.cap, 'a stale enquiry raises the Needs-attention row');
  // …AND IT WEARS THE HOUSE FOLD ANATOMY. `#inbox-landing .bhub-fold-lbl` was
  // written for the three hand-written answer rows, which wrap their text in
  // .iv-lwrap beside a glyph — but #iv-attn's rows come from the generic
  // bhubFoldGrp(), whose label and sub are SIBLINGS. As flex items the sub sat
  // BESIDE the label and squeezed it to 4px, breaking the guest's name into a
  // column of single words. Measured, not asserted on the selector: a label
  // narrower than its own first word is the defect.
  // At PHONE width, where the squeeze bit: at 1000px the label has room to spare and
  // the width half of this check would pass on the broken CSS.
  const attnW = page.viewportSize().width;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(250);
  const attnShape = await page.evaluate((old) => {
    enquiries.push({ id: 'e98', dbId: 98, propKey: '21a', name: 'Jem Beighton', email: 'j@x.com', checkIn: old.ci, checkOut: old.co, adults: 2, children: 0, guests: '2 adults', message: 'Free in Sep?', received: old.made });
    renderInbox();
    const grp = document.querySelector('#iv-attn .bhub-fold-grp');
    const lbl = grp && grp.querySelector('.bhub-fold-lbl');
    const sub = grp && grp.querySelector('.bhub-fold-sub');
    if (!lbl) { enquiries.pop(); renderInbox(); return null; }
    const lr = lbl.getBoundingClientRect(), sr = sub ? sub.getBoundingClientRect() : null;
    // MEASURE THE INKED TEXT, NOT THE ELEMENT BOX (the cottage-card lesson): under
    // flex the LABEL's box stayed a comfortable 177px while its own text run was
    // squeezed to a few pixels beside the sub, so a box measurement reports nothing
    // wrong. A Range over the label's own text nodes gives what is actually painted.
    const rng = document.createRange();
    let textW = 0, textLines = 0;
    for (const n of lbl.childNodes) {
      if (n.nodeType !== 3 || !String(n.nodeValue).trim()) continue;
      rng.selectNodeContents(n);
      const rects = [...rng.getClientRects()];
      textW = Math.max(textW, ...rects.map((x) => x.width));
      textLines = Math.max(textLines, rects.length);
    }
    const probe = document.createElement('span');
    probe.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap;';
    probe.style.font = getComputedStyle(lbl).font;
    probe.textContent = [...lbl.childNodes].filter((n) => n.nodeType === 3).map((n) => n.nodeValue).join(' ')
      .trim().split(/\s+/).sort((a, b) => b.length - a.length)[0] || '';
    document.body.appendChild(probe);
    const wordW = probe.getBoundingClientRect().width;
    probe.remove();
    const out = {
      lblW: Math.round(textW), wordW: Math.round(wordW), lines: textLines,
      // The sub belongs UNDER the label, not beside it.
      // The sub is a CHILD of the label, so "under it" is about the LEFT edge, not
      // the bottom: stacked (display:block) it starts on the label's own rail;
      // as a flex ITEM beside the text it was pushed right, which is what squeezed
      // the name. Compare rails, and require the sub to start below the first line.
      subStacked: sr ? Math.abs(sr.left - lr.left) <= 1 : null,
      subLower: sr ? sr.top > lr.top + 1 : null,
      dbg: JSON.stringify({ lblL: Math.round(lr.left), subL: sr ? Math.round(sr.left) : null, lblT: Math.round(lr.top), subT: sr ? Math.round(sr.top) : null }),
    };
    enquiries.pop(); renderInbox();
    return out;
  }, { ci: d(30), co: d(33), made: d(-6) });
  // 1.5x the longest word, not merely >= it: broken, the run measured 76px against a
  // 73px word — it "fitted" by 3px while breaking the name over FOUR lines, one word
  // each. A label that can hold more than a single word per line is the property.
  ok(attnShape && attnShape.lblW >= attnShape.wordW * 1.5,
    `the exception row's label holds more than one word per line (${attnShape && attnShape.lblW}px painted vs ${attnShape && attnShape.wordW}px longest word, ${attnShape && attnShape.lines} lines)`);
  ok(attnShape && attnShape.subStacked === true && attnShape.subLower === true,
    `and its sub is STACKED under the label, not squeezed beside it (${attnShape && attnShape.dbg})`);
  await page.setViewportSize({ width: attnW, height: 900 });
  await page.waitForTimeout(250);
  ok(/1 waiting/.test(attn.up.fig), `…and the verdict counts it (${attn.up.fig})`);
  ok(attn.up.warnCap, 'a busy verdict wears the warning triangle, not the ✓');
  ok(attn.down, 'answering it stands the red section down');
  // WIDE: the landing hides and the rail | list | pane layout is untouched.
  await page.setViewportSize({ width: 1300, height: 900 });
  await page.waitForTimeout(400);
  await page.evaluate(() => inboxFolder('enquiries'));
  await page.waitForTimeout(200);
  const wide2 = await page.evaluate(() => ({
    landingHidden: !(document.getElementById('inbox-landing') || {}).getClientRects().length,
    switchShown: !!(document.getElementById('inbox-folders') || {}).getClientRects().length,
    enqInMain: (document.getElementById('inbox-folder-enquiries') || {}).parentElement === document.getElementById('inbox-main'),
  }));
  ok(wide2.landingHidden && wide2.switchShown && wide2.enqInMain, 'at ≥1200px the landing hides and the folder divs sit back beside the rail');

  console.log('§11 THE MAIL WATCH: new customer email surfaces without opening the mailbox');
  await page.setViewportSize({ width: 900, height: 900 });
  await page.waitForTimeout(300);
  // (a) The landing verdict is HONEST about the server's own count: with the
  // reply-poll's store carrying 3 waiting and the mailbox never fetched, "not
  // checked yet" was the landing lying in the cautious direction.
  const mw1 = await page.evaluate(() => {
    window.__mbxOpenedOnceSave = __mbxOpenedOnce;
    __mbxOpenedOnce = false;
    // FREEZE loadData for this section: nav('view-inbox') fires openInbox, whose
    // unawaited loadData re-derives __newMailPre from the fixture's generic
    // bootstrap (null) MID-CHECK — measured, it clobbered the fresh count set by
    // the very chbMailCheck under test. §11 tests the mail watch, not loadData.
    window.__ldSave = window.loadData;
    window.loadData = async () => ({ ok: true, failed: [] });
    window.__newMailPre = { count: 3, items: [{ name: 'Anne Betts', from: 'anne@x.com', subject: 'Parking at Pimpernel' }] };
    nav('view-inbox');
    inboxVerdicts();
    return {
      fig: (document.getElementById('iv-sum-email') || {}).textContent || '',
      sub: (document.getElementById('iv-sub-email') || {}).textContent || '',
      warn: !!document.querySelector('#iv-sum-email .st-cap.is-warn, #iv-sum-email.is-warn') || /3 new/.test((document.getElementById('iv-sum-email') || {}).textContent || ''),
    };
  });
  ok(/3 new/.test(mw1.fig), `the unfetched mailbox verdict states the server's own count (${mw1.fig.trim()})`);
  ok(/Anne Betts/.test(mw1.sub) && /Parking/.test(mw1.sub), `…naming the latest sender (${mw1.sub.trim()})`);
  // …and with NO known count, unknown stays a stated third state.
  const mw0 = await page.evaluate(() => {
    window.__newMailPre = null;
    inboxVerdicts();
    return (document.getElementById('iv-sum-email') || {}).textContent || '';
  });
  ok(/not checked yet/.test(mw0), `no known count → the honest "not checked yet" survives (${mw0.trim()})`);
  // (b) The RESUME probe checks immediately when stale: nudges the reply-poll,
  // re-reads the cheap count, and repaints the surfaces in place.
  const mw2 = await page.evaluate(async () => {
    const realPost = window.apiPost;
    const hits = [];
    window.apiPost = async (url, body) => {
      hits.push({ url: String(url), action: (body || {}).action || '' });
      if (String(url).includes('mailbox.php') && body && body.action === 'new')
        return { ok: true, new: { count: 2, items: [{ name: 'Richard Berry', from: 'rb@x.com', subject: 'Arrival time' }] } };
      if (String(url).includes('mailbox-read.php')) return { ok: true };
      return realPost(url, body);
    };
    chbMailWatch(); // idempotent — already armed by initBackOffice
    const armedOnce = (() => { const t = __mailWatchT; chbMailWatch(); return __mailWatchT === t; })();
    __mailWatchAt = 0; // stale, so the resume probe fires NOW
    document.dispatchEvent(new Event('visibilitychange'));
    // Poll rather than a fixed beat — under the battery's contention a 250ms
    // wait raced the two awaited stub calls (measured: passed solo, failed in
    // the concurrent run).
    for (let i = 0; i < 40 && !(window['__newMailPre'] && window['__newMailPre'].count === 2); i++)
        await new Promise((r) => setTimeout(r, 100));
    window.apiPost = realPost;
    return {
      armedOnce,
      polled: hits.some((h) => h.url.includes('mailbox-read.php')),
      counted: hits.some((h) => h.url.includes('mailbox.php') && h.action === 'new'),
      pre: window.__newMailPre,
      fig: (document.getElementById('iv-sum-email') || {}).textContent || '',
    };
  });
  ok(mw2.polled && mw2.counted, 'resume nudges the reply-poll AND re-reads the cheap count');
  ok(mw2.pre && mw2.pre.count === 2, 'the fresh count lands in __newMailPre');
  ok(/2 new/.test(mw2.fig), `…and the landing verdict repaints in place (${mw2.fig.trim()})`);
  ok(mw2.armedOnce, 'the watch arms once per page — a re-init cannot double the timer');
  await page.evaluate(() => { __mbxOpenedOnce = window.__mbxOpenedOnceSave; window.__newMailPre = null; window.loadData = window.__ldSave; });

  // ── THE READING PANE BELONGS TO THE ACTIVE FOLDER ─────────────────────────
  // renderInbox's wide-split auto-select checked the active VIEW but not the
  // active FOLDER, while markInboxSelection right below it carries exactly that
  // guard. So any re-render while the owner was reading Email or Messages —
  // a dock tap, a reconnect, an approval nulling __enqHubId — docked an enquiry
  // hub over what they were reading AND stamped that enquiry seen, dropping it
  // from an unread count they had never looked at.
  await page.setViewportSize({ width: 1280, height: 900 });
  const hijack = await page.evaluate(async (dd) => {
    nav('view-inbox');
    await new Promise((r) => setTimeout(r, 300));
    inboxFolder('email');
    await new Promise((r) => setTimeout(r, 300));
    // The suite's own routes answer with no enquiries, so seed one AFTER the
    // folder switch has finished loading (its fetch replaces the array) —
    // without one there is nothing to dock and both checks prove nothing.
    window.__seedEnq = () => {
      __inboxTab = 'waiting'; // an earlier section leaves the declined drawer open
      if (!enquiries.some((x) => x.id === 'e77'))
        enquiries.push({ id: 'e77', dbId: 77, propKey: '21a', name: 'Nadia Ferrer', email: 'n@x.com', checkIn: dd.ci, checkOut: dd.co, adults: 2, children: 0, guests: '2 adults', message: 'Any parking?', received: dd.made });
      return enquiries.length;
    };
    const seeded = window.__seedEnq();
    __enqHubId = null; // the state an approval/decline leaves behind
    let opened = 0;
    const real = window.openEnquiryHub;
    window.openEnquiryHub = async (...a) => { opened++; return real.apply(null, a); };
    renderInbox();
    await new Promise((r) => setTimeout(r, 400));
    const folderAfter = __inboxFolder;
    window.openEnquiryHub = real;
    return { opened, folderAfter, seeded };
  }, { ci: d(30), co: d(33), made: d(-1) });
  ok(hijack.seeded > 0, `the fixture really carries an enquiry to dock (${hijack.seeded})`);
  ok(hijack.opened === 0, `a re-render on the Email folder does not dock an enquiry over it (opened ${hijack.opened})`);
  ok(hijack.folderAfter === 'email', 'and the owner is left on the folder they were reading');
  // …while the Enquiries folder still auto-selects, which is the feature.
  const autoSel = await page.evaluate(async () => {
    inboxFolder('enquiries');
    await new Promise((r) => setTimeout(r, 300));
    window.__seedEnq();
    __enqHubId = null;
    let opened = 0;
    const real = window.openEnquiryHub;
    window.openEnquiryHub = async (...a) => { opened++; return real.apply(null, a); };
    renderInbox();
    await new Promise((r) => setTimeout(r, 400));
    window.openEnquiryHub = real;
    return { opened, n: (typeof enquiries !== 'undefined' ? enquiries.length : -1), wide: inboxSplitWide() };
  });
  ok(autoSel.opened > 0, `the Enquiries folder still fills its empty pane (opened ${autoSel.opened}, list ${autoSel.n}, wide ${autoSel.wide})`);

  // EITHER ID FORM opens an enquiry. Client enquiries carry id 'e<n>'; the
  // new-enquiry push and every federated search row hand over the NUMERIC db id,
  // and a strict === reported "no longer here" about one sitting in the inbox.
  const idForms = await page.evaluate(async () => {
    window.__seedEnq();
    const e = enquiries.find((x) => x.id === 'e77') || null;
    if (!e) return { byClient: false, byNumeric: false, id: 'none', dbId: 'none' };
    // Drive the REAL opener both ways rather than re-stating its lookup here.
    const seen = [];
    __enqHubId = null;
    await openEnquiryHub(e.id);
    seen.push(__enqHubId);
    __enqHubId = null;
    await openEnquiryHub(e.dbId);
    seen.push(__enqHubId);
    return { byClient: seen[0] === e.id, byNumeric: seen[1] === e.id, id: e.id, dbId: e.dbId };
  });
  ok(idForms.byClient && idForms.byNumeric,
    `openEnquiryHub opens the same enquiry from either id form (${idForms.id} / ${idForms.dbId})`);
  const hubSrcIds = require('fs').readFileSync(__dirname + '/admin.js', 'utf8').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  ok(/String\(x\.id\) === String\(want\) \|\| String\(x\.dbId\) === String\(want\)/.test(hubSrcIds),
    'openEnquiryHub normalises the id rather than matching one form');

  // ── THE MESSAGES SEARCH BOX IS A SEARCH BOX ────────────────────────────────
  // .msg-inbox-controls is a flex row with no wrap whose two siblings are both
  // `flex: 0 0 auto` + nowrap, so on a phone the input absorbed the entire
  // shortfall: measured 64px — about two characters of "Search name, email or
  // text…" — and ONLY when there is unanswered work, i.e. exactly when the folder
  // is worth searching. Driven through the real renderer with a thread that needs
  // a reply, since with none the two siblings do not render and the row is fine.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(250);
  const msgRow = await page.evaluate(async () => {
    // Back to the Inbox first: the id-form checks above open an enquiry hub, and at
    // phone width that is a standalone VIEW, so the folder row is in the document
    // and painting nothing. Seed AFTER it — openInbox refetches and the suite's
    // route answers with no threads.
    await window.openInbox();
    await new Promise((r) => setTimeout(r, 300));
    __msgThreads = [{ id: 1, booking_id: 9, name: 'A Guest', email: 'guest@example.com', prop_key: '21a',
      last_body: 'Is there parking?', last_at: new Date().toISOString().slice(0, 19).replace('T', ' '),
      last_from: 'guest', unread: 1, archived: 0 }];
    __msgShowArchived = false;
    // Stacked, each folder lives inside a CLOSED fold — measuring there reports 0
    // for everything and the check passes proving nothing (it did, first run).
    inboxFolder('messages');
    const opener = document.querySelector('#inbox-landing .bhub-fold-row[data-arg="messages"]');
    if (opener && (document.getElementById('iv-fold-messages') || {}).hidden) opener.click();
    renderMessagesList();
    await new Promise((r) => setTimeout(r, 300));
    const row = document.querySelector('.msg-inbox-controls');
    const inp = document.getElementById('msg-search');
    if (!row || !inp) return { why: 'row ' + !!row + ' inp ' + !!inp + ' folds ' + document.querySelectorAll('#inbox-landing .bhub-fold-row').length };
    if (!row.getClientRects().length) return { why: 'the controls row never painted' };
    const chip = document.getElementById('msg-unanswered');
    return {
      w: Math.round(inp.getBoundingClientRect().width),
      rowW: Math.round(row.getBoundingClientRect().width),
      chip: !!chip,
      // How wide is its own placeholder? A field narrower than a few characters of
      // it reads as broken rather than as a search.
      ph: (inp.placeholder || '').length,
    };
  });
  ok(msgRow && msgRow.chip, `(fixture) an unanswered thread renders the chip that squeezes the row (${msgRow && (msgRow.why || msgRow.rowW + 'px')})`);
  ok(msgRow && msgRow.w >= msgRow.rowW * 0.6,
    `the conversation search keeps a usable width beside them (${msgRow && msgRow.w}px of ${msgRow && msgRow.rowW}px)`);
  await page.setViewportSize({ width: 1000, height: 900 });
  await page.waitForTimeout(200);

  console.log(fails ? `MAILBOX TEST FAILED ❌ (${fails})` : 'MAILBOX TEST PASSED ✅');
  await done(fails);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
