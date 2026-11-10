// @vitest-environment happy-dom
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const HOST = 'reader.test'
const ORIGIN = `https://${HOST}`
const TOKEN = 'aGVhZGVy.cGF5bG9hZA.c2lnbmF0dXJl'
const config = vi.hoisted(() => ({ public: { COOKIE_TOKEN_NAME: 'token', COOKIE_DOMAIN: '.reader.test' } as Record<string, unknown> }))

vi.mock('#app/nuxt', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useRuntimeConfig: () => config
}))

type PlainResponse = { status: number; headers: unknown }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let handler: (request: any) => Promise<PlainResponse>

beforeAll(async () => {
  const h3 = await import('h3')
  ;(globalThis as Record<string, unknown>).defineEventHandler = h3.defineEventHandler
  const app = h3.createApp()
  app.use('/api/auth/session', (await import('../../../server/api/auth/session.post')).default)
  handler = h3.toPlainHandler(app) as unknown as typeof handler
})

beforeEach(() => {
  config.public.COOKIE_DOMAIN = '.reader.test'
})

const call = ({ body = { token: TOKEN }, origin = ORIGIN, contentType = 'application/json', proto = 'https' }: { body?: unknown; origin?: string | null; contentType?: string; proto?: string } = {}) =>
  handler({
    method: 'POST',
    path: '/api/auth/session',
    headers: { host: HOST, 'x-forwarded-proto': proto, 'content-type': contentType, ...(origin === null ? {} : { origin }) },
    body: typeof body === 'string' ? body : JSON.stringify(body)
  })

const header = (res: PlainResponse, name: string) => {
  const entries = Array.isArray(res.headers) ? (res.headers as [string, string][]) : Object.entries(res.headers as Record<string, string | string[]>)
  return entries
    .filter(([key]) => key.toLowerCase() === name)
    .flatMap(([, value]) => (Array.isArray(value) ? value : [value]))
    .join('\n')
}

describe('POST /api/auth/session', () => {
  it('issues the login cookie in the HTTP response', async () => {
    const res = await call()
    const cookie = header(res, 'set-cookie')
    expect(res.status).toBe(204)
    for (const part of [`token=${TOKEN}`, 'Max-Age=5184000', 'Domain=.reader.test', 'Path=/', 'SameSite=Lax', 'Secure']) expect(cookie).toContain(part)
    expect(cookie).not.toContain('HttpOnly')
    expect(header(res, 'cache-control')).toBe('no-store')
  })

  it('keeps a host-only cookie without Secure on plain HTTP development hosts', async () => {
    config.public.COOKIE_DOMAIN = ''
    const cookie = header(await call({ origin: `http://${HOST}`, proto: 'http' }), 'set-cookie')
    expect(cookie).toContain(`token=${TOKEN}`)
    expect(cookie).not.toContain('Domain=')
    expect(cookie).not.toContain('Secure')
  })

  it.each([
    ['a missing Origin', { origin: null }],
    ['a cross-site Origin', { origin: 'https://attacker.test' }],
    ['a sibling subdomain Origin', { origin: 'https://evil.reader.test' }],
    ['a form body', { contentType: 'text/plain', body: JSON.stringify({ token: TOKEN }) }],
    ['invalid JSON', { body: '{' }],
    ['a non-JWT token', { body: { token: 'not-a-jwt' } }],
    ['cookie attribute injection', { body: { token: `${TOKEN}; Domain=attacker.test` } }]
  ])('rejects %s without setting a cookie', async (_, options) => {
    const res = await call(options)
    expect(res.status).toBe(400)
    expect(header(res, 'set-cookie')).toBe('')
  })
})
