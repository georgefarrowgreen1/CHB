// ============================================================
//  ui-test-command.js — search ACTS, and remembers what it did.
//
//  Every quick-action used to begin closeCmdK(): search handed off to a modal and
//  vanished, so chasing three balances was three journeys. An action may now carry
//  an `inline` runner that does the work with the window still open and returns
//  { say, undo? }, which lands as a strip under its own row.
//
//  What this pins, and why each one is here rather than assumed:
//    * the window STAYS OPEN and the workspace underneath is untouched — the
//      entire point of the change;
//    * a success reports under the row, in a role=status live region, because
//      nothing navigates any more and there is no page change to notice;
//    * CANCELLING CLAIMS NOTHING. The inline runner returns null when the owner
//      backs out of the preview, and a strip saying "sent" after they pressed
//      Cancel would be a lie the UI told about money;
//    * a FAILURE says what went wrong and is not undoable;
//    * an action WITHOUT an inline runner is byte-for-byte unchanged — that
//      opt-in is the whole safety story of rolling this out one action at a time;
//    * undo is a STACK, so a second change does not erase the first.
//
//  The sender is stubbed on purpose. The email preview flow it wraps is covered
//  by ui-test-hub; this suite is about what cmdkAct does with an outcome.
// ============================================================
const { d, bootBrowser } = require('./ui-test-lib');
let fails = 0; const ok = (c,m) => { console.log(`  ${c?'✓':'✗'} ${m}`); if (!c) fails++; };
// Booking ids the server should REFUSE as already-sent, the way the resend window does:
// 409 + code, which is what makes the refusal visible at all. It answered 200 with an
// `error` key at first, and apiPost only throws on a non-2xx — so the refusal was
// swallowed and the owner was told "Balance request sent — £NaN".
let refuseIds = [];
// Booking ids whose send should FAIL for real (SMTP down). The four send actions all
// reported this at 200 with an `error` key except send_arrival, so the same £NaN toast
// and the same false "sent" strip arrived from a genuine mail failure too.
let failIds = [];
const NAMES = { 1: 'Richard Berry', 2: 'Cara Bell', 3: 'Dan Rowe' };
const stub = (page) => page.route(/\.php/, (r) => {
  const url = r.request().url();
  let b = {}; try { b = JSON.parse(r.request().postData()||'{}'); } catch(e){}
  const json = (o) => r.fulfill({ status:200, contentType:'application/json', body: JSON.stringify(o) });
  if (url.includes('auth.php')) { if (b.action==='admin_status') return json({ok:true,admin:true});
    if (b.action==='guest_status') return json({ok:true,guest:null}); return json({ok:true}); }
  if (url.includes('rates.php')) return json({ properties:[{prop_key:'jollyboat',name:'Jollyboat',slug:'jollyboat',couple_rate:130,booking_fee:75,transaction_pct:3,max_adults:2,max_children:0,max_total:2,sort_order:1}], seasons:{}, occupancy:{} });
  if (b && b.action === 'request_payment' && failIds.includes(b.id)) {
    return r.fulfill({ status:500, contentType:'application/json', body: JSON.stringify({ error: 'SMTP connect failed' }) });
  }
  if (b && b.action === 'request_payment' && refuseIds.includes(b.id)) {
    return r.fulfill({ status:409, contentType:'application/json', body: JSON.stringify({
      error: `That payment request has just gone to ${NAMES[b.id] || 'the guest'} (a minute ago) — they have it.`,
      code: 'already_sent',
    }) });
  }
  // Three owers, one of them with NO email address — the exact partial-send shape
  // the bulk report has to be honest about. Balances: 440 + 420 + 95 = £955 owed,
  // £860 of it actually reachable.
  if (url.includes('bookings.php')) return json({ bookings:[
    {id:1,prop_key:'jollyboat',name:'Richard Berry',email:'rb@x.co',check_in:d(6),check_out:d(10),adults:2,children:0,payment:'deposit',deposit_paid:200,agreed_total:640,agreed_nightly:620,agreed_txn_fee:20,agreed_nights:4},
    {id:2,prop_key:'jollyboat',name:'Cara Bell',email:'cb@x.co',check_in:d(14),check_out:d(17),adults:2,children:0,payment:'deposit',deposit_paid:100,agreed_total:520,agreed_nightly:505,agreed_txn_fee:15,agreed_nights:3},
    {id:3,prop_key:'jollyboat',name:'Dan Rowe',email:'',check_in:d(22),check_out:d(24),adults:2,children:0,payment:'deposit',deposit_paid:50,agreed_total:145,agreed_nightly:140,agreed_txn_fee:5,agreed_nights:2},
  ] });
  return json({ok:true,bookings:[],enquiries:[],threads:[],reviews:[],photos:[],experiences:[],content:{},blocks:[],ranges:[],results:[],corpus:[],logs:{},events:[],value:null});
});
(async () => {
  const { browser, base, done } = await bootBrowser();
  const page = await browser.newPage({ viewport:{width:900,height:900} });
  await page.addInitScript(() => { if (navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(()=>{}); });
  await stub(page);
  await page.goto(base + '/index.html', { waitUntil:'domcontentloaded' });
  await page.waitForTimeout(1400);
  await page.evaluate(async () => { isAuthenticated=true; document.body.classList.add('owner-mode'); await loadAdminBundle(); await initBackOffice(); });
  await page.waitForTimeout(1500);

  const run = (outcome) => page.evaluate(async (mode) => {
    // POLL, never sleep. This suite failed in CI while passing locally because it
    // waited a fixed 1200ms for the window and 500ms for results; a slower runner
    // hadn't produced a row with actions yet, findIndex returned -1, and reading
    // __cmdkResults[-1].actions threw. Waiting for the CONDITION is the fix — a
    // bigger sleep would only move the flake further away.
    const until = async (fn, ms = 8000) => {
        const t0 = Date.now();
        for (;;) {
            const v = fn();
            if (v !== undefined && v !== null && v !== false && v !== -1) return v;
            if (Date.now() - t0 > ms) return null;
            await new Promise((r) => setTimeout(r, 50));
        }
    };
    __chbUndo.length = 0;
    try { closeCmdK(); } catch(e){}
    openCmdK();
    if (!await until(() => document.getElementById('cmdk').classList.contains('open'))) return { fatal: 'the window never opened' };
    const i = document.getElementById('cmdk-input'); i.value='richard'; cmdkSearchCore('richard', false);
    const idx = await until(() => __cmdkResults.findIndex(x => Array.isArray(x.actions) && x.actions.length));
    if (idx === null) return { fatal: 'no row with quick-actions appeared' };
    __cmdkSel = idx; cmdkRender();
    await until(() => !!document.getElementById('cmdk-opt-' + idx));
    // Swap in a sender with a known outcome. The real one is requestPayment,
    // exercised by the preview flow; here we only care what cmdkAct does with it.
    const k = __cmdkResults[idx].actions.length;
    __cmdkResults[idx].actions.push({
      key: 'probe', label: 'Probe', pending: 'Working…',
      run: () => {},
      inline: async () => {
        if (mode === 'throw') throw new Error('No email address on this booking');
        if (mode === 'cancel') return null;
        return { say: 'Balance request sent to Richard', undo: async () => {}, reload: false };
      },
    });
    await cmdkAct(idx, k);
    // The strip is rendered synchronously by cmdkAct, but give the paint a tick.
    await until(() => mode === 'cancel' ? true : !!document.querySelector('#cmdk .cmdk-actmsg'), 3000);
    const s = document.querySelector('#cmdk .cmdk-actmsg');
    return { open: document.getElementById('cmdk').classList.contains('open'),
             txt: s ? s.textContent.trim() : '(none)',
             cls: s ? s.className : '', role: s ? s.getAttribute('role') : null,
             undo: __chbUndo.length, view: (document.querySelector('.page-view.active')||{}).id };
  }, outcome);

  const okRes = await run('ok');
  if (okRes.fatal) { ok(false, `setup failed: ${okRes.fatal}`); console.log('\n  1 FAILED'); return await done(1); }
  ok(okRes.open, 'SEARCH STAYS OPEN through the action — the whole point');
  ok(/sent to Richard/.test(okRes.txt), `the outcome reports under the row (${okRes.txt})`);
  ok(/is-ok/.test(okRes.cls), 'as a success strip');
  ok(okRes.role === 'status', 'announced — nothing navigated, so there is no page change to notice');
  ok(okRes.undo === 1, `and it joins the undo stack (${okRes.undo})`);
  ok(okRes.view !== 'view-search', `the workspace underneath is untouched (${okRes.view})`);

  const cancelled = await run('cancel');
  ok(cancelled.txt === '(none)', 'backing out claims NOTHING — no strip');
  ok(cancelled.undo === 0, 'and nothing joins the undo stack');

  const failed = await run('throw');
  ok(/No email address/.test(failed.txt), `a failure says what went wrong (${failed.txt})`);
  ok(/is-err/.test(failed.cls), 'as an error strip, not a success one');
  ok(failed.undo === 0, 'and a failed action is not undoable');

  const legacy = await page.evaluate(() => {
    const i = __cmdkResults.findIndex(x => Array.isArray(x.actions) && x.actions.some(a=>a.key==='email'));
    const a = __cmdkResults[i].actions.find(a=>a.key==='email');
    return { hasInline: typeof a.inline === 'function', hasRun: typeof a.run === 'function' };
  });
  ok(!legacy.hasInline && legacy.hasRun, 'an action WITHOUT an inline runner is untouched — still a plain run()');

  const stack = await page.evaluate(() => {
    __chbUndo.length = 0;
    chbUndoPush('First change', async () => {});
    chbUndoPush('Second change', async () => {});
    const rows = cmdkIntent('undo') || [];
    return { n: __chbUndo.length, head: rows[0] && rows[0].label, second: rows[1] && rows[1].label };
  });
  ok(stack.n === 2, `the stack remembers two changes, not one (${stack.n})`);
  ok(/Second change/.test(stack.head||''), `undo offers the newest first (${stack.head})`);
  ok(/First change/.test(stack.second||''), `and lists the one behind it (${stack.second})`);

  // ---- STEP 4: the system-state line ----
  const sys = await page.evaluate(async () => {
    const until = async (fn, ms = 6000) => { const t0 = Date.now(); for (;;) { const v = fn(); if (v) return v; if (Date.now() - t0 > ms) return null; await new Promise((r) => setTimeout(r, 50)); } };
    // All well.
    window.__cronStatusPre = { stale: false, everRan: true, ageHours: 3 };
    try { closeCmdK(); } catch (e) {}
    openCmdK();
    await until(() => document.getElementById('cmdk').classList.contains('open'));
    const el = document.getElementById('cmdk-sys');
    const okState = { hidden: el.hidden, cls: el.className, txt: el.textContent.trim(), role: el.getAttribute('role'), disabled: el.disabled };
    // Automation stopped — the failure everything else depends on.
    window.__cronStatusPre = { stale: true, everRan: true, ageHours: 50 };
    chbSysLine();
    const warn = { cls: el.className, txt: el.textContent.trim(), disabled: el.disabled, label: el.getAttribute('aria-label') };
    return { okState, warn };
  });
  ok(!sys.okState.hidden && /is-ok/.test(sys.okState.cls), `STATUS: healthy reads quietly (${sys.okState.txt})`);
  ok(/All systems normal/.test(sys.okState.txt), 'STATUS: and says so in plain words');
  ok(sys.okState.role === 'status', 'STATUS: announced — a stopped automation must not be silent');
  ok(sys.okState.disabled === true, 'STATUS: nothing to open when all is well, so it is not a button');
  ok(/is-warn/.test(sys.warn.cls), 'STATUS: a stale cron flips it to warn');
  ok(/automation looks stopped/i.test(sys.warn.txt), `STATUS: naming the actual problem (${sys.warn.txt})`);
  ok(/2 days ago/.test(sys.warn.txt), 'STATUS: with how long it has been quiet');
  ok(sys.warn.disabled === false && /Status/.test(sys.warn.label || ''), 'STATUS: and it becomes tappable, routed at the fix');

  // ---- STATUS, second signal: a stalled iCal feed ----
  // This line may not fetch, which is why only the cron was wired into it at first.
  // admin-bootstrap now carries per-cottage feed health in the payload loadData
  // already makes, so the second signal is free — and a stuck Airbnb sync stops
  // being something you discover via a double booking.
  const feed = await page.evaluate(async () => {
    const until = async (fn, ms = 6000) => { const t0 = Date.now(); for (;;) { const v = fn(); if (v) return v; if (Date.now() - t0 > ms) return null; await new Promise((r) => setTimeout(r, 50)); } };
    window.__cronStatusPre = { stale: false, everRan: true, ageHours: 2 }; // cron fine
    const el = document.getElementById('cmdk-sys');
    // A feed that has never imported is not "stalled" — the server omits those, and
    // a fresh one must not raise a warning either.
    window.__feedStatusPre = [{ pk: 'jollyboat', name: 'Jollyboat', ageHours: 3, failing: 0 }];
    chbSysLine();
    const fresh = { cls: el.className, txt: el.textContent.trim() };
    window.__feedStatusPre = [{ pk: 'jollyboat', name: 'Jollyboat', ageHours: 3, failing: 0 },
                              { pk: '21a', name: '21A Westgate', ageHours: 50, failing: 0 }];
    chbSysLine();
    const stale = { cls: el.className, txt: el.textContent.trim(), disabled: el.disabled };
    // An outright failing source beats mere staleness, whichever is older.
    window.__feedStatusPre = [{ pk: 'jollyboat', name: 'Jollyboat', ageHours: 4, failing: 2 },
                              { pk: '21a', name: '21A Westgate', ageHours: 80, failing: 0 }];
    chbSysLine();
    const failing = { txt: el.textContent.trim() };
    // The CRON still outranks a feed — everything else depends on it.
    window.__cronStatusPre = { stale: true, everRan: true, ageHours: 50 };
    chbSysLine();
    const both = { txt: el.textContent.trim() };
    window.__cronStatusPre = { stale: false, everRan: true, ageHours: 2 };
    window.__feedStatusPre = null;
    return { fresh, stale, failing, both };
  });
  ok(/All systems normal/.test(feed.fresh.txt), `FEED: a recently-synced feed says nothing (${feed.fresh.txt})`);
  ok(/is-warn/.test(feed.stale.cls) && /21A Westgate/.test(feed.stale.txt), `FEED: a stalled one names the cottage (${feed.stale.txt})`);
  ok(/2 days/.test(feed.stale.txt), 'FEED: and how long it has been stuck');
  ok(feed.stale.disabled === false, 'FEED: tappable, routed at the calendar settings');
  ok(/Jollyboat/.test(feed.failing.txt), `FEED: an outright FAILING source outranks a merely old one (${feed.failing.txt})`);
  ok(/automation looks stopped/i.test(feed.both.txt), `FEED: but the cron still outranks both — everything depends on it (${feed.both.txt})`);

  // ---- STEP 5: watchers ----
  const watch = await page.evaluate(async () => {
    const posts = [];
    const realPost = window.apiPost;
    // Stub the endpoint: watchers.php is admin-guarded and its rules are already
    // unit-tested in test-watchers.php. What matters here is the CLIENT contract.
    window.apiPost = async (url, body) => {
      if (String(url).includes('watchers.php')) {
        posts.push(body);
        if (body.action === 'list') return { watchers: [] };
        if (body.action === 'set') return { ok: true, watchers: [Object.assign({ id: 'wZZ' }, body.watcher)] };
        if (body.action === 'stop') return { ok: true, watchers: [] };
      }
      return realPost(url, body);
    };
    __chbUndo.length = 0;
    const g = { pk: 'jollyboat', from: '2027-03-10', to: '2027-03-13', nights: 3 };
    const act = chbWatchGapAction(g, { endIncl: '2027-03-12' });
    // Driven through cmdkAct, not by calling inline() directly: the undo push is
    // cmdkAct's job in the contract, so invoking the runner on its own would prove
    // nothing about whether a watcher is actually undoable in the product.
    const row = { type: 'answer', id: 'probe-gap', label: 'gap', sub: '', run: () => {}, actions: [act] };
    __cmdkResults = [row];
    __cmdkSel = 0;
    await cmdkAct(0, 0);
    const strip = document.querySelector('#cmdk .cmdk-actmsg');
    const out = {
      hasAction: !!act, key: act && act.key, label: act && act.label,
      say: strip ? strip.textContent.trim() : '',
      undoDepth: __chbUndo.length,
      undoLabel: __chbUndo[0] && __chbUndo[0].label,
      sent: posts.filter((p) => p.action === 'set').map((p) => p.watcher),
    };
    // Undo must actually stop it, through the stack the way the owner would.
    if (__chbUndo[0]) await __chbUndo[0].run();
    out.stopped = posts.some((p) => p.action === 'stop' && p.id === 'wZZ');
    window.apiPost = realPost;
    return out;
  });
  ok(watch.hasAction && watch.key === 'watch', `WATCH: a gap carries a watch action (${watch.label})`);
  ok(/I'll tell you on/.test(watch.say || ''), `WATCH: it says when it will speak (${watch.say})`);
  ok(watch.sent.length === 1 && watch.sent[0].kind === 'gap-unsold', 'WATCH: posted as a gap-unsold watcher');
  ok(watch.sent[0].tell < watch.sent[0].from, `WATCH: it speaks BEFORE the gap starts, not on the day (${watch.sent[0].tell} < ${watch.sent[0].from})`);
  ok(watch.undoDepth === 1 && /Watching/.test(watch.undoLabel || ''), `WATCH: setting one lands on the undo stack (${watch.undoLabel})`);
  ok(watch.stopped, 'WATCH: and undo actually stops it server-side');

  // ---- STEP 3: BULK — chase them all, in one tap ----
  // Driven the way the owner does it: search, look at the answer, TAP the action,
  // read the real confirm, press the real button. Nothing is called directly —
  // search-test §38 already pins the logic, so what is worth proving here is that
  // the affordance EXISTS on screen and that the dialog and the strip say the truth.
  // (Which mattered: the answer's three refine chips had been in its data since
  // long before the hero existed and rendered ZERO times once it became the hero,
  // so "the action is in the array" would have proved nothing about the screen.)
  const openOwed = () => page.evaluate(async () => {
    const until = async (fn, ms = 8000) => { const t0 = Date.now(); for (;;) { const v = fn(); if (v !== undefined && v !== null && v !== false && v !== -1) return v; if (Date.now() - t0 > ms) return null; await new Promise((r) => setTimeout(r, 50)); } };
    // The earlier probes in this file left entries on the stack, so the bulk
    // assertions measure from zero rather than assuming it.
    __chbUndo.length = 0;
    try { closeCmdK(); } catch (e) {}
    openCmdK();
    await until(() => document.getElementById('cmdk').classList.contains('open'));
    document.getElementById('cmdk-input').value = 'who owes me money';
    cmdkSearchCore('who owes me money', false);
    await until(() => __cmdkResults.length && __cmdkResults[0].type === 'answer');
    __cmdkSel = 0; cmdkRender();
    return await until(() => !!document.querySelector('#cmdk .cmdk-hero'));
  });

  await openOwed();
  const surf = await page.evaluate(() => {
    const qa = document.querySelectorAll('#cmdk .cmdk-qa-row');
    return {
      heroTxt: (document.querySelector('#cmdk .cmdk-hero-label') || {}).textContent || '',
      acts: [...qa].map((b) => b.textContent.trim()),
      // The chips that had been invisible: an answer's refine pivots.
      chips: [...document.querySelectorAll('#cmdk .cmdk-chip')].map((c) => c.textContent.trim()),
      dataChips: (__cmdkResults[0].chips || []).length,
    };
  });
  ok(/£955/.test(surf.heroTxt), `BULK: the answer knows the whole set (${surf.heroTxt.slice(0, 46)}…)`);
  ok(surf.acts.some((t) => /Request all 3 balances/.test(t)), `BULK: and offers to chase all of it in one tap (${surf.acts.join(' | ') || 'none'})`);
  ok(surf.chips.length === surf.dataChips && surf.chips.length > 0, `HERO: the answer's refine chips actually render (${surf.chips.length} of ${surf.dataChips} in the data)`);

  // CANCELLING claims nothing — the strongest version of that assertion is pressing
  // the dialog's own Cancel button, not stubbing the promise.
  const cancel = await page.evaluate(async () => {
    const until = async (fn, ms = 6000) => { const t0 = Date.now(); for (;;) { const v = fn(); if (v) return v; if (Date.now() - t0 > ms) return null; await new Promise((r) => setTimeout(r, 50)); } };
    const posts = [];
    const realPost = window.apiPost;
    window.apiPost = async (u, b) => { posts.push(b); return realPost(u, b); };
    const btn = [...document.querySelectorAll('#cmdk .cmdk-qa-row')].find((b) => /Request all/.test(b.textContent));
    btn.click();
    await until(() => document.getElementById('glass-dialog').classList.contains('open'));
    const msg = document.getElementById('glass-dialog-msg').textContent;
    const okLabel = document.getElementById('glass-dialog-ok').textContent.trim();
    document.getElementById('glass-dialog-cancel').click();
    await until(() => !document.getElementById('glass-dialog').classList.contains('open'));
    await new Promise((r) => setTimeout(r, 300));
    window.apiPost = realPost;
    return { msg, okLabel, sends: posts.filter((b) => b && b.action === 'request_payment').length,
             strip: (document.querySelector('#cmdk .cmdk-actmsg') || {}).textContent || '(none)',
             undo: __chbUndo.length };
  });
  ok(/Richard Berry/.test(cancel.msg) && /Cara Bell/.test(cancel.msg) && /Dan Rowe/.test(cancel.msg), 'BULK: the confirm names every recipient — one tap is only honest if you can see it');
  ok(/Dan Rowe[^\n]*will be skipped/.test(cancel.msg), 'BULK: including the one it will skip, said up front');
  ok(/Total to chase: £860/.test(cancel.msg), `BULK: totalling only what will really be chased (${(cancel.msg.match(/Total to chase: [^\n]*/) || [])[0]})`);
  ok(cancel.okLabel === 'Send 2 requests', `BULK: and the BUTTON states the real count (${cancel.okLabel})`);
  ok(cancel.sends === 0, `BULK: pressing Cancel sends nothing (${cancel.sends} requests)`);
  ok(cancel.strip === '(none)' && cancel.undo === 0, 'BULK: and claims nothing — no strip, no undo entry');

  // The OK button is ONE shared node, so a custom label has to be reassigned every
  // time or "Send 2 requests" turns up on the next ordinary confirm the owner sees.
  const leak = await page.evaluate(async () => {
    const until = async (fn, ms = 5000) => { const t0 = Date.now(); for (;;) { const v = fn(); if (v) return v; if (Date.now() - t0 > ms) return null; await new Promise((r) => setTimeout(r, 50)); } };
    const p = glassConfirm('Just an ordinary question?');
    await until(() => document.getElementById('glass-dialog').classList.contains('open'));
    const label = document.getElementById('glass-dialog-ok').textContent.trim();
    document.getElementById('glass-dialog-cancel').click();
    await p;
    return label;
  });
  ok(leak === 'OK', `BULK: a custom button label never leaks into the next plain confirm (${leak})`);

  // A confirm that LISTS its set is as long as the set. Measured without the
  // scroller, 30 owers pushed Send/Cancel to y=995 in a 780px viewport — a dialog
  // you cannot answer. It has to scroll inside the box, and the part that scrolls
  // out has to stay reachable rather than be clipped away.
  //
  // The VIEWPORT is set explicitly, and that is load-bearing: at this suite's
  // default 900×900 the buttons fit anyway, so the first assertion below passed
  // with the scroller deleted — a check that cannot fail is worse than no check.
  await page.setViewportSize({ width: 390, height: 780 });
  const long = await page.evaluate(async () => {
    const until = async (fn, ms = 5000) => { const t0 = Date.now(); for (;;) { const v = fn(); if (v) return v; if (Date.now() - t0 > ms) return null; await new Promise((r) => setTimeout(r, 50)); } };
    const lines = ['Send balance requests to 30 guests?', ''];
    for (let i = 0; i < 30; i++) lines.push(`Guest Number ${i + 1} — £${100 + i}.00 · Jollyboat`);
    const p = glassConfirm(lines.join('\n'), 'Send 30 requests');
    await until(() => document.getElementById('glass-dialog').classList.contains('open'));
    await new Promise((r) => setTimeout(r, 400));
    const m = document.getElementById('glass-dialog-msg');
    const btns = document.querySelector('.glass-dialog-btns').getBoundingClientRect();
    m.scrollTop = 99999;
    const out = { btnBottom: Math.round(btns.bottom), vh: window.innerHeight,
                  clipped: m.scrollHeight > m.clientHeight + 1, reached: m.scrollTop > 0 };
    document.getElementById('glass-dialog-cancel').click();
    await p;
    return out;
  });
  await page.setViewportSize({ width: 900, height: 900 });
  ok(long.btnBottom <= long.vh, `BULK: a 30-guest confirm keeps its buttons on screen (end ${long.btnBottom} of ${long.vh}px)`);
  ok(long.clipped && long.reached, 'BULK: and the rest of the list scrolls inside the box rather than being cut off');

  // CONFIRMING: two go, one can't, and the report says exactly that — in the WARN
  // state, because a green tick over "sent 2 of 3" is the colour contradicting the words.
  const sent = await page.evaluate(async () => {
    const until = async (fn, ms = 9000) => { const t0 = Date.now(); for (;;) { const v = fn(); if (v) return v; if (Date.now() - t0 > ms) return null; await new Promise((r) => setTimeout(r, 50)); } };
    const posts = [];
    const realPost = window.apiPost;
    window.apiPost = async (u, b) => { posts.push(b); return realPost(u, b); };
    const btn = [...document.querySelectorAll('#cmdk .cmdk-qa-row')].find((b) => /Request all/.test(b.textContent));
    btn.click();
    await until(() => document.getElementById('glass-dialog').classList.contains('open'));
    document.getElementById('glass-dialog-ok').click();
    await until(() => { const s = document.querySelector('#cmdk .cmdk-actmsg'); return s && !/is-busy/.test(s.className); });
    const s = document.querySelector('#cmdk .cmdk-actmsg');
    const out = { open: document.getElementById('cmdk').classList.contains('open'),
                  txt: s ? s.textContent.trim() : '(none)', cls: s ? s.className : '',
                  role: s ? s.getAttribute('role') : null,
                  ids: posts.filter((b) => b && b.action === 'request_payment').map((b) => b.id),
                  undo: __chbUndo.length };
    window.apiPost = realPost;
    return out;
  });
  ok(sent.open, 'BULK: search stays open through the whole batch');
  ok(sent.ids.length === 2 && !sent.ids.includes(3), `BULK: one request per reachable guest, none for the skipped one (ids ${sent.ids.join(',')})`);
  ok(/Sent 2 of 3/.test(sent.txt), `BULK: the report counts honestly (${sent.txt})`);
  ok(/Dan Rowe has no email address/.test(sent.txt), 'BULK: and names who was missed, so there is something to go and fix');
  ok(/is-warn/.test(sent.cls), `BULK: as a PARTIAL, not a green tick (${sent.cls})`);
  ok(sent.role === 'status', 'BULK: announced — nothing navigated, so there is no page change to notice');
  ok(sent.undo === 0, 'BULK: no undo offered — an email cannot be unsent');

  // ── ALREADY SENT IS NOT A FAILURE, AND IT IS CERTAINLY NOT A SUCCESS ──────────
  // Re-running a half-failed batch is meant to be safe: it recomputes from live
  // paymentSummary, so whoever still owes is chased again — and someone emailed a
  // minute ago still owes. The server's resend window therefore refuses exactly those.
  // Two ways to get this wrong, and the first shipped: count them as SENT (the 200
  // refusal was invisible, so the strip said "3 requests sent · £955 chased" for a
  // batch the server sent none of), or count them as FAILED, which reports "couldn't
  // reach Richard Berry" about a guest holding the email.
  const runBulk = () => page.evaluate(async () => {
    const until = async (fn, ms = 9000) => { const t0 = Date.now(); for (;;) { const v = fn(); if (v) return v; if (Date.now() - t0 > ms) return null; await new Promise((rr) => setTimeout(rr, 50)); } };
    const btn = [...document.querySelectorAll('#cmdk .cmdk-qa-row')].find((x) => /Request all/.test(x.textContent));
    if (!btn) return { txt: '(no bulk action)', cls: '' };
    btn.click();
    await until(() => document.getElementById('glass-dialog').classList.contains('open'));
    document.getElementById('glass-dialog-ok').click();
    await until(() => { const s = document.querySelector('#cmdk .cmdk-actmsg'); return s && !/is-busy/.test(s.className); });
    const s = document.querySelector('#cmdk .cmdk-actmsg');
    return { txt: s ? s.textContent.trim() : '(none)', cls: s ? s.className : '' };
  });

  refuseIds = [1]; // Richard already had his a minute ago; Cara has not
  await openOwed();
  const oneAlready = await runBulk();
  ok(/Sent 1 of 3/.test(oneAlready.txt), `RESEND: a refused repeat is not counted as sent (${oneAlready.txt})`);
  ok(/Richard Berry already had it just now/.test(oneAlready.txt), 'RESEND: …it is named as already having it');
  ok(!/couldn.t reach Richard Berry/i.test(oneAlready.txt), 'RESEND: …and NOT reported as unreachable, which is a different thing');
  ok(/is-warn/.test(oneAlready.cls), `RESEND: a partial stays a partial (${oneAlready.cls})`);

  refuseIds = [1, 2]; // everyone reachable already had theirs
  await openOwed();
  const allAlready = await runBulk();
  ok(/already had theirs just now/.test(allAlready.txt) && /nothing to re-send/.test(allAlready.txt),
    `RESEND: a batch where everyone already had it says so (${allAlready.txt})`);
  ok(!/is-err/.test(allAlready.cls) && !/Couldn.t send any/.test(allAlready.txt),
    `RESEND: …and is not thrown as a failure — the set is in the state asked for (${allAlready.cls})`);

  // The SINGLE-record path, which is where "Balance request sent — £NaN" was measured.
  refuseIds = [1];
  const single = await page.evaluate(async () => {
    const until = async (fn, ms = 6000) => { const t0 = Date.now(); for (;;) { const v = fn(); if (v) return v; if (Date.now() - t0 > ms) return null; await new Promise((rr) => setTimeout(rr, 50)); } };
    document.querySelectorAll('.toast').forEach((t) => t.remove());
    const p = requestPayment('b1', 'balance');
    await until(() => document.getElementById('glass-dialog').classList.contains('open'));
    document.getElementById('glass-dialog-ok').click();
    const went = await p;
    await new Promise((rr) => setTimeout(rr, 300));
    return { went, toasts: [...document.querySelectorAll('.toast')].map((t) => t.textContent.trim()).join(' | ') };
  });
  ok(single.went === false, `RESEND: previewAndSendEmail reports the SEND, not the confirmation (${single.went})`);
  ok(/has just gone to Richard Berry/.test(single.toasts), `RESEND: the owner is told the guest already has it (${single.toasts})`);
  ok(!/request sent/i.test(single.toasts) && !/NaN/.test(single.toasts),
    `RESEND: and never told it was sent, with or without a figure (${single.toasts})`);
  refuseIds = [];

  // ── A MAIL FAILURE IS A FAILURE, in every path that reports one ────────────────
  // Three of the four send actions returned a genuine SMTP failure as 200 + {error}, so
  // the £NaN toast and the false "sent" strip arrived from a dead mail server exactly as
  // they did from the resend window. send_arrival had always used 500; the others match
  // it now. The consumer here is real: the inline balance action renders its strip off
  // previewAndSendEmail's boolean.
  failIds = [1];
  const failInline = await page.evaluate(async () => {
    const until = async (fn, ms = 6000) => { const t0 = Date.now(); for (;;) { const v = fn(); if (v) return v; if (Date.now() - t0 > ms) return null; await new Promise((rr) => setTimeout(rr, 50)); } };
    document.querySelectorAll('.toast').forEach((t) => t.remove());
    const p = requestPayment('b1', 'balance');
    await until(() => document.getElementById('glass-dialog').classList.contains('open'));
    document.getElementById('glass-dialog-ok').click();
    const went = await p;
    await until(() => document.getElementById('glass-dialog').classList.contains('open'), 3000);
    const alertTxt = (document.getElementById('glass-dialog-msg') || {}).textContent || '';
    const c = document.getElementById('glass-dialog-cancel') || document.getElementById('glass-dialog-ok');
    if (c) c.click();
    return { went, alertTxt, toasts: [...document.querySelectorAll('.toast')].map((t) => t.textContent.trim()).join(' | ') };
  });
  ok(failInline.went === false, `MAILFAIL: a dead mail server is reported as not sent (${failInline.went})`);
  ok(/SMTP connect failed/.test(failInline.alertTxt), `MAILFAIL: …with the reason, not a shrug (${failInline.alertTxt.slice(0, 60)})`);
  ok(!/request sent/i.test(failInline.toasts) && !/NaN/.test(failInline.toasts),
    `MAILFAIL: and never toasted as sent, with or without a figure (${failInline.toasts || 'no toast'})`);

  await openOwed();
  const failBulk = await runBulk();
  ok(/Couldn.t send any/.test(failBulk.txt) || /Sent 1 of 3/.test(failBulk.txt),
    `MAILFAIL: the bulk report does not count a failed send (${failBulk.txt})`);
  ok(/couldn.t reach Richard Berry/i.test(failBulk.txt),
    'MAILFAIL: …and names them as unreachable, which is what a mail failure IS');
  ok(!/Richard Berry already had it/.test(failBulk.txt),
    'MAILFAIL: …not as already having it — a failure is not a duplicate');
  failIds = [];

  // A phone: the bulk action is the primary thing on that screen, so a lone action
  // must not sit in a half-width cell of the two-column grid with nothing beside it.
  await page.setViewportSize({ width: 390, height: 780 });
  await openOwed();
  const phone = await page.evaluate(() => {
    const row = [...document.querySelectorAll('#cmdk .cmdk-qa-row')].find((b) => /Request all/.test(b.textContent));
    if (!row) return null;
    const panel = row.closest('.cmdk-qa');
    return { row: Math.round(row.getBoundingClientRect().width), panel: Math.round(panel.getBoundingClientRect().width),
             label: Math.round(row.querySelector('.cmdk-qa-lbl').scrollWidth), shown: Math.round(row.querySelector('.cmdk-qa-lbl').clientWidth) };
  });
  ok(!!phone && phone.row > phone.panel * 0.9, `PHONE: the lone bulk action takes the full width (${phone && phone.row}px of ${phone && phone.panel}px)`);
  ok(!!phone && phone.label <= phone.shown + 1, `PHONE: and its words fit without truncating (${phone && phone.label} <= ${phone && phone.shown})`);
  await page.setViewportSize({ width: 900, height: 900 });

  console.log(fails ? `\n  ${fails} FAILED` : '\n  INLINE + UNDO + BULK OK');
  await done(fails);
})().catch(e=>{console.error('FAILED:',e.message);process.exit(1);});
