import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { VectorMaintenanceService } from '@/domain/vectorMaintenance'
import { VectorEmbeddingClient } from '@/infra/external/vectorEmbedding'
import { VectorSourceRepo } from '@/infra/repository/vectorSources'
import type { VectorArticleRow } from '@/infra/repository/dbVectorMaintenance'
import type { VectorIndexClient } from '@/infra/repository/vectorIndexClient'
import { VECTOR_MODEL, VECTOR_PDF_MAX_BYTES } from '@/utils/vectorEmbedding'
import { hashSHA256 } from '@/utils/strings'
import { pdfFixture } from '../helpers/pdfFixture'
import { memoryPreferenceStates } from '../helpers/preferenceStateMemory'

const unit = (axis = 0) => Array.from({ length: 1024 }, (_, i) => (i === axis ? 1 : 0))

type StoredObject = { bytes: Uint8Array; size?: number; etag?: string }

let objects: Map<string, StoredObject>
let forbiddenGets: Set<string>
let provider: ReturnType<typeof vi.fn>
let pdfVectors: number
let responseBytes: number
let service: VectorMaintenanceService
let index: ReturnType<typeof fakeIndex>
let rows: VectorArticleRow[]
let oss: { head: ReturnType<typeof vi.fn>; get: ReturnType<typeof vi.fn> }

function fakeIndex() {
  const stored = new Map<string, VectorizeVector>()
  return {
    stored,
    get: vi.fn(async (_kind: string, ids: string[]) => ids.flatMap(id => (stored.has(id) ? [stored.get(id)!] : []))),
    upsert: vi.fn(async (_kind: string, vectors: VectorizeVector[]) => {
      for (const vector of vectors) stored.set(vector.id, structuredClone(vector))
      return { mutationId: crypto.randomUUID() }
    }),
    delete: vi.fn(async (_kind: string, ids: string[]) => {
      for (const id of ids) stored.delete(id)
      return { mutationId: crypto.randomUUID() }
    }),
    query: vi.fn(async () => [])
  }
}

function row(overrides: Partial<VectorArticleRow> = {}): VectorArticleRow {
  return {
    id: 1,
    uuid: 'uuid-1',
    title: 'Title 1',
    user_id: 1,
    content_key: 'pdf/body/document.pdf',
    content_md_key: '',
    status: 'success',
    moderation_result: 0,
    updated_at: new Date('2026-11-01T00:00:00Z'),
    published_at: new Date('2026-11-01T00:00:00Z'),
    recommendable: false,
    private_user: 1,
    ...overrides
  } as VectorArticleRow
}

function pdf(pages: number, exactBytes?: number): Uint8Array {
  const fixture = pdfFixture(Array.from({ length: Math.max(1, pages) }, (_, index) => `Page ${index + 1}`))
  if (!exactBytes) return fixture
  const bytes = new Uint8Array(exactBytes).fill(32)
  bytes.set(fixture.subarray(0, Math.min(fixture.length, exactBytes)))
  return bytes
}

function put(key: string, bytes: Uint8Array, extra: Partial<StoredObject> = {}) {
  objects.set(key, { bytes, ...extra })
}

function putText(key: string, text: string) {
  put(key, new TextEncoder().encode(text))
}

function sizeOnly(key: string, size: number, etag = `etag-${size}`) {
  objects.set(key, { bytes: new Uint8Array(0), size, etag })
  forbiddenGets.add(key)
}

function textInputs(calls: unknown[][]) {
  return calls.flatMap(call => JSON.parse((call[1] as RequestInit).body as string).input)
}

beforeEach(() => {
  objects = new Map()
  forbiddenGets = new Set()
  rows = [row()]
  pdfVectors = 1
  responseBytes = 0
  index = fakeIndex()
  provider = vi.fn(async (_url: string, init: RequestInit) => {
    const payload = JSON.parse(init.body as string)
    const count = payload.input.pdf ? pdfVectors : payload.input.length
    return Response.json({ model: VECTOR_MODEL, data: Array.from({ length: count }, (_, i) => ({ index: i, embedding: unit(i % 1024) })) })
  })
  vi.stubGlobal('fetch', provider)
  oss = {
    head: vi.fn(async (key: string) => {
      const object = objects.get(key)
      if (!object) return null
      const bytes = object.bytes
      return {
        size: object.size ?? bytes.byteLength,
        etag: object.etag ?? (await hashSHA256(bytes)),
        httpMetadata: {}
      }
    }),
    get: vi.fn(async (key: string, options?: { range?: { offset: number; length: number } }) => {
      if (forbiddenGets.has(key)) throw new Error(`original_body_read:${key}`)
      const object = objects.get(key)
      if (!object) return null
      const bytes = options?.range ? object.bytes.slice(options.range.offset, options.range.offset + options.range.length) : object.bytes
      return {
        size: bytes.byteLength,
        body: new Response(bytes).body,
        arrayBuffer: async () => bytes.slice().buffer,
        text: async () => new TextDecoder().decode(bytes)
      }
    })
  }
  const env = {
    JINA_API_KEY: 'test',
    PROXY_IMAGE_PREFIX: 'https://reader.invalid/image_proxy',
    OSS: oss
  } as unknown as Env
  const repo = { findArticles: async (identities: { userId: number; id: number }[]) => rows.filter(r => identities.some(i => i.userId === r.user_id && i.id === r.id)) }
  service = new VectorMaintenanceService(repo as never, new VectorSourceRepo(env), new VectorEmbeddingClient(env), index as unknown as VectorIndexClient, memoryPreferenceStates())
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('original PDF at or below the direct threshold', () => {
  test.each([VECTOR_PDF_MAX_BYTES - 1, VECTOR_PDF_MAX_BYTES])('%i-byte original is sent once, byte-identically, without extracted text', async size => {
    pdfVectors = 2
    const original = pdf(2, size)
    expect(original.byteLength).toBe(size)
    put('pdf/body/document.pdf', original)

    const [result] = await service.refreshArticles([{ userId: 1, id: 1 }])

    expect(result).toMatchObject({ state: 'written', vectorIds: ['a:1:1', 'a:1:1:c:0', 'a:1:1:c:1'] })
    expect(provider).toHaveBeenCalledOnce()
    const payload = JSON.parse((provider.mock.calls[0][1] as RequestInit).body as string)
    expect(payload.input).toEqual({ pdf: expect.any(String) })
    expect(Buffer.from(payload.input.pdf, 'base64').equals(Buffer.from(original))).toBe(true)
    expect(index.stored.get('a:1:1')?.metadata?.part_count).toBe(2)
    expect(index.stored.get('a:1:1')?.metadata?.text_key).toBe('')
    expect(oss.get).toHaveBeenCalledWith('pdf/body/document.pdf')
  })

  test('hundreds of provider vectors still use one request with no page cap', async () => {
    pdfVectors = 400
    put('pdf/body/document.pdf', pdf(400))
    provider.mockImplementation(async (_url: string, init: RequestInit) => {
      const payload = JSON.parse(init.body as string)
      expect(payload.input.pdf).toEqual(expect.any(String))
      const body = JSON.stringify({
        model: VECTOR_MODEL,
        data: Array.from({ length: 400 }, (_, i) => ({ index: i, embedding: unit(i), padding: 'x'.repeat(6_000) }))
      })
      responseBytes = Buffer.byteLength(body)
      return new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } })
    })

    const [result] = await service.refreshArticles([{ userId: 1, id: 1 }])

    expect(result.state).toBe('written')
    expect(provider).toHaveBeenCalledOnce()
    expect(responseBytes).toBeGreaterThan(2 * 1024 * 1024)
    expect(index.stored.get('a:1:1')?.metadata?.part_count).toBe(400)
    expect([...index.stored.keys()].filter(id => id.includes(':c:'))).toHaveLength(400)
  })

  test('reuses the previous PDF vectors when fingerprint and source_updated_at are unchanged', async () => {
    pdfVectors = 2
    put('pdf/body/document.pdf', pdf(2))
    expect((await service.refreshArticles([{ userId: 1, id: 1 }]))[0].state).toBe('written')
    const first = structuredClone(index.stored.get('a:1:1')!)
    const firstChunks = [...index.stored.keys()].filter(id => id.includes(':c:')).sort()
    provider.mockClear()
    index.upsert.mockClear()
    const [reused] = await service.refreshArticles([{ userId: 1, id: 1 }])
    expect(reused.state).toBe('written')
    expect(reused.writeToken).toBe(first.metadata!.write_token)
    expect(reused.mutationIds).toEqual([])
    expect(provider).not.toHaveBeenCalled()
    expect(index.upsert).not.toHaveBeenCalled()
    expect(index.stored.get('a:1:1')).toEqual(first)
    expect([...index.stored.keys()].filter(id => id.includes(':c:')).sort()).toEqual(firstChunks)

    rows = [row({ updated_at: new Date('2026-11-02T00:00:00Z') })]
    expect((await service.refreshArticles([{ userId: 1, id: 1 }]))[0].state).toBe('written')
    expect(provider).toHaveBeenCalledOnce()

    provider.mockClear()
    pdfVectors = 3
    put('pdf/body/document.pdf', pdf(3))
    rows = [row()]
    expect((await service.refreshArticles([{ userId: 1, id: 1 }]))[0].state).toBe('written')
    expect(provider).toHaveBeenCalledOnce()
  })
})

describe('accepted PDFs above the direct threshold', () => {
  test.each([VECTOR_PDF_MAX_BYTES + 1, 9 * 1024 * 1024, 50 * 1024 * 1024])('%i-byte original reuses stored extracted text without reading the original body', async size => {
    sizeOnly('pdf/body/document.pdf', size)
    putText('text/pdf/document.txt', 'Extracted text for the accepted large PDF.')
    rows = [row({ content_md_key: 'text/pdf/document.txt' })]
    const [result] = await service.refreshArticles([{ userId: 1, id: 1 }])

    expect(result.state).toBe('written')
    expect(result.reason).toBeUndefined()
    expect(provider).toHaveBeenCalledOnce()
    expect(textInputs(provider.mock.calls)).toEqual([{ text: 'Title 1\n\nExtracted text for the accepted large PDF.' }])
    const payload = JSON.parse((provider.mock.calls[0][1] as RequestInit).body as string)
    expect(payload.input).not.toHaveProperty('pdf')
    expect(oss.get.mock.calls.map(call => call[0])).not.toContain('pdf/body/document.pdf')
    expect(index.stored.get('a:1:1')?.metadata).toMatchObject({ text_key: 'text/pdf/document.txt', part_count: 1 })
    expect(index.stored.get('a:1:1:c:0')).toBeUndefined()
  })

  test('preserves the complete extracted UTF-8 text across storage and model boundaries', async () => {
    sizeOnly('pdf/body/document.pdf', VECTOR_PDF_MAX_BYTES + 1)
    rows = [row({ content_md_key: 'text/pdf/document.txt' })]
    const text = '完整🙂 article content with English.\n'.repeat(36_000)
    expect(new TextEncoder().encode(text).byteLength).toBeGreaterThan(1024 * 1024)
    putText('text/pdf/document.txt', text)

    const [result] = await service.refreshArticles([{ userId: 1, id: 1 }])

    expect(result.state).toBe('written')
    const inputs = textInputs(provider.mock.calls)
    expect(inputs.map(input => input.text).join('')).toBe(`Title 1\n\n${text}`)
    expect(inputs.length).toBeGreaterThan(1)
    expect(inputs[0].text.startsWith('Title 1\n\n')).toBe(true)
    expect(inputs.slice(1).every(input => !input.text.startsWith('Title 1\n\n'))).toBe(true)
    expect(inputs.every(input => !('pdf' in input))).toBe(true)
    expect(index.stored.get('a:1:1')?.metadata?.part_count).toBe(inputs.length)
  })

  test.each([
    ['missing key', '', undefined, 'missing_source_text'],
    ['missing stored text', 'text/pdf/document.txt', undefined, 'missing_source_body'],
    ['empty text', 'text/pdf/document.txt', '', 'missing_source_content'],
    ['whitespace-only text', 'text/pdf/document.txt', ' \n\t ', 'missing_source_content']
  ])('%s fails explicitly without publishing a representative', async (_name, textKey, text, reason) => {
    sizeOnly('pdf/body/document.pdf', VECTOR_PDF_MAX_BYTES + 1)
    rows = [row({ content_md_key: textKey })]
    if (text !== undefined) putText(textKey, text)

    const [result] = await service.refreshArticles([{ userId: 1, id: 1 }])

    expect(result).toMatchObject({ state: 'failed', reason })
    expect(index.upsert).not.toHaveBeenCalled()
    expect(index.stored.size).toBe(0)
    if (!textKey) expect(provider).not.toHaveBeenCalled()
  })

  test('provider failures stay failures for the text fallback', async () => {
    sizeOnly('pdf/body/document.pdf', VECTOR_PDF_MAX_BYTES + 1)
    rows = [row({ content_md_key: 'text/pdf/document.txt' })]
    putText('text/pdf/document.txt', 'Extracted text')
    provider.mockResolvedValueOnce(new Response('unavailable', { status: 503 }))

    const [result] = await service.refreshArticles([{ userId: 1, id: 1 }])

    expect(result).toMatchObject({ state: 'failed', reason: 'embedding_http_503' })
    expect(index.upsert).not.toHaveBeenCalled()
    expect(index.stored.size).toBe(0)
  })
})

describe('stale PDF chunks and owner isolation', () => {
  test('a large fallback refresh removes only the first owner stale chunks', async () => {
    pdfVectors = 3
    rows = [row({ user_id: 1 }), row({ user_id: 2 })]
    put('pdf/body/document.pdf', pdf(3))
    const results = await service.refreshArticles([
      { userId: 1, id: 1 },
      { userId: 2, id: 1 }
    ])
    expect(results.map(result => result.state)).toEqual(['written', 'written'])
    expect(index.stored.get('a:1:1')?.metadata?.part_count).toBe(3)
    expect(index.stored.get('a:2:1')?.metadata?.part_count).toBe(3)

    objects.clear()
    forbiddenGets.clear()
    sizeOnly('pdf/body/document.pdf', VECTOR_PDF_MAX_BYTES + 1)
    putText('text/pdf/document.txt', 'replacement text only')
    rows = [row({ user_id: 1, content_md_key: 'text/pdf/document.txt' }), row({ user_id: 2, content_md_key: 'text/pdf/document.txt' })]
    const [first] = await service.refreshArticles([{ userId: 1, id: 1 }])

    expect(first.state).toBe('written')
    expect(first.removedVectorIds).toEqual(['a:1:1:c:0', 'a:1:1:c:1', 'a:1:1:c:2'])
    expect([...index.stored.keys()].filter(id => id.startsWith('a:1:1'))).toEqual(['a:1:1'])
    expect(index.stored.get('a:1:1')?.metadata).toMatchObject({ part_count: 1, text_key: 'text/pdf/document.txt' })
    expect([...index.stored.keys()].filter(id => id.startsWith('a:2:1')).sort()).toEqual(['a:2:1', 'a:2:1:c:0', 'a:2:1:c:1', 'a:2:1:c:2'])

    rows = [row({ user_id: 2 })]
    const [deleted] = await service.refreshArticles([{ userId: 1, id: 1 }])
    expect(deleted.state).toBe('deleted')
    expect(index.stored.has('a:1:1')).toBe(false)
    expect(index.stored.has('a:2:1')).toBe(true)
  })
})

describe('non-PDF regression', () => {
  test('unchanged HTML text is still reused without another provider request', async () => {
    rows = [row({ content_key: 'html/body/article.html', content_md_key: 'text/article.txt' })]
    put('html/body/article.html', new TextEncoder().encode('<article>Body</article>'))
    putText('text/article.txt', 'Stored article text')

    const [first] = await service.refreshArticles([{ userId: 1, id: 1 }])
    const [second] = await service.refreshArticles([{ userId: 1, id: 1 }])

    expect(first.state).toBe('written')
    expect(second.state).toBe('written')
    expect(provider).toHaveBeenCalledOnce()
    expect(textInputs(provider.mock.calls)).toEqual([{ text: 'Title 1\n\nStored article text' }])
  })
})
