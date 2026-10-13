import type { PdfMarkSource } from '@slax-reader/contracts/pdf'

export interface PdfViewport {
  width: number
  height: number
  convertToPdfPoint(x: number, y: number): number[]
  convertToViewportPoint(x: number, y: number): number[]
}

export function rectToPdfQuad(rect: { left: number; top: number; right: number; bottom: number }, viewport: PdfViewport): PdfMarkSource['quads'][number] {
  return [
    ...viewport.convertToPdfPoint(rect.left, rect.top), ...viewport.convertToPdfPoint(rect.right, rect.top),
    ...viewport.convertToPdfPoint(rect.right, rect.bottom), ...viewport.convertToPdfPoint(rect.left, rect.bottom)
  ] as PdfMarkSource['quads'][number]
}

export function quadToViewport(quad: PdfMarkSource['quads'][number], viewport: PdfViewport): number[][] {
  return [0, 2, 4, 6].map(index => viewport.convertToViewportPoint(quad[index]!, quad[index + 1]!))
}

/** Locate a quote across replaceable text-layer nodes, ignoring PDF layout whitespace. */
export function findPdfTextRange(layer: HTMLElement, quote: string): Range | undefined {
  const target = quote.replace(/\s+/g, '')
  if (!target) return
  const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT)
  const positions: Array<{ node: Text; offset: number }> = []
  let text = ''
  while (walker.nextNode()) {
    const node = walker.currentNode as Text
    for (let offset = 0; offset < node.length; offset++) if (!/\s/.test(node.data[offset]!)) {
      text += node.data[offset]
      positions.push({ node, offset })
    }
  }
  const start = text.indexOf(target)
  if (start < 0) return
  const first = positions[start]!, last = positions[start + target.length - 1]!
  const range = document.createRange()
  range.setStart(first.node, first.offset)
  range.setEnd(last.node, last.offset + 1)
  return range
}

/** Clip to text nodes per page; never wrap or mutate PDF.js text-layer spans. */
export function capturePdfSelection(range: Range, root: HTMLElement, documentId: string, getViewport: (page: number) => PdfViewport | undefined): PdfMarkSource[] {
  const sources: PdfMarkSource[] = []
  for (const layer of root.querySelectorAll<HTMLElement>('.textLayer')) {
    if (!range.intersectsNode(layer)) continue
    const page = layer.closest<HTMLElement>('.page')
    const number = Number(page?.dataset.pageNumber)
    const viewport = getViewport(number)
    if (!page || !viewport) continue
    const origin = page.getBoundingClientRect()
    const scaleX = viewport.width / page.clientWidth
    const scaleY = viewport.height / page.clientHeight
    const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT)
    const quads: PdfMarkSource['quads'] = []
    const texts: string[] = []
    while (walker.nextNode()) {
      const node = walker.currentNode as Text
      if (!range.intersectsNode(node) || !node.length) continue
      const clipped = document.createRange()
      clipped.setStart(node, range.startContainer === node ? range.startOffset : 0)
      clipped.setEnd(node, range.endContainer === node ? range.endOffset : node.length)
      const text = clipped.toString()
      if (!text.trim()) continue
      texts.push(text)
      for (const rect of clipped.getClientRects()) {
        if (rect.width < 0.5 || rect.height < 0.5) continue
        quads.push(rectToPdfQuad({
          left: (rect.left - origin.left - page.clientLeft) * scaleX,
          right: (rect.right - origin.left - page.clientLeft) * scaleX,
          top: (rect.top - origin.top - page.clientTop) * scaleY,
          bottom: (rect.bottom - origin.top - page.clientTop) * scaleY
        }, viewport))
      }
    }
    if (quads.length) sources.push({ type: 'pdf', version: 1, page: number, document_id: documentId, text: texts.join(' '), quads })
  }
  return sources
}
