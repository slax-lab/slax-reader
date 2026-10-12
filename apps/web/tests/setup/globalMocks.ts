// 全测试一律 mock 的边界 —— 这些模块没有任何业务测试需要它们的真实行为
import { vi } from 'vitest'

vi.mock('firebase/app', () => ({
  initializeApp: vi.fn(),
  getApps: () => []
}))

vi.mock('firebase/messaging', () => ({
  getMessaging: vi.fn(),
  onMessage: vi.fn(),
  getToken: vi.fn(),
  isSupported: vi.fn()
}))

vi.mock('workbox-precaching', () => ({ precacheAndRoute: vi.fn() }))
vi.mock('workbox-routing', () => ({ registerRoute: vi.fn() }))
// StaleWhileRevalidate 仅 service-worker/sw_prod.ts 使用，sw 测试第三期才启用
// 提前挂位避免 workbox-strategies 被间接 import 时报 "X is not a constructor"
vi.mock('workbox-strategies', () => ({
  NetworkFirst: vi.fn(),
  CacheFirst: vi.fn(),
  StaleWhileRevalidate: vi.fn()
}))
vi.mock('workbox-cacheable-response', () => ({ CacheableResponsePlugin: vi.fn() }))
vi.mock('workbox-expiration', () => ({ ExpirationPlugin: vi.fn() }))

// @vueuse/integrations/useCookies 内部依赖 universal-cookie，构造时 addChangeListener
// 触发 setInterval(_, 300) 轮询 document.cookie。在 happy-dom 环境下，测试结束后
// document 被清理但 setInterval 持续运行，导致 "ReferenceError: document is not defined"
// unhandled exception。
// 单测里没人需要真实 cookie 行为：useAuth.spec.ts / request.spec.ts 都在自己文件内
// 用 vi.mock 覆盖，但 stores/user.ts / utils/request.ts / middleware/auth.global.ts /
// composables/useAuth.ts 都模块顶层 import → 任何间接 import 这些模块的 spec
// 都会触发轮询。
// 这里给个不带 setInterval 的纯 stub，单测里仍可通过本地 vi.mock 覆盖。
vi.mock('@vueuse/integrations/useCookies', () => ({
  useCookies: () => ({
    get: vi.fn(),
    set: vi.fn(),
    remove: vi.fn(),
    getAll: vi.fn(() => ({})),
    addChangeListener: vi.fn(),
    removeChangeListener: vi.fn()
  })
}))
