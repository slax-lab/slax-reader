<template>
  <div class="auth">
    <div v-if="status === 'loading'" role="status" :aria-label="t('page.auth.authenticating')">
      <div class="i-svg-spinners:180-ring-with-bg text-5xl text-accent" aria-hidden="true"></div>
    </div>
    <section v-else class="auth-error" role="alert" aria-labelledby="auth-error-title">
      <div class="auth-status-icon">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true" focusable="false">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7.5v5" />
          <circle cx="12" cy="16.5" r="0.75" fill="currentColor" stroke="none" />
        </svg>
      </div>
      <h1 id="auth-error-title">{{ t('page.auth.incomplete') }}</h1>
      <p>{{ t(status === 'timeout' ? 'page.auth.timed_out' : 'page.auth.failed') }}</p>
      <AppleLoginButton v-if="recovery.platform === 'apple'" :redirect="recovery.target" :affcode="recovery.affCode" :auth-attribution="isAcquisitionAuthAttribution(recovery.auth_attribution) ? recovery.auth_attribution : undefined" />
      <GoogleLoginButton v-else :redirect="recovery.target" :affcode="recovery.affCode" :auth-attribution="recovery.auth_attribution" />
    </section>
  </div>
</template>

<script lang="ts" setup>
import { ref } from 'vue'
import { useRoute } from 'vue-router'

import AppleLoginButton from '~/components/AppleLoginButton.vue'
import GoogleLoginButton from '~/components/GoogleLoginButton.vue'

import { readOAuthContext } from '~~/shared/utils/oauthState'

import { isAcquisitionAuthAttribution } from '@slax-reader/contracts/events'

const { t } = useI18n()
const route = useRoute()
const status = ref<'loading' | 'failed' | 'timeout'>('loading')
useHead(() => ({
  titleTemplate: `${t(status.value === 'loading' ? 'page.auth.authenticating' : 'page.auth.incomplete')} - ${t('common.app.name')}`
}))

const recoveryFragment = import.meta.client ? new URLSearchParams(location.hash.slice(1)).get('recovery') : null
const recovery = readOAuthContext(recoveryFragment ?? '', import.meta.client ? location.origin : '')
async function leaveCallback(androidCode?: string) {
  try {
    if (androidCode) {
      await navigateTo('slaxrd://auth?code=' + encodeURIComponent(androidCode), { external: true })
    } else {
      await navigateTo('/login')
    }
  } catch {
    status.value = 'failed'
  }
}

if (import.meta.client) {
  const { code, platform, result } = route.query
  if (result === 'failed' || result === 'timeout') {
    status.value = result
  } else {
    void leaveCallback(typeof code === 'string' && platform === 'android' ? code : undefined)
  }
}
</script>

<style lang="scss" scoped>
.auth {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  padding: 24px;
  padding-top: max(24px, env(safe-area-inset-top));
  padding-bottom: max(24px, env(safe-area-inset-bottom));
  color: var(--slax-text);
}

.auth-error {
  width: 100%;
  max-width: 360px;
  text-align: center;

  .auth-status-icon {
    width: 56px;
    height: 56px;
    margin: 0 auto 20px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    color: var(--slax-accent);
    background: var(--slax-accent-bg);
  }

  h1 {
    margin: 0 0 12px;
    font-size: var(--slax-fs-h2);
    line-height: 1.4;
  }

  p {
    margin: 0 0 24px;
    color: var(--slax-text-muted);
    font-size: var(--slax-fs-body);
    line-height: 1.6;
  }
}
</style>
