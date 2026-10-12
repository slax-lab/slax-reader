<template>
  <div class="sub-overlay" :class="{ appear }" @click="closeModal">
    <Transition name="modal" @after-leave="onAfterLeave">
      <div class="sub-modal" v-show="appear" @click.stop>
        <!-- 顶栏 -->
        <div class="sub-header">
          <h3 class="sub-title">{{ t('component.subscription.title') }}</h3>
          <button class="sub-close" type="button" @click="closeModal" aria-label="close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <!-- 副标题 -->
        <p class="sub-desc">{{ t('component.subscription.description') }}</p>

        <!-- 计费周期 Tab -->
        <div class="sub-cycle-wrap">
          <div class="sub-cycle-tabs" role="tablist" :aria-label="t('component.subscription.cycle_monthly')">
            <button class="sub-cycle-tab" :class="{ active: cycle === 'monthly' }" type="button" role="tab" :aria-selected="cycle === 'monthly'" @click="cycle = 'monthly'">
              {{ t('component.subscription.cycle_monthly') }}
              <span class="sub-cycle-tag">{{ t('component.subscription.cycle_monthly_tag') }}</span>
            </button>
            <button class="sub-cycle-tab" :class="{ active: cycle === 'oneoff' }" type="button" role="tab" :aria-selected="cycle === 'oneoff'" @click="cycle = 'oneoff'">
              {{ t('component.subscription.cycle_oneoff') }}
            </button>
          </div>
        </div>

        <!-- 方案卡片 -->
        <div class="sub-plans">
          <!-- 免费版 -->
          <div class="sub-plan">
            <div class="sub-plan-name">{{ t('component.plan_card.plans.1.title') }}</div>
            <div class="sub-plan-price">
              <span class="sub-plan-price-num"><span class="sub-plan-price-currency">$</span>0</span>
              <span class="sub-plan-price-unit">{{ t('component.plan_card.plans.1.period') }}</span>
            </div>
            <div class="sub-plan-formula">{{ t('component.plan_card.plans.1.discount') }}</div>
            <ul class="sub-feature-list">
              <li v-for="i in 6" :key="i">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12" /></svg>
                {{ t(`component.plan_card.plans.1.free_features.${i}`) }}
              </li>
            </ul>
            <button class="sub-cta sub-cta-current" type="button" disabled>
              {{ t('component.subscription.current_plan') }}
            </button>
          </div>

          <!-- 专业版 -->
          <div class="sub-plan sub-plan-pro">
            <span class="sub-badge">{{ t('component.subscription.badge_popular') }}</span>
            <div class="sub-plan-name">{{ t('component.plan_card.plans.2.title') }}</div>
            <div class="sub-plan-price">
              <span class="sub-plan-price-num"> <span class="sub-plan-price-currency">$</span>{{ proPrice }} </span>
              <span class="sub-plan-price-unit">{{ t('component.plan_card.plans.2.period') }}</span>
              <span v-if="proOriginal" class="sub-plan-price-original">${{ proOriginal }}</span>
            </div>
            <div class="sub-plan-formula">
              <span v-if="cycle === 'monthly'" class="sub-plan-formula-tag">{{ t('component.subscription.cycle_monthly_tag') }}</span>
              {{ proFormula }}
            </div>
            <ul class="sub-feature-list">
              <li>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12" /></svg>
                <strong>{{ t('component.plan_card.plans.2.free_features.1') }}</strong>
              </li>
              <li v-for="i in 6" :key="i">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12" /></svg>
                {{ t(`component.plan_card.plans.2.pro_features.${i}`) }}
              </li>
            </ul>
            <button class="sub-cta sub-cta-primary" type="button" @click="onProCta">
              {{ ctaText }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script lang="ts" setup>
import { showPaymentModal } from '@/components/PaymentModal'

const emits = defineEmits(['close', 'dismiss'])
const isLocked = useScrollLock(window)

const appear = ref(false)
isLocked.value = true

onMounted(() => {
  setTimeout(() => {
    appear.value = true
  })
  analyticsLog({ event: 'subscription_view', presentation: 'screen' })
})

const closeModal = () => {
  appear.value = false
}

const onAfterLeave = () => {
  isLocked.value = false
  emits('dismiss')
}

// 计费周期 Tab
const cycle = ref<'monthly' | 'oneoff'>('monthly')

// 派生价格（与 PlanCard 数据一致）
const proPrice = computed(() => (cycle.value === 'monthly' ? 5.99 : 9.99))
const proOriginal = computed(() => (cycle.value === 'monthly' ? 9.99 : null))

const proFormula = computed(() => (cycle.value === 'monthly' ? t('component.plan_card.subscribe_month_rule') : t('component.plan_card.one_time_purchase_rule')))

// period_unit = "月"/"Month"，直接拼接，period = "/ 月"/"/ Month" 已含斜杠不重复
const ctaText = computed(() =>
  cycle.value === 'monthly'
    ? `${t('component.subscription.cta_subscribe')} · $${proPrice.value} / ${t('component.plan_card.plans.2.period_unit')}`
    : `${t('component.plan_card.one_time_purchase')} · $${proPrice.value}`
)

// ⚠️ priceId 是 pass-through：PlanPayment.fetchClientSecret 直接读 $config.STRIPE_*_PRICE_ID，
//    不使用传入的 priceId；实际付款金额由 env config 决定，与 PlanCard 现有行为一致。
const onProCta = () => {
  try {
    const $config = useNuxtApp().$config.public
    const type = cycle.value === 'monthly' ? 'sub' : 'once'
    const priceId = type === 'sub' ? `${$config.STRIPE_SUB_PRICE_ID}` : `${$config.STRIPE_ONCE_PRICE_ID}`

    showPaymentModal({ type, priceId }, success => {
      if (success) {
        postChannelMessage('refresh', { type: 'page' })
        window.location.reload()
      }
    })
  } catch (e) {
    alert((e as Error).message)
  }
}

const t = (text: string) => useNuxtApp().$i18n.t(text)
</script>

<style lang="scss" scoped>
/* ── Overlay ── */
.sub-overlay {
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
.sub-modal {
  position: relative;
  width: 720px;
  max-width: 92vw;
  max-height: 90vh;
  overflow-y: auto;
  background: var(--slax-surface-solid);
  border: 1px solid var(--slax-border);
  border-radius: var(--slax-radius);
  box-shadow:
    var(--slax-shadow-warm),
    0 24px 64px color-mix(in srgb, var(--slax-accent) 16%, transparent),
    inset 0 1px 0 var(--slax-inset-hi);
  padding: 28px 28px 24px;

  @media (max-width: 640px) {
    padding: 22px 18px;
  }
}

/* ── Header ── */
.sub-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}

.sub-title {
  font-family: var(--slax-font-serif);
  font-size: var(--slax-fs-h2);
  font-weight: 500;
  color: var(--slax-text);
  margin: 0;
}

.sub-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
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

/* ── Description ── */
.sub-desc {
  font-size: 13px;
  color: var(--slax-text-light);
  margin: 0 0 18px;
  line-height: 1.65;
}

/* ── Cycle tabs ── */
.sub-cycle-wrap {
  display: flex;
  justify-content: center;
  margin-bottom: 22px;
}

.sub-cycle-tabs {
  display: inline-flex;
  background: color-mix(in srgb, var(--slax-text) 8%, var(--slax-surface));
  border-radius: 999px;
  padding: 4px;
  gap: 2px;
}

.sub-cycle-tab {
  font-family: inherit;
  font-size: 13px;
  font-weight: 500;
  color: var(--slax-text-muted);
  background: transparent;
  border: none;
  padding: 8px 20px;
  border-radius: 999px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  transition: all var(--slax-dur-normal);

  &:hover:not(.active) {
    color: var(--slax-text);
  }

  &.active {
    background: var(--slax-surface-solid);
    color: var(--slax-accent);
    box-shadow: 0 1px 3px color-mix(in srgb, var(--slax-text) 12%, transparent);
  }
}

.sub-cycle-tag {
  font-size: 11px;
  font-weight: 500;
  color: var(--slax-accent);
  background: var(--slax-accent-bg);
  padding: 1px 6px;
  border-radius: 4px;
}

/* ── Plans grid ── */
.sub-plans {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;

  @media (max-width: 640px) {
    grid-template-columns: 1fr;
  }
}

/* ── Plan card ── */
.sub-plan {
  position: relative;
  padding: 22px 22px 20px;
  background: var(--slax-surface);
  border: 1px solid var(--slax-border);
  border-radius: var(--slax-radius);
  display: flex;
  flex-direction: column;
}

.sub-plan-pro {
  background: var(--slax-surface-solid);
  border-color: color-mix(in srgb, var(--slax-accent) 40%, var(--slax-border));
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--slax-accent) 18%, transparent);
}

.sub-badge {
  position: absolute;
  top: 14px;
  right: 14px;
  font-size: 12px;
  font-weight: 500;
  color: var(--slax-accent);
  background: var(--slax-accent-bg);
  padding: 3px 10px;
  border-radius: 999px;
  letter-spacing: 0.02em;
}

.sub-plan-name {
  font-size: 13px;
  font-weight: 500;
  color: var(--slax-text-muted);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  margin-bottom: 12px;
}

.sub-plan-price {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 6px;
}

.sub-plan-price-num {
  font-family: var(--slax-font-serif);
  font-size: 36px;
  font-weight: 500;
  color: var(--slax-text);
  letter-spacing: 0.01em;
  line-height: 1.1;
}

.sub-plan-price-currency {
  font-family: var(--slax-font-sans, inherit);
  font-size: 24px;
  font-weight: 500;
  color: var(--slax-text);
  margin-right: 2px;
  position: relative;
  top: -4px;
}

.sub-plan-price-unit {
  font-size: 13px;
  color: var(--slax-text-light);
}

.sub-plan-price-original {
  font-size: 13px;
  color: var(--slax-text-light);
  text-decoration: line-through;
  margin-left: 2px;
}

.sub-plan-formula {
  font-size: 12px;
  color: var(--slax-text-light);
  line-height: 1.6;
  margin: 14px 0 20px;
  min-height: 38px;
}

.sub-plan-formula-tag {
  display: inline-block;
  font-size: 12px;
  font-weight: 500;
  color: var(--slax-accent);
  background: var(--slax-accent-bg);
  padding: 1px 8px;
  border-radius: 4px;
  margin-right: 6px;
}

/* ── Feature list ── */
.sub-feature-list {
  list-style: none;
  padding: 0;
  margin: 0 0 22px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  flex: 1;

  li {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    font-size: 13px;
    color: var(--slax-text);
    line-height: 1.5;
  }

  svg {
    width: 14px;
    height: 14px;
    flex-shrink: 0;
    margin-top: 3px;
    color: var(--slax-text-light);
  }

  .sub-plan-pro & svg {
    color: var(--slax-accent);
  }
}

/* ── CTA buttons ── */
.sub-cta {
  font-family: inherit;
  font-size: 13px;
  font-weight: 500;
  padding: 11px 16px;
  border-radius: var(--slax-radius-sm);
  cursor: pointer;
  border: 1px solid transparent;
  width: 100%;
  text-align: center;
  transition: all var(--slax-dur-normal);
}

.sub-cta-current {
  background: transparent;
  border-color: var(--slax-border);
  color: var(--slax-text-light);
  cursor: not-allowed;
}

.sub-cta-primary {
  background: var(--slax-accent);
  color: var(--slax-btn-text);
  border-color: var(--slax-accent);

  &:hover {
    opacity: 0.92;
    transform: translateY(-1px);
  }

  &:active {
    transform: translateY(0);
    opacity: 1;
  }
}

/* ── Modal transition ── */
.modal-leave-to,
.modal-enter-from {
  opacity: 0;
  transform: translateY(-25px);
}

.modal-enter-active,
.modal-leave-active {
  transition: all var(--slax-dur-normal) ease-in-out;
}
</style>
