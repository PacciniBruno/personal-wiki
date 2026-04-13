/**
 * categorize.js
 *
 * Utilise Claude Haiku pour catégoriser chaque post LinkedIn.
 * Retourne une catégorie principale, une sous-catégorie, des tags et un résumé.
 */

import Anthropic from '@anthropic-ai/sdk'

const CATEGORIES = [
  'Investing & Finance',        // VC, angel, fundraising, finance perso
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
 * Catégorise un post unique via Claude Haiku.
 */
export async function categorizePost(post) {
  const authorLine = [post.author, post.authorTitle].filter(Boolean).join(' — ')
  // Remove lone surrogates (invalid UTF-16) that break JSON serialization
  const textSnippet = post.text.slice(0, 1500).replace(/[\uD800-\uDFFF]/g, '')

  const prompt = `You are categorizing a LinkedIn post saved by a founder and product leader (French, ex-CPO of a fintech).

Post author: ${authorLine || 'Unknown'}
Post text:
"""
${textSnippet}
"""

Assign a category, subcategory, tags and summary using this exact JSON schema.
Categories (pick exactly one):
${CATEGORIES.map((c, i) => `${i + 1}. ${c}`).join('\n')}

Respond with ONLY valid JSON, no markdown, no explanation:
{
  "category": "<one category from the list>",
  "subcategory": "<specific sub-theme, 2-4 words, in English>",
  "tags": ["<tag1>", "<tag2>", "<tag3>"],
  "summary": "<key insight or takeaway in 1-2 sentences>"
}`

  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 300,
    messages: [{ role: 'user', content: prompt }],
  })

  let json
  try {
    json = JSON.parse(message.content[0].text.trim())
  } catch {
    // Haiku a parfois du texte autour du JSON — on l'extrait
    const match = message.content[0].text.match(/\{[\s\S]*\}/)
    if (!match) throw new Error('Claude returned invalid JSON')
    json = JSON.parse(match[0])
  }

  // Validation et fallbacks
  if (!CATEGORIES.includes(json.category)) json.category = 'Other'
  if (!Array.isArray(json.tags)) json.tags = []
  json.tags = json.tags.slice(0, 3).map(t => String(t).trim()).filter(Boolean)
  json.subcategory = (json.subcategory ?? '').trim()
  json.summary = (json.summary ?? '').trim()

  return json
}

/**
 * Catégorise un tableau de posts avec gestion du rate limiting et affichage de progression.
 */
export async function categorizeBatch(posts, { onProgress } = {}) {
  const results = []

  for (let i = 0; i < posts.length; i++) {
    const post = posts[i]

    try {
      const cat = await categorizePost(post)
      results.push({ ...post, ...cat })
    } catch (err) {
      console.error(`\n⚠️  Erreur catégorisation post ${i + 1}: ${err.message}`)
      results.push({
        ...post,
        category: 'Other',
        subcategory: '',
        tags: [],
        summary: '',
      })
    }

    onProgress?.(i + 1, posts.length)

    // Délai entre les requêtes pour rester dans les rate limits Anthropic
    if (i < posts.length - 1) await sleep(150)
  }

  return results
}
