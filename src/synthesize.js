/**
 * synthesize.js
 *
 * Two-tier wiki synthesis using the Claude Code CLI (claude -p).
 * The full Claude Code harness (Read, Write, Grep, Glob, Bash tools) is used
 * so the agent can navigate the knowledge base lazily and precisely.
 *
 * Tier 1 — Per-category wiki updates (daily, after sync):
 *   Bounded-concurrency claude -p instances, one per updated category.
 *   Each reads raw/{category}.md + wiki/{category}.md and updates the wiki page.
 *
 * Tier 2 — Cross-category synthesis (daily):
 *   Non-agentic: Node reads all wiki/*.md, the current synthesis, and the
 *   recent synthesis-history.md, inlines them in the prompt, and asks claude -p
 *   (tools disabled) to return the new synthesis.md plus a compact dated
 *   history entry. Node writes synthesis.md and appends the entry to
 *   synthesis-history.md. One turn, no cache-write churn — cheap to run daily.
 *
 *   synthesis-history.md is the system's past-days memory: an append-only,
 *   bounded-feed log. Past entries are never sent back through the model to be
 *   rewritten, so the temporal record stays grounded (no telephone-game drift).
 *
 * No in-process retries: terminal errors (budget cap, credit exhaustion, auth)
 * are non-transient, and retrying immediately just doubles the spend. The
 * wrapper script's daily/weekly stamp is the retry cadence — a failure today
 * is retried tomorrow / next week, never the same hour.
 *
 * Exit code is informational: the wrapper stamps the day/week regardless of
 * outcome, so failures never trigger an hourly retry loop.
 *
 * Usage:
 *   node src/synthesize.js --tier=1 --categories=ai-technology,product-ux --since=2025-04-01
 *   node src/synthesize.js --tier=2
 */

import { readFile, readdir, writeFile } from 'fs/promises'
import { basename, join } from 'path'
import { CATEGORIES, KB_DIR } from './init-kb.js'
import { rawFilePath, wikiFilePath } from './writer.js'
import { claudePrint } from './claude-print.js'

const SYNTHESIS_FILE = join(KB_DIR, 'synthesis.md')
const HISTORY_FILE   = join(KB_DIR, 'synthesis-history.md')

const MAX_CONCURRENCY = 3

// How many recent daily history entries to feed back into the prompt as
// temporal grounding. The file itself is append-only and keeps everything;
// only this many trailing days are inlined.
const HISTORY_GROUNDING_DAYS = 45

// Separates the synthesis.md body from today's history entry in the model output.
const HISTORY_MARKER = '===HISTORY==='

const HISTORY_HEADER = `# Synthesis History

> Append-only daily log of cross-domain signal, oldest first. Written by tier-2
> synthesis and fed back as its past-days memory. Do not hand-edit entries —
> they are the grounding record.
`

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

function buildCrossCategoryPrompt({ wikiPages, currentSynthesis, history, today }) {
  const wikiBlocks = wikiPages
    .map(({ name, content }) => `=== wiki/${name} ===\n${content}\n=== end wiki/${name} ===`)
    .join('\n\n')

  return `You are updating a cross-domain synthesis document for a personal knowledge base.

All the input you need is inlined below. You have no tools — respond with the
two delimited sections described under OUTPUT, nothing else.

=== current synthesis.md ===
${currentSynthesis || '(empty — this is the first synthesis)'}
=== end current synthesis.md ===

=== synthesis history (recent days, oldest first) ===
${history || '(empty — no prior history yet)'}
=== end synthesis history ===

${wikiBlocks}

TASK:
Identify patterns that span multiple wiki pages and produce the new synthesis.md.
- Recurring themes across domains (e.g. "taste as a competitive moat appears in product, leadership, AND investing")
- Tensions between domains (e.g. "move fast" in startup vs "deliberate culture" in leadership)
- Emerging signals from the most recent entries across the library
- What the curator is consistently drawn to and what that reveals

USE THE SYNTHESIS HISTORY for temporal grounding — it is your only memory of
past days:
- Distinguish genuinely NEW signal from patterns that have been present for days.
- Note trajectory where the history supports it: how long a pattern has run and
  whether it is strengthening, steady, or fading.
- A pattern in the history that is no longer reflected in the wikis is fading —
  say so explicitly rather than silently dropping it.
- Do not invent history. If a pattern is absent from the history block, treat it
  as new. Never restate history entries as if they were current signal.

OUTPUT — return exactly two sections separated by a line containing only:
${HISTORY_MARKER}

SECTION 1 — the full synthesis.md (rewrite from scratch; the history block, not
the old synthesis file, is your memory — do not copy text from the prior synthesis):

# Cross-Domain Synthesis

> Last updated: ${today} | Source: ~/knowledge/wiki/

## Cross-Domain Patterns
[3-6 patterns that span 2+ wiki pages. Each: 1-2 sentences + cite the wiki pages.
Where the history supports it, add a short trajectory note, e.g. "(building ~2 weeks)".]

## Emerging This Week
[Concrete signals from the most recent entries. 4-8 bullets with specific authors/quotes/URLs when present in the wikis. Flag which are new vs continuing from the history.]

## Tensions & Open Questions
[2-4 tensions between domains or unresolved questions surfaced by the library.]

## What This Library Reveals
[Meta-pattern about the curator's interests. 3-5 sentences.]

SECTION 2 — after the ${HISTORY_MARKER} line, today's history entry: 4-6 compact
one-line bullets capturing the distinctive cross-domain signal of the library
state today — what is new or notable now, not a full restatement of the synthesis.
Plain "- " bullets only. No header, no date (the date is added automatically).

STYLE:
- Helicopter view — 10,000ft perspective, not domain-specific detail
- Cross-reference specific wiki pages (e.g. "see wiki/product-ux.md")
- Be honest about uncertainty — distinguish strong patterns from weak signals
- Tight and dense. Section 1 under 200 lines; section 2 under 8 lines.

Output the two sections only — no preamble, no closing remarks, no code fences.`
}

// Returns the last `maxDays` dated `## YYYY-MM-DD` sections of the history file
// as text. The file header and any older sections are dropped.
function recentHistorySections(fullText, maxDays) {
  const dated = fullText
    .split(/\n(?=## \d{4}-\d{2}-\d{2})/)
    .filter(s => /^## \d{4}-\d{2}-\d{2}/.test(s.trim()))
  return dated.slice(-maxDays).join('\n').trim()
}

async function loadCrossCategoryInputs() {
  const wikiDir = join(KB_DIR, 'wiki')
  const entries = await readdir(wikiDir)
  const wikiPages = []
  for (const f of entries.filter(f => f.endsWith('.md')).sort()) {
    wikiPages.push({ name: basename(f), content: await readFile(join(wikiDir, f), 'utf8') })
  }
  let currentSynthesis = ''
  try { currentSynthesis = await readFile(SYNTHESIS_FILE, 'utf8') } catch {}
  let history = ''
  try {
    history = recentHistorySections(await readFile(HISTORY_FILE, 'utf8'), HISTORY_GROUNDING_DAYS)
  } catch {}
  return { wikiPages, currentSynthesis, history }
}

function stripCodeFences(text) {
  // Defensive: if the model wrapped the response in ```markdown ... ```, strip it.
  const trimmed = text.trim()
  const fenceMatch = trimmed.match(/^```(?:markdown|md)?\n([\s\S]*?)\n```$/)
  return (fenceMatch ? fenceMatch[1] : trimmed) + '\n'
}

// Splits the model output into the synthesis.md body and today's history entry.
// If the model omitted the marker, the whole output is treated as the synthesis
// and no history entry is produced (the run still succeeds).
function splitSynthesisOutput(text) {
  const trimmed = text.trim()
  const idx = trimmed.indexOf(HISTORY_MARKER)
  if (idx === -1) return { synthesis: stripCodeFences(trimmed), historyEntry: null }
  const synthesis = stripCodeFences(trimmed.slice(0, idx))
  const historyEntry = trimmed.slice(idx + HISTORY_MARKER.length).trim()
  return { synthesis, historyEntry: historyEntry || null }
}

// Appends today's entry to synthesis-history.md. Re-running on the same day
// replaces that day's section instead of duplicating it (idempotent).
async function appendHistoryEntry(today, bullets) {
  const newSection = `## ${today}\n${bullets.trim()}\n`

  let existing = ''
  try { existing = await readFile(HISTORY_FILE, 'utf8') } catch {}

  if (!existing.trim()) {
    await writeFile(HISTORY_FILE, `${HISTORY_HEADER}\n${newSection}`)
    return
  }

  // Drop an existing trailing section for today, then append fresh.
  const todayIdx = existing.indexOf(`\n## ${today}`)
  const base = (todayIdx === -1 ? existing : existing.slice(0, todayIdx)).replace(/\n+$/, '')
  await writeFile(HISTORY_FILE, `${base}\n\n${newSection}`)
}

// ─── Concurrency helper ──────────────────────────────────────────────────────

async function runWithLimit(items, limit, worker) {
  const results = new Array(items.length)
  let next = 0
  async function pump() {
    while (true) {
      const i = next++
      if (i >= items.length) return
      try { results[i] = { status: 'fulfilled', value: await worker(items[i], i) } }
      catch (err) { results[i] = { status: 'rejected', reason: err } }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, pump))
  return results
}

// ─── Tier 1: per-category updates (bounded parallel) ─────────────────────────

export async function runCategoryUpdates(updatedSlugs, sinceDate) {
  if (updatedSlugs.length === 0) {
    console.log('   No categories to update.')
    return { failed: [] }
  }

  console.log(`\n⑤ Updating wiki pages (${updatedSlugs.length} categories, concurrency=${MAX_CONCURRENCY})...`)

  const results = await runWithLimit(updatedSlugs, MAX_CONCURRENCY, async slug => {
    const prompt = buildCategoryPrompt(slug, sinceDate)
    try {
      await claudePrint(prompt, 300_000)
      process.stdout.write(`   ✅ ${slug}\n`)
    } catch (err) {
      process.stdout.write(`   ⚠️  ${slug}: ${err.message}\n`)
      throw err
    }
  })

  const failed = updatedSlugs.filter((_, i) => results[i].status === 'rejected')
  if (failed.length > 0) {
    console.log(`   ⚠️  ${failed.length}/${updatedSlugs.length} wiki page(s) failed — see ~/.personal-wiki/synth-failures.log`)
  }
  return { failed }
}

// ─── Tier 2: cross-category synthesis ────────────────────────────────────────

export async function runCrossCategory() {
  console.log('\n🔭 Cross-category synthesis (non-agentic, inlined inputs)...')

  const today = new Date().toISOString().slice(0, 10)
  const { wikiPages, currentSynthesis, history } = await loadCrossCategoryInputs()

  if (wikiPages.length === 0) {
    console.log('   No wiki pages to synthesize from.')
    return
  }

  const prompt = buildCrossCategoryPrompt({ wikiPages, currentSynthesis, history, today })

  try {
    const result = await claudePrint(prompt, 300_000, { tools: 'none' })
    const { synthesis, historyEntry } = splitSynthesisOutput(result)
    await writeFile(SYNTHESIS_FILE, synthesis)

    if (historyEntry) {
      await appendHistoryEntry(today, historyEntry)
      console.log(`✅ synthesis.md updated + synthesis-history.md appended (${wikiPages.length} wiki pages inlined).`)
    } else {
      console.log(`✅ synthesis.md updated (${wikiPages.length} wiki pages inlined).`)
      console.log('   ⚠️  output had no ===HISTORY=== block — history not appended this run.')
    }
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
    runCategoryUpdates(slugs, since)
      .then(({ failed }) => { if (failed.length > 0) process.exit(1) })
      .catch(err => { console.error(err.message); process.exit(1) })
  }
}
