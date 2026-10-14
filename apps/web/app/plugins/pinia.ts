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
}

export default defineNuxtPlugin(nuxtApp => {
  if (nuxtApp.$pinia) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(nuxtApp.$pinia as any).use(userStoreExtensionPlugin)
  }
})
