import type { PDFDocumentProxy } from 'pdfjs-dist/types/src/display/api'
import type { PDFPageView, PDFPageViewOptions } from 'pdfjs-dist/types/web/pdf_page_view'
import type { EventBus } from 'pdfjs-dist/types/web/event_utils'

const PDF_TO_CSS = 96 / 72
const MAX_LIVE_PAGES = 6

/** Use supported upstream page views in the detail page's normal scroll flow. */
export class InlinePdfViewer {
  pdfDocument: PDFDocumentProxy | null = null
  private views: PDFPageView[] = []
  private nearby = new Set<number>()
  private retained = new Set<number>()
  private desired = new Set<number>()
  private failed = new Set<number>()
  private observer?: IntersectionObserver
  private frame = 0
  private rendering = false
  private generation = 0
  private page = 1
  private scale = 1

  constructor(private options: {
    element: HTMLDivElement
    eventBus: EventBus
    PageView: new (options: PDFPageViewOptions) => PDFPageView
    maxCanvasPixels: number
    pageColors: { background: string; foreground: string }
  }) {
    window.addEventListener('scroll', this.schedule, { passive: true })
    window.addEventListener('resize', this.schedule, { passive: true })
  }

  getPageView(index: number) { return this.views[index] }
  get currentPageNumber() { return this.page }
  set currentPageNumber(number: number) {
    const view = this.views[number - 1]
    if (!view) return
    this.setPage(number)
    this.nearby.add(number)
    view.div.parentElement?.scrollIntoView({ block: 'start', inline: 'nearest' })
    this.schedule()
  }
  get currentScale() { return this.scale }
  set currentScale(value: number) { this.setScale(value) }
  set currentScaleValue(value: string) {
    if (value !== 'page-width' || !this.views.length) return
    const view = this.views[this.page - 1]!
    const widthAtScaleOne = view.viewport.width / this.scale
    this.setScale(this.options.element.clientWidth / widthAtScaleOne)
  }

  async setDocument(document: PDFDocumentProxy | null) {
    const generation = ++this.generation
    this.observer?.disconnect()
    cancelAnimationFrame(this.frame); this.frame = 0
    for (const view of this.views) view.destroy()
    this.views = []; this.nearby.clear(); this.retained.clear(); this.desired.clear(); this.failed.clear()
    this.options.element.replaceChildren()
    this.pdfDocument = document
    if (!document) return
    const firstPage = await document.getPage(1)
    if (generation !== this.generation) return
    this.page = 1; this.scale = 1
    const viewport = firstPage.getViewport({ scale: PDF_TO_CSS })
    const optionalContentConfigPromise = document.getOptionalContentConfig()
    const fragment = window.document.createDocumentFragment()
    for (let number = 1; number <= document.numPages; number++) {
      const slot = window.document.createElement('div')
      slot.className = 'pdf-page-slot'
      slot.dataset.pageNumber = String(number)
      const view = new this.options.PageView({
        container: slot, id: number, eventBus: this.options.eventBus,
        defaultViewport: viewport.clone(), scale: this.scale, optionalContentConfigPromise,
        maxCanvasPixels: this.options.maxCanvasPixels, maxCanvasDim: 4096,
        annotationMode: 0, textLayerMode: 1, enableDetailCanvas: false,
        enableSelectionRendering: false, enableAutoLinking: false, pageColors: this.options.pageColors
      })
      if (number === 1) view.setPdfPage(firstPage)
      this.views.push(view); fragment.append(slot)
    }
    this.options.element.appendChild(fragment)
    this.observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        const number = Number((entry.target as HTMLElement).dataset.pageNumber)
        if (entry.isIntersecting) this.nearby.add(number)
        else this.nearby.delete(number)
      }
      this.schedule()
    }, { rootMargin: '800px 0px' })
    for (const view of this.views) this.observer.observe(view.div.parentElement!)
    this.nearby.add(1)
    this.options.eventBus.dispatch('pagesinit', { source: this })
    this.schedule()
  }

  private setPage(number: number) {
    if (this.page === number) return
    this.page = number
    this.options.eventBus.dispatch('pagechanging', { source: this, pageNumber: number })
  }

  setPageColors(colors: { background: string; foreground: string }) {
    if (colors.background === this.options.pageColors.background && colors.foreground === this.options.pageColors.foreground) return
    Object.assign(this.options.pageColors, colors)
    this.failed.clear()
    for (const view of this.views) {
      view.div.parentElement?.style.setProperty('--page-bg-color', colors.background)
      view.destroy()
    }
    this.schedule()
  }

  private setScale(value: number) {
    const scale = Math.min(3, Math.max(0.25, value))
    if (!this.views.length || Math.abs(scale - this.scale) < 0.001) return
    const anchor = this.views[this.page - 1]!
    const before = anchor.div.getBoundingClientRect()
    const relativeTop = before.top / before.height
    const preservePassage = before.bottom > 0 && before.top < window.innerHeight
    this.scale = scale; this.failed.clear()
    for (const view of this.views) {
      // Reset cancels native canvas/text rendering before applying a new scale.
      view.reset(); view.update({ scale })
    }
    if (preservePassage) {
      const after = anchor.div.getBoundingClientRect()
      window.scrollBy(0, after.top - relativeTop * after.height)
    }
    this.options.eventBus.dispatch('scalechanging', { source: this, scale })
    this.schedule()
  }

  private schedule = () => {
    if (!this.frame) this.frame = requestAnimationFrame(() => { this.frame = 0; this.update() })
  }

  private update() {
    if (!this.pdfDocument) return
    const selection = window.getSelection()
    const range = selection && !selection.isCollapsed && selection.rangeCount ? selection.getRangeAt(0) : undefined
    const header = window.innerWidth <= 768 ? 64 : 68
    const candidates = [...this.nearby].map(number => {
      const view = this.views[number - 1]!
      const rect = view.div.getBoundingClientRect()
      const visible = Math.max(0, Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, header))
      const selected = !!range && range.intersectsNode(view.div)
      return { number, rect, visible, selected }
    }).filter(item => item.selected || item.rect.bottom > -800 && item.rect.top < window.innerHeight + 800)
    const visible = candidates.filter(item => item.visible > 0).sort((a, b) => b.visible - a.visible)
    if (visible[0]) this.setPage(visible[0].number)
    candidates.sort((a, b) => Number(b.selected) - Number(a.selected) || b.visible - a.visible || Math.abs(a.rect.top - header) - Math.abs(b.rect.top - header))
    this.desired = new Set(candidates.slice(0, MAX_LIVE_PAGES).map(item => item.number))
    for (const number of this.retained) if (!this.desired.has(number)) {
      this.views[number - 1]!.destroy()
      this.retained.delete(number)
    }
    void this.renderNext()
  }

  private async renderNext() {
    if (this.rendering || !this.pdfDocument) return
    this.rendering = true
    const generation = this.generation
    try {
      for (const number of this.desired) {
        if (generation !== this.generation || !this.pdfDocument) break
        const view = this.views[number - 1]!
        if (view.renderingState !== 0 || this.failed.has(number)) continue
        try {
          const page = view.pdfPage ?? await this.pdfDocument.getPage(number)
          if (generation !== this.generation) break
          if (!this.desired.has(number)) continue
          if (!view.pdfPage) view.setPdfPage(page)
          this.retained.add(number)
          await view.draw()
        } catch (error) {
          if ((error as Error).name !== 'RenderingCancelledException' && generation === this.generation) {
            this.failed.add(number)
            this.options.eventBus.dispatch('pageerror', { source: this, pageNumber: number })
          }
        }
      }
    } finally {
      this.rendering = false
      // A jump/resize may have replaced the queue while an earlier page was drawing.
      if ([...this.desired].some(number => this.views[number - 1]?.renderingState === 0 && !this.failed.has(number))) this.schedule()
    }
  }

  destroy() {
    void this.setDocument(null)
    window.removeEventListener('scroll', this.schedule)
    window.removeEventListener('resize', this.schedule)
  }
}
