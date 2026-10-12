// SpanProcessor 单测 —— 第四期 Sprint A.1.1
// 覆盖：纯空格 span 隐藏 / 空格 span 含媒体不隐藏 / 含文字 span 不隐藏 / 容器无 span 安全跳过
import { SpanProcessor } from '~~/app/components/Article/processors/span.processor'
import type { WebProcessorContext } from '~~/app/components/Article/processors/types'
import { ArticleStyle } from '~~/app/components/Article/processors/types'
import { describe, expect, it } from 'vitest'

function buildContext(html: string): WebProcessorContext {
  const container = document.createElement('div')
  container.innerHTML = html
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

describe('SpanProcessor', () => {
  const processor = new SpanProcessor()

  it('match() 始终返回 true', () => {
    expect(processor.match()).toBe(true)
  })

  it('纯空格 span：display 设为 none', () => {
    const ctx = buildContext('<span>   </span>')
    processor.process(ctx)
    expect((ctx.container.querySelector('span') as HTMLElement).style.display).toBe('none')
  })

  it('空内容 span 含 img[src]：不隐藏', () => {
    const ctx = buildContext('<span> <img src="https://example.com/x.png"></span>')
    processor.process(ctx)
    expect((ctx.container.querySelector('span') as HTMLElement).style.display).not.toBe('none')
  })

  it('含文字 span：不隐藏', () => {
    const ctx = buildContext('<span>正文</span>')
    processor.process(ctx)
    expect((ctx.container.querySelector('span') as HTMLElement).style.display).not.toBe('none')
  })

  it('空内容 span 含 br（代码块换行占位）：不隐藏', () => {
    const ctx = buildContext('<span><br></span>')
    processor.process(ctx)
    expect((ctx.container.querySelector('span') as HTMLElement).style.display).not.toBe('none')
  })

  it('容器无 span：不抛错', () => {
    const ctx = buildContext('<p>纯文字</p>')
    expect(() => processor.process(ctx)).not.toThrow()
  })
})
