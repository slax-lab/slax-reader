// DetailsProcessor 单测 —— 第四期 Sprint A.1.1
// 覆盖：有 summary 时强制展开 / 无 summary 时不动 / 无 details 时安全跳过
import { DetailsProcessor } from '~~/app/components/Article/processors/details.processor'
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

describe('DetailsProcessor', () => {
  const processor = new DetailsProcessor()

  it('match() 始终返回 true', () => {
    expect(processor.match()).toBe(true)
  })

  it('details 含 summary：自动展开（open=true）', () => {
    const ctx = buildContext('<details><summary>标题</summary><p>内容</p></details>')
    processor.process(ctx)
    const details = ctx.container.querySelector('details') as HTMLDetailsElement
    expect(details.open).toBe(true)
  })

  it('details 不含 summary：保持关闭', () => {
    const ctx = buildContext('<details><p>内容</p></details>')
    processor.process(ctx)
    const details = ctx.container.querySelector('details') as HTMLDetailsElement
    expect(details.open).toBe(false)
  })

  it('容器无 details：不抛错', () => {
    const ctx = buildContext('<p>无 details</p>')
    expect(() => processor.process(ctx)).not.toThrow()
  })
})
