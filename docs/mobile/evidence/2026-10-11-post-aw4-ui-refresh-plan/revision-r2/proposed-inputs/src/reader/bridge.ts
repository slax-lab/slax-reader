import { scriptJson } from './document.ts'
import {parseReaderInputSnapshot} from './input.ts'
import type { HtmlMarkPath, ReaderCommand, ReaderComment, ReaderEvent, ReaderMarkItem, ReaderSelection, SelectionGeometry } from './types.ts'

type RecordValue = Record<string, unknown>
const object = (value: unknown): value is RecordValue => value !== null && typeof value === 'object' && !Array.isArray(value)
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const integer = (value: unknown): value is number => finite(value) && Number.isSafeInteger(value)
const string = (value: unknown): value is string => typeof value === 'string'
const maybeJson = (value: unknown): unknown => {
  if (!string(value)) return value
  try { return JSON.parse(value) } catch { return undefined }
}

function htmlPath(value: unknown): value is HtmlMarkPath {
  if (!object(value) || !string(value.path)) return false
  return value.type === 'image' || (value.type === 'text' && integer(value.start) && integer(value.end) && value.start >= 0 && value.end >= value.start)
}

function comment(value: unknown, depth = 0): value is ReaderComment {
  if (!object(value) || depth > 32 || !integer(value.markId) || !integer(value.userId) || !string(value.comment) ||
      !string(value.username) || !string(value.avatar) || typeof value.isDeleted !== 'boolean' || !string(value.createdAt) ||
      !Array.isArray(value.children) || !value.children.every(child => comment(child, depth + 1))) return false
  if (value.reply != null && (!object(value.reply) || !integer(value.reply.id) || !integer(value.reply.userId) ||
      !string(value.reply.username) || !string(value.reply.avatar))) return false
  return value.rootId == null || integer(value.rootId)
}

export function parseReaderMark(value: unknown): ReaderMarkItem | null {
  value = maybeJson(value)
  if (!object(value) || !string(value.id) || !Array.isArray(value.source) || !value.source.every(htmlPath) ||
      !Array.isArray(value.stroke) || !value.stroke.every(stroke => object(stroke) && integer(stroke.userId) && (stroke.mark_id == null || integer(stroke.mark_id))) ||
      !Array.isArray(value.comments) || !value.comments.every(item => comment(item))) return null
  if (value.approx != null && (!object(value.approx) || !string(value.approx.exact) ||
      (value.approx.prefix !== undefined && !string(value.approx.prefix)) || (value.approx.suffix !== undefined && !string(value.approx.suffix)))) return null
  return value as unknown as ReaderMarkItem
}

export function parseReaderSelection(value: unknown): ReaderSelection | null {
  value = maybeJson(value)
  if (value === null) return null
  if (!object(value) || !string(value.text) || !Array.isArray(value.source) || value.source.length === 0 ||
      !value.source.every(path => object(path) && (path.type === 'text' || path.type === 'image') && string(path.xpath) &&
        integer(path.start_offset) && integer(path.end_offset) && path.start_offset >= 0 && path.end_offset >= path.start_offset) ||
      !Array.isArray(value.select_content) || !value.select_content.every(content => object(content) &&
        (content.type === 'text' || content.type === 'image') && string(content.text) && string(content.src)) ||
      !object(value.approx_source) || !string(value.approx_source.exact) || !string(value.approx_source.prefix) ||
      !string(value.approx_source.suffix) || !integer(value.approx_source.position_start) || !integer(value.approx_source.position_end) ||
      value.approx_source.position_start < 0 || value.approx_source.position_end < value.approx_source.position_start) {
    throw new Error('Invalid selection result from the reader document')
  }
  return value as unknown as ReaderSelection
}

function selectionGeometry(value: unknown): SelectionGeometry | undefined {
  if (!object(value) || !['touchClientY', 'top', 'bottom'].every(key => value[key] === null || finite(value[key]))) return undefined
  return value as unknown as SelectionGeometry
}

/** Reject wrong/stale pages and malformed events before exposing them to application state. */
export function parseReaderMessage(message: string, pageId: string): ReaderEvent | null {
  if (message.length > 8 * 1024 * 1024) return null
  const envelope = maybeJson(message)
  if (!object(envelope) || envelope.channel !== 'slax-reader' || envelope.pageId !== pageId || !object(envelope.payload)) return null
  const payload = envelope.payload
  switch (payload.type) {
    case 'inputObservation': {
      const snapshot = parseReaderInputSnapshot(payload.snapshot)
      return snapshot ? {type: 'inputObservation', snapshot} : null
    }
    case 'domReady': case 'requestInfoPack': case 'tap': case 'textDeselected': case 'scrollToTop': case 'refreshContent': case 'feedback':
      return { type: payload.type }
    case 'textSelected': {
      const mark = parseReaderMark(payload.data)
      const text = string(payload.text) ? payload.text : mark?.approx?.raw_text ?? mark?.approx?.exact
      return mark && string(text) && text.trim() ? { type: 'textSelected', text, mark, selectionGeometry: selectionGeometry(payload.selectionGeometry) } : null
    }
    case 'markClicked':
      return string(payload.markId) && payload.markId ? { type: 'markClicked', markId: payload.markId,
        text: string(payload.text) ? payload.text : '', mark: parseReaderMark(payload.data) } : null
    case 'markItemInfosChanged': {
      const values = maybeJson(payload.markItemInfos)
      if (!Array.isArray(values)) return null
      const marks = values.map(parseReaderMark)
      return marks.every((mark): mark is ReaderMarkItem => mark !== null) ? { type: 'markItemInfosChanged', marks } : null
    }
    case 'imageClick':
      return string(payload.src) && Array.isArray(payload.allImages) && payload.allImages.every(string)
        ? { type: 'imageClick', src: payload.src, allImages: payload.allImages,
            index: integer(payload.index) ? payload.index : payload.allImages.indexOf(payload.src) } : null
    case 'scrollToPosition':
      return finite(payload.percentage) && payload.percentage >= 0 && payload.percentage <= 1
        ? { type: 'scrollToPosition', percentage: payload.percentage } : null
    case 'contentHeight':
      return finite(payload.height) && payload.height >= 0 ? { type: 'contentHeight', height: payload.height } : null
    case 'documentScroll':
      return finite(payload.scrollY) && finite(payload.contentHeight) && payload.contentHeight >= 0 && finite(payload.viewportHeight) && payload.viewportHeight >= 0
        ? { type: 'documentScroll', scrollY: payload.scrollY, contentHeight: payload.contentHeight, viewportHeight: payload.viewportHeight } : null
    case 'selectionError':
      return { type: 'selectionError', error: 'The reader could not resolve the requested selection' }
    case 'commandResult':
      return string(payload.requestId) && (payload.error === undefined || string(payload.error))
        ? { type: 'commandResult', requestId: payload.requestId, value: payload.value, error: payload.error as string | undefined } : null
    default: return null
  }
}

export class ReaderBridgeSession {
  readonly pageId: string
  private inject: (script: string) => void
  private timeoutMs: number
  private sequence = 0
  private ready = false
  private disposed = false
  private pending = new Map<string, { resolve(value: unknown): void; reject(reason: Error): void; timer: ReturnType<typeof setTimeout> }>()

  constructor(pageId: string, inject: (script: string) => void, timeoutMs = 10_000) {
    this.pageId = pageId
    this.inject = inject
    this.timeoutMs = timeoutMs
  }

  receive(message: string): ReaderEvent | null {
    if (this.disposed) return null
    const event = parseReaderMessage(message, this.pageId)
    if (event?.type === 'domReady') this.ready = true
    if (event?.type === 'commandResult') {
      const pending = this.pending.get(event.requestId)
      if (pending) {
        clearTimeout(pending.timer)
        this.pending.delete(event.requestId)
        if (event.error) pending.reject(new Error(event.error))
        else pending.resolve(event.value)
      }
    }
    return event
  }

  request(command: ReaderCommand): Promise<unknown> {
    if (this.disposed || !this.ready) return Promise.reject(new Error(this.disposed ? 'Reader page was released' : 'Reader page is not ready'))
    const requestId = `${this.pageId}:${++this.sequence}`
    const script = `window.__SlaxReaderHost && window.__SlaxReaderHost.execute(${scriptJson({ ...command, pageId: this.pageId, requestId })}); true;`
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId)
        reject(new Error('Reader command timed out'))
      }, this.timeoutMs)
      this.pending.set(requestId, { resolve, reject, timer })
      try { this.inject(script) } catch {
        clearTimeout(timer)
        this.pending.delete(requestId)
        reject(new Error('Reader native view is unavailable'))
      }
    })
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(new Error('Reader page was released'))
    }
    this.pending.clear()
  }
}
