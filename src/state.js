/**
 * state.js
 *
 * Local state persistence for the sync pipeline.
 * Stores knownKeys (post URLs/URNs already in the knowledge base) in
 * ~/.linkedin-notion-sync/state.json to enable deduplication and sync stopping.
 */

import { readFile, writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { homedir } from 'os'

const STATE_DIR  = join(homedir(), '.linkedin-notion-sync')
const STATE_FILE = join(STATE_DIR, 'state.json')

export async function loadState() {
  try {
    const raw = await readFile(STATE_FILE, 'utf8')
    return JSON.parse(raw)
  } catch {
    return { knownKeys: [] }
  }
}

export async function saveState(state) {
  await mkdir(STATE_DIR, { recursive: true })
  await writeFile(STATE_FILE, JSON.stringify(state, null, 2))
}
