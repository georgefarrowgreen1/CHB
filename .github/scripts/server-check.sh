#!/usr/bin/env bash
# The server file check (.github/workflows/server-check.yml): compares every file on
# the web host with exactly what the last deploy uploaded, and says what does not
# belong. READ-ONLY on the host: it lists and downloads, never writes or deletes,
# unless the tidy-up (server-tidy.yml) runs it with TIDY=apply, which deletes exactly
# the files server-check.js's --tidy list names and nothing else.
#
# Env: HOST USERNAME LFTP_PASSWORD [PORT] [REMOTE]  the SFTP login (as the deploy)
#      [SITE_URL] APP_SECRET|CRON_SECRET             to tell the site what it found
#      [TIDY=dry|apply]                              the tidy-up: list what may go, or delete it
#      [REMOVE_COPY=<folder>]                        with TIDY, a copy of the whole site in
#                                                    that top-level folder goes too (the old
#                                                    staging site in staging/): listed on a
#                                                    dry run, deleted with TIDY=apply
#
# Any folder holding a .deploy-commit and 50+ files is a copy of the site (found from
# the listing, server-check.js findCopies) and is compared as one, not as strays.
# Exit: 0 nothing needs a look, 1 something does, 2 the check itself could not run.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
WORK="${CHECK_WORK:-${RUNNER_TEMP:-/tmp}/server-check}"
# The build goes inside the repository so strip-comments.js finds typescript in the
# workspace's node_modules, exactly as the deploy's does.
BUILT="${CHECK_BUILT:-$REPO/server-check-built}"
NBUILT="$BUILT-copy"
ROOT="${REMOTE:-/}"
RUNNER_TEMP="${RUNNER_TEMP:-$WORK}"
rm -rf "$WORK" "$BUILT" "$NBUILT"*
mkdir -p "$WORK"

# Which commit a folder on the host was deployed from: the deploy writes .deploy-commit.
deployed_commit() {
    local c
    c="$(bash "$HERE/sftp.sh" "cat \"$1/.deploy-commit\"" 2>/dev/null | tr -dc '0-9a-f' | cut -c1-40)" || c=""
    if [ "${#c}" -eq 40 ] && git -C "$REPO" cat-file -e "$c^{commit}" 2>/dev/null; then printf '%s' "$c"; fi
}

# Exactly what a commit's deploy uploaded, built by that commit's own stage-site.sh.
build_commit() {
    git -C "$REPO" worktree prune
    git -C "$REPO" worktree add --detach "$WORK/src" "$1" > /dev/null
    local stage="$WORK/src/.github/scripts/stage-site.sh"
    [ -f "$stage" ] || stage="$HERE/stage-site.sh"
    bash "$stage" "$WORK/src/Cottage Holidays Blakeney" "$2" > "$WORK/stage.log" 2>&1 || {
        cat "$WORK/stage.log"
        echo "::error::Could not build the deployed commit to compare with."
        exit 2
    }
    git -C "$REPO" worktree remove --force "$WORK/src" 2>/dev/null || true
}

# 1. Which commit is on the host.
NOTE=""
COMMIT="$(deployed_commit "${ROOT%/}")"
if [ -z "$COMMIT" ]; then
    COMMIT="$(git -C "$REPO" rev-parse HEAD)"
    NOTE="the server does not say which commit it has, so this is the newest"
fi
echo "Comparing the server with $COMMIT${NOTE:+ ($NOTE)}"

# 2. Exactly what that commit's deploy uploaded.
build_commit "$COMMIT" "$BUILT"

# 3. The host: a listing of everything.
bash "$HERE/sftp.sh" "cd \"$ROOT\"; find -l ." > "$WORK/listing.txt"

# 3b. The copies of the site inside it: any folder the deploy wrote a .deploy-commit
#     into (server-check.js findCopies). The 26/10/2026 check went by a secret naming
#     the staging folder, which wrote its path in a form that did not match, and
#     reported all 150 of the staging copy's files as strays.
mapfile -t FOUND < <(node "$HERE/server-check.js" --copies "$WORK/listing.txt")
COPIES=()
for d in ${FOUND[@]+"${FOUND[@]}"}; do
    d="${d%/}"
    [[ "$d" =~ ^[A-Za-z0-9._@+-]+(/[A-Za-z0-9._@+-]+)*$ ]] || continue
    case " ${COPIES[*]-} " in *" $d "*) ;; *) COPIES+=("$d") ;; esac
done

# 3c. Each copy, from the commit its own deploy wrote (usually the live one).
NESTED_ARGS=()
i=0
for d in ${COPIES[@]+"${COPIES[@]}"}; do
    i=$((i + 1))
    NNOTE=""
    NCOMMIT="$(deployed_commit "${ROOT%/}/$d")"
    if [ -z "$NCOMMIT" ]; then
        NCOMMIT="$COMMIT"
        NNOTE="the folder does not say which commit it has, so this is the live one"
    fi
    echo "Comparing the copy of the site in $d/ with $NCOMMIT${NNOTE:+ ($NNOTE)}"
    if [ "$NCOMMIT" = "$COMMIT" ]; then
        DB="$BUILT"
    else
        DB="$NBUILT-$i"
        build_commit "$NCOMMIT" "$DB"
    fi
    NESTED_ARGS+=(--nested "$d=$DB")
done

# 3d. A copy of what can be compared by content. Not downloaded, at any depth (each
#     copy has its own): a config (its secrets have no business on a runner), session
#     files, photos, backups and big binaries; those are compared by name and size.
bash "$HERE/sftp.sh" "mirror --no-perms --parallel=4 -x '(^|/)config\\.php\$' -x '(^|/)sessions/sess_' -x '\\.(jpe?g|png|gif|webp|avif|heic|ico|woff2?|ttf|otf|eot|zip|gz|bin|onnx)\$' \"$ROOT\" \"$WORK/server\"" > "$WORK/mirror.log" 2>&1 || {
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
CHECK_COMMIT="$COMMIT" CHECK_COMMIT_NOTE="$NOTE" \
    CHECK_HOST_KEYS="$KEYS" node "$HERE/server-check.js" \
    --expected "$BUILT" --listing "$WORK/listing.txt" --server "$WORK/server" --repo "$REPO" \
    --webauthn "$WORK/webauthn.txt" --json "$WORK/result.json" --summary "${GITHUB_STEP_SUMMARY:-/dev/null}" \
    --tidy "$WORK/tidy.json" ${NESTED_ARGS[@]+"${NESTED_ARGS[@]}"} || STATUS=$?
rm -rf "$BUILT" "$NBUILT"*

# 6b. The tidy-up. Its list is the check's own (tidyPick): left over, put there by this
#     repository or an interrupted upload, never in a protected folder. Each name is
#     checked again here before it reaches lftp, and after deleting, the host is listed
#     again: everything deleted must be gone, or the run fails.
if [ -n "${TIDY:-}" ]; then
    if [ "$STATUS" -gt 1 ] || [ ! -s "$WORK/tidy.json" ]; then
        echo "::error::The check could not run, so nothing was tidied."
        exit 2
    fi
    SAFE='const fs = require("fs"); const t = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
        const ok = (p) => /^[A-Za-z0-9._@+][A-Za-z0-9._@+\/-]*$/.test(p) && !p.split("/").some((s) => s === "" || s === "." || s === "..");
        if (process.argv[2] === "keep") { for (const k of t.keep) console.log("- `" + k.path + "`: " + k.why); }
        else { for (const p of t.delete) if (ok(p)) console.log(p); }'
    mapfile -t GONE < <(node -e "$SAFE" "$WORK/tidy.json" delete)
    # The copy to remove: a top-level folder the check found to BE a copy of the site
    # (a .deploy-commit and 50+ files), never any other folder. Its own leftovers go with
    # it rather than one by one.
    COPY=""
    if [ -n "${REMOVE_COPY:-}" ]; then
        if [[ "$REMOVE_COPY" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]] && case " ${COPIES[*]-} " in *" $REMOVE_COPY "*) true ;; *) false ;; esac; then
            COPY="$REMOVE_COPY"
            KEPT=()
            for p in ${GONE[@]+"${GONE[@]}"}; do case "$p" in "$COPY"/*) ;; *) KEPT+=("$p") ;; esac; done
            GONE=(${KEPT[@]+"${KEPT[@]}"})
        else
            echo "No copy of the site in $REMOVE_COPY/ on the server, so there is no copy to remove." | tee -a "${GITHUB_STEP_SUMMARY:-/dev/null}"
        fi
    fi
    {
        echo
        echo "## Tidy-up"
        echo
        if [ "${#GONE[@]}" -eq 0 ]; then
            echo "Nothing to delete."
        else
            if [ "$TIDY" = "apply" ]; then echo "Deleting ${#GONE[@]} left-over file(s):"; else echo "${#GONE[@]} left-over file(s) would be deleted (run it again with \"Delete them\" ticked):"; fi
            echo
            for p in "${GONE[@]}"; do echo "- \`$p\`"; done
        fi
        KEEP="$(node -e "$SAFE" "$WORK/tidy.json" keep)"
        if [ -n "$KEEP" ]; then
            echo
            echo "Left on the server:"
            echo
            echo "$KEEP"
        fi
    } | tee -a "${GITHUB_STEP_SUMMARY:-/dev/null}"
    if [ "$TIDY" = "apply" ] && [ "${#GONE[@]}" -gt 0 ]; then
        CMDS="cd \"$ROOT\""
        for p in "${GONE[@]}"; do CMDS="$CMDS; rm \"$p\""; done
        bash "$HERE/sftp.sh" "$CMDS" || { echo "::error::The server refused a deletion; the listing below says what is left."; }
        bash "$HERE/sftp.sh" "cd \"$ROOT\"; find -l ." > "$WORK/after.txt"
        STILL="$(node -e 'const { parseListing } = require(process.argv[1]); const fs = require("fs");
            const on = new Set(parseListing(fs.readFileSync(process.argv[2], "utf8")).map((r) => r.path));
            const gone = fs.readFileSync(0, "utf8").split("\n").filter(Boolean);
            for (const p of gone) if (on.has(p)) console.log(p);' "$HERE/server-check.js" "$WORK/after.txt" < <(printf '%s\n' "${GONE[@]}"))"
        if [ -n "$STILL" ]; then
            echo "::error::Still on the server after the tidy-up: $(echo "$STILL" | tr '\n' ' ')"
            exit 2
        fi
        echo "Deleted ${#GONE[@]} file(s); the server no longer lists any of them." | tee -a "${GITHUB_STEP_SUMMARY:-/dev/null}"
    fi
    if [ -n "$COPY" ]; then
        N="$(node -e 'const { parseListing } = require(process.argv[1]); const fs = require("fs");
            const d = process.argv[3] + "/";
            console.log(parseListing(fs.readFileSync(process.argv[2], "utf8")).filter((r) => r.path.startsWith(d)).length);' \
            "$HERE/server-check.js" "$WORK/listing.txt" "$COPY")"
        {
            echo
            echo "## The copy of the site in $COPY/"
            echo
            if [ "$TIDY" = "apply" ]; then echo "Deleting the whole folder ($N entries)."; else echo "The whole folder ($N entries) would be deleted (run it again with the box ticked)."; fi
        } | tee -a "${GITHUB_STEP_SUMMARY:-/dev/null}"
        if [ "$TIDY" = "apply" ]; then
            bash "$HERE/sftp.sh" "cd \"$ROOT\"; rm -r \"$COPY\"" || echo "::error::The server refused part of the deletion; the listing below says what is left."
            bash "$HERE/sftp.sh" "cd \"$ROOT\"; find -l ." > "$WORK/after-copy.txt"
            LEFT="$(node -e 'const { parseListing } = require(process.argv[1]); const fs = require("fs");
                const d = process.argv[3];
                console.log(parseListing(fs.readFileSync(process.argv[2], "utf8")).filter((r) => r.path === d || r.path.startsWith(d + "/")).length);' \
                "$HERE/server-check.js" "$WORK/after-copy.txt" "$COPY")"
            if [ "$LEFT" != "0" ]; then
                echo "::error::$LEFT entries are still in $COPY/ after the deletion."
                exit 2
            fi
            echo "Deleted $COPY/; the server no longer lists it." | tee -a "${GITHUB_STEP_SUMMARY:-/dev/null}"
        fi
    fi
fi

# 7. Tell the site, so Manage → Status and Needs attention say it too (job key only).
if [ "$STATUS" -le 1 ] && [ -s "$WORK/result.json" ] && [ -n "${APP_SECRET:-}${CRON_SECRET:-}" ]; then
    . "$HERE/site-job.sh"
    job 30 "server-check.php?cron" -X POST -H 'Content-Type: application/json' --data-binary @"$WORK/result.json" \
        || echo "::warning::Could not tell the site what the check found."
fi
exit "$STATUS"
