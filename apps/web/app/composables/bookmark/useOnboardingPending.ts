import { computed, type ComputedRef, onMounted, onUnmounted,type Ref, toValue, watch } from 'vue'

type Flags = { pending: boolean; dismissed: boolean }
const pendingKey = (id: number) => `slax_onboarding_pending_${id}`
const dismissedKey = (id: number) => `slax_onboarding_dismissed_${id}`

export const useOnboardingPending = (userId: Ref<number | undefined> | ComputedRef<number | undefined>) => {
  const states = useState<Record<number, Flags>>('onboarding-flags', () => ({}))
  const id = computed(() => toValue(userId))
  const read = (value: number) => {
    let flags: Flags = { pending: false, dismissed: false }
    try {
      flags.dismissed = localStorage.getItem(dismissedKey(value)) === 'true'
      flags.pending = !flags.dismissed && localStorage.getItem(pendingKey(value)) === 'true'
      if (flags.dismissed) localStorage.removeItem(pendingKey(value))
    } catch {
      flags = states.value[value] ?? flags
    }
    states.value[value] = flags
  }
  watch(
    id,
    value => {
      if (value && !states.value[value]) read(value)
    },
    { immediate: true, flush: 'sync' }
  )
  const current = computed(() => (id.value ? states.value[id.value] : undefined))
  const update = (flags: Flags) => {
    const value = id.value
    if (!value) return
    states.value[value] = flags
    try {
      if (flags.dismissed) localStorage.setItem(dismissedKey(value), 'true')
      if (flags.pending) localStorage.setItem(pendingKey(value), 'true')
      else localStorage.removeItem(pendingKey(value))
    } catch {
      /* Same-document state still prevents loops when storage is denied. */
    }
  }
  const onStorage = (event: StorageEvent) => {
    const value = id.value
    if (value && (!event.key || [pendingKey(value), dismissedKey(value)].includes(event.key))) read(value)
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
