import { parseMarkdownText } from '@commons/frontend-utils/parse'
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

  describe('mermaid fences', () => {
    const parseToElement = (markdown: string) => {
      const container = document.createElement('div')
      container.innerHTML = parseMarkdownText(markdown, { mermaid: true })
      return container
    }

    it('emits a placeholder carrying the source of a closed mermaid fence', () => {
      const container = parseToElement('```mermaid\ngraph TD;\nA-->B;\n```')

      const placeholder = container.querySelector('.mermaid-placeholder')
      expect(placeholder).not.toBeNull()
      expect(placeholder?.textContent).toBe('graph TD;\nA-->B;\n')
    })

    // The leading paragraph keeps the code block away from the node happy-dom
    // drops from every sanitized payload, so the full wrapper stays inspectable.
    it('wraps the placeholder in the code block markdown-it renders around it', () => {
      const container = parseToElement('下面是流程图：\n\n```mermaid\ngraph TD;\nA-->B;\n```')

      const placeholder = container.querySelector('pre > code.language-mermaid > .mermaid-placeholder')
      expect(placeholder).not.toBeNull()
      expect(placeholder?.textContent).toBe('graph TD;\nA-->B;\n')
    })

    it('keeps markup inside the mermaid source inert', () => {
      const source = 'graph TD;\nA["<img src=x onerror=alert(1)>"]-->B;'
      const container = parseToElement(`\`\`\`mermaid\n${source}\n\`\`\``)

      const placeholder = container.querySelector('.mermaid-placeholder')
      expect(placeholder?.querySelector('img')).toBeNull()
      expect(placeholder?.textContent).toBe(`${source}\n`)
    })

    it('renders an unclosed mermaid fence as a plain code block', () => {
      const html = parseMarkdownText('```mermaid\ngraph TD;\nA-->B;', { mermaid: true })

      expect(html).not.toContain('mermaid-placeholder')
      expect(html).toContain('code-block-header')
      expect(html).toContain('TD')
    })

    it('downgrades only the mermaid fence that stays unclosed', () => {
      const html = parseMarkdownText('```mermaid\ngraph TD;\nA-->B;\n```\n\ntext\n\n```mermaid\ngraph TD;', { mermaid: true })

      expect(html).toContain('mermaid-placeholder')
      expect(html).toContain('code-block-header')
    })

    it('honours closing fences longer than the opening fence', () => {
      const container = parseToElement('````mermaid\ngraph TD;\n````')

      expect(container.querySelector('.mermaid-placeholder')?.textContent).toBe('graph TD;\n')
    })

    it('treats a mermaid fence inside another fence as content', () => {
      const html = parseMarkdownText('```text\n```mermaid\ngraph TD;\n```', { mermaid: true })

      expect(html).not.toContain('mermaid-placeholder')
      expect(html).toContain('TD')
    })

    it('leaves other languages on the syntax-highlighted path', () => {
      const html = parseMarkdownText('```js\nconst answer = 42\n```', { mermaid: true })

      expect(html).not.toContain('mermaid-placeholder')
      expect(html).toContain('hljs-keyword')
    })
  })

  describe('mermaid fences without the mermaid option', () => {
    const fence = '下面是流程图：\n\n```mermaid\ngraph TD;\nA-->B;\n```'

    // The acceptance point of the opt-in: a consumer that never hydrates keeps
    // the code block it had before mermaid support existed, language header and
    // copy affordance included.
    it('keeps rendering the mermaid fence as a code block', () => {
      const container = document.createElement('div')
      container.innerHTML = parseMarkdownText(fence)

      expect(container.querySelector('.mermaid-placeholder')).toBeNull()
      expect(container.querySelector('pre.code-block-wrapper .code-block-header__copy')).not.toBeNull()
      expect(container.querySelector('code.code-block-body')?.textContent).toContain('graph TD;')
    })

    it('treats an omitted option and mermaid: false alike', () => {
      expect(parseMarkdownText(fence)).toBe(parseMarkdownText(fence, { mermaid: false }))
    })
  })
})
