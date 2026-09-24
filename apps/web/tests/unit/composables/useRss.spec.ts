import { effectScope, nextTick, reactive, ref } from 'vue'

import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { useRss } from '../../../app/composables/useRss'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let labs: any, user: any
vi.mock('~/composables/useLabFeatures', () => ({ useLabFeatures: () => labs }))
vi.mock('~/stores/user', () => ({ useUserStore: () => user }))
// request() 是 Nuxt auto-import，只能用 mockNuxtImport 拦截；vi.stubGlobal 作用于改写后的代码无效
const { get, post, mockRequest } = vi.hoisted(() => {
  const get = vi.fn()
  const post = vi.fn()
  return { get, post, mockRequest: vi.fn(() => ({ get, post })) }
})
mockNuxtImport('request', () => mockRequest)
const scopes: ReturnType<typeof effectScope>[] = []
const entry = { id: 'one', article_url: 'https://example.com/article', bookmark_user_uuid: null }
const deferred = () => {
  let resolve!: (value: any) => void
  const promise = new Promise<any>(r => {
    resolve = r
  })
  return { resolve, promise }
}
beforeEach(() => {
  const enabled = ref(true)
  labs = { loaded: ref(true), features: ref([{ key: 'rss', enabled: true }]), isEnabled: () => enabled.value, fetch: vi.fn(), enabled }
  user = reactive({ userInfo: { userId: 1 } })
  get.mockReset()
  get.mockImplementation(({ url }) => Promise.resolve(url.endsWith('/subscriptions') ? { items: [] } : { items: [], next_cursor: null }))
  post.mockReset()
})
afterEach(() => {
  scopes.splice(0).forEach(scope => scope.stop())
  vi.restoreAllMocks()
})
const create = () => {
  const scope = effectScope()
  scopes.push(scope)
  return scope.run(() => useRss())!
}
describe('RSS state', () => {
  it('restores a cached feed immediately and ignores a late response from another feed', async () => {
    const rss = create(),
      late = deferred()
    get.mockResolvedValueOnce({ items: [entry], next_cursor: 'page-two' })
    await rss.select('a')
    get.mockReturnValueOnce(late.promise)
    const loadingB = rss.select('b')
    await rss.select('a')
    expect(rss.entries.value).toEqual([entry])
    expect(rss.cursor.value).toBe('page-two')
    expect(get).toHaveBeenCalledTimes(2)
    late.resolve({ items: [{ ...entry, id: 'from-b' }], next_cursor: null })
    await loadingB
    expect(rss.entries.value).toEqual([entry])
    expect(rss.loading.value).toBe(false)
  })
  it('retains rows and pagination while a background reload fails', async () => {
    const rss = create()
    get.mockResolvedValueOnce({ items: [entry], next_cursor: 'cached-cursor' })
    await rss.select('a')
    get.mockRejectedValueOnce(new Error('source_unavailable'))
    const refresh = rss.reload()
    expect(rss.entries.value).toEqual([entry])
    await refresh
    expect(rss.entries.value).toEqual([entry])
    expect(rss.cursor.value).toBe('cached-cursor')
    expect(rss.error.value).toBe('source_unavailable')
  })
  it('revalidates loaded pages atomically instead of collapsing to the first page', async () => {
    const rss = create(),
      secondPage = deferred()
    get
      .mockResolvedValueOnce({ items: [entry], next_cursor: 'old-2' })
      .mockResolvedValueOnce({ items: [{ ...entry, id: 'two' }], next_cursor: 'old-3' })
      .mockResolvedValueOnce({ items: [entry], next_cursor: 'old-2' })
      .mockResolvedValueOnce({ items: [{ ...entry, id: 'two' }], next_cursor: 'old-3' })
    await rss.reload()
    await rss.reload(true)
    get.mockResolvedValueOnce({ items: [{ ...entry, id: 'new' }], next_cursor: 'new-2' }).mockReturnValueOnce(secondPage.promise)
    const refresh = rss.reload()
    await nextTick()
    expect(rss.entries.value.map(x => x.id)).toEqual(['one', 'two'])
    expect(rss.cursor.value).toBe('old-3')
    secondPage.resolve({ items: [entry, { ...entry, id: 'two' }], next_cursor: 'new-3' })
    await refresh
    expect(rss.entries.value.map(x => x.id)).toEqual(['new', 'one', 'two'])
    expect(rss.cursor.value).toBe('new-3')
    expect(get.mock.calls[5][0].query.cursor).toBe('new-2')
  })
  it('keeps cached entries visible while a manual refresh is queued', async () => {
    const rss = create()
    get.mockResolvedValueOnce({ items: [entry], next_cursor: null })
    await rss.select('a')
    rss.subscriptions.value = [{ id: 'a', refreshing: false } as any]
    post.mockResolvedValueOnce({ status: 'accepted', next_allowed_at: '2026-09-23T00:05:00Z' })
    await rss.refresh()
    expect(rss.entries.value).toEqual([entry])
    expect(rss.subscriptions.value[0].refreshing).toBe(true)
    expect(get).toHaveBeenCalledTimes(1)
  })
  it('updates display names across cached filters without reloading the page', async () => {
    const rss = create(),
      row = { ...entry, subscription_id: 'a', source_title: 'Publisher' }
    get.mockResolvedValueOnce({ items: [row], next_cursor: null }).mockResolvedValueOnce({ items: [row], next_cursor: null })
    await rss.select('a')
    await rss.select('')
    rss.subscriptions.value = [{ id: 'a', title: 'Publisher', remark: null } as any]
    post.mockResolvedValueOnce({ id: 'a', title: 'Publisher', remark: 'My feed' })
    await rss.update('a', ' My feed ')
    expect(rss.entries.value[0].source_title).toBe('My feed')
    await rss.select('a')
    expect(rss.entries.value[0].source_title).toBe('My feed')
    expect(get).toHaveBeenCalledTimes(2)
    expect(post).toHaveBeenCalledWith({ url: '/v1/rss/subscriptions/a/update', body: { remark: 'My feed' } })
    post.mockResolvedValueOnce({ id: 'a', title: 'Publisher', remark: null })
    await rss.update('a', '')
    expect(rss.entries.value[0].source_title).toBe('Publisher')
  })
  it('updates saved status in every cached filter', async () => {
    const rss = create()
    get.mockResolvedValueOnce({ items: [entry], next_cursor: null }).mockResolvedValueOnce({ items: [entry], next_cursor: null })
    await rss.select('a')
    await rss.select('')
    post.mockResolvedValueOnce({ bookmark_user_uuid: 'saved-id' })
    await rss.save(entry as any)
    await rss.select('a')
    expect(rss.entries.value[0].bookmark_user_uuid).toBe('saved-id')
    expect(get).toHaveBeenCalledTimes(2)
  })
  it('drops cached lists when Labs is disabled', async () => {
    const rss = create()
    get.mockResolvedValueOnce({ items: [entry], next_cursor: null })
    await rss.select('a')
    labs.enabled.value = false
    await nextTick()
    labs.enabled.value = true
    await nextTick()
    get.mockResolvedValueOnce({ items: [], next_cursor: null })
    await rss.select('a')
    expect(rss.entries.value).toEqual([])
    expect(get).toHaveBeenCalledTimes(2)
  })
  it('shows preview loading and discards the response after closing', async () => {
    const rss = create(),
      response = deferred()
    get.mockReturnValueOnce(response.promise)
    const loading = rss.open(entry as any)
    expect(rss.detailLoading.value).toBe(true)
    rss.closePreview()
    response.resolve({ ...entry, content_html: '<p>Late response</p>' })
    await loading
    expect(rss.detailLoading.value).toBe(false)
    expect(rss.detail.value).toBeNull()
  })
  it('clears preview loading on failure and allows a retry', async () => {
    const rss = create()
    get.mockRejectedValueOnce(new Error('source_unavailable'))
    await rss.open(entry as any)
    expect(rss.detailLoading.value).toBe(false)
    expect(rss.error.value).toBe('source_unavailable')
    get.mockResolvedValueOnce({ ...entry, content_html: '<p>Recovered</p>' })
    await rss.open(entry as any)
    expect(rss.error.value).toBe('')
    expect(rss.detail.value?.content_html).toContain('Recovered')
  })
  it('does not load entries when Labs is disabled', async () => {
    labs.enabled.value = false
    const rss = create()
    await rss.initialize()
    expect(get).not.toHaveBeenCalled()
  })
  it('discards a previous source response when selection changes', async () => {
    const rss = create(),
      old = deferred()
    get.mockReturnValueOnce(old.promise).mockResolvedValueOnce({ items: [{ ...entry, id: 'new' }], next_cursor: null })
    const first = rss.select('old')
    await rss.select('new')
    old.resolve({ items: [entry], next_cursor: null })
    await first
    expect(rss.entries.value.map(x => x.id)).toEqual(['new'])
  })
  it('clears articles and discards late responses when the account changes', async () => {
    const rss = create(),
      old = deferred()
    get.mockReturnValueOnce(old.promise)
    const loading = rss.reload()
    user.userInfo.userId = 2
    await nextTick()
    old.resolve({ items: [entry], next_cursor: null })
    await loading
    await nextTick()
    expect(rss.entries.value).toEqual([])
    expect(rss.detail.value).toBeNull()
  })
  it('clears preview and feed data when Labs closes', async () => {
    const rss = create()
    rss.entries.value = [entry as any]
    rss.detail.value = entry as any
    labs.enabled.value = false
    await nextTick()
    expect(rss.entries.value).toEqual([])
    expect(rss.detail.value).toBeNull()
  })
  it('deduplicates paginated entries and uses the server cursor', async () => {
    const rss = create()
    get
      .mockResolvedValueOnce({ items: [entry], next_cursor: 'opaque' })
      .mockResolvedValueOnce({ items: [entry, { ...entry, id: 'two' }], next_cursor: null })
      .mockResolvedValueOnce({ items: [entry, entry, { ...entry, id: 'two' }], next_cursor: null })
    await rss.reload()
    await rss.reload(true)
    expect(rss.entries.value).toHaveLength(2)
    expect(get.mock.calls[1][0].query.cursor).toBe('opaque')
    expect(get.mock.calls[1][0].query.fetch_history).toBe('1')
    expect(get.mock.calls[2][0].query.fetch_history).toBeUndefined()
  })
  it('marks all copies of the saved URL with the Inbox relation UUID', async () => {
    const rss = create()
    rss.entries.value = [entry as any, { ...entry, id: 'duplicate' } as any]
    rss.detail.value = entry as any
    post.mockResolvedValue({ bookmark_user_uuid: 'inbox-uuid', result: 'created', processing_status: 'pending' })
    await rss.save(entry as any)
    expect(rss.entries.value.every(x => x.bookmark_user_uuid === 'inbox-uuid')).toBe(true)
    expect(rss.detail.value?.bookmark_user_uuid).toBe('inbox-uuid')
  })
})
