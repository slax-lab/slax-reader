import { DOMParser } from 'linkedom'
import { inject, injectable } from '@/decorators/di'
import type { LazyInstance } from '@/decorators/lazy'
import { BucketClient } from '@/infra/repository/bucketClient'
import type { NewsletterRepo } from '@/infra/repository/dbNewsletter'
import type { ContextManager } from '@/utils/context'
import { buildImageProxyUrl } from '@/utils/imager'
import { publicTarget } from '@/utils/publicTargetPolicy'
import { NewsletterError, type ParsedNewsletter } from './parser'

const PREFIX = 'newsletter-content/'
@injectable()
export class NewsletterContent {
  constructor(@inject(BucketClient) private bucket: LazyInstance<BucketClient>) {}
  async store(env: Env, ownerUuid: string, id: bigint, parsed: ParsedNewsletter) {
    const doc = new DOMParser().parseFromString(`<html><body>${parsed.html}</body></html>`, 'text/html') as unknown as Document
    await Promise.all(
      Array.from(doc.querySelectorAll('img')).map(async img => {
        try {
          img.setAttribute('src', await buildImageProxyUrl(env, publicTarget(img.getAttribute('src') || '').href, 'https://rss.invalid/', 'rss'))
        } catch {
          img.removeAttribute('src')
        }
        img.removeAttribute('srcset')
      })
    )
    const key = `${PREFIX}${ownerUuid}/${id}/${crypto.randomUUID()}.html`
    const object = await this.bucket().R2Bucket.put(key, doc.documentElement.outerHTML, { httpMetadata: { contentType: 'text/html; charset=utf-8' } })
    if (!object) throw new NewsletterError('unavailable', 503)
    return { key, truncated: parsed.truncated }
  }
  async read(key: string) {
    if (!key.startsWith(PREFIX)) throw new NewsletterError('unavailable', 503)
    const object = await this.bucket().R2Bucket.get(key)
    if (!object) throw new NewsletterError('unavailable', 503)
    return object.text()
  }
  async discard(key: string) {
    if (!key.startsWith(PREFIX)) throw new NewsletterError('unavailable', 503)
    await this.bucket().R2Bucket.delete(key)
  }
  async sweep(ctx: ContextManager, repo: NewsletterRepo) {
    const cursorKey = 'newsletter:content-gc-cursor',
      bucket = this.bucket().R2Bucket
    let cursor = (await ctx.env.KV.get(cursorKey)) || undefined
    for (let i = 0; i < 4; i++) {
      const page = await bucket.list({ prefix: PREFIX, limit: 1000, ...(cursor ? { cursor } : {}) })
      const candidates = page.objects.filter(row => row.uploaded.valueOf() < Date.now() - 24 * 3600_000).map(row => row.key)
      const referenced = new Set(await repo.referencedContent(candidates))
      const garbage = candidates.filter(key => !referenced.has(key))
      if (garbage.length) await bucket.delete(garbage)
      cursor = page.truncated ? page.cursor : undefined
      await ctx.env.KV.put(cursorKey, cursor || '')
      if (!cursor) break
    }
  }
}
