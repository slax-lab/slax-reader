// useExtensionDetection 单元测试
import { defineComponent } from 'vue'

import { useExtensionDetection } from '~~/app/composables/useExtensionDetection'
import { mountWithApp } from '~~/tests/setup/mount'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mountDetection = () => {
  let api: ReturnType<typeof useExtensionDetection> | undefined
  const Host = defineComponent({
    setup() {
      api = useExtensionDetection()
      return () => null
    }
  })
  const wrapper = mountWithApp(Host)
  return { wrapper, api: api! }
}

describe('useExtensionDetection', () => {
  afterEach(() => {
    vi.useRealTimers()
    document.querySelectorAll('slax-reader-panel, slax-reader-modal').forEach(el => el.remove())
  })

  it('挂载时 DOM 已含 slax-reader-panel：立即判定已安装', () => {
    const panel = document.createElement('slax-reader-panel')
    document.body.appendChild(panel)

    const { api } = mountDetection()
    expect(api.isInstalled.value).toBe(true)
    expect(api.checked.value).toBe(true)
  })

  it('挂载时 DOM 已含 slax-reader-modal：立即判定已安装', () => {
    const modal = document.createElement('slax-reader-modal')
    document.body.appendChild(modal)

    const { api } = mountDetection()
    expect(api.isInstalled.value).toBe(true)
    expect(api.checked.value).toBe(true)
  })

  it('挂载时无标记，之后异步插入：MutationObserver 命中后判定已安装', async () => {
    const { api } = mountDetection()
    expect(api.checked.value).toBe(false)

    const panel = document.createElement('slax-reader-panel')
    document.body.appendChild(panel)

    await vi.waitFor(() => {
      expect(api.checked.value).toBe(true)
    })

    expect(api.isInstalled.value).toBe(true)
  })

  it('超时未探测到标记：判定未安装（但仍继续监听）', () => {
    vi.useFakeTimers()
    const { api } = mountDetection()

    expect(api.checked.value).toBe(false)
    vi.advanceTimersByTime(1500)

    expect(api.isInstalled.value).toBe(false)
    expect(api.checked.value).toBe(true)
  })

  it('超时后标记才迟到插入（扩展 shadow-root 注入慢于探测超时）：isInstalled 补判为已安装，修复"已装插件被永久误判为未装"', () => {
    vi.useFakeTimers()
    const { api } = mountDetection()

    vi.advanceTimersByTime(1500)
    expect(api.checked.value).toBe(true)
    expect(api.isInstalled.value).toBe(false)

    // observer 超时后不能断开，否则永远错过这次迟到的插入
    const panel = document.createElement('slax-reader-panel')
    document.body.appendChild(panel)

    return vi.waitFor(() => {
      expect(api.isInstalled.value).toBe(true)
    })
  })

  it('页面切回可见/重新获得焦点后主动复查扩展标记', async () => {
    const panel = document.createElement('slax-reader-panel')
    let markerAvailable = false
    const originalQuerySelector = document.querySelector.bind(document)
    const querySelectorSpy = vi.spyOn(document, 'querySelector').mockImplementation((selector: string) => {
      if (selector === 'slax-reader-panel' || selector === 'slax-reader-modal') {
        return selector === 'slax-reader-panel' && markerAvailable ? panel : null
      }
      return originalQuerySelector(selector)
    })

    const { api } = mountDetection()
    expect(api.isInstalled.value).toBe(false)

    // 模拟从扩展商店页面切回 onboarding 页面
    markerAvailable = true
    window.dispatchEvent(new Event('focus'))

    await vi.waitFor(() => {
      expect(api.isInstalled.value).toBe(true)
      expect(api.checked.value).toBe(true)
    })
    querySelectorSpy.mockRestore()
  })

  it('组件卸载时清理 observer/timer，不再触发状态变更', () => {
    vi.useFakeTimers()
    const { wrapper, api } = mountDetection()

    wrapper.unmount()
    vi.advanceTimersByTime(1500)

    // timer 已清理
    expect(api.checked.value).toBe(false)
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })
})
