import { describe, expect, test, vi } from 'vitest'
import { pdfInput, type ImageSelection } from '@/utils/vectorSources'
import { VectorSourceRepo } from '@/infra/repository/vectorSources'
import { hashSHA256 } from '@/utils/strings'
import { VECTOR_IMAGE_MAX_BYTES, VECTOR_MEDIA_REQUEST_BYTES, VECTOR_PDF_MAX_BYTES } from '@/utils/vectorEmbedding'
import { pdfFixture } from '../helpers/pdfFixture'

const uuid = '12345678-1234-1234-1234-123456789012'
const source = { uuid, title: 'Title', content_key: 'html/article', content_md_key: 'text/article' }

function fixture(html: string, entries: Map<string, { bytes: Uint8Array; contentType: string }>, chunkSize = 7) {
  const text = new TextEncoder().encode('complete article')
  const wholeHtmlRead = vi.fn(() => {
    throw new Error('whole_html_read')
  })
  const env = {
    PROXY_IMAGE_PREFIX: 'https://reader.invalid/image_proxy',
    OSS: {
      head: vi.fn(async (key: string) => {
        if (key === source.content_md_key) return { size: text.length }
        const image = entries.get(key)
        return image ? { size: image.bytes.length, httpMetadata: { contentType: image.contentType } } : null
      }),
      get: vi.fn(async (key: string) => {
        if (key === source.content_md_key) return { arrayBuffer: async () => text.buffer }
        if (key === source.content_key) {
          const bytes = new TextEncoder().encode(html)
          let position = 0
          return {
            text: wholeHtmlRead,
            arrayBuffer: wholeHtmlRead,
            body: new ReadableStream({
              pull(controller) {
                if (position >= bytes.length) {
                  controller.close()
                  return
                }
                controller.enqueue(bytes.subarray(position, position + chunkSize))
                position += chunkSize
              }
            })
          }
        }
        const image = entries.get(key)
        return image ? { arrayBuffer: async () => image.bytes.buffer } : null
      })
    }
  } as unknown as Env
  return { env, wholeHtmlRead }
}

describe('bounded source image selection', () => {
  test('streams split tags and ignores script/comment fake images, icons and inline data', async () => {
    const key = `private-snapshots/${uuid}/images/0`
    const html =
      '<script>var x=\'<img src="https://bad.invalid/fake">\';</script>' +
      '<!-- <img src="https://bad.invalid/fake"> -->' +
      '<img width="16" src="https://bad.invalid/icon"><img src="data:image/png;base64,abc">' +
      `<IMG width="640" height="480" alt="A > B diagram" src="https://source-assets.reader.invalid/${key}">`
    const { env, wholeHtmlRead } = fixture(html, new Map([[key, { bytes: new Uint8Array([1, 2, 3]), contentType: 'image/png' }]]))
    const selection: ImageSelection = { selected: 0, skipped: {} }
    const inputs = []
    for await (const input of new VectorSourceRepo(env).articleInputs(source, selection)) inputs.push(input)
    expect(inputs).toHaveLength(2)
    expect(selection).toEqual({ selected: 1, skipped: { decorative: 1, inline: 1 } })
    expect(wholeHtmlRead).not.toHaveBeenCalled()
  })

  test('deduplicates only selected keys, chooses at most four images and bounds lookup candidates', async () => {
    const entries = new Map<string, { bytes: Uint8Array; contentType: string }>()
    let html = ''
    for (let i = 0; i < 10; i++) {
      const key = `private-snapshots/${uuid}/images/${i}`
      entries.set(key, { bytes: new Uint8Array([1, 2, 3]), contentType: 'image/png' })
      html += `<img width="640" src="https://source-assets.reader.invalid/${key}">`.repeat(2)
    }
    const { env } = fixture(html, entries, 19)
    const selection: ImageSelection = { selected: 0, skipped: {} }
    const inputs = []
    for await (const input of new VectorSourceRepo(env).articleInputs(source, selection)) inputs.push(input)
    expect(selection.selected).toBe(4)
    expect(selection.skipped.duplicate).toBe(3)
    expect(selection.skipped.selection_budget).toBe(1)
    expect(inputs).toHaveLength(5)
    expect((env.OSS.head as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(5)
  })

  test('uses existing proxy-cache material above 512KiB without fetching original source', async () => {
    const encoded = encodeURIComponent('https://publisher.invalid/photo.jpg')
    const key = `image/${await hashSHA256(encoded)}`
    const url = new URL('https://reader.invalid/image_proxy')
    url.searchParams.set('u', encoded)
    const { env } = fixture(`<img width="1200" height="800" src="${url.href}">`, new Map([[key, { bytes: new Uint8Array(1024 * 1024), contentType: 'image/jpeg' }]]))
    const inputs = []
    for await (const input of new VectorSourceRepo(env).articleInputs(source)) inputs.push(input)
    expect(inputs).toHaveLength(2)
    expect(env.OSS.get).toHaveBeenCalledWith(key)
    expect((inputs[1] as { content: { image?: string }[] }).content[1].image!.length).toBe(Math.ceil((1024 * 1024) / 3) * 4)
  })

  test('retains the independent request-byte budget for eligible image bytes', async () => {
    const key = `private-snapshots/${uuid}/images/0`
    const { env } = fixture(`<img src="https://source-assets.reader.invalid/${key}">`, new Map([[key, { bytes: new Uint8Array([1]), contentType: 'image/png' }]]))
    const selection: ImageSelection = { selected: 0, skipped: {} }
    const inputs = new VectorSourceRepo(env).articleInputs({ ...source, content_md_key: '', title: 'x'.repeat(VECTOR_MEDIA_REQUEST_BYTES) }, selection)
    await expect(inputs.next()).rejects.toThrow('missing_source_content')
    expect(selection).toEqual({ selected: 0, skipped: { request_budget: 1 } })
    expect(env.OSS.get).not.toHaveBeenCalledWith(key)
  })
})

describe('oversized source images', () => {
  test.each([true, false])('skips oversized images and preserves text and four valid-image slots with accurate metadata %s', async accurateMetadata => {
    const entries = new Map<string, { bytes: Uint8Array; contentType: string }>()
    const oversizedKeys: string[] = []
    const oversized = new Uint8Array(VECTOR_IMAGE_MAX_BYTES + 1)
    let html = ''
    for (let i = 0; i < 8; i++) {
      const key = `private-snapshots/${uuid}/images/${i}`
      entries.set(key, { bytes: i < 4 ? oversized : new Uint8Array([1, 2, 3]), contentType: 'image/png' })
      if (i < 4) oversizedKeys.push(key)
      html += `<img src="https://source-assets.reader.invalid/${key}">`
    }
    const { env } = fixture(html, entries)
    if (!accurateMetadata) {
      const head = vi.mocked(env.OSS.head)
      const original = head.getMockImplementation()!
      head.mockImplementation(async key => (oversizedKeys.includes(key) ? ({ size: 16, httpMetadata: { contentType: 'image/png' } } as R2Object) : original(key)))
    }
    const selection: ImageSelection = { selected: 0, skipped: {} }
    const inputs = []
    for await (const input of new VectorSourceRepo(env).articleInputs(source, selection)) inputs.push(input)
    expect(inputs).toEqual([{ text: 'Title\n\ncomplete article' }, ...Array.from({ length: 4 }, () => ({ content: [{ text: 'Title' }, { image: 'AQID' }] }))])
    expect(selection).toEqual({ selected: 4, skipped: { image_too_large: 4 } })
    for (const key of oversizedKeys) {
      if (accurateMetadata) expect(env.OSS.get).not.toHaveBeenCalledWith(key)
      else expect(env.OSS.get).toHaveBeenCalledWith(key)
    }
  })

  test.each([VECTOR_IMAGE_MAX_BYTES - 1, VECTOR_IMAGE_MAX_BYTES])('allows an otherwise eligible image with %i raw bytes', async size => {
    const key = `private-snapshots/${uuid}/images/0`
    const { env } = fixture(`<img src="https://source-assets.reader.invalid/${key}">`, new Map([[key, { bytes: new Uint8Array(size), contentType: 'image/png' }]]))
    const selection: ImageSelection = { selected: 0, skipped: {} }
    const inputs = []
    for await (const input of new VectorSourceRepo(env).articleInputs(source, selection)) inputs.push(input)
    expect(inputs).toHaveLength(2)
    expect((inputs[1] as { content: { image?: string }[] }).content[1].image!.length).toBe(Math.ceil(size / 3) * 4)
    expect(selection).toEqual({ selected: 1, skipped: {} })
  })

  test.each([true, false])('retains missing_source_content for oversized-only images with accurate metadata %s', async accurateMetadata => {
    const key = `private-snapshots/${uuid}/images/0`
    const { env } = fixture(
      `<img src="https://source-assets.reader.invalid/${key}">`,
      new Map([[key, { bytes: new Uint8Array(VECTOR_IMAGE_MAX_BYTES + 1), contentType: 'image/png' }]])
    )
    if (!accurateMetadata) vi.mocked(env.OSS.head).mockResolvedValue({ size: 16, httpMetadata: { contentType: 'image/png' } } as R2Object)
    const selection: ImageSelection = { selected: 0, skipped: {} }
    const inputs = new VectorSourceRepo(env).articleInputs({ ...source, content_md_key: '' }, selection)
    await expect(inputs.next()).rejects.toThrow('missing_source_content')
    expect(selection).toEqual({ selected: 0, skipped: { image_too_large: 1 } })
  })
})

describe('empty source images', () => {
  test.each([0, 16])('skips empty images with reported size %i without consuming valid-image slots', async reportedSize => {
    const entries = new Map<string, { bytes: Uint8Array; contentType: string }>()
    const emptyKeys: string[] = []
    let html = ''
    for (let i = 0; i < 8; i++) {
      const key = `private-snapshots/${uuid}/images/${i}`
      entries.set(key, { bytes: i < 4 ? new Uint8Array() : new Uint8Array([1, 2, 3]), contentType: 'image/png' })
      if (i < 4) emptyKeys.push(key)
      html += `<img src="https://source-assets.reader.invalid/${key}">`
    }
    const { env } = fixture(html, entries)
    const head = vi.mocked(env.OSS.head)
    const original = head.getMockImplementation()!
    head.mockImplementation(async key => (emptyKeys.includes(key) ? ({ size: reportedSize, httpMetadata: { contentType: 'image/png' } } as R2Object) : original(key)))
    const selection: ImageSelection = { selected: 0, skipped: {} }
    const inputs = []
    for await (const input of new VectorSourceRepo(env).articleInputs(source, selection)) inputs.push(input)
    expect(inputs).toEqual([{ text: 'Title\n\ncomplete article' }, ...Array.from({ length: 4 }, () => ({ content: [{ text: 'Title' }, { image: 'AQID' }] }))])
    expect(selection).toEqual({ selected: 4, skipped: { empty: 4 } })
    for (const key of emptyKeys) {
      if (reportedSize === 0) expect(env.OSS.get).not.toHaveBeenCalledWith(key)
      else expect(env.OSS.get).toHaveBeenCalledWith(key)
    }
  })

  test.each([0, 16])('retains missing_source_content for image-only empty bytes with reported size %i', async reportedSize => {
    const key = `private-snapshots/${uuid}/images/0`
    const { env } = fixture(`<img src="https://source-assets.reader.invalid/${key}">`, new Map([[key, { bytes: new Uint8Array(), contentType: 'image/png' }]]))
    vi.mocked(env.OSS.head).mockResolvedValue({ size: reportedSize, httpMetadata: { contentType: 'image/png' } } as R2Object)
    const selection: ImageSelection = { selected: 0, skipped: {} }
    const inputs = new VectorSourceRepo(env).articleInputs({ ...source, content_md_key: '' }, selection)
    await expect(inputs.next()).rejects.toThrow('missing_source_content')
    expect(selection).toEqual({ selected: 0, skipped: { empty: 1 } })
  })
})

describe('pdf input preparation', () => {
  test('returns the exact original base64 without parsing PDF structure', async () => {
    const fixture = pdfFixture(['Page one', 'Page two'])
    expect(await pdfInput(fixture)).toEqual({ base64: Buffer.from(fixture).toString('base64') })
    const unsupported = new TextEncoder().encode('%PDF-1.7\nno xref, pages or parseable structure')
    expect(await pdfInput(unsupported)).toEqual({ base64: Buffer.from(unsupported).toString('base64') })
  })

  test('preserves the byte bound and rejects empty bytes', async () => {
    await expect(pdfInput(new Uint8Array())).rejects.toThrow()
    await expect(pdfInput(new Uint8Array(VECTOR_PDF_MAX_BYTES + 1))).rejects.toThrow('source_pdf_too_large')
    const largest = new Uint8Array(VECTOR_PDF_MAX_BYTES)
    const prepared = await pdfInput(largest)
    expect(Buffer.from(prepared.base64, 'base64').equals(Buffer.from(largest))).toBe(true)
  })
})

describe('independent available sources', () => {
  test('keeps available Markdown when the original HTML is missing', async () => {
    const { env } = fixture('', new Map())
    const original = vi.mocked(env.OSS.get).getMockImplementation()!
    vi.mocked(env.OSS.get).mockImplementation(async (key, ...args) => (key === source.content_key ? null : original(key, ...args)))
    const inputs = []
    for await (const input of new VectorSourceRepo(env).articleInputs(source)) inputs.push(input)
    expect(inputs).toEqual([{ text: 'Title\n\ncomplete article' }])
  })

  test('extracts available HTML text when Markdown is absent', async () => {
    const { env } = fixture('<article><p>Stored text</p><script>ignore me</script></article>', new Map())
    const original = vi.mocked(env.OSS.head).getMockImplementation()!
    vi.mocked(env.OSS.head).mockImplementation(async key => (key === source.content_md_key ? null : original(key)))
    const inputs = []
    for await (const input of new VectorSourceRepo(env).articleInputs(source)) inputs.push(input)
    expect(inputs).toEqual([{ text: 'Title\n\nStored text' }])
  })

  test('restoring an image changes reuse fingerprint without changing HTML or Markdown', async () => {
    const key = `private-snapshots/${uuid}/images/0`
    let available = false
    const env = {
      PROXY_IMAGE_PREFIX: 'https://reader.invalid/image_proxy',
      OSS: {
        head: async (id: string) => (id === key ? (available ? { etag: 'image-v1', size: 3, httpMetadata: { contentType: 'image/png' } } : null) : { etag: id, size: 10 }),
        get: async () => ({ body: new Response(`<img src="https://source-assets.reader.invalid/${key}">`).body })
      }
    } as unknown as Env
    const repo = new VectorSourceRepo(env)
    const before = await repo.fingerprint(source)
    available = true
    const after = await repo.fingerprint(source)
    expect(after.media_fingerprint).not.toBe(before.media_fingerprint)
    expect(after.text_etag).toBe(before.text_etag)
    expect(after.html_or_pdf_etag).toBe(before.html_or_pdf_etag)
  })
})
