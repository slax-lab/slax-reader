import {getDocument, PDFDataRangeTransport, PDFWorker} from 'pdfjs-dist/legacy/build/pdf.mjs'
import type {PDFDocumentLoadingTask} from 'pdfjs-dist/types/src/display/api'
import {PDF_BRIDGE_CHUNK_BYTES} from '../../pdf-types.ts'
import type {PdfRuntimeAssets, PdfRuntimeMessage, PdfRuntimeOptions, PdfRuntimePorts} from './types.ts'

const decode = (value: string) => Uint8Array.from(atob(value), character => character.charCodeAt(0))

export function createPdfTransport(options: PdfRuntimeOptions, assets: PdfRuntimeAssets, ports: PdfRuntimePorts) {
  const {lifecycle, post, error} = ports
  let sequence = 0
  let loading: PDFDocumentLoadingTask | null = null
  let worker: Worker | null = null
  let pdfWorker: PDFWorker | null = null
  let workerUrl: string | null = null
  const pending = new Map<string, {begin: number; end: number; bytes: Uint8Array; received: number; timer?: ReturnType<typeof setTimeout>}>()

  class LocalBinaryDataFactory {
    async fetch({kind, filename}: {kind: string; filename: string}) {
      const directory = {cMapUrl: 'cmaps', standardFontDataUrl: 'standard_fonts', wasmUrl: 'wasm'}[kind]
      const key = `${directory}/${filename}`
      if (!directory || !Object.hasOwn(assets.resources, key)) throw new Error('Unknown local PDF resource')
      return decode(assets.resources[key]!)
    }
  }
  class NativeRangeTransport extends PDFDataRangeTransport {
    requestDataRange(begin: number, end: number) {
      if (lifecycle.disposed || lifecycle.failed) return
      if (!Number.isSafeInteger(begin) || !Number.isSafeInteger(end) || begin < 0 || end <= begin || end > options.descriptor.size || pending.size >= 128) return error(new Error('Invalid PDF byte range'))
      const outstandingBytes = Array.from(pending.values()).reduce((total, value) => total + value.bytes.length, 0)
      if (outstandingBytes + end - begin > options.descriptor.size) return error(new Error('PDF byte range memory budget exceeded'))
      const id = `range-${++sequence}`
      pending.set(id, {begin, end, received: 0, bytes: new Uint8Array(end - begin)})
      if (lifecycle.active) post({kind: 'range', id, begin, end})
    }
    abort() {
      for (const [id, value] of pending) {clearTimeout(value.timer); post({kind: 'cancelRange', id})}
      pending.clear()
    }
  }
  const range = new NativeRangeTransport(options.descriptor.size, new Uint8Array(), true, options.descriptor.filename)

  function restartRanges() {
    const waiting = Array.from(pending.values())
    range.abort()
    for (const request of waiting) range.requestDataRange(request.begin, request.end)
  }
  function receive(message: PdfRuntimeMessage) {
    if (message.kind === 'rangeChunk') {
      const request = message.id && pending.get(message.id)
      if (!request) return
      try {
        if (typeof message.data !== 'string' || message.data.length > Math.ceil(PDF_BRIDGE_CHUNK_BYTES / 3) * 4 || message.offset !== request.begin + request.received) throw new Error('Invalid PDF range response')
        const chunk = decode(message.data)
        if (!chunk.length || chunk.byteLength > PDF_BRIDGE_CHUNK_BYTES || chunk.length + request.received > request.bytes.length) throw new Error('Invalid PDF range response')
        request.bytes.set(chunk, request.received)
        request.received += chunk.length
        post({kind: 'rangeAck', id: message.id, offset: request.begin + request.received})
        if (request.received === request.bytes.length) {
          clearTimeout(request.timer)
          pending.delete(message.id!)
          range.onDataRange(request.begin, request.bytes)
        }
      } catch (reason) {error(reason)}
      return
    }
    if (message.kind === 'rangeError' && message.id && pending.has(message.id)) error(message.failure ?? {code: 'PDF_RANGE_FAILED'}, 'range')
  }
  function start() {
    if (!('Worker' in window)) throw {code: 'PDF_WORKER_UNAVAILABLE', stage: 'worker'}
    workerUrl = URL.createObjectURL(new Blob([assets.worker], {type: 'text/javascript'}))
    try {worker = new Worker(workerUrl, {type: 'module', name: `slax-pdf-${options.pageId}`})}
    catch {throw {code: 'PDF_WORKER_UNAVAILABLE', stage: 'worker'}}
    worker.addEventListener('error', () => error({code: 'PDF_WORKER_FAILED'}, 'worker'))
    pdfWorker = new PDFWorker({port: worker} as unknown as ConstructorParameters<typeof PDFWorker>[0])
    loading = getDocument({range, rangeChunkSize: PDF_BRIDGE_CHUNK_BYTES,
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
  return {start, receive, restartRanges, abort: () => range.abort(), fail, dispose}
}
