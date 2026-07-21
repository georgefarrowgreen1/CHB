// Manage → Search learning page, end to end in a real browser:
//  1. the Manage row opens the section; the status card + three panels render
//  2. a dead-end search shows with Try again / Means / Forget; teaching it moves
//     the phrase into "What you've taught it" and clears the dead-end
//  3. Un-teach removes a taught phrase; Restore removes a suppressed one
const { boot } = require('./ui-test-lib'); // pins TZ=Europe/London at require time
let fails = 0;
const ok = (b, m) => { console.log(`  ${b ? '✓' : '✗'} ${m}`); if (!b) fails++; };

(async () => {
  const { page, browser, base, done } = await boot({ viewport: { width: 1000, height: 900 } });
  await page.route(/\.php/, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, bookings: [], enquiries: [], threads: [], reviews: [], photos: [], events: [], logs: {}, content: {}, properties: [], seasons: {}, occupancy: {} }) }));
  await page.goto(`${base}/index.html`, { waitUntil: 'networkidle' });
  await page.evaluate(async () => { isAuthenticated = true; document.body.classList.add('owner-mode'); await window.loadAdminBundle(); });
  await page.waitForTimeout(300);

  // Seed the teach-loop data: one dead-end, one taught phrase, one suppressed.
  await page.evaluate(() => {
    chbNluStore('chb-search-misses', [{ t: 'gift vouchers', n: 3, at: '2026-07-17' }]); CHB_NLU.misses = null;
    chbNluStore('chb-nlu-learned', [{ t: 'money coming in', c: 'revenue this year' }]); CHB_NLU.learned = null;
    chbNluStore('chb-nlu-suppressed', ['literal thing']); CHB_NLU.suppressed = null;
  });

  // 1) Open the Manage section.
  await page.evaluate(() => { nav('view-settings'); settingsOpen('search-learning'); });
  await page.waitForTimeout(300);
  const s = await page.evaluate(() => {
    const body = document.getElementById('search-learning-body');
    return {
      view: (document.querySelector('.page-view.active') || {}).id,
      shown: (document.getElementById('sec-search-learning') || { style: {} }).style.display !== 'none',
      title: (document.getElementById('settings-panel-title') || {}).textContent || '',
      stats: [...(body ? body.querySelectorAll('.sl-stat-n') : [])].map((e) => e.textContent),
      hasMiss: /gift vouchers/.test(body ? body.textContent : ''),
      hasTaught: /money coming in/.test(body ? body.textContent : ''),
      hasSuppressed: /literal thing/.test(body ? body.textContent : ''),
      sections: [...(body ? body.querySelectorAll('.settings-section-label') : [])].map((e) => e.textContent),
    };
  });
  ok(s.view === 'view-settings' && s.shown, `the Manage section opens (${s.view})`);
  ok(/Search learning/.test(s.title), `panel title reads "Search learning" (${s.title})`);
  ok(s.stats.join(',') === '1,1,1', `status tiles count taught/literal/dead-ends (${s.stats.join(',')})`);
  ok(s.hasMiss && s.hasTaught && s.hasSuppressed, 'all three lists render their seeded entries');
  ok(s.sections.length === 3, `three grouped panels (${s.sections.join(' / ')})`);

  // 2) Teach the dead-end: pick a "Means: …" suggestion (or synthesize one).
  const taught = await page.evaluate(() => {
    slTeach('gift vouchers', 'revenue this year'); // the page's teach handler
    const body = document.getElementById('search-learning-body');
    return {
      missGone: !chbMissList().some((m) => m.t === 'gift vouchers'), // no longer a dead-end
      nowTaught: chbNluLearned().some((x) => x.t === 'gift vouchers'), // joined the learned set
      inTaughtPanel: /means .revenue this year./.test(body.textContent), // and shows in the taught panel
    };
  });
  ok(taught.missGone, 'teaching the dead-end clears it from the dead-end list');
  ok(taught.nowTaught && taught.inTaughtPanel, 'the taught phrase joins the learned set + shows under "taught"');

  // 3) Un-teach + Restore.
  const cleaned = await page.evaluate(() => {
    slUnlearn('money coming in');
    slRestore('literal thing');
    return {
      learnedGone: !chbNluLearned().some((x) => x.t === 'money coming in'),
      supGone: !chbNluSuppressed().includes('literal thing'),
      bodyClean: (() => { const b = document.getElementById('search-learning-body').textContent; return !/money coming in/.test(b) && !/literal thing/.test(b); })(),
    };
  });
  ok(cleaned.learnedGone, 'Un-teach removes a taught phrase');
  ok(cleaned.supGone, 'Restore removes a suppressed phrase');
  ok(cleaned.bodyClean, 'the page re-renders without the removed entries');

  // 4) Test-the-assistant sandbox: a known ops phrasing reports "answered".
  const probe = await page.evaluate(() => {
    slProbe('who owes me money');
    const out = document.getElementById('sl-probe-out');
    return { badge: (out.querySelector('.sl-probe-badge') || {}).textContent || '', ok: !!out.querySelector('.sl-probe-ok') };
  });
  ok(probe.ok && /Understood|Answered|meaning/.test(probe.badge), `sandbox reports a real question as answered (${probe.badge})`);
  const probeNone = await page.evaluate(() => { slProbe('zxqw plmk nonsense'); const out = document.getElementById('sl-probe-out'); return !!out.querySelector('.sl-probe-muted'); });
  ok(probeNone, 'sandbox reports gibberish as "nothing yet"');

  // 5) Teach-to-any-answer picker: seed a fresh dead-end, pick a canonical, teach.
  await page.evaluate(() => { chbNluStore('chb-search-misses', [{ t: 'takings so far', n: 1, at: '2026-07-17' }]); CHB_NLU.misses = null; chbNluStore('chb-nlu-learned', []); CHB_NLU.learned = null; renderSearchLearning(); });
  const picker = await page.evaluate(() => {
    const canon = slCanonicals()[0]; // any real answerable question-type
    const sel = document.getElementById('sl-canon-' + chbNluHashStr('takings so far'));
    const hasOpts = sel && sel.options.length > 3;
    sel.value = canon; slTeachSelect('takings so far');
    return { hasOpts, taught: chbNluLearned().some((x) => x.t === 'takings so far' && x.c === canon), missGone: !chbMissList().some((m) => m.t === 'takings so far') };
  });
  ok(picker.hasOpts, 'the dead-end carries a full answer-type picker');
  ok(picker.taught && picker.missGone, 'picking an answer teaches the dead-end + clears it');

  // 6) Guest-side learning: seed guest questions the on-device FAQ couldn't
  // answer; they render as a panel; dismiss removes one; add-answer appends a FAQ.
  await page.evaluate(() => {
    if (typeof propertyMeta !== 'object' || !propertyMeta) window.propertyMeta = {};
    propertyMeta.jollyboat = propertyMeta.jollyboat || { name: 'Jollyboat' };
    siteContent['guest-faq-misses'] = [
      { q: 'is there a hairdryer?', n: 4, at: '2026-07-17', prop: 'jollyboat' },
      { q: 'can we bring a travel cot?', n: 1, at: '2026-07-16', prop: 'jollyboat' },
    ];
    siteContent['faqs-jollyboat'] = [];
    renderSearchLearning();
  });
  const guest = await page.evaluate(() => {
    const body = document.getElementById('search-learning-body').textContent;
    return { hasPanel: /Guests asked these/.test(body), hasQ: /is there a hairdryer/.test(body), mostAskedFirst: body.indexOf('hairdryer') < body.indexOf('travel cot') };
  });
  ok(guest.hasPanel && guest.hasQ, 'guest questions render in their own panel');
  ok(guest.mostAskedFirst, 'the most-asked guest question sorts first');

  const dismissed = await page.evaluate(() => {
    slDismissGuestQ('can we bring a travel cot?');
    return { gone: !slGuestQuestions().some((r) => r.q === 'can we bring a travel cot?'), bodyClean: !/travel cot/.test(document.getElementById('search-learning-body').textContent) };
  });
  ok(dismissed.gone && dismissed.bodyClean, 'Dismiss removes a guest question');

  const added = await page.evaluate(async () => {
    window.glassPrompt = () => Promise.resolve('Yes — a hairdryer is in every bathroom.'); // auto-answer the modal
    await slAddFaq('is there a hairdryer?', 'jollyboat');
    return {
      faqAdded: (siteContent['faqs-jollyboat'] || []).some((f) => /hairdryer/.test(f.q) && /every bathroom/.test(f.a)),
      qCleared: !slGuestQuestions().some((r) => r.q === 'is there a hairdryer?'),
    };
  });
  ok(added.faqAdded, 'Add instant answer appends the Q&A to the cottage FAQ');
  ok(added.qCleared, 'adding an answer clears the guest question');

  console.log(fails ? `\n  ${fails} SEARCH-LEARNING CHECK(S) FAILED ❌` : '\n  SEARCH-LEARNING SUITE PASSED ✅');
  await done(fails);
})();
