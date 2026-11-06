import { Buffer } from 'node:buffer'
import { isPdfContentKey } from '@slax-reader/contracts/pdf'
import { injectable } from '@/decorators/di'
import { extractImageUrls } from '@/utils/htmlImages'
import { readPdfBody } from '@/utils/pdf'
import { hashSHA256 } from '@/utils/strings'
import { isSafeImageMime } from '@/utils/responseUtils'
import { requestBytes, textInputs, VECTOR_MEDIA_REQUEST_BYTES, VECTOR_PDF_MAX_BYTES, type ModelInput } from '@/utils/vectorEmbedding'
import { imageAttribute as attribute, imageTags, pdfInput, skipImage as skip, type ImageSelection, type VectorSource } from '@/utils/vectorSources'

export type SourceFingerprint = { text_etag: string; html_or_pdf_etag: string; text_key: string; html_or_pdf_key: string }

@injectable()
export class VectorSourceRepo {
  constructor(private readonly env: Env) {}

  async fingerprint(source: VectorSource): Promise<SourceFingerprint> {
    const head = async (key: string) => {
      if (!key) return null
      const object = await this.env.OSS.head(key)
      if (!object) throw new Error('missing_source_body')
      if (!object.etag) throw new Error('missing_source_etag')
      return object
    }
    const original = await head(source.content_key)
    const textKey = isPdfContentKey(source.content_key) && original!.size <= VECTOR_PDF_MAX_BYTES ? '' : source.content_md_key
    return {
      text_etag: (await head(textKey))?.etag || '',
      html_or_pdf_etag: original?.etag || '',
      text_key: textKey,
      html_or_pdf_key: source.content_key
    }
  }

  private async range(key: string, offset: number, length: number): Promise<Uint8Array> {
    const object = await this.env.OSS.get(key, { range: { offset, length } })
    if (!object) throw new Error('missing_source_body')
    const bytes = new Uint8Array(await object.arrayBuffer())
    if (bytes.length !== length) throw new Error('source_range_mismatch')
    return bytes
  }

  private async *storedText(key: string, start: number, end: number): AsyncGenerator<string> {
    if (start === end) return
    if (end - start <= 1024 * 1024) {
      yield new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(await this.range(key, start, end - start))
      return
    }
    let middle = Math.floor((start + end) / 2)
    const boundary = await this.range(key, middle, Math.min(4, end - middle))
    let offset = 0
    while (offset < boundary.length && (boundary[offset] & 0xc0) === 0x80) offset++
    middle += offset
    yield* this.storedText(key, start, middle)
    yield* this.storedText(key, middle, end)
  }

  async *articleInputs(source: VectorSource, selection: ImageSelection = { selected: 0, skipped: {} }): AsyncGenerator<ModelInput> {
    let hasText = false
    if (source.content_md_key) {
      const head = await this.env.OSS.head(source.content_md_key)
      if (!head) throw new Error('missing_source_text')
      let first = true
      for await (const text of this.storedText(source.content_md_key, 0, head.size)) {
        hasText ||= !!text.trim()
        yield* textInputs((first && source.title ? source.title + '\n\n' : '') + text)
        first = false
      }
    }
    if (source.content_key && !isPdfContentKey(source.content_key)) {
      const object = await this.env.OSS.get(source.content_key)
      if (!object) throw new Error('missing_source_html')
      const selected = new Set<string>()
      let candidates = 0
      for await (const tag of imageTags(object.body, selection)) {
        if (selection.selected >= 4 || candidates >= 32) {
          skip(selection, 'selection_budget')
          break
        }
        const width = parseFloat(attribute(tag, 'width'))
        const height = parseFloat(attribute(tag, 'height'))
        const decoration = `${attribute(tag, 'class')} ${attribute(tag, 'id')} ${attribute(tag, 'alt')} ${attribute(tag, 'role')}`
        if ((width > 0 && width <= 96) || (height > 0 && height <= 96) || /\b(icon|logo|avatar|emoji|tracking|spacer|presentation)\b/i.test(decoration)) {
          skip(selection, 'decorative')
          continue
        }
        const raw = extractImageUrls(tag, 1)[0] || attribute(tag, 'src')
        if (!raw || raw.startsWith('data:')) {
          skip(selection, raw.startsWith('data:') ? 'inline' : 'missing_src')
          continue
        }
        candidates++
        let url: URL
        try {
          url = new URL(raw, this.env.PROXY_IMAGE_PREFIX)
        } catch {
          skip(selection, 'invalid_url')
          continue
        }
        let key: string
        if (url.hostname === 'source-assets.reader.invalid') {
          key = url.pathname.slice(1)
          if (!key.startsWith(`private-snapshots/${source.uuid}/images/`) || !/^\d+$/.test(key.slice(`private-snapshots/${source.uuid}/images/`.length))) {
            skip(selection, 'foreign_snapshot')
            continue
          }
        } else {
          const proxy = new URL(this.env.PROXY_IMAGE_PREFIX)
          if (url.origin !== proxy.origin || url.pathname !== proxy.pathname || !url.searchParams.get('u')) {
            skip(selection, 'not_stored')
            continue
          }
          key = `${url.searchParams.get('m') === 'rss' ? 'rss-image' : 'image'}/${await hashSHA256(url.searchParams.get('u')!)}`
        }
        if (selected.has(key)) {
          skip(selection, 'duplicate')
          continue
        }
        const imageHead = await this.env.OSS.head(key)
        if (!imageHead) {
          skip(selection, 'not_stored')
          continue
        }
        const contentType = imageHead.httpMetadata?.contentType || ''
        if (!isSafeImageMime(contentType) || /icon/i.test(contentType)) {
          skip(selection, /icon/i.test(contentType) ? 'decorative' : 'unsupported_format')
          continue
        }
        const prefix: ModelInput = { content: [...(source.title ? [{ text: source.title }] : []), { image: '' }] }
        if (Math.ceil(imageHead.size / 3) * 4 + requestBytes([prefix]) > VECTOR_MEDIA_REQUEST_BYTES) {
          skip(selection, 'request_budget')
          continue
        }
        const image = await this.env.OSS.get(key)
        if (!image) {
          skip(selection, 'not_stored')
          continue
        }
        const encoded = Buffer.from(await image.arrayBuffer()).toString('base64')
        const input: ModelInput = { content: [...(source.title ? [{ text: source.title }] : []), { image: encoded }] }
        if (requestBytes([input]) > VECTOR_MEDIA_REQUEST_BYTES) {
          skip(selection, 'request_budget')
          continue
        }
        selected.add(key)
        selection.selected++
        yield input
      }
    }
    if (!hasText && !selection.selected) throw new Error('missing_source_content')
  }

  async pdfInput(source: VectorSource): Promise<{ base64: string } | null> {
    const head = await this.env.OSS.head(source.content_key)
    if (!head) throw new Error('missing_source_pdf')
    if (head.size > VECTOR_PDF_MAX_BYTES) {
      if (!source.content_md_key) throw new Error('missing_source_text')
      return null
    }
    const object = await this.env.OSS.get(source.content_key)
    if (!object) throw new Error('missing_source_pdf')
    return pdfInput(await readPdfBody(object.body, String(head.size)))
  }
}
