// CursorToast/index.ts 工厂单测
// showToast: parent.position!=='relative' 或 trackDom 不在 parent → 退化为普通 Toast
//           否则在 parent 挂 .cursor-toast-container 并定位
import { nextTick } from 'vue'

import CursorToastModule, {
  getToastTopSafeArea,
  resolveActionToastMaxWidth,
  resolveToastLeft,
  shouldPlaceToastAbove
} from '~~/app/components/CursorToast/index'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockToastShowToast } = vi.hoisted(() => ({
  mockToastShowToast: vi.fn()
}))

vi.mock('~/components/Toast', () => ({
  default: { showToast: mockToastShowToast },
  ToastType: { Normal: 'normal', Success: 'success', Error: 'error' }
}))

describe('CursorToast/index showToast 工厂', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    document.body.innerHTML = ''
    document.body.style.position = ''
  })

  afterEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
    document.body.style.position = ''
  })

  it('trackDom=null → 退化为普通 Toast.showToast({ text })', () => {
    CursorToastModule.showToast({ text: 'Hello', trackDom: null as any })
    expect(mockToastShowToast).toHaveBeenCalledWith({ text: 'Hello' })
  })

  it('parent 非 position:relative → 退化为普通 Toast', () => {
    const trackDom = document.createElement('div')
    document.body.appendChild(trackDom)
    // body.position 默认非 relative
    CursorToastModule.showToast({ text: 'X', trackDom })
    expect(mockToastShowToast).toHaveBeenCalledWith({ text: 'X' })
  })

  it('trackDom 不在 parent 内 → 退化', () => {
    const parent = document.createElement('div')
    parent.style.position = 'relative'
    document.body.appendChild(parent)
    const trackDom = document.createElement('div')
    document.body.appendChild(trackDom)
    CursorToastModule.showToast({ text: 'X', trackDom, baseContainer: parent })
    expect(mockToastShowToast).toHaveBeenCalledWith({ text: 'X' })
  })

  it('parent + trackDom 配对 → 创建 .cursor-toast-container 并挂载', () => {
    const parent = document.createElement('div')
    parent.style.position = 'relative'
    document.body.appendChild(parent)
    const trackDom = document.createElement('div')
    parent.appendChild(trackDom)
    CursorToastModule.showToast({ text: 'X', trackDom, baseContainer: parent })
    const container = parent.querySelector('.cursor-toast-container')
    expect(container).not.toBeNull()
    expect(mockToastShowToast).not.toHaveBeenCalled()
  })

  it('does not reuse a .cursor-toast-container owned by another parent', () => {
    const parentA = document.createElement('div')
    const parentB = document.createElement('div')
    parentA.style.position = 'relative'
    parentB.style.position = 'relative'
    document.body.append(parentA, parentB)
    const trackA = document.createElement('div')
    const trackB = document.createElement('div')
    parentA.appendChild(trackA)
    parentB.appendChild(trackB)
    vi.spyOn(window, 'getComputedStyle').mockImplementation((el: Element) => {
      if (el === parentA || el === parentB) return { position: 'relative' } as CSSStyleDeclaration
      return { position: 'static' } as CSSStyleDeclaration
    })

    CursorToastModule.showToast({ text: 'A', trackDom: trackA, baseContainer: parentA })
    CursorToastModule.showToast({ text: 'B', trackDom: trackB, baseContainer: parentB })

    expect(parentA.querySelectorAll('.cursor-toast-container')).toHaveLength(1)
    expect(parentB.querySelectorAll('.cursor-toast-container')).toHaveLength(1)
    expect(parentA.querySelector('.cursor-toast-container')?.parentElement).toBe(parentA)
    expect(parentB.querySelector('.cursor-toast-container')?.parentElement).toBe(parentB)
  })

  it('已有 .cursor-toast-container → 复用', () => {
    const parent = document.createElement('div')
    parent.style.position = 'relative'
    document.body.appendChild(parent)
    const existing = document.createElement('div')
    existing.classList.add('cursor-toast-container')
    parent.appendChild(existing)
    const trackDom = document.createElement('div')
    parent.appendChild(trackDom)
    CursorToastModule.showToast({ text: 'X', trackDom, baseContainer: parent })
    const list = parent.querySelectorAll('.cursor-toast-container')
    expect(list.length).toBe(1)
  })

  it('未传 baseContainer → 走 document.body 路径但 body 非 relative → 退化', () => {
    const trackDom = document.createElement('div')
    document.body.appendChild(trackDom)
    CursorToastModule.showToast({ text: 'X', trackDom })
    expect(mockToastShowToast).toHaveBeenCalled()
  })

  it('多次挂 + 共享 .cursor-toast-container 容器', () => {
    const parent = document.createElement('div')
    parent.style.position = 'relative'
    document.body.appendChild(parent)
    const td1 = document.createElement('div')
    const td2 = document.createElement('div')
    parent.appendChild(td1)
    parent.appendChild(td2)
    CursorToastModule.showToast({ text: 'A', trackDom: td1, baseContainer: parent })
    CursorToastModule.showToast({ text: 'B', trackDom: td2, baseContainer: parent })
    const container = parent.querySelector('.cursor-toast-container') as HTMLElement
    expect(container).not.toBeNull()
    expect(container.children.length).toBe(2)
  })

  it('targetPosition.top < toastHeight + gap → toast 显示在元素下方（间接：定位逻辑跑通不抛错）', () => {
    const parent = document.createElement('div')
    parent.style.position = 'relative'
    document.body.appendChild(parent)
    const trackDom = document.createElement('div')
    parent.appendChild(trackDom)
    CursorToastModule.showToast({ text: 'X', trackDom, baseContainer: parent, duration: 500 })
    // 定位 nextTick 内运行，不抛错即覆盖
    expect(parent.querySelector('.cursor-toast-container')).not.toBeNull()
  })

  it('reserves the mobile sticky header safe area before placing above', () => {
    const safeTop = getToastTopSafeArea(320, 48)
    expect(safeTop).toBe(104)
    expect(shouldPlaceToastAbove(120, 40, 10, safeTop)).toBe(false)
    expect(shouldPlaceToastAbove(200, 40, 10, safeTop)).toBe(true)
    expect(getToastTopSafeArea(1024, 56)).toBe(64)
  })

  it('clamps the toast inside both the parent and the viewport right edge', () => {
    expect(
      resolveToastLeft({ proposedViewportLeft: 400, parentLeft: 0, parentWidth: 500, toastWidth: 200, viewportWidth: 320 })
    ).toBe(120)
    expect(
      resolveToastLeft({ proposedViewportLeft: 100, parentLeft: 20, parentWidth: 200, toastWidth: 100, viewportWidth: 320 })
    ).toBe(80)
  })

  it('moves a star near the top below the button instead of under the sticky tabs', async () => {
    const parent = document.createElement('div')
    parent.style.position = 'relative'
    document.body.appendChild(parent)
    const trackDom = document.createElement('button')
    parent.appendChild(trackDom)

    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(320)
    vi.spyOn(window, 'getComputedStyle').mockImplementation((el: Element) => {
      if (el === parent) return { position: 'relative' } as CSSStyleDeclaration
      return {
        position: 'static',
        getPropertyValue: (name: string) => (name === '--slax-header-height' ? '48px' : '')
      } as CSSStyleDeclaration
    })

    const rect = (top: number, left: number, width: number, height: number) =>
      ({ top, left, width, height, bottom: top + height, right: left + width, x: left, y: top, toJSON: () => ({}) }) as DOMRect
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this === parent) return rect(0, 0, 320, 600)
      if (this === trackDom) return rect(120, 280, 32, 28)
      if (this.parentElement?.classList.contains('cursor-toast-container')) return rect(0, 0, 200, 40)
      return rect(0, 0, 0, 0)
    })

    CursorToastModule.showToast({ text: 'X', trackDom, baseContainer: parent })
    await nextTick()
    await nextTick()

    const container = parent.querySelector('.cursor-toast-container') as HTMLElement
    const toast = container.firstElementChild as HTMLElement
    expect(toast.style.top).toBe('158px')
    expect(toast.style.left).toBe('120px')
  })

  it('无锚点：action 与 duration 一并交给全局 Toast，并返回 false', () => {
    const action = { text: 'View collection', onClick: vi.fn() }
    const result = CursorToastModule.showToast({ text: 'X', trackDom: null, action, duration: 4000, type: 'success' as never })

    expect(result).toBe(false)
    expect(mockToastShowToast).toHaveBeenCalledWith({ text: 'X', type: 'success', action, duration: 4000 })
  })

  it('锚定成功：返回 true 且不调用全局 Toast', () => {
    const parent = document.createElement('div')
    parent.style.position = 'relative'
    document.body.appendChild(parent)
    const trackDom = document.createElement('div')
    parent.appendChild(trackDom)

    const result = CursorToastModule.showToast({ text: 'X', trackDom, baseContainer: parent })

    expect(result).toBe(true)
    expect(mockToastShowToast).not.toHaveBeenCalled()
    expect(parent.querySelector('.cursor-toast-container')).not.toBeNull()
  })

  it('action 气泡：定位节点按内容宽度布局，避免 CJK 逐字换行', () => {
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(320)
    const parent = document.createElement('div')
    parent.style.position = 'relative'
    document.body.appendChild(parent)
    const trackDom = document.createElement('div')
    parent.appendChild(trackDom)

    CursorToastModule.showToast({
      text: '已加入星标合集',
      action: { text: '查看合集', onClick: vi.fn() },
      trackDom,
      baseContainer: parent
    })

    const wrapper = parent.querySelector('.cursor-toast-container > div') as HTMLElement
    expect(wrapper).not.toBeNull()
    expect(wrapper.style.width).toBe('max-content')
    // 回归：max-width 必须是正像素值，不能相对零宽容器解析成 0。
    const maxWidth = Number.parseFloat(wrapper.style.maxWidth)
    expect(Number.isFinite(maxWidth)).toBe(true)
    expect(maxWidth).toBeGreaterThan(0)
    expect(maxWidth).toBeLessThanOrEqual(320)
    expect(wrapper.style.maxWidth).not.toContain('100%')
  })

  it('action 气泡宽度：按视口和父容器夹紧，且不会退化为 0', () => {
    expect(resolveActionToastMaxWidth(320, 288)).toBe(288)
    expect(resolveActionToastMaxWidth(1200, 880)).toBe(320)
    expect(resolveActionToastMaxWidth(320, 0)).toBe(296)

    const width = resolveActionToastMaxWidth(320, 288)
    const left = resolveToastLeft({
      proposedViewportLeft: 300,
      parentLeft: 16,
      parentWidth: 288,
      toastWidth: width,
      viewportWidth: 320
    })
    expect(width).toBeGreaterThan(0)
    expect(left + width).toBeLessThanOrEqual(320)
  })
})

// 第四期 Sprint B.3：dismissCleanup seam
describe('CursorToast/index Sprint B.3：dismissCleanup seam', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    document.body.innerHTML = ''
    document.body.style.position = ''
    vi.resetModules()
  })

  afterEach(() => {
    vi.doUnmock('~~/app/components/CursorToast/CursorToast.vue')
    document.body.innerHTML = ''
    document.body.style.position = ''
  })

  it('onDismiss 触发：unmount + textToast 移除 + 单 toast 时容器整体移除', async () => {
    vi.doMock('~~/app/components/CursorToast/CursorToast.vue', () => ({
      default: {
        name: 'CursorToastStub',
        props: ['text', 'duration'],
        emits: ['dismiss'],
        setup(_props: unknown, { emit }: { emit: (event: string) => void }) {
          Promise.resolve().then(() => emit('dismiss'))
          return () => null
        }
      }
    }))
    const Module = (await import('~~/app/components/CursorToast/index')).default
    const parent = document.createElement('div')
    parent.style.position = 'relative'
    document.body.appendChild(parent)
    // window.getComputedStyle 在 happy-dom 不返回 position；spy 覆盖
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({ position: 'relative' } as unknown as CSSStyleDeclaration)
    const trackDom = document.createElement('div')
    parent.appendChild(trackDom)

    Module.showToast({ text: 'X', trackDom, baseContainer: parent })
    await Promise.resolve()
    await Promise.resolve()
    expect(parent.querySelector('.cursor-toast-container')).toBeNull()
  })
})
