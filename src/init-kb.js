/**
 * init-kb.js
 *
 * Creates the ~/knowledge/ folder structure on first run.
 * Safe to re-run — never overwrites existing files.
 *
 * Usage: npm run init-kb
 */

import { mkdir, writeFile, readFile, access } from 'fs/promises'
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

This folder is a curated, LLM-maintained knowledge base fed by LinkedIn saved posts,
X bookmarks, web clips, and Apple Notes. It uses the two-layer wiki pattern.

> This file is generated from \`src/init-kb.js\`. Re-run \`npm run sync-docs\` after
> changing the template. Hand edits are overwritten (a \`.bak\` is kept).

## Synthesized layers

- \`raw/\`   — source material, one file per topic, append-only
- \`wiki/\`  — LLM-synthesized knowledge pages, updated daily after each sync
- \`facts/\` — atomic, verifiable facts extracted from posts, one file per topic
- \`synthesis.md\` — cross-domain patterns and helicopter view, updated daily
- \`synthesis-history.md\` — dated append log of past synthesis passes
- \`projects/\` — per-project living docs (one folder per project; see \`projects/CLAUDE.md\`)

## Ingestion staging (don't read these directly)

- \`inbox/\` — web-clip drop folder. Ingested automatically; processed items move to \`inbox/processed/\`
- \`chrome-clipped/\` — legacy clip folder, still scanned. Same processed/ convention

## Shelves (kept by hand, never ingested or synthesized)

- \`articles to read/\` — read-later shelf
- \`inspiration/\` — reference shelf

## Other outputs

- \`briefings/\` — dated briefings written by agents. Write-target, not a search surface
- \`editorial/\` — content-radar state and voice guides, backing the \`content-radar\` and \`bruno-writing\` skills
- \`log.md\` — append-only ingest log. Prefixes: \`[INGEST]\`, \`[REMOVED]\`, \`[RECATEGORIZED]\`
- \`index.md\` — generated topic index with per-topic counts and dates

## How to search

For a specific topic, read the wiki page first:
  ~/knowledge/wiki/{topic}.md

For specific posts or quotes with source links:
  grep -ri "keyword" ~/knowledge/raw/

For specific verifiable facts:
  ~/knowledge/facts/{topic}.md

For cross-domain patterns and big-picture themes:
  ~/knowledge/synthesis.md

For a project, start at \`projects/{name}/AGENTS.md\`, then \`wiki.md\`'s
\`## Live Tensions\`. Project canon is provisional — see \`projects/CLAUDE.md\`.

## Topic files

| Category | Raw | Wiki |
|----------|-----|------|
${CATEGORIES.map(c => `| ${c.name} | raw/${c.slug}.md | wiki/${c.slug}.md |`).join('\n')}

## Citing posts

Always include the source URL. Prefer wiki/ for broad synthesis; prefer raw/ for
exact quotes and the author's original voice. For fast-moving topics (AI, tech),
note the post date — weight recent content more heavily.

## Manual editing

All files are plain markdown — edit freely, except this one and \`index.md\`, which
are generated. The sync pipeline appends to raw/ and regenerates wiki/ pages
without touching entries marked \`[REMOVED]\`.
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
  README.md      ← manifest. YAML frontmatter (themes, status, since) + reading order.
  AGENTS.md      ← conventions and the project's source-of-truth hierarchy.
  wiki.md        ← the synthesized living doc. Rewritten by
                   src/synthesize-projects.js. Pipeline-owned; don't hand-edit.
  canon/         ← current canonical docs. Provisional by default (see below).
  exploration/   ← open threads that challenge canon.
  research/      ← primary evidence: interviews, transcripts, meeting notes.
  drafts/        ← WIP and AI-generated material. Not authoritative.
  *.md           ← free-form notes.
  *.pdf          ← decks, attachments.
  *.pdf.txt      ← auto-generated text extracts of *.pdf. Don't edit by hand.
\`\`\`

Subfolders are walked recursively. Build output and tooling debris
(\`node_modules\`, \`dist*\`, \`.claude\`, \`qa\`, \`_to_delete\`, …) are skipped — see
\`PROJECT_IGNORE\` in \`src/projects.js\`. A prototype app can live inside a project
folder without polluting synthesis.

## Canon is provisional

These are pre-PMF projects. The idea keeps iterating, so \`canon/\` records the
current best answer rather than a settled one, and \`exploration/\` stays live
alongside it instead of being merged away.

Canon docs carry epistemic frontmatter:

\`\`\`yaml
status: canonical | provisional | superseded | exploring
confidence: high | medium | low
last_reviewed: YYYY-MM-DD
challenged_by: [exploration/...]
\`\`\`

Exploration docs carry the mirror image:

\`\`\`yaml
status: open | folded-into-canon | dropped
challenges: [canon/...]
evidence: [research/...]
\`\`\`

**Read both.** An answer that states canon as settled, without surfacing what
currently challenges it, is wrong. Don't resolve a tension on Bruno's behalf.

## How to navigate this folder

1. \`AGENTS.md\` for conventions and hierarchy.
2. \`wiki.md\`, starting at \`## Live Tensions\` — the fastest read on what's contested.
3. \`canon/\`, checking each doc's \`status\` and \`challenged_by\`.
4. \`exploration/\` for the live challenges.
5. \`research/\` when a claim needs primary backing.

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
keep it fresh. Per-project weekly briefings are produced externally via
\`prompts/project-weekly-briefing.md\`.
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

/**
 * Force-rewrites the generated docs from their templates.
 *
 * initKB() uses writeIfMissing, which means a KB created months ago keeps its
 * first-run CLAUDE.md forever — template improvements never reach an existing
 * knowledge base. This is the escape hatch. Only touches files that are purely
 * generated; index.md is left alone because writer.js maintains live counts in it.
 */
export async function refreshDocs() {
  const targets = [
    { path: join(KB_DIR, 'CLAUDE.md'),       content: CLAUDE_MD          },
    { path: join(PROJECTS_DIR, 'CLAUDE.md'), content: PROJECTS_CLAUDE_MD },
  ]

  for (const { path, content } of targets) {
    const current = await readFile(path, 'utf8').catch(() => null)
    if (current === content) {
      console.log(`  Unchanged: ${path.replace(homedir(), '~')}`)
      continue
    }
    if (current !== null) {
      const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
      await writeFile(`${path}.bak.${stamp}`, current, 'utf8')
    }
    await writeFile(path, content, 'utf8')
    console.log(`  Rewrote:   ${path.replace(homedir(), '~')}`)
  }
}

// Run directly
if (process.argv[1]?.endsWith('init-kb.js')) {
  const run = process.argv.includes('--refresh-docs')
    ? refreshDocs().then(() => console.log('\n✅ Generated docs refreshed.'))
    : initKB()

  run.catch(err => {
    console.error('❌', err.message)
    process.exit(1)
  })
}
