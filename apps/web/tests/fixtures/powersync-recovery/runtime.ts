// Nuxt environment substitutes for the local-only browser fixture.
export const useRuntimeConfig = () => ({ public: { DWEB_API_BASE_URL: window.location.origin, COOKIE_TOKEN_NAME: 'synthetic_token', appVersion: 'fixture' } })
export const useAuth = () => ({ clearAuth: async () => { document.body.dataset.authCleared = 'true' } })
export const navigateTo = async () => {}
export const tryUseNuxtApp = () => ({ $i18n: { locale: { value: 'en' } } })
export const useRequestHeaders = () => ({})
