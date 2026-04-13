/**
 * sources/web/index.js — Web articles adapter (placeholder).
 *
 * Covers content clipped via Obsidian Web Clipper and tagged for wiki ingestion.
 *
 * Workflow:
 *   Desktop: Browser → Obsidian Web Clipper → saves .md to OBSIDIAN_VAULT
 *   Tag notes with OBSIDIAN_SYNC_TAG (default: 'wiki') to mark them for ingestion.
 *   After ingestion, the tag is replaced with 'wiki-synced'.
 *
 * Config (in .env):
 *   OBSIDIAN_VAULT    — absolute path to your Obsidian vault (required to enable)
 *   OBSIDIAN_SYNC_TAG — tag that marks a note for ingestion (default: 'wiki')
 *
 * Implementation notes:
 * - Obsidian vaults are plain markdown files — no special API needed.
 * - Scan OBSIDIAN_VAULT/**/*.md for files containing #OBSIDIAN_SYNC_TAG in frontmatter or body.
 * - Parse frontmatter (url, title, author) + body as the item text.
 * - sourceType: 'article'
 * - supportsRemovedDetection: false — articles are not "unsaved", they stay in the vault.
 */

import { OBSIDIAN_VAULT, OBSIDIAN_SYNC_TAG } from '../../config.js'

export const source = {
  id:    'web',
  label: 'Web (Obsidian)',
  defaultModes: ['sync'],
  supportsRemovedDetection: false,

  isEnabled(config) {
    return Boolean(config.OBSIDIAN_VAULT)
  },

  async fetch({ mode, state, knownKeys }) {
    throw new Error('Web/Obsidian adapter is not yet implemented.')
  },
}
