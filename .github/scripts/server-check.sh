#!/usr/bin/env bash
# The server file check (.github/workflows/server-check.yml): compares every file on
# the web host with exactly what the last deploy uploaded, and says what does not
# belong. READ-ONLY on the host: it lists and downloads, never writes or deletes.
#
# Env: HOST USERNAME LFTP_PASSWORD [PORT] [REMOTE]  the SFTP login (as the deploy)
#      [SITE_URL] APP_SECRET|CRON_SECRET             to tell the site what it found
# Exit: 0 nothing needs a look, 1 something does, 2 the check itself could not run.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
WORK="${CHECK_WORK:-${RUNNER_TEMP:-/tmp}/server-check}"
# The build goes inside the repository so strip-comments.js finds typescript in the
# workspace's node_modules, exactly as the deploy's does.
BUILT="${CHECK_BUILT:-$REPO/server-check-built}"
ROOT="${REMOTE:-/}"
RUNNER_TEMP="${RUNNER_TEMP:-$WORK}"
rm -rf "$WORK" "$BUILT"
mkdir -p "$WORK"

# 1. Which commit is on the host: the deploy writes it into .deploy-commit.
NOTE=""
COMMIT="$(bash "$HERE/sftp.sh" "cat \"${ROOT%/}/.deploy-commit\"" 2>/dev/null | tr -dc '0-9a-f' | cut -c1-40)" || COMMIT=""
if [ "${#COMMIT}" -ne 40 ] || ! git -C "$REPO" cat-file -e "$COMMIT^{commit}" 2>/dev/null; then
    COMMIT="$(git -C "$REPO" rev-parse HEAD)"
    NOTE="the server does not say which commit it has, so this is the newest"
fi
echo "Comparing the server with $COMMIT${NOTE:+ ($NOTE)}"

# 2. Exactly what that commit's deploy uploaded, built by that commit's own staging script.
git -C "$REPO" worktree prune
git -C "$REPO" worktree add --detach "$WORK/src" "$COMMIT" > /dev/null
STAGE="$WORK/src/.github/scripts/stage-site.sh"
[ -f "$STAGE" ] || STAGE="$HERE/stage-site.sh"
bash "$STAGE" "$WORK/src/Cottage Holidays Blakeney" "$BUILT" > "$WORK/stage.log" 2>&1 || {
    cat "$WORK/stage.log"
    echo "::error::Could not build the deployed commit to compare with."
    exit 2
}
git -C "$REPO" worktree remove --force "$WORK/src" 2>/dev/null || true

# 3. The host: a listing of everything, and a copy of what can be compared by content.
#    Not downloaded: the live config (its secrets have no business on a runner),
#    session files, photos, backups and big binaries; those are compared by name and size.
bash "$HERE/sftp.sh" "cd \"$ROOT\"; find -l ." > "$WORK/listing.txt"
bash "$HERE/sftp.sh" "mirror --no-perms --parallel=4 -x '^config\\.php\$' -x '^sessions/sess_' -x '\\.(jpe?g|png|gif|webp|avif|heic|ico|woff2?|ttf|otf|eot|zip|gz|bin|onnx)\$' \"$ROOT\" \"$WORK/server\"" > "$WORK/mirror.log" 2>&1 || {
    tail -20 "$WORK/mirror.log"
    echo "::error::Could not download the server's files to compare."
    exit 2
}

# 4. The passkey library is installed on the host by hand (lib/WebAuthn/), so it is
#    checked against every published version of lbuchs/WebAuthn instead. Data only:
#    nothing from that repository is run.
: > "$WORK/webauthn.txt"
if git clone --quiet --bare https://github.com/lbuchs/WebAuthn "$WORK/webauthn.git" 2> /dev/null; then
    for ref in $(git -C "$WORK/webauthn.git" for-each-ref --format='%(refname)' refs/tags refs/heads); do
        git -C "$WORK/webauthn.git" ls-tree -r --format='%(objectname) %(path)' "$ref"
    done | sort -u > "$WORK/webauthn.txt"
fi

# 5. The host's SSH key, so it can be pinned (.github/sftp-host-keys). Public keys only;
#    the host name is masked as a secret.
KEYS="$(ssh-keyscan -T 10 -p "${PORT:-22}" "$HOST" 2> /dev/null | awk '{print $2, $3}' | sort -u || true)"

# 6. Compare.
STATUS=0
CHECK_COMMIT="$COMMIT" CHECK_COMMIT_NOTE="$NOTE" CHECK_HOST_KEYS="$KEYS" node "$HERE/server-check.js" \
    --expected "$BUILT" --listing "$WORK/listing.txt" --server "$WORK/server" --repo "$REPO" \
    --webauthn "$WORK/webauthn.txt" --json "$WORK/result.json" --summary "${GITHUB_STEP_SUMMARY:-/dev/null}" || STATUS=$?
rm -rf "$BUILT"

# 7. Tell the site, so Manage → Status and Needs attention say it too (job key only).
if [ "$STATUS" -le 1 ] && [ -s "$WORK/result.json" ] && [ -n "${APP_SECRET:-}${CRON_SECRET:-}" ]; then
    . "$HERE/site-job.sh"
    job 30 "server-check.php?cron" -X POST -H 'Content-Type: application/json' --data-binary @"$WORK/result.json" \
        || echo "::warning::Could not tell the site what the check found."
fi
exit "$STATUS"
