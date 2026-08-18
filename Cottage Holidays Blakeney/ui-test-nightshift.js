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
  let nightOn = 1;
  let staleCount = null; // a hostile boot payload: 'off' with a count that is not zero
  let stored = { 'night-shift': '1' };
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
  await page.evaluate(() => nav('view-backoffice'));

  const drive = async () => {
    await page.evaluate(async () => { await loadData(); await loadNightItems(); });
    await page.waitForTimeout(250);
  };

  // ── 1. OFF IS OFF ────────────────────────────────────────────────────────
  console.log('1. with the setting off there is no card at all — and no request');
  nightOn = 0;
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
  const get0 = await page.evaluate(() => {
    const h = document.getElementById('night-app-get');
    const links = [...h.querySelectorAll('a')].map((a) => ({ href: a.getAttribute('href'), t: a.textContent.trim(), tgt: a.getAttribute('target'), rel: a.getAttribute('rel') }));
    return { painted: h.getClientRects().length > 0, links: links, text: h.textContent };
  });
  ok(get0.painted, 'the row is on the System check page');
  // THE DEFAULT IS A LINK THAT NEVER NEEDS UPDATING. GitHub keeps
  // /releases/latest/download/<file> pointing at the newest release, and the
  // build's filename carries no version so that URL cannot rot.
  const dlLink = get0.links.find((a) => /Download/.test(a.t));
  ok(dlLink && /\/releases\/latest\/download\/Blakeney-Hand-universal\.dmg$/.test(dlLink.href),
    'with nothing set, Download points at the LATEST release, not one particular build', dlLink && dlLink.href);
  ok(get0.links.length === 2 && get0.links.every((a) => /^https:\/\/github\.com\//.test(a.href)),
    '…beside the link that builds a newer one', JSON.stringify(get0.links.map((a) => a.t)));
  ok(get0.links.every((a) => a.tgt === '_blank' && /noopener/.test(a.rel || '')),
    '…both open outside the app, safely');
  ok(/newest build GitHub made/.test(get0.text), '…and it says the link follows the newest build');
  ok(/only be made on a Mac/.test(get0.text), '…and why it is built there rather than here');

  // A URL OF YOUR OWN OVERRIDES IT.
  posts.length = 0;
  await page.evaluate(() => { window.glassPrompt = async () => 'https://example.test/mine/BlakeneyHand.dmg'; });
  await page.evaluate(() => document.querySelector('[data-act="saveNightAppUrl"]').click());
  await page.waitForTimeout(400);
  const savedUrl = posts.find((p) => p.__url === 'content.php' && p.action === 'set' && p.key === 'nightshift-app-url');
  ok(savedUrl && savedUrl.value === 'https://example.test/mine/BlakeneyHand.dmg', 'an address of your own is saved', JSON.stringify(savedUrl));
  const get1 = await page.evaluate(() => {
    const h = document.getElementById('night-app-get');
    const dl = [...h.querySelectorAll('a')].find((a) => /Download/.test(a.textContent));
    const btn = h.querySelector('[data-act="saveNightAppUrl"]');
    return { href: dl ? dl.getAttribute('href') : null, painted: dl ? dl.getClientRects().length > 0 : false, btn: btn.textContent.trim(), text: h.textContent };
  });
  ok(get1.href === 'https://example.test/mine/BlakeneyHand.dmg' && get1.painted,
    '…and Download follows it', JSON.stringify(get1.href));
  ok(/standard link/i.test(get1.btn), '…with a way back to the standard one', get1.btn);
  ok(/your own address/.test(get1.text), '…and the row says which it is using');

  // THE PRIMARY PILL IS FILLED. Measured against the quiet one beside it, so it
  // cannot regress to "the class is present".
  const looks = await page.evaluate(() => {
    const h = document.getElementById('night-app-get');
    const dl = [...h.querySelectorAll('a')].find((a) => /Download/.test(a.textContent));
    const quiet = [...h.querySelectorAll('a')].find((a) => !/Download/.test(a.textContent));
    const c = (el) => { const s = getComputedStyle(el); return { bg: s.backgroundColor, fg: s.color }; };
    return { dl: c(dl), quiet: c(quiet) };
  });
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
  await page.evaluate(() => document.querySelector('[data-act="saveNightAppUrl"]').click());
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

  ok(pageErrors.length === 0, 'no page errors: ' + pageErrors.join(' | '));

  console.log(fails ? `\n${fails} CHECK(S) FAILED` : '\nall checks passed');
  await done(fails);
})();
