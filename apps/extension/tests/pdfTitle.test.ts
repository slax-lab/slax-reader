import { File } from 'node:buffer'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { readPdfTitle } from '../src/utils/pdfFile'
import { pdfFixture } from '../../api/test/helpers/pdfFixture'

beforeEach(() => vi.stubGlobal('File', File))
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })
const read = (bytes: Uint8Array<ArrayBuffer>) => readPdfTitle(new File([bytes], 'download.pdf') as any, new AbortController().signal)

test('reads Unicode document-info Title without consuming or renaming the upload File', async () => {
  const bytes = pdfFixture(['Text'], [], '  真正的\nPDF 标题  ')
  const file = new File([bytes], 'download.pdf')
  expect(await readPdfTitle(file as any, new AbortController().signal)).toBe('真正的 PDF 标题')
  expect(file.name).toBe('download.pdf')
  expect(new Uint8Array(await file.arrayBuffer())).toEqual(bytes)
})

test('XMP title wins over document-info Title and empty XMP falls back', async () => {
  expect(await read(pdfFixture(['Text'], [], 'Info Title', undefined, 'XMP Title'))).toBe('XMP Title')
  expect(await read(pdfFixture(['Text'], [], 'Info Title', undefined, ' '))).toBe('Info Title')
})

test('missing or unreadable metadata allows filename fallback', async () => {
  expect(await read(pdfFixture())).toBeUndefined()
  expect(await read(pdfFixture(['Text'], [], '  '))).toBeUndefined()
  expect(await read(new TextEncoder().encode('%PDF-invalid'))).toBeUndefined()
})

test('cancellation before metadata parsing cannot continue to upload', async () => {
  const controller = new AbortController()
  controller.abort(new Error('cancelled'))
  await expect(readPdfTitle(new File([pdfFixture()], 'file.pdf') as any, controller.signal)).rejects.toThrow('cancelled')
})
