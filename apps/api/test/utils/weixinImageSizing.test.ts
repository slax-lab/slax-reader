import { describe, expect, it } from 'vitest'
import { parseHTML } from 'linkedom'
import { Readability } from '@slax-lab/readability'
import { mpWeixinQQPostHandler, mpWeixinQQPreHandler } from '@/utils/parserUtils/processWeixin'

// Exercise the installed Readability and both hooks: a post-handler-only test
// would miss dimensions overwritten during extraction or lost with a parent.
function parseImage(markup: string) {
  const url = 'https://mp.weixin.qq.com/s/image-sizing-regression'
  const text = '这是一篇用于验证收藏正文图片尺寸的文章，正文内容需要完整保留。'.repeat(30)
  const { document } = parseHTML(`<html><head><title>图片尺寸</title></head><body><article><h1>图片尺寸</h1><p>${text}</p>${markup}<p>${text}</p></article></body></html>`)
  Object.defineProperty(document, 'documentURI', { value: url })
  mpWeixinQQPreHandler(url, document)
  const result = new Readability(document, { keepImgImportantStyles: true }).parse()
  expect(result).not.toBeNull()
  const parsed = parseHTML(`<html><body>${result!.content}</body></html>`).document
  mpWeixinQQPostHandler(url, parsed)
  const img = parsed.querySelector('img')!
  expect(img).not.toBeNull()
  return img
}

function value(img: HTMLImageElement, property: string) {
  // linkedom includes !important in getPropertyValue, unlike browsers.
  return (
    img.style
      .getPropertyValue(property)
      ?.replace(/\s*!important\s*$/i, '')
      .trim() || ''
  )
}

describe('WeChat image sizing through collection', () => {
  it('preserves case-sensitive custom properties used by the display width', () => {
    const img = parseImage('<img src="https://example.com/icon.png" data-w="500" data-ratio="1" style="--iconWidth:14px;width:var(--iconWidth)">')
    // linkedom camel-case normalization also affects custom-property lookups.
    // Verify the serialized HTML consumed by the browser instead.
    expect(img.getAttribute('style')).toContain('--iconWidth: 14px')
    expect(value(img, 'width')).toBe('var(--iconWidth)')
  })

  it.each(['margin', 'padding'])('preserves the winning %s longhand after its shorthand', property => {
    const img = parseImage(`<img src="https://example.com/icon.png" data-w="500" data-ratio="1" style="width:24px;${property}-left:2px;${property}:0;${property}-left:10px">`)
    expect(img.getAttribute('style')).toContain(`${property}: 0; ${property}-left: 10px`)
  })

  it('keeps the 14px parent constraint of the 500×571 icon after cleaning its parent', () => {
    const img = parseImage(
      '<section style="width:14px"><img src="https://example.com/icon.png" data-w="500" data-ratio="1.142" style="width:100%;max-width:100%;vertical-align:middle"></section>'
    )
    expect(img.parentElement?.getAttribute('style')).toBeNull()
    expect(value(img, 'width')).toBe('14px')
    expect(value(img, 'height')).toBe('auto')
    expect(value(img, 'max-width')).toBe('100%')
    expect(value(img, 'vertical-align')).toBe('middle')
  })

  it('makes the 2490×1148 image shrink proportionally without discarding its preferred width', () => {
    const img = parseImage('<img src="https://example.com/large.png" data-w="2490" data-ratio="0.4610441767068273" style="max-width:100%;height:auto;margin:0 auto">')
    expect(value(img, 'width')).toBe('2490px')
    expect(value(img, 'height')).toBe('auto')
    expect(img.style.getPropertyValue('max-width')).toBe('100% !important')
    expect(value(img, 'margin')).toBe('0 auto')
  })

  it.each(['width:24px !important', 'width:24px !important;width:300px', 'WIDTH:24px !IMPORTANT'])('respects the author width despite Readability fallback: %s', style => {
    const img = parseImage(`<img src="https://example.com/icon.png" data-w="300" data-ratio="1" style="${style}">`)
    expect(value(img, 'width')).toBe('24px')
    expect(value(img, 'height')).toBe('auto')
  })

  it('retains a tighter max-width instead of mistaking it for width', () => {
    const img = parseImage('<img src="https://example.com/icon.png" data-w="500" data-ratio="1" style="width:100%;max-width:24px">')
    expect(value(img, 'max-width')).toBe('min(100%, 24px)')
  })

  it.each([
    ['', '25%'],
    ['width:48px', '12px']
  ])('resolves an important percentage width against its original parent: %s', (parent, expected) => {
    const img = parseImage(`<section style="${parent}"><img src="https://example.com/icon.png" data-w="500" data-ratio="1" style="width:25% !important"></section>`)
    expect(value(img, 'width')).toBe(expected)
  })

  it('does not mistake the bitmap width for a parent constraint on explicit larger widths', () => {
    const img = parseImage('<img src="https://example.com/image.png" data-w="100" data-ratio="1" style="width:200px !important">')
    expect(value(img, 'width')).toBe('200px')
  })

  it('does not let a later normal declaration override the important author width', () => {
    const img = parseImage('<section style="width:400px"><img src="https://example.com/image.png" data-w="500" data-ratio="1" style="width:300px !important;width:24px"></section>')
    expect(value(img, 'width')).toBe('300px')
  })

  it.each([
    ['', '400px'],
    ['width:24px', '24px']
  ])('constrains a derived width by the parent, not by data-w: %s', (parent, expected) => {
    const img = parseImage(`<section style="${parent}"><img src="https://example.com/image.png" data-w="100" data-ratio="0.5" style="height:200px"></section>`)
    expect(value(img, 'width')).toBe(expected)
    expect(value(img, 'height')).toBe('auto')
  })

  it('derives the display width from a height-only image before removing the height', () => {
    const img = parseImage('<img src="https://example.com/icon.png" data-w="500" data-ratio="2" style="width:auto;height:24px">')
    expect(value(img, 'width')).toBe('12px')
    expect(value(img, 'height')).toBe('auto')
  })

  it.each(['', 'data-ratio="0"', 'data-ratio="NaN"', 'data-ratio="2garbage"'])('keeps height-only sizing when the ratio is unreliable: %s', ratio => {
    const img = parseImage(`<img src="https://example.com/icon.png" data-w="500" ${ratio} style="height:24px;vertical-align:middle">`)
    expect(img.style.getPropertyValue('height')).toBe('24px !important')
    expect(img.style.getPropertyValue('width')).toBe('auto !important')
  })

  it('keeps relative height-only icons small without guessing their pixel width', () => {
    const img = parseImage('<img src="https://example.com/icon.png" data-w="500" data-ratio="1" style="height:1em">')
    expect(value(img, 'height')).toBe('1em')
    expect(value(img, 'width')).toBe('auto')
  })

  it('keeps an unresolvable height expression instead of using data-w as display width', () => {
    const img = parseImage('<img src="https://example.com/icon.png" data-w="500" data-ratio="1" style="height:calc(1em + 2px)">')
    expect(value(img, 'height')).toBe('calc(1em + 2px)')
    expect(value(img, 'width')).toBe('auto')
  })

  it('uses an HTML width attribute when CSS does not specify a width', () => {
    const img = parseImage('<img src="https://example.com/icon.png" width="24" height="24" data-w="500" data-ratio="1">')
    expect(value(img, 'width')).toBe('24px')
    expect(value(img, 'height')).toBe('auto')
  })

  it('preserves an explicit relative width rather than replacing it with the bitmap width', () => {
    const img = parseImage('<img src="https://example.com/icon.png" data-w="500" data-ratio="1" style="width:1em;height:auto">')
    expect(value(img, 'width')).toBe('1em')
    expect(value(img, 'height')).toBe('auto')
  })

  it('does not flatten an intentional crop into a proportional image', () => {
    const img = parseImage('<img src="https://example.com/avatar.png" data-w="500" data-ratio="2" style="width:24px;height:24px;object-fit:cover">')
    expect(value(img, 'width')).toBe('24px')
    expect(value(img, 'height')).toBe('24px')
    expect(value(img, 'object-fit')).toBe('cover')
  })

  it('does not invent a full-width display size when neither dimensions nor metadata exist', () => {
    const img = parseImage('<img src="https://example.com/unknown.png" style="vertical-align:middle">')
    expect(value(img, 'width')).not.toBe('100%')
    expect(value(img, 'height')).not.toBe('auto')
  })
})
