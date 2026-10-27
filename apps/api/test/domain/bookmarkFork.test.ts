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
      viewerStatus: vi.fn(async () => null),
      mediaRef: vi.fn(async () => null),
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

  it('refreshes an existing destination using its fixed UUID and preserves identity', async () => {
    const existing = {
      id: 21,
      uuid: 'existing',
      bookmark_id: 20,
      bookmark: { ...source.bookmark, id: 20, private_user: 2, updated_at: new Date(), content_key: 'html/body/existing.html' }
    }
    repo.existing.mockResolvedValue(existing)
    repo.claimWrite = vi.fn(async () => true)
    repo.failWrite = vi.fn(async () => true)
    repo.publish.mockImplementation(async (input: any) => ({ disposition: 'updated', relation: { ...existing, bookmark: { ...existing.bookmark, ...input.content } } }))
    await bucket.bucket.put('html/body/existing.html', 'previous')
    expect(await service.fork(ctx, source.uuid)).toMatchObject({ bookmark_uid: 'existing', disposition: 'updated' })
    expect(await (await bucket.bucket.get('html/body/existing.html'))!.text()).toContain('Original')
    expect(repo.publish.mock.calls[0][0].destination).toMatchObject({ id: 21, bookmark_id: 20 })
  })

  it('does not overwrite files when another request owns the existing destination', async () => {
    repo.existing.mockResolvedValue({ id: 21, uuid: 'existing', bookmark_id: 20, bookmark: { updated_at: new Date() } })
    repo.claimWrite = vi.fn(async () => false)
    await expect(service.fork(ctx, source.uuid)).rejects.toMatchObject({ name: 'fork_destination_in_progress' })
    expect(repo.publish).not.toHaveBeenCalled()
  })

  it('keeps fixed files after an existing update fails', async () => {
    repo.existing.mockResolvedValue({ id: 21, uuid: 'existing', bookmark_id: 20, bookmark: { updated_at: new Date() } })
    repo.claimWrite = vi.fn(async () => true)
    repo.failWrite = vi.fn(async () => true)
    repo.publish.mockRejectedValue(new Error('commit unavailable'))
    await bucket.bucket.put('html/body/existing.html', 'previous')
    await expect(service.fork(ctx, source.uuid)).rejects.toMatchObject({ name: 'fork_storage_unavailable' })
    expect(bucket.objects.has('html/body/existing.html')).toBe(true)
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
    expect(await service.metadata(ctx, destination)).toMatchObject({ has_fork: true, fork: { status: 'unavailable' } })
  })
  function admission() {
    source.bookmark.updated_at = new Date('2026-01-01T00:00:00Z')
    const relation = {
      id: 21,
      uuid: 'destination',
      bookmark_id: 20,
      forked_from_id: source.id,
      deleted_at: null,
      bookmark: { ...source.bookmark, id: 20, status: 'parseing', updated_at: new Date('2026-01-02T00:00:00Z'), content_key: '' }
    }
    repo.admit = vi.fn(async () => ({ disposition: 'created', relation }))
    repo.ownsWrite = vi.fn(async () => true)
    repo.failWrite = vi.fn(async () => true)
    ctx.getEncodeUserId = () => 200
    ctx.getlang = () => 'en'
    ctx.env.CRAWL_WORKFLOW = { create: vi.fn(async () => ({})) }
    return relation
  }

  it('uses the supplied local UUID only when reserving a new destination', async () => {
    admission()
    const localUuid = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
    await service.admit(ctx, source.uuid, localUuid)
    expect(repo.admit).toHaveBeenCalledWith(expect.objectContaining({ uuid: localUuid }))
  })

  it('rejects a malformed client UUID before admission', async () => {
    admission()
    await expect(service.admit(ctx, source.uuid, 'not-a-uuid')).rejects.toThrow()
    expect(repo.admit).not.toHaveBeenCalled()
  })

  it('runs independent acquisition checks together and waits for all of them before admission', async () => {
    admission()
    source.bookmark.content_key = 'pdf/body/source.pdf'
    let releaseUrl!: () => void
    const urlResult = new Promise<void>(resolve => {
      releaseUrl = resolve
    })
    ;(service as any).labs.assertUrlAllowed.mockReturnValue(urlResult)
    const result = service.admit(ctx, source.uuid)
    try {
      await Promise.resolve()
      expect((service as any).labs.assertEnabled).toHaveBeenCalledWith(ctx, 'pdf')
      expect(repo.mediaRef).toHaveBeenCalledWith(10)
      expect(repo.admit).not.toHaveBeenCalled()
      expect(ctx.env.CRAWL_WORKFLOW.create).not.toHaveBeenCalled()
    } finally {
      releaseUrl()
    }
    expect(await result).toMatchObject({
      disposition: 'created',
      bookmark_id: 20
    })
  })

  it('preserves acquisition-error priority and does not admit after any check fails', async () => {
    admission()
    ;(service as any).labs.assertUrlAllowed.mockRejectedValue(new Error('URL disabled'))
    repo.mediaRef.mockRejectedValue(new Error('media unavailable'))
    await expect(service.admit(ctx, source.uuid)).rejects.toThrow('URL disabled')
    expect(repo.admit).not.toHaveBeenCalled()
    expect(ctx.env.CRAWL_WORKFLOW.create).not.toHaveBeenCalled()
  })

  it('acknowledges admission before blocked R2 work and binds the Workflow to the accepted revision', async () => {
    admission()
    const read = vi.spyOn(bucket.bucket, 'get').mockImplementation(() => new Promise(() => {}))
    const result = await service.admit(ctx, source.uuid)
    expect(result).toEqual({ bookmark_uid: 'destination', bookmark_id: 20, disposition: 'created' })
    expect(read).not.toHaveBeenCalled()
    expect(ctx.env.CRAWL_WORKFLOW.create).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'fork-20-1767312000000',
        params: expect.objectContaining({ bookmarkId: 20, fork: expect.objectContaining({ sourceId: 11, revision: '2026-01-02T00:00:00.000Z' }) })
      })
    )
  })

  it.each(['errored', 'terminated'])('releases a dispatch confirmed %s at only its accepted timestamp', async status => {
    const relation = admission()
    ctx.env.CRAWL_WORKFLOW.create.mockRejectedValue(new Error('unavailable'))
    ctx.env.CRAWL_WORKFLOW.get = vi.fn(async () => ({ status: async () => ({ status }) }))
    await expect(service.admit(ctx, source.uuid)).rejects.toMatchObject({ name: 'fork_storage_unavailable' })
    expect(repo.failWrite).toHaveBeenCalledWith(20, relation.bookmark.updated_at)
    expect(repo.publish).not.toHaveBeenCalled()
  })

  it('returns a concurrent accepted winner without dispatching a second Workflow', async () => {
    const relation = admission()
    repo.admit.mockResolvedValue({ disposition: 'already_saved', relation })
    ctx.env.CRAWL_WORKFLOW.get = vi.fn(async () => ({ status: async () => ({ status: 'running' }) }))
    expect(await service.admit(ctx, source.uuid)).toMatchObject({ bookmark_uid: 'destination', disposition: 'already_saved' })
    expect(ctx.env.CRAWL_WORKFLOW.create).not.toHaveBeenCalled()
  })

  it('does not acknowledge duplicate B while admitted A has no confirmed durable dispatch', async () => {
    const relation = admission()
    let rejectDispatch!: (error: Error) => void
    let entered!: () => void
    const dispatchEntered = new Promise<void>(resolve => {
      entered = resolve
    })
    ctx.env.CRAWL_WORKFLOW.create.mockImplementation(() => {
      entered()
      return new Promise((_, reject) => {
        rejectDispatch = reject
      })
    })
    ctx.env.CRAWL_WORKFLOW.get = vi.fn().mockRejectedValue(new Error('instance not found'))
    repo.admit.mockResolvedValueOnce({ disposition: 'created', relation }).mockResolvedValue({ disposition: 'already_saved', relation })
    const first = service.admit(ctx, source.uuid).catch(error => error)
    await dispatchEntered
    await expect(service.admit(ctx, source.uuid)).rejects.toMatchObject({ name: 'fork_storage_unavailable' })
    rejectDispatch(new Error('creation rejected'))
    expect(await first).toMatchObject({ name: 'fork_storage_unavailable' })
    expect(ctx.env.CRAWL_WORKFLOW.create).toHaveBeenCalledOnce()
    expect(repo.failWrite).not.toHaveBeenCalled()
  })

  it('exits stale background work before reading or overwriting any files', async () => {
    admission()
    await service.admit(ctx, source.uuid)
    const job = ctx.env.CRAWL_WORKFLOW.create.mock.calls[0][0].params.fork
    repo.ownsWrite.mockResolvedValue(false)
    const before = [...bucket.objects.keys()]
    await service.execute(ctx, 20, job)
    expect([...bucket.objects.keys()]).toEqual(before)
    expect(repo.publish).not.toHaveBeenCalled()
  })

  it('retries a transient copy while keeping the admitted write active', async () => {
    admission()
    await service.admit(ctx, source.uuid)
    const job = ctx.env.CRAWL_WORKFLOW.create.mock.calls[0][0].params.fork
    repo.snapshot = vi.fn(async () => ({ content_key: '' }))
    const get = vi.spyOn(bucket.bucket, 'get')
    get.mockRejectedValueOnce(new Error('transient R2 error'))
    await expect(service.execute(ctx, 20, job)).rejects.toThrow('transient R2 error')
    expect(repo.failWrite).not.toHaveBeenCalled()
    await service.execute(ctx, 20, job)
    expect(repo.publish).toHaveBeenCalledOnce()
    expect(await (await bucket.bucket.get('html/body/destination.html'))?.text()).toContain('Original')
  })

  it.each(['pending', 'pending_retry', 'parseing', 'success', 'failed'])('projects viewer Fork state for %s', async status => {
    repo.viewerStatus = vi.fn(async () => (status === 'success' || status === 'failed' ? status : 'pending'))
    source.forked_from_id = null
    expect(await service.metadata(ctx, source)).toMatchObject({ viewer_fork_status: status === 'success' || status === 'failed' ? status : 'pending' })
  })

  it('never queries another viewer state for an anonymous request', async () => {
    repo.viewerStatus = vi.fn()
    source.forked_from_id = null
    expect(await service.metadata({ ...ctx, getUserId: () => 0 }, source)).toMatchObject({ viewer_fork_status: null })
    expect(repo.viewerStatus).not.toHaveBeenCalled()
  })

  it('does not write fixed files when dispatch cancellation wins during a blocked source read', async () => {
    admission()
    await service.admit(ctx, source.uuid)
    const job = ctx.env.CRAWL_WORKFLOW.create.mock.calls[0][0].params.fork
    repo.snapshot = vi.fn(async () => ({ content_key: '' }))
    const read = bucket.bucket.get.bind(bucket.bucket)
    vi.spyOn(bucket.bucket, 'get').mockImplementation(async (...args: any[]) => {
      const value = await read(args[0])
      repo.ownsWrite.mockResolvedValue(false)
      return value
    })
    await expect(service.execute(ctx, 20, job)).rejects.toThrow()
    expect(bucket.objects.has('html/body/destination.html')).toBe(false)
    expect(repo.publish).not.toHaveBeenCalled()
  })

  it.each(['identity', 'revision', 'access'])('rejects a changed source %s before copy', async reason => {
    admission()
    await service.admit(ctx, source.uuid)
    const job = ctx.env.CRAWL_WORKFLOW.create.mock.calls[0][0].params.fork
    if (reason === 'identity') source.id++
    if (reason === 'revision') source.bookmark.updated_at = new Date()
    if (reason === 'access') repo.source.mockResolvedValue(null)
    await expect(service.execute(ctx, 20, job)).rejects.toMatchObject({ name: 'fork_source_not_ready' })
    expect(repo.publish).not.toHaveBeenCalled()
    expect(bucket.objects.has('html/body/destination.html')).toBe(false)
  })
  it.each(['podcast', 'youtube'])('rejects a resolved %s source before admission when its acquisition Lab is disabled', async kind => {
    admission()
    repo.mediaRef.mockResolvedValue({ media_kind: kind, source_id: 'episode', source_hash: 'hash' })
    ;(service as any).labs.assertEnabled.mockRejectedValue(new Error('Podcast Labs disabled'))
    await expect(service.admit(ctx, source.uuid)).rejects.toThrow('Podcast Labs disabled')
    expect(repo.admit).not.toHaveBeenCalled()
    expect(ctx.env.CRAWL_WORKFLOW.create).not.toHaveBeenCalled()
    expect(bucket.objects.has('html/body/destination.html')).toBe(false)
  })

  it.each(['queued', 'running', 'paused', 'waiting', 'waitingForPause', 'complete'])(
    'preserves an accepted dispatch when the lost acknowledgement resolves to %s',
    async status => {
      admission()
      ctx.env.CRAWL_WORKFLOW.create.mockRejectedValue(new Error('acknowledgement lost'))
      ctx.env.CRAWL_WORKFLOW.get = vi.fn(async () => ({ status: async () => ({ status }) }))
      expect(await service.admit(ctx, source.uuid)).toMatchObject({ bookmark_uid: 'destination', disposition: 'created' })
      expect(ctx.env.CRAWL_WORKFLOW.get).toHaveBeenCalledWith('fork-20-1767312000000')
      expect(repo.failWrite).not.toHaveBeenCalled()
    }
  )

  it.each(['unknown', 'lookup-error', 'status-error'])('retains the write claim for an uncertain dispatch: %s', async outcome => {
    admission()
    ctx.env.CRAWL_WORKFLOW.create.mockRejectedValue(new Error('acknowledgement lost'))
    ctx.env.CRAWL_WORKFLOW.get = vi.fn(async () => {
      if (outcome === 'lookup-error') throw new Error('lookup unavailable')
      return {
        status: async () => {
          if (outcome === 'status-error') throw new Error('status unavailable')
          return { status: 'unknown' }
        }
      }
    })
    await expect(service.admit(ctx, source.uuid)).rejects.toMatchObject({ name: 'fork_storage_unavailable' })
    expect(repo.failWrite).not.toHaveBeenCalled()
  })

  it('rechecks the resolved media acquisition gate before background copying', async () => {
    admission()
    repo.snapshot = vi.fn(async () => ({ content_key: '' }))
    await service.admit(ctx, source.uuid)
    const job = ctx.env.CRAWL_WORKFLOW.create.mock.calls[0][0].params.fork
    repo.mediaRef.mockResolvedValue({ media_kind: 'podcast', source_id: 'episode', source_hash: 'hash' })
    ;(service as any).labs.assertEnabled.mockRejectedValue(new Error('Podcast Labs disabled'))
    await expect(service.execute(ctx, 20, job)).rejects.toThrow('Podcast Labs disabled')
    expect(bucket.objects.has('html/body/destination.html')).toBe(false)
  })
})
