// useCommon — isClient=false 单元测试（独立文件）
// 因 ESM 本地绑定固化（lessons §1），isClient 切换必须独立 spec + vi.doMock + vi.resetModules + 动态 import

import { defineComponent } from 'vue'

import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

const { mockUseScrollLock, mockUseDebounceFn, mockMouseTrack, mouseTrackInstances } = vi.hoisted(() => {
  const mouseTrackInstances: any[] = []
  function MockMouseTrack(this: any, opts: any) {
    this.touchTrackingHandler = opts.touchTrackingHandler
    this.wheelTrackingHandler = opts.wheelTrackingHandler
    this.touchTrack = vi.fn()
    this.wheelTrack = vi.fn()
    this.mouseTrack = vi.fn()
    this.destruct = vi.fn()
    this.lastMousePosition = { x: 0, y: 0 }
    mouseTrackInstances.push(this)
  }
  return {
    mockUseScrollLock: vi.fn(),
    mockUseDebounceFn: vi.fn(),
    mockMouseTrack: MockMouseTrack as any,
    mouseTrackInstances
  }
})

mockNuxtImport('useScrollLock', () => mockUseScrollLock)
mockNuxtImport('useDebounceFn', () => mockUseDebounceFn)

vi.mock('@commons/utils/mouse', () => ({
  MouseTrack: mockMouseTrack
}))

describe('useCommon — isClient=false', () => {
  it('C23: non-client 路径 — useScrollLock 不被调用，isLocked 是 ref(false)', async () => {
    vi.resetModules()
    vi.doMock('@commons/utils/is', () => ({ isClient: false }))

    mockUseDebounceFn.mockReturnValue(vi.fn())

    const { useTracking } = await import('~~/app/composables/bookmark/useCommon')

    let result: ReturnType<typeof useTracking>
    mount(
      defineComponent({
        setup() {
          result = useTracking()
          return () => null
        }
      })
    )

    expect(mockUseScrollLock).not.toHaveBeenCalled()
    expect(result!.isLocked.value).toBe(false)
  })
})
