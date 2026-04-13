/**
 * state.js — Pipeline state persistence.
 *
 * Stores per-source knownKeys (dedup) and lastSyncAt timestamps in
 * $STATE_DIR/state.json.
 *
 * Schema v2:
 * {
 *   "version": 2,
 *   "sources": {
 *     "linkedin": { "knownKeys": [], "lastSyncAt": "2026-04-13T10:00:00.000Z" },
 *     "twitter":  { "knownKeys": [], "lastSyncAt": null, "maxAgeDays": 365 }
 *   }
 * }
 *
 * Backwards compatible: v1 files ({ knownKeys: [] }) are migrated automatically.
 */

import { readFile, writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { STATE_DIR } from './config.js'

const STATE_FILE = join(STATE_DIR, 'state.json')

/**
 * Migrates v1 state (flat knownKeys array) to v2 (per-source).
 * No-ops if already v2.
 */
function migrate(raw) {
  if (raw.version === 2) return raw

  // v1 → v2: move root knownKeys into sources.linkedin
  return {
    version: 2,
    sources: {
      linkedin: {
        knownKeys: raw.knownKeys ?? [],
        lastSyncAt: null,
      },
    },
  }
}

export async function loadState() {
  try {
    const raw = JSON.parse(await readFile(STATE_FILE, 'utf8'))
    return migrate(raw)
  } catch {
    return { version: 2, sources: {} }
  }
}

export async function saveState(state) {
  await mkdir(STATE_DIR, { recursive: true })
  await writeFile(STATE_FILE, JSON.stringify(state, null, 2))
}
