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
      <AppleLoginButton v-if="recovery.platform === 'apple'" :redirect="recovery.target" :affcode="recovery.affCode" :auth-attribution="isAcquisitionAuthAttribution(recovery.authAttribution) ? recovery.authAttribution : undefined" />
      <GoogleLoginButton v-else :redirect="recovery.target" :affcode="recovery.affCode" :auth-attribution="recovery.authAttribution" />
    </section>
  </div>
</template>

<script lang="ts" setup>
import { onUnmounted, ref } from 'vue'
import { useRoute } from 'vue-router'

import AppleLoginButton from '~/components/AppleLoginButton.vue'
import GoogleLoginButton from '~/components/GoogleLoginButton.vue'

import { digestOAuthState, normalizeOAuthContext, oauthCookieName, oauthCookieOptions, readOAuthState } from '~~/shared/utils/oauthState'

import { isAcquisitionAuthAttribution, type WebAuthAttribution } from '@slax-reader/contracts/events'
import { useCookies } from '@vueuse/integrations/useCookies'

const { t } = useI18n()

const route = useRoute()
const auth = useAuth()
const status = ref<'loading' | 'failed' | 'timeout'>('loading')
useHead(() => ({
  titleTemplate: `${t(status.value === 'loading' ? 'page.auth.authenticating' : 'page.auth.incomplete')} - ${t('common.app.name')}`
}))
const recovery = ref({ target: '/bookmarks', affCode: '', platform: 'google' as 'google' | 'apple', authAttribution: undefined as WebAuthAttribution | undefined })

if (import.meta.client) {
  const controller = new AbortController()
  let deadline: ReturnType<typeof setTimeout> | undefined
  const cookies = useCookies()
  const secure = location.protocol === 'https:'
  let bindingName: string | undefined
  const clearBinding = () => {
    if (bindingName) cookies.remove(bindingName, oauthCookieOptions(secure))
    bindingName = undefined
  }
  let phase: 'parameters' | 'login' | 'navigation' = 'parameters'

  onUnmounted(() => {
    clearTimeout(deadline)
    controller.abort()
    clearBinding()
  })

  const grantAuth = async () => {
    try {
      if (!route.query.code) {
        await navigateTo('/login')
        return
      }
      const { code, state } = route.query
      if (typeof code !== 'string') throw new Error('Invalid authorization code')
      if (route.query.platform === 'android') {
        await navigateTo('slaxrd://auth?code=' + code, { external: true })
        return
      }
      if (typeof state !== 'string') throw new Error('Missing OAuth state')
      const attempt = readOAuthState(state)
      if (!attempt) throw new Error('Invalid OAuth state')
      const name = oauthCookieName(attempt.nonce, secure)
      if (cookies.get(name, { doNotParse: true }) !== await digestOAuthState(state)) throw new Error('Unbound OAuth state')
      if (controller.signal.aborted) throw controller.signal.reason
      bindingName = name
      const context = normalizeOAuthContext(attempt, location.origin)
      recovery.value = { target: context.target, affCode: context.affCode, platform: context.platform, authAttribution: context.auth_attribution }
      deadline = setTimeout(() => {
        console.warn('[auth] callback timed out', { phase })
        status.value = 'timeout'
        controller.abort()
      }, 20_000)
      phase = 'login'
      const target = await auth.grantAuth(code, state, controller.signal)
      if (controller.signal.aborted) return
      phase = 'navigation'
      if (await navigateTo(target, { external: true }) === false) {
        throw new Error('Authentication navigation did not complete')
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        // OAuth parameters and raw errors may contain credentials; record only the phase.
        console.warn('[auth] callback failed', { phase })
        status.value = error instanceof DOMException && error.name === 'TimeoutError' ? 'timeout' : 'failed'
      }
    } finally {
      clearBinding()
      clearTimeout(deadline)
    }
  }

  grantAuth()
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
