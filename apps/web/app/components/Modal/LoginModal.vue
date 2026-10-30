<template>
  <div class="login-modal" :class="{ appear }" @click="closeModal">
    <Transition name="modal" @after-leave="onAfterLeave">
      <div class="modal-shell" v-show="appear" @click.stop>
        <button class="modal-close" type="button" :aria-label="t('common.operate.close')" @click="closeModal">
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>

        <!-- 同 LoginView，bootloader 内自包含 -->
        <div class="auth-card">
          <div class="auth-logo">
            <img src="@images/icon-logo-login.png" :alt="t('common.app.name')" />
          </div>

          <h1 class="auth-title">{{ t('common.app.name') }}</h1>
          <p class="auth-subtitle">{{ t('component.login_view.title') }}</p>

          <ul class="auth-benefits">
            <li v-for="benefit in ['save', 'devices', 'space']" :key="benefit">
              <span class="auth-benefit-check" aria-hidden="true">✓</span>
              <span>{{ t(`component.login_view.benefits.${benefit}`) }}</span>
            </li>
          </ul>

          <div class="auth-btns">
            <GoogleLoginButton :redirect="redirect" />
            <AppleLoginButton v-if="appleLoginEnabled" :redirect="redirect" />
          </div>

          <p class="auth-tos">
            {{ t('component.login_view.tos_prefix') }}
            <a href="/terms" target="_blank" rel="noopener">{{ t('docs.title.terms') }}</a>
            {{ t('component.login_view.tos_and') }}
            <a href="/privacy" target="_blank" rel="noopener">{{ t('docs.title.privacy') }}</a>
          </p>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script lang="ts" setup>
import AppleLoginButton from '~/components/AppleLoginButton.vue'
import GoogleLoginButton from '~/components/GoogleLoginButton.vue'

defineProps({
  redirect: {
    type: String,
    required: true
  }
})

const emits = defineEmits(['close', 'dismiss', 'success'])
const runtimeConfig = useRuntimeConfig().public
const appleLoginEnabled = Boolean(runtimeConfig.APPLE_OAUTH_CLIENT_ID)

const isLocked = useScrollLock(window)
const appear = ref(false)

isLocked.value = true

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
  emits('dismiss')
}

// bootloader 无全局 $i18n，手动取 t
const t = (text: string) => useNuxtApp().$i18n.t(text)
</script>

<style lang="scss" scoped>
/* ── Overlay ── */
.login-modal {
  --slax-login-inset-top: max(24px, env(safe-area-inset-top));
  --slax-login-inset-bottom: max(24px, env(safe-area-inset-bottom));
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--slax-login-inset-top) max(24px, env(safe-area-inset-right)) var(--slax-login-inset-bottom) max(24px, env(safe-area-inset-left));
  background: transparent;
  transition: background var(--slax-dur-normal) var(--slax-ease-spring);

  &.appear {
    background: color-mix(in srgb, var(--slax-text) 22%, transparent);
    backdrop-filter: var(--slax-blur);
    -webkit-backdrop-filter: var(--slax-blur);
  }
}

/* ── Shell ── */
.modal-shell {
  position: relative;
  width: min(420px, 100%);
  user-select: none;
}

.modal-close {
  position: absolute;
  top: 14px;
  right: 14px;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  background: transparent;
  border: none;
  border-radius: var(--slax-radius-sm);
  color: var(--slax-text-muted);
  cursor: pointer;
  transition: background var(--slax-dur-normal) var(--slax-ease-spring), color var(--slax-dur-normal) var(--slax-ease-spring);

  &:hover {
    background: var(--slax-surface);
    color: var(--slax-text);
  }
}

/* ── Auth card ── */
.auth-card {
  width: 100%;
  padding: 40px 36px 32px;
  max-height: calc(100dvh - var(--slax-login-inset-top) - var(--slax-login-inset-bottom));
  overflow-y: auto;
  overscroll-behavior: contain;
  text-align: center;
  background: var(--slax-surface-solid);
  border: 1px solid var(--slax-border);
  border-radius: var(--slax-radius);
  box-shadow: var(--slax-shadow-modal);

  @media (max-width: 540px) {
    padding: 28px 20px 24px;
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
  margin: 0 0 12px;
  font-family: var(--slax-font-serif);
  font-weight: 600;
  font-size: var(--slax-fs-display);
  letter-spacing: -0.01em;
  line-height: 1.2;
  color: var(--slax-text);

  @media (max-width: 540px) {
    font-size: var(--slax-fs-h2);
  }
}

.auth-subtitle {
  margin: 0 0 28px;
  font-size: var(--slax-fs-meta);
  line-height: 1.6;
  color: var(--slax-text-muted);

  @media (max-width: 540px) {
    font-size: var(--slax-fs-aux);
    margin-bottom: 24px;
  }
}

.auth-benefits {
  margin: 0 0 22px;
  padding: 14px 18px;
  list-style: none;
  text-align: left;
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

.auth-btns {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 20px;

  :deep(button) {
    transition-timing-function: var(--slax-ease-spring);
  }
}

.auth-tos {
  margin: 0;
  font-size: var(--slax-fs-tag);
  line-height: 1.6;
  color: var(--slax-text-muted);

  a {
    color: var(--slax-text-muted);
    text-decoration: underline;
    text-underline-offset: 2px;
    text-decoration-color: var(--slax-border-strong);
    transition: color var(--slax-dur-fast) var(--slax-ease-spring), text-decoration-color var(--slax-dur-fast) var(--slax-ease-spring);

    &:hover {
      color: var(--slax-accent);
      text-decoration-color: var(--slax-accent);
    }
  }
}

.modal-close:focus-visible,
.auth-btns :deep(button:focus-visible),
.auth-tos a:focus-visible {
  outline: 2px solid var(--slax-accent);
  outline-offset: 3px;
}

/* ── Entrance and exit ── */
.modal-enter-active,
.modal-leave-active {
  transition: opacity var(--slax-dur-normal) var(--slax-ease-spring), transform var(--slax-dur-normal) var(--slax-ease-spring);
}

.modal-enter-from,
.modal-leave-to {
  opacity: 0;
  transform: translateY(-16px);
}

@media (prefers-reduced-motion: reduce) {
  .login-modal,
  .modal-close,
  .modal-enter-active,
  .modal-leave-active,
  .auth-btns :deep(button),
  .auth-tos a {
    transition: none;
  }

  .modal-enter-from,
  .modal-leave-to,
  .auth-btns :deep(button:active) {
    transform: none;
  }
}
</style>
