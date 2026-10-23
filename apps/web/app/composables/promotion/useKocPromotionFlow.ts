import { computed } from 'vue'

import { AccountLocaleStaleError } from '~/utils/accountLocaleRequest'
import { createPromotionFlow, hasPromotionContext, initialPromotionState, promotionBlocksOnboarding, promotionIntent } from '~/utils/promotionFlow'
import { getTokenUserId } from '~/utils/sessionOwner'

import { RESTMethodPath } from '@slax-reader/contracts/const'
import { useAccountContext } from '~/composables/useAccountContext'
import { useUserStore } from '~/stores/user'

export const useKocPromotionFlow = () => {
  const state = useState('koc-promotion', initialPromotionState)
  const route = useRoute()
  const account = useAccountContext()
  return {
    state,
    blocksOnboarding: computed(() => {
      const context = hasPromotionContext(state.value, route.query)
      return promotionBlocksOnboarding(state.value, context, state.value.contextResolved) || (route.query.activity_type === 'blogger' && state.value.intent !== promotionIntent(route.query))
    }),
    userId: computed(() => state.value.userId ?? undefined),
    account,
    returnTarget: (path: '/' | '/onboarding') => ({
      path,
      query:
        state.value.pending && !state.value.durable
          ? {
              activity_id: state.value.pending.blogger,
              activity_type: 'blogger',
              claim: 'true',
              ...(state.value.pending.deferred ? { koc_deferred: 'true' } : {})
            }
          : {}
    })
  }
}

/** One layout host owns effects; pages only read the shared serializable state. */
export const useKocPromotionController = () => {
  const { state } = useKocPromotionFlow()
  const account = useAccountContext()
  const config = useRuntimeConfig()
  const userStore = useUserStore()
  let session: string | undefined = getUserToken()
  let identityGeneration = 0
  const api = async <T>(path: string, body?: unknown, query = ''): Promise<T> => {
    const token = getUserToken()
    if (!token) throw Error('Missing session')
    const response = await fetch(`${config.public.DWEB_API_BASE_URL}${path}${query}`, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json', ...getClientEventHeaders(), Authorization: `Bearer ${token}` },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(10000)
    })
    const result = (await response.json()) as { data: T; status?: number }
    if (token !== getUserToken()) throw Error('Session changed')
    if (!response.ok) {
      const error = new Error('Promotion request failed')
      error.name = typeof result.data === 'string' ? result.data : 'PROMOTION_REQUEST_FAILED'
      throw error
    }
    return result.data
  }
  const flow = createPromotionFlow(state.value, {
    storage: () => localStorage,
    validate: async blogger => {
      try {
        const result = await api<{ activity_id: string; activity_type: string }>(RESTMethodPath.PROMOTION_BLOGGER_INFO, undefined, `?blogger=${encodeURIComponent(blogger)}`)
        if (result?.activity_type !== 'blogger' || typeof result.activity_id !== 'string') throw Error('Invalid blogger response')
        return result.activity_id
      } catch (error) {
        if (error instanceof Error && error.name === 'ERROR_PARAM') return null
        throw error
      }
    },
    status: () => api(RESTMethodPath.PROMOTION_CHECK_RECEIVE, { activity_type: 'blogger' })
  })
  const refreshProfile = async () => {
    const current = getUserToken()
    const generation = identityGeneration
    const signal = AbortSignal.timeout(10000)
    const read = () => userStore.refreshServerUserInfo(signal)
    const profile = await read().catch(error => {
      // A concurrent page refresh can supersede the identity read. Retry once
      // within the same deadline/session rather than accepting a cached profile.
      if (error instanceof AccountLocaleStaleError && generation === identityGeneration && current === getUserToken()) return read()
      throw error
    })
    if (generation !== identityGeneration || current !== getUserToken() || !Number.isSafeInteger(profile?.userId) || profile.userId <= 0) throw Error('Unverified identity')
    account.acceptServerUser(profile.userId, account.snapshot())
    flow.setAccount(profile.userId, account.accountKey.value)
    // The API profile ID and the JWT owner use different Hashid contexts.
    // Bind the local owner only after this session's server read succeeds.
    state.value.sessionOwner = getTokenUserId(current)
    return profile
  }
  const identify = async () => {
    const token = getUserToken() as string | undefined
    if (token === session && state.value.userId && account.context.value.status === 'ready' && account.context.value.serverUserId === state.value.userId) return true
    session = token
    const generation = ++identityGeneration
    flow.invalidate()
    flow.setAccount(null, account.accountKey.value)
    state.value.phase = 'resolving'
    if (!token) {
      state.value.phase = 'idle'
      return false
    }
    try {
      await refreshProfile()
      return generation === identityGeneration
    } catch {
      if (generation === identityGeneration) state.value.phase = state.value.pending ? 'error' : 'idle'
      return false
    }
  }
  return {
    flow,
    state,
    identify,
    refreshProfile,
    sessionIsCurrent: () => {
      const token = getUserToken()
      if (!token || session !== token) return false
      if (state.value.userId === null) return true
      return session === token && account.context.value.status === 'ready' && account.context.value.serverUserId === state.value.userId
    },
    account
  }
}
