// Guest account screens on a phone (guest-app shell): the ✕ close row must sit
// aligned inside the panel (class rule, not clipped by desktop negative margins)
// and every action — password button, Log Out — must be scrollable clear of the
// floating dock (clearance lives INSIDE .modal-box; iOS ignores the scroll
// container's own bottom padding for scroll extent).
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const PORT = 8233;
let fails = 0;
const ok = (b, m) => { console.log(`  ${b ? '✓' : '✗'} ${m}`); if (!b) fails++; };

(async () => {
  const server = spawn('php', ['-S', `127.0.0.1:${PORT}`, '-t', __dirname], { stdio: 'ignore' });
  // Wait for php -S to actually accept connections (a fixed sleep flakes on slow CI runners).
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://127.0.0.1:${PORT}/index.html`)).ok) break; } catch (e) {} await new Promise((r) => setTimeout(r, 250)); }
  const browser = await chromium.launch(process.env.CHB_CHROMIUM ? { executablePath: process.env.CHB_CHROMIUM } : {});
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  page.on('pageerror', (e) => { console.log('  PAGEERR:', e.message); fails++; });
  await page.addInitScript(() => { if (navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(() => {}); });
  await page.route(/\.php/, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, bookings: [], enquiries: [], threads: [], reviews: [], photos: [], experiences: [], events: [], logs: {}, content: {}, blocks: [], ranges: [], payments: [], seasons: {}, occupancy: {}, properties: [] }) }));

  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
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
    ok(r.boxPad >= 124, `dock clearance is inside the box (padding-bottom ${r.boxPad}px)`);
    ok(r.lastBottom <= r.dockTop - 8, `last action "${r.lastLabel}" scrolls clear of the dock (${r.lastBottom} vs dock ${r.dockTop})`);
    if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/guest-${modalId}.png` });
    await page.evaluate((id) => document.getElementById(id).classList.remove('active'), modalId);
  }

  // Desktop regression: the same modals as floating windows must not gain the
  // huge bottom padding (the rule is gated to body.guest-app).
  console.log('== Desktop (no guest-app shell) regression ==');
  const desk = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await desk.route(/\.php/, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, bookings: [], enquiries: [], threads: [], reviews: [], photos: [], experiences: [], events: [], logs: {}, content: {}, blocks: [], ranges: [], payments: [], seasons: {}, occupancy: {}, properties: [] }) }));
  await desk.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
  await desk.waitForTimeout(1000);
  const dpad = await desk.evaluate(() => {
    currentGuest = { email: 'g@e.com', name: 'G', phone: '', address: '', postcode: '' };
    openGuestDetailsModal();
    return parseFloat(getComputedStyle(document.querySelector('#guest-details-modal .modal-box')).paddingBottom);
  });
  ok(dpad < 60, `desktop modal-box keeps its normal padding (${dpad}px)`);

  await browser.close(); server.kill();
  console.log(fails ? `GUEST-MODAL TEST FAILED ❌ (${fails})` : 'GUEST-MODAL TEST PASSED ✅');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
