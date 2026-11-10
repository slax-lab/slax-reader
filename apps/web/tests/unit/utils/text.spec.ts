import { extractHTMLTextContent as legacyHtml, extractMarkdownFromText as legacyMarkdown } from '@commons/frontend-utils/parse'
import { extractHTMLTextContent, extractMarkdownFromText } from '@commons/frontend-utils/text'
import { readFileSync } from 'node:fs'
import { parseSync } from 'oxc-parser'
import { describe, expect, it } from 'vitest'

const nl = String.fromCharCode(10)
const tab = String.fromCharCode(9)

describe('lightweight text entry', () => {
  it('preserves the legacy exported functions', () => {
    expect(legacyHtml).toBe(extractHTMLTextContent)
    expect(legacyMarkdown).toBe(extractMarkdownFromText)
  })

  it.each([
    ['', ''],
    ['  plain   text  ', 'plain text'],
    ['<p>Hello <strong>world</strong></p>', 'Hello world'],
    ['<p>one</p><p>two</p>', 'onetwo'],
    ['<p>&amp; 中文 😀</p>', '&amp; 中文 😀'],
    [` ${tab}<div>甲</div>${nl}<span>乙</span> `, '甲 乙'],
    ['before <broken', 'before <broken'],
    ['<script>alert(1)</script>', 'alert(1)']
  ])('preserves HTML text output for %j', (input, expected) => {
    expect(extractHTMLTextContent(input)).toBe(expected)
    expect(legacyHtml(input)).toBe(expected)
  })

  it.each([
    ['', ''],
    ['ordinary text', ''],
    ['# Title', '# Title'],
    ['## Title', '## Title'],
    ['### Title', ''],
    ['#NoSpace', ''],
    ['  # Indented', ''],
    ['- item', '- item'],
    ['- ', ''],
    [`${tab}- item`, `${tab}- item`],
    [[ 'intro', '# 标题', 'body', '## Child', '  - 条目', '+ excluded' ].join(nl), [ '# 标题', '## Child', '  - 条目' ].join(nl)]
  ])('preserves Markdown extraction for %j', (input, expected) => {
    expect(extractMarkdownFromText(input)).toBe(expected)
    expect(legacyMarkdown(input)).toBe(expected)
  })

  it('has no runtime import or re-export dependencies', () => {
    const source = readFileSync(`${process.cwd()}/../../packages/frontend-utils/src/text.ts`, 'utf8')
    const parsed = parseSync('text.ts', source, { sourceType: 'module' })
    expect(parsed.errors).toEqual([])
    expect(parsed.module.staticImports).toEqual([])
    expect(parsed.module.dynamicImports).toEqual([])
    expect(parsed.module.staticExports.flatMap(item => item.entries).some(entry => entry.moduleRequest)).toBe(false)
  })
})
