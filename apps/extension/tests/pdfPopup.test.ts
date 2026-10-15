import { File } from 'node:buffer'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

const fixture = vi.hoisted(() => ({
  get: vi.fn(), post: vi.fn(), token: vi.fn(), title: vi.fn(), mounted: [] as (() => void)[],
  cookieListener: undefined as undefined | ((change: { cookie: { name: string; domain: string } }) => void)
}))
vi.mock('vue', async importOriginal => ({
  ...await importOriginal<typeof import('vue')>(),
  onMounted: (callback: () => void) => fixture.mounted.push(callback), onUnmounted: vi.fn(), watch: vi.fn(), useSSRContext: () => ({ modules: new Set() })
}))
vi.mock('@/bridge/request', () => ({ request: { get: fixture.get, post: fixture.post } }))
vi.mock('@/utils/session', () => ({ getCurrentSessionToken: fixture.token }))
vi.mock('@/utils/localeClient', () => ({ initializeLocaleClient: () => ({ dispose: vi.fn() }) }))
vi.mock('@/utils/locale', () => ({ $t: (key: string) => key, getExtensionLocale: () => 'en' }))
vi.mock('@/utils/pdfFile', async importOriginal => ({ ...await importOriginal<typeof import('../src/utils/pdfFile')>(), readPdfTitle: fixture.title }))
import PdfSave from '../src/entrypoints/pdf-save/PdfSave.vue'

let source: string
let allowed: boolean
let initial: boolean
beforeEach(() => {
  vi.useFakeTimers()
  vi.stubEnv('COOKIE_DOMAIN', 'reader.test')
  vi.stubEnv('COOKIE_TOKEN_NAME', 'token')
  vi.stubEnv('PUBLIC_BASE_URL', 'https://reader.test')
  fixture.mounted = []
  fixture.get.mockReset().mockResolvedValue({ features: [{ key: 'pdf', enabled: true }] })
  fixture.title.mockReset().mockResolvedValue(undefined)
  fixture.post.mockReset().mockImplementation(async ({ url }) => url.startsWith('/v1/bookmark/upload_pdf') ? { bookmark_id: 123456, bookmark_uid: 'uid' } : { bmId: '' })
  fixture.token.mockReset().mockResolvedValue('test-session')
  source = 'https://example.org/download?token=synthetic'
  allowed = true
  initial = true
  vi.stubGlobal('File', File)
  vi.stubGlobal('window', { parent: { postMessage: vi.fn() }, close: vi.fn() })
  vi.stubGlobal('location', { href: 'chrome-extension://test/pdf-save.html?operation=test-operation&surface=inline' })
  vi.stubGlobal('browser', {
    runtime: { sendMessage: vi.fn(async (message: any) => message.method === 'identify' ? { ok: true, bound: true } : ({ ok: true, sourceUrl: source, state: 'ready', autoStart: initial })) },
    extension: { isAllowedFileSchemeAccess: vi.fn(async () => allowed) },
    cookies: { onChanged: { addListener: (listener: typeof fixture.cookieListener) => { fixture.cookieListener = listener }, removeListener: vi.fn() } },
    tabs: { create: vi.fn() }
  })
  vi.stubGlobal('fetch', vi.fn(async () => new Response('%PDF-1.7\nbody')))
})
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks() })
const view = () => (PdfSave as unknown as { setup: (props: object, ctx: { expose: () => void }) => any }).setup({}, { expose() {} })

test('mount starts one online backend submission without a second save action or local Labs check', async () => {
  const popup = view()
  fixture.mounted[0]()
  await vi.waitFor(() => expect(popup.state.value).toBe('queued'))
  expect(fixture.post).toHaveBeenCalledOnce()
  expect(fixture.post).toHaveBeenCalledWith(expect.objectContaining({ url: '/v1/bookmark/add_url', body: { target_url: source } }))
  expect(fixture.get).not.toHaveBeenCalled()
  expect(fetch).not.toHaveBeenCalled()
})

test('missing local file permission shows guidance before account eligibility or reading', async () => {
  source = 'file:///private/local.pdf'
  allowed = false
  const popup = view()
  await popup.checks(true)
  expect(popup.state.value).toBe('permission')
  expect(fixture.get).not.toHaveBeenCalled()
  expect(fixture.post).not.toHaveBeenCalled()
  expect(fetch).not.toHaveBeenCalled()
})

test('permitted local source automatically uploads raw bytes and basename once', async () => {
  source = 'file:///private/local%20%E6%96%87.pdf'
  const popup = view()
  await Promise.all([popup.checks(true), popup.checks(true)])
  expect(popup.state.value).toBe('saved')
  expect(fixture.post).toHaveBeenCalledOnce()
  const options = fixture.post.mock.calls[0][0]
  expect(options.url).toBe('/v1/bookmark/upload_pdf?filename=local%20%E6%96%87.pdf')
  expect(options.query).toBeUndefined()
  expect(options.headers['Content-Type']).toBe('application/pdf')
  expect(options.body).toBeInstanceOf(File)
  expect(await options.body.text()).toBe('%PDF-1.7\nbody')
})

test('disabled local eligibility cannot read or upload the source', async () => {
  source = 'file:///private/local.pdf'
  fixture.get.mockResolvedValue({ features: [{ key: 'pdf', enabled: false }] })
  const popup = view()
  await popup.checks(true)
  expect(popup.state.value).toBe('labs')
  expect(fetch).not.toHaveBeenCalled()
  expect(fixture.post).not.toHaveBeenCalled()
})

test('reloaded operation requires explicit retry and does not automatically replay', async () => {
  initial = false
  const popup = view()
  await popup.checks(true)
  expect(popup.state.value).toBe('failed')
  expect(fixture.post).not.toHaveBeenCalled()
  await popup.checks()
  expect(fixture.post).toHaveBeenCalledOnce()
})

test('cancel during initial checks prevents a subsequent automatic submission', async () => {
  let resolveClaim!: (value: unknown) => void
  vi.mocked(browser.runtime.sendMessage).mockImplementationOnce(() => new Promise(resolve => { resolveClaim = resolve }))
  const popup = view()
  const checks = popup.checks(true)
  popup.cancel()
  resolveClaim({ ok: true, sourceUrl: source, state: 'ready', autoStart: true })
  await checks
  expect(popup.state.value).toBe('cancelled')
  expect(fixture.post).not.toHaveBeenCalled()
})


test('an unpaired inline frame performs no backend calls', async () => {
  vi.mocked(browser.runtime.sendMessage).mockImplementation(async (message: any) => message.method === 'identify'
    ? { ok: true, bound: false, frameId: 2, token: 'pairing-token' } : { error: 'pending' })
  const popup = view()
  fixture.mounted[0]()
  await vi.waitFor(() => expect(popup.state.value).toBe('source'), { timeout: 3000 })
  expect(fixture.get).not.toHaveBeenCalled()
  expect(fixture.post).not.toHaveBeenCalled()
  expect(fetch).not.toHaveBeenCalled()
})


test('unrelated website cookies do not invalidate the Slax collection session', async () => {
  const popup = view()
  fixture.mounted[0]()
  await vi.waitFor(() => expect(popup.state.value).toBe('queued'))
  fixture.cookieListener!({ cookie: { name: 'token', domain: 'other-site.example' } })
  expect(popup.state.value).toBe('queued')
  fixture.cookieListener!({ cookie: { name: 'token', domain: '.reader.test' } })
  expect(popup.state.value).toBe('login')
})


test('confirmed numeric upload survives a rejected completion message', async () => {
  source = 'file:///private/local.pdf'
  vi.mocked(browser.runtime.sendMessage).mockImplementation(async (message: any) => {
    if (message.method === 'complete') throw new Error('Worker restarted')
    return { ok: true, sourceUrl: source, state: 'ready', autoStart: true }
  })
  const popup = view()
  await popup.checks(true)
  expect(popup.state.value).toBe('saved')
  expect(popup.uid.value).toBe('uid')
  expect(fixture.post).toHaveBeenCalledOnce()
})

test.each([
  { bookmark_id: 'encoded', bookmark_uid: 'uid' },
  { bookmark_id: 0, bookmark_uid: 'uid' },
  { bookmark_id: 123, bookmark_uid: '' },
  { bookmark_id: 123, bookmark_uid: '   ' },
  { bookmark_id: NaN, bookmark_uid: 'uid' }
])('malformed upload acknowledgement cannot report saved: %j', async result => {
  source = 'file:///private/local.pdf'
  fixture.post.mockResolvedValue(result)
  const popup = view()
  await popup.checks(true)
  expect(popup.state.value).toBe('failed')
  expect(popup.uid.value).toBe('')
})

test('metadata title is visible during upload and the server title wins after acknowledgement', async () => {
  source = 'file:///private/name%26extra%23.pdf'
  fixture.title.mockResolvedValue('Embedded PDF Title')
  let popup: ReturnType<typeof view>
  fixture.post.mockImplementation(async options => {
    expect(popup.name.value).toBe('Embedded PDF Title')
    expect(options.url).toBe('/v1/bookmark/upload_pdf?filename=name%26extra%23.pdf')
    expect(await options.body.text()).toBe('%PDF-1.7\nbody')
    return { bookmark_id: 123, bookmark_uid: 'uid', title: ' Authoritative\n Title ' }
  })
  popup = view()
  await popup.checks(true)
  expect(popup.state.value).toBe('saved')
  expect(popup.name.value).toBe('Authoritative Title')
})

test('a server without response title retains the metadata title', async () => {
  source = 'file:///private/download.pdf'
  fixture.title.mockResolvedValue('Actual Paper Title')
  const popup = view()
  await popup.checks(true)
  expect(popup.state.value).toBe('saved')
  expect(popup.name.value).toBe('Actual Paper Title')
})

test('confirmed upload during an account change shows login instead of uncertain failure', async () => {
  source = 'file:///private/local.pdf'
  fixture.post.mockImplementation(async () => {
    fixture.token.mockResolvedValue('changed-session')
    return { bookmark_id: 123, bookmark_uid: 'old-account-uid' }
  })
  const popup = view()
  await popup.checks(true)
  expect(popup.state.value).toBe('login')
  expect(popup.uid.value).toBe('')
  expect(browser.runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({ method: 'complete', result: 'saved' }))
})
