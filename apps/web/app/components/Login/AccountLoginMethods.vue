<template>
  <section v-if="identities?.enabled" class="login-methods" :aria-labelledby="titleId">
    <h3 :id="titleId">{{ t('email_auth.methods_title') }}</h3>
    <div v-if="identities.show_email_binding || identities.email" ref="emailRow" class="login-method-row" tabindex="-1">
      <div class="login-method-label">
        <strong>{{ t('email_auth.login_email') }}</strong>
        <span>{{ signInEmailStatus }}</span>
      </div>
      <button v-if="!identities.email" class="login-method-button" type="button" :aria-expanded="emailOpen" @click="emailOpen = !emailOpen">
        {{ t(emailOpen ? 'email_auth.cancel' : 'email_auth.link_email') }}
      </button>
    </div>
    <EmailCodeForm
      v-if="identities.show_email_binding && emailOpen && !identities.email"
      class="login-method-email"
      purpose="bind"
      :client="account.api"
      :verify="bindEmail"
    />
    <div v-for="provider in supportedProviders" :key="provider" class="login-method-row">
      <div class="login-method-label">
        <strong>{{ t(`email_auth.provider_${provider}`) }}</strong>
        <span>{{ t(identities[provider] ? 'email_auth.linked' : 'email_auth.not_linked') }}</span>
      </div>
      <button v-if="providerLinkAvailable && !identities[provider]" class="login-method-button" type="button" :disabled="Boolean(linking)" @click="linkProvider(provider)">
        {{ t(linking === provider ? 'email_auth.linking' : `email_auth.link_${provider}`) }}
      </button>
    </div>
    <p v-if="!providerLinkAvailable && supportedProviders.some(provider => !identities?.[provider])" class="login-methods-note">
      {{ t('email_auth.provider_link_unavailable_here') }}
    </p>
    <p v-if="providerError" class="login-methods-error" role="alert">{{ t(providerError) }}</p>
    <p class="login-methods-announcement" role="status">{{ emailLinked ? t('email_auth.email_linked') : '' }}</p>
  </section>
</template>

<script lang="ts" setup>
import EmailCodeForm from '~/components/Login/EmailCodeForm.vue'

import { createAccountEmailAuthRequest } from '~/utils/accountEmailAuthRequest'
import { emailAuthErrorKey } from '~/utils/emailAuth'
import { canLinkProvidersHere, type LinkProvider, startProviderLink } from '~/utils/providerLink'

import { EMAIL_AUTH_PATH, type EmailAuthIdentities, type EmailCodeInput } from '@slax-reader/contracts/email-auth'

const props = defineProps<{ accountKey: string; profileEmail?: string; loginIdentities?: EmailAuthIdentities }>()
const account = createAccountEmailAuthRequest(props.accountKey)
const { t } = useI18n()
const titleId = useId()
const config = useRuntimeConfig().public
const providerLinkAvailable = canLinkProvidersHere()
const supportedProviders: LinkProvider[] = [
  ...(config.GOOGLE_OAUTH_CLIENT_ID ? ['google' as const] : []),
  ...(config.APPLE_OAUTH_CLIENT_ID ? ['apple' as const] : [])
]

const identities = ref<EmailAuthIdentities>()
watch(() => props.loginIdentities, value => { identities.value = value && { ...value } }, { immediate: true })
const signInEmailStatus = computed(() => {
  const email = identities.value?.email
  if (!email) return t('email_auth.not_linked')
  return email === props.profileEmail ? t('email_auth.same_as_profile_email') : email
})
const emailRow = ref<HTMLElement>()
const emailOpen = ref(false)
const emailLinked = ref(false)
const linking = ref<LinkProvider>()
const providerError = ref('')
const lifecycle = new AbortController()

onBeforeUnmount(() => lifecycle.abort())
const bindEmail = async (proof: EmailCodeInput, signal: AbortSignal) => {
  const result = await account.api.post<{ email: string }>({
    url: EMAIL_AUTH_PATH.bind,
    body: { ...proof, type: 'email' },
    signal,
    errorInterceptors: () => {}
  })
  signal.throwIfAborted()
  if (!result || !identities.value) throw new Error('Email linking failed')

  identities.value.email = result.email
  emailOpen.value = false
  emailLinked.value = true
  await nextTick()
  emailRow.value?.focus()
}

const linkProvider = async (provider: LinkProvider) => {
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
  font-size: var(--slax-fs-meta);
}

.login-methods h3 {
  margin: 0 0 6px;
  font-size: var(--slax-fs-body);
}

.login-methods-note,
.login-method-label span {
  color: var(--slax-text-muted);
}

.login-methods-note {
  margin: 6px 0 0;
}

.login-method-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  column-gap: 12px;
  min-height: 48px;
  padding: 2px 0;
}

.login-method-row + .login-method-row,
.login-method-email + .login-method-row {
  border-top: 1px solid var(--slax-border);
}

.login-method-label {
  display: grid;
  grid-template-columns: minmax(0, 9rem) minmax(0, 1fr);
  align-items: baseline;
  gap: 2px 12px;
  overflow-wrap: anywhere;
}

.login-method-button {
  min-height: 44px;
  padding: 0 12px;
  border: 1px solid var(--slax-border-strong);
  border-radius: var(--slax-radius-sm);
  background: var(--slax-surface-solid);
  color: var(--slax-text);
  font: inherit;
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

.login-method-email {
  max-width: 420px;
  margin: 8px 0 16px;
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
  .login-method-label {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
