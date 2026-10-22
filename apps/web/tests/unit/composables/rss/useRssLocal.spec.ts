import { computed, effectScope, reactive, ref } from 'vue'

import { RequestError } from '@commons/frontend-utils/request'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let labs: any, user: any, database: any
const owned = ref(true)
const { get, post, mockRequest, mockUseQuery, tables } = vi.hoisted(() => {
  const get = vi.fn()
  const post = vi.fn()
  const tables: Record<'subscriptions' | 'entries' | 'saved' | 'present', { value: any[] }> = {} as any
  return {
    get,
    post,
    tables,
    mockRequest: vi.fn(() => ({ get, post })),
    mockUseQuery: vi.fn((sql: { value: string }) => {
      const data = ref<any[]>([])
      const key = sql.value.includes('AS present')
        ? 'present'
        : sql.value.includes('FROM sr_rss_entry')
          ? 'entries'
          : sql.value.includes('FROM sr_user_bookmark')
            ? 'saved'
            : 'subscriptions'
      // Presence is read before useRss creates the list queries, so keep rows a test seeded ahead of time.
      if (key === 'present' && tables.present) data.value = tables.present.value
      tables[key] = data
      return { data, isLoading: ref(false), error: ref(undefined), refresh: vi.fn(async () => {}) }
    })
  }
})
mockNuxtImport('request', () => mockRequest)
vi.mock('@powersync/vue', () => ({ useQuery: mockUseQuery }))
vi.mock('~/composables/useLabFeatures', () => ({ useLabFeatures: () => labs }))
vi.mock('~/stores/user', () => ({ useUserStore: () => user }))
vi.mock('~/composables/rss/useRssLocalState', async importOriginal => ({
  ...(await importOriginal<typeof import('../../../../app/composables/rss/useRssLocalState')>()),
  rssLocalDatabase: () => database,
  rssLocalOwned: () => computed(() => owned.value)
}))

import { useRss } from '../../../../app/composables/useRss'

const deferred = () => {
  let resolve!: () => void
  const promise = new Promise<void>(r => (resolve = r))
  return { resolve, promise }
}
const createStream = () => {
  const firstSync = deferred()
  const handles: { unsubscribe: ReturnType<typeof vi.fn> }[] = []
  const subscribe = vi.fn(async () => {
    const handle = { name: 'rss_v1', parameters: null, waitForFirstSync: () => firstSync.promise, unsubscribe: vi.fn() }
    handles.push(handle)
    return handle
  })
  return { firstSync, handles, subscribe, db: { syncStream: vi.fn(() => ({ subscribe })) } }
}
const sub = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  feed_url: `https://example.com/${id}.xml`,
  title: `Feed ${id}`,
  remark: null,
  site_url: null,
  icon_url: null,
  last_checked_at: '2026-10-19 10:00:00',
  last_success_at: '2026-10-19 10:00:00',
  next_fetch_at: '2026-10-19 11:00:00',
  next_allowed_at: '2026-10-19 10:05:00',
  error: null,
  refreshing_until: null,
  ...extra
})
const row = (id: string, subscription = 'a', sortAt = '2026-10-18 11:00:00', url = `https://example.com/${id}`) => ({
  id,
  subscription_id: subscription,
  source_title: `Feed ${subscription}`,
  title: id,
  author: null,
  summary: '',
  article_url: url,
  image_url: null,
  published_at: null,
  first_seen_at: '2026-10-18 11:00:00',
  sort_at: sortAt
})
const restSub = (id: string) => ({
  id,
  feed_url: `https://example.com/${id}.xml`,
  title: `Feed ${id}`,
  remark: null,
  site_url: null,
  icon_url: null,
  refreshing: false,
  last_checked_at: null,
  last_success_at: null,
  next_fetch_at: '2026-10-19T11:00:00.000Z',
  next_allowed_at: '2026-10-19T10:05:00.000Z',
  error: null
})
const restEntry = (id: string, subscription = 'a', sortAt = '2026-10-01T00:00:00.000Z', extra: Record<string, unknown> = {}) => ({
  ...row(id, subscription),
  first_seen_at: '2026-10-01T00:00:00.000Z',
  sort_at: sortAt,
  bookmark_user_uuid: null,
  ...extra
})
const page = (items: any[], extra: Record<string, unknown> = {}) => ({ items, next_cursor: null, has_more: false, cached_more: false, history_status: 'exhausted', retry_at: null, ...extra })

const scopes: ReturnType<typeof effectScope>[] = []
let stream: ReturnType<typeof createStream>
const create = () => {
  const scope = effectScope()
  scopes.push(scope)
  return scope.run(() => useRss())!
}
const live = async () => {
  const rss = create()
  tables.subscriptions.value = [sub('a'), sub('b', { remark: 'Bee' })]
  tables.entries.value = [row('one', 'a', '2026-10-18 12:00:00'), row('two', 'b', '2026-10-18 11:00:00')]
  stream.firstSync.resolve()
  await flushPromises()
  return rss
}
beforeEach(() => {
  const enabled = ref(true)
  labs = { loaded: ref(true), isEnabled: () => enabled.value, fetch: vi.fn(), enabled }
  user = reactive({ userInfo: { userId: 1 } })
  stream = createStream()
  database = stream.db
  owned.value = true
  delete (tables as any).present
  get.mockReset()
  get.mockImplementation(({ url }) => Promise.resolve(url.endsWith('/subscriptions') ? { items: [] } : page([])))
  post.mockReset()
  mockUseQuery.mockClear()
})
afterEach(() => {
  scopes.splice(0).forEach(scope => scope.stop())
})
const restList = () =>
  get.mockImplementation(({ url }) => Promise.resolve(url.endsWith('/subscriptions') ? { items: [restSub('a')] } : page([restEntry('rest')], { has_more: true, next_cursor: 'r2' })))

describe('RSS local mode', () => {
  it('keeps an owned empty local database loading without list REST until first sync', async () => {
    const rss = create()
    expect(database.syncStream).toHaveBeenCalledWith('rss_v1')
    expect(stream.subscribe).toHaveBeenCalledWith({ ttl: 7 * 24 * 3600 })
    await rss.initialize()
    expect(get).not.toHaveBeenCalled()
    expect(rss.initializing.value).toBe(true)
    expect(rss.subscriptions.value).toEqual([])
    expect(rss.entries.value).toEqual([])
    await rss.reload()
    await rss.select('b')
    await rss.reload(true)
    expect(get).not.toHaveBeenCalled()
    expect(rss.initializing.value).toBe(true)
    await rss.select(null)
    tables.entries.value = [row('one', 'a', '2026-10-18 12:00:00'), row('two', 'b')]
    tables.subscriptions.value = [sub('a'), sub('b')]
    expect(rss.entries.value.map(x => x.id)).toEqual(['one', 'two'])
    expect(rss.initializing.value).toBe(false)
    stream.firstSync.resolve()
    await flushPromises()
    expect(rss.subscriptions.value.map(x => x.id)).toEqual(['a', 'b'])
    expect(rss.entries.value.map(x => x.id)).toEqual(['one', 'two'])
    expect(rss.initializing.value).toBe(false)
    expect(rss.hasMore.value).toBe(true)
    expect(rss.historyStatus.value).toBe('available')
    get.mockClear()
    await rss.initialize()
    await rss.select('b')
    await rss.reload()
    await rss.refresh()
    expect(rss.entries.value.map(x => x.id)).toEqual(['two'])
    expect(get).not.toHaveBeenCalled()
  })

  it('shows confirmed writes immediately and converges with synced rows', async () => {
    const rss = await live()
    post.mockResolvedValueOnce(restSub('c'))
    await rss.add('https://example.com/c.xml')
    expect(rss.selected.value).toBe('c')
    expect(rss.subscriptions.value.map(x => x.id)).toEqual(['a', 'b', 'c'])
    tables.subscriptions.value = [...tables.subscriptions.value, sub('c')]
    await flushPromises()
    expect(rss.subscriptions.value.map(x => x.id)).toEqual(['a', 'b', 'c'])

    expect(get).not.toHaveBeenCalled()

    post.mockResolvedValueOnce(undefined)
    await rss.remove('b')
    expect(rss.subscriptions.value.map(x => x.id)).toEqual(['a', 'c'])
    await rss.select('')
    expect(rss.entries.value.map(x => x.id)).toEqual(['one'])
    tables.subscriptions.value = [sub('a'), sub('c')]
    tables.entries.value = [row('one')]
    await flushPromises()
    expect(rss.subscriptions.value.map(x => x.id)).toEqual(['a', 'c'])

    await rss.select('a')
    post.mockResolvedValueOnce({ status: 'accepted', next_allowed_at: '2026-10-19T10:35:00.000Z' })
    await rss.refresh()
    expect(rss.subscriptions.value[0]).toMatchObject({ id: 'a', refreshing: true, next_allowed_at: '2026-10-19T10:35:00.000Z' })
    tables.subscriptions.value = [sub('a', { last_checked_at: '2026-10-19 10:31:00' }), sub('c')]
    await flushPromises()
    expect(rss.subscriptions.value[0]).toMatchObject({ refreshing: false, last_checked_at: '2026-10-19T10:31:00.000Z' })

    post.mockResolvedValueOnce({ bookmark_user_uuid: 'saved-1', result: 'created', processing_status: 'pending' })
    await rss.save(rss.entries.value[0])
    expect(rss.entries.value[0].bookmark_user_uuid).toBe('saved-1')
    tables.saved.value = [{ id: 'saved-1', article_url: 'https://example.com/one' }]
    await flushPromises()
    expect(rss.entries.value[0].bookmark_user_uuid).toBe('saved-1')

    post.mockResolvedValueOnce({ ...restSub('a'), remark: 'Mine' })
    await rss.update('a', 'Mine')
    expect(rss.subscriptions.value[0].remark).toBe('Mine')
    expect(rss.entries.value[0].source_title).toBe('Mine')
    expect(get).not.toHaveBeenCalled()
  })

  it('loads more after the oldest local entry with before, then re-walks the window after each history request', async () => {
    const rss = await live()
    await rss.select('a')
    expect(rss.entries.value.map(x => x.id)).toEqual(['one'])
    expect(rss.hasMore.value).toBe(true)
    get.mockResolvedValueOnce(page([restEntry('one'), restEntry('older', 'a', '2026-10-02T00:00:00.000Z')], { next_cursor: 'c2', has_more: true, cached_more: true, history_status: 'available' }))
    await rss.reload(true)
    expect(get).toHaveBeenCalledOnce()
    expect(get.mock.lastCall![0]).toMatchObject({ url: '/v1/rss/entries', query: { fetch_history: '1', limit: '20', subscription_id: 'a', before: 'one' } })
    expect(rss.entries.value.map(x => x.id)).toEqual(['one', 'older'])
    get.mockClear()
    get
      .mockResolvedValueOnce(page([]))
      .mockResolvedValueOnce(page([restEntry('older', 'a', '2026-10-02T00:00:00.000Z')], { next_cursor: 'w2', has_more: true, cached_more: true }))
      .mockResolvedValueOnce(page([restEntry('oldest', 'a', '2026-10-01T00:00:00.000Z')], { next_cursor: 'w3', has_more: true, history_status: 'retry', retry_at: '2026-10-19T11:00:00.000Z' }))
    await rss.reload(true)
    expect(get.mock.calls.map(([call]) => call.query)).toEqual([
      { subscription_id: 'a', cursor: 'c2', fetch_history: '1', limit: '20' },
      { subscription_id: 'a', before: 'one', limit: '20' },
      { subscription_id: 'a', cursor: 'w2', limit: '20' }
    ])
    expect(rss.entries.value.map(x => x.id)).toEqual(['one', 'older', 'oldest'])
    expect(rss.historyStatus.value).toBe('retry')
    expect(rss.retryAt.value).toBe('2026-10-19T11:00:00.000Z')
    get.mockClear()
    get.mockResolvedValueOnce(page([])).mockResolvedValueOnce(page([restEntry('older', 'a', '2026-10-02T00:00:00.000Z')]))
    await rss.reload(true)
    expect(get.mock.calls.map(([call]) => call.query)).toEqual([
      { subscription_id: 'a', cursor: 'w3', fetch_history: '1', limit: '20' },
      { subscription_id: 'a', before: 'one', limit: '20' }
    ])
    expect(rss.entries.value.map(x => x.id)).toEqual(['one', 'older'])
    expect(rss.hasMore.value).toBe(false)
    expect(rss.historyStatus.value).toBe('exhausted')
    await rss.select('')
    expect(rss.entries.value.map(x => x.id)).toEqual(['one', 'two'])
    expect(rss.hasMore.value).toBe(true)
  })

  it('clears overlays and appended pages on account change and unsubscribes when the lab is disabled', async () => {
    const rss = await live()
    post.mockResolvedValueOnce(restSub('c'))
    await rss.add('https://example.com/c.xml')
    await rss.select('')
    get.mockResolvedValueOnce(page([restEntry('old')], { has_more: true, next_cursor: 'n' }))
    await rss.reload(true)
    expect(rss.subscriptions.value.map(x => x.id)).toEqual(['a', 'b', 'c'])
    expect(rss.entries.value.map(x => x.id)).toEqual(['one', 'two', 'old'])
    user.userInfo = { userId: 2 }
    await flushPromises()
    expect(stream.handles[0].unsubscribe).toHaveBeenCalledOnce()
    expect(stream.subscribe).toHaveBeenCalledTimes(2)
    expect(rss.subscriptions.value.map(x => x.id)).toEqual(['a', 'b'])
    expect(rss.entries.value.map(x => x.id)).toEqual(['one', 'two'])
    labs.enabled.value = false
    await flushPromises()
    expect(stream.handles[1].unsubscribe).toHaveBeenCalledOnce()
    expect(rss.entries.value).toEqual([])
    expect(rss.subscriptions.value).toEqual([])
  })

  it('merges REST pages into the local timeline so newer history rows of another feed are not skipped', async () => {
    const rss = create()
    // Feed a posts hourly, feed b daily: the oldest local row is a's, b's history is newer than it.
    tables.subscriptions.value = [sub('a'), sub('b')]
    tables.entries.value = [
      row('a3', 'a', '2026-10-19 09:00:00'),
      row('a2', 'a', '2026-10-19 08:00:00'),
      row('b2', 'b', '2026-10-19 07:00:00'),
      row('a1', 'a', '2026-10-19 06:00:00')
    ]
    tables.saved.value = [{ id: 'local-bookmark', article_url: 'https://example.com/b1' }]
    stream.firstSync.resolve()
    await flushPromises()
    get.mockResolvedValueOnce(
      page(
        [
          restEntry('b1', 'b', '2026-10-19T06:30:00.000Z'),
          restEntry('a1', 'a', '2026-10-19T06:00:00.000Z', { title: 'stale REST copy' }),
          restEntry('a0', 'a', '2026-10-19T05:00:00.000Z', { bookmark_user_uuid: 'stale-rest-bookmark' }),
          restEntry('b0', 'b', '', { sort_at: undefined, published_at: '2026-10-19T04:00:00.000Z' })
        ],
        { next_cursor: 'c2', has_more: true, history_status: 'available' }
      )
    )
    await rss.reload(true)
    expect(get.mock.lastCall![0].query).toEqual({ fetch_history: '1', limit: '20', before: 'a1' })
    expect(get.mock.lastCall![0].errorInterceptors).toBeTypeOf('function')
    expect(rss.entries.value.map(x => x.id)).toEqual(['a3', 'a2', 'b2', 'b1', 'a1', 'a0', 'b0'])
    expect(rss.entries.value.find(x => x.id === 'a1')!.title).toBe('a1')
    expect(rss.entries.value.find(x => x.id === 'b1')!.bookmark_user_uuid).toBe('local-bookmark')
    expect(rss.entries.value.find(x => x.id === 'a0')!.bookmark_user_uuid).toBeNull()
    expect(rss.entries.value.find(x => x.id === 'b1')!.source_title).toBe('Feed b')
    post.mockResolvedValueOnce({ bookmark_user_uuid: 'saved-a0', result: 'created', processing_status: 'pending' })
    await rss.save(rss.entries.value.find(x => x.id === 'a0')!)
    expect(rss.entries.value.find(x => x.id === 'a0')!.bookmark_user_uuid).toBe('saved-a0')
    // A row synced later still lands at its timeline position among merged REST rows.
    tables.entries.value = [...tables.entries.value, row('b1.5', 'b', '2026-10-19 06:45:00')].sort((x, y) => (x.sort_at < y.sort_at ? 1 : -1))
    expect(rss.entries.value.map(x => x.id)).toEqual(['a3', 'a2', 'b2', 'b1.5', 'b1', 'a1', 'a0', 'b0'])
    get.mockClear()
    get.mockResolvedValueOnce(page([])).mockResolvedValueOnce(page([]))
    await rss.reload(true)
    expect(get.mock.calls.map(([call]) => call.query)).toEqual([
      { cursor: 'c2', fetch_history: '1', limit: '20' },
      { before: 'a1', limit: '20' }
    ])
    expect(rss.hasMore.value).toBe(false)
  })

  it('shows history fetched above the cursor by a later Load more at its timeline position', async () => {
    const rss = create()
    tables.subscriptions.value = [sub('a'), sub('b')]
    tables.entries.value = [row('a2', 'a', '2026-10-19 09:00:00'), row('a1', 'a', '2026-10-19 08:00:00')]
    stream.firstSync.resolve()
    await flushPromises()
    get.mockResolvedValueOnce(page([restEntry('a0', 'a', '2026-10-19T07:00:00.000Z')], { next_cursor: 'c2', has_more: true, cached_more: true, history_status: 'available' }))
    await rss.reload(true)
    expect(rss.entries.value.map(x => x.id)).toEqual(['a2', 'a1', 'a0'])
    get.mockClear()
    // The history request loads feed b's archive: rows newer than the cursor (b1 above a0) that the cursor page omits.
    get
      .mockResolvedValueOnce(page([restEntry('a-1', 'a', '2026-10-19T06:00:00.000Z')], { next_cursor: 'c3', has_more: true, cached_more: true, history_status: 'available' }))
      .mockResolvedValueOnce(
        page([restEntry('b1', 'b', '2026-10-19T08:30:00.000Z'), restEntry('a0', 'a', '2026-10-19T07:00:00.000Z')], { next_cursor: 'w2', has_more: true, cached_more: true, history_status: 'available' })
      )
      .mockResolvedValueOnce(page([restEntry('b0', 'b', '2026-10-19T06:30:00.000Z'), restEntry('a-1', 'a', '2026-10-19T06:00:00.000Z')], { next_cursor: 'w3', has_more: true, cached_more: true, history_status: 'available' }))
    await rss.reload(true)
    expect(get.mock.calls.map(([call]) => call.query)).toEqual([
      { cursor: 'c2', fetch_history: '1', limit: '20' },
      { before: 'a1', limit: '20' },
      { cursor: 'w2', limit: '20' }
    ])
    expect(rss.entries.value.map(x => x.id)).toEqual(['a2', 'b1', 'a1', 'a0', 'b0', 'a-1'])
    expect(rss.cursor.value).toBe('w3')
  })

  it('re-anchors to the current oldest local row once when the anchor was pruned', async () => {
    const rss = create()
    tables.subscriptions.value = [sub('a')]
    tables.entries.value = [row('a2', 'a', '2026-10-19 09:00:00'), row('a1', 'a', '2026-10-19 08:00:00')]
    stream.firstSync.resolve()
    await flushPromises()
    get.mockResolvedValueOnce(page([restEntry('a0', 'a', '2026-10-19T07:00:00.000Z')], { next_cursor: 'c2', has_more: true, cached_more: true, history_status: 'available' }))
    await rss.reload(true)
    get.mockClear()
    // a1 is pruned on the server and its deletion has not synced yet.
    get
      .mockResolvedValueOnce(page([]))
      .mockRejectedValueOnce(new RequestError({ message: 'not_found', name: '', code: 404 }))
      .mockResolvedValueOnce(page([restEntry('a1.5', 'a', '2026-10-19T08:30:00.000Z'), restEntry('a0', 'a', '2026-10-19T07:00:00.000Z')], { next_cursor: 'w2', has_more: true }))
    await rss.reload(true)
    expect(get.mock.calls.map(([call]) => call.query)).toEqual([
      { cursor: 'c2', fetch_history: '1', limit: '20' },
      { before: 'a1', limit: '20' },
      { before: 'a2', limit: '20' }
    ])
    expect(rss.error.value).toBe('')
    expect(rss.entries.value.map(x => x.id)).toEqual(['a2', 'a1.5', 'a1', 'a0'])
    get.mockClear()
    get.mockResolvedValueOnce(page([])).mockResolvedValueOnce(page([]))
    await rss.reload(true)
    expect(get.mock.calls[1][0].query).toEqual({ before: 'a2', limit: '20' })
  })

  it('keeps an add successful without seeding the new source from REST', async () => {
    const rss = await live()
    post.mockResolvedValueOnce(restSub('c'))
    await rss.add('https://example.com/c.xml')
    expect(rss.error.value).toBe('')
    expect(rss.selected.value).toBe('c')
    expect(rss.subscriptions.value.map(x => x.id)).toEqual(['a', 'b', 'c'])
    post.mockResolvedValueOnce(restSub('d'))
    await rss.add('https://example.com/d.xml')
    expect(rss.selected.value).toBe('d')
    expect(rss.subscriptions.value.map(x => x.id)).toEqual(['a', 'b', 'c', 'd'])
    expect(get).not.toHaveBeenCalled()
  })

  it('local add before first sync performs only the mutation and waits for the synced source', async () => {
    const rss = create()
    post.mockResolvedValueOnce(restSub('c'))
    await rss.initialize()
    expect(rss.initializing.value).toBe(true)
    await rss.add('https://example.com/c.xml')
    expect(post).toHaveBeenCalledOnce()
    expect(get).not.toHaveBeenCalled()
    expect(rss.selected.value).toBe('c')
    expect(rss.subscriptions.value.map(x => x.id)).toEqual(['c'])
    expect(rss.initializing.value).toBe(true)
    tables.subscriptions.value = [sub('c')]
    tables.entries.value = [row('c1', 'c')]
    stream.firstSync.resolve()
    await flushPromises()
    expect(rss.entries.value.map(x => x.id)).toEqual(['c1'])
    expect(get).not.toHaveBeenCalled()
  })

  it('replacing the account while its local stream is pending cancels the old first-sync owner', async () => {
    const rss = create()
    await rss.initialize()
    expect(rss.initializing.value).toBe(true)
    user.userInfo = { userId: 2 }
    await flushPromises()
    expect(stream.handles[0].unsubscribe).toHaveBeenCalledOnce()
    expect(stream.subscribe).toHaveBeenCalledTimes(2)
    expect(rss.initializing.value).toBe(true)
    tables.subscriptions.value = [sub('b')]
    tables.entries.value = [row('new-account', 'b')]
    stream.firstSync.resolve()
    await flushPromises()
    expect(rss.subscriptions.value.map(x => x.id)).toEqual(['b'])
    expect(rss.entries.value.map(x => x.id)).toEqual(['new-account'])
    expect(get).not.toHaveBeenCalled()
  })

  it('reveals hidden local rows before requesting REST after the last displayed row', async () => {
    const rss = create()
    tables.subscriptions.value = [sub('a')]
    const at = (i: number) => new Date(Date.UTC(2026, 9, 19, 12) - i * 60_000).toISOString().replace('T', ' ').slice(0, 19)
    tables.entries.value = Array.from({ length: 120 }, (_, i) => row(`e${String(i).padStart(3, '0')}`, 'a', at(i)))
    stream.firstSync.resolve()
    await flushPromises()
    expect(rss.entries.value).toHaveLength(50)
    expect(rss.hasMore.value).toBe(true)
    await rss.reload(true)
    expect(rss.entries.value).toHaveLength(100)
    await rss.reload(true)
    expect(rss.entries.value).toHaveLength(120)
    expect(get).not.toHaveBeenCalled()
    expect(rss.hasMore.value).toBe(true)
    get.mockResolvedValueOnce(page([restEntry('older', 'a', '2026-10-01T00:00:00.000Z')], { has_more: false }))
    await rss.reload(true)
    expect(get.mock.lastCall![0].query).toMatchObject({ before: 'e119' })
    expect(rss.entries.value).toHaveLength(121)
    expect(rss.entries.value.at(-1)!.id).toBe('older')
    expect(rss.hasMore.value).toBe(false)
    await rss.select('a')
    expect(rss.entries.value).toHaveLength(50)
  })

  it('shows local rows on reload or offline without waiting for the first sync or the laboratory response', async () => {
    labs.loaded.value = false
    labs.fetch.mockRejectedValue(new TypeError('Failed to fetch'))
    tables.present = ref([{ present: 1 }])
    owned.value = false
    const rss = create()
    expect(rss.enabled.value).toBe(false)
    expect(stream.subscribe).not.toHaveBeenCalled()
    owned.value = true
    await flushPromises()
    expect(rss.enabled.value).toBe(true)
    expect(stream.subscribe).toHaveBeenCalledWith({ ttl: 7 * 24 * 3600 })
    tables.subscriptions.value = [sub('a')]
    tables.entries.value = [row('one')]
    await rss.initialize()
    expect(rss.error.value).toBe('')
    expect(rss.subscriptions.value.map(x => x.id)).toEqual(['a'])
    expect(rss.entries.value.map(x => x.id)).toEqual(['one'])
    expect(get).not.toHaveBeenCalled()
    // Writes still go to REST and report their network errors.
    post.mockRejectedValueOnce(new Error('source_unavailable'))
    await rss.save(rss.entries.value[0])
    expect(rss.error.value).toBe('source_unavailable')
    // Only a confirmed laboratory response disables RSS.
    labs.loaded.value = true
    labs.enabled.value = false
    await flushPromises()
    expect(rss.enabled.value).toBe(false)
    expect(stream.handles[0].unsubscribe).toHaveBeenCalledOnce()
    expect(rss.entries.value).toEqual([])
    expect(rss.subscriptions.value).toEqual([])
  })

  it('keeps the confirmed local list when a later laboratory request fails', async () => {
    const rss = await live()
    labs.fetch.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await rss.initialize()
    expect(rss.error.value).toBe('')
    expect(rss.enabled.value).toBe(true)
    expect(rss.entries.value.map(x => x.id)).toEqual(['one', 'two'])
    expect(stream.handles[0].unsubscribe).not.toHaveBeenCalled()
  })

  it('uses REST whenever the local database does not belong to the signed-in account', async () => {
    restList()
    owned.value = false
    tables.present = ref([{ present: 1 }])
    const rss = create()
    tables.subscriptions.value = [sub('a'), sub('b')]
    tables.entries.value = [row('one'), row('two', 'b')]
    stream.firstSync.resolve()
    await rss.initialize()
    await flushPromises()
    expect(stream.subscribe).not.toHaveBeenCalled()
    expect(rss.enabled.value).toBe(true)
    expect(rss.subscriptions.value.map(x => x.id)).toEqual(['a'])
    expect(rss.entries.value.map(x => x.id)).toEqual(['rest'])
  })

  it('falls back to REST when ownership is lost after the local list is shown', async () => {
    restList()
    const rss = await live()
    expect(rss.entries.value.map(x => x.id)).toEqual(['one', 'two'])
    owned.value = false
    await flushPromises()
    expect(stream.handles[0].unsubscribe).toHaveBeenCalledOnce()
    expect(rss.subscriptions.value.map(x => x.id)).toEqual(['a'])
    expect(rss.entries.value.map(x => x.id)).toEqual(['rest'])
  })

  it('keeps the REST implementation when local-first storage is unavailable', async () => {
    database = null
    restList()
    const rss = create()
    await rss.initialize()
    expect(mockUseQuery).not.toHaveBeenCalled()
    expect(stream.db.syncStream).not.toHaveBeenCalled()
    expect(rss.entries.value.map(x => x.id)).toEqual(['rest'])
    expect(rss.cursor.value).toBe('r2')
  })

  it('stays on REST when the stream cannot be subscribed', async () => {
    stream.subscribe.mockRejectedValueOnce(new Error('offline'))
    restList()
    const rss = create()
    tables.entries.value = [row('one')]
    await rss.initialize()
    await flushPromises()
    expect(rss.entries.value.map(x => x.id)).toEqual(['rest'])
  })

  it('sync-before-REST save retires its overlay and a later bookmark deletion clears the saved flag', async () => {
    const rss = await live()
    let resolveSave!: (value: unknown) => void
    post.mockImplementationOnce(() => new Promise(resolve => { resolveSave = resolve }))
    const saving = rss.save(rss.entries.value[0])
    tables.saved.value = [{ id: 'saved-sync', article_url: 'https://example.com/one' }]
    await flushPromises()
    expect(rss.entries.value[0].bookmark_user_uuid).toBe('saved-sync')
    resolveSave({ bookmark_user_uuid: 'saved-sync', result: 'created', processing_status: 'pending' })
    await saving
    tables.saved.value = []
    await flushPromises()
    expect(rss.entries.value[0].bookmark_user_uuid).toBeNull()
  })

  it('rename overlay yields from A through its own Mine sync to a later Other sync', async () => {
    const rss = create()
    const baseline = sub('a', { remark: 'A', last_success_at: '2026-10-18 10:00:00' })
    tables.subscriptions.value = [baseline]
    tables.entries.value = [row('one', 'a')]
    stream.firstSync.resolve()
    await flushPromises()
    let resolveRename!: (value: unknown) => void
    post.mockImplementationOnce(() => new Promise(resolve => { resolveRename = resolve }))
    const updating = rss.update('a', 'Mine')
    tables.subscriptions.value = [sub('a', { remark: 'Mine', last_success_at: '2026-10-19 10:00:00', error: null })]
    await flushPromises()
    resolveRename({ ...restSub('a'), remark: 'Mine', error: 'source_unavailable', last_success_at: '2026-01-01T00:00:00.000Z' })
    await updating
    tables.subscriptions.value = [sub('a', { remark: 'Other', last_success_at: '2026-10-20 10:00:00', error: null })]
    await flushPromises()
    expect(rss.subscriptions.value[0]).toMatchObject({ remark: 'Other', last_success_at: '2026-10-20T10:00:00.000Z', error: null })
    expect(rss.entries.value[0].source_title).toBe('Other')
  })

  it('a later synced remark wins when the rename response arrives before that sync', async () => {
    const rss = create()
    tables.subscriptions.value = [sub('a', { remark: 'A', last_success_at: '2026-10-18 10:00:00' })]
    tables.entries.value = [row('one', 'a')]
    stream.firstSync.resolve()
    await flushPromises()
    post.mockResolvedValueOnce({ ...restSub('a'), remark: 'Mine', last_success_at: '2026-10-19T00:00:00.000Z', error: null })
    await rss.update('a', 'Mine')
    tables.subscriptions.value = [sub('a', { remark: 'Other', last_success_at: '2026-10-20 10:00:00', error: null })]
    await flushPromises()
    expect(rss.subscriptions.value[0]).toMatchObject({ remark: 'Other', last_success_at: '2026-10-20T10:00:00.000Z', error: null })
    expect(rss.entries.value[0].source_title).toBe('Other')
  })

  it('removing the first 60 rows source keeps later all-view rows visible and paginates them locally', async () => {
    const rss = create()
    tables.subscriptions.value = [sub('a'), sub('b')]
    const at = (minute: number) => new Date(Date.UTC(2026, 9, 20, 12) - minute * 60_000).toISOString().replace('T', ' ').slice(0, 19)
    tables.entries.value = [
      ...Array.from({ length: 60 }, (_, index) => row(`a-${index}`, 'a', at(index))),
      ...Array.from({ length: 80 }, (_, index) => row(`b-${index}`, 'b', at(index + 60)))
    ]
    stream.firstSync.resolve()
    await flushPromises()
    expect(rss.entries.value).toHaveLength(50)
    expect(rss.entries.value.every(item => item.subscription_id === 'a')).toBe(true)
    post.mockResolvedValueOnce(undefined)
    await rss.remove('a')
    expect(rss.entries.value).toHaveLength(50)
    expect(rss.entries.value.every(item => item.subscription_id === 'b')).toBe(true)
    get.mockClear()
    await rss.reload(true)
    expect(rss.entries.value).toHaveLength(80)
    expect(rss.entries.value.every(item => item.subscription_id === 'b')).toBe(true)
    expect(get).not.toHaveBeenCalled()
  })

  it('sync-before-add response retires the add overlay before a later synced deletion', async () => {
    const rss = await live()
    let resolveAdd!: (value: unknown) => void
    post.mockImplementationOnce(() => new Promise(resolve => { resolveAdd = resolve }))
    get.mockResolvedValueOnce(page([]))
    const adding = rss.add('https://example.com/c.xml')
    tables.subscriptions.value = [...tables.subscriptions.value, sub('c')]
    await flushPromises()
    resolveAdd(restSub('c'))
    await adding
    expect(rss.subscriptions.value.some(item => item.id === 'c')).toBe(true)
    tables.subscriptions.value = tables.subscriptions.value.filter(item => item.id !== 'c')
    await flushPromises()
    expect(rss.subscriptions.value.some(item => item.id === 'c')).toBe(false)
  })

  it('a refresh settled in sync before REST response does not keep its refresh overlay', async () => {
    const rss = await live()
    await rss.select('a')
    let resolveRefresh!: (value: unknown) => void
    post.mockImplementationOnce(() => new Promise(resolve => { resolveRefresh = resolve }))
    const refreshing = rss.refresh()
    const next = '2026-10-20T00:00:00.000Z'
    tables.subscriptions.value = [sub('a', { next_allowed_at: '2026-10-20 00:00:00', refreshing_until: null }), tables.subscriptions.value[1]]
    await flushPromises()
    resolveRefresh({ status: 'accepted', next_allowed_at: next })
    await refreshing
    expect(rss.subscriptions.value[0]).toMatchObject({ id: 'a', refreshing: false, next_allowed_at: next })
  })
})
