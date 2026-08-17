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
        ['Jobs', function () { return S ? onCount() + ' of ' + S.jobs.length + ' switched on' : ''; }],
        ['Models', function () { return S ? S.models.length + ' installed' : ''; }],
        ['Runner', function () { return S ? S.engineName + (S.engineServing ? ' · serving' : ' · not answering') : ''; }],
        ['Connection', function () { return S ? (S.siteUrl || 'no address yet') : ''; }],
    ];
    function onCount() {
        return S.jobs.filter(function (j) { return j.on; }).length;
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
        $('stateDot').className = 'dot' + (S.running ? ' busy' : !S.secretSet || !S.siteUrl ? ' off' : '');
        $('stateSays').textContent = S.running ? 'Working…'
            : !S.siteUrl ? 'No site yet' : !S.secretSet ? 'No secret yet' : 'Ready';
        $('runBtn').disabled = !!S.running;
        $('runBtn').textContent = S.running ? 'Working…' : 'Run now';

        // TONIGHT
        var reply = S.jobs.filter(function (j) { return j.id === 'reply'; })[0] || {};
        $('tonightSub').textContent = onCount() + ' of ' + S.jobs.length + ' jobs switched on.';
        $('tonightBox').innerHTML =
            row('Next run', S.nextRunAt + ', ' + S.nextRunSays, chip(reply.on ? 'ok' : 'n', reply.on ? 'Scheduled' : 'Nothing on')) +
            row('Engine', esc(S.engineName) + ' · ' + esc(S.engineBase),
                chip(S.engineServing ? 'ok' : 'bad', S.engineServing ? 'Serving' : 'Not answering'), true) +
            row('Model for the reply job', reply.model ? esc(reply.model) : 'none chosen yet',
                chip(reply.model ? 'ok' : 'warn', reply.model ? 'Chosen' : 'Choose one')) +
            row('Site', S.siteUrl ? esc(S.siteUrl) : 'not set yet',
                chip(S.secretSet && S.siteUrl ? 'ok' : 'warn', S.secretSet && S.siteUrl ? 'Configured' : 'Needs setting up'), true);

        var last = S.nights[0];
        $('lastLog').innerHTML = last
            ? (last.log || []).map(function (l) {
                return '<div class="lrow ' + esc(l.level || 'info') + '"><b>' + esc(l.at || '') + '</b><span>' + esc(l.say) + '</span></div>';
            }).join('')
            : '<p class="tiny">Nothing yet. Press <strong>Run now</strong> to try it, or wait for ' + esc(S.nextRunAt) + '.</p>';
        $('logNote').textContent = last
            ? 'Kept for 30 nights. Nothing in this log leaves the Mac.'
            : '';

        // JOBS
        $('jobsBox').innerHTML = S.jobs.map(function (j) {
            var opts = ['<option value="">Choose a model…</option>'].concat(S.models.map(function (m) {
                return '<option value="' + esc(m.id) + '"' + (m.id === j.model ? ' selected' : '') + '>' + esc(m.name) + ' · ' + m.sizeGB + ' GB</option>';
            })).join('');
            return '<div class="row' + (j.built ? '' : ' dim') + '">' +
                '<div class="main"><b>' + esc(j.name) + '</b><span>' + esc(j.what) +
                (j.built ? '' : ' — not built yet') + '</span></div>' +
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
        $('modelsNote').textContent = 'Kept in ' + S.modelsDir + '. A model is a file — delete it there and it disappears from this list.';

        // RUNNER
        $('machineBox').innerHTML =
            row('This Mac', esc(S.machineSays), chip(S.machine.appleSilicon ? 'ok' : 'n', S.machine.appleSilicon ? 'Apple silicon' : 'Intel')) +
            row('Keep the Mac awake for a run', 'Released again as soon as the run finishes.',
                '<button class="sw' + (S.keepAwake ? ' on' : '') + '" type="button" id="awakeSw" aria-label="Keep the Mac awake" aria-pressed="' + (S.keepAwake ? 'true' : 'false') + '"></button>', true);
        $('engineBox').innerHTML = S.engines.map(function (e) {
            return '<div class="row' + (e.usable ? '' : ' dim') + '">' +
                '<div class="main"><b>' + esc(e.name) + '</b><span>' + esc(e.usable ? e.note : e.why) + '</span></div>' +
                '<div class="rail">' + chip(e.serving ? 'ok' : 'n', e.serving ? 'Serving on ' + esc(e.base).replace('http://', '') : 'Not answering') +
                '<button class="tbtn' + (S.engine === e.id ? ' prime' : '') + '" type="button" data-engine="' + esc(e.id) + '"' +
                (e.usable ? '' : ' disabled') + '>' + (S.engine === e.id ? 'In use' : 'Use this') + '</button>' +
                '</div></div>';
        }).join('');

        // CONNECTION
        if ($('siteUrl') !== document.activeElement) { $('siteUrl').value = S.siteUrl || ''; }
        $('secretSays').textContent = S.keychain
            ? (S.secretSet ? 'One is stored in the macOS Keychain. It is never shown, here or anywhere.'
                : 'None stored yet. Paste the same secret your daily-jobs address uses.')
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
        if (t.id === 'skipBtn') { toast('Skipped. The next run is tomorrow at ' + S.nextRunAt + '.'); return; }
        if (t.id === 'addBtn') { openSheet(); return; }
        if (t.id === 'cancelBtn') { $('scrim').hidden = true; return; }
        if (t.id === 'saveSecret') {
            var v = $('secretIn').value;
            if (!v.trim()) { toast('Paste the secret first.'); return; }
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
            $('connChip').textContent = tr.state === 'on' ? 'On' : tr.state === 'off' ? 'Off' : tr.state === 'auth' ? 'Secret' : 'Unreachable';
            $('connSays').textContent = tr.say;
            return;
        }
        var repo = t.closest ? t.closest('[data-repo]') : null;
        if (repo) {
            var rid = repo.getAttribute('data-repo');
            $('results').innerHTML = '<p class="tiny" style="padding:20px 18px">Reading what is inside ' + esc(rid) + '…</p>';
            var fr = await window.hand.modelFiles(rid);
            if (!fr.ok) {
                $('results').innerHTML = '<p class="tiny" style="padding:20px 18px">' + esc(fr.say) + '</p>';
                return;
            }
            if (!fr.rows.length) {
                $('results').innerHTML = '<p class="tiny" style="padding:20px 18px">No single-file GGUF in that repo.'
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
            }).join('') + '<p class="tiny" style="padding:11px 18px 5px">Sizes here are the real file sizes, so the verdicts are facts rather than estimates.</p>';
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
        if (e.key === 'Escape' && !$('scrim').hidden) { $('scrim').hidden = true; }
    });

    // ── the Add model sheet ──────────────────────────────────────────────
    function openSheet() {
        $('scrim').hidden = false;
        $('results').innerHTML = '<p class="tiny" style="padding:20px 18px">Type a family name — qwen, llama, mistral, gemma.</p>';
        $('q').value = '';
        $('q').focus();
    }
    $('q').addEventListener('input', function () {
        clearTimeout(searchT);
        var term = $('q').value;
        searchT = setTimeout(async function () {
            if (term.trim().length < 2) {
                $('results').innerHTML = '<p class="tiny" style="padding:20px 18px">Type a little more.</p>';
                return;
            }
            $('results').innerHTML = '<p class="tiny" style="padding:20px 18px">Searching Hugging Face…</p>';
            var r = await window.hand.searchModels(term);
            if (!r.ok) {
                $('results').innerHTML = '<p class="tiny" style="padding:20px 18px">' + esc(r.say) + '</p>';
                return;
            }
            if (!r.rows.length) {
                $('results').innerHTML = '<p class="tiny" style="padding:20px 18px">Nothing on Hugging Face matches that.</p>';
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

    go(0);
    refresh();
    setInterval(function () { if (!S || !S.running) { refresh(); } }, 30000);
})();
