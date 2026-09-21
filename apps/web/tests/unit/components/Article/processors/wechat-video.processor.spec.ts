// WechatVideoProcessor 单测 —— 第四期 Sprint A.1.1
// 覆盖：单个 mp-common-videosnap 替换 + dataset 透传 / 多个全替换 / 容器无目标 安全跳过 / match=true 始终
import type { WebProcessorContext } from '~~/app/components/Article/processors/types'
import { ArticleStyle } from '~~/app/components/Article/processors/types'
import { WechatVideoProcessor } from '~~/app/components/Article/processors/wechat-video.processor'
import { describe, expect, it, vi } from 'vitest'

const constructorArgs: Array<{ data: Record<string, string | null> }> = []

vi.mock('~~/app/components/Article/CEComponents', () => {
  class FakeWechatVideoInfo extends HTMLElement {
    constructor(props?: { data: Record<string, string | null> }) {
      super()
      if (props) constructorArgs.push(props)
    }
  }
  if (!customElements.get('fake-wechat-video-info')) {
    customElements.define('fake-wechat-video-info', FakeWechatVideoInfo)
  }
  return {
    WechatVideoInfoElement: FakeWechatVideoInfo,
    UnsupportedVideoElement: class {},
    PhotoSwiperDotsElement: class {},
    TweetUserInfoElement: class {},
    TweetFooterInfoElement: class {}
  }
})

function buildContext(html: string): WebProcessorContext {
  const container = document.createElement('div')
  container.innerHTML = html
  return {
    container,
    url: new URL('https://example.com/'),
    articleStyle: ArticleStyle.Default,
    callbacks: { screenLockUpdate: () => {}, showImagePreview: () => {}, websiteClick: () => {} },
    cleanups: []
  }
}

describe('WechatVideoProcessor', () => {
  const processor = new WechatVideoProcessor()

  it('match() 始终返回 true', () => {
    expect(processor.match()).toBe(true)
  })

  it('单个 mp-common-videosnap：替换 + dataset 透传', () => {
    constructorArgs.length = 0
    const ctx = buildContext('<mp-common-videosnap data-url="u1" data-headimgurl="h1" data-nickname="n1" data-desc="d1"></mp-common-videosnap>')
    processor.process(ctx)
    expect(ctx.container.querySelector('mp-common-videosnap')).toBeNull()
    expect(constructorArgs).toHaveLength(1)
    expect(constructorArgs[0]?.data).toEqual({
      url: 'u1',
      headimgurl: 'h1',
      nickname: 'n1',
      desc: 'd1'
    })
  })

  it('多个 mp-common-videosnap：全部替换', () => {
    constructorArgs.length = 0
    const ctx = buildContext('<mp-common-videosnap></mp-common-videosnap><mp-common-videosnap></mp-common-videosnap>')
    processor.process(ctx)
    expect(ctx.container.querySelectorAll('mp-common-videosnap').length).toBe(0)
    expect(constructorArgs.length).toBe(2)
  })

  it('容器无目标元素：不抛错', () => {
    const ctx = buildContext('<p>纯正文</p>')
    expect(() => processor.process(ctx)).not.toThrow()
  })
})
