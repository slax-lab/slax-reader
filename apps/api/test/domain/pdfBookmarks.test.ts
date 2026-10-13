import { beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('@/decorators/di', () => ({ injectable: () => (target: unknown) => target, inject: () => () => undefined, singleton: () => (target: unknown) => target }))
vi.mock('@/utils/publicFetch', () => ({ publicFetch: vi.fn() }))
vi.mock('@/handler/http/mcpController', () => ({ McpServerController: class {} }))
import { BookmarkService } from '../../src/domain/bookmark'
import { publicFetch } from '../../src/utils/publicFetch'
import { pdfFixture } from '../helpers/pdfFixture'
import { createMockCtx } from '../helpers/mockFactory'
import { getRouter } from '@/di/generated/readerRouter'
import { LabService } from '@/domain/lab'

function wire() {
  const bytes = pdfFixture()
  const object = () => ({ size: bytes.length, customMetadata: { filename: 'test.pdf', sha256: 'a'.repeat(64), source: 'url', text_status: 'ready' }, body: new Response(bytes).body, text: vi.fn() })
  const bucket = { head: vi.fn().mockResolvedValue(null), get: vi.fn().mockImplementation(async (key: string) => key.startsWith('pdf/meta/') ? { json: async () => ({ text_status: 'ready', pages: 1 }) } : object()), put: vi.fn().mockResolvedValue({}), delete: vi.fn().mockResolvedValue(undefined) }
  const repo = { getBookmarkById: vi.fn().mockResolvedValue({ content_key: '' }), completePdfBookmark: vi.fn().mockResolvedValue(undefined) }
  const labRepo = { isEnabled: vi.fn().mockResolvedValue(true) }
  const labs = new (LabService as any)(labRepo) as LabService
  const service = Object.assign(Object.create(BookmarkService.prototype), { labService: labs, bucket: () => ({ R2Bucket: bucket }), bucketData: () => ({ R2Bucket: bucket }), bookmarkRepo: repo, searchService: { clearSearchCache: vi.fn() } }) as BookmarkService
  return { service, bucket, repo, bytes, object, labRepo }
}
beforeEach(() => vi.mocked(publicFetch).mockReset())
describe('PDF bookmark persistence', () => {
  it('rejects a response-detected extensionless PDF with Labs off before full download or storage', async () => {
    const { service, bucket, repo, bytes, labRepo } = wire()
    labRepo.isEnabled.mockResolvedValue(false)
    vi.mocked(publicFetch).mockResolvedValue(new Response(bytes, { headers: { 'Content-Type': 'application/pdf' } }))
    await expect(service.capturePdf(createMockCtx(), 10, 'uuid', 'https://example.com/download')).rejects.toMatchObject({ name: 'LAB_FEATURE_DISABLED' })
    expect(publicFetch).toHaveBeenCalledTimes(1)
    expect(bucket.put).not.toHaveBeenCalled()
    expect(repo.completePdfBookmark).not.toHaveBeenCalled()
  })
  it('uses the embedded PDF title after extraction instead of the download path', async () => {
    const { service, repo } = wire()
    vi.mocked(publicFetch).mockImplementation(async () => new Response(pdfFixture(['Hello'], [], 'Actual Paper Title'), { headers: { 'Content-Type': 'application/pdf' } }))
    await service.capturePdf(createMockCtx(), 10, 'uuid', 'https://example.com/1234.pdf')
    expect(repo.completePdfBookmark).toHaveBeenCalledWith(10, expect.objectContaining({ title: 'Actual Paper Title' }), expect.anything())
  })
  it.each(['application/pdf', 'APPLICATION/PDF', 'application/pdf; charset=binary'])('detects extensionless responses from %s and persists original plus AI text before type completion', async mediaType => {
    const { service, bucket, repo, bytes } = wire()
    vi.mocked(publicFetch).mockImplementation(async () => new Response(bytes, { headers: { 'Content-Type': mediaType, 'Content-Length': String(bytes.length) } }))
    expect(await service.capturePdf(createMockCtx(), 10, 'uuid', 'https://example.com/download?id=1')).toBe(true)
    expect(publicFetch).toHaveBeenCalledTimes(2)
    expect(bucket.put.mock.calls[0][0]).toBe('pdf/body/uuid.pdf')
    expect(bucket.put.mock.calls[1][0]).toBe('text/pdf/uuid.txt')
    expect(repo.completePdfBookmark).toHaveBeenCalledWith(10, expect.objectContaining({ content_md_key: 'text/pdf/uuid.txt', status: 'success' }), expect.stringMatching(/^[a-f0-9]{64}$/))
  })
  it('cancels HTML probes and retains the HTML capture path', async () => {
    const { service, bucket } = wire()
    vi.mocked(publicFetch).mockResolvedValue(new Response('<p>Article</p>', { headers: { 'Content-Type': 'text/html' } }))
    expect(await service.capturePdf(createMockCtx(), 10, 'uuid', 'https://example.com')).toBe(false)
    expect(bucket.put).not.toHaveBeenCalled()
  })
  it.each(['application/octet-stream', '', 'text/html', 'application/pdfx', 'text/plain; note=application/pdf'])('does not classify HTML from misleading URLs or Content-Type %s', async mediaType => {
    const { service, bucket, labRepo } = wire()
    labRepo.isEnabled.mockResolvedValue(false)
    vi.mocked(publicFetch).mockImplementation(async () => new Response('<p>Ordinary article</p>', { headers: mediaType ? { 'Content-Type': mediaType } : {} }))
    for (const url of ['https://example.com/file.pdf', 'https://arxiv.org/pdf/2608.00046', 'https://example.com/download']) {
      expect(await service.capturePdf(createMockCtx(), 10, 'uuid', url)).toBe(false)
    }
    expect(labRepo.isEnabled).not.toHaveBeenCalled()
    expect(bucket.put).not.toHaveBeenCalled()
  })
  it.each(['application/octet-stream', ''])('identifies actual PDF file signatures when Content-Type is %s', async mediaType => {
    const { service, bytes, repo } = wire()
    vi.mocked(publicFetch).mockImplementation(async () => new Response(bytes, { headers: mediaType ? { 'Content-Type': mediaType } : {} }))
    expect(await service.capturePdf(createMockCtx(), 10, 'uuid', 'https://example.com/download')).toBe(true)
    expect(repo.completePdfBookmark).toHaveBeenCalled()
  })
  it('identifies PDF signatures split between short response chunks', async () => {
    const { service, bytes } = wire()
    vi.mocked(publicFetch).mockResolvedValueOnce(new Response(new ReadableStream({ start(controller) {
      controller.enqueue(bytes.subarray(0, 3)); controller.enqueue(bytes.subarray(3, 8)); controller.close()
    } }))).mockResolvedValueOnce(new Response(bytes))
    expect(await service.capturePdf(createMockCtx(), 10, 'uuid', 'https://example.com/download')).toBe(true)
  })
  it('persists embedded authors for the existing detail and AI paths', async () => {
    const { service, repo } = wire()
    vi.mocked(publicFetch).mockImplementation(async () => new Response(pdfFixture(['Hello'], [], 'Paper', 'Jane Doe'), { headers: { 'Content-Type': 'application/pdf' } }))
    await service.capturePdf(createMockCtx(), 10, 'uuid', 'https://example.com/download')
    expect(repo.completePdfBookmark).toHaveBeenCalledWith(10, expect.objectContaining({ byline: 'Jane Doe' }), expect.anything())
  })
  it('cancels a PDF response when Labs rejects before reading the body', async () => {
    const { service, labRepo } = wire()
    labRepo.isEnabled.mockResolvedValue(false)
    const pull = vi.fn()
    const cancel = vi.fn()
    vi.mocked(publicFetch).mockResolvedValue(new Response(new ReadableStream({ pull, cancel }, { highWaterMark: 0 }), { headers: { 'Content-Type': 'application/pdf' } }))
    await expect(service.capturePdf(createMockCtx(), 10, 'uuid', 'https://example.com/download')).rejects.toMatchObject({ name: 'LAB_FEATURE_DISABLED' })
    expect(pull).not.toHaveBeenCalled()
    expect(cancel).toHaveBeenCalledOnce()
  })
  it('rejects an unsuccessful PDF response and malformed advertised PDF bytes', async () => {
    const { service, bucket } = wire()
    vi.mocked(publicFetch).mockResolvedValueOnce(new Response('Unavailable', { status: 404, headers: { 'Content-Type': 'application/pdf' } }))
    await expect(service.capturePdf(createMockCtx(), 10, 'uuid', 'https://example.com/download')).rejects.toThrow('PDF download failed')
    vi.mocked(publicFetch).mockImplementation(async () => new Response('<html>Error</html>', { headers: { 'Content-Type': 'application/pdf' } }))
    await expect(service.capturePdf(createMockCtx(), 10, 'uuid', 'https://example.com/download')).rejects.toThrow('Invalid PDF file')
    expect(bucket.put).not.toHaveBeenCalled()
  })
  it('does not classify failed requests by their URL suffix', async () => {
    const { service, labRepo } = wire()
    vi.mocked(publicFetch).mockRejectedValueOnce(new Error('Network failure')).mockResolvedValueOnce(new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/html' } }))
    expect(await service.capturePdf(createMockCtx(), 10, 'uuid', 'https://example.com/file.pdf')).toBe(false)
    expect(await service.capturePdf(createMockCtx(), 10, 'uuid', 'https://example.com/file.pdf')).toBe(false)
    expect(labRepo.isEnabled).not.toHaveBeenCalled()
  })
  it('bounds decoded bytes rather than the compressed response length', async () => {
    const { service, bytes } = wire()
    vi.mocked(publicFetch).mockImplementation(async () => new Response(bytes, { headers: { 'Content-Type': 'application/pdf', 'Content-Encoding': 'gzip', 'Content-Length': '10' } }))
    expect(await service.capturePdf(createMockCtx(), 10, 'uuid', 'https://example.com/download')).toBe(true)
  })
  it('persists intact bytes before PDF.js takes ownership of the buffer', async () => {
    const { service, bucket, bytes } = wire()
    let saved: Uint8Array | undefined
    bucket.put.mockImplementation(async (key: string, value: unknown) => {
      if (key.endsWith('.pdf')) saved = new Uint8Array(value as Uint8Array)
      return {}
    })
    vi.mocked(publicFetch).mockImplementation(async () => new Response(bytes, { headers: { 'Content-Type': 'application/pdf' } }))
    await service.capturePdf(createMockCtx(), 10, 'uuid', 'https://example.com/download')
    expect(saved).toEqual(bytes)
  })
  it('keeps preview available when text extraction fails', async () => {
    const { service, bucket, repo } = wire()
    vi.mocked(publicFetch).mockImplementation(async () => new Response('%PDF-invalid', { headers: { 'Content-Type': 'application/pdf' } }))
    expect(await service.capturePdf(createMockCtx(), 10, 'uuid', 'https://example.com/download')).toBe(true)
    expect(bucket.put).toHaveBeenCalledWith('pdf/meta/uuid.json', JSON.stringify({ text_status: 'failed', pages: 0 }), expect.anything())
    expect(repo.completePdfBookmark).toHaveBeenCalledWith(10, expect.objectContaining({ content_key: 'pdf/body/uuid.pdf', content_md_key: '', status: 'success' }), expect.anything())
    expect(bucket.delete).not.toHaveBeenCalled()
  })
  it('cleans new objects on database failure', async () => {
    const { service, bucket, repo, bytes } = wire()
    repo.completePdfBookmark.mockRejectedValue(new Error('db failed'))
    vi.mocked(publicFetch).mockImplementation(async () => new Response(bytes, { headers: { 'Content-Type': 'application/pdf', 'Content-Length': String(bytes.length) } }))
    await expect(service.capturePdf(createMockCtx(), 10, 'uuid', 'https://example.com/file.pdf')).rejects.toThrow('db failed')
    expect(bucket.delete).toHaveBeenCalledWith(['pdf/body/uuid.pdf', 'text/pdf/uuid.txt', 'pdf/meta/uuid.json'])
  })
  it('does not refetch or replace an already saved PDF on retry', async () => {
    const { service, bucket, repo, object } = wire()
    bucket.head.mockResolvedValue(object())
    repo.getBookmarkById.mockResolvedValue({ content_key: 'pdf/body/uuid.pdf', content_md_key: 'text/pdf/uuid.txt' })
    expect(await service.capturePdf(createMockCtx(), 10, 'uuid', 'https://example.com/file.pdf')).toBe(true)
    bucket.head.mockResolvedValue(object())
    expect(publicFetch).not.toHaveBeenCalled()
    expect(bucket.put).not.toHaveBeenCalled()
  })
  it('finishes accepted upload extraction and metadata titles after PDF Labs is disabled', async () => {
    const { service, bucket, repo, labRepo } = wire()
    const bytes = pdfFixture(['Uploaded text'], [], 'Uploaded Document Title')
    labRepo.isEnabled.mockResolvedValue(false)
    repo.getBookmarkById.mockResolvedValue({ content_key: 'pdf/body/saved.pdf', content_md_key: '' })
    bucket.head.mockResolvedValue({ size: bytes.length, customMetadata: { source: 'upload', filename: 'upload.pdf' } })
    bucket.get.mockImplementation(async (key: string) => key.startsWith('pdf/meta/')
      ? { json: async () => ({ text_status: 'pending', pages: 0 }) }
      : { size: bytes.length, customMetadata: { source: 'upload', filename: 'upload.pdf' }, body: new Response(bytes).body })
    expect(await service.capturePdf(createMockCtx(), 10, 'uuid', 'slax-pdf://7/hash')).toBe(true)
    expect(publicFetch).not.toHaveBeenCalled()
    expect(bucket.put.mock.calls.map(call => call[0])).toEqual(['text/pdf/saved.txt', 'pdf/meta/saved.json'])
    expect(repo.completePdfBookmark).toHaveBeenCalledWith(10, expect.objectContaining({ title: 'Uploaded Document Title', content_key: 'pdf/body/saved.pdf' }), expect.anything())
    expect(repo.completePdfBookmark.mock.calls[0][1]).not.toHaveProperty('alias_title')
  })
  it('never decodes PDF binary through the HTML content getter', async () => {
    const { service, bucket } = wire()
    expect(await service.getBookmarkContent('pdf/body/uuid.pdf')).toBeUndefined()
    expect(bucket.get).not.toHaveBeenCalled()
  })
  it('blocks empty PDF AI input before returning a model request', async () => {
    const { service } = wire()
    Object.assign(service, { getBookmarkId: async () => 10, getBookmarkById: async () => ({ content_key: 'pdf/body/uuid.pdf', content_md_key: '' }) })
    await expect(service.getBookmarkTitleContent(createMockCtx(), { bmUId: 'uuid' })).rejects.toMatchObject({ name: 'PDF_TEXT_UNAVAILABLE' })
  })
})
describe('PDF upload', () => {
  it('rejects anonymous uploads before resolving the controller', async () => {
    const resolve = vi.fn()
    const router = getRouter({ resolve } as never)
    await expect(router.fetch(new Request('https://reader.test/v1/bookmark/upload_pdf', { method: 'POST', body: pdfFixture() }), createMockCtx({ userId: 0 }))).rejects.toMatchObject({ errCode: 401 })
    expect(resolve).not.toHaveBeenCalled()
  })
  function uploadWire(existing = false) {
    const value = wire()
    const create = vi.fn().mockResolvedValue({ id: 10, content_key: existing ? 'pdf/body/saved.pdf' : '' })
    Object.assign(value.service, { createBookmarkBase: create, crawlService: { createWorkflow: vi.fn() } })
    Object.assign(value.repo, { getUserBookmarkWithDetail: vi.fn().mockResolvedValue({ uuid: 'saved' }), updateBookmarkStatus: vi.fn() })
    return { ...value, create }
  }
  it('rejects upload with Labs off before consuming its body or creating rows', async () => {
    const { service, create, bucket, labRepo } = uploadWire()
    labRepo.isEnabled.mockResolvedValue(false)
    const pull = vi.fn()
    const body = new ReadableStream<Uint8Array>({ pull }, { highWaterMark: 0 })
    await expect(service.uploadPdf(createMockCtx(), new Request('https://example.com/upload', { method: 'POST', body, duplex: 'half' } as RequestInit))).rejects.toMatchObject({ name: 'LAB_FEATURE_DISABLED' })
    expect(pull).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
    expect(bucket.put).not.toHaveBeenCalled()
    await body.cancel()
  })
  it('creates a private filename-titled PDF and schedules text extraction after storage', async () => {
    const { service, create, bucket, repo } = uploadWire()
    bucket.head.mockResolvedValue(null)
    bucket.get.mockResolvedValue({ json: async () => ({ text_status: 'pending', pages: 0 }) })
    // Descriptor reads require the newly stored object's head.
    bucket.put.mockImplementation(async (key: string) => { if (key.endsWith('.pdf')) bucket.head.mockResolvedValue({ size: 100, customMetadata: { source: 'upload' } }); return {} })
    const result = await service.uploadPdf(createMockCtx({ userId: 7 }), new Request('https://example.com/upload?filename=%E6%B5%8B%E8%AF%95.pdf', { method: 'POST', body: pdfFixture() }))
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ privateUser: 7, type: 2, title: '测试', targetUrl: expect.stringMatching(/^slax-pdf:\/\/7\/[a-f0-9]{64}$/) }))
    expect(result.bookmark_uid).toBe('saved')
    expect(repo.completePdfBookmark).toHaveBeenCalledWith(10, expect.objectContaining({ content_md_key: '', status: 'success' }), expect.anything())
    expect((service as any).crawlService.createWorkflow).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ url: expect.stringMatching(/^slax-pdf:/) }), 3, expect.anything())
  })
  it('reuses duplicate uploads without replacing files or restarting completed extraction', async () => {
    const { service, bucket, object } = uploadWire(true)
    bucket.head.mockResolvedValue(object())
    expect((await service.uploadPdf(createMockCtx(), new Request('https://example.com/upload?filename=new.pdf', { method: 'POST', body: pdfFixture() }))).bookmark_uid).toBe('saved')
    expect(bucket.put).not.toHaveBeenCalled()
    expect((service as any).crawlService.createWorkflow).not.toHaveBeenCalled()
  })
  it('does not clean up or fail a competing upload that won the conditional file write', async () => {
    const { service, bucket, repo } = uploadWire()
    bucket.put.mockResolvedValue(null as never)
    await expect(service.uploadPdf(createMockCtx(), new Request('https://example.com/upload', { method: 'POST', body: pdfFixture() }))).rejects.toThrow('already in progress')
    expect(bucket.put).toHaveBeenCalledTimes(1)
    expect(bucket.put.mock.calls[0][2]?.onlyIf?.get('If-None-Match')).toBe('*')
    expect(bucket.delete).not.toHaveBeenCalled()
    expect((repo as any).updateBookmarkStatus).not.toHaveBeenCalled()
    expect(repo.completePdfBookmark).not.toHaveBeenCalled()
  })
  it('preserves an in-progress file observed before a duplicate upload writes', async () => {
    const { service, bucket, repo, object } = uploadWire()
    bucket.head.mockResolvedValue(object())
    await expect(service.uploadPdf(createMockCtx(), new Request('https://example.com/upload', { method: 'POST', body: pdfFixture() }))).rejects.toThrow('already in progress')
    expect(bucket.put).not.toHaveBeenCalled()
    expect(bucket.delete).not.toHaveBeenCalled()
    expect((repo as any).updateBookmarkStatus).not.toHaveBeenCalled()
  })
  it('rejects invalid bytes before creating a bookmark', async () => {
    const { service, create } = uploadWire()
    await expect(service.uploadPdf(createMockCtx(), new Request('https://example.com/upload', { method: 'POST', body: 'not PDF' }))).rejects.toBeTruthy()
    expect(create).not.toHaveBeenCalled()
  })
  it('cleans new file objects and marks a partially created upload as failed on storage failure', async () => {
    const { service, bucket, repo } = uploadWire()
    bucket.put.mockImplementation(async (key: string) => { if (!key.endsWith('.pdf')) throw new Error('storage failed'); return {} })
    await expect(service.uploadPdf(createMockCtx(), new Request('https://reader.test/upload', { method: 'POST', body: pdfFixture() }))).rejects.toThrow('storage failed')
    expect(bucket.delete).toHaveBeenCalledWith(['pdf/body/saved.pdf', 'text/pdf/saved.txt', 'pdf/meta/saved.json'])
    expect((repo as any).updateBookmarkStatus).toHaveBeenCalledWith(10, 'failed')
  })
})
describe('PDF file delivery', () => {
  it('keeps authorized existing PDFs readable after PDF Labs is disabled', async () => {
    const { service, bucket, object, labRepo } = wire()
    labRepo.isEnabled.mockResolvedValue(false)
    Object.assign(service, { getBookmarkReadAccess: vi.fn().mockResolvedValue({ bookmark: { bookmark: { content_key: 'pdf/body/uuid.pdf' } } }) })
    bucket.head.mockResolvedValue(object())
    const response = await service.getPdfResponse(createMockCtx(), 'uuid', new Request('https://example.com'))
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('application/pdf')
    expect(labRepo.isEnabled).not.toHaveBeenCalled()
    await response.body?.cancel()
  })
  it('uses read authorization on every request before R2 and rejects unrelated readers', async () => {
    const { service, bucket } = wire()
    Object.assign(service, { getBookmarkReadAccess: vi.fn().mockResolvedValue(null) })
    expect((await service.getPdfResponse(createMockCtx(), 'uuid', new Request('https://example.com', { headers: { Range: 'bytes=0-2' } }))).status).toBe(404)
    expect(bucket.head).not.toHaveBeenCalled()
  })
  it('streams single ranges and answers HEAD without reading the object body', async () => {
    const { service, bucket, bytes, object } = wire()
    Object.assign(service, { getBookmarkReadAccess: vi.fn().mockResolvedValue({ bookmark: { bookmark: { content_key: 'pdf/body/uuid.pdf' } } }) })
    bucket.head.mockResolvedValue(object())
    const head = await service.getPdfResponse(createMockCtx(), 'uuid', new Request('https://example.com', { method: 'HEAD' }))
    expect(head.status).toBe(200)
    expect(head.headers.get('Content-Length')).toBe(String(bytes.length))
    expect(bucket.get).not.toHaveBeenCalled()
    const range = await service.getPdfResponse(createMockCtx(), 'uuid', new Request('https://example.com', { headers: { Range: 'bytes=0-3' } }))
    expect(range.status).toBe(206)
    expect(bucket.get).toHaveBeenCalledWith('pdf/body/uuid.pdf', { range: { offset: 0, length: 4 } })
    expect((await service.getPdfResponse(createMockCtx(), 'uuid', new Request('https://example.com', { headers: { Range: 'bytes=999999-' } }))).status).toBe(416)
  })
})
