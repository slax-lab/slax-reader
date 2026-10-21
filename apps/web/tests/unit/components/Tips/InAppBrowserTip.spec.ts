import { nextTick, reactive } from 'vue'

import InAppBrowserTip from '~~/app/components/Tips/InAppBrowserTip.vue'

import { IN_APP_BROWSER_TIP_COOLDOWN_MS, IN_APP_BROWSER_TIP_STATE_KEY } from '~~/app/utils/inAppBrowserTipState'

import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { mount, type VueWrapper } from '@vue/test-utils'
import { getI18nLang } from '~~/i18n/config'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createI18n } from 'vue-i18n'

const context = vi.hoisted(() => ({ route: { path: '/' } }))
mockNuxtImport('useRoute', () => () => context.route)

const wechat = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 MicroMessenger/8.0.50'
const safari = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1'
const wrappers: VueWrapper[] = []

async function mountTip(locale: 'en' | 'zh' = 'en') {
  const wrapper = mount(InAppBrowserTip, {
    attachTo: document.body,
    global: { plugins: [createI18n({ legacy: false, locale, messages: getI18nLang() })] }
  })
  wrappers.push(wrapper)
  await nextTick()
  return wrapper
}

function dispatchPointer(target: Element, type: string, init: Partial<PointerEventInit> = {}) {
  target.dispatchEvent(new PointerEvent(type, {
    bubbles: true, cancelable: true, pointerId: 1, isPrimary: true, button: 0,
    clientX: 120, clientY: 100, ...init
  }))
}

beforeEach(() => {
  context.route = reactive({ path: '/' })
  localStorage.clear()
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(wechat)
})

afterEach(() => {
  wrappers.splice(0).forEach(wrapper => wrapper.unmount())
  vi.useRealTimers()
  vi.restoreAllMocks()
  Reflect.deleteProperty(navigator, 'standalone')
})

describe('InAppBrowserTip', () => {
  it.each(['/', '/bookmarks', '/b/article', '/s/share', '/c/collection', '/login', '/user', '/dashboard', '/onboarding'])('shows guidance on %s', async path => {
    context.route.path = path
    const wrapper = await mountTip()
    expect(wrapper.find('[role="status"]').text()).toContain('Open in browser')
    expect(wrapper.find('.tip-icon').exists()).toBe(true)
  })

  it('does not warn an external browser even when arriving from a social app', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(safari)
    vi.spyOn(document, 'referrer', 'get').mockReturnValue('https://www.instagram.com/')
    const wrapper = await mountTip()
    expect(wrapper.find('button').exists()).toBe(false)
    expect(wrapper.text()).toBe('')
  })

  it.each(['/privacy', '/terms', '/how-do-i-delete-my-account', '/delete-account-notice', '/privacy/', '/TERMS', '/auth', '/auth/', '/auth/callback', '/x/ext-bridge', '/x/ext-bridge/callback', '/rss', '/rss/redirect', '/bookmarks/123', '/c/collection/123', '/alice-reader'])('excludes document and technical routes: %s', async path => {
    context.route.path = path
    expect((await mountTip()).find('button').exists()).toBe(false)
  })

  it('updates visibility on client navigation without dismissing the guidance', async () => {
    const wrapper = await mountTip()
    context.route.path = '/terms'
    await nextTick()
    expect(wrapper.find('button').exists()).toBe(false)
    context.route.path = '/b/article'
    await nextTick()
    expect(wrapper.find('button').exists()).toBe(true)
  })

  it.each(['en', 'zh'] as const)('has localized polite guidance and a named close control in %s without taking focus', async locale => {
    const focused = document.createElement('button')
    document.body.append(focused)
    focused.focus()
    const wrapper = await mountTip(locale)
    const copy = locale === 'en'
      ? { title: 'Open this page in your browser', message: 'For the best experience, tap … in the top-right corner and choose Open in browser.', close: 'Dismiss external browser tip' }
      : { title: '建议在浏览器中打开', message: '为获得更好的使用体验，请点击右上角的 …，选择“在浏览器中打开”。', close: '关闭外部浏览器提示' }
    expect(wrapper.find('[role="status"]').attributes('aria-live')).toBe('polite')
    expect(wrapper.text()).toContain(copy.title)
    expect(wrapper.text()).toContain(copy.message)
    expect(wrapper.get('button').attributes('aria-label')).toBe(copy.close)
    expect(document.activeElement).toBe(focused)
    expect(wrapper.findAll('svg').every(icon => icon.attributes('aria-hidden') === 'true')).toBe(true)
  })

  it('records the first manual close and shows again on the next eligible visit', async () => {
    vi.useFakeTimers()
    const wrapper = await mountTip()
    await wrapper.get('button').trigger('click')
    vi.advanceTimersByTime(250)
    expect(JSON.parse(localStorage.getItem(IN_APP_BROWSER_TIP_STATE_KEY)!)).toEqual({ manualCloseCount: 1, cooldownUntil: 0 })
    context.route.path = '/b/article'
    await nextTick()
    expect(wrapper.find('button').exists()).toBe(true)
  })

  it('starts a one-hour cooldown after two manual closes', async () => {
    vi.useFakeTimers()
    const wrapper = await mountTip()
    await wrapper.get('button').trigger('click')
    vi.advanceTimersByTime(250)
    context.route.path = '/b/article'
    await nextTick()
    const secondCloseAt = Date.now()
    await wrapper.get('button').trigger('click')
    vi.advanceTimersByTime(250)
    const state = JSON.parse(localStorage.getItem(IN_APP_BROWSER_TIP_STATE_KEY)!)
    expect(state.manualCloseCount).toBe(2)
    expect(state.cooldownUntil).toBe(secondCloseAt + IN_APP_BROWSER_TIP_COOLDOWN_MS)
    context.route.path = '/c/article'
    await nextTick()
    expect(wrapper.find('button').exists()).toBe(false)
  })

  it('resets the count and shows after the cooldown expires', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-21T00:00:00Z'))
    localStorage.setItem(IN_APP_BROWSER_TIP_STATE_KEY, JSON.stringify({ manualCloseCount: 2, cooldownUntil: Date.now() + IN_APP_BROWSER_TIP_COOLDOWN_MS }))
    const wrapper = await mountTip()
    expect(wrapper.find('button').exists()).toBe(false)
    vi.setSystemTime(new Date('2026-10-21T01:00:01Z'))
    context.route.path = '/b/article'
    await nextTick()
    expect(wrapper.find('button').exists()).toBe(true)
    expect(JSON.parse(localStorage.getItem(IN_APP_BROWSER_TIP_STATE_KEY)!)).toEqual({ manualCloseCount: 0, cooldownUntil: 0 })
  })

  it('closes when dragged upward past the threshold and counts it as manual close', async () => {
    vi.useFakeTimers()
    const wrapper = await mountTip()
    const card = wrapper.get('[role="status"]').element
    vi.spyOn(card, 'getBoundingClientRect').mockReturnValue({ height: 100 } as DOMRect)
    dispatchPointer(card, 'pointerdown')
    dispatchPointer(card, 'pointermove', { clientY: 40 })
    dispatchPointer(card, 'pointerup', { clientY: 40 })
    vi.advanceTimersByTime(250)
    await nextTick()
    expect(wrapper.find('button').exists()).toBe(false)
    expect(JSON.parse(localStorage.getItem(IN_APP_BROWSER_TIP_STATE_KEY)!)).toMatchObject({ manualCloseCount: 1 })
  })

  it('rebounds on a short or downward drag without recording a close', async () => {
    const wrapper = await mountTip()
    const card = wrapper.get('[role="status"]').element
    dispatchPointer(card, 'pointerdown')
    dispatchPointer(card, 'pointermove', { clientY: 120 })
    dispatchPointer(card, 'pointerup', { clientY: 120 })
    await nextTick()
    expect(wrapper.find('button').exists()).toBe(true)
    expect(localStorage.getItem(IN_APP_BROWSER_TIP_STATE_KEY)).toBeNull()
  })

  it('does not start a drag from the close button', async () => {
    const wrapper = await mountTip()
    const button = wrapper.get('button').element
    dispatchPointer(button, 'pointerdown')
    dispatchPointer(button, 'pointermove', { clientY: 20 })
    dispatchPointer(button, 'pointerup', { clientY: 20 })
    expect(wrapper.find('button').exists()).toBe(true)
  })

  it('excludes Slax Reader even when its UA includes the Android WebView marker', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (Linux; Android 14; wv) SlaxReader')
    expect((await mountTip()).find('button').exists()).toBe(false)
  })

  it('excludes standalone display mode', async () => {
    const media = window.matchMedia('(display-mode: standalone)')
    vi.spyOn(media, 'matches', 'get').mockReturnValue(true)
    vi.spyOn(window, 'matchMedia').mockReturnValue(media)
    expect((await mountTip()).find('button').exists()).toBe(false)
  })

  it('excludes iOS standalone mode', async () => {
    Object.defineProperty(navigator, 'standalone', { configurable: true, value: true })
    expect((await mountTip()).find('button').exists()).toBe(false)
  })
})
