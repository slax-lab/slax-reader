import { computed, onScopeDispose, ref, watch } from 'vue'

import type { RssEntriesResponse, RssEntry, RssEntryDetail, RssRefreshResponse, RssSaveResponse, RssSubscription, RssSubscriptionsResponse } from '@slax-reader/contracts'
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

/** Owned by the kept-alive Inbox panel; caches are never shared between accounts or SSR requests. */
export function useRss() {
  const labs = useLabFeatures(),
    user = useUserStore()
  const subscriptions = ref<RssSubscription[]>([]),
    entries = ref<RssEntry[]>([])
  const detail = ref<RssEntryDetail | null>(null),
    selected = ref(''),
    cursor = ref<string | null>(null)
  const hasMore = ref(false),
    historyStatus = ref<RssEntriesResponse['history_status']>('exhausted'),
    retryAt = ref<string | null>(null)
  const restoreList = (snapshot?: CachedList) => {
    entries.value = snapshot?.items || []
    cursor.value = snapshot?.cursor || null
    hasMore.value = snapshot?.hasMore || false
    historyStatus.value = snapshot?.historyStatus || 'exhausted'
    retryAt.value = snapshot?.retryAt || null
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
  const enabled = computed(() => labs.loaded.value && labs.isEnabled('rss'))
  const fail = (e: unknown) => {
    error.value = e instanceof Error ? e.message : 'source_unavailable'
  }
  const clear = () => {
    session++
    generation++
    detailGeneration++
    initializeGeneration++
    cache.clear()
    subscriptions.value = []
    restoreList()
    detail.value = null
    selected.value = ''
    cursor.value = null
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
  onScopeDispose(clear)

  const fetchPage = (source: string, after: string | null, history = false) =>
    request().get<RssEntriesResponse>({
      url: '/v1/rss/entries',
      query: { ...(source ? { subscription_id: source } : {}), ...(after ? { cursor: after } : {}), ...(history ? { fetch_history: '1' } : {}), limit: '20' }
    })
  const reload = async (more = false) => {
    if (!enabled.value || loading.value || (more && !hasMore.value)) return
    const source = selected.value,
      stamp = ++generation,
      previous = cache.get(source)
    loading.value = true
    error.value = ''
    try {
      if (more) {
        const result = await fetchPage(source, cursor.value, true)
        if (stamp !== generation || !enabled.value) return
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
        if (stamp !== generation || !enabled.value) return
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
    if (force || !cached || Date.now() - cached.updatedAt >= CACHE_TTL) await reload()
  }
  const initialize = async (force = false) => {
    const initialization = ++initializeGeneration,
      account = session
    initializing.value = true
    error.value = ''
    try {
      await labs.fetch()
      if (!enabled.value || initialization !== initializeGeneration || account !== session) return
      const result = await request().get<RssSubscriptionsResponse>({ url: '/v1/rss/subscriptions' })
      if (initialization !== initializeGeneration || account !== session) return
      if (!result) throw new Error('source_unavailable')
      const previous = new Map(subscriptions.value.map(row => [row.id, row]))
      subscriptions.value = result.items
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
      subscriptions.value = [...subscriptions.value.filter(item => item.id !== row.id), row]
      cache.delete('')
      await select(row.id)
    })
  const update = (id: string, remark: string) =>
    mutate(async () => {
      const account = session
      const row = await request().post<RssSubscription>({ url: `/v1/rss/subscriptions/${encodeURIComponent(id)}/update`, body: { remark: remark.trim() || null } })
      if (account !== session || !enabled.value) return
      if (!row) throw new Error('source_unavailable')
      subscriptions.value = subscriptions.value.map(sub => (sub.id === row.id ? row : sub))
      const renamed = (entry: RssEntry) => (entry.subscription_id === row.id ? { ...entry, source_title: rssSubscriptionName(row) } : entry)
      for (const snapshot of cache.values()) snapshot.items = snapshot.items.map(renamed)
      entries.value = entries.value.map(renamed)
      if (detail.value?.subscription_id === row.id) detail.value = { ...detail.value, source_title: rssSubscriptionName(row) }
    })
  const remove = (id: string) =>
    mutate(async () => {
      const account = session
      await request().post({ url: `/v1/rss/subscriptions/${encodeURIComponent(id)}/delete` })
      if (account !== session || !enabled.value) return
      subscriptions.value = subscriptions.value.filter(row => row.id !== id)
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
        await initialize(true)
        return
      }
      const result = await request().post<RssRefreshResponse>({ url: `/v1/rss/subscriptions/${encodeURIComponent(id)}/refresh` })
      if (account !== session || !enabled.value) return
      if (!result) throw new Error('source_unavailable')
      const row = subscriptions.value.find(item => item.id === id)
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
      for (const snapshot of cache.values()) snapshot.items = snapshot.items.map(saved)
      entries.value = entries.value.map(saved)
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
    initializing,
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
