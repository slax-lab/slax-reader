import mailsplit, { type MimeNode, type SplitterChunk, type Headers } from '@zone-eu/mailsplit'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import type { Transform, Writable } from 'node:stream'
import { finished } from 'node:stream/promises'
import type { NewsletterErrorCode } from '@slax-reader/contracts'

const BLOCK = 64 * 1024
export const NEWSLETTER_LIMITS = {
  inboundBytes: 25 * 1024 * 1024,
  htmlBytes: 2 * 1024 * 1024,
  plainBytes: 2 * 1024 * 1024,
  cidBytes: 5 * 1024 * 1024,
  embeddedCharacters: 5 * 1024 * 1024,
  structureBytes: 64 * 1024,
  headerBytes: 64 * 1024,
  parts: 200,
  depth: 32,
  bodyCharacters: 512 * 1024,
  sources: 200,
  daily: 200
} as const

export class NewsletterError extends Error {
  constructor(
    public code: NewsletterErrorCode,
    public status = 400
  ) {
    super(code)
  }
}

export interface NewsletterMimeInput {
  mime: Uint8Array
  attachments: { filename: string; mimeType: string; size: number; contentId: string }[]
  rawHash: string
  truncated: boolean
  omittedCids: Set<string>
}
export interface NewsletterMessageInput {
  rawSize: number
  raw: ReadableStream<Uint8Array>
}

/** Fixed-size copied blocks bound object count as well as bytes for tiny input chunks. */
class RetainedBytes {
  private blocks: Buffer[] = []
  private offset = 0
  length = 0
  constructor(private limit: number) {}
  append(value: Uint8Array) {
    const length = Math.min(value.byteLength, this.limit - this.length)
    let position = 0
    while (position < length) {
      let tail = this.blocks[this.blocks.length - 1]
      if (!tail || this.offset === tail.length) {
        tail = Buffer.allocUnsafe(Math.min(BLOCK, this.limit - this.length))
        this.blocks.push(tail)
        this.offset = 0
      }
      const count = Math.min(length - position, tail.length - this.offset)
      tail.set(value.subarray(position, position + count), this.offset)
      this.offset += count
      this.length += count
      position += count
    }
    return length
  }
  take() {
    const result = Buffer.concat(
      this.blocks.map((block, i) => (i === this.blocks.length - 1 ? block.subarray(0, this.offset) : block)),
      this.length
    )
    this.clear()
    return result
  }
  clear() {
    this.blocks = []
    this.offset = 0
    this.length = 0
  }
}

const write = (stream: Writable, value: unknown) =>
  new Promise<void>((resolve, reject) => {
    const close = () => done(new Error('MIME stream closed during write'))
    const done = (error?: Error | null) => {
      stream.off('close', close)
      error ? reject(error) : resolve()
    }
    stream.once('close', close)
    stream.write(value, done)
  })
async function end(stream: Transform) {
  const completion = finished(stream, { cleanup: true })
  stream.end()
  await completion
}

interface Leaf {
  node: MimeNode
  decoder: Transform
  kind: 'html' | 'plain' | 'cid' | 'attachment'
  cid: string
  size: number
  keep: RetainedBytes
  omitted: boolean
  error?: Error
}

export async function readNewsletterMime(message: NewsletterMessageInput): Promise<NewsletterMimeInput> {
  if (!Number.isInteger(message.rawSize) || message.rawSize <= 0 || message.rawSize > NEWSLETTER_LIMITS.inboundBytes) throw new NewsletterError('invalid_message', 413)
  // The library's declarations narrow inherited event overloads; both implementations are Node Transforms.
  const splitter = new mailsplit.Splitter({ ignoreEmbedded: true, maxHeadSize: NEWSLETTER_LIMITS.headerBytes, maxChildNodes: NEWSLETTER_LIMITS.parts }) as unknown as Transform
  const joiner = new mailsplit.Joiner() as unknown as Transform
  const payloadBudget = NEWSLETTER_LIMITS.htmlBytes + NEWSLETTER_LIMITS.plainBytes + NEWSLETTER_LIMITS.cidBytes
  const encodedBudget = Math.ceil((payloadBudget * 4) / 3)
  const output = new RetainedBytes(
    encodedBudget + Math.ceil(encodedBudget / 76) * 2 + NEWSLETTER_LIMITS.headerBytes + NEWSLETTER_LIMITS.structureBytes + NEWSLETTER_LIMITS.parts * 128
  )
  const result: NewsletterMimeInput = { mime: new Uint8Array(), attachments: [], rawHash: '', truncated: false, omittedCids: new Set() }
  const seenCids = new Set<string>()
  const retained = { html: 0, plain: 0, cid: 0 }
  let leaf: Leaf | undefined
  let headers = 0,
    structure = 0,
    inputBytes = 0
  let outputError: Error | undefined
  const hash = createHash('sha256').update('raw:')
  joiner.on('error', error => {
    outputError = error
  })
  joiner.on('data', (value: Buffer) => {
    if (output.append(value) !== value.length) joiner.destroy(new NewsletterError('invalid_message', 413))
  })

  const finishLeaf = async () => {
    if (!leaf) return
    const current = leaf
    leaf = undefined
    await end(current.decoder)
    if (current.error) throw new NewsletterError('invalid_message')
    const { node, kind, cid, size } = current
    let content = current.keep.take()
    if (kind === 'cid') {
      if (current.omitted) {
        result.omittedCids.add(cid)
        content = Buffer.alloc(0)
      } else retained.cid += content.length
    } else if (kind === 'html' || kind === 'plain') {
      retained[kind] += content.length
      if (content.length < size) result.truncated = true
    }
    if (kind === 'cid' || kind === 'attachment')
      result.attachments.push({ filename: node.filename || 'Unnamed attachment', mimeType: node.contentType || 'application/octet-stream', size, contentId: cid })
    const encoder = node.getEncoder('base64') as Transform
    encoder.on('error', () => {})
    encoder.on('data', (value: Buffer) => {
      joiner.write({ type: 'body', value })
    })
    await write(joiner, node)
    if (content.length) await write(encoder, content)
    await end(encoder)
    // The splitter removes the line break belonging to the next delimiter.
    await write(joiner, Buffer.from('\r\n'))
    if (outputError) throw outputError
  }

  const reader = message.raw.getReader()
  const pumping = (async () => {
    try {
      for (;;) {
        let next: ReadableStreamReadResult<Uint8Array>
        try {
          next = await reader.read()
        } catch {
          throw new NewsletterError('unavailable', 503)
        }
        if (next.done) break
        inputBytes += next.value.byteLength
        if (inputBytes > NEWSLETTER_LIMITS.inboundBytes) throw new NewsletterError('invalid_message', 413)
        hash.update(next.value)
        for (let position = 0; position < next.value.length; position += BLOCK) {
          try {
            await write(splitter, next.value.subarray(position, position + BLOCK))
          } catch (error) {
            throw error instanceof NewsletterError ? error : new NewsletterError('invalid_message')
          }
        }
      }
      if (inputBytes !== message.rawSize) throw new NewsletterError('unavailable', 503)
      splitter.end()
    } catch (error) {
      splitter.destroy(error as Error)
      throw error
    }
  })()
  // Both sides are awaited below; attach a handler while the consumer is still draining.
  void pumping.catch(() => {})
  try {
    for await (const value of splitter) {
      const part = value as SplitterChunk
      if (part.type === 'body') {
        if (!leaf) throw new NewsletterError('invalid_message')
        await write(leaf.decoder, part.value)
        if (leaf.error) throw new NewsletterError('invalid_message')
        continue
      }
      await finishLeaf()
      if (part.type === 'data') {
        structure += part.value.length
        if (structure > NEWSLETTER_LIMITS.structureBytes) throw new NewsletterError('invalid_message', 413)
        await write(joiner, part)
        continue
      }
      if (part.type !== 'node') continue
      const node = part as MimeNode
      headers += node.getHeaders().length
      let depth = 0
      for (let parent = node.parentNode; parent; parent = parent.parentNode) depth++
      if (headers > NEWSLETTER_LIMITS.headerBytes || depth >= NEWSLETTER_LIMITS.depth) throw new NewsletterError('invalid_message', 413)
      if (node.multipart) {
        await write(joiner, node)
        continue
      }
      const cid = (node.headers as Headers).getFirst('Content-ID').trim().replace(/^<|>$/g, '')
      const firstCid = !!cid && !seenCids.has(cid)
      if (cid) seenCids.add(cid)
      const body = node.disposition !== 'attachment' && !node.filename && ['text/html', 'text/plain'].includes(node.contentType || '')
      const kind: Leaf['kind'] = body
        ? node.contentType === 'text/html'
          ? 'html'
          : 'plain'
        : firstCid && /^image\/(png|jpeg|gif|webp|avif)$/i.test(node.contentType || '')
          ? 'cid'
          : 'attachment'
      if (firstCid && kind !== 'cid') result.omittedCids.add(cid)
      const budget =
        kind === 'html'
          ? NEWSLETTER_LIMITS.htmlBytes - retained.html
          : kind === 'plain'
            ? NEWSLETTER_LIMITS.plainBytes - retained.plain
            : kind === 'cid'
              ? NEWSLETTER_LIMITS.cidBytes - retained.cid
              : 0
      const current: Leaf = { node, decoder: node.getDecoder() as Transform, kind, cid, size: 0, keep: new RetainedBytes(budget), omitted: false }
      current.decoder.on('error', error => {
        current.error = error
      })
      current.decoder.on('data', (chunk: Buffer) => {
        current.size += chunk.length
        if (!current.omitted) {
          const kept = current.keep.append(chunk)
          if (kind === 'cid' && kept < chunk.length) {
            current.omitted = true
            current.keep.clear()
          }
        }
      })
      leaf = current
    }
    await pumping
    await finishLeaf()
    await end(joiner)
    result.mime = output.take()
    result.rawHash = hash.digest('hex')
    return result
  } catch (error) {
    splitter.destroy()
    leaf?.decoder.destroy()
    joiner.destroy()
    await reader.cancel().catch(() => {})
    await pumping.catch(() => {})
    if (error instanceof Error && 'code' in error && error.code === 'EMAXLEN') throw new NewsletterError('invalid_message', 413)
    throw error
  } finally {
    reader.releaseLock()
  }
}
