// @vitest-environment happy-dom
// utils/modal.ts 测试套件 —— Sprint 4
// 覆盖 modalBootloader 工厂（8 用例）：首次挂载 4 + 复用既有 1 + 边界 3
//
// 关键策略：
//   1. mock vue.createApp，但默认实现仍委派给真实 actual.createApp，避免 nuxt-test-utils
//      的 setupNuxt 阶段（每个 spec 文件首先跑一次 createApp 来构建 nuxtApp）拿到 undefined
//      报 "Object.defineProperty called on non-object"
//   2. 每个测试用例调用 createAppMock.mockImplementationOnce(() => stub) 注入受控 stub，
//      之后下一次（如果有）的调用回落到 actual.createApp，sprint 1-3 路径无影响
//   3. mock @unhead/vue/client.createHead 返回 stub plugin
//   4. happy-dom document 真用，beforeEach 已由 setup/index.ts 清空 body
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { actualCreateAppRef, createAppMock, makeAppStub } = vi.hoisted(() => {
  type AppStub = {
    _component: { __name?: string }
    _container: HTMLElement | null
    mount: ReturnType<typeof vi.fn>
    unmount: ReturnType<typeof vi.fn>
    use: ReturnType<typeof vi.fn>
    directive: ReturnType<typeof vi.fn>
  }
  const actualCreateAppRef: { value: ((...args: unknown[]) => unknown) | null } = { value: null }
  const makeAppStub = (componentName?: string): AppStub => {
    const stub: AppStub = {
      _component: componentName !== undefined ? { __name: componentName } : {},
      _container: null,
      mount: vi.fn(),
      unmount: vi.fn(),
      use: vi.fn(),
      directive: vi.fn()
    }
    stub.mount.mockImplementation((el: HTMLElement) => {
      stub._container = el
      return stub
    })
    return stub
  }
  // 默认实现：委派给真实 createApp，让 setupNuxt 等内部调用拿到正常 Vue app
  const createAppMock = vi.fn((...args: unknown[]) => {
    if (!actualCreateAppRef.value) {
      throw new Error('actualCreateApp not initialized in vi.mock factory')
    }
    return actualCreateAppRef.value(...args)
  })
  return { actualCreateAppRef, createAppMock, makeAppStub }
})

vi.mock('vue', async () => {
  const actual = await vi.importActual<typeof import('vue')>('vue')
  actualCreateAppRef.value = actual.createApp as unknown as (...args: unknown[]) => unknown
  return { ...actual, createApp: createAppMock }
})

const { createHeadMock } = vi.hoisted(() => ({
  createHeadMock: vi.fn(() => ({ install: vi.fn() }))
}))

vi.mock('@unhead/vue/client', () => ({
  createHead: createHeadMock
}))

import { modalBootloader } from '~~/app/utils/modal'

const FAKE_COMPONENT = { template: '<div />' }

afterEach(() => {
  vi.restoreAllMocks()
})

beforeEach(() => {
  createHeadMock.mockClear()
  createAppMock.mockClear()
})

describe('modalBootloader', () => {
  describe('首次挂载', () => {
    it('创建新 div + 加 className modal_component_<name> + appendChild 到 document.body', () => {
      const stub = makeAppStub('FeedbackModal')
      createAppMock.mockImplementationOnce(() => stub)

      modalBootloader({ ele: FAKE_COMPONENT, props: {} })

      const el = document.querySelector('.modal_component_FeedbackModal') as HTMLElement
      expect(el).not.toBeNull()
      expect(el.parentElement).toBe(document.body)
      expect(stub.mount).toHaveBeenCalledWith(el)
    })

    it('z-index 设为 100', () => {
      const stub = makeAppStub('FeedbackModal')
      createAppMock.mockImplementationOnce(() => stub)

      modalBootloader({ ele: FAKE_COMPONENT, props: {} })

      const el = document.querySelector('.modal_component_FeedbackModal') as HTMLElement
      expect(el.style.getPropertyValue('z-index')).toBe('100')
    })

    it('container.styles 应用到元素 style', () => {
      const stub = makeAppStub('FeedbackModal')
      createAppMock.mockImplementationOnce(() => stub)

      modalBootloader({
        ele: FAKE_COMPONENT,
        props: {},
        container: { styles: { position: 'fixed', top: '10px' } }
      })

      const el = document.querySelector('.modal_component_FeedbackModal') as HTMLElement
      expect(el.style.getPropertyValue('position')).toBe('fixed')
      expect(el.style.getPropertyValue('top')).toBe('10px')
      expect(el.style.getPropertyValue('z-index')).toBe('100')
    })

    it('调 createApp + mount 返回 app 实例', () => {
      const stub = makeAppStub('FeedbackModal')
      createAppMock.mockImplementationOnce(() => stub)

      const result = modalBootloader({ ele: FAKE_COMPONENT, props: { foo: 'bar' } })

      expect(createAppMock).toHaveBeenCalledWith(FAKE_COMPONENT, { foo: 'bar' })
      expect(stub.mount).toHaveBeenCalledTimes(1)
      expect(result).toBe(stub)
    })
  })

  describe('复用既有元素', () => {
    it('document 已有同 className 元素 → 不再创建新 div + 不重设 styles + 仍 mount 到该元素', () => {
      // 先放一个既存元素，预设 z-index 为 50（与 modalBootloader 默认 100 不同）
      const existing = document.createElement('div')
      existing.classList.add('modal_component_FeedbackModal')
      existing.style.setProperty('z-index', '50')
      document.body.appendChild(existing)

      const stub = makeAppStub('FeedbackModal')
      createAppMock.mockImplementationOnce(() => stub)

      modalBootloader({
        ele: FAKE_COMPONENT,
        props: {},
        container: { styles: { color: 'red' } }
      })

      // 仍然只有一个同 className 元素
      const matched = document.querySelectorAll('.modal_component_FeedbackModal')
      expect(matched.length).toBe(1)
      expect(matched[0]).toBe(existing)

      // z-index 没被覆盖（保留 50）；container.styles 也未应用（color 仍空）
      expect(existing.style.getPropertyValue('z-index')).toBe('50')
      expect(existing.style.getPropertyValue('color')).toBe('')

      // mount 仍然被调到既存元素
      expect(stub.mount).toHaveBeenCalledWith(existing)
    })
  })

  describe('边界', () => {
    it('app._component.__name 缺失（匿名组件）→ 不加 className（不写 classList）+ 仍 createElement + appendChild', () => {
      const stub = makeAppStub() // 匿名：_component = {}
      createAppMock.mockImplementationOnce(() => stub)

      modalBootloader({ ele: FAKE_COMPONENT, props: {} })

      // body 应有一个新 div，但没有 modal_component_undefined className
      const allDivs = document.body.querySelectorAll('div')
      expect(allDivs.length).toBe(1)
      const created = allDivs[0]!
      expect(created.classList.length).toBe(0)
      // z-index 仍写入
      expect(created.style.getPropertyValue('z-index')).toBe('100')
      // mount 调到新 div
      expect(stub.mount).toHaveBeenCalledWith(created)
    })

    it('options.container 不传 → 不应用 styles，仍设 z-index', () => {
      const stub = makeAppStub('LoginModal')
      createAppMock.mockImplementationOnce(() => stub)

      modalBootloader({ ele: FAKE_COMPONENT, props: {} })

      const el = document.querySelector('.modal_component_LoginModal') as HTMLElement
      expect(el.style.getPropertyValue('z-index')).toBe('100')
      // 仅 z-index，无 container 注入的额外样式
      expect(el.style.length).toBe(1)
    })

    it('返回的 app 来自 createApp（断言 mount 被调用、use(createHead()) 被调用）', () => {
      const stub = makeAppStub('LoginModal')
      createAppMock.mockImplementationOnce(() => stub)

      const result = modalBootloader({ ele: FAKE_COMPONENT, props: {} })

      expect(createAppMock).toHaveBeenCalledTimes(1)
      expect(createHeadMock).toHaveBeenCalledTimes(1)
      expect(stub.use).toHaveBeenCalledTimes(1)
      // use 的入参是 createHead() 返回的 plugin
      const plugin = createHeadMock.mock.results[0]!.value
      expect(stub.use).toHaveBeenCalledWith(plugin)
      expect(stub.mount).toHaveBeenCalledTimes(1)
      expect(result).toBe(stub)
    })
  })
})
