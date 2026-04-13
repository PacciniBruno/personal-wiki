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
export const RAW_DIR  = join(KB_DIR, 'raw')
export const WIKI_DIR = join(KB_DIR, 'wiki')

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
- \`synthesis.md\` — cross-domain patterns and helicopter view, updated weekly

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

// ─── Main ─────────────────────────────────────────────────────────────────────

export async function initKB() {
  console.log('\n📚 Initializing knowledge base...\n')

  // Create directories
  await mkdir(RAW_DIR,  { recursive: true })
  await mkdir(WIKI_DIR, { recursive: true })

  // Root files
  await writeIfMissing(join(KB_DIR, 'CLAUDE.md'),    CLAUDE_MD)
  await writeIfMissing(join(KB_DIR, 'index.md'),     INDEX_MD)
  await writeIfMissing(join(KB_DIR, 'log.md'),       LOG_MD)
  await writeIfMissing(join(KB_DIR, 'synthesis.md'), SYNTHESIS_MD)

  // Topic files
  for (const { name, slug } of CATEGORIES) {
    await writeIfMissing(join(RAW_DIR,  `${slug}.md`), rawHeader(name))
    await writeIfMissing(join(WIKI_DIR, `${slug}.md`), wikiHeader(name))
  }

  console.log('\n✅ Knowledge base ready at ~/knowledge/')
}

// Run directly
if (process.argv[1]?.endsWith('init-kb.js')) {
  initKB().catch(err => {
    console.error('❌', err.message)
    process.exit(1)
  })
}
