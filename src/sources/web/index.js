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
 * Handles the simple key: value format Obsidian Web Clipper produces.
 */
function parseFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/)
  if (!match) return { meta: {}, body: content.trim() }

  const meta = {}
  for (const line of match[1].split(/\r?\n/)) {
    const colon = line.indexOf(':')
    if (colon === -1) continue
    const key = line.slice(0, colon).trim()
    const val = line.slice(colon + 1).trim().replace(/^["']|["']$/g, '')
    if (key) meta[key] = val
  }

  return { meta, body: match[2].trim() }
}

export const source = {
  id:    'web',
  label: 'Web Clips',
  defaultModes: ['sync', 'bootstrap'],
  supportsRemovedDetection: false,

  isEnabled(_config) {
    // Enabled unless explicitly set to false (WEB_CLIP_DIR=false)
    return _config.WEB_CLIP_DIR !== null || process.env.WEB_CLIP_DIR !== 'false'
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
      const url        = meta.url ?? meta.source ?? ''
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
        authorTitle: '',
        savedAt:     meta.date ? new Date(meta.date).toISOString() : new Date().toISOString(),
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
