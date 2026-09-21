import { parseMarkdownText } from '@commons/utils/parse'

import { describe, expect, it } from 'vitest'

describe('parseMarkdownText', () => {
  it('opens rendered links in a new tab without changing anchor hrefs', () => {
    const html = parseMarkdownText('[external](https://example.com) [anchor](anchor_42)')

    expect(html).toContain('<a href="https://example.com" target="_blank" rel="noopener">external</a>')
    expect(html).toContain('<a href="anchor_42" target="_blank" rel="noopener">anchor</a>')
  })

  it('renders CJK emphasis next to full-width punctuation', () => {
    expect(parseMarkdownText('这是**重点**，继续。')).toContain('<strong>重点</strong>，')
  })

  it('keeps syntax highlighting and KaTeX rendering enabled', () => {
    const html = parseMarkdownText('```js\nconst answer = 42\n```\n\n$x^2$')

    expect(html).toContain('code-block-header')
    expect(html).toContain('code-block-body')
    expect(html).toContain('hljs-keyword')
    expect(html).toContain('katex')
  })
})
