import { hasPromotionContext, initialPromotionState, promotionBlocksOnboarding } from '~~/app/utils/promotionFlow'

import { describe, expect, it } from 'vitest'

describe('promotion failure context', () => {
  it('does not block ordinary onboarding after local promotion restoration resolves', () => {
    const state = { ...initialPromotionState(), phase: 'error' as const, contextResolved: true }
    expect(hasPromotionContext(state, {})).toBe(false)
    expect(promotionBlocksOnboarding(state, false, true)).toBe(false)
  })

  it('blocks while restoration is unresolved to protect a pending invite', () => {
    const state = { ...initialPromotionState(), phase: 'resolving' as const, contextResolved: false }
    expect(promotionBlocksOnboarding(state, false, false)).toBe(true)
  })

  it('keeps explicit and pending promotion journeys blocking', () => {
    const state = { ...initialPromotionState(), phase: 'error' as const, pending: { version: 1 as const, blogger: 'daguang', capturedAt: 1, deferred: false }, contextResolved: true }
    expect(hasPromotionContext(state, {})).toBe(true)
    expect(promotionBlocksOnboarding(state, true, true)).toBe(true)
    expect(hasPromotionContext(state, { activity_type: 'blogger', activity_id: 'daguang' })).toBe(true)
  })
})
