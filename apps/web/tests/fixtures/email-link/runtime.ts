import auth from '../../../app/composables/useAuth'
import { getI18nLang } from '../../../i18n/config'
import { watchEffect } from 'vue'
import { createI18n } from 'vue-i18n'

export const fixtureI18n = createI18n({ legacy: false, locale: 'zh', messages: getI18nLang() })
export const useNuxtApp = () => ({ $i18n: fixtureI18n.global })
export const tryUseNuxtApp = useNuxtApp
export const useAuth = auth
export const useRequestHeaders = () => ({})
export const useRuntimeConfig = () => ({ public: {
  DWEB_API_BASE_URL: `${location.origin}/api`, AUTH_BASE_URL: location.origin,
  COOKIE_TOKEN_NAME: 'slax_email_link_preview', COOKIE_DOMAIN: location.hostname,
  GOOGLE_OAUTH_CLIENT_ID: 'fixture-only', APPLE_OAUTH_CLIENT_ID: 'fixture-only', appVersion: 'email-link-fixture'
} })
export const navigateTo = async (target: string) => { location.href = target }
export const useHead = (head: () => { titleTemplate: string }) => { watchEffect(() => {document.title = head().titleTemplate}) }
export const useUserStore = () => ({ clearUserInfo: async () => {} })
