import { type Component, createApp } from 'vue'

import { autofocus } from '~/plugins/autofocus.client'

import { createHead } from '@unhead/vue/client'

const modalBootloader = (options: { ele: Component; props: Record<string, unknown>; container?: { styles: Record<string, unknown> } }) => {
  const app = createApp(options.ele, options.props)
  // 独立 app 不继承全局指令
  // 手动注册 v-autofocus
  app.directive('autofocus', autofocus)
  const name = app._component.__name
  const className = `modal_component_${name}`

  let element = document.querySelector(`.${className}`) as HTMLElement
  if (!element || !name) {
    element = document.createElement('div')
    name && element.classList.add(className)

    element.style.setProperty('z-index', `${100}`)

    const container = options.container
    if (container?.styles) {
      for (const key in container.styles) {
        element.style.setProperty(key, `${container.styles[key]}`)
      }
    }

    document.body.appendChild(element)
  }

  app.use(createHead())
  app.mount(element)

  return app
}

export { modalBootloader }
