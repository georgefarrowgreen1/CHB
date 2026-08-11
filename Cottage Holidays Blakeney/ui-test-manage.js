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
    return {
      grps: list ? list.querySelectorAll('.bhub-fold-grp').length : 0,
      jbWarn: !!list.querySelector('[data-grp="cal-jollyboat"] .st-cap.is-warn .st-wic'),
      a21ok: !!list.querySelector('[data-grp="cal-21a"] .st-cap.is-ok .st-tick'),
      jbSub: (list.querySelector('[data-grp="cal-jollyboat"] .bhub-fold-sub') || {}).textContent || '',
      runInFold: !!list.querySelector('#bhub-fold-cal-jollyboat [data-act="runSync"]'),
      editRoute: !!list.querySelector('#bhub-fold-cal-jollyboat [data-act="settingsOpenCalendar"]'),
    };
  });
  ok(cal.grps >= 2, `every cottage is a verdict group (${cal.grps})`);
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

  console.log(fails ? `MANAGE CHECK FAILED ❌ (${fails})` : 'MANAGE CHECK PASSED ✅');
  await done(fails);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
