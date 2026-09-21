// PreLineProcessor 单测
import { PRELINE_FLAG_CLASS, PreLineProcessor } from '~~/app/components/Article/processors/preline.processor'
import type { WebProcessorContext } from '~~/app/components/Article/processors/types'
import { ArticleStyle } from '~~/app/components/Article/processors/types'
import { describe, expect, it } from 'vitest'

function buildContext(html: string): WebProcessorContext {
  const container = document.createElement('div')
  container.innerHTML = `<div class="html-text">${html}</div>`
  return {
    container,
    url: new URL('https://example.com/'),
    articleStyle: ArticleStyle.Default,
    callbacks: {
      screenLockUpdate: () => {},
      showImagePreview: () => {},
      websiteClick: () => {}
    },
    cleanups: []
  }
}

function hasPrelineFlag(el: Element): boolean {
  return el.querySelector(`:scope > .${PRELINE_FLAG_CLASS}`) !== null
}

describe('PreLineProcessor', () => {
  const processor = new PreLineProcessor()

  it('match() 始终返回 true', () => {
    expect(processor.match()).toBe(true)
  })

  it('单行内容：不标记', () => {
    const ctx = buildContext('<p>single line paragraph</p>')
    processor.process(ctx)
    expect(hasPrelineFlag(ctx.container.querySelector('p')!)).toBe(false)
  })

  it('含 2 行内容（真·换行符 \\n）：标记', () => {
    const ctx = buildContext('<p>line one\nline two</p>')
    processor.process(ctx)
    expect(hasPrelineFlag(ctx.container.querySelector('p')!)).toBe(true)
  })

  it('CRLF / CR 也生效', () => {
    const crlf = buildContext('<p>line one\r\nline two</p>')
    processor.process(crlf)
    expect(hasPrelineFlag(crlf.container.querySelector('p')!)).toBe(true)

    const cr = buildContext('<p>line one\rline two</p>')
    processor.process(cr)
    expect(hasPrelineFlag(cr.container.querySelector('p')!)).toBe(true)
  })

  it('源码美化缩进（首尾各一个换行、内容只有 1 行）：不标记', () => {
    const ctx = buildContext('<p>\n  only one content line \n</p>')
    processor.process(ctx)
    expect(hasPrelineFlag(ctx.container.querySelector('p')!)).toBe(false)
  })

  it('重点：可见的两字符 `\\n`（反斜杠 + n，是要显示的文字）→ 不标记', () => {
    // String.raw 确保喂进 DOM 的是「反斜杠 + n」而非真换行符
    const ctx = buildContext(String.raw`<p>foo\nbar\nbaz</p>`)
    processor.process(ctx)
    expect(ctx.container.querySelector('p')!.textContent).toContain('\\n') // 确认确实是可见文字
    expect(hasPrelineFlag(ctx.container.querySelector('p')!)).toBe(false)
  })

  it('空 <p>：不标记', () => {
    const ctx = buildContext('<p></p>')
    processor.process(ctx)
    expect(hasPrelineFlag(ctx.container.querySelector('p')!)).toBe(false)
  })

  it('只有换行/空白、无实际内容：不标记', () => {
    const ctx = buildContext('<p>\n   \n   \n</p>')
    processor.process(ctx)
    expect(hasPrelineFlag(ctx.container.querySelector('p')!)).toBe(false)
  })

  it('幂等：已存在 marker 不重复插入', () => {
    const ctx = buildContext('<p>line one\nline two</p>')
    processor.process(ctx)
    processor.process(ctx)
    expect(ctx.container.querySelectorAll(`.${PRELINE_FLAG_CLASS}`).length).toBe(1)
  })

  it('缺少 .html-text 根节点：安全跳过', () => {
    const container = document.createElement('div')
    container.innerHTML = '<p>line one\nline two</p>'
    const ctx: WebProcessorContext = {
      container,
      url: new URL('https://example.com/'),
      articleStyle: ArticleStyle.Default,
      callbacks: { screenLockUpdate: () => {}, showImagePreview: () => {}, websiteClick: () => {} },
      cleanups: []
    }
    expect(() => processor.process(ctx)).not.toThrow()
    expect(hasPrelineFlag(container.querySelector('p')!)).toBe(false)
  })
})
