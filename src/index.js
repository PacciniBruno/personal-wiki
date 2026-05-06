/**
 * index.js — CLI orchestrator.
 *
 * Usage:
 *   node src/index.js --mode=sync              (default: LinkedIn only)
 *   node src/index.js --mode=bootstrap
 *   node src/index.js --mode=sync --source=all
 *   node src/index.js --mode=sync --source=linkedin
 *   node src/index.js --mode=sync --source=twitter,web
 *
 * Pipeline delegated to src/pipeline/ingest.js.
 * Source selection delegated to src/sources/index.js.
 */

import { config as loadDotenv } from 'dotenv'
loadDotenv({ override: true })
import { KB_DIR, config }                    from './config.js'
import { loadState, saveState }              from './state.js'
import { runCategoryUpdates }                from './synthesize.js'
import { ingest }                            from './pipeline/ingest.js'
import { ALL_SOURCES, getEnabledSources, getSourceById } from './sources/index.js'

// ─── CLI args ────────────────────────────────────────────────────────────────

const args       = process.argv.slice(2)
const mode       = args.find(a => a.startsWith('--mode='))?.split('=')[1]   ?? 'sync'
const sourceArg  = args.find(a => a.startsWith('--source='))?.split('=')[1] ?? 'linkedin'

// ─── Env validation ──────────────────────────────────────────────────────────

function validateEnv() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('\n❌ ANTHROPIC_API_KEY is missing from .env')
    console.error('   Get one at https://console.anthropic.com\n')
    process.exit(1)
  }
}

// ─── Source selection ─────────────────────────────────────────────────────────

function selectSources() {
  if (sourceArg === 'all') {
    return getEnabledSources(config)
  }

  // Comma-separated list: --source=linkedin,twitter
  const ids = sourceArg.split(',').map(s => s.trim())
  const sources = []

  for (const id of ids) {
    const adapter = getSourceById(id)
    if (!adapter) {
      console.error(`\n❌ Unknown source: "${id}". Available: ${ALL_SOURCES.map(s => s.id).join(', ')}`)
      process.exit(1)
    }
    if (!adapter.isEnabled(config)) {
      console.error(`\n❌ Source "${id}" is not configured. Check .env.example for required variables.`)
      process.exit(1)
    }
    sources.push(adapter)
  }

  return sources
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n╔═══════════════════════════════════════╗')
  console.log('║       Personal Wiki  📚               ║')
  console.log('╚═══════════════════════════════════════╝\n')

  validateEnv()

  const activeSources = selectSources()
  const kbPath = KB_DIR.replace(process.env.HOME ?? '', '~')

  console.log(`Mode:    ${mode}`)
  console.log(`Sources: ${activeSources.map(s => s.label).join(', ')}`)
  console.log(`KB:      ${kbPath}\n`)

  const state = await loadState()

  // ── Ingest ────────────────────────────────────────────────────────────────

  const { categorized, updatedSlugs } = await ingest({ activeSources, mode, state })

  // ── Save state ────────────────────────────────────────────────────────────

  await saveState(state)

  if (categorized.length === 0) {
    console.log('\n✨ All up to date — no new items.')
    process.exit(0)
  }

  // ── Wiki synthesis ────────────────────────────────────────────────────────

  const since = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10)
  await runCategoryUpdates(updatedSlugs, since)

  // ── Summary ───────────────────────────────────────────────────────────────

  console.log('\n╔═══════════════════════════════════════╗')
  console.log(`║  ✅ ${String(categorized.length).padEnd(4)} items added to wiki          ║`)
  console.log(`║     ${kbPath.padEnd(33)} ║`)
  console.log('╚═══════════════════════════════════════╝\n')
}

main().catch(err => {
  console.error('\n❌ Fatal error:', err.message)
  if (process.env.DEBUG) console.error(err)
  process.exit(1)
})
