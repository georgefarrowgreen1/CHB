// THE TERMS STATE THE NUMBERS THE SERVER ENFORCES, driven in a real browser.
//
// Clause 1's money definitions and the whole of clause 5 used to be prose —
// "25%", "4 weeks", "typically £75" — none of which the app derived from. Two
// were already wrong: the window is PAYMENT_BALANCE_DAYS (30 days, not 28), so a
// booking made 29 days out was promised a deposit by the terms and asked to pay
// in full by pricing.php, and payments-due.php chases the balance 30 days out.
//
// The whole suite therefore serves a payment schedule that is NOT the default
// (30% / 45 days) and a cottage deposit that is NOT £75. Every assertion below
// fails against the old prose, which is what makes it a gate rather than a
// restatement — reverting any of the three literals reproduces the bug.
const { bootBrowser } = require('./ui-test-lib'); // pins TZ=Europe/London at require time
let fails = 0;
const ok = (b, m) => { console.log(`  ${b ? '✓' : '✗'} ${m}`); if (!b) fails++; };

const prop = (key, name, fee) => ({
  prop_key: key, name, slug: key, couple_rate: 130, extra_adult_rate: 45, child_rate: 30,
  booking_fee: fee, transaction_pct: 0, weekend_pct: 0, weekend_days: '5,6',
  lastmin_pct: 0, lastmin_days: 0, max_adults: 4, max_children: 2, max_total: 4, sort_order: 1,
  address: '1 Test Lane, Blakeney',
});

// One page per server shape. `payment` absent models an older deploy — the client
// must keep its own defaults rather than quoting a 0% deposit at the guest.
async function openSite(browser, base, { payment, fee = 60, content = {} }) {
  const page = await browser.newPage({ viewport: { width: 900, height: 1100 } });
  page.on('pageerror', (e) => { console.log('  PAGEERR:', e.message); fails++; });
  await page.addInitScript(() => { if (navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(() => {}); });
  await page.route(/\.php/, (route) => {
    const url = route.request().url();
    const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (route.request().method() === 'POST') return json({ ok: true });
    const rates = { properties: [prop('jollyboat', 'Jollyboat', fee)], seasons: {}, occupancy: {} };
    if (payment) rates.payment = payment;
    // bootstrap.php is the real boot path (rates + content in one payload); each
    // part is the same shape its own endpoint serves, so serve it that way or the
    // content loader silently reads an empty map.
    if (url.includes('bootstrap.php'))
      return json({ ok: true, rates, content: { content }, reviews: { reviews: [] }, square: { enabled: false } });
    if (url.includes('rates.php')) return json(rates);
    if (url.includes('content.php')) return json({ content });
    return json({ ok: true, bookings: [], enquiries: [], reviews: [], photos: [], props: {}, events: [], ranges: [], value: null, content });
  });
  await page.goto(`${base}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1300);
  return page;
}

// The guest's real route to the terms: the link inside the enquiry form's
// acceptance line, on the cottage page they are about to book.
async function termsText(page) {
  await page.evaluate(() => { openProperty('jollyboat'); });
  await page.waitForTimeout(400);
  // Clicked through the real data-act dispatcher (the link lives inside the
  // enquiry form, which may be off screen here — a JS click still exercises the
  // handler, so removing the link or the handler still fails this).
  await page.evaluate(() => {
    const a = document.querySelector('label:has(#enq-terms) a[data-act="openTerms"]');
    if (!a) throw new Error('no terms link beside the acceptance box');
    a.click();
  });
  await page.waitForTimeout(300);
  return page.evaluate(() => {
    const m = document.getElementById('terms-modal');
    return {
      open: !!m && m.classList.contains('open'),
      text: (document.getElementById('terms-modal-body') || {}).innerText || '',
    };
  });
}
// One clause's paragraphs, so an assertion about clause 5 cannot pass on text
// that happens to sit in clause 1.
const clause = (text, n) => {
  const parts = text.split(/^(?=\d+\.\s)/m);
  return parts.find((p) => p.trim().startsWith(n + '.')) || '';
};

(async () => {
  const { browser, base, done } = await bootBrowser();

  console.log('1. the payment schedule in the terms is the SERVER\'S, not prose');
  const page = await openSite(browser, base, { payment: { deposit_pct: 30, balance_days: 45 } });
  const t = await termsText(page);
  ok(t.open, 'the acceptance line\'s link opens the terms');
  const defs = clause(t.text, 1);
  const pay = clause(t.text, 5);
  ok(/Deposit:\s*30% of the Price/.test(defs), `the Deposit definition quotes the live percentage (${(defs.match(/Deposit: [^\n]*/) || [''])[0]})`);
  ok(/Balance due date:\s*45 days before your arrival date/.test(defs),
    `the balance due date is the window the server enforces (${(defs.match(/Balance due date: [^\n]*/) || [''])[0]})`);
  ok(/45 days or more before your arrival date: pay the 30% deposit/.test(pay),
    'clause 5 states the same window and percentage as the definitions');
  ok(/less than 45 days before your arrival date: pay in full/.test(pay),
    '…and the pay-in-full side of the same boundary');

  console.log('2. and the OLD prose is gone — the exact numbers that were wrong');
  // "4 weeks" was 28 days against a 30-day window; the percentage and the £75
  // were both hardcoded. None may reappear anywhere in the document.
  ok(!/4 weeks|four weeks/i.test(t.text), 'no "4 weeks" anywhere in the terms');
  ok(!/25%/.test(t.text), 'no hardcoded 25% (this server says 30%)');
  ok(!/£75/.test(t.text), 'no hardcoded £75 (this cottage\'s deposit is £60)');

  console.log('3. the security deposit is THIS cottage\'s figure');
  ok(/Security deposit:\s*a refundable £60\.00 charged together with your first payment/.test(defs),
    `the definition names the cottage's own deposit (${(defs.match(/Security deposit: [^\n]*/) || [''])[0]})`);

  console.log('4. a cottage with NO deposit promises no figure');
  // The generic sentence, not "a refundable £0.00" — which would read as a term
  // of the contract rather than the absence of one.
  const zero = await openSite(browser, base, { payment: { deposit_pct: 30, balance_days: 45 }, fee: 0 });
  const zt = await termsText(zero);
  const zdefs = clause(zt.text, 1);
  ok(/Security deposit:\s*a refundable amount, shown with your price before you book,/.test(zdefs),
    `no deposit set → no figure invented (${(zdefs.match(/Security deposit: [^\n]*/) || [''])[0]})`);
  ok(!/£0\.00/.test(zdefs), '…and it never prints £0.00 as the deposit');

  console.log('5. an older server (no payment block) keeps the honest defaults');
  // The failure to guard against: reading an absent payload as zero and telling
  // the guest their deposit is 0% of the price.
  const old = await openSite(browser, base, { payment: null });
  const ot = await termsText(old);
  const odefs = clause(ot.text, 1);
  ok(/Deposit:\s*25% of the Price/.test(odefs), `falls back to the server default, 25% (${(odefs.match(/Deposit: [^\n]*/) || [''])[0]})`);
  ok(/Balance due date:\s*30 days before/.test(odefs), '…and to the 30-day window pricing.php defaults to');
  ok(!/\b0%|NaN|undefined/.test(ot.text), 'never 0%, NaN or undefined');

  console.log('6. the Limited policy publishes the window it actually enforces');
  // rentalRefundBlocked() refuses a rental refund inside 7 days under Limited,
  // and the published policy used to stop at "7–14 days" — so a guest cancelling
  // 3 days out got nothing back, having read a policy that never said so.
  const lim = await openSite(browser, base, {
    payment: { deposit_pct: 30, balance_days: 45 },
    content: { 'jollyboat-cancellation-policy': 'limited' },
  });
  const lt = await termsText(lim);
  ok(/no refund within 7 days of check-in/i.test(clause(lt.text, 7)),
    'clause 7 names the no-refund window');
  const onPage = await lim.evaluate(() => (document.getElementById('prop-cancellation') || {}).innerText || '');
  ok(/no refund within 7 days of check-in/i.test(onPage),
    `…and the cottage page says the same (${onPage.slice(0, 90)})`);
  // The one the code enforces and the one it publishes must be the same number.
  const blocked = await lim.evaluate(() => {
    const d = (n) => { const x = new Date(); x.setDate(x.getDate() + n); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
    return {
      inside: rentalRefundBlocked('jollyboat', { checkIn: d(3) }),
      outside: rentalRefundBlocked('jollyboat', { checkIn: d(10) }),
    };
  });
  ok(blocked.inside === true, 'a cancellation 3 days out really is refused');
  ok(blocked.outside === false, '…and one 10 days out is not, as the policy says');

  console.log('7. the chat\'s check-in answer quotes the cottage\'s OWN times');
  // The cottage page's house rules already derived from rules-<prop>; this FAQ
  // answer did not, so an owner who moved check-in to 4pm updated one surface and
  // left the chat's built-in answer saying 3pm. Served here as 16:00/09:30, so
  // the old static "3pm … 10am" string cannot pass.
  const times = await openSite(browser, base, {
    payment: { deposit_pct: 30, balance_days: 45 },
    content: { 'rules-jollyboat': { checkInTime: '16:00', checkOutTime: '09:30' } },
  });
  await times.evaluate(() => { openProperty('jollyboat'); });
  await times.waitForTimeout(300);
  const faq = await times.evaluate(() => ({
    answer: chatFaqAnswer(CHAT_FAQ.checkin),
    // …and the on-device matcher must quote the same words, not the static copy.
    matched: (guestFaqAnswer('what time is check-in?') || {}).a || '',
  }));
  ok(/from 4pm/.test(faq.answer), `it names the cottage's check-in (${faq.answer.slice(0, 54)})`);
  ok(/by 9\.30am/.test(faq.answer), '…and its check-out, minutes and all');
  ok(!/3pm|10am/.test(faq.answer), 'the static 3pm/10am copy is not what a guest is told');
  ok(faq.matched === faq.answer, 'the typed-question matcher quotes the SAME answer');

  console.log('8. an owner\'s own saved answer still wins');
  // Deriving must not override a deliberate edit — the owner's text is the one
  // place a cottage-specific arrangement can be explained.
  const saved = await openSite(browser, base, {
    payment: { deposit_pct: 30, balance_days: 45 },
    content: {
      'rules-jollyboat': { checkInTime: '16:00', checkOutTime: '09:30' },
      'chat-ans-checkin': 'Ring us when you set off and we will meet you there.',
    },
  });
  await saved.evaluate(() => { openProperty('jollyboat'); });
  await saved.waitForTimeout(300);
  const own = await saved.evaluate(() => chatFaqAnswer(CHAT_FAQ.checkin));
  ok(/Ring us when you set off/.test(own), `the saved answer is served verbatim (${own.slice(0, 40)})`);

  console.log('9. the automatic-payments facility is DISCLOSED, with the collector\'s own numbers');
  // A continuous payment authority belongs in the contract document, not only
  // in the checkout consent that grants it. NON-DEFAULT numbers (5 days / 3
  // instalments) so the shipped constants can't pass as prose; the clause must
  // state optionality, the notice, the off-switch, and that the due date is
  // unmoved.
  const apOn = await openSite(browser, base, {
    payment: { deposit_pct: 30, balance_days: 45, autopay: { enabled: true, notice_days: 5, max_instalments: 3 } },
  });
  const apT = await termsText(apOn);
  const apPay = clause(apT.text, 5);
  ok(/up to 3 monthly instalments ending on it/.test(apPay), `the clause quotes the server's instalment cap (${(apPay.match(/up to \d+ [^.]*/) || [''])[0]})`);
  ok(/at least 5 days before each collection/.test(apPay), '…and the server\'s notice window');
  ok(/This is optional/.test(apPay) && /turn it off at any time from your booking page/.test(apPay),
    '…states optionality and the off-switch');
  ok(/doesn’t change when the balance is due/.test(apPay), '…and that choosing it never moves the due date');

  console.log('10. …and is NOT promised when the server doesn\'t offer it');
  // Both silence shapes: card payments off (enabled false), and an older server
  // whose payment block predates the field entirely.
  const apOff = await openSite(browser, base, {
    payment: { deposit_pct: 30, balance_days: 45, autopay: { enabled: false, notice_days: 3, max_instalments: 4 } },
  });
  ok(!/collected automatically/.test(clause((await termsText(apOff)).text, 5)),
    'card payments off → no automatic-collection sentence');
  const apOld = await openSite(browser, base, { payment: { deposit_pct: 30, balance_days: 45 } });
  ok(!/collected automatically/.test(clause((await termsText(apOld)).text, 5)),
    'an older server (no autopay field) promises nothing');

  // ── THE TERMS MUST BE READABLE FROM THE FORM THAT ASKS FOR THEM ────────────
  // Both #terms-modal and #enquire-modal are .modal-overlay, so both sat at
  // z-index 2000 — and the enquiry modal is appended to the END of <body> on
  // boot (its overlay is fixed and a transformed .page-view ancestor would trap
  // it), so it won the DOM-order tie and painted OVER the terms. The one
  // document the guest is legally asked to accept was unreadable at the moment
  // of accepting it. Every check above opens the terms with NO enquiry modal up,
  // which is why the suite passed with this live: the state has to be the real
  // one. Hit-tested at the viewport centre, because a z-index comparison would
  // not notice a third overlay arriving between them.
  console.log('\n8. the terms are readable from the enquiry form');
  const layered = await openSite(browser, base, {});
  await layered.evaluate(() => { openProperty('jollyboat'); });
  await layered.waitForTimeout(400);
  await layered.evaluate(() => { openEnquireModal(); });
  await layered.waitForTimeout(400);
  const bothOpen = await layered.evaluate(() => ({
    enq: !!document.getElementById('enquire-modal').classList.contains('open'),
  }));
  ok(bothOpen.enq, 'the enquiry modal is up (the state a guest is actually in)');
  await layered.evaluate(() => {
    const a = document.querySelector('label:has(#enq-terms) a[data-act="openTerms"]');
    if (!a) throw new Error('no terms link beside the acceptance box');
    /** @type {HTMLElement} */ (a).click();
  });
  await layered.waitForTimeout(400);
  const top = await layered.evaluate(() => {
    const el = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2);
    const owner = (node, id) => { for (let n = node; n; n = n.parentElement) if (n.id === id) return true; return false; };
    return {
      inTerms: owner(el, 'terms-modal'),
      inEnq: owner(el, 'enquire-modal'),
      tag: el ? el.tagName + (el.className ? '.' + String(el.className).split(' ')[0] : '') : 'none',
      readable: (document.getElementById('terms-modal-body') || { innerText: '' }).innerText.length > 200,
    };
  });
  ok(top.inTerms && !top.inEnq,
    `the terms document is what the guest touches, not the form behind it (topmost: ${top.tag})`);
  ok(top.readable, '…and its text is actually rendered');

  // ---- "READ ALL REVIEWS" IS ON EVERY COTTAGE PAGE THAT HAS REVIEWS ----------
  // Reported: the button showed on 21A (16 reviews) and on no other cottage. Two
  // causes, and NO suite covered cottage-page reviews at all, which is how both
  // shipped. renderPropReviews is driven directly per scenario: the button used to
  // need count > 4, and a review saved with no cottage matches no page.
  const rev = await page.evaluate(() => {
    const mk = (n, prop) =>
      Array.from({ length: n }, (_, i) => ({
        name: 'Guest ' + (i + 1), stars: 5, text: 'A lovely stay, number ' + (i + 1), prop, source: 'Airbnb',
      }));
    const read = () => {
      const wrap = document.getElementById('prop-reviews');
      const btn = wrap
        ? [...wrap.querySelectorAll('button')].find((b) => /Read all/i.test(b.textContent))
        : null;
      return {
        shown: wrap ? getComputedStyle(wrap).display !== 'none' : false,
        cards: wrap ? wrap.querySelectorAll('.review-card').length : 0,
        count: wrap && wrap.querySelector('.prop-reviews-count')
          ? wrap.querySelector('.prop-reviews-count').textContent : '',
        btn: btn ? btn.textContent.trim() : '',
      };
    };
    const run = (list) => { siteContent.reviews = list; renderPropReviews('jollyboat'); return read(); };
    return {
      many: run(mk(16, 'jollyboat')),
      four: run(mk(4, 'jollyboat')),
      two: run(mk(2, 'jollyboat')),
      one: run(mk(1, 'jollyboat')),
      // The count and average must come from THIS cottage's reviews only — an
      // unassigned review silently deflated both (6 + 2 rendered as "2 reviews").
      mixed: run(mk(6, '').concat(mk(2, 'jollyboat'))),
    };
  });
  ok(/Read all 16 reviews/.test(rev.many.btn), `16 reviews: the button is there ("${rev.many.btn}")`);
  ok(/Read all 4 reviews/.test(rev.four.btn), `4 reviews: the button is there too ("${rev.four.btn}")`);
  ok(/Read all 2 reviews/.test(rev.two.btn), `2 reviews: still there ("${rev.two.btn}")`);
  ok(rev.one.shown && rev.one.btn === '', 'one review: the card shows and no button claims there is more');
  ok(rev.mixed.count === '2 reviews', `unassigned reviews never inflate a cottage's count ("${rev.mixed.count}")`);

  // Fix 1's owner-side half: the option now states the CONSEQUENCE of leaving it
  // blank, and saveReviews asks before stranding any. Source-scanned, because both
  // live in the admin bundle behind a confirm.
  const adminSrc = require('fs').readFileSync(__dirname + '/admin.js', 'utf8');
  ok(/no cottage \\u2014 not shown on any cottage page|no cottage — not shown on any cottage page/.test(adminSrc),
    'the "(no cottage)" option says what choosing it costs');
  ok(/const stranded = reviews\.filter\(\(r\) => !r\.prop\)\.length;/.test(adminSrc),
    'saveReviews counts the reviews left with no cottage');
  ok(/if \(stranded\) \{[\s\S]{0,400}glassConfirm\(/.test(adminSrc),
    '…and asks before saving them that way');

  // ── THE RESCUE EMAIL'S PROMISE IS KEPT ────────────────────────────────────
  // enquireDraftSave wrote chb-enq-draft since it shipped and NOTHING read it
  // back, while the abandoned-enquiry email told the guest their details were
  // saved. They tapped through to a blank form — an email WE sent, so it read as
  // the site losing their work. Drive the real round trip.
  const draft = await page.evaluate(async () => {
    const k = Object.keys(propertyMeta)[0];
    openProperty(k);
    await new Promise((r) => setTimeout(r, 400));
    openEnquireModal();
    await new Promise((r) => setTimeout(r, 400));
    const set = (id, v) => { const e = document.getElementById(id); if (e) { e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); } };
    set('enq-name', 'Priya Patel');
    set('enq-email', 'priya@example.com');
    set('enq-message', 'Any chance of a late checkout?');
    enquireDraftSave();
    const stored = !!localStorage.getItem('chb-enq-draft');
    // Leave and come back, exactly as the emailed link does.
    closeEnquireModal();
    ['enq-name', 'enq-email', 'enq-message'].forEach((id) => { const e = document.getElementById(id); if (e) e.value = ''; });
    openEnquireModal();
    await new Promise((r) => setTimeout(r, 400));
    const g = (id) => (document.getElementById(id) || {}).value || '';
    const wb = document.getElementById('enq-wb');
    return { stored, name: g('enq-name'), email: g('enq-email'), msg: g('enq-message'),
      note: wb && wb.getClientRects().length ? (wb.textContent || '') : '' };
  });
  ok(draft.stored, '(fixture) the draft is written');
  ok(draft.name === 'Priya Patel' && draft.email === 'priya@example.com' && /late checkout/.test(draft.msg),
    `coming back restores what was typed (${draft.name} / ${draft.email})`);
  // …and SAYS so, or a stranger meets a form full of details they don't remember
  // giving. This slot is shared with the welcome-back line, which runs after the
  // restore and used to blank it.
  ok(/Picked up where you left off/.test(draft.note), `…and says why the form is already full (${draft.note.slice(0, 60)})`);
  // The email must not out-live the feature again: pair the claim with the code.
  // NB comment lines are stripped first — a // -commented call still matches the
  // plain regex, so the unstripped version passed with the call disabled.
  const appSrcD = require('fs')
    .readFileSync(__dirname + '/app.js', 'utf8')
    .split('\n')
    .filter((l) => !/^\s*\/\//.test(l))
    .join('\n');
  const mailSrcD = require('fs').readFileSync(__dirname + '/mailer.php', 'utf8');
  // The CALL must be a statement of its own — `enquireDraftRestore(key)` also
  // appears in the function's own signature, so the loose form passed with the
  // call deleted.
  ok(/function enquireDraftRestore\(/.test(appSrcD) && /^\s*enquireDraftRestore\(key\);\s*$/m.test(appSrcD),
    'the restore exists AND is called from the modal opener');
  ok(!/saved in the form on this device/.test(mailSrcD),
    'the rescue email no longer claims more than a different device can keep');

  console.log(fails ? `\n  TERMS SUITE FAILED ❌ (${fails})` : '\n  TERMS SUITE PASSED ✅');
  await done(fails);
})();
