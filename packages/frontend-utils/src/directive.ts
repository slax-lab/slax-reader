import type { ObjectDirective, DirectiveBinding } from 'vue'
import { getElementOwnerDocument } from './dom'

interface ResizeElement extends HTMLElement {
  _resizeObserver?: ResizeObserver
}

export const Resize = {
  mounted(el: ResizeElement, binding: DirectiveBinding) {
    const handler = binding.value
    const resizeObserver = new ResizeObserver(entries => {
      if (!entries.length) return

      for (const entry of entries) {
        handler(entry.target, entry.contentRect)
      }
    })

    resizeObserver.observe(el)

    el._resizeObserver = resizeObserver

    if (!binding.modifiers?.quiet) {
      handler(el, el.getBoundingClientRect())
    }
  },

  unmounted(el: ResizeElement) {
    if (!el._resizeObserver) return

    const resizeObserver = el._resizeObserver
    resizeObserver.disconnect()
    delete el._resizeObserver
  }
}

interface ClickOutsideElement extends HTMLElement {
  _clickOutside?: {
    handler: (e: MouseEvent) => void
    exclude?: () => HTMLElement[]
  }
}

export const ClickOutside: ObjectDirective = {
  mounted(el: ClickOutsideElement, binding: DirectiveBinding) {
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      const excludeElements: HTMLElement[] = binding.value?.exclude?.() || []

      if (el !== target && !el.contains(target) && !target?.shadowRoot?.contains(el) && !excludeElements.some(elem => elem === target || elem.contains(target))) {
        const callback = binding.value?.handler || binding.value
        if (typeof callback === 'function') {
          callback(e)
        }
      }
    }

    el._clickOutside = { handler }

    getElementOwnerDocument(el).addEventListener('click', handler, true)
  },

  beforeUnmount(el: ClickOutsideElement) {
    if (el._clickOutside) {
      getElementOwnerDocument(el).removeEventListener('click', el._clickOutside.handler, true)
      delete el._clickOutside
    }
  },

  updated(el: ClickOutsideElement, binding: DirectiveBinding) {
    if (binding.value !== binding.oldValue) {
      if (el._clickOutside) {
        getElementOwnerDocument(el).removeEventListener('click', el._clickOutside.handler, true)
      }

      const handler = (e: MouseEvent) => {
        const target = e.target as HTMLElement
        const excludeElements: HTMLElement[] = binding.value?.exclude?.() || []

        if (el !== target && !el.contains(target) && !target?.shadowRoot?.contains(el) && !excludeElements.some(elem => elem === target || elem.contains(target))) {
          const callback = binding.value?.handler || binding.value
          if (typeof callback === 'function') {
            callback(e)
          }
        }
      }

      el._clickOutside = { handler }
      getElementOwnerDocument(el).addEventListener('click', handler, true)
    }
  }
}
