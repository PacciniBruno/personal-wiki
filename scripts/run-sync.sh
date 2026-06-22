#!/bin/bash
# Daily sync guard — runs each stage at most once per calendar day ON SUCCESS,
# but retries transient failures on later launchd ticks. Called by launchd on
# every hourly tick and on wake from sleep.
#
# Two independent stages, each with its own success/attempt bookkeeping in
# $STATE_DIR:
#   1. ingest      → last-ingest-date     (src/index.js --mode=sync)
#                    Internally runs tier-1 wiki synthesis for categories with
#                    new posts — no separate tier-1 stage needed.
#   2. projects    → last-projects-date   (src/synthesize-projects.js)
#
# Retry model (the fix for "sync seems dead"):
#   - A stage that SUCCEEDS stamps today's date and is skipped for the rest of
#     the day.
#   - A stage that FAILS is retried on the next tick, up to SYNC_MAX_ATTEMPTS
#     times per calendar day (default 3), then left until tomorrow.
# This bounds worst-case cost (a persistent `claude -p` budget/credit failure
# burns at most SYNC_MAX_ATTEMPTS runs, not 24) while letting genuinely
# transient failures — network not ready on wake, a momentary LinkedIn hiccup —
# self-heal instead of killing sync for the whole day.
#
# Ingest re-runs are cheap and safe: items already written are recorded in
# state.json, so a retry only processes posts that are still new, and tier-1
# synthesis only runs for categories that actually received new posts.
#
# Failures are appended to $STATE_DIR/run-failures.log (and synthesis failures
# to $STATE_DIR/synth-failures.log) so a dead sync is diagnosable. Run
# `npm run doctor` for a full health report.

set -u

STATE_DIR="${STATE_DIR:-$HOME/.personal-wiki}"
TODAY=$(date +%Y-%m-%d)
MAX_ATTEMPTS="${SYNC_MAX_ATTEMPTS:-3}"
FAIL_LOG="$STATE_DIR/run-failures.log"

mkdir -p "$STATE_DIR"

NODE="$(command -v node || true)"
DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$DIR"

# launchd runs with a minimal PATH; if node isn't resolvable nothing runs and
# the failure is otherwise invisible. Surface it loudly.
if [ -z "$NODE" ]; then
  echo "$(date '+%F %T') ❌ ingest+projects skipped: node not found in PATH ($PATH)" >> "$FAIL_LOG"
  echo "❌ node not found in PATH. Re-run 'npm run setup' so launchd gets the right PATH."
  exit 127
fi

# Run "$@" if the stage hasn't already succeeded today and still has attempts
# left. Stamps the success date on success; records the attempt either way.
#   $1 = label   $2 = stamp basename (without dir)
run_stage() {
  local label="$1"
  local base="$2"
  shift 2
  local done_stamp="$STATE_DIR/$base"
  local attempt_stamp="$STATE_DIR/$base.attempts"

  # Already succeeded today → nothing to do.
  if [ -f "$done_stamp" ] && [ "$(cat "$done_stamp")" = "$TODAY" ]; then
    return 0
  fi

  # Read today's attempt count (resets when the date rolls over).
  local a_day="" a_n=0
  if [ -f "$attempt_stamp" ]; then
    read -r a_day a_n < "$attempt_stamp" || true
  fi
  [ "$a_day" = "$TODAY" ] || a_n=0

  if [ "$a_n" -ge "$MAX_ATTEMPTS" ]; then
    return 0   # exhausted today's attempts — wait for tomorrow
  fi

  local attempt=$((a_n + 1))
  echo "$TODAY $attempt" > "$attempt_stamp"

  echo "──── $label (attempt $attempt/$MAX_ATTEMPTS) ────"
  "$@"
  local rc=$?
  if [ "$rc" -eq 0 ]; then
    echo "$TODAY" > "$done_stamp"
    return 0
  fi

  echo "$(date '+%F %T') ⚠️  $label failed (exit $rc), attempt $attempt/$MAX_ATTEMPTS" >> "$FAIL_LOG"
  echo "⚠️  $label failed (exit $rc) — will retry on the next tick ($attempt/$MAX_ATTEMPTS today)"
  return $rc
}

# Track whether any stage failed so we surface a non-zero overall exit.
overall=0

run_stage "ingest"   last-ingest-date   "$NODE" src/index.js --mode=sync   || overall=1
run_stage "projects" last-projects-date "$NODE" src/synthesize-projects.js || overall=1

exit $overall
