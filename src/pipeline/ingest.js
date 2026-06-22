/**
 * pipeline/ingest.js — Core pipeline orchestration.
 *
 * Fetch → filter → categorize → write → update state.
 * index.js calls this; it knows nothing about individual sources.
 */

import { appendFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { categorizeBatch } from '../categorize.js'
import { writePosts, markRemoved } from '../writer.js'
import { filterKnown } from './filters.js'
import { getSourceKnownIds, updateStateWithItems, reconcileRemovedIds } from './dedupe.js'
import { STATE_DIR } from '../config.js'

const FETCH_FAILURES_LOG = join(STATE_DIR, 'ingest-failures.log')

function progressBar(current, total, width = 24) {
  const filled = Math.round((current / total) * width)
  return '█'.repeat(filled) + '░'.repeat(width - filled)
}

// A source can fail while others succeed; index.js then still exits 0, which
// hides the failure from the launchd stage stamp. Persist it so a partial or
// silent ingest is diagnosable (`npm run doctor` surfaces this file).
async function logFetchFailure(sourceLabel, err) {
  const line = `${new Date().toISOString()}  ${sourceLabel}: ${err.message}\n`
  try {
    await mkdir(STATE_DIR, { recursive: true })
    await appendFile(FETCH_FAILURES_LOG, line)
  } catch {
    // best-effort — never throw from the logger
  }
}

/**
 * Runs the full ingest pipeline for the given sources.
 *
 * @param {Object} options
 * @param {import('../sources/types.js').SourceAdapter[]} options.activeSources
 * @param {'sync'|'bootstrap'} options.mode
 * @param {Object} options.state - Pipeline state v2 (mutated in place — caller saves it)
 * @returns {Promise<{ categorized: Object[], updatedSlugs: string[] }>}
 */
export async function ingest({ activeSources, mode, state }) {
  const allItems = []

  // ── Step 1: Fetch from each source ──────────────────────────────────────────

  for (const source of activeSources) {
    if (!state.sources[source.id]) {
      state.sources[source.id] = { knownKeys: [], lastSyncAt: null }
    }

    const knownIds = getSourceKnownIds(state, source.id)

    let items
    try {
      items = await source.fetch({ mode, state: state.sources[source.id], knownKeys: knownIds })
    } catch (err) {
      console.error(`\n⚠️  ${source.label}: fetch failed — ${err.message}`)
      await logFetchFailure(source.label, err)
      continue
    }

    // Belt-and-suspenders dedup (source's own early-stop is the primary mechanism)
    items = filterKnown(items, knownIds)
    allItems.push(...items)
  }

  // ── Step 2: Removed detection (bootstrap only) ───────────────────────────────

  if (mode === 'bootstrap') {
    for (const source of activeSources.filter(s => s.supportsRemovedDetection)) {
      const fetchedIds = new Set(
        allItems.filter(i => i.source === source.id).map(i => i.externalId).filter(Boolean)
      )
      const removedIds = reconcileRemovedIds(state, source.id, fetchedIds)

      if (removedIds.length > 0) {
        console.log(`\n🗑  ${removedIds.length} item(s) removed from ${source.label} — marking in raw/...`)
        for (const id of removedIds) {
          await markRemoved({ url: id, externalId: id, source: source.id }, 'Other')
        }
      }
    }
  }

  if (allItems.length === 0) {
    return { categorized: [], updatedSlugs: [] }
  }

  // ── Step 3: Categorize ───────────────────────────────────────────────────────

  console.log(`\n③ Categorizing ${allItems.length} item(s) with Claude Haiku...`)

  const categorized = await categorizeBatch(allItems, {
    onProgress: (n, total) => {
      process.stdout.write(`\r   [${progressBar(n, total)}] ${n}/${total}`)
    },
  })

  console.log('\n')

  // ── Step 4: Write to knowledge base ─────────────────────────────────────────

  console.log('④ Writing to knowledge base...')
  const updatedSlugs = await writePosts(categorized)

  console.log(`   ✅ ${categorized.length} item(s) written across ${updatedSlugs.length} category/ies.`)

  // ── Step 5: Update state ─────────────────────────────────────────────────────

  updateStateWithItems(state, categorized)

  return { categorized, updatedSlugs }
}
