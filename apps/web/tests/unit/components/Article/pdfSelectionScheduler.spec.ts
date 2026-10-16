import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSelectionScheduler } from '~~/app/components/Article/Pdf/selectionScheduler'

const event = (type: string) => ({ type }) as Event

describe('createSelectionScheduler', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('captures once after the debounce when no pointer is pressed (keyboard, touch handles)', () => {
    const run = vi.fn()
    const scheduler = createSelectionScheduler(run, 180)
    scheduler.queue(); scheduler.queue()
    vi.advanceTimersByTime(179)
    expect(run).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('restarts the debounce when the selection keeps changing', () => {
    const run = vi.fn()
    const scheduler = createSelectionScheduler(run, 180)
    scheduler.queue()
    vi.advanceTimersByTime(150)
    scheduler.queue()
    vi.advanceTimersByTime(150)
    expect(run).not.toHaveBeenCalled()
    vi.advanceTimersByTime(30)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('does not capture while the pointer is held, even when the drag pauses longer than the debounce', () => {
    const run = vi.fn()
    const scheduler = createSelectionScheduler(run, 180)
    scheduler.press()
    scheduler.queue()
    vi.advanceTimersByTime(500)
    scheduler.queue()
    vi.advanceTimersByTime(500)
    expect(run).not.toHaveBeenCalled()
  })

  it('captures one debounce after release, anchored to the release event', () => {
    const run = vi.fn()
    const scheduler = createSelectionScheduler(run, 180)
    const up = event('pointerup')
    scheduler.press()
    scheduler.queue()
    scheduler.release(up)
    vi.advanceTimersByTime(179)
    expect(run).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(run).toHaveBeenCalledOnce()
    expect(run).toHaveBeenCalledWith(up)
  })

  it('cancels a capture already pending when a new press begins', () => {
    const run = vi.fn()
    const scheduler = createSelectionScheduler(run, 180)
    scheduler.queue()
    vi.advanceTimersByTime(100)
    scheduler.press()
    vi.advanceTimersByTime(1000)
    expect(run).not.toHaveBeenCalled()
  })

  it('still captures after a cancelled press so the selection is not lost', () => {
    const run = vi.fn()
    const scheduler = createSelectionScheduler(run, 180)
    scheduler.press()
    scheduler.release()
    vi.advanceTimersByTime(180)
    expect(run).toHaveBeenCalledOnce()
    expect(run).toHaveBeenCalledWith(undefined)
  })

  it('does not reuse a stale event for a later keyboard selection', () => {
    const run = vi.fn()
    const scheduler = createSelectionScheduler(run, 180)
    scheduler.press()
    scheduler.release(event('pointerup'))
    vi.advanceTimersByTime(180)
    scheduler.queue()
    vi.advanceTimersByTime(180)
    expect(run).toHaveBeenNthCalledWith(2, undefined)
  })

  it('dispose cancels pending work and releases a held pointer', () => {
    const run = vi.fn()
    const scheduler = createSelectionScheduler(run, 180)
    scheduler.queue()
    scheduler.dispose()
    vi.advanceTimersByTime(1000)
    expect(run).not.toHaveBeenCalled()
  })
})
