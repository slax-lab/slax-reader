import { nextTick, reactive } from 'vue'

import UpdateNotice from '~~/app/components/Tips/UpdateNotice.vue'

import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { mount, type VueWrapper } from '@vue/test-utils'
import { useUpdateNotice } from '~~/app/composables/useUpdateNotice'
import { getI18nLang } from '~~/i18n/config'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createI18n } from 'vue-i18n'

const context = vi.hoisted(() => ({ route: { fullPath: '/bookmarks?tab=all' }, reload: vi.fn() }))
mockNuxtImport('useRoute', () => () => context.route)
mockNuxtImport('reloadNuxtApp', () => context.reload)

const wrappers: VueWrapper[] = []
async function mountNotice(locale: 'en' | 'zh' = 'en') {
  const wrapper = mount(UpdateNotice, {
    attachTo: document.body,
    global: { plugins: [createI18n({ legacy: false, locale, messages: getI18nLang() })], stubs: { transition: false } }
  })
  wrappers.push(wrapper)
  await nextTick()
  return wrapper
}

beforeEach(() => {
  context.route = reactive({ fullPath: '/bookmarks?tab=all' })
  context.reload.mockReset()
  useUpdateNotice().state.value = { kind: null, buildId: null, dismissedKey: null }
})
afterEach(() => {
  wrappers.splice(0).forEach(wrapper => wrapper.unmount())
  document.body.innerHTML = ''
})

describe('UpdateNotice', () => {
  it('renders nothing until an update is reported', async () => {
    const wrapper = await mountNotice()
    expect(wrapper.find('.update-notice').exists()).toBe(false)
  })

  it('announces a new version without moving focus and refreshes the current URL', async () => {
    const wrapper = await mountNotice()
    const focused = document.activeElement
    useUpdateNotice().report('available', 'build-b')
    await nextTick()
    const notice = wrapper.find('.update-notice')
    expect(notice.attributes()).toMatchObject({ role: 'status', 'aria-live': 'polite' })
    expect(notice.text()).toContain('A new version is available')
    expect(document.activeElement).toBe(focused)
    await wrapper.find('.refresh-button').trigger('click')
    expect(context.reload).toHaveBeenCalledWith({ path: '/bookmarks?tab=all', persistState: false, force: true })
  })

  it('uses the outdated wording after a broken load, in Chinese too', async () => {
    useUpdateNotice().report('outdated')
    const wrapper = await mountNotice('zh')
    expect(wrapper.find('.update-notice').classes()).toContain('is-outdated')
    expect(wrapper.find('.title').text()).toBe('当前页面版本已过期')
    expect(wrapper.find('.refresh-button').text()).toBe('刷新')
  })

  it('closes for this build, reappears for a newer build and for a broken load', async () => {
    const wrapper = await mountNotice()
    useUpdateNotice().report('available', 'build-b')
    await nextTick()
    const close = wrapper.find('.close-button')
    expect(close.attributes('aria-label')).toBe('Dismiss update notice')
    await close.trigger('click')
    expect(wrapper.find('.update-notice').exists()).toBe(false)
    useUpdateNotice().report('available', 'build-b')
    await nextTick()
    expect(wrapper.find('.update-notice').exists()).toBe(false)
    useUpdateNotice().report('available', 'build-c')
    await nextTick()
    expect(wrapper.find('.update-notice').exists()).toBe(true)
    await wrapper.find('.close-button').trigger('click')
    useUpdateNotice().report('outdated')
    await nextTick()
    expect(wrapper.find('.title').text()).toBe('This page is out of date')
  })

  it('sits below an in-app-browser tip in the same layout and returns when it closes', async () => {
    const wrapper = await mountNotice()
    const container = wrapper.element.parentElement!
    const tip = document.createElement('aside')
    tip.className = 'in-app-browser-tip'
    vi.spyOn(tip, 'getBoundingClientRect').mockReturnValue({ height: 90, bottom: 100 } as DOMRect)
    container.appendChild(tip)
    useUpdateNotice().report('available', 'build-b')
    await vi.waitFor(() => expect(wrapper.find('.update-notice').attributes('style') ?? '').toContain('top: 108px'))
    tip.remove()
    await vi.waitFor(() => expect(wrapper.find('.update-notice').attributes('style') ?? '').not.toContain('top:'))
  })
})
