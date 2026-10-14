import { DOMParser } from 'linkedom'
import { processTargetUrl } from '@/utils/urlPolicie'

export const MAX_IMPORT_BYTES = 25 * 1024 * 1024
export const MAX_IMPORT_RECORDS = 10_000
export const newImportSources = ['pinboard', 'readwise', 'instapaper'] as const
export type NewImportSource = (typeof newImportSources)[number]
export const isNewImportSource = (value: string): value is NewImportSource => newImportSources.includes(value as NewImportSource)

export interface ImportRecord {
  target_url: string
  target_title: string
  tags: string[]
  saved_at?: string
  is_archive: boolean
  is_starred: boolean
  import_only: true
}

export interface ParsedImport {
  records: ImportRecord[]
  excluded_feed_count: number
  duplicate_count: number
  invalid_row_count: number
  invalid_date_count: number
}

export class ImportFormatError extends Error {}
export async function readImportBody(request: Request): Promise<string> {
  if (Number(request.headers.get('content-length')) > MAX_IMPORT_BYTES) throw new ImportFormatError('Export exceeds 25 MiB')
  const reader = request.body?.getReader()
  if (!reader) return ''
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false })
  let size = 0,
    text = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_IMPORT_BYTES) {
        await reader.cancel()
        throw new ImportFormatError('Export exceeds 25 MiB')
      }
      text += decoder.decode(value, { stream: true })
    }
    return text + decoder.decode()
  } catch (error) {
    if (error instanceof ImportFormatError) throw error
    throw new ImportFormatError('Invalid UTF-8 export')
  } finally {
    reader.releaseLock()
  }
}
const invalid = (): never => {
  throw new ImportFormatError('Invalid export format')
}
const string = (value: unknown): string => (typeof value === 'string' ? value : '')
const uniqueTags = (tags: string[]) => [...new Set(tags.map(t => t.trim()).filter(Boolean))]

// Parse CSV records one at a time, including quoted line breaks and doubled quotes.
function* iterateCSV(content: string, required: string[] = []): Generator<Record<string, string>> {
  let headers: string[] | undefined
  let row: string[] = [],
    field = '',
    quoted = false,
    closed = false
  const text = content.replace(/^\uFEFF/, '')
  const endField = () => {
    row.push(field)
    field = ''
    closed = false
  }
  const endRow = (): Record<string, string> | undefined => {
    endField()
    const values = row
    row = []
    if (!values.some(v => v !== '')) return
    if (!headers) {
      headers = values.map(v => v.trim())
      if (!headers.length || new Set(headers).size !== headers.length || !required.every(key => headers!.includes(key))) return invalid()
      return
    }
    if (values.length !== headers.length) return invalid()
    return Object.fromEntries(headers.map((key, i) => [key, values[i]]))
  }
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"'
        i++
      } else if (ch === '"') {
        quoted = false
        closed = true
      } else field += ch
    } else if (ch === ',') endField()
    else if (ch === '\n' || ch === '\r') {
      const record = endRow()
      if (record) yield record
      if (ch === '\r' && text[i + 1] === '\n') i++
    } else if (ch === '"' && !field && !closed) quoted = true
    else if (closed || ch === '"') invalid()
    else field += ch
  }
  if (quoted) invalid()
  const record = endRow()
  if (record) yield record
  if (!headers) invalid()
}

export function readCSV(content: string, required: string[] = []): Record<string, string>[] {
  return Array.from(iterateCSV(content, required))
}

// A string-list grammar shared by JSON and Python-style export lists. Never execute input.
export function readTagList(value: string): string[] {
  const text = value.trim()
  if (!text) return []
  let i = 0
  const ws = () => {
    while (/\s/.test(text[i] || '') && i < text.length) i++
  }
  if (text[i++] !== '[') return invalid()
  const tags: string[] = []
  ws()
  while (text[i] !== ']') {
    const quote = text[i++]
    if (quote !== '"' && quote !== "'") return invalid()
    let tag = '',
      ended = false
    while (i < text.length) {
      const ch = text[i++]
      if (ch === quote) {
        ended = true
        break
      }
      if (ch !== '\\') {
        tag += ch
        continue
      }
      const escape = text[i++]
      if (escape === 'u' || escape === 'x') {
        const count = escape === 'u' ? 4 : 2,
          hex = text.slice(i, i + count)
        if (!new RegExp(`^[0-9a-fA-F]{${count}}$`).test(hex)) return invalid()
        tag += String.fromCharCode(parseInt(hex, 16))
        i += count
      } else {
        const escapes: Record<string, string> = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '\\': '\\', "'": "'", '"': '"', '/': '/' }
        if (!(escape in escapes)) return invalid()
        tag += escapes[escape]
      }
    }
    if (!ended) return invalid()
    tags.push(tag)
    ws()
    if (text[i] === ']') break
    if (text[i++] !== ',') return invalid()
    ws()
  }
  i++
  ws()
  if (i !== text.length) return invalid()
  return uniqueTags(tags)
}

function savedDate(value: string, seconds: boolean): string | undefined {
  if (!value.trim()) return undefined
  const normalized = seconds
    ? Number(value) * 1000
    : value
        .trim()
        .replace(' ', 'T')
        .replace(/(\.\d{3})\d+(?=Z|[+-]\d\d:\d\d$)/, '$1')
  if (seconds ? !/^\d+(\.\d+)?$/.test(value) : !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(String(normalized))) return undefined
  const date = new Date(normalized)
  return Number.isFinite(date.getTime()) && date.getTime() >= 0 ? date.toISOString() : undefined
}

interface ExportElement {
  getAttribute(name: string): string | null
  hasAttribute(name: string): boolean
  textContent: string | null
  attributes: Iterable<{ name: string; value: string }>
}

function pinboardRows(blob: string): Record<string, unknown>[] {
  const text = blob.replace(/^\uFEFF/, '').trim()
  if (text.startsWith('[')) {
    const rows: unknown = JSON.parse(text)
    if (!Array.isArray(rows) || rows.some(r => !r || typeof r !== 'object' || !('href' in r))) return invalid()
    return rows
  }
  if (/<!ENTITY|<!DOCTYPE[^>]*(?:\bSYSTEM\b|\bPUBLIC\b|\[)/i.test(text)) return invalid()
  const xml = /^(?:<\?xml[^?]*\?>\s*)?<posts\b/.test(text)
  if (xml) {
    // Pinboard XML consists only of a posts root and self-closing post elements.
    // Validate this limited grammar before using the inert DOM parser.
    const attr = String.raw`\s+[\w:.-]+\s*=\s*(?:"[^"<]*"|'[^'<]*')`
    const post = String.raw`<post(?:${attr})*\s*/>\s*`
    if (!new RegExp(String.raw`^(?:<\?xml[^?]*\?>\s*)?<posts(?:${attr})*\s*>\s*(?:${post})*</posts>\s*$`).test(text)) return invalid()
    const doc = new DOMParser().parseFromString(text, 'text/xml')
    const decode = (value: string | null) => {
      if (!value) return ''
      if (/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[\da-fA-F]+);)/.test(value)) return invalid()
      return value.replace(/&([^;]+);/g, (_, entity: string) => {
        const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
        if (entity in named) return named[entity]
        const code = entity.startsWith('#x') ? parseInt(entity.slice(2), 16) : Number(entity.slice(1))
        if (code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return invalid()
        return String.fromCodePoint(code)
      })
    }
    return Array.from(doc.querySelectorAll('post') as Iterable<ExportElement>).map(el => ({
      href: decode(el.getAttribute('href')),
      description: decode(el.getAttribute('description')),
      tags: decode(el.getAttribute('tag')),
      time: decode(el.getAttribute('time')),
      toread: el.hasAttribute('toread') ? decode(el.getAttribute('toread')) : 'no'
    }))
  }
  if (!/<!DOCTYPE NETSCAPE-Bookmark-file-1>/i.test(text)) return invalid()
  const doc = new DOMParser().parseFromString(text, 'text/html')
  return Array.from(doc.querySelectorAll('a') as Iterable<ExportElement>).map(el => {
    const attrs = Object.fromEntries(Array.from(el.attributes).map(a => [a.name.toLowerCase(), a.value]))
    return {
      href: attrs.href,
      description: el.textContent,
      tags: string(attrs.tags).split(',').join(' '),
      time: attrs.add_date,
      seconds: true,
      toread: attrs.toread === '1' ? 'yes' : 'no'
    }
  })
}

export function parseImport(source: NewImportSource, blob: string, includeFeed = false): ParsedImport {
  if (new TextEncoder().encode(blob).byteLength > MAX_IMPORT_BYTES) throw new ImportFormatError('Export exceeds 25 MiB')
  const result: ParsedImport = { records: [], excluded_feed_count: 0, duplicate_count: 0, invalid_row_count: 0, invalid_date_count: 0 }
  let rows: Iterable<Record<string, unknown>>
  const required = source === 'readwise' ? ['URL', 'Title', 'Document tags', 'Saved date', 'Location'] : ['URL', 'Title', 'Folder', 'Timestamp', 'Tags']
  try {
    rows = source === 'pinboard' ? pinboardRows(blob) : iterateCSV(blob, required)
  } catch {
    return invalid()
  }
  const seen = new Map<string, { record: ImportRecord; feed: boolean }>()
  for (const row of rows) {
    const feed = source === 'readwise' && string(row.Location).toLowerCase() === 'feed'
    if (feed && !includeFeed) {
      result.excluded_feed_count++
      continue
    }
    let record: ImportRecord
    try {
      const url = new URL(string(source === 'pinboard' ? row.href : row.URL).trim())
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error()
      const pin = source === 'pinboard',
        insta = source === 'instapaper'
      const rawDate = string(pin ? row.time : insta ? row.Timestamp : row['Saved date'])
      const saved_at = savedDate(rawDate, insta || row.seconds === true)
      if (rawDate && !saved_at) result.invalid_date_count++
      const folder = string(row.Folder),
        location = string(row.Location).toLowerCase()
      const tags = pin ? string(row.tags).split(/\s+/) : readTagList(string(insta ? row.Tags : row['Document tags']))
      if (insta && folder && !['unread', 'archive', 'starred'].includes(folder.toLowerCase())) tags.push(folder)
      record = {
        target_url: processTargetUrl(url),
        target_title: string(pin ? row.description : row.Title),
        tags: uniqueTags(tags),
        saved_at,
        is_archive: pin ? !['yes', '1'].includes(string(row.toread).toLowerCase()) : insta ? folder.toLowerCase() === 'archive' : location === 'archive',
        is_starred: insta && folder.toLowerCase() === 'starred',
        import_only: true
      }
    } catch {
      result.invalid_row_count++
      continue
    }
    const prev = seen.get(record.target_url)
    if (prev) {
      result.duplicate_count++
      const useNew = prev.feed !== feed ? !feed : (record.saved_at || '') > (prev.record.saved_at || '')
      const winner = useNew ? record : prev.record
      seen.set(record.target_url, {
        feed: useNew ? feed : prev.feed,
        record: { ...winner, tags: uniqueTags([...prev.record.tags, ...record.tags]), is_starred: prev.record.is_starred || record.is_starred }
      })
    } else {
      if (seen.size >= MAX_IMPORT_RECORDS) throw new ImportFormatError(`Export exceeds ${MAX_IMPORT_RECORDS} bookmarks`)
      seen.set(record.target_url, { record, feed })
    }
  }
  result.records = Array.from(seen.values(), v => v.record).sort((a, b) => Number(a.is_archive) - Number(b.is_archive) || (b.saved_at || '').localeCompare(a.saved_at || ''))
  return result
}

export function importPreview(parsed: ParsedImport) {
  const { records, ...counts } = parsed
  return { ...counts, eligible_count: records.length, preview: records.slice(0, 10) }
}
