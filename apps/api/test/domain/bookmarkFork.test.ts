import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SearchService } from '@/domain/search'
import { BookmarkForkService } from '@/domain/bookmarkFork'
import { memoryBucket } from '../utils/snapshotBucket'

describe('Fork service publication boundary', () => {
  let service: BookmarkForkService
  let source: any
  let repo: any
  let bucket: ReturnType<typeof memoryBucket>
  let effects: any
  const ctx = { getUserId: () => 2, env: { FRONT_END_URL: 'https://reader.test' }, execution: { waitUntil: vi.fn() } } as any
  beforeEach(async () => {
    bucket = memoryBucket()
    await bucket.bucket.put('original.html', '<html><body><article>Original</article></body></html>')
    source = {
      id: 11,
      uuid: '1ac0b3d6-3b65-4d6b-8412-6dcccb903adc',
      user_id: 1,
      bookmark_id: 10,
      type: 0,
      metadata: {},
      owner: { name: 'Source owner' },
      share: null,
      bookmark: { id: 10, target_url: 'https://example.com/story', status: 'success', content_key: 'original.html', content_md_key: 'original.txt', title: 'Original' }
    }
    repo = {
      source: vi.fn(async () => source),
      existing: vi.fn(async () => null),
      reconcile: vi.fn(async () => null),
      referenced: vi.fn(async () => false),
      publish: vi.fn(async (input: any) => ({
        disposition: 'created',
        relation: { id: 21, uuid: input.uuid, bookmark_id: 20, bookmark: { ...source.bookmark, ...input.content } }
      }))
    }
    effects = vi.fn(async () => {})
    service = Object.assign(Object.create(BookmarkForkService.prototype), {
      cleanup: { registerBundle: async () => {} },
      repo,
      search: { clearSearchCache: async () => {} },
      bucket: () => ({ R2Bucket: bucket.bucket }),
      labs: { assertUrlAllowed: vi.fn(), assertEnabled: vi.fn() },
      media: { copyForFork: vi.fn() },
      afterCommit: effects
    })
  })

  it('applies the acquisition gate to the resolved podcast kind', async () => {
    ;(service as any).media.copyForFork.mockResolvedValue({ ref: { media_kind: 'podcast', source_id: 'episode', source_hash: 'hash' } })
    ;(service as any).labs.assertEnabled.mockRejectedValue(new Error('Podcast Labs disabled'))
    await expect(service.fork(ctx, source.uuid)).rejects.toThrow('Podcast Labs disabled')
    expect((service as any).labs.assertEnabled).toHaveBeenCalledWith(ctx, 'podcast')
    expect(repo.publish).not.toHaveBeenCalled()
    expect([...bucket.objects.keys()].filter(key => key.startsWith('snapshots/'))).toHaveLength(0)
  })

  it('leaves a confirmed copy readable when a post-commit index operation fails', async () => {
    effects.mockRejectedValueOnce(new Error('index offline'))
    const result = await service.fork(ctx, source.uuid)
    expect(result.disposition).toBe('created')
    const input = repo.publish.mock.calls[0][0]
    expect(bucket.objects.has(input.content.content_key)).toBe(true)
  })

  it('reconciles COMMIT then timeout as success without deleting published objects', async () => {
    repo.publish.mockImplementation(async (input: any) => {
      repo.reconcile.mockResolvedValue({ uuid: input.uuid, bookmark_id: 20, bookmark: { ...source.bookmark, ...input.content } })
      throw new Error('COMMIT acknowledgement lost')
    })
    const result = await service.fork(ctx, source.uuid)
    expect(result.disposition).toBe('created')
    expect(bucket.objects.has(repo.publish.mock.calls[0][0].content.content_key)).toBe(true)
  })

  it('retains staged objects when the commit outcome cannot be resolved', async () => {
    repo.publish.mockRejectedValue(new Error('connection lost'))
    repo.reconcile.mockRejectedValue(new Error('database unavailable'))
    await expect(service.fork(ctx, source.uuid)).rejects.toMatchObject({ name: 'fork_storage_unavailable' })
    expect(bucket.objects.has(repo.publish.mock.calls[0][0].content.content_key)).toBe(true)
  })

  it('returns a successful existing destination without reading source storage', async () => {
    repo.existing.mockResolvedValue({ uuid: 'existing', bookmark_id: 20 })
    bucket.objects.clear()
    expect(await service.fork(ctx, source.uuid)).toMatchObject({ bookmark_uid: 'existing', disposition: 'already_saved' })
    expect(repo.publish).not.toHaveBeenCalled()
  })

  it.each(['existing', 'ownSource'])('clears cached search visibility after %s restores a successful copy', async path => {
    const cache = new Map([['search:valid_bm_ids:2', '[]']])
    const restore = async () => ({ uuid: 'restored', bookmark_id: 20 })
    repo[path] = vi.fn(restore)
    if (path === 'ownSource') source.user_id = 2
    const search = Object.create(SearchService.prototype)
    Object.assign(service, { search })
    const result = await service.fork(
      {
        ...ctx,
        env: {
          ...ctx.env,
          KV: { delete: async (key: string) => cache.delete(key) }
        }
      },
      source.uuid
    )
    expect(result).toMatchObject({
      bookmark_uid: 'restored',
      disposition: 'already_saved'
    })
    expect(cache.has('search:valid_bm_ids:2')).toBe(false)
    expect(effects).not.toHaveBeenCalled()
    expect(repo.publish).not.toHaveBeenCalled()
  })

  it('does not disclose or copy an inaccessible source', async () => {
    repo.source.mockResolvedValue(null)
    await expect(service.fork(ctx, source.uuid)).rejects.toMatchObject({ name: 'BOOKMARK_NOT_FOUND' })
    expect(repo.existing).not.toHaveBeenCalled()
  })

  it.each(['ready', 'empty', 'failed'])('copies terminal PDF %s with independent binary, metadata and optional text', async status => {
    source.type = 2
    source.metadata = { pdf_document_id: 'a'.repeat(64) }
    Object.assign(source.bookmark, {
      target_url: `slax-pdf://1/${'a'.repeat(64)}`,
      content_key: 'pdf/body/source.pdf',
      content_md_key: status === 'ready' ? 'text/pdf/source.txt' : '',
      content_word_count: status === 'ready' ? 8 : 0
    })
    await bucket.bucket.put('pdf/body/source.pdf', '%PDF-original', { customMetadata: { filename: 'source.pdf', sha256: 'a'.repeat(64), source: 'upload' } })
    await bucket.bucket.put('pdf/meta/source.json', JSON.stringify({ text_status: status, pages: 2 }))
    if (status === 'ready') await bucket.bucket.put('text/pdf/source.txt', 'PDF text')
    await service.fork(ctx, source.uuid)
    const input = repo.publish.mock.calls[0][0]
    expect(input.targetUrl).toBe(`slax-pdf://2/${'a'.repeat(64)}`)
    expect(input.pdfDocumentId).toBe('a'.repeat(64))
    await bucket.bucket.delete(['pdf/body/source.pdf', 'pdf/meta/source.json', 'text/pdf/source.txt'])
    expect(await (await bucket.bucket.get(input.content.content_key))?.text()).toBe('%PDF-original')
    expect(input.content.content_md_key ? await (await bucket.bucket.get(input.content.content_md_key))?.text() : '').toBe(status === 'ready' ? 'PDF text' : '')
  })

  it('refuses a PDF whose extraction sidecar is still pending', async () => {
    source.type = 2
    source.metadata = { pdf_document_id: 'a'.repeat(64) }
    source.bookmark.content_key = 'pdf/body/source.pdf'
    await bucket.bucket.put('pdf/body/source.pdf', '%PDF-original', { customMetadata: { sha256: 'a'.repeat(64) } })
    await bucket.bucket.put('pdf/meta/source.json', JSON.stringify({ text_status: 'pending', pages: 2 }))
    await expect(service.fork(ctx, source.uuid)).rejects.toMatchObject({ name: 'fork_source_not_ready' })
    expect(repo.publish).not.toHaveBeenCalled()
  })

  it('renders neutral attribution when a previously forked PDF identity is no longer verifiable', async () => {
    const destination = { ...source, forked_from_id: 10, bookmark: { ...source.bookmark, target_url: `slax-pdf://2/${'b'.repeat(64)}` } }
    repo.source.mockResolvedValue(destination)
    repo.sourceById = vi.fn(async () => ({ ...source, metadata: {}, bookmark: { ...source.bookmark, target_url: `slax-pdf://1/${'b'.repeat(64)}` } }))
    expect(await service.metadata(ctx, source.uuid)).toMatchObject({ has_fork: true, fork: { status: 'unavailable' } })
  })
})
