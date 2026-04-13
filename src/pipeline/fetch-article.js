/**
 * pipeline/fetch-article.js — Fetch a URL and extract its article content.
 *
 * Uses @mozilla/readability (the same engine as Firefox Reader View) with
 * jsdom to parse the HTML. Returns the title, author, and clean text content.
 *
 * Used by: sources/apple-notes (URLs extracted from notes)
 * May be used by: sources/twitter (tweet URLs that point to articles)
 */

import { Readability } from '@mozilla/readability'
import { JSDOM }        from 'jsdom'

const FETCH_TIMEOUT_MS = 15_000
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
                   '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

/**
 * Fetches a URL and extracts its main article content.
 *
 * @param {string} url
 * @returns {Promise<{ title: string, text: string, author: string, excerpt: string } | null>}
 *   Returns null if the URL is unreachable or the content cannot be parsed.
 */
export async function fetchArticle(url) {
  let html
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
    })
    clearTimeout(timer)

    if (!res.ok) return null
    html = await res.text()
  } catch {
    return null
  }

  try {
    const dom    = new JSDOM(html, { url })
    const reader = new Readability(dom.window.document)
    const parsed = reader.parse()
    if (!parsed) return null

    return {
      title:   (parsed.title   ?? '').trim(),
      text:    (parsed.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 5000),
      author:  (parsed.byline  ?? '').trim(),
      excerpt: (parsed.excerpt ?? '').trim(),
    }
  } catch {
    return null
  }
}
