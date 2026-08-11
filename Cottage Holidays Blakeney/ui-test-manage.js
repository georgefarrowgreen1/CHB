// MANAGE'S VERDICTS + the calendar-feeds verdict list, in a real browser:
//  §1 the landing leads with a pulse + exception (a stalled feed) above the
//     untouched toolbox; the verdict groups read the SAME stores the pills
//     and badges read (bootstrap cron/feeds, __nyMod, chbMissList)
//  §2 the exception rule both ways (fresh feeds → no red), and the To-approve
//     verdict counts what the moderation lists hold
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
  await page.route(/\.php/, (route) => {
    const url = route.request().url();
    const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    let b = {}; try { b = JSON.parse(route.request().postData() || '{}'); } catch (e) {}
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
    if (url.includes('photos.php')) return json({ ok: true, photos: [] });
    if (url.includes('experiences.php')) return json({ ok: true, experiences: [] });
    if (url.includes('ical-import.php')) {
      if (b.action === 'sync') return json({ ok: true, imported: 14 });
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

  console.log('§1 the landing: pulse + exception above the toolbox');
  const land = await page.evaluate(() => {
    const host = document.getElementById('manage-verdicts');
    const caps = [...host.querySelectorAll('.bhub-grpcap')].map((c) => c.textContent.trim());
    return {
      pulse: (host.querySelector('.mo-pulse') || {}).textContent || '',
      caps,
      attnFirst: caps[0] === 'Needs attention',
      feedRow: /Calendar sync has stalled — Jollyboat/.test(host.textContent),
      feedCapWarn: !!host.querySelector('[data-grp="mgfeed0"] .st-cap.is-warn .st-wic'),
      sysSub: (host.querySelector('[data-grp="mgsys"] .bhub-fold-sub') || {}).textContent || '',
      sysTrouble: /1 in trouble/.test((document.getElementById('bhub-fold-mgsys') || {}).textContent || ''),
      runSyncInFold: !!host.querySelector('#bhub-fold-mgfeed0 [data-act="runSync"]'),
      toolboxIntact: !!document.querySelector('#settings-index .settings-group .settings-row[data-arg="reviews"]'),
      foldsClosed: [...host.querySelectorAll('.bhub-fold')].every((f) => f.hidden),
    };
  });
  ok(/automation needs a look/.test(land.pulse), `the pulse states the day's work (${land.pulse})`);
  ok(land.attnFirst && land.feedRow, 'the stalled feed is the exception, above everything');
  ok(land.feedCapWarn, 'it wears the warning capsule with the triangle');
  ok(land.runSyncInFold, 'Run-the-sync is one tap inside the exception fold');
  ok(land.sysTrouble, 'the System-check fold counts the same trouble (one source, two surfaces)');
  ok(land.toolboxIntact, 'the toolbox rows below are untouched');
  ok(land.foldsClosed, 'every verdict starts folded');

  console.log('§2 the verdicts read the real stores, both ways');
  const mod = await page.evaluate(() => ({
    cap: ((document.querySelector('#manage-verdicts [data-grp="mgmod"] .st-cap') || {}).textContent || ''),
    revRow: /Reviews/.test((document.getElementById('bhub-fold-mgmod') || {}).textContent || '') && /1 waiting/.test((document.getElementById('bhub-fold-mgmod') || {}).textContent || ''),
  }));
  ok(/1 waiting/.test(mod.cap), `To approve counts the pending review (${mod.cap.trim()})`);
  ok(mod.revRow, '…and its fold names which queue holds it');
  // Fresh feeds → the red section stands down and the pulse relaxes.
  feedsStalled = false;
  const down = await page.evaluate(async () => {
    const ab = await apiGet('admin-bootstrap.php');
    window.__cronStatusPre = ab.cron; window.__feedStatusPre = ab.feeds;
    manageVerdicts();
    const host = document.getElementById('manage-verdicts');
    return {
      attnGone: ![...host.querySelectorAll('.bhub-grpcap')].some((c) => c.textContent.trim() === 'Needs attention'),
      sysOk: !!host.querySelector('[data-grp="mgsys"] .st-cap.is-ok .st-tick'),
      feedsFresh: /all fresh/.test((document.getElementById('bhub-fold-mgsys') || {}).textContent || ''),
    };
  });
  ok(down.attnGone, 'fresh feeds → no red section at all');
  ok(down.sysOk && down.feedsFresh, 'System check flips to the green ✓ capsule and says the feeds are fresh');
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
    // The cottages breathe (owner-asked): measured air between VERTICALLY
    // consecutive cards. At desktop width the settings section flows in CSS
    // columns, so DOM order is not screen order — group by column (left edge),
    // sort by top, and measure within each column.
    const cards = list ? [...list.querySelectorAll('.bhub-fold-grp')] : [];
    const byCol = {};
    cards.forEach((el) => {
      const b = el.getBoundingClientRect();
      (byCol[Math.round(b.left / 50)] = byCol[Math.round(b.left / 50)] || []).push(b);
    });
    let minGap = 999;
    Object.values(byCol).forEach((col) => {
      col.sort((a, b) => a.top - b.top);
      for (let i = 1; i < col.length; i++) minGap = Math.min(minGap, col[i].top - col[i - 1].bottom);
    });
    return {
      minGap,
      grps: list ? list.querySelectorAll('.bhub-fold-grp').length : 0,
      jbWarn: !!list.querySelector('[data-grp="cal-jollyboat"] .st-cap.is-warn .st-wic'),
      a21ok: !!list.querySelector('[data-grp="cal-21a"] .st-cap.is-ok .st-tick'),
      jbSub: (list.querySelector('[data-grp="cal-jollyboat"] .bhub-fold-sub') || {}).textContent || '',
      runInFold: !!list.querySelector('#bhub-fold-cal-jollyboat [data-act="runSync"]'),
      editRoute: !!list.querySelector('#bhub-fold-cal-jollyboat [data-act="settingsOpenCalendar"]'),
    };
  });
  ok(cal.grps >= 2, `every cottage is a verdict group (${cal.grps})`);
  ok(cal.minGap >= 12, `…with clear air between the cottages (${Math.round(cal.minGap)}px)`);
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
  ok(/none yet|photo/.test(cot.photosCap), `the Photos verdict counts the gallery (${cot.photosCap.trim()})`);
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
    const welled = ['text', 'house', 'safety', 'seasons', 'arrival', 'location', 'local', 'faq', 'welcome', 'opsnotes'].filter((id) => {
      const f = document.getElementById('bhub-fold-ac-21a-' + id);
      return f && f.querySelector('.acr-cap') && f.querySelector('.acr-well');
    });
    // Verdicts count the loaded stores.
    const cap = (id) => ((detail.querySelector(`[data-grp="ac-21a-${id}"] .st-cap`) || {}).textContent || '').trim();
    const verdicts = { text: cap('text'), seasons: cap('seasons'), faq: cap('faq') };
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
  ok(uni.welled === 10, `all ten rebuilt sections render captioned wells (${uni.welled})`);
  ok(/2 features/.test(uni.verdicts.text) && /1 season/.test(uni.verdicts.seasons) && /1 answer/.test(uni.verdicts.faq), `the fold verdicts count the loaded stores (${uni.verdicts.text} / ${uni.verdicts.seasons} / ${uni.verdicts.faq})`);
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
      acts: cells.length ? ['accomMovePhoto', 'accomReplacePhoto', 'accomRemovePhoto'].every((fn) => cells[0].querySelector(`[data-act="${fn}"]`)) : false,
      pvLive,
      saved,
    };
  });
  ok(pb.gridDisplay === 'grid' && pb.cells >= 3, `the gallery is a grid of cells (${pb.cells})`);
  ok(pb.mainFirst, 'MAIN badges the first photo and only the first');
  ok(pb.acts, 'each cell keeps reorder / replace / remove on the real data-acts');
  ok(pb.pvLive === 'The Flint Loft', `the tile preview follows the title as you type (${pb.pvLive})`);
  ok(pb.saved.length === 2, `Save card writes both content keys (${pb.saved.join(', ')})`);

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
  ok(/field/.test(wc.textCap) && /image|none found/.test(wc.imgCap), `the capsules count the real fields (${wc.textCap.trim()} / ${wc.imgCap.trim()})`);
  ok(wc.foldsClosed, 'both groups start folded');
  ok(wc.fieldInFold && wc.imgBtnInFold, 'the real ce-<key> editors + Replace-image live inside the folds');

  console.log('§6 the settings pages wear the unified anatomy (switch sheets + forms)');
  const p1 = await page.evaluate(async () => {
    settingsOpen('follow-ups');
    const fu = {
      ids: !!document.querySelector('#sec-follow-ups .chb-switch #enq-nudge-toggle') && !!document.querySelector('#sec-follow-ups .chb-switch #anniv-nudge-toggle'),
      well: !!document.querySelector('#sec-follow-ups .acr-well'),
    };
    settingsOpen('notify');
    await new Promise((r) => setTimeout(r, 300));
    const nf = {
      rows: document.querySelectorAll('#notify-prefs-body .acr-row .chb-switch input').length,
      quiet: document.querySelectorAll('#notify-prefs-body select.acw-pill').length,
    };
    settingsOpen('sms');
    const sms = { sw: !!document.querySelector('#sec-sms .chb-switch #sms-on'), wells: document.querySelectorAll('#sec-sms .acr-well').length, token: (document.getElementById('sms-token') || {}).type };
    settingsOpen('payments');
    await new Promise((r) => setTimeout(r, 300));
    const dep = document.getElementById('sq-deposit-pct');
    dep.value = '25';
    const plus = [...document.querySelectorAll('#sec-payments [data-act="occStep"]')].find((b) => (b.getAttribute('aria-label') || '').includes('more'));
    plus.click();
    await new Promise((r) => setTimeout(r, 120));
    const pay = { bumped: dep.value, twofa: !!document.querySelector('#sec-security .chb-switch #admin-2fa-toggle') };
    settingsOpen('chat-away');
    const away = { sw: !!document.querySelector('#chat-away-editor .chb-switch input[data-key="chat-away-enabled"]'), pills: document.querySelectorAll('#chat-away-editor select.acw-pill').length };
    return { fu, nf, sms, pay, away };
  });
  ok(p1.fu.ids && p1.fu.well, 'Follow-up emails: the REAL toggles wear the switch, in a well');
  ok(p1.nf.rows === 4 && p1.nf.quiet === 2, `Notifications: the four categories are switch rows + quiet-hour pills (${p1.nf.rows}/${p1.nf.quiet})`);
  ok(p1.sms.sw && p1.sms.wells === 2 && p1.sms.token === 'password', `Text messages: switch + two wells, the token stays write-only (${p1.sms.wells})`);
  ok(p1.pay.bumped === '26', `Payments: the deposit stepper bumps the input only — Save stays the write (${p1.pay.bumped})`);
  ok(p1.pay.twofa, 'Security: two-step sign-in is the switch on the real toggle');
  ok(p1.away.sw && p1.away.pills === 2, 'Away auto-reply: the switch + hour pills on the real save keys');

  console.log('§7 moderation queues + people lists wear the anatomy (batch 2)');
  const p2 = await page.evaluate(async () => {
    settingsOpen('chat-answers');
    const ca = { frows: document.querySelectorAll('#chat-answers-editor .acr-well .acw-frow').length, saves: /Saves by itself/.test((document.getElementById('chat-answers-editor') || {}).textContent || '') };
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
      resetOnlyWithAccount: document.querySelectorAll('#guest-admin-list [data-act="resetGuestPassword"]').length === 1,
    };
    settingsOpen('reviews');
    await new Promise((r) => setTimeout(r, 350));
    const rv = {
      qrow: !!document.querySelector('#guest-review-moderation .acw-qrow'),
      cap: !!document.querySelector('#guest-review-moderation .st-cap.is-warn'),
      pills: !!document.querySelector('#guest-review-moderation .acw-modacts .mod-ok') && !!document.querySelector('#guest-review-moderation .acw-modacts .mod-no'),
    };
    return { ca, wl, ga, rv };
  });
  ok(p2.ca.frows >= 3 && p2.ca.saves, `Instant chat answers: the chips' questions as labelled boxes in a well (${p2.ca.frows})`);
  ok(p2.wl.rows === 2 && p2.wl.notified && p2.wl.waiting && p2.wl.acts, 'Waitlist: person rows with truth-telling capsules + the real actions');
  ok(p2.ga.rows === 2 && p2.ga.fig && p2.ga.hooks, 'Guest accounts: person rows with serif lifetime spend + the data-gemail hooks');
  ok(p2.ga.resetOnlyWithAccount, 'Reset password only offered where an account exists');
  ok(p2.rv.qrow && p2.rv.cap && p2.rv.pills, 'Reviews: the pending item is a moderation row with verdict pills');

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
  ok(/1 change to save/.test(p3b.msg), `the save bar counts a moved range as ONE change ("${p3b.msg}")`);

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

  const p3d = await page.evaluate(async () => {
    settingsOpen('pricing');
    await new Promise((r) => setTimeout(r, 300));
    const pb = document.getElementById('pricing-body');
    return { caps: pb ? [...pb.querySelectorAll('.settings-section-label')].every((l) => getComputedStyle(l).textTransform === 'uppercase') : false, has: pb ? pb.querySelectorAll('.settings-section-label').length >= 2 : false };
  });
  ok(p3d.has && p3d.caps, 'Pricing wears the caption vocabulary over its idea rows');

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
