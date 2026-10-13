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
  const slots: HTMLElement[] = []
  const dimensions = new Map<number, {width: number; height: number}>()
  const offset = () => options.hostViewport ? hostOffset : scrollY
  const height = () => options.hostViewport ? hostHeight : innerHeight

  function publishHeight(force = false) {
    const last = slots[slots.length - 1]
    const value = last ? last.offsetTop + last.offsetHeight + 20 : root.offsetHeight
    if (value > 0 && (force || value !== heightPublished)) {heightPublished = value; post({kind: 'documentHeight', height: value})}
  }
  function scrollDocument(y: number, revealHeader = false, restoreId?: string) {
    if (options.hostViewport) post({kind: 'scroll', y, revealHeader, ...(restoreId ? {restoreId} : {})})
    else scrollTo({top: revealHeader ? 0 : y, behavior: 'instant'})
  }
  function visiblePage() {
    let left = 0, right = slots.length - 1
    const top = Math.max(0, offset()) + 8
    while (left < right) {
      const middle = Math.floor((left + right) / 2)
      const slot = slots[middle]!
      if (slot.offsetTop + slot.offsetHeight < top) left = middle + 1
      else right = middle
    }
    return left + 1
  }
  function position() {
    if (!restored || !ports.getDocument() || !slots.length) return
    const current = visiblePage()
    const slot = slots[current - 1]!
    const top = Math.max(0, offset())
    const fraction = Math.max(0, Math.min(0.999999, (top - slot.offsetTop) / Math.max(1, slot.offsetHeight)))
    post({kind: 'position', position: current + fraction, nearBottom: top + height() >= heightPublished - 32})
  }
  function setSlotSize(number: number, width: number, height: number) {
    const available = Math.max(100, document.documentElement.clientWidth - 16)
    const scale = available / width
    const slot = slots[number - 1]!
    slot.style.width = `${width * scale}px`
    slot.style.height = `${height * scale}px`
    slot.style.setProperty('--total-scale-factor', String(scale))
    return scale
  }
  function measurePage(number: number, base: PageViewport) {
    dimensions.set(number, {width: base.width, height: base.height})
    const anchor = visiblePage(), anchorSlot = slots[anchor - 1]!
    const before = anchorSlot.offsetTop, oldHeight = anchorSlot.offsetHeight
    const fraction = Math.max(0, (offset() - before) / oldHeight)
    const scale = setSlotSize(number, base.width, base.height)
    publishHeight()
    if (restored && offset() >= 0 && number <= anchor && (before !== anchorSlot.offsetTop || oldHeight !== anchorSlot.offsetHeight)) scrollDocument(anchorSlot.offsetTop + fraction * anchorSlot.offsetHeight)
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
    const slot = slots[number - 1]!
    scrollDocument(slot.offsetTop + slot.offsetHeight * fraction, revealHeader)
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
      const slot = slots[number - 1]!
      scrollDocument(slot.offsetTop + slot.offsetHeight * (initial % 1), initial === 1, id)
      restored = true
      ports.schedule()
      complete()
    })()
  }
  function resize(evictPages: () => void) {
    const number = visiblePage(), slot = slots[number - 1]!
    const revealHeader = offset() < 0
    const fraction = Math.max(0, (offset() - slot.offsetTop) / slot.offsetHeight)
    evictPages()
    const fallback = dimensions.get(1)!
    for (let number = 1; number <= slots.length; number++) {const size = dimensions.get(number) ?? fallback; setSlotSize(number, size.width, size.height)}
    publishHeight()
    if (restored) return scrollPage(number, fraction, revealHeader)
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
  return {slots, offset, height, publishHeight, visiblePage, position, measurePage, scrollPage, revealMark, restore, resize, initialize, restoreInitial, setViewport}
}
