<template>
  <div class="subscription-mobile-me">
    <!-- <div class="unsupported" v-if="!isAppSupported">
      <div class="content">
        <h2>{{ t('page.subscription_mobile_me.unsupported_title') }}</h2>
      </div>
    </div> -->

    <template v-if="!isPageLoading && statusData">
      <div class="unsubscribed" v-if="!isPro">
        <div class="brief-info">
          <template v-if="!isNewUser">
            <img v-if="isPro" src="@internal/images/subscription-diamond-icon.png" />
            <span class="description" v-if="statusData.product.early_renewal_title">{{ statusData.product.early_renewal_title }} <br /> </span>
            <span class="tips" v-if="statusData.product.early_renewal_tip">{{ statusData.product.early_renewal_tip }}</span>
          </template>
          <span class="price" v-if="!isTrail"
            >{{ statusData.product.pay_price }} <span class="period">/ {{ statusData.product.pay_interval }} </span></span
          >
        </div>
        <div class="benefits" v-if="!isPro">
          <div class="benefit" :class="{ highlighted: statusData.product.highlight.includes(benefitIdx) }" v-for="(item, benefitIdx) in statusData.product.feature" :key="item">
            <div class="tick"></div>
            <div class="text">
              <span>{{ item }}</span>
            </div>
          </div>
          <div>
            <span class="description">{{ statusData.product.feature_supplement }}</span>
          </div>
        </div>
        <div class="operate">
          <i class="seperator bottom-line"></i>
          <span class="tips">{{ statusData.product.button_tip_text }}</span>
          <button @click="subscribeButtonClick">
            <span v-if="!isButtonLoading">{{ statusData.product.button_text }}</span>
            <div v-else class="i-svg-spinners:90-ring size-20px color-#f4c982"></div>
          </button>
        </div>
      </div>
      <div class="subscribed-pro" v-else>
        <img src="@internal/images/subscription-diamond-icon.png" />
        <template v-if="['apple', 'stripe', 'google'].includes(statusData.subscription.type)">
          <span class="description"
            >{{ t('page.subscription_mobile_me.subscribed_status.active_via', { source: getSourceName(statusData.subscription.type) }) }}<br />
            <span>{{ t('page.subscription_mobile_me.subscribed_auto_renew_date', { date: expiredTime }) }}</span
            ><br />
            <span>{{ t('page.subscription_mobile_me.subscribed_status.cancel_tips', { source: getSourceName(statusData.subscription.type) }) }}</span>
          </span>
        </template>

        <!-- <button v-if="!(isPro && platform === AppPlatform.Android)" @click="cancelButtonClick">{{ t('page.subscription_mobile_me.cancel_subscription') }}</button> -->
      </div>
    </template>
    <div class="loading" v-else>
      <div class="i-svg-spinners:90-ring size-20px color-#f4c982"></div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { useAppBridge } from '@/utils/appBridge'
import { formatDate } from '@commons/utils/date'

import type { InAppPurchaseOrderIdData, InAppPurchaseStatus } from '@commons/types/interface'
import { RESTMethodPath } from '@commons/types-pro'
import Toast from '~/components/Toast'

const { t } = useI18n()

useHead({
  titleTemplate: `Pro Reader - ${t('common.app.name')}`
})

const { sendMessage, platform } = useAppBridge()

const isPageLoading = ref(false)
const isButtonLoading = ref(false)

const cacheOrderId = ref<InAppPurchaseOrderIdData>()
const statusData = ref<InAppPurchaseStatus>()

const subscribeEndTime = computed(() => {
  if (!statusData.value || !statusData.value.subscription?.end_time) return null
  return new Date(statusData.value.subscription.end_time)
})

const isNewUser = computed(() => statusData.value?.subscription.type === 'none' && !subscribeEndTime.value)
const isTrail = computed(() => statusData.value?.subscription.type === 'system')
const isTrailExpired = computed(() => statusData.value?.subscription.type === 'none' && subscribeEndTime.value)
const isPro = computed(() => ['apple', 'stripe', 'google'].includes(statusData.value?.subscription.type || ''))
const expiredTime = computed(() => {
  if (!statusData.value || !subscribeEndTime.value) return ''
  return formatDate(subscribeEndTime.value, 'YYYY-MM-DD')
})

const subscribeButtonClick = async () => {
  if (isButtonLoading.value) return

  isButtonLoading.value = true

  await createInAppPurchase()

  if (!statusData.value?.product.apple_promotional_offer_id) {
    sendMessage('purchase', {
      productId: statusData.value?.product.apple_product_id || '',
      orderId: cacheOrderId.value?.uuid || ''
    })
  } else {
    sendMessage('purchaseWithOffer', {
      productId: statusData.value?.product.apple_product_id || '',
      orderId: cacheOrderId.value?.uuid || '',
      offerId: statusData.value?.product.apple_promotional_offer_id || '',
      keyID: cacheOrderId.value?.promotional_signature.key_identifier || '',
      nonce: cacheOrderId.value?.promotional_signature.nonce || '',
      signature: cacheOrderId.value?.promotional_signature.signature || '',
      timestamp: cacheOrderId.value?.promotional_signature.timestamp || 0
    })
  }

  isButtonLoading.value = false
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

const createInAppPurchase = async () => {
  try {
    const res = await request().post<InAppPurchaseOrderIdData>({
      url: RESTMethodPath.CREATE_INAPP_PURCHASE,
      body: {
        platform: platform,
        product_id: statusData.value?.product.apple_product_id,
        offer_id: statusData.value?.product.apple_promotional_offer_id
      }
    })

    if (res) {
      cacheOrderId.value = res
    }
  } catch (error) {
    Toast.showToast({ text: `${error}` })
  }
}

onMounted(() => {
  getInAppPurchaseData()
})
</script>
<style scoped lang="scss">
.subscription-mobile-me {
  /* 暖色 cream→white 渐变，on-brand 装饰底色，字面值保留 */
  --style: bg-gradient-to-b from-[#FFF6EBFF] to-[#FFFFFFFF] min-h-screen;

  & > * {
    padding-top: env(safe-area-inset-top);
  }

  .unsupported {
    --style: size-screen flex-center px-24px;

    .content {
      --style: flex flex-col items-center text-center max-w-300px;

      h2 {
        --style: text-20px font-semibold line-height-28px mb-12px;
        color: var(--slax-text);
      }
    }
  }

  .unsubscribed {
    --style: flex flex-col items-center;

    .brief-info {
      --style: mt-84px flex flex-col items-center px-34px;

      img {
        --style: h-44px object-contain;
      }

      .description {
        --style: mt-30px text-15px line-height-21px text-align-center;
        color: var(--slax-text);
      }

      .tips {
        --style: mt-10px text-13px line-height-18.5px;
        color: var(--slax-text-muted);
      }

      .price {
        --style: mt-30px text-34px font-semibold line-height-47.5px;
        color: var(--slax-text);

        .period {
          --style: mt-3px text-14px font-normal line-height-20px;
          color: var(--slax-text-light);
        }
      }
    }

    .benefits {
      --style: mt-44px pt-30px max-w-400px px-34px w-full flex flex-col items-start justify-between border-t-(1px solid);
      border-top-color: var(--slax-border);

      & > * + div {
        --style: mt-16px;
      }

      .benefit {
        --style: 'w-full flex items-center not-first:mt-16px';

        .tick {
          --style: mt-2px size-16px bg-contain flex-shrink-0 self-start;
          background-image: url('@internal/images/tiny-tick-subscribe-normal.png');
        }

        .text {
          --style: ml-16px text-16px line-height-20px overflow-hidden whitespace-pre-wrap;
          color: var(--slax-text);
        }

        &.highlighted {
          .tick {
            background-image: url('@internal/images/tiny-tick-subscribe-highlighted.png');
          }
          .text {
            --style: font-400;
            color: var(--slax-chart-primary);
          }
        }
      }

      .description {
        --style: mt-30px text-12px line-height-10px text-align-left;
        color: var(--slax-text);
      }
    }

    .operate {
      --style: mt-44px flex flex-col items-center w-full;

      .seperator {
        --style: w-full h-0.5px;
        background: var(--slax-border);
      }

      .tips {
        --style: mt-16px text-13px line-height-18.5px;
        color: var(--slax-text-muted);
      }

      button {
        --style: mt-16px flex-center rounded-25px max-w-295px w-full h-50px text-16px line-height-50px;
        --style: 'active:(scale-105) transition-all duration-250';
        background: linear-gradient(135deg, var(--slax-subscribe-dark-from), var(--slax-subscribe-dark-to));
        color: var(--slax-subscribe-peach-text);
      }
    }
  }

  .subscribed-pro {
    --style: flex flex-col items-center;

    img {
      --style: mt-217px h-44px object-contain;
    }

    .description {
      --style: mt-30px text-15px line-height-21px text-align-center;
      color: var(--slax-text);
    }
  }

  .loading {
    --style: size-screen flex-center;
  }
}
</style>
