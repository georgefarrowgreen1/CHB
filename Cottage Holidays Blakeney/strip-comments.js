#!/usr/bin/env node
// ============================================================================
//  strip-comments.js — DEPLOY-TIME ONLY. Takes the comments out of the shipped
//  scripts and stylesheets (TARGETS below) and verifies the result is the same
//  program before letting it ship.
//
//  WHY. This codebase's comments are load-bearing documentation with no business
//  on a guest's phone. Measured 22/10/2026 (node-zlib at perf-budget.js's level):
//  app.js 338 -> 200KB gz, admin.js 681 -> 464KB, app.css 104 -> 49KB, and the
//  two guest-app files to under a third. The host serves brotli, smaller again.
//
//  LINES ARE KEPT, NOT DELETED. Every stack-trace line number reported to
//  client-error.php stays exact, which is what keeps the error log usable against
//  a stripped artifact. In a script a comment with code after it on its line
//  becomes spaces, so the columns stay exact too; a stylesheet has no stack trace,
//  and there a comment between two pieces of code is removed outright, because
//  `.a/**/.b` is one selector and `.a .b` is another.
//
//  COMMENTS ARE FOUND BY A PARSER, NOT BY LOOKING AT LINES. The first version
//  guessed from each line where template literals began and ended, and an
//  apostrophe inside one ("We'll email you…", app.js line 7,629) read as an
//  opening quote: from there it believed code was template text and kept ~2,900
//  comment lines, 209KB, in the file every guest downloads. Its verification
//  proved only that the program was unchanged, so nothing noticed for weeks. Now a
//  script's comments are the ranges TypeScript's own parser reports in the trivia
//  before each token (so never inside a string, a regex or a template), a
//  stylesheet's come from a small scanner that steps over strings, escapes and
//  url(…), and the deploy fails if any comment is left.
//
//  AND THE ARTIFACT IS VERIFIED, not trusted. --verify parses both versions of a
//  script with the repo's own TypeScript and compares the token streams; any
//  difference in identifiers, literals or structure fails the deploy. A
//  stylesheet must keep every declaration and selector. Then both must hold no
//  comment at all.
// ============================================================================

const fs = require('fs');
const path = require('path');

function loadTs() {
    try { return require('typescript'); } catch (e) { return null; }
}
function needTs() {
    const ts = loadTs();
    if (!ts) throw new Error('strip-comments: typescript must resolve from the app folder to strip a script (npm install --no-save typescript)');
    return ts;
}

// Every comment in a script, as [start, end) ranges, from the trivia before each
// token: the parser has already decided what is a string, a regex or template
// text, so nothing in those can be mistaken for a comment.
function jsCommentRanges(ts, src) {
    const sf = ts.createSourceFile('strip.js', src, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const found = new Map();
    const take = (r) => { if (!found.has(r.pos)) found.set(r.pos, r.end); };
    const visit = (n) => {
        if (n.kind >= ts.SyntaxKind.FirstJSDocNode && n.kind <= ts.SyntaxKind.LastJSDocNode) return;
        const kids = n.getChildren(sf);
        if (kids.length === 0) {
            const at = n.getFullStart();
            (ts.getTrailingCommentRanges(src, at) || []).forEach(take);
            (ts.getLeadingCommentRanges(src, at) || []).forEach(take);
            return;
        }
        kids.forEach(visit);
    };
    visit(sf);
    return [...found.entries()].sort((a, b) => a[0] - b[0]);
}

// Every comment in a stylesheet. Only a string, an escape or an unquoted url(…)
// can hold a "/*" that is not a comment, and each is stepped over whole.
function cssCommentRanges(src) {
    const out = [];
    let i = 0;
    while (i < src.length) {
        const c = src[i];
        if (c === '\\') {
            i += 2;
        } else if (c === '"' || c === "'") {
            i++;
            while (i < src.length && src[i] !== c && src[i] !== '\n') i += src[i] === '\\' ? 2 : 1;
            i++;
        } else if (c === '/' && src[i + 1] === '*') {
            const end = src.indexOf('*/', i + 2);
            const e = end === -1 ? src.length : end + 2;
            out.push([i, e]);
            i = e;
        } else if ((c === 'u' || c === 'U') && /^url\(\s*[^\s"')]/i.test(src.slice(i, i + 40))) {
            const end = src.indexOf(')', i);
            i = end === -1 ? src.length : end + 1;
        } else {
            i++;
        }
    }
    return out;
}

function commentRanges(src, kind) {
    return kind === 'css' ? cssCommentRanges(src) : jsCommentRanges(needTs(), src);
}

// How many comments a file still holds, counted WITHOUT the finder above: a count
// that used the finder would go blind with it. In a script, everything between two
// tokens is whitespace or comment, so any text there is a comment left behind; in a
// stylesheet, a plain pattern (no "/*" sits inside a string in these files).
function commentsLeft(src, kind) {
    if (kind === 'css') return (src.match(/\/\*[\s\S]*?\*\//g) || []).length;
    const ts = needTs();
    const sf = ts.createSourceFile('left.js', src, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    let n = 0;
    const visit = (node) => {
        const kids = node.getChildren(sf);
        if (kids.length === 0) {
            if (/\S/.test(src.slice(node.getFullStart(), node.getStart(sf)))) n++;
            return;
        }
        kids.forEach(visit);
    };
    visit(sf);
    return n;
}

// Takes the ranges out. A comment with only spaces after it on its line goes with
// the spaces before it, which leaves a comment-only line empty. One with code after
// it becomes spaces in a script and goes in a stylesheet. A comment over several
// lines keeps its line breaks, which also keeps what JavaScript reads as the end of
// a statement.
function stripRanges(src, ranges, keepColumns) {
    const parts = [];
    const trimTail = () => {
        while (parts.length) {
            const p = parts[parts.length - 1];
            let e = p.length;
            while (e > 0 && (p[e - 1] === ' ' || p[e - 1] === '\t')) e--;
            if (e > 0) { parts[parts.length - 1] = p.slice(0, e); return; }
            parts.pop();
        }
    };
    let last = 0;
    for (const [a, b] of ranges) {
        parts.push(src.slice(last, a));
        const body = src.slice(a, b);
        const lineEnd = src.indexOf('\n', b);
        const codeAfter = src.slice(b, lineEnd === -1 ? src.length : lineEnd).trim() !== '';
        const lines = body.split('\n');
        if (lines.length > 1 || !codeAfter) trimTail();
        if (lines.length > 1) parts.push('\n'.repeat(lines.length - 1));
        if (codeAfter && keepColumns) parts.push(' '.repeat(lines[lines.length - 1].length));
        last = b;
    }
    parts.push(src.slice(last));
    return parts.join('');
}

function stripSource(src, kind) {
    return stripRanges(src, commentRanges(src, kind), kind !== 'css');
}

// ---- verification: same program, or the deploy stops --------------------
// Token-stream equality via the repo's own TypeScript. Comments are trivia and
// never appear, so a correct strip is a no-op here; anything else is a diff.
function tokensOf(ts, src, file) {
    const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    if (sf.parseDiagnostics && sf.parseDiagnostics.length) {
        return { err: `${file}: ${sf.parseDiagnostics.length} parse diagnostic(s), first: ` +
            ts.flattenDiagnosticMessageText(sf.parseDiagnostics[0].messageText, ' ') };
    }
    const toks = [];
    const walk = (n) => {
        if (n.kind === ts.SyntaxKind.Identifier
            || n.kind === ts.SyntaxKind.StringLiteral
            || n.kind === ts.SyntaxKind.NumericLiteral
            || n.kind === ts.SyntaxKind.RegularExpressionLiteral
            || n.kind === ts.SyntaxKind.NoSubstitutionTemplateLiteral
            || n.kind === ts.SyntaxKind.TemplateHead
            || n.kind === ts.SyntaxKind.TemplateMiddle
            || n.kind === ts.SyntaxKind.TemplateTail) {
            toks.push(n.kind + ':' + n.getText(sf));
        } else {
            toks.push(String(n.kind));
        }
        n.forEachChild(walk);
    };
    walk(sf);
    return { toks };
}

function verifyJs(before, after, file) {
    let ts;
    try { ts = require('typescript'); } catch (e) { return `typescript not installed — cannot verify ${file}`; }
    const a = tokensOf(ts, before, file);
    const b = tokensOf(ts, after, file);
    if (a.err) return `ORIGINAL ${a.err}`;
    if (b.err) return `STRIPPED ${b.err}`;
    if (a.toks.length !== b.toks.length) {
        return `${file}: token count changed ${a.toks.length} -> ${b.toks.length}`;
    }
    for (let i = 0; i < a.toks.length; i++) {
        if (a.toks[i] !== b.toks[i]) {
            return `${file}: token ${i} changed ${JSON.stringify(a.toks[i])} -> ${JSON.stringify(b.toks[i])}`;
        }
    }
    return null;
}

// CSS has no AST to hand here, so verify the property: every declaration and
// selector survives. Strip whitespace and comments from BOTH and compare.
function verifyCss(before, after, file) {
    const norm = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ').trim();
    return norm(before) === norm(after) ? null : `${file}: CSS content changed after stripping`;
}

const TARGETS = ['app.js', 'app.css', 'guest-app.js', 'guest-app.css', 'admin.js', 'admin.css'];

function main() {
    const args = process.argv.slice(2);
    const dir = args.find((a) => !a.startsWith('--')) || process.cwd();
    const verify = args.includes('--verify');
    const dry = args.includes('--dry');
    let failed = 0;
    let saved = 0;
    for (const name of TARGETS) {
        const p = path.join(dir, name);
        if (!fs.existsSync(p)) { console.log(`  – ${name} (absent, skipped)`); continue; }
        const before = fs.readFileSync(p, 'utf8');
        const kind = name.endsWith('.css') ? 'css' : 'js';
        const after = stripSource(before, kind);
        // LINE COUNT IS THE INVARIANT that keeps stack traces honest.
        const lb = before.split('\n').length;
        const la = after.split('\n').length;
        if (lb !== la) { console.log(`  ✗ ${name}: line count changed ${lb} -> ${la}`); failed++; continue; }
        if (verify) {
            const err = kind === 'js' ? verifyJs(before, after, name) : verifyCss(before, after, name);
            if (err) { console.log(`  ✗ ${err}`); failed++; continue; }
            // The other half: the comments are actually gone. Proving only that the
            // program is unchanged let a stripper that had stopped stripping ship.
            const left = commentsLeft(after, kind);
            if (left) { console.log(`  ✗ ${name}: ${left} comment(s) left after stripping`); failed++; continue; }
        }
        const zlib = require('zlib');
        const gb = zlib.gzipSync(Buffer.from(before)).length;
        const ga = zlib.gzipSync(Buffer.from(after)).length;
        saved += gb - ga;
        if (!dry) fs.writeFileSync(p, after);
        console.log(`  ✓ ${name}: ${(gb / 1024).toFixed(1)}KB -> ${(ga / 1024).toFixed(1)}KB gz (-${gb - ga} B), ${la} lines kept`);
    }
    console.log(failed
        ? `\nstrip-comments: ${failed} file(s) FAILED verification — nothing shipped\n`
        : `\nstrip-comments: ${(saved / 1024).toFixed(1)}KB gz saved, line numbers preserved\n`);
    process.exit(failed ? 1 : 0);
}

if (require.main === module) main();
module.exports = { stripSource, commentsLeft, verifyJs, verifyCss, TARGETS };
