import { canUseVisitorCache } from '../../../server/utils/shareCache'

import { describe, expect, it } from 'vitest'

describe('share visitor cache identity', () => {
  it('lets anonymous and known non-owner visitors use the visitor cache', () => {
    expect(canUseVisitorCache('', null)).toBe(true)
    expect(canUseVisitorCache('viewer-2', 'owner-1')).toBe(true)
  })

  it('keeps the owner out of the visitor cache', () => {
    expect(canUseVisitorCache('owner-1', 'owner-1')).toBe(false)
  })

  it('bypasses legacy visitor entries without an owner id for logged-in users', () => {
    expect(canUseVisitorCache('viewer-2', null)).toBe(false)
  })
})
