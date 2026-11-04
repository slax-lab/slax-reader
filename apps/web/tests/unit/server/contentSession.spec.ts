// @vitest-environment happy-dom
import { loadContent } from '../../../server/utils/loadContent'

import * as h3 from 'h3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('#app/nuxt', async original => ({
  ...(await original<Record<string, unknown>>()),
  useRuntimeConfig: () => ({ public: { COOKIE_TOKEN_NAME: 'token' } })
}))
vi.mock('../../../server/utils/serverTiming', () => ({ isServerTimingEnabled: () => false }))
const fetchMetadata = vi.fn()
const readBody = vi.fn()

beforeEach(() => {
  vi.stubGlobal('useRuntimeConfig', () => ({ public: { COOKIE_TOKEN_NAME: 'token' } }))
  fetchMetadata.mockReset()
  readBody.mockReset().mockResolvedValue({ text: async () => 'Authorized article' })
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function event(headers: Record<string, string> = { cookie: 'token=rejected-fixture' }) {
  const current = h3.createEvent({ headers } as never, { setHeader: vi.fn(), getHeader: vi.fn() } as never)
  current.context.cloudflare = { env: { BACKEND: { fetch: fetchMetadata }, OSS: { get: readBody } } }
  return current
}

describe('snapshot metadata access failures', () => {
  it.each([401, 403, 404])('preserves upstream %s without reading article storage', async status => {
    fetchMetadata.mockResolvedValue(new Response(null, { status }))
    await expect(loadContent(event(), 'snapshot')).rejects.toMatchObject({ statusCode: status })
    expect(readBody).not.toHaveBeenCalled()
  })

  it.each([500, 503])('keeps upstream %s as a service failure', async status => {
    fetchMetadata.mockResolvedValue(new Response(null, { status }))
    await expect(loadContent(event(), 'snapshot')).rejects.toMatchObject({ statusCode: 500 })
    expect(readBody).not.toHaveBeenCalled()
  })

  it('reports a transport failure without reading article storage', async () => {
    fetchMetadata.mockRejectedValue(new Error('connection unavailable'))
    await expect(loadContent(event(), 'snapshot')).rejects.toMatchObject({ statusCode: 500 })
    expect(readBody).not.toHaveBeenCalled()
  })

  it('reads only the body selected by successful authorized metadata', async () => {
    fetchMetadata.mockResolvedValue(Response.json({ role: 'owner', content_key: 'snapshots/current.html' }))
    await expect(loadContent(event(), 'snapshot')).resolves.toEqual({
      metadata: { role: 'owner', content_key: 'snapshots/current.html' }, body: 'Authorized article'
    })
    expect(fetchMetadata).toHaveBeenCalledWith('https://content.internal/content/meta?uuid=snapshot', {
      headers: { Authorization: 'Bearer rejected-fixture' }
    })
    expect(readBody).toHaveBeenCalledExactlyOnceWith('snapshots/current.html')
  })

  it('gives an explicit Authorization header precedence over the cookie', async () => {
    fetchMetadata.mockResolvedValue(new Response(null, { status: 401 }))
    await expect(loadContent(event({ cookie: 'token=other-session', authorization: 'Bearer header-fixture' }), 'snapshot'))
      .rejects.toMatchObject({ statusCode: 401 })
    expect(fetchMetadata).toHaveBeenCalledWith(expect.any(String), { headers: { Authorization: 'Bearer header-fixture' } })
    expect(readBody).not.toHaveBeenCalled()
  })
})
