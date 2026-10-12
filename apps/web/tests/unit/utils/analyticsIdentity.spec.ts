// @vitest-environment happy-dom
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  cookies: new Map<string, string>(),
  setCookie: vi.fn(),
  fetch: vi.fn(),
  afterEach: vi.fn(),
  error: { value: null as null | { statusCode: number } },
  locale: { value: 'en' },
  route: { value: { path: '/bookmarks', query: {} } }
}))

mockNuxtImport('useRuntimeConfig', () => () => ({
  app: { baseURL: '/' },
  public: { DWEB_API_BASE_URL: 'https://reader-api.test', COOKIE_TOKEN_NAME: 'test_token', appVersion: '2.0.11' }
}))
mockNuxtImport('useRouter', () => () => ({ currentRoute: state.route, afterEach: state.afterEach }))
mockNuxtImport('useError', () => () => state.error)
mockNuxtImport('tryUseNuxtApp', () => () => ({ $i18n: { locale: state.locale } }))
vi.mock('@vueuse/integrations/useCookies', () => ({
  useCookies: () => ({ get: (name: string) => state.cookies.get(name), set: state.setCookie })
}))
vi.mock('~/components/Toast', () => ({ default: { showToast: vi.fn() }, ToastType: { Error: 'error' } }))

let identity: typeof import('~/utils/request')
let analytics: typeof import('../../../app/utils/analytics')

beforeEach(async () => {
  vi.resetModules()
  state.cookies.clear()
  state.setCookie.mockReset().mockImplementation((name: string, value: string) => state.cookies.set(name, value))
  state.fetch.mockReset().mockImplementation(async () => new Response(JSON.stringify({ status: 200, data: { ok: true }, message: '' })))
  state.afterEach.mockReset()
  state.route.value = { path: '/bookmarks', query: {} }
  state.error.value = null
  state.locale.value = 'en'
  vi.stubGlobal('fetch', state.fetch)
  identity = await import('~/utils/request')
  analytics = await import('../../../app/utils/analytics')
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const sent = () => state.fetch.mock.calls.map(([url, init]) => ({ url, headers: new Headers(init.headers), body: JSON.parse(init.body) }))

describe('web event identity', () => {
  it('uses the active app language before html lang is written, including language changes', () => {
    document.documentElement.lang = ''
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('zh-CN')
    analytics.eventLog({ event_name: 'screen_viewed' })
    expect(sent()[0].headers.get('X-CLIENT-LOCALE')).toBe('en')
    expect(sent()[0].body.events[0].properties.locale).toBe('en')
    state.locale.value = 'zh'
    document.documentElement.lang = 'en'
    analytics.eventLog({ event_name: 'screen_viewed' })
    expect(sent()[1].headers.get('X-CLIENT-LOCALE')).toBe('zh')
  })
  it('首次访问、登录和业务请求沿用同一个设备，登录后立即携带凭证', async () => {
    analytics.eventLog({ event_name: 'screen_viewed', properties: { screen_name: 'signup' } })
    const deviceId = state.cookies.get('_su')
    expect(deviceId).toMatch(/^[a-f0-9]{32}\.\d+$/)
    expect(state.setCookie).toHaveBeenCalledWith('_su', deviceId, expect.objectContaining({ path: '/', maxAge: 31536000, sameSite: 'lax' }))

    await identity.request().post({ url: '/v1/user/login', body: { code: 'test-code' } })
    state.cookies.set('test_token', 'signed-in-token')
    analytics.eventLog({ event_name: 'screen_viewed', properties: { screen_name: 'bookmarks' } })
    await identity.request().post({ url: '/v1/bookmark/star', body: { id: 1 } })

    const requests = sent()
    expect(requests.map(r => r.url)).toEqual([
      'https://reader-api.test/events',
      'https://reader-api.test/v1/user/login',
      'https://reader-api.test/events',
      'https://reader-api.test/v1/bookmark/star'
    ])
    expect(requests.every(r => r.headers.get('X-Device-ID') === deviceId)).toBe(true)
    expect(requests.map(r => r.headers.get('Authorization'))).toEqual([null, null, 'Bearer signed-in-token', 'Bearer signed-in-token'])
  })

  it('普通请求先发生时也会建立设备身份，旧 cookie 保持不变', async () => {
    state.cookies.set('_su', 'existing-device.123')
    state.cookies.set('test_token', 'existing-token')
    await identity.request().post({ url: '/v1/user/login', body: {} })
    analytics.eventLog({ event_name: 'element_clicked', properties: { element_id: 'login_google_button', screen_name: 'signup' } })
    expect(sent().every(r => r.headers.get('X-Device-ID') === 'existing-device.123')).toBe(true)
    expect(state.setCookie).not.toHaveBeenCalled()
  })

  it('浏览器拒绝 cookie 写入时，同页请求仍有稳定设备 ID', async () => {
    state.setCookie.mockImplementation(() => {
      throw new Error('cookie storage blocked')
    })
    analytics.eventLog({ event_name: 'screen_viewed', properties: { screen_name: 'signup' } })
    await identity.request().post({ url: '/v1/user/login', body: {} })
    const requests = sent()
    expect(requests[0].headers.get('X-Device-ID')).toMatch(/^[a-f0-9]{32}\.\d+$/)
    expect(requests[1].headers.get('X-Device-ID')).toBe(requests[0].headers.get('X-Device-ID'))
  })
})

describe('screen tracking after authentication redirects', () => {
  it('does not count a 404 on first load or during asynchronous detail navigation', async () => {
    const plugin = (await import('../../../app/plugins/first-party-analytics.client')).default
    const hooks = new Map<string, () => void>()
    vi.spyOn(document, 'addEventListener').mockImplementation(() => {})
    await plugin({ hook: (name: string, callback: () => void) => hooks.set(name, callback) } as never)
    const navigate = state.afterEach.mock.calls[0][0]
    state.route.value = { path: '/b/missing', query: {} }
    state.error.value = { statusCode: 404 }
    hooks.get('app:mounted')!()
    hooks.get('page:finish')!()
    expect(state.fetch).not.toHaveBeenCalled()

    state.error.value = null
    state.route.value = { path: '/b/valid', query: {} }
    navigate(state.route.value, {}, undefined)
    expect(state.fetch).not.toHaveBeenCalled()
    hooks.get('page:finish')!()
    hooks.get('page:finish')!()
    expect(sent().map(r => r.body.events[0].properties.screen_name)).toEqual(['detail'])

    state.route.value = { path: '/b/another-missing', query: {} }
    navigate(state.route.value, {}, undefined)
    state.error.value = { statusCode: 404 }
    hooks.get('app:error')!()
    hooks.get('page:finish')!()
    expect(state.fetch).toHaveBeenCalledTimes(1)
  })
  it('registered row clicks and middle-clicks include both element and actual screen', async () => {
    const plugin = (await import('../../../app/plugins/first-party-analytics.client')).default
    const hooks = new Map<string, () => void>()
    const listeners = vi.spyOn(document, 'addEventListener')
    await plugin({ hook: (name: string, callback: () => void) => hooks.set(name, callback) } as never)
    hooks.get('app:mounted')!()
    document.body.innerHTML = '<a data-analytics-element="bookmark_list_row"><span>Article</span></a>'
    const target = document.querySelector('span')!
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }))
    target.dispatchEvent(new MouseEvent('auxclick', { bubbles: true, button: 1 }))
    const clicks = sent().filter(r => r.body.events[0].event_name === 'element_clicked')
    expect(clicks).toHaveLength(2)
    expect(clicks.every(r => r.body.events[0].properties.element_id === 'bookmark_list_row' && r.body.events[0].properties.screen_name === 'bookmarks')).toBe(true)
    for (const [name, listener, options] of listeners.mock.calls) {
      if (name === 'click' || name === 'auxclick') document.removeEventListener(name, listener, options)
    }
  })

  it('鉴权完成并挂载后才上报首屏，失败导航不记录访问', async () => {
    const plugin = (await import('../../../app/plugins/first-party-analytics.client')).default
    const hooks = new Map<string, () => void>()
    vi.spyOn(document, 'addEventListener').mockImplementation(() => {})
    await plugin({ hook: (name: string, callback: () => void) => hooks.set(name, callback) } as never)
    const navigate = state.afterEach.mock.calls[0][0]

    navigate({ path: '/bookmarks', query: {} }, {}, undefined)
    expect(state.fetch).not.toHaveBeenCalled()
    state.route.value = { path: '/login', query: {} }
    hooks.get('app:mounted')!()
    expect(sent().map(r => r.body.events[0].properties.screen_name)).toEqual(['signup'])

    navigate({ path: '/bookmarks', query: {} }, {}, new Error('navigation aborted'))
    expect(state.fetch).toHaveBeenCalledTimes(1)
    state.cookies.set('test_token', 'signed-in-token')
    navigate({ path: '/bookmarks', query: {} }, {}, undefined)
    expect(sent()[1].body.events[0].properties).toMatchObject({ screen_name: 'bookmarks', list_mode: 'inbox' })
    expect(sent()[1].headers.get('Authorization')).toBe('Bearer signed-in-token')
  })
})
