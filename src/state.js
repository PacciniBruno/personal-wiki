/**
 * state.js — Pipeline state persistence.
 *
 * Stores per-source knownKeys (dedup) and lastSyncAt timestamps in
 * $STATE_DIR/state.json.
 *
 * Schema v3:
 * {
 *   "version": 3,
 *   "sources": {
 *     "linkedin": { "knownKeys": [], "lastSyncAt": "2026-04-13T10:00:00.000Z" },
 *     "twitter":  { "knownKeys": [], "lastSyncAt": null, "maxAgeDays": 365 }
 *   },
 *   "projects": {
 *     "dona": { "lastSyncedAt": "2026-05-01T18:30:00.000Z" }
 *   }
 * }
 *
 * Backwards compatible: v1 ({ knownKeys: [] }) and v2 (sources only) files
 * are migrated automatically.
 */

import { readFile, writeFile, mkdir, access } from 'fs/promises'
import { join } from 'path'
import { homedir } from 'os'
import { STATE_DIR } from './config.js'

const STATE_FILE     = join(STATE_DIR, 'state.json')
const OLD_STATE_FILE = join(homedir(), '.linkedin-notion-sync', 'state.json')

/**
 * Migrates older state schemas to current (v3).
 * v1 ({ knownKeys: [] }) → v2 (per-source) → v3 (adds projects).
 */
function migrate(raw) {
  if (raw.version === 3) return raw

  if (raw.version === 2) {
    return { ...raw, version: 3, projects: raw.projects ?? {} }
  }

  // v1 → v3: move root knownKeys into sources.linkedin, add projects
  return {
    version: 3,
    sources: {
      linkedin: {
        knownKeys: raw.knownKeys ?? [],
        lastSyncAt: null,
      },
    },
    projects: {},
  }
}

export async function loadState() {
  // Try new state file first
  try {
    const raw = JSON.parse(await readFile(STATE_FILE, 'utf8'))
    return migrate(raw)
  } catch { /* fall through */ }

  // One-time migration: read old state file from ~/.linkedin-notion-sync/
  try {
    await access(OLD_STATE_FILE)
    const raw = JSON.parse(await readFile(OLD_STATE_FILE, 'utf8'))
    console.log('   Migrating state from old location...')
    return migrate(raw)
    // saveState() will write it to the new location on next save
  } catch { /* old file also missing */ }

  return { version: 3, sources: {}, projects: {} }
}

export async function saveState(state) {
  await mkdir(STATE_DIR, { recursive: true })
  await writeFile(STATE_FILE, JSON.stringify(state, null, 2))
}
