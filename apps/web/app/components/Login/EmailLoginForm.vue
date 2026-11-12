<template>
  <div v-if="emailEnabled" class="email-login">
    <div class="email-login-header">
      <span v-if="open" class="email-login-heading">
        <AppIcon name="account.sign-in.email" :size="20" />
        <span>{{ t('email_auth.continue_with_email') }}</span>
      </span>
      <button class="email-login-toggle" :class="{ 'email-login-cancel': open }" type="button" :aria-expanded="open" :aria-controls="open ? formId : undefined" @click="toggle">
        <AppIcon v-if="!open" name="account.sign-in.email" :size="20" />
        <span>{{ t(open ? 'email_auth.cancel' : 'email_auth.continue_with_email') }}</span>
      </button>
    </div>
    <EmailCodeForm v-if="open" :id="formId" ref="form" class="email-code-form--inline email-code-form--login" :verify="verifyEmail" />
  </div>
</template>

<script lang="ts" setup>
import AppIcon from '~/components/AppIcon.vue'
import EmailCodeForm from '~/components/Login/EmailCodeForm.vue'

import { authReturnTarget } from '~/utils/emailAuth'

import type { EmailCodeInput } from '@slax-reader/contracts/email-auth'
import type { WebAuthAttribution } from '@slax-reader/contracts/events'

const props = defineProps<{
  redirect: string
  affcode?: string
  authAttribution?: WebAuthAttribution
}>()

const nuxtApp = useNuxtApp()
const emailEnabled = ['development', 'preview'].includes(useRuntimeConfig().public.slaxEnv)
const { t } = nuxtApp.$i18n
const auth = useAuth()
const formId = useId()
const open = ref(false)
const form = ref<InstanceType<typeof EmailCodeForm>>()

const cancel = () => {
  form.value?.cancel()
  open.value = false
}

defineExpose({ cancel })

const toggle = () => {
  if (open.value) {
    cancel()
  } else {
    open.value = true
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
  border: 1px solid var(--slax-border-strong);
  border-radius: var(--slax-radius-sm);
  background: var(--slax-surface-solid);
  color: var(--slax-text);
  font-family: inherit;
  font-size: var(--slax-fs-meta);
  font-weight: 500;
  line-height: 1.5;
  cursor: pointer;
}

.email-login-toggle:hover {
  background: var(--slax-accent-bg);
  border-color: var(--slax-accent-soft);
}

.email-login-cancel {
  flex-shrink: 0;
  width: auto;
  border-color: transparent;
  background: transparent;
  color: var(--slax-text-muted);
}

.email-login-cancel:hover {
  border-color: transparent;
  color: var(--slax-text);
}

.email-login-toggle:focus-visible {
  outline: 2px solid var(--slax-accent);
  outline-offset: 3px;
}
</style>
