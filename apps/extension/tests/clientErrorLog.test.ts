import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const token = (claims: object) => `h.${btoa(JSON.stringify(claims))}.s`
let fetchMock: ReturnType<typeof vi.fn>
let listeners: Record<string, (event: unknown) => void>

beforeEach(() => {
  vi.resetModules()
  listeners = {}
  fetchMock = vi.fn().mockResolvedValue(new Response('{}'))
  vi.stubGlobal('fetch', fetchMock)
  vi.stubGlobal('addEventListener', (type: string, listener: (event: unknown) => void) => void (listeners[type] = listener))
  vi.stubGlobal('location', { href: 'chrome-extension://gdnhaajlomjkhahnmiijphnodkcfikfd/background.js?x=1' })
  vi.stubGlobal('browser', {
    cookies: {
      get: vi.fn(async ({ name }: { name: string }) => (name === '_su' ? { value: 'device-ext' } : { value: token({ id: 42, exp: 9999999999 }) }))
    },
    storage: { local: { get: vi.fn(async () => ({})), set: vi.fn() } },
    runtime: { getManifest: () => ({ version: '1.16.4' }) }
  })
  vi.stubEnv('CLIENT_ERROR_INGEST_URL', 'https://stream.ingest.invalid')
  vi.stubEnv('VERSION', '1.16.4')
  vi.stubEnv('SLAX_ENV', 'production')
  vi.stubEnv('COOKIE_TOKEN_NAME', 'token_name')
  vi.stubEnv('PUBLIC_BASE_URL', 'https://r.slax.com')
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('extension client error log', () => {
  test('records background errors with extension identity and context', async () => {
    const { installClientErrorLog } = await import('@/utils/clientErrorLog')
    const errors = installClientErrorLog('background')
    listeners.unhandledrejection({ reason: new Error('session refresh failed') })
    await errors.flush()
    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://stream.ingest.invalid')
    const [record] = JSON.parse(init.body)
    expect(record).toMatchObject({
      app: 'extension',
      release: '1.16.4',
      env: 'production',
      kind: 'unhandledrejection',
      message: 'session refresh failed',
      user_id: '42',
      device_id: 'device-ext',
      page_url: 'chrome-extension://gdnhaajlomjkhahnmiijphnodkcfikfd/background.js',
      properties: { context: 'background', sources: ['global'] }
    })
  })

  test('installs nothing when the build has no endpoint', async () => {
    vi.stubEnv('CLIENT_ERROR_INGEST_URL', '')
    const { installClientErrorLog } = await import('@/utils/clientErrorLog')
    expect(installClientErrorLog('offscreen').enabled).toBe(false)
    expect(listeners).toEqual({})
  })

  test('captures Vue errors and keeps the previous handler', async () => {
    const { captureVueErrors, getClientErrorLog } = await import('@/utils/clientErrorLog')
    const previous = vi.fn()
    const app = { config: { errorHandler: previous } } as unknown as import('vue').App
    captureVueErrors(app)
    app.config.errorHandler?.(new TypeError('bad prop'), null, 'setup function')
    await getClientErrorLog().flush()
    expect(previous).toHaveBeenCalledOnce()
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)[0]).toMatchObject({ kind: 'vue', error_name: 'TypeError', properties: { info: 'setup function', sources: ['vue'] } })
  })
})
