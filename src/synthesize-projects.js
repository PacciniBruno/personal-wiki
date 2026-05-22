/**
 * synthesize-projects.js
 *
 * Per-project living-doc synthesis. Mirrors src/synthesize.js (tier 1) but
 * scoped to a single project folder.
 *
 * For each project that has new input since its last sync:
 *   1. Pre-extract any *.pdf to *.pdf.txt so the agent can Read them.
 *   2. Spawn `claude -p` with a prompt that reads:
 *        - projects/{name}/README.md  (manifest)
 *        - projects/{name}/*.md       (notes, excluding wiki.md)
 *        - projects/{name}/*.pdf.txt  (extracts)
 *        - ~/knowledge/raw/{theme}.md for each linked theme
 *      and rewrites projects/{name}/wiki.md.
 *   3. Update state.projects[name].lastSyncedAt on success.
 *
 * Usage:
 *   node src/synthesize-projects.js
 *   node src/synthesize-projects.js --projects=dona,lava
 *   node src/synthesize-projects.js --since=2026-04-01
 */

import { join } from 'path'
import { KB_DIR } from './config.js'
import { listProjects, projectNeedsResync, extractProjectPdfs } from './projects.js'
import { loadState, saveState } from './state.js'
import { claudePrint } from './claude-print.js'

const RAW_DIR  = join(KB_DIR, 'raw')

const MAX_CONCURRENCY = 3

async function runWithLimit(items, limit, worker) {
  const results = new Array(items.length)
  let next = 0
  async function pump() {
    while (true) {
      const i = next++
      if (i >= items.length) return
      try { results[i] = { status: 'fulfilled', value: await worker(items[i], i) } }
      catch (err) { results[i] = { status: 'rejected', reason: err } }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, pump))
  return results
}

function buildProjectPrompt(project, since) {
  const today = new Date().toISOString().slice(0, 10)
  const themes = project.manifest.themes
  const themesList = themes.length ? themes.join(', ') : '(none declared — scan all wiki/*.md and decide)'
  const themeFiles = themes.length
    ? themes.map(t => `${RAW_DIR}/${t}.md`).join('\n  - ')
    : `${join(KB_DIR, 'wiki')}/*.md`

  return `You are updating a living wiki page for a project named "${project.name}".

FILES:
- Project manifest:  ${project.readmePath}  (YAML frontmatter: themes, status, since)
- Existing wiki:     ${project.wikiPath}    (may not exist yet)
- Project notes:     ${project.dir}/*.md       (excluding README.md and wiki.md)
- PDF extracts:      ${project.dir}/*.pdf.txt
- Theme raw posts:
  - ${themeFiles}

TASK:
1. Read ${project.readmePath}. Parse the YAML frontmatter to learn the project's themes (${themesList}), status, and start date.
2. Glob and read every *.md in ${project.dir} except README.md and wiki.md. Read every *.pdf.txt.
3. For each theme listed in the manifest, run: tail -n 600 ~/knowledge/raw/{theme}.md
   Pick out only entries dated since ${since} that are clearly relevant to this project's thesis.
   Skip entries marked [REMOVED]. If themes is empty, scan all wiki/*.md instead and decide which themes are relevant on your own.
4. Read the current wiki.md if it exists at ${project.wikiPath}.
5. Rewrite ${project.wikiPath} with this structure:

# ${project.name} — Living Wiki

> Last updated: ${today}
> Linked themes: ${themesList}

## Current Thesis
[2-4 sentences. Evolve from prior wiki.md — don't restart from scratch.]

## Open Questions
[Bullets. Carry forward unresolved questions; mark answered ones as resolved (don't delete).]

## Recent Signal (since ${since})
[Bullets pulled from raw/{theme}.md AND from project notes modified recently. Each bullet:
 - Source author/title — date
 - One-line takeaway and why it matters to this project
 - URL citation]

## Related Themes
[For each linked theme: 1-2 sentences on what's currently relevant in that theme to this project.]

## Decisions Log
[Append-only. Preserve every prior entry verbatim. Add new ones at the bottom dated today only if a clear decision shows up in the project notes since the last sync.]

STYLE:
- Dense reference, not prose.
- Cite URLs from raw/ entries' **Link:** field.
- Only synthesize what's actually in the files — do not invent.
- Keep under 200 lines.`
}

export async function runProjectSynthesis({ only, since } = {}) {
  const projects = await listProjects()
  if (projects.length === 0) {
    console.log('   No projects to sync.')
    return { failed: [] }
  }

  const state = await loadState()
  state.projects ??= {}

  const targets = []
  for (const p of projects) {
    if (only && !only.includes(p.name)) continue
    if (only) {
      targets.push(p) // forced
    } else if (await projectNeedsResync(p, state)) {
      targets.push(p)
    }
  }

  if (targets.length === 0) {
    console.log('   No projects need resync.')
    return { failed: [] }
  }

  console.log(`\n📁 Updating ${targets.length} project wiki(s) (concurrency=${MAX_CONCURRENCY})...`)

  const sinceDate = since ?? new Date(Date.now() - 14 * 86400_000).toISOString().slice(0, 10)

  // Pre-extract PDFs sequentially per project (tiny work; keep ordering predictable)
  for (const p of targets) {
    try { await extractProjectPdfs(p) }
    catch (err) { console.log(`   ⚠️  ${p.name}: PDF extract failed — ${err.message}`) }
  }

  const results = await runWithLimit(targets, MAX_CONCURRENCY, async p => {
    const prompt = buildProjectPrompt(p, sinceDate)
    try {
      await claudePrint(prompt, 300_000)
      state.projects[p.name] = { lastSyncedAt: new Date().toISOString() }
      process.stdout.write(`   ✅ ${p.name}\n`)
    } catch (err) {
      process.stdout.write(`   ⚠️  ${p.name}: ${err.message}\n`)
      throw err
    }
  })

  await saveState(state)

  const failed = targets.filter((_, i) => results[i].status === 'rejected').map(p => p.name)
  if (failed.length > 0) {
    console.log(`   ⚠️  ${failed.length}/${targets.length} project wiki(s) failed — see ~/.personal-wiki/synth-failures.log`)
  }
  return { failed }
}

if (process.argv[1]?.endsWith('synthesize-projects.js')) {
  const args        = process.argv.slice(2)
  const projectsArg = args.find(a => a.startsWith('--projects='))?.split('=')[1]
  const sinceArg    = args.find(a => a.startsWith('--since='))?.split('=')[1]

  const only  = projectsArg ? projectsArg.split(',').map(s => s.trim()).filter(Boolean) : null
  const since = sinceArg

  runProjectSynthesis({ only, since })
    .then(({ failed }) => { if (failed.length > 0) process.exit(1) })
    .catch(err => { console.error(err.message); process.exit(1) })
}
