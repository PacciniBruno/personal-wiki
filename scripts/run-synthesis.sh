#!/bin/bash
# Weekly synthesis guard — runs at most once per ISO week.
# Called by launchd on every hourly tick and on wake from sleep.
# Exits immediately (no-op) if already ran this week.

STATE_DIR="${STATE_DIR:-$HOME/.personal-wiki}"
STAMP="$STATE_DIR/last-synthesis-week"
THIS_WEEK=$(date +%Y-W%V)   # e.g. 2026-W15

if [ -f "$STAMP" ] && [ "$(cat "$STAMP")" = "$THIS_WEEK" ]; then
  exit 0
fi

NODE="$(command -v node)"
DIR="$(cd "$(dirname "$0")/.." && pwd)"

cd "$DIR"
"$NODE" src/synthesize.js --tier=2

# Write stamp after success so a failure retries on next wake
mkdir -p "$STATE_DIR"
echo "$THIS_WEEK" > "$STAMP"
