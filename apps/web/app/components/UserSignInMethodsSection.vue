<template>
  <section class="login-methods" :aria-labelledby="titleId">
    <h3 :id="titleId">{{ t('email_auth.methods_title') }}</h3>
    <div v-for="provider in supportedProviders" :key="provider" class="login-method-group">
      <div class="login-method-row">
        <span class="login-method-icon"><AppIcon :name="provider === 'google' ? 'account.sign-in.google' : 'account.sign-in.apple'" /></span>
        <div class="login-method-label">
          <span class="login-method-name">{{ t(`email_auth.provider_${provider}`) }}</span>
          <span class="login-method-status">{{ t(linkedPlatforms.has(provider) ? 'email_auth.linked' : 'email_auth.not_linked') }}</span>
        </div>
        <button v-if="providerLinkAvailable && !linkedPlatforms.has(provider)" class="login-method-button" type="button" :disabled="Boolean(linking)" @click="linkProvider(provider)">
          {{ t(linking === provider ? 'email_auth.linking' : `email_auth.link_${provider}`) }}
        </button>
      </div>
    </div>
    <div class="login-method-group">
      <div ref="emailRow" class="login-method-row" tabindex="-1">
        <span class="login-method-icon"><AppIcon name="account.sign-in.email" /></span>
        <div class="login-method-label">
          <span class="login-method-name">{{ t('email_auth.login_email') }}</span>
          <span class="login-method-status">{{ signInEmailStatus }}</span>
        </div>
        <button v-if="!loginEmail" class="login-method-button login-method-button--quiet" type="button" :aria-expanded="emailOpen" @click="emailOpen = !emailOpen">
          {{ t(emailOpen ? 'email_auth.cancel' : 'email_auth.link_email') }}
        </button>
      </div>
      <EmailCodeForm
        v-if="emailOpen && !loginEmail"
        class="login-method-email"
        purpose="bind"
        :client="account.api"
        :verify="bindEmail"
      />
    </div>
    <UserPasskeySection v-if="passkeysEnabled" :account="account" :login-email="loginEmail" />
    <p v-if="!providerLinkAvailable && supportedProviders.some(provider => !linkedPlatforms.has(provider))" class="login-methods-note">
      {{ t('email_auth.provider_link_unavailable_here') }}
    </p>
    <p v-if="providerError" class="login-methods-error" role="alert">{{ t(providerError) }}</p>
    <p class="login-methods-announcement" role="status">{{ emailLinked ? t('email_auth.email_linked') : '' }}</p>
  </section>
</template>

<script lang="ts" setup>
import AppIcon from '~/components/AppIcon.vue'
import EmailCodeForm from '~/components/Login/EmailCodeForm.vue'
import UserPasskeySection from '~/components/UserPasskeySection.vue'

import { createAccountEmailAuthRequest } from '~/utils/accountEmailAuthRequest'
import { emailAuthErrorKey } from '~/utils/emailAuth'
import { canLinkProvidersHere, startProviderLink } from '~/utils/providerLink'

import { RESTMethodPath } from '@slax-reader/contracts/const'
import { BIND_LOGIN_IDENTITY_SETTING, type EmailAuthProvider, type EmailCodeInput } from '@slax-reader/contracts/email-auth'
import type { BindedPlatformInfo } from '@slax-reader/contracts/interface'

const props = defineProps<{ accountKey: string; profileEmail?: string; platform: BindedPlatformInfo[] }>()
const account = createAccountEmailAuthRequest(props.accountKey)
const { t } = useI18n()
const titleId = useId()
const config = useRuntimeConfig().public
const passkeysEnabled = ['development', 'preview'].includes(config.slaxEnv)
const providerLinkAvailable = canLinkProvidersHere()
const supportedProviders: EmailAuthProvider[] = [
  ...(config.GOOGLE_OAUTH_CLIENT_ID ? ['google' as const] : []),
  ...(config.APPLE_OAUTH_CLIENT_ID ? ['apple' as const] : [])
]

const platforms = ref<Pick<BindedPlatformInfo, 'platform' | 'user_name'>[]>([])
watch(() => props.platform, value => { platforms.value = [...value] }, { immediate: true })
const linkedPlatforms = computed(() => new Map(platforms.value.map(item => [item.platform, item.user_name])))
const loginEmail = computed(() => linkedPlatforms.value.get('mail'))
const signInEmailStatus = computed(() => {
  const email = loginEmail.value
  if (!email) return t('email_auth.not_linked')
  return email === props.profileEmail ? t('email_auth.same_as_profile_email') : email
})
const emailRow = ref<HTMLElement>()
const emailOpen = ref(false)
const emailLinked = ref(false)
const linking = ref<EmailAuthProvider>()
const providerError = ref('')
const lifecycle = new AbortController()

onBeforeUnmount(() => lifecycle.abort())
const bindEmail = async (proof: EmailCodeInput, signal: AbortSignal) => {
  const result = await account.api.post<{ email: string }>({
    url: RESTMethodPath.USER_INFO_SETTING,
    body: { key: BIND_LOGIN_IDENTITY_SETTING, value: { ...proof, type: 'email' } },
    signal,
    errorInterceptors: () => {}
  })
  signal.throwIfAborted()
  if (!result) throw new Error('Email linking failed')

  platforms.value.push({ platform: 'mail', user_name: result.email })
  emailOpen.value = false
  emailLinked.value = true
  await nextTick()
  emailRow.value?.focus()
}

const linkProvider = async (provider: EmailAuthProvider) => {
  if (linking.value) return
  linking.value = provider
  providerError.value = ''
  try {
    await startProviderLink(provider, lifecycle.signal, account)
  } catch (error) {
    if (!lifecycle.signal.aborted) {
      providerError.value = emailAuthErrorKey(error, 'link_failed')
      linking.value = undefined
    }
  }
}
</script>

<style scoped>
.login-methods {
  position: relative;
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid var(--slax-border);
  color: var(--slax-text);
  font-family: var(--slax-font-sans);
  font-size: var(--slax-fs-meta);
  line-height: 1.5;
}

.login-methods h3 {
  margin: 0 0 4px;
  font-size: var(--slax-fs-body);
  font-weight: 500;
}

.login-methods-note,
.login-method-status {
  color: var(--slax-text-muted);
  font-size: var(--slax-fs-aux);
  font-weight: 400;
}

.login-methods-note {
  margin: 6px 0 0;
}

.login-method-row {
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px 12px;
  min-height: 44px;
}

.login-method-group {
  padding: 12px 0;
}

.login-method-group + .login-method-group {
  border-top: 1px solid var(--slax-border);
}

.login-method-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
}

.login-method-label {
  display: grid;
  min-width: 0;
  gap: 2px;
  overflow-wrap: anywhere;
}

.login-method-name {
  font-weight: 500;
}

.login-method-button {
  min-height: 44px;
  max-width: 100%;
  padding: 8px 12px;
  border: 1px solid var(--slax-border-strong);
  border-radius: var(--slax-radius-sm);
  background: var(--slax-surface-solid);
  color: var(--slax-text);
  font: inherit;
  font-weight: 500;
  cursor: pointer;
}

.login-method-button:hover:not(:disabled) {
  background: var(--slax-accent-bg);
  border-color: var(--slax-accent-soft);
}

.login-method-button:focus-visible {
  outline: 2px solid var(--slax-accent);
  outline-offset: 2px;
}

.login-method-button:disabled {
  cursor: default;
  opacity: 0.65;
}

.login-method-button--quiet {
  border-color: transparent;
  background: transparent;
  color: var(--slax-text-muted);
}

.login-method-button--quiet:hover:not(:disabled) {
  border-color: transparent;
  background: var(--slax-accent-bg);
  color: var(--slax-text);
}

.login-method-email {
  max-width: 420px;
  margin: 12px 0 0 44px;
}

.login-methods-error {
  margin: 8px 0 0;
  border-inline-start: 2px solid var(--slax-danger);
  background: var(--slax-danger-bg);
  padding: 8px 10px;
}

.login-methods-announcement {
  position: absolute;
  width: 1px;
  height: 1px;
  clip-path: inset(50%);
  overflow: hidden;
}

@media (max-width: 540px) {
  .login-method-row {
    grid-template-columns: 24px minmax(0, 1fr) auto;
    column-gap: 10px;
  }

  .login-method-icon {
    width: 24px;
  }

  .login-method-button {
    padding-inline: 10px;
    font-size: var(--slax-fs-aux);
  }

  .login-method-email {
    margin-inline-start: 34px;
  }
}

@media (max-width: 359px) {
  .login-method-email {
    margin-inline-start: 0;
  }
}
</style>
