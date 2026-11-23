// Reader documents that render from REST and can start the local database without blocking mount.
const DEFERRED_PATHS = [/^\/b\/[^/]+\/?$/, /^\/user\/?$/, /^\/collection\/manage\/?$/]

export function isDeferredLocalStartupPath(pathname: string): boolean {
  return DEFERRED_PATHS.some(pattern => pattern.test(pathname))
}

// A deferred document hands any other destination to a new document, so it starts with normal local-first guarantees.
export function needsLocalStartupDocumentExit(pathname: string): boolean {
  return !isDeferredLocalStartupPath(pathname)
}
