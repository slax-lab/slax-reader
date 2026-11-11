// @vitest-environment happy-dom
import { loadContent } from '../../../server/utils/loadContent'

import { isServerTimingEnabled } from '../../../server/utils/serverTiming'
import { projectWebArticleBody } from '../../../server/utils/webArticleBody'

import * as h3 from 'h3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('#app/nuxt', async original => ({
  ...(await original<Record<string, unknown>>()),
  useRuntimeConfig: () => config
}))
vi.mock('../../../server/utils/webArticleBody', () => ({ projectWebArticleBody: vi.fn(async (body: string) => body) }))
vi.mock('../../../server/utils/serverTiming', () => ({ isServerTimingEnabled: vi.fn(() => false) }))
const config = vi.hoisted(() => ({ public: { COOKIE_TOKEN_NAME: 'token', DWEB_API_BASE_URL: 'https://api.example.com' } }))
const fetchMetadata = vi.fn()
const readBody = vi.fn()

beforeEach(() => {
  config.public.DWEB_API_BASE_URL = 'https://api.example.com'
  vi.stubGlobal('useRuntimeConfig', () => config)
  vi.mocked(projectWebArticleBody).mockReset().mockImplementation(async body => body)
  vi.mocked(isServerTimingEnabled).mockReturnValue(false)
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
    expect(projectWebArticleBody).not.toHaveBeenCalled()
  })

  it.each([500, 503])('keeps upstream %s as a service failure', async status => {
    fetchMetadata.mockResolvedValue(new Response(null, { status }))
    await expect(loadContent(event(), 'snapshot')).rejects.toMatchObject({ statusCode: 500 })
    expect(readBody).not.toHaveBeenCalled()
    expect(projectWebArticleBody).not.toHaveBeenCalled()
  })

  it('reports a transport failure without reading article storage', async () => {
    fetchMetadata.mockRejectedValue(new Error('connection unavailable'))
    await expect(loadContent(event(), 'snapshot')).rejects.toMatchObject({ statusCode: 500 })
    expect(readBody).not.toHaveBeenCalled()
    expect(projectWebArticleBody).not.toHaveBeenCalled()
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

  it('projects only the authorized body using the configured image endpoint', async () => {
    fetchMetadata.mockResolvedValue(Response.json({ role: 'visitor', content_key: 'snapshots/current.html' }))
    vi.mocked(projectWebArticleBody).mockResolvedValue('Projected article')
    await expect(loadContent(event(), 'snapshot')).resolves.toMatchObject({ body: 'Projected article' })
    expect(projectWebArticleBody).toHaveBeenCalledExactlyOnceWith('Authorized article', 'https://api.example.com')
  })

  it('keeps the original-body Node development path when the API URL is unset', async () => {
    config.public.DWEB_API_BASE_URL = ''
    fetchMetadata.mockResolvedValue(Response.json({ role: 'visitor' }))
    await expect(loadContent(event(), 'snapshot')).resolves.toMatchObject({ body: 'Authorized article' })
  })

  it('does not hide projection failures as a missing R2 body', async () => {
    fetchMetadata.mockResolvedValue(Response.json({ role: 'visitor' }))
    vi.mocked(projectWebArticleBody).mockRejectedValue(new Error('projection failed'))
    await expect(loadContent(event(), 'snapshot')).rejects.toThrow('projection failed')
  })

  it.each([false, true])('keeps projection timing in the existing diagnostic policy: %s', async enabled => {
    vi.mocked(isServerTimingEnabled).mockReturnValue(enabled)
    fetchMetadata.mockResolvedValue(Response.json({ role: 'visitor' }))
    const app = h3.createApp()
    app.use(h3.defineEventHandler(event => loadContent(event, 'snapshot')))
    const response = await h3.toPlainHandler(app)({ method: 'GET', path: '/', headers: {}, context: { cloudflare: { env: { BACKEND: { fetch: fetchMetadata }, OSS: { get: readBody } } } } })
    const timing = new Headers(response.headers as never).get('server-timing')
    if (enabled) {
      expect(timing).toMatch(/front_body-projection;dur=\d+\.\d/)
      expect(timing).not.toMatch(/Authorized article|snapshot|token/)
    } else expect(timing).toBeNull()
  })

  it('gives an explicit Authorization header precedence over the cookie', async () => {
    fetchMetadata.mockResolvedValue(new Response(null, { status: 401 }))
    await expect(loadContent(event({ cookie: 'token=other-session', authorization: 'Bearer header-fixture' }), 'snapshot'))
      .rejects.toMatchObject({ statusCode: 401 })
    expect(fetchMetadata).toHaveBeenCalledWith(expect.any(String), { headers: { Authorization: 'Bearer header-fixture' } })
    expect(readBody).not.toHaveBeenCalled()
    expect(projectWebArticleBody).not.toHaveBeenCalled()
  })
})
