import { computed, onScopeDispose, reactive, type Ref, ref, watch } from 'vue'

import { getUserToken } from '~/utils/request'
import { getTokenUserId } from '~/utils/sessionOwner'

import { RequestError } from '@commons/frontend-utils/request'
import type { SyncStream, SyncStreamSubscription } from '@powersync/web'
import type { FeedEntriesResponse, FeedEntry, FeedKind, FeedSubscription } from '@slax-reader/contracts'
import { feedRowKind, useLocalRss } from '~/composables/rss/useLocalRss'
import { isLocalFirstEnabled } from '~/composables/useLocalFirst'

export const RSS_STREAM = 'rss_v1'
export const NEWSLETTER_STREAM = 'newsletter_v1'
export const RSS_STREAM_TTL = 7 * 24 * 3600
export const RSS_LOCAL_PAGE = 50

export interface RssLocalDatabase {
  syncStream(name: string): SyncStream
}

type Page = Pick<FeedEntriesResponse, 'items' | 'next_cursor' | 'has_more' | 'history_status' | 'retry_at'> & {
  /** Local row the REST window starts after (`before`); null walks from the top. */
  anchor: string | null
  pages: number
}
type RefreshOverlay = { nextAllowedAt: string; lastCheckedAt: string | null; lastSuccessAt: string | null }

const sameTime = (a: string | null, b: string | null) => (a && b ? Date.parse(a) === Date.parse(b) : a === b)
const displayName = (row: FeedSubscription) => row.remark?.trim() || row.title
const position = (row: FeedEntry) => Date.parse(row.sort_at || row.published_at || row.first_seen_at) || 0
const timeline = (a: FeedEntry, b: FeedEntry) => position(b) - position(a) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0)
const missing = (error: unknown) => error instanceof RequestError && error.code === 404
const silent = () => {}

/**
 * Local-first RSS list state: subscribes to the on-demand stream while `active`, and overlays confirmed REST writes and
 * REST history pages on the synced rows. Overlays are dropped once local data agrees, and everything resets when
 * `active` or the account changes. Rows already in the local database are shown before the stream's first sync, so a
 * reload or an offline visit does not wait for the network.
 */
export function useRssLocalState(db: RssLocalDatabase, active: Ref<boolean>, account: Ref<unknown>, selected: Ref<string>, kinds: Ref<FeedKind[]> = ref(['rss'])) {
  const pages = reactive(new Map<string, Page>())
  const limits = reactive(new Map<string, number>())
  const removed = reactive(new Map<string, boolean>())
  const limit = computed(() => (pages.has(selected.value) ? Infinity : limits.get(selected.value) || RSS_LOCAL_PAGE))
  const local = useLocalRss(selected, active, limit, computed(() => new Set(removed.keys())),
    kinds
  )
  const synced = reactive(new Set<FeedKind>())
  const failed = reactive(new Set<FeedKind>())
  const ready = computed(() => active.value && (synced.size > 0 || local.subscriptions.value.length > 0) && !local.isLoading.value && !local.error.value)
  const unavailable = computed(() => !!local.error.value || (kinds.value.length > 0 && kinds.value.every(kind => failed.has(kind)) && !ready.value))

  const added = reactive(new Map<string, FeedSubscription>())
  const renamed = reactive(new Map<string, { remark: string | null; previous: string | null | undefined }>())
  const refreshed = reactive(new Map<string, RefreshOverlay>())
  const saved = reactive(new Map<string, string>())
  const tokens = new Map<string, number>()

  const streams = new Map<FeedKind, { handle?: SyncStreamSubscription; controller: AbortController }>()
  let generation = 0
  const stopStream = (kind: FeedKind) => {
    const stream = streams.get(kind)
    streams.delete(kind)
    stream?.controller.abort()
    stream?.handle?.unsubscribe()
    synced.delete(kind)
    failed.delete(kind)
  }
  const stop = () => {
    generation++
    for (const kind of streams.keys()) stopStream(kind)
    added.clear()
    renamed.clear()
    removed.clear()
    refreshed.clear()
    saved.clear()
    pages.clear()
    limits.clear()
    tokens.clear()
  }
  const start = async (kind: FeedKind) => {
    const stream = { controller: new AbortController() } as {
      handle?: SyncStreamSubscription
      controller: AbortController
    }
    streams.set(kind, stream)
    const current = () => streams.get(kind) === stream
    try {
      const subscription = await db.syncStream(kind === 'rss' ? RSS_STREAM : NEWSLETTER_STREAM).subscribe({ ttl: RSS_STREAM_TTL })
      if (!current()) return subscription.unsubscribe()
      stream.handle = subscription
      await subscription.waitForFirstSync(stream.controller.signal)
      if (!current()) return
      await local.refresh()
      if (current()) synced.add(kind)
    } catch {
      if (current()) failed.add(kind)
    }
  }
  const reconcileStreams = () => {
    const allowed = active.value ? kinds.value : []
    for (const kind of streams.keys()) if (!allowed.includes(kind)) stopStream(kind)
    for (const kind of allowed) if (!streams.has(kind)) void start(kind)
  }
  watch(
    [active, account],
    () => {
      stop()
      reconcileStreams()
    },
    { immediate: true, flush: 'sync' }
  )
  watch(
    kinds,
    () => {
      generation++
      // Keep the other kind's loaded history, but re-anchor requests because cursors bind the effective kinds.
      for (const [source, page] of pages) {
        if (source && !local.subscriptions.value.some(row => row.id === source)) {
          pages.delete(source)
          continue
        }
        page.items = page.items.filter(row => kinds.value.includes(feedRowKind(row)))
        page.next_cursor = null
        if (page.anchor && !local.allEntries.value.some(row => row.id === page.anchor)) page.anchor = oldestLocal(source)
      }
      tokens.clear()
      if (!kinds.value.includes('rss')) {
        added.clear()
        renamed.clear()
        removed.clear()
        refreshed.clear()
        saved.clear()
      }
      reconcileStreams()
    },
    { flush: 'sync' }
  )
  onScopeDispose(stop)

  // Drop overlays once the synced rows reflect the confirmed server state.
  const retireOverlays = () => {
    if (!ready.value) return
    const rows = new Map(local.subscriptions.value.map(row => [row.id, row]))
    for (const id of added.keys()) if (rows.has(id)) added.delete(id)
    for (const [id, overlay] of renamed) {
      const row = rows.get(id)
      if (!row) {
        if (!added.has(id)) renamed.delete(id)
        continue
      }
      const remark = row.remark ?? null
      if (remark === overlay.remark || (overlay.previous !== undefined && remark !== overlay.previous)) renamed.delete(id)
      else overlay.previous = remark
    }
    for (const [id, seen] of removed) {
      if (rows.has(id)) removed.set(id, true)
      else if (seen) removed.delete(id)
    }
    for (const [id, overlay] of refreshed) {
      const row = rows.get(id)
      if (!row) {
        if (!added.has(id)) refreshed.delete(id)
        continue
      }
      const settled =
        !sameTime(row.last_checked_at, overlay.lastCheckedAt) ||
        !sameTime(row.last_success_at, overlay.lastSuccessAt) ||
        (row.refreshing && Date.parse(row.next_allowed_at) >= Date.parse(overlay.nextAllowedAt))
      if (settled) refreshed.delete(id)
    }
    for (const [url, id] of saved) if (local.savedUrls.value.get(url) === id) saved.delete(url)
  }
  watch([local.subscriptions, local.savedUrls, ready], retireOverlays)

  const subscriptions = computed<FeedSubscription[]>(() => {
    const rows = new Map(local.subscriptions.value.map(row => [row.id, row]))
    for (const [id, row] of added) if (!rows.has(id)) rows.set(id, row)
    return [...rows.values()]
      .filter(row => !removed.has(row.id) && kinds.value.includes(feedRowKind(row)))
      .map(row => {
        const refresh = refreshed.get(row.id)
        return {
          ...row,
          ...(renamed.has(row.id) ? { remark: renamed.get(row.id)!.remark } : {}),
          ...(refresh ? { refreshing: true, next_allowed_at: refresh.nextAllowedAt } : {})
        }
      })
  })
  const page = computed(() => pages.get(selected.value))
  // Saved state always comes from local bookmarks plus confirmed saves, never from a REST page.
  const decorate = (rows: FeedEntry[]) => {
    const sources = new Map(subscriptions.value.map(row => [row.id, row]))
    const result: FeedEntry[] = []
    for (const row of rows) {
      const source = sources.get(row.subscription_id)
      if (!source || !kinds.value.includes(feedRowKind(row))) continue
      const bookmark = row.article_url ? saved.get(row.article_url) || local.savedUrls.value.get(row.article_url) : null
      result.push({ ...row, source_title: displayName(source), bookmark_user_uuid: bookmark || null })
    }
    return result
  }
  const localRows = computed(() => decorate(local.entries.value))
  // Only the first local rows are rendered until Load more reveals the rest; once REST pages are merged in, every
  // local row is shown so the combined timeline has no gaps.
  const hidden = computed(() => localRows.value.length > limit.value)
  const entries = computed<FeedEntry[]>(() => {
    if (!page.value) return hidden.value ? localRows.value.slice(0, limit.value) : localRows.value
    const ids = new Set(localRows.value.map(row => row.id))
    return [...localRows.value, ...decorate(page.value.items.filter(row => !ids.has(row.id)))].sort(timeline)
  })
  const hasMore = computed(() => page.value?.has_more ?? (localRows.value.length > 0 || subscriptions.value.length > 0))
  const historyStatus = computed<FeedEntriesResponse['history_status']>(() => page.value?.history_status || 'available')
  const retryAt = computed(() => page.value?.retry_at || null)
  const cursor = computed(() => page.value?.next_cursor || null)

  const read = (source: string, query: Record<string, string>, quiet = false) =>
    request().get<FeedEntriesResponse>({
      url: '/v1/feed/entries',
      query: { ...(source ? { subscription_id: source } : {}), ...query, limit: '20' },
      ...(quiet ? { errorInterceptors: silent } : {})
    })
  /** Oldest synced row of `source` still shown (never a REST-merged row), skipping `except`. */
  const oldestLocal = (source: string, except?: string) => {
    const sources = new Set(subscriptions.value.map(row => row.id))
    return local.allEntries.value.findLast(row => sources.has(row.subscription_id) && (!source || row.subscription_id === source) && row.id !== except)?.id ?? null
  }
  // `first` extends the first request. A pruned anchor answers 404; that request stays silent so the caller can re-anchor.
  const walk = async (source: string, anchor: string | null, target: number, current: () => boolean, first: Record<string, string> = {}, quiet = false) => {
    const items = new Map<string, FeedEntry>()
    let next: string | null = null,
      count = 0,
      result: FeedEntriesResponse | undefined
    do {
      const query: Record<string, string> = next ? { cursor: next } : { ...(anchor ? { before: anchor } : {}), ...first }
      result = await read(source, query, quiet || (!next && !!anchor))
      if (!current()) return null
      if (!result) throw new Error('source_unavailable')
      for (const row of result.items) if (!items.has(row.id)) items.set(row.id, row)
      next = result.next_cursor
      count++
    } while (next && (result.cached_more ?? true) && count < target)
    return {
      items: [...items.values()],
      next_cursor: next,
      has_more: result.has_more ?? !!next,
      history_status: result.history_status || 'exhausted',
      retry_at: result.retry_at || null,
      anchor,
      pages: count
    } satisfies Page
  }
  const claim = (source: string) => {
    const stamp = generation,
      token = (tokens.get(source) || 0) + 1
    tokens.set(source, token)
    return () => stamp === generation && tokens.get(source) === token
  }

  /**
   * Reveals the next hidden local rows; once none remain, loads history like the REST list does. The REST window starts
   * `before` an anchor fixed at the first Load more to the oldest local row; that first request also fetches history and
   * returns history rows newer than the anchor. Later clicks send the `fetch_history` request at the window's cursor, then
   * re-walk the window from the anchor through one more page, because history can land anywhere in the timeline,
   * including above the old cursor. The re-walked window replaces the source's REST pages before merging with local rows.
   */
  const loadMore = async () => {
    const source = selected.value,
      previous = pages.get(source)
    if (!previous && hidden.value) {
      limits.set(source, limit.value + RSS_LOCAL_PAGE)
      return
    }
    const current = claim(source)
    let anchor = previous ? previous.anchor : oldestLocal(source)
    if (previous) {
      const fetched = await read(source, { ...(previous.next_cursor ? { cursor: previous.next_cursor } : anchor ? { before: anchor } : {}), fetch_history: '1' })
      if (!current()) return
      if (!fetched) throw new Error('source_unavailable')
    }
    const target = (previous?.pages || 0) + 1,
      first: Record<string, string> = previous ? {} : { fetch_history: '1' }
    let page: Page | null
    try {
      page = await walk(source, anchor, target, current, first)
    } catch (error) {
      if (!anchor || !missing(error) || !current()) throw error
      anchor = oldestLocal(source, anchor)
      page = await walk(source, anchor, target, current, first)
    }
    if (page) pages.set(source, page)
  }
  return {
    ready,
    unavailable,
    subscriptions,
    entries,
    hasMore,
    historyStatus,
    retryAt,
    cursor,
    loadMore,
    add: (row: FeedSubscription) => {
      removed.delete(row.id)
      added.set(row.id, row)
      retireOverlays()
    },
    remark: (id: string) => local.subscriptions.value.find(row => row.id === id)?.remark,
    rename: (row: FeedSubscription, previous: string | null | undefined) => {
      renamed.set(row.id, { remark: row.remark ?? null, previous })
      if (added.has(row.id)) added.set(row.id, row)
      retireOverlays()
    },
    remove: (id: string) => {
      added.delete(id)
      renamed.delete(id)
      refreshed.delete(id)
      removed.set(id, local.subscriptions.value.some(row => row.id === id))
      for (const [key, value] of pages) {
        if (key === id) pages.delete(key)
        else value.items = value.items.filter(row => row.subscription_id !== id)
      }
    },
    refresh: (id: string, nextAllowedAt: string) => {
      const row = local.subscriptions.value.find(item => item.id === id) ?? added.get(id)
      if (row && Date.parse(row.next_allowed_at) >= Date.parse(nextAllowedAt)) return
      refreshed.set(id, { nextAllowedAt, lastCheckedAt: row?.last_checked_at ?? null, lastSuccessAt: row?.last_success_at ?? null })
    },
    save: (url: string, bookmark: string) => {
      saved.set(url, bookmark)
      // A sync checkpoint can precede the REST response; do not leave an already-confirmed overlay behind.
      retireOverlays()
    }
  }
}

/** The PowerSync database when local-first storage is available in this client, otherwise null (REST only). */
export const rssLocalDatabase = (): RssLocalDatabase | null => (isLocalFirstEnabled() ? useNuxtApp().$powersync : null)

/** True when the local database belongs to the signed-in account, so its rows may be shown before the server answers. */
export const rssLocalOwned = () => {
  const owner = useState<string | null>('powersync-owner', () => null)
  return computed(() => !!owner.value && owner.value === getTokenUserId(getUserToken()))
}
