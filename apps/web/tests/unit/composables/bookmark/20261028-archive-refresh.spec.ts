// @vitest-environment happy-dom
import { defineComponent, h, KeepAlive, ref } from 'vue'

import type { ChannelMessageData } from '~/utils/channel'

import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { flushPromises, mount } from '@vue/test-utils'
import { useBookmarkData } from '~/composables/bookmark/useBookmarkData'
import type { useBookmarkFilter } from '~/composables/bookmark/useBookmarkFilter'
import { baseBookmarkItem } from '~~/tests/fixtures/bookmark'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  get: vi.fn(), token: 'session-a', handler: undefined as unknown as (name: keyof ChannelMessageData, data: Partial<ChannelMessageData>) => void,
  local: false, refresh: vi.fn(), write: vi.fn()
}))
mockNuxtImport('request', () => () => ({ get: mocks.get }))
mockNuxtImport('getUserToken', () => () => mocks.token)
mockNuxtImport('haveRequestToken', () => () => !!mocks.token)
mockNuxtImport('isLocalFirstEnabled', () => () => mocks.local)
mockNuxtImport('isHighlightLocalFirstEnabled', () => () => false)
mockNuxtImport('useNuxtApp', () => () => ({ $powersync: mocks.local ? {} : null }))
mockNuxtImport('useI18n', () => () => ({ t: (key: string) => key, locale: ref('en') }))
mockNuxtImport('useState', () => (_key: string, init: () => unknown) => ref(init()))
mockNuxtImport('addChannelMessageHandler', () => (handler: typeof mocks.handler) => { mocks.handler = handler })
mockNuxtImport('removeChannelMessageHandler', () => vi.fn())
vi.mock('~/composables/useAccountContext', () => ({
  useAccountContext: () => ({ accountKey: ref('account-a'), context: ref({ serverUserId: 1 }) })
}))
vi.mock('@powersync/vue', () => ({ useStatus: () => ref({ hasSynced: true }) }))
vi.mock('~/composables/bookmark/useLocalCollections', () => ({ useLocalCollections: () => ({ watchCollectionBookmarks: () => ({ items: ref([]) }) }) }))
vi.mock('~/composables/bookmark/useLocalBookmarks', () => ({
  useLocalBookmarks: () => ({
    watchList: () => ({ items: ref([]), isLoading: ref(false), isFetching: ref(false), error: ref(null), refresh: mocks.refresh }),
    watchUserTags: () => ({ tags: ref([]) }), setArchive: mocks.write
  })
}))
vi.mock('@vueuse/core', async () => ({
  ...await vi.importActual<typeof import('@vueuse/core')>('@vueuse/core'),
  useInfiniteScroll: (_target: unknown, callback: () => unknown) => {
    Promise.resolve().then(callback)
    return { reset: vi.fn() }
  }
}))

const row = (id: number) => ({ ...baseBookmarkItem, id, bookmark_user_uuid: `uuid-${id}` })
const wrappers: Array<{ unmount(): void }> = []
const mountList = (status = 'inbox') => {
  const filter = { filterStatus: ref(status), filterTopicIds: ref([]), filterCollectionId: ref(0) } as unknown as ReturnType<typeof useBookmarkFilter>
  let api!: ReturnType<typeof useBookmarkData>
  wrappers.push(mount(defineComponent({ setup() { api = useBookmarkData(filter, ref('')); return () => null } })))
  return { filter, get api() { return api } }
}
const settle = async () => { await new Promise(resolve => setTimeout(resolve, 150)); await flushPromises() }
const archive = (accountKey = 'account-a') => mocks.handler('bookmarkArchive', { bookmarkArchive: { accountKey, uuid: 'uuid-1', archived: true } })

describe('archive list recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.token = 'session-a'
    mocks.local = false
    mocks.get.mockReset().mockResolvedValue([])
    mocks.refresh.mockResolvedValue(undefined)
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
  })
  afterEach(() => { wrappers.splice(0).forEach(wrapper => wrapper.unmount()) })

  it('removes an archived UUID and refreshes every loaded page without clearing remaining rows', async () => {
    mocks.get.mockResolvedValueOnce([row(1), row(2)]).mockResolvedValueOnce([row(3)])
    const { api } = mountList()
    await flushPromises()
    await api.onLoadMore()
    let finish!: (rows: unknown[]) => void
    mocks.get.mockReturnValueOnce(new Promise(resolve => { finish = resolve })).mockResolvedValueOnce([row(4)])
    archive()
    await settle()
    expect(api.bookmarks.value.map(item => item.id)).toEqual([2, 3])
    finish([row(2), row(3)])
    await flushPromises()
    expect(api.bookmarks.value.map(item => item.id)).toEqual([2, 3, 4])
    expect(mocks.get.mock.calls.slice(2).map(([options]) => options.query.page)).toEqual([1, 2])
    await api.onLoadMore()
    expect(mocks.get.mock.lastCall?.[0].query.page).toBe(3)
  })

  it('recovers a missed message on foreground return and combines duplicate events', async () => {
    mocks.get.mockResolvedValueOnce([row(1)]).mockResolvedValueOnce([row(2)])
    const { api } = mountList()
    await flushPromises()
    window.dispatchEvent(new Event('focus'))
    document.dispatchEvent(new Event('visibilitychange'))
    await settle()
    expect(api.bookmarks.value.map(item => item.id)).toEqual([2])
    expect(mocks.get).toHaveBeenCalledTimes(2)
  })

  it('ignores another account and refreshes local queries without writing archive state', async () => {
    mocks.local = true
    mountList()
    await flushPromises()
    archive('account-b')
    await settle()
    expect(mocks.refresh).not.toHaveBeenCalled()
    archive()
    await settle()
    expect(mocks.refresh).toHaveBeenCalledTimes(1)
    expect(mocks.write).not.toHaveBeenCalled()
    expect(mocks.get).not.toHaveBeenCalled()
  })

  it('keeps rows after a failed refresh and retries on the next foreground event', async () => {
    mocks.get.mockResolvedValueOnce([row(1)]).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([row(2)])
    const { api } = mountList()
    await flushPromises()
    window.dispatchEvent(new Event('focus'))
    await settle()
    expect(api.bookmarks.value.map(item => item.id)).toEqual([1])
    window.dispatchEvent(new Event('focus'))
    await settle()
    expect(api.bookmarks.value.map(item => item.id)).toEqual([2])
  })

  it.each(['account', 'filter', 'unmount'])('rejects a response after %s changes', async reason => {
    mocks.get.mockResolvedValueOnce([row(1)])
    const { api, filter } = mountList()
    await flushPromises()
    let finish!: (rows: unknown[]) => void
    mocks.get.mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
    window.dispatchEvent(new Event('focus'))
    await settle()
    if (reason === 'account') mocks.token = 'session-b'
    if (reason === 'filter') filter.filterStatus.value = 'archive'
    if (reason === 'unmount') wrappers.pop()?.unmount()
    finish([row(2)])
    await flushPromises()
    expect(api.bookmarks.value.map(item => item.id)).toEqual([1])
  })

  it('restores Inbox membership after unarchive and rejects malformed messages', async () => {
    mocks.get.mockResolvedValueOnce([row(2)]).mockResolvedValueOnce([row(1), row(2)])
    const { api } = mountList()
    await flushPromises()
    mocks.handler('bookmarkArchive', { bookmarkArchive: { uuid: 'uuid-1', archived: false } as ChannelMessageData['bookmarkArchive'] })
    await settle()
    expect(mocks.get).toHaveBeenCalledTimes(1)
    mocks.handler('bookmarkArchive', { bookmarkArchive: { accountKey: 'account-a', uuid: 'uuid-1', archived: false } })
    await settle()
    expect(api.bookmarks.value.map(item => item.id)).toEqual([1, 2])
  })

  it('retains invalidation during an in-flight refresh and applies only the newer response', async () => {
    mocks.get.mockResolvedValueOnce([row(1), row(2)])
    const { api } = mountList()
    await flushPromises()
    let finish!: (rows: unknown[]) => void
    mocks.get.mockReturnValueOnce(new Promise(resolve => { finish = resolve })).mockResolvedValueOnce([row(2)])
    window.dispatchEvent(new Event('focus'))
    await settle()
    archive()
    finish([row(1), row(2)])
    await flushPromises()
    expect(api.bookmarks.value.map(item => item.id)).toEqual([2])
    await settle()
    expect(api.bookmarks.value.map(item => item.id)).toEqual([2])
    expect(mocks.get).toHaveBeenCalledTimes(3)
  })

  it('defers a hidden-tab notification until the tab becomes visible', async () => {
    mocks.get.mockResolvedValueOnce([row(1)]).mockResolvedValueOnce([row(2)])
    const { api } = mountList()
    await flushPromises()
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
    archive()
    await settle()
    expect(mocks.get).toHaveBeenCalledTimes(1)
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    document.dispatchEvent(new Event('visibilitychange'))
    await settle()
    expect(api.bookmarks.value.map(item => item.id)).toEqual([2])
  })

  it('loads a new filter while an obsolete refresh remains pending', async () => {
    mocks.get.mockResolvedValueOnce([row(1)])
    const { api, filter } = mountList()
    await flushPromises()
    let finish!: (rows: unknown[]) => void
    mocks.get.mockReturnValueOnce(new Promise(resolve => { finish = resolve })).mockResolvedValueOnce([row(3)])
    window.dispatchEvent(new Event('focus'))
    await settle()
    filter.filterStatus.value = 'archive'
    api.reloadList()
    await flushPromises()
    expect(api.bookmarks.value.map(item => item.id)).toEqual([3])
    finish([row(2)])
    await flushPromises()
    expect(api.bookmarks.value.map(item => item.id)).toEqual([3])
  })

  it('rechecks a new foreground return during an earlier refresh', async () => {
    mocks.get.mockResolvedValueOnce([row(1)])
    const { api } = mountList()
    await flushPromises()
    let finish!: (rows: unknown[]) => void
    mocks.get.mockReturnValueOnce(new Promise(resolve => { finish = resolve })).mockResolvedValueOnce([row(2)])
    window.dispatchEvent(new Event('focus'))
    await settle()
    document.dispatchEvent(new Event('visibilitychange'))
    finish([row(1)])
    await settle()
    expect(api.bookmarks.value.map(item => item.id)).toEqual([2])
  })

  it('does not restore a row archived from the list during a refresh', async () => {
    mocks.get.mockResolvedValueOnce([row(1), row(2)])
    const { api } = mountList()
    await flushPromises()
    let finish!: (rows: unknown[]) => void
    mocks.get.mockReturnValueOnce(new Promise(resolve => { finish = resolve })).mockResolvedValueOnce([row(2)])
    window.dispatchEvent(new Event('focus'))
    await settle()
    api.handleCellArchive(1, true)
    finish([row(1), row(2)])
    await settle()
    expect(api.bookmarks.value.map(item => item.id)).toEqual([2])
  })

  it('does not invalidate a highlight request when another tab archives a bookmark', async () => {
    let finish!: (rows: unknown[]) => void
    mocks.get.mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
    const { api } = mountList('highlights')
    await flushPromises()
    archive()
    finish([{ id: 'highlight-1' }])
    await settle()
    expect(api.highlights.value).toHaveLength(1)
    expect(mocks.get).toHaveBeenCalledTimes(1)
  })

  it.each(['delete', 'title', 'star'])('preserves a concurrent %s action during foreground refresh', async action => {
    mocks.get.mockResolvedValueOnce([row(1)])
    const { api } = mountList()
    await flushPromises()
    let finish!: (rows: unknown[]) => void
    const updated = { ...row(1), alias_title: 'Updated title', starred: 'star' as const }
    mocks.get.mockReturnValueOnce(new Promise(resolve => { finish = resolve })).mockResolvedValueOnce(action === 'delete' ? [] : [updated])
    window.dispatchEvent(new Event('focus'))
    await settle()
    if (action === 'delete') await api.handleDelete(1)
    if (action === 'title') api.handleCellAliasTitle(1, updated.alias_title)
    if (action === 'star') api.handleCellBookmarkUpdate(1, updated)
    finish([row(1)])
    await flushPromises()
    if (action === 'delete') expect(api.bookmarks.value).toHaveLength(0)
    if (action === 'title') expect(api.bookmarks.value[0]?.alias_title).toBe(updated.alias_title)
    if (action === 'star') expect(api.bookmarks.value[0]?.starred).toBe('star')
    await settle()
    expect(api.bookmarks.value).toEqual(action === 'delete' ? [] : [updated])
  })

  it('refreshes a cached list after same-tab navigation', async () => {
    mocks.get.mockResolvedValueOnce([row(1)]).mockResolvedValueOnce([row(2)])
    const shown = ref(true)
    let api!: ReturnType<typeof useBookmarkData>
    const List = defineComponent({ setup() {
      api = useBookmarkData({ filterStatus: ref('inbox'), filterTopicIds: ref([]), filterCollectionId: ref(0) } as unknown as ReturnType<typeof useBookmarkFilter>, ref(''))
      return () => null
    } })
    wrappers.push(mount(defineComponent({ setup: () => () => h(KeepAlive, () => shown.value ? h(List) : null) })))
    await flushPromises()
    shown.value = false
    await flushPromises()
    window.dispatchEvent(new Event('focus'))
    await settle()
    expect(mocks.get).toHaveBeenCalledTimes(1)
    shown.value = true
    await settle()
    expect(api.bookmarks.value.map(item => item.id)).toEqual([2])
  })
})
