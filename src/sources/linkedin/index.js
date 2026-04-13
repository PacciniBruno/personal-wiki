/**
 * sources/linkedin/index.js — LinkedIn saved posts adapter.
 *
 * Implements the SourceAdapter contract (see src/sources/types.js).
 * Uses Puppeteer to capture the Voyager API session, then paginates via fetch.
 */

import { getLinkedInSession } from './session.js'
import { fetchAllSavedPosts } from './parser.js'

export const source = {
  id:    'linkedin',
  label: 'LinkedIn',
  defaultModes: ['sync', 'bootstrap'],
  supportsRemovedDetection: true,

  isEnabled(_config) {
    // LinkedIn is always available — no extra config needed (session persists in STATE_DIR).
    return true
  },

  async fetch({ mode, state, knownKeys }) {
    console.log('\n① Opening LinkedIn...')
    const session = await getLinkedInSession()

    console.log('\n② Fetching saved posts...')
    return fetchAllSavedPosts(session, {
      onlyNew: mode !== 'bootstrap',
      knownKeys,
    })
  },
}
