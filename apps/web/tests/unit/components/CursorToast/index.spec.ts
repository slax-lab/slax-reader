// CursorToast/index.ts 工厂单测
// showToast: parent.position!=='relative' 或 trackDom 不在 parent → 退化为普通 Toast
//           否则在 parent 挂 .cursor-toast-container 并定位
import CursorToastModule from '~~/app/components/CursorToast/index'
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
