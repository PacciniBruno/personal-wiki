/**
 * categorize.js
 *
 * Uses Claude Haiku to categorize each item regardless of source.
 * Returns category, subcategory, tags[], and summary per item.
 */

import Anthropic from '@anthropic-ai/sdk'
import { USER_CONTEXT } from './config.js'

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

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const sleep = ms => new Promise(r => setTimeout(r, ms))

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

  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 700,
    messages: [{ role: 'user', content: prompt }],
  })

  let json
  try {
    json = JSON.parse(message.content[0].text.trim())
  } catch {
    // Haiku occasionally wraps JSON in text — extract it
    const match = message.content[0].text.match(/\{[\s\S]*\}/)
    if (!match) throw new Error('Claude returned invalid JSON')
    json = JSON.parse(match[0])
  }

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
      results.push({
        ...item,
        category: 'Other', subcategory: '', tags: [], summary: '', facts: [],
      })
    }

    onProgress?.(i + 1, items.length)
    if (i < items.length - 1) await sleep(150)
  }

  return results
}
