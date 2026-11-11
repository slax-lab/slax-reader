import { afterEach, describe, expect, test, vi } from 'vitest'
import { ArticleVectorAccumulator, bisectText, estimatedTokens, normalized, requestBytes, textInputs, VECTOR_MODEL, VECTOR_REQUEST_BYTES } from '@/utils/vectorEmbedding'
import { VectorEmbeddingClient as VectorEmbedding } from '@/infra/external/vectorEmbedding'

const unit = (axis = 0) => Array.from({ length: 1024 }, (_, i) => (i === axis ? 1 : 0))
const response = (count: number) => Response.json({ model: VECTOR_MODEL, data: Array.from({ length: count }, (_, i) => ({ index: i, embedding: unit(i) })) })
const embedding = (key: string, fetcher?: typeof fetch) => {
  if (fetcher) vi.stubGlobal('fetch', fetcher)
  return new VectorEmbedding({ JINA_API_KEY: key } as Env)
}

afterEach(() => vi.unstubAllGlobals())

describe('bounded whole-first embedding', () => {
  test('calls the default native fetch without binding the embedding client', async () => {
    const original = globalThis.fetch
    const receivers: unknown[] = []
    globalThis.fetch = async function (this: unknown) {
      receivers.push(this)
      if (this instanceof VectorEmbedding) throw new TypeError('Illegal invocation')
      return response(1)
    } as typeof fetch
    try {
      await expect(embedding('key').embed([{ text: 'real Worker receiver regression' }])).resolves.toHaveLength(1)
      expect(receivers).toHaveLength(1)
      expect(receivers[0]).not.toBeInstanceOf(VectorEmbedding)
    } finally {
      globalThis.fetch = original
    }
  })
  test('present text/image/PDF modalities each receive equal budgets independent of part counts', () => {
    const single = new ArticleVectorAccumulator()
    single.add({ values: unit(0), weight: 10000, modality: 'text' })
    single.add({ values: unit(1), weight: 1, modality: 'image' })
    single.add({ values: unit(2), weight: 1, modality: 'pdf' })
    const repeated = new ArticleVectorAccumulator()
    for (let i = 0; i < 10; i++) repeated.add({ values: unit(0), weight: 1000, modality: 'text' })
    for (let i = 0; i < 4; i++) repeated.add({ values: unit(1), weight: 1, modality: 'image' })
    for (let i = 0; i < 100; i++) repeated.add({ values: unit(2), weight: 1, modality: 'pdf' })
    expect(repeated.values()).toEqual(single.values())
    expect(single.values()[0]).toBeCloseTo(1 / Math.sqrt(3))
    expect(single.values()[1]).toBeCloseTo(1 / Math.sqrt(3))
    expect(single.values()[2]).toBeCloseTo(1 / Math.sqrt(3))
  })
  test.each([
    ['English', 'a '.repeat(35 * 1024)],
    ['Chinese', '文'.repeat(16 * 1024)],
    ['mixed', 'Hello中文🙂'.repeat(4000)]
  ])('keeps fitting %s content in one full input', (_name, text) => {
    expect(estimatedTokens(text)).toBeLessThanOrEqual(30_000)
    expect([...textInputs(text)]).toEqual([{ text }])
  })

  test('keeps a text above the old token estimate whole when it fits the byte bound', () => {
    const text = 'word '.repeat(60_000)
    expect(estimatedTokens(text)).toBeGreaterThan(30_000)
    expect(requestBytes([{ text }])).toBeLessThanOrEqual(VECTOR_REQUEST_BYTES)
    expect([...textInputs(text)]).toEqual([{ text }])
  })

  test('splits only oversize candidates at the request byte bound, losslessly and without broken surrogate pairs', () => {
    const text = '🙂中文 '.repeat(120_000)
    expect(requestBytes([{ text }])).toBeGreaterThan(VECTOR_REQUEST_BYTES)
    const parts = [...textInputs(text)] as { text: string }[]
    expect(parts.length).toBeGreaterThan(1)
    expect(parts.map(part => part.text).join('')).toBe(text)
    expect(parts.every(part => requestBytes([part]) <= VECTOR_REQUEST_BYTES)).toBe(true)
    expect(bisectText('a🙂b').join('')).toBe('a🙂b')
  })

  test('isolates explicit context overflow and bisects affected text without truncating', async () => {
    const accepted: string[] = []
    const fetcher = vi.fn(async (_url: unknown, init: RequestInit) => {
      const inputs = JSON.parse(init.body as string).input as { text: string }[]
      if (inputs.some(input => input.text.length > 4))
        return Response.json({ code: 'INPUT_TOKEN_LIMIT_EXCEEDED', detail: 'Input text exceeds the model maximum tokens' }, { status: 400 })
      accepted.push(...inputs.map(input => input.text))
      return response(inputs.length)
    })
    const encoder = embedding('key', fetcher as typeof fetch)
    const output = await encoder.embed([{ text: 'abcdefgh' }, { text: 'ok' }])
    expect(output.map(parts => parts.length)).toEqual([2, 1])
    expect(accepted.join('')).toBe('abcdefghok')
    expect(fetcher).toHaveBeenCalledTimes(5)
  })

  test.each([400, 413, 422])('recognises the recorded Jina overflow message at HTTP %i', async status => {
    for (const message of ["Input at index 0: Input exceeds the model's maximum length", 'Input at index 0: Input exceeds the model’s maximum length']) {
      const accepted: string[] = []
      const fetcher = vi.fn(async (_url: unknown, init: RequestInit) => {
        const inputs = JSON.parse(init.body as string).input as { text: string }[]
        if (inputs.some(input => input.text.length > 4)) return Response.json({ detail: message }, { status })
        accepted.push(...inputs.map(input => input.text))
        return response(inputs.length)
      })
      const encoder = embedding('key', fetcher as typeof fetch)
      const output = await encoder.embed([{ text: 'abcdefgh' }])
      expect(output[0]).toHaveLength(2)
      expect(accepted.join('')).toBe('abcdefgh')
      expect(fetcher.mock.calls.length).toBeGreaterThan(1)
    }
  })

  test('does not treat overflow wording as overflow outside 400/413/422 or as a different 400 error', async () => {
    const overflow = 'Input at index 0: Input exceeds the model’s maximum length'
    for (const [status, message, reason] of [
      [400, 'Invalid request payload', 'embedding_http_400'],
      [500, overflow, 'embedding_http_500'],
      [503, overflow, 'embedding_http_503']
    ] as const) {
      const fetcher = vi.fn().mockResolvedValue(Response.json({ detail: message }, { status }))
      await expect(embedding('key', fetcher as typeof fetch).embed([{ text: 'whole article' }])).rejects.toThrow(reason)
      expect(fetcher).toHaveBeenCalledOnce()
    }
  })

  test('does not split/retry authentication, rate limit or server errors', async () => {
    for (const status of [401, 429, 503]) {
      const fetcher = vi.fn().mockResolvedValue(Response.json({ detail: 'private source and key must not escape' }, { status }))
      await expect(embedding('key', fetcher).embed([{ text: 'whole article' }])).rejects.toThrow(`embedding_http_${status}`)
      expect(fetcher).toHaveBeenCalledOnce()
    }
  })

  test.each([new Error('Network connection lost.'), new TypeError('fetch failed: private provider detail')])(
    'reports transport failures without leaking details or retrying',
    async failure => {
      const fetcher = vi.fn().mockRejectedValue(failure)
      await expect(embedding('key', fetcher).embed([{ text: 'whole article' }])).rejects.toThrow(/^embedding_transport_failed$/)
      expect(fetcher).toHaveBeenCalledOnce()
    }
  )

  test('reports request timeouts separately without retrying', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(AbortSignal.abort())
    const fetcher = vi.fn().mockRejectedValue(new Error('Network connection lost.'))
    try {
      await expect(embedding('key', fetcher).embed([{ text: 'whole article' }])).rejects.toThrow(/^embedding_request_timeout$/)
      expect(timeout).toHaveBeenCalledExactlyOnceWith(90_000)
      expect(fetcher).toHaveBeenCalledOnce()
    } finally {
      timeout.mockRestore()
    }
  })

  test('rejects interrupted provider responses without publishing partial values or retrying', async () => {
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new Error('Network connection lost.'))
      }
    })
    const fetcher = vi.fn().mockResolvedValue(new Response(stream))
    await expect(embedding('key', fetcher).embed([{ text: 'whole article' }])).rejects.toThrow(/^embedding_response_interrupted$/)
    expect(fetcher).toHaveBeenCalledOnce()
    expect(stream.locked).toBe(false)
  })

  test('uses response indices, rejecting missing, duplicate, foreign, zero and non-finite vectors', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(
      Response.json({
        model: VECTOR_MODEL,
        data: [
          { index: 1, embedding: unit(1) },
          { index: 0, embedding: unit(0) }
        ]
      })
    )
    const result = await embedding('key', fetcher).embed([{ text: 'one' }, { text: 'two' }])
    expect(result[0][0].values).toEqual(unit(0))
    expect(result[1][0].values).toEqual(unit(1))
    for (const data of [
      [
        { index: 0, embedding: unit() },
        { index: 0, embedding: unit() }
      ],
      [
        { index: 2, embedding: unit() },
        { index: 1, embedding: unit() }
      ]
    ]) {
      await expect(embedding('key', vi.fn().mockResolvedValue(Response.json({ model: VECTOR_MODEL, data }))).embed([{ text: 'one' }, { text: 'two' }])).rejects.toThrow(
        'embedding_response_index'
      )
    }
    expect(() => normalized(Array(1024).fill(0))).toThrow('empty_vector')
    expect(() => normalized([...unit().slice(0, 1023), Infinity])).toThrow('invalid_vector_value')
  })

  test('bounds text response bytes and rejects empty PDF data', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('x'.repeat(2 * 1024 * 1024 + 1)))
    await expect(embedding('key', fetcher).embed([{ text: 'article' }])).rejects.toThrow('embedding_response_too_large')
    await expect(embedding('key', vi.fn().mockResolvedValue(Response.json({ model: VECTOR_MODEL, data: [] }))).pdf('base64')).rejects.toThrow()
  })

  test('sends the original PDF once and derives the vector count from the response', async () => {
    const data = (count: number) => ({
      model: VECTOR_MODEL,
      data: Array.from({ length: count }, (_, index) => ({ index, embedding: unit(index % 1024) }))
    })
    for (const count of [1, 40, 400]) {
      const fetcher = vi.fn().mockResolvedValue(Response.json(data(count)))
      const vectors = await embedding('key', fetcher).pdf('exact-original-base64')
      expect(vectors).toHaveLength(count)
      expect(fetcher).toHaveBeenCalledOnce()
      const payload = JSON.parse((fetcher.mock.calls[0][1] as RequestInit).body as string)
      expect(payload.input).toEqual({ pdf: 'exact-original-base64' })
      expect(payload.task).toBe('text-matching')
    }
  })

  test('accepts PDF responses above 2MiB and out-of-order indices without a page cap', async () => {
    const data = Array.from({ length: 400 }, (_, index) => ({
      index: 399 - index,
      embedding: unit(index % 1024),
      padding: 'x'.repeat(6_000)
    }))
    const body = JSON.stringify({ model: VECTOR_MODEL, data })
    expect(Buffer.byteLength(body)).toBeGreaterThan(2 * 1024 * 1024)
    const fetcher = vi.fn().mockResolvedValue(new Response(body))
    const vectors = await embedding('key', fetcher).pdf('base64')
    expect(vectors).toHaveLength(400)
    expect(fetcher).toHaveBeenCalledOnce()
    expect(vectors[0]).toEqual(unit(399 % 1024))
    expect(vectors[399]).toEqual(unit(0))
  })

  test('rejects malformed PDF responses rather than returning empty success', async () => {
    const invalid: unknown[] = [
      [],
      undefined,
      {},
      'data',
      [{ index: 0 }],
      [{ index: 0, embedding: 'vec' }],
      [{ index: -1, embedding: unit() }],
      [{ index: 1.5, embedding: unit() }],
      [
        { index: 0, embedding: unit() },
        { index: 0, embedding: unit() }
      ],
      [
        { index: 0, embedding: unit() },
        { index: 2, embedding: unit() }
      ],
      [
        { index: 0, embedding: unit() },
        { index: 1, embedding: unit().slice(0, 1023) }
      ],
      [{ index: 0, embedding: Array(1024).fill(0) }],
      [{ index: 0, embedding: [...unit().slice(0, 1023), Infinity] }]
    ]
    for (const value of invalid) {
      await expect(embedding('key', vi.fn().mockResolvedValue(Response.json({ model: VECTOR_MODEL, data: value }))).pdf('base64')).rejects.toThrow()
    }
    await expect(
      embedding('key', vi.fn().mockResolvedValue(Response.json({ model: 'other-model', data: [{ index: 0, embedding: unit() }] }))).pdf('base64')
    ).rejects.toThrow()
    await expect(embedding('key', vi.fn().mockResolvedValue(Response.json({ model: VECTOR_MODEL, data: {} }))).pdf('base64')).rejects.toThrow()
  })

  test('keeps non-PDF batch response counts exact', async () => {
    await expect(embedding('key', vi.fn().mockResolvedValue(response(1))).embed([{ text: 'one' }, { text: 'two' }])).rejects.toThrow()
    await expect(embedding('key', vi.fn().mockResolvedValue(response(3))).embed([{ text: 'one' }, { text: 'two' }])).rejects.toThrow()
  })

  test('propagates PDF parsing interruption and deadline failures without success', async () => {
    const interrupted = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new Error('Network connection lost.'))
      }
    })
    const fetcher = vi.fn().mockResolvedValue(new Response(interrupted))
    await expect(embedding('key', fetcher).pdf('base64')).rejects.toThrow()
    expect(fetcher).toHaveBeenCalledOnce()

    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(AbortSignal.abort())
    const timeoutFetcher = vi.fn().mockRejectedValue(new Error('Network connection lost.'))
    try {
      await expect(embedding('key', timeoutFetcher).pdf('base64')).rejects.toThrow(/^embedding_request_timeout$/)
      expect(timeout).toHaveBeenCalledExactlyOnceWith(90_000)
      expect(timeoutFetcher).toHaveBeenCalledOnce()
    } finally {
      timeout.mockRestore()
    }
  })

  test('keeps the 16KiB error-text bound for PDF requests', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('x'.repeat(16 * 1024 + 1), { status: 500 }))
    await expect(embedding('key', fetcher).pdf('base64')).rejects.toThrow('embedding_response_too_large')
    expect(fetcher).toHaveBeenCalledOnce()
  })
})
