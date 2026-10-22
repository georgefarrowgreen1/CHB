#!/usr/bin/env bash
# Builds the folder the deploy uploads, from the app folder. This is the ONE
# definition used by the live deploy, the staging deploy and the server file check,
# so the three cannot drift apart (the two deploy copies of it already had: staging
# had lost cmd:fail-exit and the second upload pass).
#
#   stage-site.sh <app folder> <out folder> [--no-build]
#
# --no-build stops once the files are chosen: no comment strip, no brotli twins. The
# tests run it that way to check WHAT ships, with no network and no tools needed.
# A full build needs `brotli` on the PATH and typescript resolvable from <out folder>
# (strip-comments.js --verify parses with it).
set -euo pipefail

SRC="${1:?usage: stage-site.sh <app folder> <out folder> [--no-build]}"
OUT="${2:?usage: stage-site.sh <app folder> <out folder> [--no-build]}"
BUILD=1
[ "${3:-}" = "--no-build" ] && BUILD=0

rm -rf "$OUT"
mkdir -p "$OUT"
cp -R "$SRC"/. "$OUT"/

# Apache config ships as htaccess.txt in the repo; it must be .htaccess live.
if [ -f "$OUT/htaccess.txt" ]; then mv -f "$OUT/htaccess.txt" "$OUT/.htaccess"; fi

# Never overwrite live secrets: the server keeps its own config.php.
rm -f "$OUT/config.php"

# Run-once tools must never be live on the server.
rm -f "$OUT/setup.php" "$OUT/health.php" "$OUT/vapid-keygen.php"

# Everything that exists only to build or test the site. Families go by PATTERN, so a
# new test, fixture or budget cannot ship by default (a hand-kept list once let a new
# test-*.php reach the host). The *.sql migrations DO ship: migrate.php applies them,
# and .htaccess refuses to serve them.
rm -f "$OUT"/test-*.php "$OUT"/test-*.js "$OUT"/ui-test*.js "$OUT"/*-test.js \
    "$OUT"/*-fixtures.json "$OUT"/*-budget.json "$OUT"/*.md "$OUT"/index.backup-*.html \
    "$OUT"/phpstan*.neon* "$OUT/package.json" "$OUT/package-lock.json"
rm -f "$OUT/lint-js.js" "$OUT/bump.js" "$OUT/check-versions.js" "$OUT/typecheck.js" \
    "$OUT/perf-budget.js" "$OUT/check-css-conventions.js" "$OUT/darkstar-build.js" \
    "$OUT/nlu-testset.js"
rm -rf "$OUT/layout-shots" "$OUT/node_modules" "$OUT/.phpstan-cache"

# The runtime folders ship as their guard files only. A clean checkout has nothing
# else in them; a working copy does (photos, session files).
for d in uploads sessions backups; do
    if [ -d "$OUT/$d" ]; then
        find "$OUT/$d" -mindepth 1 -type f ! -name '.htaccess' ! -name 'README.txt' ! -name '.gitignore' -delete
        find "$OUT/$d" -mindepth 1 -type d -empty -delete
    fi
done

# Which commit this is, so the server check can compare the host with exactly what
# was uploaded. Public information (the repository is public), so no harm served.
if COMMIT="$(git -C "$SRC" rev-parse HEAD 2>/dev/null)"; then
    printf '%s\n' "$COMMIT" > "$OUT/.deploy-commit"
fi

if [ "$BUILD" = 1 ]; then
    # Full-line comments come out of the assets in strip-comments.js's TARGETS, line
    # for line (stack-trace lines stay exact), and --verify compares the token streams
    # of both versions with the repo's own TypeScript, so a strip that changed the
    # program stops the deploy rather than shipping. index.html (its CSP hash) and
    # sw.js are untouched.
    node "$OUT/strip-comments.js" "$OUT" --verify
    rm -f "$OUT/strip-comments.js"
    # Precompressed brotli beside every top-level js/css (the host negotiates only
    # gzip; .htaccess serves these to brotli-capable browsers). Not sw.js: it must stay
    # no-cache, and an immutable stale sw.js.br would freeze service-worker updates.
    find "$OUT" -maxdepth 1 \( -name '*.js' -o -name '*.css' \) ! -name 'sw.js' -exec brotli -f -q 11 -k {} \;
fi
rm -f "$OUT/strip-comments.js"
