import { describe, expect, it, vi } from 'vitest'
import { MarkManager } from '@slax-reader/selection'
import { capturePdfSelection, findPdfTextRange } from '~/components/Article/Pdf/geometry'

describe('PDF passage lookup and grouping', () => {
  it('clips a cross-page selection at its text boundaries without changing text-layer nodes', () => {
    const root = document.createElement('div')
    root.innerHTML = '<div class="page" data-page-number="1"><div class="textLayer"><span>First line</span></div></div><div class="page" data-page-number="2"><div class="textLayer"><span>Next page</span></div></div>'
    const pages = root.querySelectorAll<HTMLElement>('.page')
    for (const page of pages) {
      Object.defineProperty(page, 'clientWidth', { value: 100 })
      Object.defineProperty(page, 'clientHeight', { value: 100 })
    }
    const nodes = root.querySelectorAll('span')
    const range = document.createRange()
    range.setStart(nodes[0]!.firstChild!, 4)
    range.setEnd(nodes[1]!.firstChild!, 6)
    const html = root.innerHTML
    const rects = vi.spyOn(Range.prototype, 'getClientRects').mockImplementation(() => [{ left: 1, top: 2, right: 10, bottom: 8, width: 9, height: 6 }] as never)
    try {
      const sources = capturePdfSelection(range, root, 'a'.repeat(64), () => ({ width: 100, height: 100, convertToPdfPoint: (x, y) => [x, y], convertToViewportPoint: (x, y) => [x, y] }))
      expect(sources.map(source => [source.page, source.text])).toEqual([[1, 't line'], [2, 'Next p']])
      expect(sources.every(source => source.quads.length === 1)).toBe(true)
      expect(root.innerHTML).toBe(html)
    } finally { rects.mockRestore() }
  })
  it('finds an AI quote spanning text nodes and preserves the original layer', () => {
    const layer = document.createElement('div')
    layer.innerHTML = '<span>First line </span><span> second line</span>'
    const html = layer.innerHTML
    const range = findPdfTextRange(layer, 'line\nsecond')
    expect(range?.toString()).toBe('line  second')
    expect(layer.innerHTML).toBe(html)
    expect(findPdfTextRange(layer, 'absent')).toBeUndefined()
  })
  it('reuses the existing thread after subpixel layout rounding but separates another passage', () => {
    const source = { type: 'pdf' as const, version: 1 as const, document_id: 'a'.repeat(64), page: 1, text: 'quote', quads: [[10, 20, 30, 20, 30, 10, 10, 10] as [number, number, number, number, number, number, number, number]] }
    const same = { ...source, quads: [source.quads[0]!.map(n => n + 0.1) as typeof source.quads[number]] }
    const compare = MarkManager.prototype.checkMarkSourceIsSame
    expect(compare.call({} as MarkManager, [source], [same])).toBe(true)
    expect(compare.call({} as MarkManager, [source], [{ ...same, page: 2 }])).toBe(false)
    expect(compare.call({} as MarkManager, [source], [{ ...same, quads: [same.quads[0]!.map(n => n + 2) as typeof source.quads[number]] }])).toBe(false)
  })
})
