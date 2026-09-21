// middleware/auth.global.ts 单测 —— 第四期 Sprint D.1
// 覆盖：isServer 短路 / anchor link 短路 / fromAuth 跳过 / toLogin 跳过（已登录情况） / whitelist 跳过 /
//      未登录 + 非白名单 → navigateTo /login + redirect query / 已登录 + toLogin → redirect param 优先 / 已登录 + toLogin 无 redirect → /bookmarks
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGet, mockNavigateTo, mockUseRuntimeConfig, mockIsServer } = vi.hoisted(() => ({
  mockGet: vi.fn(),
  mockNavigateTo: vi.fn((arg: unknown, opts?: unknown) => ({ navigated: true, arg, opts })),
  mockUseRuntimeConfig: vi.fn(() => ({ app: { baseURL: '/' }, public: { COOKIE_TOKEN_NAME: 'auth_token' } })),
  mockIsServer: { value: false }
}))

// 顶层 const { get } = useCookies() 在模块加载时就调用，必须 factory 直接返回稳定对象
vi.mock('@vueuse/integrations/useCookies', () => ({
  useCookies: () => ({
    get: mockGet,
    set: vi.fn(),
    remove: vi.fn(),
    getAll: vi.fn(() => ({})),
    addChangeListener: vi.fn(),
    removeChangeListener: vi.fn()
  })
}))

vi.mock('@commons/utils/is', () => ({
  get isServer() {
    return mockIsServer.value
  }
}))

mockNuxtImport('navigateTo', () => mockNavigateTo)
mockNuxtImport('useRuntimeConfig', () => mockUseRuntimeConfig)
mockNuxtImport('defineNuxtRouteMiddleware', () => (fn: unknown) => fn)

beforeEach(() => {
  mockGet.mockReset()
  mockGet.mockReturnValue(undefined)
  mockNavigateTo.mockClear()
  mockIsServer.value = false
  // happy-dom location.origin 默认 'http://localhost:3000'
  Object.defineProperty(window, 'location', {
    value: new URL('http://localhost:3000/'),
    writable: true,
    configurable: true
  })
})

afterEach(() => {
  vi.resetModules()
})

interface RouteLoc {
  path: string
  fullPath: string
  hash: string
  query: Record<string, string>
}

function makeRoute(partial: Partial<RouteLoc> = {}): RouteLoc {
  return {
    path: '/bookmarks',
    fullPath: '/bookmarks',
    hash: '',
    query: {},
    ...partial
  }
}

async function runMiddleware(to: RouteLoc, from: RouteLoc) {
  // 重新 import 让 mockIsServer 生效（isServer 在模块顶层即被读，但 getter 形式可动态返回）
  const mod = await import('~~/app/middleware/auth.global')
  return mod.default(to as never, from as never)
}

describe('middleware/auth.global', () => {
  it('isServer=true：短路返回 undefined', async () => {
    mockIsServer.value = true
    const result = await runMiddleware(makeRoute(), makeRoute({ fullPath: '/' }))
    expect(result).toBeUndefined()
    expect(mockNavigateTo).not.toHaveBeenCalled()
  })

  it('anchor link（同 path 不同 hash）：短路', async () => {
    const result = await runMiddleware(makeRoute({ path: '/x', fullPath: '/x#a', hash: '#a' }), makeRoute({ path: '/x', fullPath: '/x#b', hash: '#b' }))
    expect(result).toBeUndefined()
    expect(mockNavigateTo).not.toHaveBeenCalled()
  })

  it('未登录 + 目标非白名单且非首页 + 来自非首页：navigateTo /login?redirect=...', async () => {
    mockGet.mockReturnValue(undefined)
    await runMiddleware(makeRoute({ path: '/bookmarks', fullPath: '/bookmarks' }), makeRoute({ path: '/foo', fullPath: '/foo' }))
    expect(mockNavigateTo).toHaveBeenCalledTimes(1)
    const arg = mockNavigateTo.mock.calls[0]![0] as string
    expect(arg.startsWith('/login?')).toBe(true)
    expect(arg).toContain('redirect=')
  })

  it('未登录 + 目标在白名单（/privacy）：跳过 navigateTo', async () => {
    await runMiddleware(makeRoute({ path: '/privacy', fullPath: '/privacy' }), makeRoute({ fullPath: '/' }))
    expect(mockNavigateTo).not.toHaveBeenCalled()
  })

  it('未登录 + 目标 /login：跳过（避免循环）', async () => {
    await runMiddleware(makeRoute({ path: '/login', fullPath: '/login' }), makeRoute({ fullPath: '/foo' }))
    expect(mockNavigateTo).not.toHaveBeenCalled()
  })

  it('未登录 + 来自 /auth：跳过（OAuth 回调链）', async () => {
    await runMiddleware(makeRoute({ path: '/bookmarks', fullPath: '/bookmarks' }), makeRoute({ path: '/auth/cb', fullPath: '/auth/cb' }))
    expect(mockNavigateTo).not.toHaveBeenCalled()
  })

  it('未登录 + 目标首页：无豁免，仍 navigateTo /login', async () => {
    await runMiddleware(makeRoute({ path: '/', fullPath: '/' }), makeRoute({ fullPath: '/x' }))
    expect(mockNavigateTo).toHaveBeenCalledTimes(1)
    const arg = mockNavigateTo.mock.calls[0]![0] as string
    expect(arg.startsWith('/login?')).toBe(true)
  })

  it('未登录 + 带 from=homepage query：redirect 里保留该 query', async () => {
    await runMiddleware(makeRoute({ path: '/bookmarks', fullPath: '/bookmarks?from=homepage', query: { from: 'homepage' } }), makeRoute({ path: '/foo', fullPath: '/foo' }))
    const arg = mockNavigateTo.mock.calls[0]![0] as string
    expect(arg).toContain('from%3Dhomepage')
  })

  it('未登录 + 来自 /zh：仍附 redirect 参数（当前无首页/语言路径豁免）', async () => {
    await runMiddleware(makeRoute({ path: '/bookmarks', fullPath: '/bookmarks' }), makeRoute({ path: '/zh', fullPath: '/zh' }))
    const arg = mockNavigateTo.mock.calls[0]![0] as string
    expect(arg.startsWith('/login?')).toBe(true)
    expect(arg).toContain('redirect=')
  })

  it('已登录 + 目标 /login + 含 redirect 参数：navigateTo decoded redirect external=true', async () => {
    mockGet.mockReturnValue('TOKEN_VALUE')
    const redirectUrl = encodeURIComponent('https://example.com/target')
    await runMiddleware(makeRoute({ path: '/login', fullPath: `/login?redirect=${redirectUrl}`, query: { redirect: redirectUrl } }), makeRoute({ fullPath: '/' }))
    expect(mockNavigateTo).toHaveBeenCalledWith('https://example.com/target', { external: true })
  })

  it('已登录 + 目标 /auth + 无 redirect：navigateTo /bookmarks', async () => {
    mockGet.mockReturnValue('TOKEN_VALUE')
    await runMiddleware(makeRoute({ path: '/auth/cb', fullPath: '/auth/cb' }), makeRoute({ fullPath: '/' }))
    expect(mockNavigateTo).toHaveBeenCalledWith('/bookmarks')
  })

  it('已登录 + 目标普通页：不跳转', async () => {
    mockGet.mockReturnValue('TOKEN_VALUE')
    await runMiddleware(makeRoute({ path: '/bookmarks', fullPath: '/bookmarks' }), makeRoute({ fullPath: '/x' }))
    expect(mockNavigateTo).not.toHaveBeenCalled()
  })
})
