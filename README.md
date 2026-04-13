# personal-wiki

An AI-powered personal knowledge base that ingests content you save across multiple sources, categorizes it with Claude, and synthesizes it into a living wiki — automatically.

## How it works

```
Sources → Categorize (Claude Haiku) → raw/ → Wiki synthesis (Claude) → wiki/
```

Two-layer knowledge base at `~/knowledge/` (configurable):

- `raw/` — source material, append-only, one file per topic
- `wiki/` — LLM-synthesized living pages, updated after each sync
- `synthesis.md` — cross-domain patterns, updated weekly

## Sources

| Source | How to save | Status |
|--------|-------------|--------|
| **LinkedIn** | Native saved posts | Supported |
| **Obsidian** | Web Clipper → tag with `#wiki` | Supported |
| **Apple Notes** | iPhone Share → "Saved Notes" folder | Supported |
| **Twitter/X** | Saved posts | Planned |

Sources are opt-in: if a source is not configured, it is silently skipped.

## Requirements

- Node.js 18+
- [Claude Code CLI](https://claude.ai/code) (`npm install -g @anthropic-ai/sdk`)
- An [Anthropic API key](https://console.anthropic.com)
- Chrome (for LinkedIn scraping via Puppeteer)

## Setup

```bash
git clone https://github.com/YOUR_USERNAME/personal-wiki
cd personal-wiki
npm install
cp .env.example .env
# Edit .env — at minimum, set ANTHROPIC_API_KEY
npm run init-kb    # Creates ~/knowledge/ structure (run once)
```

## Configuration

All configuration lives in `.env`. See `.env.example` for the full reference.

**Required:**

```env
ANTHROPIC_API_KEY=sk-ant-...
```

**Optional paths** (defaults shown):

```env
KB_DIR=~/knowledge          # knowledge base root
STATE_DIR=~/.personal-wiki  # state & Chrome session
CLAUDE_BIN=claude           # path to claude CLI (auto-detected)
```

**Sources** (disabled if not set):

```env
# Obsidian
OBSIDIAN_VAULT=/path/to/your/vault
OBSIDIAN_SYNC_TAG=wiki        # tag that marks a note for ingestion

# Apple Notes
APPLE_NOTES_FOLDER=Saved Notes
```

**Personalization:**

```env
USER_CONTEXT=a founder and product leader focused on AI startups
```

This one sentence is injected into the categorization prompt, helping Claude make better-informed decisions about how to classify your content.

## Commands

```bash
npm run init-kb           # Create ~/knowledge/ structure (run once)
npm run bootstrap         # Full import of all saved posts + wiki synthesis
npm run sync              # Incremental sync (new posts only) + wiki synthesis
npm run update-wiki       # Re-run tier-1 wiki synthesis for all categories
npm run update-wiki:cross # Run tier-2 cross-domain synthesis → synthesis.md

DEBUG=1 npm run sync      # Verbose: log all Voyager URLs, save debug JSON files
```

## Sources setup

### LinkedIn

No configuration needed beyond the API key. On first run, Chrome opens and prompts you to log in. The session is persisted — you only need to log in once.

### Obsidian

1. Install the [Obsidian Web Clipper](https://obsidian.md/clipper) Chrome extension
2. Set `OBSIDIAN_VAULT` in `.env` to your vault path
3. Tag any note with `#wiki` (or your custom `OBSIDIAN_SYNC_TAG`) to include it in the next sync

After syncing, the tag is replaced with `#wiki-synced` so it won't be re-processed.

### Apple Notes

On iPhone: **Share → Notes** → save to the folder named in `APPLE_NOTES_FOLDER` (default: `Saved Notes`).

The sync pipeline reads that folder via AppleScript, extracts URLs from each note, fetches the article content, and ingests it. Notes are moved out of the folder after processing.

## Automation (macOS)

Two launchd agents run the pipeline automatically — copy and configure the templates in `scripts/`:

```bash
# 1. Copy templates
cp scripts/com.YOUR_USERNAME.personal-wiki-sync.plist.template \
   ~/Library/LaunchAgents/com.YOUR_USERNAME.personal-wiki-sync.plist

cp scripts/com.YOUR_USERNAME.personal-wiki-synthesis.plist.template \
   ~/Library/LaunchAgents/com.YOUR_USERNAME.personal-wiki-synthesis.plist

# 2. Edit both copies — replace YOUR_USERNAME, YOUR_NODE_PATH, YOUR_PROJECT_PATH
#    Run `whoami`, `which node`, `pwd` to get the right values.

# 3. Load the agents
launchctl load ~/Library/LaunchAgents/com.YOUR_USERNAME.personal-wiki-sync.plist
launchctl load ~/Library/LaunchAgents/com.YOUR_USERNAME.personal-wiki-synthesis.plist
```

| Agent | Schedule | What it does |
|-------|----------|-------------|
| `personal-wiki-sync` | Daily (first wake) | Sync all sources + tier-1 wiki update |
| `personal-wiki-synthesis` | Weekly Sunday | Cross-domain synthesis → `synthesis.md` |

Logs: `~/Library/Logs/personal-wiki-sync.log` and `personal-wiki-synthesis.log`.

## Knowledge base structure

```
~/knowledge/           (KB_DIR)
  index.md             topic overview with post counts
  synthesis.md         cross-domain patterns (weekly)
  log.md               append-only ingest log
  raw/                 source material, one file per topic
    ai-technology.md
    career-work.md
    investing-finance.md
    leadership-management.md
    marketing-growth.md
    mindset-personal-dev.md
    other.md
    product-ux.md
    sales-business-dev.md
    startup-entrepreneurship.md
  wiki/                synthesized living pages (same filenames as raw/)
```

## Debugging

```bash
DEBUG=1 npm run bootstrap
```

Saves `debug-first-response.json` and `debug-all-voyager.json` in the project root with raw LinkedIn API responses. Useful if the scraper stops working after a LinkedIn API change.

## State

`~/.personal-wiki/state.json` (or `$STATE_DIR/state.json`) stores:
- `knownKeys` — all post URLs/URNs already ingested (for dedup and sync stopping)

`~/.personal-wiki/chrome-session/` — Puppeteer Chrome profile. LinkedIn session persists here.

## Architecture

```
src/
  config.js      Central config — all paths and feature flags, reads from .env
  index.js       CLI orchestrator (--mode=bootstrap|sync)
  sources/
    linkedin/
      session.js   Puppeteer + LinkedIn Voyager API interception
      parser.js    Response parsing → normalized SourceItems
      index.js     Adapter (implements SourceAdapter contract)
    twitter/       Placeholder adapter
    apple-notes/   Placeholder adapter
    web/           Placeholder adapter (Obsidian Web Clipper)
  pipeline/
    ingest.js      fetch → filter → categorize → write → state update
    dedupe.js      Source-aware dedup helpers
    filters.js     Age and known-key filters
  categorize.js  Claude Haiku — category, subcategory, tags, summary per item
  writer.js      Appends entries to raw/, updates index.md, appends to log.md
  synthesize.js  Two-tier wiki synthesis via claude -p
  state.js       Loads/saves state.json
  init-kb.js     Creates ~/knowledge/ structure (idempotent)
```

## Security notes

- Your `.env` file contains your API key — it is gitignored. Never commit it.
- LinkedIn cookies (stored in `~/.personal-wiki/chrome-session/`) give full access to your LinkedIn account. Keep that directory private.
- The pipeline only reads your saved posts — it does not post, like, or modify anything on LinkedIn.
