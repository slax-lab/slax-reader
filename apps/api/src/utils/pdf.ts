import { PDF_MAX_BYTES, pdfMetadataAuthor } from '@slax-reader/contracts/pdf'

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
    const normalizeTitle = (value: unknown) =>
      typeof value === 'string'
        ? value
            .replace(/[\u0000-\u001f\u007f]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 500) || undefined
        : undefined
    title = normalizeTitle(metadata?.metadata?.get('dc:title')) || normalizeTitle((metadata?.info as { Title?: unknown } | undefined)?.Title)
    author = pdfMetadataAuthor(metadata?.metadata?.get('dc:creator'), (metadata?.info as { Author?: unknown } | undefined)?.Author)
    if (pdf.numPages > 5000) throw new Error('PDF text extraction page limit exceeded')
    const texts: string[] = []
    let length = 0
    let hasText = false
    for (let number = 1; number <= pdf.numPages; number++) {
      const page = await pdf.getPage(number)
      const content = await page.getTextContent()
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
