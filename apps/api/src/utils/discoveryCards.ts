export const DISCOVERY_MEMBER_WINDOW = 12
const DAY_MS = 86_400_000
const RECENT_DAYS = 30
const MAX_AGE_DAYS = 180

export function discoveryPublicationWindow(now: number) {
  return { from: new Date(now - MAX_AGE_DAYS * DAY_MS), through: new Date(now) }
}

const WECHAT_MINUTE = /^\d{4}-\d\d-\d\d \d\d:\d\d$/

export function discoveryPublishedAt(url: string, description: string | undefined, stored: Date | string) {
  const stamp = description?.trim()
  if (!stamp || !WECHAT_MINUTE.test(stamp) || !/^https?:\/\/mp\.weixin\.qq\.com\/s(?:[/?#]|$)/i.test(url)) return stored
  // Some WeChat snapshots retain the original China Standard Time in the excerpt.
  const source = Date.parse(stamp.replace(' ', 'T') + ':00+08:00')
  if (!(source < new Date(stored).getTime())) return stored
  const localMinute = new Date(source + 8 * 3_600_000).toISOString().slice(0, 16).replace('T', ' ')
  return localMinute === stamp ? new Date(source) : stored
}

export interface DiscoveryStory {
  title: string
  url: string
  description?: string
}

export interface DiscoveryMember<A extends DiscoveryStory> {
  article: A
  relevance: number
  sourceTitle: string
  publishedAt: Date | string
  wordCount: number
}

export interface DiscoveryCard<C, A extends DiscoveryStory> {
  collection: C
  members: DiscoveryMember<A>[]
}

function storyIdentity(member: DiscoveryMember<DiscoveryStory>) {
  let url: URL
  try {
    url = new URL(member.article.url)
  } catch {
    return { url: member.article.url }
  }
  if (!/^#(\/|!)/.test(url.hash)) url.hash = ''
  for (const key of [...url.searchParams.keys()]) {
    if (/^utm_|^(gclid|fbclid)$/i.test(key)) url.searchParams.delete(key)
  }
  // WeChat short links do not expose the article parameters of the long URL.
  // Match an exact original title, publisher minute and substantial extracted word count.
  const title = member.sourceTitle.trim()
  const stamp = member.article.description?.trim()
  if (url.hostname === 'mp.weixin.qq.com' && /^\/s(?:\/|$)/.test(url.pathname) && title.length >= 8 && stamp && WECHAT_MINUTE.test(stamp) && member.wordCount >= 100) {
    return { url: url.href, fingerprint: JSON.stringify(['wechat', title, stamp, member.wordCount]) }
  }
  return { url: url.href }
}

export function discoveryAgePenalty(title: string, publishedAt: Date | string, now: number): number {
  const ageDays = (now - new Date(publishedAt).getTime()) / DAY_MS
  if (!Number.isFinite(ageDays) || ageDays < 0) return 0
  const ageDiscount = 0.2 * Math.min(1, Math.max(0, (ageDays - RECENT_DAYS) / (MAX_AGE_DAYS - RECENT_DAYS)))
  if (/教程|复盘|回顾|指南|\b(?:guide|tutorial|retrospective)\b/i.test(title)) return ageDiscount
  // Only a forward-looking claim tied to an elapsed year expires. Historical accounts keep their value.
  const forecast = title.match(/\b(20\d{2})\s*年[^。！？\n]{0,20}(?:将迎|将会|有望|预测|展望)|\b(?:forecast|outlook|predictions?)\s+(?:for\s+)?(20\d{2})\b/i)
  if (forecast && Number(forecast[1] ?? forecast[2]) < new Date(now).getUTCFullYear()) return 0.3
  if (!/首次发布|发布会|正式发布|正式上线|预览版上线|今日发布|刚刚发布|\b(?:launches|announces|breaking news|released today)\b/i.test(title)) return ageDiscount
  return Math.max(ageDiscount, 0.2 * (1 - Math.exp(-Math.max(0, ageDays - 7) / 30)))
}

function rankScores(values: number[]) {
  const ranks = new Map<number, number>()
  const ordered = [...values].sort((a, b) => b - a)
  ordered.forEach((value, index) => {
    if (!ranks.has(value)) ranks.set(value, index)
  })
  return ranks
}

/** Members arrive in diversified order, followed by the rest of the eligible publication window. */
export function rankDiscoveryCards<C extends { score: number }, A extends DiscoveryStory>(cards: DiscoveryCard<C, A>[], limit: number, now: number, applyAgePenalty = true) {
  const fingerprints = new Map<string, string>()
  const remaining = cards.map(({ collection, members }) => {
    const ordered = members
      .flatMap((member, index) => {
        const ageDays = (now - new Date(member.publishedAt).getTime()) / DAY_MS
        const maxDays = member.relevance > 0 ? MAX_AGE_DAYS : RECENT_DAYS
        if (!Number.isFinite(ageDays) || ageDays < 0 || ageDays > maxDays) return []
        const identity = storyIdentity(member)
        if (identity.fingerprint) fingerprints.set(identity.url, identity.fingerprint)
        const penalty = applyAgePenalty ? discoveryAgePenalty(member.sourceTitle, member.publishedAt, now) : 0
        return [{ url: identity.url, article: member.article, relevance: member.relevance * (1 - penalty), priority: index + penalty * DISCOVERY_MEMBER_WINDOW }]
      })
      .sort((a, b) => Number(b.relevance > 0) - Number(a.relevance > 0) || a.priority - b.priority)
    return { collection, ordered }
  })
  const seen = new Set<string>()
  const output: (C & { articles: A[] })[] = []
  while (remaining.length && output.length < limit) {
    const choices = remaining.flatMap((card, index) => {
      const keys = new Set<string>()
      const picks = []
      for (const member of card.ordered) {
        const key = fingerprints.get(member.url) ?? member.url
        if (seen.has(key) || keys.has(key)) continue
        keys.add(key)
        picks.push(member)
        if (picks.length === 3) break
      }
      if (!picks.length) return []
      const companion = Math.max(0, ...picks.slice(1).map(member => member.relevance))
      return [{ card, index, keys, picks, readingScore: (2 * picks[0].relevance + companion) / 3 }]
    })
    if (!choices.length) break
    const groups = choices.filter(choice => choice.picks.length >= 2)
    const formatPool = groups.length ? groups : choices
    const matched = formatPool.filter(choice => choice.picks[0].relevance > 0)
    const pool = matched.length ? matched : formatPool
    const collectionRanks = rankScores(pool.map(choice => choice.card.collection.score))
    const readingRanks = rankScores(pool.map(choice => choice.readingScore))
    const rank = (choice: (typeof pool)[number]) => collectionRanks.get(choice.card.collection.score)! + readingRanks.get(choice.readingScore)!
    // Break joint ties on the stories the reader can actually open, then keep Collection MMR order.
    const best = pool.reduce((a, b) => {
      const difference = rank(b) - rank(a)
      return difference < 0 || (difference === 0 && b.readingScore > a.readingScore) ? b : a
    })
    for (const key of best.keys) seen.add(key)
    output.push({ ...best.card.collection, articles: best.picks.map(member => member.article) })
    remaining.splice(best.index, 1)
  }
  return output
}
