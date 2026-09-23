import About from './About.vue'
import Feedback from './Feedback.vue'
import ShareModal from './ShareModal.vue'

const modalBootloader = (options: { ele: Component; container: HTMLDivElement; props: Record<string, unknown> }) => {
  const app = createApp(options.ele, options.props)
  const name = app._component.__name
  const className = `modal_component_${name}`

  let element = document.querySelector(`.${className}`) as HTMLElement
  if (!element || !name) {
    element = document.createElement('div')
    name && element.classList.add(className)

    element.style.setProperty('z-index', `${100}`)

    options.container.appendChild(element)
  }

  app.mount(element)

  return app
}

export const showShareConfigModal = (options: { bookmarkId: number; bookmarkUuid: string; title: string; container: HTMLDivElement }) => {
  const app = modalBootloader({
    ele: ShareModal,
    container: options.container,
    props: {
      bookmarkId: options.bookmarkId,
      bookmarkUuid: options.bookmarkUuid,
      title: options.title,
      onDismiss: () => {
        app.unmount()
        app._container?.remove()
      }
    }
  })
}

export const showFeedbackModal = (options: {
  title: string
  reportType: string
  params?: Record<string, string | number>
  email?: string
  href?: string
  container: HTMLDivElement
}) => {
  const app = modalBootloader({
    ele: Feedback,
    container: options.container,
    props: {
      reportType: options.reportType,
      title: options.title,
      href: options.href,
      email: options.email || '',
      params: options.params ?? {},
      onDismiss: () => {
        app.unmount()
        app._container?.remove()
      }
    }
  })
}

export const showAboutModal = (options: { container: HTMLDivElement }) => {
  const app = modalBootloader({
    ele: About,
    container: options.container,
    props: {
      onDismiss: () => {
        app.unmount()
        app._container?.remove()
      }
    }
  })

  return app
}
