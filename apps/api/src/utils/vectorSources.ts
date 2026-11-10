import { Buffer } from 'node:buffer'
import { VECTOR_MEDIA_REQUEST_BYTES, VECTOR_PDF_MAX_BYTES } from './vectorEmbedding'

export interface VectorSource {
  uuid: string
  title: string
  content_key: string
  content_md_key: string
}

export interface ImageSelection {
  selected: number
  skipped: Record<string, number>
}

export function skipImage(selection: ImageSelection, reason: string) {
  selection.skipped[reason] = (selection.skipped[reason] || 0) + 1
}

export async function* imageTags(body: ReadableStream<Uint8Array>, selection: ImageSelection): AsyncGenerator<string> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let pending = ''
  let ignored: 'script' | 'style' | 'comment' | null = null
  let oversized = false
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      for (let offset = 0; offset < value.length; offset += 16 * 1024) {
        pending += decoder.decode(value.subarray(offset, offset + 16 * 1024), { stream: true })
        for (;;) {
          if (ignored) {
            const end = ignored === 'comment' ? /-->/ : new RegExp(`</${ignored}\\s*>`, 'i')
            const match = end.exec(pending)
            if (!match) {
              pending = pending.slice(-16)
              break
            }
            pending = pending.slice(match.index + match[0].length)
            ignored = null
          }
          if (oversized) {
            const end = pending.indexOf('>')
            if (end < 0) {
              pending = ''
              break
            }
            pending = pending.slice(end + 1)
            oversized = false
          }
          const start = /<!--|<(img|script|style)\b/i.exec(pending)
          if (!start) {
            pending = pending.slice(-16)
            break
          }
          pending = pending.slice(start.index)
          if (start[0] === '<!--') {
            ignored = 'comment'
            pending = pending.slice(4)
            continue
          }
          let quote = ''
          let end = -1
          for (let i = start[0].length; i < pending.length; i++) {
            const char = pending[i]
            if (quote) {
              if (char === quote) quote = ''
            } else if (char === '"' || char === "'") quote = char
            else if (char === '>') {
              end = i
              break
            }
          }
          if (end < 0) {
            if (pending.length > 16 * 1024) {
              skipImage(selection, 'oversized_tag')
              oversized = true
              pending = ''
            }
            break
          }
          const tag = pending.slice(0, end + 1)
          pending = pending.slice(end + 1)
          if (start[1].toLowerCase() === 'img') yield tag
          else ignored = start[1].toLowerCase() as 'script' | 'style'
        }
      }
    }
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

export function imageAttribute(tag: string, name: string): string {
  return (
    new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i')
      .exec(tag)
      ?.slice(1)
      .find(value => value !== undefined) || ''
  )
}

export async function pdfInput(bytes: Uint8Array): Promise<{ base64: string }> {
  if (!bytes.byteLength) throw new Error('empty_source_pdf')
  if (bytes.byteLength > VECTOR_PDF_MAX_BYTES) throw new Error('source_pdf_too_large')
  if (Math.ceil(bytes.byteLength / 3) * 4 + 1024 > VECTOR_MEDIA_REQUEST_BYTES) throw new Error('embedding_request_too_large')
  const original = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return { base64: original.toString('base64') }
}
