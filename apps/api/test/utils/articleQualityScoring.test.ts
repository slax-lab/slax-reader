import { describe, expect, test } from 'vitest'
import { ARTICLE_QUALITY_SCORING_VERSION, formatArticleQualityComparison, formatArticleQualityReview, scoreArticleQuality, unavailableArticleQualityReview } from '@/utils/articleQualityScoring'

const sourceImage = 'https://img.example.com/article.png'

const imageProxy = () => {
  const url = new URL('https://reader-api.slax.dev/static/image')
  url.searchParams.set('u', encodeURIComponent(sourceImage))
  url.searchParams.set('r', 'https://example.com/article')
  return url.toString()
}

describe('article quality scoring', () => {
  test('matches the v3 completeness score for a complete candidate', () => {
    const article = `
      <article>
        <h1>文章标题</h1>
        <p>这是第一段正文，用来验证中文分词和正文召回率。</p>
        <p>这是第二段正文，包含一个 <a href="/related">链接</a>。</p>
        <img src="${sourceImage}" alt="cover">
        <table><tr><th>字段</th><th>值</th></tr><tr><td>A</td><td>B</td></tr></table>
        <pre>const value = 1</pre>
      </article>`
    const source = `<html><body><nav>Navigation should not be scored</nav>${article}</body></html>`
    const candidate = `<html><body>${article.replace(sourceImage, imageProxy())}</body></html>`

    const review = scoreArticleQuality({ sourceHtml: source, candidateHtml: candidate, url: 'https://example.com/article' })

    expect(review.version).toBe(ARTICLE_QUALITY_SCORING_VERSION)
    expect(review.status).toBe('scored')
    expect(review.score).toBe(1)
    expect(review.textRecall).toBe(1)
    expect(review.textF2).toBe(1)
    expect(review.imageRecall).toBe(1)
    expect(review.tableRecall).toBe(1)
    expect(review.codeRecall).toBe(1)
    expect(review.linkRecall).toBe(1)
    expect(review.structure).toBe(1)
    expect(review.hardFailures).toEqual([])
    expect(review.comment).toContain('综合完整度 100.0%')
  })

  test('uses CJK character tokens and reports missing content/resources', () => {
    const source = `
      <article>
        <h1>标题</h1>
        <p>你好世界这是完整正文内容</p>
        <img src="${sourceImage}">
        <table><tr><th>列一</th><th>列二</th></tr><tr><td>值一</td><td>值二</td></tr></table>
        <pre>important code</pre>
      </article>`
    const candidate = '<article><h1>标题</h1><p>你好世界</p></article>'

    const review = scoreArticleQuality({ sourceHtml: source, candidateHtml: candidate, url: 'https://example.com/article' })

    expect(review.textRecall).toBeGreaterThan(0)
    expect(review.textRecall).toBeLessThan(1)
    expect(review.imageRecall).toBe(0)
    expect(review.tableRecall).toBe(0)
    expect(review.codeRecall).toBe(0)
    expect(review.hardFailures).toEqual(expect.arrayContaining(['all_images_missing', 'all_tables_missing', 'all_code_missing']))
    expect(review.comment).toContain('图片全部缺失')
  })

  test('provides a non-blocking fallback when no score is available', () => {
    const review = unavailableArticleQualityReview()

    expect(review.status).toBe('unavailable')
    expect(review.score).toBeNull()
    expect(formatArticleQualityReview(review)).toContain('评分不可用')
    expect(formatArticleQualityReview()).toContain('评分不可用')
  })

  test('formats parser comparison with selected parser and every candidate', () => {
    const base = unavailableArticleQualityReview()
    const text = formatArticleQualityComparison({
      ...base,
      selectedParser: 'defuddle',
      parserReviews: [
        { parser: 'readability', review: base },
        { parser: 'defuddle', review: base }
      ]
    })

    expect(text).toContain('最终选择 Defuddle')
    expect(text).toContain('Readability：')
    expect(text).toContain('Defuddle：')
  })
})
