#!/bin/bash
# Daily synthesis guard — runs at most once per calendar day.
# Called by launchd on every hourly tick and on wake from sleep.
#
# Stamp is written BEFORE the run so the day is consumed even if tier-2
# fails. This is intentional: tier-2 failures (budget cap, credit exhaustion,
# timeout) are non-transient, and retrying every hour burns tokens with no
# chance of success. A failure waits for tomorrow; re-run manually with
# `npm run update-wiki:cross` if needed.

set -u

STATE_DIR="${STATE_DIR:-$HOME/.personal-wiki}"
STAMP="$STATE_DIR/last-synthesis-date"
TODAY=$(date +%Y-%m-%d)

mkdir -p "$STATE_DIR"

if [ -f "$STAMP" ] && [ "$(cat "$STAMP")" = "$TODAY" ]; then
  exit 0
fi

NODE="$(command -v node)"
DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$DIR"

echo "$TODAY" > "$STAMP"
if "$NODE" src/synthesize.js --tier=2; then
  exit 0
else
  rc=$?
  echo "⚠️  tier-2 synthesis failed (exit $rc) — will retry tomorrow (see $STAMP)"
  exit $rc
fi
