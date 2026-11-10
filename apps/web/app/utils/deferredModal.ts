import { loadDeferredUi } from './deferredUi'
import Toast, { ToastType } from '~/components/Toast'
import type { Component } from 'vue'

const pending = new Map<string, Promise<void>>()

export function loadModal(name: string, load: () => Promise<{ default: Component }>, open: (component: Component) => void): Promise<void> {
  const existing = pending.get(name)
  if (existing) return existing

  const nuxtApp = useNuxtApp()
  const task = loadDeferredUi(name, load)
    .then(({ default: component }) => nuxtApp.runWithContext(() => open(component)))
    .catch(() => {
      nuxtApp.runWithContext(() => Toast.showToast({
        text: nuxtApp.$i18n.t('common.tips.operate_failed'),
        type: ToastType.Error
      }))
    })
    .finally(() => pending.delete(name))

  pending.set(name, task)
  return task
}
