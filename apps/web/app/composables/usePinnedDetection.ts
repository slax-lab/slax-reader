// 检测是否已固定到工具栏
import { onMounted, onUnmounted, ref } from 'vue'

const EXTENSION_MARKERS = ['slax-reader-panel', 'slax-reader-modal']
const PINNED_ATTR = 'data-slax-pinned'

export function usePinnedDetection() {
  const isPinned = ref(false)

  onMounted(() => {
    const findMarker = () => EXTENSION_MARKERS.map(tag => document.querySelector(tag)).find((el): el is Element => !!el)

    const readAttr = (el: Element) => {
      isPinned.value = el.getAttribute(PINNED_ATTR) === 'true'
    }

    let attrObserver: MutationObserver | undefined
    const observeAttr = (el: Element) => {
      readAttr(el)
      attrObserver?.disconnect()
      attrObserver = new MutationObserver(() => readAttr(el))
      attrObserver.observe(el, { attributes: true, attributeFilter: [PINNED_ATTR] })
    }

    // 可能晚出现，先监听出现
    const existing = findMarker()
    if (existing) {
      observeAttr(existing)
    } else {
      const presenceObserver = new MutationObserver(() => {
        const marker = findMarker()
        if (marker) {
          presenceObserver.disconnect()
          observeAttr(marker)
        }
      })
      presenceObserver.observe(document.documentElement, { childList: true, subtree: true })
      onUnmounted(() => presenceObserver.disconnect())
    }

    // 页面切回可见时重新读取一次
    const recheck = () => {
      const marker = findMarker()
      if (marker) readAttr(marker)
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible') recheck()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', recheck)

    onUnmounted(() => {
      attrObserver?.disconnect()
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', recheck)
    })
  })

  return { isPinned }
}
