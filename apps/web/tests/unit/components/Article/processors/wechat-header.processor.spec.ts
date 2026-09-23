// WechatHeaderProcessor 单测 —— 第四期 Sprint A.1.1
// 覆盖：非微信域跳过 / meta_content_hide_info 命中 + 首链 p 隐藏 / fallback profileBt 隐藏 /
//      fallback copyright_logo 隐藏 / span 在嵌套 div 但仍是首链 / span 不在首链不隐藏 / 容器无目标元素跳过
import type { WebProcessorContext } from '~~/app/components/Article/processors/types'
import { ArticleStyle } from '~~/app/components/Article/processors/types'
import { WechatHeaderProcessor } from '~~/app/components/Article/processors/wechat-header.processor'
import { describe, expect, it } from 'vitest'

function buildContext(bodyInnerHTML: string, urlStr = 'https://mp.weixin.qq.com/s/abc'): WebProcessorContext {
  // 用 body 当 container 模拟真实页面（isFirstElementChain 一直爬到 body）
  const body = document.createElement('body')
  body.innerHTML = bodyInnerHTML
  return {
    container: body,
    url: new URL(urlStr),
    articleStyle: ArticleStyle.Default,
    callbacks: { screenLockUpdate: () => {}, showImagePreview: () => {}, websiteClick: () => {} },
    cleanups: []
  }
}

describe('WechatHeaderProcessor', () => {
  const processor = new WechatHeaderProcessor()

  it('match() 仅在 mp.weixin.qq.com 返回 true', () => {
    expect(processor.match(buildContext('', 'https://mp.weixin.qq.com/s/x'))).toBe(true)
    expect(processor.match(buildContext('', 'https://example.com/'))).toBe(false)
  })

  it('meta_content_hide_info 命中：所属 p 在首链时被隐藏', () => {
    const ctx = buildContext('<p><span id="meta_content_hide_info">meta</span></p><p>正文</p>')
    processor.process(ctx)
    const ps = ctx.container.querySelectorAll('p')
    expect((ps[0] as HTMLElement).style.display).toBe('none')
    expect((ps[1] as HTMLElement).style.display).not.toBe('none')
  })

  it('meta_content_hide_info 命中后跳过 fallback 检查', () => {
    const ctx = buildContext('<p><span id="meta_content_hide_info">meta</span></p><p><span id="profileBt">bt</span></p>')
    processor.process(ctx)
    const ps = ctx.container.querySelectorAll('p')
    // meta 所在 p 隐藏，profileBt 那条不应再处理（return 早出）
    expect((ps[0] as HTMLElement).style.display).toBe('none')
    expect((ps[1] as HTMLElement).style.display).not.toBe('none')
  })

  it('fallback profileBt：所属 p 隐藏', () => {
    const ctx = buildContext('<p><span id="profileBt">bt</span></p>')
    processor.process(ctx)
    expect((ctx.container.querySelector('p') as HTMLElement).style.display).toBe('none')
  })

  it('fallback copyright_logo：所属 p 隐藏', () => {
    const ctx = buildContext('<p><span id="copyright_logo">logo</span></p>')
    processor.process(ctx)
    expect((ctx.container.querySelector('p') as HTMLElement).style.display).toBe('none')
  })

  it('span 嵌套在 html-text div 内但仍是首链：所属 p 隐藏', () => {
    const ctx = buildContext('<div class="html-text"><p><span id="profileBt">bt</span></p><p>第二段</p></div>')
    processor.process(ctx)
    const ps = ctx.container.querySelectorAll('p')
    expect((ps[0] as HTMLElement).style.display).toBe('none')
    expect((ps[1] as HTMLElement).style.display).not.toBe('none')
  })

  it('span 不在首链：所属 p 不隐藏', () => {
    const ctx = buildContext('<p>第一段</p><p><span id="profileBt">bt</span></p>')
    processor.process(ctx)
    const ps = ctx.container.querySelectorAll('p')
    expect((ps[1] as HTMLElement).style.display).not.toBe('none')
  })

  it('容器无目标元素：不抛错', () => {
    const ctx = buildContext('<p>纯正文</p>')
    expect(() => processor.process(ctx)).not.toThrow()
  })
})
