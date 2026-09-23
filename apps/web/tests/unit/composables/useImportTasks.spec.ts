// useImportTasks 单元测试
// 覆盖：refresh 排序与失败返回、activeCount / canStart 上限、轮询在没有进行中任务时自动停止
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGet, mockRequest } = vi.hoisted(() => {
  const mockGet = vi.fn((): Promise<unknown> => Promise.resolve([]))
  return { mockGet, mockRequest: vi.fn(() => ({ get: mockGet })) }
})

mockNuxtImport('request', () => mockRequest)

const task = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  type: 'pinboard',
  status: 1,
  count: 20,
  batch_count: 20,
  current_count: 5,
  success_total: 5,
  failed_total: 0,
  reason: '',
  created_at: '2026-09-10T01:00:00Z',
  ...overrides
})

describe('useImportTasks', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    mockGet.mockResolvedValue([])
    const { resetImportTasks } = await import('~~/app/composables/useImportTasks')
    resetImportTasks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('loads tasks newest first and counts the processing ones', async () => {
    mockGet.mockResolvedValueOnce([
      task({ id: 1, status: 3, created_at: '2026-09-01T00:00:00Z' }),
      task({ id: 2, status: 1, created_at: '2026-09-10T00:00:00Z' }),
      task({ id: 3, status: 1, created_at: '2026-09-05T00:00:00Z' })
    ])
    const { useImportTasks } = await import('~~/app/composables/useImportTasks')
    const store = useImportTasks()
    expect(store.loaded.value).toBe(false)
    await expect(store.refresh()).resolves.toBe(true)
    expect(mockGet).toHaveBeenCalledWith({ url: '/v1/bookmark/import_status' })
    expect(store.tasks.value.map(item => item.id)).toEqual([2, 3, 1])
    expect(store.activeCount.value).toBe(2)
    expect(store.canStart.value).toBe(true)
    expect(store.loaded.value).toBe(true)
  })

  it('reports no capacity at five processing tasks', async () => {
    mockGet.mockResolvedValueOnce(Array.from({ length: 5 }, (_, i) => task({ id: i + 1 })))
    const { MAX_ACTIVE_IMPORT_TASKS, useImportTasks } = await import('~~/app/composables/useImportTasks')
    expect(MAX_ACTIVE_IMPORT_TASKS).toBe(5)
    const store = useImportTasks()
    await store.refresh()
    expect(store.activeCount.value).toBe(5)
    expect(store.canStart.value).toBe(false)
  })

  it('returns false and keeps the old list when the request fails or is empty', async () => {
    mockGet.mockResolvedValueOnce([task()])
    const { useImportTasks } = await import('~~/app/composables/useImportTasks')
    const store = useImportTasks()
    await store.refresh()
    mockGet.mockResolvedValueOnce(null)
    await expect(store.refresh()).resolves.toBe(false)
    mockGet.mockRejectedValueOnce(new Error('network'))
    await expect(store.refresh()).resolves.toBe(false)
    expect(store.tasks.value).toHaveLength(1)
    expect(store.loading.value).toBe(false)
  })

  it('shares the list and the loaded flag between callers', async () => {
    mockGet.mockResolvedValueOnce([task()])
    const { useImportTasks } = await import('~~/app/composables/useImportTasks')
    const section = useImportTasks()
    await section.refresh()
    const modal = useImportTasks()
    expect(modal.loaded.value).toBe(true)
    expect(modal.tasks.value).toHaveLength(1)
    expect(modal.loading.value).toBe(false)
  })

  it('ignores a slow older response that lands after a newer one', async () => {
    const { useImportTasks } = await import('~~/app/composables/useImportTasks')
    const store = useImportTasks()
    let resolveSlow: (value: unknown) => void = () => undefined
    mockGet.mockImplementationOnce(() => new Promise(r => (resolveSlow = r)))
    const slow = store.refresh()
    mockGet.mockResolvedValueOnce([task({ current_count: 80 })])
    await store.refresh()
    expect(store.tasks.value[0]?.current_count).toBe(80)
    resolveSlow([task({ current_count: 60 })])
    await slow
    expect(store.tasks.value[0]?.current_count).toBe(80)
  })

  it('computes the percentage of the newest processing task', async () => {
    const { importProgressPercent } = await import('~~/app/composables/useImportTasks')
    expect(importProgressPercent(task({ current_count: 5, batch_count: 20 }))).toBe(25)
    expect(importProgressPercent(task({ current_count: 0, batch_count: 0 }))).toBe(0)
    expect(importProgressPercent(task({ current_count: 30, batch_count: 20 }))).toBe(100)
  })

  it('polls while something is processing and stops on its own when nothing is', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    mockGet.mockResolvedValueOnce([task()])
    const { useImportTasks } = await import('~~/app/composables/useImportTasks')
    const store = useImportTasks()
    await store.refresh()
    store.startPolling(1000)
    mockGet.mockResolvedValueOnce([task()])
    vi.advanceTimersByTime(1000)
    await flushPromises()
    expect(mockGet).toHaveBeenCalledTimes(2)
    mockGet.mockResolvedValueOnce([task({ status: 3 })])
    vi.advanceTimersByTime(1000)
    await flushPromises()
    expect(mockGet).toHaveBeenCalledTimes(3)
    expect(store.activeCount.value).toBe(0)
    vi.advanceTimersByTime(5000)
    await flushPromises()
    expect(mockGet).toHaveBeenCalledTimes(3)
  })

  it('stopPolling cancels a running poll and restarting replaces the old timer', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    mockGet.mockResolvedValue([task()])
    const { useImportTasks } = await import('~~/app/composables/useImportTasks')
    const store = useImportTasks()
    await store.refresh()
    store.startPolling(1000)
    store.startPolling(1000)
    vi.advanceTimersByTime(1000)
    await flushPromises()
    expect(mockGet).toHaveBeenCalledTimes(2)
    store.stopPolling()
    vi.advanceTimersByTime(3000)
    await flushPromises()
    expect(mockGet).toHaveBeenCalledTimes(2)
  })
})
