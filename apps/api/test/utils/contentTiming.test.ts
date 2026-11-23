import { afterEach, describe, expect, test, vi } from 'vitest'
import { ContentTiming } from '@/utils/contentTiming'
import { EDGE_RAY_ID_HEADER } from '@/const/edge'

afterEach(() => vi.restoreAllMocks())

describe('ContentTiming', () => {
  test('correlates entry and response without logging request data', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const request = new Request('https://content.internal/content/meta?uuid=private-bookmark', {
      headers: { 'CF-Ray': 'a5d3eb265913dd65-HKG', Authorization: 'Bearer private-token' }
    })

    const timing = new ContentTiming('edge', request)
    timing.log({ 'core-fetch': 41 }, 200)

    const entry = info.mock.calls[0][1]
    expect(info.mock.calls[0][0]).toBe('content.timing')
    expect(entry).toMatchObject({ scope: 'edge', phase: 'entry', ray_id: 'a5d3eb265913dd65-HKG' })
    expect(entry.instance_id).toEqual(expect.any(String))
    expect(entry.request_number).toEqual(expect.any(Number))
    expect(info.mock.calls[1]).toEqual(['content.timing', {
      ...entry, phase: 'response', status_code: 200, outcome: 'returned',
      total_ms: expect.any(Number), phases_ms: { 'core-fetch': 41 }
    }])
    expect(JSON.stringify(info.mock.calls)).not.toMatch(/private-bookmark|private-token|Authorization|content.internal/)
  })

  test('retains the module identity and advances the observed metadata counter', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    new ContentTiming('core', new Request('https://content.internal/content/meta'))
    new ContentTiming('core', new Request('https://content.internal/content/meta'))
    expect(info.mock.calls[1][1].instance_id).toBe(info.mock.calls[0][1].instance_id)
    expect(info.mock.calls[1][1].request_number).toBe(info.mock.calls[0][1].request_number + 1)
  })

  test('uses the existing forwarded Ray and represents a missing Ray explicitly', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    new ContentTiming('core', new Request('https://content.internal/content/meta', {
      headers: { [EDGE_RAY_ID_HEADER]: 'outer-ray', 'CF-Ray': 'subrequest-ray' }
    }))
    new ContentTiming('core', new Request('https://content.internal/content/meta'))
    expect(info.mock.calls[0][1].ray_id).toBe('outer-ray')
    expect(info.mock.calls[1][1].ray_id).toBeNull()
  })

  test('records an unfinished binding failure without inventing a response status', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const timing = new ContentTiming('edge', new Request('https://content.internal/content/meta'))
    timing.log({ 'core-fetch': 52 })
    expect(info.mock.calls[1][1]).toMatchObject({ phase: 'response', outcome: 'failed', phases_ms: { 'core-fetch': 52 } })
    expect(info.mock.calls[1][1]).not.toHaveProperty('status_code')
  })
})
