import { computed, onMounted, onUnmounted, ref } from 'vue'

type LayoutMode = 'free' | 'push' | 'push-soft' | 'h5'

// 页面级单例状态（每次路由切换时 composable 重新初始化，不会跨页面污染）
const panelWidth = ref(440)
const panelOpen = ref(false)
const isDragging = ref(false)

/**
 * 三档桌面布局 + H5 检测 + SidePanel 拖拽。
 * --slax-push-amount 写完整推距（不预先折半），CSS 消费方用 * -0.5 做中心点修正。
 */
export function useSnapshotLayout() {
  const windowWidth = ref(typeof window !== 'undefined' ? window.innerWidth : 1200)

  if (import.meta.client) {
    const onResize = () => {
      windowWidth.value = window.innerWidth
    }
    onMounted(() => window.addEventListener('resize', onResize))
    onUnmounted(() => window.removeEventListener('resize', onResize))
  }

  const contentW = 820
  const contentMinW = 640

  const isH5 = computed(() => windowWidth.value <= 768)

  const layoutMode = computed((): LayoutMode => {
    if (isH5.value) return 'h5'
    if (!panelOpen.value) return 'free'
    const vw = windowWidth.value
    const pw = panelWidth.value
    if (vw >= contentW + 2 * pw + 80) return 'free'
    if (vw > contentMinW + pw) return 'push'
    return 'push-soft'
  })

  const pushAmount = computed((): number => {
    if (!panelOpen.value || isH5.value) return 0
    const vw = windowWidth.value
    const pw = panelWidth.value
    if (layoutMode.value === 'free') return 0
    if (layoutMode.value === 'push') return pw
    return Math.max(0, Math.min(vw - contentMinW, pw))
  })

  const startDrag = (_e: MouseEvent | TouchEvent) => {
    isDragging.value = true
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'

    const onMove = (ev: MouseEvent | TouchEvent) => {
      const clientX = 'touches' in ev ? ev.touches[0]!.clientX : ev.clientX
      panelWidth.value = Math.max(380, Math.min(680, windowWidth.value - clientX))
    }

    const onUp = () => {
      isDragging.value = false
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      window.removeEventListener('touchmove', onMove)
      window.removeEventListener('touchend', onUp)
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    window.addEventListener('touchmove', onMove, { passive: false })
    window.addEventListener('touchend', onUp)
  }

  return {
    panelWidth,
    panelOpen,
    isH5,
    layoutMode,
    pushAmount,
    isDragging,
    startDrag
  }
}
