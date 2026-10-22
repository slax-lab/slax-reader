import { computed, ref, watch } from 'vue'

import {
  type AccountContext,
  accountSnapshot,
  accountSnapshotMatches,
  deriveAccountKey,
  isValidServerUserId,
  readAccountServerAlias,
  tokenFingerprint,
  writeAccountServerAlias
} from '~/utils/accountContext'
import { getTokenUserId } from '~/utils/sessionOwner'

export const useAccountContext = () => {
  const token = ref(getUserToken())
  const rawToken = computed(() => getUserToken())
  const tokenVersion = computed(() => tokenFingerprint(token.value))
  const accountKey = computed(() => deriveAccountKey(token.value))
  const sessionOwner = computed(() => getTokenUserId(token.value))
  const state = useState<Pick<AccountContext, 'serverUserId' | 'source' | 'status' | 'generation' | 'accountKey'> & { verifiedAccountKey: string | null }>(
    'account-context',
    () => ({
      accountKey: accountKey.value,
      serverUserId: readAccountServerAlias(accountKey.value),
      source: accountKey.value ? 'local' : null,
      status: accountKey.value ? 'local' : 'empty',
      generation: 0,
      verifiedAccountKey: null
    })
  )

  let observedTokenVersion = tokenVersion.value
  const sync = () => {
    const currentToken = getUserToken()
    if (currentToken !== token.value) token.value = currentToken
    const nextVersion = tokenVersion.value
    const nextKey = accountKey.value
    const nextOwner = sessionOwner.value
    if (nextVersion === observedTokenVersion && state.value.accountKey === nextKey) return
    observedTokenVersion = nextVersion
    state.value.accountKey = nextKey
    state.value.serverUserId = null
    state.value.verifiedAccountKey = null
    state.value.source = nextKey ? 'local' : null
    state.value.status = nextKey ? 'local' : 'empty'
    state.value.generation++
    void nextOwner
  }

  watch(
    rawToken,
    nextToken => {
      if (nextToken !== token.value) token.value = nextToken
    },
    { immediate: true }
  )

  watch(
    [tokenVersion, accountKey, sessionOwner],
    ([nextToken, nextKey], [previousToken, previousKey] = [null, null]) => {
      if (nextToken === previousToken && nextKey === previousKey) return
      sync()
    },
    { immediate: true }
  )

  const current = computed<AccountContext>(() => ({
    accountKey: state.value.accountKey,
    sessionOwner: sessionOwner.value,
    serverUserId: state.value.verifiedAccountKey === accountKey.value ? state.value.serverUserId : null,
    source: state.value.verifiedAccountKey === accountKey.value && state.value.serverUserId ? 'server' : state.value.accountKey ? 'local' : null,
    status:
      state.value.verifiedAccountKey === accountKey.value && state.value.serverUserId
        ? 'ready'
        : !state.value.accountKey
          ? 'empty'
          : state.value.status === 'stale'
            ? 'stale'
            : 'local',
    generation: state.value.generation
  }))

  const acceptServerUser = (userId: unknown, snapshot?: ReturnType<typeof accountSnapshot>) => {
    sync()
    const currentSnapshot = snapshot ?? accountSnapshot(token.value)
    if (!isValidServerUserId(userId) || !accountSnapshotMatches(currentSnapshot, token.value)) return false
    state.value.accountKey = currentSnapshot.accountKey
    state.value.serverUserId = userId
    state.value.verifiedAccountKey = currentSnapshot.accountKey
    state.value.source = 'server'
    state.value.status = 'ready'
    writeAccountServerAlias(currentSnapshot.accountKey, userId)
    return true
  }

  const invalidateServerUser = (snapshot?: ReturnType<typeof accountSnapshot>) => {
    sync()
    const currentSnapshot = snapshot ?? accountSnapshot(token.value)
    if (!accountSnapshotMatches(currentSnapshot, token.value)) return false
    state.value.serverUserId = null
    state.value.verifiedAccountKey = null
    state.value.source = state.value.accountKey ? 'local' : null
    state.value.status = state.value.accountKey ? 'local' : 'empty'
    state.value.generation++
    return true
  }

  return {
    context: current,
    accountKey,
    sessionOwner,
    token,
    acceptServerUser,
    invalidateServerUser,
    sync,
    snapshot: () => {
      sync()
      return accountSnapshot(token.value)
    }
  }
}
