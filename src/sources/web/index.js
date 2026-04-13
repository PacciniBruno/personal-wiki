/**
 * sources/web/index.js — Web clips adapter.
 *
 * Reads .md files from a drop folder (default: $KB_DIR/chrome-clipped/).
 * Configure your Obsidian Web Clipper to save to that folder, or use any
 * other clipper that outputs markdown.
 *
 * Workflow:
 *   Browser → Obsidian Web Clipper → saves .md to $KB_DIR/chrome-clipped/
 *   Pipeline: reads and parses each .md → ingests as 'article' item
 *   After ingest: file is moved to chrome-clipped/processed/ (not deleted)
 *
 * Config (in .env):
 *   WEB_CLIP_DIR — path to the drop folder. Defaults to $KB_DIR/chrome-clipped.
 *                  Set to 'false' to disable this source entirely.
 *
 * Frontmatter parsed (all optional):
 *   title, url, author, site, date
 *
 * This source is always enabled (returns [] if the folder is empty or missing).
 */

import { readdir, readFile, rename, mkdir } from 'fs/promises'
import { join, basename } from 'path'
import { KB_DIR, WEB_CLIP_DIR } from '../../config.js'

function getClipDir() {
  return WEB_CLIP_DIR ?? join(KB_DIR, 'chrome-clipped')
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
    const clipDir      = getClipDir()
    const processedDir = join(clipDir, 'processed')

    let files
    try {
      files = (await readdir(clipDir)).filter(f => f.endsWith('.md') && f !== 'processed')
    } catch {
      return [] // folder doesn't exist yet — nothing to clip
    }

    if (files.length === 0) return []

    await mkdir(processedDir, { recursive: true })

    const items = []
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

    if (items.length > 0) {
      console.log(`\n✅ ${items.length} web clip(s) found in chrome-clipped/`)
    }

    return items
  },
}
