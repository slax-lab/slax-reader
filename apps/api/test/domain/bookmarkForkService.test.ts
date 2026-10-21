import { describe, expect, it, vi } from 'vitest'
import { BookmarkForkService } from '@/domain/bookmarkFork'
import { ErrorName } from '@/const/err'

function setup() {
  const source = {
    uuid: 'source-uuid',
    type: 0,
    user_id: 7,
    bookmark_id: 70,
    deleted_at: null,
    bookmark: {
      target_url: 'https://example.com/article',
      title: 'Source',
      host_url: 'example.com',
      site_name: 'Example',
      content_key: 'html/body/source.html',
      content_md_key: 'text/body/source.txt',
      content_word_count: 2,
      description: 'desc',
      byline: 'author',
      status: 'success',
      moderation_result: 0,
      published_at: new Date('2024-01-01')
    }
  }
  const operation = {
    id: 1,
    user_id: 11,
    source_uuid: source.uuid,
    target_bookmark_id: 80,
    target_uuid: 'target-uuid',
    write_version: 1,
    attempt_token: 'attempt-1',
    write_mode: 'created',
    staged_keys: [] as string[],
    status: 'copying',
    result: null
  }
  const forkRepo = {
    findOperation: vi.fn().mockResolvedValue(null),
    begin: vi.fn().mockResolvedValue(operation),
    setStagedKeys: vi.fn().mockResolvedValue(undefined),
    publish: vi.fn().mockResolvedValue(true),
    fail: vi.fn().mockResolvedValue(undefined),
    complete: vi.fn().mockResolvedValue(undefined),
    listPending: vi.fn().mockResolvedValue([]),
    claimStaleStages: vi.fn().mockResolvedValue([]),
    getVectorBucket: vi.fn().mockResolvedValue(null),
    deleteVectorShard: vi.fn().mockResolvedValue(undefined),
    getUnreferencedStageKeys: vi.fn().mockResolvedValue([]),
    completeStageCleanup: vi.fn().mockResolvedValue(undefined)
  }
  const bookmarkService = {
    getBookmarkReadAccess: vi.fn().mockResolvedValue({ bookmark: source, share: { is_enable: true, show_userinfo: true } }),
    refreshBookmarkPublication: vi.fn().mockResolvedValue(undefined),
    updateBookmarkVersionStatus: vi.fn().mockResolvedValue(undefined),
    getBookmarkById: vi.fn().mockRejectedValue(new Error('bookmark deleted'))
  }
  const bucket = {
    R2Bucket: {
      head: vi.fn().mockResolvedValue({ customMetadata: { sha256: 'doc' } }),
      get: vi.fn().mockResolvedValue({ json: async () => ({ text_status: 'ready', pages: 2 }) })
    },
    copyObjects: vi.fn().mockResolvedValue([]),
    deleteObjects: vi.fn().mockResolvedValue(undefined)
  }
  const userRepo = { getInfoByUserId: vi.fn().mockResolvedValue({ name: 'Alice' }) }
  const bookmarkSearchRepo = { deleteBookmarkRaw: vi.fn().mockResolvedValue(undefined) }
  const dbVectorize = { deleteVector: vi.fn().mockResolvedValue(undefined) }
  const ctx = { getUserId: () => 11, env: {}, execution: { waitUntil: vi.fn() }, hashIds: { encodeId: (id: number) => id * 100 } } as any
  const service = new BookmarkForkService(forkRepo as any, bookmarkService as any, () => bucket as any, userRepo as any, bookmarkSearchRepo as any, dbVectorize as any)
  return { source, operation, forkRepo, bookmarkService, bucket, userRepo, bookmarkSearchRepo, dbVectorize, ctx, service }
}

describe('BookmarkForkService', () => {
  it.each([
    'https://x.com/a?a=1&b=2',
    'https://twitter.com/a?a=1&b=2#section',
    'https://mp.weixin.qq.com/s?__biz=article&poc_token=token&mid=123'
  ])('keeps the source URL as the destination identity without fetch normalization: %s', async targetUrl => {
    const s = setup()
    s.source.bookmark.target_url = targetUrl
    await s.service.fork(s.ctx, { bookmark_uid: 'source-uuid' }, 'url-identity')
    expect(s.forkRepo.begin).toHaveBeenCalledWith(11, 'url-identity', 'source-uuid', expect.objectContaining({ target_url: targetUrl }), 0, undefined)
    expect(s.forkRepo.publish.mock.calls[0][2]).toMatchObject({ source_url: targetUrl })
  })

  it('copies the committed article body and text without crawling and publishes private destination lineage', async () => {
    const s = setup()
    const result = await s.service.fork(s.ctx, { bookmark_uid: 'source-uuid' }, 'retry-key')
    expect(s.bucket.copyObjects).toHaveBeenCalledWith([
      { sourceKey: 'html/body/source.html', destinationKey: expect.stringMatching(/^html\/body\/fork\/target-uuid\.v1\./) },
      { sourceKey: 'text/body/source.txt', destinationKey: expect.stringMatching(/^text\/body\/fork\/target-uuid\.v1\./) }
    ])
    expect(s.forkRepo.publish).toHaveBeenCalledWith(
      s.operation,
      expect.objectContaining({ content_key: 'html/body/fork/target-uuid.v1.attempt-1.html', status: 'success' }),
      expect.objectContaining({ source_uuid: 'source-uuid', target_user_id: 11 }),
      expect.objectContaining({ bookmark_uid: 'target-uuid' }),
      expect.any(Object)
    )
    expect(result).toMatchObject({ bookmark_uid: 'target-uuid', write_mode: 'created', fork_info: { bookmark_uid: 'source-uuid', display_name: 'Alice' } })
  })

  it('allows self-fork as a private refresh without self attribution', async () => {
    const s = setup()
    s.source.user_id = 11
    const result = await s.service.fork(s.ctx, { bookmark_uid: 'source-uuid' })
    expect(result.fork_info).toBeNull()
    expect(s.forkRepo.publish.mock.calls[0][2]).toBeNull()
  })

  it.each(['missing', 'deleted', 'pending', 'failed', 'moderated', 'shortcut', 'textless'])('rejects a %s source before reserving a destination', async reason => {
    const s = setup()
    if (reason === 'missing') s.bookmarkService.getBookmarkReadAccess.mockResolvedValue(null)
    if (reason === 'deleted') s.source.deleted_at = new Date() as any
    if (reason === 'pending' || reason === 'failed') s.source.bookmark.status = reason
    if (reason === 'moderated') s.source.bookmark.moderation_result = 1
    if (reason === 'shortcut') s.source.type = 1
    if (reason === 'textless') s.source.bookmark.content_md_key = ''
    await expect(s.service.fork(s.ctx, { bookmark_uid: 'source-uuid' })).rejects.toBeTruthy()
    expect(s.forkRepo.begin).not.toHaveBeenCalled()
    expect(s.bucket.copyObjects).not.toHaveBeenCalled()
  })

  it('keeps hidden source identity out of lineage and the response', async () => {
    const s = setup()
    s.bookmarkService.getBookmarkReadAccess.mockResolvedValue({ bookmark: s.source, share: { is_enable: true, show_userinfo: false } })
    const result = await s.service.fork(s.ctx, { bookmark_uid: 'source-uuid' })
    expect(result.fork_info).toEqual({ bookmark_uid: 'source-uuid', display_name: null, user_id: null })
    expect(s.userRepo.getInfoByUserId).not.toHaveBeenCalled()
  })

  it('replays a completed operation without re-reading a revoked source or reserving a new version', async () => {
    const s = setup()
    const response = { bookmark_uid: 'target-uuid', bookmark_id: 8000, write_mode: 'created', fork_info: null }
    s.forkRepo.findOperation.mockResolvedValue({ ...s.operation, result: response, status: 'complete' })
    expect(await s.service.fork(s.ctx, { bookmark_uid: 'source-uuid' }, 'same-key')).toEqual(response)
    expect(s.bookmarkService.getBookmarkReadAccess).not.toHaveBeenCalled()
    expect(s.forkRepo.begin).not.toHaveBeenCalled()
  })

  it('does not delete committed objects when post-publication side effects fail', async () => {
    const s = setup()
    s.bookmarkService.refreshBookmarkPublication.mockRejectedValue(new Error('index unavailable'))
    const result = await s.service.fork(s.ctx, { bookmark_uid: 'source-uuid' })
    expect(result.bookmark_uid).toBe('target-uuid')
    expect(s.forkRepo.complete).not.toHaveBeenCalled()
    expect(s.bucket.deleteObjects).not.toHaveBeenCalled()
  })

  it('retries deleted-account search/vector cleanup through the durable stage', async () => {
    const s = setup()
    s.forkRepo.claimStaleStages.mockResolvedValue([{ id: 'stage-1', bookmark_id: 70, keys: ['body/old', 'text/old'], cleanup_token: 'cleanup-1' }])
    s.forkRepo.getVectorBucket.mockResolvedValue(2)

    await s.service.repairPending(s.ctx)

    expect(s.bookmarkSearchRepo.deleteBookmarkRaw).toHaveBeenCalledWith(70)
    expect(s.dbVectorize.deleteVector).toHaveBeenCalledWith(70, 2)
    expect(s.forkRepo.deleteVectorShard).toHaveBeenCalledWith(70)
    expect(s.forkRepo.getUnreferencedStageKeys).toHaveBeenCalledWith(['body/old', 'text/old'])
    expect(s.bucket.deleteObjects).toHaveBeenCalledWith([])
    expect(s.forkRepo.completeStageCleanup).toHaveBeenCalledWith('stage-1', 'cleanup-1', 'deleted')
  })

  it('cleans unpublished objects when publication loses to a newer write', async () => {
    const s = setup()
    s.forkRepo.publish.mockResolvedValue(false)
    await expect(s.service.fork(s.ctx, { bookmark_uid: 'source-uuid' })).rejects.toBeTruthy()
    expect(s.forkRepo.fail).toHaveBeenCalled()
    expect(s.bookmarkService.updateBookmarkVersionStatus).toHaveBeenCalledWith(80, 1, 'failed')
    expect(s.bucket.deleteObjects).toHaveBeenCalledWith(['html/body/fork/target-uuid.v1.attempt-1.html', 'text/body/fork/target-uuid.v1.attempt-1.txt'])
  })

  it('derives PDF metadata from the actual key and uses the recorded text key', async () => {
    const s = setup()
    s.source.type = 2
    s.source.bookmark.content_key = 'pdf/body/legacy-hash.pdf'
    s.source.bookmark.content_md_key = 'text/pdf/legacy-hash/extracted.txt'
    await s.service.fork(s.ctx, { bookmark_uid: 'source-uuid' })
    expect(s.bucket.copyObjects).toHaveBeenCalledWith([
      { sourceKey: 'pdf/body/legacy-hash.pdf', destinationKey: 'pdf/body/fork/target-uuid.v1.attempt-1.pdf' },
      { sourceKey: 'pdf/meta/legacy-hash.json', destinationKey: 'pdf/meta/fork/target-uuid.v1.attempt-1.json' },
      { sourceKey: 'text/pdf/legacy-hash/extracted.txt', destinationKey: 'text/body/fork/target-uuid.v1.attempt-1.txt' }
    ])
  })

  it('maps malformed PDF metadata to BookmarkContentNotFoundError', async () => {
    const s = setup()
    s.source.type = 2
    s.source.bookmark.content_key = 'pdf/body/legacy-hash.pdf'
    s.source.bookmark.content_md_key = 'text/pdf/legacy-hash/extracted.txt'
    s.bucket.R2Bucket.get.mockResolvedValue({ json: async () => { throw new SyntaxError('invalid metadata') } })

    await expect(s.service.fork(s.ctx, { bookmark_uid: 'source-uuid' })).rejects.toMatchObject({ name: ErrorName.BOOKMARK_CONTENT_NOT_FOUND })
  })
})
