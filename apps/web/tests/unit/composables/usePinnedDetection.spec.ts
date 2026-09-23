// usePinnedDetection 单元测试
import { defineComponent } from 'vue'

import { usePinnedDetection } from '~~/app/composables/usePinnedDetection'
import { mountWithApp } from '~~/tests/setup/mount'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mountDetection = () => {
  let api: ReturnType<typeof usePinnedDetection> | undefined
  const Host = defineComponent({
    setup() {
      api = usePinnedDetection()
      return () => null
    }
  })
  const wrapper = mountWithApp(Host)
  return { wrapper, api: api! }
}

describe('usePinnedDetection', () => {
  afterEach(() => {
    document.querySelectorAll('slax-reader-panel, slax-reader-modal').forEach(el => el.remove())
  })

  it('宿主元素不存在 → isPinned 恒为 false', () => {
    const { api } = mountDetection()
    expect(api.isPinned.value).toBe(false)
  })

  it('挂载时宿主元素已存在且 data-slax-pinned=true → isPinned=true', () => {
    const panel = document.createElement('slax-reader-panel')
    panel.setAttribute('data-slax-pinned', 'true')
    document.body.appendChild(panel)

    const { api } = mountDetection()
    expect(api.isPinned.value).toBe(true)
  })

  it('挂载时宿主元素已存在但属性为 false → isPinned=false', () => {
    const panel = document.createElement('slax-reader-panel')
    panel.setAttribute('data-slax-pinned', 'false')
    document.body.appendChild(panel)

    const { api } = mountDetection()
    expect(api.isPinned.value).toBe(false)
  })

  it('宿主元素延迟出现 → MutationObserver 捕获后读取属性', async () => {
    const { api } = mountDetection()
    expect(api.isPinned.value).toBe(false)

    const panel = document.createElement('slax-reader-panel')
    panel.setAttribute('data-slax-pinned', 'true')
    document.body.appendChild(panel)

    await vi.waitFor(() => {
      expect(api.isPinned.value).toBe(true)
    })
  })

  it('属性值后续变化（false→true）→ isPinned 跟随更新', async () => {
    const panel = document.createElement('slax-reader-panel')
    panel.setAttribute('data-slax-pinned', 'false')
    document.body.appendChild(panel)

    const { api } = mountDetection()
    expect(api.isPinned.value).toBe(false)

    panel.setAttribute('data-slax-pinned', 'true')
    await vi.waitFor(() => {
      expect(api.isPinned.value).toBe(true)
    })
  })

  it('visibilitychange → visible 时重新读取当前属性值', async () => {
    const panel = document.createElement('slax-reader-panel')
    panel.setAttribute('data-slax-pinned', 'true')
    document.body.appendChild(panel)

    const { api } = mountDetection()
    await vi.waitFor(() => {
      expect(api.isPinned.value).toBe(true)
    })

    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
    expect(api.isPinned.value).toBe(true)
  })

  it('组件卸载后不再响应属性变化', async () => {
    const panel = document.createElement('slax-reader-panel')
    panel.setAttribute('data-slax-pinned', 'false')
    document.body.appendChild(panel)

    const { wrapper, api } = mountDetection()
    wrapper.unmount()

    panel.setAttribute('data-slax-pinned', 'true')
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(api.isPinned.value).toBe(false)
  })
})
