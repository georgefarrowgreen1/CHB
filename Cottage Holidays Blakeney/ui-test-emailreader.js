// READING AN EMAIL: THEIR NEW WORDS FIRST — driven in a real browser against a mocked mailbox.php.
// The Inbox is ONE LIST OF PEOPLE now: an email is read inside its sender's conversation
// (ibOpen reads each email and splits it with the same mbxSplit the old reader used), so
// that is where every property below is measured. The old reader (mailboxOpen, its fold
// chips, "Replying to", the sorted Earlier section and its three action tiles) sits in
// the hidden #inbox-legacy and no owner can reach it, so it is not what is tested.
//   §1 the conversation shows only what they wrote; the quote and footer are one tap away,
//      and nothing of the email is lost
//   §2 what they are answering: our own email sits above their reply, in time order
//   §3 every earlier email is in the one conversation, in time order, in its own words;
//      the reader's actions live in the conversation's ⋯ menu
//   §4 an all-new email is shown whole, with nothing folded
//   §5 a reply carries only what you typed — never our old email quoted under it — and
//      goes back on the thread's own subject
const { boot } = require('./ui-test-lib');
let fails = 0;
const ok = (b, m) => { console.log(`  ${b ? '✓' : '✗'} ${m}`); if (!b) fails++; };

const OUTLOOK = "Hi George,\n\nThat sounds perfect — could we arrive a bit earlier on the Friday, around 1pm? We're driving up with the campervan.\n\nMarcus\n\nFrom: Cottage Holidays <info@chb.co.uk>\nSent: 17 August 2026 15:20\nTo: Marcus Hale\nSubject: Re: Your enquiry\n\nHello Marcus, check-in is from 3pm.\n\nGet Outlook for iOS";
const BODIES = {
  u3: OUTLOOK,
  u2: 'Lovely, thanks George.',
  u1: 'Hi, is Jollyboat free 4–8 Sep? 2 adults and a spaniel. Thanks, Marcus',
  u4: 'Hello,\n\nAre dogs welcome at Pimpernel? We have a small spaniel.\n\nThanks, Priya',
};

(async () => {
  // 1280: the Inbox is the computer's split view here (list | conversation), which is
  // also where the keyboard's R reaches the reply box.
  const { page, base, done } = await boot({ viewport: { width: 1280, height: 900 } });
  const messages = [
    { uid: 'u3', from: 'marcus@example.com', fromRaw: 'Marcus Hale <marcus@example.com>', subject: 'Re: Your enquiry — Jollyboat', date: '2026-08-17 16:02:00', seen: false },
    { uid: 'u2', from: 'marcus@example.com', fromRaw: 'Marcus Hale <marcus@example.com>', subject: 'Re: Your enquiry — Jollyboat', date: '2026-08-13 10:00:00', seen: true },
    { uid: 'u1', from: 'marcus@example.com', fromRaw: 'Marcus Hale <marcus@example.com>', subject: 'Your enquiry — Jollyboat', date: '2026-08-12 09:00:00', seen: true },
    { uid: 'u4', from: 'priya@example.com', fromRaw: 'Priya Shah <priya@example.com>', subject: 'Dog-friendly?', date: '2026-08-16 09:14:00', seen: false },
  ];
  const sentRows = [{ id: 7, to_email: 'marcus@example.com', cc_email: null, subject: 'Re: Your enquiry', body: 'Hello Marcus, Jollyboat is free 4–8 Sep, £440 all in. Check-in is from 3pm — is that all right for you?', sent_at: '2026-08-12 12:00:00' }];
  const reads = [];
  const posts = [];
  await page.route(/\.php/, (route) => {
    const url = route.request().url();
    const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (route.request().method() === 'POST') {
      const b = JSON.parse(route.request().postData() || '{}');
      b.__url = url.split('/').pop().split('?')[0];
      posts.push(b);
      if (url.includes('mailbox.php')) {
        if (b.action === 'list') return json({ ok: true, messages, total: messages.length, hasMore: false });
        if (b.action === 'sent') return json({ ok: true, messages: sentRows });
        if (b.action === 'read') {
          reads.push(b.uid);
          const m = messages.find((x) => x.uid === b.uid);
          return json({ ok: true, uid: b.uid, from: m.from, fromRaw: m.fromRaw, to: 'stay@chb.co.uk', date: m.date, subject: m.subject, body: BODIES[b.uid], attachments: [] });
        }
        return json({ ok: true });
      }
      if (url.includes('enquiries.php') && b.action === 'declined') return json({ ok: true, enquiries: [] });
      if (url.includes('messages.php') && b.action === 'threads') return json({ ok: true, threads: [] });
      return json({ ok: true, events: [], logs: {}, reviews: [], photos: [] });
    }
    if (url.includes('bookings.php')) return json({ bookings: [] });
    return json({ ok: true, bookings: [], enquiries: [], properties: [], seasons: {}, occupancy: {}, content: {}, blocks: [], ranges: [], payments: [], years: [] });
  });
  await page.goto(`${base}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  await page.evaluate(() => { isAuthenticated = true; document.body.classList.add('owner-mode'); });
  await page.evaluate(() => window.loadAdminBundle());
  await page.waitForTimeout(600);
  await page.evaluate(async () => { await window.openInbox(); });
  // Every store the one list reads has landed and no rebuild is queued — a rebuild
  // re-renders the conversation, which would shut a fold the checks just opened.
  const settled = () => page.waitForFunction(() => typeof __ibPeople !== 'undefined' && __mbxOpenedOnce && Array.isArray(__mbxSent)
    && Array.isArray(__declinedEnq) && Array.isArray(__ibArchived) && !__ibRenderQ, null, { timeout: 10000 }).catch(() => {});
  await settled();
  const rowSel = (k) => `#ib-rows .ib-rowwrap[data-key="${k}"] .ib-row`;
  await page.waitForSelector(rowSel('e:marcus@example.com'), { timeout: 10000 }).catch(() => {});
  await page.click(rowSel('e:marcus@example.com'));
  // ibOpen reads each of their emails (mailbox.php read) and re-renders ONCE all have
  // landed; wait on that state, not a clock.
  await page.waitForFunction(() => [...document.querySelectorAll('#ib-thread .ib-msg.is-them .ib-text')].some((t) => /around 1pm/.test(t.textContent)), null, { timeout: 10000 }).catch(() => {});
  await settled();
  ok(['u1', 'u2', 'u3'].every((u) => reads.includes(u)), `opening Marcus reads every email of his (${reads.join(', ')})`);

  console.log('§1 their new words, and the rest one tap away');
  const lastThem = () => page.evaluate(() => {
    const them = [...document.querySelectorAll('#ib-thread .ib-msg.is-them')];
    const m = them[them.length - 1];
    if (!m) return null;
    const btn = m.querySelector('.ib-quotebtn');
    const q = btn && document.getElementById(btn.getAttribute('aria-controls'));
    return {
      body: (m.querySelector('.ib-text') || {}).textContent || '',
      btn: btn ? btn.textContent.trim() : '',
      exp: btn ? btn.getAttribute('aria-expanded') : null,
      shown: !!q && !q.hidden && q.getClientRects().length > 0,
      h: q ? Math.round(q.getBoundingClientRect().height) : 0,
      quoted: q ? q.textContent : '',
    };
  });
  const r1 = await lastThem();
  ok(!!r1 && /around 1pm/.test(r1.body) && !/From: Cottage Holidays/.test(r1.body) && !/check-in is from 3pm/.test(r1.body) && !/Get Outlook/.test(r1.body),
    'the conversation shows only what they wrote');
  ok(!!r1 && r1.btn === 'Show the rest of the email', `the rest is one plainly named tap away (“${r1 && r1.btn}”)`);
  ok(!!r1 && r1.exp === 'false' && !r1.shown, 'and it starts shut');
  await page.evaluate(() => { const ms = [...document.querySelectorAll('#ib-thread .ib-msg.is-them')]; ms[ms.length - 1].querySelector('.ib-quotebtn').click(); });
  await page.waitForFunction(() => { const ms = [...document.querySelectorAll('#ib-thread .ib-msg.is-them')]; const b = ms[ms.length - 1].querySelector('.ib-quotebtn'); const q = b && document.getElementById(b.getAttribute('aria-controls')); return !!q && !q.hidden && q.getBoundingClientRect().height > 20; }, null, { timeout: 8000 }).catch(() => {});
  const r1o = await lastThem();
  ok(!!r1o && r1o.shown && r1o.exp === 'true' && r1o.h > 20 && /check-in is from 3pm/.test(r1o.quoted),
    `the quoted message opens (height ${r1o && r1o.h}px) and says what was quoted`);
  // NOTHING IS LOST: what they wrote plus what is folded is the whole email as it
  // arrived — our quoted email with its header, and the client's footer.
  const whole = r1o ? r1o.body + '\n' + r1o.quoted : '';
  ok(/From: Cottage Holidays/.test(whole) && /Get Outlook for iOS/.test(whole) && /campervan/.test(whole),
    'the whole email is there exactly as it arrived — nothing is lost');
  await page.evaluate(() => { const ms = [...document.querySelectorAll('#ib-thread .ib-msg.is-them')]; ms[ms.length - 1].querySelector('.ib-quotebtn').click(); });
  await page.waitForTimeout(200);
  const r1c = await lastThem();
  ok(!!r1c && !r1c.shown && r1c.exp === 'false', 'a second tap shuts it again');

  console.log('§2 what they are answering');
  // The old reader printed "Replying to: <our last question>". The one conversation
  // shows our email itself, in time order, above the reply it is answered by.
  const r2 = await page.evaluate(() => {
    const msgs = [...document.querySelectorAll('#ib-thread .ib-msg')];
    const them = msgs.filter((m) => m.classList.contains('is-them'));
    const reply = them[them.length - 1];
    const ours = msgs.find((m) => m.classList.contains('is-me') && /is that all right for you\?/.test(m.textContent));
    return { ours: !!ours, above: !!(ours && reply) && msgs.indexOf(ours) < msgs.indexOf(reply), painted: !!(ours && ours.getClientRects().length) };
  });
  ok(r2.ours && r2.painted, 'our own email — the question they are answering — is in the conversation');
  ok(r2.above, '…above their reply, in time order');

  console.log('§3 every earlier email, in order, in its own words');
  // The old reader SORTED earlier emails by whether they mattered and folded them
  // behind "Earlier in this conversation"; the one conversation shows every email in
  // time order, each in its own words, so nothing needs surfacing.
  const r3 = await page.evaluate(() => {
    const t = [...document.querySelectorAll('#ib-thread .ib-msg.is-them .ib-text')].map((x) => x.textContent);
    return { t, earlier: document.querySelectorAll('#ib-conv .mbx-earlier, #ib-conv .mbx-worth').length };
  });
  ok(r3.t.length === 3 && /is Jollyboat free/.test(r3.t[0]) && /Lovely, thanks George/.test(r3.t[1]) && /around 1pm/.test(r3.t[2]),
    `all three of his emails, oldest first (${r3.t.map((x) => x.slice(0, 18)).join(' | ')})`);
  ok(r3.earlier === 0, 'no separate “earlier” section to open');
  // The reader's own actions (Mark unread / Delete) are the conversation's ⋯ menu now.
  await page.click('#ib-conv [data-ib="menu"]');
  await page.waitForTimeout(200);
  const menu = await page.$$eval('#ib-conv .ib-menu button', (b) => b.map((x) => x.textContent.trim())).catch(() => []);
  ok(menu.includes('Mark as unread') && menu[menu.length - 1] === 'Delete conversation', `the ⋯ menu offers Mark as unread and, last, Delete (${menu.join(' / ')})`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);

  console.log('§5 a reply carries only what you typed');
  const r5a = await page.evaluate(() => ({
    v: (document.getElementById('ib-reply') || {}).value,
    chan: ((document.querySelector('#ib-conv .ib-chan [aria-pressed="true"]') || {}).textContent || '').trim(),
    note: ((document.querySelector('#ib-conv .ib-compnote') || {}).textContent || '').trim(),
  }));
  ok(r5a.v === '', 'the reply box starts empty — no quote of our old email under the cursor');
  ok(/Email/.test(r5a.chan) && r5a.note === 'Re: Your enquiry — Jollyboat', `it replies by email, on the thread's own subject (${r5a.chan} · “${r5a.note}”)`);
  // R puts the cursor in the reply box, where the answer belongs.
  await page.focus(rowSel('e:marcus@example.com'));
  await page.keyboard.press('r');
  ok(await page.evaluate(() => document.activeElement && document.activeElement.id === 'ib-reply'), 'R puts the cursor in the reply box');
  await page.keyboard.type('Yes, 1pm is fine.');
  await page.click('#ib-send');
  let sent = null;
  for (let i = 0; i < 90 && !sent; i++) { await page.waitForTimeout(100); sent = posts.find((p) => p.__url === 'mailbox.php' && p.action === 'send'); }
  ok(!!sent && sent.to === 'marcus@example.com' && sent.subject === 'Re: Your enquiry — Jollyboat',
    `after its five seconds it goes to Marcus, on the same subject (${sent && sent.to} · “${sent && sent.subject}”)`);
  ok(!!sent && sent.body === 'Yes, 1pm is fine.', `…carrying only what was typed — not our old email quoted under it (“${sent && sent.body}”)`);

  console.log('§4 an all-new email is shown whole');
  await page.click(rowSel('e:priya@example.com'));
  await page.waitForFunction(() => /Are dogs welcome/.test((document.querySelector('#ib-thread .ib-msg.is-them .ib-text') || {}).textContent || ''), null, { timeout: 10000 }).catch(() => {});
  const r4 = await page.evaluate(() => {
    const them = [...document.querySelectorAll('#ib-thread .ib-msg.is-them')];
    return {
      body: them.map((m) => (m.querySelector('.ib-text') || {}).textContent || '').join(' | '),
      n: them.length,
      ours: document.querySelectorAll('#ib-thread .ib-msg.is-me').length,
      folds: document.querySelectorAll('#ib-thread .ib-quotebtn').length,
    };
  });
  ok(/Are dogs welcome/.test(r4.body) && /Thanks, Priya/.test(r4.body) && r4.folds === 0, 'nothing is folded when there is nothing to fold');
  ok(r4.n === 1 && r4.ours === 0, 'and a message with no earlier history is the only thing in its conversation');

  console.log(fails ? `EMAIL READER TEST FAILED ❌ (${fails})` : 'EMAIL READER TEST PASSED ✅');
  await done(fails);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
