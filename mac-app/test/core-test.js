#!/usr/bin/env node
// ============================================================
//  core-test.js — every judgement in the app's core, with no Electron, no
//  model, no network and no Mac.
//
//      node test/core-test.js
//
//  This is the file that makes the app worth shipping unbuilt. I cannot compile
//  a .app in this container and I cannot run a local model here, so the deal is
//  that everything ABOVE the model is driven and verified, and what is left
//  unverified is small and named: the Electron window, and whether the model's
//  prose is any good.
//
//  The section that matters most is §3, the GUARD. Its job is to catch a model
//  that invents a price or an availability answer, and it is checked against
//  the exact shapes a real model produces when it goes wrong.
// ============================================================
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');

const machine = require('../src/core/machine');
const guard = require('../src/core/guard');
const site = require('../src/core/site');
const engine = require('../src/core/engine');
const models = require('../src/core/models');
const config = require('../src/core/config');
const jobs = require('../src/core/jobs');
const night = require('../src/core/night');
const update = require('../src/core/update');
const updater = require('../src/core/updater');
const runner = require('../src/core/runner');

let fails = 0;
let passes = 0;
function ok(label, cond, detail) {
    if (cond) {
        passes++;
        console.log('  ✓ ' + label);
    } else {
        fails++;
        console.log('  ✗ ' + label + (detail ? ' — ' + String(detail).slice(0, 160) : ''));
    }
}
function section(t) { console.log('\n' + t); }

// A Mac to reason about, so the verdicts are not at the mercy of the box this runs on.
const M16 = { isMac: true, arch: 'arm64', appleSilicon: true, ramGB: 16, macos: '15.6', model: 'Macmini9,1', cpu: 'Apple M2', cores: 8 };
const INTEL = { isMac: true, arch: 'x64', appleSilicon: false, ramGB: 16, macos: '14.7', model: 'Macmini8,1', cpu: 'Intel Core i7', cores: 12 };

// ── §1 THE MACHINE ───────────────────────────────────────────────────────
section('§1 the machine, and what it says will run');
const real = machine.readMachine();
ok('reading this machine never throws and reports an arch', typeof real.arch === 'string' && real.arch.length > 0);
ok('…and some RAM', real.ramGB > 0);
ok('a description is one readable line', machine.describe(M16).indexOf('16 GB') !== -1, machine.describe(M16));
ok('a 9 GB model on 16 GB runs well', machine.modelVerdict(M16, 9).fit === 'ok');
ok('…and says so in words', /Runs well/.test(machine.modelVerdict(M16, 9).why));
ok('a 12 GB model on 16 GB is slow, not refused', machine.modelVerdict(M16, 12).fit === 'slow');
ok('…and names the RAM it is tight on', /16 GB/.test(machine.modelVerdict(M16, 12).why));
ok('a 20 GB model on 16 GB will not fit', machine.modelVerdict(M16, 20).fit === 'no');
ok('a 47 GB model certainly will not', machine.modelVerdict(M16, 47).fit === 'no');
ok('an unknown size is UNKNOWN, never a cheerful yes', machine.modelVerdict(M16, 0).fit === 'unknown');
// The Intel promise from the design conversation, in code.
ok('the same 9 GB model FITS on an Intel Mac', INTEL && machine.modelVerdict(INTEL, 9).fit === 'ok');
ok('…and says the honest thing about why it will be slow', /CPU only/.test(machine.modelVerdict(INTEL, 9).why));
ok('an MLX-only model is refused on Intel', machine.modelVerdict(INTEL, 8, { mlxOnly: true }).fit === 'no');
ok('…for the right reason', /Apple silicon only/.test(machine.modelVerdict(INTEL, 8, { mlxOnly: true }).why));
ok('…and accepted on Apple silicon', machine.modelVerdict(M16, 8, { mlxOnly: true }).fit === 'ok');
ok('the soft line is below the hard one', machine.RAM_SOFT < machine.RAM_HARD);

// ── §2 THE ENGINES ───────────────────────────────────────────────────────
section('§2 two engines, one adapter');
const availAS = engine.available(M16);
const availIntel = engine.available(INTEL);
ok('three engines are offered', availAS.length === 3);
ok('all three are usable on Apple silicon', availAS.every(function (e) { return e.usable; }));
ok('MLX is NOT usable on Intel', availIntel.filter(function (e) { return e.id === 'mlx'; })[0].usable === false);
ok('…and it is still LISTED, with a reason', /Apple silicon only/.test(availIntel.filter(function (e) { return e.id === 'mlx'; })[0].why));
ok('llama.cpp is usable on both', availIntel.filter(function (e) { return e.id === 'llamacpp'; })[0].usable === true);
ok('Apple silicon prefers MLX once it is actually serving', engine.pickDefault(M16, { mlx: true, llamacpp: true }) === 'mlx');
ok('…but never when it is not', engine.pickDefault(M16, { mlx: false, llamacpp: true }) === 'llamacpp');
ok('Intel never picks MLX even when something answers on its port', engine.pickDefault(INTEL, { mlx: true, llamacpp: true }) === 'llamacpp');
ok('with nothing serving it still names a default rather than nothing', engine.pickDefault(INTEL, {}) === 'llamacpp');

// A fake engine endpoint. This is how the drafting path is driven with no model.
function fakeEngine(reply, opts) {
    const o = opts || {};
    return engine.makeEngine({
        id: o.id || 'llamacpp',
        get: async function () { return { ok: o.down ? false : true, status: o.down ? 500 : 200, json: { data: [] } }; },
        post: async function () {
            if (o.throw) {
                throw new Error('socket hang up');
            }
            if (o.httpFail) {
                return { ok: false, status: 500, json: { error: { message: 'no model loaded' } } };
            }
            return {
                ok: true, status: 200,
                json: { choices: [{ message: { content: reply } }], usage: { completion_tokens: o.tokens || 120 } },
            };
        },
    });
}

// ── §3 THE GUARD — the most important section in this suite ──────────────
section('§3 the guard: the brief states the facts, the model arranges the words');
const FACTS = {
    first: 'Rachel', name: 'Rachel Pemberton', cottage: 'Jollyboat',
    check_in: '2026-10-12', check_out: '2026-10-19', nights: 7,
    adults: 2, children: 0, dates_free: true,
    quote: '£892.50', deposit: '£75.00',
    message: 'Is Jollyboat free that week, and do you take dogs?',
    facts: [{ q: 'Do you take dogs?', a: 'We are afraid not.' }],
};
const GOOD = 'Thank you for getting in touch. Jollyboat is free for the week of 12 October — seven nights, £892.50 all in. We are afraid we cannot take dogs at any of the three cottages, so I would hate for you to book and find out at the door. There is a refundable £75.00 damages deposit which comes back after your stay. Do let me know if that suits and I will hold the dates for a couple of days.';
ok('a good draft passes', guard.checkDraft(GOOD, FACTS).ok, JSON.stringify(guard.checkDraft(GOOD, FACTS).problems));

// MONEY IT WAS NOT GIVEN. The failure that matters most.
const INVENTED = GOOD.replace('£892.50', '£845.00');
ok('a figure the site did not give is REFUSED', !guard.checkDraft(INVENTED, FACTS).ok);
ok('…and the reason names the figure', /845\.00/.test(guard.checkDraft(INVENTED, FACTS).problems.join(' ')));
const EXTRA = GOOD + ' There is also a £30.00 cleaning charge.';
ok('an extra charge it made up is refused', !guard.checkDraft(EXTRA, FACTS).ok);
ok('the SAME figure written differently is accepted', guard.checkDraft(GOOD.replace('£892.50', '£ 892.5'), FACTS).ok);
ok('a figure that is not the quoted one is refused, separators and all', guard.checkDraft(GOOD.replace('£892.50', '£892.50'), Object.assign({}, FACTS, { quote: '£1,892.50' })).ok === false);
ok('…and the correctly-separated one passes',
    guard.checkDraft(GOOD.replace('£892.50', '£1,892.50'), Object.assign({}, FACTS, { quote: '£1892.50' })).ok);
ok('with no quote at all, ANY figure is refused', !guard.checkDraft(GOOD, Object.assign({}, FACTS, { quote: '', deposit: '' })).ok);
ok('…and a draft with no money in it passes',
    guard.checkDraft('Thank you for getting in touch. Jollyboat is free for the week of 12 October and we would be glad to have you. We are afraid we cannot take dogs at any of the three cottages. Do let me know and I will hold the dates.', Object.assign({}, FACTS, { quote: '', deposit: '' })).ok);

// AVAILABILITY IT DID NOT KNOW.
const FREE_UNKNOWN = Object.assign({}, FACTS, { dates_free: null });
ok('a claim that the dates are free, when the site could not tell, is refused',
    !guard.checkDraft(GOOD, FREE_UNKNOWN).ok);
ok('…and the reason says so', /could not confirm/.test(guard.checkDraft(GOOD, FREE_UNKNOWN).problems.join(' ')));
const TAKEN = Object.assign({}, FACTS, { dates_free: false });
ok('saying free when the site says taken is refused', !guard.checkDraft(GOOD, TAKEN).ok);
const SORRY = 'Thank you for getting in touch. I am sorry to say that week has already been taken — it went earlier in the month. If you have any flexibility I would be glad to look at what else is open for you. Jollyboat is our smallest cottage and it does go quickly at that time of year. Do let me know what dates might work.';
ok('saying taken when the site says taken passes', guard.checkDraft(SORRY, TAKEN).ok, JSON.stringify(guard.checkDraft(SORRY, TAKEN).problems));
ok('saying taken when the site says FREE is refused', !guard.checkDraft(SORRY, FACTS).ok);
ok('with availability unknown, a draft that says nothing about it passes',
    guard.checkDraft('Thank you for getting in touch about Jollyboat. We are afraid we cannot take dogs at any of the three cottages, so I wanted to say so before you go any further. I will come back to you on the dates as soon as I have checked the diary properly. Do bear with me.', Object.assign({}, FREE_UNKNOWN, { quote: '', deposit: '' })).ok);

// THINGS THAT BELONG TO THE APP.
ok('a link is refused', !guard.checkDraft(GOOD + ' Book at https://example.com/pay', FACTS).ok);
ok('a www link is refused', !guard.checkDraft(GOOD + ' See www.example.com', FACTS).ok);
ok('claiming it already charged the card is refused', !guard.checkDraft(GOOD + ' Your card has been charged.', FACTS).ok);
ok('claiming it already booked is refused', !guard.checkDraft("I've booked that for you. " + GOOD, FACTS).ok);
ok('a greeting is refused — the template adds one', !guard.checkDraft('Hello Rachel, ' + GOOD, FACTS).ok);
ok('…as is "Hi"', !guard.checkDraft('Hi Rachel — ' + GOOD, FACTS).ok);
ok('…and "Dear"', !guard.checkDraft('Dear Rachel, ' + GOOD, FACTS).ok);
ok('a one-line answer is refused as too short', !guard.checkDraft('Yes, it is free.', FACTS).ok);
ok('an essay is refused as too long', !guard.checkDraft(GOOD + ' ' + 'x'.repeat(4200), FACTS).ok);
ok('empty is refused', !guard.checkDraft('', FACTS).ok);
ok('null is refused', !guard.checkDraft(null, FACTS).ok);
// Every problem must read as a sentence: it ends up in the night log.
const probs = guard.checkDraft('Hi Rachel, ' + INVENTED + ' See www.x.com', FACTS).problems;
ok('several problems are reported together, not just the first', probs.length >= 3, JSON.stringify(probs));
ok('…and every one is a sentence a person can read', probs.every(function (p) { return /^[a-z]/.test(p) && p.length > 10 && !/[{}<>]/.test(p); }), JSON.stringify(probs));

section('§3b money parsing, since everything above rests on it');
ok('one figure', JSON.stringify(guard.moneyIn('it is £892.50 all in')) === '["892.50"]');
ok('two distinct figures', guard.moneyIn('£892.50 and £75.00').length === 2);
ok('the same figure twice counts once', guard.moneyIn('£75 and £75.00').length === 1);
ok('a space after the sign', guard.moneyIn('£ 892.50').length === 1);
ok('thousands', JSON.stringify(guard.moneyIn('£1,892.50')) === '["1892.50"]');
ok('no pence', JSON.stringify(guard.moneyIn('£90')) === '["90.00"]');
ok('a bare number is not money', guard.moneyIn('7 nights for 2 adults').length === 0);
ok('a year is not money', guard.moneyIn('in 2026 we open again').length === 0);
ok('normalising is idempotent', guard.normaliseMoney('£1,234.5') === '1234.50');
ok('nonsense normalises to nothing', guard.normaliseMoney('lots') === '');

section('§3c the prompt, which must state every rule the guard enforces');
const prompt = guard.buildPrompt(FACTS, 'George');
ok('the prompt names the host', /George/.test(prompt));
ok('it forbids a greeting', /Do NOT open with a greeting/i.test(prompt));
ok('it forbids inventing a figure', /Do NOT invent, calculate or alter any figure/i.test(prompt));
ok('it forbids links', /Do NOT include links/i.test(prompt));
ok('it hands over the quote verbatim', prompt.indexOf('£892.50') !== -1);
ok('it states the dates ARE free when they are', /Those dates ARE free/.test(prompt));
ok('it states they are NOT when they are not', /are NOT free/.test(guard.buildPrompt(TAKEN, 'George')));
ok('it orders silence when availability is unknown', /Say nothing at all about whether the dates are free/.test(guard.buildPrompt(FREE_UNKNOWN, 'George')));
ok('with no price it forbids mentioning money', /Do not mention money/.test(guard.buildPrompt(Object.assign({}, FACTS, { quote: '', deposit: '' }), 'G')));
ok('the cottage answers are handed over', prompt.indexOf('Do you take dogs?') !== -1);
ok('the enquiry itself is handed over', prompt.indexOf('do you take dogs') !== -1);
ok('a party is described in words', guard.partyWords(2, 1) === '2 adults, 1 child');
ok('…pluralised properly', guard.partyWords(1, 2) === '1 adult, 2 children');
ok('…and empty when there is nothing to say', guard.partyWords(0, 0) === '');

// ── §4 THE SITE ──────────────────────────────────────────────────────────
section('§4 the site: two calls, and every refusal named');
function fakeSite(handler) {
    return site.makeSite({ url: 'https://x.test/nightshift.php', secret: 's3cret', post: handler });
}
(async function () {
    let s = fakeSite(async function () {
        return { ok: true, status: 200, json: { ok: true, host: 'George', enquiries: [{ id: 1 }] } };
    });
    let b = await s.brief();
    ok('a good brief comes back', b.ok && b.host === 'George' && b.enquiries.length === 1);

    s = fakeSite(async function () { return { ok: false, status: 401, json: { error: 'Not authorised.' } }; });
    b = await s.brief();
    ok('401 is reported as an AUTH problem, in words', !b.ok && b.refusal.kind === 'auth'
        && /key/i.test(b.refusal.say) && /connect/i.test(b.refusal.say));

    s = fakeSite(async function () { return { ok: false, status: 409, json: { code: 'night_off', error: 'off' } }; });
    b = await s.brief();
    ok('the switch being off is its OWN state, not an error', !b.ok && b.refusal.kind === 'off');
    ok('…and it says where to switch it on', /switched off/i.test(b.refusal.say));

    s = fakeSite(async function () { return { ok: false, status: 503, json: { code: 'night_no_table' } }; });
    b = await s.brief();
    ok('an un-migrated site is a SETUP problem', !b.ok && b.refusal.kind === 'setup');

    s = fakeSite(async function () { return { ok: false, status: 429, json: {} }; });
    b = await s.brief();
    ok('rate limiting says it will try tomorrow', !b.ok && b.refusal.kind === 'rate');

    s = fakeSite(async function () { throw new Error('ECONNREFUSED'); });
    b = await s.brief();
    ok('an unreachable site is a NET problem', !b.ok && b.refusal.kind === 'net');

    // An uncertain POST must not read as a failure — the ref makes a retry safe.
    s = fakeSite(async function (u, body) {
        if (body.action === 'ingest') { throw new Error('socket hang up'); }
        return { ok: true, status: 200, json: { ok: true, enquiries: [] } };
    });
    let g = await s.ingest([{ ref: 'r', kind: 'reply', title: 't', body: 'b' }]);
    ok('a lost reply to a post is UNCERTAIN, not failed', !g.ok && g.uncertain === true);
    ok('…and says why a retry is safe', /reference/i.test(g.refusal.say));

    s = fakeSite(async function () { return { ok: true, status: 200, json: { ok: true, stored: 2, skipped: [{ ref: 'x', why: 'too long' }] } }; });
    g = await s.ingest([{ ref: 'a' }, { ref: 'b' }, { ref: 'c' }]);
    ok('a post reports what was stored and what was not', g.ok && g.stored === 2 && g.skipped.length === 1);
    g = await s.ingest([]);
    ok('posting nothing is a success that sends nothing', g.ok && g.stored === 0);

    const noSecret = site.makeSite({ url: 'https://x.test/n.php', secret: '' });
    b = await noSecret.brief();
    ok('with no secret it refuses BEFORE any request', !b.ok && b.refusal.kind === 'setup');

    // Test now reports the distinct states, because they want different things done.
    s = fakeSite(async function () { return { ok: true, status: 200, json: { ok: true, enquiries: [{}, {}] } }; });
    let t = await s.test();
    ok('Test now: on, and counts what is waiting', t.state === 'on' && /2 enquiries waiting/.test(t.say), t.say);
    s = fakeSite(async function () { return { ok: false, status: 409, json: { code: 'night_off' } }; });
    t = await s.test();
    ok('Test now: off is reported as off', t.state === 'off');
    s = fakeSite(async function () { return { ok: false, status: 401, json: {} }; });
    t = await s.test();
    ok('Test now: a bad secret is reported as such', t.state === 'auth');
    s = fakeSite(async function () { throw new Error('nope'); });
    t = await s.test();
    ok('Test now: unreachable is its own answer', t.state === 'unreachable');

    section('§4b the ref — the exactly-once mechanism');
    const r1 = site.makeRef('reply', 42, '2026-08-17');
    const r2 = site.makeRef('reply', 42, '2026-08-17');
    ok('the same work on the same night gives the SAME ref', r1 === r2, r1 + ' vs ' + r2);
    ok('a different enquiry gives a different ref', r1 !== site.makeRef('reply', 43, '2026-08-17'));
    ok('the next night gives a different ref', r1 !== site.makeRef('reply', 42, '2026-08-18'));
    ok('the ref is in the shape the site accepts', /^[A-Za-z0-9._:-]+$/.test(r1) && r1.length <= 64, r1);
    ok('a hostile kind cannot break the shape', /^[A-Za-z0-9._:-]+$/.test(site.makeRef('../x', 1, '2026-08-17')));
    ok('a hostile day cannot either', /^[A-Za-z0-9._:-]+$/.test(site.makeRef('reply', 1, '2026-08-17; DROP')));
    ok('today() is an ISO date', /^\d{4}-\d{2}-\d{2}$/.test(site.today(new Date(2026, 7, 17))));

    // ── §5 THE ENGINE ADAPTER ────────────────────────────────────────────
    section('§5 asking for prose, and every way that can go wrong');
    let e = fakeEngine(GOOD, { tokens: 150 });
    ok('a reachable engine says so', await e.reachable() === true);
    let w = await e.write('prompt', 'a-model');
    ok('a good answer comes back with its text', w.ok && w.text === GOOD);
    ok('…and a measured speed, not a quoted one', w.tokens === 150 && typeof w.tokensPerSec === 'number');
    e = fakeEngine('', { down: true });
    ok('a dead engine is not reachable', await e.reachable() === false);
    e = fakeEngine('', { httpFail: true });
    w = await e.write('p', 'm');
    ok('an HTTP failure is reported in words', !w.ok && /refused/i.test(w.say) && /no model loaded/.test(w.say), w.say);
    e = fakeEngine('', { throw: true });
    w = await e.write('p', 'm');
    ok('a hung socket is reported in words', !w.ok && /did not answer/i.test(w.say));
    e = fakeEngine('   \n  ');
    w = await e.write('p', 'm');
    ok('an empty answer is a failure, not an empty draft', !w.ok && /nothing/i.test(w.say));

    // ── §6 THE JOB ───────────────────────────────────────────────────────
    section('§6 the reply job, driven end to end with no model');
    const ENQ = Object.assign({ id: 42 }, FACTS);
    let out = await jobs.runReplyJob({
        engine: fakeEngine(GOOD), model: 'm', host: 'George',
        now: new Date(2026, 7, 17, 2, 14), enquiries: [ENQ],
    });
    ok('one enquiry becomes one item', out.items.length === 1);
    const it = out.items[0];
    ok('the item is a reply', it.kind === 'reply');
    ok('…titled for the guest', it.title === 'Reply to Rachel Pemberton');
    ok('…sub-lined with the cottage, the dates and the party', /Jollyboat/.test(it.sub) && /12–19 Oct/.test(it.sub) && /2 adults/.test(it.sub), it.sub);
    ok('…carrying the draft as its body', it.body === GOOD);
    ok('…naming what it was written from', /their enquiry/.test(it.source) && /own price/.test(it.source), it.source);
    ok('…and pointing at the enquiry on the site', it.target === 'enquiry-42');
    ok('the log says it drafted one', out.log.some(function (l) { return l.level === 'hit'; }));

    // THE GUARD IN THE JOB, not just in isolation.
    out = await jobs.runReplyJob({
        engine: fakeEngine(INVENTED), model: 'm', host: 'George', now: new Date(), enquiries: [ENQ],
    });
    ok('a draft that invents a figure is NEVER returned', out.items.length === 0);
    ok('…and the log says which rule it broke', out.log.some(function (l) { return l.level === 'fail' && /refused own draft/.test(l.say) && /845/.test(l.say); }),
        JSON.stringify(out.log));
    out = await jobs.runReplyJob({
        engine: fakeEngine('Hello Rachel, ' + GOOD), model: 'm', host: 'George', now: new Date(), enquiries: [ENQ],
    });
    ok('a draft that greets is never returned either', out.items.length === 0);

    out = await jobs.runReplyJob({
        engine: fakeEngine(GOOD), model: 'm', host: 'G', now: new Date(),
        enquiries: [Object.assign({}, ENQ, { message: '   ' })],
    });
    ok('an enquiry with no message is skipped', out.items.length === 0 && out.log.some(function (l) { return l.level === 'skip'; }));
    out = await jobs.runReplyJob({ engine: fakeEngine(GOOD), model: 'm', enquiries: [] });
    ok('a quiet night returns nothing and says so', out.items.length === 0 && /nothing waiting/.test(out.log[0].say));
    out = await jobs.runReplyJob({
        engine: fakeEngine('', { httpFail: true }), model: 'm', now: new Date(), enquiries: [ENQ],
    });
    ok('a model that fails is logged per enquiry, not thrown', out.items.length === 0 && out.log.some(function (l) { return l.level === 'fail'; }));
    // Two enquiries, one good and one that breaks a rule: the good one still ships.
    out = await jobs.runReplyJob({
        engine: {
            id: 'x', name: 'x', base: '', reachable: async function () { return true; },
            write: (function () {
                let n = 0;
                return async function () {
                    n++;
                    return { ok: true, text: n === 1 ? GOOD : INVENTED, ms: 100, tokens: 10, tokensPerSec: 10 };
                };
            })(),
        },
        model: 'm', now: new Date(), enquiries: [ENQ, Object.assign({}, ENQ, { id: 43 })],
    });
    ok('one bad draft does not lose the good one', out.items.length === 1 && out.items[0].target === 'enquiry-42');

    section('§6b the words on the card');
    ok('a same-month range reads 12–19 Oct', jobs.spokenRange('2026-10-12', '2026-10-19') === '12–19 Oct');
    ok('a cross-month range names both', jobs.spokenRange('2026-12-28', '2027-01-03') === '28 Dec – 3 Jan');
    ok('a nonsense date yields nothing rather than "NaN"', jobs.spokenRange('rubbish', '2026-01-01') === '');

    // ── §7 THE NIGHT ─────────────────────────────────────────────────────
    section('§7 the night, end to end');
    function runWith(opts) {
        const o = opts || {};
        const posted = [];
        const s = site.makeSite({
            url: 'https://x.test/n.php', secret: 's',
            post: async function (u, body) {
                if (body.action === 'brief') {
                    if (o.briefOff) { return { ok: false, status: 409, json: { code: 'night_off' } }; }
                    return { ok: true, status: 200, json: { ok: true, host: 'George', enquiries: o.enquiries || [ENQ] } };
                }
                posted.push(body);
                if (o.ingestLost) { throw new Error('hang up'); }
                return { ok: true, status: 200, json: { ok: true, stored: (body.items || []).length, skipped: o.skipped || [] } };
            },
        });
        return night.runNight({
            site: s,
            engine: o.engine || fakeEngine(GOOD),
            cfg: o.cfg || { jobs: { reply: { on: true, model: 'qwen', at: '02:00' } } },
            machine: M16,
            now: new Date(2026, 7, 17, 2, 14),
        }).then(function (rec) { return { rec: rec, posted: posted }; });
    }
    let r = await runWith({});
    ok('a good night posts what it drafted', r.rec.ok && r.rec.drafted === 1 && r.rec.posted === 1);
    ok('…and the log ends with a summary', r.rec.log[r.rec.log.length - 1].level === 'done');
    ok('…and the post carried an ingest, nothing else', r.posted.length === 1 && r.posted[0].action === 'ingest');
    r = await runWith({ cfg: { jobs: { reply: { on: false, model: 'q' } } } });
    ok('every job off means nothing is drafted and nothing posted', r.rec.ok && r.rec.drafted === 0 && r.posted.length === 0);
    ok('…and the log says why', r.rec.log.some(function (l) { return /switched off/.test(l.say); }));
    r = await runWith({ cfg: { jobs: { reply: { on: true, model: '' } } } });
    ok('no model chosen stops the run with a sentence', !r.rec.ok && r.rec.log.some(function (l) { return /pick one/.test(l.say); }));
    r = await runWith({ briefOff: true });
    ok('the site being switched off stops the run cleanly', !r.rec.ok && r.rec.stopped === 'off' && r.posted.length === 0);
    r = await runWith({ engine: fakeEngine(GOOD, { down: true }) });
    ok('a dead engine is ONE line, not one per enquiry', !r.rec.ok
        && r.rec.log.filter(function (l) { return l.level === 'fail'; }).length === 1
        && /not answering/.test(r.rec.log.filter(function (l) { return l.level === 'fail'; })[0].say));
    r = await runWith({ ingestLost: true });
    ok('a lost reply to the post leaves the night UNCERTAIN, not failed', r.rec.uncertain === true && r.rec.ok === true);
    r = await runWith({ enquiries: [] });
    ok('a quiet night is a success', r.rec.ok && r.rec.drafted === 0);
    r = await runWith({ skipped: [{ ref: 'x', why: 'the queue is full' }] });
    ok('anything the site would not take is named in the log', r.rec.log.some(function (l) { return /would not take/.test(l.say) && /queue is full/.test(l.say); }));

    section('§7b when it next runs');
    const at2am = night.nextRun('02:00', new Date(2026, 7, 17, 19, 18));
    ok('from teatime, the next 02:00 is tomorrow', at2am.getDate() === 18 && at2am.getHours() === 2);
    const at2amEarly = night.nextRun('02:00', new Date(2026, 7, 17, 1, 30));
    ok('from half past one, it is today', at2amEarly.getDate() === 17);
    ok('at exactly the hour it means tomorrow, never a double run',
        night.nextRun('02:00', new Date(2026, 7, 17, 2, 0, 0)).getDate() === 18);
    ok('a nonsense time falls back to 02:00 rather than throwing', night.nextRun('rubbish', new Date(2026, 7, 17, 19, 0)).getHours() === 2);
    ok('the countdown reads in hours and minutes',
        night.untilWords(new Date(2026, 7, 18, 2, 0), new Date(2026, 7, 17, 19, 18)) === 'in 6 hours 42 minutes',
        night.untilWords(new Date(2026, 7, 18, 2, 0), new Date(2026, 7, 17, 19, 18)));
    ok('under a minute it does not say "in 0 minutes"',
        night.untilWords(new Date(2026, 7, 17, 2, 0, 30), new Date(2026, 7, 17, 2, 0, 0)) === 'any moment now');
    ok('a time gone by reads "now"', night.untilWords(new Date(2026, 7, 17, 1, 0), new Date(2026, 7, 17, 2, 0)) === 'now');
    let list = [];
    for (let i = 0; i < 40; i++) {
        list = night.pushRecord(list, { started: 'n' + i });
    }
    ok('the log keeps 30 nights and no more', list.length === night.LOG_KEEP);
    ok('…newest first', list[0].started === 'n39');

    // ── §8 THE MODEL LIBRARY ─────────────────────────────────────────────
    section('§8 the model library');
    ok('a GGUF filename becomes a readable name', models.prettyName('Qwen2.5-14B-Instruct-Q4_K_M.gguf') === 'Qwen 2.5 14B Instruct',
        models.prettyName('Qwen2.5-14B-Instruct-Q4_K_M.gguf'));
    ok('…and its quantisation is read off it', models.quantOf('Qwen2.5-14B-Instruct-Q4_K_M.gguf') === 'Q4_K_M');
    ok('a repo name works the same way', models.prettyName('Meta-Llama-3.1-8B-Instruct-GGUF') === 'Meta Llama 3.1 8B Instruct',
        models.prettyName('Meta-Llama-3.1-8B-Instruct-GGUF'));
    ok('parameters are read from the name', models.paramsOf('bartowski/Qwen2.5-14B-Instruct-GGUF') === 14);
    ok('…including a fraction', models.paramsOf('org/Model-1.5B-Instruct') === 1.5);
    ok('…and nothing when there is none', models.paramsOf('org/some-model') === 0);
    ok('a "b" inside a word is not a parameter count', models.paramsOf('org/Model-3bit-quant') === 0, String(models.paramsOf('org/Model-3bit-quant')));

    const row = models.mapRepo({ modelId: 'bartowski/Qwen2.5-14B-Instruct-GGUF', downloads: 500 }, M16);
    ok('a repo maps to a row with a fit verdict', row && row.fit === 'ok' && row.owner === 'bartowski');
    ok('…and says its size is an estimate rather than pretending', row.sizeIsEstimate === true);
    const big = models.mapRepo({ modelId: 'bartowski/Qwen2.5-72B-Instruct-GGUF' }, M16);
    ok('a 72B model will not fit on 16 GB', big.fit === 'no');
    const mlxRow = models.mapRepo({ modelId: 'mlx-community/Qwen2.5-14B-Instruct-4bit' }, INTEL);
    ok('an MLX repo is refused on Intel', mlxRow.fit === 'no' && /Apple silicon only/.test(mlxRow.why));
    ok('…and is marked as the MLX format', mlxRow.format === 'mlx');
    ok('a nameless repo maps to nothing rather than a blank row', models.mapRepo({}, M16) === null);

    // Searching, with a fake Hugging Face.
    let sr = await models.search('qwen', M16, {
        fetch: async function () {
            return {
                ok: true, status: 200,
                json: async function () {
                    return [
                        { modelId: 'random/Qwen2.5-14B-clone-GGUF', downloads: 9000 },
                        { modelId: 'bartowski/Qwen2.5-14B-Instruct-GGUF', downloads: 50 },
                    ];
                },
            };
        },
    });
    ok('a search returns rows', sr.ok && sr.rows.length === 2);
    ok('…with the known-good uploader first, even on fewer downloads', sr.rows[0].owner === 'bartowski',
        sr.rows.map(function (x) { return x.owner; }).join(','));
    sr = await models.search('q', M16, { fetch: async function () { throw new Error('nope'); } });
    ok('a one-letter search asks nothing and returns nothing', sr.ok && sr.rows.length === 0);
    sr = await models.search('qwen', M16, { fetch: async function () { throw new Error('offline'); } });
    ok('an unreachable Hugging Face is reported in words', !sr.ok && /Could not reach/.test(sr.say));
    sr = await models.search('qwen', M16, { fetch: async function () { return { ok: false, status: 503 }; } });
    ok('…as is a bad answer from it', !sr.ok && /503/.test(sr.say));
    sr = await models.search('qwen', M16, { fetch: async function () { return { ok: true, json: async function () { return { nope: 1 }; } }; } });
    ok('…and an unexpected shape', !sr.ok && /unexpected/.test(sr.say));

    // The installed list is a directory listing, so it is tested against a real one.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-models-'));
    fs.writeFileSync(path.join(tmp, 'Qwen2.5-14B-Instruct-Q4_K_M.gguf'), Buffer.alloc(2048));
    fs.writeFileSync(path.join(tmp, 'notes.txt'), 'not a model');
    // The projector beside a vision model IS a .gguf and is NOT a model — the
    // exact file seen offered live (a chosen mmproj can draft nothing).
    fs.writeFileSync(path.join(tmp, 'mmproj-gemma-4-E4B-it-BF16.gguf'), Buffer.alloc(512));
    fs.mkdirSync(path.join(tmp, 'Qwen2.5-14B-Instruct-4bit'));
    fs.writeFileSync(path.join(tmp, 'Qwen2.5-14B-Instruct-4bit', 'config.json'), '{}');
    fs.writeFileSync(path.join(tmp, 'Qwen2.5-14B-Instruct-4bit', 'weights.safetensors'), Buffer.alloc(1024));
    const inst = models.installed(tmp);
    ok('a .gguf file is found', inst.some(function (m) { return m.format === 'gguf' && /Qwen 2\.5 14B/.test(m.name); }));
    ok('an MLX folder is found', inst.some(function (m) { return m.format === 'mlx'; }));
    ok('a text file is not a model', inst.length === 2, JSON.stringify(inst.map(function (m) { return m.id; })));
    ok('an mmproj projector is not offered as a model',
        !inst.some(function (m) { return /mmproj/i.test(m.id); }), JSON.stringify(inst.map(function (m) { return m.id; })));
    ok('…and the same predicate guards the download picker', models.isProjector('mmproj-gemma-4-E4B-it-BF16.gguf')
        && models.isProjector('MMPROJ_model.gguf')
        && !models.isProjector('Qwen2.5-14B-Instruct-Q4_K_M.gguf'));
    // Prefix-anchored ON PURPOSE: "mmproj" mid-name is somebody's own naming,
    // and over-matching would silently hide a real model from the list.
    ok('…and it never matches mmproj mid-name', !models.isProjector('gemma-mmproj-notes.gguf'));
    ok('a missing folder is an empty library, not an error', models.installed(path.join(tmp, 'nope')).length === 0);

    // PROJECTOR PAIRING — vision needs the model's OWN mmproj, matched by
    // name with the quant tokens stripped, and NO pair means NO vision.
    fs.writeFileSync(path.join(tmp, 'mmproj-gemma-3-4b-it-F16.gguf'), 'p');
    ok('a projector pairs with ITS model, quant tokens stripped both sides',
        models.projectorFor('gemma-3-4b-it-Q4_K_M.gguf', tmp) === path.join(tmp, 'mmproj-gemma-3-4b-it-F16.gguf'));
    ok('…and never with a DIFFERENT model — a gemma projector on a qwen model is garbage in',
        models.projectorFor('Qwen2.5-14B-Instruct-Q4_K_M.gguf', tmp) === '');
    ok('no projector in the folder means no vision, said as an empty string',
        models.projectorFor('gemma-3-4b-it-Q4_K_M.gguf', path.join(tmp, 'nope')) === '');
    fs.rmSync(tmp, { recursive: true, force: true });

    // ── §9 SETTINGS AND THE SECRET ───────────────────────────────────────
    section('§9 settings on disk, and the secret NOT on disk');
    const cdir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-cfg-'));
    let cfg = config.load(cdir);
    ok('a first run loads the defaults', cfg.siteUrl === '' && cfg.jobs.reply.on === false);
    ok('…with a models folder chosen for it', cfg.modelsDir.length > 0);
    cfg.siteUrl = 'https://x.test/nightshift.php';
    cfg.jobs.reply.on = true;
    cfg.jobs.reply.model = 'qwen.gguf';
    ok('saving works', config.save(cfg, cdir).ok);
    const back = config.load(cdir);
    ok('…and comes back', back.siteUrl === cfg.siteUrl && back.jobs.reply.on === true && back.jobs.reply.model === 'qwen.gguf');
    fs.writeFileSync(path.join(cdir, 'config.json'), '{ not json');
    ok('a corrupt settings file falls back to defaults rather than crashing', config.load(cdir).siteUrl === '');
    fs.writeFileSync(path.join(cdir, 'config.json'), JSON.stringify({ keepAwake: 'yes please', futureThing: 7 }));
    const odd = config.load(cdir);
    ok('a stored value of the wrong TYPE is ignored', odd.keepAwake === true);
    ok('…while an unknown key written by a newer version survives', odd.futureThing === 7);
    fs.rmSync(cdir, { recursive: true, force: true });

    let stored = null;
    const keychain = config.makeSecrets({
        platform: 'darwin',
        run: function (args) {
            if (args[0] === 'add-generic-password') { stored = args[args.indexOf('-w') + 1]; return ''; }
            if (args[0] === 'find-generic-password') {
                if (stored === null) { throw new Error('not found'); }
                return stored + '\n';
            }
            if (args[0] === 'delete-generic-password') { stored = null; return ''; }
            return '';
        },
    });
    ok('with nothing stored, the secret is empty rather than an error', keychain.get() === '');
    ok('…and the state says none is set', keychain.state().set === false);
    ok('storing one works', keychain.set('the-real-secret').ok);
    ok('…and reading it back gives the secret', keychain.get() === 'the-real-secret');
    ok('the state says one is set', keychain.state().set === true);
    ok('…and NEVER what it is', keychain.state().hint.indexOf('real') === -1 && /^•+$/.test(keychain.state().hint));
    ok('clearing works', keychain.clear().ok && keychain.get() === '');
    const refused = config.makeSecrets({
        platform: 'darwin',
        run: function (args) { if (args[0] === 'add-generic-password') { throw new Error('user denied'); } throw new Error('not found'); },
    });
    const res = refused.set('x');
    ok('a Keychain that refuses does NOT fall back to a file', !res.ok && /not saved anywhere/.test(res.say));
    const notMac = config.makeSecrets({ platform: 'linux' });
    ok('off a Mac there is no Keychain and it says so', notMac.available === false && !notMac.set('x').ok);


    // ── THE UPDATER ───────────────────────────────────────────────────────
    // The decisions, which are the half that can be wrong invisibly. Every
    // refusal is here, because the failure mode of an updater is installing
    // something it should not have.
    console.log('\n15) is there a newer version, and may we install it?');
    const rel = (over) => Object.assign({
        tag_name: 'hand-build-20260818-0842',
        assets: [{
            name: 'Cottage-Holidays-Blakeney.dmg',
            browser_download_url: 'https://github.com/x/y/releases/download/t/Cottage-Holidays-Blakeney.dmg',
            size: 178521944,
            digest: 'sha256:a604591483a2953136e667eec978319ebe6989fd413b94159b64829ccff32534',
        }],
    }, over || {});
    const A = 'Cottage-Holidays-Blakeney.dmg';

    ok('a dated build parses', !!update.parseVersion('hand-build-20260818-0842'));
    ok('a semver tag parses', !!update.parseVersion('hand-v1.2.0'));
    ok('nonsense does not', update.parseVersion('latest') === null);
    ok('a later build beats an earlier one',
        update.compareVersions('hand-build-20260818-0842', 'hand-build-20260817-2253') === 1);
    ok('the same build is the same', update.compareVersions('hand-build-20260818-0842', 'hand-build-20260818-0842') === 0);
    ok('an earlier build loses', update.compareVersions('hand-build-20260817-2253', 'hand-build-20260818-0842') === -1);
    ok('same day, later time wins', update.compareVersions('hand-build-20260818-0900', 'hand-build-20260818-0842') === 1);
    // A DATED BUILD OUTRANKS A SEMVER ONE. CI publishes dated tags, so treating
    // 1.0.0 as newer would offer a downgrade for ever.
    ok('a CI build outranks a semver tag', update.compareVersions('hand-build-20260818-0842', 'hand-v1.0.0') === 1);
    ok('an unreadable version compares to nothing', update.compareVersions('latest', 'hand-v1.0.0') === null);

    ok('the same version reports current',
        update.updateVerdict('hand-build-20260818-0842', rel(), A).state === 'current');
    ok('a newer one reports available',
        update.updateVerdict('hand-build-20260817-2253', rel(), A).state === 'available');
    ok('...carrying the url, size and checksum', (function () {
        const v = update.updateVerdict('hand-build-20260817-2253', rel(), A);
        return /^https:/.test(v.url) && v.size === 178521944 && /^[0-9a-f]{64}$/.test(v.sha256);
    })());
    // NO CHECKSUM, NO DOWNLOAD — the whole safety story, since nothing here is
    // code-signed. It is still OFFERED, as a link.
    ok('no checksum means manual, never available',
        update.updateVerdict('hand-build-20260817-2253', rel({ assets: [{ name: A, browser_download_url: 'https://x/y.dmg', size: 1, digest: '' }] }), A).state === 'manual');
    ok('a digest that is not sha256 is treated as absent',
        update.assetSha256({ digest: 'md5:abc' }) === '' && update.assetSha256({ digest: 'sha256:zz' }) === '');
    ok('a release without our asset is unknown, not available',
        update.updateVerdict('hand-build-20260817-2253', rel({ assets: [{ name: 'other.zip', browser_download_url: 'https://x', digest: 'sha256:' + 'a'.repeat(64) }] }), A).state === 'unknown');
    ok('an unreadable tag never reports an update',
        update.updateVerdict('hand-build-20260817-2253', rel({ tag_name: 'latest' }), A).state === 'unknown');
    ok('nothing at all is unknown, and says so', (function () {
        const v = update.updateVerdict('hand-v1.0.0', null, A);
        return v.state === 'unknown' && /couldn't check/i.test(v.say);
    })());
    // EVERY state says something. A verdict with an empty sentence renders as a
    // blank line where an explanation should be.
    ok('every state carries a sentence', (function () {
        const seen = {};
        [
            update.updateVerdict('hand-build-20260818-0842', rel(), A),                       // current
            update.updateVerdict('hand-build-20260817-2253', rel(), A),                       // available
            update.updateVerdict('hand-build-20260817-2253', rel({ assets: [{ name: A, browser_download_url: 'https://x/y.dmg', size: 1, digest: '' }] }), A), // manual
            update.updateVerdict('hand-v1.0.0', null, A),                                     // unknown
        ].forEach(function (v) { seen[v.state] = (v.say || '').length > 0; });
        return ['current', 'available', 'manual', 'unknown'].every(function (s) { return seen[s] === true; });
    })());

    // The IO half's refusals, driven with a fake fetch — no network.
    console.log('\n16) the updater refuses what it cannot trust');
    const feedOf = (body, okStatus) => async function () {
        return { ok: okStatus !== false, status: okStatus === false ? 500 : 200, json: async () => body };
    };
    const u1 = updater.makeUpdater({ fetch: feedOf(rel()), currentVersion: 'hand-build-20260817-2253' });
    const c1 = await u1.check();
    ok('a good feed yields available', c1.ok && c1.state === 'available', JSON.stringify(c1.state));
    const u2 = updater.makeUpdater({ fetch: feedOf(null, false), currentVersion: 'hand-v1.0.0' });
    const c2 = await u2.check();
    ok('a failing feed is unknown, never "up to date"', c2.state === 'unknown' && !/up to date/i.test(c2.say), c2.say);
    const u3 = updater.makeUpdater({ fetch: feedOf(rel()), currentVersion: 'x', feedUrl: 'http://insecure.test/f' });
    ok('a non-https feed is refused', (await u3.check()).state === 'unknown');
    const u4 = updater.makeUpdater({
        fetch: feedOf(rel({ assets: [{ name: A, browser_download_url: 'http://plain.test/a.dmg', size: 1, digest: 'sha256:' + 'a'.repeat(64) }] })),
        currentVersion: 'hand-build-20260817-2253',
    });
    ok('a non-https download address is refused', (await u4.check()).state === 'unknown');
    // download() must not be reachable for a verdict that never earned it.
    const d1 = await u1.download({ state: 'manual', url: 'https://x/y.dmg', sha256: '' });
    ok('download refuses a verdict with no checksum', !d1.ok && /checksum/i.test(d1.say));
    const d2 = await u1.download({ state: 'available', url: 'http://x/y.dmg', sha256: 'a'.repeat(64) });
    ok('download refuses a non-https file', !d2.ok);

    // THE POSITIVE CASE, and the one that matters most: a good file verifies
    // and lands; a tampered one is refused AND DELETED, because a bad download
    // left on disk is a bad download someone can open.
    const crypto = require('crypto');
    const payload = Buffer.from('a pretend disk image');
    const goodSum = crypto.createHash('sha256').update(payload).digest('hex');
    const bodyOf = (buf) => ({
        ok: true, status: 200,
        headers: { get: () => String(buf.length) },
        body: (async function* () { yield buf; })(),
    });
    const upTmp = fs.mkdtempSync(path.join(os.tmpdir(), "chb-upd-"));
    const uD = updater.makeUpdater({ fetch: async () => bodyOf(payload), currentVersion: 'x', tmpDir: upTmp });
    let sawProgress = false;
    const okDl = await uD.download({ state: 'available', url: 'https://x/y.dmg', sha256: goodSum, size: payload.length },
        function () { sawProgress = true; });
    ok('a matching file is accepted', okDl.ok && fs.existsSync(okDl.file), JSON.stringify(okDl.say || ''));
    ok('...and progress was reported while it downloaded', sawProgress);
    ok('...and nothing is left as a .part', !fs.existsSync(okDl.file + '.part'));

    const uB = updater.makeUpdater({ fetch: async () => bodyOf(Buffer.from('tampered')), currentVersion: 'x', tmpDir: upTmp });
    const badDl = await uB.download({ state: 'available', url: 'https://x/y.dmg', sha256: goodSum, size: 8 });
    ok('a file that fails its checksum is refused', !badDl.ok && /checksum/i.test(badDl.say), badDl.say);
    ok('...and is DELETED, not left where it could be opened',
        !fs.existsSync(path.join(upTmp, "Cottage-Holidays-Blakeney.dmg.part")));
    try { fs.rmSync(upTmp, { recursive: true, force: true }); } catch (e) {}


    // ── WHAT THE BUG PASS FOUND ───────────────────────────────────────────
    console.log('\n17) the defects found in the review, each with its own check');

    // A GREETING IS REFUSED EVEN WHEN THE NAME IS UNKNOWN. It was gated on
    // f.first, so an enquiry with no first name switched the check off — while
    // the site's template greets regardless.
    const greet = 'Hello there, thank you for asking about the cottage. It sleeps four and the beach is a short walk away, so it suits a family well.';
    ok('a greeting is refused with a name known',
        guard.checkDraft(greet, { first: 'Sam', dates_free: null }).problems.some((s) => /greeting/.test(s)));
    ok('...and with NO name known, which is where it used to stop looking',
        guard.checkDraft(greet, { dates_free: null }).problems.some((s) => /greeting/.test(s)));
    ok('...while a draft that does not greet is fine',
        !guard.checkDraft('Thank you for asking about the cottage. It sleeps four and the beach is a short walk away, so it suits a family well.', {}).problems.some((s) => /greeting/.test(s)));

    // A REF MUST IDENTIFY ITS ROW. Every unparseable id used to become 0, so
    // the site's exactly-once rule silently dropped all but the first.
    ok('two rows with unparseable ids get DIFFERENT refs',
        site.makeRef('reply', 'a1', '2026-08-18') !== site.makeRef('reply', 'b2', '2026-08-18'));
    ok('...a numeric id is unchanged',
        site.makeRef('reply', 42, '2026-08-18') === 'mac-2026-08-18-reply-42');
    ok('...and a missing id is still a usable ref',
        /^mac-2026-08-18-reply-.+$/.test(site.makeRef('reply', null, '2026-08-18')));
    ok('the same row on the same night is the same ref, which is the whole point',
        site.makeRef('reply', 42, '2026-08-18') === site.makeRef('reply', 42, '2026-08-18'));

    // MONEY IN EVERY FORM IT CAN BE WRITTEN. The guard saw only "£", so a
    // figure written "GBP 892.50" or "892.50 pounds" was never checked.
    const mBody = ' Thank you for asking about the cottage, it sleeps four and suits a family well indeed. ';
    const mFacts = { quote: '440.00', dates_free: null };
    const invented = (s) => guard.checkDraft(mBody + s, mFacts).problems.some((x) => /figure the site did not give/.test(x));
    ok('an invented £ figure is caught', invented('The total is £892.50.'));
    ok('...and a GBP one', invented('The total is GBP 892.50.'));
    ok('...and a "pounds" one', invented('The total is 892.50 pounds.'));
    ok('...and a "quid" one', invented('That would be 900 quid.'));
    ok("the site's OWN figure passes, however it is written",
        !invented('The total is £440.00.') && !invented('That is 440 pounds.') && !invented('The total is £440.'));
    // A BARE DECIMAL IS NOT MONEY, on purpose: refusing these would drop good
    // drafts far more often than it would catch an invented figure.
    ok('a time is not read as money',
        !invented('Check-in is from 3.00 in the afternoon.') && !invented('We are usually there by 10.30am.'));

    // NO HTML ENTITIES IN STRINGS THE WINDOW ESCAPES. The log renders through
    // esc(), so "&rsquo;" arrived on screen as those eight characters.
    ok('no core module puts an HTML entity in a sentence', (function () {
        const bad = [];
        ['site', 'guard', 'jobs', 'night', 'engine', 'models', 'config', 'api', 'update', 'updater'].forEach(function (f) {
            const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', f + '.js'), 'utf8');
            src.split('\n').forEach(function (line, i) {
                if (/^\s*(\/\/|\*)/.test(line)) { return; }          // comments may say &rsquo;
                if (/&(?:rsquo|lsquo|mdash|ndash|hellip|amp|quot|nbsp);/.test(line)) { bad.push(f + ':' + (i + 1)); }
            });
        });
        return bad.length === 0 || (console.log('      ' + bad.join(', ')), false);
    })());

    // ── THE KEY'S ADDRESS ─────────────────────────────────────────────────
    console.log('\n18) the key only travels somewhere safe');
    ok('https is fine', site.urlProblem('https://example.test/nightshift.php') === '');
    ok('http is REFUSED — the key travels with every request',
        /https/.test(site.urlProblem('http://example.test/nightshift.php')));
    ok('...and the refusal says why', /clear/.test(site.urlProblem('http://example.test/x.php')));
    ok('http to localhost is allowed, for a staging copy on this machine',
        site.urlProblem('http://localhost:8080/nightshift.php') === ''
        && site.urlProblem('http://127.0.0.1:8080/nightshift.php') === '');
    ok('nonsense is refused', site.urlProblem('not a url') !== '');
    ok('empty is refused', site.urlProblem('') !== '');

    // REFUSED AT USE, not only at save — a settings file can be hand-edited,
    // and older builds wrote whatever was typed.
    const httpSite = site.makeSite({ url: 'http://plain.test/nightshift.php', secret: 'k', post: async () => { throw new Error('should never be called'); } });
    const hb = await httpSite.brief();
    ok('brief refuses an http address without making the request', !hb.ok && /https/.test(hb.refusal.say));
    const hi = await httpSite.ingest([{ ref: 'r', kind: 'note', title: 't', body: 'b' }]);
    ok('...and so does ingest', !hi.ok && /https/.test(hi.refusal.say));

    // And the settings write refuses it up front.
    const apiTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chb-url-'));
    const a2 = require('../src/core/api').makeApi({ dir: apiTmp });
    const savedBad = await a2.saveConfig({ siteUrl: 'http://plain.test/nightshift.php' });
    ok('saving an http address is refused at the keyboard', savedBad && savedBad.ok === false);
    const savedOk = await a2.saveConfig({ siteUrl: 'https://plain.test/nightshift.php' });
    ok('...and an https one is accepted', savedOk && savedOk.ok !== false);
    try { fs.rmSync(apiTmp, { recursive: true, force: true }); } catch (e) {}

    // ── §18a IT ALREADY KNOWS THE ADDRESS ─────────────────────────────────
    // Asked for: "I shouldn't need to enter the web address, it should already
    // know". This app carries one business's crown and can only ever talk to one
    // site, so pasting that address into a fresh install was supplying a fact
    // the app already had.
    console.log('\n18a) the app ships knowing where its site is');
    ok('a fresh install already has an address', config.siteUrl({}) !== '');
    ok('...and it is the business\'s own', /cottageholidaysblakeney\.co\.uk/.test(config.siteUrl({})));
    ok('...over https, so the app\'s own refusal would not reject it',
        site.urlProblem(config.siteUrl({})) === '', site.urlProblem(config.siteUrl({})));
    ok('...and it ends at the endpoint the site actually serves',
        /\/nightshift\.php$/.test(config.siteUrl({})));
    ok('an empty setting MEANS the standard one, the engine/modelsDir convention',
        config.siteUrl({ siteUrl: '' }) === config.DEFAULT_SITE_URL
        && config.siteUrl({ siteUrl: '   ' }) === config.DEFAULT_SITE_URL);
    ok('...and reports itself as the standard one', config.siteIsDefault({ siteUrl: '' }));
    ok('an override wins, and says it is not the standard',
        config.siteUrl({ siteUrl: 'https://staging.test/nightshift.php' }) === 'https://staging.test/nightshift.php'
        && !config.siteIsDefault({ siteUrl: 'https://staging.test/nightshift.php' }));

    const dTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chb-dflt-'));
    let dPosts = [];
    const dSite = function (o) {
        return {
            url: o.url,
            connect: async function () { dPosts.push(o.url); return { ok: true, key: 'K'.repeat(40), host: 'George' }; },
            test: async function () { dPosts.push(o.url); return { ok: true, state: 'on', say: 'on' }; },
        };
    };
    const a7 = require('../src/core/api').makeApi({
        dir: dTmp, machine: M16, makeSite: dSite,
        secrets: { available: true, get: function () { return 'k'; }, set: function () { return { ok: true }; }, state: function () { return { set: true, hint: '••' }; } },
    });
    const st7 = await a7.state();
    ok('the window is handed a RESOLVED address on a fresh install',
        /cottageholidaysblakeney/.test(st7.siteUrl) && st7.siteIsDefault === true, st7.siteUrl);
    ok('...and the raw setting too, so Change… shows what was overridden and not the default',
        st7.siteRaw === '');
    // THE POINT: connect works with nothing typed in. It used to refuse with
    // "Put the site address in first."
    dPosts = [];
    const c7 = await a7.connect('ABCD-2345');
    ok('connecting needs only the code — no address typed anywhere',
        c7 && c7.ok === true, JSON.stringify(c7));
    ok('...and it went to the standard address', /cottageholidaysblakeney/.test(dPosts[0] || ''), dPosts[0]);
    dPosts = [];
    await a7.testSite();
    ok('Test now reaches it too', /cottageholidaysblakeney/.test(dPosts[0] || ''), dPosts[0]);
    ok('and the queue\'s home page is derivable, which needed an address before',
        /^https:\/\/cottageholidaysblakeney\.co\.uk\//.test(a7.siteHomeUrl()), a7.siteHomeUrl());

    // A STAGING COPY STILL OVERRIDES, AND CAN GO BACK. An empty save is the
    // way out — the affordance behind the window's Change… box.
    await a7.saveConfig({ siteUrl: 'https://staging.test/nightshift.php' });
    dPosts = [];
    await a7.testSite();
    ok('an override is used instead', dPosts[0] === 'https://staging.test/nightshift.php', dPosts[0]);
    const st7b = await a7.state();
    ok('...and the window is told it is not the standard one',
        st7b.siteIsDefault === false && st7b.siteRaw === 'https://staging.test/nightshift.php');
    await a7.saveConfig({ siteUrl: '' });
    dPosts = [];
    await a7.testSite();
    ok('clearing it goes back to the standard address rather than to nothing',
        /cottageholidaysblakeney/.test(dPosts[0] || ''), dPosts[0]);
    try { fs.rmSync(dTmp, { recursive: true, force: true }); } catch (e) {}

    // ── §18b WHICH MAC THIS IS ────────────────────────────────────────────
    // Reported live: two paired Macs both read "A Mac" on the website, so the
    // list could not tell the owner which one to stop — which is the only thing
    // a per-device list is for.
    console.log('\n18b) the Mac tells the site what it is called');
    ok('the owner\'s own computer name wins',
        machine.deviceLabel({ name: "George's Mac mini", model: 'Macmini9,1' }) === "George's Mac mini");
    ok('a hostname loses its .local suffix',
        machine.deviceLabel({ name: 'georges-mac-mini.local' }) === 'georges mac mini',
        machine.deviceLabel({ name: 'georges-mac-mini.local' }));
    ok('...and a hyphenated hostname reads as words rather than a filename',
        machine.deviceLabel({ name: 'Georges-MacBook-Pro' }) === 'Georges MacBook Pro',
        machine.deviceLabel({ name: 'Georges-MacBook-Pro' }));
    ok('a real name with a hyphen in it is NOT mangled',
        machine.deviceLabel({ name: 'Mac mini M2-2023' }) === 'Mac mini M2-2023',
        machine.deviceLabel({ name: 'Mac mini M2-2023' }));
    ok('with no name at all it falls back to the model',
        machine.deviceLabel({ name: '', model: 'Macmini9,1' }) === 'Macmini9,1');
    ok('...and with neither, to the architecture — never to "A Mac" twice over',
        machine.deviceLabel({ appleSilicon: true }) === 'Apple silicon Mac'
        && machine.deviceLabel({ arch: 'x64' }) === 'Intel Mac');
    ok('a hostile name is capped', machine.deviceLabel({ name: 'x'.repeat(500) }).length === machine.DEVICE_LABEL_MAX);
    ok('nothing at all still answers something', machine.deviceLabel(null) === 'A Mac');
    ok('the real machine reports a name', typeof machine.readMachine().name === 'string');

    // THE WIRING, not just the helper: connect must actually SEND it. Testing
    // deviceLabel alone would pass with the call site reverted — the trap this
    // codebase keeps catching.
    let connectBody = null;
    const labelSite = site.makeSite({
        url: 'https://x.test/nightshift.php',
        secret: 'k',
        post: async function (u, body) {
            connectBody = body;
            return { ok: true, status: 200, json: { ok: true, key: 'K'.repeat(40), host: 'George' } };
        },
    });
    await labelSite.connect('ABCD-2345', "George's Mac mini");
    ok('connect posts the label alongside the code',
        connectBody && connectBody.action === 'connect'
        && connectBody.code === 'ABCD-2345'
        && connectBody.label === "George's Mac mini", JSON.stringify(connectBody));
    const labelTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chb-lbl-'));
    connectBody = null;
    const a6 = require('../src/core/api').makeApi({
        dir: labelTmp,
        machine: Object.assign({}, M16, { name: 'Studio in the loft' }),
        makeSite: function () { return labelSite; },
        secrets: { available: true, get: function () { return 'k'; }, set: function () { return { ok: true }; }, state: function () { return { set: true, hint: '••' }; } },
    });
    await a6.saveConfig({ siteUrl: 'https://x.test/nightshift.php' });
    await a6.connect('ABCD-2345');
    ok('...and the api fills it in from THIS Mac, so the window never has to',
        connectBody && connectBody.label === 'Studio in the loft', JSON.stringify(connectBody));
    try { fs.rmSync(labelTmp, { recursive: true, force: true }); } catch (e) {}

    // ── §19 STARTING THE MODEL SERVER ─────────────────────────────────────
    // The decisions only. The spawn is main.js's and is untestable here by
    // design; everything that decides WHAT it spawns is in this section.
    console.log('\n19) the app starts the model server, so nobody opens a Terminal');

    ok('only llama.cpp is startable', runner.canStart('llamacpp')
        && !runner.canStart('ollama') && !runner.canStart('mlx') && !runner.canStart(''));

    // WHERE IT LOOKS, AND IN WHAT ORDER.
    const candPlain = runner.runnerCandidates({});
    ok('with nothing bundled it looks in both Homebrew prefixes',
        candPlain.length === 2
        && candPlain[0].path === '/opt/homebrew/bin/llama-server'
        && candPlain[1].path === '/usr/local/bin/llama-server',
        JSON.stringify(candPlain));
    const candBundled = runner.runnerCandidates({ resourcesDir: '/App/Contents/Resources' });
    ok('a bundled copy is looked at AFTER Homebrew — see the order note in runner.js',
        candBundled[candBundled.length - 1].kind === 'bundled'
        && candBundled[candBundled.length - 1].path === '/App/Contents/Resources/runner/llama-server'
        && candBundled[0].kind === 'homebrew',
        JSON.stringify(candBundled));
    const candCustom = runner.runnerCandidates({ custom: '/my/llama-server', resourcesDir: '/App/Contents/Resources' });
    ok('...and an explicit path beats everything — it is the one the owner chose',
        candCustom[0].kind === 'custom' && candCustom[0].path === '/my/llama-server');

    // RESOLUTION. `exists` injected, so this runs on a machine with no
    // llama.cpp anywhere — which is every machine this suite runs on.
    const noneHere = runner.resolveRunner({ exists: function () { return false; } });
    ok('nothing installed is reported as such', !noneHere.ok);
    ok('...and the refusal NAMES THE FIX rather than just failing',
        /brew install llama\.cpp/.test(noneHere.install || ''), JSON.stringify(noneHere));
    const onlyIntel = runner.resolveRunner({ exists: function (p) { return p === '/usr/local/bin/llama-server'; } });
    ok('an Intel-prefix Homebrew copy is found', onlyIntel.ok
        && onlyIntel.kind === 'homebrew' && onlyIntel.path === '/usr/local/bin/llama-server');
    const both = runner.resolveRunner({
        resourcesDir: '/App/Contents/Resources',
        exists: function () { return true; },
    });
    ok('with both present the HOMEBREW one wins — the owner installed it and macOS never quarantines it',
        both.kind === 'homebrew');
    const bundledOnly = runner.resolveRunner({
        resourcesDir: '/App/Contents/Resources',
        exists: function (p) { return p.indexOf('/App/') === 0; },
    });
    ok('...and a Mac with nothing installed still finds the bundled copy — the zero-install path',
        bundledOnly.ok && bundledOnly.kind === 'bundled');
    const customGone = runner.resolveRunner({ custom: '/gone/llama-server', exists: function () { return false; } });
    ok('a custom path that is not there says so by name',
        /\/gone\/llama-server/.test(customGone.say || ''), customGone.say);

    // THE ARGUMENTS. An array, never a string, and derived from the engine's
    // own base so the address it serves on cannot drift from the one the app
    // then goes looking at.
    const argsAS = runner.runnerArgs({ modelPath: '/M/q.gguf', base: 'http://127.0.0.1:8080', appleSilicon: true });
    ok('the arguments are an ARRAY, never a command line', Array.isArray(argsAS));
    ok('the model, host and port all come through',
        argsAS.indexOf('-m') !== -1 && argsAS[argsAS.indexOf('-m') + 1] === '/M/q.gguf'
        && argsAS[argsAS.indexOf('--port') + 1] === '8080'
        && argsAS[argsAS.indexOf('--host') + 1] === '127.0.0.1', JSON.stringify(argsAS));
    ok('the port follows the ENGINE\'s base rather than being typed twice',
        runner.runnerArgs({ modelPath: '/M/q.gguf', base: 'http://127.0.0.1:11434' })[argsAS.indexOf('--port') + 1] === '11434');
    ok('Apple silicon offloads to Metal (-ngl), or a 14B crawls', argsAS.indexOf('-ngl') !== -1);
    const argsIntel = runner.runnerArgs({ modelPath: '/M/q.gguf', base: 'http://127.0.0.1:8080', appleSilicon: false });
    ok('...and an Intel Mac is not given a flag it has no device for', argsIntel.indexOf('-ngl') === -1);
    // VISION: the paired projector rides as --mmproj; without one the launch
    // is byte-for-byte the text-only launch it always was.
    const argsVis = runner.runnerArgs({ modelPath: '/M/g.gguf', base: 'http://127.0.0.1:8080', mmproj: '/M/mmproj-g.gguf' });
    ok('a paired projector launches with --mmproj', argsVis[argsVis.indexOf('--mmproj') + 1] === '/M/mmproj-g.gguf');
    ok('…and no projector means no flag at all', argsIntel.indexOf('--mmproj') === -1);

    // THE SAFETY LINE. The model path comes from settings the window can
    // write, so it is checked rather than trusted.
    ok('a model inside the Models folder is allowed',
        runner.modelPathAllowed('/Users/g/Models/q.gguf', '/Users/g/Models'));
    ok('one outside it is REFUSED', !runner.modelPathAllowed('/etc/passwd.gguf', '/Users/g/Models'));
    ok('...and so is a climb out of it with ..',
        !runner.modelPathAllowed('/Users/g/Models/../../evil.gguf', '/Users/g/Models'));
    ok('...and a sibling folder that merely starts with the same letters',
        !runner.modelPathAllowed('/Users/g/Models-old/q.gguf', '/Users/g/Models'));
    ok('a non-gguf is refused whatever its folder',
        !runner.modelPathAllowed('/Users/g/Models/thing.sh', '/Users/g/Models'));

    // ONE DECISION about whether a start is possible, so the button and the
    // night cannot disagree.
    const foundOk = { ok: true, path: '/opt/homebrew/bin/llama-server', kind: 'homebrew' };
    ok('everything present means no problem', runner.startProblem({
        engineId: 'llamacpp', modelPath: '/M/q.gguf', modelsDir: '/M', runner: foundOk,
    }) === '');
    ok('Ollama is refused in words, not silently',
        /own service/.test(runner.startProblem({ engineId: 'ollama', engineName: 'Ollama', modelPath: '/M/q.gguf', modelsDir: '/M', runner: foundOk })));
    ok('no model chosen is its own sentence',
        /No model/.test(runner.startProblem({ engineId: 'llamacpp', modelPath: '', modelsDir: '/M', runner: foundOk })));
    ok('a model outside the folder is refused HERE too, not only at spawn',
        /Models folder/.test(runner.startProblem({ engineId: 'llamacpp', modelPath: '/etc/x.gguf', modelsDir: '/M', runner: foundOk })));
    ok('a missing binary reports the resolver\'s own sentence',
        /not installed/.test(runner.startProblem({ engineId: 'llamacpp', modelPath: '/M/q.gguf', modelsDir: '/M', runner: noneHere })));

    // AN EXIT, IN WORDS. The stderr tail is the only thing that tells a broken
    // model file from a busy port, and both are things the owner can act on.
    ok('a busy port is named as one', /already using that port/.test(runner.failSay(1, 'error: bind: Address already in use')));
    ok('a broken model file is named as one', /could not be loaded/.test(runner.failSay(1, 'error loading model: bad magic')));
    ok('running out of memory says to pick a smaller model',
        /smaller one/.test(runner.failSay(1, 'ggml_metal_graph_compute: out of memory')));
    ok('a vanished binary says how to reinstall it', /brew install/.test(runner.failSay('ENOENT', '')));
    ok('an unrecognised exit still quotes the last line rather than shrugging',
        /something specific/.test(runner.failSay(9, 'noise\nmore noise\nsomething specific')));
    ok('a timeout names the address it waited on', /127\.0\.0\.1:8080/.test(runner.timeoutSay('http://127.0.0.1:8080')));

    // ── THE API SURFACE, with a FAKE runner ───────────────────────────────
    // This is the half that proves the wiring: startProblem alone passing is
    // the helper-tested-alone trap, so the checks below drive api.startEngine
    // and read what the fake was actually asked to spawn.
    const rTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chb-run-'));
    fs.mkdirSync(path.join(rTmp, 'Models'), { recursive: true });
    fs.writeFileSync(path.join(rTmp, 'Models', 'q.gguf'), 'x');
    // A stand-in for the BUNDLED binary, in the layout a packaged app has. The
    // real resolveRunner runs against it — including its executable-bit check —
    // so this exercises the shipped path rather than stubbing past it.
    const rRes = path.join(rTmp, 'Resources');
    fs.mkdirSync(path.join(rRes, 'runner'), { recursive: true });
    fs.writeFileSync(path.join(rRes, 'runner', 'llama-server'), '#!/bin/sh\n');
    fs.chmodSync(path.join(rRes, 'runner', 'llama-server'), 0o755);
    let runSpawned = null;
    let runStopped = 0;
    let runAlive = false;
    const runFakeRunner = {
        status: function () { return { running: runAlive }; },
        start: async function (o) { runSpawned = o; runAlive = true; return { ok: true, ms: 4200 }; },
        stop: async function () { runStopped++; runAlive = false; return { ok: true }; },
    };
    let runEngineUp = false;
    const runFakeEngine = function (o) {
        return {
            id: o.id, name: 'llama.cpp', base: 'http://127.0.0.1:8080',
            reachable: async function () { return runEngineUp; },
            write: async function () { return { ok: true, text: 'x', ms: 1, tokens: 1 }; },
        };
    };
    const a3 = require('../src/core/api').makeApi({
        dir: rTmp, machine: M16, runner: runFakeRunner, makeEngine: runFakeEngine, resourcesDir: rRes,
        secrets: { available: true, get: function () { return 'k'; }, set: function () { return { ok: true }; }, state: function () { return { set: true, hint: '••' }; } },
    });
    await a3.saveConfig({ engine: 'llamacpp', job: { id: 'reply', on: true, model: 'q.gguf' } });

    const st1 = await a3.state();
    ok('the window is told it can start this engine', st1.runner && st1.runner.canStart && st1.runner.available);
    ok('...and that nothing is running yet', st1.runner.running === false);

    const started = await a3.startEngine();
    ok('startEngine reports success', started && started.ok, JSON.stringify(started));
    ok('...and it spawned the resolved binary, not something the window named',
        runSpawned && /llama-server$/.test(runSpawned.bin), runSpawned && runSpawned.bin);
    ok('...with the chosen model, from the app\'s own Models folder',
        runSpawned && runSpawned.args.indexOf(path.join(rTmp, 'Models', 'q.gguf')) !== -1,
        runSpawned && JSON.stringify(runSpawned.args));
    ok('...and the ready time reaches the owner in words', /4 seconds/.test(started.say || ''), started.say);

    runEngineUp = true;
    const again = await a3.startEngine();
    ok('starting one that is already answering does not spawn a second',
        again.ok && again.started === false);

    // A NIGHT THAT FINDS NOTHING ANSWERING STARTS IT — the behaviour this
    // whole change exists for, driven through the real night orchestrator.
    runEngineUp = false;
    runSpawned = null;
    runStopped = 0;
    let runIngested = null;
    const runFakeSite = function () {
        return {
            brief: async function () { return { ok: true, host: 'George', enquiries: [] }; },
            ingest: async function (items) { runIngested = items; return { ok: true, stored: items.length, skipped: [] }; },
        };
    };
    const a4 = require('../src/core/api').makeApi({
        dir: rTmp, machine: M16, runner: runFakeRunner, makeEngine: runFakeEngine, makeSite: runFakeSite, resourcesDir: rRes,
        secrets: { available: true, get: function () { return 'k'; }, set: function () { return { ok: true }; }, state: function () { return { set: true, hint: '••' }; } },
    });
    // The fake reports ready by flipping the engine up when start() is called.
    runFakeRunner.start = async function (o) { runSpawned = o; runAlive = true; runEngineUp = true; return { ok: true, ms: 3000 }; };
    const ranUp = await a4.runNow();
    const lines = (ranUp.night && ranUp.night.log || []).map(function (l) { return l.say; }).join(' | ');
    ok('a night with a dead engine STARTS it rather than giving up',
        runSpawned !== null, lines);
    ok('...and the log says it did', /starting it/.test(lines), lines);
    ok('...and stops again what it started, rather than leaving 9GB held',
        runStopped === 1 && /stopped the model server/.test(lines), lines);

    // AND IT NEVER STOPS ONE IT DID NOT START.
    runEngineUp = true;
    runSpawned = null;
    runStopped = 0;
    const ranAlready = await a4.runNow();
    const lines2 = (ranAlready.night && ranAlready.night.log || []).map(function (l) { return l.say; }).join(' | ');
    ok('an engine the owner was already running is not spawned again', runSpawned === null, lines2);
    ok('...and is NOT killed at the end of the run', runStopped === 0, lines2);

    // OFF IS OFF. With auto-start switched off the night behaves exactly as it
    // did before this feature existed.
    await a4.saveConfig({ autoStart: false });
    runEngineUp = false;
    runSpawned = null;
    const ranOff = await a4.runNow();
    const lines3 = (ranOff.night && ranOff.night.log || []).map(function (l) { return l.say; }).join(' | ');
    ok('with auto-start off nothing is spawned', runSpawned === null, lines3);
    ok('...and the night gives the old honest refusal', /not answering/.test(lines3), lines3);
    await a4.saveConfig({ autoStart: true });

    // NO RUNNER AT ALL — a bare api, which is how every other suite builds it.
    const a5 = require('../src/core/api').makeApi({ dir: rTmp, machine: M16, makeEngine: runFakeEngine });
    const st5 = await a5.state();
    ok('an api with no way to spawn says so rather than offering a dead button',
        st5.runner && st5.runner.available === false);
    const cant = await a5.startEngine();
    ok('...and starting is refused in words', !cant.ok && !!cant.say);
    try { fs.rmSync(rTmp, { recursive: true, force: true }); } catch (e) {}

    // ── §20 THE DOCK ICON ─────────────────────────────────────────────────
    // macOS does NOT mask an app icon — the app supplies its own silhouette —
    // so a file with no alpha channel can only ever be a hard-cornered square
    // in the Dock, whatever it looks like on its own. This one is cheap and
    // decisive; the SHAPE is measured on the rendered pixels in ui-test.js.
    console.log('\n20) the Dock icon is a Mac icon, not a web one');
    const iconFile = path.join(__dirname, '..', 'build', 'icon.png');
    ok('the icon electron-builder is pointed at exists', fs.existsSync(iconFile));
    const png = fs.readFileSync(iconFile);
    ok('...and is a PNG', png.slice(1, 4).toString() === 'PNG');
    const iw = png.readUInt32BE(16);
    const ih = png.readUInt32BE(20);
    ok('1024×1024 — the largest slice an .icns carries', iw === 1024 && ih === 1024, iw + 'x' + ih);
    // Colour type 6 is RGBA, 4 is grey+alpha. 2 (plain RGB) is what the copied
    // web icon was, and is the whole bug: no alpha, so no rounded corner.
    ok('with an ALPHA CHANNEL, without which no corner can be rounded',
        png[25] === 6 || png[25] === 4, 'colour type ' + png[25]);
    ok('and it is not the website\'s icon copied over again',
        !fs.existsSync(path.join(__dirname, '..', '..', 'Cottage Holidays Blakeney', 'icon-512.png'))
        || fs.readFileSync(path.join(__dirname, '..', '..', 'Cottage Holidays Blakeney', 'icon-512.png')).length !== png.length
        || !fs.readFileSync(path.join(__dirname, '..', '..', 'Cottage Holidays Blakeney', 'icon-512.png')).equals(png));

    // ── §21 CHECK FOR UPDATES… IN THE APP MENU ────────────────────────────
    // The menu itself lives in main.js, which no suite can run — so this
    // asserts the WIRING by source. Weaker than driving it, and said so: what
    // it can prove is that the item exists, sits where a Mac app puts it, and
    // is joined up end to end rather than pointing at nothing.
    console.log('\n21) Check for Updates… is in the app menu');
    const mainRaw = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
    // COMMENTS STRIPPED FIRST. Both the ordering check and the negative one
    // failed against the COMMENT above the menu, which says "not
    // `{ role: 'appMenu' }`" and names Check for Updates… four lines before
    // the code does — a scan reading its own explanation, which is the trap
    // CLAUDE.md records test-payrail hitting twice.
    const mainSrc = mainRaw.split('\n').filter(function (l) { return !/^\s*\/\//.test(l); }).join('\n');
    const preSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'preload.js'), 'utf8');
    const uiSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'ui', 'app.js'), 'utf8');
    ok('the item is there', /Check for Updates/.test(mainSrc));
    // Apple's order: it goes directly under About, and role:'appMenu' cannot
    // be inserted into — so the standard menu has to be written out, and the
    // items it replaced must all still be present.
    ok("...directly under About, where a Mac app puts it",
        mainSrc.indexOf("role: 'about'") !== -1
        && mainSrc.indexOf("role: 'about'") < mainSrc.indexOf('Check for Updates'));
    ok('...and writing the menu out kept everything the role gave',
        ["role: 'services'", "role: 'hide'", "role: 'hideOthers'", "role: 'unhide'", "role: 'quit'"]
            .every(function (r) { return mainSrc.indexOf(r) !== -1; }));
    ok('...and no longer leans on the role it replaced', !/role: 'appMenu'/.test(mainSrc));
    // JOINED UP: menu → main → preload → window. A missing link anywhere makes
    // the item do nothing, silently, which is the failure mode a source scan
    // is actually good at catching.
    ok('the click reaches the window', /hand:openUpdates/.test(mainSrc)
        && /hand:openUpdates/.test(preSrc) && /onOpenUpdates/.test(preSrc)
        && /onOpenUpdates/.test(uiSrc));
    // CLOSING THE WINDOW DOES NOT QUIT THIS APP, so the menu is reachable with
    // no window — and an item that quietly did nothing there would be the
    // commonest way anyone ever met it.
    ok('...and makes a window when there is not one', /function openUpdates\(\)[\s\S]{0,400}create\(\)/.test(mainSrc));
    ok('...waiting for it to load before speaking to it', /did-finish-load/.test(mainSrc));

    // ── §22 THE BUNDLED RUNNER AND THE UNIVERSAL MERGE ────────────────────
    // These are ONE decision and they came apart: extraResources put a lipo'd
    // llama-server into both per-arch bundles, and @electron/universal refuses
    // an identical Mach-O in both unless x64ArchFiles names it — so the .dmg
    // died at packaging with the runner already built and verified.
    //
    // A duplicate "mac" key while fixing it would have silently dropped the
    // setting (later key wins), so the shape is asserted too.
    console.log('\n22) the bundled runner is packaged, not merged again');
    const pkgRaw = fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8');
    const pkg = JSON.parse(pkgRaw);
    const extra = (pkg.build && pkg.build.extraResources) || [];
    const bundles = extra.some(function (e) { return e && e.to === 'runner'; });
    ok('the runner is bundled as a resource', bundles, JSON.stringify(extra));
    const x64 = pkg.build && pkg.build.mac && pkg.build.mac.x64ArchFiles;
    ok('...and the universal merge is told about it, or packaging dies',
        !bundles || (typeof x64 === 'string' && /runner/.test(x64)), String(x64));
    ok('...naming the file it actually ships', !bundles || /llama-server/.test(String(x64)), String(x64));
    // The value only takes effect if it is in the mac block that survives.
    ok('there is exactly one "mac" block for it to live in',
        (pkgRaw.match(/"mac":\s*\{/g) || []).length === 1);
    // AND NO COMMENT KEYS. package.json has no comment syntax, and
    // electron-builder validates `build` against a schema that REJECTS unknown
    // properties — so a "_comment_x64ArchFiles" explaining the line above it
    // failed a whole build with "configuration.mac has an unknown property".
    // Explanations go in build/README.md, which can hold one.
    const commentKeys = [];
    (function walk(o, at) {
        if (!o || typeof o !== 'object' || Array.isArray(o)) { return; }
        Object.keys(o).forEach(function (k) {
            if (/^_|comment/i.test(k)) { commentKeys.push(at + '.' + k); }
            walk(o[k], at + '.' + k);
        });
    }(pkg.build, 'build'));
    ok('no comment keys anywhere under build — the schema rejects them',
        commentKeys.length === 0, commentKeys.join(', '));

    // ── §23 THE OTHER JOBS — the week, the prices, the answers ────────────
    // The same discipline as the reply job: every figure comes from the site,
    // the guard whitelists exactly what was handed over, and an older site
    // that hands nothing over is reported honestly rather than read as a
    // quiet week.
    console.log('\n23) the week, the prices and the answers');

    // The general check first — it is what all three lean on.
    ok('a clean note passes', guard.checkGeneral(
        'Rachel arrives at Jollyboat on Friday with £340.00 still to collect. A quiet week otherwise.',
        { money: ['£340.00'] }).ok);
    ok('an invented figure is refused', !guard.checkGeneral(
        'Offer the gap at £99.00 and it will sell.', { money: ['£340.00'] }).ok);
    ok('...and the refusal names the figure', /99\.00/.test(
        guard.checkGeneral('Offer it at £99.00.', { money: [] }).problems.join(' ')));
    ok('a link is refused', !guard.checkGeneral('See https://x.test for more. '.repeat(3), { money: [] }).ok);
    ok('a greeting is refused', !guard.checkGeneral('Hi George, the week looks quiet enough overall for you.', { money: [] }).ok);
    ok('a done-claim is refused', !guard.checkGeneral(
        'I have now booked the gap for you and all is well with the week ahead.', { money: [] }).ok);
    ok('availability words are NOT refused here — a note restates the site\'s own gap list',
        guard.checkGeneral('Jollyboat is free for three nights midweek, worth an offer perhaps.', { money: [] }).ok);
    ok('moneyInFacts walks the whole payload', JSON.stringify(guard.moneyInFacts(
        { a: [{ due: '£12.00' }], b: { c: 'rate £9.50 a night' } })) === JSON.stringify(['12.00', '9.50']));

    // THE SCHEDULE, on pinned dates — never the wall clock (the search-test
    // lesson: a date-dependent test is only verified on the day it runs).
    const MON = new Date(2026, 7, 17, 2, 0, 0);   // Monday 17 Aug 2026
    const SUN = new Date(2026, 7, 16, 2, 0, 0);   // Sunday
    const TUE = new Date(2026, 7, 18, 2, 0, 0);   // Tuesday
    const allOn = { jobs: { reply: { on: true, model: 'm' }, week: { on: true, model: 'm' },
        price: { on: true, model: 'm' }, answer: { on: true, model: 'm' }, voice: { on: true, model: 'm' } } };
    const idsOf = function (plan) { return plan.due.map(function (x) { return x.job.id; }).sort().join(','); };
    ok('Monday runs the reply AND both weekly-mon jobs', idsOf(jobs.jobsDueTonight(jobs.JOBS, allOn, MON)) === 'price,reply,week');
    ok('Sunday runs the reply and the answers', idsOf(jobs.jobsDueTonight(jobs.JOBS, allOn, SUN)) === 'answer,reply');
    ok('Tuesday runs the reply alone', idsOf(jobs.jobsDueTonight(jobs.JOBS, allOn, TUE)) === 'reply');
    ok('...and SAYS the weekly ones are waiting, with their day',
        jobs.jobsDueTonight(jobs.JOBS, allOn, TUE).waiting.map(function (w) { return w.until; }).sort().join(',') === 'Monday,Monday,Sunday');
    ok('voice can never be due — not built, whatever the config claims',
        jobs.jobsDueTonight(jobs.JOBS, allOn, MON).due.every(function (x) { return x.job.id !== 'voice'; }));
    ok('a job switched off is neither due nor waiting', (function () {
        const p = jobs.jobsDueTonight(jobs.JOBS, { jobs: { reply: { on: true, model: 'm' } } }, TUE);
        return p.due.length === 1 && p.waiting.length === 0;
    }()));

    // THE WEEK JOB, driven with an obedient fake engine and then a lying one.
    const WEEK = {
        from: '2026-08-17', to: '2026-08-24',
        arrivals: [{ first: 'Rachel', cottage: 'Jollyboat', date: '2026-08-21', nights: 3, adults: 2, children: 1, due: '£340.00' }],
        departures: [{ first: 'Tom', cottage: 'Pimpernel', date: '2026-08-19' }],
    };
    const GAPS = [{ cottage: 'Jollyboat', from: '2026-09-12', to: '2026-09-15', nights: 3, rate: '£120.00', offer: '£102.00' }];
    const obedient = function (text) {
        return { write: async function () { return { ok: true, text: text, ms: 1200, tokens: 50, tokensPerSec: 40 }; } };
    };
    let out23 = await jobs.runWeekJob({ engine: obedient(
        'Rachel arrives at Jollyboat on Friday for three nights with £340.00 still to collect. Tom leaves Pimpernel on Wednesday, so there is a changeover to plan. Jollyboat then has three free nights in September worth thinking about.'),
        model: 'm', host: 'George', now: MON, week: WEEK, gaps: GAPS });
    ok('the week job posts ONE note', out23.items.length === 1);
    ok('...kind note, on the queue\'s own vocabulary', out23.items[0].kind === 'note');
    ok('...titled and counted', out23.items[0].title === 'The week ahead' && /1 arrival · 1 departure · 1 gap/.test(out23.items[0].sub), out23.items[0].sub);
    ok('...targeting Today, where the calendar lives', out23.items[0].target === 'view-backoffice');
    ok('...with a deterministic ref for the night', out23.items[0].ref === 'mac-2026-08-17-note-week');
    out23 = await jobs.runWeekJob({ engine: obedient('The week is quiet, but you could offer the gap at £95.00 and fill it easily enough I think.'),
        model: 'm', host: 'George', now: MON, week: WEEK, gaps: GAPS });
    ok('a week note that INVENTS a figure is refused', out23.items.length === 0
        && /£95\.00/.test(out23.log.map(function (l) { return l.say; }).join(' ')));
    out23 = await jobs.runWeekJob({ engine: obedient('x'), model: 'm', host: 'G', now: MON, week: undefined, gaps: [] });
    ok('an older site is reported, not read as a quiet week', out23.items.length === 0
        && /update the website/.test(out23.log.map(function (l) { return l.say; }).join(' ')));

    // THE PRICE JOB.
    out23 = await jobs.runPriceJob({ engine: obedient(
        'Jollyboat has three free nights in mid September between two stays. At £120.00 a night they are unlikely to sell on their own; the suggested £102.00 is a fair last-minute price and worth offering.'),
        model: 'm', host: 'George', now: MON, gaps: GAPS });
    ok('the price job posts one case', out23.items.length === 1 && out23.items[0].kind === 'price');
    ok('...naming the cottages in the sub', out23.items[0].sub === 'Jollyboat');
    ok('...targeting the Pricing page', out23.items[0].target === 'settings:pricing');
    out23 = await jobs.runPriceJob({ engine: obedient('Drop Jollyboat to £80.00 a night and it will go.'),
        model: 'm', host: 'G', now: MON, gaps: GAPS });
    ok('a price the site did not suggest is refused', out23.items.length === 0);
    out23 = await jobs.runPriceJob({ engine: obedient('x'), model: 'm', host: 'G', now: MON, gaps: [] });
    ok('no gaps is a SUCCESS with nothing posted', out23.items.length === 0
        && !out23.log.some(function (l) { return l.level === 'fail'; }));
    out23 = await jobs.runPriceJob({ engine: obedient('x'), model: 'm', host: 'G', now: MON, gaps: undefined });
    ok('an older site is a named failure here too', out23.log.some(function (l) { return l.level === 'fail'; }));

    // THE ANSWER JOB.
    // NB the two questions share their first 24 ALPHANUMERICS on purpose —
    // that is the slice makeRef keeps of a wordy id, so an un-hashed ref
    // collides on exactly this pair and the site would silently drop the
    // second answer as a duplicate. The first fixture here diverged at
    // character 20 and let the un-hashed version pass (a vacuous break-test,
    // caught by running it).
    const QS = [
        { q: 'Is there anywhere nearby to walk the dog in the morning?', asked: 4, prop: 'jollyboat', cottage: 'Jollyboat',
            facts: [{ q: 'Do you take dogs?', a: 'We are afraid not.' }] },
        { q: 'Is there anywhere nearby to walk the dog in the evening?', asked: 2, prop: 'jollyboat', cottage: 'Jollyboat', facts: [] },
    ];
    out23 = await jobs.runAnswerJob({ engine: obedient(
        'We are afraid we cannot take dogs at Jollyboat, in the garden or the cottage, much as we love them.'),
        model: 'm', host: 'George', now: MON, questions: QS });
    ok('one answer per question', out23.items.length === 2 && out23.items.every(function (i) { return i.kind === 'answer'; }));
    ok('...each with its OWN ref — two questions sharing first words must not collide',
        out23.items[0].ref !== out23.items[1].ref, out23.items.map(function (i) { return i.ref; }).join(' '));
    ok('...titled with the question and counted', /An answer for/.test(out23.items[0].title)
        && /asked 4 times/.test(out23.items[0].sub));
    ok('...targeting the screen where one tap makes it a live FAQ', out23.items[0].target === 'settings:search-learning');
    out23 = await jobs.runAnswerJob({ engine: obedient('The cleaning fee is £30.00 and dogs are not allowed at the cottage.'),
        model: 'm', host: 'G', now: MON, questions: [QS[0]] });
    ok('an answer may write NO money at all — any figure is an invention', out23.items.length === 0);
    ok('the no-facts prompt says there is nothing to draw on',
        /NO published answers/.test(guard.buildAnswerPrompt(QS[1], 'G')));
    ok('...and the with-facts prompt carries them',
        /We are afraid not/.test(guard.buildAnswerPrompt(QS[0], 'G')));

    // THE NIGHT RUNS THEM ALL, swapping the model server per job's model.
    const nightCalls = [];
    const swapRunnerEngine = {
        id: 'llamacpp', name: 'llama.cpp', base: 'http://x',
        reachable: async function () { return nightCalls.filter(function (c) { return c[0] === 'start'; }).length > nightCalls.filter(function (c) { return c[0] === 'stop'; }).length; },
        write: async function (prompt) {
            // Obedient per job: echo the one figure each prompt allows.
            if (/Monday-morning note/.test(prompt)) { return { ok: true, text: 'Rachel arrives with £340.00 to collect; otherwise the week ahead looks manageable and calm.', ms: 1, tokens: 1 }; }
            if (/pricing note/.test(prompt)) { return { ok: true, text: 'The gap at £120.00 a night is worth offering at the suggested £102.00 before it goes quietly unsold.', ms: 1, tokens: 1 }; }
            return { ok: true, text: 'Thank you for asking about the cottage; the week you mention could suit a short stay rather well.', ms: 1, tokens: 1 };
        },
    };
    let posted = null;
    const nightSite = {
        brief: async function () {
            return { ok: true, host: 'George', enquiries: [], week: WEEK, gaps: GAPS, questions: [] };
        },
        ingest: async function (items) { posted = items; return { ok: true, stored: items.length, skipped: [] }; },
    };
    const swaps = [];
    const rec23 = await night.runNight({
        site: nightSite,
        engine: swapRunnerEngine,
        cfg: { jobs: { reply: { on: true, model: 'small.gguf' }, week: { on: true, model: 'big.gguf' },
            price: { on: true, model: 'big.gguf' }, answer: { on: true, model: 'small.gguf' } } },
        now: MON,
        ensureEngineFor: async function (model) {
            swaps.push(model);
            nightCalls.push(['start', model]);
            return { ok: true, started: true, say: 'ready' };
        },
    });
    ok('a Monday night runs reply, week and price together', rec23.ok === true && posted && posted.length === 2,
        JSON.stringify(posted && posted.map(function (i) { return i.kind; })));
    ok('...posting the note and the price case in ONE ingest',
        posted.map(function (i) { return i.kind; }).sort().join(',') === 'note,price');
    ok('...and the engine was ensured PER MODEL, in job order',
        swaps.join(',') === 'small.gguf,big.gguf', swaps.join(','));
    ok('...with both models in the record', rec23.model === 'small.gguf, big.gguf', rec23.model);
    ok('...and the answers job said it waits for Sunday',
        rec23.log.some(function (l) { return /waits for Sunday/.test(l.say); }));

    // ── §24 THE WIRE IS NOT TRUSTED: a hostile brief renders NO line noise ──
    // The cottage-name bug's class from this side: a field that is not the
    // string the contract promises must become an ABSENT fact or a DROPPED
    // row — never "undefined", "[object Object]" or a mangled date in a
    // prompt, an item title, or the owner's Ready-for-you card. The engine
    // fake RECORDS every prompt so the sweep reads what the model would
    // actually have been given, and the sweep covers prompts + items + log.
    console.log('\n§24 a hostile brief never renders as line noise');
    const seen24 = [];
    const recorder24 = function (text) {
        return { write: async function (prompt) { seen24.push(prompt);
            return { ok: true, text: text, ms: 900, tokens: 40, tokensPerSec: 40 }; } };
    };
    const NOISE24 = ['undefined', '[object Object]', 'Invalid Date', 'NaN'];
    const sweep24 = function (out) {
        let all = seen24.join('\n');
        out.items.forEach(function (it) { all += '\n' + it.title + '\n' + (it.sub || '') + '\n' + it.ref; });
        out.log.forEach(function (l) { all += '\n' + l.say; });
        return NOISE24.filter(function (t) { return all.indexOf(t) !== -1; });
    };
    // Every string field an object or undefined; every number a string or
    // absent; one WELL-FORMED row beside the garbage in each list, because a
    // scrubber that drops everything would pass the sweep and lose the job.
    const HOSTILE_WEEK = {
        from: { bad: 1 }, to: undefined,
        arrivals: [
            { first: ['R'], cottage: { n: 'x' }, date: { d: 1 }, nights: 'three', adults: null, due: { v: 9 } },
            { first: 'Rachel', cottage: 'Jollyboat', date: '2026-08-21', nights: 3, adults: 2, children: 1, due: '£340.00' },
        ],
        departures: [{ first: 'Tom', cottage: 7 }, { first: 'Tom', cottage: 'Pimpernel', date: '2026-08-19' }],
    };
    const HOSTILE_GAPS = [
        { cottage: {}, from: 'soonish', to: null, nights: '3', rate: {}, offer: undefined },
        { cottage: 'Jollyboat', from: '2026-09-12', to: '2026-09-15', nights: 3, rate: '£120.00', offer: '£102.00' },
    ];
    const HOSTILE_QS = [
        { q: { text: 'not a string' }, asked: 'many', cottage: [], facts: 'nope' },
        { q: 'Is there an EV charger?', asked: 3, cottage: '21A Westgate',
          facts: [{ q: ['bad'], a: 'x' }, { q: 'Parking?', a: 'Beside the cottage.' }] },
    ];
    seen24.length = 0;
    const w24 = await jobs.runWeekJob({ engine: recorder24('A quiet week with £340.00 still to collect.'),
        model: 'm', host: 'George', now: MON, week: HOSTILE_WEEK, gaps: HOSTILE_GAPS });
    ok('the week: no line noise anywhere', sweep24(w24).length === 0, sweep24(w24).join(','));
    ok('…the unreadable rows are dropped AND said', w24.log.some(function (l) {
        return /3 rows this app could not read/.test(l.say) && l.level === 'fail'; }),
        JSON.stringify(w24.log.map(function (l) { return l.say; })));
    ok('…while the well-formed arrival still reaches the prompt', /Rachel at Jollyboat/.test(seen24.join('')) || /Arriving: Rachel/.test(seen24.join('')), seen24.join('').slice(0, 400));
    seen24.length = 0;
    const p24 = await jobs.runPriceJob({ engine: recorder24('Jollyboat could go out at £102.00 a night for those three nights.'),
        model: 'm', host: 'George', now: MON, gaps: HOSTILE_GAPS });
    ok('the prices: no line noise, one gap dropped and said', sweep24(p24).length === 0
        && p24.log.some(function (l) { return /1 row this app could not read/.test(l.say); }), sweep24(p24).join(','));
    ok('…and the surviving gap is still weighed', p24.items.length === 1 && /A gap worth a look/.test(p24.items[0].title));
    // Every row unreadable → NOT the quiet-fortnight success message: the
    // drop line is the story, and "no gaps worth selling" beside it would be
    // the site's failure dressed as a quiet win.
    seen24.length = 0;
    const p24b = await jobs.runPriceJob({ engine: recorder24('x'), model: 'm', host: 'George', now: MON,
        gaps: [HOSTILE_GAPS[0]] });
    ok('all rows unreadable is a failure, not a quiet fortnight', p24b.items.length === 0
        && !p24b.log.some(function (l) { return /no gaps worth selling/.test(l.say); })
        && p24b.log.some(function (l) { return l.level === 'fail'; }),
        JSON.stringify(p24b.log.map(function (l) { return l.say; })));
    seen24.length = 0;
    const a24 = await jobs.runAnswerJob({ engine: recorder24('There is a charger in the lane, a short walk away.'),
        model: 'm', host: 'George', now: MON, questions: HOSTILE_QS });
    ok('the answers: no line noise, the object question dropped', sweep24(a24).length === 0
        && a24.items.length === 1 && /EV charger/.test(a24.items[0].title), sweep24(a24).join(','));
    ok('…and its malformed fact is absent while the real one grounds the prompt',
        seen24.join('').indexOf('Parking?') !== -1 && seen24.join('').indexOf('[object') === -1);
    seen24.length = 0;
    const r24 = await jobs.runReplyJob({ engine: recorder24('Thank you for asking — the dates you mention are free and we would love to have you.'),
        model: 'm', host: 'George', now: MON, enquiries: [
            { id: 'not-a-number', name: {}, message: 'Hi' },
            { id: 3, name: 'Pat Doe', first: 'Pat', cottage: 'Jollyboat', prop: 'jollyboat',
              check_in: '2026-09-04', check_out: '2026-09-07', adults: 2, children: 0,
              message: 'Are the dates free?', dates_free: true, nights: 3, quote: '',
              deposit: '', facts: [{ q: ['bad'], a: 'x' }] },
        ] });
    ok('the replies: an id-less row cannot be reffed, so it is dropped and said',
        r24.log.some(function (l) { return /1 row this app could not read/.test(l.say); })
        && r24.items.length === 1 && /reply-3$/.test(r24.items[0].ref),
        JSON.stringify(r24.items.map(function (it) { return it.ref; })));
    ok('…and no line noise reaches the reply prompt', sweep24(r24).length === 0, sweep24(r24).join(','));
    // dates_free must never be COERCED to a yes: a truthy non-boolean reads
    // as "could not tell", and the prompt then forbids availability talk.
    seen24.length = 0;
    await jobs.runReplyJob({ engine: recorder24('A fine stay awaits.'), model: 'm', host: 'George', now: MON,
        enquiries: [{ id: 4, name: 'Jo', first: 'Jo', cottage: 'Jollyboat', message: 'Free?',
            dates_free: 'yes', check_in: '2026-09-04', check_out: '2026-09-07' }] });
    ok('a non-boolean dates_free reads as unknown, never a yes',
        /Availability is unknown/.test(seen24.join('')) && seen24.join('').indexOf('ARE free') === -1,
        seen24.join('').slice(0, 300));
    ok('spokenDay never stringifies an object', jobs !== null
        && require('../src/core/guard').spokenDay({ d: 1 }) === ''
        && require('../src/core/guard').spokenDay('2026-08-21') === 'Fri 21 Aug'
        && require('../src/core/guard').spokenDay('soon') === 'soon');

    // Open-at-login: default OFF (an app must not add itself to login items
    // unasked), saved through the same settings path as every other switch.
    {
        const cfgMod = require('../src/core/config');
        ok('openAtLogin defaults off', cfgMod.DEFAULTS.openAtLogin === false);
        ok('moveDeclined defaults off', cfgMod.DEFAULTS.moveDeclined === false);
        const upd = require('../src/core/update');
        const base = { isMac: true, packaged: true, inApplications: false, declined: false };
        ok('the move is offered exactly when it should be', upd.shouldOfferMove(base) === true
            && upd.shouldOfferMove(Object.assign({}, base, { isMac: false })) === false
            && upd.shouldOfferMove(Object.assign({}, base, { packaged: false })) === false
            && upd.shouldOfferMove(Object.assign({}, base, { inApplications: true })) === false
            && upd.shouldOfferMove(Object.assign({}, base, { declined: true })) === false);
        const merged = cfgMod.merge(cfgMod.DEFAULTS, { openAtLogin: true });
        ok('…and a stored true survives the merge', merged.openAtLogin === true);
    }

    // Stood-down enquiries are SAID: a shorter brief must never read as
    // enquiries going missing (integration step 2 — a binned draft stays
    // binned, and the log names why the night was quieter).
    {
        const r1 = await jobs.runReplyJob({ engine: { write: async () => ({ ok: true, text: 'x', ms: 1 }) },
            model: 'm', host: 'G', now: MON, enquiries: [], stoodDown: 2 });
        ok('an empty brief with stood-down rows says so', r1.log.some(function (l) {
            return /2 stood down/.test(l.say) && /already dealt/.test(l.say); }),
            JSON.stringify(r1.log.map(function (l) { return l.say; })));
        const r2 = await jobs.runReplyJob({ engine: { write: async () => ({ ok: true, text: 'x', ms: 1 }) },
            model: 'm', host: 'G', now: MON, enquiries: [], stoodDown: 0 });
        ok('…and a genuinely quiet night keeps its own sentence', r2.log.some(function (l) {
            return /nothing waiting/.test(l.say); }));
    }

    // ── HOW GEORGE WRITES (integration step 3): the register block appears
    // exactly when the site handed examples over, and never otherwise.
    {
        const F = { first: 'Pat', cottage: 'Jollyboat', message: 'Free?', dates_free: true, quote: '£440.00' };
        const withV = guard.buildPrompt(F, 'George', ['Lovely to hear from you — those dates are free at the cottage.']);
        ok('the voice block names the owner and carries the example',
            /HOW GEORGE WRITES/.test(withV) && /Lovely to hear from you/.test(withV)
            && /NEVER copy/.test(withV), withV.slice(-300));
        const noV = guard.buildPrompt(F, 'George');
        ok('…and is absent when the site handed nothing over', !/HOW GEORGE WRITES/.test(noV));
        const hostileV = guard.buildPrompt(F, 'George', [{ bad: 1 }, '  ', 'One real example, warm and short.']);
        ok('…and non-string examples never reach the prompt',
            !/object Object/.test(hostileV) && /One real example/.test(hostileV));
    }

    // ── §25 THE ASK SWEEP — the daytime half, same rules at a moment's tempo ──
    console.log('\n§25 the ask sweep');
    const posted25 = [];
    const prompts25 = [];
    const fakeAskSite = function (asks) {
        return {
            asks: async function () { return { ok: true, host: 'George', asks: asks }; },
            answerAsk: async function (id, text, model) { posted25.push({ id: id, text: text, model: model }); return { ok: true }; },
        };
    };
    const askEngine = function (text) {
        return { write: async function (prompt) { prompts25.push(prompt); return { ok: true, text: text, ms: 700, tokens: 30, tokensPerSec: 40 }; } };
    };
    const CFG25 = { jobs: { reply: { on: true, model: 'small.gguf' }, answer: { on: true, model: 'big.gguf' } } };
    const REPLY_ASK = { id: 7, kind: 'reply', enquiry: { id: 42, name: 'Pat Doe', first: 'Pat', cottage: 'Jollyboat',
        prop: 'jollyboat', check_in: '2026-09-04', check_out: '2026-09-07', adults: 2, children: 0,
        message: 'Do you take dogs?', dates_free: true, nights: 3, quote: '£440.00', deposit: '£75.00',
        facts: [{ q: 'Do you take dogs?', a: 'We are afraid not.' }] } };
    const ANSWER_ASK = { id: 8, kind: 'answer', question: { q: 'Is there an EV charger?', asked: 3,
        prop: '21a', cottage: '21A Westgate', facts: [{ q: 'Parking?', a: 'One car outside.' }] } };

    // A quiet poll is SILENT — this runs every twenty seconds.
    posted25.length = 0;
    let sw25 = await jobs.runAskSweep({ site: fakeAskSite([]), engine: askEngine('x'), cfg: CFG25, now: MON });
    ok('an empty sweep answers nothing and logs nothing', sw25.answered === 0 && sw25.log.length === 0);

    // A reply ask: the reply job's model, the reply prompt, the reply guard.
    posted25.length = 0; prompts25.length = 0;
    const swaps25 = [];
    sw25 = await jobs.runAskSweep({ site: fakeAskSite([REPLY_ASK]),
        engine: askEngine('Thank you for asking — those dates are free, and the total for your stay would be £440.00. We are afraid we cannot take dogs, but the beach walks more than make up for it. Do say if you would like the dates held.'),
        cfg: CFG25, now: MON,
        ensureEngineFor: async function (m) { swaps25.push(m); return { ok: true, started: false }; } });
    ok('a reply ask is answered with the reply job\'s model', sw25.answered === 1
        && posted25.length === 1 && posted25[0].id === 7 && posted25[0].model === 'small.gguf',
        JSON.stringify(posted25));
    ok('…through the reply prompt (the site\'s own quote in the facts)', /£440\.00/.test(prompts25[0]) && /Pat/.test(prompts25[0]));
    ok('…and the engine was ensured for that model', swaps25.join(',') === 'small.gguf');

    // An answer ask: the answer job's model, and NO money may survive.
    posted25.length = 0;
    sw25 = await jobs.runAskSweep({ site: fakeAskSite([ANSWER_ASK]),
        engine: askEngine('There is a charger in the lane, £5.00 a session.'), cfg: CFG25, now: MON });
    ok('an answer quoting money is refused, not posted', sw25.answered === 0 && posted25.length === 0
        && sw25.log.some(function (l) { return /refused own answer/.test(l.say); }),
        JSON.stringify(sw25.log.map(function (l) { return l.say; })));
    posted25.length = 0;
    sw25 = await jobs.runAskSweep({ site: fakeAskSite([ANSWER_ASK]),
        engine: askEngine('There is a public charger in the lane behind the quay, a short walk from the cottage.'),
        cfg: CFG25, now: MON });
    ok('a clean answer posts with the answer job\'s model', sw25.answered === 1
        && posted25[0].id === 8 && posted25[0].model === 'big.gguf', JSON.stringify(posted25));

    // No model chosen anywhere → said, failed, nothing posted.
    posted25.length = 0;
    sw25 = await jobs.runAskSweep({ site: fakeAskSite([REPLY_ASK]), engine: askEngine('x'),
        cfg: { jobs: { reply: { model: '' }, answer: { model: '' } } }, now: MON });
    ok('no model anywhere is a named failure, nothing posted', sw25.failed === 1 && posted25.length === 0
        && sw25.log.some(function (l) { return /pick one on the Jobs screen/.test(l.say); }));

    // A hostile ask never renders as line noise and is said to be skipped.
    posted25.length = 0;
    sw25 = await jobs.runAskSweep({ site: fakeAskSite([{ id: 9, kind: 'reply', enquiry: { id: {}, name: ['x'] } }]),
        engine: askEngine('x'), cfg: CFG25, now: MON });
    ok('an unreadable ask is skipped and said', posted25.length === 0
        && sw25.log.some(function (l) { return /could not read/.test(l.say); }),
        JSON.stringify(sw25.log.map(function (l) { return l.say; })));

    // The owner moved on while the model worked: a 410 is a skip, not a failure.
    sw25 = await jobs.runAskSweep({
        site: { asks: async function () { return { ok: true, host: 'G', asks: [ANSWER_ASK] }; },
            answerAsk: async function () { return { ok: true, expired: true }; } },
        engine: askEngine('There is a public charger in the lane behind the quay, a short walk from the cottage — though this perfectly good answer arrives too late.'), cfg: CFG25, now: MON });
    ok('answering too late is a skip with its reason, never a failure', sw25.failed === 0
        && sw25.log.some(function (l) { return /moved on/.test(l.say) && l.level === 'skip'; }),
        JSON.stringify(sw25.log.map(function (l) { return l.say; })));

    // ── THE CHAT ASK (integration step 5): reply-shaped work with a stricter
    // never-list — no money at all, no code-shaped number, greeting allowed.
    console.log('\n§26 the chat ask');
    const CHAT_ASK = { id: 11, kind: 'chat', chat: { first: 'Sophie', msgs: [
        { who: 'guest', text: 'What time can we get in on Saturday?' },
        { who: 'you', text: 'Checking now!' },
        { who: 'guest', text: 'And is the key safe code the same as last year?' },
    ] } };
    posted25.length = 0; prompts25.length = 0;
    let cs = await jobs.runAskSweep({ site: fakeAskSite([CHAT_ASK]),
        engine: recorder24('Hi Sophie — check-in is from 3pm on Saturday. I would rather not put the key safe details in chat, but everything you need will be on your booking page before you travel.'),
        cfg: CFG25, now: MON });
    ok('a chat ask is answered with the reply job\'s model, greeting allowed',
        cs.answered === 1 && posted25[0] && posted25[0].id === 11 && posted25[0].model === 'small.gguf',
        JSON.stringify(cs.log.map(function (l) { return l.say; })));
    ok('…and the prompt carries the conversation with the roles translated',
        /Sophie: What time can we get in/.test(seen24.join('')) && /You: Checking now/.test(seen24.join('')));
    posted25.length = 0;
    cs = await jobs.runAskSweep({ site: fakeAskSite([CHAT_ASK]),
        engine: recorder24('Hi Sophie — yes, the key safe code is 7302, same as last year, see you Saturday!'),
        cfg: CFG25, now: MON });
    ok('a chat reply that states a code is refused, never posted',
        cs.answered === 0 && posted25.length === 0
        && cs.log.some(function (l) { return /code-shaped number/.test(l.say); }),
        JSON.stringify(cs.log.map(function (l) { return l.say; })));
    posted25.length = 0;
    cs = await jobs.runAskSweep({ site: fakeAskSite([{ id: 12, kind: 'chat', chat: { first: 'X', msgs: [] } }]),
        engine: recorder24('x'), cfg: CFG25, now: MON });
    ok('a conversation with no words drafts nothing, and says so',
        posted25.length === 0 && cs.log.some(function (l) { return /could not read/.test(l.say); }));

    // ── §27 THE INTENT ASK (search × Mac): the model may only CHOOSE ─────────
    console.log('\n§27 the intent ask');
    const MENU27 = ['who owes me money', 'leaving today', 'arriving today'];
    const INTENT_ASK = { id: 21, kind: 'intent', intent: { q: 'anyone still owing?', options: MENU27 } };

    // The chooser contract at the guard: byte-exact member or 'none', wrapping
    // quotes and trailing punctuation forgiven, a near-miss refused outright.
    ok('checkIntent accepts a byte-exact member', guard.checkIntent('who owes me money', MENU27) === 'who owes me money');
    ok('…strips the quotes a chat model loves to add', guard.checkIntent('“leaving today”.', MENU27) === 'leaving today');
    ok("…reads any casing of none as 'none'", guard.checkIntent('None.', MENU27) === 'none');
    ok('…and a NEAR-miss is refused, never repaired', guard.checkIntent('who owes me some money', MENU27) === '');
    ok('the prompt states the contract: copy one line verbatim, or the word none',
        /EXACTLY ONE line/.test(guard.buildIntentPrompt('anyone owing?', MENU27))
        && /reply with exactly: none/.test(guard.buildIntentPrompt('anyone owing?', MENU27)));

    // A clean pick posts byte-exact — on the SMALLEST installed model, because
    // a menu pick is a sub-second job and the big model should keep its slot.
    posted25.length = 0; prompts25.length = 0;
    const swaps27 = [];
    let isw = await jobs.runAskSweep({ site: fakeAskSite([INTENT_ASK]),
        engine: askEngine('who owes me money'), cfg: CFG25, now: MON, smallModel: 'tiny.gguf',
        ensureEngineFor: async function (m) { swaps27.push(m); return { ok: true, started: false }; } });
    ok('an on-menu pick posts byte-exact, on the smallest model',
        isw.answered === 1 && posted25[0] && posted25[0].id === 21
        && posted25[0].text === 'who owes me money' && posted25[0].model === 'tiny.gguf'
        && swaps27.join(',') === 'tiny.gguf', JSON.stringify(posted25));
    ok('…and the prompt carried the query AND the menu',
        /anyone still owing\?/.test(prompts25[0]) && /leaving today/.test(prompts25[0]));

    // No smallest model known → the reply job's model serves (an ask with SOME
    // model beats one refused for configuration).
    posted25.length = 0;
    isw = await jobs.runAskSweep({ site: fakeAskSite([INTENT_ASK]),
        engine: askEngine('leaving today'), cfg: CFG25, now: MON });
    ok('without a smallest model the reply job\'s model serves',
        isw.answered === 1 && posted25[0].model === 'small.gguf', JSON.stringify(posted25));

    // Junk from the model downgrades to an honest 'none', NAMED in the log —
    // a fast none beats a timed-out wait, and the site re-checks membership.
    posted25.length = 0;
    isw = await jobs.runAskSweep({ site: fakeAskSite([INTENT_ASK]),
        engine: askEngine('I think they probably mean the money question!'), cfg: CFG25, now: MON, smallModel: 'tiny.gguf' });
    ok("an off-menu answer posts 'none' and says so",
        posted25.length === 1 && posted25[0].text === 'none'
        && isw.log.some(function (l) { return /off the menu/.test(l.say) && l.level === 'skip'; }),
        JSON.stringify(isw.log.map(function (l) { return l.say; })));

    // An intent ask with no menu is unreadable — nothing to choose from.
    posted25.length = 0;
    isw = await jobs.runAskSweep({ site: fakeAskSite([{ id: 22, kind: 'intent', intent: { q: 'x?', options: [] } }]),
        engine: askEngine('x'), cfg: CFG25, now: MON });
    ok('a menu-less intent ask is skipped and said', posted25.length === 0
        && isw.log.some(function (l) { return /could not read/.test(l.say); }));

    // THE WARM HINT rides the empty sweep — the caller (api.js) warms the
    // engine off it, so the flag must survive the quiet path.
    isw = await jobs.runAskSweep({
        site: { asks: async function () { return { ok: true, host: 'G', asks: [], warm: true }; } },
        engine: askEngine('x'), cfg: CFG25, now: MON });
    ok('an empty sweep carries the warm hint through', isw.warm === true && isw.log.length === 0);

    // ── §28 THE TEACH JOB (search × Mac, rung 4) ─────────────────────────────
    console.log('\n§28 the teach job');
    const TEACH = { misses: [{ q: 'anyone owing us?', n: 3 }, { q: 'who is leaving', n: 5 }], options: ['who owes me money', 'leaving today'] };
    let tprompts = [];
    const teachEngine = function (answers) {
        let k = 0;
        return { write: async function (p) { tprompts.push(p); const t = answers[Math.min(k, answers.length - 1)]; k++; return { ok: true, text: t, ms: 400, tokens: 8, tokensPerSec: 40 }; } };
    };
    tprompts = [];
    let tj = await jobs.runTeachJob({ teach: TEACH, engine: teachEngine(['who owes me money', 'leaving today']), model: 'tiny.gguf', now: MON });
    ok('each dead end is placed on the menu and becomes ONE suggestion item',
        tj.items.length === 2 && tj.items.every(function (it) { return it.kind === 'teach' && it.target === 'settings:search-learning'; }),
        JSON.stringify(tj.items.map(function (i) { return i.ref; })));
    ok('the title carries the FULL query and the sub the canonical, in the fixed teachable shape',
        tj.items[0].title === '\u201canyone owing us?\u201d' && tj.items[0].sub === 'reads as \u201cwho owes me money\u201d',
        tj.items[0].title + ' | ' + tj.items[0].sub);
    ok('the ref is DAYLESS — one suggestion per phrasing ever, whatever night it runs',
        /^mac--teach-q[0-9a-f]+$/.test(tj.items[0].ref), tj.items[0].ref);
    ok('…and the prompt is the intent chooser with the menu in it',
        /EXACTLY ONE line/.test(tprompts[0]) && /leaving today/.test(tprompts[0]));

    // Junk from the model → the phrasing is LEFT ALONE, counted in one line.
    tj = await jobs.runTeachJob({ teach: TEACH, engine: teachEngine(['I reckon the money one', 'none']), model: 't', now: MON });
    ok('an unmappable phrasing is left alone and said once, never repaired',
        tj.items.length === 0 && tj.log.some(function (l) { return /left alone/.test(l.say) && l.level === 'skip'; }),
        JSON.stringify(tj.log.map(function (l) { return l.say; })));

    // The site's absent/empty shapes, each honest.
    tj = await jobs.runTeachJob({ engine: teachEngine(['x']), model: 't', now: MON });
    ok('an older site (no teach block) is a named failure, not a quiet week',
        tj.log.some(function (l) { return /update the website/.test(l.say); }));
    tj = await jobs.runTeachJob({ teach: { misses: [{ q: 'x?', n: 1 }], options: [] }, engine: teachEngine(['x']), model: 't', now: MON });
    ok('an empty menu is a named failure — a mapping could only be invented',
        tj.items.length === 0 && tj.log.some(function (l) { return /no menu of questions/.test(l.say); }));
    tj = await jobs.runTeachJob({ teach: { misses: [], options: ['a'] }, engine: teachEngine(['x']), model: 't', now: MON });
    ok('no dead ends this week is a quiet line, not an error',
        tj.log.some(function (l) { return /nothing to do/.test(l.say) && l.level === 'info'; }));
    tj = await jobs.runTeachJob({ teach: { misses: [{ q: ['bad'], n: 1 }, 7, { q: 'ok one?', n: 1 }], options: ['who owes me money'] },
        engine: teachEngine(['who owes me money']), model: 't', now: MON });
    ok('garbage misses are absent, the readable one still maps',
        tj.items.length === 1 && tj.items[0].title === '\u201cok one?\u201d', JSON.stringify(tj.items));

    // ── §29 THE DIGEST ASK (the analyst) — grounded, or refused ─────────────
    console.log('\n§29 the digest ask');
    const DROWS = ['Review from Sarah: the boiler took £120 to fix and rattled all week.',
        'Message: Tom said the boiler pressure kept dropping.'];
    ok('a grounded summary passes the guard',
        guard.checkDigest('Guests raised the boiler twice \u2014 Sarah paid £120 for a fix and Tom saw the pressure dropping.', DROWS).ok);
    ok('a figure the records never state is refused, named',
        guard.checkDigest('Repairs ran to about £450 overall.', DROWS).problems.some(function (p) { return /£450/.test(p); }));
    ok('a proper noun the records never mention is refused',
        guard.checkDigest('Complaints came mostly from Bartholomew.', DROWS).problems.some(function (p) { return /Bartholomew/.test(p); }));
    ok('sentence-initial capitals are grammar, not identity',
        guard.checkDigest('Boiler trouble came up twice. Pressure was the main theme.', DROWS).ok);
    ok('£120.00 is grounded by a record\u2019s £120', guard.checkDigest('It cost £120.00 in the end.', DROWS).ok);
    ok('the prompt hands over the records and the records-only rule',
        /FROM THESE RECORDS ALONE/.test(guard.buildDigestPrompt('q', DROWS)) && /rattled all week/.test(guard.buildDigestPrompt('q', DROWS)));

    const DIGEST_ASK = { id: 31, kind: 'digest', digest: { q: 'what did guests say about the boiler?', rows: DROWS } };
    posted25.length = 0; prompts25.length = 0;
    let dg = await jobs.runAskSweep({ site: fakeAskSite([DIGEST_ASK]),
        engine: askEngine('Two boiler mentions \u2014 Sarah\u2019s £120 fix, and the pressure drop Tom reported.'),
        cfg: CFG25, now: MON });
    ok('a digest ask is answered with the ANSWER job\u2019s model (prose over records)',
        dg.answered === 1 && posted25[0] && posted25[0].id === 31 && posted25[0].model === 'big.gguf',
        JSON.stringify(posted25));
    ok('\u2026through the digest prompt (the records travel)', /rattled all week/.test(prompts25[0]));
    posted25.length = 0;
    dg = await jobs.runAskSweep({ site: fakeAskSite([DIGEST_ASK]),
        engine: askEngine('Roughly £450 of repairs came up.'), cfg: CFG25, now: MON });
    ok('an ungrounded summary is refused, never posted',
        dg.answered === 0 && posted25.length === 0
        && dg.log.some(function (l) { return /refused own summary/.test(l.say); }),
        JSON.stringify(dg.log.map(function (l) { return l.say; })));
    posted25.length = 0;
    dg = await jobs.runAskSweep({ site: fakeAskSite([{ id: 32, kind: 'digest', digest: { q: 'x?', rows: [] } }]),
        engine: askEngine('x'), cfg: CFG25, now: MON });
    ok('a digest ask with no records is unreadable — skipped and said',
        posted25.length === 0 && dg.log.some(function (l) { return /could not read/.test(l.say); }));

    // ── §30 THE CHAT — the owner's own channel, and its boundaries ──────────
    console.log('\n§30 the chat');
    const chatMod = require('../src/core/chat.js');
    ok('the system line states the boundary to the MODEL — private, no sends',
        /cannot send/.test(chatMod.chatSystemLine('George')) && /nothing you write here reaches the website or a guest/i.test(chatMod.chatSystemLine('George')));
    ok('…and names the owner when the brief has said who that is',
        /George/.test(chatMod.chatSystemLine('George')) && /the owner/.test(chatMod.chatSystemLine('')));
    ok('a message is a role and a string — garbage is absent, never the word Array',
        chatMod.chatMsg({ role: 'user', text: ['an', 'array'] }) === null
        && chatMod.chatMsg({ role: 'system', text: 'sneaky' }) === null
        && chatMod.chatMsg('nonsense') === null
        && chatMod.chatMsg({ role: 'assistant', text: '  hi  ', at: '14:22:59' }).at === '14:22');
    ok('a thread read off disk is cleaned and capped',
        chatMod.chatThread([{ role: 'user', text: 'a' }, null, 'x', { role: 'junk', text: 'b' }]).length === 1
        && chatMod.chatThread(Array.from({ length: 300 }, function (x, i) { return { role: 'user', text: 'm' + i }; })).length === chatMod.CHAT_KEEP);
    ok('push keeps the cap and never mutates the thread it was handed',
        (function () {
            const base = [{ role: 'user', text: 'a' }];
            const out = chatMod.chatPush(base, { role: 'assistant', text: 'b' });
            return base.length === 1 && out.length === 2;
        })());
    // What travels to the model: the system line first, then the NEWEST turns
    // that fit — cutting the start loses old context, cutting the end would
    // lose the question just asked.
    const long = Array.from({ length: 40 }, function (x, i) { return { role: i % 2 ? 'assistant' : 'user', text: 'turn ' + i }; });
    const forModel = chatMod.chatForModel(long, 'George');
    ok('the model gets the system line first, then the newest turns',
        forModel[0].role === 'system'
        && forModel.length === chatMod.CHAT_SEND_MAX + 1
        && forModel[forModel.length - 1].content === 'turn 39'
        && forModel[1].content === 'turn ' + (40 - chatMod.CHAT_SEND_MAX),
        forModel.length + ' msgs, last: ' + forModel[forModel.length - 1].content);
    ok('…and the character budget trims from the OLD end too',
        (function () {
            // NB each message is already capped at CHAT_MSG_CHARS on the way
            // in, so exceeding the SEND budget takes several fat messages —
            // the first fixture used one 11,000-char message, which the
            // per-message cap shrank until it fit, proving nothing.
            const fat = [
                { role: 'user', text: 'old '.repeat(1750) + 'FIRST' },
                { role: 'user', text: 'mid '.repeat(1750) + 'SECOND' },
                { role: 'user', text: 'the question' },
            ];
            const m = chatMod.chatForModel(fat, '');
            return m.length === 3
                && m[m.length - 1].content === 'the question'
                && /SECOND/.test(m[1].content)
                && !m.some(function (x) { return /FIRST/.test(x.content); });
        })());

    // engine.chat: the request is shaped and checked at the engine boundary,
    // whatever the caller sent — and write() is one message through the same
    // door, so the two cannot drift.
    {
        const engMod = require('../src/core/engine.js');
        const posts30 = [];
        const eng = engMod.makeEngine({ id: 'llamacpp', post: async function (u, b) {
            posts30.push(b);
            return { ok: true, status: 200, json: { choices: [{ message: { content: 'a reply' } }], usage: { completion_tokens: 5 } } };
        } });
        const r1 = await eng.chat([
            { role: 'system', content: 's' },
            { role: 'user', content: 'q' },
            { role: 'tool', content: 'never' },
            { role: 'assistant', content: '   ' },
        ], 'm.gguf');
        ok('chat passes system+user+assistant through and drops the rest',
            r1.ok && posts30[0].messages.map(function (m) { return m.role; }).join(',') === 'system,user',
            JSON.stringify(posts30[0].messages));
        const r2 = await eng.chat([{ role: 'assistant', content: 'only me' }], 'm');
        ok('a thread with no user message is refused before any network', !r2.ok && posts30.length === 1, r2.say);
        await eng.write('hello', 'm.gguf');
        ok('write() is one message through the same door',
            posts30[1].messages.length === 1 && posts30[1].messages[0].role === 'user' && posts30[1].messages[0].content === 'hello');
        // The grammar rides the REAL request body when asked for, and an empty
        // one never travels — §31's loop uses a fake engine, so this is the
        // only check on the wiring itself.
        await eng.chat([{ role: 'user', content: 'q' }], 'm', { grammar: 'root ::= "x"' });
        await eng.chat([{ role: 'user', content: 'q' }], 'm', { grammar: '' });
        ok('a GBNF grammar reaches the wire only when non-empty',
            posts30[2].grammar === 'root ::= "x"' && !('grammar' in posts30[3]),
            JSON.stringify([posts30[2].grammar, posts30[3].grammar]));
    }

    // ── §31 THE CHAT'S TOOLS — it looks things up, and only looks ───────────
    console.log('\n§31 the chat’s tools');
    const tMod = require('../src/core/chattools.js');
    ok('the intro names every tool and — load-bearing — today’s date',
        tMod.CHAT_TOOL_NAMES.every(function (n) { return tMod.chatToolsIntro('2026-08-19').indexOf(n) >= 0; })
        && /Today is 2026-08-19/.test(tMod.chatToolsIntro('2026-08-19')));
    ok('a plain answer is not a tool call', tMod.chatToolCall('You have one arrival today.') === null
        && tMod.chatToolCall('Use the TOOL when you like.') === null
        && tMod.chatToolCall('') === null);
    ok('a call survives narration around it and prose after the JSON',
        (function () {
            const c = tMod.chatToolCall('Let me check.\nTOOL {"tool":"today","args":{}} — one moment.');
            return c && c.tool === 'today' && JSON.stringify(c.args) === '{}';
        })());
    ok('args are filtered to the declared keys and capped',
        (function () {
            const c = tMod.chatToolCall('TOOL {"tool":"bookings","args":{"name":"Sar","evil":"drop me","from":"' + 'x'.repeat(200) + '"}}');
            return c && c.tool === 'bookings' && c.args.name === 'Sar' && !('evil' in c.args)
                && c.args.from.length === tMod.CHAT_TOOL_ARG_MAX;
        })());
    ok('an unknown tool is a FUMBLE naming the real ones, never a silent answer',
        (tMod.chatToolCall('TOOL {"tool":"refund_everyone","args":{}}') || {}).bad !== undefined
        && /today, bookings, availability, enquiries/.test(tMod.chatToolCall('TOOL {"tool":"x","args":{}}').bad));
    ok('a required argument missing is a fumble; JSON that never closes is a fumble',
        /cottage|from|to/.test((tMod.chatToolCall('TOOL {"tool":"availability","args":{}}') || {}).bad || '')
        && (tMod.chatToolCall('TOOL {"tool":"today","args":{') || {}).bad !== undefined);
    ok('a result outgrowing its cap is CUT and says so',
        (function () {
            const m = tMod.chatToolResultMsg('bookings', { big: 'x'.repeat(9000) });
            return m.length < 9000 && /cut/.test(m) && /^TOOL RESULT bookings:/.test(m);
        })());
    ok('the retry grammar names every tool',
        tMod.CHAT_TOOL_NAMES.every(function (n) { return tMod.chatToolGrammar().indexOf('"' + n + '"') >= 0; })
        && /^root ::= /m.test(tMod.chatToolGrammar()));

    // The LOOP, through the real api with a scripted engine and a fake site.
    const mkChatApi = function (script, siteImpl, secretVal) {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chb-ct31-'));
        const calls = [];
        const toolCalls = [];
        const evs = [];
        const api31 = require('../src/core/api').makeApi({
            dir: tmp, machine: M16,
            push: function (ev) { evs.push(ev); },
            secrets: { available: true, get: function () { return secretVal; }, set: function () { return { ok: true }; }, state: function () { return { set: !!secretVal, hint: '' }; } },
            makeEngine: function () {
                return {
                    id: 'llamacpp', name: 'fake', base: 'http://x',
                    reachable: async function () { return true; },
                    // The loop streams now — the fake answers whole, which is a
                    // legal stream (one chunk); §32 drives the chunked form. A
                    // script item that is a FUNCTION owns its whole round
                    // (the stop case needs the abort signal in its hands).
                    props: async function () { return { ctx: 8192 }; },
                    chatStream: async function (msgs, model, opts, onEv) {
                        calls.push({ msgs: msgs, grammar: (opts && opts.grammar) || '' });
                        const item = script.shift();
                        if (typeof item === 'function') { return item(opts, onEv); }
                        const text = item || 'ran out';
                        if (onEv) { onEv({ token: text }); }
                        return { ok: true, stopped: false, text: text, think: '', ms: 5, tokens: 3, promptTokens: 100, tokensPerSec: 1 };
                    },
                };
            },
            makeSite: function () {
                return {
                    chatTool: async function (tool, args) {
                        toolCalls.push({ tool: tool, args: args });
                        return siteImpl ? siteImpl(tool, args) : { ok: true, data: { fact: 'one arrival: Sarah' } };
                    },
                };
            },
        });
        return { api: api31, calls: calls, toolCalls: toolCalls, evs: evs, tmp: tmp };
    };

    {
        // The happy loop: lookup → grounded answer; machinery never stored.
        const h = mkChatApi(['TOOL {"tool":"today","args":{}}', 'One arrival today: Sarah.'], null, 'k');
        await h.api.saveConfig({ chatModel: 'm.gguf', autoStart: false });
        const r = await h.api.chatSend('who arrives today?');
        ok('a lookup happens and the answer is the model’s SECOND turn',
            r.ok && r.reply === 'One arrival today: Sarah.'
            && h.toolCalls.length === 1 && h.toolCalls[0].tool === 'today', JSON.stringify(r));
        ok('…and the reply says what it looked up', JSON.stringify(r.used) === '["today"]');
        ok('the second turn READ the tool result',
            h.calls.length === 2 && h.calls[1].msgs.some(function (m) { return /TOOL RESULT today/.test(m.content) && /Sarah/.test(m.content); }));
        ok('the system content teaches the protocol and the date',
            /TOOL \{"tool"/.test(h.calls[0].msgs[0].content) && /Today is \d{4}-\d{2}-\d{2}/.test(h.calls[0].msgs[0].content));
        const hist = h.api.chatHistory();
        ok('the stored thread keeps the words, never the machinery',
            hist.thread.length === 2 && hist.thread[0].text === 'who arrives today?'
            && hist.thread[1].text === 'One arrival today: Sarah.'
            && !JSON.stringify(hist.thread).includes('TOOL'), JSON.stringify(hist.thread));
        try { fs.rmSync(h.tmp, { recursive: true, force: true }); } catch (e) {}
    }
    {
        // A fumbled call gets ONE grammar-constrained retry — and only that one.
        const h = mkChatApi([
            'TOOL {"tool":"nope","args":{}}',
            'TOOL {"tool":"availability","args":{"cottage":"Jollyboat","from":"2026-09-01","to":"2026-09-04"}}',
            'Free at £440.00.',
        ], function () { return { ok: true, data: { free: true, price: '£440.00' } }; }, 'k');
        await h.api.saveConfig({ chatModel: 'm.gguf', autoStart: false });
        const r = await h.api.chatSend('is jollyboat free 1-4 sept?');
        ok('the retry after a fumble is grammar-constrained, the others are free',
            r.ok && h.calls.length === 3
            && h.calls[0].grammar === '' && /root ::=/.test(h.calls[1].grammar) && h.calls[2].grammar === '',
            JSON.stringify(h.calls.map(function (c) { return !!c.grammar; })));
        ok('…and the constrained call reached the site with its args',
            h.toolCalls.length === 1 && h.toolCalls[0].tool === 'availability' && h.toolCalls[0].args.cottage === 'Jollyboat');
        try { fs.rmSync(h.tmp, { recursive: true, force: true }); } catch (e) {}
    }
    {
        // The lookup cap: a model that loops is walked to a sentence.
        const h = mkChatApi([
            'TOOL {"tool":"today","args":{}}', 'TOOL {"tool":"today","args":{}}',
            'TOOL {"tool":"today","args":{}}', 'TOOL {"tool":"today","args":{}}',
            'Right — one arrival, nothing else.',
        ], null, 'k');
        await h.api.saveConfig({ chatModel: 'm.gguf', autoStart: false });
        const r = await h.api.chatSend('busy day?');
        ok('lookups stop at ' + tMod.CHAT_TOOL_ROUNDS + ' and the loop ends at a sentence',
            r.ok && r.reply === 'Right — one arrival, nothing else.'
            && h.toolCalls.length === tMod.CHAT_TOOL_ROUNDS
            && h.calls.some(function (c) { return c.msgs.some(function (m) { return /No more lookups/.test(m.content); }); }),
            JSON.stringify({ tools: h.toolCalls.length, calls: h.calls.length }));
        try { fs.rmSync(h.tmp, { recursive: true, force: true }); } catch (e) {}
    }
    {
        // A refused lookup travels back as a RESULT — the send never dies on it.
        const h = mkChatApi([
            'TOOL {"tool":"enquiries","args":{}}',
            'I could not check — the website says overnight work is switched off.',
        ], function () { return { ok: false, refusal: { kind: 'off', say: 'Overnight work is switched off on the site.' } }; }, 'k');
        await h.api.saveConfig({ chatModel: 'm.gguf', autoStart: false });
        const r = await h.api.chatSend('anything waiting?');
        ok('a site refusal reaches the model in words and the answer still lands',
            r.ok && h.calls[1].msgs.some(function (m) { return /switched off/.test(m.content); }), JSON.stringify(r));
        try { fs.rmSync(h.tmp, { recursive: true, force: true }); } catch (e) {}
    }
    {
        // UNPAIRED = NO TOOLS. No protocol taught, no site call, and a
        // TOOL-shaped reply is just words.
        const h = mkChatApi(['TOOL {"tool":"today","args":{}}'], null, '');
        await h.api.saveConfig({ chatModel: 'm.gguf', autoStart: false });
        const r = await h.api.chatSend('hello');
        ok('an unpaired app teaches no protocol and calls no site',
            r.ok && h.toolCalls.length === 0 && h.calls.length === 1
            && !/TOOL \{"tool"/.test(h.calls[0].msgs[0].content)
            && r.reply === 'TOOL {"tool":"today","args":{}}'
            && JSON.stringify(r.used) === '[]', JSON.stringify(r));
        try { fs.rmSync(h.tmp, { recursive: true, force: true }); } catch (e) {}
    }

    // ── §32 THE CHAT, GROWN UP — streaming, thinking, conversations ─────────
    console.log('\n§32 the chat, grown up');

    // The store: v1's bare array is ADOPTED, garbage is absent, cur repairs.
    {
        const s = chatMod.chatStore([{ role: 'user', text: 'who owes me money' }, { role: 'assistant', text: 'Sarah.' }], 1000);
        ok('a v1 single-thread file adopts as one titled conversation',
            s.v === 2 && s.threads.length === 1 && s.threads[0].title === 'who owes me money'
            && s.threads[0].msgs.length === 2 && s.cur === s.threads[0].id, JSON.stringify(s));
        const g = chatMod.chatStore({ v: 2, cur: 'ghost', threads: [{ id: 'a', title: 'x', at: 1, msgs: [] }, 'junk', { noId: 1 }] }, 0);
        ok('garbage threads are absent and a dangling cur repairs to a real one',
            g.threads.length === 1 && g.cur === 'a');
        const many = chatMod.chatStore({ v: 2, cur: '', threads: Array.from({ length: 40 }, function (x, i) {
            return { id: 't' + i, title: 'chat ' + i, at: i, msgs: [] };
        }) }, 0);
        ok('the store caps at ' + chatMod.CHAT_THREADS_MAX + ' conversations',
            many.threads.length === chatMod.CHAT_THREADS_MAX);
        const n1 = chatMod.chatThreadNew(g, 'fresh', 5);
        ok('New chat reuses an existing EMPTY conversation rather than stacking blanks',
            n1.threads.length === 1 && n1.cur === 'a');
        ok('a title is the first line, capped with an ellipsis',
            chatMod.chatTitle('is jollyboat free\nsecond line') === 'is jollyboat free'
            && chatMod.chatTitle('x'.repeat(80)).length === chatMod.CHAT_TITLE_MAX
            && chatMod.chatTitle('   ') === 'New chat');
    }

    // Thinking vs answer — the whole-text split and the live splitter.
    ok('no tags → all answer; a closed block → both halves; unclosed → all thinking, NO answer',
        (function () {
            const a = chatMod.chatThinkSplit('Just an answer.');
            const b = chatMod.chatThinkSplit('<think>weighing the dates</think>Free that week.');
            const c = chatMod.chatThinkSplit('<think>half a thought');
            return a.think === '' && a.answer === 'Just an answer.'
                && b.think === 'weighing the dates' && b.answer === 'Free that week.'
                && c.think === 'half a thought' && c.answer === '';
        })());
    ok('a mid-answer <think> is text, not a block — only a LEADING tag opens one',
        (function () {
            const d = chatMod.chatThinkSplit('The <think> tag is how R1 marks it.');
            return d.think === '' && d.answer === 'The <think> tag is how R1 marks it.';
        })());
    ok('the live splitter routes across chunk-cut tags and holds back a possible prefix',
        (function () {
            const f = chatMod.chatThinkStream();
            let th = '';
            let an = '';
            ['<thi', 'nk>reaso', 'ning here', '</th', 'ink>The an', 'swer.'].forEach(function (c) {
                const o = f(c);
                th += o.think; an += o.answer;
            });
            return th === 'reasoning here' && an === 'The answer.';
        })());
    ok('…and plain text streams straight through as answer',
        (function () {
            const f = chatMod.chatThinkStream();
            let an = '';
            ['Hello', ' there', ', George.'].forEach(function (c) { an += f(c).answer; });
            return an === 'Hello there, George.';
        })());
    ok('a stored think never rides back to the model',
        (function () {
            const msgs = chatMod.chatForModel([{ role: 'assistant', text: 'Free.', think: 'SECRET REASONING' }, { role: 'user', text: 'sure?' }], '');
            return !JSON.stringify(msgs).includes('SECRET REASONING');
        })());

    // engine.chatStream against a scripted transport: delta routing, usage,
    // the grammar on the wire, and an abort that KEEPS the partial.
    {
        const engMod = require('../src/core/engine.js');
        let sent = null;
        const eng = engMod.makeEngine({ id: 'llamacpp', stream: async function (url, body, tms, signal, onDelta) {
            sent = body;
            onDelta({ content: 'One ', reasoning: '' });
            onDelta({ content: '', reasoning: 'hmm' });
            onDelta({ content: 'arrival.', reasoning: '' });
            return { ok: true, status: 200, usage: { completion_tokens: 4 } };
        } });
        const got = [];
        const r = await eng.chatStream([{ role: 'user', content: 'q' }], 'm', { grammar: 'root ::= "x"' }, function (ev) { got.push(ev); });
        ok('chatStream routes content→token and reasoning_content→think, and returns the whole',
            r.ok && r.text === 'One arrival.' && r.think === 'hmm' && r.tokens === 4
            && got.some(function (e) { return e.token === 'One '; }) && got.some(function (e) { return e.think === 'hmm'; }),
            JSON.stringify({ r: r, got: got }));
        ok('…streaming and asks for a stream on the wire, grammar riding along',
            sent.stream === true && sent.grammar === 'root ::= "x"');
        const ctl = new AbortController();
        const eng2 = engMod.makeEngine({ id: 'llamacpp', stream: async function (u, b, t2, signal, onDelta) {
            onDelta({ content: 'Half an ans', reasoning: '' });
            ctl.abort();
            const err = new Error('aborted');
            err.name = 'AbortError';
            throw err;
        } });
        const r2 = await eng2.chatStream([{ role: 'user', content: 'q' }], 'm', { signal: ctl.signal });
        ok('an abort is a DECISION: ok:true, stopped:true, the partial kept',
            r2.ok && r2.stopped === true && r2.text === 'Half an ans', JSON.stringify(r2));
    }

    // The api end to end: events, thinking stored but never resent, stop,
    // regenerate, edit, and conversations.
    {
        // A reasoning model that thinks, then looks something up, then answers.
        const h = mkChatApi([
            '<think>the calendar knows, not me</think>TOOL {"tool":"today","args":{}}',
            '<think>one arrival then</think>Sarah arrives today.',
        ], null, 'k');
        await h.api.saveConfig({ chatModel: 'm.gguf', autoStart: false });
        const r = await h.api.chatSend('who arrives today?');
        ok('the window hears the whole story in order — and the ANSWER outlives the lookup',
            (function () {
                // NB a tool round's own text streams as tok BEFORE the round is
                // recognised as a call — by design, the window holds back a
                // TOOL-prefixed round — so the ordering asserted here is the
                // meaningful one: thinking heard, the lookup bracketed, a fresh
                // round opened after it, the LAST answer token after the
                // lookup, done last.
                const kinds = h.evs.map(function (e) { return e.t; });
                const idx = function (k) { return kinds.indexOf(k); };
                return idx('start') === 0 && idx('think') > idx('start')
                    && idx('tool') > idx('start') && idx('tool_done') > idx('tool')
                    && kinds.lastIndexOf('round') > idx('tool_done')
                    && kinds.lastIndexOf('tok') > idx('tool_done')
                    && kinds[kinds.length - 1] === 'done';
            })(), JSON.stringify(h.evs.map(function (e) { return e.t; })));
        ok('the reply is the answer half; the thinking is carried beside it, never inside it',
            r.ok && r.reply === 'Sarah arrives today.' && /calendar knows/.test(r.think) && /one arrival/.test(r.think));
        const hist = h.api.chatHistory();
        ok('the stored reply keeps its thinking and its lookups for the fold and the chip',
            hist.thread.length === 2 && /one arrival/.test(hist.thread[1].think || '')
            && JSON.stringify(hist.thread[1].used) === '["today"]', JSON.stringify(hist.thread[1]));
        ok('…and the conversation titled itself from the question',
            hist.threads[0].title === 'who arrives today?', JSON.stringify(hist.threads));
        // REGENERATE: the last reply goes, the question is asked again ONCE.
        h.evs.length = 0;
        // (script is empty — refill through the closure by pushing more turns)
        const r2 = await h.api.chatRegen();
        ok('regenerate re-asks without duplicating the question',
            r2.ok && h.api.chatHistory().thread.length === 2
            && h.api.chatHistory().thread.filter(function (m) { return m.role === 'user'; }).length === 1,
            JSON.stringify(h.api.chatHistory().thread));
        // EDIT: truncate hands the words back and the thread forgets from there.
        const tr = h.api.chatTruncate(0);
        ok('edit returns the words and truncates; an assistant turn is refused',
            tr.ok && tr.text === 'who arrives today?' && h.api.chatHistory().thread.length === 0
            && h.api.chatTruncate(0).ok === false);
        try { fs.rmSync(h.tmp, { recursive: true, force: true }); } catch (e) {}
    }
    {
        // STOP, both ways: mid-answer keeps what was said; before any answer
        // stores nothing — the question stays askable.
        const h = mkChatApi([
            function (opts, onEv) {
                onEv({ token: 'Half an answer' });
                return new Promise(function (resolve) {
                    setTimeout(function () {
                        resolve({ ok: true, stopped: opts.signal.aborted, text: 'Half an answer', think: '', ms: 9, tokens: 0, tokensPerSec: null });
                    }, 30);
                });
            },
            function (opts, onEv) {
                return new Promise(function (resolve) {
                    setTimeout(function () {
                        resolve({ ok: true, stopped: opts.signal.aborted, text: '', think: 'only got as far as thinking', ms: 9, tokens: 0, tokensPerSec: null });
                    }, 30);
                });
            },
        ], null, '');
        await h.api.saveConfig({ chatModel: 'm.gguf', autoStart: false });
        const p1 = h.api.chatSend('long question');
        await new Promise(function (res) { setTimeout(res, 10); });
        h.api.chatStop();
        const r1 = await p1;
        ok('Stop mid-answer keeps the partial as the reply',
            r1.ok && r1.stopped === true && r1.reply === 'Half an answer'
            && h.api.chatHistory().thread[1].text === 'Half an answer', JSON.stringify(r1));
        const p2 = h.api.chatSend('another question');
        await new Promise(function (res) { setTimeout(res, 10); });
        h.api.chatStop();
        const r2 = await p2;
        ok('Stop before any answer stores NO reply — the question stays askable',
            r2.ok && r2.stopped === true && r2.reply === ''
            && h.api.chatHistory().thread[h.api.chatHistory().thread.length - 1].role === 'user',
            JSON.stringify(h.api.chatHistory().thread));
        try { fs.rmSync(h.tmp, { recursive: true, force: true }); } catch (e) {}
    }
    {
        // CONVERSATIONS through the api: new, auto-title, pick, delete.
        const h = mkChatApi(['First answer.', 'Second answer.'], null, '');
        await h.api.saveConfig({ chatModel: 'm.gguf', autoStart: false });
        await h.api.chatSend('plan the changeover');
        const before = h.api.chatHistory();
        h.api.chatNew();
        await h.api.chatSend('a different question');
        const two = h.api.chatHistory();
        ok('a second conversation lives beside the first, each with its own title',
            two.threads.length === 2 && two.threads.map(function (t) { return t.title; }).sort().join('|')
                === 'a different question|plan the changeover', JSON.stringify(two.threads));
        const picked = h.api.chatPick(before.cur);
        ok('picking a conversation brings ITS messages back',
            picked.cur === before.cur && picked.thread[0].text === 'plan the changeover');
        const del = h.api.chatDelete(before.cur);
        ok('deleting one repairs the pointer to a real survivor',
            del.threads.length === 1 && del.cur === del.threads[0].id
            && del.thread[0].text === 'a different question');
        try { fs.rmSync(h.tmp, { recursive: true, force: true }); } catch (e) {}
    }

    // ── §33 ROOM TO THINK — the meter, instructions, attach, export ─────────
    console.log('\n§33 room to think');

    // Attachments: refused over the cap in a sentence, fenced when they fit.
    ok('an empty file, a binary file and an oversize file are each refused in words',
        /empty/.test(chatMod.chatAttachProblem(''))
        && /text file/.test(chatMod.chatAttachProblem('bin' + String.fromCharCode(0) + 'ary'))
        && /too big/.test(chatMod.chatAttachProblem('x'.repeat(chatMod.CHAT_ATTACH_CHARS + 1)))
        && chatMod.chatAttachProblem('cleaner notes: key safe stiff') === '');
    ok('the attachment joins the USER turn fenced, name and all',
        (function () {
            const m = chatMod.chatAttachMsg('what needs doing?', 'notes.txt', 'fix the tap');
            return /^what needs doing\?/.test(m) && /--- attached file: notes\.txt ---/.test(m)
                && /fix the tap/.test(m) && /--- end of notes\.txt ---/.test(m);
        })());
    ok('a message keeps its file NAME for the chip; garbage names are absent',
        chatMod.chatMsg({ role: 'user', text: 'q', file: 'notes.txt' }).file === 'notes.txt'
        && !('file' in chatMod.chatMsg({ role: 'user', text: 'q', file: '   ' })));

    // The export: a document, with thinking quoted and lookups noted.
    ok('the export is a Markdown document — title, roles, thinking as quotes, lookups noted',
        (function () {
            const md = chatMod.chatExportMd([
                { role: 'user', text: 'who arrives?', at: '14:22' },
                { role: 'assistant', text: 'Sarah does.', think: 'checking the day', used: ['today'] },
            ], 'who arrives?', 'George');
            return /^# who arrives\?/.test(md) && /## George · 14:22/.test(md)
                && /## The model/.test(md) && /> checking the day/.test(md)
                && /\*Checked the website: today\*/.test(md) && /Sarah does\./.test(md);
        })());

    // Instructions live on the thread, capped, cleared by emptiness.
    ok('the store keeps a thread’s instruction, capped; junk is absent',
        (function () {
            const st = chatMod.chatStore({ v: 2, cur: 'a', threads: [
                { id: 'a', title: 'x', at: 1, msgs: [], instr: '  two sentences  ' },
                { id: 'b', title: 'y', at: 1, msgs: [], instr: 'z'.repeat(900) },
                { id: 'c', title: 'w', at: 1, msgs: [], instr: 42 },
            ] }, 0);
            return st.threads[0].instr === 'two sentences'
                && st.threads[1].instr.length === chatMod.CHAT_INSTR_CHARS
                && !('instr' in st.threads[2]);
        })());

    // The engine's props: measured or zero, never a guess.
    {
        const engMod = require('../src/core/engine.js');
        const e1 = engMod.makeEngine({ id: 'llamacpp', get: async function () {
            return { ok: true, status: 200, json: { default_generation_settings: { n_ctx: 8192 } } };
        } });
        const e2 = engMod.makeEngine({ id: 'llamacpp', get: async function () {
            return { ok: true, status: 200, json: { some: 'other shape' } };
        } });
        ok('props reads n_ctx from llama.cpp and answers 0 for an engine that does not report',
            (await e1.props()).ctx === 8192 && (await e2.props()).ctx === 0);
        // VISION IS MEASURED, NEVER GUESSED: only llama.cpp's own explicit
        // modalities.vision === true counts — an older build that reports
        // nothing is a text engine, and the chat says so instead of bluffing.
        const e3 = engMod.makeEngine({ id: 'llamacpp', get: async function () {
            return { ok: true, status: 200, json: { n_ctx: 4096, modalities: { vision: true } } };
        } });
        ok('props reports vision only when the server SAYS so',
            (await e3.props()).vision === true && (await e1.props()).vision === false
            && (await e2.props()).vision === false);
        // A multimodal message (OpenAI content parts) passes the boundary
        // check whole; a malformed parts array kills the message outright —
        // half a multimodal message is not a smaller message.
        let sentBody = null;
        const e4 = engMod.makeEngine({ id: 'llamacpp', stream: async function (u, body) {
            sentBody = body;
            return { ok: true, status: 200, json: {}, usage: {} };
        } });
        await e4.chatStream([
            { role: 'user', content: [{ type: 'text', text: 'what is this?' }, { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,xx' } }] },
            { role: 'user', content: [{ type: 'bogus' }] },
        ], 'm', {}, function () {});
        ok('image parts travel to the engine whole, and a malformed parts message is dropped',
            sentBody && sentBody.messages.length === 1
            && Array.isArray(sentBody.messages[0].content)
            && sentBody.messages[0].content[1].image_url.url === 'data:image/jpeg;base64,xx',
            JSON.stringify(sentBody && sentBody.messages));
    }

    // Through the api: the instruction rides the system content, the meter's
    // numbers ride done, the trim is counted, the attachment travels fenced.
    {
        const h = mkChatApi(['Noted.', 'Second.'], null, '');
        await h.api.saveConfig({ chatModel: 'm.gguf', autoStart: false });
        h.api.chatInstr('Answer in one short sentence.');
        const r = await h.api.chatSend('hello');
        ok('the standing instruction joins the system content on every send',
            r.ok && /standing instruction for this conversation: Answer in one short sentence\./.test(h.calls[0].msgs[0].content),
            h.calls[0].msgs[0].content.slice(-120));
        ok('done carries the MEASURED meter numbers: the loaded window and what the turn occupied',
            (function () {
                const done = h.evs.filter(function (e) { return e.t === 'done'; })[0];
                return done && done.ctx === 8192 && done.ctxUsed === 103 && done.dropped === 0;
            })(), JSON.stringify(h.evs.filter(function (e) { return e.t === 'done'; })));
        ok('…and the history hands the instruction back for the box',
            h.api.chatHistory().instr === 'Answer in one short sentence.');
        h.api.chatInstr('   ');
        ok('an empty instruction CLEARS it — the way out is the way in',
            h.api.chatHistory().instr === '');
        // The attachment: refused over the cap at the door, fenced when it fits.
        const rBig = await h.api.chatSend('read this', { attach: { name: 'big.txt', text: 'x'.repeat(9000) } });
        ok('an oversize attachment is refused at the door in a sentence — nothing stored',
            rBig.ok === false && /too big/.test(rBig.say)
            && h.api.chatHistory().thread.filter(function (m) { return /read this/.test(m.text); }).length === 0);
        const rOk = await h.api.chatSend('what needs doing?', { attach: { name: 'notes.txt', text: 'fix the tap' } });
        const um = h.api.chatHistory().thread.filter(function (m) { return m.role === 'user'; }).pop();
        ok('a fitting attachment rides the user turn fenced, with the name kept for the chip',
            rOk.ok && um.file === 'notes.txt' && /--- attached file: notes\.txt ---/.test(um.text)
            && /fix the tap/.test(um.text), JSON.stringify(um).slice(0, 200));
        try { fs.rmSync(h.tmp, { recursive: true, force: true }); } catch (e) {}
    }
    {
        // The trim COUNT: a thread longer than the send budget reports how
        // many turns no longer travel — the number behind the honest line.
        const h = mkChatApi(Array.from({ length: 20 }, function (x, i) { return 'reply ' + i; }), null, '');
        await h.api.saveConfig({ chatModel: 'm.gguf', autoStart: false });
        for (let i = 0; i < 16; i++) {
            await h.api.chatSend('turn number ' + i);
        }
        const dones = h.evs.filter(function (e) { return e.t === 'done'; });
        const lastDone = dones[dones.length - 1];
        const nMsgs = h.api.chatHistory().thread.length;
        ok('a long thread reports how many stored turns no longer travel',
            nMsgs === 32 && lastDone.dropped === nMsgs - 1 - chatMod.CHAT_SEND_MAX
            && dones[0].dropped === 0,
            JSON.stringify({ msgs: nMsgs, dropped: lastDone.dropped }));
        try { fs.rmSync(h.tmp, { recursive: true, force: true }); } catch (e) {}
    }

    // Export through the api: a real document, an empty thread refused.
    {
        const h = mkChatApi(['An answer.'], null, '');
        await h.api.saveConfig({ chatModel: 'm.gguf', autoStart: false });
        await h.api.chatSend('plan the week');
        const cur = h.api.chatHistory().cur;
        const ex = h.api.chatExport(cur);
        ok('export hands back the document; an unknown or empty thread is refused',
            ex.ok && /plan the week/.test(ex.md) && /An answer\./.test(ex.md)
            && h.api.chatExport('ghost').ok === false);
        try { fs.rmSync(h.tmp, { recursive: true, force: true }); } catch (e) {}
    }

    // ── §34 THE WEB CHAT'S MAC HALF — the ask sweep runs the chat core ──────
    console.log('\n§34 the web chat’s Mac half');
    {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chb-ct34-'));
        const answers = [];
        const partials = [];
        let asksPayload = [{ id: 9, kind: 'ownerchat', ownerchat: {
            turns: [{ who: 'you', text: 'who arrives today?' }],
            instr: 'Answer in one short sentence.',
        } }];
        const api34 = require('../src/core/api').makeApi({
            dir: tmp, machine: M16,
            secrets: { available: true, get: function () { return 'k'; }, set: function () { return { ok: true }; }, state: function () { return { set: true, hint: '' }; } },
            makeEngine: function () {
                return {
                    id: 'llamacpp', name: 'fake', base: 'http://x',
                    reachable: async function () { return true; },
                    props: async function () { return { ctx: 4096 }; },
                    chatStream: async function (msgs, model, opts, onEv) {
                        // The busy case's LOCAL send holds the engine long
                        // enough for the sweep to genuinely arrive mid-send —
                        // an instant fake proved nothing (measured: the send
                        // finished before the sweep began, and the skip was
                        // never exercised).
                        if (/long local question/.test(msgs[msgs.length - 1].content)) {
                            await new Promise(function (r3) { setTimeout(r3, 60); });
                            return { ok: true, stopped: false, text: 'held answer', think: '', ms: 5, tokens: 2, promptTokens: 10, tokensPerSec: 1 };
                        }
                        // The web ask must carry the local chat's whole frame:
                        // system line + tool protocol + the standing instruction
                        // + the carried turn.
                        const sys = msgs[0].content;
                        if (!/one short sentence/.test(sys) || !/TOOL \{"tool"/.test(sys)) {
                            return { ok: true, stopped: false, text: 'FRAME MISSING', think: '', ms: 5, tokens: 2, promptTokens: 50, tokensPerSec: 1 };
                        }
                        onEv({ token: '<think>the calendar knows</think>**Sarah** arrives today.' });
                        return { ok: true, stopped: false, text: '<think>the calendar knows</think>**Sarah** arrives today.', think: '', ms: 5, tokens: 2, promptTokens: 50, tokensPerSec: 1 };
                    },
                };
            },
            makeSite: function () {
                return {
                    asks: async function () { return { ok: true, host: 'George', asks: asksPayload, warm: false }; },
                    answerAsk: async function (id, text, model) { answers.push({ id: id, text: text, model: model }); return { ok: true }; },
                    askPartial: async function (id, text) { partials.push({ id: id, text: text }); return { ok: true }; },
                    chatTool: async function () { return { ok: true, data: {} }; },
                };
            },
        });
        await api34.saveConfig({ chatModel: 'm.gguf', autoStart: false });
        const sw = await api34.askSweep();
        ok('the sweep answers a web-chat ask through the REAL chat core',
            sw.ok && sw.answered === 1 && answers.length === 1 && answers[0].id === 9
            && answers[0].model === 'm.gguf', JSON.stringify(sw));
        ok('…and the answer is the JSON envelope: words, real thinking, no invention',
            (function () {
                const j = JSON.parse(answers[0].text);
                return j.text === '**Sarah** arrives today.' && j.think === 'the calendar knows'
                    && Array.isArray(j.used);
            })(), answers[0].text);
        ok('the web ask never touches chats.json — the Mac’s own conversations stay its own',
            api34.chatHistory().thread.length === 0);
        // BUSY SKIP: the owner mid-send on the Mac itself → the ask stays
        // open (no answer, no failure) for the next sweep, seconds away.
        answers.length = 0;
        asksPayload = [{ id: 10, kind: 'ownerchat', ownerchat: { turns: [{ who: 'you', text: 'hi' }], instr: '' } }];
        // Hold the LOCAL chat open, then sweep into it.
        const held = new Promise(function (resolve) {
            api34.chatSend('long local question').then(resolve);
        });
        await new Promise(function (r2) { setTimeout(r2, 5); });
        const sw2 = await api34.askSweep();
        await held;
        ok('a sweep while the owner is mid-send SKIPS — the ask stays for the next pass',
            sw2.ok && sw2.answered === 0 && answers.length === 0, JSON.stringify(sw2));
        try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
    }
    {
        // PARTIALS: a long streamed reply posts the answer-so-far, throttled,
        // with the TOOL holdback applied — a lookup being typed never paints
        // on the phone either.
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chb-ct34b-'));
        const partials = [];
        let clockMs = 1000000;
        const api34b = require('../src/core/api').makeApi({
            dir: tmp, machine: M16,
            now: function () { return new Date(clockMs); },
            secrets: { available: true, get: function () { return 'k'; }, set: function () { return { ok: true }; }, state: function () { return { set: true, hint: '' }; } },
            makeEngine: function () {
                return {
                    id: 'llamacpp', name: 'fake', base: 'http://x',
                    reachable: async function () { return true; },
                    props: async function () { return { ctx: 4096 }; },
                    chatStream: async function (msgs, model, opts, onEv) {
                        if (msgs.some(function (m) { return /TOOL RESULT/.test(m.content); })) {
                            // Round two: the answer, streamed in pieces with the
                            // clock advancing so the throttle opens.
                            onEv({ token: 'One ' }); clockMs += 2000;
                            onEv({ token: 'arrival — ' }); clockMs += 2000;
                            onEv({ token: 'Sarah.' });
                            return { ok: true, stopped: false, text: 'One arrival — Sarah.', think: '', ms: 5, tokens: 2, promptTokens: 40, tokensPerSec: 1 };
                        }
                        // Round one: a tool call, streamed — held back.
                        onEv({ token: 'TOOL {"tool":"today","args":{}}' }); clockMs += 2000;
                        return { ok: true, stopped: false, text: 'TOOL {"tool":"today","args":{}}', think: '', ms: 5, tokens: 2, promptTokens: 40, tokensPerSec: 1 };
                    },
                };
            },
            makeSite: function () {
                return {
                    asks: async function () { return { ok: true, host: '', asks: [{ id: 11, kind: 'ownerchat', ownerchat: { turns: [{ who: 'you', text: 'busy day?' }], instr: '' } }], warm: false }; },
                    answerAsk: async function () { return { ok: true }; },
                    askPartial: async function (id, text) { partials.push(text); return { ok: true }; },
                    chatTool: async function () { return { ok: true, data: { arrivals: 1 } }; },
                };
            },
        });
        await api34b.saveConfig({ chatModel: 'm.gguf', autoStart: false });
        await api34b.askSweep();
        ok('partials stream to the site, throttled, and a TOOL round never paints',
            partials.length >= 1
            && partials.every(function (t) { return !/"text":"\s*TOOL/.test(t); })
            && partials.some(function (t) { return /One arrival/.test(JSON.parse(t).text) || /One /.test(JSON.parse(t).text); }),
            JSON.stringify(partials));
        try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
    }
    {
        // A PHOTO ON THE ASK — three honest outcomes, no fourth. The ref
        // rides the newest turn; whether the model ever MEETS the image is
        // decided by what the engine measures about itself, never assumed.
        const mk34c = function (vision, fileOk) {
            const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chb-ct34c-'));
            const rec = { answers: [], fetched: [], lastMsgs: null };
            const api = require('../src/core/api').makeApi({
                dir: tmp, machine: M16,
                secrets: { available: true, get: function () { return 'k'; }, set: function () { return { ok: true }; }, state: function () { return { set: true, hint: '' }; } },
                makeEngine: function () {
                    return {
                        id: 'llamacpp', name: 'fake', base: 'http://x',
                        reachable: async function () { return true; },
                        props: async function () { return { ctx: 4096, vision: vision }; },
                        chatStream: async function (msgs) {
                            rec.lastMsgs = msgs;
                            return { ok: true, stopped: false, text: 'A weeping compression joint.', think: '', ms: 5, tokens: 2, promptTokens: 40, tokensPerSec: 1 };
                        },
                    };
                },
                makeSite: function () {
                    return {
                        asks: async function () {
                            return { ok: true, host: '', warm: false, asks: [{ id: 21, kind: 'ownerchat', ownerchat: {
                                turns: [{ who: 'you', text: 'what is wrong here?', img: 'uploads/chat-photo-0123456789ab.jpg' }],
                                instr: '',
                            } }] };
                        },
                        answerAsk: async function (id, text, model) { rec.answers.push({ id: id, text: text, model: model }); return { ok: true }; },
                        askPartial: async function () { return { ok: true }; },
                        chatTool: async function () { return { ok: true, data: {} }; },
                        chatFile: async function (ref) {
                            rec.fetched.push(ref);
                            return fileOk ? { ok: true, dataUri: 'data:image/jpeg;base64,QQ==' } : { ok: false };
                        },
                    };
                },
            });
            return { api: api, rec: rec, tmp: tmp };
        };
        // Vision available: the bytes are fetched and the image joins the
        // newest turn as content parts — the model actually SEES the photo.
        const hV = mk34c(true, true);
        await hV.api.saveConfig({ chatModel: 'm.gguf', autoStart: false });
        await hV.api.askSweep();
        const seenMsg = hV.rec.lastMsgs && hV.rec.lastMsgs[hV.rec.lastMsgs.length - 1];
        ok('with a vision engine the photo is fetched by ref and joins the turn as image parts',
            hV.rec.fetched[0] === 'uploads/chat-photo-0123456789ab.jpg'
            && seenMsg && Array.isArray(seenMsg.content)
            && seenMsg.content.some(function (p) { return p.type === 'image_url' && p.image_url.url === 'data:image/jpeg;base64,QQ=='; })
            && JSON.parse(hV.rec.answers[0].text).text === 'A weeping compression joint.',
            JSON.stringify(seenMsg && seenMsg.content));
        try { fs.rmSync(hV.tmp, { recursive: true, force: true }); } catch (e) {}
        // Text-only engine: the model NEVER meets the photo (no fetch, no
        // parts) and the thread carries the honest refusal, not a bluff.
        const hT = mk34c(false, true);
        await hT.api.saveConfig({ chatModel: 'm.gguf', autoStart: false });
        await hT.api.askSweep();
        ok('a text-only engine answers the honest no-vision sentence and the model never meets the photo',
            hT.rec.fetched.length === 0 && hT.rec.lastMsgs === null
            && /can’t see pictures/.test(JSON.parse(hT.rec.answers[0].text).text),
            JSON.stringify(hT.rec.answers));
        try { fs.rmSync(hT.tmp, { recursive: true, force: true }); } catch (e) {}
        // A fetch that fails is said plainly — never answered around.
        const hF = mk34c(true, false);
        await hF.api.saveConfig({ chatModel: 'm.gguf', autoStart: false });
        await hF.api.askSweep();
        ok('a photo that will not fetch is answered honestly, and the model is never run without it',
            hF.rec.lastMsgs === null
            && /couldn’t fetch that photo/.test(JSON.parse(hF.rec.answers[0].text).text),
            JSON.stringify(hF.rec.answers));
        try { fs.rmSync(hF.tmp, { recursive: true, force: true }); } catch (e) {}
    }
    {
        // THE OWNER'S ■ REACHES THE MODEL: ask_partial answering held:false
        // aborts the generation mid-stream through the local Stop's own
        // signal path, and the remainder is never posted — the row is
        // already expired at the site, so an answer would only be refused.
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chb-ct34d-'));
        const rec = { answers: [], partials: 0, sawAbort: false };
        let clockMs = 5000000;
        const api34d = require('../src/core/api').makeApi({
            dir: tmp, machine: M16,
            now: function () { return new Date(clockMs); },
            secrets: { available: true, get: function () { return 'k'; }, set: function () { return { ok: true }; }, state: function () { return { set: true, hint: '' }; } },
            makeEngine: function () {
                return {
                    id: 'llamacpp', name: 'fake', base: 'http://x',
                    reachable: async function () { return true; },
                    props: async function () { return { ctx: 4096 }; },
                    chatStream: async function (msgs, model, opts, onEv) {
                        // Stream a few words with the clock advancing so the
                        // partial throttle opens, then WAIT so the abort (a
                        // microtask behind the partial's promise) can land.
                        onEv({ token: 'The weekend ' }); clockMs += 2000;
                        onEv({ token: 'looks ' }); clockMs += 2000;
                        await new Promise(function (r3) { setTimeout(r3, 30); });
                        if (opts.signal && opts.signal.aborted) {
                            rec.sawAbort = true;
                            return { ok: true, stopped: true, text: 'The weekend looks', think: '', ms: 5, tokens: 2, tokensPerSec: null };
                        }
                        return { ok: true, stopped: false, text: 'The weekend looks quiet.', think: '', ms: 5, tokens: 3, promptTokens: 20, tokensPerSec: 1 };
                    },
                };
            },
            makeSite: function () {
                return {
                    asks: async function () {
                        return { ok: true, host: '', warm: false, asks: [{ id: 31, kind: 'ownerchat', ownerchat: {
                            turns: [{ who: 'you', text: 'busy weekend?' }], instr: '',
                        } }] };
                    },
                    answerAsk: async function (id, text, model) { rec.answers.push(text); return { ok: true }; },
                    askPartial: async function () { rec.partials++; return { ok: true, held: false }; },
                    chatTool: async function () { return { ok: true, data: {} }; },
                };
            },
        });
        await api34d.saveConfig({ chatModel: 'm.gguf', autoStart: false });
        const swS = await api34d.askSweep();
        ok('held:false on a partial ABORTS the generation and nothing more is posted',
            rec.partials >= 1 && rec.sawAbort && rec.answers.length === 0
            && swS.ok && swS.answered === 0 && (swS.failed || 0) === 0,
            JSON.stringify({ partials: rec.partials, abort: rec.sawAbort, answers: rec.answers.length, sw: swS }));
        try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
    }

    console.log('\n== Summary ==');
    if (fails) {
        console.log('  ' + fails + ' of ' + (fails + passes) + ' CHECK(S) FAILED ❌\n');
        process.exit(1);
    }
    console.log('  ALL ' + passes + ' CHECKS PASSED ✅\n');
})().catch(function (e) {
    console.error('\nharness error:', e && e.stack ? e.stack : e);
    process.exit(1);
});
