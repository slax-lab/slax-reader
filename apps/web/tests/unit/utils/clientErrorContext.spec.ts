import { recentHostTiming } from '~~/app/utils/clientErrorContext'

import { afterEach, describe, expect, it, vi } from 'vitest'

const original = performance.getEntriesByType
afterEach(() => {
  performance.getEntriesByType = original
})

describe('recentHostTiming', () => {
  it('uses the most recent entry for the host and keeps the handshake phases', () => {
    performance.getEntriesByType = vi.fn(() => [
      {
        name: 'https://api.test/old',
        startTime: 1,
        domainLookupStart: 0,
        domainLookupEnd: 5,
        connectStart: 5,
        connectEnd: 25,
        secureConnectionStart: 10,
        requestStart: 25,
        responseStart: 45,
        nextHopProtocol: 'h2'
      },
      {
        name: 'https://api.test/new',
        startTime: 10,
        domainLookupStart: 10,
        domainLookupEnd: 12,
        connectStart: 12,
        connectEnd: 32,
        secureConnectionStart: 18,
        requestStart: 32,
        responseStart: 60,
        nextHopProtocol: 'h3'
      },
      {
        name: 'https://other.test/x',
        startTime: 99,
        domainLookupStart: 0,
        domainLookupEnd: 1,
        connectStart: 1,
        connectEnd: 2,
        secureConnectionStart: 0,
        requestStart: 2,
        responseStart: 3,
        nextHopProtocol: 'h2'
      }
    ]) as never
    expect(recentHostTiming('api.test')).toEqual({ dns_ms: 2, tcp_ms: 6, tls_ms: 14, ttfb_ms: 28, protocol: 'h3' })
  })

  it('omits a host without entries', () => {
    performance.getEntriesByType = vi.fn(() => []) as never
    expect(recentHostTiming('api.test')).toBeUndefined()
  })
  it('ignores entries without a response and failed responses', () => {
    const base = { domainLookupStart: 0, domainLookupEnd: 3, connectStart: 3, connectEnd: 9, secureConnectionStart: 5, requestStart: 9, nextHopProtocol: 'h2' }
    performance.getEntriesByType = vi.fn(() => [
      { ...base, name: 'https://api.test/ok', startTime: 1, responseStart: 20, responseStatus: 200 },
      { ...base, name: 'https://api.test/500', startTime: 5, responseStart: 30, responseStatus: 500 },
      { ...base, name: 'https://api.test/dropped', startTime: 9, responseStart: 0 }
    ]) as never
    expect(recentHostTiming('api.test')).toMatchObject({ ttfb_ms: 11 })
  })
})
