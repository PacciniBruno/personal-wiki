#!/bin/bash
# Weekly synthesis guard — runs at most once per ISO week.
# Called by launchd on every hourly tick and on wake from sleep.
# Exits immediately (no-op) if already ran this week.

STAMP="$HOME/.linkedin-notion-sync/last-synthesis-week"
THIS_WEEK=$(date +%Y-W%V)   # e.g. 2026-W15

if [ -f "$STAMP" ] && [ "$(cat "$STAMP")" = "$THIS_WEEK" ]; then
  exit 0
fi

NODE="/Users/brunopaccini/.nvm/versions/node/v22.14.0/bin/node"
DIR="/Users/brunopaccini/Documents/Dev/linkedin-notion-sync"

cd "$DIR"

"$NODE" src/synthesize.js --tier=2

# Write stamp after success so a failure retries on next wake
echo "$THIS_WEEK" > "$STAMP"
