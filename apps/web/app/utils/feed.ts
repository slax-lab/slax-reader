import type { FeedEntry, FeedKind } from '@slax-reader/contracts'

/** Legacy RSS responses predate the kind discriminator. */
export const feedRowKind = (row: { kind?: string | null }): FeedKind => (row.kind === 'newsletter' ? 'newsletter' : 'rss')

/** The mixed timeline follows the server's time, kind, and per-kind ID ordering without rounding mail BIGINTs. */
export const compareFeedEntries = (a: FeedEntry, b: FeedEntry) => {
  const time =
    Date.parse(b.sort_at || b.first_seen_at) -
    Date.parse(a.sort_at || a.first_seen_at)
  if (time) return time
  if (a.kind !== b.kind) return a.kind === 'rss' ? -1 : 1
  if (a.kind === 'newsletter') {
    const first = BigInt(a.id.slice('newsletter:'.length)),
      second = BigInt(b.id.slice('newsletter:'.length))
    return first < second ? 1 : first > second ? -1 : 0
  }
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0
}

