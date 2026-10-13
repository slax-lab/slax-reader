// AddUrlTopModal 组件单测（居中 modal 版本，使用 Teleport to="body"）
// model: show
// emit: addUrlSuccess
// computed addUrlButtonEnable：text 非空 + http(s):// 前缀
// topModalClick → request().post(ADD_URL) → 关闭 modal + emit + clear
// watch show=true → focus input
// 注意：Teleport 渲染到 document.body，需 attachTo: document.body 并从 document 查找
import { nextTick } from 'vue'

import AddUrlTopModal from '~~/app/components/BookmarkList/AddUrlTopModal.vue'

import { RequestError } from '@commons/frontend-utils/request'
import { useLabFeatures } from '~/composables/useLabFeatures'

import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { mountWithApp } from '~~/tests/setup/mount'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockRequest, mockPost, mockGet, mockToastShowToast, mockNavigateTo } = vi.hoisted(() => {
  const mockPost = vi.fn(() => Promise.resolve({ bookmark_id: 1, status: 'ok' }))
  return {
    mockPost,
    mockGet: vi.fn(),
    mockRequest: vi.fn(),
    mockToastShowToast: vi.fn(),
    mockNavigateTo: vi.fn()
  }
})

mockNuxtImport('request', () => mockRequest)
mockNuxtImport('navigateTo', () => mockNavigateTo)

vi.mock('~/components/Toast', () => ({
  default: { showToast: mockToastShowToast },
  ToastType: { Success: 'success', Error: 'error', Normal: 'normal' }
}))

// 模拟 request()：真实实现会先调 per-request errorInterceptors 再 reject
const rejectWith = (err: Error) =>
  (mockPost as ReturnType<typeof vi.fn>).mockImplementationOnce(async (options: { errorInterceptors?: (e: unknown) => void }) => {
    options.errorInterceptors?.(err)
    throw err
  })

const submitUrl = async (url: string) => {
  const input = document.querySelector('.modal-input') as HTMLInputElement
  input.value = url
  input.dispatchEvent(new Event('input'))
  await nextTick()
  ;(document.querySelector('.modal-btn-primary') as HTMLButtonElement).click()
  await flushPromises()
}

// Teleport 渲染到 body，需要 attachTo 才能在 document 中找到元素
const mountModal = (show: boolean) =>
  mountWithApp(AddUrlTopModal, {
    props: { show },
    attachTo: document.body
  })

const selectFile = async (file: File) => {
  const input = document.querySelector('input[type=file]') as HTMLInputElement
  Object.defineProperty(input, 'files', { value: [file], configurable: true })
  input.dispatchEvent(new Event('change'))
  await nextTick()
}

describe('AddUrlTopModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPost.mockResolvedValue({ bookmark_id: 1, status: 'ok' })
    mockRequest.mockReturnValue({ post: mockPost, get: mockGet })
    mockGet.mockResolvedValue({ features: [] })
    const labs = useLabFeatures()
    labs.loaded.value = true
    labs.features.value = [{ key: 'pdf', status: 'active', enabled: true, enabled_at: null }]
  })

  afterEach(() => {
    vi.useRealTimers()
    // 清理 Teleport 挂载到 body 的内容
    document.body.innerHTML = ''
  })

  it('hides the upload entry while PDF Labs is disabled or unknown, and shows it after opt-in loads', async () => {
    const labs = useLabFeatures()
    labs.features.value[0]!.enabled = false
    const wrapper = mountModal(true)
    expect(document.querySelector('input[type=file]')).toBeNull()
    labs.features.value[0]!.enabled = true
    await nextTick()
    expect(document.querySelector('input[type=file]')).not.toBeNull()
    wrapper.unmount()
    labs.loaded.value = false
    mockGet.mockResolvedValueOnce({ features: [{ key: 'pdf', status: 'active', enabled: true, enabled_at: null }] })
    mountModal(true)
    expect(document.querySelector('input[type=file]')).toBeNull()
    await flushPromises()
    expect(mockGet).toHaveBeenCalledWith({ url: '/v1/user/labs' })
    expect(document.querySelector('input[type=file]')).not.toBeNull()
  })

  it('clears a selected upload when PDF Labs is disabled', async () => {
    mountModal(true)
    await selectFile(new File(['%PDF-1.7'], 'draft.pdf', { type: 'application/pdf' }))
    const labs = useLabFeatures()
    labs.features.value[0]!.enabled = false
    await nextTick()
    expect(document.querySelector('input[type=file]')).toBeNull()
    expect((document.querySelector('.modal-btn-primary') as HTMLButtonElement).disabled).toBe(true)
    expect(mockPost).not.toHaveBeenCalled()
  })

  it('keeps the upload open and offers the Labs settings action if the server rejects opt-in', async () => {
    const wrapper = mountModal(true)
    await selectFile(new File(['%PDF-1.7'], 'draft.pdf', { type: 'application/pdf' }))
    rejectWith(new RequestError({ message: 'PDF bookmarks are still in Labs', name: 'LAB_FEATURE_DISABLED', code: 400 }))
    ;(document.querySelector('.modal-btn-primary') as HTMLButtonElement).click()
    await flushPromises()
    expect(wrapper.emitted('update:show')).toBeFalsy()
    expect(mockToastShowToast).toHaveBeenCalledWith(expect.objectContaining({ text: 'PDF bookmarks are still in Labs', action: { text: 'Turn on', onClick: expect.any(Function) } }))
    expect(document.querySelector('[role=alert]')).toBeNull()
  })

  it('uploads raw PDF bytes, refreshes the list and opens its saved preview', async () => {
    const wrapper = mountModal(true)
    const file = new File(['%PDF-1.7'], '文件.pdf', { type: 'application/pdf' })
    await selectFile(file)
    expect(document.body.textContent).toContain('文件.pdf')
    mockPost.mockResolvedValueOnce({ bookmark_id: 1, bookmark_uid: 'pdf-saved' } as never)
    ;(document.querySelector('.modal-btn-primary') as HTMLButtonElement).click()
    await flushPromises()
    expect(mockPost).toHaveBeenCalledWith(expect.objectContaining({ url: '/v1/bookmark/upload_pdf?filename=%E6%96%87%E4%BB%B6.pdf', body: file, headers: { 'Content-Type': 'application/pdf' } }))
    expect(wrapper.emitted('addUrlSuccess')).toBeTruthy()
    expect(mockNavigateTo).toHaveBeenCalledWith('/b/pdf-saved')
  })

  it('retains the selected file for retry and prevents closing during an upload', async () => {
    const wrapper = mountModal(true)
    await selectFile(new File(['%PDF-1.7'], 'retry.pdf', { type: 'application/pdf' }))
    let fail: (reason: Error) => void = () => {}
    mockPost.mockImplementationOnce(() => new Promise((_, reject) => { fail = reject }))
    ;(document.querySelector('.modal-btn-primary') as HTMLButtonElement).click()
    await nextTick()
    ;(document.querySelector('.modal-close') as HTMLButtonElement).click()
    expect(wrapper.emitted('update:show')).toBeFalsy()
    expect((document.querySelector('.modal-btn-primary') as HTMLButtonElement).disabled).toBe(true)
    fail(new Error('upload failed'))
    await flushPromises()
    expect(document.body.textContent).toContain('retry.pdf')
    expect(document.querySelector('[role=alert]')).not.toBeNull()
    expect((document.querySelector('.modal-btn-primary') as HTMLButtonElement).disabled).toBe(false)
  })

  it('rejects oversized and invalid selections and clears any previously selected PDF', async () => {
    mountModal(true)
    await selectFile(new File(['%PDF-1.7'], 'valid.pdf'))
    const oversized = new File([''], 'large.pdf')
    Object.defineProperty(oversized, 'size', { value: 50 * 1024 * 1024 + 1 })
    await selectFile(oversized)
    expect((document.querySelector('.modal-btn-primary') as HTMLButtonElement).disabled).toBe(true)
    await selectFile(new File(['text'], 'bad.txt', { type: 'text/plain' }))
    expect(document.querySelector('[role=alert]')).not.toBeNull()
    expect(mockPost).not.toHaveBeenCalled()
  })

  it('show=false → modal-backdrop 不渲染', () => {
    mountModal(false)
    expect(document.querySelector('.modal-backdrop')).toBeNull()
  })

  it('show=true → modal-dialog 渲染', () => {
    mountModal(true)
    expect(document.querySelector('.modal-dialog')).not.toBeNull()
  })

  it('addUrlText 空 → 提交按钮 disabled', async () => {
    mountModal(true)
    await nextTick()
    const btn = document.querySelector('.modal-btn-primary') as HTMLButtonElement
    expect(btn?.disabled).toBe(true)
  })

  it('addUrlText 是非 http 前缀 → 提交按钮仍 disabled', async () => {
    mountModal(true)
    await nextTick()
    const input = document.querySelector('.modal-input') as HTMLInputElement
    input.value = 'foo bar'
    input.dispatchEvent(new Event('input'))
    await nextTick()
    const btn = document.querySelector('.modal-btn-primary') as HTMLButtonElement
    expect(btn?.disabled).toBe(true)
  })

  it('addUrlText 含 https:// → 提交按钮 enabled', async () => {
    mountModal(true)
    await nextTick()
    const input = document.querySelector('.modal-input') as HTMLInputElement
    input.value = 'https://example.com'
    input.dispatchEvent(new Event('input'))
    await nextTick()
    const btn = document.querySelector('.modal-btn-primary') as HTMLButtonElement
    expect(btn?.disabled).toBe(false)
  })

  it('addUrlText 含 http:// → 提交按钮 enabled', async () => {
    mountModal(true)
    await nextTick()
    const input = document.querySelector('.modal-input') as HTMLInputElement
    input.value = 'http://example.com'
    input.dispatchEvent(new Event('input'))
    await nextTick()
    const btn = document.querySelector('.modal-btn-primary') as HTMLButtonElement
    expect(btn?.disabled).toBe(false)
  })

  it('confirm → request().post + emit addUrlSuccess + emit update:show false', async () => {
    const wrapper = mountModal(true)
    await nextTick()
    const input = document.querySelector('.modal-input') as HTMLInputElement
    input.value = 'https://example.com'
    input.dispatchEvent(new Event('input'))
    await nextTick()
    const btn = document.querySelector('.modal-btn-primary') as HTMLButtonElement
    btn.click()
    await flushPromises()
    expect(mockPost).toHaveBeenCalledWith(
      expect.objectContaining({
        url: '/v1/bookmark/add_url',
        body: { target_url: 'https://example.com' }
      })
    )
    expect(wrapper.emitted('addUrlSuccess')).toBeTruthy()
    expect(wrapper.emitted('addUrlSuccess')![0]).toEqual(['https://example.com'])
    expect(wrapper.emitted('update:show')).toBeTruthy()
  })

  it('实验室拦截（LAB_FEATURE_DISABLED）→ toast 带“去打开”，弹窗留着，loading 复位', async () => {
    const wrapper = mountModal(true)
    await nextTick()
    rejectWith(new RequestError({ message: 'YouTube videos are still in Labs', name: 'LAB_FEATURE_DISABLED', code: 400 }))
    await submitUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ')

    expect(mockToastShowToast).toHaveBeenCalledTimes(1)
    const options = mockToastShowToast.mock.calls[0]![0]
    expect(options).toMatchObject({ text: 'YouTube videos are still in Labs', type: 'error', duration: 6000, action: { text: 'Turn on' } })
    options.action.onClick()
    expect(mockNavigateTo).toHaveBeenCalledWith('/user#labs')

    expect(wrapper.emitted('addUrlSuccess')).toBeFalsy()
    expect(wrapper.emitted('update:show')).toBeFalsy()
    expect(document.querySelector('.modal-dialog')).not.toBeNull()
    expect(document.querySelector('.modal-btn-primary .i-svg-spinners\\:90-ring')).toBeNull()
  })

  it('其它错误 → 只显示服务端文案，没有按钮，弹窗留着', async () => {
    const wrapper = mountModal(true)
    await nextTick()
    rejectWith(new RequestError({ message: 'Blocked target url', name: 'BLOCK_TARGET_URL', code: 400 }))
    await submitUrl('https://example.com/blocked')

    expect(mockToastShowToast).toHaveBeenCalledWith({ text: 'Blocked target url', type: 'error' })
    expect(wrapper.emitted('addUrlSuccess')).toBeFalsy()
    expect(document.querySelector('.modal-dialog')).not.toBeNull()
  })

  it('show false→true 切换 → 不抛错（watch focus 覆盖）', async () => {
    const wrapper = mountModal(false)
    await wrapper.setProps({ show: true })
    await nextTick()
    await nextTick()
    expect(wrapper.exists()).toBe(true)
  })

  it('关闭按钮 click → emit update:show false', async () => {
    const wrapper = mountModal(true)
    await nextTick()
    const closeBtn = document.querySelector('.modal-close') as HTMLButtonElement
    closeBtn.click()
    await nextTick()
    expect(wrapper.emitted('update:show')).toBeTruthy()
  })
})
