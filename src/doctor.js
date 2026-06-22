/**
 * doctor.js — Health check for the personal-wiki pipeline.
 *
 * Answers "why is sync dead?" without guessing. Inspects the things that
 * actually break in production — node/claude resolution, API key, KB freshness,
 * per-source dedup state, the daily run stamps, the LinkedIn cached session,
 * and the failure logs — and prints a verdict with the most likely culprit.
 *
 * Usage: npm run doctor
 */

import { readFile, readdir, stat } from 'fs/promises'
import { join } from 'path'
import { homedir } from 'os'
import { execFileSync } from 'child_process'
import { KB_DIR, STATE_DIR, CLAUDE_BIN } from './config.js'

const TODAY = new Date().toISOString().slice(0, 10)
const ok   = s => `✅ ${s}`
const warn = s => `⚠️  ${s}`
const bad  = s => `❌ ${s}`

const findings = []   // collected problems for the closing verdict

function section(title) {
  console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 40 - title.length))}`)
}

async function fileAge(path) {
  try {
    const s = await stat(path)
    const days = (Date.now() - s.mtimeMs) / 86_400_000
    return { exists: true, mtime: s.mtimeMs, days, iso: new Date(s.mtimeMs).toISOString().slice(0, 10) }
  } catch {
    return { exists: false }
  }
}

async function readText(path) {
  try { return await readFile(path, 'utf8') } catch { return null }
}

async function tail(path, n = 8) {
  const text = await readText(path)
  if (text === null) return null
  const lines = text.trimEnd().split('\n')
  return lines.slice(-n).join('\n')
}

// ── Environment ────────────────────────────────────────────────────────────

async function checkEnvironment() {
  section('Environment')
  console.log(`   KB_DIR     ${KB_DIR}`)
  console.log(`   STATE_DIR  ${STATE_DIR}`)
  console.log(`   CLAUDE_BIN ${CLAUDE_BIN}`)
  console.log(`   node       ${process.version} (${process.execPath})`)

  // claude CLI resolvable? (synthesis + projects depend on it)
  try {
    const v = execFileSync(CLAUDE_BIN, ['--version'], { encoding: 'utf8', timeout: 15_000 }).trim()
    console.log(ok(`claude CLI runnable — ${v.split('\n')[0]}`))
  } catch (err) {
    console.log(bad(`claude CLI not runnable as "${CLAUDE_BIN}" — ${err.message.split('\n')[0]}`))
    console.log('      → wiki synthesis and project docs cannot run.')
    console.log('      → set CLAUDE_BIN in .env, or ensure `claude` is on PATH (incl. under launchd).')
    findings.push('claude CLI is not runnable — all synthesis/project updates will fail.')
  }

  if (process.env.ANTHROPIC_API_KEY) {
    console.log(ok('ANTHROPIC_API_KEY is set (used by the Haiku categorizer).'))
  } else {
    console.log(bad('ANTHROPIC_API_KEY is missing — ingest categorization will fail.'))
    findings.push('ANTHROPIC_API_KEY is missing — ingest cannot categorize posts.')
  }
  console.log('   note: synthesis strips ANTHROPIC_API_KEY and uses your claude')
  console.log('         subscription. If `claude` is not logged in (claude /login),')
  console.log('         wiki/project synthesis fails even when ingest works.')
}

// ── Knowledge base freshness ───────────────────────────────────────────────

async function checkKnowledgeBase() {
  section('Knowledge base')
  const kb = await fileAge(KB_DIR)
  if (!kb.exists) {
    console.log(bad(`KB_DIR does not exist: ${KB_DIR} — run \`npm run init-kb\`.`))
    findings.push('KB_DIR does not exist — run `npm run init-kb`.')
    return
  }

  // Most recent raw/ entry = the real "are posts arriving?" signal.
  let newestRaw = null
  try {
    const rawDir = join(KB_DIR, 'raw')
    for (const f of await readdir(rawDir)) {
      if (!f.endsWith('.md')) continue
      const a = await fileAge(join(rawDir, f))
      if (a.exists && (!newestRaw || a.mtime > newestRaw.mtime)) newestRaw = { f, ...a }
    }
  } catch {
    console.log(warn('no raw/ directory — KB may be uninitialized.'))
  }

  if (newestRaw) {
    const msg = `most recent raw/ write: ${newestRaw.f} (${newestRaw.days.toFixed(1)}d ago)`
    if (newestRaw.days > 3) {
      console.log(warn(msg))
      findings.push(`No posts written to raw/ in ${newestRaw.days.toFixed(0)} days — ingest may be stalled.`)
    } else {
      console.log(ok(msg))
    }
  }

  const wiki = await fileAge(join(KB_DIR, 'wiki'))
  if (wiki.exists) console.log(`   wiki/ last touched ${wiki.days.toFixed(1)}d ago`)
  const synth = await fileAge(join(KB_DIR, 'synthesis.md'))
  if (synth.exists) console.log(`   synthesis.md updated ${synth.days.toFixed(1)}d ago`)

  // Projects (the user cares specifically about dona)
  try {
    const projDir = join(KB_DIR, 'projects')
    const entries = await readdir(projDir, { withFileTypes: true })
    for (const e of entries.filter(d => d.isDirectory())) {
      const w = await fileAge(join(projDir, e.name, 'wiki.md'))
      console.log(w.exists
        ? `   project "${e.name}" wiki.md updated ${w.days.toFixed(1)}d ago`
        : warn(`project "${e.name}" has no wiki.md yet`))
    }
  } catch {
    console.log('   (no projects/ directory)')
  }
}

// ── State + dedup ──────────────────────────────────────────────────────────

async function checkState() {
  section('State (dedup + last sync)')
  const text = await readText(join(STATE_DIR, 'state.json'))
  if (!text) {
    console.log(warn('no state.json yet — first sync has not completed.'))
    return
  }
  let state
  try { state = JSON.parse(text) } catch {
    console.log(bad('state.json is not valid JSON — sync cannot dedup. Inspect/repair it.'))
    findings.push('state.json is corrupt.')
    return
  }
  for (const [id, s] of Object.entries(state.sources ?? {})) {
    const n = s.knownKeys?.length ?? 0
    const last = s.lastSyncAt ? s.lastSyncAt.slice(0, 10) : 'never'
    console.log(`   ${id.padEnd(12)} ${String(n).padStart(5)} known  · last sync ${last}`)
  }
  for (const [name, p] of Object.entries(state.projects ?? {})) {
    console.log(`   project ${name.padEnd(10)} last synced ${p.lastSyncedAt?.slice(0, 10) ?? 'never'}`)
  }
}

// ── Daily run stamps ───────────────────────────────────────────────────────

async function checkStamps() {
  section('Daily run stamps')
  const stamps = [
    ['ingest',    'last-ingest-date'],
    ['projects',  'last-projects-date'],
    ['synthesis', 'last-synthesis-date'],
  ]
  for (const [label, base] of stamps) {
    const doneVal = (await readText(join(STATE_DIR, base)))?.trim()
    const attempts = (await readText(join(STATE_DIR, `${base}.attempts`)))?.trim()
    const ranToday = doneVal === TODAY
    const line = `   ${label.padEnd(10)} last success: ${doneVal ?? 'never'}` +
      (ranToday ? ' (today)' : '') +
      (attempts ? `  · attempts: ${attempts}` : '')
    console.log(line)
  }
}

// ── LinkedIn session ───────────────────────────────────────────────────────

async function checkLinkedIn() {
  section('LinkedIn session')
  const cache = await fileAge(join(STATE_DIR, 'linkedin-session.json'))
  if (!cache.exists) {
    console.log(warn('no cached session (linkedin-session.json). First run opens Chrome to log in.'))
    return
  }
  console.log(`   cached session present (refreshed ${cache.days.toFixed(1)}d ago)`)
  console.log('   note: if it has expired, a scheduled (launchd) run cannot re-login —')
  console.log('         run `npm run linkedin:refresh` once in a terminal to refresh it.')
}

// ── Failure logs ───────────────────────────────────────────────────────────

async function checkLogs() {
  section('Recent failures')
  const logs = [
    ['run-failures.log',    join(STATE_DIR, 'run-failures.log')],
    ['ingest-failures.log', join(STATE_DIR, 'ingest-failures.log')],
    ['synth-failures.log',  join(STATE_DIR, 'synth-failures.log')],
    ['launchd sync stderr', join(homedir(), 'Library', 'Logs', 'personal-wiki-sync.error.log')],
    ['launchd synth stderr', join(homedir(), 'Library', 'Logs', 'personal-wiki-synthesis.error.log')],
  ]
  let any = false
  for (const [label, path] of logs) {
    const t = await tail(path, 6)
    if (t) {
      any = true
      console.log(`\n   ▸ ${label}:`)
      for (const l of t.split('\n')) console.log(`     ${l}`)
    }
  }
  if (!any) console.log(ok('no failure logs found — nothing has recorded an error.'))
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n🩺 personal-wiki doctor\n')
  await checkEnvironment()
  await checkKnowledgeBase()
  await checkState()
  await checkStamps()
  await checkLinkedIn()
  await checkLogs()

  section('Verdict')
  if (findings.length === 0) {
    console.log(ok('No blocking problems detected by automated checks.'))
    console.log('   If sync still seems dead, confirm the launchd agents are loaded:')
    console.log('     launchctl list | grep personal-wiki')
    console.log('   and re-run `npm run setup` to (re)install them.')
  } else {
    console.log('Likely problems:')
    for (const f of findings) console.log(bad(f))
  }
  console.log('')
}

main().catch(err => {
  console.error('doctor failed:', err.message)
  process.exit(1)
})
