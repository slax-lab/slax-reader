/**
 * /add_url Layer 6: 各平台 parseAndSave 实际执行
 * 来源: crawl.ts parseAndSaveTwitter/Xhs/Weibo/Reddit/Content, saveParseRes, extractTweetId
 */
import { describe, test, expect, vi } from 'vitest'
import { CrawlService, type TwitterFetched } from '@/domain/crawl'
import { parseHTML } from 'linkedom'
import { createMockCtx, createMockBucketClient, createMockBookmarkRepo, createMockLogsService, createMockAlertBot } from '@test/helpers/mockFactory'

function wire() {
  const { factory: bc, putIfKeyExists } = createMockBucketClient()
  const br = createMockBookmarkRepo()
  const ls = createMockLogsService()
  const ab = createMockAlertBot()
  const svc = new (CrawlService as any)()
  ;(svc as any).bucketClient = bc; ;(svc as any).bookmarkRepo = br
  ;(svc as any).logsService = ls; ;(svc as any).alertBot = ab
  return { svc: svc as CrawlService, putIfKeyExists, br }
}

describe('parseAndSaveTwitter', () => {
  const tweetFetched: TwitterFetched = {
    kind: 'tweet',
    tweetInfo: {
      text: 'Hello from test tweet!', url: 'https://x.com/u/status/1',
      author: { name: 'User', userName: 'u', profileImageUrl: '' },
      createdAt: '2024-01-15T10:00:00Z', media: [], quoted_tweet: null
    } as any,
    quoteTweetHtml: ''
  }

  test('tweet → R2(html+txt) + DB(title/status/byline/site_name)', async () => {
    const { svc, putIfKeyExists, br } = wire()
    const result = await svc.parseAndSaveTwitter(createMockCtx(), tweetFetched, 10, 'ub-uuid-10')
    expect(result.title).toContain('Tweet:')
    expect(result.textContent).toBe('Hello from test tweet!')
    expect(result.siteName).toBe('Twitter')
    expect(result.byline).toBe('User')
    expect(result.contentKey).toBe('html/body/ub-uuid-10.html')
    expect(putIfKeyExists).toHaveBeenCalledTimes(2)
    expect(br.updateBookmark).toHaveBeenCalledWith(10, expect.objectContaining({ status: 'success', site_name: 'Twitter' }))
  })

  test('title 截断 = "Tweet: " + cleanText.substring(0,30)', async () => {
    const long: TwitterFetched = {
      kind: 'tweet',
      tweetInfo: { ...tweetFetched.tweetInfo, text: 'A'.repeat(50) } as any,
      quoteTweetHtml: ''
    }
    const { svc } = wire()
    const result = await svc.parseAndSaveTwitter(createMockCtx(), long, 1)
    expect(result.title).toBe('Tweet: ' + 'A'.repeat(30))
  })
})

describe('parseAndSaveXhs', () => {
  test('正常数据 → R2 + DB + title="RedNote By: ..."', async () => {
    const { svc, putIfKeyExists, br } = wire()
    const data = {
      title: '好物', desc: '推荐', user: { nickname: '用户A', avatar: '' },
      time: 1705276800000, images: [], video: null,
      interact_info: { comment_count: 5, share_count: 3, liked_count: 50 }
    } as any
    const result = await svc.parseAndSaveXhs(createMockCtx(), data, 'https://xiaohongshu.com/explore/abc', 20)
    expect(result.title).toBe('RedNote By: 好物')
    expect(result.byline).toBe('用户A')
    expect(result.siteName).toBe('RedNote')
    expect(putIfKeyExists).toHaveBeenCalledTimes(2)
    expect(br.updateBookmark).toHaveBeenCalledWith(20, expect.objectContaining({ site_name: 'RedNote' }))
  })

  test('user 为 null → byline=""', async () => {
    const { svc } = wire()
    const data = {
      title: '笔记', desc: '内容', user: null, time: null, images: [],
      interact_info: { comment_count: 0, share_count: 0, liked_count: 0 }
    } as any
    const result = await svc.parseAndSaveXhs(createMockCtx(), data, 'https://xiaohongshu.com/explore/x', 21)
    expect(result.byline).toBe('')
  })
})

describe('parseAndSaveWeibo', () => {
  test('正常数据 → R2 + DB', async () => {
    const { svc, br } = wire()
    const data = {
      id: '500', text: '<p>微博内容</p>', text_raw: '微博内容',
      user: { screen_name: '用户' }, created_at: 'Mon Jan 15 10:00:00 +0800 2024', pics: []
    } as any
    const result = await svc.parseAndSaveWeibo(createMockCtx(), data, 'https://weibo.com/1/a', 30)
    expect(result.title).toContain('Weibo by 用户')
    expect(result.textContent).toBe('微博内容')
    expect(br.updateBookmark).toHaveBeenCalledWith(30, expect.objectContaining({ site_name: 'Weibo' }))
  })

  test('text_raw 为空 → 降级用 text', async () => {
    const { svc } = wire()
    const data = { id: '1', text: 'fallback text', text_raw: '', user: { screen_name: 'u' }, created_at: 'Mon Jan 15 10:00:00 +0800 2024' } as any
    const result = await svc.parseAndSaveWeibo(createMockCtx(), data, 'https://weibo.com/1/a', 31)
    expect(result.textContent).toBe('fallback text')
  })
})

describe('parseAndSaveReddit', () => {
  test('正常数据 → R2 + DB + byline="u/..."', async () => {
    const { svc, br } = wire()
    const data = {
      title: 'TIL', content: 'Fact here', author: { name: 'user1' }, subreddit: { name: 'todayilearned' },
      createdAt: '2024-01-15T10:00:00Z', comments: [], media: { type: 'none' }, score: 100, url: 'https://reddit.com/r/t/comments/a/'
    } as any
    const result = await svc.parseAndSaveReddit(createMockCtx(), data, 'https://reddit.com/r/t/comments/a/', 40)
    expect(result.title).toBe('TIL')
    expect(result.byline).toBe('u/user1')
    expect(result.siteName).toBe('r/todayilearned')
    expect(br.updateBookmark).toHaveBeenCalledWith(40, expect.objectContaining({ site_name: 'r/todayilearned' }))
  })
})

describe('parseAndSaveContent (普通页面)', () => {
  test('正常 HTML → parse + R2 + DB + CrawlResult', async () => {
    const { svc, putIfKeyExists, br } = wire()
    const fetchRes = {
      url: 'https://example.com/article',
      content: '<html><head><title>Art</title></head><body><article><h1>Art</h1><p>Body text long enough for Readability to process correctly.</p></article></body></html>',
      title: 'Art'
    }
    const result = await svc.parseAndSaveContent(createMockCtx(), fetchRes, 50, 'ub-uuid-50')
    expect(result.title).toBeTruthy()
    expect(result.contentKey).toBe('html/body/ub-uuid-50.html')
    expect(result.qualityReview?.status).toBe('scored')
    expect(result.qualityReview?.version).toBe('slax-corpus-scoring-v3')
    expect(putIfKeyExists).toHaveBeenCalledTimes(2)
    expect(br.updateBookmark).toHaveBeenCalledWith(50, expect.objectContaining({ status: 'success' }))
  })

  test('空 HTML → 返回空字段 (不抛异常)', async () => {
    const { svc, br } = wire()
    const result = await svc.parseAndSaveContent(createMockCtx(), { url: 'https://a.com', content: '<html><body></body></html>', title: '' }, 51, 'ub-uuid-51')
    expect(result.title).toBe('')
    expect(result.textContent).toBe('')
    expect(br.updateBookmark).toHaveBeenCalledWith(51, expect.objectContaining({ content_word_count: 0 }))
  })
})

describe('saveParseRes 内部逻辑', () => {
  test('contentKey 格式: html/body/{uuid}.html', async () => {
    const { svc } = wire()
    const { document } = parseHTML('<html><body><p>X</p></body></html>')
    const parseRes = { title: 'T', textContent: 'X', contentDocument: document, content: '', excerpt: '', byline: '', siteName: '', publishedTime: new Date(), length: 1, dir: '', lang: '' }
    const result = await (svc as any).saveParseRes(parseRes, 99, 'ub-uuid-99')
    expect(result.contentKey).toBe('html/body/ub-uuid-99.html')
  })

  test('同时写 html + txt 到 R2', async () => {
    const { svc, putIfKeyExists } = wire()
    const { document } = parseHTML('<html><body><p>Hello</p></body></html>')
    const parseRes = { title: 'T', textContent: 'Hello', contentDocument: document, content: '', excerpt: '', byline: '', siteName: '', publishedTime: new Date(), length: 5, dir: '', lang: '' }
    await (svc as any).saveParseRes(parseRes, 1, 'ub-uuid-1')
    expect(putIfKeyExists.mock.calls.find((c: any[]) => c[0].endsWith('.html'))).toBeTruthy()
    expect(putIfKeyExists.mock.calls.find((c: any[]) => c[0].endsWith('.txt'))).toBeTruthy()
  })

  test('DB 更新全字段', async () => {
    const { svc, br } = wire()
    const pub = new Date('2024-06-15')
    const { document } = parseHTML('<html><body><p>C</p></body></html>')
    const parseRes = { title: 'T', textContent: 'C', contentDocument: document, content: '', excerpt: 'E', byline: 'B', siteName: 'S', publishedTime: pub, length: 1, dir: '', lang: '' }
    const result = await (svc as any).saveParseRes(parseRes, 77, 'ub-uuid-77')
    expect(br.updateBookmark).toHaveBeenCalledWith(77, {
      title: 'T', description: 'E', content_word_count: 1,
      content_key: result.contentKey, content_md_key: expect.stringContaining('text/body/'),
      status: 'success', byline: 'B', site_name: 'S', published_at: pub
    })
  })
})

describe('extractTweetId', () => {
  const extract = (CrawlService as any).extractTweetId
  test('正常 URL → tweet ID', () => { expect(extract('https://x.com/u/status/12345')).toBe('12345') })
  test('带 query → tweet ID', () => { expect(extract('https://x.com/u/status/99?ref=1')).toBe('99') })
  test('无 /status/ → 抛异常', () => { expect(() => extract('https://x.com/u/likes')).toThrow() })
  test('/article/ → 抛异常', () => { expect(() => extract('https://x.com/u/article/1')).toThrow() })
})
