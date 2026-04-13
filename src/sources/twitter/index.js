/**
 * sources/twitter/index.js — Twitter/X bookmarks adapter (placeholder).
 *
 * Config (in .env):
 *   TWITTER_SESSION_FILE — path to a captured Twitter auth cookie/token file
 *                          (not yet implemented — set to enable this source)
 *
 * Implementation notes:
 * - Twitter's bookmarks endpoint: GET https://twitter.com/i/api/graphql/.../Bookmarks
 * - Auth: Bearer token + ct0 (CSRF) cookie, captured similarly to LinkedIn Voyager.
 * - Age filter: only ingest bookmarks saved within TWITTER_MAX_AGE_DAYS (default: 365).
 * - supportsRemovedDetection: false — Twitter doesn't surface an easy full-scan endpoint.
 */

import { TWITTER_MAX_AGE_DAYS } from '../../config.js'

export const source = {
  id:    'twitter',
  label: 'Twitter/X',
  defaultModes: ['sync'],
  supportsRemovedDetection: false,

  isEnabled(config) {
    return Boolean(config.TWITTER_SESSION_FILE)
  },

  async fetch({ mode, state, knownKeys }) {
    throw new Error('Twitter adapter is not yet implemented.')
  },
}
