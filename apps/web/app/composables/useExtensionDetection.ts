// 检测扩展是否安装：DOM 标记探测
import { onMounted, onUnmounted, ref } from 'vue'

const EXTENSION_MARKERS = ['slax-reader-panel', 'slax-reader-modal']
const DETECTION_TIMEOUT = 1500

export function useExtensionDetection() {
  const isInstalled = ref(false)
  const checked = ref(false)

  onMounted(() => {
    const matchMarker = () => EXTENSION_MARKERS.some(tag => document.querySelector(tag))

    let observer: MutationObserver | undefined
    let timer: ReturnType<typeof setTimeout> | undefined

    const recheck = () => {
      if (!matchMarker()) return

      isInstalled.value = true
      checked.value = true
      observer?.disconnect()
      if (timer) clearTimeout(timer)
    }

    if (matchMarker()) {
      recheck()
      return
    }

    // 超时不代表停止监听，避免错过迟到的标记
    observer = new MutationObserver(recheck)
    // 插入较深，须 subtree:true
    observer.observe(document.documentElement, { childList: true, subtree: true })

    timer = setTimeout(() => {
      checked.value = true
    }, DETECTION_TIMEOUT)

    // 扩展可能在当前页面切回可见后才完成注入，主动复查一次
    const onVisible = () => {
      if (document.visibilityState === 'visible') recheck()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', recheck)

    onUnmounted(() => {
      observer?.disconnect()
      if (timer) clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', recheck)
    })
  })

  return { isInstalled, checked }
}
