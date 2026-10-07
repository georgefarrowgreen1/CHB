// /status — the PUBLIC status page (the approved redesign), driven against the
// REAL server response. There is no database in the harness, so this is the
// DEGRADED state: the one nobody looks at, and the one that has to be honest.
const { bootBrowser } = require('./ui-test-lib'); // pins TZ=Europe/London at require time
let fails = 0;
const ok = (b, m) => { console.log(`  ${b ? '✓' : '✗'} ${m}`); if (!b) fails++; };

(async () => {
  const t = await bootBrowser();
  try {
    for (const scheme of ['dark', 'light']) {
      console.log(`§1 the degraded page (${scheme})`);
      const page = await t.browser.newPage({ viewport: { width: 390, height: 844 }, colorScheme: scheme });
      const errs = [];
      page.on('pageerror', (e) => errs.push(e.message));
      let loads = 0;
      page.on('load', () => loads++);
      await page.goto(`${t.base}/status.php`, { waitUntil: 'load' });
      await page.waitForTimeout(1600);
      const s = await page.evaluate(() => ({
        h1: document.querySelector('h1').textContent,
        bad: document.getElementById('sp-hero').classList.contains('is-bad'),
        title: document.getElementById('sp-title').textContent,
        rows: [...document.querySelectorAll('.row')].map((r) => r.querySelector('.name').textContent + ':' + r.querySelector('.badge').className.split(' ')[1]),
        words: [...document.querySelectorAll('.row .sr-only')].map((e) => e.textContent),
        badgeText: [...document.querySelectorAll('.row .badge')].map((e) => e.textContent.trim()).join(''),
        days: !!document.getElementById('sp-bars'),
        back: document.querySelector('a.back').getAttribute('href'),
        xs: document.documentElement.scrollWidth - innerWidth,
        js: [...document.scripts].some((x) => /status\.js\?v=[0-9a-f]{8}/.test(x.src)),
        ago: document.getElementById('sp-ago').textContent,
        ground: getComputedStyle(document.body).backgroundColor,
      }));
      ok(s.h1 === 'Service status', 'the page is titled Service status');
      ok(s.bad && /aren’t working/.test(s.title), `the verdict says something isn't working ("${s.title}")`);
      ok(s.rows.join() === 'Website:ok,Database:down,Enquiries & bookings:down,Card payments:off,Email:off', `five rows, each in its own state (${s.rows.join(', ')})`);
      ok(s.badgeText === '', 'the badges carry an icon only, no words');
      ok(s.words.join() === 'Working,Not working,Not working,Switched off,Switched off', 'and a screen reader still hears each state');
      ok(!s.days, 'with no history recorded, there is no 30-day card');
      ok(s.back === '/', 'Back to the website goes home');
      ok(s.xs <= 0, `no sideways scroll at 390 (${s.xs})`);
      ok(s.js, 'the script is same-origin and pinned by its content');
      ok(s.ago === 'Checked just now', 'it says when it checked');
      ok(scheme === 'dark' ? s.ground === 'rgb(18, 19, 22)' : s.ground === 'rgb(247, 244, 238)', `the ground follows the visitor's theme (${s.ground})`);
      if (scheme === 'dark') {
        const before = loads;
        await page.click('#sp-again');
        const mid = await page.evaluate(() => ({ c: document.getElementById('sp-hero').classList.contains('is-checking'), t: document.getElementById('sp-title').textContent }));
        ok(mid.c && mid.t === 'Checking…', 'Check again says it is checking');
        await page.waitForFunction((b) => document.readyState === 'complete' && !document.getElementById('sp-hero').classList.contains('is-checking'), before, { timeout: 5000 });
        await page.waitForTimeout(200);
        ok(loads > before, 'and then asks the server again (the page reloads)');
      }
      ok(errs.length === 0, `no page errors (${errs.join(' | ')})`);
      await page.close();
    }
  } catch (e) {
    console.log('  ✗ suite error: ' + e.message);
    fails++;
  }
  console.log(fails ? `\n${fails} FAILED` : '\nALL PUBLIC STATUS CHECKS PASSED');
  await t.done(fails);
})();
