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
    <EmailCodeForm v-if="open" :id="formId" ref="form" class="email-code-form--inline email-code-form--login" :initial-email="initialEmail" :restored-challenge="restoredChallenge" @challenge="updateChallenge" retain-pending-on-success :on-challenge-issued="bindSnapshotChallenge" :verify="verifyEmail" :authenticate-passkey="passkeysSupported ? authenticatePasskey : undefined" :passkey-autofill="passkeyAutofill" />
  </div>
</template>

<script lang="ts" setup>
import AppIcon from '~/components/AppIcon.vue'
import EmailCodeForm from '~/components/Login/EmailCodeForm.vue'

import { bindSnapshotEmail, finishSnapshotSave } from '~/utils/bookmarkFork'
import { authReturnTarget } from '~/utils/emailAuth'
import { readLastLoginEmail, rememberLoginEmail } from '~/utils/lastLoginEmail'
import type { PasskeyAuthenticationMode } from '~/utils/passkeyAuth'
import { signalUnknownPasskey } from '~/utils/passkeyAuth'
import { type PendingEmailLogin,readPendingEmailLogin, writePendingEmailLogin } from '~/utils/pendingEmailLogin'
import { beginSignInLanguage } from '~/utils/signInLanguage'

import { browserSupportsPasskeys, browserSupportsWebAuthn, browserSupportsWebAuthnAutofill, getBrowserCapabilities, startAuthentication, WebAuthnAbortService } from '@simplewebauthn/browser'
import { RESTMethodPath } from '@slax-reader/contracts/const'
import type { EmailCodeInput } from '@slax-reader/contracts/email-auth'
import { isSnapshotAuthAttribution, type WebAuthAttribution } from '@slax-reader/contracts/events'
import type { PasskeyAuthenticationChallenge } from '@slax-reader/contracts/passkey'

const props = defineProps<{
  surface: 'page' | 'modal'
  redirect: string
  affcode?: string
  authAttribution?: WebAuthAttribution
}>()

const nuxtApp = useNuxtApp()
const { t } = nuxtApp.$i18n
const auth = useAuth()
const cookieDomain = useRuntimeConfig().public.COOKIE_DOMAIN
const formId = useId()
const passkeysSupported = ref(false)
const passkeyAutofill = ref(false)
let mounted = true
onBeforeUnmount(() => { mounted = false })
onMounted(async () => {
  restoredChallenge.value = readPendingEmailLogin(challengeKey())
  if (restoredChallenge.value) open.value = true
  try {
    // Older supported browsers expose WebAuthn without the newer capabilities API.
    const supported = await browserSupportsPasskeys() || (browserSupportsWebAuthn() && typeof PublicKeyCredential.getClientCapabilities !== 'function')
    if (!mounted) return
    passkeysSupported.value = supported
    if (!supported) return
    const capabilities = await getBrowserCapabilities()
    if (capabilities.conditionalGet !== 'supported') return
    const autofill = await browserSupportsWebAuthnAutofill()
    if (mounted) passkeyAutofill.value = autofill
  } catch {
    // Capability detection must leave the existing email login available.
  }
})
const challengeKey = () => {
  // The same snapshot save receives a new continuation nonce whenever its login modal reopens.
  if (props.surface === 'modal' && isSnapshotAuthAttribution(props.authAttribution)) {
    return JSON.stringify(['snapshot-save', props.authAttribution.source_bookmark_id])
  }
  return JSON.stringify([props.surface, location.pathname, authReturnTarget(props.redirect, location.origin), props.affcode || '', props.authAttribution])
}
const restoredChallenge = ref<PendingEmailLogin>()
const updateChallenge = (entry?: PendingEmailLogin) => {
  restoredChallenge.value = entry
  writePendingEmailLogin(challengeKey(), entry)
}
const open = ref(false)
const initialEmail = ref('')
const departing = ref(false)
const form = ref<InstanceType<typeof EmailCodeForm>>()

const cancel = () => {
  if (departing.value) return
  form.value?.cancel()
  open.value = false
}

defineExpose({ cancel, departing })

const toggle = () => {
  if (departing.value) return
  if (open.value) {
    updateChallenge()
    cancel()
  } else {
    beginSignInLanguage('email', nuxtApp.$i18n.locale.value, cookieDomain)
    initialEmail.value = readLastLoginEmail()
    open.value = true
    analyticsLog({ event: 'user_login_start', method: 'email' })
  }
}

const bindSnapshotChallenge = (id: string) => bindSnapshotEmail(id, props.redirect, props.authAttribution)

const continueLogin = async (email: string, target: string, token: string, signal: AbortSignal) => {
  signal.throwIfAborted()
  updateChallenge()
  rememberLoginEmail(email)
  departing.value = true
  try {
    const destination = await nuxtApp.runWithContext(() => finishSnapshotSave(target, props.authAttribution, token, signal))
    if (await nuxtApp.runWithContext(() => navigateTo(destination, { external: true })) === false) throw new Error('Login navigation did not complete')
  } catch (error) {
    departing.value = false
    throw error
  }
}

const authenticatePasskey = async (email: string, signal: AbortSignal, mode: PasskeyAuthenticationMode = {}) => {
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
    const credential = await startAuthentication({ optionsJSON: response.options, ...(mode.useBrowserAutofill ? { useBrowserAutofill: true } : {}) })
    signal.throwIfAborted()
    mode.onCredential?.()
    signal.throwIfAborted()
    let token: string
    try {
      token = await auth.verifyPasskeyAuth({
        type: 'passkey', email, request_id: response.request_id, credential,
        ...(props.authAttribution ? { auth_attribution: props.authAttribution } : {})
      }, { signal, errorInterceptors: () => {} })
    } catch (error) {
      signal.throwIfAborted()
      void signalUnknownPasskey(error, response.options.rpId ?? location.hostname, credential.id)
      throw error
    }
    await continueLogin(email, target, token, signal)
  } finally {
    signal.removeEventListener('abort', cancelCeremony)
  }
}

const verifyEmail = async (proof: EmailCodeInput, signal: AbortSignal) => {
  const target = authReturnTarget(props.redirect, location.origin)
  const token = await auth.verifyEmailAuth({
    ...proof,
    ...(props.affcode ? { aff_code: props.affcode } : {}),
    ...(props.authAttribution ? { auth_attribution: props.authAttribution } : {})
  }, { signal, errorInterceptors: () => {} })

  await continueLogin(proof.email, target, token, signal)
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
