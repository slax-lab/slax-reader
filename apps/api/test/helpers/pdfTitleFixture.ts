import { pdfFixture, type PdfTextRun } from './pdfFixture'

// Regression layout from https://arxiv.org/pdf/2406.00845; body text is synthetic.
export const visiblePdfTitle = 'Quark orbital angular momentum in the proton from a twist-3 generalized parton distribution'
export const titlePage: PdfTextRun[] = [
  { text: 'arXiv:2406.00845v1 [hep-lat] 2 Jun 2024', size: 20, x: 32, y: 247, vertical: true },
  { text: 'Quark orbital angular momentum in the proton from a', size: 16.18, x: 83.28, y: 694.9 },
  { text: 'twist-3 generalized parton distribution', size: 16.18, x: 83.28, y: 670.78 },
  { text: 'Example Author, Second Author', size: 11.24, x: 83.28, y: 623.74 },
  { text: 'This synthetic body explains the document in ordinary smaller text.', size: 10, x: 83.28, y: 540 },
  { text: 'Further ordinary text distinguishes the body style from its heading.', size: 10, x: 83.28, y: 526 }
]
export const pdfWithVisibleTitle = (info?: string, xmp?: string) => pdfFixture([''], [], info, undefined, xmp, titlePage)
