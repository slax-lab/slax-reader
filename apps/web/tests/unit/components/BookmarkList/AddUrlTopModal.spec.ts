import { nextTick } from 'vue'

import AddUrlTopModal from '~~/app/components/BookmarkList/AddUrlTopModal.vue'

import { RequestError } from '@commons/frontend-utils/request'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { useLabFeatures } from '~/composables/useLabFeatures'
import { createTestI18n, mountWithApp } from '~~/tests/setup/mount'
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
const mountModal = (show: boolean, props: { initialMode?: 'url' | 'feed' | 'file'; submitFeed?: (url: string, name: string) => Promise<void> } = {}) =>
  mountWithApp(AddUrlTopModal, {
    props: { show, ...props },
    attachTo: document.body
  })

enableAutoUnmount(afterEach)

const setInput = async (selector: string, value: string) => {
  const input = document.querySelector(selector) as HTMLInputElement
  input.value = value
  input.dispatchEvent(new Event('input'))
  await nextTick()
}

const setLabs = (rss: boolean, pdf: boolean) => {
  useLabFeatures().features.value = [
    { key: 'rss', status: 'active', enabled: rss, enabled_at: null },
    { key: 'pdf', status: 'active', enabled: pdf, enabled_at: null }
  ]
}

const tabModes = () => [...document.querySelectorAll('.add-tabs button')].map(button => button.id.replace('add-tab-', ''))

const openTab = async (mode: string) => {
  ;(document.querySelector(`#add-tab-${mode}`) as HTMLButtonElement | null)?.click()
  await nextTick()
}

const selectFile = async (file: File) => {
  await openTab('file')
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

  it.each([false, true])('restores the specific opener only while attached (detached=%s)', async detached => {
    const opener = document.createElement('button')
    const next = document.createElement('button')
    document.body.append(opener, next)
    const wrapper = mountWithApp(AddUrlTopModal, {
      props: { show: true, opener },
      attachTo: document.body,
      global: { stubs: { transition: false } }
    })
    document.querySelector<HTMLInputElement>('.modal-input')!.focus()
    if (detached) {
      opener.remove()
      next.focus()
    }
    await wrapper.setProps({ show: false })
    await vi.waitFor(() => expect(document.querySelector('.modal-dialog')).toBeNull())
    expect(document.activeElement).toBe(detached ? next : opener)
  })

  it.each([
    { rss: true, pdf: true, modes: ['url', 'feed', 'file'] },
    { rss: true, pdf: false, modes: ['url', 'feed'] },
    { rss: false, pdf: true, modes: ['url', 'file'] },
    { rss: false, pdf: false, modes: ['url'] }
  ])('exposes only confirmed Labs modes: $modes', ({ rss, pdf, modes }) => {
    setLabs(rss, pdf)
    mountModal(true)
    expect(document.querySelector('[role=tabpanel]')?.id).toBe('add-panel-url')
    expect(tabModes()).toEqual(modes.length > 1 ? modes : [])
    expect(!!document.querySelector('[role=tablist]')).toBe(modes.length > 1)
  })

  it.each([true, false])('uses initial Feed mode only when RSS is enabled: %s', enabled => {
    setLabs(enabled, true)
    mountModal(true, { initialMode: 'feed' })
    expect(document.querySelector('[role=tabpanel]')?.id).toBe(enabled ? 'add-panel-feed' : 'add-panel-url')
  })

  it('keeps URL usable while RSS Labs is unconfirmed', async () => {
    setLabs(true, true)
    useLabFeatures().loaded.value = false
    mockGet.mockResolvedValue({ features: [] })
    mountModal(true, { initialMode: 'feed' })
    expect(document.querySelector('[role=tabpanel]')?.id).toBe('add-panel-url')
    expect(tabModes()).toEqual([])
    await setInput('input[type=url]', 'https://example.com/feed/')
    expect(document.querySelector('.feed-hint')).toBeNull()
    await flushPromises()
  })

  it('shows a local feed hint only in URL mode with RSS enabled and keeps the complete address on switch', async () => {
    setLabs(false, true)
    const submitFeed = vi.fn().mockResolvedValue(undefined)
    mountModal(true, { submitFeed })
    const address = 'https://example.com/feed/?format=atom&token=a%2Fb&sort=new'
    await setInput('input[type=url]', address)
    expect(document.querySelector('.feed-hint')).toBeNull()
    setLabs(true, true)
    await nextTick()
    expect(document.querySelector('.feed-hint')).not.toBeNull()
    ;(document.querySelector('.hint-actions button') as HTMLButtonElement).click()
    await nextTick()
    expect(document.querySelector('#add-tab-feed')?.getAttribute('aria-selected')).toBe('true')
    expect((document.querySelector('input[type=url]') as HTMLInputElement).value).toBe(address)
    expect(document.querySelector('.feed-hint')).toBeNull()
    await openTab('file')
    expect(document.querySelector('.feed-hint')).toBeNull()
    expect(mockRequest).not.toHaveBeenCalled()
    expect(submitFeed).not.toHaveBeenCalled()
  })

  it('dismisses the feed hint for the unchanged address during the open session', async () => {
    setLabs(true, true)
    mountModal(true)
    await setInput('input[type=url]', 'https://example.com/feed/?format=atom')
    ;(document.querySelector('.hint-actions .muted') as HTMLButtonElement).click()
    await nextTick()
    expect(document.querySelector('.feed-hint')).toBeNull()
    await openTab('feed')
    await openTab('url')
    expect(document.querySelector('.feed-hint')).toBeNull()
    await setInput('input[type=url]', 'https://example.com/rss.xml')
    expect(document.querySelector('.feed-hint')).not.toBeNull()
    expect(mockRequest).not.toHaveBeenCalled()
  })

  it('preserves address, feed name, and selected PDF across mode switches and picker cancellation', async () => {
    setLabs(true, true)
    mountModal(true)
    const address = 'https://example.com/feed/?token=a%2Fb&format=atom'
    await setInput('input[type=url]', address)
    await selectFile(new File(['%PDF-1.7'], 'draft.pdf', { type: 'application/pdf' }))
    await openTab('feed')
    expect((document.querySelector('input[type=url]') as HTMLInputElement).value).toBe(address)
    await setInput('#add-feed-name', 'Daily reading')
    await openTab('url')
    await openTab('file')
    expect(document.querySelector('.file-name')?.textContent).toContain('draft.pdf')
    const input = document.querySelector('input[type=file]') as HTMLInputElement
    Object.defineProperty(input, 'files', { value: [], configurable: true })
    input.dispatchEvent(new Event('change'))
    await nextTick()
    expect(document.querySelector('.file-name')?.textContent).toContain('draft.pdf')
    await openTab('feed')
    expect((document.querySelector('#add-feed-name') as HTMLInputElement).value).toBe('Daily reading')
    expect((document.querySelector('input[type=url]') as HTMLInputElement).value).toBe(address)
    expect(mockRequest).not.toHaveBeenCalled()
  })

  it('submits Feed through its owner and closes without bookmark success or toast', async () => {
    setLabs(true, true)
    const submitFeed = vi.fn().mockResolvedValue(undefined)
    const wrapper = mountModal(true, { initialMode: 'feed', submitFeed })
    await setInput('#add-feed-name', ' Daily reading ')
    await submitUrl('https://example.com/feed/?token=a%2Fb')
    expect(submitFeed).toHaveBeenCalledExactlyOnceWith('https://example.com/feed/?token=a%2Fb', 'Daily reading')
    expect(wrapper.emitted('update:show')).toEqual([[false]])
    expect(wrapper.emitted('addUrlSuccess')).toBeFalsy()
    expect(mockPost).not.toHaveBeenCalled()
    expect(mockToastShowToast).not.toHaveBeenCalled()
    expect(document.querySelector('.modal-dialog')).toBeNull()
  })

  it.each([['invalid_feed', 'rss.errors.invalid_feed'], ['unexpected', 'rss.source_error']])('retains Feed input with mapped failure %s', async (code, key) => {
    setLabs(true, true)
    const submitFeed = vi.fn().mockRejectedValue(new Error(code))
    const wrapper = mountModal(true, { initialMode: 'feed', submitFeed })
    await setInput('#add-feed-name', 'Daily reading')
    await submitUrl('https://example.com/feed/?format=atom')
    expect(document.querySelector('[role=alert]')?.textContent).toBe(createTestI18n().global.t(key))
    expect((document.querySelector('input[type=url]') as HTMLInputElement).value).toBe('https://example.com/feed/?format=atom')
    expect((document.querySelector('#add-feed-name') as HTMLInputElement).value).toBe('Daily reading')
    expect(wrapper.emitted('update:show')).toBeFalsy()
    expect(wrapper.emitted('addUrlSuccess')).toBeFalsy()
    expect((document.querySelector('.modal-btn-primary') as HTMLButtonElement).disabled).toBe(false)
    await openTab('url')
    expect(document.querySelector('[role=alert]')).toBeNull()
    await openTab('feed')
    expect(document.querySelector('[role=alert]')).not.toBeNull()
  })

  it('prevents competing tabs and closing while a Feed submission is pending', async () => {
    setLabs(true, true)
    let resolve!: () => void
    const submitFeed = vi.fn(() => new Promise<void>(done => { resolve = done }))
    const wrapper = mountModal(true, { initialMode: 'feed', submitFeed })
    await setInput('input[type=url]', 'https://example.com/feed/')
    ;(document.querySelector('.modal-btn-primary') as HTMLButtonElement).click()
    await nextTick()
    await openTab('url')
    ;(document.querySelector('.modal-close') as HTMLButtonElement).click()
    expect(document.querySelector('[role=tabpanel]')?.id).toBe('add-panel-feed')
    expect(wrapper.emitted('update:show')).toBeFalsy()
    expect([...document.querySelectorAll('.add-tabs button')].every(button => (button as HTMLButtonElement).disabled)).toBe(true)
    resolve()
    await flushPromises()
    expect(submitFeed).toHaveBeenCalledOnce()
    expect(document.querySelector('.modal-dialog')).toBeNull()
  })

  it('keeps URL validation errors out of Feed and File modes', async () => {
    setLabs(true, true)
    mountModal(true)
    await setInput('input[type=url]', 'invalid address')
    ;(document.querySelector('input[type=url]') as HTMLInputElement).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    await nextTick()
    expect(document.querySelector('.modal-error')).not.toBeNull()
    await openTab('feed')
    expect(document.querySelector('.modal-error')).toBeNull()
    expect(document.querySelector('.modal-input-wrap.error')).toBeNull()
    await openTab('file')
    expect(document.querySelector('.modal-error')).toBeNull()
  })

  it.each(['button', 'parent'])('resets drafts and errors at close via %s rather than waiting for reopening', async method => {
    setLabs(true, true)
    const wrapper = mountModal(true, { submitFeed: vi.fn().mockRejectedValue(new Error('source_unavailable')) })
    await setInput('input[type=url]', 'https://example.com/feed/')
    ;(document.querySelector('.hint-actions .muted') as HTMLButtonElement).click()
    await selectFile(new File(['%PDF-1.7'], 'draft.pdf'))
    await openTab('feed')
    await setInput('#add-feed-name', 'Daily reading')
    ;(document.querySelector('.modal-btn-primary') as HTMLButtonElement).click()
    await flushPromises()
    if (method === 'button') (document.querySelector('.modal-close') as HTMLButtonElement).click()
    else await wrapper.setProps({ show: false })
    await nextTick()
    const state = wrapper.vm.$.setupState as Record<string, unknown>
    expect(state.mode).toBe('url')
    expect(state.addUrlText).toBe('')
    expect(state.feedName).toBe('')
    expect(state.pdfFile).toBeNull()
    expect(state.feedError).toBe('')
    expect(state.pdfError).toBe('')
    expect(state.showError).toBe(false)
    expect(state.dismissedFeedUrl).toBe('')
    await wrapper.setProps({ show: false })
    await wrapper.setProps({ show: true })
    expect(document.querySelector('[role=tabpanel]')?.id).toBe('add-panel-url')
    expect((document.querySelector('input[type=url]') as HTMLInputElement).value).toBe('')
  })

  it('returns to URL and hides feed hints if RSS is disabled while open', async () => {
    setLabs(true, true)
    mountModal(true, { initialMode: 'feed' })
    await setInput('input[type=url]', 'https://example.com/feed/')
    setLabs(false, true)
    await nextTick()
    expect(document.querySelector('[role=tabpanel]')?.id).toBe('add-panel-url')
    expect(document.querySelector('.feed-hint')).toBeNull()
    expect(mockRequest).not.toHaveBeenCalled()
  })

  it('allows deliberate REST resubmission when no PowerSync state is available', async () => {
    const wrapper = mountModal(true)
    await submitUrl('https://example.com/accepted-still-processing')
    expect(mockPost).toHaveBeenCalledOnce()
    await wrapper.setProps({ show: false })
    await wrapper.setProps({ show: true })
    await submitUrl('https://example.com/accepted-still-processing')
    expect(mockPost).toHaveBeenCalledTimes(2)
    wrapper.unmount()
  })

  it('hides the upload entry while PDF Labs is disabled or unknown, and shows it after opt-in loads', async () => {
    const labs = useLabFeatures()
    labs.features.value[0]!.enabled = false
    const wrapper = mountModal(true)
    expect(tabModes()).not.toContain('file')
    labs.features.value[0]!.enabled = true
    await nextTick()
    expect(tabModes()).toContain('file')
    await openTab('file')
    expect(document.querySelector('input[type=file]')).not.toBeNull()
    wrapper.unmount()
    labs.loaded.value = false
    mockGet.mockResolvedValueOnce({ features: [{ key: 'pdf', status: 'active', enabled: true, enabled_at: null }] })
    mountModal(true)
    expect(tabModes()).not.toContain('file')
    await flushPromises()
    expect(mockGet).toHaveBeenCalledWith({ url: '/v1/user/labs' })
    await openTab('file')
    expect(document.querySelector('input[type=file]')).not.toBeNull()
  })

  it('clears a selected upload when PDF Labs is disabled', async () => {
    mountModal(true)
    await selectFile(new File(['%PDF-1.7'], 'draft.pdf', { type: 'application/pdf' }))
    const labs = useLabFeatures()
    labs.features.value[0]!.enabled = false
    await nextTick()
    expect(tabModes()).not.toContain('file')
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
