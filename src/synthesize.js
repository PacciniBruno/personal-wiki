/**
 * synthesize.js
 *
 * Two-tier wiki synthesis using the Claude Code CLI (claude -p).
 * The full Claude Code harness (Read, Write, Grep, Glob, Bash tools) is used
 * so the agent can navigate the knowledge base lazily and precisely.
 *
 * Tier 1 — Per-category wiki updates (daily, after sync):
 *   Parallel claude -p instances, one per updated category.
 *   Each reads raw/{category}.md + wiki/{category}.md and updates the wiki page.
 *
 * Tier 2 — Cross-category synthesis (weekly):
 *   Single claude -p reads all wiki/ pages and updates synthesis.md.
 *
 * Usage:
 *   node src/synthesize.js --tier=1 --categories=ai-technology,product-ux --since=2025-04-01
 *   node src/synthesize.js --tier=2
 */

import { join } from 'path'
import { CATEGORIES, KB_DIR } from './init-kb.js'
import { rawFilePath, wikiFilePath } from './writer.js'
import { claudePrint } from './claude-print.js'

const SYNTHESIS_FILE = join(KB_DIR, 'synthesis.md')

// ─── Prompt builders ─────────────────────────────────────────────────────────

function buildCategoryPrompt(slug, sinceDate) {
  const cat      = CATEGORIES.find(c => c.slug === slug)
  const name     = cat?.name ?? slug
  const rawFile  = rawFilePath(slug)
  const wikiFile = wikiFilePath(slug)
  const today    = new Date().toISOString().slice(0, 10)

  return `You are updating a personal knowledge base wiki page for the topic "${name}".

FILES:
- Raw source posts: ${rawFile}
- Current wiki page: ${wikiFile}

TASK:
1. Get recent raw posts using Bash: \`tail -n 600 ${rawFile}\`
   This gives you the ~40-50 most recent entries. Focus on those dated since ${sinceDate}.
   Skip entries marked [REMOVED].
2. Read the current wiki page: ${wikiFile}
3. Update the wiki page with this structure (rewrite the whole file):

# ${name}

> Living knowledge page. Sources: raw/${slug}.md
> Posts: [total count from index or estimate] | Last updated: ${today}

## Key Themes
[3-7 recurring themes across all posts. Each as a bullet with 1-2 sentence synthesis and one example citation with URL]

## Patterns & Tensions
[2-4 interesting tensions or contradictions you notice in the posts]

## Notable Voices
[5-10 authors who appear repeatedly or have particularly sharp takes. Format: **Name** — [angle/perspective], [URL to one of their posts]]

## Recent Signal (since ${sinceDate})
[Concrete synthesis of the most recent posts. Be specific: cite authors, quotes, URLs. 5-10 bullets.]

4. Write the updated wiki page back to ${wikiFile}.

STYLE:
- Dense reference document, not prose. Bullet points with inline citations (URL).
- For fast-moving topics like AI/Tech, note post dates explicitly.
- Only synthesize what is actually in the posts — do not invent content.
- Keep the whole file under 150 lines.`
}

function buildCrossCategoryPrompt() {
  const today    = new Date().toISOString().slice(0, 10)
  const wikiGlob = join(KB_DIR, 'wiki', '*.md')

  return `You are updating a cross-domain synthesis document for a personal knowledge base.

FILES:
- All wiki pages: ${wikiGlob} (glob/read each one)
- Current synthesis: ${SYNTHESIS_FILE}

TASK:
1. Read all wiki pages in ~/knowledge/wiki/.
2. Read the current synthesis.md.
3. Identify patterns that span multiple domains:
   - Recurring themes (e.g. "taste as a competitive moat appears in product, leadership, AND investing posts")
   - Tensions between domains (e.g. "move fast" in startup posts vs "deliberate culture" in leadership posts)
   - Emerging signals this week/month across the library
   - What topics the curator is consistently drawn to and what this reveals
4. Update synthesis.md:
   - Keep a "Cross-Domain Patterns" section with recurring themes (cite specific wiki pages)
   - Keep a "Emerging This Week" section (last 7 days signal, concrete and specific)
   - Keep a "Tensions & Open Questions" section
   - Keep a "What This Library Reveals" section (meta-pattern about the curator's interests)
   - Update "Last updated" date to today (${today})
   - Preserve prior synthesis — augment and refine, don't erase
5. Write synthesis.md back to ${SYNTHESIS_FILE}.

STYLE:
- Helicopter view — this is the 10,000ft perspective, not domain-specific detail
- Cross-reference specific wiki pages and post URLs when citing
- Be honest about uncertainty — distinguish strong patterns from weak signals`
}

// ─── Tier 1: per-category updates (parallel) ─────────────────────────────────

export async function runCategoryUpdates(updatedSlugs, sinceDate) {
  if (updatedSlugs.length === 0) {
    console.log('   No categories to update.')
    return
  }

  console.log(`\n⑤ Updating wiki pages (${updatedSlugs.length} categories)...`)

  const results = await Promise.allSettled(
    updatedSlugs.map(async slug => {
      const prompt = buildCategoryPrompt(slug, sinceDate)
      try {
        await claudePrint(prompt, 300_000)
        process.stdout.write(`   ✅ ${slug}\n`)
      } catch (err) {
        process.stdout.write(`   ⚠️  ${slug}: ${err.message}\n`)
        throw err
      }
    })
  )

  const failed = results.filter(r => r.status === 'rejected')
  if (failed.length > 0) {
    console.log(`   ⚠️  ${failed.length} wiki page(s) failed to update — will retry on next sync.`)
  }
}

// ─── Tier 2: cross-category synthesis ────────────────────────────────────────

export async function runCrossCategory() {
  console.log('\n🔭 Cross-category synthesis...')

  const prompt = buildCrossCategoryPrompt()
  try {
    await claudePrint(prompt, 180_000)
    console.log('✅ synthesis.md updated.')
  } catch (err) {
    console.error('❌ Cross-category synthesis failed:', err.message)
    throw err
  }
}

// ─── CLI entry point ──────────────────────────────────────────────────────────

if (process.argv[1]?.endsWith('synthesize.js')) {
  const args        = process.argv.slice(2)
  const tierArg     = args.find(a => a.startsWith('--tier='))?.split('=')[1]
  const catsArg     = args.find(a => a.startsWith('--categories='))?.split('=')[1]
  const sinceArg    = args.find(a => a.startsWith('--since='))?.split('=')[1]

  const tier      = parseInt(tierArg ?? '1', 10)
  const since     = sinceArg ?? new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10)
  const slugs     = catsArg
    ? catsArg.split(',').map(s => s.trim())
    : CATEGORIES.map(c => c.slug)

  if (tier === 2) {
    runCrossCategory().catch(err => { console.error(err.message); process.exit(1) })
  } else {
    runCategoryUpdates(slugs, since).catch(err => { console.error(err.message); process.exit(1) })
  }
}
