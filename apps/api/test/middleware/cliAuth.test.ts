import { describe, test, expect } from 'vitest'
import { isApiKeyRouteAllowed } from '@/middleware/cliAuth'

describe('isApiKeyRouteAllowed', () => {
  test('allows existing CLI routes', () => {
    expect(isApiKeyRouteAllowed('/v1/bookmark/list', 'GET')).toBe(true)
    expect(isApiKeyRouteAllowed('/v1/bookmark/metadata', 'GET')).toBe(true)
    expect(isApiKeyRouteAllowed('/v1/bookmark/add_url', 'POST')).toBe(true)
  })

  test('allows the new bookmark action routes', () => {
    expect(isApiKeyRouteAllowed('/v1/bookmark/archive', 'POST')).toBe(true)
    expect(isApiKeyRouteAllowed('/v1/bookmark/star', 'POST')).toBe(true)
    expect(isApiKeyRouteAllowed('/v1/bookmark/del', 'POST')).toBe(true)
    expect(isApiKeyRouteAllowed('/v1/bookmark/trash', 'POST')).toBe(true)
    expect(isApiKeyRouteAllowed('/v1/bookmark/trash_revert', 'POST')).toBe(true)
  })

  test('rejects the wrong method on an allowed path', () => {
    expect(isApiKeyRouteAllowed('/v1/bookmark/archive', 'GET')).toBe(false)
  })

  test('rejects unknown routes', () => {
    expect(isApiKeyRouteAllowed('/v1/bookmark/unknown', 'POST')).toBe(false)
  })
})
