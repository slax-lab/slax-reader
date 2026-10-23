import { parseHTML } from 'linkedom'
import { ErrorName } from '@slax-reader/contracts'
import { forkError } from './bookmarkForkError'

export const SNAPSHOT_PUBLICATION_MS = 5 * 60_000
export const SNAPSHOT_CLEANUP_GRACE_MS = 24 * 60 * 60_000

export function snapshotKeys(uuid: string, attempt: string, pdf = false) {
  return pdf
    ? { content_key: `pdf/body/forks/${uuid}/${attempt}.pdf`, content_md_key: `text/pdf/forks/${uuid}/${attempt}.txt`, sidecar: `pdf/meta/forks/${uuid}/${attempt}.json` }
    : { content_key: `snapshots/${uuid}/${attempt}/body.html`, content_md_key: `snapshots/${uuid}/${attempt}/body.txt`, sidecar: `snapshots/${uuid}/${attempt}/media.json` }
}

export function isManagedSnapshot(key: string) {
  return key.startsWith('snapshots/')
}
export function mediaSnapshotKey(key: string) {
  return key.replace(/\/body\.html$/, '/media.json')
}

export function snapshotBundleMembers(key: string): string[] | null {
  const html = /^snapshots\/([^/]+)\/([^/]+)\/(?:body\.html|body\.txt|media\.json)$/.exec(key)
  if (html) return Object.values(snapshotKeys(html[1], html[2]))
  const pdf = /^(?:pdf\/(?:body|meta)|text\/pdf)\/forks\/([^/]+)\/([^/]+)\.(?:pdf|json|txt)$/.exec(key)
  return pdf ? Object.values(snapshotKeys(pdf[1], pdf[2], true)) : null
}

/** One publication owns its immutable objects; callers decide when rollback is certain. */
export class SnapshotBundle {
  readonly keys: string[] = []
  readonly sources = new Map<string, string>()
  readonly createdAt = Date.now()
  private registration?: Promise<unknown>
  private bundleKey?: string
  constructor(
    readonly bucket: R2Bucket,
    readonly uuid: string,
    private register: (bundleKey: string) => Promise<unknown>,
    readonly attempt = crypto.randomUUID()
  ) {}

  async read(key: string): Promise<R2ObjectBody> {
    const head = key ? await this.bucket.head(key) : null
    if (!head) throw forkError()
    const object = await this.bucket.get(key, { onlyIf: { etagMatches: head.etag } })
    if (!object || !('body' in object)) throw forkError()
    if (this.sources.has(key) && this.sources.get(key) !== object.etag) throw forkError()
    this.sources.set(key, object.etag)
    return object
  }

  async copy(source: string, target: string): Promise<R2Object> {
    const object = await this.read(source)
    const metadata: Record<string, string> = {}
    for (const key of ['filename', 'sha256', 'source']) {
      if (object.customMetadata?.[key]) metadata[key] = object.customMetadata[key]
    }
    return this.put(target, object.body, object.httpMetadata, metadata)
  }

  async write(file: string, value: string, contentType: string) {
    const key = `snapshots/${this.uuid}/${this.attempt}/${file}`
    await this.put(key, value, { contentType })
    return key
  }

  async put(key: string, value: string | ReadableStream, httpMetadata?: R2HTTPMetadata, metadata: Record<string, string> = {}) {
    const members = Object.values(snapshotKeys(this.uuid, this.attempt, key.startsWith('pdf/') || key.startsWith('text/pdf/')))
    if (!members.includes(key) || Date.now() - this.createdAt >= SNAPSHOT_PUBLICATION_MS) throw forkError()
    if (this.bundleKey && this.bundleKey !== members[0]) throw forkError()
    this.bundleKey = members[0]
    // Persist the whole deterministic bundle before any PUT, including ambiguous writes.
    this.registration ??= this.register(members[0])
    await this.registration
    if (Date.now() - this.createdAt >= SNAPSHOT_PUBLICATION_MS) throw forkError()
    // Record before PUT: a failed acknowledgement may still leave an object.
    this.keys.push(key)
    const result = await this.bucket.put(key, value, {
      onlyIf: { etagDoesNotMatch: '*' },
      httpMetadata,
      customMetadata: { ...metadata, snapshot_owner: this.uuid, snapshot_attempt: this.attempt, snapshot_created: String(this.createdAt) }
    })
    if (!result) throw forkError(ErrorName.FORK_STORAGE_UNAVAILABLE)
    return result
  }

  async copyHtml(source: string) {
    const object = await this.read(source)
    const html = await object.text()
    const { document } = parseHTML(html)
    document.querySelectorAll('script,style,noscript').forEach(node => node.remove())
    const text = (document.querySelector('article') || document.body || document.documentElement).textContent?.trim() || ''
    const content_key = await this.write('body.html', html, 'text/html; charset=utf-8')
    const content_md_key = await this.write('body.txt', text, 'text/plain; charset=utf-8')
    return { content_key, content_md_key, content_word_count: text.length }
  }

  async assertUnchanged() {
    if (Date.now() - this.createdAt >= SNAPSHOT_PUBLICATION_MS) throw forkError()
    for (const [key, etag] of this.sources) {
      if ((await this.bucket.head(key))?.etag !== etag) throw forkError()
    }
  }

  async discard() {
    if (this.keys.length) await this.bucket.delete(this.keys)
  }
}
