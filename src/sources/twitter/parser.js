/**
 * sources/twitter/parser.js — Twitter Bookmarks API response parsing.
 *
 * Stateless helpers that turn raw GraphQL responses into normalized SourceItems.
 * Handles cursor-based pagination.
 */

const sleep = ms => new Promise(r => setTimeout(r, ms))

// ─── Response validation ──────────────────────────────────────────────────────

export function looksLikeBookmarkResponse(body) {
  return Boolean(
    body?.data?.bookmark_timeline_v2?.timeline?.instructions
  )
}

export function extractEntries(body) {
  const instructions =
    body?.data?.bookmark_timeline_v2?.timeline?.instructions ?? []
  for (const inst of instructions) {
    if (inst.type === 'TimelineAddEntries' && Array.isArray(inst.entries)) {
      return inst.entries
    }
    // Fallback: some responses use a different key
    if (Array.isArray(inst.entries)) return inst.entries
  }
  return []
}

function extractBottomCursor(entries) {
  for (const entry of entries) {
    const content = entry.content
    if (!content) continue
    // Direct cursor entry
    if (content.cursorType === 'Bottom' && content.value) return content.value
    // Nested
    if (content.entryType === 'TimelineTimelineCursor' &&
        content.cursorType === 'Bottom' && content.value) return content.value
  }
  return null
}

// ─── URL builder ──────────────────────────────────────────────────────────────

function buildPaginatedUrl(rawUrl, cursor) {
  const url = new URL(rawUrl)
  const vars = JSON.parse(decodeURIComponent(url.searchParams.get('variables') ?? '{}'))

  if (cursor) {
    vars.cursor = cursor
  } else {
    delete vars.cursor
  }

  url.searchParams.set('variables', JSON.stringify(vars))
  return url.toString()
}

// ─── Tweet parsing ────────────────────────────────────────────────────────────

/** Replaces t.co shortlinks with their expanded URLs in tweet text. */
function expandUrls(text, urlEntities = []) {
  let out = text
  for (const e of urlEntities) {
    if (e.url && e.expanded_url) out = out.replace(e.url, e.expanded_url)
  }
  return out
}

function parseTweetEntry(entry) {
  const itemContent = entry.content?.itemContent
  if (!itemContent) return null
  if (itemContent.itemType !== 'TimelineTweet') return null

  // Handle both direct result and quoted/retweeted structures
  const result =
    itemContent.tweet_results?.result?.tweet ??
    itemContent.tweet_results?.result

  if (!result) return null

  const legacy    = result.legacy
  const userResult = result.core?.user_results?.result
  const userLegacy = userResult?.legacy ?? userResult?.tweet?.legacy

  if (!legacy) return null

  const tweetId    = result.rest_id ?? legacy.id_str ?? ''
  if (!tweetId) return null

  const screenName = userLegacy?.screen_name ?? 'i'
  const url        = `https://x.com/${screenName}/status/${tweetId}`
  const urlEntities = legacy.entities?.urls ?? []
  const hashtags   = (legacy.entities?.hashtags ?? []).map(h => h.text)
  const text       = expandUrls(legacy.full_text ?? '', urlEntities)

  // Linked external URLs (excluding twitter.com/x.com self-references)
  const linkedUrls = urlEntities
    .map(e => e.expanded_url)
    .filter(u => u && !u.includes('t.co') && !u.match(/^https?:\/\/(twitter|x)\.com/))

  const createdAt = legacy.created_at
    ? new Date(legacy.created_at).toISOString()
    : null

  return {
    source:      'twitter',
    sourceType:  'social-post',
    externalId:  tweetId,
    uniqueKey:   `twitter:${tweetId}`,
    url,
    title:       '',
    text:        text.trim().slice(0, 3000),
    author:      userLegacy?.name       ?? '',
    authorTitle: userLegacy?.description ?? '',
    savedAt:     new Date().toISOString(), // Twitter doesn't expose bookmark save date
    createdAt,
    publishedAt: null,
    tags:        hashtags,
    metadata:    {
      screenName,
      likeCount:    legacy.favorite_count,
      retweetCount: legacy.retweet_count,
      linkedUrls,
    },
    raw: process.env.DEBUG ? entry : undefined,
  }
}

// ─── Paginated fetcher ────────────────────────────────────────────────────────

/**
 * Fetches all Twitter bookmarks using the session config from session.js.
 *
 * @param {Object} config - Session config from getTwitterSession()
 * @param {Object} options
 * @param {boolean} options.onlyNew     - Stop on first known tweet
 * @param {Set<string>} options.knownKeys - externalIds already in the knowledge base
 * @param {number|null} options.maxAgeDays - Skip tweets older than this (null = no filter)
 * @returns {Promise<import('../types.js').SourceItem[]>}
 */
export async function fetchAllBookmarks(
  config,
  { onlyNew = false, knownKeys = new Set(), maxAgeDays = null } = {}
) {
  const { endpoint, headers, firstBatch } = config
  const ageCutoff = maxAgeDays
    ? Date.now() - maxAgeDays * 86_400_000
    : null

  const allItems = []
  let cursor = null
  let done   = false

  // Process first batch
  for (const entry of extractEntries(firstBatch)) {
    const item = parseTweetEntry(entry)
    if (!item) continue
    if (onlyNew && knownKeys.has(item.externalId)) { done = true; break }
    if (ageCutoff && item.createdAt && new Date(item.createdAt).getTime() < ageCutoff) {
      done = true; break
    }
    allItems.push(item)
  }
  cursor = extractBottomCursor(extractEntries(firstBatch))

  process.stdout.write(`\r🔄 ${allItems.length} bookmarks fetched...`)

  while (!done && cursor) {
    await sleep(1500)

    const url = buildPaginatedUrl(endpoint, cursor)
    let response
    try {
      response = await fetch(url, { headers })
    } catch (e) {
      console.error(`\nNetwork error: ${e.message}`)
      break
    }

    if (response.status === 429) {
      console.log('\n⏳ Rate limited — waiting 10s...')
      await sleep(10_000)
      continue
    }

    if (!response.ok) {
      console.error(`\nTwitter API error: ${response.status} ${response.statusText}`)
      break
    }

    const body    = await response.json()
    const entries = extractEntries(body)

    if (entries.length === 0) break

    for (const entry of entries) {
      const item = parseTweetEntry(entry)
      if (!item) continue
      if (onlyNew && knownKeys.has(item.externalId)) { done = true; break }
      if (ageCutoff && item.createdAt && new Date(item.createdAt).getTime() < ageCutoff) {
        done = true; break
      }
      allItems.push(item)
    }

    cursor = extractBottomCursor(entries)
    process.stdout.write(`\r🔄 ${allItems.length} bookmarks fetched${cursor ? '...' : ' (done)'}   `)
  }

  console.log(`\n✅ ${allItems.length} Twitter bookmarks loaded`)
  return allItems
}
