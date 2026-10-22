import { describe, expect, test, vi } from 'vitest'
import { FeedService, decodeFeedCursor, encodeFeedCursor } from '@/domain/feed'
import { FeedController } from '@/handler/http/feedController'
import { RssError } from '@/domain/rss/feed'
import { createMockCtx } from '@test/helpers/mockFactory'
import type { FeedEntryRow, FeedSubscriptionRow } from '@/infra/repository/dbFeed'

const id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const subscription = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
const entry = (kind: 'rss' | 'newsletter' = 'newsletter'): FeedEntryRow => ({
  id,
  subscription_id: subscription,
  kind,
  feed_id: 'source',
  source_title: 'Sender',
  title: 'Mail',
  author: null,
  summary: 'Summary',
  article_url: null,
  image_url: null,
  published_at: null,
  first_seen_at: new Date('2026-10-22'),
  sort_at: new Date('2026-10-22'),
  updated_at: new Date('2026-10-22'),
  bookmark_user_uuid: null,
  content_key: 'rss-content/source/body',
  content_truncated: false
})
function wire(kinds: ('rss' | 'newsletter')[] = ['rss', 'newsletter']) {
  const repo = {
    enabledKinds: vi.fn().mockResolvedValue(kinds),
    subscriptions: vi.fn().mockResolvedValue([]),
    entries: vi.fn().mockResolvedValue([]),
    entry: vi.fn().mockResolvedValue(entry()),
    historyFeeds: vi.fn().mockResolvedValue([])
  }
  const rss = {
    subscription: vi.fn().mockRejectedValue(new Error('A newsletter must never build a favicon')),
    item: (row: FeedEntryRow) => ({
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
      sort_at: row.sort_at.toISOString(),
      bookmark_user_uuid: row.bookmark_user_uuid
    }),
    loadHistory: vi.fn().mockResolvedValue(undefined)
  }
  const content = { read: vi.fn().mockResolvedValue('<p>Sanitized mail</p>') }
  const ctx = createMockCtx({ userId: 7 })
  return { repo, rss, content, ctx, service: new FeedService(repo as never, rss as never, content as never) }
}
describe('Feed facade', () => {
  test('newsletter subscriptions expose kind without building a favicon or refresh state', async () => {
    const { repo, service, ctx } = wire(['newsletter'])
    repo.subscriptions.mockResolvedValue([
      {
        id: subscription,
        kind: 'newsletter',
        feed_id: 'source',
        user_id: 7,
        feed_url: 'newsletter:opaque',
        title: 'Sender',
        remark: null,
        site_url: 'https://sender.example',
        icon_url: 'https://untrusted.example/icon',
        lease_token: 'internal',
        lease_until: new Date(Date.now() + 60_000),
        last_checked_at: null,
        last_success_at: new Date('2026-10-22'),
        next_fetch_at: new Date('2026-10-22'),
        next_allowed_at: new Date('2026-10-22'),
        error: null
      } as FeedSubscriptionRow
    ])
    expect((await service.subscriptions(ctx)).items).toEqual([
      {
        id: subscription,
        kind: 'newsletter',
        feed_url: 'newsletter:opaque',
        title: 'Sender',
        remark: null,
        site_url: 'https://sender.example',
        icon_url: null,
        refreshing: false,
        last_checked_at: null,
        last_success_at: '2026-10-22T00:00:00.000Z',
        next_fetch_at: '2026-10-22T00:00:00.000Z',
        next_allowed_at: '2026-10-22T00:00:00.000Z',
        error: null
      }
    ])
  })
  test('both Labs off yields empty lists and denies entry content', async () => {
    const { service, ctx } = wire([])
    expect(await service.subscriptions(ctx)).toEqual({ items: [] })
    expect(await service.entries(ctx, {})).toEqual({ items: [], has_more: false, cached_more: false, history_status: 'exhausted', retry_at: null, next_cursor: null })
    await expect(service.detail(ctx, id)).rejects.toMatchObject({ code: 'not_found' })
  })
  test('returns sanitized detail and hides internal keys', async () => {
    const { service, ctx } = wire(['newsletter'])
    const detail = await service.detail(ctx, id)
    expect(detail).toMatchObject({ id, kind: 'newsletter', content_html: '<p>Sanitized mail</p>', content_source: 'feed', content_truncated: false })
    expect(detail).not.toHaveProperty('content_key')
    expect(detail).not.toHaveProperty('feed_id')
  })
  test('binds cursors to account, selected subscription, and effective kinds', () => {
    const cursor = encodeFeedCursor(7, subscription, ['newsletter', 'rss'], entry())
    expect(decodeFeedCursor(cursor, 7, subscription, ['rss', 'newsletter'])).toEqual({ at: new Date('2026-10-22'), id })
    for (const [raw, user, source, kinds] of [
      [cursor, 8, subscription, ['newsletter', 'rss']],
      [cursor, 7, null, ['newsletter', 'rss']],
      [cursor, 7, subscription, ['rss']],
      ['malformed', 7, subscription, ['rss']]
    ] as const)
      expect(() => decodeFeedCursor(raw, user, source, [...kinds])).toThrow('not_found')
  })
  test('rejects a local anchor from another selected source or a disabled kind', async () => {
    const { service, repo, ctx } = wire(['rss', 'newsletter'])
    await expect(service.entries(ctx, { before: id, subscription_id: 'cccccccc-cccc-cccc-cccc-cccccccccccc' })).rejects.toMatchObject({ code: 'not_found' })
    repo.enabledKinds.mockResolvedValue(['rss'])
    await expect(service.entries(ctx, { before: id })).rejects.toMatchObject({ code: 'not_found' })
    await expect(service.entries(ctx, { before: id, cursor: 'also-set' })).rejects.toMatchObject({ code: 'not_found', status: 400 })
  })
  test('only deliberate history requests fetch RSS and preserve a mixed timeline cursor', async () => {
    const { service, repo, rss, ctx } = wire()
    const candidate = { id: 'rss', history_checked_at: null, history_url: null, error: null }
    repo.entries.mockResolvedValue([entry()])
    repo.historyFeeds.mockResolvedValue([candidate])
    const first = await service.entries(ctx, {})
    expect(first).toMatchObject({ items: [{ kind: 'newsletter' }], history_status: 'available', has_more: true, cached_more: false })
    expect(rss.loadHistory).not.toHaveBeenCalled()
    const second = await service.entries(ctx, { cursor: first.next_cursor!, fetch_history: '1' })
    expect(rss.loadHistory).toHaveBeenCalledWith(ctx, candidate)
    expect(second.items[0].kind).toBe('newsletter')
    const newsletterOnly = wire(['newsletter'])
    await newsletterOnly.service.entries(newsletterOnly.ctx, { fetch_history: '1' })
    expect(newsletterOnly.rss.loadHistory).not.toHaveBeenCalled()
  })
  test('history rechecks effective Labs after a network operation', async () => {
    const { service, repo, ctx } = wire()
    repo.historyFeeds.mockResolvedValue([{ id: 'rss', history_checked_at: null, history_url: null, error: null }])
    repo.enabledKinds.mockResolvedValueOnce(['rss', 'newsletter']).mockResolvedValue(['newsletter'])
    await expect(service.entries(ctx, { fetch_history: '1' })).rejects.toMatchObject({ code: 'not_found', status: 400 })
  })
  test.each([{ limit: '0' }, { limit: '51' }, { fetch_history: 'true' }, { before: 'bad' }])('rejects malformed queries %j', async query => {
    const { service, ctx } = wire()
    await expect(service.entries(ctx, query)).rejects.toMatchObject({ code: 'not_found', status: 400 })
  })
  test('unexpected infrastructure failures produce a private generic response', async () => {
    const { service, repo, ctx } = wire()
    repo.enabledKinds.mockRejectedValue(new Error('private database diagnostics'))
    const response = await new FeedController(service).listSubscriptions(ctx, new Request('https://api.example/v1/feed/subscriptions'))
    expect(response.status).toBe(503)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(await response.json()).toMatchObject({ message: 'source_unavailable', data: { error: 'source_unavailable' } })
  })
  test('Feed HTTP success and failures are private and not cached', async () => {
    const { service, repo, ctx } = wire()
    const controller = new FeedController(service)
    const response = await controller.listEntries(ctx, new Request('https://api.example/v1/feed/entries'))
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    repo.entry.mockRejectedValue(new RssError('not_found', 404))
    const denied = await controller.entry(ctx, new Request('https://api.example/v1/feed/entries/' + id))
    expect(denied.status).toBe(404)
    expect(denied.headers.get('Cache-Control')).toBe('private, no-store')
    const malformed = await controller.entry(ctx, new Request('https://api.example/v1/feed/entries/not-an-id'))
    expect(malformed.status).toBe(404)
  })
})
