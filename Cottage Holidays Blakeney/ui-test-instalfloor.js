// Manage → Payments → the MONTHLY-OFFER FLOOR, in a real browser.
//  1. the setting renders from the stored internal key (the bacs-details rule:
//     adminPrivateContent first) — the select shows the saved floor and the
//     ladder draws its line. This is the "control that could not appear" class
//     of check: it drives settingsOpen('payments'), never the renderer direct.
//  2. browsing the select MOVES the line before saving (data-act-change)
//  3. Save posts the clamped value through the classified key, and the ladder
//     re-renders from the adopted mirror.
// The OFFER the floor gates is server-side (test-autopay §11b); the guest face
// is ui-test-pay's two-way-card case. This suite owns the owner's control.
const { boot } = require('./ui-test-lib'); // pins TZ=Europe/London at require time
let fails = 0;
const ok = (b, m) => { console.log(`  ${b ? '✓' : '✗'} ${m}`); if (!b) fails++; };

(async () => {
  const { page, browser, base, done } = await boot({ viewport: { width: 1000, height: 900 } });
  const posts = [];
  await page.route(/\.php/, (route) => {
    const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (route.request().method() === 'POST') {
      let b = {};
      try { b = JSON.parse(route.request().postData() || '{}'); } catch (e) {}
      b.__url = route.request().url().split('/').pop().split('?')[0];
      posts.push(b);
      // The admin content GET — the INTERNAL key arrives here, never on the
      // anonymous boot GET, which is exactly what the mirror read must survive.
      if (b.__url === 'content.php' && b.action === 'get_all') return json({ ok: true, content: { 'instalment-floor-months': 2 } });
      return json({ ok: true });
    }
    return json({ ok: true, bookings: [], enquiries: [], threads: [], reviews: [], photos: [], events: [], logs: {}, content: {}, properties: [], seasons: {}, occupancy: {} });
  });
  await page.goto(`${base}/index.html`, { waitUntil: 'networkidle' });
  await page.evaluate(async () => { isAuthenticated = true; document.body.classList.add('owner-mode'); await window.loadAdminBundle(); });
  await page.waitForTimeout(300);

  // 1) Open Manage → Payments the way the owner does.
  await page.evaluate(() => { adminPrivateContent['instalment-floor-months'] = 2; nav('view-settings'); settingsOpen('payments'); });
  await page.waitForTimeout(400);
  const s = await page.evaluate(() => ({
    shown: (document.getElementById('sec-payments') || { style: {} }).style.display !== 'none',
    sel: (document.getElementById('instal-floor') || {}).value,
    line: (document.querySelector('#instal-ladder .apfl-line span') || {}).textContent || '',
    rungs: document.querySelectorAll('#instal-ladder .apfl-rung').length,
    dims: document.querySelectorAll('#instal-ladder .apfl-rung.is-dim').length,
  }));
  ok(s.shown, 'the Payments section opens');
  ok(s.sel === '2', `the select shows the STORED floor, read off the internal key (${s.sel})`);
  ok(/Your floor · 2 months/i.test(s.line), `the ladder draws the floor line (${s.line})`);
  ok(s.rungs === 4 && s.dims === 2, `rungs above the line live, beneath it dimmed (${s.rungs} rungs, ${s.dims} dim)`);

  // 2) Browsing the select moves the line BEFORE saving.
  await page.evaluate(() => {
    const sel = document.getElementById('instal-floor');
    sel.value = '';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForTimeout(200);
  const off = await page.evaluate(() => ({
    line: !!document.querySelector('#instal-ladder .apfl-line'),
    dims: document.querySelectorAll('#instal-ladder .apfl-rung.is-dim').length,
  }));
  ok(!off.line && off.dims === 1, `"whenever a plan fits" previews with no line (${off.dims} dim)`);

  // 3) Save posts the value through the classified key and re-renders.
  await page.evaluate(() => {
    const sel = document.getElementById('instal-floor');
    sel.value = '3';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.click('[data-act="saveInstalFloor"]');
  await page.waitForTimeout(400);
  const saved = posts.filter((p) => p.__url === 'content.php' && p.action === 'set' && p.key === 'instalment-floor-months').pop();
  ok(!!saved && saved.value === 3, `Save posts the floor through the classified key (${saved && JSON.stringify(saved.value)})`);
  const after = await page.evaluate(() => ({
    line: (document.querySelector('#instal-ladder .apfl-line span') || {}).textContent || '',
    mirror: adminPrivateContent['instalment-floor-months'],
  }));
  ok(/3 months/i.test(after.line) && after.mirror === 3, `…and the ladder + mirror adopt it (${after.line})`);

  await done(fails);
})();
