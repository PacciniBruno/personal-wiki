/**
 * sources/apple-notes/index.js — Apple Notes saved-links adapter.
 *
 * Reads notes from a designated Apple Notes folder (APPLE_NOTES_FOLDER),
 * then for each note:
 *   1. Extracts URLs from the body, fetches their article content.
 *   2. Detects PDF attachments (e.g. email prints from mobile), finds the
 *      files in the Notes Group Container, and extracts their text.
 *
 * After processing, notes are moved to an "[APPLE_NOTES_FOLDER] Processed"
 * sub-folder so the inbox stays clean.
 *
 * Workflow:
 *   iPhone: Any app → Share → Notes → save to APPLE_NOTES_FOLDER
 *   Pipeline: osascript reads folder → extract URLs + PDFs → ingest
 *
 * Config (in .env):
 *   APPLE_NOTES_FOLDER — folder name to scan. Source disabled if not set.
 */

import { execSync }  from 'child_process'
import { readFile }  from 'fs/promises'
import { join }      from 'path'
import { homedir }   from 'os'
import { APPLE_NOTES_FOLDER } from '../../config.js'
import { fetchArticle }       from '../../pipeline/fetch-article.js'
import { extractPdfText }     from '../../pipeline/extract-pdf.js'

// ─── AppleScript helpers ──────────────────────────────────────────────────────

function runScript(script) {
  return execSync(`osascript -e '${script.replace(/'/g, "'\\''")}'`, {
    encoding:  'utf8',
    timeout:   60_000,
    maxBuffer: 256 * 1024 * 1024, // 256 MB — note bodies can include large HTML
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
 * Returns the names of any PDF attachments on the given note.
 */
function getPdfAttachments(noteId) {
  const script = `
    tell application "Notes"
      set output to ""
      try
        set theNote to note id "${noteId.replace(/"/g, '\\"')}"
        repeat with att in (every attachment of theNote)
          set n to name of att
          if n ends with ".pdf" or n ends with ".PDF" then
            set output to output & n & linefeed
          end if
        end repeat
      end try
      return output
    end tell`

  try {
    const result = runScript(script)
    return result.split('\n').filter(n => n.trim() !== '')
  } catch {
    return []
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

// ─── HTML → plain text (for prose-only notes) ────────────────────────────────

const PROSE_MIN_CHARS = 200

function stripHtml(html) {
  return (html ?? '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/(div|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// ─── PDF helpers ─────────────────────────────────────────────────────────────

/**
 * Searches the Notes Group Container for a PDF with the given filename.
 * Returns the first (newest-modified) match, or null if not found.
 */
function findPdfInNotesStorage(filename) {
  const notesBase = join(homedir(), 'Library/Group Containers/group.com.apple.notes')
  const safeName  = filename.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  try {
    const result = execSync(
      `find "${notesBase}" -type f -name "${safeName}" 2>/dev/null | head -1`,
      { encoding: 'utf8', timeout: 15_000 }
    ).trim()
    return result || null
  } catch {
    return null
  }
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

      const [rawNoteId, rawTitle, created, ...bodyParts] = parts
      const body          = bodyParts.join('|||')
      const noteId        = rawNoteId.trim()
      const trimmedTitle  = rawTitle.trim()
      const savedAt       = created ? new Date(created).toISOString() : new Date().toISOString()

      const urls     = extractUrls(body)
      const pdfNames = getPdfAttachments(noteId)

      // Per-note bookkeeping: only move to Processed if we ingested something
      // OR the note was truly empty. A note where every URL/PDF failed stays
      // in the inbox so transient failures retry on the next run.
      let ingestedAnyItem = false
      let attemptedAnyItem = false

      // ── URLs ────────────────────────────────────────────────────────────────
      for (const url of urls) {
        const externalId = url
        if (knownKeys.has(externalId)) {
          ingestedAnyItem = true // already in KB; treat as success for move purposes
          continue
        }

        attemptedAnyItem = true
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
          title:       article.title || trimmedTitle,
          text:        article.text,
          author:      article.author,
          authorTitle: article.excerpt,
          savedAt,
          createdAt:   null,
          publishedAt: null,
          tags:        [],
          metadata:    { noteId, noteTitle: trimmedTitle },
        })
        ingestedAnyItem = true
      }

      // ── PDF attachments ─────────────────────────────────────────────────────
      for (const pdfName of pdfNames) {
        // Stable dedup key: note ID + filename (note IDs are stable in Notes)
        const externalId = `pdf:${noteId}:${pdfName}`
        if (knownKeys.has(externalId)) {
          ingestedAnyItem = true
          continue
        }

        attemptedAnyItem = true
        process.stdout.write(`\n   Reading PDF: ${pdfName}...`)

        const pdfPath = findPdfInNotesStorage(pdfName)
        if (!pdfPath) {
          console.log(` ⚠️  File not found in Notes storage`)
          continue
        }

        let text = null
        try {
          const buffer = await readFile(pdfPath)
          text = await extractPdfText(buffer)
        } catch {
          // fall through
        }

        if (!text) {
          console.log(` ⚠️  Could not extract text`)
          continue
        }

        console.log(` ✅`)
        items.push({
          source:      'apple-notes',
          sourceType:  'article',
          externalId,
          uniqueKey:   `apple-notes:${externalId}`,
          url:         null,
          title:       pdfName.replace(/\.pdf$/i, '').trim() || trimmedTitle,
          text,
          author:      '',
          authorTitle: '',
          savedAt,
          createdAt:   null,
          publishedAt: null,
          tags:        [],
          metadata:    { noteId, noteTitle: trimmedTitle, pdfFile: pdfName },
        })
        ingestedAnyItem = true
      }

      // ── Plain-prose fallback (no URLs, no PDFs) ─────────────────────────────
      let noteWasEmpty = false
      if (urls.length === 0 && pdfNames.length === 0) {
        const proseText  = stripHtml(body)
        const externalId = `note:${noteId}`

        if (knownKeys.has(externalId)) {
          ingestedAnyItem = true
        } else if (proseText.length >= PROSE_MIN_CHARS) {
          items.push({
            source:      'apple-notes',
            sourceType:  'note',
            externalId,
            uniqueKey:   `apple-notes:${externalId}`,
            url:         null,
            title:       trimmedTitle || 'Untitled note',
            text:        proseText,
            author:      '',
            authorTitle: '',
            savedAt,
            createdAt:   null,
            publishedAt: null,
            tags:        [],
            metadata:    { noteId, noteTitle: trimmedTitle },
          })
          ingestedAnyItem = true
          console.log(`   Note "${trimmedTitle}" ingested as prose (${proseText.length} chars).`)
        } else {
          noteWasEmpty = true
          console.log(`   Note "${trimmedTitle}" has no URLs, PDFs, or substantial prose — skipping.`)
        }
      }

      if (ingestedAnyItem || noteWasEmpty) {
        await moveNoteToProcessed(noteId, folder)
      } else if (attemptedAnyItem) {
        console.log(`   Note "${trimmedTitle}" had failures — leaving in inbox for retry.`)
      }
    }

    if (items.length > 0) {
      console.log(`\n✅ ${items.length} item(s) ingested from Apple Notes "${folder}"`)
    }

    return items
  },
}
