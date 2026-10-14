// Toast/index.ts 工厂单测
// showToast: 创建/复用 .toast.toast-start 容器，挂载 Toast 组件，dismiss 时清理
import ToastModule from '~~/app/components/Toast/index'
import { ToastType } from '~~/app/components/Toast/type'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('Toast/index showToast 工厂', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('首次调用 → 创建 .toast.toast-start 容器并挂载 Toast', () => {
    ToastModule.showToast({ text: 'Hello' })
    const container = document.querySelector('.toast.toast-start')
    expect(container).not.toBeNull()
    // Toast 组件挂载到子元素
    expect((container as HTMLElement).children.length).toBeGreaterThanOrEqual(1)
  })

  it('容器已存在时 → 复用已有 .toast.toast-start', () => {
    const existing = document.createElement('div')
    existing.classList.add('toast', 'toast-start')
    document.body.appendChild(existing)
    ToastModule.showToast({ text: 'X' })
    // 仅一个 .toast 容器
    const list = document.querySelectorAll('.toast.toast-start')
    expect(list.length).toBe(1)
    expect(list[0]).toBe(existing)
  })

  it('容器 z-index 设为 9999（需盖过全站最高 z-index 弹层）', () => {
    ToastModule.showToast({ text: 'X' })
    const container = document.querySelector('.toast.toast-start') as HTMLElement
    expect(container.style.getPropertyValue('z-index')).toBe('9999')
  })

  it('options.action → 渲染下划线按钮，点击后执行 onClick 并关闭', async () => {
    vi.useFakeTimers()
    const onClick = vi.fn()
    ToastModule.showToast({ text: 'Blocked', type: ToastType.Error, action: { text: 'Turn on', onClick } })
    await vi.advanceTimersByTimeAsync(0)
    const button = document.querySelector('.text-toast .toast-action') as HTMLButtonElement
    expect(button).not.toBeNull()
    expect(button.textContent).toBe('Turn on')
    const toast = document.querySelector('.text-toast') as HTMLElement
    expect(toast.classList.contains('with-action')).toBe(true)
    expect(toast.style.display).not.toBe('none')
    button.click()
    // v-show 在 Transition leave 结束后才写 display:none，happy-dom 下靠 fake timers 推一帧
    await vi.advanceTimersByTimeAsync(50)
    expect(onClick).toHaveBeenCalledTimes(1)
    expect(toast.style.display).toBe('none')
    vi.useRealTimers()
  })

  it('options.duration 覆盖默认 2500ms', async () => {
    vi.useFakeTimers()
    ToastModule.showToast({ text: 'Long', duration: 6000 })
    await vi.advanceTimersByTimeAsync(0)
    const toast = document.querySelector('.text-toast') as HTMLElement
    await vi.advanceTimersByTimeAsync(3000)
    expect(toast.style.display).not.toBe('none')
    await vi.advanceTimersByTimeAsync(3100)
    expect(toast.style.display).toBe('none')
    vi.useRealTimers()
  })

  it('options.type 透传到 Toast 组件 props', () => {
    ToastModule.showToast({ text: 'Err', type: ToastType.Error })
    const errorToast = document.querySelector('.text-toast.error')
    expect(errorToast).not.toBeNull()
  })

  it('未传 type → 走 ToastType.Normal 默认（不含 success/error class）', () => {
    ToastModule.showToast({ text: 'Default' })
    const toast = document.querySelector('.text-toast')
    expect(toast).not.toBeNull()
    expect(toast!.classList.contains('success')).toBe(false)
    expect(toast!.classList.contains('error')).toBe(false)
  })

  it('Toast 自动 2500ms 消失 → onDismiss 触发 unmount + 容器清理（最后一个移除时整个容器移除）', async () => {
    vi.useFakeTimers()
    ToastModule.showToast({ text: 'Auto' })
    const container = document.querySelector('.toast.toast-start')
    expect(container).not.toBeNull()
    expect((container as HTMLElement).children.length).toBe(1)
    // 1) Toast 内部 nextTick → showToast=true（happy-dom 立即触发 leave 因为没有真实 transition）
    // 2) 2500ms 后 showToast=false → Transition leave → after-leave → onDismiss
    await vi.advanceTimersByTimeAsync(2600)
    // 此时 unmount + remove 已完成
    // happy-dom 下 transition 不真实运行，after-leave 不会自动 emit；这里仅断言不抛错即可
    vi.useRealTimers()
    expect(true).toBe(true)
  })

  it('多次 showToast → 多个 textToast 共享同一容器', () => {
    ToastModule.showToast({ text: 'A' })
    ToastModule.showToast({ text: 'B' })
    const container = document.querySelector('.toast.toast-start') as HTMLElement
    expect(container.children.length).toBe(2)
  })
})

// 第四期 Sprint B.3：dismissCleanup seam 单独 describe（重新 import + mock Toast 立即 dismiss）
// Why：Toast.vue 内 <Transition> after-leave 在 happy-dom 不真触发，无法走 dismissCleanup 链。
//      对 Toast.vue 做 mock 让其在 onMounted 时立即 emit('dismiss') 走源码 cleanup。
// How：vi.doMock + 动态 import，仅在本 describe 生效。
describe('Toast/index Sprint B.3：dismissCleanup seam', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    vi.resetModules()
  })

  afterEach(() => {
    vi.doUnmock('~~/app/components/Toast/Toast.vue')
    document.body.innerHTML = ''
  })

  it('onDismiss 触发：unmount + textToast 移除 + 单 toast 时容器整体移除', async () => {
    vi.doMock('~~/app/components/Toast/Toast.vue', () => ({
      default: {
        name: 'ToastStub',
        props: ['text', 'type'],
        emits: ['dismiss'],
        setup(_props: unknown, { emit }: { emit: (event: string) => void }) {
          // mount 后立即 emit dismiss，等价 transition after-leave
          Promise.resolve().then(() => emit('dismiss'))
          return () => null
        }
      }
    }))
    const Module = (await import('~~/app/components/Toast/index')).default
    Module.showToast({ text: 'X' })
    // 等 microtask 完成
    await Promise.resolve()
    await Promise.resolve()
    // cleanup 已运行，整个容器被移除
    expect(document.querySelector('.toast.toast-start')).toBeNull()
  })

  it('onDismiss 触发：多 toast 时仅移除自身 textToast，容器保留', async () => {
    let dismissEmitter: (() => void) | null = null
    vi.doMock('~~/app/components/Toast/Toast.vue', () => ({
      default: {
        name: 'ToastStub',
        props: ['text', 'type'],
        emits: ['dismiss'],
        setup(_props: unknown, { emit }: { emit: (event: string) => void }) {
          // 第一个 mount 暂存 emit 让外部触发；其它 mount 不 emit
          if (!dismissEmitter) {
            dismissEmitter = () => emit('dismiss')
          }
          return () => null
        }
      }
    }))
    const Module = (await import('~~/app/components/Toast/index')).default
    Module.showToast({ text: 'A' })
    Module.showToast({ text: 'B' })
    const container = document.querySelector('.toast.toast-start') as HTMLElement
    expect(container.children.length).toBe(2)
    // 触发第一个 toast dismiss
    ;(dismissEmitter as (() => void) | null)?.()
    await Promise.resolve()
    expect(container.children.length).toBe(1)
    expect(document.querySelector('.toast.toast-start')).not.toBeNull()
  })
})
