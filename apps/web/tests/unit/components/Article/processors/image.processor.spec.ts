// ImageProcessor 单测 —— 第四期 Sprint A.1.1
// 覆盖：unwrapImgAnchorsInTweet（tweet 容器内剥离 a 包裹）/ 非 tweet 不剥离 / 无 src 隐藏 /
//      onload PhotoSwipeTopic 分支不调样式 / onload 默认风格小图隐藏 / 中等宽度限制 / 大图设 padding 0 + height auto /
//      onclick 触发 screenLock + showImagePreview + dismissHandler 解锁 / onerror 隐藏 / parent 全 img 时设置 cssFloat:none / parent 含非 img 时不设
import { ImageProcessor } from '~~/app/components/Article/processors/image.processor'
import type { WebProcessorContext } from '~~/app/components/Article/processors/types'
import { ArticleStyle } from '~~/app/components/Article/processors/types'
import { describe, expect, it, vi } from 'vitest'

function buildContext(html: string, articleStyle = ArticleStyle.Default, url = new URL('https://example.com/')): WebProcessorContext {
  const container = document.createElement('div')
  container.innerHTML = html
  return {
    container,
    url,
    articleStyle,
    callbacks: {
      screenLockUpdate: vi.fn(),
      showImagePreview: vi.fn(),
      websiteClick: vi.fn()
    },
    cleanups: []
  }
}

function setNaturalSize(img: HTMLImageElement, w: number, h: number) {
  Object.defineProperty(img, 'naturalWidth', { value: w, configurable: true })
  Object.defineProperty(img, 'naturalHeight', { value: h, configurable: true })
}

describe('ImageProcessor', () => {
  const processor = new ImageProcessor()

  it('match() 始终返回 true', () => {
    expect(processor.match()).toBe(true)
  })

  it('tweet 容器：a > img 被剥离，img 留在原 a 父节点上', () => {
    const ctx = buildContext('<div class="html-text"><div class="tweet"><a href="https://x.com"><img src="https://x.com/i.png"></a></div></div>')
    processor.process(ctx)
    expect(ctx.container.querySelector('a')).toBeNull()
    expect(ctx.container.querySelector('img')).not.toBeNull()
  })

  it('非 tweet 容器：a > img 保留', () => {
    const ctx = buildContext('<div class="html-text"><div class="post"><a href="https://x.com"><img src="https://x.com/i.png"></a></div></div>')
    processor.process(ctx)
    expect(ctx.container.querySelector('a img')).not.toBeNull()
  })

  it('img 无 src：display:none 早返不挂 onload', () => {
    const ctx = buildContext('<img>')
    const img = ctx.container.querySelector('img') as HTMLImageElement
    processor.process(ctx)
    expect(img.style.display).toBe('none')
    expect(img.onload).toBeFalsy()
  })

  it('img 有 src：onload 处理小图（<5）隐藏', () => {
    const ctx = buildContext('<img src="https://x.com/i.png">')
    const img = ctx.container.querySelector('img') as HTMLImageElement
    processor.process(ctx)
    setNaturalSize(img, 4, 4)
    img.onload?.(new Event('load'))
    expect(img.getAttribute('style')).toContain('display: none')
  })

  it('img onload 中等宽度（<200）：以原 width 设样式', () => {
    const ctx = buildContext('<img src="https://x.com/i.png">')
    const img = ctx.container.querySelector('img') as HTMLImageElement
    processor.process(ctx)
    setNaturalSize(img, 150, 150)
    img.onload?.(new Event('load'))
    expect(img.getAttribute('style')).toContain('width: 150px !important')
  })

  it('img onload 大图：设 height auto + padding 0 + onclick 触发回调', () => {
    const ctx = buildContext('<img src="https://x.com/i.png">')
    const img = ctx.container.querySelector('img') as HTMLImageElement
    processor.process(ctx)
    setNaturalSize(img, 800, 400)
    img.onload?.(new Event('load'))
    expect(img.getAttribute('style')).toContain('height: auto')
    expect(img.getAttribute('style')).toContain('padding: 0')

    expect(img.onclick).not.toBeNull()
    img.onclick!.call(img, new MouseEvent('click') as unknown as PointerEvent)
    expect(ctx.callbacks.screenLockUpdate).toHaveBeenCalledWith(true)
    expect(ctx.callbacks.showImagePreview).toHaveBeenCalledTimes(1)

    const previewArg = (ctx.callbacks.showImagePreview as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      url: string
      dismissHandler: () => void
    }
    previewArg.dismissHandler()
    expect(ctx.callbacks.screenLockUpdate).toHaveBeenLastCalledWith(false)
  })

  it('微信文章大图：保留原始 style，且在缺失 padding/height 时基于原样式补齐（非覆盖）', () => {
    const ctx = buildContext(
      '<p><span>x</span><img src="https://mmbiz.qpic.cn/i.png" style="vertical-align: middle;max-width: 100%;width: 100%;box-sizing: border-box;"></p>',
      ArticleStyle.Default,
      new URL('https://mp.weixin.qq.com/s/xxx')
    )
    const img = ctx.container.querySelector('img') as HTMLImageElement
    processor.process(ctx)
    setNaturalSize(img, 800, 400)
    img.onload?.(new Event('load'))
    // 原始声明保留
    expect(img.getAttribute('style')).toContain('vertical-align: middle')
    expect(img.getAttribute('style')).toContain('max-width: 100%')
    // 原样式缺 padding/height，补齐上去
    expect(img.getAttribute('style')).toContain('padding: 0 !important')
    expect(img.getAttribute('style')).toContain('height: auto !important')
  })

  it('微信文章大图：原样式已带 height，不覆盖其值，只补齐缺失的 padding', () => {
    const ctx = buildContext('<p><span>x</span><img src="https://mmbiz.qpic.cn/i.png" style="height: 300px;"></p>', ArticleStyle.Default, new URL('https://mp.weixin.qq.com/s/xxx'))
    const img = ctx.container.querySelector('img') as HTMLImageElement
    processor.process(ctx)
    setNaturalSize(img, 800, 400)
    img.onload?.(new Event('load'))
    expect(img.getAttribute('style')).toContain('height: 300px')
    expect(img.getAttribute('style')).not.toContain('height: auto')
    expect(img.getAttribute('style')).toContain('padding: 0 !important')
  })

  it('微信文章大图：原样式已带 padding + height，原样保留不追加', () => {
    const originalStyle = 'padding: 4px; height: 300px;'
    const ctx = buildContext(
      `<p><span>x</span><img src="https://mmbiz.qpic.cn/i.png" style="${originalStyle}"></p>`,
      ArticleStyle.Default,
      new URL('https://mp.weixin.qq.com/s/xxx')
    )
    const img = ctx.container.querySelector('img') as HTMLImageElement
    processor.process(ctx)
    setNaturalSize(img, 800, 400)
    img.onload?.(new Event('load'))
    expect(img.getAttribute('style')).toBe(originalStyle)
  })

  it('非微信文章大图：仍覆盖为 padding/height（默认行为不受白名单影响）', () => {
    const ctx = buildContext('<p><span>x</span><img src="https://x.com/i.png" style="vertical-align: middle;"></p>')
    const img = ctx.container.querySelector('img') as HTMLImageElement
    processor.process(ctx)
    setNaturalSize(img, 800, 400)
    img.onload?.(new Event('load'))
    expect(img.getAttribute('style')).toContain('height: auto')
    expect(img.getAttribute('style')).toContain('padding: 0')
    expect(img.getAttribute('style')).not.toContain('vertical-align')
  })

  it('img onload PhotoSwipeTopic 风格：跳过尺寸调整分支', () => {
    const ctx = buildContext('<img src="https://x.com/i.png">', ArticleStyle.PhotoSwipeTopic)
    const img = ctx.container.querySelector('img') as HTMLImageElement
    processor.process(ctx)
    setNaturalSize(img, 4, 4)
    expect(() => img.onload?.(new Event('load'))).not.toThrow()
  })

  it('img onerror：移除 loading class + 隐藏', () => {
    const ctx = buildContext('<img src="https://x.com/i.png">')
    const img = ctx.container.querySelector('img') as HTMLImageElement
    processor.process(ctx)
    img.classList.add('slax-image-loading')
    img.onerror?.(new Event('error'))
    expect(img.classList.contains('slax-image-loading')).toBe(false)
    expect(img.style.display).toBe('none')
  })

  it('parent 全 img：cssFloat 设为 none', () => {
    const ctx = buildContext('<p><img src="https://x.com/a"><img src="https://x.com/b"></p>')
    processor.process(ctx)
    const imgs = Array.from(ctx.container.querySelectorAll('img')) as HTMLImageElement[]
    imgs.forEach(img => {
      expect(img.style.cssFloat).toBe('none')
    })
  })

  it('parent 含非 img element：不设 cssFloat', () => {
    // 源码逻辑：parent 全部 element 子节点必须是 img；text node 不参与判断
    const ctx = buildContext('<p><span>x</span><img src="https://x.com/a"></p>')
    processor.process(ctx)
    const img = ctx.container.querySelector('img') as HTMLImageElement
    expect(img.style.cssFloat).toBe('')
  })
})
