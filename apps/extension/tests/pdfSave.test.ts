import { beforeEach, afterEach, expect, test, vi } from 'vitest'
import { File } from 'node:buffer'
import { pdfBasename, readLocalPdf, validatePdfFile } from '../src/utils/pdfFile'
import { PDF_MAX_BYTES } from '@slax-reader/contracts/pdf'
import { openPdfSave, pdfOperationMessage, invalidatePdfSource, PDF_OPERATIONS_KEY } from '../src/entrypoints/background/pdfOperations'

let stored: Record<string, any>
const source = { id: 1, url: 'file:///private/test.pdf', status: 'complete' }
beforeEach(() => {
  stored = {}
  vi.stubGlobal('File', File)
  vi.stubGlobal('browser', {
    runtime: { id: 'test', getURL: (p: string) => `chrome-extension://test${p}` },
    tabs: { get: vi.fn(async () => source), sendMessage: vi.fn(async () => ({ ready: true })) },
    windows: { create: vi.fn(async () => ({ id: 3, tabs: [{ id: 2 }] })), update: vi.fn(async () => ({})), remove: vi.fn() },
    storage: { session: { get: vi.fn(async () => stored), set: vi.fn(async value => Object.assign(stored, structuredClone(value))) } }
  })
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })
const current = () => stored[PDF_OPERATIONS_KEY][0]
const sender = () => ({ id: 'test', frameId: 2, tab: { id: 1 }, url: `chrome-extension://test/pdf-save.html?operation=${current().id}` })
const call = (method: string, extra = {}, from = sender()) => pdfOperationMessage({ method, owner: 'page', operation: current().id, ...extra }, from as any)

const bind = async () => {
  const identity = await call('identify')
  expect(identity.ok).toBe(true)
  expect(await call('bind', { frameId: identity.frameId, token: identity.token }, { id: 'test', frameId: 0, tab: { id: 1 }, url: source.url } as any)).toEqual({ ok: true })
}

test('repeated actions reuse one source operation without creating windows or tabs', async () => {
  await Promise.all([openPdfSave(source as any), openPdfSave(source as any), openPdfSave(source as any)])
  expect(browser.windows.create).not.toHaveBeenCalled()
  expect(browser.tabs.sendMessage).toHaveBeenCalledTimes(3)
  expect(new Set(vi.mocked(browser.tabs.sendMessage).mock.calls.map(([, message]: any) => message.operation)).size).toBe(1)
  expect(Object.keys(current()).sort()).toEqual(['expires', 'id', 'sourceTabId', 'sourceUrl', 'state', 'surface'])
})

test('only the isolated source controller can bind the actual PDF iframe', async () => {
  await openPdfSave(source as any)
  expect(await call('claim')).toEqual({ error: 'source' })
  const identity = await call('identify')
  expect(await call('bind', { frameId: identity.frameId, token: identity.token })).toEqual({ error: 'source' })
  expect(await call('bind', { frameId: identity.frameId, token: 'forged' }, { id: 'test', frameId: 0, tab: { id: 1 }, url: source.url } as any)).toEqual({ error: 'source' })
  await bind()
  for (const replacement of [
    { url: 'https://example.org' }, { url: `chrome-extension://test/pdf-save.html.evil?operation=${current().id}` },
    { id: 'other' }, { tab: { id: 3 } }, { frameId: 3 }, { frameId: 0 }
  ]) expect(await call('claim', {}, { ...sender(), ...replacement } as any)).toEqual({ error: 'source' })
  expect((await call('claim')).ok).toBe(true)
  expect((await call('begin')).ok).toBe(true)
  expect(await call('begin')).toEqual({ error: 'busy' })
  expect((await call('submit')).ok).toBe(true)
  expect((await call('complete', { result: 'saved' })).ok).toBe(true)
})

test('source navigation stops submission without applying results to a replacement page', async () => {
  await openPdfSave(source as any)
  await bind()
  await call('claim')
  await call('begin')
  await invalidatePdfSource(1)
  expect(await call('submit')).toEqual({ error: 'source' })
})

test('expired operations and closed sources release session metadata', async () => {
  await openPdfSave(source as any)
  current().expires = 0
  expect(await call('claim')).toEqual({ error: 'source' })
  await openPdfSave(source as any)
  expect(stored[PDF_OPERATIONS_KEY]).toHaveLength(1)
  await invalidatePdfSource(1, true)
  expect(stored[PDF_OPERATIONS_KEY]).toEqual([])
})

test('malformed protocol and uncertain submission require explicit retry', async () => {
  await openPdfSave(source as any)
  await bind()
  expect(await call('fetch', { url: 'file:///other' })).toEqual({ error: 'source' })
  expect(await call('claim', { owner: '' })).toEqual({ error: 'source' })
  await call('claim')
  const expires = current().expires
  await call('begin')
  await call('submit')
  expect(await call('complete', { result: 'anything' })).toEqual({ error: 'source' })
  await call('release')
  expect(current().state).toBe('submitted')
  await call('claim', { owner: 'reload' })
  expect(current().state).toBe('submitted')
  expect(await call('begin', { owner: 'reload' })).toEqual({ error: 'busy' })
  await call('retry', { owner: 'reload' })
  expect((await call('begin', { owner: 'reload' })).ok).toBe(true)
  expect(current().expires).toBe(expires)
})

test('cancels oversized advertised response without consuming bytes', async () => {
  const cancel = vi.fn()
  const stream = new ReadableStream({ cancel })
  vi.stubGlobal('fetch', vi.fn(async () => new Response(stream, { headers: { 'Content-Length': String(PDF_MAX_BYTES + 1) } })))
  await expect(readLocalPdf('file:///a.pdf', new AbortController().signal)).rejects.toThrow('size')
  expect(cancel).toHaveBeenCalledOnce()
})

test('keeps basename only, decoded Unicode and safe fallback', () => {
  expect(pdfBasename('file:///private/my%20%E6%96%87.pdf#page=2', true)).toBe('my 文.pdf')
  expect(pdfBasename('C:\\private\\file.pdf')).toBe('file.pdf')
  expect(pdfBasename('file:///private/%2F%00', true)).toBe('document.pdf')
  expect(pdfBasename('x'.repeat(300))).toHaveLength(200)
})

test('validates size inclusive boundary and bounded signature prefix', async () => {
  const valid = new File(['%PDF-1.7\n'], 'sample.pdf') as any
  expect((await validatePdfFile(valid)).type).toBe('application/pdf')
  await expect(validatePdfFile(new File([], 'empty.pdf') as any)).rejects.toThrow('size')
  await expect(validatePdfFile(new File(['html'], 'fake.pdf') as any)).rejects.toThrow('invalid')
  await expect(validatePdfFile(new File([' '.repeat(1024), '%PDF-'], 'late.pdf') as any)).rejects.toThrow('invalid')
  const boundary = new File(['%PDF-', new Uint8Array(PDF_MAX_BYTES - 5)], 'big.pdf') as any
  expect((await validatePdfFile(boundary)).size).toBe(PDF_MAX_BYTES)
  await expect(validatePdfFile(new File([boundary, 'x'], 'large.pdf') as any)).rejects.toThrow('size')
})

test('bounded file stream preserves raw bytes and cancels failed readers', async () => {
  const bytes = new TextEncoder().encode('%PDF-1.7\ncontent')
  vi.stubGlobal('fetch', vi.fn(async () => new Response(bytes, { headers: { 'Content-Length': String(bytes.length) } })))
  const file = await readLocalPdf('file:///private/a%20b.pdf#page=2', new AbortController().signal)
  expect(await file.text()).toBe('%PDF-1.7\ncontent')
  expect(file.name).toBe('a b.pdf')
  expect(vi.mocked(fetch).mock.calls[0][0]).toBe('file:///private/a%20b.pdf')
  vi.stubGlobal('fetch', vi.fn(async () => new Response(bytes, { headers: { 'Content-Length': String(PDF_MAX_BYTES + 1) } })))
  await expect(readLocalPdf('file:///a.pdf', new AbortController().signal)).rejects.toThrow('size')
  await expect(readLocalPdf('https://example.org/file.pdf', new AbortController().signal)).rejects.toThrow('source')
})

test('only a newly claimed operation may automatically start saving', async () => {
  await openPdfSave(source as any)
  await bind()
  expect((await call('claim')).autoStart).toBe(true)
  expect((await call('claim')).autoStart).toBe(false)
  await call('begin')
  expect((await call('claim', { owner: 'reloaded' })).autoStart).toBe(false)
})
