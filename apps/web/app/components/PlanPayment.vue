<template>
  <div class="plan-payment">
    <!-- 订单摘要 -->
    <div class="order-summary">
      <div class="order-plan-label">{{ t('component.plan_payment.choose_plan') }}</div>
      <div class="order-price">
        <span class="order-price-num"><span v-if="priceCurrency" class="order-price-currency">{{ priceCurrency }}</span>{{ priceAmount }}</span>
        <span class="order-price-period">{{ t('component.plan_payment.period') }}</span>
      </div>
      <div class="order-meta">{{ t('component.plan_payment.pay_now') }}</div>
      <div class="order-tip" v-if="props.type !== 'once'">{{ t('component.plan_payment.tips') }}</div>
    </div>

    <!-- 支付表单 -->
    <div class="payment-form-wrap" v-if="!paymentSuccess">
      <form id="payment-form">
        <div :id="paymentId"></div>
        <Transition name="opacity">
          <NuxtTurnstile class="turnstile-overlay" v-show="showTurnstile" v-model="turnstileCallbackToken" :options="{ theme: 'light' }" />
        </Transition>
        <Transition name="opacity">
          <button id="submit" v-show="isReady" type="button" @click.prevent="handleSubmit">
            <span>{{ t('component.plan_payment.pay') }}</span>
          </button>
        </Transition>
      </form>
      <div v-if="loading" class="spinner-overlay">
        <DotLoading />
      </div>
      <Transition name="opacity">
        <div v-show="submiting" class="spinner-overlay">
          <div class="i-svg-spinners:180-ring-with-bg text-5xl" style="color: var(--slax-accent)"></div>
        </div>
      </Transition>
    </div>
  </div>
</template>

<script lang="ts" setup>
import DotLoading from '~/components/DotLoading.vue'

import { RESTMethodPath } from '@commons/contracts/const'
import { loadStripe, type Stripe, type StripeElements, type StripePaymentElement } from '@stripe/stripe-js'
import Toast, { ToastType } from '~/components/Toast'
import { useUserStore } from '~/stores/user'

const emits = defineEmits(['success'])

const userStore = useUserStore()
const loading = ref(false)
const submiting = ref(false)
const isReady = ref(false)
const stripe = ref<Stripe | null>(null)
const elements = ref<StripeElements>()
const paymentElement = ref<StripePaymentElement>()
const paymentId = 'payment-element'
const showTurnstile = ref(true)
const paymentSuccess = ref(false)
const turnstileCallbackToken = ref('')
const props = defineProps({
  type: {
    type: String
  },
  priceId: {
    type: String
  }
})

watch(
  () => turnstileCallbackToken.value,
  value => {
    if (value) {
      showTurnstile.value = false
      loadPayment(value)
    }
  }
)

onMounted(async () => {
  const $config = useNuxtApp().$config.public
  stripe.value = await loadStripe($config.STRIPE_PUBLIC_KEY as string)
})

onUnmounted(() => {
  offloadTurnstile()
})

const loadPayment = async (token: string) => {
  if (!stripe.value) {
    return
  }

  loading.value = true

  const clientSecret = await fetchClientSecret(token)
  if (!clientSecret) {
    throw new Error('Failed to fetch client secret')
  }

  loading.value = false

  // style doc: https://docs.stripe.com/elements/appearance-api
  elements.value = stripe.value.elements({
    clientSecret: clientSecret,
    locale: 'auto',
    appearance: {
      theme: 'stripe'
    }
  })

  paymentElement.value = elements.value.create('payment', {})
  paymentElement.value.mount(`#${paymentId}`)
  paymentElement.value.once('ready', () => {
    isReady.value = true
  })
}

const fetchClientSecret = async (token: string) => {
  const $config = useNuxtApp().$config.public
  const url = props.type === 'once' ? RESTMethodPath.CREATE_ONCE_SUBSCRIPTION : RESTMethodPath.CREATE_SUBSCRIPTION
  const body = props.type === 'once' ? { price_id: $config.STRIPE_ONTIME_PRICE_ID, token: token } : { sub_price_id: $config.STRIPE_SUB_PRICE_ID, token: token }
  return (
    await request().post<{ client_secret: string }>({
      url,
      body
    })
  )?.client_secret
}

const handleSubmit = async () => {
  if (!stripe.value || !elements.value) {
    Toast.showToast({
      text: t('component.plan_payment.stripe_error'),
      type: ToastType.Error
    })

    return
  }

  submiting.value = true
  const { error } = await stripe.value.confirmPayment({
    elements: elements.value,
    redirect: 'if_required',
    confirmParams: {
      return_url: `${window.location.origin}/user`
    }
  })

  if (error) {
    Toast.showToast({
      text: `${error.message}`,
      type: ToastType.Error
    })
  } else {
    userStore.updatePayTimeRecord()
    emits('success')
  }

  submiting.value = false
}

const offloadTurnstile = () => {
  const turnstileApi = 'turnstile/v0/api'
  const head = document.head
  const link = head.querySelector(`link[href*="${turnstileApi}"]`)
  const script = head.querySelector(`script[src*="${turnstileApi}"]`)
  link?.remove()
  script?.remove()
}

const t = (text: string) => {
  return useNuxtApp().$i18n.t(text)
}

// 价格文案（如 "$5.99"）：拆出货币符号，使其与 SubscriptionModal 的 sub-plan-price 同款排版
const priceText = computed(() => (props.type !== 'once' ? t('component.plan_payment.plan_price') : t('component.plan_payment.one_time_price')))
const priceCurrency = computed(() => priceText.value.match(/^[^\d]*/)?.[0] ?? '')
const priceAmount = computed(() => priceText.value.slice(priceCurrency.value.length))
</script>

<style lang="scss" scoped>
.plan-payment {
  display: flex;
  flex-direction: column;
}

/* ── 订单摘要区 ── */
.order-summary {
  padding: 24px 24px 20px;
  border-bottom: 1px solid var(--slax-border);
  background: color-mix(in srgb, var(--slax-accent) 3%, var(--slax-surface));
  text-align: center;
}

.order-plan-label {
  font-size: var(--slax-fs-aux);
  font-weight: 500;
  color: var(--slax-accent);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  margin-bottom: 12px;
}

.order-price {
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
}

.order-price-num {
  font-family: var(--slax-font-serif);
  font-size: 36px;
  font-weight: 500;
  color: var(--slax-text);
  letter-spacing: 0.01em;
  line-height: 1.1;
}

/* 货币符号：沿用 SubscriptionModal 的 sub-plan-price-currency 排版 */
.order-price-currency {
  font-family: var(--slax-font-sans, inherit);
  font-size: 24px;
  font-weight: 500;
  color: var(--slax-text);
  margin-right: 2px;
  position: relative;
  top: -4px;
}

.order-price-period {
  font-size: var(--slax-fs-aux);
  color: var(--slax-text-light);
  font-weight: 400;
}

.order-meta {
  margin-top: 8px;
  font-size: var(--slax-fs-aux);
  color: var(--slax-text-light);
  line-height: 1.5;
}

.order-tip {
  margin-top: 6px;
  font-size: var(--slax-fs-tag);
  color: var(--slax-tips-warn);
  line-height: 1.5;
}

/* ── 支付表单区 ── */
.payment-form-wrap {
  padding: 24px;
  position: relative;

  form {
    min-height: 340px;
  }

  .turnstile-overlay {
    position: absolute;
    inset: 0;
    z-index: 3;
    background: color-mix(in srgb, var(--slax-surface-solid) 80%, transparent);
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 0 0 var(--slax-radius) var(--slax-radius);
  }

  button#submit {
    margin-top: 20px;
    width: 100%;
    height: 48px;
    background: var(--slax-accent);
    border: none;
    border-radius: var(--slax-radius-sm);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: all var(--slax-dur-normal);

    &:hover {
      opacity: 0.92;
      transform: translateY(-1px);
      box-shadow: 0 4px 16px color-mix(in srgb, var(--slax-accent) 30%, transparent);
    }

    &:active {
      transform: translateY(0);
      opacity: 1;
    }

    span {
      font-size: var(--slax-fs-body);
      font-weight: 500;
      color: var(--slax-btn-text);
    }
  }

  .spinner-overlay {
    position: absolute;
    inset: 0;
    z-index: 3;
    background: color-mix(in srgb, var(--slax-surface-solid) 80%, transparent);
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 0 0 var(--slax-radius) var(--slax-radius);
  }
}
</style>
