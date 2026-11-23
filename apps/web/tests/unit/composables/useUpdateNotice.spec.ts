import { useUpdateNotice } from '~~/app/composables/useUpdateNotice'
import { beforeEach, describe, expect, it } from 'vitest'

beforeEach(() => {
  useUpdateNotice().state.value = { kind: null, buildId: null, dismissedKey: null }
})

describe('useUpdateNotice', () => {
  it('is hidden until something is reported', () => {
    expect(useUpdateNotice().visible.value).toBe(false)
  })

  it('shows a newer build and never downgrades a broken load to it', () => {
    const notice = useUpdateNotice()
    notice.report('available', 'build-b')
    expect(notice.visible.value).toBe(true)
    expect(notice.state.value).toMatchObject({ kind: 'available', buildId: 'build-b' })
    notice.report('outdated')
    notice.report('available', 'build-c')
    expect(notice.state.value.kind).toBe('outdated')
  })

  it('keeps a closed notice hidden for the same build and shows it for a newer one', () => {
    const notice = useUpdateNotice()
    notice.report('available', 'build-b')
    notice.dismiss()
    expect(notice.visible.value).toBe(false)
    notice.report('available', 'build-b')
    expect(notice.visible.value).toBe(false)
    notice.report('available', 'build-c')
    expect(notice.visible.value).toBe(true)
  })

  it('shows a closed notice again when a load then breaks, and keeps the outdated one closed', () => {
    const notice = useUpdateNotice()
    notice.report('available', 'build-b')
    notice.dismiss()
    notice.report('outdated')
    expect(notice.visible.value).toBe(true)
    notice.dismiss()
    notice.report('outdated')
    expect(notice.visible.value).toBe(false)
  })

  it('a worker-reported update without a build id keeps the id it already knows', () => {
    const notice = useUpdateNotice()
    notice.report('available', 'build-b')
    notice.dismiss()
    notice.report('available')
    expect(notice.visible.value).toBe(false)
  })

  it('shares one state across callers and ignores dismiss with nothing shown', () => {
    useUpdateNotice().dismiss()
    expect(useUpdateNotice().state.value.dismissedKey).toBeNull()
    useUpdateNotice().report('outdated')
    expect(useUpdateNotice().visible.value).toBe(true)
  })
})
