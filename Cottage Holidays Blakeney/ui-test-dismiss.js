// SWIPE TO DISMISS on the Needs-you strip (Today), driven with REAL touch and mouse
// input against the real app:
//   1. what is dismissible — only rows given an identity; a stopped automation is not,
//      and the page says how (a described-by hint, a Delete shortcut, pan-y)
//   2. a short drag springs back and saves nothing; a vertical drag is a scroll
//   3. a full swipe dismisses: the row goes, ONE save of the map under the internal key,
//      an Undo toast, the badge count falls — and the swipe does NOT also open the row
//   4. Undo restores it; a mouse drag and the Delete key reach the same dismissal
//   5. persistence: a dismissal on the BOOT PAYLOAD is honoured at first render, and a
//      dismissal made while amber does not hide the row once it is red
//   6. reduced motion removes the row at once
// The site reckons "today" in UK time, so the process is pinned to Europe/London by
// ui-test-lib at require time, and fixtures are built from relative dates.
const { bootBrowser } = require('./ui-test-lib');
let fails = 0;
const ok = (b, m) => { console.log(`  ${b ? '✓' : '✗'} ${m}`); if (!b) fails++; };

(async () => {
  const t = await bootBrowser();
  const d = (n) => { const x = new Date(); x.setDate(x.getDate() + n); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
  let serverDismissed = {};
  const saves = [];
  // Opening a booking POSTs hub_bundle — the one signal that does not depend on how long
  // the hub takes to paint (a view-class check at 500ms passed with the click guard gone).
  const hubOpens = [];

  // One owner page. `touch` makes it a real touch device so pointer events carry
  // pointerType 'touch' and the browser applies touch-action.
  const ownerPage = async (opts) => {
    const p = await t.browser.newPage(opts);
    // Requests still in flight: a bookings load started before the seed and landing
    // after it empties the fixture mid-gesture (CI: both registers gone, no save,
    // no toast). "Quiet" below needs none in flight, not just a still generation.
    let inflight = 0;
    const isPhp = (q) => /\.php/.test(q.url());
    p.on('request', (q) => { if (isPhp(q)) inflight++; });
    p.on('requestfinished', (q) => { if (isPhp(q)) inflight = Math.max(0, inflight - 1); });
    p.on('requestfailed', (q) => { if (isPhp(q)) inflight = Math.max(0, inflight - 1); });
    p.__quiet = async () => {
      let since = Date.now(), g0 = -1;
      const t0 = Date.now();
      while (Date.now() - t0 < 20000) {
        const g = await p.evaluate(() => window.__chbDataGen || 0);
        if (inflight > 0 || g !== g0) { since = Date.now(); g0 = g; }
        if (Date.now() - since > 700) return;
        await new Promise((r) => setTimeout(r, 100));
      }
    };
    p.on('pageerror', (e) => { console.log('  PAGEERR:', e.message, String(e.stack || '').split('\n').slice(1, 3).join(' |').trim()); fails++; });
    p.on('request', (q) => { if (q.method() === 'POST' && /bookings\.php/.test(q.url()) && /hub_bundle/.test(q.postData() || '')) hubOpens.push(Date.now()); });
    await p.route(/\.php/, (route) => {
      const url = route.request().url();
      const post = route.request().postData() || '';
      let body = {}; try { body = JSON.parse(post || '{}'); } catch (e) {}
      const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
      // Once the page has booted, a background refresh must not replace the fixture:
      // the calendar's own auto-sync (autoSyncIcalBlocks) calls app.js's loadData
      // directly — the window stub in seed() never sees it — and under load it landed
      // mid-swipe, emptying both registers (caught with a stack on the setter). Held
      // from the moment the boot goes quiet, BEFORE the seed: a refetch issued in the
      // gap between the two was the second way in. loadData keeps the last-good copy.
      if (p.__held && /bookings\.php/.test(url) && route.request().method() === 'GET') return;
      if (url.includes('admin-bootstrap.php')) return json({ ok: true, dismissed: serverDismissed });
      // The Inbox's own record ('inbox-state': the line its first open draws) is
      // written in the background on boot — not a dismissal, and not counted here.
      if (url.includes('content.php') && body.action === 'set') { if (body.key !== 'inbox-state') saves.push({ key: body.key, value: body.value }); return json({ ok: true }); }
      return json({ ok: true, bookings: [], enquiries: [], threads: [], reviews: [], photos: [], experiences: [], events: [], logs: {}, content: {}, blocks: [], ranges: [], payments: [], seasons: {}, occupancy: {}, properties: [] });
    });
    await p.addInitScript(() => {
      window.__badge = [];
      try { Object.defineProperty(navigator, 'setAppBadge', { value: (n) => { window.__badge.push(n); return Promise.resolve(); }, configurable: true }); } catch (e) {}
    });
    await p.goto(t.base + '/index.html');
    await p.waitForTimeout(900);
    await p.evaluate(() => { isAuthenticated = true; document.body.classList.add('owner-mode'); });
    await p.evaluate(() => window.loadAdminBundle());
    await p.waitForFunction(() => !!window.__ADMIN_LOADED, null, { timeout: 20000 });
    await p.evaluate(async () => { await loadData(); });
    await p.evaluate(() => window.nav('view-backoffice'));
    // WAIT UNTIL THE APP HAS GONE QUIET before anyone seeds it. nav() starts the back
    // office's own data loads, and on a loaded runner they finish AFTER a fixed 500ms —
    // wiping the seeded bookings out from under the row (measured: bookings 2 → 0 with
    // the row still painted; the same suite failed 3 runs in 3 under CPU load). The data
    // generation is bumped on every completed load, so "unchanged for 700ms" is the state.
    await p.__quiet();
    p.__held = true;
    await p.evaluate(() => {
      window.__anim = 0;
      const o = Element.prototype.animate;
      Element.prototype.animate = function () { if (this.classList && this.classList.contains('ny-row')) window.__anim++; return o.apply(this, arguments); };
    });
    return p;
  };
  // Three duties of the per-entity kind, one that is not: a register due in 3 days
  // (amber), one tomorrow (red), a stopped automation (no identity).
  const seed = (p) => p.evaluate((dates) => {
    const mk = (id, name, inD, outD) => ({ id: 'b' + id, dbId: id, name, email: 'g' + id + '@x.co', checkIn: inD, checkOut: outD, checkInTime: '15:00', checkOutTime: '10:00', adults: 2, children: 0, payment: 'paid', depositPaid: 540, holdStatus: 'none', regUrl: 'https://x/r' + id, regSubmitted: false, regCount: 0, agreedPrice: { total: 540, perNight: 520, nights: 3, txnFee: 20 } });
    Object.keys(dbBookings).forEach((k) => { dbBookings[k] = []; });
    dbBookings.jollyboat = [mk(91, 'Amber Guest', dates.a, dates.a2), mk(92, 'Red Guest', dates.r, dates.r2)];
    enquiries = [];
    __nyCronQuiet = true;
    window.loadData = async () => ({ ok: true, failed: [] }); // nothing may refresh the seed away mid-gesture
    renderNeedsYou();
  }, { a: d(3), a2: d(6), r: d(1), r2: d(4) });
  const rows = (p) => p.evaluate(() => [...document.querySelectorAll('#needs-you-list .ny-row')].map((r) => ({ key: r.getAttribute('data-nykey'), label: (r.querySelector('.ny-label') || {}).textContent })));
  // INSTANT, never smooth: the app sets `scroll-behavior: smooth` on <html>, so a plain
  // scrollIntoView ANIMATES while the rectangle read straight after it is the pre-scroll
  // one — the touch then lands wherever the row is mid-flight. Unloaded runs won that race
  // by luck; the same suite failed 2 runs in 2 under CPU load.
  const box = (p, key) => p.evaluate((k) => { const r = document.querySelector(`.ny-row[data-nykey="${k}"]`); if (!r) return null; r.scrollIntoView({ block: 'center', behavior: 'instant' }); const b = r.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; }, key);
  const gone = (p, key) => p.waitForFunction((k) => !document.querySelector(`.ny-row[data-nykey="${k}"]`), key, { timeout: 15000 }).then(() => true, () => false);
  const toastText = (p) => p.evaluate(() => [...document.querySelectorAll('#app-toasts .toast')].map((e) => e.textContent.replace(/\s+/g, ' ').trim()));
  const touch = async (p, cdp, from, to, steps) => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from.x, y: from.y, id: 1 }] });
    for (let i = 1; i <= steps; i++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from.x + (to.x - from.x) * i / steps, y: from.y + (to.y - from.y) * i / steps, id: 1 }] });
      await p.waitForTimeout(16);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };

  // ============================================================ the phone
  const phone = await ownerPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const cdp = await phone.context().newCDPSession(phone);
  await seed(phone);

  console.log('1. what is dismissible');
  const r0 = await rows(phone);
  ok(r0.length === 3, `the strip holds the cron row and two registers (${r0.map((r) => r.key || 'none').join(', ')})`);
  ok(r0.filter((r) => r.key).map((r) => r.key).sort().join() === 'register:91,register:92', 'the two per-entity rows carry their identity (register:<booking id>)');
  ok(r0.some((r) => !r.key && /automation looks stopped/.test(r.label)), 'the stopped automation carries NONE — it cannot be swiped away');
  const meta = await phone.evaluate(() => {
    const keyed = document.querySelector('.ny-row[data-nykey]');
    const plain = [...document.querySelectorAll('#needs-you-list .ny-row')].find((r) => !r.hasAttribute('data-nykey'));
    const hint = document.getElementById('ny-hint');
    return {
      pan: getComputedStyle(keyed).touchAction, panPlain: getComputedStyle(plain).touchAction,
      desc: keyed.getAttribute('aria-describedby'), keys: keyed.getAttribute('aria-keyshortcuts'), plainDesc: plain.getAttribute('aria-describedby'),
      hint: hint ? hint.textContent : null, hintHidden: hint ? getComputedStyle(hint).position === 'absolute' && hint.getBoundingClientRect().width <= 1 : false,
    };
  });
  ok(meta.pan === 'pan-y', `a dismissible row leaves vertical scrolling to the browser (touch-action: ${meta.pan})`);
  ok(meta.panPlain !== 'pan-y', `…a plain one is untouched (${meta.panPlain})`);
  ok(meta.desc === 'ny-hint' && meta.keys === 'Delete' && !meta.plainDesc, 'a keyed row points at the hint and names its Delete shortcut; a plain row does neither');
  ok(/Swipe left, or press Delete, to dismiss/.test(meta.hint || '') && meta.hintHidden, 'the hint is spoken but not painted (sr-only)');

  console.log('2. a short drag springs back; a vertical drag is a scroll');
  const nBefore = (await rows(phone)).length;
  let b = await box(phone, 'register:91');
  await touch(phone, cdp, { x: b.x + b.w - 40, y: b.y + b.h / 2 }, { x: b.x + b.w - 90, y: b.y + b.h / 2 }, 6);
  await phone.waitForFunction(() => { const r = document.querySelector('.ny-row[data-nykey="register:91"]'); return r && !r.classList.contains('ny-drag') && r.getAnimations().length === 0 && r.style.translate === ''; }, null, { timeout: 15000 }).catch(() => {});
  let b2 = await box(phone, 'register:91');
  ok(!!b2 && Math.abs(b2.x - b.x) < 1.5, `50px is short of the threshold: the row is back where it was (${b2 && b2.x.toFixed(1)} vs ${b.x.toFixed(1)})`);
  ok((await rows(phone)).length === nBefore && saves.length === 0, '…and nothing was dismissed or saved');
  await touch(phone, cdp, { x: b.x + b.w / 2, y: b.y + b.h / 2 }, { x: b.x + b.w / 2 - 12, y: b.y + b.h / 2 - 120 }, 8);
  await phone.waitForTimeout(150);
  ok((await rows(phone)).length === nBefore && saves.length === 0 && !(await toastText(phone)).length, 'a mostly-vertical drag is left to scrolling — nothing dismissed, saved or announced');

  console.log('3. a full swipe dismisses — and does not also open the row');
  b = await box(phone, 'register:91');
  const badgeBefore = await phone.evaluate(() => window.__badge.slice(-1)[0]);
  await touch(phone, cdp, { x: b.x + b.w - 30, y: b.y + b.h / 2 }, { x: b.x + 20, y: b.y + b.h / 2 }, 10);
  ok(await gone(phone, 'register:91'), 'the row leaves the strip');
  await phone.waitForTimeout(250);
  const after = await rows(phone);
  ok(after.length === 2 && !after.some((r) => r.key === 'register:91') && after.some((r) => r.key === 'register:92'), `…and only that row (${after.map((r) => r.key || 'none').join(', ')})`);
  ok(saves.length === 1 && saves[0].key === 'duty-dismissed' && saves[0].value && saves[0].value['register:91'] && saves[0].value['register:91'].sev === 'warn',
    `ONE save, under the internal key, recording it at amber (${JSON.stringify(saves.map((s) => s.key))})`);
  const tt = await toastText(phone);
  ok(tt.some((x) => /Dismissed — Amber Guest/.test(x) && /Undo/.test(x)), `a toast names what was dismissed and offers Undo (${tt[0] || 'none'})`);
  await phone.waitForTimeout(900);
  ok(hubOpens.length === 0, 'dismissing did not also open the booking');
  const badgeAfter = await phone.evaluate(() => window.__badge.slice(-1)[0]);
  ok(typeof badgeAfter === 'number' && badgeAfter === (badgeBefore || 3) - 1, `the Home Screen badge follows the list (${badgeBefore} → ${badgeAfter})`);
  ok(await phone.evaluate(() => document.getElementById('needs-you-count').textContent) === '2', 'the strip\'s own count falls with it');
  ok(await phone.evaluate(() => !document.querySelector('.ny-reveal')), 'the uncovered label is cleaned up');
  ok(await phone.evaluate(() => window.__anim) >= 2, 'the slide-out and the collapse are real animations (the control for the reduced-motion check)');

  console.log('4. Undo; the stopped automation; a tap still opens');
  await phone.evaluate(() => document.querySelector('#app-toasts .toast-action').click());
  await phone.waitForFunction(() => !!document.querySelector('.ny-row[data-nykey="register:91"]'), null, { timeout: 15000 });
  await phone.waitForTimeout(200);
  ok(saves.length === 2 && saves[1].value && !saves[1].value['register:91'], 'Undo brings the row back and saves the removal');
  const cronRow = await phone.evaluate(() => { const r = [...document.querySelectorAll('#needs-you-list .ny-row')].find((x) => !x.hasAttribute('data-nykey')); r.scrollIntoView({ block: 'center', behavior: 'instant' }); const q = r.getBoundingClientRect(); return { x: q.left, y: q.top, w: q.width, h: q.height }; });
  const nSaved = saves.length;
  await touch(phone, cdp, { x: cronRow.x + cronRow.w - 30, y: cronRow.y + cronRow.h / 2 }, { x: cronRow.x + 20, y: cronRow.y + cronRow.h / 2 }, 10);
  await phone.waitForTimeout(500);
  ok((await rows(phone)).length === 3 && saves.length === nSaved, 'swiping the stopped automation does nothing — it stays, and nothing is saved');
  // A ROW WHOSE DUTY WAS RESOLVED WHILE IT SAT THERE (the guest filed the register; the
  // strip has not been told yet). Swiping it must show the truth, not bounce back.
  await phone.evaluate((dt) => {
    dbBookings.jollyboat.push({ id: 'b93', dbId: 93, name: 'Stale Guest', email: 'g93@x.co', checkIn: dt.s, checkOut: dt.s2, checkInTime: '15:00', checkOutTime: '10:00', adults: 2, children: 0, payment: 'paid', depositPaid: 540, holdStatus: 'none', regUrl: 'https://x/r93', regSubmitted: false, regCount: 0, agreedPrice: { total: 540, perNight: 520, nights: 3, txnFee: 20 } });
    renderNeedsYou();
  }, { s: d(2), s2: d(5) });
  await phone.waitForFunction(() => !!document.querySelector('.ny-row[data-nykey="register:93"]'), null, { timeout: 15000 });
  await phone.evaluate(() => { dbBookings.jollyboat = dbBookings.jollyboat.filter((x) => x.dbId !== 93); }); // resolved — and no re-render
  saves.length = 0;
  b = await box(phone, 'register:93');
  await touch(phone, cdp, { x: b.x + b.w - 30, y: b.y + b.h / 2 }, { x: b.x + 20, y: b.y + b.h / 2 }, 10);
  ok(await gone(phone, 'register:93'), 'swiping a stale row refreshes the strip — it does not bounce back');
  ok(saves.length === 0 && (await rows(phone)).length === 3, '…and records nothing: there was nothing left to dismiss');
  // A tap the BROWSER loses (a loaded runner can drop a touch sequence that follows
  // another) is not what this control asks about; a click that ARRIVES and is swallowed
  // is. So count the clicks reaching rows, and re-tap once only if none arrived at all.
  await phone.evaluate(() => { window.__rowClicks = 0; window.addEventListener('click', (e) => { if (e.target instanceof Element && e.target.closest('.ny-row')) window.__rowClicks++; }, true); });
  const tapRow = async () => {
    await phone.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'), null, { timeout: 15000 }).catch(() => {});
    const t = await box(phone, 'register:92');
    await phone.touchscreen.tap(t.x + t.w / 2, t.y + t.h / 2);
    for (let i = 0; i < 100 && !hubOpens.length && !(await phone.evaluate(() => window.__rowClicks)); i++) await phone.waitForTimeout(50);
  };
  await tapRow();
  if (!hubOpens.length && !(await phone.evaluate(() => window.__rowClicks))) await tapRow();
  const opened = await phone.waitForFunction(() => document.getElementById('view-booking-hub').classList.contains('active'), null, { timeout: 15000 }).then(() => true, () => false);
  for (let i = 0; i < 200 && !hubOpens.length; i++) await phone.waitForTimeout(50); // the view flips BEFORE the request is issued
  const tapDiag = opened && hubOpens.length >= 1 ? '' : await phone.evaluate(() => JSON.stringify({ view: (document.querySelector('.page-view.active') || {}).id, toasts: [...document.querySelectorAll('#app-toasts .toast')].map((t) => t.textContent), rows: [...document.querySelectorAll('#needs-you-list .ny-row')].map((r) => r.getAttribute('data-nykey')) }));
  ok(opened && hubOpens.length >= 1, 'a plain TAP on a dismissible row still opens it — and that is the signal the checks above count (the control)' + (tapDiag ? ' — ' + tapDiag + ' opened=' + opened + ' reqs=' + hubOpens.length : ''));
  await phone.close();

  // ============================================================ a mouse, a keyboard
  const desk = await ownerPage({ viewport: { width: 1280, height: 900 } });
  await seed(desk);
  saves.length = 0;
  hubOpens.length = 0; // the phone's tap above was the control; the desk starts from nothing
  console.log('5. a mouse drag, and the Delete key');
  b = await box(desk, 'register:91');
  await desk.mouse.move(b.x + b.w - 40, b.y + b.h / 2);
  await desk.mouse.down();
  for (let i = 1; i <= 12; i++) { await desk.mouse.move(b.x + b.w - 40 - i * 40, b.y + b.h / 2); await desk.waitForTimeout(12); }
  await desk.mouse.up();
  ok(await gone(desk, 'register:91'), 'dragging with a mouse dismisses the same way');
  ok(saves.length === 1 && saves[0].value['register:91'], 'and saves the same record');
  // A TOUCH drag never ends in a click, but a MOUSE drag does — on the very row it
  // started on — so without the guard the swipe would also open the booking. This is
  // the only path that can see it (the touch check in section 3 is true either way).
  await desk.waitForTimeout(900);
  ok(hubOpens.length === 0, 'the click a mouse drag ends in was swallowed — dismissing did not also open the booking');
  b = await box(desk, 'register:92');
  await desk.mouse.move(b.x + b.w - 40, b.y + b.h / 2);
  await desk.mouse.down();
  for (let i = 1; i <= 4; i++) { await desk.mouse.move(b.x + b.w - 40 - i * 12, b.y + b.h / 2); await desk.waitForTimeout(12); }
  await desk.mouse.up();
  await desk.waitForTimeout(500);
  await desk.waitForTimeout(900);
  ok(await desk.evaluate(() => !!document.querySelector('.ny-row[data-nykey="register:92"]')) && hubOpens.length === 0,
    'a short mouse drag springs back and does not open the row either');
  await desk.waitForTimeout(300);
  await desk.evaluate(() => document.querySelector('.ny-row[data-nykey="register:92"]').focus());
  await desk.keyboard.press('Delete');
  ok(await gone(desk, 'register:92'), 'Delete on a focused row dismisses it');
  ok(saves.length === 2 && saves[1].value['register:92'] && saves[1].value['register:92'].sev === 'danger', 'recorded at red, because that is what it was');
  ok(await desk.evaluate(() => { const a = document.activeElement; return !a || a === document.body || !!a.closest('#needs-you-list'); }), 'focus stays in the list (or falls back to the page), never lost to a removed node');
  await desk.close();

  // ============================================================ persistence + reduced motion
  console.log('6. the boot payload is honoured at first render; amber does not hide red');
  serverDismissed = { 'register:91': { sev: 'warn', at: Date.now() }, 'register:92': { sev: 'warn', at: Date.now() } };
  const boot = await ownerPage({ viewport: { width: 390, height: 844 } });
  await seed(boot); // the page's own loadData already adopted serverDismissed from the boot payload
  const k6 = (await rows(boot)).map((r) => r.key).filter(Boolean).sort().join();
  ok(k6 === 'register:92', `dismissed at amber: the amber one stays hidden, the one that is now RED is back (${k6})`);
  serverDismissed = {};
  await boot.close();

  console.log('7. reduced motion');
  const calm = await ownerPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
  await calm.emulateMedia({ reducedMotion: 'reduce' });
  await seed(calm);
  saves.length = 0;
  const cdp2 = await calm.context().newCDPSession(calm);
  b = await box(calm, 'register:91');
  await touch(calm, cdp2, { x: b.x + b.w - 30, y: b.y + b.h / 2 }, { x: b.x + 20, y: b.y + b.h / 2 }, 10);
  ok(await calm.waitForFunction(() => !document.querySelector('.ny-row[data-nykey="register:91"]'), null, { timeout: 15000 }).then(() => true, () => false) && await calm.evaluate(() => window.__anim) === 0,
    'with reduced motion the row is simply gone — not one animation was started (counted, not timed)');
  await calm.close();

  // A data refresh that lands mid-drag must not rebuild the strip under the finger: the
  // row would be pulled away and every later move threw on its detached node.
  console.log('8. a refresh mid-drag waits for the finger');
  const mid = await ownerPage({ viewport: { width: 1280, height: 900 } });
  await seed(mid);
  saves.length = 0;
  b = await box(mid, 'register:91');
  await mid.evaluate(() => { document.querySelector('.ny-row[data-nykey="register:91"]').__mark = 1; });
  await mid.mouse.move(b.x + b.w - 40, b.y + b.h / 2);
  await mid.mouse.down();
  for (let i = 1; i <= 4; i++) { await mid.mouse.move(b.x + b.w - 40 - i * 30, b.y + b.h / 2); await mid.waitForTimeout(12); }
  const held = await mid.evaluate(() => { renderNeedsYou(); const r = document.querySelector('.ny-row[data-nykey="register:91"]'); return !!(r && r.__mark); });
  ok(held, 'a render that lands mid-drag leaves the dragged row in place');
  // Far enough that DISTANCE decides it (past 35% of the row, measured from where the
  // drag took hold). At 1280 the row is ~1100px, and a fixed 12 steps reached only
  // 330px, so the dismissal rested on the drag also being fast enough to count as a
  // flick, which a loaded runner is not (main failed this 4 runs in 4 under load).
  const last = Math.max(12, Math.ceil((b.w * 0.5) / 30) + 2);
  for (let i = 5; i <= last; i++) { await mid.mouse.move(b.x + b.w - 40 - i * 30, b.y + b.h / 2); await mid.waitForTimeout(12); }
  await mid.mouse.up();
  ok(await gone(mid, 'register:91') && saves.length === 1, '…and the swipe still ends in its dismissal');
  ok(await mid.evaluate(() => !document.querySelector('.ny-row[data-nykey="register:91"]') && !!document.querySelector('.ny-row[data-nykey="register:92"]')), 'the deferred render ran once the finger lifted');
  await mid.close();

  console.log(fails ? `DISMISS SUITE FAILED ❌ (${fails})` : 'DISMISS SUITE PASSED ✅');
  await t.done(fails);
})().catch((e) => { console.error('FAILED:', e); process.exit(1); });
