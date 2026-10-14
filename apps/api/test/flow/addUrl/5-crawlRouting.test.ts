/**
 * /add_url Layer 5: CrawlWorkflow 路由 + 缓存/inline 分支
 * 来源: crawlWorkflow.ts 路由逻辑, platformDetector.ts
 */
import { describe, test, expect } from 'vitest'
import { detectRoute, isSocialMediaRoute, type RouteKind } from '@/utils/platformDetector'

describe('detectRoute 平台路由', () => {
  const cases: [string, RouteKind][] = [
    ['https://x.com/user/status/123', 'twitter'],
    ['https://twitter.com/user/status/456', 'twitter'],
    ['https://x.com/user/article/789', 'twitter_article'],
    ['https://www.xiaohongshu.com/explore/abc', 'xhs'],
    ['https://xiaohongshu.com/discovery/def', 'xhs'],
    ['https://weibo.com/123/abc', 'weibo'],
    ['https://m.weibo.cn/status/123', 'weibo'],
    ['https://m.weibo.cn/detail/456', 'weibo'],
    ['https://www.reddit.com/r/test/comments/abc/title', 'reddit'],
    ['https://mp.weixin.qq.com/s?__biz=MzA3&mid=123', 'weixin'],
    ['https://mp.weixin.qq.com/s/9ah07EszDPvzO6zlbWwoUA', 'weixin'],
    ['https://example.com/article', 'regular'],
    ['https://github.com/user/repo', 'regular'],
  ]
  test.each(cases)('%s → %s', (url, expected) => {
    expect(detectRoute(url)).toBe(expected)
  })
})

describe('isSocialMediaRoute', () => {
  test('twitter/twitter_article/xhs/weibo/reddit → true', () => {
    for (const r of ['twitter', 'twitter_article', 'xhs', 'weibo', 'reddit'] as RouteKind[]) {
      expect(isSocialMediaRoute(r)).toBe(true)
    }
  })
  test('regular/weixin → false', () => {
    expect(isSocialMediaRoute('regular')).toBe(false)
    expect(isSocialMediaRoute('weixin')).toBe(false)
  })
})
