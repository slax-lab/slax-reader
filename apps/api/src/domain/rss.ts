import { inject, injectable } from '@/decorators/di'
import { LabService } from './lab'
import { SearchService } from './search'
import { RssRepo, type RssEntryRow, type RssSubscriptionRow, type RssFeedRow } from '@/infra/repository/dbRss'
import { BookmarkSearchRepo } from '@/infra/repository/dbBookmarkSearch'
import { BookmarkRepo } from '@/infra/repository/dbBookmark'
import { ContextManager } from '@/utils/context'
import { Hashid } from '@/utils/hashids'
import { RssContent } from './rss/content'
import { publicTarget } from '@/utils/publicTargetPolicy'
import { URLPolicie } from '@/utils/urlPolicie'
import { buildImageProxyUrl } from '@/utils/imager'
import { fetchFeed, normalizeFeedUrl, RssError } from './rss/feed'
import type { RssEntry, RssEntryDetail, RssSubscription, RssErrorCode, RssEntriesQuery, RssEntriesResponse, RssRefreshResponse } from '@slax-reader/contracts'

export function encodeRssCursor(userId: number, subscription: string | null, row: RssEntryRow): string {
  return btoa(JSON.stringify({ userId, subscription, at: row.sort_at.toISOString(), id: row.id }))
}
export function decodeRssCursor(raw: string | undefined, userId: number, subscription: string | null) {
  if (!raw) return null
  try {
    if (raw.length > 1024) throw new Error()
    const cursor = JSON.parse(atob(raw))
    if (cursor.userId !== userId || cursor.subscription !== subscription || !/^[a-f\d-]{36}$/.test(cursor.id) || typeof cursor.at !== 'string') throw new Error()
    const at = new Date(cursor.at)
    if (!Number.isFinite(at.valueOf())) throw new Error()
    return { at, id: cursor.id as string }
  } catch {
    throw new RssError('not_found', 400)
  }
}

export function normalizeRssRemark(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null
  if (typeof raw !== 'string' || raw.length > 120 || /[\u0000-\u001f\u007f]/.test(raw)) throw new RssError('invalid_remark', 400)
  return raw.trim() || null
}

export function rssHistoryState(feeds: RssFeedRow[]): Pick<RssEntriesResponse, 'history_status' | 'retry_at'> {
  const remaining = feeds.filter(row => !row.history_checked_at || row.history_url)
  const now = Date.now()
  const retryAt = (row: RssFeedRow) => Math.max(row.history_retry_at?.valueOf() || 0, row.error ? row.next_allowed_at.valueOf() : 0)
  if (!remaining.length) return { history_status: 'exhausted', retry_at: null }
  if (remaining.some(row => (!row.lease_until || row.lease_until.valueOf() <= now) && retryAt(row) <= now)) return { history_status: 'available', retry_at: null }
  if (remaining.some(row => row.lease_until && row.lease_until.valueOf() > now)) return { history_status: 'loading', retry_at: null }
  return { history_status: 'retry', retry_at: new Date(Math.min(...remaining.map(retryAt))).toISOString() }
}

@injectable()
export class RssService {
  constructor(
    @inject(RssRepo) private repo: RssRepo,
    @inject(LabService) private labs: LabService,
    @inject(BookmarkSearchRepo) private search: BookmarkSearchRepo,
    @inject(BookmarkRepo) private bookmarks: BookmarkRepo,
    @inject(SearchService) private searchService: SearchService,
    @inject(RssContent) private content: RssContent
  ) {}

  private async allowed(ctx: ContextManager) {
    if (!ctx.getUserId()) throw new RssError('not_found', 401)
    if (!(await this.labs.isEnabled(ctx.getUserId(), 'rss'))) throw new RssError('lab_disabled', 403)
  }
  private async subscription(ctx: ContextManager, row: RssSubscriptionRow): Promise<RssSubscription> {
    let icon: string | null = null
    try {
      const site = new URL(row.site_url || row.feed_url)
      icon = await buildImageProxyUrl(ctx.env, new URL('/favicon.ico', site.origin).href, site.origin, 'rss')
    } catch {
      // An invalid site URL or proxy configuration must not hide the subscription.
    }
    return {
      id: row.id,
      feed_url: row.feed_url,
      title: row.title,
      remark: row.remark ?? null,
      site_url: row.site_url,
      icon_url: icon,
      refreshing: !!row.lease_token && !!row.lease_until && row.lease_until > new Date(),
      last_checked_at: row.last_checked_at?.toISOString() || null,
      last_success_at: row.last_success_at?.toISOString() || null,
      next_fetch_at: row.next_fetch_at.toISOString(),
      next_allowed_at: row.next_allowed_at.toISOString(),
      error: row.error as RssErrorCode | null
    }
  }
  async subscriptions(ctx: ContextManager) {
    await this.allowed(ctx)
    return { items: await Promise.all((await this.repo.subscriptions(ctx.getUserId())).map(row => this.subscription(ctx, row))) }
  }
  async add(ctx: ContextManager, raw: string, rawRemark?: unknown) {
    await this.allowed(ctx)
    const remark = normalizeRssRemark(rawRemark)
    const url = normalizeFeedUrl(raw)
    const limiter = ctx.env.BOOKMARK_ADD_RATE_LIMITER
    if (!limiter && ctx.env.RUN_ENV !== 'development') throw new RssError('source_unavailable', 503)
    if (limiter && !(await limiter.limit({ key: `rss-add:${ctx.getUserId()}` })).success) throw new RssError('refresh_limited', 429)
    const existing = await this.repo.reuseForAdd(ctx.getUserId(), url, remark)
    if (existing) return this.subscription(ctx, existing)
    let claim: RssFeedRow | undefined
    try {
      const fetched = await fetchFeed(url, {}, 30_000, ctx.env)
      if (fetched.unchanged) throw new RssError('invalid_feed')
      const reserved = await this.repo.beginAdd(ctx.getUserId(), url, remark)
      if (reserved.subscription) return this.subscription(ctx, reserved.subscription)
      claim = reserved.feed!
      const stored = await this.content.store(ctx.env, claim.id, fetched)
      if (stored.unchanged) throw new RssError('invalid_feed')
      return this.subscription(ctx, await this.repo.finishAdd(ctx.getUserId(), claim, stored, remark))
    } catch (error) {
      const failure = error instanceof RssError ? error : new RssError('source_unavailable', 503)
      if (claim) await this.repo.failAdd(claim, failure)
      throw failure
    }
  }

  async update(ctx: ContextManager, id: string, rawRemark: unknown) {
    await this.allowed(ctx)
    return this.subscription(ctx, await this.repo.updateRemark(ctx.getUserId(), id, normalizeRssRemark(rawRemark)))
  }
  async remove(ctx: ContextManager, id: string) {
    await this.allowed(ctx)
    await this.repo.remove(ctx.getUserId(), id)
    return null
  }
  async refresh(ctx: ContextManager, id: string): Promise<RssRefreshResponse> {
    await this.allowed(ctx)
    const row = await this.repo.claim(ctx.getUserId(), id)
    if (row.claimed) ctx.execution.waitUntil(this.process(ctx, row))
    return { status: row.claimed ? 'accepted' : 'refreshing', next_allowed_at: row.next_allowed_at.toISOString() }
  }
  private async process(ctx: ContextManager, row: RssFeedRow) {
    try {
      // Re-check immediately before fetching; the transaction fences commits after disabling/deletion.
      if (!(await this.repo.hasActiveSubscribers(row.id))) return
      let result
      try {
        const fetched = await fetchFeed(row.feed_url, row.history_checked_at ? row : {}, 30_000, ctx.env)
        result = fetched.unchanged ? fetched : await this.content.store(ctx.env, row.id, fetched, await this.repo.contentKeys(row.id))
      } catch (error) {
        result = error instanceof RssError ? error : new RssError('source_unavailable', 502)
      }
      await this.repo.finish(row, result)
    } catch (error) {
      if (!(error instanceof RssError)) console.error('RSS refresh commit failed')
    }
  }
  async tick(ctx: ContextManager) {
    // Claim only one concurrent batch at a time so leases do not expire waiting behind another batch.
    for (let batch = 0; batch < 10; batch++) {
      const rows = await this.repo.claimDue()
      if (!rows.length) break
      await Promise.all(rows.map(row => this.process(ctx, row)))
    }
    await this.repo.prune()
    try {
      await this.content.sweep(this.repo)
    } catch {
      console.error('RSS content cleanup deferred')
    }
    await this.dispatchSaves(ctx)
  }
  private item(row: RssEntryRow): RssEntry {
    return {
      id: row.id,
      subscription_id: row.subscription_id,
      source_title: row.source_title,
      title: row.title,
      author: row.author,
      summary: row.summary,
      article_url: row.article_url,
      image_url: row.image_url,
      published_at: row.published_at?.toISOString() || null,
      first_seen_at: row.first_seen_at.toISOString(),
      bookmark_user_uuid: row.bookmark_user_uuid
    }
  }
  async entries(ctx: ContextManager, query: RssEntriesQuery): Promise<RssEntriesResponse> {
    await this.allowed(ctx)
    const limit = query.limit === undefined ? 20 : Number(query.limit)
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new RssError('not_found', 400)
    if (query.fetch_history !== undefined && query.fetch_history !== '1') throw new RssError('not_found', 400)
    const subscription = query.subscription_id || null
    const cursor = decodeRssCursor(query.cursor, ctx.getUserId(), subscription)
    let rows = await this.repo.entries(ctx.getUserId(), subscription, cursor, limit + 1)
    let feeds = await this.repo.historyFeeds(ctx.getUserId(), subscription)
    if (query.fetch_history === '1' && rows.length < limit) {
      // Bound one click across All feeds; the oldest-checked source is selected first.
      const candidates = feeds.filter(row => rssHistoryState([row]).history_status === 'available').slice(0, 3)
      await Promise.all(candidates.map(row => this.loadHistory(ctx, row)))
      // Ownership can change while network/R2 work is in flight.
      await this.allowed(ctx)
      rows = await this.repo.entries(ctx.getUserId(), subscription, cursor, limit + 1)
      feeds = await this.repo.historyFeeds(ctx.getUserId(), subscription)
    }
    const page = rows.slice(0, limit)
    const history = rssHistoryState(feeds)
    const cachedMore = rows.length > limit
    const hasMore = cachedMore || history.history_status !== 'exhausted'
    return {
      items: page.map(row => this.item(row)),
      next_cursor: hasMore ? (page.length ? encodeRssCursor(ctx.getUserId(), subscription, page[page.length - 1]) : query.cursor || null) : null,
      has_more: hasMore,
      cached_more: cachedMore,
      ...history
    }
  }
  private async loadHistory(ctx: ContextManager, candidate: RssFeedRow) {
    // Existing feeds need one unconditional head read to discover paging links.
    // Then fetch at most one archive page. New feeds already have this metadata.
    const attempts = candidate.history_checked_at ? 1 : 2
    for (let attempt = 0; attempt < attempts; attempt++) {
      const row = await this.repo.claimHistory(ctx.getUserId(), candidate.id)
      if (!row) return
      const url = row.history_url || row.feed_url
      try {
        const fetched = await fetchFeed(url, {}, 30_000, ctx.env)
        const stored = fetched.unchanged ? fetched : await this.content.store(ctx.env, row.id, fetched, await this.repo.contentKeys(row.id))
        if (!(await this.repo.finishHistory(row, url, stored))) return
      } catch (error) {
        await this.repo.finishHistory(row, url, error instanceof RssError ? error : new RssError('source_unavailable', 502))
        return
      }
    }
  }
  async detail(ctx: ContextManager, id: string): Promise<RssEntryDetail> {
    await this.allowed(ctx)
    const row = await this.repo.entry(ctx.getUserId(), id)
    return { ...this.item(row), content_html: await this.content.read(row.content_key), content_source: 'feed', content_truncated: row.content_truncated }
  }
  async save(ctx: ContextManager, id: string) {
    await this.allowed(ctx)
    const entry = await this.repo.entry(ctx.getUserId(), id)
    if (!entry.article_url) throw new RssError('article_url_missing', 409)
    const url = publicTarget(entry.article_url)
    const policy = new URLPolicie(ctx.env, url)
    if (policy.isBlocked() || policy.isUrlShortcut()) throw new RssError('article_url_missing', 409)
    await this.labs.assertUrlAllowed(ctx, url.href)
    const saved = await this.repo.save(ctx.getUserId(), id, entry.article_url)
    ctx.execution.waitUntil(this.dispatchSaves(ctx, ctx.getUserId()).catch(() => console.error('RSS save dispatch deferred')))
    return saved
  }
  async dispatchSaves(ctx: ContextManager, userId?: number) {
    const jobs = await this.repo.saveJobs(userId)
    for (let offset = 0; offset < jobs.length; offset += 5) {
      await Promise.all(
        jobs.slice(offset, offset + 5).map(async job => {
          try {
            await this.search.upsertUserBookmark(job.user_id, job.bookmark_id)
            await this.searchService.clearSearchCache(ctx, job.user_id)
            const hashIds = new Hashid(ctx.env, job.user_id)
            const id = `rss-bookmark-${job.bookmark_id}`
            if (job.status !== 'success') {
              try {
                await ctx.env.CRAWL_WORKFLOW.create({
                  id,
                  params: {
                    url: job.target_url,
                    bookmarkId: job.bookmark_id,
                    userId: job.user_id,
                    enUserId: hashIds.encodeId(job.user_id),
                    userLang: job.lang || 'en',
                    callbackChatId: 0,
                    callbackOriginMessageId: 0,
                    ignoreGenerateTag: false
                  }
                })
              } catch {
                // An ambiguous create is retried with the same ID. Only an existing instance acknowledges it.
                const instance = await ctx.env.CRAWL_WORKFLOW.get(id)
                await instance.status()
              }
            }
            await this.bookmarks.createBookmarkChangeLog(job.user_id, job.target_url, job.bookmark_id, 'add', new Date())
            await this.repo.ackSave(job.bookmark_id)
          } catch {
            console.error('RSS save remains pending', job.bookmark_id)
          }
        })
      )
    }
  }
}
