<template>
  <div class="auth-card" :class="{ 'has-invite': hasInvite }">
    <!-- 邀请段：通过 invite 插槽注入，与登录段共用同一张卡片 -->
    <div v-if="$slots.invite" class="invite-section">
      <slot name="invite" />
    </div>
    <div class="login-section">
      <!-- Logo -->
      <div class="auth-logo">
        <img src="@images/icon-logo-login.png" :alt="$t('common.app.name')" />
      </div>

      <!-- 标题 + 副标题 -->
      <h1 class="auth-title">{{ $t('common.app.name') }}</h1>
      <p class="auth-subtitle">{{ $t('component.login_view.title') }}</p>

      <!-- Turnstile（仅邀请码流程） -->
      <NuxtTurnstile v-if="!!affcode" v-model="turnstileCallbackToken" class="turnstile" :options="{ theme: 'light' }" />

      <!-- 登录按钮 -->
      <div v-if="showLoginBtn" class="auth-btns">
        <GoogleLoginButton ref="googleLoginBtn" :redirect="redirect" :affcode="affcode" />
        <AppleLoginButton ref="appleLoginBtn" :redirect="redirect" :affcode="affcode" />
      </div>

      <!-- 服务条款 -->
      <p class="auth-tos">
        {{ $t('component.login_view.tos_prefix') }}
        <NuxtLink to="/terms">{{ $t('docs.title.terms') }}</NuxtLink>
        {{ $t('component.login_view.tos_and') }}
        <NuxtLink to="/privacy">{{ $t('docs.title.privacy') }}</NuxtLink>
      </p>
    </div>
  </div>
</template>

<script lang="ts" setup>
import AppleLoginButton from '~/components/AppleLoginButton.vue'
import GoogleLoginButton from '~/components/GoogleLoginButton.vue'

const props = defineProps({
  redirect: {
    type: String,
    default: ''
  },
  affcode: {
    type: String,
    default: ''
  },
  // 是否存在邀请段：为真时卡片描边换 accent-soft 并下推登录段
  hasInvite: {
    type: Boolean,
    default: false
  }
})

const route = useRoute()

const turnstileCallbackToken = ref('')
const isAffUser = !!props.affcode
const showLoginBtn = computed(() => {
  return !isAffUser || (isAffUser && turnstileCallbackToken.value)
})

const googleLoginBtn = ref<InstanceType<typeof GoogleLoginButton>>()

if (route.query.from === 'homepage') {
  googleLoginBtn.value?.login()
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
