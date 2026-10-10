import { describe, expect, it, vi } from 'vitest'
import { PDF_MAX_BYTES, bookmarkContentType, pdfMetadataAuthor, pdfByteRange, pdfResponseHeaders, validatePdfSources } from '@slax-reader/contracts/pdf'
import { extractPdfText, pdfHash, readPdfBody } from '../../src/utils/pdf'
import { pdfFixture } from '../helpers/pdfFixture'
import { getDocumentProxy } from 'unpdf'
import { quadToViewport, rectToPdfQuad } from '../../../web/app/components/Article/Pdf/geometry'

describe('PDF ingestion and extraction', () => {
  it('extracts document-info authors alongside text, including image-only pages', async () => {
    expect(await extractPdfText(pdfFixture(['Hello'], [], 'Paper', ' Jane Doe; John Smith '))).toMatchObject({ title: 'Paper', author: 'Jane Doe; John Smith', status: 'ready' })
    expect(await extractPdfText(pdfFixture([''], [], undefined, 'Jane Doe'))).toMatchObject({ author: 'Jane Doe', status: 'empty' })
    expect((await extractPdfText(pdfFixture())).author).toBeUndefined()
  })

  it('reads embedded title metadata while extracting text and tolerates missing or blank titles', async () => {
    expect(await extractPdfText(pdfFixture(['Hello PDF'], [], '  A Document (Title)  '))).toMatchObject({ title: 'A Document (Title)', status: 'ready' })
    expect((await extractPdfText(pdfFixture())).title).toBeUndefined()
    expect((await extractPdfText(pdfFixture(['Hello'], [], '  '))).title).toBeUndefined()
  })
  it('extracts actual text with page labels, including rotated pages', async () => {
    const bytes = pdfFixture(['Hello PDF', 'Second page'], [0, 90])
    expect(await pdfHash(bytes)).toMatch(/^[a-f0-9]{64}$/)
    const result = await extractPdfText(bytes)
    expect(result.status).toBe('ready')
    expect(result.pages).toBe(2)
    expect(result.text).toContain('## Page 1\n\nHello PDF')
    expect(result.text).toContain('## Page 2\n\nSecond page')

  })
  it('reports scans with no text and parse failures explicitly', async () => {
    expect(await extractPdfText(pdfFixture(['']))).toMatchObject({ text: '', status: 'empty', pages: 1 })
    expect(await extractPdfText(new TextEncoder().encode('%PDF-invalid'))).toMatchObject({ text: '', status: 'failed' })
  })
  it('accepts the exact 50 MiB boundary and rejects advertised or streamed excess', async () => {
    const chunk = new Uint8Array(512 * 1024)
    chunk.set(new TextEncoder().encode('%PDF-1.7'))
    let count = 0
    const body = new ReadableStream<Uint8Array>({ pull(controller) { count++ < 100 ? controller.enqueue(chunk) : controller.close() } })
    expect((await readPdfBody(body, String(PDF_MAX_BYTES))).byteLength).toBe(PDF_MAX_BYTES)
    await expect(readPdfBody(new Response(chunk).body, String(PDF_MAX_BYTES + 1))).rejects.toThrow()
    await expect(readPdfBody(new Response(chunk).body, '100')).rejects.toThrow()
  })
  it('cancels invalid bodies and rejects empty content', async () => {
    const cancel = vi.fn()
    await expect(readPdfBody(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('not a PDF')); c.close() }, cancel }), '9')).rejects.toThrow()
    await expect(readPdfBody(new Response('').body, '0')).rejects.toThrow()
  })
  it('cancels a stalled upload at its deadline', async () => {
    vi.useFakeTimers()
    try {
      const cancel = vi.fn()
      const pending = readPdfBody(new ReadableStream({ cancel }), null, 100)
      const assertion = expect(pending).rejects.toThrow('timed out')
      await vi.advanceTimersByTimeAsync(100)
      await assertion
      expect(cancel).toHaveBeenCalled()
    } finally { vi.useRealTimers() }
  })
})

describe('PDF contracts', () => {
  it('normalizes XMP author lists, prefers them to Info Author, and tolerates missing metadata', () => {
    expect(pdfMetadataAuthor([' Jane\nDoe ', 'John Smith', null], 'Fallback')).toBe('Jane Doe, John Smith')
    expect(pdfMetadataAuthor('XMP Author', 'Info Author')).toBe('XMP Author')
    expect(pdfMetadataAuthor([' ', null], ' Info Author ')).toBe('Info Author')
    expect(pdfMetadataAuthor(undefined, undefined)).toBeUndefined()
    expect(pdfMetadataAuthor('a'.repeat(600), undefined)?.length).toBe(500)
  })

  it.each([0, 90, 180, 270])('restores page geometry at rotation %s with a nonzero page origin across zoom/density changes', async rotation => {
    const pdf = await getDocumentProxy(pdfFixture(['Geometry'], [rotation]))
    try {
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
    } finally { await pdf.loadingTask.destroy() }
  })
  it.each([[0, 'article'], [1, 'shortcut'], [2, 'pdf']])('maps persisted type %s', (type, name) => expect(bookmarkContentType(Number(type))).toBe(name))
  it.each([['bytes=2-4', { offset: 2, length: 3 }], ['bytes=-4', { offset: 6, length: 4 }], ['bytes=7-', { offset: 7, length: 3 }], ['bytes=0-99', { offset: 0, length: 10 }]])('handles range %s', (value, range) => expect(pdfByteRange(String(value), 10)).toEqual(range))
  it.each(['bytes=10-', 'bytes=4-2', 'bytes=-0', 'bytes=0-1,4-5', 'bytes=90071992547409930-'])('rejects %s', value => expect(() => pdfByteRange(value, 10)).toThrow())
  it('returns private inline PDF headers with safe filenames', () => {
    const headers = pdfResponseHeaders('test\r\n.pdf', 10, { offset: 2, length: 3 })
    expect(headers).toMatchObject({ 'Content-Type': 'application/pdf', 'Content-Length': '3', 'Content-Range': 'bytes 2-4/10', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' })
    expect(headers['Content-Disposition']).not.toContain('\r')
  })
  it('validates geometry and identity, preserving the legacy shape', () => {
    const source = { type: 'pdf', version: 1, page: 1, document_id: 'a'.repeat(64), text: 'Hello', quads: [[0, 1, 2, 1, 2, 0, 0, 0]] }
    expect(validatePdfSources([source], source.document_id)).toBe(5)
    expect(validatePdfSources([{ type: 'text', path: 'p', start: 0, end: 3 }])).toBeUndefined()
    for (const patch of [{ version: 2 }, { page: 0 }, { quads: [[NaN, 0, 0, 0, 0, 0, 0, 0]] }]) expect(() => validatePdfSources([{ ...source, ...patch }])).toThrow()
    const large = Array.from({ length: 21 }, (_, index) => ({ ...source, page: index + 1, text: 'x'.repeat(1001), quads: Array.from({ length: 1001 }, () => source.quads[0]) }))
    expect(validatePdfSources(large, source.document_id)).toBe(21 * 1001)
    expect(() => validatePdfSources([source], 'b'.repeat(64))).toThrow()
    expect(() => validatePdfSources([source, { type: 'text' }])).toThrow()
  })
})
