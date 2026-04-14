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

| Source | How to save | Notes |
|--------|-------------|-------|
| **LinkedIn** | Native saved posts | Always enabled |
| **Twitter/X** | Native bookmarks | Always enabled; first run opens Chrome for login |
| **Apple Notes** | iPhone Share → Notes → your folder | Enable via `APPLE_NOTES_FOLDER` in `.env` |
| **Web clips** | Browser → Obsidian Web Clipper → `chrome-clipped/` | Always enabled; silent if folder is empty |

Sources are opt-in where noted: if a source is not configured, it is silently skipped.

## Requirements

- Node.js 18+
- An [Anthropic API key](https://console.anthropic.com) — for categorization (Claude Haiku)
- Chrome — for LinkedIn and Twitter scraping via Puppeteer
- [Claude Code CLI](https://claude.ai/code) — **only for wiki synthesis** (`synthesize.js` calls `claude -p`). If you skip synthesis, you don't need it — the sync pipeline and raw knowledge base work without it.

## Setup

```bash
git clone https://github.com/YOUR_USERNAME/personal-wiki
cd personal-wiki
npm install
cp .env.example .env
# Edit .env — at minimum, set ANTHROPIC_API_KEY
npm run init-kb    # Creates ~/knowledge/ structure (run once)
npm run setup      # Installs launchd automation (macOS, run once)
```

### Connect the knowledge base to Claude Code

This is what makes the project useful beyond a CLI. Add one file to wire the knowledge base into every Claude Code session:

**`~/.claude/skills/kb.md`** — the YAML description is always loaded into context (Claude knows when to search); the full instructions only load when the skill is actually invoked:

```markdown
---
name: kb
description: Search your personal knowledge base — saved posts from LinkedIn, Twitter, Apple Notes, and web clips, synthesized by Claude. Use proactively when the conversation touches startups, AI, product, investing, leadership, marketing, career, mindset, or sales. Invoke this skill before answering, then weave the findings in naturally.
---

The knowledge base lives at `~/knowledge/` with two layers:

- `wiki/` — synthesized pages by topic, updated daily. Start here for themes and patterns.
- `raw/`  — source posts with original voice, URLs, and dates. Use for specific quotes.
- `synthesis.md` — cross-domain patterns, weekly helicopter view.

## How to search

Read the relevant wiki page first, then grep raw/ if you need specifics:

    wiki/ai-technology.md        wiki/marketing-growth.md
    wiki/career-work.md          wiki/mindset-personal-dev.md
    wiki/investing-finance.md    wiki/product-ux.md
    wiki/leadership-management.md wiki/sales-business-dev.md
    wiki/other.md                wiki/startup-entrepreneurship.md

## How to cite

- Always include the source URL (the `**Link:**` field in raw/ entries)
- Prefer wiki/ for broad themes, raw/ for direct quotes and original author voice
- For AI and tech posts, note the date — weight recent content higher
- Skip entries marked `[REMOVED]`
- Weave findings into your answer naturally — don't dump search results
```

Without these two files, the sync pipeline still works — but Claude won't know the knowledge base exists or search it on your behalf.

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

**Sources** (optional):

```env
# Apple Notes — folder to scan on macOS. Source is skipped if not set.
APPLE_NOTES_FOLDER=Saved Posts

# Web clips drop folder — where Obsidian Web Clipper saves .md files.
# Defaults to $KB_DIR/chrome-clipped. Set to 'false' to disable.
# WEB_CLIP_DIR=/path/to/custom/folder

# Twitter bookmarks older than this many days are skipped (default: 365)
# TWITTER_MAX_AGE_DAYS=365
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

No configuration needed beyond the API key. On first run, Chrome opens and prompts you to log in. The session is persisted in `$STATE_DIR/chrome-session/` — you only need to log in once.

### Twitter/X

No configuration needed. On first run, Chrome opens and navigates to your bookmarks page. If redirected to login, sign in with your **email and password** (not Google OAuth — Puppeteer's Chromium can't complete the Google OAuth flow). Session is persisted in `$STATE_DIR/twitter-session/`.

### Apple Notes (macOS only)

1. Set `APPLE_NOTES_FOLDER` in `.env` to the name of your Notes folder (e.g. `Saved Posts`)
2. On iPhone: **Share → Notes** → save to that folder

The sync reads that folder via AppleScript, extracts URLs from each note body, fetches the full article content, and ingests it. Notes are moved to a `"[folder] Processed"` sub-folder after processing.

### Web clips (Obsidian Web Clipper)

1. Install the [Obsidian Web Clipper](https://obsidian.md/clipper) browser extension
2. Configure it to save clips to `$KB_DIR/chrome-clipped/` (default: `~/knowledge/chrome-clipped/`)

The sync reads `.md` files from that folder, parses their frontmatter (title, url, author, date), and ingests the content. Files are moved to `chrome-clipped/processed/` after ingestion.

## Automation (macOS)

Two launchd agents keep your knowledge base up to date without any manual intervention.

### What runs when

**Daily** (`personal-wiki-sync`) — runs once on the first Mac wake-up of the day:

1. Fetches new posts from all configured sources
2. Categorizes each item with Claude Haiku
3. Appends to `raw/{category}.md`
4. Re-synthesizes only the wiki pages for categories that received new content (runs `claude -p` per category in parallel)

**Weekly** (`personal-wiki-synthesis`, Sunday) — runs once on the first wake of the week:

1. Reads all `wiki/*.md` pages
2. Identifies cross-domain patterns, tensions, and emerging signals
3. Rewrites `synthesis.md` — the 10,000ft view of your entire knowledge base

The daily guard stamps `$STATE_DIR/last-sync-date` and the weekly guard stamps `$STATE_DIR/last-synthesis-week`, so a failed run retries on the next wake rather than being skipped for the whole day/week.

### Setup

```bash
npm run setup
```

Detects your username, Node path, and project path automatically — generates and loads both agents in one step.

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

`~/.personal-wiki/state.json` (or `$STATE_DIR/state.json`) tracks per-source dedup keys and last-sync timestamps:

```json
{
  "version": 2,
  "sources": {
    "linkedin":    { "knownKeys": ["..."], "lastSyncAt": "2026-04-13T..." },
    "twitter":     { "knownKeys": ["..."], "lastSyncAt": "2026-04-13T..." },
    "apple-notes": { "knownKeys": ["..."], "lastSyncAt": "2026-04-13T..." },
    "web":         { "knownKeys": ["..."], "lastSyncAt": "2026-04-13T..." }
  }
}
```

`~/.personal-wiki/chrome-session/` — Puppeteer Chrome profile for LinkedIn (session persists here).  
`~/.personal-wiki/twitter-session/` — Puppeteer Chrome profile for Twitter/X.

## Architecture

```
src/
  config.js        Central config — all paths and feature flags, reads from .env
  index.js         CLI orchestrator (--mode=bootstrap|sync, --source=...)
  sources/
    types.js         SourceItem and SourceAdapter JSDoc contracts
    index.js         Adapter registry — add new sources here
    linkedin/
      session.js     Puppeteer + LinkedIn Voyager API interception
      parser.js      Response parsing → normalized SourceItems
      index.js       Adapter
    twitter/
      session.js     Puppeteer + Twitter Bookmarks GraphQL interception
      parser.js      Cursor-based pagination + tweet parsing
      index.js       Adapter
    apple-notes/
      index.js       AppleScript → URL extraction → article fetch → SourceItems
    web/
      index.js       Drop-folder reader for Obsidian Web Clipper .md files
  pipeline/
    ingest.js        fetch → dedup → categorize → write → state update
    dedupe.js        Source-aware knownKeys helpers
    filters.js       filterKnown (belt-and-suspenders dedup)
    fetch-article.js Shared Readability + jsdom article extractor
  categorize.js    Claude Haiku — category, subcategory, tags, summary per item
  writer.js        Appends to raw/, updates index.md, appends to log.md
  synthesize.js    Two-tier wiki synthesis via claude -p
  state.js         Loads/saves state.json (v2 schema, v1 migration included)
  init-kb.js       Creates ~/knowledge/ structure (idempotent)
```

## Security notes

- Your `.env` file contains your API key — it is gitignored. Never commit it.
- LinkedIn cookies (stored in `~/.personal-wiki/chrome-session/`) give full access to your LinkedIn account. Keep that directory private.
- The pipeline only reads your saved posts — it does not post, like, or modify anything on LinkedIn.
