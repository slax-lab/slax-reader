import { notifyExtensionBridgeAuthExpired, parseExtensionBridgeIds } from '~/utils/extensionBridge'
import { requestExtensionBridgeSession } from '~/utils/extensionBridgeSession'
import { getClientEventHeaders, getUserToken } from '~/utils/request'

import { RESTMethodPath } from '@commons/contracts/const'
import { createPowerSyncPlugin } from '@powersync/vue'
import { PowerSyncDatabase, SyncStreamConnectionMethod } from '@powersync/web'
import { clearSyncCredsCache, createConnector, fetchSyncCredentials } from '~/local-first/connector'
import {
  initializePowerSyncWithFallback,
  type PowerSyncRecoveryEvent,
  type PowerSyncWorkerMode
} from '~/local-first/powersync-recovery'
import { AppSchema } from '~/local-first/schema'
import { POWER_SYNC_DATABASE_GENERATION, POWER_SYNC_LOCAL_DATA_VERSION } from '~/local-first/version'

// 从 JWT payload 取稳定用户标识（id，回退 email），用于换号检测
const getTokenUserId = (token: string | null | undefined): string | null => {
  if (!token) return null
  try {
    const part = token.split('.')[1]
    if (!part) return null
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/')
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
    const claims = JSON.parse(atob(padded)) as { id?: string | number; email?: string }
    return claims.id != null ? String(claims.id) : (claims.email ?? null)
  } catch {
    return null
  }
}

const LAST_USER_KEY = 'slax:powersync:lastUser'

const DATABASE_GENERATION = POWER_SYNC_DATABASE_GENERATION
const DATA_VERSION_KEY = `slax:powersync:${DATABASE_GENERATION}:dataVersion`
const useDatabaseWorker = !import.meta.dev

const DATABASE_FILENAME = `slax-reader-${DATABASE_GENERATION}.db`
// 保留 PowerSync 现场日志，生产构建也可排障。
const powerSyncConsole = globalThis.console

const logPowerSyncRecoveryEvent = (event: PowerSyncRecoveryEvent) => {
  switch (event.type) {
    case 'attempt-start':
      powerSyncConsole.info('[powersync] recovery attempt started', { mode: event.mode, attempt: event.attempt })
      break
    case 'attempt-success':
      powerSyncConsole.info('[powersync] recovery attempt succeeded', {
        mode: event.mode,
        attempt: event.attempt,
        durationMs: event.durationMs
      })
      break
    case 'attempt-error':
      powerSyncConsole.error('[powersync] recovery attempt failed', {
        mode: event.mode,
        attempt: event.attempt,
        durationMs: event.durationMs,
        error: event.error
      })
      break
    case 'retry-scheduled':
      powerSyncConsole.warn('[powersync] retrying SharedWorker initialization', {
        attempt: event.attempt,
        delayMs: event.delayMs
      })
      break
    case 'dispose-timeout':
      powerSyncConsole.warn('[powersync] failed database cleanup timed out; stopping local recovery', {
        mode: event.mode,
        attempt: event.attempt,
        timeoutMs: event.timeoutMs
      })
      break
    case 'dispose-error':
      powerSyncConsole.warn('[powersync] failed database cleanup reported an error', {
        mode: event.mode,
        attempt: event.attempt,
        error: event.error
      })
      break
    case 'fallback':
      powerSyncConsole.warn('[powersync] changing recovery mode', { from: event.from, to: event.to })
      break
  }
}

export default defineNuxtPlugin(async nuxtApp => {
  const cfg = useRuntimeConfig().public
  const isBridgeFrame = window.parent !== window && window.location.pathname === '/x/ext-bridge'
  let bridgeToken: string | null = null
  let bridgeUserId: string | null = null
  const getPowerSyncUserToken = () => isBridgeFrame ? bridgeToken : getUserToken()
  const havePowerSyncUserToken = () => Boolean(getPowerSyncUserToken())
  const refreshPowerSyncUserToken = async () => {
    if (!isBridgeFrame) return getUserToken()
    const token = await requestExtensionBridgeSession({
      clientId: sessionStorage.getItem('slax:ext-bridge-client-id')?.toLowerCase() || '',
      configuredIds: parseExtensionBridgeIds(cfg.EXTENSION_BRIDGE_IDS),
      environment: cfg.slaxEnv
    })
    // 换号由后台销毁旧 iframe 后重新初始化，禁止旧数据库使用新账号凭证。
    if (token) {
      const userId = getTokenUserId(token)
      if (!userId) throw new Error('extension bridge session has no user identity')
      if (bridgeUserId && bridgeUserId !== userId) throw new Error('extension bridge account changed; remount required')
      bridgeUserId = userId
    }
    bridgeToken = token
    return token
  }
  const unavailable = () => ({
    provide: {
      powersync: null as PowerSyncDatabase | null,
      powersyncConnect: async () => {},
      powersyncReset: async () => {}
    }
  })
  if (isBridgeFrame) {
    try {
      if (!await refreshPowerSyncUserToken()) throw new Error('extension bridge has no active session')
    } catch {
      window.parent.postMessage({ type: 'slax-bridge-error', error: 'bridge session unavailable' }, '*')
      return unavailable()
    }
  }

  const connector = createConnector({
    fetchToken: async () => {
      const authToken = await refreshPowerSyncUserToken()
      return fetchSyncCredentials({
        baseUrl: cfg.DWEB_API_BASE_URL as string,
        authToken,
        onUnauthorized: async () => {
          await useAuth().clearAuth()
          clearSyncCredsCache()
          notifyExtensionBridgeAuthExpired()
          bridgeToken = null
          if (window.parent === window) await navigateTo('/login')
        }
      })
    },
    uploadChanges: async changes => {
      // 用原始 fetch：共享 request() 会把 401 当“成功”静默返回，
      // 导致 uploadData 误执行 batch.complete() 丢掉未同步写入。
      // 这里非 2xx 一律抛错，让 PowerSync 重试，不丢数据。
      const token = await refreshPowerSyncUserToken()
      if (!token) throw new Error('PowerSync upload requires an active session')
      const base = (cfg.DWEB_API_BASE_URL as string).replace(/\/$/, '')
      const res = await fetch(`${base}${RESTMethodPath.SYNC_CHANGES}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getClientEventHeaders(), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(changes)
      })
      if (res.status === 401) {
        await useAuth().clearAuth()
        clearSyncCredsCache()
        notifyExtensionBridgeAuthExpired()
        bridgeToken = null
      }
      if (!res.ok) throw new Error(`[powersync] upload changes failed: ${res.status}`)
    },
    onError: e => powerSyncConsole.error('[powersync] uploadData failed:', e)
  })

  const createDatabase = (mode: PowerSyncWorkerMode) =>
    new PowerSyncDatabase({
      schema: AppSchema,
      database: {
        dbFilename: DATABASE_FILENAME,
        // 生产环境启用 Worker；dev 模式关闭，避免 Vite 重复处理 Worker 前置代码。
        useWebWorker: useDatabaseWorker && mode !== 'main',
        enableMultiTabs: mode === 'shared',
        disableSSRWarning: true
      }
    })

  const recovery = useDatabaseWorker
    ? await initializePowerSyncWithFallback({
        createDatabase,
        sharedWorkerAvailable: typeof SharedWorker !== 'undefined',
        onEvent: logPowerSyncRecoveryEvent
      })
    : await (async () => {
        const database = createDatabase('main')
        try {
          await database.init()
          return { database, mode: 'main' as const }
        } catch (error) {
          powerSyncConsole.error('[powersync] main-thread database initialization failed', { error })
          return { database: null, mode: 'rest' as const }
        }
      })()

  const db = recovery.database
  if (!db) {
    powerSyncConsole.error('[powersync] all database modes failed; using REST fallback')
    return unavailable()
  }

  powerSyncConsole.info('[powersync] database ready', { mode: recovery.mode, dbFilename: DATABASE_FILENAME })
  nuxtApp.vueApp.use(createPowerSyncPlugin({ database: db }))

  let connected = false
  let connecting = false
  const connect = async () => {
    if (connected || connecting || !havePowerSyncUserToken()) return
    connecting = true
    try {
      powerSyncConsole.info('[powersync] sync connect requested', { mode: recovery.mode })
      await db.connect(connector, { params: { schema_version: '2' }, connectionMethod: SyncStreamConnectionMethod.HTTP })
      // ConnectionManager 会自行重试；这里表示已发起连接，不代表网络流已在线。
      connected = true
      powerSyncConsole.info('[powersync] sync connect call completed', {
        mode: recovery.mode,
        connected: db.connected,
        connecting: db.connecting
      })
    } catch (e) {
      powerSyncConsole.error('[powersync] connect failed:', e)
    } finally {
      connecting = false
    }
  }
  const reset = async () => {
    powerSyncConsole.info('[powersync] clearing local database for logout/account transition')
    clearSyncCredsCache()
    try {
      await db.disconnectAndClear()
    } catch (e) {
      powerSyncConsole.error('[powersync] disconnectAndClear failed:', e)
    }
    connected = false
  }

  // 换号防串：比对上个用户 id，不同（或有 token 却解析不出身份，保守按换号）→ 清上个账号本地库 + creds。
  // 返回是否“可以连接”：换号清理失败则不打用户戳、不连接，避免把上个账号数据当本账号（下次启动重试）。
  const guardAccount = async (): Promise<boolean> => {
    if (typeof localStorage === 'undefined') return true
    const token = getPowerSyncUserToken()
    const currentUserId = token ? getTokenUserId(token) : null
    const lastUser = localStorage.getItem(LAST_USER_KEY)
    if (token && lastUser && lastUser !== currentUserId) {
      clearSyncCredsCache()
      try {
        await db.disconnectAndClear()
      } catch (e) {
        powerSyncConsole.error('[powersync] clear on account switch failed, will retry next startup:', e)
        return false
      }
      connected = false
    }
    if (currentUserId) localStorage.setItem(LAST_USER_KEY, currentUserId)
    return true
  }
  const guardAccountAndConnect = async () => {
    if (await guardAccount()) await connect()
  }

  // 版本闸门：版本不一致则清库（含未同步写，schema 变更后以服务端为准）重新全量同步。
  // 用 navigator.locks 串行化，多标签只清一次。
  const ensureDataVersion = async () => {
    if (typeof localStorage === 'undefined') return
    const getStoredVersion = () => Number(localStorage.getItem(DATA_VERSION_KEY) ?? 0)
    if (getStoredVersion() >= POWER_SYNC_LOCAL_DATA_VERSION) return
    const migrate = async () => {
      // 锁内复检：别的标签可能刚迁完
      if (getStoredVersion() >= POWER_SYNC_LOCAL_DATA_VERSION) return
      try {
        const batch = await db.getCrudBatch(1)
        if (batch?.crud.length) powerSyncConsole.warn('[powersync] clearing local data with unsynced writes on version bump')
      } catch {
        /* ignore */
      }
      clearSyncCredsCache()
      try {
        await db.disconnectAndClear()
      } catch (e) {
        // 清失败不打版本戳，下次启动重试，避免陈旧数据被当成已迁移
        powerSyncConsole.error('[powersync] data-version clear failed, will retry next startup:', e)
        return
      }
      connected = false
      localStorage.setItem(DATA_VERSION_KEY, String(POWER_SYNC_LOCAL_DATA_VERSION))
    }
    if (navigator?.locks?.request) await navigator.locks.request('slax-ps-data-version', migrate)
    else await migrate()
  }

  // 串行化生命周期切换，避免 init 守卫与 watch/导航重连互相穿插
  let lifecycle: Promise<void> = Promise.resolve()
  const transition = (fn: () => Promise<void>) => {
    lifecycle = lifecycle.then(fn).catch(e => powerSyncConsole.error('[powersync] lifecycle error:', e))
    return lifecycle
  }

  // init：清理（版本闸门 + 换号）必须在任何本地查询前完成，故 await
  // （async 插件会阻塞 app 挂载到此，保证组件 useQuery 前脏/错数据已清）；
  // connect 起网络连接，不阻塞启动。
  await ensureDataVersion()
  if (await guardAccount()) transition(connect)

  // iframe 的 Cookie 可能不可见；其登出/换号由扩展 cookies.onChanged 销毁 bridge。
  if (!isBridgeFrame) {
    const tokenName = cfg.COOKIE_TOKEN_NAME as string
    const tokenCookie = useCookie(tokenName)
    watch(
      () => tokenCookie.value,
      (val, old) => {
        if (val) transition(guardAccountAndConnect)
        else if (old) transition(reset)
      }
    )
  }

  // 兜底：登录/登出由 @vueuse useCookies 改写 cookie，Nuxt useCookie 的 watch 可能不触发，
  // 导致 connect 永不再调（列表卡“加载更多”、不发 /v1/sync/token）或 logout 漏清。
  // 每次路由完成时按真实 token 状态对账：有 token → 守卫+连；无 token 且之前有 → 重置。
  let lastHadToken = havePowerSyncUserToken()
  const reconcileAuthAndConnect = async () => {
    if (!havePowerSyncUserToken()) {
      if (lastHadToken || connected) await reset()
      lastHadToken = false
      return
    }
    lastHadToken = true
    await guardAccountAndConnect()
  }
  const router = useRouter()
  router.afterEach(() => transition(reconcileAuthAndConnect))

  return {
    provide: {
      powersync: db as PowerSyncDatabase | null,
      powersyncConnect: connect,
      powersyncReset: reset
    }
  }
})
