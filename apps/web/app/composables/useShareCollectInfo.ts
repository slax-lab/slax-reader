import { effectScope, ref, watch } from 'vue'

import type { MyShareCollectionInfo } from '@slax-reader/contracts'
import { RESTMethodPath } from '@slax-reader/contracts/const'
import { useAccountContext } from '~/composables/useAccountContext'

// 模块级单例缓存，跨组件复用
const info = ref<MyShareCollectionInfo | null>(null)
const loaded = ref(false)
let inflight: Promise<MyShareCollectionInfo | null> | null = null
let requestVersion = 0
let accountWatchStarted = false
let accountContext: ReturnType<typeof useAccountContext> | null = null
let refreshQueued = false

const currentAccountKey = () => accountContext?.context.value.accountKey ?? ''

const queueAccountRefresh = () => {
  if (refreshQueued) return
  refreshQueued = true
  queueMicrotask(() => {
    refreshQueued = false
    if (!import.meta.client || !haveRequestToken()) return
    fetchInfo()
  })
}

const startAccountWatch = () => {
  if (accountWatchStarted || !import.meta.client) return
  accountWatchStarted = true

  // Detached scope: the cache is app-wide, so this watcher must outlive the first consumer.
  effectScope(true).run(() => {
    const context = useAccountContext()
    accountContext = context

    watch(
      () => context.context.value.accountKey,
      () => {
        // Token renewal and profile refreshes change generation without changing identity.
        // Only an actual account change drops the cache and schedules a refresh.
        requestVersion++
        inflight = null
        info.value = null
        loaded.value = false
        queueAccountRefresh()
      },
      { flush: 'sync' }
    )
  })
}

const fetchInfo = (force = false): Promise<MyShareCollectionInfo | null> => {
  if (!force && inflight) return inflight

  const version = ++requestVersion
  const accountKey = currentAccountKey()
  const promise = request()
    .get<MyShareCollectionInfo>({ url: RESTMethodPath.COLLECT_MINE, errorInterceptors: () => {} })
    .then(res => {
      if (version !== requestVersion || accountKey !== currentAccountKey()) return null
      info.value = res ?? null
      return info.value
    })
    .catch(() => {
      // SWR 展示可以保留旧值；本次请求的失败结果必须是 null，调用方不能把旧缓存当新地址。
      return null
    })
    .finally(() => {
      if (version === requestVersion) {
        loaded.value = true
        inflight = null
      }
    })

  inflight = promise
  return promise
}

export const useShareCollectInfo = () => {
  startAccountWatch()

  // SWR：先出缓存；成功加载后 ensure 不再重复请求，失败可在下次进入时重试
  const ensure = () => {
    if (!import.meta.client || !haveRequestToken() || (loaded.value && info.value)) return
    fetchInfo()
  }

  // 强制发起新请求；requestVersion 使较早的响应不能覆盖本次刷新
  const refresh = (): Promise<MyShareCollectionInfo | null> => {
    if (!import.meta.client || !haveRequestToken()) return Promise.resolve(null)
    return fetchInfo(true)
  }

  const apply = (patch: Partial<MyShareCollectionInfo>, base: MyShareCollectionInfo | null = info.value) => {
    if (base) info.value = { ...base, ...patch }
    loaded.value = true
  }

  return { info, loaded, ensure, refresh, apply }
}
