import { parseHTML } from 'linkedom'
import { ErrorName } from '@slax-reader/contracts'
import { forkError } from './bookmarkForkError'

export const SNAPSHOT_PUBLICATION_MS = 5 * 60_000

export function snapshotKeys(uuid: string, _attempt?: string, pdf = false) {
  return pdf
    ? {
        content_key: `pdf/body/${uuid}.pdf`,
        content_md_key: `text/pdf/${uuid}.txt`,
        sidecar: `pdf/meta/${uuid}.json`
      }
    : {
        content_key: `html/body/${uuid}.html`,
        content_md_key: `text/body/${uuid}.txt`
      }
}

const MARKER = 'slax-private-snapshot'
export function readEmbeddedSnapshot(html: string): {
  managed: boolean
  manifest: unknown
} {
  const { document } = parseHTML(html)
  const marker = document.querySelector(`script#${MARKER}[type="application/json"]`)
  return marker ? { managed: true, manifest: JSON.parse(marker.textContent || '') } : { managed: false, manifest: null }
}
export async function loadEmbeddedSnapshot(bucket: R2Bucket, key: string) {
  if (!key.startsWith('html/')) return { managed: false, manifest: null }
  const object = await bucket.get(key)
  if (!object || !('body' in object)) throw forkError()
  const result = readEmbeddedSnapshot(await object.text())
  if (object.customMetadata?.snapshot_owner && !result.managed) throw forkError()
  return result
}
export function snapshotBundleMembers(key: string): string[] | null {
  const html = /^html\/body\/([^/]+)\.html$/.exec(key)
  if (html) return Object.values(snapshotKeys(html[1]))
  const pdf = /^pdf\/body\/([^/]+)\.pdf$/.exec(key)
  return pdf ? Object.values(snapshotKeys(pdf[1], undefined, true)) : null
}

/** Writes one destination using its existing UUID filenames; updates never delete live keys. */
export class SnapshotBundle {
  readonly keys: string[] = []
  readonly sources = new Map<string, string>()
  readonly createdAt = Date.now()
  private bundleKey?: string
  private readonly sourceHtml = new Map<string, string>()
  private html?: string
  private manifest?: string
  private readonly existing = new Set<string>()
  constructor(
    readonly bucket: R2Bucket,
    readonly uuid: string,
    readonly attempt = crypto.randomUUID(),
    readonly options: { deleteNewObjectsOnDiscard?: boolean; beforeWrite?: () => Promise<void> } = {}
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
    if (Date.now() - this.createdAt >= SNAPSHOT_PUBLICATION_MS) throw forkError()
    if (file === 'media.json') {
      JSON.parse(value)
      this.manifest = value
      if (this.html === undefined) throw forkError()
      await this.write('body.html', this.html, 'text/html; charset=utf-8')
      return snapshotKeys(this.uuid).content_key
    }
    const key = file === 'body.html' ? snapshotKeys(this.uuid).content_key : file === 'body.txt' ? snapshotKeys(this.uuid).content_md_key : undefined
    if (!key) throw forkError()
    if (file === 'body.html') {
      const { document } = parseHTML(value)
      document.querySelectorAll(`script#${MARKER}`).forEach(node => node.remove())
      this.html = document.toString()
      if (this.manifest !== undefined) {
        const marker = document.createElement('script')
        marker.id = MARKER
        marker.type = 'application/json'
        marker.textContent = this.manifest.replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')
        ;(document.body || document.documentElement).appendChild(marker)
      }
      value = document.toString()
    }
    await this.put(key, value, { contentType })
    return key
  }

  async put(key: string, value: string | ReadableStream, httpMetadata?: R2HTTPMetadata, metadata: Record<string, string> = {}) {
    const members = Object.values(snapshotKeys(this.uuid, this.attempt, key.startsWith('pdf/') || key.startsWith('text/pdf/')))
    if (!members.includes(key) || Date.now() - this.createdAt >= SNAPSHOT_PUBLICATION_MS) throw forkError()
    if (this.bundleKey && this.bundleKey !== members[0]) throw forkError()
    this.bundleKey = members[0]
    // Record before PUT: a failed acknowledgement may still leave an object.
    if (!this.keys.includes(key)) {
      if (await this.bucket.head(key)) this.existing.add(key)
      this.keys.push(key)
    }
    await this.options.beforeWrite?.()
    const result = await this.bucket.put(key, value, {
      httpMetadata,
      customMetadata: { ...metadata, snapshot_owner: this.uuid, snapshot_attempt: this.attempt, snapshot_created: String(this.createdAt) }
    })
    if (!result) throw forkError(ErrorName.FORK_STORAGE_UNAVAILABLE)
    return result
  }

  async readHtml(source: string) {
    const cached = this.sourceHtml.get(source)
    if (cached !== undefined) return cached
    const html = await (await this.read(source)).text()
    this.sourceHtml.set(source, html)
    return html
  }

  async copyHtml(source: string) {
    const html = await this.readHtml(source)
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
      if (!this.keys.includes(key) && (await this.bucket.head(key))?.etag !== etag) throw forkError()
    }
  }

  async discard() {
    const removable = this.options.deleteNewObjectsOnDiscard ? this.keys.filter(key => !this.existing.has(key)) : []
    if (removable.length) await this.bucket.delete(removable)
  }
}
