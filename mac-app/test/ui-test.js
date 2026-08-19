#!/usr/bin/env node
// ============================================================
//  ui-test.js — the window itself, driven in a real browser.
//
//      CHB_CHROMIUM=/path/to/chrome node test/ui-test.js
//
//  The window is plain HTML, CSS and JS talking to `window.hand`, so it can be
//  loaded outside Electron with a FAKE bridge and driven for real: clicks,
//  screens, the model sheet, the switches, the escaping. That leaves only
//  main.js — window-opening — untested, which is the deal the README states.
//
//  Two things it exists to catch, because both have bitten this project before:
//   * `display` on an element outranking its `hidden` attribute, so every
//     screen paints at once while an attribute check passes;
//   * a guest's name reaching the page as markup rather than as text.
// ============================================================
'use strict';
const path = require('path');
const fs = require('fs');

// Playwright lives in the website's own node_modules (CI installs it there for
// the browser jobs). Resolved RELATIVE to this file so the same line works here
// and on a runner, and skipping loudly if it is genuinely absent — the core
// suite is the gate that must always run.
let playwright = null;
for (const where of [path.join(__dirname, '..', '..', 'Cottage Holidays Blakeney', 'node_modules', 'playwright'), 'playwright']) {
    try {
        playwright = require(where);
        break;
    } catch (e) { /* try the next */ }
}
if (!playwright) {
    console.log('ui-test: playwright is not installed — skipping (the core suite is the gate).');
    process.exit(0);
}

let fails = 0;
function ok(label, cond, detail) {
    console.log('  ' + (cond ? '✓' : '✗') + ' ' + label + (cond ? '' : (detail ? ' — ' + String(detail).slice(0, 200) : '')));
    if (!cond) { fails++; }
}

// The state a fake bridge hands over. Deliberately hostile in the places that
// matter: a guest name with markup in it, and a model that will not fit.
function fakeState(over) {
    return Object.assign({
        ok: true,
        machine: { isMac: true, arch: 'arm64', appleSilicon: true, ramGB: 16, macos: '15.6' },
        machineSays: 'Macmini9,1 · Apple M2 · 16 GB · macOS 15.6',
        engines: [
            { id: 'llamacpp', name: 'llama.cpp', note: 'Metal on Apple silicon, CPU on Intel.', usable: true, serving: true, base: 'http://127.0.0.1:8080', why: '' },
            { id: 'ollama', name: 'Ollama', note: 'If you already run Ollama.', usable: true, serving: false, base: 'http://127.0.0.1:11434', why: '' },
            { id: 'mlx', name: 'MLX', note: 'Apple’s own framework.', usable: false, serving: false, base: 'http://127.0.0.1:8081', why: 'This Mac is Intel, and MLX is Apple silicon only.' },
        ],
        engine: 'llamacpp', engineName: 'llama.cpp', engineServing: true, engineBase: 'http://127.0.0.1:8080',
        jobs: [
            { id: 'reply', name: 'Draft enquiry replies', what: 'Reads the enquiries waiting.', built: true, on: true, model: 'q.gguf', at: '02:00', schedule: 'nightly' },
            { id: 'week', name: 'Read the week', what: 'Reads the week.', built: false, on: false, model: '', at: '04:00', schedule: 'weekly-mon' },
        ],
        asks: { today: 0, log: [] },
        models: [
            { id: 'q.gguf', name: 'Qwen 2.5 14B Instruct', quant: 'Q4_K_M', format: 'gguf', sizeGB: 9, fit: 'ok', why: 'Runs well here' },
            { id: 'big.gguf', name: 'Qwen 2.5 72B Instruct', quant: 'Q4_K_M', format: 'gguf', sizeGB: 47, fit: 'no', why: 'Will not fit' },
        ],
        modelsDir: '/Users/x/Library/Application Support/Cottage Holidays Blakeney/Models',
        siteUrl: 'https://cottageholidaysblakeney.co.uk/nightshift.php',
        siteIsDefault: true,
        siteRaw: '',
        secretSet: true, secretHint: '••••••••', keychain: true, keepAwake: true,
        runner: {
            canStart: true, available: true, found: true, kind: 'bundled',
            path: '/App/Contents/Resources/runner/llama-server', install: '',
            problem: '', running: false, autoStart: true,
        },
        nextRun: new Date().toISOString(), nextRunAt: '02:00', nextRunSays: 'in 6 hours 42 minutes',
        nights: [{
            started: '2026-08-17T02:14:00.000Z', ok: true, drafted: 2, posted: 2, skipped: 1, failed: 0,
            log: [
                { at: '02:14', say: 'woke · asking the site what is waiting', level: 'info' },
                // A guest whose name is markup. It must arrive as TEXT.
                { at: '02:15', say: "O'Brien & <b>Sons</b> · Jollyboat · drafted in 4.1s", level: 'hit' },
                { at: '02:16', say: 'stored 2 · skipped 0 · worked 2m 31s · back to sleep', level: 'done' },
            ],
        }],
        running: false,
    }, over || {});
}

(async function () {
    const browser = await playwright.chromium.launch({ executablePath: process.env.CHB_CHROMIUM || undefined });
    const uiDir = path.join(__dirname, '..', 'src', 'ui');
    ok('the window files are where main.js expects them',
        fs.existsSync(path.join(uiDir, 'index.html')) && fs.existsSync(path.join(uiDir, 'app.css')) && fs.existsSync(path.join(uiDir, 'app.js')));

    for (const scheme of ['light', 'dark']) {
        console.log('\n── ' + scheme + ' appearance ──');
        const ctx = await browser.newContext({ viewport: { width: 1040, height: 760 }, colorScheme: scheme });
        const page = await ctx.newPage();
        const errs = [];
        page.on('pageerror', function (e) { errs.push(String(e && e.message)); });

        // THE FAKE BRIDGE. Installed before the document runs, exactly as preload
        // would, and it records every call so the checks can read them back.
        await page.addInitScript(function () {
            window.__calls = [];
            window.hand = {
                // Read LAZILY: an init script that captured __state up front would
                // capture it before the state script had run.
                state: async function () { window.__calls.push(['state']); return window.__nextState || window.__state; },
                saveConfig: async function (p) { window.__calls.push(['saveConfig', p]); return { ok: true }; },
                setSecret: async function (v) { window.__calls.push(['setSecret', v]); return { ok: true, set: true }; },
                testSite: async function () { window.__calls.push(['testSite']); return window.__testAnswer || { ok: true, state: 'on', say: 'Reachable, switched on, 2 enquiries waiting.' }; },
                searchModels: async function (t) {
                    window.__calls.push(['searchModels', t]);
                    return {
                        ok: true, rows: [
                            { id: 'bartowski/Qwen2.5-14B-Instruct-GGUF', owner: 'bartowski', name: 'Qwen 2.5 14B Instruct', params: 14, sizeGB: 8.4, fit: 'ok', why: 'Runs well here' },
                            { id: 'bartowski/Qwen2.5-72B-Instruct-GGUF', owner: 'bartowski', name: 'Qwen 2.5 72B Instruct', params: 72, sizeGB: 43.2, fit: 'no', why: 'Will not fit' },
                        ],
                    };
                },
                modelFiles: async function (id) {
                    window.__calls.push(['modelFiles', id]);
                    return {
                        ok: true, sharded: false, rows: [
                            { filename: 'Qwen2.5-14B-Instruct-Q4_K_M.gguf', quant: 'Q4_K_M', sizeGB: 9, fit: 'ok', why: 'Runs well here', url: 'https://huggingface.co/x/resolve/main/a.gguf' },
                            { filename: 'Qwen2.5-14B-Instruct-Q8_0.gguf', quant: 'Q8_0', sizeGB: 15.7, fit: 'no', why: 'Will not fit', url: 'https://huggingface.co/x/resolve/main/b.gguf' },
                        ],
                    };
                },
                downloadModel: async function (r) { window.__calls.push(['downloadModel', r]); return { ok: true, file: '/x/a.gguf' }; },
                runNow: async function () { window.__calls.push(['runNow']); return { ok: true, night: { posted: 2 } }; },
                // The updater. Absent entirely before this, which is why the
                // version line was hidden in every test run and the menu check
                // could not have passed: upCheck() returns early when the
                // bridge has no checkUpdate.
                checkUpdate: async function () {
                    window.__calls.push(['checkUpdate']);
                    return window.__updateAnswer
                        || { ok: true, state: 'current', current: 'hand-build-20260818-0842', say: 'This is the newest version.' };
                },
                startEngine: async function () {
                    window.__calls.push(['startEngine']);
                    return window.__startAnswer || { ok: true, started: true, say: 'llama.cpp · ready after 4 seconds' };
                },
                stopEngine: async function () { window.__calls.push(['stopEngine']); return { ok: true }; },
                startEngine: async function () { window.__calls.push(['startEngine']); return window.__startAnswer || { ok: true, started: true, say: 'llama.cpp · ready after 4 seconds' }; },
                stopEngine: async function () { window.__calls.push(['stopEngine']); return { ok: true }; },
                onProgress: function (fn) { window.__progress = fn; },
                onOpenUpdates: function (fn) { window.__openUpdates = fn; },
                onDownload: function () {},
                onRan: function () {},
            };
        });
        await page.addInitScript('window.__state = ' + JSON.stringify(fakeState()) + ';');
        await page.goto('file://' + path.join(uiDir, 'index.html'));
        await page.waitForTimeout(400);

        ok('no page errors', errs.length === 0, errs.join(' | '));
        // THE FONTS ACTUALLY LOAD. They did not: default-src 'none' with no
        // font-src blocked both woff2 files, and the window fell back to the
        // system faces — which LOOKS nearly right, since a serif fallback is
        // still a serif, so it shipped unseen. A declaration check would have
        // passed too; this asks the font system whether the face arrived.
        const fonts = await page.evaluate(async function () {
            await document.fonts.ready;
            const loaded = [...document.fonts].filter(function (f) { return f.status === 'loaded'; }).map(function (f) { return f.family; });
            return {
                loaded: loaded,
                mont: document.fonts.check('600 14px Montserrat'),
                play: document.fonts.check('600 26px "Playfair Display"'),
            };
        });
        ok('both shipped faces really load — CSP allows them', fonts.mont && fonts.play, JSON.stringify(fonts));

        // NO INLINE STYLE ATTRIBUTES ANYWHERE. style-src 'self' blocks them, so
        // nine sheet messages rendered flush to the edge with a console error
        // behind each. A source check would miss one built at runtime; this
        // reads the DOM after the sheet has drawn its own messages.
        // OPEN THE SHEET FIRST. Every one of the nine offenders lived in a
        // message written into #results when the sheet renders, so a scan of the
        // resting page would have found nothing and proved nothing.
        await page.evaluate(function () { document.getElementById('addBtn').click(); });
        await page.waitForTimeout(200);
        const inlineStyles = await page.evaluate(function () {
            return [...document.querySelectorAll('[style]')].map(function (el) {
                return el.tagName.toLowerCase() + '.' + (el.className || '') + ' = ' + el.getAttribute('style');
            });
        });
        ok('no inline style attributes in the markup (CSP blocks them)',
            inlineStyles.length === 0, JSON.stringify(inlineStyles).slice(0, 200));
        await page.evaluate(function () { document.getElementById('scrim').hidden = true; });

        ok('it asked for its state on open', await page.evaluate(function () { return window.__calls.some(function (c) { return c[0] === 'state'; }); }));

        // ── ONE SCREEN AT A TIME, measured as PAINT not attribute ──
        const painted = function () {
            return page.evaluate(function () {
                return [0, 1, 2, 3].map(function (i) { return document.getElementById('v' + i).getClientRects().length > 0; });
            });
        };
        ok('only Home is painted on open', JSON.stringify(await painted()) === '[true,false,false,false]',
            JSON.stringify(await painted()));
        await page.click('[data-v="3"]');
        await page.waitForTimeout(120);
        ok('Library paints alone', JSON.stringify(await painted()) === '[false,false,false,true]');
        ok('…and the title bar follows', (await page.textContent('#tbTitle')).trim() === 'Library');

        // ── MACOS 26 STRUCTURE: the facts that could regress silently ──
        // Measured as PAINT (computed style + boxes), not class names.
        const m26 = await page.evaluate(function () {
            const cs = function (el) { return getComputedStyle(el); };
            const side = document.querySelector('.side');
            const run = document.getElementById('runBtn');
            const add = document.getElementById('addBtn');
            const r = document.getElementById('tbTitle').getBoundingClientRect();
            return {
                sideRadius: parseFloat(cs(side).borderTopLeftRadius) || 0,
                sideMarginR: parseFloat(cs(side).marginRight) || 0,
                runBg: cs(run).backgroundColor,
                addBg: add ? cs(add).backgroundColor : '',
                tbHidden: r.width <= 1 && r.height <= 1,
                dragStrip: !!document.querySelector('.topdrag'),
            };
        });
        ok('the sidebar is a floating slab, not a welded column',
            m26.sideRadius >= 16 && m26.sideMarginR >= 8, JSON.stringify(m26));
        ok('the screen name is announced, not drawn', m26.tbHidden);
        // One accent capsule per window: the global Run now keeps the accent
        // fill; a screen's own action (Add model…) paints as quiet glass.
        ok('one accent capsule per window', !!m26.addBg && m26.runBg !== m26.addBg,
            m26.runBg + ' vs ' + m26.addBg);
        ok('the top edge is still draggable with the bar gone', m26.dragStrip);

        // ── THE SETTINGS WINDOW: the gear opens it, Escape closes it, and
        // Open-at-login lives on its General tab (the macOS idiom, ⌘,) ──
        await page.click('#gearBtn');
        await page.waitForTimeout(150);
        ok('the gear opens the Settings window', await page.isVisible('.setwin'));
        await page.click('[data-st="2"]');
        await page.waitForTimeout(120);
        ok('the login switch starts off — an app must not add itself unasked',
            (await page.getAttribute('#loginSw', 'aria-pressed')) === 'false');
        await page.click('#loginSw');
        await page.waitForTimeout(200);
        const loginSave = await page.evaluate(function () {
            return window.__calls.filter(function (x) { return x[0] === 'saveConfig' && typeof x[1].openAtLogin === 'boolean'; }).pop();
        });
        ok('toggling it saves openAtLogin', loginSave && loginSave[1].openAtLogin === true, JSON.stringify(loginSave));
        await page.keyboard.press('Escape');
        await page.waitForTimeout(120);
        ok('Escape closes Settings', !(await page.isVisible('.setwin')));

        // ── ACTIVITY: one timeline, and a guest name that is markup must be
        // TEXT — escaped exactly once, at the render boundary ──
        await page.click('[data-v="1"]');
        await page.waitForTimeout(120);
        const logInfo = await page.evaluate(function () {
            const rows = document.querySelectorAll('#feed .arow');
            let tags = 0;
            rows.forEach(function (r) { tags += r.querySelector('.amain').children.length; });
            return {
                rows: rows.length,
                text: document.getElementById('feed').textContent,
                extraTags: tags,
                todayHead: /Today/.test(Array.prototype.map.call(document.querySelectorAll('#feed .dayhead'), function (d) { return d.textContent; }).join('|')),
            };
        });
        ok('the night run renders its lines in the feed', logInfo.rows === 3, String(logInfo.rows));
        // With no asks today there is no Today section — a heading with
        // nothing under it would claim activity that hasn't happened.
        ok('with no asks today, the feed has no Today section', !logInfo.todayHead);
        ok("a guest called O'Brien & <b>Sons</b> arrives as TEXT", logInfo.text.indexOf("O'Brien & <b>Sons</b>") !== -1, logInfo.text.slice(0, 200));
        ok('…and its markup never became an element', logInfo.extraTags === 0, String(logInfo.extraTags));
        await page.addInitScript('window.__state = ' + JSON.stringify(fakeState({
            asks: { today: 1, log: [{ at: '14:02', say: 'Pat · answered while you waited', level: 'hit' }] },
        })) + '; window.__nextState = null;');
        await page.reload();
        await page.waitForTimeout(400);
        await page.click('[data-v="1"]');
        await page.waitForTimeout(120);
        ok('an answered ask paints the Today section with its line',
            /Today/.test(await page.textContent('#feed'))
            && /answered while you waited/.test(await page.textContent('#feed')));
        // …and the same ask leads Home's "The latest".
        await page.click('[data-v="0"]');
        await page.waitForTimeout(120);
        ok("…and leads Home's latest", /answered while you waited/.test(await page.textContent('#latestBox')));
        // THE FILTER: Asks keeps the ask, hides the night.
        await page.click('[data-v="1"]');
        await page.click('[data-f="ask"]');
        await page.waitForTimeout(120);
        const filtered = await page.evaluate(function () {
            const vis = Array.prototype.filter.call(document.querySelectorAll('#feed .arow'), function (r) { return r.getClientRects().length > 0; });
            return { n: vis.length, text: vis.map(function (r) { return r.textContent; }).join('|') };
        });
        ok('the Asks filter keeps the ask and hides the night', filtered.n === 1 && /answered while you waited/.test(filtered.text),
            JSON.stringify(filtered));
        await page.addInitScript('window.__state = ' + JSON.stringify(fakeState()) + '; window.__nextState = null;');
        await page.reload();
        await page.waitForTimeout(400);

        // ── WORK: grouped by its own clock, the ask channel first, and what
        // is not built gets no controls at all ──
        await page.click('[data-v="2"]');
        await page.waitForTimeout(120);
        const work = await page.evaluate(function () {
            const heads = Array.prototype.map.call(document.querySelectorAll('#jobsBox .grouphead'), function (h) { return h.textContent; });
            const jobRows = Array.prototype.map.call(document.querySelectorAll('#jobsBox [data-job-on]'), function (sw) {
                return { disabled: !!sw.disabled, on: sw.classList.contains('on') };
            });
            const ask = document.getElementById('askChip');
            return { heads: heads, jobRows: jobRows, ask: ask ? ask.textContent : '', week: !!document.querySelector('#weekBox .wday.today') };
        });
        ok('the ask channel leads Work — always-on, no switch, Listening',
            /While the app is open/.test(work.heads[0]) && work.ask === 'Listening', JSON.stringify(work));
        ok('the nightly group names its own clock', work.heads.some(function (h) { return /Every night · 02:00/.test(h); }), JSON.stringify(work.heads));
        ok('the built job has a live switch, on', work.jobRows[0] && !work.jobRows[0].disabled && work.jobRows[0].on);
        ok('an unbuilt job renders no row', work.jobRows.length === 1, String(work.jobRows.length));
        ok('…and is named in the Coming-next line', /Coming next: read the week/.test(await page.textContent('#jobsComing')),
            await page.textContent('#jobsComing'));
        ok('the week strip rings today', work.week);
        await page.click('[data-job-on="reply"]');
        await page.waitForTimeout(200);
        const saved = await page.evaluate(function () { return window.__calls.filter(function (c) { return c[0] === 'saveConfig'; }).pop(); });
        ok('switching a job off saves it as off', saved && saved[1].job.id === 'reply' && saved[1].job.on === false, JSON.stringify(saved));

        // ── LIBRARY: a fit verdict per row, a ROLE in words, and the sheet ──
        await page.click('[data-v="3"]');
        await page.waitForTimeout(120);
        const chips = await page.evaluate(function () {
            return Array.prototype.map.call(document.querySelectorAll('#modelsBox .chip'), function (c) { return c.className + '|' + c.textContent; });
        });
        ok('each installed model carries a verdict about this Mac', chips.length === 2 && /ok\|Runs well/.test(chips[0]) && /no\|Will not fit/.test(chips[1]),
            JSON.stringify(chips));
        // THE ROLE comes from Work's own choices, so the two screens cannot
        // disagree: the reply job points at q.gguf, so q.gguf says what for.
        const roles = await page.evaluate(function () {
            return Array.prototype.map.call(document.querySelectorAll('#modelsBox .role'), function (r) { return r.textContent + (r.classList.contains('dim') ? ' (dim)' : ''); });
        });
        ok('a model a job points at wears its role in words', /prose|second/.test(roles[0] || ''), JSON.stringify(roles));
        ok('a model nothing points at says unused, quietly', /unused \(dim\)/.test(roles[1] || ''), JSON.stringify(roles));
        ok('the sheet is closed', !(await page.isVisible('#scrim')));
        await page.click('#addBtn');
        await page.waitForTimeout(150);
        ok('Add model opens the sheet', await page.isVisible('#scrim'));
        await page.fill('#q', 'qwen');
        await page.waitForTimeout(450);
        const searchRows = await page.$$('.mrow[data-repo]');
        ok('a search lists repos', searchRows.length === 2, String(searchRows.length));
        ok('…each with a fit verdict', (await page.evaluate(function () {
            return Array.prototype.map.call(document.querySelectorAll('.mrow[data-repo] .chip'), function (c) { return c.className; }).join(',');
        })).indexOf('no') !== -1);
        // A REPO IS NOT A FILE: it expands into quantisations with real sizes.
        await page.click('.mrow[data-repo]');
        await page.waitForTimeout(250);
        ok('a repo expands into its quantisations', (await page.$$('[data-dl]')).length === 2);
        const dlLabels = await page.evaluate(function () {
            return Array.prototype.map.call(document.querySelectorAll('[data-dl]'), function (b) { return b.textContent.trim(); });
        });
        ok('the one that fits says Download, the one that does not says Anyway',
            dlLabels[0] === 'Download' && dlLabels[1] === 'Anyway', JSON.stringify(dlLabels));
        await page.click('[data-dl]');
        await page.waitForTimeout(250);
        const dl = await page.evaluate(function () { return window.__calls.filter(function (c) { return c[0] === 'downloadModel'; }).pop(); });
        ok('Download asks for the real file, by name', dl && /\.gguf$/.test(dl[1].filename) && /^https:\/\//.test(dl[1].url), JSON.stringify(dl && dl[1]));
        ok('…and the sheet closes behind it', !(await page.isVisible('#scrim')));
        await page.click('#addBtn');
        await page.waitForTimeout(120);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(120);
        ok('Escape closes the sheet', !(await page.isVisible('#scrim')));

        // ── THE ENGINE (Settings → Engine): MLX withdrawn with a reason ──
        await page.click('#gearBtn');
        await page.waitForTimeout(120);
        await page.click('[data-st="1"]');
        await page.waitForTimeout(150);
        const eng = await page.evaluate(function () {
            return Array.prototype.map.call(document.querySelectorAll('#engineBox .row'), function (r) {
                return {
                    name: r.querySelector('b').textContent,
                    dim: r.classList.contains('dim'),
                    sub: r.querySelector('span').textContent,
                    btnDisabled: !!r.querySelector('.tbtn').disabled,
                    inUse: r.querySelector('.tbtn').textContent.trim() === 'In use',
                };
            });
        });
        ok('all three engines are listed', eng.length === 3, JSON.stringify(eng.map(function (e) { return e.name; })));
        ok('the one in use says so', eng.filter(function (e) { return e.inUse; }).length === 1);
        const mlx = eng.filter(function (e) { return e.name === 'MLX'; })[0];
        ok('MLX is listed even when it cannot run', !!mlx);
        ok('…dimmed, disabled, and giving the reason', mlx.dim && mlx.btnDisabled && /Apple silicon only/.test(mlx.sub), JSON.stringify(mlx));

        // ── THE WEBSITE (Settings → Website): the secret is never shown,
        // and Test says what it found ──
        await page.click('[data-st="0"]');
        await page.waitForTimeout(150);
        // THE ADDRESS IS NOT A QUESTION. This checked that a text field had been
        // pre-filled with an address the owner had to supply in the first place;
        // the app ships knowing it, so what matters is that the screen SAYS so
        // and the box is folded away.
        // Re-aimed with the copy cleanup: the row states the bare domain now —
        // "Already set to… Nothing to fill in" described a form that isn't
        // there. The FACT to keep is the same: stated, not asked for.
        ok('the address is stated, not asked for',
            /^cottageholidaysblakeney\.co\.uk$/.test((await page.textContent('#siteSays')).trim()),
            await page.textContent('#siteSays'));
        ok('…and the address box folded away', await page.isHidden('#siteEditRow'));
        // WITH A KEY STORED there is nothing to fill in, so nothing is grabbed.
        ok('…and with a key already stored the code box is not seized',
            await page.evaluate(function () { return document.activeElement.id !== 'codeIn'; }));
        // It is still REACHABLE, because a staging copy needs it.
        await page.click('#siteEdit');
        await page.waitForTimeout(120);
        ok('Change… opens the box for a staging copy', await page.isVisible('#siteEditRow'));
        ok('…empty, because empty MEANS the standard address',
            (await page.inputValue('#siteUrl')) === '');
        await page.click('#siteEdit');
        await page.waitForTimeout(120);
        // THE KEY ROW IS FOLDED. The everyday path is the code; the fallback
        // must not sit as a permanent second form making two doors look equal.
        ok('the paste-a-key form is folded until asked',
            await page.isHidden('#keyRow') && await page.isVisible('#keyShow'));
        await page.click('#keyShow');
        await page.waitForTimeout(120);
        ok('…and Paste a key… opens it', await page.isVisible('#keyRow'));
        ok('the secret field is a password field', (await page.getAttribute('#secretIn', 'type')) === 'password');
        ok('the secret is never printed on the page', (await page.textContent('#setScrim')).indexOf('••••') === -1);
        ok('…and it says one is stored', /Keychain/.test(await page.textContent('#secretSays')));
        await page.click('#testBtn');
        await page.waitForTimeout(250);
        ok('Test now reports on', (await page.textContent('#connChip')).trim() === 'On'
            && /2 enquiries waiting/.test(await page.textContent('#connSays')));
        // …and the OFF answer, which is the one that matters.
        await page.evaluate(function () { window.__testAnswer = { ok: false, state: 'off', say: 'Overnight work is switched off on the site. Nothing was read or stored.' }; });
        await page.click('#testBtn');
        await page.waitForTimeout(250);
        ok('a switched-off site is reported as off, in words', (await page.textContent('#connChip')).trim() === 'Off'
            && /switched off/.test(await page.textContent('#connSays')));
        await page.evaluate(function () { window.__testAnswer = { ok: false, state: 'auth', say: 'The site refused this app\'s key.' }; });
        await page.click('#testBtn');
        await page.waitForTimeout(250);
        ok('a refused key is its own answer', (await page.textContent('#connChip')).trim() === 'Key refused');
        await page.fill('#secretIn', 'a-new-secret');
        await page.click('#saveSecret');
        await page.waitForTimeout(250);
        const setC = await page.evaluate(function () { return window.__calls.filter(function (c) { return c[0] === 'setSecret'; }).pop(); });
        ok('saving a secret sends it once and clears the field', setC && setC[1] === 'a-new-secret'
            && (await page.inputValue('#secretIn')) === '');

        // ── RUN NOW ──
        await page.keyboard.press('Escape');
        await page.waitForTimeout(120);
        await page.click('#runBtn');
        await page.waitForTimeout(400);
        ok('Run now asks the core to run', await page.evaluate(function () { return window.__calls.some(function (c) { return c[0] === 'runNow'; }); }));
        ok('…and lands back on Home', JSON.stringify(await painted()) === '[true,false,false,false]');

        // ── FIRST RUN: nothing set up at all, and the window says what to do
        // rather than showing empty boxes. Driven by reloading with a bare state
        // (a later addInitScript wins, so this genuinely re-boots the window).
        await page.addInitScript('window.__state = ' + JSON.stringify(fakeState({
            secretSet: false, models: [], nights: [],
            jobs: [{ id: 'reply', name: 'Draft enquiry replies', what: 'Reads the enquiries waiting.', built: true, on: false, model: '', at: '02:00', schedule: 'nightly' }],
        })) + '; window.__nextState = null;');
        await page.reload();
        await page.waitForTimeout(350);
        ok('a first run has no page errors either', errs.length === 0, errs.join(' | '));
        ok('the foot says what is missing — the code, not an address',
            /Not connected/.test(await page.textContent('#stateSays')),
            await page.textContent('#stateSays'));
        // THE CHECKLIST IS THE HOME SCREEN until its three steps are done —
        // no wizard to find, no order to guess, each step actionable in place.
        const check = await page.evaluate(function () {
            const steps = Array.prototype.map.call(document.querySelectorAll('#checkBox .stepn'), function (n) { return n.textContent + (n.classList.contains('done') ? '✓' : ''); });
            return {
                shown: document.getElementById('checkBox').getClientRects().length > 0,
                factsHidden: document.getElementById('factsBox').getClientRects().length === 0,
                steps: steps,
                text: document.getElementById('checkBox').textContent,
            };
        });
        ok('a fresh install shows the setup checklist instead of the heartbeat',
            check.shown && check.factsHidden, JSON.stringify(check.steps));
        ok('…three steps, none claiming to be done', check.steps.join(',') === '1,2,3', check.steps.join(','));
        ok('…step 3 waits for step 2 rather than offering a dead switch', /Waiting on step 2/.test(check.text));
        // STEP 1's button opens Settings with the cursor already in the code
        // box — the one thing a fresh install has to fill in.
        await page.click('#stepConnect');
        await page.waitForTimeout(200);
        ok('the connect step opens Settings with the cursor in the code box',
            await page.isVisible('.setwin')
            && await page.evaluate(function () { return document.activeElement.id === 'codeIn'; }),
            await page.evaluate(function () { return document.activeElement.id; }));
        await page.keyboard.press('Escape');
        await page.waitForTimeout(120);
        ok('…and never claims it lacks an address it ships with',
            !/No site/.test(await page.textContent('#setScrim')) && !/not set yet/.test(await page.textContent('#v0')),
            await page.textContent('#stateSays'));
        ok('…and the dot is not green', (await page.getAttribute('#stateDot', 'class')).indexOf('off') !== -1);
        // STEP 2's button opens the real Add-model sheet.
        await page.click('#stepAdd');
        await page.waitForTimeout(150);
        ok('the model step opens the real Add-model sheet', await page.isVisible('#scrim'));
        await page.keyboard.press('Escape');
        await page.waitForTimeout(120);
        await page.click('[data-v="1"]');
        await page.waitForTimeout(120);
        ok('…and the empty feed offers Run now instead of nothing', /Run now/.test(await page.textContent('#feed')),
            await page.textContent('#feed'));
        await page.click('[data-v="3"]');
        await page.waitForTimeout(150);
        ok('an empty model library says where to start', /No models yet/.test(await page.textContent('#modelsBox')));
        await page.click('[data-v="2"]');
        await page.waitForTimeout(150);
        await page.click('[data-job-on="reply"]');
        await page.waitForTimeout(220);
        const noModelSave = await page.evaluate(function () {
            return window.__calls.filter(function (c) { return c[0] === 'saveConfig' && c[1] && c[1].job; }).length;
        });
        ok('a job cannot be switched on before a model is chosen', noModelSave === 0, String(noModelSave));
        ok('…and it says why', await page.isVisible('#toast'));

        // ── CHECK FOR UPDATES… FROM THE APP MENU ──────────────────────────
        // The menu item is main.js's and unrunnable here; what IS drivable is
        // what the window does when told. It must open the panel AND ask
        // again — this app is meant to stay running for weeks, so the verdict
        // from launch can be very old, and someone choosing the menu item is
        // asking the question now.
        const beforeMenu = await page.evaluate(function () {
            return window.__calls.filter(function (c) { return c[0] === 'checkUpdate'; }).length;
        });
        const menu = await page.evaluate(async function () {
            if (typeof window.__openUpdates !== 'function') { return { wired: false }; }
            window.__openUpdates();
            await new Promise(function (r) { setTimeout(r, 300); });
            return {
                wired: true,
                shown: !document.getElementById('upScrim').hidden,
                checks: window.__calls.filter(function (c) { return c[0] === 'checkUpdate'; }).length,
            };
        });
        ok('the window listens for Check for Updates…', menu.wired);
        ok('…and opens the update panel', menu.shown === true);
        ok('…having asked again rather than showing the answer from launch',
            menu.checks > beforeMenu, menu.checks + ' vs ' + beforeMenu);
        await page.evaluate(function () { document.getElementById('upScrim').hidden = true; });

        // ── STARTING THE MODEL SERVER FROM THE WINDOW ──────────────────────
        // The affordance that closes the Terminal step. Everything about WHAT
        // gets started is core/runner.js's and gated there; this is about
        // whether the owner can see and press the thing.
        //
        // Each case RELOADS with its own state, because the window renders from
        // the state it already holds and a nav click does not re-ask — the first
        // draft of this section drove `__nextState` and silently tested the
        // default state four times over.
        async function bootRunner(over) {
            await page.addInitScript('window.__state = ' + JSON.stringify(fakeState(over)) + '; window.__nextState = null;');
            await page.reload();
            await page.waitForTimeout(350);
            await page.click('#gearBtn');
            await page.waitForTimeout(120);
            await page.click('[data-st="1"]');
            await page.waitForTimeout(150);
        }
        const DOWN = {
            engineServing: false,
            engines: [
                { id: 'llamacpp', name: 'llama.cpp', note: 'Metal on Apple silicon.', usable: true, serving: false, base: 'http://127.0.0.1:8080', why: '' },
                { id: 'ollama', name: 'Ollama', note: 'If you already run Ollama.', usable: true, serving: false, base: 'http://127.0.0.1:11434', why: '' },
            ],
        };

        await bootRunner({});
        ok('nothing to start while it is already serving — no Start button',
            (await page.$('#startEng')) === null);

        await bootRunner(DOWN);
        ok('a dead engine offers Start', (await page.$('#startEng')) !== null);
        ok('…and says where it found llama.cpp rather than only offering a button',
            /Resources\/runner\/llama-server/.test(await page.textContent('#runnerNote')),
            await page.textContent('#runnerNote'));

        // THE HOME FACT FOLLOWS. "Not answering" in red would report a
        // problem the app is about to solve for itself.
        await page.keyboard.press('Escape');
        await page.waitForTimeout(120);
        await page.click('[data-v="0"]');
        await page.waitForTimeout(150);
        ok('Home says the engine STARTS itself, not that it is broken',
            (await page.textContent('#factEng')).trim() === 'Starts'
            && /starts itself/.test(await page.textContent('#factEngSub')),
            await page.textContent('#factEng'));
        await page.click('#gearBtn');
        await page.waitForTimeout(120);
        await page.click('[data-st="1"]');
        await page.waitForTimeout(150);

        // Pressing it calls the bridge and reports the sentence the main
        // process gave — never a cheerful one of the window's own.
        await page.click('#startEng');
        await page.waitForTimeout(300);
        ok('Start asks the main process to start it',
            (await page.evaluate(function () { return window.__calls.filter(function (c) { return c[0] === 'startEngine'; }).length; })) === 1);
        ok('…and the toast is the answer that came back, word for word',
            /ready after 4 seconds/.test(await page.textContent('#toastSays')),
            await page.textContent('#toastSays'));

        // A REFUSAL IS THE MAIN PROCESS'S SENTENCE TOO.
        await bootRunner(DOWN);
        await page.evaluate(function () { window.__startAnswer = { ok: false, say: 'That model file could not be loaded.' }; });
        await page.click('#startEng');
        await page.waitForTimeout(300);
        ok('a refusal prints the real reason, not "it did not work"',
            /could not be loaded/.test(await page.textContent('#toastSays')),
            await page.textContent('#toastSays'));

        // NOT INSTALLED: the button stands down and the one command appears.
        await bootRunner(Object.assign({}, DOWN, {
            runner: {
                canStart: true, available: true, found: false, kind: '', path: '',
                install: 'brew install llama.cpp',
                problem: 'llama.cpp is not installed on this Mac yet.',
                running: false, autoStart: true,
            },
        }));
        ok('with nothing installed the Start button is disabled rather than lying',
            (await page.evaluate(function () { var b = document.getElementById('startEng'); return !!b && b.disabled; })));
        ok('…the problem is stated', /not installed/.test(await page.textContent('#runnerNote')),
            await page.textContent('#runnerNote'));
        ok('…and the ONE COMMAND is on screen, and selectable',
            (await page.evaluate(function () {
                var el = document.getElementById('runnerFix');
                return el && !el.hidden && el.textContent.indexOf('brew install llama.cpp') !== -1
                    && getComputedStyle(el).userSelect !== 'none';
            })));

        // AN ENGINE THIS APP DOES NOT START SAYS SO, rather than offering a
        // button that would do nothing.
        await bootRunner(Object.assign({}, DOWN, {
            engine: 'ollama',
            runner: {
                canStart: false, available: true, found: true, kind: 'bundled',
                path: '/App/Contents/Resources/runner/llama-server', install: '',
                problem: 'Ollama runs its own service, so this app does not start or stop it.',
                running: false, autoStart: true,
            },
        }));
        ok('Ollama gets no Start button', (await page.$('#startEng')) === null);
        ok('…and the reason is on screen', /own service/.test(await page.textContent('#runnerNote')),
            await page.textContent('#runnerNote'));

        await ctx.close();
    }

    // ── THE DOCK ICON'S SHAPE, measured on its own pixels ─────────────────
    // core-test proves the file has an alpha channel; only rendering it proves
    // the alpha is in the shape of a Mac icon. Done once rather than per theme
    // — a PNG has no theme.
    {
        const ctx = await browser.newContext({ viewport: { width: 1100, height: 1100 } });
        const page = await ctx.newPage();
        const src = 'data:image/png;base64,'
            + fs.readFileSync(path.join(__dirname, '..', 'build', 'icon.png')).toString('base64');
        const m = await page.evaluate(async function (dataUrl) {
            const img = new Image();
            img.src = dataUrl;
            await img.decode();
            const c = document.createElement('canvas');
            c.width = img.width; c.height = img.height;
            const g = c.getContext('2d');
            g.drawImage(img, 0, 0);
            const d = g.getImageData(0, 0, c.width, c.height).data;
            const alpha = function (x, y) { return d[(y * c.width + x) * 4 + 3]; };
            let minX = 1e9, minY = 1e9, maxX = -1, maxY = -1;
            for (let y = 0; y < c.height; y++) {
                for (let x = 0; x < c.width; x++) {
                    if (alpha(x, y) > 8) {
                        if (x < minX) { minX = x; }
                        if (x > maxX) { maxX = x; }
                        if (y < minY) { minY = y; }
                        if (y > maxY) { maxY = y; }
                    }
                }
            }
            // How far in from the body's left edge the ink starts, on the very
            // top row of the body. For a plain quarter-circle that is the
            // radius; a continuous corner starts its curve further out.
            let firstInk = 0;
            while (firstInk < c.width && alpha(minX + firstInk, minY) <= 8) { firstInk++; }
            return {
                w: maxX - minX + 1, h: maxY - minY + 1,
                left: minX, top: minY, right: c.width - 1 - maxX, bottom: c.height - 1 - maxY,
                corners: [alpha(2, 2), alpha(c.width - 3, 2), alpha(2, c.height - 3), alpha(c.width - 3, c.height - 3)],
                bodyCorner: alpha(minX + 2, minY + 2),
                middle: alpha(c.width >> 1, c.height >> 1),
                firstInk: firstInk,
            };
        }, src);

        ok('the icon canvas is transparent at its corners — macOS masks nothing, so this is the silhouette',
            m.corners.every(function (a) { return a === 0; }), JSON.stringify(m.corners));
        ok('…and opaque in the middle', m.middle > 250, String(m.middle));
        ok('the body is Apple\'s 824 on the 1024 grid',
            Math.abs(m.w - 824) <= 2 && Math.abs(m.h - 824) <= 2, m.w + 'x' + m.h);
        ok('…centred, so the shadow has its margin all round',
            [m.left, m.top, m.right, m.bottom].every(function (v) { return Math.abs(v - 100) <= 2; }),
            JSON.stringify([m.left, m.top, m.right, m.bottom]));
        ok('…and its own corner is cut away, not square',
            m.bodyCorner === 0, String(m.bodyCorner));
        // THE SHAPE ITSELF. A plain border-radius corner begins exactly at the
        // radius (measured: 168px in); the continuous curve begins further out
        // (measured: 203). Anything at or under the radius is an arc.
        ok('the corner is a CONTINUOUS curve, not a quarter-circle',
            m.firstInk > 190, m.firstInk + 'px in (an arc measures ~168)');
        await ctx.close();
    }

    await browser.close();
    console.log('\n== Summary ==');
    if (fails) {
        console.log('  ' + fails + ' CHECK(S) FAILED ❌\n');
        process.exit(1);
    }
    console.log('  ALL CHECKS PASSED ✅\n');
})().catch(function (e) {
    console.error('harness error:', e && e.stack ? e.stack : e);
    process.exit(1);
});
