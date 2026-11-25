// One pending PowerSync reconnect at a time. In shared-worker mode the tab that wins the lock owns the
// schedule until its attempt settles; cancelling a pending retry settles the wait so the lock is released.
export interface ReconnectSchedulerOptions {
  delay: () => number
  canReconnect: () => boolean
  reconnect: () => Promise<unknown>
  sharedLock: () => boolean
  lockName?: string
}

export function createReconnectScheduler(options: ReconnectSchedulerOptions) {
  let timer: ReturnType<typeof setTimeout> | undefined
  let settleWait: (() => void) | undefined
  const lockName = options.lockName ?? 'slax-ps-reconnect-controller'

  const cancel = () => {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
    const settle = settleWait
    settleWait = undefined
    settle?.()
  }

  const waitAndReconnect = () =>
    new Promise<void>(resolve => {
      settleWait = resolve
      timer = setTimeout(() => {
        timer = undefined
        settleWait = undefined
        if (options.canReconnect()) void options.reconnect().finally(resolve)
        else resolve()
      }, options.delay())
    })

  const schedule = () => {
    if (!options.canReconnect() || timer !== undefined) return
    const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined
    if (options.sharedLock() && locks?.request) {
      void locks.request(lockName, { ifAvailable: true }, lock => (lock ? waitAndReconnect() : undefined)).catch(() => undefined)
    } else void waitAndReconnect()
  }

  return { schedule, cancel, pending: () => timer !== undefined }
}
