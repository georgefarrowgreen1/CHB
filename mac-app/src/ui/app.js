// ============================================================
//  app.js — the window's own script. Renderer side: no Node, no network.
//
//  SECOND ANATOMY (the approved redesign). The app answers the site all day
//  now, so the window is organised around the owner's three questions — is it
//  working (Home), what did it do (Activity), what runs when (Work) — with the
//  models in Library and every piece of touch-once plumbing in a Settings
//  window (the gear, or ⌘,). On a fresh install the setup checklist IS the
//  home screen, and it retires itself the moment its three steps are done.
//
//  Everything it knows comes from `window.hand`, the preload bridge, and every
//  string it puts on screen is escaped here at the render boundary — the same
//  rule the website follows: a guest's name with an apostrophe in it must be
//  escaped exactly once, at the point it becomes HTML.
//
//  A pattern worth keeping: every screen renders from ONE state object fetched
//  in one call (`hand.state()`), and every action ends by re-fetching it.
// ============================================================
'use strict';
(function () {
    var S = null;              // the last state we were given
    var view = 0;
    var filter = 'all';        // Activity's filter
    var searchT = null;
    var toastT = null;

    var $ = function (id) { return document.getElementById(id); };
    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    function toast(say) {
        var t = $('toast');
        $('toastSays').textContent = String(say || '');
        t.hidden = false;
        clearTimeout(toastT);
        toastT = setTimeout(function () { t.hidden = true; }, 4200);
    }

    var TITLES = [
        ['Home', function () { return S ? heroLine().say : ''; }],
        ['Activity', function () { return S ? (S.asks.today + ' answered today') : ''; }],
        ['Work', function () { return S ? onCount() + ' job' + (onCount() === 1 ? '' : 's') + ' on' : ''; }],
        ['Library', function () { return S ? S.models.length + ' installed' : ''; }],
        ['Chat', function () { return C && C.thread.length ? Math.ceil(C.thread.length / 2) + ' turns, on this Mac only' : 'a private conversation'; }],
    ];
    function onCount() {
        return S.jobs.filter(function (j) { return j.on; }).length;
    }
    function replyJob() {
        return S.jobs.filter(function (j) { return j.id === 'reply'; })[0] || {};
    }
    // The three setup steps, judged from the same state everything renders from.
    function setup() {
        return {
            connected: !!S.secretSet,
            hasModel: S.models.length > 0,
            jobOn: !!replyJob().on,
        };
    }
    function setupDone() {
        var st = setup();
        return st.connected && st.hasModel && st.jobOn;
    }

    // What to say about starting the model server — running first, then the
    // reason it cannot start, then what starting would do.
    function runnerNote(R) {
        if (!R || !R.available) { return ''; }
        if (!R.canStart) {
            return 'This app only starts llama.cpp. Ollama runs its own service and MLX is a sidecar you start yourself.';
        }
        if (R.running) { return 'This app started it, and will stop it when the app quits.'; }
        if (R.problem) { return R.problem; }
        return 'Found at ' + R.path + '. This app can start it for you — no Terminal needed.';
    }

    function go(i) {
        view = i;
        Array.prototype.forEach.call(document.querySelectorAll('.snav[data-v]'), function (n) {
            if (parseInt(n.getAttribute('data-v'), 10) === i) { n.setAttribute('aria-current', 'true'); } else { n.removeAttribute('aria-current'); }
        });
        [0, 1, 2, 3, 4].forEach(function (j) {
            var el = $('v' + j);
            if (j === i) { el.removeAttribute('hidden'); } else { el.setAttribute('hidden', ''); }
        });
        paintTitle();
        // Chat loads lazily on first open — its thread is a file the other
        // screens never need — and the cursor lands in the box, ready.
        if (i === 4) {
            chatLoad().then(function () { try { $('chatIn').focus(); } catch (e) { /* not painted */ } });
        }
    }
    function paintTitle() {
        $('tbTitle').textContent = TITLES[view][0];
        $('tbSub').textContent = TITLES[view][1]() || '';
    }

    // ── SETTINGS, the window (⌘, or the gear) ───────────────────────────
    function openSettings(tab) {
        $('setScrim').hidden = false;
        setTab(typeof tab === 'number' ? tab : 0);
        // A fresh install has exactly one thing to fill in — the code — so the
        // cursor is already in it. With a key stored nothing is grabbed.
        if (S && !S.secretSet) {
            try { $('codeIn').focus(); } catch (e) { /* not painted yet */ }
        }
    }
    function setTab(i) {
        Array.prototype.forEach.call(document.querySelectorAll('.stab'), function (t) {
            t.setAttribute('aria-pressed', parseInt(t.getAttribute('data-st'), 10) === i ? 'true' : 'false');
        });
        [0, 1, 2].forEach(function (j) {
            var el = $('st' + j);
            if (j === i) { el.removeAttribute('hidden'); } else { el.setAttribute('hidden', ''); }
        });
    }

    // ── HOME's verdict ───────────────────────────────────────────────────
    function heroLine() {
        var st = setup();
        if (S.running) {
            return { say: 'Working…', sub: 'Drafting now — the log lands under Activity when it finishes.', live: false };
        }
        if (!st.connected) {
            return { say: 'Not connected yet', sub: 'Type the code from your website — it takes a minute, below.', live: false };
        }
        var lastHit = null;
        for (var i = (S.asks.log || []).length - 1; i >= 0; i--) {
            if (S.asks.log[i].level === 'hit') { lastHit = S.asks.log[i]; break; }
        }
        var r = replyJob();
        var sub = (lastHit ? 'The last ask was answered at ' + lastHit.at + '.' : 'Nothing asked yet today.')
            + (r.on ? ' Tonight at ' + (r.at || '02:00') + ' it drafts replies for whatever is waiting.' : '');
        return { say: 'All quiet — listening for the website', sub: sub, live: true };
    }

    // One feed row. `kind` decides the icon family; the line's own LEVEL
    // decides its colour, exactly as the old log did.
    function feedRow(l, kind) {
        var lvl = esc(l.level || 'info');
        var ref = lvl === 'fail';
        var ico = ref ? '✕' : kind === 'ask' ? '✦' : '☾';
        var icoCls = ref ? 'ref' : (lvl === 'hit' || lvl === 'done') ? (kind === 'ask' ? '' : 'night') : 'quiet';
        var k = kind + (ref ? ' ref' : '');
        return '<div class="arow" data-k="' + esc(k) + '">' +
            '<span class="aico ' + icoCls + '">' + ico + '</span>' +
            '<span class="amain ' + lvl + '">' + esc(l.say) + '</span>' +
            '<span class="awhen">' + esc(l.at || '') + '</span></div>';
    }
    function nightSummary(n) {
        return n.posted ? 'posted ' + n.posted : n.drafted ? 'drafted ' + n.drafted + ', posted none' : 'nothing to post';
    }

    // ── render ───────────────────────────────────────────────────────────
    function render() {
        if (!S) { return; }
        var st = setup();
        var r = replyJob();
        $('jobsBadge').textContent = String(onCount());
        $('modelsBadge').textContent = String(S.models.length);
        $('actBadge').textContent = String(S.asks.today || 0);
        $('stateDot').className = 'dot' + (S.running ? ' busy' : !S.secretSet ? ' off' : '');
        $('stateSays').textContent = S.running ? 'Working…'
            : !S.secretSet ? 'Not connected'
            : !setupDone() ? 'Nearly set up' : 'Listening';
        $('homeLive').hidden = !(st.connected && !S.running);
        $('runBtn').disabled = !!S.running;
        $('runBtn').textContent = S.running ? 'Working…' : 'Run now';
        if (!S.running) { $('runSub').textContent = ''; }

        // HOME — the checklist until setup is done, the heartbeat after.
        var fresh = !setupDone();
        var hero = heroLine();
        var crownWrap = $('heroBox').querySelector('.verdict');
        crownWrap.querySelector('.cwrap') || (function () {
            // Wrap the crown once so the halo has a box to ring.
            var img = $('heroCrown');
            var w = document.createElement('span');
            w.className = 'cwrap';
            img.parentNode.insertBefore(w, img);
            w.appendChild(img);
        })();
        crownWrap.querySelector('.cwrap').className = 'cwrap' + (hero.live && !fresh ? ' live' : '');
        $('heroSay').textContent = fresh ? 'Three things, then it runs itself' : hero.say;
        $('heroSub').textContent = fresh
            ? 'Setup is the home screen until it’s done — no wizard to find, no order to guess.'
            : hero.sub;
        $('factsBox').hidden = fresh;
        $('checkBox').hidden = !fresh;
        $('latestCap').hidden = fresh;
        $('latestBox').hidden = fresh;
        if (!fresh) {
            $('factAsks').textContent = String(S.asks.today || 0);
            $('factNight').textContent = r.on ? (r.at || '02:00') : 'Off';
            $('factNightSub').textContent = r.on ? 'tonight it drafts replies for whatever is waiting' : 'the reply job is switched off under Work';
            var Rt = S.runner || {};
            var willStart = !S.engineServing && Rt.available && Rt.canStart && Rt.autoStart && !Rt.problem;
            $('factEng').textContent = S.engineServing ? 'Warm' : willStart ? 'Starts' : 'Cold';
            $('factEngSub').textContent = S.engineServing
                ? esc(S.engineName) + (r.model ? ' · ' + r.model : '') + ' — ready to answer'
                : willStart ? 'the engine starts itself when work is due'
                : 'nothing answering, and nothing this app can start — see Settings → Engine';
            // The latest — the last few things it did, newest first; before
            // anything has happened at all, the honest offer is Run now.
            var latest = (S.asks.log || []).slice(-3).reverse()
                .map(function (l) { return feedRow(l, 'ask'); }).join('');
            if (!latest && S.nights[0]) {
                latest = feedRow({ at: '', say: 'Last night: ' + nightSummary(S.nights[0]), level: S.nights[0].ok ? 'hit' : 'fail' }, 'night');
            }
            $('latestBox').innerHTML = latest;
            $('latestBox').hidden = !latest;
            $('latestCap').hidden = !latest;
            $('homeNote').innerHTML = latest
                ? 'Everything it has done is under <strong>Activity</strong> — the asks and the nights together.'
                : 'Nothing yet. Press <strong>Run now</strong> to try it, or wait for ' + esc(r.at || '02:00') + '.';
        } else {
            // THE CHECKLIST. Each step is actionable IN PLACE, and each is
            // judged from the same state everything else renders from.
            $('homeNote').textContent = '';
            $('checkBox').innerHTML =
                '<div class="row"><span class="stepn' + (st.connected ? ' done' : '') + '">' + (st.connected ? '✓' : '1') + '</span>' +
                '<div class="main"><b>Connect to the website</b><span>' +
                (st.connected ? 'Done — this Mac is paired and the site can ask it questions.'
                    : 'Type the code from Manage → System check → Connect a Mac.') + '</span></div>' +
                '<div class="rail">' + (st.connected ? '<span class="chip ok">Connected</span>'
                    : '<button class="tbtn prime" type="button" id="stepConnect">Open Settings…</button>') + '</div></div>' +
                '<div class="row"><span class="stepn' + (st.hasModel ? ' done' : '') + '">' + (st.hasModel ? '✓' : '2') + '</span>' +
                '<div class="main"><b>Add a model</b><span>' +
                (st.hasModel ? esc(S.models[0].name) + ' is ready.'
                    : 'On 16 GB, an 8B or 14B at Q4 is the place to start. Every result says whether it fits this Mac.') + '</span></div>' +
                '<div class="rail">' + (st.hasModel ? '<span class="chip ok">Ready</span>'
                    : '<button class="tbtn prime" type="button" id="stepAdd">Add model…</button>') + '</div></div>' +
                '<div class="row"><span class="stepn' + (st.jobOn ? ' done' : '') + '">' + (st.jobOn ? '✓' : '3') + '</span>' +
                '<div class="main"><b>Turn on the reply job</b><span>Nightly drafts for waiting enquiries — read and sent by you, never by it.</span></div>' +
                '<div class="rail">' + (st.jobOn ? '<span class="chip ok">On</span>'
                    : st.hasModel ? '<button class="sw" type="button" id="stepJob" aria-label="Turn on the reply job" aria-pressed="false"></button>'
                    : '<span class="chip n">Waiting on step 2</span>') + '</div></div>' +
                '<div class="row"><div class="main"><span>The daytime asks — search, chat drafts, summaries — start by themselves the moment the steps are done.</span></div></div>';
        }

        // ACTIVITY — one timeline: today's asks, then each kept night.
        var feed = '';
        var todayLines = (S.asks.log || []).slice().reverse();
        if (todayLines.length) {
            feed += '<div class="dayhead" data-k="ask">Today</div>'
                + todayLines.map(function (l) { return feedRow(l, 'ask'); }).join('');
        }
        S.nights.slice(0, 8).forEach(function (n) {
            var when = String(n.started || '').replace('T', ' ').slice(0, 16);
            feed += '<div class="dayhead" data-k="night ref">' + esc(when) + ' · ' + esc(nightSummary(n))
                + (n.failed ? ' · ' + n.failed + ' problem' + (n.failed === 1 ? '' : 's') : '') + '</div>'
                + (n.log || []).map(function (l) { return feedRow(l, 'night'); }).join('');
        });
        $('feed').innerHTML = feed
            || '<div class="arow"><span class="aico quiet">·</span><span class="amain info">Nothing yet. Press <strong>Run now</strong> to try it, or wait for ' + esc(r.at || '02:00') + '.</span></div>';
        $('logNote').textContent = feed ? 'Kept 30 nights, on this Mac only.' : '';
        applyFilter();

        // WORK — grouped by its own clock, the always-on asks first.
        var opts = function (j) {
            return ['<option value="">Choose a model…</option>'].concat(S.models.map(function (m) {
                return '<option value="' + esc(m.id) + '"' + (m.id === j.model ? ' selected' : '') + '>' + esc(m.name) + ' · ' + m.sizeGB + ' GB</option>';
            })).join('');
        };
        var jobRow = function (j) {
            return '<div class="row">' +
                '<div class="main"><b>' + esc(j.name) + '</b><span>' + esc(j.what) + '</span></div>' +
                '<div class="rail">' +
                '<select class="pop" data-job-model="' + esc(j.id) + '" aria-label="Model for ' + esc(j.name) + '">' + opts(j) + '</select>' +
                '<button class="sw' + (j.on ? ' on' : '') + '" type="button" data-job-on="' + esc(j.id) + '"' +
                ' aria-label="' + esc(j.name) + '" aria-pressed="' + (j.on ? 'true' : 'false') + '"></button>' +
                '</div></div>';
        };
        var built = S.jobs.filter(function (j) { return j.built; });
        var bySched = function (sch) { return built.filter(function (j) { return j.schedule === sch; }); };
        var group = function (label, rows) {
            return rows.length ? '<div class="grouphead">' + label + '</div><div class="box">' + rows.map(jobRow).join('') + '</div>' : '';
        };
        $('jobsBox').innerHTML =
            '<div class="grouphead">While the app is open</div><div class="box"><div class="row">' +
            '<div class="main"><b>Answer the website’s asks</b><span>Search phrasings, chat drafts, grounded summaries — in seconds, whenever the site asks. No switch: it’s what the app is.</span></div>' +
            '<div class="rail"><span class="chip ' + (st.connected ? 'ok' : 'warn') + '" id="askChip">' + (st.connected ? 'Listening' : 'Needs a code') + '</span></div></div></div>' +
            group('Every night · ' + esc(r.at || '02:00'), bySched('nightly')) +
            group('Sunday night', bySched('weekly-sun')) +
            group('Monday morning', bySched('weekly-mon'));
        var coming = S.jobs.filter(function (j) { return !j.built; }).map(function (j) { return j.name.toLowerCase(); });
        $('jobsComing').textContent = coming.length ? 'Coming next: ' + coming.join(' · ') + '.' : '';
        // The week strip — dots derived from what is actually ON.
        var nightlyOn = bySched('nightly').some(function (j) { return j.on; });
        var sunOn = bySched('weekly-sun').filter(function (j) { return j.on; }).length;
        var monOn = bySched('weekly-mon').filter(function (j) { return j.on; }).length;
        var today = new Date().getDay();
        var DL = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
        var days = [1, 2, 3, 4, 5, 6, 0]; // painted Monday-first
        $('weekBox').innerHTML = '<div class="week">' + days.map(function (d) {
            var dots = '';
            if (d === 1) { for (var a = 0; a < monOn; a++) { dots += '<i class="n"></i>'; } }
            if (d === 0) { for (var b = 0; b < sunOn; b++) { dots += '<i class="n"></i>'; } }
            if (nightlyOn) { dots += '<i></i>'; }
            return '<div class="wday' + (d === today ? ' today' : '') + '"><div class="dl">' + DL[d] + '</div>' +
                '<div class="dots">' + dots + '</div></div>';
        }).join('') + '</div><div class="weekkey"><span><i></i>Nightly reply drafts</span><span class="k2"><i></i>Weekly notes</span></div>';

        // LIBRARY — each model wearing its role, derived from Work's choices
        // so the two screens cannot disagree. The smallest GGUF also answers
        // the website's asks — that preference lives in the core, so it is
        // stated here rather than switched here.
        var smallest = null;
        S.models.forEach(function (m) {
            if (m.format !== 'mlx' && (!smallest || m.sizeGB < smallest.sizeGB)) { smallest = m; }
        });
        var JOBSAY = { reply: 'reply drafts', answer: 'guests’ answers', teach: 'search teaching', week: 'the Monday note', price: 'gap pricing' };
        $('modelsBox').innerHTML = S.models.length
            ? S.models.map(function (m) {
                var uses = built.filter(function (j) { return j.on && j.model === m.id; }).map(function (j) { return JOBSAY[j.id] || j.id; });
                var small = smallest && m.id === smallest.id && st.connected;
                if (small) { uses.push('the website’s asks (the smallest answers in a second)'); }
                var role = uses.length ? (small && uses.length === 1 ? 'answers in a second' : 'writes the prose') : 'unused';
                return '<div class="row"><div class="main"><b>' + esc(m.name) +
                    ' <span class="role' + (uses.length ? '' : ' dim') + '">' + role + '</span></b>' +
                    '<span class="mono">' + esc(m.id) + ' · ' + esc(m.quant || m.format) + ' · ' + m.sizeGB + ' GB</span>' +
                    '<span>' + (uses.length ? esc(uses.join(' · ')) : 'Nothing points at it — choose it on a job under Work, or delete the file.') + '</span></div>' +
                    '<div class="rail">' + chip(m.fit, m.why) + '</div></div>';
            }).join('')
            : '<div class="row"><div class="main"><b>No models yet</b><span>Press <strong>Add model…</strong>. On 16 GB, an 8B or 14B at Q4 is the place to start.</span></div></div>';
        $('modelsNote').textContent = 'A model is a file — delete it in the Models folder and it leaves this list.';

        // SETTINGS — Website pane.
        $('siteSays').textContent = (S.siteIsDefault ? '' : 'Your own address: ')
            + S.siteUrl.replace(/^https:\/\//, '').replace(/\/nightshift\.php$/, '');
        // The RAW setting, not the resolved one — empty means "the standard address".
        if ($('siteUrl') !== document.activeElement) { $('siteUrl').value = S.siteRaw || ''; }
        if (!S.siteIsDefault) { $('siteEditRow').hidden = false; }
        $('secretSays').textContent = S.keychain
            ? (S.secretSet ? 'One is stored in the macOS Keychain. It is never shown, here or anywhere.'
                : 'None stored yet. Connect above, or paste a key the website generated.')
            : 'The Keychain is only available on macOS, so no secret can be stored on this machine.';

        // SETTINGS — Engine pane.
        var R = S.runner || {};
        $('engineBox').innerHTML = S.engines.map(function (e) {
            var startable = R.canStart && R.available && S.engine === e.id && !e.serving;
            var stoppable = R.running && S.engine === e.id && e.serving;
            var act = '';
            if (stoppable) {
                act = '<button class="tbtn" type="button" id="stopEng">Stop</button>';
            } else if (startable) {
                act = '<button class="tbtn prime" type="button" id="startEng"'
                    + (R.problem ? ' disabled' : '') + '>Start</button>';
            }
            return '<div class="row' + (e.usable ? '' : ' dim') + '">' +
                '<div class="main"><b>' + esc(e.name) + '</b><span>' + esc(e.usable ? e.note : e.why) + '</span></div>' +
                '<div class="rail">' + chip(e.serving ? 'ok' : 'n', e.serving ? 'Serving on ' + esc(e.base).replace('http://', '') : 'Not answering') +
                act +
                '<button class="tbtn' + (S.engine === e.id ? ' prime' : '') + '" type="button" data-engine="' + esc(e.id) + '"' +
                (e.usable ? '' : ' disabled') + '>' + (S.engine === e.id ? 'In use' : 'Use this') + '</button>' +
                '</div></div>';
        }).join('');
        $('runnerNote').textContent = runnerNote(R);
        $('runnerNote').hidden = !runnerNote(R);
        $('runnerFix').hidden = !(R.install && !R.found);
        $('runnerFix').textContent = R.install || '';
        $('autoSw').className = 'sw' + (R.autoStart ? ' on' : '');
        $('autoSw').setAttribute('aria-pressed', R.autoStart ? 'true' : 'false');

        // SETTINGS — General pane.
        $('machineBox').innerHTML =
            row('This Mac', esc(S.machineSays), chip(S.machine.appleSilicon ? 'ok' : 'n', S.machine.appleSilicon ? 'Apple silicon' : 'Intel')) +
            row('Open this app at login', 'Asks are only answered while the app is running.',
                '<button class="sw' + ((R.openAtLogin) ? ' on' : '') + '" type="button" id="loginSw" aria-label="Open this app at login" aria-pressed="' + (R.openAtLogin ? 'true' : 'false') + '"></button>', true) +
            row('Keep the Mac awake for a run', 'Overnight work needs a Mac that isn’t asleep.',
                '<button class="sw' + (S.keepAwake ? ' on' : '') + '" type="button" id="awakeSw" aria-label="Keep the Mac awake" aria-pressed="' + (S.keepAwake ? 'true' : 'false') + '"></button>', true);

        paintTitle();
    }
    function row(label, sub, rail, alt) {
        return '<div class="row' + (alt ? ' alt' : '') + '"><div class="main"><b>' + label + '</b><span>' + sub + '</span></div>' +
            '<div class="rail">' + (rail || '') + '</div></div>';
    }
    function chip(kind, say) {
        return '<span class="chip ' + esc(kind || 'n') + '">' + esc(say || '') + '</span>';
    }
    function applyFilter() {
        Array.prototype.forEach.call(document.querySelectorAll('#feed [data-k]'), function (el) {
            var ks = (el.getAttribute('data-k') || '').split(' ');
            if (filter === 'all' || ks.indexOf(filter) >= 0) { el.removeAttribute('hidden'); } else { el.setAttribute('hidden', ''); }
        });
    }

    // ── THE CHAT ─────────────────────────────────────────────────────────
    // One thread, held by the main process (chats.json). The window renders
    // whatever it is handed and escapes it here — a model's reply is TEXT
    // whatever markup it writes, the same rule the feed follows.
    var C = null;              // { thread, model } — the last chat state handed over
    var chatWaiting = false;   // a send in flight → the thinking bubble
    async function chatLoad() {
        if (!window.hand.chatHistory) { return; }
        try { C = await window.hand.chatHistory(); } catch (e) { C = { thread: [], model: '' }; }
        renderChat();
    }
    function chatBubble(m) {
        return '<div class="bub ' + (m.role === 'user' ? 'user' : 'bot') + '">' + esc(m.text)
            + (m.at ? '<span class="bmeta">' + esc(m.at) + '</span>' : '') + '</div>';
    }
    function renderChat() {
        if (!C) { return; }
        var log = $('chatLog');
        var html = (C.thread || []).map(chatBubble).join('');
        if (!html && !chatWaiting) {
            html = '<div class="chatempty"><b>Ask your Mac anything</b>'
                + 'The same model that drafts your replies, talking just to you. '
                + 'It starts the engine itself on your first message.</div>';
        }
        if (chatWaiting) {
            html += '<div class="bub bot think" aria-hidden="true"><i></i><i></i><i></i></div>';
        }
        log.innerHTML = html;
        log.scrollTop = log.scrollHeight;
        // The model picker — the owner's pick, else the reply job's, said so.
        var sel = $('chatModel');
        if (S && sel !== document.activeElement) {
            sel.innerHTML = S.models.length
                ? S.models.map(function (m) {
                    return '<option value="' + esc(m.id) + '"' + (m.id === C.model ? ' selected' : '') + '>' + esc(m.name) + ' · ' + m.sizeGB + ' GB</option>';
                }).join('')
                : '<option value="">No models yet</option>';
        }
        $('chatNote').textContent = !S ? ''
            : !S.models.length ? 'Add a model under Library first — the chat uses whichever one you pick here.'
            : !S.engineServing ? 'The engine is cold — it starts itself on your first message, which adds a few seconds once.'
            : '';
        if (view === 4) { paintTitle(); }
    }
    async function chatSend() {
        var box = $('chatIn');
        var text = String(box.value || '').trim();
        if (!text || chatWaiting) { return; }
        // Optimistic: the question is on screen at once; the main process is
        // appending the same message to the thread, and the reload after the
        // answer reconciles the two.
        C = C || { thread: [], model: '' };
        C.thread = C.thread.concat([{ role: 'user', text: text, at: '' }]);
        chatWaiting = true;
        box.value = '';
        $('chatSendBtn').disabled = true;
        renderChat();
        var r = null;
        try {
            r = await window.hand.chatSend(text);
        } catch (e) {
            r = { ok: false, say: 'The app could not reach its own engine.' };
        }
        chatWaiting = false;
        $('chatSendBtn').disabled = false;
        if (!r || !r.ok) {
            // The refusal is the main process's own sentence — engine cold and
            // unstartable, no model, tonight's run holding the engine.
            toast((r && r.say) || 'The model did not answer.');
            await chatLoad();
            box.value = text; // their words come back rather than vanishing
            box.focus();
            return;
        }
        await chatLoad();
        $('chatLive').textContent = 'Replied: ' + r.reply.slice(0, 120);
        if (r.tokensPerSec) {
            $('chatNote').textContent = esc0(r.model) + ' · ' + r.tokensPerSec + ' tokens a second, on this Mac';
        }
        box.focus();
    }
    // textContent needs no escaping — this exists so the linter-visible intent
    // ("this is a display string") survives refactors that move it to HTML.
    function esc0(v) { return String(v == null ? '' : v); }

    async function refresh() {
        try {
            S = await window.hand.state();
        } catch (e) {
            toast('The app could not read its own state.');
            return;
        }
        render();
    }

    // ── actions ──────────────────────────────────────────────────────────
    document.addEventListener('click', async function (ev) {
        var t = ev.target;
        var nav = t.closest ? t.closest('.snav[data-v]') : null;
        if (nav) { go(parseInt(nav.getAttribute('data-v'), 10) || 0); return; }
        if (t.id === 'gearBtn' || (t.closest && t.closest('#gearBtn'))) { openSettings(0); return; }
        if (t.id === 'setClose') { $('setScrim').hidden = true; return; }
        var stab = t.closest ? t.closest('.stab') : null;
        if (stab) { setTab(parseInt(stab.getAttribute('data-st'), 10) || 0); return; }
        var fc = t.closest ? t.closest('.fchip') : null;
        if (fc) {
            filter = fc.getAttribute('data-f') || 'all';
            Array.prototype.forEach.call(document.querySelectorAll('.fchip'), function (x) {
                x.setAttribute('aria-pressed', x === fc ? 'true' : 'false');
            });
            applyFilter();
            return;
        }
        if (t.id === 'chatSendBtn') { chatSend(); return; }
        if (t.id === 'chatNew') {
            if (window.hand.chatClear) { await window.hand.chatClear(); }
            await chatLoad();
            $('chatIn').focus();
            return;
        }
        // The checklist's own controls.
        if (t.id === 'stepConnect') { openSettings(0); return; }
        if (t.id === 'stepAdd') { openSheet(); return; }
        if (t.id === 'stepJob') {
            var jr = await window.hand.saveConfig({ job: { id: 'reply', on: true } });
            if (!jr.ok) { toast(jr.say); }
            await refresh();
            if (setupDone()) { toast('That’s everything — it runs itself from here.'); }
            return;
        }

        var on = t.closest ? t.closest('[data-job-on]') : null;
        if (on) {
            var id = on.getAttribute('data-job-on');
            var j = S.jobs.filter(function (x) { return x.id === id; })[0] || {};
            if (!j.on && !j.model) { toast('Choose a model for that job first.'); return; }
            var r = await window.hand.saveConfig({ job: { id: id, on: !j.on } });
            if (!r.ok) { toast(r.say); }
            await refresh();
            return;
        }
        var eng = t.closest ? t.closest('[data-engine]') : null;
        if (eng && !eng.disabled) {
            await window.hand.saveConfig({ engine: eng.getAttribute('data-engine') });
            await refresh();
            return;
        }
        if (t.id === 'awakeSw') {
            await window.hand.saveConfig({ keepAwake: !S.keepAwake });
            await refresh();
            return;
        }
        if (t.id === 'runBtn') {
            $('runBtn').disabled = true;
            $('runBtn').textContent = 'Working…';
            var res = await window.hand.runNow();
            await refresh();
            go(0);
            toast(res.ok
                ? (res.night && res.night.posted ? 'Posted ' + res.night.posted + ' to the site — they’re on Today, under Ready for you.' : 'Ran — nothing to post.')
                : (res.say || 'It could not finish.'));
            return;
        }
        if (t.id === 'startEng') {
            // It takes tens of seconds and the button says so — a control that
            // looks stuck is one people press again.
            $('startEng').disabled = true;
            $('startEng').textContent = 'Starting…';
            var sr = await window.hand.startEngine();
            await refresh();
            toast(sr && sr.ok ? (sr.say || 'Started.') : ((sr && sr.say) || 'It did not start.'));
            return;
        }
        if (t.id === 'stopEng') {
            var xr = await window.hand.stopEngine();
            await refresh();
            toast(xr && xr.ok ? 'Stopped.' : ((xr && xr.say) || 'It did not stop.'));
            return;
        }
        if (t.id === 'autoSw') {
            await window.hand.saveConfig({ autoStart: !(S.runner || {}).autoStart });
            await refresh();
            return;
        }
        if (t.id === 'loginSw') {
            await window.hand.saveConfig({ openAtLogin: !(S.runner || {}).openAtLogin });
            await refresh();
            return;
        }
        if (t.id === 'keyShow') {
            $('keyReveal').hidden = true;
            $('keyRow').hidden = false;
            $('secretIn').focus();
            return;
        }
        if (t.id === 'siteEdit') {
            var er = $('siteEditRow');
            er.hidden = !er.hidden;
            if (!er.hidden) { $('siteUrl').focus(); }
            return;
        }
        if (t.id === 'addBtn') { openSheet(); return; }
        if (t.id === 'cancelBtn') { $('scrim').hidden = true; return; }
        if (t.id === 'doConnect') {
            var code = $('codeIn').value;
            if (!code.trim()) { toast('Type the code the website is showing.'); return; }
            $('doConnect').disabled = true;
            var cr = await window.hand.connect(code.trim());
            $('doConnect').disabled = false;
            if (!cr || !cr.ok) {
                // The SITE's own sentence — it knows whether the code was
                // expired, used, wrong, or never minted.
                toast((cr && cr.say) || 'That code did not work.');
                return;
            }
            $('codeIn').value = '';
            toast('Connected' + (cr.host ? ' to ' + cr.host : '') + '.');
            refresh();
            return;
        }
        if (t.id === 'saveSecret') {
            var v = $('secretIn').value;
            if (!v.trim()) { toast('Paste the key first.'); return; }
            var sr2 = await window.hand.setSecret(v.trim());
            $('secretIn').value = '';
            toast(sr2.ok ? 'Saved to the Keychain.' : sr2.say);
            await refresh();
            return;
        }
        if (t.id === 'testBtn') {
            $('connChip').className = 'chip n';
            $('connChip').textContent = 'Testing…';
            var tr = await window.hand.testSite();
            $('connChip').className = 'chip ' + (tr.state === 'on' ? 'ok' : tr.state === 'off' ? 'warn' : 'bad');
            $('connChip').textContent = tr.state === 'on' ? 'On' : tr.state === 'off' ? 'Off' : tr.state === 'auth' ? 'Key refused' : 'Unreachable';
            $('connSays').textContent = tr.say;
            return;
        }
        var repo = t.closest ? t.closest('[data-repo]') : null;
        if (repo) {
            var rid = repo.getAttribute('data-repo');
            $('results').innerHTML = '<p class="tiny sheet-msg">Reading what is inside ' + esc(rid) + '…</p>';
            var fr = await window.hand.modelFiles(rid);
            if (!fr.ok) {
                $('results').innerHTML = '<p class="tiny sheet-msg">' + esc(fr.say) + '</p>';
                return;
            }
            if (!fr.rows.length) {
                $('results').innerHTML = '<p class="tiny sheet-msg">No single-file GGUF in that repo.'
                    + (fr.sharded ? ' It is split across several files, which this build cannot join yet.' : '') + '</p>';
                return;
            }
            $('results').innerHTML = fr.rows.map(function (fx) {
                var dl = JSON.stringify({ url: fx.url, filename: fx.filename, name: fx.quant || fx.filename });
                return '<div class="mrow"><span class="main"><b>' + esc(fx.quant || 'GGUF') + '</b>' +
                    '<span>' + esc(fx.filename) + '</span></span>' + chip(fx.fit, fx.why) +
                    '<span class="sz">' + (fx.sizeGB ? fx.sizeGB + ' GB' : '?') + '</span>' +
                    '<button class="tbtn' + (fx.fit === 'no' ? '' : ' prime') + '" type="button" data-dl=\'' +
                    esc(dl).replace(/&#39;/g, '&apos;') + '\'>' + (fx.fit === 'no' ? 'Anyway' : 'Download') + '</button></div>';
            }).join('') + '<p class="tiny sheet-foot">Sizes here are the real file sizes, so the verdicts are facts rather than estimates.</p>';
            return;
        }
        var mrow = t.closest ? t.closest('[data-dl]') : null;
        if (mrow) {
            var payload = JSON.parse(mrow.getAttribute('data-dl'));
            $('scrim').hidden = true;
            toast('Downloading ' + payload.name + '…');
            var dr = await window.hand.downloadModel(payload);
            toast(dr.ok ? payload.name + ' is ready.' : dr.say);
            await refresh();
            return;
        }
    });

    document.addEventListener('change', async function (ev) {
        var sel = ev.target.closest ? ev.target.closest('[data-job-model]') : null;
        if (sel) {
            await window.hand.saveConfig({ job: { id: sel.getAttribute('data-job-model'), model: sel.value } });
            await refresh();
            return;
        }
        if (ev.target && ev.target.id === 'chatModel') {
            await window.hand.saveConfig({ chatModel: ev.target.value });
            await chatLoad();
        }
    });
    // Enter sends; Shift+Enter is a new line — the habit every chat teaches.
    $('chatIn').addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            chatSend();
        }
    });
    $('siteUrl').addEventListener('blur', async function () {
        if (!S || $('siteUrl').value.trim() === (S.siteUrl || '')) { return; }
        await window.hand.saveConfig({ siteUrl: $('siteUrl').value.trim() });
        await refresh();
    });
    document.addEventListener('keydown', function (e) {
        // ⌘, is Settings, the macOS habit. Escape closes the topmost thing —
        // the sheets first, then Settings.
        if ((e.metaKey || e.ctrlKey) && e.key === ',') { e.preventDefault(); openSettings(0); return; }
        if (e.key === 'Escape' && !$('upScrim').hidden) { $('upScrim').hidden = true; return; }
        if (e.key === 'Escape' && !$('scrim').hidden) { $('scrim').hidden = true; return; }
        if (e.key === 'Escape' && !$('setScrim').hidden) { $('setScrim').hidden = true; }
    });

    // ── the Add model sheet ──────────────────────────────────────────────
    function openSheet() {
        $('scrim').hidden = false;
        $('results').innerHTML = '<p class="tiny sheet-msg">Type a family name — qwen, llama, mistral, gemma.</p>';
        $('q').value = '';
        $('q').focus();
    }
    $('q').addEventListener('input', function () {
        clearTimeout(searchT);
        var term = $('q').value;
        searchT = setTimeout(async function () {
            if (term.trim().length < 2) {
                $('results').innerHTML = '<p class="tiny sheet-msg">Type a little more.</p>';
                return;
            }
            $('results').innerHTML = '<p class="tiny sheet-msg">Searching Hugging Face…</p>';
            var r = await window.hand.searchModels(term);
            if (!r.ok) {
                $('results').innerHTML = '<p class="tiny sheet-msg">' + esc(r.say) + '</p>';
                return;
            }
            if (!r.rows.length) {
                $('results').innerHTML = '<p class="tiny sheet-msg">Nothing on Hugging Face matches that.</p>';
                return;
            }
            // A repo is not a file — a row expands into its quantisations,
            // where the sizes are real and the fit verdict is a fact.
            $('results').innerHTML = r.rows.map(function (m) {
                return '<button class="mrow" type="button" data-repo="' + esc(m.id) + '">' +
                    '<span class="main"><b>' + esc(m.name) + '</b>' +
                    '<span>' + esc(m.id) + (m.params ? ' · ' + m.params + 'B' : '') + '</span></span>' +
                    chip(m.fit, m.why) +
                    '<span class="sz">' + (m.sizeGB ? '~' + m.sizeGB + ' GB' : '?') + '</span></button>';
            }).join('');
        }, 260);
    });

    // The main process narrates a run, so the window says something during the
    // forty seconds a draft takes — beside the button, and announced.
    if (window.hand.onProgress) {
        window.hand.onProgress(function (p) {
            if (p && p.who) {
                var say = 'Drafting for ' + p.who + ' (' + (p.i + 1) + ' of ' + p.of + ')';
                $('runSub').textContent = say;
                $('tbSub').textContent = say;
            }
        });
    }

    // ── THE UPDATER ───────────────────────────────────────────────────────
    // The window never touches the network (connect-src 'none'); it asks the
    // main process for a verdict and draws it. Three states must look
    // different, or "couldn't check" reads as "up to date".
    var UP = null;
    var upFile = '';

    function upSet(txt, isUpdate) {
        $('verText').textContent = txt;
        $('verBtn').className = 'side-ver' + (isUpdate ? ' has-update' : '');
    }

    function upPaint() {
        var v = UP || {};
        $('upNow').textContent = v.current || 'unknown';
        $('upSays').textContent = v.say || '';
        var chipEl = $('upChip');
        var get = $('upGet');
        var note = $('upNote');
        get.hidden = true;
        note.textContent = '';
        if (v.state === 'current') {
            chipEl.className = 'chip ok'; chipEl.textContent = 'Up to date';
        } else if (v.state === 'available') {
            chipEl.className = 'chip warn'; chipEl.textContent = v.version + ' available';
            get.hidden = false;
            get.textContent = upFile ? 'Open the installer' : 'Download' + (v.size ? ' (' + sizeWords(v.size) + ')' : '');
            note.textContent = upFile
                ? 'Downloaded and checked. Opening it mounts the disk image — drag the app to Applications, replacing the old one, then quit and reopen it.'
                : 'It will be checked against its published checksum before anything opens.';
        } else if (v.state === 'manual') {
            chipEl.className = 'chip warn'; chipEl.textContent = v.version + ' available';
            note.textContent = 'This app only installs downloads it can verify, so open this one in a browser instead.';
            get.hidden = false; get.textContent = 'Open in a browser';
        } else {
            chipEl.className = 'chip n'; chipEl.textContent = 'Unknown';
        }
    }

    function sizeWords(b) {
        var n = Number(b) || 0;
        if (n <= 0) { return ''; }
        if (n < 1048576) { return Math.round(n / 1024) + ' KB'; }
        return (n / 1048576).toFixed(0) + ' MB';
    }

    async function upCheck(loud) {
        if (!window.hand.checkUpdate) { upSet('', false); $('verBtn').hidden = true; return; }
        if (loud) { upSet('Checking…', false); }
        UP = await window.hand.checkUpdate();
        upFile = '';
        if (UP.state === 'current') { upSet('Up to date · ' + (UP.current || ''), false); }
        else if (UP.state === 'available' || UP.state === 'manual') { upSet('Update available', true); }
        else { upSet("Couldn't check for updates", false); }
        if (!$('upScrim').hidden) { upPaint(); }
    }

    function openUpdatePanel(recheck) {
        $('upScrim').hidden = false;
        upPaint();
        if (recheck) {
            $('upChip').textContent = 'Checking';
            upCheck(true).then(upPaint);
        }
    }
    $('verBtn').addEventListener('click', function () { openUpdatePanel(false); });
    // Check for Updates… in the app menu asks AGAIN rather than showing the
    // verdict from launch — the app stays running for weeks.
    if (window.hand.onOpenUpdates) { window.hand.onOpenUpdates(function () { openUpdatePanel(true); }); }
    $('upClose').addEventListener('click', function () { $('upScrim').hidden = true; });
    $('upCheck').addEventListener('click', async function () {
        $('upChip').textContent = 'Checking';
        await upCheck(true);
        upPaint();
    });
    $('upGet').addEventListener('click', async function () {
        if (!UP) { return; }
        if (UP.state === 'manual') { window.hand.openUrl(UP.url); return; }
        if (upFile) { window.hand.openFile(upFile); return; }
        $('upGet').disabled = true;
        $('upProg').hidden = false;
        var r = await window.hand.downloadUpdate(UP);
        $('upGet').disabled = false;
        $('upProg').hidden = true;
        if (!r || !r.ok) {
            $('upNote').textContent = (r && r.say) || 'The download did not finish.';
            return;
        }
        upFile = r.file;
        upPaint();
    });
    if (window.hand.onUpdateProgress) {
        window.hand.onUpdateProgress(function (p) {
            if (!p || !p.total) { return; }
            $('upBar').style.width = Math.round((p.got / p.total) * 100) + '%';
        });
    }

    go(0);
    refresh();
    upCheck(false);
    setInterval(function () { if (!S || !S.running) { refresh(); } }, 30000);
})();
