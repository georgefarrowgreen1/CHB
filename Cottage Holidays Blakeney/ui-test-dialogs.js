// THE DIALOG SAYS WHAT IT IS ABOUT TO DO — driven in a real browser.
//
// Thirty-two of sixty-three confirmations, every destructive one among them,
// used to end in a button reading 'OK': "Delete this booking permanently?" and
// "Refund £75.00 to the guest's card via Square?" answered by the same neutral
// word as any other dialog, with no destructive style at all and no visible
// difference between the button that ACTS and the one that backs out (two
// outlined pills, 15px against 13px). The booking form beside it opened
// already scrolled 337px down with the ✕ over the Adults '+'.
//
// Four claims, each measured rather than read off the source:
//   §1  every registered confirm/prompt names its RESULT on its own button —
//       never 'OK' — and a dialog whose message states money, a deletion or
//       'permanently' wears the destructive style;
//   §2  the primary is visibly the primary (accent fill, or the danger ink),
//       Cancel is transparent, both at one reading size and both at 44px —
//       and no option leaks into the next dialog;
//   §3  the Add-booking form opens AT ITS TOP, its title stays painted, and
//       nothing in the scroller is ever under the ✕ at any scroll position;
//   §4  cancelling a booking raises exactly ONE dialog, not three.
//
// NB the buttons TRANSITION their colour and the box plays chbAlertIn, so a
// sample taken the instant `.open` appears reads mid-flight — measured, a
// plain confirm opened straight after a danger one still read red. Every
// paint check here settles on STATE (getAnimations() empty) first.
const { d, boot } = require('./ui-test-lib'); // pins TZ=Europe/London at require time
let fails = 0;
const ok = (b, m) => { console.log(`  ${b ? '✓' : '✗'} ${m}`); if (!b) fails++; };

// A verb, so the button names an action rather than a thing. Deliberately a
// SHAPE test over the first word plus a small closed list of the imperatives
// this app actually uses — a dictionary would be a list somebody maintains.
const VERBS = /^(add|approve|block|cancel|capture|change|check|clear|continue|delete|discard|edit|free|keep|make|offer|open|record|refund|release|remove|replace|request|return|save|send|set|sign|stop|turn|use|write|yes|i)\b/i;

(async () => {
  const { page, browser, base, done } = await boot({ viewport: { width: 390, height: 844 } });
  const json = (route, o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
  const posts = [];
  const mk = (id, over = {}) => Object.assign({
    id, prop_key: '21a', name: 'Hannah Whitlock', email: 'h@gmail.com', phone: '07700900111',
    check_in: d(-9), check_out: d(-2), check_in_time: '15:00', check_out_time: '10:00',
    adults: 2, children: 0, notes: '', payment: 'paid', deposit_paid: 440,
    agreed_total: 440, agreed_per_night: 130, agreed_nights: 3, agreed_nightly: 390,
    agreed_booking_fee: 50, agreed_txn_pct: 0, agreed_txn_fee: 0, agreed_on: d(-40) + ' 12:00:00',
    damages_deposit: 75, hold_status: 'charged', hold_amount: 75, created_at: d(-40) + ' 12:00:00',
  }, over);
  const rows = [mk(1), mk(2, { name: 'Marcus Ellery', check_in: d(60), check_out: d(63), payment: 'unpaid', deposit_paid: 0, hold_status: 'none' })];
  await page.route(/\.php/, (route) => {
    const url = route.request().url();
    if (route.request().method() === 'POST') {
      try { posts.push(route.request().postDataJSON()); } catch (e) {}
      return json(route, { ok: true, bookings: rows });
    }
    if (url.includes('auth.php')) return json(route, { admin: true, admin_id: 1 });
    if (url.includes('bookings.php')) return json(route, { bookings: rows });
    if (url.includes('rates.php')) return json(route, { properties: [{ prop_key: '21a', name: '21A Westgate', slug: '21a', couple_rate: 130, extra_adult_rate: 0, child_rate: 0, booking_fee: 50, transaction_pct: 0, lastmin_pct: 0, lastmin_days: 0, max_adults: 2, max_children: 0, max_total: 2, sort_order: 1 }], seasons: {}, occupancy: {} });
    return json(route, { ok: true, bookings: [], enquiries: [], properties: [], seasons: {}, occupancy: {}, content: {}, blocks: [], ranges: [], payments: [] });
  });
  await page.goto(`${base}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1300);
  await page.evaluate(() => { isAuthenticated = true; document.body.classList.add('owner-mode'); });
  await page.evaluate(() => window.loadAdminBundle());
  await page.waitForTimeout(800);
  await page.evaluate(() => loadData());
  await page.waitForTimeout(600);

  // Open a dialog by running a REAL entry point, read the rendered pair, then
  // back out. `steps` answers any earlier dialogs in a chain (a prompt that
  // precedes a confirm) so the table can reach the one it means.
  const openDialog = (src, steps = 0) => page.evaluate(async ([src, steps]) => {
    const until = async (fn, ms = 5000) => { const t0 = Date.now(); for (;;) { const v = fn(); if (v) return v; if (Date.now() - t0 > ms) return null; await new Promise((r) => setTimeout(r, 40)); } };
    const dlg = document.getElementById('glass-dialog');
    const isOpen = () => dlg.classList.contains('open');
    // eslint-disable-next-line no-eval
    eval(src);
    for (let i = 0; i < steps; i++) {
      if (!(await until(isOpen))) return { error: 'no dialog at step ' + i };
      glassDialogResolve(true);
      await until(() => !isOpen());
      await new Promise((r) => setTimeout(r, 260));
    }
    if (!(await until(isOpen))) return { error: 'no dialog' };
    const okBtn = document.getElementById('glass-dialog-ok');
    const cxBtn = document.getElementById('glass-dialog-cancel');
    const box = document.querySelector('.glass-dialog-box');
    // SETTLE — the colour transitions and the box animates in.
    await until(() => okBtn.getAnimations().length === 0 && box.getAnimations().length === 0, 3000);
    await new Promise((r) => setTimeout(r, 120));
    const co = getComputedStyle(okBtn), cc = getComputedStyle(cxBtn);
    const r = okBtn.getBoundingClientRect(), rc = cxBtn.getBoundingClientRect();
    const ttl = document.getElementById('glass-dialog-title');
    const out = {
      ok: okBtn.textContent.trim(), cancel: cxBtn.textContent.trim(),
      danger: okBtn.classList.contains('is-danger'),
      accent: okBtn.classList.contains('btn-accent'),
      title: ttl.style.display !== 'none' ? ttl.textContent : null,
      msg: (document.getElementById('glass-dialog-msg') || {}).innerText || '',
      okBg: co.backgroundColor, okColor: co.color, okFs: co.fontSize, okH: Math.round(r.height),
      cxBg: cc.backgroundColor, cxFs: cc.fontSize, cxH: Math.round(rc.height),
      cancelShown: cxBtn.style.display !== 'none',
      dialogs: 1,
    };
    // Back out — and count any dialog that follows, so a flow that asks twice
    // cannot pass as one.
    let guard = 0;
    while (isOpen() && guard++ < 6) {
      glassDialogResolve(false);
      await until(() => !isOpen());
      await new Promise((r) => setTimeout(r, 300));
      if (isOpen()) out.dialogs++;
    }
    return out;
  }, [src, steps]);

  // ---------- §1. every button names its result ----------
  console.log('1. every button names its result');
  // Driven through the REAL entry points — the only version of this assertion
  // that fails when a call site loses its label.
  const TABLE = [
    // b2 has taken NO money — deleteBooking refuses (with an alert, correctly)
    // on one that has, and 'Cancel & refund' is the route there.
    ['delete a booking',        "window.deleteBooking('b2')", 0, true],
    // __msgThreadId is module-scoped (the currentGuest rule), so the thread is
    // opened through its own opener rather than poked into place.
    ['delete a conversation',   "window.openMessageThread(9); window.deleteCurrentThread()", 0, true],
    ['refund to the card',      "window.refundPayment('b1', 'sq_1', 100, 0)", 1, true],
    ['return a deposit',        "window.returnDeposit('b1')", 1, false],
    ['keep a deposit',          "window.keepDeposit('b1')", 0, false],
    ['send the newsletter',     "__mkField('input', 'nl-subject', 'A subject'); __mkField('textarea', 'nl-body', 'A message'); window.sendBroadcast()", 0, false],
    ['delete a review',         "window.deleteLead(3)", 0, true],
    ['discard unsaved changes', "__mkField('input', 'cmdk-editor-field', 'edited'); window.cmdkFieldBack()", 0, true],
    ['clear the passphrase',    "__mkField('input', 'bkpass', ''); window.saveBackupPass()", 0, true],
    ['remove a passkey',        "window.deleteAdminPasskey('k1')", 0, true],
    ['block out dates',         "window.openBlockDates()", 0, false],
    ['record a payment',        "window.recordPayment('b2')", 0, false],
    ['cancel a booking',        "window.cancelBooking('b1')", 0, true],
    ['confirm it is you',       "window.chbReauthPrompt('refunding £75.00')", 0, false],
  ];
  // Some entry points read a field the page normally renders. Made once, here,
  // rather than as markup smuggled through eval.
  await page.evaluate(() => {
    window.__mkField = (tag, id, val) => {
      let el = document.getElementById(id);
      if (!el) { el = document.createElement(tag); el.id = id; document.body.appendChild(el); }
      el.value = val;
      return el;
    };
  });
  const seen = [];
  for (const [name, src, steps, wantDanger] of TABLE) {
    const r = await openDialog(src, steps);
    if (r.error) { ok(false, `${name}: the dialog opened (${r.error})`); continue; }
    seen.push({ name, ...r });
    ok(r.ok !== 'OK', `${name}: the button is not 'OK' (${r.ok})`);
    ok(VERBS.test(r.ok), `${name}: …and it names an action (${r.ok})`);
    if (wantDanger) ok(r.danger === true, `${name}: destructive, so the OK wears the destructive style (danger=${r.danger})`);
  }
  // Vacuity guard: a table that stopped reaching its dialogs would pass silently.
  ok(seen.length === TABLE.length, `every registered entry point reached its dialog (${seen.length}/${TABLE.length})`);
  // THE RULE, stated as a property rather than a list: a dialog whose message
  // states money leaving, or a deletion, must be destructive-styled.
  const shouldDanger = seen.filter((s) => /\bpermanently\b|\bdelete\b|\bdiscard\b|\bclear the passphrase\b/i.test(s.msg + ' ' + (s.title || '')));
  ok(shouldDanger.length >= 4 && shouldDanger.every((s) => s.danger),
    `a dialog that says 'delete', 'discard' or 'permanently' is styled destructive (${shouldDanger.filter((s) => !s.danger).map((s) => s.name).join(', ') || 'all ' + shouldDanger.length + ' are'})`);
  // …and the converse, so this cannot erode into "everything is red": an
  // ordinary confirm keeps the accent primary.
  const plainOnes = seen.filter((s) => !s.danger);
  ok(plainOnes.length >= 4 && plainOnes.every((s) => s.accent),
    `an ordinary confirm keeps the accent primary (${plainOnes.length} of them)`);

  // ---------- §2. the primary looks primary ----------
  console.log('2. the primary is distinguished from the way out');
  // The pair to compare against is read off `body`, where light mode retunes
  // it — reading :root compares against the dark value (the .btn-primary
  // lesson). Resolved through a probe element so a hex becomes the same
  // rgb() string the button's computed background is reported in.
  const accentPaint = await page.evaluate(() => {
    const cs = getComputedStyle(document.body);
    const probe = document.createElement('span');
    probe.style.cssText = 'position:absolute;left:-9999px';
    document.body.appendChild(probe);
    const asRgb = (v) => { probe.style.color = v; const c = getComputedStyle(probe).color; return c; };
    const out = { accent: asRgb(cs.getPropertyValue('--accent').trim()), ink: asRgb(cs.getPropertyValue('--accent-ink').trim()), raw: cs.getPropertyValue('--accent').trim() };
    probe.remove();
    return out;
  });
  for (const theme of ['dark', 'light']) {
    await page.evaluate((t) => document.body.classList.toggle('light-mode', t === 'light'), theme);
    const pair = await page.evaluate(() => {
      const cs = getComputedStyle(document.body);
      const probe = document.createElement('span');
      probe.style.cssText = 'position:absolute;left:-9999px';
      document.body.appendChild(probe);
      const asRgb = (v) => { probe.style.color = v; return getComputedStyle(probe).color; };
      const out = { accent: asRgb(cs.getPropertyValue('--accent').trim()), ink: asRgb(cs.getPropertyValue('--accent-ink').trim()) };
      probe.remove();
      return out;
    });
    const plain = await openDialog("glassConfirm('An ordinary question?', 'Do the thing')");
    const danger = await openDialog("glassConfirm('Delete it permanently?', 'Delete the thing', { danger: true })");
    // THE ASSERTION IS THE PAINT, not "not transparent": the old pair differed
    // by a 5% white wash, which is not transparent either and is exactly what
    // this pass exists to replace.
    ok(plain.okBg === pair.accent && plain.okColor === pair.ink,
      `${theme}: the primary wears the house accent pair (${plain.okBg} on ${plain.okColor}, want ${pair.accent} on ${pair.ink})`);
    ok(plain.cxBg === 'rgba(0, 0, 0, 0)', `${theme}: …and the way out stays transparent (${plain.cxBg})`);
    ok(plain.okFs === plain.cxFs && plain.okFs === '15px',
      `${theme}: one reading size across the pair (${plain.okFs} / ${plain.cxFs})`);
    ok(plain.okH >= 44 && plain.cxH >= 44, `${theme}: both meet the 44px floor (${plain.okH} / ${plain.cxH})`);
    ok(danger.okBg === 'rgba(0, 0, 0, 0)' && danger.okColor !== plain.okColor,
      `${theme}: a destructive OK is red INK on no fill, never the inviting default (${danger.okColor} on ${danger.okBg})`);
    ok(danger.okFs === plain.okFs && danger.okH >= 44, `${theme}: …at the same size and reach`);
  }
  await page.evaluate(() => document.body.classList.remove('light-mode'));
  ok(!!accentPaint.accent && !!accentPaint.ink, `the fill reads the house pair (--accent ${accentPaint.accent} on --accent-ink ${accentPaint.ink})`);

  // NEITHER LABEL IS EVER CLIPPED. Naming both outcomes made the pair longer
  // than a 360px dialog's row — measured, each label ran 26-48px past its own
  // pill and the row scrolled sideways. A clipped destructive verb is the one
  // thing this pass must not ship, so the pair stacks rather than shrinking.
  // The measurement is the INK (a Range over the button's text), not the box:
  // the box stays put while the words run out of it.
  const fitBad = [];
  for (const w of [360, 390, 430, 1280]) {
    await page.setViewportSize({ width: w, height: 844 });
    const f = await page.evaluate(async () => {
      const until = async (fn, ms = 4000) => { const t0 = Date.now(); for (;;) { const v = fn(); if (v) return v; if (Date.now() - t0 > ms) return null; await new Promise((r) => setTimeout(r, 40)); } };
      const p = glassConfirm('This frees the dates and emails the guest.', 'Cancel the booking', { title: 'Cancel Hannah\u2019s booking', cancelLabel: 'Keep the booking', danger: true });
      await until(() => document.getElementById('glass-dialog').classList.contains('open'));
      await new Promise((r) => setTimeout(r, 500));
      const row = document.querySelector('.glass-dialog-btns');
      const ink = (el) => { const rg = document.createRange(); rg.selectNodeContents(el); return rg.getBoundingClientRect(); };
      const one = (el) => { const b = el.getBoundingClientRect(), i = ink(el); return { over: Math.round(Math.max(i.right - b.right, b.left - i.left)), h: Math.round(b.height) }; };
      const out = { ok: one(document.getElementById('glass-dialog-ok')), cx: one(document.getElementById('glass-dialog-cancel')),
                    scroll: Math.round(row.scrollWidth - row.clientWidth) };
      glassDialogResolve(false); await p; await new Promise((r) => setTimeout(r, 320));
      return out;
    });
    if (f.ok.over > 0 || f.cx.over > 0 || f.scroll > 0 || f.ok.h < 44 || f.cx.h < 44) fitBad.push(`${w}px: ok+${f.ok.over}/${f.ok.h} cancel+${f.cx.over}/${f.cx.h} scroll ${f.scroll}`);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  ok(fitBad.length === 0, `two named outcomes never clip and never scroll the row (${fitBad.join(' | ') || 'clean at 360/390/430/1280'})`);

  // NOTHING LEAKS. The OK and Cancel nodes and the danger class are SHARED, so
  // every option has to be reassigned on every open — the documented okLabel
  // trap, which cancelLabel and danger both inherit. The check asserts the
  // button shows THIS dialog's own label, not the last one's.
  const leak = await page.evaluate(async () => {
    const until = async (fn, ms = 5000) => { const t0 = Date.now(); for (;;) { const v = fn(); if (v) return v; if (Date.now() - t0 > ms) return null; await new Promise((r) => setTimeout(r, 40)); } };
    const dlg = document.getElementById('glass-dialog');
    const shot = async (p) => {
      await until(() => dlg.classList.contains('open'));
      const o = document.getElementById('glass-dialog-ok'), c = document.getElementById('glass-dialog-cancel');
      const t = document.getElementById('glass-dialog-title');
      const v = { ok: o.textContent.trim(), cancel: c.textContent.trim(), danger: o.classList.contains('is-danger'), title: t.style.display !== 'none' ? t.textContent : null, rows: document.querySelectorAll('#glass-dialog-rows .ods-qrow').length };
      c.click();
      await p;
      await new Promise((r) => setTimeout(r, 300));
      return v;
    };
    const a = await shot(glassConfirm('one?', 'Send 2 requests', { cancelLabel: 'Keep the booking', danger: true, title: 'A named dialog' }));
    const b = await shot(glassDialog({ type: 'confirm', message: 'two?', rows: [{ label: 'a row', sub: 'its sub' }] }));
    const c = await shot(glassConfirm('three?'));
    return { a, b, c };
  });
  ok(leak.a.ok === 'Send 2 requests' && leak.a.cancel === 'Keep the booking' && leak.a.danger && leak.a.title === 'A named dialog',
    `a dialog that names both buttons renders both (${leak.a.ok} / ${leak.a.cancel})`);
  ok(leak.b.ok === 'OK' && leak.b.cancel === 'Cancel' && !leak.b.danger && leak.b.title === null && leak.b.rows === 1,
    `the next dialog shows its OWN label, way out, style and title (${leak.b.ok} / ${leak.b.cancel} / danger=${leak.b.danger} / title=${leak.b.title})`);
  ok(leak.c.rows === 0, 'and a plain confirm after a row dialog carries no leaked rows');

  // A row is DATA, not markup: the slot exists for the queue tray and must
  // never become a way to put HTML in the shared dialog.
  const esc = await page.evaluate(async () => {
    const until = async (fn, ms = 4000) => { const t0 = Date.now(); for (;;) { const v = fn(); if (v) return v; if (Date.now() - t0 > ms) return null; await new Promise((r) => setTimeout(r, 40)); } };
    const p = glassDialog({ type: 'alert', message: 'x', rows: [{ label: '<img src=x onerror="window.__pwned=1">', sub: '<b>bold</b>' }] });
    await until(() => document.getElementById('glass-dialog').classList.contains('open'));
    const host = document.getElementById('glass-dialog-rows');
    const out = { imgs: host.querySelectorAll('img,b').length, text: host.textContent, pwned: !!window.__pwned };
    document.getElementById('glass-dialog-ok').click();
    await p;
    return out;
  });
  ok(esc.imgs === 0 && !esc.pwned && /<img/.test(esc.text), 'a row is escaped text, never a raw-HTML slot');

  // ---------- §3. the booking form opens at its top ----------
  console.log('3. the booking form opens at its top');
  await page.evaluate(() => window.openAddBooking());
  await page.waitForTimeout(700);
  const form = await page.evaluate(async () => {
    const sc = document.querySelector('#edit-modal .modal-scroll');
    const x = document.querySelector('#edit-modal .modal-x');
    const ttl = document.getElementById('modal-title');
    const tr = ttl.getBoundingClientRect(), xr = x.getBoundingClientRect(), cr = sc.getBoundingClientRect();
    const out = {
      scrollTop: sc.scrollTop,
      scrollable: sc.scrollHeight - sc.clientHeight,
      titlePainted: tr.height > 0 && tr.top >= 0 && tr.bottom <= innerHeight,
      titleText: ttl.textContent,
      xPos: getComputedStyle(x).position,
      // The effective hit region: the 36px circle grown by its ::before.
      xReach: (() => { const b = getComputedStyle(x, '::before'); const i = parseFloat(b.top) || 0; return Math.round(xr.width - 2 * i); })(),
      headOutsideScroller: !sc.contains(ttl) && !sc.contains(x),
      positions: 0, hits: 0, sample: [],
    };
    // Sweep every scroll position. The rect is CLIPPED to the scroller first:
    // a scrolled control keeps reporting where it WOULD be while overflow
    // paints none of it, and the question is about pixels.
    for (let top = 0; top <= out.scrollable; top += 20) {
      sc.scrollTop = top;
      await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
      out.positions++;
      const bad = [...sc.querySelectorAll('input,select,button,textarea,label,.modal-sec')].filter((el) => {
        const r0 = el.getBoundingClientRect();
        if (!r0.width || !r0.height) return false;
        const rr = { left: Math.max(r0.left, cr.left), right: Math.min(r0.right, cr.right), top: Math.max(r0.top, cr.top), bottom: Math.min(r0.bottom, cr.bottom) };
        if (rr.right <= rr.left || rr.bottom <= rr.top) return false;
        return !(rr.right <= xr.left || rr.left >= xr.right || rr.bottom <= xr.top || rr.top >= xr.bottom);
      });
      // …and the tap itself: at the ✕'s centre, elementFromPoint must return
      // the ✕. That is the form the defect took — the tap that should have
      // added an adult closed the form.
      const px = document.elementFromPoint(xr.x + xr.width / 2, xr.y + xr.height / 2) || {};
      if (bad.length || !/modal-x/.test(px.className || '')) {
        out.hits++;
        if (out.sample.length < 4) out.sample.push(top + ':' + ((bad[0] && (bad[0].id || bad[0].className)) || px.id || px.className));
      }
    }
    sc.scrollTop = 0;
    return out;
  });
  ok(form.scrollTop === 0, `a fresh open starts at the top of the form — the stay leads (scrollTop ${form.scrollTop})`);
  ok(form.scrollable > 200, `…and the form really is longer than the screen, so that is a claim (${form.scrollable}px of scroll)`);
  ok(form.titlePainted && /booking/i.test(form.titleText), `the title is painted and names the form (${form.titleText})`);
  ok(form.headOutsideScroller && form.xPos !== 'absolute', `the head is a sibling of the scroller, not floating over it (position: ${form.xPos})`);
  ok(form.xReach >= 44, `the ✕ reaches the 44px floor (${form.xReach}px effective)`);
  ok(form.hits === 0, `nothing in the form is ever under the ✕ (${form.hits} of ${form.positions} scroll positions: ${form.sample.join(' | ')})`);

  // ON TOUCH THE KEYBOARD STAYS SHUT. The scroll came from focusing the name
  // field; on a phone that also opens the keyboard over the form — the rule
  // the guest enquiry form already records. A second context, because
  // `(pointer: fine)` cannot be changed on a live page.
  const touch = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  await touch.route(/\.php/, (route) => {
    const url = route.request().url();
    if (route.request().method() === 'POST') return json(route, { ok: true });
    if (url.includes('auth.php')) return json(route, { admin: true, admin_id: 1 });
    if (url.includes('rates.php')) return json(route, { properties: [{ prop_key: '21a', name: '21A Westgate', slug: '21a', couple_rate: 130, extra_adult_rate: 0, child_rate: 0, booking_fee: 50, transaction_pct: 0, lastmin_pct: 0, lastmin_days: 0, max_adults: 2, max_children: 0, max_total: 2, sort_order: 1 }], seasons: {}, occupancy: {} });
    return json(route, { ok: true, bookings: [], enquiries: [], properties: [], seasons: {}, occupancy: {}, content: {}, blocks: [], ranges: [], payments: [] });
  });
  await touch.goto(`${base}/index.html`, { waitUntil: 'domcontentloaded' });
  await touch.waitForTimeout(1300);
  await touch.evaluate(() => { isAuthenticated = true; document.body.classList.add('owner-mode'); });
  await touch.evaluate(() => window.loadAdminBundle());
  await touch.waitForTimeout(800);
  await touch.evaluate(() => loadData());
  await touch.waitForTimeout(500);
  await touch.evaluate(() => window.openAddBooking());
  await touch.waitForTimeout(700);
  const tch = await touch.evaluate(() => ({
    fine: matchMedia('(hover: hover) and (pointer: fine)').matches,
    active: document.activeElement ? document.activeElement.id : '',
    scrollTop: document.querySelector('#edit-modal .modal-scroll').scrollTop,
  }));
  ok(tch.fine === false, `the touch context really is coarse-pointered (fine=${tch.fine})`);
  ok(tch.active !== 'modal-name', `on touch the name field is not focused, so no keyboard covers the form (focus: ${tch.active || 'the box'})`);
  ok(tch.scrollTop === 0, `…and the form still opens at its top (${tch.scrollTop})`);
  await touch.close();

  // ---------- §4. cancelling is ONE dialog ----------
  console.log('4. cancelling a booking is one dialog');
  const cancelFlow = await page.evaluate(async () => {
    const until = async (fn, ms = 5000) => { const t0 = Date.now(); for (;;) { const v = fn(); if (v) return v; if (Date.now() - t0 > ms) return null; await new Promise((r) => setTimeout(r, 40)); } };
    const dlg = document.getElementById('glass-dialog');
    window.cancelBooking('b1');
    let count = 0; const shots = [];
    for (let i = 0; i < 6; i++) {
      if (!(await until(() => dlg.classList.contains('open'), 1400))) break;
      count++;
      shots.push({
        title: (document.getElementById('glass-dialog-title') || { style: {} }).style.display !== 'none' ? document.getElementById('glass-dialog-title').textContent : null,
        ok: document.getElementById('glass-dialog-ok').textContent.trim(),
        cancel: document.getElementById('glass-dialog-cancel').textContent.trim(),
        danger: document.getElementById('glass-dialog-ok').classList.contains('is-danger'),
        fields: [...document.querySelectorAll('#glass-dialog-fields input')].map((i2) => ({ id: i2.id, type: i2.type, value: i2.value })),
        hints: [...document.querySelectorAll('#glass-dialog-fields .gdf-hint')].map((h) => h.textContent),
      });
      // Answer OK, so a chained flow would show us its next dialog.
      glassDialogResolve(true);
      await until(() => !dlg.classList.contains('open'));
      await new Promise((r) => setTimeout(r, 320));
    }
    return { count, shots };
  });
  ok(cancelFlow.count === 1, `cancelling raises exactly ONE dialog, not three (${cancelFlow.count})`);
  const c1 = cancelFlow.shots[0] || {};
  ok(/Cancel .*booking/i.test(c1.title || ''), `it names itself in the title tier (${c1.title})`);
  ok(c1.ok === 'Cancel the booking' && c1.cancel === 'Keep the booking',
    `both outcomes are named on their own buttons (${c1.ok} / ${c1.cancel})`);
  ok(c1.danger === true, 'and the one that ends the booking wears the destructive style');
  ok((c1.fields || []).length === 2 && c1.fields[0].id === 'gdf-refund' && c1.fields[0].type === 'number' && c1.fields[1].id === 'gdf-reason',
    `the refund and the reason are labelled fields on the one dialog (${(c1.fields || []).map((f) => f.id + ':' + f.type).join(', ')})`);
  ok((c1.hints || []).some((h) => /Received so far/.test(h)), `the refund field explains what it is against (${(c1.hints || [])[0]})`);
  const cancelPost = posts.filter((p) => p && p.action === 'cancel').pop();
  ok(!!cancelPost && cancelPost.refund_amount === 440,
    `…and the one dialog still posts the cancellation it collected (refund ${cancelPost && cancelPost.refund_amount})`);

  console.log(fails ? `\n${fails} FAILED` : '\nAll dialog checks passed');
  await done(fails);
})().catch((e) => { console.error(e); process.exit(1); });
