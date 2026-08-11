// MANAGE'S VERDICTS + the calendar-feeds verdict list, in a real browser:
//  §1 the landing leads with a pulse + exception (a stalled feed) above the
//     untouched toolbox; the verdict groups read the SAME stores the pills
//     and badges read (bootstrap cron/feeds, __nyMod, chbMissList)
//  §2 the exception rule both ways (fresh feeds → no red), and the To-approve
//     verdict counts what the moderation lists hold
//  §3 the calendar-feeds section is one verdict fold group per cottage with
//     Run-the-sync inside the fold; the toolbox rows still route
const { boot } = require('./ui-test-lib'); // pins TZ=Europe/London at require time
let fails = 0;
const ok = (b, m) => { console.log(`  ${b ? '✓' : '✗'} ${m}`); if (!b) fails++; };

(async () => {
  const { page, base, done } = await boot({ viewport: { width: 1280, height: 950 } });

  // One stalled Jollyboat feed (74h, hourly expected) + one fresh 21A feed;
  // cron healthy; ONE pending review. Flip via `feedsStalled` for §2.
  let feedsStalled = true;
  await page.route(/\.php/, (route) => {
    const url = route.request().url();
    const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    let b = {}; try { b = JSON.parse(route.request().postData() || '{}'); } catch (e) {}
    if (url.includes('admin-bootstrap.php')) return json({
      ok: true,
      cron: { stale: false, everRan: true, ageHours: 5 },
      feeds: feedsStalled
        ? [{ pk: '21a', name: '21A Westgate', ageHours: 0.4, failing: 0 }, { pk: 'jollyboat', name: 'Jollyboat', ageHours: 74, failing: 0 }]
        : [{ pk: '21a', name: '21A Westgate', ageHours: 0.4, failing: 0 }, { pk: 'jollyboat', name: 'Jollyboat', ageHours: 0.6, failing: 0 }],
    });
    if (url.includes('reviews.php')) return json({ ok: true, reviews: [{ id: 1, status: 'pending', prop: '21a', name: 'Margaret', text: 'Lovely.' }] });
    if (url.includes('photos.php')) return json({ ok: true, photos: [] });
    if (url.includes('experiences.php')) return json({ ok: true, experiences: [] });
    if (url.includes('ical-import.php')) {
      if (b.action === 'sync') return json({ ok: true, imported: 14 });
      return json({ ok: true, feeds: [], blocks: [] });
    }
    if (url.includes('rates.php')) return json({ properties: [
      { prop_key: '21a', name: '21A Westgate', slug: '21a', couple_rate: 130, extra_adult_rate: 0, child_rate: 0, booking_fee: 50, transaction_pct: 0, lastmin_pct: 0, lastmin_days: 0, max_adults: 2, max_children: 0, max_total: 2, sort_order: 1 },
      { prop_key: 'jollyboat', name: 'Jollyboat', slug: 'jollyboat', couple_rate: 150, extra_adult_rate: 0, child_rate: 0, booking_fee: 50, transaction_pct: 0, lastmin_pct: 0, lastmin_days: 0, max_adults: 2, max_children: 0, max_total: 2, sort_order: 2 },
    ], seasons: {}, occupancy: {} });
    return json({ ok: true, bookings: [], enquiries: [], threads: [], events: [], logs: {}, content: {}, blocks: [], ranges: [], payments: [], seasons: {}, occupancy: {}, properties: [] });
  });

  await page.goto(`${base}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1300);
  await page.evaluate(() => { isAuthenticated = true; document.body.classList.add('owner-mode'); });
  await page.evaluate(() => window.loadAdminBundle());
  await page.waitForTimeout(700);
  // The verdicts read the bootstrap payload — make sure it has landed.
  await page.evaluate(async () => { await loadData(); });
  await page.waitForTimeout(600);
  await page.evaluate(async () => { await openArea(); });
  await page.waitForTimeout(900);

  console.log('§1 the landing: pulse + exception above the toolbox');
  const land = await page.evaluate(() => {
    const host = document.getElementById('manage-verdicts');
    const caps = [...host.querySelectorAll('.bhub-grpcap')].map((c) => c.textContent.trim());
    return {
      pulse: (host.querySelector('.mo-pulse') || {}).textContent || '',
      caps,
      attnFirst: caps[0] === 'Needs attention',
      feedRow: /Calendar sync has stalled — Jollyboat/.test(host.textContent),
      feedCapWarn: !!host.querySelector('[data-grp="mgfeed0"] .st-cap.is-warn .st-wic'),
      sysSub: (host.querySelector('[data-grp="mgsys"] .bhub-fold-sub') || {}).textContent || '',
      sysTrouble: /1 in trouble/.test((document.getElementById('bhub-fold-mgsys') || {}).textContent || ''),
      runSyncInFold: !!host.querySelector('#bhub-fold-mgfeed0 [data-act="runSync"]'),
      toolboxIntact: !!document.querySelector('#settings-index .settings-group .settings-row[data-arg="reviews"]'),
      foldsClosed: [...host.querySelectorAll('.bhub-fold')].every((f) => f.hidden),
    };
  });
  ok(/automation needs a look/.test(land.pulse), `the pulse states the day's work (${land.pulse})`);
  ok(land.attnFirst && land.feedRow, 'the stalled feed is the exception, above everything');
  ok(land.feedCapWarn, 'it wears the warning capsule with the triangle');
  ok(land.runSyncInFold, 'Run-the-sync is one tap inside the exception fold');
  ok(land.sysTrouble, 'the System-check fold counts the same trouble (one source, two surfaces)');
  ok(land.toolboxIntact, 'the toolbox rows below are untouched');
  ok(land.foldsClosed, 'every verdict starts folded');

  console.log('§2 the verdicts read the real stores, both ways');
  const mod = await page.evaluate(() => ({
    cap: ((document.querySelector('#manage-verdicts [data-grp="mgmod"] .st-cap') || {}).textContent || ''),
    revRow: /Reviews/.test((document.getElementById('bhub-fold-mgmod') || {}).textContent || '') && /1 waiting/.test((document.getElementById('bhub-fold-mgmod') || {}).textContent || ''),
  }));
  ok(/1 waiting/.test(mod.cap), `To approve counts the pending review (${mod.cap.trim()})`);
  ok(mod.revRow, '…and its fold names which queue holds it');
  // Fresh feeds → the red section stands down and the pulse relaxes.
  feedsStalled = false;
  const down = await page.evaluate(async () => {
    const ab = await apiGet('admin-bootstrap.php');
    window.__cronStatusPre = ab.cron; window.__feedStatusPre = ab.feeds;
    manageVerdicts();
    const host = document.getElementById('manage-verdicts');
    return {
      attnGone: ![...host.querySelectorAll('.bhub-grpcap')].some((c) => c.textContent.trim() === 'Needs attention'),
      sysOk: !!host.querySelector('[data-grp="mgsys"] .st-cap.is-ok .st-tick'),
      feedsFresh: /all fresh/.test((document.getElementById('bhub-fold-mgsys') || {}).textContent || ''),
    };
  });
  ok(down.attnGone, 'fresh feeds → no red section at all');
  ok(down.sysOk && down.feedsFresh, 'System check flips to the green ✓ capsule and says the feeds are fresh');
  feedsStalled = true;
  await page.evaluate(async () => {
    const ab = await apiGet('admin-bootstrap.php');
    window.__feedStatusPre = ab.feeds; manageVerdicts();
  });

  console.log('§3 the calendar-feeds section: one verdict per cottage');
  await page.evaluate(() => settingsOpen('calendar'));
  await page.waitForTimeout(500);
  const cal = await page.evaluate(() => {
    const list = document.getElementById('calendar-list');
    return {
      grps: list ? list.querySelectorAll('.bhub-fold-grp').length : 0,
      jbWarn: !!list.querySelector('[data-grp="cal-jollyboat"] .st-cap.is-warn .st-wic'),
      a21ok: !!list.querySelector('[data-grp="cal-21a"] .st-cap.is-ok .st-tick'),
      jbSub: (list.querySelector('[data-grp="cal-jollyboat"] .bhub-fold-sub') || {}).textContent || '',
      runInFold: !!list.querySelector('#bhub-fold-cal-jollyboat [data-act="runSync"]'),
      editRoute: !!list.querySelector('#bhub-fold-cal-jollyboat [data-act="settingsOpenCalendar"]'),
    };
  });
  ok(cal.grps >= 2, `every cottage is a verdict group (${cal.grps})`);
  ok(cal.jbWarn && cal.a21ok, 'the stalled feed wears the triangle, the fresh one the ✓');
  ok(/last imported 3 days ago/.test(cal.jbSub), `the sub states the staleness (${cal.jbSub})`);
  ok(cal.runInFold && cal.editRoute, 'Run-the-sync + the feed-link editor sit inside the fold');
  // The drill-down to the real feed editor still works (the old route).
  await page.evaluate(() => settingsOpenCalendar('jollyboat'));
  await page.waitForTimeout(500);
  const detail = await page.evaluate(() => ({
    shown: (document.getElementById('calendar-detail') || { style: {} }).style.display !== 'none',
    listHidden: (document.getElementById('calendar-list') || { style: {} }).style.display === 'none',
  }));
  ok(detail.shown && detail.listHidden, 'Edit-feed-links still opens the cottage’s own editor');

  console.log('§4 the cottage page: every section a fold group, the REAL editor inside');
  await page.evaluate(() => { settingsOpen('accom'); settingsOpenAccom('21a'); });
  await page.waitForTimeout(500);
  const cot = await page.evaluate(() => {
    const detail = document.getElementById('accom-detail');
    const grps = [...detail.querySelectorAll('.bhub-fold-grp')].map((g) => g.getAttribute('data-grp'));
    return {
      grps: grps.length,
      hasRates: grps.includes('ac-21a-rates'),
      rateFig: /£130/.test((detail.querySelector('[data-grp="ac-21a-rates"] .bhub-fold-right') || {}).textContent || ''),
      photosCap: ((detail.querySelector('[data-grp="ac-21a-photos"] .st-cap') || {}).textContent || ''),
      foldsClosed: [...detail.querySelectorAll('.bhub-fold')].every((f) => f.hidden),
      // The REAL editor lives in the fold (in the DOM even while closed).
      textEditor: !!detail.querySelector('#bhub-fold-ac-21a-text input, #bhub-fold-ac-21a-text textarea'),
      removeRow: /Remove this accommodation/.test(detail.textContent),
    };
  });
  ok(cot.grps >= 10, `every section renders as a fold group (${cot.grps})`);
  ok(cot.hasRates && cot.rateFig, 'the Rates row carries the real nightly figure');
  ok(/none yet|photo/.test(cot.photosCap), `the Photos verdict counts the gallery (${cot.photosCap.trim()})`);
  ok(cot.foldsClosed, 'every section starts folded');
  ok(cot.textEditor, 'the REAL text editor lives inside its fold');
  ok(cot.removeRow, 'the private/remove controls survive below the groups');
  // A deep link lands with THAT fold open and everything else closed.
  const deep = await page.evaluate(() => {
    settingsOpenAccomSec('21a', 'rates');
    const f = document.getElementById('bhub-fold-ac-21a-rates');
    return {
      open: !!(f && !f.hidden && f.getClientRects().length),
      othersClosed: [...document.querySelectorAll('#accom-detail .bhub-fold')].filter((x) => !x.hidden).length === 1,
      editor: !!(f && f.querySelector('input')),
    };
  });
  ok(deep.open && deep.editor, 'a deep link opens that fold onto its working editor');
  ok(deep.othersClosed, '…and only that fold');
  // The deep link's scroll must land the fold row BELOW the fixed header —
  // block:'start' with no scroll-margin buries the row you just opened.
  await page.waitForTimeout(1000); // the smooth scroll settles
  const clear = await page.evaluate(() => {
    const grp = document.querySelector('#accom-detail [data-grp="ac-21a-rates"]');
    const hdr = document.querySelector('header');
    return grp && grp.getBoundingClientRect().top >= (hdr ? hdr.getBoundingClientRect().bottom : 0) - 1;
  });
  ok(clear, 'the deep link scrolls the fold clear of the fixed header');

  console.log('§5 Website content: two verdict groups, the real editors inside');
  await page.evaluate(() => settingsOpen('content'));
  await page.waitForTimeout(400);
  const wc = await page.evaluate(() => {
    const w = document.getElementById('content-editor');
    return {
      grps: [...w.querySelectorAll('.bhub-fold-grp')].map((g) => g.getAttribute('data-grp')),
      textCap: ((w.querySelector('[data-grp="wc-text"] .st-cap') || {}).textContent || ''),
      imgCap: ((w.querySelector('[data-grp="wc-images"] .st-cap') || {}).textContent || ''),
      foldsClosed: [...w.querySelectorAll('.bhub-fold')].every((f) => f.hidden),
      // The REAL fields keep their ce-<key> ids inside the fold, so
      // contentEditSave and the poorsignal gate's direct calls still work.
      fieldInFold: !!w.querySelector('#bhub-fold-wc-text input[id^="ce-"], #bhub-fold-wc-text textarea[id^="ce-"]'),
      imgBtnInFold: !!w.querySelector('#bhub-fold-wc-images [data-act="contentEditImage"]'),
    };
  });
  ok(wc.grps.includes('wc-images') && wc.grps.includes('wc-text'), `Images + Text are verdict fold groups (${wc.grps.join(',')})`);
  ok(/field/.test(wc.textCap) && /image|none found/.test(wc.imgCap), `the capsules count the real fields (${wc.textCap.trim()} / ${wc.imgCap.trim()})`);
  ok(wc.foldsClosed, 'both groups start folded');
  ok(wc.fieldInFold && wc.imgBtnInFold, 'the real ce-<key> editors + Replace-image live inside the folds');

  console.log(fails ? `MANAGE CHECK FAILED ❌ (${fails})` : 'MANAGE CHECK PASSED ✅');
  await done(fails);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
