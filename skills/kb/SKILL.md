---
name: kb
description: Search personal knowledge base — LinkedIn, Twitter, Apple Notes, and web clips synthesized by Claude. Use proactively when the conversation touches startups, AI, product, investing, leadership, marketing, career, mindset, or sales. Invoke before answering, then weave findings in naturally.
---

The knowledge base lives at `~/knowledge/`:

- `wiki/` — synthesized pages by topic, rewritten daily. Start here.
- `raw/`  — source posts with original author voice and URLs.
- `synthesis.md` — cross-domain patterns, rewritten weekly.

## Topics

`ai-technology` · `career-work` · `investing-finance` · `leadership-management` · `marketing-growth` · `mindset-personal-dev` · `other` · `product-ux` · `sales-business-dev` · `startup-entrepreneurship`

## How to search

Read the relevant `wiki/{topic}.md` first. For specific quotes or sources, Grep `~/knowledge/raw/`.

`raw/` entries store at most ~5000 chars of any fetched article, and prose notes likewise. If the user asks for content that the entry plainly does not contain — a deeper passage, a section near the end, an exact long quote — fetch the URL from the entry's `**Link:**` field with WebFetch before answering. Do not fetch when the snippet is enough; treat WebFetch as a fallback, not the default.

## How to cite

- Include the source URL from each entry's `**Link:**` field
- Prefer `wiki/` for themes and patterns, `raw/` for direct quotes
- For AI/tech posts, note the date — weight recent content higher
- Skip entries marked `[REMOVED]`

## Saving briefings

When writing a briefing to disk, always save to `~/knowledge/briefings/` — never to the root `~/knowledge/`.
Filename format: `briefing-YYYY-MM-DD.md` (or `briefing-weekly-YYYY-MM-DD.md` for weekly briefings).
