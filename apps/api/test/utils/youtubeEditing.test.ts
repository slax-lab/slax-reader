/**
 * Transcript editing helpers: the context passed between chunks and the shared length band.
 * 来源: src/utils/youtubeEditing.ts
 */
import { describe, expect, test } from 'vitest'
import { EDITED_LENGTH_BOUNDS, editingContext, EDITING_CONTEXT_CHARS } from '@/utils/youtubeEditing'
import type { ArticleSection } from '@/utils/youtubeArticle'

const paragraph = (i: number, size = 400) => ({ speaker: null, text: `Paragraph ${i} ${'word '.repeat(size / 5)}`.trim(), source_cue_ids: [`c${String(i).padStart(4, '0')}`] })

describe('editingContext', () => {
  test('a short last section is passed whole', () => {
    const sections: ArticleSection[] = [
      { heading: 'Earlier', start_ms: 0, end_ms: 1, paragraphs: [paragraph(0)] },
      { heading: 'Last', start_ms: 1, end_ms: 2, paragraphs: [paragraph(1), paragraph(2)] }
    ]
    expect(JSON.parse(editingContext(sections))).toEqual([sections[1]])
  })

  test('a long last section keeps only its trailing paragraphs, as valid JSON within the budget', () => {
    const paragraphs = Array.from({ length: 40 }, (_, i) => paragraph(i))
    const sections: ArticleSection[] = [{ heading: 'Last', start_ms: 0, end_ms: 1, paragraphs }]
    const context = editingContext(sections)
    expect(context.length).toBeLessThanOrEqual(EDITING_CONTEXT_CHARS)
    const kept = JSON.parse(context) as ArticleSection[]
    expect(kept).toHaveLength(1)
    expect(kept[0].heading).toBe('Last')
    expect(kept[0].paragraphs.length).toBeGreaterThan(1)
    expect(kept[0].paragraphs).toEqual(paragraphs.slice(-kept[0].paragraphs.length))
  })

  test('no sections gives an empty list', () => {
    expect(editingContext([])).toBe('[]')
  })
})

describe('edited length band', () => {
  test('the chunk band is the article band of a same-language edit', () => {
    expect(EDITED_LENGTH_BOUNDS).toEqual([0.72, 1.15])
  })
})
