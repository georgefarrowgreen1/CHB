// The dedicated SEARCH PAGE (all search now lives behind the dock's knot
// logo), end to end in a real browser — consolidating the essential coverage
// the retired per-workspace Assist Bar suites carried:
//  1. openCmdK → the search WINDOW opens OVER the workspace (which must not
//     change), input focused, morning brief renders
//  2. answers render on the page; a literal query doesn't light the model
//  3. an NLU paraphrase lights the logo (understood/meaning) — colour, no words
//  4. conversational follow-up: a surfaced booking resolves "email them"
//  5. teaching flashes the logo + dock orange, then clears
//  6. Darkstar load → body flag + quiet purple ready logo
//  7. cmdkBack / ⌘K toggle return to the workspace you came from
//  8. leaving on an unanswered query files a search miss (teach loop)
const { d, boot } = require('./ui-test-lib'); // pins TZ=Europe/London at require time
let fails = 0;
const ok = (b, m) => { console.log(`  ${b ? '✓' : '✗'} ${m}`); if (!b) fails++; };

(async () => {
  const { page, browser, base, done } = await boot({ viewport: { width: 900, height: 900 } });
  const d = (n) => { const t = new Date(); const x = new Date(t.getFullYear(), t.getMonth(), t.getDate() + n); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
  const bookings = [{ id: 1, prop_key: 'jollyboat', name: 'Bob Carter', email: 'b@x.co', phone: '', check_in: d(10), check_out: d(13), adults: 2, children: 0, payment: 'deposit', deposit_paid: 100, agreed_total: 500, hold_status: 'none' }];
  await page.route(/\.php/, (route) => {
    const url = route.request().url();
    const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (url.includes('bookings.php') && route.request().method() !== 'POST') return json({ bookings });
    if (url.includes('rates.php') && route.request().method() !== 'POST') return json({ properties: [
      { prop_key: 'jollyboat', name: 'Jollyboat', slug: 'jollyboat', couple_rate: 130, extra_adult_rate: 20, child_rate: 10, transaction_pct: 0, booking_fee: 50, max_adults: 2, max_children: 0, max_total: 2, sort_order: 1 },
    ], seasons: {}, occupancy: {} });
    return json({ ok: true, events: [], logs: {}, results: [], threads: [], enquiries: [], reviews: [], photos: [], value: null, corpus: [], content: {} });
  });
  await page.goto(`${base}/index.html`, { waitUntil: 'networkidle' });
  await page.evaluate(async () => { isAuthenticated = true; document.body.classList.add('owner-mode'); await window.loadAdminBundle(); });
  await page.evaluate(() => loadData()); await page.waitForTimeout(400);
  await page.evaluate(() => nav('view-backoffice')); await page.waitForTimeout(300);

  // 1) The dock's knot → the dedicated search page.
  await page.evaluate(() => openCmdK()); await page.waitForTimeout(400);
  let st = await page.evaluate(() => ({
    view: (document.querySelector('.page-view.active') || {}).id,
    cmdkOpen: !!document.getElementById('cmdk').classList.contains('open'),
    focused: document.activeElement === document.getElementById('cmdk-input'),
    rows: document.querySelectorAll('#cmdk-results .cmdk-row').length,
  }));
  // Search is a WINDOW now: it covers the workspace instead of replacing it, so
  // the active view must be UNCHANGED and the overlay must be up.
  ok(st.cmdkOpen === true, `openCmdK opens the search WINDOW (open=${st.cmdkOpen})`);
  ok(st.view !== 'view-search', `and the workspace underneath is untouched (${st.view})`);
  ok(st.focused, 'the input takes focus');
  ok(st.rows > 0, `the empty landing renders the brief (${st.rows} rows)`);

  // 2) A literal query answers on the page without lighting the model.
  await page.evaluate(() => { document.getElementById('cmdk-input').value = 'who owes money'; cmdkSearchCore('who owes money', false); });
  await page.waitForTimeout(300);
  st = await page.evaluate(() => ({
    // The leading ANSWER now renders as the hero (.cmdk-hero-label), not as an
    // ordinary row — so read whichever carries it rather than pinning one shape.
    // Reading .cmdk-row-label alone silently picked up the SECOND row and reported
    // a ranking regression that had not happened.
    top: (document.querySelector('#cmdk-results .cmdk-hero-label, #cmdk-results .cmdk-row .cmdk-row-label') || {}).textContent || '',
    mstate: (document.getElementById('cmdk-ml') || {}).dataset.mstate,
  }));
  ok(/£400/.test(st.top), `literal ops question answers on the page (${st.top.slice(0, 50)})`);
  // (Darkstar auto-loads during boot, so semantic recall may tag extra rows
  // "meaning" — the check is that a literal query is never an NLU REWRITE.)
  ok(!/understood|guess/.test(st.mstate || ''), `literal query is never an NLU rewrite (${st.mstate || 'rest'})`);

  // 3) An NLU paraphrase lights the logo.
  await page.evaluate(() => { document.getElementById('cmdk-input').value = 'is anyone in arrears with me'; cmdkSearchCore('is anyone in arrears with me', false); });
  await page.waitForTimeout(300);
  st = await page.evaluate(() => {
    const ml = document.getElementById('cmdk-ml');
    return { mstate: ml.dataset.mstate, title: ml.title };
  });
  ok(/understood|meaning/.test(st.mstate || ''), `NLU paraphrase lights the logo (${st.mstate})`);
  ok(/Matched your wording|Found by meaning/.test(st.title || ''), 'the hover title explains the state');

  // 4) Conversational follow-up: the surfaced booking resolves a pronoun.
  await page.evaluate(() => { document.getElementById('cmdk-input').value = 'when does bob arrive'; cmdkSearchCore('when does bob arrive', false); });
  await page.waitForTimeout(200);
  const follow = await page.evaluate(() => { const r = cmdkIntent('email them') || []; return { head: r[0] ? r[0].label : '(none)', mail: r.some((x) => /email|mail/i.test((x && x.label) || '')) }; });
  ok(/Bob Carter/.test(follow.head) && follow.mail, `"email them" resolves the surfaced booking (${follow.head})`);

  // 4b) Keyboard reaches a selected row's quick-actions (Left/Right) + two-stage
  // Escape (clear the query, then leave). Bob's booking row carries actions.
  await page.evaluate(() => { const el = document.getElementById('cmdk-input'); el.value = 'bob carter'; cmdkSearchCore('bob carter', false); });
  await page.waitForTimeout(200);
  const kb0 = await page.evaluate(() => {
    // Select the first row that actually has quick-actions.
    const idx = __cmdkResults.findIndex((r) => Array.isArray(r.actions) && r.actions.length);
    __cmdkSel = idx; __cmdkActSel = -1; cmdkRender();
    return { idx, acts: (__cmdkResults[idx] || {}).actions ? __cmdkResults[idx].actions.length : 0 };
  });
  ok(kb0.idx >= 0 && kb0.acts > 0, `a booking row exposes quick-actions (${kb0.acts})`);
  // 4b-i) The keyboard must work through the REAL delegation path (a dispatched
  // keydown on the input), not just a direct cmdkKey() call — a CSP-migration
  // regression left two data-pass attributes on the input, so keydown delivered
  // the string value instead of the event and ALL nav silently died. Dispatch a
  // genuine ArrowDown and assert the selection actually moved.
  const realKb = await page.evaluate(() => {
    const el = document.getElementById('cmdk-input');
    __cmdkSel = __cmdkResults.findIndex((r) => Array.isArray(r.actions) && r.actions.length);
    __cmdkActSel = -1; cmdkRender();
    const before = __cmdkActSel;
    // A genuine dispatched keydown (not a direct cmdkKey call) — proves the event
    // reaches the handler through delegation. ArrowRight steps into quick-actions.
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    return { before, after: __cmdkActSel };
  });
  ok(realKb.before === -1 && realKb.after === 0, `a dispatched keydown reaches cmdkKey via delegation (actSel ${realKb.before}→${realKb.after})`);
  // 4b-ii) A real click on a quick-action row must fire cmdkAct, not silently
  // no-op (the row previously carried a stray data-act="<index>" that shadowed
  // the chbAttrs handler). Stub cmdkAct and assert a click reaches it.
  const realClick = await page.evaluate(() => {
    __cmdkSel = __cmdkResults.findIndex((r) => Array.isArray(r.actions) && r.actions.length);
    __cmdkActSel = -1; cmdkRender();
    const orig = window.cmdkAct; let got = null;
    window.cmdkAct = (i, k) => { got = { i, k }; };
    const row = document.querySelector('#cmdk-results .cmdk-qa-row');
    if (row) row.click();
    window.cmdkAct = orig;
    return { hadRow: !!row, got };
  });
  ok(realClick.hadRow && realClick.got && typeof realClick.got.i === 'number', `a click on a quick-action row reaches cmdkAct (${JSON.stringify(realClick.got)})`);
  const kb1 = await page.evaluate(() => { cmdkKey({ key: 'ArrowRight', preventDefault() {} }); return { sub: __cmdkActSel, marked: !!document.querySelector('#cmdk-results .cmdk-qa-row.is-kbd') }; });
  ok(kb1.sub === 0 && kb1.marked, `ArrowRight steps into the first quick-action + marks it (sub=${kb1.sub})`);
  const kb2 = await page.evaluate(() => { cmdkKey({ key: 'ArrowLeft', preventDefault() {} }); return { sub: __cmdkActSel, marked: !!document.querySelector('#cmdk-results .cmdk-qa-row.is-kbd') }; });
  ok(kb2.sub === -1 && !kb2.marked, 'ArrowLeft steps back out to the row itself');
  // Two-stage Escape: first clears the query, second leaves.
  await page.evaluate(() => { document.getElementById('cmdk-input').value = 'bob carter'; });
  const esc1 = await page.evaluate(() => { cmdkKey({ key: 'Escape', preventDefault() {} }); return { val: document.getElementById('cmdk-input').value, cmdkOpen: document.getElementById('cmdk').classList.contains('open') }; });
  ok(esc1.val === '' && esc1.cmdkOpen === true, `first Escape clears the query, window stays up (open=${esc1.cmdkOpen})`);
  await page.evaluate(() => { cmdkKey({ key: 'Escape', preventDefault() {} }); }); await page.waitForTimeout(200);
  const esc2 = await page.evaluate(() => document.getElementById('cmdk').classList.contains('open'));
  ok(esc2 === false, `second Escape closes the window (open=${esc2})`);
  await page.evaluate(() => openCmdK()); await page.waitForTimeout(200);

  // 5) Teaching flashes the logo + dock orange, then clears.
  await page.evaluate(() => chbNluLearn('utterly novel phrasing zq', 'who owes me money'));
  await page.waitForTimeout(150);
  st = await page.evaluate(() => ({
    ml: (document.getElementById('cmdk-ml') || {}).dataset.mstate,
    dock: document.querySelector('body.owner-mode .logo').classList.contains('ml-learning'),
  }));
  ok(st.ml === 'learning' && st.dock, `teach → learning flash on logo + dock (${st.ml})`);
  await page.waitForTimeout(2400);
  st = await page.evaluate(() => (document.getElementById('cmdk-ml') || {}).dataset.mstate);
  ok(st !== 'learning', 'the learning flash clears');

  // 6) Darkstar online → ready tint on the logo.
  await page.evaluate(() => darkstarLoad()); // real darkstar.bin served by php -S
  await page.waitForTimeout(600);
  await page.evaluate(() => { document.getElementById('cmdk-input').value = ''; cmdkSearchCore('', false); });
  st = await page.evaluate(() => ({
    ready: document.body.classList.contains('darkstar-ready'),
    mstate: (document.getElementById('cmdk-ml') || {}).dataset.mstate,
    color: getComputedStyle(document.getElementById('cmdk-ml')).color,
  }));
  ok(st.ready, 'body.darkstar-ready set once the model is loaded + indexed');
  ok(st.mstate === 'ready' && st.color === 'rgb(168, 85, 247)', `logo rests on the Darkstar purple (${st.mstate}, ${st.color})`);

  // 7) cmdkBack closes the window and leaves you where you already were; ⌘K toggles.
  await page.evaluate(() => cmdkBack()); await page.waitForTimeout(300);
  let closedOn = await page.evaluate(() => ({
    open: document.getElementById('cmdk').classList.contains('open'),
    view: (document.querySelector('.page-view.active') || {}).id,
  }));
  ok(!closedOn.open && closedOn.view === 'view-backoffice', `cmdkBack closes the window, workspace still there (${closedOn.view})`);
  await page.keyboard.press('Control+k'); await page.waitForTimeout(300);
  let view = await page.evaluate(() => document.getElementById('cmdk').classList.contains('open'));
  ok(view === true, `⌘K opens the search window (open=${view})`);
  await page.keyboard.press('Control+k'); await page.waitForTimeout(300);
  view = await page.evaluate(() => (document.querySelector('.page-view.active') || {}).id);
  ok(view === 'view-backoffice', `⌘K again toggles back (${view})`);

  // 8) Leaving on an unanswered query files a search miss (the teach loop).
  await page.evaluate(() => { chbNluStore('chb-search-misses', []); CHB_NLU.misses = null; });
  await page.evaluate(() => openCmdK()); await page.waitForTimeout(200);
  await page.evaluate(() => { document.getElementById('cmdk-input').value = 'fizzlewick doodah'; cmdkSearchCore('fizzlewick doodah', false); });
  await page.waitForTimeout(200);
  await page.evaluate(() => cmdkBack());
  const misses = await page.evaluate(() => chbMissList().map((m) => m.t));
  ok(misses.includes('fizzlewick doodah'), `dead-end query filed as a miss (${misses.join(', ')})`);

  // 9) Leaving via ANY other route (a dock nav, not the back button) also tears
  // the palette down — the miss is still filed and the conv-context cleared.
  await page.evaluate(() => { chbNluStore('chb-search-misses', []); CHB_NLU.misses = null; });
  await page.evaluate(() => openCmdK()); await page.waitForTimeout(150);
  await page.evaluate(() => { document.getElementById('cmdk-input').value = 'fizzlewick doodah'; cmdkSearchCore('fizzlewick doodah', false); });
  await page.waitForTimeout(150);
  await page.evaluate(() => { __cmdkConvCtx = { key: 'stale', name: 'Ghost' }; nav('view-inbox'); }); // leave via a dock view, NOT cmdkBack
  await page.waitForTimeout(200);
  const navLeave = await page.evaluate(() => ({
    view: (document.querySelector('.page-view.active') || {}).id,
    filed: chbMissList().map((m) => m.t).includes('fizzlewick doodah'),
    conv: (typeof __cmdkConvCtx === 'undefined' ? 'undef' : __cmdkConvCtx),
  }));
  ok(navLeave.view === 'view-inbox', `nav away lands on the target view (${navLeave.view})`);
  ok(navLeave.filed, 'leaving search by a dock nav still files the dead-end miss');
  ok(!navLeave.conv, 'the conversation context is cleared on dock-leave (no cross-session pronoun leak)');

  // ---- 8) the pop-out DROPS below the header ----
  // It used to grow to FULL BLEED and cover everything, including the crown — which
  // is why it needed a close chevron as the only way out. It is now the pop-out the
  // crown drops, so the contract inverted: it must NOT cover the header, the crown
  // must stay hittable so one target toggles both ways, and it must fit on screen
  // with the results scrolling inside rather than the panel running off the bottom.
  // The motion is still `transform` only — animating layout every frame is what
  // stuttered the dock icons.
  await page.evaluate(() => cmdkBack()); await page.waitForTimeout(700);
  const grow = await page.evaluate(async () => {
    const box = document.querySelector('#cmdk .cmdk-box');
    const samples = [];
    openCmdK();
    const t0 = performance.now();
    await new Promise((res) => {
      const tick = () => {
        const m = new DOMMatrixReadOnly(getComputedStyle(box).transform);
        samples.push(+m.f.toFixed(2)); // translateY — the drop
        if (performance.now() - t0 < 700) requestAnimationFrame(tick); else res();
      };
      requestAnimationFrame(tick);
    });
    return samples;
  });
  const distinct = new Set(grow).size;
  ok(distinct >= 5, `the pop-out DROPS rather than appearing (${distinct} distinct offsets sampled)`);
  ok(grow[0] < -1, `it starts above its resting place (first sample translateY ${grow[0]})`);
  ok(grow[grow.length - 1] === 0, `and settles home (last ${grow[grow.length - 1]})`);

  const full = await page.evaluate(() => {
    const b = document.querySelector('#cmdk .cmdk-box').getBoundingClientRect();
    const h = document.querySelector('header').getBoundingClientRect();
    const hit = document.elementFromPoint(Math.round(h.left + h.width / 2), Math.round(h.top + h.height / 2));
    const crown = document.querySelector('.logo');
    const cb = crown.getBoundingClientRect();
    const chit = document.elementFromPoint(Math.round(cb.left + cb.width / 2), Math.round(cb.top + cb.height / 2));
    const c = document.getElementById('cmdk-close');
    const cr = c ? c.getBoundingClientRect() : null;
    const res = document.getElementById('cmdk-results');
    return {
      top: Math.round(b.top), bottom: Math.round(b.bottom), w: Math.round(b.width),
      vw: window.innerWidth, vh: window.innerHeight,
      headerBottom: Math.round(h.bottom),
      headerCovered: !!(hit && hit.closest('#cmdk')),
      crownHittable: !!(chit && (chit === crown || crown.contains(chit) || chit.closest('.logo'))),
      scrolls: res ? getComputedStyle(res).overflowY : null,
      closeW: cr ? Math.round(cr.width) : 0, closeH: cr ? Math.round(cr.height) : 0,
      closeNamed: !!(c && (c.getAttribute('aria-label') || '').trim()),
    };
  });
  ok(full.top >= full.headerBottom, `it hangs BELOW the header (${full.top} >= ${full.headerBottom})`);
  ok(!full.headerCovered, 'the header is NOT covered — the crown has to stay reachable');
  ok(full.crownHittable, 'so the crown is still the top hit, and one target toggles both ways');
  ok(full.bottom <= full.vh, `the panel fits on screen (bottom ${full.bottom} of ${full.vh})`);
  ok(full.scrolls === 'auto' || full.scrolls === 'scroll', `with the results scrolling inside it (overflow-y ${full.scrolls})`);
  ok(full.w <= 560, `and it reads as a pop-out, not a page (${full.w}px wide)`);
  // The chevron is no longer the ONLY way out (crown, scrim and Escape all work),
  // but it is still the obvious one on a phone, so it stays and stays tappable.
  ok(full.closeW >= 24 && full.closeH >= 24, `there is a close control at 24px+ (${full.closeW}x${full.closeH})`);
  ok(full.closeNamed, 'and it carries an accessible name');
  await page.click('#cmdk-close'); await page.waitForTimeout(700);
  ok(await page.evaluate(() => !document.getElementById('cmdk').classList.contains('open')), 'tapping it closes the pop-out');

  // Reduced motion keeps the window (it is the whole feature) and drops the growth.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => openCmdK()); await page.waitForTimeout(500);
  const rm = await page.evaluate(() => {
    const box = document.querySelector('#cmdk .cmdk-box');
    return { open: document.getElementById('cmdk').classList.contains('open'), transform: getComputedStyle(box).transform };
  });
  ok(rm.open, 'with reduced motion the window still opens');
  ok(rm.transform === 'none', `it just does not grow (${rm.transform})`);
  await page.emulateMedia({ reducedMotion: null });

  // ---- 9. Every control in the window is actually STYLED, in BOTH themes.
  // `.cmdk-qa-row` was a <button> whose UA chrome had never been removed, so it
  // painted the browser's default control — an #efefef face, a 2px black border,
  // centred 13px system-font text. Nobody saw it because that face is nearly
  // invisible against light mode's cream; on a phone in dark mode it read as a
  // light-mode button dropped into a dark UI. The test is cheap and deterministic:
  // compare each control against a bare <button> made in the same document, so it
  // needs no colour model and cannot drift with the theme tokens.
  for (const theme of ['dark', 'light']) {
    await page.evaluate((th) => {
      document.body.classList.toggle('light-mode', th === 'light');
      try { closeCmdK(); } catch (e) {}
    }, theme);
    await page.waitForTimeout(250);
    // Quick-action rows only exist beneath a SELECTED RECORD, so the window has to
    // be answering a real booking AND that row has to be the selected one. Driven
    // the same way §4b does it — back to the workspace the default scope expects,
    // then select the row that actually carries actions. Typing the name alone was
    // not enough this late in the suite: the scope had moved on and the query came
    // back with only chat answers, which the row-count guard below caught.
    await page.evaluate(async () => {
      nav('view-backoffice');
      openCmdK();
      await new Promise((r) => setTimeout(r, 350));
      const i = document.getElementById('cmdk-input');
      if (i) { i.value = 'bob carter'; cmdkSearchCore('bob carter', false); }
      await new Promise((r) => setTimeout(r, 400));
      const idx = __cmdkResults.findIndex((r) => Array.isArray(r.actions) && r.actions.length);
      if (idx >= 0) { __cmdkSel = idx; __cmdkActSel = -1; cmdkRender(); }
      await new Promise((r) => setTimeout(r, 250));
    });
    const ua = await page.evaluate(() => {
      const bare = document.createElement('button');
      document.body.appendChild(bare);
      const b = getComputedStyle(bare);
      const uaBg = b.backgroundColor, uaFont = b.fontFamily;
      bare.remove();
      const bodyFont = getComputedStyle(document.body).fontFamily;
      const bad = [...document.querySelectorAll('#cmdk button')].filter((el) => {
        const cs = getComputedStyle(el);
        if (el.offsetParent === null) return false; // not rendered → nothing to judge
        return cs.backgroundColor === uaBg || (cs.fontFamily === uaFont && uaFont !== bodyFont);
      }).map((el) => `${el.className || el.id} (${getComputedStyle(el).backgroundColor})`);
      return { bad, qaRows: document.querySelectorAll('#cmdk .cmdk-qa-row').length,
        _diag: { rows: document.querySelectorAll('#cmdk .cmdk-row').length, sel: document.querySelectorAll('#cmdk .cmdk-row.is-sel').length, open: document.getElementById('cmdk').classList.contains('open'), val: (document.getElementById('cmdk-input')||{}).value, labels: [...document.querySelectorAll('#cmdk .cmdk-row-label')].slice(0,3).map(e=>e.textContent.trim()) } };
    });
    if (!ua.qaRows) console.log('     DIAG', JSON.stringify(ua._diag));
    ok(ua.qaRows > 0, `[${theme}] the quick-action rows are on screen to be judged (${ua.qaRows})`);
    ok(ua.bad.length === 0, `[${theme}] no control still carries default browser chrome${ua.bad.length ? ' — ' + ua.bad.join(', ') : ''}`);
  }
  await page.evaluate(() => document.body.classList.remove('light-mode'));

  // ---- 10. Full bleed changes what the card's styling MEANS, and these two are
  // what stop it looking unfinished. Both were measured wrong before:
  //  - the panel was glass (78% white over a 24px blur), which at screen size
  //    smears the entire back office through itself — grey blobs over the lower
  //    two thirds in light mode. It must be OPAQUE.
  //  - the content stretched the full 1280px, so a guest's name sat at the far
  //    left with ~1000px of nothing beside it. It must sit in a centred column.
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate(async () => {
    try { closeCmdK(); } catch (e) {}
    nav('view-backoffice');
    openCmdK();
    await new Promise((r) => setTimeout(r, 700));
    const i = document.getElementById('cmdk-input');
    if (i) { i.value = 'bob carter'; cmdkSearchCore('bob carter', false); }
    await new Promise((r) => setTimeout(r, 400));
    // Measure the pop-out's RESTING shape. With a record selected it widens to make
    // room for the split pane (see SPLIT below), and this section is about the
    // ordinary case — an earlier section leaving a booking selected was enough to
    // make these three read the wide box instead.
    __cmdkSel = -1;
    cmdkRender();
    await new Promise((r) => setTimeout(r, 250));
  });
  const bleed = await page.evaluate(() => {
    const box = document.querySelector('#cmdk .cmdk-box');
    const cs = getComputedStyle(box);
    const alpha = (s) => { const n = (s.match(/[\d.]+/g) || []); return n.length > 3 ? Number(n[3]) : 1; };
    const row = document.querySelector('#cmdk-results .cmdk-row');
    const field = document.getElementById('cmdk-input');
    const r = row && row.getBoundingClientRect();
    const f = field && field.getBoundingClientRect();
    return {
      boxW: Math.round(box.getBoundingClientRect().width),
      alpha: alpha(cs.backgroundColor),
      blur: (cs.backdropFilter || cs.webkitBackdropFilter || 'none'),
      rowW: r ? Math.round(r.width) : null,
      rowLeft: r ? Math.round(r.left) : null,
      fieldW: f ? Math.round(f.width) : null,
      vw: window.innerWidth,
    };
  });
  // Glass is RIGHT again at this size, and that is the inverse of the full-bleed
  // rule it replaces: 78% white over a 24px blur smeared the whole back office
  // through a screen-sized panel (measured in light mode as grey blobs over the
  // lower two thirds), but a 520px pop-out only blurs the workspace's EDGE — which
  // is the depth cue the material exists for.
  ok(bleed.boxW < bleed.vw, `the panel is a pop-out, not full bleed (${bleed.boxW} of ${bleed.vw})`);
  ok(bleed.alpha < 1, `so glass is back on (alpha ${bleed.alpha})`);
  ok(/blur/.test(bleed.blur), `with its backdrop blur (${bleed.blur})`);
  ok(bleed.rowW <= 560, `rows sit in a readable column, not the full 1280 (${bleed.rowW}px)`);
  ok(bleed.rowLeft > 200, `which is CENTRED, not hugging the left edge (left ${bleed.rowLeft}px)`);
  ok(bleed.fieldW <= 560, `and the field is a field, not a 1140px pill (${bleed.fieldW}px)`);
  await page.setViewportSize({ width: 900, height: 900 });

  // ---- 11. The four-part redesign: BOARDS, ANSWER hero, THREAD, SPLIT.
  // Each is a layout over the SAME result rows, so the thing worth pinning is that
  // the rows survive the new containers — a board or a pane that swallowed a row's
  // index would break keyboard nav silently.
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate(async () => {
    try { closeCmdK(); } catch (e) {}
    nav('view-backoffice');
    openCmdK();
    await new Promise((r) => setTimeout(r, 600));
  });
  const boards = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('#cmdk .cmdk-board')];
    return {
      n: cards.length,
      caps: cards.map((c) => (c.querySelector('.cmdk-board-cap') || {}).textContent || ''),
      rowsInBoards: document.querySelectorAll('#cmdk .cmdk-board .cmdk-row').length,
      // Every row still has to be an addressable option at its own index.
      optIds: [...document.querySelectorAll('#cmdk .cmdk-board .cmdk-row')].every((r) => /^cmdk-opt-\d+$/.test(r.id)),
      jump: !!document.querySelector('#cmdk .cmdk-group-label'),
    };
  });
  ok(boards.n >= 1, `BOARDS: the landing renders boards, not a flat list (${boards.n}: ${boards.caps.join(' / ')})`);
  ok(boards.rowsInBoards >= 1, `BOARDS: the day's rows live inside them (${boards.rowsInBoards})`);
  ok(boards.optIds, 'BOARDS: every board row keeps its cmdk-opt-<i> id, so keyboard nav survives');

  // ANSWER hero + THREAD: a chain of answered questions.
  const chain = await page.evaluate(async () => {
    const i = document.getElementById('cmdk-input');
    for (const q of ['who owes money', 'what did i earn this year']) {
      i.value = q; cmdkSearchCore(q, false);
      await new Promise((r) => setTimeout(r, 350));
    }
    const hero = document.querySelector('#cmdk .cmdk-hero');
    return {
      hero: !!hero,
      heroIsOption: !!(hero && /^cmdk-opt-\d+$/.test(hero.id) && hero.getAttribute('role') === 'option'),
      heroFig: (document.querySelector('#cmdk .cmdk-hero-fig') || {}).textContent || '',
      // The figure is emphasised by WEIGHT, at the sentence's own size. It used to be
      // 1.7em, which made "£290.00" tower over the words either side of it so the
      // answer stopped reading as a sentence.
      // Scoped to the LIVE hero: the thread renders its own .cmdk-hero-fig ABOVE it
      // (cmdkThreadHtml reuses cmdkHeroFigure), so a document-wide query measures
      // history instead of the answer — which is exactly what this check first did.
      figSize: (() => { const f = document.querySelector('#cmdk .cmdk-hero .cmdk-hero-fig'); return f ? getComputedStyle(f).fontSize : ''; })(),
      labSize: (() => { const l = document.querySelector('#cmdk .cmdk-hero-label'); return l ? getComputedStyle(l).fontSize : ''; })(),
      figWeight: (() => { const f = document.querySelector('#cmdk .cmdk-hero .cmdk-hero-fig'); return f ? +getComputedStyle(f).fontWeight : 0; })(),
      labWeight: (() => { const l = document.querySelector('#cmdk .cmdk-hero-label'); return l ? +getComputedStyle(l).fontWeight : 0; })(),
      cap: (document.querySelector('#cmdk .cmdk-group-label') || {}).textContent || '',
      turns: document.querySelectorAll('#cmdk .cmdk-turn').length,
      turnQ: (document.querySelector('#cmdk .cmdk-turn-q') || {}).textContent || '',
    };
  });
  ok(chain.hero, 'ANSWER: an answered query renders the hero, not an ordinary row');
  ok(chain.heroIsOption, 'ANSWER: the hero is still a role=option at its own index (keyboard + run intact)');
  ok(/£/.test(chain.heroFig), `ANSWER: the figure inside the sentence is emphasised (${chain.heroFig})`);
  ok(chain.figSize === chain.labSize, `ANSWER: at the SENTENCE'S size, not towering over it (figure ${chain.figSize} vs sentence ${chain.labSize})`);
  ok(chain.figWeight > chain.labWeight, `ANSWER: emphasised by weight instead (${chain.figWeight} vs ${chain.labWeight})`);
  ok(/answer/i.test(chain.cap), `ANSWER: the caption names it an answer, not a ranking (${chain.cap})`);
  ok(chain.turns >= 1, `THREAD: the earlier answered turn is kept on screen (${chain.turns})`);
  ok(/owes/.test(chain.turnQ), `THREAD: and it names the question that produced it (${chain.turnQ})`);

  // THREAD must not stack duplicates as you type, and must die with the session.
  const life = await page.evaluate(async () => {
    const i = document.getElementById('cmdk-input');
    const before = __cmdkThread.length;
    for (const q of ['who owes', 'who owes m', 'who owes money']) {
      i.value = q; cmdkSearchCore(q, false);
      await new Promise((r) => setTimeout(r, 220));
    }
    const afterTyping = __cmdkThread.length;
    i.value = ''; cmdkSearchCore('', false);
    await new Promise((r) => setTimeout(r, 220));
    return { before, afterTyping, afterClear: __cmdkThread.length };
  });
  // GROWTH, not the absolute: earlier turns from this session are legitimately still
  // there, and asserting a total silently measured them too.
  ok(life.afterTyping - life.before <= 1, `THREAD: three keystroke queries add ONE turn, not three (+${life.afterTyping - life.before})`);
  ok(life.afterClear === 0, `THREAD: clearing the field starts over (${life.afterClear})`);

  // SPLIT: a selected booking shows beside the list at >=1200px, and the pane is
  // a SUMMARY — it must never be the hub node, which lives elsewhere.
  const split = await page.evaluate(async () => {
    const i = document.getElementById('cmdk-input');
    i.value = 'bob carter'; cmdkSearchCore('bob carter', false);
    await new Promise((r) => setTimeout(r, 400));
    const idx = __cmdkResults.findIndex((r) => r && r.type === 'booking');
    if (idx >= 0) { __cmdkSel = idx; cmdkRender(); }
    await new Promise((r) => setTimeout(r, 250));
    const pane = document.querySelector('#cmdk .cmdk-detail');
    const list = document.querySelector('#cmdk .cmdk-split-list');
    const cs = pane && getComputedStyle(pane);
    return {
      pane: !!pane,
      visible: !!(cs && cs.display !== 'none'),
      name: (document.querySelector('#cmdk .cmdk-dt-name') || {}).textContent || '',
      pill: (document.querySelector('#cmdk .cmdk-dt-pill') || {}).textContent || '',
      sideBySide: !!(pane && list && pane.getBoundingClientRect().left > list.getBoundingClientRect().left + 200),
      hubNodeMoved: !!(pane && pane.querySelector('#booking-hub-content')),
      scopeOutside: !!document.querySelector('#cmdk-results > .cmdk-scopes'),
      // The pop-out must make ROOM for the pane. The split was designed for a
      // full-bleed window; inside a 520px pop-out the grid still fired and starved
      // the list — measured at 1440px, 226px of list against a 260px pane.
      listW: list ? Math.round(list.getBoundingClientRect().width) : 0,
      paneW: pane ? Math.round(pane.getBoundingClientRect().width) : 0,
      boxW: Math.round(document.querySelector('#cmdk .cmdk-box').getBoundingClientRect().width),
    };
  });
  ok(split.pane && split.visible, 'SPLIT: the selected booking gets a pane at 1280px');
  ok(/Bob Carter/.test(split.name), `SPLIT: it names the record (${split.name})`);
  ok(/£|Paid/.test(split.pill), `SPLIT: and states its money position (${split.pill})`);
  ok(split.sideBySide, 'SPLIT: the pane sits BESIDE the list, not under it');
  ok(!split.hubNodeMoved, 'SPLIT: it is a summary — #booking-hub-content was NOT re-parented into it');
  ok(split.scopeOutside, 'SPLIT: the scope switch spans the window rather than being trapped in the list');
  ok(split.listW > split.paneW * 1.5, `SPLIT: the pop-out widens for it, so the LIST still leads (${split.listW}px list vs ${split.paneW}px pane)`);
  // …and only while a pane is up: an ordinary search stays the compact pop-out.
  const narrowAgain = await page.evaluate(async () => {
    __cmdkSel = -1;
    const i = document.getElementById('cmdk-input');
    i.value = 'how do i add a booking'; cmdkSearchCore('how do i add a booking', false);
    await new Promise((r) => setTimeout(r, 450));
    return { boxW: Math.round(document.querySelector('#cmdk .cmdk-box').getBoundingClientRect().width),
             wide: document.getElementById('cmdk').classList.contains('cmdk-wide') };
  });
  ok(!narrowAgain.wide && narrowAgain.boxW < split.boxW, `SPLIT: and it narrows back with no record selected (${narrowAgain.boxW}px vs ${split.boxW}px)`);
  // Below the breakpoint the pane collapses and nothing about the phone changes.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(250);
  const narrow = await page.evaluate(() => {
    const pane = document.querySelector('#cmdk .cmdk-detail');
    return { hidden: !pane || getComputedStyle(pane).display === 'none' };
  });
  ok(narrow.hidden, 'SPLIT: and collapses below 1200px, leaving the phone layout untouched');
  await page.setViewportSize({ width: 900, height: 900 });

  // ---- 12. PHONE DENSITY. Measured on a 390x844 phone: the landing spent 269px on
  // five plain navigation rows against 248px of boards (getting somewhere cost more
  // room than knowing the day), and one record's actions took a 234px slab — 28% of
  // the screen — in one column while each row wasted half its 298px width.
  // Both are container-only changes over unchanged rows.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(async () => {
    try { closeCmdK(); } catch (e) {}
    nav('view-backoffice'); openCmdK();
    // The window GROWS over 0.6s on a transform. Measuring heights before it settles
    // reads them through a scale of ~0.9994 — a 44px row measures 43.975 and a strict
    // >=44 check fails on an element that is not actually short. Wait it out.
    await new Promise((r) => setTimeout(r, 1400));
  });
  const dens = await page.evaluate(() => {
    const jump = document.querySelector('#cmdk .cmdk-jump');
    const rows = [...document.querySelectorAll('#cmdk .cmdk-jump .cmdk-row')];
    return {
      jump: !!jump,
      jumpPx: jump ? Math.round(jump.getBoundingClientRect().height) : 0,
      n: rows.length,
      // Still real options — a chip that lost its index would break arrow-keys.
      optIds: rows.every((r) => /^cmdk-opt-\d+$/.test(r.id) && r.getAttribute('role') === 'option'),
      touch: rows.every((r) => r.getBoundingClientRect().height >= 44),
      wrapped: rows.length > 1 && rows[0].getBoundingClientRect().width < 300,
    };
  });
  // The SCOPE CHIP does not claim a filter it is not applying. Opening from Today
  // pre-scopes to "Bookings", and the day brief is deliberately NOT filtered by it —
  // so a lit chip sat above a panel ignoring it. The chip now appears when you type,
  // which is when it starts meaning something. (Jump to stays scoped: showing the
  // shortcuts that suit the workspace you came from is helpfulness, not a filter
  // anyone needs a control for — and removing it cost 124px → 271px of landing.)
  const chip = await page.evaluate(async () => {
    const until = async (fn, ms = 6000) => { const t0 = Date.now(); for (;;) { const v = fn(); if (v) return v; if (Date.now() - t0 > ms) return null; await new Promise((r) => setTimeout(r, 40)); } };
    try { closeCmdK(); } catch (e) {}
    nav('view-backoffice');
    openCmdK();
    await until(() => document.getElementById('cmdk').classList.contains('open'));
    await new Promise((r) => setTimeout(r, 400));
    const empty = { scopes: document.querySelectorAll('#cmdk .cmdk-scopes').length, rows: document.querySelectorAll('#cmdk .cmdk-row').length };
    document.getElementById('cmdk-input').value = 'bob';
    cmdkSearchCore('bob', false);
    await until(() => __cmdkResults.length);
    await new Promise((r) => setTimeout(r, 300));
    const typed = { scopes: document.querySelectorAll('#cmdk .cmdk-scopes').length };
    return { empty, typed };
  });
  ok(chip.empty.scopes === 0, `SCOPE: nothing claims a filter on the empty landing (${chip.empty.scopes} scope bars)`);
  ok(chip.empty.rows > 0, `SCOPE: …and the landing still has its day on it (${chip.empty.rows} rows)`);
  ok(chip.typed.scopes === 1, `SCOPE: the switch appears the moment you type, which is when it applies (${chip.typed.scopes})`);

  ok(dens.jump && dens.n >= 2, `DENSITY: the landing's destinations are chips (${dens.n})`);
  ok(dens.jumpPx > 0 && dens.jumpPx <= 160, `DENSITY: in ~two rows, not five (${dens.jumpPx}px, was 269)`);
  ok(dens.optIds, 'DENSITY: each chip is still a role=option at its own index');
  ok(dens.touch, 'DENSITY: and still clears the 44px touch floor');
  ok(dens.wrapped, 'DENSITY: chips size to their label rather than the full width');

  const qa = await page.evaluate(async () => {
    const i = document.getElementById('cmdk-input');
    i.value = 'bob carter'; cmdkSearchCore('bob carter', false);
    await new Promise((r) => setTimeout(r, 400));
    const idx = __cmdkResults.findIndex((r) => Array.isArray(r.actions) && r.actions.length);
    if (idx >= 0) { __cmdkSel = idx; cmdkRender(); }
    await new Promise((r) => setTimeout(r, 250));
    const slab = document.querySelector('#cmdk .cmdk-qa');
    const rows = [...document.querySelectorAll('#cmdk .cmdk-qa-row')];
    const labs = [...document.querySelectorAll('#cmdk .cmdk-qa-lbl')];
    const tops = new Set(rows.map((r) => Math.round(r.getBoundingClientRect().top)));
    return {
      n: rows.length,
      slabPx: slab ? Math.round(slab.getBoundingClientRect().height) : 0,
      lines: tops.size,
      touch: rows.every((r) => r.getBoundingClientRect().height >= 44),
      // The whole point of dropping the icon was to keep the WORDS. Money actions
      // are the last place to make someone guess at "Request bal…".
      clipped: labs.filter((l) => l.scrollWidth > l.clientWidth + 1).map((l) => l.textContent.trim()),
    };
  });
  ok(qa.n >= 4 && qa.lines < qa.n, `DENSITY: actions run two per line (${qa.n} actions on ${qa.lines} lines)`);
  ok(qa.slabPx > 0 && qa.slabPx <= 180, `DENSITY: the slab is ~146px, not 234 (${qa.slabPx}px)`);
  ok(qa.touch, 'DENSITY: two-up actions still clear the 44px touch floor');
  ok(qa.clipped.length === 0, `DENSITY: and every action label stays readable${qa.clipped.length ? ' — clipped: ' + qa.clipped.join(', ') : ''}`);
  await page.setViewportSize({ width: 900, height: 900 });

  // ---- 13. NO TEXT OVERRUNS OTHER TEXT ----
  // A row that wraps must GROW. .cmdk-row-label is a 2-line -webkit-line-clamp box,
  // and .cmdk-row-wrap (the conversational answers: greetings, capability replies,
  // fallbacks, generated how-tos) used to relax only `overflow` — the worst of both,
  // because the box stays two lines tall while its content is no longer clipped, so
  // every line past the second paints ON TOP of the row's own sub, the next group
  // heading and the row beneath. Measured on "Help" at 390px: box 39px, content
  // 117px — 78px of an answer sitting over other text (19px even at 1280px).
  //
  // The check is the GENERAL form rather than that one selector: any leaf whose
  // content is taller than its box while nothing clips it is painting over its
  // neighbours. Clipped overflow (the deliberate ellipsis on subs and labels) is
  // explicitly fine and excluded, so this can't flag the truncation the design wants.
  const OVERFLOW_QUERIES = ['Help', 'what can you do', 'hello', 'how do i add a booking', 'sdkjfhskdjfh'];
  for (const vp of [{ width: 390, height: 844 }, { width: 1280, height: 900 }]) {
    await page.setViewportSize(vp);
    const spills = await page.evaluate(async (queries) => {
      const until = async (fn, ms = 6000) => { const t0 = Date.now(); for (;;) { const v = fn(); if (v !== undefined && v !== null && v !== false && v !== -1) return v; if (Date.now() - t0 > ms) return null; await new Promise((r) => setTimeout(r, 40)); } };
      const found = [];
      for (const q of queries) {
        try { closeCmdK(); } catch (e) {}
        openCmdK();
        await until(() => document.getElementById('cmdk').classList.contains('open'));
        document.getElementById('cmdk-input').value = q;
        cmdkSearchCore(q, false);
        await until(() => __cmdkResults.length);
        await new Promise((r) => setTimeout(r, 400));
        document.querySelectorAll('#cmdk *').forEach((el) => {
          if (!el.textContent || !el.textContent.trim() || el.children.length) return;
          const cs = getComputedStyle(el);
          if (cs.display === 'none' || cs.visibility === 'hidden') return;
          if (/hidden|clip|auto|scroll/.test(cs.overflowY) || /hidden|clip|auto|scroll/.test(cs.overflow)) return;
          const over = el.scrollHeight - el.clientHeight;
          if (over > 2) found.push(`[${q}] ${el.className || el.tagName} box ${el.clientHeight} content ${el.scrollHeight} (+${over})`);
        });
      }
      return found;
    }, OVERFLOW_QUERIES);
    ok(spills.length === 0, `OVERFLOW @${vp.width}px: no text paints outside its own box${spills.length ? ' — ' + spills.slice(0, 3).join('; ') : ''}`);
  }
  await page.setViewportSize({ width: 900, height: 900 });

  // ---- 14. CHIPS: two species, one tidy block ----
  // A how-to answer carries chips that DO something with this topic (Walk me through
  // it / Add a booking / Show me where) and chips that go to ANOTHER topic. They used
  // to be one undifferentiated wrap of pills at four unrelated widths — measured at
  // 390px: 116, 126, 262 and a 44-char label that WRAPPED to two centred lines, 58px
  // tall among 29px neighbours, with 84 / 226 / 90 / 182px of dead space beside them.
  // That is what "disjointed" was. Destinations now take a line each and fill it.
  for (const vp of [{ width: 390, height: 844 }, { width: 1280, height: 900 }]) {
    await page.setViewportSize(vp);
    const chips = await page.evaluate(async () => {
      const until = async (fn, ms = 8000) => { const t0 = Date.now(); for (;;) { const v = fn(); if (v !== undefined && v !== null && v !== false && v !== -1) return v; if (Date.now() - t0 > ms) return null; await new Promise((r) => setTimeout(r, 40)); } };
      try { closeCmdK(); } catch (e) {}
      openCmdK();
      await until(() => document.getElementById('cmdk').classList.contains('open'));
      document.getElementById('cmdk-input').value = 'how do i add a booking';
      cmdkSearchCore('how do i add a booking', false);
      await until(() => __cmdkResults.length);
      __cmdkSel = 0; cmdkRender();
      if (!await until(() => !!document.querySelector('#cmdk .cmdk-chip'))) return null;
      await new Promise((r) => setTimeout(r, 350));
      // A label long enough to NEED the clamp. Without one the check is vacuous:
      // the real titles fit on their stretched line, so nothing wraps either way.
      __cmdkResults[0].chips.push({ label: 'Reconcile the Square settlement report against every captured damages deposit taken this tax year', q: 'reconcile', kind: 'topic' });
      cmdkRender();
      await new Promise((r) => setTimeout(r, 250));
      const wrap = document.querySelector('#cmdk .cmdk-chips');
      const all = [...wrap.querySelectorAll('.cmdk-chip')];
      const avail = wrap.clientWidth - 24; // its own left/right padding
      const one = Math.round(all[0].getBoundingClientRect().height);
      return {
        n: all.length,
        // every chip index in the DOM must still address its own entry in it.chips
        idxOk: all.every((c) => {
          const k = +c.getAttribute('data-chip');
          const src = __cmdkResults[0].chips[k];
          return src && c.textContent.trim() === String(src.label);
        }),
        maxH: Math.max(...all.map((c) => Math.round(c.getBoundingClientRect().height))),
        oneH: one,
        finds: all.filter((c) => c.classList.contains('cmdk-chip-find')).map((c) => Math.round(c.getBoundingClientRect().width)),
        acts: all.filter((c) => !c.classList.contains('cmdk-chip-find')).length,
        noPrefix: all.every((c) => !/^More:/.test(c.textContent.trim())),
        avail,
      };
    });
    if (!chips) { ok(false, `CHIPS @${vp.width}px: no chips rendered`); continue; }
    ok(chips.idxOk, `CHIPS @${vp.width}px: every chip still addresses its own index (the line break must not re-index)`);
    ok(chips.maxH === chips.oneH, `CHIPS @${vp.width}px: none wraps into a tall lozenge (tallest ${chips.maxH} vs ${chips.oneH})`);
    ok(chips.noPrefix, `CHIPS @${vp.width}px: the dead "More:" prefix is gone`);
    ok(chips.finds.length >= 1 && chips.acts >= 1, `CHIPS @${vp.width}px: both species are present (${chips.acts} actions, ${chips.finds.length} destinations)`);
    ok(chips.finds.every((w) => w >= chips.avail * 0.9), `CHIPS @${vp.width}px: destinations fill their line rather than leaving a ragged edge (${chips.finds.join(', ')} of ${chips.avail}px)`);
  }
  await page.setViewportSize({ width: 900, height: 900 });

  // ---- 15. PRODUCTION PASS: the things an audit measured as broken ----
  // Each of these was found by measurement, not inspection, and each failed silently —
  // no error, no visual hint, nothing a screenshot review would catch.
  await page.setViewportSize({ width: 1440, height: 900 });

  // 15a) `cmdk-wide` is decided ABOVE the early returns. It used to be toggled at the
  // point the pane renders, which the landing / no-results / deep-search branches all
  // return before — so those screens kept whatever width the last selection left:
  // measured, the empty landing rendered 860px with NO pane and its boards reflowed to
  // two columns, and closing deep search stayed stuck at 860.
  const wide = await page.evaluate(async () => {
    const until = async (fn, ms = 6000) => { const t0 = Date.now(); for (;;) { const v = fn(); if (v) return v; if (Date.now() - t0 > ms) return null; await new Promise((r) => setTimeout(r, 40)); } };
    const box = () => Math.round(document.querySelector('#cmdk .cmdk-box').getBoundingClientRect().width);
    const isWide = () => document.getElementById('cmdk').classList.contains('cmdk-wide');
    const out = {};
    try { closeCmdK(); } catch (e) {}
    openCmdK();
    await until(() => document.getElementById('cmdk').classList.contains('open'));
    const i = document.getElementById('cmdk-input');
    // Select a booking so the pane (and the wide box) are genuinely up first.
    i.value = 'bob'; cmdkSearchCore('bob', false);
    await until(() => __cmdkResults.some((r) => r && r.type === 'booking'));
    __cmdkSel = __cmdkResults.findIndex((r) => r && r.type === 'booking'); cmdkRender();
    await new Promise((r) => setTimeout(r, 250));
    out.withPane = { w: box(), wide: isWide(), pane: !!document.querySelector('#cmdk .cmdk-detail') };
    // …then each branch that returns early.
    i.value = ''; cmdkSearchCore('', false);
    await new Promise((r) => setTimeout(r, 300));
    out.landing = { w: box(), wide: isWide(), cols: new Set([...document.querySelectorAll('#cmdk .cmdk-board')].map((b) => Math.round(b.getBoundingClientRect().top))).size };
    i.value = 'zzzqqqxxx'; cmdkSearchCore('zzzqqqxxx', false);
    await new Promise((r) => setTimeout(r, 300));
    out.none = { w: box(), wide: isWide() };
    return out;
  });
  ok(wide.withPane.wide && wide.withPane.pane, `WIDE: a selected record still widens the box for its pane (${wide.withPane.w}px)`);
  ok(!wide.landing.wide, `WIDE: the empty landing is never left wide (${wide.landing.w}px, wide=${wide.landing.wide})`);
  ok(wide.landing.w < wide.withPane.w, `WIDE: …so the landing narrows back (${wide.landing.w} < ${wide.withPane.w})`);
  ok(!wide.none.wide, `WIDE: nor is the no-results state (${wide.none.w}px)`);
  await page.setViewportSize({ width: 390, height: 844 });

  // 15b) A keyboard-SELECTED board row must actually look selected. The board's own
  // `background: none` reset and `.cmdk-row.is-sel` are both (0,2,0), so the later
  // board rule won and the selection computed transparent — measured identical to the
  // row below it in both themes, on the pop-out's DEFAULT state.
  for (const theme of ['dark', 'light']) {
    const board = await page.evaluate(async (th) => {
      const until = async (fn, ms = 6000) => { const t0 = Date.now(); for (;;) { const v = fn(); if (v) return v; if (Date.now() - t0 > ms) return null; await new Promise((r) => setTimeout(r, 40)); } };
      document.body.classList.toggle('light-mode', th === 'light');
      try { closeCmdK(); } catch (e) {}
      openCmdK();
      await until(() => document.getElementById('cmdk').classList.contains('open'));
      await until(() => !!document.querySelector('#cmdk .cmdk-board .cmdk-row'));
      const rows = [...document.querySelectorAll('#cmdk .cmdk-board .cmdk-row')];
      const idx = +rows[0].getAttribute('data-idx');
      __cmdkSel = idx; cmdkRender();
      await new Promise((r) => setTimeout(r, 200));
      const sel = document.querySelector('#cmdk .cmdk-board .cmdk-row.is-sel');
      return { found: !!sel, bg: sel ? getComputedStyle(sel).backgroundColor : '(none)' };
    }, theme);
    const transparent = /rgba\(0,\s*0,\s*0,\s*0\)|transparent/.test(board.bg);
    ok(board.found && !transparent, `BOARD @${theme}: a selected board row has a real background (${board.bg})`);
  }
  await page.evaluate(() => document.body.classList.remove('light-mode'));

  // 15c) Left/Right sub-focus must RENDER. The marker class was emitted with no rule
  // anywhere — pixel-diff of a quick-action resting vs marked measured 0 changed px of
  // 29040, while the cursor sitting on action 0 arms a bulk money send.
  const kbd = await page.evaluate(async () => {
    const until = async (fn, ms = 8000) => { const t0 = Date.now(); for (;;) { const v = fn(); if (v !== undefined && v !== null && v !== false && v !== -1) return v; if (Date.now() - t0 > ms) return null; await new Promise((r) => setTimeout(r, 40)); } };
    try { closeCmdK(); } catch (e) {}
    openCmdK();
    await until(() => document.getElementById('cmdk').classList.contains('open'));
    const i = document.getElementById('cmdk-input');
    i.value = 'bob carter'; cmdkSearchCore('bob carter', false);
    const at = await until(() => __cmdkResults.findIndex((r) => Array.isArray(r.actions) && r.actions.length));
    if (at === null) return null;
    __cmdkSel = at; __cmdkActSel = -1; cmdkRender();
    await until(() => !!document.querySelector('#cmdk .cmdk-qa-row'));
    const before = getComputedStyle(document.querySelector('#cmdk .cmdk-qa-row')).outlineWidth;
    __cmdkActSel = 0; cmdkRender();
    await new Promise((r) => setTimeout(r, 150));
    const marked = document.querySelector('#cmdk .cmdk-qa-row.is-kbd');
    return { before, marked: !!marked, outline: marked ? getComputedStyle(marked).outlineWidth : '0px' };
  });
  ok(!!kbd && kbd.marked, 'KBD: Left/Right marks a quick-action');
  ok(!!kbd && parseFloat(kbd.outline) >= 2 && parseFloat(kbd.before) < 2,
    `KBD: …and the marker is VISIBLE — an outline appears (${kbd && kbd.before} → ${kbd && kbd.outline})`);

  // 15d) FOCUS CONTAINMENT. The workspace is still behind the scrim: one Shift+Tab from
  // the field used to land on a "Save note" button inside the booking hub — off screen,
  // unreachable, activatable — and typing went into that booking's notes.
  const trap = await page.evaluate(async () => {
    const until = async (fn, ms = 6000) => { const t0 = Date.now(); for (;;) { const v = fn(); if (v) return v; if (Date.now() - t0 > ms) return null; await new Promise((r) => setTimeout(r, 40)); } };
    try { closeCmdK(); } catch (e) {}
    openCmdK();
    await until(() => document.getElementById('cmdk').classList.contains('open'));
    await new Promise((r) => setTimeout(r, 300));
    return { modal: document.getElementById('cmdk').getAttribute('aria-modal'),
             rowTabbable: [...document.querySelectorAll('#cmdk .cmdk-row')].some((r) => r.tabIndex >= 0) };
  });
  ok(trap.modal === 'true', 'FOCUS: the open pop-out reports itself modal');
  ok(!trap.rowTabbable, 'FOCUS: result rows are not Tab stops — arrows own the list, Tab owns the chrome');
  const inside = await page.evaluate(() => {
    const box = document.querySelector('#cmdk .cmdk-box');
    return !!(document.activeElement && box.contains(document.activeElement));
  });
  ok(inside, 'FOCUS: focus starts inside the box');
  for (const combo of ['Shift+Tab', 'Shift+Tab', 'Tab', 'Tab', 'Tab', 'Tab', 'Tab', 'Tab', 'Tab', 'Tab', 'Tab', 'Tab', 'Tab', 'Tab']) {
    await page.keyboard.press(combo);
  }
  const contained = await page.evaluate(() => {
    const box = document.querySelector('#cmdk .cmdk-box');
    const a = document.activeElement;
    return { inside: !!(a && box.contains(a)), where: a ? (a.id || a.className || a.tagName) : '(none)' };
  });
  ok(contained.inside, `FOCUS: 14 Tabs later it is STILL inside the pop-out (${contained.where})`);

  // 15e) Focus is not hover. Three stops ended their hover rule with `outline: none`,
  // which killed the global ring — measured 0px on clear/help/chips while #cmdk-close
  // 16px away in the same row got its 2px accent ring.
  const rings = await page.evaluate(async () => {
    // The ✕ clear only EXISTS once the field has text (`has-text`), so measure with a
    // query typed — otherwise this reads a non-rendered element and passes at 0px for
    // the wrong reason.
    const i = document.getElementById('cmdk-input');
    i.value = 'bob'; cmdkSearchCore('bob', false);
    await new Promise((r) => setTimeout(r, 300));
    const out = {};
    ['cmdk-clear', 'cmdk-help'].forEach((id) => {
      const el = document.getElementById(id);
      if (!el) { out[id] = null; return; }
      if (!el.getBoundingClientRect().width) { out[id] = null; return; } // not on screen
      el.focus();
      out[id] = getComputedStyle(el).outlineWidth;
    });
    const chip = document.querySelector('#cmdk .cmdk-chip');
    if (chip) { chip.focus(); out.chip = getComputedStyle(chip).outlineWidth; }
    return out;
  });
  ok(Object.values(rings).filter((v) => v !== null).length >= 3,
    `RING: all three stops were on screen to measure (${JSON.stringify(rings)})`);
  Object.entries(rings).forEach(([k, v]) => {
    if (v === null || v === undefined) return;
    ok(parseFloat(v) >= 2, `RING: ${k} shows a focus ring, not just a hover tint (${v})`);
  });

  // 15f) The error strip must not print server internals — apiPost slices a failed body
  // to 200 chars, so a 500 sprayed a PHP fatal, SQLSTATE and the host path into the
  // window. Deliberate prose (chbBulkRun's "…has no email address") must still pass.
  const errs = await page.evaluate(() => {
    const machine = 'Server error 500: <br /> <b>Fatal error</b>: Uncaught PDOException: SQLSTATE[HY000] [2002] Connection refused in /kunden/homepages/1/d1/htdocs/db.php:88';
    const idish = 'watchers_key: kind required';
    const prose = 'Couldn’t send any — Dan Rowe has no email address';
    const a = { label: 'Request balance' };
    return {
      machine: chbActErrSay(new Error(machine), a),
      idish: chbActErrSay(new Error(idish), a),
      prose: chbActErrSay(new Error(prose), a),
    };
  });
  ok(!/SQLSTATE|Fatal|\.php|<br/.test(errs.machine), `ERR: a PHP fatal never reaches the strip (${errs.machine.slice(0, 62)})`);
  ok(!/watchers_key/.test(errs.idish), `ERR: nor does an internal identifier (${errs.idish.slice(0, 52)})`);
  ok(errs.prose === 'Couldn’t send any — Dan Rowe has no email address', `ERR: but a sentence written for a person passes through (${errs.prose})`);
  // …and the WIRING, not just the helper: drive a real failing action through cmdkAct
  // and read what the strip actually says. Testing chbActErrSay alone would pass even
  // if the catch went back to printing e.message.
  const wired = await page.evaluate(async () => {
    const until = async (fn, ms = 6000) => { const t0 = Date.now(); for (;;) { const v = fn(); if (v) return v; if (Date.now() - t0 > ms) return null; await new Promise((r) => setTimeout(r, 40)); } };
    __cmdkResults = [{ type: 'answer', id: 'probe', label: 'probe', sub: '', run: () => {}, actions: [{
      key: 'probe', label: 'Request balance', pending: 'Working…', run: () => {},
      inline: async () => { throw new Error('Server error 500: <b>Fatal error</b>: Uncaught PDOException: SQLSTATE[HY000] in /htdocs/db.php:88'); },
    }] }];
    __cmdkSel = 0; cmdkRender();
    await cmdkAct(0, 0);
    await until(() => !!document.querySelector('#cmdk .cmdk-actmsg.is-err'));
    const el = document.querySelector('#cmdk .cmdk-actmsg');
    return el ? el.textContent.trim() : '(none)';
  });
  ok(!/SQLSTATE|Fatal|\.php/.test(wired), `ERR: and the strip itself never shows them (${wired.slice(0, 70)})`);
  await page.setViewportSize({ width: 900, height: 900 });

  console.log(fails ? `\n  ${fails} SEARCH-PAGE CHECK(S) FAILED ❌` : '\n  SEARCH-PAGE SUITE PASSED ✅');
  await done(fails);
})();
