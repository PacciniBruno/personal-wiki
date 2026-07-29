/**
 * projects.js — Discovery and metadata for the projects axis.
 *
 * Layout:
 *   $KB_DIR/projects/{name}/
 *     README.md      — YAML frontmatter manifest (themes, status, since) + description
 *     wiki.md        — synthesized living doc (rewritten daily by synthesize-projects.js)
 *     canon/         — current canonical docs (provisional; see AGENTS.md)
 *     exploration/   — open threads that challenge canon
 *     research/      — primary evidence (interviews, transcripts)
 *     drafts/        — WIP, non-authoritative
 *     *.md           — free-form notes
 *     *.pdf          — decks, PDFs (extracted to *.pdf.txt for the synthesis agent)
 *     *.pdf.txt      — auto-generated text extracts
 *
 * Projects nest. Every helper here walks subfolders recursively, skipping
 * PROJECT_IGNORE — build output and tooling debris that a prototype living
 * inside a project folder would otherwise drag into synthesis.
 */

import { readdir, readFile, writeFile, stat } from 'fs/promises'
import { join } from 'path'
import { KB_DIR } from './config.js'
import { extractPdfText } from './pipeline/extract-pdf.js'

export const PROJECTS_DIR = join(KB_DIR, 'projects')

const README_NAME = 'README.md'
const WIKI_NAME   = 'wiki.md'

/**
 * Directory and file names never walked when scanning a project.
 *
 * Projects are working folders, not clean document trees — a prototype app with
 * its own node_modules and build output can easily outweigh the knowledge by
 * 100x. Shared by projectNeedsResync, extractProjectPdfs, and the synthesis
 * prompt so the staleness check and the agent always see the same file set.
 */
export const PROJECT_IGNORE = new Set([
  'node_modules', 'dist', 'dist-mvp', 'src-mvp', 'build', '.git',
  '.claude', '.vscode', '.obsidian', 'qa', '_to_delete', 'processed',
  '.DS_Store',
])

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
 * Yields every file path under `dir`, recursively, skipping PROJECT_IGNORE.
 * Unreadable subdirectories are skipped rather than aborting the whole walk.
 *
 * @param {string} dir
 * @returns {AsyncGenerator<string>}
 */
export async function* walkProjectFiles(dir) {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return
  }

  for (const entry of entries) {
    if (PROJECT_IGNORE.has(entry.name)) continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      yield* walkProjectFiles(path)
    } else if (entry.isFile()) {
      yield path
    }
  }
}

/**
 * Returns true if any input file anywhere in the project tree is newer than
 * the last recorded sync, or if the project has never been synced.
 *
 * Recursive by necessity: projects keep their real material in subfolders
 * (canon/, research/, drafts/), so a top-level-only check reports "nothing
 * changed" forever and silently stops synthesizing.
 */
export async function projectNeedsResync(project, state) {
  const last = state?.projects?.[project.name]?.lastSyncedAt
  const lastMs = last ? Date.parse(last) : 0

  const ownOutput = join(project.dir, WIKI_NAME)
  for await (const path of walkProjectFiles(project.dir)) {
    if (path === ownOutput) continue // own output, ignore
    const s = await stat(path)
    if (s.mtimeMs > lastMs) return true
  }
  return lastMs === 0 // never synced → resync
}

/**
 * For each *.pdf anywhere in the project tree, writes a sibling *.pdf.txt if
 * missing or older than the source PDF. Idempotent.
 */
export async function extractProjectPdfs(project) {
  for await (const pdfPath of walkProjectFiles(project.dir)) {
    if (!pdfPath.toLowerCase().endsWith('.pdf')) continue
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
