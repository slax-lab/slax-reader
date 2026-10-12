// Modal/EditTag 组件单测
// props: bookmarkId / tagId / tagName / source / idKind
// emit: close / dismiss / success / delete / demote
// idKind='uuid' → body 用 tag_uuid，否则 tag_id
// demoteTag: 仅 source='mine' 显示按钮；request.post(DEMOTE_USER_TAG) → emit demote；失败 → Toast Error
// 调 useScrollLock(window) - 用 vi.mock 绕开 happy-dom
// editTagName: editname===tagName 或空 → closeModal；否则 request.post(UPDATE_USER_TAG) + emit success
// deleteTag: request.post(DELETE_USER_TAG) → success → emit delete；失败 → Toast Error
// onKeyDown: composition 期间 / 非 Enter → 短路；否则 submitTagName
import { ref } from 'vue'

import EditTag from '~~/app/components/Modal/EditTag.vue'

import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { mountWithApp } from '~~/tests/setup/mount'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockRequest, mockPost, mockToastShowToast } = vi.hoisted(() => {
  const mockPost = vi.fn((): Promise<{ ok: boolean } | null> => Promise.resolve({ ok: true }))
  return {
    mockPost,
    mockRequest: vi.fn(() => ({ post: mockPost })),
    mockToastShowToast: vi.fn()
  }
})

mockNuxtImport('request', () => mockRequest)

vi.mock('@vueuse/core', async () => {
  const actual = await vi.importActual<any>('@vueuse/core')
  return {
    ...actual,
    useScrollLock: () => ref(false)
  }
})

vi.mock('~/components/Toast', () => ({
  default: { showToast: mockToastShowToast },
  ToastType: { Success: 'success', Error: 'error' }
}))

describe('Modal/EditTag', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPost.mockResolvedValue({ ok: true })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('mount → 渲染 .edit-tag-modal + textarea + close + save 按钮', () => {
    const wrapper = mountWithApp(EditTag, { props: { bookmarkId: 1, tagId: 5, tagName: 'old' } })
    expect(wrapper.find('.edit-tag-modal').exists()).toBe(true)
    expect(wrapper.find('textarea').exists()).toBe(true)
    expect(wrapper.find('button.close').exists()).toBe(true)
    expect(wrapper.find('.bottom button:not(.delete-btn)').exists()).toBe(true)
  })

  it('textarea placeholder 是 tagName', () => {
    const wrapper = mountWithApp(EditTag, { props: { tagId: 5, tagName: 'mytag' } })
    expect(wrapper.find('textarea').attributes('placeholder')).toBe('mytag')
  })

  it('save 按钮：editname 等于 tagName → closeModal 短路', async () => {
    const wrapper = mountWithApp(EditTag, { props: { tagId: 5, tagName: 'same' } })
    await wrapper.find('textarea').setValue('same')
    await wrapper.find('.bottom button:not(.delete-btn)').trigger('click')
    await flushPromises()
    expect(mockPost).not.toHaveBeenCalled()
  })

  it('save 按钮：editname 空 → closeModal 短路', async () => {
    const wrapper = mountWithApp(EditTag, { props: { tagId: 5, tagName: 'old' } })
    await wrapper.find('textarea').setValue('   ')
    await wrapper.find('.bottom button:not(.delete-btn)').trigger('click')
    await flushPromises()
    expect(mockPost).not.toHaveBeenCalled()
  })

  it('save 按钮：editname 新值 → request.post(UPDATE_USER_TAG) + emit success', async () => {
    const wrapper = mountWithApp(EditTag, { props: { tagId: 5, tagName: 'old' } })
    await wrapper.find('textarea').setValue('new tag')
    await wrapper.find('.bottom button:not(.delete-btn)').trigger('click')
    await flushPromises()
    expect(mockPost).toHaveBeenCalledWith(
      expect.objectContaining({
        url: '/v1/tag/update',
        body: { tag_id: 5, tag_name: 'new tag' }
      })
    )
    const events = wrapper.emitted('success')
    expect(events).toBeTruthy()
    expect(events![0]).toEqual([5, 'new tag'])
  })

  it('Enter 键 + 文本非空 → 触发 submitTagName', async () => {
    const wrapper = mountWithApp(EditTag, { props: { tagId: 5, tagName: 'old' } })
    const textarea = wrapper.find('textarea')
    await textarea.setValue('typed via enter')
    await textarea.trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(mockPost).toHaveBeenCalledWith(
      expect.objectContaining({
        body: { tag_id: 5, tag_name: 'typed via enter' }
      })
    )
  })

  it('composition 期间 Enter → 不触发 submitTagName', async () => {
    // attachTo: v-ime-guard 靠 document 捕获阶段拦截 Enter，元素必须真实挂在 document 树上才生效
    const wrapper = mountWithApp(EditTag, { props: { tagId: 5, tagName: 'old' }, attachTo: document.body })
    const textarea = wrapper.find('textarea')
    await textarea.trigger('compositionstart')
    await textarea.setValue('foo')
    await textarea.trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(mockPost).not.toHaveBeenCalled()
    await textarea.trigger('compositionend')
    await textarea.trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(mockPost).toHaveBeenCalled()
  })

  it('非 Enter 键 → 短路', async () => {
    const wrapper = mountWithApp(EditTag, { props: { tagId: 5, tagName: 'old' } })
    const textarea = wrapper.find('textarea')
    await textarea.setValue('foo')
    await textarea.trigger('keydown', { key: 'a' })
    await flushPromises()
    expect(mockPost).not.toHaveBeenCalled()
  })

  it('close 按钮 click → 触发 closeModal（不抛错）', async () => {
    const wrapper = mountWithApp(EditTag, { props: { tagId: 5 } })
    await wrapper.find('button.close').trigger('click')
    expect(wrapper.exists()).toBe(true)
  })

  it('Transition after-leave → emit dismiss', () => {
    const wrapper = mountWithApp(EditTag, { props: { tagId: 5 } })
    const transitions = wrapper.findAllComponents({ name: 'Transition' })
    transitions[0]!.vm.$emit('after-leave')
    expect(wrapper.emitted('dismiss')).toBeTruthy()
  })

  describe('deleteTag', () => {
    it('成功 → request.post(DELETE_USER_TAG) + emit delete', async () => {
      mockPost.mockResolvedValueOnce({ ok: true })
      const wrapper = mountWithApp(EditTag, { props: { tagId: 5 } })
      // 通过 vm 直接调（组件未在模板暴露 delete 按钮，但函数存在）
      // setup 函数虽未 expose，可通过 wrapper.vm.deleteTag 等方式触发；这里通过 vm.$.setupState
      const setup: any = (wrapper.vm as any).$.setupState
      await setup.deleteTag()
      expect(mockPost).toHaveBeenCalledWith(
        expect.objectContaining({
          url: '/v1/tag/delete',
          body: { tag_id: 5 }
        })
      )
      expect(wrapper.emitted('delete')).toBeTruthy()
      expect(wrapper.emitted('delete')![0]).toEqual([5])
    })

    it('失败（返 null）→ Toast Error + 不 emit delete', async () => {
      mockPost.mockResolvedValueOnce(null)
      const wrapper = mountWithApp(EditTag, { props: { tagId: 5 } })
      const setup: any = (wrapper.vm as any).$.setupState
      await setup.deleteTag()
      expect(mockToastShowToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }))
      expect(wrapper.emitted('delete')).toBeUndefined()
    })

    it('isLoading=true 期间 → 短路', async () => {
      let resolveFn: any
      mockPost.mockImplementationOnce(
        () =>
          new Promise(r => {
            resolveFn = r
          })
      )
      const wrapper = mountWithApp(EditTag, { props: { tagId: 5 } })
      const setup: any = (wrapper.vm as any).$.setupState
      // 第一次启动让 isLoading=true
      setup.deleteTag()
      await wrapper.vm.$nextTick()
      // 第二次应短路
      await setup.deleteTag()
      resolveFn?.({ ok: true })
      await flushPromises()
      // mockPost 只被调一次
      expect(mockPost).toHaveBeenCalledTimes(1)
    })
  })

  describe('idKind = uuid', () => {
    it('update / delete 都发 tag_uuid，绝不发 tag_id', async () => {
      const wrapper = mountWithApp(EditTag, { props: { tagId: 'u-1', tagName: 'old', idKind: 'uuid' } })
      await wrapper.find('textarea').setValue('renamed')
      await wrapper.find('.bottom button:not(.delete-btn)').trigger('click')
      await flushPromises()
      expect(mockPost).toHaveBeenCalledWith(expect.objectContaining({ url: '/v1/tag/update', body: { tag_uuid: 'u-1', tag_name: 'renamed' } }))
      expect(wrapper.emitted('success')![0]).toEqual(['u-1', 'renamed'])

      await wrapper.find('.delete-btn').trigger('click')
      await wrapper.find('.danger-btn').trigger('click')
      await flushPromises()
      expect(mockPost).toHaveBeenLastCalledWith(expect.objectContaining({ url: '/v1/tag/delete', body: { tag_uuid: 'u-1' } }))
      expect(wrapper.emitted('delete')![0]).toEqual(['u-1'])
    })
  })

  describe('demoteTag', () => {
    it('source=mine → 显示“移出我的标签”；auto / 缺省 → 不显示', () => {
      const mine = mountWithApp(EditTag, { props: { tagId: 'h1', tagName: 'x', source: 'mine' } })
      expect(mine.find('.demote-btn').text()).toBe('Remove from my tags')
      const auto = mountWithApp(EditTag, { props: { tagId: 'h1', tagName: 'x', source: 'auto' } })
      expect(auto.find('.demote-btn').exists()).toBe(false)
      const none = mountWithApp(EditTag, { props: { tagId: 'h1', tagName: 'x' } })
      expect(none.find('.demote-btn').exists()).toBe(false)
    })

    it('成功 → request.post(DEMOTE_USER_TAG, tag_id) + emit demote', async () => {
      mockPost.mockResolvedValueOnce({ ok: true })
      const wrapper = mountWithApp(EditTag, { props: { tagId: 'h1', tagName: 'x', source: 'mine' } })
      await wrapper.find('.demote-btn').trigger('click')
      await flushPromises()
      expect(mockPost).toHaveBeenCalledWith(expect.objectContaining({ url: '/v1/tag/demote', body: { tag_id: 'h1' } }))
      expect(wrapper.emitted('demote')![0]).toEqual(['h1'])
    })

    it('uuid → body 用 tag_uuid', async () => {
      const wrapper = mountWithApp(EditTag, { props: { tagId: 'u-2', tagName: 'x', source: 'mine', idKind: 'uuid' } })
      await wrapper.find('.demote-btn').trigger('click')
      await flushPromises()
      expect(mockPost).toHaveBeenCalledWith(expect.objectContaining({ url: '/v1/tag/demote', body: { tag_uuid: 'u-2' } }))
    })

    it('失败（返 null）→ Toast Error + 不 emit demote', async () => {
      mockPost.mockResolvedValueOnce(null)
      const wrapper = mountWithApp(EditTag, { props: { tagId: 'h1', tagName: 'x', source: 'mine' } })
      await wrapper.find('.demote-btn').trigger('click')
      await flushPromises()
      expect(mockToastShowToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }))
      expect(wrapper.emitted('demote')).toBeUndefined()
    })

    it('isLoading=true 期间 → 短路', async () => {
      let resolveFn: any
      mockPost.mockImplementationOnce(
        () =>
          new Promise(r => {
            resolveFn = r
          })
      )
      const wrapper = mountWithApp(EditTag, { props: { tagId: 'h1', tagName: 'x', source: 'mine' } })
      const btn = wrapper.find('.demote-btn')
      await btn.trigger('click')
      await btn.trigger('click')
      resolveFn?.({ ok: true })
      await flushPromises()
      expect(mockPost).toHaveBeenCalledTimes(1)
    })
  })
})
