<template>
  <div class="payment-modal" :class="{ appear }">
    <Transition name="modal" @after-leave="onAfterLeave">
      <div class="modal-content" v-show="appear" @click.stop>
        <!-- 标准 modal-header：标题左 + 关闭右，border-bottom 分隔 -->
        <div class="modal-header">
          <span class="modal-title">{{ t('common.app.name') }} {{ t('common.app.pro_token') }}</span>
          <button v-if="!paymentSuccess" class="modal-close" type="button" @click="closeModal" aria-label="close">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <!-- 内容区 -->
        <div class="modal-body">
          <Transition name="opacity">
            <PlanPayment v-show="!paymentSuccess" @success="success" :type="props.type" :priceId="props.priceId" />
          </Transition>
          <Transition name="opacity">
            <div class="success-state" v-show="paymentSuccess">
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
import PlanPayment from '@/components/PlanPayment.vue'

import { fireworks, pride, star } from './confetti'
const emits = defineEmits(['close', 'dismiss'])
const isLocked = useScrollLock(window)
const paymentSuccess = ref(false)
const appear = ref(false)

const props = defineProps({
  type: {
    type: String
  },
  priceId: {
    type: String
  }
})

isLocked.value = true

watch(
  () => paymentSuccess.value,
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
  emits('dismiss', paymentSuccess.value)
}

const t = (text: string) => {
  return useNuxtApp().$i18n.t(text)
}

const success = () => {
  paymentSuccess.value = true
}
</script>

<style lang="scss" scoped>
/* ── Overlay ── */
.payment-modal {
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
  width: min(500px, 92vw);
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

/* ── Success state ── */
.success-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 64px 32px;
  min-height: 420px;
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

/* ── Transitions ── */
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
