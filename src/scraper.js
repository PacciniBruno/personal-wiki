/**
 * scraper.js
 *
 * Ouvre Chrome avec Puppeteer, attend que tu sois connecté à LinkedIn,
 * intercepte l'appel API Voyager fait sur la page des posts enregistrés,
 * puis pagine sur tous les posts via fetch() natif avec les mêmes headers.
 */

import puppeteer from 'puppeteer'
import { homedir } from 'os'
import { join } from 'path'
import { mkdir, writeFile } from 'fs/promises'
import { createInterface } from 'readline'

const SESSION_DIR = join(homedir(), '.linkedin-notion-sync', 'chrome-session')
const SAVED_POSTS_URL = 'https://www.linkedin.com/my-items/saved-posts/'
const sleep = ms => new Promise(r => setTimeout(r, ms))

/**
 * Lance Chrome, capture la config de l'API Voyager (endpoint + headers auth),
 * et ferme le navigateur. Retourne la config pour paginer ensuite en fetch natif.
 */
export async function getLinkedInSession() {
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
  let shouldCapture = false
  const allDebugVoyager = []

  // Patterns that are definitely NOT saved-posts (alerts, config, identity, messaging, etc.)
  const EXCLUDE_URL_PATTERNS = [
    'GlobalAlert', 'globalAlert',
    'chameleon', 'Chameleon',
    'segment', 'Segment',
    'tracking', 'Tracking',
    'identity', 'Identity',
    'Config', 'Settings',
    'voyagerBar', 'launchpad', 'typeahead',
    'messaging', 'Messaging',
    'notification', 'Notification',
    'Mailbox', 'mailbox',
    'presenceStat',
  ]

  page.on('response', async response => {
    if (!shouldCapture) return

    const url = response.url()
    if (!url.includes('/voyager/api/')) return

    let body
    try {
      body = await response.json()
    } catch (_) {
      return
    }

    // Debug: accumulate ALL Voyager responses unconditionally (full URL for diagnosis)
    if (process.env.DEBUG) {
      console.log(`🐛 Voyager URL: ${url.split('?')[0]}`)
      allDebugVoyager.push({ url, body })
    }

    // Already captured
    if (capturedConfig) return

    // Exclude known non-post endpoints
    if (EXCLUDE_URL_PATTERNS.some(p => url.includes(p))) return

    // Find elements array in response
    const elements = extractElements(body)
    if (!elements || elements.length === 0) return

    // Validate: at least one element must look like a saved post
    if (!elements.some(looksLikePost)) return

    // Capture the session config
    const cookies = await page.cookies('https://www.linkedin.com')
    const cookieStr = cookies.map(c => `${c.name}=${c.value}`).join('; ')
    const jsessionid = cookies
      .find(c => c.name === 'JSESSIONID')
      ?.value?.replace(/"/g, '') ?? ''
    const userAgent = await browser.userAgent()

    capturedConfig = {
      endpoint: url,
      paging: extractPaging(body),
      headers: {
        cookie: cookieStr,
        'csrf-token': jsessionid,
        'x-restli-protocol-version': '2.0.0',
        'x-li-lang': 'en_US',
        'x-li-track': JSON.stringify({ clientVersion: '1.13.6190' }),
        accept: 'application/vnd.linkedin.normalized+json+2.1',
        'user-agent': userAgent,
      },
      firstBatch: body,
    }

    if (process.env.DEBUG) {
      await writeFile('./debug-first-response.json', JSON.stringify(body, null, 2))
      console.log('\n🐛 Debug: réponse brute sauvegardée dans debug-first-response.json')
    }

    const paging = extractPaging(body)
    console.log(`\n✅ API interceptée : ${url.split('?')[0]}`)
    console.log(`   Total posts estimé : ${paging?.total ?? 'inconnu'}`)
  })

  // Active le listener dès maintenant (looksLikePost empêchera les faux positifs)
  shouldCapture = true

  // Première navigation — l'API des posts se déclenche ici si on est connecté
  await page.goto(SAVED_POSTS_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await sleep(2000)

  const currentUrl = page.url()
  const needsLogin =
    currentUrl.includes('/login') ||
    currentUrl.includes('authwall') ||
    currentUrl.includes('/uas/')

  if (needsLogin) {
    console.log('\n⚠️  Non connecté. Connecte-toi à LinkedIn dans la fenêtre Chrome.')
    console.log('    Une fois connecté, appuie sur Entrée ici pour continuer...\n')
    await waitForEnter()
    // Naviguer vers les posts après login
    await page.goto(SAVED_POSTS_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  } else {
    console.log('✅ Session LinkedIn trouvée, pas besoin de reconnexion.')
  }

  // Attente pour que tous les appels API asynchrones se terminent
  await sleep(8000)

  // Si toujours pas capturé, essayer un rechargement de la page
  if (!capturedConfig) {
    console.log('   Rechargement de la page pour déclencher les appels API...')
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 })
    await sleep(8000)
  }

  if (process.env.DEBUG && allDebugVoyager.length > 0) {
    await writeFile('./debug-all-voyager.json', JSON.stringify(allDebugVoyager, null, 2))
    console.log(`\n🐛 Debug: ${allDebugVoyager.length} réponses Voyager sauvegardées dans debug-all-voyager.json`)
  }

  await browser.close()

  if (!capturedConfig) {
    throw new Error(
      "Impossible d'intercepter l'API LinkedIn. Vérifie que tu es bien connecté " +
        'et que la page de posts enregistrés a bien chargé.\n' +
        'Lance avec DEBUG=1 node src/index.js pour voir toutes les requêtes.'
    )
  }

  return capturedConfig
}

/**
 * Extrait le tableau d'éléments d'une réponse Voyager (REST ou GraphQL).
 */
function extractElements(body) {
  // Nouveau format: EntityResultViewModel dans body.included (page saved-posts)
  if (Array.isArray(body?.included)) {
    const erv = body.included.filter(
      i => i?.$type === 'com.linkedin.voyager.dash.search.EntityResultViewModel'
    )
    if (erv.length > 0) return erv
  }

  // REST style: body.elements
  if (Array.isArray(body?.elements) && body.elements.length > 0) return body.elements

  // GraphQL style: body.data.data.<key>.elements
  if (body?.data?.data && typeof body.data.data === 'object') {
    for (const val of Object.values(body.data.data)) {
      if (val && Array.isArray(val.elements) && val.elements.length > 0) return val.elements
    }
  }

  // GraphQL style: body.data.<key>.elements
  if (body?.data && typeof body.data === 'object') {
    if (Array.isArray(body.data.elements) && body.data.elements.length > 0) return body.data.elements
    for (const val of Object.values(body.data)) {
      if (val && Array.isArray(val.elements) && val.elements.length > 0) return val.elements
    }
  }

  return null
}

/**
 * Vérifie si un élément ressemble à un post LinkedIn sauvegardé.
 */
function looksLikePost(element) {
  // Nouveau format: EntityResultViewModel (résultats de recherche)
  if (element?.$type === 'com.linkedin.voyager.dash.search.EntityResultViewModel') {
    const urn = element.trackingUrn ?? ''
    return urn.includes('activity') || urn.includes('ugcPost') || urn.includes('share')
  }
  // Ancien format: URN directe
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
 * Extrait les infos de pagination d'une réponse Voyager.
 * Retourne aussi paginationToken pour la pagination curseur.
 */
function extractPaging(body) {
  // REST direct
  if (body?.paging) return { ...body.paging, paginationToken: null }

  // Nouveau format: search avec paginationToken curseur
  const search = body?.data?.data?.searchDashClustersByAll
  if (search?.paging) {
    return {
      ...search.paging,
      paginationToken: search.metadata?.paginationToken ?? null,
    }
  }

  // GraphQL générique body.data.data.<key>.paging
  if (body?.data?.data && typeof body.data.data === 'object') {
    for (const val of Object.values(body.data.data)) {
      if (val?.paging) return { ...val.paging, paginationToken: val.metadata?.paginationToken ?? null }
    }
  }

  if (body?.data?.paging) return { ...body.data.paging, paginationToken: null }

  return { start: 0, count: 10, total: 0, paginationToken: null }
}

/**
 * Pagine sur tous les posts enregistrés via fetch natif, en utilisant
 * la config capturée par Puppeteer (endpoint + headers auth).
 */
export async function fetchAllSavedPosts(
  config,
  { onlyNew = false, knownKeys = new Set() } = {}
) {
  const { endpoint, paging, headers, firstBatch } = config
  const count = paging?.count ?? 10
  const total = paging?.total ?? Infinity
  let paginationToken = paging?.paginationToken ?? null

  const allPosts = []
  let start = 0
  let done = false

  // On traite le premier batch qu'on a déjà
  const firstElements = extractElements(firstBatch) ?? []
  for (const el of firstElements) {
    const post = parsePost(el)
    if (!post) continue
    if (onlyNew && knownKeys.has(post.uniqueKey)) { done = true; break }
    allPosts.push(post)
  }
  start = firstElements.length

  // Affichage initial — total peut être inexact avec la pagination curseur
  process.stdout.write(`\r🔄 ${start} posts récupérés...`)

  // Pagination suivante (on boucle tant qu'il y a un paginationToken ou des pages non vues)
  while (!done && (paginationToken || start < total)) {
    await sleep(1200) // On est polis avec LinkedIn

    const url = buildPaginatedUrl(endpoint, start, count, paginationToken)

    let response
    try {
      response = await fetch(url, { headers })
    } catch (e) {
      console.error(`\nErreur réseau : ${e.message}`)
      break
    }

    if (response.status === 429) {
      console.log('\n⏳ Rate limited — attente 8 secondes...')
      await sleep(8000)
      continue
    }

    if (!response.ok) {
      console.error(`\nErreur API LinkedIn : ${response.status} ${response.statusText}`)
      break
    }

    const body = await response.json()
    const newPaging = extractPaging(body)
    const elements = extractElements(body) ?? []

    if (elements.length === 0) break

    for (const el of elements) {
      const post = parsePost(el)
      if (!post) continue
      if (onlyNew && knownKeys.has(post.uniqueKey)) { done = true; break }
      allPosts.push(post)
    }

    start += elements.length
    paginationToken = newPaging?.paginationToken ?? null

    process.stdout.write(`\r🔄 ${start} posts récupérés${paginationToken ? '...' : ' (terminé)'}   `)

    // Arrêt si pas de token suivant ou moins d'éléments que le count (dernière page)
    if (!paginationToken && elements.length < count) break
  }

  console.log(`\n✅ ${allPosts.length} posts chargés`)
  return allPosts
}

// Construit l'URL paginée en gérant les deux styles (REST, GraphQL, curseur)
// On manipule la chaîne URL directement pour préserver le format custom de LinkedIn
// (parenthèses et deux-points non encodés) — URLSearchParams les ré-encoderait.
function buildPaginatedUrl(rawUrl, start, count, paginationToken = null) {
  const qIdx = rawUrl.indexOf('?')
  if (qIdx === -1) {
    // URL sans query string — REST simple
    const suffix = paginationToken ? `&paginationToken=${paginationToken}` : ''
    return `${rawUrl}?start=${start}&count=${count}${suffix}`
  }

  const base = rawUrl.slice(0, qIdx)
  const queryStr = rawUrl.slice(qIdx + 1)

  if (queryStr.includes('variables=')) {
    // LinkedIn GraphQL style : on modifie la valeur variables directement
    const modified = queryStr.replace(/variables=([^&]*)/, (_, vars) => {
      // Mise à jour de start
      let v = /\bstart:\d+/.test(vars)
        ? vars.replace(/\bstart:\d+/, `start:${start}`)
        : vars

      // Mise à jour de count (si présent)
      if (/\bcount:\d+/.test(v)) v = v.replace(/\bcount:\d+/, `count:${count}`)

      // Ajout / mise à jour du paginationToken
      if (paginationToken) {
        if (/\bpaginationToken:[^,)&]+/.test(v)) {
          v = v.replace(/\bpaginationToken:[^,)&]+/, `paginationToken:${paginationToken}`)
        } else {
          // Insère avant la dernière parenthèse fermante
          v = v.slice(0, -1) + `,paginationToken:${paginationToken})`
        }
      }

      return `variables=${v}`
    })

    return `${base}?${modified}`
  }

  // REST style classique : on utilise URLSearchParams pour le reste
  const url = new URL(rawUrl)
  url.searchParams.set('start', String(start))
  url.searchParams.set('count', String(count))
  if (paginationToken) url.searchParams.set('paginationToken', paginationToken)
  return url.toString()
}

/**
 * Tries to extract a savedAt ISO date string from an EntityResultViewModel.
 * LinkedIn sometimes exposes a numeric timestamp, otherwise we parse the
 * insight text (e.g. "Saved · 3 days ago" / "1 month ago" / "2 weeks ago").
 */
function extractSavedAt(element) {
  // Try direct numeric timestamp fields (epoch ms)
  const ts = element.savedAt ?? element.timeSaved ?? element.savedTimestamp
  if (typeof ts === 'number' && ts > 0) {
    return new Date(ts).toISOString()
  }

  // Try to parse relative text from insight fields
  const insightText = (
    element.insight?.text ??
    element.footerInsight?.text ??
    element.secondaryInsight?.text ??
    ''
  ).toLowerCase()

  if (!insightText) return null

  const now = Date.now()
  const match =
    insightText.match(/(\d+)\s+second/)?.[1]  && { n: +insightText.match(/(\d+)\s+second/)[1], unit: 1000 } ||
    insightText.match(/(\d+)\s+minute/)?.[1]  && { n: +insightText.match(/(\d+)\s+minute/)[1], unit: 60_000 } ||
    insightText.match(/(\d+)\s+hour/)?.[1]    && { n: +insightText.match(/(\d+)\s+hour/)[1],   unit: 3_600_000 } ||
    insightText.match(/(\d+)\s+day/)?.[1]     && { n: +insightText.match(/(\d+)\s+day/)[1],    unit: 86_400_000 } ||
    insightText.match(/(\d+)\s+week/)?.[1]    && { n: +insightText.match(/(\d+)\s+week/)[1],   unit: 604_800_000 } ||
    insightText.match(/(\d+)\s+month/)?.[1]   && { n: +insightText.match(/(\d+)\s+month/)[1],  unit: 2_592_000_000 } ||
    insightText.match(/(\d+)\s+year/)?.[1]    && { n: +insightText.match(/(\d+)\s+year/)[1],   unit: 31_536_000_000 } ||
    null

  if (match) return new Date(now - match.n * match.unit).toISOString()
  return null
}

/**
 * Parse un élément brut de l'API LinkedIn en un objet post propre.
 * La structure Voyager est denormalisée — on essaie plusieurs chemins.
 */
function parsePost(element) {
  try {
    // Nouveau format: EntityResultViewModel (page de recherche des posts sauvegardés)
    if (element?.$type === 'com.linkedin.voyager.dash.search.EntityResultViewModel') {
      const urn = element.trackingUrn ?? ''
      // URL propre sans les paramètres de tracking LinkedIn
      const rawUrl = element.navigationContext?.url ?? element.navigationUrl ?? ''
      const url = rawUrl ? rawUrl.split('?')[0] : (urnToUrl(urn) ?? '')
      const uniqueKey = urn || url
      if (!uniqueKey) return null

      return {
        url,
        urn,
        uniqueKey,
        text: (element.summary?.text ?? '').trim().slice(0, 3000),
        author: (element.title?.text ?? '').trim(),
        authorTitle: (element.primarySubtitle?.text ?? element.subtitle?.text ?? '').trim(),
        savedAt: extractSavedAt(element),
        createdAt: null,
      }
    }

    // Ancien format: contenu wrapper dans savedContent ou direct
    const content = element?.savedContent ?? element?.content ?? element

    // Texte du post — plusieurs chemins possibles selon le type
    const text =
      content?.commentary?.text?.text ??
      content?.text?.text ??
      content?.attributedBody?.text ??
      content?.description?.text ??
      content?.headline?.text ??
      content?.preview?.text ??
      element?.description?.text ??
      ''

    // URN LinkedIn (identifiant unique)
    const urn =
      content?.contentUrn ??
      content?.urn ??
      element?.entityUrn ??
      element?.urn ??
      ''

    // URL publique du post
    const url = urnToUrl(urn) ?? content?.permalink ?? element?.permalink ?? ''

    // Clé unique pour la déduplication (URL si dispo, sinon URN)
    const uniqueKey = url || urn
    if (!uniqueKey) return null

    // Auteur
    const actor = content?.actor ?? element?.actor ?? content?.author ?? {}
    const author =
      actor?.name?.text ??
      actor?.name ??
      content?.authorName ??
      element?.actorName ??
      ''

    const authorTitle =
      actor?.description?.text ??
      actor?.headline?.text ??
      actor?.headline ??
      content?.authorHeadline ??
      ''

    // Dates
    const savedAt = element?.savedAt ?? content?.savedAt
    const createdAt = element?.createdAt ?? content?.createdAt ?? content?.publishedAt

    return {
      url,
      urn,
      uniqueKey,
      text: text.trim().slice(0, 3000),
      author: author.trim(),
      authorTitle: authorTitle.trim(),
      savedAt: savedAt ? new Date(savedAt).toISOString() : null,
      createdAt: createdAt ? new Date(createdAt).toISOString() : null,
    }
  } catch {
    return null
  }
}

// Convertit un URN LinkedIn en URL publique navigable
function urnToUrl(urn) {
  if (!urn) return null
  if (urn.startsWith('urn:li:activity:') || urn.startsWith('urn:li:ugcPost:')) {
    return `https://www.linkedin.com/feed/update/${urn}`
  }
  if (urn.startsWith('urn:li:share:')) {
    return `https://www.linkedin.com/feed/update/${urn}`
  }
  return null
}

async function waitForEnter() {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  return new Promise(resolve => rl.question('', () => { rl.close(); resolve() }))
}
