// useCommon composable 单元测试 — 主 spec（isClient=true 路径）
// 关键约束：
//  - vi.hoisted 不调 ref（vue 模块未加载触发 TDZ），仅放 spy 句柄
//  - MouseTrack class stub 用 plain function with prototype（lessons §8）
//  - sidebarExpanded 不在 return，通过 onResizeObserver 间接测
//  - useDebounceFn mock 返回独立 debouncedSpy 区分 resizeAnimated 两条路径
//  - 私有 handler 入口：watch（修改 summariesExpanded/botExpanded） + onResizeObserver

import { defineComponent, nextTick, ref } from 'vue'

import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockUseScrollLock, mockUseDebounceFn, debouncedSpy, mockMouseTrack, mouseTrackInstances } = vi.hoisted(() => {
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
    debouncedSpy: vi.fn(),
    mockMouseTrack: MockMouseTrack as any,
    mouseTrackInstances
  }
})

mockNuxtImport('useScrollLock', () => mockUseScrollLock)
mockNuxtImport('useDebounceFn', () => mockUseDebounceFn)

vi.mock('@commons/frontend-utils/mouse', () => ({
  MouseTrack: mockMouseTrack
}))

import { useResize, useTracking } from '~~/app/composables/bookmark/useCommon'

const mountTracking = () => {
  let result: ReturnType<typeof useTracking>
  const wrapper = mount(
    defineComponent({
      setup() {
        result = useTracking()
        return () => null
      }
    })
  )
  return { wrapper, getResult: () => result! }
}

const mountResize = (options: any) => {
  let result: ReturnType<typeof useResize>
  const wrapper = mount(
    defineComponent({
      setup() {
        result = useResize(options)
        return () => null
      }
    })
  )
  return { wrapper, getResult: () => result! }
}

const makeOptions = () => ({
  detailLayout: ref({ isSmallScreen: vi.fn(() => false), contentWidth: vi.fn(() => 800) }) as any,
  summariesSidebar: ref({ contentWidth: vi.fn(() => 200) }) as any,
  botSidebar: ref({ contentWidth: vi.fn(() => 200) }) as any,
  bookmarkDetail: ref({ getBoundingClientRect: vi.fn(() => ({ width: 1000 })) }) as any
})

describe('useTracking', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mouseTrackInstances.length = 0
    document.body.innerHTML = ''
    mockUseScrollLock.mockReturnValue(ref(false))
    mockUseDebounceFn.mockReturnValue(debouncedSpy)
  })

  afterEach(() => vi.restoreAllMocks())

  describe('lifecycle + isLocked（C1-C2）', () => {
    it('C1: 默认 — useScrollLock 调用 + isLocked.value=false + onMounted 触发 mouseTrack(true)', async () => {
      const { getResult } = mountTracking()
      await nextTick()
      expect(mockUseScrollLock).toHaveBeenCalled()
      expect(getResult().isLocked.value).toBe(false)
      expect(mouseTrackInstances[0].mouseTrack).toHaveBeenCalledWith(true)
    })

    it('C2: unmount → tracking.destruct() 调用', () => {
      const { wrapper } = mountTracking()
      wrapper.unmount()
      expect(mouseTrackInstances[0].destruct).toHaveBeenCalled()
    })
  })

  describe('checkInAnotherScrollableView 间接路径（C3-C5）', () => {
    it('C3: 无 .sidebar-content + 调 trackingHandler → isLocked 保持 false', () => {
      const { getResult } = mountTracking()
      mouseTrackInstances[0].touchTrackingHandler()
      expect(getResult().isLocked.value).toBe(false)
    })

    it('C4: 有 .sidebar-content + 鼠标在内 → isLocked=true', () => {
      const div = document.createElement('div')
      div.className = 'sidebar-content'
      document.body.appendChild(div)
      vi.spyOn(div, 'getBoundingClientRect').mockReturnValue({ left: 0, right: 100, top: 0, bottom: 100 } as any)

      const { getResult } = mountTracking()
      mouseTrackInstances[0].lastMousePosition = { x: 50, y: 50 }
      mouseTrackInstances[0].touchTrackingHandler()
      expect(getResult().isLocked.value).toBe(true)
    })

    it('C5: 有 .sidebar-content + 鼠标在外 → isLocked 保持 false', () => {
      const div = document.createElement('div')
      div.className = 'sidebar-content'
      document.body.appendChild(div)
      vi.spyOn(div, 'getBoundingClientRect').mockReturnValue({ left: 0, right: 100, top: 0, bottom: 100 } as any)

      const { getResult } = mountTracking()
      mouseTrackInstances[0].lastMousePosition = { x: 200, y: 200 }
      mouseTrackInstances[0].touchTrackingHandler()
      expect(getResult().isLocked.value).toBe(false)
    })
  })
})

describe('useResize', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mouseTrackInstances.length = 0
    document.body.innerHTML = ''
    mockUseScrollLock.mockReturnValue(ref(false))
    mockUseDebounceFn.mockReturnValue(debouncedSpy)
  })

  afterEach(() => vi.restoreAllMocks())

  describe('初始化（C6, C21-C22）', () => {
    it('C6: 5 个 ref 默认值 + return 7 字段（不含 sidebarExpanded）', () => {
      const { getResult } = mountResize(makeOptions())
      const result = getResult()
      expect(result.resizeAnimated.value).toBe(false)
      expect(result.summariesExpanded.value).toBe(false)
      expect(result.botExpanded.value).toBe(false)
      expect(result.contentXOffset.value).toBe(0)
      expect(result.isNeedResized.value).toBe(false)
      expect('sidebarExpanded' in result).toBe(false)
    })

    it('C21: useDebounceFn 入参 (handler, 500, { maxWait: 5000 })', () => {
      mountResize(makeOptions())
      expect(mockUseDebounceFn).toHaveBeenCalledWith(expect.any(Function), 500, { maxWait: 5000 })
    })

    it('C22: useScrollLock 通过 useTracking 间接被调', () => {
      mountResize(makeOptions())
      expect(mockUseScrollLock).toHaveBeenCalled()
    })
  })

  describe('watch（C7-C9）', () => {
    it('C7: summariesExpanded false→true → tracking.touchTrack(true) + wheelTrack(true) + 调 contentWidthUpdateHandler', async () => {
      const { getResult } = mountResize(makeOptions())
      const result = getResult()
      result.summariesExpanded.value = true
      await nextTick()
      expect(mouseTrackInstances[0].touchTrack).toHaveBeenCalledWith(true)
      expect(mouseTrackInstances[0].wheelTrack).toHaveBeenCalledWith(true)
      // resizeAnimated=false 走同步 handler，debouncedSpy 不调
      expect(debouncedSpy).not.toHaveBeenCalled()
    })

    it('C8: botExpanded false→true → 同 C7', async () => {
      const { getResult } = mountResize(makeOptions())
      const result = getResult()
      result.botExpanded.value = true
      await nextTick()
      expect(mouseTrackInstances[0].touchTrack).toHaveBeenCalledWith(true)
      expect(mouseTrackInstances[0].wheelTrack).toHaveBeenCalledWith(true)
    })

    it('C9: summariesExpanded true→false（关闭路径）→ contentXOffset=0', async () => {
      const { getResult } = mountResize(makeOptions())
      const result = getResult()
      result.summariesExpanded.value = true
      await nextTick()
      result.contentXOffset.value = 50
      result.summariesExpanded.value = false
      await nextTick()
      expect(result.contentXOffset.value).toBe(0)
    })
  })

  describe('onResizeObserver 早退（C10-C11）', () => {
    it('C10: entries 非 Array → contentXOffset=0', () => {
      const { getResult } = mountResize(makeOptions())
      const result = getResult()
      result.contentXOffset.value = 100
      result.onResizeObserver({} as any)
      expect(result.contentXOffset.value).toBe(0)
    })

    it('C11: 正常 entries + !sidebarExpanded → contentXOffset=0', () => {
      const { getResult } = mountResize(makeOptions())
      const result = getResult()
      result.contentXOffset.value = 50
      result.onResizeObserver([{ contentRect: { width: 1200 } }] as any)
      expect(result.contentXOffset.value).toBe(0)
    })
  })

  describe('updateIsNeedResizeHandler（C12-C13）', () => {
    it('C12: gap - maxSidebarContentWidth > panelMaxWidth → isNeedResized=false', () => {
      const opts = makeOptions()
      opts.detailLayout.value!.contentWidth = vi.fn(() => 800)
      opts.summariesSidebar.value!.contentWidth = vi.fn(() => 50)
      opts.botSidebar.value!.contentWidth = vi.fn(() => 50)
      const { getResult } = mountResize(opts)
      const result = getResult()
      // width=2000，gap=(2000-800)/2=600，maxSidebarContentWidth=50，gap-50=550 > 128
      result.onResizeObserver([{ contentRect: { width: 2000 } }] as any)
      expect(result.isNeedResized.value).toBe(false)
    })

    it('C13: gap 不足 → isNeedResized=true', () => {
      const opts = makeOptions()
      opts.detailLayout.value!.contentWidth = vi.fn(() => 800)
      opts.summariesSidebar.value!.contentWidth = vi.fn(() => 600)
      opts.botSidebar.value!.contentWidth = vi.fn(() => 600)
      const { getResult } = mountResize(opts)
      const result = getResult()
      // width=900，gap=50，gap-600=-550 < 128 → isNeedResized=true
      result.onResizeObserver([{ contentRect: { width: 900 } }] as any)
      expect(result.isNeedResized.value).toBe(true)
    })
  })

  describe('contentWidthUpdateHandler（C14-C18）', () => {
    it('C14: isSmallScreen=true → contentXOffset=0 早退', async () => {
      const opts = makeOptions()
      opts.detailLayout.value!.isSmallScreen = vi.fn(() => true)
      const { getResult } = mountResize(opts)
      const result = getResult()
      result.summariesExpanded.value = true
      await nextTick()
      result.contentXOffset.value = 50
      result.onResizeObserver([{ contentRect: { width: 900 } }] as any)
      expect(result.contentXOffset.value).toBe(0)
    })

    it('C15: summariesExpanded + gap 充裕 → contentXOffset=0', async () => {
      const opts = makeOptions()
      opts.detailLayout.value!.contentWidth = vi.fn(() => 600)
      opts.summariesSidebar.value!.contentWidth = vi.fn(() => 50)
      const { getResult } = mountResize(opts)
      const result = getResult()
      result.summariesExpanded.value = true
      await nextTick()
      result.contentXOffset.value = 100
      // width=2000，gap=(2000-600)/2=700，gap-50=650 > 128 → contentXOffset=0
      result.onResizeObserver([{ contentRect: { width: 2000 } }] as any)
      expect(result.contentXOffset.value).toBe(0)
    })

    it('C16: summariesExpanded + gap 不足 → contentXOffset > 0', async () => {
      const opts = makeOptions()
      opts.detailLayout.value!.contentWidth = vi.fn(() => 800)
      opts.summariesSidebar.value!.contentWidth = vi.fn(() => 400)
      const { getResult } = mountResize(opts)
      const result = getResult()
      result.summariesExpanded.value = true
      await nextTick()
      // width=1000，gap=(1000-800)/2=100，gap-400=-300 < 128 → 计算 offsetX=400-100=300
      // centerFineTuningOffsetX=max((100-300)/2, 0)=0
      // contentXOffset=min(300, 100-10)=90
      result.onResizeObserver([{ contentRect: { width: 1000 } }] as any)
      expect(result.contentXOffset.value).toBeGreaterThan(0)
    })

    it('C17: botExpanded + gap 不足 → 用 botSidebar.contentWidth', async () => {
      const opts = makeOptions()
      opts.detailLayout.value!.contentWidth = vi.fn(() => 800)
      opts.botSidebar.value!.contentWidth = vi.fn(() => 400)
      opts.summariesSidebar.value!.contentWidth = vi.fn(() => 50)
      const { getResult } = mountResize(opts)
      const result = getResult()
      result.botExpanded.value = true
      await nextTick()
      result.onResizeObserver([{ contentRect: { width: 1000 } }] as any)
      expect(opts.botSidebar.value!.contentWidth).toHaveBeenCalled()
    })

    it('C18: 双展开 → summariesExpanded 优先（line 114 if 先匹配）', async () => {
      const opts = makeOptions()
      opts.detailLayout.value!.contentWidth = vi.fn(() => 800)
      opts.summariesSidebar.value!.contentWidth = vi.fn(() => 400)
      opts.botSidebar.value!.contentWidth = vi.fn(() => 50)
      const { getResult } = mountResize(opts)
      const result = getResult()
      result.summariesExpanded.value = true
      result.botExpanded.value = true
      await nextTick()
      result.onResizeObserver([{ contentRect: { width: 1000 } }] as any)
      expect(opts.summariesSidebar.value!.contentWidth).toHaveBeenCalled()
    })
  })

  describe('contentWidthUpdate resizeAnimated 分支（C19-C20）', () => {
    it('C19: resizeAnimated=false + onResizeObserver → debouncedSpy 不被调', async () => {
      const { getResult } = mountResize(makeOptions())
      const result = getResult()
      result.summariesExpanded.value = true
      await nextTick()
      debouncedSpy.mockClear()
      result.onResizeObserver([{ contentRect: { width: 1000 } }] as any)
      expect(debouncedSpy).not.toHaveBeenCalled()
    })

    it('C20: resizeAnimated=true + onResizeObserver → debouncedSpy 被调', async () => {
      const { getResult } = mountResize(makeOptions())
      const result = getResult()
      result.resizeAnimated.value = true
      result.summariesExpanded.value = true
      await nextTick()
      debouncedSpy.mockClear()
      result.onResizeObserver([{ contentRect: { width: 1000 } }] as any)
      expect(debouncedSpy).toHaveBeenCalled()
    })
  })
})
