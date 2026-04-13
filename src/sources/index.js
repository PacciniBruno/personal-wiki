/**
 * sources/index.js — Source adapter registry.
 *
 * Add new adapters here. Each must export a `source` object conforming to
 * the SourceAdapter contract defined in src/sources/types.js.
 */

import { source as linkedin }    from './linkedin/index.js'
import { source as twitter }     from './twitter/index.js'
import { source as appleNotes }  from './apple-notes/index.js'
import { source as web }         from './web/index.js'

/** All registered source adapters. */
export const ALL_SOURCES = [linkedin, twitter, appleNotes, web]

/**
 * Returns adapters that are configured and enabled.
 * @param {Object} config - The config object from src/config.js
 */
export function getEnabledSources(config) {
  return ALL_SOURCES.filter(s => s.isEnabled(config))
}

/**
 * Returns a single adapter by id, or null if not found.
 * @param {string} id
 */
export function getSourceById(id) {
  return ALL_SOURCES.find(s => s.id === id) ?? null
}
