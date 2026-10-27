import {getDocument, PDFDataRangeTransport, PDFWorker} from 'pdfjs-dist/legacy/build/pdf.mjs'
import type {PDFDocumentLoadingTask} from 'pdfjs-dist/types/src/display/api'
import {PDF_RANGE_CHUNK_BYTES, PDF_RANGE_WINDOW_BYTES} from '../../pdf-types.ts'
import type {PdfRuntimeAssets, PdfRuntimeOptions, PdfRuntimePorts} from './types.ts'

type PendingRange = {begin: number; end: number; controller: AbortController; ids: string[]}
const decode = (value: string) => Uint8Array.from(atob(value), character => character.charCodeAt(0))

export function createPdfTransport(options: PdfRuntimeOptions, assets: PdfRuntimeAssets, ports: PdfRuntimePorts) {
  const {lifecycle, error} = ports
  let sequence = 0
  let loading: PDFDocumentLoadingTask | null = null
  let worker: Worker | null = null
  let pdfWorker: PDFWorker | null = null
  let workerUrl: string | null = null
  const pending = new Map<string, PendingRange>()
  // Android WebView applies a request `Range` to intercepted responses itself (it skips into the returned stream); its native
  // server reads the same value from a header WebView leaves alone.
  const rangeHeader = options.platform === 'android' ? 'X-Slax-Range' : 'Range'

  class LocalBinaryDataFactory {
    async fetch({kind, filename}: {kind: string; filename: string}) {
      const directory = {cMapUrl: 'cmaps', standardFontDataUrl: 'standard_fonts', wasmUrl: 'wasm'}[kind]
      const key = `${directory}/${filename}`
      if (!directory || !Object.hasOwn(assets.resources, key)) throw new Error('Unknown local PDF resource')
      return decode(assets.resources[key]!)
    }
  }
  /** Byte ranges are fetched by the page from its own origin; the native host serves them without crossing the app's JavaScript bridge. */
  class NativeRangeTransport extends PDFDataRangeTransport {
    requestDataRange(begin: number, end: number) {
      if (lifecycle.disposed || lifecycle.failed) return
      if (!Number.isSafeInteger(begin) || !Number.isSafeInteger(end) || begin < 0 || end <= begin || end > options.descriptor.size || pending.size >= 128) return error(new Error('Invalid PDF byte range'))
      const outstandingBytes = Array.from(pending.values()).reduce((total, value) => total + value.end - value.begin, 0)
      if (outstandingBytes + end - begin > options.descriptor.size) return error(new Error('PDF byte range memory budget exceeded'))
      const id = `${options.pageId}-${++sequence}`
      const request = {begin, end, controller: new AbortController(), ids: [] as string[]}
      pending.set(id, request)
      if (lifecycle.active) void load(id, request)
    }
    abort() {
      const active = Array.from(pending.values())
      pending.clear()
      for (const request of active) cancel(request)
    }
  }
  const range = new NativeRangeTransport(options.descriptor.size, new Uint8Array(), true, options.descriptor.filename)

  function cancel(request: PendingRange) {
    if (request.controller.signal.aborted) return
    request.controller.abort()
    for (const id of request.ids) void fetch(`/pdf-cancel/${id}`, {method: 'POST', cache: 'no-store'}).catch(() => {})
  }
  const pause = (milliseconds: number, signal: AbortSignal) => new Promise<void>(resolve => {
    const timer = setTimeout(resolve, milliseconds)
    signal.addEventListener('abort', () => {clearTimeout(timer); resolve()}, {once: true})
  })
  async function fetchWindow(request: PendingRange, begin: number, end: number, id: string) {
    request.ids.push(id)
    let response: Response
    // A native engine pause (true app background) cancels in-flight reads; they resume instead of failing the document.
    for (let attempt = 0; ; attempt++) {
      response = await fetch(`${options.source}?request=${encodeURIComponent(id)}`, {headers: {[rangeHeader]: `bytes=${begin}-${end - 1}`}, cache: 'no-store', signal: request.controller.signal})
      if (response.status === 206) break
      let failure: {code?: unknown; status?: unknown} = {}
      try {failure = await response.json()} catch {}
      if (failure.code !== 'operation_cancelled' || request.controller.signal.aborted) {
        throw {code: typeof failure.code === 'string' ? failure.code : 'PDF_RANGE_FAILED', status: typeof failure.status === 'number' ? failure.status : undefined, stage: 'pdf-range'}
      }
      await pause(Math.min(2000, 250 * 2 ** attempt), request.controller.signal)
      request.controller.signal.throwIfAborted()
    }
    if (response.headers.get('Content-Range') !== `bytes ${begin}-${end - 1}/${options.descriptor.size}`) throw {code: 'pdf_range_invalid', stage: 'pdf-range'}
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.byteLength !== end - begin) throw {code: 'pdf_length_invalid', stage: 'pdf-range'}
    return bytes
  }
  async function load(id: string, request: PendingRange) {
    try {
      const windows: Promise<Uint8Array>[] = []
      for (let offset = request.begin, index = 0; offset < request.end; offset += PDF_RANGE_WINDOW_BYTES, index++) windows.push(fetchWindow(request, offset, Math.min(request.end, offset + PDF_RANGE_WINDOW_BYTES), `${id}-${index}`))
      const parts = await Promise.all(windows)
      if (pending.get(id) !== request || lifecycle.disposed || lifecycle.failed) return
      pending.delete(id)
      const bytes = parts.length === 1 ? parts[0]! : new Uint8Array(request.end - request.begin)
      if (parts.length > 1) parts.reduce((offset, part) => {bytes.set(part, offset); return offset + part.byteLength}, 0)
      range.onDataRange(request.begin, bytes)
    } catch (reason) {
      if (request.controller.signal.aborted || pending.get(id) !== request) return
      cancel(request)
      error(reason, 'range')
    }
  }
  function restartRanges() {
    const waiting = Array.from(pending.values())
    range.abort()
    for (const request of waiting) range.requestDataRange(request.begin, request.end)
  }
  function start() {
    if (!('Worker' in window)) throw {code: 'PDF_WORKER_UNAVAILABLE', stage: 'worker'}
    workerUrl = URL.createObjectURL(new Blob([assets.worker], {type: 'text/javascript'}))
    try {worker = new Worker(workerUrl, {type: 'module', name: `slax-pdf-${options.pageId}`})}
    catch {throw {code: 'PDF_WORKER_UNAVAILABLE', stage: 'worker'}}
    worker.addEventListener('error', () => error({code: 'PDF_WORKER_FAILED'}, 'worker'))
    pdfWorker = new PDFWorker({port: worker} as unknown as ConstructorParameters<typeof PDFWorker>[0])
    loading = getDocument({range, rangeChunkSize: PDF_RANGE_CHUNK_BYTES,
      disableAutoFetch: true, disableStream: true, worker: pdfWorker, useWorkerFetch: false,
      BinaryDataFactory: LocalBinaryDataFactory, cMapUrl: 'slax-pdf-resource:cmaps/', cMapPacked: true,
      standardFontDataUrl: 'slax-pdf-resource:standard_fonts/', wasmUrl: 'slax-pdf-resource:wasm/', iccUrl: 'slax-pdf-resource:iccs/',
      enableXfa: false, useSystemFonts: false, isImageDecoderSupported: false,
    })
    return loading.promise
  }
  function fail() {
    void loading?.destroy().catch(() => {})
    worker?.terminate()
  }
  function dispose() {
    void loading?.destroy().catch(() => {})
    pdfWorker?.destroy()
    worker?.terminate()
    if (workerUrl) URL.revokeObjectURL(workerUrl)
  }
  return {start, restartRanges, abort: () => range.abort(), fail, dispose}
}
