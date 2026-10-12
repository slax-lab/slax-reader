// useBookmarkFilter：多标签筛选状态从 URL 读、写回 URL
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockUseRoute, mockNavigateTo, routeState } = vi.hoisted(() => {
  const routeState: { query: Record<string, string> } = { query: {} }
  return {
    routeState,
    mockUseRoute: vi.fn(() => routeState),
    mockNavigateTo: vi.fn(() => Promise.resolve())
  }
})

mockNuxtImport('useRoute', () => mockUseRoute)
mockNuxtImport('navigateTo', () => mockNavigateTo)

import { parseTopicIds, useBookmarkFilter } from '~/composables/bookmark/useBookmarkFilter'

describe('parseTopicIds', () => {
  it('splits a comma list, trims, dedupes and drops the legacy 0 placeholder', () => {
    expect(parseTopicIds('a, b,a,,0')).toEqual(['a', 'b'])
    expect(parseTopicIds(undefined)).toEqual([])
    expect(parseTopicIds(['x', 'y'])).toEqual(['x', 'y'])
  })

  it('keeps a local-first uuid intact instead of turning it into NaN', () => {
    expect(parseTopicIds('3f2a1c9e-1111-4222-8333-444455556666')).toEqual(['3f2a1c9e-1111-4222-8333-444455556666'])
  })
})

describe('composables/bookmark/useBookmarkFilter', () => {
  beforeEach(() => {
    routeState.query = {}
    mockNavigateTo.mockClear()
  })

  it('reads topic_ids from the URL', () => {
    routeState.query = { filter: 'topics', topic_ids: 'a,b' }
    const { filterTopicIds, filterStatus } = useBookmarkFilter()
    expect(filterStatus.value).toBe('topics')
    expect(filterTopicIds.value).toEqual(['a', 'b'])
  })

  it('still accepts the old single topic_id', () => {
    routeState.query = { filter: 'topics', topic_id: 'x' }
    expect(useBookmarkFilter().filterTopicIds.value).toEqual(['x'])
  })

  it('applyTopics writes the whole list back with replace', async () => {
    const { filterTopicIds, filterTopicName, applyTopics } = useBookmarkFilter()
    await applyTopics(['a', 'b', 'a'], 'AI 编程')
    expect(filterTopicIds.value).toEqual(['a', 'b'])
    expect(filterTopicName.value).toBe('AI 编程')
    expect(mockNavigateTo).toHaveBeenCalledWith('/bookmarks?filter=topics&topic_ids=a%2Cb', { replace: true })
  })

  it('applyTopics with an empty list goes back to the tag list', async () => {
    const { filterTopicIds, filterTopicName, applyTopics } = useBookmarkFilter()
    await applyTopics([], 'ignored')
    expect(filterTopicIds.value).toEqual([])
    expect(filterTopicName.value).toBe('')
    expect(mockNavigateTo).toHaveBeenCalledWith('/bookmarks?filter=topics', { replace: true })
  })

  it('applyTab clears the selection', async () => {
    routeState.query = { filter: 'topics', topic_ids: 'a' }
    const { filterTopicIds, applyTab } = useBookmarkFilter()
    await applyTab('inbox')
    expect(filterTopicIds.value).toEqual([])
  })
})
