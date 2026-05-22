/**
 * One-shot recovery for 2026-05-20 entries dumped into raw/other.md because
 * the categorizer's Haiku calls failed mid-batch (credit balance was 0).
 *
 * For each 2026-05-20 entry in raw/other.md:
 *   1. parse it back into a SourceItem-shaped object
 *   2. re-categorize via Haiku (now that credits are restored)
 *   3. if it's no longer 'Other', remove from raw/other.md and append to the
 *      correct raw/{slug}.md, with index.md + log.md updates
 *
 * After moves, re-run tier-1 synthesis for the slugs that received new entries
 * AND for 'other' (since we removed entries from it).
 */

import { readFile, writeFile, appendFile } from 'fs/promises'
import { join } from 'path'
import dotenv from 'dotenv'

// Force-load .env, overriding any empty values from the harness sandbox.
dotenv.config({ path: new URL('./.env', import.meta.url), override: true })

const { categorizeItem }       = await import('./src/categorize.js')
const { KB_DIR }               = await import('./src/config.js')
const { categoryToSlug }       = await import('./src/init-kb.js')
const { runCategoryUpdates }   = await import('./src/synthesize.js')

const TARGET_DATE = '2026-05-20'
const OTHER_FILE = join(KB_DIR, 'raw', 'other.md')
const INDEX_FILE = join(KB_DIR, 'index.md')
const LOG_FILE = join(KB_DIR, 'log.md')

// ─── Parse raw/other.md into entries ─────────────────────────────────────────

function splitEntries(content) {
  // The file uses `\n---\n` as the entry separator. Keep the trailing blank
  // line so re-serialization preserves layout.
  const blocks = content.split(/\n---\n/)
  return blocks
    .map(s => s.trim())
    .filter(Boolean)
}

function joinEntries(entries) {
  return entries.join('\n\n---\n\n') + '\n\n---\n'
}

function parseEntry(block) {
  // Header: `## {author} — {YYYY-MM-DD}`
  const headerMatch = block.match(/^## (.+?) — (\d{4}-\d{2}-\d{2})\s*$/m)
  if (!headerMatch) return null
  const author = headerMatch[1].trim()
  const date = headerMatch[2]

  const linkMatch = block.match(/^\*\*Link:\*\* (.+)$/m)
  const url = linkMatch ? linkMatch[1].trim() : ''

  // Body: everything after the metadata lines, before the optional Insight
  // block. The metadata lines stop at the first blank line.
  const lines = block.split('\n')
  let bodyStart = 0
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '') { bodyStart = i + 1; break }
  }
  const bodyLines = lines.slice(bodyStart)
  // Strip a trailing `> **Insight:** …` block if present
  const insightIdx = bodyLines.findIndex(l => l.startsWith('> **Insight:**'))
  const text = (insightIdx >= 0 ? bodyLines.slice(0, insightIdx) : bodyLines).join('\n').trim()

  return { author, date, url, text }
}

function inferSource(url) {
  if (!url) return { source: 'apple-notes', sourceType: 'note' }
  if (url.includes('linkedin.com')) return { source: 'linkedin', sourceType: 'social-post' }
  if (url.includes('twitter.com') || url.includes('x.com')) return { source: 'twitter', sourceType: 'social-post' }
  return { source: 'web', sourceType: 'article' }
}

// ─── Reuse writer.js entry format ────────────────────────────────────────────

function formatEntry({ author, date, url, text, tags, summary }) {
  const lines = []
  lines.push(`## ${author || 'Unknown'} — ${date}`)
  if (url) lines.push(`**Link:** ${url}`)
  if (tags?.length) lines.push(`**Tags:** ${tags.join(', ')}`)
  lines.push('')
  if (text) lines.push(text)
  if (summary) lines.push('', `> **Insight:** ${summary}`)
  lines.push('', '---', '')
  return lines.join('\n')
}

// ─── Patch index.md counts (decrement Other, increment new slug) ─────────────

async function patchIndexCount(slug, delta) {
  let content
  try { content = await readFile(INDEX_FILE, 'utf8') }
  catch { return }
  const re = new RegExp(`(\\*\\*Raw posts:\\*\\* \\[raw/${slug}\\.md\\]\\(raw/${slug}\\.md\\) — )(\\d+) posts`)
  content = content.replace(re, (_, prefix, n) => `${prefix}${Math.max(0, parseInt(n, 10) + delta)} posts`)
  const today = new Date().toISOString().slice(0, 10)
  content = content.replace(/^> Last updated: .*/m, `> Last updated: ${today}`)
  await writeFile(INDEX_FILE, content, 'utf8')
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const original = await readFile(OTHER_FILE, 'utf8')
// Preserve the file header (everything before the first `## ` entry)
const firstEntryIdx = original.indexOf('\n## ')
const header = firstEntryIdx > 0 ? original.slice(0, firstEntryIdx + 1) : ''
const entriesText = firstEntryIdx > 0 ? original.slice(firstEntryIdx + 1) : original

const entries = splitEntries(entriesText)
const parsed = entries.map(e => ({ raw: e, ...parseEntry(e) })).filter(p => p.author)

const todayEntries = parsed.filter(p => p.date === TARGET_DATE)
console.log(`Found ${parsed.length} total entries in raw/other.md, ${todayEntries.length} from ${TARGET_DATE}`)

if (todayEntries.length === 0) {
  console.log('Nothing to recover.')
  process.exit(0)
}

const moves = []       // { entry, newSlug, formatted }
const keep = new Set() // entries to keep in raw/other.md (everything not moved)

for (const entry of parsed) {
  if (entry.date !== TARGET_DATE) {
    keep.add(entry.raw)
    continue
  }

  const { source, sourceType } = inferSource(entry.url)
  const item = {
    source, sourceType,
    author: entry.author, authorTitle: '',
    title: '', text: entry.text,
    url: entry.url,
  }

  process.stdout.write(`  → ${entry.author.padEnd(28)} `)
  let cat
  try { cat = await categorizeItem(item) }
  catch (err) {
    console.log(`SKIP (categorize failed: ${err.message})`)
    keep.add(entry.raw)
    continue
  }

  const newSlug = categoryToSlug(cat.category)
  if (newSlug === 'other') {
    console.log(`stays in Other (${cat.subcategory})`)
    keep.add(entry.raw)
    continue
  }

  const formatted = formatEntry({
    author: entry.author, date: entry.date, url: entry.url,
    text: entry.text, tags: cat.tags, summary: cat.summary,
  })
  moves.push({ entry, newSlug, formatted, cat })
  console.log(`→ ${newSlug} (${cat.subcategory})`)
  await new Promise(r => setTimeout(r, 150))
}

if (moves.length === 0) {
  console.log('No entries needed re-categorization.')
  process.exit(0)
}

// ── Apply moves ──────────────────────────────────────────────────────────────

const keptEntries = entries.filter(e => keep.has(e))
const newOtherText = header + (keptEntries.length ? joinEntries(keptEntries) : '')
await writeFile(OTHER_FILE, newOtherText, 'utf8')
console.log(`\n✏️  raw/other.md rewritten with ${keptEntries.length} entries (was ${entries.length})`)

const slugsBySlug = {}
for (const move of moves) {
  const dest = join(KB_DIR, 'raw', `${move.newSlug}.md`)
  await appendFile(dest, move.formatted, 'utf8')
  await appendFile(LOG_FILE,
    `[RECATEGORIZED] ${TARGET_DATE} | ${move.entry.author} | other → ${move.newSlug} | ${move.entry.url}\n`,
    'utf8')
  slugsBySlug[move.newSlug] = (slugsBySlug[move.newSlug] ?? 0) + 1
}

// Patch index.md: decrement 'other', increment each destination slug
await patchIndexCount('other', -moves.length)
for (const [slug, delta] of Object.entries(slugsBySlug)) {
  await patchIndexCount(slug, delta)
}

console.log(`\n📦 Moves applied:`)
for (const [slug, n] of Object.entries(slugsBySlug)) console.log(`   ${slug}: +${n}`)
console.log(`   other: ${moves.length} removed`)

// ── Re-run tier-1 for affected slugs ─────────────────────────────────────────

const affectedSlugs = Array.from(new Set([...Object.keys(slugsBySlug), 'other']))
console.log(`\n🔁 Re-running tier-1 synthesis for: ${affectedSlugs.join(', ')}`)

const sinceDate = new Date(Date.now() - 14 * 86400_000).toISOString().slice(0, 10)
const { failed } = await runCategoryUpdates(affectedSlugs, sinceDate)
if (failed.length === 0) {
  console.log('\n✅ Recovery complete.')
} else {
  console.log(`\n⚠️  ${failed.length} category wiki(s) failed: ${failed.join(', ')}`)
  process.exit(1)
}
