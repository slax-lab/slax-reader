// GoogleLoginButton 组件单测
// props: redirect / affcode
// 调用 useAuth().requestAuth + analyticsLog
// loginClick → analyticsLog + login (内部) → auth.requestAuth
// expose: login(params)
import GoogleLoginButton from '~~/app/components/GoogleLoginButton.vue'

import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { mountWithApp } from '~~/tests/setup/mount'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockAnalyticsLog, mockRequestAuth, mockUseAuth } = vi.hoisted(() => {
  const mockRequestAuth = vi.fn(() => Promise.resolve())
  return {
    mockAnalyticsLog: vi.fn(),
    mockRequestAuth,
    mockUseAuth: vi.fn(() => ({ requestAuth: mockRequestAuth }))
  }
})

mockNuxtImport('analyticsLog', () => mockAnalyticsLog)
mockNuxtImport('useAuth', () => mockUseAuth)

describe('GoogleLoginButton', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('mount → 渲染 .google-login-button + i18n 文案', () => {
    const wrapper = mountWithApp(GoogleLoginButton)
    expect(wrapper.find('button.google-login-button').exists()).toBe(true)
    expect(wrapper.find('span').text().length).toBeGreaterThan(0)
  })

  it('button click → analyticsLog + auth.requestAuth', async () => {
    const wrapper = mountWithApp(GoogleLoginButton, { props: { redirect: '/foo' } })
    await wrapper.find('button').trigger('click')
    await flushPromises()
    expect(mockAnalyticsLog).toHaveBeenCalledWith({
      event: 'user_login_start',
      method: 'google'
    })
    expect(mockRequestAuth).toHaveBeenCalledWith({
      redirect: '/foo',
      affCode: ''
    })
  })

  it('props.affcode 透传到 requestAuth', async () => {
    const wrapper = mountWithApp(GoogleLoginButton, { props: { redirect: '/foo', affcode: 'abc' } })
    await wrapper.find('button').trigger('click')
    await flushPromises()
    expect(mockRequestAuth).toHaveBeenCalledWith({
      redirect: '/foo',
      affCode: 'abc'
    })
  })

  it('暴露 login(params) → 直接调 requestAuth', async () => {
    const wrapper = mountWithApp(GoogleLoginButton, { props: { redirect: '/default' } })
    await (wrapper.vm as any).login({ redirect: '/override', affcode: 'xyz' })
    expect(mockRequestAuth).toHaveBeenCalledWith({
      redirect: '/override',
      affCode: 'xyz'
    })
  })

  it('暴露 login() 不带参数 → 走 props 默认（redirect/affcode）', async () => {
    const wrapper = mountWithApp(GoogleLoginButton, { props: { redirect: '/default', affcode: 'def' } })
    await (wrapper.vm as any).login()
    expect(mockRequestAuth).toHaveBeenCalledWith({
      redirect: '/default',
      affCode: 'def'
    })
  })
})
