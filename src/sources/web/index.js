/**
 * sources/web/index.js — Web clips adapter.
 *
 * Reads .md files from one or more drop folders.
 *
 * Defaults:
 *   - Preferred inbox: $KB_DIR/inbox/
 *   - Legacy fallback: $KB_DIR/chrome-clipped/
 *
 * Configure Obsidian Web Clipper (or any markdown clipper) to save files into
 * the inbox folder when you want them ingested into the wiki.
 *
 * Workflow:
 *   Browser → Obsidian Web Clipper → saves .md to $KB_DIR/inbox/
 *   Pipeline: reads and parses each .md → ingests as 'article' item
 *   After ingest: file is moved to {inbox}/processed/ (not deleted)
 *
 * Config (in .env):
 *   WEB_CLIP_DIR — path to a custom ingest folder. Defaults to $KB_DIR/inbox.
 *                  If unset, the adapter also scans legacy $KB_DIR/chrome-clipped
 *                  when that folder exists. Set to 'false' to disable entirely.
 *
 * Frontmatter parsed (all optional):
 *   title, url, author, site, date
 *
 * This source is always enabled (returns [] if the folder is empty or missing).
 */

import { access, readdir, readFile, rename, mkdir } from 'fs/promises'
import { join, basename } from 'path'
import { KB_DIR, WEB_CLIP_DIR } from '../../config.js'

const DEFAULT_CLIP_DIR = join(KB_DIR, 'inbox')
const LEGACY_CLIP_DIR  = join(KB_DIR, 'chrome-clipped')

async function exists(path) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function getClipDirs() {
  if (WEB_CLIP_DIR) return [WEB_CLIP_DIR]

  const dirs = []
  if (await exists(DEFAULT_CLIP_DIR)) dirs.push(DEFAULT_CLIP_DIR)
  if (await exists(LEGACY_CLIP_DIR))  dirs.push(LEGACY_CLIP_DIR)

  return dirs.length > 0 ? dirs : [DEFAULT_CLIP_DIR]
}

/**
 * Parses YAML-ish frontmatter from a markdown file.
 * Handles the format Obsidian Web Clipper produces, including:
 *   - Quoted string values: title: "My Title"
 *   - YAML list fields:     author:\n  - "[[Name]]"  → "Name"
 *   - WikiLink author:      [[David Cahn]] → "David Cahn"
 *   - Multiple date keys:   published / created / date / saved
 */
function parseFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/)
  if (!match) return { meta: {}, body: content.trim() }

  const meta = {}
  const lines = match[1].split(/\r?\n/)
  let currentKey = null

  for (const line of lines) {
    const colon = line.indexOf(':')

    // YAML list item under a previous key (e.g. "  - "[[David Cahn]]"")
    if (/^\s+-\s+/.test(line) && currentKey) {
      const item = line.replace(/^\s+-\s+/, '').trim().replace(/^["']|["']$/g, '')
      // If not already set (take first item)
      if (!meta[currentKey]) meta[currentKey] = item
      continue
    }

    if (colon === -1) { currentKey = null; continue }

    const key = line.slice(0, colon).trim()
    const val = line.slice(colon + 1).trim().replace(/^["']|["']$/g, '')
    if (!key) continue

    currentKey = key
    if (val) meta[key] = val  // only set if non-empty (list values come on next lines)
  }

  // Unwrap Obsidian WikiLinks: [[David Cahn]] → David Cahn
  for (const [k, v] of Object.entries(meta)) {
    const wikiMatch = v.match(/^\[\[(.+?)\]\]$/)
    if (wikiMatch) meta[k] = wikiMatch[1]
  }

  return { meta, body: match[2].trim() }
}

export const source = {
  id:    'web',
  label: 'Web Clips',
  defaultModes: ['sync', 'bootstrap'],
  supportsRemovedDetection: false,

  isEnabled(_config) {
    // Enabled unless explicitly disabled via WEB_CLIP_DIR=false
    return process.env.WEB_CLIP_DIR !== 'false'
  },

  async fetch({ mode, state, knownKeys }) {
    const clipDirs = await getClipDirs()
    const items = []
    const activeDirs = []

    for (const clipDir of clipDirs) {
      let files
      try {
        files = (await readdir(clipDir)).filter(f => f.endsWith('.md') && f !== 'processed')
      } catch {
        continue
      }

      if (files.length === 0) continue

      activeDirs.push(clipDir)

      const processedDir = join(clipDir, 'processed')
      await mkdir(processedDir, { recursive: true })

      for (const filename of files) {
        const filePath = join(clipDir, filename)
        let content
        try {
          content = await readFile(filePath, 'utf8')
        } catch {
          continue
        }

        const { meta, body } = parseFrontmatter(content)
        const url        = meta.url ?? meta.source ?? meta.link ?? ''
        const externalId = url || filename

        if (knownKeys.has(externalId)) {
          // Already processed — move it out of the way anyway
          await rename(filePath, join(processedDir, filename)).catch(() => {})
          continue
        }

        items.push({
          source:      'web',
          sourceType:  'article',
          externalId,
          uniqueKey:   `web:${externalId}`,
          url,
          title:       meta.title ?? basename(filename, '.md'),
          text:        body.slice(0, 3000),
          author:      meta.author ?? meta.site ?? '',
          authorTitle: meta.description ?? '',
          savedAt:     (meta.date ?? meta.saved ?? meta.created ?? meta.published)
                         ? new Date(meta.date ?? meta.saved ?? meta.created ?? meta.published).toISOString()
                         : new Date().toISOString(),
          createdAt:   null,
          publishedAt: null,
          tags:        [],
          metadata:    { filename, clipDir, ...meta },
        })

        // Move to processed after reading — ingest will write to knowledge base
        await rename(filePath, join(processedDir, filename))
      }
    }

    if (items.length > 0) {
      const labels = activeDirs.map(dir => basename(dir)).join(', ')
      console.log(`\n✅ ${items.length} web clip(s) found in ${labels}`)
    }

    return items
  },
}
