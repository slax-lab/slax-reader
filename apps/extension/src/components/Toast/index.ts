import { createApp } from 'vue'

import Toast from './Toast.vue'

import { ToastType } from './type'

const showToast = (options: { text: string; type?: ToastType }) => {
  const rootPanel = document.querySelector('slax-reader-panel')?.shadowRoot

  let toastElement = rootPanel?.querySelector('.toast.toast-start') as HTMLElement
  if (!toastElement) {
    toastElement = document.createElement('div')
    toastElement.classList.add('toast')
    toastElement.classList.add('toast-start')
    toastElement.style.setProperty('z-index', `${100}`)
    const body = rootPanel?.querySelector('body')
    body?.appendChild(toastElement)
  }

  const textToast = document.createElement('div')
  toastElement.appendChild(textToast)

  const app = createApp(Toast, {
    text: options.text,
    type: options.type || ToastType.Normal,
    onDismiss: () => {
      app.unmount()
      textToast.remove()

      if (Array(...toastElement.children).length === 0) {
        toastElement.remove()
      }
    }
  })

  app.mount(textToast)
}

export { ToastType }

export default {
  showToast
}
