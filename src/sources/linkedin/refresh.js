/**
 * refresh.js — manual re-auth helper.
 *
 * Launches Puppeteer, prompts for LinkedIn login if needed, and writes a fresh
 * linkedin-session.json. Use when the daily sync logs `LinkedIn session expired
 * or invalid` — the cached cookies or queryId are dead and only an interactive
 * login can fix it.
 *
 * Usage: npm run linkedin:refresh
 */

import { getLinkedInSession } from './session.js'

if (!process.stdin.isTTY) {
  console.error('❌ This script needs a real terminal — it may prompt for LinkedIn login.')
  process.exit(2)
}

console.log('🔄 Forcing LinkedIn session refresh (Chrome will open)...\n')

try {
  const session = await getLinkedInSession({ forceRefresh: true })
  console.log(`\n✅ Session refreshed. Endpoint: ${session.endpoint.split('?')[0]}`)
  console.log('   Next sync will reuse this session — no Chrome needed.')
} catch (err) {
  console.error(`\n❌ Refresh failed: ${err.message}`)
  process.exit(1)
}
