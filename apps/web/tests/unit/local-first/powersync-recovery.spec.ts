import { initializePowerSyncWithFallback, type PowerSyncWorkerMode } from '~/local-first/powersync-recovery'
import { afterEach, describe, expect, it, vi } from 'vitest'

type FakeDb = {
  init: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
  database: { close: ReturnType<typeof vi.fn> }
  connected: boolean
}

const makeDb = (init: () => Promise<void>): FakeDb => ({
  init: vi.fn(init),
  close: vi.fn(async () => {}),
  database: { close: vi.fn(async () => {}) },
  connected: false
})

afterEach(() => {
  vi.useRealTimers()
})

describe('initializePowerSyncWithFallback', () => {
  it('keeps SharedWorker mode when the first initialization succeeds', async () => {
    const created: PowerSyncWorkerMode[] = []
    const db = makeDb(async () => {})

    const result = await initializePowerSyncWithFallback({
      createDatabase: mode => {
        created.push(mode)
        return db as never
      },
      sleep: vi.fn()
    })

    expect(result).toEqual({ database: db, mode: 'shared' })
    expect(created).toEqual(['shared'])
  })

  it('retries the same SharedWorker mode before succeeding', async () => {
    const created: PowerSyncWorkerMode[] = []
    let attempt = 0
    const databases = [
      makeDb(async () => {
        throw new Error('Client has already been closed')
      }),
      makeDb(async () => {})
    ]
    const sleep = vi.fn(async () => {})

    const result = await initializePowerSyncWithFallback({
      createDatabase: mode => {
        created.push(mode)
        return databases[attempt++] as never
      },
      sleep,
      maxSharedAttempts: 3
    })

    expect(result).toEqual({ database: databases[1], mode: 'shared' })
    expect(created).toEqual(['shared', 'shared'])
    expect(sleep).toHaveBeenCalledOnce()
    expect(databases[0].database.close).toHaveBeenCalledOnce()
  })

  it('falls back to Dedicated Worker after SharedWorker attempts are exhausted', async () => {
    const created: PowerSyncWorkerMode[] = []
    const databases = [
      makeDb(async () => {
        throw new Error('closed')
      }),
      makeDb(async () => {
        throw new Error('closed')
      }),
      makeDb(async () => {})
    ]
    let index = 0

    const result = await initializePowerSyncWithFallback({
      createDatabase: mode => {
        created.push(mode)
        return databases[index++] as never
      },
      maxSharedAttempts: 2,
      sleep: vi.fn()
    })

    expect(result).toEqual({ database: databases[2], mode: 'dedicated' })
    expect(created).toEqual(['shared', 'shared', 'dedicated'])
  })

  it('skips SharedWorker when the browser does not expose it', async () => {
    const created: PowerSyncWorkerMode[] = []
    const dedicated = makeDb(async () => {})

    const result = await initializePowerSyncWithFallback({
      sharedWorkerAvailable: false,
      createDatabase: mode => {
        created.push(mode)
        return dedicated as never
      },
      sleep: vi.fn()
    })

    expect(result).toEqual({ database: dedicated, mode: 'dedicated' })
    expect(created).toEqual(['dedicated'])
  })

  it('returns REST fallback when all local modes fail', async () => {
    const created: PowerSyncWorkerMode[] = []
    const errors: unknown[] = []
    const makeFailure = () =>
      makeDb(async () => {
        throw new Error('transaction aborted')
      })

    const result = await initializePowerSyncWithFallback({
      createDatabase: mode => {
        created.push(mode)
        return makeFailure() as never
      },
      maxSharedAttempts: 2,
      sleep: vi.fn(),
      onError: error => errors.push(error)
    })

    expect(result).toEqual({ database: null, mode: 'rest' })
    expect(created).toEqual(['shared', 'shared', 'dedicated', 'main'])
    expect(errors).toHaveLength(4)
  })

  it('falls back from Dedicated Worker to the main thread', async () => {
    const created: PowerSyncWorkerMode[] = []
    const databases = [
      makeDb(async () => {
        throw new Error('shared unavailable')
      }),
      makeDb(async () => {
        throw new Error('dedicated unavailable')
      }),
      makeDb(async () => {})
    ]
    let index = 0

    const result = await initializePowerSyncWithFallback({
      createDatabase: mode => {
        created.push(mode)
        return databases[index++] as never
      },
      maxSharedAttempts: 1,
      sleep: vi.fn()
    })

    expect(result).toEqual({ database: databases[2], mode: 'main' })
    expect(created).toEqual(['shared', 'dedicated', 'main'])
  })

  it('continues to Main when Dedicated Worker construction throws synchronously', async () => {
    const created: PowerSyncWorkerMode[] = []
    const main = makeDb(async () => {})

    const result = await initializePowerSyncWithFallback({
      createDatabase: mode => {
        created.push(mode)
        if (mode === 'dedicated') throw new Error('Worker is unavailable')
        return (
          mode === 'main'
            ? main
            : makeDb(async () => {
                throw new Error('shared unavailable')
              })
        ) as never
      },
      maxSharedAttempts: 1,
      sleep: vi.fn()
    })

    expect(result).toEqual({ database: main, mode: 'main' })
    expect(created).toEqual(['shared', 'dedicated', 'main'])
  })

  it('uses REST after a timeout instead of opening another instance of the same database', async () => {
    vi.useFakeTimers()
    const created: PowerSyncWorkerMode[] = []
    const hanging = makeDb(() => new Promise<void>(() => {}))

    const promise = initializePowerSyncWithFallback({
      createDatabase: mode => {
        created.push(mode)
        return hanging as never
      },
      maxSharedAttempts: 1,
      initTimeoutMs: 100,
      sleep: vi.fn()
    })

    await vi.advanceTimersByTimeAsync(100)
    await expect(promise).resolves.toEqual({ database: null, mode: 'rest' })
    expect(created).toEqual(['shared'])
  })

  it('uses REST when failed database cleanup does not finish', async () => {
    vi.useFakeTimers()
    const created: PowerSyncWorkerMode[] = []
    const failed = makeDb(async () => {
      throw new Error('closed')
    })

    const promise = initializePowerSyncWithFallback({
      createDatabase: mode => {
        created.push(mode)
        return failed as never
      },
      maxSharedAttempts: 2,
      disposeTimeoutMs: 100,
      dispose: () => new Promise<void>(() => {}),
      sleep: vi.fn()
    })

    await vi.advanceTimersByTimeAsync(100)
    await expect(promise).resolves.toEqual({ database: null, mode: 'rest' })
    expect(created).toEqual(['shared'])
  })

  it('uses REST when failed database cleanup reports an error', async () => {
    const created: PowerSyncWorkerMode[] = []
    const events: string[] = []
    const failed = makeDb(async () => {
      throw new Error('initialization failed')
    })
    failed.database.close.mockRejectedValueOnce(new Error('cleanup failed'))

    const result = await initializePowerSyncWithFallback({
      createDatabase: mode => {
        created.push(mode)
        return failed as never
      },
      maxSharedAttempts: 2,
      sleep: vi.fn(),
      onEvent: event => events.push(event.type)
    })

    expect(result).toEqual({ database: null, mode: 'rest' })
    expect(created).toEqual(['shared'])
    expect(events).toContain('dispose-error')
  })

  it('emits structured events for retry and success transitions', async () => {
    const events: string[] = []
    let attempt = 0
    const databases = [
      makeDb(async () => {
        throw new Error('Client has already been closed')
      }),
      makeDb(async () => {})
    ]

    await initializePowerSyncWithFallback({
      createDatabase: () => databases[attempt++] as never,
      maxSharedAttempts: 2,
      sleep: vi.fn(),
      onEvent: event => events.push(event.type)
    })

    expect(events).toEqual(['attempt-start', 'attempt-error', 'retry-scheduled', 'attempt-start', 'attempt-success'])
  })
})
