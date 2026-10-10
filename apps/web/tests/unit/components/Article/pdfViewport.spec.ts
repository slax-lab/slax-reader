// @vitest-environment happy-dom
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { quadToViewport, rectToPdfQuad } from '../../../../app/components/Article/Pdf/geometry'

/** A valid single-page PDF with a nonzero media-box origin and configurable rotation. */
function pageFixture(rotation: number): Uint8Array {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Count 1 /Kids [3 0 R] >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [-20 10 300 210] /Rotate ${rotation} /Resources << >> >>`
  ]
  let pdf = '%PDF-1.7\n'
  const offsets = objects.map((object, index) => {
    const offset = pdf.length
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`
    return offset
  })
  const xref = pdf.length
  pdf += `xref\n0 4\n0000000000 65535 f \n${offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}`
  pdf += `trailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return new TextEncoder().encode(pdf)
}

describe('PDF viewport geometry', () => {
  const originalWorkerSrc = GlobalWorkerOptions.workerSrc
  beforeAll(() => {
    GlobalWorkerOptions.workerSrc = createRequire(import.meta.url).resolve('pdfjs-dist/legacy/build/pdf.worker.mjs')
  })
  afterAll(() => { GlobalWorkerOptions.workerSrc = originalWorkerSrc })

  it.each([0, 90, 180, 270])('restores page geometry at rotation %s with a nonzero page origin across zoom/density changes', async rotation => {
    const loadingTask = getDocument({ data: pageFixture(rotation) })
    try {
      const pdf = await loadingTask.promise
      const page = await pdf.getPage(1)
      const viewport = page.getViewport({ scale: 1 })
      const quad = rectToPdfQuad({ left: 12, top: 24, right: 70, bottom: 46 }, viewport)
      for (const scale of [0.5, 1, 2, 3]) {
        const points = quadToViewport(quad, page.getViewport({ scale }))
        expect(points[0]![0]).toBeCloseTo(12 * scale)
        expect(points[0]![1]).toBeCloseTo(24 * scale)
        expect(points[2]![0]).toBeCloseTo(70 * scale)
        expect(points[2]![1]).toBeCloseTo(46 * scale)
      }
    } finally { await loadingTask.destroy() }
  })
})
