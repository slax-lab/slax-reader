// VideoProcessor 单测 —— 第四期 Sprint A.1.1
// 覆盖：xiaohongshu/x.com 域 match=false / 普通域 match=true / video 替换 + posterClick 触发 callbacks.websiteClick / 多个 video 全替换 / 容器无 video 安全跳过
import type { WebProcessorContext } from '~~/app/components/Article/processors/types'
import { ArticleStyle } from '~~/app/components/Article/processors/types'
import { VideoProcessor } from '~~/app/components/Article/processors/video.processor'
import { describe, expect, it, vi } from 'vitest'

vi.mock('~~/app/components/Article/CEComponents', () => {
  // happy-dom 必须先 customElements.define 才能实例化 HTMLElement 子类
  class FakeUnsupportedVideo extends HTMLElement {
    poster?: string
    constructor(props?: { poster?: string | null }) {
      super()
      this.poster = props?.poster ?? undefined
    }
  }
  if (!customElements.get('fake-unsupported-video')) {
    customElements.define('fake-unsupported-video', FakeUnsupportedVideo)
  }
  return {
    UnsupportedVideoElement: FakeUnsupportedVideo,
    WechatVideoInfoElement: class {},
    PhotoSwiperDotsElement: class {},
    TweetUserInfoElement: class {},
    TweetFooterInfoElement: class {}
  }
})

function buildContext(html: string, urlStr = 'https://example.com/'): WebProcessorContext {
  const container = document.createElement('div')
  container.innerHTML = html
  return {
    container,
    url: new URL(urlStr),
    articleStyle: ArticleStyle.Default,
    callbacks: {
      screenLockUpdate: () => {},
      showImagePreview: () => {},
      websiteClick: vi.fn()
    },
    cleanups: []
  }
}

describe('VideoProcessor', () => {
  const processor = new VideoProcessor()

  it('host 含 xiaohongshu.com：match=false', () => {
    expect(processor.match(buildContext('', 'https://xiaohongshu.com/'))).toBe(false)
  })

  it('host 含 x.com：match=false', () => {
    expect(processor.match(buildContext('', 'https://x.com/'))).toBe(false)
  })

  it('普通域：match=true', () => {
    expect(processor.match(buildContext('', 'https://example.com/'))).toBe(true)
  })

  it('单个 video 含 poster：替换为 UnsupportedVideoElement', () => {
    const ctx = buildContext('<video poster="https://example.com/p.png"></video>')
    processor.process(ctx)
    expect(ctx.container.querySelector('video')).toBeNull()
    expect(ctx.container.firstElementChild?.tagName.toLowerCase()).toBe('fake-unsupported-video')
  })

  it('posterClick 触发 callbacks.websiteClick', () => {
    const ctx = buildContext('<video poster="x"></video>')
    processor.process(ctx)
    const replacement = ctx.container.firstElementChild as HTMLElement
    replacement.dispatchEvent(new Event('posterClick'))
    expect(ctx.callbacks.websiteClick).toHaveBeenCalledTimes(1)
  })

  it('多个 video：全部替换', () => {
    const ctx = buildContext('<video poster="a"></video><p>x</p><video></video>')
    processor.process(ctx)
    expect(ctx.container.querySelectorAll('video').length).toBe(0)
    expect(ctx.container.querySelectorAll('fake-unsupported-video').length).toBe(2)
  })

  it('容器无 video：不抛错', () => {
    const ctx = buildContext('<p>纯正文</p>')
    expect(() => processor.process(ctx)).not.toThrow()
  })
})
