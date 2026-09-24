import { DOMParser } from 'linkedom'
import { inject, injectable } from '@/decorators/di'
import type { LazyInstance } from '@/decorators/lazy'
import { BucketClient } from '@/infra/repository/bucketClient'
import type { RssRepo, StoredFeedItem, StoredFeedResult } from '@/infra/repository/dbRss'
import { hashSHA256 } from '@/utils/strings'
import { Imager } from '@/utils/imager'
import { sanitizeFeedHtml, RssError, type FeedResult } from './feed'

const PREFIX = 'rss-content/'
const GC_CURSOR = 'rss-maintenance/content-gc-cursor'

@injectable()
export class RssContent {
  constructor(@inject(BucketClient) private bucket: LazyInstance<BucketClient>) {}

  async storeItem(env: Env, feedId: string, item: { content_html: string; image_url: string | null; article_url: string | null }, previousKey?: string) {
    const base = new URL(item.article_url || 'https://rss.invalid/')
    const clean = sanitizeFeedHtml(item.content_html, base.href)
    const doc = new DOMParser().parseFromString(`<html><body>${clean.html}</body></html>`, 'text/html') as unknown as Document
    const imager = new Imager(env)
    await imager.batchReplaceImage(base, doc, 'rss')
    let image: string | null = null
    if (item.image_url) {
      const cover = new DOMParser().parseFromString('<html><body><img></body></html>', 'text/html') as unknown as Document
      cover.querySelector('img')!.setAttribute('src', item.image_url)
      await imager.batchReplaceImage(base, cover, 'rss')
      const replaced = cover.querySelector('img')?.getAttribute('src') || null
      // A failed replacement leaves the address the feed provided in place; publishing it
      // would send clients to load the source image directly, so keep no image instead.
      image = replaced && replaced !== item.image_url ? replaced : null
    }
    // Changed content gets a fresh object; unchanged content reuses only a
    // currently referenced revision. Expired writers cannot overwrite it.
    const html = doc.body.innerHTML || '<p></p>'
    const digest = await hashSHA256(html)
    if (previousKey?.startsWith(`${PREFIX}${feedId}/`) && previousKey.endsWith('/' + digest)) return { content_key: previousKey, image_url: image }
    const key = `${PREFIX}${feedId}/${crypto.randomUUID()}/${digest}`
    const object = await this.bucket().putIfKeyExists(key, html)
    if (!object) throw new RssError('source_unavailable', 503)
    return { content_key: key, image_url: image }
  }

  async store(env: Env, feedId: string, result: FeedResult, previous: Map<string, string> = new Map()): Promise<StoredFeedResult> {
    if (result.unchanged) return result
    const items: StoredFeedItem[] = []
    // Bound R2 operations and avoid creating detached writes after one rejects.
    for (let offset = 0; offset < result.feed.items.length; offset += 5) {
      const batch = await Promise.allSettled(
        result.feed.items.slice(offset, offset + 5).map(async item => {
          const { content_html, ...metadata } = item
          return { ...metadata, ...(await this.storeItem(env, feedId, { content_html, image_url: item.image_url, article_url: item.article_url }, previous.get(item.entry_key))) }
        })
      )
      for (const item of batch) {
        if (item.status === 'rejected') throw new RssError('source_unavailable', 503)
        items.push(item.value)
      }
    }
    return { ...result, feed: { ...result.feed, items } }
  }

  async read(key: string): Promise<string> {
    if (!key.startsWith(PREFIX)) throw new RssError('source_unavailable', 503)
    const object = await this.bucket().R2Bucket.get(key)
    if (!object) throw new RssError('source_unavailable', 503)
    return object.text()
  }

  async sweep(repo: RssRepo) {
    const bucket = this.bucket().R2Bucket
    const stored = await bucket.get(GC_CURSOR)
    const cursor = stored ? await stored.text() : ''
    const page = await bucket.list({ prefix: PREFIX, limit: 200, ...(cursor ? { cursor } : {}) })
    const before = Date.now() - 24 * 3600_000
    const candidates = page.objects.filter(object => object.uploaded.valueOf() < before).map(object => object.key)
    const referenced = new Set(await repo.referencedContent(candidates))
    const garbage = candidates.filter(key => !referenced.has(key))
    if (garbage.length) await bucket.delete(garbage)
    // Progress survives cron invocations; referenced first pages cannot starve later objects.
    await bucket.put(GC_CURSOR, page.truncated ? page.cursor : '')
  }
}
