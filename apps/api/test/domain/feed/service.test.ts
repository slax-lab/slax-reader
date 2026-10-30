import { describe, test, expect, vi } from 'vitest'
import { FeedService, encodeFeedCursor, decodeFeedCursor } from '@/domain/feed'
import { FeedController } from '@/handler/http/feedController'
import { createMockCtx } from '@test/helpers/mockFactory'
const rssId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  source = 'newsletter:' + 'a'.repeat(64)
const entry = {
  id: 'newsletter:10',
  kind: 'newsletter' as const,
  subscription_id: source,
  source_title: 'Sender',
  title: 'Mail',
  author: 'Sender',
  summary: 'Summary',
  article_url: null,
  image_url: null,
  published_at: null,
  first_seen_at: new Date('2026-10-22'),
  sort_at: new Date('2026-10-22'),
  bookmark_user_uuid: null,
  content_key: 'newsletter-content/body',
  content_truncated: false
}
const wire = (kinds: ('rss' | 'newsletter')[] = ['rss', 'newsletter']) => {
  const repo = {
    enabledKinds: vi.fn().mockResolvedValue(kinds),
    newsletterSources: vi.fn().mockResolvedValue([{ id: source, kind: 'newsletter', title: 'Sender', sender: 'sender@example.com' }]),
    entries: vi.fn().mockResolvedValue([]),
    entry: vi.fn().mockResolvedValue(entry),
    historyFeeds: vi.fn().mockResolvedValue([]),
    oldestRssEntry: vi.fn().mockResolvedValue({ id: rssId, sort_at: new Date('2020-01-01') })
  }
  const rss = { subscriptions: vi.fn().mockResolvedValue([]), entries: vi.fn().mockResolvedValue({ items: [] }), detail: vi.fn() }
  const content = { read: vi.fn().mockResolvedValue('<p>Mail</p>') },
    ctx = createMockCtx({ userId: 7 })
  return { repo, rss, content, ctx, service: new FeedService(repo as never, rss as never, content as never) }
}
describe('independent Feed facade', () => {
  test('newsletter source DTO has no fake polling state and needs no RSS service', async () => {
    const p = wire(['newsletter'])
    expect(await p.service.subscriptions(p.ctx)).toEqual({ items: [{ id: source, kind: 'newsletter', title: 'Sender', sender: 'sender@example.com' }] })
    expect(p.rss.subscriptions).not.toHaveBeenCalled()
  })
  test('detail dispatches private mail content and does not expose storage fields', async () => {
    const p = wire(['newsletter']),
      detail = await p.service.detail(p.ctx, 'newsletter:10')
    expect(detail).toMatchObject({ kind: 'newsletter', id: 'newsletter:10', content_html: '<p>Mail</p>' })
    expect(detail).not.toHaveProperty('content_key')
  })
  test('cursor binds owner, kinds and selector and keeps a numeric mail ID as string', () => {
    const token = encodeFeedCursor(7, source, ['rss', 'newsletter'], entry)
    expect(decodeFeedCursor(token, 7, source, ['newsletter', 'rss'])).toEqual({ at: new Date('2026-10-22'), kind: 'newsletter', id: 'newsletter:10' })
    for (const [user, sub, kinds] of [
      [8, source, ['rss', 'newsletter']],
      [7, null, ['rss', 'newsletter']],
      [7, source, ['rss']]
    ] as const)
      expect(() => decodeFeedCursor(token, user, sub, [...kinds])).toThrow()
  })
  test('history uses the public RSS service with an oldest cached cursor, not a before escape', async () => {
    const p = wire()
    p.repo.historyFeeds.mockResolvedValue([{ id: 'rss', history_checked_at: null, history_url: null, error: null }])
    const ordinary = await p.service.entries(p.ctx, {})
    expect(ordinary.history_status).toBe('available')
    expect(p.rss.entries).not.toHaveBeenCalled()
    await p.service.entries(p.ctx, { fetch_history: '1' })
    const query = p.rss.entries.mock.calls[0][1]
    expect(query).toMatchObject({ limit: '1', fetch_history: '1' })
    expect(query).not.toHaveProperty('before')
    expect(JSON.parse(atob(query.cursor))).toMatchObject({ userId: 7, subscription: null, id: rssId, at: '2020-01-01T00:00:00.000Z' })
    const only = wire(['newsletter'])
    await only.service.entries(only.ctx, { fetch_history: '1' })
    expect(only.rss.entries).not.toHaveBeenCalled()
  })
  test('gate transitions after network work cannot reuse a mixed cursor', async () => {
    const p = wire()
    p.repo.historyFeeds.mockResolvedValue([{ id: 'rss', history_checked_at: null, history_url: null, error: null }])
    p.repo.enabledKinds.mockResolvedValueOnce(['rss', 'newsletter']).mockResolvedValue(['newsletter'])
    await expect(p.service.entries(p.ctx, { fetch_history: '1' })).rejects.toMatchObject({ status: 400 })
  })
  test.each([
    { limit: '0' },
    { limit: '51' },
    { before: 'bad' },
    { before: 'newsletter:0' },
    { before: 'newsletter:9223372036854775808' },
    { subscription_id: 'newsletter:wrong' }
  ])('rejects invalid query %j', async query => {
    const p = wire()
    await expect(p.service.entries(p.ctx, query)).rejects.toMatchObject({ status: 400 })
  })
  test('disabled content and unknown/cross-source anchors are rejected', async () => {
    const p = wire([])
    expect((await p.service.entries(p.ctx, {})).items).toEqual([])
    await expect(p.service.detail(p.ctx, 'newsletter:10')).rejects.toMatchObject({ status: 404 })
    const q = wire()
    await expect(q.service.entries(q.ctx, { before: 'newsletter:10', subscription_id: rssId })).rejects.toMatchObject({ status: 404 })
  })
  test('encoded typed entry paths are accepted and infrastructure failures have private safe responses', async () => {
    const p = wire(),
      controller = new FeedController(p.service, null as never)
    const res = await controller.entry(p.ctx, new Request('http://localhost/v1/feed/entries/newsletter%3A10'))
    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toBe('private, no-store')
    const logs = vi.spyOn(console, 'error').mockImplementation(() => {})
    p.repo.enabledKinds.mockRejectedValue(new Error('private database password'))
    const fail = await controller.listEntries(p.ctx, new Request('http://localhost/v1/feed/entries'))
    expect(fail.status).toBe(503)
    expect(JSON.stringify(logs.mock.calls)).not.toContain('password')
    logs.mockRestore()
  })
})
