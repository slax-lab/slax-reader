import type { PowerSyncDatabase } from '@powersync/web'

export type PowerSyncWorkerMode = 'shared' | 'dedicated' | 'main'

export interface PowerSyncRecoveryResult {
  database: PowerSyncDatabase | null
  mode: PowerSyncWorkerMode | 'rest'
}

export type PowerSyncRecoveryEvent =
  | { type: 'attempt-start'; mode: PowerSyncWorkerMode; attempt: number }
  | { type: 'attempt-success'; mode: PowerSyncWorkerMode; attempt: number; durationMs: number }
  | { type: 'attempt-error'; mode: PowerSyncWorkerMode; attempt: number; durationMs: number; error: unknown }
  | { type: 'retry-scheduled'; mode: 'shared'; attempt: number; delayMs: number }
  | { type: 'fallback'; from: PowerSyncWorkerMode; to: 'dedicated' | 'main' | 'rest' }
  | { type: 'dispose-error'; mode: PowerSyncWorkerMode; attempt: number; error: unknown }
  | { type: 'dispose-timeout'; mode: PowerSyncWorkerMode; attempt: number; timeoutMs: number }

export interface PowerSyncRecoveryOptions {
  createDatabase: (mode: PowerSyncWorkerMode) => PowerSyncDatabase
  sharedWorkerAvailable?: boolean
  maxSharedAttempts?: number
  sharedRetryDelaysMs?: number[]
  initTimeoutMs?: number
  recoveryTimeoutMs?: number
  disposeTimeoutMs?: number
  sleep?: (delayMs: number) => Promise<void>
  dispose?: (database: PowerSyncDatabase) => Promise<void>
  onError?: (error: unknown, mode: PowerSyncWorkerMode, attempt: number) => void
  onEvent?: (event: PowerSyncRecoveryEvent) => void
}

const DEFAULT_MAX_SHARED_ATTEMPTS = 3
const DEFAULT_SHARED_RETRY_DELAYS_MS = [400, 1_200]
const DEFAULT_INIT_TIMEOUT_MS = 8_000
const DEFAULT_RECOVERY_TIMEOUT_MS = 15_000

const sleep = (delayMs: number) => new Promise<void>(resolve => setTimeout(resolve, delayMs))

class PowerSyncInitializationTimeoutError extends Error {
  constructor(mode: PowerSyncWorkerMode, timeoutMs: number) {
    super(`PowerSync ${mode} initialization timed out after ${timeoutMs}ms`)
    this.name = 'PowerSyncInitializationTimeoutError'
  }
}

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number, mode: PowerSyncWorkerMode): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new PowerSyncInitializationTimeoutError(mode, timeoutMs)), timeoutMs)
      })
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

const defaultDispose = async (database: PowerSyncDatabase) => {
  // 公开 close() 会再次等待失败的 init()；直接关闭底层 adapter。
  await database.database.close()
}

/** 按 SharedWorker → Dedicated Worker → Main → REST 顺序初始化。 */
export async function initializePowerSyncWithFallback({
  createDatabase,
  sharedWorkerAvailable = true,
  maxSharedAttempts = DEFAULT_MAX_SHARED_ATTEMPTS,
  sharedRetryDelaysMs = DEFAULT_SHARED_RETRY_DELAYS_MS,
  initTimeoutMs = DEFAULT_INIT_TIMEOUT_MS,
  recoveryTimeoutMs = DEFAULT_RECOVERY_TIMEOUT_MS,
  disposeTimeoutMs = 250,
  sleep: sleepFn = sleep,
  dispose = defaultDispose,
  onError,
  onEvent
}: PowerSyncRecoveryOptions): Promise<PowerSyncRecoveryResult> {
  const recoveryDeadline = Date.now() + recoveryTimeoutMs
  const tryMode = async (mode: PowerSyncWorkerMode, attempt: number): Promise<{ database: PowerSyncDatabase | null; cannotContinue: boolean }> => {
    const startedAt = Date.now()
    onEvent?.({ type: 'attempt-start', mode, attempt })
    let database: PowerSyncDatabase | null = null
    try {
      const timeoutMs = Math.min(initTimeoutMs, Math.max(1, recoveryDeadline - startedAt))
      // 构造失败也要进入下一种模式。
      database = createDatabase(mode)
      await withTimeout(database.init(), timeoutMs, mode)
      onEvent?.({ type: 'attempt-success', mode, attempt, durationMs: Date.now() - startedAt })
      return { database, cannotContinue: false }
    } catch (error) {
      const durationMs = Date.now() - startedAt
      onError?.(error, mode, attempt)
      onEvent?.({ type: 'attempt-error', mode, attempt, durationMs, error })
      let disposeFinished = false
      let disposeFailed = false
      let disposeError: unknown
      if (database) {
        await Promise.race([
          dispose(database)
            .catch(error => {
              disposeFailed = true
              disposeError = error
            })
            .finally(() => {
              disposeFinished = true
            }),
          sleep(disposeTimeoutMs)
        ])
      } else {
        disposeFinished = true
      }
      if (disposeFailed) onEvent?.({ type: 'dispose-error', mode, attempt, error: disposeError })
      if (!disposeFinished) onEvent?.({ type: 'dispose-timeout', mode, attempt, timeoutMs: disposeTimeoutMs })
      return {
        database: null,
        cannotContinue: error instanceof PowerSyncInitializationTimeoutError || !disposeFinished || disposeFailed
      }
    }
  }

  if (sharedWorkerAvailable) {
    const sharedAttempts = Math.max(1, maxSharedAttempts)
    for (let attempt = 1; attempt <= sharedAttempts; attempt += 1) {
      const result = await tryMode('shared', attempt)
      if (result.database) return { database: result.database, mode: 'shared' }
      // PowerSync 没有取消 init() 的 API。超时后继续打开同一 dbFilename
      // 可能产生并发实例，因此直接切 REST，等待下次页面加载再恢复。
      if (result.cannotContinue) {
        onEvent?.({ type: 'fallback', from: 'shared', to: 'rest' })
        return { database: null, mode: 'rest' }
      }
      if (attempt < sharedAttempts) {
        const delayMs = sharedRetryDelaysMs[Math.min(attempt - 1, sharedRetryDelaysMs.length - 1)] ?? 0
        onEvent?.({ type: 'retry-scheduled', mode: 'shared', attempt, delayMs })
        await sleepFn(delayMs)
      }
    }
    onEvent?.({ type: 'fallback', from: 'shared', to: 'dedicated' })
  }

  const dedicated = await tryMode('dedicated', 1)
  if (dedicated.database) return { database: dedicated.database, mode: 'dedicated' }
  if (dedicated.cannotContinue) {
    onEvent?.({ type: 'fallback', from: 'dedicated', to: 'rest' })
    return { database: null, mode: 'rest' }
  }

  onEvent?.({ type: 'fallback', from: 'dedicated', to: 'main' })

  const main = await tryMode('main', 1)
  if (main.database) return { database: main.database, mode: 'main' }

  onEvent?.({ type: 'fallback', from: 'main', to: 'rest' })
  return { database: null, mode: 'rest' }
}
