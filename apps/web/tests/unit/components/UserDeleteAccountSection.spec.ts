// UserDeleteAccountSection 组件单测
// 业务路径：
//   info 块：description 文案 + delete-button → openNoticeModal → 一级 notice modal
//   notice modal：渲染 ContentRenderer（依赖 queryCollection 异步加载 zh/en 两份内容）
//                 cancel 关闭、confirm → openSecondConfirm 弹二级
//   二级 confirm modal：cancel 关闭、final confirm → performDelete
//   performDelete：request().post(DELETE_MY_ACCOUNT) → Toast.success → auth.clearAuth → navigateTo('/', { replace })
//                 失败：isDeleting 复位，不跳转
import UserDeleteAccountSection from '~~/app/components/UserDeleteAccountSection.vue'

import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { mountWithApp } from '~~/tests/setup/mount'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockNavigateTo, mockClearAuth, mockUseAuth, mockPost, mockRequest, mockToastShowToast, mockQueryCollection, mockScrollLock } = vi.hoisted(() => {
  const post = vi.fn(() => Promise.resolve({}))
  const clearAuth = vi.fn(() => Promise.resolve())
  // useScrollLock 返回的 ref-like：测试里直接用普通对象代替（happy-dom 下 vue ref 不能在 hoisted 里实例化）
  const scrollLockRef = { value: false }
  return {
    mockNavigateTo: vi.fn(() => Promise.resolve()),
    mockClearAuth: clearAuth,
    mockUseAuth: vi.fn(() => ({ clearAuth })),
    mockPost: post,
    mockRequest: vi.fn(() => ({ post })),
    mockToastShowToast: vi.fn(),
    mockQueryCollection: vi.fn(() => ({
      path: () => ({ first: () => Promise.resolve({ body: { type: 'root', children: [] } }) })
    })),
    mockScrollLock: scrollLockRef
  }
})

mockNuxtImport('navigateTo', () => mockNavigateTo)
mockNuxtImport('useAuth', () => mockUseAuth)
mockNuxtImport('request', () => mockRequest)
mockNuxtImport('queryCollection', () => mockQueryCollection)
mockNuxtImport('useScrollLock', () => () => mockScrollLock)

vi.mock('~/stores/user', () => ({
  useUserStore: () => ({
    currentLocale: 'zh'
  })
}))

vi.mock('~/components/Toast', () => ({
  default: { showToast: mockToastShowToast },
  ToastType: { Success: 'success', Error: 'error', Normal: 'normal' }
}))

const baseStubs = {
  ContentRenderer: {
    name: 'ContentRenderer',
    template: '<div class="content-renderer-stub" />',
    props: ['value']
  },
  Transition: { template: '<slot />' }
}

const mountSection = () => mountWithApp(UserDeleteAccountSection, { global: { stubs: baseStubs } })

describe('UserDeleteAccountSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockScrollLock.value = false
    mockPost.mockResolvedValue({})
    mockQueryCollection.mockReturnValue({
      path: () => ({ first: () => Promise.resolve({ body: { type: 'root', children: [] } }) })
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('mount → 渲染 section + description + delete-button', () => {
    const wrapper = mountSection()
    expect(wrapper.find('section.user-delete-account-section').exists()).toBe(true)
    expect(wrapper.find('.description').exists()).toBe(true)
    expect(wrapper.find('button.delete-button').exists()).toBe(true)
  })

  it('初始状态 → 不渲染 notice / second modal', () => {
    const wrapper = mountSection()
    expect(wrapper.find('.notice-modal').exists()).toBe(false)
    expect(wrapper.find('.second-modal').exists()).toBe(false)
  })

  it('点击 delete-button → openNoticeModal：渲染 notice + isLocked=true + 调 queryCollection（zh + en）', async () => {
    const wrapper = mountSection()
    await wrapper.find('button.delete-button').trigger('click')
    await flushPromises()

    expect(wrapper.find('.notice-modal').exists()).toBe(true)
    expect(mockScrollLock.value).toBe(true)
    expect(mockQueryCollection).toHaveBeenCalledWith('open_docs_zh')
    expect(mockQueryCollection).toHaveBeenCalledWith('open_docs_en')
  })

  it('queryCollection 抛错 → 进 catch（noticeLoaded 仍置 true，不爆炸）', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockQueryCollection.mockReturnValueOnce({
      path: () => ({ first: () => Promise.reject(new Error('boom')) })
    })
    const wrapper = mountSection()
    await wrapper.find('button.delete-button').trigger('click')
    await flushPromises()

    // 二次点击不会重复 query（noticeLoaded 已 true）
    mockQueryCollection.mockClear()
    const setup: any = (wrapper.vm as any).$.setupState
    await setup.ensureNoticeContent()
    expect(mockQueryCollection).not.toHaveBeenCalled()
    expect(errorSpy).toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  it('notice modal cancel 按钮 click → 触发 closeNoticeModal（noticeAppear=false）', async () => {
    const wrapper = mountSection()
    await wrapper.find('button.delete-button').trigger('click')
    await flushPromises()

    await wrapper.find('.notice-modal .btn-cancel').trigger('click')
    const setup: any = (wrapper.vm as any).$.setupState
    expect(setup.noticeAppear).toBe(false)
  })

  it('notice confirm → openSecondConfirm：second-modal 渲染', async () => {
    const wrapper = mountSection()
    await wrapper.find('button.delete-button').trigger('click')
    await flushPromises()

    await wrapper.find('.notice-modal .btn-confirm').trigger('click')
    await flushPromises()
    expect(wrapper.find('.second-modal').exists()).toBe(true)
  })

  it('isDeleting=true 时 closeNoticeModal / closeSecondConfirm / openSecondConfirm 全部早退', async () => {
    const wrapper = mountSection()
    await wrapper.find('button.delete-button').trigger('click')
    await flushPromises()
    await wrapper.find('.notice-modal .btn-confirm').trigger('click')
    await flushPromises()

    const setup: any = (wrapper.vm as any).$.setupState
    setup.isDeleting = true
    setup.noticeAppear = true
    setup.secondAppear = true

    setup.closeNoticeModal()
    setup.closeSecondConfirm()
    expect(setup.noticeAppear).toBe(true)
    expect(setup.secondAppear).toBe(true)

    // openSecondConfirm 在 isDeleting 时不会再次推进
    setup.showSecondConfirm = false
    await setup.openSecondConfirm()
    expect(setup.showSecondConfirm).toBe(false)
  })

  it('performDelete 成功 → request.post(DELETE_MY_ACCOUNT) + Toast.success + clearAuth + navigateTo("/", replace)', async () => {
    const wrapper = mountSection()
    const setup: any = (wrapper.vm as any).$.setupState

    await setup.performDelete()
    await flushPromises()

    expect(mockPost).toHaveBeenCalledWith(expect.objectContaining({ url: expect.stringContaining('/v1/user/delete_my_account') }))
    expect(mockToastShowToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'success' }))
    expect(mockClearAuth).toHaveBeenCalled()
    expect(mockNavigateTo).toHaveBeenCalledWith('/', { replace: true })
    expect(mockScrollLock.value).toBe(false)
  })

  it('performDelete 失败 → 不跳转 + isDeleting 复位 false', async () => {
    mockPost.mockRejectedValueOnce(new Error('network'))
    const wrapper = mountSection()
    const setup: any = (wrapper.vm as any).$.setupState

    await setup.performDelete()
    await flushPromises()

    expect(mockNavigateTo).not.toHaveBeenCalled()
    expect(mockClearAuth).not.toHaveBeenCalled()
    expect(setup.isDeleting).toBe(false)
  })

  it('performDelete 重复触发（isDeleting=true）→ 不再发请求', async () => {
    const wrapper = mountSection()
    const setup: any = (wrapper.vm as any).$.setupState
    setup.isDeleting = true

    await setup.performDelete()
    expect(mockPost).not.toHaveBeenCalled()
  })

  it('onNoticeAfterLeave：showSecondConfirm=false → 解锁；=true → 保持锁定', async () => {
    const wrapper = mountSection()
    const setup: any = (wrapper.vm as any).$.setupState

    mockScrollLock.value = true
    setup.showSecondConfirm = true
    setup.onNoticeAfterLeave()
    expect(mockScrollLock.value).toBe(true)

    setup.showSecondConfirm = false
    setup.onNoticeAfterLeave()
    expect(mockScrollLock.value).toBe(false)
  })

  it('onSecondAfterLeave：showNoticeModal=false → 解锁；=true → 保持', async () => {
    const wrapper = mountSection()
    const setup: any = (wrapper.vm as any).$.setupState

    mockScrollLock.value = true
    setup.showNoticeModal = true
    setup.onSecondAfterLeave()
    expect(mockScrollLock.value).toBe(true)

    setup.showNoticeModal = false
    setup.onSecondAfterLeave()
    expect(mockScrollLock.value).toBe(false)
  })

  it('noticePage computed：currentLocale 切换 → 取 zhPage / enPage', async () => {
    const wrapper = mountSection()
    const setup: any = (wrapper.vm as any).$.setupState
    setup.zhPage = { mark: 'zh' }
    setup.enPage = { mark: 'en' }

    // 当前 mock 锁定 currentLocale='zh'，noticePage 应取 zhPage
    expect(setup.noticePage).toEqual({ mark: 'zh' })
  })
})
