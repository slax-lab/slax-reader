// IFrameProcessor 单测 —— 第四期 Sprint A.1.1
// 覆盖：宽度 >100 改 100% / 宽度 ≤100 不改 / 无 width 不改 / 容器无 iframe 安全跳过
import { IFrameProcessor } from '~~/app/components/Article/processors/iframe.processor'
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

describe('IFrameProcessor', () => {
  const processor = new IFrameProcessor()

  it('match() 始终返回 true', () => {
    expect(processor.match()).toBe(true)
  })

  it('iframe width=600（>100）：宽度改写为 100%', () => {
    const ctx = buildContext('<iframe width="600" src="https://x.com"></iframe>')
    processor.process(ctx)
    expect(ctx.container.querySelector('iframe')!.getAttribute('width')).toBe('100%')
  })

  it('iframe width=80（≤100）：宽度保持原值', () => {
    const ctx = buildContext('<iframe width="80" src="https://x.com"></iframe>')
    processor.process(ctx)
    expect(ctx.container.querySelector('iframe')!.getAttribute('width')).toBe('80')
  })

  it('iframe 无 width：保持空', () => {
    const ctx = buildContext('<iframe src="https://x.com"></iframe>')
    processor.process(ctx)
    expect(ctx.container.querySelector('iframe')!.getAttribute('width')).toBeNull()
  })

  it('容器无 iframe：不抛错', () => {
    const ctx = buildContext('<p>纯文字</p>')
    expect(() => processor.process(ctx)).not.toThrow()
  })
})
