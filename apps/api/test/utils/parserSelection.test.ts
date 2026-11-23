import { beforeEach, describe, expect, test, vi } from 'vitest'
import { parseHTML } from 'linkedom'

const mocks = vi.hoisted(() => ({
  defuddleParse: vi.fn(),
  readabilityParse: vi.fn()
}))

vi.mock('@/utils/parserUtils/defuddle', () => ({ defuddleParse: mocks.defuddleParse }))
vi.mock('@slax-lab/readability', () => ({
  Readability: class {
    public constructor(public document: Document) {}

    public parse() {
      return mocks.readabilityParse(this.document)
    }
  }
}))

import { PreparserHandle, slaxReadability } from '@/utils/parserUtils'

const result = (textContent: string) => ({ content: `<p>${textContent}</p>`, textContent })

describe('parser selection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('uses Defuddle for ordinary pages without comparing parser results', async () => {
    const defuddleResult = result('Main article body.')
    mocks.defuddleParse.mockResolvedValue(defuddleResult)

    const document = parseHTML('<html><body><article>Body</article></body></html>').document
    expect(await slaxReadability(new URL('https://example.com/article'), document)).toBe(defuddleResult)
    expect(mocks.defuddleParse).toHaveBeenCalledWith('https://example.com/article', document)
    expect(mocks.readabilityParse).not.toHaveBeenCalled()
  })

  test('keeps dedicated domains on their existing Readability path and fallback', async () => {
    const readabilityResult = result('X article')
    mocks.readabilityParse.mockImplementationOnce(() => {
      throw new Error('first parse failed')
    })
    mocks.readabilityParse.mockReturnValueOnce(readabilityResult)

    expect(await slaxReadability(new URL('https://x.com/user/article/1'), parseHTML('<html><body>Body</body></html>').document)).toBe(readabilityResult)
    expect(mocks.defuddleParse).not.toHaveBeenCalled()
    expect(mocks.readabilityParse).toHaveBeenCalledTimes(2)
  })

  test('falls back to Readability when the lazily loaded Defuddle parse rejects', async () => {
    const readabilityResult = result('Fallback body')
    mocks.defuddleParse.mockRejectedValue(new Error('defuddle failed'))
    mocks.readabilityParse.mockReturnValue(readabilityResult)

    expect(await slaxReadability(new URL('https://example.com/article'), parseHTML('<html><body>Body</body></html>').document)).toBe(readabilityResult)
    expect(mocks.readabilityParse).toHaveBeenCalledOnce()
  })
})

test('only the reported same-origin CAC utility frames are removed before parsing', async () => {
  const tools = ['/cms/pub/interact/jiucuo.htm?v=2', '../../inc/date/My97DatePicker.htm', 'https://www.cac.gov.cn/inc/date/My97DatePicker.htm']
  const embeds = ['/video/player', 'https://other.example/cms/pub/interact/jiucuo.htm', '/inc/date/My97DatePicker.htm.more']
  const sources = [...tools, ...embeds]
  const html = '<html><body><p>Article</p>' + sources.map(src => `<iframe src="${src}"></iframe>`).join('') + '</body></html>'
  for (const [host, expected] of [
    ['www.cac.gov.cn', embeds],
    ['other.example', sources]
  ] as const) {
    const { document } = parseHTML(html)
    await PreparserHandle(new URL(`https://${host}/2025-09/15/example.htm`), document)
    expect([...document.querySelectorAll('iframe')].map(frame => frame.getAttribute('src'))).toEqual(expected)
    expect(document.querySelector('p')?.textContent).toBe('Article')
  }
})
