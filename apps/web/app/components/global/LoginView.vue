<template>
  <div class="auth-card" :class="{ 'has-invite': hasInvite }">
    <!-- 邀请段：通过 invite 插槽注入，与登录段共用同一张卡片 -->
    <div v-if="$slots.invite" class="invite-section">
      <slot name="invite" />
    </div>
    <div class="login-section">
      <!-- Logo -->
      <div class="auth-logo">
        <img src="@images/icon-logo-login.png" :alt="t('common.app.name')" />
      </div>

      <!-- 标题 + 副标题 -->
      <h1 class="auth-title">{{ t('common.app.name') }}</h1>
      <p class="auth-subtitle">{{ t('component.login_view.title') }}</p>

      <ul v-if="modal" class="auth-benefits">
        <li v-for="benefit in ['save', 'devices', 'space']" :key="benefit">
          <span class="auth-benefit-check" aria-hidden="true">✓</span>
          <span>{{ t(`component.login_view.benefits.${benefit}`) }}</span>
        </li>
      </ul>

      <!-- Turnstile（仅邀请码流程） -->
      <NuxtTurnstile v-if="turnstileEnabled && !!affcode" v-model="turnstileCallbackToken" class="turnstile" :options="{ theme: 'light' }" />

      <!-- 登录按钮 -->
      <div v-if="showLoginBtn" class="auth-btns">
        <button v-if="emailEnabled" class="email-login-toggle" type="button" :aria-expanded="emailOpen" @click="toggleEmail">
          {{ t(emailOpen ? 'email_auth.cancel' : 'email_auth.continue_with_email') }}
        </button>
        <EmailCodeForm
          v-if="emailEnabled && emailOpen && active"
          ref="emailForm"
          :send-url="EMAIL_AUTH_PATH.send"
          :verify="verifyEmail"
        />
        <GoogleLoginButton ref="googleLoginBtn" :redirect="redirect" :affcode="affcode" :auth-attribution="authAttribution" @click.capture="cancelEmail" />
        <AppleLoginButton v-if="appleLoginEnabled" :redirect="redirect" :affcode="affcode" :auth-attribution="appleAttribution" @click.capture="cancelEmail" />
      </div>

      <!-- 服务条款 -->
      <p class="auth-tos">
        {{ t('component.login_view.tos_prefix') }}
        <a v-if="modal" href="/terms" target="_blank" rel="noopener">{{ t('docs.title.terms') }}</a>
        <NuxtLink v-else to="/terms">{{ t('docs.title.terms') }}</NuxtLink>
        {{ t('component.login_view.tos_and') }}
        <a v-if="modal" href="/privacy" target="_blank" rel="noopener">{{ t('docs.title.privacy') }}</a>
        <NuxtLink v-else to="/privacy">{{ t('docs.title.privacy') }}</NuxtLink>
      </p>
    </div>
  </div>
</template>

<script lang="ts" setup>
import AppleLoginButton from '~/components/AppleLoginButton.vue'
import GoogleLoginButton from '~/components/GoogleLoginButton.vue'
import EmailCodeForm from '~/components/Login/EmailCodeForm.vue'

import { authReturnTarget } from '~/utils/emailAuth'

import { EMAIL_AUTH_PATH, type EmailAuthStatus, type EmailCodeInput } from '@slax-reader/contracts/email-auth'
import { isAcquisitionAuthAttribution, type WebAuthAttribution } from '@slax-reader/contracts/events'
import type { PropType } from 'vue'

const props = defineProps({
  authAttribution: {
    type: Object as PropType<WebAuthAttribution>,
    required: false
  },
  redirect: {
    type: String,
    default: ''
  },
  affcode: {
    type: String,
    default: ''
  },
  modal: Boolean,
  active: {
    type: Boolean,
    default: true
  },
  // 是否存在邀请段：为真时卡片描边换 accent-soft 并下推登录段
  hasInvite: {
    type: Boolean,
    default: false
  }
})

const nuxtApp = useNuxtApp()
const { t } = nuxtApp.$i18n
const auth = useAuth()
const runtimeConfig = useRuntimeConfig().public
const appleLoginEnabled = Boolean(runtimeConfig.APPLE_OAUTH_CLIENT_ID)
const turnstileEnabled = Boolean(runtimeConfig.TURNSTILE_SITE_KEY)

const turnstileCallbackToken = ref('')
const isAffUser = !!props.affcode
const showLoginBtn = computed(() => {
  return !isAffUser || !turnstileEnabled || Boolean(turnstileCallbackToken.value)
})

const googleLoginBtn = ref<InstanceType<typeof GoogleLoginButton>>()

if (!props.modal && useRoute().query.from === 'homepage') {
  googleLoginBtn.value?.login()
}

const appleAttribution = computed(() => isAcquisitionAuthAttribution(props.authAttribution) ? props.authAttribution : undefined)
const emailEnabled = ref(false)
const emailOpen = ref(false)
const emailForm = ref<InstanceType<typeof EmailCodeForm>>()

onMounted(async () => {
  try {
    const status = await request().get<EmailAuthStatus>({
      url: EMAIL_AUTH_PATH.status,
      errorInterceptors: () => {}
    })
    emailEnabled.value = status?.enabled === true
  } catch {
    // Existing sign-in providers remain available when the email status cannot be loaded.
  }
})

const cancelEmail = () => {
  emailForm.value?.cancel()
  emailOpen.value = false
}

defineExpose({ cancelEmail })

const toggleEmail = () => {
  if (emailOpen.value) {
    cancelEmail()
  } else {
    emailOpen.value = true
    analyticsLog({ event: 'user_login_start', method: 'email' })
  }
}

const verifyEmail = async (proof: EmailCodeInput, signal: AbortSignal) => {
  const target = authReturnTarget(props.redirect, location.origin)
  await auth.verifyEmailAuth({
    ...proof,
    ...(props.affcode ? { aff_code: props.affcode } : {}),
    ...(props.authAttribution ? { auth_attribution: props.authAttribution } : {})
  }, { signal, errorInterceptors: () => {} })

  signal.throwIfAborted()
  if (await nuxtApp.runWithContext(() => navigateTo(target, { external: true })) === false) throw new Error('Login navigation did not complete')
}
</script>

<style lang="scss" scoped>
.auth-card {
  width: 100%;
  background: var(--slax-surface-solid);
  border: 1px solid var(--slax-border);
  border-radius: var(--slax-radius);
  box-shadow: var(--slax-shadow-warm);
  position: relative;

  // 邀请态：卡片描边换 accent-soft
  &.has-invite {
    border-color: var(--slax-accent-soft);
  }
}

// 邀请段：与登录段共用同一张卡片，底部 divider 分隔（内容由 invite 插槽注入）
.invite-section {
  padding: 0 32px 24px;
  position: relative;
  text-align: center;

  &::after {
    content: '';
    position: absolute;
    left: 24px;
    right: 24px;
    bottom: 0;
    height: 1px;
    background: var(--slax-border);
  }

  @media (max-width: 540px) {
    padding: 18px 20px 16px;
  }
}

.login-section {
  padding: 40px 36px 32px;
  text-align: center;

  @media (max-width: 540px) {
    padding: 28px 20px 24px;
  }
}

// 有邀请段时下推登录段顶部留白
.auth-card.has-invite .login-section {
  padding-top: 32px;

  @media (max-width: 540px) {
    padding-top: 24px;
  }
}

.auth-logo {
  width: 88px;
  height: 88px;
  margin: 0 auto 20px;
  display: flex;
  align-items: center;
  justify-content: center;

  img {
    width: 100%;
    height: 100%;
    object-fit: contain;
    display: block;
  }

  @media (max-width: 540px) {
    width: 72px;
    height: 72px;
    margin-bottom: 16px;
  }
}

.auth-title {
  font-family: var(--slax-font-serif);
  font-weight: 600;
  font-size: 28px;
  letter-spacing: -0.01em;
  color: var(--slax-text);
  margin: 0 0 12px;
  line-height: 1.2;

  @media (max-width: 540px) {
    font-size: 24px;
  }
}

.auth-subtitle {
  font-size: 14px;
  line-height: 1.6;
  color: var(--slax-text-muted);
  margin: 0 0 28px;

  @media (max-width: 540px) {
    font-size: 13px;
    margin-bottom: 24px;
  }
}

.turnstile {
  margin-bottom: 16px;
}

.auth-btns {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 20px;
}

.auth-benefits {
  margin: 0 0 22px;
  padding: 14px 18px;
  list-style: none;
  text-align: start;
  background: var(--slax-accent-bg);
  border-radius: var(--slax-radius-sm);
  color: var(--slax-text);
  font-size: var(--slax-fs-meta);
  line-height: 1.5;

  li {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 5px 0;
  }
}

.auth-benefit-check {
  flex: 0 0 14px;
  color: var(--slax-accent);
  font-weight: 600;
}

.email-login-toggle {
  min-height: 44px;
  padding: 0 12px;
  border: 1px solid var(--slax-border-strong);
  border-radius: var(--slax-radius-sm);
  background: var(--slax-surface-solid);
  color: var(--slax-text);
  font-size: var(--slax-fs-meta);
  font-weight: 500;
  cursor: pointer;

  &:hover,
  &[aria-expanded='true'] {
    background: var(--slax-accent-bg);
    border-color: var(--slax-accent-soft);
  }
}

.auth-btns :deep(button:focus-visible),
.auth-tos a:focus-visible {
  outline: 2px solid var(--slax-accent);
  outline-offset: 3px;
}

.auth-tos {
  font-size: 11px;
  line-height: 1.6;
  color: var(--slax-text-light);
  margin: 0;

  a {
    color: var(--slax-text-muted);
    text-decoration: underline;
    text-underline-offset: 2px;
    text-decoration-color: var(--slax-border-strong);
    transition: all var(--slax-dur-fast);

    &:hover {
      color: var(--slax-accent);
      text-decoration-color: var(--slax-accent);
    }
  }
}
</style>
