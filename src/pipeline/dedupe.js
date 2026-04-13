/**
 * pipeline/dedupe.js — Source-aware deduplication helpers.
 *
 * Keeps state mutation logic separate from fetch and write concerns.
 */

/**
 * Returns the Set of externalIds known for a given source.
 *
 * @param {Object} state - Full pipeline state (v2 schema)
 * @param {string} sourceId
 * @returns {Set<string>}
 */
export function getSourceKnownIds(state, sourceId) {
  return new Set(state.sources[sourceId]?.knownKeys ?? [])
}

/**
 * Updates state in place with newly ingested items.
 * Adds each item's externalId to state.sources[source].knownKeys.
 * Sets lastSyncAt for each source.
 *
 * @param {Object} state - Full pipeline state (mutated in place)
 * @param {import('../sources/types.js').SourceItem[]} items - Successfully ingested items
 */
export function updateStateWithItems(state, items) {
  for (const item of items) {
    if (!state.sources[item.source]) {
      state.sources[item.source] = { knownKeys: [], lastSyncAt: null }
    }
    const src = state.sources[item.source]
    if (item.externalId && !src.knownKeys.includes(item.externalId)) {
      src.knownKeys.push(item.externalId)
    }
    src.lastSyncAt = new Date().toISOString()
  }
}

/**
 * For bootstrap mode: removes externalIds from state that are no longer present
 * in the fetched set. Returns the list of removed IDs (for the caller to mark
 * as [REMOVED] in the raw files).
 *
 * @param {Object} state - Full pipeline state (mutated in place)
 * @param {string} sourceId
 * @param {Set<string>} fetchedIds - externalIds present in the current fetch
 * @returns {string[]} - externalIds that were removed
 */
export function reconcileRemovedIds(state, sourceId, fetchedIds) {
  const src = state.sources[sourceId]
  if (!src) return []

  const removedIds = src.knownKeys.filter(k => !fetchedIds.has(k))
  src.knownKeys = src.knownKeys.filter(k => fetchedIds.has(k))
  return removedIds
}
