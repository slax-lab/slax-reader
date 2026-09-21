// UserImportSection 组件单测
// 子组件：NavigateStyleButton (omnivore/pocket) + ImportProgressModal + ImportLoadingModal
// chooseFile：dynamically inject input[type=file] → onchange → importThirdPartyData
// importThirdPartyData：unzipGetFile + request().uploadFile，上传完成即视为已提交，抓取在后台进行
// 进行中的任务数来自 request().get(import_status)，最多 5 个并行
// 真正测试：UI 渲染 + popupImportProgress 切换 + 子按钮点击触发 chooseFile（DOM input 注入）
import UserImportSection from '~~/app/components/UserImportSection.vue'

import { RequestError } from '@commons/utils/request'

import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { resetImportTasks } from '~~/app/composables/useImportTasks'
import { mountWithApp } from '~~/tests/setup/mount'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockRequest, mockUploadFile, mockGet, mockUnzipGetFile, mockToastShowToast } = vi.hoisted(() => {
  const mockUploadFile = vi.fn(() => Promise.resolve({}))
  const mockGet = vi.fn((): Promise<unknown> => Promise.resolve([]))
  return {
    mockUploadFile,
    mockGet,
    mockRequest: vi.fn(() => ({ uploadFile: mockUploadFile, get: mockGet })),
    mockUnzipGetFile: vi.fn((): Promise<File[]> => Promise.resolve([])),
    mockToastShowToast: vi.fn()
  }
})

const processingTask = (id: number, current = 5) => ({
  id,
  type: 'pinboard',
  status: 1,
  count: 20,
  batch_count: 20,
  current_count: current,
  success_total: current,
  failed_total: 0,
  reason: '',
  created_at: `2026-09-10T0${id}:00:00Z`
})

mockNuxtImport('request', () => mockRequest)
mockNuxtImport('unzipGetFile', () => mockUnzipGetFile)

vi.mock('~/components/Toast', () => ({
  default: { showToast: mockToastShowToast },
  ToastType: { Success: 'success', Error: 'error', Normal: 'normal' }
}))

const baseStubs = {
  // ClientOnly 默认会延迟渲染子组件；测试里直接渲染 default slot
  ClientOnly: { name: 'ClientOnly', template: '<div class="client-only"><slot /></div>' },
  NavigateStyleButton: {
    name: 'NavigateStyleButton',
    template: '<button class="navigate-style-button-stub" @click="$emit(\'action\')">{{ title }}</button>',
    props: ['title', 'loading'],
    emits: ['action']
  },
  ImportProgressModal: {
    name: 'ImportProgressModal',
    template: '<div class="import-progress-stub" />',
    emits: ['close']
  },
  ImportLoadingModal: {
    name: 'ImportLoadingModal',
    template: '<div class="import-loading-stub" />',
    props: ['progress', 'text']
  },
  ImportPreviewModal: {
    name: 'ImportPreviewModal',
    template: '<div class="import-preview-stub" />',
    props: ['fileName', 'sourceType', 'preview', 'busy', 'errorText', 'includeFeed'],
    emits: ['start', 'close', 'update:includeFeed']
  }
}

const mountSection = () => mountWithApp(UserImportSection, { global: { stubs: baseStubs } })

describe('UserImportSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetImportTasks()
    mockUploadFile.mockResolvedValue({ id: 42 })
    mockGet.mockResolvedValue([])
    mockUnzipGetFile.mockResolvedValue([])
  })

  afterEach(() => {
    vi.useRealTimers()
    document.querySelectorAll('#file').forEach(el => el.remove())
  })

  it('mount → 渲染 section + title + import-description + 5 个 NavigateStyleButton', () => {
    const wrapper = mountSection()
    expect(wrapper.find('section').exists()).toBe(true)
    expect(wrapper.find('.title').exists()).toBe(true)
    expect(wrapper.find('.import-description').exists()).toBe(true)
    const buttons = wrapper.findAllComponents({ name: 'NavigateStyleButton' })
    expect(buttons.length).toBe(5)
  })

  it('shows format and limits at the top, lists new sources first, and names Omnivore/Pocket plainly', () => {
    const wrapper = mountSection()
    const description = wrapper.find('.import-description').text()
    expect(description).toContain('CSV')
    expect(description).toContain('25 MiB')
    expect(description).toContain('10,000')
    const titles = wrapper.findAllComponents({ name: 'NavigateStyleButton' }).map(button => button.props('title'))
    expect(titles).toEqual(['Pinboard', 'Readwise Reader', 'Instapaper', 'Omnivore', 'Pocket'])
    expect(wrapper.find('.import-notes').exists()).toBe(true)
    // No "how to export" help line under each source any more
    expect(wrapper.find('.source-help').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Settings → Export')
  })

  it('view-import-progress 按钮 click → showImportProgressModal=true → ImportProgressModal 渲染', async () => {
    const wrapper = mountSection()
    expect(wrapper.findComponent({ name: 'ImportProgressModal' }).exists()).toBe(false)
    await wrapper.find('button.inline').trigger('click')
    expect(wrapper.findComponent({ name: 'ImportProgressModal' }).exists()).toBe(true)
  })

  it('ImportProgressModal emit close → 重置 showImportProgressModal=false', async () => {
    const wrapper = mountSection()
    await wrapper.find('button.inline').trigger('click')
    const modal = wrapper.findComponent({ name: 'ImportProgressModal' })
    await modal.vm.$emit('close')
    expect(wrapper.findComponent({ name: 'ImportProgressModal' }).exists()).toBe(false)
  })

  it('omnivore button action → chooseFile 注入 input[type=file]', async () => {
    const wrapper = mountSection()
    const buttons = wrapper.findAllComponents({ name: 'NavigateStyleButton' })
    await buttons[3]!.vm.$emit('action')
    expect((document.querySelector('input[type=file]') as HTMLInputElement).accept).toBe('.zip')
  })

  it('pocket button action → chooseFile("pocket")', async () => {
    const wrapper = mountSection()
    const buttons = wrapper.findAllComponents({ name: 'NavigateStyleButton' })
    await buttons[4]!.vm.$emit('action')
    expect((document.querySelector('input[type=file]') as HTMLInputElement).accept).toBe('.zip')
  })

  it('importThirdPartyData omnivore + 解压成功 → 走 unzipGetFile + uploadFile', async () => {
    const fakeFile = new File(['content'], 'metadata_1_to_100.json', { type: 'application/json' })
    mockUnzipGetFile.mockResolvedValueOnce([fakeFile])
    const wrapper = mountSection()
    const setup: any = (wrapper.vm as any).$.setupState

    const input = document.createElement('input')
    input.type = 'file'
    input.id = 'file'
    document.body.appendChild(input)
    Object.defineProperty(input, 'files', { value: [new File(['data'], 'archive.zip')] })

    await setup.importThirdPartyData('omnivore', input.files?.[0])
    await flushPromises()
    expect(mockUnzipGetFile).toHaveBeenCalled()
    expect(mockUploadFile).toHaveBeenCalledWith(
      expect.objectContaining({
        url: '/v1/bookmark/import',
        query: expect.objectContaining({ type: 'omnivore' })
      })
    )
    document.body.removeChild(input)
  })

  it('importThirdPartyData files 为空 → 早退（不调 unzipGetFile）', async () => {
    const wrapper = mountSection()
    const setup: any = (wrapper.vm as any).$.setupState

    const input = document.createElement('input')
    input.type = 'file'
    input.id = 'file'
    document.body.appendChild(input)
    Object.defineProperty(input, 'files', { value: [] })

    await setup.importThirdPartyData('omnivore', input.files?.[0])
    await flushPromises()
    expect(mockUnzipGetFile).not.toHaveBeenCalled()
    document.body.removeChild(input)
  })

  it('importThirdPartyData type 未知 → Toast 提示 + 早退', async () => {
    const wrapper = mountSection()
    const setup: any = (wrapper.vm as any).$.setupState

    const input = document.createElement('input')
    input.type = 'file'
    input.id = 'file'
    document.body.appendChild(input)
    Object.defineProperty(input, 'files', { value: [new File(['x'], 'x.zip')] })

    await setup.importThirdPartyData('unknown_type', input.files?.[0])
    await flushPromises()
    expect(mockToastShowToast).toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining('unknown_type') }))
    document.body.removeChild(input)
  })

  it('importThirdPartyData unzip 返 null → Toast 提示', async () => {
    mockUnzipGetFile.mockResolvedValueOnce(null as any)
    const wrapper = mountSection()
    const setup: any = (wrapper.vm as any).$.setupState

    const input = document.createElement('input')
    input.type = 'file'
    input.id = 'file'
    document.body.appendChild(input)
    Object.defineProperty(input, 'files', { value: [new File(['x'], 'x.zip')] })

    await setup.importThirdPartyData('omnivore', input.files?.[0])
    await flushPromises()
    expect(mockToastShowToast).toHaveBeenCalled()
    expect(mockUploadFile).not.toHaveBeenCalled()
    document.body.removeChild(input)
  })

  it('importThirdPartyData pocket → 走 part_*.csv 正则', async () => {
    const fakeFile = new File(['csv'], 'part_1.csv', { type: 'text/csv' })
    mockUnzipGetFile.mockResolvedValueOnce([fakeFile])
    const wrapper = mountSection()
    const setup: any = (wrapper.vm as any).$.setupState

    const input = document.createElement('input')
    input.type = 'file'
    input.id = 'file'
    document.body.appendChild(input)
    Object.defineProperty(input, 'files', { value: [new File(['x'], 'pocket.zip')] })

    await setup.importThirdPartyData('pocket', input.files?.[0])
    await flushPromises()
    expect(mockUploadFile).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({ type: 'pocket' })
      })
    )
    document.body.removeChild(input)
  })

  it('previews a selected Readwise file without starting an import', async () => {
    mockUploadFile.mockResolvedValueOnce({
      eligible_count: 2,
      excluded_feed_count: 10,
      duplicate_count: 1,
      invalid_row_count: 0,
      invalid_date_count: 0,
      preview: [{ target_url: 'https://example.com', target_title: 'Sample' }]
    })
    const wrapper = mountSection()
    const setup = (wrapper.vm as any).$.setupState
    setup.chooseFile('readwise')
    const input = document.querySelector('input[type=file]') as HTMLInputElement
    expect(input.accept).toBe('.csv')
    Object.defineProperty(input, 'files', { value: [new File(['csv'], 'reader.csv')] })
    input.dispatchEvent(new Event('change'))
    await flushPromises()
    expect(mockUploadFile).toHaveBeenCalledTimes(1)
    expect(mockUploadFile).toHaveBeenCalledWith(expect.objectContaining({ url: '/v1/bookmark/import_preview', query: expect.objectContaining({ include_feed: 'false' }) }))
    // The preview lives in the modal, not in the settings card
    expect(wrapper.find('.import-preview').exists()).toBe(false)
    const modal = wrapper.findComponent({ name: 'ImportPreviewModal' })
    expect(modal.exists()).toBe(true)
    expect(modal.props('fileName')).toBe('reader.csv')
    expect(modal.props('sourceType')).toBe('readwise')
    expect(modal.props('preview').preview[0].target_title).toBe('Sample')
    expect(document.body.contains(input)).toBe(false)
    wrapper.unmount()
  })

  it('closing the preview modal drops the selection; changing the feed option reloads the preview', async () => {
    mockUploadFile.mockResolvedValue({ eligible_count: 1, excluded_feed_count: 0, duplicate_count: 0, invalid_row_count: 0, invalid_date_count: 0, preview: [] })
    const wrapper = mountSection()
    const setup = (wrapper.vm as any).$.setupState
    setup.chooseFile('readwise')
    const input = document.querySelector('input[type=file]') as HTMLInputElement
    Object.defineProperty(input, 'files', { value: [new File(['csv'], 'reader.csv')] })
    input.dispatchEvent(new Event('change'))
    await flushPromises()
    const modal = wrapper.findComponent({ name: 'ImportPreviewModal' })
    await modal.vm.$emit('update:includeFeed', true)
    await flushPromises()
    expect(mockUploadFile).toHaveBeenLastCalledWith(expect.objectContaining({ query: expect.objectContaining({ include_feed: 'true' }) }))
    await modal.vm.$emit('close')
    expect(wrapper.findComponent({ name: 'ImportPreviewModal' }).exists()).toBe(false)
    expect(setup.selectedFile).toBeUndefined()
    expect(setup.preview).toBeUndefined()
    wrapper.unmount()
  })

  it('a failed upload brings the confirmation modal back with the error so start can be retried', async () => {
    const wrapper = mountSection()
    const setup = (wrapper.vm as any).$.setupState
    setup.selectedFile = new File(['csv'], 'reader.csv')
    setup.selectedType = 'readwise'
    setup.preview = { eligible_count: 2, preview: [] }
    setup.showPreviewModal = true
    mockUploadFile.mockRejectedValueOnce(new Error('network'))
    await setup.startImport()
    await flushPromises()
    expect(setup.showPreviewModal).toBe(true)
    expect(setup.selectedFile).toBeDefined()
    const modal = wrapper.findComponent({ name: 'ImportPreviewModal' })
    expect(modal.exists()).toBe(true)
    expect(modal.props('errorText')).toBeTruthy()
    expect(wrapper.find('[role=alert]').exists()).toBe(false)
    // Retry succeeds: selection cleared, modal gone
    await modal.vm.$emit('start')
    await flushPromises()
    expect(setup.selectedFile).toBeUndefined()
    expect(wrapper.findComponent({ name: 'ImportPreviewModal' }).exists()).toBe(false)
    wrapper.unmount()
  })

  it('a preview error shows inside the modal, not under the buttons', async () => {
    mockUploadFile.mockRejectedValueOnce(new Error('network'))
    const wrapper = mountSection()
    const setup = (wrapper.vm as any).$.setupState
    setup.chooseFile('pinboard')
    const input = document.querySelector('input[type=file]') as HTMLInputElement
    Object.defineProperty(input, 'files', { value: [new File(['[]'], 'pinboard.json')] })
    input.dispatchEvent(new Event('change'))
    await flushPromises()
    expect(wrapper.findComponent({ name: 'ImportPreviewModal' }).props('errorText')).toBeTruthy()
    expect(wrapper.find('[role=alert]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('starts only after preview and sends the selected feed option', async () => {
    const wrapper = mountSection()
    const setup = (wrapper.vm as any).$.setupState
    setup.selectedFile = new File(['csv'], 'reader.csv')
    setup.selectedType = 'readwise'
    await setup.startImport()
    expect(mockUploadFile).not.toHaveBeenCalled()
    setup.includeFeed = true
    setup.preview = { eligible_count: 2, preview: [] }
    setup.showPreviewModal = true
    await setup.startImport()
    // The confirmation modal closes as the upload starts so the upload modal is visible
    expect(setup.showPreviewModal).toBe(false)
    expect(mockUploadFile).toHaveBeenCalledWith(
      expect.objectContaining({ url: '/v1/bookmark/import', query: expect.objectContaining({ type: 'readwise', include_feed: 'true', file_type: 'text/csv' }) })
    )
    expect(mockUnzipGetFile).not.toHaveBeenCalled()
    expect(setup.showImportLoadingModal).toBe(false)
    expect(setup.importProgress).toBe(100)
    wrapper.unmount()
  })

  it('clears stale preview and shows a recoverable preview error', async () => {
    const wrapper = mountSection()
    const setup = (wrapper.vm as any).$.setupState
    setup.selectedFile = new File(['csv'], 'reader.csv')
    setup.selectedType = 'readwise'
    setup.preview = { eligible_count: 1, preview: [] }
    mockUploadFile.mockRejectedValueOnce(new Error('network'))
    await setup.loadPreview()
    expect(setup.preview).toBeUndefined()
    expect(setup.busy).toBe(false)
    expect(wrapper.find('[role=alert]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('closes loading on failed upload or empty archive', async () => {
    const wrapper = mountSection()
    const setup = (wrapper.vm as any).$.setupState
    mockUploadFile.mockRejectedValueOnce(new Error('network'))
    await setup.importThirdPartyData('pinboard', new File(['[]'], 'pinboard.json'))
    expect(setup.showImportLoadingModal).toBe(false)
    expect(setup.busy).toBe(false)
    expect(setup.errorText).toBeTruthy()
    await setup.importThirdPartyData('pocket', new File(['zip'], 'pocket.zip'))
    expect(setup.showImportLoadingModal).toBe(false)
    expect(mockToastShowToast).toHaveBeenCalled()
    wrapper.unmount()
  })

  it('removes file input on cancellation and rejects oversized files before preview', async () => {
    const wrapper = mountSection()
    const setup = (wrapper.vm as any).$.setupState
    setup.chooseFile('pinboard')
    let input = document.querySelector('input[type=file]') as HTMLInputElement
    input.dispatchEvent(new Event('cancel'))
    expect(document.body.contains(input)).toBe(false)
    setup.chooseFile('pinboard')
    input = document.querySelector('input[type=file]') as HTMLInputElement
    const file = new File(['[]'], 'pinboard.json')
    Object.defineProperty(file, 'size', { value: 26 * 1024 * 1024 })
    Object.defineProperty(input, 'files', { value: [file] })
    input.dispatchEvent(new Event('change'))
    await flushPromises()
    expect(mockUploadFile).not.toHaveBeenCalled()
    expect(setup.errorText).toBeTruthy()
    wrapper.unmount()
  })

  it('treats a finished upload as submitted and leaves the crawl to the background', async () => {
    const wrapper = mountSection()
    const setup = (wrapper.vm as any).$.setupState
    await flushPromises()
    expect(mockGet).toHaveBeenCalledTimes(1)
    setup.selectedFile = new File(['csv'], 'reader.csv')
    setup.selectedType = 'readwise'
    setup.preview = { eligible_count: 2, preview: [] }
    mockGet.mockResolvedValueOnce([processingTask(1, 0)])
    await setup.startImport()
    await flushPromises()
    expect(mockToastShowToast).toHaveBeenCalledWith({ text: expect.stringContaining('2 bookmarks are importing in the background') })
    expect(setup.showImportProgressModal).toBe(false)
    expect(setup.selectedFile).toBeUndefined()
    expect(mockGet).toHaveBeenCalledTimes(2)
    expect(wrapper.find('.import-active').text()).toContain('1 imports in progress')
    wrapper.unmount()
  })

  it('uses the no-count message for archives that have no preview', async () => {
    mockUnzipGetFile.mockResolvedValueOnce([new File(['[]'], 'metadata_1_to_20.json')])
    const wrapper = mountSection()
    const setup = (wrapper.vm as any).$.setupState
    await setup.importThirdPartyData('omnivore', new File(['zip'], 'archive.zip'))
    expect(mockToastShowToast).toHaveBeenCalledWith({ text: expect.stringContaining('Your bookmarks are importing in the background') })
    wrapper.unmount()
  })

  it('explains the limit when the backend rejects with TOO_MANY_IMPORT_TASKS', async () => {
    const wrapper = mountSection()
    const setup = (wrapper.vm as any).$.setupState
    mockUploadFile.mockRejectedValueOnce(new RequestError({ message: 'too many', name: 'TOO_MANY_IMPORT_TASKS', code: 400 }))
    await setup.importThirdPartyData('pinboard', new File(['[]'], 'pinboard.json'))
    expect(wrapper.find('[role=alert]').text()).toContain('Up to 5 imports')
    expect(setup.busy).toBe(false)
    wrapper.unmount()
  })

  it('stops the file picker while five imports are already running', async () => {
    mockGet.mockResolvedValueOnce([1, 2, 3, 4, 5].map(id => processingTask(id)))
    const wrapper = mountSection()
    await flushPromises()
    expect(wrapper.find('.import-active').text()).toContain('5 imports in progress')
    expect(wrapper.find('.import-active').text()).toContain('Up to 5 imports')
    const setup = (wrapper.vm as any).$.setupState
    setup.chooseFile('pinboard')
    expect(document.querySelector('input[type=file]')).toBeNull()
    expect(setup.errorText).toContain('Up to 5 imports')
    wrapper.unmount()
  })

  it('polls the task list while imports run and stops once they finish', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    mockGet.mockResolvedValueOnce([processingTask(1)])
    const wrapper = mountSection()
    await flushPromises()
    expect(mockGet).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(15000)
    await flushPromises()
    expect(mockGet).toHaveBeenCalledTimes(2)
    expect(wrapper.find('.import-active').exists()).toBe(false)
    vi.advanceTimersByTime(15000)
    await flushPromises()
    expect(mockGet).toHaveBeenCalledTimes(2)
    wrapper.unmount()
  })

  it('combines archive parts into one upload', async () => {
    mockUnzipGetFile.mockResolvedValueOnce([
      new File(['[{"url":"https://example.com/a"}]'], 'metadata_1_to_20.json'),
      new File(['[{"url":"https://example.com/b"}]'], 'metadata_21_to_40.json')
    ])
    const wrapper = mountSection()
    const setup = (wrapper.vm as any).$.setupState
    await setup.importThirdPartyData('omnivore', new File(['zip'], 'archive.zip'))
    expect(mockUploadFile).toHaveBeenCalledTimes(1)
    const sent = mockUploadFile.mock.calls[0]![0] as any
    expect(JSON.parse(await sent.fileContent.text())).toHaveLength(2)
    wrapper.unmount()
  })
})
