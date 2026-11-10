import { loadModal } from '~~/app/utils/deferredModal'

import { useNuxtApp } from '#app'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { toast } = vi.hoisted(() => ({ toast: vi.fn() }))
vi.mock('~/components/Toast', () => ({ default: { showToast: toast }, ToastType: { Error: 'error' } }))

beforeEach(() => vi.clearAllMocks())

describe('loadModal', () => {
  it('loads one implementation and opens it with Nuxt context', async () => {
    const runWithContext = vi.spyOn(useNuxtApp(), 'runWithContext')
    const component = { name: 'Modal' }
    const load = vi.fn().mockResolvedValue({ default: component })
    const open = vi.fn()
    await loadModal('normal', load, open)
    expect(load).toHaveBeenCalledOnce()
    expect(open).toHaveBeenCalledExactlyOnceWith(component)
    expect(runWithContext).toHaveBeenCalledOnce()
    expect(toast).not.toHaveBeenCalled()
  })

  it('coalesces repeated activation while loading and preserves the first action', async () => {
    let resolve!: (value: { default: { name: string } }) => void
    const load = vi.fn(() => new Promise<{ default: { name: string } }>(yes => { resolve = yes }))
    const first = vi.fn()
    const second = vi.fn()
    const task = loadModal('pending', load, first)
    expect(loadModal('pending', load, second)).toBe(task)
    expect(load).toHaveBeenCalledOnce()
    resolve({ default: { name: 'Modal' } })
    await task
    expect(first).toHaveBeenCalledOnce()
    expect(second).not.toHaveBeenCalled()
  })

  it('reports failed imports without mounting and permits a subsequent retry', async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ default: { name: 'Modal' } })
    const open = vi.fn()
    await loadModal('retry', load, open)
    expect(open).not.toHaveBeenCalled()
    expect(toast).toHaveBeenCalledExactlyOnceWith({ text: expect.any(String), type: 'error' })
    await loadModal('retry', load, open)
    expect(load).toHaveBeenCalledTimes(2)
    expect(open).toHaveBeenCalledOnce()
  })

  it('does not serialize unrelated modal actions', async () => {
    let resolve!: (value: { default: { name: string } }) => void
    const slow = () => new Promise<{ default: { name: string } }>(yes => { resolve = yes })
    const task = loadModal('slow', slow, vi.fn())
    const open = vi.fn()
    await loadModal('fast', async () => ({ default: { name: 'Fast' } }), open)
    expect(open).toHaveBeenCalledOnce()
    resolve({ default: { name: 'Slow' } })
    await task
  })
})
