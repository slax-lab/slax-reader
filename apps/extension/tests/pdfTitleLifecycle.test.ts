import { File } from 'node:buffer'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
const fixture = vi.hoisted(() => ({ task: { promise: Promise.resolve({} as any), destroy: vi.fn() }, getDocument: vi.fn() }))
vi.mock('unpdf', () => ({ getResolvedPDFJS: async () => ({ getDocument: fixture.getDocument }) }))
import { readPdfTitle } from '../src/utils/pdfFile'

beforeEach(() => {
  vi.useFakeTimers()
  fixture.task = { promise: new Promise(() => {}), destroy: vi.fn().mockResolvedValue(undefined) }
  fixture.getDocument.mockReset().mockImplementation(() => fixture.task)
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

test('a stalled metadata parser times out, destroys its task and allows filename fallback', async () => {
  const result = readPdfTitle(new File(['%PDF-test'], 'file.pdf') as any, new AbortController().signal)
  await vi.waitFor(() => expect(fixture.getDocument).toHaveBeenCalledOnce())
  await vi.advanceTimersByTimeAsync(10_000)
  expect(await result).toBeUndefined()
  expect(fixture.task.destroy).toHaveBeenCalledOnce()
})

test('cancelling pending metadata destroys its parser and preserves the cancellation reason', async () => {
  const controller = new AbortController()
  const result = readPdfTitle(new File(['%PDF-test'], 'file.pdf') as any, controller.signal)
  const assertion = expect(result).rejects.toThrow('cancelled')
  await vi.waitFor(() => expect(fixture.getDocument).toHaveBeenCalledOnce())
  controller.abort(new Error('cancelled'))
  await assertion
  expect(fixture.task.destroy).toHaveBeenCalledOnce()
})
