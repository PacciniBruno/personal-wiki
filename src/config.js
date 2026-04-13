/**
 * config.js — Central configuration for personal-wiki.
 *
 * All paths and optional-source flags are resolved here.
 * Override any value by setting the corresponding env var in .env.
 *
 * Required:
 *   ANTHROPIC_API_KEY — get one at https://console.anthropic.com
 *
 * Optional (paths):
 *   KB_DIR            — knowledge base root      (default: ~/knowledge)
 *   STATE_DIR         — state & Chrome session   (default: ~/.personal-wiki)
 *   CLAUDE_BIN        — path to claude CLI        (default: auto-detected)
 *
 * Optional (sources):
 *   OBSIDIAN_VAULT    — absolute path to your Obsidian vault
 *                       If not set, the Obsidian source is skipped.
 *   OBSIDIAN_SYNC_TAG — tag that marks notes for wiki ingestion (default: wiki)
 *   APPLE_NOTES_FOLDER— Apple Notes folder to scan for saved links
 *                       If not set, the Apple Notes source is skipped.
 *
 * Optional (categorization):
 *   USER_CONTEXT      — one-sentence description of yourself, used by Claude
 *                       to categorize content more accurately.
 *                       Example: "a founder and product leader focused on AI startups"
 */

import { homedir } from 'os'
import { join }    from 'path'
import { execSync } from 'child_process'

// ─── Paths ────────────────────────────────────────────────────────────────────

export const KB_DIR    = process.env.KB_DIR    ?? join(homedir(), 'knowledge')
export const STATE_DIR = process.env.STATE_DIR ?? join(homedir(), '.personal-wiki')

// ─── Claude CLI ───────────────────────────────────────────────────────────────

function detectClaudeBin() {
  if (process.env.CLAUDE_BIN) return process.env.CLAUDE_BIN
  try {
    return execSync('which claude', { encoding: 'utf8' }).trim()
  } catch {
    // Not in PATH — caller will fail with a clear error
    return 'claude'
  }
}

export const CLAUDE_BIN = detectClaudeBin()

// ─── Sources ──────────────────────────────────────────────────────────────────

/** Path to Obsidian vault. null → source is disabled. */
export const OBSIDIAN_VAULT      = process.env.OBSIDIAN_VAULT      ?? null

/** Tag that marks an Obsidian note for wiki ingestion. */
export const OBSIDIAN_SYNC_TAG   = process.env.OBSIDIAN_SYNC_TAG   ?? 'wiki'

/** Apple Notes folder name to scan for saved links. null → source is disabled. */
export const APPLE_NOTES_FOLDER  = process.env.APPLE_NOTES_FOLDER  ?? null

/** Twitter session file path. null → source is disabled. */
export const TWITTER_SESSION_FILE = process.env.TWITTER_SESSION_FILE ?? null

/**
 * Maximum age (days) of Twitter bookmarks to ingest.
 * Bookmarks older than this are skipped. Default: 365 (1 year).
 */
export const TWITTER_MAX_AGE_DAYS = process.env.TWITTER_MAX_AGE_DAYS
  ? parseInt(process.env.TWITTER_MAX_AGE_DAYS, 10)
  : 365

// ─── Categorization ───────────────────────────────────────────────────────────

/**
 * One-sentence description of the user, injected into the categorization
 * prompt so Claude can make better-informed decisions.
 */
export const USER_CONTEXT = process.env.USER_CONTEXT ?? 'a professional saving content they find valuable'

// ─── Config object (for source isEnabled() calls) ────────────────────────────

/** Full config as a plain object — passed to source.isEnabled(config). */
export const config = {
  KB_DIR, STATE_DIR, CLAUDE_BIN,
  OBSIDIAN_VAULT, OBSIDIAN_SYNC_TAG,
  APPLE_NOTES_FOLDER,
  TWITTER_SESSION_FILE, TWITTER_MAX_AGE_DAYS,
  USER_CONTEXT,
}
