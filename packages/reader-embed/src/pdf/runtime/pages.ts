import {TextLayer} from 'pdfjs-dist/legacy/build/pdf.mjs'
import type {PDFDocumentProxy} from 'pdfjs-dist/types/src/display/api'
import {createPdfLayout} from './layout.ts'
import type {PdfResidentPage, PdfRuntimeOptions, PdfRuntimePorts} from './types.ts'

interface PdfPagePorts {
  clearSelection(): void
  drawMarks(number: number): void
}
export function createPdfPages(root: HTMLElement, options: PdfRuntimeOptions, ports: PdfRuntimePorts & PdfPagePorts) {
  const {lifecycle, error} = ports
  let pdf: PDFDocumentProxy | null = null
  let renderEpoch = 0
  let rendering = false
  let positionFrame = 0
  let desired: number[] = []
  const resident = new Map<number, PdfResidentPage>()
  const layout = createPdfLayout(root, options, {...ports, getDocument: () => pdf, schedule})
  const gestureEvents = ['gesturestart', 'gesturechange', 'gestureend'] as const
  const gestureTarget = document as unknown as {
    addEventListener(type: string, listener: EventListener, options?: AddEventListenerOptions): void
    removeEventListener(type: string, listener: EventListener): void
  }
  let gestureStart = 1, gestureNext = 1, gesturing = false, gestureFrame = 0, gesturePreview = 1
  const clampZoom = (value: number) => Math.max(1, Math.min(3, value))
  function previewZoom(scale: number) {
    gesturePreview = scale
    if (gestureFrame) return
    gestureFrame = requestAnimationFrame(() => {
      gestureFrame = 0
      root.style.transform = `translate3d(0, 0, 0) scale(${gesturePreview / gestureStart})`
    })
  }
  function clearZoomPreview() {
    if (gestureFrame) cancelAnimationFrame(gestureFrame)
    gestureFrame = 0
    root.style.transform = ''; root.style.transformOrigin = ''; root.style.willChange = ''
  }
  // WebKit page zoom blanks large PDF canvases. Preview with a composited transform, then re-render at the new scale.
  const zoomGesture = (event: Event) => {
    const scale = (event as Event & {scale?: number}).scale
    if (event.type === 'gesturestart') {
      gesturing = true; gestureStart = layout.getZoom(); gestureNext = gestureStart
      root.style.transformOrigin = '0 0'; root.style.willChange = 'transform'; event.preventDefault(); return
    }
    if (!gesturing) return
    if (event.type === 'gesturechange' && typeof scale === 'number' && Number.isFinite(scale)) {
      gestureNext = clampZoom(gestureStart * scale)
      previewZoom(gestureNext)
      event.preventDefault(); return
    }
    if (event.type !== 'gestureend') return
    gesturing = false; clearZoomPreview()
    if (typeof scale === 'number' && Number.isFinite(scale)) gestureNext = clampZoom(gestureStart * scale)
    if (Math.abs(gestureNext - layout.getZoom()) >= 0.001) {
      layout.setZoom(gestureNext, () => {renderEpoch++; for (const number of resident.keys()) evict(number)})
      schedule()
    }
    event.preventDefault()
  }
  for (const name of gestureEvents) gestureTarget.addEventListener(name, zoomGesture, {passive: false})

  function evict(number: number) {
    const state = resident.get(number)
    if (!state) return
    resident.delete(number)
    const selection = window.getSelection()
    if (selection?.anchorNode && state.layer.contains(selection.anchorNode) || selection?.focusNode && state.layer.contains(selection.focusNode)) ports.clearSelection()
    state.render?.cancel()
    state.text?.cancel()
    state.canvas.width = 0
    state.canvas.height = 0
    layout.slots[number - 1]?.replaceChildren()
    void Promise.resolve(state.render?.promise).catch(() => {}).then(() => state.page?.cleanup())
  }
  async function renderPage(number: number) {
    if (!pdf || lifecycle.disposed || lifecycle.failed) return
    const epoch = renderEpoch
    const canvas = document.createElement('canvas')
    canvas.setAttribute('aria-hidden', 'true')
    const layer = document.createElement('div')
    layer.className = 'textLayer'
    const overlay = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    overlay.classList.add('marks')
    const state: PdfResidentPage = {canvas, layer, overlay, epoch}
    resident.set(number, state)
    const live = () => !lifecycle.disposed && !lifecycle.failed && resident.get(number) === state && epoch === renderEpoch
    try {
      const page = await pdf.getPage(number)
      state.page = page
      if (!live()) {page.cleanup(); return}
      const base = page.getViewport({scale: 1})
      const scale = layout.measurePage(number, base)
      const viewport = page.getViewport({scale})
      state.viewport = viewport
      const dpr = Math.min(devicePixelRatio || 1, 2, Math.sqrt(4_000_000 / (viewport.width * viewport.height)))
      canvas.width = Math.ceil(viewport.width * dpr)
      canvas.height = Math.ceil(viewport.height * dpr)
      canvas.style.width = `${viewport.width}px`
      canvas.style.height = `${viewport.height}px`
      layout.slots[number - 1]!.replaceChildren(canvas, layer, overlay)
      state.render = page.render({canvas, viewport, transform: [dpr, 0, 0, dpr, 0, 0]})
      await state.render.promise
      if (!live()) return
      state.text = new TextLayer({textContentSource: page.streamTextContent(), container: layer, viewport})
      await state.text.render()
      if (!live()) return
      ports.drawMarks(number)
      schedule()
    } catch (reason) {
      if (live() && (reason as Error)?.name !== 'RenderingCancelledException' && (reason as Error)?.name !== 'AbortException') error(reason)
    }
  }
  function schedule() {
    if (!pdf || lifecycle.disposed || lifecycle.failed || !lifecycle.active || !layout.slots.length || layout.height() <= 0) return
    const current = layout.visiblePage()
    const visible: number[] = []
    for (let number = current; number <= pdf.numPages && visible.length < 6; number++) {
      if (number > current && layout.slots[number - 1]!.offsetTop > layout.offset() + layout.height()) break
      visible.push(number)
    }
    desired = [...visible]
    for (let distance = 1; desired.length < Math.min(6, pdf.numPages); distance++) {
      for (const number of [current + distance, current - distance]) if (number >= 1 && number <= pdf.numPages && !desired.includes(number) && desired.length < 6) desired.push(number)
    }
    for (const number of resident.keys()) if (!desired.includes(number)) evict(number)
    if (rendering) return
    rendering = true
    void (async () => {
      try {
        while (!lifecycle.disposed && !lifecycle.failed && lifecycle.active) {
          const number = desired.find(number => !resident.has(number))
          if (!number) break
          await renderPage(number)
        }
      } finally {
        rendering = false
        if (!lifecycle.disposed && !lifecycle.failed && lifecycle.active && desired.some(number => !resident.has(number))) schedule()
      }
    })()
  }
  function resize() {
    if (!pdf || !layout.slots.length) return
    layout.resize(() => {
      renderEpoch++
      for (const number of resident.keys()) evict(number)
    })
  }
  function setPresentation(mode: 'single' | 'spread', paneWidth: number, gutter: number) {
    layout.setPresentation(mode, paneWidth, gutter, () => {
      renderEpoch++
      for (const number of resident.keys()) evict(number)
    })
  }
  function scroll() {
    if (!positionFrame) positionFrame = requestAnimationFrame(() => {positionFrame = 0; layout.position(); schedule()})
  }
  let lastWidth = document.documentElement.clientWidth
  const resizeObserver = new ResizeObserver(() => {
    const width = document.documentElement.clientWidth
    if (width !== lastWidth) {lastWidth = width; resize()}
  })
  resizeObserver.observe(document.documentElement)
  window.addEventListener('scroll', scroll, {passive: true})

  async function initialize(document: PDFDocumentProxy, mounted: () => void, ready: () => void) {
    pdf = document
    if (pdf.numPages > 100_000) throw new Error('PDF has too many pages')
    const first = await pdf.getPage(1)
    const viewport = first.getViewport({scale: 1})
    first.cleanup()
    layout.initialize(viewport, pdf.numPages)
    mounted()
    layout.publishHeight()
    if (!options.hostViewport) await layout.restoreInitial(pdf.numPages)
    schedule()
    ready()
  }
  function suspend() {
    cancelAnimationFrame(positionFrame)
    positionFrame = 0
  }
  function cancelRendering() {
    for (const value of resident.values()) {value.render?.cancel(); value.text?.cancel()}
  }
  function dispose() {
    suspend()
    resizeObserver.disconnect()
    window.removeEventListener('scroll', scroll)
    for (const name of gestureEvents) gestureTarget.removeEventListener(name, zoomGesture)
    for (const number of resident.keys()) evict(number)
  }
  return {layout, initialize, schedule, setPresentation, suspend, cancelRendering, dispose,
    getPage: (number: number) => resident.get(number), pageNumbers: () => resident.keys()}
}
