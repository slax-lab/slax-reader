import { computed, onScopeDispose, type Ref, ref, watch } from 'vue'

import type { RssEntriesResponse, RssEntry, RssEntryDetail, RssRefreshResponse, RssSaveResponse, RssSubscription, RssSubscriptionsResponse } from '@slax-reader/contracts'
import { useRssEnabled } from '~/composables/rss/useRssEnabled'
import { rssLocalDatabase, rssLocalOwned, useRssLocalState } from '~/composables/rss/useRssLocalState'
import { useLabFeatures } from '~/composables/useLabFeatures'
import { useUserStore } from '~/stores/user'

type CachedList = {
  items: RssEntry[]
  cursor: string | null
  pages: number
  updatedAt: number
  hasMore: boolean
  historyStatus: RssEntriesResponse['history_status']
  retryAt: string | null
}
const CACHE_TTL = 60_000
export const rssSubscriptionName = (row: RssSubscription) => row.remark?.trim() || row.title
export const rssSourceText = (name: string) => name.normalize('NFKC').match(/\p{Script=Han}|(?:(?!\p{Script=Han})\p{L})(?:(?!\p{Script=Han})[\p{L}\p{M}])*/u)?.[0] || 'RSS'

/**
 * Owned by the kept-alive Inbox panel; caches are never shared between accounts or SSR requests.
 * An owned local database supplies the lists, showing loading until its first sync or cached rows are ready. REST lists
 * are used only without owned local storage or after a local failure. Writes and explicit history still use REST.
 */
export function useRss() {
  const labs = useLabFeatures(),
    user = useUserStore()
  const restSubscriptions = ref<RssSubscription[]>([]),
    restEntries = ref<RssEntry[]>([])
  const detail = ref<RssEntryDetail | null>(null),
    selected = ref(''),
    restCursor = ref<string | null>(null)
  const restHasMore = ref(false),
    restHistoryStatus = ref<RssEntriesResponse['history_status']>('exhausted'),
    restRetryAt = ref<string | null>(null)
  const restoreList = (snapshot?: CachedList) => {
    restEntries.value = snapshot?.items || []
    restCursor.value = snapshot?.cursor || null
    restHasMore.value = snapshot?.hasMore || false
    restHistoryStatus.value = snapshot?.historyStatus || 'exhausted'
    restRetryAt.value = snapshot?.retryAt || null
  }
  const loading = ref(false),
    initializing = ref(false),
    detailLoading = ref(false),
    pending = ref(false),
    error = ref('')
  const cache = new Map<string, CachedList>()
  let generation = 0,
    detailGeneration = 0,
    initializeGeneration = 0,
    session = 0
  const database = rssLocalDatabase()
  const enabled = database ? useRssEnabled(labs) : computed(() => labs.loaded.value && labs.isEnabled('rss'))
  const owned = database ? rssLocalOwned() : null
  const local = database
    ? useRssLocalState(
        database,
        computed(() => enabled.value && !!user.userInfo?.userId && !!owned?.value),
        computed(() => user.userInfo?.userId),
        selected
      )
    : null
  const live = computed(() => !!local?.ready.value)
  const localMode = computed(() => enabled.value && !!local && !!owned?.value && !local.unavailable.value)
  // Pending synchronization stays local; writes on the fallback path target only the REST cache.
  const view = <T>(rest: Ref<T>, synced: () => T) =>
    computed<T>({
      get: () => (localMode.value ? synced() : rest.value),
      set: value => {
        rest.value = value
      }
    })
  const subscriptions = view(restSubscriptions, () => local!.subscriptions.value),
    entries = view(restEntries, () => (live.value ? local!.entries.value : [])),
    cursor = view(restCursor, () => local!.cursor.value),
    hasMore = view(restHasMore, () => live.value && local!.hasMore.value),
    historyStatus = view(restHistoryStatus, () => local!.historyStatus.value),
    retryAt = view(restRetryAt, () => local!.retryAt.value)
  const fail = (e: unknown) => {
    error.value = e instanceof Error ? e.message : 'source_unavailable'
  }
  const clear = () => {
    session++
    generation++
    detailGeneration++
    initializeGeneration++
    cache.clear()
    restSubscriptions.value = []
    restoreList()
    detail.value = null
    selected.value = ''
    restCursor.value = null
    loading.value = false
    initializing.value = false
    detailLoading.value = false
    pending.value = false
    error.value = ''
  }
  watch(
    () => user.userInfo?.userId,
    id => {
      clear()
      if (id) void initialize()
    }
  )
  watch(enabled, value => {
    if (!value) clear()
  })
  // Losing usable local storage falls back; acquiring it invalidates any in-flight REST list walk.
  watch(localMode, value => {
    if (value) {
      generation++
      loading.value = false
    } else if (enabled.value && user.userInfo?.userId) {
      clear()
      void initialize(true)
    }
  })
  watch([live, () => local?.subscriptions.value], () => {
    if (live.value && selected.value && !local!.subscriptions.value.some(row => row.id === selected.value)) void select('')
  })
  onScopeDispose(clear)

  const fetchPage = (source: string, after: string | null, history = false) =>
    request().get<RssEntriesResponse>({
      url: '/v1/rss/entries',
      query: { ...(source ? { subscription_id: source } : {}), ...(after ? { cursor: after } : {}), ...(history ? { fetch_history: '1' } : {}), limit: '20' }
    })
  // Local rows are live, so only Load more needs the network: one REST page continuing after the displayed rows.
  const loadMoreLocal = async () => {
    const stamp = ++generation
    loading.value = true
    error.value = ''
    try {
      await local!.loadMore()
    } catch (e) {
      if (stamp === generation) fail(e)
    } finally {
      if (stamp === generation) loading.value = false
    }
  }
  const reload = async (more = false) => {
    if (!enabled.value || loading.value || (more && !hasMore.value)) return
    if (localMode.value) {
      if (more && live.value) await loadMoreLocal()
      return
    }
    const source = selected.value,
      stamp = ++generation,
      previous = cache.get(source)
    loading.value = true
    error.value = ''
    try {
      if (more) {
        const result = await fetchPage(source, restCursor.value, true)
        if (stamp !== generation || !enabled.value || localMode.value) return
        if (!result) throw new Error('source_unavailable')
      }
      // Revalidate every loaded page before swapping the list, preserving pagination and old rows while loading.
      // History from another source can belong above the old cursor; re-read the expanded window so none is skipped.
      let next: string | null = null,
        pages = 0,
        items: RssEntry[] = []
      const targetPages = (previous?.pages || 1) + (more ? 1 : 0)
      let page: RssEntriesResponse
      do {
        const result = await fetchPage(source, next)
        if (stamp !== generation || !enabled.value || localMode.value) return
        if (!result) throw new Error('source_unavailable')
        page = result
        items.push(...page.items)
        next = page.next_cursor
        pages++
      } while (next && (page.cached_more ?? true) && pages < targetPages)
      const snapshot: CachedList = {
        items: [...new Map(items.map(item => [item.id, item])).values()],
        cursor: next,
        pages,
        updatedAt: Date.now(),
        hasMore: page.has_more ?? !!next,
        historyStatus: page.history_status || 'exhausted',
        retryAt: page.retry_at || null
      }
      cache.set(source, snapshot)
      restoreList(snapshot)
    } catch (e) {
      if (stamp === generation) fail(e)
    } finally {
      if (stamp === generation) loading.value = false
    }
  }
  const select = async (id: string, force = false) => {
    generation++
    detailGeneration++
    selected.value = id
    detail.value = null
    detailLoading.value = false
    error.value = ''
    loading.value = false
    const cached = cache.get(id)
    restoreList(cached)
    if (localMode.value) return
    if (force || !cached || Date.now() - cached.updatedAt >= CACHE_TTL) await reload()
  }
  const initialize = async (force = false) => {
    const initialization = ++initializeGeneration,
      account = session
    initializing.value = true
    error.value = ''
    try {
      try {
        await labs.fetch()
      } catch (e) {
        // A failed laboratory request (e.g. offline) keeps the local list without reporting an error; only a confirmed
        // response can disable RSS.
        if (local && enabled.value && (live.value || !labs.loaded.value)) return
        throw e
      }
      if (!enabled.value || initialization !== initializeGeneration || account !== session || localMode.value) return
      const result = await request().get<RssSubscriptionsResponse>({ url: '/v1/rss/subscriptions' })
      if (initialization !== initializeGeneration || account !== session) return
      if (!result) throw new Error('source_unavailable')
      const previous = new Map(restSubscriptions.value.map(row => [row.id, row]))
      restSubscriptions.value = result.items
      const ids = new Set(result.items.map(row => row.id))
      for (const [key, snapshot] of cache) {
        if (key && !ids.has(key)) {
          cache.delete(key)
          continue
        }
        // Drop removed subscriptions immediately and keep user-assigned source names in every cached view.
        snapshot.items = snapshot.items
          .filter(row => ids.has(row.subscription_id))
          .map(row => ({ ...row, source_title: rssSubscriptionName(result.items.find(sub => sub.id === row.subscription_id)!) }))
      }
      if (localMode.value) return
      if (selected.value && !ids.has(selected.value)) {
        await select('')
        return
      }
      const changed = result.items.some(
        row =>
          (!selected.value || row.id === selected.value) &&
          (previous.get(row.id)?.last_success_at !== row.last_success_at || previous.get(row.id)?.last_checked_at !== row.last_checked_at)
      )
      const cached = cache.get(selected.value)
      if (cached) {
        restoreList(cached)
      }
      if (!loading.value && (force || changed || !cached || Date.now() - cached.updatedAt >= CACHE_TTL)) await reload()
    } catch (e) {
      if (initialization === initializeGeneration && account === session) fail(e)
    } finally {
      if (initialization === initializeGeneration) initializing.value = false
    }
  }
  const mutate = async (work: () => Promise<void>) => {
    if (pending.value) return
    const account = session
    pending.value = true
    error.value = ''
    try {
      await work()
    } catch (e) {
      if (account === session) fail(e)
    } finally {
      if (account === session) pending.value = false
    }
  }
  const add = (url: string, remark = '') =>
    mutate(async () => {
      const account = session
      const row = await request().post<RssSubscription>({ url: '/v1/rss/subscriptions', body: { url, remark: remark.trim() || null } })
      if (account !== session || !enabled.value) return
      if (!row) throw new Error('source_unavailable')
      local?.add(row)
      restSubscriptions.value = [...restSubscriptions.value.filter(item => item.id !== row.id), row]
      cache.delete('')
      await select(row.id)
    })
  const update = (id: string, remark: string) =>
    mutate(async () => {
      const account = session,
        previous = local?.remark(id)
      const row = await request().post<RssSubscription>({ url: `/v1/rss/subscriptions/${encodeURIComponent(id)}/update`, body: { remark: remark.trim() || null } })
      if (account !== session || !enabled.value) return
      if (!row) throw new Error('source_unavailable')
      local?.rename(row, previous)
      restSubscriptions.value = restSubscriptions.value.map(sub => (sub.id === row.id ? row : sub))
      const renamed = (entry: RssEntry) => (entry.subscription_id === row.id ? { ...entry, source_title: rssSubscriptionName(row) } : entry)
      for (const snapshot of cache.values()) snapshot.items = snapshot.items.map(renamed)
      restEntries.value = restEntries.value.map(renamed)
      if (detail.value?.subscription_id === row.id) detail.value = { ...detail.value, source_title: rssSubscriptionName(row) }
    })
  const remove = (id: string) =>
    mutate(async () => {
      const account = session
      await request().post({ url: `/v1/rss/subscriptions/${encodeURIComponent(id)}/delete` })
      if (account !== session || !enabled.value) return
      local?.remove(id)
      restSubscriptions.value = restSubscriptions.value.filter(row => row.id !== id)
      cache.delete(id)
      for (const snapshot of cache.values()) {
        snapshot.items = snapshot.items.filter(row => row.subscription_id !== id)
        snapshot.updatedAt = 0
      }
      await select(selected.value === id ? '' : selected.value)
    })
  const refresh = () =>
    mutate(async () => {
      const id = selected.value,
        account = session
      if (!id) {
        if (!localMode.value) await initialize(true)
        return
      }
      const result = await request().post<RssRefreshResponse>({ url: `/v1/rss/subscriptions/${encodeURIComponent(id)}/refresh` })
      if (account !== session || !enabled.value) return
      if (!result) throw new Error('source_unavailable')
      local?.refresh(id, result.next_allowed_at)
      const row = restSubscriptions.value.find(item => item.id === id)
      if (row) {
        row.refreshing = true
        row.next_allowed_at = result.next_allowed_at
      }
    })
  const open = async (entry: RssEntry) => {
    const stamp = ++detailGeneration
    detail.value = null
    detailLoading.value = true
    error.value = ''
    try {
      const result = await request().get<RssEntryDetail>({ url: `/v1/rss/entries/${encodeURIComponent(entry.id)}` })
      if (stamp !== detailGeneration || !enabled.value) return
      if (!result) throw new Error('source_unavailable')
      detail.value = result
    } catch (e) {
      if (stamp === detailGeneration) fail(e)
    } finally {
      if (stamp === detailGeneration) detailLoading.value = false
    }
  }
  const closePreview = () => {
    detailGeneration++
    detail.value = null
    detailLoading.value = false
  }
  const save = (entry: RssEntry) =>
    mutate(async () => {
      const account = session
      const result = await request().post<RssSaveResponse>({ url: `/v1/rss/entries/${encodeURIComponent(entry.id)}/save` })
      if (account !== session || !enabled.value) return
      if (!result?.bookmark_user_uuid) throw new Error('source_unavailable')
      const saved = (row: RssEntry) => (row.article_url === entry.article_url ? { ...row, bookmark_user_uuid: result.bookmark_user_uuid } : row)
      if (entry.article_url) local?.save(entry.article_url, result.bookmark_user_uuid)
      for (const snapshot of cache.values()) snapshot.items = snapshot.items.map(saved)
      restEntries.value = restEntries.value.map(saved)
      if (detail.value?.article_url === entry.article_url) detail.value.bookmark_user_uuid = result.bookmark_user_uuid
    })
  return {
    labs,
    subscriptions,
    entries,
    detail,
    selected,
    cursor,
    hasMore,
    historyStatus,
    retryAt,
    enabled,
    loading,
    initializing: computed(() => initializing.value || (enabled.value && localMode.value && !live.value)),
    detailLoading,
    pending,
    error,
    initialize,
    reload,
    select,
    add,
    update,
    remove,
    refresh,
    open,
    closePreview,
    save
  }
}
