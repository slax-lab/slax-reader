import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGet, mockRequest, mockHaveRequestToken, accountState } = vi.hoisted(() => {
  const get = vi.fn()
  return {
    mockGet: get,
    mockRequest: vi.fn(() => ({ get })),
    mockHaveRequestToken: vi.fn(() => true),
    accountState: {
      accountKey: null as { value: string } | null,
      generation: null as { value: number } | null
    }
  }
})

vi.mock('~/composables/useAccountContext', async () => {
  const { computed, ref } = await import('vue')
  const accountKey = ref('account-a')
  const generation = ref(0)
  accountState.accountKey = accountKey
  accountState.generation = generation
  return {
    useAccountContext: () => ({
      context: computed(() => ({ accountKey: accountKey.value, generation: generation.value }))
    })
  }
})

mockNuxtImport('request', () => mockRequest)
mockNuxtImport('haveRequestToken', () => mockHaveRequestToken)

const accountA = {
  show_name: 'Account A',
  avatar: '',
  description: '',
  starred_count: 0,
  subscriber_count: 0,
  collection_code: 'account-a-code',
  status: 1,
  show_marks: true,
  allow_marks: true,
  show_profile: true
}

let share: ReturnType<typeof import('~~/app/composables/useShareCollectInfo')['useShareCollectInfo']>

beforeAll(async () => {
  // One module instance per file: the account watcher is app-wide and must not multiply per test.
  share = (await import('~~/app/composables/useShareCollectInfo')).useShareCollectInfo()
})

beforeEach(() => {
  vi.clearAllMocks()
  mockGet.mockReset()
  mockHaveRequestToken.mockReturnValue(true)
})

describe('composables/useShareCollectInfo', () => {
  it('keeps the cached value for SWR display but returns null when refresh fails', async () => {
    mockGet.mockResolvedValueOnce(accountA)

    const first = await share.refresh()
    expect(first?.collection_code).toBe('account-a-code')
    expect(share.info.value?.collection_code).toBe('account-a-code')

    mockGet.mockRejectedValueOnce(new Error('network'))
    const second = await share.refresh()

    expect(second).toBeNull()
    // Display cache may stay warm; callers that need the current account's address must use `second`.
    expect(share.info.value?.collection_code).toBe('account-a-code')
  })

  it('returns null from refresh when no request token is available', async () => {
    mockHaveRequestToken.mockReturnValue(false)

    const result = await share.refresh()

    expect(result).toBeNull()
    expect(mockGet).not.toHaveBeenCalled()
  })

  it('clears the old account immediately and ignores its late response', async () => {
    const pending: Array<(value: unknown) => void> = []
    mockGet.mockImplementation(() => new Promise(resolve => pending.push(resolve)))

    const oldRequest = share.refresh()
    expect(pending).toHaveLength(1)

    // Account switch: the watcher clears the cache synchronously; the refresh is coalesced next tick.
    accountState.accountKey!.value = 'account-b'
    accountState.generation!.value = 1
    expect(pending).toHaveLength(1)
    expect(share.info.value).toBeNull()
    expect(share.loaded.value).toBe(false)

    await Promise.resolve()
    expect(pending).toHaveLength(2)

    pending[0]!(accountA)
    await oldRequest
    expect(share.info.value).toBeNull()
    expect(share.loaded.value).toBe(false)

    pending[1]!({ ...accountA, collection_code: 'account-b-code' })
    await flushPromises()

    expect(share.info.value?.collection_code).toBe('account-b-code')
    expect(share.loaded.value).toBe(true)
  })

  it('does not clear or refetch when generation changes for the same account key', async () => {
    mockGet.mockResolvedValueOnce({ ...accountA, collection_code: 'same-account-code' })
    await share.refresh()
    expect(share.info.value?.collection_code).toBe('same-account-code')
    expect(mockGet).toHaveBeenCalledTimes(1)

    accountState.generation!.value += 1
    accountState.generation!.value += 1
    await Promise.resolve()

    expect(share.info.value?.collection_code).toBe('same-account-code')
    expect(share.loaded.value).toBe(true)
    expect(mockGet).toHaveBeenCalledTimes(1)
  })

  it('coalesces an account-key burst into one refresh and ignores the old response', async () => {
    const pending: Array<(value: unknown) => void> = []
    mockGet.mockImplementation(() => new Promise(resolve => pending.push(resolve)))
    const oldRequest = share.refresh()
    expect(pending).toHaveLength(1)

    accountState.accountKey!.value = 'account-c'
    accountState.accountKey!.value = 'account-d'
    accountState.accountKey!.value = 'account-e'

    // The cache clears immediately, but the burst still has only one queued refresh.
    expect(share.info.value).toBeNull()
    expect(share.loaded.value).toBe(false)
    expect(pending).toHaveLength(1)

    await Promise.resolve()
    expect(pending).toHaveLength(2)

    pending[0]!(accountA)
    await oldRequest
    expect(share.info.value).toBeNull()
    expect(share.loaded.value).toBe(false)

    pending[1]!({ ...accountA, collection_code: 'burst-code' })
    await flushPromises()

    expect(share.info.value?.collection_code).toBe('burst-code')
    expect(share.loaded.value).toBe(true)
  })

  it('does not refetch from ensure once loaded', async () => {
    mockGet.mockResolvedValueOnce({ ...accountA, collection_code: 'loaded-code' })
    await share.refresh()
    expect(share.loaded.value).toBe(true)
    expect(mockGet).toHaveBeenCalledTimes(1)

    share.ensure()
    share.ensure()
    await Promise.resolve()

    expect(mockGet).toHaveBeenCalledTimes(1)
  })

  it('reuses an in-flight request for ensure and refresh', async () => {
    const pending: Array<(value: unknown) => void> = []
    mockGet.mockImplementation(() => new Promise(resolve => pending.push(resolve)))

    accountState.accountKey!.value = 'account-f'
    expect(share.loaded.value).toBe(false)

    share.ensure()
    share.ensure()
    const refreshed = share.refresh()
    expect(pending).toHaveLength(1)

    await Promise.resolve()
    expect(pending).toHaveLength(1)

    pending[0]!({ ...accountA, collection_code: 'inflight-code' })
    await refreshed
    expect(share.info.value?.collection_code).toBe('inflight-code')
    expect(share.loaded.value).toBe(true)
  })
})
