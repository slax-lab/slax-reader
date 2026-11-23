import { defineComponent, h, nextTick } from 'vue'

import { mount } from '@vue/test-utils'
import { useReadingPosition } from '~~/app/composables/useReadingPosition'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const saved = { index: -1, ratio: 0, percent: 0.5 }
let wrapper: ReturnType<typeof mount>
let y = 0
let scroll: ReturnType<typeof vi.spyOn>
let handle: ReturnType<typeof useReadingPosition>
const start = (overrides: Partial<Parameters<typeof useReadingPosition>[1]> = {}) => {
  const options = { load: vi.fn().mockResolvedValue(saved), save: vi.fn(), clear: vi.fn(), ...overrides }
  wrapper = mount(defineComponent({
    setup() {
      handle = useReadingPosition('article', options)
      return () => h('div', { class: 'bookmark-detail' }, h('div', { class: 'html-text' }, h('p', 'Long article')))
    }
  }), { attachTo: document.body })
  return options
}

beforeEach(() => {
  vi.useFakeTimers()
  y = 0
  vi.spyOn(window, 'scrollY', 'get').mockImplementation(() => y)
  vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(500)
  vi.spyOn(document.documentElement, 'scrollHeight', 'get').mockReturnValue(2000)
  scroll = vi.spyOn(window, 'scrollTo').mockImplementation((value: any) => { y = value.top })
})
afterEach(() => {
  wrapper?.unmount()
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('reading position restoration', () => {
  it.each(['interacted', 'history', 'explicit'] as const)('keeps bootstrap %s intent even after URL cleanup', async intent => {
    const navigation = { path: '/b/article', initial: true, history: false, explicit: false, interacted: false, stop: vi.fn(), [intent]: true }
    const options = start({ navigation })
    await vi.advanceTimersByTimeAsync(1700)
    expect(options.load).not.toHaveBeenCalled()
    expect(scroll).not.toHaveBeenCalled()
  })

  it('cancels correction timers when a panel selects a passage', async () => {
    start()
    await vi.advanceTimersByTimeAsync(30)
    scroll.mockClear()
    window.dispatchEvent(new Event('slax:reader-navigation'))
    await vi.advanceTimersByTimeAsync(1700)
    expect(scroll).not.toHaveBeenCalled()
  })

  it('cancels scheduled corrections when the article unmounts', async () => {
    start()
    await vi.advanceTimersByTimeAsync(30)
    wrapper.unmount()
    scroll.mockClear()
    await vi.advanceTimersByTimeAsync(1700)
    expect(scroll).not.toHaveBeenCalled()
  })

  it('restores eligible progress when the reader has not interacted', async () => {
    start()
    await vi.advanceTimersByTimeAsync(1700)
    expect(scroll).toHaveBeenCalledWith({ top: 750, behavior: 'auto' })
  })

  it('does not restore after scrolling while readiness is pending', async () => {
    let ready = false
    start({ ready: () => ready })
    window.dispatchEvent(new WheelEvent('wheel', { deltaY: 100 }))
    ready = true
    await vi.advanceTimersByTimeAsync(1700)
    expect(scroll).not.toHaveBeenCalled()
  })

  it('discards a saved position returned after the reader scrolls', async () => {
    let resolve!: (value: typeof saved) => void
    start({ load: () => new Promise(r => { resolve = r }) })
    await vi.advanceTimersByTimeAsync(20)
    window.dispatchEvent(new WheelEvent('wheel', { deltaY: 100 }))
    resolve(saved)
    await vi.advanceTimersByTimeAsync(1700)
    expect(scroll).not.toHaveBeenCalled()
  })

  it('preserves a native document position established while the local read is pending', async () => {
    let resolve!: (value: typeof saved) => void
    start({ navigation: { path: '/b/article', initial: true, history: false, explicit: false, interacted: false, stop: vi.fn() }, load: () => new Promise(r => { resolve = r }) })
    await vi.advanceTimersByTimeAsync(20)
    y = 900
    resolve(saved)
    await vi.advanceTimersByTimeAsync(1700)
    expect(scroll).not.toHaveBeenCalled()
  })

  it('discards a saved position returned after leaving the article', async () => {
    let resolve!: (value: typeof saved) => void
    start({ load: () => new Promise(r => { resolve = r }) })
    await vi.advanceTimersByTimeAsync(20)
    wrapper.unmount()
    resolve(saved)
    await vi.advanceTimersByTimeAsync(1700)
    expect(scroll).not.toHaveBeenCalled()
  })

  it('rechecks an explicit target that arrives during position loading', async () => {
    let skip = false
    let resolve!: (value: typeof saved) => void
    start({ skipRestore: () => skip, load: () => new Promise(r => { resolve = r }) })
    await vi.advanceTimersByTimeAsync(20)
    skip = true
    resolve(saved)
    await vi.advanceTimersByTimeAsync(1700)
    expect(scroll).not.toHaveBeenCalled()
  })

  it('ends restore mode immediately when the reader takes control', async () => {
    const options = start()
    await vi.advanceTimersByTimeAsync(30)
    scroll.mockClear()
    window.dispatchEvent(new WheelEvent('wheel', { deltaY: 100 }))
    y = 900
    window.dispatchEvent(new Event('scroll'))
    await nextTick()
    await vi.advanceTimersByTimeAsync(450)
    expect(options.save).toHaveBeenCalledWith({ index: -1, ratio: 0, percent: 0.6 })
    expect(scroll).not.toHaveBeenCalled()
  })

  it('typing in an editable control does not interrupt restoration', async () => {
    start()
    await vi.advanceTimersByTimeAsync(30)
    scroll.mockClear()
    const input = document.createElement('input')
    document.body.append(input)
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }))
    await vi.advanceTimersByTimeAsync(800)
    input.remove()
    expect(scroll).toHaveBeenCalled()
  })

  describe('a source enabled after the first attempt', () => {
    it('restores once when retried after the source becomes enabled', async () => {
      let enabled = false
      const options = start({ enabled: () => enabled })
      await vi.advanceTimersByTimeAsync(1700)
      expect(options.load).not.toHaveBeenCalled()
      expect(scroll).not.toHaveBeenCalled()
      enabled = true
      handle?.retry()
      await vi.advanceTimersByTimeAsync(1700)
      expect(options.load).toHaveBeenCalledOnce()
      expect(scroll).toHaveBeenCalledWith({ top: 750, behavior: 'auto' })
      handle?.retry()
      await vi.advanceTimersByTimeAsync(1700)
      expect(options.load).toHaveBeenCalledOnce()
    })

    it('neither clears nor saves the position while the source is disabled', async () => {
      let enabled = false
      const options = start({ enabled: () => enabled })
      await vi.advanceTimersByTimeAsync(1700)
      window.dispatchEvent(new Event('scroll'))
      document.dispatchEvent(new Event('visibilitychange'))
      await vi.advanceTimersByTimeAsync(500)
      wrapper.unmount()
      expect(options.clear).not.toHaveBeenCalled()
      expect(options.save).not.toHaveBeenCalled()
    })

    it('does not move a page the reader scrolled before the source became enabled', async () => {
      let enabled = false
      const options = start({ enabled: () => enabled })
      await vi.advanceTimersByTimeAsync(1700)
      y = 400
      enabled = true
      handle?.retry()
      await vi.advanceTimersByTimeAsync(1700)
      expect(options.load).not.toHaveBeenCalled()
      expect(scroll).not.toHaveBeenCalled()
      window.dispatchEvent(new Event('scroll'))
      await vi.advanceTimersByTimeAsync(500)
      expect(options.save).toHaveBeenCalled()
    })

    it('does not restore after the reader took control with the keyboard or wheel', async () => {
      let enabled = false
      const options = start({ enabled: () => enabled })
      await vi.advanceTimersByTimeAsync(1700)
      window.dispatchEvent(new WheelEvent('wheel'))
      enabled = true
      handle?.retry()
      await vi.advanceTimersByTimeAsync(1700)
      expect(options.load).not.toHaveBeenCalled()
    })

    it('ignores a retry while the first attempt is still running', async () => {
      const options = start()
      handle?.retry()
      await vi.advanceTimersByTimeAsync(1700)
      expect(options.load).toHaveBeenCalledOnce()
    })
  })
})
