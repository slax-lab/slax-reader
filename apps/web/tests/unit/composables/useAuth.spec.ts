// useAuth composable 覆盖：四个方法的副作用 + 错误分支
// 注意 useAuth 是对象字面量包装的方法集（非响应式状态机），导出形式 `() => useAuth`
// useAuth.ts 模块顶层 `const { set, get, remove } = useCookies()` 在 import 时即执行，
// 因此 vi.mock('@vueuse/integrations/useCookies', ...) 必须在 import useAuth 之前生效。
// vitest 会 hoist vi.mock 调用到文件顶部，但 mock factory 内引用的顶层变量在 hoist 后
// "还未初始化"，因此用 vi.hoisted 显式包装 cookie spies 与 store spy。
//
// request() 是 Nuxt auto-import（来源 layers/core/app/utils/request.ts），
// 必须用 mockNuxtImport('request', ...) 拦截 —— vi.mock 模块路径方式不会作用于
// auto-import 改写后的代码（README 已说明）。
//
// 注意：mockNuxtImport 是 macro，被 transform 成 vi.mock 后 hoist 到文件顶部，
// 此时跨文件 import binding 仍在 TDZ，因此 mockPost/mockRequest 必须来自同文件的
// vi.hoisted，不能从 tests/mocks/request.ts import。
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import useAuth from '~~/app/composables/useAuth'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { cookieSet, cookieGet, cookieRemove, clearUserInfo, mockPost, mockRequest } = vi.hoisted(() => {
  const post = vi.fn()
  return {
    cookieSet: vi.fn(),
    cookieGet: vi.fn(() => undefined as string | undefined),
    cookieRemove: vi.fn(),
    clearUserInfo: vi.fn(),
    mockPost: post,
    mockRequest: vi.fn(() => ({
      post,
      get: vi.fn(),
      put: vi.fn(),
      delete: vi.fn(),
      stream: vi.fn(),
      upgrade: vi.fn(),
      uploadFile: vi.fn()
    }))
  }
})

vi.mock('@vueuse/integrations/useCookies', () => ({
  useCookies: () => ({
    set: cookieSet,
    get: cookieGet,
    remove: cookieRemove
  })
}))

vi.mock('~/stores/user', () => ({
  useUserStore: () => ({ clearUserInfo })
}))

mockNuxtImport('request', () => mockRequest)

// 注意 mock 必须保留 app.baseURL：nuxt-test-utils 的 setupNuxt 会启动 router plugin，
// 该 plugin 读取 useRuntimeConfig().app.baseURL，缺失会导致 useRouter() 返回 undefined →
// setupNuxt 调用 useRouter().afterEach 报 "Cannot read properties of undefined (reading 'afterEach')"
const runtimeConfig = {
  app: { baseURL: '/' },
  public: {
    GOOGLE_OAUTH_CLIENT_ID: 'g-client-id',
    APPLE_OAUTH_CLIENT_ID: 'a-client-id',
    AUTH_BASE_URL: 'https://auth.test',
    COOKIE_TOKEN_NAME: 'token',
    COOKIE_DOMAIN: '.example.com'
  }
}
mockNuxtImport('useRuntimeConfig', () => () => runtimeConfig)

describe('useAuth', () => {
  beforeEach(() => {
    // mockPost 默认无 implementation，用 mockReset 清掉残留 mockResolvedValueOnce
    mockPost.mockReset()
    mockRequest.mockClear()
    cookieSet.mockClear()
    // cookieGet 默认返回 undefined，用 mockReset 清掉用例内的 mockReturnValue 残留后再恢复默认
    cookieGet.mockReset().mockReturnValue(undefined)
    cookieRemove.mockReset()
    clearUserInfo.mockClear()
    // 重置 location.href（happy-dom 下允许直接赋值）
    window.location.href = 'http://localhost/'
    // 重置 COOKIE_DOMAIN，防止上一个用例改动污染后续
    runtimeConfig.public.COOKIE_DOMAIN = '.example.com'
  })

  describe('requestAuth', () => {
    it('拼接 Google OAuth URL 并跳转', async () => {
      await useAuth().requestAuth({ redirect: '/home', affCode: 'aff1' })
      expect(window.location.href).toContain('https://accounts.google.com/o/oauth2/v2/auth')
      expect(window.location.href).toContain('client_id=g-client-id')
      expect(window.location.href).toContain('redirect_uri=')
      const state = decodeURIComponent(window.location.href.split('state=')[1] ?? '')
      const stateObj = JSON.parse(state)
      expect(stateObj.platform).toBe('google')
      expect(stateObj.target).toBe('/home')
      expect(stateObj.affCode).toBe('aff1')
    })
  })

  describe('requestAppleAuth', () => {
    it('拼接 Apple OAuth URL 并跳转', async () => {
      await useAuth().requestAppleAuth({ redirect: '/back', affCode: 'aff2' })
      expect(window.location.href).toContain('https://appleid.apple.com/auth/authorize')
      expect(window.location.href).toContain('client_id=a-client-id')
      const state = decodeURIComponent(window.location.href.split('state=')[1] ?? '')
      expect(JSON.parse(state).platform).toBe('apple')
    })
  })

  describe('grantAuth', () => {
    it('登录成功 → 写 cookie 并返回 token', async () => {
      mockPost.mockResolvedValueOnce({ token: 'tok-google' })
      const token = await useAuth().grantAuth('code-1', 'https://auth.test/auth', 'aff3', 'google')
      expect(token).toBe('tok-google')
      expect(mockPost).toHaveBeenCalledTimes(1)
      expect(cookieSet).toHaveBeenCalledWith('token', 'tok-google', expect.objectContaining({ path: '/', domain: '.example.com' }))
    })

    it('登录返回为空 → 抛 "login failed"', async () => {
      mockPost.mockResolvedValueOnce(undefined)
      await expect(useAuth().grantAuth('code-x', 'https://auth.test/auth', '', 'google')).rejects.toThrow('login failed')
      expect(cookieSet).not.toHaveBeenCalled()
    })

    it('platformType=apple 时使用 apple client_id', async () => {
      mockPost.mockResolvedValueOnce({ token: 'tok-apple' })
      await useAuth().grantAuth('code-2', 'https://auth.test/auth', 'aff4', 'apple')
      const call = mockPost.mock.calls[0]![0]
      expect(call.body.client_id).toBe('a-client-id')
      expect(call.body.type).toBe('apple')
    })
  })

  describe('clearAuth', () => {
    it('清 cookie 两次（带 domain / 不带 domain）+ 清 store', async () => {
      await useAuth().clearAuth()
      expect(cookieRemove).toHaveBeenCalledWith('token', { path: '/', domain: '.example.com' })
      expect(cookieRemove).toHaveBeenCalledWith('token', { path: '/' })
      expect(clearUserInfo).toHaveBeenCalledTimes(1)
    })

    it('checkAndRemoveOriginalCookies 抛错时不影响 clearAuth 完成（try/catch 兜底）', async () => {
      // splits.length > 2 且存在旧 cookie 触发父域名 remove；让该次 remove 抛错
      runtimeConfig.public.COOKIE_DOMAIN = '.sub.example.com'
      cookieGet.mockReturnValue('old-token')
      let callCount = 0
      cookieRemove.mockImplementation(() => {
        callCount++
        if (callCount === 3) throw new Error('remove failed')
      })
      await expect(useAuth().clearAuth()).resolves.toBeUndefined()
      expect(cookieRemove).toHaveBeenCalledTimes(3) // 2 次正常 + 1 次抛错
      expect(clearUserInfo).toHaveBeenCalled()
    })

    it('COOKIE_DOMAIN 有三段但 cookie 为空时不调用额外 remove', async () => {
      runtimeConfig.public.COOKIE_DOMAIN = '.sub.example.com'
      // cookieGet 默认返回 undefined（beforeEach 已设），不需要额外设置
      await useAuth().clearAuth()
      expect(cookieRemove).toHaveBeenCalledTimes(2) // 仅两次正常 remove，没有第三次
    })
  })
})
