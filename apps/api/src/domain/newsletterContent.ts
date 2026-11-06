import { NewsletterTiming } from '@/utils/newsletterTiming'
import { DOMParser } from 'linkedom'
import { inject, injectable } from '@/decorators/di'
import type { LazyInstance } from '@/decorators/lazy'
import { BucketClient } from '@/infra/repository/bucketClient'
import { buildImageProxyUrl } from '@/utils/imager'
import { publicTarget } from '@/utils/publicTargetPolicy'
import { NewsletterError, type ParsedNewsletter } from '@/utils/newsletter'

const PREFIX = 'newsletter-content/'
@injectable()
export class NewsletterContent {
  constructor(@inject(BucketClient) private bucket: LazyInstance<BucketClient>) {}
  async store(env: Env, ownerUuid: string, id: bigint, parsed: ParsedNewsletter, timing = new NewsletterTiming(0)) {
    const doc = new DOMParser().parseFromString(`<html><body>${parsed.html}</body></html>`, 'text/html') as unknown as Document
    await timing.measure('images', () =>
      Promise.all(
        Array.from(doc.querySelectorAll('img')).map(async img => {
          if ((img.getAttribute('src') || '').startsWith('data:image/')) return
          try {
            img.setAttribute('src', await buildImageProxyUrl(env, publicTarget(img.getAttribute('src') || '').href, 'https://rss.invalid/', 'rss'))
          } catch {
            img.removeAttribute('src')
          }
          img.removeAttribute('srcset')
        })
      )
    )
    const key = `${PREFIX}${ownerUuid}/${id}/${crypto.randomUUID()}.html`
    const object = await timing.measure('store', () =>
      this.bucket().R2Bucket.put(key, doc.documentElement.outerHTML, { httpMetadata: { contentType: 'text/html; charset=utf-8' } })
    )
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
}
