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
import { extractPdfText } from './extract-pdf.js'

const FETCH_TIMEOUT_MS = 15_000
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
                   '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

const FETCH_HEADERS = {
  'User-Agent': USER_AGENT,
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.5',
}

/**
 * Fetches a URL and extracts its main article content.
 * Handles both HTML (via Readability) and PDF (via pdf-parse) responses.
 *
 * @param {string} url
 * @returns {Promise<{ title: string, text: string, author: string, excerpt: string } | null>}
 *   Returns null if the URL is unreachable or the content cannot be parsed.
 */
export async function fetchArticle(url) {
  let res
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    res = await fetch(url, { signal: controller.signal, headers: FETCH_HEADERS })
    clearTimeout(timer)
    if (!res.ok) return null
  } catch {
    return null
  }

  const contentType = res.headers.get('content-type') ?? ''

  if (contentType.includes('application/pdf')) {
    try {
      const buffer = Buffer.from(await res.arrayBuffer())
      const text   = await extractPdfText(buffer)
      if (!text) return null
      const filename = decodeURIComponent(url.split('/').pop() ?? '')
        .replace(/\.pdf$/i, '').trim()
      return { title: (filename || url).slice(0, 200), text, author: '', excerpt: '' }
    } catch {
      return null
    }
  }

  try {
    const html   = await res.text()
    const dom    = new JSDOM(html, { url })
    const reader = new Readability(dom.window.document)
    const parsed = reader.parse()
    if (!parsed) return null

    return {
      title:   (parsed.title        ?? '').trim(),
      text:    (parsed.textContent  ?? '').replace(/\s+/g, ' ').trim().slice(0, 5000),
      author:  (parsed.byline       ?? '').trim(),
      excerpt: (parsed.excerpt      ?? '').trim(),
    }
  } catch {
    return null
  }
}
