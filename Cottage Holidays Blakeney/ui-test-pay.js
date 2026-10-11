// ============================================================
//  ui-test-pay.js — the guest pay screen (the approved pay-screens demo),
//  end to end in a real browser with Square and pay.php stubbed.
//
//   §1  a deposit ask: the stay, ONE figure, the breakdown a tap away and
//       adding up to it, the Deposit | Whole stay switch, the money story
//       whose "Today" stop IS the figure, the plan as a decision
//   §2  the whole stay: its own summary, its own quote, its own figure; the
//       button waits rather than charge without one
//   §3  the plan: consent per choice, an automatic plan stands the wallets
//       down WITH the reason, and the wallet belt refuses before tokenize
//   §4  paying by card: 3-D Secure verifies the figure being charged, the
//       narrated wait, the receipt says what was paid and what comes next
//   §5  a refusal sits ON the card; a field mistake is said once (Square's)
//   §6  the connection dropped: no Pay button, only "Check whether it went
//       through", which answers both ways
//   §7  an arranged plan, the card form on its own, and a plan in trouble
//   §8  the calm screens: the legacy hold, nothing to pay, an expired link,
//       payments off, a server error that retries
//   §9  a deposit-only payment is called that, never "balance"
//   §10 an earlier open's slow answer never paints over a newer one
//   §11 the paint: one primary, a quiet second choice, one spinner, a sticky
//       bar on a phone, two columns on a computer, nothing wider than the page
// ============================================================
const { bootBrowser, d } = require('./ui-test-lib'); // pins TZ=Europe/London at require time
let fails = 0;
const ok = (b, m) => {
  console.log(`  ${b ? '✓' : '✗'} ${m}`);
  if (!b) fails++;
};
const gbpJS = (n) => '£' + Number(n).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money = (t) => Number(String(t).replace(/[^0-9.]/g, '') || 0);

// ---- fixtures: one stay, the states a guest meets ----
const stay = { ok: true, propName: 'Jollyboat', propKey: 'jollyboat', guestName: 'Debbie McGoldrick', checkIn: d(130), checkOut: d(133), currency: 'GBP', adults: 2, children: 0, emailHint: 'd•••@example.com', arrivalOn: d(127), hasEmail: true };
const due = d(100);
const SUM = {
  '8:deposit': { ...stay, kind: 'deposit', total: 700, alreadyPaid: 0, balance: 700, depositPct: 25, amountDue: 175, damagesDue: 50, holdAmount: 50, holdStatus: 'none', balanceDueDate: due, quote: '8:deposit:225.00:q', autopayTerms: { amount: 525, due }, autopayState: 'off', instalmentOffer: { n: 3, per: 175, last: 175, due, dates: [d(40), d(70), due] }, paidOn: null },
  '8:balance': { ...stay, kind: 'balance', total: 700, alreadyPaid: 0, balance: 700, depositPct: 25, amountDue: 700, damagesDue: 50, holdAmount: 50, holdStatus: 'none', balanceDueDate: due, quote: '8:balance:750.00:q', autopayTerms: null, autopayState: 'off', paidOn: null },
  '9:balance': { ...stay, kind: 'balance', total: 700, alreadyPaid: 175, balance: 525, depositPct: 25, amountDue: 525, damagesDue: 0, depositCharged: 50, holdAmount: 50, holdStatus: 'charged', balanceDueDate: due, quote: '9:balance:525.00:q', autopayTerms: null, autopayState: 'off', paidOn: d(-1) },
  '14:balance': { ...stay, kind: 'balance', total: 700, alreadyPaid: 350, balance: 350, depositPct: 25, amountDue: 350, damagesDue: 0, depositCharged: 50, holdAmount: 50, holdStatus: 'charged', balanceDueDate: due, quote: '14:balance:350.00:q', autopayTerms: null, autopayState: 'armed', paidOn: d(-40),
    autopayPlan: { n: 3, per: 175, toGo: 2, next: d(30), state: 'on', dates: [{ date: d(-1), state: 'done', fig: 175 }, { date: d(30), state: 'next', fig: 175 }, { date: due, state: 'todo', fig: 175 }] } },
  '13:balance': { ...stay, kind: 'balance', total: 700, alreadyPaid: 350, balance: 350, depositPct: 25, amountDue: 350, damagesDue: 0, depositCharged: 50, holdAmount: 50, holdStatus: 'charged', balanceDueDate: due, quote: '13:balance:350.00:q', autopayTerms: null, autopayState: 'armed', paidOn: d(-40),
    autopayRepair: { stopped: false, why: 'The card was declined.', monthly: true, retry: d(3) },
    autopayPlan: { n: 3, per: 175, toGo: 2, next: d(2), state: 'retrying', retry: d(3), dates: [{ date: d(-28), state: 'done', fig: 175 }, { date: d(2), state: 'next', fig: 175 }, { date: due, state: 'todo', fig: 175 }] } },
  '16:hold': { ...stay, kind: 'hold', total: 700, alreadyPaid: 700, balance: 0, amountDue: 50, damagesDue: 0, holdAmount: 50, holdStatus: 'requested', quote: '16:hold:50.00:q', paidOn: d(-5) },
  '17:balance': { ...stay, kind: 'balance', total: 700, alreadyPaid: 700, balance: 0, amountDue: 0, damagesDue: 0, depositCharged: 50, holdAmount: 50, holdStatus: 'charged', balanceDueDate: due, quote: '17:balance:0.00:q', paidOn: d(-5) },
  '18:balance': { ...stay, kind: 'balance', total: 700, alreadyPaid: 700, balance: 0, amountDue: 0, damagesDue: 75, holdAmount: 0, holdStatus: 'none', balanceDueDate: due, quote: '18:balance:75.00:q', paidOn: d(-5) },
};

(async () => {
  const { browser, base, done } = await bootBrowser();

  // One page per scene. `o.charge` decides what pay.php's charge answers; the
  // rest of the knobs hold an answer back or change one fixture.
  const scene = async (id, kind, o) => {
    o = o || {};
    const page = await browser.newPage({ viewport: o.viewport || { width: 390, height: 844 } });
    page.on('pageerror', (e) => { console.log('  PAGEERR:', e.message); fails++; });
    await page.addInitScript((w) => {
      if (navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(() => {});
      window.__tok = [];
      window.__wtok = 0;
      window.Square = {
        payments: () => ({
          card: async () => ({
            attach: async (sel) => { const el = document.querySelector(sel); if (el) el.innerHTML = '<div class="sq-stub" style="height:48px">Card number</div>'; },
            tokenize: async (v) => { window.__tok.push(v || null); return window.__tokResult || { status: 'OK', token: 'tok_card' }; },
            destroy: async () => {},
            addEventListener: () => {},
          }),
          paymentRequest: () => { if (!w) throw new Error('no wallets here'); return {}; },
          googlePay: async () => ({
            attach: async (sel) => { const el = document.querySelector(sel); if (el) el.innerHTML = '<div style="height:48px;background:#000;color:#fff">G Pay</div>'; },
            tokenize: async () => { window.__wtok++; return { status: 'OK', token: 'tok_wallet' }; },
          }),
          applePay: async () => { throw new Error('not Safari'); },
        }),
      };
    }, !!o.wallets);
    const posts = [];
    let summaryCalls = 0;
    await page.route(/\.php/, async (route) => {
      const url = route.request().url();
      const json = (b, s) => route.fulfill({ status: s || 200, contentType: 'application/json', body: JSON.stringify(b) });
      if (route.request().method() === 'POST') {
        const b = JSON.parse(route.request().postData() || '{}');
        const file = url.split('/').pop().split('?')[0];
        if (file === 'pay.php') posts.push(b);
        if (file === 'pay.php' && b.action === 'summary') {
          summaryCalls++;
          if (o.summary) return o.summary(b, json, summaryCalls, route);
          if (b.booking_id === '403') return json({ error: 'This payment link is invalid or has expired.' }, 403);
          if (b.booking_id === '503') return json({ error: 'Card payments are switched off.' }, 503);
          const s = SUM[b.booking_id + ':' + (b.kind || 'balance')] || SUM[b.booking_id + ':balance'] || SUM[b.booking_id + ':deposit'];
          if (o.slowAll && b.kind === 'balance' && b.booking_id === '8') await new Promise((r) => setTimeout(r, o.slowAll));
          return json(s);
        }
        if (file === 'pay.php' && b.action === 'charge') {
          if (o.charge === 'hang') return;
          if (o.charge === 'drop') return route.abort('connectionreset');
          if (o.charge === 'decline') return json({ error: 'The card was declined.', code: 'declined' }, 402);
          if (o.charge === 'changed') return json({ error: 'The amount changed while you were paying. Nothing has been charged.', code: 'amount_changed' }, 409);
          if (o.chargeDelay) await new Promise((r) => setTimeout(r, o.chargeDelay));
          if (b.kind === 'balance') return json({ ok: true, fullyPaid: true, charged: b.booking_id === '8' ? 750 : 525, remaining: 0, card: { brand: 'Visa', last4: '4242' } });
          return json({ ok: true, fullyPaid: false, charged: 225, remaining: 0, card: { brand: 'Visa', last4: '4242' },
            autopay: b.autopay ? (b.autopay_instalments > 1 ? { ok: true, monthly: true, n: 3, per: 175, next: d(40), due } : { ok: true, monthly: false, n: 1, per: 525, next: null, due }) : null });
        }
        if (file === 'pay.php' && b.action === 'authorize') return json({ ok: true });
        if (file === 'pay.php' && b.action === 'update_card') return json({ ok: true, say: 'The plan carries on, and nothing was charged today.', autopayState: 'armed' });
        if (file === 'pay.php' && b.action === 'autopay_off') return json({ ok: true });
        return json({ ok: true });
      }
      if (url.includes('square-config.php')) return json({ enabled: true, applicationId: 'app', locationId: 'loc', environment: o.sandbox ? 'sandbox' : 'production' });
      if (url.includes('rates.php')) return json({ properties: [{ prop_key: 'jollyboat', name: 'Jollyboat', slug: 'jollyboat', couple_rate: 233.33, booking_fee: 50, max_adults: 4, max_children: 2, max_total: 6, sort_order: 1 }], seasons: {}, occupancy: {} });
      return json({ ok: true, bookings: [], enquiries: [], properties: [], seasons: {}, occupancy: {}, content: {}, blocks: [], ranges: [], value: null, reviews: [], photos: [], threads: [] });
    });
    await page.goto(`${base}/index.html`, { waitUntil: 'networkidle' });
    if (o.light) await page.evaluate(() => { if (!document.body.classList.contains('light-mode')) toggleTheme(); });
    page.evaluate(([i, k]) => openPayView('paytok', i, k), [id, kind]).catch(() => {});
    // Settled = a panel is up and, on a paying screen, the card box has attached
    // (submitPayment does nothing until it has, exactly as for a guest).
    if (!o.noWait) {
      await page.waitForFunction(
        () =>
          ['pay-body', 'pay-error', 'pay-done'].some((id) => !document.getElementById(id).hidden) &&
          (document.getElementById('pay-body').hidden || payState.view !== 'pay' || !!squareCard),
        null,
        { timeout: 8000 },
      ).catch(() => {});
    }
    return { page, posts, summaries: () => summaryCalls };
  };
  const charges = (posts) => posts.filter((p) => p.action === 'charge');
  const settle = (page) => page.waitForTimeout(250);

  // ---------------------------------------------------------------
  console.log('\n§1 a deposit ask: one figure, the breakdown a tap away');
  {
    const { page } = await scene('8', 'deposit');
    await page.waitForFunction(() => payState.sAll && document.querySelector('.pp-seg'), null, { timeout: 8000 }).catch(() => {});
    const v = await page.evaluate(() => ({
      stay: (document.getElementById('pay-stay') || {}).textContent || '',
      cap: (document.querySelector('#pay-stay .pp-cap') || {}).className || '',
      heroCap: ((document.querySelector('.pp-hero-cap') || {}).textContent || '').trim(),
      fig: (document.getElementById('pay-amount') || {}).textContent || '',
      what: ((document.getElementById('pay-what') || {}).textContent || '').trim(),
      expanded: (document.getElementById('pay-what') || { getAttribute: () => '' }).getAttribute('aria-expanded'),
      foldOpen: !!document.querySelector('#pay-break.is-open'),
      seg: [...document.querySelectorAll('.pp-seg-opt')].map((x) => x.textContent.replace(/\s+/g, ' ').trim()),
      segChecked: (document.querySelector('input[name="pay-mode"]:checked') || {}).value,
      stops: [...document.querySelectorAll('#pay-story .pp-stop')].map((x) => ({ amt: (x.querySelector('.pp-stop-amt') || {}).textContent, cls: x.className })),
      inAll: ((document.querySelector('#pay-story .pp-sec') || {}).textContent || '').replace(/\s+/g, ' '),
      opts: [...document.querySelectorAll('#pay-plan .pp-opt')].length,
      planChecked: (document.querySelector('input[name="pay-ap-choice"]:checked') || {}).value,
      btn: ((document.getElementById('pay-btn') || {}).textContent || '').trim(),
      consent: (document.getElementById('pay-consent') || {}).textContent || '',
      express: !document.getElementById('pay-express').hidden,
      or: !document.getElementById('sq-or').hidden,
      title: (document.getElementById('pay-title') || {}).textContent || '',
    }));
    ok(/Jollyboat/.test(v.stay) && /3 nights · 2 adults/.test(v.stay), `the stay: cottage, nights and party (${v.stay.replace(/\s+/g, ' ').trim().slice(0, 90)})`);
    ok(/is-warn/.test(v.cap) && /Dates held for you/.test(v.stay), 'nothing paid yet: "Dates held for you", in the warn tint');
    ok(v.heroCap === 'Due today' && v.fig === '£225.00', `one figure leads: ${v.heroCap} ${v.fig}`);
    ok(v.what === '£175.00 deposit, plus £50.00 you get back', `…and says what it is made of in one line (${v.what})`);
    ok(v.expanded === 'false' && !v.foldOpen, 'the breakdown starts folded');
    await page.click('#pay-what');
    await settle(page);
    const fold = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('#pay-break .pp-row')];
      const val = (r) => Number(((r.querySelector('.pp-row-v') || {}).textContent || '').replace(/[^0-9.]/g, '')) * (r.classList.contains('is-credit') ? -1 : 1);
      const body = rows.filter((r) => !r.classList.contains('is-total'));
      const total = rows.find((r) => r.classList.contains('is-total'));
      return { open: !!document.querySelector('#pay-break.is-open'), exp: document.getElementById('pay-what').getAttribute('aria-expanded'), n: rows.length, sum: body.reduce((a, r) => a + val(r), 0), total: total ? val(total) : -1, labels: rows.map((r) => (r.querySelector('.pp-row-l') || {}).childNodes[0].textContent) };
    });
    ok(fold.open && fold.exp === 'true', 'one tap opens it');
    ok(fold.n >= 3 && Math.abs(fold.sum - fold.total) < 0.005 && fold.total === 225, `the rows add up to their own total, and the total IS the figure (${fold.labels.join(' + ')} = ${fold.total})`);
    ok(v.seg.length === 2 && /Deposit £225\.00/.test(v.seg[0]) && /Whole stay £750\.00/.test(v.seg[1]) && v.segChecked === 'due', `the one choice: ${v.seg.join(' | ')}`);
    ok(v.stops.length === 3 && money(v.stops[0].amt) === 225 && money(v.stops[1].amt) === 525 && money(v.stops[2].amt) === 50, `the story: today, the balance, what comes back (${v.stops.map((s) => s.amt).join(', ')})`);
    ok(/is-now/.test(v.stops[0].cls) && money(v.stops[0].amt) === money(v.fig), "the story's Today IS the hero's figure — one figure, said once");
    ok(/£750\.00 in all/.test(v.inAll), `…and the whole is stated (${v.inAll.trim()})`);
    ok(v.opts === 3 && v.planChecked === 'self', 'the balance plan is a decision of three, "I\'ll pay it myself" chosen until the guest says otherwise');
    ok(v.btn === 'Pay £225.00', `the button names the exact amount (${v.btn})`);
    ok(/Today's payment only/.test(v.consent) && /nothing is stored/.test(v.consent), 'one consent sentence: today only, nothing stored');
    ok(!v.express && !v.or, 'no wallet mounted: no wallet row and no divider');
    ok(/Jollyboat/.test(v.title), 'the screen has a heading for a screen reader');
    // NO OTHER AMOUNT: the part-payment control is gone from the guest's screen.
    const part = await page.evaluate(() => !!document.querySelector('#pay-part-toggle, #pay-part-amt, [data-act="payPartToggle"]') || /another amount|pay part of it/i.test(document.getElementById('view-pay').textContent));
    ok(!part, 'there is no "pay another amount" control');
    await page.close();
  }

  // ---------------------------------------------------------------
  console.log('\n§2 the whole stay: its own summary, quote and figure');
  {
    const { page, posts } = await scene('8', 'deposit');
    await page.waitForFunction(() => !!payState.sAll, null, { timeout: 8000 }).catch(() => {});
    await page.click('.pp-seg-opt:last-child');
    await settle(page);
    const v = await page.evaluate(() => ({
      cap: ((document.querySelector('.pp-hero-cap') || {}).textContent || '').trim(),
      fig: (document.getElementById('pay-amount') || {}).textContent,
      stops: document.querySelectorAll('#pay-story .pp-stop').length,
      plan: !!document.querySelector('#pay-plan .pp-plan'),
      btn: (document.getElementById('pay-btn') || {}).textContent.trim(),
      consent: (document.getElementById('pay-consent') || {}).textContent,
      pill: (document.querySelector('.pp-seg') || { style: {} }).style.getPropertyValue('--i'),
    }));
    ok(v.cap === 'Your whole stay' && v.fig === '£750.00', `the switch changes the figure (${v.cap} ${v.fig})`);
    ok(v.stops === 2 && !v.plan, 'the story shrinks to two stops and there is no balance left to plan');
    ok(v.btn === 'Pay £750.00' && /Your whole stay, today/.test(v.consent), `the button and the consent follow (${v.btn})`);
    ok(v.pill === '1', 'the pill travelled to the chosen side');
    await page.click('#pay-btn');
    await page.waitForFunction(() => !document.getElementById('pay-done').hidden, null, { timeout: 8000 }).catch(() => {});
    const c = charges(posts)[0] || {};
    ok(c.kind === 'balance' && c.quote === '8:balance:750.00:q' && !c.autopay, `the charge asks for the whole stay with the whole stay's own quote (${c.kind} ${c.quote})`);
    await page.close();
  }
  {
    // The whole stay's figure still on its way: the button waits, it never charges blind.
    const { page, posts } = await scene('8', 'deposit', { slowAll: 2500 });
    await page.waitForFunction(() => document.querySelector('.pp-seg'), null, { timeout: 8000 }).catch(() => {});
    await page.click('.pp-seg-opt:last-child');
    const w = await page.evaluate(() => ({ dis: document.getElementById('pay-btn').disabled, txt: document.getElementById('pay-btn').textContent }));
    ok(w.dis && /Getting the figure/.test(w.txt), `while its figure loads the button waits (${w.txt.trim()})`);
    await page.click('#pay-btn', { force: true }).catch(() => {});
    ok(charges(posts).length === 0, '…and a tap on it charges nothing');
    await page.waitForFunction(() => !document.getElementById('pay-btn').disabled, null, { timeout: 8000 }).catch(() => {});
    ok(/Pay £750\.00/.test(await page.evaluate(() => document.getElementById('pay-btn').textContent)), 'the figure lands and the button names it');
    await page.close();
  }

  // ---------------------------------------------------------------
  console.log('\n§3 the plan: one decision, consent per choice, wallets follow');
  {
    const { page, posts } = await scene('8', 'deposit', { wallets: true });
    await page.waitForFunction(() => !document.getElementById('pay-express').hidden, null, { timeout: 8000 }).catch(() => {});
    ok(await page.evaluate(() => !document.getElementById('pay-express').hidden && !document.getElementById('sq-or').hidden), '(fixture) a wallet mounted, with the divider');
    // The plan comes FIRST: a wallet guest passes it before the buttons.
    const order = await page.evaluate(() => !!(document.getElementById('pay-plan').compareDocumentPosition(document.getElementById('pay-express')) & Node.DOCUMENT_POSITION_FOLLOWING));
    ok(order, 'the plan sits above the wallets, so a wallet guest meets it');
    await page.click('#pay-plan .pp-opt:nth-of-type(2)');
    await settle(page);
    const one = await page.evaluate(() => ({
      consent: document.getElementById('pay-consent').textContent,
      off: document.getElementById('pay-express').classList.contains('is-off'),
      note: !document.getElementById('pay-walnote').hidden,
      mid: (document.querySelector('#pay-story .pp-stop:nth-child(2) .pp-stop-sub') || {}).textContent,
      focus: document.activeElement && document.activeElement.name,
    }));
    ok(/one payment of £525\.00/.test(one.consent) && /email you 3 days before/.test(one.consent), 'one payment: the consent names the sum, the day and the email');
    ok(one.off && one.note, 'an automatic plan stands the wallets down and says why');
    ok(one.mid === 'Taken automatically', `the story follows the choice (${one.mid})`);
    ok(one.focus === 'pay-ap-choice', 'the radio under the finger keeps the focus (it is updated, not rebuilt)');
    // The belt: a wallet reached anyway refuses BEFORE tokenize.
    await page.evaluate(() => document.querySelector('#sq-gpay').click());
    await settle(page);
    const belt = await page.evaluate(() => ({ tok: window.__wtok, msg: document.getElementById('pay-msg').textContent }));
    ok(belt.tok === 0 && /card form/.test(belt.msg), 'a wallet tap with a plan chosen refuses in words, before tokenize');
    await page.click('#pay-plan .pp-opt:nth-of-type(3)');
    await settle(page);
    const mo = await page.evaluate(() => ({ consent: document.getElementById('pay-consent').textContent, chips: document.querySelectorAll('.pp-sched span').length, mid: (document.querySelector('#pay-story .pp-stop:nth-child(2) .pp-stop-amt') || {}).textContent }));
    ok(/3 monthly payments of £175\.00/.test(mo.consent) && mo.chips === 3, `monthly: the consent and the three dates (${mo.chips} dates)`);
    ok(mo.mid === '3 × £175.00', `…and the story's middle stop (${mo.mid})`);
    await page.click('#pay-btn');
    await page.waitForFunction(() => !document.getElementById('pay-done').hidden, null, { timeout: 8000 }).catch(() => {});
    const c = charges(posts)[0] || {};
    ok(c.autopay === true && c.autopay_instalments === 3 && c.kind === 'deposit', `the charge carries the consent and the offered count (${c.autopay}/${c.autopay_instalments})`);
    const lead = await page.evaluate(() => (document.querySelector('.pp-rc-lead') || {}).textContent || '');
    ok(/monthly payments are set up/.test(lead), `the receipt says the plan is set up (${lead})`);
    await page.close();
  }
  {
    const { page } = await scene('8', 'deposit', { wallets: true });
    await page.waitForFunction(() => !document.getElementById('pay-express').hidden, null, { timeout: 8000 }).catch(() => {});
    await page.click('#pay-plan .pp-opt:nth-of-type(2)');
    await page.click('#pay-plan .pp-opt:nth-of-type(1)');
    await settle(page);
    const back = await page.evaluate(() => ({ off: document.getElementById('pay-express').classList.contains('is-off'), note: !document.getElementById('pay-walnote').hidden }));
    ok(!back.off && !back.note, '"I\'ll pay it myself" brings the wallets straight back');
    await page.close();
  }

  // ---------------------------------------------------------------
  console.log('\n§4 paying by card');
  {
    const { page, posts } = await scene('8', 'deposit', { chargeDelay: 1600 });
    await page.click('#pay-btn');
    await page.waitForTimeout(200);
    const busy = await page.evaluate(() => ({ txt: document.getElementById('pay-btn').textContent, aria: document.getElementById('pay-btn').getAttribute('aria-busy'), spin: document.querySelectorAll('#pay-btn .pp-spin').length, op: getComputedStyle(document.getElementById('pay-btn')).opacity }));
    ok(/Paying £225\.00/.test(busy.txt) && busy.aria === 'true' && busy.spin === 1, `busy says what it is doing, with one spinner (${busy.txt.trim()})`);
    ok(Number(busy.op) === 1, 'busy is a spinner, not a dimmed button');
    await page.waitForFunction(() => !document.getElementById('pay-steps').hidden, null, { timeout: 3000 }).catch(() => {});
    const steps = await page.evaluate(() => [...document.querySelectorAll('#pay-steps .pay-step')].map((s) => s.className));
    ok(steps.length === 3 && steps.some((c) => /is-run/.test(c)), `a wait that lasts is narrated, step by step (${steps.length} steps)`);
    const tok = await page.evaluate(() => window.__tok[0]);
    ok(tok && tok.amount === '225.00' && tok.intent === 'CHARGE', `3-D Secure verifies the figure being charged (${tok && tok.amount})`);
    await page.waitForFunction(() => !document.getElementById('pay-done').hidden, null, { timeout: 8000 }).catch(() => {});
    const r = await page.evaluate(() => ({
      h: (document.querySelector('.pp-rc-h') || {}).textContent,
      fig: (document.querySelector('.pp-rc-fig') || {}).textContent,
      cap: ((document.querySelector('.pp-rc .pp-cap') || {}).textContent || '').trim(),
      kv: [...document.querySelectorAll('.pp-kv')].map((x) => x.textContent.replace(/\s+/g, ' ').trim()),
      next: [...document.querySelectorAll('.pp-rc .pp-vstop .pp-vstop-t')].map((x) => x.textContent),
      mail: (document.querySelector('.pp-mail') || {}).textContent,
      focus: document.activeElement && document.activeElement.className,
      once: (document.getElementById('pay-done').textContent.match(/Payment received/g) || []).length,
    }));
    ok(r.h === 'Payment received' && r.fig === '£225.00' && r.once === 1, `the receipt: what was paid, said once (${r.h} ${r.fig})`);
    ok(r.cap === 'Your dates are confirmed', `…and what it did (${r.cap})`);
    ok(r.kv.some((x) => /Paid with\s*Visa •• 4242/.test(x)) && r.kv.some((x) => /Reference\s*CHB-000008/.test(x)) && r.kv.some((x) => /Includes\s*£50\.00 refundable deposit/.test(x)), `the ticket: the card, the reference, the deposit inside it`);
    ok(r.next[0] === 'Deposit paid' && r.next.includes('Balance') && r.next.includes('Arrival details') && r.next.includes('Refundable deposit back'), `what happens next, in order (${r.next.join(' → ')})`);
    ok(/Receipt sent to d•••@example\.com/.test(r.mail), 'the receipt says where the email went, the address masked');
    ok(/pp-rc-h/.test(r.focus || ''), 'focus lands on the receipt heading');
    ok(charges(posts).length === 1 && charges(posts)[0].source_id === 'tok_card', 'one charge, carrying the card token');
    // THE CHARGE WAITS LONGER THAN THE SERVER CAN TAKE (75s): read from the code.
    ok(await page.evaluate(() => PAY_CHARGE_WAIT_MS >= 60000 && /timeoutMs: PAY_CHARGE_WAIT_MS/.test(payWithToken.toString())), 'the charge waits as long as the server may take');
    await page.close();
  }
  {
    const { page } = await scene('9', 'balance', { charge: 'okfull' });
    const v = await page.evaluate(() => ({ cap: (document.querySelector('.pp-hero-cap') || {}).textContent.trim(), fig: document.getElementById('pay-amount').textContent, stay: (document.querySelector('#pay-stay .pp-cap') || {}).textContent }));
    ok(/^Balance due by /.test(v.cap) && v.fig === '£525.00', `a balance names its day (${v.cap} ${v.fig})`);
    ok(/Confirmed/.test(v.stay), 'money in hand: the stay reads Confirmed');
    await page.click('#pay-btn');
    await page.waitForFunction(() => !document.getElementById('pay-done').hidden, null, { timeout: 8000 }).catch(() => {});
    ok(await page.evaluate(() => document.querySelector('.pp-rc-h').textContent === 'Your stay is paid in full'), 'paying the balance: "Your stay is paid in full"');
    await page.close();
  }

  // ---------------------------------------------------------------
  console.log('\n§5 a refusal sits on the card');
  {
    const { page } = await scene('8', 'deposit', { charge: 'decline' });
    await page.click('#pay-btn');
    await page.waitForFunction(() => document.querySelector('#pay-alert .pp-alert'), null, { timeout: 8000 }).catch(() => {});
    const v = await page.evaluate(() => ({ alert: (document.querySelector('#pay-alert .pp-alert') || {}).textContent || '', bad: document.getElementById('sq-card').classList.contains('is-bad'), btn: document.getElementById('pay-btn').textContent.trim(), busy: document.getElementById('pay-btn').getAttribute('aria-busy') }));
    ok(/Your bank declined this card/.test(v.alert) && /Nothing was taken/.test(v.alert), 'a decline says what happened and that nothing was taken');
    ok(v.bad, '…on the card it is about');
    ok(v.btn === 'Pay £225.00' && v.busy !== 'true', 'the button is back, naming the amount');
    await page.evaluate(() => payClearDecline());
    ok(await page.evaluate(() => !document.querySelector('#pay-alert .pp-alert') && !document.getElementById('sq-card').classList.contains('is-bad')), 'typing a new card clears it');
    await page.close();
  }
  {
    // A field mistake: Square's own iframe says it, so no banner of ours.
    const { page, posts } = await scene('8', 'deposit');
    await page.evaluate(() => { window.__tokResult = { status: 'Invalid', errors: [{ type: 'VALIDATION_ERROR', field: 'cardNumber', message: 'Card number is not valid' }] }; });
    await page.click('#pay-btn');
    await settle(page);
    const v = await page.evaluate(() => ({ msg: document.getElementById('pay-msg').textContent, alert: !!document.querySelector('#pay-alert .pp-alert') }));
    ok(!v.msg && !v.alert && charges(posts).length === 0, 'a field mistake is said once, by the card box itself, and nothing is charged');
    await page.evaluate(() => { window.__tokResult = { status: 'Error', errors: [{ type: 'UNKNOWN', message: 'The card could not be read.' }] }; });
    await page.click('#pay-btn');
    await settle(page);
    ok(/could not be read/.test(await page.evaluate(() => document.getElementById('pay-msg').textContent)), 'any other refusal is said under the box');
    await page.close();
  }
  {
    // The amount moved while they read it: redrawn, and said.
    const { page, posts } = await scene('8', 'deposit', { charge: 'changed' });
    await page.click('#pay-btn');
    await page.waitForFunction(() => document.querySelector('#pay-alert .pp-alert.is-warn'), null, { timeout: 8000 }).catch(() => {});
    const t = await page.evaluate(() => (document.querySelector('#pay-alert .pp-alert') || {}).textContent || '');
    ok(/The amount changed/.test(t), 'an amount that moved redraws the screen and says so');
    ok(posts.filter((p) => p.action === 'summary').length >= 3, '…from a fresh summary');
    await page.close();
  }

  // ---------------------------------------------------------------
  console.log('\n§6 the connection dropped');
  {
    let paidNow = false;
    const { page } = await scene('8', 'deposit', {
      charge: 'drop',
      summary: (b, json, n) => json(paidNow && b.kind === 'deposit' ? { ...SUM['8:deposit'], alreadyPaid: 175, balance: 525, amountDue: 0, damagesDue: 0, depositCharged: 50 } : SUM['8:' + (b.kind || 'deposit')]),
    });
    await page.click('#pay-btn');
    await page.waitForFunction(() => !document.getElementById('pay-error').hidden, null, { timeout: 8000 }).catch(() => {});
    const v = await page.evaluate(() => ({ h: (document.querySelector('#pay-error .pp-calm-h') || {}).textContent, payBtn: !document.getElementById('pay-body').hidden, btns: [...document.querySelectorAll('#pay-error button')].map((b) => b.textContent.trim()) }));
    ok(v.h === "We couldn't confirm your payment", `the screen says what is known (${v.h})`);
    ok(!v.payBtn && !v.btns.some((t) => /^Pay\b/.test(t)), 'there is NO Pay button — a second tap is how a guest pays twice');
    ok(v.btns.some((t) => /Check whether it went through/.test(t)), 'only a way to find out');
    paidNow = true;
    await page.click('#pay-error [data-act="payCheckAgain"]');
    await page.waitForFunction(() => !document.getElementById('pay-done').hidden, null, { timeout: 8000 }).catch(() => {});
    ok(await page.evaluate(() => document.querySelector('.pp-rc-h').textContent === 'Payment received'), 'it went through: the receipt — for the deposit, not "paid in full"');
    await page.close();
  }
  {
    const { page } = await scene('8', 'deposit', { charge: 'drop' });
    await page.click('#pay-btn');
    await page.waitForFunction(() => !document.getElementById('pay-error').hidden, null, { timeout: 8000 }).catch(() => {});
    await page.click('#pay-error [data-act="payCheckAgain"]');
    await page.waitForFunction(() => document.querySelector('#pay-alert .pp-alert.is-info'), null, { timeout: 8000 }).catch(() => {});
    const t = await page.evaluate(() => ({ alert: (document.querySelector('#pay-alert .pp-alert') || {}).textContent || '', body: !document.getElementById('pay-body').hidden }));
    ok(t.body && /didn't go through/.test(t.alert) && /Nothing was taken/.test(t.alert), 'it did not: back to the screen, and the fact said');
    await page.close();
  }

  // ---------------------------------------------------------------
  console.log('\n§7 an arranged plan, the card form, a plan in trouble');
  {
    const { page, posts } = await scene('14', 'balance');
    const v = await page.evaluate(() => ({
      cap: (document.querySelector('.pp-hero-cap') || {}).textContent.replace(/\s+/g, ' ').trim(),
      fig: document.getElementById('pay-amount').textContent,
      line: (document.querySelector('.pp-hero-line') || {}).textContent || '',
      vstops: [...document.querySelectorAll('#pay-story .pp-vstop')].map((x) => x.className),
      method: !document.getElementById('pay-method').hidden,
      bar: !document.getElementById('pay-bar').hidden,
      side: (document.getElementById('pay-armed') || {}).textContent.replace(/\s+/g, ' '),
    }));
    ok(/Arranged/.test(v.cap) && /Nothing to pay today/.test(v.cap) && v.fig === '£350.00', `an arranged plan: nothing to pay today (${v.cap})`);
    ok(/£175\.00 monthly, next on /.test(v.line), `…and when the next payment is taken (${v.line})`);
    ok(v.vstops.length === 4 && v.vstops.filter((c) => /is-auto/.test(c)).length === 2, 'the plan told down the page: paid so far, two automatic payments, the deposit back');
    ok(!v.method && !v.bar, 'no card box and no Pay bar — there is nothing to pay');
    ok(/The card you saved/.test(v.side) && /Pay £350\.00 now instead/.test(v.side) && /Turn off automatic payment/.test(v.side), 'change the card, pay early or turn it off, each one tap away');
    await page.click('[data-act="payChangeCard"]');
    await settle(page);
    const c = await page.evaluate(() => ({ method: !document.getElementById('pay-method').hidden, cap: document.getElementById('pay-method-cap').textContent, lead: document.getElementById('pay-method-lead').textContent, btn: document.getElementById('pay-btn').textContent.trim(), cancel: !document.getElementById('pay-cancel').hidden }));
    ok(c.method && c.cap === 'Your new card' && /Nothing is charged when you save/.test(c.lead), 'Change opens the card form on its own, saying nothing is charged');
    ok(c.btn === 'Save card' && c.cancel, `…with Save card and a way back (${c.btn})`);
    await page.click('#pay-btn');
    await page.waitForFunction(() => document.querySelector('#pay-alert-top .pp-alert.is-ok'), null, { timeout: 8000 }).catch(() => {});
    const up = posts.find((p) => p.action === 'update_card');
    ok(!!up && up.source_id === 'tok_card' && charges(posts).length === 0, 'saving posts the card and charges nothing');
    ok(await page.evaluate(() => payState.view === 'armed'), '…and the arranged screen returns with "Card updated"');
    await page.click('[data-act="payNowInstead"]');
    await settle(page);
    ok(await page.evaluate(() => document.getElementById('pay-btn').textContent.trim() === 'Pay £350.00' && !document.getElementById('pay-method').hidden), '"Pay now instead" opens the pay screen for the figure');
    await page.close();
  }
  {
    const { page, posts } = await scene('14', 'balance');
    await page.click('[data-act="payTurnOff"]');
    await page.waitForSelector('#glass-dialog.open, .glass-dialog.open', { timeout: 4000 }).catch(() => {});
    await page.evaluate(() => { const b = document.getElementById('glass-dialog-ok'); if (b) b.click(); });
    await page.waitForFunction(() => window.__posted || true, null, { timeout: 500 }).catch(() => {});
    await page.waitForTimeout(600);
    ok(posts.some((p) => p.action === 'autopay_off'), 'turning it off asks first, then posts autopay_off');
    await page.close();
  }
  {
    const { page } = await scene('13', 'balance');
    const v = await page.evaluate(() => ({ alert: (document.querySelector('#pay-alert-top .pp-alert') || {}).textContent || '', cls: (document.querySelector('#pay-alert-top .pp-alert') || {}).className || '', cap: (document.querySelector('.pp-hero-cap') || {}).textContent, warn: document.querySelectorAll('#pay-body .pp-vstop.is-warn').length, side: (document.getElementById('pay-armed') || {}).textContent }));
    ok(/is-warn/.test(v.cls) && /A payment didn't go through/.test(v.alert) && /try again on /.test(v.alert), 'a plan in trouble: what happened and when we try again — warn, never danger');
    ok(/Update card/.test(v.alert) && v.cap === 'Left to pay' && v.warn === 1, 'the fix is one button, and the declined payment is marked in the plan');
    ok(/Pay the £350\.00 now instead/.test(v.side), '…and paying it all now is still offered');
    await page.close();
  }

  // ---------------------------------------------------------------
  console.log('\n§8 the calm screens');
  {
    const { page, posts } = await scene('16', 'hold');
    const v = await page.evaluate(() => ({ cap: (document.querySelector('.pp-hero-cap') || {}).textContent, btn: document.getElementById('pay-btn').textContent.trim(), seg: !!document.querySelector('.pp-seg'), stay: (document.querySelector('#pay-stay .pp-cap') || {}).textContent }));
    ok(/Refundable hold/.test(v.cap) && /Held, not charged/.test(v.cap), 'the legacy hold says it is a hold, not a payment');
    ok(v.btn === 'Place £50.00 hold' && !v.seg, `…its button says so (${v.btn})`);
    await page.click('#pay-btn');
    await page.waitForFunction(() => !document.getElementById('pay-done').hidden, null, { timeout: 8000 }).catch(() => {});
    ok(posts.some((p) => p.action === 'authorize' && p.kind === 'hold') && charges(posts).length === 0, 'a hold authorises, it never charges');
    await page.close();
  }
  {
    const { page } = await scene('17', 'balance');
    const v = await page.evaluate(() => ({ h: (document.querySelector('#pay-error .pp-calm-h') || {}).textContent, pay: !document.getElementById('pay-body').hidden, story: document.querySelectorAll('#pay-error .pp-stop').length, p: (document.querySelector('#pay-error .pp-calm > p, #pay-error > p') || {}).textContent || '' }));
    ok(v.h === 'Nothing left to pay' && !v.pay, 'nothing to pay: a calm screen, no button to pay');
    ok(v.story === 2 && /arrival details around/.test(v.p), 'what was paid, what comes back, and when the arrival details come');
    await page.close();
  }
  {
    const { page } = await scene('403', 'balance');
    const v = await page.evaluate(() => ({ h: (document.querySelector('#pay-error .pp-calm-h') || {}).textContent, retry: !!document.querySelector('#pay-error [data-act="payErrorRetry"]') }));
    ok(v.h === 'This payment link has expired' && !v.retry, 'an expired link is a calm screen with no retry that would answer the same');
    await page.close();
  }
  {
    const { page } = await scene('503', 'balance');
    ok(await page.evaluate(() => /aren't available right now/.test((document.querySelector('#pay-error .pp-calm-h') || {}).textContent)), 'card payments off: said plainly');
    await page.close();
  }
  {
    const { page, summaries } = await scene('9', 'balance', { summary: (b, json, n) => (n === 1 ? json({ error: 'Something went wrong on our side.' }, 500) : json(SUM['9:balance'])) });
    ok(await page.evaluate(() => !!document.querySelector('#pay-error [data-act="payErrorRetry"]')), 'a server error offers Try again');
    await page.click('#pay-error [data-act="payErrorRetry"]');
    await page.waitForFunction(() => !document.getElementById('pay-body').hidden, null, { timeout: 8000 }).catch(() => {});
    ok(summaries() >= 2 && (await page.evaluate(() => document.getElementById('pay-btn').textContent.trim())) === 'Pay £525.00', '…and the retry opens the screen');
    await page.close();
  }

  // ---------------------------------------------------------------
  console.log('\n§9 a deposit-only payment is called that');
  {
    const { page } = await scene('18', 'balance');
    const v = await page.evaluate(() => ({ cap: (document.querySelector('.pp-hero-cap') || {}).textContent, fig: document.getElementById('pay-amount').textContent, consent: document.getElementById('pay-consent').textContent }));
    ok(v.cap === 'Your refundable deposit' && v.fig === '£75.00', `nothing of the stay left: "${v.cap}" ${v.fig}`);
    ok(/is your refundable deposit/.test(v.consent) && !/balance/i.test(v.cap + v.consent), 'never called a balance');
    await page.close();
  }

  // ---------------------------------------------------------------
  console.log('\n§10 a slow, older open never paints over a newer one');
  {
    const { page } = await scene('9', 'balance', { noWait: true, summary: async (b, json) => { if (b.booking_id === '9') await new Promise((r) => setTimeout(r, 1500)); return json(SUM[b.booking_id + ':' + (b.kind || 'balance')] || SUM[b.booking_id + ':balance']); } });
    await page.waitForTimeout(200);
    page.evaluate(() => openPayView('paytok', '14', 'balance')).catch(() => {});
    await page.waitForTimeout(2200);
    const v = await page.evaluate(() => ({ id: payState.bookingId, view: payState.view, fig: (document.getElementById('pay-amount') || {}).textContent }));
    ok(v.id === '14' && v.view === 'armed' && v.fig === '£350.00', `the newer booking stays on screen (${v.id} ${v.view} ${v.fig})`);
    await page.close();
  }

  // ---------------------------------------------------------------
  console.log('\n§11 the paint');
  for (const light of [false, true]) {
    const { page } = await scene('8', 'deposit', { light });
    const v = await page.evaluate(() => {
      const btn = document.getElementById('pay-btn');
      const cs = getComputedStyle(btn);
      const acc = getComputedStyle(document.body).getPropertyValue('--accent').trim();
      const probe = document.createElement('i');
      probe.style.color = acc;
      document.body.appendChild(probe);
      const accRgb = getComputedStyle(probe).color;
      probe.remove();
      const bar = getComputedStyle(document.getElementById('pay-bar'));
      return { bg: cs.backgroundColor, acc: accRgb, h: btn.getBoundingClientRect().height, pos: bar.position, bottom: bar.bottom, sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth };
    });
    ok(v.bg === v.acc, `${light ? 'light' : 'dark'}: the one primary paints the accent (${v.bg})`);
    ok(v.h >= 48, `…at a thumb's height (${Math.round(v.h)}px)`);
    ok(v.pos === 'sticky' && v.bottom === '0px', '…and on a phone the Pay bar stays in reach');
    ok(v.sw <= v.cw, `nothing wider than the screen (${v.sw}/${v.cw})`);
    await page.close();
  }
  {
    const { page } = await scene('14', 'balance');
    const v = await page.evaluate(() => {
      const b = document.querySelector('[data-act="payNowInstead"]');
      const cs = getComputedStyle(b);
      return { bg: cs.backgroundColor, shadow: cs.boxShadow };
    });
    const clear = /rgba\(0, 0, 0, 0\)|transparent/.test(v.bg);
    ok(clear && /inset/.test(v.shadow), `the second choice is outlined and quiet, never a second primary (${v.bg})`);
    await page.close();
  }
  {
    const { page } = await scene('8', 'deposit', { viewport: { width: 1280, height: 900 } });
    const v = await page.evaluate(() => {
      const main = document.querySelector('#pay-body .pp-main');
      const side = document.querySelector('#pay-body .pp-side');
      const mr = main.getBoundingClientRect();
      const sr = side.getBoundingClientRect();
      return { two: sr.left > mr.right - 1, sticky: getComputedStyle(main).position, barPos: getComputedStyle(document.getElementById('pay-bar')).position, plan: side.contains(document.getElementById('pay-plan')), method: side.contains(document.getElementById('pay-method')) };
    });
    ok(v.two && v.plan && v.method, 'on a computer: the summary beside the plan and the card');
    ok(v.sticky === 'sticky' && v.barPos === 'static', '…the summary holds its place, and the bar sits in the column');
    await page.close();
  }

  console.log(fails ? `\n✗ ${fails} pay-screen check(s) failed` : '\nAll pay-screen checks passed ✅');
  await done(fails);
})();
