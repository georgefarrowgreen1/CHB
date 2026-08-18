// ============================================================
//  night.js — one night, start to finish, and the log it leaves behind.
//
//  The orchestrator. It reads the brief, runs the jobs that are switched on,
//  and posts what they wrote. Every branch ends in a LOG LINE, because the
//  night log is the only account of a thing that happens while nobody is
//  watching, and a run that fails silently is indistinguishable from one that
//  never fired.
//
//  Two rules that shape the whole file:
//
//   * IT NEVER PARTLY POSTS AND LOSES TRACK. The site's `ref` makes a retry
//     safe, so the failure this must not have is an UNCERTAIN post treated as a
//     failure and re-drafted tomorrow with a different ref. The refs are
//     deterministic per enquiry per day, so a lost reply resolves itself.
//
//   * A RUN THAT FINDS NOTHING IS A SUCCESS. Most nights there is nothing
//     waiting. That is logged as a quiet night, not an error, or the owner
//     learns to ignore the log.
//
//  The schedule maths is here too, because "when does it next run" is a fact
//  the window states and therefore wants one definition.
// ============================================================
'use strict';
const jobsMod = require('./jobs');
const { runReplyJob, jobById } = jobsMod;

const LOG_KEEP = 30; // nights

// ── WHEN ─────────────────────────────────────────────────────────────────
// The next occurrence of HH:MM strictly after `from`. Local time, because the
// owner set "02:00" meaning two in the morning where they are — and the run
// itself only cares about the site's calendar day, which the ref handles.
function nextRun(at, from) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(at || '02:00'));
    const hh = m ? Math.min(23, parseInt(m[1], 10)) : 2;
    const mm = m ? Math.min(59, parseInt(m[2], 10)) : 0;
    const base = from instanceof Date ? new Date(from.getTime()) : new Date();
    const d = new Date(base.getFullYear(), base.getMonth(), base.getDate(), hh, mm, 0, 0);
    if (d.getTime() <= base.getTime()) {
        d.setDate(d.getDate() + 1);
    }
    return d;
}

// "in 6 hours 42 minutes" — the sentence the window prints. Rounded down, and
// it never says "in 0 minutes": under a minute it is "any moment now".
function untilWords(target, from) {
    const a = target instanceof Date ? target.getTime() : 0;
    const b = from instanceof Date ? from.getTime() : Date.now();
    let s = Math.floor((a - b) / 1000);
    if (s <= 0) {
        return 'now';
    }
    if (s < 60) {
        return 'any moment now';
    }
    const h = Math.floor(s / 3600);
    const mi = Math.floor((s % 3600) / 60);
    const bits = [];
    if (h) bits.push(h + ' hour' + (h === 1 ? '' : 's'));
    if (mi) bits.push(mi + ' minute' + (mi === 1 ? '' : 's'));
    return 'in ' + bits.join(' ');
}

// ── THE RUN ──────────────────────────────────────────────────────────────
// deps: { site, engine, cfg, machine, now, onProgress, ensureEngine }
// Returns the night's record: what it did, what it posted, and every line.
async function runNight(deps) {
    const d = deps || {};
    const now = d.now instanceof Date ? d.now : new Date();
    const log = [];
    const say = function (line, level) {
        log.push({ at: hhmm(), say: line, level: level || 'info' });
    };
    const rec = {
        started: now.toISOString(),
        engine: d.engine ? d.engine.id : '',
        model: '',
        drafted: 0,
        posted: 0,
        skipped: 0,
        failed: 0,
        uncertain: false,
        ok: false,
        log: log,
    };

    // A LATE RUN SAYS IT IS LATE. The Mac may have been asleep at the run time;
    // the work still happens, and the log has to explain why the stamps are not
    // the hour the owner set, or the record reads as the clock being wrong.
    if (d.openingNote) {
        say(String(d.openingNote));
    }
    say('woke · asking the site what is waiting');
    const brief = await d.site.brief();
    if (!brief.ok) {
        say(brief.refusal.say, 'fail');
        rec.ok = false;
        rec.stopped = brief.refusal.kind;
        return rec;
    }

    const cfg = d.cfg || {};
    // EVERY due job runs in this one wake — the nightly reply, and the weekly
    // notes on the run whose local day is theirs. A job that is on but waits
    // for its day is SAID, because "switched on and silent" must always have
    // its reason in the log.
    const plan = jobsMod.jobsDueTonight(jobsMod.JOBS, cfg, now);
    plan.waiting.forEach(function (w) {
        say(w.job.name + ' waits for ' + w.until);
    });
    if (!plan.due.length) {
        say(plan.waiting.length ? 'nothing due tonight' : 'every job is switched off — nothing to do');
        rec.ok = true;
        return rec;
    }

    const items = [];
    const models = [];
    let engineUp = false;
    let engineModel = '';
    for (let ji = 0; ji < plan.due.length; ji++) {
        const job = plan.due[ji].job;
        const model = plan.due[ji].model;
        if (!model) {
            say('no model chosen for ' + job.name.toLowerCase() + ' — pick one on the Jobs screen', 'fail');
            continue;
        }

        // THE ENGINE, PER MODEL. Each job names its own, and an auto-started
        // llama-server holds exactly one — so a job needing a different model
        // asks ensureEngineFor to swap it. On an engine we did not start the
        // swap is impossible and the model parameter is what travels (Ollama
        // honours it; a hand-run llama-server serves what it loaded).
        if (!engineUp || engineModel !== model) {
            if (d.ensureEngineFor) {
                // ASK before announcing. The first draft printed "nothing
                // answering — starting it" unconditionally, which on a healthy
                // engine was a log line about an event that never happened.
                const wasUp = await d.engine.reachable();
                if (!wasUp) {
                    say('nothing answering on ' + d.engine.base + ' — starting it');
                }
                const started = await d.ensureEngineFor(model);
                if (!started || !started.ok) {
                    say((started && started.say) || 'the model server did not start', 'fail');
                    if (started && started.install) {
                        say('install it with: ' + started.install, 'fail');
                    }
                    continue;
                }
                rec.startedEngine = rec.startedEngine || !!started.started;
                if (started.started) {
                    // A restart of a HEALTHY server can only mean the model
                    // swap, so the log says which fact caused it — but only
                    // once it has actually happened, because on an engine this
                    // app did not start there is no swap to claim.
                    say(wasUp ? 'swapped the model server for ' + model + ' — ' + started.say : started.say);
                }
                engineUp = true;
                engineModel = model;
            } else if (!engineUp) {
                engineUp = await d.engine.reachable();
                engineModel = model;
                if (!engineUp) {
                    say(d.engine.name + ' is not answering on ' + d.engine.base + ' — nothing was drafted', 'fail');
                    continue;
                }
            }
        }
        say(job.name + ' · ' + d.engine.name + ' · ' + model);
        if (models.indexOf(model) === -1) {
            models.push(model);
        }

        const ctx = {
            site: d.site,
            engine: d.engine,
            model: model,
            host: brief.host,
            now: now,
            enquiries: brief.enquiries,
            week: brief.week,
            gaps: brief.gaps,
            questions: brief.questions,
            onProgress: d.onProgress,
        };
        const runner = job.id === 'reply' ? jobsMod.runReplyJob
            : job.id === 'week' ? jobsMod.runWeekJob
            : job.id === 'price' ? jobsMod.runPriceJob
            : job.id === 'answer' ? jobsMod.runAnswerJob
            : null;
        if (!runner) {
            say(job.name + ' is missing from this build', 'fail');
            continue;
        }
        const out = await runner(ctx);
        out.log.forEach(function (l) { log.push(l); });
        out.items.forEach(function (it) { items.push(it); });
    }
    rec.model = models.join(', ');
    rec.drafted = items.length;
    rec.skipped = log.filter(function (l) { return l.level === 'skip'; }).length;
    rec.failed = log.filter(function (l) { return l.level === 'fail'; }).length;
    const out = { items: items };

    if (!out.items.length) {
        say('nothing to post · back to sleep', 'done');
        rec.ok = rec.failed === 0;
        return rec;
    }

    const sent = await d.site.ingest(out.items);
    if (!sent.ok) {
        // An UNCERTAIN post is recorded as such and NOT retried in this run: the
        // deterministic ref means tomorrow's identical post resolves it, and a
        // retry here could only ever duplicate the request, never the row.
        rec.uncertain = !!sent.uncertain;
        say(sent.refusal.say, rec.uncertain ? 'info' : 'fail');
        rec.ok = !!sent.uncertain;
        return rec;
    }
    rec.posted = sent.stored;
    (sent.skipped || []).forEach(function (s) {
        say('the site would not take one: ' + (s.why || 'no reason given'), 'fail');
    });
    say('stored ' + sent.stored + ' · skipped ' + (sent.skipped || []).length
        + ' · worked ' + workedWords(now) + ' · back to sleep', 'done');
    rec.ok = true;
    return rec;
}

function workedWords(started) {
    const ms = Date.now() - (started instanceof Date ? started.getTime() : Date.now());
    const s = Math.max(1, Math.round(ms / 1000));
    if (s < 60) {
        return s + 's';
    }
    return Math.floor(s / 60) + 'm ' + (s % 60) + 's';
}

// Wall clock, for the same reason jobs.js's stamp() is: base + a line count is
// a function of how much was written, not of when it happened.
function hhmm() {
    const d = new Date();
    const p = function (v) { return String(v).padStart(2, '0'); };
    return p(d.getHours()) + ':' + p(d.getMinutes());
}

// ── THE LOG ON DISK ──────────────────────────────────────────────────────
// Newest first, capped at LOG_KEEP nights. Kept as one small JSON file: it is
// read whole by one screen and never queried, so a file is the right shape.
function pushRecord(list, rec) {
    const out = [rec].concat(Array.isArray(list) ? list : []);
    return out.slice(0, LOG_KEEP);
}

module.exports = { runNight, nextRun, untilWords, pushRecord, hhmm, LOG_KEEP };
