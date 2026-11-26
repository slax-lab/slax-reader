import { type ShallowRef, shallowRef } from 'vue'

import { clientErrorContext, recentHostTiming } from '~/utils/clientErrorContext'
import { useClientErrorLog } from '~/utils/clientErrorLog'
import { notifyExtensionBridgeAuthExpired, parseExtensionBridgeIds } from '~/utils/extensionBridge'
import { requestExtensionBridgeSession } from '~/utils/extensionBridgeSession'
import { getClientEventHeaders, getUserToken } from '~/utils/request'
import { getTokenUserId } from '~/utils/sessionOwner'
import { isVersionSkewError } from '~/utils/versionSkew'

import { normalizeError, powerSyncLogError } from '@commons/frontend-utils/errorLog'
import { createPowerSyncPlugin } from '@powersync/vue'
import { createConsoleLogger, LogLevels, PowerSyncDatabase, type PowerSyncLogger, SyncStreamConnectionMethod } from '@powersync/web'
import { RESTMethodPath } from '@slax-reader/contracts/const'
import { useUpdateNotice } from '~/composables/useUpdateNotice'
import { clearSyncCredsCache, createConnector, fetchSyncCredentials } from '~/local-first/connector'
import { isDeferredLocalStartupPath, needsLocalStartupDocumentExit } from '~/local-first/deferred-startup-policy'
import { initializePowerSyncWithFallback, type PowerSyncRecoveryEvent, type PowerSyncRecoveryResult, type PowerSyncWorkerMode } from '~/local-first/powersync-recovery'
import { deferLiveQueriesWhileHidden } from '~/local-first/powersync-visibility-gate'
import { shouldUsePowerSyncSharedWorker } from '~/local-first/powersync-worker-policy'
import { isPublicStartupEntryPath, type PublicTokenState, shouldBypassPublicDatabase } from '~/local-first/public-startup-policy'
import { createReconnectScheduler } from '~/local-first/reconnect-scheduler'
import { AppSchema } from '~/local-first/schema'
import { POWER_SYNC_DATABASE_GENERATION, POWER_SYNC_LOCAL_DATA_VERSION } from '~/local-first/version'

const LAST_USER_KEY = 'slax:powersync:lastUser'

const DATABASE_GENERATION = POWER_SYNC_DATABASE_GENERATION
const DATA_VERSION_KEY = `slax:powersync:${DATABASE_GENERATION}:dataVersion`
const useDatabaseWorker = !import.meta.dev

const DATABASE_FILENAME = `slax-reader-${DATABASE_GENERATION}.db`
const DEFERRED_EXIT_WAIT_MS = 2_000
const DEFERRED_EXIT_RETRY_MS = 3_000
// 保留 PowerSync 现场日志，生产构建也可排障。
const powerSyncConsole = globalThis.console

// Error capture is diagnostics only: any failure inside it, including creating the collector, is
// swallowed so it can never change sync, upload, or recovery behavior.
const OBSERVATION_ID = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`
let syncFailureCount = 0
let syncConnectedAt: number | undefined
// Set once a stream connects in this session; cleared on logout so a new account starts as `connect`.
let streamEstablished = false
let syncHost: string | undefined
let onStreamFailure: (() => void) | undefined

const apiHostname = () => {
  try {
    return new URL(String(useRuntimeConfig().public.DWEB_API_BASE_URL)).hostname
  } catch {
    return undefined
  }
}

const syncContext = (host?: string) => ({
  ...clientErrorContext(),
  ...(syncConnectedAt !== undefined ? { connection_ms: Math.max(0, Date.now() - syncConnectedAt) } : {}),
  consecutive_failures: syncFailureCount,
  ...(host ? (recentHostTiming(host) ? { net: recentHostTiming(host) } : {}) : {})
})

// Observations must be attributable to a signed-in account; the plugin installs its session check.
let hasObservableSession: () => boolean = () => false

const emitPhase = (phase: 'token' | 'connect' | 'stream' | 'upload', outcome: 'success' | 'failure', properties: Record<string, unknown> = {}) => {
  try {
    if (!hasObservableSession()) return
    useClientErrorLog().telemetry('powersync_phase', { observation_id: OBSERVATION_ID, phase, outcome, ...properties }, `${phase} ${outcome}`)
  } catch {
    // Telemetry is best effort.
  }
}

const capturePowerSyncError = (source: string, error: unknown, properties: Record<string, unknown> = {}, host?: string) => {
  try {
    const ray = typeof error === 'object' && error !== null && typeof (error as { ray?: unknown }).ray === 'string' ? (error as { ray: string }).ray : undefined
    const fingerprint = useClientErrorLog().capture('powersync', error ?? { name: 'PowerSyncError', message: source }, { source, ...syncContext(host), ...properties, ...(ray ? { ray } : {}) })
    return { fingerprint, ray }
  } catch {
    // Diagnostics must not affect the caller.
    return {}
  }
}

// The shared sync worker broadcasts its log records to every tab, so with several tabs open one
// worker failure reaches each of them. Only the tab holding this lock records worker log records;
// the lock moves to another tab when the holder closes. Without Web Locks every tab records them.
const WORKER_LOG_REPORTER_LOCK = 'slax-ps-worker-log-reporter'
let isWorkerLogReporter = true
let workerLogReporterRequested = false
const claimWorkerLogReporter = () => {
  if (workerLogReporterRequested) return
  workerLogReporterRequested = true
  try {
    const locks = typeof navigator === 'undefined' ? undefined : navigator.locks
    if (!locks?.request) return
    isWorkerLogReporter = false
    void locks
      .request(WORKER_LOG_REPORTER_LOCK, () => {
        isWorkerLogReporter = true
        // Held for the page's lifetime; released by the browser when the tab closes.
        return new Promise<void>(() => {})
      })
      .catch(() => {
        isWorkerLogReporter = true
      })
  } catch {
    isWorkerLogReporter = true
  }
}

// The SDK logs one sync failure twice ("Could not POST streaming…", then "Sync error") within
// milliseconds; its retries are seconds apart. The window is measured from the first log of a
// failure, so a failure repeating faster than the window is still counted once per window.
const SDK_DUPLICATE_WINDOW_MS = 1000
const isStreamFailureLog = (message: string) => message === 'Sync error' || message.startsWith('Could not POST streaming')

// A token failure recorded by the tab claims the SDK's following "Sync error" for this long.
const TOKEN_CLAIM_WINDOW_MS = 5000
let tokenFailureClaimedAt: number | undefined
const claimTokenFailure = () => {
  tokenFailureClaimedAt = Date.now()
}
const consumeClaimedTokenFailure = () => {
  const claimed = tokenFailureClaimedAt !== undefined && Date.now() - tokenFailureClaimedAt < TOKEN_CLAIM_WINDOW_MS
  tokenFailureClaimedAt = undefined
  return claimed
}

// Keeps the SDK's default console logger unchanged and also records its error-level messages,
// which include sync failures and worker crashes. This is the only counting source for sync-stream
// failures; the status listener below sees the same failures again and does not count them.
const createPowerSyncLogger = (mode: PowerSyncWorkerMode): PowerSyncLogger => {
  const consoleLogger = createConsoleLogger()
  let windowKey = ''
  let windowStart = 0
  if (mode === 'shared') claimWorkerLogReporter()
  return {
    log(record) {
      consoleLogger.log(record)
      // The SDK calls this from its sync retry loop without a guard, so a throw here could skip its
      // error bookkeeping or end the loop. Capture runs fully guarded.
      try {
        const { level, message, error } = record
        if (level < LogLevels.error) return
        if (mode === 'shared' && !isWorkerLogReporter) return
        const captured = powerSyncLogError(message, error)
        const normalized = normalizeError(captured)
        // Both stream-failure messages of one episode share a key, so the episode is counted once.
        const key = isStreamFailureLog(message) ? 'stream' : `${normalized.name ?? ''}:${normalized.message}`
        const now = Date.now()
        if (key === windowKey && now - windowStart < SDK_DUPLICATE_WINDOW_MS) return
        windowKey = key
        windowStart = now
        // Only the HTTP stream's failure logs end the connection; other error logs (watch, checkpoint,
        // upload loop) are recorded but do not count as stream failures or drive the backoff.
        if (!isStreamFailureLog(message)) {
          capturePowerSyncError('sdk.logger', captured, { worker_mode: mode }, syncHost)
          return
        }
        syncFailureCount += 1
        // The SDK fetches credentials inside its sync loop, so a failed token request also ends as "Sync error".
        // That failure was already recorded as `token` where it happened (its tag does not survive the shared
        // worker), so the log only drives the backoff.
        if (!consumeClaimedTokenFailure()) {
          // A failure before any stream was established in this session cannot be a dropped stream.
          const phase = syncConnectedAt === undefined && !streamEstablished ? 'connect' : 'stream'
          const capturedInfo = capturePowerSyncError('sdk.logger', captured, { worker_mode: mode, phase }, syncHost)
          emitPhase(phase, 'failure', { ...(capturedInfo.fingerprint ? { error_fingerprint: capturedInfo.fingerprint } : {}), ...(capturedInfo.ray ? { ray: capturedInfo.ray } : {}) })
        }
        try {
          onStreamFailure?.()
        } catch {
          // Control path must not affect the SDK.
        }
      } catch {
        // Diagnostics must not affect the SDK.
      }
    }
  }
}

// An initialization failure caused by a replaced build asset asks the user to refresh; it never changes
// recovery, fallback, or logging.
const reportVersionSkew = (notice: ReturnType<typeof useUpdateNotice> | null, error: unknown) => {
  try {
    if (notice && isVersionSkewError(error)) notice.report('outdated')
  } catch {
    // The notice is advisory.
  }
}

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
      capturePowerSyncError('recovery.attempt', event.error, { worker_mode: event.mode, attempt: event.attempt, duration_ms: event.durationMs, phase: 'connect', stage: 'recovery' }, apiHostname())
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
      capturePowerSyncError('recovery.dispose', { name: 'PowerSyncCleanupTimeout', message: 'failed database cleanup timed out' }, { worker_mode: event.mode, timeout_ms: event.timeoutMs, phase: 'connect', stage: 'recovery' }, apiHostname())
      powerSyncConsole.warn('[powersync] failed database cleanup timed out; stopping local recovery', {
        mode: event.mode,
        attempt: event.attempt,
        timeoutMs: event.timeoutMs
      })
      break
    case 'dispose-error':
      capturePowerSyncError('recovery.dispose', event.error, { worker_mode: event.mode, attempt: event.attempt, phase: 'connect', stage: 'recovery' }, apiHostname())
      powerSyncConsole.warn('[powersync] failed database cleanup reported an error', {
        mode: event.mode,
        attempt: event.attempt,
        error: event.error
      })
      break
    case 'unavailable':
      capturePowerSyncError('recovery.unavailable', { name: 'PowerSyncUnavailable', message: `local database unavailable: ${event.stopReason ?? 'exhausted'}` }, {
        phase: 'connect',
        stage: 'recovery',
        attempted_modes: event.attemptedModes,
        stop_reason: event.stopReason
      })
      powerSyncConsole.error('[powersync] local database initialization unavailable; using REST fallback', {
        attemptedModes: event.attemptedModes,
        stopReason: event.stopReason,
        visibility: typeof document === 'undefined' ? undefined : document.visibilityState
      })
      break
    case 'background-ready':
      powerSyncConsole.info('[powersync] background initialization completed', {
        mode: event.mode,
        attempt: event.attempt,
        durationMs: event.durationMs
      })
      break
    case 'background-error':
      powerSyncConsole.error('[powersync] background initialization failed', {
        mode: event.mode,
        attempt: event.attempt,
        durationMs: event.durationMs,
        error: event.error
      })
      break
    case 'fallback':
      powerSyncConsole.warn('[powersync] changing recovery mode', { from: event.from, to: event.to })
      break
  }
}

export default defineNuxtPlugin({
  name: 'slax:powersync',
  async setup(nuxtApp) {
    const cfg = useRuntimeConfig().public
    // Resolved before the first await, while the Nuxt context is still available.
    let updateNotice: ReturnType<typeof useUpdateNotice> | null = null
    try {
      updateNotice = useUpdateNotice()
    } catch {
      // The notice is advisory.
    }
    const localOwner = useState<string | null>('powersync-owner', () => null)
    localOwner.value = null
    const isBridgePath = window.location.pathname === '/x/ext-bridge'
    const isBridgeFrame = window.parent !== window && isBridgePath
    const servesBridgePage = /^\/x\/ext-bridge\/?$/.test(window.location.pathname)
    let bridgeToken: string | null = null
    let bridgeUserId: string | null = null
    const getPowerSyncUserToken = () => (isBridgeFrame ? bridgeToken : getUserToken())
    const havePowerSyncUserToken = () => Boolean(getPowerSyncUserToken())
    // The Extension bridge frame is outside sync telemetry; its identity comes from a bridged session, not the page cookie.
    hasObservableSession = () => !isBridgeFrame && havePowerSyncUserToken()
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
    // Readiness for documents that mount before local startup finishes; set only after every startup check passes.
    const powersyncReady: ShallowRef<PowerSyncDatabase | null> = shallowRef(null)
    let settleReady: (database: PowerSyncDatabase | null) => void = () => {}
    const readyPromise = new Promise<PowerSyncDatabase | null>(resolve => {
      settleReady = resolve
    })
    const publishReady = (database: PowerSyncDatabase | null) => {
      powersyncReady.value = database
      settleReady(database)
    }
    const unavailable = (bypassed = false) => {
      publishReady(null)
      return {
        provide: {
          powersync: null as PowerSyncDatabase | null,
          powersyncConnect: async () => {},
          powersyncReset: async () => {},
          powersyncPublicBypass: bypassed,
          powersyncDeferred: false,
          powersyncReady,
          powersyncWhenReady: () => readyPromise
        }
      }
    }
    const recoveringSnapshotSession = useSnapshotSessionRecoveryPending()
    const snapshotNavigation = useSnapshotSessionNavigation()
    if (recoveringSnapshotSession.value) return unavailable()
    // The bridge page only serves the extension frame; opened directly it has nothing to read or sync.
    if (servesBridgePage && !isBridgeFrame) return unavailable()
    const publicStartupEnabled = Boolean(useAppConfig().lcp?.anonymousPublicStartup)
    const initialPathname = window.location.pathname
    const topLevel = window.parent === window
    let initialTokenState: PublicTokenState = 'error'
    if (publicStartupEnabled && topLevel && isPublicStartupEntryPath(initialPathname)) {
      try {
        initialTokenState = getUserToken() ? 'present' : 'absent'
      } catch {
        // An unreadable token must retain normal startup and its unavailable fallback.
      }
    }
    if (shouldBypassPublicDatabase({ enabled: publicStartupEnabled, pathname: initialPathname, topLevel, tokenState: initialTokenState })) return unavailable(true)

    if (isBridgeFrame) {
      try {
        if (!(await refreshPowerSyncUserToken())) throw new Error('extension bridge has no active session')
      } catch {
        window.parent.postMessage({ type: 'slax-bridge-error', error: 'bridge session unavailable' }, '*')
        return unavailable()
      }
    }

    const connector = createConnector({
      fetchToken: async () => {
        const authToken = await refreshPowerSyncUserToken()
        const credentials = await fetchSyncCredentials({
          baseUrl: cfg.DWEB_API_BASE_URL as string,
          authToken,
          onUnauthorized: async () => {
            if (recoveringSnapshotSession.value || snapshotNavigation.value) return
            const snapshot = /^\/b\/([^/]+)\/?$/.exec(window.location.pathname)
            if (window.parent === window && snapshot) {
              // Let the current snapshot's metadata decide recovery and retain its URL.
              await nuxtApp.runWithContext(() => refreshNuxtData(`content-${snapshot[1]}`))
              return
            }
            await useAuth().clearAuth()
            clearSyncCredsCache()
            notifyExtensionBridgeAuthExpired()
            bridgeToken = null
            if (window.parent === window) await navigateTo('/login')
          }
        })
        try {
          syncHost = new URL(credentials.endpoint).hostname
        } catch {
          syncHost = apiHostname()
        }
        return credentials
      },
      uploadChanges: async changes => {
        // 用原始 fetch：共享 request() 会把 401 当“成功”静默返回，
        // 导致 uploadData 误执行 batch.complete() 丢掉未同步写入。
        // 这里非 2xx 一律抛错，让 PowerSync 重试，不丢数据。
        const startedAt = Date.now()
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
        if (!res.ok) throw Object.assign(new Error(`[powersync] upload changes failed: ${res.status}`), { phase: 'upload', ray: res.headers.get('cf-ray') ?? undefined, status: res.status })
        emitPhase('upload', 'success', { step: 'submit', batch_size: changes.length, duration_ms: Math.max(0, Date.now() - startedAt) })
      },
      onCredentials: (source, durationMs) => emitPhase('token', 'success', { credential_source: source, duration_ms: durationMs }),
      onCredentialsFailed: error => {
        const info = capturePowerSyncError('connector.credentials', error, { phase: 'token' }, apiHostname())
        emitPhase('token', 'failure', { ...(info.fingerprint ? { error_fingerprint: info.fingerprint } : {}), ...(info.ray ? { ray: info.ray } : {}) })
        claimTokenFailure()
      },
      onAcknowledged: (batchSize, durationMs) => emitPhase('upload', 'success', { step: 'acknowledge', batch_size: batchSize, duration_ms: durationMs }),
      onError: e => {
        const step = typeof e === 'object' && e !== null && (e as { step?: unknown }).step === 'acknowledge' ? 'acknowledge' : 'submit'
        const info = capturePowerSyncError('connector.upload', e, { phase: 'upload', step }, apiHostname())
        emitPhase('upload', 'failure', { step, ...(info.fingerprint ? { error_fingerprint: info.fingerprint } : {}), ...(info.ray ? { ray: info.ray } : {}) })
        powerSyncConsole.error('[powersync] uploadData failed:', e)
      }
    })

    const createDatabase = (mode: PowerSyncWorkerMode) =>
      new PowerSyncDatabase({
        schema: AppSchema,
        logger: createPowerSyncLogger(mode),
        database: {
          dbFilename: DATABASE_FILENAME,
          // 生产环境启用 Worker；dev 模式关闭，避免 Vite 重复处理 Worker 前置代码。
          useWebWorker: useDatabaseWorker && mode !== 'main',
          enableMultiTabs: mode === 'shared',
          disableSSRWarning: true
        }
      })

    // Recovery, data-version gate, account guard, then connect. Returns the database only when every check passes;
    // the caller decides whether mount waits for it. A deferred document is already readable on REST, so it can keep
    // waiting for a timed-out instance and run the same checks on it instead of reloading on the next navigation.
    const startLocal = async ({ waitForRetained = false } = {}): Promise<PowerSyncDatabase | null> => {
      const recovery: PowerSyncRecoveryResult = useDatabaseWorker
        ? await initializePowerSyncWithFallback({
            createDatabase,
            sharedWorkerAvailable: shouldUsePowerSyncSharedWorker(),
            onEvent: event => {
              if (event.type === 'attempt-error') reportVersionSkew(updateNotice, event.error)
              logPowerSyncRecoveryEvent(event)
            }
          })
        : await (async () => {
            const database = createDatabase('main')
            try {
              await database.init()
              return { database, mode: 'main' as const }
            } catch (error) {
              reportVersionSkew(updateNotice, error)
              capturePowerSyncError('init', error, { worker_mode: 'main', phase: 'connect', stage: 'init' }, apiHostname())
              powerSyncConsole.error('[powersync] local database initialization unavailable; using REST fallback', {
                attemptedModes: ['main'],
                reason: 'initialization-error',
                error
              })
              return { database: null, mode: 'rest' as const }
            }
          })()

      let db = recovery.database
      if (!db && waitForRetained && recovery.pending) {
        if (await recovery.pending.ready) db = recovery.pending.database
      }
      if (!db) {
        if (waitForRetained) return null
        // The current document stays on REST; the next path change loads a fresh document
        // once the retained initialization is ready. The bridge is recreated by the Extension.
        if (recovery.pending && !isBridgeFrame && topLevel) {
          const router = useRouter()
          void recovery.pending.ready.then(ready => {
            if (!ready) return
            let resuming = false
            const removeGuard = router.beforeEach(async (to, from) => {
              if (resuming) return false
              // Only internal destinations; mirrors powersync-public-restore.client.ts.
              if (to.path === from.path || !/^\/(?![\\/])/.test(to.fullPath)) return
              resuming = true
              powerSyncConsole.info('[powersync] resuming local database with a document load', { mode: recovery.pending?.mode, path: to.path })
              try {
                await nuxtApp.runWithContext(() => navigateTo(to.fullPath, { external: true }))
              } catch (error) {
                // Keep the guard for a later navigation and let this one continue on REST.
                resuming = false
                powerSyncConsole.warn('[powersync] document load for local resume failed', { error })
                return
              }
              removeGuard()
              // Outside Nuxt middleware navigateTo does not cancel the SPA transition itself.
              return false
            })
          })
        }
        return null
      }

      // The extension bridge frame is never visible and runs no live queries.
      if (!isBridgeFrame) deferLiveQueriesWhileHidden(db)

      powerSyncConsole.info('[powersync] database ready', { mode: recovery.mode, dbFilename: DATABASE_FILENAME })

      // Every failure the status reports is already counted by its one counting source: sync-stream
      // failures by the SDK logger (always logged at error level just before the status changes) and
      // upload failures by the connector's `onError`. The shared worker also replays the same status
      // to every tab. Counting the status too would double every failure, so it is not captured.

      let connected = false
      // Separates the first connection of a session from later reconnections in `connect` observations.
      let everConnected = false
      let connecting = false
      let offlinePaused = false
      let intentionalStop = false
      let connectStartedAt: number | undefined
      let downloadingSince: number | undefined
      let downloadStartSyncedAt: number | undefined
      syncFailureCount = 0
      syncConnectedAt = undefined
      // Delays follow 5 s, 10 s, 20 s ... capped at 2 min; syncFailureCount already counts the failure being retried.
      const reconnectDelay = () => Math.min(5000 * 2 ** Math.max(0, syncFailureCount - 1), 120000)
      const canReconnect = () => !offlinePaused && !(typeof navigator !== 'undefined' && navigator.onLine === false) && havePowerSyncUserToken()
      const reconnects = createReconnectScheduler({
        delay: reconnectDelay,
        canReconnect,
        reconnect: () => transition(guardAccountAndConnect),
        sharedLock: () => recovery.mode === 'shared'
      })
      const clearReconnect = reconnects.cancel
      const scheduleReconnect = reconnects.schedule
      let streamFailures = 0
      const stopForFailure = () => {
        streamFailures += 1
        connected = false
        syncConnectedAt = undefined
        void db.disconnect().catch(() => undefined)
        scheduleReconnect()
      }
      onStreamFailure = stopForFailure
      const connect = async () => {
        // A pending backoff retry owns the next attempt; route reconciliation must not bypass it.
        if (connected || connecting || reconnects.pending() || offlinePaused || (typeof navigator !== 'undefined' && !navigator.onLine) || !havePowerSyncUserToken()) return
        connecting = true
        intentionalStop = false
        connectStartedAt = Date.now()
        const failuresBefore = streamFailures
        try {
          powerSyncConsole.info('[powersync] sync connect requested', { mode: recovery.mode })
          await db.connect(connector, { params: { schema_version: '2' }, connectionMethod: SyncStreamConnectionMethod.HTTP })
          // ConnectionManager 会自行重试；这里表示已发起连接，不代表网络流已在线。
          // The SDK resolves connect() only after the first attempt settles, so a stream failure seen while
          // waiting has already disconnected and scheduled the retry; marking it connected would void that retry.
          if (streamFailures === failuresBefore && !reconnects.pending()) connected = true
          powerSyncConsole.info('[powersync] sync connect call completed', {
            mode: recovery.mode,
            connected: db.connected,
            connecting: db.connecting
          })
        } catch (e) {
          syncFailureCount += 1
          const phase = typeof e === 'object' && e !== null && (e as { phase?: unknown }).phase === 'token' ? 'token' : 'connect'
          const info = capturePowerSyncError('app.connect', e, { worker_mode: recovery.mode, phase }, syncHost ?? apiHostname())
          emitPhase(phase, 'failure', { ...(info.fingerprint ? { error_fingerprint: info.fingerprint } : {}), ...(info.ray ? { ray: info.ray } : {}) })
          powerSyncConsole.error('[powersync] connect failed:', e)
          scheduleReconnect()
        } finally {
          connecting = false
          connectStartedAt = undefined
        }
      }
      // A shared worker may already hold a live stream when this tab starts observing it.
      try {
        if (db.connected) {
          connected = true
          everConnected = true
          streamEstablished = true
          syncConnectedAt = Date.now()
          emitPhase('connect', 'success', { connection_kind: 'already_connected' })
        }
      } catch {
        // Status is advisory here.
      }
      try {
        db.registerListener({
          statusChanged: status => {
            if (status.connected) {
              // Keyed on the SDK status, not on `connected`: connect() can resolve before the stream is up
              // (it then sets `connected` itself), and the stream that connects later is still a new one.
              if (syncConnectedAt === undefined) {
                syncConnectedAt = Date.now()
                streamEstablished = true
                emitPhase('connect', 'success', {
                  connection_kind: everConnected ? 'reconnect' : 'initial',
                  ...(connectStartedAt !== undefined ? { duration_ms: Math.max(0, Date.now() - connectStartedAt) } : {})
                })
                everConnected = true
              }
              connected = true
              syncFailureCount = 0
              clearReconnect()
            } else if (connected && !status.connecting) {
              // Only a stream the SDK reported connected and that then dropped counts as lost; a connect that
              // never came up, a stop for a counted failure, going offline and a hidden page are not losses.
              const wasStreaming = syncConnectedAt !== undefined
              connected = false
              syncConnectedAt = undefined
              const offline = typeof navigator !== 'undefined' && navigator.onLine === false
              const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden'
              if (wasStreaming && !intentionalStop && !offlinePaused && !offline && !hidden) {
                try {
                  if (hasObservableSession()) useClientErrorLog().telemetry('powersync_connection_lost', { observation_id: OBSERVATION_ID, reason: 'stream_lost' }, 'stream_lost')
                } catch {}
              }
            }
            // The SDK builds a new Date on each read, so cycles are compared by timestamp; a cycle that ends
            // without advancing it, or with the stream down, applied nothing and is discarded.
            const syncedAt = status.lastSyncedAt?.getTime()
            if (status.downloading && downloadingSince === undefined) {
              downloadingSince = performance.now()
              downloadStartSyncedAt = syncedAt
            }
            if (!status.connected && !status.connecting) downloadingSince = undefined
            if (!status.downloading && downloadingSince !== undefined) {
              if (syncedAt !== undefined && syncedAt !== downloadStartSyncedAt) {
                emitPhase('stream', 'success', { duration_ms: Math.max(0, Math.round(performance.now() - downloadingSince)) })
              }
              downloadingSince = undefined
            }
          }
        })
      } catch {
        // A missing listener only removes observations.
      }
      const onOffline = () => {
        offlinePaused = true
        intentionalStop = true
        clearReconnect()
        connected = false
        syncConnectedAt = undefined
        void db.disconnect().catch(() => undefined)
      }
      const reconnectNow = () => {
        clearReconnect()
        intentionalStop = false
        if (canReconnect()) void transition(guardAccountAndConnect)
      }
      const onOnline = () => {
        offlinePaused = false
        reconnectNow()
      }
      const onVisibility = () => {
        if (document.visibilityState === 'visible' && !connected) reconnectNow()
      }
      window.addEventListener('offline', onOffline)
      window.addEventListener('online', onOnline)
      document.addEventListener('visibilitychange', onVisibility)
      const reset = async () => {
        localOwner.value = null
        intentionalStop = true
        clearReconnect()
        syncFailureCount = 0
        everConnected = false
        streamEstablished = false
        syncConnectedAt = undefined
        powerSyncConsole.info('[powersync] clearing local database for logout/account transition')
        clearSyncCredsCache()
        try {
          await db.disconnectAndClear()
        } catch (e) {
          capturePowerSyncError('app.reset', e, { worker_mode: recovery.mode, phase: 'connect', stage: 'reset' }, apiHostname())
          powerSyncConsole.error('[powersync] disconnectAndClear failed:', e)
        }
        connected = false
      }

      // 换号防串：比对上个用户 id，不同（或有 token 却解析不出身份，保守按换号）→ 清上个账号本地库 + creds。
      // 返回是否“可以连接”：换号清理失败则不打用户戳、不连接，避免把上个账号数据当本账号（下次启动重试）。
      const guardAccount = async (): Promise<boolean> => {
        localOwner.value = null
        if (typeof localStorage === 'undefined') return false
        const token = getPowerSyncUserToken()
        const currentUserId = token ? getTokenUserId(token) : null
        const lastUser = localStorage.getItem(LAST_USER_KEY)
        if (token && lastUser && lastUser !== currentUserId) {
          clearSyncCredsCache()
          try {
            await db.disconnectAndClear()
          } catch (e) {
            capturePowerSyncError('app.accountSwitch', e, { worker_mode: recovery.mode, phase: 'connect', stage: 'account-switch' }, apiHostname())
            powerSyncConsole.error('[powersync] clear on account switch failed, will retry next startup:', e)
            return false
          }
          connected = false
        }
        if (token && !currentUserId) return false
        if (currentUserId) localStorage.setItem(LAST_USER_KEY, currentUserId)
        localOwner.value = currentUserId
        return true
      }
      const guardAccountAndConnect = async () => {
        if (await guardAccount()) await connect()
      }

      // 版本闸门：版本不一致则清库（含未同步写，schema 变更后以服务端为准）重新全量同步。
      // 用 navigator.locks 串行化，多标签只清一次。
      const ensureDataVersion = async () => {
        if (typeof localStorage === 'undefined') throw Error('Local storage unavailable')
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
            capturePowerSyncError('app.dataVersion', e, { worker_mode: recovery.mode, phase: 'connect', stage: 'data-version' }, apiHostname())
            powerSyncConsole.error('[powersync] data-version clear failed, will retry next startup:', e)
            throw e
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
        lifecycle = lifecycle.then(fn).catch(e => {
          capturePowerSyncError('app.lifecycle', e, { worker_mode: recovery.mode, phase: 'connect', stage: 'lifecycle' }, apiHostname())
          powerSyncConsole.error('[powersync] lifecycle error:', e)
        })
        return lifecycle
      }

      // init：清理（版本闸门 + 换号）必须在任何本地查询前完成，故 await
      // （async 插件会阻塞 app 挂载到此，保证组件 useQuery 前脏/错数据已清）；
      // connect 起网络连接，不阻塞启动。
      try {
        await ensureDataVersion()
        if (!(await guardAccount())) throw Error('Local account ownership unavailable')
      } catch {
        localOwner.value = null
        // Preserve the database; inability to verify ownership must not trigger data deletion.
        try {
          await db.close()
        } catch {
          /* Initialization may not have created a usable connection. */
        }
        return null
      }
      nuxtApp.vueApp.use(createPowerSyncPlugin({ database: db }))
      transition(connect)
      localControls = { connect, reset }
      // A deferred start resumes here after awaits, outside the plugin's synchronous context.
      if (waitForRetained) nuxtApp.runWithContext(() => watchAuthLifecycle())
      else watchAuthLifecycle()
      return db

      function watchAuthLifecycle() {
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
      }
    }

    let localControls: { connect: () => Promise<void>; reset: () => Promise<void> } | null = null
    const deferred = topLevel && !isBridgeFrame && isDeferredLocalStartupPath(initialPathname)
    if (deferred) {
      // Reader documents render from REST: mount now, publish the database once its checks pass.
      const startedAt = Date.now()
      // The plugin has returned before startLocal resumes after its awaits; keep the Nuxt app context for its composables.
      void nuxtApp
        .runWithContext(() => startLocal({ waitForRetained: true }))
        .catch(error => {
          powerSyncConsole.error('[powersync] deferred local startup failed', { error })
          return null
        })
        .then(database => {
          powerSyncConsole.info('[powersync] deferred local startup settled', { ready: !!database, durationMs: Date.now() - startedAt })
          publishReady(database)
        })
      installDeferredExitGuard()
      return {
        provide: {
          // Stays null: setup-time consumers on this document keep their REST branch.
          powersync: null as PowerSyncDatabase | null,
          powersyncConnect: () => localControls?.connect() ?? Promise.resolve(),
          powersyncReset: () => localControls?.reset() ?? Promise.resolve(),
          powersyncPublicBypass: false,
          powersyncDeferred: true,
          powersyncReady,
          powersyncWhenReady: () => readyPromise
        }
      }
    }

    const db = await startLocal()
    publishReady(db)
    if (!db) return unavailable()
    return {
      provide: {
        powersync: db as PowerSyncDatabase | null,
        powersyncConnect: localControls!.connect,
        powersyncReset: localControls!.reset,
        powersyncPublicBypass: false,
        powersyncDeferred: false,
        powersyncReady,
        powersyncWhenReady: () => readyPromise
      }
    }

    // A document load hands non-reader destinations their normal startup; a bounded wait lets startup finish writes first.
    function installDeferredExitGuard() {
      const router = useRouter()
      let leaving = false
      // Back and Forward have already moved the address when guards run. Cancelling such a navigation makes the
      // router rewind history, and that traversal cancels a document load started here, so the reader stays put.
      // For a traversal the guard reloads the address it already shows and keeps the navigation pending, so the
      // router neither rewinds nor mounts the destination; if the unload is suppressed, the navigation is then
      // cancelled and the address returns to this page.
      const isHistoryTraversal = (fullPath: string) => {
        try {
          return new URL(fullPath, window.location.href).href === window.location.href
        } catch {
          return false
        }
      }
      router.beforeEach(async (to, from) => {
        if (leaving) return false
        if (to.path === from.path || !needsLocalStartupDocumentExit(to.path) || !/^\/(?![\\/])/.test(to.fullPath)) return
        leaving = true
        await Promise.race([readyPromise, new Promise(resolve => setTimeout(resolve, DEFERRED_EXIT_WAIT_MS))])
        powerSyncConsole.info('[powersync] leaving deferred reader with a document load', { path: to.path, ready: !!powersyncReady.value })
        if (isHistoryTraversal(to.fullPath)) {
          try {
            window.location.replace(to.fullPath)
          } catch (error) {
            leaving = false
            powerSyncConsole.warn('[powersync] document load for deferred exit failed', { error })
            return
          }
          return new Promise<false>(resolve => {
            setTimeout(() => {
              leaving = false
              resolve(false)
            }, DEFERRED_EXIT_RETRY_MS)
          })
        }
        try {
          await nuxtApp.runWithContext(() => navigateTo(to.fullPath, { external: true }))
        } catch (error) {
          leaving = false
          powerSyncConsole.warn('[powersync] document load for deferred exit failed', { error })
          return
        }
        // navigateTo only assigns location; if the unload is suppressed, let a later navigation try again.
        setTimeout(() => {
          leaving = false
        }, DEFERRED_EXIT_RETRY_MS)
        return false
      })
    }
  }
})
