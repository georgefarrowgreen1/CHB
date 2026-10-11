// ============================================================
//  ui-test-paystay.js — what a stay asks of the guest, said ONCE (dev/CI only).
//
//  guestStayAsk is the one rule My stays, the You page and the account's pip
//  read. Before it, three pages disagreed: an ARRANGED balance still offered
//  Pay on My stays and You; an owner-arranged stay read "you're all set" on one
//  card and stated its balance on the next; and with card payments off a stay
//  still owing read "All arranged ✓". This suite drives every state through the
//  REAL pages, signed in, with my-bookings.php stubbed:
//   §1 each state's figure, line and one button, on My stays AND on You, and
//      the two pages say the same thing
//   §2 the soonest stay is ONE card: its countdown, its tiles, and Pay once —
//      the old hub above it offered Pay a second time
//   §3 the pip on You asks only when there is something to DO
//   §4 the money block: the bar is what is paid, the breakdown is a tap away
//   §5 the paint: Pay is the accent, Manage is quiet, and at 1280 the stay
//      column is a column
// ============================================================
const { bootBrowser, d } = require('./ui-test-lib'); // pins TZ=Europe/London at require time
let fails = 0;
const ok = (b, m) => {
  console.log(`  ${b ? '✓' : '✗'} ${m}`);
  if (!b) fails++;
};

const priced = { agreed_total: 700, agreed_per_night: 233.33, agreed_nights: 3, agreed_nightly: 700, agreed_txn_fee: 0, agreed_txn_pct: 0, agreed_booking_fee: 50 };
let seq = 7000;
const mk = (pk, inD, outD, extra) => Object.assign({ prop_key: pk, check_in: inD, check_out: outD, adults: 2, children: 0, id: ++seq, created_at: d(-10) + ' 10:00:00' }, priced, extra || {});
const charged = { hold_status: 'charged', hold_amount: 50, payment_method: 'Square card' };
// Each state, and what the one rule must make of it.
const STATES = {
  balance: { rows: () => [mk('jollyboat', d(40), d(43), { ...charged, payment: 'deposit', deposit_paid: 175, pay_token: 'tA', balance_due_by: d(10), arrival_on: d(37), next_payment: { kind: 'balance', due: 525, damages: 0, charge: 525 } })],
    fig: '£525.00 balance', line: /^Due by \w{3} \d{1,2} \w{3}$/, btn: 'Pay', pip: true },
  deposit: { rows: () => [mk('jollyboat', d(60), d(63), { payment: 'unpaid', pay_token: 'tB', balance_due_by: d(30), arrival_on: d(57), next_payment: { kind: 'deposit', due: 175, damages: 50, charge: 225 } })],
    fig: '£225.00 deposit', line: /confirms your booking/, btn: 'Pay', pip: true },
  arranged: { rows: () => [mk('jollyboat', d(40), d(43), { ...charged, payment: 'deposit', deposit_paid: 350, pay_token: 'tC', balance_due_by: d(10), arrival_on: d(37), autopay_state: 'armed', next_payment: { kind: 'balance', due: 350, damages: 0, charge: 350 },
    autopay_plan: { n: 3, per: 175, toGo: 2, next: d(5), state: 'on', dates: [{ date: d(-25), state: 'done', fig: 175 }, { date: d(5), state: 'next', fig: 175 }, { date: d(35), state: 'todo', fig: 175 }] } })],
    fig: '£350.00 balance', line: /^£175\.00 monthly · next on /, btn: 'Manage', pip: false },
  owner: { rows: () => [mk('jollyboat', d(40), d(43), { payment: 'deposit', deposit_paid: 175, payment_method: 'Bank transfer', pay_token: 'tD', balance_due_by: d(10), arrival_on: d(37), next_payment: { kind: 'balance', due: 525, damages: 50, charge: 575 } })],
    fig: '£575.00 balance', line: /^As arranged with us$/, btn: '', pip: false },
  nocard: { rows: () => [mk('jollyboat', d(40), d(43), { ...charged, payment: 'deposit', deposit_paid: 175, pay_token: null, balance_due_by: d(10), arrival_on: d(37), next_payment: { kind: 'balance', due: 525, damages: 0, charge: 525 } })],
    fig: '£525.00 balance', line: /^Message us for how to pay$/, btn: 'Message us', pip: false },
  trouble: { rows: () => [mk('jollyboat', d(40), d(43), { ...charged, payment: 'deposit', deposit_paid: 175, pay_token: 'tE', balance_due_by: d(-1), arrival_on: d(37), autopay_state: 'armed', next_payment: { kind: 'balance', due: 525, damages: 0, charge: 525 },
    autopay_trouble: { state: 'retrying', why: 'The card was declined.', fig: 525, retry: d(1) } })],
    fig: '£525.00 balance', line: /^A payment didn't go through$/, btn: 'Update card', pip: true },
  paid: { rows: () => [mk('jollyboat', d(40), d(43), { ...charged, payment: 'paid', deposit_paid: 700, pay_token: 'tF', arrival_on: d(37) })],
    fig: 'Paid in full', line: /./, btn: '', pip: false },
};

(async () => {
  const { browser, base, done } = await bootBrowser();
  const open = async (rows, where, vp) => {
    const page = await browser.newPage({ viewport: vp || { width: 390, height: 844 } });
    page.on('pageerror', (e) => { console.log('  PAGEERR:', e.message); fails++; });
    await page.addInitScript(() => { if (navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(() => {}); });
    await page.route(/\.php/, (route) => {
      const url = route.request().url();
      const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
      if (url.includes('auth.php')) {
        let body = {};
        try { body = JSON.parse(route.request().postData() || '{}'); } catch (e) {}
        return json(body.action === 'guest_status' ? { ok: true, guest: { name: 'Debbie McGoldrick', email: 'd@x.co' } } : { ok: true, admin: false, guest: null });
      }
      if (url.includes('my-bookings.php')) return json({ ok: true, bookings: rows, enquiries: [], completed_stays: 1 });
      if (url.includes('rates.php')) return json({ properties: [{ prop_key: 'jollyboat', name: 'Jollyboat', slug: 'jollyboat', couple_rate: 233.33, booking_fee: 50, max_adults: 4, max_children: 2, max_total: 6, sort_order: 1 }, { prop_key: '21a', name: '21A Westgate', slug: '21a-westgate', couple_rate: 233.33, booking_fee: 50, max_adults: 2, max_children: 1, max_total: 3, sort_order: 2 }], seasons: {}, occupancy: {} });
      return json({ ok: true, bookings: [], events: [], results: [], threads: [], enquiries: [], reviews: [], photos: [], props: {}, mine: {}, value: null, days: [] });
    });
    await page.goto(`${base}/index.html`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => typeof guestStayAsk === 'function', null, { timeout: 8000 });
    if (where === 'stays') await page.evaluate(() => { nav('view-guest-bookings'); renderGuestBookings(); });
    else await page.evaluate(() => openGuestAccount());
    await page.waitForFunction((w) => document.querySelector(w === 'stays' ? '#guest-bookings-list .gbm' : '#ga-stays .ga-ask'), where, { timeout: 8000 }).catch(() => {});
    return page;
  };
  const readStays = (page) => page.evaluate(() => [...document.querySelectorAll('#guest-bookings-list .gbm')].map((m) => ({
    fig: ((m.querySelector('.gbm-fig') || {}).textContent || '').replace('✓', '').trim(),
    line: ((m.querySelector('.gbm-s') || {}).textContent || '').trim(),
    btn: ((m.querySelector('.gbm-btn') || {}).textContent || '').trim(),
  })));
  const readYou = (page) => page.evaluate(() => {
    const a = document.querySelector('#ga-stays .ga-ask');
    if (!a) return null;
    return { fig: ((a.querySelector('.ga-ask-t b') || {}).textContent || '').replace('✓', '').trim(), line: ((a.querySelector('.ga-ask-t span') || {}).textContent || '').trim(), btn: ((a.querySelector('button') || {}).textContent || '').trim() };
  });

  // ---------------------------------------------------------------
  console.log('\n§1 every state: one figure, one line, one button — on both pages');
  for (const [name, st] of Object.entries(STATES)) {
    const rows = st.rows();
    const sp = await open(rows, 'stays');
    const s = (await readStays(sp))[0] || {};
    const pays = await sp.evaluate(() => [...document.querySelectorAll('#view-guest-bookings button')].filter((b) => /^\s*Pay\b/.test(b.textContent)).length);
    await sp.close();
    const yp = await open(rows, 'you');
    const y = (await readYou(yp)) || {};
    const pip = await yp.evaluate(() => !!document.querySelector('.guest-dock-btn[data-tab="account"] .gd-pip'));
    await yp.close();
    ok(s.fig === st.fig && st.line.test(s.line) && s.btn === st.btn, `${name}: My stays says "${s.fig} · ${s.line}" ${s.btn ? '[' + s.btn + ']' : '(no button)'}`);
    // A paid stay is the one deliberate difference: My stays' journey line names
    // the arrival day, so its money block says "Nothing more to pay"; the You
    // page has no journey line, so it names the day itself.
    const sameLine = name === 'paid' ? s.line === 'Nothing more to pay' && /^Arrival details on /.test(y.line) : y.line === s.line;
    ok(y.fig === s.fig && sameLine && y.btn === s.btn, `${name}: …and the You page says the same (${y.fig} · ${y.line}${y.btn ? ' [' + y.btn + ']' : ''})`);
    ok(pays === (st.btn === 'Pay' ? 1 : 0), `${name}: Pay is offered ${st.btn === 'Pay' ? 'exactly once' : 'nowhere'} on the page (${pays})`);
    // §3, gathered here: the pip only asks when there is something to DO.
    ok(pip === st.pip, `${name}: the You pip ${st.pip ? 'asks' : 'stays quiet'}`);
  }

  // ---------------------------------------------------------------
  console.log('\n§2 the soonest stay is one card');
  {
    const rows = [STATES.balance.rows()[0], mk('21a', d(90), d(93), { payment: 'unpaid', pay_token: 'tH', balance_due_by: d(60), next_payment: { kind: 'deposit', due: 175, damages: 50, charge: 225 } })];
    const page = await open(rows, 'stays');
    const v = await page.evaluate(() => {
      const next = document.querySelector('#guest-bookings-list .gb2-next');
      return {
        nexts: document.querySelectorAll('#guest-bookings-list .gb2-next').length,
        oldHub: document.querySelectorAll('.my-stay-hub-soon, .gtl .gtj').length,
        badge: next ? ((next.querySelector('.gb2-count') || {}).textContent || '') : '',
        tiles: next ? [...next.querySelectorAll('.hub-tile span')].map((x) => x.textContent) : [],
        heads: [...document.querySelectorAll('#guest-bookings-list .gb-hdr')].map((h) => h.textContent),
        perCard: [...document.querySelectorAll('#guest-bookings-list .gb2')].map((c) => [...c.querySelectorAll('button')].filter((b) => /^\s*Pay\b/.test(b.textContent)).length),
        fab: getComputedStyle(document.getElementById('guest-msg-fab') || document.body).display,
      };
    });
    ok(v.nexts === 1 && v.oldHub === 0, 'one card carries the next stay; the hub that repeated it is gone');
    ok(/^\d+ days to go$/.test(v.badge), `its countdown sits on its photo (${v.badge})`);
    ok(v.tiles.join('|') === 'Directions|House rules|Welcome book|Amenities|Contact host|Things to do', `its tiles, in the order the owner asked for (${v.tiles.join(', ')})`);
    ok(v.heads[0] === 'Your next stay' && v.heads.includes('Later stays'), `headed as what it is (${v.heads.join(' / ')})`);
    ok(v.perCard.every((n) => n <= 1) && v.perCard.reduce((a, n) => a + n, 0) === 2, `one Pay per stay that owes, never two (${v.perCard.join(', ')})`);
    await page.close();
  }

  // ---------------------------------------------------------------
  console.log('\n§4 the money block');
  {
    const page = await open(STATES.balance.rows(), 'stays');
    const v = await page.evaluate(() => {
      const m = document.querySelector('#guest-bookings-list .gbm');
      const bar = m.querySelector('.gbm-bar > span');
      const leg = [...m.querySelectorAll('.gbm-leg span')].map((x) => x.textContent);
      return { pct: bar ? parseFloat(bar.style.width) : -1, leg, det: m.querySelector('.gb2-payline').getAttribute('aria-expanded'), hidden: m.querySelector('.gb2-fold').hidden };
    });
    ok(Math.abs(v.pct - 30) <= 1 && v.leg[0] === '£225.00 paid' && v.leg[1] === '£750.00 in all', `the bar is what is paid (${v.pct}% · ${v.leg.join(' / ')})`);
    ok(v.det === 'false' && v.hidden, 'the breakdown starts folded');
    await page.click('#guest-bookings-list .gbm .gb2-payline');
    await page.waitForTimeout(400);
    const o = await page.evaluate(() => {
      const m = document.querySelector('#guest-bookings-list .gbm');
      return { det: m.querySelector('.gb2-payline').getAttribute('aria-expanded'), hidden: m.querySelector('.gb2-fold').hidden, box: !!m.querySelector('.gb2-fold .guest-price-box') };
    });
    ok(o.det === 'true' && !o.hidden && o.box, '"Payment details" opens the breakdown in place');
    await page.close();
  }

  // ---------------------------------------------------------------
  console.log('\n§5 the paint');
  {
    const page = await open(STATES.balance.rows(), 'stays');
    const v = await page.evaluate(() => {
      const b = document.querySelector('.gbm-btn');
      // The accent resolved in the button's own cascade (a sibling probe), so a
      // theme or scope that retunes --accent is read the way the button reads it.
      const p = document.createElement('i');
      p.style.background = 'var(--accent)';
      b.parentNode.appendChild(p);
      const acc = getComputedStyle(p).backgroundColor;
      p.remove();
      // offsetHeight, not the rect: the card's entrance scales its box mid-flight.
      return { bg: getComputedStyle(b).backgroundColor, acc, h: b.offsetHeight };
    });
    ok(v.bg === v.acc && v.h >= 44, `Pay is the accent, at the reach floor (${v.bg}, ${Math.round(v.h)}px)`);
    await page.close();
  }
  {
    const page = await open(STATES.arranged.rows(), 'stays');
    const v = await page.evaluate(() => {
      const b = document.querySelector('.gbm-btn');
      const cs = getComputedStyle(b);
      return { bg: cs.backgroundColor, shadow: cs.boxShadow, line: getComputedStyle(document.querySelector('.gbm-s')).color };
    });
    ok(/rgba\(0, 0, 0, 0\)|transparent/.test(v.bg) && /inset/.test(v.shadow), 'Manage is outlined and quiet — an arrangement working as agreed does not shout');
    await page.close();
  }
  {
    const page = await open([STATES.balance.rows()[0], mk('21a', d(90), d(93), { payment: 'unpaid', pay_token: 'tH', next_payment: { kind: 'deposit', due: 175, damages: 50, charge: 225 } })], 'stays', { width: 1280, height: 900 });
    const v = await page.evaluate(() => {
      const list = document.getElementById('guest-bookings-list');
      const widest = [...list.querySelectorAll('button, a.btn-glass')].filter((e) => e.getClientRects().length).map((e) => Math.round(e.getBoundingClientRect().width)).sort((a, b) => b - a)[0] || 0;
      return { listW: Math.round(list.getBoundingClientRect().width), widest, sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth };
    });
    ok(v.listW > 0 && v.listW <= 780 && v.widest <= 780, `at 1280 the stays are a column, not the page (${v.listW}px, widest control ${v.widest}px)`);
    ok(v.sw <= v.cw, 'and nothing is wider than the screen');
    await page.close();
  }

  console.log(fails ? `\n✗ ${fails} stay-money check(s) failed` : '\nAll stay-money checks passed ✅');
  await done(fails);
})();
