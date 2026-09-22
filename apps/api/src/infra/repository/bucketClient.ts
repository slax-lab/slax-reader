import { injectable } from '@/decorators/di'
import { hashSHA256 } from '@/utils/strings'
import { publicFetch } from '@/utils/publicFetch'
import { publicTarget } from '@/utils/publicTargetPolicy'
import { isSafeImageMime } from '@/utils/responseUtils'

@injectable()
export class BucketClient {
  public R2Bucket: globalThis.R2Bucket

  constructor(private env: Env) {
    this.R2Bucket = env.OSS
  }

  public async putIfKeyExists(key?: string, val?: any): Promise<R2Object | null> {
    if (!key || !val) return null
    return this.R2Bucket.put(key, val)
  }

  public async putRemoteIfKeyExists(url: string, path: string, key?: string): Promise<R2Object | null> {
    if (this.env.RUN_ENV !== 'prod' || !url) return null
    publicTarget(url)
    if (!key) key = await hashSHA256(url)
    const resp = await publicFetch(url, {}, { maxBytes: 5 * 1024 * 1024 })
    const imageMime = resp.headers.get('Content-Type') || ''
    if (!resp.ok || !isSafeImageMime(imageMime)) {
      await resp.body?.cancel()
      return null
    }
    const bytes = await resp.arrayBuffer()
    return this.R2Bucket.put(`${path}/${key}`, bytes, {
      httpMetadata: { contentType: imageMime }
    })
  }

  public deleteIfKeyExists(key: string): Promise<void> {
    if (!key) return Promise.resolve()
    return this.R2Bucket.delete(key)
  }

  public getIfKeyExists(key: string): Promise<R2Object | null> {
    if (!key) return Promise.resolve(null)
    return this.R2Bucket.get(key)
  }
}
