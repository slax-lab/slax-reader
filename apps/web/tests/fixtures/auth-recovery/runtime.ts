// Local-only Nuxt boundaries. Authentication, cookies, HTTP and provider buttons are real.
import auth from '../../../app/composables/useAuth'
import { getI18nLang } from '../../../i18n/config'
import { watchEffect } from 'vue'
import { createI18n } from 'vue-i18n'

const params = new URLSearchParams(location.search)
export const fixtureI18n = createI18n({ legacy: false, locale: params.get('locale') || 'en', messages: getI18nLang() })
export const useNuxtApp = () => ({ $i18n: fixtureI18n.global })
export const tryUseNuxtApp = useNuxtApp
export const useAuth = auth
export const useRequestHeaders = () => ({})
export const useRuntimeConfig = () => ({
  public: {
    DWEB_API_BASE_URL: `${location.origin}/api/${params.get('case') || 'disconnect'}`,
    AUTH_BASE_URL: location.origin,
    GOOGLE_OAUTH_CLIENT_ID: 'synthetic-google-client',
    APPLE_OAUTH_CLIENT_ID: 'synthetic-apple-client',
    COOKIE_TOKEN_NAME: 'slax_auth_probe',
    COOKIE_DOMAIN: location.hostname,
    appVersion: 'auth-recovery-fixture'
  }
})
export const navigateTo = async (target: string) => {
  if (params.get('case') === 'navigation-error') throw new Error('Synthetic navigation failure')
  location.href = target
}
export const useHead = (head: { titleTemplate: string } | (() => { titleTemplate: string })) => {
  watchEffect(() => { document.title = (typeof head === 'function' ? head() : head).titleTemplate })
}
export const analyticsLog = () => {}
export const eventLog = () => {}
export const useUserStore = () => ({ clearUserInfo: async () => {} })
