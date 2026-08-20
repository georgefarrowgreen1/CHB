// THE OVERNIGHT QUEUE — "Ready for you" on Today, and the switch that turns the
// whole thing off. The server half is gated in test-integration §25 (the setting
// as a real door, exactly-once ingest, the sweep) and the pure rules in
// test-nightshift.php. What THIS suite owns is the owner's side:
//   1. OFF IS OFF — with the setting off there is no card, no request, and the
//      rest of Today is byte-for-byte what it was. That is the promise the whole
//      feature rests on, so it is the first thing checked and the last.
//   2. the card renders what arrived overnight, with each item's kind and its
//      DEADLINE in words — the deadline is what stops the queue becoming a pile
//   3. the body is what a machine WROTE, so it is escaped at the render boundary
//      and never becomes markup
//   4. "Open it" routes and takes the row out of the queue; "Bin it" takes it out
//      and offers it straight back, because the machine wrote it, not the owner
//   5. NOTHING ON THIS CARD SENDS. Driven, not asserted: every request the whole
//      flow makes is collected and checked against the endpoints that email a
//      guest or move money.
//   6. the switch in Manage → System check reflects what is stored and writes
//      the key, and switching off clears the card in the same breath
const { boot } = require('./ui-test-lib'); // pins TZ=Europe/London at require time
let fails = 0;
const ok = (b, m) => { console.log(`  ${b ? '✓' : '✗'} ${m}`); if (!b) fails++; };

(async () => {
  const { page, base, done } = await boot({ viewport: { width: 1280, height: 950 } });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e && e.message)));

  const iso = (n) => {
    const t = new Date();
    const x = new Date(t.getFullYear(), t.getMonth(), t.getDate() + n, 4, 0, 0);
    const p = (v) => String(v).padStart(2, '0');
    return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())} ${p(x.getHours())}:${p(x.getMinutes())}:00`;
  };

  // Three items, chosen so each check below has something to bite on: a reply
  // with a destination and a 3-day deadline, an answer with none and a long one,
  // and a note whose body is HOSTILE — an apostrophe and a tag, because the body
  // is prose a machine wrote and must never reach the page as markup.
  let items = [
    { id: 71, ref: 'mac-1', kind: 'reply', title: 'Reply to Rachel Pemberton', sub: 'Jollyboat, week of 12 Oct',
      body: "Hello Rachel,\n\nJollyboat is free that week.", source: 'her enquiry and the cottage FAQs',
      target: 'enquiry-9', created: iso(0), expires: iso(3) },
    { id: 72, ref: 'mac-2', kind: 'answer', title: 'Somewhere to dry wetsuits', sub: 'asked 4 times',
      body: 'There is a hook rail in the back porch.', source: 'the welcome book', target: '',
      created: iso(0), expires: iso(14) },
    { id: 73, ref: 'mac-3', kind: 'note', title: "O'Brien & <b>Sons</b> — the week", sub: '',
      body: "Two enquiries went quiet.\n\n<script>window.__pwned = 1;</script> O'Brien said 5 & 6.",
      source: '', target: '', created: iso(0), expires: iso(14) },
  ];
  // BOOT WITH IT OFF, because §1 below asserts an ABSENCE of requests and the
  // boot's own loadNightItems() is a request. Booting ON meant that request was
  // in flight while §1 cleared the log, so on a loaded machine it landed AFTER
  // the clear and §1 blamed the app for a call the boot had made — green here,
  // red in CI, where the suites run three at a time. An owner who has the
  // feature off has it off at boot too, so this is also the truer fixture.
  let nightOn = 0;
  let staleCount = null; // a hostile boot payload: 'off' with a count that is not zero
  // The STORED setting, which is a different fact from the boot payload's flag
  // above: §6 reads this one to prove the switch shows what is saved rather
  // than a default, so it stays on.
  let stored = { 'night-shift': '1' };
  // Two Macs, one of them quiet — the case a single stored key could not
  // represent at all, and the one the duty is about.
  let devices = [];
  const posts = [];
  const gets = [];

  await page.route(/\.php/, (route) => {
    const url = route.request().url();
    const file = url.split('/').pop().split('?')[0];
    const json = (o, s) => route.fulfill({ status: s || 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (route.request().method() === 'POST') {
      const b = JSON.parse(route.request().postData() || '{}');
      b.__url = file;
      posts.push(b);
      if (file === 'nightshift.php') {
        if (b.action === 'list') {
          // Deliberately generous: it answers with the rows whatever the setting
          // says. The client must never ask in the first place, and this is how
          // that is proven rather than assumed.
          return json({ ok: true, on: !!nightOn, items: items });
        }
        if (b.action === 'act') {
          const it = items.find((x) => x.id === b.id);
          if (b.do === 'dismiss' || b.do === 'use') items = items.filter((x) => x.id !== b.id);
          return json({ ok: true, id: b.id, status: b.do, target: (it && it.target) || '' });
        }
      }
      if (file === 'content.php' && b.action === 'get_all') return json({ ok: true, content: stored });
      if (file === 'nightshift.php' && b.action === 'key_state') { return json({ ok: true, set: devices.length > 0 }); }
      if (file === 'nightshift.php' && b.action === 'devices') { return json({ ok: true, devices, quietAfter: 3 }); }
      if (file === 'nightshift.php' && b.action === 'connect_code') { return json({ ok: true, code: 'ABCD-2345', seconds: 600 }); }
      if (file === 'nightshift.php' && b.action === 'new_key') { devices.push({ i: devices.length, label: 'A Mac', seen: 0, quiet: -1 }); return json({ ok: true, key: 'k'.repeat(64) }); }
      if (file === 'nightshift.php' && b.action === 'stop_device') { devices = devices.filter((d) => d.i !== b.i); return json({ ok: true, stopped: b.label, left: devices.length }); }
      if (file === 'content.php' && b.action === 'set') { stored[b.key] = b.value; return json({ ok: true }); }
      return json({ ok: true, events: [], logs: {}, reviews: [], photos: [], threads: [] });
    }
    gets.push(file);
    if (file === 'admin-bootstrap.php') {
      return json({ ok: true, night: { on: nightOn, n: staleCount === null ? (nightOn ? items.length : 0) : staleCount },
        bookings: { bookings: [] }, enquiries: { enquiries: [] }, blocks: { ok: true, blocks: [] },
        cron: { stale: false, everRan: true, ageHours: 2 }, feeds: [] });
    }
    if (file === 'diagnostics.php') return json({ ok: true, checks: [], summary: {} });
    return json({ ok: true, bookings: [], enquiries: [], properties: [], seasons: {}, occupancy: {},
      content: {}, blocks: [], ranges: [], payments: [], years: [], threads: [], reviews: [],
      photos: [], experiences: [], events: [] });
  });

  await page.goto(`${base}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  await page.evaluate(() => { isAuthenticated = true; document.body.classList.add('owner-mode'); });
  await page.evaluate(() => window.loadAdminBundle());
  await page.waitForTimeout(700);
  // §8a stubs window.apiPost for the device rows and (deliberately) never
  // restores it — keep the real one so later sections can put it back.
  await page.evaluate(() => { window.__realApiPost = window.apiPost; });
  await page.evaluate(() => nav('view-backoffice'));

  const drive = async () => {
    await page.evaluate(async () => { await loadData(); await loadNightItems(); });
    await page.waitForTimeout(250);
  };

  // ── 1. OFF IS OFF ────────────────────────────────────────────────────────
  console.log('1. with the setting off there is no card at all — and no request');
  nightOn = 0;
  // LET THE BOOT FINISH BEFORE CLEARING THE LOG. nav() above starts work it
  // does not await, so without this the assertion below can be judging requests
  // the boot made rather than requests this section made. Belt to the braces of
  // booting with it off — the two together mean the check cannot be timing-lucky.
  await page.waitForTimeout(500);
  posts.length = 0;
  await drive();
  const offState = await page.evaluate(() => {
    const el = document.getElementById('night-ready');
    return { present: !!el, painted: el ? el.getClientRects().length : 0, html: el ? el.innerHTML.length : -1 };
  });
  ok(offState.present, 'the host element is in the DOM (it is where the card would go)');
  ok(offState.painted === 0, '…but nothing is painted');
  ok(offState.html === 0, '…and it holds no content at all');
  ok(!posts.some((p) => p.__url === 'nightshift.php'),
    'the queue is never even asked about — an owner with it off pays nothing');

  // ── 2. THE CARD ──────────────────────────────────────────────────────────
  console.log('2. switched on, the card says what arrived and when each goes');
  nightOn = 1;
  posts.length = 0;
  await drive();
  const card = await page.evaluate(() => {
    const el = document.getElementById('night-ready');
    const rows = [...el.querySelectorAll('.bhub-fold-grp')];
    return {
      painted: el.getClientRects().length > 0,
      badge: (el.querySelector('.inbox-badge') || {}).textContent,
      lede: (el.querySelector('.night-lede') || {}).textContent || '',
      rows: rows.length,
      labels: rows.map((r) => (r.querySelector('.bhub-fold-lbl') || {}).textContent || ''),
      caps: rows.map((r) => (r.querySelector('.st-cap') || {}).textContent || ''),
      // The card must sit ABOVE the Needs-you strip: it is the newest thing on
      // the page, and a duty is not what this is.
      beforeStrip: !!(el.compareDocumentPosition(document.getElementById('needs-you')) & Node.DOCUMENT_POSITION_FOLLOWING),
    };
  });
  ok(card.painted, 'the card is on screen');
  ok(card.badge === '3', 'the count is the number of items, not a guess');
  ok(card.rows === 3, 'one row per item');
  ok(card.beforeStrip, 'it sits above Needs you — new work first, duties below');
  ok(/never been sent|not been sent|Nothing here has been sent/i.test(card.lede),
    'the lede says nothing has been sent, changed or published');
  ok(card.caps.some((c) => /Drafted reply/.test(c)) && card.caps.some((c) => /Answer to publish/.test(c)),
    'each row is captioned by what it IS');
  ok(card.labels.some((l) => /goes in 3 days/.test(l)), 'a reply says it goes in 3 days');
  ok(card.labels.some((l) => /goes in 14 days/.test(l)), 'an answer says it goes in 14');

  // OFF IS OFF EVEN WITH A COUNT SAYING OTHERWISE. The cold-boot case above is
  // the easy one — nothing is loaded, so nothing can render. The case that could
  // actually leak is a boot payload whose count is stale or wrong while the
  // setting is off, because that is the one shape where the client has a reason
  // to go and look. The stub is hostile in both directions here: it reports three
  // waiting AND the list endpoint hands them over if asked.
  nightOn = 0;
  staleCount = 3;
  posts.length = 0;
  await drive();
  const stale = await page.evaluate(() => {
    const el = document.getElementById('night-ready');
    return { html: el.innerHTML.length, painted: el.getClientRects().length };
  });
  ok(!posts.some((p) => p.__url === 'nightshift.php'),
    'a count with the setting off is still never asked about — the setting decides, not the count');
  ok(stale.html === 0 && stale.painted === 0, '…and nothing renders');
  staleCount = null;
  nightOn = 1;
  await drive();
  ok(await page.evaluate(() => document.querySelectorAll('#night-ready .bhub-fold-grp').length) === 3,
    '…and it all comes back when the setting goes on again');

  // ── 3. THE BODY IS PROSE, NOT MARKUP ─────────────────────────────────────
  console.log('3. what a machine wrote is escaped at the render boundary');
  await page.evaluate(() => document.querySelector('[data-grp="night-73"] .bhub-fold-row').click());
  await page.waitForTimeout(150);
  const hostile = await page.evaluate(() => {
    const g = document.querySelector('[data-grp="night-73"]');
    const body = g.querySelector('.night-body');
    return {
      painted: body.getClientRects().length > 0,
      text: body.textContent,
      tags: body.querySelectorAll('*').length,
      pwned: !!(/** @type {any} */ (window).__pwned),
      lbl: (g.querySelector('.bhub-fold-lbl') || {}).textContent || '',
    };
  });
  ok(hostile.painted, 'opening a fold paints its body (the fold decides visibility, not existence)');
  ok(hostile.tags === 0, 'a script tag in the body never becomes an element');
  ok(!hostile.pwned, '…and never runs');
  ok(hostile.text.includes("O'Brien said 5 & 6."), "an apostrophe and an ampersand read as themselves, escaped exactly once");
  ok(hostile.lbl.includes("O'Brien & <b>Sons</b>"), '…and so does the title');

  // ── 4. USING ONE, AND BINNING ONE ────────────────────────────────────────
  console.log('4. open it, or bin it and put it straight back');
  await page.evaluate(() => document.querySelector('[data-grp="night-71"] .bhub-fold-row').click());
  await page.waitForTimeout(150);
  const acts = await page.evaluate(() => {
    const g = document.querySelector('[data-grp="night-71"]');
    return [...g.querySelectorAll('.night-acts button')].map((b) => ({
      label: b.textContent.trim(), painted: b.getClientRects().length > 0,
    }));
  });
  ok(acts.length === 2, 'two buttons and no more');
  ok(acts[0].label === 'Open it' && acts[0].painted, 'an item with a destination says "Open it"');
  ok(acts[1].label === 'Bin it', '…beside "Bin it"');
  const noTarget = await page.evaluate(() => {
    document.querySelector('[data-grp="night-72"] .bhub-fold-row').click();
    const b = document.querySelector('[data-grp="night-72"] .night-acts button');
    return b.textContent.trim();
  });
  ok(noTarget === 'Done', 'an item with nowhere to go says "Done" instead of promising a screen');

  posts.length = 0;
  await page.evaluate(() => document.querySelector('[data-grp="night-71"] .night-acts button').click());
  await page.waitForTimeout(400);
  const usePost = posts.find((p) => p.__url === 'nightshift.php' && p.action === 'act');
  ok(usePost && usePost.do === 'use' && usePost.id === 71, 'using one posts act:use for that row');
  const afterUse = await page.evaluate(() => ({
    rows: document.querySelectorAll('#night-ready .bhub-fold-grp').length,
    badge: (document.querySelector('#night-ready .inbox-badge') || {}).textContent,
    gone: !document.querySelector('[data-grp="night-71"]'),
  }));
  ok(afterUse.gone && afterUse.rows === 2, '…and it leaves the queue');
  ok(afterUse.badge === '2', '…and the count follows');

  posts.length = 0;
  // Clear the stack first: using the row above routed to an enquiry this fixture
  // does not hold, and its own "no longer there" toast would otherwise be the
  // first one this check finds — testing the wrong toast entirely.
  await page.evaluate(() => {
    const st = document.getElementById('app-toasts');
    if (st) st.innerHTML = '';
    const bs = document.querySelectorAll('[data-grp="night-72"] .night-acts button');
    /** @type {any} */ (bs[bs.length - 1]).click();
  });
  await page.waitForTimeout(400);
  const binPost = posts.find((p) => p.action === 'act' && p.do === 'dismiss');
  ok(binPost && binPost.id === 72, 'binning posts act:dismiss');
  const undo = await page.evaluate(() => {
    const t = document.querySelector('#app-toasts .toast');
    const btn = t && t.querySelector('button');
    return { toast: !!t, label: btn ? btn.textContent.trim() : '', painted: btn ? btn.getClientRects().length > 0 : false };
  });
  ok(undo.toast && /Undo/i.test(undo.label) && undo.painted,
    'a bin offers itself straight back — the machine wrote it, not the owner');
  posts.length = 0;
  await page.evaluate(() => document.querySelector('#app-toasts .toast button').click());
  await page.waitForTimeout(400);
  ok(posts.some((p) => p.action === 'act' && p.do === 'restore' && p.id === 72), 'Undo posts act:restore');

  // ── 4b. A BINNED REPLY SAYS IT STAYS BINNED (integration step 2). The
  // brief now withholds an enquiry whose draft was dismissed, and the toast
  // is where the owner learns that — a plain "Binned." would leave them
  // discovering it by wondering where tomorrow's draft went. Other kinds
  // keep the plain word: only a reply has a nightly twin to stand down.
  items.push({ id: 74, ref: 'mac-4', kind: 'reply', title: 'Reply to Tom Ashby', sub: '21A · 3 nights',
    body: 'Hello Tom — those dates are free.', source: 'his enquiry', target: 'enquiry-11',
    created: iso(0), expires: iso(3) });
  await page.evaluate(() => loadNightItems(true));
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const st = document.getElementById('app-toasts');
    if (st) st.innerHTML = '';
    const bs = document.querySelectorAll('[data-grp="night-74"] .night-acts button');
    /** @type {any} */ (bs[bs.length - 1]).click();
  });
  await page.waitForTimeout(400);
  const binWords = await page.evaluate(() => {
    const t = document.querySelector('#app-toasts .toast');
    return t ? t.textContent : '';
  });
  ok(/won\u2019t be drafted again|won’t be drafted again/.test(binWords),
    `binning a REPLY says it stays binned (${binWords.slice(0, 60)})`);
  if (process.env.CHB_SHOT) {
    const t = await page.$('#app-toasts');
    if (t) await t.screenshot({ path: process.env.CHB_SHOT });
  }
  await page.evaluate(() => { const s = document.getElementById('app-toasts'); if (s) s.innerHTML = ''; });

  // ── 5. NOTHING HERE SENDS ────────────────────────────────────────────────
  console.log('5. nothing on this card sends, charges or publishes');
  const dangerous = posts.concat([]).filter((p) =>
    ['bookings.php', 'mailer.php', 'pay.php', 'enquiries.php', 'messages.php', 'newsletter.php'].includes(p.__url));
  ok(dangerous.length === 0, 'no request to any endpoint that emails a guest or moves money, in the whole flow');
  const src = await page.evaluate(() => {
    const s = String(renderNightReady) + String(nightUse) + String(nightDismiss) + String(nightAct);
    return {
      only: /nightshift\.php/.test(s),
      endpoints: (s.match(/'[a-z-]+\.php'/g) || []).filter((v, i, a) => a.indexOf(v) === i),
    };
  });
  ok(src.only && src.endpoints.length === 1 && src.endpoints[0] === "'nightshift.php'",
    '…and the card can only talk to nightshift.php at all');
  // The wiring, not just the helper: initBackOffice must actually ask.
  const wired = await page.evaluate(() => /loadNightItems\(/.test(String(initBackOffice)));
  ok(wired, 'initBackOffice asks for the queue on every boot');

  // ── 6. THE SWITCH ────────────────────────────────────────────────────────
  console.log('6. the switch in Manage → System check');
  await page.evaluate(async () => { await openArea(); settingsOpen('diagnostics'); });
  await page.waitForTimeout(700);
  const sw = await page.evaluate(() => {
    const el = /** @type {any} */ (document.getElementById('night-shift-toggle'));
    const st = document.getElementById('night-shift-state');
    return {
      present: !!el, checked: el ? el.checked : null,
      painted: el ? el.getClientRects().length > 0 : false,
      state: st ? st.textContent : '',
      aria: el ? el.getAttribute('aria-label') : '',
    };
  });
  ok(sw.present && sw.painted, 'the switch is on the System check page');
  ok(sw.checked === true, '…reading what is actually stored, not a default');
  ok(/nightshift\.php/.test(sw.state), '…and the address a machine posts to is shown');
  ok(!/secret/i.test(sw.state) || !/[0-9a-f]{16}/.test(sw.state), '…but never the secret itself');
  ok(!!sw.aria, '…and it is named for a screen reader');

  posts.length = 0;
  await page.evaluate(() => /** @type {any} */ (document.getElementById('night-shift-toggle')).click());
  await page.waitForTimeout(500);
  const savedOff = posts.find((p) => p.__url === 'content.php' && p.action === 'set' && p.key === 'night-shift');
  ok(savedOff && savedOff.value === '', 'switching it off writes an empty value (NOT inverted)');
  const cleared = await page.evaluate(() => {
    const el = document.getElementById('night-ready');
    return { html: el.innerHTML.length, painted: el.getClientRects().length };
  });
  ok(cleared.html === 0 && cleared.painted === 0, '…and the card clears in the same breath, without a reload');

  posts.length = 0;
  await page.evaluate(() => /** @type {any} */ (document.getElementById('night-shift-toggle')).click());
  await page.waitForTimeout(600);
  const savedOn = posts.find((p) => p.__url === 'content.php' && p.action === 'set' && p.key === 'night-shift');
  ok(savedOn && savedOn.value === '1', 'switching it back on writes 1');
  ok(posts.some((p) => p.__url === 'nightshift.php' && p.action === 'list'),
    '…and it fetches straight away rather than waiting for a reload');


  // ── 7. GETTING THE APP ───────────────────────────────────────────────────
  console.log('7. how the Mac app is got, and what the row claims');
  // RE-AIMED: the card carries ONE link now — the download — and the rare
  // controls plus their explanation moved into the set-up fold. So the facts
  // are asserted where they now live, and the fold is opened to read it.
  const get0 = await page.evaluate(async () => {
    const d = document.querySelector('details.night-setup');
    if (d) { d.open = true; }
    await refreshNightKeyRow();
    const h = document.getElementById('night-app-get');
    const f = document.getElementById('night-key-row');
    const links = [...h.querySelectorAll('a')].map((a) => ({ href: a.getAttribute('href'), t: a.textContent.trim(), tgt: a.getAttribute('target'), rel: a.getAttribute('rel') }));
    const foldLinks = [...f.querySelectorAll('a')].map((a) => ({ href: a.getAttribute('href'), t: a.textContent.trim(), tgt: a.getAttribute('target'), rel: a.getAttribute('rel') }));
    return { painted: h.getClientRects().length > 0, links, foldLinks, text: h.textContent, foldText: f.textContent };
  });
  ok(get0.painted, 'the row is on the System check page');
  // THE DEFAULT IS A LINK THAT NEVER NEEDS UPDATING. GitHub keeps
  // /releases/latest/download/<file> pointing at the newest release, and the
  // build's filename carries no version so that URL cannot rot.
  const dlLink = get0.links.find((a) => /Download/.test(a.t));
  ok(dlLink && /\/releases\/latest\/download\/Cottage-Holidays-Blakeney\.dmg$/.test(dlLink.href),
    'with nothing set, Download points at the LATEST release, not one particular build', dlLink && dlLink.href);
  ok(get0.links.length === 1, '…and it is the ONLY control on the card besides the switch',
    JSON.stringify(get0.links.map((a) => a.t)));
  ok(get0.links.concat(get0.foldLinks).every((a) => a.tgt === '_blank' && /noopener/.test(a.rel || '')),
    '…every outward link opens outside the app, safely');
  ok(get0.foldLinks.some((a) => /Build a newer one/.test(a.t)),
    '…the build link moved into the fold rather than away', JSON.stringify(get0.foldLinks.map((a) => a.t)));
  ok(/only be made on a Mac/.test(get0.foldText), '…and so did why it is built there rather than here');

  // A URL OF YOUR OWN OVERRIDES IT.
  posts.length = 0;
  await page.evaluate(() => { window.glassPrompt = async () => 'https://example.test/mine/BlakeneyHand.dmg'; });
  await page.evaluate(() => { const d = document.querySelector('details.night-setup'); if (d) d.open = true;
    document.querySelector('[data-act="saveNightAppUrl"]').click(); });
  await page.waitForTimeout(400);
  const savedUrl = posts.find((p) => p.__url === 'content.php' && p.action === 'set' && p.key === 'nightshift-app-url');
  ok(savedUrl && savedUrl.value === 'https://example.test/mine/BlakeneyHand.dmg', 'an address of your own is saved', JSON.stringify(savedUrl));
  const get1 = await page.evaluate(async () => {
    await refreshNightKeyRow();
    const h = document.getElementById('night-app-get');
    const f = document.getElementById('night-key-row');
    const dl = [...h.querySelectorAll('a')].find((a) => /Download/.test(a.textContent));
    const btn = f.querySelector('[data-act="saveNightAppUrl"]');
    return { href: dl ? dl.getAttribute('href') : null, painted: dl ? dl.getClientRects().length > 0 : false,
      btn: btn ? btn.textContent.trim() : '', text: h.textContent };
  });
  ok(get1.href === 'https://example.test/mine/BlakeneyHand.dmg' && get1.painted,
    '…and Download follows it', JSON.stringify(get1.href));
  ok(/standard link/i.test(get1.btn), '…with a way back to the standard one, in the fold', get1.btn);
  ok(/your own address/.test(get1.text), '…and the card says which it is using');

  // THE PRIMARY PILL IS FILLED. Measured against the quiet one beside it, so it
  // cannot regress to "the class is present".
  // The quiet pill to compare against now lives in the fold, so it is read
  // from there — the point is that Download is FILLED where a quiet one is not.
  const looks = await page.evaluate(async () => {
    // OPEN THE FOLD FIRST — a computed style inside a closed <details> is not
    // what the owner sees, and the quiet pill to compare against lives there.
    const d = document.querySelector('details.night-setup');
    if (d) { d.open = true; }
    await refreshNightKeyRow();
    const dl = [...document.getElementById('night-app-get').querySelectorAll('a')]
      .find((a) => /Download/.test(a.textContent));
    const quiet = [...document.getElementById('night-key-row').querySelectorAll('a,button')]
      .find((a) => /Build a newer one/.test(a.textContent));
    if (!dl || !quiet) { return { missing: true, dl: !!dl, quiet: !!quiet }; }
    const c = (el) => { const s = getComputedStyle(el); return { bg: s.backgroundColor, fg: s.color }; };
    return { dl: c(dl), quiet: c(quiet) };
  });
  ok(!looks.missing, 'both pills are on screen to compare', JSON.stringify(looks));
  ok(looks.dl.bg !== looks.quiet.bg && looks.dl.bg !== 'rgba(0, 0, 0, 0)',
    'the Download pill is FILLED, not the same outline as the quiet one beside it', JSON.stringify(looks));
  ok(looks.dl.fg !== looks.quiet.fg, '…and takes its own ink');

  // A NON-HTTPS ADDRESS IS REFUSED, and nothing is stored.
  posts.length = 0;
  await page.evaluate(() => {
    window.glassPrompt = async () => 'javascript:alert(1)';
    window.__alerted = null;
    window.glassAlert = async (m) => { window.__alerted = m; };
  });
  await page.evaluate(() => { const d = document.querySelector('details.night-setup'); if (d) d.open = true;
    document.querySelector('[data-act="saveNightAppUrl"]').click(); });
  await page.waitForTimeout(350);
  ok(!posts.some((p) => p.key === 'nightshift-app-url'), 'a javascript: address is never saved');
  ok(/https/.test(await page.evaluate(() => window.__alerted || '')), '…and it says why');

  // AND THE RENDER GUARDS IT TOO, because a value could have been written by
  // something other than that prompt — falling back to the WORKING default
  // rather than to nothing.
  const badHref = await page.evaluate(() => {
    siteContent['nightshift-app-url'] = 'javascript:alert(1)';
    adminPrivateContent['nightshift-app-url'] = 'javascript:alert(1)';
    refreshNightAppGet();
    const h = document.getElementById('night-app-get');
    return [...h.querySelectorAll('a')].map((a) => a.getAttribute('href'));
  });
  ok(!badHref.some((h) => /^javascript:/i.test(h)), 'a stored javascript: address never becomes a link', JSON.stringify(badHref));
  ok(badHref.some((h) => /releases\/latest\/download/.test(h)),
    '…and the row falls back to the release link, not to no download at all', JSON.stringify(badHref));

  // ── 8. THE PAIRED MACS ─────────────────────────────────────────────────
  console.log('8. connecting a Mac, and stopping one');
  // THE FOLD RULE: the set-up controls live behind a <details> now, and a
  // real click on a control inside a closed one does nothing. Open it first.
  const k0 = await page.evaluate(async () => {
    const d = document.querySelector('details.night-setup');
    if (d) { d.open = true; }
    await refreshNightKeyRow();
    const h = document.getElementById('night-key-row');
    return { painted: h.getClientRects().length > 0, text: h.textContent,
      btns: [...h.querySelectorAll('button')].map((b) => b.textContent.trim()) };
  });
  ok(k0.painted, 'the card is on the System check page');
  ok(/daily-jobs secret/.test(k0.text), '…with nothing paired it says what the app is using instead');
  ok(k0.btns.some((b) => /Connect a Mac/.test(b)), '…and Connect a Mac leads', JSON.stringify(k0.btns));
  ok(k0.btns.some((b) => /key instead/.test(b)), '…with the paste kept as the way through when that cannot work');

  // THE CODE, read off this screen and typed into the Mac.
  posts.length = 0;
  await page.evaluate(() => { window.__alerted = null; window.glassAlert = async (m) => { window.__alerted = m; return true; }; });
  await page.evaluate(() => document.querySelector('[data-act="connectNightMac"]').click());
  await page.waitForTimeout(400);
  ok(posts.some((p) => p.__url === 'nightshift.php' && p.action === 'connect_code'), 'Connect a Mac asks the site for a code');
  const shown = String(await page.evaluate(() => window.__alerted || ''));
  ok(/ABCD-2345/.test(shown), '…and shows it, in halves, to read across the room', shown.slice(0, 60));
  ok(/once/.test(shown) && /minutes/.test(shown), '…saying it works once, and for how long');
  ok(!/[0-9a-f]{40}/.test(shown), '…and never a key — the app earns its own');

  // TWO MACS, one of them quiet. A single stored key could not say this.
  await page.evaluate(async () => {
    const now = Math.floor(Date.now() / 1000);
    window.__devs = [
      { i: 0, label: 'Mac mini', seen: now - 300, quiet: 0 },
      { i: 1, label: 'MacBook', seen: now - 86400 * 5, quiet: 5 },
    ];
  });
  // Drive the REAL renderer against that pair.
  await page.evaluate(async () => {
    window.apiPost = async () => ({ ok: true, devices: window.__devs, quietAfter: 3 });
    await refreshNightKeyRow();
  });
  const list = await page.evaluate(() => {
    const h = document.getElementById('night-key-row');
    return { text: h.textContent, stops: h.querySelectorAll('[data-act="stopNightDevice"]').length };
  });
  ok(/Mac mini/.test(list.text) && /MacBook/.test(list.text), 'both Macs are named', list.text.slice(0, 80));
  ok(list.stops === 2, '…each with its own Stop, which one key could never offer', String(list.stops));
  ok(/nothing for 5 nights/.test(list.text), '…and the quiet one says how long it has been quiet');
  ok(/minutes ago|just now/.test(list.text), '…while the working one says when it last spoke');
  ok(!/[0-9a-f]{40}/.test(list.text), '…and no key or hash is on the screen');

  // ── 8a2. STOP THIS MAC ACTUALLY STOPS IT ───────────────────────────────
  // Reported live: two paired Macs and no way to revoke either. Everything
  // above passed throughout — it counted the BUTTONS and never pressed one,
  // which is the assert-the-affordance trap. The cause was the dispatcher:
  // a chbAct-registered action is handed (el, event) and this one was written
  // (el, i, label), so `i` was the click event, Number(event) was NaN, and the
  // server answered 409 for ever.
  const stopped = await page.evaluate(async () => {
    const seen = [];
    window.apiPost = async (file, body) => {
      seen.push({ file, body });
      if (body.action === 'stop_device') {
        window.__devs = window.__devs.filter((d) => d.i !== body.i);
        return { ok: true, stopped: body.label, left: window.__devs.length };
      }
      return { ok: true, devices: window.__devs, quietAfter: 3 };
    };
    let asked = '';
    window.glassConfirm = async (msg) => { asked = msg; return true; };
    const btn = document.querySelector('#night-key-row [data-act="stopNightDevice"]');
    btn.click();
    await new Promise((r) => setTimeout(r, 400));
    const post = seen.filter((s) => s.body.action === 'stop_device').pop();
    return {
      asked: asked,
      post: post ? post.body : null,
      left: document.getElementById('night-key-row').textContent,
    };
  });
  ok(stopped.post !== null, 'pressing Stop this Mac really posts a stop', JSON.stringify(stopped.post));
  ok(stopped.post && stopped.post.i === 0,
    '…carrying the row\'s INDEX as a number, not the click event',
    JSON.stringify(stopped.post && stopped.post.i));
  ok(stopped.post && stopped.post.label === 'Mac mini',
    '…and the label the owner was looking at, so a moved list refuses instead of stopping the wrong one',
    JSON.stringify(stopped.post && stopped.post.label));
  ok(/Mac mini/.test(stopped.asked), '…having named the Mac in the confirm, not "undefined"', stopped.asked.slice(0, 90));
  ok(!/Mac mini/.test(stopped.left) && /MacBook/.test(stopped.left),
    '…and afterwards that Mac is off the list and the other one is not', stopped.left.slice(0, 80));

  // ── 8a3. THE DISPATCHER CONTRACT, pinned ───────────────────────────────
  // The bug above was one instance of a general defect: chbAttrs() is the
  // documented way to pass arguments and it delivered NOTHING to a registered
  // action, silently, while working for a plain window global. This asserts the
  // contract itself so the next handler written with arguments cannot repeat it.
  const contract = await page.evaluate(async () => {
    let got = null;
    chbAct('__probeArgs', function (el, ev, a, b) { got = { el: el === this, ev: !!(ev && ev.type), a: a, b: b }; });
    const d = document.createElement('button');
    d.setAttribute('data-act', '__probeArgs');
    d.setAttribute('data-args', JSON.stringify([7, 'seven']));
    document.body.appendChild(d);
    d.click();
    await new Promise((r) => setTimeout(r, 60));
    d.remove();
    return got;
  });
  ok(contract && contract.a === 7 && contract.b === 'seven',
    'a registered action receives its data-args, with types intact', JSON.stringify(contract));
  ok(contract && contract.el && contract.ev,
    '…after the (element, event) pair every existing one already relies on', JSON.stringify(contract));

  // ── 8b. THE CARD OFFERS TWO THINGS ─────────────────────────────────────
  // Asked for: the switch and the download, and nothing else in front of them.
  // Everything about connecting a Mac is done once per machine and folds away.
  const cardOffers = await page.evaluate(() => {
    const d = document.querySelector('details.night-setup');
    if (d) { d.open = false; }
    const sec = document.getElementById('sec-diagnostics') || document.body;
    // NOT getClientRects(). This Chromium reports LAYOUT BOXES for the content
    // of a CLOSED <details> while painting nothing (CLAUDE.md records the same
    // trap biting an overlap scanner on the hub's email rows), so a rect test
    // counts every folded control as visible and this check reported five.
    // Being inside a closed fold is the honest test of not being on the card.
    const shown = [...sec.querySelectorAll('#night-app-get a, #night-app-get button, #night-key-row a, #night-key-row button')]
      .filter((el) => !el.closest('details:not([open])'))
      .filter((el) => el.getClientRects().length > 0)
      .map((el) => el.textContent.trim());
    return { shown, foldOpen: d ? d.open : null, hasFold: !!d };
  });
  ok(cardOffers.hasFold, 'the set-up controls have a fold to live in');
  ok(cardOffers.foldOpen === false, '…which starts closed');
  ok(cardOffers.shown.length === 1 && /Download/.test(cardOffers.shown[0]),
    'the card offers exactly one control besides the switch: the download',
    JSON.stringify(cardOffers.shown));
  const swOn = await page.evaluate(() => {
    const el = document.getElementById('night-shift-toggle');
    return el ? el.getClientRects().length > 0 : false;
  });
  ok(swOn, '…and the on/off switch is still right there');
  // Folded, NOT deleted — it is the only route to pairing.
  const reachable = await page.evaluate(() => {
    const d = document.querySelector('details.night-setup');
    d.open = true;
    return [...d.querySelectorAll('button, a')].filter((el) => el.getClientRects().length > 0)
      .map((el) => el.textContent.trim());
  });
  ok(reachable.some((b) => /Connect a Mac/.test(b)), '…and opening it still reaches Connect a Mac', JSON.stringify(reachable));
  ok(reachable.some((b) => /Build a newer one/.test(b)), '…and the rare ones moved in here rather than away');

  // ── 9. A MAC THAT HAS GONE QUIET ───────────────────────────────────────
  // The failure that will actually happen is not a stolen key — it is a Mac
  // that stopped and said nothing, so the drafts simply never appear.
  console.log('9. the duty when the Mac goes quiet');
  const dutyFor = async (night) => page.evaluate((n) => {
    window.__nightPre = n;
    return (chbDuties() || []).filter((d) => d.kind === 'nightquiet')
      .map((d) => ({ label: d.label, sub: d.sub, sev: d.sev }));
  }, night);

  ok((await dutyFor({ on: 1, quiet: 3 })).length === 1, 'three nights quiet raises a duty');
  // THE BOUNDARY, FROM BOTH SIDES — a Mac off for one night is not a fault.
  ok((await dutyFor({ on: 1, quiet: 2 })).length === 0, '…two nights does not');
  ok((await dutyFor({ on: 1, quiet: 0 })).length === 0, '…nor a Mac that spoke today');
  // -1 IS "THE QUESTION DOES NOT APPLY": nothing paired, or never reported.
  ok((await dutyFor({ on: 1, quiet: -1 })).length === 0,
    '…and a Mac that has never reported raises nothing — that is setup, not failure');
  ok((await dutyFor({ on: 0, quiet: 9 })).length === 0,
    '…and with the feature off there is no duty at all');
  const d3 = await dutyFor({ on: 1, quiet: 4 });
  ok(/4 nights/.test(d3[0].label), '…the row says how long', d3[0].label);
  ok(/off, asleep, or no longer connected/.test(d3[0].sub), '…and what it might be');
  ok(d3[0].sev === 'warn', '…amber, not red: nothing is broken, something has stopped');

  // ── §8 THE TEACH SUGGESTION (search × Mac, rung 4) — a one-tap lesson ──
  // the OWNER confirms; the machine only ever suggested. The pair rides
  // title/sub in the fixed shape; the canonical is re-validated against the
  // client's own live menu (chbCanonList) before any one-tap is offered.
  nightOn = true;
  items = [
    { id: 81, ref: 'mac--teach-q1', kind: 'teach', title: '“anyone owing us?”',
      sub: 'reads as “who owes me money”', body: 'Searched 3 times and nothing answered.',
      source: 'the week’s dead-end searches', target: 'settings:search-learning',
      created: iso(0), expires: iso(14) },
    // The OFF-MENU case: a canonical the client's engine cannot answer must
    // never earn the one-tap — it degrades to the ordinary Open path.
    { id: 82, ref: 'mac--teach-q2', kind: 'teach', title: '“what about the wumbus?”',
      sub: 'reads as “flarp the wumbus”', body: 'x', source: '',
      target: 'settings:search-learning', created: iso(0), expires: iso(14) },
  ];
  // §6's toggle path set the client's OWN __nightOn — drive the loader with a
  // fresh boot pre directly, the way the app's boot does: §8's question is the
  // teach affordance, not the boot plumbing the earlier sections own.
  // §8a left window.apiPost stubbed to the device payload — restore the real
  // transport, then drive the loader with a fresh boot pre (the §6 toggle set
  // the client's own __nightOn; §8's question is the affordance, not the boot).
  await page.evaluate(async () => {
    window.apiPost = window.__realApiPost;
    window.__nightPre = { on: 1, n: 2 };
    await loadNightItems(true);
  });
  await page.waitForTimeout(250);
  const teachSt = await page.evaluate(() => {
    const open = (id) => { const g = document.querySelector(`[data-args*="night-${id}"]`); if (g) g.click(); };
    open(81); open(82);
    const acts = (id) => Array.from(document.querySelectorAll(`#bhub-fold-night-${id} .night-acts button`)).map((b) => b.textContent.trim());
    return { a81: acts(81), a82: acts(82), word: (document.querySelector('#night-ready').textContent.match(/A phrasing to teach/) || [])[0] || '' };
  });
  ok(teachSt.a81[0] === 'Teach it', `a mapped phrasing earns the one-tap Teach (${teachSt.a81.join('|')})`);
  ok(teachSt.a82[0] === 'Open it', `an off-menu canonical degrades to Open — never taught (${teachSt.a82.join('|')})`);
  ok(/A phrasing to teach/.test(teachSt.word), 'the capsule names what the thing IS');
  posts.length = 0;
  await page.evaluate(() => nightTeach(81));
  await page.waitForTimeout(300);
  const taught = await page.evaluate(() => ({
    learned: JSON.parse(localStorage.getItem('chb-nlu-learned') || '[]'),
    rows: __nightItems.length,
  }));
  ok(taught.learned.some((x) => x.t === 'anyone owing us?' && x.c === 'who owes me money'),
    'Teach it teaches through the REAL chbNluLearn');
  ok(posts.some((p) => p.__url === 'nightshift.php' && p.action === 'act' && p.do === 'use' && p.id === 81)
    && taught.rows === 1, 'and the item is marked used and leaves the card');
  // The off-menu one must teach NOTHING even if driven directly.
  await page.evaluate(() => nightTeach(82));
  await page.waitForTimeout(200);
  const notTaught = await page.evaluate(() => JSON.parse(localStorage.getItem('chb-nlu-learned') || '[]'));
  ok(!notTaught.some((x) => x.c === 'flarp the wumbus'), 'a direct call on the off-menu row still refuses to teach');

  // ── §9 ASK YOUR MAC — the web chat, driven in the browser ────────────────
  // The screen is a FORMATTER over chat_send/chat_poll; the suite scripts the
  // site's answers and asserts the narration, the partial paint, the settled
  // message (thinking folded, lookups chipped, markup inert) and the honest
  // failures (asleep, expired).
  await page.evaluate(() => {
    const nowSec = Math.floor(Date.now() / 1000);
    window.__mcCalls = [];
    window.__mcPolls = [];
    window.apiPost = async (file, body) => {
      window.__mcCalls.push(body.action);
      if (body.action === 'chat_thread') {
        return { ok: true, on: true, msgs: [
          { who: 'you', text: 'earlier question', at: '09:00' },
          { who: 'mac', text: 'Earlier answer.', at: '09:00', used: ['today'] },
        ], instr: '', presence: { seen: nowSec, listening: true } };
      }
      if (body.action === 'chat_send') { return { ok: true, id: 77, presence: { listening: true } }; }
      if (body.action === 'chat_poll') {
        const r = window.__mcPolls.shift() || { ok: true, status: 'open' };
        if (r.__peek) {
          const live = document.getElementById('mc-live');
          const caps = document.querySelectorAll('#mc-log .mc-jcap');
          window.__mcMid = {
            live: !!live,
            think: live ? (live.querySelector('.mc-think-b') || {}).textContent || '' : '',
            text: live ? (live.querySelector('.mc-mac') || {}).textContent || '' : '',
            journey: caps.length ? caps[caps.length - 1].textContent : '',
          };
        }
        return r;
      }
      return { ok: true };
    };
    openAiChat();
  });
  await page.waitForTimeout(300);
  const mcBoot = await page.evaluate(() => ({
    view: (document.querySelector('.page-view.active') || {}).id,
    pres: document.getElementById('ac-pres').textContent,
    msgs: document.querySelectorAll('#mc-log .mc-bub').length,
    chip: /Checked the website · today/.test(document.getElementById('mc-log').textContent),
    composer: (() => { const c = document.querySelector('#view-aichat .ac-composer'); return c && getComputedStyle(c).display !== 'none'; })(),
  }));
  ok(mcBoot.view === 'view-aichat', `AI chat is its OWN page (${mcBoot.view})`);
  ok(/Listening/.test(mcBoot.pres), `presence lives in the page's bar (${mcBoot.pres})`);
  ok(mcBoot.msgs === 2 && mcBoot.chip, 'the shared thread paints with its lookup chip');
  ok(mcBoot.composer, 'the floating composer shows on the active page');
  // The dock carries the page's own mark, labelled AI chat.
  ok(await page.evaluate(() => !!document.querySelector('.admin-dock-btn[data-view="view-aichat"][data-label="AI chat"]')),
    'the dock carries the AI chat mark');
  // The exchange: a partial streams in, then the answer settles.
  await page.evaluate(() => {
    window.__mcPolls = [
      { ok: true, status: 'open', partial: { text: 'One arr', think: 'checking the day' } },
      { __peek: true, ok: true, status: 'answered', msg: {
        who: 'mac', text: '**One arrival** — Sarah. <script>window.__mcPwn = 1</script>',
        think: 'the calendar knows', used: ['today', 'availability'], model: 'gemma-4b', at: '14:22',
      } },
    ];
  });
  await page.fill('#mc-in', 'who arrives today?');
  await page.click('#mc-send');
  await page.waitForTimeout(600);
  const mcDone = await page.evaluate(() => {
    const log = document.getElementById('mc-log');
    const macs = log.querySelectorAll('.mc-mac');
    const last = macs[macs.length - 1];
    return {
      mid: window.__mcMid,
      calls: window.__mcCalls.filter((a) => a === 'chat_send' || a === 'chat_poll'),
      strong: last.querySelectorAll('strong').length,
      scripts: log.querySelectorAll('script').length,
      pwned: !!window.__mcPwn,
      chip: /Checked the website · today, availability/.test(log.textContent),
      foldOpen: (() => { const f = log.querySelectorAll('.mc-think'); return f[f.length - 1].open; })(),
      journey: (log.querySelector('.mc-meta') || {}).textContent || '',
      liveGone: !document.getElementById('mc-live'),
      capsGone: log.querySelectorAll('.mc-jcap').length === 0,
    };
  });
  ok(mcDone.mid && mcDone.mid.live && /checking the day/.test(mcDone.mid.think) && /One arr/.test(mcDone.mid.text)
    && /Picked up at home/.test(mcDone.mid.journey),
    `the partial painted mid-flight, thinking open, the capsule says picked up (${JSON.stringify(mcDone.mid)})`);
  ok(mcDone.strong === 1 && mcDone.scripts === 0 && !mcDone.pwned,
    'the settled answer is markdown with markup INERT');
  ok(mcDone.chip && mcDone.foldOpen === false && mcDone.liveGone && mcDone.capsGone,
    'lookup chip on, thinking folded closed, the live block and capsules replaced');
  ok(/answered by your Mac at home · gemma-4b/.test(mcDone.journey),
    `the meta signs off naming the Mac (${mcDone.journey})`);
  // ATTACHMENTS. The 📎 arms ONE pending file; a document is fenced into the
  // send (the Mac's own shape) and the bubble collapses it to a chip; the
  // refusals are sentences; a stored photo message paints its thumbnail.
  const attTmp = require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'chb-att-'));
  const attDoc = require('path').join(attTmp, 'cleaning-rota.txt');
  require('fs').writeFileSync(attDoc, 'Mon: 21A changeover\nTue: Jollyboat deep clean\n');
  const attBig = require('path').join(attTmp, 'huge.txt');
  require('fs').writeFileSync(attBig, 'z'.repeat(7000));
  const attPdf = require('path').join(attTmp, 'contract.pdf');
  require('fs').writeFileSync(attPdf, '%PDF-1.4 not really');
  ok(await page.evaluate(() => !!document.querySelector('#view-aichat .ac-clip') && !!document.getElementById('mc-file')),
    'the composer carries the 📎 and its file input');
  await page.setInputFiles('#mc-file', attDoc);
  await page.waitForTimeout(200);
  const attChip = await page.evaluate(() => ({
    shown: !document.getElementById('mc-pend').hidden,
    name: (document.querySelector('.mc-pname') || {}).textContent || '',
  }));
  ok(attChip.shown && attChip.name === 'cleaning-rota.txt',
    `picking a document arms the pending chip (${JSON.stringify(attChip)})`);
  await page.click('.mc-px');
  ok(await page.evaluate(() => document.getElementById('mc-pend').hidden && !window.__mcAttachLeak),
    'the ✕ disarms it');
  // Refusals are SENTENCES, and nothing is armed after one.
  await page.setInputFiles('#mc-file', attBig);
  await page.waitForTimeout(200);
  const attBigSay = await page.evaluate(() => document.body.textContent.includes('too big for the chat')
    && document.getElementById('mc-pend').hidden);
  ok(attBigSay, 'an over-cap document is refused in a sentence, nothing armed');
  await page.setInputFiles('#mc-file', attPdf);
  await page.waitForTimeout(200);
  ok(await page.evaluate(() => document.body.textContent.includes('PDFs can’t be read here yet')
    && document.getElementById('mc-pend').hidden),
    'a PDF is NAMED as unreadable, never half-read');
  // The send: the fenced text + the file name travel; the bubble collapses.
  await page.evaluate(() => {
    window.__mcSendBody = null;
    window.apiPost = async (file, body) => {
      if (body.action === 'chat_send') { window.__mcSendBody = body; return { ok: true, id: 79, presence: { listening: true } }; }
      if (body.action === 'chat_poll') { return { ok: true, status: 'expired', say: 'x' }; }
      return { ok: true };
    };
  });
  await page.setInputFiles('#mc-file', attDoc);
  await page.waitForTimeout(200);
  await page.fill('#mc-in', 'who does Tuesday?');
  await page.click('#mc-send');
  await page.waitForTimeout(300);
  const attSent = await page.evaluate(() => {
    const b = window.__mcSendBody;
    const log = document.getElementById('mc-log');
    const bubs = log.querySelectorAll('.mc-bub.mc-you');
    return {
      fenced: b && /--- attached file: cleaning-rota\.txt ---/.test(b.text) && /Jollyboat deep clean/.test(b.text),
      file: b && b.file,
      chip: !!log.querySelector('.mc-fchip'),
      lastBub: bubs.length ? bubs[bubs.length - 1].textContent : '',
      pendClear: document.getElementById('mc-pend').hidden,
    };
  });
  ok(attSent.fenced && attSent.file === 'cleaning-rota.txt',
    `the document travels fenced with its name (${JSON.stringify({ file: attSent.file })})`);
  ok(attSent.chip && attSent.lastBub === 'who does Tuesday?' && attSent.pendClear,
    `the bubble collapses the fence to a chip and the pending chip clears (${JSON.stringify({ bub: attSent.lastBub })})`);
  // A stored photo message paints its thumbnail from the SERVER ref — and only
  // the minted shape ever lands in src.
  await page.evaluate(() => {
    window.apiPost = async (file, body) => {
      if (body.action === 'chat_thread') {
        return { ok: true, on: true, msgs: [
          { who: 'you', text: 'what is this pipe doing?', img: 'uploads/chat-photo-0123456789ab.jpg', at: '10:00' },
          { who: 'you', text: 'and this?', img: 'uploads/../secrets.jpg', at: '10:01' },
        ], instr: '', presence: { seen: Math.floor(Date.now() / 1000), listening: true } };
      }
      return { ok: true };
    };
    return renderMacChat();
  });
  await page.waitForTimeout(200);
  const attPhoto = await page.evaluate(() => {
    const imgs = document.querySelectorAll('#mc-log .mc-photo');
    return { count: imgs.length, src: imgs.length ? imgs[0].getAttribute('src') : '' };
  });
  ok(attPhoto.count === 1 && attPhoto.src === 'uploads/chat-photo-0123456789ab.jpg',
    `a photo message paints its thumbnail, and a junk ref never reaches src (${JSON.stringify(attPhoto)})`);
  try { require('fs').rmSync(attTmp, { recursive: true, force: true }); } catch (e) {}
  // THE STOP. While an ask is in flight the send circle is a ■ (the same
  // button, alive — the dispatcher must not have disabled it); tapping it
  // posts chat_stop, keeps the words already streamed with their sign-off,
  // and hands the button back. A stop before any words stores nothing.
  await page.evaluate(() => {
    window.__mcStops = [];
    window.apiPost = async (file, body) => {
      if (body.action === 'chat_send') { return { ok: true, id: 90, presence: { listening: true } }; }
      if (body.action === 'chat_poll') {
        // First poll: a partial. After: hang, so the flight stays open.
        if (!window.__mcPolled) { window.__mcPolled = 1; return { ok: true, status: 'open', partial: { text: 'The weekend looks', think: '' } }; }
        return new Promise(() => {});
      }
      if (body.action === 'chat_stop') {
        window.__mcStops.push(body.id);
        return { ok: true, kept: true, msg: { who: 'mac', text: 'The weekend looks', at: '11:00', stopped: true } };
      }
      return { ok: true };
    };
  });
  await page.fill('#mc-in', 'how is the weekend looking?');
  await page.click('#mc-send');
  await page.waitForTimeout(400);
  const stArm = await page.evaluate(() => {
    const b = document.getElementById('mc-send');
    return { label: b.getAttribute('aria-label'), stop: b.classList.contains('is-stop'),
      alive: !b.disabled, live: !!document.getElementById('mc-live') };
  });
  ok(stArm.label === 'Stop' && stArm.stop && stArm.alive && stArm.live,
    `in flight the send is a LIVE Stop, mid-partial (${JSON.stringify(stArm)})`);
  await page.click('#mc-send');
  await page.waitForTimeout(300);
  const stDone = await page.evaluate(() => {
    const b = document.getElementById('mc-send');
    const log = document.getElementById('mc-log');
    const macs = log.querySelectorAll('.mc-bub.mc-mac');
    return { stops: window.__mcStops, label: b.getAttribute('aria-label'),
      kept: macs.length ? macs[macs.length - 1].textContent : '',
      meta: /stopped by you — kept what it had said/.test(log.textContent),
      liveGone: !document.getElementById('mc-live') };
  });
  ok(stDone.stops.length === 1 && stDone.stops[0] === 90,
    `the ■ posts chat_stop with the in-flight ask (${JSON.stringify(stDone.stops)})`);
  ok(/The weekend looks/.test(stDone.kept) && stDone.meta && stDone.liveGone && stDone.label === 'Send',
    `the words already said are KEPT with their sign-off and the button hands back (${JSON.stringify({ kept: stDone.kept, label: stDone.label })})`);
  // A stop BEFORE any words: nothing stored, the capsule says so.
  await page.evaluate(() => {
    const before = document.querySelectorAll('#mc-log .mc-bub.mc-mac').length;
    window.__mcBefore = before;
    window.apiPost = async (file, body) => {
      if (body.action === 'chat_send') { return { ok: true, id: 91, presence: { listening: true } }; }
      if (body.action === 'chat_poll') { return new Promise(() => {}); }
      if (body.action === 'chat_stop') { return { ok: true, kept: false }; }
      return { ok: true };
    };
  });
  await page.fill('#mc-in', 'and next week?');
  await page.click('#mc-send');
  await page.waitForTimeout(250);
  await page.click('#mc-send');
  await page.waitForTimeout(250);
  const stEarly = await page.evaluate(() => ({
    macs: document.querySelectorAll('#mc-log .mc-bub.mc-mac').length,
    before: window.__mcBefore,
    say: /Stopped — nothing had come back yet/.test(document.getElementById('mc-log').textContent),
    label: document.getElementById('mc-send').getAttribute('aria-label'),
  }));
  ok(stEarly.macs === stEarly.before && stEarly.say && stEarly.label === 'Send',
    `a stop before any words stores nothing and says so (${JSON.stringify(stEarly)})`);
  // THE ACTION CARD — the model proposes, THIS PHONE disposes. Rendering a
  // card fires NOTHING; Confirm runs the real endpoint (captured) and marks
  // the verdict; Dismiss marks with no business POST; an unknown kind — the
  // closed-registry rule — renders no card at all.
  await page.evaluate(() => {
    window.__mcReqs = [];
    window.apiPost = async (file, body) => {
      window.__mcReqs.push(file + ':' + body.action);
      if (body.action === 'chat_thread') {
        return { ok: true, on: true, instr: '', presence: { seen: Math.floor(Date.now() / 1000), listening: true }, msgs: [
          { who: 'you', text: 'block jollyboat for the boiler', at: '12:00' },
          { who: 'mac', text: 'I can hold those dates.', at: '12:01', act: { kind: 'block_dates', prop: 'jollyboat', cottage: 'Jollyboat', from: '2027-09-01', to: '2027-09-04', note: 'boiler' } },
          { who: 'mac', text: 'And this one you should never see.', at: '12:02', act: { kind: 'delete_everything', prop: 'jollyboat' } },
        ] };
      }
      if (body.action === 'chat_act_done') { return { ok: true, verdict: body.verdict }; }
      return { ok: true };
    };
    return renderMacChat();
  });
  await page.waitForTimeout(250);
  const acCard = await page.evaluate(() => ({
    cards: document.querySelectorAll('#mc-log .mc-act').length,
    facts: (document.querySelector('.mc-act-f') || {}).textContent || '',
    note: /Nothing happens until you confirm/.test(document.getElementById('mc-log').textContent),
    fired: window.__mcReqs.filter((r) => !/chat_thread/.test(r)),
  }));
  ok(acCard.cards === 1 && /Jollyboat/.test(acCard.facts) && /4 nights/.test(acCard.facts) && /boiler/.test(acCard.facts),
    `ONE card renders with its stated facts — the unknown kind renders none (${JSON.stringify({ cards: acCard.cards, facts: acCard.facts })})`);
  ok(acCard.note && acCard.fired.length === 0,
    `rendering a proposal fires NOTHING, and the card says so (${JSON.stringify(acCard.fired)})`);
  // Dismiss: the verdict is recorded, no business endpoint is touched.
  await page.click('.mc-act-no');
  await page.waitForTimeout(250);
  const acDis = await page.evaluate(() => ({
    reqs: window.__mcReqs.filter((r) => !/chat_thread/.test(r)),
    off: !!document.querySelector('.mc-act.is-off'),
    buttons: document.querySelectorAll('.mc-act-go').length,
  }));
  ok(acDis.reqs.length === 1 && /nightshift\.php:chat_act_done/.test(acDis.reqs[0]) && acDis.off && acDis.buttons === 0,
    `Dismiss records the verdict and ONLY the verdict — the card goes inert (${JSON.stringify(acDis)})`);
  // Confirm: the real endpoint runs (the block's checkout is EXCLUSIVE —
  // to + 1 day), then the verdict lands and the card flips done.
  await page.evaluate(() => {
    window.__mcReqs = [];
    window.apiPost = async (file, body) => {
      window.__mcReqs.push({ f: file, a: body.action, prop: body.prop, ci: body.check_in, co: body.check_out, v: body.verdict });
      if (body.action === 'chat_thread') {
        return { ok: true, on: true, instr: '', presence: { seen: Math.floor(Date.now() / 1000), listening: true }, msgs: [
          { who: 'mac', text: 'Holding them.', at: '12:03', act: { kind: 'block_dates', prop: 'jollyboat', cottage: 'Jollyboat', from: '2027-09-01', to: '2027-09-04' } },
        ] };
      }
      if (body.action === 'chat_act_done') { return { ok: true, verdict: body.verdict }; }
      return { ok: true };
    };
    window.__realInit = window.initBackOffice;
    window.initBackOffice = async () => {};
    return renderMacChat();
  });
  await page.waitForTimeout(250);
  await page.click('.mc-act-go');
  await page.waitForTimeout(350);
  const acGo = await page.evaluate(() => {
    window.initBackOffice = window.__realInit;
    const blocks = window.__mcReqs.filter((r) => r.a === 'add_block');
    const verdicts = window.__mcReqs.filter((r) => r.a === 'chat_act_done');
    return { blocks, verdicts, done: !!document.querySelector('.mc-act.is-done') };
  });
  ok(acGo.blocks.length === 1 && acGo.blocks[0].f === 'ical-import.php'
    && acGo.blocks[0].prop === 'jollyboat' && acGo.blocks[0].ci === '2027-09-01' && acGo.blocks[0].co === '2027-09-05',
    `Confirm runs the REAL block endpoint, checkout exclusive (${JSON.stringify(acGo.blocks)})`);
  ok(acGo.verdicts.length === 1 && acGo.verdicts[0].v === 'done' && acGo.done,
    `…then the verdict lands and the card reads done (${JSON.stringify(acGo.verdicts)})`);
  // ADD_BOOKING: Confirm posts the SAME add the form posts — and never an
  // override flag; a clash keeps the card live with the server's sentence.
  await page.evaluate(() => {
    window.__mcReqs = [];
    window.__mcClash = true;
    window.__realAlert = window.glassAlert;
    window.__mcAlerts = [];
    window.glassAlert = async (m) => { window.__mcAlerts.push(m); };
    window.initBackOffice = async () => {};
    window.apiPost = async (file, body) => {
      window.__mcReqs.push({ f: file, a: body.action, b: body });
      if (body.action === 'chat_thread') {
        return { ok: true, on: true, instr: '', presence: { seen: Math.floor(Date.now() / 1000), listening: true }, msgs: [
          { who: 'mac', text: 'Booking her in.', at: '12:05', act: { kind: 'add_booking', prop: 'jollyboat', cottage: 'Jollyboat',
            check_in: '2027-09-12', check_out: '2027-09-15', name: 'Sarah Pemberton', adults: 2, children: 1, price: 400 } },
        ] };
      }
      if (body.action === 'add') {
        return window.__mcClash ? { clash: true, message: 'Those dates clash with Dan Rowe (12/09/2027 – 14/09/2027).' } : { ok: true, id: 99 };
      }
      if (body.action === 'chat_act_done') { return { ok: true, verdict: body.verdict }; }
      return { ok: true };
    };
    return renderMacChat();
  });
  await page.waitForTimeout(250);
  const abFacts = await page.evaluate(() => (document.querySelector('.mc-act-f') || {}).textContent || '');
  ok(/Sarah Pemberton/.test(abFacts) && /3 nights/.test(abFacts) && /2 adults \+ 1 child/.test(abFacts) && /£400\.00/.test(abFacts),
    `the booking card states guest, stay, party and the agreed price (${abFacts})`);
  await page.click('.mc-act-go');
  await page.waitForTimeout(300);
  const abClash = await page.evaluate(() => ({
    adds: window.__mcReqs.filter((r) => r.a === 'add'),
    verdicts: window.__mcReqs.filter((r) => r.a === 'chat_act_done').length,
    alert: window.__mcAlerts[0] || '',
    live: !!document.querySelector('.mc-act-go'),
  }));
  ok(abClash.adds.length === 1 && !('override_clash' in abClash.adds[0].b)
    && abClash.adds[0].b.prop_key === 'jollyboat' && abClash.adds[0].b.price_override === 400,
    `Confirm posts the form's own add — never an override flag (${JSON.stringify(abClash.adds[0] && abClash.adds[0].b)})`);
  ok(/clash with Dan Rowe/.test(abClash.alert) && abClash.verdicts === 0 && abClash.live,
    `a clash keeps the card LIVE with the server's sentence, no verdict claimed (${abClash.alert})`);
  await page.evaluate(() => { window.__mcClash = false; });
  await page.click('.mc-act-go');
  await page.waitForTimeout(300);
  ok(await page.evaluate(() => /Booking added/.test((document.querySelector('.mc-act.is-done') || {}).textContent || '')
    && window.__mcReqs.filter((r) => r.a === 'chat_act_done' && r.b.verdict === 'done').length === 1),
    'with the clash gone the same card adds the booking and flips done');
  // SEND_ENQUIRY_REPLY: an enquiry no longer waiting is a DEAD card — the
  // sentence, never a dead button.
  await page.evaluate(() => {
    window.glassAlert = window.__realAlert;
    window.enquiries = [];
    window.apiPost = async (file, body) => {
      if (body.action === 'chat_thread') {
        return { ok: true, on: true, instr: '', presence: { seen: Math.floor(Date.now() / 1000), listening: true }, msgs: [
          { who: 'mac', text: 'Opening the reply.', at: '12:06', act: { kind: 'send_enquiry_reply', enquiry: 4242 } },
        ] };
      }
      return { ok: true };
    };
    return renderMacChat();
  });
  await page.waitForTimeout(250);
  ok(await page.evaluate(() => /no longer waiting/.test((document.querySelector('.mc-act.is-off') || {}).textContent || '')
    && !document.querySelector('.mc-act-go')),
    'a reply card whose enquiry has gone says so instead of offering a dead button');
  // THE HANDOFF (stage 2): search's dead-end row carries the question to the
  // AI chat WHOLE — it waits for the render's own ready stamp, then sends.
  await page.evaluate(() => {
    window.__hoSends = [];
    window.apiPost = async (file, body) => {
      if (body.action === 'chat_thread') { return { ok: true, on: true, msgs: [], instr: '', presence: { seen: Math.floor(Date.now() / 1000), listening: true } }; }
      if (body.action === 'chat_send') { window.__hoSends.push(body.text); return { ok: true, id: 95, presence: { listening: true } }; }
      if (body.action === 'chat_poll') { return new Promise(() => {}); }
      return { ok: true };
    };
    siteContent['night-shift'] = '1';
    nav('view-backoffice');
    const b = cmdkBuildResults('what is the meaning of life');
    const row = (b.results || []).find((r) => r.id === 'ask-mac');
    if (row) row.run();
  });
  await page.waitForTimeout(900);
  const hoDone = await page.evaluate(() => ({
    view: (document.querySelector('.page-view.active') || {}).id,
    sends: window.__hoSends,
    bub: /what is the meaning of life/.test(document.getElementById('mc-log').textContent),
  }));
  ok(hoDone.view === 'view-aichat' && hoDone.sends.length === 1
    && hoDone.sends[0] === 'what is the meaning of life' && hoDone.bub,
    `the handoff lands on AI chat with the question SENT, not retyped (${JSON.stringify(hoDone.sends)})`);
  await page.evaluate(() => { __mcStamp++; __mcBusy = false; mcSendMode(false); });
  // THE WELCOME CARRIES THE DAY (stage 3): duties render as the greeting card
  // with each duty's OWN route as its chip; a quiet day renders NOTHING; and
  // painting the card fires nothing.
  await page.evaluate(() => {
    window.__mcReqs2 = [];
    window.apiPost = async (file, body) => {
      window.__mcReqs2.push(body.action);
      if (body.action === 'chat_thread') { return { ok: true, on: true, msgs: [], instr: '', presence: { seen: Math.floor(Date.now() / 1000), listening: true } }; }
      return { ok: true };
    };
    window.__realDuties = window.chbDuties;
    window.chbDuties = () => [
      { label: 'Sarah Pemberton still owes £340.50', act: 'Chase', run: () => { window.__dayGo = (window.__dayGo || 0) + 1; } },
      { label: 'An enquiry is waiting on a reply', act: 'Open', run: () => {} },
    ];
    return renderMacChat();
  });
  await page.waitForTimeout(250);
  const dayOn = await page.evaluate(() => ({
    card: !!document.querySelector('.mc-day'),
    label: /Sarah Pemberton still owes £340.50/.test((document.querySelector('.mc-day') || {}).textContent || ''),
    chips: document.querySelectorAll('.mc-day-go').length,
    fired: window.__mcReqs2.filter((a) => a !== 'chat_thread'),
  }));
  ok(dayOn.card && dayOn.label && dayOn.chips === 2 && dayOn.fired.length === 0,
    `duties greet as the day card, chips ready, NOTHING fired on render (${JSON.stringify(dayOn)})`);
  await page.click('.mc-day-go');
  ok(await page.evaluate(() => window.__dayGo === 1), "a day chip runs the duty's own route");
  await page.evaluate(() => { window.chbDuties = () => []; return renderMacChat(); });
  await page.waitForTimeout(250);
  ok(await page.evaluate(() => !document.querySelector('.mc-day') && !!document.querySelector('.mc-hello')),
    'a QUIET day renders no card at all — the restraint is the design');
  await page.evaluate(() => { window.chbDuties = window.__realDuties; });
  // THE LIVE DRAFT OFFER (stage 1): opening a guest thread lays a fresh Mac
  // draft into an EMPTY reply box; a box the owner typed in is NEVER
  // clobbered — the draft is offered instead.
  await page.evaluate(() => {
    window.__draftAsks = [];
    window.apiPost = async (file, body) => {
      if (body.action === 'chat_draft') { window.__draftAsks.push(body.thread); return { ok: true, draft: 'Hello Rachel — yes, Jollyboat is completely dog-free.' }; }
      return { ok: true };
    };
    siteContent['night-shift'] = '1';
    window.__msgThreadId = 41;
    const inp = document.getElementById('messages-modal-input');
    if (inp) inp.value = '';
    document.getElementById('messages-modal').classList.add('open');
  });
  await page.waitForTimeout(400);
  const drA = await page.evaluate(() => ({
    asks: window.__draftAsks,
    box: (document.getElementById('messages-modal-input') || {}).value || '',
  }));
  ok(drA.asks.length === 1 && drA.asks[0] === 41 && /dog-free/.test(drA.box),
    `opening a guest thread lays the live draft into the empty box (${JSON.stringify(drA.asks)})`);
  // Typed text is never clobbered: a NEW thread with words already in the box.
  await page.evaluate(() => {
    const m = document.getElementById('messages-modal');
    m.classList.remove('open');
    document.getElementById('messages-modal-input').value = 'my own words';
    window.__msgThreadId = 42;
    m.classList.add('open');
  });
  await page.waitForTimeout(400);
  ok(await page.evaluate(() => (document.getElementById('messages-modal-input') || {}).value === 'my own words'),
    'a box the owner typed in is NEVER clobbered — the draft is offered instead');
  await page.evaluate(() => { document.getElementById('messages-modal').classList.remove('open'); });
  // The honest failures: a Mac that is not listening, and an expired ask.
  await page.evaluate(() => {
    window.apiPost = async (file, body) => {
      if (body.action === 'chat_send') { return { ok: true, id: 78, presence: { listening: false, seen: 0 } }; }
      if (body.action === 'chat_poll') { return { ok: true, status: 'expired', say: 'Your Mac didn’t answer in time — it may be asleep or mid-job.' }; }
      return { ok: true };
    };
  });
  await page.fill('#mc-in', 'and tomorrow?');
  await page.click('#mc-send');
  await page.waitForTimeout(400);
  const mcSleep = await page.evaluate(() => {
    const caps = document.querySelectorAll('#mc-log .mc-jcap');
    const last = caps[caps.length - 1];
    return { text: last ? last.textContent : '', warn: last ? last.className.includes('is-warn') : false };
  });
  ok(/asleep/.test(mcSleep.text) && mcSleep.warn,
    'a sleeping Mac is said in a warn capsule, never spun: ' + mcSleep.text);
  // The … sheet: where Clear went. Its New conversation asks first, and the
  // starters return with the fresh thread.
  await page.evaluate(() => { window.__chatEvCb = window.__chatEvCb; });
  await page.click('.ac-more');
  await page.waitForTimeout(150);
  ok(!(await page.evaluate(() => document.getElementById('ac-sheet').hidden)),
    'the … sheet opens with the quiet destructive actions');
  await page.evaluate(() => {
    window.apiPost = async (file, body) => {
      if (body.action === 'chat_clear') { return { ok: true }; }
      if (body.action === 'chat_thread') { return { ok: true, on: true, msgs: [], instr: '', presence: { seen: Math.floor(Date.now() / 1000), listening: true } }; }
      return { ok: true };
    };
    window.__realConfirm = window.glassConfirm;
    window.glassConfirm = async () => true;
  });
  await page.click('.ac-sheet-card button');
  await page.waitForTimeout(300);
  const mcFresh = await page.evaluate(() => ({
    sheetHidden: document.getElementById('ac-sheet').hidden,
    starters: document.querySelectorAll('#mc-log .mc-schip').length,
  }));
  ok(mcFresh.sheetHidden && mcFresh.starters === 3,
    `New conversation clears through the bridge and the welcome card returns with its starters (${JSON.stringify(mcFresh)})`);
  await page.evaluate(() => { window.glassConfirm = window.__realConfirm; });

  ok(pageErrors.length === 0, 'no page errors: ' + pageErrors.join(' | '));

  console.log(fails ? `\n${fails} CHECK(S) FAILED` : '\nall checks passed');
  await done(fails);
})();
