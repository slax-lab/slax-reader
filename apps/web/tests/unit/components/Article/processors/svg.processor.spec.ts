// SvgProcessor 单测 —— 第四期 Sprint A.1.1
// 覆盖：path 不足 10 隐藏 / 无 viewBox 早返 / 尺寸过小隐藏 / 正常尺寸设宽高样式 / 无 svg 安全跳过
import { SvgProcessor } from '~~/app/components/Article/processors/svg.processor'
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

function pathTags(count: number): string {
  return Array.from({ length: count }, () => '<path d="M0 0"/>').join('')
}

describe('SvgProcessor', () => {
  const processor = new SvgProcessor()

  it('match() 始终返回 true', () => {
    expect(processor.match()).toBe(true)
  })

  it('path 数量 <10：隐藏', () => {
    const ctx = buildContext(`<svg viewBox="0 0 100 100">${pathTags(3)}</svg>`)
    processor.process(ctx)
    expect(ctx.container.querySelector('svg')!.getAttribute('style')).toBe('display: none;')
  })

  it('path ≥10 且无 viewBox：早返不修改 style', () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    for (let i = 0; i < 12; i++) {
      svg.appendChild(document.createElementNS('http://www.w3.org/2000/svg', 'path'))
    }
    Object.defineProperty(svg, 'viewBox', { value: undefined, configurable: true })
    const container = document.createElement('div')
    container.appendChild(svg)
    const ctx: WebProcessorContext = {
      container,
      url: new URL('https://example.com/'),
      articleStyle: ArticleStyle.Default,
      callbacks: { screenLockUpdate: () => {}, showImagePreview: () => {}, websiteClick: () => {} },
      cleanups: []
    }
    processor.process(ctx)
    expect(svg.getAttribute('style')).toBeNull()
  })

  it('path ≥10 且 width/height <5：隐藏', () => {
    const ctx = buildContext(`<svg viewBox="0 0 4 4">${pathTags(11)}</svg>`)
    processor.process(ctx)
    expect(ctx.container.querySelector('svg')!.getAttribute('style')).toBe('display: none;')
  })

  it('path ≥10 且尺寸正常：设置宽高 style', () => {
    const ctx = buildContext(`<svg viewBox="0 0 200 100">${pathTags(11)}</svg>`)
    processor.process(ctx)
    const style = ctx.container.querySelector('svg')!.getAttribute('style')!
    expect(style).toContain('width: 200px !important')
    expect(style).toContain('height: 100px !important')
  })

  it('容器无 svg：不抛错', () => {
    const ctx = buildContext('<p>纯文字</p>')
    expect(() => processor.process(ctx)).not.toThrow()
  })
})
