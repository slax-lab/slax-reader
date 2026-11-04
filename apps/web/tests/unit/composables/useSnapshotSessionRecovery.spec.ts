import { defineComponent, h, nextTick, ref } from 'vue'

import { tokenFingerprint } from '~/utils/accountContext'

import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { mount } from '@vue/test-utils'
import { useSnapshotSessionRecovery, useSnapshotSessionRecoveryPending } from '~/composables/useSnapshotSessionRecovery'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const session = vi.hoisted(() => ({ token: 'expired-fixture' as string | undefined, ready: [] as Array<() => void>, clear: vi.fn() }))
mockNuxtImport('getUserToken', () => () => session.token)
mockNuxtImport('useAuth', () => () => ({ clearAuth: session.clear }))
mockNuxtImport('onNuxtReady', () => (callback: () => void) => { session.ready.push(callback) })

const wrappers: Array<ReturnType<typeof mount>> = []
beforeEach(() => {
  session.token = 'expired-fixture'
  session.ready = []
  session.clear.mockReset().mockImplementation(async () => { session.token = undefined })
  window.location.href = 'http://localhost/b/snapshot?highlight=mark#paragraph'
})
afterEach(() => {
  wrappers.splice(0).forEach(wrapper => wrapper.unmount())
  vi.restoreAllMocks()
})

function setup(status = 401, rejectedVersion: string | null = tokenFingerprint(session.token)) {
  const error = ref<{ statusCode: number } | null>({ statusCode: status })
  const version = ref(rejectedVersion)
  let recovery: ReturnType<typeof useSnapshotSessionRecovery>
  const wrapper = mount(defineComponent({
    setup() {
      recovery = useSnapshotSessionRecovery(error, version, '/b/snapshot')
      const sharedPending = useSnapshotSessionRecoveryPending()
      return () => h('p', { 'data-recovery-pending': !!sharedPending.value }, recovery.pending.value ? 'Loading' : 'Error')
    }
  }))
  wrappers.push(wrapper)
  const ready = async () => {
    session.ready.forEach(callback => callback())
    await nextTick()
    await Promise.resolve()
    await nextTick()
  }
  return { error, version, wrapper, ready }
}

describe('snapshot cookie-session recovery', () => {
  it('hydrates a recoverable error and awaits cleanup before reloading the current URL once', async () => {
    const reload = vi.spyOn(window.location, 'reload').mockImplementation(() => {})
    let finish!: () => void
    session.clear.mockImplementation(() => new Promise<void>(resolve => { finish = resolve }))
    const page = setup()
    expect(page.wrapper.text()).toBe('Loading')
    expect(page.wrapper.attributes('data-recovery-pending')).toBe('true')
    expect(session.clear).not.toHaveBeenCalled()
    await page.ready()
    expect(session.clear).toHaveBeenCalledOnce()
    expect(reload).not.toHaveBeenCalled()
    await page.ready()
    session.token = undefined
    finish()
    await nextTick()
    expect(reload).toHaveBeenCalledOnce()
    expect(window.location.href).toBe('http://localhost/b/snapshot?highlight=mark#paragraph')
    await page.ready()
    expect(session.clear).toHaveBeenCalledOnce()
    expect(reload).toHaveBeenCalledOnce()
  })

  it('recovers a 401 arriving after client navigation is ready', async () => {
    const reload = vi.spyOn(window.location, 'reload').mockImplementation(() => {})
    const page = setup(200, null)
    await page.ready()
    expect(reload).not.toHaveBeenCalled()
    page.version.value = tokenFingerprint(session.token)
    page.error.value = { statusCode: 401 }
    await nextTick()
    await nextTick()
    expect(session.token).toBeUndefined()
    expect(reload).toHaveBeenCalledOnce()
  })

  it.each([403, 404, 500, 503])('does not clear or reload for %s', async status => {
    const reload = vi.spyOn(window.location, 'reload').mockImplementation(() => {})
    const page = setup(status)
    await page.ready()
    expect(page.wrapper.text()).toBe('Error')
    expect(page.wrapper.attributes('data-recovery-pending')).toBe('false')
    expect(session.clear).not.toHaveBeenCalled()
    expect(reload).not.toHaveBeenCalled()
  })

  it('does not recover an anonymous or explicit-header 401 without a rejected cookie version', async () => {
    const reload = vi.spyOn(window.location, 'reload').mockImplementation(() => {})
    const page = setup(401, null)
    await page.ready()
    expect(page.wrapper.text()).toBe('Error')
    expect(session.clear).not.toHaveBeenCalled()
    expect(reload).not.toHaveBeenCalled()
  })

  it('does not clear a replacement session when an old request returns 401', async () => {
    const reload = vi.spyOn(window.location, 'reload').mockImplementation(() => {})
    const page = setup()
    session.token = 'replacement-fixture'
    await page.ready()
    expect(session.token).toBe('replacement-fixture')
    expect(session.clear).not.toHaveBeenCalled()
    expect(reload).not.toHaveBeenCalled()
  })

  it.each(['cookie-remains', 'cleanup-fails'])('stops without reloading when %s', async mode => {
    const reload = vi.spyOn(window.location, 'reload').mockImplementation(() => {})
    session.clear.mockImplementation(async () => { if (mode === 'cleanup-fails') throw new Error('cleanup unavailable') })
    const page = setup()
    await page.ready()
    await page.ready()
    expect(page.wrapper.text()).toBe('Error')
    expect(session.clear).toHaveBeenCalledOnce()
    expect(reload).not.toHaveBeenCalled()
  })

  it('does not reload a page that unmounted during cleanup', async () => {
    const reload = vi.spyOn(window.location, 'reload').mockImplementation(() => {})
    let finish!: () => void
    session.clear.mockImplementation(() => new Promise<void>(resolve => { finish = resolve }))
    const page = setup()
    await page.ready()
    page.wrapper.unmount()
    session.token = undefined
    finish()
    await nextTick()
    expect(reload).not.toHaveBeenCalled()
  })

  it('does not start another recovery after the cookie is gone on the next document', async () => {
    session.token = undefined
    const reload = vi.spyOn(window.location, 'reload').mockImplementation(() => {})
    const page = setup(401)
    await page.ready()
    expect(page.wrapper.text()).toBe('Error')
    expect(session.clear).not.toHaveBeenCalled()
    expect(reload).not.toHaveBeenCalled()
  })

  it('does not release a new recovery when the previous healthy page unmounts', async () => {
    const previous = setup(200, null)
    const next = setup()
    previous.wrapper.unmount()
    await nextTick()
    expect(next.wrapper.attributes('data-recovery-pending')).toBe('true')
    expect(next.wrapper.text()).toBe('Loading')
  })
})
