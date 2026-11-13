import { defineComponent, h } from 'vue'

import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { mountWithApp } from '~~/tests/setup/mount'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  cursorShow: vi.fn(),
  navigateTo: vi.fn()
}))

vi.mock('~/components/CursorToast', () => ({ default: { showToast: mocks.cursorShow } }))
vi.mock('~/composables/useAccountContext', () => ({
  useAccountContext: () => ({
    context: { value: { serverUserId: 7 } },
    sessionOwner: { value: '7' }
  })
}))
vi.mock('~/stores/user', () => ({ useUserStore: () => ({ userInfo: { userId: 7 } }) }))

mockNuxtImport('navigateTo', () => mocks.navigateTo)

import { useFirstStarCollectionCue } from '~~/app/composables/useFirstStarCollectionDiscovery'

const createMemoryStorage = () => {
  const store = new Map<string, string>()
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, String(value)),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size
    }
  }
}

describe('useFirstStarCollectionCue context capture', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.cursorShow.mockReset()
    mocks.navigateTo.mockReset()
    vi.stubGlobal('localStorage', createMemoryStorage())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('keeps i18n usable when the cue runs after setup has finished', async () => {
    let showCue: ReturnType<typeof useFirstStarCollectionCue> | undefined
    const Harness = defineComponent({
      setup() {
        showCue = useFirstStarCollectionCue()
        return () => h('div')
      }
    })
    mountWithApp(Harness)
    await flushPromises()

    // Simulate the starring handlers, which call the cue after awaiting the write.
    await Promise.resolve()
    const result = await showCue!({ isFirstStar: true })

    expect(result).toBe('presented')
    expect(mocks.cursorShow).toHaveBeenCalledWith(
      expect.objectContaining({
        text: 'Star added to collection',
        action: expect.objectContaining({ text: 'View starred', onClick: expect.any(Function) }),
        duration: 4000
      })
    )
    expect(localStorage.getItem('slax:first-star-collection-cue:7')).toBe('1')

    const action = mocks.cursorShow.mock.calls[0]![0].action as { onClick: () => void }
    action.onClick()
    expect(mocks.navigateTo).toHaveBeenCalledExactlyOnceWith('/bookmarks?filter=starred')
  })
})
