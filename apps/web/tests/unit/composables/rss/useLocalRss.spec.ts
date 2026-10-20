import { effectScope, nextTick, ref } from 'vue'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockUseQuery, queries } = vi.hoisted(() => {
  const queries: { sql: { value: string }; data: { value: any[] } }[] = []
  return {
    queries,
    mockUseQuery: vi.fn((sql: any) => {
      const result = { sql, data: ref<any[]>([]), isLoading: ref(false), error: ref(undefined), refresh: vi.fn(async () => {}) }
      queries.push(result)
      return result
    })
  }
})
vi.mock('@powersync/vue', () => ({ useQuery: mockUseQuery }))

import { useLocalRss, useLocalRssPresence } from '~~/app/composables/rss/useLocalRss'

const scopes: ReturnType<typeof effectScope>[] = []
const create = (selected = ref(''), enabled = ref(true), limit = Infinity, excluded: ReadonlySet<string> = new Set()) => {
  const scope = effectScope()
  scopes.push(scope)
  const local = scope.run(() => useLocalRss(selected, enabled, ref(limit), ref(excluded)))!
  const [subscriptions, entries, saved] = queries.slice(-3)
  return { local, subscriptions: subscriptions!, entries: entries!, saved: saved!, selected, enabled }
}
const source = {
  id: 'sub-1',
  feed_url: 'https://example.com/feed.xml',
  title: 'Example',
  remark: 'Daily',
  site_url: 'https://example.com',
  icon_url: 'https://img.example/icon',
  last_checked_at: '2026-10-19 10:00:00',
  last_success_at: null,
  next_fetch_at: '2026-10-19 11:00:00',
  next_allowed_at: '2026-10-19T12:00:00.000Z',
  error: null,
  refreshing_until: null
}
const article = (id: string, subscription = 'sub-1', url: string | null = `https://example.com/${id}`) => ({
  id,
  subscription_id: subscription,
  source_title: 'Daily',
  title: id,
  author: null,
  summary: null,
  article_url: url,
  image_url: null,
  published_at: '2026-10-18 10:00:00',
  first_seen_at: '2026-10-18 11:00:00',
  sort_at: '2026-10-18 10:00:00' as string | null
})
beforeEach(() => {
  queries.length = 0
  mockUseQuery.mockClear()
})
afterEach(() => {
  scopes.splice(0).forEach(scope => scope.stop())
  vi.useRealTimers()
})

describe('useLocalRss', () => {
  it('joins feeds and subscriptions in timeline order and resolves saved state from local bookmarks', () => {
    const { subscriptions, entries, saved } = create()
    expect(subscriptions.sql.value).toContain('FROM sr_rss_subscription s JOIN sr_rss_feed f ON f.id = s.feed_id')
    expect(subscriptions.sql.value).toContain('ORDER BY s.created_at, s.id')
    expect(entries.sql.value).toContain('JOIN sr_rss_subscription s ON s.feed_id = e.feed_id')
    expect(entries.sql.value).toContain("COALESCE(NULLIF(s.remark, ''), f.title) AS source_title")
    expect(entries.sql.value).toContain('e.first_seen_at, e.sort_at')
    expect(entries.sql.value).toContain('ORDER BY e.sort_at DESC, e.id DESC')
    expect(saved.sql.value).toContain('deleted_at IS NULL')
    expect(saved.sql.value).toContain("JSON_EXTRACT(metadata, '$.bookmark.target_url') AS article_url, MIN(id) AS id")
    expect(saved.sql.value).toContain('GROUP BY 1')
  })

  it('maps rows to the REST contract with ISO timestamps', () => {
    const { local, subscriptions, entries, saved } = create()
    subscriptions.data.value = [source]
    entries.data.value = [article('one'), article('two', 'sub-1', null)]
    saved.data.value = [{ id: 'bookmark-1', article_url: 'https://example.com/one' }]
    expect(local.subscriptions.value).toEqual([
      {
        id: 'sub-1',
        feed_url: 'https://example.com/feed.xml',
        title: 'Example',
        remark: 'Daily',
        site_url: 'https://example.com',
        icon_url: 'https://img.example/icon',
        refreshing: false,
        last_checked_at: '2026-10-19T10:00:00.000Z',
        last_success_at: null,
        next_fetch_at: '2026-10-19T11:00:00.000Z',
        next_allowed_at: '2026-10-19T12:00:00.000Z',
        error: null
      }
    ])
    expect(local.entries.value[0]).toEqual({
      id: 'one',
      subscription_id: 'sub-1',
      source_title: 'Daily',
      title: 'one',
      author: null,
      summary: '',
      article_url: 'https://example.com/one',
      image_url: null,
      published_at: '2026-10-18T10:00:00.000Z',
      first_seen_at: '2026-10-18T11:00:00.000Z',
      sort_at: '2026-10-18T10:00:00.000Z',
      bookmark_user_uuid: 'bookmark-1'
    })
    expect(local.entries.value[1].bookmark_user_uuid).toBeNull()
    entries.data.value = [{ ...article('three'), sort_at: null }, { ...article('four'), sort_at: null, published_at: null }]
    expect(local.entries.value.map(row => row.sort_at)).toEqual(['2026-10-18T10:00:00.000Z', '2026-10-18T11:00:00.000Z'])
  })

  it('reports refreshing until the lease expires', async () => {
    vi.useFakeTimers({ now: new Date('2026-10-19T10:00:00Z') })
    const { local, subscriptions } = create()
    subscriptions.data.value = [{ ...source, refreshing_until: '2026-10-19 10:00:30' }]
    await nextTick()
    expect(local.subscriptions.value[0].refreshing).toBe(true)
    await vi.advanceTimersByTimeAsync(31_000)
    expect(local.subscriptions.value[0].refreshing).toBe(false)
  })

  it('reports whether any local subscription row exists, only while enabled', () => {
    const enabled = ref(false)
    const scope = effectScope()
    scopes.push(scope)
    const present = scope.run(() => useLocalRssPresence(enabled))!
    const query = queries.at(-1)!
    query.data.value = [{ present: 1 }]
    expect(query.sql.value).toMatch(/WHERE 0$/)
    expect(present.value).toBe(false)
    enabled.value = true
    expect(query.sql.value).toBe('SELECT 1 AS present FROM sr_rss_subscription LIMIT 1')
    expect(present.value).toBe(true)
    query.data.value = []
    expect(present.value).toBe(false)
  })

  it('filters entries by the selected subscription and selects nothing while disabled', () => {
    const { local, entries, selected, enabled, subscriptions } = create()
    entries.data.value = [article('one', 'a'), article('two', 'b')]
    expect(local.entries.value.map(row => row.id)).toEqual(['one', 'two'])
    selected.value = 'b'
    expect(local.entries.value.map(row => row.id)).toEqual(['two'])
    enabled.value = false
    expect(subscriptions.sql.value).toMatch(/WHERE 0$/)
  })

  it('maps only the selected visible window plus one look-ahead row', () => {
    const selected = ref('a')
    const { local, entries } = create(selected, ref(true), 50)
    let mappedTitles = 0
    const rows = Array.from({ length: 140 }, (_, index) => {
      const row: Record<string, unknown> = article(`row-${index}`, index % 2 ? 'b' : 'a')
      Object.defineProperty(row, 'title', {get: () => {mappedTitles++; return `row-${index}`;}})
      return row
    })
    entries.data.value = rows
    expect(local.entries.value).toHaveLength(51)
    expect(mappedTitles).toBe(51)
    selected.value = 'b'
    mappedTitles = 0
    expect(local.entries.value).toHaveLength(51)
    expect(mappedTitles).toBe(51)
  })

  it('filters excluded subscriptions before selecting the visible mapping window', () => {
    const excluded = ref<ReadonlySet<string>>(new Set(['a']))
    const { local, entries } = create(ref(''), ref(true), 50, excluded.value)
    let mappedA = 0, mappedB = 0
    const rows = Array.from({ length: 120 }, (_, index) => {
      const subscription = index < 65 ? 'a' : 'b'
      const row: Record<string, unknown> = article(`row-${index}`, subscription)
      Object.defineProperty(row, 'title', {get: () => {subscription === 'a' ? mappedA++ : mappedB++; return `row-${index}`;}})
      return row
    })
    entries.data.value = rows
    expect(local.entries.value).toHaveLength(51)
    expect(local.entries.value[0].subscription_id).toBe('b')
    expect(mappedA).toBe(0)
    expect(mappedB).toBe(51)
  })
})
