import { canTakeOverSnapshotLocally, type SnapshotTakeoverFacts } from '~/local-first/snapshot-local-takeover'
import { describe, expect, it, vi } from 'vitest'

const owner = (overrides: Partial<SnapshotTakeoverFacts> = {}): SnapshotTakeoverFacts => ({
  isOwner: true,
  startedGeneration: 1,
  currentGeneration: 1,
  tokenOwner: 'user-a',
  databaseOwner: 'user-a',
  existsLocally: async () => true,
  ...overrides
})

describe('deferred snapshot local takeover', () => {
  it('allows the verified owner whose bookmark exists locally', async () => {
    await expect(canTakeOverSnapshotLocally(() => owner())).resolves.toBe(true)
  })

  it.each([
    ['a visitor', { isOwner: false }],
    ['an account changed before the wait finished', { currentGeneration: 2 }],
    ['a database owned by another account', { databaseOwner: 'user-b' }],
    ['a database whose ownership was never established', { databaseOwner: null }],
    ['an unreadable token', { tokenOwner: null, databaseOwner: null }],
    ['a bookmark missing locally', { existsLocally: async () => false }],
    ['a failing local lookup', { existsLocally: async () => { throw new Error('closed') } }]
  ] as const)('refuses %s', async (_label, overrides) => {
    await expect(canTakeOverSnapshotLocally(() => owner(overrides as Partial<SnapshotTakeoverFacts>))).resolves.toBe(false)
  })

  it('does not look up a visitor bookmark locally', async () => {
    const existsLocally = vi.fn(async () => true)
    await canTakeOverSnapshotLocally(() => owner({ isOwner: false, existsLocally }))
    expect(existsLocally).not.toHaveBeenCalled()
  })

  it('re-checks ownership after the local lookup', async () => {
    let generation = 1
    const facts = () => owner({ currentGeneration: generation, existsLocally: async () => { generation = 2; return true } })
    await expect(canTakeOverSnapshotLocally(facts)).resolves.toBe(false)
  })

  it('re-checks the database owner after the local lookup', async () => {
    let databaseOwner = 'user-a'
    const facts = () => owner({ databaseOwner, existsLocally: async () => { databaseOwner = 'user-b'; return true } })
    await expect(canTakeOverSnapshotLocally(facts)).resolves.toBe(false)
  })
})
