import { describe, test, expect } from 'vitest'
import {
  detectRoute,
  isSocialMediaRoute,
  isSocialMediaUrl,
  needsResolve,
  TWITTER_STATUS_RE,
  TWITTER_ARTICLE_RE,
  TWITTER_SHORT_STATUS_RE,
  XHS_RE,
  WEIBO_DESKTOP_RE,
  WEIBO_MOBILE_RE,
  REDDIT_RE,
  WECHAT_MP_RE,
  type RouteKind
} from '@/utils/platformDetector'

describe('detectRoute', () => {
  test('detects Twitter status URLs', () => {
    expect(detectRoute('https://x.com/elonmusk/status/1234567890')).toBe('twitter')
    expect(detectRoute('https://twitter.com/jack/status/9999')).toBe('twitter')
    expect(detectRoute('https://www.x.com/user/status/111')).toBe('twitter')
  })

  test('detects Twitter article URLs (takes priority over status)', () => {
    expect(detectRoute('https://x.com/user/article/1234567890')).toBe('twitter_article')
    expect(detectRoute('https://twitter.com/user/article/999')).toBe('twitter_article')
  })

  test('detects Xiaohongshu URLs', () => {
    expect(detectRoute('https://www.xiaohongshu.com/explore/abc123')).toBe('xhs')
    expect(detectRoute('https://xiaohongshu.com/discovery/def456')).toBe('xhs')
  })

  test('detects Weibo desktop URLs', () => {
    expect(detectRoute('https://weibo.com/1234567890/abcDEF123')).toBe('weibo')
    expect(detectRoute('https://www.weibo.com/9876543210/xyz789')).toBe('weibo')
  })

  test('detects Weibo mobile URLs', () => {
    expect(detectRoute('https://m.weibo.cn/status/1234567890')).toBe('weibo')
    expect(detectRoute('https://m.weibo.cn/detail/9876543210')).toBe('weibo')
  })

  test('detects Reddit URLs', () => {
    expect(detectRoute('https://www.reddit.com/r/programming/comments/abc123/some_post')).toBe('reddit')
    expect(detectRoute('https://reddit.com/r/javascript/comments/xyz789/')).toBe('reddit')
  })

  test('detects Zhihu public content URLs', () => {
    expect(detectRoute('https://www.zhihu.com/question/123')).toBe('zhihu')
    expect(detectRoute('https://www.zhihu.com/question/123/answer/456')).toBe('zhihu')
    expect(detectRoute('https://zhuanlan.zhihu.com/p/789')).toBe('zhihu')
    expect(detectRoute('https://www.zhihu.com/pin/789')).toBe('zhihu')
  })

  test('detects bare Zhihu answer URLs（无 question 前缀）', () => {
    expect(detectRoute('https://www.zhihu.com/answer/2076739289451386172')).toBe('zhihu')
    expect(detectRoute('https://zhihu.com/answer/456')).toBe('zhihu')
  })

  test('detects WeChat MP (weixin) URLs — 覆盖 /s?__biz 与 /s/ 两种形态', () => {
    expect(detectRoute('https://mp.weixin.qq.com/s?__biz=MzA3MDg5NjYyOA==&mid=12345')).toBe('weixin')
    expect(detectRoute('https://mp.weixin.qq.com/s/9ah07EszDPvzO6zlbWwoUA')).toBe('weixin')
  })

  test('returns regular for non-social-media URLs', () => {
    expect(detectRoute('https://example.com/article/123')).toBe('regular')
    expect(detectRoute('https://github.com/user/repo')).toBe('regular')
    expect(detectRoute('https://news.ycombinator.com/item?id=123')).toBe('regular')
  })

  test('returns regular for partial matches that do not satisfy the full pattern', () => {
    expect(detectRoute('https://x.com/user/likes')).toBe('regular')
    expect(detectRoute('https://reddit.com/r/programming/')).toBe('regular')
    expect(detectRoute('https://www.zhihu.com/answer/')).toBe('regular')
    expect(detectRoute('https://www.zhihu.com/people/someone')).toBe('regular')
  })
})

describe('isSocialMediaRoute', () => {
  test('returns true for social media routes', () => {
    const socialRoutes: RouteKind[] = ['twitter', 'twitter_article', 'xhs', 'weibo', 'reddit', 'zhihu']
    for (const route of socialRoutes) {
      expect(isSocialMediaRoute(route)).toBe(true)
    }
  })

  test('returns false for non-social media routes', () => {
    expect(isSocialMediaRoute('regular')).toBe(false)
    expect(isSocialMediaRoute('weixin')).toBe(false)
  })
})

describe('isSocialMediaUrl', () => {
  test('matches social media domains', () => {
    expect(isSocialMediaUrl('https://x.com/anything')).toBe(true)
    expect(isSocialMediaUrl('https://twitter.com/anything')).toBe(true)
    expect(isSocialMediaUrl('https://xiaohongshu.com/explore/123')).toBe(true)
    expect(isSocialMediaUrl('https://weibo.com/123/abc')).toBe(true)
    expect(isSocialMediaUrl('https://reddit.com/r/test/comments/123/')).toBe(true)
    expect(isSocialMediaUrl('https://www.zhihu.com/question/123')).toBe(true)
    expect(isSocialMediaUrl('https://zhuanlan.zhihu.com/p/123')).toBe(true)
  })

  test('does not match non-social-media domains', () => {
    expect(isSocialMediaUrl('https://example.com')).toBe(false)
    expect(isSocialMediaUrl('https://mp.weixin.qq.com/s?__biz=123')).toBe(false)
    expect(isSocialMediaUrl('https://github.com')).toBe(false)
  })
})

describe('needsResolve', () => {
  test('returns true for Twitter short status URLs', () => {
    expect(needsResolve('https://x.com/i/status/1234567890')).toBe(true)
    expect(needsResolve('https://twitter.com/i/status/9999')).toBe(true)
  })

  test('returns false for normal Twitter URLs', () => {
    expect(needsResolve('https://x.com/elonmusk/status/1234567890')).toBe(false)
  })

  test('returns false for non-Twitter URLs', () => {
    expect(needsResolve('https://example.com')).toBe(false)
    expect(needsResolve('https://t.co/abc123')).toBe(false)
  })
})

describe('regex patterns', () => {
  test('TWITTER_STATUS_RE matches valid tweet URLs', () => {
    expect(TWITTER_STATUS_RE.test('https://x.com/user/status/123')).toBe(true)
    expect(TWITTER_STATUS_RE.test('https://twitter.com/user/status/456')).toBe(true)
    expect(TWITTER_STATUS_RE.test('https://x.com/user/likes')).toBe(false)
  })

  test('TWITTER_ARTICLE_RE matches article URLs', () => {
    expect(TWITTER_ARTICLE_RE.test('https://x.com/user/article/123')).toBe(true)
    expect(TWITTER_ARTICLE_RE.test('https://x.com/user/status/123')).toBe(false)
  })

  test('TWITTER_SHORT_STATUS_RE matches /i/status/ pattern', () => {
    expect(TWITTER_SHORT_STATUS_RE.test('https://x.com/i/status/123')).toBe(true)
    expect(TWITTER_SHORT_STATUS_RE.test('https://x.com/user/status/123')).toBe(false)
  })

  test('XHS_RE matches explore and discovery paths', () => {
    expect(XHS_RE.test('https://www.xiaohongshu.com/explore/abc123')).toBe(true)
    expect(XHS_RE.test('https://xiaohongshu.com/discovery/def456')).toBe(true)
    expect(XHS_RE.test('https://xiaohongshu.com/user/profile')).toBe(false)
  })

  test('WEIBO_DESKTOP_RE matches desktop weibo URLs', () => {
    expect(WEIBO_DESKTOP_RE.test('https://weibo.com/1234567890/abcDEF')).toBe(true)
    expect(WEIBO_DESKTOP_RE.test('https://m.weibo.cn/status/123')).toBe(false)
  })

  test('WEIBO_MOBILE_RE matches mobile weibo URLs', () => {
    expect(WEIBO_MOBILE_RE.test('https://m.weibo.cn/status/1234567890')).toBe(true)
    expect(WEIBO_MOBILE_RE.test('https://m.weibo.cn/detail/9876543210')).toBe(true)
  })

  test('REDDIT_RE matches reddit comment URLs', () => {
    expect(REDDIT_RE.test('https://www.reddit.com/r/test/comments/abc/title')).toBe(true)
    expect(REDDIT_RE.test('https://reddit.com/r/test/')).toBe(false)
  })

  test('WECHAT_MP_RE matches all WeChat MP article URLs (/s? and /s/)', () => {
    expect(WECHAT_MP_RE.test('https://mp.weixin.qq.com/s?__biz=MzA3MDg5NjYyOA==&mid=12345')).toBe(true)
    expect(WECHAT_MP_RE.test('https://mp.weixin.qq.com/s?mid=12345')).toBe(true)
    expect(WECHAT_MP_RE.test('https://mp.weixin.qq.com/s/9ah07EszDPvzO6zlbWwoUA')).toBe(true)
    expect(WECHAT_MP_RE.test('https://mp.weixin.qq.com/mp/homepage')).toBe(false)
  })
})
