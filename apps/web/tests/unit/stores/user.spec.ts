// user store 纯逻辑覆盖（Sprint 2.1.1）：8 个 getter 共 18 用例
// 注意 useUserStore() 初始化 state.locale 取自 useI18n()?.locale?.value（stores/user.ts:54），
// 必须 mock useI18n，否则 store 实例化会因 vue-i18n "must be called from inside a setup function" 报错。
// haveRequestToken 来自 layers/core/app/utils/request.ts 的 nuxt auto-import，
// 直接 vi.mock 模块路径拦不到 auto-import 改写后的代码（与 useAuth.spec.ts 同模式），必须用 mockNuxtImport。
import { SubscriptionType } from '@commons/types/interface'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { useUserStore } from '~~/app/stores/user'
import { baseUser, makeUser } from '~~/tests/fixtures/user'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// vi.hoisted：mock factory 在 hoist 后早于顶层变量初始化执行，必须显式包装
// mockNuxtImport 是 macro，被 transform 成 vi.mock 后由 vitest hoist 到 import 之前，因此
// useUserStore 即便在源码里写在顶部，运行时也能拿到下面 mockNuxtImport 注入的 haveRequestToken / useI18n
// Sprint 2.2 扩展：合并 request / cookies 等句柄到同一 hoisted 块，避免二次声明覆盖原有 mock。
// 注意：不在顶层 mockNuxtImport('useNuxtApp', ...)，否则会覆盖 setupNuxt 自身依赖的 nuxtApp 实例
// （pinia payload-plugin / router plugin 都会在 init 期失败）。改为在用例内 vi.spyOn(store, 'changeLocalLocale')
// 阻断真实副作用，等价覆盖 changeLocalLocale 是否被调用的验证目的
const { haveRequestTokenMock, useI18nMock, mockGet, mockPost, mockRequest, cookieGet, cookieSet, cookieRemove } = vi.hoisted(() => {
  const post = vi.fn()
  const get = vi.fn()
  return {
    haveRequestTokenMock: vi.fn(() => false),
    useI18nMock: vi.fn(() => ({ locale: { value: 'en' } })),
    mockGet: get,
    mockPost: post,
    mockRequest: vi.fn(() => ({
      get,
      post,
      put: vi.fn(),
      delete: vi.fn(),
      stream: vi.fn(),
      upgrade: vi.fn(),
      uploadFile: vi.fn()
    })),
    cookieGet: vi.fn(),
    cookieSet: vi.fn(),
    cookieRemove: vi.fn()
  }
})
mockNuxtImport('haveRequestToken', () => haveRequestTokenMock)
mockNuxtImport('useI18n', () => useI18nMock)
// Sprint 2.2：refreshUserInfo / refreshUserToken / changeUserSetting 都走 request() 这条 auto-import 通道
mockNuxtImport('request', () => mockRequest)

// runtimeConfig 必须保留 app.baseURL（同 useAuth.spec.ts），否则 nuxt-test-utils 启动 router plugin 时会读到 undefined
const runtimeConfig = {
  app: { baseURL: '/' },
  public: {
    COOKIE_TOKEN_NAME: 'token',
    COOKIE_DOMAIN: '.example.com'
  }
}
mockNuxtImport('useRuntimeConfig', () => () => runtimeConfig)

// useCookies 在 user.ts 顶部以显式路径 import，必须用 vi.mock 拦截模块路径（mockNuxtImport 不覆盖此场景）
vi.mock('@vueuse/integrations/useCookies', () => ({
  useCookies: () => ({ set: cookieSet, get: cookieGet, remove: cookieRemove })
}))

describe('useUserStore - getters', () => {
  beforeEach(() => {
    // 每个用例重建 pinia，确保 state 隔离干净
    setActivePinia(createPinia())
    haveRequestTokenMock.mockReset().mockReturnValue(false)
    useI18nMock.mockReset().mockReturnValue({ locale: { value: 'en' } })
    // 锁时间，避免 isJustPaid / canRequetPushPermission 受系统时间漂移影响
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-23T10:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('userInfo', () => {
    it('user=null 返回 null', () => {
      const store = useUserStore()
      expect(store.userInfo).toBeNull()
    })

    it('user 已设置时返回 user 对象', () => {
      const store = useUserStore()
      store.user = baseUser
      expect(store.userInfo).toEqual(baseUser)
    })
  })

  describe('currentLocale', () => {
    it('locale 为空字符串时 fallback "en"', () => {
      const store = useUserStore()
      // 手动覆盖到空串，触发 `state.locale || 'en'` 的 fallback 分支
      store.locale = ''
      expect(store.currentLocale).toBe('en')
    })

    it('locale 已设置时返回原值', () => {
      const store = useUserStore()
      store.locale = 'zh'
      expect(store.currentLocale).toBe('zh')
    })
  })

  describe('isJustPaid', () => {
    it('payTimeRecord=null → false', () => {
      const store = useUserStore()
      expect(store.isJustPaid).toBe(false)
    })

    it('距 now < 10 分钟 → true', () => {
      const store = useUserStore()
      // 5 分钟前付费，落在 < 10 分钟窗口内
      store.payTimeRecord = Date.now() - 1000 * 60 * 5
      expect(store.isJustPaid).toBe(true)
    })

    it('距 now > 10 分钟 → false', () => {
      const store = useUserStore()
      // 15 分钟前付费，超出窗口
      store.payTimeRecord = Date.now() - 1000 * 60 * 15
      expect(store.isJustPaid).toBe(false)
    })
  })

  describe('isSubscriptionExpired', () => {
    it('user=null → true', () => {
      const store = useUserStore()
      expect(store.isSubscriptionExpired).toBe(true)
    })

    it('user 已设置但无 subscription_end_at → checkUserSubscribedIsExpired 判定已过期', () => {
      // fork 的 checkUserSubscribedIsExpired（utils/userRelative.ts）是真实业务逻辑
      // （区别于 upstream 的 stub 永远返回 false）：缺 subscription_end_at 时视为已过期。
      const store = useUserStore()
      store.user = makeUser()
      expect(store.isSubscriptionExpired).toBe(true)
    })

    it('user 已设置 + subscription_end_at 在未来 + PAID_SUBSCRIPTION → 未过期', () => {
      const store = useUserStore()
      store.user = makeUser({ subscription_end_at: new Date(Date.now() + 86400000).toISOString(), subscription_type: SubscriptionType.PAID_SUBSCRIPTION })
      expect(store.isSubscriptionExpired).toBe(false)
    })
  })

  describe('isLogin', () => {
    it('haveRequestToken=true → true', () => {
      haveRequestTokenMock.mockReturnValue(true)
      const store = useUserStore()
      expect(store.isLogin).toBe(true)
    })

    it('haveRequestToken=false → false', () => {
      haveRequestTokenMock.mockReturnValue(false)
      const store = useUserStore()
      expect(store.isLogin).toBe(false)
    })
  })

  describe('showCloseInstallExtTips', () => {
    it('lastCloseInstallExtTipsDates 长度 0 → { canShow: true, showedAlready: false }', () => {
      const store = useUserStore()
      // 默认 state 已是 []
      expect(store.showCloseInstallExtTips).toEqual({ canShow: true, showedAlready: false })
    })

    it('长度 1 边界 → { canShow: true, showedAlready: true }', () => {
      const store = useUserStore()
      store.lastCloseInstallExtTipsDates = [Date.now()]
      // 源码：canShow = length<=1（长度 1 仍 true）；showedAlready = length>0（长度 1 为 true）
      expect(store.showCloseInstallExtTips).toEqual({ canShow: true, showedAlready: true })
    })

    it('长度 2 → { canShow: false, showedAlready: true }', () => {
      const store = useUserStore()
      store.lastCloseInstallExtTipsDates = [Date.now(), Date.now()]
      expect(store.showCloseInstallExtTips).toEqual({ canShow: false, showedAlready: true })
    })
  })

  describe('showShareTips', () => {
    it('shareTipsClicked=false → true；=true → false（断言取反语义）', () => {
      const store = useUserStore()
      // 默认 shareTipsClicked=false → showShareTips=true
      expect(store.showShareTips).toBe(true)
      store.shareTipsClicked = true
      expect(store.showShareTips).toBe(false)
    })
  })

  describe('canRequetPushPermission', () => {
    it('lastRequestPushPermissionDate=0 → true（短路）', () => {
      const store = useUserStore()
      // 默认 state 已是 0，命中 `=== 0` 短路分支
      expect(store.canRequetPushPermission).toBe(true)
    })

    it('date≠0 + 距 now ≤ 1h → false', () => {
      const store = useUserStore()
      // 30 分钟前请求过，落在 1 小时窗口内
      store.lastRequestPushPermissionDate = Date.now() - 1000 * 60 * 30
      expect(store.canRequetPushPermission).toBe(false)
    })

    it('date≠0 + 距 now > 1h → true', () => {
      const store = useUserStore()
      // 90 分钟前请求过，超出 1 小时窗口
      store.lastRequestPushPermissionDate = Date.now() - 1000 * 60 * 90
      expect(store.canRequetPushPermission).toBe(true)
    })
  })
})

// vitest 的 describe 不会跨并列块继承 beforeEach，下面两个 describe 必须各自重写一遍 setup
describe('useUserStore - 纯本地 state actions', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    haveRequestTokenMock.mockReset().mockReturnValue(false)
    useI18nMock.mockReset().mockReturnValue({ locale: { value: 'en' } })
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-23T10:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('clearUserInfo', () => {
    it('user 设为 null', async () => {
      const store = useUserStore()
      store.user = baseUser
      await store.clearUserInfo()
      expect(store.user).toBeNull()
    })
  })

  describe('updatePayTimeRecord', () => {
    it('payTimeRecord 设为 Date.now()', () => {
      const store = useUserStore()
      // useFakeTimers 锁住后 Date.now() 是稳定值，可精确等于
      const expected = Date.now()
      store.updatePayTimeRecord()
      expect(store.payTimeRecord).toBe(expected)
    })
  })

  describe('clearPayTimeRecord', () => {
    it('payTimeRecord 设为 null', () => {
      const store = useUserStore()
      store.payTimeRecord = Date.now()
      store.clearPayTimeRecord()
      expect(store.payTimeRecord).toBeNull()
    })
  })

  describe('updateCloseInstallExtTipsDate', () => {
    it('append Date.now() 到 lastCloseInstallExtTipsDates', () => {
      const store = useUserStore()
      // 1 小时前已有一次记录，本次 append 形成 [before, now]
      const before = Date.now() - 1000 * 60 * 60
      store.lastCloseInstallExtTipsDates = [before]
      store.updateCloseInstallExtTipsDate()
      expect(store.lastCloseInstallExtTipsDates).toEqual([before, Date.now()])
    })
  })

  describe('updateShareTipsClicked', () => {
    it('shareTipsClicked 设为 true', () => {
      const store = useUserStore()
      // 默认初值为 false，调用后翻转
      expect(store.shareTipsClicked).toBe(false)
      store.updateShareTipsClicked()
      expect(store.shareTipsClicked).toBe(true)
    })
  })

  describe('updateLastRequestPushPermissionDate', () => {
    it('lastRequestPushPermissionDate 设为 Date.now()', () => {
      const store = useUserStore()
      const expected = Date.now()
      store.updateLastRequestPushPermissionDate()
      expect(store.lastRequestPushPermissionDate).toBe(expected)
    })
  })
})

describe('useUserStore - subscribe 相关 actions', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    haveRequestTokenMock.mockReset().mockReturnValue(false)
    useI18nMock.mockReset().mockReturnValue({ locale: { value: 'en' } })
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-23T10:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('getSubscribeCollectionTimeRecord', () => {
    it('subscribeCollectionTimeRecord=null → 返回 null', () => {
      const store = useUserStore()
      // 默认 state.subscribeCollectionTimeRecord 已是 null，命中前置短路
      expect(store.getSubscribeCollectionTimeRecord('any-code')).toBeNull()
    })

    it('collectionCode 不存在 → 返回 null', () => {
      const store = useUserStore()
      store.subscribeCollectionTimeRecord = {
        'other-code': { time: Date.now(), subscribed: true, cancelled: false, deleted: false }
      }
      expect(store.getSubscribeCollectionTimeRecord('any-code')).toBeNull()
    })

    it('collectionCode 存在 → 返回 { subscribed, cancelled, deleted }（不含 time）', () => {
      const store = useUserStore()
      store.subscribeCollectionTimeRecord = {
        'col-1': { time: Date.now(), subscribed: true, cancelled: false, deleted: false }
      }
      // 源码 line 191-195 显式只投出三字段，time 不外泄
      expect(store.getSubscribeCollectionTimeRecord('col-1')).toEqual({
        subscribed: true,
        cancelled: false,
        deleted: false
      })
    })
  })

  describe('isJustSubscribeCollection', () => {
    it('subscribeCollectionTimeRecord=null → false', () => {
      const store = useUserStore()
      expect(store.isJustSubscribeCollection('any-code', { subscribed: true, cancelled: false, deleted: false })).toBe(false)
    })

    it('collectionCode 不存在 → false', () => {
      const store = useUserStore()
      store.subscribeCollectionTimeRecord = {
        'other-code': { time: Date.now(), subscribed: true, cancelled: false, deleted: false }
      }
      expect(store.isJustSubscribeCollection('any-code', { subscribed: true, cancelled: false, deleted: false })).toBe(false)
    })

    it('状态一致 + 距 now < 10 分钟 → true', () => {
      const store = useUserStore()
      // 5 分钟前订阅，三字段一致 → 落在 10 分钟窗口内
      store.subscribeCollectionTimeRecord = {
        'col-1': { time: Date.now() - 1000 * 60 * 5, subscribed: true, cancelled: false, deleted: false }
      }
      expect(store.isJustSubscribeCollection('col-1', { subscribed: true, cancelled: false, deleted: false })).toBe(true)
    })

    it('状态不一致（subscribed 字段不同）→ false', () => {
      const store = useUserStore()
      // 时间在窗口内，但 subscribed 字段不一致 → 命中 line 202 的状态变更分支
      store.subscribeCollectionTimeRecord = {
        'col-1': { time: Date.now() - 1000 * 60 * 5, subscribed: true, cancelled: false, deleted: false }
      }
      expect(store.isJustSubscribeCollection('col-1', { subscribed: false, cancelled: false, deleted: false })).toBe(false)
    })

    it('状态一致 + 距 now > 10 分钟 → false', () => {
      const store = useUserStore()
      // 15 分钟前订阅，三字段一致但超窗
      store.subscribeCollectionTimeRecord = {
        'col-1': { time: Date.now() - 1000 * 60 * 15, subscribed: true, cancelled: false, deleted: false }
      }
      expect(store.isJustSubscribeCollection('col-1', { subscribed: true, cancelled: false, deleted: false })).toBe(false)
    })
  })

  describe('updateSubscribeCollectionTimeRecord', () => {
    it('record=null 时初始化 + 写入；同 key 后续写入覆盖时间和状态', () => {
      const store = useUserStore()
      // 初次：record 为 null → 内部先 `this.subscribeCollectionTimeRecord = {}` 再写入
      store.updateSubscribeCollectionTimeRecord('col-1', { subscribed: true, cancelled: false, deleted: false })
      expect(store.subscribeCollectionTimeRecord).toEqual({
        'col-1': { time: Date.now(), subscribed: true, cancelled: false, deleted: false }
      })
      // 推进 1 分钟，同 key 再写：time 与状态都被新值覆盖
      vi.advanceTimersByTime(1000 * 60)
      const newTime = Date.now()
      store.updateSubscribeCollectionTimeRecord('col-1', { subscribed: false, cancelled: true, deleted: false })
      expect(store.subscribeCollectionTimeRecord).toEqual({
        'col-1': { time: newTime, subscribed: false, cancelled: true, deleted: false }
      })
    })
  })

  describe('clearSubscribeCollectionTimeRecord', () => {
    it('record=null 时早退（不抛错、record 仍为 null）', () => {
      const store = useUserStore()
      // 默认 state.subscribeCollectionTimeRecord = null → 命中 line 221 前置 return
      expect(() => store.clearSubscribeCollectionTimeRecord('any-code')).not.toThrow()
      expect(store.subscribeCollectionTimeRecord).toBeNull()
    })

    it('删唯一 key 后整个 record 置回 null', () => {
      const store = useUserStore()
      store.subscribeCollectionTimeRecord = {
        'col-1': { time: Date.now(), subscribed: true, cancelled: false, deleted: false }
      }
      store.clearSubscribeCollectionTimeRecord('col-1')
      // 源码 line 226-227：剩余 keys 为 0 时整体回退到 null（而非空对象）
      expect(store.subscribeCollectionTimeRecord).toBeNull()
    })

    it('删一个 key 后还有其它 key → record 保留剩余 entries', () => {
      const store = useUserStore()
      store.subscribeCollectionTimeRecord = {
        'col-1': { time: Date.now(), subscribed: true, cancelled: false, deleted: false },
        'col-2': { time: Date.now(), subscribed: false, cancelled: true, deleted: false }
      }
      store.clearSubscribeCollectionTimeRecord('col-1')
      expect(store.subscribeCollectionTimeRecord).toEqual({
        'col-2': { time: Date.now(), subscribed: false, cancelled: true, deleted: false }
      })
    })
  })
})

// Sprint 2.2.1：4 个直接调 request() 的 action（refreshUserInfo / getUserInfo / refreshUserToken / changeUserSetting）
// 共 10 用例。注意 refreshUserToken 是 fire-and-forget 风格——内部 .then 走 microtask；
// 由于 vi.useFakeTimers 不会自动推进 timer，但 await Promise.resolve() 仍可同步推进 microtask 队列，
// 因此用 `await Promise.resolve(); await Promise.resolve()` 兜住 .then 副作用。
describe('useUserStore - request 类 actions', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    haveRequestTokenMock.mockReset().mockReturnValue(false)
    useI18nMock.mockReset().mockReturnValue({ locale: { value: 'en' } })
    mockGet.mockReset()
    mockPost.mockReset()
    mockRequest.mockClear()
    cookieGet.mockReset().mockReturnValue(undefined)
    cookieSet.mockClear()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-23T10:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('refreshUserInfo', () => {
    it('request().get 成功 → 写入 store.user 并返回 user', async () => {
      const fixture = makeUser({ lang: 'en' })
      mockGet.mockResolvedValueOnce(fixture)
      const store = useUserStore()
      // 与 fixture.lang 一致，避免触发 changeLocalLocale 副作用干扰本用例断言面
      store.locale = 'en'
      const result = await store.refreshUserInfo()
      expect(result).toEqual(fixture)
      expect(store.user).toEqual(fixture)
      expect(mockGet).toHaveBeenCalledWith({ url: '/v1/user/me' })
    })

    it('后端返回空 → 抛 "refresh user info failed"', async () => {
      mockGet.mockResolvedValueOnce(undefined)
      const store = useUserStore()
      await expect(store.refreshUserInfo()).rejects.toThrow('refresh user info failed')
      // 异常路径下 user 不被覆写
      expect(store.user).toBeNull()
    })

    it('resp.lang 与当前 locale 不同 → 调 changeLocalLocale 同步', async () => {
      mockGet.mockResolvedValueOnce(makeUser({ lang: 'zh' }))
      const store = useUserStore()
      store.locale = 'en'
      // 直接 spy 在 store action 上，避免顶层 mock useNuxtApp 破坏 setupNuxt 初始化
      // （pinia payload-plugin 在 init 期会读 nuxtApp 上的 skipHydrate）
      const spy = vi.spyOn(store, 'changeLocalLocale').mockResolvedValue()
      await store.refreshUserInfo()
      expect(spy).toHaveBeenCalledWith('zh')
    })

    it('resp.lang 与当前 locale 相同 → 不调 changeLocalLocale', async () => {
      mockGet.mockResolvedValueOnce(makeUser({ lang: 'en' }))
      const store = useUserStore()
      store.locale = 'en'
      const spy = vi.spyOn(store, 'changeLocalLocale').mockResolvedValue()
      await store.refreshUserInfo()
      expect(spy).not.toHaveBeenCalled()
    })
  })

  describe('getUserInfo', () => {
    it('options.refresh=true + isLogin=true → 先调 refreshUserInfo + 返回更新后的 user', async () => {
      const fixture = makeUser()
      mockGet.mockResolvedValueOnce(fixture)
      // isLogin getter 调 haveRequestToken()，置 true 走 refresh 分支
      haveRequestTokenMock.mockReturnValue(true)
      const store = useUserStore()
      const result = await store.getUserInfo({ refresh: true })
      expect(result).toEqual(fixture)
      expect(mockGet).toHaveBeenCalledTimes(1)
    })

    it('this.user 已存在 + 不带 refresh → 直接返回 user，不调 refreshUserInfo', async () => {
      const store = useUserStore()
      store.user = baseUser
      const result = await store.getUserInfo()
      expect(result).toEqual(baseUser)
      // 不进入 refresh 分支，request().get 不应被触发
      expect(mockGet).not.toHaveBeenCalled()
    })

    it('this.user 为空 + 没有 refresh → 抛 "get user info failed"', async () => {
      const store = useUserStore()
      await expect(store.getUserInfo()).rejects.toThrow('get user info failed')
    })
  })

  describe('refreshUserToken', () => {
    it('request().post 成功 → cookies.set 写入 token（含 60 天 expires + COOKIE_DOMAIN）', async () => {
      mockPost.mockResolvedValueOnce({ token: 'tk-1' })
      const store = useUserStore()
      // 源码 line 145-156：refreshUserToken 内部 .then 是 microtask，await action 本身只等同步部分
      await store.refreshUserToken()
      // microtask flush：第一次 resolve `request().post(...)`，第二次 settle .then 的回调
      await Promise.resolve()
      await Promise.resolve()
      expect(cookieSet).toHaveBeenCalledWith(
        'token',
        'tk-1',
        expect.objectContaining({
          path: '/',
          domain: '.example.com',
          expires: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000)
        })
      )
    })

    it('后端返回 falsy → return 不写 cookie 不抛错', async () => {
      mockPost.mockResolvedValueOnce(undefined)
      const store = useUserStore()
      await expect(store.refreshUserToken()).resolves.toBeUndefined()
      // 同样 flush 一遍 microtask，确认 .then 早退分支不触发 cookieSet
      await Promise.resolve()
      await Promise.resolve()
      expect(cookieSet).not.toHaveBeenCalled()
    })
  })

  describe('changeUserSetting', () => {
    it('调用 request().post 用正确 url + body', async () => {
      mockPost.mockResolvedValueOnce({ ok: true })
      const store = useUserStore()
      await store.changeUserSetting('lang', 'zh')
      expect(mockPost).toHaveBeenCalledWith({
        url: '/v1/user/setting',
        body: { key: 'lang', value: 'zh' }
      })
    })
  })
})

// Sprint 2.2.2：复合 actions（changeLocale / checkAndRefreshUserToken）共 5 用例
// 关键风险：changeLocale 链路 changeUserSetting().then(refreshUserToken + changeLocalLocale)，
// refreshUserToken 内部又是 fire-and-forget；mockPost 必须按调用顺序预置，避免 undefined.then 异步抛错。
// vi.useFakeTimers 不会自动推进 timer，但 await Promise.resolve() 仍可同步推进 microtask 队列。
describe('useUserStore - 复合 actions', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    haveRequestTokenMock.mockReset().mockReturnValue(false)
    useI18nMock.mockReset().mockReturnValue({ locale: { value: 'en' } })
    mockGet.mockReset()
    mockPost.mockReset()
    mockRequest.mockClear()
    cookieGet.mockReset().mockReturnValue(undefined)
    cookieSet.mockClear()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-23T10:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('changeLocale', () => {
    it('locale 与当前相同 → 早退（不调 mockPost）', async () => {
      const store = useUserStore()
      // 当前 locale 与目标一致 → 命中 user.ts:130 的 `if (this.locale === locale) return`
      store.locale = 'zh'
      await store.changeLocale('zh')
      expect(mockPost).not.toHaveBeenCalled()
    })

    it('locale 不同 → changeUserSetting 后 .then 触发 refreshUserToken + changeLocalLocale', async () => {
      // changeUserSetting 与 refreshUserToken 都调 mockPost；按顺序预置两次返回值，
      // 否则 fire-and-forget 链路 undefined.then 会异步抛错并污染下个用例
      mockPost.mockResolvedValueOnce(undefined).mockResolvedValueOnce({ token: 'tk' })

      const store = useUserStore()
      store.locale = 'en'

      // 在 store action 上局部 spy 拦 changeLocalLocale —— 不能 mock useNuxtApp 顶层（破坏 setupNuxt）
      const localeSpy = vi.spyOn(store, 'changeLocalLocale').mockResolvedValue()

      await store.changeLocale('zh')
      // 第一次 flush：changeUserSetting 的 await 链 settle，进入 .then 回调
      await Promise.resolve()
      // 第二次 flush：refreshUserToken 内部 .then 链 settle
      await Promise.resolve()

      expect(mockPost).toHaveBeenCalledTimes(2)
      // 用 toHaveBeenNthCalledWith 替代 mock.calls[i][j] 索引访问，规避元组元素可能为 undefined 的 TS 收紧
      expect(mockPost).toHaveBeenNthCalledWith(1, {
        url: '/v1/user/setting',
        body: { key: 'lang', value: 'zh' }
      })
      expect(mockPost).toHaveBeenNthCalledWith(2, { url: '/v1/user/refresh' })
      expect(localeSpy).toHaveBeenCalledWith('zh')
    })
  })

  describe('checkAndRefreshUserToken', () => {
    it('距 lastRefreshTokenDate < 24h → 早退', () => {
      const store = useUserStore()
      // 1 小时前刚刷过 → 命中 user.ts:172 的 24h 早退分支
      store.lastRefreshTokenDate = Date.now() - 1000 * 60 * 60
      store.checkAndRefreshUserToken()
      expect(cookieGet).not.toHaveBeenCalled()
      expect(mockPost).not.toHaveBeenCalled()
    })

    it('距 > 24h 但 token cookie 不存在 → 早退（不调 refreshUserToken）', () => {
      const store = useUserStore()
      // 25 小时前刷过 → 跨过 24h 门槛，进入 cookie 检查
      store.lastRefreshTokenDate = Date.now() - 1000 * 60 * 60 * 25
      cookieGet.mockReturnValue(undefined) // 'token' cookie 不存在
      store.checkAndRefreshUserToken()
      // 源码 line 177 写死字符串 'token'（不是 COOKIE_TOKEN_NAME）
      expect(cookieGet).toHaveBeenCalledWith('token')
      expect(mockPost).not.toHaveBeenCalled()
    })

    it('距 > 24h + token 存在 → 更新 lastRefreshTokenDate + 调 refreshUserToken', async () => {
      const store = useUserStore()
      const oldDate = Date.now() - 1000 * 60 * 60 * 25
      store.lastRefreshTokenDate = oldDate
      cookieGet.mockReturnValue('existing-token')
      // refreshUserToken 内部 .then 链需要 mockPost 有 resolve 值，否则 undefined.then 异步抛错
      mockPost.mockResolvedValueOnce({ token: 'new-tk' })

      // checkAndRefreshUserToken 不返 promise（非 async），直接调
      store.checkAndRefreshUserToken()
      // 推进 microtask：第一次 settle request().post，第二次 settle 内部 .then
      await Promise.resolve()
      await Promise.resolve()

      // 同步副作用：lastRefreshTokenDate 在调 refreshUserToken 之前就赋成 now
      expect(store.lastRefreshTokenDate).toBe(Date.now())
      expect(mockPost).toHaveBeenCalledWith({ url: '/v1/user/refresh' })
      // refreshUserToken 内部 .then 触发的 cookie 写入（确认链路真的走完）
      expect(cookieSet).toHaveBeenCalled()
    })
  })
})

// Sprint 2.2.2：changeLocalLocale 共 3 用例
// 不能在顶层 mockNuxtImport('useNuxtApp', ...)（破坏 pinia payload-plugin 的 skipHydrate 初始化）；
// 改在用例内通过真实 useNuxtApp() 拿到 nuxtApp 实例后，对 $i18n.setLocale 局部 spy。
describe('useUserStore - changeLocalLocale', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    haveRequestTokenMock.mockReset().mockReturnValue(false)
    useI18nMock.mockReset().mockReturnValue({ locale: { value: 'en' } })
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-23T10:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('locale 在白名单 ["en", "zh"] → 调 i18n.setLocale 用原值', async () => {
    const nuxtApp = useNuxtApp()
    // 局部 spy：不替换 useNuxtApp，仅劫持已注入实例上的 setLocale
    const setLocaleSpy = vi.spyOn(nuxtApp.$i18n, 'setLocale').mockResolvedValue()
    const store = useUserStore()
    await store.changeLocalLocale('zh')
    expect(store.locale).toBe('zh')
    expect(setLocaleSpy).toHaveBeenCalledWith('zh')
    setLocaleSpy.mockRestore()
  })

  it('locale 不在白名单（如 "fr"）→ fallback "en"，调 i18n.setLocale("en")', async () => {
    const nuxtApp = useNuxtApp()
    const setLocaleSpy = vi.spyOn(nuxtApp.$i18n, 'setLocale').mockResolvedValue()
    const store = useUserStore()
    // 'fr' 不在 ['en','zh'] 白名单 → 命中 user.ts:121-123 的 fallback 分支
    await store.changeLocalLocale('fr')
    expect(store.locale).toBe('en')
    expect(setLocaleSpy).toHaveBeenCalledWith('en')
    setLocaleSpy.mockRestore()
  })

  it('this.locale 与 setLocale 调用值一致（同步赋值断言）', async () => {
    const nuxtApp = useNuxtApp()
    const setLocaleSpy = vi.spyOn(nuxtApp.$i18n, 'setLocale').mockResolvedValue()
    const store = useUserStore()
    await store.changeLocalLocale('en')
    // 源码 line 126-127：先 this.locale = locale，再 setLocale(locale) → 两者必然一致
    expect(setLocaleSpy).toHaveBeenCalledWith(store.locale)
    setLocaleSpy.mockRestore()
  })
})
