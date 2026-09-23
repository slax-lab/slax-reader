import { createConnector, fetchSyncCredentials } from '~~/app/local-first/connector'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const CREDS_STORAGE_KEY = 'slax:powersync:creds'
const jwtWithExp = (exp: number) => `header.${btoa(JSON.stringify({ exp }))}.signature`

afterEach(() => {
  vi.restoreAllMocks()
})

beforeEach(() => {
  localStorage.clear()
})

describe('PowerSync connector credentials', () => {
  it('drops rejected cached credentials and fetches a fresh token', async () => {
    localStorage.setItem(
      CREDS_STORAGE_KEY,
      JSON.stringify({ token: 'stale-token', endpoint: 'https://old.powersync.test', expMs: Date.now() + 60 * 60_000 })
    )
    const fetchToken = vi.fn(async () => ({ token: 'fresh-token', endpoint: 'https://new.powersync.test' }))
    const connector = createConnector({ fetchToken, uploadChanges: vi.fn() })

    await expect(connector.fetchCredentials()).resolves.toEqual({
      token: 'stale-token',
      endpoint: 'https://old.powersync.test'
    })
    expect(fetchToken).not.toHaveBeenCalled()

    connector.invalidateCredentials()

    await expect(connector.fetchCredentials()).resolves.toEqual({
      token: 'fresh-token',
      endpoint: 'https://new.powersync.test'
    })
    expect(fetchToken).toHaveBeenCalledOnce()
  })

  it('observes credentials invalidated by another tab', async () => {
    localStorage.setItem(
      CREDS_STORAGE_KEY,
      JSON.stringify({ token: 'shared-token', endpoint: 'https://powersync.test', expMs: Date.now() + 60 * 60_000 })
    )
    const fetchToken = vi.fn(async () => ({ token: 'replacement-token', endpoint: 'https://powersync.test' }))
    const connector = createConnector({ fetchToken, uploadChanges: vi.fn() })

    await connector.fetchCredentials()
    localStorage.removeItem(CREDS_STORAGE_KEY)
    await expect(connector.fetchCredentials()).resolves.toEqual({
      token: 'replacement-token',
      endpoint: 'https://powersync.test'
    })
    expect(fetchToken).toHaveBeenCalledOnce()
  })
})

describe('PowerSync login credentials', () => {
  it('makes no request when the login token is empty', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')

    await expect(fetchSyncCredentials({ baseUrl: 'https://api.test', authToken: '', onUnauthorized: vi.fn() })).resolves.toEqual({ token: '', endpoint: '' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('stops requesting after a 401 clears a rejected token', async () => {
    let authToken: string | undefined = jwtWithExp(Math.floor(Date.now() / 1000) + 60)
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 401 }))
    const getCredentials = () =>
      fetchSyncCredentials({
        baseUrl: 'https://api.test',
        authToken,
        onUnauthorized: () => {
          authToken = undefined
        }
      })

    await expect(getCredentials()).resolves.toEqual({ token: '', endpoint: '' })
    await expect(getCredentials()).resolves.toEqual({ token: '', endpoint: '' })
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('never requests with an expired JWT, including after an extension bridge remount', async () => {
    const expiredToken = jwtWithExp(Math.floor(Date.now() / 1000) - 60)
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    const onUnauthorized = vi.fn()

    await fetchSyncCredentials({ baseUrl: 'https://api.test', authToken: expiredToken, onUnauthorized })
    // The extension can inject the same stale token again after recreating its iframe.
    await fetchSyncCredentials({ baseUrl: 'https://api.test', authToken: expiredToken, onUnauthorized })

    expect(fetchMock).not.toHaveBeenCalled()
    expect(onUnauthorized).toHaveBeenCalledTimes(2)
  })

  it('still requests normally with a valid JWT', async () => {
    const validToken = jwtWithExp(Math.floor(Date.now() / 1000) + 60)
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: { token: 'sync-token', endpoint: 'https://powersync.test' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    )
    const onUnauthorized = vi.fn()

    await expect(fetchSyncCredentials({ baseUrl: 'https://api.test/', authToken: validToken, onUnauthorized })).resolves.toEqual({
      token: 'sync-token',
      endpoint: 'https://powersync.test'
    })
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(onUnauthorized).not.toHaveBeenCalled()
  })

  it('coalesces concurrent retries for the same rejected token', async () => {
    let authToken: string | undefined = jwtWithExp(Math.floor(Date.now() / 1000) + 60)
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 401 }))
    const connector = createConnector({
      fetchToken: () =>
        fetchSyncCredentials({
          baseUrl: 'https://api.test',
          authToken,
          onUnauthorized: () => {
            authToken = undefined
          }
        }),
      uploadChanges: vi.fn()
    })

    await Promise.all([connector.fetchCredentials(), connector.fetchCredentials(), connector.fetchCredentials()])
    await connector.fetchCredentials()

    expect(fetchMock).toHaveBeenCalledOnce()
  })
})
