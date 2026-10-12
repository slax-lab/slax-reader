// PowerSync 后端连接器 —— 移植 slax-reader-client 的 PowerSync.kt（Connector）。
// fetchCredentials → POST /v1/sync/token；uploadData → getCrudBatch → diffChanges → POST /v1/sync/changes。
// 与后端 SyncChangeItem 1:1（table/id/op/data/preData）。后端把 data 当 Record<string,string>，
// metadata 的嵌套变更要拆成点路径（metadata.tags / metadata.share.is_enable）才命中后端解析分支。
import { type AbstractPowerSyncDatabase, type CrudEntry, type PowerSyncBackendConnector, type PowerSyncCredentials, UpdateType } from '@powersync/web'

interface ShareSettings {
  is_enable?: boolean
  show_line?: boolean
  allow_line?: boolean
  show_comment?: boolean
  allow_comment?: boolean
  show_userinfo?: boolean
  share_code?: string
  created_at?: string
}
interface BookmarkMetadata {
  tags?: string[]
  share?: ShareSettings | null
}

type ChangeMap = Record<string, string | null>

// 对照 client diffChanges：普通字段直 diff；metadata 字段拆成 metadata.tags / metadata.share.<field> 点路径
function diffChanges(data?: Record<string, unknown>, preData?: Record<string, unknown>): { changes: ChangeMap | null; preChanges: ChangeMap | null } {
  if (!data) return { changes: null, preChanges: null }
  const toStr = (v: unknown): string | null => (v === null || v === undefined ? null : typeof v === 'string' ? v : JSON.stringify(v))

  if (!preData) {
    const all: ChangeMap = {}
    for (const [k, v] of Object.entries(data)) all[k] = toStr(v)
    return { changes: all, preChanges: null }
  }

  const changes: ChangeMap = {}
  const preChanges: ChangeMap = {}
  for (const [key, value] of Object.entries(data)) {
    const old = preData[key]
    if (toStr(value) === toStr(old)) continue

    if (key === 'metadata') {
      try {
        const nm = JSON.parse((value as string) || '{}') as BookmarkMetadata
        const om = JSON.parse((old as string) || '{}') as BookmarkMetadata
        if (JSON.stringify(nm.tags ?? null) !== JSON.stringify(om.tags ?? null)) {
          changes['metadata.tags'] = JSON.stringify(nm.tags ?? [])
          preChanges['metadata.tags'] = JSON.stringify(om.tags ?? [])
        }
        const ns = nm.share
        const os = om.share
        // 后端只认 metadata.share.is_enable（值为含 is_enable 的 JSON）
        if ((ns?.is_enable ?? null) !== (os?.is_enable ?? null)) {
          changes['metadata.share.is_enable'] = JSON.stringify({ is_enable: ns?.is_enable })
          preChanges['metadata.share.is_enable'] = JSON.stringify({ is_enable: os?.is_enable })
        }
      } catch {
        changes['metadata'] = toStr(value)
        preChanges['metadata'] = toStr(old)
      }
    } else {
      changes[key] = toStr(value)
      preChanges[key] = toStr(old)
    }
  }
  return {
    changes: Object.keys(changes).length ? changes : null,
    preChanges: Object.keys(preChanges).length ? preChanges : null
  }
}

interface SyncChangeItem {
  table: string
  id: string
  op: string
  data?: ChangeMap | null
  preData?: ChangeMap | null
}

export interface CreateConnectorOptions {
  // 调 /v1/sync/token，返回后端的 { token, endpoint }
  fetchToken: () => Promise<{ token: string; endpoint: string }>
  // POST /v1/sync/changes
  uploadChanges: (changes: SyncChangeItem[]) => Promise<void>
  onError?: (e: unknown) => void
}

export async function fetchSyncCredentials(options: {
  baseUrl: string
  authToken?: string | null
  onUnauthorized: () => Promise<void> | void
}): Promise<{ token: string; endpoint: string }> {
  if (!options.authToken) return { token: '', endpoint: '' }
  const expMs = getJwtExpMs(options.authToken)
  if (expMs !== null && Date.now() >= expMs) {
    await options.onUnauthorized()
    return { token: '', endpoint: '' }
  }

  const response = await fetch(`${options.baseUrl.replace(/\/$/, '')}/v1/sync/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${options.authToken}` }
  })
  if (response.status === 401) {
    await options.onUnauthorized()
    return { token: '', endpoint: '' }
  }
  if (!response.ok) throw new Error(`[powersync] sync token failed: ${response.status}`)

  const result = (await response.json()) as { data?: { token?: string; endpoint?: string } }
  return { token: result.data?.token ?? '', endpoint: result.data?.endpoint ?? '' }
}

type RefreshablePowerSyncBackendConnector = PowerSyncBackendConnector & {
  invalidateCredentials: () => void
}

const CREDS_STORAGE_KEY = 'slax:powersync:creds'
const REFRESH_MARGIN = 5 * 60 * 1000 // 提前 5 分钟刷新

function getJwtExpMs(token: string): number | null {
  try {
    const payload = token.split('.')[1]
    if (!payload) return null
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/')
    const json = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4))
    const exp = (JSON.parse(json) as { exp?: number }).exp
    return typeof exp === 'number' ? exp * 1000 : null
  } catch {
    return null
  }
}

interface StoredCreds {
  token: string
  endpoint: string
  expMs: number
}

function loadStoredCreds(): StoredCreds | null {
  if (typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem(CREDS_STORAGE_KEY)
    if (!raw) return null
    const o = JSON.parse(raw) as Partial<StoredCreds>
    if (!o.token || !o.endpoint || !o.expMs) return null
    return { token: o.token, endpoint: o.endpoint, expMs: o.expMs }
  } catch {
    return null
  }
}

function saveStoredCreds(c: StoredCreds) {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(CREDS_STORAGE_KEY, JSON.stringify(c))
  } catch {
    /* ignore */
  }
}

// 登出/换号时清除持久化的 sync token
export function clearSyncCredsCache() {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.removeItem(CREDS_STORAGE_KEY)
  } catch {
    /* ignore */
  }
}

export function createConnector(opts: CreateConnectorOptions): RefreshablePowerSyncBackendConnector {
  let inflight: Promise<PowerSyncCredentials | null> | null = null

  return {
    async fetchCredentials(): Promise<PowerSyncCredentials | null> {
      // token 24h 有效：持久化到 localStorage，刷新页面也复用，临近过期才重新拉
      const cached = loadStoredCreds()
      if (cached && Date.now() < cached.expMs - REFRESH_MARGIN) {
        return { endpoint: cached.endpoint, token: cached.token }
      }
      // 并发去重：PowerSync 建连时会并发调用多次，合并成一次 /v1/sync/token
      if (inflight) return inflight
      inflight = (async () => {
        try {
          const { token, endpoint } = await opts.fetchToken()
          if (!token || !endpoint) return null
          const expMs = getJwtExpMs(token) ?? Date.now() + 24 * 60 * 60 * 1000
          saveStoredCreds({ token, endpoint, expMs })
          return { endpoint, token }
        } finally {
          inflight = null
        }
      })()
      return inflight
    },

    invalidateCredentials() {
      clearSyncCredsCache()
    },

    async uploadData(database: AbstractPowerSyncDatabase): Promise<void> {
      const batch = await database.getCrudBatch()
      if (!batch) return

      try {
        const changes: SyncChangeItem[] = batch.crud.map((entry: CrudEntry) => {
          // DELETE 没有 opData；PUT/PATCH 有
          const { changes: data, preChanges: preData } = entry.op === UpdateType.DELETE ? { changes: null, preChanges: null } : diffChanges(entry.opData, entry.previousValues)
          return { table: entry.table, id: entry.id, op: entry.op.toString(), data, preData }
        })
        await opts.uploadChanges(changes)
        await batch.complete()
      } catch (e) {
        opts.onError?.(e)
        throw e // 抛出 → PowerSync 自动重试
      }
    }
  }
}
