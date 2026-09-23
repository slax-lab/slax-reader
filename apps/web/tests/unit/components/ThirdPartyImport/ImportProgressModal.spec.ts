import { ref } from 'vue'

import ImportProgressModal from '~~/app/components/ThirdPartyImport/ImportProgressModal.vue'

import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { resetImportTasks, useImportTasks } from '~~/app/composables/useImportTasks'
import { mountWithApp } from '~~/tests/setup/mount'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@vueuse/core', async () => {
  const actual = await vi.importActual<any>('@vueuse/core')
  return {
    ...actual,
    useScrollLock: () => ref(false)
  }
})

const { mockRequest, mockGet, mockToastShowToast } = vi.hoisted(() => {
  const mockGet = vi.fn((): Promise<unknown> => Promise.resolve([]))
  return {
    mockGet,
    mockRequest: vi.fn(() => ({ get: mockGet })),
    mockToastShowToast: vi.fn()
  }
})

mockNuxtImport('request', () => mockRequest)

vi.mock('~/components/Toast', () => ({
  default: { showToast: mockToastShowToast },
  ToastType: { Success: 'success', Error: 'error' }
}))

const baseItem = {
  id: 1,
  type: 'omnivore',
  status: 1,
  count: 100,
  current_count: 30,
  batch_count: 100,
  created_at: '2026-01-01T10:00:00Z'
}

const mountProgress = async (items: unknown[] = []) => {
  mockGet.mockResolvedValueOnce(items)
  const wrapper = mountWithApp(ImportProgressModal, { attachTo: document.body })
  await flushPromises()
  return wrapper
}

describe('ThirdPartyImport/ImportProgressModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGet.mockResolvedValue([])
    resetImportTasks()
  })

  it('opens with the rows the settings section already loaded, then refreshes them', async () => {
    mockGet.mockResolvedValueOnce([baseItem])
    await useImportTasks().refresh()
    let resolve: (value: unknown[]) => void = () => undefined
    mockGet.mockImplementationOnce(
      () =>
        new Promise(r => {
          resolve = r
        })
    )
    const wrapper = mountWithApp(ImportProgressModal, { attachTo: document.body })
    await wrapper.vm.$nextTick()
    // Rows already cached: show the table, no spinner
    expect(document.querySelector('.loading-container')).toBeNull()
    expect(document.querySelectorAll('.table-body .table-row')).toHaveLength(1)
    resolve([{ ...baseItem, current_count: 60 }])
    await flushPromises()
    expect(document.querySelector('.table-body .status span')?.textContent).toBe('Processing (60%)')
    wrapper.unmount()
  })

  it('keeps the table on screen while a poll is in flight', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    try {
      mockGet.mockResolvedValueOnce([baseItem])
      const wrapper = mountWithApp(ImportProgressModal, { attachTo: document.body })
      await flushPromises()
      mockGet.mockImplementationOnce(() => new Promise(() => {}))
      vi.advanceTimersByTime(5000)
      await wrapper.vm.$nextTick()
      expect(mockGet).toHaveBeenCalledTimes(2)
      expect(document.querySelector('.loading-container')).toBeNull()
      expect(document.querySelector('.progress-table')).not.toBeNull()
      wrapper.unmount()
    } finally {
      vi.useRealTimers()
    }
  })

  it('falls back to the empty table, not a stuck spinner, when the first load fails', async () => {
    mockGet.mockResolvedValueOnce(null)
    const wrapper = mountWithApp(ImportProgressModal, { attachTo: document.body })
    await flushPromises()
    expect(document.querySelector('.loading-container')).toBeNull()
    expect(document.querySelector('.progress-table')).not.toBeNull()
    expect(mockToastShowToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }))
    wrapper.unmount()
  })

  it('still toasts when the refresh on open fails but cached rows exist', async () => {
    mockGet.mockResolvedValueOnce([baseItem])
    await useImportTasks().refresh()
    mockGet.mockRejectedValueOnce(new Error('network'))
    const wrapper = mountWithApp(ImportProgressModal, { attachTo: document.body })
    await flushPromises()
    expect(mockToastShowToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }))
    expect(document.querySelectorAll('.table-body .table-row')).toHaveLength(1)
    wrapper.unmount()
  })

  it('does not toast when a later poll fails but rows are already shown', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    try {
      mockGet.mockResolvedValueOnce([baseItem])
      const wrapper = mountWithApp(ImportProgressModal, { attachTo: document.body })
      await flushPromises()
      mockGet.mockRejectedValueOnce(new Error('network'))
      vi.advanceTimersByTime(5000)
      await flushPromises()
      expect(mockToastShowToast).not.toHaveBeenCalled()
      expect(document.querySelectorAll('.table-body .table-row')).toHaveLength(1)
      wrapper.unmount()
    } finally {
      vi.useRealTimers()
    }
  })

  it('loads and renders progress rows', async () => {
    const wrapper = await mountProgress([baseItem])
    expect(document.querySelector('.modal-overlay')).not.toBeNull()
    expect(document.querySelector('.progress-table')).not.toBeNull()
    expect(document.querySelectorAll('.table-row').length).toBeGreaterThanOrEqual(2)
    wrapper.unmount()
  })

  it('shows loading until the progress request resolves', async () => {
    let resolve: (value: unknown[]) => void = () => undefined
    mockGet.mockImplementationOnce(
      () =>
        new Promise(r => {
          resolve = r
        })
    )
    const wrapper = mountWithApp(ImportProgressModal, { attachTo: document.body })
    await wrapper.vm.$nextTick()
    expect(document.querySelector('.loading-container')).not.toBeNull()
    resolve([])
    await flushPromises()
    wrapper.unmount()
  })

  it('shows a toast when progress cannot be loaded', async () => {
    mockGet.mockResolvedValueOnce(null)
    const wrapper = mountWithApp(ImportProgressModal)
    await flushPromises()
    expect(mockToastShowToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }))
    wrapper.unmount()
  })

  it('emits close from the close button and overlay', async () => {
    const wrapper = await mountProgress()
    ;(document.querySelector('button.close-btn') as HTMLElement).click()
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('close')).toHaveLength(1)
    ;(document.querySelector('.modal-overlay') as HTMLElement).click()
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('close')).toHaveLength(2)
    wrapper.unmount()
  })

  it.each([
    [0, 'status-pending', 'Pending'],
    [1, 'status-processing', 'Processing (30%)'],
    [2, 'status-failed', 'Failed'],
    [3, 'status-complete', 'Complete']
  ])('renders status %s', async (status, className, text) => {
    const wrapper = await mountProgress([{ ...baseItem, status }])
    const statusSpan = document.querySelector('.table-body .status span') as HTMLElement
    expect(statusSpan.className).toContain(className)
    expect(statusSpan.textContent).toBe(text)
    wrapper.unmount()
  })

  it.each([
    ['omnivore', 'omnivore'],
    ['pocket', 'pocket']
  ])('keeps the %s icon', async (type, iconName) => {
    const wrapper = await mountProgress([{ ...baseItem, type }])
    const img = document.querySelector('.table-body .platform img') as HTMLImageElement
    expect(img.src).toContain(iconName)
    wrapper.unmount()
  })

  it.each([
    ['pinboard', 'Pinboard'],
    ['readwise', 'Readwise Reader'],
    ['instapaper', 'Instapaper']
  ])('shows %s by product name without a broken icon', async (type, productName) => {
    const wrapper = await mountProgress([{ ...baseItem, type }])
    const platform = document.querySelector('.table-body .platform') as HTMLElement
    expect(platform.textContent).toBe(productName)
    expect(platform.querySelector('img')).toBeNull()
    wrapper.unmount()
  })

  it('renders the imported count', async () => {
    const wrapper = await mountProgress([{ ...baseItem, count: 42 }])
    expect(document.querySelector('.table-body .count')?.textContent).toBe('42')
    wrapper.unmount()
  })

  it('lists newest tasks first with a progress bar on processing rows', async () => {
    const wrapper = await mountProgress([
      { ...baseItem, id: 1, status: 3, created_at: '2026-09-01T10:00:00Z' },
      { ...baseItem, id: 2, status: 1, created_at: '2026-09-10T10:00:00Z' }
    ])
    const rows = document.querySelectorAll('.table-body .table-row')
    expect(rows[0]?.querySelector('.status .progress-bar')).not.toBeNull()
    expect(rows[0]?.querySelector('.status .progress-bar i')?.getAttribute('style')).toContain('width: 30%')
    expect(rows[1]?.querySelector('.status .progress-bar')).toBeNull()
    wrapper.unmount()
  })

  it('refreshes every 5 seconds while a task is processing and stops when closed', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    try {
      mockGet.mockResolvedValue([baseItem])
      const wrapper = mountWithApp(ImportProgressModal, { attachTo: document.body })
      await flushPromises()
      expect(mockGet).toHaveBeenCalledTimes(1)
      vi.advanceTimersByTime(5000)
      await flushPromises()
      expect(mockGet).toHaveBeenCalledTimes(2)
      wrapper.unmount()
      vi.advanceTimersByTime(5000)
      await flushPromises()
      expect(mockGet).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })
})
