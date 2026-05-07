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

import 'dotenv/config'
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

/**
 * Drop folder for web clips (Obsidian Web Clipper output, or any other clipper).
 * Default: $KB_DIR/inbox — set to null to disable this source.
 * Legacy fallback: $KB_DIR/chrome-clipped is still scanned automatically.
 * The default folder is created automatically on first init-kb run.
 */
export const WEB_CLIP_DIR = process.env.WEB_CLIP_DIR === 'false'
  ? null
  : (process.env.WEB_CLIP_DIR ?? null) // null means "use default KB_DIR/inbox" — resolved in the adapter

/** Apple Notes folder name to scan for saved links. null → source is disabled. */
export const APPLE_NOTES_FOLDER  = process.env.APPLE_NOTES_FOLDER  ?? null

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
  WEB_CLIP_DIR,
  APPLE_NOTES_FOLDER,
  TWITTER_MAX_AGE_DAYS,
  USER_CONTEXT,
}
