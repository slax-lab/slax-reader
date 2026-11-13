<template>
  <div class="email-login">
    <div class="email-login-header">
      <span v-if="open" class="email-login-heading">
        <AppIcon name="account.sign-in.email" :size="20" />
        <span>{{ t('email_auth.continue_with_email') }}</span>
      </span>
      <button class="email-login-toggle" :class="{ 'email-login-cancel': open }" type="button" :disabled="departing" :aria-expanded="open" :aria-controls="open ? formId : undefined" @click="toggle">
        <AppIcon v-if="!open" name="account.sign-in.email" :size="20" />
        <span>{{ t(open ? 'email_auth.cancel' : 'email_auth.continue_with_email') }}</span>
      </button>
    </div>
    <EmailCodeForm v-if="open" :id="formId" ref="form" class="email-code-form--inline email-code-form--login" :initial-email="initialEmail" retain-pending-on-success :verify="verifyEmail" :authenticate-passkey="passkeysEnabled ? authenticatePasskey : undefined" />
  </div>
</template>

<script lang="ts" setup>
import AppIcon from '~/components/AppIcon.vue'
import EmailCodeForm from '~/components/Login/EmailCodeForm.vue'

import { authReturnTarget } from '~/utils/emailAuth'
import { readLastLoginEmail, rememberLoginEmail } from '~/utils/lastLoginEmail'

import { startAuthentication, WebAuthnAbortService } from '@simplewebauthn/browser'
import { RESTMethodPath } from '@slax-reader/contracts/const'
import type { EmailCodeInput } from '@slax-reader/contracts/email-auth'
import type { WebAuthAttribution } from '@slax-reader/contracts/events'
import type { PasskeyAuthenticationChallenge } from '@slax-reader/contracts/passkey'

const props = defineProps<{
  redirect: string
  affcode?: string
  authAttribution?: WebAuthAttribution
}>()

const nuxtApp = useNuxtApp()
const { t } = nuxtApp.$i18n
const auth = useAuth()
const formId = useId()
const passkeysEnabled = ['development', 'preview'].includes(useRuntimeConfig().public.slaxEnv)
const open = ref(false)
const initialEmail = ref('')
const departing = ref(false)
const form = ref<InstanceType<typeof EmailCodeForm>>()

const cancel = () => {
  if (departing.value) return
  form.value?.cancel()
  open.value = false
}

defineExpose({ cancel })

const toggle = () => {
  if (departing.value) return
  if (open.value) {
    cancel()
  } else {
    initialEmail.value = readLastLoginEmail()
    open.value = true
    analyticsLog({ event: 'user_login_start', method: 'email' })
  }
}

const continueLogin = async (email: string, target: string, signal: AbortSignal) => {
  signal.throwIfAborted()
  rememberLoginEmail(email)
  departing.value = true
  try {
    if (await nuxtApp.runWithContext(() => navigateTo(target, { external: true })) === false) throw new Error('Login navigation did not complete')
  } catch (error) {
    departing.value = false
    throw error
  }
}

const authenticatePasskey = async (email: string, signal: AbortSignal) => {
  const target = authReturnTarget(props.redirect, location.origin)
  const response = await request().post<PasskeyAuthenticationChallenge>({
    url: RESTMethodPath.PASSKEY_CHALLENGE,
    body: { purpose: 'login', email },
    signal,
    errorInterceptors: () => {}
  })
  signal.throwIfAborted()
  if (!response || response.purpose !== 'login') throw new Error('Passkey challenge failed')
  const cancelCeremony = () => WebAuthnAbortService.cancelCeremony()
  signal.addEventListener('abort', cancelCeremony, { once: true })
  try {
    const credential = await startAuthentication({ optionsJSON: response.options })
    signal.throwIfAborted()
    await auth.verifyPasskeyAuth({
      type: 'passkey', email, request_id: response.request_id, credential,
      ...(props.authAttribution ? { auth_attribution: props.authAttribution } : {})
    }, { signal, errorInterceptors: () => {} })
    await continueLogin(email, target, signal)
  } finally {
    signal.removeEventListener('abort', cancelCeremony)
  }
}

const verifyEmail = async (proof: EmailCodeInput, signal: AbortSignal) => {
  const target = authReturnTarget(props.redirect, location.origin)
  await auth.verifyEmailAuth({
    ...proof,
    ...(props.affcode ? { aff_code: props.affcode } : {}),
    ...(props.authAttribution ? { auth_attribution: props.authAttribution } : {})
  }, { signal, errorInterceptors: () => {} })

  await continueLogin(proof.email, target, signal)
}
</script>

<style scoped>
.email-login {
  display: grid;
  min-width: 0;
  gap: 12px;
  font-family: var(--slax-font-sans);
  text-align: start;
}

.email-login-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-width: 0;
}

.email-login-heading {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  color: var(--slax-text);
  font-size: var(--slax-fs-meta);
  font-weight: 500;
  line-height: 1.5;
}

.email-login-heading > :first-child {
  flex-shrink: 0;
}

.email-login-toggle {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  min-height: 44px;
  padding: 0 12px;
  border: 1px solid transparent;
  border-radius: var(--slax-radius-sm);
  background: transparent;
  color: var(--slax-text-muted);
  font-family: inherit;
  font-size: var(--slax-fs-meta);
  font-weight: 500;
  line-height: 1.5;
  cursor: pointer;
}

.email-login-toggle:hover:not(:disabled) {
  background: var(--slax-accent-bg);
  color: var(--slax-text);
}

.email-login-toggle:disabled {
  cursor: default;
  opacity: 0.65;
}

.email-login-cancel {
  flex-shrink: 0;
  width: auto;
  border-color: transparent;
  background: transparent;
  color: var(--slax-text-muted);
}

.email-login-cancel:hover:not(:disabled) {
  border-color: transparent;
  color: var(--slax-text);
}

.email-login-toggle:focus-visible {
  outline: 2px solid var(--slax-accent);
  outline-offset: 3px;
}
</style>
