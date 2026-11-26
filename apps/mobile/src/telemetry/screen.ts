let current: string | undefined
let currentPage: string | undefined

const ROUTE_ID_PARAM: Record<string, string> = {Reader: 'bookmarkId'}
const PAGE_ID_PATTERN = /^[0-9A-Za-z_-]{1,64}$/

/** `DeleteAccount` → `delete-account`, the path segment of the app's page address. */
const routeSegment = (name: string) => name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase().replace(/[^a-z-]/g, '')

/**
 * The page address recorded with error and telemetry rows: `slaxreader://<route>`, plus the record id
 * for routes that show one record (`slaxreader://reader/<bookmarkId>`). No other parameter is kept.
 */
export function pageAddress(name: string | undefined, params?: object): string | undefined {
  if (!name || !/^[A-Za-z][A-Za-z0-9-]{0,31}$/.test(name)) return undefined
  const key = ROUTE_ID_PARAM[name]
  const id = key && params ? (params as Record<string, unknown>)[key] : undefined
  const base = `slaxreader://${routeSegment(name)}`
  return typeof id === 'string' && PAGE_ID_PATTERN.test(id) ? `${base}/${id}` : base
}

/** Updated by the navigator state listener with the route name and, for the page address, its params. */
export function setCurrentScreen(name: string | undefined, params?: object) {
  current = name
  currentPage = pageAddress(name, params)
}

export function currentScreen(): string | undefined {
  return current
}

export function currentPageUrl(): string | undefined {
  return currentPage
}
