import { AccountLocaleDisplayError, AccountLocaleStaleError, AccountLocaleUnauthorizedError } from '../utils/accountLocaleRequest'
import { existingUserLocaleTasks } from '../utils/userLocaleTasks'

import type { PiniaPluginContext } from 'pinia'

export function userStoreExtensionPlugin(context: PiniaPluginContext) {
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
      const app = useNuxtApp()
      // The action initializes tasks and captures identity synchronously, before I/O.
      const pending = original()
      const tasks = existingUserLocaleTasks(store)
      const ticket = tasks?.capture()
      // 身份以 /me 为权威
      // 本地 id 是 UUID，离线才回退
      try {
        return await pending
      } catch (e) {
        if (e instanceof AccountLocaleStaleError || e instanceof AccountLocaleUnauthorizedError || e instanceof AccountLocaleDisplayError) throw e
        if (tasks && ticket && app.runWithContext(() => isLocalFirstEnabled())) {
          try {
            const local = await app.runWithContext(() => loadLocalUserInfo())
            if (local) {
              return await tasks.restore(local, ticket)
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
