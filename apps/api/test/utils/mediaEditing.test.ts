/**
 * Cue coverage of an edited chunk, shared by Podcast and YouTube editing.
 * 来源: src/utils/mediaEditing.ts
 */
import { describe, expect, test } from 'vitest'
import { completeCueCoverage } from '@/utils/mediaEditing'
import type { ArticleSection } from '@/utils/youtubeArticle'

const doc = (...paragraphs: string[][]): ArticleSection[] => [
  { heading: 'Topic', start_ms: 0, end_ms: 0, paragraphs: paragraphs.map(ids => ({ speaker: null, text: 'Text', source_cue_ids: ids })) }
]
const ids = ['c1', 'c2', 'c3', 'c4']

describe('completeCueCoverage', () => {
  test('each cue once in source order passes', () => {
    expect(completeCueCoverage(doc(['c1', 'c2'], ['c3', 'c4']), ids)).toBe(true)
  })

  test('a cue split across two adjacent paragraphs passes', () => {
    // The Chinese edits of the reported episode split cues like this; no cue was missing
    expect(completeCueCoverage(doc(['c1', 'c2'], ['c2', 'c3'], ['c3', 'c4']), ids)).toBe(true)
  })

  test('a cue repeated inside one paragraph passes', () => {
    expect(completeCueCoverage(doc(['c1', 'c1', 'c2', 'c3', 'c4']), ids)).toBe(true)
  })

  test('a missing cue fails', () => {
    expect(completeCueCoverage(doc(['c1', 'c2'], ['c4']), ids)).toBe(false)
    expect(completeCueCoverage(doc(['c1', 'c2', 'c3']), ids)).toBe(false)
    expect(completeCueCoverage(doc(['c2', 'c3', 'c4']), ids)).toBe(false)
  })

  test('a cue that comes back after a later cue fails', () => {
    expect(completeCueCoverage(doc(['c1', 'c2', 'c3'], ['c2', 'c4']), ids)).toBe(false)
  })

  test('an invented cue fails', () => {
    expect(completeCueCoverage(doc(['c1', 'c2', 'c3', 'c4', 'c9']), ids)).toBe(false)
  })

  test('duplicate supplied ids fail', () => {
    expect(completeCueCoverage(doc(['c1', 'c1']), ['c1', 'c1'])).toBe(false)
  })

  test('no supplied cue needs no reference', () => {
    expect(completeCueCoverage(doc(), [])).toBe(true)
    expect(completeCueCoverage(doc(['c1']), [])).toBe(false)
  })
})
