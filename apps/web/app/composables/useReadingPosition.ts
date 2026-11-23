import { onBeforeUnmount, onMounted } from 'vue'

import type { ReaderNavigation } from '~/utils/readerStartup'

import { useEventListener, useThrottleFn } from '@vueuse/core'

const TOP_DEAD_ZONE = 240
const HTML_TEXT_SELECTOR = '.bookmark-detail .html-text'

export interface ReadingAnchor {
  index: number
  ratio: number
  percent: number
}

interface ReadingPositionOptions {
  navigation?: ReaderNavigation
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
  if (import.meta.server || !uuid) return

  const enabled = () => options.enabled?.() ?? true
  let restoring = true
  const navigation = options.navigation
  let aborted = navigation?.interacted === true || navigation?.history === true || navigation?.explicit === true
  navigation?.stop()
  let disposed = false
  let restored = false
  const pending: (() => void)[] = []
  const cleanups: (() => void)[] = []

  const capture = () => {
    if (disposed || restoring || !enabled() || options.ready?.() === false) return
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

  const finish = () => {
    restoring = false
    pending.splice(0).forEach(stop => stop())
  }
  const abort = () => {
    aborted = true
    finish()
  }
  const frame = (callback: () => void) => {
    const id = requestAnimationFrame(callback)
    pending.push(() => cancelAnimationFrame(id))
  }
  const later = (callback: () => void, delay: number) => {
    const id = window.setTimeout(callback, delay)
    pending.push(() => clearTimeout(id))
  }
  const shouldSkip = () => disposed || aborted || options.skipRestore?.() === true || (!restored && navigation?.initial === true && window.scrollY > 0)

  const restore = async () => {
    if (!enabled() || shouldSkip()) { finish(); return }
    const saved = await options.load()
    if (!saved || !enabled() || shouldSkip()) { finish(); return }

    const jump = () => {
      if (shouldSkip() || !enabled()) { finish(); return }
      restored = true
      window.scrollTo({ top: computeTarget(saved), behavior: 'auto' })
    }
    jump()
    frame(jump)
    for (const delay of [250, 700, 1500]) later(jump, delay)
    later(finish, 1600)
  }

  cleanups.push(useEventListener(window, 'wheel', abort, { passive: true }))
  cleanups.push(useEventListener(window, 'touchmove', abort, { passive: true }))
  cleanups.push(useEventListener(window, 'keydown', (event: KeyboardEvent) => {
    const target = event.target as HTMLElement
    if (target.closest?.('input, textarea, select, [contenteditable="true"]')) return
    if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) abort()
  }))
  cleanups.push(useEventListener(window, 'slax:reader-navigation', abort))

  const waitAndRestore = () => {
    let tries = 0
    const tick = () => {
      if (shouldSkip()) { finish(); return }
      const container = document.querySelector(HTML_TEXT_SELECTOR)
      const domReady = container != null && container.childElementCount > 0
      const metaReady = options.ready?.() ?? true
      if (domReady && metaReady) {
        frame(() => void restore())
        return
      }
      if (tries++ > 100) { finish(); return }
      later(tick, 50)
    }
    tick()
  }

  let mounted = false
  let scrollAtMount = 0
  let navigationReady = !navigation || navigation.initial
  if (!navigationReady) {
    const off = useNuxtApp().hook('page:loading:end', () => {
      off()
      navigationReady = true
      if (mounted) frame(waitAndRestore)
    })
    cleanups.push(off)
  }

  onMounted(() => {
    mounted = true
    scrollAtMount = window.scrollY
    if (navigation?.initial && window.scrollY > 0) abort()
    if (navigationReady) waitAndRestore()
    cleanups.push(useEventListener(window, 'scroll', throttledCapture, { passive: true }))
    cleanups.push(useEventListener(document, 'visibilitychange', () => document.visibilityState === 'hidden' && capture()))
  })

  onBeforeUnmount(() => {
    capture()
    disposed = true
    finish()
    cleanups.forEach(fn => fn())
    cleanups.length = 0
  })

  // A source that becomes enabled after the first attempt (a deferred page switching to local data)
  // restores once, unless the reader has already moved the page.
  const retry = () => {
    // The first attempt is still waiting for the article or running its corrections.
    if (restoring || disposed || aborted || restored || !mounted || !navigationReady || !enabled()) return
    if (Math.abs(window.scrollY - scrollAtMount) > 1) {
      finish()
      return
    }
    restoring = true
    frame(waitAndRestore)
  }

  return { retry }
}
