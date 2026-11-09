// Cookie functions are captured at module load. Keep their hoisted spies
// stable and replace only the browser-storage boundary in cleanup tests.
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { useNuxtApp } from '#app'
import useAuth from '~~/app/composables/useAuth'
import { fetchSyncCredentials } from '~~/app/local-first/connector'
import authMiddleware from '~~/app/middleware/auth.global'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { cookieSet, cookieGet, cookieRemove, clearUserInfo, mockPost, mockRequest } = vi.hoisted(() => {
  const post = vi.fn()
  return {
    cookieSet: vi.fn(),
    cookieGet: vi.fn<(name?: string) => string | undefined>(),
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
const { navigateTo } = vi.hoisted(() => ({ navigateTo: vi.fn() }))
mockNuxtImport('navigateTo', () => navigateTo)

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
    COOKIE_DOMAIN: '.example.com',
    DWEB_API_BASE_URL: 'https://api.test'
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
    clearUserInfo.mockReset()
    navigateTo.mockClear()
    // 重置 location.href（happy-dom 下允许直接赋值）
    window.location.href = 'http://localhost/'
    // 重置 COOKIE_DOMAIN，防止上一个用例改动污染后续
    runtimeConfig.public.COOKIE_DOMAIN = '.example.com'
    runtimeConfig.public.COOKIE_TOKEN_NAME = 'token'
  })

  afterEach(() => vi.restoreAllMocks())

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
    it('does not store a session when a canceled request completes late', async () => {
      const controller = new AbortController()
      let finish!: (response: { token: string }) => void
      mockPost.mockImplementation(() => new Promise(resolve => { finish = resolve }))
      const login = useAuth().grantAuth('old-code', 'https://auth.test/auth', '', 'google', undefined, { signal: controller.signal })
      controller.abort()
      finish({ token: 'late-token' })
      await expect(login).rejects.toMatchObject({ name: 'AbortError' })
      expect(cookieSet).not.toHaveBeenCalled()
    })

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

    it('rejects login success when the configured cookie name is invalid', async () => {
      runtimeConfig.public.COOKIE_TOKEN_NAME = { token: 'token' } as never
      mockPost.mockResolvedValueOnce({ token: 'tok-google' })
      await expect(useAuth().grantAuth('code-1', 'https://auth.test/auth', 'aff3')).rejects.toThrow(/COOKIE_TOKEN_NAME/)
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

  describe('verifyEmailAuth', () => {
    const input = { email: 'reader@example.com', request_id: 'generation', code: '012345', aff_code: 'invite' }

    it('uses the same session cookie for email login and the Extension handoff', async () => {
      mockPost.mockResolvedValueOnce({ token: 'otp-session' })
      await expect(useAuth().verifyEmailAuth(input)).resolves.toBe('otp-session')
      expect(mockPost).toHaveBeenCalledWith(expect.objectContaining({ url: '/v1/user/login/email/verify', body: input }))
      expect(cookieSet).toHaveBeenCalledWith('token', 'otp-session', expect.objectContaining({ path: '/', domain: '.example.com' }))
    })

    it('does not store a session after abandoning a verification', async () => {
      const controller = new AbortController()
      let finish!: (response: { token: string }) => void
      mockPost.mockImplementation(() => new Promise(resolve => { finish = resolve }))
      const login = useAuth().verifyEmailAuth(input, { signal: controller.signal })
      controller.abort()
      finish({ token: 'late-session' })
      await expect(login).rejects.toMatchObject({ name: 'AbortError' })
      expect(cookieSet).not.toHaveBeenCalled()
    })

    it('does not replace a session established during verification', async () => {
      mockPost.mockImplementation(async () => {
        cookieGet.mockReturnValue('new-current-session')
        return { token: 'otp-session' }
      })
      await expect(useAuth().verifyEmailAuth(input)).rejects.toThrow()
      expect(cookieSet).not.toHaveBeenCalled()
    })
  })

  describe('collection attribution', () => {
    const attribution = { collection_id: 'Collection123', source_screen: 'collection', presentation: 'modal', trigger_element_id: 'collection_subscribe_button' } as const

    it('keeps each Google redirect context independent and does not leak it to ordinary login', async () => {
      const auth = useAuth()
      await auth.requestAuth({ redirect: '/c/Collection123?subscribe_after_login=1', affCode: 'aff1', authAttribution: attribution })
      const first = JSON.parse(new URL(window.location.href).searchParams.get('state')!)
      await auth.requestAuth({ redirect: '/c/Other456', affCode: '', authAttribution: { ...attribution, collection_id: 'Other456' } })
      const second = JSON.parse(new URL(window.location.href).searchParams.get('state')!)
      await auth.requestAuth({ redirect: '/bookmarks', affCode: '' })
      const ordinary = JSON.parse(new URL(window.location.href).searchParams.get('state')!)
      expect(first).toMatchObject({ auth_attribution: attribution, target: '/c/Collection123?subscribe_after_login=1', affCode: 'aff1', platform: 'google', redirectUrl: 'https://auth.test/auth' })
      expect(second.auth_attribution.collection_id).toBe('Other456')
      expect(ordinary).not.toHaveProperty('auth_attribution')
    })

    it('carries callback provenance into the Google login request without changing credentials', async () => {
      mockPost.mockResolvedValueOnce({ token: 'tok-google' })
      await useAuth().grantAuth('code-1', 'https://auth.test/auth', 'aff3', 'google', attribution)
      expect(mockPost.mock.calls[0]![0].body).toEqual({ code: 'code-1', redirect_uri: 'https://auth.test/auth', aff_code: 'aff3', type: 'google', client_id: 'g-client-id', auth_attribution: attribution })
    })

    it('does not attach collection attribution to Apple authentication', async () => {
      mockPost.mockResolvedValueOnce({ token: 'tok-apple' })
      await useAuth().grantAuth('code-2', 'https://auth.test/auth', '', 'apple', attribution)
      expect(mockPost.mock.calls[0]![0].body).not.toHaveProperty('auth_attribution')
    })
  })

  describe('acquisition attribution', () => {
    const header = { source: 'hackerlinks', medium: 'header', campaign: 'mvp' } as const
    const resource = { source: 'hackerlinks', medium: 'resource_detail', campaign: 'mvp' } as const

    it('keeps Google and Apple authorization contexts independent and omits ordinary attempts', async () => {
      const auth = useAuth()
      await auth.requestAuth({ redirect: '/bookmarks', affCode: '', authAttribution: header })
      const google = JSON.parse(new URL(window.location.href).searchParams.get('state')!)
      await auth.requestAppleAuth({ redirect: '/bookmarks', affCode: '', authAttribution: resource })
      const apple = JSON.parse(new URL(window.location.href).searchParams.get('state')!)
      await auth.requestAppleAuth({ redirect: '/bookmarks', affCode: '' })
      const ordinary = JSON.parse(new URL(window.location.href).searchParams.get('state')!)
      expect(google).toMatchObject({ platform: 'google', target: '/bookmarks', auth_attribution: header })
      expect(apple).toMatchObject({ platform: 'apple', target: '/bookmarks', auth_attribution: resource })
      expect(ordinary).not.toHaveProperty('auth_attribution')
    })

    it.each([
      { provider: 'google', clientId: 'g-client-id', attribution: header },
      { provider: 'apple', clientId: 'a-client-id', attribution: resource }
    ] as const)('carries acquisition into the $provider login request', async ({ provider, clientId, attribution }) => {
      mockPost.mockResolvedValueOnce({ token: 'tok-acquisition' })
      await useAuth().grantAuth('code-1', 'https://auth.test/auth', '', provider, attribution)
      expect(mockPost.mock.calls[0]![0].body).toEqual({ code: 'code-1', redirect_uri: 'https://auth.test/auth', aff_code: '', type: provider, client_id: clientId, auth_attribution: attribution })
    })
  })

  describe('clearAuth', () => {
    it('clears user state when the configured cookie name is invalid', async () => {
      runtimeConfig.public.COOKIE_TOKEN_NAME = { token: 'token' } as never
      await useAuth().clearAuth()
      expect(cookieRemove).not.toHaveBeenCalled()
      expect(clearUserInfo).toHaveBeenCalledOnce()
    })

    // Chrome distinguishes host-only cookies from explicit-domain cookies,
    // even when both use the current hostname. Model that storage boundary.
    let cookies: Array<{ name: string; value: string; domain?: string; path: string }>
    const seed = (domain?: string, name = 'token', value = 'legacy-token') => {
      cookies.push({ name, value, domain: domain?.replace(/^\./, ''), path: '/' })
    }

    beforeEach(() => {
      window.location.href = 'https://r.slax.dev/bookmarks'
      runtimeConfig.public.COOKIE_DOMAIN = 'slax.dev'
      cookies = []
      cookieGet.mockImplementation((name: string = 'token') => cookies.find(cookie => cookie.name === name)?.value)
      cookieRemove.mockImplementation((name: string, options: { domain?: string; path: string }) => {
        cookies = cookies.filter(cookie => cookie.name !== name || cookie.path !== options.path || cookie.domain !== options.domain?.replace(/^\./, ''))
      })
    })

    it('removes a legacy current-host domain cookie after migration to a parent domain', async () => {
      seed('.r.slax.dev')
      await useAuth().clearAuth()
      expect(cookies).toEqual([])
      expect(clearUserInfo).toHaveBeenCalledTimes(1)
    })

    it('removes every supported variant without deleting differently named cookies', async () => {
      runtimeConfig.public.COOKIE_TOKEN_NAME = 'session'
      seed(undefined, 'session')
      seed('.slax.dev', 'session')
      seed('.r.slax.dev', 'session')
      seed('.r.slax.dev', 'preference', 'dark')
      await useAuth().clearAuth()
      expect(cookies).toEqual([{ name: 'preference', value: 'dark', domain: 'r.slax.dev', path: '/' }])
    })

    it('preserves cleanup of the previously supported parent domain', async () => {
      runtimeConfig.public.COOKIE_DOMAIN = '.r.slax.dev'
      seed('.r.slax.dev')
      seed('.slax.dev')
      await useAuth().clearAuth()
      expect(cookies).toEqual([])
    })

    it.each(['localhost', '127.0.0.1', '[::1]'])('clears a host-only session on %s repeatedly', async hostname => {
      window.location.href = `http://${hostname}/bookmarks`
      runtimeConfig.public.COOKIE_DOMAIN = hostname
      seed()
      await useAuth().clearAuth()
      await useAuth().clearAuth()
      expect(cookies).toEqual([])
    })

    it('completes with no login cookie', async () => {
      await expect(useAuth().clearAuth()).resolves.toBeUndefined()
      expect(cookies).toEqual([])
    })

    it('still clears the current-host cookie if an optional domain cannot be removed', async () => {
      seed('.r.slax.dev')
      const removeCookie = cookieRemove.getMockImplementation()!
      cookieRemove.mockImplementation((name: string, options: { domain?: string; path: string }) => {
        if (options.domain === 'slax.dev') throw new Error('Unsupported domain')
        removeCookie(name, options)
      })
      await useAuth().clearAuth()
      expect(cookies).toEqual([])
      expect(clearUserInfo).toHaveBeenCalledOnce()
    })

    it.each(['manual logout', 'HTTP 401'])('allows the login route after %s clears a migrated session', async reason => {
      const publicConfig = useNuxtApp().$config.public
      const originalName = publicConfig.COOKIE_TOKEN_NAME
      publicConfig.COOKIE_TOKEN_NAME = 'token'
      const route = (path: string) => ({ path, fullPath: path, hash: '', query: {} })
      const enterLogin = () => authMiddleware(route('/login') as never, route('/bookmarks') as never)
      seed('.r.slax.dev')
      try {
        await enterLogin()
        expect(navigateTo).toHaveBeenCalledWith('/bookmarks')
        navigateTo.mockClear()
        if (reason === 'HTTP 401') {
          const { request: createRequest } = await vi.importActual<typeof import('~~/app/utils/request')>('~~/app/utils/request')
          await createRequest().options.responseInterceptors!({ status: 401, data: null, message: '' })
          expect(navigateTo).toHaveBeenCalledWith('/login')
        } else {
          await useAuth().clearAuth()
        }
        navigateTo.mockClear()
        expect(await enterLogin()).toBeUndefined()
        expect(navigateTo).not.toHaveBeenCalled()
        expect(cookies).toEqual([])
      } finally {
        publicConfig.COOKIE_TOKEN_NAME = originalName
      }
    })

    it('waits for user-state cleanup before reporting completion', async () => {
      let finish!: () => void
      clearUserInfo.mockImplementation(() => new Promise<void>(resolve => { finish = resolve }))
      let complete = false
      const clearing = useAuth().clearAuth().then(() => { complete = true })
      await Promise.resolve()
      expect(complete).toBe(false)
      finish()
      await clearing
      expect(complete).toBe(true)
    })

    it('stops sending a rejected legacy token after 401 cleanup and allows a fresh session', async () => {
      seed('.r.slax.dev')
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 401 }))
      const credentials = () => fetchSyncCredentials({
        baseUrl: 'https://api.test',
        authToken: cookieGet('token'),
        onUnauthorized: () => useAuth().clearAuth()
      })
      await expect(credentials()).resolves.toEqual({ token: '', endpoint: '' })
      await expect(credentials()).resolves.toEqual({ token: '', endpoint: '' })
      expect(fetchMock).toHaveBeenCalledOnce()
      expect(cookies).toEqual([])

      seed('.slax.dev', 'token', 'fresh-login-token')
      fetchMock.mockResolvedValue(new Response(JSON.stringify({ data: { token: 'sync-token', endpoint: 'https://sync.test' } }), { status: 200 }))
      await expect(credentials()).resolves.toEqual({ token: 'sync-token', endpoint: 'https://sync.test' })
      expect(fetchMock).toHaveBeenLastCalledWith('https://api.test/v1/sync/token', expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer fresh-login-token' })
      }))
    })
  })
})
