// MANAGE → STATUS, driven in a real browser (the approved redesign).
//
// What is worth driving rather than unit-testing (test-status.php owns the
// warning verdicts): the ring STATES the verdict the checks give, the reveal
// ticks through to that verdict and never claims it early, the week's day bars
// narrow the list, every check lands in exactly one system and is counted, the
// switched-off extras route to their page, and "Check again" asks the server
// again rather than replaying the last answer.
const { bootBrowser, d } = require('./ui-test-lib'); // pins TZ=Europe/London at require time
let fails = 0;
const ok = (b, m) => { console.log(`  ${b ? '✓' : '✗'} ${m}`); if (!b) fails++; };

const CHECKS_OK = [
  { category: 'Core', label: 'Database', status: 'ok', detail: 'Connected.' },
  { category: 'Migrations', label: 'Locked price snapshot', status: 'ok', detail: 'Columns present.' },
  { category: 'Email', label: 'Outgoing email (SMTP)', status: 'ok', detail: 'Ready.' },
  { category: 'Notifications', label: 'Web push (owner & guest alerts)', status: 'ok', detail: '2 devices.' },
  { category: 'Payments', label: 'Card payments (Square)', status: 'ok', detail: 'Live.' },
  { category: 'Payments', label: 'Automatic payment updates', status: 'ok', detail: 'Connected.' },
  { category: 'Data', label: 'Booking prices', status: 'ok', detail: 'All coherent.' },
  { category: 'Automation', label: 'Daily jobs (cron)', status: 'ok', detail: 'Last ran today.' },
  { category: 'Security', label: 'Security headers', status: 'ok', detail: 'Present.' },
  { category: 'Integrations', label: 'Tide data (WorldTides)', status: 'optional', detail: 'No key (optional). The tide widget stays hidden.' },
];
const CHECKS_WARN = CHECKS_OK.map((c) => (c.label === 'Daily jobs (cron)' ? { ...c, status: 'fail', detail: 'Last ran 4 days ago.', hint: 'Check the host scheduler.' } : c));
const today = d(0);
const INS = {
  issues: { warn7d: 4 },
  automation: { lastRun: today + ' 03:02:00', jobs: 11, recentFails: 0, days: [1, 1, 1, 1, 1, 1, 1] },
  ical: { feeds: 2, blocks: 10, lastImport: today + ' 09:00:00', recentErrors: 0, days: [4, 4, 4, 4, 4, 4, 4], cottages: 2,
    list: [{ cottage: 'Jollyboat', source: 'airbnb', ok: true, at: today + ' 09:00:00', events: 3 }, { cottage: 'Pimpernel', source: 'booking', ok: true, at: today + ' 09:00:00', events: 1 }] },
  email: { fails7d: 0, sent7d: 31, days: [2, 5, 3, 6, 4, 7, 4] },
  backup: { at: d(-2) + ' 03:00:00', bytes: 1400000, encrypted: true, days: [0, 0, 0, 0, 1, 0, 0] },
  storage: { dbBytes: 2000000, uploadsBytes: 150000000, grew30d: 6000000 },
  week: {
    days: [-6, -5, -4, -3, -2, -1, 0].map((o, i) => ({ date: d(o), label: ['Thu', 'Fri', 'Sat', 'Sun', 'Mon', 'Tue', 'Wed'][i], n: [1, 0, 0, 0, 0, 3, 0][i] })),
    groups: [
      { action: 'csp.violation', title: 'A browser blocked something on the site', verdict: 'No action — usually an old copy of the app', needs: false, n: 3, byDay: [1, 0, 0, 0, 0, 2, 0] },
      { action: 'email.gaveup', title: 'An email gave up after retrying', verdict: 'Needs you — the guest didn’t get it', needs: true, n: 1, byDay: [0, 0, 0, 0, 0, 1, 0] },
    ],
    total: 4, needs: 1,
  },
};

async function open(browser, base, { checks, width = 390, dark = true, reduced = false }) {
  const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: reduced ? 'reduce' : 'no-preference' });
  page.on('pageerror', (e) => { console.log('  PAGEERR:', e.message); fails++; });
  await page.addInitScript((dk) => { if (navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(() => {}); try { localStorage.setItem('chb-theme', dk ? 'dark' : 'light'); } catch (e) {} }, dark);
  const runs = { n: 0 };
  await page.route(/\.php/, (route) => {
    const url = route.request().url();
    const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (url.includes('diagnostics.php')) {
      let b = {}; try { b = JSON.parse(route.request().postData() || '{}'); } catch (e) {}
      if (b.action === 'test_email') return json({ ok: true, to: 'owner@example.com' });
    }
    if (url.includes('migrate.php')) return json({ ok: true, migrations: [{ file: 'migration-130.sql', status: 'already applied' }, { file: 'migration-131.sql', status: 'already applied' }] });
    if (url.includes('email-samples.php')) return json({ ok: true, sent: 38, to: 'owner@example.com', results: [] });
    if (url.includes('webp-backfill.php')) return json({ ok: false, error: 'GD is not installed on the host.' });
    if (url.includes('diagnostics.php')) { runs.n++; return json({ ok: true, summary: {}, checks: page.__checks || checks, mail_ready: true, insights: INS }); }
    if (route.request().method() === 'POST') {
      let b = {}; try { b = JSON.parse(route.request().postData() || '{}'); } catch (e) {}
      if (b.action === 'admin_status') return json({ ok: true, admin: true });
      return json({ ok: true, events: [], logs: {}, content: {} });
    }
    return json({ ok: true, bookings: [], enquiries: [], blocks: [], content: {}, properties: [], seasons: {}, occupancy: {}, payments: [], years: [] });
  });
  await page.goto(`${base}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  await page.evaluate(() => { isAuthenticated = true; document.body.classList.add('owner-mode'); });
  await page.evaluate(() => window.loadAdminBundle());
  await page.waitForTimeout(500);
  await page.evaluate(async () => { await openArea(); settingsOpen('diagnostics'); });
  // The reveal has finished when the hero no longer carries is-revealing.
  await page.waitForFunction(() => { const h = document.getElementById('sp-hero'); return h && !h.classList.contains('is-revealing') && !h.classList.contains('is-checking'); }, null, { timeout: 8000 });
  return { page, runs };
}

(async () => {
  const t = await bootBrowser();
  const shots = process.env.CHB_SHOTS || '';
  try {
    console.log('§1 all clear — the ring, the verdict, the vitals');
    let { page, runs } = await open(t.browser, t.base, { checks: CHECKS_OK });
    const s1 = await page.evaluate(() => {
      const hero = document.getElementById('sp-hero');
      const arc = document.getElementById('sp-arc');
      return {
        tone: hero.className, title: document.getElementById('sp-htitle').textContent, sub: document.getElementById('sp-hsub').textContent,
        off: parseFloat(arc.style.strokeDashoffset), vitals: [...document.querySelectorAll('.sp-vital .sp-vcap span:first-child')].map((e) => e.textContent),
        bars: document.querySelectorAll('.sp-vital .sp-vbar').length, need: document.querySelectorAll('.sp-need').length,
        off2: [...document.querySelectorAll('.sp-off .sp-sysname')].map((e) => e.textContent),
        xs: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });
    ok(/is-ok/.test(s1.tone) && s1.title === 'All systems running', `the hero says it plainly ("${s1.title}")`);
    ok(s1.sub === '9 checks passed', `…and counts what passed, never the switched-off one ("${s1.sub}")`);
    ok(s1.off === 0, `the ring is full (${s1.off})`);
    ok(s1.vitals.join('|') === 'Daily jobs|Calendars|Email|Backups', `four vitals (${s1.vitals.join(', ')})`);
    ok(s1.bars === 28, `each carries a seven-day trace (${s1.bars} bars)`);
    ok(s1.need === 0, 'nothing in Needs a look');
    ok(s1.off2.join() === 'Tide data', `the optional extra is under Switched off, named without "(optional)" (${s1.off2.join()})`);
    ok(s1.xs <= 0, `no sideways scroll at 390 (${s1.xs})`);
    await page.waitForTimeout(1200);
    if (shots) await page.screenshot({ path: shots + '/status-dark.png', fullPage: true });

    console.log('§2 everything checked — one system each, counted');
    const s2 = await page.evaluate(() => [...document.querySelectorAll('.sp-sys')].map((s) => ({ k: s.getAttribute('data-k'), badge: s.querySelector('.sp-badge').textContent.trim(), n: s.querySelectorAll('.sp-item').length })));
    ok(s2.map((s) => s.k).join() === 'pay,mail,cal,auto,site', `five systems in order (${s2.map((s) => s.k).join()})`);
    const total = s2.filter((s) => s.k !== 'cal').reduce((n, s) => n + s.n, 0);
    ok(total === 9, `every counted check lands in exactly one system (${total} of 9)`);
    ok(s2.find((s) => s.k === 'cal').badge === '✓ 2', `Calendars lists the feeds themselves (${s2.find((s) => s.k === 'cal').badge})`);
    ok(s2.find((s) => s.k === 'pay').badge === '✓ 3', `Payments carries Square, its updates and the booking prices (${s2.find((s) => s.k === 'pay').badge})`);
    await page.click('.sp-sys[data-k="mail"] .sp-syshead');
    await page.waitForTimeout(400);
    const s2b = await page.evaluate(() => { const f = document.querySelector('.sp-sys[data-k="mail"] .sp-fold'); const b = document.querySelector('.sp-sys[data-k="mail"] .sp-syshead'); return { hidden: f.hidden, exp: b.getAttribute('aria-expanded'), h: f.getBoundingClientRect().height, other: document.querySelector('.sp-sys[data-k="pay"] .sp-fold').hidden }; });
    ok(!s2b.hidden && s2b.exp === 'true' && s2b.h > 40, `a system opens to its checks (${s2b.h}px)`);
    ok(s2b.other, 'and the others stay closed');
    await page.click('.sp-sys[data-k="mail"] .sp-syshead');
    await page.waitForTimeout(400);
    ok(await page.evaluate(() => document.querySelector('.sp-sys[data-k="mail"] .sp-fold').hidden), 'a second tap closes it');

    console.log('§3 this week — the verdicts, and a day narrows the list');
    const w1 = await page.evaluate(() => ({ title: document.querySelector('.sp-wtitle').textContent, sub: document.querySelector('.sp-wsub').textContent, rows: [...document.querySelectorAll('.sp-issue .sp-cnt')].map((e) => e.textContent), first: document.querySelector('.sp-ititle').textContent }));
    ok(w1.title === '4 warnings this week', `the week's count (${w1.title})`);
    ok(/^1 needs you/.test(w1.sub), `…and how many need the owner ("${w1.sub}")`);
    ok(w1.first === 'An email gave up after retrying', 'what needs you leads the list');
    await page.click('.sp-day:nth-child(1)');
    const w2 = await page.evaluate(() => ({ title: document.querySelector('.sp-wtitle').textContent, rows: [...document.querySelectorAll('.sp-issue .sp-cnt')].map((e) => e.textContent), pressed: document.querySelector('.sp-day:nth-child(1)').getAttribute('aria-pressed'), sub: document.querySelector('.sp-wsub').textContent }));
    ok(w2.title === '1 warning on Thu' && w2.rows.join() === '×1' && w2.pressed === 'true', `tapping Thu narrows to that day (${w2.title}; ${w2.rows.join()})`);
    ok(w2.sub === 'None need you', `…and re-judges it ("${w2.sub}")`);
    await page.click('.sp-day:nth-child(1)');
    ok(await page.evaluate(() => document.querySelector('.sp-wtitle').textContent) === '4 warnings this week', 'tapping again shows the whole week');

    console.log('§4 check again asks the server and reveals the new answer');
    page.__checks = CHECKS_WARN;
    const before = runs.n;
    await page.click('#sp-again');
    const mid = await page.evaluate(() => document.getElementById('sp-hero').className);
    await page.waitForFunction(() => { const h = document.getElementById('sp-hero'); return h && !h.classList.contains('is-revealing') && !h.classList.contains('is-checking'); }, null, { timeout: 8000 });
    const s4 = await page.evaluate(() => ({ tone: document.getElementById('sp-hero').className, title: document.getElementById('sp-htitle').textContent, off: parseFloat(document.getElementById('sp-arc').style.strokeDashoffset), need: [...document.querySelectorAll('.sp-need .sp-nlabel')].map((e) => e.textContent), auto: document.querySelector('.sp-sys[data-k="auto"] .sp-badge').textContent.trim(), fix: !!document.querySelector('#diagnostics-body [data-act="runSelfRepair"]') }));
    ok(runs.n === before + 1, `one fresh run (${runs.n - before})`);
    ok(/is-checking|is-revealing/.test(mid), `the hero says it is checking while it does (${mid})`);
    ok(/is-bad/.test(s4.tone) && s4.title === '1 issue needs you', `the new verdict ("${s4.title}")`);
    ok(s4.off > 0 && s4.off < 214, `the ring is short by what failed (${s4.off})`);
    ok(s4.need.join() === 'Daily jobs (cron)' && s4.fix, 'the failure is under Needs a look, with Fix safe issues');
    ok(s4.auto === '✕ 1', `its system wears it too (${s4.auto})`);
    await page.close();

    console.log('§5 reduced motion — the answer, no reveal; light theme');
    ({ page } = await open(t.browser, t.base, { checks: CHECKS_OK, dark: false, reduced: true }));
    const s5 = await page.evaluate(() => ({ cls: document.getElementById('sp-hero').className, off: parseFloat(document.getElementById('sp-arc').style.strokeDashoffset), bar: getComputedStyle(document.querySelector('.sp-vbar')).transform, mark: getComputedStyle(document.querySelector('.sp-rmark')).opacity }));
    ok(!/is-revealing/.test(s5.cls) && s5.off === 0, `lands on the verdict at once (${s5.off})`);
    ok(s5.bar === 'none' && s5.mark === '1', `nothing is held at its starting frame by a delay (bar ${s5.bar}, mark ${s5.mark})`);
    if (shots) await page.screenshot({ path: shots + '/status-light.png', fullPage: true });
    await page.click('.sp-off button');
    await page.waitForTimeout(400);
    ok(await page.evaluate(() => { const s = document.getElementById('sec-apis'); return !!s && s.style.display !== 'none'; }), 'Turn on opens the page that switches it on');
    await page.close();

    console.log('§7 tools — grouped rows, each reporting its own result');
    ({ page } = await open(t.browser, t.base, { checks: CHECKS_OK }));
    await page.click('.sp-tsum');
    const t1 = await page.evaluate(() => ({ caps: [...document.querySelectorAll('.sp-tbody .sp-cap')].map((e) => e.textContent.trim()), rows: [...document.querySelectorAll('.sp-tool')].map((r) => r.getAttribute('data-tool')), subs: [...document.querySelectorAll('.sp-tool .sp-tsub')].every((e) => e.textContent.trim().length > 10), h: Math.min(...[...document.querySelectorAll('.sp-tbtn')].map((b) => b.getBoundingClientRect().height)) }));
    ok(t1.caps.join('|') === 'Keep it healthy|Email checks', `two groups (${t1.caps.join(', ')})`);
    ok(t1.rows.join() === 'fix,mig,webp,test,samples,digest,reply', `seven tools in order (${t1.rows.join()})`);
    ok(t1.subs, 'every tool says what it does');
    ok(t1.h >= 44, `every row is a 44px target (${t1.h})`);
    await page.click('.sp-tool[data-tool="test"] .sp-tbtn');
    await page.waitForFunction(() => document.querySelector('.sp-tool[data-tool="test"]').classList.contains('is-done'), null, { timeout: 5000 });
    const t2 = await page.evaluate(() => { const r = document.querySelector('.sp-tool[data-tool="test"]'); const res = r.querySelector('.sp-tres'); return { text: res.textContent, hidden: res.hidden, below: res.getBoundingClientRect().top >= r.querySelector('.sp-tbtn').getBoundingClientRect().bottom - 8, label: r.querySelector('.sp-sysname').textContent, other: document.querySelector('.sp-tool[data-tool="mig"] .sp-tres').hidden }; });
    ok(!t2.hidden && /owner@example\.com/.test(t2.text), `the result lands under its own row ("${t2.text}")`);
    ok(t2.below && t2.label === 'Send a test email', 'beneath the row, which keeps its name');
    ok(t2.other, "and no other row's result opens");
    await page.click('.sp-tool[data-tool="mig"] .sp-tbtn');
    await page.waitForFunction(() => document.querySelector('.sp-tool[data-tool="mig"]').classList.contains('is-done'), null, { timeout: 5000 });
    ok(/Already up to date — 2 updates applied/.test(await page.evaluate(() => document.querySelector('.sp-tool[data-tool="mig"] .sp-tres').textContent)), 'Install updates says it is up to date');
    await page.click('.sp-tool[data-tool="webp"] .sp-tbtn');
    await page.waitForFunction(() => document.querySelector('.sp-tool[data-tool="webp"]').classList.contains('is-bad'), null, { timeout: 5000 });
    ok(/GD is not installed/.test(await page.evaluate(() => document.querySelector('.sp-tool[data-tool="webp"] .sp-tres').textContent)), "a refusal is said in the server's words, on its row");
    await page.click('.sp-tool[data-tool="samples"] .sp-tbtn');
    await page.waitForSelector('#glass-dialog.open, #glass-dialog[open], .glass-dialog.open', { timeout: 3000 }).catch(() => {});
    await page.evaluate(() => { const b = [...document.querySelectorAll('#glass-dialog button')].find((x) => /cancel/i.test(x.textContent)); if (b) b.click(); });
    await page.waitForTimeout(300);
    ok(await page.evaluate(() => { const r = document.querySelector('.sp-tool[data-tool="samples"]'); return !r.classList.contains('is-busy') && r.querySelector('.sp-tres').hidden; }), 'backing out of the samples confirm sends nothing and says nothing');
    if (shots) await page.screenshot({ path: shots + '/tools.png', fullPage: true });
    await page.close();

    console.log('§6 wide');
    ({ page } = await open(t.browser, t.base, { checks: CHECKS_OK, width: 1280 }));
    const s6 = await page.evaluate(() => { const v = [...document.querySelectorAll('.sp-vital')].map((e) => Math.round(e.getBoundingClientRect().top)); return { oneRow: new Set(v).size === 1, n: v.length }; });
    ok(s6.n === 4 && s6.oneRow, 'the four vitals sit on one row');
    if (shots) await page.screenshot({ path: shots + '/status-wide.png', fullPage: true });
    await page.close();
  } catch (e) {
    console.log('  ✗ suite error: ' + e.message);
    fails++;
  }
  console.log(fails ? `\n${fails} FAILED` : '\nALL STATUS CHECKS PASSED');
  await t.done(fails);
})();
