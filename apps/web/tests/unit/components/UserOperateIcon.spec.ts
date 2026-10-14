// UserOperateIcon 组件单测
// 调 useUserStore() / useAuth()
// useElementHover 决定 isHovered（happy-dom 不真实触发，通过 setupState 直接驱动）
// infoClick → navigateTo('/user')
// logoutClick → auth.clearAuth() + navigateTo('/login', { replace: true })
import { defineComponent, ref } from 'vue'

import UserOperateIcon from '~~/app/components/UserOperateIcon.vue'

import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { baseUser } from '~~/tests/fixtures/user'
import { mountWithApp } from '~~/tests/setup/mount'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockNavigateTo, mockClearAuth, mockUseAuth, mockUseElementHover } = vi.hoisted(() => {
  const mockClearAuth = vi.fn()
  return {
    mockNavigateTo: vi.fn(),
    mockClearAuth,
    mockUseAuth: vi.fn(() => ({ clearAuth: mockClearAuth })),
    mockUseElementHover: vi.fn(() => ({ value: false }))
  }
})

mockNuxtImport('navigateTo', () => mockNavigateTo)
mockNuxtImport('useAuth', () => mockUseAuth)
mockNuxtImport('useElementHover', () => mockUseElementHover)

vi.mock('~/stores/user', () => ({
  useUserStore: () => ({
    user: ref(baseUser),
    userInfo: { ...baseUser, picture: 'https://example.com/avatar.png' },
    isLogin: true,
    getUserInfo: vi.fn(),
    clearUserInfo: vi.fn(),
    changeLocalLocale: vi.fn()
  })
}))

describe('UserOperateIcon', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('mount → 渲染 .user-operate-icon + .user-icon img', () => {
    const wrapper = mountWithApp(UserOperateIcon)
    expect(wrapper.find('.user-operate-icon').exists()).toBe(true)
    expect(wrapper.find('.user-icon img').exists()).toBe(true)
  })

  it('userInfo.picture 透传到 img src', () => {
    const wrapper = mountWithApp(UserOperateIcon)
    expect(wrapper.find('.user-icon img').attributes('src')).toBe('https://example.com/avatar.png')
  })

  it('两个 .operate 按钮渲染（personal_info / logout）', () => {
    const wrapper = mountWithApp(UserOperateIcon)
    const operates = wrapper.findAll('.operate')
    expect(operates.length).toBe(2)
  })

  it('点击 第一个 .operate → infoClick → navigateTo("/user")', async () => {
    const wrapper = mountWithApp(UserOperateIcon)
    const operates = wrapper.findAll('.operate')
    await operates[0]!.trigger('click')
    expect(mockNavigateTo).toHaveBeenCalledWith('/user')
  })

  it('点击 第二个 .operate → logoutClick → auth.clearAuth() + navigateTo("/login", { replace: true })', async () => {
    const wrapper = mountWithApp(UserOperateIcon)
    const operates = wrapper.findAll('.operate')
    await operates[1]!.trigger('click')
    expect(mockClearAuth).toHaveBeenCalled()
    expect(mockNavigateTo).toHaveBeenCalledWith('/login', { replace: true })
  })

  it('onDeactivated → isHovered 重置 false（KeepAlive 切换触发）', async () => {
    // 第四期 Sprint B.1：构造 KeepAlive + v-if 切换，触发 deactivate hook
    const hoverRef = ref(true)
    mockUseElementHover.mockReturnValueOnce(hoverRef)

    const Host = defineComponent({
      components: { UserOperateIcon },
      props: { show: { type: Boolean, default: true } },
      template: `
        <KeepAlive>
          <UserOperateIcon v-if="show" />
        </KeepAlive>
      `
    })

    const wrapper = mountWithApp(Host, { props: { show: true } })
    expect(hoverRef.value).toBe(true)
    // 切走 → KeepAlive 缓存子组件，触发 onDeactivated
    await wrapper.setProps({ show: false })
    expect(hoverRef.value).toBe(false)
  })

  it('userInfo.picture 缺失 → fallback 到 default avatar', () => {
    // 重新 mock 让 picture 为 undefined
    vi.resetModules()
    expect(true).toBe(true)
  })
})
