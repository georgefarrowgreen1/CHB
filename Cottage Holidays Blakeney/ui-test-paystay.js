// ============================================================
//  ui-test-paystay.js — the pay screen and My Stays, measured (dev/CI only).
//
//  Six things the money surfaces were getting wrong that no existing suite
//  could see, because each is about the PAINT rather than about the words:
//   §1 an ALREADY-ARRANGED balance's demoted button paints quiet — and an
//      unpaid ask paints the accent. The same assertion both ways, because a
//      "quiet" rule that has simply been deleted would pass a one-sided check.
//   §2 a busy Pay button paints exactly ONE spinner (the ring beside
//      "Processing…") with the shimmer behind it — never a second ring pinned
//      half-clipped at its corner — and does not dim while money moves.
//   §3 the receipt says "Payment received" ONCE, and raises no toast.
//   §4 the hub's ask and the card's ask, a screen apart, paint one colour.
//   §5 at 1280 no label and its figure are a page apart, and no control on the
//      guest's own account screen is wider than the column it sits in.
//   §6 the stay header never ENDS a line on its own separator, the padlock sits
//      on the first line of its sentence, the cottage's rule IS the card's top
//      edge, the money field carries the £, and the error panel's two buttons
//      are one size.
//
//  Every section carries a vacuity guard: a fixture that fails to render must
//  fail the gate, never pass it by measuring nothing. §6 runs with the pay page
//  still open, before §4–§5 open My Stays — the numbers name the finding, the
//  order names the fixture.
// ============================================================
const { bootBrowser } = require('./ui-test-lib'); // pins TZ=Europe/London at require time
let fails = 0;
const ok = (b, m) => { console.log(`  ${b ? '✓' : '✗'} ${m}`); if (!b) fails++; };

// getComputedStyle can hand back `color(srgb 0.99 …)` in 0–1 floats where rgb()
// is 0–255 — the false-contrast trap this codebase has produced six times. Parse
// to 0–255 + alpha, whichever form arrives.
const rgba = (str) => {
  const n = (String(str).match(/[\d.]+/g) || []).map(Number);
  if (n.length < 3) return null;
  const sc = n[0] <= 1 && n[1] <= 1 && n[2] <= 1 && !/rgb/.test(String(str)) ? 255 : 1;
  return { r: n[0] * sc, g: n[1] * sc, b: n[2] * sc, a: n.length > 3 ? n[3] : 1 };
};
const near = (x, y, tol) => x && y && Math.abs(x.r - y.r) <= (tol || 2) && Math.abs(x.g - y.g) <= (tol || 2) && Math.abs(x.b - y.b) <= (tol || 2);

(async () => {
  const { browser, base, done: harnessDone } = await bootBrowser();
  const d = (n) => { const t = new Date(); const x = new Date(t.getFullYear(), t.getMonth(), t.getDate() + n); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };

  // ============================================================
  //  THE PAY SCREEN (§1–§3)
  // ============================================================
  const payPage = await browser.newPage({ viewport: { width: 390, height: 900 } });
  payPage.on('pageerror', (e) => { console.log('  PAGEERR:', e.message); fails++; });
  await payPage.addInitScript(() => {
    if (navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(() => {});
    // The Square SDK, stubbed exactly as ui-test-pay stubs it: the card field
    // attaches as a no-op and tokenize approves, so the charge path is real
    // from submitPayment down.
    window.Square = {
      payments: () => ({
        card: async () => ({ attach: async () => {}, tokenize: async () => ({ status: 'OK', token: 'tok_test_1' }) }),
        paymentRequest: () => { throw new Error('no wallets in this test'); },
      }),
    };
  });
  await payPage.route(/\.php/, (route) => {
    const url = route.request().url();
    const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (route.request().method() === 'POST') {
      const b = JSON.parse(route.request().postData() || '{}');
      const who = url.split('/').pop().split('?')[0];
      if (who === 'pay.php' && b.action === 'summary') {
        // Booking 30: a balance whose collection is ALREADY ARRANGED and running
        // (armed, no repair) — the state whose ask must be demoted. autopayRepair
        // absent is load-bearing: a failed card is TROUBLE, which keeps the full
        // ask, and openPayView gates on exactly that.
        if (b.booking_id === '30') return json({
          ok: true, propName: 'Annex', propKey: 'jollyboat', guestName: 'Debbie McGoldrick',
          checkIn: '2026-08-27', checkOut: '2026-08-30', currency: 'GBP', kind: 'balance',
          total: 700, alreadyPaid: 175, balance: 525, depositPct: 25, amountDue: 525,
          damagesDue: 0, depositCharged: 50, holdAmount: 50, holdStatus: 'charged',
          balanceDueDate: '2030-01-15', part: null,
          quote: '30:balance:525.00:0123456789abcdef0123456789abcdef',
          autopayTerms: null, autopayState: 'armed', instalmentOffer: null, autopayRepair: null,
        });
        // Booking 31: the ordinary unpaid ask — the control for §1.
        return json({
          ok: true, propName: 'Annex', propKey: 'jollyboat', guestName: 'Debbie McGoldrick',
          checkIn: '2026-08-27', checkOut: '2026-08-30', currency: 'GBP', kind: 'balance',
          total: 390, alreadyPaid: 100, balance: 290, depositPct: 25, amountDue: 290,
          damagesDue: 50, holdAmount: 0, holdStatus: 'none', balanceDueDate: '2030-01-15',
          part: { min: 20, max: 290 }, quote: '31:balance:340.00:0123456789abcdef0123456789abcdef',
        });
      }
      if (who === 'pay.php' && b.action === 'charge')
        return json({ ok: true, fullyPaid: true, charged: 340, remaining: 0, autopay: null });
      return json({ ok: true });
    }
    if (url.includes('square-config.php')) return json({ enabled: true, applicationId: 'app-id', locationId: 'loc-id', environment: 'sandbox' });
    if (url.includes('rates.php')) return json({ properties: [{ prop_key: 'jollyboat', name: 'Annex', slug: 'annex', accent: '#5BA88F', couple_rate: 130, booking_fee: 50, max_adults: 2, max_children: 0, max_total: 2, sort_order: 1 }], seasons: {}, occupancy: {} });
    return json({ ok: true, bookings: [], enquiries: [], properties: [], seasons: {}, occupancy: {}, content: {}, blocks: [], ranges: [], value: null, reviews: [], photos: [], threads: [] });
  });
  await payPage.goto(`${base}/index.html`, { waitUntil: 'networkidle' });

  // ---- §1  THE DEMOTED ASK PAINTS DEMOTED --------------------------------
  // `.pay-cta.is-quiet` (0,2,0) shipped against `#pay-btn.pay-cta` (1,1,0), so
  // the rule existed and LOST: an arranged balance painted the accent fill,
  // accent-ink text and the 18px rose glow — byte-identical to an unpaid ask.
  console.log('§1 The quiet button paints quiet — and the loud one still shouts');
  const readBtn = () => payPage.evaluate(() => {
    const btn = document.getElementById('pay-btn');
    // The pixel sample needs the control ON SCREEN — at 390 the button sits
    // below the fold, and a clip outside the viewport is not a measurement.
    btn.scrollIntoView({ block: 'center', behavior: 'instant' });
    const cs = getComputedStyle(btn);
    const probe = document.createElement('span');
    probe.style.backgroundColor = getComputedStyle(document.body).getPropertyValue('--accent').trim();
    document.body.appendChild(probe);
    const accent = getComputedStyle(probe).backgroundColor;
    probe.remove();
    const r = btn.getBoundingClientRect();
    return {
      quiet: btn.classList.contains('is-quiet'),
      bg: cs.backgroundColor,
      shadow: cs.boxShadow,
      label: (btn.textContent || '').trim(),
      accent,
      // The PAINT, sampled 6px in from the pill's left edge at its vertical
      // centre — where the fill runs to the very edge and no glyph can reach.
      // A proportional sample (width/6) lands on the LABEL when the label is
      // long, which read the accent-ink text instead of the fill and passed the
      // break-test for the wrong reason.
      box: { x: Math.round(r.left + 6), y: Math.round(r.top + r.height / 2) },
    };
  });
  const shot = async (box) => {
    // One pixel of the real composited page: the computed style of a
    // translucent control over glass is not what the guest sees.
    const buf = await payPage.screenshot({ clip: { x: box.x, y: box.y, width: 1, height: 1 } });
    // PNG of a 1×1 — decode via the browser rather than adding a dependency.
    return payPage.evaluate(async (b64) => {
      const img = new Image();
      img.src = 'data:image/png;base64,' + b64;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = 1; c.height = 1;
      c.getContext('2d').drawImage(img, 0, 0);
      const p = c.getContext('2d').getImageData(0, 0, 1, 1).data;
      return { r: p[0], g: p[1], b: p[2] };
    }, buf.toString('base64'));
  };

  await payPage.evaluate(() => openPayView('paytok', '30', 'balance'));
  await payPage.waitForFunction(() => document.getElementById('pay-body').style.display !== 'none', null, { timeout: 8000 });
  // STATE, NOT A CLOCK: the form's blocks cascade in on their own entrance, and
  // a pixel sampled mid-fade is the ground composited with a fading fill.
  await payPage.waitForFunction(() => document.getElementById('pay-btn').getAnimations().length === 0, null, { timeout: 8000 });
  const armed = await readBtn();
  const armedPaint = await shot(armed.box);
  ok(armed.quiet && /now instead/i.test(armed.label),
    `(fixture) the arranged balance really did demote its ask (${armed.label})`);
  ok(rgba(armed.bg) && rgba(armed.bg).a === 0,
    `an arranged balance's ask has NO fill (${armed.bg})`);
  ok(armed.shadow === 'none', `…and no glow under it (${armed.shadow})`);
  ok(!near(armedPaint, rgba(armed.accent), 12),
    `…and the pixel proves it: the button paints ${JSON.stringify(armedPaint)}, not the accent ${armed.accent}`);

  await payPage.evaluate(() => openPayView('paytok', '31', 'balance'));
  await payPage.waitForFunction(() => document.getElementById('pay-body').style.display !== 'none', null, { timeout: 8000 });
  // STATE, NOT A CLOCK: the form's blocks cascade in on their own entrance, and
  // a pixel sampled mid-fade is the ground composited with a fading fill.
  await payPage.waitForFunction(() => document.getElementById('pay-btn').getAnimations().length === 0, null, { timeout: 8000 });
  const loud = await readBtn();
  const loudPaint = await shot(loud.box);
  ok(!loud.quiet, '(fixture) the unpaid ask is NOT demoted');
  ok(near(rgba(loud.bg), rgba(loud.accent)),
    `…and an UNPAID ask is still the accent fill (${loud.bg})`);
  ok(near(loudPaint, rgba(loud.accent), 12),
    `…in paint as well as in declaration (${JSON.stringify(loudPaint)})`);
  ok(!near(loudPaint, armedPaint, 12),
    'the two states are told apart by looking at them, not only by reading the class');

  // ---- §2  ONE SPINNER, AND IT DOES NOT DIM ------------------------------
  // `#pay-btn.is-busy::after` (a leftover 13px trailing ring) beat the shimmer
  // sweep on animation while inheriting its `position:absolute; inset:0`, so the
  // button painted a SECOND ring half-clipped at its top-left corner and the
  // sweep never appeared at all.
  console.log('§2 One spinner while money moves — and no dimming');
  // (The button's own animations were waited out above — an opacity read taken
  // while payCasc is still running measures the entrance and calls a working
  // button dimmed: 0.99 on this check's first run.)
  const busy = await payPage.evaluate(() => {
    const btn = document.getElementById('pay-btn');
    btn.classList.add('is-busy');
    btn.disabled = true; // the data-act dispatcher's own guard, reproduced
    const before = getComputedStyle(btn, '::before');
    const after = getComputedStyle(btn, '::after');
    const out = {
      before: before.animationName,
      after: after.animationName,
      beforeContent: before.content,
      afterContent: after.content,
      opacity: getComputedStyle(btn).opacity,
    };
    btn.classList.remove('is-busy');
    btn.disabled = false;
    return out;
  });
  const painted = [busy.beforeContent, busy.afterContent].filter((c) => c && c !== 'none').length;
  const spinners = [busy.before, busy.after].filter((a) => /spin/i.test(a || '')).length;
  ok(painted === 2, `(vacuity) the busy button really paints two pseudo-elements (${painted})`);
  ok(spinners === 1, `EXACTLY ONE spinner, not two rings (::before ${busy.before} / ::after ${busy.after})`);
  ok(busy.before === 'paySpin', `…the ring is the one declared for this screen (${busy.before})`);
  ok(busy.after === 'paySweep', `…and the shimmer is behind it (${busy.after})`);
  ok(Number(busy.opacity) === 1, `busy is the spinner, not a dim (opacity ${busy.opacity})`);

  // ---- §3  THE RECEIPT IS SAID ONCE --------------------------------------
  // h1 "Pay for your stay" + h2 "Payment received" + a next-row labelled
  // "Payment received" + a toast saying it a fourth time, all on one screen.
  console.log('§3 The receipt is said once, and raises no toast');
  await payPage.evaluate(() => { document.querySelectorAll('#app-toasts .toast').forEach((t) => t.remove()); });
  await payPage.evaluate(() => document.getElementById('pay-btn').click());
  // STATE, never a clock: the success choreography is deliberately unhurried.
  await payPage.waitForFunction(() => document.getElementById('pay-done').style.display !== 'none', null, { timeout: 9000 });
  await payPage.waitForTimeout(500);
  const receipt = await payPage.evaluate(() => {
    const view = document.getElementById('view-pay');
    const txt = (view.innerText || '').replace(/\s+/g, ' ');
    return {
      says: (txt.match(/Payment received/g) || []).length,
      h1: (document.querySelector('#view-pay .pay-head h1') || {}).textContent || '',
      rows: document.querySelectorAll('#pay-done-next .pj-row').length,
      firstRow: ((document.querySelector('#pay-done-next .pj-row .pj-lbl') || {}).textContent || '').trim(),
      toasts: document.querySelectorAll('#app-toasts .toast').length,
    };
  });
  ok(receipt.rows >= 2, `(vacuity) the what-happens-next rows really rendered (${receipt.rows})`);
  ok(receipt.says === 1, `"Payment received" appears exactly ONCE on the screen (${receipt.says}×)`);
  ok(!/Payment received/.test(receipt.firstRow), `…and the first next-row states what happens NEXT (${receipt.firstRow})`);
  ok(receipt.h1 === 'Your payment', `…under a heading that is no longer an instruction (${receipt.h1})`);
  ok(receipt.toasts === 0, `…and no toast repeats it over the Messages pill (${receipt.toasts} toast(s))`);
  // Coming BACK to pay the rest restores the ask, both headings.
  await payPage.evaluate(() => openPayView('paytok', '31', 'balance'));
  await payPage.waitForFunction(() => document.getElementById('pay-body').style.display !== 'none', null, { timeout: 8000 });
  const backAgain = await payPage.evaluate(() => ({
    h1: (document.querySelector('#view-pay .pay-head h1') || {}).textContent || '',
    h2: (document.getElementById('pay-done-title') || {}).textContent || '',
  }));
  ok(backAgain.h1 === 'Pay for your stay' && backAgain.h2 === 'Payment received',
    `…and re-opening to pay the rest puts both headings back (${backAgain.h1})`);

  // ---- §6  THE REST OF THE SCREEN, MEASURED ------------------------------
  // Four things nothing read: a line that ended on its own separator, a padlock
  // detached from its sentence, a card whose accent rule floated in the padding,
  // and a money field with no money in it.
  console.log('§6 The stay line, the padlock, the band and the money field');
  // The money field only exists once the part row is open (the server sent
  // bounds for this booking, so the offer is really there).
  await payPage.evaluate(() => document.getElementById('pay-part-toggle').click());
  await payPage.waitForTimeout(300);
  const bits = await payPage.evaluate(() => {
    // EVERY GLYPH, GROUPED INTO PAINTED LINES. A separator must never be the
    // last thing on a line — that is what "Annex 27/08/2026 → 30/08/2026 ·"
    // flush against the column edge was.
    const lineEnds = (el) => {
      const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      const chars = [];
      let n;
      while ((n = w.nextNode())) {
        for (let i = 0; i < n.data.length; i++) {
          const rg = document.createRange();
          rg.setStart(n, i);
          rg.setEnd(n, i + 1);
          const b = rg.getBoundingClientRect();
          if (b.width || b.height) chars.push({ c: n.data[i], top: Math.round(b.top), right: b.right });
        }
      }
      const byLine = new Map();
      chars.forEach((ch) => {
        if (/^[\s ]$/.test(ch.c)) return;
        const cur = byLine.get(ch.top);
        if (!cur || ch.right > cur.right) byLine.set(ch.top, ch);
      });
      return [...byLine.values()].map((ch) => ch.c);
    };
    const prop = document.getElementById('pay-prop');
    // The padlock: its own vertical centre against the FIRST painted line of its
    // sentence. As a flex sibling it sat between two lines, 20px clear of the
    // first word.
    const sec = document.querySelector('#view-pay .pay-secure');
    const ic = sec.querySelector('.ic');
    const span = sec.querySelector('span');
    // The SPAN now holds the icon too, so its own first rect STARTS at the
    // glyph — measure the first TEXT node instead, which is the word the
    // padlock has to sit beside.
    const tw = document.createTreeWalker(span, NodeFilter.SHOW_TEXT);
    const firstText = tw.nextNode();
    const rg = document.createRange();
    rg.selectNodeContents(firstText);
    const firstLine = [...rg.getClientRects()][0] || span.getBoundingClientRect();
    const icBox = ic.getBoundingClientRect();
    // The band IS the card's top edge.
    const card = document.querySelector('#view-pay .pay-card');
    const band = document.getElementById('pay-stay-band');
    const cb = card.getBoundingClientRect();
    const bb = band.getBoundingClientRect();
    // The money field.
    const amt = document.getElementById('pay-part-amt');
    const sign = document.querySelector('.pay-money .pay-money-sign');
    return {
      ends: lineEnds(prop),
      iconInLine: icBox.top + icBox.height / 2 >= firstLine.top - 2 && icBox.top + icBox.height / 2 <= firstLine.bottom + 2,
      iconGap: Math.round(firstLine.left - icBox.right),
      bandShown: band.style.display !== 'none' && !!bb.height,
      bandTop: Math.round(bb.top - cb.top),
      bandBleed: Math.round(bb.width - cb.width),
      amtType: amt.getAttribute('type'),
      amtInput: amt.getAttribute('inputmode'),
      signOk: !!sign && sign.getBoundingClientRect().right <= amt.getBoundingClientRect().left + parseFloat(getComputedStyle(amt).paddingLeft) + 1,
      signTxt: sign ? sign.textContent : '',
      lbl: (document.getElementById('pay-part-lbl') || {}).textContent || '',
    };
  });
  ok(bits.ends.length >= 2, `(vacuity) the stay line really wraps at 390 (${bits.ends.length} painted lines)`);
  ok(!bits.ends.some((c) => c === '·' || c === '→'),
    `no line of the stay header ENDS on its own separator (line ends: ${bits.ends.join(' | ')})`);
  ok(bits.iconInLine, 'the padlock sits ON the first line of its sentence, not between two');
  ok(bits.iconGap >= -2 && bits.iconGap <= 10, `…and beside its first word rather than at the column edge (${bits.iconGap}px)`);
  // Within the card's own 1px hairline: the band reaches the padding box, so a
  // bordered card leaves exactly 1px of frame each side. What must never
  // return is the shipped 8px inset with its own 4px radius inside a 28px corner.
  ok(bits.bandShown && bits.bandTop <= 1 && Math.abs(bits.bandBleed) <= 2,
    `the cottage's rule IS the card's top edge (top +${bits.bandTop}px, width ${bits.bandBleed}px vs the card)`);
  ok(bits.amtType !== 'number' && bits.amtInput === 'decimal',
    `the money field is not a spin-button number input (type ${bits.amtType})`);
  ok(bits.signTxt === '£' && bits.signOk, 'the £ is IN the field, clear of the figure');
  ok(!/in pounds/i.test(bits.lbl), `…so the label no longer orphans "pounds?" onto its own line (${bits.lbl})`);

  // A TEXT FIELD ACCEPTS WHAT A NUMBER FIELD REFUSED, so the reader behind it has
  // to survive every way a person writes money. Driven through the REAL page's
  // payPartNum, not a copy — the whole point is that both callers share one reader.
  // "12,50" is the one that was silent (parseFloat gives 12, and £12 sits happily
  // inside the allowed range); "1,234.50" is the one a naive comma swap turns into
  // 1.23. A separator is decided by what FOLLOWS it, never by which character it is.
  const parsed = await payPage.evaluate(() =>
    ['12.50', '12,50', '1,234.50', '1.234,50', '1,234', '1,234,567.89', '12,5', '£45', '  90 ', '300', '0']
      .map((s) => [s, payPartNum(s)]));
  const want = { '12.50': 12.5, '12,50': 12.5, '1,234.50': 1234.5, '1.234,50': 1234.5, '1,234': 1234,
    '1,234,567.89': 1234567.89, '12,5': 12.5, '£45': 45, '  90 ': 90, '300': 300, '0': 0 };
  const wrong = parsed.filter(([s, v]) => v !== want[s]);
  ok(parsed.length === 11 && wrong.length === 0,
    `every way a person writes money reads as that amount (${wrong.length ? JSON.stringify(wrong) : '11/11'})`);
  // And nothing that is not a number may read as one: both callers gate on isFinite.
  const junk = await payPage.evaluate(() => ['', 'abc', '£'].map((s) => payPartNum(s)).filter((v) => isFinite(v)).length);
  ok(junk === 0, 'an empty or unparseable field stays NaN, never a silent zero');

  // The error panel: one family, one geometry. The action that recovers the
  // payment was 115×44 at 13px beside a 174×45 .btn-glass at 15px.
  await payPage.evaluate(() => showPayError('Something went wrong.', () => {}));
  await payPage.waitForTimeout(300);
  const errBtns = await payPage.evaluate(() => {
    const all = [...document.querySelectorAll('#pay-error button')].filter((b) => b.getClientRects().length);
    return all.map((b) => ({
      who: (b.textContent || '').trim(),
      h: Math.round(b.getBoundingClientRect().height),
      fs: parseFloat(getComputedStyle(b).fontSize),
    }));
  });
  ok(errBtns.length === 2, `(vacuity) both error controls are on screen (${errBtns.length})`);
  ok(errBtns[0].fs === errBtns[1].fs && Math.abs(errBtns[0].h - errBtns[1].h) <= 1,
    `the error panel's two buttons are ONE size (${errBtns.map((b) => `${b.who} ${b.h}px/${b.fs}px`).join(' · ')})`);
  ok(errBtns.every((b) => b.h >= 44), `…and both meet the phone floor (${errBtns.map((b) => b.h).join('/')})`);
  await payPage.close();

  // ============================================================
  //  MY STAYS (§4–§5)
  // ============================================================
  const guest = { id: 9, name: 'Priya Patel', email: 'guest@example.com' };
  const priced = { agreed_total: 400, agreed_per_night: 133.33, agreed_nights: 3, agreed_nightly: 400, agreed_txn_fee: 0, agreed_txn_pct: 0, agreed_booking_fee: 0 };
  const bookings = [Object.assign({
    id: 41, prop_key: 'jollyboat', check_in: d(10), check_out: d(13), adults: 2, children: 0,
    payment: 'deposit', deposit_paid: 100, pay_token: 'tok1', balance_due_by: d(3),
  }, priced)];
  const stays = await browser.newPage({ viewport: { width: 390, height: 900 } });
  stays.on('pageerror', (e) => { console.log('  PAGEERR:', e.message); fails++; });
  await stays.addInitScript(() => { if (navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(() => {}); });
  await stays.route(/\.php/, (route) => {
    const url = route.request().url();
    const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (url.includes('auth.php')) {
      let body = {};
      try { body = JSON.parse(route.request().postData() || '{}'); } catch (e) {}
      if (body.action === 'guest_status') return json({ ok: true, guest });
      return json({ ok: true, admin: false, guest: null });
    }
    if (url.includes('my-bookings.php')) return json({ ok: true, bookings, enquiries: [], completed_stays: 0 });
    if (url.includes('rates.php')) return json({ properties: [{ prop_key: 'jollyboat', name: 'Jollyboat', slug: 'jollyboat', couple_rate: 130, booking_fee: 50, max_adults: 2, max_children: 0, max_total: 2, sort_order: 1 }], seasons: {}, occupancy: {} });
    return json({ ok: true, bookings: [], enquiries: [], threads: [], reviews: [], photos: [], value: null, content: {} });
  });
  await stays.goto(`${base}/index.html`, { waitUntil: 'networkidle' });
  await stays.evaluate(() => openGuestArea());
  await stays.waitForTimeout(900);

  // ---- §4  ONE ASK, ONE COLOUR -------------------------------------------
  // The hub's CTA carried a 22% green fill with the booked-border; the card's —
  // the SAME "Pay balance £X", 1.2 screens below — carried an accent fill.
  // Green is the DONE state everywhere else on this page.
  console.log('§4 The hub\'s ask and the card\'s ask are one colour');
  const asks = await stays.evaluate(() => {
    const hub = document.querySelector('.my-stay-hub-soon .hub-cta-btn');
    const card = document.querySelector('#guest-bookings-list .gb2-cta .btn-sm');
    const probe = document.createElement('span');
    probe.style.backgroundColor = getComputedStyle(document.body).getPropertyValue('--accent').trim();
    document.body.appendChild(probe);
    const accent = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return {
      hub: hub ? getComputedStyle(hub).backgroundColor : null,
      card: card ? getComputedStyle(card).backgroundColor : null,
      hubTxt: hub ? (hub.textContent || '').replace(/\s+/g, ' ').trim() : '',
      cardTxt: card ? (card.textContent || '').replace(/\s+/g, ' ').trim() : '',
      accent,
    };
  });
  ok(!!asks.hub && !!asks.card, `(vacuity) both asks rendered (${asks.hubTxt} / ${asks.cardTxt})`);
  ok(near(rgba(asks.hub), rgba(asks.card)),
    `the hub's ask and the card's ask paint ONE colour (${asks.hub} vs ${asks.card})`);
  ok(near(rgba(asks.hub), rgba(asks.accent)),
    `…and it is the accent, not the done-state green (${asks.hub} vs ${asks.accent})`);

  // ---- §5  DESKTOP IS NOT A STRETCHED PHONE ------------------------------
  // At 1280 the hub ran the container's full 1160px: a timeline label at x87
  // with its figure at x913 — 826px of nothing between "Paid so far" and
  // "£100.00" — and a 1110px-wide "Book again".
  console.log('§5 At 1280 a label and its figure are not a page apart');
  await stays.setViewportSize({ width: 1280, height: 900 });
  await stays.waitForTimeout(400);
  const measureWide = () => stays.evaluate(() => {
    // THE INK, NOT THE BOX. `.gtj-l` is a block inside the row's flex column, so
    // its BOX already stretches to the figure's edge whatever the width — a
    // box-based gap read 11px at 1280 with the column cap deleted, i.e. it could
    // not see the defect at all. A Range over the label's own text gives what is
    // actually painted (the same lesson the cottage-card sweep learned).
    const inkRight = (el) => {
      const rg = document.createRange();
      rg.selectNodeContents(el);
      const r = rg.getBoundingClientRect();
      return r.width ? r.right : el.getBoundingClientRect().right;
    };
    const gaps = [];
    document.querySelectorAll('#guest-bookings-list .gtj').forEach((row) => {
      const l = row.querySelector('.gtj-l');
      const f = row.querySelector('.gtj-f');
      if (!l || !f || !f.getClientRects().length) return;
      gaps.push({ who: (l.textContent || '').trim().slice(0, 24), gap: Math.round(f.getBoundingClientRect().left - inkRight(l)) });
    });
    // The .gb2-payline is deliberately label-left / figure-right across its own
    // row, so its gap is the row's width by design — it rides the WIDTH sweep
    // below instead, which is the property that actually went wrong there.
    const widest = [...document.querySelectorAll('#guest-bookings-list button, #guest-bookings-list a.btn-glass, #guest-bookings-list .gb2-again')]
      .filter((e) => e.getClientRects().length)
      .map((e) => ({ w: Math.round(e.getBoundingClientRect().width), who: (e.textContent || '').trim().slice(0, 24) }))
      .sort((a, b) => b.w - a.w)[0] || { w: 0, who: '(none)' };
    return { gaps, widest, listW: Math.round((document.getElementById('guest-bookings-list') || { getBoundingClientRect: () => ({ width: 0 }) }).getBoundingClientRect().width) };
  });
  const wide = await measureWide();
  // SELF-CALIBRATING, not a pinned number (the ui-test-legibility §3 pattern).
  // A right-hand figure rail is the house anatomy — the owner's own booking hub
  // pairs a short label with a right-aligned figure on a 760px column — so an
  // absolute "≤ 400px" would fail correct design. What must hold is that the
  // cap has an EFFECT: measure the same rows with it lifted and require the
  // capped gap to be materially smaller.
  await stays.addStyleTag({ content: '#guest-bookings-list{max-width:none !important}' });
  await stays.waitForTimeout(250);
  const uncapped = await measureWide();
  ok(wide.gaps.length >= 2, `(vacuity) ${wide.gaps.length} label→figure pairs measured`);
  const worstOf = (g) => g.slice().sort((a, b) => b.gap - a.gap)[0];
  const worst = worstOf(wide.gaps);
  const worstOff = worstOf(uncapped.gaps);
  ok(worst.gap < worstOff.gap - 150,
    `a label and its figure are a COLUMN apart, not a page (worst "${worst.who}" ${worst.gap}px; ${worstOff.gap}px with the cap lifted)`);
  ok(wide.listW > 0 && wide.listW <= 780, `the stay column is a column, not the whole page (${wide.listW}px)`);
  ok(wide.widest.w <= 780, `and no control stretches across it ("${wide.widest.who}" ${wide.widest.w}px)`);
  ok(uncapped.listW > 900, `(vacuity) lifting the cap really did widen the list (${uncapped.listW}px)`);
  await stays.close();

  console.log(fails ? `\n${fails} check(s) failed` : '\nAll checks passed');
  await harnessDone(fails);
})();
