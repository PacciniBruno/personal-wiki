#!/bin/bash
# Daily synthesis guard — runs at most once per calendar day.
# Called by launchd on every hourly tick and on wake from sleep.
#
# Stamp is written BEFORE the run so the day is consumed even if tier-2
# fails. This is intentional: tier-2 failures (budget cap, credit exhaustion,
# timeout) are non-transient, and retrying every hour burns tokens with no
# chance of success. A failure waits for tomorrow; re-run manually with
# `npm run update-wiki:cross` if needed.
#
# Failures append to $STATE_DIR/run-failures.log (per-call diagnostics to
# $STATE_DIR/synth-failures.log). Run `npm run doctor` for a health report.

set -u

STATE_DIR="${STATE_DIR:-$HOME/.personal-wiki}"
STAMP="$STATE_DIR/last-synthesis-date"
TODAY=$(date +%Y-%m-%d)
FAIL_LOG="$STATE_DIR/run-failures.log"

mkdir -p "$STATE_DIR"

if [ -f "$STAMP" ] && [ "$(cat "$STAMP")" = "$TODAY" ]; then
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

echo "$TODAY" > "$STAMP"
if "$NODE" src/synthesize.js --tier=2; then
  exit 0
else
  rc=$?
  echo "$(date '+%F %T') ⚠️  tier-2 synthesis failed (exit $rc)" >> "$FAIL_LOG"
  echo "⚠️  tier-2 synthesis failed (exit $rc) — will retry tomorrow (see $STAMP)"
  exit $rc
fi
