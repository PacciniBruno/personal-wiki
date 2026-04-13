/**
 * index.js — CLI principal
 *
 * Usage :
 *   node src/index.js --mode=bootstrap   → importe TOUS les posts enregistrés
 *   node src/index.js --mode=sync        → importe seulement les nouveaux (défaut)
 *   DEBUG=1 node src/index.js            → sauvegarde la réponse brute de l'API pour debug
 *
 * Pipeline :
 *   ① Session LinkedIn (Puppeteer)
 *   ② Récupération des posts
 *   ③ Catégorisation (Claude Haiku)
 *   ④ Écriture dans ~/knowledge/raw/
 *   ⑤ Mise à jour des pages wiki (claude -p, parallèle par catégorie)
 *   [bootstrap only] Détection des posts désauvegardés
 */

import 'dotenv/config'
import { writeFile } from 'fs/promises'
import { join } from 'path'
import { homedir } from 'os'
import { getLinkedInSession, fetchAllSavedPosts } from './scraper.js'
import { categorizeBatch } from './categorize.js'
import { writePosts, markRemoved } from './writer.js'
import { runCategoryUpdates } from './synthesize.js'
import { loadState, saveState } from './state.js'

// ─── CLI args ────────────────────────────────────────────────────────────────

const args        = process.argv.slice(2)
const mode        = args.find(a => a.startsWith('--mode='))?.split('=')[1] ?? 'sync'
const isBootstrap = mode === 'bootstrap'

// ─── Validation env ──────────────────────────────────────────────────────────

function validateEnv() {
  const required = {
    ANTHROPIC_API_KEY: 'https://console.anthropic.com',
  }

  const missing = Object.entries(required).filter(([k]) => !process.env[k])
  if (missing.length === 0) return

  console.error("\n❌ Variables d'environnement manquantes dans .env :\n")
  missing.forEach(([key, hint]) => console.error(`   ${key}\n   → ${hint}\n`))
  process.exit(1)
}

// ─── Barre de progression ────────────────────────────────────────────────────

function progressBar(current, total, width = 24) {
  const filled = Math.round((current / total) * width)
  return '█'.repeat(filled) + '░'.repeat(width - filled)
}

// ─── Unsave detection (bootstrap only) ──────────────────────────────────────

async function detectUnsaved(fetchedPosts, state) {
  if (!isBootstrap) return

  const fetchedKeys = new Set(fetchedPosts.map(p => p.uniqueKey).filter(Boolean))
  const knownKeys   = new Set(state.knownKeys ?? [])

  const removedKeys = [...knownKeys].filter(k => !fetchedKeys.has(k))
  if (removedKeys.length === 0) return

  console.log(`\n🗑  ${removedKeys.length} post(s) désauvegardé(s) détecté(s) — marquage dans raw/...`)

  // We don't have the category stored per-key, so we pass 'Other' as fallback.
  // The writer.markRemoved will search by URL across raw files.
  for (const key of removedKeys) {
    const fakePost = { uniqueKey: key, url: key }
    await markRemoved(fakePost, 'Other')
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n╔══════════════════════════════════════╗')
  console.log('║   LinkedIn → Knowledge Base  📚      ║')
  console.log('╚══════════════════════════════════════╝\n')

  validateEnv()

  const state     = await loadState()
  const knownKeys = new Set(state.knownKeys ?? [])

  if (isBootstrap) {
    console.log('📋 Mode : Bootstrap — tous les posts seront importés')
  } else {
    console.log(`📋 Mode : Sync — ${knownKeys.size} posts déjà en base`)
  }

  // ── Étape 1 : Session LinkedIn ─────────────────────────────────────────────

  console.log('\n① Ouverture de LinkedIn...')
  const session = await getLinkedInSession()

  // ── Étape 2 : Récupération des posts ──────────────────────────────────────

  console.log('\n② Récupération des posts enregistrés...')
  const posts = await fetchAllSavedPosts(session, {
    onlyNew: !isBootstrap,
    knownKeys,
  })

  // Detect unsaved posts during bootstrap (compare full set against knownKeys)
  await detectUnsaved(posts, state)

  if (posts.length === 0) {
    console.log('\n✨ Tout est à jour — aucun nouveau post.')
    process.exit(0)
  }

  // ── Étape 3 : Catégorisation ───────────────────────────────────────────────

  console.log(`\n③ Catégorisation de ${posts.length} posts avec Claude Haiku...`)

  const categorized = await categorizeBatch(posts, {
    onProgress: (n, total) => {
      process.stdout.write(`\r   [${progressBar(n, total)}] ${n}/${total}`)
    },
  })

  console.log('\n')

  // ── Étape 4 : Écriture dans la base de connaissances ─────────────────────

  console.log('④ Écriture dans ~/knowledge/raw/...')
  const updatedSlugs = await writePosts(categorized)

  // Update state with new known keys
  for (const post of categorized) {
    if (post.uniqueKey) knownKeys.add(post.uniqueKey)
  }
  // In bootstrap, also remove unsaved keys from state
  if (isBootstrap) {
    const fetchedKeys = new Set(posts.map(p => p.uniqueKey).filter(Boolean))
    for (const k of [...state.knownKeys ?? []]) {
      if (!fetchedKeys.has(k)) knownKeys.delete(k)
    }
  }
  state.knownKeys = [...knownKeys]
  await saveState(state)

  console.log(`   ✅ ${categorized.length} posts écrits dans ${updatedSlugs.length} catégorie(s).`)

  // ── Étape 5 : Mise à jour des pages wiki ──────────────────────────────────

  const since = new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10)
  await runCategoryUpdates(updatedSlugs, since)

  // ── Résumé ─────────────────────────────────────────────────────────────────

  console.log('\n╔══════════════════════════════════════╗')
  console.log(`║  ✅ ${String(categorized.length).padEnd(4)} posts ajoutés à ~/knowledge/  ║`)
  console.log('╚══════════════════════════════════════╝\n')
}

main().catch(err => {
  console.error('\n❌ Erreur fatale :', err.message)
  if (process.env.DEBUG) console.error(err)
  process.exit(1)
})
