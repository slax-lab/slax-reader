import { describe, expect, it } from 'vitest'
import { pdfFirstPageTitle } from '../../src/utils/pdfTitle'
import { extractPdfMetadata, extractPdfText } from '../../src/utils/pdf'
import { pdfWithVisibleTitle, titlePage, visiblePdfTitle } from '../helpers/pdfTitleFixture'

const viewport = { width: 595, height: 842, transform: [1, 0, 0, -1, 0, 842] }
const items = () =>
  titlePage.map(run => ({
    str: run.text,
    width: run.text.length * run.size * 0.45,
    transform: run.vertical ? [0, run.size, -run.size, 0, run.x, run.y] : [run.size, 0, 0, run.size, run.x, run.y]
  }))

describe('Visible PDF title fallback', () => {
  it('combines the two heading lines and excludes the larger rotated arXiv margin identifier', () => {
    expect(pdfFirstPageTitle(items(), viewport)).toBe(visiblePdfTitle)
  })
  it('reads the visible heading through real PDF.js metadata and full-extraction paths', async () => {
    expect(await extractPdfMetadata(pdfWithVisibleTitle())).toMatchObject({ title: visiblePdfTitle })
    expect(await extractPdfText(pdfWithVisibleTitle())).toMatchObject({ title: visiblePdfTitle, status: 'ready' })
  })
  it('keeps XMP and Info titles authoritative over a differing visible heading', async () => {
    expect(await extractPdfMetadata(pdfWithVisibleTitle('Info Title', 'XMP Title'))).toMatchObject({ title: 'XMP Title' })
    expect(await extractPdfText(pdfWithVisibleTitle('Info Title'))).toMatchObject({ title: 'Info Title' })
  })
  it('does not mistake uniform body text, an abstract, or page numbers for a title', () => {
    const body = items().map(item => ({ ...item, transform: [10, 0, 0, 10, item.transform[4], item.transform[5]] }))
    expect(pdfFirstPageTitle(body, viewport)).toBeUndefined()
    const withLabel = items().filter(item => item.transform[0] !== 16.18)
    withLabel.push({ str: 'Abstract', width: 100, transform: [18, 0, 0, 18, 83, 700] })
    withLabel.push({ str: '123456789', width: 100, transform: [24, 0, 0, 24, 83, 760] })
    expect(pdfFirstPageTitle(withLabel, viewport)).toBeUndefined()
  })
  it('ignores malformed geometry and headings outside the upper page', () => {
    expect(pdfFirstPageTitle([{ str: 'Invalid Title', transform: [NaN, 0, 0, 20, 20, 700], width: 50 }], viewport)).toBeUndefined()
    expect(
      pdfFirstPageTitle(
        items().map(item => ({ ...item, transform: [...item.transform.slice(0, 5), 200] })),
        viewport
      )
    ).toBeUndefined()
    expect(pdfFirstPageTitle(items(), { ...viewport, width: NaN })).toBeUndefined()
  })
  it('normalizes a rotated page before interpreting its visible heading direction', () => {
    const rotated = items().map(item => ({
      ...item,
      transform: [item.transform[1], -item.transform[0], item.transform[3], -item.transform[2], 842 - item.transform[5], item.transform[4]]
    }))
    expect(pdfFirstPageTitle(rotated, { width: 595, height: 842, transform: [0, 1, 1, 0, 0, 0] })).toBe(visiblePdfTitle)
  })
  it('does not combine headings separated by an author or a large gap', () => {
    const split = items().map(item => (item.str === 'twist-3 generalized parton distribution' ? { ...item, transform: [16.18, 0, 0, 16.18, 83.28, 560] } : item))
    expect(pdfFirstPageTitle(split, viewport)).toBe(titlePage[1].text)
  })
})
