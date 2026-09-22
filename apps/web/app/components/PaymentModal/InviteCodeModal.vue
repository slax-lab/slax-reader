<template>
  <div class="invitecode-modal" :class="{ appear }">
    <Transition name="modal" @after-leave="onAfterLeave">
      <div class="modal-content" v-show="appear" @click.stop>
        <!-- 标准 modal-header -->
        <div class="modal-header">
          <span class="modal-title">{{ t('common.app.name') }} {{ t('common.app.pro_token') }}</span>
          <button v-if="!invitecodeSuccess" class="modal-close" type="button" @click="closeModal" aria-label="close">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <!-- 内容区 -->
        <div class="modal-body">
          <Transition name="fade">
            <div class="redeem-state" v-if="!invitecodeSuccess">
              <div class="input-wrap">
                <input
                  v-autofocus="{ enabled: appear }"
                  v-ime-guard
                  type="text"
                  class="redeem-input"
                  v-model="redeemCode"
                  v-on-key-stroke:Enter="[onKeyDown, { eventName: 'keydown' }]"
                  :placeholder="t('component.payment.redeem_placeholder')"
                />
              </div>
              <div class="redeem-actions">
                <template v-if="!isLoading">
                  <button class="redeem-submit" type="button" :disabled="redeemCode.length === 0" @click="submitClick">
                    {{ t('common.operate.use') }}
                  </button>
                </template>
                <div class="i-svg-spinners:180-ring-with-bg text-18px" style="color: var(--slax-accent)" v-else></div>
              </div>
            </div>
          </Transition>

          <Transition name="fade">
            <div class="success-state" v-if="invitecodeSuccess">
              <h1 class="success-title">{{ t('component.payment.successful') }}</h1>
              <p class="success-desc">{{ t('component.payment.subscribe_successful') }}</p>
            </div>
          </Transition>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script lang="ts" setup>
import { fireworks, pride, star } from './confetti'
import { RESTMethodPath } from '@commons/types'
import { vOnKeyStroke } from '@vueuse/components'
import Toast, { ToastType } from '~/components/Toast'

const emits = defineEmits(['close', 'dismiss'])
const isLocked = useScrollLock(window)
const invitecodeSuccess = ref(false)
const appear = ref(false)
const redeemCode = ref('')
const isLoading = ref(false)

isLocked.value = true

watch(
  () => invitecodeSuccess.value,
  value => {
    if (value) {
      const randSeed = Math.floor(Math.random() * 100) % 3
      const duration = 3000

      if (randSeed === 0) {
        star(duration)
      } else if (randSeed === 1) {
        fireworks(duration)
      } else {
        pride(duration)
      }

      setTimeout(() => {
        closeModal()
      }, duration + 250)
    }
  }
)

onMounted(() => {
  setTimeout(() => {
    appear.value = true
  })
})

const closeModal = () => {
  appear.value = false
}

const onAfterLeave = () => {
  isLocked.value = false
  emits('dismiss', invitecodeSuccess.value)
}

const t = (text: string) => {
  return useNuxtApp().$i18n.t(text)
}

const subscribeRedeem = async () => {
  isLoading.value = true

  try {
    await request().post({
      url: RESTMethodPath.SUBSCRIBE_REDEEM,
      body: {
        code: redeemCode.value
      },
      errorInterceptors: error => {
        Toast.showToast({
          text: t('common.tips.invalid_invite_code'),
          type: ToastType.Error
        })
      }
    })

    success()
  } catch (e) {
    console.error(e)
    isLoading.value = false
  }

  isLoading.value = false
}

const onKeyDown = (e: KeyboardEvent) => {
  if (e.key !== 'Enter') {
    return
  }

  submitClick()
}

const success = () => {
  invitecodeSuccess.value = true
}

const submitClick = () => {
  if (!redeemCode.value) {
    return
  }

  subscribeRedeem()
}
</script>

<style lang="scss" scoped>
/* ── Overlay ── */
.invitecode-modal {
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
  width: min(420px, 92vw);
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
  min-height: 160px;
}

/* ── Redeem state ── */
.redeem-state {
  padding: 28px 24px 24px;
  display: flex;
  flex-direction: column;
}

.input-wrap {
  display: flex;
  align-items: center;
  height: 48px;
  padding: 0 14px;
  background: var(--slax-surface);
  border: 1px solid var(--slax-border);
  border-radius: var(--slax-radius-sm);
  transition: border-color var(--slax-dur-normal);

  &:focus-within {
    border-color: var(--slax-accent);
    box-shadow: 0 0 0 3px var(--slax-accent-bg);
  }
}

.redeem-input {
  min-width: 0;
  width: 100%;
  background: transparent;
  border: none;
  outline: none;
  font-size: var(--slax-fs-body);
  font-weight: 500;
  color: var(--slax-text);
  line-height: 1.4;
  font-family: inherit;

  &::placeholder {
    color: var(--slax-text-light);
    font-weight: 400;
  }
}

.redeem-actions {
  margin-top: 20px;
  display: flex;
  justify-content: flex-end;
  align-items: center;
}

.redeem-submit {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 88px;
  height: 40px;
  padding: 0 20px;
  background: var(--slax-accent);
  color: var(--slax-btn-text);
  border: none;
  border-radius: var(--slax-radius-sm);
  font-size: var(--slax-fs-aux);
  font-weight: 500;
  font-family: inherit;
  cursor: pointer;
  transition: all var(--slax-dur-normal);

  &:hover:not(:disabled) {
    opacity: 0.92;
    transform: translateY(-1px);
  }

  &:active:not(:disabled) {
    transform: translateY(0);
    opacity: 1;
  }

  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
}

/* ── Success state ── */
.success-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px 24px 40px;
  min-height: 240px;
  --style: animate-bounce-in;
}

.success-title {
  font-family: var(--slax-font-serif);
  font-size: 44px;
  font-weight: 700;
  color: var(--slax-accent);
  letter-spacing: -0.02em;
  text-align: center;
}

.success-desc {
  margin-top: 12px;
  font-size: var(--slax-fs-body);
  font-weight: 400;
  color: var(--slax-text-muted);
  text-align: center;
}

/* ── Fade (redeem ↔ success swap) ── */
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
</style>
