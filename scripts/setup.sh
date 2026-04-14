#!/bin/bash
# setup.sh — Install personal-wiki launchd automation (macOS only).
#
# Generates and installs two launchd agents:
#   com.$USER.personal-wiki-sync      — daily sync + wiki update
#   com.$USER.personal-wiki-synthesis — weekly cross-domain synthesis
#
# Usage:
#   npm run setup
#   # or directly:
#   bash scripts/setup.sh

set -e

USERNAME=$(whoami)
NODE=$(command -v node || true)
DIR="$(cd "$(dirname "$0")/.." && pwd)"
AGENTS_DIR="$HOME/Library/LaunchAgents"

# ── Checks ────────────────────────────────────────────────────────────────────

if [ "$(uname)" != "Darwin" ]; then
  echo "❌ Automation setup is macOS only (launchd). Skipping."
  exit 0
fi

if [ -z "$NODE" ]; then
  echo "❌ node not found in PATH. Install Node.js first."
  exit 1
fi

echo "Setting up personal-wiki automation..."
echo "  User:    $USERNAME"
echo "  Node:    $NODE"
echo "  Project: $DIR"
echo ""

mkdir -p "$AGENTS_DIR"

# ── Sync agent ────────────────────────────────────────────────────────────────

SYNC_LABEL="com.$USERNAME.personal-wiki-sync"
SYNC_PLIST="$AGENTS_DIR/$SYNC_LABEL.plist"

cat > "$SYNC_PLIST" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$SYNC_LABEL</string>

  <key>ProgramArguments</key>
  <array>
    <string>/bin/sh</string>
    <string>$DIR/scripts/run-sync.sh</string>
  </array>

  <key>EnvironmentVariables</key>
  <dict>
    <key>HOME</key>
    <string>$HOME</string>
    <key>PATH</key>
    <string>$(dirname "$NODE"):/usr/local/bin:/usr/bin:/bin</string>
  </dict>

  <key>StartInterval</key>
  <integer>3600</integer>

  <key>RunAtLoad</key>
  <true/>

  <key>StandardOutPath</key>
  <string>$HOME/Library/Logs/personal-wiki-sync.log</string>
  <key>StandardErrorPath</key>
  <string>$HOME/Library/Logs/personal-wiki-sync.error.log</string>
</dict>
</plist>
EOF

# ── Synthesis agent ───────────────────────────────────────────────────────────

SYNTH_LABEL="com.$USERNAME.personal-wiki-synthesis"
SYNTH_PLIST="$AGENTS_DIR/$SYNTH_LABEL.plist"

cat > "$SYNTH_PLIST" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$SYNTH_LABEL</string>

  <key>ProgramArguments</key>
  <array>
    <string>/bin/sh</string>
    <string>$DIR/scripts/run-synthesis.sh</string>
  </array>

  <key>EnvironmentVariables</key>
  <dict>
    <key>HOME</key>
    <string>$HOME</string>
    <key>PATH</key>
    <string>$(dirname "$NODE"):/usr/local/bin:/usr/bin:/bin</string>
  </dict>

  <key>StartInterval</key>
  <integer>3600</integer>

  <key>RunAtLoad</key>
  <true/>

  <key>StandardOutPath</key>
  <string>$HOME/Library/Logs/personal-wiki-synthesis.log</string>
  <key>StandardErrorPath</key>
  <string>$HOME/Library/Logs/personal-wiki-synthesis.error.log</string>
</dict>
</plist>
EOF

# ── Load agents ───────────────────────────────────────────────────────────────

for PLIST in "$SYNC_PLIST" "$SYNTH_PLIST"; do
  LABEL=$(basename "$PLIST" .plist)
  # Unload if already running (ignore errors)
  launchctl unload "$PLIST" 2>/dev/null || true
  launchctl load "$PLIST"
  echo "✅ Loaded: $LABEL"
done

echo ""
echo "Done. Agents will run on every wake from sleep."
echo "Logs: ~/Library/Logs/personal-wiki-*.log"
