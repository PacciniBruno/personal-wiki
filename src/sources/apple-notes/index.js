/**
 * sources/apple-notes/index.js — Apple Notes saved-links adapter (placeholder).
 *
 * Workflow:
 *   iPhone: Any app → Share → Notes → saves to APPLE_NOTES_FOLDER
 *   Pipeline: reads that folder via AppleScript → extracts URLs → fetches content
 *
 * Config (in .env):
 *   APPLE_NOTES_FOLDER — folder name to scan (default: 'Saved Notes', disabled if not set)
 *
 * Implementation notes:
 * - Uses `osascript` (AppleScript) to query the Notes app on macOS.
 * - Each note in the folder is expected to contain one or more URLs.
 * - After processing, notes are moved to a 'Processed' sub-folder (or deleted) to avoid re-ingestion.
 * - sourceType: 'article' for web URLs, 'note' for plain-text notes.
 * - supportsRemovedDetection: false — notes are consumed on ingest.
 */

import { APPLE_NOTES_FOLDER } from '../../config.js'

export const source = {
  id:    'apple-notes',
  label: 'Apple Notes',
  defaultModes: ['sync'],
  supportsRemovedDetection: false,

  isEnabled(config) {
    return Boolean(config.APPLE_NOTES_FOLDER)
  },

  async fetch({ mode, state, knownKeys }) {
    throw new Error('Apple Notes adapter is not yet implemented.')
  },
}
