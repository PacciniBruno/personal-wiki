/**
 * sources/apple-notes/index.js — Apple Notes saved-links adapter.
 *
 * Reads notes from a designated Apple Notes folder (APPLE_NOTES_FOLDER),
 * extracts URLs from each note body, fetches the article content at each URL,
 * and returns normalized SourceItems.
 *
 * After processing, notes are moved to an "[APPLE_NOTES_FOLDER] Processed"
 * sub-folder so the inbox stays clean.
 *
 * Workflow:
 *   iPhone: Any app → Share → Notes → save to APPLE_NOTES_FOLDER
 *   Pipeline: osascript reads folder → extract URLs → fetch article → ingest
 *
 * Config (in .env):
 *   APPLE_NOTES_FOLDER — folder name to scan. Source disabled if not set.
 */

import { execSync } from 'child_process'
import { APPLE_NOTES_FOLDER } from '../../config.js'
import { fetchArticle } from '../../pipeline/fetch-article.js'

// ─── AppleScript helpers ──────────────────────────────────────────────────────

function runScript(script) {
  return execSync(`osascript -e '${script.replace(/'/g, "'\\''")}'`, {
    encoding: 'utf8',
    timeout: 30_000,
  }).trim()
}

/**
 * Returns all notes from the target folder as an array of { id, title, body, created }.
 * body is raw HTML from Notes.
 */
function readNotesFromFolder(folder) {
  const script = `
    tell application "Notes"
      set output to ""
      set targetFolder to missing value
      repeat with acct in accounts
        repeat with f in folders of acct
          if name of f is "${folder.replace(/"/g, '\\"')}" then
            set targetFolder to f
            exit repeat
          end if
        end repeat
        if targetFolder is not missing value then exit repeat
      end repeat
      if targetFolder is missing value then return "ERROR:FOLDER_NOT_FOUND"
      repeat with aNote in (every note of targetFolder)
        set nId to id of aNote
        set nTitle to name of aNote
        set nBody to body of aNote
        set d to creation date of aNote
        set yr to year of d as string
        set mo to text -2 thru -1 of ("0" & ((month of d as integer) as string))
        set dy to text -2 thru -1 of ("0" & (day of d as string))
        set hr to text -2 thru -1 of ("0" & (hours of d as string))
        set mn to text -2 thru -1 of ("0" & (minutes of d as string))
        set sc to text -2 thru -1 of ("0" & (seconds of d as string))
        set nCreated to yr & "-" & mo & "-" & dy & "T" & hr & ":" & mn & ":" & sc
        set output to output & "|||NOTE_START|||" & nId & "|||" & nTitle & "|||" & nCreated & "|||" & nBody & "|||NOTE_END|||"
      end repeat
      return output
    end tell`

  try {
    return runScript(script)
  } catch (err) {
    console.error(`   osascript error: ${err.message}`)
    return ''
  }
}

/**
 * Moves a note by ID to the processed folder (creates it if needed).
 */
function moveNoteToProcessed(noteId, folder) {
  const processedFolder = `${folder} Processed`
  // Find the source folder's account, create/find the processed folder there,
  // then move the note directly by ID (avoids index-based folder/note iteration issues).
  const script = `
    tell application "Notes"
      -- Find the account that owns the source folder
      set srcAcct to missing value
      repeat with acct in accounts
        repeat with f in folders of acct
          if name of f is "${folder.replace(/"/g, '\\"')}" then
            set srcAcct to acct
            exit repeat
          end if
        end repeat
        if srcAcct is not missing value then exit repeat
      end repeat
      if srcAcct is missing value then return

      -- Find or create the processed folder by direct name access
      set destFolder to missing value
      try
        set destFolder to folder "${processedFolder.replace(/"/g, '\\"')}" of srcAcct
      end try
      if destFolder is missing value then
        set destFolder to (make new folder at srcAcct with properties {name:"${processedFolder.replace(/"/g, '\\"')}"})
      end if

      -- Move the note directly by its ID (no iteration needed)
      try
        set theNote to note id "${noteId.replace(/"/g, '\\"')}"
        move theNote to destFolder
      end try
    end tell`

  try {
    runScript(script)
  } catch {
    // Non-fatal — note stays in the inbox but will be skipped next time via knownKeys
  }
}

// ─── URL extraction ───────────────────────────────────────────────────────────

const URL_REGEX = /https?:\/\/[^\s"'<>()[\]{}]+/g

function extractUrls(html) {
  const matches = html.match(URL_REGEX) ?? []
  return [...new Set(
    matches
      .map(u => u.replace(/[.,;:!?)]$/, '')) // strip trailing punctuation
      .filter(u => !u.includes('apple.com') && !u.startsWith('x-apple'))
  )]
}

// ─── Adapter ──────────────────────────────────────────────────────────────────

export const source = {
  id:    'apple-notes',
  label: 'Apple Notes',
  defaultModes: ['sync'],
  supportsRemovedDetection: false,

  isEnabled(config) {
    return Boolean(config.APPLE_NOTES_FOLDER)
  },

  async fetch({ mode, state, knownKeys }) {
    const folder = APPLE_NOTES_FOLDER
    const raw    = readNotesFromFolder(folder)

    if (raw.startsWith('ERROR:FOLDER_NOT_FOUND')) {
      console.warn(`\n⚠️  Apple Notes folder "${folder}" not found — skipping.`)
      return []
    }

    if (!raw) return []

    // Parse the delimited output
    const noteBlocks = raw.split('|||NOTE_START|||').slice(1)
    const items = []

    for (const block of noteBlocks) {
      const endIdx = block.indexOf('|||NOTE_END|||')
      if (endIdx === -1) continue
      const parts = block.slice(0, endIdx).split('|||')
      if (parts.length < 4) continue

      const [noteId, title, created, ...bodyParts] = parts
      const body = bodyParts.join('|||')

      const urls = extractUrls(body)
      if (urls.length === 0) {
        console.log(`   Note "${title.trim()}" has no URLs — skipping.`)
        await moveNoteToProcessed(noteId.trim(), folder)
        continue
      }

      for (const url of urls) {
        const externalId = url
        if (knownKeys.has(externalId)) continue

        process.stdout.write(`\n   Fetching: ${url.slice(0, 70)}...`)
        const article = await fetchArticle(url)

        if (!article || !article.text) {
          console.log(` ⚠️  Could not extract content`)
          continue
        }

        console.log(` ✅`)
        items.push({
          source:      'apple-notes',
          sourceType:  'article',
          externalId,
          uniqueKey:   `apple-notes:${externalId}`,
          url,
          title:       article.title || title.trim(),
          text:        article.text,
          author:      article.author,
          authorTitle: article.excerpt,
          savedAt:     created ? new Date(created).toISOString() : new Date().toISOString(),
          createdAt:   null,
          publishedAt: null,
          tags:        [],
          metadata:    { noteId: noteId.trim(), noteTitle: title.trim() },
        })
      }

      // Move note to processed regardless of URL fetch success
      await moveNoteToProcessed(noteId.trim(), folder)
    }

    if (items.length > 0) {
      console.log(`\n✅ ${items.length} article(s) ingested from Apple Notes "${folder}"`)
    }

    return items
  },
}
