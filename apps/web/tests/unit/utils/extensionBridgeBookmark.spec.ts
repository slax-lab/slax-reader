import { afterEach, describe, expect, it, vi } from 'vitest'
import { lookupExtensionReaderBookmark } from '~~/app/utils/extensionBridgeBookmark'

const session = vi.hoisted(() => vi.fn())
vi.mock('~~/app/utils/extensionBridgeSession', () => ({ requestExtensionBridgeSession: session }))
const token = (id: number) => `header.${btoa(JSON.stringify({ id }))}.signature`
const policy = { clientId: 'abcdefghijklmnopabcdefghijklmnop', configuredIds: new Set(['abcdefghijklmnopabcdefghijklmnop']), environment: 'production' }
const options = { apiBaseUrl: 'https://api.reader.test', targetUrl: 'https://reader.test/b/source', userKey: '1', getUserKey: () => '1', sessionPolicy: policy }
const saved = { exists: true, bookmark_uid: 'destination' }

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks() })

describe('Reader lookup inside the extension bridge', () => {
  it('uses the current extension session with no cookie dependency', async () => {
    session.mockResolvedValue(token(1))
    const fetcher = vi.fn().mockResolvedValue(Response.json({ code: 200, data: saved }))
    vi.stubGlobal('fetch', fetcher)
    await expect(lookupExtensionReaderBookmark(options)).resolves.toEqual(saved)
    expect(session).toHaveBeenCalledWith(policy)
    expect(fetcher).toHaveBeenCalledWith('https://api.reader.test/v1/bookmark/exists', expect.objectContaining({
      method: 'POST', credentials: 'omit', redirect: 'error',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token(1)}` },
      body: JSON.stringify({ target_url: options.targetUrl })
    }))
  })

  it.each([null, token(2), 'invalid'])('does not query using an absent or different account session', async value => {
    session.mockResolvedValue(value)
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    await expect(lookupExtensionReaderBookmark(options)).resolves.toBeNull()
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('discards the result if the database owner changes while the request is pending', async () => {
    session.mockResolvedValue(token(1))
    let owner = '1'
    vi.stubGlobal('fetch', vi.fn(async () => { owner = '2'; return Response.json({ code: 200, data: saved }) }))
    await expect(lookupExtensionReaderBookmark({ ...options, getUserKey: () => owner })).resolves.toBeNull()
  })

  it('returns an unavailable lookup on 401 without invoking ordinary Web login handling', async () => {
    session.mockResolvedValue(token(1))
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ code: 401 }, { status: 401 })))
    await expect(lookupExtensionReaderBookmark(options)).resolves.toBeNull()
  })
})
