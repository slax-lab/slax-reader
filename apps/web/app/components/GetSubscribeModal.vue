<template>
  <div class="receive-modal" :class="{ appear }" @click="closeModal">
    <Transition name="modal">
      <div ref="dialog" class="modal-content" v-show="appear" role="dialog" aria-modal="true" aria-labelledby="promotion-title" tabindex="-1" @keydown="onKeydown" @click.stop>
        <!-- 标准 modal-header -->
        <div class="modal-header">
          <span id="promotion-title" class="modal-title">{{ t('common.app.name') }}</span>
          <button class="modal-close" type="button" @click="closeModal" :disabled="loading" :aria-label="props.cancelText">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <!-- 内容区 -->
        <div class="modal-body">
          <Transition name="fade">
            <div class="form-state" v-if="!success">
              <p class="modal-message">{{ props.subTitle }}</p>

              <div v-if="turnstileEnabled" class="turnstile-wrap">
                <NuxtTurnstile
                  :key="turnstileKey"
                  ref="turnstileRef"
                  v-model="turnstileToken"
                  :options="{ theme: 'auto', appearance: 'always', size: narrowScreen ? 'compact' : 'flexible' }"
                />
              </div>

              <div class="modal-actions">
                <button class="btn-cancel" type="button" :disabled="loading" @click="closeModal">
                  {{ props.cancelText }}
                </button>
                <button
                  class="btn-confirm"
                  type="button"
                  :disabled="loading || (turnstileEnabled && !turnstileToken)"
                  :class="{ 'btn-confirm--loading': loading }"
                  @click="handleConfirm"
                >
                  <span v-if="!loading">{{ props.confirmText }}</span>
                  <span v-else class="btn-spinner" />
                </button>
              </div>
            </div>
          </Transition>

          <Transition name="fade">
            <div class="success-state" v-if="success">
              <h1 class="success-title">{{ receiveResult.title }}</h1>
              <p class="success-message">{{ receiveResult.message }}</p>
              <p v-if="receiveResult.subMessage" class="success-sub">{{ receiveResult.subMessage }}</p>
              <button class="btn-confirm success-continue" type="button" @click="closeModal">{{ t('promotion.continue') }}</button>
            </div>
          </Transition>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script lang="ts" setup>
import { RESTMethodPath } from '@slax-reader/contracts/const'
import Toast, { ToastType } from '~/components/Toast'

const emits = defineEmits<{
  dismiss: [success: boolean]
  outcome: [value: 'submitting' | 'success' | 'acknowledged' | 'deferred' | 'unavailable' | 'failed']
}>()
const props = defineProps<{
  subTitle: string
  confirmText: string
  cancelText: string
  activity_id: string
  activity_type: string
  onDisposedSettlement?: () => void
}>()
const { t } = useI18n()
const isLocked = useScrollLock(document.body)
const success = ref(false)
const appear = ref(false)
const loading = ref(false)
const dialog = ref<HTMLElement>()
const turnstileToken = ref('')
const turnstileKey = ref(0)
const turnstileRef = ref()
const narrowScreen = useMediaQuery('(max-width: 400px)')
const turnstileEnabled = Boolean(useRuntimeConfig().public.TURNSTILE_SITE_KEY)
const receiveResult = ref({ message: '', title: '', subMessage: '' })
const previousFocus = document.activeElement as HTMLElement | null
const originalToken = getUserToken()
let alive = true
isLocked.value = true
onMounted(async () => {
  appear.value = true
  await nextTick()
  dialog.value?.focus()
})
onUnmounted(() => {
  alive = false
  isLocked.value = false
  previousFocus?.isConnected && previousFocus.focus()
})
const closeModal = () => {
  if (loading.value) return
  emits('outcome', success.value ? 'acknowledged' : 'deferred')
  emits('dismiss', success.value)
}
const onKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Escape') {
    event.preventDefault()
    closeModal()
  }
  if (event.key !== 'Tab') return
  const items = Array.from(dialog.value?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), iframe, [tabindex="0"]') ?? [])
  const first = items[0],
    last = items.at(-1)
  if (!first) {
    event.preventDefault()
    return
  }
  if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.value)) {
    event.preventDefault()
    last?.focus()
  } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog.value)) {
    event.preventDefault()
    first.focus()
  }
}
const handleConfirm = async () => {
  if (loading.value || success.value || (turnstileEnabled && !turnstileToken.value)) return
  if (getUserToken() !== originalToken) {
    emits('outcome', 'unavailable')
    return
  }
  loading.value = true
  const reconcileAfterDisposal = props.onDisposedSettlement
  emits('outcome', 'submitting')
  try {
    const result = await request().post<{ title: string; message: string; subMessage: string }>({
      url: RESTMethodPath.PROMOTION_RECEIVE,
      body: { turnstile_token: turnstileToken.value, activity_id: props.activity_id, activity_type: props.activity_type },
      signal: AbortSignal.timeout(20000),
      errorInterceptors() {
        /* The owner reconciles unavailable results; failures stay retryable. */
      }
    })
    if (!alive || getUserToken() !== originalToken) return
    if (!result || typeof result.title !== 'string' || typeof result.message !== 'string') throw Error('Missing grant confirmation')
    receiveResult.value = { ...result, subMessage: result.subMessage || '' }
    success.value = true
    emits('outcome', 'success')
    await nextTick()
    dialog.value?.querySelector<HTMLElement>('.success-continue')?.focus()
  } catch (error) {
    if (!alive || getUserToken() !== originalToken) return
    if (error instanceof Error && error.name === 'RECEIVE_ACTIVITY_ALREADY_RECEIVED') emits('outcome', 'unavailable')
    else {
      emits('outcome', 'failed')
      Toast.showToast({ text: t('component.subscribe.receive_result_error'), type: ToastType.Error })
    }
    turnstileToken.value = ''
    turnstileKey.value++
  } finally {
    if (alive) loading.value = false
    // Component events stop after disposal; the owner may still need to refresh.
    else if (getUserToken() === originalToken) reconcileAfterDisposal?.()
  }
}
</script>

<style lang="scss" scoped>
/* ── Overlay ── */
.receive-modal {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  transition: background var(--slax-dur-normal);

  &.appear {
    background: color-mix(in srgb, var(--slax-text) 22%, transparent);
    backdrop-filter: blur(8px);
  }
}

/* ── Modal shell ── */
.modal-content {
  position: relative;
  width: min(480px, 92vw);
  max-height: 92vh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  background: var(--slax-surface-solid);
  border: 1px solid var(--slax-border);
  border-radius: var(--slax-radius);
  box-shadow:
    var(--slax-shadow-warm),
    0 24px 64px color-mix(in srgb, var(--slax-accent) 16%, transparent),
    inset 0 1px 0 var(--slax-inset-hi);
  user-select: none;
}

/* ── Header ── */
.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 24px;
  border-bottom: 1px solid var(--slax-border);
  flex-shrink: 0;
}

.modal-title {
  font-family: var(--slax-font-serif);
  font-size: var(--slax-fs-card);
  font-weight: 500;
  color: var(--slax-text);
  letter-spacing: -0.01em;
}

.modal-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  background: transparent;
  border: none;
  border-radius: var(--slax-radius-sm);
  color: var(--slax-text-light);
  cursor: pointer;
  flex-shrink: 0;
  transition: all var(--slax-dur-normal);

  &:hover {
    background: var(--slax-surface);
    color: var(--slax-text);
  }
}

/* ── Body ── */
.modal-body {
  flex: 1;
  overflow-y: auto;
  position: relative;
}

/* ── Form state ── */
.form-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 32px 28px 28px;
}

.modal-message {
  font-family: var(--slax-font-serif);
  font-size: var(--slax-fs-card);
  font-weight: 500;
  color: var(--slax-text);
  line-height: 1.65;
  text-align: center;
  white-space: pre-line;
  margin-bottom: 28px;
}

.turnstile-wrap {
  display: flex;
  justify-content: center;
  margin-bottom: 24px;
  min-height: 65px;
  min-width: 0;
  width: 100%;

  & > div {
    min-height: 65px !important;
    min-width: 0;
    display: block !important;
    visibility: visible !important;
  }
}

.modal-actions {
  display: flex;
  gap: 12px;
  width: 100%;
}

.btn-cancel {
  flex: 1;
  padding: 11px 16px;
  font-family: inherit;
  font-size: var(--slax-fs-aux);
  font-weight: 500;
  color: var(--slax-text-muted);
  background: var(--slax-surface);
  border: 1px solid var(--slax-border);
  border-radius: var(--slax-radius-sm);
  cursor: pointer;
  transition: all var(--slax-dur-normal);

  &:hover:not(:disabled) {
    background: var(--slax-accent-bg);
    color: var(--slax-text);
    border-color: var(--slax-accent);
  }

  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
}

.btn-confirm {
  flex: 2;
  padding: 11px 16px;
  font-family: inherit;
  font-size: var(--slax-fs-aux);
  font-weight: 500;
  color: var(--slax-btn-text);
  background: var(--slax-accent);
  border: 1px solid var(--slax-accent);
  border-radius: var(--slax-radius-sm);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all var(--slax-dur-normal);

  &:hover:not(:disabled) {
    opacity: 0.92;
    transform: translateY(-1px);
    box-shadow: 0 4px 16px color-mix(in srgb, var(--slax-accent) 30%, transparent);
  }

  &:active {
    transform: translateY(0);
    opacity: 1;
  }

  &:disabled,
  &.btn-confirm--loading {
    opacity: 0.55;
    cursor: not-allowed;
    transform: none;
    box-shadow: none;
  }
}

.btn-spinner {
  display: block;
  width: 16px;
  height: 16px;
  border: 2px solid var(--slax-btn-text);
  border-top-color: transparent;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}

/* ── Success state ── */
.success-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px 28px 40px;
  min-height: 280px;
}

.success-title {
  font-family: var(--slax-font-serif);
  font-size: 36px;
  font-weight: 700;
  color: var(--slax-accent);
  letter-spacing: -0.02em;
  text-align: center;
  margin-bottom: 12px;
}

.success-message {
  font-size: var(--slax-fs-body);
  font-weight: 400;
  color: var(--slax-text);
  text-align: center;
  white-space: pre-line;
  max-width: 380px;
  line-height: 1.65;
}

.success-sub {
  margin-top: 12px;
  font-size: var(--slax-fs-aux);
  color: var(--slax-text-light);
  text-align: center;
  white-space: pre-line;
  max-width: 380px;
  line-height: 1.6;
}

/* ── Modal transition ── */
.modal-leave-to,
.modal-enter-from {
  opacity: 0;
  transform: translateY(-20px) scale(0.97);
}

.modal-enter-active,
.modal-leave-active {
  transition:
    opacity 0.22s ease,
    transform 0.22s cubic-bezier(0.16, 1, 0.3, 1);
}

/* ── Fade transition (form/success swap) ── */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
  position: absolute;
  inset: 0;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

/* ── Spin keyframe ── */
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>

<style scoped>
.success-continue {
  margin-top: 24px;
}
button:focus-visible {
  outline: 2px solid var(--slax-accent);
  outline-offset: 3px;
}
@media (prefers-reduced-motion: reduce) {
  .receive-modal,
  .modal-content,
  .success-state {
    animation: none;
    transition: none;
  }
}
</style>
