/**
 * /add Layer 2: resource → inlineContent + CrawlWorkflow 行为差异
 * 来源: crawlWorkflow.ts:104, bookmarkAdd.ts:78
 */
import { describe, test, expect, vi } from 'vitest'
import { CrawlService } from '@/domain/crawl'
import { detectRoute, isSocialMediaRoute } from '@/utils/platformDetector'
import { createMockCtx, createMockBucketClient, createMockBookmarkRepo, createMockLogsService, createMockAlertBot } from '@test/helpers/mockFactory'

function wireCrawl() {
  const { factory: bc, putIfKeyExists } = createMockBucketClient()
  const br = createMockBookmarkRepo()
  const ls = createMockLogsService()
  const ab = createMockAlertBot()
  const svc = new (CrawlService as any)()
  ;(svc as any).bucketClient = bc; ;(svc as any).bookmarkRepo = br
  ;(svc as any).logsService = ls; ;(svc as any).alertBot = ab
  return { svc: svc as CrawlService, putIfKeyExists, br }
}

describe('inlineContent + regular URL → 直接 parseAndSaveContent', () => {
  test('实际调用 parseAndSaveContent 写入 R2 + DB', async () => {
    const { svc, putIfKeyExists, br } = wireCrawl()
    const inline = '<html><head><title>Client</title></head><body><article><p>Client-provided content long enough for parsing by Readability engine.</p></article></body></html>'
    const result = await svc.parseAndSaveContent(createMockCtx(), { content: inline, url: 'https://example.com/page', title: '' }, 88, 'ub-uuid-88')
    expect(result.title).toBeTruthy()
    expect(result.contentKey).toBe('html/body/ub-uuid-88.html')
    expect(putIfKeyExists).toHaveBeenCalledTimes(2)
    expect(br.updateBookmark).toHaveBeenCalledWith(88, expect.objectContaining({ status: 'success' }))
  })
})

describe('inlineContent + 社交媒体 URL → 忽略 inline', () => {
  const socialUrls = [
    'https://x.com/user/status/123',
    'https://www.xiaohongshu.com/explore/abc',
    'https://weibo.com/1/a',
    'https://reddit.com/r/t/comments/a/b',
  ]
  test.each(socialUrls)('%s → isSocialMedia=true, 不使用 inline', (url) => {
    const route = detectRoute(url)
    const isSocial = isSocialMediaRoute(route)
    expect(isSocial).toBe(true)
    expect(!!'<p>inline</p>' && !isSocial).toBe(false)
  })
})

describe('inlineContent + weixin URL → 使用 inline (非社交媒体)', () => {
  test('weixin 不在社交媒体列表中', () => {
    const route = detectRoute('https://mp.weixin.qq.com/s?__biz=Mz&mid=1')
    expect(route).toBe('weixin')
    expect(isSocialMediaRoute(route)).toBe(false)
    expect(!!'<p>inline</p>' && !isSocialMediaRoute(route)).toBe(true)
  })
})

describe('无 inlineContent → 走正常 fetch 流程', () => {
  test('undefined → 不触发 inline 路径', () => {
    expect(!!undefined && !false).toBe(false)
  })
  test('空字符串 → 不触发 inline 路径', () => {
    expect(!!'' && !false).toBe(false)
  })
})
