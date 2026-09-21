<template>
  <div class="mark-mind-map" ref="container" :style="{ opacity: data.length > 0 ? 1 : 0 }">
    <svg class="mind-svg" ref="svg"></svg>
    <div class="mind-toolbar" v-if="props.showToolbar && !downloading">
      <div class="item" v-for="icon in toolbarIcons" :key="icon.id" @click="toolbarClick(icon)">
        <div class="icon-bg"></div>
        <svg v-html="icon.svg"></svg>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue'

import { base64toBlob } from '@commons/utils/data'

import dom2Img, { AutoFitByRatio } from 'easy-dom2img'
import { type INode } from 'markmap-common'
import { builtInPlugins, Transformer } from 'markmap-lib'
import { type IMarkmapOptions, Markmap } from 'markmap-view'

const props = defineProps({
  data: { type: String, default: '' },
  showToolbar: { type: Boolean, require: false, default: false },
  hideAnchor: { type: Boolean, require: false, default: false },
  defaultExpandLevel: { type: Number, require: false, default: -1 }
})

const emits = defineEmits(['anchorClick', 'download', 'graphHeightUpdate'])

interface ToolbarIcon {
  id: 'scale-up' | 'scale-down' | 'fullscreen' | 'fullscreen-exit' | 'download'
  svg: string
}

const transformer = new Transformer([
  ...builtInPlugins,
  {
    name: 'target-blank',
    transform(transformHooks) {
      transformHooks.parser.tap(md => {
        md.renderer.rules.link_open = (tokens: Array<{ attrGet: (name: string) => string | null }>, idx: number) => {
          const href = md.utils.escapeHtml(tokens[idx]?.attrGet('href') ?? '')
          return `<a data-link="${href}" class="slax_link">`
        }
        md.renderer.rules.link_close = () => '</a>'
      })

      return {}
    }
  }
])
const svg = ref<SVGSVGElement>()
const markmind = ref<Markmap | null>()
const container = ref<HTMLDivElement>()
const isFullscreen = ref(false)
const downloading = ref(false)
const toolbarIcons = computed<ToolbarIcon[]>(() => {
  const fullScreenAvailable = !!document.documentElement.requestFullscreen
  const icons: ToolbarIcon[] = [
    {
      id: 'scale-up',
      svg: '<svg width="100%" height="100%" viewBox="0 0 48 48" fill="none"><path d="M21 38C30.3888 38 38 30.3888 38 21C38 11.6112 30.3888 4 21 4C11.6112 4 4 11.6112 4 21C4 30.3888 11.6112 38 21 38Z" fill="none" stroke-width="4" stroke-linejoin="round"/><path d="M21 15L21 27" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M15.0156 21.0156L27 21" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M33.2216 33.2217L41.7069 41.707" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>'
    },
    {
      id: 'scale-down',
      svg: '<svg width="100%" height="100%" viewBox="0 0 48 48" fill="none"><path d="M21 38C30.3888 38 38 30.3888 38 21C38 11.6112 30.3888 4 21 4C11.6112 4 4 11.6112 4 21C4 30.3888 11.6112 38 21 38Z" fill="none" stroke-width="4" stroke-linejoin="round"/><path d="M15 21L27 21" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M33.2216 33.2217L41.7069 41.707" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>'
    }
  ]

  if (fullScreenAvailable) {
    icons.push(
      !isFullscreen.value
        ? {
            id: 'fullscreen',
            svg: '<svg width="100%" height="100%" viewBox="0 0 48 48" fill="none"><path d="M33 6H42V15" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M42 33V42H33" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M15 42H6V33" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M6 15V6H15" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>'
          }
        : {
            id: 'fullscreen-exit',
            svg: '<svg width="100%" height="100%" viewBox="0 0 48 48" fill="none"><path d="M33 6V15H42" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M15 6V15H6" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M15 42V33H6" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M33 42V33H41.8995" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>'
          }
    )
  }

  icons.push({
    id: 'download',
    svg: '<svg width="100%" height="100%" viewBox="0 0 48 48" fill="none"><path d="M6 24.0083V42H42V24" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M33 23L24 32L15 23" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M23.9917 6V32" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>'
  })

  return icons
})

function debounce<T extends (...args: any[]) => any>(func: T, wait: number = 300): (...args: Parameters<T>) => void {
  let canExecute = true
  let needExecute = false
  const handler = (...args: Parameters<T>) => {
    if (canExecute) {
      func(...args)
      canExecute = false
      needExecute = false

      setTimeout(() => {
        canExecute = true
        if (needExecute) {
          needExecute = false
          handler(...args)
        }
      }, wait)
    } else {
      needExecute = true
    }
  }

  return handler
}

watch(
  () => props.data,
  () => {
    debounceUpdate()
  }
)

onMounted(async () => {
  initSVG()
  await update()

  addListener()
  monitorKeyboard()
  updateGraphHeight()
})

onUnmounted(() => {
  removeListener()
  markmind.value?.destroy()
})

const addListener = () => {
  window.addEventListener('resize', resizeFit)
  document.onfullscreenchange = () => {
    isFullscreen.value = document.fullscreenElement === container.value
  }
}

const removeListener = () => {
  window.removeEventListener('resize', resizeFit)
  document.onfullscreenchange = null
}

const resizeFit = () => {
  if (!markmind.value) {
    return
  }

  markmind.value.fit()
}

const initSVG = () => {
  const options: Partial<IMarkmapOptions> = {
    zoom: true,
    pan: true
  }

  if (props.defaultExpandLevel >= 0) {
    options.initialExpandLevel = props.defaultExpandLevel
  }

  markmind.value = svg.value ? Markmap.create(svg.value, options) : null
  markmind.value!.handlePan = (e: WheelEvent) => {
    console.log(e)
  }

  markmind.value!.handleZoom = (e: any) => {
    console.log(e)
  }

  markmind.value!.toggleNode = async (data: INode) => {
    let a = null
    data.payload = {
      ...data.payload,
      fold: (a = data.payload) != null && a.fold ? 0 : 1
    }

    markmind.value!.renderData(data)
    handleAnchors()
    await fitMap()
    updateGraphHeight()
    nextTick(() => {
      container.value?.scrollIntoView({ behavior: 'smooth', block: 'end', inline: 'nearest' })
      addExpandIcons()
    })
  }
}

const updateGraphHeight = () => {
  const gHeight = container.value?.querySelector('svg > g')?.getBoundingClientRect().height || 0
  emits('graphHeightUpdate', { height: gHeight })
}

const monitorKeyboard = () => {
  const isMac = /Mac/i.test(navigator.platform || navigator.userAgent)
  document.addEventListener('keydown', (e: KeyboardEvent) => {
    if (['ArrowUp', 'ArrowDown'].indexOf(e.key) === -1) {
      return
    }

    const fire = (e.ctrlKey && !isMac) || ((e.ctrlKey || e.metaKey) && isMac)
    if (!fire) {
      return
    }

    if (e.key === 'ArrowUp') {
      markmind.value!.rescale(2)
    } else if (e.key === 'ArrowDown') {
      markmind.value!.rescale(0.5)
    }
  })
}

const debounceUpdate = debounce(() => {
  update()
}, 1000)

const update = async () => {
  if (!markmind.value) {
    return
  }

  const { root } = transformer.transform(props.data)
  markmind.value.setData(root, {
    style: () => `
      .mark-mind-map .slax_link {
        display: ${props.hideAnchor ? 'none' : 'inline-block'};
      }
    `
  })

  handleAnchors()
  await fitMap()
  addExpandIcons()
}

const toolbarClick = async (icon: ToolbarIcon) => {
  if (icon.id === 'scale-up') {
    await markmind.value!.rescale(1.5)
  } else if (icon.id === 'scale-down') {
    await markmind.value!.rescale(0.5)
  } else if (icon.id === 'fullscreen') {
    requestFullscreen()
  } else if (icon.id === 'fullscreen-exit') {
    cancelFullscreen()
  } else if (icon.id === 'download') {
    requestDownload()
  }
}

const handleAnchors = () => {
  container.value?.querySelectorAll('.mind-svg .slax_link').forEach(dom => {
    const anchorDom = dom as HTMLAnchorElement
    if (anchorDom.onclick) {
      return
    }

    const link = anchorDom.dataset['link']
    anchorDom.onclick = () => {
      emits('anchorClick', link)
    }
  })
}

const requestFullscreen = () => {
  container.value?.requestFullscreen()
}

const cancelFullscreen = () => {
  document.exitFullscreen()
}

const requestDownload = async () => {
  if (downloading.value === true) {
    return
  }

  downloading.value = true

  try {
    await fitMap()
    if (!container.value) {
      return
    }

    const { data: imgUrl } = await dom2Img(container.value, {
      width: 2000,
      height: AutoFitByRatio
    })

    const blob = base64toBlob(imgUrl)
    const link = document.createElement('a')
    link.href = window.URL.createObjectURL(blob)
    link.download = `[思维导图]_${document.title}.png`
    link.click()
    window.URL.revokeObjectURL(link.href) // 释放内存
  } catch (error) {
    console.error(error)
  } finally {
    downloading.value = false
  }
}

const scaleUp = () => {
  markmind.value!.rescale(2)
}

const scaleDown = () => {
  markmind.value!.rescale(0.5)
}

const fitMap = async () => {
  await markmind.value!.fit()
}

const addExpandIcons = () => {
  const nodes = svg.value?.querySelectorAll('.markmap-node')

  nodes?.forEach(node => {
    const circle = node.querySelector('circle')
    if (!circle) return

    let iconGroup = node.querySelector('.expand-icon')
    if (!iconGroup) {
      iconGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g')
      iconGroup.classList.add('expand-icon')
      iconGroup.setAttribute('pointer-events', 'none')
      node.appendChild(iconGroup)
    } else {
      iconGroup.innerHTML = ''
    }

    const cx = parseFloat(circle.getAttribute('cx') || '0')
    const cy = parseFloat(circle.getAttribute('cy') || '0')

    const strokeColor = circle.getAttribute('stroke') || 'currentColor'
    const isFolded = node.classList.contains('markmap-fold')
    const iconSize = 2.5

    const hLine = document.createElementNS('http://www.w3.org/2000/svg', 'line')
    hLine.setAttribute('x1', (cx - iconSize).toString())
    hLine.setAttribute('y1', cy.toString())
    hLine.setAttribute('x2', (cx + iconSize).toString())
    hLine.setAttribute('y2', cy.toString())
    hLine.setAttribute('stroke', isFolded ? '#fff' : strokeColor)
    hLine.setAttribute('stroke-width', '1.2')
    hLine.setAttribute('stroke-linecap', 'round')
    iconGroup.appendChild(hLine)

    if (isFolded) {
      const vLine = document.createElementNS('http://www.w3.org/2000/svg', 'line')
      vLine.setAttribute('x1', cx.toString())
      vLine.setAttribute('y1', (cy - iconSize).toString())
      vLine.setAttribute('x2', cx.toString())
      vLine.setAttribute('y2', (cy + iconSize).toString())
      vLine.setAttribute('stroke', '#fff')
      vLine.setAttribute('stroke-width', '1.2')
      vLine.setAttribute('stroke-linecap', 'round')
      iconGroup.appendChild(vLine)
    }
  })
}

defineExpose({
  scaleUp,
  scaleDown,
  fitMap
})
</script>

<style lang="scss" scoped>
.mark-mind-map {
  --style: relative w-full h-full;
  --style: 'bg-#f5f5f3 dark:bg-#262626';

  .mind-svg {
    --style: absolute w-full h-full top-0 left-0;

    &:deep(.markmap-foreign) {
      --style: font-400 text-12px line-height-20px;
      --style: 'text-#333 dark:text-#ffffffcc';
      & > div {
        --style: flex items-center;
      }
    }

    &:deep(.slax_link) {
      --style: ml-6px select-none cursor-pointer align-middle h-16px py-0 px-5px font-500 text-10px line-height-16px rounded-3px transition-colors duration-150;
      --style: '!decoration-none !bg-#16b9981f !text-#333 dark:!bg-#16b9981f dark:!text-#ffffffcc';

      &:hover {
        --style: '!bg-#475467 !text-#fff';
      }
    }
  }

  .mind-toolbar {
    --style: absolute select-none flex items-center bottom-1/10 left-1/2 -translate-x-1/2;

    .item {
      --style: 'cursor-pointer relative w-20px h-20px p-12px transition-transform duration-200 ease-in-out not-first:ml-5 hover:scale-110';
      .icon-bg {
        --style: absolute top-0 left-0 filter-blur-10 w-full h-full;
        --style: 'bg-#f5f5f3 dark:bg-transparent';
      }

      svg {
        --style: absolute top-0 left-0 w-full h-full z-1 transform-colors duration-200;
        --style: 'hover:text-emerald stroke-#333 dark:stroke-#ffffffe6';
        div {
          --style: w-full h-full;
        }
      }
    }
  }
}
</style>
