import { ref } from 'vue'

import type { CollectionOwnerInfo } from '@commons/contracts/interface'
import { RESTMethodPath } from '@commons/contracts/const'

// 合集主人头像缓存：7d TTL+SWR
// 统一 snippet 为主人头像
const STORAGE_KEY = 'slax_owner_info_v1'
const TTL = 7 * 24 * 60 * 60 * 1000

interface OwnerEntry {
  avatar: string
  nick_name: string
  fetchedAt: number
}
type Store = Record<string, OwnerEntry>

// 模块级单例，跨组件共享
const store = ref<Store>({})
const inflight = new Map<string, Promise<void>>()
let loaded = false

function loadFromStorage() {
  if (loaded || !import.meta.client) return
  loaded = true
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return
    const parsed = JSON.parse(raw) as Store
    const now = Date.now()
    const pruned: Store = {}
    // 清理超 2×TTL 老条目
    for (const [code, e] of Object.entries(parsed)) {
      if (e && typeof e.avatar === 'string' && now - e.fetchedAt < TTL * 2) pruned[code] = e
    }
    store.value = pruned
  } catch {
    // 坏数据丢弃
  }
}

function persist() {
  if (!import.meta.client) return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store.value))
  } catch {
    // 配额/隐私模式失败静默
  }
}

async function fetchOwner(code: string) {
  // 合集关闭时 404，内容区已有提示
  const info = await request().get<CollectionOwnerInfo>({ url: RESTMethodPath.COLLECT_OWNER_INFO, query: { code }, errorInterceptors: () => {} })
  if (!info) return
  store.value = { ...store.value, [code]: { avatar: info.avatar, nick_name: info.nick_name, fetchedAt: Date.now() } }
  persist()
}

export function useOwnerInfo() {
  loadFromStorage()

  // 新鲜不发；缺失/过期取；去重
  const ensureLoaded = (code?: string) => {
    if (!code || !import.meta.client) return
    const entry = store.value[code]
    if (entry && Date.now() - entry.fetchedAt < TTL) return
    if (inflight.has(code)) return
    const p = fetchOwner(code)
      .catch(() => {}) // 静默降级，不写坏值
      .finally(() => inflight.delete(code))
    inflight.set(code, p)
  }

  const resolve = (code?: string): string | undefined => (code ? store.value[code]?.avatar : undefined)

  return { ensureLoaded, resolve }
}
