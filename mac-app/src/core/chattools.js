// ============================================================
//  chattools.js — the chat looks things up, and only looks.
//
//  Four READ-ONLY questions the model may ask the website mid-conversation.
//  This does not move the chat's boundary an inch: writing was never possible
//  and still is not — every tool is a read, the site's chat_tool action
//  refuses anything else by not existing, and the site formats every figure
//  itself so the model quotes money rather than calculating it (the brief's
//  own grounding rule).
//
//  THE PROTOCOL IS A LINE, NOT A FEATURE FLAG. Small local models are
//  unreliable at native function-calling APIs, so the contract is one the
//  dumbest model can hit: a reply whose line starts `TOOL ` followed by one
//  JSON object is a lookup; anything else is the answer. The parser is
//  forgiving about prose around the line (models narrate), strict about the
//  call itself (whitelist + shape), and when a model TRIES to call a tool
//  and fumbles the JSON, the retry is grammar-constrained — llama.cpp's GBNF
//  decode makes the call valid by construction, the same trick offered for
//  the intent decode.
//
//  Pure throughout: parsing, validation, prompt text, the grammar. The IO —
//  the engine call, the site POST, the loop — lives in api.js.
// ============================================================
'use strict';

// The whitelist. Args are DECLARED so the parser can drop anything else —
// the site re-validates (the door never relies on the caller), this keeps
// junk from travelling. `req` names what must be present before the call is
// worth the round trip.
const CHAT_TOOLS = {
    today: { args: [], req: [] },
    bookings: { args: ['from', 'to', 'name'], req: [] },
    availability: { args: ['cottage', 'from', 'to'], req: ['cottage', 'from', 'to'] },
    enquiries: { args: [], req: [] },
    // The fleet itself — the tool the first four forgot. Found live: the
    // owner asked about a cottage and the model had nothing to see, not
    // even the names to put into an availability call.
    cottages: { args: [], req: [] },
    // The whole-business reads (Tier 1): who owes and the deposits to go
    // back, this month against last, the tax year's expenses. All composed
    // and CAPPED server-side; names travel, contact details never.
    money: { args: [], req: [] },
    performance: { args: [], req: [] },
    expenses: { args: [], req: [] },
    // The coast — tides and weather at Blakeney for one day, with that day's
    // arrivals cross-referenced. The site formats every figure; the two
    // things a Blakeney owner is asked about most.
    coast: { args: ['day'], req: [] },
};
const CHAT_TOOL_NAMES = Object.keys(CHAT_TOOLS);
// Lookups per message. Three answers most questions twice over; a model that
// wants a fourth is looping, and the loop must end at a sentence.
const CHAT_TOOL_ROUNDS = 3;
const CHAT_TOOL_ARG_MAX = 80;      // one argument's characters
const CHAT_TOOL_RESULT_MAX = 4000; // a tool result travelling back to the model

// The system-prompt paragraph that teaches the protocol. TODAY'S DATE IS THE
// LOAD-BEARING LINE: a local model does not know what day it is, and every
// "this weekend" resolves through it.
function chatToolsIntro(todayIso) {
    return 'Today is ' + String(todayIso || '') + '. You can look up live information '
        + 'from the owner\u2019s own website. To look something up, reply with EXACTLY one line and '
        + 'nothing else: TOOL {"tool":"<name>","args":{...}} \u2014 then wait for the result before '
        + 'answering. The tools (all read-only):\n'
        + '\u2022 today \u2014 args {}: today\u2019s arrivals, departures, who is staying, and how many enquiries wait.\n'
        + '\u2022 bookings \u2014 args {"from":"YYYY-MM-DD","to":"YYYY-MM-DD","name":"..."} (each optional): '
        + 'bookings in a range, default the next two weeks.\n'
        + '\u2022 availability \u2014 args {"cottage":"...","from":"YYYY-MM-DD","to":"YYYY-MM-DD"} (all required): '
        + 'whether a cottage is free for those dates, and the website\u2019s own price when it is.\n'
        + '\u2022 enquiries \u2014 args {}: the enquiries waiting for a reply, each with its dates and the website\u2019s own quote.\n'
        + '\u2022 cottages \u2014 args {}: the cottages themselves \u2014 their names, what each sleeps, the base '
        + 'nightly rate, and their published questions and answers. Use it whenever the owner asks about '
        + 'a cottage, its price, or what it offers, and to learn the exact names availability needs.\n'
        + '\u2022 money \u2014 args {}: who still owes (split due now / due later, each row with a `ref`) and '
        + 'the damage deposits ready to return.\n'
        + '\u2022 performance \u2014 args {}: this month against last \u2014 stays, nights and revenue from direct bookings.\n'
        + '\u2022 expenses \u2014 args {}: this tax year\u2019s logged expenses, total and by category.\n'
        + '\u2022 coast \u2014 args {"day":"YYYY-MM-DD"} (optional, default today): tide times and the weather '
        + 'at Blakeney for that day, plus who arrives then. Use it for anything about tides, the sea, '
        + 'walks, or what the weather is doing.\n'
        + 'Quote figures exactly as the results state them \u2014 never calculate or invent money. '
        + 'If a lookup fails, say so plainly.';
}

// \u2500\u2500 ACTIONS THE MODEL MAY PROPOSE \u2014 and only ever propose. \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
// The safety shape in one sentence: the model proposes, the phone disposes.
// An ACT line becomes DATA in the answer envelope; the owner's phone renders
// it as a card and NOTHING happens until they tap Confirm \u2014 execution runs
// through the phone's own admin session and the site's existing refusals.
// This Mac can execute nothing: the whitelist below is a closed set the site
// re-validates at its own door, and money-out kinds are deliberately absent.
const CHAT_ACTS = {
    block_dates: { args: ['cottage', 'from', 'to', 'note'], req: ['cottage', 'from', 'to'] },
    price_override: { args: ['cottage', 'from', 'to', 'rate'], req: ['cottage', 'from', 'to', 'rate'] },
    request_payment: { args: ['booking'], req: ['booking'] },
    add_booking: { args: ['cottage', 'check_in', 'check_out', 'name', 'adults', 'children', 'price'], req: ['cottage', 'check_in', 'check_out', 'name', 'adults'] },
    send_enquiry_reply: { args: ['enquiry'], req: ['enquiry'] },
    // A RECORD of money already spent — never money moving out, which is why
    // it may join while refunds stay refused by name.
    add_expense: { args: ['category', 'amount', 'note', 'date'], req: ['category', 'amount'] },
    send_arrival_info: { args: ['booking'], req: ['booking'] },
    record_payment: { args: ['booking'], req: ['booking'] },
    // A PROPOSED memory — the app still never writes a line of its own:
    // the card is the proposal, the owner's confirm is what makes it a line.
    remember: { args: ['text'], req: ['text'] },
};
const CHAT_ACT_NAMES = Object.keys(CHAT_ACTS);

function chatActsIntro() {
    return 'You may also PREPARE an action for the owner to confirm \u2014 you can never perform one. '
        + 'When the owner asks you to do one of these things, end your reply with EXACTLY one line: '
        + 'ACT {"action":"<name>","args":{...}}\n'
        + 'The actions (dates are first night to last night, YYYY-MM-DD):\n'
        + '\u2022 block_dates \u2014 args {"cottage":"...","from":"...","to":"...","note":"..."} (note optional): '
        + 'hold dates so nothing can book them.\n'
        + '\u2022 price_override \u2014 args {"cottage":"...","from":"...","to":"...","rate":150}: '
        + 'set the nightly rate for those dates (\u00a320\u2013\u00a32000).\n'
        + '\u2022 request_payment \u2014 args {"booking":<ref>}: email a guest their payment link. The ref '
        + 'MUST be a `ref` you saw in a lookup result this conversation \u2014 never a guess.\n'
        + '\u2022 add_booking \u2014 args {"cottage":"...","check_in":"...","check_out":"...","name":"...","adults":2,'
        + '"children":0,"price":400} (children and price optional; check_in is the ARRIVAL day, check_out the '
        + 'LEAVING day; price is the whole agreed total in \u00a3): prepare a new booking. Use it when the owner '
        + 'says someone has booked or asks you to book someone in.\n'
        + '\u2022 send_enquiry_reply \u2014 args {"enquiry":<id>}: open the drafted reply to a waiting enquiry, '
        + 'ready for the owner to read and send. The id MUST be an `id` from the enquiries lookup \u2014 never a guess.\n'
        + '\u2022 add_expense \u2014 args {"category":"Cleaning","amount":45,"note":"...","date":"YYYY-MM-DD"} '
        + '(note and date optional; the date is when the money was spent, never a future day): '
        + 'record a business expense the owner tells you about.\n'
        + '\u2022 send_arrival_info \u2014 args {"booking":<ref>}: email a guest their arrival details '
        + '(directions, times). The ref MUST be a `ref` from a lookup result \u2014 never a guess.\n'
        + '\u2022 record_payment \u2014 args {"booking":<ref>}: open the record-a-payment form for a booking, '
        + 'ready for the owner to enter what was received \u2014 you never state the amount.\n'
        + '\u2022 remember \u2014 args {"text":"..."}: offer to save a standing fact to your memory (under 200 '
        + 'characters, stated neutrally). ONLY when the owner tells you something worth keeping for '
        + 'every future conversation \u2014 a policy, a promise, a preference \u2014 never for one-off details.\n'
        + 'Rules: at most ONE action per reply; say in plain words what the card will do; NEVER claim '
        + 'the action is done \u2014 the owner confirms it on their phone. Anything else (refunds, '
        + 'cancellations, deleting) you cannot prepare \u2014 say so and point at the back office.';
}

// ── THE GROUNDING PACK, AS WORDS ────────────────────────────────────────────
// The site hands over FACTS (world + memories ride the ask payload); this is
// the ONE place they become prompt text, so the framing cannot drift between
// callers. Facts are labelled as live-and-trusted; memories as the OWNER'S
// own notes — never the model's. Returns '' when there is nothing to ground.
function chatGroundText(world, memories, summary) {
    const parts = [];
    // The conversation's own condensed memory — turns the payload cap has
    // cut, kept by the model's previous SUM line. Labelled as exactly that,
    // so the model treats it as its own earlier notes, never fresh fact.
    const sm = String(summary || '').trim();
    if (sm) {
        parts.push('Earlier in this conversation (condensed — your own previous summary of turns '
            + 'no longer shown):\n' + sm.slice(0, CHAT_SUM_CHARS));
    }
    const w = world && typeof world === 'object' ? world : null;
    if (w) {
        const lines = [];
        const stays = function (rows) {
            return (Array.isArray(rows) ? rows : []).map(function (r) {
                return String(r.guest || '') + ' (' + String(r.cottage || '') + ')'
                    + (r.still_to_pay ? ' — ' + r.still_to_pay + ' still to pay' : '');
            }).join('; ');
        };
        if (Array.isArray(w.cottages) && w.cottages.length) {
            lines.push('The cottages: ' + w.cottages.map(function (c) {
                return String(c.cottage || '') + (c.sleeps ? ' (sleeps ' + c.sleeps + ')' : '')
                    + (c.nightly ? ' — ' + c.nightly : '');
            }).join(' • '));
        }
        const t = w.today && typeof w.today === 'object' ? w.today : {};
        if (t.date) {
            lines.push('Today (' + t.date + '): '
                + ((t.arrivals || []).length ? 'arriving — ' + stays(t.arrivals) + '. ' : 'no arrivals. ')
                + ((t.departures || []).length ? 'Leaving — ' + stays(t.departures) + '. ' : '')
                + ((t.staying || []).length ? 'In residence — ' + stays(t.staying) + '. ' : '')
                + (t.enquiries_waiting ? t.enquiries_waiting + ' enquiry(ies) waiting for a reply.' : 'No enquiries waiting.'));
        }
        const m = w.money && typeof w.money === 'object' ? w.money : null;
        if (m) {
            lines.push('Money: ' + (m.due_now_count
                ? m.due_now_count + ' owing now, ' + String(m.due_now_total || '') + ' in total — ' + stays(m.due_now)
                : 'nothing due right now')
                + (m.deposits_to_return ? '. ' + m.deposits_to_return + ' damage deposit(s) ready to return.' : '.'));
        }
        if (lines.length) {
            parts.push('Live facts from the owner\u2019s website, fresher than anything you remember \u2014 trust these:\n' + lines.join('\n'));
        }
    }
    const mems = (Array.isArray(memories) ? memories : []).map(function (x) { return String(x || '').trim(); }).filter(Boolean);
    if (mems.length) {
        parts.push('The owner asked you to always remember:\n' + mems.map(function (x) { return '\u2022 ' + x; }).join('\n'));
    }
    return parts.join('\n\n');
}

// ── THE ROLLING SUMMARY (webchat only, and only once the trim is real) ──────
// When the site says turns have been cut (`dropped` > 0) the model is asked
// to END each reply with SUM {"text":"..."} — a condensed memory of the WHOLE
// conversation. The line is protocol: stripped from the words, held back from
// partials, carried in the envelope as data; the site stores it per
// conversation and hands it back in the next ask's grounding. A fully-visible
// thread is never asked — a summary of what is already there says nothing new.
const CHAT_SUM_CHARS = 600;
function chatSumIntro() {
    return 'Your view of this conversation is trimmed to the recent turns — older ones are no '
        + 'longer shown. END every reply with EXACTLY one extra line: SUM {"text":"..."} — a neutral '
        + 'condensed memory (under 500 characters) of the WHOLE conversation so far: decisions made, '
        + 'facts established, names and figures. Update your earlier summary if one is shown above; '
        + 'never invent anything for it.';
}
// The final answer → its summary, if any. The SUM line is STRIPPED from the
// words either way (a protocol line must never paint); a malformed one is
// simply dropped — the words always stand, and next turn asks again.
function chatSumCall(raw) {
    const text = String(raw == null ? '' : raw);
    const m = text.match(/^[ \t]*SUM\b(.*)$/m);
    if (!m) { return { text: text, sum: null }; }
    const cleaned = (text.slice(0, m.index) + text.slice(m.index + m[0].length))
        .replace(/\n{3,}/g, '\n\n').trim();
    const rest = m[1];
    const start = rest.indexOf('{');
    let j = null;
    if (start >= 0) {
        try { j = JSON.parse(rest.slice(start)); } catch (e) { j = null; }
    }
    const s = j && typeof j === 'object' && typeof j.text === 'string' ? j.text.trim() : '';
    return { text: cleaned, sum: s ? s.slice(0, CHAT_SUM_CHARS) : null };
}

// The retry grammar: when a proposal fumbles its JSON, ONE re-ask constrained
// to this shape makes the line valid by construction \u2014 the exact net the
// TOOL protocol has had all along. Names only; the site still judges the args.
function chatActGrammar() {
    const names = CHAT_ACT_NAMES.map(function (n) { return '"' + n + '"'; }).join(' | ');
    return 'root ::= "ACT {\\"action\\":\\"" name "\\",\\"args\\":" obj "}"\n'
        + 'name ::= ' + names + '\n'
        + 'obj ::= "{" ( pair ( "," pair )* )? "}"\n'
        + 'pair ::= str ":" val\n'
        + 'val ::= str | num | obj | "true" | "false" | "null"\n'
        + 'str ::= "\\"" chr* "\\""\n'
        + 'chr ::= [^"\\\\\\x00-\\x1f] | "\\\\" ["\\\\/bfnrt]\n'
        + 'num ::= "-"? [0-9]+ ( "." [0-9]+ )?\n';
}

// The final answer \u2192 its proposal, if any. Returns { text, act|null, bad|null }:
// the ACT line is STRIPPED from the words either way (a protocol line must
// never paint), an unknown or malformed act is reported so the caller can
// log it \u2014 dropped and named, never repaired (guard.js's own rule).
function chatActCall(raw) {
    const text = String(raw == null ? '' : raw);
    const m = text.match(/^[ \t]*ACT\b(.*)$/m);
    if (!m) { return { text: text, act: null, bad: null }; }
    const cleaned = (text.slice(0, m.index) + text.slice(m.index + m[0].length))
        .replace(/\n{3,}/g, '\n\n').trim();
    const rest = m[1];
    const start = rest.indexOf('{');
    let j = null;
    if (start >= 0) {
        try { j = JSON.parse(rest.slice(start)); } catch (e) { j = null; }
    }
    if (!j || typeof j !== 'object') {
        return { text: cleaned, act: null, bad: 'no JSON object after ACT' };
    }
    const name = String(j.action || '');
    const spec = CHAT_ACTS[name];
    if (!spec) {
        return { text: cleaned, act: null, bad: 'no such action \u2014 the actions are ' + CHAT_ACT_NAMES.join(', ') };
    }
    const args = {};
    let missing = '';
    spec.args.forEach(function (k) {
        const v = (j.args && typeof j.args === 'object') ? j.args[k] : undefined;
        if (typeof v === 'string' && v.trim() !== '') { args[k] = v.trim().slice(0, CHAT_TOOL_ARG_MAX); }
        if (typeof v === 'number' && isFinite(v)) { args[k] = v; }
    });
    spec.req.forEach(function (k) {
        if (!(k in args) && !missing) { missing = k; }
    });
    if (missing) {
        return { text: cleaned, act: null, bad: 'the action is missing ' + missing };
    }
    return { text: cleaned, act: { action: name, args: args }, bad: null };
}

// One reply → what it is. Returns:
//   null            — no tool call here; this is the answer.
//   { tool, args }  — a valid call, args filtered to the declared keys.
//   { bad: '…' }    — the model TRIED (a line starts with TOOL) and fumbled.
function chatToolCall(raw) {
    const text = String(raw == null ? '' : raw);
    const m = text.match(/^[ \t]*TOOL\b(.*)$/m);
    if (!m) { return null; }
    const rest = m[1];
    const start = rest.indexOf('{');
    if (start < 0) { return { bad: 'no JSON object after TOOL' }; }
    // Balanced-brace extraction: models append prose after the JSON, and a
    // bare JSON.parse of "rest" would refuse the whole line for it.
    let depth = 0;
    let end = -1;
    let inStr = false;
    let esc = false;
    for (let i = start; i < rest.length; i++) {
        const c = rest[i];
        if (esc) { esc = false; continue; }
        if (c === '\\') { esc = inStr; continue; }
        if (c === '"') { inStr = !inStr; continue; }
        if (inStr) { continue; }
        if (c === '{') { depth++; }
        if (c === '}') {
            depth--;
            if (depth === 0) { end = i; break; }
        }
    }
    if (end < 0) { return { bad: 'the JSON object never closes' }; }
    let obj = null;
    try { obj = JSON.parse(rest.slice(start, end + 1)); } catch (e) { obj = null; }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) { return { bad: 'not a JSON object' }; }
    const tool = typeof obj.tool === 'string' ? obj.tool.trim() : '';
    const spec = CHAT_TOOLS[tool];
    if (!spec) { return { bad: 'no such tool \u2014 the tools are ' + CHAT_TOOL_NAMES.join(', ') }; }
    const rawArgs = (obj.args && typeof obj.args === 'object' && !Array.isArray(obj.args)) ? obj.args : {};
    const args = {};
    for (const k of spec.args) {
        const v = rawArgs[k];
        if (typeof v === 'string' && v.trim() !== '') {
            args[k] = v.trim().slice(0, CHAT_TOOL_ARG_MAX);
        }
    }
    for (const k of spec.req) {
        if (!args[k]) { return { bad: tool + ' needs "' + k + '"' }; }
    }
    return { tool: tool, args: args };
}

// A tool's result, as the message the model reads next. Compact JSON, capped —
// a result that outgrows the cap is CUT and says so, never silently short.
function chatToolResultMsg(tool, data) {
    let body = '';
    try { body = JSON.stringify(data == null ? {} : data); } catch (e) { body = '{}'; }
    if (body.length > CHAT_TOOL_RESULT_MAX) {
        body = body.slice(0, CHAT_TOOL_RESULT_MAX) + ' \u2026(cut \u2014 ask a narrower question)';
    }
    return 'TOOL RESULT ' + String(tool || '') + ': ' + body;
}

// The GBNF grammar for the constrained RETRY: a tool call valid by
// construction — the name an alternation over the whitelist, the args a
// generic JSON object. Used only after a fumbled attempt, so a free-prose
// answer is never forced into a lookup.
function chatToolGrammar() {
    const names = CHAT_TOOL_NAMES.map(function (n) { return '"' + n + '"'; }).join(' | ');
    return 'root ::= "TOOL {\\"tool\\":\\"" name "\\",\\"args\\":" obj "}"\n'
        + 'name ::= ' + names + '\n'
        + 'obj ::= "{" ( pair ( "," pair )* )? "}"\n'
        + 'pair ::= str ":" val\n'
        + 'val ::= str | num | obj | "true" | "false" | "null"\n'
        + 'str ::= "\\"" chr* "\\""\n'
        + 'chr ::= [^"\\\\\\x00-\\x1f] | "\\\\" ["\\\\/bfnrt]\n'
        + 'num ::= "-"? [0-9]+ ( "." [0-9]+ )?\n';
}

module.exports = {
    CHAT_TOOLS, CHAT_TOOL_NAMES, CHAT_TOOL_ROUNDS, CHAT_TOOL_ARG_MAX, CHAT_TOOL_RESULT_MAX,
    CHAT_ACTS, CHAT_ACT_NAMES,
    chatToolsIntro, chatToolCall, chatToolResultMsg, chatToolGrammar,
    chatActsIntro, chatActCall, chatActGrammar, chatGroundText,
    CHAT_SUM_CHARS, chatSumIntro, chatSumCall,
};
