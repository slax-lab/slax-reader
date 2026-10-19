import { effectScope } from 'vue'

import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { post, requestMock } = vi.hoisted(() => {
  const post = vi.fn()
  return { post, requestMock: vi.fn(() => ({ post })) }
})

mockNuxtImport('request', () => requestMock)

describe('useBookmarkFork', () => {
  beforeEach(() => {
    post.mockReset()
    requestMock.mockClear()
  })

  afterEach(() => vi.restoreAllMocks())

  it('posts the source UUID with an idempotency key and blocks duplicate submissions', async () => {
    const { useBookmarkFork } = await import('~~/app/composables/useBookmarkFork')
    let resolve!: (value: unknown) => void
    post.mockReturnValueOnce(new Promise(value => { resolve = value }))

    const scope = effectScope()
    const fork = scope.run(() => useBookmarkFork())!
    const first = fork.fork('source-uuid')
    const duplicate = await fork.fork('source-uuid')

    expect(duplicate).toBeNull()
    expect(post).toHaveBeenCalledTimes(1)
    expect(post).toHaveBeenCalledWith(expect.objectContaining({
      body: { bookmark_uid: 'source-uuid' },
      headers: { 'Idempotency-Key': expect.any(String) }
    }))

    resolve({ bookmark_uid: 'destination-uuid', write_mode: 'created', fork_info: null })
    await expect(first).resolves.toMatchObject({ bookmark_uid: 'destination-uuid' })
    expect(fork.loading.value).toBe(false)
    scope.stop()
  })

  it('reuses the failed operation key when the user retries', async () => {
    const { useBookmarkFork } = await import('~~/app/composables/useBookmarkFork')
    post.mockRejectedValueOnce(new Error('temporary failure')).mockResolvedValueOnce({ bookmark_uid: 'destination-uuid', write_mode: 'overwritten', fork_info: null })

    const scope = effectScope()
    const fork = scope.run(() => useBookmarkFork())!
    await expect(fork.fork('source-uuid')).rejects.toThrow('temporary failure')
    await expect(fork.fork('source-uuid')).resolves.toMatchObject({ write_mode: 'overwritten' })

    const firstHeaders = post.mock.calls[0]?.[0]?.headers
    const secondHeaders = post.mock.calls[1]?.[0]?.headers
    expect(firstHeaders).toEqual(secondHeaders)
    expect(fork.error.value).toBeNull()
    scope.stop()
  })
})
