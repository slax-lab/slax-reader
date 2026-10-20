import type {PDFDocumentProxy} from 'pdfjs-dist/types/src/display/api'
import type {PdfMarkSource} from '@slax-reader/contracts/pdf'
import {quadToViewport} from '../../pdf-geometry.ts'
import type {PageViewport, PdfRuntimeOptions, PdfRuntimePorts} from './types.ts'

interface PdfLayoutPorts {
  getDocument(): PDFDocumentProxy | null
  schedule(): void
}
export function createPdfLayout(root: HTMLElement, options: PdfRuntimeOptions, ports: Pick<PdfRuntimePorts, 'lifecycle' | 'post'> & PdfLayoutPorts) {
  const {lifecycle, post} = ports
  let hostOffset = 0
  let hostHeight = 0
  let heightPublished = 0
  let restored = false
  let restoreSequence = 0
  let presentationSequence = 0
  let presentationFrame = 0
  let presentation: 'single' | 'spread' = 'single'
  let spreadPaneWidth = 0
  let spreadGutter = 12
  const slots: HTMLElement[] = []
  const dimensions = new Map<number, {width: number; height: number}>()
  const offset = () => options.hostViewport ? hostOffset : scrollY
  const height = () => options.hostViewport ? hostHeight : innerHeight

  function publishHeight(force = false) {
    const last = slots[slots.length - 1]
    const value = last ? rowTop(slots.length) + rowHeight(slots.length) + 20 : root.offsetHeight
    if (value > 0 && (force || value !== heightPublished)) {heightPublished = value; post({kind: 'documentHeight', height: value})}
  }
  function rowFirst(number: number) {return presentation === 'spread' ? Math.floor((number - 1) / 2) * 2 + 1 : number}
  function rowEnd(number: number) {return presentation === 'spread' ? Math.min(slots.length, rowFirst(number) + 1) : number}
  function rowTop(number: number) {return slots[rowFirst(number) - 1]?.offsetTop ?? 0}
  function rowHeight(number: number) {
    const first = rowFirst(number), last = rowEnd(number)
    return Math.max(1, ...slots.slice(first - 1, last).map(slot => slot.offsetHeight))
  }
  function pageHeight(number: number) {return Math.max(1, slots[number - 1]?.offsetHeight ?? 0)}
  function capturePosition() {
    const page = visiblePage(), top = Math.max(0, offset()), start = rowTop(page)
    return {page, fraction: Math.max(0, Math.min(0.999999, (top - start) / pageHeight(page)))}
  }
  function scrollToAnchor(page: number, fraction: number, revealHeader = false, restoreId?: string) {
    scrollDocument(rowTop(page) + pageHeight(page) * fraction, revealHeader, restoreId)
  }
  function scrollDocument(y: number, revealHeader = false, restoreId?: string) {
    if (options.hostViewport) post({kind: 'scroll', y, revealHeader, ...(restoreId ? {restoreId} : {})})
    else scrollTo({top: revealHeader ? 0 : y, behavior: 'instant'})
  }
  function visiblePage() {
    const rows = presentation === 'spread' ? Math.ceil(slots.length / 2) : slots.length
    let left = 0, right = rows - 1
    const top = Math.max(0, offset()) + 8
    while (left < right) {
      const middle = Math.floor((left + right) / 2)
      const page = presentation === 'spread' ? middle * 2 + 1 : middle + 1
      if (rowTop(page) + rowHeight(page) < top) left = middle + 1
      else right = middle
    }
    const first = presentation === 'spread' ? left * 2 + 1 : left + 1
    const last = rowEnd(first)
    for (let page = first; page <= last; page++) if (slots[page - 1]!.offsetTop + pageHeight(page) >= top) return page
    return first
  }
  function position() {
    if (presentationFrame || !restored || !ports.getDocument() || !slots.length) return
    const current = visiblePage()
    const top = Math.max(0, offset())
    const fraction = Math.max(0, Math.min(0.999999, (top - rowTop(current)) / pageHeight(current)))
    post({kind: 'position', position: current + fraction, nearBottom: top + height() >= heightPublished - 32})
  }
  function setSlotSize(number: number, width: number, height: number) {
    const available = presentation === 'spread' ? Math.max(100, spreadPaneWidth) : Math.max(100, document.documentElement.clientWidth - 16)
    const scale = available / width
    const slot = slots[number - 1]!
    slot.style.width = `${width * scale}px`
    slot.style.height = `${height * scale}px`
    slot.style.setProperty('--total-scale-factor', String(scale))
    return scale
  }
  function measurePage(number: number, base: PageViewport) {
    dimensions.set(number, {width: base.width, height: base.height})
    const anchor = capturePosition()
    const before = rowTop(anchor.page), oldHeight = pageHeight(anchor.page)
    const scale = setSlotSize(number, base.width, base.height)
    publishHeight()
    if (restored && offset() >= 0 && number <= anchor.page && (before !== rowTop(anchor.page) || oldHeight !== pageHeight(anchor.page))) scrollToAnchor(anchor.page, anchor.fraction)
    return scale
  }
  async function pageViewport(number: number) {
    const pdf = ports.getDocument()
    if (!pdf || !lifecycle.active || lifecycle.disposed || lifecycle.failed || !slots[number - 1]) return
    const generation = lifecycle.generation
    const page = await pdf.getPage(number)
    if (!lifecycle.active || lifecycle.disposed || lifecycle.failed || generation !== lifecycle.generation) return
    const base = page.getViewport({scale: 1})
    dimensions.set(number, {width: base.width, height: base.height})
    const scale = setSlotSize(number, base.width, base.height)
    publishHeight()
    return page.getViewport({scale})
  }
  async function scrollPage(number: number, fraction = 0, revealHeader = false) {
    if (!Number.isSafeInteger(number) || number < 1 || number > slots.length) return false
    if (!await pageViewport(number)) return false
    scrollToAnchor(number, fraction, revealHeader)
    ports.schedule(); position()
    return true
  }
  async function revealMark(source: PdfMarkSource) {
    const viewport = await pageViewport(source.page)
    if (!viewport) return false
    const top = Math.min(...quadToViewport(source.quads[0]!, viewport).map(point => point[1]!))
    scrollDocument(slots[source.page - 1]!.offsetTop + top - 24)
    ports.schedule(); position()
    return true
  }
  function restore(value: unknown, id: string, complete: () => void) {
    const pdf = ports.getDocument()
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 1 || !pdf) throw new Error('Invalid PDF position')
    const initial = Math.min(pdf.numPages + 0.999999, value)
    const generation = lifecycle.generation, attempt = ++restoreSequence
    return (async () => {
      const number = Math.floor(initial)
      if (!await pageViewport(number) || !lifecycle.active || lifecycle.disposed || lifecycle.failed || generation !== lifecycle.generation || attempt !== restoreSequence) throw new Error('Restore cancelled')
      scrollToAnchor(number, initial % 1, initial === 1, id)
      restored = true
      ports.schedule()
      complete()
    })()
  }
  function resize(evictPages: () => void, anchor = capturePosition(), revealHeader = offset() < 0, restore = true) {
    const {page: number, fraction} = anchor
    evictPages()
    const fallback = dimensions.get(1)!
    for (let number = 1; number <= slots.length; number++) {const size = dimensions.get(number) ?? fallback; setSlotSize(number, size.width, size.height)}
    publishHeight()
    if (restored && restore) {scrollToAnchor(number, fraction, revealHeader); ports.schedule(); position()}
  }
  function setPresentation(mode: 'single' | 'spread', paneWidth = 0, gutter = 12, evictPages: () => void = () => {}) {
    if (mode === presentation && (mode === 'single' || paneWidth === spreadPaneWidth && gutter === spreadGutter)) return
    const anchor = capturePosition(), revealHeader = offset() < 0, sequence = ++presentationSequence
    if (presentationFrame) {cancelAnimationFrame(presentationFrame); presentationFrame = 0}
    presentation = mode
    spreadPaneWidth = Math.max(100, paneWidth)
    spreadGutter = Math.max(0, gutter)
    root.style.display = mode === 'spread' ? 'grid' : ''
    root.style.gridTemplateColumns = mode === 'spread' ? 'repeat(2, minmax(0, 1fr))' : ''
    root.style.columnGap = mode === 'spread' ? `${spreadGutter}px` : ''
    root.style.rowGap = mode === 'spread' ? '12px' : ''
    for (const slot of slots) {
      const number = Number(slot.dataset.pageNumber)
      slot.style.gridColumn = mode === 'spread' ? String((number % 2) ? 1 : 2) : ''
      slot.style.margin = mode === 'spread' ? '0 auto' : '0 auto 12px'
    }
    if (!slots.length) return
    resize(evictPages, anchor, revealHeader, false)
    // Let WebKit commit the new document height before asking the native scroll owner to restore
    // a deep anchor. Otherwise scrollView.setContentOffset can clamp to the old spread height.
    presentationFrame = requestAnimationFrame(() => {
      presentationFrame = requestAnimationFrame(() => {
        presentationFrame = 0
        if (sequence !== presentationSequence || lifecycle.disposed || lifecycle.failed) return
        scrollToAnchor(anchor.page, anchor.fraction, revealHeader)
        ports.schedule()
      })
    })
  }
  function initialize(viewport: PageViewport, count: number) {
    dimensions.set(1, {width: viewport.width, height: viewport.height})
    const fragment = document.createDocumentFragment()
    for (let number = 1; number <= count; number++) {
      const slot = document.createElement('section')
      slot.className = 'page'
      slot.dataset.pageNumber = String(number)
      slot.setAttribute('aria-label', `${options.labels.page} ${number}`)
      slots.push(slot)
      fragment.append(slot)
      setSlotSize(number, viewport.width, viewport.height)
    }
    root.append(fragment)
  }
  function restoreInitial(count: number) {
    restored = true
    const initial = Math.max(1, Math.min(count + 0.999999, options.initialPosition ?? 1))
    return scrollPage(Math.floor(initial), initial % 1, initial === 1)
  }
  function setViewport(value: number, size: number) {
    hostOffset = value; hostHeight = size
    if (lifecycle.active) {ports.schedule(); position()}
  }
  return {slots, offset, height, publishHeight, visiblePage, position, measurePage, scrollPage, revealMark, restore, resize, initialize, restoreInitial, setViewport, setPresentation}
}
