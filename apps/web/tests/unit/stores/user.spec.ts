// user store 纯逻辑覆盖（Sprint 2.1.1）：8 个 getter 共 18 用例
// 注意 useUserStore() 初始化 state.locale 取自 useI18n()?.locale?.value（stores/user.ts:54），
// 必须 mock useI18n，否则 store 实例化会因 vue-i18n "must be called from inside a setup function" 报错。
// haveRequestToken 来自 layers/core/app/utils/request.ts 的 nuxt auto-import，
// 直接 vi.mock 模块路径拦不到 auto-import 改写后的代码（与 useAuth.spec.ts 同模式），必须用 mockNuxtImport。
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { SubscriptionType } from '@slax-reader/contracts/interface'
import { useNuxtApp } from '#imports'
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
const { haveRequestTokenMock, useI18nMock, mockPost, mockRequest, cookieGet, cookieSet, cookieRemove } = vi.hoisted(() => {
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
    DWEB_API_BASE_URL: 'https://api.test',
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

// Exercise store wiring with the real side-effect-free adapter and mocked transport.
describe('useUserStore - account locale integration', () => {
  const token = (id: number, seq = 1) => `x.${btoa(JSON.stringify({ id, email: 'test@example.com', seq }))}.x`
  let currentToken: string | undefined
  let fetcher: ReturnType<typeof vi.fn>
  let apply: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    setActivePinia(createPinia())
    currentToken = token(1)
    cookieGet.mockReset().mockImplementation(name => (name === 'token' ? currentToken : 'device'))
    cookieSet.mockReset().mockImplementation((name, value) => {
      if (name === 'token') currentToken = value
    })
    mockPost.mockReset()
    haveRequestTokenMock.mockReturnValue(true)
    fetcher = vi.fn(
      async (url: string) =>
        new Response(JSON.stringify({ code: 200, message: 'ok', data: url.endsWith('/me') ? makeUser({ lang: 'zh' }) : url.endsWith('/refresh') ? { token: token(1, 2) } : 'ok' }))
    )
    vi.stubGlobal('fetch', fetcher)
    apply = vi.spyOn(useNuxtApp().$i18n, 'setLocale').mockResolvedValue(undefined)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    apply.mockRestore()
  })
  it('awaits a language save, updates both fields and uses the dedicated endpoint', async () => {
    const store = useUserStore()
    store.user = makeUser()
    store.locale = 'en'
    await store.changeLocale('zh')
    expect(store.user?.lang).toBe('zh')
    expect(store.locale).toBe('zh')
    expect(store.confirmedAccountLocale).toEqual({ accountKey: 'id:1', locale: 'zh' })
    expect(JSON.parse(fetcher.mock.calls[0]![1].body)).toEqual({ key: 'lang', value: 'zh' })
    expect(apply).toHaveBeenCalledWith('zh')
  })
  it('reads the current account and applies the server language', async () => {
    const store = useUserStore()
    store.locale = 'en'
    const result = await store.refreshUserInfo()
    expect(result.lang).toBe('zh')
    expect(store.user?.lang).toBe('zh')
    expect(store.locale).toBe('zh')
  })
  it('rejects malformed account responses instead of clearing state', async () => {
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ code: 200, message: 'ok', data: null })))
    const store = useUserStore()
    store.user = makeUser()
    await expect(store.refreshUserInfo()).rejects.toThrow('refresh user info failed')
    expect(store.user?.lang).toBe('en')
  })
  it('does not save merely because local display differs', async () => {
    const store = useUserStore()
    await store.changeLocalLocale('zh')
    expect(fetcher).not.toHaveBeenCalled()
    expect(store.confirmedAccountLocale).toBeNull()
  })
  it('only skips POST for an account-confirmed value and still retries display', async () => {
    const store = useUserStore()
    store.locale = 'zh'
    store.confirmedAccountLocale = { accountKey: 'id:1', locale: 'zh' }
    await store.changeLocale('zh')
    expect(fetcher.mock.calls.some(([url]) => String(url).endsWith('/setting'))).toBe(false)
    expect(apply).toHaveBeenCalledWith('zh')
  })
  it('saves an unconfirmed value even if the displayed language matches', async () => {
    const store = useUserStore()
    store.locale = 'zh'
    await store.changeLocale('zh')
    expect(fetcher.mock.calls.some(([url]) => String(url).endsWith('/setting'))).toBe(true)
  })
  it('clears account confirmation on logout', async () => {
    const store = useUserStore()
    store.user = makeUser()
    store.confirmedAccountLocale = { accountKey: 'id:1', locale: 'zh' }
    await store.clearUserInfo()
    expect(store.user).toBeNull()
    expect(store.confirmedAccountLocale).toBeNull()
  })
  it('writes a valid refresh token with configured cookie scope', async () => {
    const store = useUserStore()
    await store.refreshUserToken()
    expect(cookieSet).toHaveBeenCalledWith('token', token(1, 2), expect.objectContaining({ path: '/', domain: '.example.com' }))
  })
  it('keeps token when a refresh fails', async () => {
    fetcher.mockRejectedValueOnce(new Error('offline'))
    await useUserStore().refreshUserToken()
    expect(currentToken).toBe(token(1))
  })
  it('keeps unrelated settings on the existing request path', async () => {
    mockPost.mockResolvedValueOnce({ ok: true })
    await useUserStore().changeUserSetting('ai_lang', 'zh')
    expect(mockPost).toHaveBeenCalledWith({ url: '/v1/user/setting', body: { key: 'ai_lang', value: 'zh' } })
  })
  it('honors daily token refresh interval', () => {
    const store = useUserStore()
    store.lastRefreshTokenDate = Date.now()
    store.checkAndRefreshUserToken()
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('does not commit a profile response after its session changes', async () => {
    let release!: (value: Response) => void
    fetcher.mockReturnValueOnce(new Promise(resolve => { release = resolve }))
    const store = useUserStore()
    const pending = store.refreshUserInfo()
    const rejected = expect(pending).rejects.toThrow('superseded')
    currentToken = token(2)
    release(new Response(JSON.stringify({ code: 200, message: 'ok', data: baseUser })))
    await rejected
    expect(store.user).toBeNull()
  })
  it('gets existing user without a network read unless refresh requested', async () => {
    const store = useUserStore()
    store.user = makeUser()
    expect(await store.getUserInfo()).toEqual(makeUser())
    expect(fetcher).not.toHaveBeenCalled()
  })
})
