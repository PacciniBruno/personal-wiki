# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# personal-wiki

Ingests content from multiple sources (LinkedIn, Obsidian, Apple Notes), categorizes
it with Claude Haiku, and writes it into a local markdown knowledge base (KB_DIR, default: `~/knowledge/`).

## Commands

```bash
npm run init-kb          # Create knowledge base structure (run once)
npm run bootstrap        # Full import of all saved posts + wiki synthesis
npm run sync             # Incremental sync (new posts only) + wiki synthesis
npm run update-wiki      # Re-run tier-1 wiki synthesis for all categories (manual)
npm run update-wiki:cross# Run tier-2 cross-domain synthesis → synthesis.md (manual)
npm run update-projects  # Re-run per-project wiki synthesis (manual)
npm run doctor           # Health check — diagnoses why sync is dead
DEBUG=1 npm run sync     # Verbose: logs all Voyager URLs, saves debug JSON files
```

## Diagnosing a dead sync

Run `npm run doctor` first — it reports node/claude resolution, the API key,
KB freshness (newest `raw/` write, per-project `wiki.md` age), per-source dedup
state, the daily run stamps, the LinkedIn cached-session age, and tails the
failure logs, then prints a verdict.

Common causes:
- **LinkedIn session expired.** A scheduled (launchd) run cannot log in
  interactively; it fails fast and skips LinkedIn (other sources still sync).
  Fix: run `npm run sync` once in a terminal to refresh the session.
- **`claude` not logged in.** Synthesis strips `ANTHROPIC_API_KEY` and uses the
  subscription, so `claude /login` must be done or all wiki/project synthesis
  fails while ingest still works.
- **node not on launchd's PATH.** Re-run `npm run setup`.

The runner scripts (`scripts/run-*.sh`) stamp a stage's success date only on
success and retry transient failures on later launchd ticks (bounded by
`SYNC_MAX_ATTEMPTS`, default 3; `SYNTH_RUN_MAX_ATTEMPTS`, default 2), so a
single momentary failure no longer kills sync for the whole day. Failures are
appended to `$STATE_DIR/{run,ingest,synth}-failures.log`.

## Architecture

```
src/
  config.js        Central config — all paths and feature flags, reads from .env
  index.js         CLI orchestrator. Reads --mode=bootstrap|sync.
  sources/linkedin/
    session.js     Puppeteer opens Chrome (visible). Intercepts LinkedIn Voyager API,
                   captures auth headers.
    parser.js      Paginates via native fetch(), parses Voyager responses → SourceItems.
    index.js       SourceAdapter: orchestrates session + parser.
  categorize.js    Claude Haiku (claude-haiku-4-5-20251001). Returns category,
                   subcategory, tags[], summary per post. 150ms delay.
  state.js         Loads/saves $STATE_DIR/state.json (knownKeys for dedup).
  writer.js        Appends formatted post entries to $KB_DIR/raw/{slug}.md.
                   Updates index.md counts. Appends to log.md.
  init-kb.js       Creates knowledge base folder structure. Idempotent.
  claude-print.js  Spawns `claude -p` with prompt fed via stdin. Shared by
                   theme synthesis and project synthesis.
  synthesize.js    Two-tier theme wiki synthesis via `claude -p`:
                   - Tier 1 (daily): parallel claude -p per updated category →
                     updates wiki/{slug}.md
                   - Tier 2 (daily): non-agentic claude -p reads all wiki/ pages,
                     the current synthesis, and recent synthesis-history.md →
                     rewrites synthesis.md + appends a dated entry to
                     synthesis-history.md (the past-days grounding log)
  projects.js      Discovers projects under $KB_DIR/projects/, parses README.md
                   manifests, computes resync needs, pre-extracts PDF text.
  synthesize-projects.js
                   Per-project living-doc synthesis. Daily, after tier-1.
                   Reads README.md + notes + linked theme raw/ files; rewrites
                   projects/{name}/wiki.md.
```

## Knowledge base structure

```
$KB_DIR/  (default: ~/knowledge/)
  index.md              # Topic index with post counts and last-updated dates
  log.md                # Append-only ingest log ([INGEST] / [REMOVED] prefixes)
  synthesis.md          # Cross-domain patterns, helicopter view (daily)
  synthesis-history.md  # Append-only dated log of cross-domain signal.
                        # Tier-2's past-days memory — fed back as grounding.
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
  projects/             # Per-project living docs (orthogonal to themes)
    CLAUDE.md           # Layout and conventions for the projects subtree
    {name}/
      README.md         # YAML frontmatter (themes, status, since) + description
      wiki.md           # Synthesized living doc, rewritten daily
      *.md              # Free-form notes, meeting transcripts (you write these)
      *.pdf             # Decks, attachments
      *.pdf.txt         # Auto-generated text extracts of *.pdf
  briefings/            # Weekly briefing outputs (produced externally, not in repo)
```

## Projects axis

Projects are an additive output axis: ingest, theme categorization, and theme synthesis
are unchanged. A project pulls signal from its own free-form notes and from the linked
themes declared in its `README.md` frontmatter:

```yaml
---
name: dona
themes: [ai-technology, product-ux, startup-entrepreneurship]
status: exploring
since: 2026-04-15
---
```

Daily, after tier-1 theme synthesis, `synthesize-projects.js` runs `claude -p` per project
that has new input (mtime-tracked) and rewrites `projects/{name}/wiki.md`. PDFs are
pre-extracted to sibling `*.pdf.txt` so the agent only Reads `.md`/`.txt`.

## State persistence

`$STATE_DIR/state.json` (default: `~/.personal-wiki/state.json`) stores:
- `knownKeys` — array of all post URLs/URNs already written (for dedup + sync stopping)

`$STATE_DIR/chrome-session/` — Puppeteer user data. LinkedIn session persists here so login only needed once.

## Environment variables (.env)

See `.env.example` for the full reference. Required:

```
ANTHROPIC_API_KEY=sk-ant-...
```

## Automation (launchd)

Run `npm run setup` (macOS only). It generates and loads two launchd agents,
baking in the absolute node path and a PATH that includes it (so launchd's
minimal environment can still find node):

- `com.$USER.personal-wiki-sync` — hourly tick: ingest + tier-1 wiki update +
  per-project wiki update (`scripts/run-sync.sh`)
- `com.$USER.personal-wiki-synthesis` — hourly tick: tier-2 synthesis
  (`scripts/run-synthesis.sh`)

Each script runs its stage at most once per day on success and retries transient
failures on later ticks (see "Diagnosing a dead sync"). Logs:
`~/Library/Logs/personal-wiki-*.log`.

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
then update `extractElements()` and `looksLikePost()` in `src/sources/linkedin/parser.js`.

## Key constraints when making changes

- **ESM only** — `"type": "module"` in package.json. Use `import/export`, not `require`.
- **`claude -p` path** — `synthesize.js` gets CLAUDE_BIN from `src/config.js` (auto-detected via `which claude`, or set CLAUDE_BIN in .env).
- **Pagination** — `buildPaginatedUrl()` handles REST (`?start=N`), GraphQL
  (`?variables=(start:N,...)`), and cursor-based pagination. LinkedIn changes this.
- **Dedup key** — `post.uniqueKey` = URL if available, else URN. Stored in state.json.
  Sync stops on first post whose uniqueKey is in knownKeys.
