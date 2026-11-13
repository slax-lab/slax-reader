import { createApp } from 'vue'

import CursorToast from './CursorToast.vue'

import Toast from '~/components/Toast'
import { ToastType } from '~/components/Toast/type'

// 第四期 Sprint B.3：抽 dismissCleanup seam（同 Toast/index.ts 同因）
const buildDismissCleanup = (app: ReturnType<typeof createApp>, textToast: HTMLElement, toastElement: HTMLElement) => () => {
  app.unmount()
  textToast.remove()

  if (Array(...toastElement.children).length === 0) {
    toastElement.remove()
  }
}

export interface CursorToastAction {
  text: string
  onClick: () => void
}

const MOBILE_BREAKPOINT = 768
// Fixed mobile topbar (48px) + sticky bookmarks tab strip (48px) + breathing room.
const MOBILE_STICKY_TABS_HEIGHT = 48
const TOP_SAFE_GAP = 8

export const getToastTopSafeArea = (viewportWidth: number, headerHeight: number) => {
  const headerAndSticky = viewportWidth <= MOBILE_BREAKPOINT ? headerHeight + MOBILE_STICKY_TABS_HEIGHT : headerHeight
  return headerAndSticky + TOP_SAFE_GAP
}

export const shouldPlaceToastAbove = (trackTop: number, toastHeight: number, gap: number, safeTop: number) =>
  trackTop - toastHeight - gap >= safeTop

export const resolveToastLeft = (options: {
  proposedViewportLeft: number
  parentLeft: number
  parentWidth: number
  toastWidth: number
  viewportWidth: number
}) => {
  const viewportLeft = Math.max(0, Math.min(options.viewportWidth - options.toastWidth, options.proposedViewportLeft))
  return Math.max(0, Math.min(options.parentWidth - options.toastWidth, viewportLeft - options.parentLeft))
}

export const resolveActionToastMaxWidth = (viewportWidth: number, parentWidth: number) => {
  const viewportLimit = Math.max(0, Math.min(320, viewportWidth - 24))
  return parentWidth > 0 ? Math.min(viewportLimit, parentWidth) : viewportLimit
}

const readHeaderHeight = () => {
  const style = window.getComputedStyle(document.documentElement)
  const raw = typeof style.getPropertyValue === 'function' ? style.getPropertyValue('--slax-header-height') : ''
  const parsed = Number.parseFloat(raw)
  if (Number.isFinite(parsed) && parsed > 0) return parsed

  return window.innerWidth <= MOBILE_BREAKPOINT ? 48 : 56
}

const showToast = (options: {
  text: string
  trackDom: HTMLElement | null
  baseContainer?: HTMLElement
  duration?: number
  type?: ToastType
  action?: CursorToastAction
}): boolean => {
  const { text, trackDom, baseContainer, duration, type, action } = options
  const parent = baseContainer || document.body

  // parent 须为定位元素，否则回退普通 Toast。
  // 含 fixed，让贴底工具栏也能承载。
  const position = window.getComputedStyle(parent).position
  const isPositioned = position === 'relative' || position === 'absolute' || position === 'fixed' || position === 'sticky'
  if (!trackDom || !isPositioned || !parent.contains(trackDom)) {
    Toast.showToast({
      text,
      ...(type ? { type } : {}),
      ...(action ? { action } : {}),
      ...(duration ? { duration } : {})
    })

    return false
  }

  let toastElement = Array.from(parent.children).find(child => child.classList.contains('cursor-toast-container')) as HTMLElement | undefined
  if (!toastElement) {
    const existing = document.querySelector('.cursor-toast-container') as HTMLElement | null
    if (existing?.parentElement === parent) toastElement = existing
  }
  if (!toastElement) {
    toastElement = document.createElement('div')
    toastElement.classList.add('cursor-toast-container')
    parent.appendChild(toastElement)
  }

  const textToast = document.createElement('div')
  toastElement.appendChild(textToast)

  if (action) {
    // The absolute wrapper has a zero-width containing block, so an action bubble with
    // wrapping text must size to its content explicitly; otherwise CJK text wraps one
    // character per line. Use a pixel max-width so a `100%` limit cannot resolve against
    // the zero-width container and collapse the bubble.
    textToast.style.setProperty('width', 'max-content')
    textToast.style.setProperty('max-width', `${resolveActionToastMaxWidth(window.innerWidth, parent.getBoundingClientRect().width)}px`)
  }

  let dismissCleanup: (() => void) | null = null

  const app = createApp(CursorToast, {
    text,
    duration,
    type,
    action,
    onDismiss: () => dismissCleanup?.()
  })

  dismissCleanup = buildDismissCleanup(app, textToast, toastElement)

  app.mount(textToast)

  const gap = 10
  const targetPosition = getRelativePosition(trackDom, parent)
  const parentRect = parent.getBoundingClientRect()
  const parentWidth = parentRect.width

  // 独立出来在这里进行定位
  textToast.style.setProperty('position', 'absolute')
  textToast.style.setProperty('z-index', `${1000}`)

  nextTick(() => {
    const size = textToast.getBoundingClientRect()
    const toastHeight = size.height
    const toastWidth = size.width

    // 用视口坐标判上下空间：按钮上方必须越过 fixed/sticky header 安全区，
    // 否则改到按钮下方，避免气泡被移动端 sticky 标签栏遮挡。
    const trackRect = trackDom.getBoundingClientRect()
    const viewportWidth = window.innerWidth
    const safeTop = getToastTopSafeArea(viewportWidth, readHeaderHeight())
    const placeAbove = shouldPlaceToastAbove(trackRect.top, toastHeight, gap, safeTop)
    const top = placeAbove ? targetPosition.top - toastHeight - gap : targetPosition.bottom + gap

    // 同时夹在父容器和视口内，避免宽列表或横向滚动时越过右边界。
    const proposedViewportLeft = trackRect.left + (trackRect.width - toastWidth) / 2
    const left = resolveToastLeft({
      proposedViewportLeft,
      parentLeft: parentRect.left,
      parentWidth,
      toastWidth,
      viewportWidth
    })

    textToast.style.setProperty('left', `${left}px`)
    textToast.style.setProperty('top', `${top}px`)
  })

  return true
}

const getRelativePosition = (child: HTMLElement, parent: HTMLElement) => {
  const childRect = child.getBoundingClientRect()
  const parentRect = parent.getBoundingClientRect()
  const scrollTop = parent.scrollTop
  const scrollLeft = parent.scrollLeft

  return {
    top: childRect.top - parentRect.top + scrollTop,
    left: childRect.left - parentRect.left + scrollLeft,
    bottom: childRect.bottom - parentRect.top + scrollTop,
    right: childRect.right - parentRect.left + scrollLeft,
    width: childRect.width,
    height: childRect.height
  }
}

export default { showToast }
