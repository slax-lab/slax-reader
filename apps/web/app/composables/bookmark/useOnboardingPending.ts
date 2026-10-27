import { computed, type ComputedRef, onMounted, onUnmounted, type Ref, toValue, watch } from 'vue'

import { type AccountContext,readAccountServerAlias } from '~/utils/accountContext'

type Flags = { pending: boolean; dismissed: boolean }
type Input = Ref<AccountContext | number | undefined> | ComputedRef<AccountContext | number | undefined> | AccountContext | number | undefined

const v2PendingKey = (accountKey: string) => `slax_onboarding_pending_v2_${accountKey}`
const v2DismissedKey = (accountKey: string) => `slax_onboarding_dismissed_v2_${accountKey}`
const legacyPendingKey = (id: number) => `slax_onboarding_pending_${id}`
const legacyDismissedKey = (id: number) => `slax_onboarding_dismissed_${id}`

const readBoolean = (key: string) => localStorage.getItem(key) === 'true'

export const useOnboardingPending = (input: Input) => {
  const states = useState<Record<string, Flags>>('onboarding-flags', () => ({}))
  const value = computed(() => toValue(input as Ref<AccountContext | number | undefined>))
  const accountKey = computed(() => (value.value && typeof value.value === 'object' ? value.value.accountKey : null))
  const serverUserId = computed(() => {
    if (typeof value.value === 'number') return value.value
    return value.value?.serverUserId ?? readAccountServerAlias(value.value?.accountKey ?? null)
  })
  const legacyId = computed(() => (typeof value.value === 'number' ? value.value : serverUserId.value))
  const storageKey = computed(() => (accountKey.value ? `account:${accountKey.value}` : legacyId.value ? `legacy:${legacyId.value}` : null))

  const read = () => {
    const key = storageKey.value
    if (!key) return
    let flags: Flags = { pending: false, dismissed: false }
    try {
      const modernDismissed = accountKey.value ? readBoolean(v2DismissedKey(accountKey.value)) : false
      const modernPending = accountKey.value ? readBoolean(v2PendingKey(accountKey.value)) : false
      const legacyDismissed = legacyId.value ? readBoolean(legacyDismissedKey(legacyId.value)) : false
      const legacyPending = legacyId.value ? readBoolean(legacyPendingKey(legacyId.value)) : false
      flags.dismissed = modernDismissed || legacyDismissed
      flags.pending = !flags.dismissed && (modernPending || legacyPending)
      if (flags.dismissed) {
        if (accountKey.value) {
          try {
            localStorage.removeItem(v2PendingKey(accountKey.value))
          } catch {}
        }
        if (legacyId.value) {
          try {
            localStorage.removeItem(legacyPendingKey(legacyId.value))
          } catch {}
        }
      }
      if (accountKey.value && legacyId.value) {
        if (flags.dismissed) localStorage.setItem(v2DismissedKey(accountKey.value), 'true')
        if (flags.pending) localStorage.setItem(v2PendingKey(accountKey.value), 'true')
      }
    } catch {
      flags = states.value[key] ?? flags
    }
    states.value[key] = flags
  }

  watch([accountKey, legacyId], read, { immediate: true, flush: 'sync' })
  const current = computed(() => {
    const key = storageKey.value
    return key ? states.value[key] : undefined
  })
  const update = (flags: Flags) => {
    const key = storageKey.value
    if (!key) return
    states.value[key] = flags
    try {
      if (accountKey.value) {
        if (flags.dismissed) localStorage.setItem(v2DismissedKey(accountKey.value), 'true')
        else localStorage.removeItem(v2DismissedKey(accountKey.value))
        if (flags.pending) localStorage.setItem(v2PendingKey(accountKey.value), 'true')
        else localStorage.removeItem(v2PendingKey(accountKey.value))
      }
      if (legacyId.value) {
        if (flags.dismissed) localStorage.setItem(legacyDismissedKey(legacyId.value), 'true')
        else localStorage.removeItem(legacyDismissedKey(legacyId.value))
        if (flags.pending) localStorage.setItem(legacyPendingKey(legacyId.value), 'true')
        else localStorage.removeItem(legacyPendingKey(legacyId.value))
      }
    } catch {
      /* Same-document state still prevents loops when storage is denied. */
    }
  }
  const onStorage = (event: StorageEvent) => {
    const keys = [
      ...(accountKey.value ? [v2PendingKey(accountKey.value), v2DismissedKey(accountKey.value)] : []),
      ...(legacyId.value ? [legacyPendingKey(legacyId.value), legacyDismissedKey(legacyId.value)] : [])
    ]
    if (!event.key || keys.includes(event.key)) read()
  }
  onMounted(() => window.addEventListener('storage', onStorage))
  onUnmounted(() => window.removeEventListener('storage', onStorage))
  return {
    isPending: computed(() => current.value?.pending ?? false),
    isDismissed: computed(() => current.value?.dismissed ?? false),
    setPending: () => {
      if (!current.value?.dismissed) update({ pending: true, dismissed: false })
    },
    clearPending: () => update({ pending: false, dismissed: current.value?.dismissed ?? false }),
    setDismissed: () => update({ pending: false, dismissed: true })
  }
}
