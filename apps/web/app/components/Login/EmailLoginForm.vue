<template>
  <button class="email-login-toggle" type="button" :aria-expanded="open" @click="toggle">
    {{ t(open ? 'email_auth.cancel' : 'email_auth.continue_with_email') }}
  </button>
  <EmailCodeForm v-if="open" ref="form" :verify="verifyEmail" />
</template>

<script lang="ts" setup>
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
const { t } = nuxtApp.$i18n
const auth = useAuth()
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
}

.email-login-toggle:hover,
.email-login-toggle[aria-expanded='true'] {
  background: var(--slax-accent-bg);
  border-color: var(--slax-accent-soft);
}

.email-login-toggle:focus-visible {
  outline: 2px solid var(--slax-accent);
  outline-offset: 3px;
}
</style>
