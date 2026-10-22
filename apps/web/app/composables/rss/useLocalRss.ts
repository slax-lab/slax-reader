import { computed, type MaybeRef, onScopeDispose, ref, toValue, watch } from 'vue'

import { toUtcDate } from '~/utils/date'

import { useQuery } from '@powersync/vue'
import type { FeedEntry, FeedKind, FeedSubscription, RssErrorCode } from '@slax-reader/contracts'

export interface LocalSubscriptionRow {
  id: string
  kind?: string | null
  feed_url: string | null
  title: string | null
  remark: string | null
  site_url: string | null
  icon_url: string | null
  last_checked_at: string | null
  last_success_at: string | null
  next_fetch_at: string | null
  next_allowed_at: string | null
  error: string | null
  refreshing_until: string | null
}

export interface LocalEntryRow {
  id: string
  kind?: string | null
  subscription_id: string
  source_title: string | null
  title: string | null
  author: string | null
  summary: string | null
  article_url: string | null
  image_url: string | null
  published_at: string | null
  first_seen_at: string | null
  sort_at: string | null
}

interface LocalSavedRow {
  id: string
  article_url: string | null
}

const SUBSCRIPTIONS_SQL = `
  SELECT s.id, COALESCE(f.kind, 'rss') AS kind, f.feed_url, f.title, s.remark, f.site_url, f.icon_url,
    f.last_checked_at, f.last_success_at, f.next_fetch_at, f.next_allowed_at, f.error, f.refreshing_until
  FROM sr_rss_subscription s JOIN sr_rss_feed f ON f.id = s.feed_id
  ORDER BY s.created_at, s.id`

const ENTRIES_SQL = `
  SELECT e.id, COALESCE(f.kind, 'rss') AS kind, s.id AS subscription_id, COALESCE(NULLIF(s.remark, ''), f.title) AS source_title,
    e.title, e.author, e.summary, e.article_url, e.image_url, e.published_at, e.first_seen_at, e.sort_at
  FROM sr_rss_entry e
  JOIN sr_rss_subscription s ON s.feed_id = e.feed_id
  JOIN sr_rss_feed f ON f.id = e.feed_id
  ORDER BY e.sort_at DESC, e.id DESC`

const SAVED_SQL = `
  SELECT JSON_EXTRACT(metadata, '$.bookmark.target_url') AS article_url, MIN(id) AS id
  FROM sr_user_bookmark
  WHERE deleted_at IS NULL AND JSON_EXTRACT(metadata, '$.bookmark.target_url') IS NOT NULL
  GROUP BY 1`

const presenceSql = (kind: FeedKind) => `SELECT 1 AS present FROM sr_rss_subscription s JOIN sr_rss_feed f ON f.id = s.feed_id WHERE COALESCE(f.kind, 'rss') = '${kind}' LIMIT 1`
export const feedRowKind = (row: { kind?: string | null }): FeedKind => (row.kind === 'newsletter' ? 'newsletter' : 'rss')

const MAX_TIMEOUT = 2_147_483_647
const off = (sql: string) => `SELECT * FROM (${sql}) WHERE 0`

const time = (value: string | null) => toUtcDate(value).getTime()
export const rssLocalIso = (value: string | null) => {
  const ms = time(value)
  return Number.isNaN(ms) ? null : new Date(ms).toISOString()
}

export const rssSubscriptionFromRow = (row: LocalSubscriptionRow, now: number): FeedSubscription => ({
  id: row.id,
  kind: feedRowKind(row),
  feed_url: row.feed_url ?? '',
  title: row.title ?? '',
  remark: row.remark,
  site_url: row.site_url,
  icon_url: row.icon_url,
  refreshing: time(row.refreshing_until) > now,
  last_checked_at: rssLocalIso(row.last_checked_at),
  last_success_at: rssLocalIso(row.last_success_at),
  next_fetch_at: rssLocalIso(row.next_fetch_at) ?? row.next_fetch_at ?? '',
  next_allowed_at: rssLocalIso(row.next_allowed_at) ?? row.next_allowed_at ?? '',
  error: (row.error as RssErrorCode | null) || null
})

export const rssEntryFromRow = (row: LocalEntryRow, saved: Map<string, string>): FeedEntry => {
  const published = rssLocalIso(row.published_at),
    seen = rssLocalIso(row.first_seen_at) ?? row.first_seen_at ?? ''
  return {
    id: row.id,
    kind: feedRowKind(row),
    subscription_id: row.subscription_id,
    source_title: row.source_title ?? '',
    title: row.title ?? '',
    author: row.author,
    summary: row.summary ?? '',
    article_url: row.article_url,
    image_url: row.image_url,
    published_at: published,
    first_seen_at: seen,
    sort_at: rssLocalIso(row.sort_at) ?? published ?? seen,
    bookmark_user_uuid: (row.article_url && saved.get(row.article_url)) || null
  }
}

/** Whether the local database holds any RSS subscription row; only queried while `enabled`. */
export function useLocalRssPresence(enabled: MaybeRef<boolean>, kind: FeedKind = 'rss') {
  const PRESENCE_SQL = presenceSql(kind)
  const rows = useQuery<{ present: number }>(
    computed(() => (toValue(enabled) ? PRESENCE_SQL : off(PRESENCE_SQL))),
    []
  )
  return computed(() => toValue(enabled) && rows.data.value.length > 0)
}

/** Reads the synced RSS rows; `selected` filters entries in memory so switching sources never shows a stale query result. */
export function useLocalRss(
  selected: MaybeRef<string>,
  enabled: MaybeRef<boolean>,
  limit: MaybeRef<number> = Infinity,
  excluded: MaybeRef<ReadonlySet<string>> = new Set(),
  kinds: MaybeRef<readonly FeedKind[]> = ['rss']
) {
  const sql = (query: string) => computed(() => (toValue(enabled) ? query : off(query)))
  const sources = useQuery<LocalSubscriptionRow>(sql(SUBSCRIPTIONS_SQL), [])
  const articles = useQuery<LocalEntryRow>(sql(ENTRIES_SQL), [])
  const bookmarks = useQuery<LocalSavedRow>(sql(SAVED_SQL), [])

  // Re-evaluate `refreshing` when the earliest active lease expires instead of polling.
  const now = ref(Date.now())
  let timer: ReturnType<typeof setTimeout> | undefined
  watch(
    [() => sources.data.value, now],
    ([rows]) => {
      if (timer) clearTimeout(timer)
      timer = undefined
      const next = Math.min(...rows.map(row => time(row.refreshing_until)).filter(ms => ms > now.value))
      if (Number.isFinite(next)) timer = setTimeout(() => (now.value = Date.now()), Math.min(Math.max(next - Date.now(), 0) + 50, MAX_TIMEOUT))
    },
    { immediate: true }
  )
  onScopeDispose(() => timer && clearTimeout(timer))

  const savedUrls = computed(() => new Map(bookmarks.data.value.filter(row => row.article_url).map(row => [row.article_url!, row.id])))
  const allowed = (row: { kind?: string | null }) => toValue(enabled) && toValue(kinds).includes(feedRowKind(row))
  const subscriptions = computed(() => sources.data.value.filter(allowed).map(row => rssSubscriptionFromRow(row, now.value)))
  const allEntries = computed(() => articles.data.value.filter(allowed).map(row => rssEntryFromRow(row, savedUrls.value)))
  const entries = computed(() => {
    const id = toValue(selected), maximum = toValue(limit), removed = toValue(excluded)
    const result: FeedEntry[] = []
    // Map only the visible window plus a look-ahead row. A source switch does not remap every other feed.
    for (const row of articles.data.value) {
      if (!allowed(row) || (id && row.subscription_id !== id) || removed.has(row.subscription_id)) continue
      result.push(rssEntryFromRow(row, savedUrls.value))
      if (result.length > maximum) break
    }
    return result
  })
  const isLoading = computed(() => sources.isLoading.value || articles.isLoading.value || bookmarks.isLoading.value)
  const error = computed(() => sources.error.value || articles.error.value || bookmarks.error.value)
  const refresh = () => Promise.all([sources.refresh?.(), articles.refresh?.(), bookmarks.refresh?.()]).then(() => undefined)
  return { subscriptions, entries, allEntries, savedUrls, isLoading, error, refresh }
}
