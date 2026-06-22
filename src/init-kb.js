/**
 * init-kb.js
 *
 * Creates the ~/knowledge/ folder structure on first run.
 * Safe to re-run — never overwrites existing files.
 *
 * Usage: npm run init-kb
 */

import { mkdir, writeFile, access } from 'fs/promises'
import { join } from 'path'
import { homedir } from 'os'
import { KB_DIR } from './config.js'

export { KB_DIR }
export const RAW_DIR       = join(KB_DIR, 'raw')
export const WIKI_DIR      = join(KB_DIR, 'wiki')
export const FACTS_DIR     = join(KB_DIR, 'facts')
export const PROJECTS_DIR  = join(KB_DIR, 'projects')
export const BRIEFINGS_DIR = join(KB_DIR, 'briefings')

export const CATEGORIES = [
  { name: 'AI & Technology',            slug: 'ai-technology'            },
  { name: 'Career & Work',              slug: 'career-work'              },
  { name: 'Investing & Finance',        slug: 'investing-finance'        },
  { name: 'Leadership & Management',    slug: 'leadership-management'    },
  { name: 'Marketing & Growth',         slug: 'marketing-growth'         },
  { name: 'Mindset & Personal Dev',     slug: 'mindset-personal-dev'     },
  { name: 'Other',                      slug: 'other'                    },
  { name: 'Product & UX',              slug: 'product-ux'               },
  { name: 'Sales & Business Dev',       slug: 'sales-business-dev'       },
  { name: 'Startup & Entrepreneurship', slug: 'startup-entrepreneurship' },
]

export function categoryToSlug(category) {
  const match = CATEGORIES.find(c => c.name === category)
  return match?.slug ?? 'other'
}

async function exists(path) {
  try { await access(path); return true } catch { return false }
}

async function writeIfMissing(path, content) {
  if (!(await exists(path))) {
    await writeFile(path, content, 'utf8')
    console.log(`  Created: ${path.replace(homedir(), '~')}`)
  }
}

// ─── File content templates ───────────────────────────────────────────────────

const CLAUDE_MD = `# Personal Knowledge Base

This folder is a curated, LLM-maintained knowledge base fed by LinkedIn saved posts
and other sources. It uses the two-layer wiki pattern:

- \`raw/\`   — source material, one file per topic, append-only
- \`wiki/\`  — LLM-synthesized knowledge pages, updated daily after each sync
- \`facts/\` — atomic, verifiable facts extracted from posts, one file per topic
- \`synthesis.md\` — cross-domain patterns and helicopter view, updated weekly
- \`projects/\` — per-project living docs (one folder per project; see \`projects/CLAUDE.md\`)
- \`inbox/\` — auto-ingested web clips; processed items move to \`inbox/processed/\`
- \`articles to read/\` — read-later shelf, not auto-ingested
- \`inspiration/\` — reference shelf, not auto-ingested

## How to search

For a specific topic, read the wiki page first:
  ~/knowledge/wiki/{topic}.md

For specific posts or quotes with source links:
  grep -ri "keyword" ~/knowledge/raw/

For cross-domain patterns and big-picture themes:
  ~/knowledge/synthesis.md

## Topic files

| Category | Raw | Wiki |
|----------|-----|------|
${CATEGORIES.map(c => `| ${c.name} | raw/${c.slug}.md | wiki/${c.slug}.md |`).join('\n')}

## Citing posts

Always include the source URL. Prefer wiki/ for broad synthesis; prefer raw/ for
exact quotes and the author's original voice. For fast-moving topics (AI, tech),
note the post date — weight recent content more heavily.

## Manual editing

All files are plain markdown — edit freely. The sync pipeline appends to raw/ and
regenerates wiki/ pages without touching entries marked \`[REMOVED]\`.
`

const INDEX_MD = `# Knowledge Base Index

> Last updated: —
> Total posts: 0

## Topics

${CATEGORIES.map(c => `### [${c.name}](wiki/${c.slug}.md)
- **Raw posts:** [raw/${c.slug}.md](raw/${c.slug}.md) — 0 posts
- **Wiki:** [wiki/${c.slug}.md](wiki/${c.slug}.md)
- Last updated: —
`).join('\n')}
`

const LOG_MD = `# Ingest Log

Append-only. Prefixes: [INGEST] new post added | [REMOVED] post unsaved on LinkedIn

`

const SYNTHESIS_MD = `# Cross-Domain Synthesis

> Living knowledge page. Updated weekly from wiki/ pages.
> Last updated: —

*Not yet seeded. Run \`npm run update-wiki -- --tier=2\` or wait for the weekly launchd job.*
`

const PROJECTS_CLAUDE_MD = `# Projects

Each subfolder of \`projects/\` is one project — a sustained, time-bounded effort
that pulls signal from the themed \`raw/\` files plus its own free-form notes.

## Layout

\`\`\`
projects/{name}/
  README.md   ← read this first. YAML frontmatter (themes, status, since) +
                a human-readable description of the project's thesis.
  wiki.md     ← the synthesized living doc. Rewritten daily by
                src/synthesize-projects.js — current state at a glance.
  *.md        ← free-form notes, meeting transcripts. You write these.
  *.pdf       ← decks, attachments. You drop these.
  *.pdf.txt   ← auto-generated text extracts of *.pdf. Don't edit by hand.
\`\`\`

## How to navigate this folder

For a project's current state, read \`wiki.md\`.
For the project's framing and intent, read \`README.md\`.
For raw materials, read the \`*.md\` files (or \`grep\` across them).
PDFs aren't readable directly — check the sibling \`*.pdf.txt\` instead.

## Citing

Project notes are first-person; cite by filename and date.
Theme posts referenced inside \`wiki.md\` link out to \`~/knowledge/raw/{theme}.md\`
entries — preserve the URLs from those entries' **Link:** field.

## Adding a new project

Create \`projects/{name}/README.md\` with frontmatter:

\`\`\`yaml
---
name: name
themes: [ai-technology, product-ux]   # any of the 10 themes from raw/
status: exploring                      # exploring | active | archived
since: YYYY-MM-DD
---
\`\`\`

The next \`npm run update-projects\` (or daily sync) will create \`wiki.md\` and
keep it fresh.
`

function rawHeader(category) {
  return `# ${category} — Raw Posts

> Source material. Append-only. Do not edit entries — add [REMOVED] prefix to heading to flag deletions.

`
}

function wikiHeader(category) {
  return `# ${category}

> Living knowledge page. Sources: raw/${categoryToSlug(category)}.md
> Posts: 0 | Last updated: —

*Not yet seeded. Will be populated on first sync.*
`
}

function factsHeader(category) {
  return `# ${category} — Facts

> Atomic, verifiable facts extracted from raw posts during ingestion.
> Append-only. One fact per line, each self-contained with source attribution.

`
}

const AGENT_FACTS_MD = `# Agent-Derived Facts

> Facts surfaced or synthesized by an agent while consulting the knowledge base.
> Append-only. One fact per line, each self-contained with source attribution.

`

// ─── Main ─────────────────────────────────────────────────────────────────────

export async function initKB() {
  console.log('\n📚 Initializing knowledge base...\n')

  // Create directories
  await mkdir(RAW_DIR,       { recursive: true })
  await mkdir(WIKI_DIR,      { recursive: true })
  await mkdir(FACTS_DIR,     { recursive: true })
  await mkdir(PROJECTS_DIR,  { recursive: true })
  await mkdir(BRIEFINGS_DIR, { recursive: true })
  await mkdir(join(KB_DIR, 'inbox'), { recursive: true })
  await mkdir(join(KB_DIR, 'articles to read'), { recursive: true })
  await mkdir(join(KB_DIR, 'inspiration'), { recursive: true })

  // Root files
  await writeIfMissing(join(KB_DIR, 'CLAUDE.md'),               CLAUDE_MD)
  await writeIfMissing(join(KB_DIR, 'index.md'),                INDEX_MD)
  await writeIfMissing(join(KB_DIR, 'log.md'),                  LOG_MD)
  await writeIfMissing(join(KB_DIR, 'synthesis.md'),            SYNTHESIS_MD)
  await writeIfMissing(join(PROJECTS_DIR, 'CLAUDE.md'),         PROJECTS_CLAUDE_MD)

  // Topic files
  for (const { name, slug } of CATEGORIES) {
    await writeIfMissing(join(RAW_DIR,   `${slug}.md`), rawHeader(name))
    await writeIfMissing(join(WIKI_DIR,  `${slug}.md`), wikiHeader(name))
    await writeIfMissing(join(FACTS_DIR, `${slug}.md`), factsHeader(name))
  }
  await writeIfMissing(join(FACTS_DIR, 'agent-derived.md'), AGENT_FACTS_MD)

  console.log('\n✅ Knowledge base ready at ~/knowledge/')
}

// Run directly
if (process.argv[1]?.endsWith('init-kb.js')) {
  initKB().catch(err => {
    console.error('❌', err.message)
    process.exit(1)
  })
}
