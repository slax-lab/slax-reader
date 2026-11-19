<template>
  <main class="email-link-page">
    <section class="email-link-card" :role="status === 'failed' ? 'alert' : 'status'" aria-live="polite">
      <h1>{{ t(title) }}</h1>
      <p v-if="status !== 'loading'">{{ t(status === 'signed-in' ? 'email_auth.sign_in_link_active' : message) }}</p>
      <a v-if="status !== 'loading'" :href="status === 'signed-in' ? '/bookmarks' : '/login'">
        {{ t(status === 'signed-in' ? 'email_auth.sign_in_link_keep_account' : 'email_auth.back_to_sign_in') }}
      </a>
    </section>
  </main>
</template>

<script setup lang="ts">
import { EMAIL_LOGIN_WEB_PATH } from '@slax-reader/contracts/email-auth'
import { useEmailLinkLogin } from '~/composables/useEmailLinkLogin'

definePageMeta({ alias: [EMAIL_LOGIN_WEB_PATH] })
const { t } = useI18n()
const { status, message } = useEmailLinkLogin()
const title = computed(() => status.value === 'loading' ? 'email_auth.signing_in_link' : status.value === 'signed-in' ? 'email_auth.sign_in_link_active_title' : 'page.auth.incomplete')
useHead(() => ({ titleTemplate: `${t(title.value)} - Slax Reader` }))
</script>

<style scoped>
.email-link-page {
  min-height: 100dvh;
  display: grid;
  place-items: center;
  padding: 24px 16px;
  background: var(--slax-bg);
  color: var(--slax-text);
}
.email-link-card { width: 100%; max-width: 420px; text-align: center; }
h1 { margin: 0 0 16px; font-size: var(--slax-fs-h2); }
p { margin: 0 0 24px; color: var(--slax-text-muted); font-size: var(--slax-fs-body); line-height: 1.6; }
a {
  min-height: 44px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 16px;
  border: 1px solid var(--slax-border-strong);
  border-radius: var(--slax-radius-sm);
  color: var(--slax-text);
  text-decoration: none;
}
a:hover { background: var(--slax-accent-bg); }
a:focus-visible { outline: 2px solid var(--slax-accent); outline-offset: 2px; }
</style>
