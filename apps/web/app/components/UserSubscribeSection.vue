<template>
  <section class="settings-card">
    <div class="title">{{ $t('page.user.subscription_preferences') }}</div>
    <div class="subtitle" v-if="!isPageLoading">
      <span v-if="!isPro">
        {{ $t('page.user.subscription_description') }}
      </span>
      <button v-if="!isPro || isStripe" @click="showRedeem">{{ $t('page.user.subscription_redeem') }}</button>
    </div>
    <template v-if="!isProcessing">
      <div class="info">
        <template v-if="subscriptedTimes.length > 0">
          <div class="subscripted" v-if="subscriptedTitle">
            <div class="subscripted-status">{{ subscriptedTitle }}</div>
            <div class="subscripted-times">
              <div class="time" v-for="time in subscriptedTimes" :key="time">
                <i />
                <span>{{ time }}</span>
              </div>
            </div>

            <template v-if="!isPageLoading">
              <div class="subscripted-description" v-if="isPro && statusData">
                <span class="description">
                  {{
                    `${t('page.subscription_mobile_me.subscribed_status.active_via', { source: getSourceName(statusData.subscription.type) })} ${t('page.subscription_mobile_me.subscribed_auto_renew_date', { date: expiredTime })}`
                  }}<br />
                  <span>
                    <span>{{ t('page.subscription_mobile_me.subscribed_status.cancel_tips', { source: getSourceName(statusData.subscription.type) }) }}</span>
                    <span class="ml-8px" v-if="isStripe"
                      >(<button class="stripe-button" @click="navigateToSubscriptionHomepage">{{ $t('page.user.subscription_stripe_portal') }}</button>)</span
                    >
                  </span>
                </span>
              </div>
            </template>
          </div>
        </template>
        <!-- 轻量 plan comparison，替换旧 <PlanCard />（Stripe 直连），CTA → SubscriptionModal -->
        <div class="plan-comparison" v-if="!isPro">
          <!-- 免费版 -->
          <div class="plan-card">
            <div class="plan-name">{{ t('component.plan_card.plans.1.title') }}</div>
            <div class="plan-price">
              <span class="plan-price-num"><span class="plan-price-currency">$</span>0</span>
              <span class="plan-price-unit">{{ t('component.plan_card.plans.1.period') }}</span>
            </div>
            <ul class="plan-features">
              <li v-for="i in 6" :key="i">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12" /></svg>
                {{ t(`component.plan_card.plans.1.free_features.${i}`) }}
              </li>
            </ul>
            <button class="plan-cta plan-cta--current" type="button" disabled>
              {{ t('component.subscription.current_plan') }}
            </button>
          </div>

          <!-- 专业版 -->
          <div class="plan-card plan-card--pro">
            <span class="plan-badge">{{ t('component.subscription.badge_popular') }}</span>
            <div class="plan-name">{{ t('component.plan_card.plans.2.title') }}</div>
            <div class="plan-price">
              <span class="plan-price-num"><span class="plan-price-currency">$</span>5.99</span>
              <span class="plan-price-unit">{{ t('component.plan_card.plans.2.period') }}</span>
              <span class="plan-price-original">$9.99</span>
            </div>
            <ul class="plan-features">
              <li>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12" /></svg>
                <strong>{{ t('component.plan_card.plans.2.free_features.1') }}</strong>
              </li>
              <li v-for="i in 6" :key="i">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12" /></svg>
                {{ t(`component.plan_card.plans.2.pro_features.${i}`) }}
              </li>
            </ul>
            <button class="plan-cta plan-cta--primary" type="button" @click="openSubscribeModal">
              {{ t('component.subscription.cta_subscribe') }}
            </button>
          </div>
        </div>
      </div>
    </template>
    <template v-else>
      <div class="processing">
        <div class="i-svg-spinners:90-ring text-24px color-accent"></div>
        <span>{{ $t('page.user.subscribe.processing_notice') }}</span>
      </div>
    </template>
  </section>
</template>

<script setup lang="ts">
import { showRedeemModal } from './PaymentModal'
import Subscription from '@/components/SubscriptionModal'
import { type InAppPurchaseStatus, SubscriptionType, type UserDetailInfo } from '@slax-reader/contracts/interface'
import { RESTMethodPath } from '@slax-reader/contracts/const'
import Toast from '~/components/Toast'

const { t } = useI18n()

const props = defineProps({
  userInfo: {
    type: Object as PropType<UserDetailInfo>,
    required: true
  }
})

const isPageLoading = ref(false)
const statusData = ref<InAppPurchaseStatus>()
const isPro = computed(() => ['apple', 'stripe', 'google'].includes(statusData.value?.subscription.type || ''))
const isTrail = computed(() => statusData.value?.subscription.type === 'system')

const isStripe = computed(() => statusData.value?.subscription.type === 'stripe')
const subscribeEndTime = computed(() => {
  if (!statusData.value || !statusData.value.subscription?.end_time) return null
  return new Date(statusData.value.subscription.end_time)
})
const expiredTime = computed(() => {
  if (!statusData.value || !subscribeEndTime.value) return ''
  return formatDate(subscribeEndTime.value)
})

const subscriptedTitle = computed(() => {
  if (isPro.value) {
    return t('page.user.subscribe.subscripted_pro')
  } else if (isTrail.value) {
    return t('page.user.subscribe.subscripted_trail_pro')
  } else {
    return t('page.user.subscribe.no')
  }
})

const { isProcessing } = useSubscribeChecking({
  loadingText: t('component.pro_icon.processing')
})

onMounted(() => {
  getInAppPurchaseData()

  if (!isPro.value) {
    analyticsLog({ event: 'subscription_view', presentation: 'screen' })
  }
})

const getInAppPurchaseData = async () => {
  isPageLoading.value = true

  try {
    const data = await request().get<InAppPurchaseStatus>({
      url: RESTMethodPath.USER_INAPP_PURCHASE
    })

    statusData.value = data
  } catch (error) {
    Toast.showToast({ text: `${error}` })
  } finally {
    isPageLoading.value = false
  }
}

const formatDate = (date: Date | undefined, format = 'yyyy-MM-dd'): string => {
  if (!date) return ''
  date = new Date(date)
  const year = date.getFullYear()
  const month = date.getMonth() + 1
  const day = date.getDate()
  const hour = date.getHours()
  const minute = date.getMinutes()
  const second = date.getSeconds()
  const formatMap: { [key: string]: any } = {
    yyyy: year.toString(),
    MM: month.toString().padStart(2, '0'),
    dd: day.toString().padStart(2, '0'),
    HH: hour.toString().padStart(2, '0'),
    mm: minute.toString().padStart(2, '0'),
    ss: second.toString().padStart(2, '0')
  }
  return format.replace(/yyyy|MM|dd|HH|mm|ss/g, match => formatMap[match])
}

const subscriptedTimes = computed(() => {
  const userInfo = props.userInfo
  if (isPro.value) {
    return [`${t('page.user.subscribe.first')} ${formatDate(userInfo.subscription.first_subscription_at)}`]
  } else if (isTrail.value) {
    return [
      `${t('page.user.subscribe.first')} ${formatDate(userInfo.subscription.first_subscription_at)}`,
      `${t('page.user.subscribe.expired')} ${formatDate(userInfo.subscription.subscription_end_at)}`
    ]
  } else {
    return []
  }
})

const navigateToSubscriptionHomepage = () => {
  const subscriptUrl = `${props.userInfo?.subscription?.subscription_homepage}`
  window.open(subscriptUrl)
}

const openSubscribeModal = () => {
  Subscription.showModal()
}

const showRedeem = () => {
  showRedeemModal(success => {
    if (success) {
      postChannelMessage('refresh', { type: 'page' })
      window.location.reload()
    }
  })
}

const getSourceName = (name: string) => {
  switch (name) {
    case 'apple':
      return 'Apple'
    case 'google':
      return 'Google Play'
    case 'stripe':
      return 'Stripe'
    default:
      return name
  }
}
</script>

<style lang="scss" scoped>
.settings-card {
  background: var(--slax-surface);
  border: 1px solid var(--slax-border);
  border-radius: var(--slax-radius);
  box-shadow: inset 0 1px 0 var(--slax-inset-hi);
  padding: 24px;

  .title {
    font-family: var(--slax-font-serif);
    color: var(--slax-text);
    --style: font-600 text-h2 line-height-33px text-left select-none;
  }

  .info {
    .subscripted {
      --style: mt-8px;

      .subscripted-status {
        font-size: var(--slax-fs-aux);
        color: var(--slax-accent);
        line-height: 1.4;
      }

      .subscripted-times {
        --style: mt-24px flex flex-col;

        .time {
          --style: 'flex items-center not-first:mt-10px';

          i {
            --style: w-8px h-8px rounded-full flex-shrink-0;
            border: 1px solid var(--slax-accent);
          }

          span {
            --style: ml-12px text-14px line-height-20px;
            color: var(--slax-text);
          }
        }
      }

      .subscripted-description {
        --style: mt-16px;

        .description {
          font-size: 15px;
          color: var(--slax-text);
          line-height: 1.55;
          text-align: left;

          .stripe-button {
            color: var(--slax-accent);
            font-size: var(--slax-fs-aux);
            line-height: 1.4;
            transition: all var(--slax-dur-normal);

            &:hover {
              text-decoration: underline;
              opacity: 0.85;
            }
          }
        }
      }
    }
  }

  .subtitle {
    --style: mt-8px flex flex-row items-center gap-10px text-14px line-height-20px;
    color: var(--slax-text-muted);

    button {
      font-size: var(--slax-fs-aux);
      color: var(--slax-accent);
      line-height: 1.4;
      transition: all var(--slax-dur-normal);

      &:hover {
        text-decoration: underline;
        opacity: 0.85;
      }
    }
  }

  .processing {
    --style: mt-24px flex items-center gap-12px;

    span {
      font-size: var(--slax-fs-aux);
      color: var(--slax-text);
      line-height: 1.4;
    }
  }
}

/* ── Plan Comparison (replaces PlanCard) ── */
.plan-comparison {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
  margin-top: 20px;

  @media (max-width: 600px) {
    grid-template-columns: 1fr;
  }
}

.plan-card {
  position: relative;
  padding: 18px 18px 16px;
  background: var(--slax-surface);
  border: 1px solid var(--slax-border);
  border-radius: var(--slax-radius);
  display: flex;
  flex-direction: column;

  &--pro {
    background: var(--slax-surface-solid);
    border-color: color-mix(in srgb, var(--slax-accent) 40%, var(--slax-border));
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--slax-accent) 18%, transparent);
  }
}

.plan-badge {
  position: absolute;
  top: 12px;
  right: 12px;
  font-size: 11px;
  font-weight: 500;
  color: var(--slax-accent);
  background: var(--slax-accent-bg);
  padding: 2px 8px;
  border-radius: 999px;
  letter-spacing: 0.02em;
}

.plan-name {
  font-size: var(--slax-fs-aux);
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--slax-text-muted);
  margin-bottom: 10px;
}

.plan-price {
  display: flex;
  align-items: baseline;
  gap: 6px;
  margin-bottom: 4px;
}

.plan-price-num {
  font-family: var(--slax-font-serif);
  font-size: 28px;
  font-weight: 500;
  color: var(--slax-text);
  letter-spacing: 0.01em;
  line-height: 1.1;
}

.plan-price-currency {
  font-size: 18px;
  font-weight: 500;
  color: var(--slax-text);
  position: relative;
  top: -1px;
}

.plan-price-unit {
  font-size: var(--slax-fs-tag);
  color: var(--slax-text-light);
}

.plan-price-original {
  font-size: var(--slax-fs-tag);
  color: var(--slax-text-light);
  text-decoration: line-through;
}

.plan-features {
  list-style: none;
  padding: 0;
  margin: 12px 0 16px;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 8px;

  li {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    font-size: var(--slax-fs-tag);
    color: var(--slax-text);
    line-height: 1.5;
  }

  svg {
    width: 12px;
    height: 12px;
    flex-shrink: 0;
    margin-top: 2px;
    color: var(--slax-text-light);
  }

  .plan-card--pro & svg {
    color: var(--slax-accent);
  }
}

.plan-cta {
  padding: 9px 14px;
  width: 100%;
  font-family: inherit;
  font-size: var(--slax-fs-aux);
  font-weight: 500;
  border-radius: var(--slax-radius-sm);
  cursor: pointer;
  text-align: center;
  transition: all var(--slax-dur-normal);
  border: 1px solid transparent;

  &--current {
    background: transparent;
    border-color: var(--slax-border);
    color: var(--slax-text-light);
    cursor: not-allowed;
  }

  &--primary {
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
}
</style>
