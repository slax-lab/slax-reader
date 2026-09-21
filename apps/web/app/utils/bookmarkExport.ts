import type { BookmarkExportItem, BookmarkExportPage } from '@commons/types/interface'

export type BookmarkExportFormat = 'csv' | 'json'
const headers = 'url,title,tags,saved_at,is_read,is_archived,is_starred,type\r\n'

export const exportCsvCell = (value: string): string => {
  // A leading apostrophe keeps spreadsheet applications from evaluating formulas.
  const safe = /^[\s\u0000-\u001f]*[=+\-@]/u.test(value) || /^[\t\r\n]/u.test(value) ? `'${value}` : value
  return `"${safe.replace(/"/g, '""')}"`
}

export const exportCsvRow = (item: BookmarkExportItem): string =>
  [item.url, item.title, JSON.stringify(item.tags.map(tag => tag.name)), item.saved_at, String(item.is_read), String(item.is_archived), String(item.is_starred), item.type]
    .map(exportCsvCell)
    .join(',') + '\r\n'

export const bookmarkExportFilename = (format: BookmarkExportFormat, date = new Date()): string => {
  const localDate = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`
  return `slax-reader-links-${localDate}.${format}`
}

export interface PrepareBookmarkExportOptions {
  format: BookmarkExportFormat
  signal: AbortSignal
  fetchPage: (cursor: string | undefined, signal: AbortSignal) => Promise<BookmarkExportPage | undefined>
  onProgress: (count: number) => void
  now?: Date
}

export async function prepareBookmarkExport({ format, signal, fetchPage, onProgress, now = new Date() }: PrepareBookmarkExportOptions) {
  // Keep serialized pages, avoiding a second full object graph for a large library.
  const chunks: BlobPart[] = [format === 'csv' ? `\uFEFF${headers}` : `{"schema_version":1,"exported_at":${JSON.stringify(now.toISOString())},"items":[`]
  const clear = () => {
    chunks.length = 0
  }
  signal.addEventListener('abort', clear, { once: true })
  let count = 0
  let cursor: string | undefined
  const seen = new Set<string>()
  try {
    do {
      signal.throwIfAborted()
      const page = await fetchPage(cursor, signal)
      signal.throwIfAborted()
      if (!page || !Array.isArray(page.items) || !(page.next_cursor === null || (typeof page.next_cursor === 'string' && page.next_cursor.length))) {
        throw new Error('Invalid export response')
      }
      if (page.items.length) {
        chunks.push(format === 'csv' ? page.items.map(exportCsvRow).join('') : `${count ? ',' : ''}${page.items.map(item => JSON.stringify(item)).join(',')}`)
        count += page.items.length
        onProgress(count)
      }
      cursor = page.next_cursor ?? undefined
      if (cursor && seen.has(cursor)) throw new Error('Repeated export cursor')
      if (cursor) seen.add(cursor)
      // Yield between pages so cancellation and progress paint even with cached responses.
      await new Promise<void>(resolve => setTimeout(resolve, 0))
      signal.throwIfAborted()
    } while (cursor)
    if (!count) return { count, blob: null }
    if (format === 'json') chunks.push(']}')
    return { count, blob: new Blob(chunks, { type: format === 'csv' ? 'text/csv;charset=utf-8' : 'application/json;charset=utf-8' }) }
  } finally {
    clear()
    signal.removeEventListener('abort', clear)
  }
}

export function downloadBookmarkExport(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  try {
    link.click()
  } finally {
    link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
}
