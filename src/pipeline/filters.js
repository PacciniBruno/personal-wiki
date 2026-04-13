/**
 * pipeline/filters.js — Item filtering utilities.
 *
 * Applied after fetching, before categorization.
 */

/**
 * Filters items older than maxAgeDays based on savedAt / createdAt / publishedAt.
 * Items with no date are kept (conservative default).
 *
 * @param {import('../sources/types.js').SourceItem[]} items
 * @param {number|null} maxAgeDays - Max age in days. null = no filter.
 * @returns {import('../sources/types.js').SourceItem[]}
 */
export function filterByAge(items, maxAgeDays) {
  if (!maxAgeDays) return items
  const cutoff = Date.now() - maxAgeDays * 86_400_000
  return items.filter(item => {
    const date = item.savedAt ?? item.createdAt ?? item.publishedAt
    if (!date) return true
    return new Date(date).getTime() >= cutoff
  })
}

/**
 * Filters items whose externalId is already in the provided Set.
 * Belt-and-suspenders dedup on top of the source's own early-stop logic.
 *
 * @param {import('../sources/types.js').SourceItem[]} items
 * @param {Set<string>} knownIds - Set of externalIds already in the knowledge base.
 * @returns {import('../sources/types.js').SourceItem[]}
 */
export function filterKnown(items, knownIds) {
  return items.filter(item => !knownIds.has(item.externalId))
}
