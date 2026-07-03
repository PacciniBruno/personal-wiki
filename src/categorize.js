/**
 * categorize.js
 *
 * Uses Claude Haiku to categorize each item regardless of source.
 * Returns category, subcategory, tags[], summary and facts[] per item.
 *
 * Runs via `claude -p --model haiku` (Claude subscription), the same auth path
 * as synthesis — so ingest never depends on the ANTHROPIC_API_KEY credit
 * balance.
 */

import { USER_CONTEXT } from './config.js'
import { claudePrint } from './claude-print.js'

const CATEGORIES = [
  'Investing & Finance',        // VC, angel, fundraising, personal finance
  'Startup & Entrepreneurship', // Founder stories, building, lessons learned
  'Product & UX',               // PM, design, user research, prototyping
  'Marketing & Growth',         // GTM, branding, SEO, content, growth hacking
  'Leadership & Management',    // People, culture, hiring, org design, feedback
  'AI & Technology',            // AI/ML, engineering, dev tools, tech trends
  'Career & Work',              // Career advice, networking, job search, remote work
  'Sales & Business Dev',       // Sales techniques, partnerships, B2B
  'Mindset & Personal Dev',     // Productivity, habits, mental models, resilience
  'Other',
]

const sleep = ms => new Promise(r => setTimeout(r, ms))

// The neutral fallback shape, reused by the empty-item short-circuit and by
// categorizeBatch's catch. Kept as a factory so callers never share an array.
const emptyResult = () => ({ category: 'Other', subcategory: '', tags: [], summary: '', facts: [] })

/**
 * Pulls a JSON object out of a model reply that may be fenced or prefaced.
 * Tolerant, mirroring the line-by-line JSONL parsing in sources/twitter/index.js:
 * strip a ```json fence, try a straight parse, then fall back to the outermost
 * {...} span. Throws only when nothing JSON-shaped is present.
 */
function extractJson(text) {
  const unfenced = String(text ?? '')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim()

  try {
    return JSON.parse(unfenced)
  } catch {
    const start = unfenced.indexOf('{')
    const end   = unfenced.lastIndexOf('}')
    if (start === -1 || end <= start) throw new Error('Claude returned invalid JSON')
    return JSON.parse(unfenced.slice(start, end + 1))
  }
}

/** Coerces a parsed object into the canonical result shape. */
function normalize(json) {
  if (!CATEGORIES.includes(json.category)) json.category = 'Other'
  if (!Array.isArray(json.tags))  json.tags  = []
  if (!Array.isArray(json.facts)) json.facts = []
  json.tags  = json.tags.slice(0, 3).map(t => String(t).trim()).filter(Boolean)
  json.facts = json.facts.slice(0, 5).map(f => String(f).trim()).filter(Boolean)
  json.subcategory = (json.subcategory ?? '').trim()
  json.summary     = (json.summary     ?? '').trim()
  return json
}

/**
 * Categorizes a single item via Claude Haiku.
 *
 * @param {import('./sources/types.js').SourceItem} item
 */
export async function categorizeItem(item) {
  const authorLine  = [item.author, item.authorTitle].filter(Boolean).join(' — ')
  const titleLine   = item.title ? `Title: ${item.title}\n` : ''
  // Remove lone surrogates (invalid UTF-16) that break JSON serialization
  const textSnippet = (item.text ?? '').slice(0, 1500).replace(/[\uD800-\uDFFF]/g, '')

  // Link-only / empty items (common with X bookmarks whose text is just a t.co
  // URL) give Haiku nothing to categorize — and often draw a malformed reply.
  // Short-circuit to the neutral result instead of burning a call that lands
  // in "Other" anyway.
  const meaningful = textSnippet.replace(/https?:\/\/\S+/g, '').trim()
  if (!meaningful && !item.title) return emptyResult()

  const prompt = `You are categorizing a saved item for ${USER_CONTEXT}.

Source: ${item.source} (${item.sourceType})
Author: ${authorLine || 'Unknown'}
${titleLine}Content:
"""
${textSnippet}
"""

Assign a category, subcategory, tags, summary and facts using this exact JSON schema.
Categories (pick exactly one):
${CATEGORIES.map((c, i) => `${i + 1}. ${c}`).join('\n')}

For "facts": extract 0-5 concrete, verifiable, self-contained factual claims
stated in the content — statistics, events, definitions, named methods or tools,
causal claims. Each fact must be a complete sentence understandable on its own
without the original post (resolve pronouns, name the subject explicitly). Return
an empty array if the content is pure opinion, advice, or too vague for checkable facts.

Respond with ONLY valid JSON, no markdown, no explanation:
{
  "category": "<one category from the list>",
  "subcategory": "<specific sub-theme, 2-4 words, in English>",
  "tags": ["<tag1>", "<tag2>", "<tag3>"],
  "summary": "<key insight or takeaway in 1-2 sentences>",
  "facts": ["<atomic, self-contained fact>", "..."]
}`

  // tools 'none' + inlined input: pure text-in/JSON-out, no file access needed.
  // One retry: a first attempt can fail transiently (claudePrint rejects on an
  // Overloaded/API error) or return truncated/malformed JSON (extractJson
  // throws). Both are worth re-asking once before falling back to "Other".
  const ask = () => claudePrint(prompt, 60_000, { tools: 'none', model: 'haiku', maxBudgetUsd: '0.10' })

  try {
    return normalize(extractJson(await ask()))
  } catch {
    await sleep(500)
    return normalize(extractJson(await ask()))
  }
}

/**
 * Categorizes an array of items with rate-limit pacing and progress reporting.
 *
 * @param {import('./sources/types.js').SourceItem[]} items
 * @param {{ onProgress?: (n: number, total: number) => void }} options
 * @returns {Promise<Array<import('./sources/types.js').SourceItem & { category: string, subcategory: string, tags: string[], summary: string, facts: string[] }>>}
 */
export async function categorizeBatch(items, { onProgress } = {}) {
  const results = []

  for (let i = 0; i < items.length; i++) {
    const item = items[i]

    try {
      const cat = await categorizeItem(item)
      results.push({ ...item, ...cat })
    } catch (err) {
      console.error(`\n⚠️  Categorization failed for item ${i + 1}: ${err.message}`)
      results.push({ ...item, ...emptyResult() })
    }

    onProgress?.(i + 1, items.length)
    if (i < items.length - 1) await sleep(150)
  }

  return results
}
