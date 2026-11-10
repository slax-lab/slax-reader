import { describe, expect, test, vi } from 'vitest'
import { CollectionService, defaultShareCollectionName } from '@/domain/collection'
import { CollectionRepo } from '@/infra/repository/dbCollection'
import { createMockCtx } from '@test/helpers/mockFactory'

vi.mock('@/utils/strings', () => ({ hashMD5: vi.fn().mockResolvedValue('0123456789abcdef0123456789abcdef') }))

const collection = {
  id: 3,
  owner_id: 7,
  display_name: "Alex's Reading Recommendations",
  avatar: '',
  description: '',
  collection_code: 'stable-code',
  status: 1,
  show_marks: true,
  allow_marks: true,
  show_profile: true
}

function serviceWire(overrides = {}) {
  const current = { ...collection, ...overrides }
  const repo = {
    ensureUserShareCollect: vi.fn().mockResolvedValue(current),
    getCollectionStats: vi.fn().mockResolvedValue({ starred_count: 0, subscriber_count: 0 })
  }
  const userRepo = { getInfoByUserId: vi.fn().mockResolvedValue({ id: 7, name: 'Alex', lang: 'en' }) }
  return { repo, userRepo, service: new CollectionService(repo as never, userRepo as never, {} as never) }
}

describe('default collection provisioning', () => {
  test.each([
    [{ name: 'Alex', lang: 'zh-CN' }, 'Alex 的阅读推荐'],
    [{ name: 'Alex', lang: 'en' }, "Alex's Reading Recommendations"],
    [{ name: '', lang: 'zh' }, '我的阅读推荐'],
    [{ name: '', lang: '' }, 'My Reading Recommendations']
  ])('creates localized fallback name for %j', (user, expected) => {
    expect(defaultShareCollectionName(user)).toBe(expected)
  })

  test('mine provisions a stable non-null open collection', async () => {
    const { service, repo } = serviceWire()
    const first = await service.getMyShareCollectInfo(createMockCtx({ userId: 7 }))
    const second = await service.getMyShareCollectInfo(createMockCtx({ userId: 7 }))
    expect(first).toMatchObject({ collection_code: 'stable-code', status: 1, show_name: "Alex's Reading Recommendations" })
    expect(second).toEqual(first)
    expect(repo.ensureUserShareCollect).toHaveBeenCalledTimes(2)
    expect(repo.ensureUserShareCollect).toHaveBeenCalledWith(7, "Alex's Reading Recommendations")
  })

  test('mine preserves an existing closed collection', async () => {
    const { service, repo } = serviceWire({ status: 0, display_name: 'Curator choice' })
    const result = await service.getMyShareCollectInfo(createMockCtx({ userId: 7 }))
    expect(result).toMatchObject({ collection_code: 'stable-code', status: 0, show_name: 'Curator choice' })
    expect(repo.ensureUserShareCollect).toHaveBeenCalledOnce()
  })

  test('repository creates defaults without updating an existing row', async () => {
    const upsert = vi.fn().mockResolvedValue(collection)
    const repo = new CollectionRepo((() => ({ sr_user_collection: { upsert, findFirst: vi.fn().mockResolvedValue(null) } })) as never)
    await repo.ensureUserShareCollect(7, "Alex's Reading Recommendations")
    expect(upsert).toHaveBeenCalledWith({
      where: { owner_id: 7 },
      create: expect.objectContaining({
        owner_id: 7,
        display_name: "Alex's Reading Recommendations",
        collection_code: expect.stringMatching(/^[a-f0-9]{32}$/),
        status: 1,
        show_marks: true,
        allow_marks: true,
        show_profile: true
      }),
      update: {}
    })
  })

  test('repository recovers a concurrent unique conflict by rereading the winner', async () => {
    const upsert = vi.fn().mockRejectedValue(Object.assign(new Error('unique conflict'), { code: 'P2002' }))
    const repo = new CollectionRepo((() => ({ sr_user_collection: { upsert, findFirst: vi.fn().mockResolvedValue(null) } })) as never)
    vi.spyOn(repo, 'getUserShareCollect').mockResolvedValue(collection as never)
    await expect(repo.ensureUserShareCollect(7, 'Other name')).resolves.toBe(collection)
  })

  test('repository preserves unexpected failures', async () => {
    const failure = new Error('database unavailable')
    const upsert = vi.fn().mockRejectedValue(failure)
    const repo = new CollectionRepo((() => ({ sr_user_collection: { upsert, findFirst: vi.fn().mockResolvedValue(null) } })) as never)
    await expect(repo.ensureUserShareCollect(7, 'Name')).rejects.toBe(failure)
  })
})


describe('legacy collection visibility controls', () => {
  test.each([
    [true, 1],
    [false, 0]
  ])('create branch preserves requested open=%s status', async (enable, status) => {
    const upsert = vi.fn().mockResolvedValue(collection)
    const repo = new CollectionRepo((() => ({ sr_user_collection: { upsert, findFirst: vi.fn().mockResolvedValue(null) } })) as never)
    await repo.enableUserShareCollect(7, enable, 'Alex')
    expect(upsert.mock.calls[0][0].create).toMatchObject({ owner_id: 7, status })
  })

  test('close and reopen change only timestamps and explicit status on an existing row', async () => {
    const upsert = vi.fn().mockResolvedValue(collection)
    const repo = new CollectionRepo((() => ({ sr_user_collection: { upsert, findFirst: vi.fn().mockResolvedValue(null) } })) as never)
    await repo.enableUserShareCollect(7, false, 'Alex')
    await repo.enableUserShareCollect(7, true, 'Alex')
    for (const [call, status] of [[0, 0], [1, 1]] as const) {
      const input = upsert.mock.calls[call][0]
      expect(input.update).toMatchObject({ status, updated_at: expect.any(Date) })
      expect(input.update).not.toHaveProperty('collection_code')
      expect(input.update).not.toHaveProperty('display_name')
    }
  })
})


test('repository returns an existing row without issuing an upsert', async () => {
  const upsert = vi.fn()
  const findFirst = vi.fn().mockResolvedValue(collection)
  const repo = new CollectionRepo((() => ({ sr_user_collection: { upsert, findFirst } })) as never)
  await expect(repo.ensureUserShareCollect(7, 'Replacement name')).resolves.toBe(collection)
  expect(upsert).not.toHaveBeenCalled()
})
