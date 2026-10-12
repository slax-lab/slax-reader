import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('useChartHoverSync', () => {
  beforeEach(() => {
    // sharedHoverIndex and clearTimer are module-level — reset module cache so each
    // it gets a fresh instance with sharedHoverIndex === null
    vi.resetModules()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('setIndex updates sharedHoverIndex immediately', async () => {
    const { useChartHoverSync } = await import('~~/app/composables/useChartHoverSync')
    const { sharedHoverIndex, setIndex } = useChartHoverSync()
    setIndex(3)
    expect(sharedHoverIndex.value).toBe(3)
  })

  it('clearIndex sets sharedHoverIndex to null after 40ms', async () => {
    const { useChartHoverSync } = await import('~~/app/composables/useChartHoverSync')
    const { sharedHoverIndex, setIndex, clearIndex } = useChartHoverSync()
    setIndex(2)
    clearIndex()
    expect(sharedHoverIndex.value).toBe(2) // not yet cleared
    vi.advanceTimersByTime(40)
    expect(sharedHoverIndex.value).toBeNull()
  })

  it('setIndex cancels pending clearIndex timer', async () => {
    const { useChartHoverSync } = await import('~~/app/composables/useChartHoverSync')
    const { sharedHoverIndex, setIndex, clearIndex } = useChartHoverSync()
    setIndex(1)
    clearIndex()
    setIndex(5) // should cancel the clear timer
    vi.advanceTimersByTime(40)
    expect(sharedHoverIndex.value).toBe(5) // still 5, not null
  })
})
