import { describe, expect, it } from 'vitest'
import { groupVocabulary, normalizeTagName, pickTagsForBookmark } from '@/utils/tags'

describe('normalizeTagName', () => {
  it('trims and collapses whitespace', () => {
    expect(normalizeTagName('  AI  编程 ')).toBe('AI 编程')
  })

  it('folds full-width ASCII and ideographic space to half-width', () => {
    expect(normalizeTagName('ＡＩ　coding')).toBe('AI coding')
  })

  it('returns empty string for empty or blank input', () => {
    expect(normalizeTagName('')).toBe('')
    expect(normalizeTagName('   ')).toBe('')
  })
})

describe('groupVocabulary', () => {
  it('splits by source, keeping order inside each group', () => {
    const grouped = groupVocabulary([
      { name: 'a', source: 'auto' },
      { name: 'm1', source: 'mine' },
      { name: 'b', source: 'auto' },
      { name: 'm2', source: 'mine' },
      { name: 'c' }
    ])
    expect(grouped).toEqual({ mine: ['m1', 'm2'], auto: ['a', 'b', 'c'] })
  })
})

describe('pickTagsForBookmark', () => {
  const vocabulary = [
    { id: 1, name: '创业', source: 'mine' as const },
    { id: 2, name: '人工智能', source: 'auto' as const },
    { id: 3, name: '技术', source: 'auto' as const },
    { id: 4, name: '育儿', source: 'mine' as const }
  ]

  it('drops candidates outside the vocabulary', () => {
    expect(pickTagsForBookmark(['无关', '技术'], vocabulary).map(t => t.name)).toEqual(['技术'])
  })

  it('puts mine first, keeps AI order within each group, caps at 3', () => {
    const picked = pickTagsForBookmark(['技术', '创业', '人工智能', '育儿'], vocabulary)
    expect(picked.map(t => t.name)).toEqual(['创业', '育儿', '技术'])
  })

  it('dedupes repeated candidates', () => {
    expect(pickTagsForBookmark(['技术', '技术', '创业'], vocabulary).map(t => t.name)).toEqual(['创业', '技术'])
  })

  it('returns vocabulary entries, not bare names', () => {
    expect(pickTagsForBookmark(['创业'], vocabulary)[0]).toEqual({ id: 1, name: '创业', source: 'mine' })
  })

  it('honours a custom limit', () => {
    expect(pickTagsForBookmark(['技术', '创业', '人工智能', '育儿'], vocabulary, 2).map(t => t.name)).toEqual(['创业', '育儿'])
  })
})
