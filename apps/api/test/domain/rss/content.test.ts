import { describe, expect, test, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { RssContent } from '@/domain/rss/content'
import { parseFeed } from '@/domain/rss/feed'
import { createMockCtx } from '@test/helpers/mockFactory'
import { memoryRssBucket } from './testBucket'
vi.mock('@/utils/strings', async original => ({
  ...(await original<typeof import('@/utils/strings')>()),
  hashMD5: async (source: string | Uint8Array) => createHash('md5').update(source).digest('hex')
}))
const setup = () => {
  const bucket = memoryRssBucket()
  return { ...bucket, content: new RssContent(() => bucket.client as never), ctx: createMockCtx({ userId: 7 }) }
}
describe('RSS R2 content', () => {
  test('ingest stores sanitized proxy HTML, retains all roots and optimizes bookmark image URLs', async () => {
    const { content, ctx, objects } = setup()
    const result = await content.storeItem(ctx.env, 'feed', {
      content_html: '<p>First</p><img src="https://mmbiz.qpic.cn/image"><p>Last</p><script>bad()</script>',
      image_url: 'https://mmbiz.qpic.cn/cover',
      article_url: 'https://mp.weixin.qq.com/article'
    })
    const html = objects.get(result.content_key)!.body
    expect(html).toContain('<p>First</p>')
    expect(html).toContain('<p>Last</p>')
    expect(html).not.toContain('<script')
    expect(html).not.toContain('src="https://mmbiz')
    expect(html).toContain('m=rss')
    const source = new URL(decodeURIComponent(new URL(result.image_url!).searchParams.get('u')!))
    expect(source.searchParams.get('tp')).toBe('webp')
    expect(source.searchParams.get('wxfrom')).toBe('5')
    expect(await content.read(result.content_key)).toBe(html)
  })
  test('revisions use different objects so late writers cannot overwrite published content', async () => {
    const { content, ctx, objects } = setup()
    const item = { content_html: '<p>Original</p>', image_url: null, article_url: null }
    const a = await content.storeItem(ctx.env, 'feed', item)
    const b = await content.storeItem(ctx.env, 'feed', { ...item, content_html: '<p>New</p>' })
    expect(a.content_key).not.toBe(b.content_key)
    expect(objects.size).toBe(2)
    expect(await content.read(a.content_key)).toContain('Original')
  })
  test('304 performs no R2 I/O and new metadata never contains HTML', async () => {
    const { content, ctx, client } = setup()
    expect(await content.store(ctx.env, 'feed', { unchanged: true })).toEqual({ unchanged: true })
    expect(client.putIfKeyExists).not.toHaveBeenCalled()
    const feed = await parseFeed('<rss><channel><title>A</title><item><guid>id</guid><description>Body</description></item></channel></rss>', 'https://example.com/rss')
    const stored = await content.store(ctx.env, 'feed', { unchanged: false, feed, etag: 'tag', lastModified: null })
    if (stored.unchanged) throw new Error('Expected body')
    expect(stored.feed.items[0]).not.toHaveProperty('content_html')
    expect(stored.feed.items[0].content_key).toMatch(/^rss-content\/feed\//)
  })
  test('unchanged HTML reuses the referenced object even when the source returns 200', async () => {
    const { content, ctx, client } = setup()
    const item = { content_html: '<p>Same</p>', image_url: null, article_url: null }
    const first = await content.storeItem(ctx.env, 'feed', item)
    expect(await content.storeItem(ctx.env, 'feed', item, first.content_key)).toEqual(first)
    expect(client.putIfKeyExists).toHaveBeenCalledTimes(1)
  })
  test('unavailable or invalid objects produce controlled errors', async () => {
    const { content } = setup()
    await expect(content.read('bookmark/private')).rejects.toMatchObject({ code: 'source_unavailable' })
    await expect(content.read('rss-content/missing')).rejects.toMatchObject({ code: 'source_unavailable' })
  })
  test('garbage collection preserves referenced and recent objects and advances past full pages', async () => {
    const { content, objects, r2 } = setup()
    const old = new Date(Date.now() - 48 * 3600_000)
    for (let i = 0; i < 200; i++) objects.set(`rss-content/a/${i.toString().padStart(3, '0')}`, { body: 'used', uploaded: old })
    objects.set('rss-content/z/orphan', { body: 'unused', uploaded: old })
    objects.set('rss-content/z/recent', { body: 'not yet committed', uploaded: new Date() })
    const referencedContent = vi.fn(async (keys: string[]) => keys.filter(key => key.startsWith('rss-content/a/')))
    await content.sweep({ referencedContent } as never)
    expect(objects.has('rss-content/z/orphan')).toBe(true)
    await content.sweep({ referencedContent } as never)
    expect(objects.has('rss-content/z/orphan')).toBe(false)
    expect(objects.has('rss-content/z/recent')).toBe(true)
    expect(objects.has('rss-content/a/000')).toBe(true)
    expect(r2.list.mock.calls[1][0].cursor).toBe('rss-content/a/199')
  })
})
