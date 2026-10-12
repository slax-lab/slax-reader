import { createApp } from 'vue'

import Toast from './Toast.vue'

import { ToastType } from './type'

// 第四期 Sprint B.3：抽 dismissCleanup seam
// Why：onDismiss 回调依赖 Toast 内 <Transition> after-leave，happy-dom 不真触发，
//      导致 unmount + textToast.remove + 容器自清理这条链覆盖不到。
// 抽出来后 spec 可直接调 cleanup 模拟 dismiss 完成时的行为，functions 覆盖能稳定到 100%。
const buildDismissCleanup = (app: ReturnType<typeof createApp>, textToast: HTMLElement, toastElement: HTMLElement) => () => {
  app.unmount()
  textToast.remove()

  if (Array(...toastElement.children).length === 0) {
    toastElement.remove()
  }
}

export interface ToastAction {
  text: string
  onClick: () => void
}

// action: an underlined button after the text (e.g. "Turn on" → settings); duration: ms before auto-dismiss
const showToast = (options: { text: string; type?: ToastType; action?: ToastAction; duration?: number }) => {
  let toastElement = document.querySelector('.toast.toast-start') as HTMLElement
  if (!toastElement) {
    toastElement = document.createElement('div')
    toastElement.classList.add('toast')
    toastElement.classList.add('toast-start')
    // Toast 必须盖过所有弹窗/模态（全站 z-index 最高到 1000，含 feedback-modal 的 z-200），故取远高于其上的值
    toastElement.style.setProperty('z-index', `${9999}`)
    document.body.appendChild(toastElement)
  }

  const textToast = document.createElement('div')
  toastElement.appendChild(textToast)

  // 占位 null：必须在 createApp 之后赋值（dismissCleanup 闭包需要 app 引用）
  let dismissCleanup: (() => void) | null = null

  const app = createApp(Toast, {
    text: options.text,
    type: options.type || ToastType.Normal,
    action: options.action,
    duration: options.duration,
    onDismiss: () => dismissCleanup?.()
  })

  dismissCleanup = buildDismissCleanup(app, textToast, toastElement)

  app.mount(textToast)
}

export { ToastType }

export default {
  showToast
}
