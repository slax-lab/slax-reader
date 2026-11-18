import { describe, expect, test } from 'vitest'
import { discoveryAgePenalty, discoveryPublishedAt, rankDiscoveryCards } from '../../src/utils/discoveryCards'

const now = Date.parse('2026-11-18T08:00:00Z')
const member = (title: string, relevance: number, url = 'https://example.org/' + title) => ({
  article: { title, url, description: '' }, sourceTitle: title, wordCount: 0, relevance, publishedAt: '2026-11-01'
})
const card = (name: string, score: number, members: ReturnType<typeof member>[]) => ({ collection: { name, score }, members })

describe('Discover card selection', () => {
  test('uses an earlier exact WeChat source minute for aging and rejects arbitrary excerpt dates', () => {
    const url = 'https://mp.weixin.qq.com/s/article'
    const stored = '2026-11-17T07:20:36.511Z'
    expect(discoveryPublishedAt(url, '2026-11-12 09:53', stored)).toEqual(new Date('2026-11-12T01:53:00Z'))
    for (const excerpt of ['2026-11-20 09:53', '2026-02-30 00:00', 'First saved 2024-10-10 00:00']) {
      expect(discoveryPublishedAt(url, excerpt, stored)).toBe(stored)
    }
    expect(discoveryPublishedAt('https://example.com/s/article', '2024-10-10 00:00', stored)).toBe(stored)
  })

  test('joint ranking considers all candidates before the limit and retains the winning lead', () => {
    const cards = [
      card('source favorite', .99, [member('one', .1), member('two', .15)]),
      card('strong card', .95, [member('three', .95), member('four', .95)]),
      card('third', .8, [member('five', .8), member('six', .8)])
    ]
    const [first] = rankDiscoveryCards(cards, 1, now)
    expect([first.name, first.articles[0].title]).toEqual(['strong card', 'three'])
  })

  test('deduplicates across cards, refills beyond three, and keeps distinct same-title publications', () => {
    const wechat = (url: string) => ({
      ...member('A shared publication', .9, url), article: { title: 'A shared publication', url, description: '2026-11-12 09:53' }, wordCount: 1588
    })
    const cards = [
      card('first', 1, [wechat('https://mp.weixin.qq.com/s/short'), member('alpha', .9), member('beta', .9)]),
      card('second', .7, [wechat('https://mp.weixin.qq.com/s?mid=123'), member('gamma', .6), member('delta', .6), member('refill', .5)]),
      card('single', .1, [member('A shared publication', .1, 'https://other.example/same-title')]),
      card('duplicate only', .05, [member('tracked alpha', .1, 'https://example.org/alpha?utm_source=x')])
    ]
    const result = rankDiscoveryCards(cards, 8, now)
    expect(result.map(c => c.name)).toEqual(['first', 'second', 'single'])
    expect(result[1].articles.map(a => a.title)).toEqual(['gamma', 'delta', 'refill'])
    expect(result[2].articles[0].title).toBe('A shared publication')
  })

  test('gives dated matches priority, caps old or undated picks, and limits unscored fillers to a month', () => {
    const dated = (title: string, score: number, days: number) => ({ ...member(title, score), publishedAt: new Date(now-days*86_400_000).toISOString() })
    const items = [
      dated('old', 1, 181), { ...member('undated', 1), publishedAt: '' }, dated('future', 1, -1),
      dated('unscored old', 0, 31), dated('unscored recent', 0, 30), dated('matched', .7, 180)
    ]
    const result = rankDiscoveryCards([card('only', .9, items)], 1, now)
    expect(result[0].articles.map(a => a.title)).toEqual(['matched', 'unscored recent'])
    expect(rankDiscoveryCards([card('empty', 1, [items[0]])], 1, now)).toEqual([])
    expect(discoveryAgePenalty('General story', dated('x', 1, 90).publishedAt, now)).toBeGreaterThan(0)
  })

  test('breaks an equal joint rank with the stronger visible article pair', () => {
    const result = rankDiscoveryCards([
      card('collection match', 1, [member('a', .6),member('b', .6)]),
      card('reading match', .9, [member('c', .9),member('d', .9)])
    ], 2, now)
    expect(result[0].name).toBe('reading match')
  })

  test('applies title-specific discounts to dated forecasts and announcements and ordinary decay to retrospectives', () => {
    const expired = '2025年中国将迎新机会'
    expect(discoveryAgePenalty(expired, '2025-01-01', now)).toBe(.3)
    expect(discoveryAgePenalty('回顾：2025年中国将迎新机会的预测', '2025-01-01', now)).toBe(.2)
    expect(discoveryAgePenalty('2025年的技术复盘', '2025-01-01', now)).toBe(.2)
    expect(discoveryAgePenalty('新工具正式发布', '2026-11-16', now)).toBe(0)
    expect(discoveryAgePenalty('新工具正式发布', '2025-01-01', now)).toBeCloseTo(.2, 3)
    for (const date of ['invalid', '2030-01-01']) expect(discoveryAgePenalty(expired, date, now)).toBe(0)
    const cards = [card('forecast', .9, [member(expired, 1), member('review', .9), member('guide', .8), member('comparison', .7)])]
    expect(rankDiscoveryCards(cards, 1, now, false)[0].articles[0].title).toBe(expired)
    expect(rankDiscoveryCards(cards, 1, now)[0].articles.map(a => a.title)).toEqual(['review', 'guide', 'comparison'])
  })
})
