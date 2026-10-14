import { describe, expect, test, vi } from 'vitest'
import { BookmarkService } from '@/domain/bookmark'
import { CollectionService } from '@/domain/collection'
import { ShareService } from '@/domain/share'
import { ShareOrchestrator } from '@/domain/orchestrator/share'
import { CollectionOrchestrator } from '@/domain/orchestrator/collection'
import { ContentOrchestrator } from '@/domain/orchestrator/content'
import { ShareController } from '@/handler/http/shareController'
import { CollectionController } from '@/handler/http/collectionController'
import { CollectionRepo } from '@/infra/repository/dbCollection'
import { DBSyncBatchOperation } from '@/infra/repository/dbSyncBatch'
import { MarkService } from '@/domain/mark'
import { markType } from '@/infra/repository/dbMark'
import { createMockCtx } from '@test/helpers/mockFactory'

function wire() {
  const row = { id: 100, uuid: 'bookmark', user_id: 42, bookmark_id: 200, deleted_at: null, is_starred: true, bookmark: { id: 200, moderation_result: 0, content_key: 'secret-key', content_md_key: 'md-key', title: 'public title', created_at: new Date(), published_at: new Date(), updated_at: new Date() } }
  const share = { user_id: 42, bookmark_id: 200, share_code: 'code', created_at: new Date(), is_enable: true, show_line: true, show_comment: true, show_userinfo: true, allow_line: true, allow_comment: true }
  const owner = { id: 42, name: 'Owner', picture: 'avatar', snapshot_sharing: true, deleted_at: null }
  const collection = { id: 9, owner_id: 42, status: 1, type: 1, amount: 0, collection_code: 'collection' }
  const repo = {
    getUserBookmark: vi.fn().mockResolvedValue(row), getUserBookmarkByUserBmId: vi.fn().mockResolvedValue(row), getUserBookmarkById: vi.fn().mockResolvedValue(row),
    getUserBookmarkByUuidWithDetail: vi.fn().mockResolvedValue(row), getBookmarkShareByBookmarkId: vi.fn().mockResolvedValue(share), getBookmarkShareByShareCode: vi.fn().mockResolvedValue(share),
    countReadableCollectionBookmarks: vi.fn().mockResolvedValue(1),
    listUserStarBookmarksWithStatsByTargetUser: vi.fn().mockResolvedValue([{ id: 100, bookmark_user_uuid: 'bookmark', title: 'public title', mark_count: 1, first_mark: { comment: 'private comment' } }])
  }
  const userRepo = { getInfoByUserId: vi.fn().mockResolvedValue(owner), getInfo: vi.fn().mockResolvedValue(owner) }
  const collectionRepo = { getUserShareCollectByCode: vi.fn().mockResolvedValue(collection), getUserSubscribeCollectionRecord: vi.fn().mockResolvedValue(null), getCollectionStats: vi.fn().mockResolvedValue({ starred_count: 1 }) }
  const bs = new (BookmarkService as any)(repo, undefined, undefined, undefined, undefined, userRepo) as BookmarkService
  bs.getBookmarkContent = vi.fn().mockResolvedValue('body')
  bs.getBookmarkOutline = vi.fn().mockResolvedValue('outline')
  const users = { getUserBriefInfo: vi.fn().mockImplementation(async show => ({ nick_name: show ? 'Owner' : '', avatar: show ? 'avatar' : '' })), getOwnerShareInfo: vi.fn().mockResolvedValue({ nick_name: 'Owner', avatar: 'avatar' }) }
  const marks = { getBookmarkMarkList: vi.fn().mockImplementation(async (_ctx, p) => p.isShowMarks ? { mark_list: [{ comment: 'private comment' }], user_list: { 42: { username: 'hidden-participant', avatar: 'hidden-avatar' } } } : { mark_list: [], user_list: {} }), getFirstComment: vi.fn().mockResolvedValue('private comment') }
  const tags = { getBookmarkTags: vi.fn().mockResolvedValue(['private tag']) }
  const ss = new ShareService(repo as never, userRepo as never)
  const so = new ShareOrchestrator(ss, users as never, tags as never, marks as never, bs)
  const cs = new CollectionService(collectionRepo as never, userRepo as never, repo as never)
  const co = new (CollectionOrchestrator as any)(cs, bs, marks, tags, users)
  const content = new ContentOrchestrator(bs, users as never, tags as never, marks as never, { getBookmarkCollectionRef: vi.fn().mockResolvedValue(null) } as never)
  return { row, share, owner, collection, repo, userRepo, collectionRepo, bs, marks, tags, content, cs, sc: new ShareController(ss, so), cc: new CollectionController(cs, co), markService: new MarkService(repo as never, {} as never, collectionRepo as never, userRepo as never) }
}

const request = (url: string) => new Request(`https://test/${url}`)

describe('public controller authorization', () => {
  test.each(['owner-deleted', 'deleted', 'moderated', 'disabled', 'global-off'])('rejects %s in legacy share, collection and content before loading content or traces', async reason => {
    const w = wire()
    if (reason === 'owner-deleted') {
      w.userRepo.getInfoByUserId.mockResolvedValue({ ...w.owner, deleted_at: new Date() })
      w.userRepo.getInfo.mockResolvedValue({ ...w.owner, deleted_at: new Date() })
    }
    if (reason === 'deleted') w.repo.getUserBookmarkByUuidWithDetail.mockResolvedValue({ ...w.row, deleted_at: new Date() })
    if (reason === 'moderated') w.repo.getUserBookmarkByUuidWithDetail.mockResolvedValue({ ...w.row, bookmark: { ...w.row.bookmark, moderation_result: 1 } })
    if (reason === 'disabled') w.repo.getBookmarkShareByBookmarkId.mockResolvedValue({ ...w.share, is_enable: false })
    if (reason === 'global-off') {
      w.repo.getBookmarkShareByBookmarkId.mockResolvedValue(null)
      w.userRepo.getInfoByUserId.mockResolvedValue({ ...w.owner, snapshot_sharing: false })
    }
    const ctx = createMockCtx({ userId: 0 })
    for (const method of ['getShare', 'getInlineShare', 'getMarkList'] as const) await expect(w.sc[method](ctx, request('v1/share/detail?share_code=code'))).rejects.toBeTruthy()
    await expect(w.cc.handleUserCollectionSubscribedDetailRequest(ctx, request('v1/collection/bookmark?collection_code=collection&cb_id=100'))).rejects.toBeTruthy()
    await expect(w.content.getContentMeta(ctx, 'bookmark')).rejects.toBeTruthy()
    expect(w.bs.getBookmarkContent).not.toHaveBeenCalled()
    expect(w.marks.getFirstComment).not.toHaveBeenCalled()
    expect(w.marks.getBookmarkMarkList).not.toHaveBeenCalled()
  })

  test('explicit share still overrides global defaults for an active owner', async () => {
    const w = wire()
    w.userRepo.getInfoByUserId.mockResolvedValue({ ...w.owner, snapshot_sharing: false })
    const response = await w.sc.getShare(createMockCtx({ userId: 0 }), request('v1/share/detail?share_code=code'))
    const body = await response.text()
    expect(body).toContain('body')
    expect(body).not.toContain('secret-key')
    expect(body).not.toContain('md-key')
  })

  test.each(['show_comment', 'show_line', 'show_userinfo'])('honors hidden %s in response output', async field => {
    const w = wire()
    const share = { ...w.share, [field]: false }
    w.repo.getBookmarkShareByBookmarkId.mockResolvedValue(share)
    w.repo.getBookmarkShareByShareCode.mockResolvedValue(share)
    const ctx = createMockCtx({ userId: 0 })
    const meta = await w.content.getContentMeta(ctx, 'bookmark')
    expect(meta.first_comment).toBe('')
    if (field !== 'show_userinfo') {
      expect(await (await w.sc.getInlineShare(ctx, request('v1/share/inline_detail?share_code=code'))).text()).not.toContain('private comment')
      expect(await (await w.cc.handleUserCollectionSubscribedDetailRequest(ctx, request('v1/collection/bookmark?collection_code=collection&cb_id=100'))).text()).not.toContain('private comment')
    } else {
      expect(await (await w.sc.getMarkList(ctx, request('v1/share/mark_list?share_code=code'))).text()).not.toContain('hidden-participant')
      expect(await (await w.cc.handleUserCollectionSubscribedDetailRequest(ctx, request('v1/collection/bookmark?collection_code=collection&cb_id=100'))).text()).not.toContain('hidden-participant')
      expect(await (await w.sc.getShare(ctx, request('v1/share/detail?share_code=code'))).text()).not.toContain('private tag')
      expect(await (await w.cc.handleUserCollectionSubscribedDetailRequest(ctx, request('v1/collection/bookmark?collection_code=collection&cb_id=100'))).text()).not.toContain('private tag')
    }
  })

  test.each(['closed', 'foreign', 'unstarred'])('rejects collection %s independently of explicit article share', async reason => {
    const w = wire()
    if (reason === 'closed') w.collectionRepo.getUserShareCollectByCode.mockResolvedValue({ ...w.collection, status: 0 })
    if (reason === 'foreign') w.collectionRepo.getUserShareCollectByCode.mockResolvedValue({ ...w.collection, owner_id: 99 })
    if (reason === 'unstarred') w.repo.getUserBookmarkByUserBmId.mockResolvedValue({ ...w.row, is_starred: false })
    await expect(w.cc.handleUserCollectionSubscribedDetailRequest(createMockCtx({ userId: 0 }), request('v1/collection/bookmark?collection_code=collection&cb_id=100'))).rejects.toBeTruthy()
    expect(w.bs.getBookmarkContent).not.toHaveBeenCalled()
  })

  test.each([0, 100])('paused collection amount=%s retains existing subscriber access, not anonymous access', async amount => {
    const w = wire()
    w.collectionRepo.getUserShareCollectByCode.mockResolvedValue({ ...w.collection, status: 0, amount })
    w.collectionRepo.getUserSubscribeCollectionRecord.mockResolvedValue({ is_deleted: false, subscription_end_time: new Date(Date.now() + 60000) })
    await expect(w.cs.getCollectionBookmarkInfo('collection', 100, 7)).resolves.toBeTruthy()
    await expect(w.cs.getCollectionBookmarkInfo('collection', 100)).rejects.toBeTruthy()
  })

  test('public collection list filters disabled articles and rejects deleted owners', async () => {
    const w = wire()
    w.repo.listUserStarBookmarksWithStatsByTargetUser.mockResolvedValue([])
    w.repo.countReadableCollectionBookmarks.mockResolvedValue(0)
    const ctx = createMockCtx({ userId: 0 })
    const response = await w.cc.handleShareCollectRequest(ctx, request('v1/collection/?collect_code=collection'))
    expect(await response.text()).not.toContain('public title')
    w.userRepo.getInfo.mockResolvedValue({ ...w.owner, deleted_at: new Date() })
    await expect(w.cc.handleShareCollectRequest(ctx, request('v1/collection/?collect_code=collection'))).rejects.toBeTruthy()
  })

  test.each(['owner-deleted', 'closed', 'moderated'])('REST collection comment denies %s', async reason => {
    const w = wire()
    if (reason === 'owner-deleted') w.userRepo.getInfoByUserId.mockResolvedValue({ ...w.owner, deleted_at: new Date() })
    if (reason === 'closed') w.collectionRepo.getUserShareCollectByCode.mockResolvedValue({ ...w.collection, status: 0 })
    if (reason === 'moderated') w.repo.getUserBookmarkByUuidWithDetail.mockResolvedValue({ ...w.row, bookmark: { ...w.row.bookmark, moderation_result: 1 } })
    await expect(w.markService.assertCreateMarkSource(createMockCtx({ userId: 7 }), { collection_code: 'collection', cb_id: 100, type: markType.COMMENT } as never)).rejects.toBeTruthy()
  })
})

describe('public SQL boundaries', () => {
  test.each(['missing-parent', 'foreign-parent', 'deleted-parent', 'foreign-root'])('collection comments reject %s', async reason => {
    const db = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: 100, collection_code: 'collection' }]),
      sr_bookmark_comment: { findUnique: vi.fn().mockResolvedValue({ id: 1, bookmark_id: reason === 'foreign-parent' || reason === 'foreign-root' ? 999 : 100, is_deleted: reason === 'deleted-parent', root_id: 1 }), create: vi.fn() }
    }
    const repository = new DBSyncBatchOperation((() => undefined) as never)
    await expect(repository.executeCreateComment(db as never, {
      type: 'create_comment', userId: 7, data: { sourceType: 'collection', sourceId: 'bookmark', userBookmarkUuid: 'bookmark', type: reason === 'foreign-root' ? markType.COMMENT : markType.REPLY, source: '[]', comment: 'hello', rootUuid: 'root', parentUuid: reason === 'missing-parent' ? '' : 'parent' }
    } as never)).rejects.toBeTruthy()
    expect(db.sr_bookmark_comment.create).not.toHaveBeenCalled()
  })

  test('sitemap and footer join live owners and footer verifies actual bookmark membership', async () => {
    const db = { $queryRaw: vi.fn().mockResolvedValue([]) }
    const repo = new CollectionRepo((() => db) as never)
    await repo.listActiveCollectionsWithLastModified()
    expect(db.$queryRaw.mock.calls[0][0].sql).toContain('owner.deleted_at IS NULL')
    await repo.getBookmarkCollectionByUuid('uuid')
    const sql = db.$queryRaw.mock.calls[1][0].join('?')
    for (const clause of ['owner.deleted_at IS NULL', 'ub.deleted_at IS NULL', 'ub.is_starred = true', 'b.moderation_result = 0', 'COALESCE(share.is_enable, owner.snapshot_sharing)']) expect(sql).toContain(clause)
  })

  test('collection comment SQL rejects closed/deleted/moderated sources before insertion', async () => {
    const db = { $queryRaw: vi.fn().mockResolvedValue([]), sr_bookmark_comment: { create: vi.fn() } }
    const repo = new DBSyncBatchOperation((() => undefined) as never)
    await expect(repo.executeCreateComment(db as never, { type: 'create_comment', userId: 7, data: { userBookmarkUuid: 'uuid', sourceId: 'uuid', sourceType: 'collection', type: markType.COMMENT, comment: 'hi', source: '[]' } } as never)).rejects.toBeTruthy()
    const sql = db.$queryRaw.mock.calls[0][0].sql
    for (const clause of ['owner.deleted_at IS NULL', 'article.moderation_result = 0', 'collection.status = 1', 'collection.status = 0', 'subscriber.is_deleted = false', 'share.allow_comment']) expect(sql).toContain(clause)
    expect(db.sr_bookmark_comment.create).not.toHaveBeenCalled()
  })
})
