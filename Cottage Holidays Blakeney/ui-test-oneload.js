// ONE LOAD PER TRIP: the back office fetches its data once per visit to Today,
// counts approvals in parallel, and does not reload after a calendar sync that
// changed nothing. Each is counted at the network, so a regression shows as a
// number rather than as a slower screen nobody times:
//   1. Today from another screen is ONE admin-bootstrap load — nav() runs the
//      init and tryAccessBackOffice ran it again on the very next line
//   2. a refresh asked for LATER still loads (the coalescing is one turn, never
//      a time window — the refresh callers depend on that)
//   3. the three approval counts are asked for at the same time, not in turn
//   4. a sync that changed nothing does not reload the bookings; one that
//      changed something does, and so does an older server's answer (no flag),
//      and so does an unchanged sync while a feed was in trouble (its state
//      lives in the reload)
//   5. on a phone the hidden rail costs nothing; on a computer it still works
//   6. an unchanged part of the owner's payload is not sent again: the page names
//      what it holds, a "same" part is re-read from the text it arrived as (so a
//      store the page has since changed cannot leak back), and a "same" for a hash
//      the page never held asks the part's own endpoint
//   7. the open guest chat names the thread it holds, and a "same" answer moves
//      only the typing line
//   8. the owner's data is kept on the phone, sealed: the next visit paints Today
//      from it before the server answers and names it so the server can answer
//      "same"; never for another person or after a change to what they may see,
//      never a copy that will not open or is over two days old (still named),
//      never kept as current when the load fails, never offline, never written
//      after signing out, and signing out removes it
//   9. the email log, the Sent list, the chat list and the settings are not sent
//      again either: each read names the copy it holds, a "same" is re-read from its
//      text, the chat list's archived view is its own copy, a "same" for a copy the
//      page no longer holds asks again in full, an older server's answer holds
//      nothing, and a failed read keeps the last good copy
const { bootBrowser, appReadyGoto, bootVerdict, d } = require('./ui-test-lib');
let fails = 0;
const ok = (b, m) => { console.log(`  ${b ? '✓' : '✗'} ${m}`); if (!b) fails++; };

(async () => {
  const t = await bootBrowser();
  const p = await t.browser.newPage({ viewport: { width: 390, height: 844 } });
  p.on('pageerror', (e) => { console.log('  PAGEERR:', e.message); fails++; });
  const hits = [];
  let windowFeeds = [];
  const mkB = (id, name) => ({ id, prop_key: 'jollyboat', name, email: `b${id}@x.com`, phone: '', check_in: '2026-11-10', check_out: '2026-11-13', adults: 2, children: 0, payment: 'paid', deposit_paid: 300, agreed_total: 300, agreed_nightly: 300, agreed_txn_fee: 0, agreed_nights: 3, hold_status: 'none' });
  const parts = {
    on: false, lie: false, haves: [],
    bk: [mkB(601, 'Alice Held'), mkB(602, 'Ben Held')], bkH: 'aaaaaaaaaaaaaaaa',
    rates: { properties: [], seasons: { jollyboat: [{ label: 'Peak', start: '2026-07-01', end: '2026-08-31', couple_rate: 200 }] } }, rtH: 'cccccccccccccccc',
  };
  let syncAnswer = { ok: true, result: {} };
  // §9: a server that hashes the four one-answer reads and honours `have` (json_out_held).
  const reads = {
    on: false, lie: '', fail: '', bare: '', haves: { email_logs: [], sent: [], threads: [], get_all: [] },
    data: {
      email_logs: { logs: { 601: [{ action: 'comms.message', summary: 'Emailed Alice', at: '2026-10-20 10:00:00', subject: 'Your stay', body: 'See you soon' }] } },
      sent: { ok: true, messages: [{ id: 1, to_email: 'gwen@x.com', to_name: 'Gwen', cc_email: '', subject: 'Hello Gwen', body: 'Hi', sent_at: '2026-10-20 10:00:00' }] },
      threads: { ok: true, threads: [{ thread_id: 9, name: 'Tess Thread', email: 'tess@x.com', source: '', location: '', is_guest: false, verified: false, archived: 0, last_at: '2026-10-21 09:00:00', unread: 1, last_body: 'Is there parking?', last_role: 'guest' }] },
      get_all: { content: { 'bacs-details': 'Sort 00-11-22', 'notify-emails': [] } },
    },
    h: { email_logs: '1111111111111111', sent: '2222222222222222', threads: '3333333333333333', threadsA: '5555555555555555', get_all: '4444444444444444' },
  };
  const readOf = (url, b) => (/\/bookings\.php/.test(url) && b.action === 'email_logs' ? 'email_logs'
    : /\/mailbox\.php/.test(url) && b.action === 'sent' ? 'sent'
    : /\/messages\.php/.test(url) && b.action === 'threads' ? 'threads'
    : /\/content\.php/.test(url) && b.action === 'get_all' ? 'get_all' : '');
  const modDelay = 400;
  await p.route(/\.php/, async (route) => {
    const req = route.request();
    const url = req.url();
    let body = {}; try { body = JSON.parse(req.postData() || '{}'); } catch (e) {}
    hits.push({ url, action: body.action || '', at: Date.now() });
    const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (url.includes('admin-bootstrap.php')) {
      if (!parts.on) return json({ ok: true, feeds: windowFeeds, dismissed: {} });
      // A server that hashes its parts and honours ?have=, like admin-bootstrap.php.
      const have = new URL(url).searchParams.get('have') || '';
      parts.haves.push(have);
      const held = Object.fromEntries(have.split(',').filter(Boolean).map((x) => x.split('.')));
      const out = { ok: true, feeds: [], dismissed: {}, hashes: { bookings: parts.bkH, rates: parts.rtH } };
      out.bookings = held.bookings === parts.bkH || parts.lie ? { same: true } : { bookings: parts.bk };
      out.rates = held.rates === parts.rtH ? { same: true } : parts.rates;
      return json(out);
    }
    const rk = reads.on ? readOf(url, body) : '';
    if (rk) {
      const arch = rk === 'threads' && Number(body.archived) === 1;
      reads.haves[rk].push((arch ? 'A:' : '') + (body.have || ''));
      if (reads.fail === rk) return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Down for a moment' }) });
      const h = reads.h[arch ? 'threadsA' : rk];
      if (reads.bare === rk) return json(reads.data[rk]);
      if (body.have && reads.lie === rk) return json({ same: true, h: 'eeeeeeeeeeeeeeee' });
      if (body.have && body.have === h) return json({ same: true, h });
      return json({ ...reads.data[rk], h });
    }
    if (url.includes('ical-import.php') && body.action === 'sync') return json(syncAnswer);
    if (/(reviews|photos|experiences)\.php/.test(url) && body.action === 'list_admin') {
      await new Promise((r) => setTimeout(r, modDelay));
      return json({ ok: true, reviews: [], photos: [], experiences: [] });
    }
    return json({ ok: true, bookings: [], enquiries: [], threads: [], reviews: [], photos: [], experiences: [], events: [], logs: {}, content: {}, blocks: [], payments: [], seasons: {}, occupancy: {}, properties: [] });
  });
  const count = (re, act) => hits.filter((h) => re.test(h.url) && (!act || h.action === act)).length;
  const quiet = async () => {
    let n = -1, since = Date.now();
    const t0 = Date.now();
    while (Date.now() - t0 < 15000) {
      if (hits.length !== n) { n = hits.length; since = Date.now(); }
      if (Date.now() - since > 900) return;
      await new Promise((r) => setTimeout(r, 100));
    }
  };

  await p.goto(t.base + '/index.html');
  await p.waitForTimeout(800);
  await p.evaluate(() => { isAuthenticated = true; document.body.classList.add('owner-mode'); });
  await p.evaluate(() => window.loadAdminBundle());
  await p.waitForFunction(() => !!window.__ADMIN_LOADED, null, { timeout: 20000 });
  // The calendar sync is throttled per browser — mark it as just run, so only
  // section 4 (which forces it) ever reaches the sync endpoint.
  await p.evaluate(() => { try { localStorage.setItem('nn-ical-last-sync', String(Date.now())); } catch (e) {} });
  await p.evaluate(() => window.openInbox());
  await quiet();

  console.log('1. Today is one load');
  hits.length = 0;
  await p.click('.admin-dock-btn[data-view="view-backoffice"]');
  await quiet();
  const boot1 = count(/admin-bootstrap\.php/);
  ok(boot1 === 1, `tapping Today from the Inbox fetches the back office once (${boot1})`);
  ok(await p.evaluate(() => document.getElementById('view-backoffice').classList.contains('active')), '…and Today is on screen');

  console.log('2. a later refresh still loads');
  hits.length = 0;
  await p.evaluate(() => window.initBackOffice());
  await quiet();
  ok(count(/admin-bootstrap\.php/) === 1, `an init asked for afterwards loads again (${count(/admin-bootstrap\.php/)})`);
  hits.length = 0;
  await p.evaluate(async () => { const a = window.initBackOffice(); await new Promise((r) => setTimeout(r, 0)); const b = window.initBackOffice(); await Promise.all([a, b]); });
  await quiet();
  ok(count(/admin-bootstrap\.php/) === 2, `two inits a task apart are two loads, never one (${count(/admin-bootstrap\.php/)})`);

  console.log('3. the approval counts are asked for together');
  hits.length = 0;
  const t0 = Date.now();
  await p.evaluate(() => window.refreshModerationCounts());
  const took = Date.now() - t0;
  const mods = hits.filter((h) => /(reviews|photos|experiences)\.php/.test(h.url) && h.action === 'list_admin');
  const spread = mods.length === 3 ? Math.max(...mods.map((h) => h.at)) - Math.min(...mods.map((h) => h.at)) : 1e9;
  ok(mods.length === 3, `all three are asked (${mods.length})`);
  ok(spread < modDelay / 2, `…at the same time, not one after another (${spread}ms between the first and last request)`);
  ok(took < modDelay * 2.5, `…so the counts land in about one request's time (${took}ms for three ${modDelay}ms answers)`);

  console.log('4. a sync that changed nothing does not reload');
  const sync = async (answer, feeds) => {
    syncAnswer = answer;
    if (feeds) await p.evaluate((f) => { window.__feedStatusPre = f; }, feeds);
    else await p.evaluate(() => { window.__feedStatusPre = []; });
    hits.length = 0;
    await p.evaluate(() => window.autoSyncIcalBlocks(true));
    await quiet();
    return { sync: count(/ical-import\.php/, 'sync'), boot: count(/admin-bootstrap\.php/) };
  };
  let r = await sync({ ok: true, result: { jollyboat: [{ source: 'airbnb', ok: true, events: 3, changed: false }], pimpernel: [] } });
  ok(r.sync === 1 && r.boot === 0, `nothing changed → no reload (${JSON.stringify(r)})`);
  r = await sync({ ok: true, result: { jollyboat: [{ source: 'airbnb', ok: true, events: 4, changed: true }] } });
  ok(r.sync === 1 && r.boot === 1, `a changed calendar reloads (${JSON.stringify(r)})`);
  r = await sync({ ok: true, result: { jollyboat: [{ source: 'airbnb', ok: true, events: 3 }] } });
  ok(r.boot === 1, `an older server's answer (no flag) still reloads (${JSON.stringify(r)})`);
  r = await sync({ ok: true, result: { jollyboat: [{ source: 'airbnb', ok: true, events: 3, changed: false }] } }, [{ pk: 'jollyboat', name: 'Jollyboat', ageHours: 2, failing: 1 }]);
  ok(r.boot === 1, `an unchanged sync while a feed was in trouble reloads, so the warning can clear (${JSON.stringify(r)})`);

  r = await sync({ ok: true, result: { jollyboat: [{ source: 'airbnb', ok: false, error: 'HTTP 503' }] } });
  ok(r.boot === 1, `a feed that just failed reloads, so its warning appears (${JSON.stringify(r)})`);

  console.log('5. the hidden rail costs nothing on a phone');
  await p.evaluate(() => window.openInbox());
  await quiet();
  const railCalls = () => p.evaluate(() => {
    let n = 0;
    const o = window.chbDaySentence;
    window.chbDaySentence = function () { n++; return o.apply(this, arguments); };
    try { window.chbFrameSync(); } finally { window.chbDaySentence = o; }
    return n;
  });
  ok(await railCalls() === 0, 'at phone width a frame sync skips the rail\'s walk over the bookings');
  await p.setViewportSize({ width: 1280, height: 900 });
  await p.waitForTimeout(400);
  ok(await railCalls() >= 1, '…and on a computer, where the rail is painted, it still works the day out');
  ok(await p.evaluate(() => { const r = document.getElementById('admin-rail'); return !!r && getComputedStyle(r).display !== 'none'; }), '…with the rail on screen');

  console.log('6. an unchanged part is not sent again');
  await p.setViewportSize({ width: 390, height: 844 });
  parts.on = true;
  const names = () => p.evaluate(() => Object.values(dbBookings).flat().map((b) => b.name).sort().join(', '));
  // The bookings loader's own fallback is a bare GET of bookings.php; other screens
  // post actions to the same file, which is why the count reads the action.
  const listAsks = () => hits.filter((h) => /\/bookings\.php/.test(h.url) && !h.action).length;
  const season = () => p.evaluate(() => ((propertySeasons.jollyboat || [])[0] || {}).label || '');
  hits.length = 0;
  await p.evaluate(() => window.initBackOffice());
  await quiet();
  ok(parts.haves[0] === '', `the first load names nothing, holding nothing yet ("${parts.haves[0]}")`);
  ok((await names()) === 'Alice Held, Ben Held' && (await season()) === 'Peak', `…and fills the stores from the parts (${await names()} · ${await season()})`);
  // A store the page changes after the load must not leak back on a "same": the
  // rates loader hands the part's own seasons object to propertySeasons.
  await p.evaluate(() => { propertySeasons.jollyboat[0].label = 'Mutated'; });
  hits.length = 0;
  await p.evaluate(() => window.initBackOffice());
  await quiet();
  const have2 = parts.haves[1] || '';
  ok(have2.includes('bookings.aaaaaaaaaaaaaaaa') && have2.includes('rates.cccccccccccccccc'), `the next load names what it holds (${have2})`);
  ok((await names()) === 'Alice Held, Ben Held', `…and on "same" the bookings are re-read from what it holds (${await names()})`);
  ok((await season()) === 'Peak', `…from the TEXT it arrived as, so a store changed since does not leak back (${await season()})`);
  ok(listAsks() === 0, `…without asking the bookings endpoint (${listAsks()})`);
  parts.bk = [...parts.bk, mkB(603, 'Cara New')];
  parts.bkH = 'bbbbbbbbbbbbbbbb';
  await p.evaluate(() => window.initBackOffice());
  await quiet();
  ok((await names()) === 'Alice Held, Ben Held, Cara New', `a changed part comes whole and is used (${await names()})`);
  await p.evaluate(() => window.initBackOffice());
  await quiet();
  ok((parts.haves[parts.haves.length - 1] || '').includes('bookings.bbbbbbbbbbbbbbbb'), `…and the next load names its new hash (${parts.haves[parts.haves.length - 1]})`);
  // A "same" for a hash this page never held: its loader asks its own endpoint.
  parts.lie = true;
  parts.bkH = 'dddddddddddddddd';
  hits.length = 0;
  await p.evaluate(() => window.initBackOffice());
  await quiet();
  ok(listAsks() === 1, `a "same" for a hash it never held asks the bookings endpoint instead (${listAsks()})`);
  parts.lie = false;
  parts.on = false;

  console.log('7. the open chat asks only for what changed');
  const g = await t.browser.newPage({ viewport: { width: 390, height: 844 } });
  g.on('pageerror', (e) => { console.log('  PAGEERR:', e.message); fails++; });
  const asks = [];
  const thread = { msgs: [{ id: 1, role: 'guest', body: 'Is there parking?', at: '2026-10-22 10:00:00', seen: false, read: false, attachment: '', by: 0, kind: '' }], h: 'eeeeeeeeeeeeeeee', typing: false };
  await g.route(/\.php/, async (route) => {
    const req = route.request();
    let body = {}; try { body = JSON.parse(req.postData() || '{}'); } catch (e) {}
    const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (req.url().includes('messages.php') && body.action === 'thread') {
      asks.push(body);
      const base = { ok: true, peer_typing: thread.typing, typing_by: 0 };
      if (thread.h && body.have === thread.h) return json({ ...base, same: true, h: thread.h });
      return json({ ...base, messages: thread.msgs, ...(thread.h ? { h: thread.h } : {}) });
    }
    return json({ ok: true, bookings: [], enquiries: [], threads: [], reviews: [], content: {}, properties: [], seasons: {}, occupancy: {} });
  });
  await g.goto(t.base + '/index.html');
  await g.waitForTimeout(800);
  await g.evaluate(() => { localStorage.setItem('chb-chat-token', 'f'.repeat(32)); toggleChat(); });
  await g.waitForFunction(() => /Is there parking/.test(document.getElementById('chat-thread').textContent), null, { timeout: 8000 }).catch(() => {});
  await g.evaluate(() => chatStopPolling());
  ok(asks.length >= 1 && !asks[0].have, `opening the chat asks for the whole thread (${JSON.stringify(asks[0] || null)})`);
  const before = await g.evaluate(() => document.getElementById('chat-thread').innerHTML);
  thread.typing = true;
  await g.evaluate(() => chatPoll());
  ok(asks[asks.length - 1].have === 'eeeeeeeeeeeeeeee', `the poll names the thread it holds (${asks[asks.length - 1].have})`);
  const after = await g.evaluate(() => { const t = document.getElementById('chat-thread'); return { bubbles: t.querySelectorAll('.chat-row').length, typing: !!t.querySelector('.chat-typing'), text: t.textContent }; });
  ok(after.bubbles === 1 && /Is there parking/.test(after.text), `a "same" answer leaves the conversation as it was (${after.bubbles} bubble)`);
  ok(after.typing, '…and still shows who is typing');
  // The hourly photo link (or anything else) can change the hash with the messages
  // unchanged: that full answer must not redraw the conversation, which it would if a
  // "same" answer had been read as an empty thread (the arrival animation replays).
  await g.evaluate(() => { document.querySelector('#chat-thread .chat-row').dataset.keep = '1'; });
  thread.h = '1111111111111111';
  await g.evaluate(() => chatPoll());
  ok(await g.evaluate(() => !!document.querySelector('#chat-thread .chat-row[data-keep="1"]')), 'after a "same", a full answer with the same messages leaves the conversation in place');
  thread.msgs = [...thread.msgs, { id: 2, role: 'admin', body: 'Yes, two spaces', at: '2026-10-22 10:01:00', seen: true, read: false, attachment: '', by: 0, kind: '' }];
  thread.h = 'ffffffffffffffff';
  thread.typing = false;
  await g.evaluate(() => chatPoll());
  ok(/Yes, two spaces/.test(await g.evaluate(() => document.getElementById('chat-thread').textContent)), 'a changed thread comes whole and the reply shows');
  await g.evaluate(() => chatPoll());
  ok(asks[asks.length - 1].have === 'ffffffffffffffff', `…and the next poll names its new hash (${asks[asks.length - 1].have})`);
  thread.h = '';
  await g.evaluate(() => chatPoll());
  await g.evaluate(() => chatPoll());
  ok(!asks[asks.length - 1].have, 'an older server (no hash) is asked in full every time, as before');
  ok(before.includes('Is there parking'), '(vacuity) the thread rendered before the polls');

  console.log('8. the owner\'s data is kept on the phone, sealed');
  // One context: its pages share IndexedDB the way visits to the site share a phone.
  const ctx = await t.browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const kept = { gate: null, open: () => {}, haves: [], fail: false };
  const mkK = (id, name) => Object.assign(mkB(id, name), { check_in: d(10), check_out: d(13) });
  const K = { bk: [mkK(701, 'Ada Kept'), mkK(702, 'Bo Kept')], bkH: '7777777777777777', rtH: 'cccccccccccccccc' };
  await ctx.route(/\.php/, async (route) => {
    const req = route.request();
    const url = req.url();
    let body = {}; try { body = JSON.parse(req.postData() || '{}'); } catch (e) {}
    const json = async (o) => { try { await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) }); } catch (e) {} };
    if (url.includes('admin-bootstrap.php')) {
      const have = new URL(url).searchParams.get('have') || '';
      kept.haves.push(have);
      if (kept.gate) await kept.gate;
      if (kept.fail) { try { await route.abort(); } catch (e) {} return; }
      const h = Object.fromEntries(have.split(',').filter(Boolean).map((x) => x.split('.')));
      return json({ ok: true, feeds: [], dismissed: {}, hashes: { bookings: K.bkH, rates: K.rtH },
        bookings: h.bookings === K.bkH ? { same: true } : { bookings: K.bk },
        rates: h.rates === K.rtH ? { same: true } : parts.rates });
    }
    if (kept.fail && /\/bookings\.php/.test(url) && !body.action) { try { await route.abort(); } catch (e) {} return; }
    return json({ ok: true, bookings: [], enquiries: [], threads: [], reviews: [], photos: [], experiences: [], events: [], logs: {}, content: {}, blocks: [], payments: [], seasons: {}, occupancy: {}, properties: [] });
  });
  const ME = (id, full) => ({ id, name: 'Owner One', first: 'Owner', full, role: full ? 'super' : 'host', perms: full ? { 'bk.see': true, 'mo.view': true } : { 'bk.see': true, 'mo.view': false }, caps: {}, photo: '', state: 'active' });
  const open = [];
  const visit = async (me, opts = {}) => {
    const pg = appReadyGoto(await ctx.newPage());
    open.push(pg);
    pg.on('pageerror', (e) => { console.log('  PAGEERR:', e.message); fails++; });
    if (opts.offline) await pg.addInitScript(() => { Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false }); });
    await pg.goto(t.base + '/index.html');
    await bootVerdict(pg);
    await pg.evaluate((m) => { isAuthenticated = true; document.body.classList.add('owner-mode'); chbSetMe(m); }, me);
    await pg.evaluate(() => window.loadAdminBundle());
    await pg.waitForFunction(() => !!window.__ADMIN_LOADED, null, { timeout: 20000 });
    return pg;
  };
  const leave = async (pg) => { try { await pg.close(); } catch (e) {} };
  const hold = () => { kept.gate = new Promise((r) => { kept.open = () => { kept.gate = null; r(); }; }); };
  const storeNames = (pg) => pg.evaluate(() => Object.values(dbBookings).flat().map((b) => b.name).sort().join(', '));
  const records = (pg) => pg.evaluate(() => new Promise((res) => {
    const r = indexedDB.open('chb-db');
    r.onerror = () => res(null);
    r.onsuccess = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('held')) return res([]);
      const q = db.transaction('held', 'readonly').objectStore('held').getAll();
      q.onsuccess = () => res(q.result.map((x) => ({ id: x.id, who: String(x.who || ''), h: x.h, at: x.at, z: !!(x.seal && x.seal.z), ct: x.seal && x.seal.ct ? Array.from(new Uint8Array(x.seal.ct)) : [] })));
      q.onerror = () => res(null);
    };
  }));
  const putRecords = (pg, change) => pg.evaluate((ch) => new Promise((res) => {
    const r = indexedDB.open('chb-db');
    r.onsuccess = () => {
      const tx = r.result.transaction('held', 'readwrite');
      const st = tx.objectStore('held');
      const q = st.getAll();
      q.onsuccess = () => {
        q.result.forEach((x) => {
          if (ch.at) x.at = ch.at;
          if (ch.spoil === x.id && x.seal && x.seal.ct) { const b = new Uint8Array(x.seal.ct); b[0] ^= 0xff; b[b.length - 1] ^= 0xff; x.seal.ct = b.buffer; }
          st.put(x);
        });
      };
      tx.oncomplete = () => res(true);
      tx.onerror = () => res(false);
    };
    r.onerror = () => res(false);
  }), change);
  const waitFor = async (fn, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 120)); } return false; };
  const bytesHave = (arr, s) => { const n = Buffer.from(s, 'utf8'); for (let i = 0; i + n.length <= arr.length; i++) { let j = 0; while (j < n.length && arr[i + j] === n[j]) j++; if (j === n.length) return true; } return false; };

  // 8a. A first visit keeps what the server sent, sealed.
  let pg = await visit(ME(7, true));
  await pg.evaluate(() => { window.initBackOffice(); });
  ok(await waitFor(async () => ((await records(pg)) || []).some((x) => x.id === 'bookings')), 'a first visit keeps the bookings on the phone');
  let recs = await records(pg);
  const bkRec = recs.find((x) => x.id === 'bookings') || { ct: [], who: '' };
  ok(recs.some((x) => x.id === 'rates') && bkRec.h === K.bkH, `…with the server's hash, beside the other parts (${recs.map((x) => x.id).sort().join(', ')})`);
  ok(bkRec.who.startsWith('7:'), `…kept as this person's (${bkRec.who})`);
  ok(bkRec.ct.length > 0 && !bytesHave(bkRec.ct, 'Ada Kept') && !bytesHave(bkRec.ct, 'b701@x.com'), 'sealed: no guest name or email is readable in what is stored');
  ok(bkRec.z, '…and compressed before it was sealed');
  // Compression alone would hide the name from a byte search, so the stored bytes must
  // not open WITHOUT the key either: not as gzip, not as text.
  const opensBare = await pg.evaluate(async (ct) => {
    const b = new Uint8Array(ct);
    try {
      const ds = new Blob([b]).stream().pipeThrough(new DecompressionStream('gzip'));
      const t = new TextDecoder().decode(await new Response(ds).arrayBuffer());
      return /Ada Kept/.test(t) ? 'gzip' : '';
    } catch (e) {}
    return /Ada Kept/.test(new TextDecoder().decode(b)) ? 'text' : '';
  }, bkRec.ct);
  ok(opensBare === '', `…and the stored bytes do not open without the key (${opensBare || 'they do not'})`);
  await leave(pg);

  // 8b. The next visit paints from it before the server answers, and names it.
  hold();
  pg = await visit(ME(7, true));
  const haves0 = kept.haves.length;
  await pg.evaluate(() => { window.initBackOffice(); });
  const painted = await waitFor(async () => (await storeNames(pg)) === 'Ada Kept, Bo Kept' && await pg.evaluate(() => (document.getElementById('bookings-list') || {}).textContent.includes('Ada Kept')), 6000);
  ok(painted && kept.gate !== null, 'the next visit paints Today from the phone before the server answers');
  ok(await waitFor(async () => kept.haves.length > haves0, 4000), '(vacuity) the load was asked for while the answer was held');
  const have8b = kept.haves[kept.haves.length - 1] || '';
  ok(have8b.includes('bookings.' + K.bkH) && have8b.includes('rates.' + K.rtH), `…and names what it holds, so the server can answer "same" (${have8b})`);
  ok(await pg.evaluate(() => chbStoresLive()) === false, '…and until the server answers, the copy is not live data');
  kept.open();
  ok(await waitFor(() => pg.evaluate(() => chbStoresLive())), 'once the server answers "same", the copy is current');
  ok((await storeNames(pg)) === 'Ada Kept, Bo Kept', `…and the stores are what was kept (${await storeNames(pg)})`);
  await leave(pg);

  // 8c/8d. Never someone else's copy, never one from before a change to what they may see.
  for (const [label, me] of [['another person', ME(8, true)], ['the same person after a change to what they may see', ME(7, false)]]) {
    hold();
    pg = await visit(me);
    const n0 = kept.haves.length;
    await pg.evaluate(() => { window.initBackOffice(); });
    ok(await waitFor(async () => kept.haves.length > n0, 6000), `(vacuity) ${label}: the load was asked for`);
    ok((await storeNames(pg)) === '', `${label} is shown nothing from the phone while the server answers (${await storeNames(pg)})`);
    ok(kept.haves[kept.haves.length - 1] === '', `…and names nothing (${kept.haves[kept.haves.length - 1]})`);
    await leave(pg);
    kept.open();
  }
  ok(((await (async () => { const q = await visit(ME(7, true)); const r = await records(q); await leave(q); return r; })()) || []).every((x) => x.who.startsWith('7:')), '…and neither replaced the first person\'s copy');

  // 8e. Offline, the day sheet is the screen: the copy is not painted.
  hold();
  pg = await visit(ME(7, true), { offline: true });
  await pg.evaluate(() => { window.initBackOffice(); });
  await new Promise((r) => setTimeout(r, 1500));
  ok((await storeNames(pg)) === '', `offline, nothing is painted from the phone (${await storeNames(pg)})`);
  await leave(pg);
  kept.open();

  // 8f. A copy over two days old is not painted, but is still named.
  pg = await visit(ME(7, true));
  await putRecords(pg, { at: Date.now() - 49 * 3600000 });
  await leave(pg);
  hold();
  pg = await visit(ME(7, true));
  let n1 = kept.haves.length;
  await pg.evaluate(() => { window.initBackOffice(); });
  ok(await waitFor(async () => kept.haves.length > n1, 6000), '(vacuity) the load was asked for');
  ok((await storeNames(pg)) === '', `a copy over two days old is not painted (${await storeNames(pg)})`);
  const have8f = kept.haves[kept.haves.length - 1] || '';
  ok(have8f.includes('bookings.' + K.bkH), `…but is still named, so the server can confirm it (${have8f})`);
  kept.open();
  ok(await waitFor(async () => (await storeNames(pg)) === 'Ada Kept, Bo Kept'), '…and confirmed "same", it fills the stores');
  ok(await waitFor(async () => ((await records(pg)) || []).every((x) => Date.now() - x.at < 600000), 8000), '…and is dated afresh, now the server has said it is current');
  await leave(pg);

  // 8g. A failed load withdraws the copy: it never stands in for an answer.
  hold();
  pg = await visit(ME(7, true));
  await pg.evaluate(() => { window.initBackOffice(); });
  ok(await waitFor(async () => (await storeNames(pg)) === 'Ada Kept, Bo Kept', 6000), '(vacuity) painted from the phone');
  kept.fail = true;
  kept.open();
  ok(await waitFor(async () => (await storeNames(pg)) === '', 12000), `when the load fails, the copy is withdrawn from the stores (${await storeNames(pg)})`);
  ok(await pg.evaluate(() => chbStoresLive()) === false, '…so nothing reads it as live data');
  ok(await pg.evaluate(() => document.body.classList.contains('offline-snap') || !(document.getElementById('bookings-list') || {}).textContent.includes('Ada Kept')), '…and Today does not present it as current');
  kept.fail = false;
  await leave(pg);

  // 8h. A copy that will not open is absent; the part is fetched whole and kept again.
  pg = await visit(ME(7, true));
  await putRecords(pg, { spoil: 'bookings' });
  await leave(pg);
  hold();
  pg = await visit(ME(7, true));
  n1 = kept.haves.length;
  await pg.evaluate(() => { window.initBackOffice(); });
  ok(await waitFor(async () => kept.haves.length > n1, 6000), '(vacuity) the load was asked for');
  ok((await storeNames(pg)) === '', `a copy that will not open is not painted (${await storeNames(pg)})`);
  const have8h = kept.haves[kept.haves.length - 1] || '';
  ok(!have8h.includes('bookings.') && have8h.includes('rates.' + K.rtH), `…nor named, while the parts that open still are (${have8h})`);
  kept.open();
  ok(await waitFor(async () => (await storeNames(pg)) === 'Ada Kept, Bo Kept'), '…and the part comes whole');
  ok(await waitFor(async () => { const r = await records(pg); const b = (r || []).find((x) => x.id === 'bookings'); return !!b && Date.now() - b.at < 60000; }, 8000), '…and is kept again');

  // 8i. Signing out removes it, and nothing is written after.
  await pg.evaluate(async () => { __abSaved = {}; isAuthenticated = false; await chbSecForget(); await abHeldSave(); });
  recs = await records(pg);
  ok(Array.isArray(recs) && recs.length === 0, `signing out removes the copy, and a save after it writes nothing (${(recs || []).map((x) => x.id).join(', ')})`);
  await leave(pg);
  for (const q of open) await leave(q);
  await ctx.close();

  console.log('9. the email log, the Sent list, the chat list and the settings are not sent again');
  await quiet();
  reads.on = true;
  const last = (k) => reads.haves[k][reads.haves[k].length - 1];
  const logSubject = () => p.evaluate(() => (((bookingEmailLogs['601'] || [])[0]) || {}).subject || '');
  // The email log.
  await p.evaluate(() => loadBookingEmailLogs());
  ok(last('email_logs') === '', `the first read of the email log names nothing, holding nothing yet ("${last('email_logs')}")`);
  ok((await logSubject()) === 'Your stay', `…and fills the log (${await logSubject()})`);
  await p.evaluate(() => { bookingEmailLogs['601'][0].subject = 'Mutated'; });
  let n9 = reads.haves.email_logs.length;
  await p.evaluate(() => loadBookingEmailLogs());
  ok(last('email_logs') === reads.h.email_logs && reads.haves.email_logs.length === n9 + 1, `the next read names the copy it holds, in one request (${last('email_logs')})`);
  ok((await logSubject()) === 'Your stay', `…and on "same" the log is re-read from its text, so a change made since does not leak back (${await logSubject()})`);
  reads.data.email_logs = { logs: { 601: [{ action: 'comms.message', summary: 'Emailed Alice', at: '2026-10-21 10:00:00', subject: 'Second note', body: '' }] } };
  reads.h.email_logs = '6666666666666666';
  await p.evaluate(() => loadBookingEmailLogs());
  ok((await logSubject()) === 'Second note', `a changed log comes whole and is used (${await logSubject()})`);
  await p.evaluate(() => loadBookingEmailLogs());
  ok(last('email_logs') === '6666666666666666', `…and the next read names its new hash (${last('email_logs')})`);
  reads.fail = 'email_logs';
  await p.evaluate(() => loadBookingEmailLogs());
  ok((await logSubject()) === 'Second note', `a failed read keeps the last good log (${await logSubject()})`);
  reads.fail = '';
  await p.evaluate(() => loadBookingEmailLogs());
  ok(last('email_logs') === '6666666666666666', `…and still names it afterwards (${last('email_logs')})`);
  // A "same" for a copy the page no longer holds: asked again in full.
  reads.lie = 'email_logs';
  n9 = reads.haves.email_logs.length;
  await p.evaluate(() => loadBookingEmailLogs());
  const asked9 = reads.haves.email_logs.slice(n9);
  ok(asked9.length === 2 && asked9[0] === '6666666666666666' && asked9[1] === '', `a "same" for a copy it does not hold asks again in full (${JSON.stringify(asked9)})`);
  ok((await logSubject()) === 'Second note', `…and the log is what the full answer said (${await logSubject()})`);
  reads.lie = '';
  // An older server: no hash, nothing held, nothing named.
  reads.bare = 'email_logs';
  await p.evaluate(() => loadBookingEmailLogs());
  await p.evaluate(() => loadBookingEmailLogs());
  ok(last('email_logs') === '', `an older server's answer (no hash) is asked for in full every time (${last('email_logs')})`);
  reads.bare = '';

  // The chat list, and its archived view as a copy of its own.
  await p.evaluate(() => { __msgShowArchived = false; return loadAdminMessages(); });
  ok(last('threads') === '', `the chat list's first read names nothing ("${last('threads')}")`);
  await p.evaluate(() => { __msgThreads[0].last_body = 'Mutated'; });
  await p.evaluate(() => loadAdminMessages());
  ok(last('threads') === reads.h.threads, `…the next names its copy (${last('threads')})`);
  ok(await p.evaluate(() => (__msgThreads[0] || {}).last_body) === 'Is there parking?', `…and a "same" lists the threads as they were sent (${await p.evaluate(() => (__msgThreads[0] || {}).last_body)})`);
  await p.evaluate(() => { __msgShowArchived = true; return loadAdminMessages(); });
  ok(last('threads') === 'A:', `the archived view does not name the active list's copy ("${last('threads')}")`);
  await p.evaluate(() => loadAdminMessages());
  ok(last('threads') === 'A:' + reads.h.threadsA, `…and names its own the next time (${last('threads')})`);
  await p.evaluate(() => { __msgShowArchived = false; });

  // The Sent list.
  const sentSubject = () => p.evaluate(() => ((__mbxSent || [])[0] || {}).subject || '');
  await p.evaluate(() => loadMailbox());
  ok(last('sent') === '', `the Sent list's first read names nothing ("${last('sent')}")`);
  ok((await sentSubject()) === 'Hello Gwen', `…and fills it (${await sentSubject()})`);
  await p.evaluate(() => { __mbxSent[0].subject = 'Mutated'; });
  await p.evaluate(() => loadMailbox());
  ok(last('sent') === reads.h.sent && (await sentSubject()) === 'Hello Gwen', `…the next names its copy and a "same" reads it afresh (${last('sent')} · ${await sentSubject()})`);

  // The settings.
  const bacs = () => p.evaluate(() => adminPrivateContent['bacs-details']);
  await p.evaluate(() => window.openSettings());
  await quiet();
  ok(last('get_all') === '', `the settings' first read names nothing ("${last('get_all')}")`);
  ok((await bacs()) === 'Sort 00-11-22', `…and fills them (${await bacs()})`);
  await p.evaluate(() => { adminPrivateContent['bacs-details'] = 'Mutated'; });
  await p.evaluate(() => window.openSettings());
  await quiet();
  ok(last('get_all') === reads.h.get_all, `…the next names its copy (${last('get_all')})`);
  ok((await bacs()) === 'Sort 00-11-22', `…and a "same" puts back what the server holds, not what the page changed since (${await bacs()})`);
  reads.on = false;

  // Every read of the four goes through the held copy (the chat count's fallback for an
  // older server is the one plain read, and it reads no store).
  const src = require('fs').readFileSync(require('path').join(__dirname, 'admin.js'), 'utf8');
  const plain = [/apiPost\('bookings\.php', \{ action: 'email_logs'/g, /apiPost\('mailbox\.php', \{ action: 'sent'/g, /apiPost\('content\.php', \{ action: 'get_all'/g]
    .map((re) => (src.match(re) || []).length);
  const plainThreads = (src.match(/apiPost\('messages\.php', \{\s*action: 'threads'/g) || []).length;
  ok(plain.every((n) => n === 0) && plainThreads === 1, `no plain read of the four is left in admin.js (${plain.join(', ')}; threads ${plainThreads})`);
  ok((src.match(/apiPostHeld\(/g) || []).length >= 8, `(vacuity) the held reads are there (${(src.match(/apiPostHeld\(/g) || []).length})`);

  await t.done(fails);
})().catch(async (e) => { console.error(e); process.exit(1); });
