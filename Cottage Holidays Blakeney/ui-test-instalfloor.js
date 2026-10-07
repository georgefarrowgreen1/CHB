// Manage → Payments → the MONTHLY-OFFER FLOOR, in a real browser.
//  1. the setting renders from the stored internal key (the bacs-details rule:
//     adminPrivateContent first) — the switch shows the saved cut-off and the
//     ladder draws its line. This is the "control that could not appear" class
//     of check: it drives settingsOpen('payments'), never the renderer direct.
//  2. tapping "Any time" SAVES AS IT CHANGES (no Save button) and the line goes
//  3. tapping "3 mo+" posts 3 through the classified key, and the ladder +
//     mirror adopt it.
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
    sel: (document.querySelector('#instal-floor [data-v].is-on') || { dataset: {} }).dataset.v,
    line: (document.querySelector('#instal-ladder .apfl-line span') || {}).textContent || '',
    rungs: document.querySelectorAll('#instal-ladder .apfl-rung').length,
    dims: document.querySelectorAll('#instal-ladder .apfl-rung.is-dim').length,
  }));
  ok(s.shown, 'the Payments section opens');
  ok(s.sel === '2', `the switch shows the STORED cut-off, read off the internal key (${s.sel})`);
  ok(/Your cut-off · 2 months/i.test(s.line), `the ladder draws the floor line (${s.line})`);
  ok(s.rungs === 4 && s.dims === 2, `rungs above the line live, beneath it dimmed (${s.rungs} rungs, ${s.dims} dim)`);

  // 2) Tapping "Any time" saves at once and the ladder drops its line.
  await page.click('#instal-floor [data-v="0"]');
  await page.waitForTimeout(300);
  const off = await page.evaluate(() => ({
    line: !!document.querySelector('#instal-ladder .apfl-line'),
    dims: document.querySelectorAll('#instal-ladder .apfl-rung.is-dim').length,
  }));
  const saved0 = posts.filter((p) => p.__url === 'content.php' && p.action === 'set' && p.key === 'instalment-floor-months').pop();
  ok(!off.line && off.dims === 1, `"Any time" shows no line (${off.dims} dim)`);
  ok(!!saved0 && saved0.value === 0, `…and saved itself, no Save button (${saved0 && JSON.stringify(saved0.value)})`);
  ok(!(await page.$('[data-act="saveInstalFloor"]')), 'there is no separate Save for the cut-off');

  // 3) Tapping "3 mo+" posts 3 through the classified key and re-renders.
  await page.click('#instal-floor [data-v="3"]');
  await page.waitForTimeout(400);
  const saved = posts.filter((p) => p.__url === 'content.php' && p.action === 'set' && p.key === 'instalment-floor-months').pop();
  ok(!!saved && saved.value === 3, `the cut-off posts through the classified key (${saved && JSON.stringify(saved.value)})`);
  const after = await page.evaluate(() => ({
    line: (document.querySelector('#instal-ladder .apfl-line span') || {}).textContent || '',
    mirror: adminPrivateContent['instalment-floor-months'],
    pressed: (document.querySelector('#instal-floor [data-v="3"]') || { getAttribute: () => '' }).getAttribute('aria-pressed'),
    savedMark: (document.getElementById('pay-floor-saved') || {}).textContent || '',
  }));
  ok(/3 months/i.test(after.line) && after.mirror === 3 && after.pressed === 'true', `…and the ladder, mirror and switch adopt it (${after.line})`);
  ok(/Saved/.test(after.savedMark), `a "Saved ✓" says so beside the caption (${after.savedMark})`);

  await done(fails);
})();
