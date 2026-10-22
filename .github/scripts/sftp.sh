#!/usr/bin/env bash
# Runs lftp commands against the web host. The ONE place for the connection settings,
# used by the live deploy, the staging deploy and the server file check.
#
#   HOST=… USERNAME=… LFTP_PASSWORD=… [PORT=22] sftp.sh '<lftp commands>'
#
# - cmd:fail-exit: a failed transfer fails the job. Without it lftp can finish with
#   files un-uploaded and still exit 0 (that once shipped accounts.php requiring a lib
#   that never arrived).
# - xfer:use-temp-file: each upload lands by RENAME from a temporary *.lftp name, so a
#   live request only ever compiles the old file or the new one, never half of one
#   (htaccess refuses *.lftp, so a temp file is never a reachable route).
# - The password comes from LFTP_PASSWORD via --env-password: never on a command line.
# - The server's host key is checked against .github/sftp-host-keys (public keys, one
#   "type base64" per line, no host name, because the host name is a secret). Until
#   that file exists the key is accepted unchecked, with a warning on every run.
set -euo pipefail

: "${HOST:?HOST is not set}"
: "${USERNAME:?USERNAME is not set}"
: "${LFTP_PASSWORD:?LFTP_PASSWORD is not set}"
PORT="${PORT:-22}"
KEYS="${SFTP_HOST_KEYS:-$(dirname "$0")/../sftp-host-keys}"

if [ -s "$KEYS" ] && grep -qvE '^[[:space:]]*(#|$)' "$KEYS"; then
    KNOWN="$(mktemp)"
    if [ "$PORT" = 22 ]; then NAME="$HOST"; else NAME="[$HOST]:$PORT"; fi
    grep -vE '^[[:space:]]*(#|$)' "$KEYS" | while read -r type key _; do
        printf '%s %s %s\n' "$NAME" "$type" "$key"
    done > "$KNOWN"
    HOSTKEY="set sftp:connect-program \"ssh -a -x -o StrictHostKeyChecking=yes -o UserKnownHostsFile=$KNOWN\";"
else
    echo "::warning::The SFTP host key is not pinned (.github/sftp-host-keys is empty), so the server's key is accepted unchecked." >&2
    HOSTKEY="set sftp:auto-confirm yes;"
fi

exec lftp -u "$USERNAME" --env-password "sftp://$HOST:$PORT" \
    -e "set cmd:fail-exit yes; $HOSTKEY set net:max-retries 3; set net:reconnect-interval-base 5; set xfer:use-temp-file yes; set xfer:temp-file-name '*.lftp'; $1; bye" \
    < /dev/null
