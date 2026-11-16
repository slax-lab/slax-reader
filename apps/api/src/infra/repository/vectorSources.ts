import { Buffer } from 'node:buffer'
import { DOMParser } from 'linkedom'
import { isPdfContentKey } from '@slax-reader/contracts/pdf'
import { injectable } from '@/decorators/di'
import { extractImageUrls } from '@/utils/htmlImages'
import { readPdfBody } from '@/utils/pdf'
import { hashSHA256 } from '@/utils/strings'
import { isSafeImageMime } from '@/utils/responseUtils'
import { requestBytes, textInputs, VECTOR_IMAGE_MAX_BYTES, VECTOR_MEDIA_REQUEST_BYTES, VECTOR_PDF_MAX_BYTES, type ModelInput } from '@/utils/vectorEmbedding'
import { imageAttribute as attribute, imageTags, pdfInput, skipImage as skip, type ImageSelection, type VectorSource } from '@/utils/vectorSources'

export type SourceFingerprint = { text_etag: string; html_or_pdf_etag: string; text_key: string; html_or_pdf_key: string; media_fingerprint: string }

@injectable()
export class VectorSourceRepo {
  constructor(private readonly env: Env) {}

  async fingerprint(source: VectorSource): Promise<SourceFingerprint> {
    const head = async (key: string) => {
      if (!key) return null
      const object = await this.env.OSS.head(key)
      if (object && !object.etag) throw new Error('missing_source_etag')
      return object
    }
    const original = await head(source.content_key)
    const directPdf = isPdfContentKey(source.content_key) && original && original.size <= VECTOR_PDF_MAX_BYTES
    const text = directPdf ? null : await head(source.content_md_key)
    if (!original && !text) throw new Error('missing_source_body')
    const media: unknown[] = ['available-sources-v2']
    if (original && !isPdfContentKey(source.content_key)) {
      for await (const key of this.imageKeys(source, { selected: 0, skipped: {} })) {
        const image = await this.env.OSS.head(key)
        media.push([key, image?.etag ?? '', image?.size ?? -1, image?.httpMetadata?.contentType ?? ''])
      }
    }
    return {
      text_etag: text?.etag || '',
      html_or_pdf_etag: original?.etag || '',
      text_key: text ? source.content_md_key : '',
      html_or_pdf_key: original ? source.content_key : '',
      media_fingerprint: await hashSHA256(JSON.stringify(media))
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

  private async *imageKeys(source: VectorSource, selection: ImageSelection): AsyncGenerator<string> {
    if (!source.content_key || isPdfContentKey(source.content_key)) return
    const object = await this.env.OSS.get(source.content_key)
    if (!object) return
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
      selected.add(key)
      yield key
    }
  }

  async *articleInputs(source: VectorSource, selection: ImageSelection = { selected: 0, skipped: {} }): AsyncGenerator<ModelInput> {
    let hasText = false
    if (source.content_md_key) {
      const head = await this.env.OSS.head(source.content_md_key)
      if (head) {
        let first = true
        for await (const text of this.storedText(source.content_md_key, 0, head.size)) {
          if (!text.trim()) continue
          hasText = true
          yield* textInputs((first && source.title ? source.title + '\n\n' : '') + text)
          first = false
        }
      }
    }
    if (!hasText && source.content_key && !isPdfContentKey(source.content_key)) {
      const object = await this.env.OSS.get(source.content_key)
      if (object) {
        const html = await new Response(object.body).text()
        const document = new DOMParser().parseFromString(`<html><body>${html}</body></html>`, 'text/html')
        for (const node of document.querySelectorAll('script,style,noscript,template')) node.remove()
        const text = (document.querySelector('article') || document.body || document.documentElement).textContent?.trim() || ''
        if (text) {
          hasText = true
          yield* textInputs((source.title ? source.title + '\n\n' : '') + text)
        }
      }
    }
    for await (const key of this.imageKeys(source, selection)) {
      const head = await this.env.OSS.head(key)
      if (!head) {
        skip(selection, 'not_stored')
        continue
      }
      const contentType = head.httpMetadata?.contentType || ''
      if (!isSafeImageMime(contentType) || /icon/i.test(contentType)) {
        skip(selection, /icon/i.test(contentType) ? 'decorative' : 'unsupported_format')
        continue
      }
      if (!head.size) {
        skip(selection, 'empty')
        continue
      }
      if (head.size > VECTOR_IMAGE_MAX_BYTES) {
        skip(selection, 'image_too_large')
        continue
      }
      const prefix: ModelInput = { content: [...(source.title ? [{ text: source.title }] : []), { image: '' }] }
      if (Math.ceil(head.size / 3) * 4 + requestBytes([prefix]) > VECTOR_MEDIA_REQUEST_BYTES) {
        skip(selection, 'request_budget')
        continue
      }
      const image = await this.env.OSS.get(key)
      if (!image) {
        skip(selection, 'not_stored')
        continue
      }
      const bytes = Buffer.from(await image.arrayBuffer())
      if (!bytes.byteLength) {
        skip(selection, 'empty')
        continue
      }
      if (bytes.byteLength > VECTOR_IMAGE_MAX_BYTES) {
        skip(selection, 'image_too_large')
        continue
      }
      const input: ModelInput = { content: [...(source.title ? [{ text: source.title }] : []), { image: bytes.toString('base64') }] }
      if (requestBytes([input]) > VECTOR_MEDIA_REQUEST_BYTES) {
        skip(selection, 'request_budget')
        continue
      }
      selection.selected++
      yield input
    }
    if (!hasText && !selection.selected) throw new Error('missing_source_content')
  }

  async pdfInput(source: VectorSource): Promise<{ base64: string } | null> {
    const head = await this.env.OSS.head(source.content_key)
    if (!head) {
      if (source.content_md_key) return null
      throw new Error('missing_source_pdf')
    }
    if (head.size > VECTOR_PDF_MAX_BYTES) {
      if (!source.content_md_key) throw new Error('missing_source_text')
      return null
    }
    const object = await this.env.OSS.get(source.content_key)
    if (!object) throw new Error('missing_source_pdf')
    return pdfInput(await readPdfBody(object.body, String(head.size)))
  }
}
