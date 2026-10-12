import { createApp } from 'vue'

import { createHead } from '@unhead/vue/client'

const showModal = async () => {
  let subscriptionElement = document.querySelector('.subscription-modal') as HTMLElement
  if (!subscriptionElement) {
    subscriptionElement = document.createElement('div')
    subscriptionElement.classList.add('subscription-modal')
    subscriptionElement.style.setProperty('z-index', `${100}`)
    document.body.appendChild(subscriptionElement)
  }

  const Subscription = (await import('./SubscriptionModal.vue')).default
  const app = createApp(Subscription, {
    onDismiss: () => {
      app.unmount()
      subscriptionElement.remove()
    }
  })

  app.use(createHead())
  app.mount(subscriptionElement)
}

export default {
  showModal
}
