import { PDF_MAX_BYTES, pdfMetadataAuthor, pdfMetadataTitle } from '@slax-reader/contracts/pdf'
import { pdfFirstPageTitle } from './pdfTitle'

export class PdfSaveInProgressError extends Error {
  constructor() {
    super('PDF save is already in progress; retry shortly')
  }
}

export const hasPdfSignature = (bytes: Uint8Array): boolean => {
  // PDF readers permit a small binary prefix before the header.
  return new TextDecoder('ascii').decode(bytes.subarray(0, 1024)).includes('%PDF-')
}

export async function readPdfBody(body: ReadableStream<Uint8Array> | null, contentLength?: string | null, timeoutMs = 60_000): Promise<Uint8Array> {
  if (!body) throw new Error('Empty PDF file')
  const advertised = contentLength ? Number(contentLength) : 0
  if (!Number.isSafeInteger(advertised) || advertised < 0 || advertised > PDF_MAX_BYTES) {
    await body.cancel()
    throw new Error('PDF file exceeds 50 MiB')
  }
  // One bounded allocation avoids retaining chunks plus a second full-file concatenation.
  const bytes = new Uint8Array(advertised || PDF_MAX_BYTES)
  const reader = body.getReader()
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('PDF download timed out')), timeoutMs)
  })
  let size = 0
  try {
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), timeout])
      if (done) break
      if (size + value.byteLength > bytes.length) throw new Error('PDF file exceeds its byte limit')
      bytes.set(value, size)
      size += value.byteLength
    }
    if (!size || !hasPdfSignature(bytes.subarray(0, size))) throw new Error('Invalid PDF file')
    return bytes.subarray(0, size)
  } catch (error) {
    await reader.cancel().catch(() => {})
    throw error
  } finally {
    clearTimeout(timer)
    reader.releaseLock()
  }
}

export const pdfFilename = (name: string): string =>
  name
    .replace(/[\u0000-\u001f\u007f/\\]/g, '')
    .trim()
    .slice(0, 200) || 'document.pdf'
export async function pdfHash(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>)
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

type PdfMetadata = { title?: string; author?: string }
function documentMetadata(value: { metadata?: { get(name: string): unknown } | null; info: unknown }): PdfMetadata {
  const info = value.info as { Title?: unknown; Author?: unknown } | undefined
  return {
    title: pdfMetadataTitle(value.metadata?.get('dc:title'), info?.Title),
    author: pdfMetadataAuthor(value.metadata?.get('dc:creator'), info?.Author)
  }
}

/** Resolve metadata/title before acknowledgement, leaving remaining text to the workflow. */
export async function extractPdfMetadata(bytes: Uint8Array): Promise<PdfMetadata> {
  let timer: ReturnType<typeof setTimeout> | undefined
  let cleanup = async () => {}
  try {
    const { getResolvedPDFJS } = await import('unpdf')
    const { getDocument } = await getResolvedPDFJS()
    const options = { data: bytes, isEvalSupported: false, useSystemFonts: false, verbosity: 0 }
    const task = getDocument(options)
    cleanup = () => task.destroy().catch(() => {})
    return await Promise.race([
      task.promise.then(async pdf => {
        const value = await pdf.getMetadata().catch(() => undefined)
        const metadata: PdfMetadata = value ? documentMetadata(value) : {}
        if (!metadata.title) {
          try {
            const page = await pdf.getPage(1)
            try {
              metadata.title = pdfFirstPageTitle((await page.getTextContent()).items, page.getViewport({ scale: 1 }))
            } finally {
              page.cleanup()
            }
          } catch {}
        }
        return metadata
      }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('PDF metadata timed out')), 10_000)
      })
    ])
  } catch {
    return {}
  } finally {
    clearTimeout(timer)
    await cleanup()
  }
}

/** Extract one page at a time. PDF.js consumes/detaches the input buffer. */
export async function extractPdfText(bytes: Uint8Array): Promise<{ text: string; pages: number; status: 'ready' | 'empty' | 'failed'; title?: string; author?: string }> {
  const { getDocumentProxy } = await import('unpdf')
  let pdf: Awaited<ReturnType<typeof getDocumentProxy>> | undefined
  let title: string | undefined
  let author: string | undefined
  try {
    const options = { isEvalSupported: false, useSystemFonts: false }
    pdf = await getDocumentProxy(bytes, options)
    const metadata = await pdf.getMetadata().catch(() => undefined)
    const documentInfo = metadata ? documentMetadata(metadata) : {}
    title = documentInfo.title
    author = documentInfo.author
    if (pdf.numPages > 5000) throw new Error('PDF text extraction page limit exceeded')
    const texts: string[] = []
    let length = 0
    let hasText = false
    for (let number = 1; number <= pdf.numPages; number++) {
      const page = await pdf.getPage(number)
      const content = await page.getTextContent()
      if (number === 1 && !title) title = pdfFirstPageTitle(content.items, page.getViewport({ scale: 1 }))
      const text = content.items
        .map(item => ('str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : ''))
        .join('')
        .trim()
      hasText ||= !!text
      length += text.length
      if (length > 2_000_000) throw new Error('PDF text extraction character limit exceeded')
      texts.push(`## Page ${number}\n\n${text}`)
      page.cleanup()
    }
    return { text: hasText ? texts.join('\n\n') : '', pages: pdf.numPages, status: hasText ? 'ready' : 'empty', title, author }
  } catch (error) {
    console.warn('PDF text extraction unavailable:', error instanceof Error ? error.name : 'unknown')
    return { text: '', pages: pdf?.numPages ?? 0, status: 'failed', title, author }
  } finally {
    await pdf?.loadingTask.destroy().catch(() => {})
  }
}
