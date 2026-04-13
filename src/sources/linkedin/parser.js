/**
 * parser.js — LinkedIn Voyager API response parsing.
 *
 * Stateless helpers that turn raw Voyager JSON into normalized SourceItems.
 * Also handles paginated fetching once a session config is captured.
 *
 * Exported helpers (extractElements, looksLikePost, extractPaging) are used
 * by session.js to validate the first intercepted response.
 */

import { writeFile } from 'fs/promises'

const sleep = ms => new Promise(r => setTimeout(r, ms))

// ─── Response structure helpers ───────────────────────────────────────────────

/**
 * Extracts the elements array from a Voyager response (REST or GraphQL).
 */
export function extractElements(body) {
  // New format: EntityResultViewModel in body.included (saved-posts page)
  if (Array.isArray(body?.included)) {
    const erv = body.included.filter(
      i => i?.$type === 'com.linkedin.voyager.dash.search.EntityResultViewModel'
    )
    if (erv.length > 0) return erv
  }

  // REST style: body.elements
  if (Array.isArray(body?.elements) && body.elements.length > 0) return body.elements

  // GraphQL: body.data.data.<key>.elements
  if (body?.data?.data && typeof body.data.data === 'object') {
    for (const val of Object.values(body.data.data)) {
      if (val && Array.isArray(val.elements) && val.elements.length > 0) return val.elements
    }
  }

  // GraphQL: body.data.<key>.elements
  if (body?.data && typeof body.data === 'object') {
    if (Array.isArray(body.data.elements) && body.data.elements.length > 0) return body.data.elements
    for (const val of Object.values(body.data)) {
      if (val && Array.isArray(val.elements) && val.elements.length > 0) return val.elements
    }
  }

  return null
}

/**
 * Returns true if an element looks like a saved LinkedIn post.
 */
export function looksLikePost(element) {
  if (element?.$type === 'com.linkedin.voyager.dash.search.EntityResultViewModel') {
    const urn = element.trackingUrn ?? ''
    return urn.includes('activity') || urn.includes('ugcPost') || urn.includes('share')
  }
  const urn =
    element?.entityUrn ??
    element?.urn ??
    element?.savedContent?.entityUrn ??
    element?.savedContent?.urn ??
    element?.content?.entityUrn ??
    ''
  return (
    urn.includes('activity') ||
    urn.includes('ugcPost') ||
    urn.includes('share') ||
    urn.includes('savedContent') ||
    urn.includes('savedItem') ||
    urn.includes('article')
  )
}

/**
 * Extracts pagination info from a Voyager response.
 */
export function extractPaging(body) {
  if (body?.paging) return { ...body.paging, paginationToken: null }

  const search = body?.data?.data?.searchDashClustersByAll
  if (search?.paging) {
    return { ...search.paging, paginationToken: search.metadata?.paginationToken ?? null }
  }

  if (body?.data?.data && typeof body.data.data === 'object') {
    for (const val of Object.values(body.data.data)) {
      if (val?.paging) return { ...val.paging, paginationToken: val.metadata?.paginationToken ?? null }
    }
  }

  if (body?.data?.paging) return { ...body.data.paging, paginationToken: null }

  return { start: 0, count: 10, total: 0, paginationToken: null }
}

// ─── URL builder ──────────────────────────────────────────────────────────────

function buildPaginatedUrl(rawUrl, start, count, paginationToken = null) {
  const qIdx = rawUrl.indexOf('?')
  if (qIdx === -1) {
    const suffix = paginationToken ? `&paginationToken=${paginationToken}` : ''
    return `${rawUrl}?start=${start}&count=${count}${suffix}`
  }

  const base = rawUrl.slice(0, qIdx)
  const queryStr = rawUrl.slice(qIdx + 1)

  if (queryStr.includes('variables=')) {
    const modified = queryStr.replace(/variables=([^&]*)/, (_, vars) => {
      let v = /\bstart:\d+/.test(vars)
        ? vars.replace(/\bstart:\d+/, `start:${start}`)
        : vars
      if (/\bcount:\d+/.test(v)) v = v.replace(/\bcount:\d+/, `count:${count}`)
      if (paginationToken) {
        if (/\bpaginationToken:[^,)&]+/.test(v)) {
          v = v.replace(/\bpaginationToken:[^,)&]+/, `paginationToken:${paginationToken}`)
        } else {
          v = v.slice(0, -1) + `,paginationToken:${paginationToken})`
        }
      }
      return `variables=${v}`
    })
    return `${base}?${modified}`
  }

  const url = new URL(rawUrl)
  url.searchParams.set('start', String(start))
  url.searchParams.set('count', String(count))
  if (paginationToken) url.searchParams.set('paginationToken', paginationToken)
  return url.toString()
}

// ─── Post parsing ─────────────────────────────────────────────────────────────

function urnToUrl(urn) {
  if (!urn) return null
  if (
    urn.startsWith('urn:li:activity:') ||
    urn.startsWith('urn:li:ugcPost:') ||
    urn.startsWith('urn:li:share:')
  ) {
    return `https://www.linkedin.com/feed/update/${urn}`
  }
  return null
}

function extractSavedAt(element) {
  const ts = element.savedAt ?? element.timeSaved ?? element.savedTimestamp
  if (typeof ts === 'number' && ts > 0) return new Date(ts).toISOString()

  const insightText = (
    element.insight?.text ??
    element.footerInsight?.text ??
    element.secondaryInsight?.text ??
    ''
  ).toLowerCase()

  if (!insightText) return null

  const now = Date.now()
  const match =
    insightText.match(/(\d+)\s+second/)?.[1]  && { n: +insightText.match(/(\d+)\s+second/)[1],  unit: 1_000 }          ||
    insightText.match(/(\d+)\s+minute/)?.[1]  && { n: +insightText.match(/(\d+)\s+minute/)[1],  unit: 60_000 }         ||
    insightText.match(/(\d+)\s+hour/)?.[1]    && { n: +insightText.match(/(\d+)\s+hour/)[1],    unit: 3_600_000 }      ||
    insightText.match(/(\d+)\s+day/)?.[1]     && { n: +insightText.match(/(\d+)\s+day/)[1],     unit: 86_400_000 }     ||
    insightText.match(/(\d+)\s+week/)?.[1]    && { n: +insightText.match(/(\d+)\s+week/)[1],    unit: 604_800_000 }    ||
    insightText.match(/(\d+)\s+month/)?.[1]   && { n: +insightText.match(/(\d+)\s+month/)[1],   unit: 2_592_000_000 }  ||
    insightText.match(/(\d+)\s+year/)?.[1]    && { n: +insightText.match(/(\d+)\s+year/)[1],    unit: 31_536_000_000 } ||
    null

  if (match) return new Date(now - match.n * match.unit).toISOString()
  return null
}

/**
 * Parses a raw Voyager element into a normalized SourceItem.
 * Returns null if the element cannot be meaningfully parsed.
 */
function parseItem(element) {
  try {
    // New format: EntityResultViewModel
    if (element?.$type === 'com.linkedin.voyager.dash.search.EntityResultViewModel') {
      const urn      = element.trackingUrn ?? ''
      const rawUrl   = element.navigationContext?.url ?? element.navigationUrl ?? ''
      const url      = rawUrl ? rawUrl.split('?')[0] : (urnToUrl(urn) ?? '')
      const externalId = urn || url
      if (!externalId) return null

      return {
        source:      'linkedin',
        sourceType:  'social-post',
        externalId,
        uniqueKey:   `linkedin:${externalId}`,
        url,
        title:       '',
        text:        (element.summary?.text ?? '').trim().slice(0, 3000),
        author:      (element.title?.text ?? '').trim(),
        authorTitle: (element.primarySubtitle?.text ?? element.subtitle?.text ?? '').trim(),
        savedAt:     extractSavedAt(element),
        createdAt:   null,
        publishedAt: null,
        tags:        [],
        metadata:    { urn },
        raw:         process.env.DEBUG ? element : undefined,
      }
    }

    // Legacy format
    const content = element?.savedContent ?? element?.content ?? element

    const text =
      content?.commentary?.text?.text ??
      content?.text?.text ??
      content?.attributedBody?.text ??
      content?.description?.text ??
      content?.headline?.text ??
      content?.preview?.text ??
      element?.description?.text ??
      ''

    const urn =
      content?.contentUrn ??
      content?.urn ??
      element?.entityUrn ??
      element?.urn ??
      ''

    const url = urnToUrl(urn) ?? content?.permalink ?? element?.permalink ?? ''
    const externalId = url || urn
    if (!externalId) return null

    const actor = content?.actor ?? element?.actor ?? content?.author ?? {}
    const author =
      actor?.name?.text ?? actor?.name ?? content?.authorName ?? element?.actorName ?? ''
    const authorTitle =
      actor?.description?.text ?? actor?.headline?.text ?? actor?.headline ??
      content?.authorHeadline ?? ''

    const savedAt  = element?.savedAt ?? content?.savedAt
    const createdAt = element?.createdAt ?? content?.createdAt ?? content?.publishedAt

    return {
      source:      'linkedin',
      sourceType:  'social-post',
      externalId,
      uniqueKey:   `linkedin:${externalId}`,
      url,
      title:       '',
      text:        text.trim().slice(0, 3000),
      author:      author.trim(),
      authorTitle: authorTitle.trim(),
      savedAt:     savedAt  ? new Date(savedAt).toISOString()  : null,
      createdAt:   createdAt ? new Date(createdAt).toISOString() : null,
      publishedAt: null,
      tags:        [],
      metadata:    { urn, authorTitle: authorTitle.trim() },
      raw:         process.env.DEBUG ? element : undefined,
    }
  } catch {
    return null
  }
}

// ─── Paginated fetcher ────────────────────────────────────────────────────────

/**
 * Paginates over all saved posts using the session config captured by session.js.
 *
 * @param {Object} config - Session config from getLinkedInSession()
 * @param {Object} options
 * @param {boolean} options.onlyNew - Stop on first known item (sync mode)
 * @param {Set<string>} options.knownKeys - Set of externalIds already in the knowledge base
 * @returns {Promise<import('../types.js').SourceItem[]>}
 */
export async function fetchAllSavedPosts(config, { onlyNew = false, knownKeys = new Set() } = {}) {
  const { endpoint, paging, headers, firstBatch } = config
  const count = paging?.count ?? 10
  const total = paging?.total ?? Infinity
  let paginationToken = paging?.paginationToken ?? null

  const allItems = []
  let start = 0
  let done = false

  // Process the first batch already captured by session.js
  for (const el of extractElements(firstBatch) ?? []) {
    const item = parseItem(el)
    if (!item) continue
    if (onlyNew && knownKeys.has(item.externalId)) { done = true; break }
    allItems.push(item)
  }
  start = (extractElements(firstBatch) ?? []).length

  process.stdout.write(`\r🔄 ${start} items fetched...`)

  while (!done && (paginationToken || start < total)) {
    await sleep(1200)

    const url = buildPaginatedUrl(endpoint, start, count, paginationToken)
    let response
    try {
      response = await fetch(url, { headers })
    } catch (e) {
      console.error(`\nNetwork error: ${e.message}`)
      break
    }

    if (response.status === 429) {
      console.log('\n⏳ Rate limited — waiting 8s...')
      await sleep(8000)
      continue
    }

    if (!response.ok) {
      console.error(`\nLinkedIn API error: ${response.status} ${response.statusText}`)
      break
    }

    const body = await response.json()
    const newPaging = extractPaging(body)
    const elements = extractElements(body) ?? []

    if (elements.length === 0) break

    for (const el of elements) {
      const item = parseItem(el)
      if (!item) continue
      if (onlyNew && knownKeys.has(item.externalId)) { done = true; break }
      allItems.push(item)
    }

    start += elements.length
    paginationToken = newPaging?.paginationToken ?? null

    process.stdout.write(`\r🔄 ${start} items fetched${paginationToken ? '...' : ' (done)'}   `)

    if (!paginationToken && elements.length < count) break
  }

  console.log(`\n✅ ${allItems.length} LinkedIn items loaded`)
  return allItems
}
