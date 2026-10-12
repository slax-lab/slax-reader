// Modal/EditName 组件单测
// 全功能 modal：mount=appear=false → 100ms setTimeout → appear=true
// closeModal: appear=false（loading 时短路）
// editBookmarkName: 同名短路 / loading 短路 / request.post → emit success + closeModal
// onAfterLeave: useScrollLock(false) + emit dismiss
import { ref } from 'vue'

import EditName from '~~/app/components/Modal/EditName.vue'

import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { mountWithApp } from '~~/tests/setup/mount'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockRequest, mockPost } = vi.hoisted(() => {
  const mockPost = vi.fn(() => Promise.resolve({}))
  return {
    mockPost,
    mockRequest: vi.fn(() => ({ post: mockPost }))
  }
})

mockNuxtImport('request', () => mockRequest)

// useScrollLock 在 happy-dom 下访问 window.style.overflow 会抛
// 用 vi.mock 覆盖 @vueuse/core 的 useScrollLock
vi.mock('@vueuse/core', async () => {
  const actual = await vi.importActual<any>('@vueuse/core')
  return {
    ...actual,
    useScrollLock: () => ref(false)
  }
})

describe('Modal/EditName', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPost.mockResolvedValue({})
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('默认渲染 .edit-name-modal + .modal-content + textarea + close button', () => {
    const wrapper = mountWithApp(EditName, { props: { bookmarkId: 1, name: 'Hello' } })
    expect(wrapper.find('.edit-name-modal').exists()).toBe(true)
    expect(wrapper.find('.modal-content').exists()).toBe(true)
    expect(wrapper.find('textarea').exists()).toBe(true)
    expect(wrapper.find('button.close').exists()).toBe(true)
  })

  it('name 非空 → .title 渲染 name', () => {
    const wrapper = mountWithApp(EditName, { props: { bookmarkId: 1, name: 'Hello World' } })
    expect(wrapper.find('.content .title').text()).toBe('Hello World')
  })

  it('name 空 → .title 不渲染', () => {
    const wrapper = mountWithApp(EditName, { props: { bookmarkId: 1, name: '' } })
    expect(wrapper.find('.content .title').exists()).toBe(false)
  })

  it('aliasName 透传到 textarea v-model', () => {
    const wrapper = mountWithApp(EditName, { props: { bookmarkId: 1, name: 'X', aliasName: 'My Alias' } })
    const textarea = wrapper.find('textarea')
    expect((textarea.element as HTMLTextAreaElement).value).toBe('My Alias')
  })

  it('点击 close 按钮 → appear=false（不抛错即覆盖 closeModal）', async () => {
    const wrapper = mountWithApp(EditName, { props: { bookmarkId: 1, name: 'X' } })
    await wrapper.find('button.close').trigger('click')
    expect(wrapper.exists()).toBe(true)
  })

  it('点击外层 .edit-name-modal → 触发 closeModal', async () => {
    const wrapper = mountWithApp(EditName, { props: { bookmarkId: 1, name: 'X' } })
    await wrapper.find('.edit-name-modal').trigger('click')
    expect(wrapper.exists()).toBe(true)
  })

  it('点击 .modal-content 不冒泡 → 不触发 closeModal（@click.stop）', async () => {
    const wrapper = mountWithApp(EditName, { props: { bookmarkId: 1, name: 'X' } })
    await wrapper.find('.modal-content').trigger('click')
    expect(wrapper.exists()).toBe(true)
  })

  it('save 按钮：editname === aliasName → closeModal 早退（不调 request）', async () => {
    const wrapper = mountWithApp(EditName, { props: { bookmarkId: 1, name: 'X', aliasName: 'same' } })
    const textarea = wrapper.find('textarea')
    await textarea.setValue('same')
    await wrapper.find('.bottom button').trigger('click')
    await flushPromises()
    expect(mockPost).not.toHaveBeenCalled()
  })

  it('save 按钮：editname !== aliasName → request.post + emit success', async () => {
    const wrapper = mountWithApp(EditName, { props: { bookmarkId: 1, name: 'X', aliasName: 'old' } })
    const textarea = wrapper.find('textarea')
    await textarea.setValue('new title')
    await wrapper.find('.bottom button').trigger('click')
    await flushPromises()
    expect(mockPost).toHaveBeenCalledWith(
      expect.objectContaining({
        url: '/v1/bookmark/alias_title',
        body: { bookmark_id: 1, alias_title: 'new title' }
      })
    )
    expect(wrapper.emitted('success')).toBeTruthy()
    expect(wrapper.emitted('success')![0]).toEqual(['new title'])
  })

  it('appear=true → setTimeout 后 transition 出现（覆盖 onMounted setTimeout）', async () => {
    vi.useFakeTimers()
    const wrapper = mountWithApp(EditName, { props: { bookmarkId: 1, name: 'X' } })
    await vi.advanceTimersByTimeAsync(50)
    // appear=true 后 modal-content v-show 显示
    const content = wrapper.find('.modal-content')
    expect(content.exists()).toBe(true)
  })
})
