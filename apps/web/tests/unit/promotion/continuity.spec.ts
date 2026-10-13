import { describe, expect, it, vi } from 'vitest'
import { createPromotionFlow, initialPromotionState, parsePromotionStatus } from '~~/app/utils/promotionFlow'
import { reactive } from 'vue'

function setup(storage = new Map<string, string>()) {
  const state = reactive(initialPromotionState())
  const flow = createPromotionFlow(state, {
    storage: () => ({
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => {
        storage.set(k, v)
      },
      removeItem: (k: string) => {
        storage.delete(k)
      }
    }),
    validate: async id => (id === 'daguang' || id === 'lenyy' ? id : null),
    status: async () => ({ status: false, reason: 'eligible', reward: { kind: 'trial', days: 60 } })
  })
  return { state, flow, storage }
}
const invite = { activity_id: 'daguang', activity_type: 'blogger', claim: 'true' }

describe('KOC continuity', () => {
  it('preserves a deferred KOC across onboarding and document reconstruction without the ordinary campaign', async () => {
    const first = setup()
    first.flow.setAccount(7)
    await first.flow.enter(invite)
    expect(first.state.phase).toBe('offer')
    first.flow.defer()
    const next = setup(first.storage)
    next.flow.setAccount(7)
    await next.flow.enter({})
    expect(next.state.pending?.blogger).toBe('daguang')
    expect(next.state.phase).toBe('deferred')
  })
  it('reconciles a fresh invitation on the cached root route and deduplicates cleanup', async () => {
    const { flow, state } = setup()
    flow.setAccount(7)
    await flow.enter({})
    await flow.enter(invite)
    expect(state.phase).toBe('offer')
    await flow.enter({})
    expect(state.phase).toBe('offer')
    flow.defer()
    await flow.enter({ ...invite, activity_id: 'lenyy' })
    expect(state.pending?.blogger).toBe('lenyy')
    expect(state.phase).toBe('offer')
  })
  it('never restores another account invitation', async () => {
    const { flow, state } = setup()
    flow.setAccount(7)
    await flow.enter(invite)
    flow.setAccount(8)
    await flow.enter({})
    expect(state.pending).toBeNull()
    expect(state.phase).toBe('idle')
  })
  it('preserves URL fallback and deferral when storage is denied', async () => {
    const state = reactive(initialPromotionState())
    const flow = createPromotionFlow(state, {
      storage: () => {
        throw Error('denied')
      },
      validate: async id => id,
      status: async () => ({ status: false })
    })
    flow.setAccount(7)
    await flow.enter(invite)
    flow.defer()
    expect(flow.fallbackQuery()).toMatchObject({ ...invite, koc_deferred: 'true' })
    await flow.enter(flow.fallbackQuery())
    expect(state.phase).toBe('deferred')
  })
  it('rejects late results from a prior account', async () => {
    let resolve!: (v: string) => void
    const state = reactive(initialPromotionState())
    const flow = createPromotionFlow(state, {
      storage: () => localStorage,
      validate: () =>
        new Promise(r => {
          resolve = r
        }),
      status: async () => ({ status: false })
    })
    flow.setAccount(7)
    const pending = flow.enter(invite)
    flow.setAccount(8)
    resolve('daguang')
    await pending
    expect(state.pending).toBeNull()
    expect(state.userId).toBe(8)
  })
  it('does not persist an unvalidated invitation after a transport failure and Later', async () => {
    const state = reactive(initialPromotionState())
    const storage = new Map<string, string>()
    const flow = createPromotionFlow(state, {
      storage: () => ({
        getItem: k => storage.get(k) ?? null,
        setItem: (k, v) => {
          storage.set(k, v)
        },
        removeItem: k => {
          storage.delete(k)
        }
      }),
      validate: async () => {
        throw Error('offline')
      },
      status: async () => ({ status: false })
    })
    flow.setAccount(7)
    await flow.enter(invite)
    flow.defer()
    expect(storage.size).toBe(0)
    expect(flow.fallbackQuery()).toMatchObject({ activity_id: 'daguang', koc_deferred: 'true' })
  })
  it('invalidates old results even when resetting an unresolved account', async () => {
    const { flow, state } = setup()
    flow.setAccount(null)
    expect(state.phase).toBe('resolving')
  })
  it.each([undefined, {}, { status: false, reason: 'already_received' }, { status: true, reason: 'eligible' }, { status: false, reward: { kind: 'trial', days: -1 } }])(
    'never treats malformed %j as eligible',
    input => {
      expect(() => parsePromotionStatus(input)).toThrow()
    }
  )
  it('distinguishes legacy unavailable from permanent receipt', () => {
    expect(parsePromotionStatus({ status: true }).reason).toBe('unknown')
    expect(parsePromotionStatus({ status: true, reason: 'already_received' }).reason).toBe('already_received')
  })
})

it('retains temporary Apple exclusion and can later recheck as eligible', async () => {
  const state = reactive(initialPromotionState())
  const status = vi.fn().mockResolvedValueOnce({ status: true, reason: 'active_apple_subscription' }).mockResolvedValueOnce({ status: false })
  const flow = createPromotionFlow(state, { storage: () => localStorage, validate: async id => id, status })
  flow.setAccount(76)
  await flow.enter(invite)
  expect(state.phase).toBe('unavailable')
  expect(state.pending?.deferred).toBe(true)
  await flow.resume()
  expect(state.phase).toBe('offer')
})
it('does not delete a newer invitation stored by another tab on confirmed success', async () => {
  const { flow, storage } = setup()
  flow.setAccount(7)
  await flow.enter(invite)
  const newer = JSON.stringify({ version: 1, blogger: 'lenyy', capturedAt: Date.now() + 100, deferred: true })
  storage.set('slax_koc_pending_v1_7', newer)
  flow.granted()
  expect(storage.get('slax_koc_pending_v1_7')).toBe(newer)
})
it('restores another tab deferral and ignores other account records and corrupt JSON', async () => {
  const { flow, state, storage } = setup()
  flow.setAccount(7)
  await flow.enter(invite)
  storage.set('slax_koc_pending_v1_7', JSON.stringify({ version: 1, blogger: 'lenyy', capturedAt: 1, deferred: true }))
  await flow.restore()
  expect(state.pending?.blogger).toBe('lenyy')
  expect(state.phase).toBe('deferred')
  storage.set('slax_koc_pending_v1_7', '{bad JSON')
  await flow.restore()
  expect(state.phase).toBe('idle')
  expect(state.pending).toBeNull()
})
