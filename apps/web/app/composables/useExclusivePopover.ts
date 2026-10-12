import { type Ref } from 'vue'

/** 页面级单例键，确保同一页面同一时刻只有一个 popover 打开 */
const globalOpenId = ref<symbol | null>(null)

/**
 * 互斥 popover 状态管理。
 * 每个组件实例调用一次，持有各自的 id；打开时关闭其他所有 popover。
 * 同时绑定 Esc 键和 click-outside（由调用方通过返回的 close 函数 + vOnClickOutside 实现）。
 */
export function useExclusivePopover(): {
  isOpen: Ref<boolean>
  toggle: () => void
  open: () => void
  close: () => void
} {
  const id = Symbol()
  const isOpen = computed({
    get: () => globalOpenId.value === id,
    set: (v: boolean) => {
      globalOpenId.value = v ? id : null
    }
  })

  const open = () => {
    globalOpenId.value = id
  }

  const close = () => {
    if (globalOpenId.value === id) {
      globalOpenId.value = null
    }
  }

  const toggle = () => {
    isOpen.value ? close() : open()
  }

  // Esc 关闭
  if (import.meta.client) {
    const onKeydown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    onMounted(() => window.addEventListener('keydown', onKeydown))
    onUnmounted(() => window.removeEventListener('keydown', onKeydown))
  }

  return { isOpen, toggle, open, close }
}
