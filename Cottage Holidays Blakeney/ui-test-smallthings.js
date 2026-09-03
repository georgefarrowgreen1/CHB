// ============================================================
//  ui-test-smallthings.js — round seven: seven measured findings, one gate each.
//
//    §1 the house primary PAINTS — .btn-primary had no rule and seven guest
//       buttons (the last-morning check-out tap among them) rendered as the
//       browser's default grey button; asserted on the paint, not the class;
//    §2 the messages pill stands down on My Stays while a hub is on screen
//       (it sat on the countdown badge — 364px² of "days to go"), and stays
//       everywhere else — swept against inked text;
//    §3 the pre-arrival head says the countdown once, on the badge, and the
//       name fits one line beside it;
//    §4 hit regions — the docks' 38px buttons, the spine chips and the calendar
//       refresh answer a tap 3px outside their drawn edge; the hero controls,
//       the calendar ‹ › and the hub ⋯ stand at the 44px floor;
//    §5 no text under 11px on the guest screens and Today;
//    §6 the guest notes' rag — the last line is never a lone word, and the
//       check is self-calibrating (it proves the rule does the work).
//
//  Break-tested: the button rule, the pill rule, the head string, the ::before
//  hit rule, the .tl-day size and the text-wrap rule each fail their named checks.
// ============================================================
const { bootBrowser } = require('./ui-test-lib');

const d = (n) => { const x = new Date(); x.setUTCHours(12, 0, 0, 0); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const GUEST = { id: 9, name: 'Priya Patel', email: 'p@x.co', phone: '', address: '', postcode: '' };
const stay = (o) => Object.assign({ prop_key: 'jollyboat', propKey: 'jollyboat', name: 'Priya Patel', check_in_time: '15:00', check_out_time: '10:00', adults: 2, children: 0, payment: 'paid', deposit_paid: 400, agreed_total: 400, agreed_nightly: 390, agreed_txn_fee: 10, agreed_nights: 3, damages_deposit: 50, hold_status: 'charged', hold_amount: 50 }, o);
const UPCOMING = [stay({ id: 71, check_in: d(10), check_out: d(13), payment: 'deposit', deposit_paid: 100, pay_token: 'tok71' })];
const LASTDAY = [stay({ id: 73, check_in: d(-3), check_out: d(0) })];
const NOSTAYS = []; // a guest with nothing booked has no hub at all
const BOOK = [{ id: 502, prop_key: '21a', name: 'Debbie McGoldrick', email: 'd@x.co', check_in: d(6), check_out: d(9), check_in_time: '15:00', check_out_time: '10:00', adults: 2, children: 0, payment: 'deposit', deposit_paid: 200, agreed_total: 540, agreed_nightly: 520, agreed_txn_fee: 20, agreed_nights: 3 }];

function stub(page, mode, mine) {
  return page.route(/\.php/, (r) => {
    const url = r.request().url();
    const json = (o) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    let b = {}; try { b = JSON.parse(r.request().postData() || '{}'); } catch (e) {}
    if (url.includes('auth.php')) {
      if (b.action === 'admin_status') return json({ ok: true, admin: mode === 'admin' });
      if (b.action === 'guest_status') return json({ ok: true, guest: mode === 'guest' ? GUEST : null });
      return json({ ok: true });
    }
    if (url.includes('rates.php')) return json({ properties: [
      { prop_key: '21a', name: '21A Westgate', slug: '21a-westgate', couple_rate: 130, booking_fee: 75, transaction_pct: 3, max_adults: 2, max_children: 1, max_total: 3, sort_order: 1 },
      { prop_key: 'jollyboat', name: 'Jollyboat', slug: 'jollyboat', couple_rate: 130, booking_fee: 50, max_adults: 2, max_children: 0, max_total: 2, sort_order: 2 },
    ], seasons: {}, occupancy: {} });
    // my-bookings FIRST: `includes('bookings.php')` matches it too, and the first
    // draft served the owner's list to the guest (a 6-day badge from Debbie's stay).
    if (url.includes('my-bookings.php')) return json({ ok: true, bookings: mine || [], enquiries: [], completed_stays: 1 });
    if (url.includes('bookings.php')) return json({ ok: true, bookings: BOOK, events: [], payments: [] });
    if (url.includes('enquiries.php')) return json({ ok: true, enquiries: [{ id: 901, prop_key: '21a', name: 'Nina Salt', email: 'nina@x.co', phone: '', check_in: '2027-04-10', check_out: '2027-04-14', adults: 2, children: 0, message: 'Late checkout?', created_at: '2026-09-01 10:00:00' }] });
    return json({ ok: true, bookings: [], enquiries: [], threads: [], reviews: [], photos: [], experiences: [], content: {}, blocks: [], ranges: [], mine: {}, value: null, properties: [], events: [], results: [] });
  });
}

(async () => {
  let fails = 0;
  const ok = (c, m, extra) => { console.log(`  ${c ? '✓' : '✗'} ${m}${c || extra === undefined ? '' : '  → ' + extra}`); if (!c) fails++; };
  const t = await bootBrowser();
  const open = async (mode, mine, w) => {
    const page = await t.browser.newPage({ viewport: { width: w || 390, height: 844 } });
    page.on('pageerror', (e) => { console.log('  PAGEERR:', e.message); fails++; });
    const at = new Date(); at.setHours(8, 30, 0, 0); await page.clock.setFixedTime(at);
    await stub(page, mode, mine);
    await page.goto(t.base + '/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1300);
    return page;
  };
  const painted = (page, sel) => page.evaluate((s) => { const el = document.querySelector(s); return !!el && el.getClientRects().length > 0 && getComputedStyle(el).display !== 'none'; }, sel);

  // ============================================================
  console.log('\n  §1 the house primary paints');
  let page = await open('guest', LASTDAY);
  await page.evaluate(() => openGuestArea());
  await page.waitForSelector('.hub-co-btn', { timeout: 8000 }).catch(() => null);
  const co = await page.evaluate(() => {
    const b = document.querySelector('.hub-co-btn');
    if (!b) return null;
    const cs = getComputedStyle(b); const r = b.getBoundingClientRect();
    return { text: b.textContent.trim(), bg: cs.backgroundColor, bw: cs.borderTopWidth, radius: parseFloat(cs.borderTopLeftRadius), h: Math.round(r.height), accent: getComputedStyle(document.body).getPropertyValue('--accent').trim() }; // body: light mode retunes the token there
  });
  const toRgb = (hex) => { const m = hex.match(/^#([0-9a-f]{6})$/i); if (!m) return hex; const n = parseInt(m[1], 16); return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`; };
  ok(co && co.bg !== 'rgb(239, 239, 239)' && co.bg === toRgb(co.accent), `the check-out tap is the accent primary, not the browser's grey (${co && co.bg})`, JSON.stringify(co));
  ok(co && co.bw === '0px' && co.radius >= 20 && co.h >= 44, `…no outset border, pill-rounded, at the 44px floor (${co && co.bw} / ${co && co.radius} / ${co && co.h}px)`);
  await page.evaluate(() => openFaqModal('jollyboat'));
  await page.waitForTimeout(500);
  const faq = await page.evaluate(() => { const b = document.querySelector('#faq-modal .btn-primary'); if (!b) return null; const cs = getComputedStyle(b); return { bg: cs.backgroundColor, bw: cs.borderTopWidth }; });
  ok(faq && faq.bg !== 'rgb(239, 239, 239)' && faq.bw === '0px', `the empty state's Message us wears the same rule (${faq && faq.bg})`);
  await page.evaluate(() => closeFaqModal());
  await page.close();

  // ============================================================
  console.log('\n  §2 the messages pill stands down on My Stays, and nowhere else');
  page = await open('guest', UPCOMING);
  ok(await painted(page, '#guest-msg-fab'), 'on the homepage the pill is there');
  await page.evaluate(() => openGuestArea());
  await page.waitForTimeout(900);
  ok(await page.evaluate(() => !!document.querySelector('#view-guest-bookings.active .my-stay-hub')), '(fixture) a stay hub is on screen');
  ok(!(await painted(page, '#guest-msg-fab')), 'on My Stays with a hub the pill is gone — Contact host is the chat');
  const hits = await page.evaluate(async () => {
    const fab = document.getElementById('guest-msg-fab'); const out = [];
    const inter = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
    for (let y = 0; y <= 400; y += 80) {
      window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 40));
      if (!fab || !fab.getClientRects().length) continue;
      const fr = fab.getBoundingClientRect();
      const walker = document.createTreeWalker(document.querySelector('.page-view.active'), NodeFilter.SHOW_TEXT); let n;
      while ((n = walker.nextNode())) { if (!n.textContent.trim()) continue; const range = document.createRange(); range.selectNodeContents(n); for (const r of range.getClientRects()) if (inter(r, fr) > 40) out.push(n.textContent.trim().slice(0, 20)); }
    }
    window.scrollTo(0, 0);
    return out;
  });
  ok(hits.length === 0, `…and no inked text sits under a pill (${hits.length} hits)`, hits.join(' | '));
  await page.evaluate(() => nav('view-main'));
  await page.waitForTimeout(400);
  ok(await painted(page, '#guest-msg-fab'), 'back on the homepage it returns');
  await page.close();
  page = await open('guest', NOSTAYS);
  await page.evaluate(() => openGuestArea());
  await page.waitForTimeout(900);
  ok(await page.evaluate(() => !document.querySelector('#view-guest-bookings.active .my-stay-hub')), '(fixture) a guest with nothing booked has no hub');
  ok(await painted(page, '#guest-msg-fab'), 'a guest with no hub keeps the pill — there is no Contact host to stand in for it');
  await page.close();

  // ============================================================
  console.log('\n  §3 the countdown is said once');
  page = await open('guest', UPCOMING);
  await page.evaluate(() => openGuestArea());
  await page.waitForTimeout(900);
  const head = await page.evaluate(() => {
    const card = document.querySelector('.my-stay-hub-soon'); if (!card) return null;
    const title = card.querySelector('.hub-title'); const badge = card.querySelector('.hub-count');
    const range = document.createRange(); range.selectNodeContents(title);
    const lines = new Set([...range.getClientRects()].filter((r) => r.width > 0).map((r) => Math.round(r.top))).size;
    return { title: title.textContent.trim(), lines, badge: badge.textContent.trim().replace(/\s+/g, ' ') };
  });
  ok(head && !/\d+ days|Tomorrow|day to go/.test(head.title), `the title names the cottage only (${head && head.title})`);
  ok(head && /10/.test(head.badge) && /days to go/.test(head.badge), `the badge carries the figure (${head && head.badge})`);
  ok(head && head.lines === 1, `…and the name fits one line beside it at 390px (${head && head.lines} line)`);
  await page.close();

  // ============================================================
  console.log('\n  §4 hit regions and the 44px floor');
  // A tap 3px outside the drawn edge must land on THIS control — or, in the gap
  // between two dock buttons, on its neighbour (regions overlap on purpose, the
  // way a tab bar's do; what must not exist is a dead strip). `sides` limits the
  // probes: the spine chips grow vertically only, being already wide.
  const slop = (page, sel, sides) => page.evaluate(([s, sd]) => {
    const els = [...document.querySelectorAll(s)].filter((e) => e.getClientRects().length);
    const res = els.map((e) => {
      const r = e.getBoundingClientRect();
      const probes = { L: [r.left - 3, r.top + r.height / 2], R: [r.right + 3, r.top + r.height / 2], T: [r.left + r.width / 2, r.top - 3], B: [r.left + r.width / 2, r.bottom + 3] };
      const want = (sd || 'LRTB').split('');
      const hit = want.map((k) => { const h = document.elementFromPoint(...probes[k]); return !!(h && (h === e || e.contains(h) || (h.matches && h.matches(s)))); });
      return { w: Math.round(r.width), h: Math.round(r.height), hit: hit.filter(Boolean).length, want: want.length };
    });
    return { n: res.length, allFour: res.filter((x) => x.hit === x.want).length, sizes: [...new Set(res.map((x) => `${x.w}×${x.h}`))].join(' ') };
  }, [sel, sides]);
  page = await open('guest', UPCOMING);
  const gd = await slop(page, '#guest-tabbar .guest-dock-btn, header .guest-dock-btn');
  ok(gd.n >= 3 && gd.allFour === gd.n, `the guest dock's ${gd.n} buttons (${gd.sizes}) answer a tap 3px outside their drawn edge (${gd.allFour}/${gd.n})`);
  const hero = await page.evaluate(() => [...document.querySelectorAll('.hs-mode-btn, .hs-chip')].filter((e) => e.getClientRects().length).map((e) => Math.round(e.getBoundingClientRect().height)));
  ok(hero.length >= 4 && hero.every((h) => h >= 44), `the hero's mode switch and ± chips stand at 44 (${[...new Set(hero)].join('/')})`);
  await page.evaluate(() => openProperty('jollyboat'));
  await page.waitForTimeout(600);
  const av = await page.evaluate(() => [...document.querySelectorAll('.avail-nav')].filter((e) => e.getClientRects().length).map((e) => { const r = e.getBoundingClientRect(); return `${Math.round(r.width)}×${Math.round(r.height)}`; }));
  ok(av.length === 2 && av.every((s) => s === '44×44'), `the cottage calendar's ‹ › are 44×44 (${av.join(' ')})`);
  await page.close();
  page = await open('admin', null);
  await page.evaluate(async () => { isAuthenticated = true; document.body.classList.add('owner-mode'); await loadAdminBundle(); await initBackOffice(); });
  await page.waitForTimeout(1000);
  const ad = await slop(page, 'header .admin-dock-btn');
  ok(ad.n >= 5 && ad.allFour === ad.n, `the admin dock's ${ad.n} buttons (${ad.sizes}) answer a tap 3px outside their drawn edge (${ad.allFour}/${ad.n})`);
  const rf = await slop(page, '.cal-refresh-btn');
  ok(rf.n === 1 && rf.allFour === 1, `the calendar refresh (${rf.sizes}) does too`);
  await page.evaluate(async () => { await openInbox(); });
  await page.waitForTimeout(700);
  const sp = await slop(page, '#day-spine .spine-duty', 'TB');
  ok(sp.n >= 1 && sp.allFour === sp.n, `the day spine's ${sp.n} duty chips (${sp.sizes}) answer a tap above and below their 34px`);
  await page.evaluate(async () => { const b = (dbBookings[Object.keys(dbBookings)[0]] || [])[0]; if (b) await openBookingHub(b.id); });
  await page.waitForTimeout(800);
  const menu = await page.evaluate(() => { const b = document.querySelector('.bhub-menu-btn'); return b ? Math.round(b.getBoundingClientRect().height) : null; });
  ok(menu !== null && menu >= 44, `the hub's ⋯ stands at the floor (${menu}px)`);
  await page.close();

  // ============================================================
  console.log('\n  §5 no text under 11px');
  const sweepTiny = (page) => page.evaluate(() => {
    const vis = (el) => { const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false; const b = el.getBoundingClientRect(); return b.width > 2 && b.height > 1; };
    const out = new Set();
    for (const el of document.querySelectorAll('body *')) {
      if (!vis(el)) continue;
      if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 1)) continue;
      const s = parseFloat(getComputedStyle(el).fontSize);
      if (s < 11) out.add(`${el.tagName.toLowerCase()}.${(el.className || '').toString().split(' ')[0]} ${s.toFixed(1)}`);
    }
    return [...out];
  });
  page = await open('guest', UPCOMING);
  let tiny = await sweepTiny(page);
  ok(tiny.length === 0, `home: nothing under 11px (${tiny.length})`, tiny.slice(0, 6).join(', '));
  await page.evaluate(() => openProperty('jollyboat'));
  await page.waitForTimeout(600);
  tiny = await sweepTiny(page);
  ok(tiny.length === 0, `cottage page: nothing under 11px — the calendar's weekday row was 10.6 (${tiny.length})`, tiny.slice(0, 6).join(', '));
  await page.evaluate(() => openGuestArea());
  await page.waitForTimeout(800);
  tiny = await sweepTiny(page);
  ok(tiny.length === 0, `My Stays: nothing under 11px — the small buttons were 10.9 (${tiny.length})`, tiny.slice(0, 6).join(', '));
  await page.close();
  page = await open('admin', null);
  await page.evaluate(async () => { isAuthenticated = true; document.body.classList.add('owner-mode'); await loadAdminBundle(); await initBackOffice(); });
  await page.waitForTimeout(1000);
  const tlDay = await page.evaluate(() => { const d = document.querySelector('.tl-day'); return d ? parseFloat(getComputedStyle(d).fontSize) : null; });
  ok(tlDay !== null && tlDay >= 11, `Today: every timeline day number is at least 11px (${tlDay})`);
  tiny = await sweepTiny(page);
  ok(tiny.length === 0, `Today: nothing under 11px (${tiny.length})`, tiny.slice(0, 8).join(', '));
  await page.close();

  // ============================================================
  console.log('\n  §6 the rag, self-calibrated');
  page = await open('guest', null);
  await page.evaluate(() => nav('view-experiences'));
  await page.waitForTimeout(600);
  const rag = await page.evaluate(async () => {
    const p = [...document.querySelectorAll('#view-experiences p')].find((e) => /putting together/.test(e.textContent));
    if (!p) return null;
    // Words on the LAST line, by ranging each word: the claim is "never a lone
    // word", and a width threshold would be a guess dressed as a number.
    const measure = () => {
      const tn = [...p.childNodes].find((n) => n.nodeType === 3 && n.textContent.trim());
      const text = tn.textContent; const words = []; const re = /\S+/g; let m;
      while ((m = re.exec(text))) { const r = document.createRange(); r.setStart(tn, m.index); r.setEnd(tn, m.index + m[0].length); const b = r.getBoundingClientRect(); words.push({ w: m[0], top: Math.round(b.top) }); }
      const tops = [...new Set(words.map((x) => x.top))].sort((a, b) => a - b);
      const lastTop = tops[tops.length - 1];
      return { n: tops.length, lastWords: words.filter((x) => x.top === lastTop).map((x) => x.w) };
    };
    const withRule = measure();
    const st = document.createElement('style'); st.textContent = '#view-experiences p { text-wrap: wrap !important; }'; document.head.appendChild(st);
    await new Promise((r) => requestAnimationFrame(r));
    const without = measure();
    st.remove();
    return { rule: getComputedStyle(p).textWrap || getComputedStyle(p).textWrapStyle, withRule, without };
  });
  ok(rag && /pretty/.test(rag.rule), `the note carries text-wrap: pretty (${rag && rag.rule})`);
  ok(rag && rag.withRule.n >= 2 && rag.withRule.lastWords.length >= 2, `…and its last line is not a lone word (“${rag && rag.withRule.lastWords.join(' ')}”)`, JSON.stringify(rag));
  ok(rag && rag.without.lastWords.length === 1, `…which the plain wrap really did leave (“${rag && rag.without.lastWords.join(' ')}”) — the rule does the work`);
  await page.close();

  // ============================================================
  console.log('\n  §7 continuous corners, behind @supports');
  page = await open('guest', null);
  const cs7 = await page.evaluate(() => {
    let rule = null;
    for (const sheet of document.styleSheets) { let rules; try { rules = sheet.cssRules; } catch (e) { continue; } for (const r of rules) { if (r.type === CSSRule.SUPPORTS_RULE && /corner-shape/.test(r.conditionText)) { rule = { cond: r.conditionText, sel: [...r.cssRules].map((x) => x.selectorText || '').join(',') }; } } }
    const supports = CSS.supports('corner-shape', 'superellipse(1.5)');
    const panel = getComputedStyle(document.querySelector('.glass-panel')).cornerShape;
    const btn = getComputedStyle(document.querySelector('.btn-glass')).cornerShape;
    const r = parseFloat(getComputedStyle(document.querySelector('header')).borderTopLeftRadius);
    return { rule, supports, panel, btn, r };
  });
  ok(cs7.rule && /superellipse\(1\.5\)/.test(cs7.rule.cond) && /\.glass-panel/.test(cs7.rule.sel) && /\.btn-glass/.test(cs7.rule.sel), 'the squircle is declared behind @supports for panels and buttons', JSON.stringify(cs7.rule));
  if (cs7.supports) ok(cs7.panel === 'superellipse(1.5)' && cs7.btn === 'superellipse(1.5)', `…and this engine draws it (${cs7.panel} / ${cs7.btn})`);
  else console.log('  · this engine has no corner-shape; the arc stays (declaration checked above)');
  ok(cs7.r >= 24, `…with the radius itself untouched (header ${cs7.r}px)`);
  await page.close();

  console.log(fails ? `\n  SMALL-THINGS SUITE FAILED ❌ (${fails})` : '\n  SMALL-THINGS SUITE PASSED ✅');
  await t.done(fails);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
