import type { PdfDescriptor } from '@slax-reader/contracts/pdf'

export interface PdfTitlePreview {
  type: 'pdf'
  title: string
}

/** The PDF hydration payload carries no document descriptor, notes, or AI output. */
export function pdfTitlePreview(detail: { type?: string; title: string; alias_title?: string; pdf?: PdfDescriptor }): PdfTitlePreview | undefined {
  if (detail.type !== 'pdf' && !detail.pdf) return undefined
  return { type: 'pdf', title: detail.alias_title || detail.title }
}
