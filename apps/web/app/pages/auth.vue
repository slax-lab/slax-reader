<template>
  <div class="auth">
    <div v-if="status === 'loading'" role="status" :aria-label="t(statusTitle)">
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
      <h1 id="auth-error-title">{{ t(statusTitle) }}</h1>
      <p>{{ t(recoveryMessage) }}</p>
      <a v-if="linkState" class="auth-recovery-link" href="/user#account">{{ t('email_auth.back_to_settings') }}</a>
      <a v-else-if="requiresExistingLogin" class="auth-recovery-link" :href="existingLoginTarget">{{ t('email_auth.back_to_sign_in') }}</a>
      <AppleLoginButton v-else-if="recovery.platform === 'apple'" :redirect="recovery.target" :affcode="recovery.affCode" :auth-attribution="isAcquisitionAuthAttribution(recovery.authAttribution) ? recovery.authAttribution : undefined" />
      <GoogleLoginButton v-else :redirect="recovery.target" :affcode="recovery.affCode" :auth-attribution="recovery.authAttribution" />
    </section>
  </div>
</template>

<script lang="ts" setup>
import { onUnmounted, ref } from 'vue'
import { useRoute } from 'vue-router'

import AppleLoginButton from '~/components/AppleLoginButton.vue'
import GoogleLoginButton from '~/components/GoogleLoginButton.vue'

import { authReturnTarget, emailAuthErrorKey } from '~/utils/emailAuth'
import { finishProviderLink, isProviderLinkState, takePendingProviderLink } from '~/utils/providerLink'

import { isAcquisitionAuthAttribution, type WebAuthAttribution } from '@slax-reader/contracts/events'
import { z } from 'zod'

const { t } = useI18n()

const callbackState = z.object({
  redirectUrl: z.string().min(1),
  target: z.string().optional().default('/bookmarks'),
  affCode: z.string().optional().default(''),
  platform: z.enum(['google', 'apple']).optional().default('google'),
  auth_attribution: z.union([
    z.object({
      collection_id: z.string().min(1).max(64).regex(/^[a-zA-Z0-9]+$/),
      source_screen: z.literal('collection'),
      presentation: z.literal('modal'),
      trigger_element_id: z.literal('collection_subscribe_button')
    }),
    z.object({
      source: z.literal('hackerlinks'),
      medium: z.enum(['header', 'resource_detail']),
      campaign: z.literal('mvp')
    })
  ]).optional().catch(undefined)
})

const route = useRoute()
const auth = useAuth()
const status = ref<'loading' | 'failed' | 'timeout'>('loading')
const linkState = isProviderLinkState(route.query.state) ? route.query.state : undefined
const linkError = ref('email_auth.link_failed')
const requiresExistingLogin = ref(false)
const statusTitle = computed(() =>
  status.value === 'loading'
    ? linkState ? 'email_auth.linking' : 'page.auth.authenticating'
    : linkState ? 'email_auth.link_incomplete' : 'page.auth.incomplete'
)
const recoveryMessage = computed(() => {
  if (linkState) return linkError.value
  if (requiresExistingLogin.value) return 'email_auth.use_existing_login'
  return status.value === 'timeout' ? 'page.auth.timed_out' : 'page.auth.failed'
})
useHead(() => ({
  titleTemplate: `${t(statusTitle.value)} - ${t('common.app.name')}`
}))
const recovery = ref({ target: '/bookmarks', affCode: '', platform: 'google' as 'google' | 'apple', authAttribution: undefined as WebAuthAttribution | undefined })
const existingLoginTarget = computed(() => {
  const { target, affCode, authAttribution } = recovery.value
  const query = new URLSearchParams({
    redirect: authReturnTarget(target, location.origin),
    ...(affCode ? { aff: affCode } : {}),
    ...(isAcquisitionAuthAttribution(authAttribution) ? {
      utm_source: authAttribution.source,
      utm_medium: authAttribution.medium,
      utm_campaign: authAttribution.campaign
    } : {})
  })
  return `/login?${query}`
})

if (import.meta.client) {
  const controller = new AbortController()
  let deadline: ReturnType<typeof setTimeout> | undefined
  let phase: 'parameters' | 'login' | 'navigation' = 'parameters'

  onUnmounted(() => {
    clearTimeout(deadline)
    controller.abort()
  })

  const completeLink = async (state: string) => {
    try {
      const type = takePendingProviderLink(state)
      const { code, error } = route.query
      if (!type || typeof code !== 'string' || !code || error) throw new Error('No active provider link callback')
      deadline = setTimeout(() => {
        status.value = 'timeout'
        linkError.value = 'email_auth.link_timed_out'
        controller.abort()
      }, 20_000)
      await finishProviderLink(state, type, code, { signal: controller.signal, errorInterceptors: () => {} })
      controller.signal.throwIfAborted()
      if (await navigateTo('/user#account', { replace: true }) === false) throw new Error('Provider link navigation did not complete')
    } catch (error) {
      if (!controller.signal.aborted) {
        linkError.value = emailAuthErrorKey(error, 'link_failed')
        status.value = 'failed'
      }
    } finally {
      clearTimeout(deadline)
    }
  }

  const grantAuth = async () => {
    try {
      if (!route.query.code) {
        await navigateTo('/login')
        return
      }
      const code = z.string().parse(route.query.code)
      if (route.query.platform === 'android') {
        await navigateTo('slaxrd://auth?code=' + code, { external: true })
        return
      }
      const state = callbackState.parse(JSON.parse(z.string().parse(route.query.state)))
      const authAttribution = state.platform === 'apple' && !isAcquisitionAuthAttribution(state.auth_attribution) ? undefined : state.auth_attribution
      recovery.value = { target: state.target || '/bookmarks', affCode: state.affCode, platform: state.platform, authAttribution }
      deadline = setTimeout(() => {
        console.warn('[auth] callback timed out', { phase })
        status.value = 'timeout'
        controller.abort()
      }, 20_000)
      phase = 'login'
      await auth.grantAuth(code, state.redirectUrl, state.affCode, state.platform, authAttribution, {
        signal: controller.signal,
        // The callback owns persistent recovery instead of the shared request toast.
        errorInterceptors: () => {}
      })
      if (controller.signal.aborted) return
      phase = 'navigation'
      if (await navigateTo(recovery.value.target, { external: true }) === false) {
        throw new Error('Authentication navigation did not complete')
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        requiresExistingLogin.value = emailAuthErrorKey(error, 'verify_failed') === 'email_auth.use_existing_login'
        // OAuth parameters and raw errors may contain credentials; record only the phase.
        console.warn('[auth] callback failed', { phase })
        status.value = 'failed'
      }
    } finally {
      clearTimeout(deadline)
    }
  }

  if (linkState) completeLink(linkState)
  else grantAuth()
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

  .auth-recovery-link {
    display: inline-grid;
    min-height: 44px;
    align-items: center;
    padding: 0 16px;
    border: 1px solid var(--slax-border-strong);
    border-radius: var(--slax-radius-sm);
    color: var(--slax-text);
    text-decoration: none;

    &:hover {
      background: var(--slax-accent-bg);
    }

    &:focus-visible {
      outline: 2px solid var(--slax-accent);
      outline-offset: 2px;
    }
  }

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
