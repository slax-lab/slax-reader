import type { PiniaPluginContext } from 'pinia'

function userStoreExtensionPlugin(context: PiniaPluginContext) {
  const { store } = context

  store.$state = {
    ...store.$state
  }

  store.getAlertedGetSubscribeStatus = (alertedType: string) => {
    return store.$state.alertedType
  }

  store.updateAlertedGetSubscribeStatus = (alertedType: string, status: boolean) => {
    store.$state.type = alertedType
  }

  if (store.$id === 'user' && typeof store.refreshUserInfo === 'function') {
    const original = store.refreshUserInfo.bind(store)
    store.refreshUserInfo = async () => {
      // 身份以 /me 为权威
      // 本地 id 是 UUID，离线才回退
      try {
        return await original()
      } catch (e) {
        if (isLocalFirstEnabled()) {
          try {
            const local = await loadLocalUserInfo()
            if (local) {
              store.user = local
              if (store.locale !== local.lang) store.changeLocalLocale(local.lang)
              return local
            }
          } catch (le) {
            console.error('[local-first] read sr_user failed:', le)
          }
        }
        throw e
      }
    }
  }
}

export default defineNuxtPlugin(nuxtApp => {
  if (nuxtApp.$pinia) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(nuxtApp.$pinia as any).use(userStoreExtensionPlugin)
  }
})
