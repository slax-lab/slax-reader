import type {PdfMarkSource} from '@slax-reader/contracts/pdf'
import {quadToViewport} from '../../pdf-geometry.ts'
import type {PdfMarkItem} from '../../pdf-types.ts'
import {groupPdfMarks, isPdfMarkDetail, pdfSourceKey} from './annotations.ts'
import type {PdfResidentPage, PdfRuntimeOptions, PdfRuntimePorts} from './types.ts'

interface PdfMarkPorts {
  getPage(number: number): PdfResidentPage | undefined
  pageNumbers(): Iterable<number>
}
export function createPdfMarks(root: HTMLElement, options: PdfRuntimeOptions, ports: Pick<PdfRuntimePorts, 'emit'> & PdfMarkPorts) {
  const {emit} = ports
  let detail = options.marks ?? {mark_list: [], user_list: {}}
  let items: PdfMarkItem[] = []
  let anchors = new Map<string, PdfMarkSource>()

  function rebuild() {
    const grouped = groupPdfMarks(detail, options.descriptor.document_id)
    items = grouped.items
    anchors = grouped.anchors
    for (const number of ports.pageNumbers()) drawPage(number)
    emit({type: 'markItemInfosChanged', marks: items})
  }
  function replace(value: unknown) {
    if (!isPdfMarkDetail(value, options.descriptor.document_id)) throw new Error('Invalid PDF marks')
    detail = value
    rebuild()
  }
  function drawPage(number: number) {
    const state = ports.getPage(number)
    if (!state?.viewport) return
    state.overlay.replaceChildren()
    state.overlay.setAttribute('viewBox', `0 0 ${state.viewport.width} ${state.viewport.height}`)
    for (const mark of items) for (const source of mark.source) {
      if (source.page !== number) continue
      for (const quad of source.quads) {
        const points = quadToViewport(quad, state.viewport)
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'path')
        line.setAttribute('d', `M ${points[3]!.join(' ')} L ${points[2]!.join(' ')}`)
        line.style.fill = 'none'
        line.style.strokeWidth = '1.5'
        line.style.strokeDasharray = mark.comments.length ? 'none' : '3 3'
        line.setAttribute('vector-effect', 'non-scaling-stroke')
        line.dataset.markId = mark.id
        line.classList.add('mark-quad')
        line.setAttribute('role', 'button')
        line.setAttribute('tabindex', '0')
        line.setAttribute('aria-label', `${options.labels.mark}: ${source.text}`)
        line.addEventListener('keydown', event => {if (event.key === 'Enter' || event.key === ' ') {event.preventDefault(); open(mark)}})
        state.overlay.append(line)
      }
    }
  }
  function open(mark: PdfMarkItem) {emit({type: 'markClicked', markId: mark.id, text: mark.source.map(source => source.text).join('\n'), mark})}
  function click(event: MouseEvent) {
    if (window.getSelection()?.toString().trim()) return
    const page = (event.target as Element).closest<HTMLElement>('.page')
    const state = page && ports.getPage(Number(page.dataset.pageNumber))
    if (page && state?.viewport) {
      const rect = page.getBoundingClientRect()
      const x = (event.clientX - rect.left) * state.viewport.width / rect.width
      const y = (event.clientY - rect.top) * state.viewport.height / rect.height
      for (const mark of items) for (const source of mark.source) {
        if (source.page !== Number(page.dataset.pageNumber)) continue
        for (const quad of source.quads) {
          const points = quadToViewport(quad, state.viewport)
          let inside = false
          for (let i = 0, j = 3; i < 4; j = i++) {
            const a = points[i]!, b = points[j]!
            if ((a[1]! > y) !== (b[1]! > y) && x < (b[0]! - a[0]!) * (y - a[1]!) / (b[1]! - a[1]!) + a[0]!) inside = !inside
          }
          if (inside) return open(mark)
        }
      }
    }
    emit({type: 'tap'})
  }
  root.addEventListener('click', click)
  return {
    rebuild, replace, drawPage,
    find: (source: PdfMarkSource[]) => items.find(item => pdfSourceKey(item.source) === pdfSourceKey(source)),
    anchor: (id: string) => anchors.get(id),
    dispose: () => root.removeEventListener('click', click),
  }
}
