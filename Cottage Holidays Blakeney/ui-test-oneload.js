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
const { bootBrowser } = require('./ui-test-lib');
let fails = 0;
const ok = (b, m) => { console.log(`  ${b ? '✓' : '✗'} ${m}`); if (!b) fails++; };

(async () => {
  const t = await bootBrowser();
  const p = await t.browser.newPage({ viewport: { width: 390, height: 844 } });
  p.on('pageerror', (e) => { console.log('  PAGEERR:', e.message); fails++; });
  const hits = [];
  let windowFeeds = [];
  let syncAnswer = { ok: true, result: {} };
  const modDelay = 400;
  await p.route(/\.php/, async (route) => {
    const req = route.request();
    const url = req.url();
    let body = {}; try { body = JSON.parse(req.postData() || '{}'); } catch (e) {}
    hits.push({ url, action: body.action || '', at: Date.now() });
    const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (url.includes('admin-bootstrap.php')) return json({ ok: true, feeds: windowFeeds, dismissed: {} });
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

  await t.done(fails);
})().catch(async (e) => { console.error(e); process.exit(1); });
