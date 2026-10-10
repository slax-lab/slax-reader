// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { pdfTitlePreview } from '../../../../app/utils/pdfPreview'

describe('PDF SSR title payload', () => {
  it('strips descriptor, notes, AI output, and document content from a PDF', () => {
    const metadata = { type: 'pdf', title: 'Document', alias_title: 'My title', pdf: { url: '/private/pdf' }, outline: 'AI result', marks: [{ comment: 'Private note' }], content_key: 'pdf/body/private.pdf' }
    expect(pdfTitlePreview(metadata as Parameters<typeof pdfTitlePreview>[0])).toEqual({ type: 'pdf', title: 'My title' })
  })
  it('recognizes descriptor-based PDF details and preserves the document title', () => {
    expect(pdfTitlePreview({ title: 'Shared PDF', pdf: {} as never })).toEqual({ type: 'pdf', title: 'Shared PDF' })
  })
  it.each(['article', 'shortcut', undefined])('does not replace an existing %s SSR response', type => {
    expect(pdfTitlePreview({ type, title: 'Article' })).toBeUndefined()
  })
})
