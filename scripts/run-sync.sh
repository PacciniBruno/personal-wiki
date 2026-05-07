#!/bin/bash
# Daily sync guard — runs at most once per calendar day.
# Called by launchd on every hourly tick and on wake from sleep.
# Exits immediately (no-op) if already ran today.

STATE_DIR="${STATE_DIR:-$HOME/.personal-wiki}"
STAMP="$STATE_DIR/last-sync-date"
TODAY=$(date +%Y-%m-%d)

if [ -f "$STAMP" ] && [ "$(cat "$STAMP")" = "$TODAY" ]; then
  exit 0
fi

NODE="$(command -v node)"
DIR="$(cd "$(dirname "$0")/.." && pwd)"

cd "$DIR"
"$NODE" src/index.js --mode=sync --source=all \
  && "$NODE" src/synthesize.js --tier=1 \
  && "$NODE" src/synthesize-projects.js \
  || exit 1

# Write stamp after success so a failure retries on next wake
mkdir -p "$STATE_DIR"
echo "$TODAY" > "$STAMP"
