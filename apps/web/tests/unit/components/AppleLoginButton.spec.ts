// AppleLoginButton 组件单测
// props: redirect / affcode
// 调用 useAuth().requestAppleAuth + analyticsLog method=apple
// 与 GoogleLoginButton 同构（auth.requestAppleAuth 替代 requestAuth）
import AppleLoginButton from '~~/app/components/AppleLoginButton.vue'

import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { mountWithApp } from '~~/tests/setup/mount'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockAnalyticsLog, mockRequestAppleAuth, mockUseAuth } = vi.hoisted(() => {
  const mockRequestAppleAuth = vi.fn(() => Promise.resolve())
  return {
    mockAnalyticsLog: vi.fn(),
    mockRequestAppleAuth,
    mockUseAuth: vi.fn(() => ({ requestAppleAuth: mockRequestAppleAuth }))
  }
})

mockNuxtImport('analyticsLog', () => mockAnalyticsLog)
mockNuxtImport('useAuth', () => mockUseAuth)

describe('AppleLoginButton', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('mount → 渲染 .apple-login-button + i18n 文案', () => {
    const wrapper = mountWithApp(AppleLoginButton)
    expect(wrapper.find('button.apple-login-button').exists()).toBe(true)
    expect(wrapper.find('span').text().length).toBeGreaterThan(0)
  })

  it('button click → analyticsLog method=apple + auth.requestAppleAuth', async () => {
    const wrapper = mountWithApp(AppleLoginButton, { props: { redirect: '/foo' } })
    await wrapper.find('button').trigger('click')
    await flushPromises()
    expect(mockAnalyticsLog).toHaveBeenCalledWith({
      event: 'user_login_start',
      method: 'apple'
    })
    expect(mockRequestAppleAuth).toHaveBeenCalledWith({
      redirect: '/foo',
      affCode: ''
    })
  })

  it('props.affcode 透传到 requestAppleAuth', async () => {
    const wrapper = mountWithApp(AppleLoginButton, { props: { redirect: '/foo', affcode: 'abc' } })
    await wrapper.find('button').trigger('click')
    await flushPromises()
    expect(mockRequestAppleAuth).toHaveBeenCalledWith({
      redirect: '/foo',
      affCode: 'abc'
    })
  })

  it('暴露 login(params) → 直接调 requestAppleAuth', async () => {
    const wrapper = mountWithApp(AppleLoginButton, { props: { redirect: '/default' } })
    await (wrapper.vm as any).login({ redirect: '/override', affcode: 'xyz' })
    expect(mockRequestAppleAuth).toHaveBeenCalledWith({
      redirect: '/override',
      affCode: 'xyz'
    })
  })

  it('暴露 login() 不带参数 → 走 props 默认', async () => {
    const wrapper = mountWithApp(AppleLoginButton, { props: { redirect: '/default', affcode: 'def' } })
    await (wrapper.vm as any).login()
    expect(mockRequestAppleAuth).toHaveBeenCalledWith({
      redirect: '/default',
      affCode: 'def'
    })
  })
})
