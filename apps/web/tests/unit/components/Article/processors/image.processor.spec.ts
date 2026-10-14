// ImageProcessor 单测 —— 第四期 Sprint A.1.1
// 覆盖：unwrapImgAnchorsInTweet（tweet 容器内剥离 a 包裹）/ 非 tweet 不剥离 / 无 src 隐藏 /
//      onload PhotoSwipeTopic 分支不调样式 / onload 默认风格小图隐藏 / 中等宽度限制 / 大图设 padding 0 + height auto /
//      onclick 触发 screenLock + showImagePreview + dismissHandler 解锁 / onerror 隐藏 / parent 全 img 时设置 cssFloat:none / parent 含非 img 时不设
import { ImageProcessor } from '~~/app/components/Article/processors/image.processor'
import type { WebProcessorContext } from '~~/app/components/Article/processors/types'
import { ArticleStyle } from '~~/app/components/Article/processors/types'
import { afterEach, describe, expect, it, vi } from 'vitest'

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

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

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

  it.each([48, 96, 199, 200, 500])('preserves a 14px WeChat icon after loading a %ipx asset', naturalWidth => {
    const ctx = buildContext(
      '<section><img src="https://mmbiz.qpic.cn/icon.png" style="width:14px !important;max-width:100% !important;height:auto !important;vertical-align:middle"></section>',
      ArticleStyle.Default,
      new URL('https://mp.weixin.qq.com/s/xxx')
    )
    const img = ctx.container.querySelector('img')!
    processor.process(ctx)
    expect(img.style.width).toBe('14px')
    setNaturalSize(img, naturalWidth, naturalWidth)
    img.onload?.(new Event('load'))
    expect(img.style.width).toBe('14px')
    expect(img.style.height).toBe('auto')
    expect(img.style.maxWidth).toBe('100%')
    expect(img.style.verticalAlign).toBe('middle')
  })

  it('preserves height-only WeChat icons after loading', () => {
    const ctx = buildContext(
      '<img src="https://mmbiz.qpic.cn/icon.png" style="width:auto !important;height:24px !important;vertical-align:middle">',
      ArticleStyle.Default,
      new URL('https://mp.weixin.qq.com/s/xxx')
    )
    const img = ctx.container.querySelector('img')!
    processor.process(ctx)
    setNaturalSize(img, 96, 96)
    img.onload?.(new Event('load'))
    expect(img.style.width).toBe('auto')
    expect(img.style.height).toBe('24px')
    expect(img.style.verticalAlign).toBe('middle')
  })

  it.each(['height:auto', 'height:auto;max-width:100%'])('retains the intrinsic-width fallback without a WeChat display size: %s', style => {
    const ctx = buildContext(`<img src="https://mmbiz.qpic.cn/icon.png" style="${style}">`, ArticleStyle.Default, new URL('https://mp.weixin.qq.com/s/xxx'))
    const img = ctx.container.querySelector('img')!
    processor.process(ctx)
    setNaturalSize(img, 96, 96)
    img.onload?.(new Event('load'))
    expect(img.style.width).toBe('96px')
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

  it('makes oversized WeChat images responsive before loading and preserves other styles after loading', () => {
    const ctx = buildContext(
      '<img loading="lazy" src="https://mmbiz.qpic.cn/i.png" style="width: 2490px !important; height: 1148px !important; margin: 0 auto; border-radius: 8px;">',
      ArticleStyle.Default,
      new URL('https://mp.weixin.qq.com/s/xxx')
    )
    Object.defineProperty(ctx.container, 'clientWidth', { value: 772 })
    const img = ctx.container.querySelector('img')!
    processor.process(ctx)

    expect(img.style.width).toBe('100%')
    expect(img.style.height).toBe('auto')
    expect(img.style.getPropertyPriority('width')).toBe('important')
    expect(img.style.getPropertyPriority('height')).toBe('important')
    expect(img.style.margin).toBe('0px auto')
    expect(img.style.borderRadius).toBe('8px')

    setNaturalSize(img, 1080, 498)
    img.onload?.(new Event('load'))
    expect(img.style.width).toBe('100%')
    expect(img.style.height).toBe('auto')
    ctx.cleanups.forEach(cleanup => cleanup())
  })

  it.each(['cover', 'contain', 'none', 'scale-down'])('preserves an explicit WeChat %s frame instead of applying proportional resizing', objectFit => {
    const ctx = buildContext(
      `<img src="https://mmbiz.qpic.cn/crop.png" style="width:800px !important;height:100px !important;max-width:100% !important;object-fit:${objectFit}">`,
      ArticleStyle.Default,
      new URL('https://mp.weixin.qq.com/s/xxx')
    )
    Object.defineProperty(ctx.container, 'clientWidth', { value: 360 })
    const img = ctx.container.querySelector('img')!
    processor.process(ctx)
    setNaturalSize(img, 800, 800)
    img.onload?.(new Event('load'))
    expect(img.style.height).toBe('100px')
    expect(img.style.width).toBe('800px')
    expect(img.style.objectFit).toBe(objectFit)
    ctx.cleanups.forEach(cleanup => cleanup())
  })

  it.each(['max-width', 'max-height'])('preserves a WeChat icon constrained only by %s', property => {
    const ctx = buildContext(
      `<img src="https://mmbiz.qpic.cn/icon.png" style="${property}:14px !important;vertical-align:middle">`,
      ArticleStyle.Default,
      new URL('https://mp.weixin.qq.com/s/xxx')
    )
    const img = ctx.container.querySelector('img')!
    processor.process(ctx)
    setNaturalSize(img, 96, 96)
    img.onload?.(new Event('load'))
    expect(img.style.getPropertyValue(property)).toBe('14px')
    expect(img.style.width).not.toBe('96px')
    expect(img.style.verticalAlign).toBe('middle')
  })

  it.each([
    ['small icons', 'width: 24px !important; height: 24px !important;'],
    ['fitting images', 'width: 600px !important; height: 300px !important;'],
    ['percentage widths', 'width: 100%; height: 300px;'],
    ['automatic heights', 'width: 2490px; height: auto;']
  ])('preserves dimensions for WeChat images with %s', (_, style) => {
    const ctx = buildContext(`<img src="https://mmbiz.qpic.cn/i.png" style="${style}">`, ArticleStyle.Default, new URL('https://mp.weixin.qq.com/s/xxx'))
    Object.defineProperty(ctx.container, 'clientWidth', { value: 772 })
    const img = ctx.container.querySelector('img')!
    const originalWidth = img.style.width
    const originalHeight = img.style.height

    processor.process(ctx)
    // A high-resolution source may intentionally render as a 24px icon.
    setNaturalSize(img, 1080, 540)
    img.onload?.(new Event('load'))
    expect(img.style.width).toBe(originalWidth)
    expect(img.style.height).toBe(originalHeight)
    ctx.cleanups.forEach(cleanup => cleanup())
  })

  it.each([0, 772])('adapts fixed-size WeChat images from a container width of %ipx and disconnects on cleanup', initialWidth => {
    const disconnect = vi.fn()
    const observe = vi.fn()
    let onResize: () => void = () => {}
    let onFrame: FrameRequestCallback = () => {}
    const requestFrame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
      onFrame = callback
      return 42
    })
    const cancelFrame = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          onResize = callback
        }
        observe = observe
        disconnect = disconnect
      }
    )
    const ctx = buildContext('<img src="https://mmbiz.qpic.cn/i.png" style="width: 600px; height: 300px;">', ArticleStyle.Default, new URL('https://mp.weixin.qq.com/s/xxx'))
    let containerWidth = initialWidth
    Object.defineProperty(ctx.container, 'clientWidth', {
      get: () => containerWidth
    })
    const img = ctx.container.querySelector('img')!
    processor.process(ctx)
    expect(img.style.width).toBe('600px')
    expect(img.style.height).toBe('300px')
    expect(observe).toHaveBeenCalledExactlyOnceWith(ctx.container)

    containerWidth = 360
    onResize()
    onResize()
    expect(requestFrame).toHaveBeenCalledOnce()
    expect(img.style.width).toBe('600px')
    onFrame(0)
    expect(img.style.width).toBe('100%')
    expect(img.style.height).toBe('auto')

    containerWidth = 900
    onResize()
    onFrame(0)
    expect(img.style.width).toBe('100%')
    expect(img.style.height).toBe('auto')
    onResize()
    ctx.cleanups.forEach(cleanup => cleanup())
    expect(disconnect).toHaveBeenCalledOnce()
    expect(cancelFrame).toHaveBeenCalledExactlyOnceWith(42)
  })

  it('corrects oversized WeChat images without ResizeObserver', () => {
    vi.stubGlobal('ResizeObserver', undefined)
    const ctx = buildContext('<img src="https://mmbiz.qpic.cn/i.png" style="width: 2490px; height: 1148px;">', ArticleStyle.Default, new URL('https://mp.weixin.qq.com/s/xxx'))
    Object.defineProperty(ctx.container, 'clientWidth', { value: 772 })
    const img = ctx.container.querySelector('img')!

    expect(() => processor.process(ctx)).not.toThrow()
    expect(img.style.width).toBe('100%')
    expect(img.style.height).toBe('auto')
    expect(ctx.cleanups).toHaveLength(0)
  })

  it.each([
    ['non-WeChat articles', ArticleStyle.Default, 'https://example.com/'],
    ['WeChat PhotoSwipe articles', ArticleStyle.PhotoSwipeTopic, 'https://mp.weixin.qq.com/s/xxx']
  ])('does not apply responsive sizing to %s', (_, articleStyle, url) => {
    const observer = vi.fn()
    vi.stubGlobal('ResizeObserver', observer)
    const ctx = buildContext('<img src="https://example.com/i.png" style="width: 2490px; height: 1148px;">', articleStyle as ArticleStyle, new URL(url))
    Object.defineProperty(ctx.container, 'clientWidth', { value: 772 })
    const img = ctx.container.querySelector('img')!

    processor.process(ctx)
    expect(img.style.width).toBe('2490px')
    expect(img.style.height).toBe('1148px')
    expect(observer).not.toHaveBeenCalled()
    expect(ctx.cleanups).toHaveLength(0)

    setNaturalSize(img, 1080, 498)
    img.onload?.(new Event('load'))
    expect(img.style.width).toBe(articleStyle === ArticleStyle.PhotoSwipeTopic ? '2490px' : '')
    expect(img.style.height).toBe(articleStyle === ArticleStyle.PhotoSwipeTopic ? '1148px' : 'auto')
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
