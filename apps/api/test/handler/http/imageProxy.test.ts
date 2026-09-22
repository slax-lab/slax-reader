import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { ContextManager } from '@/utils/context'

vi.mock('@/utils/strings', () => ({
  hashMD5: vi.fn(),
  hashSHA256: vi.fn()
}))

import { hashMD5, hashSHA256 } from '@/utils/strings'
import { handleImageProxy } from '@/handler/http/imageProxy'

beforeEach(() => {
  vi.mocked(hashMD5).mockResolvedValue('valid-digest')
  vi.mocked(hashSHA256).mockResolvedValue('image-hash')
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('edge image proxy', () => {
  test.each([
    { digest: 'invalid', referer: '' },
    { digest: 'valid-digest', referer: 'https://reader.slax.com.attacker.example/' },
    { digest: 'valid-digest', referer: 'https://reader.slax.com@attacker.example/' }
  ])('rejects invalid authorization before cache, storage or network access: %o', async ({ digest, referer }) => {
    const get = vi.fn().mockResolvedValue(null)
    const put = vi.fn()
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const ctx = new ContextManager({ waitUntil: vi.fn() } as never, { OSS: { get, put }, IMAGER_CHECK_DIGST_SALT: 'salt' } as unknown as Env)
    const query = new URLSearchParams({ u: 'https://attacker.example/image', r: '', d: digest })
    const response = await handleImageProxy(ctx, new Request(`https://api.example/static/image?${query}`, { headers: { Referer: referer } }))
    expect(response.status).toBe(403)
    expect(get).not.toHaveBeenCalled()
    expect(put).not.toHaveBeenCalled()
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })

  test.each(['text/html', 'image/svg+xml'])('rejects active upstream content %s without storing it', async contentType => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('<script>alert(1)</script>', { headers: { 'Content-Type': contentType } }))
    const put = vi.fn()
    const ctx = new ContextManager({ waitUntil: vi.fn() } as never, { OSS: { get: vi.fn().mockResolvedValue(null), put }, IMAGER_CHECK_DIGST_SALT: 'salt' } as unknown as Env)
    const query = new URLSearchParams({ u: 'https://attacker.example/image', r: '', d: 'valid-digest' })
    const response = await handleImageProxy(ctx, new Request(`https://api.example/static/image?${query}`))
    expect(response.status).toBe(415)
    expect(put).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })

  test('returns an existing R2 image without fetching or rewriting it', async () => {
    const get = vi.fn().mockResolvedValue({
      body: new Response('r2-image').body,
      customMetadata: {},
      httpMetadata: { contentType: 'image/webp' }
    })
    const put = vi.fn()
    const waitUntil = vi.fn()
    const ctx = new ContextManager(
      { waitUntil } as unknown as ExecutionContext,
      {
        OSS: { get, put },
        IMAGER_CHECK_DIGST_SALT: 'salt',
        IMAGE_PREFIX: 'https://reader-img.slax.com/'
      } as unknown as Env
    )
    const query = new URLSearchParams({ u: 'https%3A%2F%2Fimage.example%2Fphoto.jpg', r: 'https://reader.slax.com', d: 'valid-digest' })

    const response = await handleImageProxy(ctx, new Request(`https://api-reader.slax.com/static/image?${query}`))

    expect(get).toHaveBeenCalledWith('image/image-hash')
    expect(put).not.toHaveBeenCalled()
    expect(waitUntil).not.toHaveBeenCalled()
    expect(response.headers.get('Content-Type')).toBe('image/webp')
    expect(await response.text()).toBe('r2-image')
  })
})

const mediaRequest = (headers: HeadersInit = {}, digest = 'valid-digest') => {
  const query = new URLSearchParams({ u: 'https%3A%2F%2Fmedia.example%2Fvideo.mp4', r: '', d: digest })
  return new Request(`https://api.example/static/image?${query}`, { headers })
}

const mediaContext = () => {
  const get = vi.fn().mockResolvedValue(null)
  const put = vi.fn().mockResolvedValue(undefined)
  const match = vi.fn().mockResolvedValue(undefined)
  const cachePut = vi.fn().mockResolvedValue(undefined)
  const waitUntil = vi.fn()
  vi.stubGlobal('caches', { default: { match, put: cachePut } })
  const ctx = new ContextManager({ waitUntil } as never, { OSS: { get, put }, IMAGER_CHECK_DIGST_SALT: 'salt' } as unknown as Env)
  return { ctx, get, put, match, cachePut, waitUntil }
}

describe('signed media proxy', () => {
  test.each(['video/mp4', 'video/webm', 'video/ogg'])('streams %s without buffering or caching it', async mime => {
    const { ctx, put, cachePut } = mediaContext()
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('video', { headers: { 'Content-Type': mime, 'Content-Length': '5', 'Accept-Ranges': 'bytes' } }))
    const response = await handleImageProxy(ctx, mediaRequest())
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe(mime)
    expect(response.headers.get('Content-Length')).toBe('5')
    expect(response.headers.get('Accept-Ranges')).toBe('bytes')
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(response.headers.get('Content-Security-Policy')).toContain('sandbox')
    expect(await response.text()).toBe('video')
    expect(put).not.toHaveBeenCalled()
    expect(cachePut).not.toHaveBeenCalled()
  })

  test.each(['bytes=0-4', 'bytes=5-', 'bytes=-5'])('forwards a signed single range %s and preserves 206 headers', async range => {
    const { ctx, get, put, match, cachePut } = mediaContext()
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response('video', { status: 206, headers: { 'Content-Type': 'video/mp4', 'Content-Length': '5', 'Content-Range': 'bytes 0-4/10', 'Accept-Ranges': 'bytes' } })
      )
    const response = await handleImageProxy(ctx, mediaRequest({ Range: range, Cookie: 'private', Authorization: 'Bearer private' }))
    const headers = fetchSpy.mock.calls[0][1]!.headers as Headers
    expect(headers.get('Range')).toBe(range)
    expect(headers.get('Accept-Encoding')).toBe('identity')
    expect(headers.has('Cookie')).toBe(false)
    expect(headers.has('Authorization')).toBe(false)
    expect(response.status).toBe(206)
    expect(response.headers.get('Content-Range')).toBe('bytes 0-4/10')
    expect(response.headers.get('Content-Length')).toBe('5')
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(await response.text()).toBe('video')
    for (const fn of [get, put, match, cachePut]) expect(fn).not.toHaveBeenCalled()
  })

  test.each(['bytes=0-1,3-4', 'bytes=-', 'bytes=10-1', 'bytes=-0', 'bytes=9007199254740992-', 'items=0-1'])('rejects invalid or multipart ranges %s', async range => {
    const { ctx, get, match } = mediaContext()
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    expect((await handleImageProxy(ctx, mediaRequest({ Range: range }))).status).toBe(400)
    for (const fn of [get, match, fetchSpy]) expect(fn).not.toHaveBeenCalled()
  })

  test.each(['', 'invalid'])('does not serve even populated caches without a valid signature (%s)', async digest => {
    const { ctx, get, match, put, cachePut } = mediaContext()
    match.mockResolvedValue(new Response('cached-video', { headers: { 'Content-Type': 'video/mp4' } }))
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    for (const headers of [{}, { Range: 'bytes=0-4' }]) {
      const response = await handleImageProxy(ctx, mediaRequest(headers, digest))
      expect(await response.text()).not.toBe('cached-video')
      expect(response.status).toBe(403)
    }
    for (const fn of [get, match, put, cachePut, fetchSpy]) expect(fn).not.toHaveBeenCalled()
  })

  test.each(['text/html', 'image/svg+xml', 'application/octet-stream', 'video/quicktime'])('rejects disallowed %s for range requests too', async mime => {
    const { ctx, put, cachePut } = mediaContext()
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('active', { status: 206, headers: { 'Content-Type': mime } }))
    expect((await handleImageProxy(ctx, mediaRequest({ Range: 'bytes=0-4' }))).status).toBe(415)
    expect(put).not.toHaveBeenCalled()
    expect(cachePut).not.toHaveBeenCalled()
  })

  test.each(['edge', 'r2'])('applies the MIME allowlist to old %s cache entries', async storage => {
    for (const mime of ['text/html', 'image/svg+xml', '']) {
      const { ctx, get, match, put, cachePut } = mediaContext()
      if (storage === 'edge') match.mockResolvedValue(new Response('active', { headers: { 'Content-Type': mime } }))
      else get.mockResolvedValue({ body: new Response('active').body, httpMetadata: { contentType: mime } })
      const fetchSpy = vi.spyOn(globalThis, 'fetch')
      expect((await handleImageProxy(ctx, mediaRequest())).status).toBe(415)
      for (const fn of [fetchSpy, put, cachePut]) expect(fn).not.toHaveBeenCalled()
    }
  })

  test.each(['edge', 'r2'])('allows existing %s video entries with safe response headers', async storage => {
    const { ctx, get, match } = mediaContext()
    if (storage === 'edge') match.mockResolvedValue(new Response('cached-video', { headers: { 'Content-Type': 'video/mp4' } }))
    else get.mockResolvedValue({ body: new Response('cached-video').body, httpMetadata: { contentType: 'video/mp4' } })
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const response = await handleImageProxy(ctx, mediaRequest())
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('video/mp4')
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(await response.text()).toBe('cached-video')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  test.each([undefined, '0', '1', '99999999'])('stores complete images using actual bytes rather than Content-Length %s', async length => {
    const { ctx, put, cachePut } = mediaContext()
    const headers = new Headers({ 'Content-Type': 'image/png' })
    if (length !== undefined) headers.set('Content-Length', length)
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('image', { headers }))
    const response = await handleImageProxy(ctx, mediaRequest())
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Length')).toBe('5')
    expect(await response.text()).toBe('image')
    expect(put).toHaveBeenCalledWith('image/image-hash', new TextEncoder().encode('image'), { httpMetadata: { contentType: 'image/png' } })
    expect(cachePut).toHaveBeenCalledOnce()
  })

  test('limits actual image bytes even when the upstream length is small', async () => {
    const { ctx, put, cachePut } = mediaContext()
    const cancel = vi.fn()
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(3 * 1024 * 1024 + 1))
      },
      cancel
    })
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(body, { headers: { 'Content-Type': 'image/png', 'Content-Length': '1' } }))
    const response = await handleImageProxy(ctx, mediaRequest())
    expect(response.status).toBe(302)
    expect(cancel).toHaveBeenCalled()
    expect(put).not.toHaveBeenCalled()
    expect(cachePut).not.toHaveBeenCalled()
  })

  test('does not cache unsolicited image partial responses', async () => {
    const { ctx, put, cachePut } = mediaContext()
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('part', { status: 206, headers: { 'Content-Type': 'image/png', 'Content-Range': 'bytes 0-3/10' } }))
    const response = await handleImageProxy(ctx, mediaRequest())
    expect(response.status).toBe(206)
    expect(response.headers.get('Content-Range')).toBe('bytes 0-3/10')
    expect(await response.text()).toBe('part')
    expect(put).not.toHaveBeenCalled()
    expect(cachePut).not.toHaveBeenCalled()
  })

  test('revalidates old large-object markers rather than redirecting unvalidated content', async () => {
    const { ctx, get, put, cachePut } = mediaContext()
    get.mockResolvedValue({ body: new Response('1').body, customMetadata: { large: '1' } })
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('html', { headers: { 'Content-Type': 'text/html' } }))
    expect((await handleImageProxy(ctx, mediaRequest())).status).toBe(415)
    expect(put).not.toHaveBeenCalled()
    expect(cachePut).not.toHaveBeenCalled()
  })

  test('serves full and partial video over real HTTP and binds the signature to the source', async () => {
    const { createServer } = await import('node:http')
    const { createHash } = await import('node:crypto')
    vi.mocked(hashMD5).mockImplementation(async value => createHash('md5').update(value).digest('hex'))
    const requests: Array<string | undefined> = []
    const server = createServer((request, response) => {
      requests.push(request.headers.range)
      response.setHeader('Content-Type', 'video/mp4')
      response.setHeader('Accept-Ranges', 'bytes')
      if (request.headers.range) {
        response.writeHead(206, { 'Content-Range': 'bytes 0-4/10', 'Content-Length': '5' })
        response.end('video')
      } else {
        response.writeHead(200, { 'Content-Length': '10' })
        response.end('video-body')
      }
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    try {
      const address = server.address() as import('node:net').AddressInfo
      const nativeFetch = globalThis.fetch
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
        expect(String(input)).toBe('https://fixture.example/video.mp4')
        const local = await nativeFetch(`http://127.0.0.1:${address.port}/video.mp4`, init)
        return new Response(local.body, { status: local.status, headers: local.headers })
      })
      const source = encodeURIComponent('https://fixture.example/video.mp4')
      const digest = createHash('md5')
        .update(source + 'salt')
        .digest('hex')
      const query = new URLSearchParams({ u: source, r: '', d: digest })
      const { ctx, put, cachePut } = mediaContext()
      const url = `https://api.example/static/image?${query}`
      const full = await handleImageProxy(ctx, new Request(url))
      expect(full.status).toBe(200)
      expect(await full.text()).toBe('video-body')
      const partial = await handleImageProxy(ctx, new Request(url, { headers: { Range: 'bytes=0-4' } }))
      expect(partial.status).toBe(206)
      expect(partial.headers.get('Content-Range')).toBe('bytes 0-4/10')
      expect(await partial.text()).toBe('video')
      query.set('u', source + 'tampered')
      const rejected = await handleImageProxy(ctx, new Request(`https://api.example/static/image?${query}`, { headers: { Range: 'bytes=0-4' } }))
      expect(rejected.status).toBe(403)
      expect(requests).toEqual([undefined, 'bytes=0-4'])
      expect(put).not.toHaveBeenCalled()
      expect(cachePut).not.toHaveBeenCalled()
    } finally {
      await new Promise<void>((resolve, reject) => server.close(error => (error ? reject(error) : resolve())))
    }
  })

  test.each(['http://127.0.0.1/', 'http://169.254.169.254/', 'http://[::ffff:127.0.0.1]/'])('rejects signed private targets before both cache layers: %s', async source => {
    const { ctx, get, match } = mediaContext()
    const fetch = vi.spyOn(globalThis, 'fetch')
    const query = new URLSearchParams({ u: encodeURIComponent(source), r: '', d: 'valid-digest' })
    expect((await handleImageProxy(ctx, new Request(`https://api.example/static/image?${query}`))).status).toBe(400)
    for (const fn of [get, match, fetch]) expect(fn).not.toHaveBeenCalled()
  })

  test('rejects a private redirect without caching', async () => {
    const { ctx, put, cachePut } = mediaContext()
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(null, { status: 302, headers: { Location: 'http://10.0.0.1/' } }))
    expect((await handleImageProxy(ctx, mediaRequest())).status).toBe(502)
    expect(fetch).toHaveBeenCalledOnce()
    expect(put).not.toHaveBeenCalled()
    expect(cachePut).not.toHaveBeenCalled()
  })

  test('enforces the streaming video byte budget without buffering or caching', async () => {
    const { ctx, put, cachePut } = mediaContext()
    const chunk = new Uint8Array(1024 * 1024)
    const cancel = vi.fn()
    const body = new ReadableStream({
      pull(controller) {
        controller.enqueue(chunk)
      },
      cancel
    })
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(body, { headers: { 'Content-Type': 'video/mp4' } }))
    const response = await handleImageProxy(ctx, mediaRequest({ Range: 'bytes=0-' }))
    const reader = response.body!.getReader()
    for (let i = 0; i < 128; i++) expect((await reader.read()).value?.byteLength).toBe(chunk.byteLength)
    await expect(reader.read()).rejects.toThrow('byte budget')
    expect(cancel).toHaveBeenCalled()
    expect(put).not.toHaveBeenCalled()
    expect(cachePut).not.toHaveBeenCalled()
  })

  test('preserves an unsatisfiable range without forwarding an error body', async () => {
    const { ctx, put, cachePut } = mediaContext()
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('html-error', { status: 416, headers: { 'Content-Type': 'text/html', 'Content-Range': 'bytes */10' } }))
    const response = await handleImageProxy(ctx, mediaRequest({ Range: 'bytes=100-' }))
    expect(response.status).toBe(416)
    expect(response.headers.get('Content-Range')).toBe('bytes */10')
    expect(await response.text()).toBe('')
    expect(put).not.toHaveBeenCalled()
    expect(cachePut).not.toHaveBeenCalled()
  })
})
