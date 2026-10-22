# Sourced (`. .github/scripts/site-job.sh`) by the workflows that start one of the
# site's scheduled jobs: the deploy's post-deploy steps and the server file check.
#
# Sets KEY, the job key exactly as cron-lib.php's cron_key() works it out: CRON_SECRET
# when it is 20+ characters and not the master key, else the first 40 hex of
# HMAC-SHA256 of 'cron|v1' under APP_SECRET (test-cron-key.php holds the two equal).
# Never APP_SECRET itself: the web server logs every address it is asked for, and this
# repository's workflow logs are public, so the key is masked as well.
#
# Needs APP_SECRET (or a CRON_SECRET), and SITE_URL unless the live site is meant.

chb_job_key() {
    if [ -n "${CRON_SECRET:-}" ] && [ "${#CRON_SECRET}" -ge 20 ] && [ "$CRON_SECRET" != "${APP_SECRET:-}" ]; then
        printf '%s' "$CRON_SECRET"
    elif [ -n "${APP_SECRET:-}" ]; then
        printf '%s' 'cron|v1' | openssl dgst -sha256 -hmac "$APP_SECRET" | awk '{print $NF}' | cut -c1-40 | tr -d '\n'
    fi
}

KEY="$(chb_job_key)"
if [ -n "$KEY" ]; then echo "::add-mask::$KEY"; fi
URL="${SITE_URL:-https://cottageholidaysblakeney.co.uk}"

# One job, as cron.php's runner asks it: the key in the X-CHB-Cron header, with a
# placeholder in the address; into the address only when the site answers 401/403
# (the host dropped the header). A timeout or a 5xx is NOT asked again: the job may
# still be running. Anything after the path goes to curl (a body to post, say).
#   job <seconds> <path ending ?cron or &cron> [curl options…]
job() {
    local max="$1" path="$2" code
    shift 2
    rm -f "$RUNNER_TEMP/job.out"
    code=$(curl -sS -o "$RUNNER_TEMP/job.out" -w '%{http_code}' --max-time "$max" -H "X-CHB-Cron: $KEY" "$@" "$URL/$path=header") || code=000
    if [ "$code" = 401 ] || [ "$code" = 403 ]; then
        code=$(curl -sS -o "$RUNNER_TEMP/job.out" -w '%{http_code}' --max-time "$max" "$@" "$URL/$path=$KEY") || code=000
    fi
    cat "$RUNNER_TEMP/job.out" 2>/dev/null
    echo
    case "$code" in 2*) return 0 ;; *) return 1 ;; esac
}
