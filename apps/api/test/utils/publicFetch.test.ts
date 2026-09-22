import { afterEach, describe, expect, test, vi } from 'vitest'
import { publicTarget } from '@/utils/publicTargetPolicy'
import { createPublicFetch } from '@/utils/publicFetch'

afterEach(() => vi.useRealTimers())

describe('public target policy', () => {
  test.each([
    'file:///etc/passwd',
    'ftp://example.com',
    'https://user:pass@example.com',
    'https://example.com:8443',
    'http://localhost',
    'http://printer',
    'http://thing.local.',
    'http://metadata.google.internal',
    'http://foo.home.arpa',
    'http://127.1',
    'http://2130706433',
    'http://0x7f000001',
    'http://0177.0.0.1',
    'http://169.254.169.254',
    'http://0.0.0.0',
    'http://10.1.2.3',
    'http://100.64.0.1',
    'http://172.31.255.255',
    'http://192.168.1.1',
    'http://192.0.0.8',
    'http://192.0.2.1',
    'http://198.18.0.1',
    'http://198.51.100.1',
    'http://203.0.113.1',
    'http://224.0.0.1',
    'http://255.255.255.255',
    'http://[::]',
    'http://[::1]',
    'http://[::ffff:127.0.0.1]',
    'http://[::ffff:8.8.8.8]',
    'http://[64:ff9b::a00:1]',
    'http://[fc00::1]',
    'http://[fe80::1]',
    'http://[ff02::1]',
    'http://[2001:db8::1]',
    'http://[2002:7f00:1::]',
    'http://[2001::1]',
    'http://[3fff::1]'
  ])('rejects %s without network access', url => expect(() => publicTarget(url)).toThrow())

  test.each(['https://example.com', 'http://8.8.8.8', 'https://[2606:4700:4700::1111]', 'https://例子.中国'])('allows %s', url =>
    expect(publicTarget(url).protocol).toMatch(/^https?:$/)
  )
  test('normalizes numeric IPs and default ports', () => {
    expect(publicTarget('http://0x08080808:80/').href).toBe('http://8.8.8.8/')
    expect(publicTarget('https://EXAMPLE.COM.:443/a#b').href).toBe('https://example.com/a')
  })
})

describe('bounded public transport', () => {
  test('rejects private redirects before transport, including manual HEAD-style probes', async () => {
    for (const followRedirects of [true, false]) {
      const cancel = vi.fn()
      const transport = vi.fn().mockResolvedValue(new Response(new ReadableStream({ cancel }), { status: 302, headers: { Location: 'http://169.254.169.254/' } }))
      await expect(createPublicFetch(transport)('https://example.com', {}, { followRedirects })).rejects.toThrow()
      expect(transport).toHaveBeenCalledOnce()
      expect(cancel).toHaveBeenCalled()
    }
  })
  test('follows relative redirects and removes all non-allowlisted headers across origins', async () => {
    const transport = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { Location: '/next' } }))
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { Location: 'https://other.example/video' } }))
      .mockResolvedValueOnce(new Response('ok'))
    const response = await createPublicFetch(transport)('https://example.com', {
      headers: { Authorization: 'secret', Cookie: 'secret', 'X-Api-Key': 'secret', Referer: 'secret', Range: 'bytes=0-1' }
    })
    expect(await response.text()).toBe('ok')
    expect(transport.mock.calls[1][0]).toBe('https://example.com/next')
    const headers = transport.mock.calls[2][1].headers as Headers
    for (const name of ['Authorization', 'Cookie', 'X-Api-Key', 'Referer']) expect(headers.has(name)).toBe(false)
    expect(headers.get('Range')).toBe('bytes=0-1')
    expect(transport.mock.calls.every(call => call[1].redirect === 'manual')).toBe(true)
  })
  test('limits loops', async () => {
    const transport = vi.fn().mockImplementation(async () => new Response(null, { status: 302, headers: { Location: '/' } }))
    await expect(createPublicFetch(transport)('https://example.com', {}, { maxRedirects: 2 })).rejects.toThrow('Too many redirects')
    expect(transport).toHaveBeenCalledTimes(3)
  })
  test('counts delivered bytes instead of trusting content length', async () => {
    const cancel = vi.fn()
    const body = new ReadableStream({
      start(c) {
        c.enqueue(new Uint8Array(6))
      },
      cancel
    })
    const response = await createPublicFetch(async () => new Response(body, { headers: { 'Content-Length': '1' } }))('https://example.com', {}, { maxBytes: 5 })
    await expect(response.arrayBuffer()).rejects.toThrow('byte budget')
    expect(cancel).toHaveBeenCalled()
  })
  test('times out stalled response headers and bodies', async () => {
    vi.useFakeTimers()
    const pending = createPublicFetch(() => new Promise(() => {}))('https://example.com', {}, { timeoutMs: 10 })
    const rejected = expect(pending).rejects.toThrow('timed out')
    await vi.advanceTimersByTimeAsync(11)
    await rejected
    const cancel = vi.fn()
    const response = await createPublicFetch(async () => new Response(new ReadableStream({ cancel })))('https://example.com', {}, { timeoutMs: 10 })
    const read = expect(response.text()).rejects.toThrow('timed out')
    await vi.advanceTimersByTimeAsync(11)
    await read
    expect(cancel).toHaveBeenCalled()
  })
  test('allows only explicit test transport mapping for a local HTTP fixture', async () => {
    const { createServer } = await import('node:http')
    const { gzipSync } = await import('node:zlib')
    const compressed = gzipSync('fixture')
    const server = createServer((_, response) => {
      response.writeHead(200, { 'Content-Encoding': 'gzip', 'Content-Length': String(compressed.byteLength) })
      response.end(compressed)
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    try {
      const { port } = server.address() as import('node:net').AddressInfo
      const transport = vi.fn(async (_url: string, init: RequestInit) => {
        const local = await fetch(`http://127.0.0.1:${port}/`, init)
        return new Response(local.body, { status: local.status, headers: local.headers })
      })
      expect(await (await createPublicFetch(transport)('https://fixture.example')).text()).toBe('fixture')
      await expect(createPublicFetch(transport)(`http://127.0.0.1:${port}/`)).rejects.toThrow()
      expect(transport).toHaveBeenCalledOnce()
      const limited = await createPublicFetch(transport)('https://fixture.example', {}, { maxBytes: 6 })
      await expect(limited.text()).rejects.toThrow('byte budget')
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()))
    }
  })
})
