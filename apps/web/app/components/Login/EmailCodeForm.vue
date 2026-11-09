<template>
  <form class="email-code-form" :aria-busy="Boolean(pending)" @submit.prevent="challenge ? verifyCode() : sendCode()">
    <template v-if="challenge">
      <p class="email-code-message" role="status">{{ t('email_auth.code_sent', { email }) }}</p>
      <label class="email-code-field">
        {{ t('email_auth.code_label') }}
        <input
          ref="codeInput"
          v-model.trim="code"
          type="text"
          inputmode="numeric"
          autocomplete="one-time-code"
          pattern="[0-9]{6}"
          maxlength="6"
          :disabled="Boolean(pending)"
          required
        />
      </label>
      <p v-if="expired" class="email-code-message" role="status">{{ t('email_auth.expired') }}</p>
    </template>
    <label v-else class="email-code-field">
      {{ t('email_auth.address_label') }}
      <input ref="emailInput" v-model.trim="email" type="email" autocomplete="email" maxlength="254" :disabled="Boolean(pending)" required />
    </label>

    <p v-if="errorKey" class="email-code-error" role="alert">{{ t(errorKey) }}</p>
    <button class="email-code-button" type="submit" :disabled="Boolean(pending) || expired">
      {{ t(pending === 'verify' ? 'email_auth.verifying' : pending === 'send' && !challenge ? 'email_auth.sending' : challenge ? 'email_auth.verify' : 'email_auth.send') }}
    </button>
    <div v-if="challenge" class="email-code-actions">
      <button type="button" @click="editEmail">{{ t('email_auth.change_address') }}</button>
      <button type="button" :disabled="Boolean(pending) || secondsToResend > 0" @click="sendCode">
        {{ pending === 'send' ? t('email_auth.sending') : secondsToResend > 0 ? t('email_auth.resend_in', { seconds: secondsToResend }) : t('email_auth.resend') }}
      </button>
    </div>
  </form>
</template>

<script lang="ts" setup>
import { emailAuthErrorKey } from '~/utils/emailAuth'

import type { FetchRequest } from '@commons/frontend-utils/request'
import type { EmailCodeChallenge, EmailCodeInput } from '@slax-reader/contracts/email-auth'

const props = defineProps<{
  sendUrl: string
  client?: Pick<FetchRequest, 'post'>
  verify: (proof: EmailCodeInput, signal: AbortSignal) => Promise<void>
}>()
const { $i18n } = useNuxtApp()
const { t, locale } = $i18n
const email = ref('')
const code = ref('')
const emailInput = ref<HTMLInputElement>()
const codeInput = ref<HTMLInputElement>()
const challenge = ref<EmailCodeChallenge>()
const pending = ref<'send' | 'verify'>()
const errorKey = ref('')
const clock = ref(Date.now())
const sentAt = ref(0)
const expired = computed(() => Boolean(challenge.value && clock.value >= sentAt.value + challenge.value.expires_in * 1000))
const secondsToResend = computed(() =>
  challenge.value ? Math.max(0, Math.ceil((sentAt.value + challenge.value.resend_after * 1000 - clock.value) / 1000)) : 0
)

let operation: AbortController | undefined
let ticker: ReturnType<typeof setInterval> | undefined

const stop = () => {
  operation?.abort()
  operation = undefined
  pending.value = undefined
  clearInterval(ticker)
}

onMounted(() => emailInput.value?.focus())
onBeforeUnmount(stop)
defineExpose({ cancel: stop })

const editEmail = async () => {
  stop()
  challenge.value = undefined
  errorKey.value = ''
  code.value = ''
  await nextTick()
  emailInput.value?.focus()
}

const sendCode = async () => {
  if (pending.value || secondsToResend.value > 0) return
  const controller = new AbortController()
  operation = controller
  pending.value = 'send'
  errorKey.value = ''

  try {
    const response = await (props.client ?? request()).post<EmailCodeChallenge>({
      url: props.sendUrl,
      body: { email: email.value, locale: locale.value },
      signal: controller.signal,
      errorInterceptors: () => {}
    })
    controller.signal.throwIfAborted()
    if (!response) throw new Error('Email code request failed')
    clock.value = sentAt.value = Date.now()
    challenge.value = response
    code.value = ''
    clearInterval(ticker)
    ticker = setInterval(() => {
      clock.value = Date.now()
      if (expired.value && secondsToResend.value === 0) clearInterval(ticker)
    }, 1000)
    pending.value = undefined
    await nextTick()
    if (!controller.signal.aborted) codeInput.value?.focus()
  } catch (error) {
    if (!controller.signal.aborted) errorKey.value = emailAuthErrorKey(error, 'send_failed')
  } finally {
    if (operation === controller) {
      operation = undefined
      pending.value = undefined
    }
  }
}

const verifyCode = async () => {
  clock.value = Date.now()
  if (pending.value || !challenge.value || expired.value || !/^[0-9]{6}$/.test(code.value)) return
  const controller = new AbortController()
  operation = controller
  pending.value = 'verify'
  errorKey.value = ''

  try {
    await props.verify({ email: email.value, request_id: challenge.value.request_id, code: code.value }, controller.signal)
  } catch (error) {
    if (!controller.signal.aborted) errorKey.value = emailAuthErrorKey(error, 'verify_failed')
  } finally {
    if (operation === controller) {
      operation = undefined
      pending.value = undefined
    }
  }
}
</script>

<style scoped>
.email-code-form {
  display: grid;
  gap: 10px;
  text-align: start;
  font-size: var(--slax-fs-meta);
  color: var(--slax-text);
}

.email-code-field {
  display: grid;
  gap: 6px;
  font-weight: 500;
}

.email-code-field input,
.email-code-button {
  min-height: 44px;
  width: 100%;
  padding: 0 12px;
  border: 1px solid var(--slax-border-strong);
  border-radius: var(--slax-radius-sm);
  background: var(--slax-surface-solid);
  color: var(--slax-text);
  font: inherit;
}

.email-code-button,
.email-code-actions button {
  cursor: pointer;
}

.email-code-button:hover:not(:disabled) {
  background: var(--slax-accent-bg);
  border-color: var(--slax-accent-soft);
}

.email-code-form :is(button, input):focus-visible {
  outline: 2px solid var(--slax-accent);
  outline-offset: 2px;
}

.email-code-form :disabled {
  cursor: default;
  opacity: 0.65;
}

.email-code-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  column-gap: 16px;
}

.email-code-actions button {
  min-height: 44px;
  border: 0;
  padding: 0;
  background: none;
  color: var(--slax-text);
  font: inherit;
  text-decoration: underline;
  text-underline-offset: 3px;
}

.email-code-actions button:hover:not(:disabled) {
  color: var(--slax-link);
}

.email-code-message,
.email-code-error {
  margin: 0;
  overflow-wrap: anywhere;
  color: var(--slax-text-muted);
}

.email-code-error {
  border-inline-start: 2px solid var(--slax-danger);
  background: var(--slax-danger-bg);
  padding: 8px 10px;
  color: var(--slax-text);
}
</style>
