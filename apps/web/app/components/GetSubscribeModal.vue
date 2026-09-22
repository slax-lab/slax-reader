<template>
  <div class="receive-modal" :class="{ appear }" @click="closeModal">
    <Transition name="modal">
      <div class="modal-content" v-show="appear" @click.stop>
        <!-- 标准 modal-header -->
        <div class="modal-header">
          <span class="modal-title">{{ t('common.app.name') }}</span>
          <button class="modal-close" type="button" @click="closeModal" aria-label="close">
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
                <NuxtTurnstile :key="turnstileKey" ref="turnstileRef" v-model="turnstileToken" :options="{ theme: 'auto', appearance: 'always' }" />
              </div>

              <div class="modal-actions">
                <button class="btn-cancel" type="button" :disabled="loading" @click="closeModal">
                  {{ props.cancelText }}
                </button>
                <button class="btn-confirm" type="button" :disabled="loading || (turnstileEnabled && !turnstileToken)" :class="{ 'btn-confirm--loading': loading }" @click="handleConfirm">
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
            </div>
          </Transition>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script lang="ts" setup>
import { fireworks, pride, star } from '@/components/PaymentModal/confetti'
import { RESTMethodPath } from '@commons/contracts/const'
import Toast, { ToastType } from '~/components/Toast'

const emits = defineEmits(['close', 'dismiss', 'confirm'])
const isLocked = useScrollLock(window)
const success = ref(false)
const appear = ref(false)
const loading = ref(false)
const turnstileToken = ref('')
const receiveResult = ref({
  message: '',
  title: '',
  subMessage: ''
})
const turnstileRef = ref()
const turnstileKey = ref(0)
const turnstileEnabled = Boolean(useRuntimeConfig().public.TURNSTILE_SITE_KEY)

const props = defineProps<{
  subTitle: string
  confirmText: string
  cancelText: string
  activity_id: string
  activity_type: string
}>()

isLocked.value = true

onMounted(() => {
  setTimeout(() => {
    appear.value = true
  })
})

const handleConfirm = async () => {
  if (turnstileEnabled && !turnstileToken.value) {
    return
  }

  loading.value = true

  request()
    .post<{ message: string; title: string; subMessage: string }>({
      url: RESTMethodPath.PROMOTION_RECEIVE,
      body: {
        turnstile_token: turnstileToken.value,
        activity_id: props.activity_id,
        activity_type: props.activity_type
      },
      errorInterceptors(error) {
        if (error instanceof Error && error.name === 'RECEIVE_ACTIVITY_ALREADY_RECEIVED') {
          window.location.reload()
        } else {
          Toast.showToast({
            text: t('component.subscribe.receive_result_error'),
            type: ToastType.Error
          })
        }
      }
    })
    .then(res => {
      if (!res) {
        Toast.showToast({
          text: t('component.subscribe.receive_result_error'),
          type: ToastType.Error
        })

        return
      }
      receiveResult.value = res
      success.value = true
      playConfetti()

      setTimeout(() => {
        if (!appear.value) {
          return
        }

        postChannelMessage('refresh', { type: 'page' })
        window.location.reload()
      }, 3500)
    })
    .catch(e => {
      console.log(e)
    })
    .finally(() => {
      loading.value = false
    })
}

const playConfetti = () => {
  const randSeed = Math.floor(Math.random() * 100) % 3
  const duration = 3000

  if (randSeed === 0) {
    star(duration)
  } else if (randSeed === 1) {
    fireworks(duration)
  } else {
    pride(duration)
  }
}

onUnmounted(() => {
  offloadTurnstile()
})

const closeModal = () => {
  emits('dismiss', success.value)
}

const t = (text: string) => {
  return useNuxtApp().$i18n.t(text)
}

const offloadTurnstile = () => {
  const turnstileApi = 'turnstile/v0/api'
  const head = document.head
  const link = head.querySelector(`link[href*="${turnstileApi}"]`)
  const script = head.querySelector(`script[src*="${turnstileApi}"]`)
  link?.remove()
  script?.remove()
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
    -webkit-backdrop-filter: blur(8px);
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
  min-width: 300px;
  width: 100%;

  & > div {
    min-height: 65px !important;
    min-width: 300px !important;
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
  --style: animate-bounce-in;
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

/* ── Bounce-in (success icon) ── */
@keyframes bounce-in {
  0% {
    transform: scale(0.7);
    opacity: 0;
  }
  60% {
    transform: scale(1.05);
  }
  100% {
    transform: scale(1);
    opacity: 1;
  }
}

.animate-bounce-in {
  animation: bounce-in 0.5s cubic-bezier(0.16, 1, 0.3, 1);
}
</style>
