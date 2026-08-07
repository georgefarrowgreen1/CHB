// Guest account screens on a phone (guest-app shell): the ✕ close row must sit
// aligned inside the panel (class rule, not clipped by desktop negative margins)
// and every action — password button, Log Out — must be scrollable clear of the
// floating dock (clearance lives INSIDE .modal-box; iOS ignores the scroll
// container's own bottom padding for scroll extent).
// The site reckons "today" in UK time (todayDashed / ukNowParts), so the
// tests must too — pin the whole process (and the browser it launches) to
// Europe/London so fixtures built from new Date() agree with the app on
// any runner, in any timezone. Must run before the first Date call.
const { bootBrowser } = require('./ui-test-lib'); // pins TZ=Europe/London at require time
let fails = 0;
const ok = (b, m) => { console.log(`  ${b ? '✓' : '✗'} ${m}`); if (!b) fails++; };

(async () => {
  const { browser, base, done } = await bootBrowser();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  page.on('pageerror', (e) => { console.log('  PAGEERR:', e.message); fails++; });
  await page.addInitScript(() => { if (navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(() => {}); });
  await page.route(/\.php/, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, bookings: [], enquiries: [], threads: [], reviews: [], photos: [], experiences: [], events: [], logs: {}, content: {}, blocks: [], ranges: [], payments: [], seasons: {}, occupancy: {}, properties: [] }) }));

  await page.goto(`${base}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  await page.evaluate(() => {
    currentGuest = { email: 'guest@example.com', name: 'Test Guest', phone: '', address: '', postcode: '' };
    document.body.classList.add('guest-app');
  });

  for (const [label, openFn, modalId] of [
    ['Your details', 'openGuestDetailsModal', 'guest-details-modal'],
    ['Account & Security', 'openGuestSecurityModal', 'guest-security-modal'],
  ]) {
    console.log(`== ${label} (#${modalId}) ==`);
    await page.evaluate((fn) => window[fn](), openFn);
    await page.waitForTimeout(500);
    const r = await page.evaluate((id) => {
      const overlay = document.getElementById(id);
      const box = overlay.querySelector('.modal-box');
      const row = box.querySelector('.auth-close-row');
      const btn = row && row.querySelector('button');
      const rowCs = row ? getComputedStyle(row) : null;
      overlay.scrollTop = 0;
      const br = btn ? btn.getBoundingClientRect() : null; // measure ✕ at the TOP
      // then scroll fully to the bottom and measure the LAST button
      overlay.scrollTop = overlay.scrollHeight;
      const btns = [...box.querySelectorAll('button')].filter((b) => b.offsetParent !== null);
      const last = btns[btns.length - 1];
      const lr = last.getBoundingClientRect();
      const dock = document.getElementById('guest-dock');
      const dockTop = dock && getComputedStyle(dock).display !== 'none' ? dock.getBoundingClientRect().top : window.innerHeight;
      const boxPad = parseFloat(getComputedStyle(box).paddingBottom);
      overlay.scrollTop = 0;
      return {
        hasRow: !!row, rowMargin: rowCs ? rowCs.margin : '', overlayVisible: getComputedStyle(overlay).display !== 'none',
        closeVisible: br ? br.top >= 0 && br.right <= window.innerWidth && br.width >= 24 : false,
        lastLabel: last.textContent.trim().slice(0, 24), lastBottom: Math.round(lr.bottom), dockTop: Math.round(dockTop), boxPad,
      };
    }, modalId);
    ok(r.overlayVisible, 'opens as a full page');
    ok(r.hasRow, 'close row uses .auth-close-row (class, not inline style)');
    ok(r.rowMargin === '0px 0px 6px', `mobile margin override applies (${r.rowMargin})`);
    ok(r.closeVisible, '✕ button fully inside the panel, not clipped');
    // The menu moved into the header, so the box no longer reserves ~124px for a
    // dock at the BOTTOM — it just needs an end-of-scroll margin so the last
    // action isn't flush against the screen edge.
    ok(r.boxPad >= 32, `end-of-scroll margin inside the box (padding-bottom ${r.boxPad}px)`);
    ok(r.lastBottom <= r.dockTop - 8, `last action "${r.lastLabel}" scrolls fully into view (${r.lastBottom} vs ${r.dockTop})`);
    // What replaces the old dock-clearance check, and matters more: this screen is
    // full-bleed and opaque, so if it covered the menu the guest would be stuck
    // here. Hit-test the menu's real position — the header must win.
    const escapable = await page.evaluate(() => {
        const btn = document.querySelector('#guest-dock-slot .guest-dock-btn');
        if (!btn) return { ok: false, why: 'no menu button in the header' };
        const b = btn.getBoundingClientRect();
        const hit = document.elementFromPoint(Math.round(b.left + b.width / 2), Math.round(b.top + b.height / 2));
        return { ok: !!(hit && (hit === btn || btn.contains(hit) || hit.closest('#guest-dock-slot'))), why: hit ? hit.className || hit.tagName : 'nothing' };
    });
    ok(escapable.ok, `the header menu is still tappable over this full-page screen (hit: ${escapable.why})`);
    if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/guest-${modalId}.png` });
    await page.evaluate((id) => document.getElementById(id).classList.remove('active'), modalId);
  }

  // Desktop regression: the same modals as floating windows must not gain the
  // huge bottom padding (the rule is gated to body.guest-app).
  console.log('== Desktop (no guest-app shell) regression ==');
  const desk = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await desk.route(/\.php/, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, bookings: [], enquiries: [], threads: [], reviews: [], photos: [], experiences: [], events: [], logs: {}, content: {}, blocks: [], ranges: [], payments: [], seasons: {}, occupancy: {}, properties: [] }) }));
  await desk.goto(`${base}/index.html`, { waitUntil: 'domcontentloaded' });
  await desk.waitForTimeout(1000);
  const dpad = await desk.evaluate(() => {
    currentGuest = { email: 'g@e.com', name: 'G', phone: '', address: '', postcode: '' };
    openGuestDetailsModal();
    return parseFloat(getComputedStyle(document.querySelector('#guest-details-modal .modal-box')).paddingBottom);
  });
  ok(dpad < 60, `desktop modal-box keeps its normal padding (${dpad}px)`);

  // ── BACK CLOSES THE SHEET, IT DOES NOT LEAVE THE PAGE ──────────────────────
  // On a phone, Back is how people close things. Four guest overlays pushed a
  // history entry and consumed it; eight full-page sheets never got the
  // treatment — so Back left the sheet up AND silently switched the page
  // underneath to the homepage, including the photo lightbox (the highest-traffic
  // guest tap on the site). NOTHING in the whole suite drove page.goBack() before
  // this, which is why eight of them could sit broken.
  console.log('\n4. Back closes the top sheet and stays put');
  const sheets = ['lightbox', 'faq-modal', 'reviews-modal', 'welcome-modal',
    'guest-details-modal', 'guest-security-modal', 'exp-suggest-modal', 'photo-upload-modal'];
  for (const id of sheets) {
    // A previous iteration's Back can still be settling, and app.js is re-evaluated
    // on any load — wait for the globals rather than guessing at a delay.
    // Reload to a known state each time: Back has just moved history, and app.js
    // is re-evaluated on load, so wait for its globals rather than guessing.
    await page.goto(`${base}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof openProperty === 'function' && typeof nav === 'function');
    await page.waitForTimeout(500);
    await page.evaluate(async (i) => {
      currentGuest = { email: 'g@e.com', name: 'G', phone: '', address: '', postcode: '' };
      if (i === 'lightbox') { openProperty('jollyboat'); openLightbox(0); }
      else if (i === 'faq-modal') openFaqModal('jollyboat');
      else if (i === 'reviews-modal') openAllReviews('jollyboat');
      else if (i === 'welcome-modal') await openWelcomeBook('jollyboat');
      else if (i === 'guest-details-modal') openGuestDetailsModal();
      else if (i === 'guest-security-modal') openGuestSecurityModal();
      else if (i === 'exp-suggest-modal') openExperienceSuggest();
      else if (i === 'photo-upload-modal') openPhotoUpload('jollyboat');
    }, id);
    await page.waitForTimeout(450);
    const before = await page.evaluate((i) => ({
      up: !!(document.getElementById(i) || {}).classList?.contains('open'),
      view: (document.querySelector('.page-view.active') || {}).id || '',
    }), id);
    if (!before.up) { ok(false, `${id} did not open — fixture problem, not a Back problem`); continue; }
    // A MARKER A RELOAD WOULD WIPE. Without this the check is VACUOUS: with the
    // history entry missing, Back leaves index.html entirely, the page comes back
    // fresh with the sheet shut and the view restored, and both assertions below
    // pass while the guest has actually been thrown off the page. Break-tested.
    await page.evaluate(() => { window.__backProbe = 'alive'; });
    await page.goBack();
    await page.waitForTimeout(500);
    const after = await page.evaluate((i) => ({
      stillOpen: !!(document.getElementById(i) || {}).classList?.contains('open'),
      view: (document.querySelector('.page-view.active') || {}).id || '',
      sameDocument: window.__backProbe === 'alive',
    }), id);
    ok(after.sameDocument, `…without navigating away from the page (#${id})`);
    ok(!after.stillOpen, `Back closes #${id}`);
    // The invariant is that the page UNDERNEATH does not move — asserted against
    // the view that was up, not a literal, because a reload legitimately restores
    // the screen the guest was on (the chb-nav resume feature).
    ok(after.view === before.view, `…and leaves the page beneath alone (${before.view} → ${after.view})`);
    await page.evaluate(() => { try { closeTopOverlay(); } catch (e) {} });
    await page.waitForTimeout(250);
  }

  console.log(fails ? `GUEST-MODAL TEST FAILED ❌ (${fails})` : 'GUEST-MODAL TEST PASSED ✅');
  await done(fails);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
