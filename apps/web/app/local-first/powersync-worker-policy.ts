export function shouldUsePowerSyncSharedWorker(): boolean {
  // Match @powersync/web 2.4.0's resolveAndValidateOptions default policy.
  // Review these checks when upgrading the SDK; its resolver is internal.
  return typeof window !== 'undefined'
    && typeof navigator !== 'undefined'
    && typeof SharedWorker !== 'undefined'
    && !/(Android|iPhone|iPod|iPad)/i.test(navigator.userAgent)
    && !(window as Window & { safari?: unknown }).safari
}
