/**
 * sources/twitter/index.js — Twitter/X bookmarks adapter.
 *
 * Uses Puppeteer to capture the Bookmarks GraphQL session, then paginates
 * via native fetch. Age filter: only imports bookmarks from the last
 * TWITTER_MAX_AGE_DAYS days (default: 365).
 */

import { getTwitterSession }  from './session.js'
import { fetchAllBookmarks }  from './parser.js'
import { TWITTER_MAX_AGE_DAYS } from '../../config.js'

export const source = {
  id:    'twitter',
  label: 'Twitter/X',
  defaultModes: ['sync', 'bootstrap'],
  supportsRemovedDetection: false,

  isEnabled(_config) {
    return true // always available; session stored in STATE_DIR/twitter-session/
  },

  async fetch({ mode, state, knownKeys }) {
    console.log('\n① Opening Twitter/X...')
    const session = await getTwitterSession()

    console.log('\n② Fetching bookmarks...')
    return fetchAllBookmarks(session, {
      onlyNew:    mode !== 'bootstrap',
      knownKeys,
      maxAgeDays: TWITTER_MAX_AGE_DAYS,
    })
  },
}
