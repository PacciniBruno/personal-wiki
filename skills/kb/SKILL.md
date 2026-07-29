---
name: kb
description: Searches Bruno's personal knowledge base at ~/knowledge — a curated library of synthesized wiki pages, saved LinkedIn and X posts, clipped articles, extracted facts, and living docs for the projects he is building (currently 'dona'). Covers AI and technology, startups and entrepreneurship, product and UX, investing and finance, leadership and management, marketing and growth, sales, career and work, and mindset. Use proactively and BEFORE answering whenever the conversation touches the dona project or any project Bruno is building, AI or tech news, trends, tools, models or research, startups, fundraising or business strategy, product, design or UX decisions, his work, career or positioning, or any topic above. Also use for "what do I know about X", "what have I saved on X", "what's my take on X", "have I read anything about X", "what did that post say", or any request to check, search, cite or summarize his own notes, saved posts, bookmarks or research. Read the relevant pages first, then answer from them with sources rather than from general knowledge alone.
---

Bruno's personal knowledge base lives at `~/knowledge/` — a curated library of
synthesized notes, saved posts, articles, and per-project living docs. Consult it
before answering; don't rely on general knowledge alone when Bruno has curated
material on the topic.

## Layout

- `wiki/` — synthesized pages by topic, rewritten daily. **Start here for topics.**
- `raw/`  — source posts, original voice + URLs.
- `facts/` — atomic, verifiable facts extracted from posts, one file per topic.
- `synthesis.md` — cross-domain patterns, helicopter view.
- `projects/{name}/` — per-project living docs. Currently: `projects/dona/`.
- `briefings/` — dated briefings. Write-target, not a search surface.
- `chrome-clipped/` — web-clip staging. Ingested automatically into `raw/`; don't read directly.
- `inspiration/` — a shelf Bruno keeps by hand. Not ingested, not synthesized.

Topics: `ai-technology` · `career-work` · `investing-finance` · `leadership-management` · `marketing-growth` · `mindset-personal-dev` · `other` · `product-ux` · `sales-business-dev` · `startup-entrepreneurship`

## How to search

**For a topic:** read `~/knowledge/wiki/{topic}.md` first; drop to
`~/knowledge/raw/{topic}.md` when you need quotes, full original voice, or URLs.

**For a project (e.g. dona):** read in this order, and don't stop at step 2.

1. `~/knowledge/projects/{name}/AGENTS.md` — conventions and the source-of-truth hierarchy.
2. `~/knowledge/projects/{name}/wiki.md` — auto-synthesized digest. **Read `## Live Tensions` before treating anything as settled.**
3. `~/knowledge/projects/{name}/canon/` — current canonical docs.
4. `~/knowledge/projects/{name}/exploration/` — live challenges to canon.
5. `~/knowledge/projects/{name}/research/` — primary evidence (interviews, transcripts).

Project folders are **nested**. Recurse. Skip `node_modules`, `dist*`, `qa`,
`_to_delete`, `.claude`, `.vscode` — build output and tooling debris, not knowledge.

**Other entry points:** `grep -ri "keyword" ~/knowledge/raw/` for specific quotes or
sources; `~/knowledge/synthesis.md` for cross-domain patterns;
`~/knowledge/facts/{topic}.md` for a specific verifiable claim (or
`facts/agent-derived.md` for facts agents have added while consulting the KB).

`raw/` entries store at most ~5000 chars of any fetched article, and prose notes
likewise. If the user asks for content the entry plainly does not contain — a deeper
passage, a section near the end, an exact long quote — fetch the URL from the entry's
`**Link:**` field with WebFetch before answering. Do not fetch when the snippet is
enough; treat WebFetch as a fallback, not the default.

## Project canon is provisional

Bruno's projects are pre-PMF. The idea keeps iterating, and small pivots put it on
the right rails. The knowledge base is built for that, so **canon records the
current best answer, not a settled one.**

Canon docs carry epistemic frontmatter — read it before citing:

```yaml
status: canonical | provisional | superseded | exploring
confidence: high | medium | low
challenged_by: [exploration/...]
```

Rules:

- A canon doc with `challenged_by` must **never** be cited without its challenge.
- A canon doc marked `superseded`, or carrying a `staleness_note`, should be flagged as such.
- `exploration/` is not drafts and not noise. It's the leading edge of the thinking,
  co-equal with canon for analysis and brainstorming.
- The useful shape is: *"canon says X (date), but the <date> exploration challenges
  it on Y, and the interviews in research/ suggest Z."*

**An answer that states project canon as settled, without surfacing what currently
challenges it, is wrong.** Don't resolve a tension on Bruno's behalf — surface both
sides with dates and let him decide.

## Capturing facts

When you surface or synthesize a durable, verifiable fact that isn't already in the
knowledge base, append it as one self-contained line to
`~/knowledge/facts/agent-derived.md`, with source attribution:

`- Anthropic's MCP spec reached v1.0 in 2026. — derived 2026-05-22 — https://...`

Only capture facts worth keeping — concrete and checkable, not opinions or ephemera.

## How to cite

- Include the source URL from each entry's `**Link:**` field
- Prefer `wiki/` for themes and patterns, `raw/` for direct quotes, `facts/` for specific claims
- For project material, cite by file path and date — canon and exploration docs are dated
- For AI/tech content, note the date — weight recent material higher
- Skip entries marked `[REMOVED]`

## Saving briefings

When writing a briefing to disk, always save to `~/knowledge/briefings/` — never the
root `~/knowledge/`. Filename: `briefing-YYYY-MM-DD.md` (or
`briefing-weekly-YYYY-MM-DD.md` for weekly briefings).
