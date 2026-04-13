#!/bin/bash
# Daily sync guard — runs at most once per calendar day.
# Called by launchd on every hourly tick and on wake from sleep.
# Exits immediately (no-op) if already ran today.

STAMP="$HOME/.linkedin-notion-sync/last-sync-date"
TODAY=$(date +%Y-%m-%d)

if [ -f "$STAMP" ] && [ "$(cat "$STAMP")" = "$TODAY" ]; then
  exit 0
fi

NODE="/Users/brunopaccini/.nvm/versions/node/v22.14.0/bin/node"
DIR="/Users/brunopaccini/Documents/Dev/linkedin-notion-sync"

cd "$DIR"

"$NODE" src/index.js --mode=sync && "$NODE" src/synthesize.js --tier=1

# Write stamp after success so a failure retries on next wake
echo "$TODAY" > "$STAMP"
