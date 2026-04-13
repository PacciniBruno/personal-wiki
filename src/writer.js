/**
 * writer.js
 *
 * Appends categorized LinkedIn posts to ~/knowledge/raw/{category}.md,
 * updates ~/knowledge/index.md post counts, and appends to log.md.
 *
 * Replaces notion.js.
 */

import { appendFile, readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import { KB_DIR, RAW_DIR, WIKI_DIR, CATEGORIES, categoryToSlug, initKB } from './init-kb.js'

const INDEX_FILE = join(KB_DIR, 'index.md')
const LOG_FILE   = join(KB_DIR, 'log.md')

// ─── Format a post as a markdown entry ───────────────────────────────────────

function formatEntry(post) {
  const date   = formatDate(post.savedAt ?? post.createdAt ?? new Date().toISOString())
  const author = post.author?.trim() || 'Unknown'
  const tags   = post.tags?.length ? post.tags.join(', ') : ''
  const text   = (post.text ?? '').trim().slice(0, 1500)
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

// ─── Update index.md post counts ─────────────────────────────────────────────

async function updateIndex(countsBySlug) {
  let content
  try {
    content = await readFile(INDEX_FILE, 'utf8')
  } catch {
    return // index.md missing — init-kb not run yet
  }

  const today = new Date().toISOString().slice(0, 10)

  // Update "Last updated" header
  content = content.replace(/^> Last updated: .*/m, `> Last updated: ${today}`)

  // Update total posts count
  const totalMatch = content.match(/^> Total posts: (\d+)/m)
  if (totalMatch) {
    const currentTotal = parseInt(totalMatch[1], 10)
    const added = Object.values(countsBySlug).reduce((a, b) => a + b, 0)
    content = content.replace(/^> Total posts: \d+/m, `> Total posts: ${currentTotal + added}`)
  }

  // Update per-topic counts
  for (const [slug, added] of Object.entries(countsBySlug)) {
    const cat = CATEGORIES.find(c => c.slug === slug)
    if (!cat) continue

    content = content.replace(
      new RegExp(`(\\*\\*Raw posts:\\*\\* \\[raw/${slug}\\.md\\]\\(raw/${slug}\\.md\\) — )(\\d+) posts`),
      (_, prefix, n) => `${prefix}${parseInt(n, 10) + added} posts`
    )

    content = content.replace(
      new RegExp(`(### \\[${cat.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\][^\\n]*\\n[^\\n]*\\n[^\\n]*\\n- Last updated: ).+`),
      `$1${today}`
    )
  }

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

  for (const post of posts) {
    const slug = categoryToSlug(post.category ?? 'Other')
    const rawFile = join(RAW_DIR, `${slug}.md`)

    const entry = formatEntry(post)
    await appendFile(rawFile, entry, 'utf8')

    // Log entry
    const date   = new Date().toISOString().slice(0, 10)
    const author = post.author?.trim() || 'Unknown'
    const url    = post.url ?? post.uniqueKey ?? ''
    await appendFile(LOG_FILE, `[INGEST] ${date} | ${post.category ?? 'Other'} | ${author} | ${url}\n`, 'utf8')

    countsBySlug[slug] = (countsBySlug[slug] ?? 0) + 1
    updatedSlugs.add(slug)
  }

  await updateIndex(countsBySlug)

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
  const url     = post.url ?? post.uniqueKey ?? ''

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
