// The Inbox's EMAIL, end to end against a mocked mailbox.php. The Inbox is ONE LIST OF
// PEOPLE now: the Email folder, its Inbox|Sent tab, the accordion reader, the free
// compose form and the three-answers landing are gone (their old markup sits hidden in
// #inbox-legacy so the loaders still fill the stores), and each sender is one row whose
// conversation carries every channel in time order. Every property below is measured
// on that list and that conversation:
//  1. the emails are rows (unread on the unseen sender), on the one list material
//  2. opening one: a hostile HTML body renders inert (escaped); the guest's booking
//     and the email's attachment are there with it
//  3. a reply goes back on the thread's subject, through the booking's own email route
//  4. refresh keeps your search; a search says what it covered; mark unread
//  5. delete
//  6. the stay's facts hold at 390 with a hostile cottage name
//  7. one row per PERSON, and a chain of replies as one conversation
//  8–9. a decline says what it is; a stale enquiry and the pill say what waits
//  §11 the mail watch, re-renders that must not move the owner, the search box, and
//     the ask after a decline (and a decline answered later)
// The site reckons "today" in UK time (todayDashed / ukNowParts), so the
// tests must too — pin the whole process (and the browser it launches) to
// Europe/London so fixtures built from new Date() agree with the app on
// any runner, in any timezone. Must run before the first Date call.
const { boot } = require('./ui-test-lib'); // pins TZ=Europe/London at require time
let fails = 0;
const ok = (b, m) => { console.log(`  ${b ? '✓' : '✗'} ${m}`); if (!b) fails++; };

(async () => {
  const { page, base, done } = await boot({ viewport: { width: 1000, height: 900 } });

  // Local-formatted, never toISOString() — that's UTC and slips a day near midnight.
  const d = require('./ui-test-lib').d; // the harness's day (keeps the page's clock near midnight)
  // An AGE is seeded by hours-ago: the app floors elapsed hours into days, so a date
  // plus a fixed clock time reads a day short for part of every night.
  const hrsAgo = (h) => { const t = new Date(Date.now() - h * 3600e3); const p = (n) => String(n).padStart(2, '0'); return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())} ${p(t.getHours())}:${p(t.getMinutes())}:00`; };
  const bookingRows = [{
    id: 9, prop_key: '21a', name: 'A Guest', email: 'guest@example.com', phone: '', address: '1 Lane',
    postcode: 'NR25 7AB', check_in: d(12), check_out: d(15), check_in_time: '15:00', check_out_time: '10:00',
    adults: 2, children: 0, payment: 'unpaid', deposit_paid: 0, payment_method: '', payment_date: '',
    agreed_total: 440, agreed_per_night: 130, agreed_nights: 3, agreed_nightly: 390, agreed_booking_fee: 50,
    agreed_txn_pct: 0, agreed_txn_fee: 0, agreed_on: d(0), hold_status: 'none', notes: '',
  }];
  const sentRows = [{ id: 5, to_email: 'old@example.com', cc_email: null, subject: 'Earlier note', body: 'Hello there', sent_at: d(-2) + ' 10:00:00' }];
  let messages = [
    { uid: 'u1', from: 'guest@example.com', fromRaw: 'A Guest <guest@example.com>', subject: 'Question about parking', date: '2026-07-10 09:15:00', seen: false },
    { uid: 'u2', from: 'other@example.com', fromRaw: 'Other Person', subject: 'Re: Your stay', date: '2026-07-08 14:00:00', seen: true },
  ];
  const HOSTILE = 'Hello,\nIs there parking?\n<script>window.__pwned=1</script><img src=x onerror="window.__pwned=2">';
  const posts = [];
  let state = null;
  await page.route(/\.php/, (route) => {
    const url = route.request().url();
    const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (route.request().method() === 'POST') {
      const b = JSON.parse(route.request().postData() || '{}');
      b.__url = url.split('/').pop().split('?')[0];
      posts.push(b);
      if (b.__url === 'mailbox.php') {
        if (b.action === 'list') return json({ ok: true, messages, total: messages.length, hasMore: !b.offset });
        if (b.action === 'sent') return json({ ok: true, messages: sentRows });
        if (b.action === 'read') {
          if (b.uid === 'u1') return json({ ok: true, uid: b.uid, from: 'guest@example.com', fromRaw: 'A Guest <guest@example.com>', to: 'stay@chb.co.uk', date: '2026-07-10 09:15:00', subject: 'Question about parking', body: HOSTILE, attachments: [{ i: 0, name: 'directions.pdf', mime: 'application/pdf', size: 34567 }] });
          return json({ ok: true, uid: b.uid, body: 'Body of ' + b.uid, attachments: [] });
        }
        if (b.action === 'delete') {
          const gone = Array.isArray(b.uids) ? b.uids : [b.uid];
          messages = messages.filter((m) => !gone.includes(m.uid));
          return json({ ok: true, deleted: gone.length });
        }
        return json({ ok: true });
      }
      if (b.__url === 'enquiries.php' && b.action === 'declined') {
        return json({ ok: true, enquiries: [{
          id: 91, prop_key: '21a', name: 'Jem Beighton', email: 'j@x.co',
          check_in: d(40), check_out: d(44), adults: 2, children: 1,
          message: 'Is there space to park a small van, and can we arrive late on the Saturday?',
          created_at: d(-20) + ' 09:00:00', declined_at: d(-3) + ' 11:20:00',
        }] });
      }
      if (b.__url === 'messages.php' && b.action === 'threads') return json({ ok: true, threads: [] });
      if (b.__url === 'content.php' && b.action === 'set' && b.key === 'inbox-state') { state = b.value; return json({ ok: true }); }
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
  // The boot's own landing can still be in flight on a loaded machine and put the
  // page back on the home view after the Inbox opened: open it until it stays open.
  for (let i = 0; i < 5; i++) {
    await page.evaluate(async () => { document.body.classList.add('owner-mode'); await window.openInbox(); });
    const on = await page.waitForFunction(() => (document.querySelector('.page-view.active') || {}).id === 'view-inbox' && !!document.querySelector('#ib-rows .ib-rowwrap'), null, { timeout: 4000 }).then(() => true).catch(() => false);
    await page.waitForTimeout(300);
    if (on && (await page.evaluate(() => (document.querySelector('.page-view.active') || {}).id === 'view-inbox'))) break;
  }

  const row = (k) => `#ib-rows .ib-rowwrap[data-key="${k}"] .ib-row`;
  // Every store the one list reads has landed and no rebuild is queued — a rebuild
  // re-renders the open conversation, which would shut what a check just opened.
  const settled = () => page.waitForFunction(() => typeof __ibPeople !== 'undefined' && __mbxOpenedOnce && Array.isArray(__mbxSent)
    && Array.isArray(__declinedEnq) && Array.isArray(__ibArchived) && !__ibRenderQ, null, { timeout: 10000 }).catch(() => {});
  const openPerson = async (k, test) => {
    await page.waitForSelector(row(k), { timeout: 10000 }).catch(() => {});
    await page.click(row(k));
    if (test) await page.waitForFunction(test, null, { timeout: 10000 }).catch(() => {});
    await settled();
  };
  const sentOf = async (pred, ms) => {
    for (let i = 0; i < (ms || 9000) / 100; i++) {
      const p = posts.find(pred);
      if (p) return p;
      await page.waitForTimeout(100);
    }
    return null;
  };
  await page.waitForFunction(() => !!document.querySelector('#ib-rows .ib-rowwrap[data-key="e:guest@example.com"]')
    && !!document.querySelector('#ib-rows .ib-rowwrap[data-key="e:other@example.com"]'), null, { timeout: 10000 }).catch(() => {});
  await settled();

  console.log('1. the emails are rows of the one list');
  const l = await page.evaluate(() => {
    const r = (k) => document.querySelector(`#ib-rows .ib-rowwrap[data-key="${k}"] .ib-row`);
    const g = r('e:guest@example.com'), o = r('e:other@example.com');
    const legacy = document.getElementById('inbox-legacy');
    return {
      view: (document.querySelector('.page-view.active') || {}).id,
      both: !!(g && o && g.getClientRects().length && o.getClientRects().length),
      gUnread: !!g && g.classList.contains('is-unread'),
      oUnread: !!o && o.classList.contains('is-unread'),
      gPrev: g ? ((g.querySelector('.ib-prev') || {}).textContent || '').trim() : '',
      oPrev: o ? ((o.querySelector('.ib-prev') || {}).textContent || '').trim() : '',
      legacyHidden: !!legacy && legacy.hidden && !legacy.getClientRects().length,
    };
  });
  ok(l.view === 'view-inbox' && l.both, `each sender is a row of the Inbox (${l.view})`);
  ok(l.gUnread && !l.oUnread, `the unseen email's sender reads unread, the seen one does not (${l.gUnread}/${l.oUnread})`);
  ok(l.gPrev === 'Question about parking' && l.oPrev === 'Re: Your stay', `with nothing else to show, the row shows the subject (“${l.gPrev}” · “${l.oPrev}”)`);
  ok(l.legacyHidden, 'no old Email folder list is on screen');
  // ONE LIST MATERIAL: a group of rows is ONE card — the card radius on the group,
  // square rows inside it, abutting on ONE hairline, and no row casting a shadow.
  // Measured on whichever group holds a run of two or more.
  const mat = await page.evaluate(() => {
    const grp = [...document.querySelectorAll('#ib-rows .ib-rows')].find((x) => x.querySelectorAll(':scope > .ib-rowwrap').length >= 2 && x.getClientRects().length);
    if (!grp) return null;
    const wraps = [...grp.querySelectorAll(':scope > .ib-rowwrap')];
    const rows = wraps.map((w) => w.querySelector('.ib-row'));
    const gs = getComputedStyle(grp);
    return {
      n: rows.length,
      shadows: rows.map((r) => getComputedStyle(r).boxShadow).filter((x) => x !== 'none' && !/inset/.test(x)),
      grpRadius: parseFloat(gs.borderTopLeftRadius), grpClips: gs.overflow === 'hidden' || gs.overflow === 'clip',
      rowRadius: Math.max(...rows.map((r) => parseFloat(getComputedStyle(r).borderTopLeftRadius) || 0)),
      gap: +(wraps[1].getBoundingClientRect().top - wraps[0].getBoundingClientRect().bottom).toFixed(1),
      seam: parseFloat(getComputedStyle(wraps[1]).borderTopWidth),
    };
  });
  ok(!!mat, `a group long enough to have a join (${mat && mat.n} rows)`);
  ok(!!mat && mat.shadows.length === 0, `no row casts a drop shadow (${(mat && mat.shadows[0]) || 'none'})`);
  ok(!!mat && mat.grpRadius === 20 && mat.grpClips && mat.rowRadius === 0,
    `the corners are the CARD radius on the group's ends only (group ${mat && mat.grpRadius}px, rows ${mat && mat.rowRadius}px)`);
  ok(!!mat && mat.gap === 0 && mat.seam === 1, `and the rows abut on ONE hairline (gap ${mat && mat.gap}, seam ${mat && mat.seam}px)`);

  console.log('1b. the folders are gone, and the old way in lands on the list');
  // The folder switch is gone: inboxFolder() is a shim every old caller (search, help,
  // notifications, a remembered place) still uses, and it must land on the one list.
  const f = await page.evaluate(() => {
    inboxFolder('email');
    return {
      list: !!document.getElementById('ib-list').getClientRects().length,
      folder: document.getElementById('ib-folders').getAttribute('data-on'),
      pill: ((document.querySelector('#ib-pill .head-pill') || {}).textContent || '').trim(),
      waiting: ibWaitingCount(),
    };
  });
  ok(f.list && f.folder === 'inbox', `inboxFolder('email') leaves the one list on screen (folder ${f.folder})`);
  // The unread chip on the Email folder is gone too; what the list owes is its pill.
  ok(f.waiting === 1 && f.pill === '1 waiting', `the pill says who is waiting — the unread sender (“${f.pill}”)`);

  console.log('2. opening one (hostile body inert)');
  await openPerson('e:guest@example.com', () => /Is there parking\?/.test((document.querySelector('#ib-thread .ib-msg.is-them .ib-text') || {}).textContent || ''));
  const r = await page.evaluate(() => {
    const t = [...document.querySelectorAll('#ib-thread .ib-msg.is-them .ib-text')].map((x) => x.textContent).join('\n');
    return {
      bodyShown: /Is there parking\?/.test(t),
      scriptVisible: /<script>/.test(t),
      pwned: window.__pwned || 0,
      imgs: document.querySelectorAll('#ib-thread img').length,
      current: (document.querySelector('#ib-rows .ib-rowwrap[data-key="e:guest@example.com"] .ib-row') || { getAttribute: () => '' }).getAttribute('aria-current'),
      name: ((document.querySelector('#ib-conv .ib-hname') || {}).textContent || '').trim(),
    };
  });
  ok(r.bodyShown, 'the email\u2019s words render in their conversation');
  ok(r.scriptVisible && r.pwned === 0 && r.imgs === 0, `hostile HTML shown as text, never executed (pwned=${r.pwned})`);
  // 2a. The accordion is gone: the email opens in the conversation beside the list,
  // and the row says it is the one on screen.
  ok(r.name === 'A Guest' && r.current === 'true', `the conversation opens beside the list, its row marked current (${r.name}, aria-current ${r.current})`);

  console.log('2b. the guest\u2019s booking + the attachment');
  const ctx = await page.evaluate(() => ({
    stay: ((document.querySelector('#ib-conv .ib-stayline') || {}).textContent || '').trim(),
    file: [...document.querySelectorAll('#ib-thread .ib-file')].map((x) => x.textContent.trim()).join(' | '),
    link: [...document.querySelectorAll('#ib-thread a[href]')].map((a) => a.getAttribute('href')).find((h) => /action=attachment/.test(h)) || '',
  }));
  ok(/21A Westgate/.test(ctx.stay), `the sender is recognised: their booking names the head of the conversation (“${ctx.stay}”)`);
  ok(/directions\.pdf/.test(ctx.file), `the attachment is listed with the email (“${ctx.file}”)`);
  // …AND IT CAN BE OPENED. The old reader linked every attachment to mailbox.php's
  // attachment action; a name with no way to open it is a file the owner cannot read.
  ok(/action=attachment&uid=u1&i=0/.test(ctx.link), `the attachment opens — a download link to it (${ctx.link || 'none: the name is plain text'})`);
  // The booking is one tap away from the conversation (the ctx drop's Booking).
  await page.evaluate(() => { const s = document.querySelector('#ib-conv .ib-stayline'); if (s && s.getAttribute('aria-expanded') !== 'true') s.click(); });
  await page.waitForTimeout(300);
  await page.evaluate(() => { const b = document.querySelector('#ib-conv [data-ib="record"]:not([disabled])'); if (b) b.click(); });
  await page.waitForFunction(() => ((document.querySelector('.bhub-name') || {}).textContent || '') === 'A Guest', null, { timeout: 8000 }).catch(() => {});
  const hubbed = await page.evaluate(() => ({
    active: (document.querySelector('.page-view.active') || {}).id,
    name: (document.querySelector('.bhub-name') || {}).textContent || '',
  }));
  ok(/view-(booking-hub|backoffice)/.test(hubbed.active) && hubbed.name === 'A Guest', `its Booking opens the booking hub (${hubbed.name})`);
  // The old Manage home must still work: settingsOpen('mailbox') redirects here.
  await page.evaluate(async () => { await window.openArea('manage'); window.settingsOpen('mailbox'); });
  await page.waitForFunction(() => (document.querySelector('.page-view.active') || {}).id === 'view-inbox', null, { timeout: 8000 }).catch(() => {});
  const redir = await page.evaluate(() => ({
    view: (document.querySelector('.page-view.active') || {}).id,
    list: !!document.getElementById('ib-list').getClientRects().length,
  }));
  ok(redir.view === 'view-inbox' && redir.list, `settingsOpen('mailbox') lands on the Inbox's one list (${redir.view})`);
  await settled();

  console.log('3. reply');
  await openPerson('e:guest@example.com', () => !!document.getElementById('ib-reply'));
  // §2b left the stay's facts unfolded (the drop is remembered per person); it hangs
  // over the conversation, so fold it back the way an owner does.
  await page.evaluate(() => { const s = document.querySelector('#ib-conv .ib-stayline'); if (s && s.getAttribute('aria-expanded') === 'true') s.click(); });
  await page.waitForTimeout(300);
  const rep = await page.evaluate(() => ({
    chan: ((document.querySelector('#ib-conv .ib-chan [aria-pressed="true"]') || {}).textContent || '').trim(),
    note: ((document.querySelector('#ib-conv .ib-compnote') || {}).textContent || '').trim(),
    v: (document.getElementById('ib-reply') || {}).value,
  }));
  ok(/Email/.test(rep.chan) && rep.note === 'Re: Question about parking' && rep.v === '', `the reply is an email on the thread's subject, starting empty (${rep.chan} · “${rep.note}”)`);
  await page.fill('#ib-reply', 'Yes — free parking on the drive.');
  await page.click('#ib-send');
  // A booked guest is written to through the BOOKING's own email route, so the
  // email is logged on their booking; the reply waits five seconds with Undo first.
  const sent = await sentOf((p) => p.__url === 'bookings.php' && p.action === 'email_guest');
  ok(!!sent && sent.id === 9 && sent.subject === 'Re: Question about parking' && /free parking/.test(sent.message),
    `the reply went to their booking's email route (${sent && sent.__url} id ${sent && sent.id} · “${sent && sent.subject}”)`);
  // 4. The free compose form ("New email" to any address) went with the Email folder:
  // every reply is to a person in the list. Its address validation went with it.

  console.log('4. refresh, search, mark unread');
  // The Inbox|Sent tab is gone — what you sent is in each person's conversation, and a
  // person you only wrote to is a row of their own.
  const oldRow = await page.evaluate(() => ((document.querySelector('#ib-rows .ib-rowwrap[data-key="e:old@example.com"] .ib-prev') || {}).textContent || '').trim());
  ok(/^You: Hello there$/.test(oldRow), `a person you only emailed is a row, your words on it (“${oldRow}”)`);
  // REFRESH IS A DATA REFRESH, NOT A RESET. Checking for new mail while searching used
  // to throw the owner back and wipe the search (measured on the old mailbox: "old" →
  // ""). Driven by CLICKING the Inbox's own refresh button.
  await page.fill('#ib-q', 'old');
  await page.waitForTimeout(250);
  const before = await page.$$eval('#ib-rows .ib-rowwrap', (w) => w.map((x) => x.getAttribute('data-key')));
  await page.click('#ib-refresh');
  await page.waitForFunction(() => !document.getElementById('ib-refresh').classList.contains('is-busy'), null, { timeout: 10000 }).catch(() => {});
  await settled();
  const refreshed = await page.evaluate(() => ({
    q: __ibQ, box: document.getElementById('ib-q').value,
    keys: [...document.querySelectorAll('#ib-rows .ib-rowwrap')].map((x) => x.getAttribute('data-key')),
  }));
  ok(refreshed.q === 'old' && refreshed.box === 'old', `Refresh keeps your search rather than wiping it ("${refreshed.q}")`);
  ok(before.length >= 1 && refreshed.keys.join(',') === before.join(','), `…and the list it filtered (${refreshed.keys.join(', ')})`);
  await page.fill('#ib-q', 'parking');
  await page.waitForTimeout(250);
  const sr = await page.$$eval('#ib-rows .ib-rowwrap', (w) => w.map((x) => x.getAttribute('data-key')));
  ok(sr.length === 1 && sr[0] === 'e:guest@example.com', `search finds the email (${sr.join(', ')})`);
  // A SEARCH THAT ONLY SEARCHED WHAT WAS LOADED. The mailbox page the list holds is one
  // fetched page, so "nothing matched" is a confident negative about mail still on the
  // server — worse than a short list. The fixture reports older mail on the server, so
  // a search that finds nothing must not claim to have covered every message.
  await page.fill('#ib-q', 'zzqx');
  await page.waitForTimeout(250);
  const capNote = await page.evaluate(() => ({ hasMore: __mbxHasMore, text: ((document.querySelector('#ib-rows .ib-empty') || {}).textContent || '').trim() }));
  ok(capNote.hasMore === true, 'the fixture really has older mail on the server (else this proves nothing)');
  ok(!!capNote.text && !/every message/i.test(capNote.text) && /older|on the server/i.test(capNote.text),
    `SEARCH-CAP: an empty search says what it actually covered, not "every message" (“${capNote.text}”)`);
  await page.fill('#ib-q', '');
  await page.dispatchEvent('#ib-q', 'input');
  await page.waitForTimeout(250);
  // Mark as unread: the ⋯ menu's own item, and the owner's record keeps it.
  await openPerson('e:other@example.com', () => /Other Person|other@/.test((document.querySelector('#ib-conv .ib-hname') || {}).textContent || ''));
  await page.click('#ib-conv [data-ib="menu"]');
  await page.click('#ib-conv .ib-menu [data-ib="unread"]');
  await page.waitForTimeout(300);
  const mu = await page.evaluate(() => (document.querySelector('#ib-rows .ib-rowwrap[data-key="e:other@example.com"] .ib-row') || { classList: { contains: () => false } }).classList.contains('is-unread'));
  ok(mu && !!(state && state.unread && state.unread['e:other@example.com']), `mark unread: the row reads unread again, and it is saved (${mu})`);

  console.log('5. delete');
  await openPerson('e:other@example.com');
  await page.click('#ib-conv [data-ib="menu"]');
  await page.click('#ib-conv .ib-menu [data-ib="delete"]');
  await page.waitForFunction(() => document.getElementById('glass-dialog').classList.contains('open'), null, { timeout: 5000 }).catch(() => {});
  await page.click('#glass-dialog-ok');
  const del = await sentOf((p) => p.__url === 'mailbox.php' && p.action === 'delete', 5000);
  await page.waitForFunction(() => !document.querySelector('#ib-rows .ib-rowwrap[data-key="e:other@example.com"]'), null, { timeout: 5000 }).catch(() => {});
  const gone = await page.evaluate(() => !document.querySelector('#ib-rows .ib-rowwrap[data-key="e:other@example.com"]'));
  ok(!!del && JSON.stringify(del.uids) === '["u2"]' && gone, `delete confirmed, posted, row removed (${del && JSON.stringify(del.uids)})`);

  // THE STAY FACTS HOLD AT 390. The reader's inline "known guest" box went with the
  // reader; the one conversation states a stay as label/value rows. Its dates are ONE
  // fact and must never fragment, and a long cottage name must wrap its own row rather
  // than push anything out of the panel. HOSTILE, because the real names fit.
  console.log('6. the stay facts at 390');
  await page.setViewportSize({ width: 390, height: 900 });
  await page.waitForTimeout(300);
  await page.evaluate(() => { const b = document.querySelector('#ib-conv .ib-back'); if (b && document.getElementById('ib').classList.contains('is-conv')) b.click(); });
  await page.waitForTimeout(450);
  await openPerson('e:guest@example.com', () => !!document.querySelector('#ib-conv .ib-stayline'));
  await page.waitForTimeout(450);
  const squeezed = await page.evaluate(() => {
    const meta = propertyMeta['21a'];
    const was = meta.name;
    meta.name = 'The Old Harbourmasters Cottage House';
    __ibCtxOpen = true;
    ibRenderConv();
    const drop = document.getElementById('ib-ctxdrop');
    const kvs = [...drop.querySelectorAll('.ib-kv')].filter((k) => k.getClientRects().length);
    const dates = kvs.find((k) => /^Dates/.test(k.textContent.trim()));
    const val = dates && dates.lastElementChild;
    const lh = val ? parseFloat(getComputedStyle(val).lineHeight) || parseFloat(getComputedStyle(val).fontSize) * 1.5 : 0;
    const pane = document.getElementById('ib-conv').getBoundingClientRect();
    const out = {
      rows: kvs.length,
      datesH: val ? Math.round(val.getBoundingClientRect().height) : 0, lh: Math.round(lh),
      overflow: Math.max(0, ...kvs.map((k) => Math.round(k.getBoundingClientRect().right - pane.right)), ...kvs.map((k) => k.scrollWidth - k.clientWidth)),
      named: kvs.some((k) => /Old Harbourmasters/.test(k.textContent)),
    };
    meta.name = was;
    __ibCtxOpen = false;
    ibRenderConv();
    return out;
  });
  ok(squeezed.rows >= 3 && squeezed.named, `the stay's facts render with the hostile 36-character name (${squeezed.rows} rows)`);
  ok(squeezed.datesH > 0 && squeezed.datesH <= squeezed.lh + 4, `SQUEEZED: the dates stay one line (${squeezed.datesH}px vs ${squeezed.lh})`);
  ok(squeezed.overflow <= 0, `SQUEEZED: nothing runs past the panel (${squeezed.overflow}px)`);
  await page.evaluate(() => { const b = document.querySelector('#ib-conv .ib-back'); if (b && document.getElementById('ib').classList.contains('is-conv')) b.click(); });
  await page.waitForTimeout(450);
  await page.setViewportSize({ width: 1000, height: 900 });
  await page.waitForTimeout(300);

  // ONE ROW PER PERSON. Four rows reading "anneolin@btinternet.com · Re: Pay your deposit
  // — Pimpernel" were one chain wearing four costumes (owner's screenshot). The one list
  // joins by ADDRESS, so a chain is one row by construction — and the same subject from
  // a DIFFERENT sender must stay its own row, because that subject is the same words for
  // every guest we chase: merging on subject would file one guest's mail under another.
  console.log('7. one row per person');
  const th = await page.evaluate(() => {
    window.__mbxSave = __mbxMessages;
    __mbxMessages = [
      { uid: 'c1', from: 'anneolin@btinternet.com', fromRaw: 'Anne Olin <anneolin@btinternet.com>', subject: 'Pay your deposit — Pimpernel (#12xab12cd34ef5678)', date: '2026-07-22 08:05:00', seen: true },
      { uid: 'c2', from: 'anneolin@btinternet.com', fromRaw: 'Anne Olin <anneolin@btinternet.com>', subject: 'Re: Pay your deposit — Pimpernel', date: '2026-07-22 11:30:00', seen: true },
      { uid: 'c3', from: 'anneolin@btinternet.com', fromRaw: 'Anne Olin <anneolin@btinternet.com>', subject: 'RE: Re: Pay your deposit — Pimpernel', date: '2026-07-22 16:40:00', seen: false },
      { uid: 'd1', from: 'bob@example.com', fromRaw: 'Bob Carter <bob@example.com>', subject: 'Re: Pay your deposit — Pimpernel', date: '2026-07-19 10:00:00', seen: true },
      { uid: 'e1', from: 'anneolin@btinternet.com', fromRaw: 'Anne Olin <anneolin@btinternet.com>', subject: 'Parking at the cottage', date: '2026-07-18 10:00:00', seen: true },
    ];
    ibRender();
    const w = (k) => document.querySelector(`#ib-rows .ib-rowwrap[data-key="${k}"]`);
    const a = w('e:anneolin@btinternet.com'), b = w('e:bob@example.com');
    return {
      annes: [...document.querySelectorAll('#ib-rows .ib-rowwrap')].filter((x) => /anneolin/.test(x.getAttribute('data-key'))).length,
      bob: !!b,
      names: [a, b].map((x) => (x ? (x.querySelector('.ib-name') || {}).textContent || '' : '')),
      unread: [a, b].map((x) => !!x && x.querySelector('.ib-row').classList.contains('is-unread')),
    };
  });
  ok(th.annes === 1, `all four of Anne's emails are ONE row (${th.annes})`);
  ok(th.bob && /Bob Carter/.test(th.names[1]) && /Anne Olin/.test(th.names[0]), `the same subject from another sender stays its own row (${th.names[1]})`);
  ok(th.unread[0] === true && th.unread[1] === false, 'a person reads unread when ANY of their emails is unread');
  // The person OPENS on the whole chain, oldest first, the newest at the foot — and
  // the same sender's other subject is in it too, because it is the same person.
  await openPerson('e:anneolin@btinternet.com', () => [...document.querySelectorAll('#ib-thread .ib-msg.is-them .ib-text')].filter((t) => /^Body of /.test(t.textContent)).length === 4);
  await page.waitForTimeout(800); // the thread follows a new message down for 700ms
  const chain = await page.evaluate(() => {
    const ms = [...document.querySelectorAll('#ib-thread .ib-msg.is-them')];
    const th = document.getElementById('ib-thread');
    return {
      order: ms.map((m) => ((m.querySelector('.ib-text') || {}).textContent || '').replace('Body of ', '')),
      // Three replies on one afternoon used to render three identical dates.
      times: ms.slice(-3).map((m) => ((m.querySelector('.ib-meta') || {}).textContent || '').replace(/^Email · /, '').trim()),
      atFoot: th.scrollHeight - th.scrollTop - th.clientHeight < 80,
    };
  });
  ok(chain.order.join(',') === 'e1,c1,c2,c3', `the chain reads in time order, every email in it (${chain.order.join(',')})`);
  ok(chain.atFoot, 'and it opens at its newest');
  // THE WHOLE CHAIN IS ONE AFTERNOON — the fixture is deliberately same-day, because
  // that is the case the owner reported: three rows reading an identical date. The
  // time is the distinguishing fact, so each email carries it.
  ok(chain.times.length === 3 && chain.times.every((t) => /^\d\d:\d\d$/.test(t)) && new Set(chain.times).size === 3,
    `same-day replies are told apart by their time (${chain.times.join(' / ') || 'none shown'})`);
  await openPerson('e:bob@example.com', () => /Body of d1/.test((document.querySelector('#ib-thread .ib-msg.is-them .ib-text') || {}).textContent || ''));
  const lone = await page.evaluate(() => ({ n: document.querySelectorAll('#ib-thread .ib-msg.is-them').length, folds: document.querySelectorAll('#ib-thread .ib-quotebtn').length }));
  ok(lone.n === 1 && lone.folds === 0, 'a one-email person reads as exactly that one email');
  await page.evaluate(() => { __mbxMessages = window.__mbxSave; ibRender(); });
  await settled();

  // ---- A DECLINE SAYS WHAT IT IS ----------------------------------------------
  // The declined DRAWER is gone with the folders: the declined enquirer is a row of the
  // one list, and the drawer's claims are that row's. Reported from a phone: a green 0
  // and "All caught up" sat over a declined enquiry, and the row never said WHEN it was
  // turned down (the mapper dropped declined_at).
  console.log('8. a declined enquiry');
  await openPerson('e:j@x.co', () => [...document.querySelectorAll('#ib-thread .ib-event')].some((e) => /Enquiry declined/.test(e.textContent)));
  const dec = await page.evaluate(() => {
    const w = document.querySelector('#ib-rows .ib-rowwrap[data-key="e:j@x.co"]');
    const r = w && w.querySelector('.ib-row');
    const cap = w && w.querySelector('.ib-cap');
    const ev = [...document.querySelectorAll('#ib-thread .ib-event')].find((e) => /Enquiry declined/.test(e.textContent));
    return {
      cap: cap ? cap.textContent.trim() : '', capCls: cap ? cap.className : '',
      event: ev ? ev.textContent.trim() : '',
      words: [...document.querySelectorAll('#ib-thread .ib-msg.is-them .ib-text')].some((t) => /park a small van/.test(t.textContent)),
      prev: w ? ((w.querySelector('.ib-prev') || {}).textContent || '').trim() : '',
      opacity: r ? getComputedStyle(r).opacity + '/' + getComputedStyle(r.querySelector('.ib-rctx')).opacity : '',
    };
  });
  ok(dec.cap === 'Declined' && /\bunk\b/.test(dec.capCls) && !/\b(warn|bad)\b/.test(dec.capCls), `the row says Declined, muted — a decision, not a fault (“${dec.cap}”, ${dec.capCls})`);
  ok(/Enquiry declined · \d\d:\d\d/.test(dec.event), `the conversation says WHEN it was declined (“${dec.event}”)`);
  ok(dec.words && /park a small van/.test(dec.prev), 'the guest\u2019s own words show, on the row and in the conversation');
  ok(dec.opacity === '1/1', `the row is not dimmed by opacity (${dec.opacity})`);
  // A decline is never something to decide again.
  ok(await page.evaluate(() => !document.querySelector('#ib-conv [data-ib="approve"]')), '…and the conversation offers no Approve');

  // THE CONTEXT AND ITS CAPSULE ARE A PAIR, ON ONE LINE, AND THE COTTAGE NAME SURVIVES.
  // Reported from a phone on the drawer (the pill squeezed to "Pl…"); the one list's
  // row puts the same two things — the stay and its state — side by side.
  await page.setViewportSize({ width: 390, height: 900 });
  await page.waitForTimeout(300);
  await page.evaluate(() => { const b = document.querySelector('#ib-conv .ib-back'); if (b && document.getElementById('ib').classList.contains('is-conv')) b.click(); });
  await page.waitForTimeout(450);
  const pills = await page.evaluate(() => {
    const w = document.querySelector('#ib-rows .ib-rowwrap[data-key="e:j@x.co"]');
    const c = w && w.querySelector('.ib-rctx'), t = w && w.querySelector('.ib-tag');
    if (!c || !t || !c.getClientRects().length) return null;
    const mid = (el) => { const r = el.getBoundingClientRect(); return Math.round(r.y + r.height / 2); };
    return { cMid: mid(c), tMid: mid(t), cut: c.scrollWidth - c.clientWidth, tagCut: t.scrollWidth - t.clientWidth, txt: c.textContent.trim() };
  });
  ok(!!pills && Math.abs(pills.cMid - pills.tMid) <= 1, `the stay and the Declined capsule sit on one line (centres ${pills && pills.cMid} / ${pills && pills.tMid})`);
  ok(!!pills && pills.cut <= 1 && pills.tagCut <= 1, `neither is clipped: the cottage name survives (“${pills && pills.txt}”)`);
  await page.setViewportSize({ width: 1000, height: 900 });
  await page.waitForTimeout(300);
  // THE WAY BACK SAYS WHERE IT GOES. The drawer's "Put back in Waiting" lives in the
  // declined enquirer's own facts now (the stay line unfolds them), at a real tap
  // size, and it does what it says: asks once, then restores the enquiry.
  await openPerson('e:j@x.co', () => !!document.querySelector('#ib-conv .ib-stayline'));
  await page.evaluate(() => { const s = document.querySelector('#ib-conv .ib-stayline'); if (s && s.getAttribute('aria-expanded') !== 'true') s.click(); });
  await page.waitForTimeout(400);
  const back = await page.evaluate(() => {
    const b = [...document.querySelectorAll('#ib-conv [data-ib="undecline"], #ib-side [data-ib="undecline"]')].find((x) => x.getClientRects().length);
    return b ? { txt: b.textContent.trim(), h: Math.round(b.getBoundingClientRect().height) } : null;
  });
  ok(!!back && back.txt === 'Put back in Waiting', `the way back says where it goes (“${back && back.txt}”)`);
  ok(!!back && back.h >= 44, `…at a real tap size (${back && back.h}px)`);
  await page.evaluate(() => { const b = [...document.querySelectorAll('#ib-conv [data-ib="undecline"], #ib-side [data-ib="undecline"]')].find((x) => x.getClientRects().length); if (b) b.click(); });
  await page.waitForFunction(() => document.getElementById('glass-dialog').classList.contains('open'), null, { timeout: 5000 }).catch(() => {});
  await page.click('#glass-dialog-ok').catch(() => {});
  const restored = await sentOf((p) => p.__url === 'enquiries.php' && p.action === 'restore', 5000);
  ok(!!restored && Number(restored.id) === 91, `…and putting it back restores THAT enquiry (id ${restored && restored.id})`);
  // The restore reloads the data and THEN says so; wait for its own word, or the
  // reload it set off lands in the middle of the next section's fixture.
  await page.waitForFunction(() => [...document.querySelectorAll('.toast')].some((t) => /restored to the inbox/i.test(t.textContent)), null, { timeout: 8000 }).catch(() => {});
  await settled();

  // ---- WHAT WAITS, AND HOW THE INBOX SAYS IT ------------------------------------
  // The three-answers landing is gone (deliberately): the one list's own groups and the
  // status pill beside the title carry what its verdicts said.
  console.log('9. what waits, said once');
  const pillNow = () => page.evaluate(() => {
    const p = document.querySelector('#ib-pill .head-pill');
    return { text: p ? p.textContent.trim() : '', tone: p ? p.getAttribute('data-tone') : '', n: ibWaitingCount() };
  });
  const p0 = await pillNow();
  ok(p0.n ? p0.text === `${p0.n} waiting` && p0.tone !== 'ok' : p0.text === 'All answered' && p0.tone === 'ok',
    `the pill states the list's own count (${p0.n} → “${p0.text}”, ${p0.tone})`);
  // A STALE enquiry raises itself: its row joins Waiting on you and says how long.
  const stale = await page.evaluate(async (old) => {
    // RE-LAID UNTIL IT HOLDS: a background refresh can land and replace the store.
    let w = null;
    for (let i = 0; i < 5 && !w; i++) {
      if (!enquiries.some((x) => x.id === 'e99'))
        enquiries.push({ id: 'e99', dbId: 99, propKey: '21a', name: 'Laura Hicks', email: 'l@x.com', checkIn: old.ci, checkOut: old.co, adults: 2, children: 0, guests: '2 adults', message: 'Is Jollyboat free?', received: old.made.slice(0, 10), receivedAt: old.made });
      renderInbox();
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      w = document.querySelector('#ib-rows .ib-rowwrap[data-key="e:l@x.com"]');
      if (!w) await new Promise((r) => setTimeout(r, 300));
    }
    const grp = w && w.closest('.ib-rows');
    const time = w && w.querySelector('.ib-time');
    const p = document.querySelector('#ib-pill .head-pill');
    const up = {
      grp: grp ? grp.getAttribute('aria-label') : '',
      attn: !!(grp && grp.previousElementSibling && grp.previousElementSibling.classList.contains('is-attn')),
      time: time ? time.textContent.trim() : '', aged: !!time && time.classList.contains('is-age'),
      pill: p ? p.textContent.trim() : '', tone: p ? p.getAttribute('data-tone') : '', n: ibWaitingCount(),
    };
    enquiries = enquiries.filter((x) => x.id !== 'e99');
    renderInbox();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const q = document.querySelector('#ib-pill .head-pill');
    return { up, down: { pill: q ? q.textContent.trim() : '', gone: !document.querySelector('#ib-rows .ib-rowwrap[data-key="e:l@x.com"]') } };
  }, { ci: d(30), co: d(33), made: hrsAgo(4 * 24 + 5) });
  ok(stale.up.grp === 'Waiting on you' && stale.up.attn, `a stale enquiry sits under Waiting on you, the caption marked (${stale.up.grp})`);
  ok(/^4 days$/.test(stale.up.time) && stale.up.aged, `…saying how long it has waited, in the warning ink (“${stale.up.time}”)`);
  ok(stale.up.pill === `${stale.up.n} waiting` && stale.up.n === p0.n + 1 && stale.up.tone === 'warn', `…and the pill counts it, amber (“${stale.up.pill}”)`);
  ok(stale.down.gone && stale.down.pill === p0.text, `answering it stands the row and the count down (“${stale.down.pill}”)`);
  // UNKNOWN IS STATED, never claimed as nothing: a mailbox that did not answer says so
  // at the foot of the list, with the way to ask again.
  const unk = await page.evaluate(() => {
    __mbxFailed = true;
    ibRenderList();
    const n = document.querySelector('#ib-rows .ib-foot .ib-note');
    const out = { note: n ? n.textContent.trim() : '', retry: !!document.querySelector('#ib-rows [data-ib="retry-mail"]') };
    __mbxFailed = false;
    ibRenderList();
    return out;
  });
  ok(/mailbox didn.t answer/i.test(unk.note) && unk.retry, `a mailbox that did not answer is said, with Try again (“${unk.note.slice(0, 50)}”)`);
  // The layout follows the room: a computer's panes side by side, a phone's list alone.
  const lay = await page.evaluate(() => document.getElementById('ib').classList.contains('is-wide'));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  const layPhone = await page.evaluate(() => document.getElementById('ib').classList.contains('is-wide'));
  ok(lay && !layPhone, `side by side with room for both, one at a time on a phone (${lay}/${layPhone})`);
  await page.setViewportSize({ width: 900, height: 900 });
  await page.waitForTimeout(300);

  console.log('§11 THE MAIL WATCH: new customer email surfaces without opening the mailbox');
  // The landing's "3 new" verdict went with the landing; the count the cron's poll
  // leaves behind (__newMailPre) surfaces as Today's duty (ui-test-needs-you §7). What
  // is the mail watch's own: the RESUME probe checks immediately when stale — nudges
  // the reply-poll, re-reads the cheap count, and the duty repaints from it.
  await page.evaluate(() => {
    window.__mbxOpenedOnceSave = __mbxOpenedOnce;
    // FREEZE loadData for this section: a refresh landing mid-check re-derives
    // __newMailPre from the fixture's generic bootstrap (null) and clobbers the fresh
    // count set by the very chbMailCheck under test.
    window.__ldSave = window.loadData;
    window.loadData = async () => ({ ok: true, failed: [] });
  });
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
      duty: (chbDuties() || []).map((x) => x.label).find((x) => /new emails? (are|is) waiting|emailed you/.test(x)) || '',
    };
  });
  ok(mw2.polled && mw2.counted, 'resume nudges the reply-poll AND re-reads the cheap count');
  ok(mw2.pre && mw2.pre.count === 2, 'the fresh count lands in __newMailPre');
  ok(/2 new emails are waiting/.test(mw2.duty), `…and the duty it raises says so at once (“${mw2.duty}”)`);
  ok(mw2.armedOnce, 'the watch arms once per page — a re-init cannot double the timer');
  await page.evaluate(() => { __mbxOpenedOnce = window.__mbxOpenedOnceSave; window.__newMailPre = null; window.loadData = window.__ldSave; });

  // ── A RE-RENDER NEVER TAKES THE OWNER OFF WHAT THEY ARE READING ───────────────
  // renderInbox's old wide-split auto-select docked an enquiry hub over the email the
  // owner was reading AND stamped that enquiry seen. The one list has no enquiry pane
  // to dock into: a re-render of the enquiries must leave the Inbox and the open
  // conversation exactly where they were.
  await page.setViewportSize({ width: 1280, height: 900 });
  const hijack = await page.evaluate(async (dd) => {
    nav('view-inbox');
    await new Promise((r) => setTimeout(r, 300));
    ibSoon();
    await new Promise((r) => setTimeout(r, 300));
    const before = __ibOpen;
    window.__seedEnq = () => {
      if (!enquiries.some((x) => x.id === 'e77'))
        enquiries.push({ id: 'e77', dbId: 77, propKey: '21a', name: 'Nadia Ferrer', email: 'n@x.com', checkIn: dd.ci, checkOut: dd.co, adults: 2, children: 0, guests: '2 adults', message: 'Any parking?', received: dd.made, receivedAt: dd.made + ' 09:00:00' });
      return enquiries.length;
    };
    const seeded = window.__seedEnq();
    __enqHubId = null; // the state an approval/decline leaves behind
    let opened = 0;
    const real = window.openEnquiryHub;
    window.openEnquiryHub = async (...a) => { opened++; return real.apply(null, a); };
    renderInbox();
    await new Promise((r) => setTimeout(r, 400));
    window.openEnquiryHub = real;
    return { opened, seeded, before, after: __ibOpen, view: (document.querySelector('.page-view.active') || {}).id, nadiaSeen: !!(enquiries.find((x) => x.id === 'e77') || {}).seenAt };
  }, { ci: d(30), co: d(33), made: d(-1) });
  ok(hijack.seeded > 0, `the fixture really carries an enquiry to dock (${hijack.seeded})`);
  ok(hijack.opened === 0 && hijack.view === 'view-inbox', `a re-render does not open an enquiry hub over the Inbox (opened ${hijack.opened}, ${hijack.view})`);
  ok(!!hijack.before && hijack.after === hijack.before, `the conversation on screen stays the one being read (${hijack.before} → ${hijack.after})`);
  ok(!hijack.nadiaSeen, '…and the new enquiry is not stamped seen behind the owner\u2019s back');
  // …while an EMPTY pane on a computer still fills itself, with the person waiting
  // longest — which is the feature the old auto-select existed for.
  const autoSel = await page.evaluate(async () => {
    __ibOpen = null;
    ibRender();
    await new Promise((r) => setTimeout(r, 300));
    const p = __ibOpen ? __ibPeopleMap.get(__ibOpen) : null;
    return { open: __ibOpen, waiting: !!p && ibWaiting(p), name: ((document.querySelector('#ib-conv .ib-hname') || {}).textContent || '').trim() };
  });
  ok(!!autoSel.open && autoSel.waiting && !!autoSel.name, `an empty pane fills with the person waiting on you (${autoSel.open}, ${autoSel.name})`);

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

  // ── THE SEARCH BOX IS A SEARCH BOX ─────────────────────────────────────────
  // The chat folder's own search row squeezed its input to 64px on a phone beside the
  // unanswered chip. The one list has ONE search over everyone; on a phone it must keep
  // a usable width of the list it searches.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(250);
  const search = await page.evaluate(async () => {
    await window.openInbox();
    await new Promise((r) => setTimeout(r, 300));
    if (document.getElementById('ib').classList.contains('is-conv')) { ibClose(); await new Promise((r) => setTimeout(r, 450)); }
    const inp = document.getElementById('ib-q'), list = document.getElementById('ib-list');
    if (!inp || !inp.getClientRects().length) return { why: 'the search never painted' };
    return { w: Math.round(inp.getBoundingClientRect().width), listW: Math.round(list.getBoundingClientRect().width), ph: inp.placeholder };
  });
  ok(!!search && search.w >= search.listW * 0.6,
    `the Inbox's search keeps a usable width (${search && (search.why || search.w + 'px of ' + search.listW + 'px')})`);
  await page.setViewportSize({ width: 1000, height: 900 });
  await page.waitForTimeout(200);

  // ---- §11 DECLINING STOPS BEING THE END OF THE CONVERSATION ---------------
  //  The acknowledgement the guest already holds promises a reply "always by the
  //  end of the next day". The decline path requires no mailer and calls no send
  //  function, so nothing was ever sent — and the in-app help said the opposite
  //  ("decline — each emails the guest"), so the owner had no reason to think
  //  anything was owed. The ask does NOT send: it puts the reply one tap away at
  //  the moment the owner has the context, and "Not now" is a complete answer.
  //  (Driven through the enquiry page's own Decline, declineEnquiry — the one-list
  //  Inbox's in-place decline and its ask are ui-test-inbox §4.)
  console.log('\n-- §11 the decline offers the reply --');
  await page.setViewportSize({ width: 1000, height: 900 });
  // Drive the REAL decline. It awaits glassConfirm, so the promise is parked on
  // window and answered by clicking the dialog's own buttons.
  const startDecline = async (id) => {
    await page.evaluate((eid) => {
      window.__composeOpened = 0;
      // Wrap ONCE — re-wrapping per use stacks layers, and one open then counts four.
      if (!window.__realCompose) {
        window.__realCompose = window.openEnquiryEmail;
        window.openEnquiryEmail = (...a) => { window.__composeOpened++; return window.__realCompose.apply(null, a); };
      }
      document.querySelectorAll('.toast').forEach((t) => t.remove());
      window.__declineP = window.declineEnquiry(eid);
    }, id);
    await page.waitForTimeout(400);
  };
  const dialogText = () => page.evaluate(() => {
    const o = document.getElementById('glass-dialog');
    if (!o || !o.classList.contains('open')) return null;
    return {
      msg: (document.getElementById('glass-dialog-msg') || {}).innerText || '',
      ok: (document.getElementById('glass-dialog-ok') || {}).textContent || '',
    };
  });
  // 1) A guest with an address is asked about.
  await page.evaluate((seed) => {
    enquiries.length = 0;
    enquiries.push({ id: 'e77', dbId: 77, propKey: '21a', name: 'Nadia Ferrer', email: 'n@x.com', checkIn: seed.ci, checkOut: seed.co, adults: 2, children: 0, guests: '2 adults', message: 'Any parking?', received: seed.made });
  }, { ci: d(30), co: d(33), made: d(-1) });
  await startDecline('e77');
  await page.waitForFunction(() => document.getElementById('glass-dialog').classList.contains('open'), null, { timeout: 5000 }).catch(() => {});
  const asked = await dialogText();
  ok(!!asked && /expecting a reply/i.test(asked.msg),
    `declining raises the ask ("${asked ? asked.msg.split('\n')[0].slice(0, 58) : 'no dialog'}")`);
  ok(!!asked && /write the reply/i.test(asked.ok), `…and its button says what it does ("${asked && asked.ok}")`);
  // 2) "Write the reply" opens the composer — with the row it captured BEFORE the
  //    post, since a declined enquiry is out of `enquiries` by now.
  await page.click('#glass-dialog-ok');
  await page.waitForTimeout(500);
  const wrote = await page.evaluate(() => ({
    opened: window.__composeOpened,
    gone: !enquiries.some((e) => e.id === 'e77'),
    body: (document.getElementById('enq-email-body') || {}).value,
  }));
  ok(wrote.gone, 'the declined enquiry really has left the live list (so an id lookup would fail)');
  ok(wrote.opened === 1, `…and the composer still opened (${wrote.opened})`);
  // The ✨ drafter was REMOVED: the composer opens EMPTY, the owner's own words to
  // write — and so nothing in it can greet the guest a second time.
  ok(wrote.body === '', `…its message box empty — no canned draft (“${String(wrote.body).slice(0, 40)}”)`);
  await page.evaluate(() => { closeEnquiryEmailModal && closeEnquiryEmailModal(); });
  // 3) "Not now" is a complete answer: the old toast, Undo intact, nothing sent.
  await page.evaluate((seed) => {
    enquiries.length = 0;
    enquiries.push({ id: 'e78', dbId: 78, propKey: '21a', name: 'Owen Hale', email: 'o@x.com', checkIn: seed.ci, checkOut: seed.co, adults: 2, children: 0, guests: '2 adults', message: 'Hi', received: seed.made });
  }, { ci: d(30), co: d(33), made: d(-1) });
  await startDecline('e78');
  await page.waitForFunction(() => document.getElementById('glass-dialog').classList.contains('open'), null, { timeout: 5000 }).catch(() => {});
  await page.click('#glass-dialog-cancel');
  await page.waitForTimeout(400);
  const notNow = await page.evaluate(() => {
    const t = document.querySelector('.toast');
    return {
      opened: window.__composeOpened,
      msg: t ? (t.querySelector('.toast-body span') || {}).textContent || '' : '',
      undo: t ? (t.querySelector('.toast-action') || {}).textContent || '' : '',
    };
  });
  ok(notNow.opened === 0, `"Not now" sends nothing and opens nothing (${notNow.opened})`);
  ok(/removed from the inbox/i.test(notNow.msg), `…and the plain toast still reports the decline ("${notNow.msg}")`);
  ok(/undo/i.test(notNow.undo), `…with Undo intact ("${notNow.undo}")`);
  // 4) NO ADDRESS, NO ASK — there is nothing to offer, so the toast is unchanged.
  await page.evaluate((seed) => {
    enquiries.length = 0;
    enquiries.push({ id: 'e79', dbId: 79, propKey: '21a', name: 'Phone Only', email: '', phone: '07700 900000', checkIn: seed.ci, checkOut: seed.co, adults: 2, children: 0, guests: '2 adults', message: 'Hi', received: seed.made });
  }, { ci: d(30), co: d(33), made: d(-1) });
  await startDecline('e79');
  const noMail = await page.evaluate(() => {
    const o = document.getElementById('glass-dialog');
    const t = document.querySelector('.toast');
    return {
      dialog: !!(o && o.classList.contains('open')),
      msg: t ? (t.querySelector('.toast-body span') || {}).textContent || '' : '',
    };
  });
  ok(!noMail.dialog, 'an enquiry with no email address raises no ask');
  ok(/removed from the inbox/i.test(noMail.msg), `…and goes straight to the toast ("${noMail.msg}")`);

  // ---- §11b A DECLINE CAN STILL BE ANSWERED LATER -----------------------------
  //  A decline made in haste can still be answered an hour later. The drawer row that
  //  offered it is gone; the declined enquirer's conversation in the one list keeps
  //  the reply box, and a reply goes out through the ENQUIRY's own email route.
  console.log('\n-- §11b the declined conversation keeps the reply --');
  await page.evaluate(async () => { await window.openInbox(); await ibLoadAll(true); });
  await settled();
  await openPerson('e:j@x.co', () => !!document.getElementById('ib-reply'));
  const jem = await page.evaluate(() => ({
    reply: !!document.getElementById('ib-reply'),
    email: !!document.querySelector('#ib-conv .ib-chan [data-arg="email"]:not([disabled])'),
  }));
  ok(jem.reply && jem.email, 'the declined enquirer\u2019s conversation offers a reply by email');
  await page.fill('#ib-reply', 'So sorry we are full then — would the week after suit?');
  await page.click('#ib-send');
  const enqMail = await sentOf((p) => p.__url === 'enquiries.php' && p.action === 'email_guest');
  ok(!!enqMail && enqMail.id === 91 && /week after/.test(enqMail.message), `…and it goes through the declined enquiry's own email route (id ${enqMail && enqMail.id})`);
  // With NO address there is nothing to offer, so the box is simply absent — the
  // conversation says why, rather than offering a reply that could go nowhere.
  const noAddr = await page.evaluate(async () => {
    __declinedEnq = (__declinedEnq || []).map((e) => Object.assign({}, e, { email: '' }));
    __ibOpen = null;
    ibRender();
    const w = [...document.querySelectorAll('#ib-rows .ib-rowwrap')].find((x) => /Jem Beighton/.test(x.textContent));
    if (w) w.querySelector('.ib-row').click();
    await new Promise((r) => setTimeout(r, 400));
    return {
      found: !!w,
      reply: !!document.getElementById('ib-reply'),
      note: ((document.querySelector('#ib-conv .ib-autonote') || {}).textContent || '').trim(),
      back: !!document.querySelector('#ib-conv [data-ib="undecline"], #ib-side [data-ib="undecline"]'),
    };
  });
  ok(noAddr.found && !noAddr.reply && /no email address/i.test(noAddr.note), `with no address the reply box is absent and the conversation says why (“${noAddr.note}”)`);
  ok(noAddr.found && noAddr.back, '…and Put back in Waiting is still offered');

  console.log(fails ? `MAILBOX TEST FAILED ❌ (${fails})` : 'MAILBOX TEST PASSED ✅');
  await done(fails);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
