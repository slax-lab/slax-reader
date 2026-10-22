import { afterEach, describe, expect, it, vi } from 'vitest'
import * as parser from 'parse5'
import { applyArticleImageLoading } from '~/utils/articleImageLoading'

vi.mock('parse5', async importOriginal => ({ ...await importOriginal<typeof import('parse5')>() }))
const enabled = { enabled: true, excludedPresentation: false }
const hero = '<img src="hero.jpg">'
const htmlNS = parser.html.NS.HTML

function images(html: string) {
  const fragment = parser.parseFragment(parser.defaultTreeAdapter.createElement('div', htmlNS, []), html)
  const found: Record<string, string>[] = []
  const visit = (node: parser.DefaultTreeAdapterTypes.Node) => {
    if ('tagName' in node && node.tagName === 'img' && node.namespaceURI === htmlNS) found.push(Object.fromEntries(node.attrs.map(a => [a.name, a.value])))
    if ('childNodes' in node) node.childNodes.forEach(visit)
  }
  visit(fragment)
  return found
}
function promoted(html: string) {
  return images(applyArticleImageLoading(html, enabled)).filter(i => i.fetchpriority === 'high').map(i => i.src)
}

afterEach(() => vi.restoreAllMocks())

describe('article image selection', () => {
  it('promotes one early image, resets incoming priority, and leaves later images lazy', () => {
    expect(images(applyArticleImageLoading('<img src="icon" width="24">' + hero + '<img src="later" fetchpriority="high">', enabled))).toEqual([
      { src: 'icon', width: '24', loading: 'lazy', fetchpriority: 'auto' },
      { src: 'hero.jpg', loading: 'eager', fetchpriority: 'high' },
      { src: 'later', loading: 'lazy', fetchpriority: 'auto' }
    ])
  })
  it.each([599, 600])('counts %i decoded non-whitespace Unicode points', count => {
    const html = '<p>' + ('&#x1f600; \t\n&nbsp;').repeat(count) + '</p>' + hero
    expect(promoted(html)).toEqual(count === 599 ? ['hero.jpg'] : [])
  })
  it.each(['script', 'style', 'template', 'noscript'])('does not count %s text or select its images', tag => {
    expect(promoted(`<${tag}>${'x'.repeat(600)}<img src="inert"></${tag}>` + hero)).toEqual(['hero.jpg'])
  })
  it.each(['hidden', 'style="display:none"', 'style="visibility:hidden"', 'style="DISPLAY: none !important; display:block"'])('excludes hidden subtrees: %s', attributes => {
    expect(promoted(`<div ${attributes}>${'x'.repeat(600)}<img src="hidden"></div>` + hero)).toEqual(['hero.jpg'])
  })
  it('retains aria-hidden substantive images and counts aria-hidden text', () => {
    expect(promoted('<div aria-hidden="true"><img src="decorative" width="1000"></div>' + hero)).toEqual(['decorative'])
    expect(promoted(`<div aria-hidden="true">${'x'.repeat(600)}</div>` + hero)).toEqual([])
  })
  it.each(['avatar', 'icon', 'emoji', 'logo', 'profile-image', 'zhihu-qa-avatar'])('excludes raw and isolated %s image classes', token => {
    for (const prefix of ['', 'oc-']) expect(promoted(`<img class="other ${prefix}${token}" src="icon">` + hero)).toEqual(['hero.jpg'])
  })
  it.each(['tweet-header', 'quote-header', 'zhihu-qa-user'])('excludes %s ancestors without excluding entire posts', token => {
    for (const prefix of ['', 'oc-']) expect(promoted(`<div class="tweet"><div class="${prefix}${token}"><img src="avatar"></div>${hero}</div>`)).toEqual(['hero.jpg'])
  })
  it('does not use invalid ARIA roles as icon classifications', () => {
    expect(promoted('<img role="avatar" src="hero">')).toEqual(['hero'])
  })
  it.each([
    ['width="96"', false], ['height="96"', false], ['width="97"', true],
    ['width="0"', true], ['width="-5"', true], ['width="50%"', true],
    ['width="1000" style="width:96px"', false],
    ['width="24" style="width:1000px"', true],
    ['width="24" style="width:100%"', true],
    ['style="max-width:96px"', false], ['style="max-height:96px"', false],
    ['style="width:97px; max-width:96px"', false],
    ['style="width:24px; width:1000px"', true],
    ['style="width:24px !important; width:1000px"', false],
    ['style="width:1000px !important; width:24px"', true],
    ['style="width:24px !important; width:1000px !important"', true],
    ['style="width:.5px"', false], ['style="width:+24px"', false],
    ['style="width:1e2px"', true], ['style="max-width:50%"', true],
    ['style="width:calc(100% - 1px)"', true],
    ['style="--note:\'x;width:1px\';width:1000px"', true],
    ['style="width:1000px;/* ; width:1px */height:auto"', true]
  ])('uses authored display constraints %s (eligible=%s)', (attributes, eligible) => {
    expect(promoted(`<img src="first" ${attributes}>` + hero)).toEqual([eligible ? 'first' : 'hero.jpg'])
  })
  it.each(['srcset="large 2x"', 'srcset="large 2x" height="1000"'])('stops at substantive responsive image: %s', attributes => {
    expect(promoted(`<img src="responsive" ${attributes}>` + hero)).toEqual([])
  })
  it('stops at a picture source and preserves responsive source bytes', () => {
    const html = '<picture><source srcset="a.avif 1x, b.avif 2x" sizes="100vw"><img src="fallback"></picture>' + hero
    expect(promoted(html)).toEqual([])
    expect(applyArticleImageLoading(html, enabled)).toContain('<source srcset="a.avif 1x, b.avif 2x" sizes="100vw">')
  })
  it('skips responsive icons before the plain hero', () => {
    expect(promoted('<picture><source srcset="icon 2x"><img src="icon" class="oc-icon"></picture>' + hero)).toEqual(['hero.jpg'])
  })
  it('excludes empty, data and blob sources before the hero', () => {
    expect(promoted('<img><img src=""><img src="data:image/png,x"><img src="blob:synthetic">' + hero)).toEqual(['hero.jpg'])
  })
  it('does not let later responsive images cancel a prior selection', () => {
    expect(promoted(hero + '<img src="later" srcset="later2x 2x">')).toEqual(['hero.jpg'])
  })
  it('leaves no-candidate bodies intact and normalizes ordinary images to lazy', () => {
    expect(applyArticleImageLoading('<p>No images</p>', enabled)).toBe('<p>No images</p>')
    expect(images(applyArticleImageLoading('<img src="icon" width="1" fetchpriority="high">', enabled))[0]).toMatchObject({ loading: 'lazy', fetchpriority: 'auto' })
  })
  it('selects in repaired tree order, not source order, including implicit tbody', () => {
    expect(promoted('<table><tr><td><img src="cell"></td></tr><img src="fostered"></table>' + hero)).toEqual(['fostered'])
  })
  it('counts text in repaired tree order', () => {
    expect(promoted(`<table><tr><td>${'x'.repeat(600)}</td></tr><img src="fostered"></table>`)).toEqual(['fostered'])
  })
  it('supports HTML integration points without promoting SVG image elements', () => {
    const html = '<svg><image href="vector"/><foreignObject><img src="foreign"></foreignObject></svg><math><mtext><img src="math"></mtext></math>' + hero
    expect(promoted(html)).toEqual(['foreign'])
    expect(applyArticleImageLoading(html, enabled)).toContain('<image href="vector"/>')
  })
})

describe('source-preserving image policy', () => {
  it('preserves signed queries, quoted >, custom tags, selection anchors, and all non-policy bytes', () => {
    const html = '<custom-player data-x="a>b"></custom-player><p id="anchor"> 😀 </p><IMG\nalt=\'a > b\' src="/image?sig=a%2Fb+X&amp;expires=123" width="1200" style="width:100%;height:auto" data-x="x" />'
    const result = applyArticleImageLoading(html, enabled)
    expect(result.replace(/ loading="eager" fetchpriority="high"/, '')).toBe(html)
    expect(applyArticleImageLoading(result, enabled)).toBe(result)
  })
  it('removes all duplicate mixed-case policy attributes without deleting other spacing', () => {
    const html = '<img\nLOADING = \'lazy\' loading=eager\tFETCHPRIORITY=low fetchpriority="high" src="signed?a=1&amp;b=2" alt="x>y">'
    const result = applyArticleImageLoading(html, enabled)
    expect(result.match(/\bloading\s*=/gi)).toHaveLength(1)
    expect(result.match(/\bfetchpriority\s*=/gi)).toHaveLength(1)
    expect(images(result)[0]).toMatchObject({ loading: 'eager', fetchpriority: 'high', src: 'signed?a=1&b=2' })
    expect(result.replace(/loading="eager"|fetchpriority="high"/g, '')).toBe('<img\n \t  src="signed?a=1&amp;b=2" alt="x>y">')
    expect(applyArticleImageLoading(result, enabled)).toBe(result)
  })
  it.each(['<img src=hero/>', '<img src=hero loading>', '<img src=hero/ loading=eager>', '<IMG /src="hero"/loading=lazy>', '<img src="hero" alt="loading=lazy > fetchpriority=high">'])('retains resource identity and idempotence for %s', html => {
    const before = images(html)[0]!
    const once = applyArticleImageLoading(html, enabled)
    expect(images(once)[0]?.src).toBe(before.src)
    expect(images(once)[0]?.fetchpriority).toBe('high')
    expect(applyArticleImageLoading(once, enabled)).toBe(once)
  })
  it('uses only HTML ASCII whitespace when scanning attributes', () => {
    const html = '<img src="hero" data-x\u00a0loading="untouched" loading=lazy>'
    const once = applyArticleImageLoading(html, enabled)
    expect(once).toContain('data-x\u00a0loading="untouched"')
    expect(images(once)[0]?.loading).toBe('eager')
    expect(applyArticleImageLoading(once, enabled)).toBe(once)
  })
  it('makes the same choice after repaired HTML is restored', () => {
    const html = '<p>lead<div><img src="first"></div></p><table><tr><td><img src="cell"></td></tr><img src="fostered"></table>'
    const once = applyArticleImageLoading(html, enabled)
    const restored = parser.serialize(parser.parseFragment(once))
    expect(promoted(restored)).toEqual(['first'])
    expect(applyArticleImageLoading(restored, enabled)).toBe(restored)
  })
  it.each([{ enabled: false, excludedPresentation: false }, { enabled: true, excludedPresentation: true }])('uses the established blanket lazy rendering path for %j', options => {
    expect(applyArticleImageLoading('<p>body</p>' + hero, options)).toBe('<p>body</p><img loading="lazy" src="hero.jpg">')
  })
  it('falls back for parser failure without losing the body', () => {
    vi.spyOn(parser, 'parseFragment').mockImplementationOnce(() => { throw new Error('synthetic parser failure') })
    expect(applyArticleImageLoading('<p>body</p>' + hero, enabled)).toBe('<p>body</p><img loading="lazy" src="hero.jpg">')
  })
  it('falls back atomically if one image source location is unavailable', () => {
    const realParse = parser.parseFragment
    vi.spyOn(parser, 'parseFragment').mockImplementationOnce((...args: Parameters<typeof realParse>) => {
      const fragment = realParse(...args)
      const first = fragment.childNodes[0]!
      if ('sourceCodeLocation' in first) first.sourceCodeLocation = undefined
      return fragment
    })
    expect(applyArticleImageLoading('<img src="first"><img src="second">', enabled)).toBe('<img loading="lazy" src="first"><img loading="lazy" src="second">')
  })
  it('falls back if an image source span points to another valid opening tag', () => {
    const realParse = parser.parseFragment
    vi.spyOn(parser, 'parseFragment').mockImplementationOnce((...args: Parameters<typeof realParse>) => {
      const fragment = realParse(...args)
      const first = fragment.childNodes[0] as parser.DefaultTreeAdapterTypes.Element
      const second = fragment.childNodes[1] as parser.DefaultTreeAdapterTypes.Element
      first.sourceCodeLocation!.startTag = second.sourceCodeLocation!.startTag
      return fragment
    })
    expect(applyArticleImageLoading('<img src="first"><img src="second">', enabled)).toBe('<img loading="lazy" src="first"><img loading="lazy" src="second">')
  })
  it('handles a responsive source-only picture without promoting a later image', () => {
    const html = '<picture><source srcset="hero.avif 1x"><img alt="hero"></picture>' + hero
    expect(promoted(html)).toEqual([])
    expect(images(applyArticleImageLoading(html, enabled))).toEqual([
      { alt: 'hero', loading: 'lazy', fetchpriority: 'auto' },
      { src: 'hero.jpg', loading: 'lazy', fetchpriority: 'auto' }
    ])
  })
  it('keeps source-only responsive icons from suppressing a later hero', () => {
    expect(promoted('<picture><source srcset="icon 2x"><img class="oc-icon"></picture>' + hero)).toEqual(['hero.jpg'])
  })
  it('recognizes importance with whitespace and CSS comments', () => {
    expect(promoted('<img src="icon" style="width:24px ! /*comment*/ important; width:1000px">' + hero)).toEqual(['hero.jpg'])
  })
  it('supports relative protocol and signed Unicode sources without resolving them', () => {
    const html = '<img src="//fixtures.invalid/图片?sig=%2F+foo&amp;x=1">'
    const once = applyArticleImageLoading(html, enabled)
    expect(once.replace(' loading="eager" fetchpriority="high"', '')).toBe(html)
    expect(applyArticleImageLoading(once, enabled)).toBe(once)
  })
  it('performs no resource I/O', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network forbidden'))
    expect(promoted('<img src="https://fixtures.invalid/hero">')).toEqual(['https://fixtures.invalid/hero'])
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
