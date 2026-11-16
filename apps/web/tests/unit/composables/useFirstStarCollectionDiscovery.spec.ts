import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  cursorShow: vi.fn(),
  navigateTo: vi.fn(),
  t: vi.fn((key: string) => key),
  user: { userInfo: { userId: 7 as number | undefined } as { userId?: number } | null },
  account: {
    context: { value: { serverUserId: null as string | number | null } },
    sessionOwner: { value: null as string | null }
  }
}))

vi.mock('~/components/CursorToast', () => ({ default: { showToast: mocks.cursorShow } }))
vi.mock('~/stores/user', () => ({ useUserStore: () => mocks.user }))
vi.mock('~/composables/useAccountContext', () => ({ useAccountContext: () => mocks.account }))

mockNuxtImport('useI18n', () => () => ({ t: mocks.t }))
mockNuxtImport('navigateTo', () => mocks.navigateTo)

import {
  FIRST_STAR_CUE_DURATION,
  firstStarCueStorageKey,
  isLocallyFirstStar,
  useFirstStarCollectionCue
} from '~~/app/composables/useFirstStarCollectionDiscovery'

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

describe('isLocallyFirstStar', () => {
  it('accepts zero and unknown counts, but rejects known non-zero and already starred bookmarks', () => {
    expect(isLocallyFirstStar(false, 0)).toBe(true)
    expect(isLocallyFirstStar(false, null)).toBe(true)
    expect(isLocallyFirstStar(false, undefined)).toBe(true)
    expect(isLocallyFirstStar(false, 1)).toBe(false)
    expect(isLocallyFirstStar(false, 5)).toBe(false)
    expect(isLocallyFirstStar(true, 0)).toBe(false)
    expect(isLocallyFirstStar(true, undefined)).toBe(false)
  })
})

const createCue = () => useFirstStarCollectionCue()

describe('useFirstStarCollectionCue', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.cursorShow.mockReset()
    mocks.navigateTo.mockReset()
    mocks.t.mockReset().mockImplementation((key: string) => key)
    mocks.user.userInfo = { userId: 7 }
    mocks.account.context.value.serverUserId = null
    mocks.account.sessionOwner.value = null
    vi.stubGlobal('localStorage', createMemoryStorage())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('uses the per-account storage key', () => {
    expect(firstStarCueStorageKey(7)).toBe('slax:first-star-collection-cue:7')
    expect(firstStarCueStorageKey('u-1')).toBe('slax:first-star-collection-cue:u-1')
  })

  it('does nothing when this is not a first-star candidate', async () => {
    const result = await createCue()({ isFirstStar: false })

    expect(result).toBe('not-applicable')
    expect(mocks.cursorShow).not.toHaveBeenCalled()
    expect(mocks.navigateTo).not.toHaveBeenCalled()
  })

  it('presents immediately when the local count is unknown', async () => {
    const result = await createCue()({ isFirstStar: isLocallyFirstStar(false, undefined) })

    expect(result).toBe('presented')
    expect(mocks.cursorShow).toHaveBeenCalledTimes(1)
  })

  it('does not present when the local count is known non-zero', async () => {
    const result = await createCue()({ isFirstStar: isLocallyFirstStar(false, 3) })

    expect(result).toBe('not-applicable')
    expect(mocks.cursorShow).not.toHaveBeenCalled()
  })

  it('presents an action-capable cue that opens the starred page', async () => {
    const anchor = document.createElement('button')
    const baseContainer = document.createElement('div')

    const result = await createCue()({ isFirstStar: true, anchor, baseContainer })

    expect(result).toBe('presented')
    expect(mocks.cursorShow).toHaveBeenCalledWith({
      text: 'page.bookmarks_index.starred_share.first_star_cue',
      action: {
        text: 'page.bookmarks_index.starred_share.view_starred',
        onClick: expect.any(Function)
      },
      trackDom: anchor,
      baseContainer,
      duration: FIRST_STAR_CUE_DURATION
    })
    expect(localStorage.getItem('slax:first-star-collection-cue:7')).toBe('1')
    expect(mocks.navigateTo).not.toHaveBeenCalled()

    const action = mocks.cursorShow.mock.calls[0]![0].action as { onClick: () => void }
    action.onClick()
    expect(mocks.navigateTo).toHaveBeenCalledExactlyOnceWith('/bookmarks?filter=starred')
    expect(mocks.navigateTo).not.toHaveBeenCalledWith(expect.stringContaining('/c/'), expect.anything())
  })

  it('does not present again for the same account in the same browser', async () => {
    localStorage.setItem('slax:first-star-collection-cue:7', '1')

    const result = await createCue()({ isFirstStar: true })

    expect(result).toBe('not-applicable')
    expect(mocks.cursorShow).not.toHaveBeenCalled()
  })

  it('keys the flag by account so switching accounts cannot suppress another cue', async () => {
    localStorage.setItem('slax:first-star-collection-cue:7', '1')
    mocks.user.userInfo = { userId: 8 }

    const result = await createCue()({ isFirstStar: true })

    expect(result).toBe('presented')
    expect(mocks.cursorShow).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem('slax:first-star-collection-cue:8')).toBe('1')
  })

  it('returns not-applicable without writing the flag when the cue cannot be presented', async () => {
    mocks.cursorShow.mockImplementation(() => {
      throw new Error('presentation failed')
    })

    const result = await createCue()({ isFirstStar: true })

    expect(result).toBe('not-applicable')
    expect(localStorage.getItem('slax:first-star-collection-cue:7')).toBeNull()
  })

  it('does not change the result when the flag write fails after presentation', async () => {
    vi.stubGlobal('localStorage', {
      ...createMemoryStorage(),
      setItem: () => {
        throw new Error('quota')
      }
    })

    const result = await createCue()({ isFirstStar: true })

    expect(result).toBe('presented')
    expect(mocks.cursorShow).toHaveBeenCalledTimes(1)
  })

  it('uses the signed-in account when callers do not pass a userId', async () => {
    mocks.user.userInfo = null
    mocks.account.context.value.serverUserId = 'server-9'

    const result = await createCue()({ isFirstStar: true })

    expect(result).toBe('presented')
    expect(localStorage.getItem('slax:first-star-collection-cue:server-9')).toBe('1')
  })

  it('skips when no account identity is available', async () => {
    mocks.user.userInfo = null
    mocks.account.context.value.serverUserId = null
    mocks.account.sessionOwner.value = null

    const result = await createCue()({ isFirstStar: true })

    expect(result).toBe('not-applicable')
    expect(mocks.cursorShow).not.toHaveBeenCalled()
  })
})
