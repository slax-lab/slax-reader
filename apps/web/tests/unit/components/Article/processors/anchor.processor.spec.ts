// AnchorProcessor 单测 —— 第四期 Sprint A.1.1
// 覆盖 hash / 站内绝对路径 / 站内相对路径 / 外链 4 条主分支 + 无 href 短路
import { AnchorProcessor } from '~~/app/components/Article/processors/anchor.processor'
import type { WebProcessorContext } from '~~/app/components/Article/processors/types'
import { ArticleStyle } from '~~/app/components/Article/processors/types'
import { describe, expect, it } from 'vitest'

function buildContext(html: string, urlStr = 'https://example.com/post/1'): WebProcessorContext {
  const container = document.createElement('div')
  container.innerHTML = html
  return {
    container,
    url: new URL(urlStr),
    articleStyle: ArticleStyle.Default,
    callbacks: {
      screenLockUpdate: () => {},
      showImagePreview: () => {},
      websiteClick: () => {}
    },
    cleanups: []
  }
}

describe('AnchorProcessor', () => {
  const processor = new AnchorProcessor()

  it('match() 始终返回 true', () => {
    expect(processor.match()).toBe(true)
  })

  it('hash 锚点：target 清空，href 不变', () => {
    const ctx = buildContext('<a href="#section1">跳转</a>')
    processor.process(ctx)
    const a = ctx.container.querySelector('a')!
    expect(a.target).toBe('')
    expect(a.getAttribute('href')).toBe('#section1')
  })

  it('站内绝对路径 /foo：href 拼接 origin 且 target 设为 _blank', () => {
    const ctx = buildContext('<a href="/foo/bar">链接</a>')
    processor.process(ctx)
    const a = ctx.container.querySelector('a')!
    expect(a.href).toBe('https://example.com/foo/bar')
    expect(a.target).toBe('_blank')
  })

  it('站内相对路径（无 http/https）：使用 anchor.pathname 拼接 origin', () => {
    const ctx = buildContext('<a href="relative-path">链接</a>')
    processor.process(ctx)
    const a = ctx.container.querySelector('a')!
    expect(a.href.startsWith('https://example.com/')).toBe(true)
    expect(a.target).toBe('_blank')
  })

  it('外链 https://other.com：href 不改写，target 设为 _blank', () => {
    const ctx = buildContext('<a href="https://other.com/page">外链</a>')
    processor.process(ctx)
    const a = ctx.container.querySelector('a')!
    expect(a.getAttribute('href')).toBe('https://other.com/page')
    expect(a.target).toBe('_blank')
  })

  it('无 href 属性：跳过不处理', () => {
    const ctx = buildContext('<a>纯文本</a>')
    processor.process(ctx)
    const a = ctx.container.querySelector('a')!
    expect(a.target).toBe('')
  })
})
