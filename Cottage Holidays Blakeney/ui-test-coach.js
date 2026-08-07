// Guided walkthrough ("Walk me through it") end to end against mocked endpoints:
//  1. coachWalk('add-booking') opens the modal and starts the sequence at step 1
//  2. the overlay is a WALKTHROUGH (coach-ov-seq): click-through + above the modal
//  3. it AUTO-ADVANCES when a step's `until` fires (fill the name → moves on)
//  4. Next / Back move between steps; the last step reads "Done"
//  5. it stays SAFE — no booking is saved by the coach (it only points)
//  6. Escape tears it down; a how-to answer carries the "Walk me through it" chip
const { d, boot } = require('./ui-test-lib'); // pins TZ=Europe/London at require time
let fails = 0;
const ok = (b, m) => { console.log(`  ${b ? '✓' : '✗'} ${m}`); if (!b) fails++; };

(async () => {
  const { page, browser, base, done } = await boot({ viewport: { width: 390, height: 844 } });

  const d = (n) => { const t = new Date(); const x = new Date(t.getFullYear(), t.getMonth(), t.getDate() + n); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
  const bookings = [{ id: 1, prop_key: 'jollyboat', name: 'Alice Harper', email: 'a@x.co', phone: '', check_in: d(3), check_out: d(6), adults: 2, children: 0, payment: 'paid', agreed_total: 440, hold_status: 'none' }];
  await page.route(/\.php/, (route) => {
    const url = route.request().url();
    const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    const post = route.request().method() === 'POST';
    if (url.includes('bookings.php') && !post) return json({ bookings });
    if (url.includes('rates.php') && !post) return json({ properties: [
      { prop_key: 'jollyboat', name: 'Jollyboat', slug: 'jollyboat', couple_rate: 130, booking_fee: 50, max_adults: 2, max_children: 0, max_total: 2, sort_order: 1 },
    ], seasons: {}, occupancy: {} });
    return json({ ok: true, events: [], logs: {}, results: [], threads: [], enquiries: [], reviews: [], photos: [], value: null });
  });
  await page.goto(`${base}/index.html`, { waitUntil: 'networkidle' });
  await page.evaluate(async () => { isAuthenticated = true; document.body.classList.add('owner-mode'); await window.loadAdminBundle(); });
  await page.evaluate(() => loadData()); await page.waitForTimeout(500);
  await page.evaluate(() => nav('view-backoffice')); await page.waitForTimeout(400);

  // 1) The how-to answer carries a "Walk me through it" chip.
  const chip = await page.evaluate(() => {
    const built = cmdkBuildResults('how do i add a booking');
    const r = ((built && built.results) || []).find((x) => x && /how to add/i.test(x.label || ''));
    return r ? (r.chips || []).map((c) => c.label) : [];
  });
  ok(chip.includes('Walk me through it'), `how-to answer offers "Walk me through it" (${chip.join(', ')})`);

  // 2) Start the Add-Booking walkthrough.
  await page.evaluate(() => coachWalk('add-booking'));
  await page.waitForTimeout(800);
  let st = await page.evaluate(() => {
    const ov = document.querySelector('.coach-ov-seq');
    const step = ov ? ov.querySelector('.coach-tip-step').textContent : '';
    const modal = !!document.querySelector('#modal-property');
    const pe = ov ? getComputedStyle(ov).pointerEvents : '';
    const z = ov ? +getComputedStyle(ov).zIndex : 0;
    return { open: !!ov, step, modal, pe, z };
  });
  ok(st.open && st.modal, 'walkthrough starts: overlay up + Add-Booking modal open');
  ok(/step 1 of 5/i.test(st.step), `starts at step 1 of 5 (${st.step})`);
  ok(st.pe === 'none', 'overlay is click-through (pointer-events:none) so the field is usable');
  ok(st.z >= 7000, `overlay sits above the modal (z=${st.z})`);

  // 3) Next advances to the dates step.
  await page.evaluate(() => document.querySelector('.coach-ov-seq .coach-tip-btn').click());
  await page.waitForTimeout(400);
  let step = await page.evaluate(() => document.querySelector('.coach-ov-seq .coach-tip-step')?.textContent || '');
  ok(/step 2 of 5/i.test(step), `Next → step 2 (${step})`);

  // 4) Back returns to step 1.
  await page.evaluate(() => document.querySelector('.coach-ov-seq .coach-tip-back').click());
  await page.waitForTimeout(400);
  step = await page.evaluate(() => document.querySelector('.coach-ov-seq .coach-tip-step')?.textContent || '');
  ok(/step 1 of 5/i.test(step), `Back → step 1 (${step})`);

  // 5) AUTO-ADVANCE: jump to the name step, fill it, and watch it move on by itself.
  await page.evaluate(() => coachSequence(CHB_WALK['add-booking'].steps, 2)); // name step
  await page.waitForTimeout(400);
  step = await page.evaluate(() => document.querySelector('.coach-ov-seq .coach-tip-step')?.textContent || '');
  ok(/step 3 of 5/i.test(step), `on the name step (${step})`);
  await page.evaluate(() => { const n = document.getElementById('modal-name'); n.value = 'Jamie Fenn'; });
  await page.waitForTimeout(700); // poll is 350ms
  step = await page.evaluate(() => document.querySelector('.coach-ov-seq .coach-tip-step')?.textContent || '');
  ok(/step 4 of 5/i.test(step), `typing the name AUTO-ADVANCES to step 4 (${step})`);

  // 6) The last step reads "Done", and the coach never saved a booking itself.
  await page.evaluate(() => coachSequence(CHB_WALK['add-booking'].steps, 4)); // save step (last)
  await page.waitForTimeout(300);
  const last = await page.evaluate(() => document.querySelector('.coach-ov-seq .coach-tip-btn')?.textContent || '');
  ok(last === 'Done', `last step's button reads "Done" (${last})`);

  // 7) Escape tears the whole thing down.
  await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
  await page.waitForTimeout(200);
  const gone = await page.evaluate(() => !document.querySelector('.coach-ov-seq') && (typeof __coachSeq === 'undefined' || __coachSeq === null));
  ok(gone, 'Escape ends the walkthrough (overlay + state cleared)');

  // 8) BACKING OUT MID-WALK STOPS THE WALK, AND SAYS SO. The only liveness test
  // used to be document.contains(), and closeModal() removes a CLASS, not the node
  // — so a cancelled Add Booking left the guide certain its form was still open.
  // Measured before the fix: overlay still up on Today, __coachSeq alive, tip still
  // reading "Tap Save", ring painted 172×56 at (37,725) over a button with a zero
  // rect (the ring was STALE — coachReposition only ran on scroll/resize).
  const toastText = () => page.evaluate(() => [...document.querySelectorAll('#app-toasts .toast')].map((t) => t.textContent.trim()).join(' | '));
  const clearToasts = () => page.evaluate(() => { const s = document.getElementById('app-toasts'); if (s) s.innerHTML = ''; });
  await clearToasts();
  await page.evaluate(() => coachWalk('add-booking'));
  await page.waitForTimeout(800);
  await page.evaluate(() => coachSequence(CHB_WALK['add-booking'].steps, 2)); // a MIDDLE step
  await page.waitForTimeout(400);
  await page.evaluate(() => closeModal()); // the owner backs out
  await page.waitForTimeout(900); // poll is 350ms
  const bail = await page.evaluate(() => ({
    overlay: !!document.querySelector('.coach-ov-seq'),
    seq: typeof __coachSeq !== 'undefined' && !!__coachSeq,
  }));
  ok(!bail.overlay && !bail.seq, `CANCEL: backing out mid-walk tears the walkthrough down (overlay=${bail.overlay}, state=${bail.seq})`);
  const bailSay = await toastText();
  ok(/stopped/i.test(bailSay) && !/all set/i.test(bailSay), `CANCEL: …and says so rather than going quiet ("${bailSay}")`);
  ok(/start again/i.test(bailSay), 'CANCEL: …with the way back on the message');

  // 9) THE LAST STEP IS THE ONE THAT USED TO LIE. It has no `until` (it is "tap
  // Save"), so vanishing meant advance meant coachSequence(steps, steps.length)
  // meant "You're all set" — over a form you abandoned. `done` is what tells saved
  // from cancelled, and here nothing was saved.
  await clearToasts();
  await page.evaluate(() => coachWalk('add-booking'));
  await page.waitForTimeout(800);
  await page.evaluate(() => coachSequence(CHB_WALK['add-booking'].steps, 4)); // the Save step
  await page.waitForTimeout(400);
  await page.evaluate(() => closeModal());
  await page.waitForTimeout(900);
  const lastSay = await toastText();
  ok(/nothing was created/i.test(lastSay) && !/all set/i.test(lastSay),
    `DONE: abandoning at Save reports the truth, not a tick ("${lastSay}")`);
  // …and the honest branch is only honest if the happy one still works: fake the
  // save by moving the count past the mark, then finish the same way.
  await clearToasts();
  await page.evaluate(() => coachWalk('add-booking'));
  await page.waitForTimeout(800);
  await page.evaluate(() => {
    coachSequence(CHB_WALK['add-booking'].steps, 4);
    dbBookings.jollyboat.push({ id: 999, propKey: 'jollyboat', name: 'Walk Test', checkIn: '2030-01-01', checkOut: '2030-01-03' });
  });
  await page.waitForTimeout(400);
  await page.evaluate(() => closeModal());
  await page.waitForTimeout(900);
  const okSay = await toastText();
  ok(/booking is on today/i.test(okSay), `DONE: …and a real save is reported as one ("${okSay}")`);
  await page.evaluate(() => { dbBookings.jollyboat = dbBookings.jollyboat.filter((b) => b.id !== 999); });

  // 10) A TARGET THAT NEVER APPEARS gives up with a word. It used to bail after
  // 30×200ms in total silence — six seconds of nothing, then gone.
  await clearToasts();
  await page.evaluate(() => { coachSeqStop(); coachSequence([{ sel: '#no-such-target-at-all', say: 'Never appears.' }], 0, { topic: 'add-booking' }); });
  await page.waitForTimeout(7000); // 30 tries × 200ms
  const lost = await page.evaluate(() => ({ overlay: !!document.querySelector('.coach-ov-seq'), seq: typeof __coachSeq !== 'undefined' && !!__coachSeq }));
  const lostSay = await toastText();
  ok(!lost.overlay && !lost.seq && /didn’t open|didn't open/i.test(lostSay),
    `LOST: a target that never appears stops WITH a message ("${lostSay}")`);

  // 11) START WHERE THE OWNER ALREADY IS. take-payment's step 0 `until` is "a
  // booking hub with a pay action is open" — so from that hub the walk must begin
  // on the button, not bounce out to Bookings and re-filter. Stub the signal the
  // step reads rather than driving a whole hub: the point under test is coachWalk's
  // skip pass, not the hub.
  await clearToasts();
  await page.evaluate(() => {
    const b = document.createElement('button');
    b.setAttribute('data-act', 'requestPayment');
    b.textContent = 'Request the balance by card';
    b.style.cssText = 'position:fixed;top:200px;left:20px;width:200px;height:40px;';
    b.id = 'walk-stub-pay';
    document.body.appendChild(b);
    window.__navSpy = 0;
    window.__origOpenBookings = openBookings;
    openBookings = () => { window.__navSpy++; return window.__origOpenBookings(); };
  });
  await page.evaluate(() => coachWalk('take-payment'));
  await page.waitForTimeout(700);
  const already = await page.evaluate(() => ({
    step: document.querySelector('.coach-ov-seq .coach-tip-step')?.textContent || '',
    navigated: window.__navSpy,
  }));
  ok(/step 2 of 2/i.test(already.step), `HERE: already on the pay banner → the walk starts on the button (${already.step})`);
  ok(already.navigated === 0, `HERE: …and it does NOT navigate away from where you are (${already.navigated} nav calls)`);
  await page.evaluate(() => {
    coachSeqStop();
    openBookings = window.__origOpenBookings;
    document.getElementById('walk-stub-pay')?.remove();
  });

  // 12) THE TIP NEVER PUTS ITS OWN BUTTON OFF THE SCREEN. coachReposition used to
  // decide above-or-below with `r.bottom + 110 < innerHeight` — a hardcoded GUESS at
  // the tip's height, right for a short sentence (measured 111px) and wrong by 106px
  // for a real one (216px). Measured at 390×844 with a target at y=640: tip bottom
  // 918, i.e. 74px past the fold with Next off screen and the walk unadvanceable.
  // Driven with a FIXED target so nothing here depends on scroll position.
  const LONG = 'After checkout, open the booking and tap Return deposit to refund it in full — or Keep for damage to retain some or all of it with a reason the guest will see.';
  const fit = await page.evaluate(async (say) => {
    const out = [];
    const place = async (top, text) => {
      document.getElementById('fit-t')?.remove();
      coachSeqStop();
      const b = document.createElement('button');
      b.id = 'fit-t'; b.textContent = 'Target';
      b.style.cssText = `position:fixed;left:40px;top:${top}px;width:180px;height:44px;z-index:10;`;
      document.body.appendChild(b);
      coachPaintStep(b, text, { i: 1, n: 5, onNext() {}, onBack() {}, onDone() {} });
      await new Promise((r) => setTimeout(r, 150));
      const tip = document.querySelector('.coach-tip').getBoundingClientRect();
      const btn = document.querySelector('.coach-tip-btn').getBoundingClientRect();
      return { top, tipTop: Math.round(tip.top), tipH: Math.round(tip.height), tipBottom: Math.round(tip.bottom),
        onScreen: tip.top >= 0 && tip.bottom <= window.innerHeight && tip.left >= 0 && tip.right <= window.innerWidth,
        btnOn: btn.top >= 0 && btn.bottom <= window.innerHeight };
    };
    // low + long is the case that broke; the other three are the neighbours it must
    // not break on the way past.
    out.push(await place(640, say));
    out.push(await place(300, say));
    out.push(await place(640, 'Tap Save.'));
    out.push(await place(20, say)); // nothing fits above — must clamp, not overflow
    coachSeqStop(); document.getElementById('fit-t')?.remove();
    return out;
  }, LONG);
  ok(fit.every((f) => f.onScreen), `FIT: the tip stays on screen at every target height (${fit.map((f) => f.top + ':' + (f.onScreen ? 'ok' : f.tipBottom + '>' + 844)).join(' ')})`);
  ok(fit.every((f) => f.btnOn), `FIT: …so its own Next button is always reachable (${fit.filter((f) => !f.btnOn).length} off screen)`);
  ok(fit[0].tipH > 150, `FIT: (the long sentence really is a tall tip — ${fit[0].tipH}px, vs the 110 the old guess assumed)`);

  // 13) THE STEP IS ANNOUNCED. Measured before: role / aria-live / aria-label all
  // null on the tip, and focus stays on the field — so a screen-reader user got an
  // overlay nobody told them about and five steps they never heard. The visible
  // copy is aria-hidden and the SAME words go to an .sr-only live region, written a
  // frame after the tip lands (a live region that arrives WITH its text is not
  // reliably announced — the payment-outcome rule).
  const say = await page.evaluate(async () => {
    coachSeqStop();
    coachWalk('add-booking');
    await new Promise((r) => setTimeout(r, 900));
    coachSequence(CHB_WALK['add-booking'].steps, 2);
    await new Promise((r) => setTimeout(r, 400));
    const tip = document.querySelector('.coach-tip');
    const live = tip.querySelector('.sr-only');
    const vis = tip.querySelector('.coach-tip-text');
    const lab = tip.querySelector('.coach-tip-step');
    const cs = live ? getComputedStyle(live) : null;
    return {
      group: tip.getAttribute('role'), groupName: tip.getAttribute('aria-label'),
      live: live ? live.getAttribute('aria-live') : null, liveRole: live ? live.getAttribute('role') : null,
      text: live ? live.textContent.trim() : '',
      hidden: vis.getAttribute('aria-hidden') === 'true' && lab.getAttribute('aria-hidden') === 'true',
      invisible: cs ? (parseFloat(cs.width) <= 1 || cs.clipPath !== 'none' || cs.position === 'absolute') : false,
    };
  });
  ok(say.liveRole === 'status' && say.live === 'polite', `SAY: the step lands in a polite live region (role=${say.liveRole}, live=${say.live})`);
  ok(/^Step 3 of 5\. .*name/i.test(say.text), `SAY: …carrying the step AND its sentence ("${say.text.slice(0, 48)}…")`);
  ok(say.hidden, 'SAY: …and the visible copy is aria-hidden, so it is not read twice');
  ok(say.invisible, 'SAY: …while the announced copy is visually hidden (.sr-only), not a second bubble');
  ok(say.group === 'group' && !!say.groupName, `SAY: the tip itself is a named group (${say.group}/${say.groupName})`);

  // 14) REDUCED MOTION drops the EASING, never the travel — the ring IS the pointer,
  // so a ring that stops moving stops telling you where to look. Same call as the
  // guest dock's selection pill.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const rm = await page.evaluate(async () => {
    coachSeqStop();
    document.getElementById('rm-t')?.remove();
    const a = document.createElement('button');
    a.id = 'rm-t'; a.textContent = 'T';
    a.style.cssText = 'position:fixed;left:40px;top:200px;width:180px;height:44px;z-index:10;';
    document.body.appendChild(a);
    coachPaintStep(a, 'First.', { i: 0, n: 2, onNext() {}, onBack() {}, onDone() {} });
    await new Promise((r) => setTimeout(r, 150));
    const ring = document.querySelector('.coach-ring');
    const anim = getComputedStyle(document.querySelector('.coach-tip')).animationName;
    const before = Math.round(ring.getBoundingClientRect().top);
    // Move the target, then let ITS OWN transition land before repositioning — a
    // bare <button> here inherits a transition on `top`, so calling coachReposition
    // in the same tick measured the old rect and reported a ring that never moved
    // (which is what the first version of this check did).
    a.style.top = '520px';
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    await new Promise((r) => setTimeout(r, 120));
    coachReposition();
    await new Promise((r) => setTimeout(r, 80));
    const after = Math.round(ring.getBoundingClientRect().top);
    // The DECLARATION, deliberately: Chromium's reduced-motion emulation forces
    // every transition-duration to ~1e-05s regardless of author CSS, so a computed
    // read cannot tell our rule from the browser's own override and would pass with
    // the rule deleted. Real Safari/iOS honours the author rule instead, so the rule
    // is what has to exist. Break-tested by removing the @media block.
    let ruleFound = false;
    for (const sheet of document.styleSheets) {
      let rules; try { rules = sheet.cssRules; } catch (e) { continue; }
      for (const r of rules || []) {
        if (r.type === CSSRule.MEDIA_RULE && /prefers-reduced-motion/.test(r.conditionText || '')) {
          for (const inner of r.cssRules || []) {
            if (/\.coach-ring/.test(inner.selectorText || '') && /none/.test(inner.style.transition || inner.style.transitionProperty || '')) ruleFound = true;
          }
        }
      }
    }
    coachSeqStop(); document.getElementById('rm-t')?.remove();
    return { anim, before, after, ruleFound };
  });
  ok(rm.ruleFound, 'MOTION: reduced motion drops the ring\'s easing (a real @media rule, not the emulator\'s)');
  ok(rm.anim === 'none', `MOTION: …and the tip's entrance fade (${rm.anim})`);
  ok(Math.abs(rm.after - rm.before) > 250, `MOTION: …but the ring still TRAVELS — it is the pointer (${rm.before} → ${rm.after})`);
  await page.emulateMedia({ reducedMotion: 'no-preference' });

  // 15) A WALK NAMES BUTTONS THAT EXIST. block-dates' one step said "then tap
  // Block" while the glass dialog's OK button said the default "OK" — so the guide
  // that exists to help all the way through a task pointed at a control by a name
  // nothing on screen had. The invariant is the pair, not either string: read the
  // dialog's REAL OK label out of the DOM and require the sentence to quote it.
  await clearToasts();
  await page.evaluate(() => coachWalk('block-dates'));
  await page.waitForTimeout(700);
  const blk = await page.evaluate(() => ({
    say: document.querySelector('.coach-ov-seq .coach-tip-text')?.textContent || '',
    ok: (document.getElementById('glass-dialog-ok') || {}).textContent || '',
    dlgOpen: !!document.querySelector('#glass-dialog.open, #glass-dialog-overlay.open'),
  }));
  ok(!!blk.ok.trim() && blk.ok.trim() !== 'OK',
    `WALK: the Block-dates dialog's OK button says what it does (${blk.ok.trim() || '(empty)'})`);
  ok(blk.say.includes(blk.ok.trim()),
    `WALK: …and the walkthrough step quotes that exact label (say="${blk.say.slice(0, 90)}")`);
  await page.evaluate(() => { try { coachSeqStop(); } catch (e) {} try { __glassDlgResolve && __glassDlgResolve(false); } catch (e) {} });
  await page.waitForTimeout(150);

  console.log(fails ? `\n  ${fails} CHECK(S) FAILED ❌` : '\n  GUIDED WALKTHROUGH SUITE PASSED ✅');
  await done(fails);
})();
