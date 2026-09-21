export type BookmarkOpenedFrom = 'bookmarks' | 'inbox_collection' | 'search_result' | 'direct'
export type CollectionOpenedFrom = 'external_link' | 'inbox'

const ENTRY_PARAMETER = '_slax_entry'

/** A one-use entry hint also works when the reader opens in a new tab. */
export const eventEntryUrl = (path: string, entry: BookmarkOpenedFrom | CollectionOpenedFrom): string => {
  const url = new URL(path, 'https://slax.invalid')
  url.searchParams.set(ENTRY_PARAMETER, entry)
  return `${url.pathname}${url.search}${url.hash}`
}

export const consumeEventEntry = <T extends string>(allowed: readonly T[], fallback: T): T => {
  const url = new URL(window.location.href)
  const entry = url.searchParams.get(ENTRY_PARAMETER)
  if (entry !== null) {
    url.searchParams.delete(ENTRY_PARAMETER)
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
  }
  return allowed.includes(entry as T) ? (entry as T) : fallback
}
