import {
  computed,
  nextTick,
  onScopeDispose,
  reactive,
  type Ref,
  ref,
  shallowRef,
  watch,
} from 'vue'

import { useQuery } from '@powersync/vue'
import type { SyncStreamSubscription } from '@powersync/web'
import type { FeedEntry, FeedSubscription } from '@slax-reader/contracts'
import { rssLocalIso } from '~/composables/rss/useLocalRss'
import type { RssLocalDatabase } from '~/composables/rss/useRssLocalState'

interface NewsletterRow {
  id: string
  source_key: string
  sender: string
  sender_name: string
  title: string
  excerpt: string
  published_at: string | null
  received_at: string
}
interface SavedRow {
  id: string
  message_id: string
}

const PAGE = 50
const PRESENCE_SQL = 'SELECT 1 AS present FROM sr_newsletter_feed LIMIT 1'
const ENTRIES_SQL = `SELECT id, source_key, sender, sender_name, title, excerpt, published_at, received_at
  FROM sr_newsletter_feed ORDER BY received_at DESC, CAST(id AS INTEGER) DESC`
const SAVED_SQL = `SELECT MIN(id) AS id,
    SUBSTR(JSON_EXTRACT(metadata, '$.bookmark.target_url'), 27) AS message_id
  FROM sr_user_bookmark
  WHERE deleted_at IS NULL AND JSON_EXTRACT(metadata, '$.bookmark.target_url') LIKE 'slax-newsletter://message/%'
  GROUP BY 2`
const off = (sql: string) => `SELECT * FROM (${sql}) WHERE 0`

interface NewsletterLocalDatabase extends RssLocalDatabase {
  getAll<T>(sql: string): Promise<T[]>
}

/**
 * Watched queries retain their last array while SQL changes. The initial owned cache can be shown immediately;
 * after ownership or account changes, watched results only invalidate snapshots freshly read from the admitted DB.
 */
function useOwnedNewsletterQuery<T>(
  db: NewsletterLocalDatabase,
  sql: string,
  active: Ref<boolean>,
  account: Ref<unknown>
) {
  const watched = useQuery<T>(
    computed(() => (active.value ? sql : off(sql))),
    []
  )
  const snapshot = shallowRef<ReadonlyArray<Readonly<T>>>([])
  const fenced = ref(false),
    loading = ref(false),
    error = shallowRef<unknown>()
  let generation = 0,
    request = 0
  const refresh = async () => {
    if (!active.value || !fenced.value) return
    const stamp = generation,
      token = ++request
    loading.value = true
    const current = () =>
      stamp === generation && token === request && active.value
    try {
      // Flush ownership-driven query changes before reading the database admitted by guardAccount.
      await nextTick()
      if (!current()) return
      const rows = await db.getAll<T>(sql)
      if (!current()) return
      snapshot.value = rows
      error.value = undefined
    } catch (e) {
      if (current()) error.value = e
    } finally {
      if (current()) loading.value = false
    }
  }
  watch(
    [active, account],
    () => {
      generation++
      request++
      fenced.value = true
      snapshot.value = []
      error.value = undefined
      loading.value = active.value
      if (active.value) void refresh()
    },
    { flush: 'sync' }
  )
  watch(
    watched.data,
    () => {
      if (fenced.value && active.value) void refresh()
    },
    { flush: 'sync' }
  )
  onScopeDispose(() => {
    generation++
    request++
  })
  return {
    data: computed(() =>
      !active.value ? [] : fenced.value ? snapshot.value : watched.data.value
    ),
    isLoading: computed(() =>
      fenced.value ? loading.value : watched.isLoading.value
    ),
    error: computed(() => (fenced.value ? error.value : watched.error.value)),
    refresh,
  }
}

export function useLocalNewsletterPresence(
  db: NewsletterLocalDatabase,
  owned: Ref<boolean>,
  account: Ref<unknown>
) {
  const rows = useOwnedNewsletterQuery<{ present: number }>(
    db,
    PRESENCE_SQL,
    owned,
    account
  )
  return computed(() => owned.value && rows.data.value.length > 0)
}

/** Newsletter synchronizes metadata only. Bodies and confirmed saves continue to use authenticated APIs. */
export function useNewsletterLocalState(
  db: NewsletterLocalDatabase,
  active: Ref<boolean>,
  account: Ref<unknown>,
  selected: Ref<string>
) {
  const rows = useOwnedNewsletterQuery<NewsletterRow>(
    db,
    ENTRIES_SQL,
    active,
    account
  )
  const bookmarks = useOwnedNewsletterQuery<SavedRow>(
    db,
    SAVED_SQL,
    active,
    account
  )
  const limits = reactive(new Map<string, number>())
  const saved = reactive(new Map<string, string>())
  const synced = ref(false),
    streamUnavailable = ref(false)
  let generation = 0,
    handle: SyncStreamSubscription | undefined,
    abort: AbortController | undefined
  const stop = () => {
    generation++
    abort?.abort()
    abort = undefined
    handle?.unsubscribe()
    handle = undefined
    synced.value = false
    streamUnavailable.value = false
    limits.clear()
    saved.clear()
  }
  const start = async () => {
    const stamp = generation,
      controller = new AbortController()
    abort = controller
    try {
      const subscription = await db
        .syncStream('newsletter_v1')
        .subscribe({ ttl: 7 * 24 * 3600 })
      if (stamp !== generation) return subscription.unsubscribe()
      handle = subscription
      await subscription.waitForFirstSync(controller.signal)
      if (stamp !== generation) return
      await Promise.all([rows.refresh?.(), bookmarks.refresh?.()])
      if (stamp === generation) synced.value = true
    } catch {
      if (stamp === generation) streamUnavailable.value = true
    }
  }
  watch(
    [active, account],
    ([on]) => {
      stop()
      if (on) void start()
    },
    { immediate: true, flush: 'sync' }
  )
  onScopeDispose(stop)
  const savedMessages = computed(
    () =>
      new Map(
        bookmarks.data.value.map((row) => [
          `newsletter:${row.message_id}`,
          row.id,
        ])
      )
  )
  const retireSaves = () => {
    for (const [id, bookmark] of saved)
      if (savedMessages.value.get(id) === bookmark) saved.delete(id)
  }
  watch(savedMessages, retireSaves)
  const subscriptions = computed<FeedSubscription[]>(() => {
    if (!active.value) return []
    const sources = new Map<string, FeedSubscription>()
    for (const row of rows.data.value) {
      const id = `newsletter:${row.source_key}`
      if (!sources.has(id))
        sources.set(id, {
          id,
          kind: 'newsletter',
          title: row.sender_name || row.sender,
          sender: row.sender,
        })
    }
    return [...sources.values()]
  })
  const filtered = computed(() =>
    !active.value
      ? []
      : rows.data.value.filter(
          (row) =>
            !selected.value || `newsletter:${row.source_key}` === selected.value
        )
  )
  const limit = computed(() => limits.get(selected.value) || PAGE)
  const entries = computed<FeedEntry[]>(() =>
    filtered.value.slice(0, limit.value).map((row) => {
      const id = `newsletter:${row.id}`,
        received = rssLocalIso(row.received_at)!
      return {
        id,
        kind: 'newsletter',
        subscription_id: `newsletter:${row.source_key}`,
        source_title: row.sender_name || row.sender,
        title: row.title,
        author: row.sender_name,
        summary: row.excerpt,
        article_url: null,
        image_url: null,
        published_at: rssLocalIso(row.published_at),
        first_seen_at: received,
        sort_at: received,
        bookmark_user_uuid:
          saved.get(id) || savedMessages.value.get(id) || null,
      }
    })
  )
  const unavailable = computed(
    () =>
      streamUnavailable.value || !!rows.error.value || !!bookmarks.error.value
  )
  const ready = computed(
    () =>
      active.value &&
      (synced.value || rows.data.value.length > 0) &&
      !rows.isLoading.value &&
      !bookmarks.isLoading.value
  )
  return {
    subscriptions,
    entries,
    ready,
    unavailable,
    hasMore: computed(() => filtered.value.length > limit.value),
    loadMore: () => {
      limits.set(selected.value, limit.value + PAGE)
    },
    save: (id: string, bookmark: string) => {
      saved.set(id, bookmark)
      retireSaves()
    },
  }
}
