// SocialPostProcessor 单测
// 覆盖：仅 SocialPost 风格才 match=true / social-post-header 替换 + dataset 原样透传（string，不 parseInt）/
//       social-post-footer 替换 + 平台指标透传 / 缺省字段保持 undefined（不落 0）/ 容器无目标安全跳过
import { SocialPostProcessor } from '~~/app/components/Article/processors/social-post.processor'
import type { WebProcessorContext } from '~~/app/components/Article/processors/types'
import { ArticleStyle } from '~~/app/components/Article/processors/types'
import { describe, expect, it, vi } from 'vitest'

const userArgs: Array<Record<string, unknown>> = []
const footerArgs: Array<Record<string, unknown>> = []

vi.mock('~~/app/components/Article/CEComponents', () => {
  class FakeSocialPostUserInfo extends HTMLElement {
    constructor(props?: Record<string, unknown>) {
      super()
      if (props) userArgs.push(props)
    }
  }
  class FakeSocialPostFooterInfo extends HTMLElement {
    constructor(props?: Record<string, unknown>) {
      super()
      if (props) footerArgs.push(props)
    }
  }
  if (!customElements.get('fake-social-post-user-info')) {
    customElements.define('fake-social-post-user-info', FakeSocialPostUserInfo)
  }
  if (!customElements.get('fake-social-post-footer-info')) {
    customElements.define('fake-social-post-footer-info', FakeSocialPostFooterInfo)
  }
  return {
    SocialPostUserInfoElement: FakeSocialPostUserInfo,
    SocialPostFooterInfoElement: FakeSocialPostFooterInfo,
    TweetUserInfoElement: class {},
    TweetFooterInfoElement: class {},
    UnsupportedVideoElement: class {},
    WechatVideoInfoElement: class {},
    PhotoSwiperDotsElement: class {}
  }
})

function buildContext(html: string, articleStyle = ArticleStyle.SocialPost): WebProcessorContext {
  const container = document.createElement('div')
  container.innerHTML = html
  return {
    container,
    url: new URL('https://example.com/'),
    articleStyle,
    callbacks: { screenLockUpdate: () => {}, showImagePreview: () => {}, websiteClick: () => {} },
    cleanups: []
  }
}

describe('SocialPostProcessor', () => {
  const processor = new SocialPostProcessor()

  it('articleStyle=SocialPost：match=true', () => {
    expect(processor.match(buildContext('', ArticleStyle.SocialPost))).toBe(true)
  })

  it('articleStyle=Twitter：match=false（不与 Twitter 抢路）', () => {
    expect(processor.match(buildContext('', ArticleStyle.Twitter))).toBe(false)
  })

  it('social-post-header 替换 + dataset 原样透传（string）+ 缺省字段保持 undefined', () => {
    userArgs.length = 0
    const ctx = buildContext(
      '<social-post-header data-platform="weibo" data-avatar="a" data-name="N" data-screen-name="sn" data-location="loc" data-created-at="c" data-followers="123" data-verified="true"></social-post-header>'
    )
    processor.process(ctx)
    expect(ctx.container.querySelector('social-post-header')).toBeNull()
    expect(userArgs).toHaveLength(1)
    expect(userArgs[0]).toMatchObject({
      platform: 'weibo',
      avatar: 'a',
      name: 'N',
      screenName: 'sn',
      location: 'loc',
      createdAt: 'c',
      followers: '123', // 原样 string，不做 parseInt
      verified: 'true'
    })
    // 未提供的字段应为 undefined，而非 0/空串
    expect(userArgs[0]!.followings).toBeUndefined()
    expect(userArgs[0]!.description).toBeUndefined()
    expect(userArgs[0]!.website).toBeUndefined()
  })

  it('social-post-footer 替换 + 平台指标透传（Reddit 仅 score/comment/link）', () => {
    footerArgs.length = 0
    const ctx = buildContext('<social-post-footer data-platform="reddit" data-score="42" data-comment-count="5" data-reddit-link="https://reddit.com/x"></social-post-footer>')
    processor.process(ctx)
    expect(ctx.container.querySelector('social-post-footer')).toBeNull()
    expect(footerArgs[0]).toMatchObject({
      platform: 'reddit',
      score: '42',
      commentCount: '5',
      redditLink: 'https://reddit.com/x'
    })
    // Reddit 无转发/点赞/分享
    expect(footerArgs[0]!.repostCount).toBeUndefined()
    expect(footerArgs[0]!.likeCount).toBeUndefined()
    expect(footerArgs[0]!.shareCount).toBeUndefined()
  })

  it('容器无 social-post-header / social-post-footer：不抛错', () => {
    const ctx = buildContext('<p>正文</p>')
    expect(() => processor.process(ctx)).not.toThrow()
  })
})
