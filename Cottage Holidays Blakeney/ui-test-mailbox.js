// Inbox → Email folder (comms dashboard), end to end against a mocked mailbox.php:
//  1. list renders rows (unread chip on unseen)
//  2. open → text-only reader; a hostile HTML body renders inert (escaped)
//  3. reply prefills to/subject + quoted body; send posts the right payload
//  4. compose fresh; validation (bad address, empty fields)
//  5. delete confirms then posts + removes the row
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const PORT = 8181;
let fails = 0;
const ok = (b, m) => { console.log(`  ${b ? '✓' : '✗'} ${m}`); if (!b) fails++; };

(async () => {
  const server = spawn('php', ['-S', `127.0.0.1:${PORT}`, '-t', process.cwd()], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 800));
  const browser = await chromium.launch(process.env.CHB_CHROMIUM ? { executablePath: process.env.CHB_CHROMIUM } : {});
  const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
  page.on('pageerror', (e) => { console.log('  PAGEERR:', e.message); fails++; });
  await page.addInitScript(() => { if (navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(() => {}); });

  const d = (n) => { const t = new Date(); t.setDate(t.getDate() + n); return t.toISOString().slice(0, 10); };
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

  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
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
  ok(l.activeView === 'view-inbox' && l.emailShown && l.enqHidden && l.noPane, `email folder active in the Inbox, pane released (${l.activeView})`);
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

  console.log('2b. guest context + attachments');
  const ctx = await page.evaluate(() => ({
    match: /Guest match/.test((document.querySelector('.mbx-ctx') || {}).textContent || ''),
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
  await page.evaluate(() => mailboxTab('sent'));
  await page.waitForTimeout(200);
  const st = await page.evaluate(() => ({
    rows: document.querySelectorAll('#mailbox-body .bk-row').length,
    text: (document.getElementById('mailbox-body') || {}).textContent || '',
  }));
  // the reply sent in step 3 tops the list; the ledger row sits beneath
  ok(st.rows === 2 && /old@example\.com/.test(st.text) && /guest@example\.com/.test(st.text), `Sent tab lists the just-sent reply + the ledger (${st.rows} rows)`);
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

  await browser.close(); server.kill();
  console.log(fails ? `MAILBOX TEST FAILED ❌ (${fails})` : 'MAILBOX TEST PASSED ✅');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
