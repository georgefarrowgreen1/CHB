// ONE LOOK ACROSS MANAGE (the approved "One look for Manage" demo), driven in a
// real browser. What is worth driving here rather than reading off the CSS:
//
//   §1 every Manage page's buttons are one of THREE kinds, with no old look
//      class left — oneLookButtons is a choke point, so a page that escapes it
//      is the defect (the email_dark_hooks rule);
//   §2 the back link NAMES where it goes, on every route that sets one;
//   §3 the menu: no Status row (the pill is the way in), the rare tools fold
//      under "More tools", and the rows carry no sub-lines;
//   §4 adding is a ROW at the foot of the list it adds to, never a pill among
//      the actions;
//   §5 every field in the place editor has a label of its own;
//   §6 a window opened from Manage is a bottom sheet on a phone — and the same
//      window on the guest side is untouched (the scope is the point);
//   §7 one caption tier on Manage, the old tracked capitals left alone outside it;
//   §8 Payments and Key safes joined: tools as rows, one caption tier, a back link
//      that names Payments, an expense as one line in one card (its rows were
//      wearing the guest Things-to-do class, whose display:flex broke the grid);
//   §9 the Inbox joined: no sentence under the title, one chevron, the conversations
//      one list card under one search with chips, and two verdicts that no longer
//      claim more than they know (a read-but-unanswered chat, a mailbox that failed);
//  §10 the booking and enquiry pages joined: a back link naming its screen, cards on the
//      one radius, the one caption tier, sentence-case tags, Approve a filled pill;
//  §11 Today joined: the one switcher, the Bookings caption on its count's line, and the
//      booking window's one action the accent pill;
//  §12 small parts: a guest's other stays as one inset list with the drawn chevron, an
//      action link's chevron drawn too, and the message search at the one field height;
//  §13 the last stragglers: every remaining "›" / "❮ ❯" glyph is the drawn chevron, both
//      hubs' call / email / ⋯ are one outlined circle, the card's second choice is
//      outlined, the enquiry quote sits in the inset panel, the conversation sheet takes the
//      window's title and the one field;
//  §14 the booking form and the email composer are bottom sheets on a phone with the window's parts;
//  §15 the offline day sheet wears the online Today's parts (no rail, joined runs, capsules, corners);
//  §16 every page states its status the Manage way: ONE pill, the Manage pill's own look, right of the
//      title on its line — Today, Key safes, Payments, the Activity log and the Manage pages that carry
//      one — and none of the three looks it replaced (a card row, green words, a tinted panel) is left.
//  §17 a list is ONE window (the Payments "Needs attention" shape): Calendar sync's cottages, Key safes'
//      to-dos, the cottage page's own controls, the newest expenses list and its add row, a loading list,
//      and both hubs (attention above the money; the enquiry's message heading the quote's card).
const { bootBrowser } = require('./ui-test-lib'); // pins TZ=Europe/London at require time
let fails = 0;
const ok = (b, m) => { console.log(`  ${b ? '✓' : '✗'} ${m}`); if (!b) fails++; };
const OLD = ['btn-sm', 'btn-edit', 'btn-delete', 'btn-glass', 'btn-accent', 'pay-btn', 'pay-btn2', 'mod-ok', 'mod-no', 'rv-act', 'rv-copy', 'ana-export', 'sp-again', 'mo-tool', 'sp-on', 'cal-all', 'rvi-add', 'sp-fix', 'ga-link', 'ga-photolink'];

// §16 serves its owing booking through the fixture, so a background refresh keeps it.
let liveBookings = [];
async function open(browser, base, width) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  page.on('pageerror', (e) => { console.log('  PAGEERR:', e.message); fails++; });
  await page.addInitScript(() => { if (navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(() => {}); try { localStorage.setItem('chb-theme', 'dark'); } catch (e) {} });
  await page.route(/\.php/, (route) => {
    const url = route.request().url();
    const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    let b = {}; try { b = JSON.parse(route.request().postData() || '{}'); } catch (e) {}
    if (url.includes('experiences.php')) return json({ ok: true, experiences: [
      { id: 7, status: 'published', title: 'Blakeney Point seal trips', category: 'Boat trips & wildlife', body: 'Seals.', image_url: '' },
      { id: 8, status: 'published', title: 'Cley Marshes', category: 'Walks & nature', body: 'Birds.', image_url: '' },
    ] });
    if (url.includes('rates.php')) return json({ properties: [
      { prop_key: '21a', name: '21A Westgate', slug: '21a', couple_rate: 130, extra_adult_rate: 0, child_rate: 0, booking_fee: 50, transaction_pct: 0, lastmin_pct: 0, lastmin_days: 0, max_adults: 2, max_children: 0, max_total: 2, sort_order: 1 },
      { prop_key: 'jollyboat', name: 'Jollyboat', slug: 'jollyboat', couple_rate: 150, extra_adult_rate: 0, child_rate: 0, booking_fee: 50, transaction_pct: 0, lastmin_pct: 0, lastmin_days: 0, max_adults: 2, max_children: 0, max_total: 2, sort_order: 2 },
    ], seasons: {}, occupancy: {} });
    if (url.includes('reviews.php')) return json({ ok: true, reviews: [{ id: 1, status: 'pending', prop: '21a', name: 'Margaret', text: 'Lovely.' }] });
    if (url.includes('ical-import.php') && b.action === 'overview') return json({ ok: true, props: { '21a': { feeds: [], status: { sources: {} } }, jollyboat: { feeds: [], status: { sources: {} } } } });
    if (url.includes('ical-import.php')) return json({ ok: true, feeds: [], blocks: [] });
    if (url.includes('activity-log.php') && b.action === 'summary') return json({ ok: true, total: 3, needs: [], days: Array.from({ length: 7 }, (_, i) => ({ date: '2026-10-0' + (i + 1), n: i % 2, warn: 0 })) });
    if (url.includes('keysafe.php')) return json({ ok: true, safes: { '21a': { code: '4821', setAt: '2026-09-01T10:00:00Z', forBooking: 0, history: [], enabled: true }, 'jollyboat': { code: '', history: [], enabled: true } }, revealDays: 2 });
    if (route.request().method() === 'POST' && b.action === 'admin_status') return json({ ok: true, admin: true });
    return json({ ok: true, bookings: liveBookings, enquiries: [], threads: [], events: [], logs: {}, content: {}, blocks: [], ranges: [], payments: [], seasons: {}, occupancy: {}, properties: [], waitlist: [], photos: [] });
  });
  await page.goto(`${base}/index.html`, { waitUntil: 'domcontentloaded' });
  // Nothing in this suite navigates after the first load, so a second load is a defect to NAME:
  // CI once lost the page mid-§16 ("execution context was destroyed") with no clue what moved it.
  // ('load', not 'framenavigated': history.pushState fires the latter on every screen change.)
  await page.waitForLoadState('load').catch(() => {});
  page.on('load', () => { console.log('  ✗ the page reloaded mid-suite:', page.url()); fails++; });
  await page.waitForTimeout(1200);
  await page.evaluate(() => { isAuthenticated = true; document.body.classList.add('owner-mode'); });
  await page.evaluate(() => window.loadAdminBundle());
  await page.waitForTimeout(700);
  await page.evaluate(async () => { await loadData(); await openArea(); });
  await page.waitForTimeout(800);
  return page;
}

(async () => {
  const t = await bootBrowser();
  const page = await open(t.browser, t.base, 390);

  console.log('§1 every Manage button is one of three kinds');
  const SECS = ['payments', 'reviews', 'follow-ups', 'sms', 'experiences', 'newsletter', 'backups', 'apis', 'calendar', 'content', 'cancel', 'seasongrid'];
  const seen = { kinds: 0, old: [] };
  for (const sec of SECS) {
    await page.evaluate((s) => settingsOpen(s), sec);
    await page.waitForTimeout(350);
    const r = await page.evaluate((OLD) => {
      const v = document.getElementById('view-settings');
      const old = [...v.querySelectorAll('button, a.btn-sm')].filter((b) => OLD.some((c) => b.classList.contains(c))).map((b) => b.className + ' "' + b.textContent.trim().slice(0, 20) + '"');
      return { old, kinds: v.querySelectorAll('.u-btn1, .u-btn2, .u-btn3').length };
    }, OLD);
    seen.kinds += r.kinds;
    r.old.forEach((x) => seen.old.push(sec + ': ' + x));
  }
  ok(seen.kinds >= 30, `the pages' buttons carry one of the three kinds (${seen.kinds} across ${SECS.length} pages; vacuity guard)`);
  ok(seen.old.length === 0, `no button keeps an old look class${seen.old.length ? ' — ' + seen.old.slice(0, 4).join(' · ') : ''}`);
  const kinds = await page.evaluate(async () => {
    const tick = () => new Promise((r) => setTimeout(r, 30)); // the kinds land on the observer's microtask
    settingsOpen('backups');
    await tick();
    const up = [...document.querySelectorAll('#backups-body button')].find((b) => /^Back up now$/.test(b.textContent.trim()));
    const ver = [...document.querySelectorAll('#backups-body button')].find((b) => /^Verify latest$/.test(b.textContent.trim()));
    return { up: up && up.className, ver: ver && ver.className };
  });
  ok(/u-btn1/.test(kinds.up || '') && /u-btn2/.test(kinds.ver || ''), `Back up now is the accent, Verify latest outlined (${kinds.up} / ${kinds.ver})`);
  // The kind lands on a button a renderer adds LATER, not only on the first paint.
  const late = await page.evaluate(async () => {
    settingsOpen('backups');
    const b = document.createElement('button'); b.className = 'btn-sm btn-edit'; b.textContent = 'Save later'; document.getElementById('backups-body').appendChild(b);
    await new Promise((r) => setTimeout(r, 30));
    return b.className;
  });
  ok(late === 'u-btn1', `a button painted after the page opened is given its kind too (${late})`);

  console.log('§2 the back link names where it goes');
  const backs = await page.evaluate(async () => {
    const w = () => new Promise((r) => setTimeout(r, 250));
    const t = () => document.getElementById('settings-back').textContent.trim();
    const o = {};
    settingsOpen('payments'); await w(); o.payments = t();
    settingsOpen('reviews-import'); await w(); o.importBack = t();
    settingsOpenCancel('21a'); await w(); o.cancel21 = t();
    settingsOpen('pricing'); await w(); o.pricing = t(); o.pricingTitle = document.getElementById('settings-panel-title').textContent;
    prOpenCosts(); await w(); o.costs = t(); o.costsTitle = document.getElementById('settings-panel-title').textContent; o.costsCap = document.getElementById('settings-panel-cap').textContent;
    o.oneBack = document.querySelectorAll('#pricing-body .pr-up, #pricing-body .pr-ptitle').length === 0;
    settingsBack(); await w(); o.afterCosts = document.getElementById('settings-panel-title').textContent;
    return o;
  });
  ok(backs.payments === 'Manage', `a page off the menu goes back to "Manage" (${backs.payments})`);
  ok(backs.importBack === 'Reviews', `a sub-page names its parent (${backs.importBack})`);
  ok(backs.cancel21 === 'Cancellation policy', `a cottage's policy goes back to "Cancellation policy" (${backs.cancel21})`);
  ok(backs.pricingTitle === 'Price ideas' && backs.pricing === 'Manage', `the page is named as its menu row (${backs.pricingTitle})`);
  ok(backs.costs === 'Price ideas' && backs.costsTitle === 'Changeovers' && backs.oneBack && !backs.costsCap, `Changeovers has ONE header: "‹ Price ideas" over its own title, no ideas badge (${backs.costs} / ${backs.costsTitle})`);
  ok(backs.afterCosts === 'Price ideas', `…and its back link returns to Price ideas (${backs.afterCosts})`);

  console.log('§3 the menu');
  const menu = await page.evaluate(async () => {
    settingsShowIndex();
    const idx = document.getElementById('settings-index');
    const row = document.getElementById('mt-row');
    const fold = document.getElementById('mt-fold');
    const before = { hidden: fold.hidden, exp: row.getAttribute('aria-expanded') };
    row.click();
    await new Promise((r) => setTimeout(r, 50));
    const after = { hidden: fold.hidden, exp: row.getAttribute('aria-expanded'), inside: [...fold.querySelectorAll('.settings-row')].map((r) => r.dataset.arg || r.id).join(',') };
    row.click();
    return {
      status: !!idx.querySelector('[data-arg="diagnostics"]'),
      subs: [...idx.querySelectorAll(':scope > .settings-group .settings-row-sub')].filter((s) => !s.closest('.mg-cot') && s.id !== 'oa-index-sub').length,
      cotFig: idx.querySelectorAll('.mg-fig').length,
      before, after, closed: fold.hidden,
      names: ['seasongrid', 'pricing', 'guests'].map((a) => (idx.querySelector(`[data-arg="${a}"] .settings-row-label`) || {}).textContent),
    };
  });
  ok(!menu.status, 'no Status row: the pill beside the title is the way in');
  ok(menu.subs === 0 && menu.cotFig === 0, `a menu row says where it goes and nothing more (${menu.subs} sub-lines, ${menu.cotFig} booked figures)`);
  ok(menu.before.hidden && menu.before.exp === 'false' && !menu.after.hidden && menu.after.exp === 'true' && menu.closed, 'More tools opens and closes in place, saying so');
  ok(/backups/.test(menu.after.inside) && /apis/.test(menu.after.inside) && /search-learning/.test(menu.after.inside), `…holding Backups, Integrations and Search learning (${menu.after.inside})`);
  ok(menu.names.join('|') === 'Seasonal rates|Price ideas|Guest list', `three rows renamed for what the page is (${menu.names.join(' · ')})`);

  console.log('§4 adding is a row at the foot of its list');
  const adds = await page.evaluate(async () => {
    settingsOpen('experiences');
    await new Promise((r) => setTimeout(r, 400));
    const list = document.getElementById('exp-admin-list');
    const expAdd = list && list.lastElementChild && list.lastElementChild.querySelector('.u-addrow[data-act="expAddNew"]');
    settingsOpenAccom('21a');
    __bhubOpenFolds.add('ac-21a-amenities');
    settingsOpenAccom('21a');
    const well = document.querySelector('#bhub-fold-ac-21a-amenities .acr-well');
    const kids = well ? [...well.children] : [];
    const ai = kids.findIndex((x) => x.matches('.u-addrow'));
    const si = kids.findIndex((x) => x.matches('.acw-acts'));
    const pillAdds = [...document.querySelectorAll('#view-settings button')].filter((b) => /^Add (a|an|another|something)\b/.test(b.textContent.trim()) && !b.matches('.u-addrow, .settings-row, .ga-row')).map((b) => b.textContent.trim());
    return { expAdd: !!expAdd, order: ai >= 0 && si > ai, pillAdds };
  });
  ok(adds.expAdd, 'Things to do: "Add something to do" closes the list');
  ok(adds.order, 'a cottage list: the add row sits under the list, above the Save actions');
  ok(adds.pillAdds.length === 0, `no "Add …" pill is left among a page's actions${adds.pillAdds.length ? ' — ' + adds.pillAdds.join(', ') : ''}`);

  console.log('§5 every field has a label');
  const fields = await page.evaluate(async () => {
    settingsOpen('experiences');
    await new Promise((r) => setTimeout(r, 400));
    expAddNew();
    const ed = document.querySelector('.exp-edit[data-id="0"]');
    const fs = [...ed.querySelectorAll('input:not([type=hidden]), select, textarea')];
    const unlabelled = fs.filter((f) => !ed.querySelector(`label[for="${f.id}"]`)).map((f) => f.id);
    const firstAct = ed.querySelector('.u-acts > button');
    return { n: fs.length, unlabelled, first: firstAct && firstAct.textContent.trim(), thumbW: Math.round(ed.querySelector('.exp-edit-thumb').getBoundingClientRect().width) };
  });
  ok(fields.n >= 8 && fields.unlabelled.length === 0, `the place editor's ${fields.n} fields each have their own label${fields.unlabelled.length ? ' — missing: ' + fields.unlabelled.join(', ') : ''}`);
  ok(fields.first === 'Save' && fields.thumbW === 64, `its actions lead with Save, and the photo keeps its square (${fields.first}, ${fields.thumbW}px)`);

  console.log('§6 windows: a bottom sheet in Manage, untouched outside it');
  const inManage = await page.evaluate(async () => {
    settingsOpen('payments');
    const p = glassConfirm('Delete this?', 'Delete', { danger: true });
    await new Promise((r) => setTimeout(r, 600));
    const box = document.querySelector('#glass-dialog .glass-dialog-box').getBoundingClientRect();
    const ok = document.getElementById('glass-dialog-ok');
    const out = { bottom: Math.round(innerHeight - box.bottom), width: Math.round(box.width), okRadius: parseFloat(getComputedStyle(ok).borderTopLeftRadius) };
    document.getElementById('glass-dialog-cancel').click();
    await p;
    await new Promise((r) => setTimeout(r, 450));
    return out;
  });
  ok(Math.abs(inManage.bottom) <= 1 && inManage.width >= 388 && inManage.okRadius > 100, `opened from Manage it sits on the bottom edge, full width, pill buttons (${inManage.bottom}px from the bottom, ${inManage.width}px)`);
  // Every back-office screen wears the one look now (and an owner is always sent to one), so
  // the scope is proven where it must NOT reach: the same window on the GUEST side.
  const outside = await page.evaluate(async () => {
    document.body.classList.remove('owner-mode');
    const p = glassConfirm('Sign out?', 'Sign out');
    await new Promise((r) => setTimeout(r, 600));
    const box = document.querySelector('#glass-dialog .glass-dialog-box').getBoundingClientRect();
    const out = { bottom: Math.round(innerHeight - box.bottom) };
    document.getElementById('glass-dialog-cancel').click();
    await p;
    await new Promise((r) => setTimeout(r, 450));
    document.body.classList.add('owner-mode');
    await openArea();
    return out;
  });
  ok(outside.bottom > 40, `the same window on the guest side keeps its own shape (${outside.bottom}px clear of the bottom)`);
  const qr = await page.evaluate(async () => {
    settingsOpen('reviews');
    await new Promise((r) => setTimeout(r, 300));
    reviewQrOpen('21a');
    await new Promise((r) => setTimeout(r, 500));
    const ov = document.getElementById('rv-qr-modal');
    const out = { btns: [...ov.querySelectorAll('button')].map((b) => b.textContent.trim()).join('|'), noX: !ov.querySelector('.rvq-close'), copy: (ov.querySelector('#rvq-copy') || {}).getAttribute && ov.querySelector('#rvq-copy').getAttribute('data-act') };
    reviewQrClose();
    return out;
  });
  ok(qr.btns === 'Done|Copy link' && qr.noX && qr.copy === 'copyReviewLink', `the QR window ends in its answers, not a corner ✕ (${qr.btns})`);

  console.log('§7 one caption tier on Manage, nothing changed outside it');
  const caps = await page.evaluate(async () => {
    settingsOpen('follow-ups');
    const m = document.querySelector('#sec-follow-ups .acr-cap');
    const inside = { tt: getComputedStyle(m).textTransform, ls: getComputedStyle(m).letterSpacing };
    // The same class outside the back office's one look (a guest view) keeps the
    // look it had — the scope is the class on the admin views, never the page.
    const probe = document.createElement('div'); probe.className = 'acr-cap'; probe.textContent = 'Probe';
    document.getElementById('view-main').appendChild(probe);
    const outside = { tt: getComputedStyle(probe).textTransform };
    probe.remove();
    return { inside, outside };
  });
  ok(caps.inside.tt === 'none' && (caps.inside.ls === 'normal' || parseFloat(caps.inside.ls) === 0), `on Manage a caption is sentence case, untracked (${caps.inside.tt} / ${caps.inside.ls})`);
  ok(caps.outside.tt === 'uppercase', `outside the one look the same class keeps its own look (${caps.outside.tt})`);

  console.log('§8 Payments and Key safes wear the same parts');
  const pay = await page.evaluate(async () => {
    await openAccounts();
    await new Promise((r) => setTimeout(r, 600));
    const idx = document.getElementById('accounts-index');
    const tools = [...idx.querySelectorAll(':scope > .settings-group > .settings-row .settings-row-label')].map((r) => r.textContent.trim());
    const cap = [...document.querySelectorAll('#accounts-index .bhub-grpcap')].filter((c) => c.getClientRects().length).map((c) => getComputedStyle(c).textTransform);
    // Expenses: one card per tax year, a line per expense, and adding is the row at the foot.
    allExpenses.splice(0, allExpenses.length,
      { id: 1, date: '2026-10-02', category: 'Laundry', description: 'Linen hire for the changeover', amount: 42.5, prop_key: '21a', recurring: 0 },
      { id: 2, date: '2026-09-28', category: 'Cleaning', description: 'Changeover clean', amount: 85, prop_key: '', recurring: 1 });
    accountsOpen('expenses');
    renderExpenses();
    await new Promise((r) => setTimeout(r, 300));
    const rows = [...document.querySelectorAll('#expenses-body .xp-row')];
    const r0 = rows[0];
    const main = r0 && r0.querySelector('.xp-main').getBoundingClientRect();
    const amt = r0 && r0.querySelector('.feed-amt').getBoundingClientRect();
    const back = document.getElementById('accounts-back').textContent.trim();
    const add = document.querySelector('#expenses-body .xp-add .u-addrow');
    const kinds = [...document.querySelectorAll('#view-accounts button')].filter((b) => b.getClientRects().length && ['btn-sm', 'btn-edit', 'btn-glass', 'pay-btn', 'mo-tool'].some((c) => b.classList.contains(c))).length;
    await openKeysafe();
    await new Promise((r) => setTimeout(r, 400));
    const ks = document.querySelector('#view-keysafe .ks-list');
    return {
      tools, cap, back, rows: rows.length, oneLine: !!(main && amt && Math.abs((main.top + main.bottom) / 2 - (amt.top + amt.bottom) / 2) < 12),
      rowDisplay: r0 ? getComputedStyle(r0).display : '', add: !!add, kinds,
      ksRadius: ks ? getComputedStyle(ks).borderTopLeftRadius : '', ksShadow: ks ? getComputedStyle(ks).boxShadow : '',
    };
  });
  ok(pay.tools.join('|') === 'Payments & balances|Expenses', `the Payments tools are rows in a card, like the Manage index (${pay.tools.join(' · ')})`);
  ok(pay.cap.length >= 1 && pay.cap.every((t) => t === 'none'), `Payments' captions are the one tier, sentence case (${pay.cap.join(',')})`);
  ok(pay.back === 'Payments', `the drill-down back link names where it goes ("${pay.back}")`);
  ok(pay.rows === 2 && pay.rowDisplay === 'flex' && pay.oneLine, `an expense is one line: what it was, then its amount beside it (${pay.rows} rows, ${pay.rowDisplay})`);
  ok(pay.add, 'adding an expense is the row at the foot of the list');
  ok(pay.kinds === 0, `no Payments button keeps an old look class (${pay.kinds})`);
  ok(pay.ksRadius === '20px' && pay.ksShadow === 'none', `the key safes list is a card on the one radius, no shadow (${pay.ksRadius}, ${pay.ksShadow})`);

  console.log('§9 the Inbox wears the same parts');
  // The mailbox answers with an error, so the Email verdict's failed state is driven for real.
  await page.route(/mailbox\.php/, (route) => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Connect failed' }) }));
  const ib = await page.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    await openInbox();
    await wait(400);
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    // A conversation already READ but still waiting on a reply, beside one that was answered.
    __msgThreads = [
      { thread_id: 'a1', name: 'Priya Shah', email: 'p@example.com', last_body: 'Can we check in early?', last_at: now, last_role: 'guest', unread: 0, archived: 0, is_guest: 1 },
      { thread_id: 'b2', name: 'Mark Ellis', email: 'm@example.com', last_body: 'No dogs, sorry.', last_at: now, last_role: 'admin', unread: 0, archived: 0, is_guest: 0 },
    ];
    const fixture = __msgThreads;
    __msgShowArchived = false;
    inboxFolder('messages');
    const opener = document.querySelector('#inbox-landing .bhub-fold-row[data-arg="messages"]');
    if (opener && (document.getElementById('iv-fold-messages') || {}).hidden) opener.click();
    // The Inbox's own message fetch can land after the fixture under load and repaint the
    // list; re-lay it until the rendered list is really the fixture's.
    for (let k = 0; k < 5; k++) {
      __msgThreads = fixture;
      document.getElementById('messages-list').dataset.loaded = '1';
      renderMessagesList();
      inboxVerdicts();
      await wait(150);
      if (document.getElementById('msg-search') && document.querySelectorAll('#messages-list .msg-thread-row').length === 2) break;
    }
    const list = document.getElementById('messages-list');
    const cards = list.querySelectorAll('.msg-threads');
    const rowsIn = cards[0] ? cards[0].querySelectorAll('.msg-thread-row').length : 0;
    const search = document.getElementById('msg-search').getBoundingClientRect();
    const ctl = list.querySelector('.msg-inbox-controls').getBoundingClientRect();
    const chips = [...list.querySelectorAll('.msg-chips button')].map((b) => b.textContent.trim());
    const head = document.getElementById('messages-head-actions').children.length;
    const verdict = document.getElementById('iv-sum-messages').textContent.trim();
    const chev = [...document.querySelectorAll('#inbox-landing .bhub-fold-row .bhub-chev')];
    const chevSvg = chev.filter((c) => c.querySelector('svg')).length;
    // The archive is a chip; an empty archive keeps a way back beside the heading.
    const arch = [...list.querySelectorAll('.msg-chips button')].find((b) => /^Archived$/.test(b.textContent.trim()));
    __msgShowArchived = true;
    __msgThreads = [];
    renderMessagesList();
    await wait(60);
    const back = document.getElementById('messages-head-actions').textContent.trim();
    __msgShowArchived = false;
    // Email: a mailbox that did not answer has not been checked.
    inboxFolder('email');
    await wait(900);
    const email = document.getElementById('iv-sum-email').textContent.trim();
    return {
      subline: !!document.getElementById('inbox-subline'), cards: cards.length, rowsIn,
      searchFull: Math.round(search.width) >= Math.round(ctl.width) - 1, chips, head, verdict,
      chev: chev.length, chevSvg, archPressed: arch ? arch.getAttribute('aria-pressed') : '', back, email,
    };
  });
  ok(!ib.subline, 'no sentence under the Inbox title');
  ok(ib.chev >= 3 && ib.chevSvg === ib.chev, `every folder row ends in the one chevron (${ib.chevSvg} of ${ib.chev} are the drawn chevron)`);
  ok(ib.cards === 1 && ib.rowsIn === 2, `the conversations are one list card (${ib.cards} card, ${ib.rowsIn} rows inside)`);
  ok(ib.searchFull, 'the search is the one field, on its own line');
  ok(ib.chips.join('|') === 'Needs reply · 1|Archived|Mark all read', `the filters are chips under it, the action last (${ib.chips.join(' · ')})`);
  ok(ib.head === 0, 'with conversations on screen the heading carries no second archive control');
  ok(ib.archPressed === 'false', `the archive chip says whether it is on (aria-pressed ${ib.archPressed})`);
  ok(/Active conversations/.test(ib.back), `an empty archive keeps the way back beside the heading ("${ib.back}")`);
  ok(/1 to answer/.test(ib.verdict), `a conversation read but not answered keeps the folder amber ("${ib.verdict}")`);
  ok(/couldn.t check/i.test(ib.email) && !/Nothing new/.test(ib.email), `a mailbox that did not answer is not "Nothing new" ("${ib.email}")`);
  const focus = await page.evaluate(async () => {
    openMessageThread('a1');
    await new Promise((r) => setTimeout(r, 500));
    const a = document.activeElement;
    const r = { id: a && a.id, box: !!(a && a.matches('#messages-modal .modal-box')) };
    try { closeMessagesModal(); } catch (e) {}
    return r;
  });
  ok(focus.box && focus.id !== 'msg-canned', `the thread sheet takes focus itself, not the quick-replies picker (${focus.id || (focus.box ? 'the sheet' : '?')})`);

  console.log('§10 the booking and enquiry pages wear the same parts');
  const hub = await page.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const iso = (n) => { const x = new Date(); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
    const raw = { id: 91, prop_key: '21a', name: 'Priya Chandra', email: 'priya@example.com', phone: '07700 900000', address: '1 Lane', postcode: 'NR25 7AB',
      check_in: iso(40), check_out: iso(44), check_in_time: '15:00', check_out_time: '10:00', adults: 2, children: 0, payment: 'unpaid', deposit_paid: 0,
      agreed_total: 590, agreed_per_night: 135, agreed_nights: 4, agreed_nightly: 540, agreed_booking_fee: 50, agreed_txn_pct: 0, agreed_txn_fee: 0,
      agreed_on: iso(0), hold_status: 'none', deposit_pct_override: 30, reg_url: 'guest-details.php?t=x', reg_submitted: 0 };
    // Every screen change may reload the stores from the stub, so the fixture is laid down
    // again immediately before each open.
    const seed = () => { dbBookings['21a'] = [mapBookingFromApi(raw)]; };
    seed();
    const enq = { id: 92, prop_key: '21a', name: 'Grace Holloway', email: 'grace@example.com', phone: '',
      address: '2 Lane', postcode: 'NR25 7AB', check_in: iso(60), check_out: iso(63), check_in_time: '15:00', check_out_time: '10:00', adults: 2, children: 0,
      message: 'Is the cottage free?', created_at: iso(-1) + ' 09:00:00' };
    const back = () => ((document.querySelector('.page-view.active > .back-link') || {}).textContent || '').trim();
    // The back link names the screen it returns to.
    await openAccounts();
    await wait(300);
    seed();
    await openBookingHub(91);
    await wait(500);
    const fromPay = back();
    nav('view-backoffice');
    await wait(200);
    // Under load a background refresh can land mid-open and blank the hub; wait on STATE.
    const c = document.getElementById('booking-hub-content');
    for (let k = 0; k < 5; k++) {
      seed();
      await openBookingHub(91);
      await wait(500);
      if (/Priya/.test(c.textContent) && c.querySelector('.bhub-grpcap')) break;
    }
    const fromToday = back();
    const grp = [...c.querySelectorAll('.bhub-fold-grp')].find((g) => g.getClientRects().length);
    const cap = c.querySelector('.bhub-grpcap');
    const tag = c.querySelector('.bhub-plan-tag');
    const out = {
      fromPay, fromToday,
      radius: grp ? getComputedStyle(grp).borderTopLeftRadius : '',
      cap: cap ? cap.textContent.trim() + ' / ' + getComputedStyle(cap).textTransform : '',
      tag: tag ? tag.textContent.trim() + ' / ' + getComputedStyle(tag).textTransform : '',
    };
    enquiries.splice(0, enquiries.length, mapEnquiryFromApi(enq));
    await openEnquiryHub('e92');
    await wait(600);
    const okv = getComputedStyle(document.body).getPropertyValue('--ok').trim();
    const probe = document.createElement('span'); probe.style.color = okv; document.body.appendChild(probe);
    const okRgb = getComputedStyle(probe).color; probe.remove();
    const appr = document.querySelector('#enquiry-hub-content .bhub-next .btn-approve');
    const card = document.querySelector('#enquiry-hub-content .bhub-next');
    out.enqBack = back();
    out.approve = appr ? { bg: getComputedStyle(appr).backgroundColor, okRgb, h: Math.round(appr.getBoundingClientRect().height), full: appr.getBoundingClientRect().width >= card.getBoundingClientRect().width - 48 } : null;
    return out;
  });
  ok(hub.fromPay === 'Payments' && hub.fromToday === 'Today', `the booking page's back link names where it goes ("${hub.fromPay}", "${hub.fromToday}")`);
  ok(hub.enqBack === 'Inbox', `…and the enquiry page's ("${hub.enqBack}")`);
  ok(hub.radius === '20px', `its groups are cards on the one radius (${hub.radius})`);
  ok(/^Needs attention \/ none$/.test(hub.cap), `its caption is the one tier, sentence case (${hub.cap})`);
  ok(/^Custom \/ none$/.test(hub.tag), `a state tag is sentence case (${hub.tag})`);
  ok(hub.approve && hub.approve.bg === hub.approve.okRgb && hub.approve.h >= 48 && hub.approve.full,
    `on a phone Approve is the card's filled pill, in its own green (${JSON.stringify(hub.approve)})`);

  console.log('§11 Today and the booking window wear the same parts');
  const today = await page.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    nav('view-backoffice');
    await wait(400);
    const accRgb = (() => { const p = document.createElement('span'); p.style.color = getComputedStyle(document.body).getPropertyValue('--accent').trim(); document.body.appendChild(p); const c = getComputedStyle(p).color; p.remove(); return c; })();
    const on = document.querySelector('#bookings-filters .inbox-sort-btn.is-on');
    const cap = document.querySelector('#bookings-main .bk-caprow .bo-sec-title').getBoundingClientRect();
    const sum = document.querySelector('#bookings-main .bk-caprow').getBoundingClientRect();
    openAddBooking();
    await wait(500);
    const save = document.getElementById('modal-save-btn');
    const out = {
      accRgb, tab: on ? getComputedStyle(on).backgroundColor : '',
      // The caption sits on its row's own centre line, beside the count and the switcher.
      capRow: Math.abs((cap.top + cap.bottom) / 2 - (sum.top + sum.bottom) / 2),
      sumW: sum.width,
      save: save ? getComputedStyle(save).backgroundColor : '',
    };
    try { closeModal(); } catch (e) {}
    return out;
  });
  ok(today.tab === today.accRgb, `Today's Upcoming|Past is the one switcher, the chosen side in the accent (${today.tab})`);
  ok(today.sumW > 0 && today.capRow <= 4, `the Bookings caption sits on its row's centre line, beside its count (${today.capRow.toFixed(1)}px off)`);
  ok(today.save === today.accRgb, `the booking window's one action is the accent pill (${today.save})`);

  console.log('§12 the small parts the audit found');
  const small = await page.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const iso = (n) => { const x = new Date(); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
    const mk = (id, ci, co) => mapBookingFromApi({ id, prop_key: '21a', name: 'Sofia Laurent', email: 'sofia@example.com', phone: '07700 900001', address: '1 Lane', postcode: 'NR25 7AB',
      check_in: iso(ci), check_out: iso(co), check_in_time: '15:00', check_out_time: '10:00', adults: 2, children: 0, payment: 'paid', deposit_paid: 440,
      agreed_total: 440, agreed_per_night: 130, agreed_nights: 3, agreed_nightly: 390, agreed_booking_fee: 50, agreed_txn_pct: 0, agreed_txn_fee: 0, agreed_on: iso(0), hold_status: 'none' });
    nav('view-backoffice');
    await wait(200);
    // A background data refresh can replace dbBookings mid-open under load (the §10
    // race), leaving an empty hub. Wait on STATE: re-seed and re-open until the hub
    // is really showing the seeded guest with her other stays.
    const c = document.getElementById('booking-hub-content');
    for (let k = 0; k < 5; k++) {
      dbBookings['21a'] = [mk(95, 30, 33), mk(96, -40, -37), mk(97, -90, -87)];
      await openBookingHub(95);
      await wait(400);
      if ((document.getElementById('bhub-fold-guest') || {}).hidden) bhubFoldToggle('guest');
      await wait(450);
      if (/Sofia/.test(c.textContent) && c.querySelector('.bhub-stays-cap')) break;
    }
    const list = c.querySelector('.bhub-stays');
    const rows = list ? [...list.querySelectorAll('.bhub-stay-row')] : [];
    const cap = (c.querySelector('.bhub-stays-cap') || {}).textContent || '';
    const act = c.querySelector('.bhub-actlink');
    const actAfter = act ? getComputedStyle(act, '::after') : null;
    const out = {
      cap, rows: rows.length, chev: rows.every((r) => r.querySelector('.bhub-chev') && !/open →/.test(r.textContent)),
      inset: list ? getComputedStyle(list).borderTopLeftRadius : '', rowBorder: rows[0] ? getComputedStyle(rows[0]).borderTopWidth : '',
      seam: rows[1] ? getComputedStyle(rows[1]).borderTopWidth : '',
      actGlyph: actAfter ? actAfter.content : '', actMask: actAfter ? (actAfter.maskImage || actAfter.webkitMaskImage || '') : '',
    };
    await openInbox();
    await wait(300);
    inboxFolder('messages');
    const opener = document.querySelector('#inbox-landing .bhub-fold-row[data-arg="messages"]');
    if (opener && (document.getElementById('iv-fold-messages') || {}).hidden) opener.click();
    __msgThreads = [{ thread_id: 'a1', name: 'Priya Shah', email: 'p@example.com', last_body: 'Hi', last_at: new Date().toISOString().slice(0, 19).replace('T', ' '), last_role: 'guest', unread: 0, archived: 0, is_guest: 1 }];
    document.getElementById('messages-list').dataset.loaded = '1';
    renderMessagesList();
    await wait(100);
    const ms = document.getElementById('msg-search');
    out.searchH = ms ? Math.round(ms.getBoundingClientRect().height) : 0;
    return out;
  });
  ok(small.cap === 'Also stayed · 2', `a guest's other stays carry one caption ("${small.cap}")`);
  ok(small.rows === 2 && small.inset === '12px' && small.rowBorder === '0px' && small.seam === '1px',
    `…over one inset panel, rows on hairlines (${small.rows} rows, ${small.inset}, ${small.rowBorder}/${small.seam})`);
  ok(small.chev, 'each ends in the drawn chevron, not "open →"');
  ok(small.actGlyph === '""' && /url\(/.test(small.actMask), `an action link ends in the drawn chevron too, not a '›' glyph (${small.actGlyph})`);
  ok(small.searchH === 48, `the message search is the one field's height (${small.searchH}px)`);

  console.log('§13 the last stragglers: one chevron, one icon button, one second choice');
  const last = await page.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const iso = (n) => { const x = new Date(); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
    const drawn = (el, pseudo) => { if (!el) return false; const c = getComputedStyle(el, pseudo || null); return /url\(/.test(c.maskImage || c.webkitMaskImage || ''); };
    const mk = (id, ci, co) => mapBookingFromApi({ id, prop_key: '21a', name: 'Sofia Laurent', email: 'sofia@example.com', phone: '07700 900001', address: '1 Lane', postcode: 'NR25 7AB',
      check_in: iso(ci), check_out: iso(co), check_in_time: '15:00', check_out_time: '10:00', adults: 2, children: 0, payment: 'paid', deposit_paid: 440,
      agreed_total: 440, agreed_per_night: 130, agreed_nights: 3, agreed_nightly: 390, agreed_booking_fee: 50, agreed_txn_pct: 0, agreed_txn_fee: 0, agreed_on: iso(0), hold_status: 'none' });
    const seed = () => { dbBookings['21a'] = [mk(95, 30, 33), mk(96, -40, -37)]; };
    // Today: the rows, the Needs-you actions and the timeline's Earlier / Later.
    nav('view-backoffice');
    await wait(300);
    for (let k = 0; k < 5; k++) {
      seed();
      try { bookingsSetFilter('upcoming'); } catch (e) {}
      try { renderBookings(); } catch (e) {}
      await wait(150);
      if (document.querySelector('#bookings-list .bk-row-arrow')) break;
    }
    const arrow = document.querySelector('#bookings-list .bk-row-arrow');
    const nyChev = document.querySelector('#needs-you .ny-chev');
    const seg = [...document.querySelectorAll('#view-backoffice .tl-seg button[data-act="changeMonth"]')];
    const out = {
      rowArrow: drawn(arrow) && getComputedStyle(arrow).fontSize === '0px',
      nyChev: nyChev ? drawn(nyChev) : null,
      // …on the action's own line: font-size 0 put the chevron's baseline at its foot and dropped it a line.
      // Measured in the LIST form: a lone task is the solo card, which hides the chevron by design.
      nyLine: nyChev ? (() => {
        const ny = document.getElementById('needs-you'), solo = ny.classList.contains('ny-solo');
        ny.classList.remove('ny-solo');
        const a = nyChev.parentElement.getBoundingClientRect(), c = nyChev.getBoundingClientRect();
        const r = nyChev.getClientRects().length > 0 && Math.round(a.height) <= 22 && Math.abs((c.top + c.bottom) / 2 - (a.top + a.bottom) / 2) <= 2;
        if (solo) ny.classList.add('ny-solo');
        return r;
      })() : null,
      segSvg: seg.length === 2 && seg.every((b) => b.querySelector('svg') && !/[❮❯]/.test(b.textContent)),
    };
    // The booking page: call, email and ⋯ are one outlined circle.
    const c = document.getElementById('booking-hub-content');
    for (let k = 0; k < 5; k++) { seed(); await openBookingHub(96); await wait(500); if (/Sofia/.test(c.textContent) && c.querySelector('.bhub-menu-btn')) break; }
    const shape = (el) => { if (!el) return null; const s = getComputedStyle(el), r = el.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height), s.borderTopLeftRadius, s.backgroundColor, s.borderTopWidth].join(' '); };
    out.bookIcons = [...c.querySelectorAll('.bhub-tools .bhub-cbtn, .bhub-tools .bhub-menu-btn')].map(shape);
    // The card's second choice beside the filled one is outlined.
    c.insertAdjacentHTML('beforeend', '<div class="bhub-next" id="probe-next"><div class="bhub-next-acts"><button class="bhub-next-btn">Return</button><button class="bhub-actlink bhub-next-alt">Keep</button></div></div>');
    const alt = c.querySelector('#probe-next .bhub-next-alt');
    out.alt = { bg: getComputedStyle(alt).backgroundColor, bw: getComputedStyle(alt).borderTopWidth };
    c.querySelector('#probe-next').remove();
    // The guest book's detail toggle says whether it is open and ends in the drawn chevron.
    const more = c.querySelector('.gb-more');
    out.more = more ? { exp: more.getAttribute('aria-expanded'), drawn: drawn(more, '::after'), glyph: /[›‹]/.test(more.textContent) } : null;
    // The enquiry page: its ⋯ is the same circle, and the quote sits in the inset panel.
    const enq = { id: 93, prop_key: '21a', name: 'Grace Holloway', email: 'grace@example.com', phone: '', address: '2 Lane', postcode: 'NR25 7AB',
      check_in: iso(60), check_out: iso(63), check_in_time: '15:00', check_out_time: '10:00', adults: 2, children: 0, message: 'Free?', created_at: iso(-1) + ' 09:00:00' };
    enquiries.splice(0, enquiries.length, mapEnquiryFromApi(enq));
    await openEnquiryHub('e93');
    await wait(600);
    const e = document.getElementById('enquiry-hub-content');
    out.enqMenu = shape(e.querySelector('.bhub-menu-btn'));
    const pb = e.querySelector("[data-grp='equote'] .price-box");
    out.quote = pb ? getComputedStyle(pb).borderTopLeftRadius + ' ' + getComputedStyle(pb).borderTopWidth : '';
    // The conversation sheet takes the window's title and the one field.
    try { openMessageThread('a1'); } catch (er) {}
    await wait(500);
    const mt = document.getElementById('messages-modal-title'), mc = document.getElementById('msg-canned'), mi = document.getElementById('messages-modal-input');
    out.sheet = [mt && getComputedStyle(mt).fontSize, mt && getComputedStyle(mt).fontWeight, mc && getComputedStyle(mc).minHeight, mi && getComputedStyle(mi).minHeight, mi && getComputedStyle(mi).borderTopLeftRadius].join(' ');
    try { closeMessagesModal(); } catch (er) {}
    return out;
  });
  ok(last.rowArrow, 'a booking row ends in the drawn chevron, not a "›" glyph');
  ok(last.nyChev !== false, `a Needs-you action ends in the drawn chevron (${last.nyChev === null ? 'no task on screen' : 'drawn'})`);
  ok(last.nyLine !== false, 'the chevron sits on the action\'s own line, centred beside its word');
  ok(last.segSvg, 'the timeline\'s Earlier / Later carry the drawn chevron, not "❮ ❯"');
  ok(last.bookIcons.length >= 2 && last.bookIcons.every((s) => s === '44 44 999px rgba(0, 0, 0, 0) 1px'),
    `the booking page's call, email and ⋯ are one outlined 44px circle (${[...new Set(last.bookIcons)].join(' / ')})`);
  ok(last.enqMenu === '44 44 999px rgba(0, 0, 0, 0) 1px', `…and so is the enquiry page's ⋯ (${last.enqMenu})`);
  ok(last.alt.bg === 'rgba(0, 0, 0, 0)' && last.alt.bw === '1px', `the card's second choice is the outlined pill (${last.alt.bg}, ${last.alt.bw})`);
  ok(last.more && last.more.exp === 'false' && last.more.drawn && !last.more.glyph,
    `the guest book's detail toggle says whether it is open and ends in the drawn chevron (${JSON.stringify(last.more)})`);
  ok(last.quote === '12px 0px', `the enquiry's quote sits in the inset panel on the cell's corner (${last.quote})`);
  ok(last.sheet === '17px 600 48px 48px 12px', `the conversation's title is the window's, its picker and reply box the one field (${last.sheet})`);

  console.log('§14 the two long windows: the booking form and the email composer');
  const longWin = async (w) => {
    await page.setViewportSize({ width: w, height: w > 640 ? 900 : 844 });
    return page.evaluate(async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const iso = (n) => { const x = new Date(); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
      const bk = mapBookingFromApi({ id: 98, prop_key: '21a', name: 'Sofia Laurent', email: 'sofia@example.com', phone: '07700 900001', address: '1 Lane', postcode: 'NR25 7AB',
        check_in: iso(30), check_out: iso(33), check_in_time: '15:00', check_out_time: '10:00', adults: 2, children: 0, payment: 'paid', deposit_paid: 440,
        agreed_total: 440, agreed_per_night: 130, agreed_nights: 3, agreed_nightly: 390, agreed_booking_fee: 50, agreed_txn_pct: 0, agreed_txn_fee: 0, agreed_on: iso(0), hold_status: 'none' });
      dbBookings['21a'] = [bk];
      nav('view-backoffice');
      await wait(300);
      const read = (boxSel, titleSel, fieldSel) => {
        const box = document.querySelector(boxSel), r = box.getBoundingClientRect(), c = getComputedStyle(box);
        const t = getComputedStyle(document.querySelector(titleSel)), f = document.querySelector(fieldSel), fc = getComputedStyle(f);
        return {
          edge: Math.round(r.bottom) >= innerHeight - 1 && Math.round(r.left) <= 1 && Math.round(r.right) >= innerWidth - 1,
          corners: c.borderTopLeftRadius + '/' + c.borderBottomLeftRadius, bg: c.backgroundColor,
          title: t.fontSize + ' ' + t.fontWeight, field: Math.round(f.getBoundingClientRect().height) + ' ' + fc.borderTopLeftRadius,
        };
      };
      // The window ground every other window stands on, for comparison.
      const gd = document.querySelector('#glass-dialog .glass-dialog-box');
      void glassAlert('probe');
      await wait(450);
      const ground = getComputedStyle(gd).backgroundColor;
      document.getElementById('glass-dialog-ok').click();
      await wait(350);
      openAddBooking();
      await wait(600);
      const book = read('#edit-modal .modal-box', '#modal-title', '#modal-name');
      const xs = (sel) => { const x = document.querySelector(sel); if (!x) return ''; const c = getComputedStyle(x), r = x.getBoundingClientRect(); return Math.round(r.width) + ' ' + c.backgroundColor + ' ' + c.borderTopWidth; };
      book.x = xs('#edit-modal .modal-x');
      const on = document.querySelector('#edit-modal .hs-mode-btn.is-on');
      book.seg = on ? getComputedStyle(on).borderTopLeftRadius + ' ' + Math.round(on.getBoundingClientRect().height) : '';
      closeModal();
      await wait(400);
      dbBookings['21a'] = [bk]; // a refresh may have landed since
      openBookingEmail(bk.id);
      await wait(600);
      const mail = read('#enq-email-modal .reviews-modal-box', '#enq-email-title', '#enq-email-subject');
      mail.x = xs('#enq-email-modal .reviews-modal-close');
      try { closeEnquiryEmailModal(); } catch (e) {}
      await wait(400);
      return { ground, book, mail };
    });
  };
  const phone = await longWin(390);
  ok(phone.book.edge && phone.book.corners === '20px/0px', `on a phone the booking form rises from the bottom edge (${phone.book.corners})`);
  ok(phone.mail.edge && phone.mail.corners === '20px/0px', `…and so does the email composer (${phone.mail.corners})`);
  ok(phone.book.bg === phone.ground && phone.mail.bg === phone.ground, `both stand on the window's own ground (${phone.book.bg} / ${phone.mail.bg} vs ${phone.ground})`);
  ok(phone.book.title === '17px 600' && phone.mail.title === '17px 600', `both titles are the window's (${phone.book.title} / ${phone.mail.title})`);
  ok(phone.book.field === '48 12px' && phone.mail.field === '48 12px', `their fields are the one field (${phone.book.field} / ${phone.mail.field})`);
  ok(/^9+px 36$/.test(phone.book.seg), `the booking form's choices are the one pill switcher (${phone.book.seg})`);
  ok(phone.book.x === '44 rgba(0, 0, 0, 0) 1px' && phone.mail.x === phone.book.x, `a window's close is the one outlined 44px circle (${phone.book.x} / ${phone.mail.x})`);
  const desk = await longWin(1280);
  ok(!desk.book.edge && desk.book.corners === '20px/20px', `on a computer the booking form stays a card in the middle (${desk.book.corners})`);
  await page.setViewportSize({ width: 390, height: 844 });

  console.log('§15 the offline day sheet wears the online Today\'s parts');
  const ods = await page.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const iso = (n) => { const x = new Date(); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
    const mk = (id, name, ci, co, paid) => mapBookingFromApi({ id, prop_key: '21a', name, email: name.split(' ')[0].toLowerCase() + '@example.com', phone: '07700 900001',
      address: '1 Lane', postcode: 'NR25 7AB', check_in: iso(ci), check_out: iso(co), check_in_time: '15:00', check_out_time: '10:00', adults: 2, children: 0,
      payment: paid ? 'paid' : 'deposit', deposit_paid: paid ? 440 : 100, agreed_total: 440, agreed_per_night: 130, agreed_nights: 3, agreed_nightly: 390,
      agreed_booking_fee: 50, agreed_txn_pct: 0, agreed_txn_fee: 0, agreed_on: iso(-5), hold_status: 'none' });
    nav('view-backoffice');
    await wait(300);
    dbBookings['21a'] = [mk(301, 'Ann Staying', -1, 2, false), mk(302, 'Bea Later', 10, 13, false), mk(303, 'Cal Later', 20, 23, true), mk(304, 'Dee Later', 30, 33, false)];
    renderOfflineDaySheet();
    await wait(300);
    const sheet = document.getElementById('offline-daysheet');
    const rows = [...sheet.querySelectorAll('.ods-row')];
    const runs = rows.filter((r, i) => i > 0 && r.previousElementSibling === rows[i - 1]);
    const tag = sheet.querySelector('.ods-row .prop-tag');
    const duty = sheet.querySelector('.ods-duty .ny-chev');
    const cap = sheet.querySelector('.ods-row .st-cap');
    const c = (sel, p) => { const e = sheet.querySelector(sel); return e ? getComputedStyle(e)[p] : ''; };
    const out = {
      rows: rows.length,
      rail: rows.filter((r) => parseFloat(getComputedStyle(r).borderLeftWidth) > 1).length,
      joined: runs.length > 0 && runs.every((r) => Math.abs(r.getBoundingClientRect().top - r.previousElementSibling.getBoundingClientRect().bottom) <= 1),
      tagHugs: !!tag && tag.getBoundingClientRect().width < tag.closest('.ods-row').getBoundingClientRect().width / 2,
      cap: !!cap && /Balance due|Paid/.test(cap.textContent) && cap.classList.contains('bhub-chip'),
      chev: duty ? /url\(/.test(getComputedStyle(duty).maskImage || getComputedStyle(duty).webkitMaskImage || '') : null,
      tl: c('.ods-tl', 'borderTopLeftRadius'), mark: c('.ods-mark', 'borderTopLeftRadius'),
    };
    sheet.remove();
    document.body.classList.remove('offline-snap');
    return out;
  });
  ok(ods.rows >= 3, `the sheet renders its stays and bookings as rows (${ods.rows}; vacuity guard)`);
  ok(ods.rail === 0, `no row carries the old 3px rail — the capsule says the state (${ods.rail} with one)`);
  ok(ods.joined, 'a run of rows is ONE card: each row starts where the one above ends');
  ok(ods.tagHugs, 'the cottage tag keeps to its name, not the row\'s width');
  ok(ods.cap, 'a booking\'s paid state is the house capsule, not bare text');
  ok(ods.chev !== false, `a duty's "Open" ends in the drawn chevron (${ods.chev === null ? 'no duty on screen' : 'drawn'})`);
  ok(ods.tl === '20px' && (ods.mark === '' || ods.mark === '12px'), `the timeline is a card and the banner a cell on the house corners (${ods.tl} / ${ods.mark || 'no banner'})`);

  console.log('§16 every page\'s status is the Manage pill, beside its title');
  // One booking that owes, so Today has something to say. The fixture serves it too: its
  // background refresh would otherwise empty dbBookings, and the pill would rightly say nothing.
  const iso = (n) => { const x = new Date(); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
  liveBookings = [{ id: 401, prop_key: '21a', name: 'Owes Olive', email: 'olive@example.com', check_in: iso(6), check_out: iso(9), adults: 2, children: 0,
    payment: 'unpaid', deposit_paid: 0, agreed_total: 440, agreed_per_night: 130, agreed_nights: 3, agreed_nightly: 390, agreed_booking_fee: 50, agreed_txn_pct: 0, agreed_txn_fee: 0, hold_status: 'none' }];
  const SEED = `dbBookings['21a'] = [mapBookingFromApi(${JSON.stringify(liveBookings[0])})];`;
  const PAGES = [
    ['Manage', "await openArea(); settingsShowIndex(); manageVerdicts();"],
    ['Today', "nav('view-backoffice'); " + SEED + " renderBookings();"],
    ['Key safes', 'await openKeysafe();'],
    ['Payments', 'await openAccounts();'],
    ['Activity log', "nav('view-activity-log');"],
    ['Calendar sync', "await openArea(); settingsOpen('calendar');"],
    ['Reviews', "await openArea(); settingsOpen('reviews');"],
    ['Seasonal rates', "await openArea(); settingsOpen('seasongrid');"],
    ['Payments settings', "await openArea(); settingsOpen('payments');"],
    ['Text messages', "await openArea(); settingsOpen('sms');"],
  ];
  const pills = [];
  for (const [name, go] of PAGES) {
    let m = null;
    for (let i = 0; i < 6 && !(m && m.found && m.text && !/…$/.test(m.text)); i++) {
      await page.evaluate(`(async () => { ${go} })()`);
      await page.waitForTimeout(500);
      m = await page.evaluate(() => {
        const v = document.querySelector('.page-view.active');
        const p = [...v.querySelectorAll('.head-pill')].find((e) => e.getClientRects().length);
        if (!p) return { found: false };
        const row = p.closest('.dashboard-header, .settings-panel-head');
        const h = row && [...row.querySelectorAll('h1, h2')].find((e) => e.getClientRects().length);
        const pr = p.getBoundingClientRect(), hr = h ? h.getBoundingClientRect() : null, rr = row.getBoundingClientRect();
        const cs = getComputedStyle(p), dot = p.querySelector('.cron-pill-dot');
        return {
          found: true, text: p.textContent.trim(), tone: p.dataset.tone || (p.id === 'health-pill' ? 'manage' : ''),
          cls: ['cron-pill', 'head-pill'].every((c) => p.classList.contains(c)) && ['ok', 'warn', 'danger', 'unk'].some((c) => p.classList.contains(c)),
          look: [Math.round(pr.height), cs.borderTopLeftRadius, cs.fontSize, cs.fontWeight, cs.paddingLeft, dot ? Math.round(dot.getBoundingClientRect().width) : 0].join(' '),
          after: !!hr && pr.left > hr.right, dy: hr ? Math.abs((pr.top + pr.height / 2) - (hr.top + hr.height / 2)) : 99,
          edge: Math.abs(rr.right - parseFloat(getComputedStyle(row).paddingRight || '0') - pr.right),
        };
      });
    }
    pills.push(Object.assign({ name }, m));
  }
  const ref = pills[0] || {};
  ok(pills.every((x) => x.found), `each page carries its status pill (${pills.filter((x) => !x.found).map((x) => x.name).join(', ') || 'all ' + pills.length})`);
  ok(pills.every((x) => !x.found || x.cls), 'each is the Manage pill\'s own classes and one of its four tones');
  ok(pills.every((x) => !x.found || x.look === ref.look), `…and its own look — height, corners, type, padding, dot (${[...new Set(pills.map((x) => x.look))].join(' | ')})`);
  ok(pills.every((x) => !x.found || (x.after && x.dy <= 2 && x.edge <= 1)), `right of the title, on its line, at the row's right edge (${pills.filter((x) => x.found && !(x.after && x.dy <= 2 && x.edge <= 1)).map((x) => x.name + ' Δ' + (x.dy || 0).toFixed(1) + '/' + (x.edge || 0).toFixed(1)).join(', ') || 'all'})`);
  const said = Object.fromEntries(pills.map((x) => [x.name, (x.tone || '') + ':' + (x.text || '')]));
  ok(/^warn:£[\d,]+ to collect$/.test(said.Today), `Today's pill is who owes you (${said.Today})`);
  ok(/^(bad|warn):\d+ codes? to set$|^ok:All \d+ ready$/.test(said['Key safes']), `Key safes' pill is the safes' state (${said['Key safes']})`);
  ok(/^unk:None linked$/.test(said['Calendar sync']), `with no calendar linked, Calendar sync says so — never "up to date" about nothing (${said['Calendar sync']})`);
  ok(/^ok:All clear$/.test(said['Activity log']), `the Activity log's verdict left the week card for the title (${said['Activity log']})`);
  const gone = await page.evaluate(() => ({
    rowsLeft: document.querySelectorAll('.ks-status, .bk-owed, #mo-calm, .mo-calm, .mg-mark, #settings-panel-cap .st-cap, .al-wtop .st-cap').length,
    weekCap: !!document.querySelector('#al-week .st-cap'),
  }));
  ok(gone.rowsLeft === 0 && !gone.weekCap, `none of the old status looks is left — no card row, green line, tinted panel or capsule beside a title (${gone.rowsLeft})`);

  console.log('§17 a list is ONE window: the Payments "Needs attention" shape, everywhere');
  // Each page's rows must abut — every row starting where the one above ends, the card's corners only
  // on the run's ends — where they used to be separate cards with air between (the owner's screenshot of
  // Calendar sync beside Payments' Needs attention).
  const J = await page.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const run = (els, minR = 16) => {
      els = els.filter((e) => e.getClientRects().length);
      const b = els.map((e) => e.getBoundingClientRect());
      const rad = (e, c) => parseFloat(getComputedStyle(e)['border' + c + 'Radius']) || 0;
      return {
        n: els.length,
        flush: els.length > 1 && b.slice(1).every((r, i) => Math.abs(r.top - b[i].bottom) <= 1 && Math.abs(r.left - b[i].left) <= 1),
        ends: els.length > 1 && rad(els[0], 'TopLeft') >= minR && rad(els[0], 'BottomLeft') === 0 && rad(els[els.length - 1], 'TopLeft') === 0 && rad(els[els.length - 1], 'BottomLeft') >= minR,
      };
    };
    const out = {};
    // Calendar sync: the cottages are rows of one card; a failing platform is a fold row under
    // "Needs attention", on the same ground as the rows — not a tinted card of its own.
    await openArea(); settingsOpen('calendar'); await wait(500);
    __calOv = { '21a': { feeds: [{ source: 'airbnb', url: 'https://www.airbnb.com/calendar/ical/x.ics' }], status: { sources: { airbnb: { ok: false, fails: 2, at: '2026-10-01 10:00:00', events: 3, ok_at: '2026-09-20 10:00:00', error: 'HTTP 404' } } } }, jollyboat: { feeds: [], status: { sources: {} } } };
    renderCalendarList(); await wait(200);
    const L = document.getElementById('calendar-list');
    out.cal = run([...L.querySelectorAll('.bhub-fold-grp:not(.cal-prob)')]);
    const prob = L.querySelector('.cal-prob'), row = L.querySelector('.bhub-fold-grp:not(.cal-prob)');
    const cap = prob && prob.previousElementSibling;
    out.calProb = !!prob && prob.classList.contains('bhub-fold-grp') && !!cap && /Needs attention/.test(cap.textContent)
      && getComputedStyle(prob).backgroundColor === getComputedStyle(row).backgroundColor && getComputedStyle(prob).borderTopColor === getComputedStyle(row).borderTopColor;
    // Key safes: two to-dos are rows of one card; one stays the card with its button.
    await openKeysafe(); await wait(300);
    const keep = __keysafe;
    __keysafe = { '21a': { code: '', history: [], enabled: true }, jollyboat: { code: '', history: [], enabled: true } };
    renderKeysafe();
    // The rows sit inside the card, so the card carries the corners.
    out.ks = run([...document.querySelectorAll('#keysafe-body .ks-todos .ks-trow')]);
    const ksc = document.querySelector('#keysafe-body .ks-todos');
    out.ks.ends = !!ksc && parseFloat(getComputedStyle(ksc).borderTopLeftRadius) >= 16 && getComputedStyle(ksc).borderTopStyle !== 'none';
    out.ksCards = document.querySelectorAll('#keysafe-body .ks-todo').length;
    __keysafe = { '21a': { code: '', history: [], enabled: true }, jollyboat: { code: '4821', history: [], enabled: true } };
    renderKeysafe();
    out.ksSolo = document.querySelectorAll('#keysafe-body .ks-todo .ks-rotate').length === 1 && !document.querySelector('#keysafe-body .ks-todos');
    __keysafe = keep; renderKeysafe();
    // The cottage page's own controls: one group, two rows.
    await openArea(); settingsOpenAccom('21a'); await wait(400);
    const groups = [...document.querySelectorAll('#accom-detail > .settings-group')];
    out.accom = groups.length + ':' + (groups[0] ? groups[0].querySelectorAll('.settings-row').length : 0);
    // Search learning: the tiles and the sandbox are not two cards.
    settingsOpen('search-learning'); await wait(300);
    // The tiles sit bare on the page (the stat-tile rule), the sandbox a field under them in the same block.
    const slc = [...document.querySelectorAll('#search-learning-body .sl-card')];
    out.sl = slc.length + ':' + (slc[0] ? getComputedStyle(slc[0]).borderTopWidth + '/' + getComputedStyle(slc[0]).backgroundColor : '') + ':' + !!(slc[0] && slc[0].querySelector('#sl-probe-input'));
    // Expenses: "Add an expense" is the newest list's last row.
    await openAccounts(); await wait(300);
    allExpenses.splice(0, allExpenses.length,
      { id: 1, date: '2026-10-02', category: 'Laundry', description: 'Linen', amount: 42.5, prop_key: '21a', recurring: 0 },
      { id: 2, date: '2025-11-02', category: 'Cleaning', description: 'Clean', amount: 85, prop_key: '', recurring: 0 });
    accountsOpen('expenses'); renderExpenses(); await wait(200);
    const lists = [...document.querySelectorAll('#expenses-body .xp-list')], add = document.querySelector('#expenses-body .xp-add');
    out.xpLists = lists.length;
    out.xp = !!add && lists[0] && lists[0].nextElementSibling === add && run([lists[0], add]);
    // A loading mailbox is shaped like the list it stands in for.
    await openInbox(); inboxFolder('email'); await wait(200);
    const mb = document.getElementById('mailbox-body'); const was = mb.innerHTML;
    mb.innerHTML = skelRows(3);
    // Below 1200px the folder lives INSIDE a fold, where a run is the inset panel on the CELL radius.
    out.skel = run([...mb.querySelectorAll('.skel-row')], mb.closest('.bhub-fold') ? 12 : 16);
    out.skelInFold = !!mb.closest('.bhub-fold');
    mb.innerHTML = was;
    return out;
  });
  ok(J.cal.n >= 2 && J.cal.flush && J.cal.ends, `Calendar sync: the cottages are rows of ONE card (${JSON.stringify(J.cal)})`);
  ok(J.calProb, 'Calendar sync: a failing platform is a fold row under "Needs attention", on the rows\' own ground — not a tinted card');
  ok(J.ks.n === 2 && J.ks.flush && J.ks.ends && J.ksCards === 0, `Key safes: two to-dos are rows of one card, not two cards (${JSON.stringify(J.ks)}, ${J.ksCards} cards)`);
  ok(J.ksSolo, 'Key safes: ONE to-do keeps its card and its one button (Today\'s single task)');
  ok(J.accom === '1:2', `the cottage page's private/remove controls are one group of rows (${J.accom})`);
  ok(J.sl === '1:0px/rgba(0, 0, 0, 0):true', `Search learning: the sandbox is a field under the bare tiles, not a second card (${J.sl})`);
  ok(J.xpLists === 2 && J.xp && J.xp.flush, `Expenses: "Add an expense" is the newest year's last row, joined (${JSON.stringify(J.xp)})`);
  ok(J.skel.n === 3 && J.skel.flush && J.skel.ends, `a loading list is one card of rows, not separate cards (${JSON.stringify(J.skel)})`);

  // The two hubs: Needs attention sits between the decision card and the money, so Money, Guest and
  // History stay one card; the enquiry's message heads the card the quote joins — and clears the
  // decision card above it (the head/grid join used to leave it 2px under that card).
  const H = await page.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const iso = (n) => { const x = new Date(); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
    const raw = { id: 93, prop_key: '21a', name: 'Rhian Moss', email: 'rhian@example.com', phone: '07700 900001', address: '1 Lane', postcode: 'NR25 7AB',
      check_in: iso(20), check_out: iso(23), check_in_time: '15:00', check_out_time: '10:00', adults: 2, children: 0, payment: 'deposit', deposit_paid: 120,
      agreed_total: 440, agreed_per_night: 130, agreed_nights: 3, agreed_nightly: 390, agreed_booking_fee: 50, agreed_txn_pct: 0, agreed_txn_fee: 0,
      agreed_on: iso(-5), hold_status: 'none', reg_url: 'guest-details.php?t=y', reg_submitted: 0 };
    const c = document.getElementById('booking-hub-content');
    nav('view-backoffice'); await wait(200);
    for (let k = 0; k < 5; k++) {
      dbBookings['21a'] = [mapBookingFromApi(raw)];
      await openBookingHub(93); await wait(500);
      if (/Rhian/.test(c.textContent) && c.querySelector('.bhub-attn')) break;
    }
    // The page settles in once per booking opened; measure the resting layout, not the entrance.
    for (let k = 0; k < 40 && c.getAnimations({ subtree: true }).some((x) => x.playState === 'running'); k++) await wait(50);
    const attn = c.querySelector('.bhub-attn'), money = c.querySelector('.bhub-money-grp');
    const first = c.querySelector('.bhub-grid > .bhub-fold-grp');
    const out = {
      order: !!attn && !!money && !!(attn.compareDocumentPosition(money) & Node.DOCUMENT_POSITION_FOLLOWING),
      joined: !!money && !!first && Math.abs(first.getBoundingClientRect().top - money.getBoundingClientRect().bottom) <= 1,
      air: !!attn && !!money && Math.round(money.getBoundingClientRect().top - attn.getBoundingClientRect().bottom),
    };
    enquiries.splice(0, enquiries.length, mapEnquiryFromApi({ id: 94, prop_key: '21a', name: 'Iris Penn', email: 'iris@example.com', phone: '', address: '2 Lane', postcode: 'NR25 7AB',
      check_in: iso(70), check_out: iso(73), check_in_time: '15:00', check_out_time: '10:00', adults: 2, children: 0, message: 'Is late checkout possible?', created_at: iso(-1) + ' 09:00:00' }));
    await openEnquiryHub('e94'); await wait(600);
    const E = document.getElementById('enquiry-hub-content');
    for (let k = 0; k < 40 && E.getAnimations({ subtree: true }).some((x) => x.playState === 'running'); k++) await wait(50);
    const card = E.querySelector('.bhub-head .bhub-next'), msg = E.querySelector('.bhub-msg'), q = msg && msg.nextElementSibling;
    out.msgAir = card && msg ? Math.round(msg.getBoundingClientRect().top - card.getBoundingClientRect().bottom) : -1;
    out.msgJoined = !!q && q.classList.contains('bhub-fold-grp') && Math.abs(q.getBoundingClientRect().top - msg.getBoundingClientRect().bottom) <= 1
      && parseFloat(getComputedStyle(msg).borderBottomLeftRadius) === 0 && parseFloat(getComputedStyle(q).borderTopLeftRadius) === 0;
    return out;
  });
  ok(H.order && H.joined, `the booking page: Needs attention above the money, and the money joined to Guest and History (${JSON.stringify(H)})`);
  ok(H.air >= 12, `…with the card's own air between the attention row and the money (${H.air}px)`);
  ok(H.msgAir >= 12, `the enquiry page: the message clears the decision card above it (${H.msgAir}px)`);
  ok(H.msgJoined, 'the enquiry page: the message heads the card the quote and the guest\'s details join');
  // …and on a computer, docked beside Today's list, the money joins the list below it too (the join
  // used to be phone-only, leaving the money row a card of its own in the pane).
  await page.setViewportSize({ width: 1280, height: 900 });
  const D = await page.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    nav('view-backoffice'); await wait(300);
    await openBookingHub(93); await wait(400);
    const c = document.getElementById('booking-hub-content');
    for (let k = 0; k < 40 && c.getAnimations({ subtree: true }).some((x) => x.playState === 'running'); k++) await wait(50);
    const money = c.querySelector('.bhub-money-grp'), first = c.querySelector('.bhub-grid > .bhub-fold-grp');
    return { docked: c.parentElement && c.parentElement.id, gap: money && first ? Math.round(first.getBoundingClientRect().top - money.getBoundingClientRect().bottom) : null };
  });
  ok(D.docked === 'bookings-detail-pane' && D.gap === 0, `docked on a computer, the money still joins Guest and History (${D.docked}, gap ${D.gap})`);
  await page.setViewportSize({ width: 390, height: 900 });

  // The first caption on a page sits the same distance under its title row everywhere (24px: the row's
  // 8 + the caption's 16). Calendar sync and Payments settings sat at 32, a cottage's sync page at 8 and
  // Backups at 16, where the caption's margin collapsed into the title row's.
  const gaps = [];
  for (const sec of ['reviews', 'calendar', 'payments', 'sms', 'backups', 'follow-ups', 'chat-away']) {
    gaps.push(await page.evaluate(async (sec) => {
      __calOv = null; // §17 left a failing feed, whose facts line rightly leads the calendar page
      await openArea(); settingsOpen(sec);
      await new Promise((r) => setTimeout(r, 400));
      const head = document.querySelector('#settings-panel .settings-panel-head');
      const cap = [...document.querySelectorAll('#sec-' + sec + ' :is(.bhub-grpcap, .acr-cap, .u-cap)')].filter((e) => e.getClientRects().length).sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)[0];
      return sec + ':' + (head && cap ? Math.round(cap.getBoundingClientRect().top - head.getBoundingClientRect().bottom) : 'none');
    }, sec));
  }
  ok(gaps.every((g) => /:24$/.test(g)), `every page's first caption sits 24px under its title row (${gaps.join(' ')})`);

  await page.close();
  await t.done(fails);
})().catch(async (e) => { console.error('FAILED:', e); process.exit(1); });
