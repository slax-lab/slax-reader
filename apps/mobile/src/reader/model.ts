import { validatePdfSources, type PdfMarkSource } from '@slax-reader/contracts/pdf'
import type { MarkRecord, CollectionMarkPolicy } from '../data/repositories.ts'
import type { MarkCommentProfile } from '../data/api.ts'
import type { ReaderApprox, ReaderMarkDetail, ReaderMarkItem, ReaderMarkPath, ReaderSelection, HtmlMarkPath } from './types.ts'
import {parseSourceTimestamp} from '../utils/source-time.ts'

function sameReaderSource(left: ReaderMarkPath[], right: ReaderMarkPath[]): boolean {
  return left.length > 0 && left.length === right.length && left.every((path, index) => {
    const other = right[index]
    if (path.type === 'pdf' || other.type === 'pdf') return path.type === 'pdf' && other.type === 'pdf' &&
      path.version === other.version && path.document_id === other.document_id && path.page === other.page && path.text === other.text &&
      path.quads.length === other.quads.length && path.quads.every((quad, quadIndex) => quad.length === other.quads[quadIndex].length && quad.every((point, pointIndex) => point === other.quads[quadIndex][pointIndex]))
    return path.type === other.type && path.path === other.path && (path.type === 'image' || other.type === 'text' && path.start === other.start && path.end === other.end)
  })
}

export function refreshSelectedMark(current: ReaderMarkItem, marks: ReaderMarkItem[]): ReaderMarkItem {
  if (readerPaths(current.source) === null) return {...current, id: '', stroke: [], comments: []}
  marks = marks.filter(mark => readerPaths(mark.source) !== null)
  const pdf = current.source.some(path => path.type === 'pdf')
  const sameSource = (mark: ReaderMarkItem) => sameReaderSource(current.source, mark.source)
  const identified = current.id.trim() ? marks.find(mark => mark.id === current.id && (pdf || mark.source.some(path => path.type === 'pdf') ? sameSource(mark) : true)) : undefined
  if (identified) return identified
  const sameApprox = (mark: ReaderMarkItem) => {
    if (pdf || mark.source.some(path => path.type === 'pdf')) return false
    const left = current.approx, right = mark.approx
    return Boolean(left?.exact && right?.exact && (left.prefix || left.suffix || typeof left.position_start === 'number' && typeof left.position_end === 'number' && left.position_end > left.position_start) && left.exact === right.exact &&
      (left.prefix ?? '') === (right.prefix ?? '') && (left.suffix ?? '') === (right.suffix ?? '') &&
      left.position_start === right.position_start && left.position_end === right.position_end &&
      (left.raw_text ?? left.exact) === (right.raw_text ?? right.exact))
  }
  const sourceMatches = marks.filter(sameSource)
  if (sourceMatches.length === 1) return sourceMatches[0]
  const approximateMatches = (sourceMatches.length ? sourceMatches : marks.filter(mark => !current.source.length || !mark.source.length || !current.source.some(path => mark.source.some(other => path.type !== 'pdf' && other.type !== 'pdf' && path.type === other.type && path.path === other.path)))).filter(sameApprox)
  if (approximateMatches.length === 1) return approximateMatches[0]
  return current.id || current.stroke.length || current.comments.length ? {...current, id: '', stroke: [], comments: []} : current
}

export function jsonObject(value: unknown): Record<string, unknown> {
  try { const parsed = typeof value === 'string' ? JSON.parse(value) : value; return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {} } catch { return {} }
}
export function jsonArray<T>(value: unknown): T[] {
  try { const parsed = typeof value === 'string' ? JSON.parse(value) : value; return Array.isArray(parsed) ? parsed : [] } catch { return [] }
}

/** Kotlin String.hashCode uses signed 32-bit arithmetic over UTF-16 code units. */
export function sourceStableId(value: string | null | undefined): number {
  if (!value?.trim()) return 0
  if (/^[+-]?\d+$/.test(value)) {
    const integer = BigInt(value)
    if (integer >= -(1n << 63n) && integer < (1n << 63n)) {
      const number = Number(integer)
      if (!Number.isSafeInteger(number)) throw new Error('A legacy annotation identifier exceeds JavaScript integer precision')
      return number
    }
  }
  let hash = 0
  for (let index = 0; index < value.length; index++) hash = (Math.imul(hash, 31) + value.charCodeAt(index)) | 0
  return hash
}

export function htmlPaths(value: unknown): HtmlMarkPath[] {
  return jsonArray<Record<string, unknown>>(value).flatMap<HtmlMarkPath>(item => {
    if (typeof item.path !== 'string') return []
    if (item.type === 'image') return [{ type: 'image' as const, path: item.path }]
    if (item.type === 'text' && Number.isInteger(item.start) && Number.isInteger(item.end) && Number(item.start) >= 0 && Number(item.end) >= Number(item.start)) {
      return [{ type: 'text' as const, path: item.path, start: Number(item.start), end: Number(item.end) }]
    }
    return []
  })
}

function pdfPaths(source: unknown[], documentId?: string): PdfMarkSource[] | undefined {
  const firstPdf = source.find((item): item is PdfMarkSource => item !== null && typeof item === 'object' && 'type' in item && item.type === 'pdf')
  if (validatePdfSources(source, documentId ?? firstPdf?.document_id) === undefined) return undefined
  return (source as PdfMarkSource[]).map(item => ({type: 'pdf', version: 1, document_id: item.document_id, page: item.page, text: item.text, quads: item.quads.map(quad => [...quad])}))
}

export function readerPaths(value: unknown, documentId?: string): ReaderMarkPath[] | null {
  const source = jsonArray<unknown>(value)
  try {
    const pdf = pdfPaths(source, documentId)
    if (pdf) return pdf
  } catch { return null }
  try { return htmlPaths(source) } catch { return [] }
}

/** Deleted ancestors remain visible when an undeleted descendant still needs its thread. */
export function visibleCommentIds(records: MarkRecord[]): Set<string> {
  const comments = records.filter(item => [2, 3, 5].includes(item.type))
  const children = new Map<string, MarkRecord[]>()
  for (const record of comments) if (record.type === 3) {
    const parent = String(jsonObject(record.metadata).parent_id ?? '')
    children.set(parent, [...(children.get(parent) ?? []), record])
  }
  const memo = new Map<string, boolean>()
  const visible = (record: MarkRecord, visiting: Set<string>): boolean => {
    if (memo.has(record.id)) return memo.get(record.id)!
    if (visiting.has(record.id)) return record.is_deleted === 0
    const path = new Set(visiting).add(record.id)
    const result = record.is_deleted === 0 || (children.get(record.id) ?? []).some(child => visible(child, path))
    memo.set(record.id, result)
    return result
  }
  return new Set(comments.filter(record => visible(record, new Set())).map(record => record.id))
}

export function buildReaderMarks(records: MarkRecord[], profiles: MarkCommentProfile[], currentUser: Record<string, unknown>, policy: CollectionMarkPolicy): ReaderMarkDetail {
  if (!policy.showMarks) return { mark_list: [], user_list: {} }
  const visible = visibleCommentIds(records)
  const users: Exclude<ReaderMarkDetail['user_list'], []> = {}
  const byUser = new Map(profiles.map(profile => [profile.uuid, profile]))
  const identities = new Map<number, string>()
  const id = (uuid: string) => {
    const number = sourceStableId(uuid)
    if (identities.has(number) && identities.get(number) !== uuid) throw new Error('Legacy annotation identifiers collide')
    if (uuid) identities.set(number, uuid)
    return number
  }
  const mark_list = records.filter(record => [1, 4].includes(record.type) ? record.is_deleted === 0 : visible.has(record.id)).flatMap<ReaderMarkDetail['mark_list'][number]>(record => {
    const source = readerPaths(record.source)
    if (source === null && record.type !== 3) return []
    const metadata = jsonObject(record.metadata)
    const userUuid = String(metadata.user_id ?? '')
    const userId = sourceStableId(userUuid)
    const profile = byUser.get(userUuid)
    if (userUuid) users[String(userId)] = { id: userId,
      username: policy.showProfile ? userUuid === currentUser.id ? String(currentUser.name ?? '') : profile?.nick_name ?? '' : '',
      avatar: policy.showProfile ? userUuid === currentUser.id ? String(currentUser.picture ?? '') : profile?.avatar ?? '' : '',
    }
    const approx = jsonObject(record.approx_source)
    return [{ id: id(record.id), uuid: record.id, user_id: userId, type: record.type as ReaderMarkDetail['mark_list'][number]['type'],
      source: source ?? id(String(metadata.parent_id ?? '')), approx_source: source !== null && typeof approx.exact === 'string' ? approx as ReaderApprox : null,
      parent_id: id(String(metadata.parent_id ?? '')), root_id: id(String(metadata.root_id ?? '')),
      parent_uid: String(metadata.parent_id ?? ''), root_uid: String(metadata.root_id ?? ''),
      comment: record.comment, created_at: record.created_at, is_deleted: record.is_deleted !== 0,
    }]
  })
  return { mark_list, user_list: users }
}

export function selectionPaths(selection: ReaderSelection): ReaderMarkPath[] {
  return pdfPaths(selection.source) ?? selection.source.map(source => source.type === 'pdf' ? source : source.type === 'image' ? {type: 'image', path: source.xpath} : {type: 'text', path: source.xpath, start: source.start_offset, end: source.end_offset})
}
/** The source removal lookup deletes only a live current-user LINE with the complete same range. */
export function sourceStrokeToRemove(records: MarkRecord[], mark: ReaderMarkItem | null | undefined, userId: string): MarkRecord | null {
  if (!mark || !userId || !mark.source.length) return null
  const pdf = mark.source.some(path => path.type === 'pdf')
  const paths = pdf ? readerPaths(mark.source) : mark.source
  if (!paths?.length) return null
  const source = JSON.stringify(paths)
  return records.find(record => {
    if (record.type !== 1 || record.is_deleted !== 0 || String(jsonObject(record.metadata).user_id ?? '') !== userId) return false
    const candidate = readerPaths(record.source)
    return candidate !== null && candidate.length > 0 && JSON.stringify(candidate) === source
  }) ?? null
}
export function selectionForMark(mark: ReaderMarkItem, fallbackText = ''): ReaderSelection {
  const pdf = pdfPaths(mark.source)
  const text = mark.approx?.raw_text ?? mark.approx?.exact ?? (pdf ? pdf.map(path => path.text).join('\n') : fallbackText)
  return { source: pdf ?? mark.source.map(path => path.type === 'pdf' ? path : {type: path.type, xpath: path.path, start_offset: path.type === 'text' ? path.start : 0, end_offset: path.type === 'text' ? path.end : 0}),
    text, select_content: [{type: 'text', text, src: ''}], approx_source: {exact: mark.approx?.exact ?? text, prefix: mark.approx?.prefix ?? '', suffix: mark.approx?.suffix ?? '', position_start: mark.approx?.position_start ?? 0, position_end: mark.approx?.position_end ?? 0, raw_text: text},
  }
}

export interface YoutubeCue { t: number; text: string }
export function youtubeCues(html: string): YoutubeCue[] {
  const raw = /<youtube-player[^>]*\bdata-cues="([^"]*)"/i.exec(html)?.[1]
  if (!raw) return []
  const decoded = raw.replaceAll('&quot;', '"').replaceAll('&#39;', "'").replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&')
  const values = jsonArray<unknown>(decoded)
  // Kotlin decodeFromString rejects the complete payload when a required cue field is invalid.
  if (!values.every(value => value && typeof value === 'object' && Number.isInteger((value as YoutubeCue).t) && typeof (value as YoutubeCue).text === 'string')) return []
  return values as YoutubeCue[]
}
export function activeYoutubeCue(cues: YoutubeCue[], time: number): number {
  if (time < 0) return -1
  let active = -1
  for (let index = 0; index < cues.length; index++) {if (cues[index].t <= time) active = index; else break}
  return active
}
export function cueTime(seconds: number) { const value = Math.max(0, seconds); const hours = Math.floor(value / 3600); const minutes = Math.floor((value % 3600) / 60); const rest = String(value % 60).padStart(2, '0'); return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}` }

export function subscriptionActive(rows: Record<string, unknown>[], now = Date.now()): boolean {
  return rows.some(row => parseSourceTimestamp(String(row.subscription_end_time ?? '')) > now)
}

export function sourceDisplayTime(value: string | null | undefined): string {
  const date = new Date(parseSourceTimestamp(value ?? ''))
  if (!Number.isFinite(date.getTime())) return ''
  const pad = (number: number) => String(number).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}
export function rssImageUrl(value: string): string | null {
  try {const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && url.searchParams.get('m') === 'rss' && Boolean(url.searchParams.get('d')) ? value : null} catch {return null}
}

/** Port of MarkdownHelper.kt; preserve the source's balanced parenthesis/link escaping. */
export function fixMarkdownLinks(markdown: string): string {
  let output = ''
  for (let index = 0; index < markdown.length;) {
    if (markdown[index] === '[') {
      const textEnd = markdown.indexOf(']', index + 1)
      if (textEnd >= 0 && markdown[textEnd + 1] === '(') {
        let depth = 0
        let end = textEnd + 2
        for (; end < markdown.length; end++) {
          if (markdown[end] === '(') depth++
          else if (markdown[end] === ')') { if (!depth) break; depth-- }
          else if (markdown[end] === '\\') end++
        }
        if (end < markdown.length) {
          const url = markdown.slice(textEnd + 2, end)
          const encoded = /%28|%29/.test(url) ? url : url.replace(/[()[\]{} ]/g, character => ({'(': '%28', ')': '%29', '[': '%5B', ']': '%5D', '{': '%7B', '}': '%7D', ' ': '%20'}[character]!))
          output += `[${markdown.slice(index + 1, textEnd)}](${encoded})`; index = end + 1; continue
        }
      }
    }
    output += markdown[index++]
  }
  return output
}
export class StreamMarkdownProcessor {
  private output = ''; private pending = ''; private length = 0
  process(fullContent: string) {
    if (fullContent.length <= this.length) return this.output
    this.pending += fullContent.slice(this.length); this.length = fullContent.length
    const bracket = this.pending.lastIndexOf('[')
    if (bracket < 0) { this.output += fixMarkdownLinks(this.pending); this.pending = '' }
    else if (bracket > 0) { this.output += fixMarkdownLinks(this.pending.slice(0, bracket)); this.pending = this.pending.slice(bracket) }
    return this.output
  }
  flush() { this.output += fixMarkdownLinks(this.pending); this.pending = ''; return this.output }
}
