import { createReconnectScheduler } from '~~/app/local-first/reconnect-scheduler'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// A Web Locks double: a held name grants `null` to `ifAvailable` requests until its callback settles.
const held = new Set<string>()
const locks = {
  request: async (name: string, _options: unknown, callback: (lock: unknown) => Promise<void> | undefined) => {
    if (held.has(name)) return callback(null)
    held.add(name)
    try {
      return await callback({ name })
    } finally {
      held.delete(name)
    }
  }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  held.clear()
  Object.defineProperty(navigator, 'locks', { configurable: true, value: locks })
})

afterEach(() => {
  vi.useRealTimers()
  Reflect.deleteProperty(navigator, 'locks')
})

describe('PowerSync reconnect scheduler', () => {
  it('releases the shared-worker lock when a pending retry is cancelled, so a later failure can schedule again', async () => {
    const reconnect = vi.fn(async () => {})
    const scheduler = createReconnectScheduler({ delay: () => 5000, canReconnect: () => true, reconnect, sharedLock: () => true })
    scheduler.schedule()
    await vi.advanceTimersByTimeAsync(0)
    expect(held.size).toBe(1)
    scheduler.cancel()
    await vi.advanceTimersByTimeAsync(0)
    expect(held.size).toBe(0)
    scheduler.schedule()
    await vi.advanceTimersByTimeAsync(5000)
    expect(reconnect).toHaveBeenCalledOnce()
    expect(held.size).toBe(0)
  })

  it('holds the lock until the attempt settles, and another tab skips while it is held', async () => {
    let finish!: () => void
    const reconnect = vi.fn(() => new Promise<void>(resolve => (finish = resolve)))
    const owner = createReconnectScheduler({ delay: () => 5000, canReconnect: () => true, reconnect, sharedLock: () => true })
    const other = createReconnectScheduler({ delay: () => 5000, canReconnect: () => true, reconnect, sharedLock: () => true })
    owner.schedule()
    await vi.advanceTimersByTimeAsync(5000)
    other.schedule()
    await vi.advanceTimersByTimeAsync(5000)
    expect(reconnect).toHaveBeenCalledOnce()
    expect(held.size).toBe(1)
    finish()
    await vi.advanceTimersByTimeAsync(0)
    expect(held.size).toBe(0)
  })

  it('keeps one pending retry and skips scheduling when reconnecting is not allowed', async () => {
    let allowed = false
    const reconnect = vi.fn(async () => {})
    const scheduler = createReconnectScheduler({ delay: () => 1000, canReconnect: () => allowed, reconnect, sharedLock: () => false })
    scheduler.schedule()
    expect(scheduler.pending()).toBe(false)
    allowed = true
    scheduler.schedule()
    scheduler.schedule()
    await vi.advanceTimersByTimeAsync(1000)
    expect(reconnect).toHaveBeenCalledOnce()
  })
})
