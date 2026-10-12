/**
 * v-ime-guard：IME 合成期间拦截 Enter
 * document 捕获先于 Vue 元素级监听器
 */
import type { ObjectDirective } from 'vue'

interface ImeState {
  isComposing: boolean
  cleanup: () => void
}

const store = new WeakMap<HTMLElement, ImeState>()

export const imeGuard: ObjectDirective<HTMLElement> = {
  // SSR 无交互，返回空 props
  // 仅让指令可解析、免告警
  getSSRProps() {
    return {}
  },

  mounted(el) {
    const state: ImeState = { isComposing: false, cleanup: () => {} }

    const onCompositionStart = () => {
      state.isComposing = true
    }
    const onCompositionEnd = () => {
      state.isComposing = false
    }

    const onDocumentKeydown = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || !state.isComposing) return
      if (e.composedPath().includes(el)) {
        e.stopImmediatePropagation()
      }
    }

    el.addEventListener('compositionstart', onCompositionStart)
    el.addEventListener('compositionend', onCompositionEnd)
    document.addEventListener('keydown', onDocumentKeydown, true)

    state.cleanup = () => {
      el.removeEventListener('compositionstart', onCompositionStart)
      el.removeEventListener('compositionend', onCompositionEnd)
      document.removeEventListener('keydown', onDocumentKeydown, true)
    }

    store.set(el, state)
  },

  unmounted(el) {
    const state = store.get(el)
    if (state) {
      state.cleanup()
      store.delete(el)
    }
  }
}
