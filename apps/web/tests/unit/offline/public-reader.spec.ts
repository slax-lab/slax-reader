import { savePublicReader } from '../../../app/offline/save-public-reader'
import { readerNavigation } from '../../../app/service-worker/offline-reader'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const appearance = { locale: 'en', theme: 'eink' } as const
const payload = (body: string, metadata = {}) => Response.json({
  metadata: { role: 'visitor', type: 'article', title: '<Offline title>', first_comment: 'personal note', ...metadata },
  body
})
const path = '/b/read'
let records: Map<string, Response>
let network: ReturnType<typeof vi.fn>
const openOffline = (path: string) => readerNavigation(new Request('https://reader.test' + path), path)

beforeEach(() => {
  records = new Map()
  vi.stubGlobal('caches', { open: async () => ({
    put: (key: string, value: Response) => records.set(key, value),
    match: (key: string) => records.get(key)?.clone(),
    delete: (key: string) => records.delete(key)
  }) })
  network = vi.fn().mockRejectedValue(new TypeError('Offline'))
  vi.stubGlobal('fetch', network)
})
afterEach(() => vi.unstubAllGlobals())

describe('offline public reader', () => {
  it('keeps anonymous article text through the final paragraph under the canonical and share URLs', async () => {
    network.mockResolvedValueOnce(Response.json({ uuid: 'read' })).mockResolvedValueOnce(payload(
      '<p>First <em>paragraph</em></p><script>secret script</script><p>&lt;last paragraph&gt;</p>', { alias_title: '  ' }
    ))
    await savePublicReader('/s/share', appearance)
    expect(network.mock.calls[1]).toEqual(['/api/content/read', { credentials: 'omit', cache: 'no-store' }])
    expect(await records.get(path)!.clone().json()).toEqual({ title: '<Offline title>', text: 'First paragraph\n\n<last paragraph>' })
    for (const address of [path, '/s/share']) {
      const offline = await (await openOffline(address)).text()
      expect(offline).toContain('&lt;Offline title&gt;')
      expect(offline).toContain('&lt;last paragraph&gt;')
      expect(offline).toContain('Offline · Saved copy')
      expect(offline).not.toMatch(/secret script|personal note/)
    }
  })

  it('refreshes public text, preserves the last successful read through transient failure, and evicts denial for every alias', async () => {
    network.mockResolvedValueOnce(payload('<p>original</p>'))
    await savePublicReader(path, appearance, 'first-share')
    network.mockResolvedValueOnce(payload('<p>revised</p>'))
    await savePublicReader(path, appearance)
    network.mockResolvedValueOnce(new Response(null, { status: 500 }))
    await savePublicReader(path, appearance)
    expect(await (await openOffline('/s/first-share')).text()).toContain('revised')
    network.mockResolvedValueOnce(new Response(null, { status: 403 }))
    await savePublicReader(path, appearance)
    expect((await openOffline(path)).status).toBe(503)
    expect((await openOffline('/s/first-share')).status).toBe(503)
  })

  it.each([{role: 'owner'}, {type: 'pdf'}])('excludes private owners and PDFs', async metadata => {
    network.mockResolvedValueOnce(payload('unavailable body', metadata))
    await savePublicReader(path, appearance)
    expect(records.has(path)).toBe(false)
    expect(await (await openOffline('/b/unvisited')).text()).toContain('This article is unavailable offline.')
  })

  it('evicts the canonical record when the live document denies access without hydrating', async () => {
    network.mockResolvedValueOnce(payload('<p>original</p>'))
    await savePublicReader(path, appearance, 'code')
    network.mockResolvedValueOnce(new Response('Revoked', { status: 403 }))
    expect((await openOffline(path)).status).toBe(403)
    expect((await openOffline('/s/code')).status).toBe(503)
  })

  it('passes live HTTP responses through and forgets a revoked share code', async () => {
    network.mockResolvedValueOnce(payload('<p>original</p>'))
    await savePublicReader(path, appearance, 'code')
    network.mockResolvedValueOnce(new Response('Live response', { status: 503 }))
    expect(await (await openOffline(path)).text()).toBe('Live response')
    network.mockResolvedValueOnce(new Response('Gone', { status: 404 }))
    expect((await openOffline('/s/code')).status).toBe(404)
    expect((await openOffline('/s/code')).status).toBe(503)
    expect((await openOffline(path)).status).toBe(503)
  })
})
