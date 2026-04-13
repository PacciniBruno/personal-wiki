/**
 * sources/twitter/session.js — Puppeteer-based Twitter/X session capture.
 *
 * Opens Chrome, navigates to the bookmarks page, and intercepts the first
 * Bookmarks GraphQL request to capture auth headers and the initial data batch.
 */

import puppeteer     from 'puppeteer'
import { join }      from 'path'
import { mkdir, writeFile } from 'fs/promises'
import { createInterface }  from 'readline'
import { STATE_DIR } from '../../config.js'
import { extractEntries, looksLikeBookmarkResponse } from './parser.js'

const SESSION_DIR    = join(STATE_DIR, 'twitter-session')
const BOOKMARKS_URL  = 'https://x.com/i/bookmarks'
const sleep = ms => new Promise(r => setTimeout(r, ms))

/**
 * Launches Chrome, intercepts the Twitter Bookmarks GraphQL endpoint, and
 * returns a session config for parser.js to paginate via native fetch().
 *
 * @returns {Promise<{ endpoint: string, headers: Object, firstBatch: Object }>}
 */
export async function getTwitterSession() {
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
  const pendingRequests = new Map() // url → request headers

  // Capture request headers (we need Authorization, cookie, x-csrf-token)
  page.on('request', request => {
    const url = request.url()
    if (isBookmarksEndpoint(url)) {
      pendingRequests.set(url, request.headers())
    }
  })

  page.on('response', async response => {
    if (capturedConfig) return

    const url = response.url()
    if (!isBookmarksEndpoint(url)) return

    let body
    try { body = await response.json() } catch { return }

    if (process.env.DEBUG) {
      console.log(`🐛 Twitter endpoint: ${url.split('?')[0]}`)
      await writeFile('./debug-twitter-first-response.json', JSON.stringify(body, null, 2))
    }

    if (!looksLikeBookmarkResponse(body)) return

    const reqHeaders = pendingRequests.get(url) ?? {}

    capturedConfig = {
      endpoint:   url,
      headers: {
        authorization:            reqHeaders['authorization']              ?? '',
        cookie:                   reqHeaders['cookie']                     ?? '',
        'x-csrf-token':           reqHeaders['x-csrf-token']              ?? '',
        'x-twitter-active-user':  reqHeaders['x-twitter-active-user']    ?? 'yes',
        'x-twitter-auth-type':    reqHeaders['x-twitter-auth-type']      ?? 'OAuth2Session',
        'x-twitter-client-language': reqHeaders['x-twitter-client-language'] ?? 'en',
        'content-type':           'application/json',
        'accept':                 '*/*',
        'user-agent':             reqHeaders['user-agent']                ?? '',
      },
      firstBatch: body,
    }

    console.log(`\n✅ Twitter API intercepted: ${url.split('?')[0]}`)
  })

  await page.goto(BOOKMARKS_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await sleep(2000)

  const currentUrl = page.url()
  const needsLogin =
    currentUrl.includes('/login') ||
    currentUrl.includes('/i/flow/') ||
    currentUrl.includes('/i/oauth2/')

  if (needsLogin) {
    console.log('\n⚠️  Not logged in to Twitter/X. Sign in in the Chrome window.')
    console.log('   Once logged in, press Enter here to continue...\n')
    await waitForEnter()
    await page.goto(BOOKMARKS_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  } else {
    console.log('✅ Twitter/X session found — no login needed.')
  }

  await sleep(8000)

  if (!capturedConfig) {
    console.log('   Reloading to trigger API calls...')
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 })
    await sleep(8000)
  }

  await browser.close()

  if (!capturedConfig) {
    throw new Error(
      'Could not intercept the Twitter Bookmarks API. Make sure you are logged in.\n' +
      'Run with DEBUG=1 for more detail.'
    )
  }

  return capturedConfig
}

function isBookmarksEndpoint(url) {
  return url.includes('/i/api/graphql/') && url.includes('/Bookmarks')
}

function waitForEnter() {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  return new Promise(resolve => rl.question('', () => { rl.close(); resolve() }))
}
