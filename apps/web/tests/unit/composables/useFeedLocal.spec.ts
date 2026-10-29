import orderFixture from '../../../../../packages/contracts/test-fixtures/feed-order.json'
import { computed, effectScope, reactive, type Ref, ref } from 'vue'

import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

let labs: {
    loaded: Ref<boolean>
    newsletter: Ref<boolean>
    rss: Ref<boolean>
    isEnabled: (key: string) => boolean
    fetch: ReturnType<typeof vi.fn>
  },
  user: { userInfo: { userId: number } },
  database: {
    syncStream: ReturnType<typeof vi.fn>
    getAll: ReturnType<typeof vi.fn>
  }
const owned = ref(true)
const { get, post, mockRequest, tables, queryErrors } = vi.hoisted(() => {
  const get = vi.fn(),
    post = vi.fn()
  const tables: Record<string, { value: Record<string, unknown>[] }> = {},
    queryErrors: Record<string, { value: unknown }> = {}
  return {
    get,
    post,
    tables,
    queryErrors,
    mockRequest: vi.fn(() => ({ get, post })),
  }
})
mockNuxtImport('request', () => mockRequest)
vi.mock('~/composables/useLabFeatures', () => ({ useLabFeatures: () => labs }))
vi.mock('~/stores/user', () => ({ useUserStore: () => user }))
vi.mock('~/composables/rss/useRssLocalState', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('../../../app/composables/rss/useRssLocalState')
  >()),
  rssLocalDatabase: () => database,
  rssLocalOwned: () => computed(() => owned.value),
}))
vi.mock('@powersync/vue', () => ({
  useQuery: (sql: { value: string }) => {
    const text = sql.value
    const key = text.includes('AS present')
      ? text.includes('sr_newsletter_feed')
        ? 'mailPresence'
        : 'rssPresence'
      : text.includes('FROM sr_newsletter_feed')
      ? 'mail'
      : text.includes('FROM sr_rss_entry')
      ? 'entries'
      : text.includes('FROM sr_user_bookmark')
      ? text.includes('slax-newsletter://message/')
        ? 'mailSaved'
        : 'saved'
      : 'subscriptions'
    const data = tables[key] || ref<Record<string, unknown>[]>([]),
      error = ref<unknown>(undefined)
    tables[key] = data
    queryErrors[key] = error
    return {
      data,
      isLoading: ref(false),
      error,
      refresh: vi.fn(async () => {}),
    }
  },
}))

import { useFeed } from '../../../app/composables/useFeed'

const pending = () => {
  let resolve!: () => void
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}
const streams = new Map<
  string,
  {
    first: ReturnType<typeof pending>
    handles: {
      waitForFirstSync: () => Promise<void>
      unsubscribe: ReturnType<typeof vi.fn>
    }[]
    subscribe: ReturnType<typeof vi.fn>
  }
>()
const scopes: ReturnType<typeof effectScope>[] = []
const sub = (id = 'rss-a') => ({
  id,
  feed_url: `https://example.com/${id}.xml`,
  title: id,
  remark: null,
  site_url: null,
  icon_url: null,
  last_checked_at: null,
  last_success_at: null,
  next_fetch_at: '2026-10-20 00:00:00',
  next_allowed_at: '2026-10-20 00:00:00',
  error: null,
  refreshing_until: null,
})
const rss = (id: string, source = 'rss-a', at = '2026-10-20 00:00:00') => ({
  id,
  subscription_id: source,
  source_title: source,
  title: id,
  author: null,
  summary: '',
  article_url: `https://example.com/${id}`,
  image_url: null,
  published_at: null,
  first_seen_at: at,
  sort_at: at,
})
const mail = (id: string, source = 'sender', at = '2026-10-20 00:00:00') => ({
  id,
  source_key: source,
  sender: `${source}@example.com`,
  sender_name: source,
  title: id,
  excerpt: '',
  published_at: null,
  received_at: at,
})
const page = (items: Record<string, unknown>[], extra = {}) => ({
  items,
  next_cursor: null,
  has_more: false,
  cached_more: false,
  history_status: 'exhausted',
  retry_at: null,
  ...extra,
})
const create = () => {
  const scope = effectScope()
  scopes.push(scope)
  return scope.run(() => useFeed())!
}
const seed = () => {
  tables.subscriptions.value = [sub()]
  tables.entries.value = [rss('rss-1')]
  tables.mail.value = [
    mail('9'),
    mail('10'),
    mail('9223372036854775807'),
    mail('9223372036854775806'),
  ]
}
beforeEach(() => {
  for (const key of Object.keys(tables)) delete tables[key]
  for (const key of Object.keys(queryErrors)) delete queryErrors[key]
  for (const key of [
    'mail',
    'subscriptions',
    'entries',
    'mailSaved',
    'saved',
  ]) {
    tables[key] = ref([])
    queryErrors[key] = ref(undefined)
  }
  streams.clear()
  database = {
    getAll: vi.fn(async (sql: string) => {
      const key = sql.includes('AS present')
        ? 'mailPresence'
        : sql.includes('FROM sr_newsletter_feed')
        ? 'mail'
        : 'mailSaved'
      return tables[key]?.value || []
    }),
    syncStream: vi.fn((name: string) => {
      if (!streams.has(name)) {
        const first = pending(),
          handles: {
            waitForFirstSync: () => Promise<void>
            unsubscribe: ReturnType<typeof vi.fn>
          }[] = []
        streams.set(name, {
          first,
          handles,
          subscribe: vi.fn(async () => {
            const handle = {
              waitForFirstSync: () => first.promise,
              unsubscribe: vi.fn(),
            }
            handles.push(handle)
            return handle
          }),
        })
      }
      return { subscribe: streams.get(name)!.subscribe }
    }),
  }
  owned.value = true
  const newsletter = ref(true),
    rssEnabled = ref(true)
  labs = {
    loaded: ref(true),
    isEnabled: (key: string) =>
      key === 'rss' ? rssEnabled.value : newsletter.value,
    fetch: vi.fn(),
    newsletter,
    rss: rssEnabled,
  }
  user = reactive({ userInfo: { userId: 1 } })
  get.mockReset()
  get.mockResolvedValue(page([]))
  post.mockReset()
})
afterEach(() => {
  scopes.splice(0).forEach((scope) => scope.stop())
})

test('owned pending streams keep mixed lists local and expose cached metadata before first sync', async () => {
  const feed = create()
  await feed.initialize()
  expect(feed.initializing.value).toBe(true)
  await feed.reload()
  await feed.select('newsletter:sender')
  expect(get).not.toHaveBeenCalled()
  seed()
  await feed.select('')
  expect(feed.subscriptions.value.map((row) => row.id)).toEqual([
    'rss-a',
    'newsletter:sender',
  ])
  expect(feed.entries.value.map((row) => row.id)).toEqual([
    'rss-1',
    'newsletter:9223372036854775807',
    'newsletter:9223372036854775806',
    'newsletter:10',
    'newsletter:9',
  ])
  expect(database.syncStream).toHaveBeenCalledWith('rss_v1')
  expect(database.syncStream).toHaveBeenCalledWith('newsletter_v1')
  expect(get).not.toHaveBeenCalled()
})

test('a Newsletter stream failure leaves healthy cached RSS local and reports the failure without mixed REST fallback', async () => {
  const feed = create()
  seed()
  queryErrors.mail.value = new Error('offline')
  await feed.initialize()
  await feed.reload()
  expect(feed.entries.value[0].id).toBe('rss-1')
  expect(feed.error.value).toBe('source_unavailable')
  expect(get).not.toHaveBeenCalled()
})

test('Newsletter and RSS laboratory switches independently fence local rows and streams', async () => {
  const feed = create()
  seed()
  await flushPromises()
  labs.rss.value = false
  expect(feed.entries.value.every((row) => row.kind === 'newsletter')).toBe(
    true
  )
  await flushPromises()
  expect(streams.get('rss_v1')!.handles[0].unsubscribe).toHaveBeenCalledOnce()
  expect(
    streams.get('newsletter_v1')!.handles[0].unsubscribe
  ).not.toHaveBeenCalled()
  labs.rss.value = true
  labs.newsletter.value = false
  expect(feed.entries.value).toEqual([])
  await flushPromises()
  expect(
    streams.get('newsletter_v1')!.handles[0].unsubscribe
  ).toHaveBeenCalledOnce()
  expect(get).not.toHaveBeenCalled()
})

test('owned cached messages provisionally enable Newsletter before Labs answers and confirmed disable clears it', async () => {
  labs.loaded.value = false
  labs.fetch.mockRejectedValue(new TypeError('Failed to fetch'))
  tables.mailPresence = ref([{ present: 1 }])
  tables.rssPresence = ref([{ present: 1 }])
  const feed = create()
  seed()
  await feed.initialize()
  expect(feed.enabled.value).toBe(true)
  expect(feed.entries.value).toHaveLength(5)
  expect(feed.error.value).toBe('')
  expect(get).not.toHaveBeenCalled()
  labs.newsletter.value = false
  labs.loaded.value = true
  expect(feed.enabled.value).toBe(false)
  expect(feed.entries.value).toEqual([])
})

test('account ownership loss synchronously hides local rows and fences late detail and save responses', async () => {
  const feed = create()
  seed()
  const entry = feed.entries.value.find((row) => row.kind === 'newsletter')!
  let finishDetail!: (value: unknown) => void,
    finishSave!: (value: unknown) => void
  get.mockReturnValueOnce(
    new Promise((resolve) => {
      finishDetail = resolve
    })
  )
  post.mockReturnValueOnce(
    new Promise((resolve) => {
      finishSave = resolve
    })
  )
  const opening = feed.open(entry),
    saving = feed.save(entry)
  owned.value = false
  user.userInfo = { userId: 2 }
  expect(feed.entries.value).toEqual([])
  await flushPromises()
  finishDetail({ ...entry, content_html: 'old body' })
  finishSave({ bookmark_user_uuid: 'old-save' })
  await Promise.all([opening, saving])
  expect(feed.detail.value).toBeNull()
  expect(feed.entries.value).toEqual([])
  expect(
    streams.get('newsletter_v1')!.handles[0].unsubscribe
  ).toHaveBeenCalledOnce()
})

test('Newsletter pagination is local per source and preserves each selected window', async () => {
  labs.rss.value = false
  const feed = create()
  tables.mail.value = Array.from({ length: 120 }, (_, i) =>
    mail(String(120 - i), i % 2 ? 'a' : 'b')
  )
  await feed.select('newsletter:a')
  expect(feed.entries.value).toHaveLength(50)
  expect(feed.hasMore.value).toBe(true)
  await feed.reload(true)
  expect(feed.entries.value).toHaveLength(60)
  expect(feed.hasMore.value).toBe(false)
  await feed.select('newsletter:b')
  expect(feed.entries.value).toHaveLength(50)
  await feed.select('newsletter:a')
  expect(feed.entries.value).toHaveLength(60)
  expect(get).not.toHaveBeenCalled()
})

test('mixed Load more retains RSS history pagination and merges older Newsletter rows without mixing REST cursors', async () => {
  const feed = create()
  tables.subscriptions.value = [sub()]
  tables.entries.value = [rss('rss-1')]
  tables.mail.value = Array.from({ length: 60 }, (_, i) =>
    mail(String(60 - i), 'sender', '2026-10-19 00:00:00')
  )
  expect(feed.entries.value).toHaveLength(51)
  get.mockResolvedValueOnce(
    page(
      [
        {
          ...rss('old-rss', 'rss-a', '2026-10-18 00:00:00'),
          bookmark_user_uuid: null,
        },
      ],
      { has_more: true, next_cursor: 'rss-next', cached_more: true }
    )
  )
  await feed.reload(true)
  expect(feed.entries.value).toHaveLength(62)
  expect(get.mock.calls[0][0]).toMatchObject({
    url: '/v1/rss/entries',
    query: { before: 'rss-1', fetch_history: '1' },
  })
  get
    .mockResolvedValueOnce(page([]))
    .mockResolvedValueOnce(
      page([{ ...rss('old-rss'), bookmark_user_uuid: null }], {
        next_cursor: 'rss-next',
        has_more: true,
        cached_more: true,
      })
    )
    .mockResolvedValueOnce(
      page([{ ...rss('oldest-rss'), bookmark_user_uuid: null }])
    )
  await feed.reload(true)
  expect(get.mock.calls[1][0].query).toMatchObject({
    cursor: 'rss-next',
    fetch_history: '1',
  })
  expect(
    get.mock.calls.every(([value]) => value.url === '/v1/rss/entries')
  ).toBe(true)
})

test('confirmed Newsletter saves overlay by message identity and yield to synced bookmark deletion', async () => {
  const feed = create()
  seed()
  const entry = feed.entries.value.find((row) => row.id === 'newsletter:10')!
  get.mockResolvedValueOnce({ ...entry, content_html: 'body' })
  await feed.open(entry)
  post.mockResolvedValueOnce({ bookmark_user_uuid: 'saved' })
  await feed.save(entry)
  expect(
    feed.entries.value
      .filter((row) => row.bookmark_user_uuid)
      .map((row) => row.id)
  ).toEqual(['newsletter:10'])
  expect(feed.detail.value?.bookmark_user_uuid).toBe('saved')
  tables.mailSaved.value = [{ id: 'saved', message_id: '10' }]
  await flushPromises()
  tables.mailSaved.value = []
  await flushPromises()
  expect(
    feed.entries.value.find((row) => row.id === 'newsletter:10')!
      .bookmark_user_uuid
  ).toBeNull()
  expect(post.mock.calls[0][0].url).toBe(
    '/v1/feed/entries/newsletter%3A10/save'
  )
})

test('RSS mutation overlays are preserved in the mixed local list', async () => {
  const feed = create()
  seed()
  await flushPromises()
  post.mockResolvedValueOnce({ ...sub(), remark: 'Renamed', refreshing: false })
  await feed.update('rss-a', 'Renamed')
  expect(
    feed.entries.value.find((row) => row.kind === 'rss')!.source_title
  ).toBe('Renamed')
  post.mockResolvedValueOnce({ bookmark_user_uuid: 'rss-saved' })
  await feed.save(feed.entries.value.find((row) => row.kind === 'rss')!)
  expect(
    feed.entries.value.find((row) => row.kind === 'rss')!.bookmark_user_uuid
  ).toBe('rss-saved')
  post.mockResolvedValueOnce(undefined)
  await feed.remove('rss-a')
  expect(feed.entries.value.every((row) => row.kind === 'newsletter')).toBe(
    true
  )
  expect(get).not.toHaveBeenCalled()
})

test('a failed Newsletter subscription never selects mixed REST even when no Newsletter metadata arrived', async () => {
  const feed = create()
  streams
    .get('newsletter_v1')!
    .subscribe.mockRejectedValueOnce(new Error('offline'))
  labs.newsletter.value = false
  labs.newsletter.value = true
  tables.subscriptions.value = [sub()]
  tables.entries.value = [rss('rss-1')]
  await flushPromises()
  await feed.initialize()
  expect(feed.entries.value.map((row) => row.id)).toEqual(['rss-1'])
  expect(feed.error.value).toBe('source_unavailable')
  expect(get).not.toHaveBeenCalled()
})

test('a late RSS rename response cannot cross an off-on laboratory boundary', async () => {
  const feed = create()
  seed()
  let finish!: (value: unknown) => void
  post.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve
    })
  )
  const updating = feed.update('rss-a', 'Old session')
  labs.rss.value = false
  labs.rss.value = true
  finish({ ...sub(), remark: 'Old session' })
  await updating
  expect(
    feed.entries.value.find((row) => row.kind === 'rss')!.source_title
  ).toBe('rss-a')
})

test('a successful RSS action clears its operation error even while the mixed list reports Newsletter synchronization failure', async () => {
  const feed = create()
  seed()
  queryErrors.mail.value = new Error('offline')
  await feed.initialize()
  expect(feed.error.value).toBe('source_unavailable')
  feed.error.value = ''
  post.mockResolvedValueOnce({ ...sub(), remark: 'Renamed' })
  await feed.update('rss-a', 'Renamed')
  expect(feed.error.value).toBe('')
  expect(
    feed.entries.value.find((row) => row.kind === 'rss')!.source_title
  ).toBe('Renamed')
  await feed.reload()
  expect(feed.error.value).toBe('source_unavailable')
  post.mockResolvedValueOnce(undefined)
  await feed.remove('rss-a')
  expect(feed.error.value).toBe('')
  expect(feed.entries.value.every((row) => row.kind === 'newsletter')).toBe(
    true
  )
  expect(get).not.toHaveBeenCalled()
})

test('re-admitting another owner cannot expose retained Newsletter rows or saved IDs before fresh database reads complete', async () => {
  labs.rss.value = false
  const feed = create()
  tables.mail.value = [
    {
      ...mail('10', 'old-sender'),
      title: 'Private A title',
      excerpt: 'Private A excerpt',
    },
  ]
  tables.mailSaved.value = [{ id: 'private-a-bookmark', message_id: '10' }]
  expect(feed.entries.value[0]).toMatchObject({
    title: 'Private A title',
    bookmark_user_uuid: 'private-a-bookmark',
  })
  let finishRows!: (rows: Record<string, unknown>[]) => void,
    finishSaved!: (rows: Record<string, unknown>[]) => void
  database.getAll.mockImplementation(
    (sql: string) =>
      new Promise((resolve) => {
        if (
          sql.includes('FROM sr_newsletter_feed') &&
          !sql.includes('AS present')
        )
          finishRows = resolve
        else if (sql.includes('FROM sr_user_bookmark')) finishSaved = resolve
        else resolve([])
      })
  )
  owned.value = false
  user.userInfo = { userId: 2 }
  owned.value = true
  expect(feed.entries.value).toEqual([])
  expect(feed.subscriptions.value).toEqual([])
  await flushPromises()
  expect(feed.entries.value).toEqual([])
  const current = [
    { ...mail('10', 'new-sender'), title: 'B title', excerpt: 'B excerpt' },
  ]
  finishRows(current)
  finishSaved([])
  await flushPromises()
  expect(
    feed.entries.value.map((row) => [
      row.title,
      row.source_title,
      row.summary,
      row.bookmark_user_uuid,
    ])
  ).toEqual([['B title', 'new-sender', 'B excerpt', null]])
  database.getAll.mockImplementation(async (sql: string) =>
    sql.includes('FROM sr_newsletter_feed') ? current : []
  )
  // An old watched result arriving late must only invalidate the admitted snapshot, never become visible data.
  tables.mail.value = [
    {
      ...mail('10', 'old-sender'),
      title: 'Late private A title',
      excerpt: 'Late private A excerpt',
    },
  ]
  tables.mailSaved.value = [{ id: 'late-private-a-bookmark', message_id: '10' }]
  expect(feed.entries.value[0].title).toBe('B title')
  await flushPromises()
  expect(feed.entries.value[0]).toMatchObject({
    title: 'B title',
    source_title: 'new-sender',
    summary: 'B excerpt',
    bookmark_user_uuid: null,
  })
})

test('retained Newsletter presence cannot provisionally enable the next account before its fresh database read', async () => {
  labs.rss.value = false
  labs.loaded.value = false
  tables.mailPresence = ref([{ present: 1 }])
  const feed = create()
  expect(feed.newsletterEnabled.value).toBe(true)
  let finishPresence!: (rows: Record<string, unknown>[]) => void
  database.getAll.mockImplementation((sql: string) =>
    sql.includes('AS present')
      ? new Promise((resolve) => {
          finishPresence = resolve
        })
      : Promise.resolve([])
  )
  owned.value = false
  user.userInfo = { userId: 2 }
  owned.value = true
  expect(feed.newsletterEnabled.value).toBe(false)
  expect(feed.entries.value).toEqual([])
  await flushPromises()
  expect(feed.newsletterEnabled.value).toBe(false)
  finishPresence([])
  await flushPromises()
  expect(feed.newsletterEnabled.value).toBe(false)
  expect(feed.subscriptions.value).toEqual([])
})


test('mixed local composition follows the shared literal server ordering examples', () => {
  const feed = create()
  seed()
  tables.entries.value = orderFixture.rows.filter(row => row.kind === 'rss').map(row => ({ ...rss(row.id, 'rss-a', row.sort_at), published_at: row.published_at }))
  tables.mail.value = orderFixture.rows.filter(row => row.kind === 'newsletter').map(row => ({ ...mail(row.id.slice(11), 'sender', row.sort_at), published_at: row.published_at }))
  expect(feed.entries.value.map(row => row.id)).toEqual(orderFixture.expected)
  expect(get).not.toHaveBeenCalled()
})
