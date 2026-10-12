import { describe, expect, test, vi } from 'vitest'
import { CollectionService } from '@/domain/collection'
import { CollectionOrchestrator } from '@/domain/orchestrator/collection'
import { CollectionController } from '@/handler/http/collectionController'
import { CollectionRepo } from '@/infra/repository/dbCollection'
import { createMockCtx } from '@test/helpers/mockFactory'

vi.mock('@/utils/strings', () => ({ hashMD5: vi.fn().mockResolvedValue('collection-code') }))

function wire(amount = 0) {
  const collection = { id: 1, owner_id: 10, collection_code: 'collection', display_name: 'Collection', status: 1, amount }
  const repo = {
    getUserShareCollectByCode: vi.fn().mockResolvedValue(collection),
    getUserShareCollect: vi.fn().mockResolvedValue(collection),
    getUserSubscribeCollection: vi.fn().mockResolvedValue(null),
    createUserCollectionSubscribePeriod: vi.fn().mockResolvedValue(undefined),
    getUserCollectionSubscribePeriodList: vi.fn().mockResolvedValue([{ interval: 'year', interval_count: 99, created_at: new Date() }]),
    upsertUserSubscribeCollection: vi.fn().mockResolvedValue({}),
    deleteUserCollectionSubscribePeriod: vi.fn().mockResolvedValue(undefined),
    deleteUserSubscribeCollection: vi.fn().mockResolvedValue(undefined),
    updateUserCollectionSubscribeDeleted: vi.fn().mockResolvedValue(undefined),
    updateUserShareCollectInfo: vi.fn().mockResolvedValue(undefined)
  }
  const userRepo = { getInfoByUserId: vi.fn().mockResolvedValue({ id: 10, deleted_at: null }), getInfo: vi.fn().mockResolvedValue({ created_at: new Date() }) }
  const service = new CollectionService(repo as never, userRepo as never, {} as never)
  const orchestrator = new CollectionOrchestrator(service, {} as never, {} as never, {} as never, {} as never, {
    createSubscribeCollectionNotification: vi.fn().mockResolvedValue(undefined), createUnsubscribeCollectionNotification: vi.fn().mockResolvedValue(undefined)
  } as never, repo as never, userRepo as never, { track: vi.fn().mockResolvedValue(undefined) } as never)
  return { collection, repo, userRepo, service, orchestrator, controller: new CollectionController(service, orchestrator) }
}

const request = (data: object) => new Request('https://test/v1/collection', { method: 'POST', body: JSON.stringify(data) })

describe('Reader collections without Connect', () => {
  test.each([0, 500])('subscribes locally even when historical amount=%s; never returns checkout', async amount => {
    const { controller, repo } = wire(amount)
    const response = await controller.handleUserCollectionSubscribeRequest(createMockCtx({ userId: 20 }), request({ collect_code: 'collection' }))
    const output = await response.text()
    expect(output).toContain('"subscribe":true')
    expect(output).not.toContain('payment_link')
    expect(repo.createUserCollectionSubscribePeriod).toHaveBeenCalledWith(expect.objectContaining({ user_id: 20, collection_id: 1, type: 7, interval: 'year', interval_count: 99 }))
    expect(repo.upsertUserSubscribeCollection).toHaveBeenCalledWith(expect.objectContaining({ user_id: 20, owner_id: 10, collection_id: 1, subscription_end_time: expect.any(Date) }))
    expect(repo.upsertUserSubscribeCollection.mock.calls[0][0]).not.toHaveProperty('stripe_customer_id')
  })

  test.each(['closed', 'owner-deleted', 'already-subscribed'])('retains %s checks before subscription writes', async reason => {
    const { service, repo, userRepo, collection } = wire()
    if (reason === 'closed') repo.getUserShareCollectByCode.mockResolvedValue({ ...collection, status: 0 })
    if (reason === 'owner-deleted') userRepo.getInfoByUserId.mockResolvedValue({ id: 10, deleted_at: new Date() })
    if (reason === 'already-subscribed') repo.getUserSubscribeCollection.mockResolvedValue({ subscription_end_time: new Date(Date.now() + 60000), is_deleted: false, is_cancelled: false })
    await expect(service.subscribeUserCollection(createMockCtx({ userId: 20 }), 'collection')).rejects.toBeTruthy()
    expect(repo.createUserCollectionSubscribePeriod).not.toHaveBeenCalled()
  })

  test('unsubscribe removes local relationship including legacy customer data; no external cancellation', async () => {
    const { service, repo } = wire()
    repo.getUserSubscribeCollection.mockResolvedValue({ stripe_customer_id: 'legacy-customer' })
    await service.unsubscribeUserCollection(createMockCtx({ userId: 20 }), 'collection')
    expect(repo.deleteUserCollectionSubscribePeriod).toHaveBeenCalledWith(20, 1)
    expect(repo.deleteUserSubscribeCollection).toHaveBeenCalledWith(20, 1)
  })

  test('unsubscribe database errors are not silently reported as success', async () => {
    const { service, repo } = wire()
    repo.getUserSubscribeCollection.mockResolvedValue({})
    repo.deleteUserCollectionSubscribePeriod.mockRejectedValue(new Error('db unavailable'))
    await expect(service.unsubscribeUserCollection(createMockCtx({ userId: 20 }), 'collection')).rejects.toThrow('db unavailable')
    expect(repo.deleteUserSubscribeCollection).not.toHaveBeenCalled()
  })

  test('delete-subscribe still removes free subscriptions from the list', async () => {
    const { service, repo } = wire()
    repo.getUserSubscribeCollection.mockResolvedValue({})
    await service.deleteUserCollectionSubscribe(createMockCtx({ userId: 20 }), 'collection')
    expect(repo.updateUserCollectionSubscribeDeleted).toHaveBeenCalledWith(20, 1, true)
  })

  test('setting accepts old client payload without persisting a paid price or invoking Connect', async () => {
    const { controller, repo } = wire()
    await controller.handleUserSettingShareCollectRequest(createMockCtx({ userId: 10 }), request({ name: 'New', price: 500, show_marks: true, allow_marks: false, show_profile: true }))
    expect(repo.updateUserShareCollectInfo).toHaveBeenCalledWith(10, { name: 'New', show_marks: true, allow_marks: false, show_profile: true, avatar: undefined, description: undefined })
  })

  test.each([0, 1])('mine and public list responses omit every payment field, status=%s', async status => {
    const { collection, repo, userRepo, controller, service } = wire(500)
    Object.assign(collection, { status, currency: 'usd', service_charge_fee: 20 })
    Object.assign(repo, { getCollectionStats: vi.fn().mockResolvedValue({ starred_count: 0, subscriber_count: 0 }) })
    userRepo.getInfo.mockResolvedValue({ id: 10, name: 'Owner', created_at: new Date() } as never)
    Object.assign(service, { bookmarkRepo: { listUserStarBookmarksWithStatsByTargetUser: vi.fn().mockResolvedValue([]), countReadableCollectionBookmarks: vi.fn().mockResolvedValue(0) } })
    const ctx = createMockCtx({ userId: 10 })
    const mine = await (await controller.handleMyShareCollectRequest(ctx, request({}))).json() as { data: Record<string, unknown> }
    const publicList = await (await controller.handleShareCollectRequest(ctx, new Request('https://test/v1/collection?collect_code=collection'))).json() as { data: Record<string, unknown> }
    expect(mine.data).toEqual({ show_name: 'Collection', avatar: '', description: '', starred_count: 0, subscriber_count: 0, collection_code: 'collection', status, show_marks: false, allow_marks: false, show_profile: false })
    expect(publicList.data).toEqual({ collection_name: 'Collection', publisher_name: 'Owner', publisher_avatar: '', subscrition_count: 0, subscrition_end_time: '', list: [], description: '', is_owner: true, status, bookmark_count: 0 })
    for (const key of ['price', 'currency', 'service_charge_percent', 'collection_price', 'payment_link']) {
      expect(mine.data).not.toHaveProperty(key)
      expect(publicList.data).not.toHaveProperty(key)
    }
  })

  test('repository does not write payment columns when enabling or updating collections', async () => {
    const upsert = vi.fn().mockResolvedValue({})
    const update = vi.fn().mockResolvedValue({})
    const repo = new CollectionRepo((() => ({ sr_user_collection: { upsert, update } })) as never)
    await repo.enableUserShareCollect(10, true, 'Owner')
    await repo.updateUserShareCollectInfo(10, { name: 'New', show_marks: true })
    for (const data of [upsert.mock.calls[0][0].create, upsert.mock.calls[0][0].update, update.mock.calls[0][0].data]) {
      for (const key of ['amount', 'currency', 'service_charge_fee', 'collection_product_id', 'collection_prices_id']) expect(data).not.toHaveProperty(key)
    }
    expect(upsert.mock.calls[0][0].create.type).toBe(1)
  })

  test('repository reactivates a previously deleted/cancelled free follow', async () => {
    const upsert = vi.fn().mockResolvedValue({})
    const repo = new CollectionRepo((() => ({ sr_user_collection_subscriber: { upsert } })) as never)
    await repo.upsertUserSubscribeCollection({ user_id: 20, owner_id: 10, collection_id: 1, subscription_end_time: new Date(), next_invoice_time: new Date(), auto_renew: true })
    expect(upsert.mock.calls[0][0].update).toMatchObject({ is_active: true, is_deleted: false, is_cancelled: false })
  })
})
