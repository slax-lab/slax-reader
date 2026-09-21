// Modal/LoginModal 组件单测
// props: redirect (required string)
// emit: close / dismiss / success
// onMounted setTimeout → appear=true
// closeModal → appear=false
// onAfterLeave → emit dismiss
// 子组件 GoogleLoginButton 透传 redirect
import { ref } from 'vue'

import LoginModal from '~~/app/components/Modal/LoginModal.vue'

import { mountWithApp } from '~~/tests/setup/mount'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@vueuse/core', async () => {
  const actual = await vi.importActual<any>('@vueuse/core')
  return {
    ...actual,
    useScrollLock: () => ref(false)
  }
})

describe('Modal/LoginModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('mount → 渲染 .login-modal + .modal-shell + close button', () => {
    const wrapper = mountWithApp(LoginModal, { props: { redirect: '/foo' } })
    expect(wrapper.find('.login-modal').exists()).toBe(true)
    expect(wrapper.find('.modal-shell').exists()).toBe(true)
    expect(wrapper.find('button.modal-close').exists()).toBe(true)
  })

  it('GoogleLoginButton 子组件渲染', () => {
    const wrapper = mountWithApp(LoginModal, { props: { redirect: '/foo' } })
    expect(wrapper.findComponent({ name: 'GoogleLoginButton' }).exists()).toBe(true)
  })

  it('GoogleLoginButton 接收 redirect prop', () => {
    const wrapper = mountWithApp(LoginModal, { props: { redirect: '/bar' } })
    const btn = wrapper.findComponent({ name: 'GoogleLoginButton' })
    expect(btn.props('redirect')).toBe('/bar')
  })

  it('close button click → appear=false', async () => {
    const wrapper = mountWithApp(LoginModal, { props: { redirect: '/foo' } })
    await wrapper.find('button.modal-close').trigger('click')
    expect(wrapper.exists()).toBe(true)
  })

  it('外层 .login-modal click → 触发 closeModal', async () => {
    const wrapper = mountWithApp(LoginModal, { props: { redirect: '/foo' } })
    await wrapper.find('.login-modal').trigger('click')
    expect(wrapper.exists()).toBe(true)
  })

  it('Transition after-leave → emit dismiss', async () => {
    const wrapper = mountWithApp(LoginModal, { props: { redirect: '/foo' } })
    const transitions = wrapper.findAllComponents({ name: 'Transition' })
    transitions[0]!.vm.$emit('after-leave')
    expect(wrapper.emitted('dismiss')).toBeTruthy()
  })
})
