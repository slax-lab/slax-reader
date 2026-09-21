// ListProcessor 单测 —— 第四期 Sprint A.1.1
// 覆盖：含 li 添加 has-li class / 无 li 不动 / 容器无 ul 安全跳过
import { ListProcessor } from '~~/app/components/Article/processors/list.processor'
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

describe('ListProcessor', () => {
  const processor = new ListProcessor()

  it('match() 始终返回 true', () => {
    expect(processor.match()).toBe(true)
  })

  it('ul 含 li：加 has-li class', () => {
    const ctx = buildContext('<ul><li>项</li></ul>')
    processor.process(ctx)
    expect(ctx.container.querySelector('ul')!.classList.contains('has-li')).toBe(true)
  })

  it('ul 不含 li：不加 has-li class', () => {
    const ctx = buildContext('<ul></ul>')
    processor.process(ctx)
    expect(ctx.container.querySelector('ul')!.classList.contains('has-li')).toBe(false)
  })

  it('容器无 ul：不抛错', () => {
    const ctx = buildContext('<p>纯文字</p>')
    expect(() => processor.process(ctx)).not.toThrow()
  })
})
