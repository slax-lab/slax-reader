import { validatePdfSources } from '@slax-reader/contracts/pdf'
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

function readerSources(source: unknown[], html: (path: unknown) => boolean, documentId?: string): boolean {
  try {
    const firstPdf = source.find(path => object(path) && path.type === 'pdf')
    return validatePdfSources(source, documentId ?? (object(firstPdf) && string(firstPdf.document_id) ? firstPdf.document_id : undefined)) === undefined
      ? source.every(html) : true
  } catch { return false }
}

function comment(value: unknown, depth = 0): value is ReaderComment {
  if (!object(value) || depth > 32 || !integer(value.markId) || !integer(value.userId) || !string(value.comment) ||
      !string(value.username) || !string(value.avatar) || typeof value.isDeleted !== 'boolean' || !string(value.createdAt) ||
      !Array.isArray(value.children) || !value.children.every(child => comment(child, depth + 1))) return false
  if (value.reply != null && (!object(value.reply) || !integer(value.reply.id) || !integer(value.reply.userId) ||
      !string(value.reply.username) || !string(value.reply.avatar))) return false
  return value.rootId == null || integer(value.rootId)
}

export function parseReaderMark(value: unknown, documentId?: string): ReaderMarkItem | null {
  value = maybeJson(value)
  if (!object(value) || !string(value.id) || !Array.isArray(value.source) || !readerSources(value.source, htmlPath, documentId) ||
      !Array.isArray(value.stroke) || !value.stroke.every(stroke => object(stroke) && integer(stroke.userId) && (stroke.mark_id == null || integer(stroke.mark_id))) ||
      !Array.isArray(value.comments) || !value.comments.every(item => comment(item))) return null
  if (value.approx != null && (!object(value.approx) || !string(value.approx.exact) ||
      (value.approx.prefix !== undefined && !string(value.approx.prefix)) || (value.approx.suffix !== undefined && !string(value.approx.suffix)))) return null
  return value as unknown as ReaderMarkItem
}

export function parseReaderSelection(value: unknown, documentId?: string): ReaderSelection | null {
  value = maybeJson(value)
  if (value === null) return null
  if (!object(value) || !string(value.text) || !Array.isArray(value.source) || value.source.length === 0 ||
      !readerSources(value.source, path => object(path) && (path.type === 'text' || path.type === 'image') && string(path.xpath) &&
        integer(path.start_offset) && integer(path.end_offset) && path.start_offset >= 0 && path.end_offset >= path.start_offset, documentId) ||
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
      const marks = values.map(value => parseReaderMark(value))
      return marks.every((mark): mark is ReaderMarkItem => mark !== null) ? { type: 'markItemInfosChanged', marks } : null
    }
    case 'imageClick':
      return string(payload.src) && Array.isArray(payload.allImages) && payload.allImages.every(string)
        ? { type: 'imageClick', src: payload.src, allImages: payload.allImages,
            index: integer(payload.index) ? payload.index : payload.allImages.indexOf(payload.src) } : null
    case 'imageLongPress':
      return string(payload.src) && payload.src ? { type: 'imageLongPress', src: payload.src } : null
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
    default: return null
  }
}

export type ReaderNativeEvaluation = (script: string, pageId: string) => Promise<unknown>
export interface ReaderEvaluationHandle { evaluateJavaScript: ReaderNativeEvaluation }

function nativeResult(value: unknown, pageId: string, requestId: string): RecordValue {
  for (let depth = 0; string(value) && depth < 2; depth++) value = maybeJson(value)
  if (!object(value) || value.pageId !== pageId || value.requestId !== requestId ||
      !['pending', 'fulfilled', 'rejected'].includes(String(value.status))) throw new Error('Invalid native reader result')
  return value
}

export class ReaderBridgeSession {
  readonly pageId: string
  private evaluate: ReaderNativeEvaluation
  private timeoutMs: number
  private sequence = 0
  private ready = false
  private disposed = false
  private active = true

  setActive(active: boolean): void {
    if (this.disposed || active === this.active) return
    this.active = active
    if (!active) this.cancelPending(readerOperationCancelled())
  }

  invalidate(): void {
    this.dispose()
    this.ready = false
  }
  private pending = new Map<string, { reject(reason: Error): void; timer: ReturnType<typeof setTimeout>; poll?: ReturnType<typeof setTimeout> }>()

  constructor(pageId: string, evaluate: ReaderNativeEvaluation, timeoutMs = 10_000) {
    this.pageId = pageId
    this.evaluate = evaluate
    this.timeoutMs = timeoutMs
  }

  receive(message: string): ReaderEvent | null {
    if (this.disposed) return null
    const event = parseReaderMessage(message, this.pageId)
    if (event?.type === 'domReady') this.ready = true
    return event
  }

  request(command: ReaderCommand): Promise<unknown> {
    if (this.disposed) return Promise.reject(readerOperationCancelled('Reader page was released'))
    if (!this.active) return Promise.reject(readerOperationCancelled())
    if (!this.ready) return Promise.reject(new Error('Reader page is not ready'))
    const requestId = `${this.pageId}:${++this.sequence}`
    const identity = {pageId: this.pageId, requestId}
    const script = `window.__SlaxReaderHost && window.__SlaxReaderHost.execute(${scriptJson({...command, ...identity})});`
    return new Promise((resolve, reject) => {
      const finish = (error?: Error, value?: unknown) => {
        const pending = this.pending.get(requestId)
        if (!pending) return
        clearTimeout(pending.timer)
        clearTimeout(pending.poll)
        this.pending.delete(requestId)
        if (error) reject(error)
        else resolve(value)
      }
      const timer = setTimeout(() => finish(new Error('Reader command timed out')), this.timeoutMs)
      this.pending.set(requestId, {reject, timer})
      const evaluate = async (source: string) => {
        if (this.disposed || !this.pending.has(requestId)) return
        try {
          const raw = await this.evaluate(source, this.pageId)
          const pending = this.pending.get(requestId)
          if (!pending || this.disposed) return
          const result = nativeResult(raw, this.pageId, requestId)
          if (result.status === 'pending') {
            pending.poll = setTimeout(() => { void evaluate(`window.__SlaxReaderHost && window.__SlaxReaderHost.takeResult(${scriptJson(identity)});`) }, 16)
          } else if (result.status === 'rejected') finish(new Error('Reader command failed'))
          else finish(undefined, result.value)
        } catch (error) {
          finish(error instanceof Error ? error : new Error('Reader native evaluation failed'))
        }
      }
      void evaluate(script)
    })
  }

  private cancelPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      clearTimeout(pending.poll)
      pending.reject(error)
    }
    this.pending.clear()
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.cancelPending(readerOperationCancelled('Reader page was released'))
  }
}

export function readerOperationCancelled(message = 'Reader operation cancelled while inactive'): Error {
  const error = new Error(message)
  error.name = 'ReaderOperationCancelled'
  return error
}

export function isReaderOperationCancelled(error: unknown): boolean {
  return error !== null && typeof error === 'object' &&
    (('name' in error && error.name === 'ReaderOperationCancelled') || ('code' in error && error.code === 'E_READER_INACTIVE'))
}
