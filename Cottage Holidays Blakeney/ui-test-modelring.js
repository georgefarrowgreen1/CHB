// Model-download progress ring, end to end in a real browser:
//  1. reporting progress puts the dock Search knot into ml-loading with a
//     conic-gradient ring sized by --mload, and flips the palette + bar pills
//     to the "Downloading…" state carrying the same ring
//  2. the ring tracks progress updates
//  3. an ACTIVE answer state keeps the pill (the ring only owns the idle slot),
//     and clearing the active state hands the pill back to the ring
//  4. completion clears the ring everywhere and returns the pills to rest
const { boot } = require('./ui-test-lib'); // pins TZ=Europe/London at require time
let fails = 0;
const ok = (b, m) => { console.log(`  ${b ? '✓' : '✗'} ${m}`); if (!b) fails++; };

(async () => {
  const { page, browser, base, done } = await boot({ viewport: { width: 1280, height: 900 } });
  await page.route(/\.php/, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, bookings: [], events: [], logs: {}, results: [], threads: [], enquiries: [], reviews: [], photos: [], value: null, properties: [], seasons: {}, occupancy: {} }) }));
  await page.goto(`${base}/index.html`, { waitUntil: 'networkidle' });
  await page.evaluate(async () => { isAuthenticated = true; document.body.classList.add('owner-mode'); await window.loadAdminBundle(); });
  // Pin the real model loads off so the assertions own the ring deterministically.
  await page.evaluate(() => { DARKSTAR.st = DARKSTAR.st || { pinned: true }; CHB_ENC.failed = true; });
  await page.evaluate(() => openCmdK()); await page.waitForTimeout(400);

  // 1) Progress on → ring on the dock knot + the SEARCH PAGE's logo in the
  //    loading state (ring around the knot; the hover title carries the words).
  await page.evaluate(() => chbModelLoadProgress('enc', 0.4));
  let st = await page.evaluate(() => {
    const dock = document.querySelector('.admin-dock-btn[data-act="openCmdK"]');
    const ring = dock ? getComputedStyle(dock, '::before') : null;
    const bar = document.querySelector('#cmdk-ml');
    const barRing = bar ? getComputedStyle(bar, '::before') : null;
    return {
      cls: dock && dock.classList.contains('ml-loading'),
      mload: dock && dock.style.getPropertyValue('--mload'),
      conic: !!(ring && /conic-gradient/.test(ring.backgroundImage)),
      barState: bar && bar.dataset.mstate,
      barTitle: bar ? bar.title : '',
      barConic: !!(barRing && /conic-gradient/.test(barRing.backgroundImage)),
    };
  });
  ok(st.cls, 'dock Search knot enters ml-loading');
  ok(st.mload === '0.4', `dock carries --mload 0.4 (${st.mload})`);
  ok(st.conic, 'dock ring renders as a conic-gradient ::before');
  ok(st.barState === 'loading', `bar logo switches to loading (${st.barState})`);
  ok(/Downloading/.test(st.barTitle || ''), `bar logo's title explains "Downloading…" (${st.barTitle.slice(0, 30)}…)`);
  ok(st.barConic, 'bar logo carries the conic progress ring');

  // 2) The ring tracks progress.
  await page.evaluate(() => chbModelLoadProgress('enc', 0.85));
  const m2 = await page.evaluate(() => document.querySelector('.admin-dock-btn[data-act="openCmdK"]').style.getPropertyValue('--mload'));
  ok(m2 === '0.85', `ring tracks progress updates (--mload ${m2})`);

  // 3) An active answer state keeps the pill; clearing it hands back to the ring.
  st = await page.evaluate(() => {
    const bar = document.querySelector('#cmdk-ml');
    chbSetModelStatus(bar, 'understood');
    const during = bar.dataset.mstate;
    chbModelLoadProgress('enc', 0.9);
    const after = bar.dataset.mstate;
    chbSetModelStatus(bar, '');
    return { during, after, idle: bar.dataset.mstate };
  });
  ok(st.during === 'understood' && st.after === 'understood', 'an active answer state is never overwritten by the ring');
  ok(st.idle === 'loading', `clearing the active state hands the idle slot back to the ring (${st.idle})`);

  // 4) Completion clears everything back to rest.
  st = await page.evaluate(() => {
    chbModelLoadProgress('enc', null);
    const dock = document.querySelector('.admin-dock-btn[data-act="openCmdK"]');
    const bar = document.querySelector('#cmdk-ml');
    return { cls: dock.classList.contains('ml-loading'), mload: dock.style.getPropertyValue('--mload'), barState: bar.dataset.mstate };
  });
  ok(!st.cls && !st.mload, 'completion removes the dock ring + --mload');
  ok(st.barState !== 'loading', `completion returns the pill to rest (${st.barState || 'hidden'})`);

  console.log(fails ? `\n  ${fails} MODEL-RING CHECK(S) FAILED ❌` : '\n  MODEL-RING SUITE PASSED ✅');
  await done(fails);
})();
