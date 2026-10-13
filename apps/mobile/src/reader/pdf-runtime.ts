import type {PdfReaderEvent} from './pdf-types.ts'
import {pdfFailure} from './pdf-errors.ts'
import type {PdfFailureStage} from './pdf-errors.ts'
import {createPdfTransport} from './pdf/runtime/transport.ts'
import {createPdfPages} from './pdf/runtime/pages.ts'
import {createPdfMarks} from './pdf/runtime/marks.ts'
import {createPdfSelection} from './pdf/runtime/selection.ts'
import {isObject} from './pdf/runtime/types.ts'
import type {PdfRuntimeAssets, PdfRuntimeMessage, PdfRuntimeOptions, PdfRuntimePorts} from './pdf/runtime/types.ts'

const host = window as typeof window & {
  __SLAX_PDF_OPTIONS__: PdfRuntimeOptions
  __SLAX_PDF_ASSETS__: PdfRuntimeAssets
  __slaxPdfReceive?: (message: PdfRuntimeMessage) => void
  ReactNativeWebView?: {postMessage(value: string): void}
}
const options = host.__SLAX_PDF_OPTIONS__
const root = document.getElementById('pages')!
const status = document.getElementById('status')!
const lifecycle = {disposed: false, failed: false, active: true, generation: 0}
let documentReady = false
const ports: PdfRuntimePorts = {lifecycle, post, emit, error}
const transport = createPdfTransport(options, host.__SLAX_PDF_ASSETS__, ports)
const pages = createPdfPages(root, options, {...ports, clearSelection: () => selection.clear(), drawMarks: number => marks.drawPage(number)})
const marks = createPdfMarks(root, options, {emit, getPage: pages.getPage, pageNumbers: pages.pageNumbers})
const selection = createPdfSelection(root, options, {...ports, getViewport: number => pages.getPage(number)?.viewport, findMark: marks.find})

function post(message: object) {
  if (!lifecycle.disposed) host.ReactNativeWebView?.postMessage(JSON.stringify({channel: 'slax-pdf', pageId: options.pageId, ...message}))
}
function emit(event: PdfReaderEvent) {post({kind: 'event', event})}
function error(reason: unknown, stage: PdfFailureStage = 'render') {
  if (lifecycle.disposed || lifecycle.failed) return
  lifecycle.failed = true
  status.hidden = false
  status.textContent = options.labels.error
  status.setAttribute('role', 'alert')
  post({kind: 'error', ...pdfFailure(reason, stage)})
  transport.abort()
  pages.cancelRendering()
  transport.fail()
}
function setActive(value: boolean) {
  if (lifecycle.active === value || lifecycle.disposed || lifecycle.failed) return
  lifecycle.active = value
  lifecycle.generation++
  selection.suspend()
  pages.suspend()
  transport.restartRanges()
  if (lifecycle.active) {
    pages.schedule()
    if (documentReady) {pages.layout.publishHeight(true); emit({type: 'domReady'})}
  }
}
function teardown() {
  if (lifecycle.disposed) return
  transport.abort()
  lifecycle.disposed = true
  selection.dispose()
  pages.dispose()
  marks.dispose()
  transport.dispose()
  window.removeEventListener('pagehide', teardown)
  delete host.__slaxPdfReceive
}
host.__slaxPdfReceive = message => {
  if (lifecycle.disposed || !isObject(message) || message.channel !== 'slax-pdf' || message.pageId !== options.pageId) return
  if (message.kind === 'lifecycle' && typeof message.active === 'boolean') {setActive(message.active); return}
  if (message.kind === 'viewport' && options.hostViewport && typeof message.offset === 'number' && Number.isFinite(message.offset) && typeof message.height === 'number' && Number.isFinite(message.height) && message.height > 0) {
    pages.layout.setViewport(message.offset, message.height)
    return
  }
  if (!lifecycle.active && message.kind !== 'command') return
  if (message.kind === 'rangeChunk' || message.kind === 'rangeError') {transport.receive(message); return}
  if (message.kind !== 'command' || typeof message.id !== 'string' || !message.id || message.id.length > 80) return
  try {
    if (!lifecycle.active && !['position', 'teardown'].includes(message.operation ?? '')) throw new Error('PDF document is inactive')
    if (['clearSelection', 'captureSelection', 'position', 'teardown'].includes(message.operation ?? '') && message.argument !== undefined) throw new Error('Unexpected PDF command argument')
    let result: unknown = null
    switch (message.operation) {
      case 'clearSelection': selection.clear(); break
      case 'captureSelection': result = selection.capture(); break
      case 'drawMarks': marks.replace(message.argument); break
      case 'scrollToAnchor': {
        if (typeof message.argument !== 'string' || message.argument.length > 256) throw new Error('Invalid PDF anchor')
        const anchor = message.argument
        const match = /^(?:pdf:|page[=-]?|#page=)?(\d+)$/.exec(anchor)
        const source = marks.anchor(anchor)
        void (source ? pages.layout.revealMark(source) : pages.layout.scrollPage(Number(match?.[1] ?? 0))).then(result => post({kind: 'result', id: message.id, result}), () => post({kind: 'result', id: message.id, error: 'PDF_COMMAND_FAILED'}))
        return
      }
      case 'restore':
        void pages.layout.restore(message.argument, message.id, () => post({kind: 'result', id: message.id, result: null})).catch(() => post({kind: 'result', id: message.id, error: 'PDF_COMMAND_FAILED'}))
        return
      case 'position': pages.layout.position(); break
      case 'teardown': post({kind: 'result', id: message.id, result: null}); teardown(); return
      default: throw new Error('Unknown PDF command')
    }
    post({kind: 'result', id: message.id, result})
  } catch {post({kind: 'result', id: message.id, error: 'PDF command failed'})}
}
window.addEventListener('pagehide', teardown, {once: true})
async function start() {
  const pdf = await transport.start()
  if (lifecycle.disposed || lifecycle.failed) return
  await pages.initialize(pdf, () => {status.hidden = true}, () => {
    marks.rebuild()
    documentReady = true
    emit({type: 'domReady'})
  })
}
void start().catch(reason => error(reason, 'document'))
