#!/bin/bash
# Daily sync guard — runs at most once per calendar day, per stage.
# Called by launchd on every hourly tick and on wake from sleep.
#
# Two independent stages, each gated by its own date-stamp in $STATE_DIR:
#   1. ingest      → last-ingest-date     (src/index.js --mode=sync)
#                    Internally runs tier-1 wiki synthesis for categories with
#                    new posts — no separate tier-1 stage needed.
#   2. projects    → last-projects-date   (src/synthesize-projects.js)
#
# A stage runs iff its stamp != today. Stamp is written on EVERY attempt
# (success or failure), so a stage runs at most once per calendar day. Hourly
# retries on transient failure are not safe here: `claude -p` failures
# (budget cap, credit exhaustion, timeout) are non-transient and burn tokens
# on every retry. A failure today is retried tomorrow, never the same day.
#
# Synthesis failures append diagnostics to $STATE_DIR/synth-failures.log so
# you can inspect them and re-run manually if needed.

set -u

STATE_DIR="${STATE_DIR:-$HOME/.personal-wiki}"
TODAY=$(date +%Y-%m-%d)

mkdir -p "$STATE_DIR"

NODE="$(command -v node)"
DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$DIR"

# Run $1 (the node script + args, as a single command) if $2 (stamp file) is
# not already today. The stamp is written BEFORE the run so a crash mid-stage
# still counts as "attempted today" — preventing hourly retry loops.
run_stage() {
  local label="$1"
  local stamp="$STATE_DIR/$2"
  shift 2

  if [ -f "$stamp" ] && [ "$(cat "$stamp")" = "$TODAY" ]; then
    return 0
  fi

  echo "──── $label ────"
  echo "$TODAY" > "$stamp"
  if "$@"; then
    return 0
  else
    local rc=$?
    echo "⚠️  $label failed (exit $rc) — will retry tomorrow, not this hour"
    return $rc
  fi
}

# Track whether any stage failed so we surface a non-zero overall exit.
overall=0

run_stage "ingest"   last-ingest-date   "$NODE" src/index.js --mode=sync               || overall=1
run_stage "projects" last-projects-date "$NODE" src/synthesize-projects.js             || overall=1

exit $overall
