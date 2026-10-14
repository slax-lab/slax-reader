import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import SnapshotSidePanel from '~~/app/components/Layouts/SnapshotSidePanel.vue'
import { mountWithApp } from '~~/tests/setup/mount'

mockNuxtImport('useSnapshotLayout', () => () => ({
  isH5: ref(true), panelWidth: ref(440), isDragging: ref(false), startDrag: vi.fn()
}))

describe('SnapshotSidePanel PDF keyboard viewport', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('tracks the keyboard after PDF metadata arrives and stops for an article', async () => {
    const viewport = Object.assign(new EventTarget(), { height: 800, offsetTop: 0 })
    vi.stubGlobal('visualViewport', viewport)
    vi.stubGlobal('innerHeight', 800)
    const wrapper = mountWithApp(SnapshotSidePanel, { props: { activeTab: 'comment', keyboardAware: false } })
    const panel = () => wrapper.find('aside').element as HTMLElement
    expect(panel().style.bottom).toBe('')

    await wrapper.setProps({ keyboardAware: true })
    viewport.height = 400
    viewport.dispatchEvent(new Event('resize'))
    await wrapper.vm.$nextTick()
    expect(panel().style.bottom).toBe('400px')
    expect(panel().style.maxHeight).toBe('360px')

    viewport.offsetTop = 50
    viewport.dispatchEvent(new Event('scroll'))
    await wrapper.vm.$nextTick()
    expect(panel().style.bottom).toBe('350px')

    await wrapper.setProps({ keyboardAware: false })
    viewport.height = 300
    viewport.dispatchEvent(new Event('resize'))
    await wrapper.vm.$nextTick()
    expect(panel().style.bottom).toBe('')
    wrapper.unmount()
  })
})
