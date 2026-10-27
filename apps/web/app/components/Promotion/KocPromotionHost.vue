<template>
  <template
    v-if="
      active && (modalOpen || hasPromotionContext(state, route.query))
    "
  >
    <div v-if="state.phase === 'checking' || state.phase === 'resolving'" class="promotion-notice" role="status">{{ t('promotion.checking') }}</div>
    <div v-else-if="state.phase === 'error' || state.phase === 'deferred' || state.phase === 'unavailable' || state.phase === 'invalid'" class="promotion-notice" role="status">
      <span>{{ message }}</span>
      <button v-if="state.pending || state.phase === 'error'" type="button" @click="retry">{{ t(state.phase === 'deferred' ? 'promotion.resume' : 'promotion.retry') }}</button>
      <button v-if="state.phase === 'error'" type="button" @click="defer">{{ t('promotion.later') }}</button>
    </div>
    <GetSubscribeModal
      v-if="modalOpen"
      :key="modalKey"
      :sub-title="offerText"
      :confirm-text="t('promotion.claim')"
      :cancel-text="t('promotion.later')"
      :on-disposed-settlement="disposedSettlement"
      :activity_id="modalBlogger"
      activity_type="blogger"
      @outcome="outcome"
    />
  </template>
</template>
<script setup lang="ts">
import GetSubscribeModal from '~/components/GetSubscribeModal.vue'

import { readAccountServerAlias } from '~/utils/accountContext'
import { hasPromotionContext, isPromotionSurface, promotionLegacyStorageKey, promotionStorageKey } from '~/utils/promotionFlow'

import { useKocPromotionController } from '~/composables/promotion/useKocPromotionFlow'
const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const { flow, state, identify, refreshProfile, sessionIsCurrent, account } = useKocPromotionController()
const active = computed(() => isPromotionSurface(route.path))
const modalBlogger = ref('')
const modalKey = ref(0)
const modalOpen = ref(false)
const disposedSettlement = shallowRef<() => void>()
let submitting: { key: number; token: string | undefined; userId: number | null } | null = null
const submissionIsCurrent = () => submitting?.token === getUserToken() && submitting?.userId === state.value.userId
let syncing = false
let rerun = false
let storageChanged = false
let alive = true
let cleaning = false
let profileNeedsRefresh = false
let profileRefreshing = false
const refreshSubscription = async () => {
  profileNeedsRefresh = true
  if (profileRefreshing) return
  profileRefreshing = true
  try {
    while (alive && profileNeedsRefresh) {
      profileNeedsRefresh = false
      try {
        await refreshProfile()
      } catch {
        if (profileNeedsRefresh) continue
        profileNeedsRefresh = true
        break
      }
    }
  } finally {
    profileRefreshing = false
  }
}

const offerText = computed(() => {
  const reward = state.value.reward
  return reward?.kind === 'credit'
    ? t('promotion.credit', { amount: (reward.amount / 100).toFixed(2) })
    : reward?.kind === 'trial'
      ? t('promotion.trial', { days: reward.days })
      : t('promotion.legacy')
})
const message = computed(() =>
  t(
    state.value.phase === 'invalid'
      ? 'promotion.invalid'
      : state.value.phase === 'error'
        ? state.value.pending || route.query.activity_type === 'blogger'
          ? 'promotion.error'
          : 'promotion.identity_error'
        : state.value.phase === 'deferred'
          ? 'promotion.pending'
          : state.value.reason === 'already_received'
            ? 'promotion.received'
            : 'promotion.unavailable'
  )
)
const sync = async () => {
  if (syncing) {
    rerun = true
    return
  }
  if (!active.value || !alive) return
  syncing = true
  const fullPath = route.fullPath
  const query = { ...route.query }
  try {
    account.sync()
    if (!sessionIsCurrent()) modalOpen.value = false
    flow.setAccount(account.context.value.serverUserId, account.accountKey.value)
    // An explicit invitation is authoritative over any older stored invite.
    // Capture it before restoring the ordinary pending record so a slow legacy
    // validation cannot delay the URL the user just followed.
    if (query.activity_type === 'blogger') await flow.enter(query)
    else await flow.enter({})
    const hasContext = hasPromotionContext(state.value, query)
    if (!state.value.userId && getUserToken()) {
      if (hasContext) {
        if (!(await identify())) {
          if (state.value.pending) state.value.phase = 'error'
          return
        }
      } else {
        void identify().then(verified => {
          if (verified && alive && active.value) void sync()
        })
      }
    }
    if (hasContext && state.value.pending && state.value.phase === 'resolving') await flow.check()
    if (!alive || !active.value || route.fullPath !== fullPath) return
    // The request owns its attribution until settlement, even if its modal was disposed.
    if (submissionIsCurrent()) return
    if (['submitting', 'success'].includes(state.value.phase)) return
    if (storageChanged) {
      storageChanged = false
      // An explicit route remains authoritative over another tab's pending invite.
      await flow.restore(query)
    }
    // Reconcile storage before presenting or consuming this route's invitation.
    if (storageChanged) return
    if (!alive || !active.value || !sessionIsCurrent() || route.fullPath !== fullPath) return
    if (state.value.phase === 'offer' && !modalOpen.value && state.value.pending) {
      modalBlogger.value = state.value.pending.blogger
      modalKey.value++
      const key = modalKey.value
      const token = getUserToken()
      const userId = state.value.userId
      disposedSettlement.value = () => {
        if (!alive || submitting?.key !== key || token !== getUserToken() || userId !== state.value.userId || !sessionIsCurrent()) return
        submitting = null
        flow.invalidate()
        // Settlement can be success, failure, or a lost response. Recheck authority.
        void refreshSubscription()
        if (userId) postChannelMessage('subscription', { userId })
        void sync()
      }
      modalOpen.value = true
    }
    if (
      query.activity_type === 'blogger' &&
      state.value.pending?.blogger === query.activity_id &&
      state.value.durable &&
      !['submitting', 'success'].includes(state.value.phase)
    ) {
      const query = { ...route.query }
      for (const key of ['activity_id', 'activity_type', 'claim', 'koc_deferred']) delete query[key]
      cleaning = true
      try {
        await router.replace({ path: route.path, query, hash: route.hash })
      } finally {
        cleaning = false
      }
    }
  } finally {
    syncing = false
    if (rerun) {
      rerun = false
      void sync()
    }
  }
}
watch(
  () => state.value.phase,
  phase => {
    if (!['offer', 'submitting', 'success'].includes(phase)) modalOpen.value = false
  },
  { flush: 'sync' }
)
watch(
  () => getUserToken(),
  () => {
    modalOpen.value = false
    void sync()
  }
)
watch(
  () => route.fullPath,
  () => {
    if (!active.value) {
      modalOpen.value = false
      flow.invalidate()
    } else {
      if (syncing && !cleaning && !['submitting', 'success'].includes(state.value.phase)) flow.invalidate()
      void sync()
    }
  },
  { flush: 'sync' }
)
const retainFallback = async () => {
  if (active.value && state.value.pending && !state.value.durable)
    await router.replace({ path: route.path, query: { ...route.query, koc_deferred: undefined, ...flow.fallbackQuery() }, hash: route.hash })
}
const defer = async () => {
  flow.defer()
  await retainFallback()
}
const retry = async () => {
  if (await identify()) {
    await flow.resume()
    await retainFallback()
  }
  await sync()
}
const outcome = async (value: string) => {
  if (!sessionIsCurrent()) {
    modalOpen.value = false
    await sync()
    return
  }
  if (value === 'submitting') {
    submitting = { key: modalKey.value, token: getUserToken(), userId: state.value.userId }
    state.value.phase = 'submitting'
  } else if (value === 'failed') {
    submitting = null
    state.value.phase = 'offer'
    await sync()
  } else if (value === 'deferred') await defer()
  else if (value === 'unavailable') {
    submitting = null
    modalOpen.value = false
    await flow.check()
    await sync()
    void refreshSubscription()
  } else if (value === 'success') {
    submitting = null
    const userId = state.value.userId
    flow.granted()
    if (active.value && route.query.activity_type === 'blogger' && route.query.activity_id === modalBlogger.value) {
      const query = { ...route.query }
      for (const key of ['activity_id', 'activity_type', 'claim', 'koc_deferred']) delete query[key]
      await router.replace({ path: route.path, query, hash: route.hash })
    }
    postChannelMessage('subscription', { userId: userId! })
    void refreshSubscription()
  } else if (value === 'acknowledged') {
    modalOpen.value = false
    flow.acknowledge()
    await sync()
  }
}
const channel = (name: string, data: { subscription?: { userId: number } }) => {
  if (name !== 'subscription' || data.subscription?.userId !== state.value.userId) return
  void refreshSubscription()
  if (!submissionIsCurrent() && !['submitting', 'success'].includes(state.value.phase)) void flow.check().then(sync)
}
const focus = () => {
  void sync().then(() => {
    if (profileNeedsRefresh) void refreshSubscription()
  })
}
const storage = (event: StorageEvent) => {
  const legacyId = state.value.userId ?? readAccountServerAlias(account.accountKey.value)
  const keys = [account.accountKey.value ? promotionStorageKey(account.accountKey.value) : null, legacyId ? promotionLegacyStorageKey(legacyId) : null].filter(
    (key): key is string => !!key
  )
  if ((event.key === null || keys.includes(event.key)) && sessionIsCurrent()) {
    storageChanged = true
    if (route.query.activity_type !== 'blogger' && !['submitting', 'success'].includes(state.value.phase)) flow.invalidate()
    void sync()
  }
}
onMounted(() => {
  for (const key of ['activity_claimed_blogger', 'activity_claimed_platform_0527']) {
    try {
      localStorage.removeItem(key)
    } catch {}
  }
  addChannelMessageHandler(channel)
  window.addEventListener('focus', focus)
  window.addEventListener('storage', storage)
  void sync()
})
onUnmounted(() => {
  alive = false
  flow.invalidate()
  removeChannelMessageHandler(channel)
  window.removeEventListener('focus', focus)
  window.removeEventListener('storage', storage)
})
</script>
<style scoped>
.promotion-notice {
  position: fixed;
  z-index: 90;
  bottom: max(16px, env(safe-area-inset-bottom));
  left: 50%;
  transform: translateX(-50%);
  width: min(560px, calc(100vw - 32px));
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  padding: 16px;
  border: 1px solid var(--slax-border);
  border-radius: var(--slax-radius);
  background: var(--slax-surface-solid);
  color: var(--slax-text);
  box-shadow: var(--slax-shadow-warm);
  font-size: var(--slax-fs-body);
}
.promotion-notice span {
  flex: 1 1 200px;
}
button {
  padding: 8px 12px;
  border: 1px solid var(--slax-border);
  border-radius: var(--slax-radius-sm);
  background: var(--slax-surface);
  color: var(--slax-accent);
  cursor: pointer;
}
button:focus-visible {
  outline: 2px solid var(--slax-accent);
  outline-offset: 2px;
}
</style>
