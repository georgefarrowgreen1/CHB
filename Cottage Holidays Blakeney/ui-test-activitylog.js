// MANAGE → ACTIVITY LOG (the approved redesign), driven in a real browser.
// What it holds: the week card and its day filter, "Needs a look" said in plain
// words with Seen it posting the real ids, five icon tabs whose counts agree with
// the rows they show, the log grouped by day with a run of one kind folded into
// ×N, a row opening to its detail, the search lighting its words, and the
// filter line's way back to everything.
const { bootBrowser, d } = require('./ui-test-lib'); // pins TZ=Europe/London at require time
let fails = 0;
const ok = (b, m) => { console.log(`  ${b ? '✓' : '✗'} ${m}`); if (!b) fails++; };

const EV = [
  { id: 30, action: 'deploy.done', type: 'system', label: 'Website update completed (build b2)', detail: '', at: d(0) + ' 20:07:00', actor: 'system', severity: 'info', prop_key: '' },
  { id: 29, action: 'deploy.done', type: 'system', label: 'Website update completed (build b1)', detail: '', at: d(0) + ' 19:40:00', actor: 'system', severity: 'info', prop_key: '' },
  { id: 28, action: 'server.error', type: 'system', label: 'Server error in diagnostics.php — Failed opening required status-lib.php', nice: 'A server error', verdict: 'Worth a look — the log has the details', detail: '', at: d(0) + ' 19:20:00', actor: 'system', severity: 'warn', prop_key: '' },
  { id: 27, action: 'payment.card', type: 'payment', label: 'Card payment £340.00 — Sarah Pemberton', detail: 'Balance', at: d(0) + ' 14:12:00', actor: 'guest', severity: 'info', prop_key: 'jollyboat', entity: 'booking', entity_id: 7 },
  { id: 26, action: 'ical.sync', type: 'calendar', label: 'External calendars refreshed (4 cottages)', detail: '', at: d(-1) + ' 18:01:00', actor: 'owner', severity: 'info', prop_key: '' },
  { id: 25, action: 'email.sent', type: 'comms', label: 'Arrival email sent to Tom Wren', detail: '', at: d(-1) + ' 09:30:00', actor: 'cron', severity: 'info', prop_key: 'pimpernel' },
];
const SUM = {
  ok: true, total: 9, days: [6, 5, 4, 3, 2, 1, 0].map((o, i) => ({ date: d(-o), n: [1, 0, 2, 0, 1, 2, 4][i], warn: o === 0 ? 1 : 0 })),
  needs: [{ title: 'A server error', why: 'Worth a look — the log has the details', tech: 'Server error in diagnostics.php', at: d(0) + ' 19:20:00', ids: [28], n: 1 }],
};

(async () => {
  const t = await bootBrowser();
  try {
    const page = await t.browser.newPage({ viewport: { width: 390, height: 900 }, colorScheme: 'dark' });
    page.on('pageerror', (e) => { console.log('  PAGEERR:', e.message); fails++; });
    await page.addInitScript(() => { if (navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(() => {}); try { localStorage.setItem('chb-theme', 'dark'); } catch (e) {} });
    const posts = [];
    await page.route(/\.php/, (route) => {
      const url = route.request().url();
      let b = {}; try { b = JSON.parse(route.request().postData() || '{}'); } catch (e) {}
      const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
      if (url.includes('activity-log.php')) {
        posts.push(b);
        if (b.action === 'summary') return json(SUM);
        if (b.action === 'seen') return json({ ok: true, seen: (b.ids || []).length });
        const q = String(b.q || '').toLowerCase();
        return json({ ok: true, events: EV.filter((e) => !q || (e.label + ' ' + e.detail).toLowerCase().includes(q)) });
      }
      if (b.action === 'admin_status') return json({ ok: true, admin: true });
      return json({ ok: true, events: [], logs: {}, content: {}, bookings: [], enquiries: [], blocks: [], properties: [], seasons: {}, occupancy: {} });
    });
    await page.goto(`${t.base}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(900);
    await page.evaluate(() => { isAuthenticated = true; document.body.classList.add('owner-mode'); });
    await page.evaluate(() => window.loadAdminBundle());
    await page.waitForTimeout(400);
    await page.evaluate(() => nav('view-activity-log'));
    await page.waitForSelector('#act-log-list .al-item', { timeout: 6000 });
    await page.waitForTimeout(900);

    console.log('§1 the week, and what needs a look');
    const w = await page.evaluate(() => ({ bars: document.querySelectorAll('#al-week .al-wbar').length, big: document.querySelector('.al-wbig b').textContent, cap: document.querySelector('#al-week .st-cap').textContent, need: document.querySelector('.al-need b').textContent, warnDots: document.querySelectorAll('#al-week .al-wbar i b').length }));
    ok(w.bars === 7 && w.big === '9 events', `seven days and the week's total (${w.bars}, ${w.big})`);
    ok(/1 needs a look/.test(w.cap), `the capsule says what needs a look ("${w.cap}")`);
    ok(w.need === 'A server error', `the warning is said in plain words ("${w.need}")`);
    ok(w.warnDots === 1, 'the day it happened carries a warning dot');

    console.log('§2 the tabs and the log');
    const l = await page.evaluate(() => ({
      tabs: [...document.querySelectorAll('#act-log-filters .al-tab')].map((b) => b.getAttribute('aria-label')),
      svgs: document.querySelectorAll('#act-log-filters .al-tab svg').length,
      days: [...document.querySelectorAll('.al-day .al-cap span:first-child')].map((e) => e.textContent),
      titles: [...document.querySelectorAll('.al-item .al-title')].map((e) => e.textContent.trim()),
      times: [...document.querySelectorAll('.al-item .al-time')].map((e) => e.textContent),
      xs: document.documentElement.scrollWidth - innerWidth,
    }));
    ok(l.tabs.join('|') === 'All, 6|Bookings, 1|Money, 1|Messages, 1|System, 3', `five icon tabs, each counting what it holds (${l.tabs.join(' / ')})`);
    ok(l.svgs === 5, 'each tab is an icon');
    ok(l.days.join() === 'Today,Yesterday', `the log is grouped by day (${l.days.join(', ')})`);
    ok(l.titles[0] === 'Website update completed (build b2) ×2', `a run of one kind folds into one row (${l.titles[0]})`);
    ok(l.titles.includes('A server error'), 'a warning row speaks plainly too');
    ok(l.times[0] === '20:07', `each row leads with its time (${l.times[0]})`);
    ok(l.xs <= 0, `no sideways scroll at 390 (${l.xs})`);
    await page.click('#act-log-filters [data-tab="money"]');
    await page.waitForTimeout(450);
    const m = await page.evaluate(() => ({ titles: [...document.querySelectorAll('.al-item .al-title')].map((e) => e.textContent.trim()), line: document.getElementById('al-filterline').textContent, pressed: document.querySelector('[data-tab="money"]').getAttribute('aria-pressed'), i: getComputedStyle(document.getElementById('act-log-filters')).getPropertyValue('--al-i').trim() }));
    ok(m.titles.length === 1 && /Sarah Pemberton/.test(m.titles[0]), `the Money tab shows the payment (${m.titles.join(', ')})`);
    ok(m.pressed === 'true' && m.i === '2', 'the pill slides to it');
    ok(/Showing 1 · Money/.test(m.line), `and the line says what is showing ("${m.line}")`);
    await page.click('.al-item .al-row');
    await page.waitForTimeout(350);
    const o = await page.evaluate(() => { const it = document.querySelector('.al-item'); return { exp: it.querySelector('.al-row').getAttribute('aria-expanded'), hidden: it.querySelector('.al-fold').hidden, facts: [...it.querySelectorAll('.al-facts span')].map((e) => e.textContent), link: (it.querySelector('.al-link') || {}).textContent }; });
    ok(o.exp === 'true' && !o.hidden, 'a row opens to its detail');
    ok(o.facts.includes('Guest') && o.facts.some((f) => /^Today \d\d:\d\d$/.test(f)), `with who and when (${o.facts.join(', ')})`);
    ok(/Open the booking/.test(o.link || ''), 'and the way to the booking');
    await page.click('#al-filterline button');
    await page.waitForTimeout(300);
    ok(await page.evaluate(() => document.getElementById('al-filterline').hidden && document.querySelectorAll('.al-item').length === 5), 'Show everything puts it all back');

    console.log('§3 search, a day, and Seen it');
    await page.fill('#act-log-search', 'arrival');
    await page.waitForTimeout(800);
    const s = await page.evaluate(() => ({ n: document.querySelectorAll('.al-item').length, mark: (document.querySelector('.al-title mark') || {}).textContent, clear: !document.querySelector('.al-clear').hidden }));
    ok(s.n === 1 && s.mark === 'Arrival', `the search narrows and lights its word ("${s.mark}")`);
    ok(s.clear, 'with a way to clear it');
    await page.click('.al-clear');
    await page.waitForTimeout(800);
    await page.click('#al-week .al-wbar:nth-child(6)');
    await page.waitForTimeout(300);
    const dd = await page.evaluate(() => ({ days: [...document.querySelectorAll('.al-day .al-cap span:first-child')].map((e) => e.textContent), on: document.querySelector('#al-week .al-wbar:nth-child(6)').getAttribute('aria-pressed') }));
    ok(dd.on === 'true' && dd.days.join() === 'Yesterday', `tapping a day narrows the log to it (${dd.days.join()})`);
    await page.click('#al-week .al-wbar:nth-child(6)');
    await page.click('.al-seen');
    await page.waitForTimeout(600);
    const seen = posts.find((p) => p.action === 'seen');
    ok(seen && JSON.stringify(seen.ids) === '[28]', `Seen it posts the warning's ids (${seen && JSON.stringify(seen.ids)})`);
    ok(await page.evaluate(() => document.getElementById('al-needs').hidden && /Nothing needs you/.test(document.querySelector('#al-week .st-cap').textContent)), 'and the card clears, the capsule saying so');
    if (process.env.CHB_SHOTS) {
      await page.evaluate(() => { activityLogState.sum.needs = [{ title: 'A server error', why: 'Worth a look — the log has the details', tech: 'Server error in diagnostics.php', ids: [28], n: 1 }]; alPaintNeeds(); alPaintWeek(); });
      await page.screenshot({ path: process.env.CHB_SHOTS + '/actlog.png', fullPage: true });
    }
    await page.close();
  } catch (e) {
    console.log('  ✗ suite error: ' + e.message);
    fails++;
  }
  console.log(fails ? `\n${fails} FAILED` : '\nALL ACTIVITY LOG CHECKS PASSED');
  await t.done(fails);
})();
