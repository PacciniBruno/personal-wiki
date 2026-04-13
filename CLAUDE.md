# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# LinkedIn → Knowledge Base Sync

Scrapes LinkedIn saved posts (no official API), categorizes them with Claude Haiku,
and writes them into a local markdown knowledge base at `~/knowledge/`.

## Commands

```bash
npm run init-kb          # Create ~/knowledge/ structure (run once before first sync)
npm run bootstrap        # Full import of all saved posts + wiki synthesis
npm run sync             # Incremental sync (new posts only) + wiki synthesis
npm run update-wiki      # Re-run tier-1 wiki synthesis for all categories (manual)
npm run update-wiki:cross# Run tier-2 cross-domain synthesis → synthesis.md (manual)
DEBUG=1 npm run sync     # Verbose: logs all Voyager URLs, saves debug JSON files
```

## Architecture

Pipeline in `src/index.js` runs 5 steps: scrape → categorize → write to raw/ → update wiki pages → (done).

```
src/
  index.js         CLI orchestrator. Reads --mode=bootstrap|sync.
  scraper.js       Puppeteer opens Chrome (visible). Intercepts LinkedIn Voyager API,
                   captures auth headers, paginates via native fetch(). Unchanged.
  categorize.js    Claude Haiku (claude-haiku-4-5-20251001). Returns category,
                   subcategory, tags[], summary per post. 150ms delay. Unchanged.
  state.js         Loads/saves ~/.linkedin-notion-sync/state.json (knownKeys for dedup).
  writer.js        Appends formatted post entries to ~/knowledge/raw/{slug}.md.
                   Updates ~/knowledge/index.md counts. Appends to log.md.
  init-kb.js       Creates ~/knowledge/ folder structure, CLAUDE.md, index.md, log.md,
                   synthesis.md, and empty raw/ + wiki/ topic files. Idempotent.
  synthesize.js    Two-tier wiki synthesis via `claude -p` (full Claude Code harness):
                   - Tier 1 (daily): parallel claude -p per updated category →
                     updates ~/knowledge/wiki/{slug}.md
                   - Tier 2 (weekly): single claude -p reads all wiki/ pages →
                     updates ~/knowledge/synthesis.md (cross-domain patterns)
```

## Knowledge base structure

```
~/knowledge/
  CLAUDE.md             # Navigation guide for any Claude session
  index.md              # Topic index with post counts and last-updated dates
  log.md                # Append-only ingest log ([INGEST] / [REMOVED] prefixes)
  synthesis.md          # Cross-domain patterns, helicopter view (weekly)
  raw/                  # Source posts, append-only, one file per category
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
  wiki/                 # LLM-synthesized living pages (same filenames as raw/)
```

## State persistence

`~/.linkedin-notion-sync/state.json` stores:
- `knownKeys` — array of all post URLs/URNs already written (for dedup + sync stopping)

`~/.linkedin-notion-sync/chrome-session/` — Puppeteer user data. LinkedIn session
persists here so login only needed once.

## Environment variables (.env)

```
ANTHROPIC_API_KEY=sk-ant-...   # console.anthropic.com — required
```

No longer needed: `NOTION_TOKEN`, `NOTION_PARENT_PAGE_ID`, `VOYAGE_API_KEY`.

## Automation (launchd)

Two plists in `scripts/` — copy to `~/Library/LaunchAgents/` and `launchctl load`:

- `com.brunopaccini.linkedin-sync.plist` — daily 08:00: sync + tier-1 wiki update
- `com.brunopaccini.linkedin-synthesis.plist` — weekly Sunday 09:00: tier-2 synthesis

Chrome opens briefly and closes automatically (session is persisted). No manual
intervention needed once the LinkedIn session is established.

## How the LinkedIn scraping works

LinkedIn's internal "Voyager" API is intercepted via Puppeteer response listeners.
Auth uses two cookies: `li_at` (session) + `JSESSIONID` (also the CSRF token).
The scraper handles both REST (`body.elements`) and GraphQL (`body.included` with
`EntityResultViewModel`) response formats.

## Unsave detection

Only runs in bootstrap mode (full scan). Posts in `knownKeys` but absent from
LinkedIn's current response are marked `[REMOVED date]` in the raw file and logged.
The wiki layer is left intact — manually edit if needed.

## Debugging

```bash
DEBUG=1 npm run bootstrap
```

Saves `./debug-first-response.json` and `./debug-all-voyager.json`. If the scraper
fails to intercept, check the Voyager URL patterns and response structure in these files,
then update `extractElements()` and `looksLikePost()` in scraper.js.

## Key constraints when making changes

- **ESM only** — `"type": "module"` in package.json. Use `import/export`, not `require`.
- **`claude -p` path** — `synthesize.js` uses `CLAUDE_BIN` env var (fallback hardcoded).
  If the claude CLI moves, update the launchd plists and the fallback in synthesize.js.
- **Pagination** — `buildPaginatedUrl()` handles REST (`?start=N`), GraphQL
  (`?variables=(start:N,...)`), and cursor-based pagination. LinkedIn changes this.
- **Dedup key** — `post.uniqueKey` = URL if available, else URN. Stored in state.json.
  Sync stops on first post whose uniqueKey is in knownKeys.
