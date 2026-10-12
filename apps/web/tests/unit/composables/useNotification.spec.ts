// useNotification 单元测试
// 关键约束（spec 修订 2 决议）：
//  - happy-dom 20 默认 navigator.serviceWorker / Notification 都 undefined，必须 stubGlobal 才能让 isSupportedSW=true
//  - C7（无 Notification）禁止 stubGlobal('Notification', undefined)，必须移到独立 describe 不在 beforeEach 中 stub
//  - C11 subscribe().then() 不 await，await requestPushPermission() resolve 后必须 flush microtask 再断言 mockPost
//  - sendMessage 是闭包内本地函数不能 spy，断言入口改为 swRegistration.active.postMessage
//  - useRuntimeConfig mock 必须含 app.baseURL（lessons §18）
//  - vi.stubGlobal 必须在 beforeEach 内（lessons §6）+ afterEach unstubAllGlobals

import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockUseRuntimeConfig, mockRequest, mockPost, mockCookiesGet, mockRegisterSW, capturedRegisterSWOptions, defaultRuntimeConfig } = vi.hoisted(() => {
  const captured: { value: any } = { value: null }
  const mockPost = vi.fn(() => Promise.resolve({}))
  const defaultRuntimeConfig = {
    public: {
      PUSH_API_PUBLIC_KEY: 'BHnRPP6OFmStcJX5T8Mg2BQ7Y5Lv1G3K9j-pXSlw5L9MQYXt5QF6sHN3VzGvUuJqLxRkPZcWmSdNbAEcDfHhT4M',
      DWEB_API_BASE_URL: 'http://localhost:8787'
    },
    app: { baseURL: '/' }
  }
  return {
    // 必须 hoisted 默认值，setupNuxt 在 mock 第一次调用时就需要 app.baseURL（lessons §18）
    mockUseRuntimeConfig: vi.fn(() => defaultRuntimeConfig),
    mockRequest: vi.fn(() => ({ post: mockPost })),
    mockPost,
    mockCookiesGet: vi.fn(),
    mockRegisterSW: vi.fn((opts: any) => {
      captured.value = opts
    }),
    capturedRegisterSWOptions: captured,
    defaultRuntimeConfig
  }
})

mockNuxtImport('useRuntimeConfig', () => mockUseRuntimeConfig)
mockNuxtImport('request', () => mockRequest)

vi.mock('@vueuse/integrations/useCookies', () => ({
  useCookies: () => ({ get: mockCookiesGet })
}))

vi.mock('virtual:pwa-register', () => ({
  registerSW: mockRegisterSW
}))

import useNotification from '~~/app/composables/useNotification'

const makeSwRegistration = (overrides: { active?: any; subscription?: any } = {}) => ({
  active: overrides.active === undefined ? { postMessage: vi.fn() } : overrides.active,
  pushManager: {
    getSubscription: vi.fn().mockResolvedValue(overrides.subscription ?? null),
    subscribe: vi.fn().mockResolvedValue({ endpoint: 'https://push.example.com/sub-1' })
  },
  addEventListener: vi.fn()
})

const stubFullEnv = (swRegistration: any) => {
  vi.stubGlobal('navigator', {
    serviceWorker: {
      ready: Promise.resolve(swRegistration),
      addEventListener: vi.fn()
    }
  })
  const NotificationStub = function () {} as any
  NotificationStub.requestPermission = vi.fn().mockResolvedValue('granted')
  vi.stubGlobal('Notification', NotificationStub)
  return NotificationStub
}

describe('useNotification — full env', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    capturedRegisterSWOptions.value = null
    mockUseRuntimeConfig.mockReturnValue(defaultRuntimeConfig)
    mockCookiesGet.mockReturnValue(undefined)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('isSupported flags（C1-C2）', () => {
    it('C1: stubGlobal(navigator) 后 isSupportedSW=true', () => {
      stubFullEnv(makeSwRegistration())
      const { isSupportedSW } = useNotification()
      expect(isSupportedSW).toBe(true)
    })

    it('C2: stubGlobal(Notification) 后 isSupportedNotification=true', () => {
      stubFullEnv(makeSwRegistration())
      const { isSupportedNotification } = useNotification()
      expect(isSupportedNotification).toBe(true)
    })
  })

  describe('registerWorker 4 分支（C3-C6）', () => {
    it('C3: navigator 无 serviceWorker → 早退 null + console.warn', async () => {
      vi.stubGlobal('navigator', {})
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const { registerWorker } = useNotification()
      const result = await registerWorker()
      expect(result).toBeNull()
      expect(warnSpy).toHaveBeenCalledWith('[slax] NotificationWorker is not supported')
      warnSpy.mockRestore()
    })

    it('C4: registerSW 触发 onRegisteredSW → resolve null', async () => {
      stubFullEnv(makeSwRegistration())
      vi.spyOn(console, 'log').mockImplementation(() => {})
      const { registerWorker } = useNotification()
      const promise = registerWorker()
      // 触发 onRegisteredSW 回调
      capturedRegisterSWOptions.value!.onRegisteredSW('sw.js', { scope: '/' })
      await expect(promise).resolves.toBeNull()
      expect(mockRegisterSW).toHaveBeenCalled()
    })

    it('C5: registerSW 触发 onRegisterError → reject(error)', async () => {
      stubFullEnv(makeSwRegistration())
      vi.spyOn(console, 'error').mockImplementation(() => {})
      const error = new Error('register failed')
      const { registerWorker } = useNotification()
      const promise = registerWorker()
      capturedRegisterSWOptions.value!.onRegisterError(error)
      await expect(promise).rejects.toBe(error)
    })

    it('C6: registerSW 同步抛错 → catch reject(error)', async () => {
      stubFullEnv(makeSwRegistration())
      vi.spyOn(console, 'error').mockImplementation(() => {})
      const error = new Error('sync throw')
      mockRegisterSW.mockImplementationOnce(() => {
        throw error
      })
      const { registerWorker } = useNotification()
      await expect(registerWorker()).rejects.toBe(error)
    })
  })

  describe('requestPushPermission 5 分支（C8-C12，C7 在隔离 describe）', () => {
    it('C8: permission=denied → false，不读取订阅信息', async () => {
      const swReg = makeSwRegistration()
      const Notification = stubFullEnv(swReg)
      Notification.requestPermission.mockResolvedValueOnce('denied')
      const { requestPushPermission } = useNotification()
      const result = await requestPushPermission()
      expect(result).toBe(false)
      expect(swReg.pushManager.getSubscription).not.toHaveBeenCalled()
    })

    it('C9: granted + PUSH_API_PUBLIC_KEY=undefined → false + console.error', async () => {
      stubFullEnv(makeSwRegistration())
      mockUseRuntimeConfig.mockReturnValue({
        public: { PUSH_API_PUBLIC_KEY: '', DWEB_API_BASE_URL: 'http://localhost:8787' },
        app: { baseURL: '/' }
      })
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const { requestPushPermission } = useNotification()
      const result = await requestPushPermission()
      expect(result).toBe(false)
      expect(errSpy).toHaveBeenCalledWith('PUSH_API_PUBLIC_KEY is not set')
    })

    it('C10: granted + 已有 subscription → true + 不调 subscribe', async () => {
      const swReg = makeSwRegistration({ subscription: { endpoint: 'existing' } })
      stubFullEnv(swReg)
      const { requestPushPermission } = useNotification()
      const result = await requestPushPermission()
      expect(result).toBe(true)
      expect(swReg.pushManager.subscribe).not.toHaveBeenCalled()
    })

    it('C11: granted + 无 subscription → subscribe + request().post + true（含 microtask flush）', async () => {
      const swReg = makeSwRegistration({ subscription: null })
      stubFullEnv(swReg)
      const { requestPushPermission } = useNotification()
      const result = await requestPushPermission()
      expect(result).toBe(true)
      // subscribe().then(...) 不 await，flush microtask
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
      expect(swReg.pushManager.subscribe).toHaveBeenCalled()
      expect(mockPost).toHaveBeenCalled()
    })

    it('C12: throw → catch return false', async () => {
      const Notification = stubFullEnv(makeSwRegistration())
      Notification.requestPermission.mockRejectedValueOnce(new Error('boom'))
      vi.spyOn(console, 'error').mockImplementation(() => {})
      const { requestPushPermission } = useNotification()
      const result = await requestPushPermission()
      expect(result).toBe(false)
    })
  })

  describe('initWebsocket 3 分支（C13-C15）', () => {
    it('C13: token 不存在 → console.warn 早退，postMessage 不调', async () => {
      const swReg = makeSwRegistration()
      stubFullEnv(swReg)
      mockCookiesGet.mockReturnValue(undefined)
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const { initWebsocket } = useNotification()
      await initWebsocket()
      expect(warnSpy).toHaveBeenCalledWith('[slax] No token found for WebSocket connection')
      expect(swReg.active.postMessage).not.toHaveBeenCalled()
    })

    it('C14: token 存在 → 拼 wss URL → swRegistration.active.postMessage 被调', async () => {
      const swReg = makeSwRegistration()
      stubFullEnv(swReg)
      mockCookiesGet.mockReturnValue('test-token')
      vi.spyOn(console, 'log').mockImplementation(() => {})
      const { initWebsocket } = useNotification()
      await initWebsocket()
      expect(swReg.active.postMessage).toHaveBeenCalledWith({
        type: 'connect',
        data: {
          url: 'ws://localhost:8787/v1/user/messages?token=test-token'
        }
      })
    })

    it('C15: active=null → sendMessage throw → initWebsocket catch console.error', async () => {
      const swReg = makeSwRegistration({ active: null })
      stubFullEnv(swReg)
      mockCookiesGet.mockReturnValue('test-token')
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const { initWebsocket } = useNotification()
      await initWebsocket()
      expect(errSpy).toHaveBeenCalled()
    })
  })

  describe('sendMessage / onMessage（C16-C18）', () => {
    it('C16: registration.active=null → throw', async () => {
      const swReg = makeSwRegistration({ active: null })
      stubFullEnv(swReg)
      vi.spyOn(console, 'log').mockImplementation(() => {})
      const { sendMessage } = useNotification()
      await expect(sendMessage({ type: 'test' })).rejects.toThrow('No active service worker found')
    })

    it('C17: active 存在 → postMessage 调用', async () => {
      const swReg = makeSwRegistration()
      stubFullEnv(swReg)
      vi.spyOn(console, 'log').mockImplementation(() => {})
      const { sendMessage } = useNotification()
      await sendMessage({ type: 'ping' })
      expect(swReg.active.postMessage).toHaveBeenCalledWith({ type: 'ping' })
    })

    it('C18: onMessage(cb) → navigator.serviceWorker.addEventListener("message", cb)', () => {
      const swReg = makeSwRegistration()
      const swListener = vi.fn()
      vi.stubGlobal('navigator', {
        serviceWorker: {
          ready: Promise.resolve(swReg),
          addEventListener: swListener
        }
      })
      stubFullEnv(swReg)
      // 上一次 stubFullEnv 又覆盖了 addEventListener，重新 stub
      vi.stubGlobal('navigator', {
        serviceWorker: {
          ready: Promise.resolve(swReg),
          addEventListener: swListener
        }
      })
      const { onMessage } = useNotification()
      const cb = vi.fn()
      onMessage(cb)
      expect(swListener).toHaveBeenCalledWith('message', cb)
    })
  })
})

describe('useNotification — 隔离环境（C3 子分支 / C7）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseRuntimeConfig.mockReturnValue({
      public: { PUSH_API_PUBLIC_KEY: 'test-key', DWEB_API_BASE_URL: 'http://localhost:8787' },
      app: { baseURL: '/' }
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('C7: 不 stub Notification（happy-dom 默认无）→ requestPushPermission 早退 false', async () => {
    // 不 stubGlobal('Notification', ...)，让 happy-dom 默认 'Notification' in window === false
    vi.stubGlobal('navigator', {
      serviceWorker: {
        ready: Promise.resolve(makeSwRegistration()),
        addEventListener: vi.fn()
      }
    })
    const { requestPushPermission } = useNotification()
    const result = await requestPushPermission()
    expect(result).toBe(false)
  })
})
