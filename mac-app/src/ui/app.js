// ============================================================
//  app.js — the window's own script. Renderer side: no Node, no network.
//
//  Everything it knows comes from `window.hand`, the preload bridge, and every
//  string it puts on screen is escaped here at the render boundary. That is the
//  same rule the website follows and for the same reason: a guest's name with an
//  apostrophe in it must be escaped exactly once, at the point it becomes HTML.
//
//  A pattern worth keeping: every screen renders from ONE state object fetched
//  in one call (`hand.state()`), and every action ends by re-fetching it. There
//  is no second copy of the truth in here to drift.
// ============================================================
'use strict';
(function () {
    var S = null;              // the last state we were given
    var view = 0;
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
        ['Tonight', function () { return S ? 'Next run ' + S.nextRunAt + ' · ' + S.nextRunSays : ''; }],
        ['Jobs', function () { return S ? onCount() + ' job' + (onCount() === 1 ? '' : 's') + ' on' : ''; }],
        ['Models', function () { return S ? S.models.length + ' installed' : ''; }],
        ['Runner', function () { return S ? S.engineName + (S.engineServing ? ' · serving' : ' · not answering') : ''; }],
        ['Connection', function () { return S ? (S.secretSet ? S.siteUrl : 'type the code from your website') : ''; }],
    ];
    function onCount() {
        return S.jobs.filter(function (j) { return j.on; }).length;
    }

    // What to say about starting the model server. It answers in this order —
    // running, then the reason it cannot start, then what starting will do —
    // because the first true one is the only one worth reading.
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
        Array.prototype.forEach.call(document.querySelectorAll('.snav'), function (n, j) {
            if (j === i) { n.setAttribute('aria-current', 'true'); } else { n.removeAttribute('aria-current'); }
        });
        [0, 1, 2, 3, 4].forEach(function (j) {
            var el = $('v' + j);
            if (j === i) { el.removeAttribute('hidden'); } else { el.setAttribute('hidden', ''); }
        });
        paintTitle();
        // THE CURSOR IS ALREADY IN THE ONE BOX THAT NEEDS FILLING IN. Opening
        // Connection with no key stored, the code is the only thing left to do —
        // so the owner types it rather than clicking to the field first. Once a
        // key IS stored there is nothing to fill in and nothing is grabbed.
        if (i === 4 && S && !S.secretSet) {
            try { $('codeIn').focus(); } catch (e) { /* not painted yet */ }
        }
    }
    function paintTitle() {
        $('tbTitle').textContent = TITLES[view][0];
        $('tbSub').textContent = TITLES[view][1]() || '';
    }

    // ── render ───────────────────────────────────────────────────────────
    function render() {
        if (!S) { return; }
        $('jobsBadge').textContent = String(onCount());
        $('modelsBadge').textContent = String(S.models.length);
        // THE ADDRESS IS NEVER THE MISSING THING NOW — the app ships knowing it,
        // so the only setting-up left is the code. This read `!S.siteUrl` and
        // said "No site yet" on a fresh install, about an app that knew exactly
        // where its site was.
        $('stateDot').className = 'dot' + (S.running ? ' busy' : !S.secretSet ? ' off' : '');
        $('stateSays').textContent = S.running ? 'Working…'
            : !S.secretSet ? 'Not connected' : 'Ready';
        $('runBtn').disabled = !!S.running;
        $('runBtn').textContent = S.running ? 'Working…' : 'Run now';

        // TONIGHT
        var reply = S.jobs.filter(function (j) { return j.id === 'reply'; })[0] || {};
        $('tonightSub').textContent = '';
        // NOT ANSWERING IS NOT A FAILURE ANY MORE. With auto-start on and a
        // model chosen, the night brings the engine up itself — so a red chip
        // here would report a problem the app is about to solve. It stays red
        // for the case that really is one: nothing answering and nothing this
        // app can do about it.
        var Rt = S.runner || {};
        var willStart = !S.engineServing && Rt.available && Rt.canStart && Rt.autoStart && !Rt.problem;
        $('tonightBox').innerHTML =
            row('Next run', S.nextRunAt + ', ' + S.nextRunSays, chip(reply.on ? 'ok' : 'n', reply.on ? 'Scheduled' : 'Nothing on')) +
            row('Engine', esc(S.engineName),
                chip(S.engineServing ? 'ok' : willStart ? 'n' : 'bad',
                    S.engineServing ? 'Serving' : willStart ? 'Starts for the run' : 'Not answering'), true) +
            row('Model', reply.model ? esc(reply.model) : 'none chosen yet',
                chip(reply.model ? 'ok' : 'warn', reply.model ? 'Chosen' : 'Choose one')) +
            row('Site', esc(String(S.siteUrl).replace(/^https:\/\//,'').replace(/\/nightshift\.php$/,'')) + (S.siteIsDefault ? '' : ' · your own'),
                chip(S.secretSet ? 'ok' : 'warn', S.secretSet ? 'Connected' : 'Needs a code'), true);

        // The ask channel's day line — hidden until something happened, so
        // "Today" never claims activity it doesn't have.
        var asks = S.asks || { today: 0, log: [] };
        $('todayWrap').hidden = !(asks.today > 0 || (asks.log || []).length > 0);
        $('todayLog').innerHTML = (asks.log || []).map(function (l) {
            return '<div class="lrow ' + esc(l.level || 'info') + '"><b>' + esc(l.at || '') + '</b><span>' + esc(l.say) + '</span></div>';
        }).join('') || '';

        var last = S.nights[0];
        $('lastLog').innerHTML = last
            ? (last.log || []).map(function (l) {
                return '<div class="lrow ' + esc(l.level || 'info') + '"><b>' + esc(l.at || '') + '</b><span>' + esc(l.say) + '</span></div>';
            }).join('')
            : '<p class="tiny">Nothing yet. Press <strong>Run now</strong> to try it, or wait for ' + esc(S.nextRunAt) + '.</p>';
        $('logNote').textContent = last
            ? 'Kept 30 nights, on this Mac only.'
            : '';

        // JOBS
        var coming = S.jobs.filter(function (j) { return !j.built; }).map(function (j) { return j.name.toLowerCase(); });
        $('jobsComing').textContent = coming.length ? 'Coming next: ' + coming.join(' \u00b7 ') + '.' : '';
        $('jobsBox').innerHTML = S.jobs.filter(function (j) { return j.built; }).map(function (j) {
            var opts = ['<option value="">Choose a model…</option>'].concat(S.models.map(function (m) {
                return '<option value="' + esc(m.id) + '"' + (m.id === j.model ? ' selected' : '') + '>' + esc(m.name) + ' · ' + m.sizeGB + ' GB</option>';
            })).join('');
            return '<div class="row">' +
                '<div class="main"><b>' + esc(j.name) + '</b><span>' + esc(j.what) + '</span></div>' +
                '<div class="rail">' +
                '<select class="pop" data-job-model="' + esc(j.id) + '"' + (j.built ? '' : ' disabled') + ' aria-label="Model for ' + esc(j.name) + '">' + opts + '</select>' +
                '<button class="sw' + (j.on ? ' on' : '') + '" type="button" data-job-on="' + esc(j.id) + '"' +
                (j.built ? '' : ' disabled') + ' aria-label="' + esc(j.name) + '" aria-pressed="' + (j.on ? 'true' : 'false') + '"></button>' +
                '</div></div>';
        }).join('');

        // MODELS
        $('modelsBox').innerHTML = S.models.length
            ? S.models.map(function (m) {
                return '<div class="row"><div class="main"><b>' + esc(m.name) + '</b>' +
                    '<span class="mono">' + esc(m.id) + ' · ' + esc(m.quant || m.format) + ' · ' + m.sizeGB + ' GB</span></div>' +
                    '<div class="rail">' + chip(m.fit, m.why) + '</div></div>';
            }).join('')
            : '<div class="row"><div class="main"><b>No models yet</b><span>Press <strong>Add model…</strong>. On 16 GB, an 8B or 14B at Q4 is the place to start.</span></div></div>';
        $('modelsNote').textContent = 'A model is a file — delete it in the Models folder and it leaves this list.';

        // RUNNER
        $('machineBox').innerHTML =
            row('This Mac', esc(S.machineSays), chip(S.machine.appleSilicon ? 'ok' : 'n', S.machine.appleSilicon ? 'Apple silicon' : 'Intel')) +
            row('Keep the Mac awake for a run', '',
                '<button class="sw' + (S.keepAwake ? ' on' : '') + '" type="button" id="awakeSw" aria-label="Keep the Mac awake" aria-pressed="' + (S.keepAwake ? 'true' : 'false') + '"></button>', true);
        var R = S.runner || {};
        $('engineBox').innerHTML = S.engines.map(function (e) {
            // START, on the one engine this app can start. It appears only on
            // the engine IN USE and only when nothing is answering — a Start
            // button beside something already serving is a control with nothing
            // to do, and one beside an engine you are not using would start the
            // wrong thing.
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
        // WHY IT CANNOT START, WHERE THE BUTTON WOULD HAVE BEEN. A disabled
        // button with no sentence beside it is the state that sends someone
        // looking through Settings for a thing that is not there.
        $('runnerNote').textContent = runnerNote(R);
        $('runnerNote').hidden = !runnerNote(R);
        $('runnerFix').hidden = !(R.install && !R.found);
        $('runnerFix').textContent = R.install || '';
        $('autoSw').className = 'sw' + (R.autoStart ? ' on' : '');
        $('autoSw').setAttribute('aria-pressed', R.autoStart ? 'true' : 'false');
        $('loginSw').className = 'sw' + (R.openAtLogin ? ' on' : '');
        $('loginSw').setAttribute('aria-pressed', R.openAtLogin ? 'true' : 'false');

        // CONNECTION
        $('siteSays').textContent = (S.siteIsDefault ? '' : 'Your own address: ')
            + S.siteUrl.replace(/^https:\/\//, '').replace(/\/nightshift\.php$/, '');
        // The RAW setting, not the resolved one: an empty box means "the standard
        // address", so pre-filling it with the default would turn the standard
        // address into an override the moment anything saved.
        if ($('siteUrl') !== document.activeElement) { $('siteUrl').value = S.siteRaw || ''; }
        if (!S.siteIsDefault) { $('siteEditRow').hidden = false; }
        $('secretSays').textContent = S.keychain
            ? (S.secretSet ? 'One is stored in the macOS Keychain. It is never shown, here or anywhere.'
                // NOT the daily-jobs secret any more — that one also opens the
                // scripts that collect payments and email guests, and the site
                // stopped accepting it here the moment a Mac was connected.
                : 'None stored yet. Connect above, or paste a key the website generated.')
            : 'The Keychain is only available on macOS, so no secret can be stored on this machine.';
        $('nightsBox').innerHTML = S.nights.length
            ? S.nights.slice(0, 8).map(function (n) {
                var when = String(n.started || '').replace('T', ' ').slice(0, 16);
                var what = n.posted ? 'posted ' + n.posted : n.drafted ? 'drafted ' + n.drafted + ', posted none' : 'nothing to post';
                return row(esc(when), esc(what) + (n.failed ? ' · ' + n.failed + ' problem' + (n.failed === 1 ? '' : 's') : ''),
                    chip(n.ok ? (n.uncertain ? 'warn' : 'ok') : 'bad', n.ok ? (n.uncertain ? 'Uncertain' : 'Ran') : 'Stopped'));
            }).join('')
            : '<div class="row"><div class="main"><b>No nights yet</b><span>Once it has run, each night is listed here for a month.</span></div></div>';

        paintTitle();
    }
    function row(label, sub, rail, alt) {
        return '<div class="row' + (alt ? ' alt' : '') + '"><div class="main"><b>' + label + '</b><span>' + sub + '</span></div>' +
            '<div class="rail">' + (rail || '') + '</div></div>';
    }
    function chip(kind, say) {
        return '<span class="chip ' + esc(kind || 'n') + '">' + esc(say || '') + '</span>';
    }

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
        var nav = t.closest ? t.closest('.snav') : null;
        if (nav) { go(parseInt(nav.getAttribute('data-v'), 10) || 0); return; }

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
                ? (res.night && res.night.posted ? 'Posted ' + res.night.posted + ' to the site.' : 'Ran — nothing to post.')
                : (res.say || 'It could not finish.'));
            return;
        }
        if (t.id === 'startEng') {
            // IT TAKES TENS OF SECONDS and the button says so, because a
            // control that looks stuck is one people press again.
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
        // NB there is deliberately no skip handler: the old "Skip tonight"
        // button showed a toast and skipped nothing — a control that does
        // nothing is worse than no control, so it went with the copy cleanup.
        // If skipping is ever wanted, it needs a real mechanism (a date the
        // scheduler honours), not a button that claims one.
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
                // expired, used, wrong, or never minted, and those want
                // different things done about them.
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
            var sr = await window.hand.setSecret(v.trim());
            $('secretIn').value = '';
            toast(sr.ok ? 'Saved to the Keychain.' : sr.say);
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
        }
    });
    $('siteUrl').addEventListener('blur', async function () {
        if (!S || $('siteUrl').value.trim() === (S.siteUrl || '')) { return; }
        await window.hand.saveConfig({ siteUrl: $('siteUrl').value.trim() });
        await refresh();
    });
    document.addEventListener('keydown', function (e) {
        // BOTH sheets. The update sheet was added without this, so Escape did
        // nothing on it — a dialog you can only leave by finding its Close
        // button. Topmost first, in case both are somehow open.
        if (e.key === 'Escape' && !$('upScrim').hidden) { $('upScrim').hidden = true; return; }
        if (e.key === 'Escape' && !$('scrim').hidden) { $('scrim').hidden = true; }
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
            // A REPO IS NOT A FILE. "Qwen2.5-14B-Instruct-GGUF" holds a dozen
            // quantisations and which one you want is the whole decision — so a
            // row EXPANDS into its files, where the sizes are real and the fit
            // verdict is a fact rather than an estimate.
            $('results').innerHTML = r.rows.map(function (m) {
                return '<button class="mrow" type="button" data-repo="' + esc(m.id) + '">' +
                    '<span class="main"><b>' + esc(m.name) + '</b>' +
                    '<span>' + esc(m.id) + (m.params ? ' · ' + m.params + 'B' : '') + '</span></span>' +
                    chip(m.fit, m.why) +
                    '<span class="sz">' + (m.sizeGB ? '~' + m.sizeGB + ' GB' : '?') + '</span></button>';
            }).join('');
        }, 260);
    });

    // The main process tells us when a run makes progress, so the window says
    // something during the forty seconds a draft takes.
    if (window.hand.onProgress) {
        window.hand.onProgress(function (p) {
            if (p && p.who) { $('tbSub').textContent = 'Drafting for ' + p.who + ' (' + (p.i + 1) + ' of ' + p.of + ')'; }
        });
    }

    // ── THE UPDATER ───────────────────────────────────────────────────────
    // The window never touches the network (connect-src 'none'); it asks the
    // main process for a verdict and draws it. Three states have to look
    // different, because collapsing them is how "couldn't check" ends up
    // reading as "you are up to date":
    //   current   — say so, quietly
    //   available — offer the download, with its size
    //   manual/unknown — say what is wrong, and never offer a file this app
    //                    has not verified
    var UP = null;      // the last verdict
    var upFile = '';    // the verified path, once downloaded

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
                ? 'Downloaded and checked. Opening it mounts the disk image \u2014 drag the app to Applications, replacing the old one, then quit and reopen it.'
                : 'It will be checked against its published checksum before anything opens.';
        } else if (v.state === 'manual') {
            chipEl.className = 'chip warn'; chipEl.textContent = v.version + ' available';
            note.textContent = 'This app only installs downloads it can verify, so open this one in a browser instead.';
            get.hidden = false; get.textContent = 'Open in a browser';
        } else {
            chipEl.className = 'chip n'; chipEl.textContent = 'Unknown';
        }
    }

    // Mirrors core/update.js's sizeWords. Small enough that sharing it across
    // the bridge would cost more than restating it.
    function sizeWords(b) {
        var n = Number(b) || 0;
        if (n <= 0) { return ''; }
        if (n < 1048576) { return Math.round(n / 1024) + ' KB'; }
        return (n / 1048576).toFixed(0) + ' MB';
    }

    async function upCheck(loud) {
        if (!window.hand.checkUpdate) { upSet('', false); $('verBtn').hidden = true; return; }
        if (loud) { upSet('Checking\u2026', false); }
        UP = await window.hand.checkUpdate();
        upFile = '';
        if (UP.state === 'current') { upSet('Up to date \u00b7 ' + (UP.current || ''), false); }
        // SHORT, because the rail is 228px and a build tag is 24 characters —
        // it wrapped to two ragged lines. The version itself is in the sheet,
        // which is where you go to act on it.
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
    // Check for Updates… in the app menu. It ASKS AGAIN rather than showing
    // the verdict from launch: the app is meant to stay running for weeks, so
    // that answer can be very old, and someone choosing this menu item is
    // asking the question now.
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

    // The main process tells us when a run makes progress, so the window says
    // something during the forty seconds a draft takes.

    go(0);
    refresh();
    upCheck(false);
    setInterval(function () { if (!S || !S.running) { refresh(); } }, 30000);
})();
