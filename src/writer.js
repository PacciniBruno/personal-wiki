/**
 * writer.js
 *
 * Appends categorized items to $KB_DIR/raw/{category}.md,
 * updates index.md post counts, and appends to log.md.
 */

import { appendFile, readFile, writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { KB_DIR, RAW_DIR, WIKI_DIR, FACTS_DIR, CATEGORIES, categoryToSlug, initKB } from './init-kb.js'
import { STATE_DIR } from './config.js'

const INDEX_FILE = join(KB_DIR, 'index.md')
const LOG_FILE   = join(KB_DIR, 'log.md')

/**
 * Global URL index, independent of per-source knownKeys.
 *
 * Source-level dedup keys on externalId, so the same article arriving via
 * LinkedIn and via a web clip carries two different keys and passes both
 * checks. That put ~700 redundant entries into raw/, which inflates how heavily
 * synthesis weights a source. This is the cross-source backstop.
 */
const SEEN_URLS_FILE = join(STATE_DIR, 'seen-urls.json')

/** Minimum body length for an entry to be worth storing. */
const MIN_BODY_CHARS = 40

async function loadSeenUrls() {
  try {
    return new Set(JSON.parse(await readFile(SEEN_URLS_FILE, 'utf8')))
  } catch {
    return new Set()
  }
}

async function saveSeenUrls(seen) {
  await mkdir(STATE_DIR, { recursive: true })
  await writeFile(SEEN_URLS_FILE, JSON.stringify([...seen], null, 0), 'utf8')
}

// ─── Format a post as a markdown entry ───────────────────────────────────────

function formatEntry(post) {
  const date   = formatDate(post.savedAt ?? post.createdAt ?? new Date().toISOString())
  const author = post.author?.trim() || 'Unknown'
  const tags   = post.tags?.length ? post.tags.join(', ') : ''
  // Short posts (LinkedIn, etc.) keep the 1500-char cap; fetched articles and
  // prose notes get the full upstream cap (~5000) so kb has real text to read.
  const limit  = post.sourceType === 'social-post' ? 1500 : 5000
  const text   = (post.text ?? '').trim().slice(0, limit)
  const insight = (post.summary ?? '').trim()

  const lines = []
  lines.push(`## ${author} — ${date}`)
  if (post.url) lines.push(`**Link:** ${post.url}`)
  if (tags)     lines.push(`**Tags:** ${tags}`)
  lines.push('')
  if (text)     lines.push(text)
  if (insight)  lines.push('', `> **Insight:** ${insight}`)
  lines.push('', '---', '')

  return lines.join('\n')
}

function formatDate(isoString) {
  try {
    return new Date(isoString).toISOString().slice(0, 10)
  } catch {
    return new Date().toISOString().slice(0, 10)
  }
}

// ─── Format a post's extracted facts as markdown bullets ─────────────────────

function formatFacts(post) {
  if (!post.facts?.length) return ''
  const date   = formatDate(post.savedAt ?? post.createdAt ?? new Date().toISOString())
  const author = post.author?.trim() || 'Unknown'
  const src    = post.url ? ` — ${post.url}` : ''
  return post.facts.map(f => `- ${f} — ${author}, ${date}${src}`).join('\n') + '\n'
}

// ─── Update index.md post counts ─────────────────────────────────────────────

/**
 * Counts real entries in a raw topic file.
 *
 * An entry is a `## ` heading whose next non-empty line is `**Link:**`. Scraped
 * articles embed their own `##` subheadings in the body, so counting bare `## `
 * lines overcounts badly (625 vs 559 on ai-technology before dedup).
 */
async function countEntries(slug) {
  const text = await readFile(join(RAW_DIR, `${slug}.md`), 'utf8').catch(() => null)
  if (text === null) return 0

  const lines = text.split('\n')
  let n = 0
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith('## ')) continue
    let j = i + 1
    while (j < lines.length && lines[j].trim() === '') j++
    if (j < lines.length && lines[j].startsWith('**Link:**')) n++
  }
  return n
}

/**
 * Rewrites index.md counts by recounting raw/ from disk.
 *
 * Previously this incremented the stored numbers, so any correction made outside
 * the pipeline (a manual delete, the dedupe backfill) left index.md permanently
 * wrong — it drifted 700 high after dedupe. Recounting is self-correcting.
 */
async function updateIndex(countsBySlug) {
  let content
  try {
    content = await readFile(INDEX_FILE, 'utf8')
  } catch {
    return // index.md missing — init-kb not run yet
  }

  const today = new Date().toISOString().slice(0, 10)

  content = content.replace(/^> Last updated: .*/m, `> Last updated: ${today}`)

  let total = 0
  for (const cat of CATEGORIES) {
    const n = await countEntries(cat.slug)
    total += n

    content = content.replace(
      new RegExp(`(\\*\\*Raw posts:\\*\\* \\[raw/${cat.slug}\\.md\\]\\(raw/${cat.slug}\\.md\\) — )\\d+ posts`),
      `$1${n} posts`
    )

    // Only topics that received new posts get their date bumped.
    if (countsBySlug[cat.slug]) {
      content = content.replace(
        new RegExp(`(### \\[${cat.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\][^\\n]*\\n[^\\n]*\\n[^\\n]*\\n- Last updated: ).+`),
        `$1${today}`
      )
    }
  }

  content = content.replace(/^> Total posts: \d+/m, `> Total posts: ${total}`)

  await writeFile(INDEX_FILE, content, 'utf8')
}

// ─── Main export ─────────────────────────────────────────────────────────────

/**
 * Writes an array of categorized posts to the knowledge base.
 * Returns list of category slugs that received new posts (for synthesis step).
 */
export async function writePosts(posts) {
  await initKB() // idempotent — only creates missing files

  const countsBySlug = {}
  const updatedSlugs = new Set()
  const seenUrls = await loadSeenUrls()
  const skipped = { duplicate: 0, empty: 0 }

  for (const post of posts) {
    const slug = categoryToSlug(post.category ?? 'Other')
    const rawFile = join(RAW_DIR, `${slug}.md`)

    // Cross-source duplicate: already in raw/ under some category.
    if (post.url && seenUrls.has(post.url)) {
      skipped.duplicate++
      continue
    }

    // Content-free item (e.g. a large PDF the extractor couldn't read, or a
    // link-only post). Storing it adds no signal but does advance the topic's
    // "Last updated" stamp, which makes a stale topic look fresh.
    const body = (post.text ?? '').trim()
    if (body.length < MIN_BODY_CHARS && !post.summary?.trim()) {
      skipped.empty++
      continue
    }

    const entry = formatEntry(post)
    await appendFile(rawFile, entry, 'utf8')
    if (post.url) seenUrls.add(post.url)

    // Extracted facts → facts/{slug}.md
    const facts = formatFacts(post)
    if (facts) await appendFile(join(FACTS_DIR, `${slug}.md`), facts, 'utf8')

    // Log entry
    const date   = new Date().toISOString().slice(0, 10)
    const author = post.author?.trim() || 'Unknown'
    const url    = post.url ?? post.externalId ?? post.uniqueKey ?? ''
    const src    = post.source ? `${post.source} | ` : ''
    await appendFile(LOG_FILE, `[INGEST] ${date} | ${src}${post.category ?? 'Other'} | ${author} | ${url}\n`, 'utf8')

    countsBySlug[slug] = (countsBySlug[slug] ?? 0) + 1
    updatedSlugs.add(slug)
  }

  await saveSeenUrls(seenUrls)
  await updateIndex(countsBySlug)

  if (skipped.duplicate || skipped.empty) {
    const parts = []
    if (skipped.duplicate) parts.push(`${skipped.duplicate} duplicate`)
    if (skipped.empty)     parts.push(`${skipped.empty} content-free`)
    console.log(`   ↳ skipped ${parts.join(', ')}`)
  }

  return [...updatedSlugs]
}

/**
 * Marks a post as removed in the raw file and logs it.
 * Called during bootstrap when a previously-known post is no longer in LinkedIn.
 */
export async function markRemoved(post, category) {
  const slug    = categoryToSlug(category ?? 'Other')
  const rawFile = join(RAW_DIR, `${slug}.md`)
  const date    = new Date().toISOString().slice(0, 10)
  const url     = post.url ?? post.externalId ?? post.uniqueKey ?? ''

  // Read raw file and prepend [REMOVED date] to the matching heading
  let content
  try {
    content = await readFile(rawFile, 'utf8')
  } catch {
    return // file doesn't exist yet — nothing to mark
  }

  // Match heading by URL or uniqueKey
  if (url && content.includes(url)) {
    // Find the ## heading that precedes this URL and mark it
    content = content.replace(
      /(## [^\n]+\n(?:\*\*Link:\*\* [^\n]+\n)?)/g,
      (match) => {
        if (match.includes(url)) return match.replace(/^## /, `## [REMOVED ${date}] `)
        return match
      }
    )
    await writeFile(rawFile, content, 'utf8')
  }

  await appendFile(LOG_FILE, `[REMOVED] ${date} | ${category ?? 'Other'} | ${url}\n`, 'utf8')
}

/**
 * Returns the path to the raw file for a given category slug.
 * Used by synthesize.js to know which files to pass to claude -p.
 */
export function rawFilePath(slug)  { return join(RAW_DIR,  `${slug}.md`) }
export function wikiFilePath(slug) { return join(WIKI_DIR, `${slug}.md`) }
export { KB_DIR, WIKI_DIR }
