#!/usr/bin/env node
/**
 * dedupe-raw.mjs — one-off backfill that removes duplicate entries from raw/ and facts/.
 *
 * Why this exists: ingest dedup keys on per-source externalId (see
 * pipeline/dedupe.js), so the same article arriving via LinkedIn AND a web clip
 * gets two different keys and passes both checks. Re-bootstraps compound it.
 * Result: ~40% of raw/ entries were redundant, which silently inflates how
 * heavily synthesis weights a source — a 3x-duplicated article reads as three
 * independent signals.
 *
 * Entry boundaries: a real entry is a `## ` heading whose next non-empty line is
 * `**Link:**`. Scraped articles embed their own `##` subheadings in the body, so
 * splitting on `^## ` alone shreds entries. Do not "simplify" this.
 *
 * Scope: dedupes WITHIN each file (unambiguously redundant). URLs appearing in
 * more than one topic file are reported, never auto-removed — that's a
 * categorization call, not a duplication one.
 *
 * Usage:
 *   node scripts/dedupe-raw.mjs            # dry run, prints a report
 *   node scripts/dedupe-raw.mjs --apply    # writes .bak files, then rewrites
 */

import { readdir, readFile, writeFile, copyFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { KB_DIR, STATE_DIR } from '../src/config.js'

const APPLY   = process.argv.includes('--apply')
const RAW_DIR = join(KB_DIR, 'raw')
const FACTS_DIR = join(KB_DIR, 'facts')

const LINK_RE = /^\*\*Link:\*\*\s*(\S+)/

/**
 * Splits a raw topic file into { preamble, entries[] }.
 * An entry starts at a `## ` line whose next non-empty line is `**Link:**`.
 */
function parseEntries(text) {
  const lines = text.split('\n')
  const starts = []

  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith('## ')) continue
    // look ahead past blank lines for the Link marker
    let j = i + 1
    while (j < lines.length && lines[j].trim() === '') j++
    if (j < lines.length && LINK_RE.test(lines[j])) starts.push(i)
  }

  if (starts.length === 0) return { preamble: text, entries: [] }

  // Keep each preamble line's own newline so `preamble + entries.join('\n')`
  // round-trips exactly, including when the preamble is empty.
  const preamble = lines.slice(0, starts[0]).map(l => `${l}\n`).join('')
  const entries = starts.map((start, k) => {
    const end = k + 1 < starts.length ? starts[k + 1] : lines.length
    const block = lines.slice(start, end)
    const linkLine = block.find(l => LINK_RE.test(l))
    return {
      heading: block[0],
      url: linkLine ? linkLine.match(LINK_RE)[1] : null,
      text: block.join('\n'),
    }
  })

  return { preamble, entries }
}

async function dedupeRaw() {
  const files = (await readdir(RAW_DIR)).filter(f => f.endsWith('.md')).sort()
  const urlToFiles = new Map()   // url -> Set(file)  for the cross-file report
  let totalBefore = 0, totalAfter = 0
  const perFile = []

  for (const file of files) {
    const path = join(RAW_DIR, file)
    const text = await readFile(path, 'utf8')
    const { preamble, entries } = parseEntries(text)

    const seen = new Set()
    const kept = []
    const dropped = []

    for (const entry of entries) {
      if (entry.url && seen.has(entry.url)) {
        dropped.push(entry)
        continue
      }
      if (entry.url) {
        seen.add(entry.url)
        if (!urlToFiles.has(entry.url)) urlToFiles.set(entry.url, new Set())
        urlToFiles.get(entry.url).add(file)
      }
      kept.push(entry)
    }

    totalBefore += entries.length
    totalAfter  += kept.length
    perFile.push({ file, before: entries.length, after: kept.length, dropped })

    if (APPLY && dropped.length > 0) {
      await copyFile(path, `${path}.predupe.bak`)
      const rebuilt = preamble + kept.map(e => e.text).join('\n')
      await writeFile(path, rebuilt, 'utf8')
    }
  }

  return { perFile, totalBefore, totalAfter, urlToFiles }
}

async function dedupeFacts() {
  const files = (await readdir(FACTS_DIR)).filter(f => f.endsWith('.md')).sort()
  const results = []

  for (const file of files) {
    const path = join(FACTS_DIR, file)
    const text = await readFile(path, 'utf8')
    const lines = text.split('\n')

    const seen = new Set()
    const kept = []
    let dropped = 0

    for (const line of lines) {
      const isFact = line.startsWith('- ')
      if (isFact) {
        const key = line.trim()
        if (seen.has(key)) { dropped++; continue }
        seen.add(key)
      }
      kept.push(line)
    }

    results.push({ file, dropped })

    if (APPLY && dropped > 0) {
      await copyFile(path, `${path}.predupe.bak`)
      await writeFile(path, kept.join('\n'), 'utf8')
    }
  }

  return results
}

const raw = await dedupeRaw()
const facts = await dedupeFacts()

console.log(APPLY ? '\n=== DEDUPE: APPLYING ===\n' : '\n=== DEDUPE: DRY RUN (pass --apply to write) ===\n')

console.log('raw/')
for (const r of raw.perFile) {
  const removed = r.before - r.after
  const flag = removed > 0 ? ` -${removed}` : ''
  console.log(`  ${r.file.padEnd(32)} ${String(r.before).padStart(4)} → ${String(r.after).padStart(4)}${flag}`)
}
console.log(`  ${'TOTAL'.padEnd(32)} ${String(raw.totalBefore).padStart(4)} → ${String(raw.totalAfter).padStart(4)}  (-${raw.totalBefore - raw.totalAfter})`)

const factsDropped = facts.reduce((n, f) => n + f.dropped, 0)
console.log(`\nfacts/  duplicate lines removed: ${factsDropped}`)

const crossFile = [...raw.urlToFiles.entries()].filter(([, set]) => set.size > 1)
console.log(`\nCross-file duplicates (NOT removed — categorization call, review manually): ${crossFile.length}`)
for (const [url, set] of crossFile.slice(0, 15)) {
  console.log(`  ${url}\n    → ${[...set].join(', ')}`)
}
if (crossFile.length > 15) console.log(`  ... and ${crossFile.length - 15} more`)

// Seed the forward guard in writer.js with every URL currently in raw/, so the
// cross-source dedup check starts populated rather than empty.
if (APPLY) {
  const seedFile = join(STATE_DIR, 'seen-urls.json')
  await mkdir(STATE_DIR, { recursive: true })
  await writeFile(seedFile, JSON.stringify([...raw.urlToFiles.keys()], null, 0), 'utf8')
  console.log(`\nSeeded ${raw.urlToFiles.size} URLs into ${seedFile}`)
}

if (!APPLY) console.log('\nNothing written. Re-run with --apply to rewrite (originals saved as *.predupe.bak).')
