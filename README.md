# personal-wiki

> **macOS only.**

Turns your saved LinkedIn posts into a searchable, AI-synthesized knowledge base that lives in `~/knowledge/` and works inside Claude Code. Every day it pulls your new saves, categorizes them with Claude Haiku, and updates living wiki pages by topic. Once a week it writes a cross-domain synthesis across everything you've collected.

The minimal setup is LinkedIn. Twitter, Apple Notes, and web clips are optional add-ons.

## What you get

```
~/knowledge/
  raw/          one markdown file per topic, every post appended
  wiki/         synthesized pages, rewritten daily by Claude
  synthesis.md  cross-domain patterns, rewritten weekly
  index.md      topic overview
```

Ten topics: AI & Technology, Startup & Entrepreneurship, Product & UX, Marketing & Growth, Leadership & Management, Investing & Finance, Career & Work, Sales & Business Dev, Mindset & Personal Dev, Other.

## What it's like to use

Once a few weeks of posts are in, you can have conversations like these — in Claude Code or claude.ai:

> *"I'm rethinking our pricing model. What have I read on this?"*

Claude searches your knowledge base, finds posts on outcome-based pricing from sales, product, and VC angles, and synthesizes the through-lines — with source links so you can go back to the originals.

> *"Brief me on what I've been saving about AI agents this month."*

Claude reads your `wiki/ai-technology.md` and `synthesis.md`, filters for recent signal, and gives you a 5-minute briefing grounded in your actual reading, not the internet at large.

The knowledge base reflects *your* curation. The signal-to-noise ratio depends on what you choose to save.

## Requirements

- macOS (automation uses launchd; sync and KB work on any OS)
- Node.js 18+
- [Anthropic API key](https://console.anthropic.com) — used for categorization (Claude Haiku, cheap)
- [Claude Code CLI](https://claude.ai/code) — used only for wiki synthesis (`claude -p`). Skip it if you only want the raw knowledge base.

**`npm install` downloads ~300 MB** — Puppeteer bundles its own Chromium ("Google Chrome for Testing") to `~/.cache/puppeteer/`. This is separate from your regular Chrome.

## Setup

```bash
git clone https://github.com/YOUR_USERNAME/personal-wiki
cd personal-wiki
npm install
cp .env.example .env       # add your ANTHROPIC_API_KEY
npm run init-kb            # create ~/knowledge/ structure
npm run bootstrap          # first import — Chrome opens, log in to LinkedIn
npm run setup              # install daily/weekly automation (macOS)
```

## First run

`npm run bootstrap` opens a visible Chrome window and navigates to your LinkedIn saved posts. **You will need to log in.** After that, the session is saved to `~/.personal-wiki/chrome-session/` and future runs are fully automatic.

**macOS permissions you may be asked for:**

| Prompt | Why | When |
|--------|-----|------|
| *"Google Chrome for Testing" wants to access the internet* | Puppeteer's Chromium is a new app — macOS Gatekeeper may flag it on first launch | First `npm run sync` or `bootstrap` |
| *Terminal wants to access your Notes* | Apple Notes integration uses AppleScript | First sync with `APPLE_NOTES_FOLDER` set |

## Configuration

Everything lives in `.env`. Only the API key is required.

```env
ANTHROPIC_API_KEY=sk-ant-...

# Optional — who you are (helps Claude categorize better)
USER_CONTEXT=a founder focused on AI and product

# Optional — Apple Notes folder to scan (disabled if not set)
APPLE_NOTES_FOLDER=Saved Posts

# Optional — custom paths
# KB_DIR=~/knowledge
# STATE_DIR=~/.personal-wiki
```

See `.env.example` for all options.

## Optional sources

### Twitter/X
Twitter/X is an optional source and is not part of the default `npm run sync` path. Chromium auth is unreliable here, especially around email-first and Google OAuth flows, so only use it explicitly when you want to attempt a bookmarks sync.

### Apple Notes
Set `APPLE_NOTES_FOLDER` in `.env`. On iPhone: **Share → Notes** → save to that folder. The sync extracts URLs from each note, fetches the article, and moves the note to `"[folder] Processed"` when done.

### Web clips
Install [Obsidian Web Clipper](https://obsidian.md/clipper) and point it at `~/knowledge/inbox/`. The sync picks up any top-level `.md` files there automatically and moves them to `~/knowledge/inbox/processed/` after ingest. Legacy `~/knowledge/chrome-clipped/` is still scanned automatically if it exists.

### Suggested folder layout
- `~/knowledge/inbox/` — things you want ingested into the wiki.
- `~/knowledge/articles to read/` — read-later shelf, not auto-ingested.
- `~/knowledge/inspiration/` — reference shelf, not auto-ingested.
- Apple Notes lives in the Notes app, not inside `~/knowledge/`: save items into your configured folder (for example `Saved Posts`), then the sync moves them to `Saved Posts Processed`.

## Automation

```bash
npm run setup
```

Installs two launchd agents that run on every wake from sleep:
- **Daily** — sync new posts + update wiki pages for changed topics
- **Weekly** — rewrite `synthesis.md` with cross-domain patterns

Logs: `~/Library/Logs/personal-wiki-sync.log` and `personal-wiki-synthesis.log`.

## Using with Claude

The `skills/kb/` directory in this repo is a Claude skill. It tells Claude about your knowledge base and when to search it — the description is always in context, the full instructions only load when it searches.

### Claude Code

```bash
cp -r skills/kb ~/.claude/skills/kb
```

Claude will search your knowledge base automatically when relevant topics come up.

### Claude Desktop / Cowork

[Claude Cowork](https://support.claude.com/en/articles/13345190-get-started-with-claude-cowork) is the Claude Desktop agent mode — local file access, no terminal required. Skills work here too.

1. Install [Claude Desktop](https://claude.ai/download) (Pro, Max, Team, or Enterprise)
2. Go to **Customize → Skills → Create**
3. Copy-paste the contents of [`skills/kb/SKILL.md`](skills/kb/SKILL.md)
4. Grant Cowork access to `~/knowledge/` when prompted

Note: Claude Desktop and Claude Code store skills separately — install in both if you use both.

## Commands

```bash
npm run bootstrap         # full import of all saved posts
npm run sync              # incremental sync (new posts only)
npm run update-wiki       # re-synthesize all wiki pages manually
npm run update-wiki:cross # re-synthesize synthesis.md manually
DEBUG=1 npm run sync      # verbose output + saves raw API responses
```

## Limitations

- **Scraping can break.** LinkedIn and Twitter change their internal APIs without notice. If the scraper stops working, check `debug-*.json` (run with `DEBUG=1`) and update `src/sources/linkedin/parser.js` or `src/sources/twitter/parser.js`.
- **Twitter login requires email + password** — Google OAuth is blocked in Puppeteer's Chromium.
- **Apple Notes and web clips are macOS-only** by nature.
- **Wiki synthesis requires Claude Code CLI** — the raw sync pipeline works without it.

## Security

- `.env` is gitignored. Never commit it.
- `~/.personal-wiki/chrome-session/` stores your LinkedIn session cookies. Keep this directory private — it gives full access to your LinkedIn account.
- The pipeline is read-only: it never posts, likes, or modifies anything on LinkedIn or Twitter.
