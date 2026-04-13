/**
 * session.js — Puppeteer-based LinkedIn session capture.
 *
 * Opens Chrome, navigates to the saved posts page, and intercepts the first
 * Voyager API response to capture auth headers and the initial data batch.
 * The browser is closed once the session config is captured.
 */

import puppeteer from 'puppeteer'
import { join } from 'path'
import { mkdir, writeFile, access, cp } from 'fs/promises'
import { homedir } from 'os'
import { createInterface } from 'readline'
import { STATE_DIR } from '../../config.js'
import { extractElements, looksLikePost, extractPaging } from './parser.js'

const SESSION_DIR     = join(STATE_DIR, 'chrome-session')
const OLD_SESSION_DIR = join(homedir(), '.linkedin-notion-sync', 'chrome-session')

/**
 * One-time migration: copies the LinkedIn Chrome session from the old state
 * directory (~/.linkedin-notion-sync/) to the new one (~/.personal-wiki/) if
 * the new directory does not yet exist. Runs silently — never throws.
 */
async function migrateOldSession() {
  // We look at the Cookies file (not just the directory) because Chrome creates
  // a minimal empty profile on first launch — the Cookies file may exist but be tiny.
  // A Cookies file < 24 KB is almost certainly empty (no real session data).
  const newCookies = join(SESSION_DIR, 'Default', 'Cookies')
  const oldCookies = join(OLD_SESSION_DIR, 'Default', 'Cookies')

  const { stat } = await import('fs/promises')

  const newSize = await stat(newCookies).then(s => s.size).catch(() => 0)
  const oldSize = await stat(oldCookies).then(s => s.size).catch(() => 0)

  if (newSize >= 24_576) return   // new session looks real — nothing to do
  if (oldSize  < 24_576) return   // old session also empty — fresh start, need login

  console.log('   Migrating LinkedIn session from old location...')
  await cp(OLD_SESSION_DIR, SESSION_DIR, { recursive: true, force: true })
  console.log('   ✅ Session migrated — no login needed.')
}
const SAVED_POSTS_URL = 'https://www.linkedin.com/my-items/saved-posts/'
const sleep           = ms => new Promise(r => setTimeout(r, ms))

// Endpoints that are definitely not saved-posts (alerts, identity, messaging, etc.)
const EXCLUDE_URL_PATTERNS = [
  'GlobalAlert', 'globalAlert', 'chameleon', 'Chameleon',
  'segment', 'Segment', 'tracking', 'Tracking',
  'identity', 'Identity', 'Config', 'Settings',
  'voyagerBar', 'launchpad', 'typeahead',
  'messaging', 'Messaging', 'notification', 'Notification',
  'Mailbox', 'mailbox', 'presenceStat',
]

/**
 * Launches Chrome, intercepts the LinkedIn Voyager API, and returns a session
 * config object that parser.js can use to paginate via native fetch().
 *
 * @returns {Promise<{endpoint: string, paging: Object, headers: Object, firstBatch: Object}>}
 */
export async function getLinkedInSession() {
  await migrateOldSession()
  await mkdir(SESSION_DIR, { recursive: true })

  const browser = await puppeteer.launch({
    headless: false,
    userDataDir: SESSION_DIR,
    args: [
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-infobars',
      '--window-size=1280,900',
    ],
    defaultViewport: { width: 1280, height: 900 },
  })

  const page = await browser.newPage()
  let capturedConfig = null
  const allDebugVoyager = []

  page.on('response', async response => {
    const url = response.url()
    if (!url.includes('/voyager/api/')) return

    let body
    try { body = await response.json() } catch { return }

    if (process.env.DEBUG) {
      console.log(`🐛 Voyager URL: ${url.split('?')[0]}`)
      allDebugVoyager.push({ url, body })
    }

    if (capturedConfig) return
    if (EXCLUDE_URL_PATTERNS.some(p => url.includes(p))) return

    const elements = extractElements(body)
    if (!elements || elements.length === 0) return
    if (!elements.some(looksLikePost)) return

    // Capture session
    const cookies    = await page.cookies('https://www.linkedin.com')
    const cookieStr  = cookies.map(c => `${c.name}=${c.value}`).join('; ')
    const jsessionid = cookies.find(c => c.name === 'JSESSIONID')?.value?.replace(/"/g, '') ?? ''
    const userAgent  = await browser.userAgent()

    capturedConfig = {
      endpoint: url,
      paging:   extractPaging(body),
      headers: {
        cookie:                    cookieStr,
        'csrf-token':              jsessionid,
        'x-restli-protocol-version': '2.0.0',
        'x-li-lang':               'en_US',
        'x-li-track':              JSON.stringify({ clientVersion: '1.13.6190' }),
        accept:                    'application/vnd.linkedin.normalized+json+2.1',
        'user-agent':              userAgent,
      },
      firstBatch: body,
    }

    if (process.env.DEBUG) {
      await writeFile('./debug-first-response.json', JSON.stringify(body, null, 2))
      console.log('\n🐛 Debug: first response saved to debug-first-response.json')
    }

    const paging = extractPaging(body)
    console.log(`\n✅ API intercepted: ${url.split('?')[0]}`)
    console.log(`   Estimated total: ${paging?.total ?? 'unknown'}`)
  })

  await page.goto(SAVED_POSTS_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await sleep(2000)

  const currentUrl = page.url()
  const needsLogin =
    currentUrl.includes('/login') ||
    currentUrl.includes('authwall') ||
    currentUrl.includes('/uas/')

  if (needsLogin) {
    console.log('\n⚠️  Not logged in. Sign into LinkedIn in the Chrome window.')
    console.log('   Once logged in, press Enter here to continue...\n')
    await waitForEnter()
    await page.goto(SAVED_POSTS_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  } else {
    console.log('✅ LinkedIn session found — no login needed.')
  }

  await sleep(8000)

  if (!capturedConfig) {
    console.log('   Reloading page to trigger API calls...')
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 })
    await sleep(8000)
  }

  if (process.env.DEBUG && allDebugVoyager.length > 0) {
    await writeFile('./debug-all-voyager.json', JSON.stringify(allDebugVoyager, null, 2))
    console.log(`\n🐛 Debug: ${allDebugVoyager.length} Voyager responses saved to debug-all-voyager.json`)
  }

  await browser.close()

  if (!capturedConfig) {
    throw new Error(
      'Could not intercept the LinkedIn API. Make sure you are logged in and ' +
      'the saved posts page loaded correctly.\n' +
      'Run with DEBUG=1 to see all intercepted requests.'
    )
  }

  return capturedConfig
}

function waitForEnter() {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  return new Promise(resolve => rl.question('', () => { rl.close(); resolve() }))
}
