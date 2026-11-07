import { describe, expect, test } from 'vitest'
import {
  addContribution,
  emptyPreferenceState,
  firstMissingEntry,
  nextPreferenceVersion,
  packEntries,
  packSum,
  preferenceCoverage,
  unpackEntries,
  unpackSum,
  vectorToken
} from '@/utils/preferenceLedger'
import { referenceCenter } from '../helpers/recommendationReference'

const spread = (seed: number) => Array.from({ length: 1024 }, (_, i) => Math.sin(seed + i * 0.37))

describe('preference ledger', () => {
  test('vector tokens are stable for identical Float32 values and change with any component', () => {
    const values = spread(1)
    expect(vectorToken(values)).toMatch(/^[0-9a-f]{16}$/)
    expect(vectorToken(Float32Array.from(values))).toBe(vectorToken(values))
    const changed = values.slice()
    changed[1023] += 0.001
    expect(vectorToken(changed)).not.toBe(vectorToken(values))
    expect(() => vectorToken(values.slice(1))).toThrow('invalid_vector_dimensions')
  })

  test('adding then subtracting a contribution returns the sums to their previous values', () => {
    const state = emptyPreferenceState('mean')
    addContribution(state, 'user-article', spread(1), 1)
    const before = [state.raw.slice(), state.centered.slice()]
    addContribution(state, 'user-article', spread(2), 2)
    addContribution(state, 'user-article', spread(2), -2)
    state.raw.forEach((value, i) => expect(value).toBeCloseTo(before[0][i], 12))
    state.centered.forEach((value, i) => expect(value).toBeCloseTo(before[1][i], 12))
  })

  test('user contributions add normalized and centered vectors; owner contributions only add normalized vectors', () => {
    const user = emptyPreferenceState('mean')
    const owner = emptyPreferenceState('mean')
    const values = spread(3)
    addContribution(user, 'user-article', values, 2)
    addContribution(owner, 'owner-collection', values, 1)
    const norm = Math.hypot(...values)
    const centered = referenceCenter(values.map(value => value / norm))
    user.raw.forEach((value, i) => expect(value).toBeCloseTo((2 * values[i]) / norm, 12))
    user.centered.forEach((value, i) => expect(value).toBeCloseTo(2 * centered[i], 12))
    expect(owner.centered.every(value => value === 0)).toBe(true)
  })

  test('entries and sums survive packing, and coverage counts pending entries as missing', () => {
    const entries = new Map([
      [42, { weight: 2, token: 'abcdef0123456789' }],
      [7, { weight: 1, token: '' }]
    ])
    expect([...unpackEntries(packEntries(entries))]).toEqual([
      [7, { weight: 1, token: '' }],
      [42, { weight: 2, token: 'abcdef0123456789' }]
    ])
    const sum = Float64Array.from(spread(4))
    expect([...unpackSum(packSum(sum))]).toEqual([...sum])
    expect(packSum(new Float64Array(1024))).toHaveLength(0)
    const state = { ...emptyPreferenceState('mean'), entries }
    expect(preferenceCoverage(state)).toEqual({ eligible: 2, used: 1, missing: 1 })
    expect(firstMissingEntry(state)).toBe(7)
  })

  test('invalid entries and corrupted blobs are rejected', () => {
    expect(() => packEntries(new Map([[0, { weight: 1, token: '' }]]))).toThrow('invalid_preference_entry')
    expect(() => packEntries(new Map([[1, { weight: 0, token: '' }]]))).toThrow('invalid_preference_entry')
    expect(() => packEntries(new Map([[1, { weight: 1, token: 'xyz' }]]))).toThrow('invalid_preference_entry')
    expect(() => unpackEntries(new Uint8Array(15))).toThrow('invalid_preference_state')
    expect(() => unpackSum(new Uint8Array(16))).toThrow('invalid_preference_state')
  })

  test('versions are strictly increasing even when the clock is behind', () => {
    const far = Date.now() + 10_000_000
    expect(nextPreferenceVersion(far)).toBe(far + 1)
    expect(nextPreferenceVersion(0)).toBeGreaterThanOrEqual(Date.now() - 1000)
  })
})
