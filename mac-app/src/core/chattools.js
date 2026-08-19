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
        + 'Quote figures exactly as the results state them \u2014 never calculate or invent money. '
        + 'If a lookup fails, say so plainly.';
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
    chatToolsIntro, chatToolCall, chatToolResultMsg, chatToolGrammar,
};
