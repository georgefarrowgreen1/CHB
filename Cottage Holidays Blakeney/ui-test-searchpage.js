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
  // The ready tint is read off the TOKEN, not a written-down hex: --knot-ready is
  // retuned under light mode (the vivid violet measures 3.60:1 on the light search
  // surface), so pinning one rgb() here asserts a theme rather than the state. A
  // probe element resolves the token through the same colour serialisation as the
  // knot, so the two are comparable without a colour model — and the check still
  // fails if the state stops painting its own token.
  st = await page.evaluate(() => {
    const probe = document.createElement('span');
    probe.style.color = 'var(--knot-ready)';
    document.body.appendChild(probe);
    const want = getComputedStyle(probe).color;
    probe.remove();
    return {
      ready: document.body.classList.contains('darkstar-ready'),
      mstate: (document.getElementById('cmdk-ml') || {}).dataset.mstate,
      color: getComputedStyle(document.getElementById('cmdk-ml')).color,
      want,
      theme: document.body.classList.contains('light-mode') ? 'light' : 'dark',
    };
  });
  ok(st.ready, 'body.darkstar-ready set once the model is loaded + indexed');
  ok(st.mstate === 'ready' && st.color === st.want && /\d/.test(st.want),
    `logo rests on the Darkstar purple (${st.mstate}, ${st.color} @${st.theme})`);

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
  // ≥3, not ≥5: a teleport yields at most TWO distinct offsets (the parked -10px
  // and home) and fails the starts-above check below besides, so three proves a
  // mid-flight frame — which is the whole claim. Five was an arbitrary margin that
  // a janky CI runner missed on a WORKING drop (measured: 4 distinct offsets while
  // the start/settle checks both passed — the heavier landing build eats frames).
  ok(distinct >= 3, `the pop-out DROPS rather than appearing (${distinct} distinct offsets sampled)`);
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
  // NB read `outline-style`, NOT the width alone: `outline-width` on an unstyled element
  // is the INITIAL `medium`, and browsers disagree about whether to report that or 0px
  // when the style is `none` — this Chromium says 0px, CI's said 3px, and the first
  // version of this check read the width and failed there while nothing was painted
  // either way. `none` is the deterministic "nothing is drawn" signal, so the marker is
  // proved by a STYLE appearing on the marked row while its unmarked sibling has none.
  const kbd = await page.evaluate(async () => {
    const until = async (fn, ms = 8000) => { const t0 = Date.now(); for (;;) { const v = fn(); if (v !== undefined && v !== null && v !== false && v !== -1) return v; if (Date.now() - t0 > ms) return null; await new Promise((r) => setTimeout(r, 40)); } };
    const ring = (el) => { if (!el) return null; const c = getComputedStyle(el); return { style: c.outlineStyle, width: c.outlineWidth }; };
    try { closeCmdK(); } catch (e) {}
    openCmdK();
    await until(() => document.getElementById('cmdk').classList.contains('open'));
    const i = document.getElementById('cmdk-input');
    i.value = 'bob carter'; cmdkSearchCore('bob carter', false);
    const at = await until(() => __cmdkResults.findIndex((r) => Array.isArray(r.actions) && r.actions.length));
    if (at === null) return null;
    __cmdkSel = at; __cmdkActSel = -1; cmdkRender();
    await until(() => !!document.querySelector('#cmdk .cmdk-qa-row'));
    const before = ring(document.querySelector('#cmdk .cmdk-qa-row'));
    __cmdkActSel = 0; cmdkRender();
    await new Promise((r) => setTimeout(r, 150));
    const marked = document.querySelector('#cmdk .cmdk-qa-row.is-kbd');
    return { before, marked: !!marked, on: ring(marked), off: ring(document.querySelector('#cmdk .cmdk-qa-row:not(.is-kbd)')) };
  });
  ok(!!kbd && kbd.marked, 'KBD: Left/Right marks a quick-action');
  const kbdOn = !!kbd && !!kbd.on && kbd.on.style !== 'none' && parseFloat(kbd.on.width) >= 2;
  const kbdOff = !!kbd && kbd.before.style === 'none' && (!kbd.off || kbd.off.style === 'none');
  ok(kbdOn && kbdOff,
    `KBD: …and the marker is VISIBLE — an outline appears (${kbd && kbd.before.style} → ${kbd && kbd.on && kbd.on.style} ${kbd && kbd.on && kbd.on.width})`);

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

  // ============================================================
  // 16) THE MAKEOVER'S SECOND PASS — type and tokens.
  // ============================================================

  // 16a) WEIGHT IS REAL. Montserrat ships as a VARIABLE file, but its @font-face
  // blocks declared single weights (300/400/500), which pins the wght axis — so
  // every weight the app asked for above 500 matched the 500 face and got the same
  // synthetic bold. Measured before the fix: 500/600/700/800 all set the same
  // string to the identical 421px, which is why making the hero's figure 700
  // against a 600 label changed 0 pixels of 25,812. This check is the one that
  // would have caught that: it asks the FONT whether the steps differ, not the
  // stylesheet whether they are declared.
  const weights = await page.evaluate(() => {
    const mk = (w) => {
      const s = document.createElement('span');
      s.textContent = '£290.00 Handpicked';
      s.style.cssText = `font-family: var(--font-sans); font-size: 40px; font-weight: ${w}; white-space: nowrap; position: absolute; visibility: hidden;`;
      document.body.appendChild(s);
      const px = s.getBoundingClientRect().width;
      s.remove();
      return +px.toFixed(2);
    };
    return { w400: mk(400), w500: mk(500), w600: mk(600), w700: mk(700) };
  });
  ok(weights.w500 !== weights.w600 && weights.w600 !== weights.w700,
    `TYPE: 500 / 600 / 700 are three real faces, not one synthetic bold (${weights.w500} → ${weights.w600} → ${weights.w700}px)`);
  ok(weights.w400 < weights.w500 && weights.w500 < weights.w600 && weights.w600 < weights.w700,
    'TYPE: …and they get heavier in the right order');

  // 16b) ONE SCALE. The window had nineteen sizes, twelve within 0.02rem of a
  // neighbour. Every rendered size must now be one of the seven declared steps —
  // read off the tokens, so the check cannot drift from the scale it is checking.
  // Sampled across THREE render states, not one: the boards landing, an answered
  // query (hero + thread) and a selected record (quick actions + detail pane) light
  // up largely disjoint sets of rules, so scanning any single one leaves most of the
  // window's type unmeasured — the first draft of this check scanned only the
  // selected-record state and a deliberately off-scale .cmdk-hero-sub sailed past it.
  const scale = await page.evaluate(async () => {
    const until = async (fn, ms = 6000) => { const t0 = Date.now(); for (;;) { const v = fn(); if (v) return v; if (Date.now() - t0 > ms) return null; await new Promise((r) => setTimeout(r, 40)); } };
    const root = getComputedStyle(document.documentElement);
    const steps = ['hero', 'lead', 'body', 'row', 'sub', 'micro']
      .map((k) => root.getPropertyValue(`--cmdk-fs-${k}`).trim())
      .filter(Boolean);
    // resolve each rem step to px through a probe, so this never hand-maths 16
    const probe = document.createElement('span');
    document.body.appendChild(probe);
    const allowed = new Set(steps.map((s) => { probe.style.fontSize = s; return getComputedStyle(probe).fontSize; }));
    probe.remove();
    const seen = new Map();
    const sweep = (state) => {
      for (const el of document.querySelectorAll('#cmdk *')) {
        const t = (el.textContent || '').trim();
        if (!t || el.children.length) continue; // leaves only
        // .sr-only is the visually-hidden-but-announced utility — a 1px box carrying
        // screen-reader prose, not type on screen, so it has no size to be on scale.
        if (el.closest('.sr-only')) continue;
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        const fs = getComputedStyle(el).fontSize;
        if (!seen.has(fs)) seen.set(fs, `${state}: ${el.className || el.tagName} "${t.slice(0, 18)}"`);
      }
    };
    try { closeCmdK(); } catch (e) {}
    openCmdK();
    await until(() => document.getElementById('cmdk').classList.contains('open'));
    await until(() => !!document.querySelector('#cmdk .cmdk-board .cmdk-row, #cmdk .cmdk-row'));
    sweep('landing');
    const i = document.getElementById('cmdk-input');
    i.value = 'who owes money'; cmdkSearchCore('who owes money', false);
    await until(() => !!document.querySelector('#cmdk .cmdk-hero'));
    sweep('answer');
    i.value = 'bob carter'; cmdkSearchCore('bob carter', false);
    await until(() => !!document.querySelector('#cmdk .cmdk-row'));
    const at = await until(() => { const n = __cmdkResults.findIndex((r) => Array.isArray(r.actions) && r.actions.length); return n < 0 ? null : n; });
    if (at !== null) { __cmdkSel = at; cmdkRender(); await new Promise((r) => setTimeout(r, 250)); }
    sweep('record');
    return { steps: steps.length, allowed: [...allowed], seen: seen.size, off: [...seen].filter(([fs]) => !allowed.has(fs)) };
  });
  ok(scale.steps === 6, `TYPE: the scale declares six steps (${scale.steps})`);
  if (scale.off.length) console.log('     off-scale: ' + scale.off.map(([fs, who]) => `${fs} ${who}`).join(' · '));
  ok(scale.off.length === 0, `TYPE: every rendered size is one of them (${scale.off.length} off-scale of ${scale.seen} seen)`);

  // 16c) THE SCALE'S OWN CLAIM, checked against its own numbers. The first version of
  // that comment said every step stood ≥1.2px from its neighbour; three of six gaps
  // did not, and the tightest (sub/meta, 0.64px) was closer than pairs the collapse
  // had removed for being too close. Those two are one step now. This asserts the
  // TRUE minimum, so the prose and the tokens cannot drift apart again — and it is
  // deliberately a floor on the SPACING rather than a count, because the useful
  // property is "no two steps are so close that choosing between them is noise".
  const gaps = await page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    const probe = document.createElement('span');
    document.body.appendChild(probe);
    const px = ['hero', 'lead', 'body', 'row', 'sub', 'micro'].map((k) => {
      probe.style.fontSize = root.getPropertyValue(`--cmdk-fs-${k}`).trim();
      return { k, px: parseFloat(getComputedStyle(probe).fontSize) };
    });
    probe.remove();
    const out = [];
    for (let i = 0; i < px.length - 1; i++) out.push({ pair: px[i].k + '/' + px[i + 1].k, gap: +(px[i].px - px[i + 1].px).toFixed(2) });
    return { out, min: Math.min(...out.map((g) => g.gap)), descending: out.every((g) => g.gap > 0) };
  });
  ok(gaps.descending, 'TYPE: the steps descend — no two share a size');
  // 0.8px is body/row, the one close pair, tolerated because prose and a list label
  // never appear as peers (see the token block). Anything TIGHTER than that is the
  // noise this scale exists to remove.
  ok(gaps.min >= 0.8, `TYPE: …and none is closer than the one pair that is allowed to be (min ${gaps.min}px, ${gaps.out.find((g) => g.gap === gaps.min).pair})`);

  // 16c) A quick action is subordinate to the record it hangs under. `font: inherit`
  // took the document's 16px/400, so "Email" was set larger and lighter than the
  // guest's own name at 14.4px/600.
  const rhythm = await page.evaluate(() => {
    const qa = document.querySelector('#cmdk .cmdk-qa-lbl');
    const row = document.querySelector('#cmdk .cmdk-row-label');
    if (!qa || !row) return null;
    const a = getComputedStyle(qa), b = getComputedStyle(row);
    return { qa: parseFloat(a.fontSize), qaW: +a.fontWeight, row: parseFloat(b.fontSize), rowW: +b.fontWeight };
  });
  ok(!!rhythm && rhythm.qa <= rhythm.row && rhythm.qaW < rhythm.rowW,
    `TYPE: a quick action never outranks its own record (${rhythm && rhythm.qa}px/${rhythm && rhythm.qaW} under ${rhythm && rhythm.row}px/${rhythm && rhythm.rowW})`);

  // 16d) MODEL STATE IS THE ONLY CHANNEL, so the five states must be five colours.
  // a11y-test §1c owns the contrast; this owns the DISTINCTNESS, and that they are
  // painted from the knot tokens at all.
  for (const theme of ['dark', 'light']) {
    const knot = await page.evaluate(async (th) => {
      document.body.classList.toggle('light-mode', th === 'light');
      const el = document.getElementById('cmdk-ml');
      if (!el) return null;
      const was = el.dataset.mstate;
      // Both the TRANSITION (0.35s) and, for `meaning`, a running ANIMATION make
      // this a moving target: a sample taken a couple of frames after the flip reads
      // a point on the interpolation, so two states can measure the same colour
      // purely by timing (the first version passed once, then reported "4 of 5"
      // every run after), and the animated state's value depends on where in a 2.8s
      // cycle the sample lands — which also meant breaking --knot-meaning did not
      // fail this check, because the keyframe was painting over it. Freeze both, so
      // what is measured is each state's DECLARED identity (also what reduced motion
      // shows); a11y-test §1c owns the animation's endpoints.
      const prev = el.style.transition, prevA = el.style.animation;
      el.style.transition = 'none';
      el.style.animation = 'none';
      const out = {};
      for (const s of ['ready', 'understood', 'meaning', 'guess', 'learning']) {
        el.dataset.mstate = s;
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        out[s] = getComputedStyle(el).color;
      }
      el.style.transition = prev; el.style.animation = prevA;
      el.dataset.mstate = was || '';
      document.body.classList.remove('light-mode');
      return out;
    }, theme);
    const vals = knot ? Object.values(knot) : [];
    ok(vals.length === 5 && new Set(vals).size === 5,
      `KNOT @${theme}: five states, five distinct colours (${new Set(vals).size} of ${vals.length})`);
  }

  // 16e) A WARNING IS THE ONE THING THE FOOT MUST NOT SWALLOW. Sharing a 390px foot
  // with the hint left "Daily automation looks stopped — last ran 7 days ago" at
  // 37px of 287 — the line read "Dai…".
  await page.setViewportSize({ width: 390, height: 844 });
  const sys = await page.evaluate(async () => {
    /** @type {any} */ (window).__cronStatusPre = { stale: true, everRan: true, ageHours: 168 };
    chbSysLine();
    await new Promise((r) => setTimeout(r, 200));
    const el = document.getElementById('cmdk-sys');
    const say = el && el.querySelector('.cmdk-sys-say');
    if (!el || !say) return null;
    return { warn: el.classList.contains('is-warn'), shown: say.clientWidth, needs: say.scrollWidth, text: say.textContent.trim() };
  });
  ok(!!sys && sys.warn, 'SYS: a stopped automation reports as a warning');
  ok(!!sys && sys.shown >= sys.needs, `SYS: …and all of it is on screen at 390px (${sys && sys.shown} of ${sys && sys.needs}px)`);

  // 16f) A SHORT VIEWPORT SPENDS ITS HEIGHT ON RESULTS. Measured on a landscape phone
  // (740×400): the panel is 296px tall and its chrome took 119 of them — a 74px field
  // plus a 45px keyboard hint — leaving 175px of results, which showed ONE row of
  // seven. Advice about a keyboard is the first thing that should go on a device with
  // no room to spare for it; a WARNING still earns its space, which is why the foot
  // is hidden by condition rather than outright.
  await page.setViewportSize({ width: 740, height: 400 });
  const short = await page.evaluate(async () => {
    const until = async (fn, ms = 6000) => { const t0 = Date.now(); for (;;) { const v = fn(); if (v) return v; if (Date.now() - t0 > ms) return null; await new Promise((r) => setTimeout(r, 40)); } };
    /** @type {any} */ (window).__cronStatusPre = null;
    try { closeCmdK(); } catch (e) {}
    openCmdK();
    await until(() => document.getElementById('cmdk').classList.contains('open'));
    chbSysLine();
    await new Promise((r) => setTimeout(r, 250));
    const res = document.getElementById('cmdk-results');
    const foot = document.querySelector('#cmdk .cmdk-foot');
    const rows = [...document.querySelectorAll('#cmdk .cmdk-row')];
    const rb = res.getBoundingClientRect();
    return {
      results: Math.round(rb.height),
      footShown: foot ? getComputedStyle(foot).display !== 'none' : null,
      whole: rows.filter((el) => { const a = el.getBoundingClientRect(); return a.top >= rb.top - 1 && a.bottom <= rb.bottom + 1; }).length,
      total: rows.length,
    };
  });
  ok(!!short && short.footShown === false, `SHORT: the keyboard hint yields its 45px when there is no height for it (foot shown=${short && short.footShown})`);
  ok(!!short && short.results >= 210, `SHORT: …so the results get the room (${short && short.results}px, was 175)`);
  ok(!!short && short.whole >= 2, `SHORT: and more than one row is actually readable (${short && short.whole} of ${short && short.total} whole)`);
  // …but a WARNING is not something a short screen gets to swallow.
  const shortWarn = await page.evaluate(async () => {
    /** @type {any} */ (window).__cronStatusPre = { stale: true, everRan: true, ageHours: 168 };
    chbSysLine();
    await new Promise((r) => setTimeout(r, 250));
    const foot = document.querySelector('#cmdk .cmdk-foot');
    const sys = document.getElementById('cmdk-sys');
    return { foot: foot ? getComputedStyle(foot).display !== 'none' : null, warn: !!(sys && sys.classList.contains('is-warn')) };
  });
  ok(!!shortWarn && shortWarn.warn && shortWarn.foot === true,
    `SHORT: a stopped automation still gets its line here (foot shown=${shortWarn && shortWarn.foot})`);
  await page.setViewportSize({ width: 900, height: 900 });

  // ============================================================
  // 17) THIRD PASS — motion and the rails.
  // ============================================================

  // 17a) THE SIRI AURA IS BACK ON. `#cmdk.cmdk-overlay .cmdk-box` blanked the whole
  // `animation` shorthand to cancel cmdkRise (the drop replaces it) and took
  // cmdkSiriAura with it, so the assistant's breathing glow — documented as part of
  // its look — had rendered on no surface at all since the pop-out landed. Asserted
  // on the PAINT (does the box-shadow the keyframes name actually reach the
  // element), not just on the animation-name, because a named animation whose
  // keyframes never land is exactly the failure this is here to catch.
  //
  // It SEEKS the animation rather than racing it. Sampling twice 1.5s apart is
  // what this did first, and it flaked on CI: `0%, 100%` is a plateau and
  // ease-in-out is slow at both ends, so two samples can land in the same slow
  // zone and round to the same string — and any re-render that restarts the
  // animation between them makes that likely rather than unlucky. A NEGATIVE
  // animation-delay (inline, so it out-ranks the stylesheet's shorthand) jumps
  // straight to a phase: 0s is the 0% keyframe, -3s is the 50% one, read a
  // millisecond apart, no clock involved. A blanked animation seeks nowhere, so
  // the check still fails for the reason it was written.
  const aura = await page.evaluate(async () => {
    try { closeCmdK(); } catch (e) {}
    openCmdK();
    await new Promise((r) => setTimeout(r, 500));
    const box = document.querySelector('#cmdk .cmdk-box');
    if (!box) return null;
    const name = getComputedStyle(box).animationName;
    box.style.animationDelay = '0s';
    const a = getComputedStyle(box).boxShadow;
    box.style.animationDelay = '-3s'; // half of the 6s cycle — the other keyframe
    const b = getComputedStyle(box).boxShadow;
    box.style.animationDelay = '';
    return { name, changed: a !== b, a, b };
  });
  ok(!!aura && /cmdkSiriAura/.test(aura.name), `MOTION: the search card carries its Siri aura (${aura && aura.name})`);
  ok(!!aura && aura.changed, 'MOTION: …and it actually breathes — the painted shadow moves');

  // 17b) CLOSING IS THE INVERSE OF OPENING. `visibility` flipped with no transition,
  // so the box's own exit ran inside an already-invisible container: the panel
  // teleported while the scrim went on fading for 260ms.
  // Sampled by STATE, not on a clock: closeCmdK does a pile of synchronous teardown
  // (miss-recording, thread clear, a re-render) that blocks the main thread for
  // ~180ms, so the first paint of the exit lands well after any fixed delay — a
  // sample at 100ms reported "opacity 1" for an exit that was working perfectly.
  // Poll for the mid-flight frame instead, and require it to be a real one:
  // strictly between 0 and 1, with the container still visible.
  // …and even that can miss: any forced style flush inside the teardown starts the
  // 0.22s transition's wall-clock while the thread is still blocked, so on a slow
  // run the first painted frame is already PAST the fade and the poll sees nothing.
  // Transition EVENTS are the evidence that survives that: a real exit dispatches
  // transitionrun/transitionend for the box's opacity even when no mid-flight frame
  // ever paints, while a genuine teleport (the exit transition deleted — the break
  // case) dispatches neither. The mid-frame poll stays as the primary evidence.
  const closing = await page.evaluate(async () => {
    const ov = document.getElementById('cmdk');
    const box = ov.querySelector('.cmdk-box');
    const snap = () => ({ vis: getComputedStyle(ov).visibility, op: +getComputedStyle(box).opacity });
    const ran = { run: 0, end: 0 };
    const mark = (k) => (e) => { if (e.target === box && (e.propertyName === 'opacity' || e.propertyName === 'transform')) ran[k]++; };
    box.addEventListener('transitionrun', mark('run'));
    box.addEventListener('transitionend', mark('end'));
    const before = snap();
    closeCmdK();
    let mid = null;
    for (let i = 0; i < 90 && !mid; i++) {
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      const s = snap();
      if (s.op < 1 && s.op > 0) mid = s;
      if (s.vis === 'hidden') break; // gone before we ever saw it fade
    }
    await new Promise((r) => setTimeout(r, 500));
    return { before, mid, ran, after: snap() };
  });
  ok(!!closing && closing.before.vis === 'visible' && closing.before.op === 1, 'MOTION: open, the panel is up');
  ok(!!closing && (closing.mid ? closing.mid.vis === 'visible' : closing.ran.run > 0 && closing.ran.end > 0),
    `MOTION: …and it FADES on the way out instead of teleporting (${closing && closing.mid ? `caught mid-close at opacity ${closing.mid.op.toFixed(2)}` : `transition ran (${closing && closing.ran.run} run / ${closing && closing.ran.end} end)`})`);
  ok(!!closing && closing.after.vis === 'hidden', `MOTION: …then goes properly away (${closing && closing.after.vis})`);

  // 17c) Reduced motion turns the aura off. The generic .cmdk-box reduced-motion
  // rule is out-specified by `#cmdk.cmdk-overlay .cmdk-box`, so it needs restating
  // at that specificity — without which someone who asked for no motion got a
  // permanently breathing panel.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const calm = await page.evaluate(async () => {
    try { closeCmdK(); } catch (e) {}
    openCmdK();
    await new Promise((r) => setTimeout(r, 400));
    const box = document.querySelector('#cmdk .cmdk-box');
    return box ? getComputedStyle(box).animationName : null;
  });
  ok(calm === 'none', `MOTION: reduced motion stops the aura (${calm})`);
  await page.emulateMedia({ reducedMotion: null });

  // 17d) The act strip ARRIVES rather than blinking in.
  const strip = await page.evaluate(() => {
    const s = document.createElement('div');
    s.className = 'cmdk-actmsg is-ok';
    (document.querySelector('#cmdk .cmdk-results') || document.body).appendChild(s);
    const n = getComputedStyle(s).animationName;
    s.remove();
    return n;
  });
  ok(/cmdkStripIn/.test(strip || ''), `MOTION: the act strip animates in (${strip})`);

  // 17e) RAILS. The boards grid claimed to be responsive — auto-fit/minmax(240px) —
  // inside a 478px content box, where two tracks need 490: it could never resolve to
  // more than one column at any width the window has. And a board's caption sat 10px
  // off the rail of the rows it captions.
  const board = await page.evaluate(async () => {
    const until = async (fn, ms = 6000) => { const t0 = Date.now(); for (;;) { const v = fn(); if (v) return v; if (Date.now() - t0 > ms) return null; await new Promise((r) => setTimeout(r, 40)); } };
    try { closeCmdK(); } catch (e) {}
    openCmdK();
    await until(() => !!document.querySelector('#cmdk .cmdk-board .cmdk-row'));
    const g = document.querySelector('#cmdk .cmdk-boards');
    const cap = document.querySelector('#cmdk .cmdk-board-cap');
    const row = document.querySelector('#cmdk .cmdk-board .cmdk-row-label');
    if (!g || !cap || !row) return null;
    // The caption is a PADDED block and the row label is an inner span, so their
    // border-box lefts are not comparable — add the caption's own padding to get
    // where its text actually starts. (Comparing the raw rects said "10px apart"
    // for a caption that was correctly aligned, and would have said "6px apart"
    // for the real defect: right complaint, wrong number, and green once fixed
    // only by luck.)
    return {
      cols: getComputedStyle(g).gridTemplateColumns.trim().split(/\s+/).length,
      capL: +(cap.getBoundingClientRect().left + parseFloat(getComputedStyle(cap).paddingLeft)).toFixed(1),
      rowL: +row.getBoundingClientRect().left.toFixed(1),
    };
  });
  ok(!!board && board.cols === 1, `RAILS: the boards grid is one column, and says so (${board && board.cols})`);
  ok(!!board && Math.abs(board.capL - board.rowL) <= 1,
    `RAILS: a board's caption shares its rows' left rail (${board && board.capL} vs ${board && board.rowL})`);

  // ============================================================
  // 18) FOURTH PASS — the words and the states.
  // ============================================================

  // 18a) HELP COPY. The generated how-to's chips lost the dead "More: " prefix and
  // their trailing parentheticals long ago; the browsable help ROWS were still
  // building theirs the old way, so the same idea looked like two different things
  // depending on how you asked. Read from cmdkHelp() rather than the DOM because
  // these rows only surface for some queries — the composer is the thing that has
  // to be right, and this way the check cannot pass by rendering nothing.
  const helpCopy = await page.evaluate(() => {
    const items = [];
    for (const q of ['refund', 'block', 'invoice', 'deposit', 'price', 'photos']) {
      try { items.push(...(cmdkHelp(q) || [])); } catch (e) {}
    }
    const chips = items.flatMap((i) => (i.chips || []).map((c) => String(c.label || '')));
    const subs = items.map((i) => String(i.sub || ''));
    return {
      n: items.length,
      more: chips.filter((l) => /^More:/.test(l)),
      parenth: chips.filter((l) => /\([^)]*\)\s*$/.test(l)),
      longSubs: subs.filter((s) => s.length > 60),
      topicKind: items.flatMap((i) => (i.chips || [])).filter((c) => c.kind === 'topic').length,
    };
  });
  ok(helpCopy.n > 0, `COPY: help rows are being built to check (${helpCopy.n})`);
  ok(helpCopy.more.length === 0, `COPY: no help chip still says "More:" (${helpCopy.more.length})`);
  ok(helpCopy.parenth.length === 0, `COPY: nor carries a title's trailing parenthetical (${helpCopy.parenth.length})`);
  ok(helpCopy.topicKind > 0, `COPY: related topics are the muted "goes elsewhere" species (${helpCopy.topicKind})`);
  ok(helpCopy.longSubs.length === 0,
    `COPY: no help sub is a paragraph in a one-line clamp (${helpCopy.longSubs.length}${helpCopy.longSubs[0] ? ': "' + helpCopy.longSubs[0].slice(0, 40) + '…"' : ''})`);

  // 18b) ONE EMPTY STATE. There were three, written independently: one bare centred
  // sentence with no icon, one with icon + title + sub, one with title + sub and no
  // icon — and the same "widen the scope" instruction in two wordings and two
  // capitalisations. Drive all three states and require one shape and one sentence.
  const empt = await page.evaluate(async () => {
    const until = async (fn, ms = 6000) => { const t0 = Date.now(); for (;;) { const v = fn(); if (v) return v; if (Date.now() - t0 > ms) return null; await new Promise((r) => setTimeout(r, 40)); } };
    const shape = () => {
      const n = document.querySelector('#cmdk .cmdk-none');
      if (!n) return null;
      const strong = n.querySelector('strong');
      return {
        icon: !!n.querySelector('.cmdk-none-ic'),
        title: strong ? strong.textContent.trim() : null,
        sub: strong && strong.nextSibling ? String(strong.nextSibling.textContent || '').trim() : null,
      };
    };
    const out = {};
    // (1) a query with no hits, scope 'all'
    try { closeCmdK(); } catch (e) {}
    openCmdK();
    const i = document.getElementById('cmdk-input');
    i.value = 'zzzqqxnothing'; cmdkSearchCore('zzzqqxnothing', false);
    await until(() => !!document.querySelector('#cmdk .cmdk-none'));
    out.noResults = shape();
    // (2) the same, SCOPED — this is the one that must share the widen sentence
    __cmdkScope = 'bookings'; cmdkRender();
    await new Promise((r) => setTimeout(r, 150));
    out.scoped = shape();
    // (3) the scoped EMPTY LANDING with nothing to show — driven off the WORKSPACE
    // snapshot, which is what shapes that state (see __cmdkHomeScope)
    __cmdkHomeScope = 'bookings';
    __cmdkEmpty = true; __cmdkResults = []; __cmdkSuggestN = 0; __cmdkFreqN = 0; __cmdkBriefN = 0;
    cmdkRender();
    await new Promise((r) => setTimeout(r, 150));
    out.landing = shape();
    out.widen = CMDK_WIDEN;
    __cmdkScope = 'all';
    __cmdkHomeScope = 'all';
    return out;
  });
  const shapes = [empt.noResults, empt.scoped, empt.landing];
  ok(shapes.every((s) => s && s.icon), `EMPTY: all three states carry the same mark (${shapes.filter((s) => s && s.icon).length} of 3)`);
  ok(shapes.every((s) => s && s.title && s.sub), 'EMPTY: …and the same title + sub shape');
  // A title/sub pair inside ONE component has to be separated by more than the eye
  // can miss. This title sat 0.8px above its own sub (--body over --row), a hierarchy
  // carried entirely by weight and colour while the size only pretended to help.
  const hier = await page.evaluate(() => {
    const n = document.querySelector('#cmdk .cmdk-none');
    const strong = n && n.querySelector('strong');
    if (!strong) return null;
    const wrap = strong.parentElement;
    return { title: parseFloat(getComputedStyle(strong).fontSize), sub: parseFloat(getComputedStyle(wrap).fontSize) };
  });
  ok(!!hier && hier.title - hier.sub >= 1.5,
    `EMPTY: its title is a real step above its own sub (${hier && hier.title}px over ${hier && hier.sub}px)`);
  // The widen instruction is worded ONCE — CMDK_WIDEN — and this asserts the state
  // that shows it really renders that const, rather than comparing two DOM strings
  // (which is what this used to do, and which broke the moment the two states
  // legitimately diverged). It is also the state's own honesty check: CMDK_WIDEN
  // says "tap All above", so it may only appear where the chip bar is on screen.
  ok(!!empt.scoped && empt.scoped.sub === empt.widen,
    `EMPTY: the scoped no-results state renders the one widen sentence ("${empt.scoped && empt.scoped.sub}")`);
  ok(!!empt.landing && empt.landing.sub !== empt.widen,
    `EMPTY: …and the LANDING doesn't, because its chip bar is hidden ("${empt.landing && empt.landing.sub}")`);

  // …and escaped exactly once. This has to be driven through DEEP search, because
  // that is the only empty state whose title contains the query — and it is the one
  // that used to escape inline, so now that cmdkNoneHtml escapes, passing it
  // pre-escaped would print entities at the owner. `&lt;` in the HTML is CORRECT
  // single escaping (the first version of this check flagged it as a failure); the
  // signature of a double is `&amp;lt;`, and of none at all is a live <b> element.
  const esc = await page.evaluate(async () => {
    const until = async (fn, ms = 8000) => { const t0 = Date.now(); for (;;) { const v = fn(); if (v) return v; if (Date.now() - t0 > ms) return null; await new Promise((r) => setTimeout(r, 60)); } };
    const q = '<b>zzzqqx</b>';
    const i = document.getElementById('cmdk-input');
    i.value = q; cmdkSearchCore(q, false);
    await new Promise((r) => setTimeout(r, 300));
    cmdkDeepOpen();
    await until(() => !!__cmdkDeep);
    await new Promise((r) => setTimeout(r, 300));
    const n = document.querySelector('#cmdk .cmdk-none');
    const out = n ? { text: n.textContent, html: n.innerHTML, live: n.querySelectorAll('b').length } : null;
    try { cmdkDeepClose(); } catch (e) {}
    return out;
  });
  ok(!!esc && esc.text.includes('<b>zzzqqx</b>') && !/&amp;/.test(esc.html) && esc.live === 0,
    `EMPTY: a query with markup in it is escaped once, not twice (${esc && esc.live} live tags)`);

  // 18c) THE THREAD SURVIVES A MISS. The no-results branch returns before the one
  // that renders the thread, so a conversation two answers deep vanished the moment
  // a query found nothing — and came back when the query was fixed.
  const thr = await page.evaluate(async () => {
    const until = async (fn, ms = 6000) => { const t0 = Date.now(); for (;;) { const v = fn(); if (v) return v; if (Date.now() - t0 > ms) return null; await new Promise((r) => setTimeout(r, 40)); } };
    const put = async (q) => { const i = document.getElementById('cmdk-input'); i.value = q; cmdkSearchCore(q, false); await new Promise((r) => setTimeout(r, 500)); };
    try { closeCmdK(); } catch (e) {}
    openCmdK();
    await until(() => document.getElementById('cmdk').classList.contains('open'));
    await put('who owes money');
    await put('how much am i owed');
    const before = document.querySelectorAll('#cmdk .cmdk-turn').length;
    await put('zzzqqxnothing');
    return { before, onMiss: document.querySelectorAll('#cmdk .cmdk-turn').length, none: !!document.querySelector('#cmdk .cmdk-none') };
  });
  ok(!!thr && thr.before > 0, `THREAD: two answered turns put history on screen (${thr && thr.before})`);
  ok(!!thr && thr.none && thr.onMiss === thr.before,
    `THREAD: …and a query that finds nothing does not erase it (${thr && thr.onMiss} of ${thr && thr.before} kept)`);

  // 18d) DEEP SEARCH's zero result stops offering to filter nothing — a lone
  // "All 0" chip, 39px of control directly above the sentence saying there is
  // nothing. The recency switch stays, because widening the window is the one
  // useful thing left to try.
  const dz = await page.evaluate(async () => {
    const until = async (fn, ms = 8000) => { const t0 = Date.now(); for (;;) { const v = fn(); if (v) return v; if (Date.now() - t0 > ms) return null; await new Promise((r) => setTimeout(r, 60)); } };
    const i = document.getElementById('cmdk-input');
    i.value = 'zzzqqxnothing'; cmdkSearchCore('zzzqqxnothing', false);
    await new Promise((r) => setTimeout(r, 300));
    cmdkDeepOpen();
    await until(() => !!__cmdkDeep);
    await new Promise((r) => setTimeout(r, 300));
    const blocks = [...document.querySelectorAll('#cmdk .cmdk-deep-chips')];
    return {
      types: blocks.filter((b) => !b.classList.contains('cmdk-deep-when')).length,
      when: blocks.filter((b) => b.classList.contains('cmdk-deep-when')).length,
      allZero: [...document.querySelectorAll('#cmdk .cmdk-deep-chip')].filter((c) => /^All\s*0$/.test(c.textContent.trim())).length,
      icon: !!document.querySelector('#cmdk .cmdk-none .cmdk-none-ic'),
    };
  });
  ok(!!dz && dz.types === 0 && dz.allZero === 0, `DEEP: a zero result offers no filter for nothing (${dz && dz.types} type rows, ${dz && dz.allZero} "All 0")`);
  ok(!!dz && dz.when === 1, `DEEP: …but keeps the recency switch, which is the one thing left to try (${dz && dz.when})`);
  ok(!!dz && dz.icon, 'DEEP: and its empty state is the shared one, mark and all');
  await page.evaluate(() => { try { cmdkDeepClose(); } catch (e) {} });

  // 18e) THE EMPTY STATE'S MARK HAS TO BE VISIBLE. It is decorative (aria-hidden),
  // so WCAG asks nothing of it — but it is also the thing that makes an empty
  // result look designed rather than broken, and at --accent × 0.6 it measured
  // 1.76:1 against the light search surface: in the DOM, absent on screen. Measured
  // by arithmetic on the COMPUTED colour and opacity against the registered surface
  // — no pixel sampling, so no flake — and in both themes, because the light one is
  // the theme this back office actually ships in and the only one that failed.
  for (const theme of ['dark', 'light']) {
    const mark = await page.evaluate(async (th) => {
      document.body.classList.toggle('light-mode', th === 'light');
      const i = document.getElementById('cmdk-input');
      i.value = 'zzzqqxnothing'; cmdkSearchCore('zzzqqxnothing', false);
      await new Promise((r) => setTimeout(r, 350));
      const el = document.querySelector('#cmdk .cmdk-none-ic');
      if (!el) { document.body.classList.remove('light-mode'); return null; }
      const probe = document.createElement('span');
      probe.style.color = 'var(--cmdk-surface)';
      document.body.appendChild(probe);
      const surface = getComputedStyle(probe).color;
      probe.remove();
      const cs = getComputedStyle(el);
      const out = { color: cs.color, opacity: +cs.opacity, surface };
      document.body.classList.remove('light-mode');
      return out;
    }, theme);
    const rgb = (s) => (String(s).match(/[\d.]+/g) || []).slice(0, 3).map(Number);
    const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    const lum = (c) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
    const contrast = (a, b) => { const l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
    let r = 0;
    if (mark) {
      const ink = rgb(mark.color), bg = rgb(mark.surface);
      r = contrast(ink.map((v, i) => v * mark.opacity + bg[i] * (1 - mark.opacity)), bg);
    }
    ok(!!mark && r >= 3, `EMPTY @${theme}: the mark is actually visible (${r.toFixed(2)}:1 at opacity ${mark && mark.opacity})`);
  }

  // 18f) THE TOP HIT SITS ON THE LIST'S RAIL. Its icon tile was 36px against every
  // other row's 32, which pushed its label to 67px against the list's 63 — the one
  // row the eye lands on first, 4px out of line with the rows it heads. It keeps its
  // four other emphasis signals; only the tile's size went.
  // NB three sibling findings from the same audit did NOT survive measurement and
  // are deliberately not "fixed" here: the hero's action panel and the deep-search
  // CTA look offset but their own left EDGES are on the text rail (21 == 21) and the
  // inset is their internal padding, which is what a panel in a list is supposed to
  // do. Only compare things that are on the same rail to begin with.
  const rail = await page.evaluate(async () => {
    const until = async (fn, ms = 6000) => { const t0 = Date.now(); for (;;) { const v = fn(); if (v) return v; if (Date.now() - t0 > ms) return null; await new Promise((r) => setTimeout(r, 40)); } };
    const i = document.getElementById('cmdk-input');
    i.value = 'bob'; cmdkSearchCore('bob', false);
    const th = await until(() => document.querySelector('#cmdk .cmdk-row.cmdk-tophit .cmdk-row-label'));
    if (!th) return null;
    const other = document.querySelector('#cmdk .cmdk-row:not(.cmdk-tophit):not(.cmdk-hero) .cmdk-row-label');
    if (!other) return null;
    return { top: +th.getBoundingClientRect().left.toFixed(1), row: +other.getBoundingClientRect().left.toFixed(1) };
  });
  ok(!!rail && Math.abs(rail.top - rail.row) <= 1,
    `RAILS: the Top Hit's label is on the same rail as the rows it heads (${rail && rail.top} vs ${rail && rail.row})`);

  // 18g) TWO RAILS, NOT FIVE. The panel EDGES stand on the answer's own text rail and
  // every LABEL stands on the list's — which needed the hero's action gap tightened
  // by 2px (its label sat at 65 against 63) and the deep CTA rebuilt with a row's
  // anatomy (its label sat at 48.4, on neither). Measured as text-start positions, so
  // a padded box and an inner span are comparable — the trap §18f's first draft hit.
  // The hero's action tail only exists when the answer carries one (the bulk chase
  // needs two or more owers, and this fixture has one), so the row is INJECTED the
  // way §15's error check injects its own — the geometry under test is the CSS, not
  // which query happens to produce a bulk action.
  const rails = await page.evaluate(async () => {
    const until = async (fn, ms = 8000) => { const t0 = Date.now(); for (;;) { const v = fn(); if (v) return v; if (Date.now() - t0 > ms) return null; await new Promise((r) => setTimeout(r, 50)); } };
    const i = document.getElementById('cmdk-input');
    i.value = 'bob'; cmdkSearchCore('bob', false);
    await until(() => document.querySelector('#cmdk .cmdk-row'));
    __cmdkResults = [
      { type: 'answer', id: 'rail-a', label: 'You’re owed £955.00 across 3 guests.', sub: 'Money', run: () => {},
        actions: [{ key: 'rail-act', label: 'Request all 3 balances', run: () => {} }] },
      { type: 'booking', id: 'rail-b', label: 'Bob Carter', sub: 'Jollyboat', run: () => {} },
    ];
    __cmdkSel = 0; __cmdkEmpty = false; cmdkRender();
    await until(() => document.querySelector('#cmdk .cmdk-row.cmdk-hero + .cmdk-qa .cmdk-qa-lbl'));
    await new Promise((r) => setTimeout(r, 200));
    const box = document.querySelector('#cmdk .cmdk-box');
    if (!box) return null;
    const bx = box.getBoundingClientRect().left;
    // Two DIFFERENT measurements, kept apart on purpose. `text` is where a box's
    // content starts (its own padding and border added in) and is what you compare
    // between two pieces of TYPE; `edge` is the box's outer boundary and is what you
    // compare between a PANEL and the type it should line up with. Conflating them
    // is how §18f's first draft reported a correctly-aligned caption as 10px out,
    // and how the first draft of this check called a panel sitting exactly on the
    // rail (21) a 5px miss (21 + 4 padding + 1 border = 26).
    const text = (sel) => {
      const e = document.querySelector(sel);
      if (!e) return null;
      const c = getComputedStyle(e);
      return +(e.getBoundingClientRect().left - bx + parseFloat(c.paddingLeft || 0) + parseFloat(c.borderLeftWidth || 0)).toFixed(1);
    };
    const edge = (sel) => {
      const e = document.querySelector(sel);
      return e ? +(e.getBoundingClientRect().left - bx).toFixed(1) : null;
    };
    return {
      heroText: text('#cmdk .cmdk-hero-label'),
      qaPanel: edge('#cmdk .cmdk-row.cmdk-hero + .cmdk-qa'),
      qaLabel: text('#cmdk .cmdk-row.cmdk-hero + .cmdk-qa .cmdk-qa-lbl'),
      rowLabel: text('#cmdk .cmdk-row:not(.cmdk-hero):not(.cmdk-tophit) .cmdk-row-label'),
      ctaLabel: text('#cmdk .cmdk-deep-cta-lbl'),
    };
  });
  const near = (a, b) => a != null && b != null && Math.abs(a - b) <= 1;
  ok(!!rails && near(rails.qaPanel, rails.heroText),
    `RAILS: the hero's action panel stands on the answer's own text rail (${rails && rails.qaPanel} vs ${rails && rails.heroText})`);
  ok(!!rails && near(rails.qaLabel, rails.rowLabel),
    `RAILS: …while its action's WORDS stand on the list's label rail (${rails && rails.qaLabel} vs ${rails && rails.rowLabel})`);
  ok(!!rails && near(rails.ctaLabel, rails.rowLabel),
    `RAILS: and "search everything" is the last ROW of the list, on that same rail (${rails && rails.ctaLabel} vs ${rails && rails.rowLabel})`);

  // ============================================================
  // 19) "SEARCH EVERYTHING" OWNS THE RESULTS AREA WHILE IT RUNS.
  //     The 2px sweep bar above the field is real and works — but it answers, in
  //     chrome, a question the owner asked of the RESULTS. Until this existed,
  //     tapping the CTA left the quick palette's rows sitting there for the whole
  //     server round trip (two, on a typo retry) with nothing in the list saying so;
  //     a FAILED deep search cleared the bar and said nothing at all.
  //     Needs its own page, because the suite's shared route handler answers
  //     instantly — a pending state is only observable against a slow response, and
  //     a failing one only against a 500.
  // ============================================================
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const p2 = await ctx.newPage();
    let failNext = false, slow = 1200;
    await p2.route(/\.php/, async (route) => {
      const url = route.request().url();
      const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
      if (url.includes('bookings.php') && route.request().method() !== 'POST') return json({ bookings });
      if (url.includes('rates.php') && route.request().method() !== 'POST') return json({ properties: [
        { prop_key: 'jollyboat', name: 'Jollyboat', slug: 'jollyboat', couple_rate: 130, extra_adult_rate: 20, child_rate: 10, transaction_pct: 0, booking_fee: 50, max_adults: 2, max_children: 0, max_total: 2, sort_order: 1 },
      ], seasons: {}, occupancy: {} });
      if (url.includes('search.php')) {
        if (failNext) return route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"boom"}' });
        await new Promise((r) => setTimeout(r, slow));
        // A REAL row, and one that survives the merge's SCOPE filter — this suite
        // opens search from view-backoffice, so the snapshot scope is 'bookings'
        // and a message-typed row is scoped away INSIDE cmdkArrangeWide before it
        // can pollute the landing. Both vacuous shapes were hit in turn: an empty
        // payload (merger returns before touching __cmdkResults) and an
        // out-of-scope row (merges, then filters to nothing).
        return json({ ok: true, results: [{ type: 'booking', id: 991, title: 'Zeb Leaktest', sub: 'Booking', date: '2026-07-01' }], counts: { booking: 1 } });
      }
      return json({ ok: true, events: [], logs: {}, results: [], threads: [], enquiries: [], reviews: [], photos: [], value: null, corpus: [], content: {} });
    });
    await p2.goto(`${base}/index.html`, { waitUntil: 'networkidle' });
    await p2.evaluate(async () => { isAuthenticated = true; document.body.classList.add('owner-mode'); await window.loadAdminBundle(); });
    await p2.evaluate(() => loadData()); await p2.waitForTimeout(500);
    await p2.evaluate(() => nav('view-backoffice')); await p2.waitForTimeout(300);
    await p2.evaluate(() => { try { closeCmdK(); } catch (e) {} openCmdK(); });
    await p2.waitForTimeout(500);
    const put = async (q, w = 700) => { await p2.evaluate((s) => { const i = document.getElementById('cmdk-input'); i.value = s; cmdkSearchCore(s, false); }, q); await p2.waitForTimeout(w); };

    await put('bob');
    const pend = await p2.evaluate(async () => {
      cmdkDeepOpen();
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null))));
      const w = document.querySelector('#cmdk .cmdk-none-wait');
      return {
        shown: !!w, role: w && w.getAttribute('role'),
        text: w ? w.textContent.replace(/\s+/g, ' ').trim() : '',
        frame: !!document.querySelector('#cmdk .cmdk-deep-head'),
        stale: document.querySelectorAll('#cmdk .cmdk-row').length,
      };
    });
    ok(!!pend && pend.shown, 'DEEPWAIT: the results area says it is searching, within two frames');
    ok(!!pend && pend.role === 'status', `DEEPWAIT: …and ANNOUNCES it — the sweep bar is aria-hidden decoration (role=${pend && pend.role})`);
    ok(!!pend && pend.frame && pend.stale === 0, `DEEPWAIT: the frame is up and the stale rows are gone (${pend && pend.stale} rows)`);
    await p2.waitForTimeout(1600);
    const done1 = await p2.evaluate(() => ({ wait: !!document.querySelector('#cmdk .cmdk-none-wait'), deep: !!__cmdkDeep }));
    ok(done1.deep && !done1.wait, 'DEEPWAIT: and it hands over to the real result when that lands');

    // A FAILED deep search accounts for itself, in a sentence written for a person.
    await p2.evaluate(() => { try { cmdkDeepClose(); } catch (e) {} }); await p2.waitForTimeout(400);
    failNext = true;
    await put('bob');
    const fail = await p2.evaluate(async () => {
      cmdkDeepOpen();
      for (let i = 0; i < 80; i++) { await new Promise((r) => setTimeout(r, 50)); if (document.querySelector('#cmdk .cmdk-none') && !document.querySelector('#cmdk .cmdk-none-wait')) break; }
      const n = document.querySelector('#cmdk .cmdk-none');
      return { text: n ? n.textContent.replace(/\s+/g, ' ').trim() : '', stuck: !!document.querySelector('#cmdk .cmdk-none-wait'), pending: __cmdkDeepPending };
    });
    failNext = false;
    ok(!!fail && /Couldn’t search everything/.test(fail.text) && !fail.stuck,
      `DEEPWAIT: a failed deep search says so instead of going quiet (${fail && fail.text.slice(0, 46)})`);
    ok(!!fail && !/500|error|boom|\.php|SQLSTATE/i.test(fail.text) && fail.pending === null,
      'DEEPWAIT: …in a sentence written for a person, and nothing is left pending');

    // ABANDONING one must stick. Every exit bumps the stamp so the fetch's own
    // handlers return early — which is exactly why the pending flag has to be
    // cleared by the exit and not by them. The stamp bump on a fresh query was
    // MISSING: a slow response arrived after the owner had moved on and slammed the
    // deep view over their newer query.
    await p2.evaluate(() => { try { cmdkDeepClose(); } catch (e) {} }); await p2.waitForTimeout(400);
    await put('bob');
    const aband = await p2.evaluate(async () => {
      cmdkDeepOpen();
      await new Promise((r) => setTimeout(r, 80));
      const during = !!document.querySelector('#cmdk .cmdk-none-wait');
      const i = document.getElementById('cmdk-input'); i.value = 'cara'; cmdkSearchCore('cara', false);
      await new Promise((r) => setTimeout(r, 200));
      const after = { wait: !!document.querySelector('#cmdk .cmdk-none-wait'), pending: __cmdkDeepPending };
      await new Promise((r) => setTimeout(r, 1700)); // let the abandoned fetch resolve
      return { during, after, settled: { wait: !!document.querySelector('#cmdk .cmdk-none-wait'), deep: !!__cmdkDeep } };
    });
    ok(!!aband && aband.during && !aband.after.wait && aband.after.pending === null,
      'DEEPWAIT: typing over a pending deep search abandons it at once');
    ok(!!aband && !aband.settled.deep && !aband.settled.wait,
      `DEEPWAIT: …and its late response never reopens the deep view over the new query (deep=${aband && aband.settled.deep})`);
    // Clearing INSIDE the 180ms debounce: the empty branch returns before the
    // committed path's clearTimeout, so the old query's federated fetch stayed
    // armed — stamp still current — and its results merged INTO THE LANDING.
    // The fix kills the timer and bumps the stamps in the empty branch itself;
    // this drives the exact race against the slow route.
    const leak = await p2.evaluate(async () => {
      try { closeCmdK(); } catch (e) {}
      openCmdK();
      await new Promise((r) => setTimeout(r, 300));
      const i = document.getElementById('cmdk-input');
      i.value = 'bob'; cmdkSearchCore('bob', false);
      await new Promise((r) => setTimeout(r, 40)); // inside the debounce window
      i.value = ''; cmdkSearchCore('', false);
      await new Promise((r) => setTimeout(r, 1800)); // let any leaked fetch land
      return {
        empty: __cmdkEmpty === true,
        serverRows: __cmdkResults.filter((r) => r && r.label === 'Zeb Leaktest').length,
        loading: (document.getElementById('cmdk-progress') || {}).className || '',
        heads: [...document.querySelectorAll('#cmdk .cmdk-group-label')].map((e) => e.textContent.trim()),
      };
    });
    ok(!!leak && leak.empty && leak.serverRows === 0 && !/is-loading/.test(leak.loading),
      `DEEPWAIT: clearing inside the debounce kills the old query's fetch — nothing merges into the landing (${leak && leak.serverRows} rows, ${leak && leak.loading})`);
    await ctx.close();
  }

  // ============================================================
  // 20) THE DAY LEADS THE LANDING. The brief used to sit BELOW "Most used", so the
  //     panel that calls itself a dashboard opened with two shortcuts above the
  //     greeting and the day's facts.
  //     The second check is the one that matters structurally: the landing renders
  //     SLICES of __cmdkResults by index and every row carries its `cmdk-opt-<i>`
  //     id, so reordering the HTML blocks alone would leave arrow-key nav walking the
  //     old order while the eye jumped between groups. DOM order and index order have
  //     to rise together.
  // ============================================================
  const landing = await page.evaluate(async () => {
    const until = async (fn, ms = 6000) => { const t0 = Date.now(); for (;;) { const v = fn(); if (v) return v; if (Date.now() - t0 > ms) return null; await new Promise((r) => setTimeout(r, 40)); } };
    // "Most used" needs real usage, and its keys come from the live catalog — a
    // hand-written id silently yields an empty group and a vacuous check.
    try {
      const items = cmdkAll('').filter((it) => it.type === 'screen' && it.id != null).slice(0, 2);
      const m = {};
      items.forEach((it, i) => { m[it.type + ':' + it.id] = { n: 9 - i, last: Date.now() }; });
      localStorage.setItem('chb-cmdk-use', JSON.stringify(m));
      __cmdkUse = null;
    } catch (e) {}
    try { closeCmdK(); } catch (e) {}
    openCmdK();
    await until(() => document.getElementById('cmdk').classList.contains('open'));
    cmdkSearchCore('', false);
    await until(() => document.querySelectorAll('#cmdk .cmdk-group-label').length > 1);
    await new Promise((r) => setTimeout(r, 250));
    const box = document.getElementById('cmdk-results');
    const heads = [...box.querySelectorAll('.cmdk-group-label')].map((e) => e.textContent.trim());
    const rows = [...box.querySelectorAll('[role="option"]')].map((e) => ({
      idx: +(e.id || '').replace('cmdk-opt-', ''),
      top: e.getBoundingClientRect().top,
      dbg: ((e.querySelector('.cmdk-row-label, .cmdk-hero-label, .cmdk-chip-lbl') || e).textContent || '').trim().slice(0, 48),
    }));
    return {
      heads,
      freq: __cmdkFreqN, brief: __cmdkBriefN,
      monotonic: rows.every((r, i) => i === 0 || r.idx > rows[i - 1].idx),
      visual: rows.every((r, i) => i === 0 || r.top >= rows[i - 1].top),
      n: rows.length,
      rows,
    };
  });
  if (landing && !(landing.monotonic && landing.visual)) console.log('  [dbg] landing rows:', JSON.stringify(landing.rows, null, 1));
  const gi = landing ? landing.heads.findIndex((h) => /morning|afternoon|evening|night/i.test(h)) : -1;
  const mi = landing ? landing.heads.indexOf('Most used') : -1;
  ok(!!landing && landing.brief > 0 && landing.freq > 0,
    `LANDING: both groups are present to order (${landing && landing.brief} day rows, ${landing && landing.freq} most-used)`);
  ok(gi >= 0 && mi >= 0 && gi < mi,
    `LANDING: the day's greeting leads, above "Most used" (${landing && JSON.stringify(landing.heads)})`);
  ok(!!landing && landing.monotonic && landing.visual,
    `LANDING: …and the row indices still rise down the screen, so arrows follow the eye (${landing && landing.n} rows)`);

  // 20a-ii) …AND THE BRIEF'S ARRAY AGREES WITH THE BOARD ORDER BY CONSTRUCTION.
  // The check above sees only the rows THIS clock composes — the failing pairing
  // (a 'waiting' teach row beside a 'month' pulse) only coexists in some clock
  // windows, which is how the defect passed CI for months and then failed a
  // midnight run. So drive the REAL composer with the teach row forced present
  // and assert every returned row's board rank is non-decreasing against
  // CMDK_BOARDS — the exact invariant cmdkBoardsHtml's slicing depends on.
  const briefOrder = await page.evaluate(() => {
    const oldMiss = window.chbMissList;
    try {
      window.chbMissList = () => [{ q: 'zz-probe-1', at: todayDashed() }, { q: 'zz-probe-2', at: todayDashed() }];
      __cmdkBriefCache = null;
      const rows = cmdkBriefBuild();
      const rank = (it) => { const i = CMDK_BOARDS.findIndex((b) => b.key === (it.board || 'today')); return i < 0 ? CMDK_BOARDS.length : i; };
      return {
        hasTeach: rows.some((r) => r.id === 'brief-teach'),
        boards: rows.map((r) => r.board || 'today'),
        monotonic: rows.every((r, i) => i === 0 || rank(r) >= rank(rows[i - 1])),
      };
    } finally { window.chbMissList = oldMiss; __cmdkBriefCache = null; }
  });
  ok(!!briefOrder && briefOrder.hasTeach,
    `LANDING: the forced teach row reached the composer (boards: ${briefOrder && briefOrder.boards.join(',')})`);
  ok(!!briefOrder && briefOrder.monotonic,
    'LANDING: the brief array rises in board order at ANY hour — the render slices by index, so this is what keeps arrows on the eye’s path');

  // 20b) THE DAY'S CARDS EARN THEIR HEIGHT. Measured at 390px, the boards spent
  // 453px on five facts — 91px each — so a morning with four boards scrolled before
  // it was read. Padding and the caption's leading came out; no type size and no tap
  // target moved, which is what the second check holds. The money row is measured
  // separately because it was the one that WRAPPED: front-loading the guest's name
  // ran "…arrives today — £400.00 to collect" onto a second line (77px against a
  // one-line row's 56), and money-first alone did not fix it — the timing had to move
  // to the sub as well.
  await page.setViewportSize({ width: 390, height: 844 });
  const cards = await page.evaluate(async () => {
    const until = async (fn, ms = 6000) => { const t0 = Date.now(); for (;;) { const v = fn(); if (v) return v; if (Date.now() - t0 > ms) return null; await new Promise((r) => setTimeout(r, 40)); } };
    try { closeCmdK(); } catch (e) {}
    openCmdK();
    await until(() => !!document.querySelector('#cmdk .cmdk-board .cmdk-row'));
    await new Promise((r) => setTimeout(r, 250));
    const boards = [...document.querySelectorAll('#cmdk .cmdk-board')];
    const rows = [...document.querySelectorAll('#cmdk .cmdk-board .cmdk-row')];
    // CHROME per card — its own height less the rows it holds. That is precisely
    // what padding and the caption cost, and unlike a per-fact average it does not
    // move with how many rows a given day happens to have (the first version of this
    // check used the average and read 82px in one fixture and 104 in another, which
    // measures the fixture, not the change).
    const chrome = boards.map((b) => {
      const rh = [...b.querySelectorAll('.cmdk-row')].reduce((a, r) => a + r.getBoundingClientRect().height, 0);
      return Math.round(b.getBoundingClientRect().height - rh);
    });
    return {
      boards: boards.length,
      worstChrome: chrome.length ? Math.max(...chrome) : 999,
      minRow: rows.length ? Math.min(...rows.map((r) => r.getBoundingClientRect().height)) : 0,
      facts: rows.length,
    };
  });
  ok(!!cards && cards.boards > 0 && cards.worstChrome <= 40,
    `CARDS: a day-card spends ${cards && cards.worstChrome}px on padding and its caption (was 44)`);
  ok(!!cards && cards.minRow >= 44, `CARDS: …with the 44px touch floor untouched (${cards && Math.round(cards.minRow)}px)`);
  await page.setViewportSize({ width: 900, height: 900 });

  // ============================================================
  // 21) THE CONTROL CENTRE — pinned live answers + the Running-for-you board.
  //     A pin stores the QUERY and the landing recomputes it on every open, so the
  //     decisive check here is the LIVE one: pin, mutate the data, reopen, and the
  //     figure must MOVE. Asserting only that a tile renders would pass a broken
  //     implementation that framed the day-one answer.
  // ============================================================
  const pinBtn = async () => page.evaluate(() => {
    const b = document.getElementById('cmdk-pin');
    // Computed display, NOT the attribute: the shared button class is
    // `display: flex`, which out-ranks [hidden]'s UA default, so the CSS override
    // is load-bearing and an attribute read would pass with it deleted.
    return b ? { shown: getComputedStyle(b).display !== 'none', pressed: b.getAttribute('aria-pressed'), w: Math.round(b.getBoundingClientRect().width) } : null;
  });
  await page.evaluate(() => { try { closeCmdK(); } catch (e) {} siteContent['search-pins'] = []; openCmdK(); });
  await page.waitForTimeout(500);
  await page.evaluate(() => { const i = document.getElementById('cmdk-input'); i.value = ''; cmdkSearchCore('', false); });
  await page.waitForTimeout(400);
  let pb = await pinBtn();
  ok(!!pb && !pb.shown, 'PIN: the landing offers nothing to pin');
  await page.evaluate(() => { const i = document.getElementById('cmdk-input'); i.value = 'who owes money'; cmdkSearchCore('who owes money', false); });
  await page.waitForTimeout(500);
  pb = await pinBtn();
  ok(!!pb && pb.shown && pb.pressed === 'false' && pb.w >= 24,
    `PIN: an answered question offers the pin, unpressed, at target size (${pb && pb.w}px)`);
  await page.evaluate(() => { const i = document.getElementById('cmdk-input'); i.value = 'bob carter'; cmdkSearchCore('bob carter', false); });
  await page.waitForTimeout(500);
  pb = await pinBtn();
  ok(!!pb && !pb.shown, 'PIN: a record result is not an answer — no pin');
  await page.evaluate(() => { const i = document.getElementById('cmdk-input'); const q = 'set jollyboat to £150 for 20-23 aug'; i.value = q; cmdkSearchCore(q, false); });
  await page.waitForTimeout(500);
  pb = await pinBtn();
  ok(!!pb && !pb.shown, 'PIN: a COMMAND never offers the pin — that would be a write on the landing');
  // Pin it, then prove the tile is LIVE.
  await page.evaluate(() => { const i = document.getElementById('cmdk-input'); i.value = 'who owes money'; cmdkSearchCore('who owes money', false); });
  await page.waitForTimeout(500);
  await page.click('#cmdk-pin');
  await page.waitForTimeout(250);
  pb = await pinBtn();
  ok(!!pb && pb.pressed === 'true', 'PIN: tapping it pins, and the button says so at once');
  const tile1 = await page.evaluate(async () => {
    const i = document.getElementById('cmdk-input'); i.value = ''; cmdkSearchCore('', false);
    await new Promise((r) => setTimeout(r, 350));
    const heads = [...document.querySelectorAll('#cmdk .cmdk-group-label')].map((e) => e.textContent.trim());
    const at = __cmdkResults.findIndex((r) => r && String(r.id || '').startsWith('pin-'));
    // The row RENDERED under the Pinned heading must BE the pin. An array/slice
    // desync (reordering the concat without moving the slice bases) keeps the
    // headings and the monotonic indices intact while parking the DAY'S rows under
    // "Pinned" — the one mutation the other checks cannot see.
    const pinHead = [...document.querySelectorAll('#cmdk .cmdk-group-label')].find((e) => e.textContent.trim() === 'Pinned');
    let underHeading = null;
    for (let el = pinHead && pinHead.nextElementSibling; el; el = el.nextElementSibling) {
      if (el.classList.contains('cmdk-group-label')) break;
      const opt = el.matches('[role="option"]') ? el : el.querySelector('[role="option"]');
      if (opt) { underHeading = String((__cmdkResults[+opt.id.replace('cmdk-opt-', '')] || {}).id || ''); break; }
    }
    return { heads, label: at >= 0 ? __cmdkResults[at].label : null, underHeading };
  });
  ok(!!tile1 && /£400\.00/.test(tile1.label || ''), `PIN: the landing renders the pinned answer (${tile1 && tile1.label})`);
  ok(!!tile1 && /^pin-/.test(tile1.underHeading || ''),
    `PIN: the row under the Pinned heading IS the pin — slices and array agree (${tile1 && tile1.underHeading})`);
  const gi2 = tile1.heads.findIndex((h) => /morning|afternoon|evening|night/i.test(h));
  const pi2 = tile1.heads.indexOf('Pinned');
  ok(pi2 >= 0 && gi2 > pi2, `PIN: Pinned sits between Suggested and the day (${JSON.stringify(tile1.heads)})`);
  const tile2 = await page.evaluate(async () => {
    dbBookings.jollyboat[0].depositPaid = 300; // the world moved on
    const i = document.getElementById('cmdk-input'); i.value = ''; cmdkSearchCore('', false);
    await new Promise((r) => setTimeout(r, 350));
    const at = __cmdkResults.findIndex((r) => r && String(r.id || '').startsWith('pin-'));
    const out = at >= 0 ? __cmdkResults[at].label : null;
    dbBookings.jollyboat[0].depositPaid = 100;
    return out;
  });
  ok(/£200\.00/.test(tile2 || ''), `PIN: …and it is LIVE — the figure moves with the data, £400 → (${tile2})`);
  // The Running-for-you board: watchers + undo surfaced, routed to their commands.
  const ctl = await page.evaluate(async () => {
    siteContent['search-watchers'] = [{ id: 'w9', pk: 'jollyboat', from: '2027-08-03', to: '2027-08-06', tell: '2027-08-01', say: 'Watching Jollyboat — free nights', done: false }];
    chbUndoPush('Price override on Jollyboat', async () => {});
    const i = document.getElementById('cmdk-input'); i.value = ''; cmdkSearchCore('', false);
    await new Promise((r) => setTimeout(r, 350));
    const caps = [...document.querySelectorAll('#cmdk .cmdk-board-cap')].map((e) => e.textContent.trim());
    const rows = [...document.querySelectorAll('#cmdk .cmdk-board .cmdk-row')].map((r) => r.textContent.replace(/\s+/g, ' ').trim());
    const wAt = __cmdkResults.findIndex((r) => r && String(r.id || '').startsWith('ctl-watch'));
    if (wAt >= 0) __cmdkResults[wAt].run();
    await new Promise((r) => setTimeout(r, 350));
    const routed = (document.getElementById('cmdk-input') || {}).value;
    __chbUndo.length = 0; siteContent['search-watchers'] = [];
    return { caps, watcher: rows.some((t) => /Watching Jollyboat/.test(t)), undo: rows.some((t) => /You can undo: Price override/.test(t)), routed };
  });
  ok(!!ctl && ctl.caps.includes('Running for you') && ctl.watcher && ctl.undo,
    `CTL: watchers and undo surface on the Running-for-you board (${ctl && ctl.caps.join(' · ')})`);
  ok(!!ctl && ctl.routed === 'watching',
    `CTL: a watcher row ROUTES to the watching command — stopping stays a second, deliberate tap (${ctl && ctl.routed})`);
  // cmdkBrief() is memoised and returns the CACHED ARRAY ITSELF — the control rows
  // are appended to a COPY, or the first landing render pollutes the cache and
  // every empty re-render inside its 8s TTL (backspace-to-empty, the ✕ clear,
  // Unpin's own rebuild) stacks another ctl row. Two renders back-to-back must
  // yield exactly one of each. (The CTL block above zeroes its state afterwards,
  // which is exactly how the first version of this suite MASKED the bug — so this
  // check re-seeds and renders twice on purpose.)
  const dup = await page.evaluate(async () => {
    // Seed the LIVE cache, not the boot mirror: the CTL block above routed through
    // the `watching` command, whose lazy fetch left __chbWatchers = [] — and a
    // fetched list rightly outranks the mirror (the mirror is only a boot
    // hydration for the no-request landing). That precedence is product
    // behaviour; this check is about duplication, not sourcing.
    __chbWatchers = [{ id: 'w9', pk: 'jollyboat', from: '2027-08-03', to: '2027-08-06', tell: '2027-08-01', say: 'Watching Jollyboat — free nights', done: false }];
    chbUndoPush('Price override on Jollyboat', async () => {});
    const i = document.getElementById('cmdk-input');
    i.value = ''; cmdkSearchCore('', false);
    await new Promise((r) => setTimeout(r, 250));
    i.value = ''; cmdkSearchCore('', false);
    await new Promise((r) => setTimeout(r, 250));
    const watch = __cmdkResults.filter((r) => r && String(r.id || '').startsWith('ctl-watch')).length;
    const undo = __cmdkResults.filter((r) => r && String(r.id || '') === 'ctl-undo').length;
    // …and an inline action's report STRIP must render on a pinned tile — the
    // pin slice renders through cmdkRowWithStrip, or acting from the landing
    // succeeds in silence (the results-loop-only regression class).
    let strip = null;
    const pinAt = __cmdkResults.findIndex((r) => r && String(r.id || '').startsWith('pin-'));
    if (pinAt >= 0) {
      __cmdkActMsg = { idx: pinAt, state: 'ok', say: 'probe strip' };
      cmdkRender(true);
      await new Promise((r) => setTimeout(r, 150));
      strip = !!document.querySelector('#cmdk .cmdk-actmsg.is-ok');
      __cmdkActMsg = null; cmdkRender(true);
    }
    __chbUndo.length = 0; __chbWatchers = []; siteContent['search-watchers'] = [];
    return { watch, undo, strip };
  });
  ok(!!dup && dup.watch === 1 && dup.undo === 1,
    `CTL: two landing renders in the brief's cache window yield ONE of each control row (watch ${dup && dup.watch}, undo ${dup && dup.undo})`);
  ok(!!dup && dup.strip === true,
    'PIN: an inline action reports through the strip on a pinned tile — acting from the landing is never silent');
  // The help list is not a pinnable answer: tapping ? next to the pin used to
  // leave the button armed for the PREVIOUS query — an invisible durable write.
  const helpDisarm = await page.evaluate(async () => {
    const i = document.getElementById('cmdk-input');
    i.value = 'who owes money'; cmdkSearchCore('who owes money', false);
    await new Promise((r) => setTimeout(r, 400));
    const armed = getComputedStyle(document.getElementById('cmdk-pin')).display !== 'none';
    cmdkHelpOpen();
    await new Promise((r) => setTimeout(r, 250));
    return { armed, after: getComputedStyle(document.getElementById('cmdk-pin')).display !== 'none' };
  });
  ok(!!helpDisarm && helpDisarm.armed && !helpDisarm.after,
    'PIN: opening help DISARMS the pin — no invisible write against a cleared query');
  // Unpin from the tile: one gesture, tile visibly leaves.
  const un = await page.evaluate(async () => {
    const i = document.getElementById('cmdk-input'); i.value = ''; cmdkSearchCore('', false);
    await new Promise((r) => setTimeout(r, 350));
    const at = __cmdkResults.findIndex((r) => r && String(r.id || '').startsWith('pin-'));
    if (at < 0) return { fail: 'no pin row' };
    __cmdkSel = at; cmdkRender();
    await new Promise((r) => setTimeout(r, 200));
    const qa = [...document.querySelectorAll('#cmdk .cmdk-qa-row')].find((b) => /Unpin/.test(b.textContent));
    if (!qa) return { fail: 'no unpin action' };
    qa.click();
    await new Promise((r) => setTimeout(r, 300));
    const rows = [...document.querySelectorAll('#cmdk [role="option"]')].map((e) => +(e.id || '').replace('cmdk-opt-', ''));
    return {
      pinsLeft: (siteContent['search-pins'] || []).length,
      heads: [...document.querySelectorAll('#cmdk .cmdk-group-label')].map((e) => e.textContent.trim()),
      monotonic: rows.every((n, i) => i === 0 || n > rows[i - 1]),
    };
  });
  ok(!!un && !un.fail && un.pinsLeft === 0 && !un.heads.includes('Pinned'),
    `PIN: Unpin removes the tile and its heading in one gesture (${un && (un.fail || un.heads.join(' · '))})`);
  ok(!!un && un.monotonic, 'PIN: …and the landing indices still rise down the screen — arrows follow the eye');

  // 22) A TYPED QUERY SPANS EVERY CATEGORY. The workspace snapshot used to land in
  // __cmdkScope, so opening search from Today (this suite's own workspace) pre-scoped
  // it to "Bookings" — and cmdkArrangeWide only widens when the scope yields NOTHING,
  // so a guest with bookings always yielded something and their emails, chats and
  // payments were dropped in silence. Two variables now: __cmdkScope is the owner's
  // choice, __cmdkHomeScope the snapshot, and only the landing reads the snapshot.
  const cats = await page.evaluate(async () => {
    try { closeCmdK(); } catch (e) {}
    nav('view-backoffice');
    await new Promise((r) => setTimeout(r, 120));
    openCmdK();
    // One row per scope domain, all matching the same query — this is what a repeat
    // guest's name really returns once the server merge lands.
    const mixed = [
      { type: 'booking', id: 'sc-b', label: 'Sarah Pemberton', sub: 'Jollyboat', run: () => {} },
      { type: 'message', id: 'sc-m', label: 'Sarah Pemberton', sub: 'chat', run: () => {} },
      { type: 'email', id: 'sc-e', label: 'Sarah Pemberton', sub: 'email', run: () => {} },
      { type: 'payment', id: 'sc-p', label: 'Sarah Pemberton', sub: 'payment', run: () => {} },
      { type: 'guest', id: 'sc-g', label: 'Sarah Pemberton', sub: 'customer', run: () => {} },
    ];
    const kept = () => cmdkArrangeWide(mixed.slice(), 34).filter((r) => !cmdkIsNoteRow(r)).map((r) => r.type);
    const out = { home: __cmdkHomeScope, scope: __cmdkScope, all: kept() };
    // The old behaviour, reproduced exactly — the break-test lives in the gate.
    __cmdkScope = cmdkDefaultScope(); __cmdkWiden = false;
    out.oldWay = kept();
    // An explicit chip choice must still narrow.
    __cmdkScope = 'inbox'; __cmdkWiden = false;
    out.chosen = kept();
    __cmdkScope = 'all'; __cmdkWiden = false;
    // …and the landing's Jump-to is still shaped by the WORKSPACE, which is the
    // thing that must not regress: it is what keeps that list to a few rows
    // (measured 124px → 271px without it). Render it under each snapshot and
    // require the destinations to differ — a landing wired to __cmdkScope (now
    // always 'all') would hand back the same list both times.
    const jump = async (h) => {
      __cmdkHomeScope = h;
      const el = document.getElementById('cmdk-input'); el.value = ''; cmdkSearchCore('', false);
      await new Promise((r) => setTimeout(r, 350));
      return [...document.querySelectorAll('#cmdk .cmdk-jump [role="option"]')].map((e) => e.textContent.trim().split('\n')[0]);
    };
    out.jumpHome = await jump('bookings');
    out.jumpAll = await jump('all');
    __cmdkHomeScope = 'bookings';
    return out;
  });
  ok(!!cats && cats.home === 'bookings' && cats.scope === 'all',
    `CATS: opened from Today — the snapshot is Bookings, what you type is All (${cats && cats.home}/${cats && cats.scope})`);
  ok(!!cats && ['booking', 'message', 'email', 'payment', 'guest'].every((t) => cats.all.includes(t)),
    `CATS: a typed query keeps every category (${cats && cats.all.join(', ')})`);
  ok(!!cats && cats.oldWay.length < cats.all.length && !cats.oldWay.includes('message'),
    `CATS: …and the old workspace-scoped behaviour really did drop them (${cats && cats.oldWay.join(', ')})`);
  ok(!!cats && cats.chosen.includes('message') && !cats.chosen.includes('booking'),
    `CATS: an explicit chip still narrows (${cats && cats.chosen.join(', ')})`);
  ok(!!cats && cats.jumpHome.length > 0 && cats.jumpAll.length > 0
    && cats.jumpHome.join('|') !== cats.jumpAll.join('|'),
    `CATS: the landing's Jump-to is still shaped by the workspace ([${cats && cats.jumpHome}] vs [${cats && cats.jumpAll}])`);

  // ---- 23. PROGRESS IN THE KNOT — the mark's own stroke is the progress
  // track (the approved demo). Travel while cmdkSetLoading's signal is up
  // (the knot and the sweep bar are ONE fact), determinate draw for the
  // encoder download, px-unit custom props (a unitless calc() keyframe
  // silently never moves — the demo's own measured bug), reduced-motion
  // asserted via the CSSOM (Chromium's emulation lies about durations). ----
  console.log('\n== 23. progress lives in the knot ==');
  await page.evaluate(() => openCmdK());
  await page.waitForTimeout(200);
  const knot = await page.evaluate(async () => {
    const out = {};
    cmdkSetLoading(true);
    const ml = document.getElementById('cmdk-ml');
    out.busy = ml.classList.contains('knot-busy');
    out.barOn = document.getElementById('cmdk-progress').classList.contains('is-loading');
    out.clones = ml.querySelectorAll('.knot-live').length;
    chbKnotSeat(); // idempotent — a second seat must not add a second clone
    out.clonesAfterReseat = ml.querySelectorAll('.knot-live').length;
    out.ariaHidden = ml.querySelector('.knot-live').getAttribute('aria-hidden') === 'true';
    out.lenPx = /px$/.test(ml.style.getPropertyValue('--klen').trim());
    // The travel must actually MOVE (the class alone passed while the px bug
    // stood): sample the live path's dash-offset across a beat.
    const p = ml.querySelector('.knot-live path');
    const a = getComputedStyle(p).strokeDashoffset;
    await new Promise((r) => setTimeout(r, 300));
    out.moves = getComputedStyle(p).strokeDashoffset !== a;
    out.trackDim = +getComputedStyle(ml.querySelector('.cmdk-search-ic:not(.knot-live)')).opacity < 0.5;
    cmdkSetLoading(false);
    out.busyCleared = !ml.classList.contains('knot-busy') && !document.getElementById('cmdk-progress').classList.contains('is-loading');
    // Determinate draw: the real fraction lands as --kdone, clears on null.
    chbKnotLoad(0.4);
    const len = parseFloat(ml.style.getPropertyValue('--klen'));
    const done = parseFloat(ml.style.getPropertyValue('--kdone'));
    out.draw = ml.classList.contains('knot-load') && Math.abs(done - len * 0.4) < 1;
    chbKnotLoad(null);
    out.drawCleared = !ml.classList.contains('knot-load') && !ml.style.getPropertyValue('--kdone');
    // Reduced motion: the rule that blanks the TRAVEL exists in the stylesheet
    // (read selectorText first — modern Chromium gives every style rule a
    // cssRules list, and recursing on that first skips them all).
    out.rmRule = false;
    for (const sheet of document.styleSheets) {
      let rules = [];
      try { rules = sheet.cssRules; } catch (e) { continue; }
      for (const r of rules) {
        if (r.media && /prefers-reduced-motion/.test(r.media.mediaText)) {
          for (const rr of r.cssRules || []) {
            if (rr.selectorText && /knot-busy .knot-live path/.test(rr.selectorText) && /none/.test(rr.style.animation + rr.style.animationName)) out.rmRule = true;
          }
        }
      }
    }
    // chbFetchBuf streams REAL progress: a stubbed two-chunk body with a
    // content-length must report rising, clamped fractions and reassemble.
    const oldFetch = window.fetch;
    window.fetch = async () => new Response(new ReadableStream({
      start(c) { c.enqueue(new Uint8Array([1, 2, 3])); c.enqueue(new Uint8Array([4, 5])); c.close(); },
    }), { status: 200, headers: { 'content-length': '5' } });
    const fracs = [];
    const buf = await chbFetchBuf('x.bin', (f) => fracs.push(f));
    window.fetch = oldFetch;
    out.stream = fracs.length >= 2 && fracs[0] < fracs[1] && fracs.every((f) => f <= 1)
      && new Uint8Array(buf).join(',') === '1,2,3,4,5';
    return out;
  });
  ok(knot.busy && knot.barOn, 'cmdkSetLoading lights the knot AND the sweep bar — one fact, one toggle');
  ok(knot.clones === 1 && knot.clonesAfterReseat === 1 && knot.ariaHidden,
    'ONE aria-hidden live clone, and re-seating never adds a second');
  ok(knot.lenPx, 'the length custom props carry px units (a unitless keyframe calc() never moves)');
  ok(knot.moves, 'the lit segment actually TRAVELS the stroke (dash-offset changes between frames)');
  ok(knot.trackDim, 'the resting mark dims to a track beneath the live stroke');
  ok(knot.busyCleared, 'the signal down clears the knot and the bar together');
  ok(knot.draw && knot.drawCleared, 'the determinate draw lands the real fraction and clears on null');
  ok(knot.rmRule, 'reduced motion blanks the travel via a real stylesheet rule');
  ok(knot.stream, 'chbFetchBuf streams rising clamped fractions and reassembles the bytes');
  // The deliberate omission, gated: the boot-time darkstar load must pass NO
  // progress callback (the removed ring's ruling — never report background
  // work nobody is waiting for); the encoder's query-blocked fetch must.
  const src = await page.evaluate(() => fetch('admin.js').then((r) => r.text()));
  ok(/chbFetchBuf\(DARKSTAR\.url\)/.test(src), 'darkstar’s boot load stays SILENT (no progress callback)');
  ok(/chbFetchBuf\(CHB_ENC\.url,\s*\(f\)/.test(src), '…while the encoder’s query-blocked fetch reports real bytes');
  await page.evaluate(() => closeCmdK());

  console.log(fails ? `\n  ${fails} SEARCH-PAGE CHECK(S) FAILED ❌` : '\n  SEARCH-PAGE SUITE PASSED ✅');
  await done(fails);
})();
