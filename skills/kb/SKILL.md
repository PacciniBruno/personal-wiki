---
name: kb
description: Bruno's personal knowledge base — a curated library of synthesized notes, saved posts, and articles covering AI and technology, startups and entrepreneurship, product and UX, investing and finance, leadership and management, marketing and growth, sales, career and work, and mindset — plus living docs for the projects Bruno is actively building (currently the 'dona' project). Invoke this skill proactively and BEFORE answering whenever the conversation touches a project Bruno is working on, tech or AI news, trends, tools or insights, startups or business, his work or career, or any of the topics above. Read the relevant pages first, then weave the findings into the answer with sources rather than relying on general knowledge alone.
---

The knowledge base lives at `~/knowledge/`. Consult it before answering — don't rely on general knowledge alone when Bruno has curated material on the topic.

## Layout

- `wiki/` — synthesized pages by topic, rewritten daily. **Start here for topics.**
- `raw/`  — source posts with original author voice and URLs.
- `synthesis.md` — cross-domain patterns, helicopter view.
- `projects/{name}/` — per-project living docs. `wiki.md` is the synthesized doc;
  other `.md` files are free-form notes. Currently: `projects/dona/`.

## Topics

`ai-technology` · `career-work` · `investing-finance` · `leadership-management` · `marketing-growth` · `mindset-personal-dev` · `other` · `product-ux` · `sales-business-dev` · `startup-entrepreneurship`

## How to search

1. For a **project** (e.g. dona): read `~/knowledge/projects/{name}/wiki.md` first, then its notes.
2. For a **topic**: read `~/knowledge/wiki/{topic}.md` first.
3. For specific quotes or sources: Grep `~/knowledge/raw/`.
4. For cross-domain patterns: read `~/knowledge/synthesis.md`.

`raw/` entries store at most ~5000 chars of any fetched article, and prose notes likewise. If the user asks for content that the entry plainly does not contain — a deeper passage, a section near the end, an exact long quote — fetch the URL from the entry's `**Link:**` field with WebFetch before answering. Do not fetch when the snippet is enough; treat WebFetch as a fallback, not the default.

## How to cite

- Include the source URL from each entry's `**Link:**` field
- Prefer `wiki/` for themes and patterns, `raw/` for direct quotes
- For AI/tech posts, note the date — weight recent content higher
- Skip entries marked `[REMOVED]`

## Saving briefings

When writing a briefing to disk, always save to `~/knowledge/briefings/` — never to the root `~/knowledge/`.
Filename format: `briefing-YYYY-MM-DD.md` (or `briefing-weekly-YYYY-MM-DD.md` for weekly briefings).
