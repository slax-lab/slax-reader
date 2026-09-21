import { useEventListener, useThrottleFn } from '@vueuse/core'

const TOP_DEAD_ZONE = 240
const HTML_TEXT_SELECTOR = '.bookmark-detail .html-text'

export interface ReadingAnchor {
  index: number
  ratio: number
  percent: number
}

interface ReadingPositionOptions {
  enabled?: () => boolean
  ready?: () => boolean
  skipRestore?: () => boolean
  load: () => Promise<ReadingAnchor | null>
  save: (anchor: ReadingAnchor) => Promise<unknown> | void
  clear: () => Promise<unknown> | void
}

function getHeaderOffset(): number {
  const root = getComputedStyle(document.documentElement)
  const varName = window.innerWidth <= 768 ? '--slax-header-h-mobile' : '--slax-header-h-snapshot'
  const px = parseFloat(root.getPropertyValue(varName))
  return Number.isFinite(px) ? px : 56
}

function getMaxScroll(): number {
  return Math.max(0, document.documentElement.scrollHeight - window.innerHeight)
}

export function useReadingPosition(uuid: string, options: ReadingPositionOptions) {
  if (!uuid) return

  const enabled = () => options.enabled?.() ?? true
  let restoring = false
  const cleanups: (() => void)[] = []

  const capture = () => {
    if (restoring || !enabled()) return
    const container = document.querySelector<HTMLElement>(HTML_TEXT_SELECTOR)
    const headerOffset = getHeaderOffset()
    const scrollY = window.scrollY

    if (scrollY <= TOP_DEAD_ZONE) {
      void options.clear()
      return
    }

    const children = container?.children
    let index = -1
    let ratio = 0
    if (children && children.length) {
      for (let i = 0; i < children.length; i++) {
        const rect = children[i]!.getBoundingClientRect()
        if (rect.bottom > headerOffset + 1) {
          index = i
          ratio = rect.height > 0 ? Math.min(1, Math.max(0, (headerOffset - rect.top) / rect.height)) : 0
          break
        }
      }
    }

    const max = getMaxScroll()
    void options.save({ index, ratio, percent: max > 0 ? scrollY / max : 0 })
  }
  const throttledCapture = useThrottleFn(capture, 400, true)

  const computeTarget = (saved: ReadingAnchor): number => {
    const headerOffset = getHeaderOffset()
    const container = document.querySelector<HTMLElement>(HTML_TEXT_SELECTOR)
    const el = saved.index >= 0 ? (container?.children[saved.index] as HTMLElement | undefined) : undefined
    if (el) {
      const top = el.getBoundingClientRect().top + window.scrollY
      return Math.max(0, top + saved.ratio * el.offsetHeight - headerOffset)
    }
    return Math.max(0, saved.percent * getMaxScroll())
  }

  const restore = async () => {
    if (!enabled() || options.skipRestore?.()) return
    const saved = await options.load()
    if (!saved) return

    restoring = true
    let aborted = false

    const abort = () => {
      aborted = true
    }
    const offWheel = useEventListener(window, 'wheel', abort, { passive: true })
    const offTouch = useEventListener(window, 'touchstart', abort, { passive: true })
    const offKey = useEventListener(window, 'keydown', abort)

    const jump = () => {
      if (aborted) return
      window.scrollTo({ top: computeTarget(saved), behavior: 'auto' })
    }

    jump()
    
    const timers = [requestAnimationFrame(jump), window.setTimeout(jump, 250), window.setTimeout(jump, 700), window.setTimeout(jump, 1500)]
    const stop = window.setTimeout(() => {
      restoring = false
      offWheel()
      offTouch()
      offKey()
    }, 1600)

    cleanups.push(() => {
      cancelAnimationFrame(timers[0]!)
      timers.slice(1).forEach(t => clearTimeout(t))
      clearTimeout(stop)
      offWheel()
      offTouch()
      offKey()
    })
  }

  const waitAndRestore = () => {
    let tries = 0
    const tick = () => {
      const container = document.querySelector(HTML_TEXT_SELECTOR)
      const domReady = container != null && container.childElementCount > 0
      const metaReady = options.ready?.() ?? true
      if (domReady && metaReady) {
        requestAnimationFrame(() => void restore())
        return
      }
      if (tries++ > 100) return // ~5s 仍未就绪则放弃
      window.setTimeout(tick, 50)
    }
    tick()
  }

  onMounted(() => {
    waitAndRestore()
    cleanups.push(useEventListener(window, 'scroll', throttledCapture, { passive: true }))
    cleanups.push(useEventListener(document, 'visibilitychange', () => document.visibilityState === 'hidden' && capture()))
  })

  onBeforeUnmount(() => {
    capture()
    cleanups.forEach(fn => fn())
    cleanups.length = 0
  })
}
