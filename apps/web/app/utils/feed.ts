import type { FeedKind } from '@slax-reader/contracts'

/** Legacy RSS responses predate the kind discriminator. */
export const feedRowKind = (row: { kind?: string | null }): FeedKind => (row.kind === 'newsletter' ? 'newsletter' : 'rss')
