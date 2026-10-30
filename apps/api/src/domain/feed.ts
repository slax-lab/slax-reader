import { inject, injectable } from '@/decorators/di'
import { FeedRepo, type FeedEntryRow, type FeedCursor } from '@/infra/repository/dbFeed'
import { ContextManager } from '@/utils/context'
import { RssService, rssHistoryState, encodeRssCursor } from './rss'
import { NewsletterContent } from './newsletterContent'
import { RssError } from './rss/feed'
import type { FeedEntriesQuery, FeedEntriesResponse, FeedEntry, FeedEntryDetail, FeedKind, FeedSubscriptionsResponse } from '@slax-reader/contracts'
export const FEED_UUID = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i
export function newsletterEntryId(value: string): bigint | null {
  if (!/^newsletter:[1-9][0-9]{0,18}$/.test(value)) return null
  const id = BigInt(value.slice(11))
  return id <= 9223372036854775807n ? id : null
}
export const validFeedId = (id: string) => FEED_UUID.test(id) || newsletterEntryId(id) !== null
const validSource = (id: string) => FEED_UUID.test(id) || /^newsletter:[a-f0-9]{64}$/.test(id)
const kindSet = (kinds: FeedKind[]) => [...new Set(kinds)].sort().join(',')
export function encodeFeedCursor(userId: number, subscription: string | null, kinds: FeedKind[], row: Pick<FeedEntryRow, 'sort_at' | 'kind' | 'id'>): string {
  return btoa(JSON.stringify({ userId, subscription, kinds: kindSet(kinds), at: row.sort_at.toISOString(), kind: row.kind, id: row.id }))
}
export function decodeFeedCursor(raw: string | undefined, userId: number, subscription: string | null, kinds: FeedKind[]): FeedCursor | null {
  if (!raw) return null
  try {
    if (raw.length > 1024) throw new Error()
    const c = JSON.parse(atob(raw)),
      at = new Date(c.at)
    if (
      c.userId !== userId ||
      c.subscription !== subscription ||
      c.kinds !== kindSet(kinds) ||
      !kinds.includes(c.kind) ||
      typeof c.at !== 'string' ||
      !Number.isFinite(at.valueOf()) ||
      typeof c.id !== 'string' ||
      (c.kind === 'rss' ? !FEED_UUID.test(c.id) : newsletterEntryId(c.id) === null)
    )
      throw new Error()
    return { at, kind: c.kind, id: c.id }
  } catch {
    throw new RssError('not_found', 400)
  }
}
@injectable()
export class FeedService {
  constructor(
    @inject(FeedRepo) private repo: FeedRepo,
    @inject(RssService) private rss: RssService,
    @inject(NewsletterContent) private content: NewsletterContent
  ) {}
  private async kinds(ctx: ContextManager) {
    if (!ctx.getUserId()) throw new RssError('not_found', 401)
    return this.repo.enabledKinds(ctx.getUserId())
  }
  async subscriptions(ctx: ContextManager): Promise<FeedSubscriptionsResponse> {
    const kinds = await this.kinds(ctx)
    const rss = kinds.includes('rss') ? (await this.rss.subscriptions(ctx)).items.map(item => ({ ...item, kind: 'rss' as const })) : []
    const mail = kinds.includes('newsletter') ? await this.repo.newsletterSources(ctx.getUserId()) : []
    if (kindSet(await this.kinds(ctx)) !== kindSet(kinds)) throw new RssError('not_found', 400)
    return { items: [...rss, ...mail] }
  }
  private item(row: FeedEntryRow): FeedEntry {
    return {
      id: row.id,
      kind: row.kind,
      subscription_id: row.subscription_id,
      source_title: row.source_title,
      title: row.title,
      author: row.author,
      summary: row.summary,
      article_url: row.article_url,
      image_url: row.image_url,
      published_at: row.published_at?.toISOString() || null,
      first_seen_at: row.first_seen_at.toISOString(),
      sort_at: row.sort_at.toISOString(),
      bookmark_user_uuid: row.bookmark_user_uuid
    }
  }
  async entries(ctx: ContextManager, query: FeedEntriesQuery): Promise<FeedEntriesResponse> {
    const kinds = await this.kinds(ctx),
      limit = query.limit === undefined ? 20 : Number(query.limit),
      subscription = query.subscription_id || null
    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 50 ||
      (query.fetch_history !== undefined && query.fetch_history !== '1') ||
      (subscription && !validSource(subscription)) ||
      (query.before !== undefined && (query.cursor !== undefined || !validFeedId(query.before)))
    )
      throw new RssError('not_found', 400)
    if (!kinds.length) return { items: [], next_cursor: null, has_more: false, cached_more: false, history_status: 'exhausted', retry_at: null }
    const anchor = query.before ? await this.repo.entry(ctx.getUserId(), query.before, kinds) : null
    if (query.before && (!anchor || (subscription && anchor.subscription_id !== subscription) || !kinds.includes(anchor.kind))) throw new RssError('not_found', 404)
    const cursor = anchor ? { at: anchor.sort_at, kind: anchor.kind, id: anchor.id } : decodeFeedCursor(query.cursor, ctx.getUserId(), subscription, kinds)
    let rows = await this.repo.entries(ctx.getUserId(), kinds, subscription, cursor, limit + 1)
    const rssSelected = kinds.includes('rss') && (!subscription || FEED_UUID.test(subscription))
    let feeds = rssSelected ? await this.repo.historyFeeds(ctx.getUserId(), subscription) : []
    if (query.fetch_history === '1' && rows.length < limit && rssHistoryState(feeds).history_status === 'available') {
      const oldest = await this.repo.oldestRssEntry(ctx.getUserId(), subscription)
      await this.rss.entries(ctx, {
        ...(subscription ? { subscription_id: subscription } : {}),
        ...(oldest ? { cursor: encodeRssCursor(ctx.getUserId(), subscription, oldest) } : {}),
        limit: '1',
        fetch_history: '1'
      })
      if (kindSet(await this.kinds(ctx)) !== kindSet(kinds)) throw new RssError('not_found', 400)
      rows = await this.repo.entries(ctx.getUserId(), kinds, subscription, cursor, limit + 1)
      feeds = await this.repo.historyFeeds(ctx.getUserId(), subscription)
    }
    const page = rows.slice(0, limit),
      history = rssHistoryState(feeds),
      cachedMore = rows.length > limit,
      hasMore = cachedMore || history.history_status !== 'exhausted'
    return {
      items: page.map(row => this.item(row)),
      next_cursor: hasMore ? (page.length ? encodeFeedCursor(ctx.getUserId(), subscription, kinds, page[page.length - 1]) : query.cursor || null) : null,
      has_more: hasMore,
      cached_more: cachedMore,
      ...history
    }
  }
  async detail(ctx: ContextManager, id: string): Promise<FeedEntryDetail> {
    const kinds = await this.kinds(ctx)
    if (!validFeedId(id) || !kinds.length) throw new RssError('not_found', 404)
    const row = await this.repo.entry(ctx.getUserId(), id, kinds)
    const detail =
      row.kind === 'rss'
        ? { ...(await this.rss.detail(ctx, id)), kind: 'rss' as const }
        : { ...this.item(row), content_html: await this.content.read(row.content_key), content_source: 'feed' as const, content_truncated: row.content_truncated }
    if (kindSet(await this.kinds(ctx)) !== kindSet(kinds)) throw new RssError('not_found', 404)
    return detail
  }
}
