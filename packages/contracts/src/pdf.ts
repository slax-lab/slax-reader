export const PDF_MAX_BYTES = 50 * 1024 * 1024
export type BookmarkContentType = 'article' | 'shortcut' | 'pdf'
export const bookmarkContentType = (type: number): BookmarkContentType => type === 2 ? 'pdf' : type === 1 ? 'shortcut' : 'article'
export const isPdfContentKey = (key?: string | null): boolean => !!key?.startsWith('pdf/body/') && key.endsWith('.pdf')

/** Prefer document authors in XMP over the document-info fallback. */
export function pdfMetadataAuthor(creator: unknown, author: unknown): string | undefined {
  const normalize = (value: unknown): string | undefined => {
    const names = Array.isArray(value) ? value : [value]
    const text = names.filter((name): name is string => typeof name === 'string')
      .map(name => name.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim())
      .filter(Boolean).join(', ').slice(0, 500)
    return text || undefined
  }
  return normalize(creator) || normalize(author)
}

export interface PdfDescriptor {
  url: string
  filename: string
  size: number
  document_id: string
  source: 'url' | 'upload'
  text_status: 'pending' | 'ready' | 'empty' | 'failed'
  pages?: number
}

export interface PdfMarkSource {
  type: 'pdf'
  version: 1
  page: number
  document_id: string
  text: string
  quads: [number, number, number, number, number, number, number, number][]
}

/** Returns a PDF selection's length; legacy sources are handled by their existing validator. */
export function validatePdfSources(source: unknown, documentId?: string): number | undefined {
  if (!Array.isArray(source) || !source.some(item => item?.type === 'pdf')) return undefined
  if (!source.length) throw new Error('Invalid PDF selection')
  let length = 0
  for (const item of source) {
    if (!item || item.type !== 'pdf' || item.version !== 1 || !Number.isInteger(item.page) || item.page < 1 || item.page > 100000 ||
        typeof item.document_id !== 'string' || !/^[a-f0-9]{64}$/.test(item.document_id) ||
        (documentId !== undefined && item.document_id !== documentId) || typeof item.text !== 'string' || !item.text.trim() ||
        !Array.isArray(item.quads) || !item.quads.length) throw new Error('Invalid PDF selection')
    length += item.text.length
    for (const quad of item.quads) {
      if (!Array.isArray(quad) || quad.length !== 8 || !quad.every(n => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 1e7)) {
        throw new Error('Invalid PDF coordinates')
      }
    }
  }
  return length
}

export function pdfByteRange(header: string | null, size: number): { offset: number; length: number } | undefined {
  if (!header) return undefined
  const match = /^bytes=(\d*)-(\d*)$/.exec(header)
  if (!match || (!match[1] && !match[2])) throw new Error('Invalid byte range')
  const suffix = !match[1]
  const start = suffix ? Math.max(0, size - Number(match[2])) : Number(match[1])
  const end = suffix || !match[2] ? size - 1 : Math.min(Number(match[2]), size - 1)
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || end < start || (suffix && Number(match[2]) <= 0)) throw new Error('Unsatisfiable byte range')
  return { offset: start, length: end - start + 1 }
}

export function pdfResponseHeaders(filename: string, size: number, range?: { offset: number; length: number }): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/pdf', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store',
    'Accept-Ranges': 'bytes', 'Content-Length': String(range?.length ?? size),
    'Content-Disposition': `inline; filename="document.pdf"; filename*=UTF-8''${encodeURIComponent(filename.replace(/[\r\n]/g, ''))}`
  }
  if (range) headers['Content-Range'] = `bytes ${range.offset}-${range.offset + range.length - 1}/${size}`
  return headers
}
