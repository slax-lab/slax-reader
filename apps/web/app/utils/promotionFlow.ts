import type { PromotionReward } from '@slax-reader/contracts/interface'

export type PromotionPhase = 'resolving' | 'idle' | 'checking' | 'offer' | 'submitting' | 'success' | 'deferred' | 'unavailable' | 'error' | 'invalid'
export interface PendingPromotion {
  version: 1
  blogger: string
  capturedAt: number
  deferred: boolean
}
export interface PromotionState {
  userId: number | null
  sessionOwner: string | null
  pending: PendingPromotion | null
  phase: PromotionPhase
  durable: boolean
  reward?: PromotionReward
  reason?: string
  intent?: string
}
export const initialPromotionState = (): PromotionState => ({
  userId: null,
  sessionOwner: null,
  pending: null,
  phase: 'resolving',
  durable: false,
  reward: undefined,
  reason: undefined,
  intent: undefined
})
export const isPromotionSurface = (path: string) => ['/', '/bookmarks', '/onboarding'].includes(path)
export const promotionIntent = (query: Record<string, unknown>) => JSON.stringify([query.activity_id, query.koc_deferred === 'true'])
export const isInboxPath = (path: string) => path === '/' || path === '/bookmarks'
export const promotionBlocksOnboarding = (state: PromotionState) => ['resolving', 'checking', 'offer', 'submitting', 'success', 'error'].includes(state.phase)
export const promotionStorageKey = (id: number) => `slax_koc_pending_v1_${id}`
const validBlogger = (id: unknown): id is string => typeof id === 'string' && /^[a-z0-9_]{1,80}$/.test(id)
export function parsePromotionStatus(value: unknown): { reason: string; reward?: PromotionReward } {
  const v = value as Record<string, unknown> | null
  if (!v || typeof v.status !== 'boolean') throw Error('Invalid promotion status')
  const reason = v.reason ?? (v.status ? 'unknown' : 'eligible')
  if (!['eligible', 'already_received', 'active_apple_subscription', 'unknown'].includes(String(reason)) || (v.status ? reason === 'eligible' : reason !== 'eligible'))
    throw Error('Conflicting promotion status')
  const reward = v.reward as PromotionReward | undefined
  if (
    reward &&
    (v.status ||
      !(
        (reward.kind === 'trial' && Number.isSafeInteger(reward.days) && reward.days > 0) ||
        (reward.kind === 'credit' && Number.isSafeInteger(reward.amount) && reward.amount > 0 && reward.currency === 'usd')
      ))
  )
    throw Error('Invalid promotion reward')
  return { reason: String(reason), reward }
}
interface Dependencies {
  storage: () => Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
  validate: (blogger: string) => Promise<string | null>
  status: () => Promise<unknown>
}
export function createPromotionFlow(state: PromotionState, deps: Dependencies) {
  let generation = 0
  let loaded = false
  let validated = false
  const save = () => {
    if (!state.userId || !state.pending || !validated) return
    try {
      deps.storage().setItem(promotionStorageKey(state.userId), JSON.stringify(state.pending))
      state.durable = true
    } catch {
      state.durable = false
    }
  }
  const clear = () => {
    if (state.userId) {
      try {
        const key = promotionStorageKey(state.userId)
        const raw = deps.storage().getItem(key)
        const stored = raw ? JSON.parse(raw) : null
        if (!stored || (stored.capturedAt === state.pending?.capturedAt && stored.blogger === state.pending?.blogger)) deps.storage().removeItem(key)
      } catch {
        /* Server status remains authoritative on restore. */
      }
    }
    state.pending = null
    state.durable = false
  }
  const setAccount = (id: number | null) => {
    if (id === state.userId) return
    generation++
    loaded = false
    validated = false
    Object.assign(state, initialPromotionState(), { userId: id })
  }
  const check = async () => {
    if (!state.pending || !state.userId) return
    const seq = ++generation
    const deferred = state.pending.deferred
    state.phase = deferred ? 'deferred' : 'checking'
    try {
      const canonical = await deps.validate(state.pending.blogger)
      if (seq !== generation) return
      if (!canonical) {
        clear()
        state.phase = 'invalid'
        return
      }
      validated = true
      state.pending.blogger = canonical
      save()
      const result = parsePromotionStatus(await deps.status())
      if (seq !== generation) return
      state.reward = result.reward
      state.reason = result.reason
      if (result.reason === 'already_received') {
        clear()
        state.phase = 'unavailable'
      } else if (result.reason !== 'eligible') {
        state.pending!.deferred = true
        save()
        state.phase = 'unavailable'
      } else state.phase = state.pending!.deferred ? 'deferred' : 'offer'
    } catch {
      if (seq === generation) state.phase = state.pending?.deferred ? 'deferred' : 'error'
    }
  }
  const enter = async (query: Record<string, unknown>) => {
    if (!state.userId || state.phase === 'submitting' || state.phase === 'success') return
    const explicit = query.activity_type === 'blogger'
    if (explicit) {
      state.intent = promotionIntent(query)
      if (!validBlogger(query.activity_id)) {
        generation++
        clear()
        state.phase = 'invalid'
        return
      }
      const deferred = query.koc_deferred === 'true'
      if (state.pending?.blogger === query.activity_id && state.pending.deferred === deferred && loaded) return
      state.pending = { version: 1, blogger: query.activity_id, capturedAt: Date.now(), deferred }
      state.durable = false
      validated = false
      loaded = true
      await check()
      return
    }
    if (loaded) return
    loaded = true
    try {
      const raw = deps.storage().getItem(promotionStorageKey(state.userId))
      const value = raw ? (JSON.parse(raw) as PendingPromotion) : null
      if (value?.version === 1 && validBlogger(value.blogger) && typeof value.deferred === 'boolean' && Number.isFinite(value.capturedAt)) {
        state.pending = value
        state.durable = true
      }
    } catch {
      state.durable = false
    }
    if (state.pending) await check()
    else state.phase = 'idle'
  }
  const defer = () => {
    if (state.phase === 'submitting' || state.phase === 'success') return
    generation++
    if (state.pending) {
      state.pending.deferred = true
      save()
    }
    state.phase = state.pending ? 'deferred' : 'idle'
  }
  const resume = async () => {
    if (!state.pending || state.phase === 'submitting') return
    state.pending.deferred = false
    save()
    await check()
  }
  const granted = () => {
    generation++
    clear()
    state.phase = 'success'
  }
  const fallbackQuery = (): Record<string, string> =>
    state.pending && !state.durable
      ? {
          activity_id: state.pending.blogger,
          activity_type: 'blogger',
          claim: 'true',
          ...(state.pending.deferred ? { koc_deferred: 'true' } : {})
        }
      : {}
  const restore = async (query: Record<string, unknown> = {}) => {
    if (['submitting', 'success'].includes(state.phase)) return
    if (query.activity_type === 'blogger') {
      await enter(query)
      // Reassert the explicit invite without recapturing it on every storage event.
      save()
      return
    }
    generation++
    loaded = false
    validated = false
    state.pending = null
    state.durable = false
    await enter({})
  }
  return {
    setAccount,
    enter,
    check,
    restore,
    defer,
    resume,
    granted,
    fallbackQuery,
    acknowledge: () => {
      state.phase = 'idle'
    },
    invalidate: () => {
      generation++
      loaded = false
      if (state.phase === 'submitting') state.phase = 'checking'
      if (state.phase === 'success') state.phase = 'idle'
    }
  }
}
