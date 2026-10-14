import UserExportSection from '~/components/UserExportSection.vue'

import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { mountWithApp } from '~~/tests/setup/mount'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { get, analytics, download, prepare } = vi.hoisted(() => ({ get: vi.fn(), analytics: vi.fn(), download: vi.fn(), prepare: vi.fn() }))
mockNuxtImport('request', () => () => ({ get }))
mockNuxtImport('analyticsLog', () => analytics)
vi.mock('~/utils/bookmarkExport', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  prepareBookmarkExport: prepare,
  downloadBookmarkExport: download
}))

const wrappers: ReturnType<typeof mountWithApp>[] = []
const mountSection = () => {
  const wrapper = mountWithApp(UserExportSection)
  wrappers.push(wrapper)
  return wrapper
}

describe('saved-link export Settings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prepare.mockReset()
  })
  afterEach(() => {
    wrappers.splice(0).forEach(wrapper => wrapper.unmount())
  })
  it('defaults to CSV, blocks duplicate clicks, reports progress and downloads only on success', async () => {
    let complete!: (result: { count: number; blob: Blob }) => void
    prepare.mockImplementationOnce(options => {
      options.onProgress(500)
      return new Promise(resolve => {
        complete = resolve
      })
    })
    const wrapper = mountSection()
    expect(wrapper.find('select').element.value).toBe('csv')
    await wrapper.find('button').trigger('click')
    await wrapper.find('button').trigger('click')
    expect(prepare).toHaveBeenCalledTimes(1)
    expect(wrapper.find('[role="status"]').text()).toContain('500')
    expect(download).not.toHaveBeenCalled()
    const args = prepare.mock.calls[0]![0]
    await args.fetchPage('opaque', args.signal)
    expect(get).toHaveBeenCalledWith(expect.objectContaining({ url: '/v1/bookmark/export', query: { cursor: 'opaque' }, signal: args.signal }))
    complete({ count: 500, blob: new Blob(['data']) })
    await flushPromises()
    expect(download).toHaveBeenCalledTimes(1)
    expect(analytics.mock.calls.map(call => call[0].event)).toEqual(['bookmark_export_start', 'bookmark_export_complete'])
    expect(Object.keys(analytics.mock.calls[1]![0]).sort()).toEqual(['duration_ms', 'event', 'format', 'item_count'])
  })
  it('provides retry after failure and clears old progress', async () => {
    prepare.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ count: 0, blob: null })
    const wrapper = mountSection()
    await wrapper.find('select').setValue('json')
    await wrapper.find('button').trigger('click')
    await flushPromises()
    expect(wrapper.find('[role="alert"]').exists()).toBe(true)
    expect(wrapper.find('button').text()).toBe('Retry')
    expect(download).not.toHaveBeenCalled()
    await wrapper.find('button').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('No saved links to export.')
    expect(prepare.mock.calls[1]![0].format).toBe('json')
    expect(download).not.toHaveBeenCalled()
  })
  it('aborts pending work on cancel and unmount, suppresses late download', async () => {
    prepare.mockImplementation(
      options =>
        new Promise((resolve, reject) => {
          options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
        })
    )
    const wrapper = mountSection()
    await wrapper.find('button').trigger('click')
    await wrapper.findAll('button')[1]!.trigger('click')
    await flushPromises()
    expect(prepare.mock.calls[0]![0].signal.aborted).toBe(true)
    expect(wrapper.text()).toContain('Export cancelled.')
    await wrapper.find('button').trigger('click')
    wrapper.unmount()
    await flushPromises()
    expect(prepare.mock.calls[1]![0].signal.aborted).toBe(true)
    expect(download).not.toHaveBeenCalled()
  })
})
