// ============================================================
//  jobs.js — the work itself.
//
//  One job is implemented: DRAFT ENQUIRY REPLIES. That is deliberate and it is
//  the plan's own order — it is the highest-value job and the honest test of
//  whether any of this earns its keep, so it ships first and alone. The others
//  are declared below with `built: false` so the window can show the shape of
//  the thing without pretending.
//
//  A job's contract is narrow on purpose:
//     run(ctx) → { items: [...], log: [...] }
//  It may read the brief, ask the engine for prose, and return DRAFTS. It may
//  not send, charge, publish or write anything. Everything it returns goes
//  through the site's own validation and lands in a queue the owner reads.
//
//  Every draft passes guard.checkDraft before it is returned. A draft that
//  fails is DROPPED with its reason in the log — never repaired, because
//  repairing it would mean this app writing text of its own.
// ============================================================
'use strict';
const guard = require('./guard');
const { makeRef } = require('./site');

// The registry the Jobs screen renders. `built` is the honest flag; a job that
// is not built cannot be switched on.
const JOBS = [
    {
        id: 'reply',
        name: 'Draft enquiry replies',
        what: 'Reads the enquiries waiting on the site and writes a reply for each, for you to read and send.',
        kind: 'reply',
        schedule: 'nightly',
        built: true,
    },
    {
        id: 'answer',
        name: 'Answer the questions guests keep asking',
        what: 'Turns the questions the site could not answer into answers written from that cottage’s own content.',
        kind: 'answer',
        schedule: 'weekly-sun',
        built: true,
    },
    {
        id: 'week',
        name: 'Read the week',
        what: 'Reads the week ahead — arrivals, departures, gaps, money still to collect — and writes the Monday-morning note.',
        kind: 'note',
        schedule: 'weekly-mon',
        built: true,
    },
    {
        id: 'price',
        name: 'Price the fortnight',
        what: 'Weighs the gaps the site found, at the site’s own suggested prices — the case for each, for you to decide.',
        kind: 'price',
        schedule: 'weekly-mon',
        built: true,
    },
    {
        id: 'voice',
        name: 'Transcribe a walk-round',
        what: 'Turns a voice memo into maintenance items and a shopping list. Needs a speech model, not a chat one — not built.',
        kind: 'note',
        schedule: 'ondemand',
        built: false,
    },
];

function jobById(id) {
    for (let i = 0; i < JOBS.length; i++) {
        if (JOBS[i].id === id) {
            return JOBS[i];
        }
    }
    return null;
}

// The title and sub-line the owner sees on the card. Kept here beside the
// drafting so the words and the work stay together, and short enough that the
// site's own caps are never the thing that truncates them.
function replyTitle(f) {
    return 'Reply to ' + (f.name || 'an enquiry');
}
function replySub(f) {
    const bits = [];
    if (f.cottage) bits.push(f.cottage);
    if (f.check_in) bits.push(spokenRange(f.check_in, f.check_out));
    const party = guard.partyWords(f.adults, f.children);
    if (party) bits.push(party);
    return bits.join(' · ');
}
// "12–19 Oct" / "28 Dec – 3 Jan". Display only; the site owns every real date.
function spokenRange(a, b) {
    const A = parseIso(a);
    const B = parseIso(b);
    if (!A || !B) {
        return '';
    }
    const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    if (A.m === B.m) {
        return A.d + '–' + B.d + ' ' + M[A.m];
    }
    return A.d + ' ' + M[A.m] + ' – ' + B.d + ' ' + M[B.m];
}
function parseIso(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ''));
    if (!m) {
        return null;
    }
    return { y: +m[1], m: +m[2] - 1, d: +m[3] };
}

// ── THE REPLY JOB ────────────────────────────────────────────────────────
// ctx: { site, engine, model, host, now, enquiries, onProgress }
async function runReplyJob(ctx) {
    const log = [];
    const items = [];
    const c = ctx || {};
    const enquiries = Array.isArray(c.enquiries) ? c.enquiries : [];
    const day = require('./site').today(c.now);
    const say = function (line, level) {
        log.push({ at: stamp(), say: line, level: level || 'info' });
    };

    if (!enquiries.length) {
        say('nothing waiting — nothing to do');
        return { items: items, log: log };
    }
    say(enquiries.length + ' enquir' + (enquiries.length === 1 ? 'y' : 'ies') + ' waiting');

    for (let i = 0; i < enquiries.length; i++) {
        const f = enquiries[i];
        const who = (f.first || f.name || 'someone');

        // WHAT IS NOT WORTH DRAFTING. Skipping is a first-class outcome and it
        // is logged with its reason — a job that only reports its wins teaches
        // the owner to trust the ones it should have flagged.
        if (!String(f.message || '').trim()) {
            say(who + ' · skipped: no message to answer', 'skip');
            continue;
        }
        // (There was a second skip here for "dates gone and nothing asked". It
        // tested for an EMPTY message, which the branch above has already
        // continued on — so it could never run, and its log line could never
        // appear. Removed rather than guessed at.)

        const facts = Object.assign({}, f, { party: guard.partyWords(f.adults, f.children) });
        const prompt = guard.buildPrompt(facts, c.host);
        if (c.onProgress) {
            try { c.onProgress({ i: i, of: enquiries.length, who: who }); } catch (e) { /* display only */ }
        }
        const r = await c.engine.write(prompt, c.model);
        if (!r.ok) {
            say(who + ' · ' + r.say, 'fail');
            continue;
        }

        // THE GUARD. A draft that breaks a rule is dropped, named and not sent
        // anywhere. This is the line the whole app is built to hold.
        const v = guard.checkDraft(r.text, facts);
        if (!v.ok) {
            say(who + ' · refused own draft: ' + v.problems.join('; '), 'fail');
            continue;
        }

        items.push({
            ref: makeRef('reply', f.id, day),
            kind: 'reply',
            title: replyTitle(f),
            sub: replySub(f),
            body: r.text,
            source: sourceLine(f),
            // The screen the owner lands on when they tap Open it. The site
            // validates this against what its own router can open.
            target: f.id ? 'enquiry-' + f.id : '',
        });
        say(who + ' · ' + (f.cottage || '') + ' · drafted in ' + Math.round(r.ms / 100) / 10 + 's'
            + (r.tokensPerSec ? ' · ' + r.tokensPerSec + ' tok/s' : ''), 'hit');
    }
    return { items: items, log: log };
}

// What it was written FROM, in the owner's words. It appears above the draft on
// the card, and it is how approving takes ten seconds instead of two minutes.
function sourceLine(f) {
    const bits = ['their enquiry'];
    if (f.dates_free === true || f.dates_free === false) {
        bits.push('the site’s own calendar');
    }
    if (f.quote) {
        bits.push('the site’s own price');
    }
    if ((f.facts || []).length) {
        bits.push('the ' + (f.cottage || 'cottage') + ' answers');
    }
    return bits.join(', ');
}

// THE REAL CLOCK, not the start time plus a line count.
//
// It was `now + n seconds`, which made the stamps a function of how many lines
// had been written rather than of when anything happened: a run that took
// twenty minutes stamped every line inside the same minute, directly beside a
// "drafted in 4.1s" that contradicted it. `now` is still the record's own
// `started` stamp, which is the one a test pins; these are wall-clock.
function stamp() {
    const d = new Date();
    const p = function (v) { return String(v).padStart(2, '0'); };
    return p(d.getHours()) + ':' + p(d.getMinutes());
}


// ── THE WEEK JOB. One note, Monday mornings. ────────────────────────────
// ctx: { engine, model, host, now, week, gaps, onProgress }
async function runWeekJob(ctx) {
    const log = [];
    const items = [];
    const c = ctx || {};
    const say = function (line, level) { log.push({ at: stamp(), say: line, level: level || 'info' }); };
    // ABSENT is "this site does not hand it over" — an older website. Honest
    // and loud, because a weekly job silently doing nothing is the quiet-Mac
    // failure all over again.
    if (!c.week || typeof c.week !== 'object') {
        say('the site did not hand over the week — update the website to use this job', 'fail');
        return { items: items, log: log };
    }
    const w = Object.assign({}, c.week, { gaps: Array.isArray(c.gaps) ? c.gaps : [] });
    (w.arrivals || []).forEach(function (a) { a.party = guard.partyWords(a.adults, a.children); });
    const day = require('./site').today(c.now);
    const r = await c.engine.write(guard.buildWeekPrompt(w, c.host), c.model);
    if (!r.ok) {
        say('the week note · ' + r.say, 'fail');
        return { items: items, log: log };
    }
    // Every figure the site handed over is fair game and nothing else is.
    const v = guard.checkGeneral(r.text, { money: guard.moneyInFacts(w) });
    if (!v.ok) {
        say('refused own week note: ' + v.problems.join('; '), 'fail');
        return { items: items, log: log };
    }
    const nA = (w.arrivals || []).length;
    const nD = (w.departures || []).length;
    items.push({
        ref: makeRef('note', 'week', day),
        kind: 'note',
        title: 'The week ahead',
        sub: nA + ' arrival' + (nA === 1 ? '' : 's') + ' · ' + nD + ' departure' + (nD === 1 ? '' : 's')
            + (w.gaps.length ? ' · ' + w.gaps.length + ' gap' + (w.gaps.length === 1 ? '' : 's') : ''),
        body: r.text,
        source: 'the site’s own calendar and ledger',
        target: 'view-backoffice',
    });
    say('the week note · drafted in ' + Math.round(r.ms / 100) / 10 + 's', 'hit');
    return { items: items, log: log };
}

// ── THE PRICE JOB. The case for each gap, at the site's own figures. ─────
// ctx: { engine, model, host, now, gaps, onProgress }
async function runPriceJob(ctx) {
    const log = [];
    const items = [];
    const c = ctx || {};
    const say = function (line, level) { log.push({ at: stamp(), say: line, level: level || 'info' }); };
    if (!Array.isArray(c.gaps)) {
        say('the site did not hand over its gaps — update the website to use this job', 'fail');
        return { items: items, log: log };
    }
    if (!c.gaps.length) {
        // A quiet fortnight is a SUCCESS, the same rule as a quiet night.
        say('no gaps worth selling — nothing to weigh');
        return { items: items, log: log };
    }
    const day = require('./site').today(c.now);
    const r = await c.engine.write(guard.buildPricePrompt(c.gaps, c.host), c.model);
    if (!r.ok) {
        say('the price note · ' + r.say, 'fail');
        return { items: items, log: log };
    }
    const v = guard.checkGeneral(r.text, { money: guard.moneyInFacts(c.gaps) });
    if (!v.ok) {
        say('refused own price note: ' + v.problems.join('; '), 'fail');
        return { items: items, log: log };
    }
    items.push({
        ref: makeRef('price', 'fortnight', day),
        kind: 'price',
        title: c.gaps.length === 1 ? 'A gap worth a look' : c.gaps.length + ' gaps worth a look',
        sub: c.gaps.map(function (g) { return g.cottage; }).filter(function (v2, i, a) { return a.indexOf(v2) === i; }).join(', '),
        body: r.text,
        source: 'the site’s own calendar and its own rates',
        target: 'settings:pricing',
    });
    say('the price note · ' + c.gaps.length + ' gap' + (c.gaps.length === 1 ? '' : 's') + ' weighed in ' + Math.round(r.ms / 100) / 10 + 's', 'hit');
    return { items: items, log: log };
}

// ── THE ANSWER JOB. One drafted FAQ answer per question guests kept asking. ─
// ctx: { engine, model, host, now, questions, onProgress }
async function runAnswerJob(ctx) {
    const log = [];
    const items = [];
    const c = ctx || {};
    const say = function (line, level) { log.push({ at: stamp(), say: line, level: level || 'info' }); };
    if (!Array.isArray(c.questions)) {
        say('the site did not hand over the guest questions — update the website to use this job', 'fail');
        return { items: items, log: log };
    }
    if (!c.questions.length) {
        say('no unanswered guest questions — nothing to do');
        return { items: items, log: log };
    }
    const day = require('./site').today(c.now);
    for (let i = 0; i < c.questions.length; i++) {
        const q = c.questions[i];
        const r = await c.engine.write(guard.buildAnswerPrompt(q, c.host), c.model);
        if (!r.ok) {
            say('“' + shortQ(q.q) + '” · ' + r.say, 'fail');
            continue;
        }
        // NO money whitelist here at all: an FAQ answer has no business
        // quoting a figure, so every one is an invention by definition.
        const v = guard.checkGeneral(r.text, { money: [] });
        if (!v.ok) {
            say('refused own answer: ' + v.problems.join('; '), 'fail');
            continue;
        }
        items.push({
            // HASHED, not sliced: makeRef keeps 24 alphanumerics of a wordy id,
            // and two questions sharing their first words ("do you allow dogs
            // in the garden" / "…in the cottage") would collide into ONE ref —
            // the site's exactly-once rule would then silently drop the second
            // answer as a duplicate of the first.
            ref: makeRef('answer', qHash(q.q), day),
            kind: 'answer',
            title: 'An answer for “' + shortQ(q.q) + '”',
            sub: (q.cottage || 'the cottages') + ' · asked ' + (q.asked || 1) + ' time' + ((q.asked || 1) === 1 ? '' : 's'),
            body: r.text,
            source: 'guests’ own questions and the cottage’s published answers',
            // The screen where one tap turns a question into a live FAQ.
            target: 'settings:search-learning',
        });
        say('“' + shortQ(q.q) + '” · answered in ' + Math.round(r.ms / 100) / 10 + 's', 'hit');
    }
    return { items: items, log: log };
}

// djb2 over the normalised question — deterministic per night per question,
// which is what the exactly-once ref needs, and nothing more.
function qHash(q) {
    const s = String(q || '').toLowerCase().replace(/\s+/g, ' ').trim();
    let h = 5381;
    for (let i = 0; i < s.length; i++) {
        h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
    }
    return 'q' + h.toString(16);
}

function shortQ(q) {
    const s = String(q || '').trim();
    return s.length > 60 ? s.slice(0, 57) + '…' : s;
}

// ── WHICH JOBS RUN TONIGHT. Pure, so the schedule is testable on a pinned ──
// date. `weekly-mon` means the run whose LOCAL day is Monday — the 02:00 run
// into Monday morning, so the note greets the week it describes.
function jobsDueTonight(jobs, cfg, now) {
    const day = (now instanceof Date ? now : new Date()).getDay();
    const due = [];
    const waiting = [];
    (jobs || JOBS).forEach(function (j) {
        const conf = (cfg && cfg.jobs && cfg.jobs[j.id]) || {};
        if (!j.built || !conf.on) {
            return;
        }
        const match = j.schedule === 'nightly'
            || (j.schedule === 'weekly-sun' && day === 0)
            || (j.schedule === 'weekly-mon' && day === 1);
        if (match) {
            due.push({ job: j, model: String(conf.model || '') });
        } else if (j.schedule === 'weekly-sun' || j.schedule === 'weekly-mon') {
            waiting.push({ job: j, until: j.schedule === 'weekly-sun' ? 'Sunday' : 'Monday' });
        }
    });
    return { due: due, waiting: waiting };
}

module.exports = {
    JOBS, jobById, jobsDueTonight,
    runReplyJob, runWeekJob, runPriceJob, runAnswerJob,
    replyTitle, replySub, spokenRange, sourceLine,
};
