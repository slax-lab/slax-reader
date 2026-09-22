/* eslint-disable camelcase */
import { sortBookmarkTags } from '~~/app/utils/tags'

import type { BookmarkTag } from '@commons/contracts/interface'
import { describe, expect, it } from 'vitest'

const tag = (id: string, source: 'auto' | 'mine', last_used_at: string | null = null): BookmarkTag => ({
  id: id as unknown as number,
  name: id,
  show_name: id,
  source,
  last_used_at
})

describe('utils/tags sortBookmarkTags', () => {
  it('puts mine first, then most recently used, unused last, stable within ties', () => {
    const sorted = sortBookmarkTags([
      tag('a', 'auto', '2026-01-01T00:00:00Z'),
      tag('b', 'mine', null),
      tag('c', 'auto', null),
      tag('d', 'mine', '2026-03-01T00:00:00Z'),
      tag('e', 'auto', '2026-02-01T00:00:00Z'),
      tag('f', 'auto', null)
    ])
    expect(sorted.map(t => t.id)).toEqual(['d', 'b', 'e', 'a', 'c', 'f'])
  })

  it('does not mutate the input', () => {
    const input = [tag('a', 'auto'), tag('b', 'mine')]
    sortBookmarkTags(input)
    expect(input.map(t => t.id)).toEqual(['a', 'b'])
  })
})
