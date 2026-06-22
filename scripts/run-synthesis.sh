#!/bin/bash
# Daily tier-2 synthesis guard. Called by launchd on every hourly tick and on
# wake from sleep.
#
# Runs at most once per calendar day ON SUCCESS, but retries a failure on later
# ticks up to SYNTH_RUN_MAX_ATTEMPTS times per day (default 2), then waits for
# tomorrow. tier-2 failures are often non-transient (budget cap, credit
# exhaustion), so the cap is low to bound cost — but unlike the old
# stamp-before-run guard, a single transient failure (e.g. network not ready on
# wake) no longer kills synthesis for the whole day. Re-run manually any time
# with `npm run update-wiki:cross`.
#
# Failures are appended to $STATE_DIR/run-failures.log; per-call diagnostics go
# to $STATE_DIR/synth-failures.log. Run `npm run doctor` for a health report.

set -u

STATE_DIR="${STATE_DIR:-$HOME/.personal-wiki}"
TODAY=$(date +%Y-%m-%d)
MAX_ATTEMPTS="${SYNTH_RUN_MAX_ATTEMPTS:-2}"
DONE_STAMP="$STATE_DIR/last-synthesis-date"
ATTEMPT_STAMP="$STATE_DIR/last-synthesis-date.attempts"
FAIL_LOG="$STATE_DIR/run-failures.log"

mkdir -p "$STATE_DIR"

# Already succeeded today?
if [ -f "$DONE_STAMP" ] && [ "$(cat "$DONE_STAMP")" = "$TODAY" ]; then
  exit 0
fi

NODE="$(command -v node || true)"
DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$DIR"

if [ -z "$NODE" ]; then
  echo "$(date '+%F %T') ❌ synthesis skipped: node not found in PATH ($PATH)" >> "$FAIL_LOG"
  echo "❌ node not found in PATH. Re-run 'npm run setup' so launchd gets the right PATH."
  exit 127
fi

# Today's attempt budget (resets when the date rolls over).
a_day="" a_n=0
if [ -f "$ATTEMPT_STAMP" ]; then
  read -r a_day a_n < "$ATTEMPT_STAMP" || true
fi
[ "$a_day" = "$TODAY" ] || a_n=0

if [ "$a_n" -ge "$MAX_ATTEMPTS" ]; then
  exit 0   # exhausted today's attempts — wait for tomorrow
fi

attempt=$((a_n + 1))
echo "$TODAY $attempt" > "$ATTEMPT_STAMP"

echo "──── tier-2 synthesis (attempt $attempt/$MAX_ATTEMPTS) ────"
"$NODE" src/synthesize.js --tier=2
rc=$?
if [ "$rc" -eq 0 ]; then
  echo "$TODAY" > "$DONE_STAMP"
  exit 0
fi

echo "$(date '+%F %T') ⚠️  tier-2 synthesis failed (exit $rc), attempt $attempt/$MAX_ATTEMPTS" >> "$FAIL_LOG"
echo "⚠️  tier-2 synthesis failed (exit $rc) — will retry on the next tick ($attempt/$MAX_ATTEMPTS today)"
exit $rc
