/**
 * projects.js — Discovery and metadata for the projects axis.
 *
 * Layout:
 *   $KB_DIR/projects/{name}/
 *     README.md   — YAML frontmatter manifest (themes, status, since) + description
 *     wiki.md     — synthesized living doc (rewritten daily by synthesize-projects.js)
 *     *.md        — free-form notes
 *     *.pdf       — decks, PDFs (extracted to *.pdf.txt for the synthesis agent)
 *     *.pdf.txt   — auto-generated text extracts
 */

import { readdir, readFile, writeFile, stat } from 'fs/promises'
import { join } from 'path'
import { KB_DIR } from './config.js'
import { extractPdfText } from './pipeline/extract-pdf.js'

export const PROJECTS_DIR = join(KB_DIR, 'projects')

const README_NAME = 'README.md'
const WIKI_NAME   = 'wiki.md'

/**
 * Lists every project subdirectory containing a README.md.
 * @returns {Promise<Array<{name, dir, readmePath, wikiPath, manifest}>>}
 */
export async function listProjects() {
  let entries
  try {
    entries = await readdir(PROJECTS_DIR, { withFileTypes: true })
  } catch {
    return []
  }

  const projects = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const dir        = join(PROJECTS_DIR, entry.name)
    const readmePath = join(dir, README_NAME)
    const wikiPath   = join(dir, WIKI_NAME)
    let manifest
    try {
      manifest = await readManifest(readmePath)
    } catch {
      continue // no README → not a project
    }
    projects.push({ name: entry.name, dir, readmePath, wikiPath, manifest })
  }
  return projects
}

/**
 * Parses YAML frontmatter from a README.md.
 * Supports flat key/value blocks; `themes` may be `[a, b, c]` or block list.
 * Throws if the file does not exist.
 */
export async function readManifest(readmePath) {
  const text = await readFile(readmePath, 'utf8')
  const match = text.match(/^---\s*\n([\s\S]*?)\n---/)
  if (!match) return { themes: [], status: 'active', since: null }

  const out = { themes: [], status: 'active', since: null }
  const lines = match[1].split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const kv = line.match(/^([a-zA-Z_][\w-]*)\s*:\s*(.*)$/)
    if (!kv) continue
    const [, key, rawValue] = kv
    const value = rawValue.trim()

    if (key === 'themes') {
      // inline form: [a, b, c]
      const inline = value.match(/^\[(.*)\]$/)
      if (inline) {
        out.themes = inline[1].split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean)
      } else if (value === '') {
        // block form: subsequent `- foo` lines
        const items = []
        while (i + 1 < lines.length && /^\s*-\s+/.test(lines[i + 1])) {
          i++
          items.push(lines[i].replace(/^\s*-\s+/, '').trim().replace(/^["']|["']$/g, ''))
        }
        out.themes = items.filter(Boolean)
      }
    } else if (key === 'status' || key === 'name') {
      out[key] = value.replace(/^["']|["']$/g, '')
    } else if (key === 'since') {
      out.since = value.replace(/^["']|["']$/g, '')
    }
  }
  return out
}

/**
 * Returns true if any input file in the project dir is newer than the last
 * recorded sync, or if the project has never been synced.
 */
export async function projectNeedsResync(project, state) {
  const last = state?.projects?.[project.name]?.lastSyncedAt
  const lastMs = last ? Date.parse(last) : 0

  const entries = await readdir(project.dir, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isFile()) continue
    if (entry.name === WIKI_NAME) continue // own output, ignore
    const path = join(project.dir, entry.name)
    const s = await stat(path)
    if (s.mtimeMs > lastMs) return true
  }
  return lastMs === 0 // never synced → resync
}

/**
 * For each *.pdf in the project dir, writes a sibling *.pdf.txt if missing
 * or older than the source PDF. Idempotent.
 */
export async function extractProjectPdfs(project) {
  const entries = await readdir(project.dir, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.pdf')) continue
    const pdfPath = join(project.dir, entry.name)
    const txtPath = `${pdfPath}.txt`

    const pdfStat = await stat(pdfPath)
    let txtStat
    try { txtStat = await stat(txtPath) } catch { txtStat = null }

    if (txtStat && txtStat.mtimeMs >= pdfStat.mtimeMs) continue

    const buffer = await readFile(pdfPath)
    const text = await extractPdfText(buffer)
    if (text) {
      await writeFile(txtPath, text, 'utf8')
    }
  }
}
