/**
 * subscribe / unsubscribe 两个服务端事件
 * 钉住：只埋免费成功分支、is_new_user 边界为 120 秒
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { CollectionOrchestrator } from '@/domain/orchestrator/collection'
import { createMockCtx } from '@test/helpers/mockFactory'

const USER_ID = 42
const COLLECT_CODE = 'abc123'

const freeCollection = {
  id: 7,
  owner_id: 9,
  display_name: '星标合集',
  collection_code: COLLECT_CODE,
  amount: 0
}

type Harness = {
  orchestrator: CollectionOrchestrator
  track: ReturnType<typeof vi.fn>
  ctx: ReturnType<typeof createMockCtx>
}

function build(options: { collectionService?: Record<string, unknown>; createdAt?: Date | null; userThrows?: boolean; platform?: string } = {}): Harness {
  const track = vi.fn().mockResolvedValue(undefined)
  const orchestrator = Object.create(CollectionOrchestrator.prototype) as CollectionOrchestrator
  Object.assign(orchestrator, {
    logsService: { track },
    notificationService: {
      createSubscribeCollectionNotification: vi.fn().mockResolvedValue(undefined),
      createUnsubscribeCollectionNotification: vi.fn().mockResolvedValue(undefined)
    },
    userRepo: {
      getInfo: options.userThrows
        ? vi.fn().mockRejectedValue(new Error('USER_NOT_FOUND'))
        : vi.fn().mockResolvedValue(options.createdAt === undefined ? { id: USER_ID, created_at: new Date() } : { id: USER_ID, created_at: options.createdAt })
    },
    collectionService: options.collectionService ?? {}
  })
  return { orchestrator, track, ctx: createMockCtx({ userId: USER_ID, platform: options.platform }) }
}

/** waitUntil 在 mockFactory 里是同步透传 promise，这里等一轮微任务让链式 then 落地 */
const flush = () => new Promise(resolve => setTimeout(resolve, 0))

describe('collection_subscribe 埋点', () => {
  test('免费订阅成功 → 一条 collection_subscribe，字段符合事件矩阵', async () => {
    const { orchestrator, track, ctx } = build({
      collectionService: { subscribeUserCollection: vi.fn().mockResolvedValue({ collection: freeCollection }) },
      createdAt: new Date(Date.now() - 30_000)
    })

    await expect(orchestrator.subscribeUserCollection(ctx, COLLECT_CODE, 'https://twitter.com/someone')).resolves.toEqual({ subscribe: true })
    await flush()

    expect(track).toHaveBeenCalledTimes(1)
    const [userId, event, extra] = track.mock.calls[0]
    expect(userId).toBe(USER_ID)
    expect(event).toBe('collection_subscribe')
    expect(extra).toMatchObject({
      platform: 'web',
      collect_code: COLLECT_CODE,
      is_new_user: true,
      referrer: 'https://twitter.com/someone'
    })
    expect(extra.signup_age_sec).toBeGreaterThanOrEqual(29)
    expect(extra.signup_age_sec).toBeLessThanOrEqual(31)
  })

  test('未传 referrer → referrer 为 undefined（JSON 序列化时该键消失）', async () => {
    const { orchestrator, track, ctx } = build({
      collectionService: { subscribeUserCollection: vi.fn().mockResolvedValue({ collection: freeCollection }) }
    })
    await orchestrator.subscribeUserCollection(ctx, COLLECT_CODE)
    await flush()
    expect(track.mock.calls[0][2].referrer).toBeUndefined()
    expect(JSON.parse(JSON.stringify(track.mock.calls[0][2]))).not.toHaveProperty('referrer')
  })

  test('subscribeUserCollection 抛错（已订阅/合集关闭）→ 不埋', async () => {
    const { orchestrator, track, ctx } = build({
      collectionService: { subscribeUserCollection: vi.fn().mockRejectedValue(new Error('ALREADY_SUBSCRIBED')) }
    })
    await expect(orchestrator.subscribeUserCollection(ctx, COLLECT_CODE)).rejects.toThrow('ALREADY_SUBSCRIBED')
    await flush()
    expect(track).not.toHaveBeenCalled()
  })
})

describe('is_new_user 边界（NEW_USER_WINDOW_SEC = 120）', () => {
  const cases: Array<[string, number, boolean]> = [
    ['刚注册 0 秒', 0, true],
    ['注册后 119 秒 = 新用户', 119, true],
    ['注册后 120 秒 = 边界内（<=）', 120, true],
    ['注册后 121 秒 = 老用户', 121, false],
    ['注册后 1 天', 86400, false]
  ]

  test.each(cases)('%s → is_new_user %s', async (_label, ageSec, expected) => {
    const { orchestrator, track, ctx } = build({
      collectionService: { subscribeUserCollection: vi.fn().mockResolvedValue({ collection: freeCollection }) },
      // 减 200ms 抵消执行耗时
      createdAt: new Date(Date.now() - ageSec * 1000 - 200)
    })
    await orchestrator.subscribeUserCollection(ctx, COLLECT_CODE)
    await flush()
    const extra = track.mock.calls[0][2]
    expect(extra.signup_age_sec).toBe(ageSec)
    expect(extra.is_new_user).toBe(expected)
  })

  test('用户查不到（getInfo 抛错）→ signup_age_sec/is_new_user 均 undefined，事件仍落库', async () => {
    const { orchestrator, track, ctx } = build({
      collectionService: { subscribeUserCollection: vi.fn().mockResolvedValue({ collection: freeCollection }) },
      userThrows: true
    })
    await orchestrator.subscribeUserCollection(ctx, COLLECT_CODE)
    await flush()
    expect(track).toHaveBeenCalledTimes(1)
    const extra = track.mock.calls[0][2]
    expect(extra.signup_age_sec).toBeUndefined()
    expect(extra.is_new_user).toBeUndefined()
    expect(extra.collect_code).toBe(COLLECT_CODE)
  })

  test('created_at 为空 → 同样降级为 undefined 而不是算成新用户', async () => {
    const { orchestrator, track, ctx } = build({
      collectionService: { subscribeUserCollection: vi.fn().mockResolvedValue({ collection: freeCollection }) },
      createdAt: null
    })
    await orchestrator.subscribeUserCollection(ctx, COLLECT_CODE)
    await flush()
    expect(track.mock.calls[0][2].is_new_user).toBeUndefined()
  })
})

describe('collection_unsubscribe 埋点', () => {
  test('退订成功 → 一条 collection_unsubscribe', async () => {
    const { orchestrator, track, ctx } = build({
      collectionService: { unsubscribeUserCollection: vi.fn().mockResolvedValue({ collection: freeCollection }) }
    })

    await orchestrator.unsubscribeUserCollection(ctx, COLLECT_CODE)
    await flush()

    expect(track).toHaveBeenCalledTimes(1)
    expect(track).toHaveBeenCalledWith(USER_ID, 'collection_unsubscribe', { platform: 'web', collect_code: COLLECT_CODE })
  })

  // platform 由 requestLog 中间件写进 ctx，不再写死 web、也不再层层传参
  test('platform 取自 ctx：ctx 里是 ios 就记 ios', async () => {
    const { orchestrator, track, ctx } = build({
      collectionService: { unsubscribeUserCollection: vi.fn().mockResolvedValue({ collection: freeCollection }) },
      platform: 'ios'
    })

    await orchestrator.unsubscribeUserCollection(ctx, COLLECT_CODE)
    await flush()

    expect(track).toHaveBeenCalledWith(USER_ID, 'collection_unsubscribe', { platform: 'ios', collect_code: COLLECT_CODE })
  })

  // ctx 没写过 platform（非 HTTP 入口）时兜底 web，不写 NULL
  test('ctx 未设 platform → 兜底 web', async () => {
    const { orchestrator, track, ctx } = build({
      collectionService: { unsubscribeUserCollection: vi.fn().mockResolvedValue({ collection: freeCollection }) }
    })

    await orchestrator.unsubscribeUserCollection(ctx, COLLECT_CODE)
    await flush()

    expect(track.mock.calls[0][2].platform).toBe('web')
  })

  test('退订失败（未订阅）→ 不埋', async () => {
    const { orchestrator, track, ctx } = build({
      collectionService: { unsubscribeUserCollection: vi.fn().mockRejectedValue(new Error('NOT_SUBSCRIBED')) }
    })
    await expect(orchestrator.unsubscribeUserCollection(ctx, COLLECT_CODE)).rejects.toThrow('NOT_SUBSCRIBED')
    await flush()
    expect(track).not.toHaveBeenCalled()
  })
})
