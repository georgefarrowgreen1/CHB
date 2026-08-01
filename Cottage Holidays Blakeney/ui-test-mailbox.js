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
  const ctx = await page.evaluate(() => ({
    match: /Known guest/.test((document.querySelector('.mbx-ctx') || {}).textContent || ''),
    chip: !!document.querySelector('.mbx-ctx .bhub-stay-row'),
    att: ((document.querySelector('.mbx-att') || {}).textContent || '').trim(),
    attHref: (document.querySelector('.mbx-att') || {}).getAttribute?.('href') || '',
  }));
  ok(ctx.match && ctx.chip, 'sender recognised — guest match card with a hub chip');
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
  await page.evaluate(() => mailboxSearch(''));
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
      const ctx = document.querySelector('.mbx-ctx');
      const row = ctx && ctx.querySelector('.bhub-stay-row');
      const cap = ctx && ctx.querySelector('.mbx-cap');
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
    ok(!!m && m.capAbove, `${tag}: "Known guest" stays above the box`);
  }

  console.log(fails ? `MAILBOX TEST FAILED ❌ (${fails})` : 'MAILBOX TEST PASSED ✅');
  await done(fails);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
