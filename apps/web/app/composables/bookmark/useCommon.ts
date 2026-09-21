import { ref, watch } from 'vue'

import { isClient } from '@commons/utils/is'
import { MouseTrack } from '@commons/utils/mouse'

import type { CommonBookmarkOptions } from './type'

export const useTracking = () => {
  const isLocked = (() => {
    return isClient ? useScrollLock(window) : ref(false)
  })()

  const trackingHandler = () => {
    checkInAnotherScrollableView()
  }

  const tracking = new MouseTrack({
    touchTrackingHandler: trackingHandler,
    wheelTrackingHandler: trackingHandler
  })

  const checkInAnotherScrollableView = () => {
    let needLock = false

    const sidebarElements = Array.from(document.querySelectorAll('.sidebar-content')) as HTMLElement[]
    if (sidebarElements.length > 0) {
      const findEle = sidebarElements.find(ele => isMouseWithinElement(ele))

      if (findEle) {
        needLock = true
      }
    }

    if (needLock) {
      !isLocked.value && (isLocked.value = true)
    } else {
      isLocked.value && (isLocked.value = false)
    }
  }

  const isMouseWithinElement = (element: HTMLElement) => {
    const rect = element.getBoundingClientRect()
    const { x, y } = tracking.lastMousePosition
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
  }

  onMounted(() => {
    tracking.mouseTrack(true)
  })

  onUnmounted(() => {
    tracking.destruct()
  })

  return { tracking, isLocked }
}

export const useResize = (options: CommonBookmarkOptions) => {
  const { tracking, isLocked } = useTracking()

  const { detailLayout, summariesSidebar, botSidebar, bookmarkDetail } = options
  const isNeedResized = ref(false) // 标记页面是否符合要调整布局的条件
  const resizeAnimated = ref(false) // 标记页面调整是否需要动画
  const summariesExpanded = ref(false) // 标记摘要是否展开
  const botExpanded = ref(false) // 标记chatbot是否展开
  const contentXOffset = ref(0) // 标记内容页面的偏移量

  const sidebarExpanded = computed(() => {
    return summariesExpanded.value || botExpanded.value
  })

  ;[summariesExpanded, botExpanded].forEach(refValue => {
    watch(
      () => refValue.value,
      (value, oldValue) => {
        if (value === oldValue) {
          return
        }

        const isExpanded = summariesExpanded.value || botExpanded.value
        tracking.touchTrack(isExpanded)
        tracking.wheelTrack(isExpanded)

        if (isExpanded) {
          contentWidthUpdate(bookmarkDetail?.value?.getBoundingClientRect().width || 0)
        } else {
          isLocked.value = false
        }

        if (!isExpanded) {
          contentXOffset.value = 0
        }
      }
    )
  })

  const panelMaxWidth = 60 + 68 /* 侧边栏的间距和宽度 */

  const updateIsNeedResizeHandler = (width: number) => {
    const maxSidebarContentWidth = Math.max(summariesSidebar?.value?.contentWidth() || 0, botSidebar?.value?.contentWidth() || 0)
    const shadowContentWidth = detailLayout?.value?.contentWidth() || 0
    const gap = (width - shadowContentWidth) / 2
    isNeedResized.value = !(gap - maxSidebarContentWidth > panelMaxWidth)
  }

  const contentWidthUpdateHandler = (width: number) => {
    if (detailLayout?.value?.isSmallScreen()) {
      contentXOffset.value = 0
      return
    }

    let sidebarContentWidth = 0
    if (summariesExpanded.value) {
      sidebarContentWidth = summariesSidebar?.value?.contentWidth() || 0
    } else if (botExpanded.value) {
      sidebarContentWidth = botSidebar?.value?.contentWidth() || 0
    }

    const shadowContentWidth = detailLayout?.value?.contentWidth() || 0
    const gap = (width - shadowContentWidth) / 2
    if (gap - sidebarContentWidth > panelMaxWidth) {
      contentXOffset.value = 0
      return
    }

    const offsetX = sidebarContentWidth - gap
    const centerFineTuningOffsetX = Math.max((gap - offsetX) / 2, 0)
    contentXOffset.value = Math.min(offsetX + centerFineTuningOffsetX, gap - 10)
  }

  const resizeDebouncedFn = useDebounceFn(contentWidthUpdateHandler, 500, { maxWait: 5000 })

  const contentWidthUpdate = (width: number) => {
    if (resizeAnimated.value) {
      resizeDebouncedFn(width)
    } else {
      contentWidthUpdateHandler(width)
    }
  }

  const onResizeObserver = (entries: unknown | ReadonlyArray<ResizeObserverEntry>) => {
    if (!Array.isArray(entries)) {
      contentXOffset.value = 0
      return
    }

    const entry = entries[0] as ResizeObserverEntry
    const { width } = entry.contentRect

    updateIsNeedResizeHandler(width)
    if (!sidebarExpanded.value) {
      contentXOffset.value = 0
      return
    }

    contentWidthUpdate(width)
  }

  return { resizeAnimated, summariesExpanded, botExpanded, onResizeObserver, contentXOffset, isLocked, isNeedResized }
}
