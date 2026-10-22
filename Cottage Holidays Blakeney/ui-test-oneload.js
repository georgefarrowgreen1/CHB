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
const { bootBrowser } = require('./ui-test-lib');
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

  await t.done(fails);
})().catch(async (e) => { console.error(e); process.exit(1); });
