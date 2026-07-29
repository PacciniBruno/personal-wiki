/**
 * sources/twitter/index.js — X (Twitter) bookmarks adapter, via the xapi MCP.
 *
 * The old Puppeteer/GraphQL path couldn't get past X's login in headless
 * Chromium. This instead delegates to `claude -p` with the `xapi` MCP server
 * (official X API) injected per-call via --mcp-config, calling
 * `mcp__xapi__get_users_bookmarks`.
 * The agent writes the bookmarks as JSONL (one JSON object per line) to a temp
 * file in KB_DIR; Node reads it line-by-line — robust to a single malformed
 * line and to large backfills (no giant JSON blob re-emitted as output tokens).
 *
 * Key gotcha: the get_users_bookmarks response only carries author *ids* unless
 * you request `expansions=author_id` in the same call. Without that, the agent
 * makes one user-lookup per bookmark (~100 extra calls) and times out — so the
 * prompt insists on expansions.
 *
 * Modes:
 *   - bootstrap: paginate newest-first back to TWITTER_MAX_AGE_DAYS (full
 *     backfill). Run once via `node src/index.js --mode=bootstrap --source=twitter`.
 *   - sync: fetch only the newest page; knownKeys filtering keeps just new ones.
 *
 * Env knobs:
 *   TWITTER_FETCH_MODEL     model for the fetch agent (default: sonnet)
 *   TWITTER_FETCH_MAX_USD   per-call budget cap (default: 1.50 sync / 6.00 bootstrap)
 *   TWITTER_MAX_AGE_DAYS    age cutoff for bootstrap backfill (default: 365)
 */

import { readFile, unlink } from 'fs/promises'
import { join } from 'path'
import { KB_DIR, TWITTER_MAX_AGE_DAYS, XURL_BIN } from '../../config.js'
import { claudePrint } from '../../claude-print.js'

const TMP_BASENAME = 'tmp-twitter-bookmarks.jsonl'  // NOT a dotfile: Write prompts on hidden files
const BOOTSTRAP_MAX_PAGES = 8   // 8 * 100 ≈ 800 bookmarks upper bound

// The X API MCP server, injected per-call via --mcp-config rather than being a
// globally-registered (user-scoped) server in ~/.claude.json. Keeping it out of
// the global config stops `xurl mcp` from auto-launching — and popping an
// interactive OAuth browser tab when a rotating refresh token can't be reused —
// in every unrelated Claude Code session. Only this pipeline loads it. Auth/app
// config still lives in ~/.xurl (app "xapi").
// Launched via the resolved absolute path to the installed xurl binary, not
// `npx -y @xdevplatform/xurl`. npx needs a network fetch when the package isn't
// installed, which silently failed under launchd (minimal PATH, cold npm cache)
// and produced 14 days of "MCP unavailable or returned nothing" while the X
// credentials themselves were fine. Install with: npm i -g @xdevplatform/xurl
const XAPI_MCP_CONFIG = JSON.stringify({
  mcpServers: {
    xapi: {
      type: 'stdio',
      command: XURL_BIN,
      args: ['--app', 'xapi', 'mcp', 'https://api.x.com/mcp'],
    },
  },
})

function buildPrompt({ mode, cutoffISO }) {
  const paginate = mode === 'bootstrap'
    ? `Call mcp__xapi__get_users_bookmarks with max_results=100 and follow its pagination (pass the returned pagination token) newest-first, collecting every bookmark with created_at >= ${cutoffISO}. Stop as soon as you reach older bookmarks, or after ${BOOTSTRAP_MAX_PAGES} pages.`
    : `Call mcp__xapi__get_users_bookmarks ONCE with max_results=100 for the newest page of bookmarks (do not paginate).`

  return `${paginate}

IMPORTANT — to stay fast, always pass max_results=100 and, in EACH get_users_bookmarks call, request expansions=author_id with user.fields=username,name,description and tweet.fields=created_at,entities, so a full page of posts plus each author's name/bio and URLs come back in ONE response. Do NOT make any additional per-author or per-tweet lookup calls.

Write the results as JSONL to a file named "${TMP_BASENAME}" in the current working directory using the Write tool: ONE JSON object per line (not a JSON array), each with EXACTLY these fields:
{"id":"<tweet id>","text":"<full post text, empty string if none>","author":"<display name>","handle":"<username>","bio":"<author description, empty if unknown>","created_at":"<ISO 8601>","url":"https://x.com/<username>/status/<id>","hashtags":["<tag>"],"linked_urls":["<expanded external url>"]}

Write one line per collected bookmark — do not summarize or abbreviate. Write an empty file if there are none.
Then reply with ONLY this JSON and nothing else: {"count": <number of lines written>}`
}

function parseJsonl(text) {
  const out = []
  for (const line of String(text ?? '').split('\n')) {
    const t = line.trim()
    if (!t) continue
    try {
      const obj = JSON.parse(t)
      if (obj && typeof obj === 'object') out.push(obj)
    } catch {
      // Skip a single malformed line rather than losing the whole batch.
    }
  }
  return out
}

function toSourceItem(b) {
  const id = String(b.id ?? '').trim()
  if (!id) return null
  const handle = (b.handle ?? '').trim()
  const url = b.url || (handle ? `https://x.com/${handle}/status/${id}` : `https://x.com/i/status/${id}`)
  const createdAt = b.created_at ? new Date(b.created_at).toISOString() : null

  return {
    source:      'twitter',
    sourceType:  'social-post',
    externalId:  id,
    uniqueKey:   `twitter:${id}`,
    url,
    title:       '',
    text:        String(b.text ?? '').trim().slice(0, 3000),
    author:      (b.author ?? '').trim(),
    authorTitle: (b.bio ?? '').trim(),
    savedAt:     new Date().toISOString(), // X doesn't expose bookmark save date
    createdAt,
    publishedAt: null,
    tags:        Array.isArray(b.hashtags) ? b.hashtags.map(String) : [],
    metadata:    {
      screenName: handle,
      linkedUrls: Array.isArray(b.linked_urls) ? b.linked_urls : [],
    },
  }
}

export const source = {
  id:    'twitter',
  label: 'X (Twitter) bookmarks',
  defaultModes: ['sync', 'bootstrap'],
  supportsRemovedDetection: false,

  isEnabled(_config) {
    // Uses the `xapi` MCP injected below; fails gracefully if auth is absent.
    // Set TWITTER_ENABLED=false in .env to skip it entirely — useful while the
    // xapi auth is broken, so it stops appending a failure line every run.
    return process.env.TWITTER_ENABLED !== 'false'
  },

  async fetch({ mode, knownKeys }) {
    const cutoffISO = new Date(Date.now() - TWITTER_MAX_AGE_DAYS * 86_400_000).toISOString()
    const tmpPath = join(KB_DIR, TMP_BASENAME)

    console.log('\n① Fetching X bookmarks via xapi MCP...')
    const maxBudgetUsd = process.env.TWITTER_FETCH_MAX_USD ?? (mode === 'bootstrap' ? '6.00' : '1.50')

    await claudePrint(buildPrompt({ mode, cutoffISO }), mode === 'bootstrap' ? 900_000 : 420_000, {
      allowedTools: ['mcp__xapi', 'Write'],
      mcpConfig:    XAPI_MCP_CONFIG,
      model:        process.env.TWITTER_FETCH_MODEL ?? 'sonnet',
      maxBudgetUsd,
    })

    let raw
    try {
      raw = await readFile(tmpPath, 'utf8')
    } catch {
      throw new Error('xapi fetch produced no bookmarks file (MCP unavailable or returned nothing)')
    }
    await unlink(tmpPath).catch(() => {})

    const parsed = parseJsonl(raw)
    const cutoffMs = Date.parse(cutoffISO)
    const items = parsed
      .map(toSourceItem)
      .filter(Boolean)
      .filter(it => !knownKeys.has(it.externalId))
      .filter(it => !it.createdAt || Date.parse(it.createdAt) >= cutoffMs)

    console.log(`   ✅ ${items.length} new bookmark(s) from ${parsed.length} fetched`)
    return items
  },
}
