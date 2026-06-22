#!/bin/bash
# Daily sync guard — called by launchd on every hourly tick and on wake.
#
# Two stages, each gated by its own date-stamp in $STATE_DIR:
#   1. ingest      → last-ingest-date     (src/index.js --mode=sync)
#                    Internally runs tier-1 wiki synthesis for categories with
#                    new posts — no separate tier-1 stage needed.
#   2. projects    → last-projects-date   (src/synthesize-projects.js)
#
# Stamp policy:
#   - Ingest stamps only on SUCCESS. A transient failure (LinkedIn glitch,
#     network blip, API throttle) gets a fresh shot next hour. The ingest path
#     is cheap when there's nothing new — categorization only fires on truly
#     new items — so hourly retries are safe.
#   - Projects stamps on EVERY attempt. `claude -p` failures (budget cap, credit
#     exhaustion, timeout) are non-transient and would burn tokens on each hourly
#     retry. Wait for tomorrow.
#
# Failures append to $STATE_DIR/run-failures.log (synthesis diagnostics to
# $STATE_DIR/synth-failures.log) so a dead sync is diagnosable. Run
# `npm run doctor` for a full health report.

set -u

STATE_DIR="${STATE_DIR:-$HOME/.personal-wiki}"
TODAY=$(date +%Y-%m-%d)
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

# Run a stage if its stamp file isn't already today.
# $1 label, $2 stamp filename, $3 stamp policy (always|on-success), rest = command
run_stage() {
  local label="$1"
  local stamp="$STATE_DIR/$2"
  local policy="$3"
  shift 3

  # Already succeeded today → nothing to do.
  if [ -f "$stamp" ] && [ "$(cat "$stamp")" = "$TODAY" ]; then
    return 0
  fi

  echo "──── $label ────"
  if [ "$policy" = "always" ]; then
    echo "$TODAY" > "$stamp"
  fi
  if "$@"; then
    [ "$policy" = "on-success" ] && echo "$TODAY" > "$stamp"
    return 0
  else
    local rc=$?
    echo "$(date '+%F %T') ⚠️  $label failed (exit $rc)" >> "$FAIL_LOG"
    if [ "$policy" = "on-success" ]; then
      echo "⚠️  $label failed (exit $rc) — will retry on the next hourly tick"
    else
      echo "⚠️  $label failed (exit $rc) — will retry tomorrow, not this hour"
    fi
    return $rc
  fi
}

# Track whether any stage failed so we surface a non-zero overall exit.
overall=0

run_stage "ingest"   last-ingest-date   on-success "$NODE" src/index.js --mode=sync   || overall=1
run_stage "projects" last-projects-date always     "$NODE" src/synthesize-projects.js || overall=1

exit $overall
