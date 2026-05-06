/**
 * pipeline/extract-pdf.js — Extract plain text from a PDF buffer.
 *
 * Used by:
 *   - fetch-article.js  (when a URL serves application/pdf)
 *   - sources/apple-notes (when a note has a PDF attachment on disk)
 */

import { PDFParse } from 'pdf-parse'

/**
 * Extract text from a PDF buffer.
 *
 * @param {Buffer} buffer
 * @returns {Promise<string|null>}  Clean text (≤5000 chars), or null on failure.
 */
export async function extractPdfText(buffer) {
  let parser
  try {
    parser = new PDFParse({ data: buffer })
    const result = await parser.getText()
    const text = (result.text ?? '').replace(/\s+/g, ' ').trim().slice(0, 5000)
    return text || null
  } catch {
    return null
  } finally {
    try { await parser?.destroy() } catch {}
  }
}
