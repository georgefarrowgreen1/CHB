// MANAGE'S STATUS + the calendar-feeds verdict list, in a real browser:
//  §1 the status is ONE pill beside the title (no card, no second pill, no
//     banner); a stalled feed and a review are rows under "Needs a look", read
//     from the SAME stores the badges read (bootstrap cron/feeds, __nyMod, chbMissList)
//  §2 the pill follows the stores both ways and is the worst row: the system
//     check as a row (never repeating stopped daily jobs), grey when nothing
//     answered, hidden from a limited person
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
  // The system check behind the status pill: clean, unless a case says otherwise.
  const diagFix = { ok: true, summary: { ok: 20, warn: 0, fail: 0, optional: 3 }, checks: [{ category: 'Automation', label: 'Daily jobs (cron)', status: 'ok' }] };
  const gstPosts = []; let calOvFix = null; let calListFix = null; let calSyncHold = false; const calPosts = [];
  await page.route(/\.php/, (route) => {
    const url = route.request().url();
    const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    let b = {}; try { b = JSON.parse(route.request().postData() || '{}'); } catch (e) {}
    if (url.includes('diagnostics.php')) return json(diagFix);
    if (url.includes('admin-bootstrap.php')) return json({
      ok: true,
      cron: { stale: false, everRan: true, ageHours: 5 },
      feeds: feedsStalled
        ? [{ pk: '21a', name: '21A Westgate', ageHours: 0.4, failing: 0 }, { pk: 'jollyboat', name: 'Jollyboat', ageHours: 74, failing: 0 }]
        : [{ pk: '21a', name: '21A Westgate', ageHours: 0.4, failing: 0 }, { pk: 'jollyboat', name: 'Jollyboat', ageHours: 0.6, failing: 0 }],
    });
    if (url.includes('reviews.php')) return json({ ok: true, reviews: [{ id: 1, status: 'pending', prop: '21a', name: 'Margaret', text: 'Lovely.' }] });
    if (url.includes('waitlist.php')) return json({ ok: true, waitlist: [
      { id: 1, prop_key: '21a', name: 'Sarah Pemberton', email: 'sarah@example.com', check_in: '2026-08-14', check_out: '2026-08-18', notified_at: null },
      { id: 2, prop_key: 'jollyboat', name: 'Priya Patel', email: 'priya@example.com', check_in: null, check_out: null, notified_at: '2026-08-09 10:00:00' },
    ]});
    if (url.includes('auth.php') && b.action === 'guest_crm') return json({ ok: true, guests: [
      { name: 'Debbie McGoldrick', email: 'debbie@example.com', stays: 4, ltv: 2840, last_stay: '2026-06-10', fav_prop: 'jollyboat', repeat: true, has_account: true },
      { name: 'Tom Harding', email: 'tom@example.com', stays: 1, ltv: 440, last_stay: '2026-04-02', fav_prop: '21a', repeat: false, has_account: false },
    ]});
    if (url.includes('auth.php') && (b.action === 'guest_reinvite' || b.action === 'guest_send_reset')) { gstPosts.push(b); return json(b.action === 'guest_send_reset' ? { ok: true, until: '19:22' } : { ok: true }); }
    if (url.includes('photos.php')) return json({ ok: true, photos: [] });
    if (url.includes('experiences.php')) return json({ ok: true, experiences: [] });
    if (url.includes('ical-import.php')) {
      calPosts.push(b);
      if (b.action === 'list' && calListFix) return json(calListFix);
      // The server's rule: a save adds or replaces the links it names and keeps the rest;
      // unlinking one is its own action.
      if (b.action === 'save_feeds' && calListFix) {
        for (const f of (b.feeds || []).filter((x) => x.url)) calListFix.feeds = calListFix.feeds.filter((x) => x.source !== f.source).concat([f]);
        return json({ ok: true });
      }
      if (b.action === 'unlink_feed' && calListFix) { calListFix.feeds = calListFix.feeds.filter((x) => x.source !== b.source); return json({ ok: true }); }
      if (b.action === 'overview' && calOvFix) return json({ ok: true, props: calOvFix });
      if (b.action === 'sync') {
        if (calOvFix && calSyncHold) return new Promise((res) => setTimeout(res, 500)).then(() => json({ ok: true, result: [{ source: 'airbnb', ok: true, events: 5 }] }));
        return json({ ok: true, imported: 14, result: [{ source: 'airbnb', ok: true, events: 5 }] });
      }
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

  console.log('§1 the landing: ONE status pill, problems unfold beneath it');
  const land = await page.evaluate(() => {
    const host = document.getElementById('manage-verdicts');
    const pill = document.getElementById('health-pill');
    const rows = [...host.querySelectorAll('.mg-probs .mg-wrap:not(.is-gone)')];
    const feed = rows.find((w) => (w.dataset.id || '').startsWith('feed-'));
    return {
      tone: pill.dataset.tone,
      words: pill.textContent,
      shown: pill.getClientRects().length > 0,
      noCard: !host.querySelector('.mg-sum'),
      noExtras: !document.getElementById('cron-pill') && !document.getElementById('cron-alert') && document.querySelectorAll('.settings-head-pills .cron-pill').length === 1,
      foldOpen: !!host.querySelector('.mg-fold.is-open'),
      feedRow: !!feed && /Calendar sync/.test(feed.textContent) && /Jollyboat/.test(feed.textContent),
      feedCap: !!(feed && feed.querySelector('.mg-cap.st-cap.is-warn, .mg-cap.st-cap.is-bad')),
      runSync: !!(feed && feed.querySelector('[data-act="mgRunSync"][data-pk]')),
      opensCal: !!(feed && feed.querySelector('.mg-open[data-act="settingsOpen"]')),
      revRow: rows.some((w) => w.dataset.id === 'rev' && /1 waiting/.test(w.textContent)),
      noGreenPills: !host.querySelector('.st-cap.is-ok'),
      noOldCaps: !host.querySelector('.bhub-grpcap'),
      toolboxIntact: !!document.querySelector('#settings-index .settings-group .settings-row[data-arg="reviews"]'),
      cotRows: document.querySelectorAll('#cottages-overview .settings-row.mg-cot').length,
      addRow: !!document.querySelector('#settings-index [data-act="addAccommodationPrompt"]'),
      // YOUR ACCOUNT LEADS, UNCAPTIONED (owner-asked): the first thing in the index,
      // no heading, the header's own gap under the line and nothing added, "Needs a
      // look" below it, and at this two-column width it spans the top as they do.
      acct: (() => {
        const g = document.getElementById('oa-index-row').closest('.settings-group');
        const r = g.getBoundingClientRect();
        const head = document.querySelector('#view-settings .dashboard-header');
        const first = [...document.getElementById('settings-index').children].find((x) => x.getClientRects().length);
        const prev = g.previousElementSibling;
        const nextCap = [...document.querySelectorAll('#settings-index .settings-section-label')].find((l) => l.getClientRects().length && l.getBoundingClientRect().top > r.bottom);
        return {
          first: first === g,
          uncaptioned: !(prev && prev.classList.contains('settings-section-label')) && ![...document.querySelectorAll('#settings-index .settings-section-label')].some((l) => /your account/i.test(l.textContent)),
          lineGap: Math.round((r.top - head.getBoundingClientRect().bottom) * 10) / 10,
          headGap: parseFloat(getComputedStyle(head).marginBottom),
          capGap: nextCap ? Math.round(nextCap.getBoundingClientRect().top - r.bottom) : -1,
          lookBelow: host.getBoundingClientRect().top >= r.bottom - 1,
          spans: Math.abs(r.width - host.getBoundingClientRect().width) < 1,
        };
      })(),
    };
  });
  ok(land.shown && land.tone === 'warn' && land.words === 'Status: needs a look', `the one pill says something needs a look, its dot amber (${land.tone}: ${land.words})`);
  ok(land.noCard && land.noExtras, 'no summary card, no second pill, no banner: the status is said once');
  ok(land.foldOpen, 'the "Needs a look" list unfolds under it');
  ok(land.feedRow && land.feedCap, 'the stalled feed is a row of its own, wearing a warning capsule');
  ok(land.runSync, 'Run sync is one tap, on the row itself');
  ok(land.opensCal, '…and the row opens the calendar feeds page');
  ok(land.revRow, 'the pending review is its own row, counted (one source: __nyMod)');
  ok(land.noGreenPills && land.noOldCaps, 'no column of green pills, no shouted captions');
  ok(land.toolboxIntact, 'the toolbox rows below are untouched');
  ok(land.cotRows >= 2 && land.addRow, `the cottages are rows in their group's list (${land.cotRows}), ending in Add a cottage`);
  ok(land.acct.first && land.acct.uncaptioned, 'your account is the first thing on Manage, with no heading over it');
  ok(Math.abs(land.acct.lineGap - land.acct.headGap) < 1, `…sitting the header's own gap under the line, nothing added (${land.acct.lineGap}px, header ${land.acct.headGap}px)`);
  ok(land.acct.lookBelow && land.acct.capGap >= 20 && land.acct.capGap <= 26, `"Needs a look" comes after it, its heading at the group gap (${land.acct.capGap}px)`);
  ok(land.acct.spans, 'on two columns it spans the top, as wide as "Needs a look"');
  // At phone width: 18px under the line, and the next heading 22px under the row.
  await page.setViewportSize({ width: 402, height: 874 });
  await page.waitForTimeout(400);
  const onPhone = await page.evaluate(() => {
    const g = document.getElementById('oa-index-row').closest('.settings-group');
    const r = g.getBoundingClientRect();
    const head = document.querySelector('#view-settings .dashboard-header');
    const nextCap = [...document.querySelectorAll('#settings-index .settings-section-label')].find((l) => l.getClientRects().length && l.getBoundingClientRect().top > r.bottom);
    return { lineGap: Math.round(r.top - head.getBoundingClientRect().bottom), capGap: nextCap ? Math.round(nextCap.getBoundingClientRect().top - r.bottom) : -1, cap: nextCap ? nextCap.textContent : '' };
  });
  await page.setViewportSize({ width: 1280, height: 950 });
  await page.waitForTimeout(400);
  // One caption tier (the one look): every caption stands the section gap (24px) above its group.
  ok(onPhone.lineGap === 18 && onPhone.capGap === 24, `on a phone: 18px under the line, "${onPhone.cap}" 24px below (${onPhone.lineGap}px, ${onPhone.capGap}px)`);

  console.log('§2 the pill follows the real stores, both ways');
  feedsStalled = false;
  const down = await page.evaluate(async () => {
    const ab = await apiGet('admin-bootstrap.php');
    window.__cronStatusPre = ab.cron; window.__feedStatusPre = ab.feeds; window.__sigAt = Date.now();
    manageVerdicts();
    await new Promise((r) => setTimeout(r, 300));
    const host = document.getElementById('manage-verdicts');
    return {
      feedGone: ![...host.querySelectorAll('.mg-wrap:not(.is-gone)')].some((w) => (w.dataset.id || '').startsWith('feed-')),
      tone: document.getElementById('health-pill').dataset.tone,
    };
  });
  ok(down.feedGone, 'fresh feeds → the feed row folds away');
  ok(down.tone === 'warn', `…and the pill stays amber for what is left, the review (${down.tone})`);
  const allClear = await page.evaluate(async () => {
    const keep = __nyMod; __nyMod = { rev: 0, ph: 0, exp: 0 };
    const keepM = window.chbMissList, keepG = window.slGuestQuestions;
    window.chbMissList = () => []; window.slGuestQuestions = () => [];
    manageVerdicts();
    await new Promise((r) => setTimeout(r, 500));
    const pill = document.getElementById('health-pill');
    const out = { state: pill.dataset.tone, title: pill.textContent, fold: !!document.querySelector('#manage-verdicts .mg-fold.is-open') };
    __nyMod = keep; window.chbMissList = keepM; window.slGuestQuestions = keepG;
    return out;
  });
  ok(allClear.state === 'ok' && allClear.title === 'Status: all clear', `nothing left → "Status: all clear", its dot green (${allClear.title})`);
  ok(!allClear.fold, '…and the Needs-a-look list folds shut');
  // A problem that arrives AFTER an all-clear open must still PAINT. The review count
  // re-renders the summary on its own, after the access sync has run — and that sync
  // once hid the empty "Needs a look" list, so the row landed inside a hidden group.
  const late = await page.evaluate(async () => {
    const keep = __nyMod, keepM = window.chbMissList, keepG = window.slGuestQuestions;
    window.chbMissList = () => []; window.slGuestQuestions = () => [];
    __nyMod = { rev: 0, ph: 0, exp: 0 };
    applyAreaFilter();
    __nyMod = { rev: 1, ph: 0, exp: 0 };
    manageVerdicts();
    await new Promise((r) => setTimeout(r, 600));
    const row = document.querySelector('#manage-verdicts .mg-wrap[data-id="rev"]:not(.is-gone)');
    const cap = document.querySelector('#manage-verdicts .mg-fold .settings-section-label');
    const out = {
      row: !!row && row.getClientRects().length > 0 && row.getBoundingClientRect().height > 20,
      cap: !!cap && cap.getClientRects().length > 0,
    };
    __nyMod = keep; window.chbMissList = keepM; window.slGuestQuestions = keepG;
    return out;
  });
  ok(late.row && late.cap, 'a problem that arrives after an all-clear open still shows, under its caption');
  // THE PILL IS THE WORST ROW, and every row it counts is on screen. The system
  // check folds in as a row of its own, but never repeats the stopped daily jobs
  // (it fails its own cron check then, which the cron row has already said).
  const states = await page.evaluate(async () => {
    const w = window;
    const keep = { mod: __nyMod, m: w.chbMissList, g: w.slGuestQuestions, cron: w.__cronStatusPre, diag: w.__diagSum, me: w.__me };
    w.chbMissList = () => []; w.slGuestQuestions = () => []; __nyMod = { rev: 0, ph: 0, exp: 0 };
    const look = () => {
      manageVerdicts();
      const pill = document.getElementById('health-pill');
      const ids = [...document.querySelectorAll('#manage-verdicts .mg-wrap:not(.is-gone)')].map((x) => x.dataset.id);
      const sub = (id) => ((document.querySelector(`#manage-verdicts .mg-wrap[data-id="${id}"] .settings-row-sub`) || {}).textContent || '');
      return { tone: pill.dataset.tone, words: pill.textContent, shown: pill.style.display !== 'none', ids, sys: sub('sys'), cron: sub('cron') };
    };
    const settle = () => new Promise((r) => setTimeout(r, 500));
    const out = {};
    w.__diagSum = { fail: 0, warn: 1, cron: 'ok' };
    out.warn = look(); await settle();
    w.__cronStatusPre = { stale: true, everRan: true, ageHours: 50 };
    w.__diagSum = { fail: 1, warn: 0, cron: 'fail' };
    out.stopped = look(); await settle();
    w.__diagSum = { fail: 2, warn: 0, cron: 'fail' };
    out.stoppedPlus = look(); await settle();
    w.__cronStatusPre = keep.cron;
    w.__diagSum = null;
    out.none = look(); await settle();
    delete w.__diagSum;
    out.asking = look(); await settle();
    w.__me = { id: 2, full: false, caps: {} };
    out.limited = look();
    w.__me = keep.me;
    // The real fetch: once a session, and what it says becomes a row.
    sessionStorage.removeItem('chb-health-v2');
    out.fetchBefore = w.__diagSum;
    await checkSystemHealth();
    out.fetched = JSON.stringify(w.__diagSum);
    out.afterFetch = look(); await settle();
    __nyMod = keep.mod; w.chbMissList = keep.m; w.slGuestQuestions = keep.g; w.__diagSum = keep.diag;
    manageVerdicts();
    return out;
  });
  ok(states.warn.tone === 'warn' && states.warn.ids.join() === 'sys' && /1 warning/.test(states.warn.sys), `a system-check warning is its own row, and the pill is amber (${states.warn.ids.join()} · ${states.warn.sys})`);
  ok(states.stopped.tone === 'bad' && states.stopped.words === 'Status: needs fixing' && states.stopped.ids.join() === 'cron', `stopped daily jobs: red, ONE row (${states.stopped.ids.join()})`);
  ok(/won’t send/.test(states.stopped.cron), `…which says what stops working (${states.stopped.cron})`);
  ok(states.stoppedPlus.ids.includes('cron') && states.stoppedPlus.ids.includes('sys') && /1 check failing/.test(states.stoppedPlus.sys), `a second failing check still gets a row of its own (${states.stoppedPlus.sys})`);
  ok(states.none.tone === 'unk' && states.none.words === 'Status: couldn’t check', `the check not answering is grey, never green (${states.none.words})`);
  ok(states.asking.tone === 'wait' && states.asking.words === 'Status: checking…', `…and while it is still asking it says so (${states.asking.words})`);
  ok(!states.limited.shown, 'a limited person gets no pill: they are never sent the system state');
  ok(states.fetchBefore === undefined && /"warn":0/.test(states.fetched) && states.afterFetch.tone === 'ok', `the real check is fetched and folded in (${states.fetched} → ${states.afterFetch.tone})`);
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
    // The cottages are ONE card, as Payments' Needs attention is (owner-asked, superseding the
    // earlier "clear air between the cottages"): one column, every row flush with the next, the
    // card's corners only on the run's ends.
    const cards = list ? [...list.querySelectorAll('.bhub-fold-grp:not(.cal-prob)')] : [];
    const bs = cards.map((el) => el.getBoundingClientRect());
    const gaps = bs.slice(1).map((b, i) => Math.round(b.top - bs[i].bottom));
    const rad = (el, c) => parseFloat(getComputedStyle(el)['border' + c + 'Radius']) || 0;
    return {
      gaps, oneCol: new Set(bs.map((b) => Math.round(b.left))).size === 1,
      ends: cards.length ? [rad(cards[0], 'TopLeft'), rad(cards[0], 'BottomLeft'), rad(cards[cards.length - 1], 'TopLeft'), rad(cards[cards.length - 1], 'BottomLeft')] : [],
      dotName: !!list.querySelector('[data-grp="cal-jollyboat"] .cal-cot .cot-dot') && !list.querySelector('[data-grp="cal-jollyboat"] .prop-tag'),
      grps: list ? list.querySelectorAll('.bhub-fold-grp').length : 0,
      jbWarn: !!list.querySelector('[data-grp="cal-jollyboat"] .st-cap.is-warn .st-wic'),
      a21ok: !!list.querySelector('[data-grp="cal-21a"] .st-cap.is-ok .st-tick'),
      jbSub: (list.querySelector('[data-grp="cal-jollyboat"] .bhub-fold-sub') || {}).textContent || '',
      runInFold: !!list.querySelector('#bhub-fold-cal-jollyboat [data-act="runSync"]'),
      editRoute: !!list.querySelector('#bhub-fold-cal-jollyboat [data-act="settingsOpenCalendar"]'),
    };
  });
  ok(cal.grps >= 2, `every cottage is a verdict group (${cal.grps})`);
  ok(cal.oneCol && cal.gaps.length && cal.gaps.every((g) => g === 0), `…joined into ONE card in one column, no air between rows (${cal.gaps.join(',')})`);
  ok(cal.ends[0] >= 16 && cal.ends[1] === 0 && cal.ends[2] === 0 && cal.ends[3] >= 16, `…the card's corners only on the run's ends (${cal.ends.join('/')})`);
  ok(cal.dotName, 'a cottage row is titled by its dot and name, not a pill');
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

  console.log('§3b calendar sync: the summary, the failing platform first, the fix in place');
  const hAgo = (h) => { const d = new Date(Date.now() - h * 3600000); const z = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())} ${z(d.getHours())}:${z(d.getMinutes())}:00`; };
  const ovBroken = () => ({
    '21a': { feeds: [{ source: 'airbnb', url: 'https://www.airbnb.com/calendar/ical/old.ics' }, { source: 'bookingcom', url: 'https://admin.booking.com/x.ics' }],
      status: { sources: { airbnb: { ok: false, fails: 3, at: hAgo(1), events: 4, ok_at: hAgo(60), error: 'HTTP 404' }, bookingcom: { ok: true, fails: 0, at: hAgo(0.2), events: 3, ok_at: hAgo(0.2), error: '' } } },
      export_url: 'https://example.test/ical-export.php?prop=21a&token=abc' },
    jollyboat: { feeds: [{ source: 'airbnb', url: 'https://www.airbnb.com/calendar/ical/jb.ics' }],
      status: { sources: { airbnb: { ok: true, fails: 0, at: hAgo(0.1), events: 6, ok_at: hAgo(0.1), error: '' } } },
      export_url: 'https://example.test/ical-export.php?prop=jollyboat&token=def' },
  });
  calOvFix = ovBroken();
  // calOvForget is how the app drops its copy (a save does it): a bare null now waits out
  // CAL_OV_RETRY_MS, the wait that stops an empty answer being asked for again at once.
  await page.evaluate(() => { calOvForget(); settingsOpen('calendar'); });
  await page.waitForFunction(() => !!document.querySelector('#calendar-list .cal-prob'), null, { timeout: 4000 }).catch(() => {});
  const c1 = await page.evaluate(() => {
    const L = document.getElementById('calendar-list');
    const pill = document.querySelector('#settings-panel-cap .head-pill');
    return {
      state: pill && pill.dataset.tone, t: pill ? pill.textContent.trim() : '', label: pill ? pill.getAttribute('aria-label') || '' : '', s: (L.querySelector('.cal-sum .mg-s') || {}).textContent || '',
      oldMark: !!L.querySelector('.mg-mark, .mg-t'),
      probs: L.querySelectorAll('.cal-prob').length, probTxt: (L.querySelector('.cal-prob') || {}).textContent || '',
      probRow: !!L.querySelector('.cal-prob.bhub-fold-grp > .bhub-fold-row .st-cap.is-bad'),
      attnCap: [...L.querySelectorAll('.bhub-grpcap.is-attn')].some((c) => /Needs attention/.test(c.textContent) && c.nextElementSibling && c.nextElementSibling.classList.contains('cal-prob')),
      badDot: !!L.querySelector('[data-grp="cal-21a"] .bhub-fold-sub .cal-dot.is-bad'),
      okDot: !!L.querySelector('[data-grp="cal-21a"] .bhub-fold-sub .cal-dot.is-ok'),
      cap21: !!L.querySelector('[data-grp="cal-21a"] .st-cap.is-bad'),
      explain: /flow into your calendar/.test(L.textContent),
    };
  });
  // At phone width the platform rows keep their words on one readable column
  // (the first build squeezed them to a 60px sliver beside a full-width
  // "Replace link" row), and the page title stays on one line beside its pill.
  await page.setViewportSize({ width: 390, height: 1400 });
  await page.evaluate(() => { __bhubOpenFolds.add('cal-21a'); renderCalendarList(); });
  await page.waitForTimeout(400);
  const phone = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#bhub-fold-cal-21a .cal-prow')];
    const t = document.getElementById('settings-panel-title');
    const lh = t ? parseFloat(getComputedStyle(t).lineHeight) || 20 : 20;
    return {
      n: rows.length,
      minMain: Math.min(...rows.map((r) => r.querySelector('.cal-pmain').getBoundingClientRect().width)),
      maxBtn: Math.max(...rows.map((r) => r.querySelector('button').getBoundingClientRect().width)),
      titleLines: t ? Math.round(t.getBoundingClientRect().height / lh) : 0,
      tiles: [...document.querySelectorAll('#bhub-fold-cal-21a .cal-tools button')].map((b) => {
        const sp = b.querySelector('span'), ic = b.querySelector('.ic');
        return { icTop: Math.round(ic.getBoundingClientRect().top), lines: Math.round(sp.getBoundingClientRect().height / (parseFloat(getComputedStyle(sp).lineHeight) || 16)), clipped: sp.scrollWidth > sp.clientWidth + 1, h: Math.round(b.getBoundingClientRect().height) };
      }),
    };
  });
  ok(phone.n === 2 && phone.minMain >= 180, `at 390px each platform's words get a real column (${Math.round(phone.minMain)}px)`);
  ok(phone.maxBtn < 120, `…and Replace stays a small button (${Math.round(phone.maxBtn)}px)`);
  // "Link a platform" left the tools for an add row at the foot of the platform
  // list (the one-look pass) — three tools remain, and the add row is where the
  // platforms are.
  ok(phone.tiles.length === 3 && new Set(phone.tiles.map((x) => x.h)).size === 1 && phone.tiles.every((x) => !x.clipped && x.lines === 1),
    `the fold's three tools are pills of one height, each on one line, none cut off (${JSON.stringify(phone.tiles.map((x) => [x.h, x.lines]))})`);
  ok(await page.evaluate(() => !!document.querySelector('#bhub-fold-cal-21a .cal-plist > .u-addrow')),
    'linking another platform is the add row at the foot of the platform list');
  ok(phone.tiles.every((x) => x.lines === 1 && !x.clipped), 'every tile label sits on one line, uncut');
  await page.screenshot({ path: '/tmp/claude-0/-home-user-CHB/e820a22c-cfa5-5535-94d0-f1835c6df202/scratchpad/cal390c.png', clip: { x: 0, y: 700, width: 390, height: 450 } });
  ok(phone.titleLines === 1, `the page title stays on one line beside its status pill (${phone.titleLines})`);
  await page.setViewportSize({ width: 1280, height: 950 });
  ok(c1.state === 'bad' && /^1 not syncing$/.test(c1.t) && /1 calendar isn.t syncing/.test(c1.label), `the title's status pill names the one failing calendar, red as on Manage (${c1.t})`);
  ok(!c1.oldMark, 'the summary card carries the facts only — no second verdict of its own');
  ok(/2 of 3 cottages linked/.test(c1.s), `…and how many cottages are linked (${c1.s})`);
  ok(c1.probs === 1 && /21A Westgate · Airbnb/.test(c1.probTxt) && /Still using the 4 Airbnb stays/.test(c1.probTxt), 'the failing platform leads, saying what it still has');
  ok(c1.probRow && c1.attnCap, 'the problem is a fold row under the "Needs attention" caption, as on Payments — not a tinted card of its own');
  ok(c1.badDot && c1.okDot && c1.cap21, 'each platform wears its own dot; the cottage reads failing');
  ok(!c1.explain, 'the explanation line is gone');
  // Its fix is inside the fold, as every Needs-attention row's is.
  await page.click('.cal-prob .bhub-fold-row');
  await page.waitForSelector('.cal-prob .u-btn1', { state: 'visible' });
  await page.click('.cal-prob .u-btn1');
  await page.waitForSelector('#cal-link-in');
  await page.fill('#cal-link-in', 'not a link');
  const bad = await page.evaluate(() => ({ dis: document.getElementById('cal-link-go').disabled, hint: document.getElementById('cal-link-hint').className }));
  ok(bad.dis && /is-bad/.test(bad.hint), 'a link that is not a calendar is refused before anything is sent');
  await page.fill('#cal-link-in', 'https://www.airbnb.com/calendar/ical/new.ics');
  ok(await page.evaluate(() => !document.getElementById('cal-link-go').disabled), '…a calendar link enables Save');
  calPosts.length = 0;
  calOvFix = ovBroken(); calOvFix['21a'].status.sources.airbnb = { ok: true, fails: 0, at: hAgo(0), events: 5, ok_at: hAgo(0), error: '' };
  calOvFix['21a'].feeds[0].url = 'https://www.airbnb.com/calendar/ical/new.ics';
  await page.click('#cal-link-go');
  await page.waitForFunction(() => !document.querySelector('#calendar-list .cal-prob'), null, { timeout: 4000 }).catch(() => {});
  const saved = calPosts.find((x) => x.action === 'save_feeds');
  ok(!!saved && saved.feeds.length === 1 && saved.feeds[0].source === 'airbnb' && /new\.ics/.test(saved.feeds[0].url), 'saving sends ONLY that platform’s link (the server keeps the others)');
  ok(calPosts.some((x) => x.action === 'sync' && x.prop === '21a'), '…then syncs it at once');
  const c2 = await page.evaluate(() => ({ probs: document.querySelectorAll('#calendar-list .cal-prob').length, t: ((document.querySelector('#settings-panel-cap .head-pill') || {}).textContent || '').trim(), tone: (document.querySelector('#settings-panel-cap .head-pill') || { dataset: {} }).dataset.tone }));
  ok(c2.probs === 0 && c2.t === 'Up to date' && c2.tone === 'ok', `fixed → the problem card leaves and the pill goes green (${c2.t})`);
  // Sync all walks the cottages, each row showing its own spinner.
  calPosts.length = 0; calSyncHold = true;
  await page.click('#calendar-list [data-act="calSyncAll"]');
  await page.waitForTimeout(250);
  const spin = await page.evaluate(() => document.querySelectorAll('#calendar-list .bhub-fold-grp .st-cap .mg-spin').length);
  ok(spin === 1, `Sync all runs one cottage at a time (${spin} spinning)`);
  await page.waitForFunction(() => !__calSyncAll, null, { timeout: 6000 }).catch(() => {});
  calSyncHold = false;
  const props = calPosts.filter((x) => x.action === 'sync').map((x) => x.prop).sort().join(',');
  ok(props === '21a,jollyboat', `…and syncs every linked cottage (${props})`);
  // Nothing is offered to link while the page doesn't know what is linked: offered
  // blind it picked Airbnb first and replaced a working Airbnb link.
  const blind = await page.evaluate(() => { const keep = __calOv; __calOv = null; __bhubOpenFolds.add('cal-jollyboat'); const h = calListHtml(); __calOv = keep; return /Link a platform/.test(h); });
  ok(!blind, 'Link a platform waits until the server has said what is linked');
  // Link a platform: only the platforms not already linked are offered.
  await page.evaluate(() => { __bhubOpenFolds.add('cal-jollyboat'); calLinkOpen('jollyboat', '', 'add'); });
  await page.waitForSelector('#cal-link-in');
  const seg = await page.evaluate(() => [...document.querySelectorAll('.cal-seg button')].map((b) => b.textContent));
  ok(seg.length === 2 && !seg.includes('Airbnb'), `Link a platform offers only what is not linked (${seg.join(' / ')})`);
  await page.evaluate(() => calLinkCancel());
  calOvFix = null;

  console.log('§3c the cottage sync page: a summary, one row per platform, links checked as you type');
  calListFix = {
    ok: true, blocks: 26, export_url: 'https://example.test/ical-export.php?prop=21a&token=abc',
    feeds: [{ source: 'airbnb', url: 'https://www.airbnb.com/calendar/ical/1.ics' }, { source: 'vrbo', url: 'http://www.vrbo.com/icalendar/ce21.ics' }],
    status: { sources: { airbnb: { ok: true, fails: 0, at: hAgo(0.1), events: 2, ok_at: hAgo(0.1), error: '' }, vrbo: { ok: false, fails: 2, at: hAgo(1), events: 24, ok_at: hAgo(30), error: 'HTTP 500' } } },
  };
  await page.setViewportSize({ width: 390, height: 1400 });
  await page.evaluate(() => settingsOpenCalendar('21a'));
  await page.waitForSelector('#calendar-detail .cal-plat');
  const d1 = await page.evaluate(() => {
    const D = document.getElementById('calendar-detail');
    const plats = [...D.querySelectorAll('.cal-plat')];
    const sec = document.getElementById('sec-calendar');
    return {
      t: ((document.querySelector('#settings-panel-cap .head-pill') || {}).textContent || '').trim(), s: (D.querySelector('.cal-sum .mg-s') || {}).textContent || '',
      n: plats.length, bc: plats[2] ? plats[2].textContent : '', vrboBad: plats[1] ? plats[1].classList.contains('is-bad') : false,
      ids: ['sync-export-21a', 'sync-airbnb-21a', 'sync-vrbo-21a', 'sync-bookingcom-21a'].every((i) => !!document.getElementById(i)),
      prose: /Links save automatically|Share booked dates|How it works/.test(sec.textContent),
      unlinks: D.querySelectorAll('[data-act="calRemoveFeed"]').length,
    };
  });
  ok(/^Vrbo not responding$/.test(d1.t), `the title's pill leads with the failing platform (${d1.t})`);
  ok(/26 stays imported · 2 of 3 platforms linked/.test(d1.s), `…and counts what came in (${d1.s})`);
  ok(d1.n === 3 && d1.vrboBad && /Not linked/.test(d1.bc) && /Booking\.com/.test(d1.bc), 'one row per platform, each with its own state');
  ok(d1.ids && d1.unlinks === 2, 'the fields keep their ids, and only linked platforms can be unlinked');
  ok(!d1.prose, 'the explanation paragraphs are gone');
  await page.screenshot({ path: '/tmp/claude-0/-home-user-CHB/e820a22c-cfa5-5535-94d0-f1835c6df202/scratchpad/caldet390.png', fullPage: true });
  calPosts.length = 0;
  await page.fill('#sync-bookingcom-21a', 'not a link');
  await page.evaluate(() => document.getElementById('sync-bookingcom-21a').blur());
  await page.waitForTimeout(300);
  ok(/is-bad/.test(await page.getAttribute('#cal-hint-bookingcom-21a', 'class')) && !calPosts.some((x) => x.action === 'save_feeds'), 'a link that is not a calendar is flagged and NOT saved');
  await page.fill('#sync-airbnb-21a', '');
  await page.evaluate(() => document.getElementById('sync-airbnb-21a').blur());
  await page.waitForTimeout(300);
  ok((await page.inputValue('#sync-airbnb-21a')) === 'https://www.airbnb.com/calendar/ical/1.ics' && !calPosts.some((x) => x.action === 'save_feeds'), 'emptying a box puts the link back rather than silently unlinking');
  await page.fill('#sync-bookingcom-21a', 'https://admin.booking.com/hotel/ical/9.ics');
  await page.evaluate(() => document.getElementById('sync-bookingcom-21a').blur());
  await page.waitForFunction(() => true);
  await page.waitForTimeout(600);
  const sv = calPosts.find((x) => x.action === 'save_feeds');
  // Only the box that changed is sent: the others hold what this page loaded, which may be
  // out of date, and sending them put an old link back over a newer one.
  ok(!!sv && sv.feeds.length === 1 && sv.feeds[0].source === 'bookingcom', 'a new valid link is saved on its own, the others left as they are…');
  ok(calPosts.filter((x) => x.action === 'save_feeds').length === 1, '…once (the sync that follows does not post the links again)');
  ok(calPosts.some((x) => x.action === 'sync' && x.prop === '21a'), '…and syncs at once');
  calPosts.length = 0;
  await page.evaluate(() => { calRemoveFeed('21a', 'vrbo'); });
  await page.waitForSelector('#glass-dialog-ok');
  await page.click('#glass-dialog-ok');
  await page.waitForTimeout(500);
  const un = calPosts.find((x) => x.action === 'unlink_feed');
  ok(!!un && un.source === 'vrbo' && un.prop === '21a' && !calPosts.some((x) => x.action === 'save_feeds'), 'Unlink asks, then unlinks only that platform');
  calListFix = null;
  await page.setViewportSize({ width: 1280, height: 950 });

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
  ok(/none yet|photo/i.test(cot.photosCap), `the Photos verdict counts the gallery (${cot.photosCap.trim()})`);
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

  console.log('§4b the rates editor: right-rail steppers, live lines quote the MODEL');
  const acr = await page.evaluate(async () => {
    const fold = document.getElementById('bhub-fold-ac-21a-rates');
    const caps = fold.querySelectorAll('.acr-cap').length;
    const steps = fold.querySelectorAll('.acr-step').length;
    // Every stepper is the last child of its row — the right rail.
    const onRail = [...fold.querySelectorAll('.acr-row')].every((row) => {
      const last = row.lastElementChild;
      return last && (last.classList.contains('acr-step') || last.classList.contains('acr-ota'));
    });
    // The + stepper: real dispatcher click, then the mirror, the input and
    // the fold verdict must all agree.
    const plus = [...fold.querySelectorAll('.acr-row')][0].querySelector('.acr-step button:last-child');
    plus.click();
    await new Promise((r) => setTimeout(r, 250));
    const stepped = {
      input: (document.getElementById('acr-21a-coupleRate') || {}).value,
      mirror: propertyRates['21a'].coupleRate,
      fig: ((document.getElementById('ac-fig-21a') || {}).textContent || '').trim(),
      whisper: !!document.querySelector('#ac-saved-21a.on'),
    };
    // The weekend line quotes the REAL engine: nightlyRateFor on a season-less
    // Saturday — equality of DERIVATIONS, not a number written down.
    await acrType('21a', 'weekendPct', 20);
    const wkModel = gbp(nightlyRateFor('2026-08-15', propertyRates['21a'], [])).replace('.00', '');
    const wkSub = (document.getElementById('acr-wk-sub-21a') || {}).textContent || '';
    // The badge is renderLocalGuide's own words, both ways.
    acrOta('21a', '165');
    const bOn = document.getElementById('acr-badge-21a');
    const badgeOn = { text: bOn.textContent, none: bOn.classList.contains('is-none') };
    const badgeWant = `Save ${gbp(165 - propertyRates['21a'].coupleRate)}/night booking direct`;
    acrOta('21a', '50');
    const badgeOff = document.getElementById('acr-badge-21a').classList.contains('is-none');
    // The last-minute pair's shared status flips with BOTH above zero.
    await acrType('21a', 'lastminPct', 15);
    const lmHalf = (document.getElementById('acr-lm-sub-21a') || {}).className;
    await acrType('21a', 'lastminDays', 7);
    const lmEl = document.getElementById('acr-lm-sub-21a');
    const lmOn = { cls: lmEl.className, txt: lmEl.textContent };
    const lmWant = gbp(propertyRates['21a'].coupleRate * 0.85).replace('.00', '');
    // restore
    await acrType('21a', 'weekendPct', 0); await acrType('21a', 'lastminPct', 0);
    await acrType('21a', 'lastminDays', 0); await acrType('21a', 'coupleRate', 130);
    acrOta('21a', '');
    return { caps, steps, onRail, stepped, wkModel, wkSub, badgeOn, badgeWant, badgeOff, lmHalf, lmOn, lmWant };
  });
  ok(acr.caps === 4 && acr.steps === 8, `four captioned wells, eight steppers (${acr.caps}/${acr.steps})`);
  ok(acr.onRail, 'every control sits on the right rail');
  ok(String(acr.stepped.input) === '135' && acr.stepped.mirror === 135, `the + stepper writes the input AND the mirror (${acr.stepped.input}/${acr.stepped.mirror})`);
  ok(/£135/.test(acr.stepped.fig), `the fold verdict follows the couple rate (${acr.stepped.fig})`);
  ok(acr.stepped.whisper, 'a change whispers ✓ Saved');
  ok(acr.wkSub.includes(acr.wkModel), `the weekend line quotes nightlyRateFor's own figure (${acr.wkModel} in "${acr.wkSub}")`);
  ok(acr.badgeOn.text === acr.badgeWant && !acr.badgeOn.none, `the badge is renderLocalGuide's exact string (${acr.badgeOn.text})`);
  ok(acr.badgeOff, 'a lower Airbnb price honestly shows no badge');
  ok(!/is-on/.test(acr.lmHalf) && /is-on/.test(acr.lmOn.cls) && acr.lmOn.txt.includes(acr.lmWant), `the last-minute status arms only with BOTH set, quoting the model (${acr.lmOn.txt})`);

  console.log('§4c every section on the unified anatomy: wells, right rail, real saves');
  const uni = await page.evaluate(async () => {
    siteContent['amenities-21a'] = ['Wood-burning stove', 'Walled courtyard'];
    siteContent['faqs-21a'] = [{ icon: '', q: 'Is there parking?', a: 'One bay outside.' }];
    propertySeasons['21a'] = [{ label: 'School summer', start_date: '2026-07-18', end_date: '2026-09-01', couple_rate: 175 }];
    settingsOpenAccom('21a');
    const detail = document.getElementById('accom-detail');
    // Every rebuilt section renders captioned wells (through the closed folds).
    const welled = ['text', 'amenities', 'house', 'houserules', 'safety', 'seasons', 'arrival', 'location', 'local', 'faq', 'welcome', 'opsnotes'].filter((id) => {
      const f = document.getElementById('bhub-fold-ac-21a-' + id);
      return f && f.querySelector('.acr-cap') && f.querySelector('.acr-well');
    });
    // Verdicts count the loaded stores.
    const cap = (id) => ((detail.querySelector(`[data-grp="ac-21a-${id}"] .st-cap`) || {}).textContent || '').trim();
    const verdicts = { amenities: cap('amenities'), seasons: cap('seasons'), faq: cap('faq') };
    // The house steppers write through the SAME updateRuleField save.
    const minBtn = document.querySelector('#bhub-fold-ac-21a-house .acr-step button:last-child');
    const before = propertyRates['21a'].minNights || 1;
    minBtn.click();
    await new Promise((r) => setTimeout(r, 150));
    const stepped = { mirror: propertyRates['21a'].minNights, input: (document.getElementById('acw-21a-minNights') || {}).value };
    ruleStep('21a', 'minNights', -1);
    // A day chip is a REAL checkbox filling its label — clicking it toggles
    // the arrival-day rule through the existing handler.
    const dayInp = document.querySelectorAll('#bhub-fold-ac-21a-house .acw-days .day-check input')[5];
    const hadFri = (propertyRates['21a'].arrivalDays || []).includes(5);
    dayInp.click();
    await new Promise((r) => setTimeout(r, 120));
    const friFlipped = (propertyRates['21a'].arrivalDays || []).includes(5) !== hadFri;
    dayInp.click();
    // occStep bumps the input ONLY — Save guest limits stays the write.
    const occBefore = (document.getElementById('occ-adults-21a') || {}).value;
    occStep('occ-adults-21a', 1, 1);
    const occ = { bumped: (document.getElementById('occ-adults-21a') || {}).value, mirror: (occupancyLimits['21a'] || { maxAdults: occBefore }).maxAdults };
    occStep('occ-adults-21a', -1, 1);
    // The seasons row quotes the store's own figure, DD/MM/YYYY dates.
    const seasonRow = (document.getElementById('bhub-fold-ac-21a-seasons') || {}).textContent || '';
    // Location's pin capsule tells the truth both ways.
    const pinUnset = ((document.querySelector('[data-grp="ac-21a-location"] ~ * , #bhub-fold-ac-21a-location') && document.getElementById('bhub-fold-ac-21a-location').querySelector('.st-cap.is-unk')) ? 'unk' : 'other');
    return { welled: welled.length, verdicts, stepped, before, friFlipped, occ, occBefore, seasonRow: /School summer/.test(seasonRow) && /£175/.test(seasonRow) && /18\/07\/2026/.test(seasonRow), pinUnset };
  });
  ok(uni.welled === 12, `all twelve rebuilt sections render captioned wells (${uni.welled})`);
  ok(/2 amenities/.test(uni.verdicts.amenities) && /1 season/.test(uni.verdicts.seasons) && /1 answer/.test(uni.verdicts.faq), `the fold verdicts count the loaded stores (${uni.verdicts.amenities} / ${uni.verdicts.seasons} / ${uni.verdicts.faq})`);
  ok(uni.stepped.mirror === uni.before + 1 && String(uni.stepped.input) === String(uni.before + 1), `the min-nights stepper writes the input AND the rule mirror (${uni.stepped.mirror})`);
  ok(uni.friFlipped, 'a day chip click toggles the arrival-day rule through the real checkbox');
  ok(String(uni.occ.bumped) === String(parseInt(uni.occBefore, 10) + 1) && String(uni.occ.mirror) === String(uni.occBefore), 'occupancy steppers bump the input only — Save guest limits stays the write');
  ok(uni.seasonRow, 'the seasons rows quote the store: label, DD/MM/YYYY dates, serif £/night');
  ok(uni.pinUnset === 'unk', 'the location pin capsule reads "Not set" while no pin is stored');

  console.log('§4d photos are a GRID, the home-page card previews the real tile');
  const pb = await page.evaluate(async () => {
    settingsOpenAccom('21a');
    const grid = document.getElementById('accom-photos-21a');
    const cells = grid ? grid.querySelectorAll('.acp-cell') : [];
    const posts = [];
    const origPost = window.apiPost;
    window.apiPost = async (url, body) => { posts.push({ url, body }); return { ok: true }; };
    // The preview follows the inputs through the REAL input dispatcher.
    const ck = cardKeys('21a');
    const tIn = document.getElementById('ce-' + ck.title);
    tIn.value = 'The Flint Loft';
    tIn.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 120));
    const pvLive = (document.getElementById('acw-hc-t-21a') || {}).textContent;
    // Save card posts BOTH keys through contentEditSave.
    await acwCardSave('21a');
    const saved = posts.filter((x) => x.url === 'content.php' && x.body && x.body.action === 'set').map((x) => x.body.key);
    window.apiPost = origPost;
    return {
      gridDisplay: grid ? getComputedStyle(grid).display : '',
      cells: cells.length,
      mainFirst: cells.length ? !!cells[0].querySelector('.acp-main') && !cells[1].querySelector('.acp-main') : false,
      // RE-AIMED (PR2): the four actions were 22px bare glyphs jammed edge to
      // edge with the destructive ✕ 22px from Replace, and at that pitch a 44px
      // hit region overlaps its neighbour by half — so they moved behind ONE ⋯
      // menu (the hub's own bhubMenu). What must hold is the same three
      // data-acts, now inside the OPENED menu, and nothing painted before it.
      hidden: cells.length ? ['accomMovePhoto', 'accomReplacePhoto', 'accomRemovePhoto'].every((fn) => { const el = cells[0].querySelector(`[data-act="${fn}"]`); return el && el.getClientRects().length === 0; }) : false,
      acts: (() => {
        if (!cells.length) return false;
        const btn = cells[0].querySelector('.bhub-menu-btn');
        if (!btn) return false;
        btn.click();
        const menu = cells[0].querySelector('.bhub-menu');
        return !!menu && menu.getClientRects().length > 0
          && ['accomMovePhoto', 'accomReplacePhoto', 'accomRemovePhoto'].every((fn) => menu.querySelector(`[data-act="${fn}"]`));
      })(),
      pvLive,
      saved,
    };
  });
  ok(pb.gridDisplay === 'grid' && pb.cells >= 3, `the gallery is a grid of cells (${pb.cells})`);
  ok(pb.mainFirst, 'MAIN badges the first photo and only the first');
  ok(pb.hidden, 'the four glyph buttons are gone — nothing painted under the thumbnail');
  ok(pb.acts, 'each cell keeps reorder / replace / remove on the real data-acts, inside the ⋯ menu');
  ok(pb.pvLive === 'The Flint Loft', `the tile preview follows the title as you type (${pb.pvLive})`);
  ok(pb.saved.length === 2, `Save card writes both content keys (${pb.saved.join(', ')})`);

  // §4e AMENITIES ARE THEIR OWN SECTION, and the save reports where you can
  // see it. Moving the features well out of "Text & details" is only a win
  // if the whole editor came with it — the rows, the add button, the real
  // save, and a message slot INSIDE this fold (it used to write into the
  // text section's span, which the move would have hidden behind a closed
  // fold: a save that looks like it did nothing).
  console.log('§4e Amenities: its own section, the real save, its own message');
  const am = await page.evaluate(async () => {
    siteContent['amenities-21a'] = ['Wood-burning stove', 'Walled courtyard'];
    settingsOpenAccom('21a');
    const detail = document.getElementById('accom-detail');
    const label = ((detail.querySelector('[data-grp="ac-21a-amenities"] .bhub-fold-lbl, [data-grp="ac-21a-amenities"]') || {}).textContent || '');
    const fold = document.getElementById('bhub-fold-ac-21a-amenities');
    const rows = fold ? fold.querySelectorAll('#accom-am-rows-21a [data-am]') : [];
    // The text section no longer carries them — one editor, one home.
    const textFold = document.getElementById('bhub-fold-ac-21a-text');
    const strayInText = !!(textFold && textFold.querySelector('[data-am]'));
    // Add a row through the REAL button, type into it, save through the REAL
    // button, and read what actually went to the server.
    let posted = null;
    const origPost = window.apiPost;
    window.apiPost = async (url, body) => { if (/content/.test(url)) posted = body; return { ok: true }; };
    accomAddAmenity('21a');
    const typed = document.querySelectorAll('#accom-am-rows-21a [data-am]');
    typed[typed.length - 1].value = 'Sea view from the bedroom';
    await accomSaveAmenities('21a');
    window.apiPost = origPost;
    const msg = (document.getElementById('accom-am-msg-21a') || {}).textContent || '';
    const msgInFold = !!(fold && fold.querySelector('#accom-am-msg-21a'));
    return {
      label, rows: rows.length, strayInText,
      saved: posted && posted.value ? posted.value : null,
      msg: msg.trim(), msgInFold,
    };
  });
  ok(/Amenities/.test(am.label), `the cottage page carries an Amenities section (${am.label.trim().slice(0, 40)})`);
  ok(am.rows === 2, `it renders a row per saved amenity (${am.rows})`);
  ok(!am.strayInText, 'the features well has LEFT "Text & details" — one editor, one home');
  ok(am.saved && am.saved.length === 3 && am.saved[2] === 'Sea view from the bedroom', `Add + Save writes the typed list through the real endpoint (${JSON.stringify(am.saved)})`);
  ok(am.msgInFold && /Saved/.test(am.msg), `the save reports inside this fold, where you can see it ("${am.msg}")`);

  // §4f HOUSE RULES ARE THEIR OWN SECTION — and the one that WAS called "House
  // rules" is now named for what it holds. Two things a guest means by the
  // phrase were in one panel: the rules they must observe, and the times and
  // limits the booking form enforces. The rules now have a section, a tile on
  // the guest's stay, and a verdict counting the OWNER'S OWN lines.
  console.log('§4f House rules: its own section, the settings quoted, the real save');
  const hr = await page.evaluate(async () => {
    siteContent['houserules-21a'] = ['No smoking indoors', 'Quiet after 10pm'];
    propertyRates['21a'] = Object.assign({}, propertyRates['21a'] || {}, { checkInTime: '16:00', checkOutTime: '09:30' });
    settingsOpenAccom('21a');
    const detail = document.getElementById('accom-detail');
    const label = (id) => ((detail.querySelector(`[data-grp="ac-21a-${id}"]`) || {}).textContent || '');
    const fold = document.getElementById('bhub-fold-ac-21a-houserules');
    const rows = fold ? fold.querySelectorAll('#accom-houserules-rows-21a [data-hr]') : [];
    // The read-only settings lines are QUOTED from the guest's own derivation,
    // so this panel cannot state a different checkout time from the sheet.
    const auto = fold ? [...fold.querySelectorAll('.acr-row .acr-lbl')].map((e) => e.textContent.trim()) : [];
    const want = guestHouseRuleList('21a').slice(0, 3);
    // They have LEFT the times panel — one editor, one home.
    const strayInHouse = !!(document.getElementById('bhub-fold-ac-21a-house') || { querySelector: () => null }).querySelector('[data-hr]');
    let posted = null;
    const origPost = window.apiPost;
    window.apiPost = async (url, body) => { if (/content/.test(url)) posted = body; return { ok: true }; };
    accomAddHouseRule('21a');
    const typed = document.querySelectorAll('#accom-houserules-rows-21a [data-hr]');
    typed[typed.length - 1].value = 'Please strip the beds before you go';
    await accomSaveHouseRules('21a');
    window.apiPost = origPost;
    return {
      rulesLabel: label('houserules'), timesLabel: label('house'),
      rows: rows.length, auto, want, strayInHouse,
      cap: ((detail.querySelector('[data-grp="ac-21a-houserules"] .st-cap') || {}).textContent || '').trim(),
      saved: posted && posted.value ? posted.value : null,
    };
  });
  ok(/House rules/.test(hr.rulesLabel) && /Times & limits/.test(hr.timesLabel),
    `the two are named apart (${hr.rulesLabel.trim().slice(0, 22)} / ${hr.timesLabel.trim().slice(0, 22)})`);
  ok(hr.rows === 2, `the section renders a row per saved rule (${hr.rows})`);
  ok(!hr.strayInHouse, 'the rules well has LEFT the times panel — one editor, one home');
  ok(JSON.stringify(hr.auto) === JSON.stringify(hr.want) && /16:00/.test(hr.auto.join(' ')),
    `the settings lines quote the guest's own derivation (${hr.auto.join(' · ')})`);
  ok(/2 rules/.test(hr.cap), `the verdict counts the OWNER'S rules, not the auto lines (${hr.cap})`);
  ok(hr.saved && hr.saved.length === 3 && hr.saved[2] === 'Please strip the beds before you go',
    `Add + Save writes the typed list through the real endpoint (${JSON.stringify(hr.saved)})`);

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
  ok(/field/.test(wc.textCap) && /image|none found/i.test(wc.imgCap), `the capsules count the real fields (${wc.textCap.trim()} / ${wc.imgCap.trim()})`);
  ok(wc.foldsClosed, 'both groups start folded');
  ok(wc.fieldInFold && wc.imgBtnInFold, 'the real ce-<key> editors + Replace-image live inside the folds');

  console.log('§6 the settings pages wear the unified anatomy (switch sheets + forms)');
  const p1 = await page.evaluate(async () => {
    settingsOpen('follow-ups');
    const fu = {
      ids: !!document.querySelector('#sec-follow-ups .chb-switch #enq-nudge-toggle') && !!document.querySelector('#sec-follow-ups .chb-switch #anniv-nudge-toggle'),
      well: !!document.querySelector('#sec-follow-ups .acr-well'),
    };
    // The thank-you switch: a REAL switch on the real checkbox, OFF by default, and filled from the
    // PRIVATE map (an internal key is absent from the anonymous boot GET — the bacs-details rule).
    const ty = document.getElementById('thankyou-toggle');
    fu.ty = !!ty && !!ty.closest('.chb-switch') && ty.getAttribute('data-key') === 'thankyou-email' && !ty.hasAttribute('data-invert');
    delete adminPrivateContent['thankyou-email']; delete siteContent['thankyou-email'];
    hydrateFollowUpToggles();
    fu.tyOff = ty ? ty.checked === false : null;
    adminPrivateContent['thankyou-email'] = '1';
    hydrateFollowUpToggles();
    fu.tyOn = ty ? ty.checked === true : null;
    delete adminPrivateContent['thankyou-email'];
    hydrateFollowUpToggles();
    settingsOpen('notify');
    await new Promise((r) => setTimeout(r, 300));
    // The owner's account pages (ui-test-owneraccount owns them): each alert is a
    // switch ROW, and quiet hours a row that opens its small form.
    const nf = {
      rows: document.querySelectorAll('#notify-prefs-body .ga-row .chb-switch input').length,
      // Compare against the registry's OWN length, not a hand-count — a new
      // category (checkout joined for the check-out tap) must not fail a
      // literal that only ever described the list at one moment.
      cats: (typeof NOTIFY_CATS !== 'undefined' && NOTIFY_CATS.length) || 0,
      quiet: document.querySelectorAll('#notify-prefs-body [data-act="oaQuiet"]').length,
    };
    settingsOpen('sms');
    const sms = { sw: !!document.querySelector('#sec-sms .chb-switch #sms-on'), wells: document.querySelectorAll('#sec-sms .acr-well').length, token: (document.getElementById('sms-token') || {}).type };
    settingsOpen('payments');
    await new Promise((r) => setTimeout(r, 300));
    const dep = document.getElementById('sq-deposit-pct');
    dep.value = '25';
    const plus = [...document.querySelectorAll('#sec-payments [data-act="depStep"]')].find((b) => (b.getAttribute('aria-label') || '').includes('more'));
    plus.click();
    await new Promise((r) => setTimeout(r, 120));
    settingsOpen('security'); // the two-step switch is drawn when its page opens
    const pay = { bumped: dep.value, twofa: !!document.querySelector('#sec-security .chb-switch #admin-2fa-toggle') };
    settingsOpen('chat-away');
    const away = { sw: !!document.querySelector('#gc-page .chb-switch #gc-away-on'), hours: !!document.querySelector('#gc-page [data-act="gcHoursPick"] #gc-hours-v') };
    return { fu, nf, sms, pay, away };
  });
  ok(p1.fu.ids && p1.fu.well, 'Follow-up emails: the REAL toggles wear the switch, in a well');
  ok(p1.fu.ty && p1.fu.tyOff === true && p1.fu.tyOn === true, `the thank-you switch is off by default and shows ON from the private setting (${p1.fu.ty}/${p1.fu.tyOff}/${p1.fu.tyOn})`);
  ok(p1.nf.rows === p1.nf.cats && p1.nf.cats >= 4 && p1.nf.quiet === 1, `Notifications: every category is a switch row + a quiet-hours row (${p1.nf.rows}/${p1.nf.cats}/${p1.nf.quiet})`);
  ok(p1.sms.sw && p1.sms.wells === 2 && p1.sms.token === 'password', `Text messages: switch + two wells, the token stays write-only (${p1.sms.wells})`);
  ok(p1.pay.bumped === '26', `Payments: the deposit stepper bumps the value (${p1.pay.bumped})`);
  ok(p1.pay.twofa, 'Security: two-step sign-in is the switch on the real toggle');
  ok(p1.away.sw && p1.away.hours, 'Guest chat: the away switch + the hours row (the Quiet hours form)');

  console.log('§6b Payments: rows, autosave, and the bank details as three checked fields');
  const py = await page.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const saves = [];
    const realSave = window.saveContent;
    window.saveContent = async (key, val) => { saves.push({ key, val }); };
    adminPrivateContent['bacs-details'] = 'Barclays · 20-00-00 · 12345678';
    settingsOpen('payments');
    await wait(300);
    const v = (id) => (document.getElementById(id) || {}).value;
    const parsed = [v('bank-name'), v('bank-sort'), v('bank-acc')].join(' | ');
    const cap0 = (document.getElementById('bacs-cap') || {}).textContent || '';
    const titleCap = (document.getElementById('settings-panel-cap') || {}).textContent || '';
    const noOld = !document.getElementById('bacs-details') && !document.querySelector('#sec-payments details') && !document.querySelector('[data-act="saveDepositPct"]');
    const actsHidden0 = document.getElementById('bacs-acts').hidden;
    const sort = document.getElementById('bank-sort');
    sort.value = '4044';
    sort.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(30);
    const partial = { fmt: sort.value, disabled: document.getElementById('bacs-save').disabled, problem: document.getElementById('bacs-problem').textContent, cap: document.getElementById('bacs-cap').textContent, dot: !document.getElementById('bank-sort-bad').hidden };
    sort.value = '40 44 52';
    sort.dispatchEvent(new Event('input', { bubbles: true }));
    const acc = document.getElementById('bank-acc');
    acc.value = '8765-4321x9';
    acc.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(30);
    const ready = { sort: sort.value, acc: acc.value, disabled: document.getElementById('bacs-save').disabled, preview: (document.getElementById('bacs-preview-body') || {}).textContent };
    document.getElementById('bacs-save').click();
    await wait(80);
    const bsave = saves.filter((x) => x.key === 'bacs-details').pop();
    const after = { cap: document.getElementById('bacs-cap').textContent, actsHidden: document.getElementById('bacs-acts').hidden };
    const plus = document.querySelector('#sec-payments [data-act="depStep"][data-arg="1"]');
    const n0 = saves.filter((x) => x.key === 'square-deposit-pct').length;
    plus.click(); plus.click();
    await wait(200);
    const n1 = saves.filter((x) => x.key === 'square-deposit-pct').length;
    await wait(700);
    const dsaves = saves.filter((x) => x.key === 'square-deposit-pct');
    const depMark = (document.getElementById('pay-dep-saved') || {}).textContent || '';
    window.saveContent = realSave;
    return { parsed, cap0, titleCap, noOld, actsHidden0, partial, ready, bsave: bsave && bsave.val, after, depBurst: n1 - n0, depSaves: dsaves.length - n0, depVal: dsaves.length ? dsaves[dsaves.length - 1].val : null, depMark };
  });
  ok(py.noOld, 'no free-text bank box, no "How it works" folds, no deposit Save button');
  ok(/Taking cards|Cards off/.test(py.titleCap), `the title carries the card-payments status pill (${py.titleCap})`);
  ok(py.parsed === 'Barclays | 20-00-00 | 12345678' && /Saved/.test(py.cap0) && py.actsHidden0, `saved free-text details split back into the three fields, nothing to save yet (${py.parsed})`);
  ok(py.partial.fmt === '40-44' && py.partial.disabled && /6 digits/.test(py.partial.problem) && py.partial.dot && /Unsaved/.test(py.partial.cap), `a short sort code is formatted, flagged and cannot be saved (${py.partial.fmt}: ${py.partial.problem})`);
  ok(py.ready.sort === '40-44-52' && py.ready.acc === '87654321' && !py.ready.disabled, `digits only, dashes added (${py.ready.sort} / ${py.ready.acc})`);
  ok(py.ready.preview === 'Barclays\nSort code 40-44-52\nAccount 87654321', `the email preview shows what will be sent (${JSON.stringify(py.ready.preview)})`);
  ok(py.bsave === 'Barclays\nSort code 40-44-52\nAccount 87654321' && /Saved/.test(py.after.cap) && py.after.actsHidden, `Save writes the ONE stored text the emails already print (${JSON.stringify(py.bsave)})`);
  ok(py.depBurst === 0 && py.depSaves === 1 && py.depVal === 27, `two quick deposit taps save ONCE, after the pause (${py.depSaves} save, ${py.depVal}%)`);
  ok(/Saved/.test(py.depMark), `the deposit says "Saved ✓" beside its caption (${py.depMark})`);

  console.log('§7 moderation queues + people lists wear the anatomy (batch 2)');
  const p2 = await page.evaluate(async () => {
    settingsOpen('chat-answers');
    const ca = { frows: document.querySelectorAll('#gc-page [data-grp^="gcq-"] .acw-frow textarea.gc-grow').length, saves: !!document.querySelector('#gc-page .u-addrow') };
    settingsOpen('waitlist');
    await new Promise((r) => setTimeout(r, 350));
    const wl = {
      rows: document.querySelectorAll('#waitlist-body .acr-well .acw-prow').length,
      notified: !!document.querySelector('#waitlist-body .st-cap.is-ok'),
      waiting: !!document.querySelector('#waitlist-body .st-cap.is-unk'),
      acts: !!document.querySelector('#waitlist-body [data-act="notifyWaitlist"]') && !!document.querySelector('#waitlist-body [data-act="deleteWaitlist"]'),
    };
    settingsOpen('guests');
    await new Promise((r) => setTimeout(r, 350));
    const ga = {
      rows: document.querySelectorAll('#guest-admin-list .acw-prow').length,
      fig: /£2,840/.test((document.getElementById('guest-admin-list') || {}).textContent || ''),
      hooks: !!document.querySelector('#guest-admin-list .acw-prow[data-gemail="debbie@example.com"]'),
      resetOnlyWithAccount: document.querySelectorAll('#guest-admin-list [data-act="gstResetAsk"]').length === 1,
    };
    settingsOpen('reviews');
    await new Promise((r) => setTimeout(r, 350));
    const rv = {
      qrow: !!document.querySelector('#guest-review-moderation .acw-qrow'),
      // The waiting count rides the TITLE's status pill (the approved Reviews demo, in the Manage pill's look).
      cap: !!document.querySelector('#settings-panel-cap .head-pill.warn'),
      pills: !!document.querySelector('#guest-review-moderation .acw-modacts .u-btn1') && !!document.querySelector('#guest-review-moderation .acw-modacts .u-btn2'),
    };
    return { ca, wl, ga, rv };
  });
  ok(p2.ca.frows >= 3 && p2.ca.saves, `Instant answers: each a fold row with its growing answer box, and an add row (${p2.ca.frows})`);
  ok(p2.wl.rows === 2 && p2.wl.notified && p2.wl.waiting && p2.wl.acts, 'Waitlist: person rows with truth-telling capsules + the real actions');
  ok(p2.ga.rows === 2 && p2.ga.fig && p2.ga.hooks, 'Guest accounts: person rows with serif lifetime spend + the data-gemail hooks');
  ok(p2.ga.resetOnlyWithAccount, 'A reset link is only offered where an account exists');
  ok(p2.rv.qrow && p2.rv.cap && p2.rv.pills, 'Reviews: the pending item is a moderation row with verdict pills');

  console.log('§7e Guests: tiles that filter, groups by what to do, a reset LINK and never a password');
  await page.setViewportSize({ width: 390, height: 1400 });
  await page.evaluate(() => { __gst.list = []; __gst.sent = {}; __gst.invited = {}; __gst.open = ''; __gst.filter = null; __gst.q = ''; settingsOpen('guests'); });
  await page.waitForSelector('#guest-admin-list .gst-row');
  const g1 = await page.evaluate(() => {
    const L = document.getElementById('guest-admin-list');
    return {
      tiles: [...L.querySelectorAll('.gst-stat')].map((t) => t.textContent.replace(/\s+/g, ' ').trim()),
      inviteRows: L.querySelectorAll('.gst-grp.is-invite .gst-row').length,
      prose: /set a new password for them|tell them the new password/i.test(document.getElementById('sec-guests').textContent),
      pwInputs: L.querySelectorAll('input[type="password"]').length,
      title: (document.getElementById('settings-panel-title') || {}).textContent || '',
    };
  });
  ok(g1.tiles.length === 3 && /2\s*To invite back/.test(g1.tiles[2]), `three stat tiles, counting who to invite back (${g1.tiles.join(' | ')})`);
  ok(g1.inviteRows === 2, 'guests with no stay in 2+ months are grouped as worth inviting back');
  ok(!g1.prose && g1.pwInputs === 0, 'no "set a password for them" copy and no password box anywhere');
  ok(/^Guest list$/.test(g1.title), `the page is called Guest list, as its Manage row is (${g1.title})`);
  await page.click('#guest-admin-list .gst-stat.is-invite');
  ok(await page.evaluate(() => !!document.querySelector('#guest-admin-list .gst-chip') && document.querySelectorAll('#guest-admin-list .gst-row').length === 2), 'a tile filters, with a chip to clear it');
  await page.click('#guest-admin-list .gst-chip');
  await page.fill('#gst-q', 'tom');
  ok(await page.evaluate(() => document.querySelectorAll('#guest-admin-list .gst-row').length === 1), 'search narrows the list');
  await page.fill('#gst-q', '');
  ok(await page.evaluate(() => document.activeElement && document.activeElement.id === 'gst-q'), '…and typing never loses the search box');
  // Invite Debbie back: the button names the cottage, then the card arrives.
  await page.click('#guest-admin-list .acw-prow[data-gemail="debbie@example.com"] .gst-row');
  const lead = await page.textContent('#guest-admin-list .acw-prow[data-gemail="debbie@example.com"] .gst-lead');
  ok(/Invite Debbie back to Jollyboat/.test(lead), `the one clear action names who and where (${lead.trim()})`);
  gstPosts.length = 0;
  await page.click('#guest-admin-list .acw-prow[data-gemail="debbie@example.com"] .gst-lead');
  await page.waitForSelector('#guest-admin-list .acw-prow[data-gemail="debbie@example.com"] .gst-card', { timeout: 4000 });
  const inv = await page.evaluate(() => {
    const r = document.querySelector('#guest-admin-list .acw-prow[data-gemail="debbie@example.com"]');
    return { card: r.querySelector('.gst-card').textContent.replace(/\s+/g, ' '), sub: r.querySelector('.gst-main small').textContent, lead: !!r.querySelector('.gst-lead'), tile: document.querySelector('#guest-admin-list .gst-stat.is-invite b').textContent };
  });
  ok(gstPosts.some((x) => x.action === 'guest_reinvite' && x.email === 'debbie@example.com'), 'the invitation goes through the real endpoint');
  ok(/Invitation sent/.test(inv.card) && /debbie@example\.com/.test(inv.card) && /Invites Debbie back to Jollyboat/.test(inv.card), 'a card confirms who it went to and where');
  ok(/Invited today/.test(inv.sub) && !inv.lead && inv.tile === '1', `the row says so, the button stands down and the tile counts one fewer (${inv.sub})`);
  // The reset link: preview the email, send it, see the card and the one-minute wait.
  await page.click('#guest-admin-list .acw-prow[data-gemail="debbie@example.com"] [data-act="gstResetAsk"]');
  const conf = await page.evaluate(() => {
    const c = document.querySelector('#guest-admin-list .gst-confirm');
    return c ? { mail: c.querySelector('.gst-mail').textContent.replace(/\s+/g, ' '), pw: c.querySelectorAll('input').length } : null;
  });
  ok(!!conf && /Choose a new password/.test(conf.mail) && /debbie@example\.com/.test(conf.mail) && conf.pw === 0, 'the owner sees the email the guest will get, and no password field');
  gstPosts.length = 0;
  await page.click('#guest-admin-list .gst-send');
  await page.waitForSelector('#guest-admin-list .gst-card [data-gst-resend]', { timeout: 4000 });
  const sent = gstPosts.find((x) => x.action === 'guest_send_reset');
  ok(!!sent && sent.email === 'debbie@example.com' && !('next' in sent), 'Send posts the guest’s email only — never a password');
  const rc = await page.evaluate(() => {
    const c = [...document.querySelectorAll('#guest-admin-list .gst-card')].pop();
    const b = c.querySelector('[data-gst-resend]');
    return { txt: c.textContent.replace(/\s+/g, ' '), btn: b.textContent, wait: b.classList.contains('is-wait'), junk: /junk/i.test(c.textContent) };
  });
  ok(/Reset link sent/.test(rc.txt) && /Link works until 19:22/.test(rc.txt) && !rc.junk, `the card states when the link stops working (${rc.txt.trim()})`);
  ok(/Send again in \d+s/.test(rc.btn) && rc.wait, `Send again waits a minute (${rc.btn})`);
  gstPosts.length = 0;
  await page.evaluate(() => document.querySelector('#guest-admin-list [data-gst-resend]').click());
  ok(!gstPosts.some((x) => x.action === 'guest_send_reset'), '…and a tap during the wait sends nothing');
  await page.setViewportSize({ width: 1280, height: 950 });

  console.log('§7b the Reviews page: copy per cottage, two sub-pages, the title capsule');
  const rv2 = await page.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    let clip = '';
    try { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: (t) => { clip = t; return Promise.resolve(); } } }); } catch (e) {}
    settingsOpen('reviews');
    await wait(400);
    const keys = bookableCottageKeys();
    const rows = document.querySelectorAll('#review-links .rv-row').length;
    const copies = document.querySelectorAll('#review-links [data-act="copyReviewLink"]').length;
    const k = keys[0];
    const btn = document.getElementById('revcopy-' + k);
    const r = btn.getBoundingClientRect();
    btn.click();
    await wait(150);
    const b2 = document.getElementById('revcopy-' + k);
    const copied = { cls: b2.classList.contains('is-copied'), txt: b2.textContent.trim(), clip };
    const otherStill = keys.length < 2 || !document.getElementById('revcopy-' + keys[1]).classList.contains('is-copied');
    const capOnLine = (() => {
      const t = document.getElementById('settings-panel-title').getBoundingClientRect();
      const c = document.querySelector('#settings-panel-cap .head-pill');
      if (!c) return null;
      const cr = c.getBoundingClientRect();
      return Math.abs((t.top + t.bottom) / 2 - (cr.top + cr.bottom) / 2);
    })();
    const noOldFold = !document.querySelector('#sec-reviews details') && !document.querySelector('#sec-reviews #bulk-rev-text');
    // The layout (the one look): the cottage and its two actions on ONE row, the
    // actions on the right at the 44px floor; no URL line, no explanatory sentences.
    const row0 = document.querySelector('#review-links .rv-row');
    const nameBox = row0.querySelector('.rv-name').getBoundingClientRect();
    const actsBox = row0.querySelector('.rv-acts').getBoundingClientRect();
    const acts = [...row0.querySelectorAll('.rv-acts button')].map((b) => b.getBoundingClientRect());
    const layout = { below: actsBox.top < nameBox.bottom && actsBox.left > nameBox.right, even: acts.length >= 2 && acts.every((a) => Math.round(a.height) >= 44), noUrl: !/cottageholidaysblakeney/.test(document.getElementById('review-links').textContent), noSub: !document.querySelector('#sec-reviews .acr-capsub') && !document.getElementById('rv-intro') && !document.querySelector('#sec-reviews .rv-go .rv-sub') };
    // The QR window: the cottage's name and a code for ITS link, nothing else.
    row0.querySelector('[data-act="reviewQrOpen"]').click();
    await wait(200);
    const ov = document.getElementById('rv-qr-modal');
    const M = chbQr(reviewLinkUrl(k) + '?from=qr');
    const svg = ov && ov.querySelector('.rvq-code svg');
    const dark = M ? M.flat().filter(Boolean).length : 0;
    const qr = {
      open: !!ov && ov.classList.contains('open'),
      title: (document.getElementById('rvq-title') || {}).textContent,
      size: svg && svg.getAttribute('viewBox'),
      cells: svg ? (svg.querySelector('path').getAttribute('d').match(/M/g) || []).length : 0,
      dark, n: M ? M.length : 0,
      finder: M && M[0][0] && M[0][6] && M[6][0] && !M[1][1] && M[3][3],
      only: ov ? [...ov.querySelectorAll('button')].map((b) => b.textContent.trim()).join('|') === 'Done|Copy link' && !/http|camera|review link/i.test(ov.textContent) : false,
      wantName: (propertyMeta[k] || {}).name || k,
    };
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await wait(80);
    qr.closed = !ov.classList.contains('open');
    document.querySelector('#sec-reviews [data-arg="reviews-import"]').click();
    await wait(200);
    const imp = { shown: document.getElementById('sec-reviews-import').style.display !== 'none', title: document.getElementById('settings-panel-title').textContent, filled: document.querySelectorAll('#rvi-props .rvi-chip').length === bookableCottageKeys().length, capGone: !document.querySelector('#settings-panel-cap .st-cap') };
    settingsBack();
    await wait(400);
    const backToReviews = document.getElementById('sec-reviews').style.display !== 'none';
    siteContent['google-review-url'] = '';
    document.querySelector('#sec-reviews [data-arg="reviews-google"]').click();
    await wait(200);
    const goo = { shown: document.getElementById('sec-reviews-google').style.display !== 'none', input: !!document.getElementById('google-review-url-input') };
    settingsBack();
    await wait(400);
    const gcap = (document.getElementById('rv-google-cap') || {}).textContent || '';
    return { layout, qr, rows, copies, keys: keys.length, h: r.height, copied, otherStill, capOnLine, noOldFold, imp, backToReviews, goo, gcap, wantUrl: reviewLinkUrl(k) };
  });
  ok(rv2.rows === rv2.keys && rv2.copies === rv2.keys && rv2.keys >= 1, `every cottage is a row with its own Copy button (${rv2.rows}/${rv2.copies}/${rv2.keys})`);
  ok(rv2.h >= 44, `Copy is a 44px target (${rv2.h})`);
  ok(rv2.layout.below && rv2.layout.even, `each cottage: one row, the name then its two actions on the right, each 44px`);
  ok(rv2.layout.noUrl && rv2.layout.noSub, 'no link written out and no explanatory sentences on the Reviews page');
  ok(rv2.qr.open && rv2.qr.title === rv2.qr.wantName, `QR opens a window titled with just the cottage's name (${rv2.qr.title})`);
  ok(rv2.qr.n >= 21 && rv2.qr.size === `0 0 ${rv2.qr.n} ${rv2.qr.n}` && rv2.qr.cells === rv2.qr.dark && rv2.qr.finder, `the code drawn is the encoder's matrix for that cottage's ?from=qr link (${rv2.qr.n}×${rv2.qr.n})`);
  ok(rv2.qr.only, 'the window carries the code and its two answers, Done and Copy link — no link text, no instructions');
  ok(rv2.qr.closed, 'Escape closes it');
  ok(rv2.copied.cls && /Copied/.test(rv2.copied.txt) && rv2.copied.clip === rv2.wantUrl, `tapping Copy puts THAT cottage's link on the clipboard and says Copied (${rv2.copied.txt} · ${rv2.copied.clip})`);
  ok(rv2.otherStill, "only the tapped cottage's button flips");
  ok(rv2.capOnLine !== null && rv2.capOnLine <= 1, `the waiting capsule sits centred on the title's line (Δ${rv2.capOnLine})`);
  ok(rv2.noOldFold, 'the import form and its fold are off the Reviews page');
  ok(rv2.imp.shown && rv2.imp.title === 'Import reviews' && rv2.imp.filled && rv2.imp.capGone, `Import opens its own page, filled, without the Reviews capsule (${rv2.imp.title})`);
  ok(rv2.backToReviews, 'Back from a sub-page returns to Reviews, not the index');
  ok(rv2.goo.shown && rv2.goo.input, 'Google review link opens its own page');
  ok(/Not set/.test(rv2.gcap), `the Google row says whether the link is set (${rv2.gcap})`);

  console.log('§7c importing reviews: add-only, the paste cleaned, nothing already imported added twice');
  const imp = await page.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const keys = bookableCottageKeys();
    const k = keys[0];
    siteContent.reviews = [{ name: 'Old', stars: 5, text: 'Lovely week — the welcome book answered everything before we asked.', prop: k, source: 'Airbnb' }];
    const saves = [];
    const realSave = window.saveContent;
    window.saveContent = async (key, val) => { saves.push({ key, val: JSON.parse(JSON.stringify(val)) }); };
    settingsOpen('reviews-import');
    await wait(150);
    const noEditor = !document.querySelector('#sec-reviews-import .review-row') && !document.querySelector('#sec-reviews-import select');
    const btn = document.getElementById('rvi-add');
    const before = { disabled: btn.disabled, label: btn.textContent };
    const ta = document.getElementById('rvi-text');
    ta.value = 'Hannah\nLeeds, United Kingdom\n★★★★☆\n·\nOctober 2024\nStayed a few nights\nPerfect base for the coast path!!! Cosy and spotless.\nShow more\nResponse from George\nOctober 2024\nThank you Hannah!\n\nMark\n2 weeks ago\nLovely week — the welcome book answered everything before we asked.\nHelpful\n\nPriya\nLondon, United Kingdom\nGreat location, the bed was SO comfy. Text me on 07700 900123 if you ever want a swap!\nReport this review';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(100);
    const noCottage = { disabled: btn.disabled, label: btn.textContent };
    document.querySelector('#rvi-props .rvi-chip').click();
    await wait(100);
    const rows = [...document.querySelectorAll('#rvi-found .rvi-row')].map((r) => ({ t: r.querySelector('.rvi-text').textContent, out: r.classList.contains('is-out'), dupe: /Already imported/.test(r.textContent) }));
    const clutter = (document.querySelector('#rvi-found .st-cap') || {}).textContent || '';
    const why = document.querySelector('#rvi-found .rvi-why');
    why.click();
    await wait(50);
    const fold0 = document.querySelector('#rvi-found .rvi-fold');
    const removedShown = fold0 && !fold0.hidden ? fold0.textContent : '';
    const ready = { disabled: btn.disabled, label: btn.textContent };
    btn.click();
    await wait(500);
    const toastBtn = [...document.querySelectorAll('.toast-action')].pop();
    const afterAdd = { saves: saves.length, n: saves[0] && saves[0].val.length, last: saves[0] && saves[0].val.slice(-2), cleared: ta.value === '' };
    if (toastBtn) toastBtn.click();
    await wait(200);
    const undo = { saves: saves.length, n: saves[1] && saves[1].val.length };
    window.saveContent = realSave;
    return { noEditor, before, noCottage, rows, clutter, removedShown, ready, afterAdd, undo, k };
  });
  ok(imp.noEditor, 'the import page lists no imported reviews and has no editor rows');
  ok(imp.before.disabled && /Choose a cottage first/.test(imp.before.label) && imp.noCottage.disabled, `nothing can be added until a cottage is chosen (${imp.noCottage.label})`);
  ok(imp.rows.length === 3, `three reviews read out of the paste (${imp.rows.length})`);
  ok(imp.rows[0] && imp.rows[0].t === 'Perfect base for the coast path! Cosy and spotless.', `dates, location, stay details, buttons and the host reply are gone; "!!!" squashed ("${imp.rows[0] && imp.rows[0].t}")`);
  ok(imp.rows[2] && imp.rows[2].t === 'Great location, the bed was SO comfy.', `a sentence with a phone number goes whole ("${imp.rows[2] && imp.rows[2].t}")`);
  ok(imp.rows[1] && imp.rows[1].dupe && imp.rows[1].out, 'a review already on the site is shown as skipped');
  ok(/clutter removed/.test(imp.clutter), `the clutter removed is counted (${imp.clutter})`);
  ok(/host reply/.test(imp.removedShown) && /Response from George/.test(imp.removedShown), 'what was removed can be seen, line by line');
  ok(!imp.ready.disabled && /Add 2 reviews to /.test(imp.ready.label), `the button names the count and the cottage (${imp.ready.label})`);
  ok(imp.afterAdd.saves === 1 && imp.afterAdd.n === 3 && imp.afterAdd.cleared, `adding APPENDS to what is saved (${imp.afterAdd.n} = 1 kept + 2 new)`);
  ok(imp.afterAdd.last && imp.afterAdd.last[0].stars === 4 && imp.afterAdd.last.every((r) => r.prop === imp.k && r.source === 'Airbnb'), 'stars read from the paste; cottage and source stamped on every one');
  ok(imp.undo.saves === 2 && imp.undo.n === 1, `Undo takes back exactly what was added (${imp.undo.n} left)`);

  console.log('§7d the import page moves in the site\'s grammar, and only when something changed');
  const mo = await page.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const realSave = window.saveContent;
    window.saveContent = async () => {};
    siteContent.reviews = [];
    __rvi.prop = '';
    settingsOpen('reviews-import');
    await wait(150);
    const host = document.getElementById('rvi-props');
    const chips = host.querySelectorAll('.rvi-chip');
    chips[0].click();
    await wait(60);
    const pill = host.querySelector(':scope > .chb-pill');
    const t1 = pill && pill.style.translate;
    const chip0 = chips[0];
    let t2 = t1, sameChip = true;
    if (chips.length > 1) { chips[1].click(); await wait(60); t2 = pill.style.translate; sameChip = host.querySelectorAll('.rvi-chip')[0] === chip0; }
    const travel = { pill: !!pill, has: host.classList.contains('has-pill'), moved: chips.length < 2 || t1 !== t2, sameChip, trans: pill ? getComputedStyle(pill).transitionProperty : '' };
    const ta = document.getElementById('rvi-text');
    ta.value = 'Ann\n★★★★★\nGreat stay.\n\nBen\nReally lovely place.';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(30);
    const rows1 = [...document.querySelectorAll('#rvi-found .rvi-row')];
    const arrive = { n: rows1.length, allIn: rows1.every((r) => r.classList.contains('is-in')), anim: rows1[0] ? getComputedStyle(rows1[0]).animationName : '', staggered: rows1[1] ? rows1[1].style.getPropertyValue('--rvd') !== rows1[0].style.getPropertyValue('--rvd') : false };
    // Typing that changes nothing READ must not replay the list.
    ta.value += '\n\n';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(30);
    const kept = document.querySelector('#rvi-found .rvi-row') === rows1[0];
    // A new review arriving animates ALONE.
    ta.value += 'Cara\nPerfect.';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(30);
    const rows2 = [...document.querySelectorAll('#rvi-found .rvi-row')];
    const onlyNew = rows2.length === 3 && !rows2[0].classList.contains('is-in') && !rows2[1].classList.contains('is-in') && rows2[2].classList.contains('is-in');
    const r0 = rows2[0];
    r0.querySelector('.rvi-stars').click();
    await wait(30);
    const bow = { same: document.querySelector('#rvi-found .rvi-row') === r0, cls: r0.querySelector('.rvi-stars').classList.contains('is-bow'), anim: getComputedStyle(r0.querySelector('.rvi-stars')).animationName };
    const btn = document.getElementById('rvi-add');
    btn.classList.remove('is-settle');
    r0.querySelector('.rvi-drop').click();
    await wait(30);
    const drop = { same: document.querySelector('#rvi-found .rvi-row') === r0, out: r0.classList.contains('is-out'), trans: getComputedStyle(r0).transitionProperty, settle: btn.classList.contains('is-settle'), label: btn.textContent };
    ta.value = 'Dee\nStayed a few nights\nGreat.';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(30);
    const f = document.querySelector('#rvi-found .rvi-fold');
    const fold = { hidden0: f && f.hidden, trans: f ? getComputedStyle(f).transitionProperty : '' };
    document.querySelector('#rvi-found .rvi-why').click();
    await wait(30);
    fold.open = f && !f.hidden && document.querySelector('#rvi-found .rvi-why').getAttribute('aria-expanded') === 'true';
    fold.rows = f ? getComputedStyle(f).display : '';
    btn.click();
    await wait(40);
    const leaving = document.getElementById('rvi-found').classList.contains('is-leaving');
    await wait(400);
    const cleared = !document.querySelector('#rvi-found .rvi-row');
    window.saveContent = realSave;
    return { travel, arrive, kept, onlyNew, bow, drop, fold, leaving, cleared };
  });
  ok(mo.travel.pill && mo.travel.has && mo.travel.moved && /translate/.test(mo.travel.trans), `the cottage pill TRAVELS between chips (${mo.travel.trans})`);
  ok(mo.travel.sameChip, 'chips are toggled in place, never rebuilt mid-flight');
  ok(mo.arrive.n === 2 && mo.arrive.allIn && mo.arrive.anim === 'rviIn' && mo.arrive.staggered, `pasted reviews ARRIVE, staggered (${mo.arrive.anim})`);
  ok(mo.kept, 'typing that changes nothing read does not replay the list');
  ok(mo.onlyNew, 'a newly read review arrives alone');
  ok(mo.bow.same && mo.bow.cls && mo.bow.anim === 'revBowTap', `a tapped star BOWS in place (${mo.bow.anim})`);
  ok(mo.drop.same && mo.drop.out && /opacity/.test(mo.drop.trans), 'leaving one out FADES the row in place');
  ok(mo.drop.settle, `the button's words SETTLE when the count moves (${mo.drop.label})`);
  ok(mo.fold.hidden0 && mo.fold.open && /grid-template-rows/.test(mo.fold.trans) && mo.fold.rows === 'grid', 'what was removed UNFOLDS on the 0fr grid');
  ok(mo.leaving && mo.cleared, `on add, the read-back LEAVES, then clears (${mo.leaving}/${mo.cleared})`);

  console.log('§8 the data pages join by framing (batch 3) — seasons as CARDS');
  const p3 = await page.evaluate(async () => {
    // Seed one season so the render is deterministic: every cottage priced except
    // the LAST — the blank one is what the foot note exists to explain.
    const keys = liveCottageKeys();
    const last = keys[keys.length - 1];
    keys.forEach((k, ix) => {
      propertySeasons[k] = ix < keys.length - 1
        ? [{ label: 'July', start_date: '2027-07-01', end_date: '2027-07-31', couple_rate: 175 }]
        : [];
    });
    settingsOpen('seasongrid');
    await new Promise((r) => setTimeout(r, 300));
    const gw = document.getElementById('season-grid-wrap');
    const card = gw ? gw.querySelector('.sg-band') : null;
    const cs = card ? getComputedStyle(card) : null;
    const blankName = (propertyMeta[last] && propertyMeta[last].name) || last;
    const grid = {
      cards: gw ? gw.querySelectorAll('.sg-band').length : 0,
      welled: cs ? parseFloat(cs.borderRadius) >= 12 && cs.borderStyle !== 'none' : false,
      rows: card ? card.querySelectorAll('.sg-row').length === keys.length : false,
      // 31 nights, NOT 30: a season's end date is INCLUSIVE (coupleRateForNight),
      // unlike a checkout, and the card must count the way the price model reads.
      len: card ? (card.querySelector('.sg-len') || {}).textContent : '',
      noNative: !document.querySelector('#sec-seasongrid input[type="date"]'),
      save: !!document.querySelector('#sec-seasongrid [data-act="saveSeasonGrid"]'),
      count: (document.getElementById('sg-count') || {}).textContent || '',
      // Read the foot only if it's PAINTED — textContent passes through
      // display:none, and a hidden explanation explains nothing (break-tested).
      foot: (() => {
        const f = card && card.querySelector('.sg-foot');
        return f && getComputedStyle(f).display !== 'none' ? f.textContent : '';
      })(),
      footNames: blankName,
      msg0: (document.getElementById('season-grid-msg') || {}).textContent || '',
    };
    return grid;
  });
  ok(p3.cards === 1 && p3.welled && p3.rows, `seasons render as cards — one per band, welled, a price row per cottage`);
  ok(p3.len === '31 nights', `the card counts the season's nights INCLUSIVELY ("${p3.len}")`);
  ok(p3.noNative, 'no native input[type=date] anywhere in the section — the built-in calendar is the only date control');
  ok(p3.save && /1 season/.test(p3.count), `save intact + the caption counts ("${p3.count}")`);
  ok(p3.foot.includes(p3.footNames) && /base rate/.test(p3.foot), `a blank price is explained in the card's foot ("${p3.foot}")`);
  ok(/Nothing changed yet/.test(p3.msg0), 'the save bar starts honest — nothing changed yet');

  // The date pills open the BUILT-IN calendar in admin mode and write back through
  // it — driven by real clicks, because calling openSeasonDates directly would prove
  // the function while the trigger wiring rots (the maybeRestoreView lesson).
  const p3b = await page.evaluate(async () => {
    const trig = document.querySelector('#season-grid-body .sg-dates');
    trig.click();
    await new Promise((r) => setTimeout(r, 150));
    const dp = document.getElementById('date-picker');
    const opened = dp.classList.contains('open');
    const adminMode = dp.classList.contains('dp-admin');
    const legend = (document.getElementById('dp-legend') || {}).textContent || '';
    // Walk to July 2027 and re-pick the whole band one day shorter (1st → 30th).
    dpState.view = new Date(2027, 6, 1);
    renderDatePicker();
    const tap = (ds) => { const c = document.querySelector(`#dp-grid [data-day="${ds}"]`); if (c) c.click(); };
    tap('2027-07-01');
    tap('2027-07-30');
    await new Promise((r) => setTimeout(r, 50));
    const hint = (document.getElementById('dp-hint') || {}).textContent || '';
    const doneBtn = document.querySelector('#date-picker [data-act="dpDone"]');
    if (doneBtn) doneBtn.click();
    await new Promise((r) => setTimeout(r, 100));
    const i = document.querySelector('#season-grid-body .sg-band').getAttribute('data-sg-i');
    return {
      opened, adminMode, legend,
      closed: !dp.classList.contains('open'),
      hint, // the picker's own count must agree with the card: inclusive
      co: dpVal(`sg-co-${i}`),
      pills: (document.getElementById(`sg-trig-${i}`) || {}).textContent || '',
      len: (document.getElementById(`sg-len-${i}`) || {}).textContent || '',
      msg: (document.getElementById('season-grid-msg') || {}).textContent || '',
    };
  });
  ok(p3b.opened && p3b.adminMode, 'tapping the date pills opens the built-in calendar in admin mode');
  ok(p3b.legend === '', 'no legend about crossed dates — nothing is crossed on an all-cottage band');
  ok(/30 nights/.test(p3b.hint), `the picker's own hint counts inclusively too ("${p3b.hint}")`);
  ok(p3b.closed && p3b.co === '2027-07-30', `Done writes the range back through the hidden fields (${p3b.co})`);
  ok(/30\/07\/2027/.test(p3b.pills) && p3b.len === '30 nights', `…and the card repaints — pills DD/MM/YYYY + "${p3b.len}"`);
  ok(/^1 unsaved change$/.test(p3b.msg), `the save bar counts a moved range as ONE change, its name following ("${p3b.msg}")`);

  // The save path is unchanged: per-cottage seasons_save, blank prices omitted.
  const p3c = await page.evaluate(async () => {
    const keys = liveCottageKeys();
    const realPost = window.apiPost;
    const posts = [];
    window.apiPost = async (url, body) => {
      if (String(url).includes('rates.php') && body.action === 'seasons_save') { posts.push(body); return { ok: true }; }
      return realPost(url, body);
    };
    document.querySelector('#sec-seasongrid [data-act="saveSeasonGrid"]').click();
    await new Promise((r) => setTimeout(r, 300));
    window.apiPost = realPost;
    const by = {};
    posts.forEach((p) => { by[p.prop_key] = p.seasons; });
    return {
      n: posts.length,
      k: keys.length,
      first: (by[keys[0]] || [])[0] || null,
      blankOmitted: (by[keys[keys.length - 1]] || []).length === 0,
      msg: (document.getElementById('season-grid-msg') || {}).textContent || '',
    };
  });
  ok(p3c.n === p3c.k && p3c.first && p3c.first.start === '2027-07-01' && p3c.first.end === '2027-07-30' && p3c.first.rate === 175,
    `Save posts every cottage through the same seasons_save payload (${p3c.n} of ${p3c.k})`);
  ok(p3c.blankOmitted, 'a blank price saves NOTHING for that cottage — base rate by omission');
  ok(/Saved for all cottages/.test(p3c.msg), `…and reports it ("${p3c.msg}")`);

  // …BUT A SEASON WITH NO PRICE AT ALL IS SAVED AS NOTHING, and this reported
  // "Saved for all cottages ✓" over it. Only priced rows reach the payload, so a
  // card that is named and dated but unpriced — which the card's own foot invites,
  // "No prices yet — every cottage keeps its base rate for these dates" — was
  // silently DISCARDED: several calendar taps of work gone under a success mark.
  // Worse when the owner CLEARS an existing season's prices to reset it, which
  // deletes the season. It refuses now, in the words its two sibling refusals use.
  const p3c2 = await page.evaluate(async () => {
    const card = document.querySelector('#season-grid-body .sg-band');
    const priced = [...card.querySelectorAll('[data-sg-prop]')];
    const keep = priced.map((el) => el.value);
    priced.forEach((el) => { el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); });
    const realPost = window.apiPost;
    let posted = 0;
    window.apiPost = async (url, body) => {
      if (String(url).includes('rates.php') && body.action === 'seasons_save') { posted++; return { ok: true }; }
      return realPost(url, body);
    };
    document.querySelector('#sec-seasongrid [data-act="saveSeasonGrid"]').click();
    await new Promise((r) => setTimeout(r, 350));
    window.apiPost = realPost;
    const dlg = document.getElementById('glass-dialog');
    const say = dlg && getComputedStyle(dlg).display !== 'none' ? (document.getElementById('glass-dialog-msg') || {}).innerText || '' : '';
    if (say) { try { glassDialogResolve(true); } catch (e) {} }
    const label = (card.querySelector('[data-sg="label"]') || {}).value || '';
    priced.forEach((el, i) => { el.value = keep[i]; el.dispatchEvent(new Event('input', { bubbles: true })); });
    return { posted, say, label };
  });
  ok(p3c2.posted === 0, `an unpriced season is REFUSED, not saved as nothing (${p3c2.posted} posts)`);
  ok(/no price on any cottage/i.test(p3c2.say), `…and says why, naming the card (${p3c2.say.slice(0, 90)})`);
  ok(p3c2.label !== '', `…with the owner's own work still on screen to fix ("${p3c2.label}")`);

  console.log('§8b seasons: ended ones hidden but kept, summaries, suggested names, repeat next year');
  const sb = await page.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const t = todayDashed();
    const keys = liveCottageKeys();
    const y = +t.slice(0, 4);
    const nextEaster = (() => { for (const yy of [y, y + 1, y + 2]) { const e = sgEaster(yy); if (e > sgIsoAdd(t, 30)) return e; } return ''; })();
    keys.forEach((k, ix) => {
      propertySeasons[k] = [
        { label: 'Old summer', start_date: sgIsoAdd(t, -60), end_date: sgIsoAdd(t, -1), couple_rate: 150 + ix },
        { label: 'My break', start_date: sgIsoAdd(t, 10), end_date: sgIsoAdd(t, 16), couple_rate: 140 + ix * 5 },
        { label: '', start_date: sgIsoAdd(nextEaster, -3), end_date: sgIsoAdd(nextEaster, 1), couple_rate: 160 },
      ];
    });
    settingsOpen('seasongrid');
    await wait(300);
    const cards = [...document.querySelectorAll('#season-grid-body .sg-band')];
    const c0 = cards[0];
    const i0 = c0.getAttribute('data-sg-i');
    const sum = {
      n: cards.length,
      noEnded: !/Old summer/.test(document.getElementById('season-grid-body').textContent),
      cap: (document.getElementById('settings-panel-cap') || {}).textContent || '',
      name: (document.getElementById(`sg-sum-name-${i0}`) || {}).textContent,
      when: (document.getElementById(`sg-sum-when-${i0}`) || {}).textContent,
      price: (document.getElementById(`sg-sum-price-${i0}`) || {}).textContent,
      soon: (document.getElementById(`sg-sum-cap-${i0}`) || {}).textContent,
      closed: document.getElementById(`sg-fold-${i0}`).hidden,
      bar0: document.getElementById('sg-savebar').hidden,
      blocks: document.querySelectorAll('#sg-strip .sg-blk').length,
      // PAINTED, not just present: a general hit-region rule once set these absolutely-placed blocks
      // back to position:relative, so every one sat in the DOM at 0px tall and the strip drew nothing.
      blocksPainted: [...document.querySelectorAll('#sg-strip .sg-blk')].filter((x) => x.getBoundingClientRect().height >= 20 && getComputedStyle(x).position === 'absolute').length,
      noIntro: !/Each season is one card/.test(document.getElementById('sec-seasongrid').textContent),
    };
    document.getElementById(`sg-sum-${i0}`).click();
    await wait(50);
    sum.opened = !document.getElementById(`sg-fold-${i0}`).hidden;
    const c2 = cards[1];
    const i2 = c2.getAttribute('data-sg-i');
    sum.easterName = (document.getElementById(`sg-sum-name-${i2}`) || {}).textContent;
    sum.easterTag = (document.getElementById(`sg-nmtag-${i2}`) || {}).textContent;
    sum.myTag = (document.getElementById(`sg-nmtag-${i0}`) || {}).textContent;
    // a price edit raises the save bar
    const p = document.getElementById(`sg-p-${i0}-${keys[0]}`);
    p.value = String(+p.value + 5);
    p.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(30);
    sum.bar1 = !document.getElementById('sg-savebar').hidden;
    sum.msg1 = (document.getElementById('season-grid-msg') || {}).textContent;
    sum.diff = (document.getElementById(`sg-diff-${i0}-${keys[0]}`) || {}).textContent;
    // repeat the Easter card: next year's Easter, not the same dates a year on
    document.querySelector(`.sg-band[data-sg-i="${i2}"] [data-act="sgRepeat"]`).click();
    await wait(50);
    const last = [...document.querySelectorAll('#season-grid-body .sg-band')].pop();
    const il = last.getAttribute('data-sg-i');
    const ny = +nextEaster.slice(0, 4) + 1;
    sum.rep = { from: dpVal(`sg-ci-${il}`), want: sgIsoAdd(sgEaster(ny), -3), name: (document.getElementById(`sg-sum-name-${il}`) || {}).textContent, open: !document.getElementById(`sg-fold-${il}`).hidden };
    // a typed name sticks; Use "…" hands it back
    const nm = document.getElementById(`sg-nm-${il}`);
    nm.value = 'Spring treat';
    nm.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(30);
    sum.typedTag = (document.getElementById(`sg-nmtag-${il}`) || {}).textContent;
    sum.useShown = !document.getElementById(`sg-usesug-${il}`).hidden;
    document.getElementById(`sg-usesug-${il}`).click();
    await wait(30);
    sum.backTo = nm.value;
    // add from the ideas list
    document.getElementById('sg-add').click();
    await wait(30);
    sum.ideas = [...document.querySelectorAll('#sg-ideas .sg-idea')].map((b) => b.textContent.trim());
    // save: the ended season goes back too
    const realPost = window.apiPost;
    const posts = [];
    window.apiPost = async (url, body) => {
      if (String(url).includes('rates.php') && body.action === 'seasons_save') { posts.push(body); return { ok: true }; }
      return realPost(url, body);
    };
    document.querySelector('#sec-seasongrid [data-act="saveSeasonGrid"]').click();
    await wait(300);
    window.apiPost = realPost;
    const first = posts.find((x) => x.prop_key === keys[0]);
    sum.keptEnded = !!first && first.seasons.some((x) => x.label === 'Old summer' && x.end === sgIsoAdd(t, -1));
    sum.labels = first ? first.seasons.map((x) => x.label) : [];
    return sum;
  });
  ok(sb.n === 2 && sb.noEnded, `an ended season is not shown (${sb.n} cards)`);
  ok(/2 coming up/.test(sb.cap), `the title counts what is coming up (${sb.cap})`);
  ok(sb.name === 'My break' && /· 7 nights/.test(sb.when) && /a night/.test(sb.price) && /In 10 days/.test(sb.soon), `the summary: name, dates and nights, the price range, "In 10 days" (${sb.name} | ${sb.when} | ${sb.price} | ${sb.soon})`);
  ok(sb.closed && sb.opened, 'a season starts closed and its summary opens it');
  ok(sb.bar0 && sb.bar1 && /1 unsaved change/.test(sb.msg1), `no save bar until something changes, then it counts (${sb.msg1})`);
  ok(/on usual £/.test(sb.diff), `each price says how it compares with the usual rate (${sb.diff})`);
  ok(sb.blocks === 2 && sb.blocksPainted === 2, `the year strip draws each coming season, painted at the strip's height (${sb.blocks} / ${sb.blocksPainted} painted)`);
  ok(sb.noIntro, 'the explanatory sentence is gone');
  ok(sb.easterName === 'Easter' && /Suggested/.test(sb.easterTag) && /Your name/.test(sb.myTag), `an unnamed season is named from its dates; a typed name is kept (${sb.easterName})`);
  ok(sb.rep.from === sb.rep.want && sb.rep.name === 'Easter' && sb.rep.open, `Repeat next year moves Easter with Easter (${sb.rep.from} = ${sb.rep.want})`);
  ok(/Your name/.test(sb.typedTag) && sb.useShown && sb.backTo === 'Easter', 'typing a name makes it stick; "Use …" hands it back to the dates');
  ok(sb.ideas.length >= 2 && sb.ideas.some((t) => /Choose your own dates/.test(t)), `Add a season offers what is coming up, plus your own dates (${sb.ideas.slice(0, 3).join(' | ')})`);
  ok(sb.keptEnded, 'saving sends the ended season back — it is hidden, never deleted early');
  ok(sb.labels.includes('Easter'), `a suggested name is saved as the season's name (${sb.labels.join(', ')})`);

  console.log('§8c Pricing: standard and smart on one page');
  const pz = await page.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const t = todayDashed();
    const keys = liveCottageKeys();
    const pk = keys[0];
    propertySeasons[pk] = [];
    // Two stays with a 3-night gap between them, a few days out.
    dbBookings[pk] = [
      { id: 'pz1', dbId: 901, name: 'Gap Before', checkIn: sgIsoAdd(t, 3), checkOut: sgIsoAdd(t, 6) },
      { id: 'pz2', dbId: 902, name: 'Gap After', checkIn: sgIsoAdd(t, 9), checkOut: sgIsoAdd(t, 12) },
    ];
    if (!propertyRates[pk]) propertyRates[pk] = Object.assign({}, defaultRates[pk]);
    propertyRates[pk].weekendPct = 15;
    propertyRates[pk].weekendDays = '5,6';
    adminPrivateContent['pricing-smart-off'] = false;
    adminPrivateContent['pricing-limits'] = {};
    const posts = [];
    const realPost = window.apiPost;
    window.apiPost = async (url, body) => {
      if (String(url).includes('rates.php') || (String(url).includes('content.php') && body.action === 'set')) { posts.push(Object.assign({ __url: String(url) }, body)); return { ok: true }; }
      return realPost(url, body);
    };
    settingsOpen('pricing');
    await wait(300);
    const pb = document.getElementById('pricing-body');
    const cells = pb.querySelectorAll('.pr-grid .pr-day');
    const cots = pb.querySelectorAll('.pr-cots button').length;
    // The price on the calendar IS the booking quote's price for that night.
    // A WEEKDAY (Mon–Thu): the Saturday below must out-price it, and a fixed
    // t+20 lands on a Friday (a weekend day here) whenever today is a Saturday.
    let free = sgIsoAdd(t, 20);
    while (![1, 2, 3, 4].includes(new Date(free + 'T12:00:00Z').getUTCDay())) free = sgIsoAdd(free, 1);
    const cell = [...pb.querySelectorAll('.pr-grid button.pr-day')].find((b) => b.getAttribute('data-args') && b.getAttribute('data-args').includes(free));
    const shown = cell ? +(/£(\d+)/.exec(cell.textContent) || [0, 0])[1] : -1;
    const quoted = Math.round(priceBreakdown(pk, 2, 0, free, sgIsoAdd(free, 1)).nightly);
    let sat = sgIsoAdd(t, 14);
    while (new Date(sat + 'T12:00:00Z').getUTCDay() !== 6) sat = sgIsoAdd(sat, 1);
    const satCell = [...pb.querySelectorAll('.pr-grid button.pr-day')].find((b) => (b.getAttribute('data-args') || '').includes(sat));
    const satShown = satCell ? +(/£(\d+)/.exec(satCell.textContent) || [0, 0])[1] : -1;
    const satQuoted = Math.round(priceBreakdown(pk, 2, 0, sat, sgIsoAdd(sat, 1)).nightly);
    const bookedTxt = [...cells].filter((c) => /Booked/.test(c.textContent)).length;
    const gapNight = sgIsoAdd(t, 7);
    const gapCell = [...pb.querySelectorAll('.pr-grid button.pr-day')].find((b) => (b.getAttribute('data-args') || '').includes(gapNight));
    const dot = !!gapCell && gapCell.classList.contains('has-idea');
    gapCell.click();
    await wait(50);
    const det = document.getElementById('pr-detail');
    const detail = { open: !!det, usual: !!det && /Usual/.test(det.textContent), idea: !!det && /gap between two stays/.test(det.textContent), btn: !!det && !!det.querySelector('[data-act="prApply"]') };
    // The usual nightly stepper: the calendar re-prices at once, the save waits.
    const before = +(/£(\d+)/.exec(cell.textContent) || [0, 0])[1];
    [...pb.querySelectorAll('[data-act="prStep"]')].find((b) => b.getAttribute('data-args') === '["coupleRate","1"]').click();
    await wait(30);
    const cell2 = [...pb.querySelectorAll('.pr-grid button.pr-day')].find((b) => (b.getAttribute('data-args') || '').includes(free));
    const after = +(/£(\d+)/.exec(cell2.textContent) || [0, 0])[1];
    const savedNow = posts.filter((x) => x.action === 'save').length;
    await wait(800);
    const rateSave = posts.filter((x) => x.action === 'save').pop();
    // Smart off: no dots; the choice is saved.
    const sw = document.getElementById('pr-smart');
    sw.checked = false;
    sw.dispatchEvent(new Event('change', { bubbles: true }));
    await wait(50);
    const dotsOff = document.querySelectorAll('#pricing-body .pr-day.has-idea').length;
    const offSaved = posts.some((x) => x.key === 'pricing-smart-off' && x.value === true);
    sw.checked = true;
    sw.dispatchEvent(new Event('change', { bubbles: true }));
    await wait(50);
    // A floor lifts the gap offer.
    adminPrivateContent['pricing-limits'] = { floor: Math.round(parseFloat(propertyRates[pk].coupleRate)) - 1 };
    const g = chbGapScan().find((x) => x.pk === pk);
    const plan = g && chbGapPlan(g);
    adminPrivateContent['pricing-limits'] = {};
    window.apiPost = realPost;
    return { satShown, satQuoted, cells: cells.length, cots, keys: keys.length, shown, quoted, bookedTxt, dot, detail, before, after, savedNow, rateSave, dotsOff, offSaved, floorOffer: plan && plan.offer, floorWant: Math.round(parseFloat(propertyRates[pk].coupleRate)) - 1, caps: [...pb.querySelectorAll('.acr-cap')].length };
  });
  ok(pz.cots === pz.keys && pz.cells === 42, `a cottage switch and six weeks of nights (${pz.cots} cottages, ${pz.cells} days)`);
  ok(pz.shown === pz.quoted && pz.shown > 0, `the calendar shows what the booking quote charges for that night (£${pz.shown} = £${pz.quoted})`);
  ok(pz.satShown === pz.satQuoted && pz.satQuoted > pz.quoted, `…a Saturday too, weekend uplift included (£${pz.satShown} = £${pz.satQuoted})`);
  ok(pz.bookedTxt >= 6, `booked nights say so (${pz.bookedTxt})`);
  ok(pz.dot && pz.detail.open && pz.detail.usual && pz.detail.idea && pz.detail.btn, 'a gap night carries a dot; tapping it shows how the price is built and the idea with its reason');
  ok(pz.after === pz.before + 5 || pz.after > pz.before, `the usual-price stepper re-prices the calendar at once (£${pz.before} → £${pz.after})`);
  ok(pz.savedNow === 0 && pz.rateSave && pz.rateSave.couple_rate !== undefined, `…and saves after the pause through the same rate save (${JSON.stringify(pz.rateSave)})`);
  ok(pz.dotsOff === 0 && pz.offSaved, 'switching suggestions off removes every dot and is saved');
  ok(pz.floorOffer === pz.floorWant, `a "never below" limit lifts the gap offer to it (£${pz.floorOffer})`);
  ok(pz.caps >= 4, 'the page wears the section captions');

  console.log('§8d profit per night: the drive, learned stays, shared changeovers, ideas that act');
  const pp = await page.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const T = todayDashed(), sh = (n) => ukShiftDays(T, n);
    const keepB = JSON.parse(JSON.stringify(dbBookings)), keepBl = JSON.parse(JSON.stringify(dbBlocks));
    let id = 500;
    const mk = (ci, co, name, created) => ({ id: 'b' + id, dbId: id++, name, email: name.toLowerCase().replace(/ /g, '') + '@x.com', checkIn: ci, checkOut: co, adults: 2, children: 0, createdAt: created, agreedPrice: { total: 360, perNight: 120, nights: 3 } });
    const hist = [];
    for (let y = 1; y <= 2; y++) for (const [a, n, lead] of [[-30, 2, 4], [-60, 6, 120], [-90, 4, 45], [-120, 2, 3], [-150, 7, 150], [-200, 3, 20]]) { const ci = sh(a - y * 365); hist.push(mk(ci, ukShiftDays(ci, n), 'Past Guest', ukShiftDays(ci, -lead))); }
    dbBookings.jollyboat = hist.concat([mk(sh(2), sh(5), 'Sarah Pemberton', sh(-30)), mk(sh(7), sh(9), 'Tom Hall', sh(-3))]);
    dbBookings['21a'] = [mk(sh(1), sh(5), 'Dan Rowe', sh(-10))];
    dbBlocks.jollyboat = [{ checkIn: sh(26), checkOut: sh(29), source: 'airbnb', kind: 'reserved' }, { checkIn: sh(30), checkOut: sh(33), source: 'airbnb', kind: 'blocked' }];
    if (!propertyRates.jollyboat) propertyRates.jollyboat = Object.assign({}, defaultRates.jollyboat);
    Object.assign(propertyRates.jollyboat, { coupleRate: 120, weekendPct: 0, shortFee: 0, minNights: 2, minByDate: [], gapFitDays: 0 });
    propertySeasons.jollyboat = [];
    adminPrivateContent['pricing-smart-off'] = false;
    adminPrivateContent['pricing-limits'] = {};
    adminPrivateContent['pricing-hidden'] = {};
    adminPrivateContent['pricing-changeover'] = {};
    // A search week ahead that found the cottages full, and a sunny forecast.
    const m = sh(14), md = (new Date(m + 'T12:00:00Z').getUTCDay() + 6) % 7, mon = ukShiftDays(m, -md);
    const realGet = window.apiGet;
    window.apiGet = async (u) => (String(u).includes('pricing-suggest') ? { ok: true, suggestions: [], signals: { searches60: 11, noResult60: 6, searchWeeks: [{ week: mon, count: 11, missed: 6 }] } } : realGet(u));
    __prSugg = { at: Date.now(), d: { ok: true, suggestions: [], signals: { searches60: 11, noResult60: 6, searchWeeks: [{ week: mon, count: 11, missed: 6 }] } } };
    __prWx = Array.from({ length: 10 }, (_, i) => ({ date: sh(i), code: 1, summary: 'Mainly clear', tmax: 18 }));
    __prWxAsked = true;
    const posts = [];
    const realPost = window.apiPost;
    window.apiPost = async (url, body) => {
      if (String(url).includes('rates.php') || (String(url).includes('content.php') && body.action === 'set')) { posts.push(Object.assign({ __url: String(url) }, body)); return { ok: true }; }
      return realPost(url, body);
    };
    __prPage = 'main';
    __prCot = 'jollyboat';
    settingsOpen('pricing');
    await wait(300);
    const pb = document.getElementById('pricing-body');
    const ids = [...pb.querySelectorAll('.pr-pcard')].map((c) => c.getAttribute('data-idea'));
    const out = {
      ids,
      learned: !!pb.querySelector('.pr-learn') && pb.querySelectorAll('.pr-learn .pr-lrow').length >= 7,
      cars: pb.querySelectorAll('.pr-co').length, shared: pb.querySelectorAll('.pr-co.is-shared').length,
      gapCardGone: ![...pb.querySelectorAll('[data-act="nyGapOffer"]')].some((b) => (b.getAttribute('data-args') || '').includes(sh(5))),
      everyCardCompares: [...pb.querySelectorAll('.pr-pcard')].every((c) => c.querySelectorAll('.pr-cmprow').length === 2 && /confid|Fairly sure/i.test(c.querySelector('.pr-basis').textContent)),
      costsRow: !!document.getElementById('pr-costs-row'),
      holdNoTrip: !prTurnovers(sh(33)).includes('jollyboat') && prTurnovers(sh(29)).includes('jollyboat'),
    };
    const click = (idea) => { const c = pb.querySelector(`.pr-pcard[data-idea="${idea}"] .pr-ideaacts > button:first-child`); if (c) c.click(); return !!c; };
    // Raise the busy week → a dated override labelled as the owner's own.
    out.raised = click('raise');
    await wait(150);
    out.raisePost = posts.find((x) => x.action === 'seasons_save');
    // Not now hides the weather card, keyed to its numbers, and says so.
    const nn = document.querySelector('#pricing-body .pr-pcard[data-idea="weather"] [data-act="prHide"]');
    if (nn) nn.click();
    await wait(80);
    out.hiddenSaved = posts.some((x) => x.key === 'pricing-hidden' && Object.keys(x.value || {}).some((k) => k === 'jollyboat|weather'));
    out.weatherGone = !document.querySelector('#pricing-body .pr-pcard[data-idea="weather"]');
    out.hiddenRow = !!document.querySelector('#pricing-body .pr-hiddenrow');
    // The short-stay charge saves the price field.
    click('shortfee');
    await wait(150);
    out.feeSaved = posts.some((x) => x.action === 'save' && Number(x.short_fee) > 0);
    // Gap fits turn on through the rules save, and the minimum-stay row is honest.
    const before = posts.length;
    pb.querySelector('.pr-pcard[data-idea="mindate"] .pr-ideaacts > button:first-child') && document.querySelector('#pricing-body .pr-pcard[data-idea="mindate"] .pr-ideaacts > button:first-child').click();
    await wait(150);
    out.rulesSaved = posts.slice(before).some((x) => x.key === 'rules-jollyboat' && x.value && x.value.gapFitDays === 10);
    out.gapSwitch = !!(document.getElementById('pr-gapfit') || {}).checked;
    // Write to Sarah opens the composer with the offer written in.
    const ex = document.querySelector('#pricing-body .pr-pcard[data-idea="extend"] .pr-ideaacts > button:first-child');
    if (ex) ex.click();
    await wait(200);
    out.offer = { subj: (document.getElementById('enq-email-subject') || {}).value || '', body: (document.getElementById('enq-email-body') || {}).value || '' };
    try { closeEnquiryEmailModal(); } catch (e) {}
    // The Changeovers page: the trip cost follows the drive.
    prOpenCosts();
    await wait(80);
    const trip0 = (document.querySelector('#pricing-body .pr-tripv') || {}).textContent;
    const plus = [...document.querySelectorAll('#pricing-body [data-act="prCostStep"]')].find((b) => b.getAttribute('data-args') === '["drive","1"]');
    if (plus) plus.click();
    await wait(30);
    const trip1 = (document.querySelector('#pricing-body .pr-tripv') || {}).textContent;
    await wait(800);
    out.costs = { trip0, trip1, saved: posts.some((x) => x.key === 'pricing-changeover' && x.value && x.value.drive === 75), sum: !!document.getElementById('pr-sum') };
    // The switch: off stops counting the drive (stored, not lost), and the trip-based ideas stand down.
    const sw2 = document.getElementById('pr-costs-on');
    sw2.checked = false;
    sw2.dispatchEvent(new Event('change', { bubbles: true }));
    await wait(80);
    out.off = {
      saved: posts.some((x) => x.key === 'pricing-changeover' && x.value && x.value.on === false && x.value.drive === 75),
      shows: (document.querySelector('#pricing-body .pr-tripv') || {}).textContent,
      dimmed: !!document.querySelector('#pricing-body .pr-limits.is-off'),
      trip: prCosts().trip,
      ideas: prProfitIdeas('jollyboat').map((x) => x.id),
    };
    const sw3 = document.getElementById('pr-costs-on');
    sw3.checked = true;
    sw3.dispatchEvent(new Event('change', { bubbles: true }));
    await wait(80);
    out.backOn = prCosts().trip === 113 && prProfitIdeas('jollyboat').some((x) => x.id === 'share');
    prCloseCosts();
    window.apiPost = realPost;
    window.apiGet = realGet;
    Object.keys(dbBookings).forEach((k) => { dbBookings[k] = keepB[k] || []; });
    Object.keys(dbBlocks).forEach((k) => { dbBlocks[k] = keepBl[k] || []; });
    return out;
  });
  ok(['extend', 'share', 'raise', 'weather', 'shortfee', 'mindate'].every((x) => pp.ids.includes(x)), `the profit ideas all appear (${pp.ids.join(', ')})`);
  ok(pp.everyCardCompares, 'every idea compares two options in pounds kept and says how sure it is');
  ok(pp.learned, 'what it has learned about stay length is on the page');
  ok(pp.cars >= 2 && pp.shared >= 1, `changeovers are marked, and a shared one is green (${pp.cars} / ${pp.shared})`);
  ok(pp.gapCardGone, 'the gap Sarah can stay on into is not also offered at a discount');
  ok(pp.raised && pp.raisePost && pp.raisePost.seasons.some((x) => x.label === 'Busy week'), `raising the busy week saves a dated price of the owner's own (${JSON.stringify(pp.raisePost && pp.raisePost.seasons)})`);
  ok(pp.hiddenSaved && pp.weatherGone && pp.hiddenRow, 'Not now hides the idea, remembers it, and offers it back');
  ok(pp.feeSaved, 'the short-stay charge saves through the rate field');
  ok(pp.rulesSaved && pp.gapSwitch, 'gap fits turn on through the rules save and the switch shows it');
  ok(/staying on/i.test(pp.offer.subj) && /10% off/.test(pp.offer.body), `"Write to Sarah" opens the composer with the offer (${pp.offer.subj})`);
  ok(pp.costs.sum && pp.costs.trip0 === '£103' && pp.costs.trip1 === '£113' && pp.costs.saved, `the Changeovers page: £103 → £113 when the drive grows, and it saves (${JSON.stringify(pp.costs)})`);
  ok(pp.costsRow, 'the Changeovers page is reached from Settings at the foot of Pricing');
  ok(pp.off.saved && pp.off.shows === 'Off' && pp.off.dimmed && pp.off.trip === 0, `changeover costs switch off: saved, shown Off, figures kept but not counted (${JSON.stringify(pp.off)})`);
  ok(!pp.off.ids && !pp.off.ideas.includes('share') && !pp.off.ideas.includes('shortfee'), `…and the drive-based ideas stand down (${pp.off.ideas.join(',')})`);
  ok(pp.backOn, 'switching back on restores the stored figures and the ideas');
  ok(pp.holdNoTrip, 'an Airbnb stay is a changeover; an Airbnb "Not available" hold is not');

  // Pricing's "Extra guests" row deep-links into the cottage's rates editor — it used
  // to build that editor into the hidden cottage section and leave Pricing on screen.
  const xg = await page.evaluate(async () => {
    settingsOpen('pricing');
    await new Promise((r) => setTimeout(r, 300));
    const row = [...document.querySelectorAll('#pricing-body button.rv-go')].find((b) => /Extra guests/.test(b.textContent));
    if (row) row.click();
    await new Promise((r) => setTimeout(r, 300));
    const vis = (id) => { const e = document.getElementById(id); return !!(e && e.getClientRects().length); };
    const fold = document.querySelector('#accom-detail [id^="bhub-fold-ac-"][id$="-rates"]');
    return { row: !!row, pricing: vis('sec-pricing'), accom: vis('accom-detail'), fold: !!fold && !fold.hidden };
  });
  ok(xg.row && !xg.pricing && xg.accom && xg.fold, `"Extra guests" opens the cottage's rates editor on screen (${JSON.stringify(xg)})`);

  console.log('§9 the analytics VISITS trend is a GRAPH — bars PAINT, a dense axis thins');
  // The bars are measured, not asserted from markup: the old composer set each
  // bar's height as a PERCENTAGE of an auto-height flex column, which resolves
  // to nothing — every chart it ever drew painted its bars at 0px and only the
  // labels showed, which is exactly what a class check could never see.
  const p5 = await page.evaluate(async () => {
    const realGet = window.apiGet;
    window.apiGet = async (url) => {
      const m = /days=(\d+)/.exec(String(url));
      if (String(url).includes('track.php')) {
        const n = m && m[1] === '7' ? 7 : 30;
        const daily = Array.from({ length: n }, (_, i) => ({
          date: `2026-07-${String(i + 1).padStart(2, '0')}`,
          views: i === n - 1 ? 120 : 10 + i,
        }));
        return { days: n, totalViews: 500, uniqueVisitors: 100, bookings: 2, enquiries: 1, visitorMix: { new: 90, returning: 10 }, daily, pages: [], sources: [], devices: [], searches: [] };
      }
      return realGet(url);
    };
    settingsOpen('analytics');
    await new Promise((r) => setTimeout(r, 600));
    const read = () => {
      const bars = [...document.querySelectorAll('#analytics-body .osv-bar')].map((el) => el.getBoundingClientRect().height);
      const col = document.querySelector('#analytics-body .osv-bar');
      return {
        n: bars.length,
        min: Math.min(...bars),
        max: Math.max(...bars),
        ticks: [...document.querySelectorAll('#analytics-body .osv-tick')].filter((el) => el.textContent.trim()).length,
        colKids: col ? col.parentElement.children.length : 0, // 2 dense (no value label), 3 with it
      };
    };
    const dense = read();
    await loadAnalytics(7);
    await new Promise((r) => setTimeout(r, 400));
    const sparse = read();
    window.apiGet = realGet;
    return { dense, sparse };
  });
  ok(p5.dense.n === 30 && p5.dense.min >= 3 && p5.dense.max > p5.dense.min * 5,
    `30 days: every bar paints, heights proportional (${Math.round(p5.dense.min)}–${Math.round(p5.dense.max)}px)`);
  ok(p5.dense.ticks <= 12 && p5.dense.colKids === 2,
    `…dense window thins the axis and drops per-bar values (${p5.dense.ticks} ticks)`);
  ok(p5.sparse.n === 7 && p5.sparse.min >= 3 && p5.sparse.ticks === 7 && p5.sparse.colKids === 3,
    `7 days: every day labelled with its value, bars still paint (${p5.sparse.ticks} ticks)`);

  console.log(fails ? `MANAGE CHECK FAILED ❌ (${fails})` : 'MANAGE CHECK PASSED ✅');
  await done(fails);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
