import { FetchRequest, RequestError } from '@commons/frontend-utils/request'
import { afterEach, describe, expect, it, vi } from 'vitest'

const originalFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('FetchRequest failure observer', () => {
  it('reports a 5xx with status and Ray ID', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: 500, message: 'boom', data: 'SERVER_ERROR' }), { status: 500, headers: { 'cf-ray': '8f2c' } }))
    const failures: unknown[] = []
    const request = new FetchRequest({ baseUrl: 'https://api.test', onFailure: failure => failures.push(failure) })
    await expect(request.get({ url: '/v1/x?secret=1' })).rejects.toThrow('boom')
    expect(failures).toEqual([expect.objectContaining({ method: 'get', url: '/v1/x?secret=1', status: 500, ray: '8f2c', network: false, cancelled: false })])
  })

  it('reports a network failure without a response', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    const failures: unknown[] = []
    const request = new FetchRequest({ baseUrl: 'https://api.test', onFailure: failure => failures.push(failure) })
    await expect(request.get({ url: '/v1/x' })).rejects.toThrow('Failed to fetch')
    expect(failures).toEqual([expect.objectContaining({ status: undefined, ray: undefined, network: true, cancelled: false })])
  })

  it('keeps the original error for a non-JSON error page and still reports its status and Ray ID', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('<html>502 Bad Gateway</html>', { status: 502, headers: { 'cf-ray': '9a1b-SIN' } }))
    const failures: unknown[] = []
    const request = new FetchRequest({ baseUrl: 'https://api.test', onFailure: failure => failures.push(failure) })
    await expect(request.get({ url: '/v1/x' })).rejects.toBeInstanceOf(SyntaxError)
    expect(failures).toEqual([expect.objectContaining({ status: 502, ray: '9a1b-SIN', network: false })])
  })

  it('keeps the backend error fields unchanged', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: 40001, message: 'bad', data: 'ERROR_PARAM' }), { status: 400 }))
    const request = new FetchRequest({ baseUrl: 'https://api.test', onFailure: () => {} })
    const error = await request.get({ url: '/v1/x' }).catch(e => e)
    expect(error).toBeInstanceOf(RequestError)
    expect({ name: error.name, code: error.code, message: error.message }).toEqual({ name: 'ERROR_PARAM', code: 40001, message: 'bad' })
    expect(Object.keys(error)).not.toContain('status')
  })

  it('never lets a throwing observer change the request outcome', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    const request = new FetchRequest({
      baseUrl: 'https://api.test',
      onFailure: () => {
        throw new Error('observer broke')
      }
    })
    await expect(request.get({ url: '/v1/x' })).rejects.toThrow('Failed to fetch')
  })

  it('reads the status and Ray ID from a response a subclass threw with', async () => {
    class Throwing extends FetchRequest {
      override async fetchRequest(): Promise<Response> {
        const response = new Response('down', { status: 503, headers: { 'cf-ray': 'abc-HKG' } })
        throw Object.defineProperty(new RequestError({ code: 503, name: 'UNAUTHORIZED', message: 'down' }), 'response', { value: response, enumerable: false })
      }
    }
    const failures: unknown[] = []
    const request = new Throwing({ baseUrl: 'https://api.test', onFailure: failure => failures.push(failure) })
    await expect(request.stream({ url: '/v1/x' })).rejects.toBeInstanceOf(RequestError)
    expect(failures).toEqual([expect.objectContaining({ status: 503, ray: 'abc-HKG', network: false })])
  })

  it('marks an abort as cancelled', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' }))
    const failures: unknown[] = []
    const request = new FetchRequest({ baseUrl: 'https://api.test', onFailure: failure => failures.push(failure) })
    await expect(request.get({ url: '/v1/x' })).rejects.toThrow('aborted')
    expect(failures).toEqual([expect.objectContaining({ cancelled: true })])
  })
})
