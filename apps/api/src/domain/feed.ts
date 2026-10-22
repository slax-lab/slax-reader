import { inject, injectable } from '@/decorators/di'
import { FeedRepo, type FeedEntryRow, type FeedSubscriptionRow } from '@/infra/repository/dbFeed'
import { ContextManager } from '@/utils/context'
import { RssService, rssHistoryState } from './rss'
import { RssContent } from './rss/content'
import { RssError } from './rss/feed'
import type { FeedEntriesQuery, FeedEntriesResponse, FeedEntry, FeedEntryDetail, FeedKind, FeedSubscription, FeedSubscriptionsResponse } from '@slax-reader/contracts'

const kindSet = (kinds: FeedKind[]) => [...new Set(kinds)].sort().join(',')

export function encodeFeedCursor(userId: number, subscription: string | null, kinds: FeedKind[], row: Pick<FeedEntryRow, 'sort_at' | 'id'>): string {
  return btoa(JSON.stringify({ userId, subscription, kinds: kindSet(kinds), at: row.sort_at.toISOString(), id: row.id }))
}

export function decodeFeedCursor(raw: string | undefined, userId: number, subscription: string | null, kinds: FeedKind[]) {
  if (!raw) return null
  try {
    if (raw.length > 1024) throw new Error()
    const cursor = JSON.parse(atob(raw))
    if (cursor.userId !== userId || cursor.subscription !== subscription || cursor.kinds !== kindSet(kinds) || !/^[a-f\d-]{36}$/.test(cursor.id) || typeof cursor.at !== 'string')
      throw new Error()
    const at = new Date(cursor.at)
    if (!Number.isFinite(at.valueOf())) throw new Error()
    return { at, id: cursor.id as string }
  } catch {
    throw new RssError('not_found', 400)
  }
}

@injectable()
export class FeedService {
  constructor(
    @inject(FeedRepo) private repo: FeedRepo,
    @inject(RssService) private rss: RssService,
    @inject(RssContent) private content: RssContent
  ) {}

  private async kinds(ctx: ContextManager) {
    if (!ctx.getUserId()) throw new RssError('not_found', 401)
    return this.repo.enabledKinds(ctx.getUserId())
  }

  private async subscription(ctx: ContextManager, row: FeedSubscriptionRow): Promise<FeedSubscription> {
    if (row.kind === 'rss') return { ...(await this.rss.subscription(ctx, row)), kind: 'rss' }
    // Newsletter sources have an opaque internal URL, never a fetchable favicon source.
    return {
      id: row.id,
      kind: 'newsletter',
      feed_url: row.feed_url,
      title: row.title,
      remark: row.remark ?? null,
      site_url: row.site_url,
      icon_url: null,
      refreshing: false,
      last_checked_at: row.last_checked_at?.toISOString() || null,
      last_success_at: row.last_success_at?.toISOString() || null,
      next_fetch_at: row.next_fetch_at.toISOString(),
      next_allowed_at: row.next_allowed_at.toISOString(),
      error: null
    }
  }

  async subscriptions(ctx: ContextManager): Promise<FeedSubscriptionsResponse> {
    const kinds = await this.kinds(ctx)
    return { items: kinds.length ? await Promise.all((await this.repo.subscriptions(ctx.getUserId(), kinds)).map(row => this.subscription(ctx, row))) : [] }
  }

  private item(row: FeedEntryRow): FeedEntry {
    return { ...this.rss.item(row), kind: row.kind }
  }

  async entries(ctx: ContextManager, query: FeedEntriesQuery): Promise<FeedEntriesResponse> {
    const kinds = await this.kinds(ctx)
    const limit = query.limit === undefined ? 20 : Number(query.limit)
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new RssError('not_found', 400)
    if (query.fetch_history !== undefined && query.fetch_history !== '1') throw new RssError('not_found', 400)
    if (query.before !== undefined && (query.cursor !== undefined || !/^[a-f\d-]{36}$/.test(query.before))) throw new RssError('not_found', 400)
    const subscription = query.subscription_id || null
    const anchor = query.before ? await this.repo.entry(ctx.getUserId(), query.before, kinds) : null
    if (anchor && (!kinds.includes(anchor.kind) || (subscription && anchor.subscription_id !== subscription))) throw new RssError('not_found', 404)
    const cursor = anchor ? { at: anchor.sort_at, id: anchor.id } : decodeFeedCursor(query.cursor, ctx.getUserId(), subscription, kinds)
    if (!kinds.length) return { items: [], next_cursor: null, has_more: false, cached_more: false, history_status: 'exhausted', retry_at: null }
    const withHistory = !!anchor
    let rows = await this.repo.entries(ctx.getUserId(), kinds, subscription, cursor, limit + 1, withHistory)
    let feeds = kinds.includes('rss') ? await this.repo.historyFeeds(ctx.getUserId(), subscription) : []
    if (query.fetch_history === '1' && rows.length < limit && feeds.length) {
      const candidates = feeds.filter(row => rssHistoryState([row]).history_status === 'available').slice(0, 3)
      await Promise.all(candidates.map(row => this.rss.loadHistory(ctx, row)))
      // A cursor cannot resume under a different effective source set after network work.
      if (kindSet(await this.kinds(ctx)) !== kindSet(kinds)) throw new RssError('not_found', 400)
      rows = await this.repo.entries(ctx.getUserId(), kinds, subscription, cursor, limit + 1, withHistory)
      feeds = await this.repo.historyFeeds(ctx.getUserId(), subscription)
    }
    const page = rows.slice(0, limit)
    const history = rssHistoryState(feeds)
    const cachedMore = rows.length > limit
    const hasMore = cachedMore || history.history_status !== 'exhausted'
    return {
      items: page.map(row => this.item(row)),
      next_cursor: hasMore
        ? page.length
          ? encodeFeedCursor(ctx.getUserId(), subscription, kinds, page[page.length - 1])
          : anchor
            ? encodeFeedCursor(ctx.getUserId(), subscription, kinds, anchor)
            : query.cursor || null
        : null,
      has_more: hasMore,
      cached_more: cachedMore,
      ...history
    }
  }

  async detail(ctx: ContextManager, id: string): Promise<FeedEntryDetail> {
    const kinds = await this.kinds(ctx)
    if (!kinds.length) throw new RssError('not_found', 404)
    const row = await this.repo.entry(ctx.getUserId(), id, kinds)
    return { ...this.item(row), content_html: await this.content.read(row.content_key), content_source: 'feed', content_truncated: row.content_truncated }
  }
}
