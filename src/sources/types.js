/**
 * types.js — Normalized item and source adapter contracts.
 *
 * Every source adapter must return items conforming to SourceItem.
 * The pipeline (categorize, write, dedupe) is source-agnostic from this point.
 */

/**
 * @typedef {Object} SourceItem
 *
 * @property {'linkedin'|'twitter'|'apple-notes'|'web'} source
 *   Source identifier — used for namespacing state and log entries.
 *
 * @property {'social-post'|'note'|'article'} sourceType
 *   Content type — informs the categorization prompt.
 *
 * @property {string} externalId
 *   Source-native stable ID (URL, URN, note ID…).
 *   Stored in state.sources[source].knownKeys for dedup and sync stopping.
 *   NOT globally namespaced — that's what uniqueKey is for.
 *
 * @property {string} uniqueKey
 *   Globally unique dedup key: `${source}:${externalId}`.
 *   Used for cross-source dedup at the pipeline level.
 *
 * @property {string} url         Public URL to the content (may equal externalId).
 * @property {string} title       Title or headline (often empty for social posts).
 * @property {string} text        Main content text, pre-truncated to ≤3000 chars.
 * @property {string} author      Author display name.
 * @property {string} authorTitle Author subtitle / headline.
 *
 * @property {string|null} savedAt     ISO timestamp — when the user saved the item.
 * @property {string|null} createdAt   ISO timestamp — when the item was created.
 * @property {string|null} publishedAt ISO timestamp — when the item was published.
 *
 * @property {string[]} tags   Source-provided tags (distinct from Claude-assigned tags).
 * @property {Object}   metadata  Source-specific extras (urn, note body, etc.).
 * @property {Object}   [raw]     Original API payload — only populated when DEBUG=1.
 */

/**
 * @typedef {Object} SourceAdapter
 *
 * @property {string}   id      Unique, kebab-case identifier (e.g. 'apple-notes').
 * @property {string}   label   Human-readable name shown in CLI output.
 * @property {string[]} defaultModes  Modes in which this source is active: ['sync','bootstrap'].
 * @property {boolean}  supportsRemovedDetection
 *   If true, the pipeline compares the bootstrap fetch against known keys and marks
 *   items no longer present as [REMOVED] in raw/.
 *
 * @property {function(Object): boolean} isEnabled
 *   Returns true if the source has sufficient configuration to run.
 *   Called at startup — sources that return false are silently skipped.
 *
 * @property {function({ mode: string, state: Object, knownKeys: Set<string> }): Promise<SourceItem[]>} fetch
 *   Fetches items from the source. Should stop early (return only new items)
 *   when mode === 'sync' and an item's externalId is in knownKeys.
 */

export {}
