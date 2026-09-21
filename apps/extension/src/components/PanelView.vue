<template>
  <div class="side-panel">
    <div
      class="main-panel"
      ref="panelContainer"
      :class="{ appear: showPanel }"
      v-click-outside="{
        handler: handleClickOutside
      }"
    >
      <div class="drag" ref="draggble" />
      <div class="sidebar-container" :style="contentWidth ? { width: contentWidth + 'px' } : {}">
        <div class="sidebar-wrapper" :class="{ dragging: isDragging }">
          <div class="sidebar-header">
            <div class="header-text" @click="go">
              <img src="@/assets/tiny-app-logo-gray.png" alt="" />
              <span class="name">Slax Reader</span>
              <span class="version">{{ VERSION }}</span>
            </div>
            <TextTips :tips="isAutoToggle ? $t('component.panel.auto_toggle.enabled_tips') : $t('component.panel.auto_toggle.disabled_tips', [shortcutString])">
              <div class="header-toggle">
                <span>{{ isAutoToggle ? $t('component.panel.auto_toggle.on') : $t('component.panel.auto_toggle.off') }}</span>
                <button :class="{ enabled: isAutoToggle }" @click="switchClick"></button>
              </div>
            </TextTips>
          </div>
          <div class="sidebar-content">
            <slot name="content" />
          </div>
        </div>
        <div class="sidebar-panel">
          <div class="operate-button top">
            <TextTips :tips="`${$t('component.panel.close_tips')} (${shortcutString})`">
              <button class="close" @click="closePanel">
                <img src="@/assets/button-dialog-shrink.png" />
              </button>
            </TextTips>
          </div>
          <div class="panel-buttons">
            <slot name="tabbars" />
          </div>
          <div class="operate-button bottom">
            <slot name="operate" />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import TextTips from './Tips/TextTips.vue'

import { ClickOutside } from '@commons/utils/directive'
import { MouseTrack } from '@commons/utils/mouse'

import { LocalStorageKey } from '@commons/types/const'
import type { LocalConfig, PanelPosition } from '@commons/types/interface'
import { type Position, useDebounceFn, useDraggable, useElementBounding, useScrollLock } from '@vueuse/core'

const props = defineProps({
  showPanel: {
    type: Boolean,
    default: false
  }
})

const emits = defineEmits(['close'])

const vClickOutside = ClickOutside
const localConfig = storage.defineItem<LocalConfig>(`${LocalStorageKey.LOCAL_CONFIG}`)

const isDraggledWebPaneled = ref(false)
const isLocked = useScrollLock(window)

const panelContainer = ref<HTMLDivElement>()
const draggble = useTemplateRef<HTMLDivElement>('draggble')
const webPanelDraggble = useTemplateRef<HTMLElement>('webPanelDraggble')

const minContentWidth = 400
const defaultContentWidth = 560
const contentWidth = ref(Math.min(window.innerWidth, defaultContentWidth))

const VERSION = `v${process.env.VERSION}`
const isMac = /Mac/i.test(navigator.platform || navigator.userAgent)
const shortcutString = isMac ? '⌃ + ⇧ + Z' : 'Ctrl + Shift⇧ + Z'
const isAutoToggle = ref(false)
const isSidebarWidthSync = ref(true)

watch(
  () => webPanelDraggble.value,
  () => {
    loadLocalConfig()
  }
)
watch(
  () => props.showPanel,
  value => {
    if (value) {
      tracking.touchTrack(value)
      tracking.wheelTrack(value)
    }

    nextTick(() => {
      setTimeout(() => {
        updatePageWidthStyle()
      }, 250)
    })
  }
)

onMounted(() => {
  tracking.mouseTrack(true)
  loadLocalConfig()
})

onUnmounted(() => {
  tracking.destruct()
})

const trackingHandler = () => {
  checkInAnotherScrollableView()
}

const tracking = new MouseTrack({
  touchTrackingHandler: trackingHandler,
  wheelTrackingHandler: trackingHandler
})

const checkInAnotherScrollableView = () => {
  let needLock = false
  if (panelContainer.value && isMouseWithinElement(panelContainer.value)) {
    needLock = true
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

const { isDragging } = useDraggable(draggble, {
  onMove: (position: Position) => {
    const windowWidth = window.innerWidth
    const left = position.x

    contentWidth.value = Math.min(Math.max(minContentWidth, windowWidth - left), windowWidth - 100)
    updatePageWidthStyle()
  },
  onEnd: () => {
    updatePageWidthStyle()
  }
})

const loadLocalConfig = async () => {
  const config = await localConfig.getValue()

  if (webPanelDraggble.value && config?.webPanelPosition) {
    isDraggledWebPaneled.value = true
    for (const key in config.webPanelPosition) {
      webPanelDraggble.value.style[key as any] = config.webPanelPosition[key as keyof typeof config.webPanelPosition]!
    }
  }

  isAutoToggle.value = config?.autoToggle ?? false
  // isSidebarWidthSync.value = config?.sidebarWidthSync ?? false
}

const updatePageWidthStyle = () => {
  if (!isSidebarWidthSync.value) {
    return
  }

  const width = contentWidth.value
  const styleId = 'slax-reader-sidebar-style'
  let styleElement = document.getElementById(styleId) as HTMLStyleElement | null

  if (props.showPanel) {
    const cssContent = `
        html {
          width: calc(100% - ${width}px) !important;
          position: relative !important;
        }
      `

    if (styleElement) {
      styleElement.textContent = cssContent
    } else {
      styleElement = document.createElement('style')
      styleElement.id = styleId
      styleElement.textContent = cssContent
      document.head.appendChild(styleElement)
    }
  } else {
    if (styleElement) {
      document.head.removeChild(styleElement)
    }
  }
}

const usePanelDraggable = (draggableRef: Ref<HTMLElement | null>, isDraggledRef: Ref<boolean>, onPositionChange: (position: PanelPosition) => void) => {
  const calculatePercentagePosition = (x: number, y: number) => {
    const maxX = window.innerWidth - (draggableRef.value?.offsetWidth || 0)
    const maxY = window.innerHeight - (draggableRef.value?.offsetHeight || 0)
    const leftPercent = (Math.max(0, Math.min(x, maxX)) / window.innerWidth) * 100
    const topPercent = (Math.max(0, Math.min(y, maxY)) / window.innerHeight) * 100
    const panelWidthPercent = ((draggableRef.value?.offsetWidth || 0) / window.innerWidth) * 100
    const panelHeightPercent = ((draggableRef.value?.offsetHeight || 0) / window.innerHeight) * 100

    const horizontalPosition = leftPercent > 50 ? { right: 100 - leftPercent - panelWidthPercent + '%' } : { left: leftPercent + '%' }

    const verticalPosition = topPercent > 50 ? { bottom: 100 - topPercent - panelHeightPercent + '%' } : { top: topPercent + '%' }

    return {
      ...horizontalPosition,
      ...verticalPosition
    }
  }
  const clearPosition = () => {
    if (draggableRef.value) {
      draggableRef.value.style.left = ''
      draggableRef.value.style.top = ''
      draggableRef.value.style.right = ''
      draggableRef.value.style.bottom = ''
    }
  }

  useDraggable(draggableRef, {
    preventDefault: true,
    onStart(_, event: PointerEvent) {
      if ((event.target as HTMLElement).classList.contains('panel-container')) {
        if (!isDraggledRef.value && draggableRef.value) {
          const left = useElementBounding(draggableRef).left
          const top = useElementBounding(draggableRef).top
          clearPosition()
          isDraggledRef.value = true
          const position = calculatePercentagePosition(left.value, top.value)
          for (const key in position) {
            draggableRef.value.style[key as any] = position[key as keyof typeof position]!
          }
        }
        return
      }
      return false
    },
    onMove: ({ x, y }: Position) => {
      if (draggableRef.value) {
        clearPosition()
        isDraggledRef.value = true
        const position = calculatePercentagePosition(x, y)
        for (const key in position) {
          draggableRef.value.style[key as any] = position[key as keyof typeof position]!
        }
      }
    },
    onEnd: ({ x, y }: Position) => {
      const position = calculatePercentagePosition(x, y)
      onPositionChange(position)
    }
  })
}

const switchClick = () => {
  isAutoToggle.value = !isAutoToggle.value
  updateToggle(isAutoToggle.value)
}

const updateToggle = useDebounceFn(
  (autoToggle: boolean) => {
    updateConfig({
      autoToggle
    })
  },
  500,
  { maxWait: 5000 }
)

const handleClickOutside = () => {
  if (isAutoToggle.value) {
    emits('close')
  }
}

const webPanelCallback = async (position: PanelPosition) => {
  await updateConfig({
    webPanelPosition: position
  })
}

const updateConfig = async (config: LocalConfig) => {
  const localconfig = await localConfig.getValue()
  localConfig.setValue({
    ...localconfig,
    ...config
  })
}

usePanelDraggable(webPanelDraggble, isDraggledWebPaneled, webPanelCallback)

const go = () => {
  window.open(`${process.env.PUBLIC_BASE_URL}/bookmarks`, '_blank')
}

const closePanel = () => {
  emits('close')
}
</script>

<style lang="scss" scoped>
.side-panel {
  --style: fixed z-2 left-full top-0 h-screen;

  .main-panel {
    --style: relative h-full bg-#262626 transition-transform duration-250 ease-in-out;

    &.appear {
      --style: -translate-x-full;
    }

    .drag {
      --style: absolute top-0 left-0 w-10px h-full z-2 cursor-ew-resize transition-colors duration-250;

      &:hover {
        --style: bg-#ffffff04;
      }
    }

    .sidebar-container {
      --style: relative size-full;

      .sidebar-panel {
        --style: bg-#1F1F1F absolute z-2 top-0 right-0 h-full w-48px flex items-center justify-between;

        .operate-button {
          --style: absolute left-1/2 -translate-x-1/2 flex items-center justify-center;

          &.top {
            --style: top-15px;
          }

          &.bottom {
            --style: bottom-24px;
          }

          button {
            --style: 'hover:(scale-103 opacity-90) active:(scale-105) transition-all duration-250';
          }

          .close {
            --style: size-16px flex-center;
            img {
              --style: w-full select-none;
            }
          }
        }

        .panel-buttons {
          --style: py-16px w-full;
        }
      }

      .sidebar-wrapper {
        --style: h-full pr-48px flex flex-col bg-#262626FF;

        &.dragging {
          --style: select-none;
        }

        .sidebar-header {
          --style: w-full h-48px pl-20px pr-4px bg-#1F1F1F flex items-center justify-between select-none;

          .header-text {
            --style: cursor-pointer flex-center;
            img {
              --style: size-16px object-contain;
            }

            .name {
              --style: ml-2px text-(14px #ffffff66) font-semibold line-height-20px;
            }

            .version {
              --style: ml-6px flex px-3px rounded-2px border-(0.5px solid #97979766) text-(9px #ffffff66) line-height-14px;
            }
          }

          .header-toggle {
            --style: flex-center;
            span {
              --style: text-(8px #848484ff) font-medium line-height-11px;
            }

            button {
              --style: ml-6px w-14px h-12px bg-center;
              --style: 'bg-[length:16px_12px] hover:(scale-103) active:(scale-105) transition-all duration-250';

              background-image: url('@/assets/tiny-toggle-disabled-icon.png');

              &.enabled {
                background-image: url('@/assets/tiny-toggle-enabled-icon.png');
              }
            }
          }
        }

        .sidebar-content {
          --style: size-full overflow-auto;

          scrollbar-width: none;
          &::-webkit-scrollbar {
            --style: hidden;
          }
        }
      }
    }
  }
}

.sidepanel-enter-active,
.sidepanel-leave-active {
  transition: all 0.4s;
}

.sidepanel-enter-from,
.sidepanel-leave-to {
  --style: '!opacity-0';
}
</style>
