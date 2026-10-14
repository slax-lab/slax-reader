import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// useUserStore is from upstream layer alias '~/stores/user'
// mockNuxtImport cannot intercept layer alias named exports — use vi.mock directly
vi.mock('~/stores/user', () => ({
  useUserStore: vi.fn()
}))

const makeStore = (overrides = {}) => ({
  isSubscriptionExpired: true,
  isJustPaid: false,
  refreshUserInfo: vi.fn(),
  ...overrides
})

// useSubscribeChecking calls onMounted/onUnmounted internally.
// When invoked outside a component setup() context (as in these unit tests),
// Vue emits "onMounted is called when there is no active component instance" warnings.
// These are expected — suppress them to keep test output clean.
let warnSpy: ReturnType<typeof vi.spyOn>

describe('useSubscribeChecking', () => {
  beforeEach(async () => {
    vi.useFakeTimers()
    vi.resetModules()
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { useUserStore } = await import('~/stores/user')
    vi.mocked(useUserStore).mockReturnValue(makeStore() as any)
  })

  afterEach(() => {
    vi.useRealTimers()
    warnSpy.mockRestore()
  })

  it('isSubscribed is false when subscription is expired', async () => {
    const { useUserStore } = await import('~/stores/user')
    vi.mocked(useUserStore).mockReturnValue(makeStore({ isSubscriptionExpired: true }) as any)
    const { useSubscribeChecking } = await import('~~/app/composables/useSubscribeChecking')
    const { isSubscribed } = useSubscribeChecking({ loadingText: 'Loading' })
    expect(isSubscribed.value).toBe(false)
  })

  it('isSubscribed is true when subscription is not expired', async () => {
    const { useUserStore } = await import('~/stores/user')
    vi.mocked(useUserStore).mockReturnValue(makeStore({ isSubscriptionExpired: false }) as any)
    const { useSubscribeChecking } = await import('~~/app/composables/useSubscribeChecking')
    const { isSubscribed } = useSubscribeChecking({ loadingText: 'Loading' })
    expect(isSubscribed.value).toBe(true)
  })

  it('isProcessing is true when expired and just paid', async () => {
    const { useUserStore } = await import('~/stores/user')
    vi.mocked(useUserStore).mockReturnValue(makeStore({ isSubscriptionExpired: true, isJustPaid: true }) as any)
    const { useSubscribeChecking } = await import('~~/app/composables/useSubscribeChecking')
    const { isProcessing } = useSubscribeChecking({ loadingText: 'Loading' })
    expect(isProcessing.value).toBe(true)
  })

  it('isProcessing is false when not expired', async () => {
    const { useUserStore } = await import('~/stores/user')
    vi.mocked(useUserStore).mockReturnValue(makeStore({ isSubscriptionExpired: false, isJustPaid: true }) as any)
    const { useSubscribeChecking } = await import('~~/app/composables/useSubscribeChecking')
    const { isProcessing } = useSubscribeChecking({ loadingText: 'Loading' })
    expect(isProcessing.value).toBe(false)
  })

  it('loadingTitle starts with loadingText', async () => {
    const { useSubscribeChecking } = await import('~~/app/composables/useSubscribeChecking')
    const { loadingTitle } = useSubscribeChecking({ loadingText: 'Processing' })
    expect(loadingTitle.value).toBe('Processing')
  })

  it('refreshUserInfo is called on checkingInterval when isProcessing', async () => {
    const { useUserStore } = await import('~/stores/user')
    const store = makeStore({ isSubscriptionExpired: true, isJustPaid: true })
    vi.mocked(useUserStore).mockReturnValue(store as any)
    const { useSubscribeChecking } = await import('~~/app/composables/useSubscribeChecking')
    useSubscribeChecking({ loadingText: 'Loading' })
    vi.advanceTimersByTime(5001)
    expect(store.refreshUserInfo).toHaveBeenCalled()
  })

  it('loadingTitle animates with ellipses when isProcessing', async () => {
    // Note: vi.resetModules() in beforeEach means we must re-import useUserStore mock
    const { useUserStore } = await import('~/stores/user')
    const store = makeStore({ isSubscriptionExpired: true, isJustPaid: true })
    vi.mocked(useUserStore).mockReturnValue(store as any)
    const { useSubscribeChecking } = await import('~~/app/composables/useSubscribeChecking')
    const { loadingTitle } = useSubscribeChecking({ loadingText: 'Loading' })
    expect(loadingTitle.value).toBe('Loading')
    // advance past one loadingInterval tick (800ms)
    vi.advanceTimersByTime(800)
    expect(loadingTitle.value).toBe('Loading.')
    vi.advanceTimersByTime(800)
    expect(loadingTitle.value).toBe('Loading..')
  })
})
