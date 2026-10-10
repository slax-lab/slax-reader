// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PDFDocumentProxy } from 'pdfjs-dist/types/src/display/api'
import type { PDFPageView, PDFPageViewOptions } from 'pdfjs-dist/types/web/pdf_page_view'
import type { EventBus } from 'pdfjs-dist/types/web/event_utils'
import { InlinePdfViewer } from '../../../../app/components/Article/Pdf/InlinePdfViewer'
import { placeSelectionMenu } from '../../../../app/components/Article/Pdf/selectionPosition'

describe('inline PDF reading', () => {
  let scrollY = 0
  let observerCallback: IntersectionObserverCallback
  let element: HTMLDivElement
  let viewer: InlinePdfViewer
  let events: ReturnType<typeof vi.fn>
  const observed: Element[] = []

  class PageView {
    id: number
    div = document.createElement('div')
    viewport: { width: number; height: number }
    pdfPage?: unknown
    scale = 1
    renderingState = 0
    constructor(options: PDFPageViewOptions) {
      this.id = options.id
      this.viewport = { width: 600, height: 900 }
      this.div.className = 'page'
      this.div.getBoundingClientRect = () => {
        const top = 200 + (this.id - 1) * (this.viewport.height + 20) - scrollY
        return { left: 0, top, right: this.viewport.width, bottom: top + this.viewport.height, width: this.viewport.width, height: this.viewport.height } as DOMRect
      }
      options.container!.appendChild(this.div)
      options.container!.scrollIntoView = () => { scrollY = 200 + (this.id - 1) * (this.viewport.height + 20) - 68 }
    }
    setPdfPage(page: unknown) { this.pdfPage = page }
    async draw() {
      this.renderingState = 3
      this.div.appendChild(document.createElement('canvas'))
      const text = document.createElement('div'); text.className = 'textLayer'; text.textContent = `Page ${this.id}`
      this.div.appendChild(text)
    }
    reset() { this.renderingState = 0; this.div.replaceChildren() }
    destroy() { this.reset() }
    update({ scale }: { scale: number }) { this.scale = scale; this.viewport = { width: 600 * scale, height: 900 * scale } }
  }

  const pdf = () => ({ numPages: 30, getPage: vi.fn(async () => ({ getViewport: () => ({ clone: () => ({}) }) })), getOptionalContentConfig: () => Promise.resolve({}) }) as unknown as PDFDocumentProxy
  const observePages = (numbers: number[]) => {
    observerCallback(observed.map(target => ({ target, isIntersecting: numbers.includes(Number((target as HTMLElement).dataset.pageNumber)) } as IntersectionObserverEntry)), {} as IntersectionObserver)
  }
  const settle = async () => { await vi.advanceTimersByTimeAsync(32) }

  beforeEach(() => {
    vi.useFakeTimers(); observed.length = 0; scrollY = 0
    vi.stubGlobal('IntersectionObserver', class {
      constructor(callback: IntersectionObserverCallback) { observerCallback = callback }
      observe(target: Element) { observed.push(target) }
      disconnect() {}
    })
    vi.spyOn(window, 'scrollBy').mockImplementation((_x, y) => { scrollY += Number(y) })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 })
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 })
    element = document.createElement('div'); document.body.appendChild(element)
    Object.defineProperty(element, 'clientWidth', { value: 600, configurable: true })
    events = vi.fn()
    viewer = new InlinePdfViewer({ element, eventBus: { dispatch: events } as unknown as EventBus, PageView: PageView as unknown as new (options: PDFPageViewOptions) => PDFPageView, maxCanvasPixels: 2_000_000, pageColors: { background: '#faf8f2', foreground: '#1a1814' } })
  })
  afterEach(() => { viewer.destroy(); element.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })

  it('releases distant canvas/text layers after a page jump and restores them on return', async () => {
    await viewer.setDocument(pdf()); observePages([1, 2]); await settle()
    expect(element.querySelector('.page canvas')).not.toBeNull()
    expect(element.querySelectorAll('.pdf-page-slot')).toHaveLength(30)
    viewer.currentPageNumber = 30; observePages([29, 30]); await settle()
    expect(viewer.currentPageNumber).toBe(30)
    expect(viewer.getPageView(0)!.div.querySelector('canvas')).toBeNull()
    expect(viewer.getPageView(29)!.div.querySelector('.textLayer')?.textContent).toBe('Page 30')
    viewer.currentPageNumber = 1; observePages([1, 2]); await settle()
    expect(viewer.getPageView(0)!.div.querySelectorAll('canvas')).toHaveLength(1)
    expect(viewer.getPageView(29)!.div.querySelector('canvas')).toBeNull()
  })

  it('bounds live canvases even when zoom exposes many nearby pages', async () => {
    await viewer.setDocument(pdf())
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 3200 })
    viewer.currentScale = 0.25; observePages(Array.from({ length: 30 }, (_, i) => i + 1)); await settle()
    expect(element.querySelectorAll('canvas').length).toBeGreaterThan(0)
    expect(element.querySelectorAll('canvas').length).toBeLessThanOrEqual(6)
  })

  it('keeps the current passage position when fitting a changed content width', async () => {
    await viewer.setDocument(pdf()); viewer.currentPageNumber = 5; observePages([4, 5, 6]); await settle()
    scrollY += 200
    const before = viewer.getPageView(4)!.div.getBoundingClientRect()
    Object.defineProperty(element, 'clientWidth', { value: 420, configurable: true })
    viewer.currentScaleValue = 'page-width'
    const after = viewer.getPageView(4)!.div.getBoundingClientRect()
    expect(after.top / after.height).toBeCloseTo(before.top / before.height)
    expect(viewer.currentScale).toBe(0.7)
    await settle()
    expect(viewer.getPageView(4)!.div.querySelectorAll('canvas')).toHaveLength(1)
  })

  it('redraws the themed paper without moving the passage and restores original colors', async () => {
    await viewer.setDocument(pdf()); observePages([1, 2]); await settle()
    const position = viewer.getPageView(0)!.div.getBoundingClientRect().top
    viewer.setPageColors({ background: '#141210', foreground: '#e8e2d8' }); await settle()
    expect(viewer.getPageView(0)!.div.parentElement!.style.getPropertyValue('--page-bg-color')).toBe('#141210')
    expect(viewer.getPageView(0)!.div.getBoundingClientRect().top).toBe(position)
    expect(viewer.getPageView(0)!.div.querySelectorAll('canvas')).toHaveLength(1)
    viewer.setPageColors({ background: '#ffffff', foreground: '#000000' }); await settle()
    expect(viewer.getPageView(0)!.div.parentElement!.style.getPropertyValue('--page-bg-color')).toBe('#ffffff')
  })

  it('does not attach a pending page after the reader is disposed', async () => {
    const document = pdf()
    let resolvePage!: (value: unknown) => void
    vi.mocked(document.getPage).mockImplementationOnce(() => new Promise(resolve => { resolvePage = resolve }) as never)
    const loading = viewer.setDocument(document)
    viewer.destroy()
    resolvePage({ getViewport: () => ({ clone: () => ({}) }) })
    await loading; await settle()
    expect(element.children).toHaveLength(0)
  })
})

describe('PDF selection action placement', () => {
  const menu = { width: 250, height: 52 }
  const viewport = { left: 12, top: 64, width: 296, height: 620 }
  it('stays close to a mouse release in the middle of a page', () => {
    expect(placeSelectionMenu({ x: 180, y: 350 }, menu, viewport)).toEqual({ x: 58, y: 286 })
  })
  it.each([{ x: 0, y: 0 }, { x: 320, y: 0 }, { x: 0, y: 800 }, { x: 320, y: 800 }])('clamps narrow-screen edge selections to the usable viewport: %o', anchor => {
    const position = placeSelectionMenu(anchor, menu, viewport)
    expect(position.x).toBeGreaterThanOrEqual(12)
    expect(position.x + menu.width).toBeLessThanOrEqual(308)
    expect(position.y).toBeGreaterThanOrEqual(64)
    expect(position.y + menu.height).toBeLessThanOrEqual(684)
  })
  it('places actions below a selection near the fixed header', () => {
    expect(placeSelectionMenu({ x: 100, y: 80 }, menu, viewport).y).toBe(92)
  })
  it('uses the keyboard visual viewport offset and reduced height', () => {
    const position = placeSelectionMenu({ x: 380, y: 590 }, menu, { left: 24, top: 220, width: 366, height: 280 })
    expect(position.x + menu.width).toBeLessThanOrEqual(390)
    expect(position.y + menu.height).toBeLessThanOrEqual(500)
  })
})
